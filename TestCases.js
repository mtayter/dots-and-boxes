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
        9) Opener chain-end choice on a 4-chain: 4x4 board, opener mode, a
           4-chain (2,2)-(3,2)-(3,3)-(2,3) plus a blob. Solver: only h,2,2
           is optimal (-4); the other end v,2,4 and all interior moves are -6.
           Note: the chain is only 4 long, so the only splits are 1-3 or 2-2;
           a longer chain would be a fairer test of interior-vs-ends. The
           heuristic's random-end choice picks wrong 50% of the time here.
        */


/**
 * Test-case harness for AI behavior testing, extracted from the DotGame
 * constructor. Loads a preset board position into a brand-new game so an AI
 * engine's move in that spot can be inspected.
 *
 * The dropdown labels live on the #test-select element in index.html; the
 * values here ("0"-"9") must stay in sync with those <option> values.
 * The engine under test comes from the #test-ai select.
 *
 * @param {object} game - the DotGame under construction (its board arrays,
 *                        players, move() and checkAImove() are all used)
 * @param {string|number} testCase - selected case; "0" means not testing
 * @param {string} testAI - player under test: 'ai-heuristic', 'ai-hybrid', or
 *                         'human' (you play the test seat yourself)
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
            // Opener chain-end choice on a 4-chain. 4x4 board, opener mode
            // (no 3-sided boxes). A 4-chain (2,2)-(3,2)-(3,3)-(2,3) plus a
            // blob. 22 preset moves, no takes, so player 1 (the AI) is to move.
            // Solver (verified, fast on this small board): only h,2,2 is
            // optimal (-4); the other end v,2,4 and all interior moves
            // (h,2,3, v,3,3, h,3,3) are -6. Caveat: the chain is only 4 long,
            // so the only splits are 1-3 or 2-2 -- a longer chain would be a
            // fairer test of interior-vs-ends.
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
}
