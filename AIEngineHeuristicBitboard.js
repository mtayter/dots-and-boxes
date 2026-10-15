// AIEngineHeuristicBitboard.js
//
// Bitboard-native version of AIEngineHeuristic. Same logic, same random
// choices among equally-good moves, but operates directly on BigInt
// bitboards (hBits/vBits) with NO matrix conversion.
//
// Bitboard layout (same as AIEngineHybrid):
//   hBits: bit at position j*(H+1)+i for horizontal line h[j][i], j in [0,W), i in [0,H]
//   vBits: bit at position i*(W+1)+j for vertical line v[i][j], i in [0,H), j in [0,W]
//   Box (i,j): i in [0,H), j in [0,W). Box index bi = i*W + j.
//   LineId: < nH (W*(H+1)) is horizontal, >= nH is vertical (offset by nH).
//
// chooseMoveBits(W, H, hBits, vBits) returns a lineId.
//
// This is a line-for-line port of AIEngineHeuristic.chooseMove, with:
//   - this.squares[i][j]  -> sideCount(bi) via popcount on masks
//   - ['h',j,i] / ['v',i,j] -> lineId integers
//   - [i,j] box coords -> bi = i*W + j

function popcount(b) { let c = 0; while (b) { c++; b &= b - 1n; } return c; }

export default class AIEngineHeuristicBitboard {
    constructor() {
        this.W = 0;
        this.H = 0;
        this.nH = 0;
        this.hBits = 0n;
        this.vBits = 0n;
        // Per-box masks, built in chooseMoveBits.
        this.boxHMask = [];  // BigInt per box
        this.boxVMask = [];  // BigInt per box
        // Side counts, computed once per chooseMoveBits call.
        this.sides = [];     // Uint8Array per box
    }

    // ---- setup ----
    // Precompute box masks and side counts for this position.
    setup(W, H, hBits, vBits) {
        this.W = W;
        this.H = H;
        this.nH = W * (H + 1);
        this.hBits = hBits;
        this.vBits = vBits;
        this.boxHMask = [];
        this.boxVMask = [];
        this.sides = new Uint8Array(W * H);
        for (let i = 0; i < H; i++) {
            for (let j = 0; j < W; j++) {
                const bi = i * W + j;
                const hMask = (1n << BigInt(j * (H + 1) + i)) | (1n << BigInt(j * (H + 1) + i + 1));
                const vMask = (1n << BigInt(i * (W + 1) + j)) | (1n << BigInt(i * (W + 1) + j + 1));
                this.boxHMask[bi] = hMask;
                this.boxVMask[bi] = vMask;
                this.sides[bi] = popcount(hBits & hMask) + popcount(vBits & vMask);
            }
        }
    }

    // ---- lineId helpers ----
    // Horizontal line h[j][i] -> lineId
    hLineId(j, i) { return j * (this.H + 1) + i; }
    // Vertical line v[i][j] -> lineId
    vLineId(i, j) { return this.nH + i * (this.W + 1) + j; }
    // Is lineId taken?
    lineTaken(lineId) {
        if (lineId < this.nH) return ((this.hBits >> BigInt(lineId)) & 1n) !== 0n;
        return ((this.vBits >> BigInt(lineId - this.nH)) & 1n) !== 0n;
    }
    // Convert lineId back to [type, a, c] for debugging / compat.
    lineToMove(lineId) {
        if (lineId < this.nH) {
            const j = Math.floor(lineId / (this.H + 1));
            const i = lineId % (this.H + 1);
            return ["h", j, i];
        }
        const vId = lineId - this.nH;
        const i = Math.floor(vId / (this.W + 1));
        const j = vId % (this.W + 1);
        return ["v", i, j];
    }

    // ---- box helpers ----
    // Box index from (i,j). i in [0,H), j in [0,W).
    bi(i, j) { return i * this.W + j; }
    // (i,j) from box index.
    ij(bi) { return [Math.floor(bi / this.W), bi % this.W]; }
    // Neighbors of box bi (box indices, in-bounds only).
    neighbors(bi) {
        const [i, j] = this.ij(bi);
        const out = [];
        if (i > 0) out.push(bi - this.W);
        if (i < this.H - 1) out.push(bi + this.W);
        if (j > 0) out.push(bi - 1);
        if (j < this.W - 1) out.push(bi + 1);
        return out;
    }
    // LineId shared between adjacent boxes bi and nb.
    sharedEdge(bi, nb) {
        const [i, j] = this.ij(bi);
        const [ni, nj] = this.ij(nb);
        if (ni === i - 1) return this.hLineId(j, i);
        if (ni === i + 1) return this.hLineId(j, i + 1);
        if (nj === j - 1) return this.vLineId(i, j);
        if (nj === j + 1) return this.vLineId(i, j + 1);
        return -1;
    }
    // Untaken lineIds of box bi.
    untakenEdges(bi) {
        const [i, j] = this.ij(bi);
        const out = [];
        const h1 = this.hLineId(j, i);
        const h2 = this.hLineId(j, i + 1);
        const v1 = this.vLineId(i, j);
        const v2 = this.vLineId(i, j + 1);
        if (!this.lineTaken(h1)) out.push(h1);
        if (!this.lineTaken(h2)) out.push(h2);
        if (!this.lineTaken(v1)) out.push(v1);
        if (!this.lineTaken(v2)) out.push(v2);
        return out;
    }
    // Boxes adjacent to lineId: [boxA, boxB-or-null] as box indices.
    edgeBoxes(lineId) {
        if (lineId < this.nH) {
            // h[j][i]: boxes (i-1,j) and (i,j)
            const j = Math.floor(lineId / (this.H + 1));
            const i = lineId % (this.H + 1);
            const a = i - 1 >= 0 ? this.bi(i - 1, j) : null;
            const b = i < this.H ? this.bi(i, j) : null;
            return [a, b];
        }
        const vId = lineId - this.nH;
        const i = Math.floor(vId / (this.W + 1));
        const j = vId % (this.W + 1);
        const a = j - 1 >= 0 ? this.bi(i, j - 1) : null;
        const b = j < this.W ? this.bi(i, j) : null;
        return [a, b];
    }

    // ---- main entry ----
    chooseMoveBits(W, H, hBits, vBits) {
        this.setup(W, H, hBits, vBits);
        const threes = [];
        for (let bi = 0; bi < W * H; bi++) {
            if (this.sides[bi] === 3) threes.push(bi);
        }
        if (threes.length > 0) {
            const m = this.controllerMove(threes);
            if (m !== null) return m;
            return this.greedyTake(threes);
        }
        return this.openerMove();
    }

    // ---- regions ----
    buildRegions() {
        const visited = new Uint8Array(this.W * this.H);
        const regions = [];
        for (let bi = 0; bi < this.W * this.H; bi++) {
            const s = this.sides[bi];
            if (s < 2 || s > 3 || visited[bi]) continue;
            const region = [];
            const stack = [bi];
            visited[bi] = 1;
            while (stack.length > 0) {
                const a = stack.pop();
                region.push(a);
                for (const nb of this.neighbors(a)) {
                    if (visited[nb]) continue;
                    const ns = this.sides[nb];
                    if (ns < 2 || ns > 3) continue;
                    if (!this.lineTaken(this.sharedEdge(a, nb))) {
                        visited[nb] = 1;
                        stack.push(nb);
                    }
                }
            }
            regions.push(region);
        }
        return regions;
    }
    isLoop(region) {
        const rset = new Set(region);
        for (const bi of region) {
            for (const e of this.untakenEdges(bi)) {
                const [a, b] = this.edgeBoxes(e);
                for (const nb of [a, b]) {
                    if (nb === null) return false;
                    if (nb === bi) continue;
                    if (!rset.has(nb)) return false;
                }
            }
        }
        return true;
    }

    // ---- controller ----
    controllerMove(threes) {
        const regions = this.buildRegions();
        const offered = regions.filter(r => r.some(bi => this.sides[bi] === 3));
        if (offered.length !== 1) return null;
        const R = offered[0];
        const rset = new Set(R);
        let otherLong = 0;
        for (const r of regions) {
            if (r !== R && r.length >= 3) otherLong++;
        }
        if (otherLong === 0) return null;
        const n = R.length;
        const loop = this.isLoop(R);
        const openings = R.filter(bi => this.sides[bi] === 3);
        if (loop) {
            if (n > 4) return this.takeOne(R);
            return this.doubleLoony(R, rset);
        }
        if (openings.length <= 1) {
            if (n > 2) return this.untakenEdges(openings[0])[0];
            if (n === 2) return this.chainDoubleCross(R, rset);
            return null;
        }
        if (n > 4) return this.takeOne(R);
        return this.doubleLoony(R, rset) ?? this.chainDoubleCross(R, rset);
    }
    takeOne(R) {
        const singles = [], doubles = [];
        for (const bi of R) {
            if (this.sides[bi] !== 3) continue;
            const edges = this.untakenEdges(bi);
            if (edges.length === 0) continue;
            const e = edges[0];
            const [a, b] = this.edgeBoxes(e);
            const a3 = a !== null && this.sides[a] === 3;
            const b3 = b !== null && this.sides[b] === 3;
            if (a3 && b3) doubles.push(e); else singles.push(e);
        }
        const pool = singles.length > 0 ? singles : doubles;
        return pool.length > 0 ? pool[Math.floor(Math.random() * pool.length)] : null;
    }
    doubleLoony(R, rset) {
        const pool = [];
        const seen = new Set();
        for (const bi of R) {
            if (this.sides[bi] !== 2) continue;
            for (const nb of this.neighbors(bi)) {
                if (!rset.has(nb) || this.sides[nb] !== 2) continue;
                const e = this.sharedEdge(bi, nb);
                if (!this.lineTaken(e) && !seen.has(e)) {
                    seen.add(e);
                    pool.push(e);
                }
            }
        }
        return pool.length > 0 ? pool[Math.floor(Math.random() * pool.length)] : null;
    }
    chainDoubleCross(R, rset) {
        const pool = [];
        for (const bi of R) {
            if (this.sides[bi] !== 2) continue;
            for (const e of this.untakenEdges(bi)) {
                const [a, b] = this.edgeBoxes(e);
                let shared = false, unsafe = false;
                for (const nb of [a, b]) {
                    if (nb === null || nb === bi) continue;
                    if (rset.has(nb)) shared = true;
                    else if (this.sides[nb] === 3) unsafe = true;
                }
                if (!shared && !unsafe) pool.push(e);
            }
        }
        return pool.length > 0 ? pool[Math.floor(Math.random() * pool.length)] : null;
    }
    greedyTake(threes) {
        const pool = [];
        for (const bi of threes) {
            const edges = this.untakenEdges(bi);
            if (edges.length > 0) pool.push(edges[0]);
        }
        return pool.length > 0 ? pool[Math.floor(Math.random() * pool.length)] : null;
    }

    // ---- opener ----
    openerMove() {
        const moves = [];
        // Safe moves: edges of <2-sided boxes that don't make a neighbor 3-sided.
        for (let bi = 0; bi < this.W * this.H; bi++) {
            if (this.sides[bi] >= 2) continue;
            const [i, j] = this.ij(bi);
            // Top: h[j][i]
            const hTop = this.hLineId(j, i);
            if (!this.lineTaken(hTop)) {
                if (i === 0 || this.sides[this.bi(i - 1, j)] < 2) moves.push(hTop);
            }
            // Bottom: h[j][i+1] (only if bottom row)
            if (i === this.H - 1) {
                const hBot = this.hLineId(j, i + 1);
                if (!this.lineTaken(hBot)) moves.push(hBot);
            }
            // Left: v[i][j]
            const vLeft = this.vLineId(i, j);
            if (!this.lineTaken(vLeft)) {
                if (j === 0 || this.sides[this.bi(i, j - 1)] < 2) moves.push(vLeft);
            }
            // Right: v[i][j+1] (only if last column)
            if (j === this.W - 1) {
                const vRight = this.vLineId(i, j + 1);
                if (!this.lineTaken(vRight)) moves.push(vRight);
            }
        }
        if (moves.length > 0) {
            return moves[Math.floor(Math.random() * moves.length)];
        }

        // Must give squares: find smallest area of 2-sided boxes.
        const smallestArea = this.findSmallestArea();
        const chains = this.findChains(smallestArea);
        if (chains.length > 0) {
            let minSize = Infinity;
            for (const c of chains) minSize = Math.min(minSize, c.boxes.length);
            const smallest = chains.filter(c => c.boxes.length === minSize);
            const c = smallest[Math.floor(Math.random() * smallest.length)];
            return c.openEdges[Math.floor(Math.random() * c.openEdges.length)];
        }

        // Fall back to a random border of the smallest area.
        const moves2 = [];
        const pickBi = smallestArea[Math.floor(Math.random() * smallestArea.length)];
        for (const e of this.untakenEdges(pickBi)) moves2.push(e);
        return moves2[Math.floor(Math.random() * moves2.length)];
    }

    // Find smallest 2-area (same logic as matrix version's addAdjacent loop).
    // Returns array of box indices.
    findSmallestArea() {
        const twos = [];
        for (let bi = 0; bi < this.W * this.H; bi++) {
            if (this.sides[bi] === 2) twos.push(bi);
        }
        const visited = new Uint8Array(this.W * this.H);
        let smallestArea = [];
        const remaining = new Set(twos);
        while (remaining.size > 0) {
            const start = remaining.values().next().value;
            const curArea = [];
            const touchedOnes = new Map(); // bi -> count
            const stack = [start];
            visited[start] = 1;
            remaining.delete(start);
            curArea.push(start);
            // Count touched 1s for start box
            this.countTouchedOnes(start, touchedOnes);
            while (stack.length > 0) {
                const a = stack.pop();
                for (const nb of this.neighbors(a)) {
                    if (visited[nb]) continue;
                    if (this.sides[nb] !== 2) continue;
                    if (this.lineTaken(this.sharedEdge(a, nb))) continue;
                    visited[nb] = 1;
                    remaining.delete(nb);
                    curArea.push(nb);
                    this.countTouchedOnes(nb, touchedOnes);
                    stack.push(nb);
                }
            }
            // Note: matrix version uses recursive addAdjacent which also
            // traverses via untaken edges. The stack above does the same.
            // Save if smallest and doesn't touch any 1 twice.
            let touchesTwice = false;
            for (const cnt of touchedOnes.values()) {
                if (cnt >= 2) { touchesTwice = true; break; }
            }
            if (!touchesTwice && (smallestArea.length === 0 || curArea.length < smallestArea.length)) {
                smallestArea = curArea;
            }
        }
        return smallestArea;
    }
    // Count 1-sided neighbors touched via untaken edges (for smallest-area check).
    countTouchedOnes(bi, touchedOnes) {
        const [i, j] = this.ij(bi);
        // Up: h[j][i], neighbor (i-1,j)
        if (i > 0 && !this.lineTaken(this.hLineId(j, i)) && this.sides[this.bi(i - 1, j)] === 1) {
            const nb = this.bi(i - 1, j);
            touchedOnes.set(nb, (touchedOnes.get(nb) ?? 0) + 1);
        }
        // Down: h[j][i+1], neighbor (i+1,j)
        if (i < this.H - 1 && !this.lineTaken(this.hLineId(j, i + 1)) && this.sides[this.bi(i + 1, j)] === 1) {
            const nb = this.bi(i + 1, j);
            touchedOnes.set(nb, (touchedOnes.get(nb) ?? 0) + 1);
        }
        // Left: v[i][j], neighbor (i,j-1)
        if (j > 0 && !this.lineTaken(this.vLineId(i, j)) && this.sides[this.bi(i, j - 1)] === 1) {
            const nb = this.bi(i, j - 1);
            touchedOnes.set(nb, (touchedOnes.get(nb) ?? 0) + 1);
        }
        // Right: v[i][j+1], neighbor (i,j+1)
        if (j < this.W - 1 && !this.lineTaken(this.vLineId(i, j + 1)) && this.sides[this.bi(i, j + 1)] === 1) {
            const nb = this.bi(i, j + 1);
            touchedOnes.set(nb, (touchedOnes.get(nb) ?? 0) + 1);
        }
    }

    // Find pendant chains among area (array of box indices, all 2-sided).
    findChains(area) {
        const aset = new Set(area);
        const chainDeg = (bi, removed) => {
            let d = 0;
            for (const nb of this.neighbors(bi)) {
                if (!aset.has(nb) || (removed && removed.has(nb))) continue;
                if (!this.lineTaken(this.sharedEdge(bi, nb))) d++;
            }
            return d;
        };
        const removed = new Set();
        let changed = true;
        while (changed) {
            changed = false;
            for (const bi of area) {
                if (removed.has(bi)) continue;
                if (chainDeg(bi, removed) >= 3) { removed.add(bi); changed = true; }
            }
        }
        const chains = [];
        const seen = new Set();
        for (const bi of area) {
            if (removed.has(bi) || seen.has(bi)) continue;
            const comp = [];
            const stack = [bi];
            seen.add(bi);
            while (stack.length > 0) {
                const a = stack.pop();
                comp.push(a);
                for (const nb of this.neighbors(a)) {
                    if (!aset.has(nb) || removed.has(nb) || seen.has(nb)) continue;
                    if (!this.lineTaken(this.sharedEdge(a, nb))) {
                        seen.add(nb);
                        stack.push(nb);
                    }
                }
            }
            if (comp.length < 2) continue;
            const ends = comp.filter(a => chainDeg(a, removed) === 1);
            if (ends.length === 0) continue;
            const openEdges = [];
            for (const ebi of ends) {
                const e = this.chainEndEdge(ebi, aset, removed);
                if (e !== null) openEdges.push(e);
            }
            const compSet = new Set(comp);
            const seenE = new Set();
            for (const a of comp) {
                for (const nb of this.neighbors(a)) {
                    if (!compSet.has(nb)) continue;
                    const e = this.sharedEdge(a, nb);
                    if (!this.lineTaken(e) && !seenE.has(e)) {
                        seenE.add(e);
                        openEdges.push(e);
                    }
                }
            }
            if (openEdges.length > 0) chains.push({ boxes: comp, openEdges });
        }
        return chains;
    }
    chainEndEdge(bi, aset, removed) {
        for (const e of this.untakenEdges(bi)) {
            const [a, b] = this.edgeBoxes(e);
            let chainEdge = false, badNeighbor = false;
            for (const nb of [a, b]) {
                if (nb === null || nb === bi) continue;
                if (aset.has(nb) && !removed.has(nb)) chainEdge = true;
                else if (this.sides[nb] === 2) badNeighbor = true;
            }
            if (!chainEdge && !badNeighbor) return e;
        }
        return null;
    }
}
