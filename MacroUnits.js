// MacroUnits.js — cascade-unit detection for SolverCutoff's
// macro-entry filter (Mike's design, threshold refinement
// 2026-11-05).
//
// A RIPE box is an uncompleted box with exactly 2 sides — hence
// exactly 2 empty lines. The empty lines of ripe boxes link them
// into a graph where every vertex has degree <= 2, so the
// connected components — CASCADE UNITS — are paths and cycles
// (the chains and loops of classic dots-and-boxes theory).
//
// A PURE ENTRY is an empty line that (a) completes no box (lines
// completing a 3-sided box are takes and always stay individual)
// and (b) touches at least one ripe box. All pure entries into
// one unit hand the opponent the same forced sweep of that unit;
// the only remaining choice is the sweeper's control decision
// (take all / give back 2 / give back 4), which depends on the
// rest of the board, not on the entry point. So the search only
// needs to expand ONE canonical entry per unit — the rest have
// identical subtrees.
//
// THE THRESHOLD (why MACRO_MIN_UNIT = 3): entry equivalence
// FAILS for units of 1-2 boxes. In a 2-box unit the opponent can
// decline a stub entry by playing the unit's far stub, making
// both boxes 3-sided so the shared line completes both at once;
// the opener is then forced to take his own unit and still open
// the next region himself (brute-force-verified counterexample:
// stub entry -2 vs shared-line entry +2 on the same unit). That
// merge-the-whole-unit geometry exists only when the unit has
// exactly 2 boxes; with 3+ boxes a far-stub reply leaves internal
// structure and the value is decided by the entry-independent
// control choice. Units below the threshold therefore keep ALL
// their entries; only units of >= MACRO_MIN_UNIT boxes collapse.
//
// Evidence (2026-11-05, harness in the mcts-engine-improvements
// goal): 531 value-checked positions with zero divergences at
// this threshold — 135 random mixed boards, 279 targeted
// decomposed endgames (chains 3-10, loops, pure and mixed
// profiles), 117 real game positions at production settings
// (values AND chosen moves identical wherever both solvers
// completed; 56 outcome upgrades, 0 downgrades). The naive
// no-threshold version failed 23/135 and 45/279 of the first two
// batteries, every failure in a short-unit configuration.
//
// unitSkipSet returns the pure entries a search may omit: every
// pure entry of each long-enough unit EXCEPT its canonical
// (lowest-id) one.

export const MACRO_MIN_UNIT = 3;

export function unitSkipSet(b, hBits, vBits, sides, moves, minLen = MACRO_MIN_UNIT) {
    const ripe = new Uint8Array(b.boxes.length);
    let ripeCount = 0;
    for (let bi = 0; bi < sides.length; bi++) {
        if (sides[bi] === 2) { ripe[bi] = 1; ripeCount++; }
    }
    if (ripeCount === 0) return { skip: new Set(), units: 0, entries: 0, sizes: [] };

    // Union-find over ripe boxes, joined by a shared empty line.
    const parent = new Int32Array(b.boxes.length);
    for (let i = 0; i < parent.length; i++) parent[i] = i;
    const find = (x) => {
        while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; }
        return x;
    };
    for (const m of moves) {
        const adj = b.lineBoxes[m];
        if (adj.length === 2 && ripe[adj[0]] && ripe[adj[1]]) {
            const ra = find(adj[0]), rb = find(adj[1]);
            if (ra !== rb) parent[ra] = rb;
        }
    }

    // Pure entries per unit (moves arrive in ascending id order
    // from emptyLines()).
    const first = new Map();
    const perUnit = new Map();
    let entries = 0;
    for (const m of moves) {
        const adj = b.lineBoxes[m];
        let completes = false, ripeRoot = -1;
        for (const bi of adj) {
            if (sides[bi] === 3) { completes = true; break; }
            if (ripe[bi]) ripeRoot = find(bi);
        }
        if (completes || ripeRoot < 0) continue;
        entries++;
        if (!first.has(ripeRoot)) first.set(ripeRoot, m);
        if (!perUnit.has(ripeRoot)) perUnit.set(ripeRoot, []);
        perUnit.get(ripeRoot).push(m);
    }
    // Unit sizes (ripe boxes per component) for the threshold.
    const sizeOf = new Map();
    for (let bi = 0; bi < sides.length; bi++) {
        if (!ripe[bi]) continue;
        const r = find(bi);
        sizeOf.set(r, (sizeOf.get(r) ?? 0) + 1);
    }
    const skip = new Set();
    for (const [root, list] of perUnit) {
        if ((sizeOf.get(root) ?? 0) < minLen) continue; // short unit: keep every entry
        const keep = first.get(root);
        for (const m of list) if (m !== keep) skip.add(m);
    }
    return { skip, units: first.size, entries, sizes: [...sizeOf.values()].sort((a, b) => b - a) };
}
