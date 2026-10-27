// SolverCutoff.js
//
// Exact Dots and Boxes solver with a DECOMPOSITION CUTOFF.
//
// Same algorithm as AIEngine's corrected solver (negamax +
// alpha-beta + transposition table, fresh TT per root move, only
// non-pruned values cached — the PR #37 discipline), with one change:
// at any search node whose position is FULLY DECOMPOSED (every
// uncompleted box has >= 2 sides), the search stops expanding and
// returns ControlValue's exact component-game value instead.
//
// CONVENTION ALIGNMENT (the bug-prone seam — read carefully):
// - solveRec's frame: the returned value is (boxes eventually gained by
//   the frame-`turn` player) minus (boxes eventually gained by the other
//   frame player), counting ONLY boxes closed from this node onward.
//   Banked boxes are excluded. Takes keep the same frame (same physical
//   player moves again); non-takes flip the frame and negate on return.
//   Therefore at every node, solveRec's value is exactly the value for
//   the REAL player to move at that node.
// - controlValue's contract: net differential (player to move minus
//   opponent) over the UNCLAIMED boxes only, under optimal play.
//   Banked boxes are the caller's business (excluded on both sides).
// Hence at a decomposed node: controlValue == solveRec's value, with NO
// sign flip and NO banked-box adjustment. The cutoff plugs in directly.
// - TT SAFETY (2026-10-26 fix — read before touching this): the expansion
//   search uses a BOUND-TYPED transposition table (EXACT / LOWER / UPPER,
//   same scheme as ControlValue's micro game). Two soundness bugs were
//   found by validation (evaluator + independent brute force agreed 4
//   where the expansion solver said 6/8 on one 5x5 E17 position):
//   (1) CLOSING-WINDOW BUG: on a closing move the child used to be
//       searched with the parent's UNshifted (alpha, beta). A child that
//       fails low returns an upper bound u <= alpha, but the parent's
//       move value is closed + u, which can EXCEED alpha and become best
//       as if exact — a pure overestimate, no TT needed (pure alpha-beta
//       without any TT returned 8 on the witness position). The child
//       window on a closing move MUST be (alpha - closed, beta - closed),
//       matching the micro game's (alpha - gain, beta - gain). The
//       non-closing negated window (-beta, -alpha) was already correct.
//   (2) FAIL-LOW CACHING BUG: the old rule "cache iff the node did not
//       prune" is unsound — a node that evaluates all children but
//       returns best <= alphaOrig has failed low and returns an UPPER
//       bound, not an exact value. Caching it as exact poisoned later
//       transpositions. The bound-typed scheme stores the flag instead.
//   Cutoff values are genuinely exact (full-window micro evaluation), so
//   they are stored as EXACT. Decomposed positions always take the cutoff
//   branch (decomposition is position-determined), so no position ever
//   mixes a bound entry with a cutoff value.
//
// DECOMPOSITION DETECTION (cheap, incremental): `sides` (per-box side
// counts) and `low` (count of boxes with 0 or 1 sides) are threaded down
// the search. Sides only increase along a path, so a box leaves the low
// set exactly once (on its 1 -> 2 transition); `low === 0` is exactly
// ControlValue.isDecomposed. The sides array is also what controlValue
// needs for component extraction, so no recomputation at cutoff nodes.
//
// TUNING KNOBS (measured, not guessed — see solver-cutoff-progress.log):
// - cutoffMinE: apply the cutoff only when the node has at least this
//   many empty lines. Near-terminal nodes have tiny subtrees, and the
//   evaluator costs more than expanding them; the floor skips those.
// - cutoffMaxComps: apply the cutoff only when the component count is
//   at most this. The exact evaluator's micro-game cost grows with
//   component count; above breakeven it costs more than the subtree it
//   replaces. (Both default to unbounded; the calibration sets them.)
// Exactness is NEVER traded: when the cutoff is skipped for cost
// reasons, the node is expanded normally, which is exact too.

import { buildBoard, fromMatrices, emptyLines } from "./Board.js";
import { extractComponents, componentGameValue, getAnomalies } from "./ControlValue.js";

class SolverAbort extends Error {}

// Bound-typed TT flags (same scheme as ControlValue's micro game).
const FLAG_EXACT = 0, FLAG_LOWER = 1, FLAG_UPPER = 2;

function popcount(b) {
    let c = 0;
    while (b) { c++; b &= b - 1n; }
    return c;
}

function boxSides(b, box, hBits, vBits) {
    return popcount(hBits & box.hMask) + popcount(vBits & box.vMask);
}

function withLine(b, hBits, vBits, lineId) {
    if (lineId < b.nH) return { hBits: hBits | (1n << BigInt(lineId)), vBits };
    return { hBits, vBits: vBits | (1n << BigInt(lineId - b.nH)) };
}

// Root sides + low count, computed from scratch (O(boxes), once per solve).
function computeSidesLow(b, hBits, vBits) {
    const sides = new Uint8Array(b.boxes.length);
    let low = 0;
    for (let bi = 0; bi < sides.length; bi++) {
        const s = boxSides(b, b.boxes[bi], hBits, vBits);
        sides[bi] = s;
        if (s < 2) low++;
    }
    return { sides, low };
}

function solveRecCutoff(b, hBits, vBits, turn, alpha, beta, tt, deadline, counter,
                        sides, low, stats, opts) {
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

    // Decomposition cutoff: exact value, no expansion. (No pruning has
    // occurred at this node, so caching the exact value is safe.)
    // Extraction is O(boxes) and cheap; the micro game is what gets
    // capped, so the count check happens BEFORE paying for it.
    if (low === 0 && moves.length >= opts.cutoffMinE) {
        const comps = extractComponents(b, hBits, vBits, sides);
        if (comps.length <= opts.cutoffMaxComps) {
            const t0 = performance.now();
            const value = componentGameValue(comps);
            const dt = performance.now() - t0;
            stats.cutoffs++;
            stats.cutoffMs += dt;
            stats.cutoffComps += comps.length;
            if (comps.length > stats.cutoffMaxComps) stats.cutoffMaxComps = comps.length;
            // Debug hook (off by default): record every cutoff node so a
            // validation mismatch can be localized to one node/multiset.
            if (opts.trace) opts.trace.push({ hBits, vBits, comps: comps.map(c => ({ ...c })), value });
            tt.set(key, { v: value, flag: FLAG_EXACT });
            return value;
        }
        // Component count above breakeven: fall through to normal
        // expansion (exact, just slower). Only the cheap extraction
        // was paid, not the micro game.
        stats.cutoffSkipped++;
    }

    const takes = [], rest = [];
    for (const m of moves) {
        let isTake = false;
        for (const bi of b.lineBoxes[m]) {
            if (sides[bi] === 3) { isTake = true; break; }
        }
        (isTake ? takes : rest).push(m);
    }

    let best = -Infinity;
    for (const m of takes.concat(rest)) {
        const s = withLine(b, hBits, vBits, m);
        const childSides = sides.slice();
        let childLow = low, closed = 0;
        for (const bi of b.lineBoxes[m]) {
            const old = childSides[bi];
            childSides[bi] = old + 1;
            if (old === 1) childLow--;
            if (old + 1 === 4) closed++;
        }
        let val;
        if (closed > 0) {
            // Closing window MUST shift by closed (see header): the
            // child's value is in the same frame, so the parent's window
            // (alpha, beta) corresponds to the child's
            // (alpha - closed, beta - closed).
            val = closed + solveRecCutoff(b, s.hBits, s.vBits, turn, alpha - closed, beta - closed,
                tt, deadline, counter, childSides, childLow, stats, opts);
        } else {
            val = -solveRecCutoff(b, s.hBits, s.vBits, 1 - turn, -beta, -alpha,
                tt, deadline, counter, childSides, childLow, stats, opts);
        }
        if (val > best) best = val;
        if (best > alpha) alpha = best;
        if (alpha >= beta) break;
    }
    // Bound-typed store (pruned or not — bounds are sound entries).
    const flag = best <= alphaOrig ? FLAG_UPPER : (best >= betaOrig ? FLAG_LOWER : FLAG_EXACT);
    tt.set(key, { v: best, flag });
    return best;
}

// Same root discipline as AIEngine.solveRoot: fresh TT per root
// move, full window, takes ordered before rest. Returns the best move
// AND its value (the engine's solveRoot returns only the move).
function solveRootCutoff(b, hBits, vBits, moves, deadline = Date.now() + 2000, opts = {}) {
    const o = { cutoffMinE: 0, cutoffMaxComps: Infinity, ...opts };
    const counter = { n: 0 };
    const stats = { cutoffs: 0, cutoffMs: 0, cutoffComps: 0, cutoffMaxComps: 0,
                    cutoffSkipped: 0 };
    const { sides, low } = computeSidesLow(b, hBits, vBits);
    const takes = [], rest = [];
    for (const m of moves) {
        let isTake = false;
        for (const bi of b.lineBoxes[m]) {
            if (sides[bi] === 3) { isTake = true; break; }
        }
        (isTake ? takes : rest).push(m);
    }
    let bestMove = moves[0], bestVal = -Infinity;
    for (const m of takes.concat(rest)) {
        const tt = new Map();
        const s = withLine(b, hBits, vBits, m);
        const childSides = sides.slice();
        let childLow = low, closed = 0;
        for (const bi of b.lineBoxes[m]) {
            const old = childSides[bi];
            childSides[bi] = old + 1;
            if (old === 1) childLow--;
            if (old + 1 === 4) closed++;
        }
        const val = closed > 0
            ? closed + solveRecCutoff(b, s.hBits, s.vBits, 1, -Infinity, Infinity,
                tt, deadline, counter, childSides, childLow, stats, o)
            : -solveRecCutoff(b, s.hBits, s.vBits, 0, -Infinity, Infinity,
                tt, deadline, counter, childSides, childLow, stats, o);
        if (val > bestVal) { bestVal = val; bestMove = m; }
    }
    return { move: bestMove, value: bestVal, nodes: counter.n, stats };
}

export { buildBoard, fromMatrices, emptyLines, solveRootCutoff, solveRecCutoff,
         computeSidesLow, getAnomalies, SolverAbort };
