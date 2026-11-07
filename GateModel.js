// GateModel.js
//
// Predicted minimax solve time for a position, from the "Full" equation
// (feature set selected 2026-11-04 on the 192-position D* scatter,
// non-decomposed n=94; features and selection in
// ~/workspace/goals/mcts-engine-improvements/hidden_files/harness/
// dstar-{features,analyze6,analyze7,analyze8,eqdata}).
//
// Coefficients below are the REFIT of 2026-11-06 against the
// CURRENT solver (post evaluator prunings PR #80, Allcock fast
// path PR #84, cascade refactor PR #87), on the same 192 positions
// re-timed uncapped on the laptop (harness retime-current.mjs /
// cur-times.jsonl; n=92 — 2 positions aborted even at a 600s
// guard and were excluded). The Full feature set wins again
// (baseline 0.632 LOO R^2 / 2.24x median factor error; +n3+U
// 0.836 / 1.75x; Full 0.924 / 1.31x), but the coefficients moved
// materially — the solver's speedups were not uniform (the old
// equation's median overestimate on the fit population was only
// 1.26x, yet its factor error was 1.45x vs the refit's 1.31x,
// and on the realistic step-2 cliff population the refit
// dominates it at every cutoff; see AIEngine's GATE note).
//
//   log10(t_sec) = -1.718 + 0.235*E + 0.020*freeMoves + 0.152*D*
//                + 0.145*freeTake + 0.129*takeRunBoxes - 0.907*sideVar
//                - 0.172*U - 2.944*disjointFrac - 2.007*fracChildDec
//
// Cross-validated R^2 0.924 (LOO) / 0.928 (10-fold), median factor
// error 1.31x. Predicted times are LAPTOP-scale seconds; other
// devices scale by their speed factor. Fit support is E <= 22:
// predictions far outside it (e.g. 10x10 positions at E 32-44)
// are extrapolations; production only uses the prediction as a
// coarse hopelessness screen under a hard 5s solve cap (see
// AIEngine), which is the real protection against an
// underestimated tail position.
//
// Feature definitions (identical to the offline extraction):
//   E             empty lines
//   freeMoves     empty lines touching no low box (sides < 2)
//   D*            exact min number of segments whose addition makes
//                 every unclaimed box >= 2-sided (min edge cover of the
//                 low-box demand; branch-and-bound, node-capped — at
//                 the cap the greedy bound stands, biasing D* and the
//                 prediction upward, i.e. conservative)
//   freeTake      free moves that close a box (adjacent box has 3 sides)
//   takeRunBoxes  boxes banked by the greedy forced-take sequence
//   sideVar       variance of side counts over unclaimed boxes
//   U             unclaimed boxes
//   disjointFrac  fraction of empty-line pairs touching disjoint box sets
//   fracChildDec  fraction of root moves after which the position is
//                 fully decomposed (child low count == 0)

import { computeSides } from "./ControlValue.js";

function lineTaken(b, hBits, vBits, lineId) {
    if (lineId < b.nH) return (hBits & b.hMasks[lineId]) !== 0n;
    return (vBits & b.vMasks[lineId - b.nH]) !== 0n;
}

function withLineBits(hBits, vBits, b, lineId) {
    if (lineId < b.nH) return [hBits | b.hMasks[lineId], vBits];
    return [hBits, vBits | b.vMasks[lineId - b.nH]];
}

// The D* covering instance: demands per low box (2 - sides) and the
// candidate segments (untaken lines touching >= 1 low box), each as the
// list of low-box indices it touches. Ported from harness dstar.mjs.
export function coverInstance(b, hBits, vBits, sides) {
    const lowOf = new Int32Array(b.boxes.length).fill(-1);
    const demand = [];
    for (let i = 0; i < sides.length; i++) {
        if (sides[i] < 2) {
            lowOf[i] = demand.length;
            demand.push(2 - sides[i]);
        }
    }
    const segs = [];
    for (let line = 0; line < b.L; line++) {
        if (lineTaken(b, hBits, vBits, line)) continue;
        const touched = [];
        for (const bi of b.lineBoxes[line]) {
            const k = lowOf[bi];
            if (k >= 0) touched.push(k);
        }
        if (touched.length) segs.push(touched);
    }
    return { demand, segs, low: demand.length };
}

// Exact minimum cover count (greedy bound + branch-and-bound). At the
// node cap the best bound found stands (never below the true D*).
export function minCoverCount(demandIn, segs, nodeCap = 50000) {
    const demand = demandIn.slice();
    const total = demand.reduce((a, c) => a + c, 0);
    if (total === 0) return 0;
    const incident = Array.from({ length: demand.length }, () => []);
    segs.forEach((t, s) => { for (const k of t) incident[k].push(s); });

    function greedy() {
        const rem = demand.slice();
        const used = new Array(segs.length).fill(false);
        let count = 0, remTotal = total;
        while (remTotal > 0) {
            let bestS = -1, bestCov = 0;
            for (let s = 0; s < segs.length; s++) {
                if (used[s]) continue;
                let cov = 0;
                for (const k of segs[s]) if (rem[k] > 0) cov++;
                if (cov > bestCov) { bestCov = cov; bestS = s; }
            }
            if (bestS < 0) return Infinity;
            used[bestS] = true; count++;
            for (const k of segs[bestS]) if (rem[k] > 0) { rem[k]--; remTotal--; }
        }
        return count;
    }

    let best = greedy();
    if (best === Math.ceil(total / 2)) return best;

    const rem = demand.slice();
    const used = new Array(segs.length).fill(false);
    let nodes = 0, capped = false;
    function dfs(chosen, remTotal) {
        if (remTotal === 0) { if (chosen < best) best = chosen; return; }
        if (capped) return;
        if (++nodes > nodeCap) { capped = true; return; }
        let maxRem = 0;
        for (let k = 0; k < demand.length; k++) if (rem[k] > maxRem) maxRem = rem[k];
        if (chosen + Math.max(Math.ceil(remTotal / 2), maxRem) >= best) return;
        let bOpts = null;
        for (let k = 0; k < demand.length; k++) {
            if (rem[k] === 0) continue;
            const opts = [];
            for (const s of incident[k]) if (!used[s]) opts.push(s);
            if (!bOpts || opts.length < bOpts.length) { bOpts = opts; if (opts.length <= 1) break; }
        }
        const scored = bOpts.map(s => {
            let cov = 0;
            for (const k of segs[s]) if (rem[k] > 0) cov++;
            return [cov, s];
        }).sort((a, b2) => b2[0] - a[0]);
        for (const [, s] of scored) {
            const hit = [];
            for (const k of segs[s]) if (rem[k] > 0) hit.push(k);
            used[s] = true;
            for (const k of hit) rem[k]--;
            dfs(chosen + 1, remTotal - hit.length);
            for (const k of hit) rem[k]++;
            used[s] = false;
            if (capped) return;
        }
    }
    dfs(0, total);
    return best;
}

// Full gate evaluation for a position. `moves` is the empty-line list
// (Board.emptyLines). Returns the predicted solve time in seconds
// (laptop scale) plus the feature vector, for diagnostics.
export function gatePrediction(b, hBits, vBits, sides, moves) {
    const E = moves.length;
    let U = 0, sideSum = 0, low = 0;
    for (let i = 0; i < sides.length; i++) {
        if (sides[i] < 4) { U++; sideSum += sides[i]; }
        if (sides[i] < 2) low++;
    }
    const mean = U ? sideSum / U : 0;
    let sideVar = 0;
    if (U) {
        let acc = 0;
        for (let i = 0; i < sides.length; i++) if (sides[i] < 4) acc += (sides[i] - mean) ** 2;
        sideVar = acc / U;
    }

    const inst = coverInstance(b, hBits, vBits, sides);
    const dstar = minCoverCount(inst.demand, inst.segs);
    const freeMoves = E - inst.segs.length;

    // freeTake: free moves (touching no low box) that close a box.
    let freeTake = 0;
    for (const line of moves) {
        let isCand = false, closes = false;
        for (const bi of b.lineBoxes[line]) {
            if (sides[bi] < 2) isCand = true;
            if (sides[bi] === 3) closes = true;
        }
        if (!isCand && closes) freeTake++;
    }

    // takeRunBoxes: boxes banked by repeatedly playing the move that
    // closes the most boxes (ties: lowest line id, as extracted offline).
    let takeRunBoxes = 0;
    {
        let h = hBits, v = vBits;
        for (;;) {
            const sd = computeSides(b, h, v);
            let bestLine = -1, bestClosed = 0;
            for (let line = 0; line < b.L; line++) {
                if (lineTaken(b, h, v, line)) continue;
                let c = 0;
                for (const bi of b.lineBoxes[line]) if (sd[bi] === 3) c++;
                if (c > bestClosed) { bestClosed = c; bestLine = line; }
            }
            if (bestLine < 0) break;
            [h, v] = withLineBits(h, v, b, bestLine);
            takeRunBoxes += bestClosed;
        }
    }

    // disjointFrac: fraction of empty-line pairs with disjoint box sets.
    let disjointFrac = 0;
    if (E >= 2) {
        let pairs = 0, disjoint = 0;
        for (let i = 0; i < E; i++) {
            for (let j = i + 1; j < E; j++) {
                pairs++;
                const a = b.lineBoxes[moves[i]], c = b.lineBoxes[moves[j]];
                if (!a.some(bi => c.includes(bi))) disjoint++;
            }
        }
        disjointFrac = disjoint / pairs;
    }

    // fracChildDec: fraction of root moves leaving no low box. A box
    // leaves the low set exactly on its 1 -> 2 side transition.
    let fracChildDec = 0;
    if (E >= 1) {
        let dec = 0;
        for (const line of moves) {
            let childLow = low;
            for (const bi of b.lineBoxes[line]) if (sides[bi] === 1) childLow--;
            if (childLow === 0) dec++;
        }
        fracChildDec = dec / E;
    }

    const log10Sec = -1.718 + 0.235 * E + 0.020 * freeMoves + 0.152 * dstar
        + 0.145 * freeTake + 0.129 * takeRunBoxes - 0.907 * sideVar
        - 0.172 * U - 2.944 * disjointFrac - 2.007 * fracChildDec;
    return {
        predSec: 10 ** log10Sec,
        log10Sec,
        features: { E, freeMoves, dstar, freeTake, takeRunBoxes, sideVar, U, disjointFrac, fracChildDec },
    };
}
