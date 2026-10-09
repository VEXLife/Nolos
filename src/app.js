(() => {
    'use strict';
    const $ = id => document.getElementById(id);
    const {coord: rawCoord, parse, position, viewMaps} = ZeroGame;
    const view = {rot: 0, hflip: false, vflip: false};
    let mapping = viewMaps(view);
    const coord = move => rawCoord(mapping.forward[move]);
    const canvas = $('board'), ctx = canvas.getContext('2d');
    const worker = new Worker('src/search-worker.js?v=13');
    const state = {moves: [], cursor: 0, ready: false, active: null, serial: 0,
        analysis: new Map(), hover: null, pinned: null, focus: null};
    const reasons = {win: '立即成五', block: '唯一必防点', 'forcing-four': '连续冲四已证明',
        'proven-win': '搜索已证明胜势', 'proven-loss': '已证明败势 · 尽量抵抗', resistance: '败势抵抗 · 延长已知败线', mcts: 'PUCT 搜索', draw: '棋盘已满'};
    const key = () => state.moves.slice(0, state.cursor).join(',');
    const current = () => position(state.moves, state.cursor);
    const analysis = () => state.analysis.get(key());
    const fmt = n => n >= 10000 ? (n / 1000).toFixed(1) + 'k' : n.toLocaleString('en-US');
    const pct = n => n === null || n === undefined ? '—' : (n * 100).toFixed(1) + '%';
    const color = score => score === null || score === undefined ? '#807669' : `hsl(${8 + score * 125} 44% 43%)`;
    const aiTurn = () => $('mode').value !== 'analysis' && current().side === ($('mode').value === 'black' ? -1 : 1);
    function notice(message) { $('notice').textContent = message; $('notice').hidden = !message; }
    function save() {
        try { localStorage.setItem('nolos-zero-game-v1', JSON.stringify({moves: state.moves, cursor: state.cursor, view, mode: $('mode').value})); } catch (_) {}
    }
    function cancel(discard = true) {
        if (!state.active) return;
        worker.postMessage({type: 'stop', id: state.active.id});
        if (discard) state.active = null;
        else { state.active.purpose = 'analysis'; state.active.stopping = true; }
    }
    function resetPreview() { state.hover = null; state.pinned = null; }
    function navigate(cursor) {
        cancel(); resetPreview(); notice(''); state.cursor = Math.max(0, Math.min(state.moves.length, cursor));
        save(); render();
    }
    function play(move, computer = false) {
        const p = current();
        if (p.ended || p.board[move] || move < 0 || move >= 225) return;
        if (state.cursor !== state.moves.length) { notice('正在复盘。先点击「从此续下」再落子。'); return; }
        if (!computer && $('mode').value !== 'analysis' && (!state.ready || aiTurn() || state.active)) return;
        cancel(); resetPreview(); notice(''); state.moves.push(move); state.cursor++;
        save(); render();
        if ($('mode').value === 'analysis') { if ($('auto-analysis').checked) begin('analysis'); }
        else maybeAI();
    }
    function maybeAI() {
        if (state.ready && state.cursor === state.moves.length && !current().ended && aiTurn() && !state.active) begin('play');
    }
    function begin(purpose = 'analysis') {
        if (!state.ready || current().ended) return;
        cancel(); resetPreview(); notice('');
        const p = current(), id = ++state.serial;
        const active = {id, key: key(), cursor: state.cursor, purpose};
        state.active = active;
        const timeMs = Number($('time').value), maxEvaluations = Number($('evaluation-limit').value), cpuct = Number($('cpuct').value);
        if ((purpose === 'play' && (!Number.isFinite(maxEvaluations) || maxEvaluations < 1 || maxEvaluations > 5000)) || !Number.isFinite(cpuct) || cpuct < .1 || cpuct > 5) {
            state.active = null; notice('推理上限须为 1–5000，探索系数须为 0.1–5。'); render(); return;
        }
        worker.postMessage({type: 'search', id, board: Float32Array.from(p.board, x => x * p.side),
            options: {timeMs, maxEvaluations: Math.floor(maxEvaluations), cpuct, analysis: purpose === 'analysis', continuous: purpose === 'analysis'}});
        render();
    }
    worker.onmessage = ({data}) => {
        if (data.type === 'ready') {
            state.ready = true; $('backend').disabled = $('batch-size').disabled = false;
            const wanted = $('backend').value;
            state.backend = data.label;
            state.fallback = wanted !== 'auto' && wanted !== data.backend;
            $('backend-tag').textContent = data.label + (state.fallback ? ' · 已回退' : '');
            $('backend-tag').classList.toggle('warn', state.fallback);
            if (state.fallback) notice(`所选后端不可用，已回退到 ${data.label}：` + data.failures.join('；'));
            $('backend-tag').title = `批大小 ${data.batch} · 约 ${(data.speed * 1000).toFixed(0)} 局面/秒` + (data.failures.length ? '\n不可用：' + data.failures.join('；') : '');
            render(); maybeAI(); return;
        }
        if (data.type === 'error') {
            if (data.id === 0 || data.id === state.active?.id) {
                state.active = null; notice('模型或搜索出错：' + data.message); render();
                if (!state.ready) $('engine-status').textContent = '加载失败 · 刷新重试';
            }
            return;
        }
        const active = state.active;
        if (!active || data.id !== active.id || active.key !== key()) return;
        if (data.type === 'progress' || data.type === 'result') {
            const result = data.type === 'progress' ? data.stats : data.result;
            if (result.candidates?.length) state.analysis.set(active.key, {...result, complete: data.type === 'result'});
            if (data.type === 'result') {
                state.active = null;
                if (active.purpose === 'play' && !result.stopped && Number.isInteger(result.move)) { play(result.move, true); return; }
            }
            render();
        }
    };
    worker.onerror = event => { state.active = null; notice('分析线程出错：' + event.message); render(); };
    try { const saved = localStorage.getItem('nolos-zero-backend'); if (saved && [...$('backend').options].some(o => o.value === saved)) $('backend').value = saved; } catch (_) {}
    const batchValue = () => Math.max(1, Math.min(64, Math.floor(Number($('batch-size').value)) || 16));
    try { const saved = Number(localStorage.getItem('nolos-zero-batch')); if (saved >= 1 && saved <= 64) $('batch-size').value = saved; } catch (_) {}
    // Both settings rebuild the session: WebNN fixes the batch at creation, and speed is re-measured.
    const reconfigure = () => {
        $('batch-size').value = batchValue();
        try {
            localStorage.setItem('nolos-zero-backend', $('backend').value);
            localStorage.setItem('nolos-zero-batch', $('batch-size').value);
        } catch (_) {}
        if (!state.ready) return;
        cancel(); state.ready = false; $('backend').disabled = $('batch-size').disabled = true;
        $('engine-status').textContent = '切换推理后端';
        worker.postMessage({type: 'backend', id: 0, backend: $('backend').value, batch: batchValue()});
    };
    $('backend').onchange = reconfigure;
    $('batch-size').onchange = reconfigure;
    async function loadModel() {
        let cache;
        try { if ('caches' in window) cache = await caches.open('model-cache'); } catch (_) {}
        let response = cache ? await cache.match('./model.onnx') : null;
        if (!response) {
            response = await fetch('./model.onnx');
            if (!response.ok) throw new Error('模型下载失败：' + response.status);
            try { if (cache) await cache.put('./model.onnx', response.clone()); } catch (_) {}
        }
        const total = Number(response.headers.get('Content-Length'));
        let buffer;
        if (response.body && total > 0) {
            const reader = response.body.getReader(), chunks = []; let loaded = 0;
            while (true) {
                const {value, done} = await reader.read(); if (done) break;
                chunks.push(value); loaded += value.length;
                $('engine-status').textContent = '加载模型 ' + Math.min(100, Math.round(loaded / total * 100)) + '%';
            }
            buffer = await new Blob(chunks).arrayBuffer();
        } else buffer = await response.arrayBuffer();
        $('engine-status').textContent = '正在初始化网络';
        worker.postMessage({type: 'init', id: 0, buffer, backend: $('backend').value, batch: batchValue()}, [buffer]);
    }
    function previewCandidate() {
        const move = state.pinned ?? state.hover;
        return analysis()?.candidates?.find(c => c.move === move);
    }
    function render() {
        const p = current(), a = analysis(), busy = Boolean(state.active), review = state.cursor < state.moves.length;
        $('engine-pill').className = 'engine-pill ' + (busy ? 'thinking' : state.ready ? 'ready' : '');
        if (state.ready) $('engine-status').textContent = (busy ? (state.active.stopping ? '正在停止' : '搜索中') : '模型就绪') + ' · ' + (state.backend || '本地推理');
        $('move-counter').textContent = String(state.cursor).padStart(2, '0');
        $('turn-text').textContent = p.ended ? p.winner ? (p.winner === 1 ? '黑棋胜' : '白棋胜') : '和棋' : (p.side === 1 ? '黑棋' : '白棋') + '行棋';
        $('black-who').textContent = $('mode').value === 'analysis' ? '自由分析' : $('mode').value === 'black' ? '您' : '电脑';
        $('white-who').textContent = $('mode').value === 'analysis' ? '自由分析' : $('mode').value === 'white' ? '您' : '电脑';
        for (const [id, side] of [['player-black', 1], ['player-white', -1]]) {
            $(id).classList.toggle('active', p.side === side && !p.ended);
            $(id).classList.toggle('thinking', busy && p.side === side);
        }
        $('position-status').textContent = p.ended ? '对局结束 · 可回退分析' : review ? '复盘第 ' + state.cursor + ' 手 / 共 ' + state.moves.length + ' 手' : busy ? '分析中 · 可停止或回看棋谱' : aiTurn() ? '电脑行棋 · 可分析后落下推荐' : '点击交叉点落子';
        $('review-tag').hidden = !review;
        $('nav-slider').max = state.moves.length; $('nav-slider').value = state.cursor;
        $('nav-first').disabled = $('nav-prev').disabled = state.cursor === 0;
        $('nav-last').disabled = $('nav-next').disabled = state.cursor === state.moves.length;
        $('undo').disabled = !state.cursor;
        $('analyze').disabled = !state.ready || p.ended || busy;
        $('stop').disabled = !busy || state.active.stopping;
        $('branch').hidden = !review;
        $('play-best').disabled = busy || p.ended || review || !a?.candidates?.length;
        renderAnalysis(a); renderRecord(); renderChart(); draw();
    }
    function renderAnalysis(a) {
        const best = a?.candidates?.[0], preview = previewCandidate() || best;
        const value = best?.score;
        $('score').textContent = pct(value);
        $('score-side').textContent = (current().side === 1 ? '黑棋' : '白棋') + ' · 预期得分';
        $('balance-fill').style.width = ((value ?? .5) * 100) + '%';
        $('best-move').textContent = best ? coord(best.move) : '—';
        $('reason').textContent = reasons[a?.reason] || 'PUCT 搜索';
        $('analysis-state').textContent = state.active ? '实时搜索' : a ? a.stopped ? '已停止' : a.complete ? '分析完成' : '部分分析' : '等待分析';
        $('visits').textContent = a ? fmt(a.rootVisits || 0) : '—';
        $('inferences').textContent = a ? fmt(a.evaluations || 0) : '—';
        $('cache-hits').textContent = a ? fmt(a.cacheHits || 0) : '—';
        $('elapsed').textContent = a?.elapsedMs === undefined ? '—' : (a.elapsedMs / 1000).toFixed(2) + 's';
        $('inference-speed').textContent = a?.elapsedMs > 0 ? fmt(Math.round((a.evaluations || 0) / a.elapsedMs * 1000)) + '/s' : '—';
        $('pv-label').textContent = preview ? '主要变化 · ' + coord(preview.move) + (state.pinned !== null ? ' · 已锁定' : '') : '主要变化 · 悬停候选查看';
        $('pv').replaceChildren(...(preview?.pv?.length ? preview.pv.map((move, i) => {
            const span = document.createElement('span'); span.textContent = (i + 1) + ' ' + coord(move); return span;
        }) : [document.createTextNode('尚无搜索变化')]));
        $('clear-preview').hidden = state.pinned === null;
        const tbody = $('candidates'); tbody.replaceChildren();
        if (!a?.candidates?.length) { const row = tbody.insertRow(); row.insertCell().textContent = '点击「分析局面」开始'; row.cells[0].colSpan = 4; row.cells[0].className = 'empty'; return; }
        const maxVisits = Math.max(1, ...a.candidates.map(c => c.visits));
        for (const candidate of a.candidates) {
            const row = tbody.insertRow(); row.dataset.move = candidate.move;
            row.classList.toggle('selected', (state.pinned ?? state.hover) === candidate.move);
            const button = document.createElement('button'); button.textContent = coord(candidate.move);
            button.setAttribute('aria-label', '预览 ' + coord(candidate.move) + ' 变化');
            button.onclick = () => { state.pinned = state.pinned === candidate.move ? null : candidate.move; renderAnalysis(analysis()); draw(); };
            row.insertCell().append(button);
            const visits = row.insertCell(); visits.className = 'visit-cell'; visits.textContent = fmt(candidate.visits);
            const bar = document.createElement('i'); bar.style.width = (candidate.visits / maxVisits * 80) + '%'; visits.append(bar);
            const evaluation = row.insertCell();
            evaluation.textContent = candidate.solved === 1 ? '已胜' : candidate.solved === -1 ? '已败' : pct(candidate.score);
            if (candidate.proofDepth !== null && candidate.proofDepth !== undefined) {
                evaluation.title = '已知证明线长度：' + candidate.proofDepth + ' 手';
                evaluation.dataset.proofDepth = candidate.proofDepth;
            }
            row.insertCell().textContent = pct(candidate.prior);
            row.onpointerenter = () => { state.hover = candidate.move; updatePreview(); };
            row.onpointerleave = () => { state.hover = null; updatePreview(); };
            button.onfocus = () => { state.hover = candidate.move; updatePreview(); };
            button.onblur = () => { state.hover = null; updatePreview(); };
        }
    }
    function updatePreview() {
        const candidate = previewCandidate();
        $('hover-coord').textContent = state.hover !== null ? coord(state.hover) : '15 × 15 · 自由五子棋';
        $('pv-label').textContent = candidate ? '主要变化 · ' + coord(candidate.move) + (state.pinned !== null ? ' · 已锁定' : '') : '主要变化 · 推荐落点';
        const pv = candidate || analysis()?.candidates?.[0];
        $('pv').replaceChildren(...(pv?.pv?.map((move, i) => { const el = document.createElement('span'); el.textContent = (i + 1) + ' ' + coord(move); return el; }) || [document.createTextNode('尚无搜索变化')]));
        for (const row of $('candidates').rows) row.classList.toggle('selected', Number(row.dataset.move) === (state.pinned ?? state.hover));
        draw();
    }
    function renderRecord() {
        $('record-count').textContent = state.moves.length + ' 手';
        const list = $('move-list'); list.replaceChildren();
        state.moves.forEach((move, index) => {
            const button = document.createElement('button'); button.textContent = (index + 1) + ' ' + coord(move);
            button.className = index + 1 === state.cursor ? 'current' : index >= state.cursor ? 'future' : '';
            button.onclick = () => navigate(index + 1); list.append(button);
        });
        if (!state.moves.length) list.textContent = '从一张空棋盘开始。';
    }
    function renderChart() {
        const ns = 'http://www.w3.org/2000/svg', svg = $('chart'); svg.replaceChildren();
        const el = (name, attrs) => { const e = document.createElementNS(ns, name); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); svg.append(e); return e; };
        el('path', {d: 'M0 45 H320', stroke: getComputedStyle(document.body).getPropertyValue('--rule').trim(), 'stroke-dasharray': '3 4'});
        const total = Math.max(1, state.moves.length);
        let count = 0, previous = null;
        for (let i = 0; i <= state.moves.length; i++) {
            const a = state.analysis.get(state.moves.slice(0, i).join(','));
            const score = a?.candidates?.[0]?.score;
            if (score === null || score === undefined) { previous = null; continue; }
            const blackScore = i % 2 ? 1 - score : score, x = 8 + i / total * 304, y = 78 - blackScore * 66;
            if (previous) el('path', {d: `M${previous.x} ${previous.y} L${x} ${y}`, fill: 'none', stroke: '#7d9a62', 'stroke-width': 2});
            const dot = el('circle', {cx: x, cy: y, r: i === state.cursor ? 4 : 3, fill: i === state.cursor ? '#d4472c' : '#7d9a62', tabindex: 0, role: 'button', 'aria-label': '第 ' + i + ' 手，黑棋得分 ' + pct(blackScore)});
            const title = document.createElementNS(ns, 'title'); title.textContent = '第 ' + i + ' 手 · 黑棋 ' + pct(blackScore); dot.append(title);
            dot.onclick = () => navigate(i); dot.onkeydown = e => { if (e.key === 'Enter') navigate(i); };
            previous = {x, y}; count++;
        }
        $('chart-caption').textContent = count ? '已分析 ' + count + ' 个局面 · 点击得分点回看。' : '分析后记录得分；未分析的手数留空。';
    }
    // Board is drawn in logical pixels; the backing store follows device scale.
    const woodTexture = new Image();
    woodTexture.onload = () => draw();
    woodTexture.src = 'img/background.bmp';
    let boardSize = 700;
    function geometry() { return {pad: boardSize * .068, step: boardSize * .864 / 14}; }
    function point(move) { const {pad, step} = geometry(); return [pad + mapping.forward[move] % 15 * step, pad + Math.floor(mapping.forward[move] / 15) * step]; }
    function stone(move, side, label, ghost = false) {
        const [x, y] = point(move), radius = geometry().step * .445;
        ctx.save(); ctx.globalAlpha = ghost ? .82 : 1;
        ctx.shadowColor = '#0005'; ctx.shadowBlur = radius * .18; ctx.shadowOffsetY = radius * .12;
        const gradient = ctx.createRadialGradient(x - radius * .3, y - radius * .35, 0, x, y, radius);
        gradient.addColorStop(0, side === 1 ? '#54565a' : '#fffef9'); gradient.addColorStop(1, side === 1 ? '#08090a' : '#d3ccbe');
        ctx.fillStyle = gradient; ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.fill(); ctx.shadowColor = 'transparent';
        if (ghost) { ctx.strokeStyle = '#d4472c'; ctx.lineWidth = 1.5; ctx.stroke(); }
        if (label) { ctx.fillStyle = side === 1 ? '#f7efe0' : '#25211c'; ctx.font = `600 ${radius * .78}px ${'system-ui'}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(label, x, y + .5); }
        ctx.restore();
    }
    function draw() {
        const p = current(), {pad, step} = geometry(), slate = $('theme').value === 'slate';
        if (!slate && woodTexture.complete && woodTexture.naturalWidth) {
            // Crop to a square without stretching the supplied grain.
            const side = Math.min(woodTexture.naturalWidth, woodTexture.naturalHeight);
            const x = (woodTexture.naturalWidth - side) / 2;
            const y = (woodTexture.naturalHeight - side) / 2;
            ctx.drawImage(woodTexture, x, y, side, side, 0, 0, boardSize, boardSize);
        } else {
            ctx.fillStyle = slate ? '#2d3033' : '#e1c699';
            ctx.fillRect(0, 0, boardSize, boardSize);
        }
        ctx.strokeStyle = slate ? '#ece6da70' : '#493318b3'; ctx.lineWidth = .8;
        for (let i = 0; i < 15; i++) {
            ctx.beginPath(); ctx.moveTo(pad, pad + i * step); ctx.lineTo(boardSize - pad, pad + i * step); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(pad + i * step, pad); ctx.lineTo(pad + i * step, boardSize - pad); ctx.stroke();
        }
        ctx.fillStyle = slate ? '#cec4b5' : '#54391d'; ctx.font = `${Math.max(9, step * .24)}px ui-monospace`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        for (let i = 0; i < 15; i++) {
            ctx.fillText(String.fromCharCode(65 + i), pad + i * step, pad * .42);
            ctx.fillText(String.fromCharCode(65 + i), pad + i * step, boardSize - pad * .4);
            ctx.fillText(15 - i, pad * .4, pad + i * step); ctx.fillText(15 - i, boardSize - pad * .4, pad + i * step);
        }
        for (const [r, c] of [[3, 3], [3, 11], [7, 7], [11, 3], [11, 11]]) {
            ctx.beginPath(); ctx.arc(pad + c * step, pad + r * step, step * .07, 0, Math.PI * 2); ctx.fill();
        }
        state.moves.slice(0, state.cursor).forEach((move, i) => stone(move, i % 2 ? -1 : 1, $('show-numbers').checked ? String(i + 1) : ''));
        if (state.cursor) {
            const [x, y] = point(state.moves[state.cursor - 1]); ctx.strokeStyle = '#d4472c'; ctx.lineWidth = 2;
            ctx.strokeRect(x - step * .18, y - step * .18, step * .36, step * .36);
        }
        const preview = previewCandidate();
        if (preview) {
            const occupied = p.board.slice();
            preview.pv.forEach((move, i) => { if (!occupied[move]) { stone(move, i % 2 ? -p.side : p.side, String(i + 1), true); occupied[move] = 1; } });
        } else if ($('show-analysis').checked) {
            const candidates = analysis()?.candidates || [], max = Math.max(1, ...candidates.map(c => c.visits));
            candidates.forEach((c, i) => {
                if (p.board[c.move]) return;
                const [x, y] = point(c.move), radius = step * (.30 + .15 * Math.sqrt(c.visits / max));
                ctx.fillStyle = color(c.score); ctx.globalAlpha = c.visits || c.solved !== null ? .94 : .6;
                ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1;
                if (!i) { ctx.strokeStyle = '#fff4db'; ctx.lineWidth = 2; ctx.stroke(); }
                ctx.fillStyle = '#fff9ee'; ctx.font = `600 ${step * .24}px system-ui`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                const compact = c.visits >= 1000 ? (c.visits / 1000).toFixed(1) + 'k' : String(c.visits);
                ctx.font = `600 ${Math.max(8, step * .24)}px system-ui`;
                ctx.fillText(compact, x, y - (step < 30 ? 0 : step * .075));
                if (step >= 30) {
                    ctx.font = `${step * .19}px system-ui`;
                    ctx.fillText(c.solved === 1 ? '已胜' : c.solved === -1 ? '已败' : pct(c.score), x, y + step * .17);
                }
            });
        }
        const focus = state.focus ?? state.hover;
        if (focus !== null && !preview && !p.board[focus]) {
            const [x, y] = point(focus); ctx.strokeStyle = slate ? '#ece6da' : '#674420'; ctx.lineWidth = 1.5;
            ctx.strokeRect(x - step * .36, y - step * .36, step * .72, step * .72);
        }
    }
    function resize() {
        const rect = canvas.getBoundingClientRect(), ratio = Math.min(window.devicePixelRatio || 1, 3);
        boardSize = rect.width; canvas.width = Math.round(boardSize * ratio); canvas.height = Math.round(boardSize * ratio);
        ctx.setTransform(ratio, 0, 0, ratio, 0, 0); draw();
    }
    function hit(event) {
        const rect = canvas.getBoundingClientRect(), {pad, step} = geometry();
        const x = event.clientX - rect.left, y = event.clientY - rect.top;
        const c = Math.round((x - pad) / step), r = Math.round((y - pad) / step);
        if (r < 0 || r > 14 || c < 0 || c > 14 || Math.abs(x - pad - c * step) > step * .48 || Math.abs(y - pad - r * step) > step * .48) return null;
        return mapping.inverse[r * 15 + c];
    }
    canvas.onpointermove = event => { const move = hit(event); if (state.hover !== move) { state.hover = move; updatePreview(); } };
    canvas.onpointerleave = () => { state.hover = null; updatePreview(); };
    canvas.onclick = event => { const move = hit(event); if (move !== null) { state.focus = null; play(move); } };
    canvas.onkeydown = event => {
        const delta = {ArrowLeft: -1, ArrowRight: 1, ArrowUp: -15, ArrowDown: 15}[event.key];
        if (delta) { event.preventDefault(); event.stopPropagation(); const move = mapping.forward[state.focus ?? 112];
            const r = Math.floor(move / 15), c = move % 15;
            const screen = Math.max(0, Math.min(14, r + (delta === -15 ? -1 : delta === 15 ? 1 : 0))) * 15 + Math.max(0, Math.min(14, c + (delta === -1 ? -1 : delta === 1 ? 1 : 0))); state.focus = mapping.inverse[screen]; draw();
        } else if (event.key === 'Enter') { event.preventDefault(); play(state.focus ?? 112); }
    };
    canvas.onblur = () => { state.focus = null; draw(); };
    $('nav-first').onclick = () => navigate(0); $('nav-prev').onclick = () => navigate(state.cursor - 1);
    $('nav-next').onclick = () => navigate(state.cursor + 1); $('nav-last').onclick = () => navigate(state.moves.length);
    $('nav-slider').oninput = event => navigate(Number(event.target.value));
    $('new-game').onclick = () => { cancel(); state.moves = []; state.cursor = 0; state.analysis.clear(); resetPreview(); notice(''); save(); render(); maybeAI(); };
    $('undo').onclick = () => {
        cancel(); resetPreview(); notice(''); const count = $('mode').value !== 'analysis' && !aiTurn() && state.cursor === state.moves.length ? 2 : 1;
        state.moves = state.moves.slice(0, Math.max(0, state.cursor - count)); state.cursor = state.moves.length;
        save(); render();
    };
    $('branch').onclick = () => { cancel(); state.moves = state.moves.slice(0, state.cursor); resetPreview(); save(); render(); maybeAI(); };
    $('analyze').onclick = () => begin('analysis');
    $('stop').onclick = () => { cancel(false); render(); };
    $('play-best').onclick = () => { const move = analysis()?.candidates?.[0]?.move; if (move !== undefined) play(move, true); };
    $('clear-preview').onclick = () => { resetPreview(); renderAnalysis(analysis()); draw(); };
    $('mode').onchange = () => { cancel(); save(); render(); maybeAI(); };
    for (const id of ['theme', 'show-analysis', 'show-numbers']) $(id).onchange = draw;
    function applyUI(theme) {
        const light = theme === 'light';
        document.body.dataset.ui = light ? 'light' : 'dark';
        $('ui-toggle').innerHTML = light
            ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 15a9 9 0 0 1-11-11 9 9 0 1 0 11 11Z"/></svg>'
            : '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M5 19l1.5-1.5M17.5 6.5L19 5"/></svg>';
        $('ui-toggle').setAttribute('aria-pressed', String(light));
        $('ui-toggle').setAttribute('aria-label', light ? '切换深色主题' : '切换浅色主题');
        $('ui-toggle').title = light ? '切换深色主题' : '切换浅色主题';
        document.querySelector('meta[name="theme-color"]').content = light ? '#f3faf6' : '#141210';
        renderChart();
    }
    try { applyUI(localStorage.getItem('nolos-zero-ui') || (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')); }
    catch (_) { applyUI('dark'); }
    $('ui-toggle').onclick = () => {
        const theme = document.body.dataset.ui === 'light' ? 'dark' : 'light';
        applyUI(theme);
        try { localStorage.setItem('nolos-zero-ui', theme); } catch (_) {}
    };
    function updateView() {
        mapping = viewMaps(view);
        state.hover = null; state.focus = null;
        $('flip-horizontal').setAttribute('aria-pressed', String(view.hflip));
        $('flip-vertical').setAttribute('aria-pressed', String(view.vflip));
        const parts = [view.rot ? '右转 ' + view.rot * 90 + '°' : '', view.hflip ? '水平翻转' : '', view.vflip ? '垂直翻转' : ''].filter(Boolean);
        $('view-state').textContent = parts.length ? parts.join(' · ') : '原始视角';
        save(); render();
    }
    $('rotate-ccw').onclick = () => { view.rot = (view.rot + 3) % 4; [view.hflip, view.vflip] = [view.vflip, view.hflip]; updateView(); };
    $('rotate-cw').onclick = () => { view.rot = (view.rot + 1) % 4; [view.hflip, view.vflip] = [view.vflip, view.hflip]; updateView(); };
    $('flip-horizontal').onclick = () => { view.hflip = !view.hflip; updateView(); };
    $('flip-vertical').onclick = () => { view.vflip = !view.vflip; updateView(); };
    $('reset-view').onclick = () => { Object.assign(view, {rot: 0, hflip: false, vflip: false}); updateView(); };
    $('help-open').onclick = () => $('help-dialog').showModal();
    function download(blob, name) { const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
    $('export-record').onclick = () => download(new Blob([state.moves.map(move => coord(move).toLowerCase()).join('') + '\n'], {type: 'text/plain;charset=utf-8'}), 'nolos-zero.txt');
    $('copy-record').onclick = async () => {
        const text = state.moves.slice(0, state.cursor).map(move => coord(move).toLowerCase()).join(''); $('record-input').value = text;
        try { await navigator.clipboard.writeText(text); notice('当前棋谱已复制。'); } catch (_) { notice('当前棋谱已填入文本框，可手动复制。'); }
    };
    $('import-record').onclick = () => {
        try {
            const moves = parse($('record-input').value).map(move => mapping.inverse[move]); position(moves);
            cancel(); state.moves = moves; state.cursor = moves.length; state.analysis.clear(); resetPreview(); notice('');
            $('mode').value = 'analysis'; save(); render();
        } catch (error) { notice(error.message); }
    };
    $('export-png').onclick = () => canvas.toBlob(blob => { if (blob) download(blob, 'nolos-zero.png'); });
    document.addEventListener('keydown', event => {
        if ($('help-dialog').open || ['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON'].includes(event.target.tagName)) return;
        if (event.key === 'Escape') { cancel(false); resetPreview(); render(); }
        const cursor = {ArrowLeft: state.cursor - 1, ArrowRight: state.cursor + 1, Home: 0, End: state.moves.length}[event.key];
        if (cursor !== undefined) { event.preventDefault(); navigate(cursor); }
    });
    try {
        const saved = JSON.parse(localStorage.getItem('nolos-zero-game-v1'));
        if (saved && Array.isArray(saved.moves) && saved.moves.length <= 225) {
            position(saved.moves);
            if (saved.view && Number.isInteger(saved.view.rot) && saved.view.rot >= 0 && saved.view.rot < 4) {
                Object.assign(view, {rot: saved.view.rot, hflip: Boolean(saved.view.hflip), vflip: Boolean(saved.view.vflip)});
                mapping = viewMaps(view);
            }
            state.moves = saved.moves; state.cursor = Math.max(0, Math.min(saved.moves.length, Number.isInteger(saved.cursor) ? saved.cursor : saved.moves.length));
            if (['black', 'white', 'analysis'].includes(saved.mode)) $('mode').value = saved.mode;
        }
    } catch (_) {}
    new ResizeObserver(resize).observe(canvas);
    updateView(); resize(); loadModel().catch(error => { notice(error.message); $('engine-status').textContent = '加载失败 · 刷新重试'; });
})();
