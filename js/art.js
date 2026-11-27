/* Best Life — artwork: set data, SVG icons, card + box builders.
   Everything is redrawn from photos of the real deck (no photos are used). */
(function () {
  'use strict';
  const BL = (window.BL = window.BL || {});

  /* ------------------------------------------------------------------ */
  /*  The 12 sets. Order = colour-wheel order, used for the hero fan.    */
  /*  `quote` is the Connecting Point printed on the photographed card.  */
  /* ------------------------------------------------------------------ */
  const SETS = [
    { id: 'goals', name: 'GOALS', icon: 'medal', pattern: 'stars-outline',
      bg: '#ec3319', bg2: '#f65a2c', title: '#c8202e', shade: '#6d0d04', fs: 12.2, ls: 0.08,
      quote: 'A goal without a plan is a wish.' },
    { id: 'humor', name: 'HUMOR', icon: 'grin', pattern: 'dots',
      bg: '#f68a0c', bg2: '#fba433', title: '#ea3c17', shade: '#7a3800', fs: 12.2, ls: 0.05,
      quote: 'Laugh loudly, laugh often, laugh at yourself.' },
    { id: 'education', name: 'EDUCATION', icon: 'books', pattern: 'stars-solid',
      bg: '#f5a056', bg2: '#f8b46e', title: '#1c5a38', shade: '#7a3608', fs: 10.6, ls: 0,
      quote: 'Education costs money but ignorance can cost more.' },
    { id: 'health', name: 'HEALTH', icon: 'shoe', pattern: 'grass',
      bg: '#3e9d37', bg2: '#4cae42', title: '#1c6a36', shade: '#163f10', fs: 11.8, ls: 0.08,
      quote: 'Good health and good sense are two of life’s greatest blessings.' },
    { id: 'money', name: 'MONEY', icon: 'money', pattern: 'stripes',
      bg: '#2c8f86', bg2: '#3ba7a4', title: '#2a8a3b', shade: '#0b352d', fs: 12.2, ls: 0.1,
      quote: 'Beware of little expenses. A small leak can sink a great ship.' },
    { id: 'belief', name: 'BELIEF', icon: 'mountain', pattern: 'clouds',
      bg: '#83b5e2', bg2: '#9cc6ec', title: '#2a2971', shade: '#24456c', fs: 12.4, ls: 0.04,
      quote: 'Sorrow looks back, worry looks around, belief looks forward.' },
    { id: 'food', name: 'FOOD', icon: 'apple', pattern: 'waves',
      bg: '#3f63b0', bg2: '#8fd0ea', title: '#a32d27', shade: '#1b2f5c', fs: 12.6, ls: 0.17,
      quote: 'Chocolate is salad. It comes from a tree, which is a plant.' },
    { id: 'freedom', name: 'FREEDOM', icon: 'bell', pattern: 'zigzag',
      bg: '#2f3597', bg2: '#3a41a8', title: '#2b2973', shade: '#0d0f44', fs: 12.2, ls: 0.01,
      quote: 'Freedom is the right to think for yourself… ALOUD.' },
    { id: 'family', name: 'FAMILY', icon: 'hugface', pattern: 'hearts',
      bg: '#8550ab', bg2: '#9661bd', title: '#5b2470', shade: '#33104a', fs: 12.2, ls: 0.07,
      quote: 'Family love lasts forever.' },
    { id: 'knowledge', name: 'KNOWLEDGE', icon: 'globe', pattern: 'heptagons',
      bg: '#8b3154', bg2: '#9c3e63', title: '#1f1c5e', shade: '#3a0b1f', fs: 10.3, ls: -0.01,
      quote: 'We have too much information and not enough knowledge.' },
    { id: 'friends', name: 'FRIENDS', icon: 'heart', pattern: 'squiggles',
      bg: '#c6509a', bg2: '#d363a8', title: '#c3164c', shade: '#561037', fs: 11.6, ls: 0.04,
      quote: 'Things are never quite so bad when you’ve got a best friend.' },
    { id: 'grit', name: 'GRIT', icon: 'bolt', pattern: 'triangles',
      bg: '#b4174c', bg2: '#c22058', title: '#9c1a22', shade: '#560818', fs: 13, ls: 0.15,
      quote: 'Life is short and it’s up to you to make it sweet.' },
  ];
  // Every Connecting Point in the deck (4 per set), transcribed from the printed cards.
  const QUOTES = {
    goals: ['A goal without a plan is a wish.', 'You cannot change your life without changing your thinking.', 'Every problem includes an opportunity.', 'Do the best you can, and don’t take yourself too seriously.'],
    humor: ['Laugh loudly, laugh often, laugh at yourself.', 'I named my dog Five Miles, so I tell people I walk Five Miles daily.', 'Humor is like a summer rain, it renews.', 'Laughter is like a windshield wiper, it helps you keep going.'],
    education: ['Education costs money but ignorance can cost more.', 'As long as there are tests there will be prayer in school.', 'Facts don’t change minds. A good story will.', 'Education is something you always have in your pocket.'],
    health: ['Good health and good sense are two of life’s greatest blessings.', 'The greatest gift you can give is a healthy you.', 'Someone who can’t stick with a diet is a deserter.', 'A good laugh and a good sleep are the best cure.'],
    money: ['Beware of little expenses. A small leak can sink a great ship.', 'Put your money in the freezer if you want cold cash.', 'When prosperity comes, do not use all of it.', 'Wisdom plays a major role in managing money.'],
    belief: ['Sorrow looks back, worry looks around, belief looks forward.', 'Belief is not what you have. It is what you think.', 'Belief moves mountains, but you have to keep pushing.', 'Belief is not a feeling. It is courage in spite of feelings.'],
    food: ['Chocolate is salad. It comes from a tree, which is a plant.', 'Food is culture, habit and identity.', 'A balanced diet means a cookie in each hand.', 'Let food be the medicine and the medicine be the food.'],
    freedom: ['Freedom is the right to think for yourself… ALOUD.', 'Every day is a new adventure if you are free.', 'Freedom and responsibility go together.', 'Never be limited by other people’s limitations.'],
    family: ['Family love lasts forever.', 'Family means nobody is left behind or forgotten.', 'Family stories are often telling.', 'Other things may change, but we start and end with family.'],
    knowledge: ['We have too much information and not enough knowledge.', 'Knowledge is like money. To be of value, it needs to be circulated.', 'Everybody is ignorant, only on different subjects.', 'Knowledge speaks. Wisdom listens.'],
    friends: ['Things are never quite so bad when you’ve got a best friend.', 'Friends will change your life.', 'There’s nothing better than a friend, unless it’s a friend with chocolate.', 'Friends don’t care if you can’t dance well. Just dance!'],
    grit: ['Life is short and it’s up to you to make it sweet.', 'Winning does not mean always being first.', 'The scariest moment is just before you start.', 'Mistakes are proof that you are trying.'],
  };
  SETS.forEach((s) => { s.quotes = QUOTES[s.id]; s.quote = s.quotes[0]; });
  // The 4 Action cards (2 of each)
  BL.ACTIONS = [
    { id: 'turn', icon: 'point', text: 'Take Another Turn', count: 2 },
    { id: 'take2', icon: 'thumbs', text: 'Take 2 Cards From Any Player', count: 2 },
  ];
  const BY_ID = Object.fromEntries(SETS.map((s) => [s.id, s]));
  BL.SETS = SETS;
  BL.set = (id) => BY_ID[id];

  /* ------------------------------------------------------------------ */
  /*  helpers                                                            */
  /* ------------------------------------------------------------------ */
  const uri = (svg) => 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  const svg = (vb, inner, extra = '') =>
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" ${extra}>${inner}</svg>`;
  function rng(seed) {
    let a = seed >>> 0;
    return () => {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  BL.rng = rng;
  const f2 = (n) => Math.round(n * 100) / 100;
  function poly(cx, cy, r, n, rot) {
    const p = [];
    for (let i = 0; i < n; i++) {
      const a = rot + (i * Math.PI * 2) / n;
      p.push(f2(cx + r * Math.cos(a)) + ',' + f2(cy + r * Math.sin(a)));
    }
    return p.join(' ');
  }
  function star(cx, cy, r, rot = -Math.PI / 2, inner = 0.45) {
    const p = [];
    for (let i = 0; i < 10; i++) {
      const rr = i % 2 ? r * inner : r;
      const a = rot + (i * Math.PI) / 5;
      p.push(f2(cx + rr * Math.cos(a)) + ',' + f2(cy + rr * Math.sin(a)));
    }
    return p.join(' ');
  }

  /* ------------------------------------------------------------------ */
  /*  ICONS (viewBox 0 0 100 100), emoji-style with dark outlines        */
  /* ------------------------------------------------------------------ */
  const HEART = 'M50 30 C44 13 16 11 10 32 C5 52 27 70 50 89 C73 70 95 52 90 32 C84 11 56 13 50 30 Z';
  const ICONS = {
    bolt: svg('0 0 100 100', `
      <defs><linearGradient id="a" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#fffb9a"/><stop offset=".45" stop-color="#fff02a"/><stop offset="1" stop-color="#f4cf00"/></linearGradient></defs>
      <path d="M13 5 L45 1 L61 44 L72 37 L92 98 L50 51 L39 57 Z" fill="url(#a)" stroke="#5b4300" stroke-width="2" stroke-linejoin="round"/>
      <path d="M45 1 L61 44 L57 46 L42 6 Z M72 37 L92 98 L67 45 Z" fill="#e2b400" opacity=".85"/>
      <path d="M18 8 L40 5 L41 9 L22 11 Z" fill="#fff" opacity=".55"/>`),

    bell: svg('0 0 100 100', `
      <defs><radialGradient id="a" cx=".42" cy=".42" r=".7">
        <stop offset="0" stop-color="#fff59a"/><stop offset=".35" stop-color="#ffd83a"/><stop offset=".8" stop-color="#f6aa18"/><stop offset="1" stop-color="#e88f10"/></radialGradient></defs>
      <circle cx="50" cy="9" r="5" fill="none" stroke="#b9650c" stroke-width="2.6"/>
      <path d="M50 13 C33 13 27 27 27 44 C27 58 24 67 13 75 L87 75 C76 67 73 58 73 44 C73 27 67 13 50 13 Z" fill="url(#a)" stroke="#c06c0c" stroke-width="1.6"/>
      <ellipse cx="50" cy="76.5" rx="38" ry="7" fill="#f5b02a" stroke="#c06c0c" stroke-width="1.6"/>
      <ellipse cx="50" cy="78" rx="31" ry="3.6" fill="#d6870f"/>
      <circle cx="50" cy="82" r="6" fill="#f8c23a" stroke="#c06c0c" stroke-width="1.6"/>
      <circle cx="48" cy="80.5" r="1.8" fill="#fff" opacity=".6"/>`),

    mountain: svg('0 0 100 100', `
      <defs><clipPath id="m"><path d="M6 88 C5 82 9 76 13 69 L40 22 C44 14 56 14 60 22 L88 70 C92 77 96 83 94 88 Z"/></clipPath></defs>
      <g clip-path="url(#m)">
        <rect width="100" height="100" fill="#3d8a3a"/>
        <path d="M50 16 C54 34 52 52 58 70 C60 78 62 84 64 92 L100 92 L100 0 L50 0 Z" fill="#8a4c2a"/>
        <path d="M66 40 C64 52 70 64 72 80 M76 54 C74 64 80 74 82 86 M60 46 C58 58 62 70 66 88" stroke="#6a3418" stroke-width="3" fill="none" stroke-linecap="round"/>
        <path d="M32 46 C30 56 26 66 22 80 M40 40 C38 54 36 66 34 86 M24 62 C22 70 18 78 14 86" stroke="#2d6e2c" stroke-width="3" fill="none" stroke-linecap="round"/>
        <path d="M36 30 L43 18 C46 13 54 13 57 18 L64 30 L59 34 L55 29 L51 40 L47 30 L42 35 Z" fill="#fff"/>
        <path d="M50 14 C54 14 56 16 58 19 L64 30 L59 34 L55 29 L51 40 C52 30 52 22 50 14 Z" fill="#c9e8f4"/>
      </g>
      <path d="M6 88 C5 82 9 76 13 69 L40 22 C44 14 56 14 60 22 L88 70 C92 77 96 83 94 88 Z" fill="none" stroke="#23261a" stroke-width="2.2" stroke-linejoin="round"/>`),

    globe: svg('0 0 100 100', `
      <defs>
        <radialGradient id="o" cx=".36" cy=".32" r=".8"><stop offset="0" stop-color="#8fd3fb"/><stop offset=".5" stop-color="#3b93dc"/><stop offset="1" stop-color="#1f5cad"/></radialGradient>
        <radialGradient id="l" cx=".4" cy=".3" r=".9"><stop offset="0" stop-color="#b5e35a"/><stop offset="1" stop-color="#5fa82e"/></radialGradient>
        <clipPath id="c"><circle cx="50" cy="50" r="46"/></clipPath></defs>
      <circle cx="50" cy="50" r="46" fill="url(#o)"/>
      <g clip-path="url(#c)" fill="url(#l)" stroke="#2c5a18" stroke-width="1" stroke-linejoin="round">
        <path d="M20 17 C26 12 34 10 42 12 C46 9 52 10 55 13 C58 11 63 13 64 17 C61 20 57 21 56 25 C60 27 62 31 58 35 C54 37 52 41 51 45 C49 47 47 49 48 52 L51 56 C48 57 45 56 43 54 C39 50 35 47 33 42 C29 40 24 36 22 31 C20 27 15 24 14 20 C16 18 18 18 20 17 Z"/>
        <path d="M51 56 C53 57 54 58 53 60 L52 58 Z"/>
        <path d="M53 60 C59 58 65 60 70 64 C75 68 73 74 69 78 C65 82 61 88 58 96 C55 90 55 84 54 78 C52 72 50 66 53 60 Z"/>
        <path d="M60 7 C65 5 70 8 67 12 C64 13 61 11 60 7 Z"/>
        <path d="M36 14 C38 18 41 19 44 17 C42 15 40 14 36 14 Z" fill="#3b93dc" stroke="none"/>
      </g>
      <circle cx="50" cy="50" r="46" fill="none" stroke="#17306a" stroke-width="2"/>
      <ellipse cx="34" cy="26" rx="9" ry="5" fill="#fff" opacity=".22" transform="rotate(-30 34 26)"/>`),

    hugface: svg('0 0 100 100', `
      <defs><radialGradient id="f" cx=".45" cy=".35" r=".7"><stop offset="0" stop-color="#fff47a"/><stop offset=".6" stop-color="#fcd116"/><stop offset="1" stop-color="#f0a500"/></radialGradient>
      <radialGradient id="h" cx=".35" cy=".3" r=".8"><stop offset="0" stop-color="#ff6a6a"/><stop offset="1" stop-color="#d4141c"/></radialGradient></defs>
      <circle cx="46" cy="46" r="42" fill="url(#f)" stroke="#a66a00" stroke-width="1.2"/>
      <ellipse cx="46" cy="14" rx="15" ry="7" fill="#fff" opacity=".45"/>
      <path d="M24 40 Q32 30 40 40 M53 40 Q61 30 69 40" stroke="#3a2608" stroke-width="3.6" fill="none" stroke-linecap="round"/>
      <path d="M30 57 Q46 71 62 57" stroke="#3a2608" stroke-width="3.6" fill="none" stroke-linecap="round"/>
      <g transform="translate(60 56) scale(.42)"><path d="${HEART}" fill="url(#h)" stroke="#5a0608" stroke-width="5"/><ellipse cx="30" cy="34" rx="9" ry="6" fill="#fff" opacity=".45" transform="rotate(-30 30 34)"/></g>`),

    shoe: svg('0 0 100 100', `
      <defs><linearGradient id="u" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#9cc8f0"/><stop offset="1" stop-color="#5f97d6"/></linearGradient></defs>
      <g transform="rotate(16 50 55) translate(0 4)">
        <path d="M9 66 C8 61 11 59 16 59 L84 59 C93 59 97 63 97 69 C97 76 91 78 83 78 L17 78 C11 78 9 72 9 66 Z" fill="#fff" stroke="#1c2752" stroke-width="2"/>
        <path d="M10 70 C30 70 70 69 96 68 L96 71 C96 76 91 78 83 78 L17 78 C12 78 10 75 10 70 Z" fill="#1f2b5e"/>
        <path d="M11 64 C30 66 60 66 92 62 L94 65 C60 69 30 69 10 67 Z" fill="#e8322b"/>
        <path d="M12 61 C20 62 28 63 34 63 L34 65 C26 65 18 64 11 63 Z" fill="#f8c21a"/>
        <path d="M13 60 C10 48 12 34 21 28 C27 24 34 27 38 33 C44 39 52 41 60 43 C72 45 84 49 90 56 C93 59 94 61 92 62 L14 62 Z" fill="url(#u)" stroke="#1c2752" stroke-width="2" stroke-linejoin="round"/>
        <path d="M18 30 C23 25 32 25 38 33" stroke="#1f2b5e" stroke-width="5" fill="none" stroke-linecap="round"/>
        <path d="M22 54 C38 46 56 47 74 55" stroke="#fff" stroke-width="5" fill="none" stroke-linecap="round"/>
        <g stroke="#1c2752" stroke-width="5.2" fill="none" stroke-linecap="round">
          <path d="M40 36 L60 46 M44 40 L64 42 M42 44 L58 38"/>
          <path d="M47 37 C38 20 56 15 54 33 M51 37 C62 20 74 30 58 39"/></g>
        <g stroke="#fff" stroke-width="3" fill="none" stroke-linecap="round">
          <path d="M40 36 L60 46 M44 40 L64 42 M42 44 L58 38"/>
          <path d="M47 37 C38 20 56 15 54 33 M51 37 C62 20 74 30 58 39"/></g>
      </g>`),

    medal: svg('0 0 100 100', `
      <defs><radialGradient id="g" cx=".4" cy=".35" r=".75"><stop offset="0" stop-color="#fff07a"/><stop offset=".55" stop-color="#f7c51c"/><stop offset="1" stop-color="#d79c00"/></radialGradient>
      <clipPath id="r"><path d="M30 2 L70 2 L61 34 L39 34 Z"/></clipPath></defs>
      <g clip-path="url(#r)"><rect x="0" y="0" width="100" height="40" fill="#3a4fae"/>
        <rect x="44.5" y="0" width="11" height="40" fill="#fff"/><rect x="47.8" y="0" width="4.4" height="40" fill="#e1262c"/></g>
      <path d="M30 2 L70 2 L61 34 L39 34 Z" fill="none" stroke="#1d2a6a" stroke-width="1.6"/>
      <rect x="38" y="32" width="24" height="7" rx="2" fill="#efb400" stroke="#a87a00" stroke-width="1.4"/>
      <circle cx="50" cy="66" r="30" fill="url(#g)" stroke="#a87a00" stroke-width="2"/>
      <circle cx="50" cy="66" r="24" fill="none" stroke="#e3a900" stroke-width="1.4"/>
      <polygon points="${star(50, 67, 17)}" fill="#f4c20d" stroke="#c18f00" stroke-width="1.4" stroke-linejoin="round"/>
      <polygon points="${star(50, 67, 9, -Math.PI / 2, 0.45)}" fill="#ffe25e" opacity=".8"/>`),

    grin: svg('0 0 100 100', `
      <defs><radialGradient id="f" cx=".45" cy=".35" r=".7"><stop offset="0" stop-color="#fff47a"/><stop offset=".6" stop-color="#fcd116"/><stop offset="1" stop-color="#f0a500"/></radialGradient>
      <clipPath id="m"><path d="M21 55 L79 55 C79 75 66 87 50 87 C34 87 21 75 21 55 Z"/></clipPath></defs>
      <circle cx="50" cy="50" r="45" fill="url(#f)" stroke="#5a3a00" stroke-width="1.6"/>
      <ellipse cx="50" cy="15" rx="16" ry="7" fill="#fff" opacity=".5"/>
      <ellipse cx="36" cy="38" rx="5.5" ry="7" fill="#2a1a0a"/><ellipse cx="64" cy="38" rx="5.5" ry="7" fill="#2a1a0a"/>
      <circle cx="37.5" cy="35.5" r="1.6" fill="#fff" opacity=".7"/><circle cx="65.5" cy="35.5" r="1.6" fill="#fff" opacity=".7"/>
      <g clip-path="url(#m)"><rect x="0" y="50" width="100" height="40" fill="#b3201f"/>
        <ellipse cx="50" cy="86" rx="20" ry="9" fill="#e5484c"/>
        <path d="M18 54 L82 54 C81 61 79 64 76 66 L24 66 C21 64 19 61 18 54 Z" fill="#fff"/></g>
      <path d="M21 55 L79 55 C79 75 66 87 50 87 C34 87 21 75 21 55 Z" fill="none" stroke="#3a1a08" stroke-width="2.4" stroke-linejoin="round"/>`),

    money: svg('0 0 100 100', `
      <defs><linearGradient id="t" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#5cbc55"/><stop offset="1" stop-color="#2f8f3a"/></linearGradient></defs>
      <path d="M31 50 C21 41 9 40 2 46 C6 48 8 50 5 52 C10 54 12 55 9 58 C15 61 25 60 31 56 Z" fill="#fff" stroke="#8b9aa6" stroke-width="1.3" stroke-linejoin="round"/>
      <path d="M8 49 C14 49 20 50 26 52 M12 55 C18 55 22 55 27 55" stroke="#b5c0c8" stroke-width="1.1" fill="none"/>
      <path d="M30 40 L62 28 L80 44 L48 56 Z" fill="url(#t)" stroke="#1d5224" stroke-width="1.5" stroke-linejoin="round"/>
      <path d="M36 40 L61 31 L74 43 L49 52 Z" fill="none" stroke="#9fd66a" stroke-width="1"/>
      <ellipse cx="55" cy="42" rx="8" ry="5" fill="#c8ea5a" transform="rotate(-20 55 42)"/>
      <path d="M30 40 L48 56 L48 73 L30 57 Z" fill="#2f7d35" stroke="#1d5224" stroke-width="1.5" stroke-linejoin="round"/>
      <path d="M48 56 L80 44 L80 61 L48 73 Z" fill="#3b913f" stroke="#1d5224" stroke-width="1.5" stroke-linejoin="round"/>
      <path d="M30 44 L48 60 M30 48 L48 64 M30 52 L48 68 M48 60 L80 48 M48 64 L80 52 M48 68 L80 56" stroke="#1d5224" stroke-width=".9" opacity=".7"/>
      <path d="M43.4 35 L48.6 33 L66.6 49 L61.4 51 Z" fill="#fff" stroke="#9aa6ad" stroke-width=".8"/>
      <path d="M61.4 51 L66.6 49 L66.6 66 L61.4 68 Z" fill="#eef1f3" stroke="#9aa6ad" stroke-width=".8"/>
      <path d="M79 52 C85 40 94 33 99 37 C97 41 95 43 97 46 C93 49 91 50 93 53 C88 57 84 57 79 56 Z" fill="#fff" stroke="#8b9aa6" stroke-width="1.3" stroke-linejoin="round"/>
      <path d="M83 50 C87 46 91 42 95 40 M84 54 C88 52 90 51 93 49" stroke="#b5c0c8" stroke-width="1.1" fill="none"/>`),

    heart: svg('0 0 100 100', `
      <defs><radialGradient id="h" cx=".35" cy=".3" r=".85"><stop offset="0" stop-color="#ffc44e"/><stop offset=".7" stop-color="#fba82a"/><stop offset="1" stop-color="#f08f10"/></radialGradient></defs>
      <path d="${HEART}" fill="url(#h)" stroke="#3f2200" stroke-width="2.6" stroke-linejoin="round"/>
      <ellipse cx="28" cy="30" rx="9" ry="5.5" fill="#fff" opacity=".35" transform="rotate(-35 28 30)"/>`),

    books: svg('0 0 100 100', (() => {
      const book = (dx, dy, c, d, rot) => `
        <g transform="translate(${dx} ${dy}) rotate(${rot} 50 30)">
          <path d="M10 22 L52 10 L90 24 L48 37 Z" fill="${c}" stroke="#1a1a2a" stroke-width="1.4" stroke-linejoin="round"/>
          <path d="M48 37 L90 24 L90 33 L48 46 Z" fill="#f6f6f2" stroke="#1a1a2a" stroke-width="1.4" stroke-linejoin="round"/>
          <path d="M51 40 L88 28.5 M51 43 L88 31.5" stroke="#c8c8c8" stroke-width=".8"/>
          <path d="M10 22 L48 37 L48 46 L10 31 Z" fill="${d}" stroke="#1a1a2a" stroke-width="1.4" stroke-linejoin="round"/>
          <path d="M14 26 L44 38" stroke="#fff" stroke-width="1" opacity=".35"/>
        </g>`;
      return book(-2, 46, '#3d6fc8', '#24499a', 4) + book(2, 27, '#43a84a', '#2a7a30', -3) + book(-1, 8, '#e2322d', '#a8191a', 2);
    })()),

    apple: svg('0 0 100 100', `
      <defs><radialGradient id="a" cx=".38" cy=".38" r=".75"><stop offset="0" stop-color="#ff6b5a"/><stop offset=".55" stop-color="#e2231c"/><stop offset="1" stop-color="#a50d0d"/></radialGradient></defs>
      <path d="M50 30 C40 22 16 24 14 49 C12 71 29 93 43 91 C47 90 53 90 57 91 C71 93 88 71 86 49 C84 24 60 22 50 30 Z" fill="url(#a)" stroke="#5a0606" stroke-width="1.8"/>
      <path d="M50 31 C50 23 52 16 55 11" stroke="#5e3416" stroke-width="3.4" fill="none" stroke-linecap="round"/>
      <path d="M53 20 C58 8 73 7 78 11 C72 20 61 23 53 20 Z" fill="#5eb53a" stroke="#2c6a18" stroke-width="1.4"/>
      <path d="M47 23 C42 15 33 14 30 16 C34 23 41 25 47 23 Z" fill="#4c9e2e" stroke="#2c6a18" stroke-width="1.4"/>
      <ellipse cx="31" cy="46" rx="5" ry="10" fill="#fff" opacity=".4" transform="rotate(20 31 46)"/>`),
  };
  const HAND = `<defs>
      <linearGradient id="hg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffe066"/><stop offset=".55" stop-color="#ffc336"/><stop offset="1" stop-color="#ec9614"/></linearGradient>
      <linearGradient id="hg2" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f7b932"/><stop offset="1" stop-color="#df860e"/></linearGradient>
    </defs>`;
  const HS = 'fill="url(#hg)" stroke="#9a5508" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"';
  const HS2 = 'fill="url(#hg2)" stroke="#9a5508" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"';
  ICONS.point = svg('0 0 100 100', HAND + `
      <path d="M23 39 C27 25 38 19 49 23 C56 25.5 60 32 57 37 L27 42 Z" ${HS}/>
      <path d="M44 50 L62 50 C68 50 71 52.8 71 55.6 C71 58.6 68 61.2 62 61.2 L44 61.2 Z" ${HS2}/>
      <path d="M42 60.8 L59 60.8 C64.8 60.8 67.5 63.4 67.5 66 C67.5 68.8 64.8 71.2 59 71.2 L42 71.2 Z" ${HS2}/>
      <path d="M40 70.8 L55 70.8 C60.2 70.8 63 73.2 63 75.8 C63 78.5 60 81 54.5 81 L36 81 Z" ${HS2}/>
      <path d="M11 56 C11 40 20 34 35 34 L85 34 C91.2 34 94.5 37.8 94.5 42.2 C94.5 46.8 91.2 50.6 85 50.6 L50 50.6 C45 50.6 43 54 43 58 C43 69 47 77 53 80.5 C48 81.4 42 81.5 35 81.5 C19 81.5 11 71 11 56 Z" ${HS}/>
      <path d="M44 50.6 L53 50.6 M46 61.2 L61 61.2 M45 71.2 L58 71.2" stroke="#9a5508" stroke-width="2.1" fill="none" stroke-linecap="round"/>
      <path d="M31 35 C37 34.5 45 35.5 51 37.5" stroke="#9a5508" stroke-width="2" fill="none" stroke-linecap="round" opacity=".75"/>
      <ellipse cx="77" cy="38.2" rx="9" ry="2.2" fill="#fff" opacity=".5"/>
      <ellipse cx="38" cy="25.5" rx="6.5" ry="2.2" fill="#fff" opacity=".4" transform="rotate(-12 38 25.5)"/>`);
  ICONS.thumbs = svg('0 0 100 100', HAND + `
      <path d="M51 42 L76 42 C82.2 42 85.2 45 85.2 48.2 C85.2 51.4 82.2 54.2 76 54.2 L51 54.2 Z" ${HS2}/>
      <path d="M52 53.5 L78 53.5 C84 53.5 87 56.4 87 59.6 C87 62.8 84 65.5 78 65.5 L52 65.5 Z" ${HS2}/>
      <path d="M51 64.8 L75 64.8 C80.8 64.8 83.8 67.5 83.8 70.6 C83.8 73.7 80.8 76.2 75 76.2 L51 76.2 Z" ${HS2}/>
      <path d="M49 75.5 L70 75.5 C75.2 75.5 78.2 78 78.2 80.8 C78.2 83.8 75 86.2 69.5 86.2 L47 86.2 Z" ${HS2}/>
      <path d="M16 66 C16 51 22 44 31 41 C37 35 39 27 39 18 C39 11.5 49 10.8 52 17.2 C54.5 23 53 33 50 42 L57 42 C52 44 50 51 50 64 C50 75 53 82 59 86.2 L38 86.2 C23 86.2 16 78 16 66 Z" ${HS}/>
      <path d="M54 54.2 L74 54.2 M54 65.5 L75 65.5 M53 76.2 L71 76.2" stroke="#9a5508" stroke-width="2.1" fill="none" stroke-linecap="round"/>
      <path d="M50 42 C46 44 43.5 48 43 52" stroke="#9a5508" stroke-width="2" fill="none" stroke-linecap="round" opacity=".7"/>
      <ellipse cx="44" cy="21" rx="2.6" ry="6.2" fill="#fff" opacity=".48" transform="rotate(6 44 21)"/>
      <ellipse cx="26" cy="56" rx="3.2" ry="9" fill="#fff" opacity=".32" transform="rotate(-10 26 56)"/>`);
  BL.icon = (name) => ICONS[name];
  const ICON_URI = {};
  for (const k in ICONS) ICON_URI[k] = uri(ICONS[k]);
  BL.iconURI = (name) => ICON_URI[name];

  /* ------------------------------------------------------------------ */
  /*  BACKGROUND PATTERNS (viewBox 0 0 100 140 — the card itself)        */
  /* ------------------------------------------------------------------ */
  const PAT = {
    triangles(s) {
      const tris = [
        '0,1 19,1 5,13', '50,0 58,-2 56,15', '64,6 92,4 87,28', '21,14 50,10 42,31', '3,42 11,38 8,50',
        '56,54 70,50 61,72', '88,60 102,55 101,76', '16,60 32,71 16,82', '77,78 95,73 86,98',
        '1,92 29,86 10,112', '33,116 53,112 46,141', '70,118 101,108 93,142', '40,102 50,106 44,113',
        '92,30 101,28 100,42', '58,92 66,96 60,103',
      ];
      return tris.map((p) => `<polygon points="${p}" fill="#f37a1f" opacity=".96"/>`).join('');
    },
    zigzag(s) {
      let out = '';
      const lines = [];
      for (let k = 0; k < 12; k++) {
        const y0 = -8 + k * 14;
        const pts = [];
        for (let j = 0; j <= 6; j++) pts.push([-25 + j * 25, y0 + (j % 2 ? 9 : 0)]);
        lines.push(pts);
      }
      for (let k = 0; k < lines.length - 1; k += 2) {
        const a = lines[k], b = lines[k + 1].slice().reverse();
        out += `<polygon points="${a.concat(b).map((p) => p.join(',')).join(' ')}" fill="#262b80"/>`;
      }
      for (const l of lines) out += `<polyline points="${l.map((p) => p.join(',')).join(' ')}" fill="none" stroke="#b9977a" stroke-width=".8"/>`;
      return out;
    },
    clouds(s) {
      const C = 'M5 15 C1 15 0 10 4 9 C3 5 8 3 11 6 C12 1 20 0 22 5 C26 3 30 7 28 10 C31 11 30 15 27 15 Z';
      const at = [[-6, 4, 1.1], [46, 0, 1.2], [70, 22, 1], [2, 38, 1], [60, 58, 1.1], [-10, 74, 1.2], [40, 84, .9], [76, 96, 1], [6, 112, 1.1], [52, 124, 1.2], [26, 60, .7]];
      return at.map(([x, y, k]) => `<path d="${C}" transform="translate(${x} ${y}) scale(${k})" fill="none" stroke="#b4e6de" stroke-width="${1.3 / k}" opacity=".85"/>`).join('');
    },
    heptagons(s) {
      const r = rng(7); let out = '';
      const at = [[8, 8, 7], [36, 4, 5], [62, 12, 9], [90, 6, 6], [20, 30, 5], [84, 34, 8], [6, 56, 9], [32, 52, 4], [90, 64, 6], [18, 88, 6], [74, 86, 9], [44, 72, 4], [10, 118, 8], [44, 108, 6], [64, 122, 7], [92, 112, 5], [30, 134, 5]];
      for (const [x, y, rr] of at) {
        const fill = r() < 0.4 ? '#7b2547' : 'none';
        out += `<polygon points="${poly(x, y, rr, 7, r() * 6)}" fill="${fill}" stroke="#b85b8e" stroke-width="1.1" opacity=".9"/>`;
      }
      return out;
    },
    hearts(s) {
      const H = 'M0 -2 C-1 -5.5 -6.5 -5.5 -6.5 -1 C-6.5 2.5 -2.5 4.5 0 7 C2.5 4.5 6.5 2.5 6.5 -1 C6.5 -5.5 1 -5.5 0 -2 Z';
      let out = '';
      for (let row = 0; row < 9; row++)
        for (let col = 0; col < 7; col++) {
          const x = col * 17 + (row % 2 ? 8.5 : 0) + 2, y = row * 16.5 + 6;
          out += `<path d="${H}" transform="translate(${x} ${y}) scale(1.05)" fill="#a77ccb" opacity=".7"/>`;
        }
      return out;
    },
    grass(s) {
      const G = 'M-4 0 L-5.5 -5 L-2 -1.5 L0 -7.5 L2 -1.5 L5.5 -5 L4 0 Z';
      let out = '';
      for (let row = 0; row < 9; row++)
        for (let col = 0; col < 5; col++) {
          const x = col * 22 + (row % 2 ? 11 : 0) + 4, y = row * 16 + 10;
          out += `<path d="${G}" transform="translate(${x} ${y})" fill="#2b8628" opacity=".85"/>`;
        }
      return out;
    },
    'stars-outline'(s) {
      const r = rng(3); let out = '';
      for (let row = 0; row < 7; row++)
        for (let col = 0; col < 4; col++) {
          const x = col * 30 + (row % 2 ? 15 : 0) + (r() - 0.5) * 8, y = row * 22 + (r() - 0.5) * 8;
          out += `<polygon points="${star(x, y, 13 + r() * 4, -Math.PI / 2 + (r() - 0.5) * 0.6, 0.46)}" fill="#f2492a" fill-opacity=".35" stroke="#c51c0e" stroke-width="1.3" stroke-linejoin="round"/>`;
        }
      return out;
    },
    dots(s) {
      const r = rng(11); let out = '';
      const at = [[8, 4, 3], [30, 10, 2], [60, 4, 4], [86, 12, 2.5], [92, 32, 3.5], [6, 40, 3], [70, 34, 2], [94, 52, 2.5], [10, 70, 2.5], [86, 82, 3.5], [4, 96, 3.5], [24, 114, 2], [50, 134, 3], [84, 126, 4], [94, 104, 2], [36, 98, 1.8], [66, 92, 2], [18, 132, 2.5], [58, 112, 1.5], [96, 72, 1.5]];
      for (const [x, y, rr] of at) out += `<circle cx="${x}" cy="${y}" r="${rr * 1.25}" fill="#ffc531" opacity="${0.45 + r() * 0.3}"/>`;
      return out;
    },
    stripes(s) {
      let out = `<rect width="100" height="140" fill="#3aa6a2"/>`;
      for (let x = 2; x < 100; x += 8.4) out += `<rect x="${x}" y="0" width="4.2" height="140" fill="#2a7f74"/>`;
      return out;
    },
    squiggles(s) {
      const Q = 'M0 0 C4 3 -4 7 0 10 C4 13 -4 17 0 20';
      const at = [[16, 4, 20], [52, -4, -30], [86, 8, 40], [6, 40, -10], [92, 46, 15], [30, 66, 60], [72, 70, -40], [12, 96, 25], [56, 100, -15], [92, 104, 70], [30, 122, -60], [74, 126, 20]];
      return at.map(([x, y, a]) => `<path d="${Q}" transform="translate(${x} ${y}) rotate(${a})" fill="none" stroke="#ab3878" stroke-width="1.3" stroke-linecap="round"/>`).join('');
    },
    'stars-solid'(s) {
      const at = [[10, 6, 4], [44, 8, 3], [78, 4, 4.5], [94, 22, 3], [6, 34, 4], [92, 46, 4.5], [8, 64, 3.5], [30, 84, 4], [86, 76, 3], [62, 94, 3.5], [12, 104, 4.5], [90, 102, 4], [40, 126, 4], [72, 130, 3], [8, 132, 3]];
      return at.map(([x, y, rr]) => `<polygon points="${star(x, y, rr * 1.3)}" fill="#ee8329" opacity=".85"/>`).join('');
    },
    waves(s) {
      // wavy vertical stripes, like the printed FOOD card
      let out = '';
      const band = (x0, w, amp, ph) => {
        const L = [], R = [];
        for (let y = -6; y <= 146; y += 6) { const dx = Math.sin(y / 14 + ph) * amp; L.push(f2(x0 + dx) + ',' + y); R.unshift(f2(x0 + w + dx) + ',' + y); }
        return L.concat(R).join(' ');
      };
      for (let k = 0; k < 8; k++) {
        const x = -8 + k * 15;
        out += `<polygon points="${band(x, 7, 3, k * 0.7)}" fill="#ffffff" opacity=".13"/>`;
        out += `<polyline points="${band(x + 10, 0, 3, k * 0.7 + 0.4).split(' ').slice(0, 26).join(' ')}" fill="none" stroke="#6ee0e6" stroke-width="1.2" opacity=".45"/>`;
      }
      return out;
    },
    pinstripe(s) {
      let out = '';
      for (let x = 0; x < 100; x += 12) out += `<rect x="${x}" y="0" width="6" height="140" fill="#fff" opacity=".07"/>`;
      return out;
    },
  };

  const BG_URI = {};
  BL.bgURI = (id) => BG_URI[id];
  for (const s of SETS) {
    const grad = `<defs><radialGradient id="v" cx=".5" cy=".42" r=".75"><stop offset="0" stop-color="${s.bg2}"/><stop offset="1" stop-color="${s.bg}"/></radialGradient>
      <linearGradient id="lg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${s.bg}"/><stop offset="1" stop-color="${s.bg2}"/></linearGradient></defs>`;
    const fill = s.pattern === 'pinstripe' || s.pattern === 'waves' ? 'url(#lg)' : 'url(#v)';
    BG_URI[s.id] = uri(svg('0 0 100 140', grad + `<rect width="100" height="140" fill="${fill}"/>` + PAT[s.pattern](s), 'preserveAspectRatio="none"'));
  }

  /* inject per-set CSS (background images + colours) once */
  const css = SETS.map((s) => `.set-${s.id}{--bg:${s.bg};--title:${s.title};--shade:${s.shade};--fs:${s.fs}cqw;--ls:${s.ls}em}
.set-${s.id} .f-bg{background-image:url("${BG_URI[s.id]}")}`).join('\n');
  const st = document.createElement('style');
  st.textContent = css;
  document.head.appendChild(st);

  /* ------------------------------------------------------------------ */
  /*  CARD BUILDERS                                                      */
  /* ------------------------------------------------------------------ */
  const el = (tag, cls, html) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  };
  BL.el = el;

  function frontHTML(s, mini, quote) {
    const ico = ICON_URI[s.icon];
    return `<div class="f-bg"></div>
      <img class="f-ico-s ico-${s.icon}" src="${ico}" alt="" draggable="false">
      <div class="f-band"><span>${s.name}</span></div>
      <img class="f-ico-l ico-${s.icon}" src="${ico}" alt="" draggable="false">
      ${mini ? '' : `<div class="f-cp"><small>Connecting Point</small><p>${quote || s.quote}</p></div>`}
      <div class="f-sheen"></div>`;
  }
  function backHTML() {
    return `<div class="b-bg"></div>
      <img class="b-c b-tl" src="${ICON_URI.grin}" alt="" draggable="false">
      <img class="b-c b-tr" src="${ICON_URI.heart}" alt="" draggable="false">
      <img class="b-c b-bl" src="${ICON_URI.apple}" alt="" draggable="false">
      <img class="b-c b-br" src="${ICON_URI.money}" alt="" draggable="false">
      <div class="b-logo">BEST LIFE<sup>TM</sup></div>
      <div class="f-sheen"></div>`;
  }
  BL.frontHTML = frontHTML;
  BL.backHTML = backHTML;

  /** A two-sided 3D card. opts: {mini, back:false, cls} */
  BL.card = function (setId, opts = {}) {
    const s = BY_ID[setId];
    const c = el('div', 'card' + (opts.mini ? ' mini' : '') + (opts.cls ? ' ' + opts.cls : ''));
    c.dataset.set = setId;
    const inner = el('div', 'card-inner');
    const front = el('div', 'face front set-' + s.id, frontHTML(s, opts.mini, opts.quote));
    const back = el('div', 'face back', backHTML());
    inner.append(front, back);
    c.append(inner);
    if (opts.label !== false) c.setAttribute('aria-label', s.name + ' card: ' + (opts.quote || s.quote));
    return c;
  };
  const ACTION_BG = uri(svg('0 0 100 140', `<defs><radialGradient id="r" cx=".5" cy=".45" r=".8"><stop offset="0" stop-color="#ec4a3b"/><stop offset="1" stop-color="#cf2f27"/></radialGradient></defs>
    <rect width="100" height="140" fill="url(#r)"/>` + (() => {
      const r = rng(9); let out = '';
      for (let row = 0; row < 7; row++) for (let col = 0; col < 4; col++) {
        const x = col * 30 + (row % 2 ? 15 : 0) + (r() - 0.5) * 8, y = row * 22 + (r() - 0.5) * 8;
        out += `<polygon points="${star(x, y, 12 + r() * 4, -Math.PI / 2 + (r() - 0.5) * 0.6, 0.46)}" fill="none" stroke="#a91f1a" stroke-width="1.2" stroke-linejoin="round" opacity=".55"/>`;
      }
      return out;
    })(), 'preserveAspectRatio="none"'));
  function actionHTML(a) {
    return `<div class="f-bg" style="background-image:url('${ACTION_BG}')"></div>
      <div class="a-title">ACTION<br>CARD</div>
      <img class="a-ico" src="${ICON_URI[a.icon]}" alt="" draggable="false">
      <div class="a-text">${a.text.replace('Take 2 Cards ', 'Take 2 Cards<br>').replace('Take Another', 'Take<br>Another')}</div>
      <div class="f-sheen"></div>`;
  }
  BL.actionCard = function (id, opts = {}) {
    const a = BL.ACTIONS.find((x) => x.id === id);
    const c = el('div', 'card action-card' + (opts.cls ? ' ' + opts.cls : ''));
    const inner = el('div', 'card-inner');
    inner.append(el('div', 'face front action', actionHTML(a)), el('div', 'face back', backHTML()));
    c.append(inner);
    c.setAttribute('aria-label', 'Action card: ' + a.text);
    return c;
  };
  BL.flatAction = (id) => el('div', 'flatcard face front action', actionHTML(BL.ACTIONS.find((x) => x.id === id)));
  /** flat single face (no 3D), used inside the box art */
  BL.flatCard = function (setId, mini) {
    const s = BY_ID[setId];
    const c = el('div', 'flatcard face front set-' + s.id, frontHTML(s, mini));
    return c;
  };
  BL.flatBack = () => el('div', 'flatcard face back', backHTML());

  /* ------------------------------------------------------------------ */
  /*  BOX (tuck box) — 3D cuboid with opening lid                        */
  /* ------------------------------------------------------------------ */
  BL.buildBox = function (W) {
    const H = Math.round(W * 1.39), D = Math.round(W * 0.3), F = Math.round(D * 0.75);
    const box = el('div', 'box3d');
    box.style.setProperty('--W', W + 'px');
    box.style.setProperty('--H', H + 'px');
    box.style.setProperty('--D', D + 'px');
    const plane = (cls, w, h, tf, html) => {
      const p = el('div', 'bx-face ' + cls, html || '');
      p.style.width = w + 'px';
      p.style.height = h + 'px';
      p.style.left = -w / 2 + 'px';
      p.style.top = -h / 2 + 'px';
      p.style.transform = tf;
      return p;
    };
    const I = ICON_URI;
    const front = `<div class="bx-front-in">
        <div class="bx-go">GO FOR YOUR</div>
        <div class="bx-best">BEST LIFE</div><div class="bx-tm">TM</div>
        <div class="bx-tag">New Fun<br>Game About Life</div>
        <div class="bx-icons"><img src="${I.grin}" alt=""><img src="${I.heart}" alt=""><img src="${I.apple}" alt=""><img src="${I.money}" alt=""></div>
        <div class="bx-foot">2 - 6 Players &bull; Ages 7 to 107</div></div>`;
    const back = `<div class="bx-back-in"><div class="bx-notch"></div>
        <div class="bx-fan"></div>
        <div class="bx-list"><div class="bx-bl">BEST<br>LIFE</div>
          <p>52 Different<br>Interesting<br>Fun Cards</p><p>12 Sets</p><p>Rules<br>of Play</p><p>Ask<br>to Win!</p></div></div>`;

    // inner cardboard (visible once the lid opens)
    box.append(
      plane('inner', W, H, `translateZ(${-D / 2 + 1}px)`),
      plane('inner', D, H, `rotateY(90deg) translateZ(${-(W / 2 - 1)}px)`),
      plane('inner', D, H, `rotateY(-90deg) translateZ(${-(W / 2 - 1)}px)`),
      plane('inner floor', W, D, `rotateX(90deg) translateZ(${-(H / 2 - 1)}px)`),
      plane('inner', W, H, `rotateY(180deg) translateZ(${-(D / 2 - 1)}px)`)
    );
    const fFront = plane('front', W, H, `translateZ(${D / 2}px)`, front);
    const fBack = plane('back', W, H, `rotateY(180deg) translateZ(${D / 2}px)`, back);
    const fRight = plane('side right', D, H, `rotateY(90deg) translateZ(${W / 2}px)`, `<span>+48 Connecting Points</span>`);
    const fLeft = plane('side left', D, H, `rotateY(-90deg) translateZ(${W / 2}px)`, `<span>52 Playing Cards</span>`);
    const fBottom = plane('end bottom', W, D, `rotateX(-90deg) translateZ(${H / 2}px)`, `<div><b>Best Selling Games</b><i>&copy; 2026 SFK AND ASSOCIATES LLC</i></div>`);
    box.append(fFront, fBack, fRight, fLeft, fBottom);

    // lid: hinge on the top-back edge
    const lid = el('div', 'bx-lid');
    lid.style.transform = `translate3d(0, ${-H / 2}px, ${-D / 2}px) rotateX(0deg)`;
    lid.append(
      plane('end top', W, D, `translateZ(${D / 2}px) rotateX(90deg)`, `<div><b class="gold">GOLD EDITION</b></div>`),
      plane('inner lid-under', W, D, `translateZ(${D / 2}px) rotateX(-90deg)`),
    );
    const flap = el('div', 'bx-flap');
    flap.style.transform = `translate3d(0,0,${D - 1.5}px)`;
    flap.append(
      plane('flap-out', W - 4, F, `translate3d(0, ${F / 2}px, 0)`),
      plane('flap-in', W - 4, F, `translate3d(0, ${F / 2}px, 0) rotateY(180deg)`)
    );
    lid.append(flap);
    box.append(lid);

    // fan of cards printed on the back panel
    const fan = fBack.querySelector('.bx-fan');
    [['food', -14, 30, 4], ['family', -22, 8, 22], ['goals', 8, 33, 37], ['friends', -16, 4, 56], ['money', 7, 21, 64]].forEach(([id, rot, x, y], i) => {
      const c = BL.flatCard(id);
      c.style.left = x + '%';
      c.style.top = y + '%';
      c.style.transform = `rotate(${rot}deg)`;
      c.style.zIndex = i;
      fan.append(c);
    });

    box._parts = { lid, flap, W, H, D, F };
    return box;
  };
})();
