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

        const n = R.length;
        const loop = this.isLoop(R);
        const openings = R.filter(([i,j]) => this.squares[i][j] == 3);

        if (loop) {
            if (n > 4) return this.takeOne(R);
            return this.doubleLoony(R, rset);
        }
        // chain
        if (openings.length <= 1) {
            if (n > 2) return this.untakenEdges(openings[0][0], openings[0][1])[0];
            if (n == 2) return this.chainDoubleCross(R, rset);
            return null; // single box: take it
        }
        // 2+ openings
        if (n > 4) return this.takeOne(R);
        return this.doubleLoony(R, rset) || this.chainDoubleCross(R, rset);
    }
    // Take one 3-sided box from R, preferring takes that close a single box.
    takeOne(R) {
        let fallback = null;
        for (const [i,j] of R) {
            if (this.squares[i][j] != 3) continue;
            const edges = this.untakenEdges(i,j);
            if (edges.length == 0) continue;
            const e = edges[0];
            if (!fallback) fallback = e;
            const [a,b] = this.edgeBoxes(e);
            const a3 = a && this.squares[a[0]][a[1]] == 3;
            const b3 = b && this.squares[b[0]][b[1]] == 3;
            if (!(a3 && b3)) return e; // closes exactly one box
        }
        return fallback;
    }
    // "Ripen" a loop (or short chain): play an untaken edge shared by two
    // 2-sided boxes. Both become 3-sided, nothing is completed, and the turn
    // passes -- the opponent must take them and open the next component.
    doubleLoony(R, rset) {
        for (const [i,j] of R) {
            if (this.squares[i][j] != 2) continue;
            for (const [ni,nj] of this.neighbors(i,j)) {
                if (!rset.has(ni+','+nj) || this.squares[ni][nj] != 2) continue;
                const e = this.sharedEdge(i,j,ni,nj);
                if (!this.edgeTaken(e)) return e;
            }
        }
        return null;
    }
    // Double-cross a 2-chain: play the end edge of the 2-sided box, leaving
    // two 3-sided boxes for the opponent.
    chainDoubleCross(R, rset) {
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
                if (!shared && !unsafe) return e;
            }
        }
        return null;
    }
    // Original behavior: complete the first available 3-sided box.
    greedyTake(threes) {
        for (const [i,j] of threes) {
            const edges = this.untakenEdges(i,j);
            if (edges.length > 0) return edges[0];
        }
        return null;
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

        // open the smallest pendant chain in the smallest area at an end,
        // so the opponent takes exactly that chain and must open the rest
        const chains = this.findChains(this.smallestArea);
        if (chains.length > 0) {
            chains.sort((a,b) => a.boxes.length - b.boxes.length);
            return chains[0].openEdge;
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
    // remaining path component is a chain. Returns [{boxes, openEdge}].
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
            const openEdge = this.chainEndEdge(ends[0][0], ends[0][1], aset, removed);
            if (openEdge) chains.push({ boxes: comp, openEdge });
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
