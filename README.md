# Best Life

The website for **Best Life**, the card game about life created by Sandy Kraemer.
Live at https://bestlifecards.com (bestlifecardgame.us forwards there)

A plain static site (HTML, CSS and JavaScript). GitHub Pages serves this folder as is.

## Files
- `index.html`, `styles.css`: the page.
- `js/art.js`: the 12 sets, all 48 Connecting Points, icons and card builders.
- `js/main.js`: gallery, wisdom deck, How to Play scenes, mobile menu, "Make your own card".
- `js/game.js`: the round against Smiley, full screen, the game bar. `js/sound.js`: game sounds.
- `js/engine.js`: the rules used for online games (pure functions, no page code).
- `js/stats.js`, `stats.html`: anonymous counts (visits, games played).
- `js/config.js`: the Firebase web config. These values are public by design; the browser key is
  restricted to this site's addresses in Google Cloud, and `database.rules.json` protects the data.

## Bundled files (built, but committed so the site needs no build to serve)
`js/hero3d.js` (the 3D box, three.js), `js/online.js` (family games online, Firebase) and
`js/maker.js` (the card painter for "Make your own card") are built from `build/src/`:

```
cd build
npm install
npm run build
```

## On Guard (`onguard/`)
Sandy's first invention, a tilting marble game first published by Parker Brothers, rebuilt for the web.
Same-phone two-player, online play, and practice against the computer.
- `onguard/game.js`: drawing, input, screens, sound. `onguard/physics.js`: the board simulation and practice bot.
- `onguard/net.js` is built from `build/src/onguard-net.js` (`cd build && npm run build:onguard`).
- Fonts are self-hosted (Barlow, Barlow Condensed, JetBrains Mono; SIL Open Font License, files in `onguard/fonts/`).
- The BEST LIFE | ON GUARD switch at the top of both pages links them with a sliding pill and a wipe.

## Firebase
- Project `best-life-card-game`: Realtime Database plus anonymous sign-in.
- `database.rules.json` is the source of truth for the security rules. Paste it into
  Firebase console > Realtime Database > Rules and publish after any change.

© 2026 SFK and Associates LLC · BEST LIFE™
