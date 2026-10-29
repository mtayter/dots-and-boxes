import DotGame from './DotGame.js';
import Player from './Player.js';
import Scoreboard from './Scoreboard.js';

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
    // AI always plays at the engine's fixed strength; the
    // engine takes no strength parameter.
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

    // The X in the test panel corner hides it (no code needed to close).
    document.getElementById('testBoxClose').addEventListener('click', () => {
        document.getElementById('testBox').classList.add('hidden');
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
                document.getElementById('testBox').classList.toggle('hidden');
            }
        } else {
            konamiProgress = (key === konamiSequence[0]) ? 1 : 0;
        }
    });
}

init();
