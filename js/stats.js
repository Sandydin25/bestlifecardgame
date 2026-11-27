/* Anonymous analytics (zero PII / cookies): visits, unique & returning visitors,
   daily activity (DAU & games), traffic sources, device split, and per-game win rates.
   Stored in Firebase Realtime Database at /stats and /statsDaily.
   View live dashboard at https://bestlifecards.com/stats.html */
(function () {
  'use strict';
  const BL = (window.BL = window.BL || {});
  const OWN_HOST = /^(www\.)?(bestlifecards\.com|bestlifecardgame\.us)$/i;
  // Only count real visits on the live domain (skip localhost, automated browsers, and test flags)
  const test =
    !OWN_HOST.test(location.hostname) ||
    /[?&](fast|test)\b/.test(location.search) ||
    navigator.webdriver;

  const todayUTC = () => new Date().toISOString().slice(0, 10);

  const putInc = (path) => {
    const c = window.BL_FIREBASE;
    if (!c || !c.databaseURL || test) return;
    fetch(`${c.databaseURL}/${path}.json`, {
      method: 'PUT',
      body: JSON.stringify({ '.sv': { increment: 1 } }),
      keepalive: true,
    }).catch(() => {});
  };

  const GAME_START_DAILY = {
    soloGamesStarted: 'bl',
    onlineGamesStarted: 'bl',
    og_cpuStarted: 'og',
    og_localStarted: 'og',
    og_onlineStarted: 'og',
    stt_soloStarted: 'stt',
    stt_localStarted: 'stt',
    stt_onlineStarted: 'stt',
  };

  BL.stats = {
    hit(key) {
      if (!key) return;
      putInc(`stats/${encodeURIComponent(key)}`);
      const g = GAME_START_DAILY[key];
      if (g) {
        const d = todayUTC();
        putInc(`statsDaily/${d}/games`);
        putInc(`statsDaily/${d}/${g}`);
      }
    },
    hitDaily(key) {
      if (!key) return;
      putInc(`statsDaily/${todayUTC()}/${encodeURIComponent(key)}`);
    },
  };

  // Helper: classify which game a pathname belongs to
  const gameOf = (pathname) => {
    const p = (pathname || '').toLowerCase();
    if (/^\/onguard(\/|$)/.test(p)) return 'og';
    if (/^\/stactactoe(\/|$)/.test(p)) return 'stt';
    if (/^\/stats(\.html)?(\/|$)/.test(p)) return 'stats';
    return 'bl';
  };

  const curGame = gameOf(location.pathname);
  if (curGame === 'stats') return;

  // 1. Per-game session visit
  const sessKey = curGame === 'og' ? 'og-visit' : curGame === 'stt' ? 'stt-visit' : 'bl-visit';
  const statKey = curGame === 'og' ? 'og_visits' : curGame === 'stt' ? 'stt_visits' : 'visits';
  try {
    if (!sessionStorage.getItem(sessKey)) {
      sessionStorage.setItem(sessKey, '1');
      BL.stats.hit(statKey);
    }
  } catch (e) {
    BL.stats.hit(statKey);
  }

  // 2. Cross-game switch tracking (when coming from another game on our own domain)
  try {
    if (document.referrer) {
      const refUrl = new URL(document.referrer);
      if (OWN_HOST.test(refUrl.hostname)) {
        const fromGame = gameOf(refUrl.pathname);
        if (fromGame !== curGame && fromGame !== 'stats') {
          BL.stats.hit(curGame === 'og' ? 'sw_toOG' : curGame === 'stt' ? 'sw_toSTT' : 'sw_toBL');
        }
      }
    }
  } catch (e) {}

  // 3. Unique & returning visitors + Daily Active Users (via anonymous localStorage dates)
  try {
    const today = todayUTC();
    const firstDay = localStorage.getItem('bl-first-day');
    if (!firstDay) {
      localStorage.setItem('bl-first-day', today);
      localStorage.setItem('bl-last-day', today);
      BL.stats.hit('uniqueVisitors');
      BL.stats.hitDaily('dau');
      BL.stats.hitDaily('newUsers');
    } else {
      const lastDay = localStorage.getItem('bl-last-day');
      if (lastDay !== today) {
        localStorage.setItem('bl-last-day', today);
        BL.stats.hitDaily('dau');
        if (firstDay !== today) {
          BL.stats.hitDaily('retUsers');
          BL.stats.hit('returningSessions');
          if (!localStorage.getItem('bl-ret-counted')) {
            localStorage.setItem('bl-ret-counted', '1');
            BL.stats.hit('returningVisitors');
          }
        }
      }
    }
    const uKey = `bl-u-${curGame}`;
    if (!localStorage.getItem(uKey)) {
      localStorage.setItem(uKey, '1');
      BL.stats.hit(`${curGame}_unique`);
    }
  } catch (e) {}

  // 4. Site-level session metrics: daily visits, device type, and traffic source
  try {
    if (!sessionStorage.getItem('bl-site-sess')) {
      sessionStorage.setItem('bl-site-sess', '1');
      BL.stats.hitDaily('visits');

      const isMobile =
        (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) ||
        window.innerWidth <= 768;
      BL.stats.hit(isMobile ? 'dev_mobile' : 'dev_desktop');

      const params = new URLSearchParams(location.search);
      const utm = (params.get('utm_source') || params.get('ref') || '').trim().toLowerCase();
      let extRef = '';
      if (!utm && document.referrer) {
        try {
          const r = new URL(document.referrer);
          if (!OWN_HOST.test(r.hostname)) extRef = r.hostname.toLowerCase();
        } catch (e) {}
      }
      const raw = utm || extRef;
      let src = 'src_direct';
      if (raw) {
        if (/tiktok/.test(raw)) src = 'src_tiktok';
        else if (/instagram|\big\b/.test(raw)) src = 'src_instagram';
        else if (/reddit|redd\.it/.test(raw)) src = 'src_reddit';
        else if (/twitter|t\.co|(^|\.)x\.com$|^x$/.test(raw)) src = 'src_x';
        else if (/youtube|youtu\.be/.test(raw)) src = 'src_youtube';
        else if (/facebook|(^|\.)fb\.|messenger|threads/.test(raw)) src = 'src_facebook';
        else if (/google|bing|duckduckgo|yahoo|ecosia|search\.brave/.test(raw)) src = 'src_google';
        else src = 'src_referral';
      }
      BL.stats.hit(src);
    }
  } catch (e) {}
})();
