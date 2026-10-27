// ControlValue.js
//
// Abstract endgame evaluator for FULLY DECOMPOSED Dots and Boxes positions
// (every box has >= 2 sides). Instead of simulating the tail, it solves
// the endgame exactly at the component level.
//
// Why a component state is complete: in a decomposed position every
// unclaimed box has 1 or 2 untaken edges (3 or 2 sides), so in the graph
// where boxes are linked by shared UNTAKEN edges, every vertex has degree
// <= 2: each region (AIEngineHeuristic.buildRegions) is a simple path or a
// simple cycle. Interior boxes of a path always have exactly 2 untaken
// edges (both internal); an end box has 1 internal + (0 or 1) boundary
// untaken edges. So a component is fully described by:
//   - cycle: { ring: n }                       (all boxes 2-sided)
//   - path:  { n, a, b }  end boxes' untaken counts a, b in {1, 2}
//     (a == 1 means that end is 3-sided / "offered"; a == 2 means it also
//     has an untaken boundary edge). A singleton is a path with n == 1 and
//     a single untaken count u in {1, 2}.
// Extractor mapping from buildRegions output { n, loop, threes }:
//   loop && threes == 0  -> cycle(n)          (n >= 3)
//   loop && threes == 2  -> path(n, 1, 1)     ("arc": both ends offered)
//   !loop && threes == 0 -> path(n, 2, 2)     (or singleton u == 2)
//   !loop && threes == 1 -> path(n, 1, 2)     (or singleton u == 1)
// (loop with threes == 1 or > 2, and chain with threes == 2, are
// geometrically impossible in decomposed positions; they are counted as
// anomalies if ever seen.)
//
// The game is solved by memoized minimax over single-edge draws:
//   - draw a boundary edge of a path end with u == 2: end u -> 1, no box
//     closes, turn passes (the end-open / ripen-by-end move).
//   - draw an internal edge (between boxes k and k+1 of a path, or any
//     cycle edge): both incident boxes lose one untaken edge. A cycle
//     becomes a path(n, 1, 1). A path splits into two paths at that edge.
//     An incident end box with u == 1 closes (it was 3-sided and this was
//     its last untaken edge): the mover gains it and MOVES AGAIN; if no
//     box closes, the turn passes. The 2-box component with both ends
//     u == 1 closes both boxes on its single internal edge.
//   - singleton u == 2: draw -> u == 1, turn passes. u == 1: draw closes
//     it, gain 1, move again.
// The classic control plays emerge from these moves: the chain
// double-cross (take down to 2, draw the far end's boundary edge), the
// loop give-back of 4, and loop-splitting declines are all just lines in
// this game tree. Termination: every move draws one edge, strictly
// decreasing the total untaken-edge count; memoized recursion is exact.
//
// CONVENTION: controlValue / componentGameValue return the net box
// differential (player to move minus opponent) over the UNCLAIMED boxes
// only, under optimal play. Banked boxes are the caller's business.
//
// Also included: an exact solver (clone of AIEngineHybrid's solveRec,
// returning the value) used for validation.

import { buildBoard, fromMatrices, emptyLines } from "./AIEngineHybrid.js";

function popcount(b) {
    let c = 0;
    while (b) { c++; b &= b - 1n; }
    return c;
}

// ---------------------------------------------------------------------------
// Board extras: per-box edges (lineId + neighbor box index or -1).
// Box index bi = y * W + x for box (x, y), matching buildBoard's order.
// ---------------------------------------------------------------------------
const extrasCache = new Map();
export function boardExtras(b) {
    const key = b.W + "x" + b.H;
    let ex = extrasCache.get(key);
    if (ex) return ex;
    const W = b.W, H = b.H, nH = b.nH;
    const hLineId = (i, j) => i * (H + 1) + j;        // i in [0,W), j in [0,H]
    const vLineId = (i, j) => nH + i * (W + 1) + j;   // i in [0,H), j in [0,W]
    const boxes = [];
    for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
            boxes.push({
                edges: [
                    { line: hLineId(x, y),     nb: y > 0     ? (y - 1) * W + x : -1 }, // top
                    { line: hLineId(x, y + 1), nb: y < H - 1 ? (y + 1) * W + x : -1 }, // bottom
                    { line: vLineId(y, x),     nb: x > 0     ? y * W + (x - 1) : -1 }, // left
                    { line: vLineId(y, x + 1), nb: x < W - 1 ? y * W + (x + 1) : -1 }, // right
                ],
            });
        }
    }
    ex = { boxes };
    extrasCache.set(key, ex);
    return ex;
}

export function computeSides(b, hBits, vBits) {
    const sides = new Uint8Array(b.boxes.length);
    for (let bi = 0; bi < sides.length; bi++) {
        sides[bi] = popcount(hBits & b.boxes[bi].hMask) + popcount(vBits & b.boxes[bi].vMask);
    }
    return sides;
}

// Fully decomposed: no box has 0 or 1 sides (claimed boxes have 4).
export function isDecomposed(sides) {
    for (let i = 0; i < sides.length; i++) {
        if (sides[i] < 2) return false;
    }
    return true;
}

function lineTaken(b, hBits, vBits, lineId) {
    if (lineId < b.nH) return (hBits & b.hMasks[lineId]) !== 0n;
    return (vBits & b.vMasks[lineId - b.nH]) !== 0n;
}

// Extract components with buildRegions semantics: connected components of
// boxes with 2..3 sides linked by shared UNTAKEN edges. Loop iff every
// untaken edge of every box in the region is shared with another box of
// the region (AIEngineHeuristic.isLoop).
export function extractComponents(b, hBits, vBits, sides) {
    const ex = boardExtras(b);
    const N = b.boxes.length;
    const visited = new Uint8Array(N);
    const comps = [];
    for (let s = 0; s < N; s++) {
        if (visited[s] || sides[s] < 2 || sides[s] > 3) continue;
        const region = [];
        const stack = [s];
        visited[s] = 1;
        while (stack.length) {
            const bi = stack.pop();
            region.push(bi);
            for (const e of ex.boxes[bi].edges) {
                if (e.nb < 0 || visited[e.nb]) continue;
                if (sides[e.nb] < 2 || sides[e.nb] > 3) continue;
                if (!lineTaken(b, hBits, vBits, e.line)) {
                    visited[e.nb] = 1;
                    stack.push(e.nb);
                }
            }
        }
        const rset = new Set(region);
        let loop = true;
        let threes = 0;
        for (const bi of region) {
            if (sides[bi] === 3) threes++;
            for (const e of ex.boxes[bi].edges) {
                if (lineTaken(b, hBits, vBits, e.line)) continue;
                if (e.nb < 0 || !rset.has(e.nb)) { loop = false; }
            }
        }
        comps.push({ n: region.length, loop, threes });
    }
    return comps;
}

// ---------------------------------------------------------------------------
// Micro-state component game.
// A micro component is one of:
//   { ring: n }            cycle, n >= 3
//   { n, a, b }            path, ends' untaken counts a, b in {1, 2} (n >= 2)
//   { single: u }          one box with u in {1, 2} untaken edges
// ---------------------------------------------------------------------------
let anomalies = 0;
export function getAnomalies() { return anomalies; }

export function toMicro(c) {
    if (c.loop && c.threes === 0) {
        if (c.n < 3) { anomalies++; return { n: c.n, a: 1, b: 1 }; }
        return { ring: c.n };
    }
    if (c.loop && c.threes === 2) return { n: c.n, a: 1, b: 1 };
    if (!c.loop && c.threes === 0) return c.n === 1 ? { single: 2 } : { n: c.n, a: 2, b: 2 };
    if (!c.loop && c.threes === 1) return c.n === 1 ? { single: 1 } : { n: c.n, a: 1, b: 2 };
    // Geometrically impossible in decomposed positions; best-effort map.
    anomalies++;
    if (c.n === 1) return { single: Math.max(1, 4 - (c.threes + 2)) };
    return { n: c.n, a: 1, b: 1 };
}

function microKey(c) {
    if (c.ring) return "O" + c.ring;
    if (c.single) return "S" + c.single;
    return "P" + c.n + "." + Math.min(c.a, c.b) + Math.max(c.a, c.b);
}

function stateKey(state) {
    return state.map(microKey).sort().join(" ");
}

const gameMemo = new Map();

// All distinct results of one move inside component C.
// Returns [{ gain, pass, pieces }] — pieces replace C (may be []).
function microMoves(C) {
    const out = [];
    const seen = new Set();
    const push = (gain, pass, pieces) => {
        const k = gain + "|" + (pass ? 1 : 0) + "|" + pieces.map(microKey).sort().join(",");
        if (!seen.has(k)) { seen.add(k); out.push({ gain, pass, pieces }); }
    };

    if (C.ring) {
        // Draw any cycle edge: ring becomes a path with both ends offered.
        push(0, true, [{ n: C.ring, a: 1, b: 1 }]);
        return out;
    }
    if (C.single) {
        if (C.single === 2) push(0, true, [{ single: 1 }]);
        else push(1, false, []); // draws the last edge: closes, move again
        return out;
    }
    const { n, a, b } = C; // path, n >= 2
    // Boundary draws at ends with an untaken boundary edge (u == 2).
    if (a === 2) push(0, true, [{ n, a: 1, b }]);
    if (b === 2) push(0, true, [{ n, a, b: 1 }]);
    // Internal edge draws: split between box k and k+1 (k = 1..n-1),
    // counting boxes from the a-end.
    for (let k = 1; k <= n - 1; k++) {
        let gain = 0;
        const pieces = [];
        // Left piece: boxes 1..k. Box k's untaken count before the draw:
        // (k == 1 ? a : 2); the draw removes 1.
        const ku = (k === 1 ? a : 2) - 1;
        if (ku === 0) {
            gain += 1; // box k was a 3-sided end and closes; no left piece
        } else if (k === 1) {
            pieces.push({ single: ku });
        } else {
            pieces.push({ n: k, a, b: ku });
        }
        // Right piece: boxes k+1..n. Box k+1's untaken count before:
        // (k + 1 == n ? b : 2); the draw removes 1.
        const ku2 = (k + 1 === n ? b : 2) - 1;
        if (ku2 === 0) {
            gain += 1;
        } else if (k + 1 === n) {
            pieces.push({ single: ku2 });
        } else {
            pieces.push({ n: n - k, a: ku2, b });
        }
        push(gain, gain === 0, pieces);
    }
    return out;
}

export function microGameValue(stateIn) {
    const state = stateIn.filter(c => c);
    return microGameValueAB(state, -Infinity, Infinity);
}

// Alpha-beta over the micro game with a bound-typed transposition table
// (textbook scheme: entries are EXACT, LOWER (fail-high), or UPPER
// (fail-low); a plain "cache non-pruned values as exact" rule — the one
// the exact solver gets away with thanks to fresh TTs per root move —
// produced a wrong value here because this memo is shared across all
// calls and windows). The top-level call uses a full window, so its
// result is the exact game value.
const FLAG_EXACT = 0, FLAG_LOWER = 1, FLAG_UPPER = 2;
function microGameValueAB(state, alpha, beta) {
    if (state.length === 0) return 0;
    const key = stateKey(state);
    const ent = gameMemo.get(key);
    if (ent !== undefined) {
        if (ent.flag === FLAG_EXACT) return ent.v;
        if (ent.flag === FLAG_LOWER) alpha = Math.max(alpha, ent.v);
        else beta = Math.min(beta, ent.v);
        if (alpha >= beta) return ent.v;
    }
    const alphaStart = alpha;

    const actions = [];
    for (let i = 0; i < state.length; i++) {
        const rest = state.slice(0, i).concat(state.slice(i + 1));
        for (const mv of microMoves(state[i])) {
            actions.push({ mv, next: rest.concat(mv.pieces) });
        }
    }
    actions.sort((x, y) => y.mv.gain - x.mv.gain);

    let best = -Infinity;
    for (const { mv, next } of actions) {
        const val = mv.pass
            ? -microGameValueAB(next, -beta, -alpha)
            : mv.gain + microGameValueAB(next, alpha - mv.gain, beta - mv.gain);
        if (val > best) best = val;
        if (best > alpha) alpha = best;
        if (alpha >= beta) break;
    }
    const flag = best <= alphaStart ? FLAG_UPPER : (best >= beta ? FLAG_LOWER : FLAG_EXACT);
    const prev = gameMemo.get(key);
    if (!prev || prev.flag !== FLAG_EXACT) {
        if (gameMemo.size > 2000000) gameMemo.clear();
        gameMemo.set(key, { v: best, flag });
    }
    return best;
}

// Component game value from extractor components [{n, loop, threes}].
export function componentGameValue(comps) {
    return microGameValue(comps.map(toMicro));
}

// controlValue for a bitboard position. REQUIRES the position to be fully
// decomposed (all boxes >= 2 sides); throws otherwise. Returns
// { value, comps, unclaimed } — value = net differential for the player
// to move over the unclaimed boxes.
export function controlValue(b, hBits, vBits, sides) {
    const s = sides || computeSides(b, hBits, vBits);
    if (!isDecomposed(s)) throw new Error("controlValue: position is not fully decomposed");
    const comps = extractComponents(b, hBits, vBits, s);
    const unclaimed = comps.reduce((acc, c) => acc + c.n, 0);
    return { value: microGameValue(comps.map(toMicro)), comps, unclaimed };
}

// ---------------------------------------------------------------------------
// Exact solver returning the value (clone of AIEngineHybrid's solveRec:
// negamax + alpha-beta, TT caches only non-pruned values). Returns the net
// differential for the player to move, or null if the node cap is hit.
// ---------------------------------------------------------------------------
class SolverAbort extends Error {}

function boxSidesLocal(b, box, hBits, vBits) {
    return popcount(hBits & box.hMask) + popcount(vBits & box.vMask);
}

function solveRecVal(b, hBits, vBits, turn, alpha, beta, tt, counter, nodeCap) {
    if ((counter.n & 511) === 0 && counter.n > nodeCap) throw new SolverAbort();
    counter.n++;
    const key = hBits.toString(36) + "|" + vBits.toString(36) + "|" + turn;
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
            if (boxSidesLocal(b, b.boxes[bi], hBits, vBits) === 3) { isTake = true; break; }
        }
        (isTake ? takes : rest).push(m);
    }

    let best = -Infinity;
    for (const m of takes.concat(rest)) {
        let nh = hBits, nv = vBits;
        if (m < b.nH) nh |= b.hMasks[m]; else nv |= b.vMasks[m - b.nH];
        let closed = 0;
        for (const bi of b.lineBoxes[m]) {
            if (boxSidesLocal(b, b.boxes[bi], nh, nv) === 4) closed++;
        }
        let val;
        if (closed > 0) {
            // 2026-10-26: closing window MUST shift by closed (see
            // SolverCutoff.js header); unshifted windows overvalued
            // positions (witness: 5x5 E17, expansion said 6/8, true 4).
            val = closed + solveRecVal(b, nh, nv, turn, alpha - closed, beta - closed, tt, counter, nodeCap);
        } else {
            val = -solveRecVal(b, nh, nv, 1 - turn, -beta, -alpha, tt, counter, nodeCap);
        }
        if (val > best) best = val;
        if (best > alpha) alpha = best;
        if (alpha >= beta) break;
    }
    // Bound-typed store: the old "cache iff not pruned" rule cached
    // fail-low UPPER bounds as exact. See SolverCutoff.js header.
    const flag = best <= alphaOrig ? FLAG_UPPER : (best >= betaOrig ? FLAG_LOWER : FLAG_EXACT);
    tt.set(key, { v: best, flag });
    return best;
}

export function solveValueExact(b, hBits, vBits, nodeCap = 4000000) {
    // Mirror solveRoot's discipline exactly: each root move is evaluated
    // with a FRESH transposition table and a full window, and the position
    // value is the max over root moves. (A single shared-TT search lets
    // alpha-beta bounds from one root move's subtree contaminate another's
    // cached "exact" values — observed in validation: one corpus position
    // read 9 under a shared TT vs the true 7 produced by solveRoot play.)
    const counter = { n: 0 };
    const moves = emptyLines(b, hBits, vBits);
    if (moves.length === 0) return { value: 0, nodes: 0 };
    const takes = [], rest = [];
    for (const m of moves) {
        let isTake = false;
        for (const bi of b.lineBoxes[m]) {
            if (boxSidesLocal(b, b.boxes[bi], hBits, vBits) === 3) { isTake = true; break; }
        }
        (isTake ? takes : rest).push(m);
    }
    let best = -Infinity;
    try {
        for (const m of takes.concat(rest)) {
            const tt = new Map();
            let nh = hBits, nv = vBits;
            if (m < b.nH) nh |= b.hMasks[m]; else nv |= b.vMasks[m - b.nH];
            let closed = 0;
            for (const bi of b.lineBoxes[m]) {
                if (boxSidesLocal(b, b.boxes[bi], nh, nv) === 4) closed++;
            }
            const val = closed > 0
                ? closed + solveRecVal(b, nh, nv, 1, -Infinity, Infinity, tt, counter, nodeCap)
                : -solveRecVal(b, nh, nv, 0, -Infinity, Infinity, tt, counter, nodeCap);
            if (val > best) best = val;
        }
    } catch (e) {
        if (e instanceof SolverAbort) return null;
        throw e;
    }
    return { value: best, nodes: counter.n };
}

export { buildBoard, fromMatrices, emptyLines };
