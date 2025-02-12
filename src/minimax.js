async function minimax(board_arr, action_space, depth, minimum, maximum, session, k, recurrent_fn, policy_value_fn) {
    const result = await policy_value_fn(board_arr, session);

    if (depth === 0) {
        return result.value[0]; // Assuming value is a scalar
    }

    const topKActions = Array.from(result.policy)
        .map((prob, index) => ({ index, prob }))
        .filter(({ index }) => action_space.includes(index))
        .filter(({ prob }) => prob > 1e-2)
        .sort((a, b) => b.prob - a.prob)
        .slice(0, k) // Assuming k is defined somewhere in your code

    for (const { index, prob } of topKActions) {
        next_state = recurrent_fn(board_arr, index);

        if (next_state.done) {
            return next_state.reward;
        }

        const score = await minimax(next_state.next_board, next_state.action_space, depth - 1, -maximum, -minimum, session, k, recurrent_fn, policy_value_fn);
        minimum = Math.max(minimum, -score);
        if (minimum >= maximum) { // Pruning
            break;
        }
    }

    return minimum;
}

// Function to find the best move using Minimax
async function findBestMove(board_arr, depth, session, k, recurrent_fn, policy_value_fn) {
    const action_space = recurrent_fn(board_arr, -1).action_space;
    let best_score = -Infinity;
    let best_move = null;

    const result = await policy_value_fn(board_arr, session);

    const topKActions = Array.from(result.policy)
        .map((prob, index) => ({ index, prob }))
        .filter(({ index }) => action_space.includes(index))
        .filter(({ prob }) => prob > 1e-2)
        .sort((a, b) => b.prob - a.prob)
        .slice(0, k) // Assuming k is defined somewhere in your code

    for (const { index, prob } of topKActions) {
        next_state = recurrent_fn(board_arr, index);

        if (next_state.done) {
            score = next_state.reward;
        } else {
            score = -await minimax(next_state.next_board, next_state.action_space, depth - 1, -Infinity, -best_score, session, k, recurrent_fn, policy_value_fn);
        }
        if (score > best_score) {
            best_score = score;
            best_move = index;
        }
    }

    return best_move;
}