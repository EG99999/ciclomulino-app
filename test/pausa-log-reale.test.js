// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Gatti Elia
// Prova con i dati VERI della pedalata libera del 11 nov 2026 (Elite Suito-T, log di debug): un valore al secondo (watt, cadenza).
// Con le vecchie soglie (30 rpm / 30 W) la seduta non ripartiva mai da sola e Elia ha dovuto premere RIPRENDI due volte.
import test from 'node:test'; import assert from 'node:assert/strict';
import { plan } from './helpers.js';
import { Session } from '../js/session.js';

// secondo 12 → 85 del log: [watt, cadenza]. Pedala pianissimo (mai oltre 13 W e 13 rpm), si ferma, riprova.
const LOG = [[0,0],[0,0],[0,0],[0,0],[0,0],[0,0],[13,0],[5,13],[5,13],[5,13],[5,13],[5,13],[5,0],[5,0],[5,0],[5,8],[5,8],[5,8],[5,8],[5,8],[0,0],[0,0],[0,0],[0,0],[5,0],[5,0],[5,0],[5,0],[5,0],[3,4],[3,4],[3,4],[3,4],[3,0],[3,0],[3,0],[0,0],[0,0],[3,0],[12,5],[12,5],[12,5],[12,5],[12,5],[10,7],[10,7],[10,7],[10,7],[9,10],[9,10],[9,10],[9,10],[9,10],[9,10],[0,0],[0,0],[0,0],[0,0],[0,0],[0,0],[0,0],[9,0],[9,0],[6,10],[6,10],[6,10],[6,10],[6,10],[6,0],[0,0],[0,0],[0,0],[0,0],[0,0]];

function replay(cfg) {
  const s = new Session(plan.sessions[0], plan.ftp, { noErg: true, ...cfg }); s.start(1_800_000_000_000); const ev = [];
  LOG.forEach(([p, c], sec) => { for (let i = 0; i < 4; i++) s.update(0.25, { power: p, cad: c, connected: true }); for (const e of s.drain()) ev.push({ sec, type: e.type, reason: e.reason }); });
  return { s, ev };
}

test('pedalata vera del 11/11: la seduta riparte da sola dopo ogni pausa, senza premere RIPRENDI', () => {
  const { ev } = replay();   // sec = secondi dall'inizio della replica (secondo 0 = secondo 12 del log)
  const pauses = ev.filter(e => e.type === 'pause'), resumes = ev.filter(e => e.type === 'resume');
  assert.ok(pauses.length >= 3 && pauses.every(p => p.reason === 'auto'), 'pause solo automatiche: ' + JSON.stringify(pauses));
  assert.ok(pauses[0].sec <= 6, "fermo all'inizio: pausa entro 5 s (" + pauses[0].sec + ')');
  const r1 = resumes.find(r => r.sec > pauses[0].sec); assert.ok(r1 && r1.sec <= 9, 'prima ripartenza appena inizia a muovere i pedali (secondo 18-19 del log): ' + JSON.stringify(r1));
  // il vero stop del log è ai secondi 66-69: pausa automatica, poi 9 W / 10 rpm fanno ripartire entro 6 secondi
  const stop = pauses.find(p => p.sec >= 55 && p.sec <= 62), r2 = stop && resumes.find(r => r.sec > stop.sec);
  assert.ok(stop && r2 && r2.sec - stop.sec <= 8, "ripartenza dopo l'ultimo stop: " + JSON.stringify({ stop, r2 }));
  assert.equal(resumes.length, pauses.filter(p => p.sec < 70).length, 'ogni pausa a metà seduta ha la sua ripartenza automatica');
});

test('con le vecchie soglie (30 rpm / 30 W) lo stesso log non riparte mai: è il difetto che Elia ha visto', () => {
  const { ev } = replay({ resumeCad: 31, resumeW: 30 });
  assert.equal(ev.filter(e => e.type === 'resume').length, 0, 'nessuna ripartenza automatica');
});

test('il rumore sotto le soglie (3-5 W, 0-4 rpm) non fa ripartire una seduta ferma', () => {
  const s = new Session(plan.sessions[0], plan.ftp, { noErg: true }); s.start(1_800_000_000_000);
  for (let i = 0; i < 28; i++) s.update(0.25, { power: 0, cad: 0, connected: true }); assert.equal(s.paused, true);
  for (let i = 0; i < 4 * 30; i++) s.update(0.25, { power: 3 + (i % 3), cad: i % 5 === 0 ? 4 : 0, connected: true });
  assert.equal(s.paused, true, 'resta in pausa');
});
