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
  const T = (ms) => sleep((reduce ? Math.min(ms, 250) : ms) * SPEED);
  const D = (ms) => ms * SPEED;
  if (SPEED < 1) window.__BLG = () => G; // test hooks, only with ?fast

  function newGame() {
    const deck = [];
    for (const id of ORDER) for (let k = 0; k < 4; k++) deck.push({ key: id + k, set: id, el: null });
    for (let i = deck.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [deck[i], deck[j]] = [deck[j], deck[i]]; }
    handYou.innerHTML = ''; handThem.innerHTML = ''; setsYou.innerHTML = ''; setsThem.innerHTML = '';
    G = { deck, hands: [[], []], won: [[], []], turn: 0, busy: true, memory: new Set() };
    return G;
  }
  const elFor = (c) => {
    if (!c.el) {
      c.el = BL.card(c.set, { mini: true, cls: 'gcard', label: false });
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
    const gw = Math.round(Math.max(50, Math.min(98, bw / 10.5)));
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
    const m = G ? G.hands[1].length : 7, av2 = handThem.clientWidth - 16;
    let w2 = gw;
    if (m > 1 && w2 + (m - 1) * w2 * 0.2 > av2) w2 = Math.max(26, av2 / (1 + (m - 1) * 0.2));
    const ov2 = m > 1 ? Math.max(-w2 * 0.8, Math.min(-w2 * 0.45, (av2 - m * w2) / (m - 1))) : 0;
    handThem.style.setProperty('--gw', w2 + 'px');
    handThem.style.setProperty('--ov2', ov2 + 'px');
  }
  const groupsOf = (p) => new Set(G.hands[p].map((c) => c.set)).size;

  function render() {
    G.hands[0].sort((a, b) => ORDER.indexOf(a.set) - ORDER.indexOf(b.set));
    let prev = null;
    for (const c of G.hands[0]) {
      const e = elFor(c);
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
    if (G.turn !== 0 || G.busy || !G.hands[0].length) return;
    askBar.append(Object.assign(document.createElement('span'), { className: 'prompt', textContent: 'Help me with…' }));
    const counts = {};
    G.hands[0].forEach((c) => (counts[c.set] = (counts[c.set] || 0) + 1));
    Object.keys(counts).sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b)).forEach((id) => {
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
  async function flip(mutate, { stagger = 0, from = null, order = null } = {}) {
    const els = Array.from(board.querySelectorAll('.hand .gcard'));
    const first = new Map(els.map((e) => [e, e.getBoundingClientRect()]));
    const wasDown = new Map(els.map((e) => [e, e.classList.contains('down')]));
    mutate();
    render();
    const origin = from || pileEl.getBoundingClientRect();
    const anims = [];
    let k = 0;
    const idx = order ? new Map(order.map((e, i) => [e, i])) : null;
    board.querySelectorAll('.hand .gcard').forEach((e) => {
      const si = idx && idx.has(e) ? idx.get(e) : k;
      const last = e.getBoundingClientRect();
      const f = first.get(e) || origin;
      const isNew = !first.has(e);
      const mine = e.parentElement === handYou;
      // cards arriving in your hand flip face up on the way
      if (mine && (isNew || wasDown.get(e))) {
        e.classList.add('down');
        const delay = isNew ? si * stagger + 160 : 120;
        setTimeout(() => e.classList.remove('down'), reduce ? 0 : D(delay));
      }
      const dx = f.left - last.left, dy = f.top - last.top;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
      if (reduce) return;
      e.style.zIndex = 10;
      const a = e.animate(
        [{ transform: `translate(${dx}px, ${dy}px) rotate(${isNew ? -8 : 0}deg)` }, { transform: 'none' }],
        { duration: D(620), delay: isNew ? D(si * stagger) : 0, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'backwards' }
      );
      if (isNew) k++;
      anims.push(a.finished.then(() => (e.style.zIndex = '')));
    });
    await Promise.all(anims);
  }

  function say(html) {
    msg.innerHTML = `<div>${html}</div>`;
    if (!reduce) msg.animate([{ transform: 'scale(.96)', opacity: 0.4 }, { transform: 'none', opacity: 1 }], { duration: 260, easing: 'ease-out' });
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
      say(p === 0 ? `<b>SET!</b> You collected all four <em>${NAME(id)}</em> cards.` : `<b>SET!</b> Smiley collected all four <em>${NAME(id)}</em> cards.`);
      if (!reduce) {
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
      await T(700);
    }
  }
  const over = () => G.won[0].length + G.won[1].length === 12;

  async function drawFor(p, { stagger = 0 } = {}) {
    if (!G.deck.length) return null;
    const c = G.deck.pop();
    await flip(() => G.hands[p].push(c), { stagger });
    return c;
  }

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
    const c = await drawFor(0);
    if (c) {
      if (c.set === set) {
        say(`You drew ${AN(set)} <em>${NAME(set)}</em>, just what you asked for! Go again.`);
        await T(900);
        await checkSets(0);
        if (over()) return finish();
        return yourTurn(true);
      }
      say(`You drew ${AN(c.set)} <em>${NAME(c.set)}</em>.`);
      await T(900);
      await checkSets(0);
      if (over()) return finish();
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
        await drawFor(0);
        await checkSets(0);
        if (over()) return finish();
      } else {
        G.turn = 1; render();
        return aiTurn();
      }
    }
    G.busy = false;
    if (!again) say('Your turn! Tap a card or pick a set below.');
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
    kbd = !!e && e.detail === 0;
    const id = ++gameId;
    newGame();
    startScreen.classList.remove('on');
    endScreen.classList.remove('on');
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
    G.busy = true;
    render();
    const a = G.won[0].length, b = G.won[1].length;
    $('#endTitle').textContent = a > b ? 'You win!' : a < b ? 'Smiley wins!' : 'It’s a tie!';
    $('#endText').textContent = `You collected ${a} set${a === 1 ? '' : 's'}, Smiley collected ${b}. ${a >= b ? 'That’s living your Best Life!' : 'Ask again next time!'}`;
    endScreen.classList.add('on');
    $('#againBtn').focus({ preventScroll: true });
    if (a >= b) for (let i = 0; i < 3; i++) setTimeout(() => confetti(BL.SETS[(i * 5) % 12], 120), i * 250);
  }

  /* ---------- confetti ---------- */
  function confetti(s, n) {
    if (reduce) return;
    const cv = document.createElement('canvas');
    cv.className = 'confetti';
    cv.width = innerWidth * devicePixelRatio; cv.height = innerHeight * devicePixelRatio;
    cv.style.width = '100%'; cv.style.height = '100%';
    document.body.append(cv);
    const ctx = cv.getContext('2d');
    ctx.scale(devicePixelRatio, devicePixelRatio);
    const cols = [s.bg, '#ffe31a', '#ffffff', s.title, '#f37a1f'];
    const r = board.getBoundingClientRect();
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

  if (SPEED < 1) window.__BLtest = { render: () => render(), elFor };
  $('#startBtn').addEventListener('click', start);
  $('#againBtn').addEventListener('click', start);
  addEventListener('resize', () => G && sizeCards());
  board.style.setProperty('--gw', '82px');
})();
