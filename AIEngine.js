// AIEngine.js
//
// AIEngine: the three-level Dots and Boxes AI. Each move is
// decided by exactly one step of a three-step cascade, checked
// in order:
//
//   Step 1 (allcock):   fully decomposed AND every component in the
//                       Allcock domain (rings >= 4, fresh chains
//                       >= 3) -> ControlValue.allcockMove (exact
//                       play from the control recursion; no size
//                       gate). Intermediate and advanced take
//                       this step; beginner skips it.
//   Step 2 (minimax):   minimax-with-cutoff (solveRootCutoff) under
//                       a flat 5s wall-clock budget, attempted on
//                       every position the GateModel equation does
//                       not screen out as hopeless (see GATE
//                       CONFIGURATION below); on a budget abort the
//                       best fully-scored root move is salvaged
//                       when one exists, else the move falls
//                       through. ADVANCED ONLY — beginner and
//                       intermediate skip this step entirely.
//   Step 3 (heuristic): AIEngineHeuristic play (chooseFallbackMove):
//                       offered positions go to the controller /
//                       greedy logic ('heuristic-offer'), quiet
//                       positions to the opener ('heuristic-quiet').
//
// History: the cascade grew by accretion (a gated evaluator step,
// MCTS phases, a legacy exact solver) and was refactored to this
// shape 2026-11-06 (PR #87); the MCTS code and the heuristic's
// legacy chooseMove were removed the same day at Mike's direction.
// solveRoot below is retained as the reference exact solver.

import AIEngineHeuristic from "./AIEngineHeuristic.js";
import { solveRootCutoff, SolverAbort as CutoffAbort } from "./SolverCutoff.js";
import { gatePrediction } from "./GateModel.js";
import { computeSides, allcockMove } from "./ControlValue.js";
import { buildBoard, fromMatrices, emptyLines, lineToString, boxesClosedBy } from "./Board.js";
// NOTE: step 2 solves via SolverCutoff's decomposition-cutoff
// solver, not the plain expansion solver below (solveRoot is the
// retained reference implementation). Import chain AIEngine ->
// SolverCutoff -> ControlValue has no cycle.

// ---- FIXED CONFIGURATION ----
// minimaxLinesFor: retained for the E==1 phase label and harness
// compatibility (the step-2 admission itself is the GateModel
// screen below, not a line count). Per-size values calibrated
// 2026-10-26 on non-decomposed roots under the worst-case rule.
const MINIMAX_LINES = 15;
const MINIMAX_LINES_BY_SIZE = { 7: 12, 10: 12 };
function minimaxLinesFor(W, H) {
    if (W === H && MINIMAX_LINES_BY_SIZE[W] !== undefined) {
        return MINIMAX_LINES_BY_SIZE[W];
    }
    return MINIMAX_LINES;
}
// GATE CONFIGURATION (2026-11-05; equation refit 2026-11-06):
// the GateModel "Full" equation does not admit step 2 on a fine
// threshold — its multiplicative error (~1.3x median, far worse
// extrapolated) makes any fine line close to arbitrary. It serves
// only as a hopelessness screen: positions predicted at
// GATE_ATTEMPT_MAX_SEC or more are skipped (the heuristic plays
// instantly); everything below is attempted under a flat
// GATE_SOLVE_CAP_MS wall-clock budget on whatever device is
// running it, and on SolverAbort the search salvages its best
// fully-scored root move when it has one, otherwise falls through
// to the heuristic below.
// The equation was refit 2026-11-06 against the current solver
// (192 D* positions re-timed; see GateModel.js). The 1000s screen
// was RETAINED, now in refit-equation seconds, from the
// 2026-11-06 cliff probe (144 step-2 positions under the
// refactored cascade: 107 self-play snapshots + 37 scatter rows,
// one production-faithful 5s laptop attempt each; 85 positions
// yield a completed or salvaged move): with the refit equation,
// cutoff 300s captures 79/85 yield for 6 wasted attempts, 1000s
// captures 81/85 for the same 6 (+2/+0 — pure gain), and 10000s
// captures 84/85 for 9 (+3/+3 — a wash at a higher burn rate), so
// the marginal value per wasted attempt still collapses above
// 1000s. Against the incumbent (old equation at 1000s: 73/85
// captured, 5 wasted, 12 yieldable skipped), the refit at 1000s
// buys +8 yieldable positions for +1 wasted attempt.
// DEADLINE SOUNDNESS vs the cutoff's micro game: solveRootCutoff
// checks the deadline between search nodes, but a single
// componentGameValue call at a cutoff node is NOT deadline-
// checked; since the PR #80 evaluator prunings the worst recorded
// such call is ~0.2s, so a solve can overshoot the cap by at most
// roughly that, once.
// minimaxLinesFor is retained for the E==1 phase label and harness
// compatibility.
const GATE_ATTEMPT_MAX_SEC = 1000;
const GATE_SOLVE_CAP_MS = 5000;


function popcount(b) {
    let c = 0;
    while (b) { c++; b &= b - 1n; }
    return c;
}

// ---------------------------------------------------------------------------
// Board helpers (buildBoard, fromMatrices, emptyLines, lineToString,
// boxesClosedBy) now live in Board.js and are imported below; the engine
// re-exports the ones its harness-facing surface needs.
// ---------------------------------------------------------------------------


function boxSides(b, box, hBits, vBits) {
    return popcount(hBits & box.hMask) + popcount(vBits & box.vMask);
}



function withLine(b, hBits, vBits, lineId) {
    if (lineId < b.nH) return { hBits: hBits | (1n << BigInt(lineId)), vBits };
    return { hBits, vBits: vBits | (1n << BigInt(lineId - b.nH)) };
}


// ---------------------------------------------------------------------------
// Exact solver: negamax + alpha-beta + transposition table (corrected
// version, identical to the retired hybrid engine's: fresh TT per root move, only
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

export default class AIEngine {
    constructor(options = {}) {
        this.level = options.level ?? 'advanced'; // 'beginner': step 3 only; 'intermediate': steps 1+3; 'advanced': all steps
        this.heuristic = new AIEngineHeuristic();
        this.lastExact = false;
        this.lastPhase = null;   // 'allcock' | 'minimax' | 'heuristic-offer' | 'heuristic-quiet'
        this.lastMinimaxAborted = false; // true when step 2 aborted and the move fell through (or was salvaged)
        this.lastPredSec = null;  // GateModel prediction (laptop-scale seconds) when step 2 evaluated the gate, else null
        this.lastSolveMs = null;  // wall time of the step-2 solve attempt (success or abort), else null
    }

    async move(h, v, squaresLeft) {
        const W = h.length, H = v.length;
        const b = buildBoard(W, H);
        const { hBits, vBits } = fromMatrices(b, h, v);
        const moves = emptyLines(b, hBits, vBits);
        const E = moves.length;
        this.lastExact = false;
        this.lastMinimaxAborted = false;
        this.lastPredSec = null;
        this.lastSolveMs = null;

        // CASCADE, checked in order at every move.
        //
        // Step 1 — heuristicAllcock (2026-11-06 refactor): a fully
        // decomposed position whose components are ALL in the
        // Allcock domain (rings >= 4, fresh chains >= 3) has an
        // exact optimal move from the control recursion alone —
        // ControlValue.allcockMove picks the component to open and
        // returns a canonical entry line. No size/component gate:
        // the cost is the component scan plus the memoized
        // recursion, so even positions the old evaluator step
        // gated out (U > 30) are answered instantly. Intermediate
        // and advanced take this step (it is intermediate's only
        // exact play); beginner skips it — beginner is the pure
        // heuristic of step 3, with no exact play at all.
        const sides = computeSides(b, hBits, vBits);
        if (this.level !== 'beginner') {
            const acLine = allcockMove(b, hBits, vBits, sides);
            if (acLine !== null) {
                this.lastPhase = 'allcock';
                this.lastExact = true;
                return lineToString(b, acLine);
            }
        }

        if (E === 1) {
            // The only legal move — no search happens at any level;
            // the phase label just records how it would have been classed.
            this.lastPhase = (this.level === 'advanced' && E <= minimaxLinesFor(W, H)) ? 'minimax' : 'heuristic-quiet';
            return lineToString(b, moves[0]);
        }

        // Step 2 — minimax-with-cutoff, screened by the GateModel
        // equation (see GATE_ATTEMPT_MAX_SEC above) and budgeted
        // GATE_SOLVE_CAP_MS of wall time.
        // Solved via the decomposition-cutoff solver (same exact
        // values as solveRoot — (b) validated composite 740/740 moves,
        // 720/720 values, 63/63 + 63/63 small-board brute force — but
        // with decomposition cutoff on fully-decomposed nodes). Only
        // SolverAbort falls through — any other throw propagates (a
        // real bug, not a timeout); the cutoff's componentGameValue
        // calls are not deadline-checked, so a solve can overshoot
        // the cap by one component evaluation (bounded, ~0.1s).
        // Beginner and intermediate levels: step 2 is skipped
        // entirely — no gate evaluation, no search; play falls
        // to the heuristic below.
        const gate = this.level === 'advanced' ? gatePrediction(b, hBits, vBits, sides, moves) : null;
        this.lastPredSec = gate ? gate.predSec : null;
        if (gate && gate.predSec < GATE_ATTEMPT_MAX_SEC) {
            const t0 = Date.now();
            // Heuristic-first root ordering: draw the heuristic's
            // move and have the solver evaluate it first
            // (opts.priorityMove), so a cap-aborted solve's salvage
            // is never worse than the move the heuristic would have
            // played — and any other root move completed before the
            // cap can still beat it by exact value. (2026-11-05:
            // under takes-first order, 4/58 recorded salvages were
            // worse than every heuristic-pool move.)
            const hDraw = this.heuristic.chooseFallbackMove(h, v);
            const hStr = hDraw[0] + ',' + hDraw[1] + ',' + hDraw[2];
            let priorityMove = null;
            for (const m of moves) {
                if (lineToString(b, m) === hStr) { priorityMove = m; break; }
            }
            try {
                const res = solveRootCutoff(b, hBits, vBits, moves, Date.now() + GATE_SOLVE_CAP_MS, { priorityMove });
                this.lastSolveMs = Date.now() - t0;
                // res.aborted: the cap fired but at least one root
                // move was fully scored — play the best of those
                // (exact-valued) instead of the heuristic fallback.
                // lastExact stays false: the salvaged move's value
                // is exact, but the choice isn't proven optimal.
                this.lastMinimaxAborted = res.aborted === true;
                this.lastPhase = 'minimax';
                this.lastExact = res.aborted !== true;
                return lineToString(b, res.move);
            } catch (e) {
                // NB: this is SolverCutoff's abort class (aliased), NOT
                // this file's local SolverAbort used by solveRec below.
                if (!(e instanceof CutoffAbort)) throw e;
                this.lastSolveMs = Date.now() - t0;
                this.lastMinimaxAborted = true;
            }
        }

        // Step 3 — heuristic fallback (phases 3 / 1 below): the
        // heuristic proper (chooseFallbackMove — captures,
        // controller/greedy, quiet opener; no evaluator branch).
        // Offer detection (Phase 3 vs quiet), using the heuristic's regions.
        const { offered } = offeredRegions(this.heuristic, h, v);

        // Phase 3: any offer -> heuristic play. (The extended multi-offer
        // controller was removed 2026-10-27: seat-balanced evals showed it
        // losing to plain heuristic play at every size, worst at 10x10.)
        if (offered.length >= 1) {
            this.lastPhase = 'heuristic-offer';
            const m = this.heuristic.chooseFallbackMove(h, v);
            return m[0] + ',' + m[1] + ',' + m[2];
        }

        // Quiet position -> the heuristic's safe opener play.
        this.lastPhase = 'heuristic-quiet';
        const m = this.heuristic.chooseFallbackMove(h, v);
        return m[0] + ',' + m[1] + ',' + m[2];
    }
}

export { buildBoard, fromMatrices, emptyLines, lineToString, solveRoot, countOfferedRegions, offeredRegions, minimaxLinesFor };
