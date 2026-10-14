# Dot Game — Dots and Boxes

Playable Dots and Boxes in the browser — desktop and mobile. Human vs human,
human vs AI, or AI vs AI, on boards from 1×1 up to 10×10.

**Play it live:** https://mtayter.github.io/dots-and-boxes/

## The AI

Three opponents to choose from:

- **Human** — tap (or click) a line to claim it. On touch screens, press to
  preview and release on the same line to play it.
- **AI-Heuristic** — fast classical strategy: take free boxes, play safe
  moves, and give away the smallest chain when forced.
- **AI-Hybrid** (replaces the old MCTS engine) — two engines in one:
  1. **Exact endgame solver.** When 16 or fewer lines remain, the position is
     solved perfectly with negamax + alpha-beta pruning + a transposition
     table. Takes, sacrifices, and chain control all fall out of the search —
     nothing is pruned, so genuine sacrifices are never blinded.
  2. **Bitboard MCTS for the midgame.** The board is two BigInts (no matrix
     cloning), rollouts use an epsilon-greedy heuristic policy, and the
     thinking budget is time-based — each AI-Hybrid player gets its own
     Think slider (0.2s–5s, default 1.4s), shown only when that player is
     AI-Hybrid. Each move reports how many MCTS iterations it ran.

## Run locally

Any static file server works, e.g.:

```sh
python3 -m http.server 8000
```

then open http://localhost:8000.

## Files

- `index.html` / `index.css` / `app.js` — UI shell, responsive + touch input
- `DotGame.js` — game state, canvas rendering, pointer input
- `Player.js` — player/AI wiring
- `Scoreboard.js` — score display
- `AIEngineHeuristic.js` — classical heuristic AI (also the MCTS rollout policy's ancestor)
- `AIEngineHybrid.js` — the hybrid AI (exact endgame solver + bitboard MCTS)

## Contributing

Pull requests are welcome — bug fixes, AI improvements, UI polish, anything.
Open a PR against `main`; small, focused changes are easiest to review.

