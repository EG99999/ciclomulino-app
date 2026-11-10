// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Gatti Elia
// Test di sicurezza: file malevoli o sbagliati non devono bloccare l'app, iniettare codice o mandare watt assurdi al trainer.
import test from 'node:test'; import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { sanitizeSettings, DEFAULTS } from '../js/settings.js';
import { fromBlocks } from '../js/creator.js';
import { parsePlan, LIMITS } from '../js/plan.js';
import { parseTrack, Route } from '../js/route.js';
import { parseIndoorBikeData, parseHeartRate, cmdSetTargetPower, BleTrainer } from '../js/ble.js';
import { check } from '../serve.mjs';

const EVIL = '"><img src=x onerror=alert(1)>';
const dv = a => new DataView(Uint8Array.from(a).buffer);
const ms = f => { const t = performance.now(); f(); return performance.now() - t; };

test('impostazioni importate: nessun testo pericoloso arriva alle schermate', () => {
  const o = JSON.parse(JSON.stringify({ weight: EVIL, ftp: 1e12, vol: 1e9, hrMax: 'x', name: EVIL + 'ok', clientId: EVIL, style: 'pixel2d', planMode: EVIL,
    kit: { jersey: EVIL, jersey2: 'red', text: '<b>"x"</b>', emblem: EVIL, img: 'http://evil.example/p.png', pattern: EVIL, emblemColor: 'url(javascript:1)' },
    bikeColor: { frame: EVIL, accent: '#12345', deep: 99 }, lastPick: { kind: EVIL, route: '../../x', sessId: EVIL, start: -5 }, extra: 1 }));
  const c =sanitizeSettings(JSON.parse('{"__proto__":{"polluted":1},"constructor":{"x":1},"weight":' + JSON.stringify(EVIL) + ',"ftp":1e12,"vol":1e9,"name":' + JSON.stringify(EVIL + 'ok') + ',"style":"pixel2d","extra":1}'));
  assert.equal(c.weight, DEFAULTS.weight); assert.equal(c.ftp, 600); assert.equal(c.vol, 1); assert.equal(c.style, 'voxel'); assert.equal(c.extra, undefined);
  assert.ok(!/[<>"]/.test(c.name)); assert.equal(({}).polluted, undefined); assert.equal(Object.getPrototypeOf(c), Object.prototype);
  const d = sanitizeSettings(o);
  assert.equal(d.weight, DEFAULTS.weight); assert.equal(d.hrMax, DEFAULTS.hrMax); assert.equal(d.clientId, ''); assert.equal(d.planMode, DEFAULTS.planMode);
  assert.equal(d.kit.jersey, DEFAULTS.kit.jersey); assert.equal(d.kit.jersey2, DEFAULTS.kit.jersey2); assert.equal(d.kit.emblemColor, DEFAULTS.kit.emblemColor);
  assert.ok(!/[<>"&]/.test(d.kit.text)); assert.equal(d.kit.emblem, DEFAULTS.kit.emblem); assert.equal(d.kit.pattern, DEFAULTS.kit.pattern); assert.equal(d.kit.img, null);
  assert.equal(d.bikeColor.frame, ''); assert.equal(d.bikeColor.accent, ''); assert.equal(d.bikeColor.deep, 2);     // massimo 2 = «Lenticolare»: la UI lo offre
  assert.equal(d.lastPick.kind, DEFAULTS.lastPick.kind); assert.equal(d.lastPick.route, ''); assert.equal(d.lastPick.sessId, ''); assert.equal(d.lastPick.start, 0);
  // nessuna stringa, in nessun punto, contiene i simboli con cui si chiude un attributo HTML o si apre un tag
  const strings = []; (function walk(v) { if (typeof v === 'string') strings.push(v); else if (v && typeof v === 'object') Object.values(v).forEach(walk); })(d);
  assert.ok(strings.length > 10); for (const s of strings) assert.ok(!/[<>"]/.test(s), 'simboli HTML in: ' + s);
});
test('impostazioni valide passano intatte (anche immagine 10×10 PNG)', () => {
  const ok = { ...DEFAULTS, weight: 72.5, ftp: 271, vol: 0.4, style: 'ps1', name: 'Elia', clientId: '946102aa-63b4-4285-8700-8b6a231c73b0',
    kit: { ...DEFAULTS.kit, jersey: '#ff0000', text: 'ELI', emblem: 'bolt', img: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAFUlEQVR42mNk+M9Qz0AEYBxVSF+FABJADveWkH6oAAAAAElFTkSuQmCC' },
    bikeColor: { frame: '#112233', accent: '', deep: 0 } };
  assert.deepEqual(sanitizeSettings(JSON.parse(JSON.stringify(ok))), ok);
});
test('import impostazioni: i valori mancanti restano quelli attuali (base)', () => {
  const base = { ...DEFAULTS, weight: 80, kit: { ...DEFAULTS.kit, jersey: '#00ff00' } };
  const c = sanitizeSettings({ ftp: 300, kit: { text: 'AB' } }, base);
  assert.equal(c.weight, 80); assert.equal(c.ftp, 300); assert.equal(c.kit.jersey, '#00ff00'); assert.equal(c.kit.text, 'AB');
});

test('workout importato nel creatore: tutto diventa numero/testo controllato', () => {
  const blocks = JSON.parse('[{"t":"zzz","n":"<img onerror=1>","hi":"\\"><x>","lo":100,"rep":"9"},{"rep":1e9,"steps":[{"t":"interval","d":"abc","pct":["\\"><x","1"],"cad":["a","b"],"grade":"x","hrCap":{}}]},null,5,{"t":"interval","dist":"9e99"}]');
  const out = fromBlocks(blocks), flat = JSON.stringify(out);
  assert.ok(!/"><x|<img/.test(flat.replace(/<img onerror=1>/, '')), 'testo pericoloso nei numeri');
  const rep = out.find(n => n.kind === 'rep'); assert.ok(rep.rep >= 1 && rep.rep <= 50);
  const st = rep.steps[0]; for (const k of ['d', 'dist']) assert.ok(Number.isFinite(st[k])); assert.ok(st.pct.every(Number.isFinite)); assert.ok(st.cad.every(Number.isFinite));
  assert.equal(st.grade, null); assert.equal(st.hrCap, null);
  assert.ok(Number.isFinite(out[0].lo) && Number.isFinite(out[0].hi)); assert.equal(out[0].t, 'interval');
  const last = out[out.length - 1]; assert.ok(last.dist <= 1e6);
});
test('creatore: profondità e quantità di step limitate', () => {
  let deep = [{ t: 'interval', d: 60, pct: [0.5, 0.6] }]; for (let i = 0; i < 40; i++) deep = [{ rep: 2, steps: deep }];
  assert.ok(JSON.stringify(fromBlocks(deep)).length < 2000, 'annidamento senza limite');
  const many = Array.from({ length: 20000 }, () => ({ t: 'interval', d: 60, pct: [0.5, 0.6] })); assert.ok(fromBlocks(many).length <= 500);
});

test('piano: un file con ripetizioni enormi non blocca il browser', () => {
  const t0 = performance.now();
  const r = parsePlan({ ftp: 271, sessions: [{ id: 'a', title: 'x', blocks: [{ rep: 1e8, steps: [{ t: 'interval', d: 60, pct: [0.9, 1] }] }] }] });
  assert.equal(r.sessions.length, 0); assert.ok(r.errors.length); assert.ok(performance.now() - t0 < 500);
  const nest = { t: 'interval', d: 1, pct: [0.5, 0.6] }; let b = [nest]; for (let i = 0; i < 4; i++) b = [{ rep: 200, steps: b }];
  const t1 = performance.now(); const r2 = parsePlan({ ftp: 271, sessions: [{ id: 'b', title: 'y', blocks: b }] });
  assert.ok(performance.now() - t1 < 1000, 'tempo di lettura'); assert.equal(r2.sessions.length, 0); assert.match(r2.errors.join(' '), /più di|troppe|troppi/);
  let empty = []; for (let i = 0; i < 6; i++) empty = [{ rep: 200, steps: empty.length ? empty : [{ rep: 1, steps: [] }] }];
  const t2 = performance.now(); parsePlan({ ftp: 271, sessions: [{ id: 'c', title: 'z', blocks: empty }] }); assert.ok(performance.now() - t2 < 1000, 'cicli a vuoto');
});
test('piano: watt assurdi (refuso % al posto di frazione) vengono rifiutati, non mandati al trainer', () => {
  const r = parsePlan({ ftp: 271, sessions: [{ id: 'a', title: 'x', blocks: [{ t: 'interval', d: 60, pct: [50, 60] }, { t: 'interval', d: 60, lo: 100, hi: 5000 }, { t: 'interval', d: 60, pct: [0.9, 1.0] }] }] });
  assert.equal(r.sessions[0].steps.length, 1); assert.equal(r.errors.filter(e => /watt fuori limite/.test(e)).length, 2);
  for (const s of r.sessions[0].steps) assert.ok(s.hi <= Math.min(LIMITS.maxW, 271 * LIMITS.ftpMul));
});
test('piano: titoli, id, note e tipi strani diventano testo semplice; FTP assurda ignorata', () => {
  const r = parsePlan({ ftp: 0.001, sessions: [{ id: 5, title: { a: 1 }, type: ['x'], date: '"><x>', time: 99, notes: 'riga1\nriga2\u0000<b>', blocks: [{ t: 'interval', n: 5, d: 60, lo: 100, hi: 120 }], test: { kind: '<x>', testStep: 7 } }] });
  const s = r.sessions[0]; assert.equal(r.ftp, 271); assert.equal(typeof s.id, 'string'); assert.equal(typeof s.title, 'string'); assert.equal(typeof s.type, 'string');
  assert.equal(s.date, null); assert.equal(s.time, null); assert.ok(s.notes.includes('\n') && !s.notes.includes('\u0000')); assert.equal(typeof s.steps[0].n, 'string'); assert.equal(s.test.kind, null);
  assert.ok(s.title.toUpperCase && s.steps[0].n.toUpperCase);
});
test('il piano di esempio resta valido', () => { assert.ok(parsePlan(readFileSync(new URL('../piano-app.example.json', import.meta.url), 'utf8')).ok); });

test('GPX: un file con migliaia di punti senza chiusura si legge in tempo lineare', () => {
  const huge = '<gpx>' + '<trkpt lat="45.1" lon="9.9">'.repeat(150000);
  const t = ms(() => { const r = parseTrack(huge); assert.ok(r.pts.length <= 200000); });
  assert.ok(t < 1500, 'troppo lento: ' + Math.round(t) + ' ms');
});
test('GPX: coordinate fuori dal globo scartate, percorso troppo lungo rifiutato', () => {
  assert.equal(parseTrack('<trkpt lat="95" lon="9"><ele>1</ele></trkpt><trkpt lat="45" lon="181"/>').pts.length, 0);
  assert.equal(parseTrack('<trkpt lat="45.1" lon="9.9"><ele>120.5</ele></trkpt>').pts[0][2], 120.5);
  const zig = []; for (let i = 0; i < 13; i++) zig.push(i % 2 ? [-60, 150, 0] : [60, -150, 0]);
  assert.throws(() => new Route({ id: 'x', name: 'x', pts: zig }), /troppo lungo/);
});

test('Bluetooth: pacchetti troppo corti non lanciano errori; watt sempre dentro limiti sicuri', () => {
  assert.doesNotThrow(() => parseIndoorBikeData(dv([0x44]))); assert.equal(parseHeartRate(dv([])), 0); assert.equal(parseHeartRate(dv([0x01, 0x2c])), 0);
  assert.equal(parseIndoorBikeData(dv([0x44, 0x00, 0xb8])).power, null);
  assert.deepEqual([...new Uint8Array(cmdSetTargetPower(70000))], [0x05, 0xff, 0x7f]);   // niente giro a vuoto: 70000 non diventa 4464
  assert.deepEqual([...new Uint8Array(cmdSetTargetPower(NaN))], [0x05, 0x00, 0x00]);
  const t = new BleTrainer(), sent = []; t.connected = true; t._write = b => sent.push(new DataView(b).getInt16(1, true));
  t.setTargetPower(14900); t.lastW = null; t.setTargetPower(NaN); t.lastW = null; t.setTargetPower(-40); t.lastW = null; t.range = { min: 50, max: 1200 }; t.setTargetPower(3000);
  assert.deepEqual(sent, [2000, 50, 0, 1200]);
});

test('service worker: tocca solo i file del sito (mai Microsoft, mai indirizzi con parametri); fallback pagina solo per le navigazioni', async () => {
  const handlers = {}, inits = [];
  const self = { location: { origin: 'https://eg99999.github.io' }, addEventListener: (t, f) => { handlers[t] = f; }, skipWaiting() { }, clients: { claim() { } } };
  const caches = { open: async () => ({ addAll: async () => { }, put: async () => { } }), keys: async () => [], delete: async () => { }, match: async k => (k === 'index.html' ? 'PAGINA' : undefined) };
  const fetchFn = async (req, init) => { inits.push(init); throw new Error('offline'); };
  new Function('self', 'caches', 'fetch', 'Response', readFileSync(new URL('../sw.js', import.meta.url), 'utf8'))(self, caches, fetchFn, { error: () => 'ERRORE' });
  const run = async (url, mode = 'no-cors', method = 'GET') => { let p = null; handlers.fetch({ request: { url, method, mode }, respondWith: x => { p = x; } }); return p ? await p : undefined; };
  assert.equal(await run('https://graph.microsoft.com/v1.0/me'), undefined);                       // altro sito: non lo vede nemmeno
  assert.equal(await run('https://login.microsoftonline.com/consumers/oauth2/v2.0/token', 'cors', 'POST'), undefined);
  assert.equal(await run('https://eg99999.github.io/ciclomulino-app/?code=abc&state=xyz', 'navigate'), undefined);   // codice di accesso mai in cache
  assert.equal(await run('https://eg99999.github.io/ciclomulino-app/js/main.js?x=1'), undefined);
  assert.equal(await run('https://eg99999.github.io/ciclomulino-app/js/main.js'), 'ERRORE');         // offline e non in cache: errore, non la home al posto del file
  assert.equal(await run('https://eg99999.github.io/ciclomulino-app/', 'navigate'), 'PAGINA');        // offline: la pagina principale
  assert.deepEqual(inits.at(-1), { cache: 'no-cache' });                                              // ricontrolla sempre: gli aggiornamenti arrivano subito
});
test('server locale: solo i file del sito, solo da localhost, nessun percorso fuori cartella', () => {
  const H = 'localhost:8080';
  for (const p of ['/', '/index.html', '/js/main.js', '/css/game.css', '/routes/giro-iseo.json', '/icons/icon-192.png', '/sw.js', '/manifest.webmanifest', '/js/vendor/three.min.js']) assert.ok(check(H, 'GET', p).file, p);
  for (const p of ['/CLAUDE.md', '/SPEC.md', '/.git/config', '/piano-app.json', '/test/ble.test.js', '/node_modules/x.js', '/js/../CLAUDE.md', '/%2e%2e/CLAUDE.md', '/js/..%5c..%5cCLAUDE.md', '/js/%00.js', '/C:/Windows/win.ini', '//etc/passwd', '/js/', '/.env'])
    assert.equal(check(H, 'GET', p).status, 403, p);
  assert.equal(check('evil.example.com:8080', 'GET', '/index.html').status, 421); assert.equal(check('localhost:9999', 'GET', '/').status, 421); assert.equal(check(undefined, 'GET', '/').status, 421);
  assert.equal(check('127.0.0.1:8080', 'HEAD', '/').file !== undefined, true); assert.equal(check(H, 'POST', '/').status, 405); assert.equal(check(H, 'GET', '/%E0%A4%A').status, 400);
});

test('nessuna richiesta a terzi: la pagina non carica nulla da fuori e ogni file del service worker esiste', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.deepEqual(html.match(/\b(?:src|href)=["']https?:\/\/[^"']+/g) || [], [], 'nessun script/css/font da altri siti');
  const csp = html.match(/Content-Security-Policy" content="([^"]+)"/)[1];
  assert.match(csp, /font-src 'self';/); assert.ok(!/googleapis|gstatic/.test(csp)); assert.match(csp, /script-src 'self';/);
  const css = readFileSync(new URL('../css/fonts.css', import.meta.url), 'utf8');
  assert.ok(!/url\(\s*["']?https?:/.test(css), 'i font sono locali');
  const sw = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
  const shell = [...sw.match(/const SHELL = \[([\s\S]*?)\];/)[1].matchAll(/'([^']+)'/g)].map(m => m[1]).filter(f => f !== './');
  for (const f of shell) assert.ok(check('localhost:8080', 'GET', '/' + f).file && existsSync(new URL('../' + f, import.meta.url)), f + ' manca o il server non lo serve');
  for (const f of css.matchAll(/url\(\.\.\/([^)]+)\)/g)) assert.ok(shell.includes(f[1]), f[1] + ' non è nel service worker');
});
