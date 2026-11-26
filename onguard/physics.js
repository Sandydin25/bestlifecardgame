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

  // Levers: one per corner. Holding a lever lifts that corner, so the marble rolls away from it.
  // 0 = top-left, 1 = bottom-left (Red's), 2 = top-right, 3 = bottom-right (Blue's).
  const CORNERS = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
  const OWNER = ['r', 'r', 'b', 'b'];

  const K = {
    G: 1200, // board units / s^2 for one fully lifted corner
    LIFT_UP: 15, LIFT_DOWN: 10, // how fast a corner rises / settles (1/s)
    DAMP: 0.42, ROLL: 24, // rolling losses: proportional (1/s) and constant (units/s^2)
    E_PEG: 0.55, E_WALL: 0.45, E_EDGE: 0.38, // bounciness
    VMAX: 1000, DT: 1 / 240,
    LIP: 24, PULL: 2600, // a marble near the middle of a hole dips toward it
    CATCH: 9, CATCH_SLOW: 15, SLOW: 300,
  };

  function create() {
    return { x: 0, y: 0, vx: 0, vy: 0, lift: [0, 0, 0, 0], live: true, t: 0 };
  }
  function reset(s) {
    s.x = 0; s.y = 0; s.vx = 0; s.vy = 0; s.live = true; s.t = 0;
    return s;
  }

  /** Board slope from the four corner lifts (0..1 each), as the marble's acceleration direction (unscaled). */
  function slope(lift) {
    let ax = 0, ay = 0;
    for (let c = 0; c < 4; c++) { ax -= CORNERS[c][0] * lift[c]; ay -= CORNERS[c][1] * lift[c]; }
    return { ax: ax * Math.SQRT1_2, ay: ay * Math.SQRT1_2 };
  }

  /** Ease the corner lifts toward the held levers (mask bit c = corner c held). */
  function easeLifts(lift, mask, dt) {
    for (let c = 0; c < 4; c++) {
      const want = (mask >> c) & 1;
      const rate = want > lift[c] ? K.LIFT_UP : K.LIFT_DOWN;
      lift[c] += (want - lift[c]) * (1 - Math.exp(-rate * dt));
      if (Math.abs(want - lift[c]) < 1e-4) lift[c] = want;
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
    easeLifts(s.lift, mask, dt);
    if (!s.live) return -1;
    s.t += dt;
    const sl = slope(s.lift);
    s.vx += sl.ax * K.G * dt;
    s.vy += sl.ay * K.G * dt;

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
     Each player's levers only push the marble away from their own end, so steering is choosing between
     "away and to my left", "straight away" and "away and to my right" (or nothing). The bot picks the
     choice that best points the marble at a waypoint for its far pocket, and guards its own end. */
  function botChoose(player, s, opts) {
    opts = opts || {};
    const dir = player === 'r' ? 1 : -1; // which way my levers push in x
    const far = POCKETS.find((p) => p.color === player && p.side === dir); // my pocket at the far end
    const danger = POCKETS.find((p) => p.color !== player && p.side === -dir); // their pocket at my end
    // predicted position a moment ahead (bots, like people, react to where it's going)
    const look = opts.look == null ? 0.18 : opts.look;
    const px = s.x + s.vx * look, py = s.y + s.vy * look;
    const ax = Math.abs(px), onFar = Math.sign(px) === far.side, band = Math.abs(py - far.hy) < 14;
    if (onFar && ax > MOUTH + BALL - 4 && !band) return 0; // tucked beside the pocket: only the other player can free it
    let tx, ty, kp = 7, kd = 2.6;
    if (onFar && ax > 350 && band) { tx = far.hx; ty = far.hy; kd = 0.8; } // lined up with the mouth: go in
    else if (onFar && ax > 350) { tx = far.side * 392; ty = far.hy; } // between the guard peg and the pocket: line up
    else if (onFar && ax > 250) { tx = far.side * 392; ty = far.v * (Math.abs(py) < 44 ? 20 : 104); } // around the guard peg
    else { tx = far.side * 300; ty = far.v * 104; kd = 2; }
    // near my own end and drifting toward their pocket: push it away
    if (Math.sign(px) === danger.side && Math.abs(px) > 240 && Math.abs(py - danger.hy) < 90) { tx = dir * 500; ty = -danger.v * 120; kd = 0; }
    // spring toward the waypoint, damped by the marble's speed (my levers can only push one way, so "brake" = let go)
    const gx = (tx - px) * kp - s.vx * kd * (opts.brake == null ? 1 : opts.brake), gy = (ty - py) * kp - s.vy * kd;
    const gl = Math.hypot(gx, gy);
    if (gl < 60) return 0;
    let best = 0, bestScore = 0.3;
    for (let h = 1; h < 4; h++) {
      const sl = slope(liftOf(maskFor(player, h)));
      const sc = (sl.ax * gx + sl.ay * gy) / (gl * (Math.hypot(sl.ax, sl.ay) || 1));
      if (sc > bestScore) { bestScore = sc; best = h; }
    }
    return best;
  }
  const liftOf = (mask) => [0, 1, 2, 3].map((c) => (mask >> c) & 1);

  /** A bot with human-ish timing: it reacts late, thinks a few times a second, and presses in pulses
      (nobody holds a lever forever), so games keep moving. update() returns its hand mask. */
  const LEVELS = {
    // practice opponent: slow, often idle, short pushes — beatable
    gentle: { delay: 0.45, every: 0.26, idle: 0.38, look: 0.03, hold: [0.25, 0.7], rest: [0.35, 0.9], coast: 300 },
    // the title-screen demo: lively, both sides score
    demo: { delay: 0.16, every: 0.12, idle: 0.08, look: 0.14, hold: [0.35, 1.1], rest: [0.15, 0.5] },
    // test stand-ins for a person
    // also the "Classic" practice opponent
    person: { delay: 0.22, every: 0.12, idle: 0.06, look: 0.12, hold: [0.4, 1.4], rest: [0.1, 0.35] },
    sharp: { delay: 0, every: 0.08, idle: 0, look: 0.18 },
  };
  function makeBot(player, level, rand) {
    const o = typeof level === 'object' ? level : LEVELS[level] || LEVELS.gentle;
    rand = rand || Math.random;
    const span = (r) => (r ? r[0] + (r[1] - r[0]) * rand() : 0);
    let now = 0, nextThink = 0, hands = 0, holdUntil = 0, restUntil = 0, held = 0;
    const queue = [];
    return {
      level: o,
      reset() { now = 0; nextThink = 0.2 + rand() * 0.3; hands = 0; holdUntil = 0; restUntil = 0; held = 0; queue.length = 0; },
      /** tired: my push meter ran out. A real player has to let go before pushing again, and so does the bot. */
      update(s, dt, tired) {
        now += dt;
        if (now >= nextThink) {
          nextThink = now + o.every * (0.7 + rand() * 0.6);
          const pick = o.idle && rand() < o.idle ? 0 : botChoose(player, s, o);
          queue.push([now + o.delay * (0.7 + rand() * 0.6), pick]);
        }
        let want = hands;
        while (queue.length && queue[0][0] <= now) want = queue.shift()[1];
        if (tired) { // let go, and stay off until the meter is back
          if (hands) restUntil = Math.max(restUntil, now + (o.rest ? span(o.rest) : 0.12));
          hands = 0;
          return 0;
        }
        if (o.hold) {
          if (now < restUntil) want = 0;
          else if (want && !hands) { holdUntil = now + span(o.hold); held = want; }
          else if (hands && now > holdUntil) { restUntil = now + span(o.rest); want = 0; }
        } else if (now < restUntil) want = 0;
        hands = want;
        return hands;
      },
    };
  }

  /* Push meter. If both players could hold both levers forever, the board would sit level and nothing
     would ever happen. So holding a lever uses up your push and letting go refills it. When it runs out
     your levers rest: you have to let go of both, and wait until it's partly back, before you can push again. */
  const GRIP = { HOLD: 2.6, BOTH: 1.5, REFILL: 2.4, WAKE: 0.4 };
  function makeGrip() {
    return {
      e: { r: 1, b: 1 }, tired: { r: false, b: false },
      reset() { this.e.r = this.e.b = 1; this.tired.r = this.tired.b = false; },
      /** hands the player is holding -> hands that actually push (0 while tired) */
      use(p, hands, dt) {
        const n = (hands & 1) + ((hands >> 1) & 1);
        if (this.tired[p]) {
          // resting: the meter only refills once the levers are let go, and holding on doesn't re-arm it
          if (!n) {
            this.e[p] = Math.min(1, this.e[p] + dt / GRIP.REFILL);
            if (this.e[p] >= GRIP.WAKE) this.tired[p] = false;
          }
          return 0;
        }
        if (n) {
          this.e[p] -= (dt * (n === 2 ? GRIP.BOTH : 1)) / GRIP.HOLD;
          if (this.e[p] <= 0) { this.e[p] = 0; this.tired[p] = true; return 0; }
        } else this.e[p] = Math.min(1, this.e[p] + dt / GRIP.REFILL);
        return hands;
      },
    };
  }

  const API = {
    X, Y, CORNER, BALL, PEG, WALL, HOLE, PEGS, POCKETS, SEGS, CORNERS, OWNER, HAND, K, LEVELS, GRIP,
    create, reset, step, slope, easeLifts, maskFor, handsOf, botChoose, makeBot, makeGrip,
  };
  root.OGPhys = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof window !== 'undefined' ? window : globalThis);
