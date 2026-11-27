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

  /** Choose an AI move for `state.turn`.
      level: 'chill' | 'clever' | 'master' */
  function chooseAIMove(state, level) {
    const moves = getLegalMoves(state);
    if (!moves.length) return null;
    if (moves.length === 1) return moves[0];

    const diff = level === 'chill' || level === 'master' ? level : 'clever';
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
    describeMove,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  root.STTEngine = api;
})(typeof window !== 'undefined' ? window : globalThis);
