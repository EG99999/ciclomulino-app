import test from 'node:test'; import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Path } from '../js/path3d.js';
import { Route } from '../js/route.js';
import { CH, terrainH, decorType, chunkDecor, chunkHazards, chunkCrossings, ROAD_HALF } from '../js/layout3d.js';

const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const iseo = () => new Route(JSON.parse(readFileSync(new URL('../routes/giro-iseo.json', import.meta.url), 'utf8')));

test('percorso generato: continuo, nessun salto, direzione che cambia dolcemente', () => {
  const p = new Path(null); let prev = p.at(0), maxTurn = 0;
  for (let d = 1; d < 3000; d++) { const q = p.at(d); assert.ok(Math.abs(dist(prev, q) - 1) < 0.05, `passo a ${d}: ${dist(prev, q)}`); maxTurn = Math.max(maxTurn, Math.abs(q.yaw - prev.yaw)); prev = q; }
  assert.ok(maxTurn < 0.02, 'curva troppo secca: ' + maxTurn); assert.ok(p.at(-50).z < p.at(0).z, 'si può guardare dietro');
});
test('a destra è a destra: andando verso nord (+z) il lato destro ha x NEGATIVO (est a sinistra nello schermo 3D)', () => {
  const p = new Path(null), f0 = p.at(0), f1 = p.frame(0, 3); // il mondo generato parte verso +z
  assert.ok(Math.abs(f0.yaw) < 0.7); assert.ok(f1.x < f0.x, 'destra = x minore');
});
test('curva a destra su un percorso reale: la direzione (yaw) diminuisce', () => {
  const pts = [[45.5, 9.9, 100]]; for (let i = 1; i <= 40; i++) pts.push([45.5 + i * 0.00023, 9.9, 100]);            // 40 × 25 m verso nord
  for (let i = 1; i <= 40; i++) pts.push([45.5 + 40 * 0.00023, 9.9 + i * 0.00032, 100]);                           // poi verso est (= curva a destra)
  const r = new Route({ id: 't', name: 't', pts }), p = new Path(r), a = p.at(300).yaw, b = p.at(1500).yaw;
  assert.ok(Math.abs(a) < 0.15, 'nord ≈ 0: ' + a); assert.ok(b < -1.2 && b > -1.9, 'est ≈ -π/2: ' + b);
});
test('giro d\'Iseo: percorso chiuso (si richiude), pendenze plausibili, quote del file', () => {
  const r = iseo(), p = new Path(r); assert.ok(r.loop);
  const a = p.at(r.len - 1), b = p.at(r.len + 1); assert.ok(dist(a, b) < 4, 'giunzione tra un giro e l\'altro: ' + dist(a, b));
  let steep = 0; for (let d = 0; d < r.len; d += 25) { assert.ok(Math.abs(p.grade(d)) < 22); if (Math.abs(p.grade(d)) > 12) steep++; } assert.ok(steep < 60, 'tratti oltre il 12%: ' + steep);
  assert.ok(Math.abs(p.at(1000).y - r.eleAt(1000)) < 12, 'quota disegnata vicina a quella del file');
});
test('scenario: deterministico, fuori dalla strada, tipi in base all\'ambiente', () => {
  const p = new Path(null), opts = env => ({ envOf: () => env, path: p, amp: 9, quant: 1.5, lim: 40 });
  const a = chunkDecor(3, opts('country')), b = chunkDecor(3, opts('country')); assert.deepEqual(a, b); assert.ok(a.length > 12 && a.length < 60, 'n. elementi ' + a.length);
  for (const it of a) assert.ok(Math.abs(it.lat) >= 7 && Math.abs(it.lat) <= 40);
  const m = chunkDecor(5, opts('mountains')).map(i => i.type); assert.ok(m.includes('pine')); assert.ok(!m.includes('house') && !m.includes('bld'));
  const c = chunkDecor(5, opts('city')).map(i => i.type); assert.ok(c.every(t => ['bld', 'lamp', 'banner'].includes(t)));
  assert.equal(decorType('country', 0.1), 'tree'); assert.equal(terrainH(100, 0, 9, 1.5), 0); assert.ok(Math.abs(terrainH(100, 40, 9)) > 0);
});
test('ostacoli e incroci: ogni ostacolo cade nel pezzo giusto, ripetuto a ogni giro', () => {
  const hz = [{ z: 200, lane: 0.2, w: 0.22, type: 'pothole', k: 1 }, { z: 3500, lane: -0.4, w: 0.85, type: 'works', k: 2 }], T = 3600;
  assert.deepEqual(chunkHazards(Math.floor(200 / CH), hz, T).map(h => h.d), [200]); assert.deepEqual(chunkHazards(Math.floor((200 + T) / CH), hz, T).map(h => h.d), [200 + T]);
  assert.equal(chunkHazards(0, hz, T).length, 0); assert.deepEqual(chunkCrossings(3, 720).concat(chunkCrossings(0, 720)), [360]); assert.equal(ROAD_HALF, 3.8);
});
