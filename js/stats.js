/* Anonymous counters (no personal data): visits and games played. Stored in Firebase at /stats.
   Uses the REST API so it costs no extra download. View them at bestlifecards.com/stats.html */
(function () {
  'use strict';
  const BL = (window.BL = window.BL || {});
  // only count real visits to the live site (not local testing or automated browsers)
  const test = !/^(www\.)?(bestlifecards\.com|bestlifecardgame\.us)$/.test(location.hostname) || /[?&]fast\b/.test(location.search) || navigator.webdriver;
  BL.stats = {
    hit(key) {
      const c = window.BL_FIREBASE;
      if (!c || !c.databaseURL || test) return;
      fetch(`${c.databaseURL}/stats/${key}.json`, { method: 'PUT', body: JSON.stringify({ '.sv': { increment: 1 } }), keepalive: true }).catch(() => {});
    },
  };
  try {
    if (!sessionStorage.getItem('bl-visit')) { sessionStorage.setItem('bl-visit', '1'); BL.stats.hit('visits'); }
  } catch (e) { BL.stats.hit('visits'); }
})();
