import { setupTestCase } from "./TestCases.js";

// Thinking indicator on the AI player's score card (an hourglass
// in the card corner, shown by the .thinking class). The card
// element and a per-call token are captured when the indicator is
// set, so a stale clear — from a chained move within the same game,
// or from an abandoned game whose engine call returns after a new
// game started — can never erase a newer call's indicator.
function thinkingOn(game) {
    const el = document.getElementById(game.turn === 1 ? 'p1Card' : 'p2Card');
    if (!el || !el.classList) return null;
    const token = {};
    el._thinkingToken = token;
    el.classList.add('thinking');
    return { el, token };
}
function thinkingOff(mark) {
    if (!mark) return;
    if (mark.el._thinkingToken === mark.token) {
        mark.el._thinkingToken = null;
        mark.el.classList.remove('thinking');
    }
}

export default class DotGame {
    constructor(height,width,player1,player2,ctx,scoreboard) {
        this.vLines = Array.from({ length: height }, () => Array(width+1).fill(0));
        this.hLines = Array.from({ length: width }, () => Array(height+1).fill(0));
        this.squares = Array.from({ length: height }, () => Array(width).fill(0));
        this.squaresLeft = height * width;
        this.players = [player1,player2];
        this.ctx = ctx;
        this.scoreboard = scoreboard;
        this.turn = 1;
        this.sq = undefined;
        this.dt = undefined;
        this.crn = undefined;
        this.hoverLine = '';   // line id string under the pointer, e.g. 'h,2,3'
        this.downLine = '';    // line where the current press started (tap detection)
        this.cancelled = false; // set true when a new game abandons this one mid-think

        // Move history (review): one snapshot per move, snapshot 0 being
        // the blank board. The live board fields always hold the VIEWED
        // position -- stepping back restores an earlier snapshot into
        // them, so a later move (human click or AI) plays from the
        // viewed position and the recorded future after it is erased
        // (divergent play truncates). The AI is paused while reviewing
        // (see stepBack/unpauseAI), so no AI move can land on a
        // reviewed position; in human-vs-human games there is no AI
        // and no spontaneous move can happen while reviewing.
        this.history = [];
        this.histIndex = 0;
        this.paused = false;   // AI paused (Back pressed); only Resume AI clears it
        // AI-think epoch: bumped on every rewind (step back/forward,
        // unpause truncation), so an engine call that started before
        // the rewind can never apply its answer afterwards -- even if
        // the pause has been cleared by then (Back then Resume AI
        // inside one think). checkAImove captures the epoch at entry
        // and re-checks it after every await.
        this._aiEpoch = 0;

        // Test-case harness (preset board positions for AI behavior
        // testing) lives in TestCases.js. Both selects are optional:
        // with no test UI present, or the panel hidden, this is a
        // normal game. A normal game kicks the AI chain directly —
        // if player 1 is the AI it moves first, and nothing else
        // would ever call checkAImove() (later moves only chain from
        // move()). Restored 2026-11-05 (was removed in the PR #69
        // cleanup) with the PR #71 bootstrap kept explicit: the kick
        // must NOT route through setupTestCase's case 0 again.
        const testSel = document.getElementById('test-select');
        const testAIEl = document.getElementById('test-ai');
        const testBox = document.getElementById('testBox');
        const testing = testSel && testBox && !testBox.classList.contains('hidden');
        const testCase = testing ? Number(testSel.options[testSel.selectedIndex].value) : 0;
        if (testCase > 0) {
            setupTestCase(this, testCase, testAIEl ? testAIEl.value : 'ai');
        } else {
            this.checkAImove();
        }

        const canvas = this.ctx.canvas;

        // All of this game's canvas listeners die with it: when a new game
        // replaces this one, destroy() aborts the controller so the abandoned
        // game can never render (or move) over the new board again.
        this._listeners = new AbortController();
        const onCanvas = (type, fn) =>
            canvas.addEventListener(type, fn, { signal: this._listeners.signal });

        // Hover preview (mouse only; touch has no hover).
        onCanvas('pointermove', (e) => {
            if (e.pointerType !== 'mouse') return;
            if (this.players[this.turn-1].ai) return;
            this.setHover(this.lineAtPoint(e.clientX, e.clientY));
        });

        // Tap-to-play: press highlights a line, release on the same line plays it.
        // This works for mouse clicks and touch taps alike, and ignores drags.
        onCanvas('pointerdown', (e) => {
            if (this.players[this.turn-1].ai) return;
            e.preventDefault();
            this.downLine = this.lineAtPoint(e.clientX, e.clientY);
            this.setHover(this.downLine);
            try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* noop */ }
        });
        onCanvas('pointerup', (e) => {
            if (this.players[this.turn-1].ai) { this.downLine = ''; return; }
            const line = this.lineAtPoint(e.clientX, e.clientY);
            const tapped = this.downLine;
            this.downLine = '';
            this.setHover('');
            if (line !== '' && line === tapped) {
                this.move(line);
            }
        });
        onCanvas('pointercancel', () => {
            this.downLine = '';
            this.setHover('');
        });
        onCanvas('pointerleave', () => {
            this.setHover('');
        });
        // No context menu on long-press.
        onCanvas('contextmenu', (e) => e.preventDefault());

        // Move-history buttons (Back / Forward / Resume AI). They are
        // static page elements shared by every game, so each game wires
        // its own handlers through this game's AbortController: destroy()
        // drops them when the game is replaced, so a stale game can never
        // step the new board. Back/Forward appear in every game; Resume
        // AI is shown only while the AI is paused (see
        // syncHistoryButtons).
        const histBack = document.getElementById('history-back');
        const histNext = document.getElementById('history-next');
        const histUnpause = document.getElementById('history-unpause');
        if (histBack) histBack.addEventListener('click', () => this.stepBack(), { signal: this._listeners.signal });
        if (histNext) histNext.addEventListener('click', () => this.stepForward(), { signal: this._listeners.signal });
        if (histUnpause) histUnpause.addEventListener('click', () => this.unpauseAI(), { signal: this._listeners.signal });
        this.syncHistoryButtons();
    }
    // Detach this game's canvas listeners. Call when the game is replaced
    // (alongside setting cancelled) so its hover/tap handlers stop firing.
    destroy() {
        this._listeners.abort();
    }
    setHover(line) {
        if (this.hoverLine !== line) {
            this.hoverLine = line;
            this.render();
        }
    }
    // Map a client (page) coordinate to the nearest available line id,
    // or '' when the pointer isn't on a line.
    lineAtPoint(clientX, clientY) {
        const rect = this.ctx.canvas.getBoundingClientRect();

        // Coordinate relative to the internal canvas drawing space.
        let x = (clientX - rect.left) * (this.ctx.canvas.width / rect.width);
        let y = (clientY - rect.top) * (this.ctx.canvas.height / rect.height);

        x = x - (this.crn + this.dt);
        y = y - (this.crn - this.dt);
        if(x>0 && x<(this.hLines.length*this.sq)           && (x%this.sq) < (this.sq - 2 * this.dt) &&
           y>0 && y<(this.vLines.length*this.sq+2*this.dt) && (y%this.sq) < (2 * this.dt)) {
            const i = Math.trunc(x/this.sq);
            const j = Math.trunc(y/this.sq);
            if(this.hLines[i][j] <= 0) {
                return 'h,' + i + ',' + j;
            }
        }

        x = x + (this.dt * 2);
        y = y - (this.dt * 2);
        if(y>0 && y<(this.vLines.length*this.sq)           && (y%this.sq) < (this.sq - 2 * this.dt) &&
           x>0 && x<(this.hLines.length*this.sq+2*this.dt) && (x%this.sq) < (2 * this.dt)) {
            const i = Math.trunc(y/this.sq);
            const j = Math.trunc(x/this.sq);
            if(this.vLines[i][j] <= 0) {
                return 'v,' + i + ',' + j;
            }
        }
        return '';
    }
    move(m) {
        // History: the first move of a game records the blank board it
        // starts from (snapshot 0). This is lazy because test cases
        // replace the board arrays after construction, so the blank
        // board only has the right dimensions once the first preset
        // move runs.
        if (this.history.length === 0) {
            this.history.push(this.takeSnapshot());
        }
        let o,i,j,p,x,y,closed = false;
        [o,i,j] = m.split(',');
        i = parseInt(i);
        j = parseInt(j);
        if(o == 'h') {
            this.hLines[i][j] = this.turn;
            y = [j-1,j];
            x = [i,i];
        } else if(o == 'v') {
            this.vLines[i][j] = this.turn;
            y = [i,i];
            x = [j-1,j]
        }
        for(let i=0; i<2; i++) {
            if(this.checkClosed(y[i],x[i])) {
                this.squaresLeft--;
                this.scoreboard.point(this.turn);
                this.squares[y[i]][x[i]] = this.turn;
                closed = true;
            }
        }
        if(!closed) {
            this.toggleTurn();
        }
        // Divergent play truncates: a move made while viewing an
        // earlier position erases the recorded future after it, and
        // this move becomes the latest.
        if (this.histIndex < this.history.length - 1) {
            this.history.length = this.histIndex + 1;
        }
        this.history.push(this.takeSnapshot());
        this.histIndex = this.history.length - 1;
        this.syncHistoryButtons();
        this.hoverLine = '';
        this.render();
        if(this.squaresLeft == 0) {
            requestAnimationFrame(() => {
                // The board may have been stepped back from the finished
                // position by the time this fires -- only show the banner
                // if the game is still over at the viewed position.
                setTimeout(() => { if (!this.cancelled && this.squaresLeft === 0) this.showGameOver(); }, 50);
            });
        } else {
            this.checkAImove();
        }
    }
    // ---- move history (review) ----
    // A snapshot is the full game state after a move: board lines, box
    // ownership, boxes left, and whose turn it is. Scores are not stored
    // -- they are re-derived from box ownership on restore.
    takeSnapshot() {
        return {
            hLines: this.hLines.map(r => r.slice()),
            vLines: this.vLines.map(r => r.slice()),
            squares: this.squares.map(r => r.slice()),
            squaresLeft: this.squaresLeft,
            turn: this.turn,
        };
    }
    restoreSnapshot(snap) {
        this.hLines = snap.hLines.map(r => r.slice());
        this.vLines = snap.vLines.map(r => r.slice());
        this.squares = snap.squares.map(r => r.slice());
        this.squaresLeft = snap.squaresLeft;
        this.turn = snap.turn;
        this.hoverLine = '';
        // Re-derive the scores from box ownership: the scoreboard holds
        // the live scores, which belong to the latest position, not
        // necessarily the viewed one.
        const scores = [0, 0];
        for (const row of this.squares) for (const s of row) if (s > 0) scores[s - 1]++;
        this.scoreboard.scores = scores;
        if (this.scoreboard.scoreOutput) {
            this.scoreboard.scoreOutput[0].textContent = scores[0];
            this.scoreboard.scoreOutput[1].textContent = scores[1];
        }
        this.scoreboard.switchActivePlayer(this.turn);
        this.render();
    }
    hideGameOverBanner() {
        const banner = document.getElementById('gameOverBanner');
        if (banner && banner.classList) banner.classList.remove('show');
    }
    // Step back exactly one move. When at least one player is AI, the
    // paused flag is set FIRST, before stepping back, so an AI move
    // already in flight (checkAImove awaiting the engine) is discarded
    // by the pause guard instead of landing on the reviewed position.
    // The AI stays paused until Resume AI is pressed -- stepping
    // forward does not resume it, and neither does a later move.
    stepBack() {
        if (this.histIndex <= 0) return;
        if (this.players[0].ai || this.players[1].ai) this.paused = true;
        this._aiEpoch++;
        this.histIndex--;
        this.restoreSnapshot(this.history[this.histIndex]);
        this.hideGameOverBanner();
        this.syncHistoryButtons();
    }
    // Step forward one move through the recorded future, restoring it
    // exactly (including the AI's recorded replies). Never resumes a
    // paused AI.
    stepForward() {
        if (this.histIndex >= this.history.length - 1) return;
        this._aiEpoch++;
        this.histIndex++;
        this.restoreSnapshot(this.history[this.histIndex]);
        this.hideGameOverBanner();
        this.syncHistoryButtons();
    }
    // Resume a paused AI. If the viewed position is earlier than the
    // latest, the recorded future after it is erased FIRST, so the game
    // restarts from the viewed position (in an AI-vs-AI game this is
    // how a replay from an earlier point can take a different line --
    // the heuristic picks randomly among equivalent moves). Then, if
    // it is an AI's turn at the (now latest) position, the AI moves;
    // if it is a human's turn, the game just waits for the human.
    unpauseAI() {
        if (!this.paused) return;
        this.paused = false;
        this._aiEpoch++;
        if (this.histIndex < this.history.length - 1) {
            this.history.length = this.histIndex + 1;
        }
        this.syncHistoryButtons();
        this.checkAImove();
    }
    // Back disabled at the blank board, Forward disabled at the latest
    // move; the counter reads "Move k of n" where n is the number of
    // moves recorded. Resume AI is shown only while paused (in
    // human-vs-human games there is never a pause, so it never appears
    // there). classList add/remove, not toggle: the node harness stubs
    // classList without toggle.
    syncHistoryButtons() {
        const back = document.getElementById('history-back');
        const next = document.getElementById('history-next');
        const counter = document.getElementById('history-counter');
        const unpause = document.getElementById('history-unpause');
        const latest = this.history.length - 1;
        if (back) back.disabled = this.histIndex <= 0;
        if (next) next.disabled = this.histIndex >= latest;
        if (counter) counter.textContent = `Move ${this.histIndex} of ${Math.max(0, latest)}`;
        if (unpause) {
            if (this.paused) unpause.classList.remove('hidden');
            else unpause.classList.add('hidden');
        }
    }
    showGameOver() {
        const winner = this.scoreboard.whoWon();
        const title = document.getElementById('gameOverTitle');
        const subtitle = document.getElementById('gameOverSubtitle');
        const s1 = this.scoreboard.scores[0], s2 = this.scoreboard.scores[1];
        if (winner == 0) {
            title.textContent = "It's a tie!";
        } else {
            title.textContent = 'Player ' + winner + ' wins!';
        }
        subtitle.textContent = s1 + ' – ' + s2;
        document.getElementById('gameOverBanner').classList.add('show');
    }
    checkClosed(y,x) {
        if(y<0 || x<0 || y >= this.vLines.length || x >= this.hLines.length) {
            return false;
        }
        let s = 0;
        s += (this.hLines[x][y] > 0);
        s += (this.hLines[x][y+1] > 0);
        s += (this.vLines[y][x] > 0);
        s += (this.vLines[y][x+1] > 0);
        if(s == 4) {
            return true;
        } else {
            return false;
        }
    }
    render() {
        // canvas dimensions
        let w = this.ctx.canvas.width;
        let h = this.ctx.canvas.height;

        this.sq = Math.min(Math.round(h / (this.vLines.length + 1)),Math.round(w / (this.hLines.length + 1))); // square height/width
        this.dt = Math.round(this.sq/10); // dot radius
        this.crn = Math.round(this.sq/2); // top left corner

        this.ctx.clearRect(0,0,w,h);

        for(let y=0; y<=this.vLines.length; y++) {
            for(let x=0; x<=this.hLines.length; x++) {
                this.circle(this.crn + x*this.sq, this.crn + y*this.sq, this.dt);
            }
        }
        let x,y,rx, ry, rw, rh, rp, c;
        for(x=0; x<this.hLines.length; x++) {
            for(y=0; y<this.hLines[x].length; y++) {
                const key = 'h,' + x + ',' + y;
                if(this.hLines[x][y] != 0 || key === this.hoverLine) {
                    rx = this.sq/2 + this.dt + x*this.sq;
                    ry = this.sq/2 - this.dt + y*this.sq;
                    rw = this.sq-this.dt*2;
                    rh = this.dt*2;
                    rp = this.hLines[x][y];
                    if(rp == 0) {
                        c = this.players[this.turn-1].hover;
                    } else {
                        c = this.players[rp-1].color;
                    }
                    this.rect(rx,ry,rw,rh,c);
                }
            }
        }
        for(y=0; y<this.vLines.length; y++) {
            for(x=0; x<this.vLines[y].length; x++) {
                const key = 'v,' + y + ',' + x;
                if(this.vLines[y][x] != 0 || key === this.hoverLine) {
                    rx = this.sq/2 - this.dt + x*this.sq;
                    ry = this.sq/2 + this.dt + y*this.sq;
                    rw = this.dt*2;
                    rh = this.sq-this.dt*2;
                    rp = this.vLines[y][x];
                    if(rp == 0) {
                        c = this.players[this.turn-1].hover;
                    } else {
                        c = this.players[rp-1].color;
                    }
                    this.rect(rx,ry,rw,rh,c);
                }
            }
        }
        for(y=0; y<this.squares.length; y++) {
            for(x=0; x<this.squares[y].length; x++) {
                if(this.squares[y][x] > 0) {
                    rx = this.sq/2 + this.dt*2 + x*this.sq;
                    ry = this.sq/2 + this.dt*2 + y*this.sq;
                    rw = this.sq - this.dt*4;
                    this.rect(rx,ry,rw,rw,this.players[this.squares[y][x]-1].color);
                }
            }
        }
    }
    circle(x,y,rad) {
        this.ctx.beginPath();
        this.ctx.arc(x,y,rad,0,Math.PI*2)
        this.ctx.fillStyle = 'black';
        this.ctx.fill();
    }
    rect(x,y,width,height,color) {
        this.ctx.beginPath();
        this.ctx.rect(x,y,width,height);
        this.ctx.fillStyle = color;
        this.ctx.fill();
    }
    toggleTurn() {
        this.turn = 3 - this.turn;
        this.scoreboard.switchActivePlayer(this.turn);
    }
    // Resolve after the browser has actually painted. A single
    // requestAnimationFrame fires before the paint, so awaiting just one
    // still lets a blocking AI think before the previous move appears.
    // The nested second frame runs after the paint. The timeout is a
    // fallback for when frames are throttled, e.g. in a hidden tab.
    waitForPaint() {
        return new Promise(resolve => {
            const fallback = setTimeout(resolve, 100);
            requestAnimationFrame(() => requestAnimationFrame(() => {
                clearTimeout(fallback);
                resolve();
            }));
        });
    }
    async checkAImove() {
        // Abandoned games (new game started while the AI was thinking) must
        // not keep playing: their move() calls render() on the same shared
        // canvas, flashing the old board over the new game.
        // Paused games (Back pressed while an AI plays) must not move
        // either: the pause guard is checked at every await boundary,
        // so an AI move scheduled before the pause can never land on
        // the reviewed position -- and the chained re-fire after an AI
        // move that closes boxes (move() calls checkAImove() again
        // while the AI keeps the turn) is stopped the same way. Only
        // unpauseAI() clears the flag and re-triggers the AI.
        if (this.cancelled || this.paused) return;
        if(this.players[this.turn-1].ai) {
            const epoch = this._aiEpoch;
            const thinkMark = thinkingOn(this);
            try {
                // Let the browser paint the previous move before the AI blocks
                // the main thread while thinking.
                await this.waitForPaint();
                // Game over while waiting to think (reachable when two AI
                // chains share a board): never ask the engine to move on a
                // full board — it has no legal move there and crashes in the
                // heuristic opener.
                if (this.cancelled || this.paused || this._aiEpoch !== epoch || this.squaresLeft === 0) return;
                const engine = this.players[this.turn-1].aiEngine;
                const m = await engine.move(this.hLines,this.vLines,this.squaresLeft);
                if (this.cancelled || this.paused || this._aiEpoch !== epoch || this.squaresLeft === 0) return;
                this.move(m);
            } finally {
                thinkingOff(thinkMark);
            }
        }
    }
}
