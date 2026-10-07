/* Freestyle Gomoku, network input/value always from the side to move. */
(function (scope) {
    'use strict';
    const SIZE = 15, CELLS = SIZE * SIZE;
    const DIRECTIONS = [[1, 0], [0, 1], [1, 1], [1, -1]];
    const now = () => performance.now();
    function legal(board) {
        const moves = [];
        for (let i = 0; i < CELLS; i++) if (!board[i]) moves.push(i);
        return moves;
    }
    function wins(board, move, player) {
        const r = Math.floor(move / SIZE), c = move % SIZE;
        return DIRECTIONS.some(([dr, dc]) => {
            let count = 1;
            for (const sign of [-1, 1]) {
                let x = r + dr * sign, y = c + dc * sign;
                while (x >= 0 && x < SIZE && y >= 0 && y < SIZE && board[x * SIZE + y] === player) {
                    count++; x += dr * sign; y += dc * sign;
                }
            }
            return count >= 5;
        });
    }
    function winningMoves(board, player, moves = legal(board)) {
        return moves.filter(move => wins(board, move, player));
    }
    function play(board, move) {
        const next = Float32Array.from(board, x => -x);
        next[move] = -1;
        return next;
    }
    function nearby(board, moves) {
        if (!board.some(x => x !== 0)) return [112];
        return moves.filter(move => {
            const r = Math.floor(move / SIZE), c = move % SIZE;
            for (let x = Math.max(0, r - 2); x <= Math.min(14, r + 2); x++)
                for (let y = Math.max(0, c - 2); y <= Math.min(14, c + 2); y++)
                    if (board[x * SIZE + y]) return true;
            return false;
        });
    }
    // Only prove wins through forcing fours. Budget exhaustion means unknown.
    function solveFours(board, player, depth, budget) {
        if (++budget.nodes > budget.limit || now() >= budget.deadline) return null;
        const moves = legal(board), own = winningMoves(board, player, moves);
        if (own.length) return own[0];
        if (depth <= 0) return null;
        const threats = winningMoves(board, -player, moves);
        if (threats.length > 1) return null;
        const candidates = threats.length ? threats : nearby(board, moves);
        for (const move of candidates) {
            board[move] = player;
            const fours = winningMoves(board, player);
            let proven = false;
            if (fours.length && !winningMoves(board, -player).length) {
                if (fours.length > 1) proven = true;
                else {
                    const reply = fours[0];
                    board[reply] = -player;
                    proven = solveFours(board, player, depth - 1, budget) !== null;
                    board[reply] = 0;
                }
            }
            board[move] = 0;
            if (proven) return move;
            if (budget.nodes > budget.limit || now() >= budget.deadline) break;
        }
        return null;
    }
    // Local five-cell windows rank forcing moves and blocks without ONNX calls.
    function urgency(board, move) {
        const r = Math.floor(move / SIZE), c = move % SIZE;
        const attack = [0, 1, 6, 50, 600], defend = [0, 1, 5, 45, 550];
        let score = 0;
        for (const [dr, dc] of DIRECTIONS) for (let offset = -4; offset <= 0; offset++) {
            const x = r + offset * dr, y = c + offset * dc;
            const ex = x + 4 * dr, ey = y + 4 * dc;
            if (x < 0 || x >= SIZE || y < 0 || y >= SIZE || ex < 0 || ex >= SIZE || ey < 0 || ey >= SIZE) continue;
            let own = 0, opponent = 0;
            for (let i = 0; i < 5; i++) {
                const value = board[(x + i * dr) * SIZE + y + i * dc];
                if (value === 1) own++; else if (value === -1) opponent++;
            }
            if (!opponent) score += attack[own];
            if (!own) score += defend[opponent];
        }
        return score + 0.001 / (1 + Math.abs(r - 7) + Math.abs(c - 7));
    }
    function resistance(board, moves) {
        return [...moves].sort((a, b) => urgency(board, b) - urgency(board, a) ||
            (Math.abs(Math.floor(a / SIZE) - 7) + Math.abs(a % SIZE - 7)) -
            (Math.abs(Math.floor(b / SIZE) - 7) + Math.abs(b % SIZE - 7)))[0];
    }
    function node(board, prior = 1, move = null) {
        return {board, prior, move, visits: 0, sum: 0, value: 0, children: null, solved: null, proofDepth: null, urgency: 0};
    }
    class Search {
        constructor(evaluate) {
            this.evaluate = evaluate;
            this.cache = new Map();
            this.root = null;
        }
        key(board) { return Array.from(board, x => x + 1).join(''); }
        resisting(root) {
            const explored = (root.children || []).filter(c => c.visits || c.solved !== null);
            return explored.length >= 2 && explored.some(c => c.solved === 1) &&
                explored.every(c => (c.solved !== null ? -c.solved : -c.sum / c.visits) <= -0.95);
        }
        ranked(children, resist = false) {
            const rank = c => c.solved === -1 ? 2 : c.solved === 1 ? 0 : 1;
            return [...(children || [])].sort((a, b) => {
                if (resist) {
                    const explored = c => Boolean(c.visits || c.solved !== null);
                    return Number(explored(b)) - Number(explored(a)) ||
                        (b.solved === 1 ? b.proofDepth : 0) - (a.solved === 1 ? a.proofDepth : 0) ||
                        b.urgency - a.urgency || b.prior - a.prior || b.visits - a.visits;
                }
                return rank(b) - rank(a) ||
                    (a.solved === 1 && b.solved === 1 ? (b.proofDepth ?? 0) - (a.proofDepth ?? 0) || b.urgency - a.urgency || b.prior - a.prior : 0) ||
                    b.visits - a.visits || b.prior - a.prior || b.urgency - a.urgency;
            });
        }
        snapshot(root, limit = 12) {
            const candidates = this.ranked(root.children, this.resisting(root)).filter((child, index) => index === 0 || child.visits > 0 || child.prior >= 0.001 || child.solved !== null).slice(0, limit).map(child => {
                const pv = [child.move];
                let current = child;
                for (let depth = 1; depth < 16; depth++) {
                    const next = this.ranked(current.children)[0];
                    if (!next || (!next.visits && next.solved === null)) break;
                    pv.push(next.move); current = next;
                }
                const value = child.solved !== null ? -child.solved : child.visits ? -child.sum / child.visits : null;
                return {move: child.move, visits: child.visits, prior: child.prior, value,
                    score: value === null ? null : (value + 1) / 2, solved: child.solved === null ? null : -child.solved, proofDepth: child.proofDepth === null ? null : child.proofDepth + 1, pv};
            });
            return {candidates, rootVisits: root.visits, rootValue: root.solved ?? (root.visits ? root.sum / root.visits : null)};
        }
        async run(input, options = {}) {
            const settings = {timeMs: 3000, maxEvaluations: 160, maxSimulations: 4000,
                cpuct: 1.5, tacticalNodes: 1500, tacticalDepth: 8, ...options};
            if (settings.continuous) {
                settings.timeMs = Infinity;
                settings.maxEvaluations = Infinity;
                settings.maxSimulations = Infinity;
            }
            const start = now(), deadline = start + settings.timeMs;
            let expandedSinceCompaction = 0;
            const stats = {evaluations: 0, cacheHits: 0, simulations: 0, tacticalNodes: 0};
            const board = Float32Array.from(input), moves = legal(board);
            const finish = (move, reason) => ({move, reason, ...stats, elapsedMs: now() - start});
            if (!moves.length) return finish(null, 'draw');
            const own = winningMoves(board, 1, moves);
            if (own.length) return {...finish(own[0], 'win'), candidates: own.map(move => ({move, visits: 0, prior: null, value: 1, score: 1, solved: 1, pv: [move]})), rootVisits: 0, rootValue: 1};
            const threats = winningMoves(board, -1, moves);
            if (threats.length === 1 && !settings.analysis) return {...finish(threats[0], 'block'), candidates: [{move: threats[0], visits: 0, prior: null, value: null, score: null, solved: null, pv: [threats[0]]}], rootVisits: 0, rootValue: null};
            if (threats.length > 1) return {...finish(resistance(board, threats), 'proven-loss'),
                candidates: [...threats].sort((a, b) => urgency(board, b) - urgency(board, a)).map(move => ({move, visits: 0, prior: null, value: -1, score: 0,
                    solved: -1, pv: [move, threats.find(reply => reply !== move)]})), rootVisits: 0, rootValue: -1};
            const budget = {nodes: 0, limit: settings.tacticalNodes,
                deadline: Math.min(deadline, start + Math.min(450, settings.timeMs * 0.15))};
            const forced = solveFours(board, 1, settings.tacticalDepth, budget);
            stats.tacticalNodes = budget.nodes;
            if (forced !== null) return {...finish(forced, 'forcing-four'), candidates: [{move: forced, visits: 0, prior: null, value: 1, score: 1, solved: 1, pv: [forced]}], rootVisits: 0, rootValue: 1};
            // Keep statistics on the actual played branch, including the human reply.
            const key = this.key(board);
            let root = null;
            const find = (n, depth) => {
                if (!n || !n.board) return;
                if (this.key(n.board) === key) { root = n; return; }
                if (depth && n.children) for (const child of n.children) find(child, depth - 1);
            };
            find(this.root, 2);
            this.root = root || node(board);
            root = this.root;
            const expand = async n => {
                expandedSinceCompaction++;
                const actions = legal(n.board);
                if (!actions.length) { n.solved = 0; n.proofDepth = 0; n.children = []; return 0; }
                const winsNow = winningMoves(n.board, 1, actions);
                if (winsNow.length) {
                    n.solved = 1; n.proofDepth = 1;
                    n.children = winsNow.map(move => {
                        const child = node(play(n.board, move), 1 / winsNow.length, move);
                        child.solved = -1; child.proofDepth = 0; child.children = []; return child;
                    });
                    return 1;
                }
                const blocks = winningMoves(n.board, -1, actions);
                if (blocks.length > 1) { n.solved = -1; n.proofDepth = 2; n.children = []; return -1; }
                const positionKey = this.key(n.board);
                let prediction = this.cache.get(positionKey);
                if (prediction) stats.cacheHits++;
                else {
                    prediction = await this.evaluate(n.board);
                    stats.evaluations++;
                    prediction = {policy: Float32Array.from(prediction.policy), value: Number(prediction.value[0] ?? prediction.value)};
                    if (prediction.policy.length !== CELLS || !Number.isFinite(prediction.value))
                        throw new Error('Invalid policy/value model output');
                    if (this.cache.size >= 4096) this.cache.delete(this.cache.keys().next().value);
                    this.cache.set(positionKey, prediction);
                }
                n.value = Math.max(-1, Math.min(1, prediction.value));
                // Keep every legal move; the 2% tactical prior retains a nonzero exploration floor.
                const candidates = blocks.length ? blocks : actions;
                const priors = candidates.map(move => Math.max(0, Number(prediction.policy[move]) || 0));
                const total = priors.reduce((a, b) => a + b, 0);
                const urgencies = candidates.map(move => urgency(n.board, move));
                const urgencyTotal = urgencies.reduce((a, b) => a + b + 1, 0);
                n.children = candidates.map((move, i) => {
                    const child = node(null,
                        0.98 * (total ? priors[i] / total : 1 / candidates.length) + 0.02 * (urgencies[i] + 1) / urgencyTotal, move);
                    child.urgency = urgencies[i];
                    return child;
                });
                return n.value;
            };
            while (stats.simulations < settings.maxSimulations && stats.evaluations < settings.maxEvaluations && now() < deadline && !settings.shouldStop?.()) {
                const path = [root];
                let n = root;
                while (n.children && n.children.length && n.solved === null) {
                    let best = null, score = -Infinity;
                    const avoidLoss = n.children.some(child => child.solved !== 1);
                    for (const child of n.children) {
                        if (avoidLoss && child.solved === 1) continue;
                        const q = child.solved !== null ? -child.solved : child.visits ? -child.sum / child.visits : Math.max(-1, n.value - 0.2);
                        const u = settings.cpuct * child.prior * Math.sqrt(n.visits + 1) / (1 + child.visits);
                        const s = q + u;
                        if (s > score) { score = s; best = child; }
                    }
                    if (!best.board) best.board = play(n.board, best.move);
                    n = best; path.push(n);
                }
                let value = n.solved !== null ? n.solved : await expand(n);
                for (let i = path.length - 1; i >= 0; i--) {
                    const current = path[i];
                    current.visits++; current.sum += value;
                    if (current.children && current.children.length) {
                        if (current.children.some(c => c.solved === -1)) {
                            current.solved = 1;
                            current.proofDepth = 1 + Math.min(...current.children.filter(c => c.solved === -1).map(c => c.proofDepth));
                        } else if (current.children.every(c => c.solved !== null)) {
                            current.solved = Math.max(...current.children.map(c => -c.solved));
                            current.proofDepth = 1 + Math.max(...current.children.map(c => c.proofDepth));
                        }
                    }
                    value = current.solved !== null ? -current.solved : -value;
                }
                stats.simulations++;
                if (root.solved !== null) break;
                // Bound long-running analysis memory; preserve root statistics and proofs.
                if (settings.continuous && expandedSinceCompaction >= (settings.treeExpansionLimit ?? 2048)) {
                    const keepProofPV = (n, depth) => {
                        if (!n.children) return;
                        n.children = depth ? this.ranked(n.children).slice(0, 1) : [];
                        for (const child of n.children) keepProofPV(child, depth - 1);
                    };
                    for (const child of root.children || []) {
                        if (child.solved === null) child.children = null;
                        else keepProofPV(child, 16);
                    }
                    expandedSinceCompaction = 0;
                }
                if (stats.simulations % 8 === 0) {
                    if (settings.onProgress) settings.onProgress({...stats, elapsedMs: now() - start, ...this.snapshot(root)});
                    await new Promise(resolve => setTimeout(resolve, 0));
                }
            }
            const children = this.ranked(root.children, this.resisting(root));
            const best = children[0];
            return {...finish(best ? best.move : resistance(board, threats.length ? threats : moves), root.solved === 1 ? 'proven-win' : root.solved === -1 ? 'proven-loss' : this.resisting(root) ? 'resistance' : 'mcts'),
                ...this.snapshot(root), stopped: Boolean(settings.shouldStop?.()), visits: best?.visits || 0, value: best?.visits ? -best.sum / best.visits : null};
        }
    }
    scope.GomokuZero = {Search, legal, wins, winningMoves, play, solveFours, urgency};
    if (typeof module !== 'undefined') module.exports = scope.GomokuZero;
})(typeof globalThis !== 'undefined' ? globalThis : window);
