// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Gatti Elia
// Convertitore piano coach → piano-app.json (tools/coach-to-piano.mjs).
import test from 'node:test'; import assert from 'node:assert/strict';
import { convertPlan, decideWrite, planChanged, zoneBounds, hrZoneOf, SOURCE } from '../tools/coach-to-piano.mjs';
import { parsePlan } from '../js/plan.js';

const FLOORS = [0, 162, 216, 261, 302, 348, 438], HRF = [97, 116, 135, 154, 174], TODAY = '2026-11-14';
const sess = (over = {}, steps) => ({ id: '2026-11-20-ciclomulino-z2', data: '2026-11-20', orario: '06:00', tipo: 'bici', titolo: "Ciclomulino z2 40'", descrizione: 'Z2 puro, FC sotto 135.', durataMin: 40,
  struttura: { sport: 'cycling', steps: steps || [
    { kind: 'warmup', end: 'time', value: 300, target: 'power', low: 100, high: 120 },
    { kind: 'interval', end: 'time', value: 1800, target: 'power', low: 165, high: 195, note: 'z2, tetto FC 135' },
    { kind: 'cooldown', end: 'time', value: 300, target: 'power_zone', low: 1 }] }, ...over });
const conv = (list, o = {}) => convertPlan(list, { ftp: 289, today: TODAY, zones: FLOORS, hrZones: HRF, ...o });

test('watt del coach: power e power_zone diventano blocchi di Open Trainer, tetto FC dalla nota', () => {
  const { plan, report } = conv([sess()]);
  assert.equal(report.converted.length, 1); assert.equal(plan.source, SOURCE); assert.equal(plan.ftp, 289);
  const s = plan.sessions[0]; assert.equal(s.id, '2026-11-20-ciclomulino-z2'); assert.equal(s.date, '2026-11-20'); assert.equal(s.time, '06:00'); assert.equal(s.title, "Ciclomulino z2 40'");
  assert.deepEqual(s.blocks[0], { t: 'warmup', n: 'Riscaldamento', d: 300, lo: 100, hi: 120 });
  assert.equal(s.blocks[1].lo, 165); assert.equal(s.blocks[1].hi, 195); assert.equal(s.blocks[1].hrCap, 135); assert.equal(s.blocks[1].t, 'interval');
  assert.equal(s.blocks[2].lo, 30); assert.equal(s.blocks[2].hi, 161, 'zona 1 = da 30 W a 161 W (floor della zona 2 meno 1)');
  assert.ok(parsePlan(plan).ok, 'Open Trainer accetta il file');
});
test('zone di potenza dai floor del coach, oppure percentuali classiche della FTP', () => {
  const z = zoneBounds(289, FLOORS); assert.deepEqual([z[1].lo, z[1].hi, z[6].lo], [162, 215, 438]);
  const d = zoneBounds(200); assert.deepEqual([d[1].lo, d[1].hi, d[3].lo], [112, 151, 182]);
  assert.equal(hrZoneOf(134, HRF), 2); assert.equal(hrZoneOf(135, HRF), 3); assert.equal(hrZoneOf(80, HRF), 1);
});
test('seduta solo con la FC: non si inventano watt (saltata con il motivo), tranne se si chiede il ripiego per zona', () => {
  const hr = [{ kind: 'warmup', end: 'time', value: 300, target: 'heart_rate', low: 100, high: 135 }, { kind: 'interval', end: 'time', value: 1800, target: 'heart_rate', low: 100, high: 135, note: 'z2, FC sotto 135' }, { kind: 'cooldown', end: 'time', value: 300, target: 'heart_rate', low: 100, high: 135 }];
  const a = conv([sess({}, hr)]); assert.equal(a.plan.sessions.length, 0); assert.match(a.report.skipped[0].motivo, /nessun target in watt/);
  const b = conv([sess({}, hr)], { hrFallback: true }); assert.equal(b.plan.sessions.length, 1);
  assert.equal(b.plan.sessions[0].blocks[1].lo, 162); assert.equal(b.plan.sessions[0].blocks[1].hi, 215, 'FC sotto 135 = zona 2 = 162-215 W'); assert.equal(b.plan.sessions[0].blocks[1].hrCap, 135); assert.ok(b.report.warnings.length >= 3);
});
test('ripetizioni annidate, pausa senza watt e distanza', () => {
  const st = [{ kind: 'warmup', end: 'distance', value: 3000, target: 'power', low: 100, high: 120 }, { kind: 'repeat', repeat: 3, steps: [{ kind: 'interval', end: 'time', value: 180, target: 'power', low: 300, high: 320 }, { kind: 'recovery', end: 'time', value: 180, target: 'power', low: 90, high: 100 }] }, { kind: 'rest', end: 'time', value: 60, target: 'none' }];
  const { plan } = conv([sess({}, st)]); const b = plan.sessions[0].blocks;
  assert.equal(b[0].dist, 3000); assert.equal(b[1].rep, 3); assert.equal(b[1].steps.length, 2); assert.deepEqual(b[2], { t: 'rest', n: 'Pausa', d: 60 }); assert.ok(parsePlan(plan).ok);
});
test('range sotto i 10 W allargato; passo a «lap» e tipi sconosciuti saltano la seduta', () => {
  const a = conv([sess({}, [{ kind: 'interval', end: 'time', value: 600, target: 'power', low: 200, high: 204 }])]); assert.equal(a.plan.sessions[0].blocks[0].hi - a.plan.sessions[0].blocks[0].lo, 10); assert.match(a.report.warnings[0], /10 W/);
  const b = conv([sess({}, [{ kind: 'interval', end: 'lap', target: 'power', low: 200, high: 220 }])]); assert.equal(b.plan.sessions.length, 0); assert.match(b.report.skipped[0].motivo, /durata/);
  const c = conv([sess({}, [{ kind: 'sprint', end: 'time', value: 20, target: 'power', low: 600, high: 700 }])]); assert.match(c.report.skipped[0].motivo, /sconosciuto/);
});
test('filtro: solo bici indoor dal giorno di oggi in poi, entro l\'orizzonte; «all» prende ogni bici', () => {
  const list = [sess({ id: 'passata', data: '2026-11-10' }), sess({ id: 'lontana', data: '2027-03-01' }), sess({ id: 'corsa', tipo: 'corsa' }), sess({ id: 'strada', titolo: 'Uscita lunga', descrizione: 'Fuori', data: '2026-11-22' }), sess({ id: 'oggi', data: TODAY }), sess({ id: 'ok', data: '2026-11-18' })];
  const a = conv(list); assert.deepEqual(a.plan.sessions.map(s => s.id), ['oggi', 'ok']);
  const b = conv(list, { all: true }); assert.deepEqual(b.plan.sessions.map(s => s.id), ['oggi', 'ok', 'strada']);
  assert.equal(conv({ sessions: [sess()] }).plan.sessions.length, 1, 'accetta anche { sessions: [...] }');
});
test('scrittura del file: non toccare un piano fatto a mano, non riscrivere se è uguale, non scrivere un piano vuoto', () => {
  const { plan } = conv([sess()]), txt = JSON.stringify(plan), empty = conv([]).plan;
  assert.equal(decideWrite(empty, txt), 'vuoto'); assert.equal(decideWrite(plan, null), 'scrivi'); assert.equal(decideWrite(plan, txt), 'invariato');
  assert.equal(decideWrite({ ...plan, generated: '2026-12-01' }, txt), 'invariato', 'la data di generazione non conta');
  assert.equal(decideWrite(plan, JSON.stringify({ ftp: 271, sessions: [{ id: 'mio' }] })), 'non-mio'); assert.equal(decideWrite(plan, JSON.stringify({ ftp: 271, sessions: [] }), { overwrite: true }), 'scrivi');
  assert.equal(decideWrite(plan, '{non json'), 'scrivi', 'un file rovinato si rifà');
  const changed = conv([sess({ descrizione: 'cambiata' })]).plan; assert.equal(planChanged(plan, changed), true); assert.equal(decideWrite(changed, txt), 'scrivi');
});

import { coachTextToPlanText, isCoachPlan } from '../js/coachplan.js';
test('app: il file piano può essere quello del coach (elenco o { ftp, zones, sessions }) e viene convertito; un piano di Open Trainer resta com\'è', () => {
  const hr = [{ kind: 'warmup', end: 'time', value: 300, target: 'heart_rate', low: 100, high: 135 }, { kind: 'interval', end: 'time', value: 1800, target: 'heart_rate', low: 100, high: 135, note: 'FC sotto 135' }];
  const list = [sess({}, hr)];
  const a = coachTextToPlanText(JSON.stringify(list), { today: TODAY, ftp: 271 }); assert.equal(a.coach, true); assert.equal(a.count, 1);
  const p = JSON.parse(a.text); assert.equal(p.ftp, 271); assert.equal(p.sessions[0].blocks[1].hrCap, 135); assert.ok(parsePlan(p).ok, 'ripiego: FC → zona 2 in watt di serie');
  const b = coachTextToPlanText(JSON.stringify({ ftp: 289, zones: FLOORS, hrZones: HRF, sessions: list }), { today: TODAY }); const q = JSON.parse(b.text);
  assert.equal(q.ftp, 289); assert.deepEqual([q.sessions[0].blocks[1].lo, q.sessions[0].blocks[1].hi], [162, 215], 'zone del coach');
  const ot = JSON.stringify({ ftp: 271, sessions: [{ id: 'x', title: 'x', blocks: [{ t: 'warmup', d: 60, lo: 100, hi: 120 }] }] }); const c = coachTextToPlanText(ot, { today: TODAY }); assert.equal(c.coach, false); assert.equal(c.text, ot);
  assert.equal(coachTextToPlanText('non json', {}).coach, false); assert.equal(isCoachPlan([]), false); assert.equal(isCoachPlan([{ id: 1 }]), false);
  assert.equal(coachTextToPlanText(JSON.stringify([sess({ data: '2020-01-01' })]), { today: TODAY }).count, 0, 'nessuna seduta futura: conteggio zero');
});

test('scrittura del file: il file caricato dalla chat del coach (sedute grezze, senza source) si può riscrivere; un piano a mano no', () => {
  const { plan } = conv([sess({})]);
  const dalChat = JSON.stringify({ ftp: 289, zones: [0, 162, 216, 261, 302, 348, 438], sessions: [sess({})] });
  assert.equal(decideWrite(plan, dalChat), 'scrivi', 'il file grezzo del coach è nostro');
  const aMano = JSON.stringify({ ftp: 271, sessions: [{ id: 'mia', blocks: [{ t: 'work', d: 60, lo: 200, hi: 220 }] }] });
  assert.equal(decideWrite(plan, aMano), 'non-mio', 'un piano a mano con blocchi non si tocca');
});
