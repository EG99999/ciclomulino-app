// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Gatti Elia
// Tracciato del mondo 3D: da un percorso reale (GPX/OpenStreetMap) oppure generato.
// Coordinate: x = -est (così una curva a destra appare a destra con la camera che guarda +z), z = nord, y = quota.
// Distanze in metri lungo la strada. Nessuna dipendenza da Three.js (testabile in Node).
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const STEP = 4;                       // passo del campionamento (m)
const BACK = 120;                     // metri dietro lo zero già disponibili

export class Path {
  /** route: oggetto Route (js/route.js) oppure null per il mondo generato */
  constructor(route = null) {
    this.route = route; this.X = []; this.Z = []; this.Y = []; this.n = 0; this.len = route ? route.len : Infinity;
    if (route) this._fromRoute(); else this._start();
  }
  /* ----- percorso reale ----- */
  _fromRoute() {
    const r = this.route, p0 = r.pts[0], k = Math.cos(p0[0] * Math.PI / 180);
    const wx = p => -(p[1] - p0[1]) * k * 111320, wz = p => (p[0] - p0[0]) * 110574;
    this.rx = r.pts.map(wx); this.rz = r.pts.map(wz);
    // quota più dolce per il disegno: media mobile (~±125 m) e pendenza limitata al 14% (il modello del terreno ha gradini)
    const e = Array.from(r.ele), n0 = e.length, sm = e.map((_, i) => { let t = 0, c = 0; for (let k = Math.max(0, i - 5); k <= Math.min(n0 - 1, i + 5); k++) { t += e[k]; c++; } return t / c; });
    const dx = i => Math.max(1, r.dist[i + 1] - r.dist[i]);
    for (let it = 0; it < 3; it++) { for (let i = 0; i < n0 - 1; i++) { const m = 0.14 * dx(i); sm[i + 1] = Math.min(sm[i] + m, Math.max(sm[i] - m, sm[i + 1])); } for (let i = n0 - 2; i >= 0; i--) { const m = 0.14 * dx(i); sm[i] = Math.min(sm[i + 1] + m, Math.max(sm[i + 1] - m, sm[i])); } }
    this.ry = sm;
    const n = r.pts.length - 1;
    this.lapDx = this.rx[n] - this.rx[0]; this.lapDz = this.rz[n] - this.rz[0]; this.lapDy = this.ry[n] - this.ry[0];
    this.rd = r.dist;
  }
  _routePos(d) {
    const L = this.len, k = Math.floor(d / L), dd = d - k * L, n = this.rx.length - 1, D = this.rd;
    let lo = 0, hi = n; while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (D[mid] <= dd) lo = mid; else hi = mid; }
    const i = clamp(lo, 0, n - 1), t = clamp((dd - D[i]) / Math.max(1e-6, D[i + 1] - D[i]), 0, 1);
    const i0 = Math.max(0, i - 1), i2 = Math.min(n, i + 1), i3 = Math.min(n, i + 2);
    const cr = (A, off) => { const p0 = A[i0], p1 = A[i], p2 = A[i2], p3 = A[i3]; return off + 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t); };
    return [cr(this.rx, k * this.lapDx), cr(this.ry, k * this.lapDy), cr(this.rz, k * this.lapDz)];
  }
  /* ----- mondo generato: direzione che serpeggia dolcemente, colline morbide ----- */
  static heading(d) { return 0.9 * Math.sin(d * 0.0035) + 0.5 * Math.sin(d * 0.0097 + 1); }
  static elevation(d) { return 8 + 7 * Math.sin(d * 0.006) + 3.5 * Math.sin(d * 0.017 + 2); }
  _start() { // punto a d = -BACK, poi si integra in avanti
    this.d0 = -BACK; this.X = [0]; this.Z = [-BACK]; this.Y = [Path.elevation(this.d0)]; this.n = 1;
    this._extend(2000);
  }
  _extend(toD) {
    while (this.d0 + (this.n - 1) * STEP < toD) {
      const d = this.d0 + (this.n - 1) * STEP, h = Path.heading(d + STEP / 2), i = this.n - 1;
      this.X.push(this.X[i] + Math.sin(h) * STEP); this.Z.push(this.Z[i] + Math.cos(h) * STEP); this.Y.push(Path.elevation(d + STEP)); this.n++;
    }
  }
  _genPos(d) {
    this._extend(d + 300);
    const x = (d - this.d0) / STEP, i = clamp(Math.floor(x), 0, this.n - 2), t = x - i;
    return [this.X[i] + (this.X[i + 1] - this.X[i]) * t, this.Y[i] + (this.Y[i + 1] - this.Y[i]) * t, this.Z[i] + (this.Z[i + 1] - this.Z[i]) * t];
  }
  _pos(d) { return this.route ? this._routePos(d) : this._genPos(d); }
  /** posizione sulla linea di mezzeria alla distanza d: {x,y,z,yaw} (yaw: direzione di marcia, atan2(x,z)) */
  at(d) {
    const p = this._pos(d), a = this._pos(d - 2), b = this._pos(d + 2);
    return { x: p[0], y: p[1], z: p[2], yaw: Math.atan2(b[0] - a[0], b[2] - a[2]) };
  }
  /** punto spostato di `lat` metri alla DESTRA di chi va avanti (lat negativa = sinistra) */
  frame(d, lat = 0) {
    const f = this.at(d), fx = Math.sin(f.yaw), fz = Math.cos(f.yaw);
    return { x: f.x - fz * lat, y: f.y, z: f.z + fx * lat, yaw: f.yaw };
  }
  /** pendenza in % */
  grade(d) { const a = this._pos(d - 5), b = this._pos(d + 5), h = Math.hypot(b[0] - a[0], b[2] - a[2]); return h > 0 ? (b[1] - a[1]) / h * 100 : 0; }
}
