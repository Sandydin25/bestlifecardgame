/* Best Life — hero scroll choreography, gallery, wisdom deck, how-to scenes */
(function () {
  'use strict';
  const BL = window.BL;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const seg = (p, a, b) => clamp((p - a) / (b - a));
  const eio = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const eout = (t) => 1 - Math.pow(1 - t, 3);
  const esine = (t) => -(Math.cos(Math.PI * t) - 1) / 2;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  BL.util = { clamp, lerp, seg, eio, eout, sleep, reduce };

  // fill any <img data-icon="...">
  $$('img[data-icon]').forEach((i) => (i.src = BL.iconURI(i.dataset.icon)));

  /* ================================================================== */
  /*  NAV                                                               */
  /* ================================================================== */
  const nav = $('#nav');
  const onScrollNav = () => nav.classList.toggle('solid', scrollY > 40);
  addEventListener('scroll', onScrollNav, { passive: true });
  onScrollNav();

  // On Guard: the red and blue arrows sweep across the screen, then Sandy's tilting game opens
  const goOnGuard = (e) => {
    const a = e.target.closest('a[href="onguard/"]');
    if (!a || e.defaultPrevented || e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    const w = BL.el('div', 'og-wipe', '<i class="r"><b>ON</b></i><i class="b"><b>GUARD</b></i>');
    w.setAttribute('aria-hidden', 'true');
    document.body.append(w);
    try { sessionStorage.setItem('og-from', 'bestlife'); } catch (err) {}
    setTimeout(() => { location.href = a.href; }, 640);
  };
  document.addEventListener('click', goOnGuard);
  addEventListener('pageshow', (e) => { if (e.persisted) document.querySelectorAll('.og-wipe').forEach((w) => w.remove()); });

  // phones: a Menu button opens a sheet with every section
  const navBtn = $('#navMenu'), sheet = $('#navSheet');
  const setSheet = (open) => { sheet.hidden = !open; navBtn.setAttribute('aria-expanded', String(open)); };
  navBtn.addEventListener('click', () => {
    setSheet(sheet.hidden);
    if (!sheet.hidden) sheet.querySelector('a').focus({ preventScroll: true });
  });
  sheet.addEventListener('click', (e) => {
    const a = e.target.closest('a');
    if (!a) return;
    setSheet(false);
    if (a.hasAttribute('data-maker')) { e.preventDefault(); BL.openMaker && BL.openMaker(); }
  });
  document.addEventListener('click', (e) => { if (!sheet.hidden && !sheet.contains(e.target) && !navBtn.contains(e.target)) setSheet(false); });
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && !sheet.hidden) { setSheet(false); navBtn.focus(); } });
  addEventListener('resize', () => { if (!sheet.hidden && innerWidth > 760) setSheet(false); });

  /* ================================================================== */
  /*  REVEAL                                                            */
  /* ================================================================== */
  const rio = new IntersectionObserver((es) => es.forEach((e) => {
    if (e.isIntersecting) { e.target.classList.add('in'); rio.unobserve(e.target); }
  }), { threshold: 0.15 });
  $$('.reveal').forEach((e) => rio.observe(e));

  /* ================================================================== */
  /*  SETS GALLERY                                                      */
  /* ================================================================== */
  const grid = $('#setGrid');
  let timers = [], shuffling = false;
  const order = ['money', 'food', 'family', 'friends', 'goals', 'health', 'humor', 'education', 'knowledge', 'belief', 'freedom', 'grit'];
  const slots = order.map((id) => {
    const s = BL.set(id);
    const slot = BL.el('div', 'slot');
    const c = BL.card(id);
    c.tabIndex = 0;
    c.setAttribute('role', 'button');
    c.append(BL.el('div', 'glare'));
    const lab = BL.el('div', 'slot-label', `<i style="--c:${s.bg}"></i>${s.name}<span class="qn">1 of 4</span>`);
    slot.append(c, lab);
    grid.append(slot);
    // tap: the card flips over and comes back showing the set's next Connecting Point
    let qi = 0, busy = false;
    const flip = async () => {
      if (busy || shuffling) return;
      if (c.classList.contains('flipped')) { c.classList.remove('flipped'); return; }
      busy = true;
      c.classList.add('flipped');
      await sleep(430);
      qi = (qi + 1) % s.quotes.length;
      c.querySelector('.f-cp p').textContent = s.quotes[qi];
      lab.querySelector('.qn').textContent = `${qi + 1} of 4`;
      c.setAttribute('aria-label', `${s.name} card ${qi + 1} of 4: ${s.quotes[qi]}`);
      c.classList.remove('flipped');
      await sleep(500);
      busy = false;
    };
    c.addEventListener('click', flip);
    c.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); flip(); } });
    if (!reduce) {
      c.addEventListener('pointermove', (e) => {
        if (e.pointerType !== 'mouse') return;
        const r = c.getBoundingClientRect();
        const px = (e.clientX - r.left) / r.width, py = (e.clientY - r.top) / r.height;
        c.style.transform = `rotateY(${(px - 0.5) * 18}deg) rotateX(${(0.5 - py) * 16}deg) translateZ(20px)`;
        c.style.transition = 'transform .1s';
        c.style.setProperty('--gx', px * 100 + '%');
        c.style.setProperty('--gy', py * 100 + '%');
      });
      c.addEventListener('pointerleave', () => { c.style.transition = ''; c.style.transform = ''; });
    }
    return slot;
  });

  const actionRow = $('#actionRow');
  BL.ACTIONS.forEach((a) => {
    const slot = BL.el('div', 'slot');
    const c = BL.actionCard(a.id);
    c.tabIndex = 0;
    c.setAttribute('role', 'button');
    const flip = () => c.classList.toggle('flipped');
    c.addEventListener('click', flip);
    c.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); flip(); } });
    slot.append(c, BL.el('div', 'slot-label', `<i style="--c:#d93a2e"></i>Action card <span class="qn">× ${a.count}</span>`));
    actionRow.append(slot);
  });

  // deal-in animation when the grid first appears
  let dealt = false;
  new IntersectionObserver((es, ob) => {
    if (!es[0].isIntersecting || dealt) return;
    dealt = true; ob.disconnect();
    const gr = grid.getBoundingClientRect();
    const cx = gr.left + gr.width / 2, cy = gr.top + Math.min(gr.height / 2, 300);
    slots.forEach((sl, i) => {
      const r = sl.getBoundingClientRect();
      const dx = cx - (r.left + r.width / 2), dy = cy - (r.top + r.height / 2);
      sl.animate([
        { transform: `translate(${dx}px, ${dy}px) rotate(${(i % 2 ? 1 : -1) * (8 + i)}deg) scale(.7)`, opacity: 0 },
        { opacity: 1, offset: 0.2 },
        { transform: 'none', opacity: 1 },
      ], { duration: 900, delay: i * 70, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'backwards' });
    });
  }, { threshold: 0.12 }).observe(grid);

  const clearTimers = () => { timers.forEach(clearTimeout); timers = []; };
  const stagger = (fn, i, ms) => timers.push(setTimeout(fn, i * ms));
  $('#flipAllBtn').addEventListener('click', () => {
    if (shuffling) return;
    clearTimers();
    const cards = slots.map((s) => s.querySelector('.card'));
    const anyFront = cards.some((c) => !c.classList.contains('flipped'));
    cards.forEach((c, i) => stagger(() => c.classList.toggle('flipped', anyFront), i, 60));
  });
  $('#shuffleBtn').addEventListener('click', async () => {
    if (shuffling) return;
    shuffling = true;
    clearTimers();
    const cards = slots.map((s) => s.querySelector('.card'));
    cards.forEach((c) => c.classList.add('flipped')); await sleep(650);
    const first = new Map(slots.map((s) => [s, s.getBoundingClientRect()]));
    const r = Math.random;
    const arr = slots.slice();
    for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; }
    arr.forEach((s) => grid.append(s));
    slots.splice(0, slots.length, ...arr);
    {
      await Promise.all(arr.map((s, i) => {
        const a = first.get(s), b = s.getBoundingClientRect();
        return s.animate([
          { transform: `translate(${a.left - b.left}px, ${a.top - b.top}px)` },
          { transform: `translate(${(a.left - b.left) / 2}px, ${(a.top - b.top) / 2 - 40}px) rotate(${(r() - 0.5) * 20}deg)` },
          { transform: 'none' },
        ], { duration: 700, delay: i * 25, easing: 'cubic-bezier(.4,0,.2,1)' }).finished;
      }));
      arr.forEach((s, i) => stagger(() => s.querySelector('.card').classList.remove('flipped'), i, 60));
      await sleep(arr.length * 60 + 300);
    }
    shuffling = false;
  });

  /* ================================================================== */
  /*  WISDOM DECK                                                       */
  /* ================================================================== */
  const deckBtn = $('#wisDeck');
  for (let i = 0; i < 5; i++) {
    const c = BL.card('money', { cls: 'down', label: false });
    c.style.transform = `translate(${i * 2}px, ${-i * 2}px)`;
    deckBtn.append(c);
  }
  const drawn = $('#wisDrawn');
  const quoteEl = $('#wisQuote');
  let bag = [], drawnCount = 0, drawing = false;
  const SAYINGS = BL.SETS.flatMap((s) => s.quotes.map((q) => ({ id: s.id, q })));
  const refill = () => {
    bag = SAYINGS.slice();
    for (let i = bag.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [bag[i], bag[j]] = [bag[j], bag[i]]; }
  };
  async function draw() {
    if (drawing) return;
    drawing = true;
    if (!bag.length) refill();
    const pick = bag.pop(), id = pick.id;
    const s = BL.set(id);
    drawnCount++;
    const c = BL.card(id, { cls: 'down', quote: pick.q });
    drawn.append(c);
    const dr = deckBtn.getBoundingClientRect(), wr = drawn.getBoundingClientRect();
    const rot = (Math.random() - 0.5) * 10;
    const dx = dr.left - wr.left + 8, dy = dr.top - wr.top - 8;
    c.style.transform = `translate(${dx}px, ${dy}px) rotate(-4deg)`;
    c.getBoundingClientRect();
    c.style.transition = 'transform .9s cubic-bezier(.2,.8,.2,1)';
    requestAnimationFrame(() => {
      c.style.transform = `translate(0,0) rotate(${rot}deg)`;
      c.classList.remove('down');
    });
    // keep the pile small
    const kids = drawn.querySelectorAll('.card');
    if (kids.length > 4) kids[0].remove();
    // quote
    quoteEl.classList.remove('on');
    await sleep(280);
    quoteEl.innerHTML = pick.q.split(' ').map((w, i) => `<span class="w" style="transition-delay:${i * 45}ms">${w}</span>`).join(' ');
    $('#wisTagImg').src = BL.iconURI(s.icon);
    $('#wisTagName').textContent = s.name;
    $('#wisTag').style.background = s.bg;
    $('#wisSrc').textContent = `Connecting Point from the ${s.name[0] + s.name.slice(1).toLowerCase()} set`;
    const total = SAYINGS.length;
    $('#wisCount').textContent = `${((drawnCount - 1) % total) + 1} of ${total} sayings drawn${drawnCount > total ? ' (reshuffled)' : ''}`;
    requestAnimationFrame(() => requestAnimationFrame(() => quoteEl.classList.add('on')));
    $('#wisBtn').textContent = 'Draw another';
    await sleep(700);
    drawing = false;
  }
  quoteEl.classList.add('on');
  $('#wisTagImg').src = BL.iconURI('grin');
  deckBtn.addEventListener('click', draw);
  $('#wisBtn').addEventListener('click', draw);

  /* ================================================================== */
  /*  HOW TO PLAY — scenes                                               */
  /* ================================================================== */
  const scenes = $$('#sceneWrap .scene');
  const steps = $$('#howSteps .step');
  let curScene = -1;
  const sceneHooks = [];
  function showScene(i) {
    if (i === curScene) return;
    const prev = curScene;
    curScene = i;
    scenes.forEach((s, j) => s.classList.toggle('on', j === i));
    steps.forEach((s, j) => s.classList.toggle('on', j === i));
    if (sceneHooks[prev] && sceneHooks[prev].stop) sceneHooks[prev].stop();
    if (sceneHooks[i] && sceneHooks[i].start) sceneHooks[i].start();
  }
  const sio = new IntersectionObserver((es) => es.forEach((e) => {
    if (e.isIntersecting) showScene(+e.target.dataset.scene);
  }), { rootMargin: matchMedia('(max-width: 900px) and (min-height: 561px)').matches ? '-64% 0px -26% 0px' : '-45% 0px -45% 0px' }); // phone portrait has the scene stuck on top
  steps.forEach((s) => sio.observe(s));
  // only animate while the how-to section is on screen
  let howVisible = false;
  new IntersectionObserver((es) => {
    howVisible = es[0].isIntersecting;
    const h = sceneHooks[curScene];
    if (!h) return;
    if (howVisible) h.start && h.start(); else h.stop && h.stop();
  }).observe($('#how'));

  // scene 0 — anatomy of the deck
  {
    const anat = $('#anat');
    const ids = BL.SETS.map((s) => s.id);
    ids.forEach((id, i) => {
      const stk = BL.el('div', 'stk');
      for (let k = 0; k < 4; k++) stk.append(BL.flatCard(id, true));
      stk.style.transitionDelay = i * 55 + 'ms';
      anat.append(stk);
    });
    for (let i = 0; i < 4; i++) {
      const stk = BL.el('div', 'stk act');
      stk.append(BL.flatAction(i < 2 ? 'turn' : 'take2'));
      stk.style.transitionDelay = (12 + i) * 55 + 'ms';
      anat.append(stk);
    }
    sceneHooks[0] = {};
  }

  // scene 1 — object: collect 4 MONEY
  {
    const obj = $('#obj');
    const tally = $('#tally');
    const cards = [], marks = [];
    for (let k = 0; k < 4; k++) {
      const c = BL.flatCard('money', true);
      obj.append(c);
      cards.push(c);
      const m = BL.el('span', '', `<img src="${BL.iconURI('money')}" alt="">`);
      tally.append(m);
      marks.push(m);
    }
    const scat = [[-150, -60, -40], [170, -40, 35], [-160, 120, 25], [160, 140, -30]];
    const fan = [[-60, 18, -16], [-20, 6, -5], [20, 6, 5], [60, 18, 16]];
    let run = 0;
    const reset = () => {
      obj.classList.remove('done');
      cards.forEach((c, k) => { c.style.transition = 'none'; c.style.transform = `translate(${scat[k][0]}%, ${scat[k][1]}%) rotate(${scat[k][2]}deg) scale(.9)`; c.style.opacity = 0.0; });
      marks.forEach((m) => m.classList.remove('got'));
    };
    async function play(id) {
      while (run === id) {
        reset();
        await sleep(400);
        for (let k = 0; k < 4; k++) {
          if (run !== id) return;
          const c = cards[k];
          c.style.transition = 'transform .8s cubic-bezier(.2,.8,.2,1), opacity .3s';
          c.style.opacity = 1;
          c.style.transform = `translate(${fan[k][0]}%, ${fan[k][1]}%) rotate(${fan[k][2]}deg)`;
          await sleep(500);
          marks[k].classList.add('got');
        }
        await sleep(400);
        if (run !== id) return;
        obj.classList.add('done');
        await sleep(2400);
      }
    }
    reset();
    sceneHooks[1] = { start() { if (reduce) { cards.forEach((c, k) => { c.style.opacity = 1; c.style.transform = `translate(${fan[k][0]}%, ${fan[k][1]}%) rotate(${fan[k][2]}deg)`; }); marks.forEach((m) => m.classList.add('got')); obj.classList.add('done'); return; } play(++run); }, stop() { run++; } };
  }

  // scene 2 — the deal
  {
    const deal = $('#deal');
    deal.innerHTML = `<div class="deal-ctrl"><span class="lbl">How many players?</span><div class="seg" role="group" aria-label="Number of players">${[2, 3, 4, 5, 6].map((n) => `<button type="button" aria-pressed="${n === 4}" data-n="${n}">${n}</button>`).join('')}</div></div>
      <div class="deal-table"><div class="deal-stack"></div><div class="deal-help"><b>52</b>Help Stack</div></div><div class="scene-cap" id="dealCap"></div>`;
    const table = $('.deal-table', deal);
    const stack = $('.deal-stack', deal);
    for (let i = 0; i < 3; i++) stack.append(BL.flatBack());
    const helpN = $('.deal-help b', deal);
    const cap = $('#dealCap');
    const avatars = ['grin', 'hugface', 'medal', 'apple', 'money', 'globe'];
    let n = 4, run = 0;
    async function doDeal(id) {
      $$('.deal-seat, .fly', table).forEach((e) => e.remove());
      const per = n <= 4 ? 7 : 5;
      cap.innerHTML = `<b>${n}</b> players → <b>${per}</b> cards each · <b>${52 - n * per}</b> left in the Help Stack`;
      const seats = [];
      for (let i = 0; i < n; i++) {
        const a = Math.PI / 2 + (i / n) * Math.PI * 2;
        const x = 50 + Math.cos(a) * 46, y = 50 + Math.sin(a) * 46;
        const s = BL.el('div', 'deal-seat' + (i === 0 ? ' dealer' : ''), `<img src="${BL.iconURI(avatars[i])}" alt=""><span class="n">0</span>`);
        s.style.left = x + '%'; s.style.top = y + '%';
        table.append(s);
        seats.push({ el: s, x, y, n: 0 });
      }
      let left = 52;
      helpN.textContent = left;
      await sleep(350);
      for (let r = 0; r < per; r++) {
        for (let i = 0; i < n; i++) {
          if (run !== id) return;
          const seat = seats[(i + 1) % n]; // dealing starts to the dealer's left
          const f = BL.el('div', 'fly');
          f.append(BL.flatBack());
          f.style.left = '50%'; f.style.top = '50%';
          table.append(f);
          const dx = ((seat.x - 50) / 100) * table.offsetWidth, dy = ((seat.y - 50) / 100) * table.offsetHeight;
          f.animate([{ transform: 'translate(0,0) rotate(0)' }, { transform: `translate(${dx * 0.82}px, ${dy * 0.82}px) rotate(${(Math.random() - 0.5) * 40 + 180}deg)` }], { duration: 320, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'forwards' })
            .finished.then(() => { f.remove(); seat.n++; $('.n', seat.el).textContent = seat.n; });
          left--;
          helpN.textContent = left;
          await sleep(55);
        }
      }
    }
    $$('.seg button', deal).forEach((b) => b.addEventListener('click', () => {
      n = +b.dataset.n;
      $$('.seg button', deal).forEach((x) => x.setAttribute('aria-pressed', x === b));
      doDeal(++run);
    }));
    sceneHooks[2] = { start() { doDeal(++run); }, stop() { run++; } };
  }

  // scene 3 — "Help me with…"
  {
    const ask = $('#ask');
    const faceSVG = (acc) => `<svg viewBox="0 0 100 100"><defs><radialGradient id="fg" cx=".45" cy=".35" r=".7"><stop offset="0" stop-color="#fff47a"/><stop offset=".6" stop-color="#fcd116"/><stop offset="1" stop-color="#f0a500"/></radialGradient></defs>
      <circle cx="50" cy="52" r="44" fill="url(#fg)" stroke="#6a4600" stroke-width="1.5"/>
      <ellipse cx="35" cy="44" rx="10" ry="12" fill="#fff" stroke="#6a4600" stroke-width="1"/><ellipse cx="65" cy="44" rx="10" ry="12" fill="#fff" stroke="#6a4600" stroke-width="1"/>
      <g class="pupil"><circle cx="35" cy="45" r="5.5" fill="#2a1a0a"/><circle cx="65" cy="45" r="5.5" fill="#2a1a0a"/></g>
      <path d="M32 68 Q50 82 68 68" stroke="#3a2608" stroke-width="4" fill="none" stroke-linecap="round"/>${acc}</svg>`;
    const accs = [
      '<g fill="none" stroke="#1d1c4d" stroke-width="3"><circle cx="35" cy="44" r="13"/><circle cx="65" cy="44" r="13"/><path d="M48 44 L52 44 M22 42 L10 38 M78 42 L90 38"/></g>',
      '<path d="M50 12 L36 2 L36 22 Z M50 12 L64 2 L64 22 Z" fill="#e8358a" stroke="#7a0f44" stroke-width="1.5"/><circle cx="50" cy="12" r="4" fill="#c21a6a"/>',
      '<path d="M10 30 C14 8 86 8 90 30 Z" fill="#3a4fae" stroke="#1d2a6a" stroke-width="1.5"/><path d="M84 30 L100 34 L88 26 Z" fill="#3a4fae"/>',
      '<path d="M30 14 C36 4 44 10 50 6 C56 10 64 4 70 14" stroke="#8a4c2a" stroke-width="4" fill="none" stroke-linecap="round"/>',
    ];
    const ppl = [
      { name: 'Sam', x: 17, y: 50 }, { name: 'Rosie', x: 50, y: 23 }, { name: 'Max', x: 83, y: 50 }, { name: 'Lou', x: 50, y: 74 },
    ];
    const gaze = BL.el('div', 'gaze');
    ask.append(gaze);
    ppl.forEach((pp, i) => {
      const w = BL.el('div', 'who', `<div class="face-av">${faceSVG(accs[i])}</div><div class="name">${pp.name}</div>`);
      w.style.left = pp.x + '%'; w.style.top = pp.y + '%';
      ask.append(w);
      pp.el = w;
      pp.pupil = $('.pupil', w);
    });
    const bubble = BL.el('div', 'bubble');
    ask.append(bubble);
    const capEl = $('#askCap');
    let run = 0, turn = 0;
    const sets = ['MONEY', 'FOOD', 'FAMILY', 'FRIENDS', 'GOALS', 'HUMOR', 'HEALTH', 'GRIT'];
    async function loop(id) {
      while (run === id) {
        const A = ppl[turn % 4];
        const others = ppl.filter((q) => q !== A);
        const B = others[Math.floor(Math.random() * 3)];
        const sname = sets[Math.floor(Math.random() * sets.length)];
        const set = BL.SETS.find((s) => s.name === sname);
        ppl.forEach((q) => { q.el.classList.remove('asker', 'target'); q.pupil.style.transform = ''; });
        bubble.classList.remove('on');
        gaze.classList.remove('on');
        await sleep(500);
        if (run !== id) return;
        // look!
        A.el.classList.add('asker');
        const W = ask.offsetWidth, Hh = ask.offsetHeight;
        const ax = (A.x / 100) * W, ay = (A.y / 100) * Hh, bx = (B.x / 100) * W, by = (B.y / 100) * Hh;
        const ang = Math.atan2(by - ay, bx - ax);
        A.pupil.style.transform = `translate(${Math.cos(ang) * 4}px, ${Math.sin(ang) * 4}px)`;
        B.pupil.style.transform = `translate(${-Math.cos(ang) * 4}px, ${-Math.sin(ang) * 4}px)`;
        const dist = Math.hypot(bx - ax, by - ay);
        gaze.style.left = ax + Math.cos(ang) * 44 + 'px';
        gaze.style.top = ay + Math.sin(ang) * 44 + 'px';
        gaze.style.width = Math.max(0, dist - 88) + 'px';
        gaze.style.transform = `rotate(${ang}rad)`;
        gaze.classList.add('on');
        B.el.classList.add('target');
        capEl.innerHTML = `${A.name} looks right at ${B.name}…`;
        await sleep(700);
        if (run !== id) return;
        const narrow = W < 520;
        bubble.innerHTML = (narrow ? `<small>${A.name}</small>` : '') + `Help me with <u>${sname}</u>!`;
        const below = !narrow && A.y < 35;
        bubble.classList.toggle('below', below);
        bubble.classList.toggle('center', narrow);
        const bw = bubble.offsetWidth;
        const left = narrow ? W / 2 : clamp(ax, bw / 2 + 8, W - bw / 2 - 8);
        bubble.style.left = left + 'px';
        bubble.style.setProperty('--tail', narrow ? '0px' : clamp(ax - left, -bw / 2 + 20, bw / 2 - 20) + 'px');
        const half = A.el.offsetHeight / 2;
        bubble.style.top = (narrow ? Hh * 0.5 + bubble.offsetHeight / 2 : below ? ay + half + 30 : ay - half - 14) + 'px';
        bubble.classList.add('on');
        if (reduce) { capEl.innerHTML = `“Help me with <b>${sname}</b>!”`; return; }
        capEl.innerHTML = `“Help me with <b>${sname}</b>!”`;
        await sleep(1300);
        if (run !== id) return;
        // hand over a card
        const g = BL.el('div', 'give');
        g.append(BL.flatCard(set.id, true));
        g.style.left = bx + 'px'; g.style.top = by + 'px';
        g.style.transform = 'scale(.4)'; g.style.opacity = 0;
        ask.append(g);
        g.getBoundingClientRect();
        g.style.opacity = 1; g.style.transform = 'scale(1) rotate(-6deg)';
        await sleep(350);
        g.style.left = ax + 'px'; g.style.top = ay + 'px';
        g.style.transform = 'scale(.6) rotate(8deg)';
        capEl.innerHTML = `${B.name} helps with <b>${sname}</b>!`;
        await sleep(1100);
        g.style.opacity = 0;
        setTimeout(() => g.remove(), 400);
        await sleep(600);
        turn++;
      }
    }
    sceneHooks[3] = { start() { loop(++run); }, stop() { run++; } };
  }
  showScene(0);

  /* ================================================================== */
  /*  MAKE YOUR OWN CARD                                                */
  /* ================================================================== */
  const maker = $('#maker');
  if (maker) {
    const sw = $('#mkSwatches'), nameIn = $('#mkName'), quoteIn = $('#mkQuote'), cardBox = $('#mkCard'), note = $('#mkNote');
    let style = 'family';
    BL.SETS.forEach((s) => {
      const b = BL.el('button', '', `<img src="${BL.iconURI(s.icon)}" alt="">`);
      b.type = 'button';
      b.dataset.set = s.id;
      b.style.background = s.bg;
      b.setAttribute('aria-label', `${s.name.charAt(0)}${s.name.slice(1).toLowerCase()} style`);
      b.setAttribute('aria-pressed', String(s.id === style));
      sw.append(b);
    });
    // long names shrink to fit the white band, like the printed cards
    const meas = document.createElement('canvas').getContext('2d');
    const titleSize = (base, text) => {
      meas.font = '400 100px "Archivo Black"';
      const w = meas.measureText(text).width / 100;
      return Math.min(base.fs, 72 / (w + Math.max(0, text.length - 1) * base.ls));
    };
    const tidy = (t, max) => t.replace(/\s+/g, ' ').slice(0, max).trim();
    const custom = () => {
      const base = BL.set(style);
      const name = tidy(nameIn.value.toUpperCase(), 12) || base.name;
      const quote = tidy(quoteIn.value, 64) || base.quote;
      return Object.assign({}, base, { name, quote, fs: titleSize(base, name) });
    };
    const keyOf = (s) => `${style}|${s.name}|${s.quote}`;
    let pic = null, picKey = '', picT = 0, painter = null;
    const loadPainter = () => painter || (painter = new Promise((res, rej) => {
      const sc = document.createElement('script');
      sc.src = 'js/maker.js';
      sc.onload = () => (BL.paintPoster ? res() : rej(new Error('painter')));
      sc.onerror = () => { painter = null; rej(new Error('Couldn’t load. Check your connection.')); };
      document.body.append(sc);
    }));
    async function makePic() {
      await loadPainter();
      const s = custom(), key = keyOf(s);
      if (pic && picKey === key) return pic;
      const canvas = await BL.paintPoster(s);
      const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
      const slug = s.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'card';
      pic = new File([blob], `best-life-${slug}.png`, { type: 'image/png' });
      picKey = key;
      return pic;
    }
    function draw() {
      const s = custom();
      const c = BL.card(style, { label: false });
      c.querySelector('.f-band span').textContent = s.name;
      c.querySelector('.face.front').style.setProperty('--fs', s.fs + 'cqw');
      c.querySelector('.f-cp p').textContent = s.quote;
      c.setAttribute('role', 'img');
      c.setAttribute('aria-label', `Your card: ${s.name}. Connecting Point: ${s.quote}`);
      cardBox.replaceChildren(c);
      $('#mkNameN').textContent = nameIn.value.length;
      $('#mkQuoteN').textContent = quoteIn.value.length;
      // get the picture ready in the background, so "Save picture" can share it straight away
      clearTimeout(picT);
      picT = setTimeout(() => makePic().catch(() => {}), 500);
    }
    sw.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      style = b.dataset.set;
      sw.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      draw();
    });
    nameIn.addEventListener('input', draw);
    quoteIn.addEventListener('input', draw);
    quoteIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') e.preventDefault(); });
    BL.openMaker = () => {
      note.textContent = '';
      if (maker.showModal) maker.showModal(); else maker.setAttribute('open', '');
      draw();
      document.fonts.load('400 20px "Archivo Black"').then(draw, () => {});
    };
    $('#makeBtn').addEventListener('click', () => BL.openMaker());
    function download(file) {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(file);
      a.download = file.name;
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      note.textContent = 'Saved! Look in your downloads.';
    }
    $('#mkSave').addEventListener('click', async () => {
      const s = custom();
      // share right inside the tap when the picture is ready (phones only allow sharing straight after a tap)
      const ready = pic && picKey === keyOf(s) ? pic : null;
      if (!ready) note.textContent = 'Making your picture…';
      let file;
      try { file = ready || (await makePic()); } catch (e) { note.textContent = 'Sorry, that didn’t work. Please try again.'; return; }
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try { await navigator.share({ files: [file], title: 'My Best Life card' }); note.textContent = ''; return; }
        catch (e) { if (e && e.name === 'AbortError') { note.textContent = ''; return; } }
      }
      download(file);
    });
  }

  /* ================================================================== */
  /*  FOOTER                                                            */
  /* ================================================================== */
  const fi = $('#footIcons');
  BL.SETS.forEach((s) => {
    const i = BL.el('img');
    i.src = BL.iconURI(s.icon);
    i.alt = s.name;
    i.title = s.name;
    fi.append(i);
  });
})();
