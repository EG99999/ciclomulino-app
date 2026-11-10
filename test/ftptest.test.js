// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Gatti Elia
import test from 'node:test'; import assert from 'node:assert/strict';
import { parsePlan } from '../js/plan.js';
import { Session } from '../js/session.js';
import { rampPlan, ftp20Plan, bestWindow, testResult, RampWatcher, round5 } from '../js/ftptest.js';
import { normalizedPower, rideFromSession, addRide, loadHistory, summary } from '../js/history.js';
import { FolderSync, readFile, writeFile, listFiles } from '../js/folder.js';

const mem = () => { const m = new Map(); return { getItem: k => m.has(k) ? m.get(k) : null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }; };
const build = (plan, ftp = 271) => { const r = parsePlan({ ftp, sessions: [plan] }); assert.ok(r.ok, r.errors.join()); return r.sessions[0]; };
function run(sess, powerFn, maxSec = 6000) {
  const s = new Session(sess, 271); s.start(1_800_000_000_000);
  for (let i = 0; i < maxSec * 4 && !s.done; i++) { const t = s.t; s.update(0.25, { power: powerFn(s, t), cad: 90, hr: 120 }); if (s.idx >= s.steps.length - 1 && !s.done && s.stepT > 5) break; }
  return s;
}

test('ramp: parte da ~40% FTP e sale del 7% a ogni minuto (nessun watt fisso)', () => {
  const p = rampPlan(271), s = build(p), ramp = s.steps.filter(x => /^Rampa/.test(x.n));
  assert.equal(ramp[0].mid, 110); assert.equal(ramp[1].mid - ramp[0].mid, 20); assert.ok(ramp.at(-1).mid >= 271 * 2.0 && ramp.at(-1).mid <= 271 * 2.3);
  assert.deepEqual(s.warnings, []); assert.equal(s.test.kind, 'ramp');
  const q = build(rampPlan(200), 200); assert.equal(q.steps.filter(x => /^Rampa/.test(x.n))[0].mid, 80);
});
test('ramp: FTP = 75% del miglior minuto', () => {
  const s = run(build(rampPlan(271)), (se) => se.targetW);             // segue il carico fino alla fine: ultimo minuto = il più alto
  const r = testResult(s); assert.equal(r.kind, 'ramp'); assert.ok(r.ftp > 271 && r.ftp < 271 * 2, 'ftp ' + r.ftp); assert.equal(r.ftp, Math.round(r.basis * 0.75));
});
test('ramp: rileva quando non ce la fai più (potenza <80% per 12 s dopo 3 minuti)', () => {
  const w = new RampWatcher(); let fired = false;
  for (let i = 0; i < 100; i++) fired = w.feed(0.25, 150, 200, 4) || fired; assert.ok(fired);
  const v = new RampWatcher(); for (let i = 0; i < 100; i++) assert.equal(v.feed(0.25, 50, 200, 1), false, 'nei primi 3 minuti non scatta');
  const u = new RampWatcher(); for (let i = 0; i < 200; i++) assert.equal(u.feed(0.25, i % 20 < 4 ? 50 : 190, 200, 5), false, 'cali brevi non contano');
});
test('test 20 minuti: carico regolabile con ±5 W solo nel blocco del test, FTP = 95% della media', () => {
  const sess = build(ftp20Plan(271)), ti = sess.steps.findIndex(x => x.n === 'TEST 20 minuti'); assert.ok(sess.steps[ti].adjust);
  const s = new Session(sess, 271); s.start(1_800_000_000_000); assert.equal(s.adjust(5), false, 'fuori dal test non si regola');
  s.idx = ti; s.stepT = 0; s.rampT = 20; s.update(0.25, { power: 200, cad: 90 }); const t0 = s.update(0.25, { power: 200, cad: 90 });
  assert.equal(s.adjust(5), true); assert.equal(s.adjust(5), true); const t1 = s.update(0.25, { power: 200, cad: 90 }); assert.ok(Math.abs(t1 - t0 - 10) <= 1, `+10 W: ${t0} → ${t1}`);
  const s2 = run(sess, (se) => se.step.adjust ? 250 : 120, 3000); const r = testResult(s2);
  assert.equal(r.kind, 'ftp20'); assert.ok(Math.abs(r.basis - 250) <= 3, 'media ' + r.basis); assert.ok(Math.abs(r.ftp - r.basis * 0.95) <= 1, 'ftp ' + r.ftp);
});
test('test troppo corto → messaggio, non un numero', () => { const s = new Session(build(rampPlan(271)), 271); s.start(); for (let i = 0; i < 40; i++) s.update(0.25, { power: 100, cad: 90 }); assert.match(testResult(s).error, /corto/); });
test('finestra migliore e arrotondamento', () => { assert.equal(bestWindow([1, 1, 5, 5, 5], 3), 5); assert.equal(bestWindow([1, 2], 3), 0); assert.equal(round5(272), 270); });

test('storico: potenza normalizzata, riga, tetto di 300, riepilogo', () => {
  const recs = Array.from({ length: 120 }, () => ({ p: 200 })); assert.equal(Math.round(normalizedPower(recs)), 200);
  const s = run(build(rampPlan(271)), (se) => 150, 400); const ride = rideFromSession(s, { weight: 75, ftp: 271, when: 1_800_000_000_000 }); assert.equal(ride.wkg, +(ride.avgP / 75).toFixed(2));
  const st = mem(); addRide(st, ride); addRide(st, { ...ride, id: 'x', when: ride.when + 1000 }); assert.equal(loadHistory(st).length, 2); assert.equal(loadHistory(st)[0].id, 'x');
  assert.equal(summary(loadHistory(st), 7, ride.when + 5000).n, 2); assert.equal(summary(loadHistory(st), 7, ride.when + 9 * 86400000).n, 0);
});

/* ---- cartella dati: finta cartella in memoria (stessa interfaccia della File System Access API) ---- */
class FDir { constructor() { this.kind = 'directory'; this.m = new Map(); }
  async getDirectoryHandle(n, { create } = {}) { if (!this.m.has(n)) { if (!create) { const e = new Error('nf'); e.name = 'NotFoundError'; throw e; } this.m.set(n, new FDir()); } return this.m.get(n); }
  async getFileHandle(n, { create } = {}) { const f = this.m.get(n); if (!f || f.kind !== 'file') { if (!create) { const e = new Error('nf'); e.name = 'NotFoundError'; throw e; } this.m.set(n, new FFile()); } return this.m.get(n); }
  async *entries() { for (const e of this.m) yield e; } }
class FFile { constructor() { this.kind = 'file'; this.data = ''; this.t = 1; } async getFile() { const d = this.data; return { text: async () => (typeof d === 'string' ? d : new TextDecoder().decode(d)), lastModified: this.t, size: d.length }; }
  async createWritable() { return { write: async x => { this.data = x; this.t++; }, close: async () => { } }; } }
test('cartella dati: scrive e legge file anche in sottocartelle, elenca i .json', async () => {
  const h = new FDir(); await writeFile(h, 'fit/a.fit', Uint8Array.from([1, 2])); await writeFile(h, 'workouts/x.json', '{"a":1}'); await writeFile(h, 'workouts/y.txt', 'no');
  assert.equal((await readFile(h, 'workouts/x.json')).text, '{"a":1}'); assert.equal(await readFile(h, 'workouts/non-c-e.json'), null); assert.equal(await readFile(h, 'cartella/non-c-e.json'), null);
  assert.deepEqual((await listFiles(h, 'workouts', '.json')).map(f => f.name), ['x.json']); assert.deepEqual(await listFiles(h, 'niente', '.json'), []);
});
test('cartella dati: sincronizza piano e workout solo se cambiano; esporta .FIT, storico e FTP', async () => {
  const h = new FDir(), st = mem(), got = { plan: [], w: [] }; const fs = new FolderSync(h, { storage: st, onPlan: t => got.plan.push(t), onWorkouts: w => got.w.push(w) });
  assert.deepEqual(await fs.pull(), { plan: false, workouts: 0 });
  await writeFile(h, 'piano-app.json', '{"v":1}'); await writeFile(h, 'workouts/mio.json', '{"x":1}');
  assert.deepEqual(await fs.pull(), { plan: true, workouts: 1 }); assert.deepEqual(await fs.pull(), { plan: false, workouts: 0 });
  await writeFile(h, 'piano-app.json', '{"v":2}'); assert.equal((await fs.pull()).plan, true); assert.equal(got.plan.at(-1), '{"v":2}');
  await fs.pushFit('r.fit', Uint8Array.from([9])); await fs.pushHistory('[]'); await fs.pushFtp('{"ftp":280}'); assert.equal((await readFile(h, 'ftp-test.json')).text, '{"ftp":280}'); assert.ok(await readFile(h, 'fit/r.fit'));
});
