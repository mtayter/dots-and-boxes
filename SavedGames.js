import DotGame from './DotGame.js';
import Player from './Player.js';

// Saved-games review box (below the test panel). Loads
// saved-games.json — recorded beginner-vs-advanced league games
// with their full move lists — and lets the user load one onto
// the main board and step through it move by move.
//
// Stepping rebuilds the position from scratch on a fresh
// human-vs-human DotGame (both seats human, so no engine ever
// fires), applies the first k moves, then freezes the game
// (cancelled) so the game-over banner never pops mid-review.
// The host (app.js) owns the live game slot: abandonCurrent()
// tears the current game down, adopt(game) installs the review
// game as the current one so New Game / resize keep working.
export default function initSavedGames({ ctx, scoreboard, abandonCurrent, adopt }) {
    const select = document.getElementById('games-select');
    const info = document.getElementById('games-info');
    const counter = document.getElementById('games-counter');
    const prevBtn = document.getElementById('games-prev');
    const nextBtn = document.getElementById('games-next');
    if (!select || !info || !counter || !prevBtn || !nextBtn) return;

    let games = [];
    let current = null; // { rec, idx }

    const advScore = (rec) => (rec.beginnerSeat === 1 ? rec.p2 : rec.p1);
    const begScore = (rec) => (rec.beginnerSeat === 1 ? rec.p1 : rec.p2);

    function optionLabel(rec) {
        const head = `#${rec.id} ${rec.w}x${rec.h} - Advanced ${advScore(rec)}, Beginner ${begScore(rec)}`;
        if (rec.winner === 'beginner') return head + ' (beginner won)';
        if (rec.winner === 'tie') return head + ' (tie)';
        return head;
    }

    function describe(rec) {
        let text = `${rec.w}x${rec.h} game #${rec.id}: Beginner played Player ${rec.beginnerSeat}. ` +
            `Final score: Advanced ${advScore(rec)} - Beginner ${begScore(rec)}` +
            (rec.winner === 'beginner' ? ' - beginner won!' : rec.winner === 'tie' ? ' - a tie.' : '.');
        if (rec.blunder) {
            text += ` Advanced could have won: at move ${rec.blunder.moveNo} it played ` +
                `${rec.blunder.played}, but ${rec.blunder.better} was the winning move.`;
        } else if (rec.winner === 'beginner' && rec.blunderNote) {
            text += ` ${rec.blunderNote}`;
        }
        return text;
    }

    // Dump the full move list, with how the AI chose each move,
    // to the browser console when a game is loaded. Records saved
    // with moveSources (a parallel array: {player, level, source,
    // phase, ...}) print e.g. "87. v,8,7 - P1 advanced - minimax";
    // older records without sources print the moves alone.
    function logGameMoves(rec) {
        const advSeat = rec.beginnerSeat === 1 ? 2 : 1;
        console.log(`Saved game #${rec.id} (${rec.w}x${rec.h}): Advanced = Player ${advSeat}, ` +
            `Beginner = Player ${rec.beginnerSeat}. Final score: Advanced ${advScore(rec)} - Beginner ${begScore(rec)}` +
            (rec.winner === 'beginner' ? ' (beginner won)' : rec.winner === 'tie' ? ' (tie)' : '') + '. Moves:');
        const sources = Array.isArray(rec.moveSources) ? rec.moveSources : null;
        rec.moves.forEach((m, i) => {
            const s = sources && sources[i];
            if (s) {
                let line = `${i + 1}. ${m} - P${s.player} ${s.level} - ${s.source}`;
                if (s.phase && s.phase !== s.source) line += ` (${s.phase})`;
                if (s.source === 'minimax' && s.minimaxAborted) line += ' [salvaged after the 5s cap]';
                console.log(line);
            } else {
                console.log(`${i + 1}. ${m} - source not recorded`);
            }
        });
    }

    function show(idx) {
        if (!current) return;
        const rec = current.rec;
        const k = Math.max(0, Math.min(rec.moves.length, idx));
        current.idx = k;
        abandonCurrent();
        const p1 = new Player('1', '#BF616A', '#E5B3B8', 'human');
        const p2 = new Player('2', '#5E81AC', '#88C0D0', 'human');
        const game = new DotGame(rec.h, rec.w, p1, p2, ctx, scoreboard);
        scoreboard.reset();
        for (let m = 0; m < k; m++) game.move(rec.moves[m]);
        adopt(game);
        game.cancelled = true; // freeze: no banner, no stray AI chain
        scoreboard.switchActivePlayer(game.turn);
        game.render();
        counter.textContent = `Move ${k} of ${rec.moves.length}`;
        prevBtn.disabled = k === 0;
        nextBtn.disabled = k === rec.moves.length;
        info.textContent = describe(rec);
    }

    select.addEventListener('change', () => {
        const rec = games[select.selectedIndex];
        if (!rec) return;
        current = { rec, idx: rec.moves.length };
        logGameMoves(rec);
        show(current.idx);
    });
    prevBtn.addEventListener('click', () => { if (current) show(current.idx - 1); });
    nextBtn.addEventListener('click', () => { if (current) show(current.idx + 1); });

    fetch('saved-games.json')
        .then((r) => (r.ok ? r.json() : []))
        .catch(() => [])
        .then((data) => {
            games = (Array.isArray(data) ? data : []).filter((g) => g && Array.isArray(g.moves) && g.winner);
            if (games.length === 0) {
                const opt = document.createElement('option');
                opt.textContent = 'No saved games yet';
                select.appendChild(opt);
                select.disabled = true;
                prevBtn.disabled = true;
                nextBtn.disabled = true;
                return;
            }
            for (const rec of games) {
                const opt = document.createElement('option');
                opt.textContent = optionLabel(rec);
                select.appendChild(opt);
            }
        });
}
