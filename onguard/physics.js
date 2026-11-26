/* On Guard — board geometry and marble physics.
   Shared by every mode: the same-phone game, the online host (the only one that simulates online),
   practice mode, and the Node tests in /tmp/og. No DOM in here.

   Board units: the tray floor is 1000 x 680, centered on (0,0); x grows to the right (Blue's end),
   y grows downward. Red sits at the left end (x < 0), Blue at the right end (x > 0).
   Pegs and pockets follow the photos of the original board (22 pegs, two pockets on each end; the originals were green and yellow, here they're red and blue). */
(function (root) {
  'use strict';

  const X = 500, Y = 340, CORNER = 56; // tray floor half-size and its rounded inner corner
  const BALL = 16, PEG = 14, WALL = 4.5; // marble radius, peg radius, pocket-wall half-thickness
  const HOLE = 17; // drawn radius of the hole in each pocket

  // 22 pegs, mirror-symmetric like the real board
  const PEGS = [];
  const sym = (x, y) => {
    const pts = [[x, y], [-x, y], [x, -y], [-x, -y]];
    pts.forEach(([a, b]) => { if (!PEGS.some((p) => p.x === a && p.y === b)) PEGS.push({ x: a, y: b }); });
  };
  sym(270, 262); // the four outer corners
  sym(0, 222); // top and bottom center
  sym(135, 176);
  sym(268, 132);
  sym(0, 132);
  sym(135, 0); // either side of the starting spot
  sym(325, 44); // the guards, right in front of each pocket

  // Pockets: U shapes against each end wall, opening toward the middle.
  // Left end: Red on top, Blue below. Right end: Blue on top, Red below.
  const BACK = 490, MOUTH = 426, OUT = 78, IN = 6, HOLE_X = 454, HOLE_Y = 42;
  const POCKETS = [
    { side: -1, v: -1, color: 'r' },
    { side: -1, v: 1, color: 'b' },
    { side: 1, v: -1, color: 'b' },
    { side: 1, v: 1, color: 'r' },
  ].map((p, i) => ({
    i, side: p.side, v: p.v, color: p.color,
    hx: p.side * HOLE_X, hy: p.v * HOLE_Y,
    // corners of the U (back corners, then the two arm tips)
    pts: [[p.side * MOUTH, p.v * OUT], [p.side * BACK, p.v * OUT], [p.side * BACK, p.v * IN], [p.side * MOUTH, p.v * IN]],
  }));
  const SEGS = [];
  POCKETS.forEach((p) => {
    for (let k = 0; k < 3; k++) SEGS.push({ ax: p.pts[k][0], ay: p.pts[k][1], bx: p.pts[k + 1][0], by: p.pts[k + 1][1] });
  });

  // Levers: one per corner. The tray rests high on all four corners; holding a lever sinks its corner
  // (and drags the same end's partner corner down by K.LINK), so the marble rolls toward the pressed corner.
  // 0 = top-left, 1 = bottom-left (Red's), 2 = top-right, 3 = bottom-right (Blue's).
  const CORNERS = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
  const OWNER = ['r', 'r', 'b', 'b'];

  const K = {
    LINK: 0.3, // how much pressing one corner drags its same-end partner down
    GX: 1780, GY: 1780 * X / Y, // board units / s^2 across full x / y span
    DROP: 26, // board units a fully pressed corner sinks (for the renderer)
    SINK: 1 / 0.81, RISE: 1 / 1.0, // linear sink / rise rates (1/s)
    LINGER: 0.20, TAP: 0.16, // release linger and tap-hold window (s)
    BOTTOM: 0.97, // depth at which a lever counts as bottomed out (drains push meter)
    DAMP: 0.62, ROLL: 24, // rolling losses: proportional (1/s) and constant (units/s^2)
    E_PEG: 0.55, E_WALL: 0.45, E_EDGE: 0.38, // bounciness
    VMAX: 1000, DT: 1 / 240,
    LIP: 24, PULL: 2600, // a marble near the middle of a hole dips toward it
    CATCH: 9, CATCH_SLOW: 15, SLOW: 300,
  };

  function create() {
    return {
      x: 0, y: 0, vx: 0, vy: 0,
      press: [0, 0, 0, 0], held: [0, 0, 0, 0], up: [K.LINGER, K.LINGER, K.LINGER, K.LINGER], tap: [0, 0, 0, 0],
      live: true, t: 0,
    };
  }
  function reset(s) {
    s.x = 0; s.y = 0; s.vx = 0; s.vy = 0; s.live = true; s.t = 0;
    return s;
  }
  function leverReset(s) {
    for (let c = 0; c < 4; c++) { s.press[c] = 0; s.held[c] = 0; s.up[c] = K.LINGER; s.tap[c] = 0; }
    return s;
  }

  // Serialise all four levers into 4 JSON-safe 25-bit integers:
  // bits 0..9: depth (10 bits, 0..1023); bits 10..16: up timer (7 bits, 1/250 s);
  // bits 17..23: held timer (7 bits, 1/250 s); bit 24: tap-hold flag.
  const LEV_HZ = 250;
  function leverPack(s) {
    const out = [0, 0, 0, 0];
    const uCap = Math.min(127, Math.ceil(K.LINGER * LEV_HZ));
    const hCap = Math.min(127, Math.ceil(K.TAP * LEV_HZ));
    for (let c = 0; c < 4; c++) {
      const pv = s.press[c];
      const p = pv <= 0 ? 0 : pv >= 1 ? 1023 : Math.round(pv * 1023);
      const uv = s.up[c];
      const u = uv <= 0 ? 0 : uv >= K.LINGER ? uCap : Math.max(1, Math.min(uCap, Math.round(uv * LEV_HZ)));
      const hv = s.held[c];
      const h = hv <= 0 ? 0 : hv >= K.TAP ? hCap : Math.max(1, Math.min(hCap, Math.round(hv * LEV_HZ)));
      const t = h > 0 && s.tap[c] ? 1 : 0;
      out[c] = p | (u << 10) | (h << 17) | (t << 24);
    }
    return out;
  }
  function leverUnpack(s, v) {
    if (!Array.isArray(v) || v.length < 4) return leverReset(s);
    for (let c = 0; c < 4; c++) {
      const raw = v[c];
      const w = typeof raw === 'number' && Number.isFinite(raw) ? (Math.max(0, Math.min(0x1ffffff, Math.round(raw))) | 0) : 0;
      s.press[c] = (w & 1023) / 1023;
      const h = ((w >> 17) & 127) / LEV_HZ;
      s.held[c] = h > K.TAP ? K.TAP : h;
      if (s.held[c] > 0) {
        s.up[c] = 0;
        s.tap[c] = (w >> 24) & 1;
      } else {
        const u = ((w >> 10) & 127) / LEV_HZ;
        s.up[c] = u > K.LINGER ? K.LINGER : u;
        s.tap[c] = 0;
      }
    }
    return s;
  }

  const _d = [0, 0, 0, 0];
  const _sl = { ax: 0, ay: 0 };

  /** The other corner at the same player's end. */
  function partner(c) { return c ^ 1; }

  /** Corner depths d[c] in 0..1 (0 = neutral high, 1 = fully down). Reuses `out` if given. */
  function depths(press, out) {
    const d = out || [0, 0, 0, 0];
    const l = K.LINK;
    const p0 = press[0], p1 = press[1], p2 = press[2], p3 = press[3];
    d[0] = p0 + l * p1 * (1 - p0);
    d[1] = p1 + l * p0 * (1 - p1);
    d[2] = p2 + l * p3 * (1 - p2);
    d[3] = p3 + l * p2 * (1 - p3);
    return d;
  }

  function _slopeAt(press, x, y, out) {
    depths(press, _d);
    let u = x / X; if (u < -1) u = -1; else if (u > 1) u = 1;
    let v = y / Y; if (v < -1) v = -1; else if (v > 1) v = 1;
    const d0 = _d[0], d1 = _d[1], d2 = _d[2], d3 = _d[3];
    out.ax = K.GX * 0.5 * ((d2 - d0) * (1 - v) + (d3 - d1) * (1 + v));
    out.ay = K.GY * 0.5 * ((d1 - d0) * (1 - u) + (d3 - d2) * (1 + u));
    return out;
  }

  /** Marble acceleration (board units / s^2) from the bilinear tray tilt at (x, y). */
  function slopeAt(press, x, y) {
    return _slopeAt(press, x, y, { ax: 0, ay: 0 });
  }

  /** Marble acceleration (board units / s^2) at the center of the board. */
  function slope(press) {
    return slopeAt(press, 0, 0);
  }

  /** Dimensionless tray tilt and mean sink (0..1) for the renderer. */
  function tilt(press) {
    depths(press, _d);
    const d0 = _d[0], d1 = _d[1], d2 = _d[2], d3 = _d[3];
    return {
      tx: 0.5 * (d2 + d3 - d0 - d1),
      ty: 0.5 * (d1 + d3 - d0 - d2),
      sink: 0.25 * (d0 + d1 + d2 + d3),
    };
  }

  /** Tray floor height z in board units (0 at neutral high, down to -K.DROP). */
  function heightAt(press, x, y) {
    depths(press, _d);
    let u = x / X; if (u < -1) u = -1; else if (u > 1) u = 1;
    let v = y / Y; if (v < -1) v = -1; else if (v > 1) v = 1;
    const omv = 1 - v, opv = 1 + v;
    return -K.DROP * 0.25 * ((_d[0] * omv + _d[1] * opv) * (1 - u) + (_d[2] * omv + _d[3] * opv) * (1 + u));
  }

  /** Advance corner depths and tap/linger timers for the held levers (mask bit c = corner c held). */
  function easePress(s, mask, dt) {
    if (!(dt > 0)) return;
    const press = s.press, held = s.held, up = s.up, tap = s.tap;
    for (let c = 0; c < 4; c++) {
      if ((mask >> c) & 1) {
        if (held[c] === 0) {
          tap[c] = up[c] < K.LINGER && press[c] > 0 ? 1 : 0;
          up[c] = 0;
        }
        const h1 = held[c] + dt;
        if (tap[c]) {
          if (h1 >= K.TAP) {
            tap[c] = 0;
            const p = press[c] + K.SINK * (h1 - K.TAP);
            press[c] = p > 1 ? 1 : p;
          }
        } else {
          const p = press[c] + K.SINK * dt;
          press[c] = p > 1 ? 1 : p;
        }
        held[c] = h1 > K.TAP ? K.TAP : h1;
      } else {
        held[c] = 0;
        tap[c] = 0;
        const u0 = up[c], u1 = u0 + dt;
        if (u1 > K.LINGER) {
          const riseDt = u0 >= K.LINGER ? dt : u1 - K.LINGER;
          const p = press[c] - K.RISE * riseDt;
          press[c] = p < 0 ? 0 : p;
          up[c] = K.LINGER;
        } else {
          up[c] = u1;
        }
      }
    }
  }

  function bounce(s, nx, ny, e, out, kind) {
    const vn = s.vx * nx + s.vy * ny;
    if (vn < 0) {
      s.vx -= (1 + e) * vn * nx;
      s.vy -= (1 + e) * vn * ny;
      // a little scrub on the tangent so glancing hits lose some speed
      const tx = -ny, ty = nx, vt = s.vx * tx + s.vy * ty;
      s.vx -= vt * 0.04 * tx; s.vy -= vt * 0.04 * ty;
      if (out && -vn > 40) out.push({ k: kind, v: -vn });
    }
  }

  /** One fixed physics step. mask = held levers (bit per corner). Returns a pocket index if the marble dropped in. */
  function step(s, mask, dt, out) {
    dt = dt || K.DT;
    easePress(s, mask, dt);
    if (!s.live) return -1;
    s.t += dt;
    const sl = _slopeAt(s.press, s.x, s.y, _sl);
    s.vx += sl.ax * dt;
    s.vy += sl.ay * dt;

    // holes: near the middle of a hole the marble dips toward its center
    for (const p of POCKETS) {
      const dx = p.hx - s.x, dy = p.hy - s.y, d = Math.hypot(dx, dy);
      if (d < K.LIP && d > 1e-6) {
        const f = K.PULL * (1 - d / K.LIP + 0.25);
        s.vx += (dx / d) * f * dt; s.vy += (dy / d) * f * dt;
        const damp = Math.exp(-3 * dt); s.vx *= damp; s.vy *= damp;
      }
    }

    // rolling losses
    const damp = Math.exp(-K.DAMP * dt);
    s.vx *= damp; s.vy *= damp;
    let sp = Math.hypot(s.vx, s.vy);
    if (sp > 0) {
      const ns = Math.max(0, sp - K.ROLL * dt);
      s.vx *= ns / sp; s.vy *= ns / sp; sp = ns;
    }
    if (sp > K.VMAX) { s.vx *= K.VMAX / sp; s.vy *= K.VMAX / sp; }

    s.x += s.vx * dt;
    s.y += s.vy * dt;
    collide(s, out);

    for (const p of POCKETS) {
      const d = Math.hypot(p.hx - s.x, p.hy - s.y);
      if (d < K.CATCH || (d < K.CATCH_SLOW && Math.hypot(s.vx, s.vy) < K.SLOW)) {
        s.live = false;
        return p.i;
      }
    }
    return -1;
  }

  function collide(s, out) {
    for (let iter = 0; iter < 2; iter++) {
      // pegs
      const R = BALL + PEG, R2 = R * R;
      for (const p of PEGS) {
        const dx = s.x - p.x, dy = s.y - p.y, d2 = dx * dx + dy * dy;
        if (d2 < R2) {
          const d = Math.sqrt(d2) || 1e-6, nx = dx / d, ny = dy / d;
          s.x = p.x + nx * R; s.y = p.y + ny * R;
          bounce(s, nx, ny, K.E_PEG, iter ? null : out, 'peg');
        }
      }
      // pocket walls (capsules)
      const W = BALL + WALL, W2 = W * W;
      for (const g of SEGS) {
        const ex = g.bx - g.ax, ey = g.by - g.ay, L2 = ex * ex + ey * ey;
        let t = ((s.x - g.ax) * ex + (s.y - g.ay) * ey) / L2;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const cx = g.ax + ex * t, cy = g.ay + ey * t, dx = s.x - cx, dy = s.y - cy, d2 = dx * dx + dy * dy;
        if (d2 < W2) {
          const d = Math.sqrt(d2) || 1e-6, nx = dx / d, ny = dy / d;
          s.x = cx + nx * W; s.y = cy + ny * W;
          bounce(s, nx, ny, K.E_WALL, iter ? null : out, 'wall');
        }
      }
      // tray edge (a rounded rectangle)
      const mx = X - BALL, my = Y - BALL, ccx = X - CORNER, ccy = Y - CORNER, cr = CORNER - BALL;
      const ax = Math.abs(s.x), ay = Math.abs(s.y);
      if (ax > ccx && ay > ccy) {
        const sx = Math.sign(s.x), sy = Math.sign(s.y), dx = ax - ccx, dy = ay - ccy, d = Math.hypot(dx, dy);
        if (d > cr) {
          const nx = dx / d, ny = dy / d;
          s.x = sx * (ccx + nx * cr); s.y = sy * (ccy + ny * cr);
          bounce(s, -sx * nx, -sy * ny, K.E_EDGE, iter ? null : out, 'edge');
        }
      } else {
        if (s.x > mx) { s.x = mx; bounce(s, -1, 0, K.E_EDGE, iter ? null : out, 'edge'); }
        if (s.x < -mx) { s.x = -mx; bounce(s, 1, 0, K.E_EDGE, iter ? null : out, 'edge'); }
        if (s.y > my) { s.y = my; bounce(s, 0, -1, K.E_EDGE, iter ? null : out, 'edge'); }
        if (s.y < -my) { s.y = -my; bounce(s, 0, 1, K.E_EDGE, iter ? null : out, 'edge'); }
      }
    }
  }

  /** Lever bits for a player: their own left/right hand, as seen sitting at their end of the board.
      Red (left end, facing right): left hand = top-left corner, right hand = bottom-left.
      Blue (right end, facing left): left hand = bottom-right corner, right hand = top-right. */
  const HAND = { r: [0, 1], b: [3, 2] };
  function maskFor(player, hands) { // hands: bit0 = left hand lever, bit1 = right hand lever
    const c = HAND[player];
    return ((hands & 1) ? 1 << c[0] : 0) | ((hands & 2) ? 1 << c[1] : 0);
  }
  function handsOf(player, mask) {
    const c = HAND[player];
    return ((mask >> c[0]) & 1) | (((mask >> c[1]) & 1) << 1);
  }

  /* ---------- a gentle computer player (and the test bots) ----------
     Each player's levers sink their own end's corners (linearly over ~0.9 s, lingering 0.2 s on release
     before rising over ~1.1 s; tapping inside the linger window holds a lever at its current depth).
     The bot splits into a planner (botChoose: desired corner depths in [0, 1] given marble state,
     predicted motion, and both players' current depths, plus a short tactical rollout near its own end
     for sharper levels) and a lightweight fingers layer in makeBot that turns desired depths into
     hold / tap / release masks with per-level reaction delay, imprecision, and meter awareness. */
  const _bsl = { ax: 0, ay: 0 };
  const _bd = [0, 0, 0, 0];
  const _plan = [0, 0];
  const _candOwn = [0, 0, 0, 0, 0];
  const _candOpp = [0, 0, 0, 0, 0];
  const _sc = create();
  const _ps = create();
  const BOT_GEO = {};
  for (const player of ['r', 'b']) {
    const side = player === 'r' ? -1 : 1;
    const myOwn = POCKETS.find((p) => p.color === player && p.side === side);
    const oppOwn = POCKETS.find((p) => p.color !== player && p.side === side);
    const myFar = POCKETS.find((p) => p.color === player && p.side === -side);
    const oppFar = POCKETS.find((p) => p.color !== player && p.side === -side);
    const closestPeg = (pt) => PEGS.reduce((a, b) => (Math.hypot(b.x - pt.hx, b.y - pt.hy) < Math.hypot(a.x - pt.hx, a.y - pt.hy) ? b : a));
    const guardOwn = closestPeg(myOwn);
    const guardOpp = closestPeg(oppOwn);
    const c = HAND[player];
    const ownIsC0 = CORNERS[c[0]][1] === myOwn.v;
    const cOwn = ownIsC0 ? c[0] : c[1];
    const cOpp = ownIsC0 ? c[1] : c[0];
    const hOwn = ownIsC0 ? 1 : 2;
    const hOpp = 3 - hOwn;
    const mOwn = 1 << cOwn;
    const mOpp = 1 << cOpp;
    BOT_GEO[player] = {
      side, myOwn, oppOwn, myFar, oppFar, guardOwn, guardOpp,
      c0: c[0], c1: c[1], cOwn, cOpp, oOwn: cOwn ^ 2, oOpp: cOpp ^ 2,
      hOwn, hOpp, mOwn, mOpp,
    };
  }

  function _solveDepths(axNeed, ayNeed, u, v, cap, out) {
    const ayGain = 0.35 * K.GY * (1 + u);
    let diff = ayGain > 80 ? ayNeed / ayGain : 0;
    if (diff > cap) diff = cap;
    else if (diff < -cap) diff = -cap;

    if (axNeed <= 0 && Math.abs(ayNeed) < 60) {
      out[0] = 0; out[1] = 0;
      return;
    }
    const h = 0.5 * diff;
    let m = 0;
    if (axNeed > 0) {
      const rhs = axNeed / K.GX - 0.3 * h * h - 0.7 * v * h;
      if (rhs >= 1) m = 1;
      else if (rhs > 0) m = (1.3 - Math.sqrt(Math.max(0, 1.69 - 1.2 * rhs))) / 0.6;
    }
    let wOwn = m + h, wOpp = m - h;
    if (wOwn < 0) {
      wOwn = 0;
      wOpp = Math.max(wOpp, -diff);
    } else if (wOpp < 0) {
      wOpp = 0;
      wOwn = Math.max(wOwn, diff);
    }
    if (wOwn > cap) wOwn = cap;
    if (wOpp > cap) wOpp = cap;
    out[0] = wOwn;
    out[1] = wOpp;
  }

  function botChoose(player, s, opts, out) {
    opts = opts || {};
    const plan = out || _plan;
    const g = BOT_GEO[player];
    const sx = g.side, sy = g.myOwn.v;
    const press = s.press;
    depths(press, _bd);
    const oOwn = _bd[g.oOwn], oOpp = _bd[g.oOpp];
    _slopeAt(press, s.x, s.y, _bsl);
    const ax0 = _bsl.ax * sx, ay0 = _bsl.ay * sy;

    const look = opts.look == null ? 0.24 : opts.look;
    const ac = opts.accPred == null ? 0.35 : opts.accPred;
    const cx = s.x * sx, cy = s.y * sy;
    const lvx = s.vx * sx, lvy = s.vy * sy;
    const halfT2 = 0.5 * look * look * ac;
    let lx = cx + lvx * look + ax0 * halfT2;
    let ly = cy + lvy * look + ay0 * halfT2;
    const maxLx = X - BALL, maxLy = Y - BALL;
    if (lx > maxLx) lx = maxLx; else if (lx < -maxLx) lx = -maxLx;
    if (ly > maxLy) ly = maxLy; else if (ly < -maxLy) ly = -maxLy;
    const pvx = lvx + ax0 * look * 0.5 * ac;
    const pvy = lvy + ay0 * look * 0.5 * ac;

    const hx = Math.abs(g.myOwn.hx), hy = Math.abs(g.myOwn.hy);
    const gx = Math.abs(g.guardOwn.x), gy = Math.abs(g.guardOwn.y);
    const mouthHalf = (OUT - IN) * 0.5 - (BALL + WALL);
    const outerClear = OUT + BALL + WALL;
    const speed = Math.hypot(s.vx, s.vy);

    const finishMask = () =>
      ((plan[0] > 0.04 && (plan[0] >= 0.975 || press[g.cOwn] < plan[0])) ? g.hOwn : 0) |
      ((plan[1] > 0.04 && (plan[1] >= 0.975 || press[g.cOpp] < plan[1])) ? g.hOpp : 0);

    // 1) Marble lining up with MY pocket at opponent's end: leave it alone while it goes in
    const distMyFar = Math.hypot(s.x - g.myFar.hx, s.y - g.myFar.hy);
    if (distMyFar < K.LIP + 8 || (cx < -(gx - 40) && cy < -IN && cy > -outerClear && lvx < -20 && (cx < -MOUTH + 14 || (lx < -(gx + 10) && Math.abs(ly + hy) < mouthHalf + 26)))) {
      plan[0] = 0; plan[1] = 0;
      return 0;
    }

    // 2) Tucked behind the pocket walls at MY end: pulling just pins it to the back wall
    if (cx > MOUTH + 2 && (cy > hy + mouthHalf + 10 || cy < -hy - mouthHalf - 10)) {
      plan[0] = 0; plan[1] = 0;
      return 0;
    }

    // 2b) Gentle opponent backs off when the player has worked the marble deep onto the player's half
    //     (still frees stopped marbles and balls stuck behind opponent's pocket walls so play never stalls)
    if (opts.backOff != null && cx < opts.backOff && speed > 38 && !(cx < -375 && Math.abs(cy) > OUT - 6)) {
      plan[0] = 0; plan[1] = 0;
      return 0;
    }

    // 3) Desired local acceleration (axDes, ayDes) and depth cap
    const baseCap = opts.partialCap == null ? 0.88 : opts.partialCap;
    const defendX = opts.defendX == null ? -270 : opts.defendX;
    const brake = opts.brake == null ? 1 : opts.brake;
    const pyMouth = cy + lvy * 0.16;
    const oppLoad = oOwn + oOpp;
    let cap = baseCap;
    let allowBottom = false;
    let axDes = 0, ayDes = 0;

    let u = lx / X; if (u < -1) u = -1; else if (u > 1) u = 1;
    let v = ly / Y; if (v < -1) v = -1; else if (v > 1) v = 1;
    const axOpp = -K.GX * 0.5 * (oOwn * (1 + v) + oOpp * (1 - v));
    const ayOpp = K.GY * 0.5 * (oOwn - oOpp) * (1 - u);
    const uncontested = !opts.fastUncont && oppLoad < 0.25;
    let oppCompX = uncontested ? 0 : 0.90;
    const oppCompY = 1.0; // always account for opponent's y-pull to prevent vertical wall-to-wall ping-pong

    if (lx < defendX && ly > -16 && ly < 120 && (lvx < -40 || lx < defendX - 45)) {
      // Opponent's half and threatening oppFar corridor: pull back decisively
      const urgent = lx < defendX - 55 || lvx < -200 || cx < -345;
      if (urgent) { cap = opts.defBottom === false ? baseCap : 1.0; allowBottom = cap >= 0.98; }
      else cap = Math.max(baseCap, 0.92);
      axDes = urgent ? 1050 : 740;
      ayDes = lx < defendX - 85 ? 0 : (-hy * 1.4 - ly) * 2.5 - pvy * 0.8;
      oppCompX = 1.0;
    } else if (!opts.noGuard && ((cx > MOUTH - 55 && cy < 12 && cy > -outerClear) || ((cx > MOUTH - 110 || lx > MOUTH - 80) && cy < 20 && ly < 18 && cy > -outerClear && lvx > -25))) {
      // Immediate danger of pulling into opponent's pocket at my end: let go before lever linger drags it in!
      plan[0] = 0; plan[1] = 0;
      return 0;
    } else if (!opts.noGuard && cx > 165 && lvx > 15 && ((cy < 30 && lvy < -40) || (lvy < -55 && cy + lvy * 0.28 < 8 && cy < 110)) && cy > -outerClear) {
      // Marble on my half diving downward across center toward oppOwn (e.g. off guard peg): release immediately!
      plan[0] = 0; plan[1] = 0;
      return 0;
    } else if (!opts.noGuard && ((cx > 185 && cy < 8) || (lx > 240 && ly < 14 && cy < 22)) && cy > -outerClear && lvx > 35) {
      // Heading toward opponent's pocket side with forward momentum: release before linger pulls it in
      plan[0] = 0;
      plan[1] = 0;
      return 0;
    } else if (cx > gx && Math.abs(pyMouth - hy) < mouthHalf + 8 && Math.abs(cy - hy) < mouthHalf + 18 && Math.abs(lvy) < 210) {
      // Lined up with my own-end pocket mouth: pull straight in decisively
      const close = cx > gx + 10 && Math.abs(cy - hy) < mouthHalf + 12;
      cap = (close && opts.finishBottom !== false) ? 1.0 : Math.max(baseCap, 0.92);
      allowBottom = cap >= 0.98;
      axDes = close ? 1250 : 850;
      ayDes = (hy - ly) * 8.5 - pvy * 2.6;
      oppCompX = 1.0;
    } else if (lx > gx - 12) {
      // Between guard peg and pocket, off-line: steer cleanly into mouth, keep driving if contested
      oppCompX = uncontested ? 0 : 0.95;
      if (ly > hy + 8) {
        const tooWide = ly > OUT + 2 && lvx > 20;
        if (uncontested) {
          axDes = tooWide ? -180 : Math.max(-180, Math.min(160, (70 - pvx) * 2.2 * brake));
        } else {
          axDes = tooWide ? -60 : Math.max(-60, (hx - lx) * 4.5 - pvx * 1.1 * brake);
        }
        ayDes = (hy - 10 - ly) * 7.8 - pvy * 2.4;
      } else if (ly < 14 && !opts.noGuard) {
        axDes = Math.min(20, (30 - pvx) * 2.2 * brake);
        ayDes = (hy + 26 - ly) * 9.0 - pvy * 2.0;
      } else {
        if (uncontested) {
          axDes = Math.max(-60, Math.min(280, (155 - pvx) * 2.2 * brake));
        } else {
          axDes = (hx + 15 - lx) * 5.8 - pvx * 0.9 * brake;
        }
        ayDes = (hy + 10 - ly) * 7.8 - pvy * 2.1;
      }
      if (!uncontested && oppLoad > 0.85 && opts.midBottom !== false) { cap = 1.0; allowBottom = true; }
    } else if (lx > 100) {
      // Approaching my guard peg (gx=325, gy=44): clear the top shoulder (gy+30=74) cleanly around ly ~ 88!
      let lty, kpY = 5.6, kdy = 2.0;
      if (ly > 115) {
        lty = hy + 18; kpY = 6.8; kdy = 2.1;
      } else if (ly > 96) {
        lty = gy + 32; kpY = 6.6; kdy = 2.1;
      } else if (lx > 280 && ly > gy + 32) {
        lty = hy + 6; kpY = 6.2; kdy = 2.2;
      } else if (ly < -4) {
        lty = gy + 46; kpY = 6.4; kdy = 1.8;
      } else if (ly < gy - (BALL + PEG) + 4 && lvy < 30 && ly > -4) {
        lty = hy + 10; kpY = 6.0; kdy = 2.1;
      } else {
        lty = gy + 44; kpY = 5.6; kdy = 1.9;
      }
      if (uncontested) {
        const vDes = ly > 94 ? 125 : 195;
        axDes = Math.max(-140, Math.min(260, (vDes - pvx) * 2.2 * brake + pvx * K.DAMP));
      } else {
        const vDes = ly > 104 ? 200 : 410;
        axDes = Math.max(-40, Math.min(920, (vDes - pvx) * 2.2 * brake + 280));
        if (oppLoad > 0.72 && cx < 175 && lvx < 180 && opts.midBottom !== false) { cap = 1.0; allowBottom = true; }
      }
      ayDes = (lty - ly) * kpY - pvy * kdy;
    } else {
      // Midfield / far half: pull toward my half aligned with guard-peg clearance lane; sweep down if trapped high
      const highGutter = ly > 120;
      const lty = highGutter ? hy + 16 : (ly > gy + 50 ? hy + 18 : gy + 44);
      if (uncontested) {
        axDes = Math.max(-40, Math.min(310, (235 - pvx) * 2.2 * brake + pvx * K.DAMP));
      } else {
        axDes = Math.max(180, Math.min(1000, (470 - pvx) * 2.0 * brake + 350));
        if (oppLoad > 0.42 && opts.midBottom !== false) {
          cap = 1.0; allowBottom = true;
        }
      }
      ayDes = (lty - ly) * (highGutter ? 5.8 : 3.8) - pvy * 2.0;
    }

    // Clamp negative forward accel slightly when safely in open board
    if (axDes < 0 && cx < MOUTH - 48 && Math.abs(ly - hy) > mouthHalf + 12 && ly <= OUT + 2) {
      axDes = Math.max(axDes, -60);
    }
    _solveDepths(axDes - axOpp * oppCompX, ayDes - ayOpp * oppCompY, u, v, cap, plan);

    // Before clearing the guard peg (lx < 285), cap downward counter-steer so we don't dive into the guard peg
    if (lx > 40 && lx < 285 && ly < 104 && plan[1] > 0.38 && plan[0] < 0.25) {
      plan[1] = 0.38;
    }

    // Own-goal protection: never fling the marble diagonally across center toward oppOwn by slamming cOpp far
    // deeper than cOwn, and once at/below my pocket on my half, keep cOpp <= cOwn (zero when close/diving).
    if (!opts.noGuard && cx > -60) {
      if (cx > 150 && cy < 6) {
        plan[1] = 0;
      } else if (cx > 85 && cy < 62 && lvy < -20) {
        plan[1] = 0;
      } else if (cx > 40 && cy < hy + 16) {
        if (plan[1] > plan[0]) plan[1] = plan[0];
      } else if (cx > 40 && (cy < 95 || lvy < -40)) {
        const hi = cy > hy + 30;
        const maxDiff = lvy < -75 ? 0 : lvy < -30 ? (hi ? 0.20 : 0.08) : (hi ? 0.50 : 0.32);
        if (plan[1] > plan[0] + maxDiff) plan[1] = plan[0] + maxDiff;
      } else if (cx <= 40 && (cy < 95 || lvy < -40)) {
        const maxDiff = lvy < -95 ? 0 : lvy < -45 ? 0.25 : 0.55;
        if (plan[1] > plan[0] + maxDiff) plan[1] = plan[0] + maxDiff;
      }
    }

    // 4) Near my own end, run a short scratch rollout for sharper levels to finish cleanly & prevent own-goals
    const rolloutT = opts.rollout == null ? 0.40 : opts.rollout;
    if (rolloutT > 0 && cx > (uncontested ? gx - 90 : gx - 65)) {
      const rdt = 1 / 48;
      const steps = Math.max(8, Math.round(rolloutT / rdt));
      const myOwnIdx = g.myOwn.i, oppOwnIdx = g.oppOwn.i;
      const finCap = opts.finishBottom !== false ? 1.0 : Math.max(baseCap, 0.90);
      const steerCap = Math.min(0.84, baseCap);
      const canFinish = allowBottom || (cx > gx - 10 && Math.abs(cy - hy) < mouthHalf + 18 && cy > 8);
      const oppSteerCap = (!opts.noGuard && (cy < hy + 10 || lvy < -105)) ? 0 : (cy > hy + 26 ? steerCap : Math.min(0.60, steerCap));
      // 5 candidates: release, analytical plan, steer own, steer opp (when above pocket), straight finish
      _candOwn[0] = 0;        _candOpp[0] = 0;
      _candOwn[1] = plan[0];  _candOpp[1] = plan[1];
      _candOwn[2] = (cy > hy + 20 && cx > gx) ? Math.min(0.40, steerCap) : steerCap; _candOpp[2] = 0;
      _candOwn[3] = 0;        _candOpp[3] = oppSteerCap;
      _candOwn[4] = canFinish ? finCap : steerCap;
      _candOpp[4] = canFinish ? finCap : 0;

      const cOwn = g.cOwn, cOpp = g.cOpp, mOwn = g.mOwn, mOpp = g.mOpp;
      const oC0 = g.oOwn, oC1 = g.oOpp, om0 = 1 << oC0, om1 = 1 << oC1;
      const opH0 = (opts.oppHold && press[oC0] > 0.55) ? Math.min(0.95, press[oC0]) : 0;
      const opH1 = (opts.oppHold && press[oC1] > 0.55) ? Math.min(0.95, press[oC1]) : 0;
      const hasTimers = !!(s.held && s.up && s.tap);
      let rBest = 1, rBestVal = -1e9;

      for (let k = 0; k < 5; k++) {
        const w0 = _candOwn[k], w1 = _candOpp[k];
        _sc.x = s.x; _sc.y = s.y; _sc.vx = s.vx; _sc.vy = s.vy;
        _sc.press[cOwn] = press[cOwn]; _sc.press[cOpp] = press[cOpp];
        _sc.press[oC0] = press[oC0];   _sc.press[oC1] = press[oC1];
        if (hasTimers) {
          _sc.held[cOwn] = s.held[cOwn]; _sc.up[cOwn] = s.up[cOwn]; _sc.tap[cOwn] = s.tap[cOwn];
          _sc.held[cOpp] = s.held[cOpp]; _sc.up[cOpp] = s.up[cOpp]; _sc.tap[cOpp] = s.tap[cOpp];
          _sc.held[oC0] = 0; _sc.up[oC0] = 0; _sc.tap[oC0] = 0;
          _sc.held[oC1] = 0; _sc.up[oC1] = 0; _sc.tap[oC1] = 0;
        } else {
          _sc.held[0] = _sc.held[1] = _sc.held[2] = _sc.held[3] = 0;
          _sc.up[0] = _sc.up[1] = _sc.up[2] = _sc.up[3] = 0;
          _sc.tap[0] = _sc.tap[1] = _sc.tap[2] = _sc.tap[3] = 0;
        }
        _sc.live = true; _sc.t = 0;

        let scored = -1, hitStep = steps, minOppDist = 1e9;
        for (let i = 0; i < steps; i++) {
          const p0 = _sc.press[cOwn], p1 = _sc.press[cOpp];
          const tapBit = (i & 2) ? 1 : 0; // 2 steps (~42ms) on / 2 steps off holds depth flat
          let mask = 0;
          if (w0 > 0.03) {
            if (w0 >= 0.975 || p0 < w0 - 0.025) mask |= mOwn;
            else if (p0 <= w0 + 0.025 && tapBit) mask |= mOwn;
          }
          if (w1 > 0.03) {
            if (w1 >= 0.975 || p1 < w1 - 0.025) mask |= mOpp;
            else if (p1 <= w1 + 0.025 && tapBit) mask |= mOpp;
          }
          if (opH0 > 0 && (_sc.press[oC0] < opH0 - 0.025 || (_sc.press[oC0] <= opH0 + 0.025 && tapBit))) mask |= om0;
          if (opH1 > 0 && (_sc.press[oC1] < opH1 - 0.025 || (_sc.press[oC1] <= opH1 + 0.025 && tapBit))) mask |= om1;
          const r = step(_sc, mask, rdt);
          if (r >= 0) { scored = r; hitStep = i; break; }
          const od = Math.hypot(_sc.x - g.oppOwn.hx, _sc.y - g.oppOwn.hy);
          if (od < minOppDist) minOppDist = od;
        }

        let val;
        if (scored === myOwnIdx) {
          val = 10000 - hitStep * 25 - (w0 >= K.BOTTOM ? 4 : 0) - (w1 >= K.BOTTOM ? 4 : 0);
        } else if (scored === oppOwnIdx) {
          val = -20000 + hitStep * 10;
        } else {
          const ex = _sc.x * sx, ey = _sc.y * sy;
          const evx = _sc.vx * sx, evy = _sc.vy * sy;
          const inMouth = ex > MOUTH - 20 && Math.abs(ey - hy) < mouthHalf + 5;
          const txE = inMouth ? hx : MOUTH - 34;
          const distGoal = Math.hypot(ex - txE, (ey - hy) * 1.8);
          val = -distGoal + (k === 1 ? 26 : 0);
          if (Math.abs(ey - hy) < mouthHalf + 6 && ex > gx - 10) val += Math.min(evx, 360) * 0.28;
          if (ex > gx && ey < hy + 24 && evy < -130) val += (evy + 130) * 0.7;
          if (minOppDist < 102) val -= (102 - minOppDist) * 82;
          if (ey < 28 && minOppDist < 116) val -= (116 - minOppDist) * 48;
          if (rolloutT >= 0.50 && ex > gx - 80 && ey < 28 && ey > -outerClear && evy < -55) val -= 480;
          if (ex > gx - 35 && ey < 20 && ey > -outerClear && evx > 8) {
            val -= 520 + evx * 1.5;
          }
          if (ex > MOUTH - 52 && ey < 22 && ey > -outerClear) {
            val -= 600 + Math.max(0, evx) * 1.5;
          }
          const fxO = ex + evx * 0.28, fyO = ey + evy * 0.28;
          if (fxO > MOUTH - 40 && fyO < 16 && fyO > -outerClear && evx > 20) {
            val -= 540 + evx * 1.4;
          }
          const fx = ex + evx * 0.16, fy = ey + evy * 0.16;
          if (ex > MOUTH + 2 && Math.abs(ey) > OUT + 8) val -= 420;
          else if (fx > MOUTH + 2 && Math.abs(fy) > OUT + 5 && evx > 25) val -= 300;
          if (ex > gx + 12 && ey > OUT + 4) val -= (ey - (OUT + 4)) * 5.0;
          if (k === 4 && !allowBottom) val -= 22;
          if (k === 0) val += speed < 45 && cy > 0 ? -45 : 6;
        }
        if (val > rBestVal) { rBestVal = val; rBest = k; }
      }
      plan[0] = _candOwn[rBest];
      plan[1] = _candOpp[rBest];
      return finishMask();
    }

    // Basic own-goal guard when rollout is disabled (skipped for gentle so beginners see realistic over-pulls)
    if (!opts.noGuard && lx > gx && ly < 4 && ly > -outerClear && plan[1] > 0.15) {
      if (cx > MOUTH - 38) { plan[0] = 0; plan[1] = 0; }
      else { plan[0] = Math.min(baseCap, Math.max(plan[0], 0.65)); plan[1] = 0; }
    }
    return finishMask();
  }

  /** Computer player presets. Practice uses gentle / person (Classic) / sharp; title attract loop uses demo. */
  const LEVELS = {
    // Slow, forgiving beginner: pushes deep, clumsy near pockets, backs off on player's half
    gentle: {
      delay: 0.28, pred: 0.35, every: 0.145, idle: 0.14, look: 0.19, accPred: 0.16, rollout: 0,
      backOff: -225, defendX: -315, noGuard: true, slip: 0.27, tug: 0.38,
      partialCap: 0.94, finishBottom: true, defBottom: true, midBottom: true,
      tol: 0.135, depthErr: 0.15, tapOn: 0.08, tapOff: 0.12, meterSave: 0,
      hold: [0.53, 0.89], rest: [1.00, 1.30], rescueWall: 0.90, rescueProg: 1.30,
    },
    // Title-screen attract loop: lively, decisive, both colours score
    demo: {
      delay: 0.04, pred: 1.0, every: 0.085, idle: 0.01, look: 0.23, accPred: 0.38, rollout: 0.40,
      defendX: -295, finish: true,
      partialCap: 0.86, finishBottom: true, defBottom: true, midBottom: true,
      tol: 0.048, depthErr: 0.035, tapOn: 0.06, tapOff: 0.12, meterSave: 0,
      hold: [0.60, 0.98], rest: [0.95, 1.32], rescueWall: 0.75, rescueProg: 1.45,
    },
    // Classic practice opponent: plays like a real person (delay >= 0.15s with prediction, imprecise depth, occasional slips)
    person: {
      delay: 0.155, pred: 1.0, every: 0.10, idle: 0.075, look: 0.24, accPred: 0.37, rollout: 0.56,
      defendX: -335, slip: 0, finish: true,
      partialCap: 0.83, finishBottom: true, defBottom: true, midBottom: true,
      tol: 0.07, depthErr: 0.075, tapOn: 0.07, tapOff: 0.115, meterSave: 0,
      hold: [0.54, 0.88], rest: [1.06, 1.38], rescueWall: 0.90, rescueProg: 1.75,
    },
    // Quick, crisp opponent: strong partial-depth finesse, decisive finishes, respects meter
    sharp: {
      delay: 0.035, pred: 1.0, every: 0.08, idle: 0, look: 0.24, accPred: 0.40, rollout: 0.44,
      defendX: -315, finish: true, save: true,
      partialCap: 0.86, finishBottom: true, defBottom: true, midBottom: true,
      tol: 0.03, depthErr: 0.015, tapOn: 0.055, tapOff: 0.12, meterSave: 0.14,
      hold: [0.65, 1.02], rest: [1.02, 1.36], rescueWall: 0.75, rescueProg: 1.45,
    },
  };

  function makeBot(player, level, rand) {
    const o = typeof level === 'object' ? level : LEVELS[level] || LEVELS.gentle;
    rand = rand || Math.random;
    const span = (r) => (r ? r[0] + (r[1] - r[0]) * rand() : 0);
    const g = BOT_GEO[player];
    const side = g.side, cOwn = g.cOwn, cOpp = g.cOpp, hOwn = g.hOwn, hOpp = g.hOpp;
    const oOwn = g.oOwn, oOpp = g.oOpp, mOwn = g.mOwn, mOpp = g.mOpp;
    const tol = o.tol == null ? 0.06 : o.tol;
    const tapOn = o.tapOn == null ? 0.06 : o.tapOn;
    const tapOff = o.tapOff == null ? 0.12 : o.tapOff;
    const depthErr = o.depthErr == null ? 0.04 : o.depthErr;
    const meterSave = o.meterSave == null ? 0 : o.meterSave;
    const predFrac = o.pred == null ? 1.0 : o.pred;
    const rescueWallT = o.rescueWall == null ? 0.95 : o.rescueWall;
    const rescueProgT = o.rescueProg == null ? 1.55 : o.rescueProg;
    const outerClear = OUT + BALL + WALL;
    const hotO = Object.assign({}, o, {
      backOff: null,
      defendX: -285,
      look: 0.28,
      accPred: 0.16,
      rollout: 0,
      partialCap: Math.max(o.partialCap == null ? 0.88 : o.partialCap, 0.95),
      midBottom: false,
      oppHold: true,
      noGuard: true,
      fastUncont: true,
    });
    const contestO = Object.assign({}, o, {
      backOff: null,
      look: o.rollout ? (o.look == null ? 0.24 : o.look) : Math.max(o.look == null ? 0.19 : o.look, 0.28),
      midBottom: false,
      oppHold: true,
    });

    // Small fixed ring buffer for delayed (wOwn, wOpp) plans (zero allocations per step)
    const QLEN = 16;
    const qT = new Float64Array(QLEN);
    const qW0 = new Float64Array(QLEN);
    const qW1 = new Float64Array(QLEN);
    const tmpPlan = [0, 0];

    let now = 0, nextThink = 0, qHead = 0, qTail = 0;
    let want0 = 0, want1 = 0;
    let down0 = 0, tmr0 = 0, sink0 = 0;
    let down1 = 0, tmr1 = 0, sink1 = 0;
    let estE = 1, cooling = false, holdUntil = 0, restUntil = 0, activePush = false;
    let stallX = 0, stallY = 0, stallT = 0, breakUntil = 0, breakW0 = 0, breakW1 = 0;
    let parkT = 0, progX = 0, progY = 0, progT = 0, guardStallT = 0;
    let oppContT = 0, oppBotT = 0, oppMyBotT = 0, oppBlindT = 0, oppSymContT = 0, lastOppBot = -99, oppMashUntil = -99, postRescueUntil = 0, rescueCnt = 0;
    let oppEstE = 1, oppEstTired = false, oppTiredCnt = 0;
    let prevOpp0 = 0, prevOpp1 = 0, oppV0 = 0, oppV1 = 0;
    let rescue = false, rescueT = 0, boostBottom = false, peelUntil = 0;
    let pegX = 0, pegY = 0, pegT = 0, skewUntil = 0, skewSign = 1;

    return {
      level: o,
      reset() {
        now = 0; nextThink = 0.12 + rand() * 0.20;
        qHead = 0; qTail = 0;
        want0 = 0; want1 = 0;
        down0 = 0; tmr0 = 0; sink0 = 0;
        down1 = 0; tmr1 = 0; sink1 = 0;
        estE = 1; cooling = false; holdUntil = 0; restUntil = 0; activePush = false;
        stallX = 0; stallY = 0; stallT = 0; breakUntil = 0; breakW0 = 0; breakW1 = 0;
        parkT = 0; progX = 0; progY = 0; progT = 0; guardStallT = 0;
        oppContT = 0; oppBotT = 0; oppMyBotT = 0; oppBlindT = 0; oppSymContT = 0; lastOppBot = -99; oppMashUntil = -99; postRescueUntil = 0; rescueCnt = 0;
        oppEstE = 1; oppEstTired = false; oppTiredCnt = 0;
        prevOpp0 = 0; prevOpp1 = 0; oppV0 = 0; oppV1 = 0;
        rescue = false; rescueT = 0; boostBottom = false; peelUntil = 0;
        pegX = 0; pegY = 0; pegT = 0; skewUntil = 0; skewSign = 1;
      },
      /** tired: my push meter ran out. A real player has to let go before pushing again, and so does the bot. */
      update(s, dt, tired) {
        now += dt;
        const p0 = s.press[cOwn], p1 = s.press[cOpp];
        const cx = s.x * side, cy = s.y * g.myOwn.v;
        const lvx = s.vx * side;
        const oppP0 = s.press[oOwn], oppP1 = s.press[oOpp];
        const oppSum = oppP0 + oppP1;
        const speed = Math.hypot(s.vx, s.vy);
        if (dt > 0) {
          oppV0 = (oppP0 - prevOpp0) / dt;
          oppV1 = (oppP1 - prevOpp1) / dt;
        }
        prevOpp0 = oppP0; prevOpp1 = oppP1;

        // Detect relentless/mashing opponents (0 false positives on novice/regular/gentle/person/sharp/demo):
        // (1) opponent drains a full push meter (tracked from visible depths) or sustains symmetric dual bottom-out
        // (2) strictly single-lever bottom-out in middle of my half (catches one-hand & random-masher)
        // (3) continuous symmetric dual press (<0.91) > 4.5s (catches pulsing dual-lever masher)
        if (oppSum > 0.35) oppContT += dt;
        else oppContT = 0;
        const dualDrain = GRIP.HOLD / GRIP.BOTH;
        const oppB = (oppP0 >= K.BOTTOM ? 1 : 0) + (oppP1 >= K.BOTTOM ? 1 : 0);
        if (oppEstTired) {
          if (oppP0 < 0.95 && oppP1 < 0.95 && oppV0 <= 0.1 && oppV1 <= 0.1) {
            oppEstE = Math.min(1, oppEstE + dt / GRIP.REFILL);
            if (oppEstE >= GRIP.WAKE) oppEstTired = false;
          }
        } else if (oppB) {
          oppEstE = Math.max(0, oppEstE - (dt * (oppB === 2 ? GRIP.BOTH : 1)) / GRIP.HOLD);
          if (oppEstE <= 0.04) {
            oppEstE = 0; oppEstTired = true; oppTiredCnt++;
            if (oppTiredCnt >= 2 || cx > 45) {
              if (oppMashUntil < now + 35.0) oppMashUntil = now + 35.0;
            }
          }
        } else {
          oppEstE = Math.min(1, oppEstE + dt / GRIP.REFILL);
        }
        const botLim = Math.max(0.65, dualDrain * 0.92);
        const inBotZone = (cx > -155 && cx < 275) || now < oppMashUntil;
        const symBoth = Math.abs(oppP0 - oppP1) < 0.006;
        if (inBotZone && symBoth && oppP0 >= K.BOTTOM && oppP1 >= K.BOTTOM) oppMyBotT = Math.min(botLim + 0.8, oppMyBotT + dt);
        else if (inBotZone && symBoth && oppP0 >= 0.90 && oppP1 >= 0.90) oppMyBotT = Math.max(0, oppMyBotT - dt * 0.15);
        else oppMyBotT = Math.max(0, oppMyBotT - dt * 1.20);
        if (symBoth && oppP0 > 0.25 && oppP1 > 0.25) {
          if (oppP0 < 0.91) oppSymContT += dt;
        } else oppSymContT = 0;
        const oneOnlyBot = Math.min(oppP0, oppP1) < 0.15 && Math.max(oppP0, oppP1) >= K.BOTTOM;
        if (cx > 45 && cx < 250 && oneOnlyBot) oppBlindT = Math.min(2.0, oppBlindT + dt);
        else oppBlindT = Math.max(0, oppBlindT - dt * 0.08);
        if (oppMyBotT > botLim || oppBlindT > 0.65 || oppSymContT > 4.5) {
          if (oppMashUntil < now + 35.0) oppMashUntil = now + 35.0;
        }
        const mashAlert = now < oppMashUntil;
        const alert = oppContT > 4.5 || mashAlert;
        const mashMode = alert || (rescueCnt >= 2 && now < postRescueUntil);
        const hot = alert || now < postRescueUntil;

        // Track own approximate push meter from visible lever depths
        if (tired) {
          estE = 0; cooling = false; activePush = false; boostBottom = false;
        } else {
          const b = (p0 >= K.BOTTOM ? 1 : 0) + (p1 >= K.BOTTOM ? 1 : 0);
          if (b) estE = Math.max(0, estE - (dt * (b === 2 ? GRIP.BOTH : 1)) / GRIP.HOLD);
          else estE = Math.min(1, estE + dt / GRIP.REFILL);
          if (meterSave > 0) {
            if (!cooling && estE < meterSave) cooling = true;
            else if (cooling && estE >= 0.72) cooling = false;
          }
        }

        // Stall-rescue detector: triggers ONLY on opponent's half (cx < -45) so mirror bots can never dual-lock
        const nearMyFar = Math.hypot(s.x - g.myFar.hx, s.y - g.myFar.hy) < K.LIP + 12 ||
          (cx < -285 && cy < -IN && cy > -outerClear && lvx < -15);
        if (nearMyFar) {
          parkT = 0; progT = 0; guardStallT = 0; progX = cx; progY = cy;
          if (rescue) { rescue = false; rescueT = 0; boostBottom = false; peelUntil = 0; }
        } else if (rescue) {
          rescueT += dt;
          if (cx > 140 && Math.abs(cy) > 275 && now >= peelUntil) peelUntil = now + 1.45;
          if (now < peelUntil && Math.abs(cy) < 245) peelUntil = 0;
          const pinnedWall = (Math.abs(cy) > 275 && cx < 240) || now < peelUntil;
          const freeFast = oppSum < 0.35 && cx > -220 && lvx > 270;
          if (!pinnedWall && (cx > 65 || (cx > 0 && lvx > 180) || (cx > -90 && lvx > 250 && oppSum < 0.70) || freeFast)) {
            rescue = false; rescueT = 0; boostBottom = false; peelUntil = 0;
            parkT = 0; progT = 0; guardStallT = 0; progX = cx; progY = cy;
            restUntil = 0; activePush = false;
            qHead = 0; qTail = 0; nextThink = now;
            const win = rescueCnt >= 2 ? 15.0 : 6.0;
            if (postRescueUntil < now + win) postRescueUntil = now + win;
          } else {
            if (Math.hypot(cx - pegX, cy - pegY) > 40) {
              pegX = cx; pegY = cy; pegT = 0;
            } else {
              pegT += dt;
              if (pegT > 0.90 && now >= skewUntil && now >= peelUntil) {
                pegT = 0;
                skewUntil = now + 0.40;
                skewSign = -skewSign;
              }
            }
            const boostFloor = Math.max(0.48, 1 - 0.45 / dualDrain);
            if (oppP0 >= 0.93 && oppP1 >= 0.93 && rescueT > 0.65 && speed < 85 && now >= skewUntil && now >= peelUntil) {
              if (!boostBottom && estE > Math.max(0.78, boostFloor + 0.16)) boostBottom = true;
            }
            if (boostBottom && (estE < boostFloor || oppP0 < 0.91 || oppP1 < 0.91 || lvx > 95 || speed > 130)) {
              boostBottom = false;
            }
          }
        } else {
          const atOppWall = cx < -350 && (Math.abs(cy) > OUT + 2 || (cx < -410 && Math.abs(cy) < IN + 12)) && speed < 155 && lvx < 90;
          if (atOppWall) parkT += dt;
          else if (cx > -290 || lvx > 130) parkT = 0;
          else parkT = Math.max(0, parkT - dt * 1.5);

          const inOppFinish = cx < -200 && cy > -15 && cy < 115;
          if (cx >= -45) {
            progT = 0; guardStallT = 0; progX = cx; progY = cy;
          } else if (Math.abs(cx - progX) > 75) {
            progX = cx; progY = cy; progT = 0; guardStallT = 0;
          } else if (inOppFinish) {
            progT = Math.max(0, progT - dt);
            if (speed < 50 && Math.hypot(cx - progX, cy - progY) < 48) guardStallT += dt;
            else guardStallT = Math.max(0, guardStallT - dt);
          } else if (oppSum > 0.35 || Math.hypot(cx - progX, cy - progY) < 55) {
            progT += dt;
            guardStallT = 0;
          } else {
            progT = Math.max(0, progT - dt * 1.5);
            guardStallT = 0;
          }

          const wallLim = hot ? rescueWallT * 0.65 : rescueWallT;
          const progLim = mashAlert ? Math.min(rescueProgT * 0.65, 0.80) : hot ? rescueProgT * 0.65 : rescueProgT;
          if (cx < -45 && (parkT >= wallLim || progT >= progLim || guardStallT >= 2.4)) {
            rescue = true; rescueT = 0; boostBottom = false; peelUntil = 0; rescueCnt++;
            pegX = cx; pegY = cy; pegT = 0; skewUntil = 0;
            skewSign = cy < 0 ? 1 : -1;
            restUntil = 0; activePush = false; breakUntil = 0;
          }
        }

        // Stalemate detector: if marble stays in a tight radius near my half/midfield, shake things up safely
        if (rescue || cx < -80) {
          stallX = s.x; stallY = s.y; stallT = 0;
        } else if (Math.hypot(s.x - stallX, s.y - stallY) > 62) {
          stallX = s.x; stallY = s.y; stallT = 0;
        } else {
          stallT += dt;
          const stallLim = (cx > 300 && cy > 0 && cy < 110) ? 2.2 : 1.5;
          if (stallT > stallLim && now >= breakUntil) {
            stallT = 0;
            breakUntil = now + 0.75 + rand() * 0.40;
            const r = rand();
            if (cx > 300) {
              if (cx > MOUTH && Math.abs(cy) > OUT) { breakW0 = 0; breakW1 = 0; }
              else if (!o.noGuard && cy < 18) { breakW0 = 0.85; breakW1 = 0; }
              else if (cy > Math.abs(g.myOwn.hy) + 12) { breakW0 = 0; breakW1 = 0.45; }
              else { breakW0 = 0.90; breakW1 = 0.90; }
            } else if (p0 + p1 > 0.70 && r < 0.55) {
              breakW0 = 0; breakW1 = 0;
            } else if (r < 0.78) {
              breakW0 = 1.0; breakW1 = 0;
            } else {
              breakW0 = 0; breakW1 = 1.0;
            }
          }
        }

        // Planner tick (~8-12 Hz)
        if (!rescue && now >= nextThink) {
          const effEvery = mashMode ? Math.min(o.every, 0.08) : o.every;
          nextThink = now + effEvery * (0.75 + rand() * 0.5);
          let w0 = 0, w1 = 0;
          if (now < breakUntil) {
            w0 = breakW0; w1 = breakW1;
          } else if (!(o.idle && !mashMode && rand() < o.idle)) {
            // Forward-predict across reaction delay using only current visible state + my own held mask
            let stateForPlan = s;
            const effPred = mashMode ? 1.0 : predFrac;
            const effDelay = mashAlert ? Math.min(o.delay || 0, 0.06) : (o.delay || 0);
            const predT = effDelay * effPred;
            if (predT >= 0.03) {
              _ps.x = s.x; _ps.y = s.y; _ps.vx = s.vx; _ps.vy = s.vy; _ps.live = true; _ps.t = s.t;
              _ps.press[cOwn] = s.press[cOwn]; _ps.press[cOpp] = s.press[cOpp];
              _ps.press[oOwn] = s.press[oOwn]; _ps.press[oOpp] = s.press[oOpp];
              _ps.held[cOwn] = s.held[cOwn]; _ps.up[cOwn] = s.up[cOwn]; _ps.tap[cOwn] = s.tap[cOwn];
              _ps.held[cOpp] = s.held[cOpp]; _ps.up[cOpp] = s.up[cOpp]; _ps.tap[cOpp] = s.tap[cOpp];
              _ps.held[oOwn] = 0; _ps.up[oOwn] = 0; _ps.tap[oOwn] = 0;
              _ps.held[oOpp] = 0; _ps.up[oOpp] = 0; _ps.tap[oOpp] = 0;
              const nst = Math.max(2, Math.min(8, Math.round(predT * 40)));
              const pdt = predT / nst;
              let simT = now, qi = qHead, pw0 = want0, pw1 = want1;
              for (let j = 0; j < nst && _ps.live; j++) {
                while (qi !== qTail && qT[qi] <= simT) {
                  pw0 = qW0[qi]; pw1 = qW1[qi];
                  qi = (qi + 1) & (QLEN - 1);
                }
                const sw0 = simT < restUntil ? 0 : pw0;
                const sw1 = simT < restUntil ? 0 : pw1;
                const cp0 = _ps.press[cOwn], cp1 = _ps.press[cOpp];
                const tBit = (j & 1) ? 1 : 0;
                let pm = 0;
                if (sw0 > 0.03 && (sw0 >= 0.975 || cp0 < sw0 - 0.025 || (cp0 <= sw0 + 0.025 && tBit))) pm |= mOwn;
                if (sw1 > 0.03 && (sw1 >= 0.975 || cp1 < sw1 - 0.025 || (cp1 <= sw1 + 0.025 && tBit))) pm |= mOpp;
                step(_ps, pm, pdt);
                simT += pdt;
              }
              stateForPlan = _ps;
            }
            const useHot = mashAlert;
            botChoose(player, stateForPlan, useHot ? hotO : mashMode ? contestO : o, tmpPlan);
            w0 = tmpPlan[0]; w1 = tmpPlan[1];
            const lx = s.x * side;
            if ((w0 > 0.05 || w1 > 0.05) && now < 55 && o.tug && lx < 120 && !mashMode && rand() < o.tug) {
              w0 = 1.0; w1 = 1.0; // beginner instinct: yank straight back with both levers
            } else if ((w0 > 0.05 || w1 > 0.05) && now < 55 && o.slip && lx > 180 && !mashMode && rand() < o.slip) {
              w0 = 0; w1 = 0.85; // human mis-steer near own end
            }
            // Add human-like target depth imprecision (canonical own, then opp order for mirror symmetry)
            if (depthErr > 0) {
              const effErr = mashMode ? Math.min(depthErr, 0.02) : depthErr;
              const e0 = (rand() * 2 - 1) * effErr;
              const e1 = (rand() * 2 - 1) * effErr;
              if (w0 > 0.04 && w0 < 0.975) {
                w0 += e0;
                if (w0 < 0) w0 = 0; else if (w0 > 1) w0 = 1;
              }
              if (w1 > 0.04 && w1 < 0.975) {
                w1 += e1;
                if (w1 < 0) w1 = 0; else if (w1 > 1) w1 = 1;
              }
              // Don't let random depth noise flip tilt toward opponent's pocket on my half
              if (!(o.noGuard || useHot) && stateForPlan.x * side > 40 && stateForPlan.y * g.myOwn.v < 65 && w1 > w0) w1 = w0;
            }
          }
          const planDelay = mashAlert ? Math.min(o.delay || 0, 0.06) : (o.delay || 0);
          const dly = planDelay ? planDelay * (0.75 + rand() * 0.5) : 0;
          const nextTail = (qTail + 1) & (QLEN - 1);
          if (nextTail === qHead) qHead = (qHead + 1) & (QLEN - 1);
          qT[qTail] = now + dly;
          qW0[qTail] = w0;
          qW1[qTail] = w1;
          qTail = nextTail;
        }

        // Dequeue matured plans
        while (qHead !== qTail && qT[qHead] <= now) {
          want0 = qW0[qHead];
          want1 = qW1[qHead];
          qHead = (qHead + 1) & (QLEN - 1);
        }

        // Meter rule: when tired, MUST release immediately and stay off until awake + brief human pause
        if (tired) {
          restUntil = Math.max(restUntil, now + (o.rest ? span(o.rest) * 0.35 : 0.14));
          down0 = 0; tmr0 = 0; sink0 = 0;
          down1 = 0; tmr1 = 0; sink1 = 0;
          return 0;
        }

        // Natural human rhythm (hold/breathe cycles), overridden cleanly during stall-rescue
        let tw0 = want0, tw1 = want1;
        if (rescue) {
          if (now < peelUntil) {
            // Peel a marble pinned along a side wall (e.g. by a corner parker) cleanly off the wall into open play
            tw0 = cy > 0 ? 0.0 : 0.95;
            tw1 = cy > 0 ? 0.95 : 0.0;
          } else if (boostBottom || (mashAlert && oppP0 >= K.BOTTOM - 0.02 && oppP1 >= K.BOTTOM - 0.02 && estE > 0.22)) {
            tw0 = 1.0; tw1 = 1.0;
          } else if (now < skewUntil) {
            const dir = (cx > -40 && cy < 30) ? 1 : skewSign;
            tw0 = dir > 0 ? 0.95 : 0.55;
            tw1 = dir > 0 ? 0.55 : 0.95;
          } else if (cx > -120 && cy < 30) {
            // Guide marble safely toward my pocket's side before handing off so it can't drift into oppOwn
            tw0 = 0.95; tw1 = oppSum < 0.65 ? 0.35 : 0.72;
          } else {
            tw0 = 0.95; tw1 = 0.95;
          }
        } else {
          // Punish openings when a relentless/bottoming opponent drops their levers
          const lateOpen = now > 68 && oppSum < 0.15;
          if ((hot && (mashAlert || now < 75) && oppSum < 0.70 || lateOpen) && now < restUntil) restUntil = 0;
          const wantsAny = tw0 > 0.03 || tw1 > 0.03;
          let resting = false;
          if (o.hold) {
            const finishing = (cx > 220 && cy > -12 && cy < 120) || (cx > 110 && lvx > 40 && cy > -35) || (hot && (mashAlert || now < 75) && cx > 35);
            const urgentSave = (mashAlert || now < 75) && (o.save || (alert && !o.noGuard)) && cx < (o.defendX || -265) - 35 && lvx < -110;
            const oppOpen = (hot && (mashAlert || now < 75) && oppSum < 0.70 && cx > -320) || mashAlert || lateOpen;
            if (now < restUntil && !finishing && !urgentSave && !oppOpen) {
              tw0 = 0; tw1 = 0; activePush = false; resting = true;
            } else if (wantsAny && !activePush) {
              holdUntil = now + span(o.hold);
              activePush = true;
            } else if (activePush && !wantsAny) {
              activePush = false;
            } else if (activePush && now > holdUntil && !finishing && !urgentSave && !oppOpen) {
              // If a rally drags on without scoring, take a fuller breather so play breaks open cleanly
              const restMul = now > 70 ? 2.40 : now > 52 ? 1.80 : now > 36 ? 1.28 : 1.0;
              restUntil = now + span(o.rest) * restMul;
              tw0 = 0; tw1 = 0; activePush = false; resting = true;
            }
          } else if (now < restUntil) {
            tw0 = 0; tw1 = 0; resting = true;
          }

          // Against a relentless/bottoming opponent (when not resting), contest opponent's half cleanly without tiring
          if (hot && !resting && !nearMyFar) {
            if (mashAlert && now >= breakUntil && oppP0 >= K.BOTTOM - 0.02 && oppP1 >= K.BOTTOM - 0.02 && estE > 0.22) {
              if (cx < 260) {
                tw0 = 1.0; tw1 = 1.0;
              } else if (tw0 > 0.10 || tw1 > 0.10) {
                if (tw0 >= tw1) { tw0 = 1.0; if (tw1 > 0.45) tw1 = Math.max(tw1, 0.95); }
                else { tw1 = 1.0; if (tw0 > 0.45) tw0 = Math.max(tw0, 0.95); }
              }
            } else if (mashAlert && oppEstTired && now >= breakUntil && estE > 0.45 && cx > 60 && cy > 8 && cy < 95 && tw0 > 0.65 && tw1 > 0.65) {
              tw0 = 1.0; tw1 = 1.0;
            } else if (cx < -110 && oppSum > 0.40 && lvx < 240 && (tw0 > 0.08 || tw1 > 0.08 || ((mashAlert || o.backOff != null) && oppSum > 0.55))) {
              tw0 = Math.max(tw0, 0.95);
              tw1 = Math.max(tw1, 0.95);
            }
            const botSave = mashAlert ? 0.22 : 0.58;
            if (estE < botSave && (tw0 >= 0.975 || tw1 >= 0.975)) {
              const urgentFin = cx > 315 && Math.abs(cy - Math.abs(g.myOwn.hy)) < 36;
              const urgentDef = cx < -325 && lvx < -140;
              if (!urgentFin && !urgentDef) {
                if (tw0 >= 0.975) tw0 = 0.95;
                if (tw1 >= 0.975) tw1 = 0.95;
              }
            }
          }

          // Meter management with hysteresis: when cooling, ease off so meter refills cleanly
          if (cooling && !mashAlert) {
            const coolCap = hot ? 0.94 : 0.40;
            if (tw0 > coolCap) tw0 = coolCap;
            if (tw1 > coolCap) tw1 = coolCap;
          }
        }

        const effTol = rescue ? Math.min(tol, 0.015) : mashAlert ? Math.min(tol, 0.025) : mashMode ? Math.min(tol, 0.03) : tol;

        // Fingers layer: drive lever 0 (own) toward tw0
        if (tw0 <= 0.03) {
          down0 = 0; tmr0 = 0; sink0 = 0;
        } else if (tw0 >= 0.975) {
          down0 = 1; sink0 = 1; tmr0 += dt;
        } else if (p0 >= K.BOTTOM - 0.015) {
          // Never accidentally cross K.BOTTOM when target is partial
          if (down0) { down0 = 0; tmr0 = 0; }
          sink0 = 0; tmr0 += dt;
        } else if (p0 < tw0 - effTol) {
          if (!down0) { down0 = 1; tmr0 = 0; }
          sink0 = 1; tmr0 += dt;
        } else if (p0 > tw0 + effTol) {
          if (down0) { down0 = 0; tmr0 = 0; }
          sink0 = 0; tmr0 += dt;
        } else {
          tmr0 += dt;
          if (down0) {
            if ((sink0 && p0 >= tw0) || (!sink0 && tmr0 >= tapOn)) {
              down0 = 0; tmr0 = 0; sink0 = 0;
            }
          } else if (tmr0 >= tapOff) {
            down0 = 1; tmr0 = 0; sink0 = 0;
          }
        }

        // Fingers layer: drive lever 1 (opp) toward tw1
        if (tw1 <= 0.03) {
          down1 = 0; tmr1 = 0; sink1 = 0;
        } else if (tw1 >= 0.975) {
          down1 = 1; sink1 = 1; tmr1 += dt;
        } else if (p1 >= K.BOTTOM - 0.015) {
          if (down1) { down1 = 0; tmr1 = 0; }
          sink1 = 0; tmr1 += dt;
        } else if (p1 < tw1 - effTol) {
          if (!down1) { down1 = 1; tmr1 = 0; }
          sink1 = 1; tmr1 += dt;
        } else if (p1 > tw1 + effTol) {
          if (down1) { down1 = 0; tmr1 = 0; }
          sink1 = 0; tmr1 += dt;
        } else {
          tmr1 += dt;
          if (down1) {
            if ((sink1 && p1 >= tw1) || (!sink1 && tmr1 >= tapOn)) {
              down1 = 0; tmr1 = 0; sink1 = 0;
            }
          } else if (tmr1 >= tapOff) {
            down1 = 1; tmr1 = 0; sink1 = 0;
          }
        }

        return (down0 ? hOwn : 0) | (down1 ? hOpp : 0);
      },
    };
  }

  /* Push meter. Bottoming out a lever (press >= K.BOTTOM) uses up your push; holding partial depth or letting go
     refills it. When it runs out your levers rest: you have to let go of both, and wait until it's partly back,
     before you can push again. */
  const GRIP = { HOLD: 2.5, BOTH: 1.6, REFILL: 2.0, WAKE: 0.72 };
  /** How many of player p's levers are bottomed out (0, 1, or 2). */
  function bottomed(p, press) {
    if (!press) return 0;
    const c = HAND[p];
    return (press[c[0]] >= K.BOTTOM ? 1 : 0) + (press[c[1]] >= K.BOTTOM ? 1 : 0);
  }
  function makeGrip() {
    return {
      e: { r: 1, b: 1 }, tired: { r: false, b: false },
      reset() { this.e.r = this.e.b = 1; this.tired.r = this.tired.b = false; },
      /** new point: refill energy, but a tired player who is still holding stays tired until they let go */
      serve(hands) {
        this.e.r = this.e.b = 1;
        if (!hands || !hands.r) this.tired.r = false;
        if (!hands || !hands.b) this.tired.b = false;
      },
      bottomed,
      /** hands the player is holding -> hands that actually push (0 while tired) */
      use(p, hands, dt, press) {
        const n = (hands & 1) + ((hands >> 1) & 1);
        if (this.tired[p]) {
          // resting: the meter only refills once the levers are let go, and holding on doesn't re-arm it
          if (!n) {
            this.e[p] = Math.min(1, this.e[p] + dt / GRIP.REFILL);
            if (this.e[p] >= GRIP.WAKE) this.tired[p] = false;
          }
          return 0;
        }
        const b = bottomed(p, press);
        if (b) {
          this.e[p] -= (dt * (b === 2 ? GRIP.BOTH : 1)) / GRIP.HOLD;
          if (this.e[p] <= 0) { this.e[p] = 0; this.tired[p] = true; return 0; }
        } else this.e[p] = Math.min(1, this.e[p] + dt / GRIP.REFILL);
        return hands;
      },
    };
  }

  const API = {
    X, Y, CORNER, BALL, PEG, WALL, HOLE, PEGS, POCKETS, SEGS, CORNERS, OWNER, HAND, K, LEVELS, GRIP,
    create, reset, leverReset, leverPack, leverUnpack, step, partner, depths, slopeAt, slope, tilt, heightAt, easePress, bottomed, maskFor, handsOf, botChoose, makeBot, makeGrip,
  };
  root.OGPhys = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof window !== 'undefined' ? window : globalThis);
