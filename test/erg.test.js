// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Gatti Elia
import test from 'node:test'; import assert from 'node:assert/strict';
import { Erg } from '../js/erg.js';
const run = (e, sec, cad, active = true) => { const ev = []; for (let i = 0; i < sec * 10; i++) ev.push(...e.update(0.1, cad, active)); return ev; };

test('cadenza <60 per 5" → riduzione, rampa a 50% in 10"', () => {
  const e = new Erg(); assert.deepEqual(run(e, 4.8, 55), []); assert.equal(e.reduced, false);
  assert.deepEqual(run(e, 0.4, 55), ['reduce']);
  run(e, 5, 55); assert.ok(Math.abs(e.L - 0.75) < 0.03, 'a metà rampa ~75%: ' + e.L);
  run(e, 5.2, 55); assert.ok(Math.abs(e.L - 0.5) < 1e-6);
});
test('cadenza >75 per 3" → ripristino in 10"', () => {
  const e = new Erg(); run(e, 20, 50); assert.ok(e.reduced);
  assert.deepEqual(run(e, 2.8, 80), []); assert.deepEqual(run(e, 0.4, 80), ['restore']);
  run(e, 10.2, 80); assert.equal(e.L, 1);
});
test('tra 60 e 75 rpm non cambia nulla (isteresi)', () => {
  const e = new Erg(); run(e, 20, 50); run(e, 30, 68); assert.ok(e.reduced);
  const f = new Erg(); run(f, 30, 68); assert.ok(!f.reduced);
});
test('i timer si azzerano se la cadenza risale / in pausa non conta', () => {
  const e = new Erg(); run(e, 4, 55); run(e, 1, 70); run(e, 4, 55); assert.ok(!e.reduced);
  const p = new Erg(); run(p, 30, 0, false); assert.ok(!p.reduced);
});
