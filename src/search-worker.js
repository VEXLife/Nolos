/* ONNX and search stay off the UI thread. */
importScripts('https://cdn.jsdelivr.net/npm/onnxruntime-web@1.30.0/dist/ort.min.js', 'mcts.js?v=12');
ort.env.wasm.numThreads = 1;
ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.30.0/dist/';
let search, queue = Promise.resolve();
const cancelled = new Set(), pending = new Set();
self.onmessage = ({data}) => {
    if (data.type === 'stop') { if (pending.has(data.id)) cancelled.add(data.id); return; }
    if (data.type === 'search') pending.add(data.id);
    queue = queue.then(() => dispatch(data));
};
async function dispatch(data) {
    const send = message => self.postMessage({...message, id: data.id});
    try {
        if (data.type === 'init') {
            const session = await ort.InferenceSession.create(data.buffer, {executionProviders: ['wasm']});
            search = new GomokuZero.Search(async board => {
                const tensor = new ort.Tensor('float32', board, [1, 1, 15, 15]);
                let output;
                try {
                    output = await session.run({inputs: tensor});
                    return {policy: Float32Array.from(output['softmax_0.tmp_0'].data),
                        value: Float32Array.from(output['tanh_0.tmp_0'].data)};
                } finally {
                    tensor.dispose();
                    for (const value of Object.values(output || {})) value.dispose();
                }
            });
            send({type: 'ready'});
        } else if (data.type === 'search') {
            if (!search) throw new Error('模型尚未加载');
            if (cancelled.has(data.id)) { send({type: 'result', result: {stopped: true, candidates: []}}); return; }
            const result = await search.run(data.board, {...data.options,
                shouldStop: () => cancelled.has(data.id),
                onProgress: stats => send({type: 'progress', stats})});
            send({type: 'result', result});
        }
    } catch (error) {
        send({type: 'error', message: error.message});
    } finally { cancelled.delete(data.id); pending.delete(data.id); }
}
