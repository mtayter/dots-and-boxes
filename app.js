import DotGame from './DotGame.js';
import Player from './Player.js';
import Scoreboard from './Scoreboard.js';
import initSavedGames from './SavedGames.js';

function init() {
    const canvas = document.getElementById('board');
    const parentContainer = canvas.parentElement;
    const ctx = canvas.getContext('2d');
    const heightRange = document.getElementById('heightRange');
    const widthRange = document.getElementById('widthRange');
    const heightValue = document.getElementById('heightValue');
    const widthValue = document.getElementById('widthValue');
    const player1Type = document.getElementById('player1Type');
    const player2Type = document.getElementById('player2Type');
    const newGameButton = document.getElementById('newGameButton');
    const gameOverBanner = document.getElementById('gameOverBanner');
    const okButton = document.getElementById('okButton');
    let dotGame;
    let scoreboard = new Scoreboard(document.getElementById('p1Card'),
                                    document.getElementById('p2Card'),
                                    document.getElementById('player1Score'),
                                    document.getElementById('player2Score'));
    // The player-type dropdowns carry the AI level: 'ai-beginner'
    // is the pure heuristic, 'ai-intermediate' adds the Allcock
    // step, 'ai-advanced' is the full engine. Player parses the
    // value; nothing else needs it.
    heightRange.addEventListener('input', (e) => {
        heightValue.textContent = e.target.value;
    });
    widthRange.addEventListener('input', (e) => {
        widthValue.textContent = e.target.value;
    });
    function newGame() {
        // Stop the previous game's AI loop if it's still thinking: otherwise
        // the abandoned game keeps move()ing and rendering its old board
        // onto this same canvas.
        if (dotGame) { dotGame.cancelled = true; dotGame.destroy(); }
        // Clear any thinking indicator the abandoned game left on a
        // score card (its own late clear is token-guarded and would
        // no-op against the new game's marks anyway).
        for (const id of ['p1Card', 'p2Card']) {
            const card = document.getElementById(id);
            card._thinkingToken = null;
            card.classList.remove('thinking');
        }
        const height = parseInt(heightRange.value);
        const width = parseInt(widthRange.value);
        const player1 = new Player('1','#BF616A','#E5B3B8',player1Type.value);
        const player2 = new Player('2','#5E81AC','#88C0D0',player2Type.value);
        gameOverBanner.classList.remove('show');
        dotGame = new DotGame(height,width,player1,player2,ctx,scoreboard);
        scoreboard.reset();
        // setupTestCase() may leave P2 to move (e.g. test 8); reset() always
        // marks P1 active, so re-sync the indicator to the actual turn.
        scoreboard.switchActivePlayer(dotGame.turn);
        dotGame.render();
    }
    newGameButton.addEventListener('click', newGame);

    // Saved-games review box: it builds its own frozen DotGame for
    // the board, so it needs to tear down whatever game is live
    // (same teardown as newGame, plus hiding the test panel so the
    // DotGame constructor takes the normal-game path) and to
    // install its game as the current one.
    initSavedGames({
        ctx,
        scoreboard,
        abandonCurrent: () => {
            if (dotGame) { dotGame.cancelled = true; dotGame.destroy(); }
            for (const id of ['p1Card', 'p2Card']) {
                const card = document.getElementById(id);
                card._thinkingToken = null;
                card.classList.remove('thinking');
            }
            gameOverBanner.classList.remove('show');
            document.getElementById('testBox').classList.add('hidden');
        },
        adopt: (game) => { dotGame = game; },
    });
    // Dismiss the result banner: OK button or a click on the backdrop
    // (outside the card). Starting a fresh game stays on the New Game button.
    okButton.addEventListener('click', () => gameOverBanner.classList.remove('show'));
    gameOverBanner.addEventListener('click', (e) => {
        if (e.target === gameOverBanner) gameOverBanner.classList.remove('show');
    });
    function handleResize() {
        canvas.width = parentContainer.clientWidth;
        canvas.height= parentContainer.clientHeight;
        render();
    }
    function render() {
        if(dotGame) {
            dotGame.render();
        }
    }
    window.addEventListener('resize', handleResize)
    handleResize();

    // The saved-games box is displayed only together with the test
    // panel (Mike, 2026-11-06): both user-facing visibility controls
    // (the X and the Konami toggle) drive the two boxes as a pair.
    // (The review-load path in abandonCurrent above hides ONLY the
    // test panel — the DotGame constructor reads its visibility to
    // decide whether to apply a test case — while the games box
    // stays up as the review's control surface.)
    function setTestPanelVisible(visible) {
        document.getElementById('testBox').classList.toggle('hidden', !visible);
        document.getElementById('gamesBox').classList.toggle('hidden', !visible);
    }

    // The X in the test panel corner hides the pair.
    document.getElementById('testBoxClose').addEventListener('click', () => {
        setTestPanelVisible(false);
    });

    // Easter egg: the Konami code (up up down down left right left right B A)
    // toggles the hidden dev test panel.
    const konamiSequence = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown',
                            'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight',
                            'b', 'a'];
    let konamiProgress = 0;
    document.addEventListener('keydown', (e) => {
        const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
        if (key === konamiSequence[konamiProgress]) {
            konamiProgress++;
            if (konamiProgress === konamiSequence.length) {
                konamiProgress = 0;
                setTestPanelVisible(document.getElementById('testBox').classList.contains('hidden'));
            }
        } else {
            konamiProgress = (key === konamiSequence[0]) ? 1 : 0;
        }
    });
}

init();
