// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Gatti Elia
// Inerzia: smettendo di pedalare il ciclista prosegue e rallenta; la pausa automatica scatta quando si è fermato davvero.
import test from 'node:test'; import assert from 'node:assert/strict';
import { plan } from './helpers.js';
import { Session } from '../js/session.js';
import * as G from '../js/scene.js';
import { speedFor } from '../js/physics.js';

const mk = () => { const s = new Session(plan.sessions[0], plan.ftp, { noErg: true }); s.start(1_800_000_000_000); return s; };
const run = (s, secs, input) => { for (let i = 0; i < secs * 20; i++) s.update(0.05, { connected: true, ...input }); };

test("accelerazione: la velocità segue la potenza in circa un secondo, non di colpo", () => {
  const s = mk(); const target = speedFor(200, 0); run(s, 0.5, { power: 200, cad: 85 });
  assert.ok(s.speed > 0 && s.speed < target * 0.8, "dopo mezzo secondo: " + s.speed + " su " + target);
  run(s, 6, { power: 200, cad: 85 }); assert.ok(Math.abs(s.speed - speedFor(200, s.grade)) < speedFor(200, s.grade) * 0.03, "poi ci arriva: " + s.speed);
});
test("smetti di pedalare: il ciclista prosegue per inerzia e rallenta piano, senza fermarsi di colpo", () => {
  const s = mk(); run(s, 20, { power: 200, cad: 85 }); const v0 = s.speed, d0 = s.dist; assert.ok(v0 > 5, "va: " + v0);
  run(s, 1, { power: 0, cad: 0 }); assert.ok(s.speed > v0 * 0.55, "un secondo dopo va ancora: " + s.speed + " su " + v0);
  const v1 = s.speed; run(s, 1, { power: 0, cad: 0 }); assert.ok(s.speed < v1 && s.speed > 0, "rallenta ma non si ferma: " + s.speed);
  assert.ok(s.dist - d0 > v0 * 1.2, "ha percorso ancora strada: " + (s.dist - d0));
});
test("pausa automatica: scatta solo quando il ciclista si è fermato davvero (in base alla velocità che aveva), poi si riparte pedalando", () => {
  const s = mk(); run(s, 20, { power: 200, cad: 85 });
  run(s, 6, { power: 0, cad: 0 }); assert.equal(s.paused, false, "ha smesso da 6 s ma sta ancora scorrendo: " + s.speed.toFixed(2) + " m/s");
  let t = 0; while (!s.paused && t < 60) { run(s, 1, { power: 0, cad: 0 }); t++; }
  assert.equal(s.paused, true, "alla fine si ferma e va in pausa"); assert.equal(s.pauseReason, "auto"); assert.ok(t >= 1 && t < 40, "dopo " + t + " s di inerzia");
  run(s, 3, { power: 150, cad: 80 }); assert.equal(s.paused, false, "riparte da solo pedalando");
});
test("una partenza nuova ricostruisce il mondo anche alla stessa distanza (altrimenti restavano ostacoli visibili ma ignorati)", () => {
  const a = G.V.clearGen || 0; G.clearStart(0); G.clearStart(0); assert.equal(G.V.clearGen, a + 2);
});
