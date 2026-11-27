/* Anonymous counters (no personal data): visits and games played across all 3 games.
   Stored in Firebase Realtime Database at /stats. Uses REST so it costs zero extra bundle weight.
   View live counts at https://bestlifecards.com/stats.html */
(function () {
  'use strict';
  const BL = (window.BL = window.BL || {});
  // Only count real visits on the live domain (skip localhost, automated browsers, and test flags)
  const test =
    !/^(www\.)?(bestlifecards\.com|bestlifecardgame\.us)$/.test(location.hostname) ||
    /[?&](fast|test)\b/.test(location.search) ||
    navigator.webdriver;

  BL.stats = {
    hit(key) {
      const c = window.BL_FIREBASE;
      if (!c || !c.databaseURL || !key || test) return;
      fetch(`${c.databaseURL}/stats/${encodeURIComponent(key)}.json`, {
        method: 'PUT',
        body: JSON.stringify({ '.sv': { increment: 1 } }),
        keepalive: true,
      }).catch(() => {});
    },
  };

  // Detect which game page is open and record one anonymous visit per browser session
  const p = location.pathname.toLowerCase();
  const isOG = /^\/onguard(\/|$)/.test(p);
  const isSTT = /^\/stactactoe(\/|$)/.test(p);
  const sessKey = isOG ? 'og-visit' : isSTT ? 'stt-visit' : 'bl-visit';
  const statKey = isOG ? 'og_visits' : isSTT ? 'stt_visits' : 'visits';
  try {
    if (!sessionStorage.getItem(sessKey)) {
      sessionStorage.setItem(sessKey, '1');
      BL.stats.hit(statKey);
    }
  } catch (e) {
    BL.stats.hit(statKey);
  }
})();
