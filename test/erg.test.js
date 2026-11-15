// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Gatti Elia
import test from 'node:test'; import assert from 'node:assert/strict';
import { Erg } from '../js/erg.js';
const run = (e, sec, cad, active = true) => { const ev = []; for (let i = 0; i < sec * 10; i++) ev.push(...e.update(0.1, cad, active)); return ev; };
const low = () => new Erg({ lowRpm: 40 });      // la riduzione sotto soglia è disattivata di serie (lowRpm 0): qui la si attiva

test('di serie nessuna soglia sui giri: a 10 rpm per un minuto il carico non cambia', () => {
  const e = new Erg(); run(e, 60, 10); assert.equal(e.reduced, false); assert.equal(e.L, 1);
});
test('cadenza <40 per 5" → riduzione, rampa a 50% in 10" (se la soglia è attiva)', () => {
  const e = low(); assert.deepEqual(run(e, 4.8, 35), []); assert.equal(e.reduced, false);
  assert.deepEqual(run(e, 0.4, 35), ['reduce']);
  run(e, 5, 35); assert.ok(Math.abs(e.L - 0.75) < 0.03, 'a metà rampa ~75%: ' + e.L);
  run(e, 5.2, 35); assert.ok(Math.abs(e.L - 0.5) < 1e-6);
});
test('cadenza >75 per 3" → ripristino in 10"', () => {
  const e = low(); run(e, 20, 30); assert.ok(e.reduced);
  assert.deepEqual(run(e, 2.8, 80), []); assert.deepEqual(run(e, 0.4, 80), ['restore']);
  run(e, 10.2, 80); assert.equal(e.L, 1);
});
test('tra 40 e 75 rpm non cambia nulla (isteresi)', () => {
  const e = low(); run(e, 20, 30); run(e, 30, 58); assert.ok(e.reduced);
  const f = low(); run(f, 30, 58); assert.ok(!f.reduced);
});
test('i timer si azzerano se la cadenza risale / in pausa non conta', () => {
  const e = low(); run(e, 4, 35); run(e, 1, 50); run(e, 4, 35); assert.ok(!e.reduced);
  const p = low(); run(p, 30, 0, false); assert.ok(!p.reduced);
});
