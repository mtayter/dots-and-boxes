// AIEngineHybrid.js
//
// Hybrid Dots and Boxes AI: an exact endgame solver bolted onto a bitboard MCTS.
//
// Two complementary strategies:
//
// 1. EXACT ENDGAME SOLVER -- when 27 or fewer lines remain (SOLVER_MAX_MOVES), the position is
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
// MCTS-WITH-CUTOFF (component (c) of the engine cascade; OFF by default,
// see `mctsCutoff` in the constructor). ControlValue.js imports
// buildBoard/fromMatrices/emptyLines from this file, so this import closes
// a Hybrid -> ControlValue -> Hybrid cycle. It loads cleanly in Node ESM:
// neither module touches an imported binding during top-level evaluation
// (both only define functions/classes at the top level), so the cycle
// never trips "cannot access before initialization" (verified empirically
// with a full-graph import + behavioral tests, see the harness
// cutoff-smoke.mjs). If that ever regresses, STOP and report it rather
// than restructuring the modules.
import { controlValue, isDecomposed } from "./ControlValue.js";

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
    // Precomputed single-bit masks (audit #6): withLine() ORs these in
    // instead of shifting 1n on every call -- the shift showed up hot in
    // the solver and rollout profiles.
    const hMasks = [], vMasks = [];
    for (let i = 0; i < nH; i++) hMasks.push(1n << BigInt(i));
    for (let i = 0; i < nV; i++) vMasks.push(1n << BigInt(i));
    return { W, H, nH, nV, L, boxes, lineBoxes, hMasks, vMasks };
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

// Box side counts for every box, computed from scratch. Used once for the
// MCTS root; child nodes derive theirs from the parent instead (audit #1).
function computeSides(b, hBits, vBits) {
    const sides = new Uint8Array(b.boxes.length);
    for (let bi = 0; bi < sides.length; bi++) {
        sides[bi] = boxSides(b, b.boxes[bi], hBits, vBits);
    }
    return sides;
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

// ---------------------------------------------------------------------------
// MCTS-with-cutoff helpers.
//
// WHERE THE CUTOFF LIVES (two places, both exact, no approximation):
//  (1) TREE: a node whose position is fully decomposed is a LEAF. It is
//      never expanded (its children are never created); its value on
//      first visit is the exact ControlValue tail converted to AI boxes
//      (see exactAiGained below). Children of decomposed positions stay
//      decomposed, so this is stable: once the tree reaches decomposition,
//      every descendant value would be exact too, but there is nothing
//      left to learn by expanding — the node's value is already exact.
//      Special case: a decomposed ROOT has no move choice from its own
//      value, so runMCTSCutoff evaluates its children one ply deep with
//      ControlValue instead (each child is a decomposed leaf, so that
//      one-ply evaluation is exact, not an approximation).
//  (2) ROLLOUT: a rollout that reaches a decomposed position TRUNCATES
//      there and scores the tail exactly with ControlValue instead of
//      playing the biased rollout policy to the end. Rollout sides only
//      increase along a rollout, so decomposition, once reached, persists
//      — truncation loses nothing the rollout policy would have added
//      except its bias.
// The reward convention is unchanged: (aiSquares + gained) / squaresLeft,
// where gained is AI boxes from the leaf node onward (exact at cutoff).
// ---------------------------------------------------------------------------

// Boxes the AI closes from a FULLY DECOMPOSED position onward, under
// optimal play. controlValue returns the differential D for the player to
// move over the U unclaimed boxes; the player to move gains (U + D) / 2
// and the other player gains (U - D) / 2 (U and D always share parity,
// since the two gains sum to U and differ by D).
function exactAiGained(b, hBits, vBits, sides, turn) {
    const cv = controlValue(b, hBits, vBits, sides);
    const playerGains = (cv.unclaimed + cv.value) / 2;
    return turn === 1 ? playerGains : cv.unclaimed - playerGains;
}

// Decomposition-distance proxy for the near-window gate (see
// passesNearGate below). deficit = sum over low boxes (0 or 1 sides) of
// (2 - sides): a 0-sided box needs 2 side increments, a 1-sided box
// needs 1. One move increments at most 2 boxes (the boxes adjacent to
// the drawn line), so lbPlies = ceil(deficit / 2) is a LOWER bound on
// the number of plies before any decomposition can be reached — the
// true distance is >= lbPlies, never less. It is O(boxes), computed
// from the sides array the tree already maintains.
function decompositionStats(sides) {
    let low = 0, deficit = 0;
    for (let i = 0; i < sides.length; i++) {
        if (sides[i] < 2) { low++; deficit += 2 - sides[i]; }
    }
    return { low, deficit, lbPlies: Math.ceil(deficit / 2), decomposed: low === 0 };
}

// THE GATE (defined in the harness, see cutoff-gate.mjs). MCTS-with-
// cutoff is used only when BOTH hold:
//   (a) the plain exact solver does not already apply: empties > 27
//       (SOLVER_MAX_MOVES — the solver-first branch in move() handles
//       everything at or below that, exactly, so cutoff-MCTS never
//       competes with it); and
//   (b) decomposition is within reach: lbPlies <= GATE_MAX_LB_PLIES.
// GATE_MAX_LB_PLIES = 6 is the TESTED near window, not a winning one:
// gate measurements (cutoff-gate.mjs) show rollout truncation is 100%
// at every lb, but mean plies-to-truncation grows with lb (10.1 at
// lb=1 to 26.5 at lb=12), so lb <= 6 keeps the exact anchor within
// ~19 mean rollout plies; and the plain solver aborted 7/7 probed
// positions at E > 27. VALIDATION VERDICT (see harness cutoff report):
// full MCTS-with-cutoff does NOT beat the original heuristic anywhere
// in this window at Intermediate (all buckets negative) or at Master
// (overall -1.32 boxes/game; only the lb 1-3 Master cell is positive,
// +3.0 +- 2.78, not significant). So the gate is retained as the
// definition of the tested window, but the flag stays OFF — there is
// no lb sub-range in which the full cutoff reliably wins. The tree-only
// diagnostic variant at Master (+1.80 +- 1.61, n=30) is suggestive but
// unconfirmed and is NOT wired in on this evidence.
const GATE_MAX_LB_PLIES = 6;
function passesNearGate(b, hBits, vBits, sides) {
    const empties = emptyLines(b, hBits, vBits).length;
    const st = decompositionStats(sides);
    return { pass: empties > SOLVER_MAX_MOVES && st.lbPlies <= GATE_MAX_LB_PLIES,
             empties, ...st, maxLbPlies: GATE_MAX_LB_PLIES };
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
    if (lineId < b.nH) return { hBits: hBits | b.hMasks[lineId], vBits };
    return { hBits, vBits: vBits | b.vMasks[lineId - b.nH] };
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
function rolloutHeuristic(b, hBits, vBits, turn, heuristic, epsilon, useCutoff = false, stats = null) {
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
        // ROLLOUT CUTOFF (heuristic rollout): if the matrix position is
        // decomposed (no box with 0 or 1 sides), score the tail exactly
        // and stop. Conversion to bitboards is paid once, at truncation.
        if (useCutoff) {
            let decomposed = true;
            for (let i = 0; i < H && decomposed; i++)
                for (let j = 0; j < W; j++)
                    if (squares[i][j] < 2) { decomposed = false; break; }
            if (decomposed) {
                const bits = fromMatrices(b, h, v);
                const sd = computeSides(b, bits.hBits, bits.vBits);
                if (stats) stats.rolloutTruncations++;
                return aiBoxes + exactAiGained(b, bits.hBits, bits.vBits, sd, cur);
            }
        }
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
// `sides` is the caller's box-side counts for this position (audit #1);
// a local copy is played forward so the caller's array is never mutated.
function rollout(b, hBits, vBits, turn, epsilon, sides, useCutoff = false, stats = null) {
    const s = sides.slice();
    const empty = emptyLines(b, hBits, vBits);
    let aiBoxes = 0, cur = turn;
    // ROLLOUT CUTOFF: a rollout starting in a decomposed position scores
    // exactly without playing a single rollout move.
    if (useCutoff && isDecomposed(s)) {
        if (stats) { stats.rolloutTruncations++; stats.truncPlies = (stats.truncPlies || 0); }
        return aiBoxes + exactAiGained(b, hBits, vBits, s, cur);
    }
    let plies = 0;
    while (empty.length > 0) {
        const idx = pickRolloutIndex(b, empty, s, epsilon);
        const lineId = empty[idx];
        empty[idx] = empty[empty.length - 1];
        empty.pop();
        if (lineId < b.nH) hBits |= b.hMasks[lineId];
        else vBits |= b.vMasks[lineId - b.nH];
        let closed = 0;
        for (const bi of b.lineBoxes[lineId]) {
            if (++s[bi] === 4) closed++;
        }
        if (cur === 1) aiBoxes += closed;
        if (closed === 0) cur = 1 - cur;
        plies++;
        // ROLLOUT CUTOFF: truncate at the first decomposed position and
        // score the tail exactly. Sides only increase, so decomposition
        // persists for the rest of this rollout.
        if (useCutoff && isDecomposed(s)) {
            if (stats) { stats.rolloutTruncations++; stats.truncPlies = (stats.truncPlies || 0) + plies; }
            return aiBoxes + exactAiGained(b, hBits, vBits, s, cur);
        }
    }
    if (stats) stats.rolloutFull++;
    return aiBoxes;
}

// ---------------------------------------------------------------------------
// MCTS
// ---------------------------------------------------------------------------
class MNode {
    constructor(b, hBits, vBits, turn, parent, move, aiSquares, sides = null, untried = null) {
        this.hBits = hBits;
        this.vBits = vBits;
        this.turn = turn;      // 1 = AI to move, 0 = opponent
        this.parent = parent;
        this.move = move;
        this.aiSquares = aiSquares;  // boxes the AI has closed along this path
        this.children = [];
        this.visits = 0;
        this.value = 0;        // sum of AI-box-fraction rewards
        // Audit #1/#3: the root computes from scratch; a child receives
        // both derived from its parent (see the expansion step: sides are
        // the parent's incremented for the played line, untried is the
        // parent's full move set minus the played line, with already-
        // expanded sibling moves added back).
        this.sides = sides ?? computeSides(b, hBits, vBits);
        this.untried = untried ?? emptyLines(b, hBits, vBits);
        // TREE CUTOFF flag: a decomposed node is a leaf — never expanded.
        this.decomposed = isDecomposed(this.sides);
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

// Synchronous MCTS-with-cutoff. opts: { iterations, thinkMs, epsilon,
// useHeuristicRollouts, heuristic, deadline }. Iteration budget wins
// over the time budget when both are given (harness use); move() passes
// thinkMs only. Returns { move: lineId, iterations, stats, rootStats }.
// A decomposed root is handled by exact one-ply evaluation (see the
// TREE CUTOFF note above): each child is a decomposed leaf, so picking
// the child with the best exact AI total is exact, not approximate.
// Ties are broken randomly (MCTS is stochastic anyway).
// Internal MCTS loop shared by the cutoff and plain (ablation) runners.
// useCutoff=false reproduces the legacy plain MCTS: decomposed nodes are
// expanded normally and rollouts play to the end. The plain runner exists
// so harness ablations can isolate the cutoff's contribution at equal
// budgets; move() never uses it.
function runMCTSInternal(b, hBits, vBits, squaresLeft, opts = {}, useCutoff = true) {
    const epsilon = opts.epsilon ?? 0.15;
    const heuristic = opts.heuristic ?? null;
    const useHeuristicRollouts = !!opts.useHeuristicRollouts;
    // Diagnostic variant: rolloutCutoff=false keeps the TREE cutoff
    // (decomposed nodes are exact leaves) but lets rollouts play to the
    // end. The full cutoff (default) truncates rollouts too. The flag
    // exists because rollout truncation pays a cold ControlValue call
    // per rollout (heavy-tailed: median 0.01ms, mean ~4ms, max 522ms in
    // harness profile2), which starves the tree at level time budgets;
    // tree-only is the measured alternative, not a second implementation.
    const rolloutCutoff = opts.rolloutCutoff ?? true;
    const deadline = opts.deadline ?? (opts.thinkMs !== undefined ? Date.now() + opts.thinkMs : Infinity);
    const maxIterations = opts.iterations ?? opts.maxIterations ?? 500000;
    const stats = { exactLeaves: 0, rolloutTruncations: 0, rolloutFull: 0, truncPlies: 0, rootDecomposed: false };
    const root = new MNode(b, hBits, vBits, 1, null, null, 0);
    if (root.untried.length === 0) return { move: null, iterations: 0, stats, rootStats: [] };
    if (useCutoff && root.decomposed) {
        // Exact one-ply: no tree at all is needed.
        stats.rootDecomposed = true;
        let best = [], bestAi = -Infinity;
        for (const lineId of root.untried) {
            const s = withLine(b, hBits, vBits, lineId);
            const childSides = root.sides.slice();
            let closed = 0;
            for (const bi of b.lineBoxes[lineId]) if (++childSides[bi] === 4) closed++;
            const childTurn = closed === 0 ? 0 : 1;
            const tail = exactAiGained(b, s.hBits, s.vBits, childSides, childTurn);
            const total = closed + tail; // closed>0 keeps AI to move; closed==0 flips, already in tail
            // NOTE: when closed==0, tail is AI boxes with opponent to move;
            // when closed>0, tail is AI boxes with AI to move again; in
            // both cases total = AI boxes from the root onward.
            if (total > bestAi) { bestAi = total; best = [lineId]; }
            else if (total === bestAi) best.push(lineId);
        }
        return { move: best[(Math.random() * best.length) | 0], iterations: 0, stats, rootStats: [] };
    }
    let iters = 0;
    while (Date.now() < deadline && iters < maxIterations) {
        iters++;
        // Selection: descend while fully expanded — but never THROUGH a
        // decomposed node (it is a leaf; its value is exact).
        let node = root;
        while (!(useCutoff && node.decomposed) && node.untried.length === 0 && node.children.length > 0) {
            node = selectChild(node);
        }
        // Expansion: one child per iteration, SKIPPED for decomposed nodes
        // (cutoff only; plain MCTS expands them normally).
        if (!(useCutoff && node.decomposed) && node.untried.length > 0) {
            const pick = (Math.random() * node.untried.length) | 0;
            const lineId = node.untried.splice(pick, 1)[0];
            const s = withLine(b, node.hBits, node.vBits, lineId);
            const childSides = node.sides.slice();
            let closed = 0;
            for (const bi of b.lineBoxes[lineId]) {
                if (++childSides[bi] === 4) closed++;
            }
            const childTurn = closed === 0 ? 1 - node.turn : node.turn;
            const childAi = node.aiSquares + (node.turn === 1 ? closed : 0);
            const siblingMoves = node.children.map(c => c.move);
            const child = new MNode(b, s.hBits, s.vBits, childTurn, node,
                                    lineId, childAi, childSides,
                                    node.untried.concat(siblingMoves));
            node.children.push(child);
            node = child;
        }
        // Leaf value: exact for decomposed nodes, truncated rollout else
        // (cutoff only; plain MCTS always plays the full rollout).
        let gained;
        if (useCutoff && node.decomposed) {
            stats.exactLeaves++;
            gained = exactAiGained(b, node.hBits, node.vBits, node.sides, node.turn);
        } else if (useHeuristicRollouts && heuristic) {
            gained = rolloutHeuristic(b, node.hBits, node.vBits, node.turn, heuristic, epsilon, useCutoff && rolloutCutoff, stats);
        } else {
            gained = rollout(b, node.hBits, node.vBits, node.turn, epsilon, node.sides, useCutoff && rolloutCutoff, stats);
        }
        const reward = (node.aiSquares + gained) / squaresLeft;
        let n = node;
        while (n) { n.visits++; n.value += reward; n = n.parent; }
    }
    if (root.children.length === 0) return { move: root.untried[0], iterations: iters, stats, rootStats: [] };
    const best = root.children.reduce((a, c) => (c.visits > a.visits ? c : a));
    const rootStats = root.children
        .map(c => ({ move: lineToString(b, c.move), visits: c.visits, value: c.value / c.visits }))
        .sort((a, z) => z.visits - a.visits);
    return { move: best.move, iterations: iters, stats, rootStats };
}

function runMCTSCutoff(b, hBits, vBits, squaresLeft, opts = {}) {
    return runMCTSInternal(b, hBits, vBits, squaresLeft, opts, true);
}
function runMCTSPlain(b, hBits, vBits, squaresLeft, opts = {}) {
    return runMCTSInternal(b, hBits, vBits, squaresLeft, opts, false);
}

export default class AIEngineHybrid {
    constructor(options = {}) {
        this.epsilon = options.epsilon ?? 0.15;
        this.maxIterations = options.maxIterations ?? 500000;
        this.thinkMs = options.thinkMs ?? 1400;
        this.useHeuristicRollouts = !!options.useHeuristicRollouts;
        // MCTS-with-cutoff: OFF by default, and VERDICTED OFF (see the
        // harness cutoff report): it does not beat the original
        // heuristic in the near window at Intermediate or Master, so a
        // later cascade agent must NOT turn this on without new,
        // confirmatory evidence. This flag alone does NOT gate: move()
        // additionally requires passesNearGate (empties > 27 and
        // lbPlies <= 6) before using it.
        this.mctsCutoff = !!options.mctsCutoff;
        this.cutoffRollouts = options.cutoffRollouts ?? true;
        this.heuristic = new AIEngineHeuristic();
        this.lastIterations = 0;   // iterations used by the most recent move()
        this.lastExact = false;    // true if the exact solver (not MCTS) chose the move
        this.lastCutoff = false;   // true if MCTS-with-cutoff (not plain MCTS) chose the move
        this.lastCutoffStats = null;
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

        // 3a) MCTS-with-cutoff, gated to the near window (flag OFF by
        // default; gate also requires empties > 27 and lbPlies <= 6).
        // Outside the gate, plain MCTS below is used unchanged.
        if (this.mctsCutoff) {
            const rootSides = computeSides(b, hBits, vBits);
            const gate = passesNearGate(b, hBits, vBits, rootSides);
            if (gate.pass) {
                const r = runMCTSCutoff(b, hBits, vBits, squaresLeft, {
                    deadline, epsilon: this.epsilon,
                    useHeuristicRollouts: this.useHeuristicRollouts,
                    heuristic: this.heuristic, maxIterations: this.maxIterations,
                    rolloutCutoff: this.cutoffRollouts,
                });
                this.lastIterations = r.iterations;
                this.lastExact = false;
                this.lastCutoff = true;
                this.lastCutoffStats = r.stats;
                if (this.debugStats) this.lastRootStats = r.rootStats;
                return lineToString(b, r.move);
            }
        }
        this.lastCutoff = false;
        this.lastCutoffStats = null;

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
                // Audit #1: the child's box-side counts are the parent's,
                // incremented for the played line's boxes. Counting closes
                // off the increments is identical to boxesClosedBy().
                const childSides = node.sides.slice();
                let closed = 0;
                for (const bi of b.lineBoxes[lineId]) {
                    if (++childSides[bi] === 4) closed++;
                }
                const childTurn = closed === 0 ? 1 - node.turn : node.turn;
                const childAi = node.aiSquares + (node.turn === 1 ? closed : 0);
                // Audit #3: the child's untried moves are the parent's full
                // move set minus the move just played. node.untried already
                // had lineId spliced out, but it is ALSO missing the moves
                // expanded into earlier siblings -- those are still empty
                // in the child's position, so add them back.
                const siblingMoves = node.children.map(c => c.move);
                const child = new MNode(b, s.hBits, s.vBits, childTurn, node,
                                        lineId, childAi, childSides,
                                        node.untried.concat(siblingMoves));
                node.children.push(child);
                node = child;
            }

            // Rollout + backpropagation.
            const gained = this.useHeuristicRollouts
                ? rolloutHeuristic(b, node.hBits, node.vBits, node.turn, this.heuristic, this.epsilon)
                : rollout(b, node.hBits, node.vBits, node.turn, this.epsilon, node.sides);
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
export { buildBoard, fromMatrices, emptyLines, lineToString, solveRoot, boxesClosedBy, SOLVER_MAX_MOVES, runMCTSCutoff, runMCTSPlain, passesNearGate, decompositionStats, GATE_MAX_LB_PLIES, exactAiGained };
