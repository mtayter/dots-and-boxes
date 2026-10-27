// Board.js
//
// Bitboard board description: the single definition of the board helpers
// used by the engine (AIEngine.js), the cutoff solver (SolverCutoff.js),
// the exact evaluator (ControlValue.js) and the heuristic (AIEngineHeuristic.js).
// Moved verbatim from the retired AIEngineHybrid.js, whose engine, MCTS and
// old-solver code now live only in the archived copy
// (~/workspace/dots-and-boxes-prototypes/AIEngineHybrid.js).
//
// Conventions (unchanged): h-line id = i*(H+1)+j, v-line id = nH + i*(W+1)+j
// for line ids, but vBits stores v-lines WITHOUT the nH offset.

function popcount(b) {
    let c = 0;
    while (b) { c++; b &= b - 1n; }
    return c;
}

function boxSides(b, box, hBits, vBits) {
    return popcount(hBits & box.hMask) + popcount(vBits & box.vMask);
}

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

function lineToString(b, id) {
    if (id < b.nH) {
        return 'h,' + Math.floor(id / (b.H + 1)) + ',' + (id % (b.H + 1));
    }
    const k = id - b.nH;
    return 'v,' + Math.floor(k / (b.W + 1)) + ',' + (k % (b.W + 1));
}

export { buildBoard, fromMatrices, emptyLines, boxesClosedBy, lineToString };
