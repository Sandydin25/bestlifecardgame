/* Best Life — hero: the box spins, opens, and the 12 sets fan out of it.
   WebGL (three.js) when a real GPU is available; a light 2D canvas version otherwise.
   Bundled to best-life/js/hero3d.js (IIFE) so the site still works from file://. */
import {
  WebGLRenderer, Scene, PerspectiveCamera, Group, Mesh, Matrix4, Shape, ShapeGeometry, PlaneGeometry,
  MeshStandardMaterial, MeshBasicMaterial, CanvasTexture, SRGBColorSpace, NoToneMapping, DirectionalLight, AmbientLight,
  BackSide, DoubleSide, Raycaster, Vector2, LinearMipmapLinearFilter,
} from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import * as P from './paint.js';

const BL = window.BL;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const seg = (p, a, b) => clamp((p - a) / (b - a));
const eio = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const eout = (t) => 1 - Math.pow(1 - t, 3);
const esine = (t) => -(Math.cos(Math.PI * t) - 1) / 2;
const DEG = Math.PI / 180;
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const forceFlat = /[?&]flat\b/.test(location.search);

/* base geometry size; everything is scaled by g = W / W0 */
const W0 = 250, H0 = Math.round(W0 * 1.39), D0 = Math.round(W0 * 0.3), CW0 = Math.round(W0 * 0.86), CH0 = CW0 * 1.4;
const N = BL.SETS.length;

const hero = $('#hero');
const stage = $('#stage');
const caps = Object.fromEntries($$('#hero .cap').map((c) => [c.dataset.cap, c]));
const cue = $('#scrollCue');
const coarse = matchMedia('(pointer: coarse)').matches;
const pin = hero.querySelector('.hero-pin');
// The animation follows scroll through a critically-damped spring with a speed cap, so even a
// fast flick plays the box opening and the fan smoothly instead of jumping to the end.
const SPRING = 9, MAX_SPEED = coarse ? 0.42 : 0.55; // progress units per second (whole hero >= ~1.8-2.4s)

const chips = $('#setChips');
BL.SETS.forEach((s) => {
  const c = BL.el('span', '', s.name);
  c.style.background = s.bg;
  chips.append(c);
});

/* ================= layout + scroll ================= */
let L = {}, heroTop = 0, heroSpan = 1;
function measure() {
  heroTop = hero.getBoundingClientRect().top + scrollY;
  heroSpan = Math.max(1, hero.offsetHeight - pin.clientHeight); // sticky travel distance
}
// Size everything from the pinned frame (100svh), not the window: on iPhone the window height changes
// as the address bar collapses, which would otherwise shift and re-layout the scene mid-scroll.
function computeLayout() {
  const vw = stage.clientWidth || innerWidth, vh = stage.clientHeight || innerHeight;
  const desk = vw >= 900 || (vw > vh && vw >= 560); // landscape phones get the side-by-side layout
  const W = Math.round(desk ? Math.min(250, vh * 0.27, vw * 0.19) : Math.min(vw >= 600 ? 235 : 185, vw * 0.44, vh * 0.23));
  const g = W / W0;
  const R = desk ? Math.min(330, vh * 0.36, vw * 0.25) : Math.min(vw * 0.4, vh * 0.28, 300);
  const FW = desk ? R * 0.46 : R * 0.5;
  L = {
    vw, vh, desk, W, g, H: H0 * g, D: D0 * g, CW: CW0 * g, CH: CH0 * g, R, sc: FW / (CW0 * g), A: desk ? 66 : 52,
    introX: desk ? vw * 0.2 : 0, introY: desk ? vh * 0.02 : vh * 0.2, introS: desk ? 1.2 : 1,
    endY: desk ? vh * 0.22 : vh * (vw >= 600 ? 0.14 : 0.1), endS: desk ? 0.95 : 0.8,
  };
  measure();
}
const heroP = () => clamp((scrollY - heroTop) / heroSpan);

/* ================= captions ================= */
const capState = {};
function setCap(name, o, dy = 0) {
  const c = caps[name];
  const key = o.toFixed(3) + '|' + dy.toFixed(1) + '|' + (L.desk ? 1 : 0);
  if (capState[name] === key) return;
  capState[name] = key;
  c.style.opacity = o;
  c.style.visibility = o < 0.01 ? 'hidden' : 'visible';
  c.classList.toggle('live', o > 0.6);
  const center = (name === 'intro' || c.classList.contains('cap-fact')) && L.desk ? 'translateY(-50%) ' : name === 'open' ? 'translateX(-50%) ' : '';
  c.style.transform = center + `translateY(${dy}px)`;
}
const bump = (v, a, b, f = 18) => clamp((v - a) / f) * clamp((b - v) / f);

/* ================= choreography (shared) ================= */
let sp = 0, sv = 0, last = performance.now(), mx = 0, my = 0, smx = 0, smy = 0, hovered = -1, navUntil = 0, lastDrawnP = -1, needDraw = false;
const pose = { cards: BL.SETS.map(() => ({ vis: false, hover: 0 })) };
window.__BLpose = pose; // read-only handle for automated tests
function step(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  const t = now / 1000;
  const target = heroP();
  if (now < navUntil) {
    // menu/logo jumps: follow the page exactly so we don't replay the story after arriving
    sp = target; sv = 0;
  } else {
    // critically damped spring toward the scroll position, with a capped speed
    sv += (SPRING * SPRING * (target - sp) - 2 * SPRING * sv) * dt;
    sv = clamp(sv, -MAX_SPEED, MAX_SPEED);
    sp += sv * dt;
    if (Math.abs(sp - target) < 2e-4 && Math.abs(sv) < 2e-3) { sp = target; sv = 0; }
  }
  const p = sp;
  smx += (mx - smx) * Math.min(1, dt * 4);
  smy += (my - smy) * Math.min(1, dt * 4);
  const idle = reduce ? 0 : 1;
  const { H, D, g, CH } = L;

  const spin = esine(seg(p, 0.04, 0.46));
  const move = eio(seg(p, 0.44, 0.56));
  const bob = Math.sin(t * 1.3) * 6 * idle * (1 - move * 0.6);
  pose.p = p;
  pose.move = move;
  pose.lidT = eio(seg(p, 0.48, 0.58));
  pose.bob = bob;
  pose.bx = lerp(L.introX, 0, move);
  pose.by = lerp(L.introY, L.endY, move) + bob;
  pose.bs = lerp(L.introS, L.endS, move);
  pose.ry = lerp(-28, 360, spin) + (smx * 8 + Math.sin(t * 0.7) * 3 * idle * (1 - spin)) * (1 - move);
  pose.rx = lerp(-12, -24, move) - smy * 5 * (1 - move);
  pose.rz = lerp(-2, 0, move);

  const pivotY = L.endY - (H * L.endS) / 2 + 20;
  for (let i = 0; i < N; i++) {
    const c = pose.cards[i];
    const st = 0.57 + i * 0.022;
    const tt = seg(p, st, st + 0.12);
    c.vis = !(tt <= 0 || p < 0.56);
    if (!c.vis) continue;
    const rise = eout(seg(tt, 0, 0.38));
    const f = eio(seg(tt, 0.3, 1));
    c.f = f;
    c.k = 1 - f;
    c.hover += ((hovered === i && f > 0.98 ? 1 : 0) - c.hover) * Math.min(1, dt * 12);
    c.z0 = -D / 2 + 6 * g + (i / (N - 1)) * (D - 12 * g);
    c.y0 = (H - CH) / 2 - 2 - rise * (H * 0.98);
    const a = lerp(-L.A, L.A, i / (N - 1));
    const R = L.R + Math.sin(t * 1.6 + i * 0.55) * 2.5 * f * idle + 34 * c.hover;
    const tx = R * Math.sin(a * DEG), ty = pivotY - R * Math.cos(a * DEG);
    c.x = lerp(0, tx, f);
    c.y = lerp(c.y0, ty, f) - Math.sin(Math.PI * f) * 70;
    c.z = lerp(c.z0, i * 1.6 + 60 * c.hover, f);
    c.rz = lerp(0, a, f);
    c.rY = lerp(180, 360, eio(seg(tt, 0.35, 0.95)));
    c.s = lerp(1, L.sc * (1 + 0.1 * c.hover), f);
    c.rise = rise;
  }

  setCap('intro', 1 - seg(p, 0.03, 0.065), -seg(p, 0.03, 0.065) * 40);
  setCap('f52', bump(pose.ry, 4, 128, 22), 0);
  setCap('f12', bump(pose.ry, 134, 232, 22), 0);
  setCap('f48', bump(pose.ry, 238, 342, 22), 0);
  setCap('open', seg(p, 0.47, 0.5) * (1 - seg(p, 0.6, 0.64)), (1 - seg(p, 0.47, 0.5)) * 20);
  const endO = seg(p, 0.9, 0.96);
  setCap('end', endO, (1 - endO) * 30);
  const co = (1 - seg(p, 0.01, 0.04)).toFixed(3);
  if (cue._o !== co) { cue.style.opacity = co; cue._o = co; }
  // anything still moving? (idle motion, spring, mouse parallax, a card easing in/out of hover)
  let easing = false;
  for (const c of pose.cards) if (c.vis && c.hover > 1e-3 && c.hover < 1 - 1e-3) easing = true;
  pose.dirty = idle === 1 || easing || p !== lastDrawnP || Math.abs(smx - mx) > 1e-4 || Math.abs(smy - my) > 1e-4;
  return pose;
}

/* ================= shared input ================= */
function openCard(i) {
  const target = $(`#setGrid .card[data-set="${BL.SETS[i].id}"]`);
  if (!target) return;
  const slot = target.closest('.slot');
  slot.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' });
  setTimeout(() => slot.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.08)' }, { transform: 'scale(1)' }], { duration: 700, easing: 'ease-out' }), reduce ? 0 : 900);
}
addEventListener('pointermove', (e) => {
  if (e.pointerType !== 'mouse') return; // touch scrolling shouldn't tilt the box
  mx = (e.clientX / innerWidth - 0.5) * 2;
  my = (e.clientY / innerHeight - 0.5) * 2;
}, { passive: true });

// In-page links (logo, menu, "Meet the cards"): follow the scroll exactly until it settles.
document.addEventListener('click', (e) => {
  const a = e.target.closest && e.target.closest('a[href^="#"]');
  if (a) navUntil = performance.now() + 1600;
});
addEventListener('scrollend', () => { if (navUntil) navUntil = Math.min(navUntil, performance.now() + 50); });

/* ================= boot ================= */
computeLayout();
// If the page opens already scrolled into the hero (slow network, restored scroll), play the story
// up from the start instead of popping straight to the end.
sp = heroP() < 1 ? 0 : 1;
let renderer = null;
const gpuOK = (() => {
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2', { failIfMajorPerformanceCaveat: true }) || c.getContext('webgl', { failIfMajorPerformanceCaveat: true });
    if (gl) gl.getExtension('WEBGL_lose_context')?.loseContext();
    return !!gl;
  } catch (e) { return false; }
})();
if (!forceFlat && gpuOK) {
  try {
    renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance', failIfMajorPerformanceCaveat: true });
  } catch (e) { renderer = null; }
}
const boot = renderer ? startGL(renderer) : start2D();
boot.then((draw) => {
  let visible = true, force = true, size = stage.clientWidth + 'x' + stage.clientHeight;
  new IntersectionObserver((es) => {
    const v = es[0].isIntersecting;
    // coming back into view (scrolling up from below, logo jump): match the page instead of replaying
    if (v && !visible) { sp = heroP(); sv = 0; force = true; }
    visible = v;
    if (v) last = performance.now();
  }).observe(hero);
  let rT;
  addEventListener('resize', () => {
    clearTimeout(rT);
    rT = setTimeout(() => {
      measure();
      const now = stage.clientWidth + 'x' + stage.clientHeight;
      if (now === size) return; // e.g. iPhone address bar: the pinned frame didn't change
      size = now; computeLayout(); draw.resize(); force = true;
    }, 60);
  });
  const loop = (now) => {
    requestAnimationFrame(loop);
    if (!visible || document.hidden) return;
    const q = step(now);
    if (q.dirty || force || needDraw) { draw(q); lastDrawnP = q.p; force = needDraw = false; }
  };
  draw(step(performance.now()));
  requestAnimationFrame(loop);
});

/* ================= WebGL renderer ================= */
async function startGL(renderer) {
  hero.classList.add('gl-on');
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = NoToneMapping;
  const canvas = renderer.domElement;
  canvas.className = 'gl';
  canvas.setAttribute('aria-hidden', 'true');
  stage.append(canvas);

  const scene = new Scene();
  const camera = new PerspectiveCamera(30, 1, 50, 4000);
  // lighting tuned so a face pointed at the camera shows its true printed colour
  const key = new DirectionalLight(0xffffff, 2.2);
  key.position.set(-500, 650, 1000);
  const fill = new DirectionalLight(0xc9ccff, 0.55);
  fill.position.set(700, -150, 600);
  scene.add(key, key.target, fill, fill.target, new AmbientLight(0xffffff, 1.05));

  const A = await P.preload();
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const tex = (cv) => {
    const t = new CanvasTexture(cv);
    t.colorSpace = SRGBColorSpace;
    t.anisotropy = aniso;
    t.minFilter = LinearMipmapLinearFilter;
    return t;
  };
  const mat = (cv, o = {}) => new MeshStandardMaterial({ map: tex(cv), roughness: 0.55, metalness: 0, ...o });
  const fanCanvases = {};
  for (const id of ['food', 'family', 'goals', 'friends', 'money']) fanCanvases[id] = P.cardFront(A, BL.set(id), 256);

  const TW = 640, TH = Math.round(TW * 1.39), TD = Math.round(TW * 0.3);
  const indigo = new MeshStandardMaterial({ color: 0x3a3b8a, roughness: 0.55 });
  const hidden = new MeshBasicMaterial({ visible: false });

  // ---------- box ----------
  const anchor = new Group();
  const box = new Group();
  box.rotation.order = 'YZX';
  anchor.add(box);
  scene.add(anchor);
  box.add(new Mesh(new RoundedBoxGeometry(W0, H0, D0, 4, 2.6), [
    mat(P.boxSide(TW, TD, TH, 'right')), mat(P.boxSide(TW, TD, TH, 'left')), hidden,
    mat(P.boxEnd(TW, TD, 'bottom')), mat(P.boxFront(A, TW, TH)), mat(P.boxBack(A, TW, TH, fanCanvases)),
  ]));
  const t = 1.3;
  const wall = new MeshStandardMaterial({ color: 0x23246b, roughness: 0.95, side: BackSide });
  const inner = new Mesh(new RoundedBoxGeometry(W0 - 2 * t, H0 - t, D0 - 2 * t, 2, 1.2), [
    wall, wall, hidden, new MeshStandardMaterial({ color: 0x17184d, roughness: 0.95, side: BackSide }), wall, wall,
  ]);
  inner.position.y = -t / 2;
  box.add(inner);
  const lidPivot = new Group();
  lidPivot.position.set(0, H0 / 2, -D0 / 2);
  box.add(lidPivot);
  const LT = 2.4;
  const lid = new Mesh(new RoundedBoxGeometry(W0, LT, D0, 3, 1.1), [
    indigo, indigo, mat(P.boxEnd(TW, TD, 'top')), new MeshStandardMaterial({ color: 0x2a2b72, roughness: 0.9 }), indigo, indigo,
  ]);
  lid.position.set(0, LT / 2, D0 / 2);
  lidPivot.add(lid);
  // tuck flap: tucked inside the front wall when closed, folds flat with the lid when open
  const F = Math.round(D0 * 0.75), FW2 = (W0 - 8) / 2, fr = F * 0.55;
  const fs = new Shape();
  fs.moveTo(-FW2, 0); fs.lineTo(FW2, 0); fs.lineTo(FW2, -F + fr);
  fs.quadraticCurveTo(FW2, -F, FW2 - fr, -F); fs.lineTo(-FW2 + fr, -F);
  fs.quadraticCurveTo(-FW2, -F, -FW2, -F + fr); fs.closePath();
  const flapPivot = new Group();
  flapPivot.position.set(0, 0.2, D0 - 2.2);
  lidPivot.add(flapPivot);
  flapPivot.add(new Mesh(new ShapeGeometry(fs, 8), new MeshStandardMaterial({ color: 0x34357f, roughness: 0.6, side: DoubleSide })));
  const shadow = new Mesh(new PlaneGeometry(1, 1), new MeshBasicMaterial({ map: new CanvasTexture(P.blob(256)), transparent: true, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2;
  scene.add(shadow);

  // ---------- cards ----------
  const cr = CW0 * 0.055, hw = CW0 / 2, hh = CH0 / 2;
  const cs = new Shape();
  cs.moveTo(-hw + cr, -hh);
  cs.lineTo(hw - cr, -hh); cs.quadraticCurveTo(hw, -hh, hw, -hh + cr);
  cs.lineTo(hw, hh - cr); cs.quadraticCurveTo(hw, hh, hw - cr, hh);
  cs.lineTo(-hw + cr, hh); cs.quadraticCurveTo(-hw, hh, -hw, hh - cr);
  cs.lineTo(-hw, -hh + cr); cs.quadraticCurveTo(-hw, -hh, -hw + cr, -hh);
  const cardGeo = new ShapeGeometry(cs, 6);
  const uv = cardGeo.attributes.uv, pos = cardGeo.attributes.position;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, pos.getX(i) / CW0 + 0.5, pos.getY(i) / CH0 + 0.5);
  const backMat = mat(P.cardBack(A, 512), { roughness: 0.6 });
  // Card fronts aren't seen until the box opens, so paint them in idle time after the first frame
  // (a solid-colour placeholder stands in until then) instead of blocking start-up.
  const frontMats = [];
  const cards = BL.SETS.map((s, i) => {
    const g = new Group();
    g.matrixAutoUpdate = false;
    const ph = P.mk(4, 6), pctx = ph.getContext('2d');
    pctx.fillStyle = s.bg; pctx.fillRect(0, 0, 4, 6);
    const fm = mat(ph, { roughness: 0.6 });
    frontMats.push(fm);
    const front = new Mesh(cardGeo, fm);
    front.position.z = 0.35;
    const back = new Mesh(cardGeo, backMat);
    back.rotation.y = Math.PI;
    back.position.z = -0.35;
    front.userData.i = back.userData.i = i;
    g.add(front, back);
    g.visible = false;
    scene.add(g);
    return { g, front, back };
  });
  const pickables = cards.flatMap((c) => [c.front, c.back]);
  let painted = 0;
  function paintFront() {
    const i = painted++;
    const t = tex(P.cardFront(A, BL.SETS[i], 512));
    frontMats[i].map.dispose();
    frontMats[i].map = t;
    renderer.initTexture(t);
    needDraw = true;
  }
  const idle = (fn) => (window.requestIdleCallback ? requestIdleCallback(fn, { timeout: 500 }) : setTimeout(fn, 40));
  const paintLater = () => { if (painted < N) { paintFront(); idle(paintLater); } };
  setTimeout(() => idle(paintLater), 250);

  // ---------- picking ----------
  const ray = new Raycaster(), ndc = new Vector2();
  function pickAt(x, y) {
    if (pose.p < 0.9) return -1;
    const r = canvas.getBoundingClientRect();
    ndc.set(((x - r.left) / r.width - 0.5) * 2, -((y - r.top) / r.height - 0.5) * 2);
    ray.setFromCamera(ndc, camera);
    const h = ray.intersectObjects(pickables, false)[0];
    return h ? h.object.userData.i : -1;
  }
  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse') return;
    const hit = pickAt(e.clientX, e.clientY);
    if (hit !== hovered) { hovered = hit; canvas.style.cursor = hit >= 0 ? 'pointer' : ''; }
  });
  canvas.addEventListener('pointerleave', () => { hovered = -1; canvas.style.cursor = ''; });
  canvas.addEventListener('click', (e) => { const i = pickAt(e.clientX, e.clientY); if (i >= 0) openCard(i); });

  // ---------- size ----------
  function resize() {
    const { vw, vh } = L;
    let pr = Math.min(devicePixelRatio || 1, 2);
    if (vw * vh * pr * pr > 5.2e6) pr = Math.sqrt(5.2e6 / (vw * vh));
    renderer.setPixelRatio(pr);
    renderer.setSize(vw, vh, false);
    canvas.style.width = vw + 'px';
    canvas.style.height = vh + 'px';
    const dist = 1500;
    camera.fov = (2 * Math.atan(vh / 2 / dist)) / DEG;
    camera.aspect = vw / vh;
    camera.position.set(0, 0, dist);
    camera.updateProjectionMatrix();
  }
  resize();

  const m = new Matrix4(), tmp = new Matrix4();
  function draw(q) {
    const { g, H } = L;
    if (q.p > 0.5) while (painted < N) paintFront(); // fast scroller beat the idle painter
    anchor.position.set(q.bx, -q.by, 0);
    anchor.scale.setScalar(q.bs);
    anchor.rotation.x = -q.rx * DEG;
    box.scale.setScalar(g);
    box.rotation.set(0, q.ry * DEG, -q.rz * DEG);
    lidPivot.rotation.x = -q.lidT * 118 * DEG;
    flapPivot.rotation.x = -q.lidT * 92 * DEG;
    const hb = (H * q.bs) / 2;
    shadow.position.set(q.bx, -(q.by + hb * Math.cos(q.rx * DEG)) - 16 + q.bob * 0.4, -hb * Math.sin(-q.rx * DEG) * 0.5);
    const sw = L.W * q.bs * (1.9 - q.bob / 40);
    shadow.scale.set(sw, sw * 0.62, 1);
    for (let i = 0; i < N; i++) {
      const c = q.cards[i], o = cards[i];
      o.g.visible = c.vis;
      if (!c.vis) continue;
      const k = c.k, sk = lerp(1, q.bs, k), s = c.s * g;
      m.makeTranslation(q.bx * k, -q.by * k, 0);
      m.multiply(tmp.makeScale(sk, sk, sk));
      m.multiply(tmp.makeRotationX(-q.rx * k * DEG));
      m.multiply(tmp.makeTranslation(c.x, -c.y, c.z));
      m.multiply(tmp.makeRotationZ(-c.rz * DEG));
      m.multiply(tmp.makeRotationY(c.rY * DEG));
      m.multiply(tmp.makeScale(s, s, s));
      o.g.matrix.copy(m);
      o.g.matrixWorldNeedsUpdate = true;
    }
    renderer.render(scene, camera);
  }
  draw.resize = resize;
  draw(step(performance.now()));
  canvas.classList.add('ready');
  return draw;
}

/* ================= 2D fallback (no GPU / software rendering) ================= */
async function start2D() {
  hero.classList.add('flat');
  const A = await P.preload();
  const layer = BL.el('div', 'flat-layer');
  layer.setAttribute('aria-hidden', 'true');
  stage.append(layer);
  const shadow = BL.el('div', 'flat-shadow');
  const boxEl = BL.el('div', 'flat-box');
  const fanCanvases = {};
  for (const id of ['food', 'family', 'goals', 'friends', 'money']) fanCanvases[id] = P.cardFront(A, BL.set(id), 220);
  const bf = P.boxFront(A, 440, Math.round(440 * 1.39)), bb = P.boxBack(A, 440, Math.round(440 * 1.39), fanCanvases);
  bb.classList.add('mirror');
  const hole = BL.el('div', 'flat-hole'), lid = BL.el('div', 'flat-lid');
  boxEl.append(bf, bb, hole, lid);
  const back = P.cardBack(A, 360);
  const els = BL.SETS.map((s, i) => {
    const el = BL.el('div', 'flat-card');
    const f = P.cardFront(A, s, 360), b = document.createElement('canvas');
    b.width = back.width; b.height = back.height;
    b.getContext('2d').drawImage(back, 0, 0);
    b.classList.add('mirror');
    el.append(f, b);
    el.addEventListener('pointerenter', () => { if (pose.p > 0.9) hovered = i; });
    el.addEventListener('pointerleave', () => { if (hovered === i) hovered = -1; });
    el.addEventListener('click', () => { if (pose.p >= 0.9) openCard(i); });
    layer.append(el);
    return { el, f, b };
  });
  layer.append(shadow, boxEl);
  function resize() {
    boxEl.style.width = L.W + 'px'; boxEl.style.height = L.H + 'px';
    els.forEach((o) => { o.el.style.width = L.CW + 'px'; o.el.style.height = L.CH + 'px'; });
  }
  resize();
  function draw(q) {
    const cy = Math.cos(q.ry * DEG);
    bf.style.display = cy >= 0 ? '' : 'none';
    bb.style.display = cy >= 0 ? 'none' : '';
    boxEl.style.transform = `translate(-50%,-50%) translate(${q.bx}px, ${q.by}px) scale(${q.bs}) rotate(${q.rz}deg) scaleX(${Math.max(0.02, Math.abs(cy)) * Math.sign(cy || 1)})`;
    lid.style.transform = `scaleY(${q.lidT})`;
    lid.style.opacity = q.lidT > 0.01 ? 1 : 0;
    hole.style.opacity = q.lidT;
    shadow.style.transform = `translate(-50%,-50%) translate(${q.bx}px, ${q.by + (L.H * q.bs) / 2 + 22}px) scale(${q.bs * (1 - q.bob / 60)})`;
    for (let i = 0; i < N; i++) {
      const c = q.cards[i], o = els[i];
      if (!c.vis) { if (o.el._v !== 0) { o.el.style.visibility = 'hidden'; o.el._v = 0; } continue; }
      if (o.el._v !== 1) { o.el.style.visibility = 'visible'; o.el._v = 1; }
      const f = c.f;
      const x = lerp(q.bx, c.x, f), y = lerp(q.by + c.y0 * q.bs, c.y, f) - (f > 0 ? 0 : 0);
      const s = lerp(q.bs, c.s, f);
      const cyc = Math.cos(c.rY * DEG);
      o.f.style.display = cyc >= 0 ? '' : 'none';
      o.b.style.display = cyc >= 0 ? 'none' : '';
      o.el.style.zIndex = f > 0.2 ? 3 + i : 1;
      o.el.style.transform = `translate(-50%,-50%) translate(${x}px, ${y}px) rotate(${c.rz}deg) scale(${s}) scaleX(${Math.max(0.02, Math.abs(cyc)) * Math.sign(cyc || 1)})`;
    }
  }
  draw.resize = resize;
  return draw;
}
