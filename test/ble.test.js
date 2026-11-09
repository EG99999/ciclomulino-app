import test from 'node:test'; import assert from 'node:assert/strict';
import { parseIndoorBikeData, parseHeartRate, cmdSetTargetPower } from '../js/ble.js';
const dv = a => new DataView(Uint8Array.from(a).buffer);
test('Indoor Bike Data: velocità + cadenza + potenza (flags 0x0044)', () => {
  // flags 0x0044: bit0=0 → velocità; bit2 cadenza; bit6 potenza. v=30.00 km/h, cad 90 rpm (180*0.5), P=250 W
  const d = parseIndoorBikeData(dv([0x44, 0x00, 0xb8, 0x0b, 0xb4, 0x00, 0xfa, 0x00]));
  assert.equal(d.speed, 30); assert.equal(d.cadence, 90); assert.equal(d.power, 250); assert.equal(d.hr, null);
});
test('Indoor Bike Data: con distanza, resistenza, energia e FC', () => {
  // flags: speed(no bit0) + cad(0x4) + dist(0x10) + resist(0x20) + power(0x40) + energy(0x100) + hr(0x200) = 0x374
  const d = parseIndoorBikeData(dv([0x74, 0x03, 0x10, 0x0e, 0x64, 0x00, 0x10, 0x27, 0x00, 0x05, 0x00, 0x2c, 0x01, 0x01, 0x00, 0x02, 0x00, 0x00, 0x8a]));
  assert.equal(d.speed, 36); assert.equal(d.cadence, 50); assert.equal(d.distance, 10000); assert.equal(d.power, 300); assert.equal(d.hr, 138);
});
test('Indoor Bike Data: potenza negativa/zero e senza velocità (bit0=1)', () => {
  const d = parseIndoorBikeData(dv([0x41, 0x00, 0x00, 0x00]));
  assert.equal(d.speed, null); assert.equal(d.power, 0);
});
test('FC 8 e 16 bit', () => { assert.equal(parseHeartRate(dv([0x00, 142])), 142); assert.equal(parseHeartRate(dv([0x01, 0x2c, 0x01])), 300); });
test('Set Target Power = 05 + sint16 LE', () => { assert.deepEqual([...new Uint8Array(cmdSetTargetPower(250))], [0x05, 0xfa, 0x00]); assert.deepEqual([...new Uint8Array(cmdSetTargetPower(-1))], [0x05, 0xff, 0xff]); });
