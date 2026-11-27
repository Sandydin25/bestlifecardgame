/* Stac-Tac-Toe — Main Application Controller
   Council-hardened:
   - Safe WebGL init fallback (menus, modals, and 3-way switch always stay usable)
   - Pauses 3D rendering behind Online lobby / Pause modal and suspends AI while paused
   - Full keyboard & column-key buried sphere cycling (1/2/3 repeat steps down, ArrowUp/ArrowDown)
   - Online Firebase play with string-encoded columns, host rejoin/restore via readRoom(),
     ?room= URL sync, lobby cancellation token, and pending guest move gating with expectedSeq */

(function () {
  'use strict';

  const ASSET_V = 5;
  const hitStat = (k) => { if (window.BL && window.BL.stats) window.BL.stats.hit(k); };
  const E = window.STTEngine;
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  const SOUND_KEY = 'stt-sound';
  const DIFF_NOTES = {
    chill: 'Relaxed pace — great for learning Stack Play.',
    clever: 'Reads Stack Play traps and blocks threats.',
    master: 'Exact opening play and deep Stack Play lookahead.',
  };

  /* ==================== SYNTHESIZED TACTILE AUDIO ==================== */
  let soundOn = true;
  try {
    soundOn = localStorage.getItem(SOUND_KEY) !== 'off';
  } catch (e) {}

  let audioCtx = null;
  function getAudio() {
    if (!soundOn) return null;
    if (!audioCtx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) audioCtx = new AC();
    }
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume().catch(() => {});
    }
    return audioCtx;
  }

  function playTone(freq, dur, type, vol, slideTo) {
    const ctx = getAudio();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type || 'sine';
    osc.frequency.setValueAtTime(freq, now);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, now + dur);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(vol || 0.12, now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + dur + 0.02);
  }

  const sfx = {
    click() { playTone(520, 0.055, 'triangle', 0.07, 680); },
    lift() { playTone(260, 0.14, 'sine', 0.09, 440); },
    cancel() { playTone(320, 0.09, 'sine', 0.06, 210); },
    snap(kind) {
      playTone(kind === 'stack' ? 165 : 195, 0.14, 'triangle', 0.16, 86);
      playTone(kind === 'stack' ? 860 : 1020, 0.055, 'sine', 0.08, 420);
    },
    stackPhase() {
      [440, 554.37, 659.25, 880].forEach((f, i) => {
        setTimeout(() => playTone(f, 0.24, 'triangle', 0.09), i * 65);
      });
    },
    win(selfOwn) {
      const notes = selfOwn ? [440, 370, 311, 523.25] : [523.25, 659.25, 783.99, 1046.5];
      notes.forEach((f, i) => {
        setTimeout(() => playTone(f, 0.34, 'triangle', 0.11), i * 75);
      });
    },
    draw() {
      [440, 523.25, 493.88].forEach((f, i) => {
        setTimeout(() => playTone(f, 0.26, 'sine', 0.09), i * 85);
      });
    },
  };

  const SVG_SOUND_ON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5 6.5 9H3v6h3.5L11 19V5Z" fill="currentColor"/><path d="M15 8.6a4.8 4.8 0 0 1 0 6.8M17.8 5.8a8.8 8.8 0 0 1 0 12.4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="butt"/></svg>';
  const SVG_SOUND_OFF = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5 6.5 9H3v6h3.5L11 19V5Z" fill="currentColor"/><path d="m15.5 9.2 5.6 5.6m0-5.6-5.6 5.6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="butt"/></svg>';

  function renderSoundButtons() {
    $$('.sound-btn').forEach((btn) => {
      btn.innerHTML = soundOn ? SVG_SOUND_ON : SVG_SOUND_OFF;
      btn.setAttribute('aria-pressed', soundOn ? 'true' : 'false');
      btn.setAttribute('aria-label', soundOn ? 'Sound on' : 'Sound muted');
    });
  }

  function toggleSound() {
    soundOn = !soundOn;
    try { localStorage.setItem(SOUND_KEY, soundOn ? 'on' : 'off'); } catch (e) {}
    renderSoundButtons();
    if (soundOn) sfx.click();
  }

  /* ==================== UI ELEMENTS ==================== */
  const appEl = $('#app');
  const cvGL = $('#cvGL');
  const toastEl = $('#toast');
  const phaseFlashEl = $('#phaseFlash');
  const roundBannerEl = $('#roundBanner');
  const rbCardEl = $('#rbCard');
  const rbKickerEl = $('#rbKicker');
  const rbTitleEl = $('#rbTitle');
  const rbSubEl = $('#rbSub');
  const rbActionsEl = $('#rbActions');
  const stackHintEl = $('#stackHint');
  const stackHintTextEl = $('#stackHintText');
  const roomTagEl = $('#roomTag');
  const onlinePanelEl = $('#onlinePanel');

  let toastTimer = null;
  function showToast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('is-show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('is-show'), 2500);
  }

  let flashTimer = null;
  function showStackPhaseFlash() {
    phaseFlashEl.classList.add('is-show');
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => phaseFlashEl.classList.remove('is-show'), 2500);
  }

  /* ==================== GAME STATE ==================== */
  let screen = 'title'; // 'title' | 'online' | 'game'
  let mode = null;      // 'solo' | 'local' | 'online'
  let soloDiff = 'clever';
  let soloHuman = 'o';
  let isPaused = false;

  let match = {
    scores: { o: 0, y: 0 },
    roundNum: 1,
    names: { o: 'Orange', y: 'Yellow' },
    state: E.createRound('o'),
    matchWinner: null,
    seq: 0,
  };

  let aiTimer = null;
  let attractTimer = null;
  let attractState = null;
  let pendingPostAnim = null;

  let netLoaded = false;
  let netLoading = null;
  let lobbyTok = null;
  let online = {
    active: false,
    isHost: false,
    myColor: 'o',
    code: '',
    hostName: 'Orange',
    guestName: '',
    guestUid: null,
    guestOnline: false,
    hostOnline: true,
    lastGuestReqId: null,
    lastAppliedSeq: -1,
    pendingReq: false,
    myName: '',
    bootstrapped: false,
  };
  try { online.myName = localStorage.getItem('stt-name') || ''; } catch (e) {}

  /* ==================== SAFE 3D BOARD CREATION (WITH FALLBACK STUB) ==================== */
  let boardOk = true;
  let board;
  const boardCallbacks = {
    onColumnClick(col) {
      if (screen !== 'game') return;
      handleColumnAction(col);
    },
    onBallSelect() {
      if (screen !== 'game') return;
      sfx.lift();
      syncTurnPromptAndDock();
    },
    onStackDrop(fromCol, row, toCol) {
      if (screen !== 'game') return;
      submitMove({ type: 'stack', from: fromCol, row, to: toCol });
    },
    onCancelSelect() {
      if (screen !== 'game') return;
      sfx.cancel();
      syncTurnPromptAndDock();
    },
    onSnapImpact(kind) {
      if (screen === 'game') sfx.snap(kind);
    },
    onAnimDone() {
      if (screen === 'game') {
        const fn = pendingPostAnim;
        pendingPostAnim = null;
        if (fn) fn();
        else syncHUD();
      }
    },
  };

  try {
    if (!window.STTBoard3D) throw new Error('3D board script unavailable');
    board = window.STTBoard3D.create(cvGL, boardCallbacks);
  } catch (err) {
    boardOk = false;
    console.warn('Stac-Tac-Toe 3D fallback:', err);
    let stubSel = null;
    board = {
      setState() {},
      setScores() {},
      setInteractive() {},
      setExternalHoverCol() {},
      setPaused() {},
      setSelected(s) { stubSel = s ? { col: s.col, row: s.row } : null; },
      getSelected() { return stubSel; },
      setOutcome() {},
      clearOutcome() {},
      setInsets() {},
      setAttract() {},
      isAnimating() { return false; },
      resize() {},
      destroy() {},
    };
  }

  /* ==================== LAYOUT INSETS ==================== */
  const titlePlateEl = $('#titlePlate');
  const hudTopEl = $('#hudTop');
  const colDockEl = $('#colDock');
  function updateBoardInsets() {
    const W = window.innerWidth;
    const H = window.innerHeight;
    let ins = { top: 90, bottom: 110, left: 0, right: 0 };
    if (screen === 'title') {
      const r = titlePlateEl.getBoundingClientRect();
      if (r.width > 60 && r.height > 60) {
        ins = { top: r.top + 12, bottom: H - r.bottom + 26, left: r.left + 6, right: W - r.right + 6 };
      }
    } else if (screen === 'game') {
      const t = hudTopEl.getBoundingClientRect();
      const d = colDockEl.getBoundingClientRect();
      const banner = roundBannerEl.hidden ? null : roundBannerEl.getBoundingClientRect();
      const hintSpace = (!stackHintEl.hidden && stackHintEl.offsetHeight) ? stackHintEl.offsetHeight + 12 : (H < 540 ? 8 : 48);
      const floorY = banner && banner.height ? banner.top - 8 : d.top - hintSpace;
      if (t.height && d.height) ins = { top: t.bottom + 8, bottom: H - floorY, left: 0, right: 0 };
    }
    board.setInsets(ins);
  }

  let insetTimer = null;
  function refreshBoardInsets() {
    updateBoardInsets();
    clearTimeout(insetTimer);
    insetTimer = setTimeout(updateBoardInsets, 360);
  }

  window.addEventListener('resize', () => {
    board.resize();
    updateBoardInsets();
  });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(updateBoardInsets).catch(() => {});

  function setRoundBanner(show) {
    roundBannerEl.hidden = !show;
    updateBoardInsets();
  }

  /* ==================== SCREEN & MODAL HELPERS ==================== */
  function setScreen(next) {
    screen = next;
    appEl.dataset.screen = next;
    $('#hud').setAttribute('aria-hidden', next === 'game' ? 'false' : 'true');
    board.setAttract(next === 'title');
    board.setPaused(next === 'online' || isPaused);
    refreshBoardInsets();
    if (next === 'title') {
      startAttractLoop();
    } else {
      stopAttractLoop();
    }
  }

  function openModal(id) {
    closeModals(true);
    const m = document.getElementById(id);
    if (!m) return;
    m.classList.add('is-open');
    if (id === 'pauseModal') {
      isPaused = true;
      clearTimeout(aiTimer);
      board.setPaused(true);
    }
    const sheet = m.querySelector('.sheet');
    if (sheet) sheet.focus({ preventScroll: true });
  }

  function closeModals(keepPauseFlag) {
    $$('.modal.is-open').forEach((m) => m.classList.remove('is-open'));
    if (!keepPauseFlag && isPaused) {
      isPaused = false;
      board.setPaused(screen === 'online');
      if (screen === 'game') maybeTriggerAI();
    }
  }

  /* ==================== TITLE ATTRACT SHOWCASE ==================== */
  function startAttractLoop() {
    stopAttractLoop();
    if (!boardOk) return;
    attractState = E.createRound('o');
    board.clearOutcome();
    board.setInteractive({ enabled: false });
    board.setState(attractState, { o: 1, y: 2 }, null);
    setDemoReadout();

    let stepCount = 0;
    const step = () => {
      if (screen !== 'title') return;
      if (attractState.phase === 'over' || stepCount > 20) {
        board.clearOutcome();
        attractState = E.createRound(Math.random() < 0.5 ? 'o' : 'y');
        board.setState(attractState, { o: 1, y: 2 }, null);
        setDemoReadout();
        stepCount = 0;
        attractTimer = setTimeout(step, 900);
        return;
      }
      const mv = E.chooseAIMove(attractState, 'chill');
      if (!mv) return;
      attractState = E.applyMove(attractState, mv);
      stepCount++;
      appEl.dataset.turn = attractState.turn;
      board.setState(attractState, null, attractState.lastMove);
      setDemoReadout();
      if (attractState.outcome) {
        setTimeout(() => {
          if (screen === 'title' && attractState.outcome) {
            board.setOutcome(attractState.outcome);
          }
        }, 480);
        attractTimer = setTimeout(step, 2600);
      } else {
        attractTimer = setTimeout(step, attractState.phase === 'stack' ? 1200 : 840);
      }
    };
    attractTimer = setTimeout(step, 700);
  }

  const demoReadoutEl = $('#demoReadout');
  function setDemoReadout() {
    const st = attractState;
    if (!st || !demoReadoutEl) return;
    let txt = 'Phase 1 · Place';
    if (st.outcome) txt = st.outcome.result === 'draw' ? 'Draw' : 'Three in a row';
    else if (st.phase === 'stack') txt = 'Phase 2 · Stack Play';
    demoReadoutEl.textContent = txt;
  }

  function stopAttractLoop() {
    clearTimeout(attractTimer);
    attractTimer = null;
  }

  /* ==================== MATCH FLOW ==================== */
  function isMyTurn() {
    if (screen !== 'game' || isPaused || match.state.phase === 'over' || match.matchWinner) return false;
    if (mode === 'local') return true;
    if (mode === 'solo') return match.state.turn === soloHuman;
    if (mode === 'online') return online.active && !online.pendingReq && match.state.turn === online.myColor;
    return false;
  }

  function isLocalWinner(color) {
    if (mode === 'solo') return color === soloHuman;
    if (mode === 'online') return color === online.myColor;
    return false;
  }

  function startLocalMatch() {
    if (!boardOk) showToast('3D graphics unavailable in this browser.');
    mode = 'local';
    online.active = false;
    match = {
      scores: { o: 0, y: 0 },
      roundNum: 1,
      names: { o: 'Orange', y: 'Yellow' },
      state: E.createRound('o'),
      matchWinner: null,
      seq: 0,
    };
    hitStat('stt_localStarted');
    enterGameScreen();
  }

  function startSoloMatch() {
    if (!boardOk) showToast('3D graphics unavailable in this browser.');
    mode = 'solo';
    online.active = false;
    const cpuLabel = soloDiff === 'master' ? 'Master AI' : soloDiff === 'chill' ? 'Chill AI' : 'Clever AI';
    match = {
      scores: { o: 0, y: 0 },
      roundNum: 1,
      names: {
        o: soloHuman === 'o' ? 'You' : cpuLabel,
        y: soloHuman === 'y' ? 'You' : cpuLabel,
      },
      state: E.createRound('o'),
      matchWinner: null,
      seq: 0,
    };
    hitStat('stt_soloStarted');
    hitStat(soloDiff === 'master' ? 'stt_soloMaster' : soloDiff === 'chill' ? 'stt_soloChill' : 'stt_soloClever');
    closeModals();
    enterGameScreen();
  }

  function enterGameScreen(renderTerminal) {
    clearTimeout(aiTimer);
    pendingPostAnim = null;
    isPaused = false;
    closeModals();
    setRoundBanner(false);
    board.clearOutcome();
    setScreen('game');
    roomTagEl.hidden = mode !== 'online';
    if (mode === 'online') roomTagEl.textContent = `ROOM ${online.code}`;
    board.setState(match.state, match.scores, null);
    syncHUD();
    if (renderTerminal && match.state.outcome) {
      board.setOutcome(match.state.outcome);
      showRoundOutcome(match.state.outcome);
    } else {
      maybeTriggerAI();
    }
  }

  function startNextRound(fromNet) {
    if (mode === 'online' && !online.isHost && !fromNet) {
      if (online.pendingReq) return;
      online.pendingReq = true;
      window.STTNet.sendRequest({ id: Date.now(), kind: 'next-round', expectedSeq: match.seq })
        .then(() => showToast('Signaled ready for next round…'))
        .catch(() => { online.pendingReq = false; showToast('Could not reach host. Try again.'); });
      return;
    }
    clearTimeout(aiTimer);
    pendingPostAnim = null;
    setRoundBanner(false);
    board.clearOutcome();

    match.roundNum += 1;
    const starter = match.roundNum % 2 === 1 ? 'o' : 'y';
    match.state = E.createRound(starter);
    match.seq += 1;

    board.setState(match.state, match.scores, null);
    syncHUD();
    if (mode === 'online' && online.isHost) publishOnlineState(null);
    maybeTriggerAI();
  }

  function startRematch() {
    if (mode === 'solo') { startSoloMatch(); return; }
    if (mode === 'local') { startLocalMatch(); return; }
    if (mode === 'online') {
      if (online.isHost) {
        match.scores = { o: 0, y: 0 };
        match.roundNum = 1;
        match.matchWinner = null;
        match.state = E.createRound('o');
        match.seq += 1;
        hitStat('stt_onlineStarted');
        closeModals();
        setRoundBanner(false);
        board.clearOutcome();
        board.setState(match.state, match.scores, null);
        syncHUD();
        publishOnlineState(null);
      } else {
        if (online.pendingReq) return;
        online.pendingReq = true;
        window.STTNet.sendRequest({ id: Date.now(), kind: 'rematch', expectedSeq: match.seq })
          .then(() => showToast('Requested rematch from host…'))
          .catch(() => { online.pendingReq = false; showToast('Could not reach host. Try again.'); });
      }
    }
  }

  /* ==================== MOVE EXECUTION & BURIED SPHERE CYCLING ==================== */
  function ownedRowsInCol(col) {
    const arr = match.state.cols[col] || [];
    const rows = [];
    for (let r = 0; r < arr.length; r++) {
      if (arr[r] === match.state.turn) rows.push(r);
    }
    return rows;
  }

  function stepSelectedRow(delta) {
    if (!isMyTurn() || board.isAnimating() || match.state.phase !== 'stack') return;
    const sel = board.getSelected();
    if (!sel) return;
    const rows = ownedRowsInCol(sel.col);
    if (!rows.length) return;
    const idx = rows.indexOf(sel.row);
    const nextIdx = idx + delta;
    if (nextIdx >= 0 && nextIdx < rows.length) {
      board.setSelected({ col: sel.col, row: rows[nextIdx] });
      sfx.lift();
      syncTurnPromptAndDock();
    } else if (delta < 0 && nextIdx < 0) {
      board.setSelected(null);
      sfx.cancel();
      syncTurnPromptAndDock();
    }
  }

  function handleColumnAction(col) {
    if (!isMyTurn() || board.isAnimating()) return;
    const st = match.state;

    if (st.phase === 'place') {
      submitMove({ type: 'place', to: col });
      return;
    }

    if (st.phase === 'stack') {
      const sel = board.getSelected();
      if (sel) {
        if (col === sel.col) {
          // Pressing the same column again cycles down to deeper owned spheres, then cancels!
          stepSelectedRow(-1);
        } else {
          submitMove({ type: 'stack', from: sel.col, row: sel.row, to: col });
        }
      } else {
        const rows = ownedRowsInCol(col);
        if (rows.length) {
          board.setSelected({ col, row: rows[rows.length - 1] });
          sfx.lift();
          syncTurnPromptAndDock();
        } else {
          showToast('None of your spheres are in that column');
        }
      }
    }
  }

  function submitMove(move) {
    if (!isMyTurn() || board.isAnimating()) return;
    if (!E.isLegalMove(match.state, move)) return;

    if (mode === 'online' && !online.isHost) {
      online.pendingReq = true;
      board.setInteractive({ enabled: false });
      board.setSelected(null);
      syncHUD();
      const expectedSeq = match.seq;
      window.STTNet.sendRequest({
        id: Date.now() + Math.random(),
        kind: 'move',
        expectedSeq,
        move,
      }).catch(() => {
        if (online.pendingReq && match.seq === expectedSeq) {
          online.pendingReq = false;
          syncHUD();
          showToast('Move failed to send — try again.');
        }
      });
      return;
    }

    applyAndAnimateMove(move);
  }

  function applyAndAnimateMove(move) {
    const prevPhase = match.state.phase;
    const nextState = E.applyMove(match.state, move);
    match.state = nextState;
    match.seq += 1;

    let scoredPlayer = null;
    if (prevPhase === 'place' && nextState.phase === 'stack') {
      hitStat('stt_stackPlayReached');
    }
    if (nextState.outcome) {
      hitStat('stt_roundsPlayed');
    }
    if (nextState.outcome && nextState.outcome.result === 'win') {
      scoredPlayer = nextState.outcome.winner;
      match.scores[scoredPlayer] += 1;
      if (match.scores[scoredPlayer] >= E.MATCH_TARGET) {
        match.matchWinner = scoredPlayer;
        if (mode === 'solo') hitStat('stt_soloFinished');
        else if (mode === 'local') hitStat('stt_localFinished');
        else if (mode === 'online' && online.isHost) hitStat('stt_onlineFinished');
      }
    }

    const seq = match.seq;
    const afterLand = () => {
      if (screen !== 'game' || match.seq !== seq) return;
      if (prevPhase === 'place' && nextState.phase === 'stack') {
        sfx.stackPhase();
        showStackPhaseFlash();
      }
      if (nextState.outcome) {
        syncHUD();
        board.setOutcome(nextState.outcome);
        if (scoredPlayer) board.setScores(match.scores, scoredPlayer);
        if (nextState.outcome.result === 'draw') sfx.draw();
        else sfx.win(nextState.outcome.selfOwn);
        showRoundOutcome(nextState.outcome);
      } else {
        syncHUD();
        maybeTriggerAI();
      }
    };

    board.setInteractive({ enabled: false });
    pendingPostAnim = afterLand;
    board.setState(nextState, null, nextState.lastMove);

    if (mode === 'online' && online.isHost) {
      publishOnlineState(nextState.lastMove);
    }

    if (nextState.outcome) {
      updateDockAndHint();
    } else {
      syncHUD();
    }

    if (!board.isAnimating()) {
      pendingPostAnim = null;
      afterLand();
    }
  }

  function maybeTriggerAI() {
    clearTimeout(aiTimer);
    if (screen !== 'game' || isPaused || mode !== 'solo' || match.state.phase === 'over') return;
    if (match.state.turn === soloHuman) return;

    const delay = match.state.phase === 'stack' ? 320 : 240;
    aiTimer = setTimeout(() => {
      if (screen !== 'game' || isPaused || mode !== 'solo' || match.state.phase === 'over') return;
      if (match.state.turn === soloHuman) return;
      const mv = E.chooseAIMove(match.state, soloDiff);
      if (mv) applyAndAnimateMove(mv);
    }, delay);
  }

  /* ==================== HUD RENDERING ==================== */
  function syncTurnPromptAndDock() {
    const st = match.state;
    const txt = $('#turnText');
    const sel = board.getSelected();
    const activeName = match.names[st.turn];
    const colorWord = st.turn === 'o' ? 'Orange' : 'Yellow';

    if (st.phase === 'over') {
      if (st.outcome && st.outcome.result === 'draw') {
        txt.textContent = 'Round drawn — both aligned 3';
      } else {
        const w = st.outcome.winner;
        txt.textContent = isLocalWinner(w)
          ? `You take Round ${match.roundNum}`
          : `${match.names[w]} takes Round ${match.roundNum}`;
      }
    } else if (mode === 'solo' && st.turn !== soloHuman) {
      txt.textContent = `${activeName} is thinking…`;
    } else if (mode === 'online' && online.pendingReq) {
      txt.textContent = 'Sending move…';
    } else if (mode === 'online' && st.turn !== online.myColor) {
      txt.textContent = `Waiting for ${activeName}…`;
    } else if (st.phase === 'place') {
      const who = mode === 'local' ? `${colorWord}’s turn` : 'Your turn';
      txt.textContent = `${who} — place a sphere`;
    } else if (sel) {
      const count = st.cols[sel.col].length - sel.row;
      txt.textContent = count > 1
        ? `Holding ${count} spheres — choose a destination`
        : 'Holding 1 sphere — choose a destination';
    } else {
      const who = mode === 'local' ? `${colorWord}’s turn` : 'Your turn';
      const article = st.turn === 'o' ? 'an orange' : 'a yellow';
      txt.textContent = `${who} — lift ${article} sphere`;
    }

    updateDockAndHint();
  }

  function syncHUD() {
    const st = match.state;
    appEl.dataset.turn = st.turn;

    $('#nameY').textContent = match.names.y;
    $('#nameO').textContent = match.names.o;
    $('#scoreY').textContent = String(match.scores.y);
    $('#scoreO').textContent = String(match.scores.o);

    $('#sbY').classList.toggle('is-turn', st.phase !== 'over' && st.turn === 'y');
    $('#sbO').classList.toggle('is-turn', st.phase !== 'over' && st.turn === 'o');

    $$('#pipsY i').forEach((el, i) => el.classList.toggle('on', i < match.scores.y));
    $$('#pipsO i').forEach((el, i) => el.classList.toggle('on', i < match.scores.o));

    const resYEl = $('#resY');
    const resOEl = $('#resO');
    $$('#resY i').forEach((el, i) => el.classList.toggle('on', i < st.reserve.y));
    $$('#resO i').forEach((el, i) => el.classList.toggle('on', i < st.reserve.o));
    const hideReserve = st.reserve.o === 0 && st.reserve.y === 0;
    resYEl.classList.toggle('is-empty', hideReserve);
    resOEl.classList.toggle('is-empty', hideReserve);

    const badge = $('#phaseBadge');
    const isStack = st.phase === 'stack' || (st.phase === 'over' && hideReserve);
    badge.textContent = isStack ? 'STACK PLAY' : 'PLACE';
    badge.classList.toggle('is-stack', isStack);

    const canAct = isMyTurn() && !board.isAnimating();
    board.setInteractive({
      enabled: canAct,
      phase: st.phase,
      turn: st.turn,
      canSelect: canAct && st.phase === 'stack',
    });

    syncTurnPromptAndDock();
  }

  function updateDockAndHint() {
    const st = match.state;
    const canAct = isMyTurn() && !board.isAnimating();
    const sel = board.getSelected();
    const wasHidden = stackHintEl.hidden;

    if (sel && st.phase === 'stack' && canAct) {
      const count = st.cols[sel.col].length - sel.row;
      const owned = ownedRowsInCol(sel.col).length;
      const more = owned > 1 ? ' (tap again for lower)' : '';
      stackHintTextEl.textContent = count > 1
        ? `Holding ${count} spheres — choose a column${more}`
        : `Holding 1 sphere — choose a column${more}`;
      stackHintEl.hidden = false;
    } else {
      stackHintEl.hidden = true;
    }
    if (wasHidden !== stackHintEl.hidden && window.innerHeight < 540) {
      updateBoardInsets();
    }

    $$('.col-btn').forEach((btn) => {
      const c = Number(btn.dataset.col);
      const cnt = (st.cols[c] || []).length;
      btn.querySelector('[data-cnt]').textContent = String(cnt);

      let disabled = !canAct;
      let isTarget = false;
      let isSrc = false;

      if (canAct && st.phase === 'place') {
        isTarget = true;
      } else if (canAct && st.phase === 'stack') {
        if (sel) {
          if (c === sel.col) {
            isSrc = true;
            disabled = false;
          } else {
            isTarget = true;
          }
        } else {
          const hasMine = (st.cols[c] || []).includes(st.turn);
          disabled = !hasMine;
        }
      }

      btn.disabled = disabled;
      btn.classList.toggle('is-target', isTarget);
      btn.classList.toggle('is-src', isSrc);
    });
  }

  function showRoundOutcome(outcome) {
    if (match.matchWinner) {
      const w = match.matchWinner;
      const pill = $('#winPill');
      pill.className = 'win-pill ' + (w === 'y' ? 'is-y' : 'is-o');
      $('#winH').textContent = isLocalWinner(w) ? 'YOU WIN' : `${match.names[w].toUpperCase()} WINS`;
      $('#wsNameY').textContent = match.names.y;
      $('#wsNameO').textContent = match.names.o;
      $('#wsNumY').textContent = String(match.scores.y);
      $('#wsNumO').textContent = String(match.scores.o);

      let note = describeWinReason(outcome);
      if (mode === 'solo' || mode === 'online') {
        note = (isLocalWinner(w) ? 'You took the match. ' : `${match.names[w]} took this one. `) + note;
      }
      $('#winNote').textContent = note;

      const btns = $('#winBtns');
      btns.innerHTML = '';
      const rematch = document.createElement('button');
      rematch.className = 'btn btn-primary';
      rematch.textContent = mode === 'online' && !online.isHost ? 'Request Rematch' : 'Play Again';
      rematch.addEventListener('click', () => { sfx.click(); startRematch(); });
      btns.appendChild(rematch);

      const quit = document.createElement('button');
      quit.className = 'btn btn-ghost';
      quit.textContent = 'Back to Title';
      quit.addEventListener('click', () => { sfx.click(); leaveGameToTitle(); });
      btns.appendChild(quit);

      setTimeout(() => {
        if (screen === 'game' && match.matchWinner) openModal('winModal');
      }, 1200);
      return;
    }

    rbCardEl.className = 'rb-card ' + (outcome.result === 'draw' ? 'draw' : outcome.winner === 'y' ? 'win-y' : 'win-o');
    rbKickerEl.textContent = `ROUND ${match.roundNum} · FIRST TO ${E.MATCH_TARGET}`;

    if (outcome.result === 'draw') {
      rbTitleEl.textContent = 'ROUND DRAW';
      rbSubEl.textContent = 'Both colors aligned 3 at once. No point awarded.';
    } else {
      const w = outcome.winner;
      rbTitleEl.textContent = isLocalWinner(w) ? 'YOU SCORE' : `${match.names[w].toUpperCase()} SCORES`;
      rbSubEl.textContent = describeWinReason(outcome);
    }

    rbActionsEl.innerHTML = '';
    const nextBtn = document.createElement('button');
    nextBtn.className = 'btn btn-primary';
    nextBtn.textContent = mode === 'online' && !online.isHost ? 'Ready for Next Round' : 'Next Round';
    nextBtn.addEventListener('click', () => { sfx.click(); startNextRound(false); });
    rbActionsEl.appendChild(nextBtn);
    setRoundBanner(true);
  }

  function describeWinReason(outcome) {
    if (!outcome) return '';
    if (outcome.result === 'draw') return 'Both colors aligned 3 at once.';
    const dirMap = { v: 'Vertical', h: 'Horizontal', du: 'Diagonal', dd: 'Diagonal' };
    const dir = outcome.lines && outcome.lines[0] ? dirMap[outcome.lines[0].dir] : '3-in-a-row';
    if (outcome.selfOwn) {
      return `That move completed the opponent’s ${dir.toLowerCase()} 3 in a row.`;
    }
    return `${dir} 3 in a row.`;
  }

  function openPauseMenu() {
    const k = $('#pauseK');
    const btns = $('#pauseBtns');
    k.textContent = mode === 'online' ? `Online · Room ${online.code}` : mode === 'solo' ? 'Solo match' : 'Same device';
    btns.innerHTML = '';

    const add = (label, cls, fn) => {
      const b = document.createElement('button');
      b.className = 'btn ' + cls;
      b.textContent = label;
      b.addEventListener('click', () => { sfx.click(); fn(); });
      btns.appendChild(b);
    };

    add('Resume', 'btn-primary', () => closeModals());
    add('How to Play', 'btn-ghost', () => openModal('howtoModal'));
    if (mode !== 'online') {
      add('Restart Match', 'btn-ghost', () => {
        closeModals();
        if (mode === 'solo') startSoloMatch();
        else startLocalMatch();
      });
    }
    add(mode === 'online' ? 'Leave Room' : 'Quit to Title', 'btn-ghost', () => leaveGameToTitle());
    openModal('pauseModal');
  }

  function cancelPendingLobby() {
    if (lobbyTok) {
      lobbyTok.cancelled = true;
      lobbyTok = null;
    }
  }

  function leaveGameToTitle() {
    cancelPendingLobby();
    clearTimeout(aiTimer);
    pendingPostAnim = null;
    isPaused = false;
    closeModals();
    setRoundBanner(false);
    board.clearOutcome();
    if (online.active && window.STTNet) {
      window.STTNet.leave(false);
    }
    online.active = false;
    online.pendingReq = false;
    online.bootstrapped = false;
    mode = null;
    if (location.search.includes('room=')) {
      history.replaceState(null, '', location.pathname);
    }
    setScreen('title');
  }

  /* ==================== ONLINE MULTIPLAYER ==================== */
  function loadNet() {
    if (netLoaded && window.STTNet) return Promise.resolve(window.STTNet);
    if (netLoading) return netLoading;
    netLoading = new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = `net.js?v=${ASSET_V}`;
      s.onload = () => { netLoaded = true; res(window.STTNet); };
      s.onerror = () => rej(new Error('Could not load online module.'));
      document.head.appendChild(s);
    });
    netLoading.catch(() => { netLoading = null; });
    return netLoading;
  }

  function openOnlineLobby(prefillCode) {
    cancelPendingLobby();
    setScreen('online');
    renderOnlineEntry(prefillCode || '', '');
    loadNet().catch((e) => renderOnlineEntry(prefillCode || '', e.message));
  }

  function renderOnlineEntry(prefillCode, errMsg) {
    const savedName = online.myName || '';
    onlinePanelEl.innerHTML = `
      <p class="op-kicker">Online · 2 players · First to 3</p>
      <h2 class="op-h">Play a Friend</h2>
      <p class="op-p">Create a private 4-letter room code and share it, or enter a friend’s code to join.</p>
      ${errMsg ? `<div class="op-err">${escapeHtml(errMsg)}</div>` : ''}
      <label class="op-label" for="opName">Your Name</label>
      <input class="op-input" id="opName" type="text" maxlength="16" placeholder="e.g. Alex" value="${escapeHtml(savedName)}">
      <button class="btn btn-orange btn-wide" id="opCreate" type="button">Create Room</button>
      <div class="op-divider">Or join a room</div>
      <label class="op-label" for="opCode">4-Letter Code</label>
      <input class="op-input op-code-input" id="opCode" type="text" maxlength="4" autocomplete="off" autocapitalize="characters" placeholder="ABCD" value="${escapeHtml(prefillCode)}">
      <button class="btn btn-yellow btn-wide" id="opJoin" type="button">Join Room</button>
    `;

    const nameIn = $('#opName');
    const codeIn = $('#opCode');
    const saveName = () => {
      online.myName = Array.from(nameIn.value.trim()).slice(0, 16).join('');
      try { localStorage.setItem('stt-name', online.myName); } catch (e) {}
      return online.myName;
    };

    $('#opCreate').addEventListener('click', async () => {
      sfx.click();
      cancelPendingLobby();
      const tok = { cancelled: false };
      lobbyTok = tok;
      const nm = saveName() || 'Orange';
      $('#opCreate').disabled = true;
      $('#opJoin').disabled = true;
      $('#opCreate').textContent = 'Creating…';
      try {
        const net = await loadNet();
        if (tok.cancelled) return;
        const info = await net.create(nm, tok);
        if (tok.cancelled) { net.leave(false); return; }
        lobbyTok = null;
        attachOnlineRoom(info, nm);
      } catch (e) {
        if (e && e.cancelled) return;
        if (screen === 'online') renderOnlineEntry(codeIn.value, e.message || 'Could not create room.');
      }
    });

    $('#opJoin').addEventListener('click', async () => {
      sfx.click();
      cancelPendingLobby();
      const tok = { cancelled: false };
      lobbyTok = tok;
      const nm = saveName() || 'Yellow';
      const code = codeIn.value.trim().toUpperCase();
      $('#opCreate').disabled = true;
      $('#opJoin').disabled = true;
      $('#opJoin').textContent = 'Joining…';
      try {
        const net = await loadNet();
        if (tok.cancelled) return;
        const info = await net.join(code, nm, tok);
        if (tok.cancelled) { net.leave(false); return; }
        lobbyTok = null;
        attachOnlineRoom(info, nm);
      } catch (e) {
        if (e && e.cancelled) return;
        if (screen === 'online') renderOnlineEntry(code, e.message || 'Could not join room.');
      }
    });
  }

  function renderHostWaiting() {
    const url = `${location.origin}${location.pathname}?room=${online.code}`;
    onlinePanelEl.innerHTML = `
      <p class="op-kicker">Room ready · You play Orange</p>
      <h2 class="op-h">Waiting for Opponent</h2>
      <div class="code-box">
        <div class="code-big">${escapeHtml(online.code)}</div>
      </div>
      <p class="op-p">Share this code or invite link. The match starts automatically once your friend joins.</p>
      <div class="op-row">
        <button class="btn btn-yellow" id="opCopy" type="button">Copy Invite Link</button>
        <button class="btn btn-ghost" id="opCancel" type="button">Cancel</button>
      </div>
    `;
    $('#opCopy').addEventListener('click', () => {
      sfx.click();
      if (navigator.share) {
        navigator.share({ title: 'Play Stac-Tac-Toe', text: `Join my Stac-Tac-Toe room: ${online.code}`, url }).catch(() => {});
      } else if (navigator.clipboard) {
        navigator.clipboard.writeText(url).then(() => showToast('Invite link copied!')).catch(() => showToast(`Code: ${online.code}`));
      } else {
        showToast(`Code: ${online.code}`);
      }
    });
    $('#opCancel').addEventListener('click', () => {
      sfx.click();
      leaveGameToTitle();
    });
  }

  function renderGuestWaiting() {
    onlinePanelEl.innerHTML = `
      <p class="op-kicker">Joined room ${escapeHtml(online.code)} · You play Yellow</p>
      <h2 class="op-h">Connecting…</h2>
      <p class="op-p">Waiting for the host to start the board.</p>
      <button class="btn btn-ghost btn-wide" id="opCancel" type="button">Leave Room</button>
    `;
    $('#opCancel').addEventListener('click', () => {
      sfx.click();
      leaveGameToTitle();
    });
  }

  async function attachOnlineRoom(info, myName) {
    const net = window.STTNet;
    online.active = true;
    online.isHost = info.isHost;
    online.myColor = info.isHost ? 'o' : 'y';
    online.code = info.code;
    online.guestUid = null;
    online.lastGuestReqId = null;
    online.lastAppliedSeq = -1;
    online.pendingReq = false;
    online.bootstrapped = false;
    online.hostName = info.isHost ? myName : 'Orange';
    online.guestName = info.isHost ? '' : myName;

    // Keep room code in URL so an iOS Safari reload automatically reconnects!
    try { history.replaceState(null, '', `${location.pathname}?room=${info.code}`); } catch (e) {}

    if (info.isHost) renderHostWaiting();
    else renderGuestWaiting();

    // Bootstrap from authoritative server snapshot BEFORE attaching live listeners (prevents rejoin race/0-0 reset!)
    try {
      const snap = await net.readRoom();
      if (!online.active || net.code !== info.code) return;
      if (snap && snap.meta) {
        if (snap.meta.guest) online.guestUid = snap.meta.guest;
        if (info.isHost && snap.state && snap.meta.status === 'playing') {
          const gp = online.guestUid && snap.players[online.guestUid];
          if (gp) {
            online.guestName = gp.name || snap.state.names.y;
            online.guestOnline = gp.online !== false;
            if (gp.req) online.lastGuestReqId = gp.req.id;
          }
          mode = 'online';
          match = {
            scores: snap.state.scores,
            roundNum: snap.state.roundNum,
            names: snap.state.names,
            state: snap.state.state,
            matchWinner: snap.state.matchWinner,
            seq: snap.state.seq,
          };
          online.bootstrapped = true;
          enterGameScreen(true);
        } else if (!info.isHost && snap.state) {
          online.bootstrapped = true;
          applyRemoteState(snap.state);
        }
      }
    } catch (e) {
      console.warn('Room bootstrap failed:', e);
    }
    online.bootstrapped = true;

    net.on({
      meta(m) {
        if (!m) {
          showToast('Room closed by host.');
          leaveGameToTitle();
          return;
        }
        if (m.guest) online.guestUid = m.guest;
      },
      players(pl) {
        if (!online.bootstrapped) return;
        const ids = Object.keys(pl || {});
        if (online.isHost) {
          if (!online.guestUid) {
            const guestId = ids.find((id) => id !== net.uid && pl[id] && pl[id].name && pl[id].online !== false);
            if (guestId) {
              online.guestUid = guestId;
              online.guestName = pl[guestId].name;
              net.setMeta({ guest: guestId, status: 'playing' });
              startOnlineHostMatch();
            }
          } else {
            const gp = pl[online.guestUid];
            if (!gp) {
              showToast('Opponent left the room.');
              leaveGameToTitle();
              return;
            }
            if (gp.online === false && online.guestOnline) {
              showToast(`${gp.name} disconnected…`);
            }
            online.guestOnline = gp.online !== false;
            // If host rejoined while status was lobby with a seated guest, start cleanly
            if (screen !== 'game' && mode !== 'online') {
              online.guestName = gp.name || online.guestName || 'Yellow';
              startOnlineHostMatch();
            }
            if (gp.req && gp.req.id !== online.lastGuestReqId) {
              online.lastGuestReqId = gp.req.id;
              handleGuestRequest(gp.req);
            }
          }
        } else {
          const hostEntry = ids.find((id) => id !== net.uid && pl[id] && pl[id].name);
          if (hostEntry) {
            online.hostName = pl[hostEntry].name;
            if (pl[hostEntry].online === false && online.hostOnline) {
              showToast('Host disconnected…');
            }
            online.hostOnline = pl[hostEntry].online !== false;
          }
        }
      },
      state(st) {
        if (!st || online.isHost) return;
        applyRemoteState(st);
      },
      taken() {
        showToast('Room opened in another tab.');
        leaveGameToTitle();
      },
      error(e) {
        showToast(e && e.message ? e.message : 'Connection error.');
      },
    });
  }

  function startOnlineHostMatch() {
    mode = 'online';
    online.guestOnline = true;
    match = {
      scores: { o: 0, y: 0 },
      roundNum: 1,
      names: { o: online.hostName || 'Orange', y: online.guestName || 'Yellow' },
      state: E.createRound('o'),
      matchWinner: null,
      seq: 1,
    };
    hitStat('stt_onlineStarted');
    enterGameScreen();
    publishOnlineState(null);
  }

  function publishOnlineState(lastMove) {
    if (!online.active || !online.isHost || !window.STTNet) return;
    window.STTNet.sendState({
      seq: match.seq,
      scores: match.scores,
      roundNum: match.roundNum,
      names: match.names,
      matchWinner: match.matchWinner,
      state: match.state,
      anim: lastMove || null,
    }).catch(() => showToast('Connection glitch — retrying…'));
  }

  function handleGuestRequest(req) {
    if (!online.active || !online.isHost || !req) return;
    if (Number.isFinite(req.expectedSeq) && req.expectedSeq !== match.seq) return;
    if (req.kind === 'move' && req.move) {
      if (match.state.phase !== 'over' && match.state.turn === 'y' && E.isLegalMove(match.state, req.move)) {
        applyAndAnimateMove(req.move);
      }
    } else if (req.kind === 'next-round') {
      if (match.state.phase === 'over' && !match.matchWinner) {
        startNextRound(true);
      }
    } else if (req.kind === 'rematch') {
      if (match.matchWinner) {
        startRematch();
      }
    }
  }

  function applyRemoteState(remote) {
    if (!remote || !remote.state || !Array.isArray(remote.state.cols)) return;
    if (remote.seq === online.lastAppliedSeq) return;
    const isFreshScreen = screen !== 'game';
    const prevPhase = match.state ? match.state.phase : 'place';
    const prevScores = Object.assign({}, match.scores);
    online.lastAppliedSeq = remote.seq;
    online.pendingReq = false;

    mode = 'online';
    match = {
      scores: remote.scores || { o: 0, y: 0 },
      roundNum: remote.roundNum || 1,
      names: remote.names || { o: online.hostName, y: online.guestName || 'Yellow' },
      state: remote.state,
      matchWinner: remote.matchWinner || null,
      seq: remote.seq,
    };

    if (isFreshScreen) {
      enterGameScreen(true);
      return;
    }

    closeModals();
    if (match.state.phase !== 'over') {
      setRoundBanner(false);
      board.clearOutcome();
    }

    const animHint = remote.anim || null;
    const seq = remote.seq;
    const afterRemoteLand = () => {
      if (screen !== 'game' || online.lastAppliedSeq !== seq) return;
      if (prevPhase === 'place' && match.state.phase === 'stack') {
        sfx.stackPhase();
        showStackPhaseFlash();
      }
      if (match.state.outcome) {
        const outcome = match.state.outcome;
        const scored = outcome.result === 'win' && match.scores[outcome.winner] > prevScores[outcome.winner]
          ? outcome.winner : null;
        syncHUD();
        board.setOutcome(outcome);
        if (scored) board.setScores(match.scores, scored);
        if (outcome.result === 'draw') sfx.draw();
        else sfx.win(outcome.selfOwn);
        showRoundOutcome(outcome);
      } else {
        syncHUD();
      }
    };

    pendingPostAnim = animHint ? afterRemoteLand : null;
    board.setState(match.state, animHint ? null : match.scores, animHint);
    if (!animHint || !board.isAnimating()) {
      pendingPostAnim = null;
      afterRemoteLand();
    } else if (match.state.outcome) {
      updateDockAndHint();
    } else {
      syncHUD();
    }
  }

  function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  /* ==================== EVENT WIRING ==================== */
  document.addEventListener('click', (ev) => {
    const actBtn = ev.target.closest('[data-act]');
    if (actBtn) {
      const act = actBtn.dataset.act;
      if (act === 'sound') { toggleSound(); return; }
      sfx.click();
      if (act === 'solo') openModal('soloModal');
      else if (act === 'solo-go') startSoloMatch();
      else if (act === 'local') startLocalMatch();
      else if (act === 'online') openOnlineLobby('');
      else if (act === 'howto') openModal('howtoModal');
      else if (act === 'pause') openPauseMenu();
      else if (act === 'close') closeModals();
      else if (act === 'title') leaveGameToTitle();
      else if (act === 'next-round') startNextRound(false);
      else if (act === 'cancel-sel') {
        board.setSelected(null);
        sfx.cancel();
        syncTurnPromptAndDock();
      }
      return;
    }

    const colBtn = ev.target.closest('[data-col]');
    if (colBtn && !colBtn.disabled) {
      handleColumnAction(Number(colBtn.dataset.col));
      return;
    }

    const diffBtn = ev.target.closest('[data-diff]');
    if (diffBtn) {
      sfx.click();
      soloDiff = diffBtn.dataset.diff;
      $$('#diffSeg .seg-btn').forEach((b) => {
        const on = b.dataset.diff === soloDiff;
        b.classList.toggle('is-on', on);
        b.setAttribute('aria-checked', on ? 'true' : 'false');
      });
      $('#diffNote').textContent = DIFF_NOTES[soloDiff];
      return;
    }

    const colorBtn = ev.target.closest('[data-color]');
    if (colorBtn) {
      sfx.click();
      soloHuman = colorBtn.dataset.color;
      $$('#colorSeg .seg-btn').forEach((b) => {
        const on = b.dataset.color === soloHuman;
        b.classList.toggle('is-on', on);
        b.setAttribute('aria-checked', on ? 'true' : 'false');
      });
      return;
    }

    if (ev.target.classList.contains('modal') && ev.target.id !== 'winModal') {
      closeModals();
    }
  });

  document.addEventListener('keydown', (ev) => {
    if (ev.target && (ev.target.tagName === 'INPUT' || ev.target.tagName === 'TEXTAREA')) return;
    if (ev.key === 'm' || ev.key === 'M') { toggleSound(); return; }
    if (ev.key === 'Escape') {
      if ($('.modal.is-open')) {
        if (!$('#winModal').classList.contains('is-open')) closeModals();
      } else if (screen === 'game') {
        if (board.getSelected()) {
          board.setSelected(null);
          sfx.cancel();
          syncTurnPromptAndDock();
        } else {
          openPauseMenu();
        }
      }
      return;
    }
    if (screen === 'game' && !$('.modal.is-open')) {
      if (ev.key === '1') handleColumnAction(0);
      else if (ev.key === '2') handleColumnAction(1);
      else if (ev.key === '3') handleColumnAction(2);
      else if (ev.key === 'ArrowDown') { ev.preventDefault(); stepSelectedRow(-1); }
      else if (ev.key === 'ArrowUp') { ev.preventDefault(); stepSelectedRow(1); }
    }
  });

  /* ==================== INTERACTIVE MARK & COLUMN KEY HOVER SYNC ==================== */
  const heroMark = $('#heroMark');
  if (heroMark) {
    const cellToLetter = { 0: 0, 1: 1, 2: 2, 3: 3, 5: 4, 6: 5, 7: 6, 9: 7, 10: 8, 11: 9 };
    const letters = Array.from(heroMark.querySelectorAll('.ml'));
    heroMark.querySelectorAll('.mc').forEach((cell) => {
      const idx = cellToLetter[cell.dataset.cell];
      const letter = letters[idx];
      if (!letter) return;
      const isO = cell.classList.contains('mc-o');
      const popOn = () => letter.classList.add('is-pop', isO ? 'is-pop-o' : 'is-pop-y');
      const popOff = () => letter.classList.remove('is-pop', 'is-pop-o', 'is-pop-y');
      cell.addEventListener('pointerenter', popOn);
      cell.addEventListener('pointerleave', popOff);
      cell.addEventListener('click', () => {
        sfx.click();
        cell.classList.add('is-lit');
        popOn();
        setTimeout(() => { cell.classList.remove('is-lit'); popOff(); }, 280);
      });
    });
  }

  $$('.col-btn').forEach((btn) => {
    const c = Number(btn.dataset.col);
    btn.addEventListener('pointerenter', () => { if (!btn.disabled) board.setExternalHoverCol(c); });
    btn.addEventListener('pointerleave', () => { board.setExternalHoverCol(-1); });
  });

  /* ==================== 3-GAME SWITCH (BEST LIFE | ON GUARD | STAC) ==================== */
  const sw = $('#gameSwitch');
  if (sw) {
    const swPill = sw.querySelector('.gs-pill');
    const swBL = sw.querySelector('.gs-bl');
    const swOG = sw.querySelector('.gs-og');
    const swSTT = sw.querySelector('.gs-stt');
    const placePill = (tab) => {
      if (!swPill || !tab) return;
      swPill.style.setProperty('--x', tab.offsetLeft + 'px');
      swPill.style.setProperty('--w', tab.offsetWidth + 'px');
    };
    const settleSwitch = () => {
      if (sw.classList.contains('go') || !swSTT || !swSTT.offsetWidth) return;
      placePill(swSTT);
      if (!sw.classList.contains('ready')) requestAnimationFrame(() => sw.classList.add('ready'));
    };
    settleSwitch();
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(settleSwitch).catch(() => {});
    window.addEventListener('resize', settleSwitch);

    // Warm wipe fonts before click so transition text never swaps mid-slide
    if (swBL) swBL.addEventListener('pointerenter', () => document.fonts && document.fonts.load("400 80px 'Anton'").catch(() => {}), { once: true });
    if (swOG) swOG.addEventListener('pointerenter', () => document.fonts && document.fonts.load("italic 900 80px 'Barlow Condensed'").catch(() => {}), { once: true });

    let navTimers = [];
    const goOther = (e, tab, cls, sessionKey, wipeCls, wipeHtml) => {
      if (e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      if (sw.classList.contains('go')) return;
      sw.classList.add('ready', 'go', cls);
      placePill(tab);
      sfx.click();
      try { sessionStorage.setItem(sessionKey, 'stactactoe'); } catch (err) {}
      navTimers.push(setTimeout(() => {
        const w = document.createElement('div');
        w.className = wipeCls;
        w.setAttribute('aria-hidden', 'true');
        w.innerHTML = wipeHtml;
        document.body.append(w);
        navTimers.push(setTimeout(() => { location.href = tab.href; }, 520));
      }, 380));
    };

    if (swBL) {
      swBL.addEventListener('click', (e) => goOther(
        e, swBL, 'go-bl', 'bl-from', 'bl-wipe',
        '<i class="w y"></i><i class="w n"><b>BEST LIFE</b></i>'
      ));
    }
    if (swOG) {
      swOG.addEventListener('click', (e) => goOther(
        e, swOG, 'go-og', 'og-from', 'og-wipe',
        '<i class="r"><b>ON</b></i><i class="b"><b>GUARD</b></i>'
      ));
    }
    if (swSTT) {
      swSTT.addEventListener('click', (e) => {
        e.preventDefault();
        sfx.click();
        try { swSTT.animate([{ transform: 'none' }, { transform: 'scale(1.06)' }, { transform: 'none' }], { duration: 260, easing: 'ease-out' }); } catch (err) {}
      });
    }
    window.addEventListener('pagehide', () => { navTimers.forEach(clearTimeout); navTimers = []; });
    window.addEventListener('pageshow', (e) => {
      if (!e.persisted) return;
      navTimers.forEach(clearTimeout); navTimers = [];
      $$('.bl-wipe, .og-wipe').forEach((w) => w.remove());
      sw.classList.remove('go', 'go-bl', 'go-og');
      settleSwitch();
    });
  }

  const sttCover = $('#sttCover');
  if (sttCover) {
    if (document.documentElement.classList.contains('from-other')) {
      const done = () => {
        sttCover.classList.add('out');
        setTimeout(() => { sttCover.remove(); document.documentElement.classList.remove('from-other'); }, 600);
      };
      requestAnimationFrame(() => setTimeout(done, 70));
    } else {
      sttCover.remove();
    }
  }

  /* ==================== BOOT ==================== */
  renderSoundButtons();
  const params = new URLSearchParams(location.search);
  const roomParam = (params.get('room') || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
  if (roomParam.length === 4) {
    openOnlineLobby(roomParam);
  } else {
    setScreen('title');
  }
})();
