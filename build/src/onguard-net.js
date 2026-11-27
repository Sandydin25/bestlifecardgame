/* On Guard — online play over Firebase Realtime Database (same project and rules as Best Life).
   Bundled to best-life/onguard/net.js with `npm run build:onguard`, and loaded only when someone opens online play.

   The host runs the marble physics; the guest only sends their levers and draws what the host sends.
     codes/<CODE>                 = host uid (claims the 4-letter code; only the host can delete it)
     rooms/<CODE>/meta            = { kind: 'onguard', host, guest, status: lobby|playing, games, series: { r, b }, created, v }
     rooms/<CODE>/players/<uid>   = { name, joined, online, lv (guest's levers, 0-3), rd (ready for game n), rm (rematch for game n) }
     rooms/<CODE>/state           = marble, levers, phase and score, written by the host ~30 times a second */
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { getDatabase, ref, get, set, update, remove, onValue, onDisconnect } from 'firebase/database';

const CODE_ABC = 'ABCDEFGHJKMNPQRSTUVWXYZ'; // no I, L, O (easy to misread)
const V = 8; // protocol / mechanics version: old and new clients must never pair
let app = null, auth = null, db = null, uid = null, signing = null;
let room = null, takenRoom = null;
let skew = 0; // server clock minus this device's clock (ms), so two devices can compare timestamps

function ready() {
  if (uid) return Promise.resolve(uid);
  if (signing) return signing;
  const cfg = window.BL_FIREBASE;
  if (!cfg || !cfg.apiKey) return Promise.reject(new Error('Online play isn’t switched on yet.'));
  if (!app) { // set up once; a retry after a failed sign-in reuses it
    app = initializeApp(cfg, 'onguard');
    auth = getAuth(app);
    db = getDatabase(app);
    onValue(ref(db, '.info/serverTimeOffset'), (s) => { const v = +s.val(); if (isFinite(v)) skew = v; });
  }
  signing = new Promise((res, rej) => {
    let off = () => {};
    const done = (err) => { clearTimeout(t); off(); if (err) rej(err); else res(uid); };
    const t = setTimeout(() => done(new Error('Can’t reach the game server. Check your internet connection.')), 15000);
    off = onAuthStateChanged(auth, (u) => { if (u) { uid = u.uid; done(); } }, (e) => done(e));
    signInAnonymously(auth).catch((e) => done(e));
  });
  signing.catch(() => { signing = null; });
  return signing;
}
const rref = (p) => ref(db, `rooms/${room.code}${p ? '/' + p : ''}`);
const clean = (x) => JSON.parse(JSON.stringify(x));
const stopped = () => Object.assign(new Error('cancelled'), { cancelled: true });
const gone = (tok) => !!(tok && tok.cancelled);
const genHs = () => Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6);
const named = (p) => !!(p && typeof p === 'object' && typeof p.name === 'string' && p.name);
const jTime = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : Number.MAX_SAFE_INTEGER);
/** who gets the one guest seat when two people join at once: the earlier joiner, then the lower id */
const before = (a, b) => (jTime(a.joined) - jTime(b.joined)) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** tok: { cancelled } — set it to back out; anything already made is cleaned up and the promise rejects. */
async function create(name, tok) {
  await ready();
  if (gone(tok)) throw stopped();
  leave(true);
  let code = null;
  for (let i = 0; i < 12 && !code; i++) {
    const c = Array.from({ length: 4 }, () => CODE_ABC[Math.floor(Math.random() * CODE_ABC.length)]).join('');
    try { await set(ref(db, `codes/${c}`), uid); code = c; } catch (e) { /* taken: try another */ }
    if (gone(tok)) { if (code) remove(ref(db, `codes/${code}`)).catch(() => {}); throw stopped(); }
  }
  if (!code) throw new Error('Couldn’t make a join code. Please try again.');
  const now = Date.now(), hs = genHs();
  const onRef = ref(db, `rooms/${code}/players/${uid}/online`);
  const drop = () => onDisconnect(onRef).cancel().catch(() => {}).then(() => remove(ref(db, `rooms/${code}`))).catch(() => {}).then(() => remove(ref(db, `codes/${code}`))).catch(() => {});
  try {
    await onDisconnect(onRef).set(false);
    if (gone(tok)) { drop(); throw stopped(); }
    await set(ref(db, `rooms/${code}`), clean({
      meta: { kind: 'onguard', host: uid, status: 'lobby', created: now, v: V, hs },
      players: { [uid]: { name, joined: now, online: true } },
    }));
  } catch (e) { if (!e || !e.cancelled) drop(); throw e; }
  if (gone(tok)) { drop(); throw stopped(); }
  if (window.BL && window.BL.stats) window.BL.stats.hit('og_onlineRooms');
  return enter(code, true, hs);
}

async function join(code, name, tok) {
  await ready();
  if (gone(tok)) throw stopped();
  leave(true);
  code = String(code || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
  if (code.length !== 4) throw new Error('The join code is 4 letters, like ABCD.');
  const metaSnap = await get(ref(db, `rooms/${code}/meta`)).catch(() => null);
  if (!metaSnap || !metaSnap.exists()) throw new Error(`There’s no game with the code ${code}. Check the letters and try again.`);
  const meta = metaSnap.val() || {};
  if (meta.kind !== 'onguard') throw new Error(`The code ${code} is for a different game. Check the letters and try again.`);
  if (meta.v !== V) throw new Error('That game was started on an older version of On Guard. Ask the host to reload the page and start a new game.');
  const hostSnap = await get(ref(db, `codes/${code}`));
  if (gone(tok)) throw stopped();
  const onRef = ref(db, `rooms/${code}/players/${uid}/online`);
  if (hostSnap.val() === uid) { // the host coming back (after a reload)
    const hs = genHs();
    await onDisconnect(onRef).set(false);
    if (gone(tok)) { onDisconnect(onRef).cancel().catch(() => {}); throw stopped(); }
    await update(ref(db, `rooms/${code}/meta`), { hs });
    if (gone(tok)) { onDisconnect(onRef).cancel().catch(() => {}); throw stopped(); }
    await update(ref(db, `rooms/${code}/players/${uid}`), { online: true });
    if (gone(tok)) { onDisconnect(onRef).cancel().catch(() => {}); throw stopped(); }
    return enter(code, true, hs);
  }
  const mineRef = ref(db, `rooms/${code}/players/${uid}`);
  const rivals = (players, m) => Object.keys(players)
    .filter((p) => p !== uid && p !== m.host && named(players[p]) && players[p].v === V && players[p].online !== false)
    .map((id) => ({ id, joined: jTime(players[id].joined) }));
  const players = (await get(ref(db, `rooms/${code}/players`))).val() || {};
  const mine = named(players[uid]);
  if (meta.guest && meta.guest !== uid) throw new Error('That game already has two players.');
  if (meta.guest !== uid && rivals(players, meta).length) throw new Error('Someone else just joined that game. Ask for a new code.');
  if (gone(tok)) throw stopped();
  const joined = (mine && typeof players[uid].joined === 'number' && Number.isFinite(players[uid].joined)) ? players[uid].joined : Date.now();
  await onDisconnect(onRef).set(false);
  if (gone(tok)) { onDisconnect(onRef).cancel().catch(() => {}); throw stopped(); }
  await update(mineRef, mine ? { online: true, lv: 0, v: V } : { name, joined, online: true, lv: 0, v: V });
  // two people can pass the checks above at the same moment, so look again now that I'm on the list
  const [m2s, p2s] = await Promise.all([get(ref(db, `rooms/${code}/meta`)), get(ref(db, `rooms/${code}/players`))]).catch(() => [null, null]);
  const m2 = (m2s && m2s.val()) || null, p2 = (p2s && p2s.val()) || {};
  let why = null;
  if (!m2) why = `There’s no game with the code ${code}. Check the letters and try again.`;
  else if (m2.v !== V) why = 'That game was started on an older version of On Guard. Ask the host to reload the page and start a new game.';
  else if (m2.guest && m2.guest !== uid) why = 'That game already has two players.';
  else if (m2.guest !== uid && rivals(p2, m2).some((o) => before(o, { id: uid, joined }) < 0)) {
    // someone with an earlier time is on the list too, but the host seats whoever it heard from first:
    // give the host a moment to say who got the seat before giving mine up (otherwise both can walk away)
    why = 'Someone else just joined that game. Ask for a new code.';
    for (let i = 0; i < 10 && !gone(tok); i++) {
      await new Promise((res) => setTimeout(res, 250));
      const g = await get(ref(db, `rooms/${code}/meta/guest`)).then((s) => s.val(), () => undefined);
      if (g === uid) { why = null; break; }
      if (g) { why = 'That game already has two players.'; break; }
    }
  }
  if (why || gone(tok)) {
    await onDisconnect(onRef).cancel().catch(() => {});
    await remove(mineRef).catch(() => {});
    throw why ? new Error(why) : stopped();
  }
  if (!mine && window.BL && window.BL.stats) window.BL.stats.hit('og_onlineJoins');
  return enter(code, false, null);
}

function enter(code, isHost, hs) {
  takenRoom = null;
  room = { code, isHost, hs: isHost ? hs : null, taken: false, evicted: false, offs: [], h: {}, flying: 0, next: null, lastLv: -1 };
  const r = room;
  r.offs.push(onValue(ref(db, '.info/connected'), (s) => {
    if (room !== r || r.taken || r.evicted) return;
    const on = s.val() === true;
    fire('conn', on);
    if (!on) return;
    const me = ref(db, `rooms/${code}/players/${uid}/online`);
    if (!isHost) {
      get(ref(db, `rooms/${code}/players/${uid}`)).then((snap) => {
        if (room !== r || r.taken || r.evicted) return;
        if (!named(snap.val())) {
          r.evicted = true;
          onDisconnect(me).cancel().catch(() => {});
          get(ref(db, `rooms/${code}/meta`)).then((ms) => {
            if (room === r && !r.taken && ms.exists()) fire('evicted');
          }).catch(() => {});
          return;
        }
        return onDisconnect(me).set(false).then(() => {
          if (room !== r || r.taken || r.evicted) { onDisconnect(me).cancel().catch(() => {}); return; }
          return set(me, true);
        });
      }).catch(() => {});
      return;
    }
    onDisconnect(me).set(false).then(() => {
      if (room !== r || r.taken) { onDisconnect(me).cancel().catch(() => {}); return; }
      return set(me, true);
    }).catch(() => {});
  }));
  r.offs.push(onValue(ref(db, `rooms/${code}/meta`), (s) => {
    if (room !== r || r.taken) return;
    const m = s.exists() ? s.val() : null;
    if (isHost && m && typeof m.hs === 'string' && m.hs && m.hs !== r.hs) {
      r.taken = true;
      r.next = null;
      const cb = r.h.taken;
      room = null;
      r.offs.forEach((off) => { try { off(); } catch (e) {} });
      onDisconnect(ref(db, `rooms/${r.code}/players/${uid}/online`)).cancel().catch(() => {});
      if (cb) { try { cb(); } catch (e) { console.error(e); } }
      else takenRoom = r;
      return;
    }
    fire('meta', m);
  }, (e) => { if (room === r && !r.taken) fire('error', e); }));
  r.offs.push(onValue(ref(db, `rooms/${code}/players`), (s) => { if (room === r && !r.taken) fire('players', s.val() || {}); }, (e) => { if (room === r && !r.taken) fire('error', e); }));
  if (!isHost) r.offs.push(onValue(ref(db, `rooms/${code}/state`), (s) => { if (room === r && !r.taken) fire('state', s.val()); }, (e) => { if (room === r && !r.taken) fire('error', e); }));
  return { code, isHost, uid };
}

function fire(k, v) { const f = room && room.h[k]; if (f) try { f(v); } catch (e) { console.error(e); } }
function on(handlers) {
  if (room) Object.assign(room.h, handlers);
  else if (takenRoom && handlers && handlers.taken) { takenRoom = null; try { handlers.taken(); } catch (e) { console.error(e); } }
}

/* host: the live game state. A few writes may be on their way at once (enough for 30 a second on a slow line); past that the newest snapshot
   waits (replacing any older one still waiting) and goes out the moment a write lands, so the guest
   always gets the latest news and never a backlog. */
const MAX_FLYING = 6;
function sendState(st) {
  if (!room || !room.isHost || room.taken) return false;
  if (room.flying >= MAX_FLYING) { room.next = st; return true; }
  const r = room;
  r.flying++;
  set(ref(db, `rooms/${r.code}/state`), st).catch(() => {}).finally(() => {
    r.flying--;
    if (room === r && !r.taken && r.next) { const n = r.next; r.next = null; sendState(n); }
  });
  return true;
}
async function readState() { return room && !room.taken ? (await get(rref('state'))).val() : null; }
function setMeta(patch) { return room && room.isHost && !room.taken ? update(rref('meta'), clean(patch)).catch((e) => console.warn(e)) : Promise.resolve(); }
function clearState() { if (room) room.next = null; return room && room.isHost && !room.taken ? set(rref('state'), null).catch(() => {}) : Promise.resolve(); }
/** host: take someone off the player list (a second joiner, or a guest who left) */
function prune(id) { return room && room.isHost && !room.taken && id && id !== uid ? remove(rref(`players/${id}`)).catch(() => {}) : Promise.resolve(); }

/* guest: my levers (bit 0 = my left hand, bit 1 = my right hand), sent only when they change */
function sendLevers(lv) {
  if (!room || room.isHost || room.evicted || lv === room.lastLv) return;
  room.lastLv = lv;
  set(ref(db, `rooms/${room.code}/players/${uid}/lv`), lv).catch(() => {});
}
function setMine(patch) { return room && !room.taken && !room.evicted ? update(ref(db, `rooms/${room.code}/players/${uid}`), clean(patch)).catch(() => {}) : Promise.resolve(); }

/** silent: just stop listening (the host reloading, or the room is already gone). Otherwise the host
    deletes the room and its code, and a guest takes their own name off the list. */
function leave(silent) {
  takenRoom = null;
  if (!room) return;
  const r = room;
  room = null;
  r.offs.forEach((off) => { try { off(); } catch (e) {} });
  if (!db || !uid) return;
  onDisconnect(ref(db, `rooms/${r.code}/players/${uid}/online`)).cancel().catch(() => {});
  if (silent || r.taken || r.evicted) return;
  if (r.isHost) remove(ref(db, `rooms/${r.code}`)).then(() => remove(ref(db, `codes/${r.code}`))).catch(() => {});
  else remove(ref(db, `rooms/${r.code}/players/${uid}`)).catch(() => {});
}

window.OGNet = {
  V, ready, create, join, on, sendState, readState, setMeta, clearState, prune, sendLevers, setMine, leave,
  /** the game server's clock, in ms: the same on both devices to within the connection delay */
  now() { return Date.now() + skew; },
  get uid() { return uid; },
  get code() { return room && room.code; },
  get isHost() { return !!(room && room.isHost); },
};
window.dispatchEvent(new Event('ognet'));
