// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Gatti Elia
// Mondo pixel: strada pseudo-3D con pendenze e curve, 4 ambienti che cambiano da soli,
// traffico, pedoni, animali, uccelli, incroci, ciclista con inclinazione e gesti, visuale in prima persona.
import { gradeOf } from './plan.js';

export const V = {
  theme: 'auto',      // 'auto' | country | hills | mountains | city
  cam: 'third',       // 'third' | 'first'
  dist: 0, curve: 0, lean: 0, Hc: 74, reduced: false, phase: 0, running: false,
  view: 'prof', prog: 0, time: 0, speed: 0, slope: 0, cad: 0, power: 0, hard: false,
  env: 'country', gesture: null, bubble: null,
  lat: 0.5, latT: 0.5, rest: 0.5, inv: 0, auto: true, jump: 0, jumpT: -1, shake: 0, hitT: 0, events: [], bike: 0,   // lat 0.5 = corsia di destra (la strada va da -1 a +1)
  kit: { jersey: '#ff7a1a', jersey2: '#ffd070', pattern: 'zip', shorts: '#1a1a28', helmet: '#f4f1ff', skin: '#f0b890', emblem: '', emblemColor: '#ffffff', text: '', img: null },
  bikeC: null, traffic: true, hazards: true, gestures: true
};
export let SCALE = 3;                      // risoluzione interna 960x540: bordi morbidi, niente pixel grossi
let ZM = 1;                                  // zoom: 1ª persona più vicina alla strada
export const ENV_ORDER = ['country', 'hills', 'mountains', 'city'];
export const ENV_NAME = { country: 'CAMPAGNA', hills: 'COLLINE', mountains: 'MONTAGNA', city: 'CITTÀ' };
export const ENV_LEN = 900;                  // metri per ambiente (poi cambia in automatico)
const TRACK = 3600, XING = 720;              // il mondo si ripete ogni 3600 m; un incrocio ogni 720 m
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
let steps = [], TOTAL = 1, el = new Float32Array(2), elMin = 0, elMax = 1;
const typeCol = { warmup: '#ffcc33', interval: '#ff5a5f', recovery: '#4be37a', cooldown: '#4bc4ff', rest: '#9a93c9' };
export const typeLbl = { warmup: 'RISCALD.', interval: 'WORK', recovery: 'RECUPERO', cooldown: 'DEFATICA', rest: 'PAUSA' };
const $ = id => document.getElementById(id);

export function setProfile(plan, ftp, speedFor) {
  steps = plan.steps; TOTAL = Math.max(1, Math.round(plan.total));
  el = new Float32Array(TOTAL + 1);
  for (let i = 1; i <= TOTAL; i++) {
    const s = steps.find(x => i - 1 >= x.start && i - 1 < x.start + x.dEst) || steps[steps.length - 1];
    el[i] = el[i - 1] + s.slope / 100 * speedFor(s.mid, s.slope);
  }
  elMin = Math.min(...el); elMax = Math.max(...el);
}

/* ---------- utilità ---------- */
const hsh = n => { n = Math.imul(n ^ (n >>> 15), 2246822519); n = Math.imul(n ^ (n >>> 13), 3266489917); return ((n ^ (n >>> 16)) >>> 0) / 4294967295; };
const hexc = {};
const hex = h => hexc[h] || (hexc[h] = [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)));
const mixc = (a, b, t) => { const A = hex(a), B = hex(b); return '#' + A.map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, '0')).join(''); };
let cv, c, sv, sc, rc, rctx;
const Q = v => Math.round(v * SCALE) / SCALE;
const R = (x, y, w, h, col) => { c.fillStyle = col; c.fillRect(Q(x), Q(y), Math.max(1 / SCALE, Q(w)), Math.max(1 / SCALE, Q(h))); };
/** qualità grafica: 1 = veloce, 2 = media, 3 = alta (risoluzione interna 320x180 × q) */
export function setQuality(q) { const n = clamp(Math.round(q), 1, 3); if (n === SCALE) return; SCALE = n; if (cv) { cv.width = 320 * SCALE; cv.height = 180 * SCALE; } }
export function initCanvas() {
  cv = $('scene'); cv.width = 320 * SCALE; cv.height = 180 * SCALE; c = cv.getContext('2d'); sv = $('side'); sc = sv.getContext('2d');
  rc = document.createElement('canvas'); rc.width = 56; rc.height = 72; rctx = rc.getContext('2d');
}

/* ---------- bici da corsa (colori ispirati alle livree; nessun logo) ---------- */
export const BIKES = [
  { id: 'propel', name: 'Giant Propel Advanced', frame: '#1b1b21', accent: '#e8433a', deep: 1 },
  { id: 'tarmac', name: 'Specialized Tarmac SL8', frame: '#d6232a', accent: '#111111', deep: 0 },
  { id: 'madone', name: 'Trek Madone SLR', frame: '#17171c', accent: '#e63c2f', deep: 1 },
  { id: 'dogma', name: 'Pinarello Dogma F', frame: '#1f4bd8', accent: '#e8e8f0', deep: 1 },
  { id: 'supersix', name: 'Cannondale SuperSix EVO', frame: '#12a5a5', accent: '#111111', deep: 0 },
  { id: 'tcr', name: 'Giant TCR Advanced', frame: '#15151a', accent: '#3ec46d', deep: 0 },
  { id: 'v4rs', name: 'Colnago V4Rs', frame: '#c8102e', accent: '#f4f1ff', deep: 1 },
  { id: 'aeroad', name: 'Canyon Aeroad', frame: '#ececf2', accent: '#16161c', deep: 1 },
  { id: 'teammachine', name: 'BMC Teammachine', frame: '#b8322a', accent: '#16161c', deep: 0 },
  { id: 'oltre', name: 'Bianchi Oltre', frame: '#3cc9c1', accent: '#ffffff', deep: 1 },
  { id: 's5', name: 'Cervélo S5', frame: '#0e0e12', accent: '#e8b83a', deep: 1 },
  { id: 'addict', name: 'Scott Addict RC', frame: '#e8e8ee', accent: '#f0c400', deep: 0 },
  { id: 'filante', name: 'Wilier Filante', frame: '#e8791c', accent: '#1a1a20', deep: 1 },
  { id: 'venge', name: 'Specialized Venge', frame: '#1c1c22', accent: '#e63c2f', deep: 1 },
  { id: 'emonda', name: 'Trek Émonda', frame: '#e8e8ee', accent: '#d6232a', deep: 0 },
  { id: 'ultimate', name: 'Canyon Ultimate', frame: '#2a3a8a', accent: '#f4f1ff', deep: 0 },
  { id: 'r5', name: 'Cervélo R5', frame: '#c8102e', accent: '#16161c', deep: 0 },
  { id: 'foil', name: 'Scott Foil', frame: '#16161c', accent: '#f0c400', deep: 1 },
  { id: 'prince', name: 'Pinarello Prince', frame: '#d8b04a', accent: '#16161c', deep: 0 }
];
export const curBike = () => { const b = BIKES[V.bike] || BIKES[0]; return V.bikeC ? { ...b, ...V.bikeC } : b; };
export function setBike(id) { const i = BIKES.findIndex(b => b.id === id); V.bike = i >= 0 ? i : 0; return BIKES[V.bike]; }

/* ---------- palette degli ambienti ---------- */
const TH = {
  country:   { sky0: '#4fb6ee', sky1: '#cdeeff', sun: '#fff3a0', cloud: '#ffffff', far: '#6aa7a0', far2: '#4f8f8a', g1: '#3fae3a', g2: '#36a032', road1: '#585864', road2: '#50505c', edge1: '#e8e8e8', edge2: '#d93a3a', obj: 'tree' },
  hills:     { sky0: '#f2a65a', sky1: '#fde9b0', sun: '#fff7d0', cloud: '#fff1d6', far: '#d29a62', far2: '#b87d4c', g1: '#a3b84f', g2: '#94aa44', road1: '#6a6258', road2: '#625a50', edge1: '#e8e0d0', edge2: '#b0643c', obj: 'cyp' },
  mountains: { sky0: '#6f98e0', sky1: '#d4e4ff', sun: '#ffffff', cloud: '#f0f5ff', far: '#8c93a8', far2: '#6e7690', g1: '#5d8a5a', g2: '#527d52', road1: '#5a5f6b', road2: '#525763', edge1: '#f0f0f0', edge2: '#c8c8d0', obj: 'pine' },
  city:      { sky0: '#1c1448', sky1: '#d0558a', sun: '#ffd6a0', cloud: '#6a3f8c', far: '#1a1438', far2: '#120d2c', g1: '#2e2e42', g2: '#292939', road1: '#3d3d4c', road2: '#363645', edge1: '#9a9ab0', edge2: '#6a6a80', obj: 'bld' }
};
const COLKEYS = Object.keys(TH.country).filter(k => k !== 'obj');
function envAt(z) { return ENV_ORDER[Math.floor(z / ENV_LEN) % 4]; }
let ROUTE = null;
/** percorso reale attivo (o null = mondo generato) */
export function setRoute(r) { ROUTE = r; }
/** ambiente alla distanza assoluta z (m): dal percorso reale se c'e', altrimenti ciclico */
const envOf = z => ROUTE ? ROUTE.env(z) : envAt(z);
const tk = k => TH[k] || TH.country;
function palette() {
  if (V.theme !== 'auto') { V.env = V.theme; return tk(V.theme); }
  if (ROUTE) {                                    // sfumatura sui ±60 m attorno a te
    const here = ROUTE.env(V.dist); let other = here, cnt = 0;
    for (let o = -60; o <= 60; o += 20) { const e = ROUTE.env(V.dist + o); if (e !== here) { other = e; cnt++; } }
    V.env = here; if (!cnt) return tk(here);
    const out = { obj: cnt > 3 ? tk(other).obj : tk(here).obj }; for (const key of COLKEYS) out[key] = mixc(tk(here)[key], tk(other)[key], cnt / 7);
    return out;
  }
  const idx = Math.floor(V.dist / ENV_LEN), a = ENV_ORDER[idx % 4], b = ENV_ORDER[(idx + 1) % 4];
  const f = (V.dist % ENV_LEN) / ENV_LEN, k = f > 0.88 ? (f - 0.88) / 0.12 : 0;
  V.env = k > 0.5 ? b : a;
  if (!k) return tk(a);
  const out = { obj: k > 0.5 ? tk(b).obj : tk(a).obj };
  for (const key of COLKEYS) out[key] = mixc(tk(a)[key], tk(b)[key], k);
  return out;
}
const themeAtZ = z => V.theme === 'auto' ? envAt(z) : V.theme;

/* ---------- mondo: oggetti e vita, generati una volta (deterministici) ---------- */
const statics = [], movers = [], crossers = [];
function buildWorld() {
  for (let i = 0; i < 640; i++) {
    const z = hsh(i * 3 + 1) * TRACK, th = envAt(z), r = hsh(i * 7 + 5);
    let type = 'tree';
    if (th === 'country') type = r < .32 ? 'tree' : r < .42 ? 'house' : r < .52 ? 'cow' : r < .6 ? 'sheep' : r < .66 ? 'hay' : r < .8 ? 'bush' : r < .92 ? 'flower' : 'fence';
    else if (th === 'hills') type = r < .34 ? 'cyp' : r < .42 ? 'house' : r < .56 ? 'vine' : r < .64 ? 'sheep' : r < .78 ? 'bush' : r < .88 ? 'tree' : 'flower';
    else if (th === 'mountains') type = r < .4 ? 'pine' : r < .62 ? 'rock' : r < .72 ? 'goat' : r < .88 ? 'bush' : 'pine';
    else type = r < .5 ? 'bld' : r < .75 ? 'lamp' : r < .9 ? 'banner' : 'bld';
    statics.push({ z, side: hsh(i + 99) < 0.5 ? -1 : 1, off: hsh(i + 7) * 60 + (['cow', 'sheep', 'goat', 'hay', 'vine', 'flower'].includes(type) ? 14 : 0), k: i, type, th });
  }
  const colors = ['#d93a3a', '#3a6fd9', '#e8e8e8', '#2c2c34', '#e8b83a', '#3aa05a', '#8a3ad9'];
  const shirts = ['#e8e8e8', '#3a6fd9', '#d93a3a', '#3aa05a', '#e8b83a', '#8a3ad9', '#ff7a1a'];
  const add = (type, n, seed, o) => { for (let i = 0; i < n; i++) { const z = hsh(seed + i * 5) * TRACK; movers.push({ type, z0: z, k: seed + i, th: envAt(z), col: colors[Math.floor(hsh(seed + i * 11) * colors.length)], sh: shirts[Math.floor(hsh(seed + i * 13) * shirts.length)], ...o(i) }); } };
  add('car', 16, 1000, i => ({ vel: 12 + hsh(1000 + i) * 6, lane: -0.18 }));
  add('car', 24, 2000, i => ({ vel: -(11 + hsh(2000 + i) * 6), lane: -0.62, front: true }));
  add('bike', 12, 3000, i => ({ vel: 4.5 + hsh(3000 + i) * 3.5, lane: 0.82 }));      // sul bordo destro: il ciclista (corsia 0.35) li supera senza toccarli
  add('bike', 6, 4000, i => ({ vel: -(5 + hsh(4000 + i) * 3), lane: -0.82, front: true }));
  add('tractor', 3, 5000, () => ({ vel: 3, lane: 0.82 }));
  for (let i = 0; i < 70; i++) {
    const z = hsh(6000 + i * 3) * TRACK, th = envAt(z);
    const dens = th === 'city' ? 1 : th === 'country' ? 0.45 : 0.3; if (hsh(6100 + i) > dens + 0.25) continue;
    movers.push({ type: 'ped', z0: z, k: 6000 + i, th, vel: (hsh(6200 + i) < 0.5 ? -1 : 1) * (1.1 + hsh(6300 + i) * 0.6), side: hsh(6400 + i) < 0.5 ? -1 : 1, off: 6 + hsh(6500 + i) * 14, sh: shirts[Math.floor(hsh(6600 + i) * shirts.length)], dog: hsh(6700 + i) < 0.3 });
  }
  for (let j = 0; j < TRACK / XING; j++) for (let n = 0; n < 2; n++) crossers.push({ zc: 360 + XING * j, k: j * 2 + n, hold: 0, vx: (n ? -1 : 1) * (0.35 + hsh(7000 + j + n) * 0.25), ph: hsh(7100 + j * 3 + n) * 6, col: colors[Math.floor(hsh(7200 + j + n * 9) * colors.length)] });
}
const hazards = [];
for (let i = 0; i < TRACK / 150; i++) {
  let z = i * 150 + 40 + hsh(8000 + i) * 70;
  const x = (((z - 360) % XING) + XING) % XING; if (x < 14 || x > XING - 14) z += 30;
  const works = hsh(8100 + i) < 0.3, lanePos = works ? (hsh(8200 + i) < 0.5 ? -1 : 1) * 0.45 : (hsh(8300 + i) - 0.35) * 0.9;
  hazards.push({ type: works ? 'works' : 'pothole', z, lane: lanePos, w: works ? 0.85 : 0.22, k: i, prev: 999, done: false });
}
buildWorld();

/* ---------- uccelli e nuvole (nello schermo) ---------- */
const flocks = []; for (let i = 0; i < 4; i++) flocks.push({ x: hsh(i + 400) * 320, y: 12 + hsh(i + 410) * 34, vx: (hsh(i + 420) < 0.5 ? -1 : 1) * (6 + hsh(i + 430) * 10), n: 2 + Math.floor(hsh(i + 440) * 4), ph: hsh(i + 450) * 6 });
let lastTime = 0;
function stepFlocks(dt) { for (const f of flocks) { f.x += f.vx * dt; if (f.x > 360) f.x = -40; if (f.x < -40) f.x = 360; f.y += Math.sin(V.time * 0.7 + f.ph) * 0.05; } }
function drawBirds(H, th) {
  const day = V.env !== 'city';
  for (const f of flocks) for (let i = 0; i < f.n; i++) {
    const x = f.x - i * 7 * Math.sign(f.vx) + Math.sin(i * 2 + f.ph) * 2, y = f.y + i * 2 + Math.sin(i) * 2;
    if (y > H - 4) continue;
    const up = Math.sin(V.time * 9 + f.ph + i) > 0, col = day ? '#2a2a3a' : '#ffd0e0';
    R(x - 2, y + (up ? -1 : 1), 2, 1, col); R(x, y, 1, 1, col); R(x + 1, y + (up ? -1 : 1), 2, 1, col);
  }
}

/* ---------- sprite (S = pixel per metro alla distanza p) ---------- */
function drawObj(o, p, x, yb, th) {
  const h = (6 + p * 70) * ZM, w = (3 + p * 26) * ZM, S = 36 * p * ZM, t = o.type, sw = Math.sin(V.time * 1.3 + o.k) * w * .03;
  if (t === 'tree') { R(x - w * .08, yb - h * .4, Math.max(1, w * .16), h * .4, '#6b4a2b'); R(x - w * .5 + sw, yb - h, w, h * .65, '#2e8b2e'); R(x - w * .32 + sw * 1.4, yb - h * 1.12, w * .64, h * .2, '#3aa43a'); R(x - w * .5 + sw, yb - h * .7, w * .18, h * .3, '#237023'); }
  else if (t === 'cyp') { R(x - w * .22, yb - h * 1.25, w * .44, h * 1.25, '#3d5a2a'); R(x - w * .14, yb - h * 1.4, w * .28, h * .2, '#4d6e34'); R(x - w * .22, yb - h * 1.25, w * .1, h * 1.25, '#2f4720'); }
  else if (t === 'pine') { R(x - w * .06, yb - h * .25, Math.max(1, w * .12), h * .25, '#4a3320'); for (let i = 0; i < 3; i++) { const ww = w * (1 - i * .3); R(x - ww / 2, yb - h * (.3 + i * .32), ww, h * .34, i % 2 ? '#26603f' : '#1f4d36'); } if (V.env === 'mountains') R(x - w * .15, yb - h * 1.0, w * .3, h * .06, '#f4f8ff'); }
  else if (t === 'bld') { const ww = w * 1.3, hh = h * 1.7; R(x - ww / 2, yb - hh, ww, hh, o.k % 2 ? '#3b3b66' : '#4a3a78'); R(x + ww / 2 - ww * .18, yb - hh, ww * .18, hh, 'rgba(0,0,0,.25)');
    if (p > .22) { const cols = Math.max(2, Math.floor(ww / 6)), rows = Math.max(3, Math.floor(hh / 8)); for (let a = 0; a < cols; a++) for (let b = 0; b < rows; b++) if (hsh(o.k * 31 + a * 7 + b + Math.floor(V.time / 9 + hsh(a + b + o.k) * 3) * 0) > .4) R(x - ww / 2 + 3 + a * (ww - 4) / cols, yb - hh + 3 + b * (hh - 4) / rows, Math.max(1, ww / cols * .4), Math.max(1, hh / rows * .4), '#ffd96a'); } }
  else if (t === 'lamp') { R(x, yb - 2.8 * S, Math.max(1, S * .08), 2.8 * S, '#555'); R(x - S * .5, yb - 2.8 * S, S * .6, Math.max(1, S * .1), '#555'); R(x - S * .5, yb - 2.7 * S, S * .25, Math.max(1, S * .12), '#ffe9a0'); }
  else if (t === 'house') { const ww = 4.5 * S, hh = 2.6 * S; R(x - ww / 2, yb - hh, ww, hh, '#e8d8b8'); R(x - ww / 2 - S * .3, yb - hh - S * 1.1, ww + S * .6, S * 1.1, '#b8553a'); R(x - ww * .1, yb - hh * .6, ww * .2, hh * .6, '#6b4a2b'); R(x + ww * .22, yb - hh * .75, ww * .2, hh * .25, '#7ab0d8'); }
  else if (t === 'cow') { const ww = 2.4 * S, hh = 1.3 * S, sw = Math.sin(V.time * 0.8 + o.k) * S * .05; R(x - ww / 2, yb - hh, ww, hh * .7, '#f4f1ff'); R(x - ww * .2, yb - hh, ww * .3, hh * .35, '#2a2a3a'); R(x + ww * .1 + sw, yb - hh * 1.1, ww * .28, hh * .5, '#f4f1ff'); R(x + ww * .3 + sw, yb - hh * .75, ww * .1, hh * .2, '#e8a0a0'); for (const lx of [-.4, -.2, .2, .4]) R(x + ww * lx, yb - hh * .32, Math.max(1, S * .14), hh * .32, '#f4f1ff'); }
  else if (t === 'sheep') { const ww = 1.4 * S, hh = .9 * S; R(x - ww / 2, yb - hh, ww, hh * .75, '#f0ece0'); R(x + ww * .38, yb - hh * .85, ww * .28, hh * .4, '#3a3a44'); R(x - ww * .3, yb - hh * .25, Math.max(1, S * .1), hh * .25, '#3a3a44'); R(x + ww * .2, yb - hh * .25, Math.max(1, S * .1), hh * .25, '#3a3a44'); }
  else if (t === 'goat') { const ww = 1.2 * S, hh = 1 * S; R(x - ww / 2, yb - hh * .8, ww, hh * .5, '#d8d0c0'); R(x + ww * .3, yb - hh, ww * .3, hh * .4, '#d8d0c0'); R(x + ww * .45, yb - hh * 1.15, Math.max(1, S * .06), hh * .25, '#6b4a2b'); R(x - ww * .35, yb - hh * .3, Math.max(1, S * .1), hh * .3, '#d8d0c0'); R(x + ww * .25, yb - hh * .3, Math.max(1, S * .1), hh * .3, '#d8d0c0'); }
  else if (t === 'bush') { R(x - .9 * S, yb - .7 * S, 1.8 * S, .7 * S, '#2f7a30'); R(x - .6 * S + sw, yb - 1.0 * S, 1.2 * S, .5 * S, '#3e9a3c'); }
  else if (t === 'flower') { for (let i = 0; i < 5; i++) { const fx = x + (i - 2) * .45 * S, fh = (.35 + hsh(o.k + i) * .3) * S; R(fx, yb - fh, Math.max(1, S * .05), fh, '#2f7a30'); R(fx - S * .08 + sw * .5, yb - fh - S * .12, S * .2, S * .16, ['#ff5a5f', '#ffd24a', '#f4f1ff', '#c06aff', '#ff9ad0'][(o.k + i) % 5]); } }
  else if (t === 'fence') { for (let i = 0; i < 5; i++) R(x + (i - 2) * 1.1 * S, yb - .9 * S, Math.max(1, S * .12), .9 * S, '#8a6a42'); R(x - 2.4 * S, yb - .75 * S, 4.8 * S, Math.max(1, S * .08), '#a8884e'); R(x - 2.4 * S, yb - .4 * S, 4.8 * S, Math.max(1, S * .08), '#a8884e'); }
  else if (t === 'banner') { R(x, yb - 3.2 * S, Math.max(1, S * .08), 3.2 * S, '#555'); R(x - .2 * S, yb - 3.0 * S + sw, 1.4 * S, 1.8 * S, ['#ff5a5f', '#4bc4ff', '#ffcc33'][o.k % 3]); }
  else if (t === 'rock') { R(x - 1.2 * S, yb - .9 * S, 2.4 * S, .9 * S, '#7a7a88'); R(x - .8 * S, yb - 1.4 * S, 1.6 * S, .6 * S, '#8c8c9a'); }
  else if (t === 'hay') { R(x - .9 * S, yb - 1.2 * S, 1.8 * S, 1.2 * S, '#d8b84a'); R(x - .9 * S, yb - .7 * S, 1.8 * S, Math.max(1, S * .08), '#a8882a'); }
  else if (t === 'vine') { for (let i = 0; i < 4; i++) R(x - 2 * S + i * 1.1 * S, yb - .9 * S, .5 * S, .9 * S, i % 2 ? '#4f7a2a' : '#5d8a32'); }
}
function drawHazard(h, p, x, yb, rw) {
  const S = 36 * p * ZM;
  if (h.type === 'pothole') { const w = .55 * S + rw * .06; R(x - w, yb - .17 * S, w * 2, .17 * S, '#15131c'); R(x - w * .8, yb - .27 * S, w * 1.6, .1 * S, '#1c1a26'); R(x - w * 1.05, yb - .12 * S, w * .25, .12 * S, 'rgba(0,0,0,.35)'); }
  else {
    const w = h.w * rw;
    R(x - w, yb - .9 * S, w * 2, .22 * S, '#f4f1ff'); for (let i = 0; i < 8; i++) if (i % 2) R(x - w + i * w / 4, yb - .9 * S, w / 4, .22 * S, '#e8433a');
    R(x - w, yb - .68 * S, Math.max(1, S * .1), .68 * S, '#555'); R(x + w - S * .1, yb - .68 * S, Math.max(1, S * .1), .68 * S, '#555');
    for (let i = 0; i < 4; i++) { const cx = x - w * .8 + i * w * .53; R(cx - S * .22, yb - .1 * S, S * .44, .1 * S, '#222'); R(cx - S * .16, yb - .5 * S, S * .32, .4 * S, '#ff7a1a'); R(cx - S * .12, yb - .35 * S, S * .24, .1 * S, '#f4f1ff'); R(cx - S * .08, yb - .62 * S, S * .16, .14 * S, '#ff7a1a'); }
    const lamp = Math.floor(V.time * 2) % 2 ? '#ffd24a' : '#7a5a10'; R(x - w - S * .2, yb - 1.2 * S, S * .3, S * .3, lamp);
  }
}
function drawSign(p, x, yb) { const S = 36 * p * ZM; R(x, yb - 2.2 * S, Math.max(1, S * .08), 2.2 * S, '#666'); R(x - .5 * S, yb - 2.8 * S, 1.1 * S, .8 * S, '#ffd24a'); R(x - .3 * S, yb - 2.65 * S, .7 * S, .5 * S, '#222'); }
function drawCar(p, x, yb, o, front, dir) {
  const S = 36 * p * ZM, col = o.col, w = 1.8 * S, bh = .7 * S;
  R(x - w / 2 - S * .1, yb - .3 * S, w + S * .2, .3 * S, 'rgba(0,0,0,.3)');                       // ombra
  R(x - w / 2, yb - bh - .25 * S, w, bh, col);                                                      // scocca
  R(x - w * .38, yb - bh - .75 * S, w * .76, .55 * S, col);                                         // abitacolo
  R(x - w * .32, yb - bh - .7 * S, w * .64, .45 * S, front ? '#9fd4ff' : '#27324a');               // vetro
  R(x - w / 2, yb - .22 * S, .28 * S, .22 * S, '#111'); R(x + w / 2 - .28 * S, yb - .22 * S, .28 * S, .22 * S, '#111');
  const lc = front ? '#fff6b0' : '#ff3030';
  R(x - w / 2 + S * .05, yb - bh - .12 * S, .3 * S, .18 * S, lc); R(x + w / 2 - .35 * S, yb - bh - .12 * S, .3 * S, .18 * S, lc);
  if (o.honkUntil > V.time) { c.font = (6 + Math.min(6, p * 5)) + 'px "Press Start 2P", monospace'; c.fillStyle = '#ffd24a'; c.textAlign = 'center'; c.fillText('BEEP!', x + Math.sin(V.time * 40) * 1, yb - bh - 1.1 * S); c.textAlign = 'left'; }
}
function drawCarSide(p, x, yb, col, dirRight) {
  const S = 36 * p * ZM, w = 4 * S;
  R(x - w / 2, yb - .3 * S, w, .3 * S, 'rgba(0,0,0,.25)');
  R(x - w / 2, yb - .95 * S, w, .65 * S, col); R(x - w * .3, yb - 1.45 * S, w * .5, .55 * S, col); R(x - w * .27, yb - 1.4 * S, w * .44, .42 * S, '#9fd4ff');
  R(x - w * .38, yb - .3 * S, .5 * S, .3 * S, '#111'); R(x + w * .22, yb - .3 * S, .5 * S, .3 * S, '#111');
  R(x + (dirRight ? w / 2 - .2 * S : -w / 2), yb - .8 * S, .2 * S, .2 * S, '#fff6b0');
}
function drawCyclistNpc(p, x, yb, o, front) {
  const S = 36 * p * ZM, ph = V.time * 7 + o.k, lg = Math.sin(ph) * .12 * S;
  R(x - .3 * S, yb - .1 * S, .6 * S, .1 * S, 'rgba(0,0,0,.3)');
  R(x - .04 * S, yb - .85 * S, .08 * S, .85 * S, '#15131f');                                       // ruota
  R(x - .18 * S, yb - .75 * S + lg, .14 * S, .6 * S, '#1a1a28'); R(x + .04 * S, yb - .75 * S - lg, .14 * S, .6 * S, '#1a1a28');
  const bk = BIKES[o.k % BIKES.length]; R(x - .06 * S, yb - 1.1 * S, .12 * S, .5 * S, bk.frame); R(x - .08 * S, yb - .85 * S, .16 * S, Math.max(1, S * .06), bk.accent);
  R(x - .25 * S, yb - 1.45 * S, .5 * S, .75 * S, o.sh); R(x - .16 * S, yb - 1.75 * S, .32 * S, .3 * S, '#f0b890'); R(x - .18 * S, yb - 1.82 * S, .36 * S, .16 * S, o.col);
  if (front) R(x - .04 * S, yb - 1.0 * S, .1 * S, .1 * S, '#fff6b0'); else R(x - .04 * S, yb - 1.0 * S, .1 * S, .1 * S, (Math.floor(V.time * 3) % 2) ? '#ff3030' : '#601010');
}
function drawPed(p, x, yb, o) {
  const S = 36 * p * ZM, ph = V.time * 6 + o.k, lg = Math.sin(ph) * .14 * S, ar = Math.sin(ph + 1.6) * .1 * S;
  R(x - .3 * S, yb - .06 * S, .6 * S, .08 * S, 'rgba(0,0,0,.3)');
  R(x - .16 * S, yb - .8 * S + Math.max(0, lg), .12 * S, .8 * S - Math.max(0, lg), '#2a3050'); R(x + .04 * S, yb - .8 * S + Math.max(0, -lg), .12 * S, .8 * S - Math.max(0, -lg), '#2a3050');
  R(x - .22 * S, yb - 1.4 * S, .44 * S, .62 * S, o.sh); R(x - .3 * S, yb - 1.35 * S + ar, .09 * S, .5 * S, o.sh); R(x + .21 * S, yb - 1.35 * S - ar, .09 * S, .5 * S, o.sh);
  R(x - .13 * S, yb - 1.65 * S, .26 * S, .26 * S, '#f0b890'); R(x - .14 * S, yb - 1.68 * S, .28 * S, .12 * S, hsh(o.k) < .5 ? '#3a2a1a' : '#c8a860');
  if (o.dog) { const dx = x + o.side * .9 * S; R(dx - .35 * S, yb - .5 * S, .7 * S, .3 * S, '#8a5a2a'); R(dx + o.vel / Math.abs(o.vel) * .3 * S, yb - .6 * S, .25 * S, .22 * S, '#8a5a2a'); R(dx - .3 * S, yb - .22 * S + Math.max(0, lg * .5), .08 * S, .22 * S, '#6a4018'); R(dx + .2 * S, yb - .22 * S, .08 * S, .22 * S, '#6a4018'); }
}
function drawTractor(p, x, yb) {
  const S = 36 * p * ZM;
  R(x - 1.2 * S, yb - 1.3 * S, 2.4 * S, 1.1 * S, '#c8301e'); R(x - .6 * S, yb - 2.2 * S, 1.2 * S, .95 * S, '#8ab4c8'); R(x - 1.5 * S, yb - 1.0 * S, .8 * S, 1.0 * S, '#1a1a22'); R(x + .7 * S, yb - 1.0 * S, .8 * S, 1.0 * S, '#1a1a22');
  R(x - .1 * S, yb - 2.5 * S, .2 * S, .4 * S, '#444');
}

/* ---------- entità: posizione, ordinamento, disegno ---------- */
const lane = (p, cx, rw, l) => cx + l * rw;
function collect(cxAt, rh, H) {
  const list = [];
  const pOf = dz => 10 / dz - 0.03;
  const push = (dz, fn) => list.push({ dz, fn });
  for (const o of statics) {
    const dz = (((o.z - V.dist) % TRACK) + TRACK) % TRACK; if (dz < 6 || dz > 230) continue;
    const p = pOf(dz); if (p <= 0.01 || p >= 1.7) continue;
    let type = o.type; if (V.theme !== 'auto') type = remap(o, V.theme); else if (ROUTE) type = remap(o, ROUTE.env(V.dist + dz));
    push(dz, () => { const yb = H + p * (180 - H), w = (3 + p * 26) * ZM, x = cxAt(p) + o.side * (rh(p) + 1 + p * 8 + 8 + o.off * p * ZM + w * .6); if (x < -60 || x > 380) return; drawObj({ ...o, type }, p, x, yb, null); });
  }
  for (const m of movers) {
    if (!V.traffic) break;
    let zabs = m.z0 + m.vel * V.time; zabs = ((zabs % TRACK) + TRACK) % TRACK;
    const dz = (((zabs - V.dist) % TRACK) + TRACK) % TRACK;
    if (m.type === 'car' && !m.front) {
      if (dz > 120) { m.passed = false; }
      if (dz < 32 && dz > 8 && !(m.hk > V.time - 40) && hsh(m.k * 7 + Math.floor(V.time / 40)) < 0.55) { m.hk = V.time; m.honkUntil = V.time + 1.3; V.events.push({ type: 'honk', pan: -0.3, variant: m.k }); }
      if (dz < 9 && !m.passed) { m.passed = true; V.events.push({ type: 'pass', pan: -0.3 }); }
    } else if (m.type === 'car' && m.front && dz < 40 && dz > 12 && !(m.hk > V.time - 90) && hsh(m.k * 5 + Math.floor(V.time / 90)) < 0.2) { m.hk = V.time; m.honkUntil = V.time + 1.2; V.events.push({ type: 'honk', pan: -0.5, variant: m.k + 1 }); }
    if (dz < 5 || dz > 230) continue;
    const p = pOf(dz); if (p <= 0.01 || p >= 2) continue;
    const th = V.theme === 'auto' ? (ROUTE ? ROUTE.env(V.dist + dz) : envAt(zabs)) : V.theme;
    if (m.type === 'tractor' && th !== 'country') continue;
    if (m.type === 'ped' && th === 'mountains' && m.k % 3) continue;
    push(dz, () => {
      const yb = H + p * (180 - H), cx = cxAt(p), rwid = rh(p);
      if (m.type === 'ped') { const x = cx + m.side * (rwid + 1 + p * 8 + (th === 'city' ? 4 : 10) + m.off * p * ZM); if (x > -40 && x < 360) drawPed(p, x, yb, m); }
      else if (m.type === 'car') drawCar(p, lane(p, cx, rwid, moverLane(m, dz)), yb, m, m.front);
      else if (m.type === 'bike') drawCyclistNpc(p, lane(p, cx, rwid, moverLane(m, dz)), yb, m, m.front);
      else if (m.type === 'tractor') drawTractor(p, lane(p, cx, rwid, moverLane(m, dz)), yb);
    });
  }
  for (const h of hazards) {
    if (!V.hazards) break;
    const dz = (((h.z - V.dist) % TRACK) + TRACK) % TRACK; if (dz < 3 || dz > 200) continue;
    const p = pOf(dz); if (p <= 0.01) continue;
    push(dz, () => { const yb = H + p * (180 - H), rwid = rh(p); drawHazard(h, p, lane(p, cxAt(p), rwid, h.lane), yb, rwid); });
    if (h.type === 'works') { const d2 = dz + 40; if (d2 < 200) { const p2 = pOf(d2); push(d2, () => { const yb = H + p2 * (180 - H); drawSign(p2, cxAt(p2) + (rh(p2) + 6 + p2 * 10), yb); }); } }
  }
  for (const x of crossers) {
    const dz = (((x.zc - V.dist) % TRACK) + TRACK) % TRACK; if (dz < 8 || dz > 200) continue;
    const th = V.theme === 'auto' ? (ROUTE ? ROUTE.env(V.dist + dz) : envAt(x.zc)) : V.theme; if (th === 'mountains') continue;
    const p = pOf(dz); if (p <= 0.01) continue;
    const u = crosserU(x);
    push(dz - 0.5, () => { const yb = H + p * (180 - H), px = cxAt(p) + u * rh(p) * 1.2; if (px > -80 && px < 400) drawCarSide(p, px, yb, '#' + (hex(x.col).map(v => v.toString(16).padStart(2, '0')).join('')), x.vx > 0); });
  }
  return list;
}
/** logica del mondo: ostacoli, salto, sterzo automatico. dt in secondi reali. */
/* Regole del traffico.
   ALLENAMENTO (V.auto = true): il ciclista ha sempre la precedenza e sta a destra. Nessuno lo urta mai: le auto che lo superano gli
   passano larghe, quelle agli incroci aspettano sul bordo finché non è passato, buche e lavori li evita da solo.
   GIOCO (V.auto = false, tastiera): tutto vale. Auto, ciclisti, trattori, auto agli incroci, buche e lavori possono colpirlo. */
const HALF_W = { car: 0.3, bike: 0.12, tractor: 0.36 };      // mezza larghezza dei veicoli, in unità di corsia (la strada va da -1 a +1)
const wrapD = d => ((d + TRACK / 2) % TRACK + TRACK) % TRACK - TRACK / 2;
/** distanza (m) di un mezzo dal ciclista: positiva = davanti */
export function moverRel(m) { return wrapD(m.z0 + m.vel * V.time - V.dist); }
/** corsia reale di un mezzo: in allenamento si sposta per passare largo al ciclista */
export function moverLane(m, rel) {
  const hw = HALF_W[m.type]; if (!V.auto || !hw) return m.lane;
  const R = V.lat * 0.7, gap = hw + 0.13, d = m.lane - R, k = 1 - Math.abs(rel) / 30;
  if (k <= 0 || Math.abs(d) >= gap) return m.lane;
  return m.lane + (R + (d >= 0 ? gap : -gap) - m.lane) * Math.min(1, k * 2);
}
/** posizione laterale (−3…+3) di un'auto che attraversa; in allenamento le auto in attesa restano ferme sul bordo */
export function crosserU(x) { return ((((V.time - x.hold) * x.vx + x.ph) % 6) + 6) % 6 - 3; }
export function updateWorld(dt) {
  if (V.jumpT >= 0) { V.jumpT += dt; const d = 0.75, k = V.jumpT / d; if (k >= 1) { V.jumpT = -1; V.jump = 0; V.events.push({ type: 'land' }); } else V.jump = 4 * 20 * k * (1 - k); }
  if (V.hitT > 0) V.hitT -= dt;
  if (V.inv > 0) V.inv -= dt;
  const R = V.lat * 0.7, hit = what => { if (V.inv > 0) return; V.events.push({ type: 'hit', what }); V.hitT = 0.5; V.shake = 0.4; V.inv = 1.2; };
  let steerT = 0, steering = false;
  for (const h of hazards) {
    if (!V.hazards) { h.prev = 999; continue; }
    const dz = (((h.z - V.dist) % TRACK) + TRACK) % TRACK, sd = dz > TRACK / 2 ? dz - TRACK : dz;
    if (V.auto) {                                  // allenamento: li evita da solo, senza mai toccarli
      if (V.running && sd < 26 && sd > -2) {
        const lo = h.lane - h.w / 2 - 0.13, hi = h.lane + h.w / 2 + 0.13;
        if (h.type === 'works' && R > lo && R < hi) { steering = true; const t = (R - lo < hi - R || hi > 0.8) ? lo : hi; steerT = t / 0.7; }
        if (h.type === 'pothole' && Math.abs(R - h.lane) < h.w / 2 + 0.1 && sd < Math.max(5, V.speed * 0.4 + 1) && V.jumpT < 0 && sd > 0.5) jump();
      }
      h.prev = dz; continue;
    }
    const overlap = Math.abs(R - h.lane) < h.w / 2 + 0.1;
    if (h.prev > 2.2 && dz <= 2.2 && h.prev - dz < 30) {
      const rises = V.jump > 8;
      if (overlap && !(h.type === 'pothole' && rises)) hit(h.type);
      else if (overlap && h.type === 'pothole' && rises) V.events.push({ type: 'jump' });
    }
    h.prev = dz;
  }
  if (V.traffic) {
    for (const x of crossers) {                    // auto agli incroci
      const rel = wrapD(x.zc - V.dist); if (rel < -3 || rel > 110) continue;
      const u = crosserU(x);
      if (V.auto) {
        const onRoad = Math.abs(u * 1.2) < 1.1;
        if (!onRoad && u * x.vx < 0) x.hold += dt;                    // sta per entrare: aspetta sul bordo finché il ciclista non è passato
        else if (onRoad && rel < 70) x.hold -= dt * 1.4;              // già in mezzo alla strada: si sbriga a liberarla
      } else if (V.running && Math.abs(rel) < 1.6 && Math.abs(u * 1.2 - R) < 0.33) hit('car');
    }
    if (!V.auto && V.running) for (const m of movers) {            // gioco: auto, ciclisti e trattori sulla strada
      const hw = HALF_W[m.type]; if (!hw) continue;
      if (Math.abs(moverRel(m)) < 1.8 && Math.abs(m.lane - R) < hw + 0.07) hit(m.type === 'car' ? 'car' : m.type === 'bike' ? 'bike' : 'tractor');
    }
  }
  if (V.auto) V.latT = steering ? clamp(steerT, -1.1, 1.1) : V.rest;
  V.lat += (V.latT - V.lat) * Math.min(1, dt * 3);
  V.lat = clamp(V.lat, -1.15, 1.15);
  if (V.shake > 0) V.shake -= dt;
}
export function jump() { if (V.jumpT < 0) { V.jumpT = 0; V.events.push({ type: 'hop' }); } }
export function drainEvents() { const e = V.events; V.events = []; return e; }
function remap(o, th) {
  const r = hsh(o.k * 7 + 5);
  if (th === 'country') return r < .6 ? 'tree' : r < .75 ? 'house' : r < .9 ? 'cow' : 'sheep';
  if (th === 'hills') return r < .6 ? 'cyp' : r < .75 ? 'house' : r < .9 ? 'vine' : 'sheep';
  if (th === 'mountains') return r < .65 ? 'pine' : r < .85 ? 'rock' : 'goat';
  return r < .75 ? 'bld' : 'lamp';
}

/* ---------- sfondo lontano ---------- */
function drawFar(th, H) {
  const fx = -V.curve * .8;
  if (th.obj === 'bld') {
    for (let x = -14; x < 334; x += 14) { const k = Math.floor((x - fx) / 14), h = 10 + hsh(k) * 30; R(x, H - h, 14, h, k % 2 ? th.far : th.far2);
      for (let a = 0; a < 2; a++) for (let b = 0; b < Math.floor(h / 6); b++) if (hsh(k * 13 + a * 5 + b) > .55) R(x + 3 + a * 6, H - h + 3 + b * 6, 2, 2, '#ffd96a'); }
  } else {
    for (let x = 0; x < 320; x += 2) { const u = x - fx;
      const h = 14 + 10 * Math.sin(u * .03) + 6 * Math.sin(u * .07 + 1.3) + (th.obj === 'pine' ? 10 * Math.max(0, Math.sin(u * .015 + .5)) : 0);
      R(x, H - h, 2, h, th.far2);
      const u2 = x - fx * 1.4, h2 = 8 + 7 * Math.sin(u2 * .05 + 2) + 4 * Math.sin(u2 * .11);
      R(x, H - h2, 2, h2, th.far);
      if (th.obj === 'pine' && h > 26) R(x, H - h, 2, 3, '#f4f8ff'); }
  }
}

/* ---------- scena ---------- */
let R3 = null;
/** renderer 3D opzionale (js/world3d.js): se attivo, disegna lui la scena al posto di questo motore 2D */
export function setRenderer3D(r) { R3 = r; }
export function drawScene() {
  if (R3 && R3.active()) { try { R3.draw(); return; } catch (e) { R3.fail(e); } }
  const dt = clamp(V.time - lastTime, 0, 0.2); lastTime = V.time; stepFlocks(dt);
  c.setTransform(SCALE, 0, 0, SCALE, 0, 0); c.imageSmoothingEnabled = true; c.imageSmoothingQuality = 'high';
  ZM = V.cam === 'first' ? 1.45 : 1;
  const k = V.shake > 0 ? V.shake * 7 : 0;
  c.translate((Math.random() - .5) * k, (Math.random() - .5) * k);
  const th = palette(), H = Math.round(V.Hc) + (V.cam === 'first' ? -8 : 0);
  const bands = 14; for (let i = 0; i < bands; i++) R(-4, Math.floor(i * H / bands) - 2, 328, Math.ceil(H / bands) + 3, mixc(th.sky0, th.sky1, i / (bands - 1)));
  for (let y = -10; y <= 10; y++) { const w = Math.round(Math.sqrt(100 - y * y)); R(250 - w, 28 + y, w * 2, 1, th.sun); }
  for (let q = 0; q < 5; q++) { const x = ((hsh(q + 50) * 400 - V.dist * .03 - V.time * 1.5 * (1 + q * .1)) % 400 + 400) % 400 - 40, y = 8 + hsh(q + 60) * 34; R(x, y, 26, 5, th.cloud); R(x + 5, y - 3, 14, 4, th.cloud); R(x + 14, y - 5, 8, 3, th.cloud); }
  if (V.env === 'mountains') { const px = ((V.time * 4) % 440) - 60, py = 26 + Math.sin(V.time * .5) * 5; R(px - 7, py, 14, 2, '#ff5a5f'); R(px - 1, py + 2, 2, 5, '#222'); R(px - 1, py + 7, 2, 3, '#f4f1ff'); }
  drawBirds(H, th); drawFar(th, H);

  const rh = p => (4 + p * 105) * ZM, cxAt = p => 160 + V.curve * (1 - p) * (1 - p) - V.lat * 0.7 * rh(p);
  for (let y = H; y < 182; y++) {
    const p = (y - H) / (180 - H); if (p <= 0) continue;
    const ph = 1 / (p + .03), st = Math.floor(ph * 1.5 + V.dist * .25) & 1;
    R(-4, y, 328, 1.2, st ? th.g1 : th.g2);
    const cx = cxAt(p), w = rh(p), rw = (1 + p * 8) * ZM;
    R(cx - w - rw, y, rw, 1.2, st ? th.edge1 : th.edge2); R(cx + w, y, rw, 1.2, st ? th.edge1 : th.edge2);
    R(cx - w, y, w * 2, 1.2, st ? th.road1 : th.road2);
    if (st) R(cx - (1 + p * 2) * ZM, y, (1 + p * 4) * ZM, 1.2, '#f1e9b0');
    const zabs = V.dist + 10 / (p + .03), rr = (((zabs - 360) % XING) + XING) % XING, d = rr < XING / 2 ? rr : rr - XING;
    if (V.theme === 'auto' ? envOf(zabs) !== 'mountains' : V.theme !== 'mountains') {
      if (Math.abs(d) < 5) { R(-4, y, 328, 1.2, st ? th.road1 : th.road2); if (Math.abs(d) < .35) R(-4, y, 328, 1.2, '#c8c8d0'); }
      else if (Math.abs(d) < 8 && Math.abs(d) > 5.6) { for (let i = 0; i < 9; i += 2) R(cx - w + i * (w * 2 / 9), y, w * 2 / 9, 1.2, '#f4f4f4'); }
    }
  }
  const list = collect(cxAt, rh, H);
  list.push({ dz: 9.6, fn: V.cam === 'third' ? drawRider : () => {} });
  list.sort((a, b) => b.dz - a.dz);
  for (const e of list) e.fn();
  if (V.cam === 'first') drawCockpit();
  c.setTransform(SCALE, 0, 0, SCALE, 0, 0);
  const g = c.createRadialGradient(160, 90, 60, 160, 90, 220); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(10,8,28,.28)'); c.fillStyle = g; c.fillRect(0, 0, 320, 180);
  if (V.hitT > 0) { c.fillStyle = 'rgba(255,60,60,' + (V.hitT * .35) + ')'; c.fillRect(0, 0, 320, 180); }
  if (V.reduced) { c.fillStyle = 'rgba(255,77,109,.12)'; c.fillRect(0, 0, 320, 180); }
  if (V.env === 'city' || V.theme === 'city') { c.fillStyle = 'rgba(40,10,70,.08)'; c.fillRect(0, 0, 320, 180); }
}

/* ---------- gesti ---------- */
const GEST = { wave: { dur: 2.2, say: 'CIAO!' }, drink: { dur: 2.6, say: null }, shake: { dur: 1.6, say: 'UFF!' }, stretch: { dur: 2.2, say: 'AAH' }, thumbs: { dur: 1.8, say: 'TOP!' }, cheer: { dur: 2.0, say: 'WOOO!' }, bell: { dur: 1.2, say: 'DRIN' }, shout: { dur: 1.6, say: 'FORZA!' } };
export function gesture(name) { if (!V.gesture && GEST[name]) V.gesture = { name, t: 0, dur: GEST[name].dur, say: GEST[name].say }; }
let nextG = 25;
export function updateGestures(dt, ctx) {
  if (!V.gestures) { V.gesture = null; return; }
  const g = V.gesture;
  if (g) { g.t += dt; if (g.t >= g.dur) V.gesture = null; return; }
  if (!V.running) return;
  nextG -= dt;
  if (nextG <= 0) {
    nextG = 28 + Math.random() * 30;
    const calm = !ctx.hard;
    const pool = calm ? ['drink', 'wave', 'stretch', 'thumbs', 'bell', 'shake'] : ['shout', 'shake'];
    gesture(pool[Math.floor(Math.random() * pool.length)]);
  }
}

/* ---------- emblemi, scritte e motivi della maglia ---------- */
export const EMBLEMS = {
  bolt: ['....##.', '...##..', '..##...', '.#####.', '...##..', '..##...', '.##....'],
  star: ['...#...', '...#...', '#######', '.#####.', '..###..', '.##.##.', '.#...#.'],
  heart: ['.##.##.', '#######', '#######', '#######', '.#####.', '..###..', '...#...'],
  mountain: ['.......', '...#...', '..###..', '.#####.', '.#.###.', '#######', '#######'],
  flame: ['...#...', '..##...', '..###..', '.#####.', '.#####.', '.#####.', '..###..'],
  wheel: ['..###..', '.#.#.#.', '#..#..#', '#######', '#..#..#', '.#.#.#.', '..###..'],
  sun: ['#..#..#', '.#####.', '..###..', '#######', '..###..', '.#####.', '#..#..#'],
  crown: ['#.#.#.#', '#######', '#######', '.#####.', '.......', '.......', '.......']
};
export const PATTERNS = { zip: 'Cerniera', solid: 'Tinta unita', hstripes: 'Righe orizzontali', vstripes: 'Righe verticali', diag: 'Diagonale', chevron: 'Chevron', blocks: 'Blocchi' };
const FONT35 = { A: [7, 5, 7, 5, 5], B: [6, 5, 6, 5, 6], C: [7, 4, 4, 4, 7], D: [6, 5, 5, 5, 6], E: [7, 4, 6, 4, 7], F: [7, 4, 6, 4, 4], G: [7, 4, 5, 5, 7], H: [5, 5, 7, 5, 5], I: [7, 2, 2, 2, 7], J: [1, 1, 1, 5, 7], K: [5, 5, 6, 5, 5], L: [4, 4, 4, 4, 7], M: [5, 7, 7, 5, 5], N: [7, 5, 5, 5, 5], O: [7, 5, 5, 5, 7], P: [7, 5, 7, 4, 4], Q: [7, 5, 5, 7, 1], R: [7, 5, 6, 5, 5], S: [7, 4, 7, 1, 7], T: [7, 2, 2, 2, 2], U: [5, 5, 5, 5, 7], V: [5, 5, 5, 5, 2], W: [5, 5, 7, 7, 5], X: [5, 5, 2, 5, 5], Y: [5, 5, 2, 2, 2], Z: [7, 1, 2, 4, 7], 0: [7, 5, 5, 5, 7], 1: [2, 6, 2, 2, 7], 2: [7, 1, 7, 4, 7], 3: [7, 1, 7, 1, 7], 4: [5, 5, 7, 1, 1], 5: [7, 4, 7, 1, 7], 6: [7, 4, 7, 5, 7], 7: [7, 1, 1, 2, 2], 8: [7, 5, 7, 5, 7], 9: [7, 5, 7, 1, 7], '-': [0, 0, 7, 0, 0], '.': [0, 0, 0, 0, 2] };
const shade = (hex, k) => { const c = new THREE_Color(hex); return '#' + [c.r, c.g, c.b].map(v => Math.round(clamp(v * k, 0, 255)).toString(16).padStart(2, '0')).join(''); };
function THREE_Color(hex) { const h = String(hex).replace('#', ''); const n = parseInt(h.length === 3 ? h.split('').map(x => x + x).join('') : h, 16) || 0; this.r = (n >> 16) & 255; this.g = (n >> 8) & 255; this.b = n & 255; }
const imgCache = {};
function kitImage(dataUrl) {            // immagine propria 10x10 → matrice di colori (cache)
  if (typeof dataUrl !== 'string' || !/^data:image\/png;base64,[A-Za-z0-9+\/=]{1,8000}$/.test(dataUrl)) return null; if (imgCache[dataUrl]) return imgCache[dataUrl].px || null;
  const im = new Image(); imgCache[dataUrl] = { px: null };
  im.onload = () => { const t = document.createElement('canvas'); t.width = t.height = 10; const g = t.getContext('2d'); g.drawImage(im, 0, 0, 10, 10); const d = g.getImageData(0, 0, 10, 10).data, px = []; for (let i = 0; i < 100; i++) px.push(d[i * 4 + 3] > 80 ? `rgb(${d[i * 4]},${d[i * 4 + 1]},${d[i * 4 + 2]})` : null); imgCache[dataUrl].px = px; };
  im.src = dataUrl; return null;
}
function paintPattern(r, cx, sw, top, h, pat, c2) {
  const x0 = cx - 6 + sw;
  switch (pat) {
    case 'solid': break;
    case 'hstripes': for (let y = 2; y < h; y += 5) r(x0, top + y, 12, 2, c2); break;
    case 'vstripes': r(x0 + 2, top, 2, h, c2); r(x0 + 8, top, 2, h, c2); break;
    case 'diag': for (let i = 0; i < 12; i++) r(x0 + i, top + 3 + i, 2, 2, c2); break;
    case 'chevron': for (let i = 0; i < 6; i++) { r(x0 + i, top + 3 + i, 2, 2, c2); r(x0 + 11 - i, top + 3 + i, 2, 2, c2); } break;
    case 'blocks': r(x0, top, 12, 6, c2); break;
    default: r(cx - 1 + sw, top, 2, h, c2);
  }
}
function paintEmblem(r, cx, sw, top, K) {
  const px = kitImage(K.img);
  if (px) { for (let i = 0; i < 100; i++) if (px[i]) r(cx - 5 + sw + (i % 10), top + 2 + Math.floor(i / 10), 1, 1, px[i]); return; }
  const em = Object.prototype.hasOwnProperty.call(EMBLEMS, K.emblem) ? EMBLEMS[K.emblem] : null, txt = String(K.text || '').toUpperCase().slice(0, 3);
  if (em) em.forEach((row, y) => { for (let xx = 0; xx < 7; xx++) if (row[xx] === '#') r(cx - 3 + sw + xx, top + 2 + y, 1, 1, K.emblemColor); });
  if (txt) { const w = txt.length * 4 - 1, ox = cx - Math.floor(w / 2) + sw, oy = top + (em ? 11 : 6); [...txt].forEach((ch, i) => { const g = FONT35[ch]; if (g) g.forEach((bits, y) => { for (let xx = 0; xx < 3; xx++) if (bits & (4 >> xx)) r(ox + i * 4 + xx, oy + y, 1, 1, K.emblemColor); }); }); }
}

/* ---------- ciclista (da dietro, con inclinazione a righe) ---------- */
function paintRider() {
  const g = V.gesture, gt = g ? g.t : 0, gp = g ? Math.sin(Math.min(1, gt / .35) * Math.PI / 2) * (gt > g.dur - .35 ? clamp((g.dur - gt) / .35, 0, 1) : 1) : 0;
  const air = V.jump > 1;
  const run = V.running, sl = V.slope, stand = run && (sl > 4.5 || (g && g.name === 'stretch')), tuck = sl < -2.5;
  const sw = stand ? Math.sin(V.phase) * 2 : 0, bob = run ? Math.round(Math.sin(V.phase * 2) * (stand ? 1.5 : 1)) : 0;
  const o = run && !air ? Math.round(Math.sin(V.phase) * 3) : 0, lift = stand ? 5 : tuck ? -4 : 0;
  const bk = curBike();
  const x = rctx; x.clearRect(0, 0, 56, 72);
  const r = (px, py, w, h, col) => { x.fillStyle = col; x.fillRect(Math.round(px), Math.round(py), Math.max(1, Math.round(w)), Math.max(1, Math.round(h))); };
  const K = V.kit, cx = 28, b = 70, jersey = K.jersey, dark = shade(K.jersey, 0.78);
  // ruota posteriore + telaio + sella
  const rimW = bk.deep >= 2 ? 8 : bk.deep ? 6 : 4; r(cx - rimW / 2, b - 17, rimW, 17, '#15131f'); r(cx - rimW / 2, b - 17, 1, 17, bk.accent); r(cx - 1, b - 17, 1, 17, '#4a4a60');
  for (let i = 0; i < 4; i++) if ((Math.floor(V.phase * 3) + i) % 2) r(cx, b - 16 + i * 4, 1, 1, '#9a9ab0');
  r(cx - 1, b - 30, 2, 14, bk.frame); r(cx - 4, b - 17, 1, 8, bk.frame); r(cx + 3, b - 17, 1, 8, bk.frame); r(cx - 3, b - 18, 6, 1, bk.accent); r(cx - 4, b - 30 + bob - lift * .3, 8, 2, '#111');
  r(cx - 1, b - 22, 2, 2, (Math.floor(V.time * 3) % 2) ? '#ff3030' : '#701010');   // fanalino
  // gambe
  const ty = b - 31 + bob - lift;
  r(cx - 6 + sw * .3, ty + o, 4, 13, K.shorts); r(cx + 2 + sw * .3, ty - o, 4, 13, K.shorts);
  r(cx - 6 + sw * .3, ty + 12 + o, 4, 3, '#ddd'); r(cx + 2 + sw * .3, ty + 12 - o, 4, 3, '#ddd');
  r(cx - 6, ty + o + 2, 1, 8, shade(K.shorts, 1.35));
  // busto
  const ly = tuck ? 4 : 0, torsoTop = b - 48 + bob - lift + ly;
  r(cx - 6 + sw, torsoTop, 12, 19 - ly, jersey); r(cx + 2 + sw, torsoTop, 4, 19 - ly, dark); paintPattern(r, cx, sw, torsoTop, 19 - ly, K.pattern, K.jersey2);
  r(cx - 5 + sw, torsoTop + 12 - ly, 10, 2, dark);                         // tasche
  r(cx - 6 + sw, torsoTop + 18 - ly, 12, 2, shade(K.shorts, 0.8));          // pantaloncini
  paintEmblem(r, cx, sw, torsoTop, K);
  // braccia
  const armL = () => { r(cx - 9 + sw, torsoTop + 3, 3, 12, jersey); r(cx - 9 + sw, torsoTop + 12, 3, 3, '#1a1a1a'); };
  const armR = () => { r(cx + 6 + sw, torsoTop + 3, 3, 12, jersey); r(cx + 6 + sw, torsoTop + 12, 3, 3, '#1a1a1a'); };
  r(cx - 9 + sw, torsoTop + 13 - lift * .0, 18, 2, '#222');                // manubrio
  const gn = g && g.name;
  if (gn === 'wave' || gn === 'cheer' || gn === 'thumbs' || gn === 'stretch') {
    const up = gn === 'stretch' ? .8 : 1, wv = Math.round(Math.sin(gt * 14) * 2 * (gn === 'wave' || gn === 'cheer' ? 1 : 0));
    if (gn !== 'thumbs') armL(); else armL();
    r(cx + 6 + sw, torsoTop - 9 * up * gp + 3, 3, 12 + 9 * up * gp, jersey); r(cx + 5 + sw + wv, torsoTop - 12 * up * gp + 2, 4, 3, '#f0b890');
    if (gn === 'thumbs') r(cx + 8 + sw, torsoTop - 14 * gp, 1, 2, '#f0b890');
    if (gn === 'cheer' || gn === 'stretch') { r(cx - 9 + sw, torsoTop - 9 * up * gp + 3, 3, 12 + 9 * up * gp, jersey); r(cx - 9 + sw - wv, torsoTop - 12 * up * gp + 2, 4, 3, '#f0b890'); }
  } else if (gn === 'drink') {
    armL(); r(cx + 6 + sw - 2 * gp, torsoTop + 3 - 8 * gp, 3, 12, jersey); r(cx + 3 + sw, torsoTop - 8 * gp - 1, 3, 6, '#4bc4ff'); r(cx + 3 + sw, torsoTop - 9 * gp - 2, 3, 2, '#ddd');
  } else if (gn === 'bell') { armL(); armR(); r(cx + 5 + sw, torsoTop + 9, 2, 2, '#ffd070'); }
  else { armL(); armR(); }
  // testa e casco (si gira con gesti)
  const hx = gn === 'shake' ? Math.round(Math.sin(gt * 18) * 2) : gn === 'wave' ? Math.round(gp * 2) : 0;
  r(cx - 3 + hx + sw, torsoTop - 7 + (tuck ? 2 : 0), 6, 6, K.skin); r(cx - 4 + hx + sw, torsoTop - 10 + (tuck ? 2 : 0), 8, 5, K.helmet); r(cx - 4 + hx + sw, torsoTop - 8 + (tuck ? 2 : 0), 8, 1, K.jersey2);
  if (gn === 'drink') r(cx - 3 + hx + sw, torsoTop - 3, 6, 1, '#3a2a1a');
}
/** anteprima del ciclista in impostazioni (canvas qualsiasi): posa ferma, vista da dietro */
export function previewRider(canvas) {
  const sv = { running: V.running, jump: V.jump, slope: V.slope, gesture: V.gesture, phase: V.phase, time: V.time };
  V.running = false; V.jump = 0; V.slope = 0; V.gesture = null; V.phase = 0.5; V.time = 0;
  if (!rctx) { rc = document.createElement('canvas'); rc.width = 56; rc.height = 72; rctx = rc.getContext('2d'); }
  paintRider(); Object.assign(V, sv);
  const g = canvas.getContext('2d'); g.imageSmoothingEnabled = false; g.clearRect(0, 0, canvas.width, canvas.height); g.drawImage(rc, 0, 0, 56, 72, 0, 0, canvas.width, canvas.height);
}
function drawRider() {
  const g = V.gesture, gt = g ? g.t : 0, air = V.jump > 1;
  paintRider();
  // blit con inclinazione (taglio a righe → pixel nitidi)
  const base = 176, left = 160 - 28, k = V.lean * 0.34;
  c.imageSmoothingEnabled = true;
  R(160 - 14 + (air ? 0 : 0), base - 1, 28 - V.jump * .15, 3, 'rgba(0,0,0,.2)');
  for (let row = 0; row < 72; row++) { const hgt = 70 - row; c.drawImage(rc, 0, row, 56, 1, left + k * hgt - V.lean * 1.5, base - 70 + row - V.jump, 56, 1.06); }
  // fumetto
  if (g && g.say && gt > .2 && gt < g.dur - .2) bubble(g.say, 160 + k * 50, base - 92 - V.jump);
  else if (V.hitT > 0) bubble('AHI!', 160, base - 92);
}
function bubble(text, x, y) {
  c.font = '8px "Press Start 2P", monospace'; const w = Math.ceil(c.measureText(text).width) + 8;
  R(x - w / 2, y - 6, w, 14, '#f4f1ff'); R(x - w / 2 - 1, y - 5, w + 2, 12, '#f4f1ff'); R(x - 2, y + 8, 4, 3, '#f4f1ff'); R(x - 1, y + 11, 2, 2, '#f4f1ff');
  c.fillStyle = '#14102c'; c.textBaseline = 'middle'; c.textAlign = 'center'; c.fillText(text, x, y + 1); c.textAlign = 'left';
}

/* ---------- prima persona ---------- */
function drawCockpit() {
  const g = V.gesture, gn = g && g.name, gt = g ? g.t : 0;
  const bob = V.running ? Math.sin(V.phase * 2) * 1.2 : 0, sway = V.running ? Math.sin(V.phase) * 2 : 0;
  const tilt = V.lean * 8;
  // ruota anteriore e manubrio (a righe, inclinati)
  const by = 138 + bob - V.jump * 0.6;
  for (let row = 0; row < 20; row++) { const off = Math.round((row - 10) * V.lean * .3); R(120 + off + tilt * .2, by + row, 80, 1, row < 3 ? '#3a3a50' : '#22222e'); }
  const bk = curBike();
  R(150 + sway * .3, by + 10, 20, 16, '#15131f'); R(158 + sway * .3, by - 8, 4, 20, bk.frame); R(156 + sway * .3, by - 8, 8, 3, bk.accent); R(154, by + 4, 12, 2, bk.accent);
  c.font = '5px "Press Start 2P", monospace'; c.fillStyle = bk.accent; c.textAlign = 'center'; c.fillText(bk.name.split(' ')[1].toUpperCase().slice(0, 9), 160, by + 20); c.textAlign = 'left';       // attacco + ruota
  R(140 - sway + tilt * .3, by + 2, 10, 5, '#1a1a1a'); R(170 - sway + tilt * .3, by + 2, 10, 5, '#1a1a1a'); // comandi
  // avambracci e mani
  const jersey = V.kit.jersey;
  R(104 + sway, by + 4, 36, 4, jersey); R(104 + sway, by + 8, 36, 16, jersey); R(138 + sway, by - 1, 10, 9, '#1a1a1a');
  if (gn === 'drink') {
    const gp = Math.sin(clamp(gt / .4, 0, 1) * Math.PI / 2) * (gt > g.dur - .4 ? clamp((g.dur - gt) / .4, 0, 1) : 1);
    R(180, by + 4 - 60 * gp, 36, 4, jersey); R(180, by + 8 - 60 * gp, 36, 20, jersey); R(176, by - 20 - 60 * gp + 10, 8, 18, '#4bc4ff'); R(176, by - 24 - 60 * gp + 10, 8, 4, '#ddd');
  } else if (gn === 'wave' || gn === 'thumbs' || gn === 'cheer') {
    const gp = Math.sin(clamp(gt / .4, 0, 1) * Math.PI / 2) * (gt > g.dur - .4 ? clamp((g.dur - gt) / .4, 0, 1) : 1), wv = Math.sin(gt * 14) * 4;
    R(190 + wv, by - 50 * gp + 10, 14, 30, jersey); R(188 + wv, by - 60 * gp + 4, 18, 14, '#f0b890');
  } else { R(172 - sway, by + 4, 36, 4, jersey); R(172 - sway, by + 8, 36, 16, jersey); R(172 - sway, by - 1, 10, 9, '#1a1a1a'); }
  if (g && g.say && gt > .2 && gt < g.dur - .2) bubble(g.say, 160, 96);
}

/* ---------- profilo / mappa ---------- */
function mapPt(u) { return [80 + 56 * Math.cos(u * 6.2832) + 13 * Math.cos(u * 18.85), 40 + 28 * Math.sin(u * 6.2832) + 8 * Math.sin(u * 12.57)]; }
let mc = null;
const rect = (g, x, y, w, h, col) => { g.fillStyle = col; g.fillRect(Math.round(x), Math.round(y), Math.max(1, Math.round(w)), Math.max(1, Math.round(h))); };
/** altimetria (sempre visibile) e mappa 2D (sempre visibile), una accanto all'altra */
let mapCache = null, mapKey = '';
export function drawSide() {
  const prog = clamp(V.prog, 0, 1);
  if (!mc) mc = $('map').getContext('2d');
  const W = 240; rect(sc, 0, 0, W, 80, '#0d0a22');
  let pRoute = 0;
  if (ROUTE) pRoute = ((V.dist % ROUTE.len) + ROUTE.len) % ROUTE.len / ROUTE.len;
  if (ROUTE && ROUTE.hasEle) {
    // profilo del percorso reale: colore per pendenza, la parte già percorsa è piena
    let mn = 1e9, mx = -1e9; for (const e of ROUTE.ele) { mn = Math.min(mn, e); mx = Math.max(mx, e); } const span = Math.max(30, mx - mn);
    for (let x = 0; x < W; x++) {
      const d = x / W * ROUTE.len, e = ROUTE.eleAt(d), g = ROUTE.gradeAt(d), y = 62 - (e - mn) / span * 46;
      const col = g > 6 ? '#ff4d6d' : g > 3 ? '#ff9a3a' : g > 1 ? '#ffd24a' : g < -3 ? '#4bc4ff' : '#4be37a';
      sc.globalAlpha = x / W <= pRoute ? 1 : .5; rect(sc, x, y, 1, 66 - y, col); sc.globalAlpha = 1;
    }
    rect(sc, pRoute * W - 1, 0, 2, 70, '#fff');
    for (let x = 0; x < W; x++) { const t = Math.floor(x / W * TOTAL), s = steps.find(q => t >= q.start && t < q.start + q.dEst) || steps[steps.length - 1]; if (s) { sc.globalAlpha = x / W <= prog ? 1 : .45; rect(sc, x, 71, 1, 7, typeCol[s.t]); sc.globalAlpha = 1; } }
    sc.fillStyle = 'rgba(244,241,255,.85)'; sc.font = '7px "Press Start 2P", monospace'; sc.fillText(Math.round(mx) + ' m', 2, 9); sc.fillText(Math.round(mn) + ' m', 2, 69);
  } else {
    for (let x = 0; x < W; x++) {
      const t = Math.floor(x / W * TOTAL), s = steps.find(q => t >= q.start && t < q.start + q.dEst) || steps[steps.length - 1];
      if (!s) continue;
      const e = (el[t] - elMin) / (elMax - elMin || 1), y = 60 - e * 44, past = x / W <= prog;
      sc.globalAlpha = past ? 1 : .45; rect(sc, x, y, 1, 64 - y, typeCol[s.t]); sc.globalAlpha = 1; rect(sc, x, 68, 1, 8, typeCol[s.t]);
    }
    rect(sc, prog * W - 1, 0, 2, 80, '#fff');
  }
  // mappa 2D
  rect(mc, 0, 0, 160, 80, '#0d0a22');
  if (ROUTE) {
    if (mapKey !== ROUTE.id + ROUTE.len) { mapCache = ROUTE.mapPts(160, 80, 10); mapKey = ROUTE.id + ROUTE.len; }
    const { proj, pts } = mapCache;
    mc.lineJoin = 'round'; mc.lineCap = 'round'; mc.strokeStyle = '#3d3590'; mc.lineWidth = 2.2; mc.beginPath(); pts.forEach((q, i) => i ? mc.lineTo(q[0], q[1]) : mc.moveTo(q[0], q[1])); mc.stroke();
    mc.strokeStyle = '#ffcc33'; mc.beginPath(); const upto = Math.floor(pRoute * (pts.length - 1)); for (let i = 0; i <= upto; i++) i ? mc.lineTo(pts[i][0], pts[i][1]) : mc.moveTo(pts[i][0], pts[i][1]); mc.stroke();
    mc.font = '5px "Press Start 2P", monospace'; const placed = [];
    for (const p of ROUTE.places) {
      const ll = ROUTE.posAt(p.d), q = proj(ll); mc.fillStyle = p.c ? '#f4f1ff' : '#9a93c9'; mc.fillRect(Math.round(q[0]) - 1, Math.round(q[1]) - 1, 3, 3);
      if (p.c && !placed.some(o => Math.abs(o[0] - q[0]) < 36 && Math.abs(o[1] - q[1]) < 7)) { placed.push(q); const tx = q[0] > 100 ? q[0] - mc.measureText(p.n).width - 3 : q[0] + 4; mc.fillStyle = 'rgba(13,10,34,.8)'; mc.fillRect(tx - 1, q[1] - 7, mc.measureText(p.n).width + 2, 7); mc.fillStyle = '#d8d2ff'; mc.fillText(p.n, tx, q[1] - 1); }
    }
    const here = proj(ROUTE.posAt(V.dist)); rect(mc, here[0] - 3, here[1] - 3, 7, 7, '#fff'); rect(mc, here[0] - 2, here[1] - 2, 5, 5, '#ff5a5f');
  } else {
    mc.strokeStyle = '#3d3590'; mc.lineWidth = 3; mc.beginPath();
    for (let i = 0; i <= 120; i++) { const [x, y] = mapPt(i / 120); i ? mc.lineTo(x, y) : mc.moveTo(x, y); } mc.closePath(); mc.stroke();
    mc.strokeStyle = '#ffcc33'; mc.beginPath();
    for (let i = 0; i <= Math.floor(prog * 120); i++) { const [x, y] = mapPt(i / 120); i ? mc.lineTo(x, y) : mc.moveTo(x, y); } mc.stroke();
    const [mx, my] = mapPt(prog); rect(mc, mx - 3, my - 3, 7, 7, '#fff'); rect(mc, mx - 2, my - 2, 5, 5, '#ff5a5f');
    const [sx, sy] = mapPt(0); rect(mc, sx - 2, sy - 6, 2, 6, '#4be37a');
  }
}
export { gradeOf };

/* ---------- esportazioni per il renderer 3D ---------- */
export { hazards, movers, crossers, TRACK, XING, envAt };
/** il pezzo di rete del traffico che non disegna: clacson e sorpassi (stessa logica del motore 2D) */
export function trafficTick() {
  if (!V.traffic) return;
  for (const m of movers) {
    if (m.type !== 'car') continue;
    let zabs = m.z0 + m.vel * V.time; zabs = ((zabs % TRACK) + TRACK) % TRACK;
    const dz = (((zabs - V.dist) % TRACK) + TRACK) % TRACK;
    if (!m.front) {
      if (dz > 120) m.passed = false;
      if (dz < 32 && dz > 8 && !(m.hk > V.time - 40) && hsh(m.k * 7 + Math.floor(V.time / 40)) < 0.55) { m.hk = V.time; m.honkUntil = V.time + 1.3; V.events.push({ type: 'honk', pan: -0.3, variant: m.k }); }
      if (dz < 9 && !m.passed) { m.passed = true; V.events.push({ type: 'pass', pan: -0.3 }); }
    } else if (dz < 40 && dz > 12 && !(m.hk > V.time - 90) && hsh(m.k * 5 + Math.floor(V.time / 90)) < 0.2) { m.hk = V.time; m.honkUntil = V.time + 1.2; V.events.push({ type: 'honk', pan: -0.5, variant: m.k + 1 }); }
  }
}
/** schiena della maglia (12×19 px) con motivo, emblema e scritta, per la texture del ciclista 3D */
export function drawKitBack(cv, K) {
  const g = cv.getContext('2d'); g.clearRect(0, 0, cv.width, cv.height); g.fillStyle = K.jersey; g.fillRect(0, 0, 12, 19);
  const r = (x, y, w, h, col) => { g.fillStyle = col; g.fillRect(Math.round(x), Math.round(y), Math.max(1, Math.round(w)), Math.max(1, Math.round(h))); };
  paintPattern(r, 6, 0, 0, 19, K.pattern, K.jersey2); r(1, 12, 10, 2, shade(K.jersey, 0.78)); paintEmblem(r, 6, 0, 0, K);
}
/** il ciclista pixel (con gesti e divisa) come canvas 56×72: per lo stile HD-2D */
export function riderCanvas() { if (!rctx) return null; paintRider(); return rc; }
