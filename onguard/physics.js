/* On Guard — board geometry and marble physics.
   Shared by every mode: the same-phone game, the online host (the only one that simulates online),
   practice mode, and the Node tests in /tmp/og. No DOM in here.

   Board units: the tray floor is 1000 x 680, centered on (0,0); x grows to the right (Blue's end),
   y grows downward. Red sits at the left end (x < 0), Blue at the right end (x > 0).
   Pegs and pockets follow the photos of the original board (22 pegs, two pockets on each end; the originals were green and yellow, here they're red and blue). */
(function (root) {
  'use strict';

  const X = 500, Y = 340, CORNER = 56; // tray floor half-size and its rounded inner corner
  const RIM_X = 538, RIM_Y = 367, RIM_R = 10; // inner top edge of the tray rim (where the cove ends) and rim corner radius
  const COVE_RX = RIM_X - X, COVE_RY = RIM_Y - Y; // horizontal cove run: 38 on short ends, 27 on long sides
  const DISC_R = 114, CUP_R = 27; // clear start disc and centre cup radii (visual)
  const LEVER_Y = 270, LEVER_W = 70; // lever tabs stick out of the short end walls at y = +-LEVER_Y
  const BALL = 19, PEG = 15.5, WALL = 4.5; // marble radius, peg radius, pocket-wall half-thickness
  const HOLE = 15; // drawn radius of the hole in each pocket

  // 22 pegs, mirror-symmetric like the real board
  const PEGS = [];
  const sym = (x, y) => {
    const pts = [[x, y], [-x, y], [x, -y], [-x, -y]];
    pts.forEach(([a, b]) => { if (!PEGS.some((p) => p.x === a && p.y === b)) PEGS.push({ x: a, y: b }); });
  };
  sym(264, 264); // the four outer corners
  sym(0, 220); // top and bottom center
  sym(132, 176);
  sym(264, 132);
  sym(0, 132);
  sym(132, 0); // either side of the starting spot
  sym(305, 38); // the guards, directly in front of each pocket's hole (photo blob centre 309, base about 4 units further in)

  // Pockets: U shapes inset from each end wall (leaving a channel behind them), opening toward the middle.
  // Left end: Red on top, Blue below. Right end: Blue on top, Red below.
  const BACK = 442, MOUTH = 357, OUT = 73.5, IN = 4.5, HOLE_X = 392, HOLE_Y = 38;
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
  // Build pocket walls per end: continuous back wall and inner-arm tip bridge first so the two
  // back-to-back inner arms (at y = +-IN, touching at y = 0) collide as one solid seam-free wall.
  for (const side of [-1, 1]) {
    SEGS.push({ ax: side * BACK, ay: -OUT, bx: side * BACK, by: OUT });
    SEGS.push({ ax: side * MOUTH, ay: -IN, bx: side * MOUTH, by: IN });
    SEGS.push({ ax: side * MOUTH, ay: -OUT, bx: side * BACK, by: -OUT });
    SEGS.push({ ax: side * BACK, ay: -IN, bx: side * MOUTH, by: -IN });
    SEGS.push({ ax: side * MOUTH, ay: OUT, bx: side * BACK, by: OUT });
    SEGS.push({ ax: side * BACK, ay: IN, bx: side * MOUTH, by: IN });
  }

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
    DAMP: 0.46, ROLL: 8, // rolling losses: low steel-on-plastic proportional (1/s) and smooth creep stop (units/s^2)
    E_PEG: 0.68, E_WALL: 0.62, E_EDGE: 0.30, // bounciness: lively hard plastic pegs/walls, low vertical-lip thud on cove
    TANG_LOSS: 0.08, // max tangential impact scrub fraction (scales by cos(theta), so glancing hits lose less)
    V_REST: 18, V_BOUNCE: 55, // resting-contact cutoff and smooth ramp to full restitution (prevents micro-bounce jitter)
    G_COVE: 22000, // effective gravity for rolling steel ball on cove (~GX / 0.08 tilt slope, units/s^2)
    COVE_DAMP: 2.4, // light extra rolling damping while riding the curved cove (1/s)
    COVE_LIMIT: 0.92, // fraction of cove run where the wall becomes nearly vertical (hard clamp + thud)
    VMAX: 1000, DT: 1 / 240,
    LIP: 29, PULL: 2100, // a marble near the middle of a hole dips toward it (covers full pocket back shelf up to d=28.3, stays inside mouth)
    CATCH: 8, CATCH_FAST: 380, CATCH_SLOW: 15, SLOW: 280,
  };

  function create() {
    return {
      x: 0, y: 0, vx: 0, vy: 0,
      press: [0, 0, 0, 0], held: [0, 0, 0, 0], up: [K.LINGER, K.LINGER, K.LINGER, K.LINGER], tap: [0, 0, 0, 0],
      live: true, t: 0, _cove: 0,
    };
  }
  function reset(s) {
    s.x = 0; s.y = 0; s.vx = 0; s.vy = 0; s.live = true; s.t = 0; s._cove = 0;
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
  const _cv = { q: 0, nx: 0, ny: 0, rc: 0, run: 0, lift: 0 };

  /** Height of the cove surface above the flat floor at outward distance t past the floor edge (clamped to t <= rc). */
  function coveSurface(t, rc) {
    if (!(t > 0) || !(rc > 0)) return 0;
    if (t >= rc) return rc;
    return rc - Math.sqrt(rc * rc - t * t);
  }

  /** Cove geometry for a ball centre at (x, y). Fills and returns out = { q, nx, ny, rc, run, lift }.
      On the flat floor (signed distance to rounded rectangle +-X, +-Y, CORNER <= 0): q = 0, lift = 0. */
  function cove(x, y, out) {
    const o = out || { q: 0, nx: 0, ny: 0, rc: 0, run: 0, lift: 0 };
    const ccx = X - CORNER, ccy = Y - CORNER;
    const ax = x < 0 ? -x : x, ay = y < 0 ? -y : y;
    let q = 0, nx = 0, ny = 0;
    if (ax > ccx && ay > ccy) {
      const dx = ax - ccx, dy = ay - ccy;
      const d = Math.hypot(dx, dy);
      if (d > CORNER) {
        q = d - CORNER;
        const inv = 1 / d;
        nx = (x < 0 ? -dx : dx) * inv;
        ny = (y < 0 ? -dy : dy) * inv;
      }
    } else if (ax > X) {
      q = ax - X;
      nx = x < 0 ? -1 : 1;
    } else if (ay > Y) {
      q = ay - Y;
      ny = y < 0 ? -1 : 1;
    }
    if (q > 0) {
      const rc = COVE_RX * nx * nx + COVE_RY * ny * ny;
      const run = rc - BALL;
      const qc = q < run ? q : run;
      o.q = q; o.nx = nx; o.ny = ny; o.rc = rc; o.run = run;
      o.lift = run > 0 ? run - Math.sqrt(Math.max(0, run * run - qc * qc)) : 0;
    } else {
      o.q = 0; o.nx = 0; o.ny = 0; o.rc = 0; o.run = 0; o.lift = 0;
    }
    return o;
  }

  /** Conservative cove restoring kick (exact -grad of U = 0.5 * G_COVE * q^2 / run, including corner Rc variation). */
  function _coveKick(s, cv, dt) {
    const q = cv.q, run = cv.run, nx = cv.nx, ny = cv.ny;
    const an = -K.G_COVE * (q / run);
    let ax = an * nx, ay = an * ny;
    if (nx !== 0 && ny !== 0) {
      // In corners, Rc varies with angle: include tangential -dU/(d*dtheta) so energy is conserved around corners
      const d = CORNER + q;
      const at = K.G_COVE * q * q * (COVE_RY - COVE_RX) * nx * ny / (d * run * run);
      ax += at * (-ny);
      ay += at * nx;
    }
    s.vx += ax * dt;
    s.vy += ay * dt;
  }

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
      const imp = -vn;
      // Smoothly taper restitution to 0 below V_REST so resting / creeping contacts settle without jitter or buzzing
      const eEff = imp <= K.V_REST ? 0 : imp >= K.V_BOUNCE ? e : e * (imp - K.V_REST) / (K.V_BOUNCE - K.V_REST);
      s.vx -= (1 + eEff) * vn * nx;
      s.vy -= (1 + eEff) * vn * ny;
      // Small tangential scrub on impacts (proportional to normal impulse fraction cos(theta), so glancing hits deflect cleanly)
      if (imp > K.V_REST) {
        const tx = -ny, ty = nx, vt = s.vx * tx + s.vy * ty;
        if (vt !== 0) {
          const cosInc = imp / Math.hypot(imp, vt);
          const loss = K.TANG_LOSS * cosInc;
          s.vx -= vt * loss * tx;
          s.vy -= vt * loss * ty;
        }
      }
      if (out && imp > 40) out.push({ k: kind, v: imp });
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
        const damp = Math.exp(-2.2 * dt); s.vx *= damp; s.vy *= damp;
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

    const tx = s.x + s.vx * dt, ty = s.y + s.vy * dt;
    const ccx = X - CORNER, ccy = Y - CORNER;
    const ax0 = s.x < 0 ? -s.x : s.x, ay0 = s.y < 0 ? -s.y : s.y;
    const ax1 = tx < 0 ? -tx : tx, ay1 = ty < 0 ? -ty : ty;
    const nearCove = ax0 > X || ay0 > Y || ax1 > X || ay1 > Y ||
      (ax0 > ccx && ay0 > ccy && cove(s.x, s.y, _cv).q > 0) ||
      (ax1 > ccx && ay1 > ccy && cove(tx, ty, _cv).q > 0);
    if (!nearCove) {
      s._cove = 0;
      s.x = tx;
      s.y = ty;
      collide(s, out);
    } else {
      const nSub = Math.max(4, Math.ceil(dt * 960));
      const sdt = dt / nSub;
      const cdamp = K.COVE_DAMP > 0 ? Math.exp(-K.COVE_DAMP * sdt) : 1;
      for (let sub = 0; sub < nSub; sub++) {
        cove(s.x, s.y, _cv);
        const q0 = _cv.q;
        if (q0 > 0) {
          const vn0 = s.vx * _cv.nx + s.vy * _cv.ny;
          if (vn0 < 0 && q0 + vn0 * sdt <= 0) {
            // Exact split at the floor-edge crossing so leaving the cove never gains energy
            const tHit = Math.min(sdt, -q0 / vn0);
            _coveKick(s, _cv, 0.5 * tHit);
            s.x += s.vx * tHit;
            s.y += s.vy * tHit;
            const rem = sdt - tHit;
            if (rem > 0) {
              s.x += s.vx * rem;
              s.y += s.vy * rem;
            }
            if (K.COVE_DAMP > 0) {
              const cdHit = Math.exp(-K.COVE_DAMP * tHit);
              s.vx *= cdHit; s.vy *= cdHit;
            }
            collide(s, out);
            cove(s.x, s.y, _cv);
            if (_cv.q > 0) {
              const qMax = K.COVE_LIMIT * _cv.run;
              if (_cv.q > qMax) {
                const over = _cv.q - qMax;
                s.x -= _cv.nx * over; s.y -= _cv.ny * over;
                bounce(s, -_cv.nx, -_cv.ny, K.E_EDGE, out, 'edge');
                _cv.q = qMax;
              }
              _coveKick(s, _cv, 0.5 * rem);
            } else {
              s._cove = 0;
            }
            continue;
          }
          _coveKick(s, _cv, 0.5 * sdt);
        }
        s.x += s.vx * sdt;
        s.y += s.vy * sdt;
        collide(s, out);
        cove(s.x, s.y, _cv);
        if (_cv.q > 0) {
          if (!s._cove) {
            s._cove = 1;
            const vOut = s.vx * _cv.nx + s.vy * _cv.ny;
            if (out && vOut > 40) out.push({ k: 'edge', v: vOut });
          }
          const qMax = K.COVE_LIMIT * _cv.run;
          if (_cv.q > qMax) {
            const over = _cv.q - qMax;
            s.x -= _cv.nx * over; s.y -= _cv.ny * over;
            bounce(s, -_cv.nx, -_cv.ny, K.E_EDGE, out, 'edge');
            _cv.q = qMax;
          }
          _coveKick(s, _cv, 0.5 * sdt);
          if (cdamp !== 1) { s.vx *= cdamp; s.vy *= cdamp; }
        } else {
          s._cove = 0;
        }
      }
    }

    const spEnd = Math.hypot(s.vx, s.vy);
    for (const p of POCKETS) {
      const d = Math.hypot(p.hx - s.x, p.hy - s.y);
      if ((d < K.CATCH && spEnd < K.CATCH_FAST) || (d < K.CATCH_SLOW && spEnd < K.SLOW)) {
        s.live = false;
        return p.i;
      }
    }
    return -1;
  }

  function collide(s, out) {
    const R = BALL + PEG, R2 = R * R;
    const W = BALL + WALL, W2 = W * W;
    for (let iter = 0; iter < 4; iter++) {
      let hit = false;
      // pegs
      for (const p of PEGS) {
        const dx = s.x - p.x, dy = s.y - p.y, d2 = dx * dx + dy * dy;
        if (d2 < R2) {
          hit = true;
          const d = Math.sqrt(d2) || 1e-6, nx = dx / d, ny = dy / d;
          s.x = p.x + nx * R; s.y = p.y + ny * R;
          bounce(s, nx, ny, K.E_PEG, iter ? null : out, 'peg');
        }
      }
      // pocket walls (capsules)
      for (const g of SEGS) {
        const ex = g.bx - g.ax, ey = g.by - g.ay, L2 = ex * ex + ey * ey;
        let t = ((s.x - g.ax) * ex + (s.y - g.ay) * ey) / L2;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const cx = g.ax + ex * t, cy = g.ay + ey * t, dx = s.x - cx, dy = s.y - cy, d2 = dx * dx + dy * dy;
        if (d2 < W2) {
          hit = true;
          const d = Math.sqrt(d2) || 1e-6, nx = dx / d, ny = dy / d;
          s.x = cx + nx * W; s.y = cy + ny * W;
          bounce(s, nx, ny, K.E_WALL, iter ? null : out, 'wall');
        }
      }
      if (!hit) break;
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
  const _candOwn = [0, 0, 0, 0, 0, 0, 0];
  const _candOpp = [0, 0, 0, 0, 0, 0, 0];
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
    // On opponent's half (u < 0), our sideways authority (1+u) is weak while dropping the ball-side lever
    // destroys our x-pull along that rail (1+-v -> 2). Limit diff when pulling +x from opponent's half.
    const diffCap = (axNeed > 120 && u < 0.15) ? cap * Math.max(0.18, (1 + u) * 0.70) : cap;
    let diff = ayGain > 80 ? ayNeed / ayGain : 0;
    if (diff > diffCap) diff = diffCap;
    else if (diff < -diffCap) diff = -diffCap;

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
    const maxLx = X + COVE_RX - BALL, maxLy = Y + COVE_RY - BALL;
    if (lx > maxLx) lx = maxLx; else if (lx < -maxLx) lx = -maxLx;
    if (ly > maxLy) ly = maxLy; else if (ly < -maxLy) ly = -maxLy;
    const pvx = lvx + ax0 * look * 0.5 * ac;
    const pvy = lvy + ay0 * look * 0.5 * ac;

    const hx = Math.abs(g.myOwn.hx), hy = Math.abs(g.myOwn.hy);
    const gx = Math.abs(g.guardOwn.x), gy = Math.abs(g.guardOwn.y);
    const mouthHalf = (OUT - IN) * 0.5 - (BALL + WALL);
    const outerClear = OUT + BALL + WALL;
    const backZone = BACK - 10; // inside pocket max ball center is BACK - WALL - BALL (= 418.5); > backZone is behind pocket
    const guardR = BALL + PEG;
    const topClear = gy + guardR;
    const speed = Math.hypot(s.vx, s.vy);

    const finishMask = () =>
      ((plan[0] > 0.04 && (plan[0] >= 0.975 || press[g.cOwn] < plan[0])) ? g.hOwn : 0) |
      ((plan[1] > 0.04 && (plan[1] >= 0.975 || press[g.cOpp] < plan[1])) ? g.hOpp : 0);

    // 1) Marble lining up with MY pocket at opponent's end: leave it alone while it goes in (never if behind back wall)
    const distMyFar = Math.hypot(s.x - g.myFar.hx, s.y - g.myFar.hy);
    if (cx > -backZone && (distMyFar < K.LIP + 8 || (cx < -(gx - 40) && cy < -IN && cy > -outerClear && lvx < -20 && (cx < -MOUTH + 14 || (lx < -(gx + 10) && Math.abs(ly + hy) < mouthHalf + 26))))) {
      plan[0] = 0; plan[1] = 0;
      return 0;
    }

    // 2) Behind or beside the pocket walls at MY end:
    //    - Directly behind the back wall (cx > backZone, |cy| < outerClear + 8): slide sideways out gently so the
    //      lively cove doesn't launch it at 600+ u/s into the far corner; release once already moving out cleanly
    //    - Clear past outer wall or beside the outer arm: release so we don't pin it in the corner / behind the pocket
    //      (if opponent is idle and ball is slow in the corner, nudge it across so it bounces off the cove into play)
    if (cx > backZone) {
      if (Math.abs(cy) < outerClear + 8) {
        const outDir = cy >= 0 ? 1 : -1;
        if (lvy * outDir > 210 && oOwn + oOpp < 0.35) {
          plan[0] = 0; plan[1] = 0;
          return 0;
        }
        const capB = oOwn + oOpp > 0.35 ? Math.min(0.85, opts.partialCap == null ? 0.85 : opts.partialCap) : 0.62;
        if (cy >= 0) { plan[0] = capB; plan[1] = 0; }
        else { plan[0] = 0; plan[1] = capB; }
        return finishMask();
      }
      if (oOwn + oOpp < 0.15 && speed < 175 && lvx > -45) {
        if (cy >= 0) { plan[0] = 0; plan[1] = 0.72; }
        else { plan[0] = 0.72; plan[1] = 0; }
        return finishMask();
      }
      plan[0] = 0; plan[1] = 0;
      return 0;
    }
    if (cx > MOUTH + 2 && (cy > hy + mouthHalf + 10 || cy < -hy - mouthHalf - 10)) {
      if (oOwn + oOpp < 0.15 && speed < 155) {
        if (cy >= 0) { plan[0] = 0; plan[1] = 0.68; }
        else { plan[0] = 0.68; plan[1] = 0; }
        return finishMask();
      }
      plan[0] = 0; plan[1] = 0;
      return 0;
    }

    // 2a) Behind the OPPONENT'S pocket back wall: pulling both levers pins it dead against the back face;
    //     pull asymmetrically with the closer lever so ay slides it around the outer corner into open play.
    if (cx < -backZone && Math.abs(cy) < outerClear + 8) {
      const capB = Math.max(opts.partialCap == null ? 0.88 : opts.partialCap, 0.92);
      if (cy >= 0) { plan[0] = capB; plan[1] = 0; }
      else { plan[0] = 0; plan[1] = capB; }
      return finishMask();
    }

    // 2b) Gentle opponent backs off when the player has worked the marble deep onto the player's half
    //     (still frees stopped marbles and balls stuck behind/beside opponent's pocket walls so play never stalls)
    if (opts.backOff != null && cx < opts.backOff && speed > 38 && !(cx < -(MOUTH - 10) && (Math.abs(cy) > OUT - 6 || cx < -backZone))) {
      plan[0] = 0; plan[1] = 0;
      return 0;
    }

    // 3) Desired local acceleration (axDes, ayDes) and depth cap
    const baseCap = opts.partialCap == null ? 0.88 : opts.partialCap;
    const defendX = opts.defendX == null ? -(gx - 15) : opts.defendX;
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

    let inFunnel = false;
    if (cx > -backZone && lx < defendX && ly > -16 && ly < 120 && (lvx < -40 || lx < defendX - 45)) {
      // Opponent's half and threatening oppFar corridor: pull back decisively
      const urgent = lx < defendX - 55 || lvx < -200 || cx < -(gx + 10);
      if (urgent) { cap = opts.defBottom === false ? baseCap : 1.0; allowBottom = cap >= 0.98; }
      else cap = Math.max(baseCap, 0.92);
      axDes = urgent ? 1050 : 740;
      ayDes = lx < defendX - 85 ? 0 : (-hy * 1.4 - ly) * 2.5 - pvy * 0.8;
      oppCompX = 1.0;
    } else if (!opts.noGuard && ((cx > MOUTH - 55 && (cy < 6 || (cy < 14 && lvy < 25)) && cy > -outerClear) || ((cx > MOUTH - 95 || lx > MOUTH - 70) && cy < 16 && ly < 14 && lvy < 20 && cy > -outerClear && lvx > -25))) {
      // Immediate danger of pulling into opponent's pocket at my end: let go before lever linger drags it in!
      plan[0] = 0; plan[1] = 0;
      return 0;
    } else if (!opts.noGuard && cx > 165 && lvx > 15 && ((cy < 26 && lvy < -40) || (cx < gx - 10 && lvy < -55 && cy + lvy * 0.28 < 8 && cy < 100) || (cx >= gx - 10 && cy < hy - 4 && lvy < -55 && cy + lvy * 0.24 < 6)) && cy > -outerClear) {
      // Marble on my half diving downward across center toward oppOwn (e.g. off guard peg): release immediately!
      plan[0] = 0; plan[1] = 0;
      return 0;
    } else if (!opts.noGuard && ((cx > 185 && cy < 6) || (lx > gx - 75 && ly < 12 && cy < 18 && lvy < 20)) && cy > -outerClear && lvx > 35) {
      // Heading toward opponent's pocket side with forward momentum: release before linger pulls it in
      plan[0] = 0;
      plan[1] = 0;
      return 0;
    } else if (cx > hx + 3 && cx < backZone && Math.abs(cy - hy) < mouthHalf + 18) {
      // Inside my own pocket past the hole: release so it drops back into the hole instead of pinning on the back wall
      plan[0] = 0; plan[1] = 0;
      return 0;
    } else if (cx > gx && Math.abs(pyMouth - hy) < mouthHalf + 8 && Math.abs(cy - hy) < mouthHalf + 18 && Math.abs(lvy) < 210) {
      // Lined up with my own-end pocket mouth: pull straight in decisively
      const close = cx > gx + 10 && Math.abs(cy - hy) < mouthHalf + 12;
      cap = (close && opts.finishBottom !== false) ? 1.0 : Math.max(baseCap, 0.92);
      allowBottom = cap >= 0.98;
      axDes = close ? 1250 : 850;
      ayDes = (hy - ly) * 8.5 - pvy * 2.6;
      oppCompX = 1.0;
    } else if (!opts.noFunnel && cx > gx - 85 && cx < gx + 22 && cy > topClear - 4 && cy < topClear + 48 && lx > gx - 65) {
      // Outer-gap funnel zone (x ~ 224..331, y ~ 68..120): pressing cOpp alone pulls at -55 deg, matching the
      // -53.5 deg outer-gap normal. Bounded at cx < gx + 22 so we never slam a wide ball past the arm tip behind the pocket.
      inFunnel = true;
      const fMax = opts.gentleFunnel ? (typeof opts.gentleFunnel === 'number' ? opts.gentleFunnel : 0.84) : baseCap;
      const funnelCap = uncontested ? Math.min(0.84, fMax) : Math.max(fMax, opts.mashPower ? 0.98 : 0.94);
      if (oppLoad >= 0.35 && lvx < 220 && (lvx < 140 || oppLoad > 0.70)) {
        const cOwnMax = opts.mashPower ? 0.76 : 0.58;
        const cOwnNeed = Math.min(cOwnMax, (oppLoad - 0.25) * 0.48);
        plan[0] = Math.min(cOwnNeed, funnelCap * (opts.mashPower ? 0.78 : 0.62));
        plan[1] = Math.min(1.0, funnelCap + 0.10);
      } else {
        plan[0] = 0;
        plan[1] = funnelCap;
      }
    } else if (lx > gx - 18) {
      // Near/past guard peg, off-line: steer cleanly into the mouth without overshooting into cove/behind pocket
      oppCompX = uncontested ? 0 : 0.95;
      if (ly > hy + 8) {
        const tooWide = ly > OUT - 5 && lvx > 12;
        if (uncontested) {
          axDes = tooWide ? -260 : Math.max(-190, Math.min(135, (95 - pvx) * 2.3 * brake));
        } else {
          axDes = tooWide ? -160 : Math.max(-100, (hx - 20 - lx) * 4.0 - pvx * 1.4 * brake);
        }
        ayDes = (hy - 12 - ly) * 8.4 - pvy * 2.4;
      } else if (ly < 14 && !opts.noGuard) {
        axDes = Math.min(15, (25 - pvx) * 2.3 * brake);
        ayDes = (hy + 26 - ly) * 9.0 - pvy * 2.3;
      } else {
        if (uncontested) {
          axDes = Math.max(-70, Math.min(250, (148 - pvx) * 2.3 * brake));
        } else {
          axDes = (hx + 14 - lx) * 5.4 - pvx * 1.1 * brake;
        }
        ayDes = (hy + 4 - ly) * 7.8 - pvy * 2.4;
      }
      if (!uncontested && oppLoad > 0.90 && opts.midBottom !== false) { cap = 1.0; allowBottom = true; }
    } else if (lx > 100) {
      // Approaching my guard peg (gx, gy): climb cleanly around the guard peg into the outer-gap funnel lane
      let lty, kpY = 5.8, kdy = 2.4;
      const onOppSide = cy < -10 && cx > 120;
      const facingGuard = cx > 165 && cx < gx - 10 && cy > 0 && cy < topClear && lvx > -20;
      if (ly > topClear + 45) {
        lty = hy + 12; kpY = 7.6; kdy = 2.5; // pull smoothly out of wide gutter
      } else if (ly > topClear + 22) {
        lty = topClear + 6; kpY = 6.6; kdy = 2.5;
      } else if (facingGuard) {
        lty = topClear + 14; kpY = 7.4; kdy = 2.1; // clear the front face of the guard peg cleanly
      } else if (ly < -4) {
        lty = topClear + 14; kpY = 7.2; kdy = 2.2;
      } else {
        lty = topClear + 10; kpY = 6.0; kdy = 2.3;
      }
      if (opts.mashSprint && uncontested && cx < 210) {
        const vDes = onOppSide ? 75 : (ly > topClear + 40 ? 120 : ly > topClear + 16 ? 165 : 225);
        axDes = Math.max(-130, Math.min(400, (vDes - pvx) * 2.3 + pvx * K.DAMP + (lvx < 170 ? 110 : 0)));
      } else if (uncontested) {
        const vDes = onOppSide ? 25 : (ly > topClear + 40 ? 80 : ly > topClear + 16 ? 115 : 155);
        axDes = Math.max(-190, Math.min(240, (vDes - pvx) * 2.3 * brake + pvx * K.DAMP));
      } else {
        const vDes = onOppSide ? 95 : (ly > topClear + 40 ? 125 : ly > topClear + 20 ? 165 : 250);
        axDes = Math.max(-90, Math.min(620, (vDes - pvx) * 2.2 * brake + (onOppSide ? 75 : 120)));
        if (oppLoad > 0.90 && cx < 165 && lvx < 140 && opts.midBottom !== false) { cap = 1.0; allowBottom = true; }
      }
      ayDes = (lty - ly) * kpY - pvy * kdy;
    } else {
      // Midfield / far half: pull toward my half aligned with guard-peg lane at controlled speed; sweep out of wide gutters
      const highGutter = ly > topClear + 40;
      const lty = highGutter ? hy + 10 : (ly > topClear + 20 ? hy + 16 : topClear + 10);
      if (opts.mashSprint && uncontested && cx < 140) {
        axDes = Math.max(220, Math.min(700, (285 - pvx) * 2.3 + pvx * K.DAMP));
      } else if (uncontested) {
        axDes = Math.max(-40, Math.min(270, (205 - pvx) * 2.2 * brake + pvx * K.DAMP));
      } else {
        axDes = Math.max(140, Math.min(760, (340 - pvx) * 2.0 * brake + 210));
        if (oppLoad > 0.65 && lvx < 220 && opts.midBottom !== false) {
          cap = 1.0; allowBottom = true;
        }
      }
      ayDes = (lty - ly) * (highGutter ? 7.0 : 4.5) - pvy * 2.4;
    }

    if (!inFunnel) {
      // Clamp negative forward accel slightly when safely in open board
      if (axDes < 0 && cx < MOUTH - 48 && Math.abs(ly - hy) > mouthHalf + 12 && ly <= OUT + 2) {
        axDes = Math.max(axDes, -60);
      }
      let solveCap = cap;
      if (uncontested && axDes < -120 && cx > gx - 10 && (ly > OUT + 14 || ly < -(OUT + 14))) {
        solveCap = Math.min(solveCap, 0.45);
      }
      _solveDepths(axDes - axOpp * oppCompX, ayDes - ayOpp * oppCompY, u, v, solveCap, plan);

      // Before clearing the guard peg (lx < gx - 40), cap downward counter-steer only when below topClear
      if (lx > 40 && lx < gx - 40 && ly < topClear && plan[1] > 0.38 && plan[0] < 0.25) {
        plan[1] = 0.38;
      }

      // Own-goal protection: never fling the marble diagonally across center toward oppOwn by slamming cOpp far
      // deeper than cOwn, while still allowing crisp downward steering from above the guard peg into my own mouth.
      if (!opts.noGuard && cx > -60) {
        if (cx > 150 && cy < 6) {
          plan[1] = 0;
        } else if (cx > 85 && cy < hy + 10 && lvy < -20) {
          plan[1] = 0;
        } else if (cx > 40 && cy < hy + 12) {
          if (plan[1] > plan[0]) plan[1] = plan[0];
        } else if (cx >= gx - 65 && cy >= hy + 18) {
          const maxDiff = lvy < -260 ? 0.20 : lvy < -180 ? 0.65 : 0.95;
          if (plan[1] > plan[0] + maxDiff) plan[1] = plan[0] + maxDiff;
        } else if (cx > 40 && (cy < 95 || lvy < -40)) {
          const hi = cy > hy + 26;
          const maxDiff = lvy < -110 ? 0 : lvy < -45 ? (hi ? 0.40 : 0.10) : (hi ? 0.70 : 0.35);
          if (plan[1] > plan[0] + maxDiff) plan[1] = plan[0] + maxDiff;
        } else if (cx <= 40 && (cy < 95 || lvy < -40)) {
          const maxDiff = lvy < -95 ? 0 : lvy < -45 ? 0.25 : 0.55;
          if (plan[1] > plan[0] + maxDiff) plan[1] = plan[0] + maxDiff;
        }
      }
    }

    // 4) Near my own end, run a short scratch rollout for sharper levels to finish cleanly & prevent own-goals
    const rolloutT = opts.rollout == null ? 0.40 : opts.rollout;
    if (rolloutT > 0 && cx > (uncontested ? gx - 105 : gx - 85)) {
      const rdt = 1 / 48;
      const steps = Math.max(8, Math.round(rolloutT / rdt));
      const myOwnIdx = g.myOwn.i, oppOwnIdx = g.oppOwn.i;
      const finCap = opts.finishBottom !== false ? 1.0 : Math.max(baseCap, 0.90);
      const steerCap = Math.min(0.84, baseCap);
      const canFinish = allowBottom || (cx > gx - 10 && Math.abs(cy - hy) < mouthHalf + 18 && cy > 8);
      const oppSteerCap = (!opts.noGuard && (cy < hy + 10 || (cy < hy + 20 && lvy < -150) || lvy < -240))
        ? 0 : (cy > hy + 20 ? steerCap : Math.min(0.65, steerCap));
      // 7 candidates: release, analytical plan, steer own, steer opp, finish/controlled-approach, contested outer-gap curve, inner-gap curve
      _candOwn[0] = 0;        _candOpp[0] = 0;
      _candOwn[1] = plan[0];  _candOpp[1] = plan[1];
      _candOwn[2] = (cy > hy + 16 && (cx > gx - 35 || lvy > 50)) ? Math.min(0.40, steerCap) : steerCap; _candOpp[2] = 0;
      _candOwn[3] = 0;        _candOpp[3] = oppSteerCap;
      _candOwn[4] = canFinish ? finCap : (cy > topClear - 10 ? 0.20 : 0.55);
      _candOpp[4] = canFinish ? finCap : (cy > topClear - 10 ? Math.min(0.76, oppSteerCap) : 0.55);
      _candOwn[5] = oppSteerCap > 0 ? Math.min(0.42, steerCap * 0.5) : steerCap;
      _candOpp[5] = oppSteerCap > 0 ? Math.min(finCap, oppSteerCap + 0.14) : 0;
      _candOwn[6] = finCap;
      _candOpp[6] = (cy > hy + 6) ? Math.min(0.45, steerCap * 0.5) : 0;

      const cOwn = g.cOwn, cOpp = g.cOpp, mOwn = g.mOwn, mOpp = g.mOpp;
      const oC0 = g.oOwn, oC1 = g.oOpp, om0 = 1 << oC0, om1 = 1 << oC1;
      const opH0 = (opts.oppHold && press[oC0] > 0.55) ? Math.min(1.0, press[oC0]) : 0;
      const opH1 = (opts.oppHold && press[oC1] > 0.55) ? Math.min(1.0, press[oC1]) : 0;
      if (opH0 + opH1 > 1.2) {
        // Against a relentless/holding opponent, include full-depth steering candidates so rollout can both hold x and curve into mouth
        _candOwn[2] = finCap; _candOpp[2] = Math.min(0.65, steerCap);
        _candOwn[3] = oppSteerCap > 0 ? Math.min(0.65, steerCap) : finCap; _candOpp[3] = oppSteerCap > 0 ? finCap : 0;
        _candOwn[4] = finCap; _candOpp[4] = finCap;
        _candOwn[5] = oppSteerCap > 0 ? 0.82 : finCap; _candOpp[5] = oppSteerCap > 0 ? finCap : 0.82;
        _candOwn[6] = finCap; _candOpp[6] = 0.82;
      }
      const hasTimers = !!(s.held && s.up && s.tap);
      let rBest = 1, rBestVal = -1e9;

      for (let k = 0; k < 7; k++) {
        const w0 = _candOwn[k], w1 = _candOpp[k];
        _sc.x = s.x; _sc.y = s.y; _sc.vx = s.vx; _sc.vy = s.vy; _sc._cove = s._cove ? 1 : 0;
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
          // Only measure proximity to oppOwn when actually on the oppOwn side (ey < 18, not separated by the center wall)
          if (_sc.y * sy < 18 && _sc.x * sx < backZone) {
            const od = Math.hypot(_sc.x - g.oppOwn.hx, _sc.y - g.oppOwn.hy);
            if (od < minOppDist) minOppDist = od;
          }
        }

        let val;
        if (scored === myOwnIdx) {
          val = 10000 - hitStep * 25 - (w0 >= K.BOTTOM ? 4 : 0) - (w1 >= K.BOTTOM ? 4 : 0);
        } else if (scored === oppOwnIdx) {
          val = -20000 + hitStep * 10;
        } else {
          const ex = _sc.x * sx, ey = _sc.y * sy;
          const evx = _sc.vx * sx, evy = _sc.vy * sy;
          const inMouth = ex > MOUTH - 20 && ex < backZone && Math.abs(ey - hy) < mouthHalf + 5;
          const txE = inMouth ? hx : MOUTH - 20;
          const distGoal = Math.hypot(ex - txE, (ey - hy) * 1.8);
          val = -distGoal + (k === 1 ? 26 : 0);
          if (Math.abs(ey - hy) < mouthHalf + 6 && ex > gx - 10 && ex < backZone) val += Math.min(evx, 360) * 0.28;
          if (ex > gx && ey < hy + 6 && evy < -110) val += (evy + 110) * 0.8;
          if (minOppDist < 90) val -= (90 - minOppDist) * 82;
          if (ey < 18 && minOppDist < 105) val -= (105 - minOppDist) * 48;
          if (rolloutT >= 0.50 && ex > gx - 80 && ey < 16 && ey > -outerClear && evy < -55) val -= 480;
          if (ex > gx - 35 && ex < backZone && ey < 14 && ey > -outerClear && evx > 8 && evy < 30) {
            val -= 520 + evx * 1.5;
          }
          if (ex > MOUTH - 52 && ex < backZone && ey < 14 && ey > -outerClear && evy < 30) {
            val -= 600 + Math.max(0, evx) * 1.5;
          }
          const fxO = ex + evx * 0.28, fyO = ey + evy * 0.28;
          if (fxO > MOUTH - 40 && fxO < backZone && fyO < 12 && fyO > -outerClear && evx > 20) {
            val -= 540 + evx * 1.4;
          }
          const fx = ex + evx * 0.16, fy = ey + evy * 0.16;
          if (ex > backZone || (ex > MOUTH + 2 && Math.abs(ey) > OUT + 4)) val -= 540;
          else if (fx > backZone || (fx > MOUTH + 2 && Math.abs(fy) > OUT + 2 && evx > 25)) val -= 390;
          if (ex > gx - 30 && ey > OUT + 2) val -= (ey - (OUT + 2)) * 5.2;
          if (ex > gx - 60 && ey > topClear + 8 && evy > 70) val -= (ey - topClear) * 3.0 + (evy - 70) * 1.1;
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
      delay: 0.30, pred: 0.30, every: 0.14, idle: 0.21, look: 0.21, accPred: 0.17, rollout: 0,
      backOff: -35, defendX: -330, noGuard: true, gentleFunnel: 0.76, brake: 0.82, slip: 0.26, tug: 0.34,
      partialCap: 0.89, finishBottom: true, defBottom: true, midBottom: true,
      tol: 0.12, depthErr: 0.14, tapOn: 0.08, tapOff: 0.12, meterSave: 0,
      hold: [0.46, 0.74], rest: [1.18, 1.56], rescueWall: 0.60, rescueProg: 1.15,
    },
    // Title-screen attract loop: lively, decisive, both colours score
    demo: {
      delay: 0.04, pred: 1.0, every: 0.08, idle: 0.01, look: 0.24, accPred: 0.40, rollout: 0.56,
      defendX: -315, finish: true,
      partialCap: 0.88, finishBottom: true, defBottom: true, midBottom: true,
      tol: 0.04, depthErr: 0.03, tapOn: 0.06, tapOff: 0.12, meterSave: 0,
      hold: [0.56, 0.88], rest: [1.18, 1.56], rescueWall: 0.58, rescueProg: 1.20,
    },
    // Classic practice opponent: plays like a real person (delay >= 0.15s with prediction, imprecise depth, occasional slips)
    person: {
      delay: 0.16, pred: 1.0, every: 0.084, idle: 0.022, look: 0.24, accPred: 0.39, rollout: 0.52,
      defendX: -315, slip: 0.025, finish: true,
      partialCap: 0.89, finishBottom: true, defBottom: true, midBottom: true,
      tol: 0.036, depthErr: 0.030, tapOn: 0.058, tapOff: 0.115, meterSave: 0,
      hold: [0.60, 0.90], rest: [1.12, 1.48], rescueWall: 0.60, rescueProg: 1.20,
    },
    // Quick, crisp opponent: strong partial-depth finesse, decisive finishes, respects meter
    sharp: {
      delay: 0.03, pred: 1.0, every: 0.072, idle: 0, look: 0.25, accPred: 0.42, rollout: 0.62,
      defendX: -305, finish: true, save: true,
      partialCap: 0.90, finishBottom: true, defBottom: true, midBottom: true,
      tol: 0.022, depthErr: 0.012, tapOn: 0.055, tapOff: 0.12, meterSave: 0.14,
      hold: [0.64, 0.96], rest: [1.16, 1.54], rescueWall: 0.55, rescueProg: 1.15,
    },
  };

  function makeBot(player, level, rand) {
    const o = typeof level === 'object' ? level : LEVELS[level] || LEVELS.gentle;
    rand = rand || Math.random;
    const span = (r) => (r ? r[0] + (r[1] - r[0]) * rand() : 0);
    const g = BOT_GEO[player];
    const side = g.side, cOwn = g.cOwn, cOpp = g.cOpp, hOwn = g.hOwn, hOpp = g.hOpp;
    const oOwn = g.oOwn, oOpp = g.oOpp, mOwn = g.mOwn, mOpp = g.mOpp;
    const gx = Math.abs(g.guardOwn.x), hy = Math.abs(g.myOwn.hy);
    const topClear = Math.abs(g.guardOwn.y) + BALL + PEG;
    const backZone = BACK - 10;
    const tol = o.tol == null ? 0.06 : o.tol;
    const tapOn = o.tapOn == null ? 0.06 : o.tapOn;
    const tapOff = o.tapOff == null ? 0.12 : o.tapOff;
    const depthErr = o.depthErr == null ? 0.04 : o.depthErr;
    const meterSave = o.meterSave == null ? 0 : o.meterSave;
    const predFrac = o.pred == null ? 1.0 : o.pred;
    const rescueWallT = o.rescueWall == null ? 0.90 : o.rescueWall;
    const rescueProgT = o.rescueProg == null ? 1.50 : o.rescueProg;
    const outerClear = OUT + BALL + WALL;
    const hotO = Object.assign({}, o, {
      backOff: null,
      noFunnel: false,
      gentleFunnel: false,
      mashPower: true,
      defendX: -(gx - 40),
      look: 0.25,
      accPred: 0.35,
      rollout: Math.max(o.rollout || 0, 0.52),
      partialCap: Math.max(o.partialCap == null ? 0.88 : o.partialCap, 0.95),
      midBottom: true,
      oppHold: true,
      noGuard: false,
      fastUncont: true,
    });
    const contestO = Object.assign({}, o, {
      backOff: null,
      noFunnel: false,
      gentleFunnel: false,
      mashPower: true,
      partialCap: Math.max(o.partialCap == null ? 0.88 : o.partialCap, 0.95),
      look: o.rollout ? (o.look == null ? 0.24 : o.look) : Math.max(o.look == null ? 0.19 : o.look, 0.28),
      midBottom: false,
      oppHold: true,
    });
    const mashFinishO = Object.assign({}, contestO, {
      noGuard: false,
      mashSprint: true,
      rollout: o.rollout ? Math.max(o.rollout, 0.54) : 0.48,
      oppHold: false,
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
            if (oppTiredCnt >= (GRIP.HOLD >= 4 ? 1 : 2) || cx > 45) {
              if (oppMashUntil < now + 35.0) oppMashUntil = now + 35.0;
            }
          }
        } else {
          oppEstE = Math.min(1, oppEstE + dt / GRIP.REFILL);
        }
        const botLim = Math.min(1.60, Math.max(0.65, dualDrain * 0.72));
        const inBotZone = (cx > -180 && cx < gx - 45) || now < oppMashUntil;
        const symBoth = Math.abs(oppP0 - oppP1) < 0.006;
        if (inBotZone && symBoth && oppP0 >= K.BOTTOM && oppP1 >= K.BOTTOM) oppMyBotT = Math.min(botLim + 0.8, oppMyBotT + dt);
        else if (inBotZone && symBoth && oppP0 >= 0.90 && oppP1 >= 0.90) oppMyBotT = Math.max(0, oppMyBotT - dt * 0.15);
        else oppMyBotT = Math.max(0, oppMyBotT - dt * 1.20);
        if (symBoth && oppP0 > 0.25 && oppP1 > 0.25) {
          if (oppP0 < 0.91) oppSymContT += dt;
        } else oppSymContT = 0;
        const oneOnlyBot = Math.min(oppP0, oppP1) < 0.15 && Math.max(oppP0, oppP1) >= K.BOTTOM - 0.02;
        if (cx > 45 && cx < 250 && oneOnlyBot) oppBlindT = Math.min(2.0, oppBlindT + dt);
        else oppBlindT = Math.max(0, oppBlindT - dt * 0.08);
        if (oppMyBotT > botLim || oppBlindT > 0.65 || oppSymContT > 3.6) {
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
        const nearMyFar = cx > -backZone && (Math.hypot(s.x - g.myFar.hx, s.y - g.myFar.hy) < K.LIP + 12 ||
          (cx < -(gx - 40) && cy < -IN && cy > -outerClear && lvx < -15));
        if (nearMyFar) {
          parkT = 0; progT = 0; guardStallT = 0; progX = cx; progY = cy;
          if (rescue) { rescue = false; rescueT = 0; boostBottom = false; peelUntil = 0; }
        } else if (rescue) {
          rescueT += dt;
          if (cx > 140 && Math.abs(cy) > 295 && now >= peelUntil) peelUntil = now + 1.45;
          if (now < peelUntil && Math.abs(cy) < 255) peelUntil = 0;
          const pinnedWall = (Math.abs(cy) > 295 && cx < 240) || now < peelUntil;
          const freeFast = oppSum < 0.45 && cx > -240 && lvx > 200;
          if (!pinnedWall && (cx > 25 || (cx > -120 && lvx > 165) || (cx > -180 && lvx > 220 && oppSum < 0.70) || freeFast)) {
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
            const boostHyst = Math.min(0.16, 0.25 / dualDrain);
            if (oppP0 >= 0.93 && oppP1 >= 0.93 && rescueT > 0.65 && speed < 85 && now >= skewUntil && now >= peelUntil) {
              if (!boostBottom && estE > Math.max(0.78, boostFloor + boostHyst)) boostBottom = true;
            }
            if (boostBottom && (estE < boostFloor || oppP0 < 0.91 || oppP1 < 0.91 || lvx > 95 || speed > 130)) {
              boostBottom = false;
            }
          }
        } else {
          const behindOppBack = cx < -backZone && speed < 220;
          const atOppWall = (behindOppBack || (cx < -(MOUTH - 10) && (Math.abs(cy) > OUT + 2 || Math.abs(cy) < IN + 12) && speed < 155)) && lvx < 90;
          if (atOppWall) parkT += dt;
          else if (cx > -(gx - 20) || lvx > 130) parkT = 0;
          else parkT = Math.max(0, parkT - dt * 1.5);

          const inOppFinish = cx < -160 && cx > -backZone && cy > -20 && cy < 150;
          const lateBackOffNow = !mashAlert && ((now > 12 && cx < -30 && cx > -(MOUTH - 10) && Math.abs(cy) < outerClear + 60 && speed > 28) || (now > 18 && cx < -10 && cx > -(MOUTH - 10) && speed > 25) || (now > 26 && cx < -5 && cx > -(MOUTH - 10)));
          const restingNow = (now < restUntil && !mashAlert && !hot) || lateBackOffNow;
          if (cx >= -45) {
            progT = 0; guardStallT = 0; progX = cx; progY = cy;
          } else if (Math.abs(cx - progX) > 75) {
            progX = cx; progY = cy; progT = 0; guardStallT = 0;
          } else if (inOppFinish || (restingNow && speed > 40)) {
            progT = Math.max(0, progT - dt);
            if (speed < 45 && Math.hypot(cx - progX, cy - progY) < 48) guardStallT += dt;
            else guardStallT = Math.max(0, guardStallT - dt);
          } else if (oppSum > 0.35 || Math.hypot(cx - progX, cy - progY) < 55) {
            progT += dt;
            guardStallT = 0;
          } else {
            progT = Math.max(0, progT - dt * 1.5);
            guardStallT = 0;
          }

          const wallLim = behindOppBack ? Math.min(0.45, rescueWallT * 0.55) : (hot ? rescueWallT * 0.65 : rescueWallT);
          const progLim = mashAlert ? Math.min(rescueProgT * 0.65, 0.80) : hot ? rescueProgT * 0.65 : rescueProgT;
          const allowRescue = !restingNow || behindOppBack || guardStallT >= 2.4;
          if (cx < -45 && allowRescue && (parkT >= wallLim || progT >= progLim || guardStallT >= 2.4)) {
            rescue = true; rescueT = 0; boostBottom = false; peelUntil = 0; rescueCnt++;
            pegX = cx; pegY = cy; pegT = 0; skewUntil = 0;
            skewSign = cy < 0 ? 1 : -1;
            restUntil = 0; activePush = false; breakUntil = 0;
          }
        }

        // Stalemate detector: if marble stays in a tight radius near my half/midfield, shake things up safely
        const mashMinE = Math.min(0.22, 0.70 / GRIP.HOLD);
        const mashHold = mashAlert && oppP0 >= K.BOTTOM - 0.02 && oppP1 >= K.BOTTOM - 0.02 && estE > mashMinE;
        if (rescue || cx < -80 || mashHold) {
          stallX = s.x; stallY = s.y; stallT = 0;
        } else if (Math.hypot(s.x - stallX, s.y - stallY) > 62) {
          stallX = s.x; stallY = s.y; stallT = 0;
        } else {
          stallT += dt;
          const stallLim = (cx > gx - 15 && cx < backZone && cy > 0 && cy < 110) ? 2.1 : 1.4;
          if (stallT > stallLim && now >= breakUntil) {
            stallT = 0;
            breakUntil = now + 0.75 + rand() * 0.40;
            const r = rand();
            if (cx > backZone) {
              if (Math.abs(cy) < outerClear + 10) {
                breakW0 = cy >= 0 ? 0.68 : 0;
                breakW1 = cy >= 0 ? 0 : 0.68;
              } else if (oppSum < 0.15) {
                // Solo or idle opponent: nudge ball off the corner cove back into play
                breakW0 = cy >= 0 ? 0 : 0.72;
                breakW1 = cy >= 0 ? 0.72 : 0;
              } else { breakW0 = 0; breakW1 = 0; }
            } else if (cx > gx - 15) {
              if (cx > MOUTH && Math.abs(cy) > OUT) {
                if (oppSum < 0.15) { breakW0 = cy >= 0 ? 0 : 0.70; breakW1 = cy >= 0 ? 0.70 : 0; }
                else { breakW0 = 0; breakW1 = 0; }
              }
              else if (cx > HOLE_X + 3 && Math.abs(cy - hy) < 24) { breakW0 = 0; breakW1 = 0; }
              else if (!o.noGuard && cy < 18) { breakW0 = 0.85; breakW1 = 0; }
              else if (cy > hy + 12) { breakW0 = 0; breakW1 = 0.65; }
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
              _ps.x = s.x; _ps.y = s.y; _ps.vx = s.vx; _ps.vy = s.vy; _ps.live = true; _ps.t = s.t; _ps._cove = s._cove ? 1 : 0;
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
            const oppPressingHard = oppP0 >= 0.80 && oppP1 >= 0.80;
            const useHot = mashAlert && oppPressingHard;
            botChoose(player, stateForPlan, useHot ? hotO : mashAlert ? mashFinishO : mashMode ? contestO : o, tmpPlan);
            w0 = tmpPlan[0]; w1 = tmpPlan[1];
            const lx = s.x * side;
            if ((w0 > 0.05 || w1 > 0.05) && now < 22 && o.tug && lx < 120 && !mashMode && rand() < o.tug) {
              w0 = 1.0; w1 = 1.0; // beginner instinct: yank straight back with both levers
            } else if ((w0 > 0.05 || w1 > 0.05) && now < 22 && o.slip && lx > 180 && !mashMode && rand() < o.slip) {
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
          if (cx < -backZone && Math.abs(cy) < outerClear + 10) {
            // Directly behind opponent's pocket back wall: pull only the closer lever so ay slides it around the corner
            tw0 = cy >= 0 ? 0.95 : 0.0;
            tw1 = cy >= 0 ? 0.0 : 0.95;
          } else if (now < peelUntil) {
            // Peel a marble pinned along a side wall (e.g. by a corner parker) cleanly off the wall into open play
            tw0 = cy > 0 ? 0.0 : 0.95;
            tw1 = cy > 0 ? 0.95 : 0.0;
          } else if (boostBottom || (mashAlert && ((oppP0 >= K.BOTTOM - 0.02 && oppP1 >= K.BOTTOM - 0.02) || (Math.max(oppP0, oppP1) >= 0.92 && cx < -120)) && estE > mashMinE)) {
            tw0 = 1.0; tw1 = 1.0;
          } else if (now < skewUntil) {
            const dir = (cx > -40 && cy < 30) ? 1 : skewSign;
            tw0 = dir > 0 ? 0.95 : 0.55;
            tw1 = dir > 0 ? 0.55 : 0.95;
          } else if (cx > -120 && cy < 30) {
            // Guide marble safely toward my pocket's side before handing off so it can't drift into oppOwn
            tw0 = 0.95; tw1 = oppSum < 0.65 ? 0.35 : 0.72;
          } else if (cx > -120 && cy > 150) {
            // Pull out of wide top gutter toward the funnel lane once on my side of midfield
            tw0 = oppSum < 0.45 ? 0.30 : 0.62; tw1 = 0.95;
          } else if (cx > -120 && cy < -150) {
            tw0 = 0.95; tw1 = oppSum < 0.45 ? 0.30 : 0.62;
          } else {
            tw0 = 0.95; tw1 = 0.91;
          }
        } else {
          // Punish openings when a relentless/bottoming opponent drops their levers
          const lateOpen = now > 18 && cx > -20 && oppSum < 0.20;
          if ((hot && (mashAlert || now < 55) && oppSum < 0.70 || lateOpen) && now < restUntil) restUntil = 0;
          const wantsAny = tw0 > 0.03 || tw1 > 0.03;
          let resting = false;
          const lateBackOff = !mashAlert && ((now > 12 && cx < -30 && cx > -(MOUTH - 10) && Math.abs(cy) < outerClear + 60 && speed > 28) || (now > 18 && cx < -10 && cx > -(MOUTH - 10) && speed > 25) || (now > 26 && cx < -5 && cx > -(MOUTH - 10)));
          if (lateBackOff) {
            tw0 = 0; tw1 = 0; activePush = false; resting = true;
          } else if (o.hold) {
            const behindOwn = cx > backZone && Math.abs(cy) < outerClear + 8;
            const behindOpp = cx < -backZone && Math.abs(cy) < outerClear + 8;
            const finishing = behindOwn || behindOpp || (cx > 50 && cx < backZone && cy > -30 && cy < 170) || (cx > 35 && cx < backZone && lvx > 40 && cy > -40) || (hot && (mashAlert || now < 55) && cx > 30 && cx < backZone);
            const urgentSave = (mashAlert || now < 14) && (o.save || (alert && !o.noGuard)) && cx > -backZone && cx < (o.defendX || -(gx - 15)) - 35 && lvx < -110;
            const oppOpen = (hot && (mashAlert || now < 55) && oppSum < 0.70 && cx > -gx) || mashAlert || lateOpen;
            if (now < restUntil && !finishing && !urgentSave && !oppOpen) {
              tw0 = 0; tw1 = 0; activePush = false; resting = true;
            } else if (wantsAny && !activePush) {
              const holdMul = (!mashAlert && cx < -20) ? (now > 10 ? 0.50 : 0.82) : 1.0;
              holdUntil = now + span(o.hold) * holdMul;
              activePush = true;
            } else if (activePush && !wantsAny) {
              activePush = false;
            } else if (activePush && now > holdUntil && !finishing && !urgentSave && !oppOpen) {
              // If a rally drags on without scoring, the defender takes a fuller breather so the attacker gets a clean shot
              const restMul = cx < 0 ? (now > 14 ? 4.00 : now > 8 ? 2.40 : now > 4 ? 1.55 : 1.15) : (now > 20 ? 1.25 : 1.0);
              restUntil = now + span(o.rest) * restMul;
              tw0 = 0; tw1 = 0; activePush = false; resting = true;
            }
          } else if (now < restUntil) {
            tw0 = 0; tw1 = 0; resting = true;
          }

          // Against a relentless/bottoming opponent (when not resting), contest opponent's half cleanly without tiring
          if (hot && !resting && !nearMyFar) {
            if (cx < -backZone && Math.abs(cy) < outerClear + 8) {
              // Behind opponent's pocket: keep asymmetric single-lever pull so it slides around the wall
              const escCap = (mashAlert && estE > 0.35) ? 1.0 : 0.95;
              tw0 = cy >= 0 ? escCap : 0;
              tw1 = cy >= 0 ? 0 : escCap;
            } else if (mashAlert && now >= breakUntil && oppP0 >= 0.45 && oppP1 >= 0.45 && (cx < gx - 85 || (cx < backZone && lvx < -45))) {
              const oppBot = oppP0 >= K.BOTTOM - 0.02 && oppP1 >= K.BOTTOM - 0.02;
              if (oppBot || (oppP0 >= 0.75 && oppP1 >= 0.75 && lvx < -45)) {
                // Against a bottomed or waking holder/masher: match [1.0, 1.0] promptly so holder can't drag the ball
                // back off our half before tiring!
                if (estE > mashMinE) {
                  if (cx < 40) {
                    tw0 = cy > 210 ? 0.85 : 1.0;
                    tw1 = cy < -180 ? 0.85 : 1.0;
                  } else {
                    tw0 = cy > 140 ? 0.80 : cy > topClear + 24 ? 0.94 : 1.0;
                    tw1 = cy < -80 ? 0.80 : cy < topClear - 12 ? 0.94 : 1.0;
                  }
                } else { tw0 = 0.95; tw1 = 0.95; }
              } else if (oppP0 >= 0.68 && oppP1 >= 0.68) {
                // Sub-bottom relentless masher in midfield/opp half: burst 1.0 to overpower onto our half, then rollout finishes!
                if (estE > 0.24) {
                  tw0 = (cx > -40 && cy > 155) ? 0.62 : cy > topClear + 30 ? 0.88 : 1.0;
                  tw1 = (cx > -40 && cy < -95) ? 0.62 : cy < topClear - 8 ? 0.88 : 1.0;
                } else { tw0 = Math.min(tw0, 0.95); tw1 = Math.min(tw1, 0.95); }
              }
            } else if (mashAlert && now >= breakUntil && Math.max(oppP0, oppP1) >= 0.85 && cx < gx - 85 && (tw0 > 0.10 || tw1 > 0.10)) {
              // Single-lever holder (one-hand / random-masher) in midfield/opp half: pull strongly onto our half
              if (cx < -100) {
                const cCap = estE > 0.35 ? 1.0 : 0.95;
                tw0 = cCap; tw1 = cCap;
              } else if (estE > 0.35) {
                if (tw0 >= tw1) tw0 = 1.0; else tw1 = 1.0;
              }
            } else if (mashAlert && oppEstTired && now >= breakUntil && estE > 0.45 && cx > gx && cx < HOLE_X + 3 && Math.abs(cy - hy) < 28 && tw0 > 0.65 && tw1 > 0.65) {
              tw0 = 1.0; tw1 = 1.0;
            } else if (cx < -110 && cx > -backZone && oppSum > 0.40 && lvx < 240 && (tw0 > 0.08 || tw1 > 0.08 || ((mashAlert || o.backOff != null) && oppSum > 0.55))) {
              tw0 = Math.max(tw0, 0.95);
              tw1 = Math.max(tw1, 0.95);
            }
            const botSave = mashAlert ? mashMinE : 0.58;
            if (estE < botSave && (tw0 >= 0.975 || tw1 >= 0.975)) {
              const urgentFin = cx > gx - 10 && cx < backZone && Math.abs(cy - hy) < 36;
              const urgentDef = cx < -gx && cx > -backZone && lvx < -140;
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
  const GRIP = { HOLD: 5.0, BOTH: 1.6, REFILL: 4.0, WAKE: 0.72 };
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
    X, Y, CORNER, BALL, PEG, WALL, HOLE, BACK, MOUTH, OUT, IN,
    RIM_X, RIM_Y, RIM_R, COVE_RX, COVE_RY, DISC_R, CUP_R, LEVER_Y, LEVER_W,
    PEGS, POCKETS, SEGS, CORNERS, OWNER, HAND, K, LEVELS, GRIP,
    create, reset, leverReset, leverPack, leverUnpack, step, partner, depths, slopeAt, slope, tilt, heightAt, cove, coveSurface, easePress, bottomed, maskFor, handsOf, botChoose, makeBot, makeGrip,
  };
  root.OGPhys = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof window !== 'undefined' ? window : globalThis);
