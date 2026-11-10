// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Gatti Elia
// Percorsi reali: lettura GPX/TCX (anche da Garmin Connect), pendenza, curve, ambiente e mappa 2D.
// Tutto locale: nessun dato lascia il browser.
const R_EARTH = 6371000, rad = x => x * Math.PI / 180;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
function hav(a, b) { const dLat = rad(b[0] - a[0]), dLon = rad(b[1] - a[1]); const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLon / 2) ** 2; return 2 * R_EARTH * Math.asin(Math.sqrt(h)); }
function bearing(a, b) { const y = Math.sin(rad(b[1] - a[1])) * Math.cos(rad(b[0])), x = Math.cos(rad(a[0])) * Math.sin(rad(b[0])) - Math.sin(rad(a[0])) * Math.cos(rad(b[0])) * Math.cos(rad(b[1] - a[1])); return Math.atan2(y, x); }
const wrapPi = a => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
const smooth = (a, w) => a.map((_, i) => { let s = 0, n = 0; for (let k = Math.max(0, i - w); k <= Math.min(a.length - 1, i + w); k++) { s += a[k]; n++; } return s / n; });

const ENV_KINDS = ['country', 'hills', 'mountains', 'city'];
const MAX_PTS = 200000, MAX_M = 2000000;     // limiti: 200 mila punti, 2000 km (un file malevolo non deve riempire la memoria)
const numCache = {};
// il corpo dell'elemento si legge fino al prossimo «<» ([^<>]): tempo lineare anche con un file fatto apposta (prima 160 KB di «<ele<ele…» costavano 6 s, 1 MB quasi 4 minuti)
const numIn = (s, tag) => { const re = numCache[tag] || (numCache[tag] = new RegExp('<' + tag + '(?:\\s[^<>]*)?>\\s*([-+0-9.eE]+)\\s*<')); const m = s.match(re); if (!m) return null; const v = parseFloat(m[1]); return Number.isFinite(v) ? v : null; };
const eleOk = v => (v != null && Math.abs(v) <= 10000 ? v : null);      // quote assurde (1e999, 99999 m) si ignorano: renderebbero NaN pendenze e dislivello
const attrIn = (a, k) => { const m = a.match(new RegExp('\\b' + k + '=["\']([-+0-9.eE]+)["\']')); return m ? m[1] : null; };
/** scorre gli elementi <nome …>…</nome> in UN solo passaggio (niente regex annidate: tempo lineare) */
function eachElement(text, names, fn) {
  const re = new RegExp('<(' + names.join('|') + ')\\b', 'g'), noClose = {}; let m;
  while ((m = re.exec(text))) {
    const name = m[1], gt = text.indexOf('>', re.lastIndex); if (gt < 0) break;
    const self = text[gt - 1] === '/', attrs = text.slice(re.lastIndex, self ? gt - 1 : gt); let body = null;
    if (!self && !noClose[name]) { const end = text.indexOf('</' + name + '>', gt); if (end < 0) noClose[name] = true; else { body = text.slice(gt + 1, end); re.lastIndex = end; } }
    if (fn(attrs, body) === false) break;
  }
}
/** Estrae punti [lat, lon, quota] da GPX (trkpt/rtept) o TCX (Trackpoint). Restituisce {name, pts}. */
export function parseTrack(text) {
  text = String(text); const pts = [];
  eachElement(text, ['trkpt', 'rtept'], (attrs, body) => {
    const lat = attrIn(attrs, 'lat'), lon = attrIn(attrs, 'lon'); if (lat == null || lon == null) return;
    const la = parseFloat(lat), lo = parseFloat(lon); if (!(Math.abs(la) <= 90 && Math.abs(lo) <= 180)) return;
    pts.push([la, lo, body ? eleOk(numIn(body, 'ele')) : null]); if (pts.length >= MAX_PTS) return false;
  });
  if (!pts.length) {
    eachElement(text, ['Trackpoint'], (attrs, body) => {
      if (!body) return; const la = numIn(body, 'LatitudeDegrees'), lo = numIn(body, 'LongitudeDegrees');
      if (la != null && lo != null && Math.abs(la) <= 90 && Math.abs(lo) <= 180) { pts.push([la, lo, eleOk(numIn(body, 'AltitudeMeters'))]); if (pts.length >= MAX_PTS) return false; }
    });
  }
  const nm = text.match(/<(?:name|Name|Id)>\s*(?:<!\[CDATA\[)?([^<\]]+)/);
  return { name: nm ? nm[1].trim().slice(0, 80) : '', pts };
}

// differenza di longitudine sul cammino più breve (179.999 → -179.999 sono 0,002°, non 360°): senza, tre punti all'antimeridiano generavano milioni di punti
const lonDiff = (a, b) => ((((b - a + 540) % 360) + 360) % 360) - 180, wrapLon = x => ((((x + 540) % 360) + 360) % 360) - 180;
function resample(pts, step) {
  const out = [pts[0]]; let acc = 0, last = pts[0];
  for (let i = 1; i < pts.length; i++) {
    let a = last; const b = pts[i]; let d = hav(a, b);
    while (d > 0 && acc + d >= step) {
      const t = (step - acc) / d;
      const e = a[2] != null && b[2] != null ? a[2] + (b[2] - a[2]) * t : (b[2] ?? a[2]);
      a = [a[0] + (b[0] - a[0]) * t, wrapLon(a[1] + lonDiff(a[1], b[1]) * t), e]; out.push(a); d = hav(a, b); acc = 0;
      if (out.length > MAX_M / step + 10) throw new Error('Percorso troppo lungo (max ' + MAX_M / 1000 + ' km)');
    }
    acc += d; last = b;
  }
  return out;
}

export class Route {
  /** raw: {id?, name, pts:[[lat,lon,ele]], places?:[{n,d,c}], env?:[[d0,d1,'mountains']]} */
  constructor(raw) {
    // tutto ciò che arriva da file, OneDrive o localStorage è non fidato: si ricostruiscono gli oggetti invece di tenere quelli ricevuti
    const ctl = /[\x00-\x1f\x7f<>]/g, txt = (v, n, d) => (typeof v === 'string' && v.trim() ? v.replace(ctl, '').slice(0, n) : d);
    this.id = typeof raw.id === 'string' && /^[\w.-]{1,60}$/.test(raw.id) ? raw.id : 'gpx'; this.name = txt(raw.name, 80, 'Percorso'); this.src = txt(raw.src, 120, '');
    const valid = (Array.isArray(raw.pts) ? raw.pts : []).filter(p => Array.isArray(p) && Math.abs(p[0]) <= 90 && Math.abs(p[1]) <= 180);
    if (valid.length > MAX_PTS) throw new Error('Troppi punti (max ' + MAX_PTS + ')');
    let tot = 0; for (let i = 1; i < valid.length; i++) tot += hav(valid[i - 1], valid[i]);
    if (tot > MAX_M) throw new Error('Percorso troppo lungo (max ' + MAX_M / 1000 + ' km)');
    const pts = resample(valid, this.step = 25);
    if (pts.length < 8) throw new Error('Percorso troppo corto o senza punti');
    this.pts = pts; const n = pts.length;
    this.dist = new Float64Array(n); for (let i = 1; i < n; i++) this.dist[i] = this.dist[i - 1] + hav(pts[i - 1], pts[i]);
    this.len = this.dist[n - 1];
    const eleRaw = pts.map(p => p[2] ?? 0); this.hasEle = pts.some(p => p[2] != null);
    this.ele = smooth(eleRaw, 3);
    const e2 = smooth(this.ele, 4); let gain = 0; for (let i = 1; i < n; i++) if (e2[i] > e2[i - 1]) gain += e2[i] - e2[i - 1]; this.gain = Math.round(gain);
    // pendenza su ±75 m, limitata a ±14%
    const g = []; for (let i = 0; i < n; i++) { const a = Math.max(0, i - 3), b = Math.min(n - 1, i + 3); g.push(this.hasEle && b > a ? clamp((this.ele[b] - this.ele[a]) / (this.dist[b] - this.dist[a]) * 100, -14, 14) : 0); }
    this.grades = smooth(g, 2);
    const h = []; for (let i = 0; i < n; i++) { const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 2); h.push(bearing(pts[a], pts[b])); } this.heads = h;
    this.loop = hav(pts[0], pts[n - 1]) < 300;
    this.places = (Array.isArray(raw.places) ? raw.places : []).filter(p => p && typeof p.n === 'string' && Number.isFinite(p.d) && p.d >= 0 && p.d <= 1e7).slice(0, 300).map(p => ({ n: txt(p.n, 60, '?'), d: p.d, c: p.c ? 1 : 0 })).sort((a, b) => a.d - b.d);
    this.envSegs = (Array.isArray(raw.env) ? raw.env : []).filter(s => Array.isArray(s) && Number.isFinite(s[0]) && Number.isFinite(s[1]) && ENV_KINDS.includes(s[2])).slice(0, 300).map(s => [s[0], s[1], s[2]]);
    // proiezione per la mappa
    let minLat = 90, maxLat = -90, minLon = 180, maxLon = -180; for (const p of pts) { minLat = Math.min(minLat, p[0]); maxLat = Math.max(maxLat, p[0]); minLon = Math.min(minLon, p[1]); maxLon = Math.max(maxLon, p[1]); }
    this.bbox = { minLat, maxLat, minLon, maxLon, k: Math.cos(rad((minLat + maxLat) / 2)) };
  }
  /** indice (frazionario) del punto alla distanza d (il percorso si ripete alla fine) */
  _i(d) { const L = this.len; d = ((d % L) + L) % L; return d / this.step; }
  _lerp(arr, d) { const x = this._i(d), i = Math.min(arr.length - 2, Math.floor(x)), t = x - i; return arr[i] + (arr[i + 1] - arr[i]) * t; }
  gradeAt(d) { return this._lerp(this.grades, d); }
  eleAt(d) { return this._lerp(this.ele, d); }
  headAt(d) { const x = this._i(d), i = Math.min(this.heads.length - 1, Math.round(x)); return this.heads[i]; }
  /** curva davanti: variazione di direzione nei prossimi ~60 m, in pixel di scena (±60) */
  curveAt(d) { return clamp(wrapPi(this.headAt(d + 60) - this.headAt(d)) * 55, -60, 60); }
  posAt(d) { const x = this._i(d), i = Math.min(this.pts.length - 2, Math.floor(x)), t = x - i, a = this.pts[i], b = this.pts[i + 1]; return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]; }
  /** ambiente grafico a questa distanza: città vicino ai paesi grandi, poi in base a quota/zone indicate */
  env(d) {
    const L = this.len, dd = ((d % L) + L) % L;
    for (const s of this.envSegs) if (dd >= s[0] && dd <= s[1]) return s[2];
    for (const p of this.places) if (p.c && Math.abs(p.d - dd) < 600) return 'city';
    const e = this.eleAt(dd);
    return e < 175 ? 'country' : e < 260 ? 'hills' : 'mountains';
  }
  /** paese appena attraversato/avvicinato (entro 120 m), o null */
  placeAt(d) { const L = this.len, dd = ((d % L) + L) % L; for (const p of this.places) if (Math.abs(p.d - dd) < 120) return p; return null; }
  /** punti della mappa 2D adattati a un riquadro w×h (margine m) */
  mapPts(w, h, m = 8) {
    const b = this.bbox, sx = (w - 2 * m) / ((b.maxLon - b.minLon) * b.k || 1), sy = (h - 2 * m) / ((b.maxLat - b.minLat) || 1), s = Math.min(sx, sy);
    const ox = (w - (b.maxLon - b.minLon) * b.k * s) / 2, oy = (h - (b.maxLat - b.minLat) * s) / 2;
    const proj = p => [ox + (p[1] - b.minLon) * b.k * s, h - oy - (p[0] - b.minLat) * s];
    return { proj, pts: this.pts.filter((_, i) => i % 3 === 0 || i === this.pts.length - 1).map(proj) };
  }
  /** versione compatta da salvare (punti ogni 25 m, 5 decimali) */
  toJSON() { return { id: this.id, name: this.name, src: this.src, places: this.places, env: this.envSegs, pts: this.pts.map(p => [+p[0].toFixed(5), +p[1].toFixed(5), +(p[2] ?? 0).toFixed(1)]) }; }
}

/** Da testo GPX/TCX a Route (lancia errore leggibile se il file non ha punti). */
export function routeFromFile(text, fileName = '') {
  const t = parseTrack(text);
  if (t.pts.length < 8) throw new Error('Nel file non ci sono punti GPS leggibili (servono GPX o TCX con la traccia)');
  const base = fileName.replace(/\.[^.]+$/, '') || 'Percorso';
  return new Route({ id: 'gpx-' + base.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 30), name: t.name || base, pts: t.pts, src: 'File GPX/TCX importato' });
}
