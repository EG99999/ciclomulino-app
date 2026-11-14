// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Gatti Elia
// Statistiche dell'elenco allenamenti: durata, potenza media, zone e profilo per il piccolo grafico.
import test from 'node:test'; import assert from 'node:assert/strict';
import { plan } from './helpers.js';
import { parsePlan, workoutStats, zoneOfPct, ZONE_TOPS } from '../js/plan.js';

test('zone: confini in % FTP come nel cruscotto', () => {
  assert.equal(zoneOfPct(0), 0); assert.equal(zoneOfPct(54.9), 0); assert.equal(zoneOfPct(55), 1); assert.equal(zoneOfPct(90), 2); assert.equal(zoneOfPct(105), 3); assert.equal(zoneOfPct(120), 4); assert.equal(zoneOfPct(150), 5); assert.equal(zoneOfPct(400), 6); assert.equal(ZONE_TOPS.length, 7);
});
test('statistiche di una seduta vera: durata, media, massima, zone e profilo coerenti', () => {
  for (const s of plan.sessions) {
    const st = workoutStats(s, plan.ftp);
    assert.ok(Math.abs(st.total - s.total) < 1, 'durata ' + st.total + ' vs ' + s.total);
    assert.ok(Math.abs(st.zones.reduce((a, b) => a + b, 0) - st.total) < 0.01, 'le zone sommano alla durata');
    assert.ok(st.avgW > 0 && st.avgW <= st.maxW, 'media tra 0 e massima: ' + st.avgW + ' / ' + st.maxW);
    assert.equal(st.bars.length, 72); assert.ok(st.bars.every(b => b.w >= 0 && b.z >= 0 && b.z < 7));
  }
});
test('statistiche: esempio calcolato a mano (10 min a 100 W + 10 min a 200 W con FTP 200)', () => {
  const r = parsePlan({ ftp: 200, sessions: [{ id: 'x', title: 'x', blocks: [{ t: 'warmup', d: 600, lo: 95, hi: 105 }, { t: 'interval', d: 600, lo: 195, hi: 205 }] }] });
  const st = workoutStats(r.sessions[0], 200, 20);
  assert.equal(st.total, 1200); assert.equal(Math.round(st.avgW), 150); assert.equal(Math.round(st.avgPct), 75); assert.equal(st.maxW, 205);
  assert.equal(st.zones[0], 600); assert.equal(st.zones[3], 600);                          // 50% FTP = zona 1, 100% FTP = zona 4
  assert.equal(st.bars.length, 20); assert.ok(st.bars.slice(0, 10).every(b => b.z === 0 && Math.round(b.w) === 100)); assert.ok(st.bars.slice(10).every(b => b.z === 3 && Math.round(b.w) === 200));
});
test('statistiche: allenamento vuoto o senza durata non fa errori', () => {
  const st = workoutStats({ steps: [] }, 200); assert.equal(st.total, 0); assert.equal(st.bars.length, 0); assert.equal(workoutStats(null, 200).total, 0);
});
