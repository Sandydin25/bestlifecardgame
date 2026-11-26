/* Best Life — online play (2–6 players, each on their own device) over Firebase Realtime Database.
   Bundled to js/online.js (npm run build) and loaded only when someone opens online play.

   Data layout (see database.rules.json):
     codes/<CODE>            = host uid (claims the 4-letter code)
     rooms/<CODE>/meta       = { host, status: lobby|playing|over, game }
     rooms/<CODE>/players    = { uid: { name, joined, online } }
     rooms/<CODE>/state      = public game state (counts, sets won, turn, last move)
     rooms/<CODE>/hands/uid  = { c: that player's cards, d: card they just drew, w: sets they just won, n } (only they can read it)
     rooms/<CODE>/secret/full = full state, host-only (lets the host reload)
     rooms/<CODE>/actions    = moves sent by players; the host applies and deletes them */
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import {
  getDatabase, ref, get, set, update, push, remove, onValue, onChildAdded, onDisconnect, serverTimestamp,
} from 'firebase/database';

const BL = window.BL;
const E = BL.Engine;
const $ = (s) => document.querySelector(s);
const NAME = (id) => BL.set(id).name;
const AN = (id) => (/^[AEIOU]/.test(NAME(id)) ? 'an' : 'a');
const ORDER = BL.SETS.map((s) => s.id);
const AVATARS = ['grin', 'hugface', 'medal', 'apple', 'money', 'globe'];
const CODE_ABC = 'ABCDEFGHJKMNPQRSTUVWXYZ';
const sound = (k) => BL.sound && BL.sound(k);

let app, auth, db, uid = null;
let R = null; // the current room

/* ---------------- Firebase ---------------- */
async function ready() {
  if (uid) return uid;
  const cfg = window.BL_FIREBASE;
  if (!cfg || !cfg.apiKey) throw new Error('Online play isn’t switched on yet.');
  app = initializeApp(cfg);
  auth = getAuth(app);
  db = getDatabase(app);
  uid = await new Promise((res, rej) => {
    const off = onAuthStateChanged(auth, (u) => { if (u) { off(); res(u.uid); } });
    signInAnonymously(auth).catch(rej);
  });
  return uid;
}
const roomRef = (p = '') => ref(db, `rooms/${R.code}${p ? '/' + p : ''}`);
const clean = (x) => JSON.parse(JSON.stringify(x)); // Firebase rejects undefined

/* ---------------- DOM ---------------- */
const board = $('#oboard');
const els = {
  code: $('#oCode'), opps: $('#oOpps'), pile: $('#oPile'), pileWrap: $('#oPileWrap'), pileCount: $('#oPileCount'), msg: $('#oMsg'),
  setsMe: $('#oSetsMe'), meTag: $('#oTagMe'), meName: $('#oMeName'), meInfo: $('#oMeInfo'), meAv: $('#oMeAv'), ask: $('#oAskBar'),
  hand: $('#oHand'), lobby: $('#oLobby'), end: $('#oEnd'),
};
for (let i = 0; i < 3; i++) els.pile.append(BL.card('money', { cls: 'down', label: false }));
els.hand.setAttribute('role', 'group');
els.hand.setAttribute('aria-label', 'Your cards');
// card ids are set + 0..3: the same four Connecting Points as the printed deck
const quoteOf = (card) => { const id = E.setOf(card), q = BL.set(id).quotes; return q[(parseInt(card.slice(id.length), 10) || 0) % q.length]; };

const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const rawName = (pid) => (R.players[pid] && R.players[pid].name) || 'Someone';
const pname = (pid) => (pid === uid ? 'You' : esc(rawName(pid)));
const seatOf = (pid) => {
  const order = (R.state && R.state.order) || lobbyOrder();
  return Math.max(0, order.indexOf(pid));
};
const avatarOf = (pid) => AVATARS[seatOf(pid) % AVATARS.length];
function lobbyOrder() {
  return Object.entries(R.players || {})
    .filter(([, p]) => p && p.name)
    .sort((a, b) => (a[1].joined || 0) - (b[1].joined || 0))
    .map(([id]) => id);
}
const isOnline = (pid) => !!(R.players[pid] && R.players[pid].online !== false);
const onlineOrder = () => lobbyOrder().filter(isOnline);
const status = () => (R && R.meta && R.meta.status) || null;

/* the message box: what just happened, plus whose turn it is (kept apart so presence changes can update the turn line) */
function paintMsg(anim) {
  const turn = R.state ? turnText(R.state) : '';
  R.turnHTML = turn;
  const body = R.lastText ? `${R.lastText}${turn ? `<br><small>${turn}</small>` : ''}` : turn;
  els.msg.innerHTML = `<div>${body}</div>`;
  if (anim) els.msg.animate([{ transform: 'scale(.96)', opacity: 0.4 }, { transform: 'none', opacity: 1 }], { duration: 260, easing: 'ease-out' });
}
function say(html) { if (!R) return; R.lastText = html; paintMsg(true); }

/* ---------------- lobby screens ---------------- */
function lobby(html, keep) {
  // live views (the waiting room) re-render on every change; skip when nothing changed so focus stays put
  if (keep && els.lobby._html === html && els.lobby.classList.contains('on')) return;
  els.lobby._html = keep ? html : '';
  els.lobby.innerHTML = `<div class="o-panel">${html}</div>`;
  els.lobby.classList.add('on');
  const first = els.lobby.querySelector('input, button:not(:disabled)');
  if (first) setTimeout(() => first.focus({ preventScroll: true }), 50);
}
const savedName = () => { try { return localStorage.getItem('bl-name') || ''; } catch (e) { return ''; } };
const saveName = (n) => { try { localStorage.setItem('bl-name', n); } catch (e) {} };

function openCreate() {
  show();
  lobby(`<h3>Start a game</h3><p>You’ll get a join code to send to family. 2 to 6 players, each on their own phone.</p>
    <form id="oCreateForm" class="o-form"><label>Your name<input id="oName" maxlength="16" autocomplete="nickname" value="${esc(savedName())}" required placeholder="e.g. Sam"></label>
    <button class="btn btn-y" type="submit">Create game</button></form>
    <button class="o-link" type="button" data-act="back">Back</button>`);
  $('#oCreateForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = $('#oName').value.trim().slice(0, 16);
    if (!name) return;
    saveName(name);
    busy('Creating your game…');
    try { await createRoom(name); } catch (err) { fail(err); }
  });
}

function openJoin(code = '') {
  show();
  lobby(`<h3>Join a game</h3><p>Ask the person who started the game for the 4-letter code.</p>
    <form id="oJoinForm" class="o-form"><label>Join code<input id="oJoinCode" class="o-code-in" maxlength="4" pattern="[A-Za-z]{4}" title="The join code is 4 letters, like ABCD" autocapitalize="characters" autocomplete="off" value="${esc(code)}" required placeholder="ABCD"></label>
    <label>Your name<input id="oName" maxlength="16" autocomplete="nickname" value="${esc(savedName())}" required placeholder="e.g. Sam"></label>
    <p class="o-err" id="oJoinErr" role="alert"></p>
    <button class="btn btn-y" type="submit">Join game</button></form>
    <button class="o-link" type="button" data-act="back">Back</button>`);
  const codeIn = $('#oJoinCode'), errEl = $('#oJoinErr');
  codeIn.addEventListener('input', () => { codeIn.value = codeIn.value.toUpperCase().replace(/[^A-Z]/g, ''); errEl.textContent = ''; });
  if (code) setTimeout(() => { const n = $('#oName'); if (n) n.focus({ preventScroll: true }); }, 60);
  $('#oJoinForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const c = codeIn.value.trim().toUpperCase(), name = $('#oName').value.trim().slice(0, 16);
    if (c.length !== 4) { errEl.textContent = 'The join code is 4 letters, like ABCD.'; codeIn.focus(); return; }
    if (!name) { errEl.textContent = 'Please type your name so everyone knows who you are.'; $('#oName').focus(); return; }
    saveName(name);
    busy('Joining…');
    try { await joinRoom(c, name); } catch (err) { fail(err, () => openJoin(c)); }
  });
}

function busy(text) { lobby(`<div class="o-spin" aria-hidden="true"></div><p>${esc(text)}</p>`); }
function fail(err, retry) {
  console.warn(err);
  lobby(`<h3>Hmm…</h3><p>${esc(err && err.message ? friendly(err.message) : 'Something went wrong.')}</p>
    <button class="btn btn-y" type="button" data-act="${retry ? 'retry' : 'back'}">${retry ? 'Try again' : 'Back'}</button>`);
  els.lobby._retry = retry;
}
function friendly(m) {
  if (/PERMISSION_DENIED/i.test(m)) return 'That didn’t work. Please check the code and try again.';
  if (/network|offline|unavailable/i.test(m)) return 'Can’t reach the game server. Check your internet connection.';
  return m;
}

/* tap once to arm, tap again within 4s to do it (for things that end the game for others) */
function twoTap(btn, text, fn) {
  if (btn.dataset.armed) { fn(); return; }
  const old = btn.textContent;
  btn.dataset.armed = '1';
  btn.textContent = text;
  btn.classList.add('armed');
  setTimeout(() => { if (btn.isConnected && btn.dataset.armed) { delete btn.dataset.armed; btn.textContent = old; btn.classList.remove('armed'); } }, 4000);
}
const othersHere = () => (R ? lobbyOrder().filter((p) => p !== uid && isOnline(p)).length : 0);
function leaveToMenu() { leave(); BL.playMenu && BL.playMenu(); }

els.lobby.addEventListener('click', (e) => {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const act = b.dataset.act;
  if (act === 'back') leaveToMenu();
  if (act === 'retry' && els.lobby._retry) els.lobby._retry();
  if (act === 'start') startGame();
  if (act === 'share') share();
  if (act === 'leave') {
    if (R && R.isHost && othersHere()) twoTap(b, 'Tap again to close the game for everyone', leaveToMenu);
    else leaveToMenu();
  }
});

function renderWaiting() {
  const order = lobbyOrder();
  const host = R.meta && R.meta.host;
  const list = order.map((pid) => `<li><img src="${BL.iconURI(avatarOf(pid))}" alt=""><span>${pname(pid)}${pid === host ? ' <em>host</em>' : ''}</span>${isOnline(pid) ? '' : '<small>offline</small>'}</li>`).join('');
  const n = Math.min(6, onlineOrder().length);
  const startBtn = R.isHost
    ? `<button class="btn btn-y" type="button" data-act="start" ${n < 2 ? 'disabled' : ''}>${n < 2 ? 'Waiting for players…' : `Start game (${n} players)`}</button>`
    : `<p class="o-wait">Waiting for ${pname(host)} to start the game…</p>`;
  lobby(`<h3>Your join code</h3>
    <div class="o-bigcode" aria-label="Join code ${R.code.split('').join(' ')}">${R.code}</div>
    <button class="btn btn-ghost o-share" type="button" data-act="share">Send the invite</button>
    <p class="o-tip">Family can open <b>bestlifecards.com</b>, tap <b>Join with a code</b>, and type <b>${R.code}</b>.</p>
    <ul class="o-players">${list}</ul>
    ${startBtn}
    <button class="o-link" type="button" data-act="leave">${R.isHost ? 'Close this game' : 'Leave'}</button>`, true);
}

async function share() {
  const url = `${location.origin}${location.pathname}?join=${R.code}`;
  const text = `Come play Best Life with me! Join code: ${R.code}`;
  try {
    if (navigator.share) { await navigator.share({ title: 'Play Best Life', text, url }); return; }
  } catch (e) { if (e && e.name === 'AbortError') return; }
  try { await navigator.clipboard.writeText(`${text}\n${url}`); toastLobby('Invite link copied! Paste it in a text.'); }
  catch (e) { toastLobby(url); }
}
function toastLobby(t) {
  const p = els.lobby.querySelector('.o-tip');
  if (p) { p.textContent = t; p.classList.add('flash'); }
}

/* ---------------- room lifecycle ---------------- */
async function createRoom(name) {
  await ready();
  let code = null;
  for (let i = 0; i < 10 && !code; i++) {
    const c = Array.from({ length: 4 }, () => CODE_ABC[Math.floor(Math.random() * CODE_ABC.length)]).join('');
    try { await set(ref(db, `codes/${c}`), uid); code = c; } catch (e) { /* taken: try another */ }
  }
  if (!code) throw new Error('Couldn’t make a join code. Please try again.');
  await set(ref(db, `rooms/${code}`), clean({ meta: { host: uid, kind: 'bestlife', status: 'lobby', game: 0, created: Date.now() }, players: { [uid]: { name, joined: Date.now(), online: true } } }));
  BL.stats && BL.stats.hit('onlineRooms');
  await enterRoom(code);
}

async function joinRoom(code, name) {
  await ready();
  const metaSnap = await get(ref(db, `rooms/${code}/meta`)).catch(() => null);
  if (!metaSnap || !metaSnap.exists()) throw new Error(`There’s no game with the code ${code}. Check the letters and try again.`);
  const meta = metaSnap.val();
  if (meta.kind && meta.kind !== 'bestlife') throw new Error(`The code ${code} is for a different game. Check the letters and try again.`);
  const playersSnap = await get(ref(db, `rooms/${code}/players`));
  const players = playersSnap.val() || {};
  const already = !!(players[uid] && players[uid].name);
  if (!already && meta.status !== 'lobby') throw new Error('That game has already started. Ask them to tap “Back to the table” after this round, then join.');
  if (!already && Object.keys(players).length >= 6) throw new Error('That game is full (6 players max).');
  await update(ref(db, `rooms/${code}/players/${uid}`), already ? { online: true } : { name, joined: Date.now(), online: true });
  BL.stats && BL.stats.hit('onlineJoins');
  await enterRoom(code);
}

async function enterRoom(code) {
  leave(true);
  R = { code, players: {}, meta: null, state: null, hand: [], myDraw: null, offs: [], isHost: false, target: null, pendingSet: null,
    seenN: -1, full: null, busyActions: Promise.resolve(), lastText: '', turnHTML: '' };
  show();
  els.code.innerHTML = `Code <b>${code}</b>`;
  try { history.replaceState(null, '', `${location.pathname}?join=${code}${location.hash}`); } catch (e) {}

  const hostSnap = await get(ref(db, `codes/${code}`));
  R.isHost = hostSnap.val() === uid;
  if (R.isHost) {
    // after a reload the host picks the game back up from its private copy
    const sec = await get(roomRef('secret/full')).catch(() => null);
    if (sec && sec.exists()) R.full = sec.val();
  }
  // presence: mark me online, and again after every reconnect (onDisconnect fires on each drop)
  R.offs.push(onValue(ref(db, '.info/connected'), (s) => {
    if (s.val() !== true || !R || R.code !== code) return;
    const me = ref(db, `rooms/${code}/players/${uid}/online`);
    onDisconnect(me).set(false).then(() => set(me, true)).catch(() => {});
  }));
  R.offs.push(onValue(roomRef('players'), (s) => {
    R.players = s.val() || {};
    // host: someone who was skipped while away is back, so deal them back in at their next turn
    if (R.isHost && R.full && R.full.skipped) {
      Object.keys(R.full.skipped).filter(isOnline).forEach((pid) => { R.busyActions = R.busyActions.then(() => hostRejoin(pid)); });
    }
    refresh();
  }));
  R.offs.push(onValue(roomRef('meta'), (s) => {
    if (!s.exists()) { R.meta = null; ended('The host closed this game.'); return; }
    R.meta = s.val(); refresh();
  }));
  R.offs.push(onValue(roomRef('state'), (s) => { const prev = R.state; R.state = s.val(); onState(prev); }));
  R.offs.push(onValue(roomRef(`hands/${uid}`), (s) => {
    const v = s.val();
    const obj = v && !Array.isArray(v) && ('c' in v || 'n' in v || 'd' in v);
    R.hand = arr(obj ? v.c : v);
    R.myDraw = obj && v.d ? { d: v.d, n: v.n } : null;
    R.myWon = obj && v.w ? arr(v.w) : [];
    renderHand();
    // the public message said "you drew from the Help Stack"; now that my hand arrived, say what it was
    const last = R.state && R.state.last;
    if (R.awaitDraw != null && R.myDraw && last && R.myDraw.n === R.awaitDraw && (last.n || 0) === R.awaitDraw) { R.awaitDraw = null; describe(last, R.state); }
  }));
  if (R.isHost) R.offs.push(onChildAdded(roomRef('actions'), (s) => { R.busyActions = R.busyActions.then(() => hostApply(s.key, s.val())); }));
  refresh();
}
const arr = (x) => (Array.isArray(x) ? x.filter((v) => v != null) : x && typeof x === 'object' ? Object.values(x) : []);

function leave(silent) {
  els.lobby._html = '';
  els.end._html = '';
  if (!R) return;
  R.offs.forEach((off) => { try { off(); } catch (e) {} });
  clearTimeout(R.sendT);
  if (db && uid) {
    const code = R.code;
    onDisconnect(ref(db, `rooms/${code}/players/${uid}/online`)).cancel().catch(() => {});
    if (R.isHost && !silent) {
      // the host leaving closes the game for everyone (and frees the join code)
      remove(ref(db, `rooms/${code}`)).then(() => remove(ref(db, `codes/${code}`))).catch(() => {});
    } else if (R.meta && R.meta.status === 'lobby' && !R.isHost) remove(ref(db, `rooms/${code}/players/${uid}`)).catch(() => {});
    else set(ref(db, `rooms/${code}/players/${uid}/online`), false).catch(() => {});
  }
  R = null;
  if (!silent) {
    try { history.replaceState(null, '', location.pathname + location.hash); } catch (e) {}
  }
  BL.syncBar && BL.syncBar();
}

function ended(text) {
  if (!R) return;
  els.end.classList.remove('on');
  lobby(`<h3>Game closed</h3><p>${esc(text)}</p><button class="btn btn-y" type="button" data-act="leave">Back to menu</button>`);
}

/* ---------------- host: start + apply moves ---------------- */
async function startGame() {
  if (!R || !R.isHost || R.starting) return;
  const order = onlineOrder().slice(0, 6);
  if (order.length < 2) { refresh(); return; }
  R.starting = true;
  try {
    const s = E.newGame(order);
    R.full = s;
    const game = ((R.meta && R.meta.game) || 0) + 1;
    await update(roomRef(), clean({ ...writeAll(s), actions: null, 'meta/status': 'playing', 'meta/game': game }));
    BL.stats && BL.stats.hit('onlineGamesStarted');
  } catch (e) { console.warn(e); say(friendly(e.message || 'Couldn’t start the game.')); }
  if (R) R.starting = false;
}

/* host: back to the lobby with the same code, so latecomers can join before the next round */
async function backToTable() {
  if (!R || !R.isHost) return;
  R.full = null;
  await update(roomRef(), { 'meta/status': 'lobby', state: null, hands: null, secret: null, actions: null }).catch((e) => console.warn(e));
}

function writeAll(s) {
  const out = { state: E.publicView(s), 'secret/full': s };
  const l = s.last;
  s.order.forEach((p) => {
    const h = { c: E.hand(s, p), n: s.n || 0 };
    const d = E.privateDraw(s, p);
    if (d) h.d = d; // the card I just drew
    if (l && l.kind === 'ask' && l.by === p && l.sets && l.sets.length) h.w = l.sets; // sets I just won (their cards fly to my pile)
    out[`hands/${p}`] = h;
  });
  return out;
}

async function hostApply(key, a) {
  if (!R || !R.isHost) return;
  const upd = { [`actions/${key}`]: null };
  try {
    if (!R.full) throw new Error('no game');
    let s;
    if (a.type === 'skip') { if (a.by !== uid) throw new Error('only host can skip'); s = E.skip(R.full); }
    else s = E.ask(R.full, a.by, a.target, a.set);
    R.full = s;
    Object.assign(upd, writeAll(s));
    if (s.phase === 'over') { upd['meta/status'] = 'over'; BL.stats && BL.stats.hit('onlineGamesFinished'); }
  } catch (e) { /* stale or invalid move: just drop it */ }
  await update(roomRef(), clean(upd)).catch((e) => console.warn(e));
}

async function hostRejoin(pid) {
  if (!R || !R.isHost || !R.full || !R.full.skipped || !R.full.skipped[pid]) return;
  R.full = E.rejoin(R.full, pid);
  await update(roomRef(), clean({ 'secret/full': R.full })).catch((e) => console.warn(e));
}

function sendAsk(target, setId) {
  if (!myTurn() || !R.hand.some((c) => E.setOf(c) === setId)) return;
  const n = R.state.n || 0;
  R.sending = true;
  R.pendingSet = null;
  renderOpps(); renderAsk(); renderHandHints();
  clearTimeout(R.sendT);
  // if the host never answers (lost connection, or they reloaded mid-move), give the turn back
  R.sendT = setTimeout(() => {
    if (!R || !R.sending || (R.state && (R.state.n || 0) !== n)) return;
    R.sending = false;
    say('Hmm, that didn’t go through. Please try again.');
    refresh();
  }, 12000);
  push(roomRef('actions'), { by: uid, target, set: setId, n, at: serverTimestamp() })
    .catch((e) => { if (!R) return; R.sending = false; say(friendly(e.message)); refresh(); });
}
function sendSkip() { if (R && R.isHost) push(roomRef('actions'), { by: uid, type: 'skip', at: serverTimestamp() }); }

/* ---------------- rendering ---------------- */
function refresh() {
  if (!R) return;
  BL.syncBar && BL.syncBar();
  const st = status();
  if (!st) return;
  if (st === 'lobby') { els.end.classList.remove('on'); renderWaiting(); renderOpps(); return; }
  if (R.state && R.state.order && !R.state.order.includes(uid)) {
    lobby(`<h3>Already started</h3><p>This round started before you joined. When it ends, ask ${pname(R.meta.host)} to tap <b>Back to the table</b>, and you’ll be in the next one.</p>
      <button class="btn btn-y" type="button" data-act="back">Back to menu</button>`, true);
    return;
  }
  els.lobby.classList.remove('on');
  els.lobby._html = '';
  renderOpps();
  renderMe();
  renderAsk();
  renderHandHints();
  if (R.state && turnText(R.state) !== R.turnHTML) paintMsg(false);
  if (R.state && R.state.phase === 'over') showEnd(R.state);
  else els.end.classList.remove('on');
}

const myTurn = () => !!(R && R.state && status() === 'playing' && R.state.phase === 'playing' && R.state.turn === uid && !R.sending);

/** who I may ask: anyone holding cards (or, if nobody else has any, anyone, so the game never stalls) */
function targets() {
  if (!R.state) return [];
  const others = R.state.order.filter((p) => p !== uid);
  const withCards = others.filter((p) => (R.state.counts[p] || 0) > 0);
  return withCards.length ? withCards : others;
}
function syncTarget() {
  if (!myTurn()) return;
  const t = targets();
  if (R.target && !t.includes(R.target)) R.target = null;
  if (!R.target && t.length === 1) R.target = t[0];
  if (R.pendingSet && !R.hand.some((c) => E.setOf(c) === R.pendingSet)) R.pendingSet = null;
}

function renderOpps() {
  syncTarget();
  const st = R.state, order = st && status() !== 'lobby' ? st.order : lobbyOrder();
  const others = order.filter((p) => p !== uid);
  const mine = myTurn(), can = mine ? targets() : [];
  els.opps.style.setProperty('--n', Math.max(1, others.length));
  els.opps.innerHTML = '';
  for (const pid of others) {
    const away = !isOnline(pid);
    const count = st && st.counts ? st.counts[pid] || 0 : 0;
    const wonSets = st && st.won ? arr(st.won[pid]) : [];
    const pick = can.includes(pid);
    const prevN = (R.prevCounts && R.prevCounts[pid]) || 0, shown = Math.min(count, 10);
    const fan = Array.from({ length: shown }, (_, k) => `<i style="--k:${k - (shown - 1) / 2}"${k >= prevN && st ? ' class="in"' : ''}></i>`).join('');
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'opp' + (st && st.turn === pid ? ' turn' : '') + (mine && R.target === pid ? ' sel' : '') + (pick && R.target !== pid ? ' pick' : '') + (away ? ' away' : '');
    b.dataset.pid = pid;
    b.disabled = !pick;
    b.innerHTML = `<span class="av"><img src="${BL.iconURI(avatarOf(pid))}" alt=""></span>
      <span class="nm">${pname(pid)}</span>
      <span class="ct">${count} card${count === 1 ? '' : 's'}${away ? ' · away' : ''}</span>
      <span class="ws">${wonSets.map((id) => `<i style="background:${BL.set(id).bg}" title="${NAME(id)}"><img src="${BL.iconURI(BL.set(id).icon)}" alt=""></i>`).join('')}</span>
      <span class="fan" aria-hidden="true" style="--step:${Math.min(9, 64 / Math.max(1, shown)).toFixed(1)}deg">${fan}</span>`;
    b.setAttribute('aria-label', `${pname(pid)}, ${count} cards, ${wonSets.length} sets${pick ? (R.target === pid ? '. Selected.' : '. Tap to ask them.') : ''}`);
    if (pick) b.setAttribute('aria-pressed', String(R.target === pid));
    els.opps.append(b);
  }
  if (st && st.counts) R.prevCounts = Object.assign({}, st.counts);
}
els.opps.addEventListener('click', (e) => {
  const b = e.target.closest('.opp');
  if (!b || b.disabled || !myTurn()) return;
  R.target = b.dataset.pid;
  // picked a set first (by tapping a card)? then this tap asks
  if (R.pendingSet) { sendAsk(R.target, R.pendingSet); return; }
  renderOpps();
  renderAsk();
  paintMsg(false);
});

function renderMe() {
  const st = R.state;
  els.meAv.src = BL.iconURI(avatarOf(uid));
  els.meName.textContent = (R.players[uid] && R.players[uid].name) || 'You';
  const mine = st && st.won ? arr(st.won[uid]) : [];
  els.meInfo.textContent = `${R.hand.length} card${R.hand.length === 1 ? '' : 's'} · ${mine.length} set${mine.length === 1 ? '' : 's'}`;
  els.meTag.classList.toggle('turn', !!st && st.turn === uid && status() === 'playing');
  if (els.setsMe._n !== mine.length) {
    els.setsMe.innerHTML = mine.map((id) => `<div class="won" style="background:${BL.set(id).bg}" title="${NAME(id)}"><img src="${BL.iconURI(BL.set(id).icon)}" alt=""></div>`).join('');
    els.setsMe._n = mine.length;
  }
  els.pileCount.textContent = st ? st.deck : 0;
  els.pileWrap.classList.toggle('empty', !st || !st.deck);
}

function handCounts() {
  const counts = {};
  R.hand.forEach((c) => (counts[E.setOf(c)] = (counts[E.setOf(c)] || 0) + 1));
  return Object.keys(counts).sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b)).map((id) => [id, counts[id]]);
}

function renderAsk() {
  // the hand itself is the way to ask now (tap a card); this line only says when an ask is on its way
  els.ask.innerHTML = R && R.sending && R.state && status() === 'playing' ? '<span class="prompt">Asking…</span>' : '';
}

/* tapping a card in my hand brings it up big; on my turn it has a "Help me with…" button
   (or one button per person, when there's more than one I could ask) */
function openCard(c, kbd) {
  if (!R || !c || !c.dataset.card) return;
  const set = E.setOf(c.dataset.card), can = myTurn();
  if (can) syncTarget();
  const t = can ? (R.target ? [R.target] : targets()) : [];
  const ask = (pid) => () => { if (myTurn()) sendAsk(pid, set); };
  BL.cardPop({
    set, quote: quoteOf(c.dataset.card), fromEl: c, kbd,
    buttons: t.length === 1 ? [{ text: `Help me with ${NAME(set)}!`, act: ask(t[0]) }] : t.map((pid) => ({ text: `Ask ${pname(pid)}`, act: ask(pid) })),
    note: !can ? (R.state && status() === 'playing' ? 'Wait for your turn to ask.' : '') : t.length > 1 ? `Who do you want to ask for ${NAME(set)}?` : `Ask ${pname(t[0])}:`,
    closeText: can ? 'Not now' : 'Close',
  });
}
els.hand.addEventListener('click', (e) => openCard(e.target.closest('.gcard'), e.detail === 0));
els.hand.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const c = e.target.closest('.gcard');
  if (c) { e.preventDefault(); openCard(c, true); }
});
function renderHandHints() {
  els.hand.classList.toggle('locked', !myTurn());
}

/* my hand, with cards sliding in from whoever gave them (or the Help Stack) */
function renderHand() {
  if (!R) return;
  const before = new Map([...els.hand.children].map((e) => [e.dataset.card, e.getBoundingClientRect()]));
  R.hand.sort((a, b) => ORDER.indexOf(E.setOf(a)) - ORDER.indexOf(E.setOf(b)) || (a < b ? -1 : 1));
  const keep = new Set(R.hand);
  const gone = [...els.hand.children].filter((e) => !keep.has(e.dataset.card));
  let si = 0;
  gone.forEach((e) => {
    // cards of a set I just won fly to my sets; cards I handed over are shown flying by onState
    if ((R.myWon || []).includes(E.setOf(e.dataset.card))) exitTo(e, els.setsMe, si++);
    else e.remove();
  });
  let prev = null;
  const nodes = R.hand.map((c) => {
    let e = els.hand.querySelector(`[data-card="${c}"]`);
    if (!e) {
      e = BL.card(E.setOf(c), { cls: 'gcard', label: false, quote: quoteOf(c) }); e.dataset.card = c;
      e.tabIndex = 0; e.setAttribute('role', 'button'); e.setAttribute('aria-label', `${NAME(E.setOf(c))} card`);
    }
    e.classList.toggle('gstart', prev !== null && prev !== E.setOf(c));
    prev = E.setOf(c);
    return e;
  });
  nodes.forEach((e) => els.hand.append(e));
  sizeHand();
  const last = R.state && R.state.last;
  const fromEl = last && last.kind === 'ask' && last.by === uid && last.got ? els.opps.querySelector(`[data-pid="${last.target}"]`) : els.pile;
  const origin = (fromEl || els.pile).getBoundingClientRect();
  let k = 0;
  const drawn = R.myDraw && (R.myDraw.n || 0) > (R.revealedN ?? -1) && !before.has(R.myDraw.d) ? R.myDraw.d : null;
  nodes.forEach((e) => {
    const a = before.get(e.dataset.card), b = e.getBoundingClientRect();
    if (e.dataset.card === drawn) { R.revealedN = R.myDraw.n || 0; revealDraw(e); return; }
    const f = a || origin;
    const dx = f.left + (a ? 0 : (f.width - b.width) / 2) - b.left, dy = f.top + (a ? 0 : (f.height - b.height) / 2) - b.top;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
    if (!a) {
      const delay = k * 90;
      e.classList.add('down');
      setTimeout(() => e.classList.remove('down'), 160 + delay);
      if (k < 8) setTimeout(() => sound('flick'), delay);
    }
    e.animate([{ transform: `translate(${dx}px, ${dy}px) rotate(${a ? 0 : -8}deg)` }, { transform: 'none' }],
      { duration: 600, delay: a ? 0 : k++ * 90, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'backwards' });
  });
  renderMe();
  renderAsk();
  renderHandHints();
}

function sizeHand() {
  const w0 = board.clientWidth;
  const gw = Math.round(Math.max(50, Math.min(98, w0 / (BL.fs && BL.fs.on && w0 < 700 ? 6.2 : 10.5))));
  const n = R.hand.length, groups = new Set(R.hand.map(E.setOf)).size;
  const avail = els.hand.clientWidth - 16, vis = 0.24, gapK = 0.16;
  let w = gw;
  const need = (x) => x + (n - 1) * x * vis + (groups - 1) * x * gapK;
  if (n > 1 && need(w) > avail) w = Math.max(30, avail / (1 + (n - 1) * vis + (groups - 1) * gapK));
  const gap = w * gapK;
  const ov = n > 1 ? Math.max(-w * (1 - vis), Math.min(6, (avail - n * w - (groups - 1) * gap) / (n - 1))) : 0;
  els.hand.style.setProperty('--gw', w + 'px');
  els.hand.style.setProperty('--ov', ov + 'px');
  els.hand.style.setProperty('--gap', gap + 'px');
}
addEventListener('resize', () => { if (R) sizeHand(); });
addEventListener('bl-fit', () => { if (R) sizeHand(); });

/* the card I drew pops up big in the middle (so I can read it), then slides into my hand */
async function revealDraw(e) {
  e.style.visibility = 'hidden';
  let big = null;
  try {
    big = await BL.reveal(E.setOf(e.dataset.card), quoteOf(e.dataset.card), els.pile.getBoundingClientRect(), 1500);
    if (!e.isConnected) return;
    const f = big.getBoundingClientRect(), b = e.getBoundingClientRect();
    e.style.transformOrigin = '0 0';
    e.style.visibility = '';
    big.remove();
    big = null;
    await e.animate([{ transform: `translate(${f.left - b.left}px, ${f.top - b.top}px) scale(${f.width / b.width})` }, { transform: 'none' }],
      { duration: 560, easing: 'cubic-bezier(.2,.8,.2,1)' }).finished;
  } catch (err) { /* left the game mid-reveal */ } finally {
    if (big) big.remove();
    e.style.visibility = '';
    e.style.transformOrigin = '';
  }
}

/* a card leaving my hand flies to a spot on the board (a set I won goes to my sets) */
function exitTo(e, target, i) {
  const r = e.getBoundingClientRect(), t = target.getBoundingClientRect();
  const root = document.fullscreenElement || document.body;
  e.classList.add('flyer');
  e.classList.remove('hl', 'peek');
  e.style.setProperty('--cw', r.width + 'px');
  e.style.left = r.left + 'px';
  e.style.top = r.top + 'px';
  e.style.margin = '0';
  root.append(e);
  const dx = t.left + t.width / 2 - (r.left + r.width / 2), dy = t.top + t.height / 2 - (r.top + r.height / 2);
  e.animate([
    { transform: 'none' },
    { transform: `translate(${dx * 0.3}px, ${dy * 0.3 - 40}px) scale(1.1) rotate(${(i - 1.5) * 8}deg)`, offset: 0.35 },
    { transform: `translate(${dx}px, ${dy}px) scale(.35)`, opacity: 0.2 },
  ], { duration: 750, delay: i * 70, easing: 'cubic-bezier(.4,0,.2,1)', fill: 'forwards' }).finished.then(() => e.remove(), () => e.remove());
}

/* a card flying between two players for moves I'm not part of */
function fly(fromEl, toEl, setId, n = 1) {
  if (!fromEl || !toEl) return;
  const a = fromEl.getBoundingClientRect(), b = toEl.getBoundingClientRect();
  const root = document.fullscreenElement || document.body; // in native full screen only the stage is drawn
  sound('flick');
  for (let i = 0; i < Math.min(n, 4); i++) {
    const c = setId ? BL.card(setId, { mini: true, label: false }) : BL.card('money', { cls: 'down', label: false });
    c.classList.add('flyer');
    c.style.setProperty('--cw', '56px');
    c.style.left = a.left + a.width / 2 - 28 + 'px';
    c.style.top = a.top + a.height / 2 - 39 + 'px';
    root.append(c);
    c.animate([{ transform: 'translate(0,0) rotate(-6deg) scale(.8)', opacity: 0.2 }, { opacity: 1, offset: 0.15 },
      { transform: `translate(${b.left + b.width / 2 - a.left - a.width / 2}px, ${b.top + b.height / 2 - a.top - a.height / 2}px) rotate(8deg) scale(.7)`, opacity: 0.9 }],
    { duration: 750, delay: i * 90, easing: 'cubic-bezier(.3,.7,.2,1)', fill: 'forwards' }).finished.then(() => c.remove(), () => c.remove());
  }
}

function onState(prev) {
  if (!R) return;
  const st = R.state;
  R.sending = false;
  clearTimeout(R.sendT);
  if (!st) { R.seenN = -1; R.lastText = ''; R.awaitDraw = null; els.msg.innerHTML = ''; refresh(); return; }
  if (!prev || st.n !== prev.n || st.turn !== prev.turn) { R.target = null; R.pendingSet = null; }
  const last = st.last;
  const isNew = last && (last.n || 0) !== R.seenN;
  if (isNew) {
    R.seenN = last.n || 0;
    describe(last, st);
    if (last.kind === 'ask' && last.by !== uid) {
      const toEl = els.opps.querySelector(`[data-pid="${last.by}"]`);
      if (last.got && last.target !== uid) fly(els.opps.querySelector(`[data-pid="${last.target}"]`), toEl, last.set, last.got);
      if (last.got && last.target === uid) fly(els.hand, toEl, last.set, last.got);
      if (!last.got && last.drew) fly(els.pile, toEl, null, 1);
    }
    if (last.kind === 'ask') {
      requestAnimationFrame(() => {
        const t = els.opps.querySelector(`[data-pid="${last.target}"]`);
        if (t) t.animate([{ transform: 'none' }, { transform: 'translateY(-5px) scale(1.05)' }, { transform: 'none' }], { duration: 520, easing: 'ease-out' });
      });
    }
    if (last.sets && last.sets.length) {
      sound('set');
      if (last.by === uid) BL.confetti && BL.confetti(BL.set(last.sets[0]), 60, board);
    }
  } else if (!R.lastText) paintMsg(false);
  if (st.phase === 'playing' && st.turn === uid && (!prev || prev.turn !== uid)) setTimeout(() => sound('turn'), isNew && last.sets && last.sets.length ? 900 : 350);
  refresh();
}

function turnText(st) {
  if (st.phase !== 'playing') return '';
  if (st.turn === uid) {
    if (R.sending) return 'Asking…';
    const t = targets();
    return '<b>Your turn!</b> Tap a card.';
  }
  const away = !isOnline(st.turn);
  const again = R.isHost && R.full && R.full.skipped && R.full.skipped[st.turn];
  const skip = R.isHost && away ? ` <button class="o-skip" type="button">${again ? 'Skip again (their cards go back)' : 'Skip their turn'}</button>` : '';
  return `${pname(st.turn)}’s turn${away ? ' (they’re away)' : ''}…${skip}`;
}

/* a Connecting Point to celebrate a set; everyone sees the same one */
const cpFor = (setId, n) => { const q = BL.set(setId).quotes; return q[(n || 0) % q.length]; };

function describe(last, st) {
  let t = '';
  if (last.kind === 'deal') {
    const ds = arr(last.sets);
    t = `Dealt ${last.per} cards each.` + (ds.length ? ` ${ds.map((x) => `${pname(x.by)} started with all four ${NAME(x.set)}!`).join(' ')}` : '');
  } else if (last.kind === 'skip') {
    t = last.returned
      ? `${pname(last.by)} is still away, so their ${last.returned} card${last.returned === 1 ? '' : 's'} went back into the Help Stack. They’ll be dealt back in when they return.`
      : `${pname(last.by)} was skipped.`;
  } else if (last.kind === 'ask') {
    const by = pname(last.by), tg = last.target === uid ? 'you' : pname(last.target), set = `<em>${NAME(last.set)}</em>`;
    t = last.target === uid ? `${by} looked right at you: <span class="say">“Help me with ${set}!”</span> ` : `${by} asked ${tg}: <span class="say">“Help me with ${set}!”</span> `;
    if (last.got) t += last.target === uid ? `You handed over ${last.got}.` : `${last.by === uid ? 'You' : 'They'} got ${last.got}!`;
    else if (last.drew) {
      if (last.by === uid) {
        const mine = R.myDraw && R.myDraw.n === (last.n || 0) ? E.setOf(R.myDraw.d) : last.drewSet;
        if (mine) t += `No luck, so you drew ${AN(mine)} <em>${NAME(mine)}</em>${last.again ? ', just what you wanted!' : '.'}`;
        else { t += 'No luck, so you drew from the Help Stack.'; R.awaitDraw = last.n || 0; }
      } else t += `No luck, so ${by} drew from the Help Stack${last.again ? ` and got the ${NAME(last.set)} they wanted!` : '.'}`;
    } else t += 'No luck, and the Help Stack is empty.';
    const sets = arr(last.sets);
    if (sets.length) {
      t += ` <b>SET!</b> ${by} collected all four ${sets.map((s) => `<em>${NAME(s)}</em>`).join(' and ')}.`;
      t += `<span class="cp">“${esc(cpFor(sets[0], last.n))}”</span>`;
    }
  }
  say(t);
}
els.msg.addEventListener('click', (e) => { if (e.target.closest('.o-skip')) sendSkip(); });

function resultsText(st, order, winners) {
  const n = (p) => arr(st.won[p]).length;
  const rest = order.filter((p) => !winners.includes(p)).map((p) => `${rawName(p)} ${n(p)}`).join(', ');
  const names = winners.map(rawName);
  const lead = winners.length > 1
    ? `We just played Best Life, and ${names.slice(0, -1).join(', ')} and ${names[names.length - 1]} tied with ${n(winners[0])} sets each!`
    : `We just played Best Life, and ${names[0]} won with ${n(winners[0])} set${n(winners[0]) === 1 ? '' : 's'}!`;
  return `${lead}${rest ? ` (${rest})` : ''} 🏆`;
}

function showEnd(st) {
  const order = st.order.slice().sort((a, b) => arr(st.won[b]).length - arr(st.won[a]).length);
  const best = arr(st.won[order[0]]).length;
  const winners = order.filter((p) => arr(st.won[p]).length === best);
  const title = winners.length > 1 ? 'It’s a tie!' : winners[0] === uid ? 'You win!' : `${pname(winners[0])} wins!`;
  const ws = arr(st.won[winners[0]]);
  const cpSet = ws[ws.length - 1] || ORDER[(st.n || 0) % ORDER.length];
  const live = Math.min(6, onlineOrder().length);
  const host = R.isHost
    ? `<button class="btn btn-y" type="button" data-end="again" ${live < 2 ? 'disabled' : ''}>${live < 2 ? 'Waiting for players…' : 'Play again'}</button>
       <button class="btn btn-ghost" type="button" data-end="table">Back to the table</button>
       <p class="o-tip">Back to the table keeps code <b>${R.code}</b> open so more family can join.</p>`
    : `<p class="o-wait">Waiting for ${pname(R.meta.host)} to start another round…</p>`;
  const html = `<div class="o-panel"><h3>${title}</h3>
    <ol class="o-results">${order.map((p) => `<li${winners.includes(p) ? ' class="win"' : ''}><img src="${BL.iconURI(avatarOf(p))}" alt=""><span>${pname(p)}</span><b>${arr(st.won[p]).length} set${arr(st.won[p]).length === 1 ? '' : 's'}</b></li>`).join('')}</ol>
    <p class="end-cp">“${esc(cpFor(cpSet, st.n))}”<small>${NAME(cpSet)} Connecting Point</small></p>
    <div class="o-end-btns">${host}</div>
    <button class="btn btn-ghost o-share-res" type="button" data-end="share">Share results</button>
    <button class="o-link" type="button" data-end="leave">${R.isHost ? 'End game for everyone' : 'Leave game'}</button></div>`;
  if (els.end._html !== html) {
    els.end._html = html;
    els.end.innerHTML = html;
    els.end._share = resultsText(st, order, winners);
  }
  if (!els.end.classList.contains('on')) {
    els.end.classList.add('on');
    const won = winners.includes(uid);
    setTimeout(() => sound(won ? 'win' : 'end'), 300);
    if (won) for (let i = 0; i < 3; i++) setTimeout(() => BL.confetti && BL.confetti(BL.SETS[(i * 5) % 12], 110, board), i * 250);
    const first = els.end.querySelector('button:not(:disabled)');
    if (first) setTimeout(() => first.focus({ preventScroll: true }), 60);
  }
}
els.end.addEventListener('click', (e) => {
  const b = e.target.closest('[data-end]');
  if (!b || b.disabled) return;
  const k = b.dataset.end;
  if (k === 'again') startGame();
  if (k === 'table') backToTable();
  if (k === 'share') BL.shareText && BL.shareText(els.end._share, b);
  if (k === 'leave') leaveToMenu();
});

/* ---------------- show / hide the online board ---------------- */
function show() {
  BL.showBoard && BL.showBoard('online');
}

/* the stage bar's leave button (game.js) asks how to label itself and whether to confirm */
function leaveInfo() {
  if (!R) return { label: 'Leave game', confirm: null };
  if (R.isHost) return { label: 'End game', confirm: othersHere() ? 'Tap again to end it for everyone' : null };
  return { label: 'Leave game', confirm: status() === 'playing' ? 'Tap again to leave' : null };
}

BL.online = { openCreate, openJoin, leave: () => leave(), leaveInfo, get room() { return R && { code: R.code, isHost: R.isHost }; } };
