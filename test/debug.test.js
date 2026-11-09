import test from 'node:test'; import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { Recorder, redact, redactUrl, hash32, settingsSnapshot, diffSnapshot, folderSink, idbSink, round, stamp } from '../js/debug.js';
import { BleTrainer, BleHr, UUID, hex, shortUuid, decodeFeature, decodeCp, decodeStatus, decodeTrainingStatus, parseHrExtra } from '../js/ble.js';
import { appendFile } from '../js/folder.js';
import { DEFAULTS, settingsPayload, sanitizeSettings, SYNC_SKIP } from '../js/settings.js';

/* ---------- registratore ---------- */
const mk = (o = {}) => { let t = 0; const r = new Recorder({ now: () => t, epoch: () => 1_700_000_000_000, perSec: 1e9, ...o }); return { r, adv: ms => { t += ms; } }; };
const lines = r => r.lines.map(l => JSON.parse(l));

test('debug: la prima riga dice chi, quando e con quale codice; ogni riga ha tempo, tipo e dati annidati', () => {
  const { r, adv } = mk();
  r.log('prima', { a: 1 }); assert.equal(r.lines.length, 0, 'spento: non registra');
  const id = r.start({ build: 'X', settings: { wheelMm: 2136 } });
  assert.match(id, /^\d{4}-\d\d-\d\d_\d{6}-[a-z0-9]{2,6}$/);
  adv(1500); r.log('x', { a: 1, w: 180 }); r.log('senza-dati');
  const L = lines(r);
  assert.equal(L[0].k, 'run.start'); assert.equal(L[0].t, 0); assert.equal(L[0].d.schema, 1); assert.equal(L[0].d.build, 'X'); assert.equal(L[0].d.settings.wheelMm, 2136); assert.equal(L[0].d.epoch, 1_700_000_000_000);
  assert.deepEqual(L[1], { t: 1500, k: 'x', d: { a: 1, w: 180 } });                  // i dati stanno in "d": nessuna collisione con t e k
  assert.deepEqual(L[2], { t: 1500, k: 'senza-dati' });
  assert.equal(r.text().split('\n').length, 4, 'una riga per evento + a capo finale'); assert.ok(r.text().endsWith('\n'));
});

test('debug: serializzazione sicura (circolari, errori, byte, testi lunghi, numeri non validi) e mai eccezioni', () => {
  const { r } = mk(); r.start();
  const circ = { a: 1 }; circ.me = circ;
  assert.doesNotThrow(() => r.log('c', { circ, err: new RangeError('boom'), dv: new DataView(Uint8Array.of(0x44, 0, 0xb8).buffer), u8: Uint8Array.of(1, 255), big: 12n, nan: NaN, inf: Infinity, f: () => 1, long: 'x'.repeat(1000) }));
  const d = lines(r)[1].d;
  assert.equal(d.circ.me, '[circolare]'); assert.equal(d.err.name, 'RangeError'); assert.equal(d.err.message, 'boom');
  assert.equal(d.dv, '44 00 b8'); assert.equal(d.u8, '01 ff'); assert.equal(d.big, '12'); assert.equal(d.nan, null); assert.equal(d.inf, null); assert.ok(!('f' in d));
  assert.match(d.long, /…\(\+600\)$/); assert.ok(d.long.length < 450);
  const evil = { toJSON() { throw new Error('no'); } };
  assert.doesNotThrow(() => r.log('e', evil)); assert.equal(r.stats().dropped, 1, 'una riga impossibile da scrivere viene contata, non lancia');
});

test('debug: token, codici di accesso e parametri degli indirizzi non entrano mai nel log', () => {
  const { r } = mk(); r.start();
  r.log('t', { m: 'GET https://x/y?code=abcdef123456&state=1 access_token=SECRETTOKEN123 Authorization: Bearer ZZZZZZ999999', jwt: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.firmaFIRMA', blob: 'A'.repeat(200) });
  const raw = r.text();
  for (const s of ['abcdef123456', 'SECRETTOKEN123', 'ZZZZZZ999999', 'eyJhbGci', 'AAAAAAAAAAAAAAAAAAAA']) assert.ok(!raw.includes(s), 'non deve contenere ' + s);
  assert.match(redact('refresh_token: "r3fr35h-token-value"'), /\[nascosto\]/);
  assert.equal(redactUrl('https://graph.microsoft.com/v1.0/me/drive/root?access_token=abc#frag'), 'https://graph.microsoft.com/v1.0/me/drive/root?…');
  assert.equal(redactUrl('routes/index.json', 'https://eg99999.github.io/ciclomulino-app/'), 'https://eg99999.github.io/ciclomulino-app/routes/index.json');
});

test('debug: protezioni — tetto di righe, diluvio al secondo, righe enormi', () => {
  const a = mk({ maxLines: 5 }); a.r.start(); for (let i = 0; i < 20; i++) a.r.log('x', { i });
  assert.equal(a.r.lines.length, 6, '5 righe + la riga che dice che si è fermato'); assert.equal(lines(a.r).at(-1).k, 'run.cap'); assert.ok(a.r.stats().capped); assert.equal(a.r.stats().dropped, 16);
  const b = mk({ perSec: 10 }); b.r.start(); for (let i = 0; i < 50; i++) b.r.log('x', { i });
  assert.equal(b.r.lines.length, 10); b.adv(1000); b.r.log('dopo');
  assert.deepEqual(lines(b.r).filter(l => l.k === 'flood').map(l => l.d.dropped), [41], 'dice quante righe ha scartato');
  const c = mk(); c.r.start(); c.r.log('big', { arr: Array.from({ length: 5000 }, (_, i) => 'riga numero ' + i) });
  assert.ok(lines(c.r)[1].d.troncato > 12000); assert.ok(c.r.lines[1].length < 1000);
});

test('debug: destinazioni — righe consegnate in ordine, a blocchi, senza perderne; errori contati e ripresi', async () => {
  const { r, adv } = mk(); const got = [], infos = [];
  r.addSink({ name: 'ok', every: 0, async write(batch, info) { got.push(...batch); infos.push(info); } });
  r.start(); for (let i = 0; i < 9000; i++) r.log('x', { i });
  await r.flush(true);
  assert.equal(got.length, r.lines.length); assert.deepEqual(got, r.lines);
  assert.deepEqual(infos.map(i => [i.first, i.seq]), [[true, 0], [false, 1], [false, 2]], 'tre blocchi da massimo 4000');
  assert.equal(infos.at(-1).total, r.lines.length);
  // destinazione che sbaglia: dopo 5 errori si ferma e lo dice; rearm la riattiva
  const bad = r.addSink({ name: 'rotta', every: 0, async write() { throw new Error('disco pieno'); } });
  for (let i = 0; i < 8; i++) await r.flush(true);
  assert.equal(bad.fails, 5); assert.ok(lines(r).some(l => l.k === 'sink.dead' && l.d.sink === 'rotta' && /disco pieno/.test(l.d.err)));
  assert.equal(r.stats().sinks.find(s => s.name === 'rotta').dead, true);
  // destinazione non pronta (es. cartella non collegata): non è un errore, riprova dopo
  let ready = false, wrote = 0; const wait = r.addSink({ name: 'cartella', every: 0, async write(b) { if (!ready) return false; wrote += b.length; } });
  await r.flush(true); assert.equal(wait.fails, 0); assert.equal(wait.idx, 0);
  ready = true; await r.flush(true); assert.equal(wrote, r.lines.length); assert.equal(wait.idx, r.lines.length);
  // pausa tra una scrittura e l'altra
  const slow = r.addSink({ name: 'lenta', every: 5000, async write() {} }); r.log('y'); await r.flush(false); const first = slow.idx; r.log('z'); await r.flush(false);
  assert.equal(slow.idx, first, 'entro 5 s non riscrive'); adv(6000); await r.flush(false); assert.ok(slow.idx > first);
});

test('debug: stop scrive i totali e svuota; dopo non registra più; un nuovo start ricomincia da capo', async () => {
  const { r } = mk(); const got = []; r.addSink({ name: 's', every: 1e9, async write(b) { got.push(...b); } });
  r.start(); r.log('a'); r.mark('nota'); r.log('b');
  await r.stop('prova');
  const end = JSON.parse(got.at(-1)); assert.equal(end.k, 'run.end'); assert.equal(end.d.reason, 'prova'); assert.equal(end.d.marks, 1); assert.equal(end.d.kinds.a, 1);
  assert.equal(r.on, false); const n = r.lines.length; r.log('c'); assert.equal(r.lines.length, n);
  const id1 = r.runId; r.start(); assert.equal(r.lines.length, 1); assert.notEqual(r.runId, id1);
  assert.equal(stamp(Date.UTC(2026, 10, 9, 12, 0, 0)).slice(0, 4), '2026'); assert.equal(round(1.23456, 2), 1.23); assert.equal(round(NaN), null); assert.equal(round(undefined), null); assert.equal(round(null), null); assert.equal(round('x'), 'x');
});

test('debug: cartella dati — appendFile aggiunge in fondo senza toccare il resto; la destinazione aspetta se la cartella manca', async () => {
  const files = new Map();
  const dir = path => ({
    async getDirectoryHandle(name) { return dir(path + name + '/'); },
    async getFileHandle(name, o) {
      const p = path + name; if (!files.has(p)) { if (!(o && o.create)) throw Object.assign(new Error('nf'), { name: 'NotFoundError' }); files.set(p, ''); }
      return { async getFile() { return { size: files.get(p).length }; },
        async createWritable(opt) { let buf = opt && opt.keepExistingData ? files.get(p) : '', pos = buf.length; return { async seek(n) { pos = n; }, async write(t) { buf = buf.slice(0, pos) + t; pos = buf.length; }, async close() { files.set(p, buf); }, async abort() { } }; } };
    }
  });
  const root = dir('');
  await appendFile(root, 'debug/a.jsonl', 'uno\n', true); await appendFile(root, 'debug/a.jsonl', 'due\n', false); await appendFile(root, 'debug/a.jsonl', 'tre\n', false);
  assert.equal(files.get('debug/a.jsonl'), 'uno\ndue\ntre\n');
  await appendFile(root, 'debug/a.jsonl', 'nuovo\n', true); assert.equal(files.get('debug/a.jsonl'), 'nuovo\n', 'fresh ricomincia il file');
  let h = null, ok = true; const s = folderSink(() => h, async () => ok, appendFile);
  assert.equal(await s.write(['x'], { runId: 'R', first: true }), false, 'nessuna cartella: non scrive e non sbaglia');
  h = root; ok = false; assert.equal(await s.write(['x'], { runId: 'R', first: true }), false, 'permesso mancante: aspetta');
  ok = true; await s.write(['a', 'b'], { runId: 'R', first: true }); await s.write(['c'], { runId: 'R', first: false });
  assert.equal(files.get('debug/ot-R.jsonl'), 'a\nb\nc\n');
  assert.equal(await idbSink().write(['x'], { runId: 'R', seq: 0, start: 0, total: 1, first: true }), false, 'senza IndexedDB (qui in Node) non fa niente');
});

test('debug: le impostazioni nel log non contengono nome, accessi né cartelle; le differenze si vedono', () => {
  const S = { ...DEFAULTS, name: 'Elia', clientId: '946102aa-63b4-4285-8700-8b6a231c73b0', kit: { img: 'data:image/png;base64,AAAA' }, wheelMm: 2136, weight: 70 };
  const snap = settingsSnapshot(S);
  assert.ok(!('name' in snap) && !('clientId' in snap) && !('kit' in snap) && !('lastPick' in snap)); assert.equal(snap.wheelMm, 2136); assert.equal(snap.weight, 70);
  assert.deepEqual(diffSnapshot(snap, { ...snap, wheelMm: 2155, debug: false }), { wheelMm: 2155, debug: false });
  assert.deepEqual(diffSnapshot(snap, snap), {});
  assert.equal(DEFAULTS.debug, true); assert.ok(SYNC_SKIP.includes('debug') && !('debug' in settingsPayload(DEFAULTS)), 'il debug è una scelta del singolo PC: non si sincronizza');
  assert.equal(sanitizeSettings({ debug: 'sì' }).debug, true); assert.equal(sanitizeSettings({ debug: false }).debug, false);
  assert.equal(hash32(Uint8Array.of(1, 2, 3)).length, 8); assert.equal(hash32(Uint8Array.of(1, 2, 3)), hash32(Uint8Array.of(1, 2, 3))); assert.notEqual(hash32(Uint8Array.of(1, 2, 3)), hash32(Uint8Array.of(1, 2, 4)));
});

test('debug: ogni file js del sito è nel service worker e il server locale lo serve', () => {
  const sw = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
  for (const f of readdirSync(new URL('../js/', import.meta.url)).filter(f => f.endsWith('.js'))) assert.ok(sw.includes(`'js/${f}'`), 'manca nel service worker: js/' + f);
});

/* ---------- decodifica dei pacchetti ---------- */
const dv = a => new DataView(Uint8Array.from(a).buffer);
test('Bluetooth: decodifica di funzioni del trainer, risposte, stato e FC', () => {
  assert.equal(hex(dv([0x44, 0, 0xb8])), '44 00 b8'); assert.equal(hex(Uint8Array.of(1, 2).buffer), '01 02'); assert.equal(hex(null), '');
  assert.equal(shortUuid('00001826-0000-1000-8000-00805f9b34fb'), '1826'); assert.equal(shortUuid('0000180D-0000-1000-8000-00805F9B34FB'), '180d'); assert.equal(shortUuid('347b0001-7635-408b-8918-8ff3949ce592'), '347b0001-7635-408b-8918-8ff3949ce592');
  const f = decodeFeature(dv([0x06, 0x40, 0, 0, 0x0c, 0x20, 0, 0]));
  assert.deepEqual(f.machine, ['cadence', 'totalDistance', 'powerMeasurement']); assert.deepEqual(f.target, ['resistance', 'power', 'bikeSimulation']); assert.equal(decodeFeature(dv([1])), null);
  assert.deepEqual(decodeCp(dv([0x80, 0x05, 0x01])), { resp: 'targetPower', result: 'ok' }); assert.deepEqual(decodeCp(dv([0x80, 0x11, 0x02])), { resp: 'bikeSimulation', result: 'notSupported' }); assert.deepEqual(decodeCp(dv([0x80, 0x99, 0x04])), { resp: '0x99', result: 'failed' }); assert.equal(decodeCp(dv([])), null);
  assert.deepEqual(decodeStatus(dv([0x08, 0xb4, 0x00])), { st: 'targetPower', w: 180 }); assert.deepEqual(decodeStatus(dv([0x02, 0x01])), { st: 'stoppedByUser', param: 'stop' }); assert.deepEqual(decodeStatus(dv([0xff])), { st: 'controlPermissionLost' });
  assert.deepEqual(decodeTrainingStatus(dv([0, 12])), { status: 'wattControl' });
  assert.deepEqual(parseHrExtra(dv([0x10, 72, 0x00, 0x04])), { flags: 0x10, contact: 'n.d.', rrMs: [1000] }); assert.equal(parseHrExtra(dv([])), null);
});

/* ---------- un trainer finto che parla come il Suito-T ---------- */
const long = n => `0000${n.toString(16).padStart(4, '0')}-0000-1000-8000-00805f9b34fb`;
class Chr extends EventTarget {
  constructor(id, props, value) { super(); this.uuid = long(id); this.properties = props; this.value = value ? dv(value) : null; this.writes = []; }
  async startNotifications() { }                    // come nel Web Bluetooth vero: esiste solo startNotifications (attiva anche le indicazioni); startIndications() NON esiste
  async readValue() { if (!this.value) throw Object.assign(new Error('non leggibile'), { name: 'NotSupportedError' }); return this.value; }
  async writeValueWithResponse(buf) { this.writes.push(hex(buf)); }
  push(bytes) { this.value = dv(bytes); this.dispatchEvent(new Event('characteristicvaluechanged')); }
}
class Svc { constructor(id, chars) { this.uuid = long(id); this.chars = chars; } async getCharacteristic(u) { const c = this.chars.find(c => c.uuid === long(u)); if (!c) throw Object.assign(new Error('manca'), { name: 'NotFoundError' }); return c; } async getCharacteristics() { return this.chars; } }
function fakeDevice(services, name) {
  const dev = new EventTarget(); dev.name = name; dev.id = 'id-' + name;
  const server = { async getPrimaryService(u) { const s = services.find(s => s.uuid === long(u)); if (!s) throw Object.assign(new Error('manca'), { name: 'NotFoundError' }); return s; }, async getPrimaryServices() { return services; } };
  dev.gatt = { connected: false, async connect() { dev.gatt.connected = true; return server; }, disconnect() { dev.gatt.connected = false; dev.dispatchEvent(new Event('gattserverdisconnected')); } };
  return dev;
}
function fakeTrainer(opt = {}) {
  const P = { read: true, notify: true }, bike = new Chr(0x2ad2, P), cp = new Chr(0x2ad9, { write: true, indicate: true }), st = new Chr(0x2ada, P), ts = new Chr(0x2ad3, P);
  const feat = new Chr(0x2acc, { read: true }, [0x06, 0x40, 0, 0, 0x0c, 0x20, 0, 0]), pr = new Chr(0x2ad8, { read: true }, [0x32, 0x00, 0xb8, 0x0b, 0x01, 0x00]), rr = new Chr(0x2ad6, { read: true }, [0x0a, 0, 0x64, 0, 0x0a, 0]);
  const ftms = new Svc(0x1826, [bike, cp, st, ts, feat, pr, rr]);
  const di = new Svc(0x180a, [new Chr(0x2a29, { read: true }, [...Buffer.from('Elite')]), new Chr(0x2a24, { read: true }, [...Buffer.from('Suito-T')]), new Chr(0x2a26, { read: true }, [...Buffer.from('1.2.3')])]);
  const bat = new Svc(0x180f, [new Chr(0x2a19, { read: true }, [87])]);
  const dev = fakeDevice([ftms, di, bat], 'SUITO-T 1234');
  if (opt.hang) feat.readValue = () => new Promise(() => { });                         // una lettura che non risponde mai
  if (opt.dropDuring) feat.readValue = async () => { dev.gatt.disconnect(); return dv([0, 0, 0, 0, 0, 0, 0, 0]); };      // il trainer sparisce durante il rilievo
  return { dev, bike, cp, st, ts, ftms, feat };
}
function withBluetooth(dev, fn) {
  const seen = { opts: [] };
  Object.defineProperty(globalThis, 'navigator', { configurable: true, writable: true, value: { bluetooth: { requestDevice: async o => { seen.opts.push(o); return dev; } } } });
  return fn(seen).finally(() => { delete globalThis.navigator; });
}

test('Bluetooth debug: il trainer finto — collegamento, rilievo dei servizi, pacchetti grezzi, comandi, risposte, stato', async () => {
  const { dev, bike, cp, st, ts } = fakeTrainer();
  await withBluetooth(dev, async seen => {
    const ev = [], t = new BleTrainer(); t.debug = true; t.trace = (k, d) => ev.push([k, d]);
    const got = []; t.onData = d => got.push(d);
    await t.connect();
    assert.deepEqual(seen.opts[0].optionalServices, [0x1816, 0x180a, 0x180f, 0x1818], 'in debug chiede anche informazioni sul dispositivo');
    const of = k => ev.filter(e => e[0] === k).map(e => e[1]);
    assert.deepEqual(of('request')[0], { filter: '1826', optional: ['1816', '180a', '180f', '1818'] }); assert.equal(of('device')[0].name, 'SUITO-T 1234');
    assert.deepEqual(of('state').map(s => s.s), ['scan', 'on']);
    assert.deepEqual(of('csc'), [{ offered: false, err: 'NotFoundError: manca' }]);
    const map = of('gatt.map')[0].services; assert.deepEqual(map.map(s => s.s), ['1826', '180a', '180f']); assert.equal(map[0].chars.find(c => c.c === '2ad9').p, 'write,indicate');
    const reads = Object.fromEntries(of('gatt.read').map(r => [r.label, r]));
    assert.deepEqual(reads.feature.dec.target, ['resistance', 'power', 'bikeSimulation']); assert.equal(reads.manufacturer.text, 'Elite'); assert.equal(reads.model.text, 'Suito-T'); assert.equal(reads.battery.pct, 87); assert.deepEqual(reads.powerRange.range, { min: 50, max: 3000 });
    assert.ok(reads.hardware.err, 'ciò che il dispositivo non ha viene segnalato, non ignorato');
    assert.deepEqual(cp.writes, ['00', '07'], 'Request Control poi Start, come sempre'); assert.deepEqual(of('tx').map(x => x.hex), ['00', '07']); assert.ok(of('tx').every(x => typeof x.ms === 'number' && typeof x.q === 'number'));
    // pacchetti in entrata: byte grezzi + valori letti
    bike.push([0x44, 0, 0xb8, 0x0b, 0xb4, 0, 0xfa, 0]); bike.push([0x44, 0, 0xb8, 0x0b, 0xb4, 0, 0xfa, 0]);
    const rx = of('rx').filter(r => r.c === '2ad2'); assert.equal(rx.length, 2); assert.equal(rx[0].hex, '44 00 b8 0b b4 00 fa 00'); assert.equal(rx[0].p.power, 250); assert.equal(rx[0].p.cadence, 90); assert.equal(rx[0].fl, 0x44); assert.equal(rx[0].gap, null); assert.equal(typeof rx[1].gap, 'number');
    assert.equal(got.length, 2); assert.equal(t.stats.by['2ad2'], 2);
    // comando verso il trainer: decisione + byte + esito; i doppioni non vengono inviati
    t.setTargetPower(180); await t.queue; t.setTargetPower(180.2); await t.queue;
    assert.deepEqual(of('target').map(x => [x.asked, x.w]), [[180, 180]]); assert.equal(t.stats.supp, 1); assert.equal(cp.writes.at(-1), '05 b4 00');
    cp.push([0x80, 0x05, 0x01]); assert.deepEqual(of('rx').at(-1).cp, { resp: 'targetPower', result: 'ok' }); assert.equal(typeof of('rx').at(-1).lat, 'number');
    st.push([0x08, 0xb4, 0x00]); assert.deepEqual(of('rx').at(-1).st, { st: 'targetPower', w: 180 });
    st.push([0x02, 0x01]); assert.deepEqual(of('rx').at(-1).st, { st: 'stoppedByUser', param: 'stop' });
    ts.push([0x00, 12]); assert.equal(of('rx').at(-1).status, 'wattControl');
    t.setSimulation(3.5); await t.queue; assert.deepEqual(of('sim'), [{ grade: 3.5 }]); assert.equal(cp.writes.at(-1).slice(0, 8), '11 00 00');
    // risposta "non supportato" alla pendenza: viene registrata e il trainer passa al carico fisso
    cp.push([0x80, 0x11, 0x02]); assert.ok(t.simUnsupported);
    // errore di scrittura: registrato con il motivo
    cp.writeValueWithResponse = async () => { throw Object.assign(new Error('GATT operation failed'), { name: 'NetworkError' }); }; t.lastW = null; t.setTargetPower(200); await t.queue;
    assert.match(of('tx').at(-1).err, /NetworkError: GATT operation failed/); assert.equal(t.stats.wrErr, 1);
    await t.disconnect(); assert.equal(of('disconnect')[0].by, 'app');
  });
});

test('Bluetooth: senza debug il collegamento è identico a prima (stessi servizi chiesti, stessi comandi, nessun rilievo)', async () => {
  const { dev, bike, cp } = fakeTrainer();
  await withBluetooth(dev, async seen => {
    const t = new BleTrainer(); await t.connect();
    assert.deepEqual(seen.opts[0].optionalServices, [0x1816]); assert.deepEqual(cp.writes, ['00', '07']);
    assert.ok(t.connected && t.range && t.range.max === 3000);
    const got = []; t.onData = d => got.push(d.power); bike.push([0x44, 0, 0xb8, 0x0b, 0xb4, 0, 0xfa, 0]); assert.deepEqual(got, [250]);
    assert.doesNotThrow(() => t.setTargetPower(150)); await t.queue; assert.equal(cp.writes.at(-1), '05 96 00');
  });
});

test('Bluetooth: dopo una riconnessione ogni pacchetto è elaborato una volta sola (un solo ascolto per caratteristica)', async () => {
  const { dev, bike } = fakeTrainer();
  await withBluetooth(dev, async () => {
    const ev = [], t = new BleTrainer(); t.debug = true; t.trace = (k, d) => ev.push([k, d]); const got = []; t.onData = d => got.push(d.power);
    await t.connect(); bike.push([0x44, 0, 0xb8, 0x0b, 0xb4, 0, 0xfa, 0]); assert.equal(got.length, 1);
    dev.gatt.disconnect();                                              // il trainer sparisce: l'app lo riprende da sola dopo 1 s
    await new Promise(r => setTimeout(r, 1300));
    assert.ok(t.connected, 'riconnesso'); assert.ok(ev.some(e => e[0] === 'gatt.disconnected'));
    assert.deepEqual(ev.filter(e => e[0] === 'state').map(e => e[1].s), ['scan', 'on', 'lost', 'retry', 'on']);
    got.length = 0; bike.push([0x44, 0, 0xb8, 0x0b, 0xb4, 0, 0xfa, 0]); assert.equal(got.length, 1, 'un solo ascolto per caratteristica');
    assert.equal(ev.filter(e => e[0] === 'gatt.map').length, 1, 'il rilievo dei servizi si fa una volta sola');
    await t.disconnect();
  });
});

test('Bluetooth debug: fascia/orologio FC — pacchetti grezzi, intervalli RR, contatto', async () => {
  const hrc = new Chr(0x2a37, { notify: true }), loc = new Chr(0x2a38, { read: true }, [1]);
  const dev = fakeDevice([new Svc(0x180d, [hrc, loc])], 'Fenix 7');
  await withBluetooth(dev, async seen => {
    const ev = [], h = new BleHr(); h.debug = true; h.trace = (k, d) => ev.push([k, d]); const got = []; h.onData = b => got.push(b);
    await h.connect(); await new Promise(r => setTimeout(r, 20));
    assert.deepEqual(seen.opts[0].optionalServices, [0x180a, 0x180f]);
    hrc.push([0x16, 72, 0x00, 0x04]);
    const rx = ev.filter(e => e[0] === 'rx')[0][1]; assert.equal(rx.hex, '16 48 00 04'); assert.equal(rx.p.bpm, 72); assert.equal(rx.contact, 'sì'); assert.deepEqual(rx.rrMs, [1000]); assert.deepEqual(got, [72]);
    assert.ok(ev.some(e => e[0] === 'gatt.read' && e[1].label === 'bodySensorLocation' && e[1].hex === '01'));
    await h.disconnect();
  });
});

test('Bluetooth debug: se il registratore sbaglia, il trainer non se ne accorge', async () => {
  const { dev, bike } = fakeTrainer();
  await withBluetooth(dev, async () => {
    const t = new BleTrainer(); t.debug = true; t.trace = () => { throw new Error('il registratore è rotto'); }; const got = []; t.onData = d => got.push(d.power);
    await t.connect(); bike.push([0x44, 0, 0xb8, 0x0b, 0xb4, 0, 0xfa, 0]); t.setTargetPower(210); await t.queue;
    assert.deepEqual(got, [250]); assert.ok(t.connected); await t.disconnect();
  });
});

/* ---------- difetti trovati dalla revisione indipendente ---------- */
test('Bluetooth: il Control Point si attiva con startNotifications (startIndications non esiste nel browser) e senza debug il trainer si collega', async () => {
  const { dev, cp } = fakeTrainer();
  assert.equal(typeof Chr.prototype.startIndications, 'undefined', 'il trainer finto è fedele all\'API vera');
  await withBluetooth(dev, async () => {
    const t = new BleTrainer(); await t.connect();
    assert.ok(t.connected); assert.deepEqual(cp.writes, ['00', '07']); await t.disconnect();
  });
});

test('Bluetooth debug: una lettura che non risponde ferma il rilievo, ma il trainer si collega e riceve i comandi', async () => {
  const { dev, cp } = fakeTrainer({ hang: true });
  await withBluetooth(dev, async () => {
    const ev = [], t = new BleTrainer(); t.debug = true; t.trace = (k, d) => ev.push([k, d]);
    const t0 = Date.now(); await t.connect(); const ms = Date.now() - t0;
    assert.ok(t.connected); assert.ok(ms < 3500, 'il rilievo si ferma al primo timeout (' + ms + ' ms)');
    const reads = ev.filter(e => e[0] === 'gatt.read').map(e => e[1]);
    assert.match(reads.find(r => r.label === 'feature').err, /timeout/); assert.ok(reads.some(r => /interrotto/.test(r.err || '')), 'dice che si è fermato');
    assert.ok(!reads.some(r => r.label === 'manufacturer' && r.hex), 'dopo il blocco non fa altre letture');
    t.setTargetPower(160); await t.queue; assert.equal(cp.writes.at(-1), '05 a0 00'); await t.disconnect();
  });
});

test('Bluetooth: se il trainer sparisce mentre ci si collega, non risulta collegato', async () => {
  const { dev } = fakeTrainer({ dropDuring: true });
  await withBluetooth(dev, async () => {
    const t = new BleTrainer(); t.debug = true;
    await assert.rejects(() => t.connect(), /scollegato durante il collegamento/);
    assert.equal(t.connected, false); t.wantConnected = false;                        // niente tentativi di riconnessione in questa prova
  });
});

test('debug: lo stesso oggetto usato in due punti non è «circolare»; un oggetto che contiene sé stesso sì', () => {
  const { r } = mk(); r.start(); const o = { a: 1 }, c = { n: 1 }; c.self = c;
  r.log('x', { x: o, y: o, e1: new Error('a'), z: [o, o], c });
  const d = lines(r)[1].d; assert.deepEqual(d.x, { a: 1 }); assert.deepEqual(d.y, { a: 1 }); assert.deepEqual(d.z, [{ a: 1 }, { a: 1 }]); assert.equal(d.c.self, '[circolare]'); assert.equal(d.e1.message, 'a');
});

test('debug: alla chiusura si aspetta la scrittura già in corso e si salvano anche le righe rimaste; un esito vecchio non tocca la nuova registrazione', async () => {
  const { r } = mk(); let release, got = [];
  r.addSink({ name: 'lenta', every: 0, write(batch) { return new Promise(res => { release = () => { got.push(...batch); res(); }; }); } });
  r.start(); r.log('a'); const first = r.flush(false); r.log('b');                   // prima scrittura ancora in volo
  const closing = r.stop('fine');
  await new Promise(res => setTimeout(res, 5)); release();                           // finisce la prima: la chiusura deve mandare anche 'b' e 'run.end'
  await new Promise(res => setTimeout(res, 5)); release(); await closing; await first;
  assert.deepEqual(got.map(l => JSON.parse(l).k), ['run.start', 'a', 'b', 'run.end'].slice(0, got.length)); assert.equal(JSON.parse(got.at(-1)).k, 'run.end');
  // scrittura vecchia ancora in volo quando parte una nuova registrazione
  const q = mk().r; let rel2; const s2 = q.addSink({ name: 's', every: 0, write() { return new Promise(res => { rel2 = res; }); } });
  q.start(); q.log('x'); q.flush(true); q.on = false; q.start(); rel2(); await new Promise(res => setTimeout(res, 5));
  assert.equal(s2.idx, 0, 'la registrazione nuova riparte da zero');
});
