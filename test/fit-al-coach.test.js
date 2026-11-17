// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Gatti Elia
// Spedizione dei .FIT verso il repository del coach (da lì un'Action li carica su Garmin): selezione dei file, copia, push solo se serve.
import test from 'node:test'; import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { pickNew, run, checkFit, titleFor } from '../tools/fit-al-coach.mjs';

const fitBytes = () => { const b = Buffer.alloc(40); b.write('.FIT', 8, 'latin1'); b[0] = 14; return b; };
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'fitco-'));
const put = (dir, name, buf, ageSec = 600) => { fs.mkdirSync(dir, { recursive: true }); const f = path.join(dir, name); fs.writeFileSync(f, buf); const t = new Date(Date.now() - ageSec * 1000); fs.utimesSync(f, t, t); return f; };
const fakeGit = (fail = {}) => { const calls = []; const g = (repo, args) => { calls.push(args[0]); if (fail[args[0]] && fail[args[0]]--) { const e = new Error('rifiutato'); e.stderr = 'remote: https://utente:segretissimo@github.com negato'; throw e; } return ''; }; g.calls = calls; return g; };

test('pickNew: solo .fit validi, fermi da un po\' e non ancora spediti', () => {
  const src = tmp();
  put(src, 'a.fit', fitBytes()); put(src, 'B.FIT', fitBytes()); put(src, 'nuovo.fit', fitBytes(), 5); put(src, 'rotto.fit', Buffer.from('ciao')); put(src, 'nota.txt', Buffer.from('x')); put(src, 'gia.fit', fitBytes());
  const r = pickNew(src, { 'gia.fit': '2026-11-17' });
  assert.deepEqual(r.files.map(f => f.name), ['B.FIT', 'a.fit']);
  assert.ok(r.skipped.some(s => s.name === 'nuovo.fit' && s.why === 'troppo recente' && !s.permanent), 'quello appena scritto aspetta');
  assert.ok(r.skipped.some(s => s.name === 'rotto.fit' && s.permanent), 'quello rotto è scartato per sempre');
  assert.equal(checkFit(fitBytes()), null);
});

test('run: copia in fit/inbox, commit e push; sent si aggiorna solo dopo il push', () => {
  const src = tmp(), repo = tmp(); put(src, 'a.fit', fitBytes()); const g = fakeGit(), state = {}, logs = [];
  const r = run({ src, repo, state, git: g, log: m => logs.push(m) });
  assert.equal(r.esito, 'spediti'); assert.deepEqual(r.copiati, ['a.fit']);
  assert.ok(fs.existsSync(path.join(repo, 'fit', 'inbox', 'a.fit')));
  assert.deepEqual(g.calls, ['pull', 'add', 'commit', 'push']); assert.ok(state.sent['a.fit']);
  assert.equal(run({ src, repo, state, git: fakeGit() }).esito, 'niente', 'la volta dopo non c\'è niente da fare');
});

test('run: senza file nuovi non tocca git né la rete', () => {
  const src = tmp(), repo = tmp(), g = fakeGit(); put(src, 'a.fit', fitBytes());
  const r = run({ src, repo, state: { sent: { 'a.fit': 'x' } }, git: g }); assert.equal(r.esito, 'niente'); assert.deepEqual(g.calls, []);
});

test('run: push fallito → errore, il file NON risulta spedito, e la volta dopo riprova; i segreti dell\'URL non finiscono nel log', () => {
  const src = tmp(), repo = tmp(); put(src, 'a.fit', fitBytes()); const state = {}, logs = [];
  const r = run({ src, repo, state, git: fakeGit({ push: 2 }), log: m => logs.push(m) });
  assert.equal(r.esito, 'errore'); assert.ok(!state.sent['a.fit'], 'non segnato come spedito');
  assert.ok(!logs.join('\n').includes('segretissimo') && !String(r.errore).includes('segretissimo'), 'niente credenziali nei log');
  const g2 = fakeGit(); const r2 = run({ src, repo, state, git: g2 }); assert.equal(r2.esito, 'spediti'); assert.ok(g2.calls.includes('push'));
});

test('run: se l\'Action ha appena fatto un commit il primo push fallisce, poi pull --rebase e secondo push riescono', () => {
  const src = tmp(), repo = tmp(); put(src, 'a.fit', fitBytes()); const g = fakeGit({ push: 1 }), state = {};
  assert.equal(run({ src, repo, state, git: g }).esito, 'spediti'); assert.deepEqual(g.calls, ['pull', 'add', 'commit', 'push', 'pull', 'push']);
});

test('run: un file già elaborato dal coach (done o failed) non viene rimandato', () => {
  const src = tmp(), repo = tmp(); put(src, 'a.fit', fitBytes()); put(path.join(repo, 'fit', 'done'), 'a.fit', fitBytes());
  const state = {}, g = fakeGit(); const r = run({ src, repo, state, git: g });
  assert.equal(r.esito, 'niente'); assert.ok(state.sent['a.fit']); assert.ok(!fs.existsSync(path.join(repo, 'fit', 'inbox', 'a.fit')));
});

test('run --dry-run: non copia e non usa git', () => {
  const src = tmp(), repo = tmp(), g = fakeGit(); put(src, 'a.fit', fitBytes());
  const r = run({ src, repo, state: {}, git: g, dryRun: true, log: () => {} }); assert.equal(r.esito, 'niente'); assert.deepEqual(g.calls, []); assert.ok(!fs.existsSync(path.join(repo, 'fit')));
});

test('pickNew: --since lascia stare i file più vecchi (le prove di giorni fa non vanno a Garmin)', () => {
  const src = tmp(); put(src, 'vecchio.fit', fitBytes(), 5 * 86400); put(src, 'oggi.fit', fitBytes(), 600);
  const r = pickNew(src, {}, { since: Date.now() - 86400 * 1000 }); assert.deepEqual(r.files.map(f => f.name), ['oggi.fit']);
});

test('titleFor: il nome della seduta pianificata (apostrofo compreso), non quello generico; coach grezzo o formato app; ripiego sullo storico', () => {
  const plan = { sessions: [{ date: '2026-11-17', title: "Ciclomulino z2 40'" }, { date: '2026-11-18', title: 'Altro' }] };
  assert.equal(titleFor('20261117-062410-ciclomulino-z2-40.fit', { plan }), "Ciclomulino z2 40'");
  const grezzo = [{ data: '2026-11-17', titolo: "Ciclomulino z2 40'" }];
  assert.equal(titleFor('20261117-0624-ciclomulino-z2-40.fit', { plan: grezzo }), "Ciclomulino z2 40'");
  assert.equal(titleFor('20261117-062410-ciclomulino-z2-40.fit', { plan: { sessions: [] }, history: [{ fit: '20261117-062410-ciclomulino-z2-40.fit', title: 'Ciclomulino z2 40' }] }), 'Ciclomulino z2 40', 'senza piano si usa lo storico');
  assert.equal(titleFor('20261117-062410-ciclomulino-z2-40.fit', { plan: { sessions: [{ date: '2026-11-17', title: 'Un altro titolo' }] } }), null, 'nessuna corrispondenza: nome di Garmin');
  assert.equal(titleFor('qualunque.fit', { plan }), null);
});

test('run: accanto al .fit scrive il .json col titolo, e fa commit di entrambi', () => {
  const src = tmp(), repo = tmp(); put(src, '20261117-062410-ciclomulino-z2-40.fit', fitBytes()); const g = fakeGit();
  const r = run({ src, repo, state: {}, git: g, titleOf: n => titleFor(n, { plan: { sessions: [{ date: '2026-11-17', title: "Ciclomulino z2 40'" }] } }) });
  assert.equal(r.esito, 'spediti');
  const side = path.join(repo, 'fit', 'inbox', '20261117-062410-ciclomulino-z2-40.json');
  assert.deepEqual(JSON.parse(fs.readFileSync(side, 'utf8')), { title: "Ciclomulino z2 40'" });
});
