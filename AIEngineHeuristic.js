import { buildBoard, fromMatrices, emptyLines } from "./Board.js";
import { controlValue, computeSides, isDecomposed, extractComponents } from "./ControlValue.js";

// EVALUATOR GATE (component (d) cascade, 2026-10-26): the evaluator
// branch below is exact but its cost is E child controlValue calls, and
// child multisets break the parent's memo symmetry — so parent cost does
// NOT predict branch cost (10x10 all-horizontal-lines parent: 116ms cold,
// full branch: minutes). Measured branch cost vs unclaimed boxes U
// (harness/cascade-gate.jsonl + cascade-gate-synth.mjs, contended VM):
//   U <= 25: max 94.8ms (n=111, incl. cold 5x5 first-branch 37-39ms)
//   U 26-30: max 62.7ms warm (n=5); cold 7x7 U=20: 52.5ms, U=23: 24.9ms
//   U >= 32: 907.5ms (7x7), 778.3ms (7x7); U=45/47 cold: 422/645ms;
//            10x10 U=81-100: parent cv 604ms, branch minutes-scale
// So the branch runs only when U <= EVALUATOR_MAX_UNCLAIMED (30). Above
// it, the position falls through to the controller/opener logic below
// (the pre-evaluator behavior: safe, just not perfect). 5x5 positions
// always satisfy U <= 25, so this gate never changes 5x5 play and the
// component-(a) verification (cases 1-9 identity, cases 10/11 flip,
// 837-position non-decomposed identity) is unaffected by construction.
// AIEngine applies the same gate before calling chooseMove so
// the cascade's step-1 attribution is explicit; this in-branch gate is
// the backstop that makes the cap hold for every caller.
//
// GATE v2 (2026-10-26, after a cold-cache counterexample): U alone does
// NOT bound cold cost. A random 7x7 decomposed position with U=29 but 14
// components took 3573.9ms cold (first call; 0.5ms warm) — the micro
// game's state space grows with the multiset's component structure, and
// cold children share no memo. A second, U=28 / 12-component position
// took 452.6ms cold. Both are excluded by EVALUATOR_MAX_COMPONENTS
// (10): all observed cold in-gate branch totals with <= 10 components
// are <= 82.7ms (7x7 U=21 / 9 comps; 5x5 cold first-branch 37-39ms).
// Component count is a weak predictor (a 12-component position also
// measured 1.9ms cold), so the count cap is deliberately lossy — it
// excludes some cheap positions — and the per-child deadline below is
// the real backstop for multisets the structural gate underestimates:
// the branch abandons (falls through, consuming no Math.random) once
// evaluatorBudgetMs elapses between child evaluations. Worst case is
// then deadline + one child evaluation, not minutes. Default budget
// 1200ms (80% of the 1500ms VM budget), shared by AIEngineHeuristic
// and AIEngine — the budgets are intentionally identical.
export const EVALUATOR_MAX_UNCLAIMED = 30;
export const EVALUATOR_MAX_COMPONENTS = 10;
export const EVALUATOR_BUDGET_MS = 1200;

export default class AIEngineHeuristic {
    constructor() {
        this.h = [];
        this.v = [];
        this.squares = [];
        this.x = undefined;
        this.y = undefined;
        this.twos = [];
        this.visited = [];
        this.smallestArea = [];
        this.curArea = [];
        this.touchedOnes = [];
        // Per-child evaluator-branch deadline (ms); see gate comment
        // above. Shared by both engines; default 1200ms.
        this.evaluatorBudgetMs = EVALUATOR_BUDGET_MS;
        // Set by chooseMove: true iff the evaluator branch timed out on
        // the most recent call (false when the branch was not entered or
        // completed). Lets AIEngine fall through to minimax on a
        // branch timeout instead of returning the fallback move as an
        // 'evaluator' decision.
        this.evaluatorTimedOut = false;
    }
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
    async move(h,v) {

        await this.sleep(100);

        const m = this.chooseMove(h,v);
        return m[0]+','+m[1]+','+m[2];
    }
    // Synchronous move choice.
    //
    // Two modes:
    //  - CONTROLLER (3-sided boxes exist): the opponent has offered a
    //    component. Apply the double-cross / hard-hearted handout: take a
    //    long component down to all-but-2 (chain) or all-but-4 (loop), then
    //    "ripen" the rest (play an interior edge that makes boxes 3-sided
    //    without taking anything) so the opponent must take them and open
    //    the next component. Short offered chains are ripened immediately
    //    rather than taken. Take everything only when no other significant
    //    component remains.
    //  - OPENER (no takes): safe moves first, then open the smallest
    //    pendant chain at an end (falling back to the smallest 2-area).
    chooseMove(h,v) {
        this.evaluatorTimedOut = false;

        // EVALUATOR BRANCH: fully decomposed positions (every remaining
        // box in a chain/loop component) are solved exactly at the
        // component level. Children of decomposed positions stay
        // decomposed, so controlValue is exact on every child. For each
        // legal move, value = closed + cv(child) if it closes boxes,
        // else -cv(child) (negamax: a non-closing move passes the turn).
        // Argmax wins; ties break randomly, as elsewhere in this engine.
        // Non-decomposed positions fall through to the existing logic
        // below, unchanged (this branch consumes no Math.random, so the
        // fall-through random stream is identical to the pre-branch code).
        // Move-convention note: bitboard line ids map back exactly as
        // Board.lineToString does: h id -> ['h', col, row],
        // v id -> ['v', row, col], matching this engine's ['h', j, i] /
        // ['v', i, j] returns (h[j][i] / v[i][j]).
        {
            const W = h.length, H = v.length;
            const b = buildBoard(W, H);
            const { hBits, vBits } = fromMatrices(b, h, v);
            const sides = computeSides(b, hBits, vBits);
            // Gate (see EVALUATOR_MAX_UNCLAIMED / EVALUATOR_MAX_COMPONENTS
            // above): the branch runs only when unclaimed boxes AND
            // component count are within the gate; above either, execution
            // falls through to controller/opener logic below (consuming
            // no Math.random, exactly as the non-decomposed path does).
            // Inside the branch, a per-child deadline (evaluatorBudgetMs)
            // abandons the evaluation — again falling through with no
            // random consumed — so no multiset can stall the move.
            const decomposed = isDecomposed(sides);
            let evalInGate = false;
            if (decomposed) {
                const comps = extractComponents(b, hBits, vBits, sides);
                let unclaimed = 0;
                for (const c of comps) unclaimed += c.n;
                evalInGate = unclaimed <= EVALUATOR_MAX_UNCLAIMED
                    && comps.length <= EVALUATOR_MAX_COMPONENTS;
            }
            if (decomposed && evalInGate) {
                const moves = emptyLines(b, hBits, vBits);
                if (moves.length > 0) {
                    let bestVal = -Infinity;
                    let best = [];
                    let timedOut = false;
                    const t0 = Date.now();
                    for (const id of moves) {
                        if (Date.now() - t0 > this.evaluatorBudgetMs) { timedOut = true; break; }
                        let chBits, cvBits;
                        if (id < b.nH) { chBits = hBits | b.hMasks[id]; cvBits = vBits; }
                        else { chBits = hBits; cvBits = vBits | b.vMasks[id - b.nH]; }
                        const childSides = computeSides(b, chBits, cvBits);
                        // Boxes closed by this move: side count 3 -> 4.
                        // Only boxes adjacent to the played line change,
                        // so this count is exact.
                        let closed = 0;
                        for (let bi = 0; bi < childSides.length; bi++) {
                            if (sides[bi] === 3 && childSides[bi] === 4) closed++;
                        }
                        const cv = controlValue(b, chBits, cvBits, childSides).value;
                        const val = closed > 0 ? closed + cv : -cv;
                        if (val > bestVal) { bestVal = val; best = [id]; }
                        else if (val === bestVal) best.push(id);
                    }
                    if (!timedOut) {
                        const id = best[Math.floor(Math.random() * best.length)];
                        if (id < b.nH) return ['h', Math.floor(id / (H + 1)), id % (H + 1)];
                        const k = id - b.nH;
                        return ['v', Math.floor(k / (W + 1)), k % (W + 1)];
                    }
                    // Timed out: flag it (so the cascade can fall through
                    // to minimax) and fall through to controller/opener
                    // below for callers that use the return directly.
                    this.evaluatorTimedOut = true;
                }
                // No legal moves: fall through to existing logic (as before).
            }
        }

        this.h = h;
        this.v = v;
        this.x = this.h.length;
        this.y = this.v.length;
        this.countSquares();

        const threes = [];
        for (let i = 0; i < this.y; i++) {
            for (let j = 0; j < this.x; j++) {
                if (this.squares[i][j] == 3) threes.push([i,j]);
            }
        }

        if (threes.length > 0) {
            const m = this.controllerMove(threes);
            if (m) return m;
            return this.greedyTake(threes);
        }
        return this.openerMove();
    }
    // ---- board helpers ----
    // squares[i][j]: i = row (0..y-1), j = col (0..x-1).
    // h[j][i] = top edge of (i,j); v[i][j] = left edge of (i,j).
    // Move notation: ['h', j, i] draws h[j][i]; ['v', i, j] draws v[i][j].
    neighbors(i,j) {
        const out = [];
        if (i > 0) out.push([i-1,j]);
        if (i < this.y-1) out.push([i+1,j]);
        if (j > 0) out.push([i,j-1]);
        if (j < this.x-1) out.push([i,j+1]);
        return out;
    }
    sharedEdge(i,j,ni,nj) {
        if (ni == i-1) return ['h', j, i];
        if (ni == i+1) return ['h', j, i+1];
        if (nj == j-1) return ['v', i, j];
        if (nj == j+1) return ['v', i, j+1];
        return null;
    }
    edgeTaken(e) {
        return e[0] == 'h' ? this.h[e[1]][e[2]] != 0 : this.v[e[1]][e[2]] != 0;
    }
    untakenEdges(i,j) {
        const out = [];
        if (this.h[j][i] == 0) out.push(['h',j,i]);
        if (this.h[j][i+1] == 0) out.push(['h',j,i+1]);
        if (this.v[i][j] == 0) out.push(['v',i,j]);
        if (this.v[i][j+1] == 0) out.push(['v',i,j+1]);
        return out;
    }
    // boxes adjacent to edge e: [boxA, boxB-or-null]
    edgeBoxes(e) {
        if (e[0] == 'h') {
            const a = e[2]-1 >= 0 ? [e[2]-1, e[1]] : null;
            const b = e[2] < this.y ? [e[2], e[1]] : null;
            return [a,b];
        }
        const a = e[2]-1 >= 0 ? [e[1], e[2]-1] : null;
        const b = e[2] < this.x ? [e[1], e[2]] : null;
        return [a,b];
    }
    // Connected components of unclaimed boxes with >= 2 sides, linked by
    // shared untaken edges. Each component is a chain, a loop, or a blob.
    buildRegions() {
        const visited = Array.from({ length: this.y }, () => Array(this.x).fill(false));
        const regions = [];
        for (let i = 0; i < this.y; i++) {
            for (let j = 0; j < this.x; j++) {
                if (this.squares[i][j] < 2 || this.squares[i][j] > 3 || visited[i][j]) continue;
                const region = [];
                const stack = [[i,j]];
                visited[i][j] = true;
                while (stack.length > 0) {
                    const [a,b] = stack.pop();
                    region.push([a,b]);
                    for (const [na,nb] of this.neighbors(a,b)) {
                        if (visited[na][nb]) continue;
                        const s = this.squares[na][nb];
                        if (s < 2 || s > 3) continue;
                        if (!this.edgeTaken(this.sharedEdge(a,b,na,nb))) {
                            visited[na][nb] = true;
                            stack.push([na,nb]);
                        }
                    }
                }
                regions.push(region);
            }
        }
        return regions;
    }
    // A region is a loop iff every untaken edge of every box in it is shared
    // with another box in the region. Otherwise it's a chain (it "leaks").
    isLoop(region) {
        const rset = new Set(region.map(([i,j]) => i+','+j));
        for (const [i,j] of region) {
            for (const e of this.untakenEdges(i,j)) {
                const [a,b] = this.edgeBoxes(e);
                for (const nb of [a,b]) {
                    if (!nb) return false; // boundary edge: chain
                    if (nb[0] == i && nb[1] == j) continue;
                    if (!rset.has(nb[0]+','+nb[1])) return false;
                }
            }
        }
        return true;
    }
    // True when some untaken edge touches only boxes with <2 sides --
    // a move that creates no 3-sided box. (The same safety notion as
    // openerMove's first pass; an edge on the board boundary touches
    // one box, which decides alone.)
    existsSafeMove() {
        for (let j = 0; j < this.x; j++)
            for (let i = 0; i <= this.y; i++) {
                if (this.h[j][i] != 0) continue;
                const [a, b] = this.edgeBoxes(['h', j, i]);
                if ((!a || this.squares[a[0]][a[1]] < 2) &&
                    (!b || this.squares[b[0]][b[1]] < 2)) return true;
            }
        for (let i = 0; i < this.y; i++)
            for (let j = 0; j <= this.x; j++) {
                if (this.v[i][j] != 0) continue;
                const [a, b] = this.edgeBoxes(['v', i, j]);
                if ((!a || this.squares[a[0]][a[1]] < 2) &&
                    (!b || this.squares[b[0]][b[1]] < 2)) return true;
            }
        return false;
    }

    // ---- controller ----
    controllerMove(threes) {
        const regions = this.buildRegions();
        const offered = regions.filter(r => r.some(([i,j]) => this.squares[i][j] == 3));
        if (offered.length != 1) return null;
        const R = offered[0];
        const rset = new Set(R.map(([i,j]) => i+','+j));

        // Take everything when no other significant component remains.
        let otherLong = 0;
        for (const r of regions) {
            if (r !== R && r.length >= 3) otherLong++;
        }
        if (otherLong == 0) return null;

        // Both double-cross moves (chainDoubleCross, doubleLoony) rest
        // on one premise: after the opponent takes the ripened boxes,
        // their extra move must open another component, because every
        // remaining move ripens something. A safe move anywhere breaks
        // that premise -- the opponent pockets the boxes, plays safe,
        // and keeps the initiative -- so when one exists, decline the
        // giveaway (return null below) and let greedyTake play instead.
        // The offered region's own edges never count as safe: its boxes
        // all have >= 2 sides. (Bug found by Mike 2026-10-29: with safe
        // moves available, chainDoubleCross gave a 2-chain away for -5
        // instead of taking the offered box for +5.)
        const canGive = !this.existsSafeMove();

        const n = R.length;
        const loop = this.isLoop(R);
        const openings = R.filter(([i,j]) => this.squares[i][j] == 3);

        if (loop) {
            if (n > 4) return this.takeOne(R);
            return canGive ? this.doubleLoony(R, rset) : null;
        }
        // chain
        if (openings.length <= 1) {
            if (n > 2) return this.untakenEdges(openings[0][0], openings[0][1])[0];
            if (n == 2) return canGive ? this.chainDoubleCross(R, rset) : null;
            return null; // single box: take it
        }
        // 2+ openings
        if (n > 4) return this.takeOne(R);
        if (!canGive) return null;
        return this.doubleLoony(R, rset) || this.chainDoubleCross(R, rset);
    }
    // Take one 3-sided box from R, preferring takes that close a single box.
    // Picks randomly among equivalent takes instead of the first found.
    takeOne(R) {
        const singles = [], doubles = [];
        for (const [i,j] of R) {
            if (this.squares[i][j] != 3) continue;
            const edges = this.untakenEdges(i,j);
            if (edges.length == 0) continue;
            const e = edges[0];
            const [a,b] = this.edgeBoxes(e);
            const a3 = a && this.squares[a[0]][a[1]] == 3;
            const b3 = b && this.squares[b[0]][b[1]] == 3;
            if (a3 && b3) doubles.push(e); else singles.push(e);
        }
        const pool = singles.length > 0 ? singles : doubles;
        return pool.length > 0 ? pool[Math.floor(Math.random() * pool.length)] : null;
    }
    // "Ripen" a loop (or short chain): play an untaken edge shared by two
    // 2-sided boxes. Both become 3-sided, nothing is completed, and the turn
    // passes -- the opponent must take them and open the next component.
    // Picks randomly among equivalent edges.
    doubleLoony(R, rset) {
        const pool = [];
        const seen = new Set();
        for (const [i,j] of R) {
            if (this.squares[i][j] != 2) continue;
            for (const [ni,nj] of this.neighbors(i,j)) {
                if (!rset.has(ni+','+nj) || this.squares[ni][nj] != 2) continue;
                const e = this.sharedEdge(i,j,ni,nj);
                const key = e.join(',');
                if (!this.edgeTaken(e) && !seen.has(key)) {
                    seen.add(key);
                    pool.push(e);
                }
            }
        }
        return pool.length > 0 ? pool[Math.floor(Math.random() * pool.length)] : null;
    }
    // Double-cross a 2-chain: play the end edge of the 2-sided box, leaving
    // two 3-sided boxes for the opponent. Picks randomly among equivalent edges.
    chainDoubleCross(R, rset) {
        const pool = [];
        for (const [i,j] of R) {
            if (this.squares[i][j] != 2) continue;
            for (const e of this.untakenEdges(i,j)) {
                const [a,b] = this.edgeBoxes(e);
                let shared = false, unsafe = false;
                for (const nb of [a,b]) {
                    if (!nb || (nb[0] == i && nb[1] == j)) continue;
                    if (rset.has(nb[0]+','+nb[1])) shared = true;
                    else if (this.squares[nb[0]][nb[1]] == 3) unsafe = true;
                }
                if (!shared && !unsafe) pool.push(e);
            }
        }
        return pool.length > 0 ? pool[Math.floor(Math.random() * pool.length)] : null;
    }
    // Original behavior: complete a 3-sided box, picking randomly among them.
    greedyTake(threes) {
        const pool = [];
        for (const [i,j] of threes) {
            const edges = this.untakenEdges(i,j);
            if (edges.length > 0) pool.push(edges[0]);
        }
        return pool.length > 0 ? pool[Math.floor(Math.random() * pool.length)] : null;
    }
    // ---- opener ----
    openerMove() {
        let i, j;
        let moves = [];

        // choose spot that doesn't result in any closable squares
        for(i=0; i<this.y; i++) {
            for(j=0; j<this.x; j++) {
                // look in all <2 squares
                if(this.squares[i][j] < 2) {
                    // check top of each box is available
                    if(this.h[j][i] == 0) {
                        // if we're in top row or above us is <2, top can be taken
                        if(i==0 || this.squares[i-1][j] < 2) {
                            moves.push(['h',j,i]);
                        }
                    }
                    // if we're on bottom row, bottom can be taken
                    if(i==(this.y-1) && this.h[j][i+1] == 0) {
                        moves.push(['h',j,i+1]);
                    }
                    // check left of each box is available
                    if(this.v[i][j] == 0) {
                        // if we're in first column or left of us is <2, left can be taken
                        if(j==0 || this.squares[i][j-1] < 2) {
                            moves.push(['v',i,j]);
                        }
                    }
                    // if we're in last column, right can be taken
                    if(j==(this.x-1) && this.v[i][j+1] == 0) {
                        moves.push(['v',i,j+1]);
                    }
                }
            }
        }
        if(moves.length > 0) {
            return moves[Math.floor(Math.random() * moves.length)];
        }

        // must give squares, so find smallest area to give
        let two;
        this.twos = [];
        // 1) make list of all 2s
        for(i=0; i<this.y; i++) {
            for(j=0; j<this.x; j++) {
                if(this.squares[i][j] == 2) {
                    this.twos.push(i+","+j);
                }
            }
        }
        // 2) remove one at a time to test
        this.smallestArea = [];
        this.visited = Array.from({ length: this.y }, () => Array(this.x).fill(0));
        while(two = this.twos[0]) {
            this.curArea = [];

            // 3) recursively merge adjoining 2s and remove from testing list
            this.touchedOnes = Array.from({ length: this.y }, () => Array(this.x).fill(0));
            this.addAdjacent(two);

            // 4) save set if it's smallest so far
            if(this.smallestArea.length == 0 || this.curArea.length < this.smallestArea.length) {
                // don't save if it touches a one more than once (because it would merge with another area)
                if(!this.touchedOnes.flat().includes(2)) {
                    this.smallestArea = this.curArea;
                }
            }
        }

        // open the smallest pendant chain at any spot (end or interior),
        // so the opponent takes the chain and must open the rest.
        // Picks randomly among equally-small chains and among all of a
        // chain's edges. Verified on Test 9: all chain moves are optimal.
        const chains = this.findChains(this.smallestArea);
        if (chains.length > 0) {
            let minSize = Infinity;
            for (const c of chains) minSize = Math.min(minSize, c.boxes.length);
            const smallest = chains.filter(c => c.boxes.length == minSize);
            const c = smallest[Math.floor(Math.random() * smallest.length)];
            return c.openEdges[Math.floor(Math.random() * c.openEdges.length)];
        }

        // fall back to a random border of the smallest area
        moves = [];
        [i,j] = this.smallestArea[Math.floor(Math.random() * this.smallestArea.length)].split(',').map(num => parseInt(num));
        if(this.h[j][i] == 0) {
            moves.push(['h',j,i]);
        }
        if(this.h[j][i+1] == 0) {
            moves.push(['h',j,i+1]);
        }
        if(this.v[i][j] == 0) {
            moves.push(['v',i,j]);
        }
        if(this.v[i][j+1] == 0) {
            moves.push(['v',i,j+1]);
        }

        // choose random move
        return moves[Math.floor(Math.random() * moves.length)];
    }
    // Find pendant chains among the given area (array of "i,j" strings, all
    // 2-sided). Strips junctions (boxes with >= 3 chain-neighbors); each
    // remaining path component is a chain. Returns [{boxes, openEdges}],
    // where openEdges are ALL playable edges of the chain: end edges (one
    // per end) plus interior shared edges. Playing an interior edge makes
    // two boxes 3-sided; playing an end edge makes one 3-sided. Either way
    // the opponent takes the chain.
    findChains(area) {
        const boxes = area.map(s => s.split(',').map(num => parseInt(num)));
        const aset = new Set(area);
        const deg = new Map();
        const chainDeg = (i,j,removed) => {
            let d = 0;
            for (const [ni,nj] of this.neighbors(i,j)) {
                const nk = ni+','+nj;
                if (!aset.has(nk) || (removed && removed.has(nk))) continue;
                if (!this.edgeTaken(this.sharedEdge(i,j,ni,nj))) d++;
            }
            return d;
        };
        for (const [i,j] of boxes) deg.set(i+','+j, chainDeg(i,j,null));
        // strip junctions iteratively
        const removed = new Set();
        let changed = true;
        while (changed) {
            changed = false;
            for (const [i,j] of boxes) {
                const k = i+','+j;
                if (removed.has(k)) continue;
                if (chainDeg(i,j,removed) >= 3) { removed.add(k); changed = true; }
            }
        }
        // path components among the survivors
        const chains = [];
        const seen = new Set();
        for (const [i,j] of boxes) {
            const k = i+','+j;
            if (removed.has(k) || seen.has(k)) continue;
            const comp = [];
            const stack = [[i,j]];
            seen.add(k);
            while (stack.length > 0) {
                const [a,b] = stack.pop();
                comp.push([a,b]);
                for (const [na,nb] of this.neighbors(a,b)) {
                    const nk = na+','+nb;
                    if (!aset.has(nk) || removed.has(nk) || seen.has(nk)) continue;
                    if (!this.edgeTaken(this.sharedEdge(a,b,na,nb))) {
                        seen.add(nk);
                        stack.push([na,nb]);
                    }
                }
            }
            if (comp.length < 2) continue;
            // a cycle has no ends; only paths can be opened at an end
            const ends = comp.filter(([a,b]) => chainDeg(a,b,removed) == 1);
            if (ends.length == 0) continue;
            const openEdges = [];
            // end edges: one per end
            for (const [ei,ej] of ends) {
                const e = this.chainEndEdge(ei, ej, aset, removed);
                if (e) openEdges.push(e);
            }
            // interior edges: shared untaken edges between two chain boxes
            const compSet = new Set(comp.map(([a,b]) => a+','+b));
            const seenE = new Set();
            for (const [i,j] of comp) {
                for (const [ni,nj] of this.neighbors(i,j)) {
                    if (!compSet.has(ni+','+nj)) continue;
                    const e = this.sharedEdge(i,j,ni,nj);
                    const key = e.join(',');
                    if (!this.edgeTaken(e) && !seenE.has(key)) {
                        seenE.add(key);
                        openEdges.push(e);
                    }
                }
            }
            if (openEdges.length > 0) chains.push({ boxes: comp, openEdges });
        }
        return chains;
    }
    // The open edge of a chain end: the end box's untaken edge that is not
    // shared with the chain. Playing it makes exactly the end box 3-sided.
    chainEndEdge(i,j,aset,removed) {
        for (const e of this.untakenEdges(i,j)) {
            const [a,b] = this.edgeBoxes(e);
            let chainEdge = false, badNeighbor = false;
            for (const nb of [a,b]) {
                if (!nb || (nb[0] == i && nb[1] == j)) continue;
                const nk = nb[0]+','+nb[1];
                if (aset.has(nk) && !removed.has(nk)) chainEdge = true;
                else if (this.squares[nb[0]][nb[1]] == 2) badNeighbor = true;
            }
            if (!chainEdge && !badNeighbor) return e;
        }
        return null;
    }
    addAdjacent(two) {
        let i,j;
        [i,j] = two.split(',').map(num => parseInt(num));

        if(this.visited[i][j]) {
            return;
        }
        this.visited[i][j] = 1;
        this.twos.splice(this.twos.indexOf(two),1);
        this.curArea.push(i+","+j);

        // as we merge 2s, count touched ones, and if we touch any 1 twice, this isn't smallest area (because it would merge with another)
        if(i>0 && this.h[j][i] == 0 && this.squares[i-1][j] == 1) {
            this.touchedOnes[i-1][j]++;
        }
        if(i<(this.y-1) && this.h[j][i+1] == 0 && this.squares[i+1][j] == 1) {
            this.touchedOnes[i+1][j]++;
        }
        if(j>0 && this.v[i][j] == 0 && this.squares[i][j-1] == 1) {
            this.touchedOnes[i][j-1]++;
        }
        if(j<(this.x-1) && this.v[i][j+1] == 0 && this.squares[i][j+1] == 1) {
            this.touchedOnes[i][j+1]++;
        }

        if(i>0 && this.h[j][i] == 0 && this.squares[i-1][j] == 2) {
            this.addAdjacent((i-1)+","+j);
        }
        if(i<(this.y-1) && this.h[j][i+1] == 0 && this.squares[i+1][j] == 2) {
            this.addAdjacent((i+1)+","+j);
        }
        if(j>0 && this.v[i][j] == 0 && this.squares[i][j-1] == 2) {
            this.addAdjacent(i+","+(j-1));
        }
        if(j<(this.x-1) && this.v[i][j+1] == 0 && this.squares[i][j+1] == 2) {
            this.addAdjacent(i+","+(j+1));
        }

    }
    countSquares() {
        this.squares = [];
        for(let i=0; i<this.v.length; i++) {
            this.squares[i] = [];
            for(let j=0; j<this.h.length; j++) {
                this.squares[i][j] = (this.h[j][i] != 0) + (this.h[j][i+1] != 0) + (this.v[i][j] != 0) + (this.v[i][j+1] != 0);
            }
        }
    }
}
