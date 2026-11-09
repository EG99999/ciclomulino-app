import test from 'node:test'; import assert from 'node:assert/strict';
import { parsePlan, pickSession } from '../js/plan.js';
import { plan } from './helpers.js';

test('il file di esempio è valido e ha 4 sedute', () => { assert.ok(plan.ok); assert.equal(plan.sessions.length, 4); assert.equal(plan.ftp, 271); });
test('le ripetizioni vengono espanse (5x3\' = 2 + 10 + 1 step)', () => {
  const s = plan.sessions[0]; assert.equal(s.steps.length, 13);
  const iv = s.steps.filter(x => x.t === 'interval'); assert.equal(iv.length, 5);
  assert.equal(iv[2].rep, 3); assert.equal(iv[2].reps, 5); assert.equal(s.total, 360 + 240 + 5 * 360 + 300);
  assert.equal(s.blocks, 4);
});
test('pct diventa watt con la FTP del file; rest = 50 W; dist stimata', () => {
  const s = plan.sessions[3].steps; assert.deepEqual([s[1].lo, s[1].hi], [244, 257]); assert.deepEqual([s[2].lo, s[2].hi], [50, 50]);
  assert.equal(s[1].slope, 3); assert.ok(s[0].d == null && s[0].dEst > 300);
});
test('avviso se hi - lo < 10 W', () => {
  const r = parsePlan({ ftp: 271, sessions: [{ id: 'a', blocks: [{ t: 'interval', n: 'X', d: 60, lo: 200, hi: 205 }] }] });
  assert.ok(r.ok); assert.equal(r.warnings.length, 1); assert.match(r.warnings[0], /minimo di 10 W/);
});
test('errori chiari su tipo, durata, watt, JSON', () => {
  assert.match(parsePlan('{').errors[0], /JSON/);
  assert.ok(!parsePlan({ sessions: [{ blocks: [{ t: 'boh', d: 5, lo: 1, hi: 2 }] }] }).ok);
  assert.ok(!parsePlan({ sessions: [{ blocks: [{ t: 'interval', lo: 1, hi: 20 }] }] }).ok);
  assert.ok(!parsePlan({ sessions: [{ blocks: [{ t: 'interval', d: 5 }] }] }).ok);
  assert.ok(!parsePlan({ sessions: [{ blocks: [{ rep: 0, steps: [] }] }] }).ok);
});
test('ripetizioni annidate', () => {
  const r = parsePlan({ ftp: 250, sessions: [{ id: 'n', blocks: [{ rep: 2, steps: [{ rep: 3, steps: [{ t: 'interval', d: 30, lo: 200, hi: 220 }] }, { t: 'rest', d: 10 }] }] }] });
  assert.equal(r.sessions[0].steps.length, 8); assert.equal(r.sessions[0].steps[0].reps, 3);
});
test('preselezione: oggi, altrimenti la prossima, altrimenti la prima', () => {
  assert.equal(plan.sessions[pickSession(plan.sessions, '2026-11-16')].id, '2026-11-16-ciclomulino-vo2');
  assert.equal(plan.sessions[pickSession(plan.sessions, '2026-11-14')].id, '2026-11-16-ciclomulino-vo2');
  assert.equal(plan.sessions[pickSession(plan.sessions, '2027-01-01')].id, plan.sessions[0].id);
});
