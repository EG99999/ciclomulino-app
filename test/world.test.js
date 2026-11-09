import test from 'node:test'; import assert from 'node:assert/strict';
import * as G from '../js/scene.js';

function drive(seconds, speed, { auto = true, jumpAt = null } = {}) {
  const V = G.V; Object.assign(V, { dist: 0, lat: 0, latT: 0, jump: 0, jumpT: -1, hitT: 0, shake: 0, running: true, auto, events: [] });
  const ev = []; const dt = 1 / 60;
  for (let t = 0; t < seconds; t += dt) { V.dist += speed * dt; G.updateWorld(dt); ev.push(...G.drainEvents()); }
  return ev;
}
const count = (ev, type) => ev.filter(e => e.type === type).length;

test('modalità automatica: nessuna caduta su 3 giri di strada (≈ 8 m/s e 14 m/s)', () => {
  for (const sp of [5, 8, 14]) { const ev = drive(3600 * 1.5 / sp, sp); assert.equal(count(ev, 'hit'), 0, 'colpi a ' + sp + ' m/s'); assert.ok(count(ev, 'hop') > 3, 'salti a ' + sp); }
});
test('modalità tastiera: se non fai nulla colpisci buche e lavori', () => {
  const ev = drive(400, 8, { auto: false }); assert.ok(count(ev, 'hit') >= 3, 'colpi: ' + count(ev, 'hit'));
});
