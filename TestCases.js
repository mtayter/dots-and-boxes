import Player from "./Player.js";

/*
        0) not testing
        1) PASS: test case for choosing smallest area to give
        2) PASS: 2nd test case for choosing smallest area to give
        3) PASS: 3rd test case for choosing smallest area to give (smallest group of 2s is wrong) - oops, test 2 already covers this...
        4) PASS: test case for knowing when to not take a square - AI ripens the
           offered 4-chain (plays the middle edge) instead of taking it,
           forcing the opponent to take all 4 and open the rest
        5) PASS: AI wasn't giving a single box before larger areas due to a bug
        6) PASS: opens the smallest pendant chain at an end (h,3,2 / v,2,5),
           not a random border of the smallest area - verified optimal vs the
           exact solver (bestVal -13; P2 can't win outright, but this loses least)
        7) PASS: don't take squares - AI ripens the offered 2-chain (v,2,5)
           instead of taking the single box, forcing the opponent to take 2
           and open the rest
        8) PASS: loop hardhearted handout - AI as controller takes all-but-4 from an
           offered 6-loop, then offers the remaining 4 (instead of taking them),
           keeping control; opponent takes 4 and must open the 6-chain, which the
           AI sweeps. Taking all 6 only ties 6-6; the handout wins 8-4.
        9) PASS: opener chain choice on a 4-chain: 4x4 board, opener
           mode, a 4-chain (2,2)-(3,2)-(3,3)-(2,3) plus a blob. Solver
           (all 18 legal moves solved, 2026-10-29): the five chain moves
           h,2,2, h,2,3, h,3,3, v,2,4, v,3,3 are ALL optimal (-4); the
           13 blob moves are -8 (nine) and -12 (four). The case really
           tests "play in the chain vs blunder in the blob", and the
           heuristic cannot fail it: its safe set is exactly the five
           chain moves. A longer-chain version where ends-vs-interior
           discriminates was searched for (~80k solver-verified
           positions) and appears not to exist in the all-2-sided
           family; Mike dropped the idea 2026-10-29.
        10) Heuristic PASS (since the 2026-10-26 cascade) / solver PASS:
           first case where the single-offer controller was provably
           wrong (not the multi-offer greedy bail). 5x5, one offer:
           a 2-chain (0,0)-(1,0) plus an unopened 4-chain, 8-loop,
           and 4-loop (all-even remaining inventory). Before the
           cascade, the heuristic double-crossed the 2-chain (v,1,0,
           closing nothing) for a remaining differential of -2; the
           optimal move takes (0,0) with h,0,1 (cascading to (1,0))
           for +2 -- a 4-box gap. Since the cascade's evaluator
           branch (this position is decomposed), the heuristic plays
           the optimal h,0,1 on all seeds. Verified against the exact
           solver (unique argmax h,0,1). The double-cross donates a
           cascade chain: taking its end box banks 2, not 1.
        11) Heuristic PASS (since the 2026-10-26 cascade) / solver PASS:
           same position as case 10 except v,0,4 is removed and
           v,0,5 + h,3,0 are added, turning the unopened 4-chain
           into a 4-loop (same side-count grid, E=18). Remaining
           inventory is now all loops (8-loop + two 4-loops). Same
           story as case 10: before the cascade the heuristic
           double-crossed the 2-chain (v,1,0) for -2; optimal h,0,1
           takes both chain boxes for +2 -- gap 4. Since the
           cascade's evaluator branch, the heuristic plays the
           optimal h,0,1 on all seeds. Verified against the exact
           decomposed evaluator (unique argmax h,0,1).
        12) Engine PASS / standalone-heuristic FAIL: first case where
           declining an available take is strictly optimal on a
           NON-decomposed board. 3x3, E=14, no claimed boxes. Side
           counts:
             1 1 0
             2 2 1
             3 2 1
           Box (2,0) is 3-sided, so the take v,2,1 is available, but
           taking it is worth -1 while declining with v,2,2 (which
           gives (2,1) its 3rd side) is worth +1 -- a 2-box gap,
           verified against the exact solver. The standalone
           heuristic always takes when a take is available, so it
           plays v,2,1 and is wrong here; the unified engine
           declines via its exact/minimax branch (E=14 <= 15 gate)
           and plays v,2,2. Found by exact-solver search over random
           non-decomposed take-available positions (3 counterexamples
           found in 97 checked, all with the same -1 vs +1 shape).
           ORDER: no box is claimed in the final position, so no
           preset move can close a box -- all 10 moves are toggles,
           the turn lands on player 1 (the AI), and move() triggers
           checkAImove. Any order works.
        13) Engine FAIL (known blind spot) / solver PASS: the E=20
           sacrifice position (benchmark seed 1020). 3x3, E=20, no
           claimed boxes. Side counts:
             0 1 1
             1 2 0
             1 0 0
           No take is available (no 3-sided box), so the heuristic
           is in opener mode and plays a random safe move, all
           worth -3; the optimal moves h,1,2 and v,1,2 (tied) both
           GIVE box (1,1) its 3rd side and are worth -1 -- a 2-box
           gap, verified against the exact solver. The unified
           engine falls through to the heuristic here (position is
           non-decomposed, so no evaluator branch; E=20 > 15
           minimax gate), so it currently plays a -3 move. This
           is the position the cutoff+restricted MCTS work kept
           missing: the tree explored the giving edge 3000+ times
           but the rollout grades came back inverted.
           ORDER: no box is claimed in the final position, so no
           preset move can close a box -- all 4 moves are toggles,
           the turn lands on player 1 (the AI), and move() triggers
           checkAImove. Any order works.
        14) Engine FAIL (known blind spot) / solver PASS: the E=20
           lottery position (benchmark seed 1005). 3x3, E=20, no
           claimed boxes. Side counts:
             1 0 0
             1 2 1
             0 1 0
           No take is available (no 3-sided box), so the heuristic
           is in opener mode and picks uniformly among 18 safe
           moves, only 3 of which are optimal: h,0,2, v,0,1, v,1,3
           (tied, -3); the other 17 moves are -5 -- a 2-box gap,
           verified against the exact solver. The heuristic hits
           an optimal only 5/50 seeds; the unified engine falls
           through to it here (position is non-decomposed, so no
           evaluator branch; E=20 > 15 minimax gate), so it
           currently plays a -5 move. This is one of the five
           stubborn lottery positions the time curve found
           unfixable by more time (cutoff+restricted MCTS 0/3 at
           5, 15, and 30 s).
           ORDER: no box is claimed in the final position, so no
           preset move can close a box -- all 4 moves are toggles,
           the turn lands on player 1 (the AI), and move() triggers
           checkAImove. Any order works.
        15) Engine PASS (since the 2026-10-29 double-cross guard) /
           heuristic PASS: the first case decided by the controller
           (heuristic-offer). From Mike's live 4x4 game of 2026-10-29:
           the old AI played v,1,4 -- a chainDoubleCross of the
           2-region in the right column -- giving both boxes away for
           -5 instead of taking the offered box with h,3,1 (+5,
           unique optimal, exact solver). The double-cross premise
           (the opponent must open another component) was false: safe
           moves existed elsewhere. The guard (PR #60) declines the
           giveaway whenever a safe move exists, and the heuristic
           now takes. The 19 preset moves replay the game (3 close
           boxes along the way); 16 turn-passes land the turn on
           player 1. E=21, squaresLeft 13, not decomposed.
        16) Engine FAIL (known blind spot) / heuristic FAIL /
           solver PASS: forego-a-take at heuristic scale -- case
           12's decision with minimax unable to reach it. 3x3, E=16
           (> 15 gate), non-decomposed, no claimed boxes. Side
           counts:
             2 2 1
             3 1 0
             2 1 0
           Box (1,0) is 3-sided, so the take h,0,2 is available, but
           taking is worth -3 while declining with v,2,1 -- which
           gives (2,0) its 3rd side, so the two boxes of column 0
           come to share their last edge -- is worth +3, a 6-box
           gap; every other move is -7. All verified against the
           exact solver; found by solver-verified search over random
           one-take positions. The heuristic takes on 12/12 seeds:
           its controller bails (no other region of length >= 3 to
           protect) and greedyTake completes the box. The unified
           engine falls through to the heuristic here and plays
           the take too.
           ORDER: no box is claimed in the final position, so no
           preset move can close a box -- all 8 moves are toggles,
           the turn lands on player 1 (the AI), and move() triggers
           checkAImove. Any order works.
        17) Engine PASS / solver PASS: the decomposed counterexample
           to "start by taking the open chain." 5x4, fully
           decomposed (U=15, 3 components), AI (player 1) to move.
           Components: a fresh 10-chain across the top two rows, a
           4-loop with both ends offered (the arc (0,2),(1,2),
           (1,3),(0,3) -- extractor loop with threes=2, micro
           {4,1,1}), and a single offered box at (4,3); the other
           five boxes are claimed separators. The 4-loop is open at
           both ends, which makes it look ripe to sweep, but every
           first move inside it is worth +5, while taking the
           single box with h,4,4 is the unique optimal at +7 -- a
           2-box gap, verified against the exact solver (opening
           the 10-chain is -15). This is the board form of the one
           exception found by the 2026-11-06 sweep-claim test (an
           optimal move inside an open chain of length >= 3 failed
           only for the doubly-open 4-chain, 1 of 7 instances, same
           -2 margin and same companion shape: fresh 10-chain +
           single; the abstract instance's 7-ring cannot occur on
           a board, since grid loops are even). It is also why the
           evaluator's open-chain restriction (PR #80) refuses to
           treat {4,1,1} as sweepable. The unified engine passes
           via its exact evaluator branch (decomposed, in caps);
           a pattern player that starts the open chain loses 2.
           ORDER: five separator boxes close along the way; the
           shared edge v,2,3 is drawn 33rd and closes (2,2) and
           (3,2) together, making 4 closing draws in total, so the
           34 preset moves land the turn on player 1 (the AI).
        18) Engine PASS / solver PASS; standalone heuristic FAIL
           (its control rule): the decomposed counterexample that
           survives the one-move-capture rule (PR #82). 5x3, fully
           decomposed (U=7, 3 components), AI (player 1) to move.
           Components: an offered 2-chain (0,0)-(1,0) (micro
           {2,1,2}), a 4-ring at cols 3-4 rows 0-1, and an unripe
           singleton at (0,2) (micro {single:2}); the other eight
           boxes are claimed separators. No ready singleton and no
           enclosed domino exists, so the capture rule does not
           fire. The standard control move -- double-cross the
           2-chain by ripening its far end (h,1,0) -- is worth -5:
           the opponent takes both boxes, then ripens the
           singleton instead of opening the ring, handing the
           opening duty and the ring's control straight back (the
           unripe singleton is a parity token). Taking the chain
           with v,0,1 is the unique optimal at +5, verified
           against the exact solver (opening the ring is -5,
           ripening the singleton is -3) -- a 10-box swing on a
           7-box position. The unified engine passes via its exact
           evaluator branch; the standalone heuristic's controller
           plays the double-cross. Found 2026-11-06 by exact
           search over control-rule failures (708 of 2,484
           single-offer states with an unripe singleton or fresh
           companions; this is the smallest first-move-clean
           instance with a ring companion). ORDER: the 30 preset
           moves are drawn in id order with h,0,0 last; the 8
           closing draws (one per separator box) land the turn on
           player 1 (the AI).
        19) Intermediate PASS / beginner FAIL / solver PASS: the first
           case that separates beginner from intermediate. 6x4, fully
           decomposed (12 unclaimed boxes, E=14), AI (player 1) to
           move, and every component in the Allcock domain: a fresh
           4-ring at cols 0-1 rows 0-1, a fresh 3-chain across the
           top row (cols 3-5), a fresh 5-chain across the bottom row
           (cols 0-4); the other twelve boxes are claimed separators.
           The position is worth 0. The Allcock recursion says open
           the ring (any ring entry is worth 0); opening the 3-chain
           is worth -2 and the 5-chain -4, all verified against the
           exact evaluator. Beginner (the pure heuristic) has no safe
           move here, so its opener opens the smallest area -- the
           3-chain -- on every seed, and fails; intermediate opens
           the ring via allcockMove and passes. Cases 1-18 never
           present this decision: none of their positions is
           Allcock-domain at the decision point, which is why
           beginner and intermediate tie on the suite. Found
           2026-11-10 by component-multiset search: chain-only
           multisets never separate the levels (the smallest-chain
           opener is always Allcock-optimal there); a ring companion
           is required. ORDER: the 44 preset moves close exactly the
           12 separator boxes, one per closing move with no double
           closes, so the 32 turn-passes land the turn on player 1
           (the AI).
        20) All levels PASS the first move / solver PASS: the pure
           opened-chain specimen. 6x4, fully decomposed (12
           unclaimed boxes, E=13), AI (player 1) to move, and
           exactly one component outside the Allcock domain: an
           opened 4-chain {4,1,2} across the top row (cols 2-5,
           its left end already opened). Its companions are both
           in-domain: a fresh 4-chain {4,2,2} across the bottom
           row (cols 0-3) and a fresh 4-ring (cols 0-1, rows 0-1);
           the other twelve boxes are claimed separators. The
           position is worth +4 and the unique optimal first move
           is v,0,3, closing the opened end box (every other first
           move is -4 or worse, verified against the exact
           evaluator); all three levels play it. The teeth are
           deferred: the heuristic (beginner -- and intermediate,
           whose allcockMove declines out-of-domain positions)
           sweeps two boxes and then double-crosses the last two
           (h,5,0), donating them for nothing. The remaining
           {4-chain, ring} pair is worth 0 to whoever opens it, so
           the give-back buys no tempo and costs 4 on the
           differential: in full play the heuristic nets 0 against
           the exact +4. Found 2026-11-10 by component-multiset
           search: with fresh companions, closing the offered end
           box is never a suboptimal first move (no counterexample
           with up to 3 companions / 30 boxes), so no first-move
           separator exists for an opened long chain -- the
           control error only becomes visible at the double-cross.
           ORDER: the 45 preset moves close exactly the 12
           separator boxes with exactly one double close, placed
           last (h,4,2), landing the turn on player 1 (the AI).
        21) Beginner FAIL / intermediate FAIL / advanced PASS /
           solver PASS: the safe-moves counterexample -- control
           beats sweeping even with safe moves on the board. 4x3,
           NOT decomposed (12 unclaimed boxes, E=14), AI (player 1)
           to move: a ripe 4-chain {4,1,1} across the top row, a
           fresh 6-chain {6,2,2} snaking across the middle row and
           dipping down in the centre, and a 1-sided corner box at
           each bottom corner ((2,0) and (2,3)); no boxes claimed.
           The position is worth +2 and the unique optimal first
           move is v,0,2, ripening the offered chain -- verified
           against the exact solver (ripen +2, sweep -2, playing
           a safe move first -12). The heuristic
           (beginner -- and intermediate, whose allcockMove declines
           non-decomposed positions and whose controller declines
           because safe moves exist) sweeps the ripe chain and nets
           -2; advanced finds the ripen via minimax. The teeth:
           each corner box gives exactly two safe moves (its
           boundary edges), and after one is played the box merges
           into the fresh chain, extending it 6 -> 7 (both corners:
           6 -> 8) -- so the rest stays a single long chain (worth
           -8 to whoever must open it) and the decomposed-board
           control rule (control iff V(rest) < -4) still applies,
           even with safe moves present. This is the small version
           of the original 7x5 case 21 (same mechanism, same
           +2/-2 numbers); it replaced the 7x5 position 2026-11-19
           after Mike drew it by hand -- the drawn walls v,2,1 and
           v,2,3 between each corner and the chain's middle boxes
           are what make the corners clean. ORDER: no box is claimed
           in the final position, so no preset move can close a box
           -- all 17 moves are toggles, which is an odd count, so
           the turn lands on player 2 and the setup flips it back
           with one toggleTurn() before kicking the AI.
        22) Beginner FAIL / intermediate FAIL / advanced PASS /
           solver PASS: the loose-pair safe-moves position -- the
           second branch of the priced safe-moves rule. 4x3, NOT
           decomposed (12 unclaimed boxes, E=14), AI (player 1)
           to move: a ripe 4-chain {4,1,1} across the top row, a
           fresh 6-chain {6,2,2} snaking across the middle row and
           dipping down in the centre, and a loose pair (2,0),
           (2,1) in the bottom-left corner beside it; no boxes
           claimed. The position is worth +2 and the unique
           optimal first move is v,0,2, ripening the offered
           chain -- verified against the exact solver (ripen +2,
           sweep -2, playing a safe move first -10 for the
           shared edge, -12 for a boundary edge). The heuristic
           (beginner -- and intermediate, whose allcockMove
           declines non-decomposed positions and whose controller
           declines because safe moves exist) sweeps the ripe
           chain and nets -2; advanced finds the ripen via
           minimax. The teeth: the loose pair's shared edge is
           a single safe move, and playing it leaves a 7-chain
           plus a tempo singleton {single:2} -- worth +6 to the
           player to move -- so odd tempo still favours the
           double-cross: control wins iff (even tempo AND
           V(rest) < -4) OR (odd tempo AND V(rest) > 4). This is
           the small version of the original 7x5 case 22 (same
           mechanism, same +2/-2 numbers); it replaced the 7x5
           position 2026-11-19. ORDER: no box is claimed in the
           final position, so no preset move can close a box --
           all 17 moves are toggles, which is an odd count, so
           the turn lands on player 2 and the setup flips it back
           with one toggleTurn() before kicking the AI.
        23) Beginner FAIL (~1/3) / intermediate FAIL (~1/3) /
           advanced PASS / solver PASS: the free-box-versus-
           chain-end take. 4x3, NOT decomposed (12 unclaimed
           boxes, E=12), AI (player 1) to move: an offered
           2-chain {2,1,2} across the top-left, two free boxes
           {single:1} ((0,3) top-right corner and (1,2) centre),
           a fresh 7-chain {7,2,2} snaking through the rest of
           the board, and a 1-sided box (0,2) between the two
           free boxes. The position is worth +4 and the optimal
           first moves are the two free-box takes -- h,2,1
           (takes (1,2)) and v,0,3 (takes (0,3)) -- both +4.
           The trap is v,0,1: it takes (0,0), the 3-sided end
           of the {2,1,2}, worth -2 (6 boxes worse). The
           heuristic's takeOne treats every single-box take as
           equivalent and picks uniformly at random among them,
           so beginner and intermediate take the trap about one
           time in three (measured 10/50 and 19/50 over 50 runs
           each; pooled 29/100); intermediate's allcockMove
           declines the non-decomposed position, so it falls
           through to the same heuristic. Advanced always passes
           via minimax (50/50 h,2,1). The deeper line: after the
           correct first take the winner does NOT take the other
           free box -- offering the top row (v,0,2) and taking
           the 7-chain nets +3 from the position. Mike drew this
           position by hand 2026-11-19. ORDER: no box is claimed
           in the final position, so no preset move can close a
           box -- all 19 moves are toggles, which is an odd count,
           so the turn lands on player 2 and the setup flips it
           back with one toggleTurn() before kicking the AI.
        24) Beginner FAIL / intermediate FAIL / advanced PASS /
           solver PASS: the loop-<=4 ripen counterexample -- the
           first case for the controller's short-loop branch. 3x3,
           NOT decomposed (9 unclaimed boxes, E=10), AI (player 1)
           to move: a 4-chain across the top row and down the right
           column (all 2-sided), an offered 4-loop (1,0),(1,1),
           (2,1),(2,0) with its two bottom boxes 3-sided, and a
           lone 2-sided box (2,2); no boxes claimed, no safe moves.
           The position is worth +7 and the optimal first moves
           take an offered loop box -- h,0,2 or h,1,2 (both +7).
           The heuristic's controller ripens the loop instead:
           doubleLoony plays v,1,1, the edge shared by the loop's
           two 2-sided boxes, worth -7 -- a 14-box swing, the
           largest gap of any case -- verified against the exact
           solver (50/50 runs; the ripen pool has exactly one
           edge). Intermediate's allcockMove declines the
           non-decomposed position and falls through to the same
           heuristic; advanced finds a take via minimax. Found
           2026-11-23 by random search with loop planting (621
           deterministic failures in ~1.9M positions; this is the
           smallest, E=10). ORDER: no box is claimed in the final
           position, so no preset move can close a box -- all 14
           moves are toggles, which is an even count, so the turn
           lands on player 1 (the AI), and move() triggers
           checkAImove. Any order works.
        25) Beginner FAIL / intermediate FAIL / advanced PASS /
           solver PASS: the opener smallest-area counterexample --
           the smallest 2-sided area is the wrong one to open.
           3x3, NOT decomposed (9 unclaimed boxes, E=12), AI
           (player 1) to move. Side counts:
             2 2 2
             2 2 1
             2 1 2
           No take is available, so the heuristic is in opener
           mode. Its smallest 2-sided area is the lone box (0,2)
           -- a single-box area, so findChains finds no chain and
           the opener falls back to a random border edge of it:
           h,2,0 or h,2,1, both worth -1. The optimal first moves
           are the edges of the (1,2)/(2,2) area -- h,1,2, h,2,2,
           v,1,2, v,2,2 (all +3), verified against the exact
           solver -- a 4-box gap, deterministic (50/50 runs).
           Intermediate's allcockMove declines the non-decomposed
           position and falls through to the same heuristic;
           advanced finds an optimal edge via minimax. Found
           2026-11-23 by random search (the only deterministic
           opener failure in ~1.9M positions). ORDER: no box is
           claimed in the final position, so no preset move can
           close a box -- all 12 moves are toggles, which is an
           even count, so the turn lands on player 1 (the AI),
           and move() triggers checkAImove. Any order works.
        26) Beginner FAIL (~63%) / intermediate FAIL (~63%) /
           advanced PASS / solver PASS: the opener within-chain
           edge-choice counterexample -- the right chain, the
           wrong edge. 3x3, NOT decomposed (9 unclaimed boxes,
           E=11), AI (player 1) to move. Side counts:
             2 2 2
             2 2 2
             2 1 2
           No take is available, so the heuristic is in opener
           mode. It picks the smallest chain correctly -- the
           2-box chain (0,1)-(1,1) -- but then picks uniformly
           among that chain's three open edges, and they are not
           equivalent: the interior shared edge h,1,1 is the
           unique optimal move (+5), while the two end edges
           h,1,0 and h,1,2 are both -5 -- a 10-box gap, verified
           against the exact solver. The heuristic plays an end
           edge about two times in three (19/30 runs). Why the
           interior edge wins: it makes both chain boxes 3-sided
           with different closing edges, so the opponent takes
           them and must open the rest; an end edge lets the
           opponent counter-open (h,1,2) and force the mover to
           take both boxes and open the rest instead. This
           refutes the "all chain moves are optimal" note on
           case 9: that claim was verified only on the all-2-sided
           family (test 9 and a ~80k-position search), and this
           position has a 1-sided box (2,1), outside that family.
           Intermediate's allcockMove declines the non-decomposed
           position and falls through to the same heuristic;
           advanced finds h,1,1 via minimax. Found 2026-11-23
           by random search. ORDER: no box is claimed in the
           final position, so no preset move can close a box --
           all 13 moves are toggles, which is an odd count, so
           the turn lands on player 2 and the setup flips it back
           with one toggleTurn() before kicking the AI.
        27) Beginner PASS with the new multi-offer controller
           (PARTIAL 6/10 with the old greedy bail) / intermediate
           PASS (PARTIAL 8/10 with the old code) / advanced PASS /
           solver PASS: the multi-offer counterexample -- two
           offered regions, and greedy takes from the wrong one.
           3x3, decomposed (9 unclaimed boxes, E=9), AI (player 1)
           to move. Side counts:
             2 2 2
             3 2 2
             2 3 3
           Two regions are offered: a 4-loop (1,0):3 (1,1):2
           (1,2):2 (2,2):3 and a {2,1,2} 2-chain (2,0):2
           (2,1):3. The top row is a fresh 3-chain, the rest.
           The position is worth +5 and the optimal first moves
           take a loop box -- h,2,2 or v,1,1 (both +5). The new
           controller leaves the 2-chain last (a chain's give-back
           of 2 beats a loop's 4), sweeps the loop first, then
           double-crosses the 2-chain (v,2,0), so the opponent
           takes both chain boxes and must open the fresh 3-chain
           -- the full line nets +5. The old code bailed on
           multi-offer positions (controllerMove returned null
           unless exactly one region was offered) and fell through
           to greedyTake, which picks uniformly among all 3-sided
           boxes -- including v,2,1, the 2-chain's offered box,
           worth only +3. Taking the 2-chain first collapses it
           to a single box, captured next move, leaving the loop
           as the last offered region; the loop is then ripened
           (doubleLoony) instead of swept -- the case-24 failure
           -- and the line nets only +1 against an optimal
           opponent. Greedy plays the trap 36/100 runs; the new
           controller plays an optimal take 100/100 runs.
           allcockMove declines the position (decomposed but
           out of domain), so intermediate falls through to the
           same heuristic; advanced finds a take via minimax.
           Found 2026-11-23 by targeted random search (5
           first-move multi-offer failures in ~129k positions;
           this is the smallest, E=9). ORDER: no box is claimed
           in the final position, so no preset move can close a
           box -- all 15 moves are toggles, which is an odd count,
           so the turn lands on player 2 and the setup flips it
           back with one toggleTurn() before kicking the AI.
        */


/**
 * Test-case harness for AI behavior testing, extracted from the DotGame
 * constructor. Loads a preset board position into a brand-new game so an AI
 * engine's move in that spot can be inspected.
 *
 * The dropdown labels live on the #test-select element in index.html; the
 * values here ("0"-"23") must stay in sync with those <option> values.
 * The engine under test comes from the #test-ai select.
 *
 * @param {object} game - the DotGame under construction (its board arrays,
 *                        players, move() and checkAImove() are all used)
 * @param {string|number} testCase - selected case; "0" means not testing
 * @param {string} testAI - player under test: 'ai-beginner',
 *                         'ai-intermediate' or 'ai-advanced'
 *                         (from the #test-ai select)
 */
export function setupTestCase(game, testCase, testAI) {
    let height, width;

        if(testCase == 0) {
            game.checkAImove();
        }

	    if(testCase == 1) {
            height = 4;
            width = 3;
            document.getElementById('heightRange').value = height;
            document.getElementById('widthRange').value = width;
            document.getElementById('heightValue').textContent = height;
            document.getElementById('widthValue').textContent = width;
            game.vLines = Array.from({ length: height }, () => Array(width+1).fill(0));
            game.hLines = Array.from({ length: width }, () => Array(height+1).fill(0));
            game.squares = Array.from({ length: height }, () => Array(width).fill(0));
            game.squaresLeft = height * width;
            document.getElementById('player1Type').value = testAI;
            document.getElementById('player2Type').value = 'human';
            game.players[0] = new Player(game.players[0].name,game.players[0].color,game.players[0].hover,testAI);
            game.players[1] = new Player(game.players[1].name,game.players[1].color,game.players[1].hover,'human');

            game.players[0].ai = false;
            game.move("h,0,0");
            game.move("h,0,2");
            game.move("h,0,4");
            game.move("h,1,0");
            game.move("h,1,4");
            game.move("h,2,0");
            game.move("h,2,2");
            game.move("h,2,4");
            game.move("v,0,1");
            game.move("v,0,3");
            game.move("v,1,1");
            game.move("v,1,3");
            game.move("v,2,1");
            game.move("v,2,2");
            game.move("v,3,0");
            if (testAI !== 'human') game.players[0].ai = true;
            game.move("v,3,3");
        }

        if(testCase == 2) {
            height = 4;
            width = 3;
            document.getElementById('heightRange').value = height;
            document.getElementById('widthRange').value = width;
            document.getElementById('heightValue').textContent = height;
            document.getElementById('widthValue').textContent = width;
            game.vLines = Array.from({ length: height }, () => Array(width+1).fill(0));
            game.hLines = Array.from({ length: width }, () => Array(height+1).fill(0));
            game.squares = Array.from({ length: height }, () => Array(width).fill(0));
            game.squaresLeft = height * width;
            document.getElementById('player1Type').value = testAI;
            document.getElementById('player2Type').value = 'human';
            game.players[0] = new Player(game.players[0].name,game.players[0].color,game.players[0].hover,testAI);
            game.players[1] = new Player(game.players[1].name,game.players[1].color,game.players[1].hover,'human');
    
            game.players[0].ai = false;
            game.move("h,0,0");
            game.move("h,0,3");
            game.move("h,0,4");
            game.move("h,1,0");
            game.move("h,1,1");
            game.move("h,1,2");
            game.move("h,1,3");
            game.move("h,1,4");
            game.move("h,2,0");
            game.move("h,2,2");
            game.move("h,2,4");
            game.move("v,0,0");
            game.move("v,0,3");
            game.move("v,1,0");
            game.move("v,1,3");
            game.move("v,2,0");
            game.move("v,2,3");
            if (testAI !== 'human') game.players[0].ai = true;
            game.move("v,3,3");
        }

        if(testCase == 3) {
            height = 5;
            width = 2;
            document.getElementById('heightRange').value = height;
            document.getElementById('widthRange').value = width;
            document.getElementById('heightValue').textContent = height;
            document.getElementById('widthValue').textContent = width;
            game.vLines = Array.from({ length: height }, () => Array(width+1).fill(0));
            game.hLines = Array.from({ length: width }, () => Array(height+1).fill(0));
            game.squares = Array.from({ length: height }, () => Array(width).fill(0));
            game.squaresLeft = height * width;
            document.getElementById('player1Type').value = testAI;
            document.getElementById('player2Type').value = 'human';
            game.players[0] = new Player(game.players[0].name,game.players[0].color,game.players[0].hover,testAI);
            game.players[1] = new Player(game.players[1].name,game.players[1].color,game.players[1].hover,'human');
    
            game.players[0].ai = false;
            game.move("h,0,0");
            game.move("h,0,5");
            game.move("h,1,0");
            game.move("h,1,2");
            game.move("h,1,5");
            game.move("v,0,0");
            game.move("v,0,2");
            game.move("v,1,0");
            game.move("v,1,2");
            game.move("v,2,0");
            game.move("v,2,1");
            game.move("v,3,0");
            game.move("v,3,1");
            game.move("v,3,2");
            game.move("v,4,0");
            if (testAI !== 'human') game.players[0].ai = true;
            game.move("v,4,2");
        }

        if(testCase == 4) {
            height = 4;
            width = 3;
            document.getElementById('heightRange').value = height;
            document.getElementById('widthRange').value = width;
            document.getElementById('heightValue').textContent = height;
            document.getElementById('widthValue').textContent = width;
            game.vLines = Array.from({ length: height }, () => Array(width+1).fill(0));
            game.hLines = Array.from({ length: width }, () => Array(height+1).fill(0));
            game.squares = Array.from({ length: height }, () => Array(width).fill(0));
            game.squaresLeft = height * width;
            document.getElementById('player1Type').value = 'human';
            document.getElementById('player2Type').value = testAI;
            game.players[0] = new Player(game.players[0].name,game.players[0].color,game.players[0].hover,'human');
            game.players[1] = new Player(game.players[1].name,game.players[1].color,game.players[1].hover,testAI);
    
            game.players[1].ai = false;
            game.move("h,0,3");
            game.move("h,0,4");
            game.move("h,1,0");
            game.move("h,1,2");
            game.move("h,1,3");
            game.move("h,1,4");
            game.move("h,2,0");
            game.move("h,2,2");
            game.move("h,2,4");
            game.move("v,0,0");
            game.move("v,0,1");
            game.move("v,0,2");
            game.move("v,0,3");
            game.move("v,1,0");
            game.move("v,1,1");
            game.move("v,1,3");
            game.move("v,2,0");
            game.move("v,2,3");
            if (testAI !== 'human') game.players[1].ai = true;
            game.move("v,3,3");
        }

        if(testCase == 5) {
            height = 2;
            width = 2;
            document.getElementById('heightRange').value = height;
            document.getElementById('widthRange').value = width;
            document.getElementById('heightValue').textContent = height;
            document.getElementById('widthValue').textContent = width;
            game.vLines = Array.from({ length: height }, () => Array(width+1).fill(0));
            game.hLines = Array.from({ length: width }, () => Array(height+1).fill(0));
            game.squares = Array.from({ length: height }, () => Array(width).fill(0));
            game.squaresLeft = height * width;
            document.getElementById('player1Type').value = testAI;
            document.getElementById('player2Type').value = 'human';
            game.players[0] = new Player(game.players[0].name,game.players[0].color,game.players[0].hover,testAI);
            game.players[1] = new Player(game.players[1].name,game.players[1].color,game.players[1].hover,'human');
    
            game.players[0].ai = false;
            game.move("h,0,2");
            game.move("h,1,1");
            game.move("h,1,2");
            game.move("v,0,0");
            game.move("v,0,1");
            if (testAI !== 'human') game.players[0].ai = true;
            game.move("v,1,0");
        }

        if(testCase == 6) {
            height = 5;
            width = 5;
            document.getElementById('heightRange').value = height;
            document.getElementById('widthRange').value = width;
            document.getElementById('heightValue').textContent = height;
            document.getElementById('widthValue').textContent = width;
            game.vLines = Array.from({ length: height }, () => Array(width+1).fill(0));
            game.hLines = Array.from({ length: width }, () => Array(height+1).fill(0));
            game.squares = Array.from({ length: height }, () => Array(width).fill(0));
            game.squaresLeft = height * width;
            document.getElementById('player1Type').value = 'human';
            document.getElementById('player2Type').value = testAI;
            game.players[0] = new Player(game.players[0].name,game.players[0].color,game.players[0].hover,'human');
            game.players[1] = new Player(game.players[1].name,game.players[1].color,game.players[1].hover,testAI);
    
            game.players[1].ai = false;
            game.move("h,0,0");
            game.move("h,1,0");
            game.move("h,1,5");
            game.move("h,2,5");
            game.move("h,3,0");
            game.move("h,3,5");
            game.move("h,4,0");
            game.move("h,4,2");
            game.move("h,4,5");
            game.move("v,0,0");
            game.move("v,0,2");
            game.move("v,0,3");
            game.move("v,0,5");
            game.move("v,1,0");
            game.move("v,1,1");
            game.move("v,1,2");
            game.move("v,1,3");
            game.move("v,1,5");
            game.move("v,2,0");
            game.move("v,2,1");
            game.move("v,2,2");
            game.move("v,2,3");
            game.move("v,2,4");
            game.move("v,3,0");
            game.move("v,3,1");
            game.move("v,3,2");
            game.move("v,3,3");
            game.move("v,3,4");
            game.move("v,3,5");
            game.move("v,4,0");
            game.move("v,4,1");
            game.move("v,4,3");
            if (testAI !== 'human') game.players[1].ai = true;
            game.move("v,4,5");
        }

        if(testCase == 7) {
            height = 5;
            width = 5;
            document.getElementById('heightRange').value = height;
            document.getElementById('widthRange').value = width;
            document.getElementById('heightValue').textContent = height;
            document.getElementById('widthValue').textContent = width;
            game.vLines = Array.from({ length: height }, () => Array(width+1).fill(0));
            game.hLines = Array.from({ length: width }, () => Array(height+1).fill(0));
            game.squares = Array.from({ length: height }, () => Array(width).fill(0));
            game.squaresLeft = height * width;
            document.getElementById('player1Type').value = testAI;
            document.getElementById('player2Type').value = 'human';
            game.players[0] = new Player(game.players[0].name,game.players[0].color,game.players[0].hover,testAI);
            game.players[1] = new Player(game.players[1].name,game.players[1].color,game.players[1].hover,'human');
    
            game.players[0].ai = false;
            game.move("h,0,0");
            game.move("h,1,0");
            game.move("h,1,5");
            game.move("h,2,5");
            game.move("h,3,0");
            game.move("h,3,5");
            game.move("h,4,0");
            game.move("h,4,5");
            game.move("v,0,0");
            game.move("v,0,2");
            game.move("v,0,3");
            game.move("v,0,5");
            game.move("v,1,0");
            game.move("v,1,1");
            game.move("v,1,2");
            game.move("v,1,3");
            game.move("v,1,5");
            game.move("v,2,0");
            game.move("v,2,1");
            game.move("v,2,2");
            game.move("v,2,3");
            game.move("v,2,4");
            game.move("v,3,0");
            game.move("v,3,1");
            game.move("v,3,2");
            game.move("v,3,3");
            game.move("v,3,4");
            game.move("v,3,5");
            game.move("v,4,0");
            game.move("v,4,1");
            game.move("v,4,3");
            game.move("v,4,5");
            game.move("h,3,2");
            game.move("h,3,3");
            game.move("h,3,4");
            game.move("v,4,4");
            game.move("h,4,4");
            if (testAI !== 'human') game.players[0].ai = true;
            game.move("h,4,2");
        }

        if(testCase == 8) {
            // Loop hardhearted handout. 4x3 board: a 6-loop (rows 0-1, cols 0-2)
            // offered via the shared edge v,0,1 (two 3-sided boxes), plus a 6-chain
            // snaking through rows 2-3: (2,0)-(2,1)-(2,2)-(3,2)-(3,1)-(3,0).
            // 19 preset moves, no takes, so player 2 (the AI) is to move.
            // The AI is the controller. Optimal play (verified with the exact
            // solver): take 2 from the loop (h,0,1 takes (0,0), then v,0,2 takes
            // (0,1)), then STOP taking and offer the remaining 4 with the double
            // loony v,1,2. The opponent takes those 4 and must open the chain,
            // which the AI sweeps. Final 8-4, AI wins. Taking all 6 loop boxes
            // instead only ties 6-6, so this tests the leave-4 rule for loops.
            height = 4;
            width = 3;
            document.getElementById('heightRange').value = height;
            document.getElementById('widthRange').value = width;
            document.getElementById('heightValue').textContent = height;
            document.getElementById('widthValue').textContent = width;
            game.vLines = Array.from({ length: height }, () => Array(width+1).fill(0));
            game.hLines = Array.from({ length: width }, () => Array(height+1).fill(0));
            game.squares = Array.from({ length: height }, () => Array(width).fill(0));
            game.squaresLeft = height * width;
            document.getElementById('player1Type').value = 'human';
            document.getElementById('player2Type').value = testAI;
            game.players[0] = new Player(game.players[0].name,game.players[0].color,game.players[0].hover,'human');
            game.players[1] = new Player(game.players[1].name,game.players[1].color,game.players[1].hover,testAI);

            game.players[1].ai = false;
            // 6-loop walls (rows 0-1, cols 0-2)
            game.move("h,0,0");
            game.move("h,1,0");
            game.move("h,2,0");
            game.move("h,1,1");
            game.move("h,2,2");
            game.move("h,1,2");
            game.move("h,0,2");
            game.move("v,0,0");
            game.move("v,0,3");
            game.move("v,1,3");
            game.move("v,1,0");
            // loony offer: shared edge gives (0,0) and (0,1) their 3rd sides
            game.move("v,0,1");
            // 6-chain snake walls: (2,0)-(2,1)-(2,2)-(3,2)-(3,1)-(3,0)
            game.move("h,0,3");
            game.move("h,1,3");
            game.move("v,2,3");
            game.move("h,2,4");
            game.move("v,3,3");
            game.move("h,1,4");
            if (testAI !== 'human') game.players[1].ai = true;
            game.move("h,0,4");
        }

        if(testCase == 9) {
            // Opener chain choice on a 4-chain. 4x4 board, opener mode
            // (no 3-sided boxes). A 4-chain (2,2)-(3,2)-(3,3)-(2,3) plus a
            // blob. 22 preset moves, no takes, so player 1 (the AI) is to move.
            // Solver (re-verified 2026-10-29 by solving every legal move):
            // the five chain moves h,2,2, h,2,3, h,3,3, v,2,4, v,3,3 are ALL
            // optimal (-4) -- the ends and the interior moves tie, because a
            // 4-chain only splits 1-3 or 2-2 and both come out the same. The
            // other 13 legal moves are unsafe blob moves: nine are -8 and
            // four are -12. So this case really tests "play in the chain vs
            // blunder in the blob", and the heuristic cannot fail it: its
            // safe set is exactly the five chain moves. (A longer-chain
            // version where ends-vs-interior discriminates was searched
            // for over ~80k solver-verified positions and appears not to
            // exist in the all-2-sided family; dropped 2026-10-29.)
            // (An earlier version of this comment claimed only h,2,2 was
            // optimal and the rest were -6; that was never true.)
            height = 4;
            width = 4;
            document.getElementById('heightRange').value = height;
            document.getElementById('widthRange').value = width;
            document.getElementById('heightValue').textContent = height;
            document.getElementById('widthValue').textContent = width;
            game.vLines = Array.from({ length: height }, () => Array(width+1).fill(0));
            game.hLines = Array.from({ length: width }, () => Array(height+1).fill(0));
            game.squares = Array.from({ length: height }, () => Array(width).fill(0));
            game.squaresLeft = height * width;
            document.getElementById('player1Type').value = testAI;
            document.getElementById('player2Type').value = 'human';
            game.players[0] = new Player(game.players[0].name,game.players[0].color,game.players[0].hover,testAI);
            game.players[1] = new Player(game.players[1].name,game.players[1].color,game.players[1].hover,'human');

            game.players[0].ai = false;
            // left edge
            game.move("v,0,0");
            game.move("v,1,0");
            game.move("v,2,0");
            game.move("v,3,0");
            // x=1
            game.move("v,0,1");
            game.move("v,1,1");
            game.move("v,2,1");
            // x=2
            game.move("v,0,2");
            game.move("v,1,2");
            game.move("v,2,2");
            game.move("v,3,2");
            // top right
            game.move("h,2,0");
            game.move("h,3,0");
            // x=4
            game.move("v,0,4");
            game.move("v,1,4");
            game.move("v,3,4");
            // middle right
            game.move("h,3,2");
            game.move("v,2,3");
            // bottom
            game.move("h,0,4");
            game.move("h,1,4");
            game.move("h,2,4");
            if (testAI !== 'human') game.players[0].ai = true;
            game.move("h,3,4");
        }

        if(testCase == 10) {
            // First deterministic single-offer controller failure. 5x5 board,
            // AI (player 1) to move. Side counts (X = taken):
            //   3 X X 2 2
            //   2 2 2 2 2
            //   X 2 2 2 2
            //   X 2 2 2 2
            //   X 2 2 X X
            // Single offer: the 2-chain (0,0)-(1,0); unopened 4-chain
            // (top right), 8-loop (center), 4-loop (bottom right).
            // Before the 2026-10-26 cascade, heuristic controllerMove
            // double-crossed the 2-chain with v,1,0 (closing nothing)
            // for a remaining differential of -2. Since the cascade's
            // evaluator branch (this position is decomposed), the
            // heuristic plays the optimal move instead.
            // Optimal (exact solver, unique argmax): h,0,1 takes (0,0) and
            // cascades to (1,0) for +2. Gap: 4 boxes.
            // ORDER MATTERS below: the 4 shared edges between taken boxes
            // go first so no preset move closes two boxes; with 7 single
            // closes and 34 toggles, the turn lands back on player 1 (the
            // AI) after the final non-closing move, and move() triggers
            // checkAImove. Do not reorder without re-checking the turn.
            height = 5;
            width = 5;
            document.getElementById('heightRange').value = height;
            document.getElementById('widthRange').value = width;
            document.getElementById('heightValue').textContent = height;
            document.getElementById('widthValue').textContent = width;
            game.vLines = Array.from({ length: height }, () => Array(width+1).fill(0));
            game.hLines = Array.from({ length: width }, () => Array(height+1).fill(0));
            game.squares = Array.from({ length: height }, () => Array(width).fill(0));
            game.squaresLeft = height * width;
            document.getElementById('player1Type').value = testAI;
            document.getElementById('player2Type').value = 'human';
            game.players[0] = new Player(game.players[0].name,game.players[0].color,game.players[0].hover,testAI);
            game.players[1] = new Player(game.players[1].name,game.players[1].color,game.players[1].hover,'human');

            game.players[0].ai = false;
            // Shared edges between taken boxes first (see note above).
            game.move("v,0,2");
            game.move("h,0,3");
            game.move("h,0,4");
            game.move("v,4,4");
            game.move("h,0,0");
            game.move("h,0,2");
            game.move("h,0,5");
            game.move("h,1,0");
            game.move("h,1,1");
            game.move("h,1,5");
            game.move("h,2,0");
            game.move("h,2,1");
            game.move("h,2,5");
            game.move("h,3,2");
            game.move("h,3,4");
            game.move("h,3,5");
            game.move("h,4,0");
            game.move("h,4,2");
            game.move("h,4,4");
            game.move("h,4,5");
            game.move("v,0,0");
            game.move("v,0,1");
            game.move("v,0,3");
            game.move("v,0,4");
            game.move("v,1,1");
            game.move("v,1,3");
            game.move("v,1,5");
            game.move("v,2,0");
            game.move("v,2,1");
            game.move("v,2,2");
            game.move("v,2,3");
            game.move("v,3,0");
            game.move("v,3,1");
            game.move("v,3,2");
            game.move("v,3,3");
            game.move("v,3,5");
            game.move("v,4,0");
            game.move("v,4,1");
            game.move("v,4,3");
            game.move("v,4,5");
            if (testAI !== 'human') game.players[0].ai = true;
            game.move("v,2,5");
        }

        if(testCase == 11) {
            // Same board as case 10 except v,0,4 is removed and v,0,5 +
            // h,3,0 are added. Side counts (X = taken) are identical:
            //   3 X X 2 2
            //   2 2 2 2 2
            //   X 2 2 2 2
            //   X 2 2 2 2
            //   X 2 2 X X
            // but the unplayed shared edge v,0,4 now closes the cycle, so
            // the unopened 4-chain (top right) becomes a 4-loop. Remaining
            // inventory is all loops: 8-loop (center) + two 4-loops.
            // Single offer: the 2-chain (0,0)-(1,0). Before the
            // 2026-10-26 cascade, heuristic controllerMove
            // double-crossed it with v,1,0 (closing nothing) for -2.
            // Since the cascade's evaluator branch, the heuristic
            // plays the optimal move instead. Optimal (exact
            // decomposed evaluator, unique argmax): h,0,1 takes (0,0)
            // and cascades to (1,0) for +2. Gap: 4 boxes, as in case 10.
            // ORDER MATTERS below: 42 moves, one more than case 10, so
            // the parity flips -- the turn lands on player 1 (the AI)
            // only if exactly one preset move closes two boxes. The
            // shared edge v,4,4 therefore goes LAST, after both its
            // boxes are 3-sided, closing (4,3) and (4,4) together; with
            // 6 closing moves and 36 toggles, the turn is player 1
            // after the final closing move, and move() triggers
            // checkAImove. Do not reorder without re-checking the turn.
            height = 5;
            width = 5;
            document.getElementById('heightRange').value = height;
            document.getElementById('widthRange').value = width;
            document.getElementById('heightValue').textContent = height;
            document.getElementById('widthValue').textContent = width;
            game.vLines = Array.from({ length: height }, () => Array(width+1).fill(0));
            game.hLines = Array.from({ length: width }, () => Array(height+1).fill(0));
            game.squares = Array.from({ length: height }, () => Array(width).fill(0));
            game.squaresLeft = height * width;
            document.getElementById('player1Type').value = testAI;
            document.getElementById('player2Type').value = 'human';
            game.players[0] = new Player(game.players[0].name,game.players[0].color,game.players[0].hover,testAI);
            game.players[1] = new Player(game.players[1].name,game.players[1].color,game.players[1].hover,'human');

            game.players[0].ai = false;
            // Shared edges between taken boxes first (see note above),
            // except v,4,4 which goes last as the double-close.
            game.move("v,0,2");
            game.move("h,0,3");
            game.move("h,0,4");
            game.move("h,0,0");
            game.move("h,0,2");
            game.move("h,0,5");
            game.move("h,1,0");
            game.move("h,1,1");
            game.move("h,1,5");
            game.move("h,2,0");
            game.move("h,2,1");
            game.move("h,2,5");
            game.move("h,3,2");
            game.move("h,3,4");
            game.move("h,3,5");
            game.move("h,4,0");
            game.move("h,4,2");
            game.move("h,4,4");
            game.move("h,4,5");
            game.move("v,0,0");
            game.move("v,0,1");
            game.move("v,0,3");
            game.move("v,1,1");
            game.move("v,1,3");
            game.move("v,1,5");
            game.move("v,2,0");
            game.move("v,2,1");
            game.move("v,2,2");
            game.move("v,2,3");
            game.move("v,3,0");
            game.move("v,3,1");
            game.move("v,3,2");
            game.move("v,3,3");
            game.move("v,3,5");
            game.move("v,4,0");
            game.move("v,4,1");
            game.move("v,4,3");
            game.move("v,4,5");
            game.move("v,0,5");
            game.move("h,3,0");
            game.move("v,2,5");
            if (testAI !== 'human') game.players[0].ai = true;
            game.move("v,4,4");
        }

        if(testCase == 12) {
            // Decline-a-take counterexample (non-decomposed). 3x3 board,
            // AI (player 1) to move. No box is claimed, so no preset
            // move can close a box: all 10 moves are toggles, the turn
            // lands on player 1, and move() triggers checkAImove.
            // Optimal (exact solver): decline the take v,2,1 (-1) and
            // play v,2,2 (+1) instead. The standalone heuristic always
            // takes when a take is available, so it plays v,2,1 here.
            height = 3;
            width = 3;
            document.getElementById('heightRange').value = height;
            document.getElementById('widthRange').value = width;
            document.getElementById('heightValue').textContent = height;
            document.getElementById('widthValue').textContent = width;
            game.vLines = Array.from({ length: height }, () => Array(width+1).fill(0));
            game.hLines = Array.from({ length: width }, () => Array(height+1).fill(0));
            game.squares = Array.from({ length: height }, () => Array(width).fill(0));
            game.squaresLeft = height * width;
            document.getElementById('player1Type').value = testAI;
            document.getElementById('player2Type').value = 'human';
            game.players[0] = new Player(game.players[0].name,game.players[0].color,game.players[0].hover,testAI);
            game.players[1] = new Player(game.players[1].name,game.players[1].color,game.players[1].hover,'human');

            game.players[0].ai = false;
            game.move("h,0,2");
            game.move("h,0,3");
            game.move("h,1,0");
            game.move("h,1,2");
            game.move("h,1,3");
            game.move("h,2,3");
            game.move("v,0,0");
            game.move("v,1,1");
            game.move("v,1,3");
            if (testAI !== 'human') game.players[0].ai = true;
            game.move("v,2,0");
        }

        if(testCase == 13) {
            // E=20 sacrifice position (benchmark seed 1020). 3x3 board,
            // AI (player 1) to move. No box is claimed, so no preset
            // move can close a box: all 4 moves are toggles, the turn
            // lands on player 1, and move() triggers checkAImove.
            // Optimal (exact solver): give (1,1) its 3rd side with
            // h,1,2 or v,1,2 (tied, -1). The heuristic, in opener
            // mode, plays a random safe move (all -3); the unified
            // engine currently falls through to it here.
            height = 3;
            width = 3;
            document.getElementById('heightRange').value = height;
            document.getElementById('widthRange').value = width;
            document.getElementById('heightValue').textContent = height;
            document.getElementById('widthValue').textContent = width;
            game.vLines = Array.from({ length: height }, () => Array(width+1).fill(0));
            game.hLines = Array.from({ length: width }, () => Array(height+1).fill(0));
            game.squares = Array.from({ length: height }, () => Array(width).fill(0));
            game.squaresLeft = height * width;
            document.getElementById('player1Type').value = testAI;
            document.getElementById('player2Type').value = 'human';
            game.players[0] = new Player(game.players[0].name,game.players[0].color,game.players[0].hover,testAI);
            game.players[1] = new Player(game.players[1].name,game.players[1].color,game.players[1].hover,'human');

            game.players[0].ai = false;
            game.move("h,0,3");
            game.move("h,1,1");
            game.move("v,0,3");
            if (testAI !== 'human') game.players[0].ai = true;
            game.move("v,1,1");
        }
        if(testCase == 14) {
            // Lottery pick (benchmark seed 1005). 3x3 board,
            // AI (player 1) to move. No box is claimed, so no preset
            // move can close a box: all 4 moves are toggles, the turn
            // lands on player 1, and move() triggers checkAImove.
            // Optimal (exact solver): h,0,2, v,0,1, v,1,3 (tied, -3)
            // among 18 safe moves; all other 17 moves are -5.
            // The heuristic, in opener mode, picks uniformly among
            // safe moves and hits an optimal only 5/50 seeds; the
            // unified engine falls through to it here
            // (non-decomposed, E=20 > 15 minimax gate) and plays
            // a -5 move. Even cutoff+restricted MCTS never fixed
            // this position (0/3 at 5, 15, and 30 s).
            height = 3;
            width = 3;
            document.getElementById('heightRange').value = height;
            document.getElementById('widthRange').value = width;
            document.getElementById('heightValue').textContent = height;
            document.getElementById('widthValue').textContent = width;
            game.vLines = Array.from({ length: height }, () => Array(width+1).fill(0));
            game.hLines = Array.from({ length: width }, () => Array(height+1).fill(0));
            game.squares = Array.from({ length: height }, () => Array(width).fill(0));
            game.squaresLeft = height * width;
            document.getElementById('player1Type').value = testAI;
            document.getElementById('player2Type').value = 'human';
            game.players[0] = new Player(game.players[0].name,game.players[0].color,game.players[0].hover,testAI);
            game.players[1] = new Player(game.players[1].name,game.players[1].color,game.players[1].hover,'human');

            game.players[0].ai = false;
            game.move("h,0,0");
            game.move("h,1,3");
            game.move("v,1,1");
            if (testAI !== 'human') game.players[0].ai = true;
            game.move("v,1,2");
        }

        if(testCase == 15) {
            // Double-cross guard (from Mike's live game, 2026-10-29).
            // 4x4 board, AI (player 1) to move, E=21, squaresLeft 13.
            // The 19 preset moves replay the actual game in order;
            // three of them close boxes (h,1,1, h,1,3, h,2,3), so the
            // 16 turn-passes land the turn on player 1, and move()
            // triggers checkAImove.
            // The only 3-sided box is the top-right one, missing only
            // h,3,1; taking it is +5 (exact solver, unique optimal)
            // and ripens the box below it. The pre-guard AI played
            // v,1,4 here -- a chainDoubleCross of the 2-region in the
            // right column -- giving both boxes away for -5, a
            // 10-box swing: the double-cross premise (the opponent
            // must open another component) was false, because safe
            // moves existed elsewhere on the board. Since PR #60 the
            // controller declines the giveaway when a safe move
            // exists, and the heuristic takes h,3,1. This is the
            // first case decided by the controller (heuristic-offer):
            // every earlier case is intercepted by the evaluator or
            // minimax, or decided in opener mode.
            height = 4;
            width = 4;
            document.getElementById('heightRange').value = height;
            document.getElementById('widthRange').value = width;
            document.getElementById('heightValue').textContent = height;
            document.getElementById('widthValue').textContent = width;
            game.vLines = Array.from({ length: height }, () => Array(width+1).fill(0));
            game.hLines = Array.from({ length: width }, () => Array(height+1).fill(0));
            game.squares = Array.from({ length: height }, () => Array(width).fill(0));
            game.squaresLeft = height * width;
            document.getElementById('player1Type').value = testAI;
            document.getElementById('player2Type').value = 'human';
            game.players[0] = new Player(game.players[0].name,game.players[0].color,game.players[0].hover,testAI);
            game.players[1] = new Player(game.players[1].name,game.players[1].color,game.players[1].hover,'human');

            game.players[0].ai = false;
            game.move("v,0,1");
            game.move("h,1,0");
            game.move("v,2,3");
            game.move("v,0,2");
            game.move("h,1,1");
            game.move("h,1,2");
            game.move("v,2,1");
            game.move("v,0,0");
            game.move("v,2,2");
            game.move("h,1,3");
            game.move("v,3,4");
            game.move("h,2,2");
            game.move("h,2,3");
            game.move("v,1,3");
            game.move("v,0,3");
            game.move("h,3,2");
            game.move("h,3,0");
            game.move("v,2,0");
            if (testAI !== 'human') game.players[0].ai = true;
            game.move("v,0,4");
        }

        if(testCase == 16) {
            // Forego a take at heuristic scale (case 12's decision,
            // past minimax's reach). 3x3 board, AI (player 1) to
            // move, E=16, no box claimed, so all 8 preset moves are
            // toggles and the turn lands on player 1.
            // Side counts:
            //   2 2 1
            //   3 1 0
            //   2 1 0
            // Optimal (exact solver): forego the take h,0,2 (-3) and
            // play v,2,1 (+3) instead -- it gives (2,0) its 3rd side,
            // so boxes (1,0) and (2,0) come to share their last edge;
            // every other move is -7 (unique optimal, 6-box gap).
            // The heuristic takes on 12/12 seeds (controller bails:
            // no other region of length >= 3; greedyTake completes
            // the box), and the unified engine falls through to it
            // here (non-decomposed, E=16 > 15 minimax gate).
            height = 3;
            width = 3;
            document.getElementById('heightRange').value = height;
            document.getElementById('widthRange').value = width;
            document.getElementById('heightValue').textContent = height;
            document.getElementById('widthValue').textContent = width;
            game.vLines = Array.from({ length: height }, () => Array(width+1).fill(0));
            game.hLines = Array.from({ length: width }, () => Array(height+1).fill(0));
            game.squares = Array.from({ length: height }, () => Array(width).fill(0));
            game.squaresLeft = height * width;
            document.getElementById('player1Type').value = testAI;
            document.getElementById('player2Type').value = 'human';
            game.players[0] = new Player(game.players[0].name,game.players[0].color,game.players[0].hover,testAI);
            game.players[1] = new Player(game.players[1].name,game.players[1].color,game.players[1].hover,'human');

            game.players[0].ai = false;
            game.move("h,0,1");
            game.move("h,0,3");
            game.move("v,0,2");
            game.move("h,1,3");
            game.move("v,0,1");
            game.move("v,1,0");
            game.move("v,1,1");
            if (testAI !== 'human') game.players[0].ai = true;
            game.move("v,2,0");
        }

        if(testCase == 17) {
            // Decomposed counterexample: take the single, not the
            // open 4-loop. 4 rows x 5 cols, AI (player 1) to move.
            // Components (see the header comment): fresh 10-chain
            // on the top two rows, doubly-open 4-loop at the
            // bottom left, single offered box at (4,3), five
            // claimed separator boxes. Optimal: h,4,4 (+7, unique);
            // best move inside the 4-loop is +5; opening the
            // 10-chain is -15. Ordering: v,2,3 is drawn 33rd and
            // closes (2,2) and (3,2) together (4 closing draws in
            // total), so the turn lands on player 1.
            height = 4;
            width = 5;
            document.getElementById('heightRange').value = height;
            document.getElementById('widthRange').value = width;
            document.getElementById('heightValue').textContent = height;
            document.getElementById('widthValue').textContent = width;
            game.vLines = Array.from({ length: height }, () => Array(width+1).fill(0));
            game.hLines = Array.from({ length: width }, () => Array(height+1).fill(0));
            game.squares = Array.from({ length: height }, () => Array(width).fill(0));
            game.squaresLeft = height * width;
            document.getElementById('player1Type').value = testAI;
            document.getElementById('player2Type').value = 'human';
            game.players[0] = new Player(game.players[0].name,game.players[0].color,game.players[0].hover,testAI);
            game.players[1] = new Player(game.players[1].name,game.players[1].color,game.players[1].hover,'human');

            game.players[0].ai = false;
            game.move("h,0,1");
            game.move("h,0,2");
            game.move("h,0,4");
            game.move("h,1,0");
            game.move("h,1,1");
            game.move("h,1,2");
            game.move("h,1,4");
            game.move("h,2,0");
            game.move("h,2,1");
            game.move("h,2,2");
            game.move("h,2,3");
            game.move("h,2,4");
            game.move("h,3,0");
            game.move("h,3,1");
            game.move("h,3,2");
            game.move("h,3,3");
            game.move("h,3,4");
            game.move("h,4,0");
            game.move("h,4,2");
            game.move("h,4,3");
            game.move("v,0,5");
            game.move("v,1,5");
            game.move("v,2,0");
            game.move("v,2,1");
            game.move("v,2,2");
            game.move("v,2,4");
            game.move("v,2,5");
            game.move("v,3,0");
            game.move("v,3,2");
            game.move("v,3,3");
            game.move("v,3,4");
            game.move("v,3,5");
            game.move("v,2,3");
            if (testAI !== 'human') game.players[0].ai = true;
            game.move("h,0,0");
        }
        if(testCase == 18) {
            // Decomposed control-rule counterexample: take the
            // offered 2-chain, do NOT double-cross it. 3 rows x
            // 5 cols, AI (player 1) to move. Components (see the
            // header comment): offered 2-chain (0,0)-(1,0), a
            // 4-ring at cols 3-4 rows 0-1, an unripe singleton at
            // (0,2), eight claimed separator boxes. Optimal:
            // v,0,1 (+5, unique); the double-cross h,1,0 is -5.
            // Ordering: preset moves in id order, h,0,0 last;
            // the 8 closing draws land the turn on player 1.
            height = 3;
            width = 5;
            document.getElementById('heightRange').value = height;
            document.getElementById('widthRange').value = width;
            document.getElementById('heightValue').textContent = height;
            document.getElementById('widthValue').textContent = width;
            game.vLines = Array.from({ length: height }, () => Array(width+1).fill(0));
            game.hLines = Array.from({ length: width }, () => Array(height+1).fill(0));
            game.squares = Array.from({ length: height }, () => Array(width).fill(0));
            game.squaresLeft = height * width;
            document.getElementById('player1Type').value = testAI;
            document.getElementById('player2Type').value = 'human';
            game.players[0] = new Player(game.players[0].name,game.players[0].color,game.players[0].hover,testAI);
            game.players[1] = new Player(game.players[1].name,game.players[1].color,game.players[1].hover,'human');

            game.players[0].ai = false;
            game.move("h,0,1");
            game.move("h,0,2");
            game.move("h,1,1");
            game.move("h,1,2");
            game.move("h,1,3");
            game.move("h,2,0");
            game.move("h,2,1");
            game.move("h,2,2");
            game.move("h,2,3");
            game.move("h,3,0");
            game.move("h,3,2");
            game.move("h,3,3");
            game.move("h,4,0");
            game.move("h,4,2");
            game.move("h,4,3");
            game.move("v,0,0");
            game.move("v,0,2");
            game.move("v,0,3");
            game.move("v,0,5");
            game.move("v,1,0");
            game.move("v,1,1");
            game.move("v,1,2");
            game.move("v,1,3");
            game.move("v,1,5");
            game.move("v,2,1");
            game.move("v,2,2");
            game.move("v,2,3");
            game.move("v,2,4");
            game.move("v,2,5");
            if (testAI !== 'human') game.players[0].ai = true;
            game.move("h,0,0");
        }
        if(testCase == 19) {
            // First beginner/intermediate separator (see the header
            // comment): 6x4, fully decomposed, all components in the
            // Allcock domain -- a fresh 4-ring (cols 0-1, rows 0-1),
            // a fresh 3-chain (top row, cols 3-5), a fresh 5-chain
            // (bottom row, cols 0-4), twelve claimed separators.
            // Optimal: any entry into the ring (h,0,1 / h,1,1 /
            // v,0,1 / v,1,1), worth 0. Beginner opens the 3-chain
            // (-2) on every seed; intermediate opens the ring via
            // allcockMove. The 44 preset moves close exactly the 12
            // separator boxes, one per closing move (no double
            // closes), so the 32 turn-passes land the turn on
            // player 1 (the AI).
            height = 4;
            width = 6;
            document.getElementById('heightRange').value = height;
            document.getElementById('widthRange').value = width;
            document.getElementById('heightValue').textContent = height;
            document.getElementById('widthValue').textContent = width;
            game.vLines = Array.from({ length: height }, () => Array(width+1).fill(0));
            game.hLines = Array.from({ length: width }, () => Array(height+1).fill(0));
            game.squares = Array.from({ length: height }, () => Array(width).fill(0));
            game.squaresLeft = height * width;
            document.getElementById('player1Type').value = testAI;
            document.getElementById('player2Type').value = 'human';
            game.players[0] = new Player(game.players[0].name,game.players[0].color,game.players[0].hover,testAI);
            game.players[1] = new Player(game.players[1].name,game.players[1].color,game.players[1].hover,'human');

            game.players[0].ai = false;
            game.move("v,1,6");
            game.move("v,3,5");
            game.move("v,2,6");
            game.move("h,2,2");
            game.move("v,2,5");
            game.move("v,3,0");
            game.move("h,3,3");
            game.move("h,3,4");
            game.move("v,1,2");
            game.move("h,5,3");
            game.move("h,5,1");
            game.move("v,0,2");
            game.move("h,2,4");
            game.move("h,0,2");
            game.move("h,2,0");
            game.move("h,1,3");
            game.move("v,2,3");
            game.move("v,1,3");
            game.move("v,2,2");
            game.move("v,0,0");
            game.move("h,5,2");
            game.move("h,4,0");
            game.move("h,2,3");
            game.move("h,3,2");
            game.move("h,0,0");
            game.move("h,1,0");
            game.move("v,1,5");
            game.move("h,4,3");
            game.move("v,0,6");
            game.move("h,1,2");
            game.move("v,3,6");
            game.move("v,2,1");
            game.move("v,2,0");
            game.move("v,2,4");
            game.move("h,0,3");
            game.move("h,4,2");
            game.move("h,2,1");
            game.move("v,1,4");
            game.move("h,4,1");
            game.move("h,5,4");
            game.move("v,1,0");
            game.move("h,3,1");
            game.move("v,0,3");
            if (testAI !== 'human') game.players[0].ai = true;
            game.move("h,1,4");
        }
        if(testCase == 20) {
            // Pure opened-chain specimen (see the header comment):
            // 6x4, fully decomposed, exactly one component outside
            // the Allcock domain -- an opened 4-chain {4,1,2}
            // (top row, cols 2-5, left end already opened); a fresh
            // 4-chain (bottom row, cols 0-3) and a fresh 4-ring
            // (cols 0-1, rows 0-1) are the in-domain companions;
            // twelve claimed separators. Unique optimal first move:
            // v,0,3 (+4); all levels play it, but the heuristic's
            // deferred double-cross (h,5,0) donates the last two
            // chain boxes and nets 0 in full play. The 45 preset
            // moves close exactly the 12 separator boxes with
            // exactly one double close, placed last (h,4,2),
            // landing the turn on player 1 (the AI).
            height = 4;
            width = 6;
            document.getElementById('heightRange').value = height;
            document.getElementById('widthRange').value = width;
            document.getElementById('heightValue').textContent = height;
            document.getElementById('widthValue').textContent = width;
            game.vLines = Array.from({ length: height }, () => Array(width+1).fill(0));
            game.hLines = Array.from({ length: width }, () => Array(height+1).fill(0));
            game.squares = Array.from({ length: height }, () => Array(width).fill(0));
            game.squaresLeft = height * width;
            document.getElementById('player1Type').value = testAI;
            document.getElementById('player2Type').value = 'human';
            game.players[0] = new Player(game.players[0].name,game.players[0].color,game.players[0].hover,testAI);
            game.players[1] = new Player(game.players[1].name,game.players[1].color,game.players[1].hover,'human');

            game.players[0].ai = false;
            game.move("h,5,2");
            game.move("v,2,4");
            game.move("v,2,2");
            game.move("h,3,0");
            game.move("h,4,3");
            game.move("v,3,5");
            game.move("v,1,4");
            game.move("v,3,6");
            game.move("h,2,0");
            game.move("v,2,0");
            game.move("h,5,4");
            game.move("v,3,0");
            game.move("h,4,1");
            game.move("h,3,3");
            game.move("v,2,1");
            game.move("v,0,6");
            game.move("h,0,2");
            game.move("h,3,1");
            game.move("h,2,3");
            game.move("v,1,6");
            game.move("h,5,3");
            game.move("h,1,0");
            game.move("h,1,2");
            game.move("v,2,6");
            game.move("v,1,3");
            game.move("v,1,5");
            game.move("v,1,0");
            game.move("h,3,2");
            game.move("h,2,1");
            game.move("h,2,4");
            game.move("h,1,4");
            game.move("v,2,5");
            game.move("v,0,0");
            game.move("h,1,3");
            game.move("v,2,3");
            game.move("v,0,2");
            game.move("h,4,4");
            game.move("h,2,2");
            game.move("h,4,0");
            game.move("h,5,1");
            game.move("v,1,2");
            game.move("v,3,4");
            game.move("h,0,3");
            game.move("h,0,0");
            if (testAI !== 'human') game.players[0].ai = true;
            game.move("h,4,2");
        }
        if(testCase == 21) {
            // Safe-moves counterexample (see the header comment):
            // 4x3, NOT decomposed, AI (player 1) to move -- a ripe
            // 4-chain {4,1,1} (top row), a fresh 6-chain {6,2,2}
            // snaking across the middle row and dipping down in the
            // centre, and a 1-sided corner box at each bottom
            // corner ((2,0) and (2,3)); no boxes claimed. Unique
            // optimal first move: v,0,2, ripening the offered
            // chain (+2); sweeping is -2 and playing a safe move
            // first is -12 (verified against the exact solver).
            // Beginner and intermediate sweep (their controller
            // declines: safe moves exist); advanced ripens via
            // minimax. The 17 preset moves are all toggles (no box
            // is claimed, so none can close a box) -- an odd count,
            // so the turn lands on player 2; one toggleTurn() flips
            // it back to player 1 (the AI) and checkAImove() kicks
            // the AI.
            height = 3;
            width = 4;
            document.getElementById('heightRange').value = height;
            document.getElementById('widthRange').value = width;
            document.getElementById('heightValue').textContent = height;
            document.getElementById('widthValue').textContent = width;
            game.vLines = Array.from({ length: height }, () => Array(width+1).fill(0));
            game.hLines = Array.from({ length: width }, () => Array(height+1).fill(0));
            game.squares = Array.from({ length: height }, () => Array(width).fill(0));
            game.squaresLeft = height * width;
            document.getElementById('player1Type').value = testAI;
            document.getElementById('player2Type').value = 'human';
            game.players[0] = new Player(game.players[0].name,game.players[0].color,game.players[0].hover,testAI);
            game.players[1] = new Player(game.players[1].name,game.players[1].color,game.players[1].hover,'human');

            game.players[0].ai = false;
            game.move("h,0,0");
            game.move("h,0,1");
            game.move("h,1,0");
            game.move("h,1,1");
            game.move("h,1,3");
            game.move("h,2,0");
            game.move("h,2,1");
            game.move("h,2,3");
            game.move("h,3,0");
            game.move("h,3,1");
            game.move("v,0,0");
            game.move("v,0,4");
            game.move("v,1,0");
            game.move("v,1,2");
            game.move("v,1,4");
            game.move("v,2,1");
            game.move("v,2,3");
            // 17 toggles land the turn on player 2; flip it back
            // to player 1 (the AI) and kick the AI explicitly.
            game.toggleTurn();
            if (testAI !== 'human') game.players[0].ai = true;
            game.checkAImove();
        }
        if(testCase == 22) {
            // Loose-pair safe-moves position (see the header comment):
            // 4x3, NOT decomposed, AI (player 1) to move -- a ripe
            // 4-chain {4,1,1} (top row), a fresh 6-chain {6,2,2}
            // snaking across the middle row and dipping down in the
            // centre, and a loose pair (2,0),(2,1) in the
            // bottom-left corner beside it; no boxes claimed.
            // Unique optimal first move: v,0,2, ripening the offered
            // chain (+2); sweeping is -2 and playing a safe move
            // first is -10 (the shared edge) or -12 (a boundary
            // edge), verified against the exact solver. Beginner
            // and intermediate sweep the ripe chain (their
            // controller declines: safe moves exist); advanced
            // ripens via minimax. The 17 preset moves are all
            // toggles (no box is claimed, so none can close a
            // box) -- an odd count, so the turn lands on player 2;
            // one toggleTurn() flips it back to player 1 (the AI)
            // and checkAImove() kicks the AI.
            height = 3;
            width = 4;
            document.getElementById('heightRange').value = height;
            document.getElementById('widthRange').value = width;
            document.getElementById('heightValue').textContent = height;
            document.getElementById('widthValue').textContent = width;
            game.vLines = Array.from({ length: height }, () => Array(width+1).fill(0));
            game.hLines = Array.from({ length: width }, () => Array(height+1).fill(0));
            game.squares = Array.from({ length: height }, () => Array(width).fill(0));
            game.squaresLeft = height * width;
            document.getElementById('player1Type').value = testAI;
            document.getElementById('player2Type').value = 'human';
            game.players[0] = new Player(game.players[0].name,game.players[0].color,game.players[0].hover,testAI);
            game.players[1] = new Player(game.players[1].name,game.players[1].color,game.players[1].hover,'human');

            game.players[0].ai = false;
            game.move("h,0,0");
            game.move("h,0,1");
            game.move("h,0,2");
            game.move("h,1,0");
            game.move("h,1,1");
            game.move("h,1,2");
            game.move("h,2,0");
            game.move("h,2,1");
            game.move("h,2,2");
            game.move("h,2,3");
            game.move("h,3,0");
            game.move("h,3,1");
            game.move("h,3,3");
            game.move("v,0,0");
            game.move("v,0,4");
            game.move("v,1,4");
            game.move("v,2,4");
            // 17 toggles land the turn on player 2; flip it back
            // to player 1 (the AI) and kick the AI explicitly.
            game.toggleTurn();
            if (testAI !== 'human') game.players[0].ai = true;
            game.checkAImove();
        }

        if(testCase == 23) {
            // Free-box-versus-chain-end take (see the header comment):
            // 4x3, NOT decomposed, AI (player 1) to move -- an offered
            // 2-chain {2,1,2} (top-left), two free boxes {single:1}
            // ((0,3) and (1,2)), a fresh 7-chain {7,2,2} snaking
            // through the rest, and a 1-sided box (0,2) between the
            // free boxes; no boxes claimed. Optimal first moves: the
            // two free-box takes h,2,1 and v,0,3 (both +4). The trap
            // is v,0,1, taking (0,0), the 3-sided end of the {2,1,2}
            // (-2); the heuristic's takeOne picks uniformly among the
            // three single-box takes, so beginner and intermediate
            // take the trap ~1/3 of the time, while advanced always
            // passes via minimax. The 19 preset moves are all toggles
            // (no box is claimed, so none can close a box) -- an odd
            // count, so the turn lands on player 2; one toggleTurn()
            // flips it back to player 1 (the AI) and checkAImove()
            // kicks the AI.
            height = 3;
            width = 4;
            document.getElementById('heightRange').value = height;
            document.getElementById('widthRange').value = width;
            document.getElementById('heightValue').textContent = height;
            document.getElementById('widthValue').textContent = width;
            game.vLines = Array.from({ length: height }, () => Array(width+1).fill(0));
            game.hLines = Array.from({ length: width }, () => Array(height+1).fill(0));
            game.squares = Array.from({ length: height }, () => Array(width).fill(0));
            game.squaresLeft = height * width;
            document.getElementById('player1Type').value = testAI;
            document.getElementById('player2Type').value = 'human';
            game.players[0] = new Player(game.players[0].name,game.players[0].color,game.players[0].hover,testAI);
            game.players[1] = new Player(game.players[1].name,game.players[1].color,game.players[1].hover,'human');

            game.players[0].ai = false;
            game.move("h,0,0");
            game.move("h,0,1");
            game.move("h,1,0");
            game.move("h,1,1");
            game.move("h,1,3");
            game.move("h,2,0");
            game.move("h,2,2");
            game.move("h,2,3");
            game.move("h,3,0");
            game.move("h,3,1");
            game.move("h,3,3");
            game.move("v,0,0");
            game.move("v,0,4");
            game.move("v,1,0");
            game.move("v,1,2");
            game.move("v,1,3");
            game.move("v,2,0");
            game.move("v,2,1");
            game.move("v,2,4");
            // 19 toggles land the turn on player 2; flip it back
            // to player 1 (the AI) and kick the AI explicitly.
            game.toggleTurn();
            if (testAI !== 'human') game.players[0].ai = true;
            game.checkAImove();
        }
        if(testCase == 24) {
            // Loop-<=4 ripen counterexample (see the header comment):
            // 3x3, NOT decomposed, AI (player 1) to move -- a 4-chain
            // across the top row and down the right column (all
            // 2-sided), an offered 4-loop (1,0),(1,1),(2,1),(2,0)
            // with its two bottom boxes 3-sided, and a lone 2-sided
            // box (2,2); no boxes claimed, no safe moves. Optimal
            // first moves: h,0,2 or h,1,2, taking an offered loop
            // box (both +7). The heuristic's controller ripens the
            // loop instead (doubleLoony v,1,1, -7). The 14 preset
            // moves are all toggles (no box is claimed, so none can
            // close a box) -- an even count, so the turn lands on
            // player 1 (the AI), and the last move triggers
            // checkAImove.
            height = 3;
            width = 3;
            document.getElementById('heightRange').value = height;
            document.getElementById('widthRange').value = width;
            document.getElementById('heightValue').textContent = height;
            document.getElementById('widthValue').textContent = width;
            game.vLines = Array.from({ length: height }, () => Array(width+1).fill(0));
            game.hLines = Array.from({ length: width }, () => Array(height+1).fill(0));
            game.squares = Array.from({ length: height }, () => Array(width).fill(0));
            game.squaresLeft = height * width;
            document.getElementById('player1Type').value = testAI;
            document.getElementById('player2Type').value = 'human';
            game.players[0] = new Player(game.players[0].name,game.players[0].color,game.players[0].hover,testAI);
            game.players[1] = new Player(game.players[1].name,game.players[1].color,game.players[1].hover,'human');

            game.players[0].ai = false;
            game.move("h,0,1");
            game.move("v,1,0");
            game.move("h,1,1");
            game.move("v,1,2");
            game.move("h,1,3");
            game.move("v,2,2");
            game.move("h,0,3");
            game.move("v,2,0");
            game.move("v,2,1");
            game.move("h,2,2");
            game.move("v,0,3");
            game.move("h,1,0");
            game.move("h,2,0");
            if (testAI !== 'human') game.players[0].ai = true;
            game.move("h,0,0");
        }
        if(testCase == 25) {
            // Opener smallest-area counterexample (see the header
            // comment): 3x3, NOT decomposed, AI (player 1) to move.
            // No take is available, so the heuristic is in opener
            // mode; its smallest 2-sided area is the lone box (0,2),
            // and it plays a random border edge of it (h,2,0 or
            // h,2,1, both -1). The optimal first moves are the edges
            // of the (1,2)/(2,2) area (h,1,2, h,2,2, v,1,2, v,2,2,
            // all +3). The 12 preset moves are all toggles (no box
            // is claimed, so none can close a box) -- an even count,
            // so the turn lands on player 1 (the AI), and the last
            // move triggers checkAImove.
            height = 3;
            width = 3;
            document.getElementById('heightRange').value = height;
            document.getElementById('widthRange').value = width;
            document.getElementById('heightValue').textContent = height;
            document.getElementById('widthValue').textContent = width;
            game.vLines = Array.from({ length: height }, () => Array(width+1).fill(0));
            game.hLines = Array.from({ length: width }, () => Array(height+1).fill(0));
            game.squares = Array.from({ length: height }, () => Array(width).fill(0));
            game.squaresLeft = height * width;
            document.getElementById('player1Type').value = testAI;
            document.getElementById('player2Type').value = 'human';
            game.players[0] = new Player(game.players[0].name,game.players[0].color,game.players[0].hover,testAI);
            game.players[1] = new Player(game.players[1].name,game.players[1].color,game.players[1].hover,'human');

            game.players[0].ai = false;
            game.move("h,0,0");
            game.move("v,2,0");
            game.move("h,1,1");
            game.move("h,2,3");
            game.move("v,0,2");
            game.move("v,1,3");
            game.move("h,0,2");
            game.move("h,1,3");
            game.move("v,0,3");
            game.move("v,0,0");
            game.move("v,1,1");
            if (testAI !== 'human') game.players[0].ai = true;
            game.move("v,2,3");
        }
        if(testCase == 26) {
            // Opener within-chain edge-choice counterexample (see the
            // header comment): 3x3, NOT decomposed, AI (player 1) to
            // move. No take is available, so the heuristic is in
            // opener mode; it picks the smallest chain (0,1)-(1,1)
            // correctly but then picks uniformly among its three open
            // edges. The interior shared edge h,1,1 is the unique
            // optimal move (+5); the end edges h,1,0 and h,1,2 are
            // both -5. The 13 preset moves are all toggles (no box
            // is claimed, so none can close a box) -- an odd count,
            // so the turn lands on player 2; one toggleTurn() flips
            // it back to player 1 (the AI) and checkAImove() kicks
            // the AI.
            height = 3;
            width = 3;
            document.getElementById('heightRange').value = height;
            document.getElementById('widthRange').value = width;
            document.getElementById('heightValue').textContent = height;
            document.getElementById('widthValue').textContent = width;
            game.vLines = Array.from({ length: height }, () => Array(width+1).fill(0));
            game.hLines = Array.from({ length: width }, () => Array(height+1).fill(0));
            game.squares = Array.from({ length: height }, () => Array(width).fill(0));
            game.squaresLeft = height * width;
            document.getElementById('player1Type').value = testAI;
            document.getElementById('player2Type').value = 'human';
            game.players[0] = new Player(game.players[0].name,game.players[0].color,game.players[0].hover,testAI);
            game.players[1] = new Player(game.players[1].name,game.players[1].color,game.players[1].hover,'human');

            game.players[0].ai = false;
            game.move("h,0,3");
            game.move("v,0,2");
            game.move("v,1,2");
            game.move("v,2,0");
            game.move("h,2,3");
            game.move("v,2,3");
            game.move("h,1,3");
            game.move("v,1,0");
            game.move("v,0,1");
            game.move("v,1,3");
            game.move("v,1,1");
            game.move("h,2,0");
            game.move("h,0,0");
            // 13 toggles land the turn on player 2; flip it back
            // to player 1 (the AI) and kick the AI explicitly.
            game.toggleTurn();
            if (testAI !== 'human') game.players[0].ai = true;
            game.checkAImove();
        }
        if(testCase == 27) {
            // Multi-offer counterexample (see the header comment):
            // 3x3, decomposed, AI (player 1) to move. Two regions
            // are offered -- a 4-loop (1,0),(1,1),(1,2),(2,2) and
            // a {2,1,2} 2-chain (2,0),(2,1) -- plus a fresh 3-chain
            // (top row) as the rest. The new controller leaves the
            // 2-chain last and sweeps the loop first (h,2,2 or
            // v,1,1, both +5); the old code bailed to greedy, which
            // plays the trap v,2,1 (+3) about a third of the time.
            // The 15 preset moves are all toggles (no box is
            // claimed, so none can close a box) -- an odd count,
            // so the turn lands on player 2; one toggleTurn()
            // flips it back to player 1 (the AI) and checkAImove()
            // kicks the AI.
            height = 3;
            width = 3;
            document.getElementById('heightRange').value = height;
            document.getElementById('widthRange').value = width;
            document.getElementById('heightValue').textContent = height;
            document.getElementById('widthValue').textContent = width;
            game.vLines = Array.from({ length: height }, () => Array(width+1).fill(0));
            game.hLines = Array.from({ length: width }, () => Array(height+1).fill(0));
            game.squares = Array.from({ length: height }, () => Array(width).fill(0));
            game.squaresLeft = height * width;
            document.getElementById('player1Type').value = testAI;
            document.getElementById('player2Type').value = 'human';
            game.players[0] = new Player(game.players[0].name,game.players[0].color,game.players[0].hover,testAI);
            game.players[1] = new Player(game.players[1].name,game.players[1].color,game.players[1].hover,'human');

            game.players[0].ai = false;
            game.move("h,2,0");
            game.move("h,0,3");
            game.move("h,0,1");
            game.move("h,2,3");
            game.move("h,1,0");
            game.move("v,0,0");
            game.move("v,2,3");
            game.move("v,1,3");
            game.move("h,1,2");
            game.move("h,2,1");
            game.move("h,0,2");
            game.move("v,1,0");
            game.move("h,1,1");
            game.move("h,1,3");
            game.move("v,2,2");
            // 15 toggles land the turn on player 2; flip it back
            // to player 1 (the AI) and kick the AI explicitly.
            game.toggleTurn();
            if (testAI !== 'human') game.players[0].ai = true;
            game.checkAImove();
        }
}
