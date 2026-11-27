/* Stac-Tac-Toe — Core Rules Engine & Tactical AI
   Sandy F. Kraemer's 1973 3M vertical stacking tic-tac-toe game.

   Rules:
   - 3 vertical columns (0, 1, 2), no max stack height (up to 10 balls tall).
   - 2 players: Orange ('o') and Yellow ('y'), 5 balls each (10 total).
   - Phase 1 ('place'): alternate placing a reserve ball onto any column (open platform or top of stack).
   - Phase 2 ('stack'): once all 10 balls are on the platform, pick ANY ball of your color (top or buried)
     and move that ball plus every ball stacked above it as a rigid sub-stack onto either of the other 2 columns.
   - Goal: align 3 of your color vertically, horizontally, or diagonally at any height.
   - Outcome after a move:
       * Both players have 3-in-a-row -> DRAW (round draw, no points).
       * Only opponent has 3-in-a-row -> auto-lose (opponent wins the round, selfOwn = true).
       * Only mover has 3-in-a-row -> mover wins the round.
   - Match: first to 3 round wins.

   Zero DOM dependencies: works in browser (window.STTEngine) and Node (module.exports). */

(function (root) {
  'use strict';

  const COLS = 3;
  const BALLS_PER_PLAYER = 5;
  const MATCH_TARGET = 3;
  const PLAYERS = ['o', 'y'];

  const other = (p) => (p === 'o' ? 'y' : 'o');

  function cloneCols(cols) {
    return [cols[0].slice(), cols[1].slice(), cols[2].slice()];
  }

  function createRound(starter) {
    const first = starter === 'y' ? 'y' : 'o';
    return {
      cols: [[], [], []],
      reserve: { o: BALLS_PER_PLAYER, y: BALLS_PER_PLAYER },
      turn: first,
      starter: first,
      phase: 'place', // 'place' | 'stack' | 'over'
      ply: 0,
      outcome: null, // null | { result: 'win'|'draw', winner: 'o'|'y'|null, lines: [...], selfOwn: boolean }
      lastMove: null,
      history: [], // board keys for repetition awareness
    };
  }

  function cloneState(s) {
    return {
      cols: cloneCols(s.cols),
      reserve: { o: s.reserve.o, y: s.reserve.y },
      turn: s.turn,
      starter: s.starter,
      phase: s.phase,
      ply: s.ply,
      outcome: s.outcome ? {
        result: s.outcome.result,
        winner: s.outcome.winner,
        selfOwn: s.outcome.selfOwn,
        lines: s.outcome.lines.map((l) => ({
          color: l.color,
          dir: l.dir,
          cells: l.cells.map((pt) => ({ c: pt.c, r: pt.r })),
        })),
      } : null,
      lastMove: s.lastMove ? Object.assign({}, s.lastMove) : null,
      history: s.history ? s.history.slice() : [],
    };
  }

  function stateKey(cols, turn, reserve) {
    const r = reserve ? `${reserve.o}${reserve.y}` : '00';
    return `${turn}:${r}:${cols[0].join('')}|${cols[1].join('')}|${cols[2].join('')}`;
  }

  /** Find every 3-in-a-row line currently on the board for both colors. */
  function findLines(cols) {
    const linesO = [];
    const linesY = [];
    const h0 = cols[0].length;
    const h1 = cols[1].length;
    const h2 = cols[2].length;
    const maxH = Math.max(h0, h1, h2);

    const push = (color, dir, cells) => {
      const entry = { color, dir, cells };
      if (color === 'o') linesO.push(entry);
      else linesY.push(entry);
    };

    // Vertical: 3 consecutive in any column
    for (let c = 0; c < COLS; c++) {
      const col = cols[c];
      for (let r = 0; r <= col.length - 3; r++) {
        const p = col[r];
        if (p && col[r + 1] === p && col[r + 2] === p) {
          push(p, 'v', [{ c, r }, { c, r: r + 1 }, { c, r: r + 2 }]);
        }
      }
    }

    // Horizontal: same row across all 3 columns
    const minH = Math.min(h0, h1, h2);
    for (let r = 0; r < minH; r++) {
      const p = cols[0][r];
      if (p && cols[1][r] === p && cols[2][r] === p) {
        push(p, 'h', [{ c: 0, r }, { c: 1, r }, { c: 2, r }]);
      }
    }

    // Diagonal up-right (/): (0, r), (1, r+1), (2, r+2)
    for (let r = 0; r <= maxH - 3; r++) {
      const p = cols[0][r];
      if (p && cols[1][r + 1] === p && cols[2][r + 2] === p) {
        push(p, 'du', [{ c: 0, r }, { c: 1, r: r + 1 }, { c: 2, r: r + 2 }]);
      }
    }

    // Diagonal down-right (\): (0, r+2), (1, r+1), (2, r)
    for (let r = 0; r <= maxH - 3; r++) {
      const p = cols[0][r + 2];
      if (p && cols[1][r + 1] === p && cols[2][r] === p) {
        push(p, 'dd', [{ c: 0, r: r + 2 }, { c: 1, r: r + 1 }, { c: 2, r }]);
      }
    }

    return { o: linesO, y: linesY };
  }

  /** Evaluate win / draw outcome after `mover` completes a move. */
  function evaluateOutcome(cols, mover) {
    const found = findLines(cols);
    const hasO = found.o.length > 0;
    const hasY = found.y.length > 0;
    if (!hasO && !hasY) return null;
    if (hasO && hasY) {
      return {
        result: 'draw',
        winner: null,
        selfOwn: false,
        lines: found.o.concat(found.y),
      };
    }
    const winner = hasO ? 'o' : 'y';
    return {
      result: 'win',
      winner,
      selfOwn: winner !== mover,
      lines: hasO ? found.o : found.y,
    };
  }

  /** Return all legal moves for the current state. */
  function getLegalMoves(state) {
    if (!state || state.phase === 'over') return [];
    const p = state.turn;
    const moves = [];
    if (state.phase === 'place') {
      if (state.reserve[p] <= 0) return [];
      for (let to = 0; to < COLS; to++) {
        moves.push({ type: 'place', to });
      }
      return moves;
    }
    // Stack Play: pick any ball of your color + everything above it -> any other column
    for (let from = 0; from < COLS; from++) {
      const col = state.cols[from];
      for (let row = 0; row < col.length; row++) {
        if (col[row] !== p) continue;
        for (let to = 0; to < COLS; to++) {
          if (to !== from) {
            moves.push({ type: 'stack', from, row, to });
          }
        }
      }
    }
    return moves;
  }

  /** Validate whether `move` is legal in `state`. */
  function isLegalMove(state, move) {
    if (!state || !move || state.phase === 'over') return false;
    const p = state.turn;
    if (state.phase === 'place') {
      return (
        move.type === 'place' &&
        Number.isInteger(move.to) &&
        move.to >= 0 && move.to < COLS &&
        state.reserve[p] > 0
      );
    }
    if (state.phase === 'stack') {
      return (
        move.type === 'stack' &&
        Number.isInteger(move.from) && move.from >= 0 && move.from < COLS &&
        Number.isInteger(move.to) && move.to >= 0 && move.to < COLS &&
        move.from !== move.to &&
        Number.isInteger(move.row) &&
        move.row >= 0 && move.row < state.cols[move.from].length &&
        state.cols[move.from][move.row] === p
      );
    }
    return false;
  }

  /** Apply a legal move and return a fresh next state (pure, immutable). */
  function applyMove(state, move) {
    if (!isLegalMove(state, move)) {
      throw new Error('Illegal Stac-Tac-Toe move: ' + JSON.stringify(move));
    }
    const next = cloneState(state);
    const p = next.turn;
    let movedBalls;
    let destStartRow;

    if (move.type === 'place') {
      destStartRow = next.cols[move.to].length;
      next.cols[move.to].push(p);
      next.reserve[p] -= 1;
      movedBalls = [p];
      next.lastMove = {
        type: 'place',
        by: p,
        to: move.to,
        destRow: destStartRow,
        balls: movedBalls,
      };
    } else {
      const moving = next.cols[move.from].splice(move.row);
      destStartRow = next.cols[move.to].length;
      for (let i = 0; i < moving.length; i++) next.cols[move.to].push(moving[i]);
      movedBalls = moving.slice();
      next.lastMove = {
        type: 'stack',
        by: p,
        from: move.from,
        row: move.row,
        to: move.to,
        destRow: destStartRow,
        balls: movedBalls,
      };
    }

    next.ply += 1;
    const outcome = evaluateOutcome(next.cols, p);
    if (outcome) {
      next.outcome = outcome;
      next.phase = 'over';
    } else {
      next.turn = other(p);
      next.phase = (next.reserve.o === 0 && next.reserve.y === 0) ? 'stack' : 'place';
    }

    const key = stateKey(next.cols, next.turn, next.reserve);
    next.history.push(key);
    if (next.history.length > 24) next.history.shift();
    return next;
  }

  /* =====================================================================
     Tactical AI (Alpha-Beta Search + Heuristic Evaluation)
     ===================================================================== */

  const WIN_SCORE = 100000;

  /** Fast heuristic score from `me`'s perspective for non-terminal positions. */
  function evaluateHeuristic(cols, reserve, me, turn) {
    const opp = other(me);
    let score = 0;
    const h0 = cols[0].length;
    const h1 = cols[1].length;
    const h2 = cols[2].length;
    const maxH = Math.max(h0, h1, h2);

    // 1. Count open/live 2-in-a-row threats across vertical, horizontal, and diagonals
    // Vertical pairs sitting at top of column are super threatening (can be completed in 1 move!)
    for (let c = 0; c < COLS; c++) {
      const col = cols[c];
      const len = col.length;
      if (len >= 2 && col[len - 1] === col[len - 2]) {
        const who = col[len - 1];
        score += (who === me ? 1 : -1) * 42;
      }
      // Buried consecutive pairs also create Stack Play potential
      for (let r = 0; r <= len - 2; r++) {
        if (col[r] === col[r + 1]) {
          score += (col[r] === me ? 1 : -1) * 14;
        }
      }
      // Top-of-stack ownership gives fast single-ball flexibility in Stack Play
      if (len > 0) {
        score += (col[len - 1] === me ? 1 : -1) * 9;
      }
    }

    // Center column presence (hub for all diagonals & horizontals)
    for (let r = 0; r < h1; r++) {
      score += (cols[1][r] === me ? 1 : -1) * 10;
    }

    // Horizontal 2-of-3 lines (either immediately completable or Stack-Playable)
    for (let r = 0; r < maxH; r++) {
      const a = cols[0][r] || null;
      const b = cols[1][r] || null;
      const c = cols[2][r] || null;
      let mo = 0, my = 0, emptyCol = -1;
      if (a === 'o') mo++; else if (a === 'y') my++; else emptyCol = 0;
      if (b === 'o') mo++; else if (b === 'y') my++; else emptyCol = 1;
      if (c === 'o') mo++; else if (c === 'y') my++; else emptyCol = 2;
      if (mo === 2 && my === 0) {
        // Immediate 1-drop threat if emptyCol has exact height r
        const ready = cols[emptyCol].length === r;
        score += (me === 'o' ? 1 : -1) * (ready ? 52 : 16);
      } else if (my === 2 && mo === 0) {
        const ready = cols[emptyCol].length === r;
        score += (me === 'y' ? 1 : -1) * (ready ? 52 : 16);
      }
    }

    // Diagonal 2-of-3 lines (both / and \)
    const diagMax = Math.max(0, maxH - 1);
    for (let r = 0; r <= diagMax; r++) {
      // Up-right (0,r), (1,r+1), (2,r+2)
      score += evalTriplet(cols, 0, r, 1, r + 1, 2, r + 2, me);
      // Down-right (0,r+2), (1,r+1), (2,r)
      score += evalTriplet(cols, 0, r + 2, 1, r + 1, 2, r, me);
    }

    // Subtle bonus for having the move (tempo)
    score += (turn === me ? 6 : -6);

    // Slight preference against overly lopsided single-tower passive states unless winning
    if (reserve.o === 0 && reserve.y === 0) {
      let emptyCols = 0;
      if (h0 === 0) emptyCols++;
      if (h1 === 0) emptyCols++;
      if (h2 === 0) emptyCols++;
      if (emptyCols === 2) score -= 4;
    }

    return score;
  }

  function evalTriplet(cols, c0, r0, c1, r1, c2, r2, me) {
    const a = cols[c0][r0] || null;
    const b = cols[c1][r1] || null;
    const c = cols[c2][r2] || null;
    let mo = 0, my = 0;
    let ec = -1, er = -1;
    if (a === 'o') mo++; else if (a === 'y') my++; else { ec = c0; er = r0; }
    if (b === 'o') mo++; else if (b === 'y') my++; else { ec = c1; er = r1; }
    if (c === 'o') mo++; else if (c === 'y') my++; else { ec = c2; er = r2; }
    if (mo === 2 && my === 0) {
      const ready = cols[ec].length === er;
      return (me === 'o' ? 1 : -1) * (ready ? 56 : 18);
    }
    if (my === 2 && mo === 0) {
      const ready = cols[ec].length === er;
      return (me === 'y' ? 1 : -1) * (ready ? 56 : 18);
    }
    return 0;
  }

  /** In-place move apply/undo helpers for ultra-fast alpha-beta search. */
  function makeMoveFast(cols, reserve, turn, mv) {
    if (mv.type === 'place') {
      cols[mv.to].push(turn);
      reserve[turn] -= 1;
      return null;
    }
    const moving = cols[mv.from].splice(mv.row);
    for (let i = 0; i < moving.length; i++) cols[mv.to].push(moving[i]);
    return moving.length;
  }

  function undoMoveFast(cols, reserve, turn, mv, count) {
    if (mv.type === 'place') {
      cols[mv.to].pop();
      reserve[turn] += 1;
      return;
    }
    const back = cols[mv.to].splice(cols[mv.to].length - count);
    for (let i = 0; i < back.length; i++) cols[mv.from].push(back[i]);
  }

  function genMovesFast(cols, reserve, turn) {
    const moves = [];
    if (reserve[turn] > 0) {
      // Order center first for better alpha-beta cutoffs
      moves.push({ type: 'place', to: 1 }, { type: 'place', to: 0 }, { type: 'place', to: 2 });
      return moves;
    }
    for (let from = 0; from < COLS; from++) {
      const col = cols[from];
      for (let row = col.length - 1; row >= 0; row--) {
        if (col[row] !== turn) continue;
        for (let to = 0; to < COLS; to++) {
          if (to !== from) moves.push({ type: 'stack', from, row, to });
        }
      }
    }
    return moves;
  }

  /* =====================================================================
     Exact Strong Solver (Phase 2 Retrograde + Phase 1 Backward Induction)
     Computes the complete game-theoretic solution on-the-fly (~25 ms once):
       - Standard exact W/L/D + DTM for all 5,664 Phase 2 non-terminal boards
         (turn-normalized) and all 3,759 reachable Phase 1 states.
       - Pacifist anti-forced-win break-DTM table for the 'draw' bot.
     ===================================================================== */

  let _exactCache = null;

  function ensureExactSolver() {
    if (_exactCache) return _exactCache;

    const shapes = [];
    const shapeId = Array.from({ length: 11 }, () => new Int8Array(11).fill(-1));
    for (let h0 = 0; h0 <= 10; h0++) {
      for (let h1 = 0; h1 <= 10 - h0; h1++) {
        shapeId[h0][h1] = shapes.length;
        shapes.push([h0, h1, 10 - h0 - h1]);
      }
    }

    const masks = [];
    const maskId = new Int16Array(1024).fill(-1);
    for (let m = 0; m < 1024; m++) {
      let c = 0;
      let x = m;
      while (x) { x &= x - 1; c++; }
      if (c === 5) {
        maskId[m] = masks.length;
        masks.push(m);
      }
    }

    const N2 = shapes.length * masks.length; // 66 * 252 = 16,632
    const c0 = new Uint8Array(10);
    const c1 = new Uint8Array(10);
    const c2 = new Uint8Array(10);
    const n0 = new Uint8Array(10);
    const n1 = new Uint8Array(10);
    const n2 = new Uint8Array(10);
    const colsBuf = [c0, c1, c2];
    const ncolsBuf = [n0, n1, n2];

    function checkFast(h0, h1, h2, b0, b1, b2) {
      let res = 0;
      for (let r = 0; r <= h0 - 3; r++) {
        const p = b0[r];
        if (b0[r + 1] === p && b0[r + 2] === p) res |= 1 << p;
      }
      for (let r = 0; r <= h1 - 3; r++) {
        const p = b1[r];
        if (b1[r + 1] === p && b1[r + 2] === p) res |= 1 << p;
      }
      for (let r = 0; r <= h2 - 3; r++) {
        const p = b2[r];
        if (b2[r + 1] === p && b2[r + 2] === p) res |= 1 << p;
      }
      const minH = h0 < h1 ? (h0 < h2 ? h0 : h2) : (h1 < h2 ? h1 : h2);
      for (let r = 0; r < minH; r++) {
        const p = b0[r];
        if (b1[r] === p && b2[r] === p) res |= 1 << p;
      }
      const maxH = h0 > h1 ? (h0 > h2 ? h0 : h2) : (h1 > h2 ? h1 : h2);
      for (let r = 0; r <= maxH - 3; r++) {
        if (r < h0 && r + 1 < h1 && r + 2 < h2) {
          const p = b0[r];
          if (b1[r + 1] === p && b2[r + 2] === p) res |= 1 << p;
        }
        if (r + 2 < h0 && r + 1 < h1 && r < h2) {
          const p = b0[r + 2];
          if (b1[r + 1] === p && b2[r] === p) res |= 1 << p;
        }
      }
      return res;
    }

    // 1. Classify non-terminal Phase 2 boards
    const nonTerm2 = new Uint8Array(N2);
    for (let bid = 0; bid < N2; bid++) {
      const hs = shapes[(bid / 252) | 0];
      const m = masks[bid % 252];
      let bit = 0;
      for (let r = 0; r < hs[0]; r++) c0[r] = (m >> bit++) & 1;
      for (let r = 0; r < hs[1]; r++) c1[r] = (m >> bit++) & 1;
      for (let r = 0; r < hs[2]; r++) c2[r] = (m >> bit++) & 1;
      if (checkFast(hs[0], hs[1], hs[2], c0, c1, c2) === 0) nonTerm2[bid] = 1;
    }

    // 2. Build forward & reverse Phase 2 transition graph (0 = mover, 1 = opponent)
    // Max non-terminal edges = 5,664 * 10 = 56,640 (actual ~42,680)
    const fwdSucc2 = new Int32Array(N2 * 10).fill(-1);
    const fwdLm2 = new Uint8Array(N2 * 10);
    const revHead2 = new Int32Array(N2).fill(-1);
    const revTo2 = new Int32Array(57000);
    const revNext2 = new Int32Array(57000);
    let edgeCnt = 0;

    const nonLoss2 = new Uint8Array(N2);
    const hasImmWin2 = new Uint8Array(N2);
    const hasImmDraw2 = new Uint8Array(N2);
    const immSelfOwnCnt2 = new Uint8Array(N2);

    for (let bid = 0; bid < N2; bid++) {
      if (!nonTerm2[bid]) continue;
      const hs = shapes[(bid / 252) | 0];
      const m = masks[bid % 252];
      let bit = 0;
      for (let c = 0; c < 3; c++) {
        for (let r = 0; r < hs[c]; r++) colsBuf[c][r] = (m >> bit++) & 1;
      }
      let slot = bid * 10;
      for (let f = 0; f < 3; f++) {
        for (let row = 0; row < hs[f]; row++) {
          if (colsBuf[f][row] !== 0) continue;
          for (let t = 0; t < 3; t++) {
            if (t === f) continue;
            const nh0 = hs[0], nh1 = hs[1], nh2 = hs[2];
            const nh = [nh0, nh1, nh2];
            for (let c = 0; c < 3; c++) {
              for (let r = 0; r < hs[c]; r++) ncolsBuf[c][r] = colsBuf[c][r];
            }
            for (let k = row; k < hs[f]; k++) ncolsBuf[t][nh[t]++] = colsBuf[f][k];
            nh[f] = row;

            const lm = checkFast(nh[0], nh[1], nh[2], n0, n1, n2);
            fwdLm2[slot] = lm;
            if (lm === 0) {
              // Color-swap so the next player to move becomes color 0
              let nm = 0;
              let nb = 0;
              for (let c = 0; c < 3; c++) {
                for (let r = 0; r < nh[c]; r++) {
                  if (ncolsBuf[c][r] === 0) nm |= 1 << nb;
                  nb++;
                }
              }
              const nbid = shapeId[nh[0]][nh[1]] * 252 + maskId[nm];
              fwdSucc2[slot] = nbid;
              revTo2[edgeCnt] = bid;
              revNext2[edgeCnt] = revHead2[nbid];
              revHead2[nbid] = edgeCnt++;
              nonLoss2[bid]++;
            } else if (lm === 1) {
              hasImmWin2[bid] = 1;
              nonLoss2[bid]++;
            } else if (lm === 3) {
              hasImmDraw2[bid] = 1;
              nonLoss2[bid]++;
            } else {
              immSelfOwnCnt2[bid]++;
            }
            slot++;
          }
        }
      }
    }

    // 3. Exact level-by-level Phase 2 standard retrograde analysis
    const stdVal2 = new Int8Array(N2); // 0=DRAW, 1=WIN, -1=LOSS
    const stdDtm2 = new Int8Array(N2).fill(-1);
    let curWin = [];
    let curLoss = [];
    for (let bid = 0; bid < N2; bid++) {
      if (!nonTerm2[bid]) continue;
      if (hasImmWin2[bid]) {
        stdVal2[bid] = 1;
        stdDtm2[bid] = 1;
        curWin.push(bid);
      } else if (nonLoss2[bid] === 0) {
        stdVal2[bid] = -1;
        stdDtm2[bid] = 1;
        curLoss.push(bid);
      }
    }
    let wave = 2;
    while (curWin.length || curLoss.length) {
      const nextWin = [];
      const nextLoss = [];
      for (let i = 0; i < curLoss.length; i++) {
        for (let e = revHead2[curLoss[i]]; e !== -1; e = revNext2[e]) {
          const p = revTo2[e];
          if (stdVal2[p] === 0) {
            stdVal2[p] = 1;
            stdDtm2[p] = wave;
            nextWin.push(p);
          }
        }
      }
      for (let i = 0; i < curWin.length; i++) {
        for (let e = revHead2[curWin[i]]; e !== -1; e = revNext2[e]) {
          const p = revTo2[e];
          if (--nonLoss2[p] === 0 && stdVal2[p] === 0) {
            stdVal2[p] = -1;
            stdDtm2[p] = wave;
            nextLoss.push(p);
          }
        }
      }
      curWin = nextWin;
      curLoss = nextLoss;
      wave++;
    }

    // 4. Precompute trap counts (how many of the mover's 10 moves lose) for sharp Master drawing play
    const loseMoves2 = new Uint8Array(N2);
    for (let bid = 0; bid < N2; bid++) {
      if (!nonTerm2[bid]) continue;
      let loses = 0;
      const base = bid * 10;
      for (let i = 0; i < 10; i++) {
        const lm = fwdLm2[base + i];
        if (lm === 2) loses++;
        else if (lm === 0 && stdVal2[fwdSucc2[base + i]] === 1) loses++;
      }
      loseMoves2[bid] = loses;
    }

    // 5. Exact Pacifist Phase 2 Retrograde (anti-forced-win safety game for 'draw' bot):
    //    Bot NEVER plays a move where human can win; Bot treats simultaneous-3 draws as unbreakable (255),
    //    and maximizes plies before being forced into a Mercy-Kill corner where all safe moves win immediately.
    //    Bipartite nodes: [0..N2-1] = Bot to move (bot is color 0), [N2..2*N2-1] = Human to move (human is color 0).
    const PAC_SAFE = 255;
    const pacBreak2 = new Uint8Array(N2 * 2).fill(PAC_SAFE);
    const botSafeCnt2 = new Uint8Array(N2);
    const pacBuckets = [];
    const pushBucket = (d, node) => {
      if (!pacBuckets[d]) pacBuckets[d] = [];
      pacBuckets[d].push(node);
    };

    for (let bid = 0; bid < N2; bid++) {
      if (!nonTerm2[bid]) continue;
      // Bot-to-move node = bid: count safe non-winning moves (immDraw OR non-term with stdVal2[nbid] <= 0)
      let safe = hasImmDraw2[bid] ? 1 : 0;
      const base = bid * 10;
      for (let i = 0; i < 10; i++) {
        if (fwdLm2[base + i] === 0 && stdVal2[fwdSucc2[base + i]] !== 1) safe++;
      }
      botSafeCnt2[bid] = safe;
      if (safe === 0) {
        pacBreak2[bid] = 1; // Every non-losing move wins immediately for Bot (or Bot already lost)
        pushBucket(1, bid);
      }
      // Human-to-move node = N2 + bid: breaks in 1 ply if Human has an immediate win
      if (hasImmWin2[bid]) {
        pacBreak2[N2 + bid] = 1;
        pushBucket(1, N2 + bid);
      }
    }

    for (let d = 1; d < pacBuckets.length; d++) {
      const batch = pacBuckets[d];
      if (!batch) continue;
      for (let i = 0; i < batch.length; i++) {
        const u = batch[i];
        if (u < N2) {
          // u is Bot-to-move -> predecessors are Human-to-move (N2 + p)
          for (let e = revHead2[u]; e !== -1; e = revNext2[e]) {
            const p = revTo2[e];
            const pn = N2 + p;
            if (pacBreak2[pn] === PAC_SAFE) {
              pacBreak2[pn] = d + 1;
              pushBucket(d + 1, pn);
            }
          }
        } else {
          // u is Human-to-move (N2 + ub) -> predecessors are Bot-to-move (p) that counted this edge as safe
          const ub = u - N2;
          if (stdVal2[ub] === 1) continue; // Bot never enters stdVal2[ub]===1, so wasn't counted in botSafeCnt2
          for (let e = revHead2[ub]; e !== -1; e = revNext2[e]) {
            const p = revTo2[e];
            if (botSafeCnt2[p] > 0 && --botSafeCnt2[p] === 0 && pacBreak2[p] === PAC_SAFE) {
              pacBreak2[p] = d + 1;
              pushBucket(d + 1, p);
            }
          }
        }
      }
    }

    // 6. Phase 1 Forward Reachability (plies 0..10, normalized: 0 = round starter, 1 = second player)
    const reach1 = Array.from({ length: 11 }, () => []);
    const idx1 = Array.from({ length: 11 }, () => new Map());
    reach1[0].push(0);
    idx1[0].set(0, 0);

    function unpackP1(key, hs, b0, b1, b2) {
      hs[0] = key & 15;
      hs[1] = (key >> 4) & 15;
      hs[2] = (key >> 8) & 15;
      const mask = key >>> 12;
      let bit = 0;
      for (let r = 0; r < hs[0]; r++) b0[r] = (mask >> bit++) & 1;
      for (let r = 0; r < hs[1]; r++) b1[r] = (mask >> bit++) & 1;
      for (let r = 0; r < hs[2]; r++) b2[r] = (mask >> bit++) & 1;
    }

    function packP1Fast(hs, b0, b1, b2) {
      let mask = 0;
      let bit = 0;
      for (let r = 0; r < hs[0]; r++) { if (b0[r]) mask |= 1 << bit; bit++; }
      for (let r = 0; r < hs[1]; r++) { if (b1[r]) mask |= 1 << bit; bit++; }
      for (let r = 0; r < hs[2]; r++) { if (b2[r]) mask |= 1 << bit; bit++; }
      return (hs[0] | (hs[1] << 4) | (hs[2] << 8) | (mask << 12)) >>> 0;
    }

    const hsTmp = [0, 0, 0];
    for (let ply = 0; ply < 10; ply++) {
      const turn = ply & 1;
      const layer = reach1[ply];
      const nextLayer = reach1[ply + 1];
      const nextIdx = idx1[ply + 1];
      for (let i = 0; i < layer.length; i++) {
        unpackP1(layer[i], hsTmp, c0, c1, c2);
        for (let to = 0; to < 3; to++) {
          colsBuf[to][hsTmp[to]++] = turn;
          if (checkFast(hsTmp[0], hsTmp[1], hsTmp[2], c0, c1, c2) === 0) {
            const nk = packP1Fast(hsTmp, c0, c1, c2);
            if (!nextIdx.has(nk)) {
              nextIdx.set(nk, nextLayer.length);
              nextLayer.push(nk);
            }
          }
          hsTmp[to]--;
        }
      }
    }

    // 7. Phase 1 Backward Induction: Standard (stdVal1, stdDtm1, loseMoves1) & Pacifist (botRole 0 & 1)
    const stdVal1 = new Array(11);
    const stdDtm1 = new Array(11);
    const loseMoves1 = new Array(11);
    const pacBreak1 = [new Array(11), new Array(11)]; // [botRole=0 (starter), botRole=1 (second)]

    const n10 = reach1[10].length;
    stdVal1[10] = new Int8Array(n10);
    stdDtm1[10] = new Int8Array(n10);
    loseMoves1[10] = new Uint8Array(n10);
    pacBreak1[0][10] = new Uint8Array(n10);
    pacBreak1[1][10] = new Uint8Array(n10);

    for (let i = 0; i < n10; i++) {
      const k = reach1[10][i];
      const h0 = k & 15;
      const h1 = (k >> 4) & 15;
      const mask = k >>> 12;
      // At ply 10, starter (color 0) is to move — directly matches Phase 2 mover=0!
      const bid = shapeId[h0][h1] * 252 + maskId[mask];
      stdVal1[10][i] = stdVal2[bid];
      stdDtm1[10][i] = stdDtm2[bid];
      loseMoves1[10][i] = loseMoves2[bid];
      pacBreak1[0][10][i] = pacBreak2[bid];      // Bot is starter -> Bot to move at ply 10
      pacBreak1[1][10][i] = pacBreak2[N2 + bid]; // Bot is second -> Human to move at ply 10
    }

    for (let ply = 9; ply >= 0; ply--) {
      const turn = ply & 1;
      const layer = reach1[ply];
      const nextIdx = idx1[ply + 1];
      const n = layer.length;
      const sv = new Int8Array(n);
      const sd = new Int8Array(n);
      const lmArr = new Uint8Array(n);
      const pb0 = new Uint8Array(n);
      const pb1 = new Uint8Array(n);

      for (let i = 0; i < n; i++) {
        unpackP1(layer[i], hsTmp, c0, c1, c2);
        let canWin = false;
        let canDraw = false;
        let bestWinD = 99;
        let bestLossD = -1;
        let losingCount = 0;

        // Track Pacifist breakDtm for botRole=0 and botRole=1
        let maxBotD0 = -1, minHumD0 = 255;
        let maxBotD1 = -1, minHumD1 = 255;

        for (let to = 0; to < 3; to++) {
          colsBuf[to][hsTmp[to]++] = turn;
          const lm = checkFast(hsTmp[0], hsTmp[1], hsTmp[2], c0, c1, c2);
          if (lm === 0) {
            const nid = nextIdx.get(packP1Fast(hsTmp, c0, c1, c2));
            const cv = stdVal1[ply + 1][nid];
            const cd = stdDtm1[ply + 1][nid];
            if (cv === -1) {
              canWin = true;
              if (1 + cd < bestWinD) bestWinD = 1 + cd;
            } else if (cv === 0) {
              canDraw = true;
            } else {
              losingCount++;
              if (1 + cd > bestLossD) bestLossD = 1 + cd;
            }

            // Pacifist update for botRole = 0
            const cpb0 = pacBreak1[0][ply + 1][nid];
            if (turn === 0) {
              if (cv !== 1) { // Bot refuses to let human win
                const sc = cpb0 === PAC_SAFE ? PAC_SAFE : Math.min(254, cpb0 + 1);
                if (sc > maxBotD0) maxBotD0 = sc;
              }
            } else {
              const sc = cpb0 === PAC_SAFE ? PAC_SAFE : Math.min(254, cpb0 + 1);
              if (sc < minHumD0) minHumD0 = sc;
            }

            // Pacifist update for botRole = 1
            const cpb1 = pacBreak1[1][ply + 1][nid];
            if (turn === 1) {
              if (cv !== 1) {
                const sc = cpb1 === PAC_SAFE ? PAC_SAFE : Math.min(254, cpb1 + 1);
                if (sc > maxBotD1) maxBotD1 = sc;
              }
            } else {
              const sc = cpb1 === PAC_SAFE ? PAC_SAFE : Math.min(254, cpb1 + 1);
              if (sc < minHumD1) minHumD1 = sc;
            }
          } else if (lm === (1 << turn)) {
            canWin = true;
            bestWinD = 1;
            if (turn === 0) { if (1 > maxBotD0) maxBotD0 = 1; minHumD1 = 1; }
            else { if (1 > maxBotD1) maxBotD1 = 1; minHumD0 = 1; }
          } else if (lm === 3) {
            canDraw = true;
            if (turn === 0) maxBotD0 = PAC_SAFE;
            else maxBotD1 = PAC_SAFE;
          } else {
            losingCount++;
            if (1 > bestLossD) bestLossD = 1;
          }
          hsTmp[to]--;
        }

        if (canWin) { sv[i] = 1; sd[i] = bestWinD; }
        else if (canDraw) { sv[i] = 0; sd[i] = -1; }
        else { sv[i] = -1; sd[i] = bestLossD; }
        lmArr[i] = losingCount;

        pb0[i] = turn === 0 ? (maxBotD0 < 0 ? 1 : maxBotD0) : minHumD0;
        pb1[i] = turn === 1 ? (maxBotD1 < 0 ? 1 : maxBotD1) : minHumD1;
      }

      stdVal1[ply] = sv;
      stdDtm1[ply] = sd;
      loseMoves1[ply] = lmArr;
      pacBreak1[0][ply] = pb0;
      pacBreak1[1][ply] = pb1;
    }

    function encodeBoardP2(cols, mover) {
      const h0 = cols[0].length;
      const h1 = cols[1].length;
      const h2 = cols[2].length;
      if (h0 + h1 + h2 !== 10) return -1;
      let mask = 0;
      let bit = 0;
      for (let c = 0; c < 3; c++) {
        const col = cols[c];
        for (let r = 0; r < col.length; r++) {
          if (col[r] !== mover) mask |= 1 << bit;
          bit++;
        }
      }
      const sid = shapeId[h0][h1];
      const mid = maskId[mask];
      if (sid < 0 || mid < 0) return -1;
      return sid * 252 + mid;
    }

    function encodeBoardP1(cols, firstPlayer) {
      const h0 = cols[0].length;
      const h1 = cols[1].length;
      const h2 = cols[2].length;
      let mask = 0;
      let bit = 0;
      for (let c = 0; c < 3; c++) {
        const col = cols[c];
        for (let r = 0; r < col.length; r++) {
          if (col[r] !== firstPlayer) mask |= 1 << bit;
          bit++;
        }
      }
      return (h0 | (h1 << 4) | (h2 << 8) | (mask << 12)) >>> 0;
    }

    function lookupExact(cols, reserve, turn, botColor) {
      const rem = reserve.o + reserve.y;
      if (rem === 0) {
        const bid = encodeBoardP2(cols, turn);
        if (bid < 0 || !nonTerm2[bid]) return null;
        const pacIdx = turn === botColor ? bid : N2 + bid;
        return {
          val: stdVal2[bid],
          dtm: stdDtm2[bid],
          loseMoves: loseMoves2[bid],
          pacBreak: pacBreak2[pacIdx],
          hasImmDraw: hasImmDraw2[bid],
          immSelfOwns: immSelfOwnCnt2[bid],
        };
      }
      const ply = 10 - rem;
      const firstPlayer = (ply & 1) === 0 ? turn : other(turn);
      const expFirst = 5 - ((ply + 1) >> 1);
      const expSecond = 5 - (ply >> 1);
      if (reserve[firstPlayer] !== expFirst || reserve[other(firstPlayer)] !== expSecond) return null;
      const key = encodeBoardP1(cols, firstPlayer);
      const id = idx1[ply].get(key);
      if (id === undefined) return null;
      const botRole = botColor === firstPlayer ? 0 : 1;
      return {
        val: stdVal1[ply][id],
        dtm: stdDtm1[ply][id],
        loseMoves: loseMoves1[ply][id],
        pacBreak: pacBreak1[botRole][ply][id],
        hasImmDraw: 0,
        immSelfOwns: 0,
      };
    }

    _exactCache = {
      N2,
      PAC_SAFE,
      nonTerm2,
      stdVal2,
      stdDtm2,
      pacBreak2,
      stdVal1,
      stdDtm1,
      pacBreak1,
      reach1,
      idx1,
      encodeBoardP2,
      encodeBoardP1,
      lookupExact,
    };
    return _exactCache;
  }

  /** Choose a move using the exact strong solver for 'master' (perfect) or 'draw' (unbeatable pacifist). */
  function chooseExactAIMove(state, diff) {
    const moves = getLegalMoves(state);
    if (!moves.length) return null;
    if (moves.length === 1) return moves[0];

    const solver = ensureExactSolver();
    const me = state.turn;
    const opp = other(me);
    const cols = cloneCols(state.cols);
    const reserve = { o: state.reserve.o, y: state.reserve.y };
    const recentSet = new Set((state.history || []).slice(-10));

    const analyzed = [];
    for (let i = 0; i < moves.length; i++) {
      const mv = moves[i];
      const cnt = makeMoveFast(cols, reserve, me, mv);
      const out = evaluateOutcome(cols, me);
      const nextKey = stateKey(cols, opp, reserve);
      let entry = null;

      if (out) {
        if (out.result === 'draw') {
          entry = {
            mv,
            stdVal: 0,
            stdDtm: -1,
            immWin: false,
            immDraw: true,
            immLoss: false,
            oppTrapCount: 0,
            pacBreak: solver.PAC_SAFE,
            oppSelfOwns: 0,
            repeat: false,
          };
        } else if (out.winner === me) {
          entry = {
            mv,
            stdVal: 1,
            stdDtm: 1,
            immWin: true,
            immDraw: false,
            immLoss: false,
            oppTrapCount: 0,
            pacBreak: 1,
            oppSelfOwns: 0,
            repeat: false,
          };
        } else {
          entry = {
            mv,
            stdVal: -1,
            stdDtm: 1,
            immWin: false,
            immDraw: false,
            immLoss: true,
            oppTrapCount: 0,
            pacBreak: 0,
            oppSelfOwns: 0,
            repeat: false,
          };
        }
      } else {
        const info = solver.lookupExact(cols, reserve, opp, me);
        if (!info) {
          undoMoveFast(cols, reserve, me, mv, cnt);
          return null; // Custom/non-standard state outside exact table -> fall back to search
        }
        entry = {
          mv,
          stdVal: -info.val,
          stdDtm: info.dtm >= 0 ? info.dtm + 1 : -1,
          immWin: false,
          immDraw: false,
          immLoss: false,
          oppTrapCount: info.loseMoves,
          pacBreak: info.pacBreak === solver.PAC_SAFE ? solver.PAC_SAFE : info.pacBreak + 1,
          oppSelfOwns: info.immSelfOwns,
          repeat: recentSet.has(nextKey),
        };
      }

      undoMoveFast(cols, reserve, me, mv, cnt);
      analyzed.push(entry);
    }

    if (diff === 'master') {
      // 1. Forced WIN -> take fastest exact DTM mate!
      const wins = analyzed.filter((a) => a.stdVal === 1);
      if (wins.length) {
        let minDtm = Infinity;
        for (let i = 0; i < wins.length; i++) if (wins[i].stdDtm < minDtm) minDtm = wins[i].stdDtm;
        const best = wins.filter((a) => a.stdDtm === minDtm);
        return best[Math.floor(Math.random() * best.length)].mv;
      }

      // 2. Theoretical DRAW -> keep fighting (avoid instant draw unless forced), avoid loops, maximize opponent traps!
      const draws = analyzed.filter((a) => a.stdVal === 0);
      if (draws.length) {
        const nonImmDraws = draws.filter((a) => !a.immDraw);
        let pool = nonImmDraws.length ? nonImmDraws : draws;
        const fresh = pool.filter((a) => !a.repeat);
        if (fresh.length) pool = fresh;
        let maxTraps = -1;
        for (let i = 0; i < pool.length; i++) if (pool[i].oppTrapCount > maxTraps) maxTraps = pool[i].oppTrapCount;
        const best = pool.filter((a) => a.oppTrapCount === maxTraps);
        return best[Math.floor(Math.random() * best.length)].mv;
      }

      // 3. Losing custom position -> maximize exact resistance DTM
      let maxDtm = -1;
      for (let i = 0; i < analyzed.length; i++) if (analyzed[i].stdDtm > maxDtm) maxDtm = analyzed[i].stdDtm;
      const best = analyzed.filter((a) => a.stdDtm === maxDtm);
      return best[Math.floor(Math.random() * best.length)].mv;
    }

    // diff === 'draw' (Unbeatable Pacifist / Eternal-Draw Bot):
    // 1. Hard Safety Filter: NEVER let the opponent win!
    const safe = analyzed.filter((a) => a.stdVal >= 0);
    if (!safe.length) {
      // Impossible from standard opening; if placed in a lost position, delay loss maximally
      let maxDtm = -1;
      for (let i = 0; i < analyzed.length; i++) if (analyzed[i].stdDtm > maxDtm) maxDtm = analyzed[i].stdDtm;
      const best = analyzed.filter((a) => a.stdDtm === maxDtm);
      return best[Math.floor(Math.random() * best.length)].mv;
    }

    // 2. Instant simultaneous 3-in-a-row draw -> grab it immediately!
    const immDraws = safe.filter((a) => a.immDraw);
    if (immDraws.length) {
      return immDraws[Math.floor(Math.random() * immDraws.length)].mv;
    }

    // 3. Refuse immediate wins whenever ANY safe non-winning move exists!
    const nonWinSafe = safe.filter((a) => !a.immWin);
    if (!nonWinSafe.length) {
      // True Mercy-Kill corner: every non-losing move wins immediately (human forced bot to win!)
      return safe[Math.floor(Math.random() * safe.length)].mv;
    }

    // 4. Among safe non-winning moves:
    //    - Maximize exact pacifist breakDtm (resist forced-to-win traps as long as mathematically possible)
    //    - Prefer moves where opponent has fewer self-own opportunities
    //    - Prefer steering back to a true neutral DRAW (stdVal===0) over lingering in a WIN state
    //    - Prefer fresh (non-repeating) states to keep play lively and hunt for simultaneous-3 draws
    let bestBreak = -1;
    for (let i = 0; i < nonWinSafe.length; i++) {
      if (nonWinSafe[i].pacBreak > bestBreak) bestBreak = nonWinSafe[i].pacBreak;
    }
    let pool = nonWinSafe.filter((a) => a.pacBreak === bestBreak);

    const fresh = pool.filter((a) => !a.repeat);
    if (fresh.length) pool = fresh;

    const neutralDraws = pool.filter((a) => a.stdVal === 0);
    if (neutralDraws.length) pool = neutralDraws;

    let minOppSelfOwn = Infinity;
    for (let i = 0; i < pool.length; i++) {
      if (pool[i].oppSelfOwns < minOppSelfOwn) minOppSelfOwn = pool[i].oppSelfOwns;
    }
    const best = pool.filter((a) => a.oppSelfOwns === minOppSelfOwn);
    return best[Math.floor(Math.random() * best.length)].mv;
  }

  /** Choose an AI move for `state.turn`.
      level: 'chill' | 'clever' | 'master' | 'draw' */
  function chooseAIMove(state, level) {
    const moves = getLegalMoves(state);
    if (!moves.length) return null;
    if (moves.length === 1) return moves[0];

    const diff = level === 'chill' || level === 'master' || level === 'draw' ? level : 'clever';
    if (diff === 'master' || diff === 'draw') {
      const exactMove = chooseExactAIMove(state, diff);
      if (exactMove) return exactMove;
    }
    const me = state.turn;
    const cols = cloneCols(state.cols);
    const reserve = { o: state.reserve.o, y: state.reserve.y };
    const recentSet = new Set((state.history || []).slice(-8));

    // Check immediate 1-ply outcomes first (instant win / avoid self-own!)
    const analyzed = moves.map((mv) => {
      const cnt = makeMoveFast(cols, reserve, me, mv);
      const out = evaluateOutcome(cols, me);
      const key = stateKey(cols, other(me), reserve);
      undoMoveFast(cols, reserve, me, mv, cnt);
      return { mv, out, repeat: recentSet.has(key) };
    });

    const immediateWins = analyzed.filter((a) => a.out && a.out.result === 'win' && a.out.winner === me);
    if (immediateWins.length) {
      // Chill misses obvious win 18% of the time only in Stack Play (feels friendly, never robotic)
      if (diff !== 'chill' || state.phase === 'place' || Math.random() < 0.82) {
        return immediateWins[Math.floor(Math.random() * immediateWins.length)].mv;
      }
    }

    // Filter out instant self-owns if any non-losing move exists
    const nonSelfOwns = analyzed.filter((a) => !(a.out && a.out.result === 'win' && a.out.winner !== me));
    const candidates = nonSelfOwns.length ? nonSelfOwns : analyzed;

    // Depth & time budget per difficulty (Phase 1 has branching factor 3 -> Master solves placement cleanly!)
    const remBalls = reserve.o + reserve.y;
    const maxDepth = diff === 'master'
      ? (remBalls > 0 ? Math.min(10, remBalls + 1) : 5)
      : diff === 'clever'
        ? (remBalls > 0 ? Math.min(6, remBalls) : 3)
        : 2;
    const budgetMs = diff === 'master' ? 48 : diff === 'clever' ? 24 : 10;
    const deadline = Date.now() + budgetMs;
    let timedOut = false;
    let nodes = 0;

    const tt = new Map();

    function negamax(depth, alpha, beta, turn, plyFromRoot) {
      nodes++;
      if ((nodes & 255) === 0 && Date.now() >= deadline) {
        timedOut = true;
        return evaluateHeuristic(cols, reserve, turn, turn);
      }

      const key = stateKey(cols, turn, reserve) + ':' + depth;
      const cached = tt.get(key);
      if (cached !== undefined && cached.flag === 0) return cached.val;

      const list = genMovesFast(cols, reserve, turn);
      if (!list.length) return 0;

      // Score children quickly for move ordering
      let best = -Infinity;
      const origAlpha = alpha;

      // First pass: check immediate terminal moves to prune cleanly
      const ordered = [];
      for (let i = 0; i < list.length; i++) {
        const mv = list[i];
        const cnt = makeMoveFast(cols, reserve, turn, mv);
        const out = evaluateOutcome(cols, turn);
        undoMoveFast(cols, reserve, turn, mv, cnt);
        if (out) {
          if (out.result === 'win' && out.winner === turn) {
            // Immediate win — fastest win preferred
            const sc = WIN_SCORE - plyFromRoot * 50;
            if (tt.size < 40000) tt.set(key, { val: sc, flag: 0 });
            return sc;
          }
          const termScore = out.result === 'draw' ? -15 : -(WIN_SCORE - (plyFromRoot + 1) * 50);
          ordered.push({ mv, term: true, termScore, prio: termScore });
        } else {
          ordered.push({ mv, term: false, prio: mv.type === 'place' && mv.to === 1 ? 10 : 0 });
        }
      }

      // Try non-losing moves before self-owns
      ordered.sort((a, b) => b.prio - a.prio);

      for (let i = 0; i < ordered.length; i++) {
        const item = ordered[i];
        let val;
        if (item.term) {
          val = item.termScore;
        } else if (depth <= 1) {
          const cnt = makeMoveFast(cols, reserve, turn, item.mv);
          val = evaluateHeuristic(cols, reserve, turn, other(turn));
          undoMoveFast(cols, reserve, turn, item.mv, cnt);
        } else {
          const cnt = makeMoveFast(cols, reserve, turn, item.mv);
          val = -negamax(depth - 1, -beta, -alpha, other(turn), plyFromRoot + 1);
          undoMoveFast(cols, reserve, turn, item.mv, cnt);
        }

        if (timedOut) break;
        if (val > best) best = val;
        if (best > alpha) alpha = best;
        if (alpha >= beta) break;
      }

      if (!timedOut && tt.size < 40000) {
        const flag = best <= origAlpha ? 2 : best >= beta ? 1 : 0;
        tt.set(key, { val: best, flag });
      }
      return best;
    }

    // Score each candidate move via iterative deepening up to maxDepth
    const scores = new Array(candidates.length).fill(0);
    for (let d = 1; d <= maxDepth; d++) {
      const iterScores = new Array(candidates.length);
      for (let i = 0; i < candidates.length; i++) {
        const item = candidates[i];
        if (item.out) {
          iterScores[i] = item.out.result === 'draw' ? -15 : -(WIN_SCORE - 50);
          continue;
        }
        const cnt = makeMoveFast(cols, reserve, me, item.mv);
        let sc;
        if (d === 1) {
          sc = evaluateHeuristic(cols, reserve, me, other(me));
        } else {
          sc = -negamax(d - 1, -WIN_SCORE * 2, WIN_SCORE * 2, other(me), 1);
        }
        undoMoveFast(cols, reserve, me, item.mv, cnt);
        if (timedOut) break;
        // Strongly discourage boring ping-pong loops unless it's the only way to survive
        if (item.repeat && sc > -50000) sc -= 120;
        iterScores[i] = sc;
      }
      if (timedOut) break;
      for (let i = 0; i < candidates.length; i++) scores[i] = iterScores[i];
    }

    // Combine with controlled personality noise per difficulty
    const ranked = candidates.map((item, i) => ({
      mv: item.mv,
      score: scores[i],
      isDraw: !!(item.out && item.out.result === 'draw'),
    }));
    ranked.sort((a, b) => b.score - a.score);

    const bestScore = ranked[0].score;

    // Master: pick among near-tied best moves (within 8 pts)
    if (diff === 'master') {
      const top = ranked.filter((r) => r.score >= bestScore - 8);
      return top[Math.floor(Math.random() * top.length)].mv;
    }

    // Clever: if there's a forced win or forced block, take the best; otherwise slight variety among solid non-draw moves
    if (diff === 'clever') {
      if (bestScore > 50000 || bestScore < -50000) {
        const top = ranked.filter((r) => r.score >= bestScore - 20);
        return top[Math.floor(Math.random() * top.length)].mv;
      }
      const nonDraws = ranked.filter((r) => !r.isDraw && r.score > -50000);
      const base = nonDraws.length ? nonDraws : ranked;
      const pool = base.filter((r) => r.score >= base[0].score - 28).slice(0, 3);
      return pool[Math.floor(Math.random() * pool.length)].mv;
    }

    // Chill: avoid instant blunders AND don't randomly pick immediate draws unless everything else loses
    const safeNonDraws = ranked.filter((r) => !r.isDraw && r.score > -50000);
    const safePool = safeNonDraws.length ? safeNonDraws : ranked.filter((r) => r.score > -50000);
    if (safePool.length) {
      const topN = safePool.slice(0, Math.min(4, safePool.length));
      const idx = Math.random() < 0.55 ? 0 : Math.floor(Math.random() * topN.length);
      return topN[idx].mv;
    }
    return ranked[0].mv;
  }

  /** Format a human-readable move summary for announcements / accessibility. */
  function describeMove(move) {
    const colName = ['Left', 'Center', 'Right'];
    if (!move) return '';
    if (move.type === 'place') return `Placed in ${colName[move.to]}`;
    const n = move.balls ? move.balls.length : 1;
    return n > 1
      ? `Moved stack of ${n} from ${colName[move.from]} to ${colName[move.to]}`
      : `Moved top ball from ${colName[move.from]} to ${colName[move.to]}`;
  }

  const api = {
    COLS,
    BALLS_PER_PLAYER,
    MATCH_TARGET,
    PLAYERS,
    other,
    createRound,
    cloneState,
    stateKey,
    findLines,
    evaluateOutcome,
    getLegalMoves,
    isLegalMove,
    applyMove,
    chooseAIMove,
    ensureExactSolver,
    describeMove,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  root.STTEngine = api;
})(typeof window !== 'undefined' ? window : globalThis);
