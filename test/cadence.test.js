// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Gatti Elia
// Pausa automatica «come Zwift» (15 nov 2026): fermo da 5 s → pausa e carico minimo; con l'ERG si pedala libero e l'ERG torna
// quando la potenza media degli ultimi 3 s arriva al limite basso dello step. Senza ERG (pedalata libera) riparte appena si pedala.
// Caso reale del 9 nov 2026: col Suito-T la seduta restava in «PAUSA AUTOMATICA» mentre pedalava (la ripartenza guardava solo la cadenza).
import test from 'node:test'; import assert from 'node:assert/strict';
import { plan } from './helpers.js';
import { Session } from '../js/session.js';

const mk = (cfg = {}) => { const s = new Session(plan.sessions[0], plan.ftp, cfg); s.start(1_800_000_000_000); return s; };   // step 0: riscaldamento 100-120 W → limite basso 100 W
const run = (s, secs, input) => { for (let i = 0; i < secs * 4; i++) s.update(0.25, { connected: true, ...input }); };

test('fermo: pausa dopo 5 secondi esatti, carico minimo, e con l\'ERG dice quanta potenza serve per ripartire', () => {
  const s = mk(); run(s, 20, { power: 110, cad: 90 });
  run(s, 4.5, { power: 0, cad: 0 }); assert.equal(s.paused, false, 'a 4,5 s ancora no');
  run(s, 0.75, { power: 0, cad: 0 }); assert.equal(s.paused, true); assert.equal(s.pauseReason, 'auto');
  assert.equal(s.needW, 100, 'serve il limite basso dello step'); assert.equal(s.targetW, 50, 'in pausa il trainer è a carico minimo');
  const ev = s.drain().find(e => e.type === 'pause'); assert.equal(ev.needW, 100);
});

test('ERG: dopo la pausa pedali libero e l\'ERG torna quando tieni il limite basso dello step per 3 s', () => {
  const s = mk(); run(s, 20, { power: 110, cad: 90 }); run(s, 6, { power: 0, cad: 0 }); assert.equal(s.paused, true); s.drain();
  run(s, 20, { power: 60, cad: 80 }); assert.equal(s.paused, true, 'pedalare piano (60 W) non basta, anche per tanto tempo'); assert.equal(s.targetW, 50);
  run(s, 2, { power: 105, cad: 85 }); assert.equal(s.paused, true, 'a 100 W da 2 s: non ancora');
  run(s, 1.25, { power: 105, cad: 85 }); assert.equal(s.paused, false, 'dopo 3 s a 100 W l\'ERG riparte');
  const ev = s.drain().find(e => e.type === 'resume'); assert.equal(ev.reason, 'auto');
  s.update(0.25, { power: 105, cad: 85, connected: true }); assert.ok(s.targetW >= 100, 'il carico riparte da quello che stai già facendo, non scende a 50 W: ' + s.targetW);
});

test('ERG: un picco di un secondo non basta (conta la media degli ultimi 3 s) e un calo improvviso blocca la ripartenza', () => {
  const s = mk(); run(s, 20, { power: 110, cad: 90 }); run(s, 6, { power: 0, cad: 0 }); assert.equal(s.paused, true);
  run(s, 2, { power: 20, cad: 60 }); run(s, 1, { power: 200, cad: 90 }); assert.equal(s.paused, true, 'media 3 s = 80 W: troppo poco');
  const t = mk(); run(t, 20, { power: 110, cad: 90 }); run(t, 6, { power: 0, cad: 0 });
  run(t, 2.5, { power: 140, cad: 90 }); run(t, 0.25, { power: 20, cad: 60 }); assert.equal(t.paused, true, 'media alta ma ora sei crollato: aspetta');
});

test('ERG: la potenza richiesta segue lo step (limite basso), non un valore fisso', () => {
  const s = mk(); run(s, 20, { power: 110, cad: 90 }); s.idx = 2; s.fromW = s.step.mid;   // step da 298-325 W
  run(s, 6, { power: 0, cad: 0 }); assert.equal(s.paused, true); assert.equal(s.needW, 298);
  run(s, 10, { power: 250, cad: 90 }); assert.equal(s.paused, true, '250 W sono sotto il limite basso: resta in pausa');
  run(s, 3.5, { power: 305, cad: 90 }); assert.equal(s.paused, false);
});

test('pausa manuale: nessuna ripartenza automatica, si riprende col pulsante', () => {
  const s = mk(); run(s, 5, { power: 110, cad: 90 }); s.pause('manual'); assert.equal(s.needW, 0);
  run(s, 20, { power: 300, cad: 100 }); assert.equal(s.paused, true); s.resume(); assert.equal(s.paused, false);
});

test('senza cadenza dal trainer: la pausa scatta dai watt e la ripartenza ERG pure', () => {
  const s = mk(); run(s, 7, { power: 0, cad: null });
  assert.equal(s.paused, true); assert.equal(s.pauseReason, 'auto', 'fermo sui pedali: pausa automatica');
  run(s, 2, { power: 150, cad: null }); assert.equal(s.paused, true, 'servono 3 s');
  run(s, 1.5, { power: 150, cad: null }); assert.equal(s.paused, false, 'riparte da sola'); assert.ok(s.speed > 0, 'il ciclista si muove: ' + s.speed);
});

test('senza ERG (pedalata libera, test FTP): riparte appena si pedala per più di 1 s', () => {
  const s = mk({ noErg: true }); run(s, 7, { power: 0, cad: 0 }); assert.equal(s.paused, true); assert.equal(s.needW, 0);
  run(s, 0.5, { power: 150, cad: 80 }); assert.equal(s.paused, true, 'mezzo secondo non basta');
  run(s, 1, { power: 150, cad: 80 }); assert.equal(s.paused, false, 'dopo più di 1 s riparte'); assert.ok(s.speed > 0);
});

test('senza ERG: pedalando anche piano riparte (≥ 10 rpm o ≥ 12 W); i valori da «ruota che gira da sola» no', () => {
  const free = () => mk({ noErg: true });
  const quiet = free(); run(quiet, 7, { power: 0, cad: 0 }); run(quiet, 20, { power: 5, cad: 0 }); assert.equal(quiet.paused, true, '5 W e 0 rpm: nessuno pedala, resta in pausa');
  run(quiet, 20, { power: 7, cad: 4 }); assert.equal(quiet.paused, true, 'poco sopra lo zero ma sotto le soglie: resta in pausa');
  const w = free(); run(w, 7, { power: 0, cad: 0 }); run(w, 3, { power: 15, cad: 0 }); assert.equal(w.paused, false, '15 W bastano');
  const c = free(); run(c, 7, { power: 0, cad: 0 }); run(c, 3, { power: 0, cad: 12 }); assert.equal(c.paused, false, '12 rpm bastano');
  const b = free(); run(b, 7, { power: 0, cad: 0 }); run(b, 3, { power: 0, cad: 80 }); assert.equal(b.paused, false, 'cadenza normale: come prima');
});

test('senza ERG: un dato basso isolato durante la ripartenza non azzera il conteggio (a bassi giri la cadenza si aggiorna a scatti)', () => {
  const s = mk({ noErg: true }); run(s, 7, { power: 0, cad: 0 }); assert.equal(s.paused, true);
  for (let i = 0; i < 6 && s.paused; i++) { run(s, 1, { power: 5, cad: 13 }); if (!s.paused) break; run(s, 1, { power: 5, cad: 0 }); }
  assert.equal(s.paused, false, 'riparte anche con il dato che salta tra 13 e 0 rpm');
});

test('nessuna soglia sui giri: pedalare a 25 rpm con i watt non riduce il carico né mette in pausa', () => {
  const s = mk(), ev = []; for (let i = 0; i < 4 * 60; i++) { s.update(0.25, { power: 110, cad: 25, connected: true }); ev.push(...s.drain()); }
  assert.ok(!ev.some(e => e.type === 'reduce' || e.type === 'pause'), 'nessuna riduzione, nessuna pausa'); assert.equal(s.erg.reduced, false); assert.equal(s.paused, false);
});

test('la riduzione al 50% sotto soglia resta disponibile se la si chiede (lowRpm: 40)', () => {
  const a = mk(), evA = []; for (let i = 0; i < 80; i++) { a.update(0.25, { power: 110, cad: null, connected: true }); evA.push(...a.drain()); }
  assert.ok(!evA.some(e => e.type === 'reduce'), 'senza cadenza dal trainer non scatta'); assert.equal(a.erg.reduced, false);
  const b = mk({ lowRpm: 40 }), evB = []; for (let i = 0; i < 80; i++) { b.update(0.25, { power: 110, cad: 30, connected: true }); evB.push(...b.drain()); }
  assert.ok(evB.some(e => e.type === 'reduce'), 'con 30 rpm veri (sotto i 40) e la soglia attiva il carico scende');
});

test('chi pedala normalmente con la cadenza non vede cambiare niente', () => {
  const s = mk(); run(s, 30, { power: 110, cad: 88 }); assert.equal(s.paused, false); assert.ok(s.speed > 0); assert.equal(s.erg.reduced, false);
});
