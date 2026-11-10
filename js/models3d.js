// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Gatti Elia
// Modelli 3D a blocchi (scatole colorate) e sprite pixel-art per i 4 stili. Richiede THREE (js/vendor/three.min.js).
import { hsh } from './layout3d.js';

/* ---------- geometria unita: tante scatole in una sola mesh ---------- */
export class Merger {
  constructor() { this.p = []; this.n = []; this.c = []; this.i = []; }
  quad(a, b, c2, d, nrm, col) { const o = this.p.length / 3; for (const v of [a, b, c2, d]) { this.p.push(v[0], v[1], v[2]); this.n.push(nrm[0], nrm[1], nrm[2]); this.c.push(col.r, col.g, col.b); } this.i.push(o, o + 1, o + 2, o, o + 2, o + 3); }
  tri(a, b, c2, col) { const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c2[0] - a[0], c2[1] - a[1], c2[2] - a[2]]; let n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]; const l = Math.hypot(...n) || 1; n = n.map(x => x / l); const o = this.p.length / 3; for (const q of [a, b, c2]) { this.p.push(q[0], q[1], q[2]); this.n.push(n[0], n[1], n[2]); this.c.push(col.r, col.g, col.b); } this.i.push(o, o + 1, o + 2); }
  box(w, h, d, color, x, y, z, ry = 0) {
    const col = new THREE.Color(color), cs = Math.cos(ry), sn = Math.sin(ry), hw = w / 2, hd = d / 2;
    const T = (lx, ly, lz) => [x + lx * cs + lz * sn, y + ly, z - lx * sn + lz * cs], N = (nx, nz) => [nx * cs + nz * sn, 0, -nx * sn + nz * cs];
    const sh = k => new THREE.Color(col.r * k, col.g * k, col.b * k);
    this.quad(T(hw, 0, -hd), T(hw, h, -hd), T(hw, h, hd), T(hw, 0, hd), N(1, 0), sh(0.9));
    this.quad(T(-hw, 0, hd), T(-hw, h, hd), T(-hw, h, -hd), T(-hw, 0, -hd), N(-1, 0), sh(0.8));
    this.quad(T(-hw, h, -hd), T(-hw, h, hd), T(hw, h, hd), T(hw, h, -hd), [0, 1, 0], sh(1.08));
    this.quad(T(hw, 0, hd), T(hw, h, hd), T(-hw, h, hd), T(-hw, 0, hd), N(0, 1), sh(0.95));
    this.quad(T(-hw, 0, -hd), T(-hw, h, -hd), T(hw, h, -hd), T(hw, 0, -hd), N(0, -1), sh(0.85));
  }
  pyramid(w, h, d, color, x, y, z, ry = 0) {
    const col = new THREE.Color(color), cs = Math.cos(ry), sn = Math.sin(ry), hw = w / 2, hd = d / 2;
    const T = (lx, ly, lz) => [x + lx * cs + lz * sn, y + ly, z - lx * sn + lz * cs];
    const a = T(-hw, 0, -hd), b = T(hw, 0, -hd), c2 = T(hw, 0, hd), e = T(-hw, 0, hd), t = T(0, h, 0), sh = k => new THREE.Color(col.r * k, col.g * k, col.b * k);
    this.tri(a, t, b, sh(.85)); this.tri(b, t, c2, sh(.95)); this.tri(c2, t, e, sh(1.05)); this.tri(e, t, a, sh(.78));
  }
  /** striscia di terreno/strada: per ogni riga una lista di punti [x,y,z] e un colore per punto */
  strip(rows, colors) {
    const o = this.p.length / 3, w = rows[0].length;
    rows.forEach((row, i) => row.forEach((q, j) => { this.p.push(q[0], q[1], q[2]); this.n.push(0, 1, 0); const c = colors[i][j]; this.c.push(c.r, c.g, c.b); }));
    for (let i = 0; i < rows.length - 1; i++) for (let j = 0; j < w - 1; j++) { const a = o + i * w + j, b = a + 1, c2 = a + w, d = c2 + 1; this.i.push(a, c2, b, b, c2, d); }
  }
  mesh(material) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3)); g.setIndex(this.i);
    if (this.recompute) g.computeVertexNormals();
    return new THREE.Mesh(g, material);
  }
}

/* ---------- elementi di scenario a blocchi ---------- */
export const DECOR = {
  tree: (m, x, y, z) => { m.box(0.7, 2.4, 0.7, 0x6b4a2b, x, y, z); m.box(3.6, 2.6, 3.6, 0x2e8b2e, x, y + 2.2, z); m.box(2.4, 1.8, 2.4, 0x3aa43a, x, y + 4.5, z); },
  cyp: (m, x, y, z) => { m.box(0.6, 1, 0.6, 0x5a4a2a, x, y, z); m.box(1.6, 5.5, 1.6, 0x3d5a2a, x, y + 0.8, z); m.box(0.9, 1.6, 0.9, 0x4d6e34, x, y + 6, z); },
  pine: (m, x, y, z) => { m.box(0.6, 1.2, 0.6, 0x4a3320, x, y, z); m.box(3.6, 1.6, 3.6, 0x1f4d36, x, y + 1.1, z); m.box(2.6, 1.6, 2.6, 0x26603f, x, y + 2.5, z); m.box(1.5, 1.6, 1.5, 0x1f4d36, x, y + 3.9, z); m.box(0.5, 0.5, 0.5, 0xf4f8ff, x, y + 5.3, z); },
  rock: (m, x, y, z) => { m.box(3.2, 1.6, 2.6, 0x7a7a88, x, y, z, 0.4); m.box(2, 1.4, 1.6, 0x8c8c9a, x, y + 1.2, z, 0.2); },
  bush: (m, x, y, z) => { m.box(2.2, 1.2, 2.2, 0x2f7a30, x, y, z); m.box(1.4, 0.9, 1.4, 0x3e9a3c, x, y + 1, z); },
  hay: (m, x, y, z) => { m.box(2.4, 1.6, 2.4, 0xd8b84a, x, y, z); m.box(2.5, 0.2, 2.5, 0xa8882a, x, y + 0.7, z); },
  flower: (m, x, y, z, yaw, k) => { for (let i = 0; i < 5; i++) { m.box(0.1, 0.5 + hsh(k + i) * 0.4, 0.1, 0x2f7a30, x + (i - 2) * 0.55, y, z + hsh(k + i * 3) - 0.5); m.box(0.4, 0.3, 0.4, [0xff5a5f, 0xffd24a, 0xf4f1ff, 0xc06aff, 0xff9ad0][(k + i) % 5], x + (i - 2) * 0.55 - 0.15, y + 0.6 + hsh(k + i) * 0.4, z + hsh(k + i * 3) - 0.5 - 0.15); } },
  fence: (m, x, y, z, yaw) => { for (let i = 0; i < 5; i++) m.box(0.2, 1.1, 0.2, 0x8a6a42, x + (i - 2) * 1.4 * Math.cos(yaw), y, z - (i - 2) * 1.4 * Math.sin(yaw), yaw); m.box(6, 0.12, 0.12, 0xa8884e, x, y + 0.9, z, yaw); m.box(6, 0.12, 0.12, 0xa8884e, x, y + 0.45, z, yaw); },
  vine: (m, x, y, z, yaw) => { for (let i = 0; i < 4; i++) m.box(0.8, 1.2, 6, i % 2 ? 0x4f7a2a : 0x5d8a32, x + (i - 1.5) * 1.8 * Math.cos(yaw), y, z - (i - 1.5) * 1.8 * Math.sin(yaw), yaw); },
  cow: (m, x, y, z, yaw, k) => { const a = yaw + k; const cs = Math.cos(a), sn = Math.sin(a); m.box(2.6, 1.3, 1.1, 0xf4f1ff, x, y + 0.5, z, a); m.box(0.9, 0.9, 0.9, 0x2a2a3a, x + sn * 1.4, y + 1.1, z + cs * 1.4); m.box(1.0, 0.7, 1.12, 0x2a2a3a, x - sn * 0.3, y + 0.8, z - cs * 0.3, a); for (const [u, v] of [[-.9, -.3], [-.9, .3], [.9, -.3], [.9, .3]]) m.box(0.22, 0.6, 0.22, 0xf4f1ff, x + sn * u + cs * v, y, z + cs * u - sn * v); },
  sheep: (m, x, y, z, yaw, k) => { const a = yaw + k * 0.7, sn = Math.sin(a), cs = Math.cos(a); m.box(1.5, 0.9, 1.0, 0xf0ece0, x, y + 0.4, z, a); m.box(0.5, 0.5, 0.5, 0x3a3a44, x + sn * 0.9, y + 0.7, z + cs * 0.9); for (const [u, v] of [[-.5, -.3], [-.5, .3], [.5, -.3], [.5, .3]]) m.box(0.14, 0.4, 0.14, 0x3a3a44, x + sn * u + cs * v, y, z + cs * u - sn * v); },
  goat: (m, x, y, z, yaw, k) => { const a = yaw + k, sn = Math.sin(a), cs = Math.cos(a); m.box(1.3, 0.7, 0.6, 0xd8d0c0, x, y + 0.45, z, a); m.box(0.4, 0.6, 0.4, 0xd8d0c0, x + sn * 0.8, y + 0.85, z + cs * 0.8); m.box(0.08, 0.3, 0.08, 0x6b4a2b, x + sn * 0.8, y + 1.4, z + cs * 0.8); for (const [u, v] of [[-.4, -.2], [-.4, .2], [.4, -.2], [.4, .2]]) m.box(0.1, 0.5, 0.1, 0xd8d0c0, x + sn * u + cs * v, y, z + cs * u - sn * v); },
  house: (m, x, y, z, yaw) => { m.box(6, 3.4, 5, 0xe8d8b8, x, y, z, yaw); m.pyramid(7.4, 2.4, 6.4, 0xb8553a, x, y + 3.4, z, yaw); m.box(1.1, 2, 0.2, 0x6b4a2b, x, y, z - 2.55, yaw); m.box(1.0, 1.0, 0.2, 0x7ab0d8, x + 1.8, y + 1.2, z - 2.55, yaw); },
  bld: (m, x, y, z, yaw, k) => { const h = 6 + hsh(k) * 14, w = 5 + hsh(k + 1) * 4; m.box(w, h, w, k % 2 ? 0x5a5a8a : 0x6a5a98, x, y, z, yaw); for (let r = 0; r < Math.floor(h / 2.4); r++) for (let c = 0; c < 3; c++) if (hsh(k * 9 + r * 3 + c) > .4) m.box(0.9, 1.0, 0.1, 0xffd96a, x + (c - 1) * w * .28 * Math.cos(yaw), y + 1.4 + r * 2.4, z - (c - 1) * w * .28 * Math.sin(yaw) - w / 2 - 0.05, yaw); },
  lamp: (m, x, y, z) => { m.box(0.2, 5, 0.2, 0x555555, x, y, z); m.box(1.2, 0.2, 0.2, 0x555555, x + 0.5, y + 5, z); m.box(0.5, 0.3, 0.5, 0xffe9a0, x + 1, y + 4.85, z); },
  banner: (m, x, y, z, yaw, k) => { m.box(0.15, 5.5, 0.15, 0x555555, x, y, z); m.box(1.4, 2.2, 0.1, [0xff5a5f, 0x4bc4ff, 0xffcc33][k % 3], x, y + 2.8, z, yaw); }
};
export function addHazard(m, h, f) {            // f = {x,y,z,yaw} sulla corsia
  if (h.type === 'pothole') { m.box(1.1, 0.09, 1.5, 0x14121c, f.x, f.y + 0.09, f.z, f.yaw); m.box(1.5, 0.06, 1.9, 0x1d1b28, f.x, f.y + 0.085, f.z, f.yaw + 0.3); return; }
  const sn = Math.sin(f.yaw), cs = Math.cos(f.yaw), halfW = h.w * 3.8, rx = -cs, rz = sn;   // destra = (-cos, sin)
  m.box(0.12, 1.1, 0.12, 0x555555, f.x + rx * halfW, f.y, f.z + rz * halfW, f.yaw); m.box(0.12, 1.1, 0.12, 0x555555, f.x - rx * halfW, f.y, f.z - rz * halfW, f.yaw);
  m.box(halfW * 2, 0.32, 0.12, 0xf4f1ff, f.x, f.y + 0.75, f.z, f.yaw + Math.PI / 2 * 0); for (let i = 0; i < 6; i += 2) m.box(halfW / 3, 0.32, 0.14, 0xe8433a, f.x + rx * (-halfW + halfW / 3 * (i + 0.5) * 1), f.y + 0.75, f.z + rz * (-halfW + halfW / 3 * (i + 0.5) * 1), f.yaw);
  for (let i = 0; i < 4; i++) { const u = -halfW * 0.8 + i * halfW * 0.53; m.box(0.5, 0.06, 0.5, 0x222222, f.x + rx * u, f.y, f.z + rz * u); m.box(0.4, 0.6, 0.4, 0xff7a1a, f.x + rx * u, f.y + 0.06, f.z + rz * u, f.yaw); m.box(0.42, 0.12, 0.42, 0xf4f1ff, f.x + rx * u, f.y + 0.3, f.z + rz * u, f.yaw); }
  m.box(0.3, 0.3, 0.3, 0xffd24a, f.x + rx * (halfW + 0.3), f.y + 1.2, f.z + rz * (halfW + 0.3));
}

/* ---------- attori ---------- */
const matCache = {};
export const pmat = c => { const k = c && c.isColor ? 'c' + c.getHex() : c; return matCache[k] || (matCache[k] = new THREE.MeshLambertMaterial({ color: c })); };
export function part(w, h, d, color, x, y, z, parent) { const g = new THREE.BoxGeometry(w, h, d); g.translate(0, h / 2, 0); const m = new THREE.Mesh(g, typeof color === 'object' && color.isMaterial ? color : pmat(color)); m.position.set(x, y, z); if (parent) parent.add(m); return m; }
export function blob(r, parent) { const m = new THREE.Mesh(new THREE.CircleGeometry(r, 10), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.28, depthWrite: false })); m.rotation.x = -Math.PI / 2; m.position.y = 0.06; parent.add(m); return m; }
export function carMesh(col, front) {
  const g = new THREE.Group();
  part(1.9, 0.75, 4.2, col, 0, 0.3, 0, g); part(1.6, 0.6, 2.1, col, 0, 1.0, -0.2, g); part(1.4, 0.45, 0.1, front ? 0x9fd4ff : 0x27324a, 0, 1.1, front ? 0.9 : -1.3, g);
  for (const sx of [-0.9, 0.9]) for (const sz of [-1.3, 1.3]) part(0.3, 0.6, 0.6, 0x111111, sx, 0, sz, g);
  for (const sx of [-0.6, 0.6]) part(0.35, 0.2, 0.08, front ? 0xfff6b0 : 0xff3030, sx, 0.7, front ? 2.1 : -2.1, g);
  blob(2.4, g); return g;
}
export function pedMesh(shirt, dog) {
  const g = new THREE.Group(), legs = [];
  for (const sx of [-0.1, 0.1]) { const l = new THREE.Group(); l.position.set(sx, 0.85, 0); part(0.16, 0.85, 0.18, 0x2a3050, 0, -0.85, 0, l); g.add(l); legs.push(l); }
  part(0.5, 0.65, 0.28, shirt, 0, 0.85, 0, g); part(0.26, 0.26, 0.26, 0xf0b890, 0, 1.52, 0, g); part(0.28, 0.12, 0.28, hsh(shirt) < .5 ? 0x3a2a1a : 0xc8a860, 0, 1.7, 0, g);
  if (dog) { part(0.3, 0.3, 0.7, 0x8a5a2a, 0.9, 0.2, 0.2, g); part(0.25, 0.25, 0.25, 0x8a5a2a, 0.9, 0.35, 0.65, g); }
  g.userData.legs = legs; blob(0.5, g); return g;
}
export function tractorMesh() { const g = new THREE.Group(); part(2.2, 1.0, 3.2, 0xc8301e, 0, 0.7, 0, g); part(1.6, 1.2, 1.4, 0x8ab4c8, 0, 1.7, -0.5, g); for (const sx of [-1.2, 1.2]) { part(0.5, 1.4, 1.4, 0x1a1a22, sx, 0, -0.9, g); part(0.4, 0.9, 0.9, 0x1a1a22, sx, 0, 1.1, g); } blob(2.6, g); return g; }
/** bici da corsa vista da dietro (colori della bici) con ciclista; ritorna gruppo con userData per animare */
export function bikerMesh(o) {
  const { shirt, jersey2, shorts, helmet, skin, frame, accent, deep = 0, scale = 1, backTex = null } = o;
  const g = new THREE.Group(), legs = [], lean = new THREE.Group(); g.add(lean);
  const rim = deep >= 2 ? 0.34 : deep ? 0.18 : 0.1;
  part(rim, 0.85, 0.85 * 0.18, 0x15131f, 0, 0, -0.78, lean); part(rim, 0.85, 0.85 * 0.18, 0x15131f, 0, 0, 0.78, lean);         // ruote (viste di taglio)
  part(rim * 0.6, 0.86, 0.04, accent, 0, 0, 0.78, lean);
  part(0.08, 0.1, 1.5, frame, 0, 0.62, 0, lean); part(0.08, 0.7, 0.08, frame, 0, 0.1, -0.25, lean); part(0.08, 0.5, 0.08, frame, 0, 0.55, 0.6, lean); part(0.3, 0.07, 0.4, 0x111111, 0, 0.9, -0.3, lean);
  part(0.55, 0.05, 0.06, 0x22222e, 0, 1.1, 0.62, lean);                                                                         // manubrio
  const torso = new THREE.Group(); torso.position.set(0, 0.95, -0.15); lean.add(torso); torso.rotation.x = 0.55;
  const faces = [pmat(shirt), pmat(shirt), pmat(shirt), pmat(shirt), pmat(shirt), backTex ? new THREE.MeshLambertMaterial({ map: backTex }) : pmat(shirt)];
  const tg = new THREE.BoxGeometry(0.5, 0.7, 0.3); tg.translate(0, 0.35, 0); const tm = new THREE.Mesh(tg, faces); torso.add(tm);                // faccia 5 = dietro (-z)
  part(0.52, 0.2, 0.32, shorts, 0, -0.08, 0, torso);
  const head = new THREE.Group(); head.position.set(0, 0.72, 0.05); torso.add(head);
  part(0.22, 0.24, 0.22, skin, 0, 0, 0, head); part(0.3, 0.14, 0.3, helmet, 0, 0.2, 0, head); part(0.31, 0.05, 0.31, jersey2, 0, 0.17, 0, head);
  const mkArm = sx => { const a = new THREE.Group(); a.position.set(sx, 0.62, 0.02); torso.add(a); part(0.13, 0.55, 0.13, shirt, 0, -0.55, 0, a); part(0.14, 0.12, 0.14, 0x1a1a1a, 0, -0.62, 0, a); a.rotation.x = -0.95; return a; };
  const armL = mkArm(-0.3), armR = mkArm(0.3);
  for (const sx of [-0.14, 0.14]) { const l = new THREE.Group(); l.position.set(sx, 0.92, -0.25); part(0.16, 0.5, 0.16, shorts, 0, -0.5, 0, l); part(0.17, 0.12, 0.2, 0xdddddd, 0, -0.55, 0.04, l); lean.add(l); legs.push(l); }
  const bottle = part(0.1, 0.22, 0.1, 0x4bc4ff, 0.3, 0.1, 0.1, g); bottle.visible = false;
  g.userData = { legs, torso, head, armL, armR, lean, bottle }; g.scale.setScalar(scale); blob(1.0, g); return g;
}
/** testo in un fumetto (sprite) */
export function bubbleSprite(text, color = '#f4f1ff', ink = '#14102c') {
  const c = document.createElement('canvas'); c.width = 160; c.height = 48; const g = c.getContext('2d'); g.fillStyle = color; g.fillRect(2, 2, 156, 34); g.fillRect(0, 4, 160, 30); g.fillRect(70, 36, 14, 8);
  g.fillStyle = ink; g.font = '16px "Press Start 2P", monospace'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, 80, 20);
  const t = new THREE.CanvasTexture(c); t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthTest: false })); s.scale.set(2.2, 0.66, 1); s.renderOrder = 10; return s;
}

/* ---------- sprite pixel-art (HD-2D) ---------- */
export function tex(w, h, draw) { const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); g.imageSmoothingEnabled = false; draw((x, y, ww, hh, col) => { g.fillStyle = col; g.fillRect(x, y, ww, hh); }, g); const t = new THREE.CanvasTexture(c); t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; return t; }
export function sprite(t, w, h, y0 = 0) { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, alphaTest: 0.4, fog: true })); s.center.set(0.5, 0); s.scale.set(w, h, 1); s.position.y = y0; return s; }
export function makeSprites() {
  const S = {};
  S.tree = tex(32, 40, R => { R(14, 26, 4, 14, '#6b4a2b'); R(4, 6, 24, 22, '#2e8b2e'); R(8, 0, 16, 10, '#3aa43a'); R(4, 14, 6, 10, '#237023'); R(20, 10, 6, 6, '#58c058'); });
  S.cyp = tex(16, 48, R => { R(6, 40, 4, 8, '#5a4a2a'); R(3, 8, 10, 34, '#3d5a2a'); R(5, 2, 6, 10, '#4d6e34'); R(3, 8, 3, 34, '#2f4720'); });
  S.pine = tex(32, 48, R => { R(14, 38, 4, 10, '#4a3320'); R(2, 26, 28, 14, '#1f4d36'); R(6, 14, 20, 14, '#26603f'); R(10, 4, 12, 12, '#1f4d36'); R(14, 0, 4, 4, '#f4f8ff'); });
  S.house = tex(64, 48, R => { R(6, 18, 52, 30, '#e8d8b8'); R(0, 6, 64, 14, '#b8553a'); R(6, 0, 52, 8, '#c8654a'); R(28, 28, 10, 20, '#6b4a2b'); R(44, 24, 8, 8, '#7ab0d8'); R(12, 24, 8, 8, '#7ab0d8'); });
  S.bld = tex(40, 80, R => { R(0, 4, 40, 76, '#4a3a78'); R(0, 4, 6, 76, '#3b2f66'); for (let y = 10; y < 74; y += 9) for (let x = 8; x < 36; x += 10) R(x, y, 5, 5, (x * y) % 3 ? '#ffd96a' : '#2b2450'); });
  S.lamp = tex(16, 48, R => { R(7, 6, 2, 42, '#555'); R(7, 4, 8, 2, '#555'); R(12, 6, 4, 4, '#ffe9a0'); });
  S.cow = tex(40, 24, R => { R(4, 4, 28, 12, '#f4f1ff'); R(8, 4, 10, 6, '#2a2a3a'); R(30, 2, 8, 10, '#f4f1ff'); R(36, 8, 3, 3, '#e8a0a0'); for (const x of [6, 10, 24, 28]) R(x, 16, 3, 8, '#f4f1ff'); });
  S.sheep = tex(28, 18, R => { R(2, 3, 20, 10, '#f0ece0'); R(20, 4, 6, 6, '#3a3a44'); for (const x of [4, 8, 16, 19]) R(x, 13, 2, 5, '#3a3a44'); });
  S.goat = tex(28, 22, R => { R(3, 6, 18, 8, '#d8d0c0'); R(18, 2, 7, 8, '#d8d0c0'); R(22, 0, 2, 4, '#6b4a2b'); for (const x of [4, 7, 16, 19]) R(x, 14, 2, 8, '#d8d0c0'); });
  S.bush = tex(24, 16, R => { R(0, 6, 24, 10, '#2f7a30'); R(4, 0, 16, 8, '#3e9a3c'); });
  S.rock = tex(32, 20, R => { R(0, 6, 32, 14, '#7a7a88'); R(6, 0, 20, 8, '#8c8c9a'); });
  S.hay = tex(24, 20, R => { R(0, 2, 24, 18, '#d8b84a'); R(0, 10, 24, 2, '#a8882a'); });
  S.flower = tex(24, 16, R => { for (let i = 0; i < 5; i++) { R(2 + i * 5, 6, 1, 10, '#2f7a30'); R(1 + i * 5, 3 + (i % 2) * 2, 3, 3, ['#ff5a5f', '#ffd24a', '#f4f1ff', '#c06aff', '#ff9ad0'][i]); } });
  S.fence = tex(48, 14, R => { for (let i = 0; i < 6; i++) R(2 + i * 8, 0, 2, 14, '#8a6a42'); R(0, 3, 48, 2, '#a8884e'); R(0, 8, 48, 2, '#a8884e'); });
  S.vine = tex(40, 14, R => { for (let i = 0; i < 4; i++) R(i * 10, 2, 8, 12, i % 2 ? '#4f7a2a' : '#5d8a32'); });
  S.banner = tex(16, 44, R => { R(7, 0, 2, 44, '#555'); R(8, 4, 8, 14, '#ff5a5f'); });
  S.ped = c => tex(12, 28, R => { R(2, 14, 3, 14, '#2a3050'); R(7, 14, 3, 14, '#2a3050'); R(1, 6, 10, 10, c); R(3, 0, 6, 6, '#f0b890'); R(3, 0, 6, 2, '#3a2a1a'); });
  S.car = (c, f) => tex(40, 24, R => { R(2, 10, 36, 10, c); R(8, 2, 24, 10, c); R(10, 4, 20, 6, f ? '#9fd4ff' : '#27324a'); R(2, 20, 6, 4, '#111'); R(32, 20, 6, 4, '#111'); R(4, 12, 6, 3, f ? '#fff6b0' : '#ff3030'); R(30, 12, 6, 3, f ? '#fff6b0' : '#ff3030'); });
  S.bikeNpc = (c, fr) => tex(16, 32, R => { R(7, 14, 2, 18, '#15131f'); R(7, 14, 2, 6, fr); R(4, 8, 8, 10, c); R(5, 2, 6, 6, '#f0b890'); R(4, 0, 8, 3, '#f4f1ff'); R(5, 18, 2, 8, '#1a1a28'); R(9, 18, 2, 8, '#1a1a28'); });
  S.tractor = tex(40, 28, R => { R(4, 10, 28, 12, '#c8301e'); R(10, 2, 14, 10, '#8ab4c8'); R(0, 12, 10, 16, '#1a1a22'); R(28, 16, 10, 12, '#1a1a22'); });
  return S;
}
