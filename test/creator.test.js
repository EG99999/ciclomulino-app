// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Gatti Elia
import test from 'node:test'; import assert from 'node:assert/strict';
import { newStep, newRep, toBlocks, fromBlocks, toSession, totalSeconds, check } from '../js/creator.js';
import { parsePlan } from '../js/plan.js';

test('i valori iniziali sono in % FTP (nessun watt fisso) e il workout è leggibile dall\'app', () => {
  const nodes = [newStep('warmup'), newRep(), newStep('cooldown')];
  const sess = toSession({ title: 'Prova', nodes }); const r = parsePlan({ ftp: 271, sessions: [sess] });
  assert.ok(r.ok, r.errors.join()); assert.equal(r.sessions[0].steps.length, 2 + 6); assert.equal(r.sessions[0].steps[1].lo, Math.round(0.9 * 271));
  assert.equal(r.warnings.length, 0, r.warnings.join());
  assert.ok(!JSON.stringify(sess).includes('"lo"'), 'nessun watt fisso nel file');
});
test('andata e ritorno: fromBlocks(toBlocks(x)) conserva tutto, ripetizioni annidate comprese', () => {
  const n = newStep('interval'); n.pw = 'watt'; n.lo = 300; n.hi = 320; n.cad = [90, 100]; n.grade = 4; n.hrCap = 170; n.by = 'dist'; n.dist = 2000; n.n = 'Salita';
  const inner = { kind: 'rep', rep: 2, steps: [newStep('interval'), newStep('rest')] }, outer = { kind: 'rep', rep: 3, steps: [n, inner] };
  const blocks = toBlocks([outer]); const back = fromBlocks(blocks);
  assert.deepEqual(toBlocks(back), blocks); assert.equal(back[0].steps[0].dist, 2000); assert.equal(back[0].steps[0].pw, 'watt'); assert.equal(back[0].steps[1].kind, 'rep');
  const p = parsePlan({ ftp: 271, sessions: [{ id: 'x', blocks }] }); assert.ok(p.ok); assert.equal(p.sessions[0].steps.length, 3 * (1 + 2 * 2));
});
test('durata totale con ripetizioni e step a distanza', () => {
  assert.equal(totalSeconds([newStep('warmup'), { kind: 'rep', rep: 4, steps: [newStep('interval'), newStep('recovery')] }]), 600 + 4 * (300 + 180));
  const d = newStep(); d.by = 'dist'; d.dist = 800; assert.equal(totalSeconds([d], 8), 100);
});
test('controlli: errori che bloccano e avvisi (range < 10 W con la FTP)', () => {
  assert.match(check([], 271).errors[0], /almeno uno step/);
  const s = newStep(); s.d = 0; assert.match(check([s], 271).errors[0], /durata/);
  const t = newStep(); t.pct = [0.95, 0.97]; const c = check([t], 271); assert.equal(c.errors.length, 0); assert.match(c.warnings[0], /almeno 10 W/);
  const w = newStep(); w.pw = 'watt'; w.lo = 300; w.hi = 250; assert.match(check([w], 271).errors[0], /watt/);
  const e = { kind: 'rep', rep: 2, steps: [] }; assert.ok(check([e], 271).errors.some(x => /vuota/.test(x)));
});
