Step 2 reshaped per Mike's design (2026-11-05): the GateModel
equation no longer admits minimax on a fine 5s threshold — its
multiplicative error made that line close to arbitrary. It now
serves only as a hopelessness screen: predicted >= 1000s (laptop
scale) is skipped to the heuristic; everything below is attempted
under a flat 5s wall-clock budget (was: pred < 5s admitted, 10s
cap), and a budget abort salvages the best fully-scored root move
when one exists (PR #74 machinery, unchanged).

Threshold and budget from the 2026-11-05 cliff probe: 184 step-2
positions (147 beginner self-play snapshots across 5x5/7x7/10x10
plus scatter rows), one timed 5s laptop attempt each. Attempts
returned an exact or salvaged move for 88% of positions predicted
< 5s, ~2/3 in the 300-1000s band, ~1/3 in 1000-1e6, and 0 of 86
predicted >= 1e6. Marginal value per wasted attempt collapses
above 1000s (300->1000 buys +4 improved positions for +2 wasted
attempts; 1000->10000 buys +2 for +4). A/B over the probed set vs
the old design: improved positions 43 -> 69, wasted attempts 10 x
5s, mean think 312ms -> 861ms per step-2 position, worst case per
move 10s -> 5s.

Beginner level untouched (no gate evaluation, no search).
Regression (VM): case sweep 48/48, first-move checks OK, beginner
suite OK.
