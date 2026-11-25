/* Best Life — pure game rules for 2–6 players (used by online play; no DOM).
   From the rules card: 7 cards each for 2–4 players, 5 each for 5–6; the rest is the Help Stack.
   On your turn ask one player "Help me with <set>" for a set you hold. If they have any, they hand
   them all over and you go again. If not, draw from the Help Stack; drawing the set you asked for
   lets you go again. Four of a kind wins the set. Most sets wins. (No Action cards online.)
   State is plain JSON so it can live in Firebase (which drops empty arrays, hence the `|| []`s). */
(function (root) {
  'use strict';
  const SET_IDS = ['goals', 'humor', 'education', 'health', 'money', 'belief', 'food', 'freedom', 'family', 'knowledge', 'friends', 'grit'];
  const setOf = (card) => card.replace(/\d+$/, '');
  const arr = (x) => (Array.isArray(x) ? x.filter((v) => v != null) : x && typeof x === 'object' ? Object.values(x) : []);

  function shuffle(a, rnd = Math.random) {
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }

  function hand(s, pid) { return arr(s.hands && s.hands[pid]); }
  /** a state read back from Firebase can be missing empty parts (it drops empty lists): rebuild them */
  function norm(s) {
    s.order = arr(s.order);
    s.hands = s.hands || {};
    s.won = s.won || {};
    s.order.forEach((p) => { s.hands[p] = hand(s, p); s.won[p] = won(s, p); });
    s.deck = arr(s.deck);
    return s;
  }
  function won(s, pid) { return arr(s.won && s.won[pid]); }
  function totalWon(s) { return s.order.reduce((n, p) => n + won(s, p).length, 0); }

  /** pull any completed sets out of pid's hand */
  function collectSets(s, pid) {
    const h = hand(s, pid), counts = {};
    h.forEach((c) => (counts[setOf(c)] = (counts[setOf(c)] || 0) + 1));
    const done = Object.keys(counts).filter((k) => counts[k] === 4);
    if (done.length) {
      s.hands[pid] = h.filter((c) => !done.includes(setOf(c)));
      s.won[pid] = won(s, pid).concat(done);
    }
    return done;
  }

  function newGame(order, rnd = Math.random) {
    if (order.length < 2 || order.length > 6) throw new Error('2 to 6 players');
    const deck = shuffle(SET_IDS.flatMap((id) => [0, 1, 2, 3].map((k) => id + k)), rnd);
    const per = order.length <= 4 ? 7 : 5;
    const s = { order: order.slice(), deck, hands: {}, won: {}, turn: order[0], phase: 'playing', n: 0, last: null };
    order.forEach((p) => { s.hands[p] = []; s.won[p] = []; });
    for (let r = 0; r < per; r++) for (const p of order) s.hands[p].push(s.deck.pop());
    const dealtSets = [];
    order.forEach((p) => collectSets(s, p).forEach((id) => dealtSets.push({ by: p, set: id })));
    s.last = { kind: 'deal', per, sets: dealtSets };
    settleTurn(s, order[0]);
    return s;
  }

  /** make `pid` the player to move, skipping/drawing for empty hands; ends the game when done */
  function settleTurn(s, pid) {
    s.deck = arr(s.deck);
    if (totalWon(s) === SET_IDS.length) { s.phase = 'over'; s.turn = null; return; }
    let i = s.order.indexOf(pid);
    for (let tries = 0; tries < s.order.length; tries++) {
      const p = s.order[(i + tries) % s.order.length];
      if (hand(s, p).length) { s.turn = p; return; }
      if (s.skipped && s.skipped[p] >= 2) continue; // away, cards returned: sits out until they're back
      if (s.deck.length) {
        // out of cards: draw one from the Help Stack and keep the turn
        s.hands[p] = [s.deck.pop()];
        s.autoDraw = p;
        s.turn = p;
        return;
      }
    }
    s.phase = 'over'; s.turn = null; // nobody holds cards and the stack is empty
  }

  function canAsk(s, by, target, set) {
    if (s.phase !== 'playing') return 'The game is over.';
    if (!arr(s.order).includes(by)) return 'You’re not in this game.';
    if (s.turn !== by) return 'It’s not your turn.';
    if (!s.order.includes(target) || target === by) return 'Pick another player to ask.';
    if (!hand(s, by).some((c) => setOf(c) === set)) return 'You can only ask for a set you hold.';
    return null;
  }

  /** apply "by asks target for set"; returns a new state (input untouched) */
  function ask(prev, by, target, set) {
    const err = canAsk(prev, by, target, set);
    if (err) throw new Error(err);
    const s = norm(JSON.parse(JSON.stringify(prev)));
    delete s.autoDraw;
    if (s.skipped) delete s.skipped[by]; // they're playing again
    s.n = (s.n || 0) + 1;
    const got = s.hands[target].filter((c) => setOf(c) === set);
    const last = { kind: 'ask', n: s.n, by, target, set, got: got.length, drew: null, again: false, sets: [] };
    if (got.length) {
      s.hands[target] = s.hands[target].filter((c) => setOf(c) !== set);
      s.hands[by] = s.hands[by].concat(got);
      last.cards = got;
      last.again = true;
    } else if (s.deck.length) {
      const c = s.deck.pop();
      s.hands[by].push(c);
      last.drew = setOf(c);
      last.drewCard = c;
      last.again = last.drew === set;
    }
    last.sets = collectSets(s, by);
    s.last = last;
    settleTurn(s, last.again ? by : s.order[(s.order.indexOf(by) + 1) % s.order.length]);
    return s;
  }

  /** host skips the current player (they're away). Skipped twice in a row (still gone), their
      cards go back into the Help Stack, so the sets they were holding can still be won. */
  function skip(prev, rnd = Math.random) {
    if (prev.phase !== 'playing') throw new Error('The game is over.');
    const s = norm(JSON.parse(JSON.stringify(prev)));
    delete s.autoDraw;
    s.n = (s.n || 0) + 1;
    const by = s.turn;
    s.skipped = s.skipped || {};
    s.skipped[by] = (s.skipped[by] || 0) + 1;
    s.last = { kind: 'skip', n: s.n, by, returned: 0 };
    if (s.skipped[by] >= 2 && s.hands[by].length) {
      s.last.returned = s.hands[by].length;
      s.deck = shuffle(s.deck.concat(s.hands[by]), rnd);
      s.hands[by] = [];
    }
    settleTurn(s, s.order[(s.order.indexOf(by) + 1) % s.order.length]);
    return s;
  }

  /** a player who sat out (skipped while away) is back online: deal them back in at their next turn */
  function rejoin(prev, pid) {
    if (!prev.skipped || !prev.skipped[pid]) return prev;
    const s = JSON.parse(JSON.stringify(prev));
    delete s.skipped[pid];
    return s;
  }

  /** what every player is allowed to see. The card someone drew stays private (only the drawer
      learns it, through their own hand) unless it was the set they asked for, which they announce. */
  function publicView(s) {
    const counts = {}, w = {};
    s.order.forEach((p) => { counts[p] = hand(s, p).length; w[p] = won(s, p); });
    let last = s.last || null;
    if (last && last.kind === 'ask') {
      last = Object.assign({}, last, { drew: !!last.drew, drewSet: last.again && last.drew ? last.drew : null });
      delete last.drewCard;
    }
    return { order: s.order, counts, won: w, turn: s.turn, phase: s.phase, deck: arr(s.deck).length, n: s.n || 0, last, autoDraw: s.autoDraw || null };
  }

  /** the private note a player gets with their hand: which card they just drew (if any) */
  function privateDraw(s, pid) {
    const l = s.last;
    return l && l.kind === 'ask' && l.by === pid && l.drewCard ? l.drewCard : null;
  }

  function winners(s) {
    const best = Math.max(...s.order.map((p) => won(s, p).length));
    return s.order.filter((p) => won(s, p).length === best);
  }

  const Engine = { SET_IDS, setOf, newGame, ask, skip, rejoin, canAsk, publicView, privateDraw, winners, hand, won };
  if (typeof module !== 'undefined' && module.exports) module.exports = Engine;
  else (root.BL = root.BL || {}).Engine = Engine;
})(typeof window !== 'undefined' ? window : globalThis);
