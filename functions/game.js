// نسخة الخادم من حسابات اللعبة: نفس أرقام index.html حتى يتحقق الخادم من الثروة بنفسه.
'use strict';

const DEF = [
  { id: 'tea',     cost: 4e3,    rev: 1.2e3,  t: 1.2, mgr: 6e4,    tags: ['food'] },
  { id: 'bread',   cost: 6e4,    rev: 4.2e4,  t: 3,   mgr: 1e6,    tags: ['power'] },
  { id: 'falafel', cost: 7.2e5,  rev: 3.6e5,  t: 6,   mgr: 9e6,    tags: ['food'] },
  { id: 'cloth',   cost: 8.6e6,  rev: 2.8e6,  t: 12,  mgr: 7e7,    tags: ['retail'] },
  { id: 'phone',   cost: 1.03e8, rev: 3.3e7,  t: 24,  mgr: 7e8,    tags: ['power', 'dollar'] },
  { id: 'fish',    cost: 1.24e9, rev: 4e8,    t: 48,  mgr: 8e9,    tags: ['food'] },
  { id: 'mall',    cost: 1.5e10, rev: 4.8e9,  t: 96,  mgr: 9e10,   tags: ['retail', 'power'] },
  { id: 'ship',    cost: 1.8e11, rev: 5.8e10, t: 192, mgr: 1.1e12, tags: ['dollar'] },
  { id: 'oil',     cost: 2.6e12, rev: 9e11,   t: 384, mgr: 2e13,   tags: ['dollar', 'power'] }
];
const GROW = 1.09, MILES = [10, 25, 50, 100, 200, 300, 400, 500];
const ASSETS = [
  { id: 'usd',    base: 1.5e5, vol: .035, seed: 11 },
  { id: 'gold',   base: 5.4e5, vol: .07,  seed: 23 },
  { id: 'wheat',  base: 7.2e5, vol: .11,  seed: 37 },
  { id: 'oil',    base: 1.0e5, vol: .16,  seed: 41 },
  { id: 'cement', base: 1.4e5, vol: .09,  seed: 53 },
  { id: 'tel',    base: 2.5e4, vol: .24,  seed: 67 }
];
const CITIES = {
  bgd: { cost: 0,    tag: null,     px: {} },
  bsr: { cost: 2e7,  tag: 'dollar', px: { oil: -.09, usd: -.02, wheat: .04, tel: .03 } },
  erb: { cost: 3e8,  tag: 'retail', px: { gold: -.06, cement: .07, tel: -.04 } },
  njf: { cost: 5e9,  tag: 'food',   px: { wheat: -.07, gold: .04, usd: .02 } },
  msl: { cost: 8e10, tag: 'power',  px: { cement: -.09, wheat: -.03, oil: .05 } }
};
const RARE = [{ all: 1.2 }, { tag: 'dollar', m: 1.5 }, { tag: 'food', m: 1.5 }, { tag: 'retail', m: 1.5 }, { tag: 'power', m: 1.5 }, { all: 1.2 }];
const TRAIT_SP = { steady: 1, fast: 1.3, sly: 1.6, lazy: .75 };
const FEE = .005, STEP = 10;

const num = (v, max = 1e30) => (typeof v === 'number' && isFinite(v) ? Math.max(0, Math.min(max, v)) : 0);
const int = (v, max = 1e6) => Math.floor(num(v, max));

function h1(i, s) { const x = Math.sin(i * 127.1 + s * 311.7) * 43758.5453; return x - Math.floor(x); }
function sm(t, s) { const i = Math.floor(t), f = t - i, u = f * f * (3 - 2 * f); return (h1(i, s) * (1 - u) + h1(i + 1, s) * u) * 2 - 1; }
function priceAt(a, st) {
  const n = .5 * sm(st / 360, a.seed) + .3 * sm(st / 40, a.seed + 1) + .15 * sm(st / 9, a.seed + 2) + .05 * sm(st / 2, a.seed + 3);
  return Math.round(a.base * Math.exp(a.vol * 2.2 * n));
}

/** Clean a client save into numbers the server can trust the shape of. */
function normalize(st) {
  const b = Array.isArray(st && st.b) ? st.b : [];
  return {
    cash: num(st && st.cash),
    esc: st && st.esc ? num(st.esc.amt) : 0,
    loan: st && st.loan ? num(st.loan.owe) : 0,
    rank: int(st && st.rank, 5),
    cities: Array.isArray(st && st.cities) ? st.cities.filter(c => CITIES[c]) : ['bgd'],
    city: st && CITIES[st.city] ? st.city : 'bgd',
    rare: Array.isArray(st && st.rare) ? st.rare.filter(k => RARE[k]).slice(0, 200) : [],
    h: st && typeof st.h === 'object' && st.h ? st.h : {},
    b: DEF.map((d, i) => ({ n: int(b[i] && b[i].n, 1e5), mgr: !!(b[i] && b[i].mgr), t: b[i] && b[i].staff && TRAIT_SP[b[i].staff.t] ? b[i].staff.t : 'steady' }))
  };
}

function worthOf(raw, now = Date.now()) {
  const s = normalize(raw);
  let shops = 0;
  s.b.forEach((b, i) => {
    if (!b.n) return;
    const d = DEF[i];
    shops += d.cost * (Math.pow(GROW, b.n) - 1) / (GROW - 1) + (b.mgr ? d.mgr : 0);
  });
  s.cities.forEach(c => { shops += CITIES[c].cost; });
  shops -= DEF[0].cost;
  const st = Math.floor(now / 1000 / STEP);
  let port = 0;
  ASSETS.forEach(a => {
    const h = s.h[a.id];
    const q = h ? int(h.q, 1e12) : 0;
    if (q) port += q * priceAt(a, st) * (1 + (CITIES[s.city].px[a.id] || 0)) * (1 - FEE);
  });
  return s.cash + Math.max(0, shops) + port + s.esc - s.loan;
}

/** The most income per second this save could make, with every bonus at its best (used only as an upper bound). */
function maxRate(raw) {
  const s = normalize(raw);
  let r = 0;
  s.b.forEach((b, i) => {
    if (!b.n) return;
    const d = DEF[i];
    let sp = 1; MILES.forEach(x => { if (b.n >= x) sp *= 2; });
    sp *= Math.max(TRAIT_SP[b.t] || 1, 1.6);
    let m = 5 * 1.5 * (1 + .05 * s.rank);                   // best event ×5, best boost ×1.5, rank bonus
    s.cities.forEach(c => { const C = CITIES[c]; if (C.cost) { m *= 1.25; if (d.tags.includes(C.tag)) m *= 1.5; } });
    s.rare.forEach(k => { const R = RARE[k]; if (R.all) m *= R.all; else if (d.tags.includes(R.tag)) m *= R.m; });
    r += d.rev * b.n * m / (d.t / sp);
  });
  return r;
}

/**
 * How much a player's verified worth may grow between two saves.
 * Generous on purpose: legit play never hits it, but pasting a huge number into the save does.
 */
function growthBound(prevWorth, prevRate, dtSec) {
  const dt = Math.max(0, Math.min(dtSec, 7 * 86400));
  const trading = Math.min(prevWorth * 3, prevWorth * .8 * dt / 600);   // up to +80% per 10 minutes from trading
  const income = prevRate * (dt * 10 + 3600);                           // 10× the best income, plus an hour of slack for gifts
  return prevWorth + trading + income + 5e6;
}

module.exports = { worthOf, maxRate, growthBound, normalize, DEF };
