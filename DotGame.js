import { setupTestCase } from "./TestCases.js";

export default class DotGame {
    constructor(height,width,player1,player2,ctx,scoreboard,options = {}) {
        this.vLines = Array.from({ length: height }, () => Array(width+1).fill(0));
        this.hLines = Array.from({ length: width }, () => Array(height+1).fill(0));
        this.squares = Array.from({ length: height }, () => Array(width).fill(0));
        this.squaresLeft = height * width;
        this.players = [player1,player2];
        this.ctx = ctx;
        this.scoreboard = scoreboard;
        this.onAIMove = options.onAIMove || null;  // (playerNum, iterations) => void
        this.turn = 1;
        this.sq = undefined;
        this.dt = undefined;
        this.crn = undefined;
        this.hoverLine = '';   // line id string under the pointer, e.g. 'h,2,3'
        this.downLine = '';    // line where the current press started (tap detection)
        this.cancelled = false; // set true when a new game abandons this one mid-think


        // Test-case harness (preset board positions for AI behavior testing)
        // lives in TestCases.js. Both selects are optional: with no test UI
        // present this is just a normal game (case 0, default test AI).
        // If the test panel is hidden, that's also a normal game.
        const testSel = document.getElementById('test-select');
        const testAIEl = document.getElementById('test-ai');
        const testBox = document.getElementById('testBox');
        const testing = testSel && testBox && !testBox.classList.contains('hidden');
        setupTestCase(
            this,
            testing ? testSel.options[testSel.selectedIndex].value : 0,
            testAIEl ? testAIEl.value : 'ai'
        );

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
        this.hoverLine = '';
        this.render();
        if(this.squaresLeft == 0) {
            requestAnimationFrame(() => {
                setTimeout(() => { if (!this.cancelled) this.showGameOver(); }, 50);
            });
        } else {
            this.checkAImove();
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
        if (this.cancelled) return;
        if(this.players[this.turn-1].ai) {
            // Let the browser paint the previous move before the AI blocks
            // the main thread while thinking.
            await this.waitForPaint();
            if (this.cancelled) return;
            const playerNum = this.turn;
            const engine = this.players[this.turn-1].aiEngine;
            const m = await engine.move(this.hLines,this.vLines,this.squaresLeft);
            if (this.cancelled) return;
            if (this.onAIMove) this.onAIMove(playerNum, engine.lastIterations || 0, !!engine.lastExact);
            this.move(m);
        }
    }
}
