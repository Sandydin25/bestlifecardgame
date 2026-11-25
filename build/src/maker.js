/* Best Life — "Make your own card": paints the card (same painter as the 3D box) onto a
   picture people can save or text. Bundled to js/maker.js, loaded only when the maker opens. */
import * as P from './paint.js';

const BL = window.BL;
let A = null;

BL.paintPoster = async (s) => {
  if (!A) A = await P.preload();
  const W = 1080, H = 1350;
  const c = P.mk(W, H), ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(W / 2, H * 0.4, 40, W / 2, H * 0.45, H * 0.85);
  g.addColorStop(0, '#5b5dc2');
  g.addColorStop(0.55, '#34358c');
  g.addColorStop(1, '#1c1d5e');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  const cw = 700, card = P.cardFront(A, s, cw);
  ctx.save();
  ctx.translate(W / 2, 600);
  ctx.rotate(-0.035);
  ctx.shadowColor = 'rgba(0,0,0,.45)';
  ctx.shadowBlur = 50;
  ctx.shadowOffsetY = 26;
  ctx.drawImage(card, -cw / 2, (-cw * 1.4) / 2);
  ctx.restore();
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffe31a';
  ctx.font = '400 66px Anton';
  ctx.fillText('MY BEST LIFE CARD', W / 2, 1218);
  ctx.fillStyle = 'rgba(255,255,255,.78)';
  ctx.font = '700 30px Archivo';
  ctx.fillText('Make yours at bestlifecards.com', W / 2, 1278);
  return c;
};
