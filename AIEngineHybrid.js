// AIEngineHybrid.js
//
// Hybrid Dots and Boxes AI: an exact endgame solver bolted onto a bitboard MCTS.
//
// Two complementary strategies:
//
// 1. EXACT ENDGAME SOLVER -- when 12 or fewer lines remain, the position is
//    solved perfectly with negamax + alpha-beta pruning + a transposition
//    table. No heuristics, no move pruning: takes, sacrifices, and chain
//    control all fall out of the search. This is where Dots and Boxes games
//    are decided, and it is also where "clever" pruning heuristics go wrong
//    (they hide real sacrifices), so the solver prunes nothing.
//
// 2. BITBOARD MCTS for the midgame -- the classic tree search, but the board
//    is two BigInts (no matrix cloning anywhere), rollouts use an
//    epsilon-greedy heuristic policy, and the thinking budget is time-based
//    so it adapts to the device it runs on, phones included.
//
// The engine never removes a legal move from consideration: every move stays
// in the tree, so genuine sacrifices are never blinded.

import AIEngineHeuristic from "./AIEngineHeuristic.js";

// When this many (or fewer) lines remain, solve the endgame exactly with
// negamax + alpha-beta + transposition table instead of running MCTS.
// Benchmarked (5x5, random positions): 12 empties ~110ms, 14 ~330ms,
// 16 ~850ms, 18 ~1500ms. Take-rich endgames solve much faster. Cost is
// highly position-dependent, not just a function of empty count: structured
// loony endgames fly (test 6: 27 empties ~510ms, 26 empties ~1260ms), while
// messy midgame positions blow the budget and fall back to MCTS via abort.
const SOLVER_MAX_MOVES = 27;   // at most this many empty lines -> solve exactly
const SOLVER_TIME_MS = 2000;   // solver time cap; falls back to MCTS on abort

function popcount(b) {
    let c = 0;
    while (b) { c++; b &= b - 1n; }
    return c;
}

// ---------------------------------------------------------------------------
// Bitboard board description (precomputed once per move() call)
// ---------------------------------------------------------------------------
function buildBoard(W, H) {
    const nH = W * (H + 1);          // horizontal lines
    const nV = (W + 1) * H;          // vertical lines
    const L = nH + nV;
    const hLineId = (i, j) => i * (H + 1) + j;       // i in [0,W), j in [0,H]
    const vLineId = (i, j) => nH + i * (W + 1) + j;  // i in [0,H), j in [0,W]
    // NOTE: vBits stores v-lines WITHOUT the nH offset (see fromMatrices),
    // so vMask must use offset-free positions too.
    const vBit = (i, j) => i * (W + 1) + j;
    const boxes = [];
    const lineBoxes = Array.from({ length: L }, () => []);
    for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
            const hMask = (1n << BigInt(hLineId(x, y))) | (1n << BigInt(hLineId(x, y + 1)));
            const vMask = (1n << BigInt(vBit(y, x))) | (1n << BigInt(vBit(y, x + 1)));
            const bi = boxes.length;
            boxes.push({ hMask, vMask });
            lineBoxes[hLineId(x, y)].push(bi);
            lineBoxes[hLineId(x, y + 1)].push(bi);
            lineBoxes[vLineId(y, x)].push(bi);
            lineBoxes[vLineId(y, x + 1)].push(bi);
        }
    }
    return { W, H, nH, nV, L, boxes, lineBoxes };
}

// Convert the DotGame (hLines, vLines) matrices to bitboards.
// h[i][j]: i in [0,W), j in [0,H]; v[i][j]: i in [0,H), j in [0,W].
function fromMatrices(b, h, v) {
    let hBits = 0n, vBits = 0n;
    for (let i = 0; i < b.W; i++) {
        for (let j = 0; j <= b.H; j++) {
            if (h[i][j]) hBits |= 1n << BigInt(i * (b.H + 1) + j);
        }
    }
    for (let i = 0; i < b.H; i++) {
        for (let j = 0; j <= b.W; j++) {
            if (v[i][j]) vBits |= 1n << BigInt(i * (b.W + 1) + j);
        }
    }
    return { hBits, vBits };
}

function boxSides(b, box, hBits, vBits) {
    return popcount(hBits & box.hMask) + popcount(vBits & box.vMask);
}

function emptyLines(b, hBits, vBits) {
    const ids = [];
    for (let id = 0; id < b.nH; id++) {
        if ((hBits & (1n << BigInt(id))) === 0n) ids.push(id);
    }
    for (let id = b.nH; id < b.L; id++) {
        if ((vBits & (1n << BigInt(id - b.nH))) === 0n) ids.push(id);
    }
    return ids;
}

// Number of boxes closed by playing lineId on (hBits, vBits). Pure: the
// bitboards are BigInts, so "mutation" here is local to these copies.
function boxesClosedBy(b, hBits, vBits, lineId) {
    let closed = 0;
    for (const bi of b.lineBoxes[lineId]) {
        if (boxSides(b, b.boxes[bi], hBits, vBits) === 4) closed++;
    }
    return closed;
}

function withLine(b, hBits, vBits, lineId) {
    if (lineId < b.nH) return { hBits: hBits | (1n << BigInt(lineId)), vBits };
    return { hBits, vBits: vBits | (1n << BigInt(lineId - b.nH)) };
}

function lineToString(b, id) {
    if (id < b.nH) {
        return 'h,' + Math.floor(id / (b.H + 1)) + ',' + (id % (b.H + 1));
    }
    const k = id - b.nH;
    return 'v,' + Math.floor(k / (b.W + 1)) + ',' + (k % (b.W + 1));
}

// ---------------------------------------------------------------------------
// Exact endgame solver: negamax + alpha-beta + transposition table.
// Returns the score difference (player-to-move minus opponent) over the
// boxes still unclaimed.
// ---------------------------------------------------------------------------
class SolverAbort extends Error {}

function solveRec(b, hBits, vBits, turn, alpha, beta, tt, deadline, counter) {
    if ((counter.n & 1023) === 0 && Date.now() > deadline) throw new SolverAbort();
    counter.n++;
    const key = hBits.toString(36) + '|' + vBits.toString(36) + '|' + turn;
    const cached = tt.get(key);
    if (cached !== undefined) return cached;

    const moves = emptyLines(b, hBits, vBits);
    if (moves.length === 0) return 0;

    // Takes first: improves alpha-beta cutoffs dramatically in endgames.
    const takes = [], rest = [];
    for (const m of moves) {
        let isTake = false;
        for (const bi of b.lineBoxes[m]) {
            if (boxSides(b, b.boxes[bi], hBits, vBits) === 3) { isTake = true; break; }
        }
        (isTake ? takes : rest).push(m);
    }

    let best = -Infinity;
    let pruned = false;
    for (const m of takes.concat(rest)) {
        const s = withLine(b, hBits, vBits, m);
        const closed = boxesClosedBy(b, s.hBits, s.vBits, m);
        let val;
        if (closed > 0) {
            // Extra turn: same player moves again, points just add up.
            val = closed + solveRec(b, s.hBits, s.vBits, turn, alpha, beta, tt, deadline, counter);
        } else {
            val = -solveRec(b, s.hBits, s.vBits, 1 - turn, -beta, -alpha, tt, deadline, counter);
        }
        if (val > best) best = val;
        if (best > alpha) alpha = best;
        if (alpha >= beta) { pruned = true; break; }
    }
    // Only cache when the search completed without pruning. A pruned
    // search returns a bound (true value >= best), not the exact value.
    // Storing bounds as exact corrupts later lookups (Test 9: the buggy
    // TT claimed only 1 of 5 chain moves was optimal; the correct solver
    // shows all 5 are optimal).
    // NOTE: This is still not a proof of exactness if a child's value came
    // from a TT bound, but the TT only stores non-pruned values, and the
    // root uses a fresh TT per move (see solveRoot), so bounds cannot leak
    // across root moves.
    if (!pruned) tt.set(key, best);
    return best;
}

function solveRoot(b, hBits, vBits, moves, deadline = Date.now() + SOLVER_TIME_MS) {
    const counter = { n: 0 };
    let bestMove = moves[0], bestVal = -Infinity;
    const takes = [], rest = [];
    for (const m of moves) {
        let isTake = false;
        for (const bi of b.lineBoxes[m]) {
            if (boxSides(b, b.boxes[bi], hBits, vBits) === 3) { isTake = true; break; }
        }
        (isTake ? takes : rest).push(m);
    }
    for (const m of takes.concat(rest)) {
        // Fresh TT per root move: sharing a TT across root moves lets
        // bounds from one move's search contaminate another's.
        const tt = new Map();
        const s = withLine(b, hBits, vBits, m);
        const closed = boxesClosedBy(b, s.hBits, s.vBits, m);
        const val = closed > 0
            ? closed + solveRec(b, s.hBits, s.vBits, 1, -Infinity, Infinity, tt, deadline, counter)
            : -solveRec(b, s.hBits, s.vBits, 0, -Infinity, Infinity, tt, deadline, counter);
        if (val > bestVal) { bestVal = val; bestMove = m; }
    }
    return bestMove;
}

// ---------------------------------------------------------------------------
// Rollout policy: takes first, then safe moves (ones that don't hand the
// opponent a box), otherwise random. Epsilon-greedy noise keeps blunders
// from collapsing into 0.00/1.00 extremes that drown the tree signal.
// ---------------------------------------------------------------------------
function pickRolloutIndex(b, empty, sides, epsilon) {
    if (Math.random() < epsilon) return (Math.random() * empty.length) | 0;
    let takeIdx = -1;
    let safeIdx = -1, safeCount = 0;
    for (let i = 0; i < empty.length; i++) {
        let isTake = false, isSafe = true;
        for (const bi of b.lineBoxes[empty[i]]) {
            const s = sides[bi];
            if (s === 3) { isTake = true; break; }
            if (s === 2) isSafe = false;
        }
        if (isTake) { takeIdx = i; break; }
        if (isSafe) { safeCount++; if (Math.random() < 1 / safeCount) safeIdx = i; }
    }
    if (takeIdx !== -1) return takeIdx;
    if (safeIdx !== -1) return safeIdx;
    return (Math.random() * empty.length) | 0;
}

// Convert bitboards to h/v matrices for the heuristic engine.
// h[i][j]: i in [0,W), j in [0,H]; v[i][j]: i in [0,H), j in [0,W].
// Values are 0 (empty) or 1 (drawn). The heuristic only cares about
// taken vs untaken, not who drew the line.
function toMatrices(b, hBits, vBits) {
    const h = [], v = [];
    for (let i = 0; i < b.W; i++) {
        h[i] = [];
        for (let j = 0; j <= b.H; j++) {
            h[i][j] = Number((hBits >> BigInt(i * (b.H + 1) + j)) & 1n);
        }
    }
    for (let i = 0; i < b.H; i++) {
        v[i] = [];
        for (let j = 0; j <= b.W; j++) {
            v[i][j] = Number((vBits >> BigInt(i * (b.W + 1) + j)) & 1n);
        }
    }
    return { h, v };
}

// Heuristic rollout: play to the end using AIEngineHeuristic for every move.
// Converts bitboards to matrices once, then runs the heuristic on matrices
// for the whole rollout. Returns boxes closed by the AI (turn === 1).
// Slower than the dumb rollout (~0.11ms/move) but plays real strategy.
// Epsilon-greedy: with probability epsilon, pick a random move instead of
// the heuristic move. This adds rollout diversity — pure heuristic rollouts
// are too deterministic, which hurts MCTS value estimates.
function rolloutHeuristic(b, hBits, vBits, turn, heuristic, epsilon) {
    const { h, v } = toMatrices(b, hBits, vBits);
    const W = b.W, H = b.H;
    // squares[i][j]: side count for box (i,j). i in [0,H), j in [0,W).
    const squares = [];
    for (let i = 0; i < H; i++) {
        squares[i] = [];
        for (let j = 0; j < W; j++) {
            squares[i][j] = (h[j][i] ? 1 : 0) + (h[j][i + 1] ? 1 : 0) +
                            (v[i][j] ? 1 : 0) + (v[i][j + 1] ? 1 : 0);
        }
    }
    let aiBoxes = 0, cur = turn;
    let movesLeft = 0;
    for (let i = 0; i < W; i++) for (let j = 0; j <= H; j++) if (!h[i][j]) movesLeft++;
    for (let i = 0; i < H; i++) for (let j = 0; j <= W; j++) if (!v[i][j]) movesLeft++;
    while (movesLeft > 0) {
        let m;
        if (Math.random() < epsilon) {
            // Random move: pick a random empty line.
            let idx = (Math.random() * movesLeft) | 0;
            for (let i = 0; i < W && idx >= 0; i++) {
                for (let j = 0; j <= H; j++) {
                    if (!h[i][j]) {
                        if (idx-- === 0) { m = ["h", i, j]; break; }
                    }
                }
                if (m) break;
            }
            if (!m) {
                for (let i = 0; i < H && idx >= 0; i++) {
                    for (let j = 0; j <= W; j++) {
                        if (!v[i][j]) {
                            if (idx-- === 0) { m = ["v", i, j]; break; }
                        }
                    }
                    if (m) break;
                }
            }
        } else {
            m = heuristic.chooseMove(h, v);
        }
        const [type, a, c] = m;
        let closed = 0;
        if (type === "h") {
            h[a][c] = 1;
            movesLeft--;
            // boxes (c-1, a) and (c, a)
            if (c - 1 >= 0 && ++squares[c - 1][a] === 4) closed++;
            if (c < H && ++squares[c][a] === 4) closed++;
        } else {
            v[a][c] = 1;
            movesLeft--;
            // boxes (a, c-1) and (a, c)
            if (c - 1 >= 0 && ++squares[a][c - 1] === 4) closed++;
            if (c < W && ++squares[a][c] === 4) closed++;
        }
        if (cur === 1) aiBoxes += closed;
        if (closed === 0) cur = 1 - cur;
    }
    return aiBoxes;
}

// Plays to the end from (hBits, vBits) with `turn` to move. Returns the
// number of boxes the AI (turn === 1) closes during the rollout.
function rollout(b, hBits, vBits, turn, epsilon) {
    const sides = new Uint8Array(b.boxes.length);
    for (let bi = 0; bi < sides.length; bi++) {
        sides[bi] = boxSides(b, b.boxes[bi], hBits, vBits);
    }
    const empty = emptyLines(b, hBits, vBits);
    let aiBoxes = 0, cur = turn;
    while (empty.length > 0) {
        const idx = pickRolloutIndex(b, empty, sides, epsilon);
        const lineId = empty[idx];
        empty[idx] = empty[empty.length - 1];
        empty.pop();
        if (lineId < b.nH) hBits |= 1n << BigInt(lineId);
        else vBits |= 1n << BigInt(lineId - b.nH);
        let closed = 0;
        for (const bi of b.lineBoxes[lineId]) {
            if (++sides[bi] === 4) closed++;
        }
        if (cur === 1) aiBoxes += closed;
        if (closed === 0) cur = 1 - cur;
    }
    return aiBoxes;
}

// ---------------------------------------------------------------------------
// MCTS
// ---------------------------------------------------------------------------
class MNode {
    constructor(b, hBits, vBits, turn, parent, move, aiSquares) {
        this.hBits = hBits;
        this.vBits = vBits;
        this.turn = turn;      // 1 = AI to move, 0 = opponent
        this.parent = parent;
        this.move = move;
        this.aiSquares = aiSquares;  // boxes the AI has closed along this path
        this.children = [];
        this.visits = 0;
        this.value = 0;        // sum of AI-box-fraction rewards
        this.untried = emptyLines(b, hBits, vBits);
    }
}

function selectChild(node) {
    const logN = Math.log(node.visits);
    let best = null, bestVal = -Infinity;
    for (const c of node.children) {
        let val;
        if (c.visits === 0) {
            val = Infinity;
        } else {
            // value is stored from the AI's perspective; at opponent nodes
            // the player to move wants to minimize it.
            let expl = c.value / c.visits;
            if (node.turn === 0) expl = 1 - expl;
            val = expl + Math.sqrt(2 * logN / c.visits);
        }
        if (val > bestVal) { bestVal = val; best = c; }
    }
    return best;
}

export default class AIEngineHybrid {
    constructor(options = {}) {
        this.epsilon = options.epsilon ?? 0.15;
        this.maxIterations = options.maxIterations ?? 500000;
        this.thinkMs = options.thinkMs ?? 1400;
        this.useHeuristicRollouts = !!options.useHeuristicRollouts;
        this.heuristic = new AIEngineHeuristic();
        this.lastIterations = 0;   // iterations used by the most recent move()
        this.lastExact = false;    // true if the exact solver (not MCTS) chose the move
        this.lastRootStats = null;
        this.debugStats = !!options.debugStats;
    }

    async move(h, v, squaresLeft) {
        const W = h.length, H = v.length;
        const b = buildBoard(W, H);
        let { hBits, vBits } = fromMatrices(b, h, v);
        const moves = emptyLines(b, hBits, vBits);

        if (moves.length === 1) return lineToString(b, moves[0]);

        // Single time budget for the whole move: the slider value is the
        // TOTAL thinking time, not per-phase. Solver gets up to 70% of it;
        // MCTS gets whatever remains (deadline is anchored to start, not
        // to the post-solver clock, so solver+MCTS never exceed thinkMs).
        const start = Date.now();
        const deadline = start + this.thinkMs;

        // 1) Exact endgame: few enough lines left to solve perfectly.
        // The solver gets most of the time budget; on abort we fall back
        // to MCTS with whatever time remains.
        if (moves.length <= SOLVER_MAX_MOVES) {
            const solverDeadline = start + Math.min(2000, this.thinkMs * 0.7);
            try {
                const mv = lineToString(b, solveRoot(b, hBits, vBits, moves, solverDeadline));
                this.lastExact = true;
                return mv;
            } catch (e) {
                if (!(e instanceof SolverAbort)) throw e;
                // Solver ran out of time; fall through to MCTS.
            }
        }

        // 2) Instant sensible opening on an empty board (all moves symmetric).
        if (moves.length === b.L) {
            const sides = new Uint8Array(b.boxes.length);
            const idx = pickRolloutIndex(b, moves.slice(), sides, 0);
            return lineToString(b, moves[idx]);
        }

        // 3) Bitboard MCTS with a time-based budget.
        const root = new MNode(b, hBits, vBits, 1, null, null, 0);
        let iters = 0;
        while (Date.now() < deadline && iters < this.maxIterations) {
            iters++;

            // Selection: descend while fully expanded.
            let node = root;
            while (node.untried.length === 0 && node.children.length > 0) {
                node = selectChild(node);
            }

            // Expansion: one child per iteration.
            if (node.untried.length > 0) {
                const pick = (Math.random() * node.untried.length) | 0;
                const lineId = node.untried.splice(pick, 1)[0];
                const s = withLine(b, node.hBits, node.vBits, lineId);
                const closed = boxesClosedBy(b, s.hBits, s.vBits, lineId);
                const childTurn = closed === 0 ? 1 - node.turn : node.turn;
                const childAi = node.aiSquares + (node.turn === 1 ? closed : 0);
                const child = new MNode(b, s.hBits, s.vBits, childTurn, node, lineId, childAi);
                node.children.push(child);
                node = child;
            }

            // Rollout + backpropagation.
            const gained = this.useHeuristicRollouts
                ? rolloutHeuristic(b, node.hBits, node.vBits, node.turn, this.heuristic, this.epsilon)
                : rollout(b, node.hBits, node.vBits, node.turn, this.epsilon);
            const reward = (node.aiSquares + gained) / squaresLeft;
            let n = node;
            while (n) { n.visits++; n.value += reward; n = n.parent; }
        }

        const best = root.children.reduce((a, c) => (c.visits > a.visits ? c : a));
        this.lastIterations = iters;
        this.lastExact = false;
        if (this.debugStats) {
            this.lastRootStats = root.children
                .map(c => ({ move: lineToString(b, c.move), visits: c.visits,
                             value: c.value / c.visits }))
                .sort((a, z) => z.visits - a.visits);
        }
        return lineToString(b, best.move);
    }
}

// Named exports for unit testing.
export { buildBoard, fromMatrices, emptyLines, lineToString, solveRoot, boxesClosedBy, SOLVER_MAX_MOVES };
