// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Gatti Elia
// Caso reale del 9 nov 2026: col Suito-T la seduta restava in «PAUSA AUTOMATICA» mentre pedalava. La ripartenza guardava solo la cadenza.
import test from 'node:test'; import assert from 'node:assert/strict';
import { plan } from './helpers.js';
import { Session } from '../js/session.js';

const mk = () => { const s = new Session(plan.sessions[0], plan.ftp); s.start(1_800_000_000_000); return s; };
const run = (s, secs, input) => { for (let i = 0; i < secs * 4; i++) s.update(0.25, { connected: true, ...input }); };

test('pausa automatica: si riparte dai watt anche se il trainer non manda la cadenza (null)', () => {
  const s = mk(); run(s, 7, { power: 0, cad: null });
  assert.equal(s.paused, true); assert.equal(s.pauseReason, 'auto', 'fermo sui pedali: pausa automatica');
  run(s, 1, { power: 150, cad: null }); assert.equal(s.paused, true, 'serve un attimo (2 s) di pedalata');
  run(s, 2, { power: 150, cad: null }); assert.equal(s.paused, false, 'riparte da sola'); assert.ok(s.speed > 0, 'il ciclista si muove: ' + s.speed);
});

test('pausa automatica: si riparte dai watt anche se la cadenza arriva ma resta a zero', () => {
  const s = mk(); run(s, 7, { power: 0, cad: 0 }); assert.equal(s.pauseReason, 'auto');
  run(s, 3, { power: 120, cad: 0 }); assert.equal(s.paused, false); assert.ok(s.speed > 0);
});

test('pausa automatica: senza pedalare davvero (sotto 30 W, cadenza bassa) non riparte; con cadenza sopra 30 riparte come prima', () => {
  const a = mk(); run(a, 7, { power: 0, cad: 0 }); run(a, 10, { power: 20, cad: 10 }); assert.equal(a.paused, true, 'ruota che gira da sola: resta in pausa');
  const b = mk(); run(b, 7, { power: 0, cad: 0 }); run(b, 3, { power: 0, cad: 80 }); assert.equal(b.paused, false, 'regola vecchia: cadenza sopra 30');
});

test('senza cadenza dal trainer la logica ERG sulla cadenza non scatta (prima: carico al 50% per sempre); con cadenza bassa vera scatta', () => {
  const a = mk(), evA = []; for (let i = 0; i < 80; i++) { a.update(0.25, { power: 110, cad: null, connected: true }); evA.push(...a.drain()); }
  assert.ok(!evA.some(e => e.type === 'reduce'), 'nessuna riduzione: la cadenza non c\'è'); assert.equal(a.erg.reduced, false);
  const b = mk(), evB = []; for (let i = 0; i < 80; i++) { b.update(0.25, { power: 110, cad: 40, connected: true }); evB.push(...b.drain()); }
  assert.ok(evB.some(e => e.type === 'reduce'), 'con 40 rpm veri il carico scende');
});

test('chi pedala normalmente con la cadenza non vede cambiare niente', () => {
  const s = mk(); run(s, 30, { power: 110, cad: 88 }); assert.equal(s.paused, false); assert.ok(s.speed > 0); assert.equal(s.erg.reduced, false);
});
