/* Stac-Tac-Toe — Online 2P over Firebase Realtime Database
   Uses the existing bestlifecards.com Firebase config (window.BL_FIREBASE) and database.rules.json.
   Bundled via `npm run build:stactactoe` to best-life/stactactoe/net.js exposing window.STTNet.

   Schema:
     codes/<CODE>                 = host uid
     rooms/<CODE>/meta            = { kind: 'stactactoe', host, guest, status: 'lobby'|'playing', created, v, hs }
     rooms/<CODE>/players/<uid>   = { name, joined, online, v, req }
     rooms/<CODE>/state           = authoritative encoded match snapshot (columns encoded as 3 strings so
                                    Firebase never drops empty arrays or turns sparse arrays into objects!) */

import { initializeApp, getApps } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { getDatabase, ref, get, set, update, remove, onValue, onDisconnect } from 'firebase/database';

const CODE_ABC = 'ABCDEFGHJKMNPQRSTUVWXYZ'; // omit I, L, O for readability
const V = 1;

let app = null;
let auth = null;
let db = null;
let uid = null;
let signing = null;
let room = null;

function withTimeout(promise, ms, msg) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(msg || 'Request timed out. Check your connection.')), ms); }),
  ]).finally(() => clearTimeout(timer));
}

function safeName(raw, fallback) {
  const trimmed = String(raw || '').trim();
  const sliced = Array.from(trimmed).slice(0, 16).join('');
  return sliced || fallback;
}

const clean = (x) => JSON.parse(JSON.stringify(x));
const stopped = () => Object.assign(new Error('cancelled'), { cancelled: true });
const gone = (tok) => !!(tok && tok.cancelled);
const rref = (p) => ref(db, `rooms/${room.code}${p ? '/' + p : ''}`);
const genHs = () => Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6);
const named = (p) => !!(p && typeof p === 'object' && typeof p.name === 'string' && p.name);
const jTime = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : Number.MAX_SAFE_INTEGER);
const before = (a, b) => (jTime(a.joined) - jTime(b.joined)) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** Encode a match snapshot safely for Firebase RTDB (empty arrays & sparse arrays become strings). */
function encodeCols(cols) {
  return [0, 1, 2].map((i) => (Array.isArray(cols && cols[i]) ? cols[i].join('') : ''));
}

/** Decode columns from 3 strings, dense arrays, sparse Firebase objects, or missing field. */
function decodeCols(raw) {
  const out = [[], [], []];
  if (!raw || typeof raw !== 'object') return out;
  for (let c = 0; c < 3; c++) {
    const v = raw[c] !== undefined ? raw[c] : raw[String(c)];
    if (typeof v === 'string') {
      out[c] = v.split('').filter((ch) => ch === 'o' || ch === 'y');
    } else if (Array.isArray(v)) {
      out[c] = v.filter((ch) => ch === 'o' || ch === 'y');
    } else if (v && typeof v === 'object') {
      const keys = Object.keys(v).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
      out[c] = keys.map((k) => v[k]).filter((ch) => ch === 'o' || ch === 'y');
    }
  }
  return out;
}

function decodeMove(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const m = Object.assign({}, raw);
  if (typeof m.balls === 'string') m.balls = m.balls.split('').filter((ch) => ch === 'o' || ch === 'y');
  else if (Array.isArray(m.balls)) m.balls = m.balls.filter((ch) => ch === 'o' || ch === 'y');
  else if (m.balls && typeof m.balls === 'object') m.balls = Object.values(m.balls).filter((ch) => ch === 'o' || ch === 'y');
  else m.balls = [];
  return m;
}

function encodeMove(mv) {
  if (!mv || typeof mv !== 'object') return null;
  const out = Object.assign({}, mv);
  if (Array.isArray(out.balls)) out.balls = out.balls.join('');
  return out;
}

function encodeSnapshot(snap) {
  if (!snap || typeof snap !== 'object') return null;
  const st = snap.state || {};
  return clean({
    seq: snap.seq || 0,
    scores: { o: (snap.scores && snap.scores.o) || 0, y: (snap.scores && snap.scores.y) || 0 },
    roundNum: snap.roundNum || 1,
    names: { o: (snap.names && snap.names.o) || 'Orange', y: (snap.names && snap.names.y) || 'Yellow' },
    matchWinner: snap.matchWinner || null,
    anim: encodeMove(snap.anim),
    state: {
      colsStr: encodeCols(st.cols),
      reserve: { o: st.reserve ? st.reserve.o : 0, y: st.reserve ? st.reserve.y : 0 },
      turn: st.turn === 'y' ? 'y' : 'o',
      starter: st.starter === 'y' ? 'y' : 'o',
      phase: st.phase || 'place',
      ply: st.ply || 0,
      outcome: st.outcome || null,
      lastMove: encodeMove(st.lastMove),
      history: Array.isArray(st.history) ? st.history : [],
    },
  });
}

function decodeSnapshot(raw) {
  if (!raw || typeof raw !== 'object' || !raw.state || typeof raw.state !== 'object') return null;
  const rs = raw.state;
  const cols = decodeCols(rs.colsStr !== undefined ? rs.colsStr : rs.cols);
  const resO = rs.reserve && Number.isFinite(rs.reserve.o) ? rs.reserve.o : Math.max(0, 5 - cols.flat().filter((x) => x === 'o').length);
  const resY = rs.reserve && Number.isFinite(rs.reserve.y) ? rs.reserve.y : Math.max(0, 5 - cols.flat().filter((x) => x === 'y').length);

  let outcome = null;
  if (rs.outcome && typeof rs.outcome === 'object') {
    const rawLines = Array.isArray(rs.outcome.lines) ? rs.outcome.lines : (rs.outcome.lines ? Object.values(rs.outcome.lines) : []);
    outcome = {
      result: rs.outcome.result === 'draw' ? 'draw' : 'win',
      winner: rs.outcome.winner === 'o' || rs.outcome.winner === 'y' ? rs.outcome.winner : null,
      selfOwn: !!rs.outcome.selfOwn,
      lines: rawLines.map((l) => ({
        color: l.color,
        dir: l.dir,
        cells: Array.isArray(l.cells) ? l.cells : Object.values(l.cells || {}),
      })),
    };
  }

  return {
    seq: Number.isFinite(raw.seq) ? raw.seq : 0,
    scores: {
      o: raw.scores && Number.isFinite(raw.scores.o) ? raw.scores.o : 0,
      y: raw.scores && Number.isFinite(raw.scores.y) ? raw.scores.y : 0,
    },
    roundNum: Number.isFinite(raw.roundNum) ? raw.roundNum : 1,
    names: {
      o: (raw.names && raw.names.o) || 'Orange',
      y: (raw.names && raw.names.y) || 'Yellow',
    },
    matchWinner: raw.matchWinner === 'o' || raw.matchWinner === 'y' ? raw.matchWinner : null,
    anim: decodeMove(raw.anim),
    state: {
      cols,
      reserve: { o: resO, y: resY },
      turn: rs.turn === 'y' ? 'y' : 'o',
      starter: rs.starter === 'y' ? 'y' : 'o',
      phase: rs.phase || (outcome ? 'over' : (resO === 0 && resY === 0 ? 'stack' : 'place')),
      ply: Number.isFinite(rs.ply) ? rs.ply : 0,
      outcome,
      lastMove: decodeMove(rs.lastMove),
      history: Array.isArray(rs.history) ? rs.history : (rs.history ? Object.values(rs.history) : []),
    },
  };
}

function ready() {
  if (uid) return Promise.resolve(uid);
  if (signing) return signing;
  const cfg = window.BL_FIREBASE;
  if (!cfg || !cfg.apiKey) {
    return Promise.reject(new Error('Online play isn’t configured yet.'));
  }
  if (!app) {
    const existing = getApps().find((a) => a.name === 'stactactoe');
    app = existing || initializeApp(cfg, 'stactactoe');
    auth = getAuth(app);
    db = getDatabase(app);
  }
  signing = new Promise((res, rej) => {
    let off = () => {};
    const done = (err) => {
      clearTimeout(timer);
      off();
      if (err) rej(err);
      else res(uid);
    };
    const timer = setTimeout(() => done(new Error('Couldn’t reach the game server. Check your connection.')), 15000);
    off = onAuthStateChanged(auth, (u) => {
      if (u) {
        uid = u.uid;
        done();
      }
    }, (e) => done(e));
    signInAnonymously(auth).catch((e) => done(e));
  });
  signing.catch(() => { signing = null; });
  return signing;
}

async function create(name, tok) {
  await ready();
  if (gone(tok)) throw stopped();
  leave(true);
  const nm = safeName(name, 'Orange');
  let code = null;
  for (let i = 0; i < 12 && !code; i++) {
    if (gone(tok)) throw stopped();
    const c = Array.from({ length: 4 }, () => CODE_ABC[Math.floor(Math.random() * CODE_ABC.length)]).join('');
    try {
      await withTimeout(set(ref(db, `codes/${c}`), uid), 12000, 'Timed out creating room.');
      code = c;
    } catch (e) {
      if (e && /Timed out/.test(e.message)) throw e;
    }
    if (gone(tok)) {
      if (code) remove(ref(db, `codes/${code}`)).catch(() => {});
      throw stopped();
    }
  }
  if (!code) throw new Error('Couldn’t generate a room code. Please try again.');

  const now = Date.now();
  const hs = genHs();
  const onRef = ref(db, `rooms/${code}/players/${uid}/online`);
  const rollback = () =>
    onDisconnect(onRef).cancel().catch(() => {})
      .then(() => remove(ref(db, `rooms/${code}`))).catch(() => {})
      .then(() => remove(ref(db, `codes/${code}`))).catch(() => {});

  try {
    await withTimeout(onDisconnect(onRef).set(false), 12000);
    if (gone(tok)) { await rollback(); throw stopped(); }
    await withTimeout(set(ref(db, `rooms/${code}`), clean({
      meta: { kind: 'stactactoe', host: uid, status: 'lobby', created: now, v: V, hs },
      players: { [uid]: { name: nm, joined: now, online: true, v: V } },
    })), 12000, 'Timed out saving room.');
  } catch (e) {
    if (!e || !e.cancelled) await rollback();
    throw e;
  }
  if (gone(tok)) { await rollback(); throw stopped(); }
  if (window.BL && window.BL.stats) window.BL.stats.hit('stt_onlineRooms');
  return enter(code, true, hs);
}

async function join(rawCode, name, tok) {
  await ready();
  if (gone(tok)) throw stopped();
  leave(true);
  const nm = safeName(name, 'Yellow');
  const code = String(rawCode || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
  if (code.length !== 4) throw new Error('Enter a 4-letter room code.');

  const metaSnap = await withTimeout(get(ref(db, `rooms/${code}/meta`)), 12000, 'Timed out looking up room.').catch((e) => {
    if (e && /Timed out/.test(e.message)) throw e;
    return null;
  });
  if (gone(tok)) throw stopped();
  if (!metaSnap || !metaSnap.exists()) throw new Error(`No game found with code ${code}.`);
  const meta = metaSnap.val() || {};
  if (meta.kind !== 'stactactoe') throw new Error(`Code ${code} belongs to a different game.`);
  if (meta.v !== V) throw new Error('That room is on a different version. Ask the host to reload.');

  const hostSnap = await withTimeout(get(ref(db, `codes/${code}`)), 12000);
  if (gone(tok)) throw stopped();
  const onRef = ref(db, `rooms/${code}/players/${uid}/online`);

  // Host returning to own room (e.g. after reload or iOS tab refresh)
  if (hostSnap.val() === uid) {
    const hs = genHs();
    await withTimeout(onDisconnect(onRef).set(false), 12000);
    if (gone(tok)) { onDisconnect(onRef).cancel().catch(() => {}); throw stopped(); }
    await withTimeout(update(ref(db, `rooms/${code}/meta`), { hs }), 12000);
    if (gone(tok)) { onDisconnect(onRef).cancel().catch(() => {}); throw stopped(); }
    await withTimeout(update(ref(db, `rooms/${code}/players/${uid}`), { online: true, name: nm }), 12000);
    if (gone(tok)) { onDisconnect(onRef).cancel().catch(() => {}); throw stopped(); }
    return enter(code, true, hs);
  }

  const players = (await withTimeout(get(ref(db, `rooms/${code}/players`)), 12000)).val() || {};
  if (gone(tok)) throw stopped();
  if (meta.guest && meta.guest !== uid) throw new Error('That room already has two players.');

  const rivals = (pl, m) => Object.keys(pl)
    .filter((id) => id !== uid && id !== m.host && named(pl[id]) && pl[id].online !== false)
    .map((id) => ({ id, joined: jTime(pl[id].joined) }));

  if (meta.guest !== uid && rivals(players, meta).length) {
    throw new Error('Someone else just joined that room.');
  }

  const mineRef = ref(db, `rooms/${code}/players/${uid}`);
  const mine = named(players[uid]);
  const joined = (mine && Number.isFinite(players[uid].joined)) ? players[uid].joined : Date.now();
  await withTimeout(onDisconnect(onRef).set(false), 12000);
  if (gone(tok)) { onDisconnect(onRef).cancel().catch(() => {}); throw stopped(); }
  await withTimeout(update(mineRef, { name: nm, joined, online: true, v: V }), 12000);

  const [m2s, p2s] = await withTimeout(Promise.all([
    get(ref(db, `rooms/${code}/meta`)),
    get(ref(db, `rooms/${code}/players`)),
  ]), 12000).catch(() => [null, null]);
  const m2 = m2s && m2s.val();
  const p2 = (p2s && p2s.val()) || {};
  let err = null;
  if (!m2) err = `No game found with code ${code}.`;
  else if (m2.guest && m2.guest !== uid) err = 'That room already has two players.';
  else if (m2.guest !== uid && rivals(p2, m2).some((o) => before(o, { id: uid, joined }) < 0)) {
    err = 'Someone else just joined that room.';
  }
  if (err || gone(tok)) {
    await onDisconnect(onRef).cancel().catch(() => {});
    await remove(mineRef).catch(() => {});
    throw err ? new Error(err) : stopped();
  }

  if (!mine && window.BL && window.BL.stats) window.BL.stats.hit('stt_onlineJoins');
  return enter(code, false, null);
}

function enter(code, isHost, hs) {
  room = { code, isHost, hs: isHost ? hs : null, taken: false, evicted: false, offs: [], h: {} };
  const r = room;

  r.offs.push(onValue(ref(db, '.info/connected'), (s) => {
    if (room !== r || r.taken || r.evicted) return;
    const on = s.val() === true;
    fire('conn', on);
    if (!on) return;
    const me = ref(db, `rooms/${code}/players/${uid}/online`);
    onDisconnect(me).set(false).then(() => {
      if (room !== r || r.taken || r.evicted) return;
      return set(me, true);
    }).catch(() => {});
  }));

  r.offs.push(onValue(ref(db, `rooms/${code}/meta`), (s) => {
    if (room !== r || r.taken) return;
    const m = s.exists() ? s.val() : null;
    if (isHost && m && typeof m.hs === 'string' && m.hs && m.hs !== r.hs) {
      r.taken = true;
      room = null;
      r.offs.forEach((off) => { try { off(); } catch (e) {} });
      fireDirect(r, 'taken');
      return;
    }
    fire('meta', m);
  }, (e) => { if (room === r && !r.taken) fire('error', e); }));

  r.offs.push(onValue(ref(db, `rooms/${code}/players`), (s) => {
    if (room === r && !r.taken) fire('players', s.val() || {});
  }, (e) => { if (room === r && !r.taken) fire('error', e); }));

  r.offs.push(onValue(ref(db, `rooms/${code}/state`), (s) => {
    if (room === r && !r.taken) fire('state', decodeSnapshot(s.val()));
  }, (e) => { if (room === r && !r.taken) fire('error', e); }));

  return { code, isHost, uid };
}

function fire(k, v) {
  const f = room && room.h[k];
  if (f) { try { f(v); } catch (e) { console.error(e); } }
}

function fireDirect(r, k, v) {
  const f = r && r.h[k];
  if (f) { try { f(v); } catch (e) { console.error(e); } }
}

function on(handlers) {
  if (room) Object.assign(room.h, handlers);
}

function sendState(snap) {
  if (!room || !room.isHost || room.taken) return Promise.resolve();
  return set(rref('state'), encodeSnapshot(snap));
}

async function readRoom() {
  if (!room || room.taken) return null;
  const [ms, ps, ss] = await Promise.all([
    get(rref('meta')),
    get(rref('players')),
    get(rref('state')),
  ]);
  return {
    meta: ms.exists() ? ms.val() : null,
    players: ps.exists() ? (ps.val() || {}) : {},
    state: decodeSnapshot(ss.val()),
  };
}

function setMeta(patch) {
  if (!room || !room.isHost || room.taken) return Promise.resolve();
  return update(rref('meta'), clean(patch)).catch((e) => console.warn(e));
}

function prune(id) {
  if (!room || !room.isHost || room.taken || !id || id === uid) return Promise.resolve();
  return remove(rref(`players/${id}`)).catch(() => {});
}

function sendRequest(req) {
  if (!room || room.taken || room.evicted) return Promise.reject(new Error('Not connected to room.'));
  return update(ref(db, `rooms/${room.code}/players/${uid}`), clean({ req }));
}

function leave(silent) {
  if (!room) return;
  const r = room;
  room = null;
  r.offs.forEach((off) => { try { off(); } catch (e) {} });
  if (!db || !uid) return;
  onDisconnect(ref(db, `rooms/${r.code}/players/${uid}/online`)).cancel().catch(() => {});
  if (silent || r.taken || r.evicted) return;
  if (r.isHost) {
    remove(ref(db, `rooms/${r.code}`)).then(() => remove(ref(db, `codes/${r.code}`))).catch(() => {});
  } else {
    remove(ref(db, `rooms/${r.code}/players/${uid}`)).catch(() => {});
  }
}

window.STTNet = {
  V,
  ready,
  create,
  join,
  on,
  sendState,
  readRoom,
  setMeta,
  prune,
  sendRequest,
  leave,
  encodeSnapshot,
  decodeSnapshot,
  get uid() { return uid; },
  get code() { return room && room.code; },
  get isHost() { return !!(room && room.isHost); },
};
