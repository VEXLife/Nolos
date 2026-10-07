(function(scope) {
    'use strict';
    const coord = move => String.fromCharCode(65 + move % 15) + (15 - Math.floor(move / 15));
    function parse(text) {
        const compact = text.replace(/[\s,;，；]+/g, '');
        const pattern = /([a-o])(1[0-5]|[1-9])/iy, moves = [];
        while (pattern.lastIndex < compact.length) {
            const offset = pattern.lastIndex, match = pattern.exec(compact);
            if (!match) throw new Error('无效坐标：' + compact.slice(offset, offset + 12));
            moves.push((15 - Number(match[2])) * 15 + match[1].toUpperCase().charCodeAt(0) - 65);
        }
        return moves;
    }
    function position(moves, count = moves.length) {
        const board = new Float32Array(225);
        let winner = 0;
        for (let i = 0; i < count; i++) {
            const move = moves[i];
            if (!Number.isInteger(move) || move < 0 || move >= 225 || board[move]) throw new Error('第 ' + (i + 1) + ' 手落点非法');
            if (winner) throw new Error('棋谱包含胜负已定后的落子');
            const side = i % 2 ? -1 : 1;
            board[move] = side;
            if (scope.GomokuZero.wins(board, move, side)) winner = side;
        }
        return {board, side: count % 2 ? -1 : 1, winner, ended: Boolean(winner) || count === 225};
    }
    function viewMaps({rot = 0, hflip = false, vflip = false} = {}) {
        const forward = new Uint16Array(225), inverse = new Uint16Array(225);
        for (let move = 0; move < 225; move++) {
            let r = Math.floor(move / 15), c = move % 15;
            for (let i = 0; i < ((rot % 4 + 4) % 4); i++) [r, c] = [c, 14 - r];
            if (hflip) c = 14 - c;
            if (vflip) r = 14 - r;
            forward[move] = r * 15 + c;
            inverse[forward[move]] = move;
        }
        return {forward, inverse};
    }
    scope.ZeroGame = {coord, parse, position, viewMaps};
    if (typeof module !== 'undefined') module.exports = scope.ZeroGame;
})(globalThis);
