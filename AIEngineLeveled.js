// AIEngineLeveled.js
//
// Leveled 4-phase Dots and Boxes AI, fixed strength (difficulty levels
// removed 2026-10-27; the engine always uses the single configuration
// below). Design (agreed with Mike, 2026-10-23): commit-or-skip minimax,
// crisp either/or phases, no blending. Each move is decided by exactly one
// stage, checked in this order (cascade, component (d) 2026-10-26):
//
//   Step 1 (evaluator): fully decomposed AND unclaimed boxes U <= 30 ->
//                       AIEngineHeuristic's evaluator branch (perfect
//                       play). The U gate is what keeps this within
//                       budget (see EVALUATOR_MAX_UNCLAIMED in
//                       AIEngineHeuristic.js); gated-out decomposed
//                       positions fall through.
//   Step 2 (minimax):   E <= per-size minimaxLines -> minimax-with-cutoff
//                       (solveRootCutoff) under a REAL deadline (80% of
//                       the 1500ms VM budget); on timeout it falls
//                       through instead of committing. This replaces the
//                       old committed phase 4 (24-hour deadline, no bail).
//   Step 3 (heuristic): everything else -> AIEngineHeuristic play, via
//                       the old phases below. MCTS-with-cutoff is NOT a
//                       step (component (c) verdict NO).
//   Phase 3 (offer):    one or more offered components (regions of
//                       2-3-sided boxes containing a 3-sided box) ->
//                       AIEngineHeuristic play. Exactly one offer uses the
//                       heuristic's own controller; multiple simultaneous
//                       offers use the extended controller below (chains
//                       first, loop last, per-component give-back while
//                       other long components remain, final component
//                       taken whole). MCTS never plays offered positions.
//   Phase 1 (quiet):    no offers and E > 0 -> heuristic move (in the
//                       pre-structure opening its play is a random
//                       safe move anyway; MCTS has no signal to find
//                       there). Phase 2's boundary is 0, so quiet
//                       positions always take this branch.
//   Phase 2 (steering): no offers and E <= boundary (0) -> MCTS with
//                       the fixed iteration budget, plain UCB selection
//                       with Cp 1.41, and structure-gated rollouts
//                       (dumb until any box reaches >= 2 sides, then the
//                       heuristic finishes the rollout). Calibrated OFF
//                       (boundary 0 everywhere); retained, unreachable.
//
// The boundary is capability-calibrated (Stage B): the empty-line count at
// and below which MCTS at the fixed budget demonstrably out-decides the
// heuristic. It is board-size-dependent; it is 0 on every size (MCTS
// never earns its seat in the quiet phase).
//
// Phase-2 budget is TIME-derived (Mike's decision, 2026-10-23): a
// consistent per-move thinking time on every board size. Phone time
// target 3.0s (VM budget 1500ms; phone = 2x VM). Iterations per size =
// 1500 / measured gated ms-per-iteration, measured with this file's
// runMCTS on quiet ~50%-fill positions, warmed and interleaved
// (harness/measure-iter.mjs): 5x5 0.396 ms/iter (median, n=12),
// 7x7 1.050 (n=12), 10x10 4.136 (n=6). Resulting budgets:
// 3788 (5x5) / 1429 (7x7) / 363 (10x10). The measured per-size rates
// ARE the scaling rule.
//
// Calibration provenance: Stage A (solver cost vs empties -> minimaxLines,
// phone time = 2x VM time, worst-case rule) and Stage B (quiet-position
// crossover -> boundary; Cp side-experiment). Logs:
// ~/workspace/goals/mcts-engine-improvements/hidden_files/ (levels-progress.log)

import AIEngineHeuristic, { EVALUATOR_MAX_UNCLAIMED, EVALUATOR_MAX_COMPONENTS } from "./AIEngineHeuristic.js";
import { solveRootCutoff, SolverAbort as CutoffAbort } from "./SolverCutoff.js";
import { computeSides, isDecomposed, extractComponents } from "./ControlValue.js";
// NOTE (2026-10-26, component (b) integration): phase 4 now solves via
// SolverCutoff's decomposition-cutoff solver instead of the plain expansion
// solver below. Import chain Leveled -> SolverCutoff -> Hybrid/ControlValue
// has no cycle (nothing imports AIEngineLeveled). solveRoot stays exported
// (fixed) for harness/reference use.

// ---- FIXED CONFIGURATION: filled from Stage A/B calibration (see header) ----
// Phone time target 3000ms; iterations derive from the VM budget via
// MS_PER_ITER_ANCHORS below.
// minimaxLines — RECALIBRATED 2026-10-26 (component (b) integration,
// supersedes the Stage A 2026-10-23 row). Fixed solver + decomposition
// cutoff, worst-case rule (largest E with all E' <= E having MAX VM solve
// time x2 <= phoneMs), mixed heur+randquiet sample, 5x5, 30 positions per
// E at E14-22 (15 at E25-30), measured under 2-4-way VM contention (so
// contended VM times overstate solo times and the phone=2x rule applied
// to them is conservative). Binding maxima: E14 346.7ms VM = 693ms phone;
// E15 653.4ms = 1306ms phone (within 3000ms); E16 3583.3ms = 7166ms
// phone (busts). Hence the scalar 15 — down from the earlier 16/18
// because the mixed sample's
// pathological randquiet positions, not the medians (E16 median 38ms),
// bust the targets. Heur-only maxima would give 19, but
// real games vs human opponents include non-heur positions, so the mixed
// rule governs. CAVEAT: these are scalar 5x5 thresholds and do NOT
// satisfy phone targets on larger boards (7x7 E14 max 2701ms VM = 5.4s
// phone; 10x10 E14 max 2110ms VM = 4.2s phone — both bust the 3000ms
// target). Per-size minimaxLines follow below (component (d)).
// boundary (Stage B crossover): 0 on every size — at the
//   time-derived budgets, gated MCTS never out-decided the heuristic
//   pick on >= 60% of quiet positions at any empties level (n=6/bucket
//   on 5x5/7x7, n=3 on 10x10), so phase 2 is calibrated OFF. If budgets
//   or rollouts change materially, re-run Stage B before enabling it.
// cp (Stage B side-experiment, n=14 paired): 1.41 — Cp 0.5
//   point estimates were better at both budget classes but within
//   ~1 sigma (noise), so the textbook default stands.
// Fixed configuration (levels removed 2026-10-27): phone time target
// 3000ms, VM budget half that, minimax deadline 80% of VM.
const VM_BUDGET_MS = 1500;
const MINIMAX_DEADLINE_MS = Math.round(VM_BUDGET_MS * 0.8); // 1200
const CP = 1.41;
const BOUNDARY = 0;
const MINIMAX_LINES = 15;
const MINIMAX_LINES_BY_SIZE = { 7: 12, 10: 12 };
// Per-size minimaxLines (component (d), 2026-10-26): the scalar row above
// is 5x5-calibrated and BUSTS big-board budgets (7x7 E14 max 2701ms VM,
// 10x10 E14 max 2110ms VM — both over the 1500ms VM budget). Big-board
// lines use the same worst-case rule on NON-decomposed roots (decomposed
// roots never reach phase 4 — step 1 catches them): harness
// cascade-minimax-nondec.jsonl, solo-ish VM, n=6 per cell:
//   7x7:  E10 max 83.6, E12 max 236.0, E14 max 1519.5
//   10x10: E10 max 89.4, E12 max 355.3, E14 max 1921.5
// Largest measured E with max <= 1500ms VM budget: 12 (E14 busts).
// 5x5 keeps the (b) scalar row. Non-square boards fall back to the
// scalar row. The phase-4 deadline is the backstop for contention
// overshoot, so a line choice here controls waste, not compliance:
// with the deadline, no phase-4 call can exceed the VM budget +
// fallback cost.
function minimaxLinesFor(W, H) {
    if (W === H && MINIMAX_LINES_BY_SIZE[W] !== undefined) {
        return MINIMAX_LINES_BY_SIZE[W];
    }
    return MINIMAX_LINES;
}
// Phase-4 deadline: 80% of the VM budget, leaving 20% for the
// fallback move + overhead (1200ms). On SolverAbort the move falls
// through to phase 3 / phase 1 (lastMinimaxAborted records it); the
// old 24-hour deadline (effectively no cap) is gone.
// DEADLINE SOUNDNESS vs the cutoff's micro game: solveRootCutoff checks
// the deadline between search nodes, but a single componentGameValue call
// at a cutoff node is NOT deadline-checked. That call is bounded here
// because phase 4 only runs at E <= 15 (5x5) or E <= 12 (big boards), and
// every position reachable from an E-line root has unclaimed U <= 2E <=
// 30 — the evaluator-gate regime, where a single controlValue call
// measured <= ~25ms warm (game rows) and branch totals (E child calls)
// <= 94.8ms. So no single cutoff call can stall past the deadline by
// more than ~0.1s, and phase-4 totals stay within budget + fallback.


// Measured gated-rollout cost anchors: [totalLines, VM ms per iteration].
const MS_PER_ITER_ANCHORS = [[60, 0.396], [112, 1.050], [220, 4.136]];
function msPerIterFor(totalLines) {
    const A = MS_PER_ITER_ANCHORS;
    if (totalLines <= A[0][0]) return A[0][1] * totalLines / A[0][0];
    for (let i = 1; i < A.length; i++) {
        if (totalLines <= A[i][0]) {
            const [l0, r0] = A[i - 1], [l1, r1] = A[i];
            return r0 + (r1 - r0) * (totalLines - l0) / (l1 - l0);
        }
    }
    return A[A.length - 1][1];
}
// Phase-2 iteration budget: VM budget / measured rate. (Phase 2 never
// fires — BOUNDARY is 0 — but the budget is kept for reference.)
function iterationsFor(totalLines) {
    return Math.max(1, Math.round(VM_BUDGET_MS / msPerIterFor(totalLines)));
}

function popcount(b) {
    let c = 0;
    while (b) { c++; b &= b - 1n; }
    return c;
}

// ---------------------------------------------------------------------------
// Bitboard board description (as in AIEngineHybrid / AIEngineHybridStaged)
// ---------------------------------------------------------------------------
function buildBoard(W, H) {
    const nH = W * (H + 1);
    const nV = (W + 1) * H;
    const L = nH + nV;
    const hLineId = (i, j) => i * (H + 1) + j;
    const vLineId = (i, j) => nH + i * (W + 1) + j;
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
    // Precomputed single-bit masks (same convention as AIEngineHybrid:
    // hMasks[i] = 1n << i over h-line ids, vMasks[i] = 1n << i over
    // offset-free v-line ids). Required by the cutoff path: ControlValue's
    // lineTaken/extractComponents read b.hMasks/b.vMasks.
    const hMasks = [], vMasks = [];
    for (let i = 0; i < nH; i++) hMasks.push(1n << BigInt(i));
    for (let i = 0; i < nV; i++) vMasks.push(1n << BigInt(i));
    return { W, H, nH, nV, L, boxes, lineBoxes, hMasks, vMasks };
}

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
// Exact solver: negamax + alpha-beta + transposition table (corrected
// version, identical to AIEngineHybrid's: fresh TT per root move, only
// non-pruned values are cached). Returns via solveRoot the best lineId.
// ---------------------------------------------------------------------------
class SolverAbort extends Error {}

// Bound-typed TT flags (same scheme as ControlValue's micro game).
// 2026-10-26: the old "cache iff not pruned" rule + unshifted closing
// window were UNSOUND (witness: 5x5 E17 position where the expansion
// solver said 6/8 but the evaluator + independent brute force agree 4).
// On a closing move the child window MUST be (alpha - closed,
// beta - closed); and a node returning best <= alphaOrig has failed low
// (UPPER bound), best >= betaOrig has failed high (LOWER bound) — only
// strictly-interior values are EXACT. See SolverCutoff.js header.
const FLAG_EXACT = 0, FLAG_LOWER = 1, FLAG_UPPER = 2;

function solveRec(b, hBits, vBits, turn, alpha, beta, tt, deadline, counter) {
    if ((counter.n & 1023) === 0 && Date.now() > deadline) throw new SolverAbort();
    counter.n++;
    const key = hBits.toString(36) + '|' + vBits.toString(36) + '|' + turn;
    const ent = tt.get(key);
    if (ent !== undefined) {
        if (ent.flag === FLAG_EXACT) return ent.v;
        if (ent.flag === FLAG_LOWER) alpha = Math.max(alpha, ent.v);
        else beta = Math.min(beta, ent.v);
        if (alpha >= beta) return ent.v;
    }
    const alphaOrig = alpha, betaOrig = beta;

    const moves = emptyLines(b, hBits, vBits);
    if (moves.length === 0) return 0;

    const takes = [], rest = [];
    for (const m of moves) {
        let isTake = false;
        for (const bi of b.lineBoxes[m]) {
            if (boxSides(b, b.boxes[bi], hBits, vBits) === 3) { isTake = true; break; }
        }
        (isTake ? takes : rest).push(m);
    }

    let best = -Infinity;
    for (const m of takes.concat(rest)) {
        const s = withLine(b, hBits, vBits, m);
        const closed = boxesClosedBy(b, s.hBits, s.vBits, m);
        let val;
        if (closed > 0) {
            val = closed + solveRec(b, s.hBits, s.vBits, turn, alpha - closed, beta - closed, tt, deadline, counter);
        } else {
            val = -solveRec(b, s.hBits, s.vBits, 1 - turn, -beta, -alpha, tt, deadline, counter);
        }
        if (val > best) best = val;
        if (best > alpha) alpha = best;
        if (alpha >= beta) break;
    }
    const flag = best <= alphaOrig ? FLAG_UPPER : (best >= betaOrig ? FLAG_LOWER : FLAG_EXACT);
    tt.set(key, { v: best, flag });
    return best;
}

function solveRoot(b, hBits, vBits, moves, deadline = Date.now() + 2000) {
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
// Rollouts (from AIEngineHybridStaged): dumb epsilon-greedy policy, and the
// structure-gated rollout — dumb until any box reaches >= 2 sides, then the
// heuristic (epsilon-greedy) finishes the game.
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

// Heuristic rollout on matrices; returns boxes closed by the player whose
// frame label is 1 (cur === 1), starting from aiBoxesInit.
function rolloutHeuristic(b, hBits, vBits, turn, heuristic, epsilon, aiBoxesInit = 0) {
    const { h, v } = toMatrices(b, hBits, vBits);
    const W = b.W, H = b.H;
    const squares = [];
    for (let i = 0; i < H; i++) {
        squares[i] = [];
        for (let j = 0; j < W; j++) {
            squares[i][j] = (h[j][i] ? 1 : 0) + (h[j][i + 1] ? 1 : 0) +
                            (v[i][j] ? 1 : 0) + (v[i][j + 1] ? 1 : 0);
        }
    }
    let aiBoxes = aiBoxesInit, cur = turn;
    let movesLeft = 0;
    for (let i = 0; i < W; i++) for (let j = 0; j <= H; j++) if (!h[i][j]) movesLeft++;
    for (let i = 0; i < H; i++) for (let j = 0; j <= W; j++) if (!v[i][j]) movesLeft++;
    while (movesLeft > 0) {
        let m;
        if (Math.random() < epsilon) {
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
            if (c - 1 >= 0 && ++squares[c - 1][a] === 4) closed++;
            if (c < H && ++squares[c][a] === 4) closed++;
        } else {
            v[a][c] = 1;
            movesLeft--;
            if (c - 1 >= 0 && ++squares[a][c - 1] === 4) closed++;
            if (c < W && ++squares[a][c] === 4) closed++;
        }
        if (cur === 1) aiBoxes += closed;
        if (closed === 0) cur = 1 - cur;
    }
    return aiBoxes;
}

// Structure-gated rollout: dumb policy until any box has >= 2 sides, then
// one conversion to matrices and the heuristic finishes. Returns boxes
// closed by the root mover (turn frame: 1 = root mover).
function rolloutStaged(b, hBits, vBits, turn, epsilon, heuristic) {
    const sides = new Uint8Array(b.boxes.length);
    let structured = false;
    for (let bi = 0; bi < sides.length; bi++) {
        sides[bi] = boxSides(b, b.boxes[bi], hBits, vBits);
        if (sides[bi] >= 2) structured = true;
    }
    const empty = emptyLines(b, hBits, vBits);
    let aiBoxes = 0, cur = turn;
    while (empty.length > 0) {
        if (structured) {
            return rolloutHeuristic(b, hBits, vBits, cur, heuristic, epsilon, aiBoxes);
        }
        const idx = pickRolloutIndex(b, empty, sides, epsilon);
        const lineId = empty[idx];
        empty[idx] = empty[empty.length - 1];
        empty.pop();
        if (lineId < b.nH) hBits |= 1n << BigInt(lineId);
        else vBits |= 1n << BigInt(lineId - b.nH);
        let closed = 0;
        for (const bi of b.lineBoxes[lineId]) {
            if (++sides[bi] === 4) closed++;
            if (sides[bi] >= 2) structured = true;
        }
        if (cur === 1) aiBoxes += closed;
        if (closed === 0) cur = 1 - cur;
    }
    return aiBoxes;
}

// ---------------------------------------------------------------------------
// MCTS: plain UCB selection with a parameterized exploration constant,
// iteration budget (no time budget — fixed strength on any device),
// gated rollouts. Cp = sqrt(2) reproduces classic UCB1:
//   val = mean + Cp * sqrt(ln(parent visits) / child visits)
// ---------------------------------------------------------------------------
class MNode {
    constructor(b, hBits, vBits, turn, parent, move, aiSquares) {
        this.hBits = hBits;
        this.vBits = vBits;
        this.turn = turn;
        this.parent = parent;
        this.move = move;
        this.aiSquares = aiSquares;
        this.children = [];
        this.visits = 0;
        this.value = 0;
        this.untried = emptyLines(b, hBits, vBits);
    }
}

function selectChild(node, cp) {
    const logN = Math.log(node.visits);
    let best = null, bestVal = -Infinity;
    for (const c of node.children) {
        let val;
        if (c.visits === 0) {
            val = Infinity;
        } else {
            let expl = c.value / c.visits;
            if (node.turn === 0) expl = 1 - expl;
            val = expl + cp * Math.sqrt(logN / c.visits);
        }
        if (val > bestVal) { bestVal = val; best = c; }
    }
    return best;
}

// Run MCTS from the position and return the chosen lineId. The root mover
// is frame player 1. Shared by the engine and the calibration harness so
// what is calibrated is exactly what ships.
function runMCTS(b, hBits, vBits, squaresLeft, { iterations, cp, epsilon, heuristic }) {
    const root = new MNode(b, hBits, vBits, 1, null, null, 0);
    let iters = 0;
    while (iters < iterations) {
        iters++;
        let node = root;
        while (node.untried.length === 0 && node.children.length > 0) {
            node = selectChild(node, cp);
        }
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
        const gained = rolloutStaged(b, node.hBits, node.vBits, node.turn, epsilon, heuristic);
        const reward = (node.aiSquares + gained) / squaresLeft;
        let n = node;
        while (n) { n.visits++; n.value += reward; n = n.parent; }
    }
    const best = root.children.reduce((a, c) => (c.visits > a.visits ? c : a));
    return { move: best.move, iterations: iters };
}

// Offered components under the heuristic's own region definition:
// regions (connected 2-3-sided boxes) that contain a 3-sided box.
// Sets up the heuristic's internals for `h`/`v` as a side effect.
function offeredRegions(heuristic, h, v) {
    heuristic.h = h;
    heuristic.v = v;
    heuristic.x = h.length;
    heuristic.y = v.length;
    heuristic.countSquares();
    const regions = heuristic.buildRegions();
    const offered = regions.filter(r => r.some(([i, j]) => heuristic.squares[i][j] === 3));
    return { regions, offered };
}
function countOfferedRegions(heuristic, h, v) {
    return offeredRegions(heuristic, h, v).offered.length;
}

// Extended controller for MULTIPLE simultaneous offers (design confirmed
// 2026-10-23). The heuristic's own controllerMove handles exactly one
// offered region; this sequences several: chains first, loop last. For
// the chosen region R it mirrors controllerMove's per-region logic —
// give-back play (take down toward the handout point, or ripen) while
// other long components remain, and take R whole when it is effectively
// the final long component. Per-move sequencing emerges naturally: box
// takes keep the turn, so successive move() calls work through the
// remaining offers; a ripen hands the turn over with offers outstanding,
// exactly as in single-offer control play. Returns [type, i, j] or null.
function controllerMultiMove(heuristic, regions, offered) {
    const chains = offered.filter(r => !heuristic.isLoop(r));
    const loops = offered.filter(r => heuristic.isLoop(r));
    const pool = chains.length > 0 ? chains : loops; // chains first, loop last
    pool.sort((a, b) => b.length - a.length);        // largest first
    const R = pool[0];
    const rset = new Set(R.map(([i, j]) => i + ',' + j));

    // Other significant components (offered or not) beyond R.
    let otherLong = 0;
    for (const r of regions) {
        if (r !== R && r.length >= 3) otherLong++;
    }
    const threesIn = (region) => region.filter(([i, j]) => heuristic.squares[i][j] === 3);
    const allThrees = regions.flatMap(threesIn);
    if (otherLong === 0) {
        // Final significant component(s): take whole, sweeping all offers.
        return heuristic.greedyTake(allThrees);
    }
    const n = R.length;
    const openings = threesIn(R);
    let m = null;
    if (heuristic.isLoop(R)) {
        m = n > 4 ? heuristic.takeOne(R) : heuristic.doubleLoony(R, rset);
    } else if (openings.length <= 1) {
        if (n > 2) m = heuristic.untakenEdges(openings[0][0], openings[0][1])[0];
        else if (n === 2) m = heuristic.chainDoubleCross(R, rset);
    } else {
        m = n > 4 ? heuristic.takeOne(R)
                  : (heuristic.doubleLoony(R, rset) || heuristic.chainDoubleCross(R, rset));
    }
    // Fallbacks mirror controllerMove -> chooseMove: take within R, then any.
    return m || heuristic.greedyTake(openings) || heuristic.greedyTake(allThrees);
}

export default class AIEngineLeveled {
    constructor(options = {}) {
        this.epsilon = options.epsilon ?? 0.15;
        this.heuristic = new AIEngineHeuristic();
        this.lastIterations = 0;
        this.lastExact = false;
        this.lastPhase = null;   // 'evaluator' | 'minimax' | 'heuristic-offer' | 'heuristic-quiet' | 'mcts'
        this.lastMinimaxAborted = false; // true when phase 4 timed out and the move fell through
    }

    async move(h, v, squaresLeft) {
        const W = h.length, H = v.length;
        const b = buildBoard(W, H);
        const { hBits, vBits } = fromMatrices(b, h, v);
        const moves = emptyLines(b, hBits, vBits);
        const E = moves.length;
        this.lastIterations = 0;
        this.lastExact = false;
        this.lastMinimaxAborted = false;

        // CASCADE (component (d), 2026-10-26), checked in order at every
        // move. MCTS-with-cutoff is NOT in this cascade (component (c)
        // verdict NO — full loses to the heuristic, tree-only unconfirmed;
        // Hybrid's mctsCutoff flag stays OFF and untouched).
        //
        // Step 1 — DECOMPOSED -> evaluator move (perfect play). Explicit
        // and first: decomposedness is computed here (not left implicit
        // inside chooseMove), and gated by unclaimed-box count U <= 30
        // AND component count <= 10 (same gate as the branch itself):
        // above the gate the branch is skipped in chooseMove too, so
        // falling through cannot re-enter an uncapped evaluation via
        // step 3. The branch additionally carries a per-child deadline
        // (the shared 1200ms default in AIEngineHeuristic), so even an
        // in-gate multiset the structural gate underestimates abandons
        // instead of stalling the move; on a branch timeout
        // (heuristic.evaluatorTimedOut) the cascade falls through to
        // step 2 rather than returning the fallback move as an
        // 'evaluator' decision. Gated-out decomposed positions fall
        // through to step 2 the same way.
        const sides = computeSides(b, hBits, vBits);
        if (isDecomposed(sides)) {
            const comps = extractComponents(b, hBits, vBits, sides);
            let unclaimed = 0;
            for (const c of comps) unclaimed += c.n;
            if (unclaimed <= EVALUATOR_MAX_UNCLAIMED && comps.length <= EVALUATOR_MAX_COMPONENTS) {
                const m = this.heuristic.chooseMove(h, v);
                if (!this.heuristic.evaluatorTimedOut) {
                    this.lastPhase = 'evaluator';
                    return m[0] + ',' + m[1] + ',' + m[2];
                }
                // Branch timed out: fall through to step 2 (the
                // controller/opener move just computed is discarded).
            }
        }

        if (E === 1) {
            this.lastPhase = E <= minimaxLinesFor(W, H) ? 'minimax' : 'heuristic-quiet';
            return lineToString(b, moves[0]);
        }

        // Step 2 — minimax-with-cutoff UNDER A REAL DEADLINE, falling
        // through on timeout/abort. Solved via the decomposition-cutoff
        // solver (same exact values as solveRoot — (b) validated
        // composite 740/740 moves, 720/720 values, 63/63 + 63/63
        // small-board brute force — but with decomposition cutoff on
        // fully-decomposed nodes). The old 24-hour deadline is replaced
        // by MINIMAX_DEADLINE_MS (80% of VM budget); see its soundness note
        // re single cutoff calls. Only SolverAbort falls through — any
        // other throw propagates (a real bug, not a timeout).
        if (E <= minimaxLinesFor(W, H)) {
            try {
                const mv = solveRootCutoff(b, hBits, vBits, moves, Date.now() + MINIMAX_DEADLINE_MS).move;
                this.lastPhase = 'minimax';
                this.lastExact = true;
                return lineToString(b, mv);
            } catch (e) {
                // NB: this is SolverCutoff's abort class (aliased), NOT
                // this file's local SolverAbort used by solveRec below.
                if (!(e instanceof CutoffAbort)) throw e;
                this.lastMinimaxAborted = true;
            }
        }

        // Step 3 — heuristic (phases 3 / 1 below). Decomposed positions
        // reaching here are gated out of the evaluator branch, so
        // chooseMove's controller/opener logic decides (bounded).
        // Offer detection (Phase 3 vs quiet), using the heuristic's regions.
        const { regions, offered } = offeredRegions(this.heuristic, h, v);

        // Phase 3: any offer -> heuristic play. Exactly one offer uses the
        // heuristic's own controller; several use the extended controller.
        if (offered.length === 1) {
            this.lastPhase = 'heuristic-offer';
            const m = this.heuristic.chooseMove(h, v);
            return m[0] + ',' + m[1] + ',' + m[2];
        }
        if (offered.length >= 2) {
            this.lastPhase = 'heuristic-offer';
            const m = controllerMultiMove(this.heuristic, regions, offered)
                || this.heuristic.chooseMove(h, v);
            return m[0] + ',' + m[1] + ',' + m[2];
        }

        // Phase 1: quiet and still above the capability boundary -> the
        // heuristic's safe play; MCTS has no detectable signal here.
        if (E > BOUNDARY) {
            this.lastPhase = 'heuristic-quiet';
            const m = this.heuristic.chooseMove(h, v);
            return m[0] + ',' + m[1] + ',' + m[2];
        }

        // Phase 2 (steering window): MCTS with the level's time-derived,
        // size-scaled iteration budget.
        const iterations = iterationsFor(b.L);
        const { move, iterations: ran } = runMCTS(b, hBits, vBits, squaresLeft, {
            iterations, cp: CP, epsilon: this.epsilon, heuristic: this.heuristic,
        });
        this.lastPhase = 'mcts';
        this.lastIterations = ran;
        return lineToString(b, move);
    }
}

export { iterationsFor, msPerIterFor, buildBoard, fromMatrices, emptyLines, lineToString, solveRoot, runMCTS, countOfferedRegions, offeredRegions, controllerMultiMove, minimaxLinesFor, EVALUATOR_MAX_UNCLAIMED, EVALUATOR_MAX_COMPONENTS };
