/* On Guard — the game page: drawing, input, sound, game flow, practice bot, and online play.
   The physics lives in physics.js (window.OGPhys); online play loads net.js (window.OGNet) on demand.
   Teams: 'r' (Red, the left end) and 'b' (Blue, the right end). */
(function () {
  'use strict';
  const P = window.OGPhys;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const DEG = Math.PI / 180, TAU = Math.PI * 2;
  const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  const app = $('#app');
  const TARGET = 5; // points to win
  const COUNT_T = 3; // countdown before each point
  const GOAL_T = 2.7; // celebration before the next point
  const OTHER = { r: 'b', b: 'r' };
  const TEAM = { r: 'Red', b: 'Blue' };
  const COLOR = { r: '#ff2a3d', b: '#1f6bff' };
  const COLOR_L = { r: '#ff8491', b: '#86a9ff' };
  const COLOR_D = { r: '#d4112a', b: '#0b47d1' };
  const COLOR_DD = { r: '#8e0a1b', b: '#062c86' };
  const TINT = { r: 'rgba(255,42,61,.12)', b: 'rgba(31,107,255,.12)' };
  const HLF = "'Barlow Condensed', 'Arial Narrow', sans-serif";
  const touchy = matchMedia('(pointer: coarse)').matches || (navigator.maxTouchPoints > 0 && matchMedia('(hover: none)').matches);
  const TEST = /[?&]test\b/.test(location.search);
  const NOGL = /[?&]nogl\b/.test(location.search);
  if (!touchy) app.classList.add('no-touch');
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
  };
  /* Each team also has a shape, so the two are easy to tell apart without the colors: Red an arrowhead, Blue a ring. */
  const SYM = {
    r: '<svg class="sym" viewBox="0 0 12 12" aria-hidden="true"><path d="M2.2 1 10.8 6 2.2 11z" fill="currentColor"/></svg>',
    b: '<svg class="sym" viewBox="0 0 12 12" aria-hidden="true"><circle cx="6" cy="6" r="3.8" fill="none" stroke="currentColor" stroke-width="2.5"/></svg>',
  };
  /* Timers that belong to one match: they do nothing if the match was left, restarted or replaced meanwhile. */
  let epoch = 0;
  const later = (fn, ms) => { const e = epoch; return setTimeout(() => { if (e === epoch) fn(); }, ms); };
  const isOnline = () => G.mode === 'host' || G.mode === 'guest';

  /* ================================================================
     Sound: a small Web Audio synth, no files. Off/on with the speaker button (remembered).
     ================================================================ */
  const Snd = (() => {
    const AC = window.AudioContext || window.webkitAudioContext;
    let ctx = null, master = null, nbuf = null, roll = null, on = true;
    try { on = localStorage.getItem('og-sound') !== 'off'; } catch (e) {}
    function init() {
      if (ctx || !AC) return ctx;
      try { if (navigator.audioSession) navigator.audioSession.type = 'ambient'; } catch (e) {}
      try { ctx = new AC(); } catch (e) { return null; }
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14; comp.ratio.value = 4;
      master = ctx.createGain();
      master.gain.value = on ? 0.9 : 0;
      master.connect(comp); comp.connect(ctx.destination);
      nbuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      const d = nbuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      // the marble rolling: looped noise through a low-pass, loudness follows speed
      const src = ctx.createBufferSource(), lp = ctx.createBiquadFilter(), g = ctx.createGain();
      src.buffer = nbuf; src.loop = true;
      lp.type = 'lowpass'; lp.frequency.value = 300; lp.Q.value = 0.7;
      g.gain.value = 0;
      src.connect(lp); lp.connect(g); g.connect(master);
      src.start();
      roll = { lp, g };
      return ctx;
    }
    function unlock() {
      const c = init();
      if (!c || c.state === 'running') return; // already awake: nothing to do (this runs on every tap and key)
      c.resume().catch(() => {});
      const b = c.createBufferSource();
      b.buffer = c.createBuffer(1, 1, 22050);
      b.connect(c.destination);
      b.start(0);
    }
    const live = () => on && ctx && ctx.state === 'running';
    function tone(f, t, dur, type, vol, f2) {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = type || 'sine';
      o.frequency.setValueAtTime(f, t);
      if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(master);
      o.start(t); o.stop(t + dur + 0.03);
    }
    function hiss(t, dur, freq, q, vol, type) {
      const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
      s.buffer = nbuf;
      f.type = type || 'bandpass'; f.frequency.value = freq; f.Q.value = q;
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      s.connect(f); f.connect(g); g.connect(master);
      s.start(t, Math.random() * 1.2, dur + 0.02);
    }
    /** a filtered-noise sweep: the "swish" under banners and the countdown */
    function whoosh(t, dur, f0, f1, vol) {
      const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
      s.buffer = nbuf;
      f.type = 'bandpass'; f.Q.value = 1.4;
      f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(f1, t + dur);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + dur * 0.55);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      s.connect(f); f.connect(g); g.connect(master);
      s.start(t, Math.random() * 1.2, dur + 0.05);
    }
    function thump(t, vol) { tone(130, t, 0.22, 'sine', vol, 42); hiss(t, 0.05, 900, 0.8, vol * 0.5, 'lowpass'); }
    /** a stadium horn: a detuned sawtooth chord through an opening low-pass */
    function horn(t, root, dur, vol) {
      for (const m of [0, 7, 12]) for (const det of [-7, 7]) {
        const o = ctx.createOscillator(), lp = ctx.createBiquadFilter(), g = ctx.createGain();
        o.type = 'sawtooth'; o.frequency.value = N(root + m); o.detune.value = det;
        lp.type = 'lowpass'; lp.Q.value = 2;
        lp.frequency.setValueAtTime(500, t); lp.frequency.exponentialRampToValueAtTime(2800, t + 0.05); lp.frequency.exponentialRampToValueAtTime(1100, t + dur);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(vol, t + 0.025);
        g.gain.setValueAtTime(vol, t + dur * 0.7);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        o.connect(lp); lp.connect(g); g.connect(master);
        o.start(t); o.stop(t + dur + 0.05);
      }
    }
    /** a crowd: band-passed noise layers that wobble, like lots of voices at once */
    function crowd(t, dur, vol) {
      for (const [f, q, v] of [[950, 0.7, 1], [2300, 1.2, 0.55], [430, 0.6, 0.6]]) {
        const s = ctx.createBufferSource(), bp = ctx.createBiquadFilter(), g = ctx.createGain();
        s.buffer = nbuf; s.loop = true;
        bp.type = 'bandpass'; bp.frequency.value = f; bp.Q.value = q;
        const peak = vol * v;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(peak, t + 0.3);
        g.gain.setValueAtTime(peak, t + dur * 0.35);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        const lfo = ctx.createOscillator(), lg = ctx.createGain();
        lfo.frequency.value = 4 + Math.random() * 5; lg.gain.value = peak * 0.3;
        lfo.connect(lg); lg.connect(g.gain);
        s.connect(bp); bp.connect(g); g.connect(master);
        s.start(t, Math.random()); s.stop(t + dur + 0.1); lfo.start(t); lfo.stop(t + dur + 0.1);
      }
    }
    const N = (m) => 440 * Math.pow(2, (m - 69) / 12);
    let lastHit = 0, rollV = -1;
    const S = {
      peg(v) {
        const t = ctx.currentTime; if (t - lastHit < 0.025) return; lastHit = t;
        const vol = clamp(v / 900, 0.03, 0.32), p = 0.92 + Math.random() * 0.16;
        tone(2350 * p, t, 0.07, 'sine', vol); tone(3720 * p, t, 0.05, 'sine', vol * 0.5); hiss(t, 0.02, 5000, 1.2, vol * 0.5);
      },
      wall(v) {
        const t = ctx.currentTime; if (t - lastHit < 0.025) return; lastHit = t;
        const vol = clamp(v / 900, 0.03, 0.3);
        tone(900 + Math.random() * 200, t, 0.05, 'triangle', vol * 0.7); hiss(t, 0.04, 1800, 1, vol * 0.6);
      },
      edge(v) {
        const t = ctx.currentTime; if (t - lastHit < 0.025) return; lastHit = t;
        const vol = clamp(v / 800, 0.04, 0.4);
        tone(150, t, 0.09, 'sine', vol, 90); hiss(t, 0.05, 700, 0.8, vol * 0.7, 'lowpass');
      },
      lever(down) { const t = ctx.currentTime; hiss(t, 0.035, down ? 2600 : 1900, 2.5, down ? 0.22 : 0.12); tone(down ? 320 : 260, t, 0.04, 'square', 0.03); },
      count(n) {
        const t = ctx.currentTime;
        if (n) { whoosh(t, 0.16, 600, 3200, 0.14); tone(N(n === 1 ? 81 : 76), t + 0.05, 0.11, 'square', 0.06); tone(N(n === 1 ? 93 : 88), t + 0.05, 0.14, 'sine', 0.12); thump(t + 0.05, 0.25); }
        else { whoosh(t, 0.22, 400, 4200, 0.2); thump(t + 0.04, 0.4); horn(t + 0.04, 62, 0.42, 0.04); tone(N(98), t + 0.04, 0.4, 'sine', 0.08); }
      },
      drop() { const t = ctx.currentTime; tone(210, t, 0.22, 'sine', 0.35, 70); hiss(t, 0.12, 500, 0.7, 0.35, 'lowpass'); tone(1840, t + 0.09, 0.5, 'sine', 0.06); },
      goal() {
        const t = ctx.currentTime + 0.08;
        whoosh(t - 0.06, 0.3, 300, 5000, 0.28);
        thump(t + 0.18, 0.55);
        horn(t + 0.18, 58, 0.16, 0.05); horn(t + 0.4, 58, 0.62, 0.055);
        crowd(t + 0.12, 2.4, 0.3);
        for (let i = 0; i < 6; i++) tone(3000 + Math.random() * 2500, t + 0.5 + i * 0.06, 0.1, 'sine', 0.035);
      },
      win() {
        const t = ctx.currentTime + 0.1;
        whoosh(t, 0.35, 250, 4500, 0.26); thump(t + 0.25, 0.5);
        horn(t + 0.25, 55, 0.18, 0.05); horn(t + 0.48, 58, 0.18, 0.05); horn(t + 0.72, 62, 0.9, 0.06);
        crowd(t + 0.2, 3.6, 0.36);
      },
      tired() { const t = ctx.currentTime; tone(520, t, 0.25, 'triangle', 0.1, 260); },
      join() { const t = ctx.currentTime; tone(N(76), t, 0.12, 'triangle', 0.15); tone(N(83), t + 0.09, 0.22, 'triangle', 0.15); whoosh(t, 0.2, 800, 3000, 0.08); },
      tap() { const t = ctx.currentTime; tone(N(91), t, 0.035, 'triangle', 0.07); hiss(t, 0.02, 6000, 1, 0.05); },
      swish() { const t = ctx.currentTime; whoosh(t, 0.28, 500, 3800, 0.16); tone(N(84), t + 0.1, 0.08, 'triangle', 0.06); },
    };
    return {
      unlock,
      play(k, a) { if (live()) try { S[k](a); } catch (e) {} },
      /** tests only: run a sound without swallowing errors */
      check(k, a) { if (!init()) return 'no audio'; S[k](a); return ctx.state; },
      roll(speed) {
        if (!roll || !ctx) return;
        const v = live() ? clamp((speed - 30) / 900, 0, 1) : 0;
        if (v === 0 && rollV === 0) return;
        rollV = v;
        const t = ctx.currentTime;
        roll.g.gain.setTargetAtTime(v * 0.09, t, 0.05);
        roll.lp.frequency.setTargetAtTime(180 + v * 700, t, 0.05);
      },
      get on() { return on; },
      get rollV() { return rollV; },
      set(v) {
        on = !!v;
        try { localStorage.setItem('og-sound', on ? 'on' : 'off'); } catch (e) {}
        if (master) master.gain.value = on ? 0.9 : 0;
        if (on) unlock();
        syncSoundBtns();
      },
    };
  })();
  const SPK_ON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 9.5h4L12 5.5v13l-4.5-4h-4z" fill="currentColor"/><path d="M15.5 8.8a4.5 4.5 0 0 1 0 6.4M18 6.3a8 8 0 0 1 0 11.4" fill="none" stroke="currentColor" stroke-width="2.2"/></svg>';
  const SPK_OFF = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 9.5h4L12 5.5v13l-4.5-4h-4z" fill="currentColor"/><path d="m16 9.5 5 5m0-5-5 5" stroke="currentColor" stroke-width="2.2"/></svg>';
  function syncSoundBtns() {
    $$('.sound-row').forEach((b) => { b.textContent = Snd.on ? 'Sound: on' : 'Sound: off'; b.setAttribute('aria-pressed', String(Snd.on)); });
    $$('.sound-btn').forEach((b) => {
      b.innerHTML = Snd.on ? SPK_ON : SPK_OFF;
      b.setAttribute('aria-pressed', String(Snd.on));
      b.setAttribute('aria-label', Snd.on ? 'Sound on' : 'Sound off');
    });
  }
  syncSoundBtns();
  ['pointerdown', 'keydown', 'touchend'].forEach((t) => window.addEventListener(t, () => { if (Snd.on) Snd.unlock(); }, { capture: true, passive: true }));

  /* ================================================================
     Layout: where the board, pads and labels go for each screen.
     Views:  T  title demo
             O  online lobby (board dimmed behind)
             B  same phone, portrait: Red at the bottom, Blue at the top
             C  same phone, landscape: Red on the left, Blue on the right
             D  one player per device, my end at the bottom (phones in portrait, computers)
             E  one player per device on a landscape phone: my end on the left
     ================================================================ */
  const RIM_LIP = 12; // flat white rim lip continuing outward from P.RIM_X / P.RIM_Y to fixed frame
  const TRAY_X = P.RIM_X + RIM_LIP, TRAY_Y = P.RIM_Y + RIM_LIP; // frame's inner opening / tray outer rim
  const FRAME_WALL = 16; // slim outer frame wall like the real box
  const FRAME_X = TRAY_X + FRAME_WALL, FRAME_Y = TRAY_Y + FRAME_WALL;
  const TAB_REACH = P.LEVER_W + 4; // lever tab protrusion past FRAME_X
  const EXT_X = FRAME_X + TAB_REACH + 8, EXT_Y = FRAME_Y + 8; // board's visible half-size in units (frame + levers)
  const CANVAS_X = EXT_X + 44, CANVAS_Y = EXT_Y + 28; // drawn area (room for glows and compensated tabs)
  const DROP_V = 90; // visual tray drop in board units at full corner press
  const FRAME_DEP = 94; // outer frame wall depth in board units (deeper than DROP_V)
  const els = {
    stage: $('#stage'), gl: $('#cvGL'), table: $('#table'), pitch: $('#pitch'), spin: $('#spin'), board: $('#board'), shadow: $('#shadow'),
    well: $('#well'), tray: $('#tray'), base: $('#cvBase'), live: $('#cvLive'), frame: $('#cvFrame'),
    stems: [0, 1, 2, 3].map((c) => $(`.side-slot[data-c="${c}"] .slot-stem`)),
    fx: $('#fx'), slot: $('#titleSlot'), flash: $('#flash'),
    zones: $('#zones'), pads: $('#pads'), hud: $('#hud'), count: $('#count'), banner: $('#banner'), toast: $('#toast'),
    badge: { r: $('#badge-r'), b: $('#badge-b') }, bug: $('#bug'), series: $('#series'), ready: $('#ready'), tips: $('#tips'), menuBtn: $('#menuBtn'), hudSound: $('#hudSound'), codeTag: $('#codeTag'),
  };
  let B3 = null, lastL3 = null; // 3D WebGL board renderer (null in CSS fallback)
  let L = null; // current layout
  let stemTravel = 0;

  function safeArea() {
    const cs = getComputedStyle($('#safe'));
    return { t: parseFloat(cs.paddingTop) || 0, r: parseFloat(cs.paddingRight) || 0, b: parseFloat(cs.paddingBottom) || 0, l: parseFloat(cs.paddingLeft) || 0 };
  }

  function pickView() {
    const vw = app.clientWidth, vh = app.clientHeight;
    if (screen === 'online') return 'O';
    if (screen !== 'game') return 'T';
    if (G.mode === 'local') return vh >= vw ? 'B' : 'C';
    if (touchy && vw > vh) return 'E';
    return 'D';
  }

  function computeLayout() {
    const vw = app.clientWidth, vh = app.clientHeight, sa = safeArea();
    const view = pickView();
    const me = G.me || 'r';
    const lay = { view, vw, vh, sa, theta: 0, pitch: 0, faces: { r: 0, b: 0 }, pads: [], badges: {}, btns: {}, cds: [], bans: [], bug: null };
    let area; // rectangle the board must fit in
    let gap = 132; // room between two pads for the badge
    const strip = (x0, x1, yc, h, cL, cR, face, p) => {
      const pw = Math.min(300, (x1 - x0 - gap) / 2);
      const mid = (x0 + x1) / 2;
      lay.pads.push({ c: cL, p, face, x: mid - gap / 2 - pw, y: yc - h / 2, w: pw, h });
      lay.pads.push({ c: cR, p, face, x: mid + gap / 2, y: yc - h / 2, w: pw, h });
    };
    const column = (xc, w, y0, y1, cT, cB, face, p) => {
      const ph = Math.min(260, (y1 - y0 - gap) / 2);
      const mid = (y0 + y1) / 2;
      lay.pads.push({ c: cT, p, face, x: xc - w / 2, y: mid - gap / 2 - ph, w, h: ph });
      lay.pads.push({ c: cB, p, face, x: xc - w / 2, y: mid + gap / 2, w, h: ph });
    };
    const distU = EXT_X * 2 * 2.1;
    const pitchSpan = (pitch, rot) => {
      const p = pitch * DEG, cp = Math.cos(p), sp = Math.sin(p);
      const pv = (v0, z0) => { const vp = v0 * cp - z0 * sp, zp = v0 * sp + z0 * cp; return vp * distU / (distU - zp); };
      const yTop = rot ? -(FRAME_X + TAB_REACH) : -FRAME_Y;
      const yBot = rot ? (FRAME_X + TAB_REACH) : FRAME_Y;
      const zBot = rot ? -(DROP_V + 10) : -FRAME_DEP;
      return { vTop: pv(yTop, 0), vBot: pv(yBot, zBot) };
    };
    let flankD = false;
    if (view === 'O') {
      area = { x: sa.l + 10, y: sa.t + 10, w: vw - sa.l - sa.r - 20, h: vh - sa.t - sa.b - 20 };
      lay.pitch = 30;
    } else if (view === 'T') {
      const r = els.slot.getBoundingClientRect();
      area = { x: r.left, y: r.top, w: Math.max(60, r.width), h: Math.max(60, r.height) };
      lay.pitch = 28;
    } else if (view === 'B') {
      const hp = clamp(vh * 0.13, 96, 140);
      lay.theta = -90; lay.faces = { r: 0, b: 180 };
      strip(sa.l, vw - sa.r, vh - sa.b - hp / 2, hp, 0, 1, 0, 'r');
      strip(sa.l, vw - sa.r, sa.t + hp / 2, hp, 2, 3, 180, 'b'); // same corners zoneOf() gives a touch up here
      lay.badges = { r: { x: vw / 2, y: vh - sa.b - hp / 2, face: 0 }, b: { x: vw / 2, y: sa.t + hp / 2, face: 180 } };
      area = { x: sa.l + 4, y: sa.t + hp + 4, w: vw - sa.l - sa.r - 8, h: vh - sa.t - sa.b - 2 * hp - 8 };
      lay.btns = { menu: { x: sa.l + 22, y: vh / 2 } };
      lay.cds = [{ x: vw / 2, y: vh * 0.66, face: 0 }, { x: vw / 2, y: vh * 0.34, face: 180 }];
      const bw = Math.min(vw * 0.9, 480);
      lay.bans = [{ x: vw / 2, y: vh * 0.62, face: 0, w: bw }, { x: vw / 2, y: vh * 0.38, face: 180, w: bw }];
    } else if (view === 'C') {
      const wp = clamp(vw * 0.15, 104, 170);
      lay.theta = 0; lay.faces = { r: 90, b: -90 };
      column(sa.l + wp / 2, wp, sa.t, vh - sa.b, 0, 1, 90, 'r');
      column(vw - sa.r - wp / 2, wp, sa.t, vh - sa.b, 2, 3, -90, 'b');
      lay.badges = { r: { x: sa.l + wp / 2, y: vh / 2, face: 90 }, b: { x: vw - sa.r - wp / 2, y: vh / 2, face: -90 } };
      area = { x: sa.l + wp + 4, y: sa.t + 4, w: vw - sa.l - sa.r - 2 * wp - 8, h: vh - sa.t - sa.b - 8 };
      lay.btns = { menu: { x: vw / 2, y: sa.t + 24 } };
      lay.cds = [{ x: vw * 0.36, y: vh / 2, face: 90 }, { x: vw * 0.64, y: vh / 2, face: -90 }];
      const bw = Math.min(vh * 0.9, 440);
      lay.bans = [{ x: vw * 0.335, y: vh / 2, face: 90, w: bw }, { x: vw * 0.665, y: vh / 2, face: -90, w: bw }];
    } else if (view === 'D') {
      lay.theta = me === 'r' ? -90 : 90;
      lay.pitch = 24;
      const H = P.HAND[me];
      const top = vw >= 700 ? 40 : 32;
      lay.bug = { x: vw / 2, y: sa.t + top };
      lay.btns = { menu: { x: sa.l + 26, y: sa.t + top }, sound: { x: vw - sa.r - 26, y: sa.t + top } };
      // wide screens: the board takes the full height and the two pads sit on either side of it
      const sp = pitchSpan(lay.pitch, true);
      const full = { x: sa.l + 6, y: sa.t + top * 2 + 10, w: vw - sa.l - sa.r - 12, h: vh - sa.t - sa.b - top * 2 - 26 };
      const S0 = Math.min(full.w / (EXT_Y * 2 * 1.12), full.h / (sp.vBot - sp.vTop));
      const flank = (vw - 2 * (EXT_Y * S0 * 1.12 + 20)) / 2;
      if (vw >= vh * 1.15 && flank >= 200) {
        flankD = true;
        area = full;
        const pw = Math.min(300, flank - 56), ph = Math.round(clamp(pw * 0.62, 120, 180)), py = vh - sa.b - 30 - ph;
        lay.pads.push({ c: H[0], p: me, face: 0, x: (flank - pw) / 2, y: py, w: pw, h: ph });
        lay.pads.push({ c: H[1], p: me, face: 0, x: vw - flank + (flank - pw) / 2, y: py, w: pw, h: ph });
      } else {
        const hp = clamp(vh * 0.15, 104, 150);
        gap = 12;
        strip(sa.l, vw - sa.r, vh - sa.b - hp / 2, hp, H[0], H[1], 0, me);
        area = { x: sa.l + 6, y: sa.t + top * 2 + 6, w: vw - sa.l - sa.r - 12, h: vh - sa.t - sa.b - hp - top * 2 - 14 };
      }
      lay.cds = [{ x: vw / 2, y: area.y + area.h * 0.45, face: 0 }];
      lay.bans = [{ x: vw / 2, y: area.y + area.h * 0.45, face: 0, w: Math.min(vw * 0.9, 540) }];
    } else { // E
      const wp = clamp(vw * 0.17, 128, 180); // never narrower than the upright score card
      lay.theta = me === 'r' ? 0 : 180;
      const H = P.HAND[me];
      gap = 12;
      column(sa.l + wp / 2, wp, sa.t + 4, vh - sa.b - 4, H[0], H[1], 0, me);
      lay.bug = { x: vw - sa.r - wp / 2, y: vh / 2, vert: true };
      area = { x: sa.l + wp + 4, y: sa.t + 4, w: vw - sa.l - sa.r - 2 * wp - 8, h: vh - sa.t - sa.b - 8 };
      lay.btns = { menu: { x: vw - sa.r - wp / 2 - 26, y: sa.t + 30 }, sound: { x: vw - sa.r - wp / 2 + 26, y: sa.t + 30 } };
      lay.cds = [{ x: area.x + area.w / 2, y: vh / 2, face: 0 }];
      lay.bans = [{ x: area.x + area.w / 2, y: vh / 2, face: 0, w: Math.min(area.w * 0.96, 500) }];
    }
    // fit the board (rotated or not) into the area; a tilted-back view is wider at the near end
    // and projects asymmetrically vertically (near pressed tabs drop further than far tabs rise)
    const rot = Math.abs(lay.theta) === 90;
    const ex = (rot ? EXT_Y : EXT_X) * 2, ey = (rot ? EXT_X : EXT_Y) * 2;
    const near = lay.pitch ? 1.12 : 1;
    if (lay.pitch) {
      const sp = pitchSpan(lay.pitch, rot);
      const padTop = lay.view === 'D' && !flankD ? (vw < 700 ? 20 : 12) : 0;
      const availH = Math.max(40, area.h - padTop);
      lay.S = Math.max(0.05, Math.min(area.w / (ex * near), availH / (sp.vBot - sp.vTop)));
      lay.cx = area.x + area.w / 2;
      lay.cy = area.y + padTop + availH / 2 - ((sp.vTop + sp.vBot) / 2) * lay.S;
    } else {
      lay.S = Math.max(0.05, Math.min(area.w / ex, area.h / ey));
      lay.cx = area.x + area.w / 2;
      lay.cy = area.y + area.h / 2;
    }
    lay.area = area;
    return lay;
  }

  /** Apply a layout. With animate, the board glides from where it was (FLIP). */
  function applyLayout(animate) {
    const old = L;
    L = computeLayout();
    // a different arrangement (the phone was turned): fingers that were down now sit over other levers, so let go
    if (old && old.view !== L.view && (touches.size || keys.size)) releaseAll();
    lastTrayT = ''; lastStemT.fill(''); liveDirty = 30;
    const S = L.S;
    const persp = Math.round(Math.max(EXT_X * 2 * S, 300) * 2.1);
    if (B3) {
      const nextL3 = { vw: L.vw, vh: L.vh, cx: L.cx, cy: L.cy, S, theta: L.theta, pitch: L.pitch, persp, dpr: Math.min(window.devicePixelRatio || 1, 2) };
      B3.layout(nextL3, animate ? lastL3 : null);
      lastL3 = nextL3;
      placeUI();
      return;
    }
    const t = els.table.style;
    t.left = L.cx + 'px'; t.top = L.cy + 'px';
    t.perspective = persp + 'px';
    els.pitch.style.transform = `rotateX(${L.pitch}deg)`;
    els.spin.style.transform = `rotate(${L.theta}deg)`;
    const bw = CANVAS_X * 2 * S, bh = CANVAS_Y * 2 * S;
    Object.assign(els.board.style, { width: bw + 'px', height: bh + 'px', left: -bw / 2 + 'px', top: -bh / 2 + 'px' });
    // fixed outer frame walls (deeper than DROP_V + z0 so the sunken tray and well floor never clip)
    const z0 = Math.max(2, 2.5 * S);
    const fx = (FRAME_X - 8) * S, fy = (FRAME_Y - 8) * S, dep = FRAME_DEP * S + z0 + 3, ox = bw / 2, oy = bh / 2;
    const sides = $$('.side', els.board);
    Object.assign(sides[0].style, { left: ox - fx + 'px', top: oy - fy + 'px', width: 2 * fx + 'px', height: dep + 'px', transformOrigin: '50% 0', transform: 'rotateX(-90deg)' });
    Object.assign(sides[1].style, { left: ox - fx + 'px', top: oy + fy + 'px', width: 2 * fx + 'px', height: dep + 'px', transformOrigin: '50% 0', transform: 'rotateX(-90deg)' });
    Object.assign(sides[2].style, { left: ox - fx + 'px', top: oy - fy + 'px', width: dep + 'px', height: 2 * fy + 'px', transformOrigin: '0 50%', transform: 'rotateY(90deg)' });
    Object.assign(sides[3].style, { left: ox + fx + 'px', top: oy - fy + 'px', width: dep + 'px', height: 2 * fy + 'px', transformOrigin: '0 50%', transform: 'rotateY(90deg)' });
    // vertical lever slots in the two end walls (.side-w, .side-e): local x=0 is top rim, x=dep is bottom
    const slLen = (FRAME_DEP - 8) * S, slH = P.LEVER_W * 0.4 * S, stW = 10 * S, stH = P.LEVER_W * 0.3 * S;
    stemTravel = Math.max(0, slLen - stW - 3 * S);
    for (let c = 0; c < 4; c++) {
      const slot = els.stems[c].parentNode;
      const sy = P.CORNERS[c][1];
      Object.assign(slot.style, { left: 1 * S + 'px', top: fy + sy * P.LEVER_Y * S - slH / 2 + 'px', width: slLen + 'px', height: slH + 'px' });
      Object.assign(els.stems[c].style, { left: 1.5 * S + 'px', top: (slH - stH) / 2 + 'px', width: stW + 'px', height: stH + 'px' });
    }
    // inner well: shaded inside of the fixed white plastic frame (visible in the gap when the tray sinks)
    const wx = (TRAY_X + 1) * S, wy = (TRAY_Y + 1) * S;
    Object.assign($('.well-f', els.well).style, { left: ox - wx + 'px', top: oy - wy + 'px', width: 2 * wx + 'px', height: 2 * wy + 'px', transform: `translateZ(${(-dep).toFixed(1)}px)` });
    Object.assign($('.well-n', els.well).style, { left: ox - wx + 'px', top: oy - wy + 'px', width: 2 * wx + 'px', height: dep + 'px', transformOrigin: '50% 0', transform: 'rotateX(-90deg)' });
    Object.assign($('.well-s', els.well).style, { left: ox - wx + 'px', top: oy + wy - dep + 'px', width: 2 * wx + 'px', height: dep + 'px', transformOrigin: '50% 100%', transform: 'rotateX(90deg)' });
    Object.assign($('.well-l', els.well).style, { left: ox - wx + 'px', top: oy - wy + 'px', width: dep + 'px', height: 2 * wy + 'px', transformOrigin: '0 50%', transform: 'rotateY(90deg)' });
    Object.assign($('.well-r', els.well).style, { left: ox + wx - dep + 'px', top: oy - wy + 'px', width: dep + 'px', height: 2 * wy + 'px', transformOrigin: '100% 50%', transform: 'rotateY(-90deg)' });
    // the soft floor shadow belongs to the fixed frame and never shifts with tilt
    const shx = FRAME_X * 1.2 * S, shy = FRAME_Y * 1.26 * S;
    Object.assign(els.shadow.style, { width: 2 * shx + 'px', height: 2 * shy + 'px', left: -shx + 'px', top: -shy + 'px', transform: `translate3d(0px, ${(22 * S).toFixed(1)}px, ${(-(dep + 12 * S)).toFixed(1)}px)` });
    R.resize(S, persp);
    placeUI();
    if (animate && old && (Math.abs(old.cx - L.cx) > 1 || Math.abs(old.cy - L.cy) > 1 || Math.abs(old.S - S) > 0.001 || old.theta !== L.theta || old.pitch !== L.pitch)) {
      const ease = 'cubic-bezier(.22,1,.36,1)', dur = 820;
      let th0 = old.theta;
      if (Math.abs(th0 - L.theta) > 180) th0 += th0 < L.theta ? 360 : -360;
      els.table.animate([{ transform: `translate(${old.cx - L.cx}px, ${old.cy - L.cy}px) scale(${old.S / S})` }, { transform: 'none' }], { duration: dur, easing: ease });
      els.spin.animate([{ transform: `rotate(${th0}deg)` }, { transform: `rotate(${L.theta}deg)` }], { duration: dur, easing: ease });
      els.pitch.animate([{ transform: `rotateX(${old.pitch}deg)` }, { transform: `rotateX(${L.pitch}deg)` }], { duration: dur, easing: ease });
    }
  }

  const ARROW = '<svg class="pad-arrow" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12h15M11 4.5 18.5 12 11 19.5" fill="none" stroke="currentColor" stroke-width="3.2"/></svg>';
  let padEls = [];
  function placeUI() {
    // lever pads
    const keyFor = (c) => {
      if (touchy) return '';
      const p = P.OWNER[c], hand = P.HAND[p].indexOf(c);
      if (G.mode === 'local') return p === 'r' ? ['A', 'D'][hand] : ['←', '→'][hand];
      return ['A', 'D'][hand];
    };
    els.pads.innerHTML = '';
    padEls = [];
    const thRad = L.theta * DEG, cTh = Math.cos(thRad), sTh = Math.sin(thRad);
    for (const pd of L.pads) {
      const d = document.createElement('div');
      d.className = 'pad';
      d.dataset.c = pd.c; d.dataset.p = pd.p;
      if ((heldMask >> pd.c) & 1) d.classList.add('on');
      Object.assign(d.style, { left: pd.x + 'px', top: pd.y + 'px', width: pd.w + 'px', height: pd.h + 'px' });
      const compact = pd.w < 140 || pd.h < 108;
      if (compact) d.classList.add('compact');
      const k = Math.round(clamp(Math.min(pd.w, pd.h) * 0.4, 40, 66));
      // pressing a lever sinks its corner, so the marble rolls toward that corner on screen
      const [sx, sy] = P.CORNERS[pd.c];
      const ang = Math.atan2(sy, sx) / DEG + L.theta;
      const cs = Math.cos(ang * DEG), sn = Math.sin(ang * DEG);
      // depth gauge sweeps from the board-side release edge toward the arrow's edge
      const fdx = sx * cTh, fdy = sx * sTh;
      const fillAxis = Math.abs(fdy) >= Math.abs(fdx) ? (fdy >= 0 ? 'd' : 'u') : (fdx >= 0 ? 'r' : 'l');
      const scaleSide = (fillAxis === 'd' || fillAxis === 'u') ? (cs < 0 ? 'r' : 'l') : (sn < 0 ? 'b' : 't');
      d.dataset.fill = fillAxis;
      d.dataset.scale = scaleSide;
      const key = keyFor(pd.c);
      d.innerHTML = `<div class="pad-bg"><div class="pad-fill"><i class="pad-stripes"></i></div><div class="pad-stop" aria-hidden="true"></div><div class="pad-scale" aria-hidden="true"><i class="ps-t ps-25"></i><i class="ps-t ps-50"></i><i class="ps-t ps-75"></i><i class="ps-stop"></i></div></div><div class="pad-in" style="--face:${pd.face}deg"><div class="knob" style="--k:${k}px">${key ? `<span class="key">${key}</span>` : ''}</div><div class="pad-label">${SYM[pd.p]}<span class="pl-h">Hold</span><span class="pl-f">Full</span><span class="pl-t">Recharge</span><span class="pl-g">Let go</span></div><span class="pad-meter"><i></i></span></div>${ARROW}`;
      const arrow = d.querySelector('.pad-arrow');
      const margin = compact ? 21 : 24;
      const ax = Math.min(Math.max(pd.w * 0.34, compact ? 38 : 48), pd.w / 2 - margin);
      const ay = Math.min(Math.max(pd.h * 0.32, compact ? 26 : 36), pd.h / 2 - margin);
      Object.assign(arrow.style, { left: (pd.w / 2 + Math.sign(cs) * ax).toFixed(1) + 'px', top: (pd.h / 2 + Math.sign(sn) * ay).toFixed(1) + 'px' });
      arrow.style.setProperty('--dir', ang + 'deg');
      els.pads.append(d);
      padEls.push({
        el: d, c: pd.c, p: pd.p, fillAxis,
        fillEl: d.querySelector('.pad-fill'),
        knobEl: d.querySelector('.knob'),
        meterEl: d.querySelector('.pad-meter i'),
        lastD: -1, lastE: -1, lastFlags: -1,
      });
    }
    // score badges
    for (const p of ['r', 'b']) {
      const b = L.badges[p], el = els.badge[p];
      if (!b) { el.style.display = 'none'; continue; }
      el.style.display = '';
      el.style.transform = `translate(${b.x}px, ${b.y}px)`;
      el.querySelector('.badge-in').style.setProperty('--face', b.face + 'deg');
    }
    // the score bug
    if (L.bug) {
      els.bug.classList.add('on');
      els.bug.classList.toggle('vert', !!L.bug.vert);
      els.bug.style.left = L.bug.x + 'px'; els.bug.style.top = L.bug.y + 'px';
    } else els.bug.classList.remove('on');
    const btn = (el, pos) => { if (pos) { el.style.display = ''; el.style.left = pos.x + 'px'; el.style.top = pos.y + 'px'; } else el.style.display = 'none'; };
    btn(els.menuBtn, L.btns.menu);
    btn(els.hudSound, L.btns.sound);
    if (isOnline()) {
      els.codeTag.classList.add('on');
      els.codeTag.textContent = 'Code ' + (window.OGNet && OGNet.code || '');
      const b = L.view === 'D' ? { x: L.vw - L.sa.r - 54, y: L.area.y + 6 } : { x: L.vw - L.sa.r - 70, y: L.vh - L.sa.b - 20 };
      Object.assign(els.codeTag.style, { left: b.x + 'px', top: b.y + 'px' });
    } else els.codeTag.classList.remove('on');
    // series score: under the score bug, or beside the menu button when each player has a badge
    const sp = L.bug ? (L.bug.vert ? { x: L.bug.x, y: L.bug.y + 82 } : { x: L.bug.x, y: L.bug.y + (L.vw >= 700 ? 42 : 36) })
      : L.view === 'B' ? { x: L.vw - L.sa.r - 20, y: L.vh / 2, face: -90 } : L.view === 'C' ? { x: L.vw / 2, y: L.vh - L.sa.b - 16 } : null;
    if (sp) { els.series.style.left = sp.x + 'px'; els.series.style.top = sp.y + 'px'; els.series.style.setProperty('--face', (sp.face || 0) + 'deg'); }
    els.series.dataset.at = sp ? '1' : '';
    hudKey = '';
    paintHUD(true);
    paintSeries();
    readyKey = null; tipKey = '';
    paintReady();
    paintTips();
  }

  /** which lever a touch at (x, y) holds, or -1 */
  function zoneOf(x, y) {
    if (!L) return -1;
    const { vw, vh, view } = L;
    if (view === 'B') return y > vh / 2 ? (x < vw / 2 ? 0 : 1) : (x < vw / 2 ? 2 : 3);
    if (view === 'C') return x < vw / 2 ? (y < vh / 2 ? 0 : 1) : (y < vh / 2 ? 2 : 3);
    const H = P.HAND[G.me || 'r'];
    if (view === 'D') return x < vw / 2 ? H[0] : H[1];
    if (view === 'E') return y < vh / 2 ? H[0] : H[1];
    return -1;
  }

  /* ================================================================
     Drawing. The outer frame (cvFrame) stays fixed while the tray
     (cvBase + cvLive) sinks and tilts inside it in 3D (CSS).
     A flat canvas on top (#fx) carries the particle bursts.
     ================================================================ */
  const R = (() => {
    const bctx = els.base.getContext('2d'), lctx = els.live.getContext('2d'), fctx = els.frame.getContext('2d');
    let k = 1, eye = { x: 0, y: 0, h: 3000 }, light = { x: 0.5, y: 0.8 }, ballSprite = null, ballShadow = null, key = '', dirty = false;
    const sparks = [];
    const _dd = [0, 0, 0, 0];
    const PEG_H = 30, WALL_H = 22;

    function resize(S, persp) {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      k = S * dpr;
      const maxPx = 2.8e6, px = CANVAS_X * 2 * k * CANVAS_Y * 2 * k;
      if (px > maxPx) k *= Math.sqrt(maxPx / px);
      const w = Math.round(CANVAS_X * 2 * k), h = Math.round(CANVAS_Y * 2 * k);
      // where the viewer's eye is, in board units: right above the middle, or tilted back toward my end
      const th = L.theta * DEG, a = L.pitch * DEG, dist = persp / S;
      const ey = dist * Math.sin(a); // toward the bottom of the screen
      eye = { x: Math.sin(th) * ey, y: Math.cos(th) * ey, h: dist * Math.cos(a) };
      // light from the upper left of the screen -> shadows fall down-right on screen
      const lx = 0.42, ly = 0.86;
      light = { x: Math.cos(-th) * lx - Math.sin(-th) * ly, y: Math.sin(-th) * lx + Math.cos(-th) * ly };
      const nk = [w, h, eye.x.toFixed(0), eye.y.toFixed(0), eye.h.toFixed(0), L.theta].join('|');
      if (nk === key && !dirty) return;
      key = nk; dirty = false;
      for (const c of [els.base, els.live, els.frame]) { c.width = w; c.height = h; }
      drawFrame();
      drawTray();
      makeSprites();
    }
    const lean = (x, y, h) => { const f = h / (eye.h - h); return [(x - eye.x) * f, (y - eye.y) * f]; };
    const tf = (ctx) => ctx.setTransform(k, 0, 0, k, CANVAS_X * k, CANVAS_Y * k);
    function rrect(ctx, x0, y0, x1, y1, r) {
      ctx.beginPath();
      ctx.moveTo(x0 + r, y0); ctx.lineTo(x1 - r, y0); ctx.arcTo(x1, y0, x1, y0 + r, r);
      ctx.lineTo(x1, y1 - r); ctx.arcTo(x1, y1, x1 - r, y1, r);
      ctx.lineTo(x0 + r, y1); ctx.arcTo(x0, y1, x0, y1 - r, r);
      ctx.lineTo(x0, y0 + r); ctx.arcTo(x0, y0, x0 + r, y0, r);
      ctx.closePath();
    }
    const TRAY_R = P.RIM_R, FRAME_R = P.RIM_R + 4;
    const floorPath = (c) => rrect(c, -P.X, -P.Y, P.X, P.Y, P.CORNER);
    const trayPath = (c) => rrect(c, -TRAY_X, -TRAY_Y, TRAY_X, TRAY_Y, TRAY_R);
    function pocketBox(p) {
      const xa = p.side * P.MOUTH, xb = p.side * (P.BACK - P.WALL);
      const ya = p.v * (P.IN + P.WALL), yb = p.v * (P.OUT - P.WALL);
      return { x0: Math.min(xa, xb), x1: Math.max(xa, xb), y0: Math.min(ya, yb), y1: Math.max(ya, yb) };
    }
    function guardOf(p) {
      return P.PEGS.reduce((a, b) => (Math.hypot(b.x - p.hx, b.y - p.hy) < Math.hypot(a.x - p.hx, a.y - p.hy) ? b : a));
    }

    /** Fixed outer frame ring (transparent opening over the tray). */
    function drawFrame() {
      const c = fctx;
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.clearRect(0, 0, els.frame.width, els.frame.height);
      tf(c);
      const lx = light.x, ly = light.y;
      // bright white plastic outer frame, lit from the upper left
      const g = c.createLinearGradient(-lx * FRAME_X, -ly * FRAME_Y, lx * FRAME_X, ly * FRAME_Y);
      g.addColorStop(0, '#ffffff'); g.addColorStop(0.5, '#f2f4f7'); g.addColorStop(1, '#d9dee6');
      rrect(c, -FRAME_X, -FRAME_Y, FRAME_X, FRAME_Y, FRAME_R); c.fillStyle = g; c.fill();
      c.lineWidth = 2; c.strokeStyle = 'rgba(14,22,40,.2)'; c.stroke();
      rrect(c, -FRAME_X + 3, -FRAME_Y + 3, FRAME_X - 3, FRAME_Y - 3, Math.max(2, FRAME_R - 2.5)); c.lineWidth = 2.2; c.strokeStyle = 'rgba(255,255,255,.95)'; c.stroke();
      // recessed lever slot notches on the frame's outer edges where each stem passes
      const slotHalf = P.LEVER_W * 0.19;
      const notchIn = Math.min(8, FRAME_WALL * 0.52);
      for (const [sx, sy] of P.CORNERS) {
        const x0 = sx > 0 ? FRAME_X - notchIn : -FRAME_X;
        const x1 = sx > 0 ? FRAME_X : -FRAME_X + notchIn;
        const y0 = sy * P.LEVER_Y - slotHalf, y1 = sy * P.LEVER_Y + slotHalf;
        const ng = c.createLinearGradient(sx > 0 ? x0 : x1, 0, sx > 0 ? x1 : x0, 0);
        ng.addColorStop(0, 'rgba(14,22,40,.24)'); ng.addColorStop(1, 'rgba(14,22,40,.36)');
        rrect(c, x0, y0, x1, y1, 2);
        c.fillStyle = ng; c.fill();
        c.lineWidth = 1; c.strokeStyle = 'rgba(14,22,40,.16)'; c.stroke();
        // 1px lighter bevel lip on the lit side of the recess
        const xin = sx > 0 ? x0 - 0.8 : x1 + 0.8;
        const ylit = ly >= 0 ? y1 + 0.8 : y0 - 0.8;
        c.beginPath();
        c.moveTo(xin, y0); c.lineTo(xin, y1);
        c.moveTo(x0, ylit); c.lineTo(x1, ylit);
        c.lineWidth = 1.2; c.strokeStyle = 'rgba(255,255,255,.85)'; c.stroke();
      }
      // team rails: Red's end on the left, Blue's on the right
      c.lineCap = 'round';
      const railX = (FRAME_X + TRAY_X) * 0.5;
      const railY = P.LEVER_Y - P.LEVER_W * 0.65;
      for (const [side, col] of [[-1, 'r'], [1, 'b']]) {
        const x = side * railX;
        c.beginPath(); c.moveTo(x, -railY); c.lineTo(x, railY); c.lineWidth = 6; c.strokeStyle = COLOR[col]; c.stroke();
      }
      // technical tick marks along the long rails
      c.lineCap = 'butt'; c.lineWidth = 1.6; c.strokeStyle = 'rgba(14,22,40,.2)';
      const tickStep = P.X / 10, tickMax = P.X - tickStep;
      for (let x = -tickMax; x <= tickMax + 0.01; x += tickStep) {
        const len = Math.abs(x) < 1 ? 8 : 4.5;
        for (const sy of [-1, 1]) { c.beginPath(); c.moveTo(x, sy * (FRAME_Y - 4)); c.lineTo(x, sy * (FRAME_Y - 4 - len)); c.stroke(); }
      }
      // punch out the inner opening so the tilting tray and shaded well show through
      c.save();
      c.globalCompositeOperation = 'destination-out';
      trayPath(c); c.fillStyle = '#000'; c.fill();
      c.restore();
      // crisp inner lip around the opening
      trayPath(c); c.lineWidth = 2; c.strokeStyle = 'rgba(14,22,40,.24)'; c.stroke();
    }

    /** Tilting inner tray: rim, sloped inner wall, floor, markings, pockets, pegs. */
    function drawTray() {
      const c = bctx;
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.clearRect(0, 0, els.base.width, els.base.height);
      tf(c);
      const lx = light.x, ly = light.y;
      // rim and the sloped inner cove of the tray
      let g = c.createLinearGradient(-lx * TRAY_X, -ly * TRAY_Y, lx * TRAY_X, ly * TRAY_Y);
      g.addColorStop(0, '#ffffff'); g.addColorStop(1, '#e8ebf0');
      trayPath(c); c.fillStyle = g; c.fill();
      c.lineWidth = 1.6; c.strokeStyle = 'rgba(14,22,40,.16)'; c.stroke();
      g = c.createLinearGradient(-lx * P.RIM_X, -ly * P.RIM_Y, lx * P.RIM_X, ly * P.RIM_Y);
      g.addColorStop(0, '#dfe3ea'); g.addColorStop(1, '#fafbfc');
      rrect(c, -P.RIM_X, -P.RIM_Y, P.RIM_X, P.RIM_Y, P.CORNER + Math.round((P.RIM_X - P.X) * 0.45)); c.fillStyle = g; c.fill();
      // the floor
      c.save();
      floorPath(c); c.clip();
      g = c.createRadialGradient(-lx * P.X * 0.28, -ly * P.Y * 0.4, P.BALL * 2, 0, 0, Math.hypot(P.X, P.Y) * 1.15);
      g.addColorStop(0, '#ffffff'); g.addColorStop(1, '#f3f5f9');
      c.fillStyle = g; c.fillRect(-P.X, -P.Y, 2 * P.X, 2 * P.Y);
      // clear start disc (P.DISC_R) and raised centre cup (P.CUP_R)
      g = c.createRadialGradient(-lx * P.DISC_R * 0.25, -ly * P.DISC_R * 0.25, P.CUP_R * 0.5, 0, 0, P.DISC_R);
      g.addColorStop(0, 'rgba(255,255,255,.16)'); g.addColorStop(0.8, 'rgba(210,218,230,.06)'); g.addColorStop(1, 'rgba(180,190,206,.14)');
      c.beginPath(); c.arc(0, 0, P.DISC_R, 0, TAU); c.fillStyle = g; c.fill();
      c.lineWidth = 1.6; c.strokeStyle = 'rgba(130,142,160,.36)'; c.stroke();
      c.beginPath(); c.arc(0, 0, P.CUP_R, 0, TAU); c.lineWidth = 2.4; c.strokeStyle = 'rgba(255,255,255,.7)'; c.stroke();
      c.beginPath(); c.arc(0, 0, P.CUP_R * 0.88, 0, TAU); c.lineWidth = 1.4; c.strokeStyle = 'rgba(130,142,160,.38)'; c.stroke();
      // the floor inside each pocket is tinted with its color
      for (const p of P.POCKETS) { const b = pocketBox(p); c.fillStyle = TINT[p.color]; c.fillRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0); }
      // each pocket's team shape, printed on open floor on the centre side of its guard peg
      for (const p of P.POCKETS) {
        const guard = guardOf(p);
        const mx = guard.x - p.side * (P.PEG + 26), my = p.hy;
        const sz = 8.4;
        c.save();
        c.translate(mx, my);
        c.globalAlpha = 0.55;
        if (p.color === 'r') {
          c.scale(p.side, 1);
          c.beginPath(); c.moveTo(-sz * 0.9, -sz * 1.05); c.lineTo(sz * 1.05, 0); c.lineTo(-sz * 0.9, sz * 1.05); c.closePath();
          c.fillStyle = COLOR.r; c.fill();
        } else {
          c.beginPath(); c.arc(0, 0, sz * 0.88, 0, TAU);
          c.lineWidth = Math.max(3.2, sz * 0.48); c.strokeStyle = COLOR.b; c.stroke();
        }
        c.restore();
      }
      // a faint wordmark printed in the open band between outer center pegs and long walls
      const centerPegOuterY = P.PEGS.filter((q) => q.x === 0).reduce((m, q) => Math.max(m, Math.abs(q.y)), 0) + P.PEG;
      const wordY = (centerPegOuterY + P.Y) * 0.5;
      c.font = `italic 900 32px ${HLF}`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillStyle = 'rgba(14,22,40,.06)';
      c.fillText('ON GUARD', 0, -wordY);
      c.save(); c.rotate(Math.PI); c.fillText('ON GUARD', 0, -wordY); c.restore();
      // soft inner shadow where the floor curves up into the wall
      c.shadowColor = 'rgba(18,28,52,.32)'; c.shadowBlur = 22 * k; c.shadowOffsetX = lx * 7 * k; c.shadowOffsetY = ly * 7 * k;
      c.beginPath(); c.rect(-P.X - 200, -P.Y - 200, 2 * P.X + 400, 2 * P.Y + 400);
      c.moveTo(-P.X + P.CORNER, -P.Y); c.arcTo(-P.X, -P.Y, -P.X, -P.Y + P.CORNER, P.CORNER);
      c.lineTo(-P.X, P.Y - P.CORNER); c.arcTo(-P.X, P.Y, -P.X + P.CORNER, P.Y, P.CORNER);
      c.lineTo(P.X - P.CORNER, P.Y); c.arcTo(P.X, P.Y, P.X, P.Y - P.CORNER, P.CORNER);
      c.lineTo(P.X, -P.Y + P.CORNER); c.arcTo(P.X, -P.Y, P.X - P.CORNER, -P.Y, P.CORNER);
      c.closePath();
      c.fillStyle = '#000'; c.fill('evenodd');
      c.restore();
      // holes with a polished metal ring
      for (const p of P.POCKETS) {
        g = c.createLinearGradient(p.hx - lx * 20, p.hy - ly * 20, p.hx + lx * 20, p.hy + ly * 20);
        g.addColorStop(0, '#8e97a5'); g.addColorStop(0.5, '#ffffff'); g.addColorStop(1, '#b8bfca');
        c.beginPath(); c.arc(p.hx, p.hy, P.HOLE + 3.2, 0, TAU); c.fillStyle = g; c.fill();
        g = c.createRadialGradient(p.hx + lx * 5, p.hy + ly * 5, 1, p.hx, p.hy, P.HOLE);
        g.addColorStop(0, '#030407'); g.addColorStop(0.65, '#10141b'); g.addColorStop(1, '#3a4250');
        c.beginPath(); c.arc(p.hx, p.hy, P.HOLE, 0, TAU); c.fillStyle = g; c.fill();
      }
      // shadows (pegs, pocket walls), then the solid pieces
      c.save();
      for (const p of P.PEGS) { // contact shadow right at the base
        g = c.createRadialGradient(p.x, p.y, P.PEG * 0.8, p.x, p.y, P.PEG + 8);
        g.addColorStop(0, 'rgba(18,28,52,.24)'); g.addColorStop(1, 'rgba(18,28,52,0)');
        c.fillStyle = g; c.fillRect(p.x - P.PEG - 9, p.y - P.PEG - 9, 2 * P.PEG + 18, 2 * P.PEG + 18);
      }
      c.fillStyle = 'rgba(18,28,52,.15)';
      c.shadowColor = 'rgba(18,28,52,.3)'; c.shadowBlur = 8 * k;
      for (const p of P.PEGS) { c.beginPath(); c.arc(p.x + lx * PEG_H * 0.5, p.y + ly * PEG_H * 0.5, P.PEG * 0.92, 0, TAU); c.fill(); }
      c.lineCap = 'round'; c.lineJoin = 'round'; c.lineWidth = P.WALL * 2; c.strokeStyle = 'rgba(18,28,52,.2)';
      for (const p of P.POCKETS) { c.beginPath(); p.pts.forEach(([x, y], i) => (i ? c.lineTo : c.moveTo).call(c, x + lx * WALL_H * 0.45, y + ly * WALL_H * 0.45)); c.stroke(); }
      c.restore();
      // pocket walls: stacked strokes from the floor up, then a glossy top
      for (const p of P.POCKETS) {
        const col = p.color, steps = 7;
        for (let i = 0; i <= steps; i++) {
          const h = (WALL_H * i) / steps;
          c.beginPath();
          p.pts.forEach(([x, y], j) => { const [dx, dy] = lean(x, y, h); (j ? c.lineTo : c.moveTo).call(c, x + dx, y + dy); });
          c.lineCap = 'round'; c.lineJoin = 'round'; c.lineWidth = P.WALL * 2;
          c.strokeStyle = i === steps ? COLOR[col] : i < 2 ? COLOR_DD[col] : COLOR_D[col];
          c.stroke();
        }
        c.beginPath();
        p.pts.forEach(([x, y], j) => { const [dx, dy] = lean(x, y, WALL_H); (j ? c.lineTo : c.moveTo).call(c, x + dx - lx * 1.6, y + dy - ly * 1.6); });
        c.lineWidth = 2.2; c.strokeStyle = 'rgba(255,255,255,.55)'; c.stroke();
      }
      // pegs: crisp white cylinders
      const pegs = P.PEGS.slice().sort((a, b) => Math.hypot(b.x - eye.x, b.y - eye.y) - Math.hypot(a.x - eye.x, a.y - eye.y));
      for (const p of pegs) {
        const [tx, ty] = lean(p.x, p.y, PEG_H);
        const steps = 7;
        for (let i = 0; i < steps; i++) {
          const f = i / steps;
          c.beginPath(); c.arc(p.x + tx * f, p.y + ty * f, P.PEG, 0, TAU);
          c.fillStyle = i === 0 ? '#c3c9d3' : i < 3 ? '#d5dae2' : '#e2e6ec'; c.fill();
        }
        g = c.createRadialGradient(p.x + tx - lx * 5, p.y + ty - ly * 5, 1, p.x + tx, p.y + ty, P.PEG);
        g.addColorStop(0, '#ffffff'); g.addColorStop(0.65, '#fbfcfd'); g.addColorStop(1, '#e3e7ed');
        c.beginPath(); c.arc(p.x + tx, p.y + ty, P.PEG - 0.5, 0, TAU); c.fillStyle = g; c.fill();
        c.lineWidth = 1; c.strokeStyle = 'rgba(14,22,40,.16)'; c.stroke();
      }
    }

    function makeSprites() {
      // a chrome marble: the studio light and the room are fixed to the screen, the board's colors to the board
      const r = P.BALL, pad = 4, size = Math.ceil((r + pad) * 2 * k);
      ballSprite = document.createElement('canvas');
      ballSprite.width = ballSprite.height = size;
      const c = ballSprite.getContext('2d');
      c.setTransform(k, 0, 0, k, size / 2, size / 2);
      c.save();
      c.rotate(-L.theta * DEG);
      let g = c.createRadialGradient(-r * 0.28, -r * 0.34, r * 0.04, 0, 0, r);
      g.addColorStop(0, '#ffffff'); g.addColorStop(0.14, '#eef1f5'); g.addColorStop(0.46, '#a7afba'); g.addColorStop(0.78, '#555d68'); g.addColorStop(1, '#22272f');
      c.beginPath(); c.arc(0, 0, r, 0, TAU); c.fillStyle = g; c.fill();
      c.beginPath(); c.arc(0, 0, r, 0, TAU); c.clip();
      // horizon: bright sky above, the dark table edge, the floor below
      g = c.createLinearGradient(0, -r, 0, r);
      g.addColorStop(0, 'rgba(255,255,255,.35)'); g.addColorStop(0.47, 'rgba(255,255,255,0)'); g.addColorStop(0.52, 'rgba(16,20,28,.62)');
      g.addColorStop(0.64, 'rgba(40,46,58,.3)'); g.addColorStop(0.86, 'rgba(210,216,226,.25)'); g.addColorStop(1, 'rgba(255,255,255,.55)');
      c.fillStyle = g; c.fillRect(-r, -r, 2 * r, 2 * r);
      c.restore();
      // the board's red and blue ends, reflected around the rim
      c.save();
      c.beginPath(); c.arc(0, 0, r, 0, TAU); c.arc(0, 0, r * 0.58, 0, TAU, true); c.clip();
      g = c.createLinearGradient(-r, 0, r, 0);
      g.addColorStop(0, 'rgba(255,42,61,.55)'); g.addColorStop(0.38, 'rgba(255,42,61,0)'); g.addColorStop(0.62, 'rgba(31,107,255,0)'); g.addColorStop(1, 'rgba(31,107,255,.55)');
      c.fillStyle = g; c.fillRect(-r, -r, 2 * r, 2 * r);
      c.restore();
      c.save();
      c.rotate(-L.theta * DEG);
      // highlights: a soft window reflection and a sharp hot spot
      c.beginPath(); c.ellipse(-r * 0.34, -r * 0.46, r * 0.36, r * 0.17, -0.55, 0, TAU); c.fillStyle = 'rgba(255,255,255,.75)'; c.fill();
      c.beginPath(); c.ellipse(-r * 0.42, -r * 0.5, r * 0.13, r * 0.08, -0.55, 0, TAU); c.fillStyle = '#fff'; c.fill();
      c.beginPath(); c.arc(r * 0.38, r * 0.5, r * 0.07, 0, TAU); c.fillStyle = 'rgba(255,255,255,.6)'; c.fill();
      c.restore();
      c.beginPath(); c.arc(0, 0, r - 0.45, 0, TAU); c.lineWidth = 0.9; c.strokeStyle = 'rgba(10,14,20,.6)'; c.stroke();
      // lever tabs, drawn once per team: resting, pressed down, bottomed, tired, and the glow behind an active one
      knobSpr = {};
      for (const col of ['r', 'b']) {
        knobSpr[col] = {};
        for (const mode of ['idle', 'down', 'bot', 'tired', 'halo']) {
          const cv = document.createElement('canvas');
          cv.width = Math.ceil(KNOB_W * k); cv.height = Math.ceil(KNOB_H * k);
          const kc = cv.getContext('2d');
          kc.setTransform(k, 0, 0, k, cv.width / 2, cv.height / 2);
          paintKnob(kc, col, mode);
          knobSpr[col][mode] = cv;
        }
      }
      ballShadow = document.createElement('canvas');
      const ss = Math.ceil(r * 4 * k);
      ballShadow.width = ballShadow.height = ss;
      const s = ballShadow.getContext('2d');
      g = s.createRadialGradient(ss / 2, ss / 2, 0, ss / 2, ss / 2, ss / 2);
      g.addColorStop(0, 'rgba(18,26,48,.5)'); g.addColorStop(0.4, 'rgba(18,26,48,.22)'); g.addColorStop(1, 'rgba(18,26,48,0)');
      s.fillStyle = g; s.fillRect(0, 0, ss, ss);
    }

    const TAB_X = P.LEVER_W * 0.88, TAB_Y = P.LEVER_W, TAB_R = Math.round(P.LEVER_W * 0.14);
    const TAB_CX = FRAME_X + TAB_REACH - TAB_X * 0.5;
    const KNOB_PAD = 44, KNOB_W = TAB_X + KNOB_PAD * 2, KNOB_H = TAB_Y + KNOB_PAD * 2;
    let knobSpr = null;
    function paintKnob(c, col, mode) {
      const w = TAB_X, h = TAB_Y, rr = TAB_R, lx = light.x, ly = light.y;
      const sx = col === 'r' ? -1 : 1; // stem extends inward (-sx) into the frame wall
      const stemReach = TAB_REACH - TAB_X + 8;
      const stemX0 = sx < 0 ? w / 2 - 4 : -w / 2 - stemReach;
      const stemX1 = sx < 0 ? w / 2 + stemReach : -w / 2 + 4;
      const stemHalf = P.LEVER_W * 0.15;
      if (mode === 'halo') { // just the colored glow; the tab itself is drawn over it
        c.shadowColor = COLOR[col]; c.shadowBlur = 28 * k;
        rrect(c, -w / 2 + 2, -h / 2 + 2, w / 2 - 2, h / 2 - 2, rr); c.fillStyle = COLOR[col]; c.fill(); c.fill();
        return;
      }
      const pressed = mode === 'down' || mode === 'bot';
      // stem connecting the lever tab into the frame slot
      c.fillStyle = COLOR_D[col];
      rrect(c, stemX0, -stemHalf, stemX1, stemHalf, 3); c.fill();
      c.fillStyle = 'rgba(255,255,255,.22)';
      c.fillRect(stemX0 + 2, -stemHalf + 3, stemX1 - stemX0 - 4, 4);
      // body (darker underside) with drop shadow: tighter & shorter when pressed down closer to the table
      c.shadowColor = pressed ? 'rgba(18,28,52,.46)' : 'rgba(18,28,52,.35)';
      c.shadowBlur = (pressed ? 3 : 12) * k;
      c.shadowOffsetX = lx * (pressed ? 1.5 : 8) * k;
      c.shadowOffsetY = ly * (pressed ? 1.5 : 8) * k;
      rrect(c, -w / 2, -h / 2, w / 2, h / 2, rr); c.fillStyle = COLOR_DD[col]; c.fill();
      c.shadowColor = 'transparent'; c.shadowBlur = 0; c.shadowOffsetX = 0; c.shadowOffsetY = 0;
      const g = c.createLinearGradient(-lx * w * 0.6, -ly * h * 0.6, lx * w * 0.6, ly * h * 0.6);
      g.addColorStop(0, COLOR_L[col]); g.addColorStop(0.4, COLOR[col]); g.addColorStop(1, COLOR_D[col]);
      rrect(c, -w / 2 + 1.5, -h / 2 + 1.5, w / 2 - 1.5, h / 2 - 3, Math.max(2, rr - 2)); c.fillStyle = g; c.fill();
      // grip ridges
      c.lineWidth = 2; c.lineCap = 'round';
      const rStep = h * 0.16, rHalf = w * 0.24;
      for (const d of [-rStep, 0, rStep]) {
        c.beginPath(); c.moveTo(-rHalf, d + 1); c.lineTo(rHalf, d + 1); c.strokeStyle = 'rgba(0,0,0,.18)'; c.stroke();
        c.beginPath(); c.moveTo(-rHalf, d); c.lineTo(rHalf, d); c.strokeStyle = 'rgba(255,255,255,.4)'; c.stroke();
      }
      // gloss
      rrect(c, -w / 2 + 5, -h / 2 + 4, w / 2 - 5, -h / 2 + 18, 6); c.fillStyle = 'rgba(255,255,255,.3)'; c.fill();
      if (pressed) {
        // darker team overlay when pressed down so quarter / half / three-quarter depths read clearly
        c.save(); c.globalAlpha = 0.36; c.fillStyle = COLOR_DD[col];
        rrect(c, stemX0, -stemHalf, stemX1, stemHalf, 3); c.fill();
        rrect(c, -w / 2, -h / 2, w / 2, h / 2, rr); c.fill();
        c.restore();
      }
      if (mode === 'bot') {
        // bright lock rim when bottomed out
        rrect(c, -w / 2 + 1.5, -h / 2 + 1.5, w / 2 - 1.5, h / 2 - 1.5, Math.max(2, rr - 1));
        c.lineWidth = 2.4; c.strokeStyle = 'rgba(255,255,255,.82)'; c.stroke();
      }
      if (mode === 'tired') {
        c.fillStyle = 'rgba(236,238,242,.68)';
        rrect(c, stemX0, -stemHalf, stemX1, stemHalf, 3); c.fill();
        rrect(c, -w / 2, -h / 2, w / 2, h / 2, rr); c.fill();
      }
    }
    function knob(c, i, ownPress, depth, held, tired, glow, tray) {
      const [sx, sy] = P.CORNERS[i], spr = knobSpr[P.OWNER[i]];
      let cx = sx * TAB_CX, cy = sy * P.LEVER_Y;
      if (!L.pitch && tray) {
        // top-down views: compensate outward on the sunken tray plane so perspective never pulls the tab under the frame
        const dist = eye.h, f0 = dist / (dist + tray.z0U);
        const xr = cx * f0, yr = cy * f0;
        const crx = tray.crx, srx = tray.srx, cry = tray.cry, sry = tray.sry;
        const nx = sry, ny = -cry * srx, nz = cry * crx;
        const t = ((dist - tray.tzU) * nz) / (dist * nz - xr * nx - yr * ny);
        const px = t * xr, py = t * yr, pz = dist * (1 - t) - tray.tzU;
        cx = px * cry + py * sry * srx - pz * sry * crx;
        cy = py * crx + pz * srx;
      }
      const disp = Math.max(ownPress, depth);
      const bot = !tired && ownPress >= (P.K && P.K.BOTTOM != null ? P.K.BOTTOM : 0.97);
      const sc = 1 - disp * (L.pitch ? 0.13 : 0.09); // smaller when pressed down away from the viewer
      const kw = KNOB_W * sc, kh = KNOB_H * sc, x = cx - kw / 2, y = cy - kh / 2;
      if (!tired) {
        if (bot) {
          c.globalAlpha = 0.72 + 0.28 * glow;
          c.drawImage(spr.halo, x, y, kw, kh);
          c.globalAlpha = 1;
        } else if (ownPress > 0.03 || held) {
          c.globalAlpha = 0.12 + ownPress * 0.26;
          c.drawImage(spr.halo, x, y, kw, kh);
          c.globalAlpha = 1;
        }
      }
      if (tired) { c.drawImage(spr.tired, x, y, kw, kh); return; }
      if (bot) { c.drawImage(spr.bot, x, y, kw, kh); return; }
      if (disp <= 0.01) { c.drawImage(spr.idle, x, y, kw, kh); return; }
      if (disp >= 0.99) { c.drawImage(spr.down, x, y, kw, kh); return; }
      c.drawImage(spr.down, x, y, kw, kh);
      c.globalAlpha = 1 - disp;
      c.drawImage(spr.idle, x, y, kw, kh);
      c.globalAlpha = 1;
    }

    /** One tapered inner-rim shadow band along edge A->B with inward unit normal (nx, ny). */
    const RIM_W = 42;
    function rimBand(c, ax, ay, bx, by, nx, ny, da, db) {
      if (da + db < 0.005) return;
      const ex = bx - ax, ey = by - ay, L = Math.hypot(ex, ey), tx = ex / L, ty = ey / L;
      const vx = nx / RIM_W - tx * (db - da) / L, vy = ny / RIM_W - ty * (db - da) / L;
      const v2 = vx * vx + vy * vy;
      const p0x = ax - nx * (1 - da) * RIM_W, p0y = ay - ny * (1 - da) * RIM_W;
      const g = c.createLinearGradient(p0x, p0y, p0x + vx / v2, p0y + vy / v2);
      g.addColorStop(0, 'rgba(18,28,52,.2)');
      g.addColorStop(0.25, 'rgba(18,28,52,.13)');
      g.addColorStop(0.55, 'rgba(18,28,52,.06)');
      g.addColorStop(0.8, 'rgba(18,28,52,.02)');
      g.addColorStop(1, 'rgba(18,28,52,0)');
      c.beginPath();
      c.moveTo(ax, ay); c.lineTo(bx, by); c.lineTo(bx + nx * RIM_W, by + ny * RIM_W); c.lineTo(ax + nx * RIM_W, ay + ny * RIM_W);
      c.closePath();
      c.fillStyle = g; c.fill();
    }

    /** one frame of the live canvas */
    function drawLive(V) {
      const c = lctx;
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.clearRect(0, 0, els.live.width, els.live.height);
      tf(c);
      const now = V.now;
      const tp = V.trayPress || V.press;
      // the floor shades subtly along the tilt direction (zero when all four corners are equal)
      const tl = P.tilt(tp), m = Math.hypot(tl.tx, tl.ty);
      if (m > 0.015) {
        c.save(); floorPath(c); c.clip();
        const ux = tl.tx / m, uy = tl.ty / m, a = Math.min(1, m) * 0.12;
        const g = c.createLinearGradient(-ux * 560, -uy * 560, ux * 560, uy * 560);
        g.addColorStop(0, `rgba(255,255,255,${(a * 1.3).toFixed(3)})`); g.addColorStop(0.5, 'rgba(255,255,255,0)'); g.addColorStop(1, `rgba(18,28,52,${a.toFixed(3)})`);
        c.fillStyle = g; c.fillRect(-P.X, -P.Y, 2 * P.X, 2 * P.Y);
        c.restore();
      }
      // rim shadow cast by the fixed frame onto the sinking tray edges (interpolated per corner depth)
      const d = P.depths(tp, _dd);
      if (d[0] + d[1] + d[2] + d[3] > 0.005) {
        c.save(); trayPath(c); c.clip();
        rimBand(c, -TRAY_X, -TRAY_Y, TRAY_X, -TRAY_Y, 0, 1, d[0], d[2]);
        rimBand(c, -TRAY_X, TRAY_Y, TRAY_X, TRAY_Y, 0, -1, d[1], d[3]);
        rimBand(c, -TRAY_X, -TRAY_Y, -TRAY_X, TRAY_Y, 1, 0, d[0], d[1]);
        rimBand(c, TRAY_X, -TRAY_Y, TRAY_X, TRAY_Y, -1, 0, d[2], d[3]);
        c.restore();
      }
      for (let i = 0; i < 4; i++) knob(c, i, V.press[i], d[i], (V.held >> i) & 1, V.tired[P.OWNER[i]], 0.5 + 0.5 * Math.sin(now * 8), V.tray);
      // countdown: a pulse on the start cup
      if (V.ring != null) {
        for (let j = 0; j < 2; j++) {
          const q = (V.ring * 1.4 + j * 0.5) % 1;
          c.beginPath(); c.arc(0, 0, P.CUP_R + q * (P.DISC_R - P.CUP_R) * 0.75, 0, TAU);
          c.lineWidth = 3 * (1 - q) + 0.5; c.strokeStyle = `rgba(14,22,40,${(0.35 * (1 - q)).toFixed(3)})`; c.stroke();
        }
      }
      // first game: my two pockets pulse gently so I know where to aim
      if (V.mine) {
        const pulse = 0.5 + 0.5 * Math.sin(now * 4.2);
        c.save();
        c.lineCap = 'round'; c.lineJoin = 'round';
        for (const p of P.POCKETS) {
          if (!V.mine.includes(p.color)) continue;
          const b = pocketBox(p);
          c.globalAlpha = 0.1 + 0.2 * pulse;
          c.fillStyle = COLOR[p.color]; c.fillRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0);
          c.globalAlpha = 0.25 + 0.5 * pulse;
          c.beginPath(); p.pts.forEach(([x, y], j) => (j ? c.lineTo : c.moveTo).call(c, x, y));
          c.lineWidth = P.WALL * 2 + 5 + pulse * 6; c.strokeStyle = COLOR_L[p.color]; c.stroke();
          const q = (now * 0.7) % 1;
          c.globalAlpha = 0.5 * (1 - q);
          c.beginPath(); c.arc(p.hx, p.hy, P.HOLE + 6 + q * 46, 0, TAU); c.lineWidth = 3; c.strokeStyle = COLOR[p.color]; c.stroke();
        }
        c.restore();
      }
      // a point: the scoring pocket lights up
      if (V.glow) {
        const p = P.POCKETS[V.glow.pocket], t = V.glow.t, col = p.color;
        const a = Math.max(0, 1 - t / 2.4), pulse = 0.65 + 0.35 * Math.sin(t * 16);
        const b = pocketBox(p);
        c.save();
        c.globalAlpha = a * 0.5 * pulse;
        c.fillStyle = COLOR[col]; c.fillRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0);
        c.globalAlpha = a;
        c.shadowColor = COLOR[col]; c.shadowBlur = 34 * k * pulse;
        c.beginPath(); p.pts.forEach(([x, y], j) => (j ? c.lineTo : c.moveTo).call(c, x, y));
        c.lineCap = 'round'; c.lineJoin = 'round'; c.lineWidth = P.WALL * 2.8; c.strokeStyle = COLOR_L[col]; c.stroke();
        c.shadowBlur = 0;
        for (let rr = 0; rr < 4; rr++) {
          const q = t * 1.25 - rr * 0.2;
          if (q <= 0 || q > 1) continue;
          c.globalAlpha = a * (1 - q);
          c.beginPath(); c.arc(p.hx, p.hy, P.HOLE + q * 150, 0, TAU); c.lineWidth = 8 * (1 - q) + 1; c.strokeStyle = COLOR[col]; c.stroke();
        }
        c.restore();
      }
      // marble (drawn on cvLive unclipped by floorPath so it rides smoothly up onto the cove)
      if (V.ball) {
        const { x, y, scale, dark, vx, vy } = V.ball;
        const r = P.BALL;
        const cv = !dark && typeof P.cove === 'function' ? P.cove(x, y) : null;
        const lift = cv ? cv.lift : 0;
        const climb = cv && cv.run > 0 ? clamp(cv.q / cv.run, 0, 1) : 0;
        const liftScale = 1 + (lift / r) * 0.14;
        const visScale = scale * liftScale;
        const [lx, ly] = lean(x, y, r * scale + lift);
        const sp = Math.hypot(vx || 0, vy || 0);
        if (sp > 240 && scale > 0.9) { // a motion streak behind it
          const ux = vx / sp, uy = vy / sp, len = Math.min(120, sp * 0.1);
          const g = c.createLinearGradient(x + lx, y + ly, x + lx - ux * len, y + ly - uy * len);
          g.addColorStop(0, 'rgba(120,132,150,.32)'); g.addColorStop(1, 'rgba(120,132,150,0)');
          c.beginPath(); c.moveTo(x + lx, y + ly); c.lineTo(x + lx - ux * len, y + ly - uy * len);
          c.lineCap = 'round'; c.lineWidth = r * 1.7 * liftScale; c.strokeStyle = g; c.stroke();
        }
        if (scale > 0.6) {
          const sw = r * 4 * scale * (1 - climb * 0.18);
          const shX = x + light.x * 9 * (1 - climb * 0.5) + (cv ? cv.nx * r * climb * 0.45 : 0);
          const shY = y + light.y * 9 * (1 - climb * 0.5) + (cv ? cv.ny * r * climb * 0.45 : 0);
          c.globalAlpha = scale * (1 - climb * 0.35);
          c.drawImage(ballShadow, shX - sw / 2, shY - sw / 2, sw, sw);
          c.globalAlpha = 1;
        }
        const bs = (r + 4) * 2 * visScale;
        c.drawImage(ballSprite, x + lx - bs / 2, y + ly - bs / 2, bs, bs);
        if (dark > 0) { c.beginPath(); c.arc(x + lx, y + ly, r * visScale, 0, TAU); c.fillStyle = `rgba(8,10,14,${dark})`; c.fill(); }
      }
      // little sparks where the marble hits hard
      for (let i = sparks.length - 1; i >= 0; i--) {
        const s = sparks[i];
        s.t += V.dt;
        if (s.t > s.life) { sparks.splice(i, 1); continue; }
        const q = s.t / s.life;
        c.globalAlpha = 1 - q;
        const px = s.x + s.vx * s.t, py = s.y + s.vy * s.t;
        c.beginPath(); c.moveTo(px, py); c.lineTo(px - s.vx * 0.03, py - s.vy * 0.03);
        c.lineWidth = 2.6 * (1 - q) + 0.8; c.lineCap = 'round'; c.strokeStyle = s.col; c.stroke();
      }
      c.globalAlpha = 1;
    }
    function spark(x, y, v, col, inx, iny) {
      const n = Math.min(7, Math.floor(v / 180) + 2);
      const hasDir = !!(inx || iny);
      const baseA = hasDir ? Math.atan2(iny, inx) : 0;
      for (let i = 0; i < n; i++) {
        const a = hasDir ? baseA + (Math.random() - 0.5) * 2.4 : Math.random() * TAU;
        const sp = 80 + Math.random() * v * 0.3;
        sparks.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, t: 0, life: 0.22 + Math.random() * 0.2, col: col || '#9aa6b8' });
      }
      if (sparks.length > 80) sparks.splice(0, sparks.length - 80);
    }
    return { resize, drawLive, spark, invalidate() { dirty = true; }, get k() { return k; } };
  })();

  /* screen position of a board point (for particle bursts and tips) */
  function toScreen(x, y) {
    if (B3) return B3.project(x, y, 0);
    const th = L.theta * DEG, a = L.pitch * DEG, S = L.S;
    const persp = parseFloat(els.table.style.perspective) || 1000;
    let u = (x * Math.cos(th) - y * Math.sin(th)) * S, v = (x * Math.sin(th) + y * Math.cos(th)) * S;
    const z = v * Math.sin(a); v = v * Math.cos(a);
    const f = persp / (persp - z);
    return { x: L.cx + u * f, y: L.cy + v * f };
  }

  /* ================================================================
     Particles (a flat canvas over everything), flash, shake
     ================================================================ */
  const FX = (() => {
    const cv = els.fx, ctx = cv.getContext('2d');
    let parts = [], running = false, dpr = 1;
    function size() {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      cv.width = Math.round(app.clientWidth * dpr); cv.height = Math.round(app.clientHeight * dpr);
    }
    function add(p) { parts.push(p); if (!running) { running = true; last = 0; requestAnimationFrame(tick); } }
    let last = 0;
    function tick(now) {
      const dt = Math.min(0.05, last ? (now - last) / 1000 : 0.016); last = now;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cv.width, cv.height);
      for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i];
        p.t += dt;
        if (p.t > p.life) { parts.splice(i, 1); continue; }
        p.vx *= Math.exp(-p.drag * dt); p.vy *= Math.exp(-p.drag * dt);
        p.vy += p.grav * dt;
        p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt;
        const q = p.t / p.life;
        ctx.globalAlpha = q < 0.7 ? 1 : (1 - q) / 0.3;
        if (p.shape === 4) { // a speed line along its motion
          const sp = Math.hypot(p.vx, p.vy) || 1, len = Math.min(140, sp * 0.12);
          ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - (p.vx / sp) * len, p.y - (p.vy / sp) * len);
          ctx.lineWidth = p.s; ctx.lineCap = 'butt'; ctx.strokeStyle = p.col; ctx.stroke();
          continue;
        }
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
        if (p.flip) ctx.scale(1, Math.cos(p.t * p.flip));
        ctx.fillStyle = p.col;
        const s = p.s;
        if (p.shape === 0) { // shard
          ctx.beginPath(); ctx.moveTo(-s * 1.4, -s * 0.28); ctx.lineTo(s * 1.0, -s * 0.28); ctx.lineTo(s * 1.4, s * 0.28); ctx.lineTo(-s, s * 0.28); ctx.closePath(); ctx.fill();
        } else if (p.shape === 1) { // chevron
          ctx.beginPath(); ctx.moveTo(-s * 0.7, -s); ctx.lineTo(-s * 0.1, -s); ctx.lineTo(s * 0.8, 0); ctx.lineTo(-s * 0.1, s); ctx.lineTo(-s * 0.7, s); ctx.lineTo(s * 0.2, 0); ctx.closePath(); ctx.fill();
        } else if (p.shape === 2) { // square chip
          ctx.fillRect(-s * 0.5, -s * 0.5, s, s);
        } else { // ribbon
          ctx.fillRect(-s, -s * 0.22, s * 2, s * 0.44);
        }
        ctx.restore();
      }
      ctx.globalAlpha = 1;
      if (parts.length) requestAnimationFrame(tick); else { running = false; last = 0; ctx.clearRect(0, 0, cv.width, cv.height); }
    }
    function burst(x, y, color, n) {
      const cols = [COLOR[color], COLOR[color], COLOR[color], COLOR_L[color], '#ffffff', COLOR[color], '#0b0d12'];
      for (let i = 0; i < n; i++) {
        const a = Math.random() * TAU, sp = 220 + Math.random() * 700;
        add({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, grav: 260, drag: 2.4, t: 0, life: 0.8 + Math.random() * 0.8,
          s: 4 + Math.random() * 6, col: cols[i % cols.length], rot: Math.random() * 6, vr: (Math.random() - 0.5) * 16, shape: i % 7 === 0 ? 1 : i % 3 === 0 ? 2 : 0, flip: 6 + Math.random() * 10 });
      }
      for (let i = 0; i < 18; i++) { // speed lines
        const a = (i / 18) * TAU + Math.random() * 0.2, sp = 900 + Math.random() * 700;
        add({ x: x + Math.cos(a) * 20, y: y + Math.sin(a) * 20, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, grav: 0, drag: 5, t: 0, life: 0.38 + Math.random() * 0.15,
          s: 2 + Math.random() * 2.5, col: i % 4 === 3 ? '#ffffff' : COLOR[color], rot: 0, vr: 0, shape: 4 });
      }
    }
    function rain(color, n) {
      const w = app.clientWidth, cols = [COLOR[color], COLOR[color], COLOR_L[color], '#ffffff', '#0b0d12', COLOR[OTHER[color]]];
      for (let i = 0; i < n; i++) {
        add({ x: Math.random() * w, y: -20 - Math.random() * app.clientHeight * 0.7, vx: (Math.random() - 0.5) * 140, vy: 90 + Math.random() * 180, grav: 240, drag: 1.3,
          t: 0, life: 3.2 + Math.random() * 2, s: 5 + Math.random() * 6, col: cols[i % cols.length], rot: Math.random() * 6, vr: (Math.random() - 0.5) * 9,
          shape: i % 6 === 0 ? 1 : i % 2 ? 3 : 0, flip: 3 + Math.random() * 6 });
      }
    }
    return { size, burst, rain };
  })();

  function flash(color) {
    els.flash.style.background = `radial-gradient(circle at 50% 50%, rgba(255,255,255,.95) 0, rgba(255,255,255,.6) 35%, ${COLOR[color]} 100%)`;
    try { els.flash.animate([{ opacity: 0 }, { opacity: 0.5, offset: 0.1 }, { opacity: 0 }], { duration: 560, easing: 'ease-out' }); } catch (e) {}
  }
  function shake(power) {
    const kf = [];
    for (let i = 0; i < 9; i++) {
      const a = (1 - i / 9) * (power || 1);
      kf.push({ transform: `translate(${((Math.random() * 2 - 1) * 10 * a).toFixed(1)}px, ${((Math.random() * 2 - 1) * 7 * a).toFixed(1)}px) rotate(${((Math.random() * 2 - 1) * 0.5 * a).toFixed(2)}deg)` });
    }
    kf.push({ transform: 'none' });
    try { els.stage.animate(kf, { duration: 460, easing: 'ease-out' }); } catch (e) {}
  }

  /* ================================================================
     Game state. One "match" object for every mode; the host and the
     local modes simulate it, an online guest mirrors it from the host.
     ================================================================ */
  const G = {
    mode: 'demo', // demo | local | cpu | host | guest
    me: null, // my color when one player per device
    s: P.create(), grip: P.makeGrip(),
    score: { r: 0, b: 0 }, phase: 'count', t: 0, game: 1, goalN: 0, goalPocket: -1,
    hands: { r: 0, b: 0 }, eff: { r: 0, b: 0 }, mask: 0,
    bots: {}, paused: false, hold: false, names: { r: 'Red', b: 'Blue' },
    drop: null, glow: null, lastCount: -1, firstPoint: true,
    ready: { r: false, b: false }, go: false, // ready-up before the first serve
    series: { r: 0, b: 0 }, // games won across rematches
    level: 'gentle', // practice opponent
  };
  const PHASES = ['count', 'play', 'goal', 'over', 'ready'];
  const LEVELS = [['gentle', 'Gentle', 'Slow and forgiving. A good first game.'], ['classic', 'Classic', 'Plays about like a person.'], ['sharp', 'Sharp', 'Quick hands. Hard to beat.']];
  const BOT = { gentle: 'gentle', classic: 'person', sharp: 'sharp' };
  { const l = store.get('og-level'); if (BOT[l]) G.level = l; }
  let screen = 'title';
  let idleT = 0;

  function resetMatch(keepScore) {
    P.reset(G.s); G.s.live = false;
    P.leverReset(G.s);
    if (keepScore) {
      const h = G.mode === 'local' ? { r: P.handsOf('r', heldMask), b: P.handsOf('b', heldMask) }
        : G.mode === 'cpu' ? { r: G.me === 'r' ? P.handsOf('r', heldMask) : 0, b: G.me === 'b' ? P.handsOf('b', heldMask) : 0 }
        : G.mode === 'host' ? { r: P.handsOf('r', heldMask), b: Net.guestLv() }
        : { r: 0, b: 0 };
      G.grip.serve(h);
    } else G.grip.reset();
    if (!keepScore) { epoch++; G.score = { r: 0, b: 0 }; G.goalN = 0; G.firstPoint = true; }
    G.ready = { r: false, b: false }; G.go = false; idleT = 0;
    G.phase = 'count'; G.t = 0; G.goalPocket = -1; G.drop = null; G.glow = null; G.lastCount = -1;
    for (const b of Object.values(G.bots)) b.reset();
    paintHUD(true);
  }

  /** wait for both players to say they're ready; the countdown starts when they have */
  function awaitReady() {
    G.phase = 'ready'; G.t = 0; G.go = false; G.ready = { r: false, b: false }; G.lastCount = -1;
    paintReady();
  }
  function markReady(p) {
    if (G.phase !== 'ready' || G.ready[p]) return;
    G.ready[p] = true;
    Snd.play('tap');
    paintReady();
  }
  const hitStat = (k) => { if (window.BL && window.BL.stats) window.BL.stats.hit(k); };
  const trackOgStart = (m) => {
    if (m === 'local') hitStat('og_localStarted');
    else if (m === 'cpu') {
      hitStat('og_cpuStarted');
      hitStat(G.level === 'sharp' ? 'og_cpuSharp' : G.level === 'classic' ? 'og_cpuClassic' : 'og_cpuGentle');
    }
  };

  /** a new match from 0-0 (restart, rematch) */
  function freshMatch() {
    closeAllModals();
    G.paused = false;
    resetMatch(false);
    clearOverlays();
    trackOgStart(G.mode);
    if (G.mode === 'local') awaitReady();
  }

  const events = [];
  const hits = [];
  /** one fixed step of the authoritative game */
  function stepGame(dt) {
    G.t += dt;
    if (G.phase === 'ready') {
      P.step(G.s, 0, dt);
      if (G.ready.r && G.ready.b) {
        if (!G.go) { G.go = true; G.t = 0; } // a beat to see both "Ready" marks
        else if (G.t >= 0.55) { G.phase = 'count'; G.t = 0; G.lastCount = -1; }
      } else G.go = false;
    } else if (G.phase === 'count') {
      P.step(G.s, 0, dt);
      if (G.t >= COUNT_T) { G.phase = 'play'; G.t = 0; G.s.live = true; }
    } else if (G.phase === 'play') {
      for (const p of ['r', 'b']) {
        const was = G.grip.tired[p];
        G.eff[p] = G.grip.use(p, G.hands[p], dt, G.s.press);
        if (!was && G.grip.tired[p]) events.push({ k: 'tired', p });
      }
      G.mask = P.maskFor('r', G.eff.r) | P.maskFor('b', G.eff.b);
      hits.length = 0;
      const res = P.step(G.s, G.mask, dt, hits);
      for (const h of hits) events.push({ k: 'hit', kind: h.k, v: h.v, x: G.s.x, y: G.s.y });
      if (res >= 0) {
        const col = P.POCKETS[res].color;
        G.score[col]++; G.goalN++; G.goalPocket = res;
        G.phase = 'goal'; G.t = 0;
        G.drop = { x: G.s.x, y: G.s.y, pocket: res, t: 0 };
        events.push({ k: 'goal', pocket: res, color: col });
        if (G.mode !== 'demo') hitStat('og_goalsScored');
        // every goal counts toward the per-bot record, even if the match is never finished
        if (G.mode === 'cpu') hitStat((col === G.me ? 'og_gFor' : 'og_gAgainst') + (G.level === 'sharp' ? 'Sharp' : G.level === 'classic' ? 'Classic' : 'Gentle'));
      }
    } else if (G.phase === 'goal') {
      G.mask = 0; P.step(G.s, 0, dt);
      const t = G.mode === 'demo' ? 1.2 : GOAL_T;
      if (G.t >= t) {
        if (G.mode === 'demo' && (G.score.r >= TARGET || G.score.b >= TARGET)) G.score = { r: 0, b: 0 };
        if (G.score.r >= TARGET || G.score.b >= TARGET) {
          const winner = G.score.r >= TARGET ? 'r' : 'b';
          G.phase = 'over'; G.t = 0; events.push({ k: 'over', winner });
          if (G.mode === 'local' || G.mode === 'cpu' || G.mode === 'host') {
            hitStat(winner === 'r' ? 'og_redWins' : 'og_blueWins');
          }
          if (G.mode === 'local') hitStat('og_localFinished');
          else if (G.mode === 'cpu') {
            hitStat('og_cpuFinished');
            const lvl = G.level === 'sharp' ? 'Sharp' : G.level === 'classic' ? 'Classic' : 'Gentle';
            hitStat((winner === G.me ? 'og_win' : 'og_loss') + lvl);
          }
          else if (G.mode === 'host') hitStat('og_onlineFinished');
        }
        else { resetMatch(true); G.firstPoint = false; if (G.mode === 'demo') G.t = COUNT_T - 0.6; }
      }
    } else {
      G.mask = 0; P.step(G.s, 0, dt);
    }
  }

  /* ================================================================
     Input: multi-touch pads (pointer events) and keys
     ================================================================ */
  const touches = new Map(); // pointerId -> corner
  const keys = new Set();
  let heldMask = 0;
  function recomputeHeld() {
    let m = 0;
    touches.forEach((c) => { if (c >= 0) m |= 1 << c; });
    keys.forEach((code) => { const c = keyCorner(code); if (c >= 0) m |= 1 << c; });
    if (m !== heldMask) {
      const pressed = m & ~heldMask;
      heldMask = m;
      if ((G.phase === 'goal' || G.phase === 'count') && G.mode !== 'guest') {
        const ps = G.mode === 'local' ? ['r', 'b'] : G.me ? [G.me] : [];
        for (const p of ps) if (G.grip.tired[p] && !P.handsOf(p, m)) G.grip.tired[p] = false;
      }
      if (pressed && screen === 'game') {
        Snd.play('lever', true);
        if (navigator.vibrate) try { navigator.vibrate(8); } catch (e) {}
        if (G.mode === 'local' && G.phase === 'ready') for (let c = 0; c < 4; c++) if ((pressed >> c) & 1) markReady(P.OWNER[c]);
      }
      $$('.pad', els.pads).forEach((p) => p.classList.toggle('on', !!((m >> +p.dataset.c) & 1)));
      if (G.mode === 'guest' && window.OGNet) OGNet.sendLevers(P.handsOf(G.me, m));
    }
  }
  function onPointer(e) {
    if (screen !== 'game') return;
    if (e.type === 'pointerdown') {
      e.preventDefault();
      try { els.zones.setPointerCapture(e.pointerId); } catch (err) {}
      touches.set(e.pointerId, zoneOf(e.clientX, e.clientY));
    } else if (e.type === 'pointermove') {
      if (!touches.has(e.pointerId)) return;
      touches.set(e.pointerId, zoneOf(e.clientX, e.clientY)); // slide from one lever to the other
    } else {
      touches.delete(e.pointerId);
    }
    recomputeHeld();
  }
  ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'lostpointercapture'].forEach((t) => els.zones.addEventListener(t, onPointer));
  els.zones.addEventListener('contextmenu', (e) => e.preventDefault());
  document.addEventListener('gesturestart', (e) => e.preventDefault());
  document.addEventListener('dblclick', (e) => e.preventDefault());
  function releaseAll() { touches.clear(); keys.clear(); recomputeHeld(); }
  window.addEventListener('blur', releaseAll);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { releaseAll(); Snd.roll(0); if ((G.mode === 'local' || G.mode === 'cpu') && screen === 'game' && G.phase !== 'over') openPause(); }
  });

  function keyCorner(code) {
    if (G.mode === 'local') {
      const r = { KeyA: 0, KeyD: 1 }, b = { ArrowLeft: 0, ArrowRight: 1, KeyJ: 0, KeyL: 1 };
      if (code in r) return P.HAND.r[r[code]];
      if (code in b) return P.HAND.b[b[code]];
      return -1;
    }
    const m = { KeyA: 0, KeyD: 1, ArrowLeft: 0, ArrowRight: 1 };
    return code in m ? P.HAND[G.me || 'r'][m[code]] : -1;
  }
  window.addEventListener('keydown', (e) => {
    const top = topModal();
    if (e.key === 'Tab' && top) { trapTab(e, top); return; }
    if (e.key === 'Escape') {
      // Escape always answers to the dialog on top
      if (top) { if (top.id === 'pause') resume(); else if (top.id === 'howto' || top.id === 'diff') closeModal(top); return; }
      if (screen === 'game') { openPause(); return; }
    }
    if (e.target && /INPUT|TEXTAREA/.test(e.target.tagName)) return;
    if (screen !== 'game' || top) return;
    const c = keyCorner(e.code);
    if (c < 0) return;
    e.preventDefault();
    if (e.repeat) return;
    keys.add(e.code); recomputeHeld();
  });
  window.addEventListener('keyup', (e) => { if (keys.delete(e.code)) recomputeHeld(); });

  /* ================================================================
     HUD + overlays
     ================================================================ */
  let hudKey = '';
  /** a score that rolls up to its new value */
  function setRoll(el, v, animate) {
    const s = String(v);
    if (el.dataset.v === s && el.firstElementChild) return;
    el.dataset.v = s;
    if (!animate || !el.firstElementChild) { const n = document.createElement('span'); n.textContent = s; el.replaceChildren(n); el.classList.remove('bump'); return; }
    const old = el.lastElementChild;
    old.className = 'out';
    const n = document.createElement('span'); n.className = 'in'; n.textContent = s;
    el.append(n);
    setTimeout(() => { if (old.isConnected) old.remove(); }, 450);
    el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump');
  }
  function paintHUD(force) {
    for (const p of ['r', 'b']) {
      const label = G.names[p] || TEAM[p];
      $$(`[data-name="${p}"]`, els.hud).forEach((n) => { if (n.textContent !== label) n.textContent = label; });
      $$(`[data-score="${p}"]`, els.hud).forEach((n) => setRoll(n, G.score[p], !force));
      $$(`[data-pips="${p}"]`, els.hud).forEach((pips) => {
        if (pips.children.length !== TARGET) pips.innerHTML = '<i></i>'.repeat(TARGET);
        Array.from(pips.children).forEach((pip, i) => {
          const on = i < G.score[p];
          if (on && !pip.classList.contains('on') && !force) { pip.classList.remove('new'); void pip.offsetWidth; pip.classList.add('new'); }
          pip.classList.toggle('on', on);
        });
      });
    }
    hudKey = '';
    for (let i = 0; i < padEls.length; i++) { padEls[i].lastD = -1; padEls[i].lastE = -1; padEls[i].lastFlags = -1; }
  }
  function bottomedFor(p, thr) {
    if (G.grip && typeof G.grip.bottomed === 'function') return G.grip.bottomed(p, G.s.press);
    const h = P.HAND[p];
    return (G.s.press[h[0]] >= thr ? 1 : 0) + (G.s.press[h[1]] >= thr ? 1 : 0);
  }
  function paintMeters() {
    if (!padEls.length) return;
    const thr = P.K && P.K.BOTTOM != null ? P.K.BOTTOM : 0.97;
    const br = bottomedFor('r', thr), bb = bottomedFor('b', thr);
    for (let i = 0; i < padEls.length; i++) {
      const it = padEls[i], p = it.p, c = it.c;
      const d = clamp(G.s.press[c], 0, 1);
      const e = clamp(G.grip.e[p], 0, 1);
      const tired = !!G.grip.tired[p];
      const on = !!((heldMask >> c) & 1);
      const grip = tired && on;
      const bot = !tired && d >= thr;
      const drain = !tired && (p === 'r' ? br : bb) > 0;
      const refill = !tired && !drain && e < 0.995;
      const hi = !tired && d >= 0.8;
      const low = !tired && drain && e < 0.3;
      const deep = !tired && d > 0.02;
      const flags = (tired ? 1 : 0) | (grip ? 2 : 0) | (bot ? 4 : 0) | (drain ? 8 : 0) | (refill ? 16 : 0) | (hi ? 32 : 0) | (low ? 64 : 0) | (deep ? 128 : 0);
      if (flags !== it.lastFlags) {
        it.lastFlags = flags;
        const cl = it.el.classList;
        cl.toggle('tired', tired);
        cl.toggle('grip', grip); // still holding a rested lever: "Let go"
        cl.toggle('bot', bot);
        cl.toggle('drain', drain);
        cl.toggle('refill', refill);
        cl.toggle('hi', hi);
        cl.toggle('low', low);
        cl.toggle('deep', deep);
      }
      const dQ = Math.round(d * 200);
      if (dQ !== it.lastD) {
        it.lastD = dQ;
        const pct = dQ === 0 ? '102' : ((1 - dQ / 200) * 100).toFixed(2);
        const ax = it.fillAxis;
        it.fillEl.style.transform = ax === 'd' ? `translate3d(0,-${pct}%,0)`
          : ax === 'u' ? `translate3d(0,${pct}%,0)`
          : ax === 'l' ? `translate3d(${pct}%,0,0)`
          : `translate3d(-${pct}%,0,0)`;
        const dv = dQ / 200;
        it.knobEl.style.transform = dQ === 0 ? '' : `translate3d(0,${(dv * 5).toFixed(2)}px,0) scale(${(1 - dv * 0.1).toFixed(3)})`;
      }
      const eQ = Math.round(e * 200);
      if (eQ !== it.lastE) {
        it.lastE = eQ;
        it.meterEl.style.transform = `scaleX(${(eQ / 200).toFixed(3)})`;
      }
    }
  }

  function showCount(n) {
    if (!L) return;
    els.count.innerHTML = '';
    const fs = Math.round(clamp(Math.min(L.vw, L.vh) * 0.34, 96, 210));
    for (const p of L.cds) {
      const d = document.createElement('div');
      d.className = 'cd';
      d.style.cssText = `left:${p.x}px;top:${p.y}px;--face:${p.face}deg;--fs:${fs}px`;
      d.innerHTML = n ? `<i class="cd-sw"></i><b class="cd-n">${n}</b>` : '<b class="cd-go">GO</b>';
      els.count.append(d);
    }
    Snd.play('count', n);
  }

  function scorerText(color) {
    if (G.mode === 'cpu') return color === G.me ? 'You score' : 'Computer scores';
    if (isOnline()) return color === G.me ? 'You score' : `${G.names[color] || TEAM[color]} scores`;
    return `${TEAM[color]} scores`;
  }

  function showBanner(color) {
    els.banner.innerHTML = '';
    const n = G.score[color];
    const word = n >= TARGET ? 'Game' : 'Point';
    const mp = n === TARGET - 1 ? '<em>Match point</em>' : '';
    for (const p of L.bans) {
      const d = document.createElement('div');
      d.className = 'banner';
      d.dataset.p = color;
      const bh = Math.round(clamp(p.w * 0.23, 66, 122));
      d.style.cssText = `left:${p.x}px;top:${p.y}px;--face:${p.face}deg;--bw:${p.w}px;--bh:${bh}px`;
      d.innerHTML = `<div class="bn"><i class="bn-streak" style="top:-22%"></i><i class="bn-streak" style="top:118%;animation-delay:.06s"></i>
        <span class="bn-tag">${esc(scorerText(color))}</span>
        <div class="bn-band"><span class="bn-word">${word}</span></div>
        <span class="bn-score">${mp}<span class="r"></span><i></i><span class="b"></span></span></div>`;
      d.querySelector('.bn-score .r').textContent = G.score.r;
      d.querySelector('.bn-score .b').textContent = G.score.b;
      els.banner.append(d);
    }
  }

  /* ---------- series score (games won across rematches) ---------- */
  function paintSeries() {
    const r = G.series.r | 0, b = G.series.b | 0, any = r + b > 0;
    els.series.classList.toggle('on', any && screen === 'game' && !!els.series.dataset.at && G.mode !== 'demo');
    $$('[data-series]').forEach((n) => { const v = String(n.dataset.series === 'r' ? r : b); if (n.textContent !== v) n.textContent = v; });
    const w = $('#winSeries');
    if (w) w.classList.toggle('on', any);
  }

  /* ---------- ready-up: nobody gets served before they're looking ---------- */
  let readyKey = null;
  const TICK = '<svg class="rd-tick" viewBox="0 0 24 24" aria-hidden="true"><path d="m4.5 12.5 5 5L19.5 6.5" fill="none" stroke="currentColor" stroke-width="3.4"/></svg>';
  function paintReady() {
    const on = screen === 'game' && G.phase === 'ready' && !!L && L.bans.length > 0;
    const online = isOnline();
    const key = on ? [L.view, L.vw, L.vh, G.mode, G.ready.r, G.ready.b, G.names.r, G.names.b, G.game].join() : '';
    if (key === readyKey && (on || !els.ready.childNodes.length)) return;
    readyKey = key;
    if (!on) { els.ready.replaceChildren(); return; }
    const kept = document.activeElement && els.ready.contains(document.activeElement);
    els.ready.replaceChildren();
    if (online) {
      const p = L.bans[0], me = G.me, them = OTHER[me];
      const d = document.createElement('div');
      d.className = 'rdy rdy-online';
      d.style.cssText = `left:${p.x}px;top:${L.view === 'D' ? L.area.y + L.area.h * 0.5 : p.y}px;--face:0deg;--bw:${Math.min(p.w, 340)}px`;
      const row = (t) => `<li data-p="${t}" class="${G.ready[t] ? 'on' : ''}">${SYM[t]}<b>${esc(t === me ? 'You' : G.names[t] || TEAM[t])}</b><span>${G.ready[t] ? 'Ready' + TICK : t === me ? 'Not yet' : 'Getting ready<span class="spin-dots"><b></b><b></b><b></b></span>'}</span></li>`;
      d.innerHTML = `<div class="rd-in"><p class="kicker"><span class="k-num">Get set</span><span class="k-rule"></span><span>First to ${TARGET}</span></p>
        <ul class="rd-who">${row('r')}${row('b')}</ul>
        <button class="btn btn-wide rd-btn" type="button" data-act="ready" data-p="${me}"${G.ready[me] ? ' disabled' : ''}>${G.ready[me] ? `Waiting for ${esc(G.names[them] || TEAM[them])}…` : 'I’m ready'}</button></div>`;
      els.ready.append(d);
      const b = d.querySelector('.rd-btn');
      if ((kept || !touchy) && !b.disabled && !topModal()) setTimeout(() => { if (b.isConnected) b.focus({ preventScroll: true }); }, 60);
      return;
    }
    ['r', 'b'].forEach((t, i) => {
      const p = L.bans[i];
      if (!p) return;
      const d = document.createElement('div');
      d.className = 'rdy' + (G.ready[t] ? ' on' : '');
      d.dataset.p = t;
      d.style.cssText = `left:${p.x}px;top:${p.y}px;--face:${p.face}deg;--bw:${Math.min(p.w, 300)}px`;
      d.innerHTML = `<div class="rd-in"><span class="rd-team">${SYM[t]}${TEAM[t]}</span>${G.ready[t]
        ? `<b class="rd-big">Ready${TICK}</b><span class="rd-sub">${G.ready[OTHER[t]] ? 'Here we go' : `Waiting for ${TEAM[OTHER[t]]}`}</span>`
        : '<b class="rd-big">Ready?</b><span class="rd-sub">Press one of your pads</span>'}</div>`;
      els.ready.append(d);
    });
  }

  /* ---------- first game: point out my pockets, and what the levers do ---------- */
  let tipKey = '';
  const tipColors = () => {
    if (screen !== 'game' || G.mode === 'demo' || !G.firstPoint || store.get('og-tip-pockets')) return null;
    if (G.phase !== 'count' && !(G.phase === 'ready' && G.mode === 'local')) return null; // online, the ready card has the floor first
    return G.mode === 'local' ? ['r', 'b'] : [G.me || 'r'];
  };
  function paintTips() {
    const cols = L ? tipColors() : null;
    const key = cols ? [cols.join(''), L.view, L.vw, L.vh, L.theta].join() : '';
    if (key === tipKey) return;
    tipKey = key;
    els.tips.replaceChildren();
    if (!cols) return;
    for (const p of P.POCKETS) {
      if (!cols.includes(p.color)) continue;
      // beside the pocket, on the side away from the other pocket at that end
      const a = toScreen(p.hx, p.hy), b = toScreen(p.hx, p.v * (P.OUT + P.WALL + 8)); // pocket middle -> its outer wall
      const face = G.mode === 'local' ? L.faces[p.color] : 0;
      const dl = Math.hypot(b.x - a.x, b.y - a.y) || 1, ux = (b.x - a.x) / dl, uy = (b.y - a.y) / dl;
      const along = Math.abs(ux * Math.cos(face * DEG) + uy * Math.sin(face * DEG)); // 1 = the label lies along that direction
      const off = 8 + along * 52 + (1 - along) * 12;
      const s = { x: b.x + ux * off, y: b.y + uy * off };
      const d = document.createElement('div');
      d.className = 'tip-chip';
      d.dataset.p = p.color;
      d.style.cssText = `left:${s.x.toFixed(1)}px;top:${s.y.toFixed(1)}px;--face:${face}deg`;
      d.innerHTML = `<span>${SYM[p.color]}Your pocket</span>`;
      els.tips.append(d);
    }
  }

  let toastT = 0;
  function toast(text, ms) {
    els.toast.textContent = text;
    els.toast.classList.add('on');
    clearTimeout(toastT);
    if (ms !== 0) toastT = setTimeout(() => els.toast.classList.remove('on'), ms || 2600);
  }
  function hideToast() { clearTimeout(toastT); els.toast.classList.remove('on'); }

  function handleEvents() {
    for (const ev of events) {
      if (ev.k === 'hit') {
        if (G.mode !== 'demo') Snd.play(ev.kind, ev.v);
        if (ev.v > 360) {
          let sx = ev.x, sy = ev.y, snx = 0, sny = 0, fire = true;
          if (ev.kind === 'edge' && typeof P.cove === 'function') {
            const c = P.cove(ev.x, ev.y);
            // Smooth cove entry at q ~ 0 is tangent to the floor; only spark on high-cove lip impacts
            if (c.run > 0 && c.q >= c.run * 0.75) {
              const st = clamp(c.q / c.run, 0, 1);
              sx = ev.x + c.nx * P.BALL * st;
              sy = ev.y + c.ny * P.BALL * st;
              snx = -c.nx; sny = -c.ny;
            } else {
              fire = false;
            }
          }
          if (fire) (B3 || R).spark(sx, sy, ev.v, ev.kind === 'wall' ? '#ffffff' : '#9aa6b8', snx, sny);
        }
      } else if (ev.k === 'goal') {
        G.glow = { pocket: ev.pocket, t: 0 };
        if (G.mode === 'demo') continue;
        Snd.play('drop');
        later(() => Snd.play('goal'), 60);
        const p = P.POCKETS[ev.pocket], s = toScreen(p.hx, p.hy);
        later(() => { FX.burst(s.x, s.y, ev.color, 80); shake(1); flash(ev.color); }, 170);
        els.count.innerHTML = '';
        showBanner(ev.color);
        later(() => paintHUD(false), 380);
        if (navigator.vibrate) try { navigator.vibrate([30, 40, 70]); } catch (e) {}
      } else if (ev.k === 'over') {
        if (G.mode === 'demo') continue;
        store.set('og-tip-hold', '1'); // played a whole match: no need for the lever hint
        if (G.mode !== 'guest') {
          if (G.mode !== 'host' || G.series.n !== G.game) { G.series[ev.winner]++; if (G.mode === 'host') { G.series.n = G.game; Net.saveSeries(); } }
          paintSeries();
        } // the guest reads the series from the room
        later(() => showWin(ev.winner), 300);
      } else if (ev.k === 'tired') {
        if (G.mode !== 'demo' && (!G.me || ev.p === G.me)) Snd.play('tired');
      }
    }
    events.length = 0;
  }

  /* ================================================================
     Main loop
     ================================================================ */
  let lastT = performance.now(), acc = 0, frames = [];
  let prevSimX = 0, prevSimY = 0, hasPrevSim = false;
  const rollPts = new Float32Array(84); // per-substep (x, y) pairs for exact rolling across bounces/coves
  let rollN = 0;
  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.1, (now - lastT) / 1000);
    lastT = now;
    if (TEST) { frames.push(dt); if (frames.length > 600) frames.shift(); }
    rollN = 0;
    const sim = G.mode === 'demo' || G.mode === 'local' || G.mode === 'cpu' || G.mode === 'host';
    if (sim && !G.paused && !G.hold) {
      if (G.phase === 'play' && G.s.live) { rollPts[0] = G.s.x; rollPts[1] = G.s.y; rollN = 1; }
      acc += dt;
      let n = 0;
      while (acc >= P.K.DT && n < 40) {
        if (G.phase === 'play' && G.s.live) { prevSimX = G.s.x; prevSimY = G.s.y; hasPrevSim = true; }
        else hasPrevSim = false;
        if (G.mode === 'demo') { G.hands.r = G.bots.r.update(G.s, P.K.DT, G.grip.tired.r); G.hands.b = G.bots.b.update(G.s, P.K.DT, G.grip.tired.b); }
        else if (G.mode === 'local') { G.hands.r = P.handsOf('r', heldMask); G.hands.b = P.handsOf('b', heldMask); }
        else if (G.mode === 'cpu') { G.hands[G.me] = P.handsOf(G.me, heldMask); G.hands[OTHER[G.me]] = G.phase === 'play' ? G.bots[OTHER[G.me]].update(G.s, P.K.DT, G.grip.tired[OTHER[G.me]]) : 0; }
        else if (G.mode === 'host') { G.hands.r = P.handsOf('r', heldMask); G.hands.b = Net.guestLv(); }
        stepGame(P.K.DT);
        if (G.phase === 'play' && G.s.live && rollN < 42) { rollPts[rollN * 2] = G.s.x; rollPts[rollN * 2 + 1] = G.s.y; rollN++; }
        acc -= P.K.DT; n++;
      }
      if (n >= 40) acc = 0;
    } else { acc = 0; hasPrevSim = false; }
    if (G.mode === 'guest') Net.guestFrame(now, dt);
    // countdown
    if (G.mode !== 'demo' && screen === 'game') {
      if (G.phase === 'count' && G.t >= 0) {
        const n = Math.max(0, Math.ceil(COUNT_T - G.t));
        if (n !== G.lastCount && n > 0) { G.lastCount = n; showCount(n); }
        els.pads.classList.toggle('hint', G.firstPoint);
      } else if (G.phase === 'play' && G.lastCount > 0) {
        G.lastCount = 0; showCount(0); els.pads.classList.remove('hint');
        if (tipKey) store.set('og-tip-pockets', '1'); // shown once per device
      } else if (G.phase === 'ready') els.pads.classList.toggle('hint', G.firstPoint);
      // nobody has touched a lever and the marble is just sitting there: say what to do (once per device)
      if (G.phase === 'play' && !G.paused && !G.hold && heldMask === 0 && Math.hypot(G.s.vx, G.s.vy) < 8) {
        idleT += dt;
        if (idleT > 4 && !store.get('og-tip-hold')) { store.set('og-tip-hold', '1'); toast('Hold a lever to sink it. Tap to hold it there.', 4200); }
      } else idleT = 0;
    }
    if (G.phase !== lastPhase) { lastPhase = G.phase; paintReady(); }
    paintTips();
    handleEvents();
    if (G.mode === 'host') Net.hostSend(now);
    render(now / 1000, dt);
    if (TEST) { work.push(performance.now() - now); if (work.length > 600) work.shift(); }
  }
  const work = [];
  const _rd = [0, 0, 0, 0], lastStemT = ['', '', '', ''], _tr = { crx: 1, srx: 0, cry: 1, sry: 0, tzU: -2.5, z0U: 2.5 };
  let lastPhase = '', lastTrayT = '', liveDirty = 30, drawn = 0, lastBallVis = null;

  function render(t, dt) {
    if (!L) return;
    // paused: nothing moves, so after the levers have settled there's nothing to redraw
    if (G.paused && screen === 'game') { Snd.roll(0); if (liveDirty <= 0) return; liveDirty--; } else liveDirty = 30;
    const press = G.s.press;
    // marble: rolling, dropping into a hole, or waiting in the middle
    let ball = null, ring = null;
    if (G.drop) {
      G.drop.t += dt;
      const p = P.POCKETS[G.drop.pocket], q = clamp(G.drop.t / 0.32, 0, 1), e = q * q;
      if (q < 1) ball = { x: lerp(G.drop.x, p.hx, Math.sqrt(q)), y: lerp(G.drop.y, p.hy, Math.sqrt(q)), scale: 1 - 0.45 * e, dark: 0.6 * e };
    } else if (G.phase === 'play' || G.phase === 'count' || G.phase === 'ready') {
      const canInterp = G.phase === 'play' && G.s.live && hasPrevSim && !G.paused && !G.hold && G.mode !== 'guest' && Math.hypot(G.s.x - prevSimX, G.s.y - prevSimY) < 40;
      const a = canInterp ? clamp(acc / P.K.DT, 0, 1) : 1;
      const bx = canInterp ? lerp(prevSimX, G.s.x, a) : G.s.x;
      const by = canInterp ? lerp(prevSimY, G.s.y, a) : G.s.y;
      ball = { x: bx, y: by, scale: 1, dark: 0, vx: G.phase === 'play' ? G.s.vx : 0, vy: G.phase === 'play' ? G.s.vy : 0 };
      if (G.phase === 'count' && G.mode !== 'demo') { // appears with a little bounce at the start of each point
        const q = clamp(G.t / 0.45, 0, 1);
        ball.scale = q < 1 ? 0.4 + 0.6 * (1 - Math.pow(1 - q, 3)) + Math.sin(q * Math.PI) * 0.15 : 1;
        if (G.t > 0) ring = G.t;
      }
    }
    lastBallVis = ball;
    if (G.glow) { G.glow.t += dt; if (G.glow.t > 2.6) G.glow = null; }
    const prePlay = G.phase === 'count' || G.phase === 'ready';
    const heldShown = G.mode === 'guest' ? Net.shownMask() : (G.mode === 'local' || G.mode === 'cpu' || G.mode === 'host' ? (G.phase === 'play' ? G.mask : (prePlay ? heldMask & ownMask() : 0)) : G.mask);
    const tabP = prePlay ? knobPress(heldShown, dt) : press;
    if (!prePlay) for (let i = 0; i < 4; i++) kl[i] = press[i];
    if (B3) {
      B3.draw({ now: t, dt, trayPress: press, press: tabP, held: heldShown, tired: G.grip.tired, ball, glow: G.glow, ring, mine: tipKey ? tipColors() : null, rollPts, rollN });
    } else {
      // CSS fallback: the tray sinks and tilts down toward pressed corners inside the fixed outer frame
      const d = P.depths(press, _rd);
      const tl = P.tilt(press);
      const b = tl.tx * 0.5, c = tl.ty * 0.5;
      const twist = 0.25 * (d[0] - d[1] - d[2] + d[3]);
      const a = tl.sink + Math.abs(twist);
      const ryRad = Math.atan((DROP_V * b) / TRAY_X), rxRad = -Math.atan((DROP_V * c) / TRAY_Y);
      const ry = ryRad / DEG, rx = rxRad / DEG;
      const z0 = Math.max(2, 2.5 * L.S);
      const tz = -(z0 + DROP_V * a * L.S);
      const tt = `translate3d(0px, 0px, ${tz.toFixed(1)}px) rotateX(${rx.toFixed(2)}deg) rotateY(${ry.toFixed(2)}deg)`;
      if (tt !== lastTrayT) {
        lastTrayT = tt;
        els.tray.style.transform = tt;
        _tr.crx = Math.cos(rxRad); _tr.srx = Math.sin(rxRad);
        _tr.cry = Math.cos(ryRad); _tr.sry = Math.sin(ryRad);
        _tr.z0U = z0 / L.S; _tr.tzU = tz / L.S;
      }
      for (let i = 0; i < 4; i++) {
        const st = `translate3d(${(Math.max(tabP[i], d[i]) * stemTravel).toFixed(1)}px, 0px, 0px)`;
        if (st !== lastStemT[i]) { lastStemT[i] = st; els.stems[i].style.transform = st; }
      }
      drawn++;
      R.drawLive({ now: t, dt, trayPress: press, press: tabP, held: heldShown, tired: G.grip.tired, ball, glow: G.glow, ring, mine: tipKey ? tipColors() : null, tray: _tr });
    }
    // the rolling sound stops whenever the game does: paused, on hold for a connection, or the page hidden
    if (screen === 'game') { paintMeters(); Snd.roll(G.phase === 'play' && !G.paused && !G.hold && !document.hidden ? Math.hypot(G.s.vx, G.s.vy) : 0); } else Snd.roll(0);
  }
  function ownMask() {
    if (G.mode === 'local') return 15;
    return G.me === 'r' ? 3 : 12;
  }
  const kl = [0, 0, 0, 0];
  function knobPress(mask, dt) {
    // small "my lever answers" feedback during countdown / ready-up without fighting real depth during play
    for (let i = 0; i < 4; i++) kl[i] += ((((mask >> i) & 1) * 0.55) - kl[i]) * (1 - Math.exp(-dt * 22));
    return kl;
  }

  /* ================================================================
     Screens + modes
     ================================================================ */
  let exitT = 0;
  function setScreen(s) {
    const old = screen;
    screen = s;
    app.dataset.screen = s;
    clearTimeout(exitT);
    if (old !== s && (old === 'title' || old === 'online')) {
      app.dataset.exit = old;
      exitT = setTimeout(() => { delete app.dataset.exit; }, 270);
    } else delete app.dataset.exit;
    if (s === 'title') requestAnimationFrame(settleSwitch);
  }

  function startDemo() {
    G.mode = 'demo'; G.me = null; G.paused = false; G.hold = false;
    G.series = { r: 0, b: 0 };
    G.bots = { r: P.makeBot('r', 'demo'), b: P.makeBot('b', 'demo') };
    resetMatch(false);
    G.t = COUNT_T - 0.8;
  }

  let wakeLock = null;
  function keepAwake(on) {
    try {
      if (on && 'wakeLock' in navigator && !wakeLock) navigator.wakeLock.request('screen').then((w) => { wakeLock = w; w.addEventListener('release', () => { wakeLock = null; }); }).catch(() => {});
      if (!on && wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }
    } catch (e) {}
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden && screen === 'game') keepAwake(true); });

  function clearOverlays() { els.count.innerHTML = ''; els.banner.innerHTML = ''; }

  /* ---------- practice level ---------- */
  function paintLevels() {
    $$('[data-seg="level"]').forEach((seg) => {
      if (!seg.children.length) seg.innerHTML = LEVELS.map(([id, name]) => `<button type="button" role="radio" data-act="level" data-level="${id}">${name}</button>`).join('');
      Array.from(seg.children).forEach((b) => { const on = b.dataset.level === G.level; b.setAttribute('aria-checked', String(on)); b.tabIndex = on ? 0 : -1; });
    });
    const lv = LEVELS.find((l) => l[0] === G.level);
    $$('[data-level-note]').forEach((n) => { n.textContent = lv[2]; });
    const sub = $('#cpuSub');
    if (sub) sub.textContent = `against the computer · ${lv[1].toLowerCase()}`;
  }
  function setLevel(id) {
    if (!BOT[id]) return;
    G.level = id;
    store.set('og-level', id);
    if (G.mode === 'cpu' && G.me) G.bots[OTHER[G.me]] = P.makeBot(OTHER[G.me], BOT[id]);
    paintLevels();
  }
  paintLevels();

  function enterGame(mode, me) {
    closeAllModals();
    releaseAll();
    G.mode = mode; G.me = me || null; G.paused = false; G.hold = false;
    G.bots = {};
    G.series = { r: 0, b: 0 };
    if (mode === 'cpu') { G.bots[OTHER[me]] = P.makeBot(OTHER[me], BOT[G.level]); G.names = { [me]: 'You', [OTHER[me]]: 'Computer' }; }
    else if (mode === 'local') G.names = { r: 'Red', b: 'Blue' };
    setScreen('game');
    resetMatch(false);
    trackOgStart(mode);
    G.t = -0.6; // a beat for the board to glide in
    if (mode === 'local') awaitReady();
    clearOverlays();
    applyLayout(true);
    els.pads.classList.add('enter');
    setTimeout(() => els.pads.classList.remove('enter'), 1000);
    keepAwake(true);
    try { if (!history.state || !history.state.og) history.pushState({ og: 1 }, ''); } catch (e) {}
  }

  function toTitle() {
    closeAllModals();
    hideToast();
    releaseAll();
    Net.leave();
    setScreen('title');
    startDemo();
    clearOverlays();
    applyLayout(true);
    keepAwake(false);
    cleanURL();
  }
  function cleanURL() { try { if (/[?&]join=/.test(location.search)) history.replaceState(history.state, '', location.pathname + (TEST ? '?test' : '')); } catch (e) {} }

  window.addEventListener('popstate', () => {
    if (screen === 'game') {
      // the phone's back gesture: pause instead of leaving mid-game
      try { history.pushState({ og: 1 }, ''); } catch (e) {}
      openPause();
    } else if (screen === 'online') toTitle();
  });

  /* ---------- modals ----------
     One dialog shows at a time: the newest. The ones under it wait their turn, everything behind is
     inert, Tab stays inside the dialog, and focus goes back to whatever opened it. */
  const modalStack = [];
  const BEHIND = ['#title', '#online', '#zones', '#pads', '#hud', '#ready'].map((s) => $(s));
  const topModal = () => (modalStack.length ? modalStack[modalStack.length - 1].m : null);
  const modalOpen = (id) => modalStack.some((x) => x.m.id === id);
  const focusables = (m) => $$('button:not([disabled]):not([tabindex="-1"]), a[href]:not([tabindex="-1"]), input:not([disabled]):not([tabindex="-1"]), [tabindex]:not([tabindex="-1"]):not([disabled])', m).filter((el) => el.offsetParent !== null);
  function syncModals() {
    const top = topModal();
    $$('.modal').forEach((m) => { m.classList.toggle('on', m === top); m.inert = m !== top; });
    BEHIND.forEach((el) => { el.inert = !!top; });
  }
  function focusIn(m) {
    const f = touchy ? null : m.querySelector('[role="radio"][aria-checked="true"], button:not([disabled])');
    const el = f || m.querySelector('.sheet, .win-card') || m;
    setTimeout(() => { if (topModal() === m) el.focus({ preventScroll: true }); }, 40);
  }
  function openModal(m, opener) {
    if (topModal() === m) return;
    const i = modalStack.findIndex((x) => x.m === m);
    if (i >= 0) modalStack.splice(i, 1);
    modalStack.push({ m, from: opener || document.activeElement });
    syncModals();
    focusIn(m);
  }
  function closeModal(m) {
    const i = modalStack.findIndex((x) => x.m === m);
    if (i < 0) return;
    const wasTop = i === modalStack.length - 1, from = modalStack[i].from;
    modalStack.splice(i, 1);
    syncModals();
    if (!wasTop) return;
    if (from && from.isConnected && from.offsetParent !== null && from !== document.body) from.focus({ preventScroll: true });
    else if (topModal()) focusIn(topModal());
  }
  function closeAllModals() { if (!modalStack.length) return; modalStack.length = 0; syncModals(); }
  function trapTab(e, m) {
    const f = focusables(m);
    if (!f.length) { e.preventDefault(); return; }
    const first = f[0], last = f[f.length - 1], a = document.activeElement;
    if (!m.contains(a)) { e.preventDefault(); first.focus(); }
    else if (e.shiftKey && a === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && a === last) { e.preventDefault(); first.focus(); }
  }

  function openPause() {
    if (screen !== 'game' || modalStack.length) return;
    releaseAll();
    const online = isOnline();
    if (!online) { G.paused = true; liveDirty = 30; }
    $('#pauseH').textContent = online ? 'Menu' : 'Paused';
    const k = $('#pauseK');
    k.innerHTML = '<span class="k-num"></span><span class="k-rule"></span><span></span>';
    k.firstChild.textContent = `${G.score.r}–${G.score.b}`;
    k.lastChild.textContent = online ? 'Online · code ' + (OGNet.code || '') : 'Timeout';
    const b = $('#pauseBtns');
    b.innerHTML = online
      ? `<button class="btn btn-ink" data-act="resume">Back to the game</button>
         ${Net.guestAway() ? '<button class="btn btn-blue" data-act="n-find">Find a new opponent</button>' : ''}
         <button class="btn btn-soft" data-act="howto">How to play</button>
         <button class="btn btn-soft sound-row" data-act="sound"></button>
         <button class="btn btn-red" data-act="leave">${G.mode === 'host' ? 'End game for both' : 'Leave game'}</button>`
      : `<button class="btn btn-ink" data-act="resume">Resume</button>
         <button class="btn btn-soft" data-act="restart">Restart</button>
         ${G.mode === 'cpu' ? '<div class="seg-row"><span class="seg-l">Computer</span><div class="seg" data-seg="level" role="radiogroup" aria-label="Computer player"></div></div>' : ''}
         <button class="btn btn-soft" data-act="howto">How to play</button>
         <button class="btn btn-soft sound-row" data-act="sound"></button>
         <button class="btn btn-red" data-act="quit">Quit to menu</button>`;
    syncSoundBtns();
    paintLevels();
    openModal($('#pause'), els.menuBtn);
  }
  function resume() { closeModal($('#pause')); G.paused = false; lastT = performance.now(); }

  function showWin(w, quiet) {
    if (screen !== 'game') return;
    closeAllModals();
    const m = $('#win');
    m.dataset.p = w;
    const mine = G.me ? w === G.me : null;
    let word;
    if (G.mode === 'cpu') word = mine ? 'You win' : 'Computer wins';
    else if (isOnline()) word = mine ? 'You win' : `${G.names[w] || TEAM[w]} wins`;
    else word = `${TEAM[w]} wins`;
    const h = $('#winH');
    h.textContent = word;
    h.style.fontSize = `min(calc(var(--bh) * .78), ${Math.round(Math.min(app.clientWidth, 600) * 1.75 / Math.max(6, word.length))}px)`;
    const sc = $('#winScore');
    sc.innerHTML = `<span class="ws r"><em>${SYM.r}<span></span></em><b></b></span><span class="ws-mid">VS</span><span class="ws b"><b></b><em><span></span>${SYM.b}</em></span>`;
    for (const p of ['r', 'b']) {
      sc.querySelector(`.ws.${p} em span`).textContent = G.names[p] || TEAM[p];
      sc.querySelector(`.ws.${p} b`).textContent = G.score[p];
    }
    const notes = mine === false ? ['So close. Run it back?', 'Shake it off. Rematch?', 'Next one’s yours.'] : ['On guard, and on top.', 'What a tilt!', 'Steady hands.'];
    $('#winNote').textContent = notes[Math.floor(Math.random() * notes.length)];
    const online = isOnline();
    $('#winBtns').innerHTML = `<button class="btn btn-team btn-wide" data-act="rematch" id="rematchBtn">Rematch</button>
      <button class="btn btn-soft btn-wide" data-act="${online ? 'leave' : 'quit'}">${online ? 'Leave' : 'Menu'}</button>`;
    openModal(m, els.menuBtn);
    paintSeries();
    if (!quiet) { FX.rain(w, 150); Snd.play('win'); }
    if (online) Net.syncRematch();
  }

  /* ---------- clicks ---------- */
  app.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const act = b.dataset.act;
    if (act !== 'sound') Snd.play('tap');
    switch (act) {
      case 'sound': Snd.set(!Snd.on); break;
      case 'local': enterGame('local'); break;
      case 'cpu': paintLevels(); openModal($('#diff'), b); break;
      case 'cpu-go': enterGame('cpu', 'r'); break;
      case 'level': setLevel(b.dataset.level); break;
      case 'ready': Net.ready(); break;
      case 'online': Net.open(); break;
      case 'howto': openModal($('#howto'), b); break;
      case 'close': closeModal(b.closest('.modal')); break;
      case 'title': toTitle(); break;
      case 'pause': openPause(); break;
      case 'resume': resume(); break;
      case 'restart': freshMatch(); break;
      case 'quit': toTitle(); break;
      case 'leave':
        if (G.mode === 'host' && !b.dataset.armed && (modalOpen('pause') || modalOpen('drop'))) { b.dataset.armed = '1'; b.textContent = 'Tap again to end it'; setTimeout(() => { if (b.isConnected) { delete b.dataset.armed; b.textContent = 'End game for both'; } }, 4000); break; }
        toTitle(); break;
      case 'rematch':
        if (isOnline()) Net.rematch(b);
        else freshMatch();
        break;
      default: Net.act(act, b);
    }
  });
  // the how-to sheet closes when tapping outside it
  $$('.modal').forEach((m) => m.addEventListener('click', (e) => { if (e.target === m && (m.id === 'howto' || m.id === 'diff')) closeModal(m); }));
  // the level picker works like radio buttons: arrow keys move the choice
  app.addEventListener('keydown', (e) => {
    const b = e.target.closest && e.target.closest('[data-seg="level"] [role="radio"]');
    if (!b || !/^Arrow/.test(e.key)) return;
    e.preventDefault(); e.stopPropagation();
    const i = LEVELS.findIndex((l) => l[0] === G.level), n = LEVELS[(i + (e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : LEVELS.length - 1)) % LEVELS.length][0];
    setLevel(n);
    const nb = b.parentNode.querySelector(`[data-level="${n}"]`);
    if (nb) nb.focus();
  });

  /* ================================================================
     Online
     ================================================================ */
  const Net = (() => {
    const panel = $('#onlinePanel'), liveEl = $('#ogLive');
    let loading = null;
    let R0 = null; // room view: { code, isHost, meta, players, guestUid, ... }
    let attempt = null; // the create / join in flight: { cancelled }
    const savedName = () => store.get('og-name') || store.get('bl-name') || '';
    const saveName = (n) => store.set('og-name', n);
    const CHEV = '<svg class="mb-a" viewBox="0 0 24 24" aria-hidden="true"><path d="m8 4 8 8-8 8" fill="none" stroke="currentColor" stroke-width="2.8"/></svg>';
    const kick = (a, b) => `<p class="kicker"><span class="k-num">${a}</span><span class="k-rule"></span><span>${b}</span></p>`;
    /** news for screen readers (the only live region on the online screen) */
    const say = (t) => { if (liveEl && liveEl.textContent !== t) liveEl.textContent = t; };
    const SESSION = Math.random().toString(36).slice(2, 10); // this page load, so a guest can tell when the host reloaded

    function load() {
      if (window.OGNet) return Promise.resolve(window.OGNet);
      if (loading) return loading;
      loading = new Promise((res, rej) => {
        const s = document.createElement('script');
        s.src = 'net.js?v=8';
        s.onload = () => (window.OGNet ? res(window.OGNet) : rej(new Error('Online play didn’t load.')));
        s.onerror = () => { loading = null; s.remove(); rej(new Error('Can’t reach the game server. Check your internet connection.')); };
        document.head.append(s);
      });
      return loading;
    }

    function show(html) {
      panel._html = '';
      panel.innerHTML = html;
      panel.style.animation = 'none'; void panel.offsetWidth; panel.style.animation = '';
      const f = panel.querySelector('input:not([value=""]) ~ input, input, button.btn, button.mbtn');
      if (f && !touchy) setTimeout(() => f.focus({ preventScroll: true }), 60);
    }
    /** back out of a create / join that hasn't finished: it cleans up after itself and never opens a room */
    function cancelAttempt() { if (attempt) attempt.cancelled = true; attempt = null; }
    function open(code) {
      if (screen === 'game') return;
      cancelAttempt();
      setScreen('online');
      applyLayout(true);
      if (code) return joinForm(code);
      show(`${kick('Online', 'Two devices')}<h2>Play online</h2>
        <p>Each player uses their own phone or computer. One person starts a game and sends the 4-letter code.</p>
        <div class="stack">
          <button class="mbtn mbtn-red" data-act="n-create"><span class="mb-n"></span><span class="mb-t">Start a game</span><span class="mb-s">you’ll play Red</span>${CHEV}</button>
          <button class="mbtn mbtn-blue" data-act="n-join"><span class="mb-n"></span><span class="mb-t">Join a game</span><span class="mb-s">type the code you were sent</span>${CHEV}</button>
        </div>`);
      load().catch(() => {}); // warm up
    }
    /** run a create / join; if the player backs out first, nothing is shown and nothing is left behind */
    async function attemptRoom(text, make, retry) {
      cancelAttempt();
      const tok = attempt = { cancelled: false };
      busy(text);
      try {
        const N = await load();
        if (tok.cancelled) return;
        const r = await make(N, tok);
        if (tok.cancelled) { try { N.leave(); } catch (e) {} return; }
        attempt = null;
        enterRoom(r);
      } catch (err) {
        if (tok.cancelled || (err && err.cancelled)) return;
        attempt = null;
        fail(err, retry);
      }
    }
    function createForm() {
      show(`${kick('Host', 'You play Red')}<h2>Start a game</h2>
        <p>You’ll get a code to send to the person you’re playing.</p>
        <form class="form" id="ogCreate"><label>Your name<input id="ogName" maxlength="16" autocomplete="nickname" required placeholder="e.g. Grandpa" value="${esc(savedName())}"></label>
        <p class="err" id="ogErr" role="alert"></p>
        <button class="btn btn-red btn-wide" type="submit">Create game</button></form>
        <button class="link-btn" type="button" data-act="n-home">Back</button>`);
      $('#ogCreate').addEventListener('submit', (e) => {
        e.preventDefault();
        const name = $('#ogName').value.trim().slice(0, 16);
        if (!name) { $('#ogErr').textContent = 'Please type your name.'; return; }
        saveName(name);
        attemptRoom('Making your game…', (N, tok) => N.create(name, tok), createForm);
      });
    }
    function joinForm(code) {
      show(`${kick('Guest', 'You play Blue')}<h2>Join a game</h2>
        <p>Type the 4-letter code from the person who started the game.</p>
        <form class="form" id="ogJoin"><label>Join code<input id="ogCode" class="code-in" maxlength="4" autocapitalize="characters" autocomplete="off" autocorrect="off" spellcheck="false" required placeholder="ABCD" value="${esc(code || '')}"></label>
        <label>Your name<input id="ogName" maxlength="16" autocomplete="nickname" required placeholder="e.g. Sam" value="${esc(savedName())}"></label>
        <p class="err" id="ogErr" role="alert"></p>
        <button class="btn btn-blue btn-wide" type="submit">Join game</button></form>
        <button class="link-btn" type="button" data-act="n-home">Back</button>`);
      const ci = $('#ogCode');
      ci.addEventListener('input', () => { ci.value = ci.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4); $('#ogErr').textContent = ''; });
      $('#ogJoin').addEventListener('submit', (e) => {
        e.preventDefault();
        const c = ci.value.trim().toUpperCase(), name = $('#ogName').value.trim().slice(0, 16);
        if (c.length !== 4) { $('#ogErr').textContent = 'The code is 4 letters, like ABCD.'; ci.focus(); return; }
        if (!name) { $('#ogErr').textContent = 'Please type your name.'; $('#ogName').focus(); return; }
        saveName(name);
        attemptRoom('Joining…', (N, tok) => N.join(c, name, tok), () => joinForm(c));
      });
    }
    function busy(t) { show(`<div class="spinner" aria-hidden="true"></div><p>${esc(t)}</p><button class="link-btn" type="button" data-act="n-home">Cancel</button>`); say(t); }
    function friendly(m) {
      if (/PERMISSION_DENIED|permission/i.test(m)) return 'That didn’t work. Please check the code and try again.';
      if (/network|offline|unavailable|referer|referrer|api-key|auth\//i.test(m)) return 'Can’t reach the game server. Check your internet connection.';
      return m;
    }
    function fail(err, retry) {
      console.info('On Guard online:', err && err.message);
      R0 = null;
      const text = friendly((err && err.message) || 'Something went wrong.');
      show(`${kick('Error', 'Online')}<h2>Hmm…</h2><p>${esc(text)}</p>
        <div class="stack"><button class="btn btn-ink" data-act="n-retry">Try again</button></div>
        <button class="link-btn" type="button" data-act="n-home">Back</button>`);
      say(text);
      panel._retry = retry;
    }

    /* ----- room ----- */
    function enterRoom(r) {
      R0 = { code: r.code, isHost: r.isHost, uid: r.uid, meta: null, players: {}, gotPlayers: false, guestUid: null, conn: true,
        seated: false, restoring: false, restoreGen: 0, restoreT: 0, startT: 0, keptWaiting: false,
        lastState: null, lastRecv: 0, rm: 0, rd: 0, shownGoalN: -1, shownGame: 0,
        snap: null, hs: '', lastTs: null, offset: null, offT: 0, lead: 0, trip: 0, ex: 0, ey: 0, tiredFlip: 0,
        sentKey: '', sentAt: 0, t0: 0, seatT: 0, hostGoneT: 0, dropT: 0 };
      try { history.replaceState(history.state, '', `${location.pathname}?join=${r.code}${TEST ? '&test' : ''}`); } catch (e) {}
      OGNet.on({
        meta: (m) => {
          if (!R0) return;
          const had = R0.meta; R0.meta = m;
          if (!m) return closed(had ? 'The game was closed.' : 'That game isn’t there anymore.');
          if (!R0.isHost) { G.series = cleanSeries(m.series); paintSeries(); }
          update();
        },
        players: (p) => { if (!R0) return; R0.players = p && typeof p === 'object' ? p : {}; R0.gotPlayers = true; update(); },
        state: (s) => onState(s),
        conn: (on) => onConn(on),
        taken: () => { if (R0) closed('This game is now open in another tab.', 'Opened elsewhere'); },
        evicted: () => { if (R0 && !R0.isHost) closed(R0.seated ? 'The host is looking for a new opponent.' : 'That game already has two players.'); },
        error: (e) => console.warn(e),
      });
      waiting();
    }
    function onConn(on) {
      if (!R0) return;
      R0.conn = on;
      if (screen === 'game') {
        if (!on) { releaseAll(); toast('Reconnecting…', 0); R0.connToast = true; }
        else if (R0.connToast) { R0.connToast = false; hideToast(); }
      }
      hostHold();
    }
    const rec = (uid) => { const p = R0 && uid && R0.players[uid]; return p && typeof p === 'object' ? p : null; };
    const nameOf = (uid) => { const p = rec(uid); return p && typeof p.name === 'string' && p.name ? p.name.slice(0, 16) : 'Someone'; };
    const online = (uid) => { const p = rec(uid); return !!(p && p.online !== false); };
    const named = (p) => !!(p && typeof p === 'object' && typeof p.name === 'string' && p.name);
    const validGuest = (p) => named(p) && p.v === (window.OGNet ? OGNet.V : 5);
    const numEq = (v, n) => typeof v === 'number' && Number.isInteger(v) && v === n;
    const jTime = (p) => (p && typeof p.joined === 'number' && Number.isFinite(p.joined) ? p.joined : Number.MAX_SAFE_INTEGER);
    function pickGuest() {
      if (!R0 || !R0.meta) return null;
      const mg = typeof R0.meta.guest === 'string' ? R0.meta.guest : null;
      if (R0.meta.status === 'playing') return mg && validGuest(R0.players[mg]) ? mg : null;
      if (mg && validGuest(R0.players[mg])) return mg;
      const c = Object.entries(R0.players).filter(([id, p]) => id !== R0.meta.host && validGuest(p) && p.online !== false)
        .sort((a, b) => (jTime(a[1]) - jTime(b[1])) || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
      return c.length ? c[0][0] : null;
    }
    const clearT = (k) => { if (R0 && R0[k]) { clearTimeout(R0[k]); R0[k] = 0; } };
    function resetLobby(drop) {
      if (!R0 || R0.resetting) return;
      R0.resetting = true;
      try {
        clearT('seatT');
        if (drop) OGNet.prune(drop);
        OGNet.setMeta({ status: 'lobby', guest: null, series: null });
        OGNet.clearState();
      } finally { if (R0) R0.resetting = false; }
    }

    function waiting() {
      if (!R0) return;
      const host = R0.meta ? R0.meta.host : R0.isHost ? R0.uid : null;
      const g = pickGuest();
      const hostOn = R0.isHost || !R0.gotPlayers || online(host);
      const playingWait = R0.isHost && R0.meta && R0.meta.status === 'playing' && g && !online(g);
      const hostLi = `<li class="r${hostOn ? '' : ' away'}">${SYM.r}<span>${esc(host ? nameOf(host) : '…')}${host === R0.uid ? ' (you)' : hostOn ? '' : ' · not connected'}</span><em>Red</em></li>`;
      const guestLi = g ? `<li class="b${online(g) ? '' : ' away'}">${SYM.b}<span>${esc(nameOf(g))}${g === R0.uid ? ' (you)' : online(g) ? '' : ' · reconnecting'}</span><em>Blue</em></li>`
        : '<li class="b wait">Waiting for someone to join<span class="spin-dots"><b></b><b></b><b></b></span></li>';
      const letters = R0.code.split('');
      const hostTip = R0.restoring ? 'Getting your game back…'
        : playingWait ? `${esc(nameOf(g))} isn’t connected right now. Your game picks up when they’re back.`
        : `On their phone or computer, they open <b>bestlifecards.com/onguard</b>, tap <b>Play online → Join a game</b>, and type <b>${R0.code}</b>.`;
      const html = R0.isHost
        ? `${kick('Room', 'Send this code')}<h2>Your join code</h2>
          <button class="bigcode" type="button" data-act="n-copy" aria-label="Join code ${letters.join(' ')}. Tap to copy the invite link.">${letters.map((c) => `<span>${c}</span>`).join('')}</button>
          <p class="code-hint" id="ogHint">Tap the code to copy the invite link</p>
          <p class="tip" id="ogTip">${hostTip}</p>
          <div class="stack"><button class="btn btn-blue" data-act="n-share">Send the invite</button>${playingWait || R0.restoring ? '<button class="btn btn-soft" type="button" data-act="n-find">Find a new opponent</button>' : ''}</div>
          <ul class="who">${hostLi}${guestLi}</ul>
          <button class="link-btn" type="button" data-act="n-leave">Cancel</button>`
        : hostOn
          ? `${kick('Room ' + R0.code, 'Get ready')}<h2>You’re in!</h2><p>The game opens as soon as you’re both here.</p>
            <ul class="who">${hostLi}${guestLi}</ul>
            <button class="link-btn" type="button" data-act="n-leave">Leave</button>`
          : `${kick('Room ' + R0.code, 'Hold on')}<h2>Waiting for host…</h2><p>${esc(host ? nameOf(host) : 'The host')} isn’t connected right now. The game opens when they’re back.</p>
            <ul class="who">${hostLi}${guestLi}</ul>
            <button class="link-btn" type="button" data-act="n-leave">Leave</button>`;
      if (panel._html === html) return;
      panel._html = html;
      panel.innerHTML = html;
      if (!R0.isHost) say(hostOn ? 'You’re in. The game opens as soon as you’re both here.' : 'Waiting for the host to reconnect.');
    }

    function closed(text, title) {
      const was = R0;
      if (!was) return;
      clearT('seatT'); clearT('hostGoneT'); clearT('dropT'); clearT('restoreT'); clearT('startT');
      R0 = null;
      // a guest takes their own name off the list on the way out, so nobody can pick a player who isn't there
      try { OGNet.leave(was.isHost || !was.meta || !named(was.players[was.uid])); } catch (e) {}
      closeAllModals(); hideToast(); releaseAll();
      setScreen('online');
      if (isOnline()) { startDemo(); clearOverlays(); applyLayout(true); keepAwake(false); }
      show(`${kick('Online', 'Closed')}<h2>${esc(title || 'Game over')}</h2><p>${esc(text)}</p><div class="stack"><button class="btn btn-blue" data-act="n-home">Play online again</button></div>
        <button class="link-btn" type="button" data-act="title">Back to the menu</button>`);
      say(text);
      cleanURL();
    }

    /* everything that depends on the room's meta + players */
    function update() {
      if (!R0 || !R0.meta || !R0.gotPlayers) return;
      const m = R0.meta;
      if (R0.isHost) {
        const g = screen === 'game' ? R0.guestUid : pickGuest();
        // one guest seat: anyone else on the list (a second joiner, wrong version, nameless stray) comes off it
        for (const id of Object.keys(R0.players)) if (id !== m.host && id !== R0.uid && id !== g) OGNet.prune(id);
        if (screen !== 'game') {
          if (R0.starting && (!R0.guestUid || !validGuest(R0.players[R0.guestUid]))) {
            R0.restoreGen++; clearT('restoreT'); clearT('startT');
            R0.starting = false; R0.restoring = false; R0.guestUid = null;
          }
          if (!R0.starting) {
            if (m.status === 'playing') {
              clearT('seatT');
              if (!g) { resetLobby(); waiting(); return; }
            } else {
              const mg = typeof m.guest === 'string' ? m.guest : null;
              if (!g && (mg || m.series)) resetLobby();
              else if (g && mg && g !== mg) { OGNet.setMeta({ status: 'lobby', guest: g, series: null }); OGNet.clearState(); }
              else if ((g || null) !== mg) OGNet.setMeta({ guest: g || null });
              if (g && !online(g)) {
                // lobby only: hold the seat a moment, then reset to a clean lobby
                if (!R0.seatT) R0.seatT = setTimeout(() => { if (!R0) return; R0.seatT = 0; if (screen !== 'game' && !R0.starting && R0.meta && R0.meta.status === 'lobby' && pickGuest() === g && !online(g)) resetLobby(g); }, 8000);
              } else clearT('seatT');
            }
          }
          waiting();
          if (g && online(g) && !R0.starting) {
            R0.starting = true;
            R0.guestUid = g;
            const room = R0;
            const gen = ++R0.restoreGen;
            if (m.status === 'playing') {
              // after a reload, pick the match back up; retry with backoff if readState fails
              R0.restoring = true;
              waiting();
              toastIn('Getting your game back…');
              say('Getting your game back…');
              let delay = TEST ? 150 : 400;
              const tryRead = () => {
                if (R0 !== room || R0.restoreGen !== gen || screen === 'game') return;
                OGNet.readState().then((prev) => {
                  if (R0 !== room || R0.restoreGen !== gen || screen === 'game') return;
                  R0.restoring = false;
                  R0.startT = setTimeout(() => { if (R0 === room && R0.restoreGen === gen) { R0.startT = 0; startHostGame(prev); } }, 900);
                }, () => {
                  if (R0 !== room || R0.restoreGen !== gen || screen === 'game') return;
                  toastIn('Getting your game back…');
                  R0.restoreT = setTimeout(tryRead, delay);
                  delay = Math.min(delay * 2, TEST ? 800 : 4000);
                });
              };
              tryRead();
            } else {
              Snd.play('join');
              toastIn(`${nameOf(g)} joined!`);
              say(`${nameOf(g)} joined.`);
              R0.startT = setTimeout(() => { if (R0 === room && R0.restoreGen === gen) { R0.startT = 0; startHostGame(null); } }, 900);
            }
          }
        } else {
          // in game: watch the guest
          const gid = R0.guestUid;
          const gp = rec(gid);
          if (!gid || !validGuest(gp)) { backToLobby(`${G.names.b || 'The other player'} left the game. Send the code to someone else, or cancel.`); return; }
          if ((G.phase === 'goal' || G.phase === 'count') && G.grip.tired.b && !guestLv()) G.grip.tired.b = false;
          const me = rec(R0.uid);
          const rdB = numEq(gp.rd, G.game);
          const myRd = !!(me && numEq(me.rd, G.game));
          if (myRd) R0.rd = G.game;
          const rdR = R0.rd === G.game || myRd;
          if (G.phase === 'ready' && (rdB !== G.ready.b || rdR !== G.ready.r)) {
            if (rdB && !G.ready.b) Snd.play('tap');
            G.ready.b = rdB; G.ready.r = rdR;
            paintReady();
          }
          hostHold();
          syncRematch();
        }
      } else {
        const myRec = rec(R0.uid);
        if (m.guest === R0.uid && named(myRec)) R0.seated = true;
        if (!named(myRec)) return closed(R0.seated ? 'The host is looking for a new opponent.' : 'That game already has two players.');
        if (m.guest && m.guest !== R0.uid) return closed(R0.seated ? 'The host is looking for a new opponent.' : 'That game already has two players.');
        const hostOn = online(m.host);
        if (m.status === 'playing' && m.guest === R0.uid && screen !== 'game') startGuestGame();
        else if (m.status === 'lobby' && screen === 'game') { // host went back to the lobby
          closeAllModals(); hideToast(); releaseAll();
          setScreen('online'); startDemo(); clearOverlays(); applyLayout(true); panel._html = ''; waiting();
        } else if (screen !== 'game') waiting();
        if (screen === 'game') {
          clearT('hostGoneT');
          if (!hostOn) toast(`${nameOf(m.host)} lost connection. Waiting…`, 0);
          else if (R0.hostAway) hideToast();
          R0.hostAway = !hostOn;
          guestReady();
          syncRematch();
        } else if (!hostOn) {
          // the host closed the lobby (or lost their connection): give them a moment, then say so
          if (!R0.hostGoneT) R0.hostGoneT = setTimeout(() => { if (!R0) return; R0.hostGoneT = 0; if (screen !== 'game' && !online(R0.meta && R0.meta.host)) closed(`${nameOf(R0.meta && R0.meta.host)} left before the game started. Ask them for a new code, or start a game yourself.`, 'The host left'); }, TEST ? 4000 : 20000);
        } else clearT('hostGoneT');
      }
    }
    function toastIn(t) { const tip = $('#ogTip'); if (tip) { tip.textContent = t; tip.classList.add('flash'); } }

    function names() {
      const m = R0.meta || {};
      return { r: nameOf(m.host), b: nameOf(R0.isHost ? R0.guestUid : R0.uid) };
    }

    /* ----- host ----- */
    function guestAway() { return !!(R0 && R0.isHost && R0.guestUid && !online(R0.guestUid)); }
    /** Only the host runs the game, so it stops while either player is offline (nobody scores against an
        empty chair, or on a board the host can't share), and picks up with a fresh countdown for both. */
    function hostHold() {
      if (!R0 || !R0.isHost || screen !== 'game' || G.mode !== 'host') return;
      const gid = R0.guestUid, gAway = !online(gid), away = gAway || R0.conn === false;
      if (gAway) {
        if (R0.conn !== false) toast(`Waiting for ${nameOf(gid)} to come back…`, 0);
        if (!R0.dropT && !modalOpen('drop') && !R0.keptWaiting) R0.dropT = setTimeout(() => { if (!R0) return; R0.dropT = 0; if (screen === 'game' && !online(R0.guestUid)) openDrop(); }, TEST ? 1500 : 5000);
      } else {
        R0.keptWaiting = false;
        clearT('dropT');
        if (modalOpen('drop')) closeModal($('#drop'));
        const fnBtn = modalOpen('pause') && $('#pauseBtns [data-act="n-find"]');
        if (fnBtn) fnBtn.remove();
      }
      if (away && !G.hold) { G.hold = true; releaseAll(); }
      else if (!away && G.hold) {
        G.hold = false;
        hideToast();
        if (G.phase === 'play' || G.phase === 'count') { resetMatch(true); clearOverlays(); }
      }
    }
    function openDrop() {
      if (!R0 || modalOpen('drop') || modalOpen('win')) return;
      const n = nameOf(R0.guestUid);
      $('#dropH').textContent = `${n} dropped out`;
      $('#dropP').textContent = `${n} lost their connection. The game is on hold and picks up if they come back.`;
      $('#dropK').textContent = 'Code ' + R0.code;
      closeAllModals();
      openModal($('#drop'), els.menuBtn);
    }
    /** keep the room and its code, and wait for someone new */
    function findNew() {
      if (!R0 || !R0.isHost) return;
      const drop = R0.guestUid || (R0.meta && typeof R0.meta.guest === 'string' && R0.meta.guest) || pickGuest();
      backToLobby('Send the code to someone new. The game opens when they join.', drop);
    }

    function startHostGame(prev) {
      if (!R0 || !R0.isHost) return;
      R0.starting = false; R0.restoring = false;
      const g = R0.guestUid;
      if (!g || !online(g)) { R0.guestUid = null; waiting(); update(); return; }
      G.names = names();
      enterGame('host', 'r');
      G.series = cleanSeries(R0.meta && R0.meta.series, true);
      R0.t0 = OGNet.now() - performance.now(); // one clock for the whole session: server time, ticking with this page
      R0.sentKey = ''; R0.sentAt = 0;
      const mine = rec(R0.uid);
      const pv = cleanState(prev);
      if (pv) {
        // the host reloaded mid-match: same game number, same score
        G.game = pv.n; G.score = { r: pv.sr, b: pv.sb }; G.goalN = pv.gn; G.firstPoint = pv.sr + pv.sb === 0;
        R0.rm = mine && numEq(mine.rm, G.game) ? G.game : 0;
        paintHUD(true);
        if (pv.p === 3 || pv.sr >= TARGET || pv.sb >= TARGET) {
          // it had already been won: straight back to the result, not one more point
          const w = pv.sr >= pv.sb ? 'r' : 'b';
          G.phase = 'over'; G.t = 0;
          if (G.series.n !== G.game) { G.series[w]++; G.series.n = G.game; saveSeries(); }
          showWin(w, true);
        } else if (pv.p === 4) {
          awaitReady();
          if (mine && numEq(mine.rd, G.game)) { R0.rd = G.game; G.ready.r = true; }
          G.ready.b = !!(rec(g) && numEq(rec(g).rd, G.game));
          paintReady();
        }
      } else {
        G.game = int(R0.meta && R0.meta.games, 0, 1e6, 0) + 1;
        R0.rm = 0; R0.rd = 0;
        hitStat('og_onlineStarted');
        awaitReady();
      }
      paintSeries();
      OGNet.setMeta({ status: 'playing', guest: g, games: G.game });
    }
    function backToLobby(text, drop) {
      if (!R0) return;
      R0.restoreGen++;
      clearT('dropT'); clearT('seatT'); clearT('restoreT'); clearT('startT');
      R0.guestUid = null; R0.starting = false; R0.restoring = false; R0.keptWaiting = false;
      closeAllModals(); hideToast(); releaseAll();
      // leave the game screen first: the writes below call straight back into update()
      if (screen !== 'online' || isOnline()) { setScreen('online'); startDemo(); clearOverlays(); applyLayout(true); keepAwake(false); }
      resetLobby(drop);
      panel._html = '';
      waiting();
      toastIn(text);
      say(text);
    }
    function saveSeries() { if (R0 && R0.isHost) OGNet.setMeta({ series: { r: G.series.r, b: G.series.b, n: G.series.n || 0 } }); }

    /* host: send the game ~30x a second while playing and slower otherwise; anything that changes the
       phase, the score or who's ready goes out at once; after the final whistle, nothing until the next match */
    function hostSend(now) {
      if (!R0 || !R0.isHost || screen !== 'game' || G.mode !== 'host') return;
      const p = PHASES.indexOf(G.phase);
      const m = G.phase === 'play' ? G.mask : 0;
      const key = [p, G.goalN, G.score.r, G.score.b, G.game, G.hold ? 1 : 0, G.ready.r ? 1 : 0, G.ready.b ? 1 : 0, m].join();
      if (key === R0.sentKey) {
        if (G.phase === 'over') return;
        const every = G.phase === 'play' && !G.hold ? 33 : G.phase === 'ready' ? 600 : 150;
        if (now - R0.sentAt < every) return;
      }
      R0.sentKey = key; R0.sentAt = now;
      const st = {
        x: Math.round(G.s.x * 10) / 10, y: Math.round(G.s.y * 10) / 10, vx: Math.round(G.s.vx), vy: Math.round(G.s.vy),
        m: G.phase === 'play' ? G.mask : 0, p, pt: Math.round(Math.max(0, G.t) * 1000),
        sr: G.score.r, sb: G.score.b, gn: G.goalN, gp: G.goalPocket, n: G.game,
        er: Math.round(G.grip.e.r * 100), eb: Math.round(G.grip.e.b * 100), tr: (G.grip.tired.r ? 1 : 0) | (G.grip.tired.b ? 2 : 0),
        w: G.hold ? 1 : 0, ts: Math.round(R0.t0 + now), hs: SESSION,
        ls: P.leverPack(G.s), // all 4 levers: depth (10b), up/held timers (4 ms), tap flag
      };
      OGNet.sendState(st);
    }
    function guestLv() {
      if (!R0 || !R0.guestUid) return 0;
      const p = rec(R0.guestUid);
      const lv = p && p.online !== false ? p.lv : 0;
      return Number.isInteger(lv) && lv >= 0 && lv <= 3 ? lv : 0;
    }

    /* ----- ready-up: both tap Ready, then the host starts the countdown ----- */
    function ready() {
      if (!R0 || G.phase !== 'ready' || !G.me || G.ready[G.me]) return;
      R0.rd = G.game;
      OGNet.setMine({ rd: G.game });
      G.ready[G.me] = true;
      paintReady();
    }
    function guestReady() {
      if (!R0 || R0.isHost || G.mode !== 'guest' || G.phase !== 'ready') return;
      const h = rec(R0.meta && R0.meta.host), me = rec(R0.uid);
      const r = !!(h && numEq(h.rd, G.game));
      const mine = !!(me && numEq(me.rd, G.game));
      if (mine) R0.rd = G.game;
      const b = R0.rd === G.game || mine;
      if (r === G.ready.r && b === G.ready.b) return;
      if (r && !G.ready.r) Snd.play('tap');
      G.ready = { r, b };
      paintReady();
    }

    /* ----- guest: mirror the host ----- */
    function resetGuestLevers() {
      P.leverReset(G.s);
      P.leverReset(myLev);
      myLv.length = 0;
    }
    function startGuestGame() {
      G.names = names();
      enterGame('guest', 'b');
      G.series = cleanSeries(R0.meta && R0.meta.series);
      paintSeries();
      G.s.live = false;
      G.phase = ''; // until the host's first word arrives
      R0.snap = null; R0.offset = null; R0.lastTs = null; R0.hs = ''; R0.shownGoalN = -1; R0.shownGame = 0; R0.lastRecv = performance.now();
      resetGuestLevers();
      if (R0.lastState) onState(R0.lastState);
    }
    /** Whatever the host wrote, turn it into plain numbers in range (or nothing at all), so a broken or
        hostile host can't crash the page or get text onto it. */
    const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
    const int = (v, lo, hi, d) => (isNum(v) ? clamp(Math.round(v), lo, hi) : d);
    const LEV_IDLE = P.leverPack(P.create())[0];
    function cleanLevers(v) {
      if (!Array.isArray(v) || v.length < 4) return null;
      return [
        int(v[0], 0, 0x1ffffff, LEV_IDLE), int(v[1], 0, 0x1ffffff, LEV_IDLE),
        int(v[2], 0, 0x1ffffff, LEV_IDLE), int(v[3], 0, 0x1ffffff, LEV_IDLE),
      ];
    }
    function cleanState(s) {
      if (!s || typeof s !== 'object' || !isNum(s.x) || !isNum(s.y) || !isNum(s.ts)) return null;
      const mx = P.X - P.BALL, my = P.Y - P.BALL, vm = P.K.VMAX * 1.2;
      return {
        x: clamp(s.x, -mx, mx), y: clamp(s.y, -my, my),
        vx: isNum(s.vx) ? clamp(s.vx, -vm, vm) : 0, vy: isNum(s.vy) ? clamp(s.vy, -vm, vm) : 0,
        m: int(s.m, 0, 15, 0), p: int(s.p, 0, PHASES.length - 1, 0), pt: int(s.pt, 0, 600000, 0),
        sr: int(s.sr, 0, TARGET, 0), sb: int(s.sb, 0, TARGET, 0),
        gn: int(s.gn, 0, 1e6, 0), gp: int(s.gp, -1, P.POCKETS.length - 1, -1), n: int(s.n, 1, 1e6, 1),
        er: int(s.er, 0, 100, 100), eb: int(s.eb, 0, 100, 100), tr: int(s.tr, 0, 3, 0),
        w: s.w === 1 || s.w === true, ts: s.ts, ls: cleanLevers(s.ls),
        hs: typeof s.hs === 'string' || isNum(s.hs) ? String(s.hs).slice(0, 24) : '',
      };
    }
    function cleanSeries(v, withN) {
      const o = { r: int(v && v.r, 0, 999, 0), b: int(v && v.b, 0, 999, 0) };
      if (withN) o.n = int(v && v.n, 0, 1e6, 0);
      return o;
    }
    function setTiredB(v, now, fromHost) {
      if (G.grip.tired.b === v) return;
      const grace = Math.max(300, R0 ? Math.round((R0.trip || 0) * 2.2) : 300);
      if (fromHost && now - R0.tiredFlip < grace) return; // the host's news is a moment old: it mustn't undo what just happened here
      G.grip.tired.b = v;
      R0.tiredFlip = now;
      if (v) events.push({ k: 'tired', p: 'b' });
    }
    const LEAD_MAX = 120, AHEAD_MAX = 200;
    const myLv = []; // my recent lever changes [time, mask]: the host hears each one a moment after I make it
    const myMaskAt = (t) => { for (let i = myLv.length - 1; i >= 0; i--) if (myLv[i][0] <= t) return myLv[i][1]; return 0; };
    function onState(raw) {
      if (!R0) return;
      R0.lastState = raw;
      if (!raw || screen !== 'game' || G.mode !== 'guest') return;
      const s = cleanState(raw);
      if (!s) return;
      // drop out-of-order delayed snapshots from the same host session (e.g. under jitter)
      if (s.hs === R0.hs && R0.lastTs != null && s.ts < R0.lastTs && R0.lastTs - s.ts < 2000) return;
      const now = performance.now();
      if (TEST && G.phase === 'play') R0.stall = Math.max(R0.stall || 0, now - R0.lastRecv); // longest wait between snapshots
      R0.lastRecv = now;
      // a new host session (the host reloaded) or a jump in its clock: start the timing over
      const newSession = s.hs !== R0.hs;
      if (newSession || R0.lastTs == null || s.ts < R0.lastTs || s.ts > R0.lastTs + 2000) {
        R0.hs = s.hs; R0.offset = null; R0.snap = null; R0.ex = R0.ey = 0;
        if (newSession) resetGuestLevers();
      }
      R0.lastTs = s.ts;
      // offset = my clock minus the host's, measured on the quickest snapshots (so it includes the fastest trip)
      const off = now - s.ts;
      R0.offset = R0.offset == null ? off : Math.min(off, R0.offset + 0.02 * (now - R0.offT));
      R0.offT = now;
      // how long that fastest trip takes, from the server's clock on both devices; used to draw the marble
      // where it is now instead of where it was. If the two clocks disagree wildly, don't guess.
      const trip = R0.offset + (OGNet.now() - now);
      const lead = trip > -60 && trip < 1500 ? clamp(trip, 0, LEAD_MAX) : 0;
      const tripC = trip > -60 && trip < 1500 ? clamp(trip, 0, 220) : 0;
      R0.lead = R0.snap ? lerp(R0.lead, lead, 0.1) : lead;
      R0.trip = R0.snap ? lerp(R0.trip, tripC, 0.1) : tripC;
      const age = clamp(now - R0.offset + R0.lead - s.ts, 0, 400) / 1000; // how old this snapshot already is
      const prev = R0.snap;
      R0.snap = s;
      R0.fresh = true;
      // the guest doesn't run the game, so it hears the bumps from sudden changes in the marble's speed
      if (prev && s.p === 1 && prev.p === 1 && s.ts - prev.ts < 120) {
        const dv = Math.hypot(s.vx - prev.vx, s.vy - prev.vy);
        if (dv > 170) {
          const kind = Math.abs(s.x) > P.X - P.BALL - 6 || Math.abs(s.y) > P.Y - P.BALL - 6 ? 'edge' : Math.abs(s.x) > P.MOUTH - P.BALL ? 'wall' : 'peg';
          later(() => Snd.play(kind, dv * 0.75), clamp(-age * 1000, 0, 300));
        }
      }
      // a new game (rematch)
      if (s.n !== R0.shownGame) {
        epoch++;
        R0.shownGame = s.n; G.game = s.n; R0.shownGoalN = s.gn; R0.rm = 0; R0.rd = 0; G.phase = '';
        G.grip.reset(); R0.tiredFlip = 0;
        resetGuestLevers();
        G.score = { r: s.sr, b: s.sb }; G.goalN = s.gn; G.drop = null; G.glow = null;
        G.firstPoint = s.sr + s.sb === 0;
        paintHUD(true);
        if (modalOpen('win')) closeModal($('#win'));
        clearOverlays();
      }
      const phase = PHASES[s.p];
      const t = s.pt / 1000 + age;
      // push meters
      G.grip.e.r = s.er / 100; G.grip.tired.r = !!(s.tr & 1);
      setTiredB(!!(s.tr & 2), now, true);
      if (Math.abs(G.grip.e.b - s.eb / 100) > 0.12 || phase !== 'play') G.grip.e.b = s.eb / 100;
      R0.hostMask = s.m & 3;
      // the score comes from every snapshot; the goal counter only decides whether to celebrate
      const scored = s.gn > R0.shownGoalN && R0.shownGoalN >= 0 && s.gp >= 0 && s.p === 2;
      const moved = s.sr !== G.score.r || s.sb !== G.score.b;
      G.score = { r: s.sr, b: s.sb }; G.goalN = s.gn;
      R0.shownGoalN = s.gn;
      if (scored) {
        // a point: drop the marble from where we last drew it
        G.drop = { x: G.s.x, y: G.s.y, pocket: s.gp, t: 0 };
        G.phase = 'goal'; G.t = t;
        events.push({ k: 'goal', pocket: s.gp, color: P.POCKETS[s.gp].color });
      } else if (moved) paintHUD(true);
      // phase
      const home = () => { G.drop = null; G.s.x = G.s.y = G.s.vx = G.s.vy = 0; R0.ex = R0.ey = 0; resetGuestLevers(); };
      if (G.hold && !s.w) resetGuestLevers();
      if (phase === 'ready' && G.phase !== 'ready') { G.phase = 'ready'; G.t = 0; G.lastCount = -1; home(); clearOverlays(); }
      else if (phase === 'count' && G.phase !== 'count') { G.phase = 'count'; G.t = t; G.lastCount = -1; home(); }
      else if (phase === 'count') G.t = Math.abs(G.t - t) > 0.5 ? t : lerp(G.t, t, 0.3);
      else if (phase === 'play' && G.phase !== 'play') { G.phase = 'play'; G.t = t; G.firstPoint = false; G.drop = null; G.s.x = s.x; G.s.y = s.y; R0.ex = R0.ey = 0; }
      else if (phase === 'over' && G.phase !== 'over') { G.phase = 'over'; G.t = 0; events.push({ k: 'over', winner: s.sr >= s.sb ? 'r' : 'b' }); }
      else if (phase === 'goal' && G.phase !== 'goal' && G.phase !== 'over') { G.phase = 'goal'; G.t = t; }
      G.hold = s.w;
      guestReady();
    }
    const scratch = P.create();
    const myLev = P.create();
    function guestFrame(now, dt) {
      if (!R0) return;
      const play = G.phase === 'play' && !G.hold;
      // my push meter runs locally using my displayed lever depths so bottoming out answers immediately
      const myHands = P.handsOf('b', heldMask);
      if (play) {
        const was = G.grip.tired.b;
        G.grip.use('b', myHands, dt, G.s.press);
        if (was !== G.grip.tired.b) { R0.tiredFlip = now; if (!was) events.push({ k: 'tired', p: 'b' }); }
      } else if ((G.phase === 'goal' || G.phase === 'count') && G.grip.tired.b && !myHands) {
        setTiredB(false, now, false);
      }
      const myEff = play && !G.grip.tired.b ? myHands : 0;
      const myMask = P.maskFor('b', myEff);
      if (!myLv.length || myLv[myLv.length - 1][1] !== myMask) { myLv.push([now, myMask]); if (myLv.length > 64) myLv.shift(); }
      R0.tilt = play ? (R0.hostMask || 0) | myMask : 0; // what tilts the board
      R0.shown = R0.tilt | (G.phase === 'count' || G.phase === 'ready' ? P.maskFor('b', myHands) : 0); // my knobs also move while we wait
      if ((G.phase === 'count' || G.phase === 'goal') && !G.hold) G.t += dt;
      // The marble and levers: take the host's latest snapshot (with full lever state) and roll it forward to
      // "now" with the same physics (pegs and walls included), no more than a short, fixed way ahead. Each new
      // snapshot corrects the guess; differences are eased out over a few frames so nothing jumps.
      const l = R0.snap;
      if (play && l && l.p === 1 && R0.offset != null) {
        const ahead = clamp(now - R0.offset + R0.lead - l.ts, 0, AHEAD_MAX) / 1000;
        const sc = scratch;
        sc.x = l.x; sc.y = l.y; sc.vx = l.vx; sc.vy = l.vy; sc.live = true;
        P.leverUnpack(sc, l.ls);
        // the host's levers as of the snapshot, and mine as the host will have heard them by each moment
        const n = Math.round(ahead / P.K.DT), trip = R0.trip || R0.lead;
        const t0 = l.ts + R0.offset - 2 * trip, hm = l.m & 3;
        const nRed = Math.min(n, Math.round(0.105 / P.K.DT));
        let r0 = sc.press[0], r1 = sc.press[1];
        let i = 0;
        for (; i < n; i++) {
          if (i === nRed) { r0 = sc.press[0]; r1 = sc.press[1]; }
          if (P.step(sc, hm | myMaskAt(t0 + i * P.K.DT * 1000), P.K.DT) >= 0) break;
        }
        if (i <= nRed) { r0 = sc.press[0]; r1 = sc.press[1]; }
        const fresh = R0.fresh;
        if (fresh) {
          // where the marble would have been drawn without this snapshot, minus where it now says to draw it
          const ex = G.s.x + G.s.vx * dt - sc.x, ey = G.s.y + G.s.vy * dt - sc.y;
          if (Math.hypot(ex, ey) < 140) { R0.ex = ex; R0.ey = ey; } else R0.ex = R0.ey = 0;
          R0.fresh = false;
        } else { const k = Math.exp(-dt * 16); R0.ex *= k; R0.ey *= k; }
        const mx = P.X - P.BALL, my = P.Y - P.BALL;
        G.s.x = clamp(sc.x + R0.ex, -mx, mx); G.s.y = clamp(sc.y + R0.ey, -my, my);
        G.s.vx = sc.vx; G.s.vy = sc.vy;
        // When one-way trip exceeds LEAD_MAX (e.g. 150 ms), finish rolling Blue's corners to server "now"
        // using our known myLv history (Red stays capped at 105 ms to avoid release overshoot).
        if (i === n) {
          const extraMs = clamp(now - R0.offset + trip - l.ts, 0, 320) - ahead * 1000;
          if (extraMs > 1) {
            const en = Math.round((extraMs / 1000) / P.K.DT);
            const et0 = t0 + n * P.K.DT * 1000;
            for (let j = 0; j < en; j++) P.easePress(sc, myMaskAt(et0 + j * P.K.DT * 1000), P.K.DT);
          }
        }
        // Host corners (0, 1): track capped-extrapolation target smoothly with a per-frame step cap (<= 0.045)
        const rt = [r0, r1];
        for (let c = 0; c < 2; c++) {
          const next = G.s.press[c] + clamp(rt[c] - G.s.press[c], -0.045, 0.045);
          G.s.press[c] = (rt[c] === 0 && next < 1e-3) ? 0 : clamp(next, 0, 1);
        }
        // Guest's own corners (2, 3): advance locally for instant response, reconcile onto host-anchored sc.press
        for (let c = 2; c < 4; c++) {
          myLev.press[c] = G.s.press[c];
          if (((l.m >> c) & 1) && ((myMask >> c) & 1) && sc.held[c] > 0 && myLev.held[c] > 0 && sc.tap[c] !== myLev.tap[c]) {
            myLev.tap[c] = sc.tap[c]; myLev.held[c] = sc.held[c];
          }
        }
        P.easePress(myLev, myMask, dt);
        const mk = 1 - Math.exp(-dt * 15);
        for (let c = 2; c < 4; c++) {
          const blend = myLev.press[c] + (sc.press[c] - myLev.press[c]) * mk;
          const next = G.s.press[c] + clamp(blend - G.s.press[c], -0.04, 0.04);
          G.s.press[c] = (sc.press[c] === 0 && myLev.press[c] === 0 && next < 1e-3) ? 0 : clamp(next, 0, 1);
        }
      } else if (!G.hold) {
        P.easePress(G.s, 0, dt);
        P.easePress(myLev, 0, dt);
      }
      // the host went quiet
      const quiet = now - R0.lastRecv;
      if (quiet > 3500 && !R0.quietShown && screen === 'game' && G.phase !== 'over' && G.phase !== 'ready') { R0.quietShown = true; toast('Waiting for the other player’s connection…', 0); }
      else if (quiet < 1000 && R0.quietShown) { R0.quietShown = false; hideToast(); }
    }
    function shownMask() { return R0 && R0.shown != null ? R0.shown : heldMask & 12; }

    /* ----- rematch: both tap it ----- */
    function rematch(btn) {
      if (!R0) return;
      R0.rm = G.game;
      OGNet.setMine({ rm: G.game });
      if (btn) { btn.disabled = true; btn.textContent = 'Waiting for the other player…'; }
      if (R0.isHost) syncRematch();
    }
    function syncRematch() {
      if (!R0 || !modalOpen('win')) return;
      const other = R0.isHost ? R0.guestUid : R0.meta && R0.meta.host;
      const me = rec(R0.uid), op = rec(other);
      if (me && numEq(me.rm, G.game)) R0.rm = G.game;
      const mine = R0.rm === G.game;
      const theirs = !!(op && numEq(op.rm, G.game));
      const btn = $('#rematchBtn');
      if (btn) {
        if (mine) { btn.disabled = true; btn.textContent = 'Waiting for the other player…'; }
        else if (theirs) btn.textContent = `${nameOf(other)} wants a rematch!`;
      }
      if (R0.isHost && mine && theirs) {
        // both in: the next game of the series, straight to the countdown
        G.game++;
        hitStat('og_onlineStarted');
        closeAllModals();
        resetMatch(false);
        OGNet.setMeta({ games: G.game });
        clearOverlays();
      }
    }

    function act(a) {
      if (a === 'n-create') createForm();
      else if (a === 'n-join') joinForm('');
      else if (a === 'n-home') { leave(); open(); }
      else if (a === 'n-retry' && panel._retry) panel._retry();
      else if (a === 'n-leave') { leave(); toTitle(); }
      else if (a === 'n-share') share(false);
      else if (a === 'n-copy') share(true);
      else if (a === 'n-find') findNew();
      else if (a === 'n-wait') { if (R0) R0.keptWaiting = true; closeModal($('#drop')); }
    }
    /** the invite: the phone's share sheet where there is one, otherwise the link goes on the clipboard */
    async function share(fromCode) {
      if (!R0) return;
      const url = `${location.origin}${location.pathname}?join=${R0.code}`;
      const text = `Play On Guard with me! Join code: ${R0.code}`;
      const done = (t) => { const h = $('#ogHint'); if (fromCode && h) { h.textContent = t; h.classList.add('flash'); } else toastIn(t); say(t); };
      try { if (!fromCode && navigator.share && touchy) { await navigator.share({ title: 'On Guard', text, url }); return; } } catch (e) { if (e && e.name === 'AbortError') return; }
      try { await navigator.clipboard.writeText(fromCode ? url : `${text}\n${url}`); done(fromCode ? 'Invite link copied' : 'Invite link copied. Paste it into a text message.'); } catch (e) { done(url); }
    }
    function leave() {
      cancelAttempt();
      if (R0) { clearT('seatT'); clearT('hostGoneT'); clearT('dropT'); clearT('restoreT'); clearT('startT'); R0 = null; try { OGNet.leave(); } catch (e) {} }
      panel._html = '';
    }
    return { open, act, leave, hostSend, guestLv, guestFrame, shownMask, rematch, syncRematch, ready, saveSeries, onState, onConn, guestAway, get room() { return R0; } };
  })();

  /* ================================================================
     Best Life | On Guard | Stac switch, and wipes between the 3 games
     ================================================================ */
  const sw = $('#gameSwitch');
  const swPill = sw.querySelector('.gs-pill'), swBL = sw.querySelector('.gs-bl'), swOG = sw.querySelector('.gs-og'), swSTT = sw.querySelector('.gs-stt');
  function placePill(tab) { swPill.style.setProperty('--x', tab.offsetLeft + 'px'); swPill.style.setProperty('--w', tab.offsetWidth + 'px'); }
  function settleSwitch() {
    if (sw.classList.contains('go') || !swOG.offsetWidth) return;
    placePill(swOG);
    if (!sw.classList.contains('ready')) requestAnimationFrame(() => sw.classList.add('ready'));
  }
  let navTimers = [];
  if (swSTT) swSTT.addEventListener('pointerenter', () => document.fonts && document.fonts.load("400 44px 'Archivo Black'").catch(() => {}), { once: true });
  swBL.addEventListener('click', (e) => {
    if (e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    if (sw.classList.contains('go')) return;
    sw.classList.add('ready', 'go', 'go-bl');
    placePill(swBL);
    Snd.play('swish');
    try { sessionStorage.setItem('bl-from', 'onguard'); sessionStorage.removeItem('og-from'); } catch (err) {}
    navTimers.push(setTimeout(() => {
      const w = document.createElement('div');
      w.className = 'bl-wipe'; w.setAttribute('aria-hidden', 'true');
      w.innerHTML = '<i class="w y"></i><i class="w n"><b>BEST LIFE</b></i>';
      document.body.append(w);
      navTimers.push(setTimeout(() => { location.href = swBL.href; }, 520));
    }, 380));
  });
  if (swSTT) {
    swSTT.addEventListener('click', (e) => {
      if (e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      if (sw.classList.contains('go')) return;
      sw.classList.add('ready', 'go', 'go-stt');
      placePill(swSTT);
      Snd.play('swish');
      try { sessionStorage.setItem('stt-from', 'onguard'); sessionStorage.removeItem('og-from'); } catch (err) {}
      navTimers.push(setTimeout(() => {
        const w = document.createElement('div');
        w.className = 'stt-wipe'; w.setAttribute('aria-hidden', 'true');
        w.innerHTML = '<div class="sc-grid"><span>S</span><span>T</span><span>A</span><span>C</span><span></span><span>T</span><span>A</span><span>C</span><span></span><span>T</span><span>O</span><span>E</span></div>';
        document.body.append(w);
        navTimers.push(setTimeout(() => { location.href = swSTT.href; }, 520));
      }, 380));
    });
  }
  swOG.addEventListener('click', (e) => { e.preventDefault(); try { swOG.animate([{ transform: 'none' }, { transform: 'scale(1.06)' }, { transform: 'none' }], { duration: 300, easing: 'ease-out' }); } catch (err) {} });
  window.addEventListener('pagehide', () => { navTimers.forEach(clearTimeout); navTimers = []; });
  window.addEventListener('pageshow', (e) => {
    if (!e.persisted) return;
    navTimers.forEach(clearTimeout); navTimers = [];
    $$('.bl-wipe,.stt-wipe').forEach((w) => w.remove());
    sw.classList.remove('go', 'go-bl', 'go-stt');
    settleSwitch();
  });
  // arriving from Best Life: start covered by its red and blue halves, then slide them away
  const cover = $('#ogCover');
  if (document.documentElement.classList.contains('from-bl')) {
    try { sessionStorage.removeItem('og-from'); } catch (e) {}
    const go = () => {
      cover.classList.add('out');
      setTimeout(() => cover.remove(), 900);
      setTimeout(() => document.documentElement.classList.remove('from-bl'), 2600); // later visits to the title skip the extra delay
    };
    const fontsIn = document.fonts && document.fonts.ready ? Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 300))]) : Promise.resolve();
    fontsIn.then(() => requestAnimationFrame(() => setTimeout(go, 80)));
  } else cover.remove();

  /* ================================================================
     Boot
     ================================================================ */
  if (!NOGL && window.OGBoard3D && els.gl) {
    try {
      B3 = window.OGBoard3D.create({
        canvas: els.gl,
        P,
        consts: { EXT_X, FRAME_X, FRAME_Y, TRAY_X, TRAY_Y, FRAME_DEP, RIM_LIP, TAB_REACH },
        colors: { r: COLOR.r, b: COLOR.b, rl: COLOR_L.r, bl: COLOR_L.b, rd: COLOR_D.r, bd: COLOR_D.b, rdd: COLOR_DD.r, bdd: COLOR_DD.b },
        font: HLF,
        onContextLost() {
          if (!B3) return;
          const prev = B3;
          B3 = null;
          lastL3 = null;
          app.classList.remove('gl');
          try { prev.dispose(); } catch (e) {}
          applyLayout(false);
        },
      });
      if (B3) app.classList.add('gl');
    } catch (e) { B3 = null; }
  }

  let resizeT = 0;
  function onResize() {
    FX.size();
    applyLayout(false);
    settleSwitch();
  }
  window.addEventListener('resize', () => { cancelAnimationFrame(resizeT); resizeT = requestAnimationFrame(onResize); });
  if (window.visualViewport) visualViewport.addEventListener('resize', () => { cancelAnimationFrame(resizeT); resizeT = requestAnimationFrame(onResize); });

  startDemo();
  FX.size();
  applyLayout(false);
  settleSwitch();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { if (B3) B3.refreshFonts(); else R.invalidate(); applyLayout(false); settleSwitch(); });
  requestAnimationFrame((t) => { lastT = t; frame(t); });

  const joinCode = (location.search.match(/[?&]join=([A-Za-z]{4})/) || [])[1];
  if (joinCode) Net.open(joinCode.toUpperCase());

  function fallbackR3D() {
    const d = P.depths(G.s.press, [0, 0, 0, 0]);
    const tabCX = FRAME_X + TAB_REACH - P.LEVER_W * 0.44;
    const corners = P.CORNERS.map(([sx, sy], c) => {
      const pt = toScreen(sx * P.X, sy * P.Y);
      return { x: pt.x, y: pt.y, h: -DROP_V * d[c] };
    });
    const tabs = P.CORNERS.map(([sx, sy], c) => {
      const pt = toScreen(sx * tabCX, sy * P.LEVER_Y);
      return { x: pt.x, y: pt.y, h: -DROP_V * Math.max(kl[c], d[c]) };
    });
    const frame = P.CORNERS.map(([sx, sy]) => toScreen(sx * FRAME_X, sy * FRAME_Y));
    const S = L ? L.S : 1;
    let ball = null;
    if (lastBallVis) {
      const pt = toScreen(lastBallVis.x, lastBallVis.y);
      const sc = lastBallVis.scale != null ? lastBallVis.scale : 1;
      const zSurf = P.heightAt(G.s.press, lastBallVis.x, lastBallVis.y) * (DROP_V / P.K.DROP);
      const lift = !lastBallVis.dark && typeof P.cove === 'function' ? P.cove(lastBallVis.x, lastBallVis.y).lift : 0;
      ball = { x: pt.x, y: pt.y, r: P.BALL * sc * S, h: zSurf + P.BALL * sc + lift };
    }
    const parts = {
      pegs: P.PEGS.map((p) => ({ x: p.x, y: p.y })),
      holes: P.POCKETS.map((p) => ({ x: p.hx, y: p.hy })),
      pocketPts: P.POCKETS.map((p) => p.pts.map(([x, y]) => ({ x, y }))),
      tabs: P.CORNERS.map(([sx, sy]) => ({ x: sx * tabCX, y: sy * P.LEVER_Y })),
    };
    return { webgl: false, drop: DROP_V, corners, tabs, frame, ball, pegR: P.PEG * S, draws: drawn, parts };
  }

  // test hooks (read-only views, plus ball placement when ?test is in the URL)
  window.OG = {
    get state() {
      return { mode: G.mode, me: G.me, screen, phase: G.phase, t: G.t, score: { ...G.score }, ball: { x: G.s.x, y: G.s.y, vx: G.s.vx, vy: G.s.vy }, press: G.s.press.slice(), held: heldMask, mask: G.mask,
        view: L && L.view, theta: L && L.theta, game: G.game, paused: G.paused, hold: G.hold, grip: { ...G.grip.e }, tired: { ...G.grip.tired }, ready: { ...G.ready }, series: { ...G.series }, level: G.level,
        modals: modalStack.map((x) => x.m.id), epoch, knobs: kl.slice() };
    },
    fps() { const f = frames.slice(-240); if (!f.length) return null; const s = f.slice().sort((a, b) => a - b); return { avg: f.length / f.reduce((a, b) => a + b, 0), p95ms: s[Math.floor(s.length * 0.95)] * 1000, n: f.length }; },
    r3d() { return B3 ? B3.r3d() : fallbackR3D(); },
    project(x, y) { return toScreen(x, y); },
  };
  if (TEST) {
    window.OG.place = (x, y, vx, vy) => { G.s.x = x; G.s.y = y; G.s.vx = vx || 0; G.s.vy = vy || 0; rollN = 0; if (B3 && B3.resetBall) B3.resetBall(); };
    window.OG.skipCount = () => { if (G.phase === 'ready') { G.ready = { r: true, b: true }; G.phase = 'count'; } if (G.phase === 'count') G.t = COUNT_T; };
    window.OG.sound = (k, a) => Snd.check(k, a);
    window.OG.work = () => { const s = work.slice().sort((a, b) => a - b); return s.length ? { avg: work.reduce((a, b) => a + b, 0) / work.length, p95: s[Math.floor(s.length * 0.95)] } : null; };
    window.OG.feed = (s) => Net.onState(s); // hand the guest a snapshot, as if the host had sent it
    window.OG.conn = (on) => Net.onConn(on); // pretend this device's connection dropped / came back
    window.OG.net = () => { const r = Net.room; return r ? { stall: r.stall, offset: r.offset, lead: r.lead, conn: r.conn, guest: r.guestUid, uid: r.uid, players: r.players, meta: r.meta } : null; };
    window.OG.layout = () => L;
    window.OG.noBot = () => { for (const k of Object.keys(G.bots)) G.bots[k] = { update: () => 0, reset() {} }; }; // a computer player that never touches its levers
    window.OG.rollV = () => Snd.rollV;
    window.OG.drawn = () => (B3 ? B3.draws() : drawn);
  }
})();
