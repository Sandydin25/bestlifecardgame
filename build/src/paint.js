/* Canvas painters: draw the Best Life cards and box panels into canvases so they
   can be used as WebGL textures. Layout numbers mirror styles.css (1u = 1% of width). */
const BL = window.BL;

const imgCache = new Map();
export function loadImg(src) {
  if (!imgCache.has(src)) {
    const im = new Image();
    im.decoding = 'async';
    im.src = src;
    imgCache.set(src, im.decode().then(() => im));
  }
  return imgCache.get(src);
}

const FONTS = [
  '400 20px Anton', '400 20px "Archivo Black"', 'italic 800 20px Archivo', '700 20px Archivo',
  '500 20px "Asap Condensed"', '600 20px "Asap Condensed"', '700 20px "Asap Condensed"', 'italic 700 20px "Asap Condensed"',
];

export async function preload() {
  await Promise.all(FONTS.map((f) => document.fonts.load(f).catch(() => null)));
  const names = new Set(BL.SETS.map((s) => s.icon).concat(['grin', 'heart', 'apple', 'money']));
  const icons = {}, bgs = {};
  await Promise.all([...names].map(async (n) => (icons[n] = await loadImg(BL.iconURI(n)))));
  await Promise.all(BL.SETS.map(async (s) => (bgs[s.id] = await loadImg(BL.bgURI(s.id)))));
  return { icons, bgs };
}

/* ---------- helpers ---------- */
export function mk(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.round(w);
  c.height = Math.round(h);
  return c;
}
const hasLS = 'letterSpacing' in CanvasRenderingContext2D.prototype;

/** CSS-like baseline for text whose line box starts at `top` (line-height lh). */
function baseline(ctx, top, size, lh = 1) {
  const m = ctx.measureText('Hg');
  const a = m.fontBoundingBoxAscent, d = m.fontBoundingBoxDescent;
  return top + (size * lh - (a + d)) / 2 + a;
}
/** Draw with CSS-style text/box shadows: [[x, y, blur, color], ...] (first = top-most). */
function shadowed(ctx, shadows, draw) {
  for (let i = shadows.length - 1; i >= 0; i--) {
    const [x, y, b, c] = shadows[i];
    ctx.save();
    ctx.shadowColor = c; ctx.shadowOffsetX = x; ctx.shadowOffsetY = y; ctx.shadowBlur = b;
    draw();
    ctx.restore();
  }
  draw();
}
/** centred text with letter spacing (px) */
function spaced(ctx, t, cx, y, sp = 0) {
  if (!sp) { ctx.textAlign = 'center'; ctx.fillText(t, cx, y); return; }
  if (hasLS) {
    ctx.save(); ctx.letterSpacing = sp + 'px'; ctx.textAlign = 'center';
    ctx.fillText(t, cx + sp / 2, y); ctx.restore(); return;
  }
  const chars = [...t], ws = chars.map((ch) => ctx.measureText(ch).width);
  let x = cx - (ws.reduce((a, b) => a + b, 0) + sp * (chars.length - 1)) / 2;
  ctx.save(); ctx.textAlign = 'left';
  chars.forEach((ch, i) => { ctx.fillText(ch, x, y); x += ws[i] + sp; });
  ctx.restore();
}
/** draw an icon like <img> with object-fit: contain inside the box */
function icon(ctx, img, x, y, w, h, sh) {
  const s = Math.min(w, h);
  const dx = x + (w - s) / 2, dy = y + (h - s) / 2;
  if (sh) shadowed(ctx, [sh], () => ctx.drawImage(img, dx, dy, s, s));
  else ctx.drawImage(img, dx, dy, s, s);
}
function wrapBalanced(ctx, text, maxW) {
  const words = text.split(' ');
  const greedy = (w) => {
    const lines = []; let cur = '';
    for (const word of words) {
      const t = cur ? cur + ' ' + word : word;
      if (cur && ctx.measureText(t).width > w) { lines.push(cur); cur = word; } else cur = t;
    }
    if (cur) lines.push(cur);
    return lines;
  };
  const n = greedy(maxW).length;
  let lo = 0, hi = maxW;
  for (let i = 0; i < 18; i++) { const mid = (lo + hi) / 2; if (greedy(mid).length <= n) hi = mid; else lo = mid; }
  return greedy(hi);
}
/** CSS radial-gradient(rx ry at cx cy, stops) */
function radial(ctx, w, h, rx, ry, cx, cy, stops) {
  ctx.save();
  ctx.translate(cx, cy); ctx.scale(rx, ry);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
  stops.forEach(([o, c]) => g.addColorStop(o, c));
  ctx.fillStyle = g;
  ctx.fillRect(-cx / rx, -cy / ry, w / rx, h / ry);
  ctx.restore();
}
/** CSS linear-gradient(angle, stops) */
function linear(ctx, w, h, deg, stops) {
  const a = (deg * Math.PI) / 180;
  const dx = Math.sin(a), dy = -Math.cos(a);
  const len = Math.abs(w * dx) + Math.abs(h * dy);
  const g = ctx.createLinearGradient(w / 2 - (dx * len) / 2, h / 2 - (dy * len) / 2, w / 2 + (dx * len) / 2, h / 2 + (dy * len) / 2);
  stops.forEach(([o, c]) => g.addColorStop(o, c));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

/* ---------- card face ---------- */
const SMALL = { bolt: [5, 1.5, 25, 25], money: [4, 3.4, 26, 22], books: [4, 3.4, 26, 22] };
const LARGE = { bolt: [22, 51, 52, 52], money: [21, 49, 54, 54], shoe: [24, 50, 50, 50] };
const LARGE_MINI = { bolt: [17, 55, 64, 64] };

export function cardFront(A, s, W, mini = false) {
  const H = W * 1.4, u = W / 100;
  const c = mk(W, H), ctx = c.getContext('2d');
  ctx.beginPath(); ctx.roundRect(0, 0, W, H, 5.5 * u); ctx.clip();
  ctx.drawImage(A.bgs[s.id], 0, 0, W, H);
  const ic = A.icons[s.icon];
  const [sx, sy, sw, shh] = SMALL[s.icon] || [6, 3.4, 22, 22];
  icon(ctx, ic, sx * u, sy * u, sw * u, shh * u, [0.9 * u, 1.3 * u, 1 * u, 'rgba(0,0,0,.35)']);
  // title band
  const bx = 7.5 * u, by = 26.5 * u, bw = 80.5 * u, bh = 22.5 * u;
  shadowed(ctx, [[1.4 * u, 1.9 * u, 2.4 * u, 'rgba(0,0,0,.38)']], () => { ctx.fillStyle = '#fcfbf6'; ctx.fillRect(bx, by, bw, bh); });
  ctx.strokeStyle = 'rgba(40,14,14,.55)'; ctx.lineWidth = 0.35 * u;
  ctx.strokeRect(bx + 0.175 * u, by + 0.175 * u, bw - 0.35 * u, bh - 0.35 * u);
  const fs = s.fs * u;
  ctx.font = `400 ${fs}px "Archivo Black"`;
  ctx.fillStyle = s.title;
  spaced(ctx, s.name, bx + bw / 2, baseline(ctx, by + (bh - fs) / 2, fs, 1), s.ls * fs);
  // big icon
  const L = (mini ? LARGE_MINI[s.icon] : LARGE[s.icon]) || (mini ? [19, 58, 58, 58] : [25, 52.5, 45, 45]);
  icon(ctx, ic, L[0] * u, L[1] * u, L[2] * u, L[3] * u, [1.6 * u, 2.4 * u, 1.8 * u, 'rgba(0,0,0,.4)']);
  if (!mini) {
    ctx.fillStyle = '#fff';
    const ls = 6.3 * u;
    ctx.font = `600 ${ls}px "Asap Condensed"`;
    ctx.textAlign = 'left';
    const lb = baseline(ctx, 99 * u, ls, 1);
    shadowed(ctx, [[0.35 * u, 0.45 * u, 0, s.shade], [0, 0, 1.5 * u, 'rgba(0,0,0,.25)']], () => ctx.fillText('Connecting Point', 6.5 * u, lb));
    const qs = 8.4 * u, lh = 1.08;
    ctx.font = `italic 700 ${qs}px "Asap Condensed"`;
    const lines = wrapBalanced(ctx, s.quote, 87 * u);
    let top = 99 * u + ls + 1.8 * u;
    for (const line of lines) {
      const y = baseline(ctx, top, qs, lh);
      shadowed(ctx, [[0.4 * u, 0.55 * u, 0, s.shade], [0.9 * u, 1.2 * u, 1.6 * u, 'rgba(0,0,0,.35)']], () => spaced(ctx, line, 50 * u, y, -0.012 * qs));
      top += qs * lh;
    }
  }
  radial(ctx, W, H, 1.3 * W, 0.95 * H, W / 2, 0.38 * H, [[0.55, 'rgba(0,0,0,0)'], [1, 'rgba(0,0,0,.2)']]);
  ctx.strokeStyle = 'rgba(0,0,0,.22)'; ctx.lineWidth = Math.max(1, 0.4 * u);
  ctx.beginPath(); ctx.roundRect(0, 0, W, H, 5.5 * u); ctx.stroke();
  return c;
}

export function cardBack(A, W) {
  const H = W * 1.4, u = W / 100;
  const c = mk(W, H), ctx = c.getContext('2d');
  ctx.beginPath(); ctx.roundRect(0, 0, W, H, 5.5 * u); ctx.clip();
  radial(ctx, W, H, 1.1 * W, 0.8 * H, W / 2, 0.45 * H, [[0, '#6265b9'], [0.7, '#4f52a5'], [1, '#45489a']]);
  const sh = [0.6 * u, 1 * u, 0.8 * u, 'rgba(0,0,0,.3)'];
  icon(ctx, A.icons.grin, 8 * u, 7 * u, 17 * u, 17 * u, sh);
  icon(ctx, A.icons.heart, 75 * u, 7 * u, 17 * u, 17 * u, sh);
  icon(ctx, A.icons.apple, 8 * u, H - 24 * u, 17 * u, 17 * u, sh);
  icon(ctx, A.icons.money, 72 * u, H - 29 * u, 23 * u, 23 * u, sh);
  const fs = 18 * u, cy = H / 2 - 1.44 * u;
  ctx.font = `400 ${fs}px Anton`;
  const b = baseline(ctx, cy - fs / 2, fs, 1);
  ctx.save();
  ctx.translate(W / 2, cy); ctx.scale(1, 1.32);
  ctx.fillStyle = '#ffe800';
  shadowed(ctx, [[0.5 * u, 0.7 * u, 0, 'rgba(22,20,70,.55)']], () => spaced(ctx, 'BEST LIFE', 0, b - cy, 0.005 * fs));
  ctx.restore();
  ctx.fillStyle = '#fff';
  ctx.font = `700 ${2.6 * u}px Archivo`;
  ctx.textAlign = 'right';
  ctx.fillText('TM', 82 * u, cy + 1.32 * 13.5 * u);
  ctx.strokeStyle = 'rgba(0,0,0,.22)'; ctx.lineWidth = Math.max(1, 0.4 * u);
  ctx.beginPath(); ctx.roundRect(0, 0, W, H, 5.5 * u); ctx.stroke();
  return c;
}

/* ---------- box panels ---------- */
export function boxFront(A, W, H) {
  const u = W / 100;
  const c = mk(W, H), ctx = c.getContext('2d');
  radial(ctx, W, H, 1.2 * W, 0.8 * H, W / 2, 0.38 * H, [[0, '#4a4ba0'], [0.6, '#3a3b8a'], [1, '#2f3079']]);
  const ink = 'rgba(10,10,40,.55)';
  ctx.fillStyle = '#ffe500';
  // GO FOR YOUR
  let fs = 14 * u;
  ctx.font = `400 ${fs}px Anton`;
  let b = baseline(ctx, 6.2 * u, fs, 1);
  ctx.save(); ctx.translate(W / 2, 0); ctx.scale(1.17, 1);
  shadowed(ctx, [[0.7 * u, 0.9 * u, 0, ink]], () => spaced(ctx, 'GO FOR YOUR', 0, b, 0.01 * fs));
  ctx.restore();
  // BEST LIFE
  fs = 23 * u;
  ctx.font = `400 ${fs}px Anton`;
  const top = 22.6 * u;
  b = baseline(ctx, top, fs, 1);
  ctx.save(); ctx.translate(W / 2, top); ctx.scale(1, 1.12);
  shadowed(ctx, [[0.8 * u, 0.9 * u, 0, ink]], () => spaced(ctx, 'BEST LIFE', 0, b - top, 0.005 * fs));
  ctx.restore();
  ctx.fillStyle = '#fff';
  ctx.font = `700 ${2.7 * u}px Archivo`;
  ctx.textAlign = 'left';
  ctx.fillText('TM', 85 * u, baseline(ctx, 46.6 * u, 2.7 * u, 1));
  // tagline
  fs = 7.8 * u;
  ctx.font = `italic 800 ${fs}px Archivo`;
  ['New Fun', 'Game About Life'].forEach((t, i) => {
    const y = baseline(ctx, 51 * u + i * fs * 1.1, fs, 1.1);
    shadowed(ctx, [[0.5 * u, 0.6 * u, 0, ink]], () => spaced(ctx, t, W / 2, y));
  });
  // emoji grid
  const sh = [0.8 * u, 1.4 * u, 1.2 * u, 'rgba(0,0,0,.45)'];
  icon(ctx, A.icons.grin, 26.25 * u, 75 * u, 20 * u, 20 * u, sh);
  icon(ctx, A.icons.heart, 60.75 * u, 75 * u, 20 * u, 20 * u, sh);
  icon(ctx, A.icons.apple, 26.25 * u, 101 * u, 20 * u, 20 * u, sh);
  icon(ctx, A.icons.money, 56.75 * u, 97 * u, 28 * u, 28 * u, sh);
  fs = 6.3 * u;
  ctx.font = `700 ${fs}px Archivo`;
  shadowed(ctx, [[0.4 * u, 0.5 * u, 0, 'rgba(10,10,40,.5)']], () => spaced(ctx, '2 - 6 Players • Ages 7 to 107', W / 2, baseline(ctx, 126 * u, fs, 1)));
  ctx.strokeStyle = 'rgba(255,255,255,.07)'; ctx.lineWidth = u * 0.6; ctx.strokeRect(0, 0, W, H);
  return c;
}

export function boxBack(A, W, H, fanCards) {
  const u = W / 100;
  const c = mk(W, H), ctx = c.getContext('2d');
  linear(ctx, W, H, 160, [[0, '#f5f5f6'], [0.55, '#dcdcdf'], [1, '#eaeaec']]);
  // thumb notch
  ctx.save();
  ctx.beginPath(); ctx.arc(48 * u, 0, 13 * u, 0, Math.PI); ctx.clip();
  radial(ctx, W, H, 13 * u, 13 * u, 48 * u, 5 * u, [[0, '#5658aa'], [1, '#34367f']]);
  ctx.restore();
  // fan of cards
  const fan = [['food', 30, 4, -14], ['family', 8, 22, -22], ['goals', 33, 37, 8], ['friends', 4, 56, -16], ['money', 21, 64, 7]];
  const cw = 35 * u, ch = cw * 1.4;
  for (const [id, x, y, rot] of fan) {
    const cx = 3 * u + (x / 100) * 70 * u + cw / 2, cy = 13 * u + (y / 100) * 120 * u + ch / 2;
    ctx.save();
    ctx.translate(cx, cy); ctx.rotate((rot * Math.PI) / 180);
    shadowed(ctx, [[0.35 * u, 0.7 * u, 1.4 * u, 'rgba(0,0,0,.35)']], () => ctx.drawImage(fanCards[id], -cw / 2, -ch / 2, cw, ch));
    ctx.restore();
  }
  // feature list
  const cx = 77 * u;
  let fs = 13.5 * u;
  ctx.font = `italic 400 ${fs}px Anton`;
  const blockTop = 9 * u, blockH = 2 * fs * 0.95;
  ctx.save();
  ctx.translate(cx, blockTop + blockH / 2);
  ctx.transform(1, 0, Math.tan((-8 * Math.PI) / 180), 1.1, 0, 0);
  ['BEST', 'LIFE'].forEach((t, i) => {
    const y = baseline(ctx, -blockH / 2 + i * fs * 0.95, fs, 0.95);
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#111'; ctx.lineWidth = 0.5 * u;
    shadowed(ctx, [[0.6 * u, 0.8 * u, 0, 'rgba(0,0,0,.25)']], () => { ctx.textAlign = 'center'; ctx.strokeText(t, 0, y); });
    ctx.fillStyle = '#ffe500';
    spaced(ctx, t, 0, y, 0.02 * fs);
  });
  ctx.restore();
  fs = 7.3 * u;
  ctx.font = `700 ${fs}px "Asap Condensed"`;
  ctx.fillStyle = '#141414';
  let top = blockTop + blockH + 5 * u;
  for (const p of [['52 Different', 'Interesting', 'Fun Cards'], ['12 Sets'], ['Rules', 'of Play'], ['Ask', 'to Win!']]) {
    for (const line of p) { spaced(ctx, line, cx, baseline(ctx, top, fs, 1.02), -0.01 * fs); top += fs * 1.02; }
    top += 4.2 * u;
  }
  return c;
}

export function boxSide(W, D, H, which) {
  const c = mk(D, H), ctx = c.getContext('2d');
  linear(ctx, D, H, 90, [[0, '#2c2d72'], [0.3, '#3a3b8a'], [0.7, '#3a3b8a'], [1, '#2c2d72']]);
  const fs = 0.4 * D;
  ctx.save();
  ctx.translate(D / 2, H / 2);
  ctx.rotate(which === 'right' ? -Math.PI / 2 : Math.PI / 2);
  ctx.font = which === 'right' ? `700 ${fs}px "Asap Condensed"` : `600 ${fs}px "Asap Condensed"`;
  ctx.fillStyle = which === 'right' ? '#ffffff' : '#f2ead2';
  ctx.textBaseline = 'middle';
  spaced(ctx, which === 'right' ? '+48 Connecting Points' : '52 Playing Cards', 0, fs * 0.04, 0.01 * fs);
  ctx.restore();
  return c;
}

export function boxEnd(W, D, which) {
  const u = W / 100;
  const c = mk(W, D), ctx = c.getContext('2d');
  linear(ctx, W, D, 180, [[0, '#34357f'], [0.4, '#3d3e8f'], [1, '#2f3078']]);
  if (which === 'top') {
    const fs = 14 * u;
    ctx.font = `400 ${fs}px Anton`;
    ctx.fillStyle = '#ffe500';
    const b = baseline(ctx, D / 2 - fs / 2, fs, 1);
    ctx.save(); ctx.translate(W / 2, D / 2); ctx.scale(1, 1.15);
    spaced(ctx, 'GOLD EDITION', 0, b - D / 2, 0);
    ctx.restore();
  } else {
    const fs = 9.6 * u, fs2 = 3.3 * u, gap = 1.8 * u;
    const blockH = fs + gap + fs2, top = D / 2 - blockH / 2;
    ctx.font = `400 ${fs}px Anton`;
    ctx.fillStyle = '#f6edcf';
    spaced(ctx, 'Best Selling Games', W / 2, baseline(ctx, top, fs, 1), 0.015 * fs);
    ctx.font = `500 ${fs2}px "Asap Condensed"`;
    ctx.fillStyle = '#e8e0c8';
    spaced(ctx, '© 2026 SFK AND ASSOCIATES LLC', W / 2, baseline(ctx, top + fs + gap, fs2, 1), 0.05 * fs2);
  }
  return c;
}

export function flat(w, h, stops, deg = 180) {
  const c = mk(w, h), ctx = c.getContext('2d');
  linear(ctx, w, h, deg, stops);
  return c;
}

export function blob(size) {
  const c = mk(size, size), ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(8,8,40,.62)');
  g.addColorStop(0.45, 'rgba(8,8,40,.32)');
  g.addColorStop(1, 'rgba(8,8,40,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return c;
}
