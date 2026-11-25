/* Best Life — a quick two-player, Go Fish–style round against "Smiley".
   Simplified: 48 Best Life cards (no Action cards). */
(function () {
  'use strict';
  const BL = window.BL;
  const { sleep, reduce } = BL.util;
  const $ = (s) => document.querySelector(s);
  const NAME = (id) => BL.set(id).name;
  const AN = (id) => (/^[AEIOU]/.test(NAME(id)) ? 'an' : 'a');
  const ORDER = BL.SETS.map((s) => s.id);

  const board = $('#board');
  const handYou = $('#handYou'), handThem = $('#handThem');
  const pileEl = $('#pile'), pileWrap = $('#pileWrap'), pileCount = $('#pileCount');
  const msg = $('#msg'), askBar = $('#askBar');
  const setsYou = $('#setsYou'), setsThem = $('#setsThem');
  const tagYou = $('#tagYou'), tagThem = $('#tagThem');
  const youInfo = $('#youInfo'), themInfo = $('#themInfo');
  const startScreen = $('#startScreen'), endScreen = $('#endScreen');

  for (let i = 0; i < 3; i++) pileEl.append(BL.card('money', { cls: 'down', label: false }));
  pileEl.setAttribute('aria-hidden', 'true');
  handThem.setAttribute('aria-hidden', 'true');
  handYou.setAttribute('aria-hidden', 'true');
  board.tabIndex = -1;

  let G = null, gameId = 0, starting = false, kbd = false;
  // ?fast speeds everything up (used for automated play-testing)
  const SPEED = /[?&]fast\b/.test(location.search) ? 0.04 : 1;
  // Every pause checks the round is still the same one, so "Menu" mid-game stops Smiley cleanly.
  const ABORT = { abort: true };
  const T = (ms) => { const g = G; return sleep(ms * SPEED).then(() => { if (!g || G !== g) throw ABORT; }); };
  const D = (ms) => ms * SPEED;
  const sound = (k) => BL.sound && BL.sound(k);
  BL.touch = matchMedia('(hover: none)').matches;
  addEventListener('unhandledrejection', (e) => { if (e.reason === ABORT || (e.reason && e.reason.name === 'AbortError')) e.preventDefault(); });
  if (SPEED < 1) window.__BLG = () => G; // test hooks, only with ?fast

  function newGame() {
    const deck = [];
    for (const id of ORDER) for (let k = 0; k < 4; k++) deck.push({ key: id + k, set: id, el: null });
    for (let i = deck.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [deck[i], deck[j]] = [deck[j], deck[i]]; }
    handYou.innerHTML = ''; handThem.innerHTML = ''; setsYou.innerHTML = ''; setsThem.innerHTML = '';
    G = { deck, hands: [[], []], won: [[], []], turn: 0, busy: true, memory: new Set() };
    return G;
  }
  // each game card is a real card from the deck, with its own Connecting Point
  const quoteOf = (c) => { const q = BL.set(c.set).quotes; return q[(parseInt(c.key.slice(c.set.length), 10) || 0) % q.length]; };
  const elFor = (c) => {
    if (!c.el) {
      c.el = BL.card(c.set, { cls: 'gcard', label: false, quote: quoteOf(c) });
      const mine = () => c.el.parentElement === handYou;
      c.el.addEventListener('click', (e) => { if (mine()) { kbd = false; humanAsk(c.set); } });
      c.el.addEventListener('pointerenter', () => { if (mine()) highlight(c.set, true); });
      c.el.addEventListener('pointerleave', () => { if (mine()) highlight(c.set, false); });
    }
    return c.el;
  };
  function highlight(set, on) {
    if (!G || G.busy || G.turn !== 0) on = false;
    handYou.querySelectorAll('.gcard').forEach((e) => e.classList.toggle('hl', on && e.dataset.set === set));
  }

  /* ---------- layout / render ---------- */
  function sizeCards() {
    const bw = board.clientWidth;
    // bigger cards when the board is full screen on a phone (lots of vertical room)
    const gw = Math.round(Math.max(50, Math.min(98, bw / (BL.fs && BL.fs.on && bw < 700 ? 6.2 : 10.5))));
    board.style.setProperty('--gw', gw + 'px');
    // your hand: shrink cards if even maximum overlap would not fit
    const n = G ? G.hands[0].length : 7, groups = G ? groupsOf(0) : 1;
    const avail = handYou.clientWidth - 16, vis = 0.24, gapK = 0.16;
    let w = gw;
    const need = (x) => x + (n - 1) * x * vis + (groups - 1) * x * gapK;
    if (n > 1 && need(w) > avail) w = Math.max(30, avail / (1 + (n - 1) * vis + (groups - 1) * gapK));
    const gap = w * gapK;
    const ov = n > 1 ? Math.max(-w * (1 - vis), Math.min(6, (avail - n * w - (groups - 1) * gap) / (n - 1))) : 0;
    handYou.style.setProperty('--gw', w + 'px');
    handYou.style.setProperty('--ov', ov + 'px');
    handYou.style.setProperty('--gap', gap + 'px');
    // Smiley's hand (card backs) always overlaps
    const m = G ? G.hands[1].length : 7, av2 = handThem.clientWidth - 16 - (m > 2 ? gw * 0.8 : 0); // room for the fan's tilt
    let w2 = gw;
    if (m > 1 && w2 + (m - 1) * w2 * 0.2 > av2) w2 = Math.max(26, av2 / (1 + (m - 1) * 0.2));
    const ov2 = m > 1 ? Math.max(-w2 * 0.8, Math.min(-w2 * 0.45, (av2 - m * w2) / (m - 1))) : 0;
    handThem.style.setProperty('--gw', w2 + 'px');
    handThem.style.setProperty('--ov2', ov2 + 'px');
    fanOut(handThem);
  }
  /** spread a row of face-down cards into a gentle fan (pivot above, like a hand held across the table) */
  function fanOut(row) {
    const cards = row.querySelectorAll('.gcard'), m = cards.length, mid = (m - 1) / 2, step = Math.min(5, 24 / Math.max(1, m));
    cards.forEach((e, i) => { e.style.rotate = `${(mid - i) * step}deg`; });
  }
  BL.fanOut = fanOut;
  const groupsOf = (p) => new Set(G.hands[p].map((c) => c.set)).size;

  function render() {
    G.hands[0].sort((a, b) => ORDER.indexOf(a.set) - ORDER.indexOf(b.set));
    let prev = null;
    for (const c of G.hands[0]) {
      const e = elFor(c);
      e.style.rotate = ''; // (a card Smiley handed over was part of his fan)
      e.classList.toggle('gstart', prev !== null && prev !== c.set);
      prev = c.set;
      handYou.append(e);
    }
    for (const c of G.hands[1]) {
      const e = elFor(c);
      e.classList.add('down');
      e.classList.remove('gstart', 'hl');
      handThem.append(e);
    }
    // anything no longer in a hand gets removed
    const live = new Set(G.hands[0].concat(G.hands[1]).map((c) => c.el));
    board.querySelectorAll('.hand .gcard').forEach((e) => { if (!live.has(e)) e.remove(); });
    sizeCards();
    youInfo.textContent = `${G.hands[0].length} card${G.hands[0].length === 1 ? '' : 's'} · ${G.won[0].length} set${G.won[0].length === 1 ? '' : 's'}`;
    themInfo.textContent = `${G.hands[1].length} card${G.hands[1].length === 1 ? '' : 's'} · ${G.won[1].length} set${G.won[1].length === 1 ? '' : 's'}`;
    pileCount.textContent = G.deck.length;
    pileWrap.classList.toggle('empty', G.deck.length === 0);
    tagYou.classList.toggle('turn', G.turn === 0);
    tagThem.classList.toggle('turn', G.turn === 1);
    renderAskBar();
  }

  function renderAskBar() {
    askBar.innerHTML = '';
    const counts = {};
    G.hands[0].forEach((c) => (counts[c.set] = (counts[c.set] || 0) + 1));
    const ids = Object.keys(counts).sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b));
    handYou.classList.toggle('locked', G.turn !== 0 || G.busy);
    if (G.turn !== 0 || G.busy || !G.hands[0].length) {
      // not your turn: an easy-to-read summary of your hand
      if (ids.length && !G.done) askBar.innerHTML = `<span class="hand-sum">Your cards: ${ids.map((id) => `<b>${NAME(id)}</b>${counts[id] > 1 ? ` ×${counts[id]}` : ''}`).join(' · ')}<small class="peek-tip">${BL.touch ? 'Press and hold a card to read it' : 'Point at a card to read it'}</small></span>`;
      return;
    }
    askBar.append(Object.assign(document.createElement('span'), { className: 'prompt', textContent: 'Help me with…' }));
    ids.forEach((id) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.innerHTML = `<img src="${BL.iconURI(BL.set(id).icon)}" alt="">${NAME(id)}<span style="opacity:.55">×${counts[id]}</span>`;
      b.addEventListener('click', (e) => { kbd = e.detail === 0; humanAsk(id); });
      b.addEventListener('pointerenter', () => highlight(id, true));
      b.addEventListener('pointerleave', () => highlight(id, false));
      askBar.append(b);
    });
    if (kbd && (document.activeElement === document.body || document.activeElement === board || board.contains(document.activeElement))) {
      askBar.querySelector('button')?.focus({ preventScroll: true });
    }
  }

  /** FLIP every card in the hands across a state change. New cards fly from the Help Stack. */
  async function flip(mutate, { stagger = 0, from = null, order = null, grow = false, onStart = null } = {}) {
    const g = G;
    const els = Array.from(board.querySelectorAll('.hand .gcard'));
    const first = new Map(els.map((e) => [e, e.getBoundingClientRect()]));
    const wasDown = new Map(els.map((e) => [e, e.classList.contains('down')]));
    mutate();
    render();
    const origin = from || pileEl.getBoundingClientRect();
    const anims = [];
    let k = 0;
    const idx = order ? new Map(order.map((e, i) => [e, i])) : null;
    const arrivals = [];
    board.querySelectorAll('.hand .gcard').forEach((e) => {
      const si = idx && idx.has(e) ? idx.get(e) : k;
      const last = e.getBoundingClientRect();
      const f = first.get(e) || origin;
      const isNew = !first.has(e);
      const mine = e.parentElement === handYou;
      // cards arriving in your hand flip face up on the way (a revealed card is already face up)
      if (mine && (isNew ? !grow : wasDown.get(e))) {
        e.classList.add('down');
        const delay = isNew ? si * stagger + 160 : 120;
        setTimeout(() => e.classList.remove('down'), D(delay));
      }
      const dx = f.left - last.left, dy = f.top - last.top;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
      e.style.zIndex = 10;
      const big = grow && isNew;
      if (big) e.style.transformOrigin = '0 0';
      const a = e.animate(
        [{ transform: big ? `translate(${dx}px, ${dy}px) scale(${f.width / last.width})` : `translate(${dx}px, ${dy}px) rotate(${isNew ? -8 : 0}deg)` }, { transform: 'none' }],
        { duration: D(big ? 560 : 620), delay: isNew ? D(si * stagger) : 0, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'backwards' }
      );
      if (big) a.finished.then(() => (e.style.transformOrigin = ''), () => {});
      if (isNew) { k++; arrivals.push(si); }
      anims.push(a.finished.then(() => (e.style.zIndex = '')));
    });
    if (onStart) onStart();
    // a soft flick per card dealt or drawn; one for a hand-over
    if (grow) { /* the reveal already flicked */ }
    else if (arrivals.length) arrivals.slice(0, 14).forEach((si) => setTimeout(() => sound('flick'), D(si * stagger)));
    else if (anims.length) sound('flick');
    await Promise.all(anims);
    if (G !== g) throw ABORT;
  }

  function say(html) {
    msg.innerHTML = `<div>${html}</div>`;
    msg.animate([{ transform: 'scale(.96)', opacity: 0.4 }, { transform: 'none', opacity: 1 }], { duration: 260, easing: 'ease-out' });
  }

  /* ---------- sets ---------- */
  async function checkSets(p) {
    const counts = {};
    G.hands[p].forEach((c) => (counts[c.set] = (counts[c.set] || 0) + 1));
    const done = Object.keys(counts).filter((id) => counts[id] === 4);
    for (const id of done) {
      const cards = G.hands[p].filter((c) => c.set === id);
      const target = (p === 0 ? setsYou : setsThem).getBoundingClientRect();
      if (p === 1) cards.forEach((c) => c.el.classList.remove('down'));
      // celebrate with one of the set's Connecting Points
      const cp = BL.set(id).quotes[(G.won[0].length + G.won[1].length) % 4];
      say(`<b>SET!</b> ${p === 0 ? 'You' : 'Smiley'} collected all four <em>${NAME(id)}</em> cards.<span class="cp">“${cp}”</span>`);
      sound('set');
      {
        await T(p === 1 ? 500 : 150);
        await Promise.all(cards.map((c, i) => {
          const r = c.el.getBoundingClientRect();
          const dx = target.left + target.width - 20 - (r.left + r.width / 2), dy = target.top + 20 - (r.top + r.height / 2);
          c.el.style.zIndex = 20;
          return c.el.animate([
            { transform: 'none' },
            { transform: `translate(${dx * 0.3}px, ${dy * 0.3 - 40}px) scale(1.1) rotate(${(i - 1.5) * 8}deg)`, offset: 0.35 },
            { transform: `translate(${dx}px, ${dy}px) scale(.35)`, opacity: 0.2 },
          ], { duration: D(750), delay: D(i * 70), easing: 'cubic-bezier(.4,0,.2,1)', fill: 'forwards' }).finished;
        }));
      }
      await flip(() => { G.hands[p] = G.hands[p].filter((c) => c.set !== id); cards.forEach((c) => c.el.remove()); G.won[p].push(id); });
      const s = BL.set(id);
      const badge = BL.el('div', 'won', `<img src="${BL.iconURI(s.icon)}" alt="">`);
      badge.style.background = s.bg;
      badge.title = s.name;
      (p === 0 ? setsYou : setsThem).append(badge);
      G.memory.delete(id);
      render();
      if (p === 0) confetti(s, 50);
      await T(1600); // time to read the Connecting Point
    }
  }
  const over = () => G.won[0].length + G.won[1].length === 12;

  async function drawFor(p, { stagger = 0, note = null } = {}) {
    if (!G.deck.length) return null;
    const c = G.deck.pop();
    if (p === 0) {
      const big = await reveal(c.set, quoteOf(c), pileEl.getBoundingClientRect(), D(1600), note && (() => say(note(c))));
      await flip(() => G.hands[p].push(c), { from: big.getBoundingClientRect(), grow: true, onStart: () => big.remove() });
    } else await flip(() => G.hands[p].push(c), { stagger });
    return c;
  }

  /** a card flies from `from`, flips face up big in the middle of the board, and waits there */
  async function reveal(setId, quote, from, hold, onShow) {
    const g = G;
    const root = document.fullscreenElement || document.body;
    const br = board.getBoundingClientRect();
    const W = Math.round(Math.min(210, br.width * 0.46, innerHeight * 0.3));
    const c = BL.card(setId, { cls: 'card-pop down', label: false, quote });
    c.style.setProperty('--cw', W + 'px');
    // just below the message box (so "You drew…" stays readable), on the way down to the hand
    const mr = (board.hidden ? $('#oMsg') : msg).getBoundingClientRect();
    const x = br.left + br.width / 2 - W / 2, y = Math.max(8, Math.min(innerHeight - W * 1.4 - 8, mr.bottom + 10));
    c.style.left = x + 'px';
    c.style.top = y + 'px';
    root.append(c);
    c.animate([{ transform: `translate(${from.left - x}px, ${from.top - y}px) scale(${from.width / W}) rotate(-8deg)` }, { transform: 'none' }],
      { duration: D(460), easing: 'cubic-bezier(.2,.8,.2,1)' });
    sound('flick');
    if (onShow) onShow();
    // flip face up in flat 2D (Safari ghosts overlapping 3D flips): squeeze to an edge, swap faces, open up
    const inner = c.querySelector('.card-inner');
    setTimeout(() => {
      const shut = inner.animate([{ transform: 'scaleX(1)' }, { transform: 'scaleX(0)' }], { duration: D(150), easing: 'ease-in', fill: 'forwards' });
      shut.finished.then(() => {
        c.classList.remove('down');
        inner.animate([{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }], { duration: D(220), easing: 'cubic-bezier(.2,.8,.2,1)' });
        shut.cancel(); // let go of the squeezed end state
      }, () => {});
    }, D(240));
    try { await sleep(hold); } finally { if (G !== g) c.remove(); }
    if (G !== g) throw ABORT;
    return c;
  }
  BL.reveal = (setId, quote, from, hold) => reveal(setId, quote, from, hold);

  /* ---------- turns ---------- */
  async function humanAsk(set) {
    if (!G || G.busy || G.turn !== 0) return;
    if (!G.hands[0].some((c) => c.set === set)) return;
    G.busy = true;
    highlight(set, false);
    if (kbd) board.focus({ preventScroll: true });
    render();
    G.memory.add(set);
    say(`You: <span class="say">“Help me with <em>${NAME(set)}</em>!”</span>`);
    await T(1000);
    const got = G.hands[1].filter((c) => c.set === set);
    if (got.length) {
      say(`Smiley: “Here you go!” <br>You got <b>${got.length}</b> <em>${NAME(set)}</em> card${got.length > 1 ? 's' : ''}. Ask again!`);
      await flip(() => { G.hands[1] = G.hands[1].filter((c) => c.set !== set); G.hands[0].push(...got); });
      await checkSets(0);
      if (over()) return finish();
      return yourTurn(true);
    }
    if (!G.deck.length) {
      say(`Smiley: “Sorry, no <em>${NAME(set)}</em>.” <br>The Help Stack is empty, so it’s Smiley’s turn.`);
      await T(1300);
    } else {
      say(`Smiley: “Sorry, no <em>${NAME(set)}</em>.” <br>Off to the Help Stack!`);
      await T(1100);
    }
    const c = await drawFor(0, { note: (d) => (d.set === set ? `You drew ${AN(set)} <em>${NAME(set)}</em>, just what you asked for! Go again.` : `You drew ${AN(d.set)} <em>${NAME(d.set)}</em>.`) });
    if (c) {
      await T(350);
      await checkSets(0);
      if (over()) return finish();
      if (c.set === set) return yourTurn(true);
    }
    G.turn = 1;
    render();
    await aiTurn();
  }

  async function yourTurn(again) {
    G.turn = 0;
    if (!G.hands[0].length) {
      if (G.deck.length) {
        say('You’re out of cards, so you draw from the Help Stack.');
        await T(700);
        await drawFor(0, { note: (d) => `You drew ${AN(d.set)} <em>${NAME(d.set)}</em>.` });
        await checkSets(0);
        if (over()) return finish();
      } else {
        G.turn = 1; render();
        return aiTurn();
      }
    }
    G.busy = false;
    if (!again) { say('<b>Your turn!</b> Tap a card or pick a set below.'); sound('turn'); }
    render();
  }

  function aiPick() {
    const counts = {};
    G.hands[1].forEach((c) => (counts[c.set] = (counts[c.set] || 0) + 1));
    const ids = Object.keys(counts);
    const known = ids.filter((id) => G.memory.has(id));
    if (known.length && Math.random() < 0.8) return known[Math.floor(Math.random() * known.length)];
    if (Math.random() < 0.3) return ids[Math.floor(Math.random() * ids.length)];
    const max = Math.max(...ids.map((id) => counts[id]));
    const best = ids.filter((id) => counts[id] === max);
    return best[Math.floor(Math.random() * best.length)];
  }

  async function aiTurn() {
    G.turn = 1; G.busy = true; render();
    for (;;) {
      if (over()) return finish();
      if (!G.hands[1].length) {
        if (!G.deck.length) break;
        say('Smiley is out of cards and draws from the Help Stack.');
        await T(800);
        await drawFor(1);
        await checkSets(1);
        continue;
      }
      await T(900);
      const set = aiPick();
      say(`Smiley looks right at you… <br><span class="say">“Help me with <em>${NAME(set)}</em>!”</span>`);
      await T(1300);
      const got = G.hands[0].filter((c) => c.set === set);
      if (got.length) {
        say(`You hand over <b>${got.length}</b> <em>${NAME(set)}</em> card${got.length > 1 ? 's' : ''}. Smiley goes again.`);
        await flip(() => { G.hands[0] = G.hands[0].filter((c) => c.set !== set); G.hands[1].push(...got); });
        G.memory.delete(set);
        await checkSets(1);
        continue;
      }
      if (!G.deck.length) {
        say(`You don’t have any <em>${NAME(set)}</em>. <br>The Help Stack is empty, so it’s your turn.`);
        await T(1300);
        break;
      }
      say(`You don’t have any <em>${NAME(set)}</em>. <br>Smiley goes to the Help Stack.`);
      await T(1000);
      const c = await drawFor(1);
      const drewAsked = !!(c && c.set === set);
      if (drewAsked) {
        say(`Smiley drew ${AN(set)} <em>${NAME(set)}</em>, just what they asked for! Smiley goes again.`);
        await T(1000);
      }
      await checkSets(1);
      if (drewAsked) continue;
      break;
    }
    if (over()) return finish();
    await T(500);
    yourTurn(false);
  }

  async function start(e) {
    if (starting) return;
    starting = true;
    BL.stats.hit('soloGamesStarted');
    if (e && e.isTrusted !== false) BL.fs.enter();
    kbd = !!e && e.detail === 0;
    const id = ++gameId;
    newGame();
    startScreen.classList.remove('on');
    endScreen.classList.remove('on');
    syncBar();
    board.focus({ preventScroll: true });
    render();
    say('Shuffling and dealing 7 cards each…');
    await T(450);
    if (id !== gameId) return;
    const dealt = [];
    await flip(() => {
      for (let r = 0; r < 7; r++) for (const p of [1, 0]) { const c = G.deck.pop(); G.hands[p].push(c); dealt.push(elFor(c)); }
    }, { stagger: 85, order: dealt });
    await T(250);
    await checkSets(0);
    await checkSets(1);
    starting = false;
    yourTurn(false);
  }

  function finish() {
    BL.stats.hit('soloGamesFinished');
    G.busy = true;
    G.done = true;
    render();
    syncBar();
    const a = G.won[0].length, b = G.won[1].length;
    $('#endTitle').textContent = a > b ? 'You win!' : a < b ? 'Smiley wins!' : 'It’s a tie!';
    $('#endText').textContent = `You collected ${a} set${a === 1 ? '' : 's'}, Smiley collected ${b}. ${a >= b ? 'That’s living your Best Life!' : 'Ask again next time!'}`;
    // a Connecting Point from one of the sets you won (or any set)
    const pool = G.won[0].length ? G.won[0] : ORDER;
    const cpSet = BL.set(pool[Math.floor(Math.random() * pool.length)]);
    $('#endCp').innerHTML = `“${cpSet.quotes[Math.floor(Math.random() * 4)]}”<small>${cpSet.name} Connecting Point</small>`;
    endScreen._share = a > b ? `I just beat Smiley ${a} to ${b} at Best Life! Can you beat Smiley too? 🏆`
      : a < b ? `Smiley beat me ${b} to ${a} at Best Life. Can you do better?` : `Smiley and I tied ${a} to ${b} at Best Life! Your turn.`;
    endScreen.classList.add('on');
    $('#againBtn').focus({ preventScroll: true });
    setTimeout(() => sound(a >= b ? 'win' : 'end'), 250);
    if (a >= b) for (let i = 0; i < 3; i++) setTimeout(() => confetti(BL.SETS[(i * 5) % 12], 120), i * 250);
  }

  /** stop the current round right away (the stage bar's Menu button) */
  function quit() {
    gameId++;
    G = null;
    starting = false;
    handYou.innerHTML = ''; handThem.innerHTML = ''; setsYou.innerHTML = ''; setsThem.innerHTML = ''; askBar.innerHTML = '';
    msg.innerHTML = '';
    BL.playMenu();
  }

  /* ---------- confetti ---------- */
  function confetti(s, n, around) {
    if (reduce) return;
    const cv = document.createElement('canvas');
    cv.className = 'confetti';
    cv.width = innerWidth * devicePixelRatio; cv.height = innerHeight * devicePixelRatio;
    cv.style.width = '100%'; cv.style.height = '100%';
    (document.fullscreenElement || document.body).append(cv); // native full screen only shows the stage
    const ctx = cv.getContext('2d');
    ctx.scale(devicePixelRatio, devicePixelRatio);
    const cols = [s.bg, '#ffe31a', '#ffffff', s.title, '#f37a1f'];
    const r = (around || board).getBoundingClientRect();
    const P = Array.from({ length: n }, () => ({
      x: r.left + r.width / 2 + (Math.random() - 0.5) * 120, y: r.top + r.height * 0.45,
      vx: (Math.random() - 0.5) * 12, vy: -6 - Math.random() * 10, s: 5 + Math.random() * 6,
      a: Math.random() * 6, va: (Math.random() - 0.5) * 0.4, c: cols[Math.floor(Math.random() * cols.length)],
    }));
    const t0 = performance.now();
    (function tick(now) {
      ctx.clearRect(0, 0, innerWidth, innerHeight);
      for (const p of P) {
        p.vy += 0.35; p.vx *= 0.99; p.x += p.vx; p.y += p.vy; p.a += p.va;
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.a); ctx.fillStyle = p.c;
        ctx.fillRect(-p.s / 2, -p.s / 3, p.s, p.s * 0.66); ctx.restore();
      }
      if (now - t0 < 2600) requestAnimationFrame(tick); else cv.remove();
    })(t0);
  }

  /** share a line of text (results), or copy it when the device can't share */
  BL.shareText = async (text, btn) => {
    const url = `${location.origin}${location.pathname}`;
    const done = (t) => { if (!btn) return; const old = btn.textContent; btn.textContent = t; setTimeout(() => (btn.textContent = old), 2600); };
    try { if (navigator.share) { await navigator.share({ title: 'Best Life', text, url }); return; } }
    catch (e) { if (e && e.name === 'AbortError') return; }
    try { await navigator.clipboard.writeText(`${text}\n${url}`); done('Copied! Paste it in a text'); }
    catch (e) { done('Couldn’t share on this device'); }
  };

  if (SPEED < 1) window.__BLtest = { render: () => render(), elFor };
  $('#startBtn').addEventListener('click', start);
  $('#againBtn').addEventListener('click', start);
  $('#shareBtn').addEventListener('click', (e) => BL.shareText(endScreen._share || 'Come play Best Life!', e.currentTarget));
  BL.confetti = confetti;

  /* ---------- full-screen play + boards + online ---------- */
  const stage = $('#playStage'), oboard = $('#oboard');
  const canNativeFS = !!(document.fullscreenEnabled && stage.requestFullscreen);
  // while the game fills the screen, the rest of the page can't take focus (keyboard / screen readers)
  function inertOutside(on) {
    const keep = new Set();
    for (let n = stage; n && n !== document.body; n = n.parentElement) keep.add(n);
    for (let n = stage; n && n !== document.body; n = n.parentElement) {
      for (const sib of n.parentElement.children) if (!keep.has(sib) && sib.tagName !== 'SCRIPT') sib.inert = on;
    }
  }
  BL.fs = {
    on: false,
    enter() {
      if (BL.fs.on) return;
      BL.fs.on = true;
      inertOutside(true);
      stage.classList.add('fs');
      document.documentElement.classList.add('fs-lock');
      if (canNativeFS && !document.fullscreenElement) stage.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
      setTimeout(() => { addEventListener('resize', fit); fit(); }, 60);
    },
    exit() {
      if (!BL.fs.on) return;
      BL.fs.on = false;
      inertOutside(false);
      stage.classList.remove('fs');
      document.documentElement.classList.remove('fs-lock');
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      removeEventListener('resize', fit);
      setTimeout(fit, 60);
      stage.scrollIntoView({ block: 'center' });
    },
  };
  function fit() { if (G) sizeCards(); dispatchEvent(new Event('bl-fit')); }
  document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement && BL.fs.on) BL.fs.exit(); });
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && BL.fs.on && !document.fullscreenElement) BL.fs.exit(); });
  $('#fsBtn').addEventListener('click', () => BL.fs.enter());
  $('#fsExit').addEventListener('click', () => BL.fs.exit());

  BL.showBoard = (which) => {
    const online = which === 'online';
    oboard.hidden = !online;
    board.hidden = online;
    stage.classList.toggle('is-online', online);
    syncBar();
  };
  BL.playMenu = () => {
    BL.showBoard('solo');
    endScreen.classList.remove('on');
    startScreen.classList.add('on');
    syncBar();
    (startScreen.querySelector('button') || board).focus({ preventScroll: true });
  };
  $('#menuBtn').addEventListener('click', () => BL.playMenu());

  /* the stage bar's left button: "Menu" during a solo round, "Leave game" / "End game" online.
     Anything that throws away a game in progress needs a second tap. */
  const stBack = $('#stBack');
  let armT = 0;
  function syncBar(force) {
    if (!force && stBack.classList.contains('armed')) return;
    clearTimeout(armT);
    stBack.classList.remove('armed');
    const online = stage.classList.contains('is-online');
    if (online) {
      const info = BL.online ? BL.online.leaveInfo() : { label: 'Leave game' };
      stBack.hidden = !(BL.online && BL.online.room);
      stBack.innerHTML = `<span aria-hidden="true">✕</span> ${info.label}`;
    } else {
      stBack.hidden = !(G && !G.done) || startScreen.classList.contains('on');
      stBack.innerHTML = '<span aria-hidden="true">←</span> Menu';
    }
  }
  BL.syncBar = syncBar;
  stBack.addEventListener('click', () => {
    const online = stage.classList.contains('is-online');
    const confirm = online ? (BL.online ? BL.online.leaveInfo().confirm : null) : (G && !G.done ? 'Tap again to quit this round' : null);
    if (confirm && !stBack.classList.contains('armed')) {
      stBack.classList.add('armed');
      stBack.textContent = confirm;
      clearTimeout(armT);
      armT = setTimeout(() => syncBar(true), 4000);
      return;
    }
    stBack.classList.remove('armed');
    if (online) { if (BL.online) BL.online.leave(); BL.playMenu(); } else quit();
  });

  let onlineP = null;
  BL.loadOnline = () => {
    if (BL.online) return Promise.resolve(BL.online);
    if (!onlineP) {
      onlineP = new Promise((res, rej) => {
        const sc = document.createElement('script');
        sc.src = 'js/online.js';
        sc.onload = () => (BL.online ? res(BL.online) : rej(new Error('online failed')));
        sc.onerror = () => { onlineP = null; rej(new Error('Couldn’t load online play. Check your connection.')); };
        document.body.append(sc);
      });
    }
    return onlineP;
  };
  async function openOnline(kind, code) {
    if (!window.BL_FIREBASE) {
      BL.showBoard('solo');
      startScreen.classList.add('on');
      const m = startScreen.querySelector('.menu-card:last-child p');
      if (m) m.textContent = 'Online play is almost ready. Check back soon!';
      return;
    }
    BL.showBoard('online');
    BL.fs.enter();
    try {
      const o = await BL.loadOnline();
      kind === 'join' ? o.openJoin(code) : o.openCreate();
    } catch (err) {
      $('#oLobby').innerHTML = `<div class="o-panel"><h3>Hmm…</h3><p>${err.message}</p><button class="btn btn-y" type="button" id="oBackErr">Back</button></div>`;
      $('#oLobby').classList.add('on');
      $('#oBackErr').addEventListener('click', () => BL.playMenu());
    }
  }
  $('#createBtn').addEventListener('click', () => openOnline('create'));
  $('#joinBtn').addEventListener('click', () => openOnline('join'));
  // invite links: bestlifecards.com/?join=ABCD
  const joinCode = (new URLSearchParams(location.search).get('join') || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
  if (joinCode.length === 4) {
    document.getElementById('play').scrollIntoView({ behavior: 'auto' });
    openOnline('join', joinCode);
  }
  addEventListener('resize', () => G && sizeCards());
  board.style.setProperty('--gw', '82px');

  /* Phones have no hover: press and hold a card in your hand to see it big (and read its Connecting Point).
     A long press doesn't count as a tap, so it never asks for the set by accident. */
  BL.peekable = (hand) => {
    let t = 0, card = null;
    // cards near an edge grow inward so the whole card stays on screen
    const aim = (c) => {
      const r = c.getBoundingClientRect(), edge = r.width * 0.75;
      c.style.transformOrigin = r.left < edge ? '0% 100%' : r.right > innerWidth - edge ? '100% 100%' : '';
    };
    hand.addEventListener('pointerover', (e) => { const c = e.target.closest('.gcard'); if (c && e.pointerType === 'mouse') aim(c); });
    const end = () => { clearTimeout(t); if (card) card.classList.remove('peek'); card = null; };
    hand.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse') return;
      const c = e.target.closest('.gcard');
      if (!c) return;
      end();
      t = setTimeout(() => { card = c; aim(c); c.classList.add('peek'); hand._peeked = true; }, 380);
    });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach((k) => hand.addEventListener(k, end));
    hand.addEventListener('pointermove', (e) => { if (!card && (Math.abs(e.movementX) > 6 || Math.abs(e.movementY) > 6)) clearTimeout(t); });
    hand.addEventListener('contextmenu', (e) => { if (e.target.closest('.gcard')) e.preventDefault(); });
    hand.addEventListener('click', (e) => { if (hand._peeked) { hand._peeked = false; e.stopPropagation(); e.preventDefault(); } }, true);
  };
  BL.peekable(handYou);
})();
