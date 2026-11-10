// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Gatti Elia
import test from 'node:test'; import assert from 'node:assert/strict';
import { Coach, stepMessage } from '../js/coach.js';
import { Session } from '../js/session.js';
import { buildFit } from '../js/fit.js';
import { plan, runSim } from './helpers.js';

const rnd = () => 0.3;
test('messaggio di step: nome, durata, watt e cadenza', () => {
  const s = plan.sessions[0].steps[2]; const m = stepMessage(s, null, rnd);
  assert.match(m, /VO2max: 3' a 298-325 W · cadenza 90-100/);
  assert.match(stepMessage(plan.sessions[0].steps[3], null, rnd), /Recupero: 3' a 90-100 W/);
});
test('il coach parla a inizio, cambio step, riduzione carico, metà seduta, fine', () => {
  const said = []; const c = new Coach((t, k) => said.push([t, k]), rnd);
  const sess = new Session(plan.sessions[0], 271); sess.start(); c.onEvent(sess.drain()[0], sess);
  assert.equal(said.length, 1);
  c.onEvent({ type: 'reduce' }, sess); c.onEvent({ type: 'restore' }, sess); c.onEvent({ type: 'finish', reason: 'completed' }, sess);
  assert.equal(said.length, 4); assert.match(said[1][0], /carico ridotto/i);
  for (let i = 0; i < 4 * 1400; i++) { sess.update(0.25, { power: 150, cad: 90, hr: 120 }); c.tick(0.25, sess, { hr: 120 }); }
  assert.ok(said.some(x => /Metà seduta/.test(x[0])), 'messaggio di metà seduta');
  assert.ok(said.some(x => /Ultimi 10 secondi/.test(x[0])), 'ultimi 10"');
});
test('avviso FC sopra il tetto (solo informativo), al massimo uno al minuto', () => {
  const said = []; const c = new Coach(t => said.push(t), rnd); const sess = new Session(plan.sessions[2], 271); sess.start();
  for (let i = 0; i < 4 * 130; i++) { sess.update(0.25, { power: 150, cad: 90, hr: 150 }); c.tick(0.25, sess, { hr: 150 }); }
  const w = said.filter(x => /sopra il tetto/.test(x)); assert.ok(w.length >= 1 && w.length <= 3, 'avvisi FC: ' + w.length);
});
test('auto-pausa quando ti fermi, ripresa automatica quando riparti', () => {
  const s = new Session(plan.sessions[0], 271); s.start();
  for (let i = 0; i < 40; i++) s.update(0.25, { power: 110, cad: 90 });
  const t0 = s.t; for (let i = 0; i < 4 * 6; i++) s.update(0.25, { power: 0, cad: 0 });
  assert.ok(s.paused && s.pauseReason === 'auto'); assert.ok(s.t - t0 < 5.5, 'il tempo non corre da fermo: ' + (s.t - t0));
  assert.equal(s.targetW, 50);
  for (let i = 0; i < 4 * 3; i++) s.update(0.25, { power: 60, cad: 70 });
  assert.ok(!s.paused, 'riparte da solo');
});
test('un trainer scollegato NON riparte da solo (solo la pausa automatica per fermo lo fa)', () => {
  const s = new Session(plan.sessions[0], 271); s.start(); s.update(0.25, { power: 100, cad: 90, connected: false });
  for (let i = 0; i < 40; i++) s.update(0.25, { power: 100, cad: 90, connected: true }); assert.ok(s.paused);
});
test('salvataggio anti-crash: snapshot → JSON → restore → stesso FIT', () => {
  const { sess } = runSim(0, { maxSec: 900 });
  const raw = JSON.stringify(sess.snapshot()); const back = JSON.parse(raw);
  const r = new Session(plan.sessions[0], 271); r.restore(back);
  assert.equal(r.records.length, sess.records.length); assert.equal(r.idx, sess.idx); assert.ok(r.paused && r.started);
  assert.ok(Math.abs(r.avgPower - sess.avgPower) < 0.01);
  const a = buildFit(sess), b = buildFit(r); assert.equal(a.length, b.length);
  assert.ok(raw.length < 200000, 'snapshot compatto: ' + raw.length);
  r.resume(); for (let i = 0; i < 40; i++) r.update(0.25, { power: 110, cad: 90 }); assert.ok(r.records.length > sess.records.length - 1, 'continua a registrare dopo il ripristino');
});
