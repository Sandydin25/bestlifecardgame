/* Stac-Tac-Toe — High-FPS Demand-Rendered Physical 3D Board (Three.js)
   Bundled via `npm run build:stactactoe` to best-life/stactactoe/board3d.js exposing window.STTBoard3D = { create }.

   Council-hardened performance & craft:
   - Demand-driven rendering: sleeps completely at 0 GPU draw calls when settled or paused behind menus/lobby
   - PCFShadowMap at 1024x1024 with autoUpdate = false; tiny held-stack float bob never triggers shadow redraws
   - Elapsed wall-clock flight timing (never lags on slow frames)
   - Dedicated pointercancel handler + pointerId tracking (iOS touch cancellations never commit moves!)
   - Reused Vector3 & hit buffers (zero per-mousemove GC allocations or DOM layout reflows)
   - Clear row-0 separation (CUP_Z = 1.66, 16.5° pitch), warm bright softboxes (zero olive yellow drift),
     tight floor shadow plane + overhead key light for clean 10-high tower shadows
   - WebGL context lost/restored resilience */

import {
  WebGLRenderer, Scene, PerspectiveCamera, Group, Mesh,
  SphereGeometry, CylinderGeometry, RingGeometry, CircleGeometry,
  BoxGeometry, PlaneGeometry, ExtrudeGeometry, ShapeGeometry, TubeGeometry,
  Shape, Path, CurvePath, LineCurve3, CatmullRomCurve3,
  MeshStandardMaterial, MeshBasicMaterial, ShadowMaterial,
  DirectionalLight, HemisphereLight,
  PMREMGenerator, CanvasTexture, SRGBColorSpace, NeutralToneMapping,
  PCFShadowMap, DoubleSide, Raycaster, Vector2, Vector3, Color,
} from 'three';

const TAU = Math.PI * 2;
const R = 0.56;
const NECK = 0.032;
const STEP_Y = R * 2 + NECK;
const BASE_BALL_Y = R + NECK;
const COL_X = [-1.54, 0, 1.54];

const DECK_TOP = -0.34;
const FLOOR_Y = -0.82;
const CUP_R = 0.52;
const CUP_Z = 1.66; // pushed well clear of row 0 so horizontal bottom-row lines stay unobstructed
const CUP_STEP = 1.2;
const CUP_SEAT = Math.sqrt(R * R - CUP_R * CUP_R) - 0.09; // sits neatly low in the machined tray cup
const PEG_X = 3.08;

const PIGMENT = { o: 0xff5a0a, y: 0xffe01a };
const BONE = 0xf2eee4;
const IDLE_BAR = 0x525258;

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const easeOutCubic = (t) => 1 - Math.pow(1 - clamp(t, 0, 1), 3);
const easeOutBack = (t) => {
  const c1 = 1.35;
  const c3 = c1 + 1;
  const x = clamp(t, 0, 1);
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
};
const easeInQuad = (t) => { const x = clamp(t, 0, 1); return x * x; };
const easeInOutCubic = (t) => {
  const x = clamp(t, 0, 1);
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
};
const seg = (p, a, b) => clamp((p - a) / (b - a), 0, 1);

function ballY(row) {
  return BASE_BALL_Y + row * STEP_Y;
}

/** Bright, warm-neutral photo-studio environment so Cadmium Yellow stays sunny (never olive). */
function makeStudioEnv(renderer) {
  const pmrem = new PMREMGenerator(renderer);
  const cv = document.createElement('canvas');
  cv.width = 256;
  cv.height = 128;
  const ctx = cv.getContext('2d');

  const grad = ctx.createLinearGradient(0, 0, 0, 128);
  grad.addColorStop(0.0, '#727580');
  grad.addColorStop(0.45, '#3b3c42');
  grad.addColorStop(0.7, '#34312d');
  grad.addColorStop(1.0, '#5a534a');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 256, 128);

  const softbox = (x, y, w, h, color, blur) => {
    ctx.save();
    ctx.filter = `blur(${blur}px)`;
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w, h);
    ctx.restore();
  };
  softbox(10, 6, 118, 46, 'rgba(255,253,248,1)', 3);      // generous lacquer key softbox
  softbox(148, 12, 80, 34, 'rgba(248,250,255,0.95)', 4);  // right fill softbox
  softbox(86, 4, 84, 14, 'rgba(255,255,255,0.78)', 3);    // overhead strip
  softbox(0, 92, 256, 36, 'rgba(165,155,140,0.62)', 6);   // warm bounce below

  const tex = new CanvasTexture(cv);
  tex.colorSpace = SRGBColorSpace;
  const rt = pmrem.fromEquirectangular(tex);
  tex.dispose();
  pmrem.dispose();
  return rt;
}

function makeContactShadow() {
  const cv = document.createElement('canvas');
  cv.width = 128;
  cv.height = 128;
  const ctx = cv.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 16, 64, 64, 62);
  g.addColorStop(0, 'rgba(0,0,0,0.78)');
  g.addColorStop(0.55, 'rgba(0,0,0,0.42)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const tex = new CanvasTexture(cv);
  tex.colorSpace = SRGBColorSpace;
  return tex;
}

function roundedRectPath(target, w, h, r) {
  const hw = w / 2;
  const hh = h / 2;
  const cr = Math.min(r, hw, hh);
  target.moveTo(-hw + cr, -hh);
  target.lineTo(hw - cr, -hh);
  target.absarc(hw - cr, -hh + cr, cr, -Math.PI / 2, 0, false);
  target.lineTo(hw, hh - cr);
  target.absarc(hw - cr, hh - cr, cr, 0, Math.PI / 2, false);
  target.lineTo(-hw + cr, hh);
  target.absarc(-hw + cr, hh - cr, cr, Math.PI / 2, Math.PI, false);
  target.lineTo(-hw, -hh + cr);
  target.absarc(-hw + cr, -hh + cr, cr, Math.PI, Math.PI * 1.5, false);
  return target;
}

function slabGeometry(w, d, r, height, bevel, holes) {
  const shape = roundedRectPath(new Shape(), w - bevel * 2, d - bevel * 2, Math.max(0.01, r - bevel));
  if (holes) {
    for (const [hx, hz, hr] of holes) {
      const p = new Path();
      p.absarc(hx, hz, hr + bevel, 0, TAU, true);
      shape.holes.push(p);
    }
  }
  const geo = new ExtrudeGeometry(shape, {
    depth: Math.max(0.001, height - bevel * 2),
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 1,
    curveSegments: 16,
  });
  geo.rotateX(Math.PI / 2);
  geo.translate(0, -bevel, 0);
  return geo;
}

function create(canvas, opts = {}) {
  const renderer = new WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = NeutralToneMapping;
  renderer.toneMappingExposure = 1.08;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFShadowMap;
  renderer.shadowMap.autoUpdate = false;

  const scene = new Scene();
  let envRT = makeStudioEnv(renderer);
  scene.environment = envRT.texture;
  scene.environmentIntensity = 1.18;

  const camera = new PerspectiveCamera(24, 1, 1, 200);
  camera.position.set(0, 7, 30);

  /* ---------- Overhead Studio Lighting (clean 10-high shadows inside deck bounds) ---------- */
  scene.add(new HemisphereLight(0xffffff, 0x4b463e, 1.1));

  const keyLight = new DirectionalLight(0xfff9f2, 2.0);
  keyLight.position.set(-4.2, 18.5, 9.5);
  keyLight.castShadow = true;
  keyLight.shadow.mapSize.width = 1024;
  keyLight.shadow.mapSize.height = 1024;
  keyLight.shadow.camera.near = 2;
  keyLight.shadow.camera.far = 42;
  keyLight.shadow.camera.left = -6.5;
  keyLight.shadow.camera.right = 6.5;
  keyLight.shadow.camera.top = 15;
  keyLight.shadow.camera.bottom = -4;
  keyLight.shadow.bias = -0.0006;
  keyLight.shadow.normalBias = 0.025;
  scene.add(keyLight);

  const rimLight = new DirectionalLight(0xf0f5ff, 0.95);
  rimLight.position.set(6, 9, -8);
  scene.add(rimLight);

  /* ---------- Materials ---------- */
  const matGraphite = new MeshStandardMaterial({ color: 0x2c2e34, roughness: 0.56, metalness: 0.30 });
  const matGraphiteTop = new MeshStandardMaterial({ color: 0x393b44, roughness: 0.48, metalness: 0.30 });
  const matFoot = new MeshStandardMaterial({ color: 0x0b0c0e, roughness: 0.85, metalness: 0.05 });
  const matBand = new MeshStandardMaterial({ color: 0xf4efe4, roughness: 0.42, metalness: 0.06 });
  const matAlu = new MeshStandardMaterial({ color: 0xebe8e0, roughness: 0.28, metalness: 0.72 });
  const matAluDark = new MeshStandardMaterial({ color: 0xa2a09a, roughness: 0.38, metalness: 0.68 });
  const matWell = new MeshStandardMaterial({ color: 0x101114, roughness: 0.85, metalness: 0.1 });
  const matInlay = new MeshStandardMaterial({
    color: 0xf0ebe0, roughness: 0.52, metalness: 0,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });

  const matLacquer = {
    o: new MeshStandardMaterial({
      color: PIGMENT.o,
      roughness: 0.16,
      metalness: 0.04,
      envMapIntensity: 1.22,
      emissive: 0x621a00,
      emissiveIntensity: 0.24,
    }),
    y: new MeshStandardMaterial({
      color: PIGMENT.y,
      roughness: 0.16,
      metalness: 0.04,
      envMapIntensity: 1.18,
      emissive: 0x7d5800,
      emissiveIntensity: 0.30,
    }),
  };

  /* ---------- Shared Geometry ---------- */
  const geoSphere = new SphereGeometry(R, 32, 22);
  const geoPeg = new CylinderGeometry(0.12, 0.12, 0.22, 16);
  const geoPegTip = new CylinderGeometry(0.12, 0.085, 0.045, 16);
  const geoCollar = new CylinderGeometry(0.185, 0.185, NECK, 20);
  const geoBushing = new CylinderGeometry(0.185, 0.20, 0.05, 20);
  const geoBushHole = new CircleGeometry(0.128, 16);
  const geoHitBall = new SphereGeometry(R * 1.14, 10, 8);

  /* ---------- World ---------- */
  const world = new Group();
  scene.add(world);

  // Tight deck-bounded shadow plane so tall stacks never cast clipped shadows into empty space
  const floor = new Mesh(new PlaneGeometry(10.5, 7.6), new ShadowMaterial({ opacity: 0.34 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = FLOOR_Y;
  floor.receiveShadow = true;
  world.add(floor);

  const contactTex = makeContactShadow();
  const contact = new Mesh(
    new PlaneGeometry(9.8, 6.8),
    new MeshBasicMaterial({ map: contactTex, transparent: true, opacity: 0.62, depthWrite: false })
  );
  contact.rotation.x = -Math.PI / 2;
  contact.position.y = FLOOR_Y + 0.004;
  world.add(contact);

  /* ---------- Base: Foot, Warm-White Band, Slab with 10 Machined Cups ---------- */
  const base = new Group();
  world.add(base);

  const DECK_W = 7.35;
  const DECK_D = 4.65;
  const cupHoles = [];
  for (let i = 0; i < 5; i++) {
    cupHoles.push([(i - 2) * CUP_STEP, CUP_Z, CUP_R]);
    cupHoles.push([(i - 2) * CUP_STEP, -CUP_Z, CUP_R]);
  }
  cupHoles.push([-PEG_X, 0, 0.06]);
  cupHoles.push([PEG_X, 0, 0.06]);

  const deck = new Mesh(slabGeometry(DECK_W, DECK_D, 0.14, 0.34, 0.022, cupHoles), matGraphite);
  deck.position.y = DECK_TOP;
  deck.castShadow = false;
  deck.receiveShadow = true;
  base.add(deck);

  const band = new Mesh(slabGeometry(DECK_W + 0.04, DECK_D + 0.04, 0.16, 0.08, 0, null), matBand);
  band.position.y = DECK_TOP - 0.34;
  base.add(band);

  const foot = new Mesh(slabGeometry(DECK_W - 0.2, DECK_D - 0.2, 0.1, 0.066, 0, null), matFoot);
  foot.position.y = DECK_TOP - 0.34 - 0.08;
  base.add(foot);

  const geoCupFloor = new CircleGeometry(CUP_R + 0.03, 20);
  for (const [cx, cz] of cupHoles.slice(0, 10)) {
    const f = new Mesh(geoCupFloor, matWell);
    f.rotation.x = -Math.PI / 2;
    f.position.set(cx, DECK_TOP - 0.24, cz);
    base.add(f);
  }

  /* ---------- Raised 3-Position Platform ---------- */
  const PLAT_W = 4.5;
  const PLAT_D = 1.5;
  const PLAT_H = -DECK_TOP;
  const platform = new Mesh(
    slabGeometry(PLAT_W, PLAT_D, 0.09, PLAT_H, 0.02, COL_X.map((x) => [x, 0, 0.15])),
    matGraphiteTop
  );
  platform.castShadow = false;
  platform.receiveShadow = true;
  base.add(platform);

  const inlayShape = roundedRectPath(new Shape(), PLAT_W - 0.16, PLAT_D - 0.16, 0.05);
  inlayShape.holes.push(roundedRectPath(new Path(), PLAT_W - 0.22, PLAT_D - 0.22, 0.03));
  const inlay = new Mesh(new ShapeGeometry(inlayShape, 8), matInlay);
  inlay.rotation.x = -Math.PI / 2;
  inlay.position.y = 0.0015;
  base.add(inlay);

  const sockets = [];
  const geoSockRing = new RingGeometry(0.17, 0.29, 28);
  const geoSockFloor = new CircleGeometry(0.19, 16);
  const geoBar = new BoxGeometry(0.76, 0.075, 0.035);
  for (let c = 0; c < 3; c++) {
    const x = COL_X[c];
    const ring = new Mesh(geoSockRing, matAlu);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(x, 0.003, 0);
    ring.receiveShadow = true;
    base.add(ring);

    const wellFloor = new Mesh(geoSockFloor, matWell);
    wellFloor.rotation.x = -Math.PI / 2;
    wellFloor.position.set(x, -0.24, 0);
    base.add(wellFloor);

    const barMat = new MeshBasicMaterial({ color: IDLE_BAR });
    const bar = new Mesh(geoBar, barMat);
    bar.position.set(x, -PLAT_H * 0.5, PLAT_D / 2 + 0.008);
    base.add(bar);

    const dotMat = new MeshBasicMaterial({
      color: IDLE_BAR, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    const dot = new Mesh(new CircleGeometry(0.058, 16), dotMat);
    dot.rotation.x = -Math.PI / 2;
    dot.position.set(x, 0.0018, 0.5);
    base.add(dot);

    sockets.push({ bar, barMat, dotMat, color: new Color(IDLE_BAR), goal: new Color(IDLE_BAR), width: 1, flash: 0 });
  }

  /* ---------- Crisp Landing Seat Ring ---------- */
  const reticleMat = new MeshBasicMaterial({ color: BONE, side: DoubleSide, transparent: true, opacity: 0, depthWrite: false });
  const reticle = new Mesh(new RingGeometry(R + 0.04, R + 0.078, 48), reticleMat);
  reticle.visible = false;
  world.add(reticle);
  const reticleGoal = new Vector3();

  /* ---------- Twin Aluminum Score Rods ---------- */
  const RIDER_STEP = 0.4;
  const RIDER_H = 0.3;
  const riderRestY = DECK_TOP + 0.07 + RIDER_H / 2;
  const scorePegs = {};
  function buildScorePeg(player, x) {
    const g = new Group();
    g.position.set(x, 0, 0);
    base.add(g);

    const collar = new Mesh(new CylinderGeometry(0.19, 0.21, 0.07, 18), matAlu);
    collar.position.y = DECK_TOP + 0.035;
    g.add(collar);

    const rodH = 0.07 + RIDER_STEP * 3 + RIDER_H + 0.08;
    const rod = new Mesh(new CylinderGeometry(0.05, 0.05, rodH, 12), matAlu);
    rod.position.y = DECK_TOP + rodH / 2;
    g.add(rod);

    for (let i = 1; i <= 3; i++) {
      const fl = new Mesh(new CylinderGeometry(0.088, 0.088, 0.024, 14), matAluDark);
      fl.position.y = DECK_TOP + 0.07 + RIDER_STEP * i - 0.012;
      g.add(fl);
    }

    const cap = new Mesh(new CylinderGeometry(0.085, 0.085, 0.05, 14), matAlu);
    cap.position.y = DECK_TOP + rodH + 0.02;
    g.add(cap);

    const rider = new Group();
    const sleeve = new Mesh(new CylinderGeometry(0.145, 0.145, RIDER_H - 0.05, 18), matLacquer[player]);
    sleeve.castShadow = true;
    rider.add(sleeve);
    for (const s of [-1, 1]) {
      const end = new Mesh(new CylinderGeometry(0.155, 0.155, 0.026, 18), matAlu);
      end.position.y = s * (RIDER_H / 2 - 0.013);
      rider.add(end);
    }
    rider.position.y = riderRestY;
    g.add(rider);

    scorePegs[player] = { rider, level: 0, y: riderRestY, vy: 0 };
  }
  buildScorePeg('y', -PEG_X);
  buildScorePeg('o', PEG_X);

  /* ---------- Spheres ---------- */
  function createBallEntity(colorKey, poolIdx) {
    const g = new Group();

    const sphere = new Mesh(geoSphere, matLacquer[colorKey]);
    sphere.castShadow = true;
    sphere.receiveShadow = true;
    g.add(sphere);

    const pegGroup = new Group();
    const collar = new Mesh(geoCollar, matAlu);
    collar.position.y = -R - NECK / 2 + 0.004;
    pegGroup.add(collar);
    const peg = new Mesh(geoPeg, matAlu);
    peg.position.y = -R - NECK - 0.11 + 0.01;
    pegGroup.add(peg);
    const tip = new Mesh(geoPegTip, matAlu);
    tip.position.y = -R - NECK - 0.22 - 0.0225 + 0.01;
    pegGroup.add(tip);
    pegGroup.visible = false;
    g.add(pegGroup);

    const bushing = new Mesh(geoBushing, matAlu);
    bushing.position.y = R - 0.021;
    g.add(bushing);
    const hole = new Mesh(geoBushHole, matWell);
    hole.rotation.x = -Math.PI / 2;
    hole.position.y = R + 0.007;
    g.add(hole);

    const hit = new Mesh(geoHitBall, new MeshBasicMaterial({ visible: false }));
    g.add(hit);

    const entity = {
      color: colorKey,
      poolIdx,
      group: g,
      pegGroup,
      hit,
      col: -1,
      row: -1,
      inReserve: true,
      targetPos: new Vector3(),
      restY: 0,
      settleT: -1,
      settleAmp: 0,
      win: false,
      winOrder: 0,
    };
    hit.userData = { kind: 'ball', entity };
    world.add(g);
    return entity;
  }

  const pool = {
    o: Array.from({ length: 5 }, (_, i) => createBallEntity('o', i)),
    y: Array.from({ length: 5 }, (_, i) => createBallEntity('y', i)),
  };
  const allBalls = pool.o.concat(pool.y);

  function reservePos(colorKey, idx) {
    const slot = colorKey === 'o' ? 4 - idx : idx;
    return new Vector3((slot - 2) * CUP_STEP, DECK_TOP + CUP_SEAT, colorKey === 'o' ? CUP_Z : -CUP_Z);
  }

  /* ---------- Winning Alignment Frame ---------- */
  const frameMat = new MeshStandardMaterial({ color: 0xf7f3e8, roughness: 0.34, metalness: 0.16 });
  const frameGroup = new Group();
  world.add(frameGroup);
  let activeFrames = [];
  const FRAME_Z = R + 0.09;
  const FRAME_R = R + 0.105;
  const PITCH = (16.5 * Math.PI) / 180;
  const FRAME_RISE = FRAME_Z * Math.tan(PITCH);

  function stadiumGeometry(len, rr) {
    const half = len / 2;
    const N = 14;
    const path = new CurvePath();
    const arc = (cy, a0, a1) => {
      const arcPts = [];
      for (let i = 0; i <= N; i++) {
        const a = lerp(a0, a1, i / N);
        arcPts.push(new Vector3(Math.cos(a) * rr, cy + Math.sin(a) * rr, 0));
      }
      return new CatmullRomCurve3(arcPts);
    };
    path.add(new LineCurve3(new Vector3(rr, -half, 0), new Vector3(rr, half, 0)));
    path.add(arc(half, 0, Math.PI));
    path.add(new LineCurve3(new Vector3(-rr, half, 0), new Vector3(-rr, -half, 0)));
    path.add(arc(-half, Math.PI, TAU));
    return new TubeGeometry(path, 96, 0.036, 10, true);
  }

  function clearOutcomeVisuals() {
    for (const f of activeFrames) {
      frameGroup.remove(f.mesh);
      f.mesh.geometry.dispose();
    }
    activeFrames = [];
    for (const ent of allBalls) {
      ent.win = false;
      ent.winOrder = 0;
    }
    wake();
  }

  let winClock = 0;
  function setOutcome(outcome) {
    clearOutcomeVisuals();
    if (!outcome || !outcome.lines || !outcome.lines.length) return;
    winClock = 0;

    const winMap = new Map();
    for (const line of outcome.lines) {
      const p0 = new Vector3(COL_X[line.cells[0].c], ballY(line.cells[0].r), 0);
      const p2 = new Vector3(COL_X[line.cells[2].c], ballY(line.cells[2].r), 0);
      const mid = p0.clone().add(p2).multiplyScalar(0.5);
      const dir = p2.clone().sub(p0);
      const len = dir.length();

      const mesh = new Mesh(stadiumGeometry(len, FRAME_R), frameMat);
      mesh.position.set(mid.x, mid.y + FRAME_RISE, FRAME_Z + 1.5);
      mesh.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), dir.clone().normalize());
      mesh.scale.setScalar(1.14);
      mesh.visible = false;
      frameGroup.add(mesh);
      activeFrames.push({ mesh, mid, age: -0.05 * activeFrames.length });

      line.cells.forEach((pt, idx) => winMap.set(`${pt.c},${pt.r}`, idx));
    }
    for (const ent of allBalls) {
      const key = `${ent.col},${ent.row}`;
      if (!ent.inReserve && winMap.has(key)) {
        ent.win = true;
        ent.winOrder = winMap.get(key);
      }
    }
    shadowDirty = true;
    wake();
  }

  /* ---------- Board State & Demand Rendering Control ---------- */
  let boardCols = [[], [], []];
  let curTurn = 'o';
  let interactive = { enabled: false, phase: 'place', turn: 'o', canSelect: false };
  let hoveredCol = -1;
  let extHoveredCol = -1;
  let hoveredBall = null;
  let selected = null;
  let attractMode = false;
  let pausedRender = false;
  let insets = { top: 88, bottom: 112, left: 0, right: 0 };
  let activeMoveAnim = null;
  let shadowDirty = true;
  let rafId = 0;
  let lastT = performance.now();
  let disposed = false;

  function wake() {
    if (disposed || pausedRender || rafId) return;
    lastT = performance.now();
    rafId = requestAnimationFrame(tick);
  }

  function syncBoardInstant(state) {
    activeMoveAnim = null;
    boardCols = [[], [], []];
    const used = { o: 0, y: 0 };

    for (let c = 0; c < 3; c++) {
      const col = (state.cols && state.cols[c]) || [];
      for (let r = 0; r < col.length; r++) {
        const p = col[r];
        const ent = pool[p][used[p]++];
        if (!ent) continue;
        ent.inReserve = false;
        ent.col = c;
        ent.row = r;
        ent.targetPos.set(COL_X[c], ballY(r), 0);
        ent.group.position.copy(ent.targetPos);
        ent.restY = ent.targetPos.y;
        ent.pegGroup.visible = true;
        ent.group.scale.setScalar(1);
        ent.settleT = -1;
        boardCols[c].push(ent);
      }
    }
    for (const p of ['o', 'y']) {
      for (let i = used[p]; i < 5; i++) {
        const ent = pool[p][i];
        ent.inReserve = true;
        ent.col = -1;
        ent.row = -1;
        ent.targetPos.copy(reservePos(p, i));
        ent.group.position.copy(ent.targetPos);
        ent.restY = ent.targetPos.y;
        ent.pegGroup.visible = false;
        ent.group.scale.setScalar(1);
        ent.settleT = -1;
      }
    }
    shadowDirty = true;
    wake();
  }

  function finishActiveAnimInstant() {
    if (!activeMoveAnim) return;
    const a = activeMoveAnim;
    for (let i = 0; i < a.balls.length; i++) {
      a.balls[i].group.position.copy(a.ends[i]);
      a.balls[i].restY = a.ends[i].y;
      a.balls[i].pegGroup.visible = true;
    }
    activeMoveAnim = null;
    shadowDirty = true;
  }

  function boardMatchesState(state) {
    for (let c = 0; c < 3; c++) {
      const col = (state.cols && state.cols[c]) || [];
      if (boardCols[c].length !== col.length) return false;
      for (let r = 0; r < col.length; r++) {
        if (boardCols[c][r].color !== col[r]) return false;
      }
    }
    return true;
  }

  function startMoveAnimation(state, moveHint) {
    finishActiveAnimInstant();
    if (!moveHint) { syncBoardInstant(state); return; }

    if (moveHint.type === 'place') {
      const p = moveHint.by;
      const to = moveHint.to;
      const ent = pool[p].find((e) => e.inReserve);
      if (!ent) { syncBoardInstant(state); return; }
      const startPos = ent.group.position.clone();
      const destRow = boardCols[to].length;
      const endPos = new Vector3(COL_X[to], ballY(destRow), 0);

      ent.inReserve = false;
      ent.col = to;
      ent.row = destRow;
      ent.targetPos.copy(endPos);
      boardCols[to].push(ent);
      if (!boardMatchesState(state)) { syncBoardInstant(state); return; }

      const clearY = endPos.y + 0.48;
      const travel = Math.abs(endPos.x - startPos.x) + (clearY - startPos.y) * 0.5;
      activeMoveAnim = {
        kind: 'place', balls: [ent], starts: [startPos], ends: [endPos],
        clearY, toCol: to, destRow, color: p, startMs: performance.now(),
        dur: clamp(0.32 + travel * 0.022, 0.34, 0.48),
      };
      shadowDirty = true;
      wake();
      return;
    }

    if (moveHint.type === 'stack') {
      const { from, row, to } = moveHint;
      const srcCol = boardCols[from];
      if (!srcCol || row < 0 || row >= srcCol.length) { syncBoardInstant(state); return; }
      const moving = srcCol.splice(row);
      const destStartRow = boardCols[to].length;
      const starts = moving.map((e) => e.group.position.clone());
      const ends = [];
      for (let i = 0; i < moving.length; i++) {
        const e = moving[i];
        e.col = to;
        e.row = destStartRow + i;
        const ep = new Vector3(COL_X[to], ballY(destStartRow + i), 0);
        e.targetPos.copy(ep);
        ends.push(ep);
        boardCols[to].push(e);
      }
      if (!boardMatchesState(state)) { syncBoardInstant(state); return; }

      const clearY = Math.max(ballY(row) + 0.52, ends[0].y + 0.48);
      let swingZ = 0;
      if (Math.abs(from - to) === 2 && boardCols[1].length) {
        const midTop = ballY(boardCols[1].length - 1) + R;
        if (midTop > clearY - R - 0.1) swingZ = R * 2 + 0.2;
      }
      const rise = clearY - starts[0].y;
      activeMoveAnim = {
        kind: 'stack', balls: moving, starts, ends,
        clearY, swingZ, toCol: to, destRow: destStartRow, color: moveHint.by, startMs: performance.now(),
        dur: clamp(0.38 + rise * 0.022 + (swingZ ? 0.07 : 0) + Math.abs(from - to) * 0.025, 0.40, 0.56),
      };
      shadowDirty = true;
      wake();
    }
  }

  function updateScores(scores, animatePlayer) {
    if (!scores) return;
    for (const p of ['o', 'y']) {
      const sc = clamp(scores[p] || 0, 0, 3);
      const peg = scorePegs[p];
      if (peg.level !== sc) {
        peg.level = sc;
        if (animatePlayer !== p) {
          peg.y = riderRestY + sc * RIDER_STEP;
          peg.vy = 0;
          peg.rider.position.y = peg.y; // immediately snap mesh on match reset!
        }
        shadowDirty = true;
        wake();
      }
    }
  }

  /* ---------- Cached Pointer, Zero Allocations, Dedicated pointercancel ---------- */
  const raycaster = new Raycaster();
  const pointerNdc = new Vector2();
  const pointerPx = { x: 0, y: 0 };
  const normMouse = { x: 0, y: 0 };
  const tmpWorldPos = new Vector3();
  const hitTargetsBuf = [];
  let canvasRect = { left: 0, top: 0, width: 1, height: 1 };
  let pointerDirty = false;
  let hasPointer = false;
  let drag = null;

  function refreshCanvasRect() {
    const r = canvas.getBoundingClientRect();
    canvasRect.left = r.left;
    canvasRect.top = r.top;
    canvasRect.width = Math.max(1, r.width);
    canvasRect.height = Math.max(1, r.height);
  }

  function updatePointer(ev) {
    const x = ev.clientX - canvasRect.left;
    const y = ev.clientY - canvasRect.top;
    pointerPx.x = x;
    pointerPx.y = y;
    pointerNdc.x = (x / canvasRect.width) * 2 - 1;
    pointerNdc.y = -(y / canvasRect.height) * 2 + 1;
    normMouse.x = clamp(pointerNdc.x, -1, 1);
    normMouse.y = clamp(pointerNdc.y, -1, 1);
    hasPointer = true;
  }

  function pickBall() {
    raycaster.setFromCamera(pointerNdc, camera);
    hitTargetsBuf.length = 0;
    for (let c = 0; c < 3; c++) {
      const col = boardCols[c];
      for (let r = 0; r < col.length; r++) hitTargetsBuf.push(col[r].hit);
    }
    const hits = raycaster.intersectObjects(hitTargetsBuf, false);
    if (hits.length) {
      const ent = hits[0].object.userData.entity;
      if (ent && !ent.inReserve) return { col: ent.col, row: ent.row, color: ent.color };
    }
    return null;
  }

  function pointerWorldOnZ0() {
    raycaster.setFromCamera(pointerNdc, camera);
    const t = -raycaster.ray.origin.z / (raycaster.ray.direction.z || -0.0001);
    return tmpWorldPos.set(
      raycaster.ray.origin.x + raycaster.ray.direction.x * t,
      raycaster.ray.origin.y + raycaster.ray.direction.y * t,
      0
    );
  }

  function pickColumn() {
    const wp = pointerWorldOnZ0();
    if (wp.y < FLOOR_Y - 0.6 || Math.abs(wp.x) > 2.8) return -1;
    if (wp.x < -0.77) return 0;
    if (wp.x > 0.77) return 2;
    return 1;
  }

  function beginDrag(col, row, ev, wp) {
    drag = {
      pointerId: ev.pointerId,
      fromCol: col,
      row,
      startX: pointerPx.x,
      startY: pointerPx.y,
      active: false,
      targetCol: -1,
      worldPos: wp ? wp.clone() : pointerWorldOnZ0().clone(),
    };
    try { canvas.setPointerCapture(ev.pointerId); } catch (e) {}
    wake();
  }

  function onPointerDown(ev) {
    if (!interactive.enabled || activeMoveAnim) return;
    if (ev.button !== undefined && ev.button !== 0) return;
    if (drag) return;
    refreshCanvasRect();
    updatePointer(ev);

    if (interactive.phase === 'place') {
      const col = pickColumn();
      if (col >= 0 && opts.onColumnClick) opts.onColumnClick(col);
      return;
    }

    if (interactive.phase === 'stack') {
      const ball = pickBall();
      if (selected) {
        const col = ball ? ball.col : pickColumn();
        if (col >= 0 && col !== selected.col) {
          const fromCol = selected.col;
          const row = selected.row;
          selected = null;
          if (opts.onStackDrop) opts.onStackDrop(fromCol, row, col);
          return;
        }
        if (ball && ball.col === selected.col && ball.color === interactive.turn && ball.row !== selected.row) {
          selected = { col: ball.col, row: ball.row };
          shadowDirty = true;
          wake();
          if (opts.onBallSelect) opts.onBallSelect(ball.col, ball.row);
          return;
        }
        selected = null;
        shadowDirty = true;
        wake();
        if (opts.onCancelSelect) opts.onCancelSelect();
        return;
      }

      if (ball && ball.color === interactive.turn) {
        beginDrag(ball.col, ball.row, ev);
      } else {
        const col = pickColumn();
        if (col >= 0 && boardCols[col].length) {
          const wp = pointerWorldOnZ0();
          let bestRow = -1;
          let bestDist = 0.95;
          for (let r = 0; r < boardCols[col].length; r++) {
            if (boardCols[col][r].color !== interactive.turn) continue;
            const d = Math.abs(ballY(r) - wp.y);
            if (d < bestDist) { bestDist = d; bestRow = r; }
          }
          if (bestRow >= 0) beginDrag(col, bestRow, ev, wp);
        }
      }
    }
  }

  function onPointerMove(ev) {
    if (drag && ev.pointerId !== drag.pointerId) return;
    updatePointer(ev);
    pointerDirty = true;
    wake();
  }

  function processHoverInFrame() {
    pointerDirty = false;
    if (!interactive.enabled || activeMoveAnim || !hasPointer) {
      hoveredCol = -1;
      hoveredBall = null;
      if (canvas.style.cursor) canvas.style.cursor = '';
      return;
    }

    if (drag) {
      const dist = Math.hypot(pointerPx.x - drag.startX, pointerPx.y - drag.startY);
      if (!drag.active && dist > 12) drag.active = true;
      if (drag.active) {
        drag.worldPos.copy(pointerWorldOnZ0());
        const col = pickColumn();
        drag.targetCol = (col >= 0 && col !== drag.fromCol) ? col : -1;
        hoveredCol = drag.targetCol;
        if (canvas.style.cursor !== 'grabbing') canvas.style.cursor = 'grabbing';
        return;
      }
    }

    if (interactive.phase === 'place') {
      hoveredCol = pickColumn();
      hoveredBall = null;
      const cur = hoveredCol >= 0 ? 'pointer' : '';
      if (canvas.style.cursor !== cur) canvas.style.cursor = cur;
      return;
    }

    if (interactive.phase === 'stack') {
      if (selected) {
        const c = pickColumn();
        hoveredCol = (c >= 0 && c !== selected.col) ? c : -1;
        hoveredBall = null;
        const cur = hoveredCol >= 0 ? 'pointer' : '';
        if (canvas.style.cursor !== cur) canvas.style.cursor = cur;
      } else {
        const b = pickBall();
        if (b && b.color === interactive.turn) {
          hoveredBall = { col: b.col, row: b.row };
          hoveredCol = -1;
          if (canvas.style.cursor !== 'grab') canvas.style.cursor = 'grab';
        } else {
          hoveredBall = null;
          hoveredCol = -1;
          if (canvas.style.cursor) canvas.style.cursor = '';
        }
      }
    }
  }

  function onPointerUp(ev) {
    if (!drag || ev.pointerId !== drag.pointerId) return;
    const d = drag;
    drag = null;
    canvas.style.cursor = '';
    try { canvas.releasePointerCapture(ev.pointerId); } catch (e) {}

    if (d.active) {
      updatePointer(ev);
      const col = pickColumn();
      if (col >= 0 && col !== d.fromCol) {
        selected = null;
        if (opts.onStackDrop) opts.onStackDrop(d.fromCol, d.row, col);
        return;
      }
    }
    selected = { col: d.fromCol, row: d.row };
    shadowDirty = true;
    wake();
    if (opts.onBallSelect) opts.onBallSelect(d.fromCol, d.row);
  }

  // Dedicated pointercancel: restores stack cleanly without committing an unintended move!
  function onPointerCancel(ev) {
    if (!drag || ev.pointerId !== drag.pointerId) return;
    drag = null;
    selected = null;
    hoveredCol = -1;
    hoveredBall = null;
    canvas.style.cursor = '';
    try { canvas.releasePointerCapture(ev.pointerId); } catch (e) {}
    shadowDirty = true;
    wake();
    if (opts.onCancelSelect) opts.onCancelSelect();
  }

  function onPointerLeave() {
    hasPointer = false;
    if (!drag) {
      hoveredCol = -1;
      hoveredBall = null;
      canvas.style.cursor = '';
      wake();
    }
  }

  function onWindowPointerMove(ev) {
    if (attractMode && !pausedRender && canvasRect.width > 1) {
      normMouse.x = clamp(((ev.clientX - canvasRect.left) / canvasRect.width) * 2 - 1, -1, 1);
      normMouse.y = clamp(-((ev.clientY - canvasRect.top) / canvasRect.height) * 2 + 1, -1, 1);
      wake();
    }
  }

  function onContextLost(ev) {
    ev.preventDefault();
    cancelAnimationFrame(rafId);
    rafId = 0;
  }
  function onContextRestored() {
    try {
      if (envRT) envRT.dispose();
      envRT = makeStudioEnv(renderer);
      scene.environment = envRT.texture;
      shadowDirty = true;
      wake();
    } catch (e) {}
  }

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove, { passive: true });
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerCancel);
  canvas.addEventListener('pointerleave', onPointerLeave);
  canvas.addEventListener('webglcontextlost', onContextLost);
  canvas.addEventListener('webglcontextrestored', onContextRestored);
  window.addEventListener('pointermove', onWindowPointerMove, { passive: true });

  /* ---------- Camera: Stable Framing (min 4 rows in gameplay to avoid early zoom jump) ---------- */
  const camLook = new Vector3(0, 1.4, 0);
  const camLookGoal = new Vector3(0, 1.4, 0);
  let camDist = 30;
  let camDistGoal = 30;
  let camAz = 0;
  let viewOffX = 0;
  let viewOffY = 0;
  let appliedOffX = NaN;
  let appliedOffY = NaN;
  let camSnapped = false;
  let vpW = 1;
  let vpH = 1;

  function computeCameraGoal() {
    let maxRows = attractMode ? 3 : 4;
    for (let c = 0; c < 3; c++) if (boardCols[c].length > maxRows) maxRows = boardCols[c].length;

    const topY = ballY(maxRows - 1) + R + (attractMode ? 0.72 : STEP_Y * 0.92);
    const botY = FLOOR_Y - (attractMode ? 0.85 : 0.65);
    const spanY = topY - botY;
    const spanX = attractMode ? 8.6 : 8.1;

    const uW = Math.max(140, vpW - insets.left - insets.right);
    const uH = Math.max(160, vpH - insets.top - insets.bottom);
    const tanV = Math.tan((camera.fov * Math.PI) / 360);
    const dV = (spanY * vpH) / (2 * tanV * uH);
    const dH = (spanX * vpH) / (2 * tanV * uW);
    camDistGoal = Math.max(dV, dH) * 1.02;
    camLookGoal.set(0, (topY + botY) / 2, 0);
  }

  function resize() {
    const parent = canvas.parentElement;
    const w = parent ? parent.clientWidth : window.innerWidth;
    const h = parent ? parent.clientHeight : window.innerHeight;
    vpW = Math.max(1, w);
    vpH = Math.max(1, h);
    camera.aspect = vpW / vpH;
    appliedOffX = NaN;
    appliedOffY = NaN;
    camera.updateProjectionMatrix();
    renderer.setSize(vpW, vpH, false);
    refreshCanvasRect();
    wake();
  }

  /* ---------- Demand-Driven 60-120fps Frame Loop ---------- */
  const tmpV = new Vector3();
  const tmpColor = new Color();

  function tick(nowMs) {
    rafId = 0;
    if (disposed || pausedRender) return;

    const dt = Math.min(0.05, Math.max(0.001, (nowMs - lastT) / 1000));
    lastT = nowMs;
    const nowSec = nowMs / 1000;

    if (pointerDirty) processHoverInFrame();

    let keepRunning = attractMode;
    let shadowMoved = false;

    /* 1. Camera */
    computeCameraGoal();
    const k = camSnapped ? 1 - Math.exp(-6.5 * dt) : 1;
    camSnapped = true;
    const prevDist = camDist;
    const prevLookY = camLook.y;
    camDist = lerp(camDist, camDistGoal, k);
    camLook.lerp(camLookGoal, k);
    const offXGoal = -((insets.left - insets.right) / 2);
    const offYGoal = -((insets.top - insets.bottom) / 2);
    viewOffX = lerp(viewOffX, offXGoal, k);
    viewOffY = lerp(viewOffY, offYGoal, k);

    const azGoal = attractMode
      ? Math.sin(nowSec * 0.30) * 0.16 + normMouse.x * 0.08
      : normMouse.x * 0.036;
    const prevAz = camAz;
    camAz = lerp(camAz, azGoal, 1 - Math.exp(-5.5 * dt));

    if (
      Math.abs(camDist - camDistGoal) > 0.004 ||
      Math.abs(camLook.y - camLookGoal.y) > 0.002 ||
      Math.abs(viewOffX - offXGoal) > 0.08 ||
      Math.abs(viewOffY - offYGoal) > 0.08 ||
      Math.abs(camAz - azGoal) > 0.0008 ||
      Math.abs(camDist - prevDist) > 0.001 ||
      Math.abs(camLook.y - prevLookY) > 0.001 ||
      Math.abs(camAz - prevAz) > 0.0004
    ) {
      keepRunning = true;
    }

    const cp = Math.cos(PITCH);
    camera.position.set(
      camLook.x + Math.sin(camAz) * cp * camDist,
      camLook.y + Math.sin(PITCH) * camDist,
      camLook.z + Math.cos(camAz) * cp * camDist
    );
    camera.lookAt(camLook);
    if (Math.abs(viewOffX - appliedOffX) > 0.05 || Math.abs(viewOffY - appliedOffY) > 0.05 || Number.isNaN(appliedOffX)) {
      camera.setViewOffset(vpW, vpH, viewOffX, viewOffY, vpW, vpH);
      appliedOffX = viewOffX;
      appliedOffY = viewOffY;
    }

    /* 2. Active move flight (wall-clock elapsed time — immune to throttled timers!) */
    if (activeMoveAnim) {
      keepRunning = true;
      shadowMoved = true;
      const a = activeMoveAnim;
      const p = clamp((nowMs - a.startMs) / (a.dur * 1000), 0, 1);

      if (a.kind === 'place') {
        const ent = a.balls[0];
        const s = a.starts[0];
        const e = a.ends[0];
        const up = easeInOutCubic(seg(p, 0, 0.46));
        const across = easeInOutCubic(seg(p, 0.05, 0.62));
        const inward = easeInOutCubic(seg(p, 0.30, 0.78));
        const press = easeInQuad(seg(p, 0.78, 1));
        ent.group.position.set(
          lerp(s.x, e.x, across),
          lerp(lerp(s.y, a.clearY, up), e.y, press),
          lerp(s.z, 0, inward)
        );
        // Reveal peg only once it clears the underside of the deck (still occluded inside the cup rim)
        if (!ent.pegGroup.visible && ent.group.position.y > 0.12) ent.pegGroup.visible = true;
      } else {
        const lift = easeInOutCubic(seg(p, 0, 0.32));
        const across = easeInOutCubic(seg(p, 0.20, 0.78));
        const press = easeInQuad(seg(p, 0.78, 1));
        const swing = Math.sin(across * Math.PI) * a.swingZ;
        for (let i = 0; i < a.balls.length; i++) {
          const ent = a.balls[i];
          const s = a.starts[i];
          const e = a.ends[i];
          const rel = i * STEP_Y;
          ent.group.position.set(
            lerp(s.x, e.x, across),
            lerp(lerp(s.y, a.clearY + rel, lift), e.y, press),
            lerp(s.z, 0, across) + swing
          );
        }
      }

      if (p >= 1) {
        for (let i = 0; i < a.balls.length; i++) {
          const ent = a.balls[i];
          ent.group.position.copy(a.ends[i]);
          ent.restY = a.ends[i].y;
          ent.pegGroup.visible = true;
          ent.settleT = 0;
          ent.settleAmp = 0.042;
        }
        const colArr = boardCols[a.toCol];
        for (let r = 0; r < a.destRow; r++) {
          colArr[r].settleT = 0;
          colArr[r].settleAmp = 0.011;
        }
        sockets[a.toCol].flash = 1.0;
        activeMoveAnim = null;
        if (opts.onSnapImpact) opts.onSnapImpact(a.kind);
        if (opts.onAnimDone) opts.onAnimDone(a.kind);
      }
    }

    /* 3. Spheres: rest, reserve anticipation, hover lift, selected float, drag */
    const follow = 1 - Math.exp(-24 * dt);
    const flying = activeMoveAnim ? activeMoveAnim.balls : null;
    winClock += dt;

    const effHoverCol = hoveredCol >= 0 ? hoveredCol : extHoveredCol;
    const nextReserveEnt = (interactive.enabled && interactive.phase === 'place' && !activeMoveAnim && effHoverCol >= 0)
      ? pool[interactive.turn].find((e) => e.inReserve)
      : null;

    for (const ent of allBalls) {
      if (flying && flying.indexOf(ent) >= 0) continue;

      if (ent.inReserve) {
        const readyLift = ent === nextReserveEnt ? 0.22 : 0;
        const gy = ent.targetPos.y + readyLift;
        if (Math.abs(ent.group.position.y - gy) > 0.002 || Math.abs(ent.group.position.x - ent.targetPos.x) > 0.002) {
          ent.group.position.x = lerp(ent.group.position.x, ent.targetPos.x, follow);
          ent.group.position.y = lerp(ent.group.position.y, gy, follow);
          ent.group.position.z = lerp(ent.group.position.z, ent.targetPos.z, follow);
          keepRunning = true;
          shadowMoved = true;
        }
        continue;
      }

      if (drag && drag.active && ent.col === drag.fromCol && ent.row >= drag.row) {
        const rel = ent.row - drag.row;
        const overCol = drag.targetCol;
        const gx = overCol >= 0 ? lerp(drag.worldPos.x, COL_X[overCol], 0.72) : clamp(drag.worldPos.x, -3.4, 3.4);
        const minY = overCol >= 0 ? ballY(boardCols[overCol].length) + 0.42 : ballY(drag.row) + 0.42;
        const gy = Math.max(drag.worldPos.y, minY) + rel * STEP_Y;
        tmpV.set(gx, gy, 0.14);
        ent.group.position.lerp(tmpV, 1 - Math.exp(-28 * dt));
        ent.restY = ent.group.position.y;
        keepRunning = true;
        shadowMoved = true;
        continue;
      }

      let liftY = 0;
      let bobY = 0;
      if (selected && ent.col === selected.col && ent.row >= selected.row) {
        liftY = 0.62;
        bobY = Math.sin(nowSec * 3.0) * 0.018;
        keepRunning = true; // animate gentle float, but do NOT re-render 1024² shadows for 0.018 bob!
      } else if (!selected && !drag && hoveredBall && ent.col === hoveredBall.col && ent.row >= hoveredBall.row) {
        liftY = 0.30;
      }

      let settle = 0;
      if (ent.settleT >= 0) {
        ent.settleT += dt;
        settle = ent.settleAmp * Math.exp(-12 * ent.settleT) * Math.abs(Math.sin(ent.settleT * 38));
        if (ent.settleT > 0.45) ent.settleT = -1;
        keepRunning = true;
      }

      const pos = ent.group.position;
      const goalY = ent.targetPos.y + liftY;
      const largeMove = Math.abs(pos.x - ent.targetPos.x) > 0.003 || Math.abs(ent.restY - goalY) > 0.003;
      if (largeMove || settle > 0 || bobY !== 0) {
        pos.x = lerp(pos.x, ent.targetPos.x, follow);
        pos.z = lerp(pos.z, ent.targetPos.z, follow);
        ent.restY = lerp(ent.restY, goalY, follow);
        pos.y = ent.restY + settle + bobY;
        keepRunning = true;
        if (largeMove) shadowMoved = true;
      }

      let sc = 1;
      if (ent.win) {
        const t = Math.max(0, winClock - ent.winOrder * 0.075);
        const first = Math.exp(-5.5 * t) * Math.sin(Math.min(t * 10, Math.PI)) * 0.085;
        const slow = t > 0.6 ? (0.5 - 0.5 * Math.cos((t - 0.6) * 3.6)) * 0.024 : 0;
        sc = 1 + first + slow;
        keepRunning = true;
      }
      if (Math.abs(ent.group.scale.x - sc) > 0.0006) {
        ent.group.scale.setScalar(lerp(ent.group.scale.x, sc, 1 - Math.exp(-22 * dt)));
        keepRunning = true;
      }
    }

    /* 4. Column indicator bars & seat ring */
    const canAim = interactive.enabled && !activeMoveAnim;
    const aimingPlace = canAim && interactive.phase === 'place';
    const holding = canAim && interactive.phase === 'stack' && (selected || (drag && drag.active));
    const srcCol = drag && drag.active ? drag.fromCol : selected ? selected.col : -1;
    const turnHex = PIGMENT[interactive.turn] || PIGMENT[curTurn];

    let reticleCol = -1;
    for (let c = 0; c < 3; c++) {
      const sock = sockets[c];
      if (sock.flash > 0) {
        sock.flash = Math.max(0, sock.flash - dt * 5.2);
        keepRunning = true;
      }
      const valid = aimingPlace || (holding && c !== srcCol);
      const hot = valid && (effHoverCol === c || (drag && drag.active && drag.targetCol === c));
      let widthGoal = 1;
      if (sock.flash > 0.05) {
        sock.goal.setHex(BONE);
        widthGoal = 1.45;
      } else if (hot) {
        sock.goal.setHex(turnHex);
        widthGoal = 1.5;
        reticleCol = c;
      } else if (valid) {
        sock.goal.setHex(turnHex);
      } else if (holding && c === srcCol) {
        sock.goal.setHex(BONE);
      } else {
        sock.goal.setHex(IDLE_BAR);
      }
      const colorDiff = Math.abs(sock.color.r - sock.goal.r) + Math.abs(sock.color.g - sock.goal.g) + Math.abs(sock.color.b - sock.goal.b);
      if (colorDiff > 0.005 || Math.abs(sock.width - widthGoal) > 0.004) {
        sock.color.lerp(sock.goal, 1 - Math.exp(-24 * dt));
        sock.barMat.color.copy(sock.color);
        sock.dotMat.color.copy(sock.color);
        sock.width = lerp(sock.width, widthGoal, 1 - Math.exp(-24 * dt));
        sock.bar.scale.x = sock.width;
        keepRunning = true;
      }
    }

    const showReticle = reticleCol >= 0 && !(drag && drag.active);
    if (showReticle) {
      reticleGoal.set(COL_X[reticleCol], ballY(boardCols[reticleCol].length), 0);
      if (!reticle.visible) reticle.position.copy(reticleGoal);
      reticle.position.lerp(reticleGoal, 1 - Math.exp(-30 * dt));
      reticle.visible = true;
      reticle.quaternion.copy(camera.quaternion);
      reticle.scale.setScalar(1 + Math.sin(nowSec * 4.5) * 0.025);
      tmpColor.setHex(turnHex);
      reticleMat.color.copy(tmpColor);
      keepRunning = true;
    }
    const opGoal = showReticle ? 0.95 : 0;
    if (Math.abs(reticleMat.opacity - opGoal) > 0.01) {
      reticleMat.opacity = lerp(reticleMat.opacity, opGoal, 1 - Math.exp(-24 * dt));
      keepRunning = true;
    } else {
      reticleMat.opacity = opGoal;
    }
    if (!showReticle && reticleMat.opacity < 0.02) reticle.visible = false;

    /* 5. Score riders */
    for (const p of ['o', 'y']) {
      const peg = scorePegs[p];
      const goal = riderRestY + peg.level * RIDER_STEP;
      if (Math.abs(goal - peg.y) > 0.0008 || Math.abs(peg.vy) > 0.002) {
        const acc = (goal - peg.y) * 320 - peg.vy * 20;
        peg.vy += acc * dt;
        peg.y += peg.vy * dt;
        peg.rider.position.y = peg.y;
        keepRunning = true;
        shadowMoved = true;
      }
    }

    /* 6. Winning bone alignment frame */
    for (const f of activeFrames) {
      if (f.age < 0.42) {
        f.age += dt;
        keepRunning = true;
        if (f.age < 0) continue;
        f.mesh.visible = true;
        const u = easeOutBack(Math.min(1, f.age / 0.34));
        f.mesh.position.z = lerp(FRAME_Z + 1.4, FRAME_Z, Math.min(1, easeOutCubic(f.age / 0.30)));
        f.mesh.scale.setScalar(lerp(1.14, 1, u));
      }
    }

    if (shadowDirty || shadowMoved) {
      renderer.shadowMap.needsUpdate = true;
      shadowDirty = false;
    }

    renderer.render(scene, camera);

    if (keepRunning) {
      rafId = requestAnimationFrame(tick);
    }
  }

  resize();

  return {
    setState(state, scores, animHint) {
      curTurn = state.turn;
      selected = null;
      drag = null;
      extHoveredCol = -1;
      if (animHint) startMoveAnimation(state, animHint);
      else syncBoardInstant(state);
      if (scores) updateScores(scores, null);
      wake();
    },
    setScores(scores, animatePlayer) {
      updateScores(scores, animatePlayer);
    },
    setInteractive(cfg) {
      const wasEnabled = interactive.enabled;
      interactive = Object.assign({}, interactive, cfg);
      if (!interactive.enabled) {
        hoveredCol = -1;
        extHoveredCol = -1;
        hoveredBall = null;
        selected = null;
        drag = null;
        canvas.style.cursor = '';
      } else if (!wasEnabled && hasPointer) {
        pointerDirty = true; // recompute hover immediately without requiring mouse movement!
      }
      wake();
    },
    setExternalHoverCol(col) {
      if (extHoveredCol !== col) {
        extHoveredCol = col;
        wake();
      }
    },
    setPaused(paused) {
      pausedRender = !!paused;
      if (pausedRender && rafId) {
        cancelAnimationFrame(rafId);
        rafId = 0;
      } else if (!pausedRender) {
        wake();
      }
    },
    setSelected(sel) {
      selected = sel ? { col: sel.col, row: sel.row } : null;
      shadowDirty = true;
      wake();
    },
    getSelected() {
      return selected ? { col: selected.col, row: selected.row } : null;
    },
    setOutcome,
    clearOutcome: clearOutcomeVisuals,
    setInsets(ins) {
      insets = Object.assign({}, insets, ins);
      wake();
    },
    setAttract(on) {
      attractMode = !!on;
      wake();
    },
    isAnimating() {
      return !!activeMoveAnim;
    },
    resize,
    destroy() {
      disposed = true;
      cancelAnimationFrame(rafId);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerCancel);
      canvas.removeEventListener('pointerleave', onPointerLeave);
      canvas.removeEventListener('webglcontextlost', onContextLost);
      canvas.removeEventListener('webglcontextrestored', onContextRestored);
      window.removeEventListener('pointermove', onWindowPointerMove);
      if (envRT) envRT.dispose();
      contactTex.dispose();
      renderer.dispose();
    },
  };
}

window.STTBoard3D = { create };
