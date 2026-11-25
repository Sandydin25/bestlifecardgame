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
  const order = ['money', 'food', 'family', 'friends', 'goals', 'health', 'humor', 'education', 'knowledge', 'belief', 'freedom', 'grit'];
  const slots = order.map((id) => {
    const s = BL.set(id);
    const slot = BL.el('div', 'slot');
    const c = BL.card(id);
    c.tabIndex = 0;
    c.setAttribute('role', 'button');
    c.append(BL.el('div', 'glare'));
    const lab = BL.el('div', 'slot-label', `<i style="--c:${s.bg}"></i>${s.name}`);
    slot.append(c, lab);
    grid.append(slot);
    const flip = () => c.classList.toggle('flipped');
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

  let timers = [], shuffling = false;
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
  const SAYINGS = BL.SETS.filter((s) => !s.placeholder);
  const refill = () => {
    bag = SAYINGS.map((s) => s.id);
    for (let i = bag.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [bag[i], bag[j]] = [bag[j], bag[i]]; }
  };
  async function draw() {
    if (drawing) return;
    drawing = true;
    if (!bag.length) refill();
    const id = bag.pop();
    const s = BL.set(id);
    drawnCount++;
    const c = BL.card(id, { cls: 'down' });
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
    quoteEl.innerHTML = s.quote.split(' ').map((w, i) => `<span class="w" style="transition-delay:${i * 45}ms">${w}</span>`).join(' ');
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
  }), { rootMargin: matchMedia('(max-width: 900px)').matches ? '-64% 0px -26% 0px' : '-45% 0px -45% 0px' });
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
      stk.append(BL.flatBack());
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
