// Percorsi reali: lettura GPX/TCX (anche da Garmin Connect), pendenza, curve, ambiente e mappa 2D.
// Tutto locale: nessun dato lascia il browser.
const R_EARTH = 6371000, rad = x => x * Math.PI / 180;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
function hav(a, b) { const dLat = rad(b[0] - a[0]), dLon = rad(b[1] - a[1]); const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLon / 2) ** 2; return 2 * R_EARTH * Math.asin(Math.sqrt(h)); }
function bearing(a, b) { const y = Math.sin(rad(b[1] - a[1])) * Math.cos(rad(b[0])), x = Math.cos(rad(a[0])) * Math.sin(rad(b[0])) - Math.sin(rad(a[0])) * Math.cos(rad(b[0])) * Math.cos(rad(b[1] - a[1])); return Math.atan2(y, x); }
const wrapPi = a => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
const smooth = (a, w) => a.map((_, i) => { let s = 0, n = 0; for (let k = Math.max(0, i - w); k <= Math.min(a.length - 1, i + w); k++) { s += a[k]; n++; } return s / n; });

/** Estrae punti [lat, lon, quota] da GPX (trkpt/rtept) o TCX (Trackpoint). Restituisce {name, pts}. */
export function parseTrack(text) {
  const pts = [];
  const num = (s, tag) => { const m = s.match(new RegExp('<' + tag + '[^>]*>\\s*([-+0-9.eE]+)\\s*<')); return m ? parseFloat(m[1]) : null; };
  const re = /<(trkpt|rtept)\b([^>]*?)(\/>|>([\s\S]*?)<\/\1>)/g; let m;
  while ((m = re.exec(text))) {
    const lat = (m[2].match(/lat="([-+0-9.eE]+)"/) || [])[1], lon = (m[2].match(/lon="([-+0-9.eE]+)"/) || [])[1];
    if (lat == null || lon == null) continue;
    pts.push([parseFloat(lat), parseFloat(lon), m[4] ? num(m[4], 'ele') : null]);
  }
  if (!pts.length) {
    const tp = /<Trackpoint>([\s\S]*?)<\/Trackpoint>/g;
    while ((m = tp.exec(text))) { const la = num(m[1], 'LatitudeDegrees'), lo = num(m[1], 'LongitudeDegrees'); if (la != null && lo != null) pts.push([la, lo, num(m[1], 'AltitudeMeters')]); }
  }
  const nm = text.match(/<(?:name|Name|Id)>\s*(?:<!\[CDATA\[)?([^<\]]+)/);
  return { name: nm ? nm[1].trim() : '', pts };
}

function resample(pts, step) {
  const out = [pts[0]]; let acc = 0, last = pts[0];
  for (let i = 1; i < pts.length; i++) {
    let a = last; const b = pts[i]; let d = hav(a, b);
    while (d > 0 && acc + d >= step) {
      const t = (step - acc) / d;
      const e = a[2] != null && b[2] != null ? a[2] + (b[2] - a[2]) * t : (b[2] ?? a[2]);
      a = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, e]; out.push(a); d = hav(a, b); acc = 0;
    }
    acc += d; last = b;
  }
  return out;
}

export class Route {
  /** raw: {id?, name, pts:[[lat,lon,ele]], places?:[{n,d,c}], env?:[[d0,d1,'mountains']]} */
  constructor(raw) {
    this.id = raw.id || 'gpx'; this.name = raw.name || 'Percorso'; this.src = raw.src || '';
    const pts = resample(raw.pts.filter(p => Number.isFinite(p[0]) && Number.isFinite(p[1])), this.step = 25);
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
    this.places = (raw.places || []).slice().sort((a, b) => a.d - b.d); this.envSegs = raw.env || [];
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
