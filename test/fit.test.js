// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Gatti Elia
import test from 'node:test'; import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { buildFit, crc16, fitFileName } from '../js/fit.js';
import { runSim } from './helpers.js';

const SZ = { 0: 1, 2: 1, 10: 1, 0x84: 2, 0x86: 4, 0x8c: 4, 0x85: 4 };
/** decoder FIT indipendente (solo ciò che serve): verifica header, CRC, definizioni e dati */
export function decode(u8) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const hs = dv.getUint8(0), dsz = dv.getUint32(4, true);
  assert.equal(String.fromCharCode(...u8.slice(8, 12)), '.FIT'); assert.equal(hs, 14); assert.equal(u8.length, hs + dsz + 2);
  assert.equal(dv.getUint16(12, true), crc16(u8.slice(0, 12)), 'CRC header');
  assert.equal(dv.getUint16(u8.length - 2, true), crc16(u8.slice(0, u8.length - 2)), 'CRC file');
  const defs = {}, msgs = []; let o = hs;
  while (o < hs + dsz) {
    const h = dv.getUint8(o++);
    if (h & 0x40) { const local = h & 15; o += 2; const num = dv.getUint16(o, true); o += 2; const n = dv.getUint8(o++); const f = []; for (let i = 0; i < n; i++) { f.push({ f: dv.getUint8(o), size: dv.getUint8(o + 1), type: dv.getUint8(o + 2) }); o += 3; } defs[local] = { num, f }; }
    else { const d = defs[h & 15]; assert.ok(d, 'definizione mancante'); const m = { num: d.num }; for (const x of d.f) { assert.equal(x.size, SZ[x.type]); m[x.f] = x.size === 1 ? dv.getUint8(o) : x.size === 2 ? dv.getUint16(o, true) : dv.getUint32(o, true); o += x.size; } msgs.push(m); }
  }
  assert.equal(o, hs + dsz); return msgs;
}

test('FIT: struttura valida, 1 record/s, 1 lap per step, session, activity', () => {
  const { sess } = runSim(0);
  const bytes = buildFit(sess); const m = decode(bytes);
  const by = n => m.filter(x => x.num === n);
  assert.equal(by(0).length, 1); assert.equal(by(0)[0][0], 4); assert.equal(by(20).length, 2700); assert.equal(by(19).length, 13);
  assert.equal(by(18).length, 1); assert.equal(by(34).length, 1);
  const r = by(20); assert.equal(r[1][253] - r[0][253], 1); assert.equal(r[100][7], sess.records[100].p);
  const se = by(18)[0]; assert.equal(se[5], 2); assert.equal(se[6], 6); assert.equal(se[8], 2700000);
  assert.ok(Math.abs(se[20] - sess.avgPower) < 2, 'avg power ' + se[20] + ' vs ' + sess.avgPower);
  assert.ok(se[34] >= se[20], 'NP ≥ media');
  const laps = by(19); assert.equal(laps.reduce((a, l) => a + l[8], 0), 2700000);
  if (process.env.FIT_OUT) writeFileSync(process.env.FIT_OUT, bytes);
});
test('FIT: senza dati lancia errore; nome file ordinato', () => {
  assert.throws(() => buildFit({ records: [] }), /Nessun dato/);
  assert.match(fitFileName({ startedAt: new Date(2026, 10, 16, 6, 0).getTime() }, "Ciclomulino VO2max 5x3'"), /^20261116-060000-ciclomulino-vo2max-5x3\.fit$/);
});
