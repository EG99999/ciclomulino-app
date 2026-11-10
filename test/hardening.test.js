// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Gatti Elia
// Prove dei difetti trovati dalla revisione di sicurezza del 9 nov 2026 (file piccoli che bloccano il browser, limiti, dati non fidati).
import test from 'node:test'; import assert from 'node:assert/strict';
import { parsePlan, LIMITS } from '../js/plan.js';

const timed = fn => { const t0 = performance.now(), r = fn(); return { r, ms: performance.now() - t0 }; };
const rep = (n, steps) => ({ rep: n, steps });
const step = { t: 'interval', d: 60, lo: 200, hi: 220 };

test('piano: ripetizioni annidate vuote non bloccano il browser (prima 0,5 s per seduta, 2 minuti per 200)', () => {
  const sess = i => ({ id: 's' + i, title: 'x', blocks: [rep(200, [rep(200, [rep(200, [])])])] });
  const { r, ms } = timed(() => parsePlan({ ftp: 271, sessions: Array.from({ length: 200 }, (_, i) => sess(i)) }));
  assert.ok(ms < 1500, 'tempo ' + Math.round(ms) + ' ms'); assert.equal(r.ok, false); assert.equal(r.sessions.length, 0);
  assert.ok(r.errors.some(e => /ripetizione senza step|troppe ripetizioni/.test(e)));
});

test('piano: ogni giro di ripetizione conta nel budget (200×200×200 giri con uno step dentro vengono rifiutati subito)', () => {
  const { r, ms } = timed(() => parsePlan({ ftp: 271, sessions: [{ id: 'a', title: 'a', blocks: [rep(200, [rep(200, [rep(200, [step])])])] }] }));
  assert.ok(ms < 1500, 'tempo ' + Math.round(ms) + ' ms'); assert.equal(r.ok, false); assert.ok(r.errors.some(e => /troppe ripetizioni|troppi step/.test(e)));
});

test('piano: il limite di step vale per tutto il file, non per ogni seduta (prima 24 KB davano un milione di step)', () => {
  const big = i => ({ id: 'b' + i, title: 'b', blocks: [rep(100, [rep(50, [step])])] });          // 5000 step ciascuna
  const { r, ms } = timed(() => parsePlan({ ftp: 271, sessions: Array.from({ length: 200 }, (_, i) => big(i)) }));
  const total = r.sessions.reduce((a, s) => a + s.steps.length, 0);
  assert.ok(total <= LIMITS.totalSteps, 'step totali ' + total); assert.ok(ms < 3000, 'tempo ' + Math.round(ms) + ' ms');
  assert.ok(r.warnings.some(w => /File troppo grande/.test(w)), 'dice che ha smesso di leggere');
});

test('piano: errori e avvisi sono al massimo 100 (prima milioni di righe, poi un RangeError nell\'interfaccia)', () => {
  const bad = { id: 'm', title: 'm', blocks: Array.from({ length: 5000 }, () => ({ t: 'xxx' })) };
  const r = parsePlan({ ftp: 271, sessions: Array.from({ length: 30 }, (_, i) => ({ ...bad, id: 'm' + i })) });
  assert.ok(r.errors.length <= LIMITS.msgs + 1, 'errori ' + r.errors.length); assert.match(r.errors.at(-1), /…e altri \d+ messaggi/);
});

test('piano: step più brevi di 1 s o 10 m sono rifiutati; un valore molto alto per molto tempo dà un avviso', () => {
  const r = parsePlan({ ftp: 271, sessions: [{ id: 'x', title: 'x', blocks: [{ t: 'warmup', d: 1e-300, lo: 100, hi: 120 }, { t: 'warmup', d: 600, lo: 100, hi: 120 }, { t: 'interval', d: 300, lo: 700, hi: 740 }, { t: 'interval', dist: 1, lo: 100, hi: 120 }] }] });
  assert.ok(r.errors.some(e => /troppo breve/.test(e)), r.errors.join('|')); assert.equal(r.sessions[0].steps.length, 2);
  assert.ok(r.sessions[0].warnings.some(w => /più di 2,5 volte la FTP/.test(w)));
});

test('piano: i piani normali (quello d\'esempio) non cambiano', async () => {
  const { readFileSync } = await import('node:fs');
  const r = parsePlan(readFileSync(new URL('../piano-app.example.json', import.meta.url), 'utf8'));
  assert.ok(r.ok, r.errors.join('|')); assert.ok(r.sessions.length >= 2); assert.equal(r.warnings.filter(w => /2,5 volte la FTP|troppo breve/.test(w)).length, 0);
});

/* ---------- FTP e watt ---------- */
import { sanitizeSettings, DEFAULTS } from '../js/settings.js';
import { rampPlan, ftp20Plan } from '../js/ftptest.js';
import { StateSync } from '../js/sync.js';

test('FTP personale: solo 0 (non indicata) oppure 50-600 W; il file {"ftp":2000} non genera più watt assurdi', () => {
  assert.equal(sanitizeSettings({ ftp: 2000 }).ftp, 600); assert.equal(sanitizeSettings({ ftp: 2710 }).ftp, 600); assert.equal(sanitizeSettings({ ftp: 3 }).ftp, 50);
  assert.equal(sanitizeSettings({ ftp: 0 }).ftp, 0); assert.equal(sanitizeSettings({ ftp: 271 }).ftp, 271); assert.equal(sanitizeSettings({ ftp: 'x' }).ftp, DEFAULTS.ftp);
  const f = sanitizeSettings({ ftpMode: 'personal', ftp: 2000 }).ftp;
  for (const p of [rampPlan(f), ftp20Plan(f)]) { const r = parsePlan({ ftp: f, sessions: [p] }); assert.ok(r.ok, r.errors.join('|')); assert.ok(Math.max(...r.sessions[0].steps.map(s => s.hi)) <= 600 * 2.5, 'watt massimi del piano generato'); }
  assert.equal(sanitizeSettings({ bikeColor: { deep: 2 } }).bikeColor.deep, 2, 'la UI offre «Lenticolare» (2): deve restare');
});

test('sincronizzazione: un orario remoto nel futuro (1e300) non fa vincere il cloud per sempre', async () => {
  const mem = new Map(), storage = { getItem: k => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)) };
  const S = { ...DEFAULTS, weight: 70 }; let written = null, applied = 0;
  const cloud = { readJson: async p => (p === 'impostazioni.json' ? { v: 1, mod: 1e300, settings: { weight: 99 } } : null), writeJson: async (p, o) => { if (p === 'impostazioni.json') written = o; }, od: { list: async () => [] } };
  const sy = new StateSync({ cloud, storage, getSettings: () => S, applyRemote: () => { applied++; }, getRoutes: () => [], addRoutes() { }, validateRoute() { }, now: () => 1_800_000_000_000 });
  sy.setMeta({ settings: 1_700_000_000_000, joined: true });          // questo PC è già stato collegato e ha modifiche sue
  await sy.settingsStep({});
  assert.equal(applied, 0, 'il remoto con orario impossibile non si applica'); assert.ok(written && written.settings.weight === 70, 'le impostazioni locali vengono caricate');
});

/* ---------- percorsi (GPX/TCX e JSON da OneDrive o localStorage) ---------- */
import { parseTrack, routeFromFile, Route } from '../js/route.js';

const gpx = pts => `<gpx><trk><trkseg>${pts.map(([la, lo, e]) => `<trkpt lat="${la}" lon="${lo}">${e != null ? `<ele>${e}</ele>` : ''}</trkpt>`).join('')}</trkseg></trk></gpx>`;
const line = n => Array.from({ length: n }, (_, i) => [45.5 + i * 0.0003, 9.9, 100 + (i % 7)]);

test('GPX: un file di «<ele<ele…» non blocca il browser (prima 160 KB = 6,7 s, quadratico)', () => {
  const evil = '<gpx><trkpt lat="45" lon="9">' + '<ele'.repeat(40000) + '</trkpt></gpx>';           // 160 KB senza «>»
  const { ms } = timed(() => parseTrack(evil)); assert.ok(ms < 500, 'tempo ' + Math.round(ms) + ' ms');
  const tcx = '<TrainingCenterDatabase><Trackpoint>' + '<LatitudeDegrees'.repeat(20000) + '</Trackpoint></TrainingCenterDatabase>';
  assert.ok(timed(() => parseTrack(tcx)).ms < 500);
});

test('GPX: quote assurde (1e999) o fuori scala non producono NaN né dislivello infinito', () => {
  const pts = line(60); const txt = gpx(pts).replace(/<ele>101<\/ele>/g, '<ele>1e999</ele>').replace(/<ele>103<\/ele>/g, '<ele>99999</ele>');
  const r = routeFromFile(txt, 'x.gpx'); assert.ok(Number.isFinite(r.gain), 'dislivello ' + r.gain); assert.ok(r.grades.every(Number.isFinite)); assert.ok(r.ele.every(Number.isFinite));
});

test('percorso: tre punti a cavallo dell\'antimeridiano restano pochi punti (prima 2,2 milioni e 285 MB)', () => {
  const raw = { id: 'am', name: 'am', pts: [[10, 179.9995, 0], [10, -179.9995, 0], [10.0005, 179.9995, 0], [10, -179.9995, 0]] };
  const t = timed(() => { try { return new Route(raw); } catch (e) { return e; } });
  assert.ok(t.ms < 1000, 'tempo ' + Math.round(t.ms) + ' ms'); assert.ok(t.r instanceof Error || t.r.pts.length < 100, 'pochi punti, non milioni');
  const long = Array.from({ length: 200 }, (_, i) => [10, i % 2 ? -179.9995 : 179.9995, 0]);        // 200 salti da 110 m
  const t2 = timed(() => { try { return new Route({ id: 'am2', name: 'am2', pts: long }); } catch (e) { return e; } });
  assert.ok(t2.ms < 2000, 'tempo ' + Math.round(t2.ms) + ' ms'); if (!(t2.r instanceof Error)) assert.ok(t2.r.pts.length < 5000, 'punti ' + t2.r.pts.length);
});

test('percorso da OneDrive/localStorage: places, env, nome e id vengono ricostruiti, non copiati', () => {
  const pts = line(80);
  const r = new Route({ id: '<b>x</b>', name: 'Giro "bello" <img src=x onerror=alert(1)>', src: 5, pts,
    places: [{ n: 5, d: 10 }, null, { n: 'Chiari', d: '1"><img src=x>' }, { n: 'Paese <b>', d: 100, c: 'sì', extra: 1 }, { n: 'ok', d: 200, c: 0 }],
    env: [[0, 1e9, '__proto__'], [0, 100, 'constructor'], [0, 'x', 'city'], [0, 500, 'city'], 'zzz'] });
  assert.equal(r.id, 'gpx'); assert.ok(!/[<>]/.test(r.name), r.name); assert.equal(r.src, '');
  assert.deepEqual(r.places.map(p => [p.n.replace(/\s+/g, ''), p.d, p.c]), [['Paeseb', 100, 1], ['ok', 200, 0]]);
  assert.deepEqual(r.envSegs, [[0, 500, 'city']]);
  assert.doesNotThrow(() => { r.env(50); r.placeAt(100); r.mapPts(100, 100); });
  assert.deepEqual(JSON.parse(JSON.stringify(r)).places.every(p => typeof p.n === 'string' && typeof p.d === 'number'), true);
  assert.equal(new Route({ id: 'giro-iseo', name: 'x', pts }).id, 'giro-iseo', 'gli id normali restano');
});

test('percorsi inclusi nell\'app: dopo la validazione restano identici (stessi luoghi, ambienti e lunghezza)', async () => {
  const { readFileSync, readdirSync } = await import('node:fs');
  for (const f of readdirSync(new URL('../routes/', import.meta.url)).filter(f => f.endsWith('.json') && f !== 'index.json')) {
    const j = JSON.parse(readFileSync(new URL('../routes/' + f, import.meta.url), 'utf8')), r = new Route(j);
    assert.equal(r.id, j.id); assert.equal(r.name, j.name); assert.equal(r.places.length, j.places.length, f); assert.equal(r.envSegs.length, (j.env || []).length, f);
    assert.ok(Math.abs(r.len - j.len) < j.len * 0.015, f + ' lunghezza ' + r.len + ' vs ' + j.len);
  }
});
