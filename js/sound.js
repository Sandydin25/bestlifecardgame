/* Best Life — little game sounds, made with Web Audio (no audio files).
   A card flick on deal/draw, a chord for a set, a chime when it's your turn, a fanfare for a win.
   Off with the "Sound" button in the game bar (remembered). Browsers only allow sound after a tap,
   so the first tap inside the game unlocks it; on iPhone it plays as "ambient" (respects the mute switch). */
(function () {
  'use strict';
  const BL = (window.BL = window.BL || {});
  const AC = window.AudioContext || window.webkitAudioContext;
  let ctx = null, master = null, noise = null, on = true;
  try { on = localStorage.getItem('bl-sound') !== 'off'; } catch (e) {}

  function init() {
    if (ctx || !AC) return ctx;
    try { if (navigator.audioSession) navigator.audioSession.type = 'ambient'; } catch (e) {}
    try { ctx = new AC(); } catch (e) { return null; }
    master = ctx.createGain();
    master.gain.value = 0.8;
    master.connect(ctx.destination);
    const len = Math.floor(ctx.sampleRate * 0.07);
    noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.2);
    return ctx;
  }
  function unlock() {
    if (!on) return;
    const c = init();
    if (!c) return;
    if (c.state !== 'running') c.resume().catch(() => {});
    const b = c.createBufferSource(); // iOS wants a sound started inside the tap itself
    b.buffer = c.createBuffer(1, 1, 22050);
    b.connect(c.destination);
    b.start(0);
  }
  const stage = document.getElementById('playStage');
  if (stage) ['pointerdown', 'keydown'].forEach((t) => stage.addEventListener(t, unlock, { capture: true, passive: true }));

  const N = (m) => 440 * Math.pow(2, (m - 69) / 12);
  function tone(f, t, dur, type, vol) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type;
    o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + dur + 0.05);
  }
  function flick(t) {
    const s = ctx.createBufferSource(), bp = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = noise;
    s.playbackRate.value = 0.85 + Math.random() * 0.3;
    bp.type = 'bandpass';
    bp.frequency.value = 2200 + Math.random() * 900;
    bp.Q.value = 0.8;
    g.gain.value = 0.32;
    s.connect(bp); bp.connect(g); g.connect(master);
    s.start(t);
  }
  const SOUNDS = {
    flick,
    set: (t) => [72, 76, 79, 84].forEach((m, i) => tone(N(m), t + i * 0.08, 0.6, 'triangle', 0.1)),
    turn: (t) => { tone(N(79), t, 0.5, 'sine', 0.12); tone(N(84), t + 0.14, 0.75, 'sine', 0.11); },
    win: (t) => {
      [72, 76, 79].forEach((m, i) => tone(N(m), t + i * 0.12, 0.3, 'triangle', 0.1));
      [72, 76, 79, 84].forEach((m) => tone(N(m), t + 0.42, 1.4, 'triangle', 0.065));
    },
    end: (t) => [79, 76, 72].forEach((m, i) => tone(N(m), t + i * 0.16, 0.6, 'sine', 0.08)),
  };
  BL.sound = (k) => {
    if (!on || !ctx || ctx.state !== 'running' || document.hidden) return;
    const f = SOUNDS[k];
    if (f) try { f(ctx.currentTime + 0.01); } catch (e) {}
  };

  const btn = document.getElementById('soundBtn');
  function paint() {
    if (!btn) return;
    btn.innerHTML = `<span aria-hidden="true">${on ? '🔊' : '🔇'}</span> Sound ${on ? 'on' : 'off'}`;
    btn.title = on ? 'Turn game sounds off' : 'Turn game sounds on';
  }
  if (btn) {
    btn.addEventListener('click', () => {
      on = !on;
      try { localStorage.setItem('bl-sound', on ? 'on' : 'off'); } catch (e) {}
      paint();
      if (on) { unlock(); setTimeout(() => BL.sound('turn'), 30); }
    });
    paint();
  }
})();
