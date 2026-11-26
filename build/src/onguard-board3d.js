/* On Guard — real 3D WebGL board (three.js).
   Bundled to best-life/onguard/board3d.js (IIFE) exposing window.OGBoard3D = { create(opts) }.
   Every corner of the tray moves independently along a true bilinear surface matching physics.js;
   the outer frame stays rigid, the pegs/pockets ride the deformed floor, lever tabs drop vertically
   in end-wall slots, and the steel marble reflects a studio PMREM environment and visibly rolls. */
import {
  WebGLRenderer, Scene, PerspectiveCamera, Group, Mesh, InstancedMesh,
  BufferGeometry, PlaneGeometry, SphereGeometry, CircleGeometry, RingGeometry,
  BoxGeometry, LatheGeometry, ExtrudeGeometry, ShapeGeometry, Shape, Path,
  Float32BufferAttribute, Uint16BufferAttribute,
  MeshStandardMaterial, MeshBasicMaterial, MeshLambertMaterial,
  CanvasTexture, SRGBColorSpace, NoToneMapping, PCFShadowMap,
  LinearMipmapLinearFilter, RepeatWrapping, DoubleSide, BackSide,
  DirectionalLight, HemisphereLight, PMREMGenerator,
  Vector2, Vector3, Quaternion, Matrix4, Color,
} from 'three';

const DEG = Math.PI / 180;
const TAU = Math.PI * 2;
const DROP = 80; // visual full-press drop in board units
const TAB_Z0 = -6; // neutral lever tab center Z
const PEG_H = 30;
const WALL_H = 22;
const POCKET_BEVEL = 0.75; // bevel on pocket U walls (inset from P.WALL so outer faces sit at exact P.WALL)
const UP = new Vector3(0, 0, 1);

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;

/* Exact cubic-bezier(.22, 1, .36, 1) evaluator matching CSS FLIP glide */
function cubicBezierEase(t) {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  const x1 = 0.22, y1 = 1.0, x2 = 0.36, y2 = 1.0;
  let u = t;
  for (let i = 0; i < 6; i++) {
    const om = 1 - u;
    const x = 3 * om * om * u * x1 + 3 * om * u * u * x2 + u * u * u;
    const dx = 3 * om * om * x1 + 6 * om * u * (x2 - x1) + 3 * u * u * (1 - x2);
    if (Math.abs(dx) < 1e-6) break;
    u = clamp(u - (x - t) / dx, 0, 1);
  }
  const om = 1 - u;
  return 3 * om * om * u * y1 + 3 * om * u * u * y2 + u * u * u;
}

function rrect2D(ctx, x0, y0, x1, y1, r) {
  ctx.beginPath();
  ctx.moveTo(x0 + r, y0);
  ctx.lineTo(x1 - r, y0); ctx.arcTo(x1, y0, x1, y0 + r, r);
  ctx.lineTo(x1, y1 - r); ctx.arcTo(x1, y1, x1 - r, y1, r);
  ctx.lineTo(x0 + r, y1); ctx.arcTo(x0, y1, x0, y1 - r, r);
  ctx.lineTo(x0, y0 + r); ctx.arcTo(x0, y0, x0 + r, y0, r);
  ctx.closePath();
}

function makeRoundedRectShape(hw, hh, r) {
  const s = new Shape();
  s.moveTo(-hw + r, -hh);
  s.lineTo(hw - r, -hh);
  s.absarc(hw - r, -hh + r, r, -Math.PI / 2, 0, false);
  s.lineTo(hw, hh - r);
  s.absarc(hw - r, hh - r, r, 0, Math.PI / 2, false);
  s.lineTo(-hw + r, hh);
  s.absarc(-hw + r, hh - r, r, Math.PI / 2, Math.PI, false);
  s.lineTo(-hw, -hh + r);
  s.absarc(-hw + r, -hh + r, r, Math.PI, Math.PI * 1.5, false);
  s.closePath();
  return s;
}

function makeRoundedRectHole(hw, hh, r) {
  const p = new Path();
  p.moveTo(-hw + r, -hh);
  p.absarc(-hw + r, -hh + r, r, Math.PI * 1.5, Math.PI, true);
  p.lineTo(-hw, hh - r);
  p.absarc(-hw + r, hh - r, r, Math.PI, Math.PI / 2, true);
  p.lineTo(hw - r, hh);
  p.absarc(hw - r, hh - r, r, Math.PI / 2, 0, true);
  p.lineTo(hw, -hh + r);
  p.absarc(hw - r, -hh + r, r, 0, -Math.PI / 2, true);
  p.closePath();
  return p;
}

/** Sample a rounded rectangle perimeter CCW with fixed segment counts so concentric rings align cleanly. */
function sampleRoundedRectLoop(hw, hh, r, segX = 20, segY = 12, segC = 10) {
  const pts = [];
  // Bottom edge (-hw+r -> hw-r at y=-hh)
  for (let i = 0; i < segX; i++) pts.push([lerp(-hw + r, hw - r, i / segX), -hh]);
  // Bottom-right corner (-PI/2 -> 0)
  for (let i = 0; i < segC; i++) {
    const a = -Math.PI / 2 + (Math.PI / 2) * (i / segC);
    pts.push([hw - r + Math.cos(a) * r, -hh + r + Math.sin(a) * r]);
  }
  // Right edge (-hh+r -> hh-r at x=+hw)
  for (let i = 0; i < segY; i++) pts.push([hw, lerp(-hh + r, hh - r, i / segY)]);
  // Top-right corner (0 -> PI/2)
  for (let i = 0; i < segC; i++) {
    const a = (Math.PI / 2) * (i / segC);
    pts.push([hw - r + Math.cos(a) * r, hh - r + Math.sin(a) * r]);
  }
  // Top edge (hw-r -> -hw+r at y=+hh)
  for (let i = 0; i < segX; i++) pts.push([lerp(hw - r, -hw + r, i / segX), hh]);
  // Top-left corner (PI/2 -> PI)
  for (let i = 0; i < segC; i++) {
    const a = Math.PI / 2 + (Math.PI / 2) * (i / segC);
    pts.push([-hw + r + Math.cos(a) * r, hh - r + Math.sin(a) * r]);
  }
  // Left edge (hh-r -> -hh+r at x=-hw)
  for (let i = 0; i < segY; i++) pts.push([-hw, lerp(hh - r, -hh + r, i / segY)]);
  // Bottom-left corner (PI -> 3PI/2)
  for (let i = 0; i < segC; i++) {
    const a = Math.PI + (Math.PI / 2) * (i / segC);
    pts.push([-hw + r + Math.cos(a) * r, -hh + r + Math.sin(a) * r]);
  }
  return pts;
}

/** Sample the floor-edge rounded rectangle CCW with unit outward normals [x, y, nx, ny] (Three.js XY). */
function sampleFloorEdgeLoop(hw, hh, r, segX = 24, segY = 16, segC = 16) {
  const pts = [];
  for (let i = 0; i < segX; i++) pts.push([lerp(-hw + r, hw - r, i / segX), -hh, 0, -1]);
  for (let i = 0; i < segC; i++) {
    const a = -Math.PI / 2 + (Math.PI / 2) * (i / segC);
    const ca = Math.cos(a), sa = Math.sin(a);
    pts.push([hw - r + ca * r, -hh + r + sa * r, ca, sa]);
  }
  for (let i = 0; i < segY; i++) pts.push([hw, lerp(-hh + r, hh - r, i / segY), 1, 0]);
  for (let i = 0; i < segC; i++) {
    const a = (Math.PI / 2) * (i / segC);
    const ca = Math.cos(a), sa = Math.sin(a);
    pts.push([hw - r + ca * r, hh - r + sa * r, ca, sa]);
  }
  for (let i = 0; i < segX; i++) pts.push([lerp(hw - r, -hw + r, i / segX), hh, 0, 1]);
  for (let i = 0; i < segC; i++) {
    const a = Math.PI / 2 + (Math.PI / 2) * (i / segC);
    const ca = Math.cos(a), sa = Math.sin(a);
    pts.push([-hw + r + ca * r, hh - r + sa * r, ca, sa]);
  }
  for (let i = 0; i < segY; i++) pts.push([-hw, lerp(hh - r, -hh + r, i / segY), -1, 0]);
  for (let i = 0; i < segC; i++) {
    const a = Math.PI + (Math.PI / 2) * (i / segC);
    const ca = Math.cos(a), sa = Math.sin(a);
    pts.push([-hw + r + ca * r, -hh + r + sa * r, ca, sa]);
  }
  return pts;
}

/** Build a U-shaped pocket wall 2D shape in local coordinates (origin at hole center, +Y up). */
function makePocketUShape(p, wallHalf) {
  // In local Three.js coords: lx = x - p.hx, ly = -(y - p.hy)
  // p.pts has 4 points: [mouthOut, backOut, backIn, mouthIn]
  const xs = p.pts.map((q) => q[0] - p.hx);
  const ys = p.pts.map((q) => -(q[1] - p.hy));
  const xMouth = xs[0]; // mouth side (toward center)
  const xBack = xs[1];  // back wall (toward frame end)
  const yA = Math.min(ys[0], ys[2]); // lower local Y arm
  const yB = Math.max(ys[0], ys[2]); // upper local Y arm
  const w = wallHalf;
  const s = new Shape();

  if (p.side < 0) {
    // Left end: back is on -X (xBack < xMouth), opens toward +X (xMouth)
    const xBOut = xBack - w, xBIn = xBack + w;
    // Crisp square outer back corners (flush back-to-back at y=0 as on the real board), rounded mouth caps
    s.moveTo(xMouth, yB + w);
    s.lineTo(xBOut, yB + w);
    s.lineTo(xBOut, yA - w);
    s.lineTo(xMouth, yA - w);
    s.absarc(xMouth, yA, w, -Math.PI / 2, Math.PI / 2, false);
    s.lineTo(xBIn, yA + w);
    s.lineTo(xBIn, yB - w);
    s.lineTo(xMouth, yB - w);
    s.absarc(xMouth, yB, w, -Math.PI / 2, Math.PI / 2, false);
  } else {
    // Right end: back is on +X (xBack > xMouth), opens toward -X (xMouth)
    const xBOut = xBack + w, xBIn = xBack - w;
    s.moveTo(xMouth, yA - w);
    s.lineTo(xBOut, yA - w);
    s.lineTo(xBOut, yB + w);
    s.lineTo(xMouth, yB + w);
    s.absarc(xMouth, yB, w, Math.PI / 2, Math.PI * 1.5, false);
    s.lineTo(xBIn, yB - w);
    s.lineTo(xBIn, yA + w);
    s.lineTo(xMouth, yA + w);
    s.absarc(xMouth, yA, w, Math.PI / 2, Math.PI * 1.5, false);
  }
  s.closePath();
  return s;
}

function create(opts) {
  const { canvas, P, consts, colors, font, onContextLost } = opts;
  const { EXT_X, FRAME_X, FRAME_Y, TRAY_X, TRAY_Y, FRAME_DEP } = consts;
  const TAB_REACH = consts.TAB_REACH || (P.LEVER_W + 4);
  const COVE_RX = P.COVE_RX != null ? P.COVE_RX : (P.RIM_X - P.X);
  const COVE_RY = P.COVE_RY != null ? P.COVE_RY : (P.RIM_Y - P.Y);
  // Single level rim height matching the side-wall quarter-circle fillet (COVE_RY = 27),
  // while matching P.coveSurface(t, rc) identically across the entire ball-reachable curve (t <= 0.925 * rc).
  const RIM_H = Math.min(COVE_RX, COVE_RY);
  const Z_FLOOR0 = -RIM_H; // neutral tray floor Z (tray rim sits flush at z=0, frame top bevel at z=0..+bevel)
  const COVE_EXACT_FRAC = 0.925;
  const coveSurfaceFn = typeof P.coveSurface === 'function'
    ? P.coveSurface
    : (t, rc) => (!(t > 0) || !(rc > 0) ? 0 : t >= rc ? rc : rc - Math.sqrt(rc * rc - t * t));
  function coveRimZ(t, rc) {
    if (!(t > 0) || !(rc > 0)) return 0;
    const t0 = COVE_EXACT_FRAC * rc;
    if (t <= t0) return coveSurfaceFn(t, rc);
    if (t >= rc) return RIM_H;
    const z0 = coveSurfaceFn(t0, rc);
    if (z0 >= RIM_H) return RIM_H;
    const dt = rc - t0;
    const slope0 = t0 / Math.sqrt(Math.max(1e-6, rc * rc - t0 * t0));
    const m0 = slope0 * dt;
    const u = (t - t0) / dt;
    const u2 = u * u, u3 = u2 * u;
    return z0 + (RIM_H - z0) * (3 * u2 - 2 * u3) + m0 * (u - 2 * u2 + u3);
  }
  function coveMeshZAt(x, y) {
    const ccx = P.X - P.CORNER, ccy = P.Y - P.CORNER;
    const ax = x < 0 ? -x : x, ay = y < 0 ? -y : y;
    let t = 0, nx = 0, ny = 0;
    if (ax > ccx && ay > ccy) {
      const dx = ax - ccx, dy = ay - ccy, d = Math.hypot(dx, dy);
      if (d > P.CORNER) { t = d - P.CORNER; nx = dx / d; ny = dy / d; }
    } else if (ax > P.X) {
      t = ax - P.X; nx = 1;
    } else if (ay > P.Y) {
      t = ay - P.Y; ny = 1;
    }
    if (!(t > 0)) return 0;
    const rc = COVE_RX * nx * nx + COVE_RY * ny * ny;
    if (t >= rc) return RIM_H;
    return coveRimZ(t, rc);
  }
  const _coveEmpty = { q: 0, nx: 0, ny: 0, rc: 0, run: 0, lift: 0 };
  function coveAt(x, y, out) {
    if (typeof P.cove === 'function') return P.cove(x, y, out);
    const o = out || _coveEmpty;
    o.q = 0; o.nx = 0; o.ny = 0; o.rc = 0; o.run = 0; o.lift = 0;
    return o;
  }
  const colR = (colors && colors.r) || '#ff2a3d';
  const colB = (colors && colors.b) || '#1f6bff';
  const colRL = (colors && colors.rl) || '#ff8491';
  const colBL = (colors && colors.bl) || '#86a9ff';
  const colRD = (colors && colors.rd) || '#d4112a';
  const colBD = (colors && colors.bd) || '#0b47d1';
  const HLF = font || "'Barlow Condensed', 'Arial Narrow', sans-serif";

  // Helper: interior floor rectangle of a pocket U (strictly inside walls, x MOUTH..BACK-WALL, y IN+WALL..OUT-WALL)
  function pocketInterior(p) {
    const xa = p.side * P.MOUTH;
    const xb = p.side * (P.BACK - P.WALL);
    const ya = p.v * (P.IN + P.WALL);
    const yb = p.v * (P.OUT - P.WALL);
    return { x0: Math.min(xa, xb), x1: Math.max(xa, xb), y0: Math.min(ya, yb), y1: Math.max(ya, yb) };
  }
  // Helper: guard peg directly in front of pocket p
  function guardOf(p) {
    return P.PEGS.reduce((a, b) =>
      (Math.hypot(b.x - p.hx, b.y - p.hy) < Math.hypot(a.x - p.hx, a.y - p.hy) ? b : a)
    );
  }

  // Try creating a WebGL renderer; bail cleanly if unavailable or software-fallback blocked.
  let renderer;
  try {
    renderer = new WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
    });
  } catch (e) {
    return null;
  }
  if (!renderer || !renderer.getContext()) {
    try { renderer && renderer.dispose(); } catch (e) {}
    return null;
  }

  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = NoToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFShadowMap;
  renderer.shadowMap.autoUpdate = false;

  const maxAniso = Math.min(8, renderer.capabilities.getMaxAnisotropy() || 1);
  const maxTexSize = renderer.capabilities.maxTextureSize || 2048;

  const scene = new Scene();
  const camera = new PerspectiveCamera(30, 1, 200, 12000);

  // Scene hierarchy matching CSS: .pitch (rotateX) -> .spin (rotateZ) -> boardGroup
  const pitchGroup = new Group();
  const spinGroup = new Group();
  const boardGroup = new Group();
  pitchGroup.add(spinGroup);
  spinGroup.add(boardGroup);
  scene.add(pitchGroup);

  // Track disposable resources
  const geos = [];
  const mats = [];
  const texs = [];
  const rts = [];
  const trackG = (g) => { geos.push(g); return g; };
  const trackM = (m) => { mats.push(m); return m; };
  const trackT = (t) => { texs.push(t); return t; };

  /* ================= Lighting ================= */
  // Clean studio fill so the white tray reads crisp bright white (~245-247 luma) at rest and when all 4 levers are down
  // without blowing out peg shading, frame bevels, or pitched views.
  const hemiLight = new HemisphereLight(0xffffff, 0xdde4ef, 1.63);
  hemiLight.position.set(0, 0, 1200);
  scene.add(hemiLight);

  // Primary directional key light from upper-left OF THE SCREEN (counter-rotated against theta automatically
  // because it lives in scene space). Kept offset horizontally from the camera-board mirror angle so pitched
  // views (24-30 deg) never suffer flat specular white-out on the floor or lever tabs.
  const keyLight = new DirectionalLight(0xffffff, 1.28);
  keyLight.castShadow = true;
  const smSize = maxTexSize >= 4096 ? 2048 : 1024;
  const smSpan = EXT_X + 60;
  keyLight.shadow.mapSize.set(smSize, smSize);
  keyLight.shadow.camera.left = -smSpan;
  keyLight.shadow.camera.right = smSpan;
  keyLight.shadow.camera.top = smSpan;
  keyLight.shadow.camera.bottom = -smSpan;
  keyLight.shadow.camera.near = 250;
  keyLight.shadow.camera.far = 2600;
  keyLight.shadow.bias = -0.00025;
  keyLight.shadow.normalBias = 1.25;
  keyLight.shadow.radius = 2.4;
  scene.add(keyLight);
  scene.add(keyLight.target);

  // Subtle cool rim light from lower-right for gentle edge separation on pegs and walls
  const rimLight = new DirectionalLight(0xf0f5ff, 0.24);
  scene.add(rimLight);
  scene.add(rimLight.target);

  function updateLightDirection(pitchDeg) {
    // Upper-left light vector in screen-aligned coordinates; only partially follows pitch so it stays
    // off the specular mirror axis at pitch=24..30 deg while keeping crisp upper-left shadows.
    const a = -pitchDeg * 0.25 * DEG;
    const ca = Math.cos(a), sa = Math.sin(a);
    const lx = -0.64, ly = 0.68, lz = 1.92;
    const inv = 1 / Math.hypot(lx, ly, lz);
    const nx = lx * inv, ny = ly * inv, nz = lz * inv;
    const wy = ny * ca - nz * sa;
    const wz = ny * sa + nz * ca;
    keyLight.position.set(nx * 1400, wy * 1400, wz * 1400);
    keyLight.target.position.set(0, 0, -25);
    keyLight.target.updateMatrixWorld();

    const rx = 0.72, ry = -0.58, rz = 0.95;
    const rinv = 1 / Math.hypot(rx, ry, rz);
    const rny = ry * rinv, rnz = rz * rinv;
    rimLight.position.set(rx * rinv * 1200, (rny * ca - rnz * sa) * 1200, (rny * sa + rnz * ca) * 1200);
    rimLight.target.position.set(0, 0, 0);
    rimLight.target.updateMatrixWorld();
  }
  updateLightDirection(0);

  /* ================= PMREM Studio Environment for Mirror Steel Ball Bearing ================= */
  // Custom world-aligned neutral chrome studio dome (+Z = toward camera / ball center,
  // +Y = screen up, +X = screen right). Mapped to spherical reflection vector R = (wx, wy, wz):
  //   - Bright neutral upper cap (wy > 0 / upper-center)
  //   - Visible darker horizon band across the lower-middle (wy < 0, wz > 0)
  //   - Lighter white-board floor bounce directly beneath the horizon band (wz < 0, wy < 0)
  //   - Thin dark-gray outer silhouette edge only in the outermost 8-10% (wz < -0.72)
  //   - One small crisp white hot spot upper-left + softer secondary upper-right
  let ballEnvMap = null;
  try {
    const pmrem = new PMREMGenerator(renderer);
    pmrem.compileEquirectangularShader();
    const envScene = new Scene();
    const tmpGeos = [];
    const tmpMats = [];

    const domeCv = document.createElement('canvas');
    domeCv.width = 512; domeCv.height = 256;
    {
      const ctx = domeCv.getContext('2d');
      const img = ctx.createImageData(512, 256);
      const data = img.data;
      const smooth = (e0, e1, x) => {
        const t = clamp((x - e0) / (e1 - e0), 0, 1);
        return t * t * (3 - 2 * t);
      };
      for (let py = 0; py < 256; py++) {
        const th = ((py + 0.5) / 256) * Math.PI;
        const sinTh = Math.sin(th);
        const wz = Math.cos(th); // +1 center (r=0), 0 at r=0.707, -0.62 at r=0.90, -1 at r=1
        for (let px = 0; px < 512; px++) {
          const phi = ((px + 0.5) / 512) * TAU;
          const wx = -Math.cos(phi) * sinTh; // screen +X right
          const wy = -Math.sin(phi) * sinTh; // screen +Y up

          // Screen-vertical horizon coordinate tilted slightly toward upper-left key light:
          //   upper cap: h > +0.25  |  center: h ~ +0.42  |  lower-mid horizon: h ~ -0.45..+0.05
          const h = wy * 0.86 - wx * 0.14 + wz * 0.44;

          // 1) Bright neutral silver-white upper cap transitioning cleanly down into darker studio horizon
          const cap = smooth(-0.18, 0.52, h);
          let lum = lerp(0.18, 0.84, cap);

          // Soft overhead tonal roll-off so upper cap has sculptural depth (brightest upper-left, smooth silver center)
          const ulBias = clamp((-wx * 0.6 + wy * 0.8) * 0.5 + 0.5, 0, 1);
          lum += cap * (ulBias - 0.35) * 0.14;

          // 2) Distinct darker curved horizon band across the lower-middle of the ball
          const horizBand = Math.exp(-Math.pow((h + 0.32) / 0.28, 2)) * smooth(-0.35, 0.25, wz);
          lum = lerp(lum, 0.15, horizBand * 0.82);

          // 3) Crisp lighter white-tray floor bounce tucked directly beneath the horizon band (r ~ 0.65..0.88)
          const bounceZone = smooth(0.06, -0.26, wz) * (1.0 - smooth(-0.68, -0.86, wz));
          const lowerBounce = bounceZone * smooth(0.32, -0.52, wy);
          lum = Math.max(lum, lerp(lum, 0.78, lowerBounce * 0.94));
          // Subtle softer white-tray side bounce around the lower flanks (keeps edge from turning into a thick black ring)
          const flankBounce = bounceZone * (1.0 - lowerBounce) * 0.48;
          lum = Math.max(lum, 0.54 * flankBounce + lum * (1.0 - flankBounce));

          // 4) Thin dark-gray outer edge only at the very silhouette (r > 0.91 -> wz < -0.66)
          const thinEdge = smooth(-0.66, -0.93, wz);
          lum = lerp(lum, 0.25, thinEdge);

          // Strictly neutral polished steel (zero blue cast)
          const v = Math.round(clamp(lum, 0, 1) * 255);
          const idx = (py * 512 + px) * 4;
          data[idx] = v;
          data[idx + 1] = v;
          data[idx + 2] = v;
          data[idx + 3] = 255;
        }
      }
      ctx.putImageData(img, 0, 0);
    }
    const domeTex = new CanvasTexture(domeCv);
    domeTex.colorSpace = SRGBColorSpace;
    const domeGeo = new SphereGeometry(40, 48, 32);
    const domeMat = new MeshBasicMaterial({ map: domeTex, side: BackSide });
    const domeMesh = new Mesh(domeGeo, domeMat);
    domeMesh.rotation.x = Math.PI / 2;
    envScene.add(domeMesh);
    tmpGeos.push(domeGeo);
    tmpMats.push(domeMat);

    // Helper for neutral HDR studio softbox panels oriented toward origin in world space
    const addLightPanel = (v, px, py, pz, w, h) => {
      const geo = new PlaneGeometry(w, h);
      const mat = new MeshBasicMaterial({ color: new Color(v, v, v), side: DoubleSide });
      const m = new Mesh(geo, mat);
      m.position.set(px, py, pz);
      m.lookAt(0, 0, 0);
      envScene.add(m);
      tmpGeos.push(geo);
      tmpMats.push(mat);
    };
    // 1) One small crisp pure-white primary specular hot spot upper-left
    addLightPanel(11.0, -9.4, 10.2, 11.2, 1.55, 1.2);
    addLightPanel(2.4, -9.4, 10.2, 11.5, 2.7, 2.0);
    // 2) Softer secondary reflection upper-right
    addLightPanel(1.45, 12.2, 5.4, 9.6, 3.8, 4.8);

    const rt = pmrem.fromScene(envScene, 0.005);
    rts.push(rt);
    ballEnvMap = rt.texture;
    domeTex.dispose();
    for (const g of tmpGeos) g.dispose();
    for (const m of tmpMats) m.dispose();
    pmrem.dispose();
  } catch (e) {
    ballEnvMap = null;
  }

  /* ================= Surface Height & Normal Helpers ================= */
  const _d = [0, 0, 0, 0];
  function computeDepths(press, out) {
    return P.depths(press, out || _d);
  }
  function surfaceRelZ(d, x, y) {
    let u = x / P.X; if (u < -1) u = -1; else if (u > 1) u = 1;
    let v = y / P.Y; if (v < -1) v = -1; else if (v > 1) v = 1;
    const omv = 1 - v, opv = 1 + v;
    return -DROP * 0.25 * ((d[0] * omv + d[1] * opv) * (1 - u) + (d[2] * omv + d[3] * opv) * (1 + u));
  }
  function surfaceNormal(d, x, y, out) {
    let u = x / P.X; if (u < -1) u = -1; else if (u > 1) u = 1;
    let v = y / P.Y; if (v < -1) v = -1; else if (v > 1) v = 1;
    const dhdx = -DROP * 0.25 / P.X * ((d[2] - d[0]) * (1 - v) + (d[3] - d[1]) * (1 + v));
    const dhdy = -DROP * 0.25 / P.Y * ((d[1] - d[0]) * (1 - u) + (d[3] - d[2]) * (1 + u));
    return out.set(-dhdx, dhdy, 1).normalize();
  }

  /* ================= Fixed White Outer Frame & Well ================= */
  const frameGroup = new Group();
  boardGroup.add(frameGroup);

  const TRAY_R = P.RIM_R;
  const FRAME_R = P.RIM_R + 4;
  const SLOT_W = Math.round(P.LEVER_W * 0.38);
  const frameTotalDep = Math.max(FRAME_DEP + 10, DROP + RIM_H + 22);
  const bevel = 1.6;
  const frameShape = makeRoundedRectShape(FRAME_X - bevel, FRAME_Y - bevel, FRAME_R - bevel);
  frameShape.holes.push(makeRoundedRectHole(TRAY_X + 1.5 + bevel, TRAY_Y + 1.5 + bevel, TRAY_R + 1.5 + bevel));
  const frameGeo = trackG(new ExtrudeGeometry(frameShape, {
    depth: frameTotalDep - bevel * 2,
    bevelEnabled: true,
    bevelSize: bevel,
    bevelThickness: bevel,
    bevelSegments: 2,
    curveSegments: 14,
  }));
  // Position so top of bevel sits at z = +bevel, flat rim around z = 0..+bevel, bottom at z = -frameTotalDep + bevel
  frameGeo.translate(0, 0, -(frameTotalDep - bevel * 2));
  const frameMat = trackM(new MeshStandardMaterial({
    color: 0xf4f6fa,
    roughness: 0.36,
    metalness: 0.02,
  }));
  const frameMesh = new Mesh(frameGeo, frameMat);
  frameMesh.castShadow = true;
  frameMesh.receiveShadow = true;
  frameGroup.add(frameMesh);

  // Frame top markings (Red rail, Blue rail, tick marks, subtle slot lip notches)
  const frameTopCv = document.createElement('canvas');
  frameTopCv.width = 2048;
  frameTopCv.height = Math.round(2048 * (FRAME_Y / FRAME_X));
  (function paintFrameTop() {
    const w = frameTopCv.width, h = frameTopCv.height;
    const c = frameTopCv.getContext('2d');
    c.clearRect(0, 0, w, h);
    const sx = w / (FRAME_X * 2), sy = h / (FRAME_Y * 2);
    c.setTransform(sx, 0, 0, sy, w / 2, h / 2);

    // Subtle crisp outer & inner hairlines
    rrect2D(c, -FRAME_X + 3, -FRAME_Y + 3, FRAME_X - 3, FRAME_Y - 3, Math.max(2, FRAME_R - 2.5));
    c.lineWidth = 1.5;
    c.strokeStyle = 'rgba(14,22,40,.14)';
    c.stroke();

    rrect2D(c, -TRAY_X - 2, -TRAY_Y - 2, TRAY_X + 2, TRAY_Y + 2, TRAY_R + 1.5);
    c.lineWidth = 1.6;
    c.strokeStyle = 'rgba(14,22,40,.22)';
    c.stroke();

    // Recessed slot notches on top lip where levers pass
    const wallW = FRAME_X - TRAY_X;
    const notchIn = Math.min(8, wallW * 0.52);
    for (const [cx, cy] of P.CORNERS) {
      const x0 = cx > 0 ? FRAME_X - notchIn : -FRAME_X + 1;
      const x1 = cx > 0 ? FRAME_X - 1 : -FRAME_X + notchIn;
      const y0 = cy * P.LEVER_Y - SLOT_W * 0.5, y1 = cy * P.LEVER_Y + SLOT_W * 0.5;
      rrect2D(c, x0, y0, x1, y1, 2);
      c.fillStyle = 'rgba(14,22,40,.22)';
      c.fill();
    }

    // Team rails: Red's end on left (-X), Blue's end on right (+X), clear of the lever slots
    c.lineCap = 'round';
    const railX = (FRAME_X + TRAY_X + 1.5) * 0.5;
    const railY = P.LEVER_Y - P.LEVER_W * 0.65;
    const railW = Math.min(6.5, Math.max(4, (wallW - 4) * 0.48));
    for (const [side, col] of [[-1, colR], [1, colB]]) {
      const x = side * railX;
      c.beginPath();
      c.moveTo(x, -railY);
      c.lineTo(x, railY);
      c.lineWidth = railW;
      c.strokeStyle = col;
      c.stroke();
    }

    // Technical tick marks along both long rails
    c.lineCap = 'butt';
    c.lineWidth = 1.6;
    c.strokeStyle = 'rgba(14,22,40,.22)';
    const tickStep = P.X / 10;
    const tickMax = P.X - tickStep;
    for (let x = -tickMax; x <= tickMax + 0.01; x += tickStep) {
      const len = Math.abs(x) < 1 ? 8 : 4.5;
      for (const sgn of [-1, 1]) {
        c.beginPath();
        c.moveTo(x, sgn * (FRAME_Y - 4));
        c.lineTo(x, sgn * (FRAME_Y - 4 - len));
        c.stroke();
      }
    }
  })();
  const frameTopTex = trackT(new CanvasTexture(frameTopCv));
  frameTopTex.colorSpace = SRGBColorSpace;
  frameTopTex.anisotropy = maxAniso;
  frameTopTex.minFilter = LinearMipmapLinearFilter;

  const frameCapShape = makeRoundedRectShape(FRAME_X - bevel, FRAME_Y - bevel, Math.max(2, FRAME_R - bevel));
  frameCapShape.holes.push(makeRoundedRectHole(TRAY_X + 1.5 + bevel * 0.5, TRAY_Y + 1.5 + bevel * 0.5, TRAY_R + 1.5));
  const frameCapGeo = trackG(new ShapeGeometry(frameCapShape, 14));
  // Normalize UVs from [-FRAME_X..FRAME_X] x [-FRAME_Y..FRAME_Y] to [0..1]
  {
    const pos = frameCapGeo.attributes.position;
    const uv = frameCapGeo.attributes.uv;
    for (let i = 0; i < pos.count; i++) {
      uv.setXY(i, (pos.getX(i) + FRAME_X) / (FRAME_X * 2), (pos.getY(i) + FRAME_Y) / (FRAME_Y * 2));
    }
    uv.needsUpdate = true;
  }
  const frameCapMat = trackM(new MeshBasicMaterial({
    map: frameTopTex,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  }));
  const frameCapMesh = new Mesh(frameCapGeo, frameCapMat);
  frameCapMesh.position.z = bevel + 0.08;
  frameGroup.add(frameCapMesh);

  // Well floor at bottom of frame
  const wellFloorGeo = trackG(new PlaneGeometry(TRAY_X * 2 + 12, TRAY_Y * 2 + 12));
  const wellFloorMat = trackM(new MeshStandardMaterial({ color: 0xe3e7ef, roughness: 0.72, metalness: 0 }));
  const wellFloorMesh = new Mesh(wellFloorGeo, wellFloorMat);
  wellFloorMesh.position.z = -(frameTotalDep - 3);
  wellFloorMesh.receiveShadow = true;
  frameGroup.add(wellFloorMesh);

  // Vertical lever slots recessed into the two outer end walls (below top bevel so they never poke up)
  const slotGeo = trackG(new BoxGeometry(3, SLOT_W, DROP + 12));
  const slotMat = trackM(new MeshStandardMaterial({ color: 0x3b4252, roughness: 0.85, metalness: 0.05 }));
  for (let c = 0; c < 4; c++) {
    const [sx, sy] = P.CORNERS[c];
    const slot = new Mesh(slotGeo, slotMat);
    slot.position.set(sx * (FRAME_X - 0.8), -sy * P.LEVER_Y, TAB_Z0 - DROP * 0.5 - 1.5);
    frameGroup.add(slot);
  }

  // Soft ground shadow under the fixed frame (pure multi-pass rounded rects, no ctx.filter, for iOS WebKit parity)
  const gShadowCv = document.createElement('canvas');
  gShadowCv.width = 512; gShadowCv.height = 384;
  (function paintGroundShadow() {
    const c = gShadowCv.getContext('2d');
    c.clearRect(0, 0, 512, 384);
    for (let i = 16; i >= 1; i--) {
      const pad = 26 + i * 3.0;
      const a = 0.018 * (1 - (i - 1) / 18);
      rrect2D(c, pad, pad * 0.82, 512 - pad, 384 - pad * 0.82, 36 + (16 - i) * 1.4);
      c.fillStyle = `rgba(18,28,52,${a.toFixed(4)})`;
      c.fill();
    }
  })();
  const gShadowTex = trackT(new CanvasTexture(gShadowCv));
  gShadowTex.colorSpace = SRGBColorSpace;
  const gShadowMesh = new Mesh(
    trackG(new PlaneGeometry(FRAME_X * 2.38, FRAME_Y * 2.48)),
    trackM(new MeshBasicMaterial({ map: gShadowTex, transparent: true, depthWrite: false }))
  );
  gShadowMesh.position.set(8, -14, -(frameTotalDep + 2));
  frameGroup.add(gShadowMesh);

  /* ================= Deforming Tray Floor + Raised Rim ================= */
  const trayGroup = new Group();
  boardGroup.add(trayGroup);

  // Floor texture (ported from drawTray in game.js)
  const floorCv = document.createElement('canvas');
  floorCv.width = 2048;
  floorCv.height = Math.round(2048 * (P.Y / P.X)); // 1393
  function paintFloorTexture() {
    const w = floorCv.width, h = floorCv.height;
    const c = floorCv.getContext('2d');
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, w, h);
    const sx = w / (P.X * 2), sy = h / (P.Y * 2);
    c.setTransform(sx, 0, 0, sy, w / 2, h / 2);

    // Clean bright white molded plastic base
    const gradR = Math.hypot(P.X, P.Y) * 1.18;
    const g = c.createRadialGradient(-P.X * 0.18, -P.Y * 0.2, P.BALL * 2, 0, 0, gradR);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.72, '#fbfcfd');
    g.addColorStop(1, '#f5f7fb');
    c.fillStyle = g;
    c.fillRect(-P.X, -P.Y, P.X * 2, P.Y * 2);

    // Pocket floor tints (strictly inside each U's interior: x MOUTH..BACK-WALL, y IN+WALL..OUT-WALL)
    for (const p of P.POCKETS) {
      const b = pocketInterior(p);
      c.fillStyle = p.color === 'r' ? 'rgba(255,42,61,.14)' : 'rgba(31,107,255,.14)';
      c.fillRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0);
    }

    // Team shapes printed on open floor on the centre side of each guard peg (clear of every peg and start disc)
    for (const p of P.POCKETS) {
      const guard = guardOf(p);
      const mx = guard.x - p.side * (P.PEG + 26);
      const my = p.hy;
      const sz = 8.4;
      c.save();
      c.translate(mx, my);
      c.globalAlpha = 0.58;
      if (p.color === 'r') {
        c.scale(p.side, 1);
        c.beginPath();
        c.moveTo(-sz * 0.9, -sz * 1.05); c.lineTo(sz * 1.05, 0); c.lineTo(-sz * 0.9, sz * 1.05); c.closePath();
        c.fillStyle = colR;
        c.fill();
      } else {
        c.beginPath();
        c.arc(0, 0, sz * 0.88, 0, TAU);
        c.lineWidth = Math.max(3.2, sz * 0.48);
        c.strokeStyle = colB;
        c.stroke();
      }
      c.restore();
    }

    // Faint ON GUARD wordmark printed cleanly in the open band between outer center pegs and long walls
    const centerPegOuterY = P.PEGS.filter((q) => q.x === 0).reduce((m, q) => Math.max(m, Math.abs(q.y)), 0) + P.PEG;
    const wordY = (centerPegOuterY + P.Y) * 0.5;
    c.font = `italic 900 32px ${HLF}`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillStyle = 'rgba(14,22,40,.065)';
    c.fillText('ON GUARD', 0, -wordY);
    c.save();
    c.rotate(Math.PI);
    c.fillText('ON GUARD', 0, -wordY);
    c.restore();
  }
  paintFloorTexture();
  const floorTex = trackT(new CanvasTexture(floorCv));
  floorTex.colorSpace = SRGBColorSpace;
  floorTex.anisotropy = maxAniso;
  floorTex.minFilter = LinearMipmapLinearFilter;

  // Subdivided bilinear floor mesh (44 x 30 segments)
  const FLOOR_SEG_X = 44, FLOOR_SEG_Y = 30;
  const floorGeo = trackG(new PlaneGeometry(P.X * 2, P.Y * 2, FLOOR_SEG_X, FLOOR_SEG_Y));
  const floorPos = floorGeo.attributes.position;
  const floorNorm = floorGeo.attributes.normal;
  const floorVertCount = floorPos.count;
  const floorBX = new Float32Array(floorVertCount);
  const floorBY = new Float32Array(floorVertCount);
  const cornerVertIdx = [-1, -1, -1, -1];
  for (let i = 0; i < floorVertCount; i++) {
    const bx = floorPos.getX(i);
    const by = -floorPos.getY(i); // PlaneGeometry +Y is board -Y
    floorBX[i] = bx;
    floorBY[i] = by;
    floorPos.setZ(i, Z_FLOOR0);
    for (let c = 0; c < 4; c++) {
      const [sx, sy] = P.CORNERS[c];
      if (Math.abs(bx - sx * P.X) < 0.01 && Math.abs(by - sy * P.Y) < 0.01) cornerVertIdx[c] = i;
    }
  }
  const floorMat = trackM(new MeshStandardMaterial({
    map: floorTex,
    color: 0xffffff,
    roughness: 0.48,
    metalness: 0.0,
  }));
  const floorMesh = new Mesh(floorGeo, floorMat);
  floorMesh.receiveShadow = true;
  floorMesh.castShadow = false;
  trayGroup.add(floorMesh);

  // Deforming curved cove built directly from P.coveSurface(t, rc) with per-direction fillet radius
  // rc = COVE_RX * nx^2 + COVE_RY * ny^2, rising from the floor edge (+-P.X, +-P.Y, r=P.CORNER)
  // to the level rim at (+-P.RIM_X, +-P.RIM_Y, z=RIM_H), followed by the flat white rim lip and vertical skirt.
  const COVE_SEG_X = 24, COVE_SEG_Y = 16, COVE_SEG_C = 16;
  const floorEdge = sampleFloorEdgeLoop(P.X, P.Y, P.CORNER, COVE_SEG_X, COVE_SEG_Y, COVE_SEG_C);
  const ringN = floorEdge.length;
  const COVE_STEPS = 14;
  const outerRimFlat = sampleRoundedRectLoop(TRAY_X - 1.5, TRAY_Y - 1.5, TRAY_R + 0.5, COVE_SEG_X, COVE_SEG_Y, COVE_SEG_C);
  const outerRimEdge = sampleRoundedRectLoop(TRAY_X - 0.5, TRAY_Y - 0.5, TRAY_R, COVE_SEG_X, COVE_SEG_Y, COVE_SEG_C);
  const ringCount = 1 + (COVE_STEPS + 1) + 4; // under-floor overlap + cove steps + lip shoulder + flat rim + bevel + skirt
  const rimVertCount = ringN * ringCount;
  const rimPositions = new Float32Array(rimVertCount * 3);
  const rimBX = new Float32Array(rimVertCount);
  const rimBY = new Float32Array(rimVertCount);
  const rimDZ = new Float32Array(rimVertCount);
  const setRimVert = (ri, i, x3, y3, dz) => {
    const idx = ri * ringN + i;
    rimPositions[idx * 3] = x3;
    rimPositions[idx * 3 + 1] = y3;
    rimPositions[idx * 3 + 2] = Z_FLOOR0 + dz;
    rimBX[idx] = x3;
    rimBY[idx] = -y3;
    rimDZ[idx] = dz;
  };
  for (let i = 0; i < ringN; i++) {
    const [x0, y0, nx, ny] = floorEdge[i];
    const rc = COVE_RX * nx * nx + COVE_RY * ny * ny;
    // Ring 0: tucked slightly under the floor edge so tilted boards never open a hairline crack
    setRimVert(0, i, x0 - 0.6 * nx, y0 - 0.6 * ny, -0.35);
    // Rings 1..COVE_STEPS+1: exact circular fillet P.coveSurface(t, rc) up to 0.925*rc, smoothly meeting level RIM_H
    for (let s = 0; s <= COVE_STEPS; s++) {
      const frac = Math.sin((Math.PI * 0.5) * (s / COVE_STEPS));
      const t = frac * rc;
      const dz = s === 0 ? 0.0 : coveRimZ(t, rc);
      setRimVert(1 + s, i, x0 + t * nx, y0 + t * ny, dz);
    }
    const baseOuter = COVE_STEPS + 2;
    // Inner lip shoulder just past the cove top for crisp flat-rim vertex normals
    setRimVert(baseOuter, i, x0 + (rc + 1.5) * nx, y0 + (rc + 1.5) * ny, RIM_H + 0.15);
    // Outer flat white rim lip, bevelled outer edge, and vertical tray skirt
    setRimVert(baseOuter + 1, i, outerRimFlat[i][0], outerRimFlat[i][1], RIM_H + 0.15);
    setRimVert(baseOuter + 2, i, outerRimEdge[i][0], outerRimEdge[i][1], RIM_H - 1.0);
    setRimVert(baseOuter + 3, i, outerRimEdge[i][0], outerRimEdge[i][1], -14.0);
  }
  const rimIndices = [];
  for (let ri = 0; ri < ringCount - 1; ri++) {
    const a0 = ri * ringN, b0 = (ri + 1) * ringN;
    for (let i = 0; i < ringN; i++) {
      const ni = (i + 1) % ringN;
      // Loops go CCW around origin; as ri grows outward, winding (a0+i, b0+i, b0+ni) faces +Z (upward/inward)
      rimIndices.push(a0 + i, b0 + i, b0 + ni, a0 + i, b0 + ni, a0 + ni);
    }
  }
  const rimGeo = trackG(new BufferGeometry());
  rimGeo.setAttribute('position', new Float32BufferAttribute(rimPositions, 3));
  rimGeo.setIndex(new Uint16BufferAttribute(rimIndices, 1));
  rimGeo.computeVertexNormals();
  const rimPos = rimGeo.attributes.position;
  const rimMat = trackM(new MeshStandardMaterial({
    color: 0xf8f9fc,
    roughness: 0.34,
    metalness: 0.02,
  }));
  const rimMesh = new Mesh(rimGeo, rimMat);
  rimMesh.castShadow = true;
  rimMesh.receiveShadow = true;
  trayGroup.add(rimMesh);

  /* ================= Clear Start Disc (P.DISC_R) & Raised Centre Cup (P.CUP_R) ================= */
  // Thin clear slightly glossy acrylic disc lying on the floor, deformed smoothly with the bilinear surface
  const DISC_SEGS = 48;
  const discRings = [
    [0.001, 0.35],
    [P.CUP_R * 0.70, 0.55],
    [P.CUP_R * 0.90, 4.2],
    [P.CUP_R * 1.00, 5.2],
    [P.CUP_R * 1.12, 3.0],
    [P.CUP_R * 1.24, 1.35],
    [P.DISC_R - 1.6, 1.15],
    [P.DISC_R, 0.2],
  ];
  const discRingCount = discRings.length;
  const discVertCount = discRingCount * DISC_SEGS;
  const discPositions = new Float32Array(discVertCount * 3);
  const discUVs = new Float32Array(discVertCount * 2);
  const discBX = new Float32Array(discVertCount);
  const discBY = new Float32Array(discVertCount);
  const discDZ = new Float32Array(discVertCount);
  for (let ri = 0; ri < discRingCount; ri++) {
    const [rad, dz] = discRings[ri];
    for (let i = 0; i < DISC_SEGS; i++) {
      const a = (i / DISC_SEGS) * TAU;
      const x3 = Math.cos(a) * rad;
      const y3 = Math.sin(a) * rad;
      const idx = ri * DISC_SEGS + i;
      discPositions[idx * 3] = x3;
      discPositions[idx * 3 + 1] = y3;
      discPositions[idx * 3 + 2] = Z_FLOOR0 + dz;
      discUVs[idx * 2] = 0.5 + (x3 / (P.DISC_R * 2));
      discUVs[idx * 2 + 1] = 0.5 + (y3 / (P.DISC_R * 2));
      discBX[idx] = x3;
      discBY[idx] = -y3;
      discDZ[idx] = dz;
    }
  }
  const discIndices = [];
  for (let ri = 0; ri < discRingCount - 1; ri++) {
    const a0 = ri * DISC_SEGS, b0 = (ri + 1) * DISC_SEGS;
    for (let i = 0; i < DISC_SEGS; i++) {
      const ni = (i + 1) % DISC_SEGS;
      discIndices.push(a0 + i, b0 + i, b0 + ni, a0 + i, b0 + ni, a0 + ni);
    }
  }
  const discGeo = trackG(new BufferGeometry());
  discGeo.setAttribute('position', new Float32BufferAttribute(discPositions, 3));
  discGeo.setAttribute('uv', new Float32BufferAttribute(discUVs, 2));
  discGeo.setIndex(new Uint16BufferAttribute(discIndices, 1));
  discGeo.computeVertexNormals();
  const discPos = discGeo.attributes.position;

  // Radial texture for the clear acrylic disc: nearly invisible bright clear body (never darkens floor)
  // with crisp delicate refracted rim lines at P.DISC_R and P.CUP_R
  const discCv = document.createElement('canvas');
  discCv.width = 512; discCv.height = 512;
  (function paintStartDisc() {
    const S = 512, C = 256, R = 252;
    const c = discCv.getContext('2d');
    c.clearRect(0, 0, S, S);
    const cupPx = (P.CUP_R / P.DISC_R) * R;
    // Ultra-faint cool-neutral clear plastic film sheen
    const bg = c.createRadialGradient(C - R * 0.25, C - R * 0.25, cupPx * 0.4, C, C, R);
    bg.addColorStop(0, 'rgba(255,255,255,0.16)');
    bg.addColorStop(0.55, 'rgba(218,225,235,0.07)');
    bg.addColorStop(0.95, 'rgba(205,214,226,0.11)');
    bg.addColorStop(1, 'rgba(175,186,202,0.22)');
    c.fillStyle = bg;
    c.beginPath(); c.arc(C, C, R, 0, TAU); c.fill();

    // Subtle crisp acrylic outer edge + inner bright highlight
    c.beginPath(); c.arc(C, C, R - 1.5, 0, TAU);
    c.lineWidth = 2.6; c.strokeStyle = 'rgba(148,160,178,0.44)'; c.stroke();
    c.beginPath(); c.arc(C, C, R - 4.0, 0, TAU);
    c.lineWidth = 1.6; c.strokeStyle = 'rgba(255,255,255,0.68)'; c.stroke();

    // Raised clear centre cup wall (outer skirt edge, bright lip crest, inner rim)
    c.beginPath(); c.arc(C, C, cupPx * 1.12, 0, TAU);
    c.lineWidth = 2.2; c.strokeStyle = 'rgba(142,154,172,0.34)'; c.stroke();
    c.beginPath(); c.arc(C, C, cupPx, 0, TAU);
    c.lineWidth = 3.2; c.strokeStyle = 'rgba(255,255,255,0.72)'; c.stroke();
    c.beginPath(); c.arc(C, C, cupPx * 0.86, 0, TAU);
    c.lineWidth = 1.8; c.strokeStyle = 'rgba(130,142,160,0.42)'; c.stroke();
  })();
  const discTex = trackT(new CanvasTexture(discCv));
  discTex.colorSpace = SRGBColorSpace;
  discTex.anisotropy = maxAniso;
  const discMat = trackM(new MeshStandardMaterial({
    map: discTex,
    color: 0xffffff,
    transparent: true,
    roughness: 0.14,
    metalness: 0.05,
    envMap: ballEnvMap,
    envMapIntensity: 0.45,
    depthWrite: false,
  }));
  const discMesh = new Mesh(discGeo, discMat);
  discMesh.receiveShadow = true;
  discMesh.renderOrder = 1;
  trayGroup.add(discMesh);

  /* ================= 22 White Cylinder Pegs (InstancedMesh) ================= */
  const pegPts = [
    new Vector2(P.PEG, -3),
    new Vector2(P.PEG, PEG_H - 2.6),
    new Vector2(P.PEG - 0.6, PEG_H - 1.1),
    new Vector2(P.PEG - 1.9, PEG_H - 0.15),
    new Vector2(P.PEG - 3.6, PEG_H),
    new Vector2(0, PEG_H),
  ];
  const pegGeo = trackG(new LatheGeometry(pegPts, 20));
  pegGeo.rotateX(Math.PI / 2); // Lathe axis +Y -> +Z
  const pegMat = trackM(new MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.26,
    metalness: 0.02,
  }));
  const pegInst = new InstancedMesh(pegGeo, pegMat, P.PEGS.length);
  pegInst.castShadow = true;
  pegInst.receiveShadow = true;
  boardGroup.add(pegInst);

  // Index of the peg nearest the board centre (for OG.r3d().pegR)
  let centerPegIdx = 0;
  {
    let best = Infinity;
    for (let i = 0; i < P.PEGS.length; i++) {
      const dd = Math.hypot(P.PEGS[i].x, P.PEGS[i].y);
      if (dd < best) { best = dd; centerPegIdx = i; }
    }
  }

  /* ================= 4 U-Shaped Pocket Walls + Metal Rings + Dark Holes ================= */
  // Dark recessed hole texture
  const holeCv = document.createElement('canvas');
  holeCv.width = 128; holeCv.height = 128;
  (function paintHole() {
    const c = holeCv.getContext('2d');
    const g = c.createRadialGradient(64 + 14, 64 + 14, 4, 64, 64, 64);
    g.addColorStop(0, '#020306');
    g.addColorStop(0.62, '#0d1118');
    g.addColorStop(0.88, '#232936');
    g.addColorStop(1, '#3a4252');
    c.fillStyle = g;
    c.beginPath(); c.arc(64, 64, 64, 0, TAU); c.fill();
  })();
  const holeTex = trackT(new CanvasTexture(holeCv));
  holeTex.colorSpace = SRGBColorSpace;
  const holeDiscGeo = trackG(new CircleGeometry(P.HOLE, 32));
  const holeDiscMat = trackM(new MeshBasicMaterial({
    map: holeTex,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  }));

  // Polished metal ring around each hole
  const ringPts = [
    new Vector2(P.HOLE - 0.5, 0),
    new Vector2(P.HOLE - 0.5, 1.3),
    new Vector2(P.HOLE + 0.6, 1.9),
    new Vector2(P.HOLE + 2.4, 1.8),
    new Vector2(P.HOLE + 3.6, 0.9),
    new Vector2(P.HOLE + 3.8, 0),
  ];
  const metalRingGeo = trackG(new LatheGeometry(ringPts, 32));
  metalRingGeo.rotateX(Math.PI / 2);
  const metalRingMat = trackM(new MeshStandardMaterial({
    color: 0xdce2ec,
    metalness: 0.92,
    roughness: 0.2,
    envMap: ballEnvMap,
    envMapIntensity: 1.15,
  }));

  const pocketWallMats = {
    r: trackM(new MeshStandardMaterial({ color: colR, roughness: 0.22, metalness: 0.04, envMap: ballEnvMap, envMapIntensity: 0.28 })),
    b: trackM(new MeshStandardMaterial({ color: colB, roughness: 0.22, metalness: 0.04, envMap: ballEnvMap, envMapIntensity: 0.28 })),
  };

  // Shared unit ring geometry for pocket shockwaves / pulses
  const fxRingGeo = trackG(new RingGeometry(0.88, 1.0, 48));

  const pocketGroups = [];
  const pocketMeshes = [];
  const pocketFX = [];
  for (let i = 0; i < P.POCKETS.length; i++) {
    const p = P.POCKETS[i];
    const g = new Group();
    boardGroup.add(g);
    pocketGroups.push(g);

    const uShape = makePocketUShape(p, P.WALL - POCKET_BEVEL);
    const uGeo = trackG(new ExtrudeGeometry(uShape, {
      depth: WALL_H + 1.5,
      bevelEnabled: true,
      bevelSize: POCKET_BEVEL,
      bevelThickness: 0.9,
      bevelSegments: 2,
      curveSegments: 12,
    }));
    uGeo.translate(0, 0, -2.5); // embed slightly into floor so tilted corners never show a seam
    uGeo.computeBoundingBox();
    const uMesh = new Mesh(uGeo, pocketWallMats[p.color]);
    uMesh.castShadow = true;
    uMesh.receiveShadow = true;
    g.add(uMesh);

    const mRing = new Mesh(metalRingGeo, metalRingMat);
    mRing.position.z = 0.05;
    mRing.receiveShadow = true;
    g.add(mRing);

    const hDisc = new Mesh(holeDiscGeo, holeDiscMat);
    hDisc.position.z = 0.45;
    g.add(hDisc);
    pocketMeshes.push({ uMesh, hDisc });

    // Pocket floor glow + expanding pulse/goal rings (strictly inside the U interior)
    const inter = pocketInterior(p);
    const bx0 = inter.x0 - p.hx, bx1 = inter.x1 - p.hx;
    const by0 = -(inter.y1 - p.hy), by1 = -(inter.y0 - p.hy);
    const fillMat = trackM(new MeshBasicMaterial({ color: p.color === 'r' ? colR : colB, transparent: true, opacity: 0, depthWrite: false }));
    const fillMesh = new Mesh(trackG(new PlaneGeometry(bx1 - bx0, by1 - by0)), fillMat);
    fillMesh.position.set((bx0 + bx1) / 2, (by0 + by1) / 2, 0.7);
    fillMesh.visible = false;
    g.add(fillMesh);

    // Glowing cap overlay along U-wall top for mine/goal highlight
    const capShape = makePocketUShape(p, P.WALL);
    const capMat = trackM(new MeshBasicMaterial({ color: p.color === 'r' ? colRL : colBL, transparent: true, opacity: 0, depthWrite: false }));
    const capMesh = new Mesh(trackG(new ShapeGeometry(capShape, 12)), capMat);
    capMesh.position.z = WALL_H + 0.35;
    capMesh.visible = false;
    g.add(capMesh);

    const rings = [];
    for (let rr = 0; rr < 4; rr++) {
      const rm = trackM(new MeshBasicMaterial({ color: p.color === 'r' ? colR : colB, transparent: true, opacity: 0, depthWrite: false, side: DoubleSide }));
      const rmesh = new Mesh(fxRingGeo, rm);
      rmesh.position.z = 1.25 + rr * 0.05;
      rmesh.visible = false;
      g.add(rmesh);
      rings.push({ mesh: rmesh, mat: rm });
    }
    pocketFX.push({ fillMesh, fillMat, capMesh, capMat, rings });
  }

  /* ================= 4 Flat Square Paddle Lever Tabs (P.LEVER_W at +-P.LEVER_Y) ================= */
  const TAB_BEVEL = 1.5;
  const TAB_X = P.LEVER_W * 0.88; // ~61.6 along X (plus ~12.4 exposed stem -> TAB_REACH = P.LEVER_W + 4)
  const TAB_Y = P.LEVER_W;        // 70 along Y
  const TAB_R = Math.round(P.LEVER_W * 0.14); // rounded-square corners like the real paddle
  const tabCenterX = FRAME_X + TAB_REACH - TAB_X * 0.5;
  const tabShape = makeRoundedRectShape(TAB_X * 0.5 - TAB_BEVEL, TAB_Y * 0.5 - TAB_BEVEL, TAB_R - TAB_BEVEL);
  const tabGeo = trackG(new ExtrudeGeometry(tabShape, {
    depth: 8,
    bevelEnabled: true,
    bevelSize: TAB_BEVEL,
    bevelThickness: TAB_BEVEL,
    bevelSegments: 2,
    curveSegments: 10,
  }));
  tabGeo.translate(0, 0, -4); // centered vertically (-5.5..+5.5)

  const STEM_W = Math.round(P.LEVER_W * 0.30);
  const STEM_LEN = (tabCenterX - (FRAME_X - 10));
  const stemGeo = trackG(new BoxGeometry(STEM_LEN, STEM_W, 8));
  const ridgeGeo = trackG(new BoxGeometry(TAB_X * 0.48, 2.4, 1.4));
  const lockShape = makeRoundedRectShape(TAB_X * 0.5 + 1.5, TAB_Y * 0.5 + 1.5, TAB_R + 1.2);
  lockShape.holes.push(makeRoundedRectHole(TAB_X * 0.5 - 2.0, TAB_Y * 0.5 - 2.0, Math.max(2, TAB_R - 1.5)));
  const lockGeo = trackG(new ShapeGeometry(lockShape, 10));

  // Radial-gradient soft glow halo (works identically in Chrome and Safari/WebKit without ctx.filter)
  function makeHaloTex(hex) {
    const cv = document.createElement('canvas');
    cv.width = 128; cv.height = 128;
    const c = cv.getContext('2d');
    const h = hex.replace('#', '');
    const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
    c.save();
    c.translate(64, 64);
    const grad = c.createRadialGradient(0, 0, 12, 0, 0, 62);
    grad.addColorStop(0, `rgba(${r},${g},${b},0.92)`);
    grad.addColorStop(0.45, `rgba(${r},${g},${b},0.48)`);
    grad.addColorStop(0.75, `rgba(${r},${g},${b},0.14)`);
    grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
    c.fillStyle = grad;
    c.beginPath(); c.arc(0, 0, 62, 0, TAU); c.fill();
    c.restore();
    const t = trackT(new CanvasTexture(cv));
    t.colorSpace = SRGBColorSpace;
    return t;
  }
  const haloTex = { r: makeHaloTex(colR), b: makeHaloTex(colB) };
  const haloGeo = trackG(new PlaneGeometry(TAB_X * 2.15, TAB_Y * 2.15));

  const tabGroups = [];
  const tabParts = [];
  const cIdle = { r: new Color(colR), b: new Color(colB) };
  const cDown = { r: new Color(colRD), b: new Color(colBD) };
  const cTired = new Color(0xd0d5df);
  const cEmissive = { r: new Color(colR), b: new Color(colB) };
  const cZero = new Color(0x000000);

  for (let c = 0; c < 4; c++) {
    const [sx, sy] = P.CORNERS[c];
    const owner = P.OWNER[c];
    const g = new Group();
    g.position.set(sx * tabCenterX, -sy * P.LEVER_Y, TAB_Z0);
    boardGroup.add(g);
    tabGroups.push(g);

    const mat = trackM(new MeshStandardMaterial({
      color: cIdle[owner].clone(),
      roughness: 0.32,
      metalness: 0.04,
      emissive: cZero.clone(),
      emissiveIntensity: 0,
    }));
    const body = new Mesh(tabGeo, mat);
    body.castShadow = true;
    body.receiveShadow = true;
    g.add(body);

    const stemMat = trackM(new MeshStandardMaterial({
      color: cDown[owner].clone(),
      roughness: 0.36,
      metalness: 0.04,
    }));
    const stem = new Mesh(stemGeo, stemMat);
    stem.position.set(-sx * (STEM_LEN * 0.5), 0, 0);
    stem.castShadow = true;
    g.add(stem);

    const ridgeMat = trackM(new MeshStandardMaterial({
      color: owner === 'r' ? colRL : colBL,
      roughness: 0.24,
      metalness: 0.04,
    }));
    const rStep = TAB_Y * 0.16;
    for (const ry of [-rStep, 0, rStep]) {
      const rMesh = new Mesh(ridgeGeo, ridgeMat);
      rMesh.position.set(0, ry, 5.7);
      g.add(rMesh);
    }

    const lockMat = trackM(new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.92, depthWrite: false }));
    const lockMesh = new Mesh(lockGeo, lockMat);
    lockMesh.position.z = 5.95;
    lockMesh.visible = false;
    g.add(lockMesh);

    const hMat = trackM(new MeshBasicMaterial({ map: haloTex[owner], transparent: true, opacity: 0, depthWrite: false }));
    const hMesh = new Mesh(haloGeo, hMat);
    hMesh.position.z = -6.0;
    hMesh.visible = false;
    g.add(hMesh);

    tabParts.push({ owner, mat, stemMat, ridgeMat, lockMesh, hMesh, hMat });
  }

  /* ================= Polished Chrome Steel Ball Bearing + Contact Shadow ================= */
  // Seamless 3D-noise brushed/burnished steel roughness, albedo sheen, and micro-bump maps sampled on the
  // unit sphere (zero UV seams or pole pinching, no stripes or dots) so rolling is subtly, unmistakably visible.
  const roughCv = document.createElement('canvas');
  roughCv.width = 256; roughCv.height = 128;
  const albedoCv = document.createElement('canvas');
  albedoCv.width = 256; albedoCv.height = 128;
  const bumpCv = document.createElement('canvas');
  bumpCv.width = 256; bumpCv.height = 128;
  (function paintSteelMaps() {
    const W = 256, H = 128;
    const rc = roughCv.getContext('2d'), rImg = rc.createImageData(W, H), rD = rImg.data;
    const ac = albedoCv.getContext('2d'), aImg = ac.createImageData(W, H), aD = aImg.data;
    const bc = bumpCv.getContext('2d'), bImg = bc.createImageData(W, H), bD = bImg.data;

    // Deterministic 3D value noise for seamless spherical brushed/burnished grain
    const hash3 = (ix, iy, iz) => {
      let n = (ix * 374761393 + iy * 668265263 + iz * 2147483647) | 0;
      n = Math.imul(n ^ (n >>> 13), 1274126177);
      return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
    };
    const noise3 = (x, y, z) => {
      const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
      const fx = x - ix, fy = y - iy, fz = z - iz;
      const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy), uz = fz * fz * (3 - 2 * fz);
      const n000 = hash3(ix, iy, iz), n100 = hash3(ix + 1, iy, iz);
      const n010 = hash3(ix, iy + 1, iz), n110 = hash3(ix + 1, iy + 1, iz);
      const n001 = hash3(ix, iy, iz + 1), n101 = hash3(ix + 1, iy, iz + 1);
      const n011 = hash3(ix, iy + 1, iz + 1), n111 = hash3(ix + 1, iy + 1, iz + 1);
      const nx00 = n000 + (n100 - n000) * ux, nx10 = n010 + (n110 - n010) * ux;
      const nx01 = n001 + (n101 - n001) * ux, nx11 = n011 + (n111 - n011) * ux;
      const nxy0 = nx00 + (nx10 - nx00) * uy, nxy1 = nx01 + (nx11 - nx01) * uy;
      return nxy0 + (nxy1 - nxy0) * uz;
    };

    for (let py = 0; py < H; py++) {
      const th = ((py + 0.5) / H) * Math.PI;
      const sinTh = Math.sin(th), sy = Math.cos(th);
      for (let px = 0; px < W; px++) {
        const phi = ((px + 0.5) / W) * TAU;
        const sx = -Math.cos(phi) * sinTh;
        const sz = Math.sin(phi) * sinTh;

        // Smooth machined/brushed steel sheen variation (zero stripes/dots, zero UV seams, silky smooth bearing)
        const n1 = noise3(sx * 2.1 + 4.1, sy * 2.1 + 1.7, sz * 2.1 + 8.3);
        const bx = sx * 0.8 + sy * 0.6;
        const by = -sx * 0.6 + sy * 0.8;
        const n2 = noise3(bx * 8.5 + 13.4, by * 2.4 + 5.2, sz * 6.0 + 2.9);
        const n3 = noise3(sx * 14.0 + 21.0, sy * 14.0 + 9.4, sz * 14.0 + 17.2);

        const sheen = clamp(n1 * 0.60 + n2 * 0.28 + n3 * 0.12, 0, 1);
        const sCurve = sheen * sheen * (3 - 2 * sheen);
        // Mirror-to-satin roughness (0.025..0.13) keeps the chrome reflection sharp while visibly rolling
        const rough = clamp(0.025 + sCurve * 0.105, 0.025, 0.14);
        const rv = Math.round(rough * 255);
        // Subtle strictly-neutral monochrome steel sheen variation (~0.78..1.00, zero blue cast)
        const av = Math.round(clamp(0.78 + (1.0 - sCurve) * 0.22, 0.78, 1.0) * 255);
        // Ultra-fine machined polish micro-bump (smooth mirror bearing)
        const bv = Math.round(clamp(0.5 + (n2 - 0.5) * 0.38 + (n3 - 0.5) * 0.20, 0.2, 0.8) * 255);

        const idx = (py * W + px) * 4;
        rD[idx] = rD[idx + 1] = rD[idx + 2] = rv; rD[idx + 3] = 255;
        aD[idx] = aD[idx + 1] = aD[idx + 2] = av; aD[idx + 3] = 255;
        bD[idx] = bD[idx + 1] = bD[idx + 2] = bv; bD[idx + 3] = 255;
      }
    }
    rc.putImageData(rImg, 0, 0);
    ac.putImageData(aImg, 0, 0);
    bc.putImageData(bImg, 0, 0);
  })();
  const steelRoughTex = trackT(new CanvasTexture(roughCv));
  steelRoughTex.wrapS = RepeatWrapping; steelRoughTex.wrapT = RepeatWrapping;
  const steelAlbedoTex = trackT(new CanvasTexture(albedoCv));
  steelAlbedoTex.colorSpace = SRGBColorSpace;
  steelAlbedoTex.wrapS = RepeatWrapping; steelAlbedoTex.wrapT = RepeatWrapping;
  const steelBumpTex = trackT(new CanvasTexture(bumpCv));
  steelBumpTex.wrapS = RepeatWrapping; steelBumpTex.wrapT = RepeatWrapping;

  const ballGeo = trackG(new SphereGeometry(P.BALL, 40, 28));
  const ballBaseColor = new Color(0xf4f4f4);
  const ballMat = trackM(new MeshStandardMaterial({
    color: ballBaseColor.clone(),
    map: steelAlbedoTex,
    metalness: 0.98,
    roughness: 1.0, // multiplied by steelRoughTex (~0.025..0.13)
    roughnessMap: steelRoughTex,
    bumpMap: steelBumpTex,
    bumpScale: 0.032,
    envMap: ballEnvMap,
    envMapIntensity: 1.24,
  }));
  // Crisp thin dark-gray outer silhouette (only the outermost ~8-10% of radius, NdotV < 0.40) + pure studio PMREM specular
  ballMat.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      'vec3 totalSpecular = reflectedLight.directSpecular + reflectedLight.indirectSpecular;',
      'vec3 totalSpecular = reflectedLight.indirectSpecular;'
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <opaque_fragment>',
      `float ogNdotV = clamp( dot( normalize( normal ), normalize( vViewPosition ) ), 0.0, 1.0 );
       float ogRimShade = mix( 0.38, 1.0, smoothstep( 0.04, 0.40, ogNdotV ) );
       outgoingLight *= ogRimShade;
       #include <opaque_fragment>`
    );
  };
  ballMat.customProgramCacheKey = () => 'og-steel-ball-v5';

  const ballMesh = new Mesh(ballGeo, ballMat);
  ballMesh.castShadow = true;
  ballMesh.receiveShadow = false;
  ballMesh.visible = false;
  boardGroup.add(ballMesh);

  // Tight, darker contact shadow directly under the ball + soft penumbra offset toward screen lower-right
  const bShCv = document.createElement('canvas');
  bShCv.width = 128; bShCv.height = 128;
  (function paintBallShadow() {
    const c = bShCv.getContext('2d');
    c.clearRect(0, 0, 128, 128);
    // 1) Soft directional penumbra offset slightly toward screen lower-right (+x, +y in canvas)
    const gSoft = c.createRadialGradient(74, 74, 4, 74, 74, 48);
    gSoft.addColorStop(0, 'rgba(10,16,30,.36)');
    gSoft.addColorStop(0.42, 'rgba(10,16,30,.20)');
    gSoft.addColorStop(0.76, 'rgba(10,16,30,.06)');
    gSoft.addColorStop(1, 'rgba(10,16,30,0)');
    c.fillStyle = gSoft;
    c.fillRect(0, 0, 128, 128);
    // 2) Tight dark contact-occlusion core directly under the ball's footprint
    const gCore = c.createRadialGradient(65, 65, 2, 65, 65, 32);
    gCore.addColorStop(0, 'rgba(6,10,20,.76)');
    gCore.addColorStop(0.38, 'rgba(8,13,24,.48)');
    gCore.addColorStop(0.72, 'rgba(10,16,30,.15)');
    gCore.addColorStop(1, 'rgba(10,16,30,0)');
    c.fillStyle = gCore;
    c.fillRect(0, 0, 128, 128);
  })();
  const bShTex = trackT(new CanvasTexture(bShCv));
  bShTex.colorSpace = SRGBColorSpace;
  const ballShadowMat = trackM(new MeshBasicMaterial({
    map: bShTex,
    transparent: true,
    opacity: 0.95,
    depthWrite: false,
  }));
  const ballShadowMesh = new Mesh(trackG(new PlaneGeometry(P.BALL * 2.85, P.BALL * 2.85)), ballShadowMat);
  ballShadowMesh.visible = false;
  boardGroup.add(ballShadowMesh);

  /* ================= Spawn Rings + 3D Impact Sparks ================= */
  const spawnRings = [];
  for (let j = 0; j < 2; j++) {
    const rm = trackM(new MeshBasicMaterial({ color: 0x0e1628, transparent: true, opacity: 0, depthWrite: false, side: DoubleSide }));
    const rmesh = new Mesh(fxRingGeo, rm);
    rmesh.visible = false;
    boardGroup.add(rmesh);
    spawnRings.push({ mesh: rmesh, mat: rm });
  }

  const MAX_SPARKS = 44;
  const sparkGeo = trackG(new PlaneGeometry(1, 3.2));
  const sparkPool = [];
  for (let i = 0; i < MAX_SPARKS; i++) {
    const sm = trackM(new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, side: DoubleSide }));
    const mesh = new Mesh(sparkGeo, sm);
    mesh.visible = false;
    boardGroup.add(mesh);
    sparkPool.push({ mesh, mat: sm, active: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, life: 0.3 });
  }
  let activeSparks = 0;

  function spark(x, y, v, col, inx, iny) {
    const n = Math.min(7, Math.floor(v / 180) + 2);
    const hasDir = !!(inx || iny);
    const baseA = hasDir ? Math.atan2(iny, inx) : 0;
    for (let k = 0; k < n; k++) {
      let slot = null;
      for (let i = 0; i < MAX_SPARKS; i++) {
        if (!sparkPool[i].active) { slot = sparkPool[i]; break; }
      }
      if (!slot) slot = sparkPool[0];
      const a = hasDir ? baseA + (Math.random() - 0.5) * 2.4 : Math.random() * TAU;
      const sp = 80 + Math.random() * v * 0.3;
      if (!slot.active) activeSparks++;
      slot.active = true;
      slot.x = x; slot.y = y;
      slot.vx = Math.cos(a) * sp;
      slot.vy = Math.sin(a) * sp;
      slot.t = 0;
      slot.life = 0.22 + Math.random() * 0.2;
      slot.mat.color.set(col || '#9aa6b8');
      slot.mesh.visible = true;
    }
    dirty = true;
  }

  /* ================= Scratch Math Objects (zero per-frame allocs) ================= */
  const _n = new Vector3();
  const _nContact = new Vector3();
  const _q = new Quaternion();
  const _qTilt = new Quaternion();
  const _m = new Matrix4();
  const _pos = new Vector3();
  const _scl = new Vector3(1, 1, 1);
  const _v3 = new Vector3();
  const _v3b = new Vector3();
  const _axis = new Vector3();
  const _dq = new Quaternion();
  const _qSpin = new Quaternion();
  const _c0 = { q: 0, nx: 0, ny: 0, rc: 0, run: 0, lift: 0 };
  const _c1 = { q: 0, nx: 0, ny: 0, rc: 0, run: 0, lift: 0 };
  const ballQuat = new Quaternion();
  let hasPrevBall = false, prevBallX = 0, prevBallY = 0;

  function applyRollStep(x0, y0, x1, y1) {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const d2 = dx * dx + dy * dy;
    if (d2 < 1e-8 || d2 > 10000) return false; // stationary or teleport (>100u in one step)
    const lift0 = coveAt(x0, y0, _c0).lift;
    const lift1 = coveAt(x1, y1, _c1).lift;
    const dz = lift1 - lift0;
    const cm = coveAt((x0 + x1) * 0.5, (y0 + y1) * 0.5, _c0);
    let cnx = 0, cny = 0, cnz = 1;
    if (cm.q > 0 && cm.run > 0) {
      const st = clamp(cm.q / cm.run, 0, 0.999);
      const ct = Math.sqrt(Math.max(0, 1 - st * st));
      cnx = -cm.nx * st;
      cny = cm.ny * st;
      cnz = ct;
    }
    // In Three.js board-local coords: dp = (dx, -dy, dz); rolling axis = n_surface x dp; angle = |n_surface x dp| / P.BALL
    const dpx = dx, dpy = -dy, dpz = dz;
    const ax = cny * dpz - cnz * dpy;
    const ay = cnz * dpx - cnx * dpz;
    const az = cnx * dpy - cny * dpx;
    const mag = Math.hypot(ax, ay, az);
    if (mag > 1e-4) {
      _axis.set(ax / mag, ay / mag, az / mag);
      _dq.setFromAxisAngle(_axis, mag / P.BALL);
      ballQuat.premultiply(_dq).normalize();
      return true;
    }
    return false;
  }

  function resetBall() {
    hasPrevBall = false;
  }

  /* ================= Layout & FLIP Camera Tween ================= */
  let curL = { vw: 800, vh: 600, cx: 400, cy: 300, S: 0.5, theta: 0, pitch: 0, persp: 1200, dpr: 1 };
  let anim = null; // { from, to, start, dur }
  let canvasW = 0, canvasH = 0, canvasDpr = 0;
  let dirty = true;
  let contextLost = false;
  let drawCount = 0;

  // Displayed state caches for dirty detection
  const curDepths = [0, 0, 0, 0];
  let depthsInitialized = false;
  const lastTabP = [-1, -1, -1, -1];
  const lastTabFlags = [-1, -1, -1, -1];
  let lastBallKey = '';
  let lastFxActive = false;
  let lastBallData = null; // { scale }

  function applyCameraState(st) {
    const vw = Math.max(1, st.vw), vh = Math.max(1, st.vh);
    const dpr = Math.min(st.dpr || window.devicePixelRatio || 1, 2);
    if (vw !== canvasW || vh !== canvasH || dpr !== canvasDpr) {
      canvasW = vw; canvasH = vh; canvasDpr = dpr;
      renderer.setPixelRatio(dpr);
      renderer.setSize(vw, vh, false);
    }
    const S = Math.max(0.05, st.S);
    const persp = Math.max(200, st.persp);
    const dist = persp / S;

    camera.fov = (2 * Math.atan((vh * 0.5) / persp)) / DEG;
    camera.aspect = vw / vh;
    camera.near = Math.max(80, dist * 0.12);
    camera.far = dist * 4.5;
    camera.position.set(0, 0, dist);
    camera.setViewOffset(vw, vh, vw * 0.5 - st.cx, vh * 0.5 - st.cy, vw, vh);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();

    pitchGroup.rotation.x = -st.pitch * DEG;
    spinGroup.rotation.z = -st.theta * DEG;
    pitchGroup.updateMatrixWorld(true);

    updateLightDirection(st.pitch);
    dirty = true;
  }

  function layout(next, animateFrom) {
    if (!next) return;
    const to = {
      vw: next.vw, vh: next.vh, cx: next.cx, cy: next.cy,
      S: next.S, theta: next.theta, pitch: next.pitch, persp: next.persp,
      dpr: next.dpr || Math.min(window.devicePixelRatio || 1, 2),
    };
    if (animateFrom && (
      Math.abs(animateFrom.cx - to.cx) > 1 ||
      Math.abs(animateFrom.cy - to.cy) > 1 ||
      Math.abs(animateFrom.S - to.S) > 0.001 ||
      animateFrom.theta !== to.theta ||
      animateFrom.pitch !== to.pitch
    )) {
      let th0 = animateFrom.theta;
      if (Math.abs(th0 - to.theta) > 180) th0 += th0 < to.theta ? 360 : -360;
      anim = {
        from: { ...animateFrom, theta: th0 },
        to,
        start: performance.now(),
        dur: 820,
      };
      curL = { ...anim.from, vw: to.vw, vh: to.vh, dpr: to.dpr };
      applyCameraState(curL);
    } else {
      anim = null;
      curL = to;
      applyCameraState(curL);
    }
  }

  function stepLayoutAnim() {
    if (!anim) return false;
    const raw = (performance.now() - anim.start) / anim.dur;
    if (raw >= 1) {
      curL = anim.to;
      anim = null;
      applyCameraState(curL);
      return true;
    }
    const e = cubicBezierEase(raw);
    const f = anim.from, t = anim.to;
    curL = {
      vw: t.vw, vh: t.vh, dpr: t.dpr,
      cx: lerp(f.cx, t.cx, e),
      cy: lerp(f.cy, t.cy, e),
      S: lerp(f.S, t.S, e),
      theta: lerp(f.theta, t.theta, e),
      pitch: lerp(f.pitch, t.pitch, e),
      persp: lerp(f.persp, t.persp, e),
    };
    applyCameraState(curL);
    return true;
  }

  /* ================= Surface & Piece Deformation ================= */
  function updateDeformedSurface(d) {
    const d0 = d[0], d1 = d[1], d2 = d[2], d3 = d[3];
    const invX = 1 / P.X, invY = 1 / P.Y;

    // 1) Subdivided floor vertices + exact analytical normals
    for (let i = 0; i < floorVertCount; i++) {
      let u = floorBX[i] * invX; if (u < -1) u = -1; else if (u > 1) u = 1;
      let v = floorBY[i] * invY; if (v < -1) v = -1; else if (v > 1) v = 1;
      const omv = 1 - v, opv = 1 + v;
      const h = -DROP * 0.25 * ((d0 * omv + d1 * opv) * (1 - u) + (d2 * omv + d3 * opv) * (1 + u));
      floorPos.setZ(i, Z_FLOOR0 + h);
      const dhdx = -DROP * 0.25 * invX * ((d2 - d0) * omv + (d3 - d1) * opv);
      const dhdy = -DROP * 0.25 * invY * ((d1 - d0) * (1 - u) + (d3 - d2) * (1 + u));
      const invL = 1 / Math.hypot(-dhdx, dhdy, 1);
      floorNorm.setXYZ(i, -dhdx * invL, dhdy * invL, invL);
    }
    floorPos.needsUpdate = true;
    floorNorm.needsUpdate = true;

    // 2) Raised tray cove & rim following the exact same surface
    for (let i = 0; i < rimVertCount; i++) {
      const h = surfaceRelZ(d, rimBX[i], rimBY[i]);
      rimPos.setZ(i, Z_FLOOR0 + h + rimDZ[i]);
    }
    rimPos.needsUpdate = true;
    rimGeo.computeVertexNormals();

    // 2b) Clear start disc & centre cup following the floor surface
    for (let i = 0; i < discVertCount; i++) {
      const h = surfaceRelZ(d, discBX[i], discBY[i]);
      discPos.setZ(i, Z_FLOOR0 + h + discDZ[i]);
    }
    discPos.needsUpdate = true;
    discGeo.computeVertexNormals();

    // 3) 22 Instanced pegs positioned on surface & aligned to local normal
    for (let i = 0; i < P.PEGS.length; i++) {
      const p = P.PEGS[i];
      const z = Z_FLOOR0 + surfaceRelZ(d, p.x, p.y);
      surfaceNormal(d, p.x, p.y, _n);
      _q.setFromUnitVectors(UP, _n);
      _pos.set(p.x, -p.y, z);
      _m.compose(_pos, _q, _scl);
      pegInst.setMatrixAt(i, _m);
    }
    pegInst.instanceMatrix.needsUpdate = true;

    // 4) 4 Pockets (U-wall + metal ring + hole + pocket FX overlays)
    for (let i = 0; i < P.POCKETS.length; i++) {
      const p = P.POCKETS[i];
      const g = pocketGroups[i];
      const z = Z_FLOOR0 + surfaceRelZ(d, p.hx, p.hy);
      surfaceNormal(d, p.hx, p.hy, _n);
      g.position.set(p.hx, -p.hy, z);
      g.quaternion.setFromUnitVectors(UP, _n);
    }
  }

  // Initialize surface at neutral rest immediately
  updateDeformedSurface(curDepths);
  depthsInitialized = true;

  /* ================= Main Per-Frame Draw ================= */
  function draw(V) {
    if (contextLost || !V) return;

    const animActive = stepLayoutAnim();
    let shadowDirty = animActive;

    // 1) Tray bilinear depths
    const tp = V.trayPress || V.press;
    computeDepths(tp, _d);
    let depthsChanged = !depthsInitialized;
    for (let c = 0; c < 4; c++) {
      if (Math.abs(_d[c] - curDepths[c]) > 1e-5) { depthsChanged = true; break; }
    }
    if (depthsChanged) {
      for (let c = 0; c < 4; c++) curDepths[c] = _d[c];
      depthsInitialized = true;
      updateDeformedSurface(curDepths);
      shadowDirty = true;
      dirty = true;
    }

    // 2) Lever tabs (displayed depth is at least corner's actual depth so partner visibly dips 30%)
    const botThr = (P.K && P.K.BOTTOM != null) ? P.K.BOTTOM : 0.97;
    const pulse = 0.5 + 0.5 * Math.sin((V.now || 0) * 8);
    for (let c = 0; c < 4; c++) {
      const pVal = clamp(V.press[c] || 0, 0, 1);
      const tabDepth = Math.max(pVal, curDepths[c]);
      const owner = P.OWNER[c];
      const tired = !!(V.tired && V.tired[owner]);
      const held = !!((V.held >> c) & 1);
      const bot = !tired && pVal >= botThr;
      const flags = (tired ? 1 : 0) | (held ? 2 : 0) | (bot ? 4 : 0);

      if (Math.abs(tabDepth - lastTabP[c]) > 1e-4 || flags !== lastTabFlags[c] || bot) {
        lastTabP[c] = tabDepth;
        lastTabFlags[c] = flags;
        dirty = true;

        const g = tabGroups[c];
        g.position.z = TAB_Z0 - DROP * tabDepth;

        const tpPart = tabParts[c];
        if (tired) {
          tpPart.mat.color.copy(cTired);
          tpPart.mat.roughness = 0.62;
          tpPart.mat.emissive.copy(cZero);
          tpPart.mat.emissiveIntensity = 0;
          tpPart.stemMat.color.setHex(0xb8bec9);
          tpPart.ridgeMat.color.setHex(0xe2e6ee);
          tpPart.lockMesh.visible = false;
          tpPart.hMesh.visible = false;
        } else {
          tpPart.mat.color.copy(cIdle[owner]).lerp(cDown[owner], tabDepth * 0.45);
          tpPart.mat.roughness = 0.32;
          tpPart.stemMat.color.copy(cDown[owner]);
          tpPart.ridgeMat.color.set(owner === 'r' ? colRL : colBL);
          if (bot) {
            tpPart.mat.emissive.copy(cEmissive[owner]);
            tpPart.mat.emissiveIntensity = 0.12 + 0.18 * pulse;
            tpPart.lockMesh.visible = true;
            tpPart.hMesh.visible = true;
            tpPart.hMat.opacity = 0.65 + 0.3 * pulse;
          } else {
            tpPart.mat.emissive.copy(cZero);
            tpPart.mat.emissiveIntensity = 0;
            tpPart.lockMesh.visible = false;
            if (pVal > 0.03 || held) {
              tpPart.hMesh.visible = true;
              tpPart.hMat.opacity = 0.14 + pVal * 0.26;
            } else {
              tpPart.hMesh.visible = false;
            }
          }
        }
      }
    }

    // 3) Steel Ball + rolling quaternion + cove climb + contact shadow
    const b = V.ball;
    let rolledThisFrame = false;
    if (b && !b.dark && V.rollPts && V.rollN > 1) {
      const rp = V.rollPts;
      const nPts = V.rollN;
      for (let k = 0; k < nPts - 1; k++) {
        if (applyRollStep(rp[k * 2], rp[k * 2 + 1], rp[(k + 1) * 2], rp[(k + 1) * 2 + 1])) {
          rolledThisFrame = true;
        }
      }
      prevBallX = rp[(nPts - 1) * 2];
      prevBallY = rp[(nPts - 1) * 2 + 1];
      hasPrevBall = true;
    }
    const bKey = b
      ? `${b.x.toFixed(2)},${b.y.toFixed(2)},${(b.scale || 1).toFixed(3)},${(b.dark || 0).toFixed(3)},${curL.theta.toFixed(1)}`
      : 'none';
    if (bKey !== lastBallKey || depthsChanged || rolledThisFrame) {
      lastBallKey = bKey;
      dirty = true;
      shadowDirty = true;
      if (!b) {
        ballMesh.visible = false;
        ballShadowMesh.visible = false;
        hasPrevBall = false;
        lastBallData = null;
      } else {
        const sc = b.scale != null ? b.scale : 1;
        const dark = b.dark || 0;
        const zSurf = Z_FLOOR0 + surfaceRelZ(curDepths, b.x, b.y);
        surfaceNormal(curDepths, b.x, b.y, _n);

        // Fallback rolling integration when substep trajectory isn't supplied (e.g. online guest)
        if (!rolledThisFrame) {
          if (hasPrevBall) {
            applyRollStep(prevBallX, prevBallY, b.x, b.y);
          }
          prevBallX = b.x;
          prevBallY = b.y;
          hasPrevBall = true;
        }

        // Cove lift and contact geometry
        const cv = coveAt(b.x, b.y, _c0);
        const coveLift = dark > 0 ? 0 : cv.lift;
        const sinTh = (coveLift > 0 && cv.run > 0) ? clamp(cv.q / cv.run, 0, 0.999) : 0;
        const cosTh = sinTh > 0 ? Math.sqrt(Math.max(0, 1 - sinTh * sinTh)) : 1;

        // Sinking into hole during pocket-drop (dark goes 0 -> 0.6)
        const dropFrac = clamp(dark / 0.6, 0, 1);
        const liftAlongN = P.BALL * sc - dropFrac * P.BALL * 1.35;
        // Fade the horizontal floor-normal shift out on the steep cove so the ball never penetrates the Z-extruded cove wall
        const flatShift = 1 - sinTh;

        ballMesh.visible = true;
        ballMesh.position.set(
          b.x + _n.x * liftAlongN * flatShift,
          -b.y + _n.y * liftAlongN * flatShift,
          zSurf + (_n.z * flatShift + sinTh) * liftAlongN + coveLift
        );
        ballMesh.scale.setScalar(sc);
        ballMesh.quaternion.copy(ballQuat);

        // Darken chrome as it drops into the dark hole
        const shade = clamp(1 - dropFrac * 0.85, 0.1, 1);
        ballMat.color.copy(ballBaseColor).multiplyScalar(shade);
        ballMat.envMapIntensity = 1.24 * shade;

        // Contact shadow decal sitting on the floor or tilted onto the cove surface beneath the ball
        if (sc > 0.62 && dropFrac < 0.25) {
          ballShadowMesh.visible = true;
          if (sinTh > 1e-4) {
            // Contact point on the circular cove fillet + inward cove normal
            const cx = b.x + cv.nx * P.BALL * sc * sinTh;
            const cy = b.y + cv.ny * P.BALL * sc * sinTh;
            const cz = P.BALL * sc * (1 - cosTh) + coveLift;
            _nContact.set(-cv.nx * sinTh, cv.ny * sinTh, cosTh);
            _qTilt.setFromUnitVectors(UP, _n);
            _nContact.applyQuaternion(_qTilt).normalize();
            const shOff = 0.55 + sinTh * 1.35;
            ballShadowMesh.position.set(
              cx + _nContact.x * shOff,
              -cy + _nContact.y * shOff,
              zSurf + cz + _nContact.z * shOff
            );
            _qSpin.setFromAxisAngle(UP, curL.theta * DEG);
            ballShadowMesh.quaternion.setFromUnitVectors(UP, _nContact).multiply(_qSpin);
            // Squash and fade slightly as the ball climbs the curved cove so the decal stays tight to the curve
            ballShadowMesh.scale.setScalar(sc * (1 - sinTh * 0.30));
            ballShadowMat.opacity = clamp((sc - 0.62) / 0.38, 0, 1) * (1 - dropFrac * 4) * 0.96 * (1 - sinTh * 0.36);
          } else {
            ballShadowMesh.position.set(
              b.x + _n.x * 0.55,
              -b.y + _n.y * 0.55,
              zSurf + _n.z * 0.55
            );
            _qSpin.setFromAxisAngle(UP, curL.theta * DEG);
            ballShadowMesh.quaternion.setFromUnitVectors(UP, _n).multiply(_qSpin);
            ballShadowMesh.scale.setScalar(sc);
            ballShadowMat.opacity = clamp((sc - 0.62) / 0.38, 0, 1) * (1 - dropFrac * 4) * 0.96;
          }
        } else {
          ballShadowMesh.visible = false;
        }
        lastBallData = { scale: sc };
      }
    }

    // 4) Effects: spawn ring, "your pockets" mine pulse, goal glow, impact sparks
    const hasFx = V.ring != null || !!V.mine || !!V.glow || activeSparks > 0;
    if (hasFx || lastFxActive) {
      dirty = true;
      lastFxActive = hasFx;

      // Spawn ring sitting at the start cup (P.CUP_R) expanding within P.DISC_R
      if (V.ring != null) {
        const z0 = Z_FLOOR0 + surfaceRelZ(curDepths, 0, 0);
        surfaceNormal(curDepths, 0, 0, _n);
        _q.setFromUnitVectors(UP, _n);
        for (let j = 0; j < 2; j++) {
          const q = (V.ring * 1.4 + j * 0.5) % 1;
          const rad = P.CUP_R + q * (P.DISC_R - P.CUP_R) * 0.75;
          const sr = spawnRings[j];
          sr.mesh.visible = true;
          sr.mesh.position.set(_n.x * 1.6, _n.y * 1.6, z0 + _n.z * 1.6);
          sr.mesh.quaternion.copy(_q);
          sr.mesh.scale.set(rad, rad, 1);
          sr.mat.opacity = 0.35 * (1 - q);
        }
      } else {
        spawnRings[0].mesh.visible = false;
        spawnRings[1].mesh.visible = false;
      }

      // Reset pocket FX before applying mine / glow
      for (let i = 0; i < P.POCKETS.length; i++) {
        const fx = pocketFX[i];
        fx.fillMesh.visible = false;
        fx.capMesh.visible = false;
        for (let rr = 0; rr < 4; rr++) fx.rings[rr].mesh.visible = false;
      }

      // First-game "your pockets" gentle pulse
      if (V.mine) {
        const mp = 0.5 + 0.5 * Math.sin((V.now || 0) * 4.2);
        const q = ((V.now || 0) * 0.7) % 1;
        for (let i = 0; i < P.POCKETS.length; i++) {
          const p = P.POCKETS[i];
          if (!V.mine.includes(p.color)) continue;
          const fx = pocketFX[i];
          fx.fillMesh.visible = true;
          fx.fillMat.opacity = 0.14 + 0.22 * mp;
          fx.capMesh.visible = true;
          fx.capMat.opacity = 0.28 + 0.48 * mp;
          const r0 = fx.rings[0];
          const rad = P.HOLE + 6 + q * 46;
          r0.mesh.visible = true;
          r0.mesh.scale.set(rad, rad, 1);
          r0.mat.opacity = 0.55 * (1 - q);
        }
      }

      // Goal scoring pocket glow + expanding shockwaves
      if (V.glow) {
        const idx = V.glow.pocket;
        const gt = V.glow.t;
        const a = Math.max(0, 1 - gt / 2.4);
        const gp = 0.65 + 0.35 * Math.sin(gt * 16);
        const fx = pocketFX[idx];
        if (fx && a > 0.005) {
          fx.fillMesh.visible = true;
          fx.fillMat.opacity = a * 0.58 * gp;
          fx.capMesh.visible = true;
          fx.capMat.opacity = a * 0.92 * gp;
          for (let rr = 0; rr < 4; rr++) {
            const q = gt * 1.25 - rr * 0.2;
            const ring = fx.rings[rr];
            if (q > 0 && q <= 1) {
              const rad = P.HOLE + q * 150;
              ring.mesh.visible = true;
              ring.mesh.scale.set(rad, rad, 1);
              ring.mat.opacity = a * (1 - q) * 0.85;
            } else {
              ring.mesh.visible = false;
            }
          }
        }
      }

      // Impact sparks
      if (activeSparks > 0) {
        const dt = V.dt || 0.016;
        for (let i = 0; i < MAX_SPARKS; i++) {
          const s = sparkPool[i];
          if (!s.active) continue;
          s.t += dt;
          if (s.t >= s.life) {
            s.active = false;
            s.mesh.visible = false;
            activeSparks--;
            continue;
          }
          const q = s.t / s.life;
          const px = s.x + s.vx * s.t;
          const py = s.y + s.vy * s.t;
          const z = Z_FLOOR0 + surfaceRelZ(curDepths, px, py) + coveMeshZAt(px, py) + 6;
          const sp = Math.hypot(s.vx, s.vy);
          const len = Math.max(5, sp * 0.036);
          s.mesh.position.set(px, -py, z);
          s.mesh.rotation.z = Math.atan2(-s.vy, s.vx);
          s.mesh.scale.set(len, 1 - q * 0.65, 1);
          s.mat.opacity = 1 - q;
        }
      }
    }

    if (!dirty || document.hidden) return;
    dirty = false;
    if (shadowDirty) renderer.shadowMap.needsUpdate = true;
    renderer.render(scene, camera);
    drawCount++;
  }

  /* ================= Projection & Readback Hooks ================= */
  function projectWorld(wx, wy, wz) {
    _v3.set(wx, wy, wz).project(camera);
    return {
      x: (_v3.x * 0.5 + 0.5) * curL.vw,
      y: (0.5 - _v3.y * 0.5) * curL.vh,
    };
  }

  function projectBoardLocal(lx, ly, lz) {
    _v3.set(lx, ly, lz).applyMatrix4(boardGroup.matrixWorld);
    return projectWorld(_v3.x, _v3.y, _v3.z);
  }

  function project(x, y, lift) {
    const z = Z_FLOOR0 + surfaceRelZ(curDepths, x, y) + (lift || 0);
    return projectBoardLocal(x, -y, z);
  }

  /** Read back actual floor corner height from the deformed floor BufferGeometry. */
  function cornerHeight(c) {
    const idx = cornerVertIdx[c];
    if (idx < 0) return 0;
    return floorPos.getZ(idx) - Z_FLOOR0;
  }

  /** Read back actual lever tab height from its Three.js Group transform. */
  function tabHeight(c) {
    const g = tabGroups[c];
    if (!g) return 0;
    return g.position.z - TAB_Z0;
  }

  /** Build the OG.r3d() snapshot from actual rendered meshes and transforms. */
  function r3d() {
    pitchGroup.updateMatrixWorld(true);
    const mw = boardGroup.matrixWorld;

    const corners = [0, 1, 2, 3].map((c) => {
      const idx = cornerVertIdx[c];
      const lx = floorPos.getX(idx), ly = floorPos.getY(idx), lz = floorPos.getZ(idx);
      const pt = projectBoardLocal(lx, ly, lz);
      return { x: pt.x, y: pt.y, h: lz - Z_FLOOR0 };
    });

    const tabs = [0, 1, 2, 3].map((c) => {
      const p = tabGroups[c].position;
      const pt = projectBoardLocal(p.x, p.y, p.z);
      return { x: pt.x, y: pt.y, h: p.z - TAB_Z0 };
    });

    const frame = P.CORNERS.map(([sx, sy]) => projectBoardLocal(sx * FRAME_X, -sy * FRAME_Y, 0));

    let ball = null;
    if (ballMesh.visible && lastBallData) {
      const bp = ballMesh.position;
      _v3b.copy(bp).applyMatrix4(mw);
      const cPt = projectWorld(_v3b.x, _v3b.y, _v3b.z);
      const R = P.BALL * lastBallData.scale;
      const ePt = projectWorld(_v3b.x + R, _v3b.y, _v3b.z);
      ball = {
        x: cPt.x,
        y: cPt.y,
        r: Math.hypot(ePt.x - cPt.x, ePt.y - cPt.y),
        h: bp.z - Z_FLOOR0,
      };
    }

    // Projected radius of peg nearest board centre
    const cp = P.PEGS[centerPegIdx];
    const cpZ = Z_FLOOR0 + surfaceRelZ(curDepths, cp.x, cp.y) + PEG_H * 0.5;
    _v3b.set(cp.x, -cp.y, cpZ).applyMatrix4(mw);
    const pCenter = projectWorld(_v3b.x, _v3b.y, _v3b.z);
    const pEdge = projectWorld(_v3b.x + P.PEG, _v3b.y, _v3b.z);
    const pegR = Math.hypot(pEdge.x - pCenter.x, pEdge.y - pCenter.y);

    // Board-unit positions read directly from the actual Three.js meshes/instances (not copied from P)
    const partsPegs = [];
    for (let i = 0; i < pegInst.count; i++) {
      pegInst.getMatrixAt(i, _m);
      _pos.setFromMatrixPosition(_m);
      partsPegs.push({ x: _pos.x, y: -_pos.y });
    }
    const partsHoles = [];
    const partsPocketPts = [];
    for (let i = 0; i < pocketGroups.length; i++) {
      const g = pocketGroups[i];
      const pm = pocketMeshes[i];
      g.updateMatrix();
      pm.hDisc.updateMatrix();
      _m.multiplyMatrices(g.matrix, pm.hDisc.matrix);
      _pos.setFromMatrixPosition(_m);
      partsHoles.push({ x: _pos.x, y: -_pos.y });

      const bb = pm.uMesh.geometry.boundingBox;
      const gx = g.position.x, gy = g.position.y;
      const leftEnd = gx < 0;
      const xBack = gx + (leftEnd ? bb.min.x + P.WALL : bb.max.x - P.WALL);
      const xMouth = gx + (leftEnd ? bb.max.x - P.WALL : bb.min.x + P.WALL);
      const yArmA = -(gy + (bb.min.y + P.WALL));
      const yArmB = -(gy + (bb.max.y - P.WALL));
      const yOut = Math.abs(yArmA) >= Math.abs(yArmB) ? yArmA : yArmB;
      const yIn = Math.abs(yArmA) >= Math.abs(yArmB) ? yArmB : yArmA;
      partsPocketPts.push([
        { x: xMouth, y: yOut },
        { x: xBack, y: yOut },
        { x: xBack, y: yIn },
        { x: xMouth, y: yIn },
      ]);
    }
    const partsTabs = tabGroups.map((g) => ({ x: g.position.x, y: -g.position.y }));

    return {
      webgl: !contextLost,
      drop: DROP,
      corners,
      tabs,
      frame,
      ball,
      pegR,
      draws: drawCount,
      parts: {
        pegs: partsPegs,
        holes: partsHoles,
        pocketPts: partsPocketPts,
        tabs: partsTabs,
      },
    };
  }

  function refreshFonts() {
    paintFloorTexture();
    floorTex.needsUpdate = true;
    dirty = true;
  }

  /* ================= Context Lost / Restored & Disposal ================= */
  function handleContextLost(e) {
    e.preventDefault();
    contextLost = true;
    if (typeof onContextLost === 'function') onContextLost();
  }
  function handleContextRestored() {
    contextLost = false;
    dirty = true;
    renderer.shadowMap.needsUpdate = true;
  }
  canvas.addEventListener('webglcontextlost', handleContextLost, false);
  canvas.addEventListener('webglcontextrestored', handleContextRestored, false);

  function dispose() {
    canvas.removeEventListener('webglcontextlost', handleContextLost, false);
    canvas.removeEventListener('webglcontextrestored', handleContextRestored, false);
    for (const g of geos) g.dispose();
    for (const m of mats) m.dispose();
    for (const t of texs) t.dispose();
    for (const rt of rts) rt.dispose();
    renderer.dispose();
  }

  return {
    layout,
    draw,
    spark,
    resetBall,
    project,
    cornerHeight,
    tabHeight,
    r3d,
    draws() { return drawCount; },
    refreshFonts,
    dispose,
  };
}

window.OGBoard3D = { create };
