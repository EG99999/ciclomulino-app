// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Gatti Elia
// Seconda parte delle prove sui difetti della revisione di sicurezza del 9 nov 2026: OneDrive, cartella, storico, redazione del log.
import test from 'node:test'; import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { OneDrive, CloudSync } from '../js/onedrive.js';
import { readFile, FolderSync, pruneFiles } from '../js/folder.js';
import { loadHistory, cleanRide } from '../js/history.js';
import { parsePlan, validSession } from '../js/plan.js';
import { redact, redactUrl, Recorder, folderSink } from '../js/debug.js';

const mkStorage = () => { const m = new Map(); return { m, getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }; };
const signedIn = (fetchFn, st = mkStorage()) => { const od = new OneDrive({ clientId: 'CID', redirectUri: 'http://localhost:8080/', storage: st, session: mkStorage(), fetchFn }); od.tok = { access: 'A', exp: Date.now() + 1e7, refresh: 'R' }; return { od, st }; };

/* ---------- OneDrive ---------- */
test('OneDrive: i percorsi «.», «..» e vuoti vengono rifiutati prima di qualunque richiesta; i nomi dei workout hanno un solo criterio', async () => {
  const urls = []; const { od } = signedIn(async u => { urls.push(String(u)); return { ok: true, status: 200, json: async () => ({ value: [] }), text: async () => '' }; });
  for (const p of ['..', '.', 'fit/../../x', 'a//b', '']) await assert.rejects(async () => od.meta(p), /non valido/, 'percorso «' + p + '»');
  await assert.rejects(async () => od.list('workouts/..'), /non valido/); assert.equal(urls.length, 0, 'nessuna richiesta partita');
  const cs = new CloudSync(od, { storage: mkStorage(), onPlan() { }, onWorkouts() { } });
  assert.throws(() => cs.removeWorkout('..'), /non valido/); assert.throws(() => cs.removeWorkout('.'), /non valido/); assert.throws(() => cs.pushWorkout('..', '{}'), /non valido/);
  await cs.removeWorkout('a/b..json'); assert.match(urls.at(-1), /workouts\/a_b\.\.json$/, urls.at(-1));
  await cs.pushWorkout('mio x/ç.json', '{}'); assert.match(urls.at(-1), /workouts\/mio%20x_\.json:\/content$/, urls.at(-1));
  await od.meta('piano-app.json'); assert.match(urls.at(-1), /approot:\/piano-app\.json$/);
});

test('OneDrive: «Esci» premuto mentre il token si rinnova non lascia l\'utente collegato', async () => {
  let release; const st = mkStorage();
  const fetchFn = () => new Promise(res => { release = () => res({ ok: true, status: 200, json: async () => ({ access_token: 'NUOVO', refresh_token: 'RNUOVO', expires_in: 3600 }) }); });
  const { od } = signedIn(fetchFn, st); od.tok = { access: 'old', exp: 0, refresh: 'R', account: 'x' }; od._save();
  const p = od.accessToken(); const guard = p.catch(e => e);
  await new Promise(r => setTimeout(r, 5)); od.logout(); release();
  const e = await guard; assert.match(String(e.message), /annullato/);
  assert.equal(od.signedIn, false); assert.equal(st.getItem('ciclomulino.ms'), null, 'i token non vengono risalvati');
});

test('OneDrive: piano e workout troppo grandi o troppo numerosi non vengono letti', async () => {
  let reads = 0, plan = false; const files = Array.from({ length: 150 }, (_, i) => ({ name: 'w' + i + '.json', eTag: 'e' + i, size: 1000 })).concat([{ name: 'enorme.json', eTag: 'x', size: 900000 }]);
  const od = { meta: async () => ({ eTag: 'e', size: 3_000_000 }), list: async () => files, readText: async () => { reads++; return '{}'; } };
  let status = ''; const cs = new CloudSync(od, { storage: mkStorage(), onPlan: () => { plan = true; }, onWorkouts: items => { assert.ok(items.length <= 100); }, status: s => { status = s; } });
  await cs.pull(true); assert.equal(plan, false, 'piano da 3 MB ignorato'); assert.equal(reads, 100, 'letti al massimo 100 workout, e non quello da 900 KB');
});

test('OneDrive: un errore nell\'indirizzo confezionato da altri non diventa un messaggio; con un accesso in corso compaiono solo frasi fisse', async () => {
  const { od } = signedIn(async () => ({ ok: true, status: 200, json: async () => ({}) }));
  assert.equal(await od.handleRedirect('http://localhost:8080/?error=x&error_description=' + encodeURIComponent('Account sospeso: chiama il 800 123 456')), null);
  const state = new URL(await od.loginUrl()).searchParams.get('state');
  assert.equal(await od.handleRedirect('http://localhost:8080/?error=server_error&state=' + state + '&error_description=' + encodeURIComponent('chiama il 800')), 'errore:accesso non riuscito');
});

/* ---------- cartella dati ---------- */
function fakeFs(files) {
  const entry = (p) => ({ async getFile() { const v = files.get(p); return { size: v.length, lastModified: 1, async text() { return v; } }; }, async createWritable() { let buf = ''; return { async write(x) { buf += x; }, async close() { files.set(p, buf); } }; } });
  const dir = prefix => ({
    async getDirectoryHandle(name) { return dir(prefix + name + '/'); },
    async *entries() { for (const [p, v] of [...files]) if (p.startsWith(prefix) && !p.slice(prefix.length).includes('/')) yield [p.slice(prefix.length), { kind: 'file', getFile: entry(p).getFile }]; },
    async getFileHandle(name, o) { const p = prefix + name; if (!files.has(p)) { if (!(o && o.create)) throw Object.assign(new Error('nf'), { name: 'NotFoundError' }); files.set(p, ''); } return entry(p); },
    async removeEntry(name) { const p = prefix + name; if (!files.has(p)) throw Object.assign(new Error('nf'), { name: 'NotFoundError' }); files.delete(p); }
  });
  return dir('');
}
const ride = (id, when) => ({ id, when, title: 't' + id, type: '', mode: 'plan', durS: 60, km: 1, avgP: 100, np: 100, maxP: 200, kj: 10, hr: 100, wkg: null, ftp: 271, fit: '', done: '' });

test('cartella dati: un file troppo grande si controlla prima di leggerlo; lo storico nel file si unisce, non si cancella', async () => {
  const files = new Map([['piano-app.json', 'x'.repeat(2_100_000)], ['storico.json', JSON.stringify([ride('altro-pc', 1700000000000)])]]); const h = fakeFs(files);
  await assert.rejects(() => readFile(h, 'piano-app.json', 100), e => e.tooBig === true);
  let got = null, st = ''; const fs = new FolderSync(h, { storage: mkStorage(), onPlan: t => { got = t; }, onWorkouts() { }, status: s => { st = s; } });
  await fs.pull(true); assert.equal(got, null); assert.match(st, /troppo grande/);
  await fs.pushHistory(JSON.stringify([ride('questo-pc', 1700000100000)]));
  const merged = JSON.parse(files.get('storico.json')); assert.deepEqual(merged.map(r => r.id).sort(), ['altro-pc', 'questo-pc']);
  files.set('storico.json', 'non è json'); await fs.pushHistory(JSON.stringify([ride('solo', 1700000200000)])); assert.deepEqual(JSON.parse(files.get('storico.json')).map(r => r.id), ['solo'], 'file illeggibile: si scrive quello locale');
  await assert.rejects(async () => fs.removeWorkout('..'), /non valido/);
});

test('debug nella cartella: serve il secondo consenso e restano gli ultimi 10 file, senza toccare altro', async () => {
  const files = new Map(); for (let i = 1; i <= 12; i++) files.set(`debug/ot-2026-11-${String(i).padStart(2, '0')}_100000-ab.jsonl`, 'x'); files.set('debug/note.txt', 'mie note'); files.set('debug/ot-strano.jsonl', 'y'); files.set('fit/a.fit', 'z');
  const h = fakeFs(files);
  const n = await pruneFiles(h, 'debug', /^ot-\d{4}-\d\d-\d\d_\d{6}-[a-z0-9]+\.jsonl$/, 10);
  assert.equal(n, 2); assert.ok(!files.has('debug/ot-2026-11-01_100000-ab.jsonl') && !files.has('debug/ot-2026-11-02_100000-ab.jsonl') && files.has('debug/ot-2026-11-03_100000-ab.jsonl'));
  assert.ok(files.has('debug/note.txt') && files.has('debug/ot-strano.jsonl') && files.has('fit/a.fit'), 'i file non nostri restano');
  let on = false, appended = 0, pruned = 0; const s = folderSink(() => h, async () => true, async () => { appended++; }, { enabled: () => on, prune: async () => { pruned++; } });
  assert.equal(await s.write(['a'], { runId: 'R', first: true }), false); assert.equal(appended, 0, 'spento: non scrive nulla');
  on = true; await s.write(['a'], { runId: 'R', first: true }); await s.write(['b'], { runId: 'R', first: false }); assert.equal(appended, 2); assert.equal(pruned, 1, 'la rotazione parte solo alla prima scrittura di ogni registrazione');
});

/* ---------- storico e seduta ripristinata ---------- */
test('storico nel localStorage alterato: non lancia, i numeri tornano numeri e i testi senza HTML', () => {
  const st = mkStorage();
  st.setItem('ciclomulino.history', '{"a":1}'); assert.deepEqual(loadHistory(st), []);
  st.setItem('ciclomulino.history', 'non json'); assert.deepEqual(loadHistory(st), []);
  st.setItem('ciclomulino.history', JSON.stringify([{ id: 'x', when: 1700000000000, title: '<img src=x onerror=alert(1)>', km: '<b>9</b>', avgP: { a: 1 }, np: [1], kj: 'zz', durS: null }, null, 5, { when: 'ieri' }]));
  const h = loadHistory(st); assert.equal(h.length, 1); assert.ok(!/[<>]/.test(h[0].title)); for (const k of ['km', 'avgP', 'np', 'kj', 'durS']) assert.equal(typeof h[0][k], 'number', k);
});

test('seduta da ripristinare: un piano alterato nel localStorage (5000 W, step a zero, tipi finti) viene scartato', () => {
  const r = parsePlan(readFileSync(new URL('../piano-app.example.json', import.meta.url), 'utf8')), ok = r.sessions[0];
  assert.equal(validSession(ok, r.ftp), true);
  const bad = f => { const c = JSON.parse(JSON.stringify(ok)); f(c); return validSession(c, r.ftp); };
  assert.equal(bad(c => { c.steps[0].hi = 5000; }), false); assert.equal(bad(c => { c.steps[1].d = -5; }), false); assert.equal(bad(c => { c.steps = []; }), false);
  assert.equal(bad(c => { c.steps[0].t = 'zzz'; }), false); assert.equal(bad(c => { c.steps[0].d = null; c.steps[0].dist = null; }), false); assert.equal(bad(c => { c.steps = Array.from({ length: 6000 }, () => c.steps[0]); }), false);
  assert.equal(validSession(null), false); assert.equal(validSession({ steps: 'x' }), false);
});

/* ---------- redazione del log ---------- */
test('log: token con simboli, chiavi in camelCase, email di accesso e indirizzi data:/blob: non passano', () => {
  const raw = JSON.stringify({ a: 'refresh_token=M.R3_BAY*ef!ghIJKLMN$op%2Bqrst&x=1', b: 'accessToken: abcdef123456', c: 'login_hint=mario@example.org&z=2', d: 'Authorization: Basic dXNlcjpwYXNz', e: 'sessionId=ZZZZZZ12 e api_key=KKKKKK99' });
  const out = redact(raw);
  for (const s of ['M.R3_BAY', 'ghIJKLMN', 'abcdef123456', 'mario@example.org', 'dXNlcjpwYXNz', 'ZZZZZZ12', 'KKKKKK99', '%2Bqrst']) assert.ok(!out.includes(s), 'non deve restare «' + s + '» in: ' + out);
  assert.equal(redactUrl('data:image/png;base64,AAAA'), 'data:[omesso]'); assert.equal(redactUrl('blob:https://x.test/uuid-1234'), 'blob:[omesso]');
  assert.equal(redactUrl('https://x.test/a;jsessionid=SECRET123/b?c=1'), 'https://x.test/a/b?…');
  const r = new Recorder({ now: () => 0, perSec: 1e9 }); r.start(); r.log('t', { m: 'ab '.repeat(150) + 'access_token=SEGRETO123456 ' + 'cd '.repeat(100) }); assert.ok(!r.text().includes('SEGRETO123456'));
});
