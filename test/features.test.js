import test from 'node:test'; import assert from 'node:assert/strict';
import { parseCsc, WheelSpeed, parseIndoorBikeData } from '../js/ble.js';
import { FIELDS, FIELD_IDS, DEFAULT_PAGES, parsePages, serializePages, cleanPages, readFields, CycloTracker } from '../js/computer.js';
import { sanitizeSettings, DEFAULTS, settingsPayload, SYNC_SKIP } from '../js/settings.js';
import { StateSync, MAX_ROUTES } from '../js/sync.js';
import { cleanRide, mergeHistory, loadHistory } from '../js/history.js';

const dv = (...b) => new DataView(Uint8Array.from(b).buffer);
const u16 = n => [n & 255, n >> 8 & 255], u32 = n => [n & 255, n >> 8 & 255, n >> 16 & 255, n >>> 24 & 255];

/* ---- velocità reale dai giri ruota ---- */
test('CSC: legge giri ruota e pedivella; pacchetti corti non lanciano errori', () => {
  assert.deepEqual(parseCsc(dv(0x01, ...u32(1000), ...u16(2048))), { wheelRevs: 1000, wheelTime: 2048, crankRevs: null, crankTime: null });
  assert.deepEqual(parseCsc(dv(0x03, ...u32(5), ...u16(100), ...u16(7), ...u16(900))), { wheelRevs: 5, wheelTime: 100, crankRevs: 7, crankTime: 900 });
  assert.equal(parseCsc(dv(0x01, 1, 2)).wheelRevs, null); assert.equal(parseCsc(dv()).wheelRevs, null);
});
test('velocità dalla ruota: giri × circonferenza ÷ tempo (2136 mm: 2 giri in mezzo secondo = 30,8 km/h)', () => {
  const w = new WheelSpeed(); assert.equal(w.push(100, 1000, 2.136, 0), null);
  const k = w.push(102, 1000 + 512, 2.136, 500); assert.ok(Math.abs(k - 2 * 2.136 / 0.5 * 3.6) < 0.01, 'k=' + k);
  const k2 = new WheelSpeed(); k2.push(10, 0, 2.0, 0); assert.ok(Math.abs(k2.push(11, 1024, 2.0, 1000) - 7.2) < 0.01, 'un giro al secondo su 2 m = 7,2 km/h');
});
test('velocità dalla ruota: ritorno a zero dei contatori, ruota ferma, valori assurdi e circonferenza non valida', () => {
  const w = new WheelSpeed(); w.push(65534, 65500, 2.1, 0);   // il tempo (16 bit) ricomincia da zero: 136 tick = 0,133 s
  const k = w.push(65535, 100, 2.1, 100); assert.ok(Math.abs(k - 2.1 / (136 / 1024) * 3.6) < 0.05);
  assert.equal(w.push(65535, 100, 2.1, 3000), 0, 'dopo 3 s senza giri la velocità è zero');
  const x = new WheelSpeed(); x.push(0, 0, 2.1, 0); x.push(5, 10, 2.1, 10); assert.ok(x.kmh == null || x.kmh < 120, 'salto assurdo ignorato');
  const y = new WheelSpeed(); assert.equal(y.push(1, 1, 0, 0), null); assert.equal(y.push(1, 1, 99, 0), null);
});
test('FTMS: la velocità del trainer resta disponibile come ripiego', () => { assert.equal(parseIndoorBikeData(dv(0x44, 0x00, ...u16(3000), ...u16(180), ...u16(150))).speed, 30); });

/* ---- ciclocomputer ---- */
test('ciclocomputer: pagine valide, 4-6 campi, niente nomi inventati né chiavi di sistema', () => {
  assert.deepEqual(parsePages(DEFAULT_PAGES).map(p => p.length), [4, 4, 4]);
  assert.equal(parsePages('kmh,w,cad,hr,w3,wkg,time,dist')[0].length, 6);
  assert.deepEqual(parsePages('kmh,w'), [['kmh', 'w', 'cad', 'hr']]);
  for (const bad of ['constructor,__proto__,toString', '<script>,x', '', null, undefined, 42, '||||']) { const p = parsePages(bad); assert.ok(p.length >= 1 && p.every(r => r.length >= 4 && r.length <= 6 && r.every(id => FIELD_IDS.includes(id)))); }
  assert.equal(parsePages(Array(20).fill('w,cad,hr,kmh').join('|')).length, 6);
  assert.equal(cleanPages(serializePages(parsePages(DEFAULT_PAGES))), DEFAULT_PAGES);
});
test('ciclocomputer: i valori mancanti non mostrano NaN e le unità sono giuste', () => {
  const r = readFields(['kmh', 'kmhR', 'w', 'hr', 'time', 'dist', 'wkg', 'np'], { kmh: 34.46, kmhReal: null, w: 251.6, hr: null, time: 3725, dist: 12345, wkg: 0, np: NaN });
  assert.deepEqual(r.map(x => x.value), ['34.5', '--', '252', '--', '1:02:05', '12.35', '--', '--']);
  for (const id of FIELD_IDS) assert.ok(!/NaN|undefined/.test(FIELDS[id].get({})), id);
});
test('ciclocomputer: media 10", massima e ripartenza con una nuova seduta', () => {
  const t = new CycloTracker(), s1 = {}, s2 = {};
  for (let i = 0; i <= 20; i++) t.update(i, i < 10 ? 100 : 200, 20 + i, [], s1);
  assert.ok(t.avg10 > 190 && t.avg10 <= 200, 'media 10": ' + t.avg10); assert.equal(t.maxKmh, 40);
  t.update(21, 50, 10, [], s2); assert.equal(t.maxKmh, 10, 'nuova seduta = si riparte da zero');
});

/* ---- impostazioni: ruota e ciclocomputer ---- */
test('impostazioni: ruota di serie 700x28C = 2136 mm, limiti e pagine del ciclocomputer ripulite', () => {
  assert.equal(DEFAULTS.wheelMm, 2136); assert.equal(sanitizeSettings({}).wheelMm, 2136);
  assert.equal(sanitizeSettings({ wheelMm: 50 }).wheelMm, 1000); assert.equal(sanitizeSettings({ wheelMm: 1e9 }).wheelMm, 2600); assert.equal(sanitizeSettings({ wheelMm: 'x' }).wheelMm, 2136);
  const s = sanitizeSettings({ ccPages: '<img src=x>,kmh|constructor,w,cad,hr', ccCorner: 'si', ccBar: false });
  assert.deepEqual(s.ccPages.split('|').map(p => p.split(',').every(id => FIELD_IDS.includes(id))), [true, true]); assert.equal(s.ccCorner, true); assert.equal(s.ccBar, false);
  assert.equal(sanitizeSettings({ ccPages: 'w,'.repeat(500) }).ccPages, DEFAULTS.ccPages);
});
test('sincronizzazione: le impostazioni proprie del PC non partono (token, cartella, volume, grafica…)', () => {
  const p = settingsPayload({ ...DEFAULTS, clientId: '946102aa-63b4-4285-8700-8b6a231c73b0', cloud: true, vol: 0.2, quality: 1 });
  for (const k of SYNC_SKIP) assert.ok(!(k in p), k); assert.ok('weight' in p && 'bike' in p && 'ccPages' in p && 'wheelMm' in p && 'kit' in p);
});

/* ---- sincronizzazione tra PC con uno "OneDrive" finto in memoria ---- */
const memStore = () => { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) }; };
function fakeCloud() {
  const files = new Map();
  return {
    files, async readJson(p) { const f = files.get(p); return f ? JSON.parse(f) : null; }, async writeJson(p, o) { files.set(p, JSON.stringify(o)); },
    od: { async list(folder) { return [...files].filter(([k]) => k.startsWith(folder + '/')).map(([k, v]) => ({ name: k.slice(folder.length + 1), size: v.length })); }, async readText(p) { return files.get(p); } }
  };
}
function pc(cloud, { settings = { ...DEFAULTS }, routes = [], busy = false } = {}) {
  const storage = memStore(), t = { now: 1000 }, me = { S: settings, routes, applied: 0, busy, storage, t };
  me.sync = new StateSync({ cloud, storage, getSettings: () => me.S, applyRemote: n => { me.S = { ...me.S, ...n }; me.applied++; }, getRoutes: () => me.routes, addRoutes: l => { me.routes.push(...l); }, validateRoute: j => { if (!Array.isArray(j.pts) || !j.pts.length) throw new Error('vuoto'); }, busy: () => me.busy, now: () => me.t.now });
  me.touch = () => { me.t.now += 1000; me.sync.touch(); };
  return me;
}
const route = id => ({ id, name: id, pts: [[45, 10, 100], [45.01, 10, 101]] });
const ride = (id, when) => ({ id, when, title: 'Seduta ' + id, durS: 3600, km: 30, avgP: 200, np: 210, maxP: 500, kj: 700, hr: 140, wkg: 2.9, ftp: 271, fit: '', done: '', mode: 'plan', type: '' });
let clock = 1e12;                                                  // orologio comune dei due PC finti: ogni modifica è più recente della precedente
const tick = (...pcs) => { clock += 1000; for (const p of pcs) p.t.now = clock; };

test('sync: il primo PC carica impostazioni, storico e percorsi; il secondo li riceve e non cancella niente', async () => {
  const cloud = fakeCloud(), a = pc(cloud, { settings: { ...DEFAULTS, weight: 72, ftp: 280, ccPages: 'w,cad,hr,kmh' }, routes: [route('gpx-uno')] }), b = pc(cloud, { settings: { ...DEFAULTS, weight: 0 } });
  a.storage.setItem('ciclomulino.history', JSON.stringify([ride('r1', 5), ride('r2', 9)])); tick(a, b); a.sync.touch();
  assert.equal((await a.sync.run()).settings, 'caricate');
  assert.ok(cloud.files.has('impostazioni.json') && cloud.files.has('storico.json') && cloud.files.has('percorsi/gpx-uno.json'));
  const rem = JSON.parse(cloud.files.get('impostazioni.json')); assert.equal(rem.settings.weight, 72); assert.ok(!('clientId' in rem.settings) && !('cloud' in rem.settings));
  tick(a, b); b.sync.touch();                                       // il PC nuovo ha già toccato le sue impostazioni (più recenti), ma adotta quelle del cloud
  const out = await b.sync.run();
  assert.equal(out.settings, 'scaricate'); assert.equal(b.S.weight, 72); assert.equal(b.S.ftp, 280); assert.equal(out.rides, 2); assert.equal(out.routes, 1);
  assert.deepEqual(loadHistory(b.storage).map(r => r.id), ['r2', 'r1']); assert.equal(b.routes[0].id, 'gpx-uno');
});
test('sync: dopo il primo accesso vince l\'ultima modifica, nei due sensi', async () => {
  const cloud = fakeCloud(), a = pc(cloud, { settings: { ...DEFAULTS, weight: 70 } }), b = pc(cloud);
  tick(a, b); a.sync.touch(); await a.sync.run(); await b.sync.run(); assert.equal(b.S.weight, 70);
  b.S = { ...b.S, weight: 68 }; tick(a, b); b.sync.touch(); assert.equal((await b.sync.run()).settings, 'caricate');
  assert.equal((await a.sync.run()).settings, 'scaricate'); assert.equal(a.S.weight, 68);
  assert.equal((await a.sync.run()).settings, 'uguali');
});
test('sync: gli storici si uniscono senza perdere sedute di nessun PC', async () => {
  const cloud = fakeCloud(), a = pc(cloud), b = pc(cloud); tick(a, b); a.sync.touch(); await a.sync.run(); await b.sync.run();
  a.storage.setItem('ciclomulino.history', JSON.stringify([ride('a1', 100)])); b.storage.setItem('ciclomulino.history', JSON.stringify([ride('b1', 200)]));
  await a.sync.run(); await b.sync.run(); await a.sync.run();
  assert.deepEqual(loadHistory(a.storage).map(r => r.id), ['b1', 'a1']); assert.deepEqual(loadHistory(b.storage).map(r => r.id), ['b1', 'a1']); assert.equal(JSON.parse(cloud.files.get('storico.json')).length, 2);
});
test('sync: durante una seduta non cambia niente; dopo sì', async () => {
  const cloud = fakeCloud(), a = pc(cloud, { settings: { ...DEFAULTS, weight: 70 } }); tick(a); a.sync.touch(); await a.sync.run();
  const b = pc(cloud, { busy: true }); await b.sync.run(); assert.equal(b.applied, 0); assert.equal(b.routes.length, 0);
  b.busy = false; await b.sync.run(); assert.equal(b.applied, 1); assert.equal(b.S.weight, 70);
});
test('sync: ciò che arriva da OneDrive è non fidato (impostazioni, storico, percorsi)', async () => {
  const cloud = fakeCloud();
  cloud.files.set('impostazioni.json', JSON.stringify({ v: 1, mod: 5e12, settings: { name: '<img src=x onerror=alert(1)>', weight: 'pesante', bike: '"><script>', wheelMm: -5, ccPages: 'constructor,w', clientId: 'ruba-token', cloud: true } }));
  cloud.files.set('storico.json', JSON.stringify([{ id: '<b>x</b>', when: 1, title: '<script>alert(1)</script>', km: 'molto', avgP: 1e99 }, 'testo', null, { when: 'ieri' }]));
  cloud.files.set('percorsi/evil.json', JSON.stringify({ id: '"><img src=x onerror=alert(1)>', name: 'x', pts: [[1, 1, 1]] }));
  cloud.files.set('percorsi/ok.json', JSON.stringify(route('gpx-ok'))); cloud.files.set('percorsi/doppio.json', JSON.stringify(route('gpx-ok')));
  cloud.files.set('percorsi/vuoto.json', JSON.stringify({ id: 'gpx-vuoto', name: 'v', pts: [] })); cloud.files.set('percorsi/rotto.json', '{non è json');
  const a = pc(cloud, { settings: { ...DEFAULTS, clientId: '946102aa-63b4-4285-8700-8b6a231c73b0' } }); await a.sync.run();
  assert.ok(!/[<>"]/.test(a.S.name), 'nome pulito'); assert.equal(a.S.weight, 0); assert.equal(a.S.wheelMm, 1000); assert.equal(a.S.clientId, '946102aa-63b4-4285-8700-8b6a231c73b0', 'il Client ID non si cambia dal cloud'); assert.equal(a.S.cloud, false);
  assert.ok(loadHistory(a.storage).every(r => !/[<>"'&]/.test(r.id + r.title + r.type + r.fit + r.done)), 'storico pulito'); assert.ok(loadHistory(a.storage).every(r => Number.isFinite(r.km) && r.avgP <= 5000));
  assert.deepEqual(a.routes.map(r => r.id), ['gpx-ok'], 'solo il percorso valido con id semplice, senza doppioni');
});
test('sync: massimo 6 percorsi e file troppo grandi ignorati', async () => {
  const cloud = fakeCloud(); for (let i = 0; i < 10; i++) cloud.files.set(`percorsi/p${i}.json`, JSON.stringify(route('gpx-p' + i)));
  cloud.files.set('percorsi/gigante.json', JSON.stringify({ ...route('gpx-gigante'), note: 'x'.repeat(3_100_000) }));
  const a = pc(cloud); await a.sync.run(); assert.equal(a.routes.length, MAX_ROUTES); assert.ok(!a.routes.some(r => r.id === 'gpx-gigante'));
});
test('storico: unione per id, campi ripuliti, al massimo 300', () => {
  assert.equal(cleanRide({ when: 'x' }), null); assert.equal(cleanRide(null), null); assert.equal(cleanRide({ when: 5, mode: 'hack' }).mode, 'plan');
  const many = Array.from({ length: 400 }, (_, i) => ride('m' + i, i + 1)); assert.equal(mergeHistory(many, many).length, 300); assert.equal(mergeHistory(many, many)[0].id, 'm399');
});
