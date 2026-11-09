import test from 'node:test'; import assert from 'node:assert/strict';
import { Session } from '../js/session.js';
import { plan, runSim } from './helpers.js';

test('seduta completa senza fatica: nessuna riduzione, 2700 record, setpoint al centro del range', () => {
  const { sess, log } = runSim(0);
  assert.ok(sess.done); assert.equal(sess.doneReason, 'completed'); assert.equal(sess.records.length, 2700);
  assert.ok(!log.some(e => e.type === 'reduce'));
  assert.equal(log.filter(e => e.type === 'step').length, 12);
  const mid = sess.records.filter(r => r.step === 2 && r.t > 600 + 30); // primo VO2max, a regime
  const avg = mid.reduce((a, r) => a + r.p, 0) / mid.length; assert.ok(Math.abs(avg - 311.5) < 6, 'potenza ~311.5, trovata ' + avg);
});
test('con fatica simulata scatta riduzione e ripristino', () => {
  const { log } = runSim(0, { fatigue: true });
  assert.ok(log.some(e => e.type === 'reduce')); assert.ok(log.some(e => e.type === 'restore'));
});
test('rampa di 8" al cambio step e carico 50% rispetto al setpoint', () => {
  const s = new Session(plan.sessions[0], 271); s.start();
  const out = []; for (let i = 0; i < 4 * 400; i++) { out.push([s.t, s.update(0.25, { power: 110, cad: 90 })]); }
  const at = t => out.find(x => x[0] >= t)[1];
  assert.ok(at(0) <= 52 && at(1) >= 55 && at(1) <= 60, 'parte dal carico minimo (50 W) e sale: ' + at(1)); assert.ok(at(8.25) >= 109 && at(8.25) <= 110);
  // cambio step a 360 s: da 110 verso 145 in 8"
  assert.ok(Math.abs(at(360.25 + 4) - (110 + 35 / 2)) <= 3, 'a metà rampa: ' + at(364.25)); assert.equal(at(369), 145);
});
test('trainer che si scollega → pausa automatica, carico minimo, ripresa manuale', () => {
  const s = new Session(plan.sessions[0], 271); s.start();
  for (let i = 0; i < 40; i++) s.update(0.25, { power: 110, cad: 90 });
  const t0 = s.t; const w = s.update(0.25, { power: 0, cad: 0, connected: false });
  assert.ok(s.paused); assert.equal(s.pauseReason, 'trainer'); assert.equal(w, 50);
  for (let i = 0; i < 40; i++) s.update(0.25, { power: 0, cad: 0, connected: true });
  assert.ok(s.paused, 'resta in pausa anche se torna il segnale'); assert.equal(s.t, t0);
  s.resume(); assert.ok(!s.paused); s.update(0.25, { power: 50, cad: 80 });
  assert.ok(s.targetW < 70, 'riparte dal minimo con rampa: ' + s.targetW);
});
test('pausa manuale: carico minimo, il tempo non avanza', () => {
  const s = new Session(plan.sessions[1], 271); s.start();
  for (let i = 0; i < 100; i++) s.update(0.25, { power: 100, cad: 90 });
  s.pause(); const t = s.t; assert.equal(s.update(0.25, { power: 50, cad: 80 }), 50); assert.equal(s.t, t);
});
test('step a distanza termina per metri; rest = 50 W', () => {
  const s = new Session(plan.sessions[3], 271); s.start();
  let n = 0; while (s.idx === 0 && n++ < 20000) s.update(0.25, { power: 110, cad: 90 });
  assert.equal(s.idx, 1); assert.ok(Math.abs(s.dist - 3000) < 15, 'distanza ' + s.dist);
  while (s.idx < 2 && n++ < 40000) s.update(0.25, { power: 250, cad: 90 });
  s.update(0.25, { power: 250, cad: 90 }); assert.equal(s.step.t, 'rest');
});
test('beep negli ultimi 3 secondi: uno per secondo', () => {
  const s = new Session(plan.sessions[0], 271); s.start(); const ticks = [];
  for (let i = 0; i < 4 * 361; i++) { s.update(0.25, { power: 110, cad: 90 }); ticks.push(...s.drain().filter(e => e.type === 'tick').map(e => e.sec)); }
  assert.deepEqual(ticks, [3, 2, 1]);
});
test('salta step e termina anticipata', () => {
  const s = new Session(plan.sessions[0], 271); s.start(); s.update(0.25, { power: 100, cad: 90 }); s.skip(); assert.equal(s.idx, 1);
  s.finish('stopped'); assert.ok(s.done);
});
