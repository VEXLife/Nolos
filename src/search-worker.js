/* ONNX and search stay off the UI thread. */
importScripts('https://cdn.jsdelivr.net/npm/onnxruntime-web@1.30.0/dist/ort.min.js', 'mcts.js?v=13');
ort.env.wasm.numThreads = 1;
ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.30.0/dist/';
let search, modelBytes, backend = null, batchSize = 16, queue = Promise.resolve();
const cancelled = new Set(), pending = new Set();
const CELLS = 225;
// The batch (leaves scored per network call) comes from the page. WebNN needs static
// shapes, so its batch is baked into the session and short batches are zero-padded.
const CANDIDATES = {
    npu: {label: 'NPU (WebNN)', providers: [{name: 'webnn', deviceType: 'npu'}], fixed: true},
    webgpu: {label: 'GPU (WebGPU)', providers: ['webgpu'], fixed: false},
    gpu: {label: 'GPU (WebNN)', providers: [{name: 'webnn', deviceType: 'gpu'}], fixed: true},
    wasm: {label: 'CPU (WASM)', providers: ['wasm'], fixed: false},
};
const AUTO = ['npu', 'webgpu', 'wasm'];
self.onmessage = ({data}) => {
    if (data.type === 'stop') { if (pending.has(data.id)) cancelled.add(data.id); return; }
    if (data.type === 'search') pending.add(data.id);
    queue = queue.then(() => dispatch(data));
};
async function createBackend(name) {
    const spec = {...CANDIDATES[name], batch: batchSize};
    const options = {executionProviders: spec.providers, graphOptimizationLevel: 'all'};
    if (spec.fixed) options.freeDimensionOverrides = {'DynamicDimension.0': spec.batch};
    const session = await ort.InferenceSession.create(modelBytes, options);
    const run = async boards => {
        const size = spec.fixed ? spec.batch : boards.length;
        const input = new Float32Array(size * CELLS);
        boards.forEach((board, i) => input.set(board, i * CELLS));
        const tensor = new ort.Tensor('float32', input, [size, 1, 15, 15]);
        let output;
        try {
            output = await session.run({inputs: tensor});
            const policy = output['softmax_0.tmp_0'].data, value = output['tanh_0.tmp_0'].data;
            if (policy.length !== size * CELLS || value.length !== size) throw new Error('Unexpected model output shape');
            return boards.map((_, i) => ({policy: Float32Array.from(policy.subarray(i * CELLS, (i + 1) * CELLS)), value: [value[i]]}));
        } finally {
            tensor.dispose();
            for (const v of Object.values(output || {})) v.dispose();
        }
    };
    // Warm-up doubles as a correctness probe and a throughput measurement (boards per ms).
    const probe = Array.from({length: spec.batch}, () => new Float32Array(CELLS));
    const first = await run(probe);
    if (!first.every(p => Number.isFinite(p.value[0]) && p.policy.every(Number.isFinite))) throw new Error('Non-finite model output');
    const t0 = performance.now();
    for (let i = 0; i < 3; i++) await run(probe);
    const speed = 3 * spec.batch / Math.max(1e-3, performance.now() - t0);
    return {name, label: spec.label, batch: spec.batch, run, speed, session};
}
async function chooseBackend(preference) {
    const names = CANDIDATES[preference] ? [preference] : AUTO;
    const ready = [], failures = [];
    for (const name of names) {
        try { ready.push(await createBackend(name)); }
        catch (error) { failures.push(`${CANDIDATES[name].label}: ${error.message || error}`); }
    }
    // A requested accelerator that is missing falls back to the CPU rather than failing.
    if (!ready.length && !names.includes('wasm')) {
        try { ready.push(await createBackend('wasm')); } catch (error) { failures.push(`CPU (WASM): ${error.message || error}`); }
    }
    if (!ready.length) throw new Error('没有可用的推理后端：' + failures.join('；'));
    // Measured throughput decides, so a slow integrated GPU never beats the CPU.
    const chosen = ready.reduce((a, b) => (b.speed > a.speed ? b : a));
    for (const other of ready) if (other !== chosen) other.session.release?.().catch?.(() => {});
    return {chosen, failures};
}
const clampBatch = value => Math.max(1, Math.min(64, Math.floor(Number(value)) || 16));
async function setup(preference, send) {
    const {chosen, failures} = await chooseBackend(preference);
    const old = backend;
    backend = chosen;
    old?.session.release?.().catch?.(() => {});
    search = new GomokuZero.Search(async board => (await backend.run([board]))[0], boards => backend.run(boards));
    send({type: 'ready', backend: backend.name, label: backend.label, batch: backend.batch, speed: backend.speed, failures});
}
async function dispatch(data) {
    const send = message => self.postMessage({...message, id: data.id});
    try {
        if (data.type === 'init') {
            modelBytes = data.buffer;
            batchSize = clampBatch(data.batch);
            await setup(data.backend || 'auto', send);
        } else if (data.type === 'backend') {
            if (!modelBytes) throw new Error('模型尚未加载');
            batchSize = clampBatch(data.batch);
            await setup(data.backend, send);
        } else if (data.type === 'search') {
            if (!search) throw new Error('模型尚未加载');
            if (cancelled.has(data.id)) { send({type: 'result', result: {stopped: true, candidates: []}}); return; }
            const result = await search.run(data.board, {batch: backend.batch, ...data.options,
                shouldStop: () => cancelled.has(data.id),
                onProgress: stats => send({type: 'progress', stats})});
            send({type: 'result', result});
        }
    } catch (error) {
        send({type: 'error', message: error.message});
    } finally { cancelled.delete(data.id); pending.delete(data.id); }
}
