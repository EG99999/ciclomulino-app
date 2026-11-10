// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Gatti Elia
// Web Bluetooth: trainer FTMS (0x1826) e fascia/orologio FC (0x180D).
// NON provato su hardware reale in questa sessione: i parser sono testati con byte di esempio (vedi test/).
// Modalità debug: ogni dispositivo ha `trace(tipo, dati)` (se impostato) e riceve così ogni pacchetto grezzo in entrata (rx),
// ogni comando in uscita (tx), le decisioni sul carico (target) e gli errori. Senza `trace` non cambia nulla.
export const UUID = {
  ftms: 0x1826, indoorBike: 0x2ad2, control: 0x2ad9, status: 0x2ada, powerRange: 0x2ad8, feature: 0x2acc, trainingStatus: 0x2ad3,
  hr: 0x180d, hrMeasure: 0x2a37,
  csc: 0x1816, cscMeasure: 0x2a5b,          // velocità e cadenza (giri ruota): lo offrono alcuni trainer, il Suito-T non è verificato
  devInfo: 0x180a, battery: 0x180f, cyclingPower: 0x1818    // chiesti solo in modalità debug, per sapere che dispositivo è e cosa offre
};

/* ---------- byte leggibili (solo per il log) ---------- */
export function hex(b) {
  try { const u = b instanceof ArrayBuffer ? new Uint8Array(b) : new Uint8Array(b.buffer, b.byteOffset, b.byteLength); return Array.from(u, x => x.toString(16).padStart(2, '0')).join(' '); } catch { return ''; }
}
const TAIL = '-0000-1000-8000-00805f9b34fb', h4 = n => n.toString(16).padStart(4, '0');
/** 00001826-0000-1000-8000-00805f9b34fb -> 1826; gli UUID a 128 bit dei costruttori restano interi */
export function shortUuid(u) { u = String(u || '').toLowerCase(); return u.endsWith(TAIL) ? (u.startsWith('0000') ? u.slice(4, 8) : u.slice(0, 8)) : u; }
/** impronta corta dell'identificativo del dispositivo (per riconoscere lo stesso apparecchio nel log senza registrare l'id vero) */
const shortHash = s => { if (!s) return null; let h = 5381; for (const c of String(s)) h = ((h * 33) ^ c.charCodeAt(0)) >>> 0; return h.toString(16).padStart(8, '0'); };
const errStr = e => (e ? (e.name ? e.name + ': ' : '') + (e.message || '') : '');
function withTimeout(p, ms) {
  let t; return Promise.race([p, new Promise((_, rej) => { t = setTimeout(() => rej(new Error('timeout ' + ms + ' ms')), ms); })]).finally(() => clearTimeout(t));
}

const MACHINE = ['averageSpeed', 'cadence', 'totalDistance', 'inclination', 'elevationGain', 'pace', 'stepCount', 'resistanceLevel', 'strideCount', 'expendedEnergy', 'heartRate', 'metabolicEquivalent', 'elapsedTime', 'remainingTime', 'powerMeasurement', 'forceOnBelt', 'userDataRetention'];
const TARGETS = ['speed', 'inclination', 'resistance', 'power', 'heartRate', 'energy', 'steps', 'strides', 'distance', 'time', 'timeTwoZones', 'timeThreeZones', 'timeFiveZones', 'bikeSimulation', 'wheelCircumference', 'spinDown', 'cadence'];
/** Fitness Machine Feature (0x2ACC): cosa misura il trainer e cosa si può impostare */
export function decodeFeature(dv) {
  try { const m = dv.getUint32(0, true), t = dv.getUint32(4, true); return { machine: MACHINE.filter((_, i) => m & (1 << i)), target: TARGETS.filter((_, i) => t & (1 << i)) }; } catch { return null; }
}
const CP_OP = { 0: 'requestControl', 1: 'reset', 2: 'targetSpeed', 3: 'targetInclination', 4: 'targetResistance', 5: 'targetPower', 6: 'targetHeartRate', 7: 'startResume', 8: 'stopPause', 0x11: 'bikeSimulation', 0x12: 'wheelCircumference', 0x13: 'spinDown', 0x14: 'targetCadence' };
const CP_RES = { 1: 'ok', 2: 'notSupported', 3: 'invalidParameter', 4: 'failed', 5: 'notPermitted' };
/** risposta del Control Point (0x2AD9): 80, comando richiesto, esito */
export function decodeCp(dv) {
  try { if (dv.getUint8(0) !== 0x80) return { op: CP_OP[dv.getUint8(0)] || dv.getUint8(0) }; const q = dv.getUint8(1), r = dv.getUint8(2); return { resp: CP_OP[q] || '0x' + q.toString(16), result: CP_RES[r] || r }; } catch { return null; }
}
const MS_OP = { 1: 'reset', 2: 'stoppedByUser', 3: 'stoppedBySafetyKey', 4: 'startedByUser', 5: 'targetSpeed', 6: 'targetInclination', 7: 'targetResistance', 8: 'targetPower', 9: 'targetHeartRate', 0x12: 'bikeSimulation', 0x13: 'wheelCircumference', 0x14: 'spinDown', 0x15: 'targetCadence', 0xff: 'controlPermissionLost' };
/** Fitness Machine Status (0x2ADA): ciò che il trainer dice di aver fatto (anche per un tasto premuto su di lui) */
export function decodeStatus(dv) {
  try {
    const op = dv.getUint8(0), o = { st: MS_OP[op] || '0x' + op.toString(16)};
    if (op === 8 && dv.byteLength >= 3) o.w = dv.getInt16(1, true);
    if (op === 2 && dv.byteLength >= 2) o.param = dv.getUint8(1) === 1 ? 'stop' : dv.getUint8(1) === 2 ? 'pause' : dv.getUint8(1);
    return o;
  } catch { return null; }
}
const TRAINING = ['other', 'idle', 'warmingUp', 'lowIntensityInterval', 'highIntensityInterval', 'recovery', 'isometric', 'heartRateControl', 'fitnessTest', 'speedOutsideLow', 'speedOutsideHigh', 'coolDown', 'wattControl', 'manualMode', 'preWorkout', 'postWorkout'];
export function decodeTrainingStatus(dv) { try { return { status: TRAINING[dv.getUint8(1)] || dv.getUint8(1) }; } catch { return null; } }
/** Heart Rate Measurement: oltre ai bpm, contatto del sensore e intervalli RR (per il log) */
export function parseHrExtra(dv) {
  try {
    const f = dv.getUint8(0), o = { flags: f, contact: f & 0x04 ? (f & 0x02 ? 'sì' : 'no') : 'n.d.' }; let p = f & 0x01 ? 3 : 2;
    if (f & 0x08) p += 2;
    if (f & 0x10) { const rr = []; for (; p + 1 < dv.byteLength && rr.length < 4; p += 2) rr.push(Math.round(dv.getUint16(p, true) / 1.024)); o.rrMs = rr; }
    return o;
  } catch { return null; }
}

/** CSC Measurement (0x2A5B) -> giri ruota cumulativi + tempo dell'ultimo giro (1/1024 s) e, se presenti, giri pedivella. */
export function parseCsc(dv) {
  const out = { wheelRevs: null, wheelTime: null, crankRevs: null, crankTime: null };
  try {
    const f = dv.getUint8(0); let o = 1;
    if (f & 0x01) { out.wheelRevs = dv.getUint32(o, true); out.wheelTime = dv.getUint16(o + 4, true); o += 6; }
    if (f & 0x02) { out.crankRevs = dv.getUint16(o, true); out.crankTime = dv.getUint16(o + 2, true); }
  } catch { /* pacchetto incompleto */ }
  return out;
}

/** Velocità reale dai giri della ruota: km/h = giri × circonferenza ÷ tempo. Gestisce il ritorno a zero dei contatori e la ruota ferma. */
export class WheelSpeed {
  constructor() { this.prev = null; this.kmh = null; this.at = 0; }
  /** circM = circonferenza in metri; now = ms. Ritorna i km/h (o null se ancora non si può dire). */
  push(revs, time, circM, now = Date.now()) {
    if (revs == null || time == null || !(circM > 0.5 && circM < 3)) return this.kmh;
    const p = this.prev;
    if (!p) { this.prev = { revs, time, at: now }; return this.kmh; }
    const dr = (revs - p.revs) >>> 0, dt = ((time - p.time) & 0xffff) / 1024;
    if (dr === 0 || dt === 0) { if (now - p.at > 2500) { this.kmh = 0; this.at = now; } return this.kmh; }
    const k = dr * circM / dt * 3.6;
    this.prev = { revs, time, at: now };
    if (dr < 100000 && k >= 0 && k < 120) { this.kmh = k; this.at = now; }   // valori assurdi (salto del contatore) vengono ignorati
    return this.kmh;
  }
  reset() { this.prev = null; this.kmh = null; this.at = 0; }
}

/** Indoor Bike Data (0x2AD2) -> {speed km/h, cadence rpm, power W, hr} (campi assenti = null). */
export function parseIndoorBikeData(dv) {
  const out = { speed: null, cadence: null, power: null, hr: null, distance: null };
  try {                                                // un pacchetto troppo corto lancia RangeError: tengo ciò che ho già letto
    const flags = dv.getUint16(0, true);
    let o = 2;
    if (!(flags & 0x0001)) { out.speed = dv.getUint16(o, true) * 0.01; o += 2; }      // bit0 = "more data": 0 => velocità presente
    if (flags & 0x0002) o += 2;                                                       // velocità media
    if (flags & 0x0004) { out.cadence = dv.getUint16(o, true) * 0.5; o += 2; }
    if (flags & 0x0008) o += 2;                                                       // cadenza media
    if (flags & 0x0010) { out.distance = dv.getUint16(o, true) | (dv.getUint8(o + 2) << 16); o += 3; }
    if (flags & 0x0020) o += 2;                                                       // livello resistenza
    if (flags & 0x0040) { out.power = dv.getInt16(o, true); o += 2; }
    if (flags & 0x0080) o += 2;                                                       // potenza media
    if (flags & 0x0100) o += 5;                                                       // energia (2+2+1)
    if (flags & 0x0200) { out.hr = dv.getUint8(o); o += 1; }
  } catch { /* pacchetto incompleto */ }
  return out;
}

/** Heart Rate Measurement (0x2A37) -> bpm. */
export function parseHeartRate(dv) {
  try { const flags = dv.getUint8(0); return flags & 0x01 ? dv.getUint16(1, true) : dv.getUint8(1); } catch { return 0; }   // pacchetto corto → nessun valore
}

/** Comando Set Target Power (opcode 0x05, sint16 W). */
export function cmdSetTargetPower(w) {
  const b = new DataView(new ArrayBuffer(3));
  b.setUint8(0, 0x05); b.setInt16(1, Math.max(-32768, Math.min(32767, Number.isFinite(w) ? Math.round(w) : 0)), true);   // niente giri a vuoto (wrap) oltre i 16 bit
  return b.buffer;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

export function bleAvailable() { return typeof navigator !== 'undefined' && !!navigator.bluetooth; }

const PROPS = ['broadcast', 'read', 'writeWithoutResponse', 'write', 'notify', 'indicate', 'authenticatedSignedWrites', 'reliableWrite', 'writableAuxiliaries'];
const text = v => { try { return new TextDecoder().decode(v).replace(/\0/g, ''); } catch { return ''; } };
/**
 * Solo debug: elenca i servizi e le caratteristiche che il dispositivo offre al browser e ne legge alcune statiche
 * (funzioni supportate, intervalli, produttore, modello, firmware, batteria). Ogni passo ha un tempo massimo; non lancia mai errori.
 * `reads` = [[servizio, caratteristica, etichetta, comeTesto?]]
 */
async function survey(server, t, reads) {
  const t0 = Date.now(), left = () => Date.now() - t0 < 7000;
  // un'operazione GATT scaduta resta appesa nel browser: al primo timeout (o «operation already in progress») il rilievo si ferma, per non accavallare altre operazioni
  let stuck = false; const hung = e => /timeout|in progress/i.test(String((e && e.message) || ''));
  try {
    const list = await withTimeout(server.getPrimaryServices(), 3000), map = [];
    for (const s of list) {
      const row = { s: shortUuid(s.uuid), chars: [] };
      if (left() && !stuck) { try { for (const c of await withTimeout(s.getCharacteristics(), 3000)) row.chars.push({ c: shortUuid(c.uuid), p: PROPS.filter(k => c.properties && c.properties[k]).join(',') }); } catch (e) { row.err = errStr(e); if (hung(e)) stuck = true; } }
      map.push(row);
    }
    t('gatt.map', { services: map });
    for (const [su, cu, label, asText] of reads) {
      if (stuck || !left()) { t('gatt.read', { label, err: stuck ? 'rilievo interrotto: operazione GATT bloccata' : 'tempo massimo del rilievo' }); break; }
      const svc = list.find(s => shortUuid(s.uuid) === h4(su)); if (!svc) continue;
      try {
        const v = await withTimeout((await withTimeout(svc.getCharacteristic(cu), 2000)).readValue(), 2000), o = { label, c: h4(cu), hex: hex(v) };
        if (asText) o.text = text(v); else if (label === 'feature') o.dec = decodeFeature(v); else if (label === 'battery') o.pct = v.getUint8(0);
        t('gatt.read', o);
      } catch (e) { t('gatt.read', { label, c: h4(cu), err: errStr(e) }); if (hung(e)) stuck = true; }
    }
  } catch (e) { t('gatt.map', { err: errStr(e) }); }
}
const DEVINFO_READS = [[UUID.devInfo, 0x2a29, 'manufacturer', true], [UUID.devInfo, 0x2a24, 'model', true], [UUID.devInfo, 0x2a26, 'firmware', true], [UUID.devInfo, 0x2a27, 'hardware', true], [UUID.devInfo, 0x2a28, 'software', true], [UUID.battery, 0x2a19, 'battery']];

class Base {
  constructor() {
    this.device = null; this.server = null; this.connected = false; this.onData = null; this.onState = null; this.wantConnected = false; this.retry = 0;
    this.trace = null; this.debug = false; this.step = ''; this._subs = new Map();
    this.stats = { rx: 0, last: 0, by: {}, lastBy: {}, wr: 0, wrErr: 0, supp: 0 };
  }
  /** manda un evento al registratore di debug (se c'è); il debug non deve mai disturbare il dispositivo */
  _t(kind, data) { if (!this.trace) return; try { this.trace(kind, data); } catch { /* ignora */ } }
  _state(s, msg) { this.state = s; this._t('state', { s, msg: msg || null }); this.onState && this.onState(s, msg); }
  /** ascolta una caratteristica una volta sola, anche dopo una riconnessione (altrimenti ogni pacchetto verrebbe elaborato due volte) */
  _listen(ch, fn) {
    const k = shortUuid(ch.uuid), old = this._subs.get(k);
    if (old) { try { old.ch.removeEventListener('characteristicvaluechanged', old.fn); } catch { /* ignora */ } }
    this._subs.set(k, { ch, fn }); ch.addEventListener('characteristicvaluechanged', fn);
  }
  /** pacchetto in entrata: conta, misura il tempo dall'ultimo della stessa caratteristica e lo registra grezzo */
  _rx(c, v, parsed, extra) {
    const s = this.stats, now = Date.now(), prev = s.lastBy[c];
    s.rx++; s.last = now; s.by[c] = (s.by[c] || 0) + 1; s.lastBy[c] = now;
    if (this.trace) { const o = { c, hex: hex(v), gap: prev ? now - prev : null }; if (parsed) o.p = parsed; if (extra) Object.assign(o, extra); this._t('rx', o); }
  }
  async disconnect() {
    this.wantConnected = false;
    this._t('disconnect', { by: 'app' });
    try { this.device && this.device.gatt.connected && this.device.gatt.disconnect(); } catch { /* ignora */ }
    this.connected = false; this._state('off');
  }
  /** riconnessione automatica con attesa crescente (max 8 tentativi) */
  _watch() {
    this.device.addEventListener('gattserverdisconnected', async () => {
      this.connected = false;
      this._t('gatt.disconnected', { wanted: this.wantConnected });
      if (!this.wantConnected) return;
      this._state('lost');
      for (this.retry = 1; this.retry <= 8 && this.wantConnected; this.retry++) {
        const wait = Math.min(1000 * this.retry, 6000);
        await sleep(wait);
        if (!this.wantConnected) return;
        this._state('retry', `tentativo ${this.retry}/8`);
        try { await this._open(); this.retry = 0; this._state('on'); return; } catch (e) { this._t('gatt.retry', { n: this.retry, wait, err: errStr(e) }); }
      }
      if (this.wantConnected) { this.wantConnected = false; this._state('off', 'riconnessione fallita'); }
    });
  }
}

export class BleTrainer extends Base {
  constructor() { super(); this.kind = 'ble'; this.range = null; this.queue = Promise.resolve(); this.lastW = null; this.lastSent = 0; this.name = ''; this._surveyed = false; this._wAt = 0; }
  async connect() {
    this._state('scan');
    const optional = [UUID.csc, ...(this.debug ? [UUID.devInfo, UUID.battery, UUID.cyclingPower] : [])];
    this._t('request', { filter: h4(UUID.ftms), optional: optional.map(h4) });
    this.device = await navigator.bluetooth.requestDevice({ filters: [{ services: [UUID.ftms] }], optionalServices: optional });
    this.name = this.device.name || 'Trainer';
    this._t('device', { name: this.name, id: shortHash(this.device.id) });
    this.wantConnected = true;
    this._watch();
    await this._open();
    this._state('on');
  }
  async _open() {
    try { await this._openInner(); } catch (e) { this._t('open.fail', { step: this.step, err: errStr(e) }); throw e; }
  }
  async _openInner() {
    this.step = 'gatt.connect'; this.server = await this.device.gatt.connect();
    this.step = 'ftms'; const svc = await this.server.getPrimaryService(UUID.ftms);
    this.step = 'indoorBike'; const bike = await svc.getCharacteristic(UUID.indoorBike);
    this._listen(bike, e => { const v = e.target.value, d = parseIndoorBikeData(v); let fl = null; try { fl = v.getUint16(0, true); } catch { /* corto */ } this._rx('2ad2', v, d, { fl }); this.onData && this.onData(d); });
    await bike.startNotifications();
    this.step = 'controlPoint'; this.cp = await svc.getCharacteristic(UUID.control);
    this._listen(this.cp, e => this._onCp(e.target.value));
    await this.cp.startNotifications();                 // il Control Point è «indicate»: in Web Bluetooth startNotifications() attiva le indicazioni (startIndications() non esiste)
    this.step = 'csc'; this.hasCsc = false;
    try { const cs = await this.server.getPrimaryService(UUID.csc), ch = await cs.getCharacteristic(UUID.cscMeasure); this._listen(ch, e => { const v = e.target.value, c = parseCsc(v); this._rx('2a5b', v, c); this.onData && this.onData({ csc: c }); }); await ch.startNotifications(); this.hasCsc = true; this._t('csc', { offered: true }); } catch (e) { this._t('csc', { offered: false, err: errStr(e) }); /* il trainer non offre i giri ruota: resta la velocità dell'FTMS */ }
    this.step = 'status';
    try { const st = await svc.getCharacteristic(UUID.status); this._listen(st, e => { const v = e.target.value; this._rx('2ada', v, null, { st: decodeStatus(v) }); this.onStatus && this.onStatus(v); }); await st.startNotifications(); } catch (e) { this._t('status', { offered: false, err: errStr(e) }); /* opzionale */ }
    if (this.debug) {
      this.step = 'trainingStatus';
      try { const ts = await svc.getCharacteristic(UUID.trainingStatus); this._listen(ts, e => { const v = e.target.value; this._rx('2ad3', v, null, decodeTrainingStatus(v)); }); await ts.startNotifications(); } catch (e) { this._t('trainingStatus', { offered: false, err: errStr(e) }); }
    }
    this.step = 'powerRange';
    try { const r = await (await svc.getCharacteristic(UUID.powerRange)).readValue(); this.range = { min: r.getInt16(0, true), max: r.getInt16(2, true) }; this._t('gatt.read', { label: 'powerRange', c: '2ad8', hex: hex(r), range: this.range }); } catch (e) { this._t('gatt.read', { label: 'powerRange', c: '2ad8', err: errStr(e) }); /* opzionale */ }
    this.step = 'requestControl'; await this._write(Uint8Array.of(0x00));            // Request Control
    this.step = 'start'; await this._write(Uint8Array.of(0x07));            // Start / Resume
    if (this.debug && !this._surveyed) {                // una volta sola per collegamento: che servizi e funzioni offre davvero il Suito-T. Dopo i comandi essenziali e prima che l'app mandi watt (connected è ancora falso): le letture non si sovrappongono a nessuna scrittura
      this._surveyed = true; this.step = 'survey';
      await survey(this.server, (k, d) => this._t(k, d), [[UUID.ftms, UUID.feature, 'feature'], [UUID.ftms, 0x2ad6, 'resistanceRange'], [UUID.ftms, 0x2ad5, 'inclinationRange'], ...DEVINFO_READS]);
    }
    if (!this.device.gatt.connected) throw new Error('dispositivo scollegato durante il collegamento');       // se è sparito nel frattempo non lo segno come collegato
    this.connected = true; this.lastW = null; this.step = 'open';
  }
  _onCp(dv) {
    let n = 0; try { n = dv.byteLength; } catch { /* ignora */ }
    this._rx('2ad9', dv, null, { cp: decodeCp(dv), lat: this._wAt ? Date.now() - this._wAt : null });
    if (n < 3) return;                                // risposta troppo corta: niente da controllare
    // risposta: 0x80, opcode richiesto, risultato (1 = ok)
    if (dv.getUint8(0) === 0x80 && dv.getUint8(1) === 0x11 && dv.getUint8(2) !== 0x01) { this.simUnsupported = true; this.onError && this.onError('Il trainer non accetta la modalità a pendenza: uso un carico fisso (↑/↓)'); return; }
    if (dv.getUint8(0) === 0x80 && dv.getUint8(2) !== 0x01 && this.onError) this.onError(`Comando 0x${dv.getUint8(1).toString(16)} rifiutato (codice ${dv.getUint8(2)})`);
  }
  _write(buf) {
    // le scritture sul Control Point non possono sovrapporsi
    const t0 = Date.now(), h = this.trace ? hex(buf) : ''; let ts = 0;
    this.stats.wr++;
    this.queue = this.queue.then(() => { ts = Date.now(); this._wAt = ts; return this.cp.writeValueWithResponse(buf); })
      .then(() => { this._t('tx', { c: '2ad9', hex: h, q: ts - t0, ms: Date.now() - ts }); })
      .catch(e => { this.stats.wrErr++; this._t('tx', { c: '2ad9', hex: h, q: ts ? ts - t0 : null, err: errStr(e) }); this.onError && this.onError(e.message); });
    return this.queue;
  }
  /** modalità a pendenza (FTMS 0x11): vento, pendenza (0,01%), Crr (0,0001), Cw (0,01 kg/m). Se il trainer risponde "non supportato" resta simUnsupported = true. */
  setSimulation(grade) {
    if (!this.connected || this.simUnsupported) return false;
    const b = new DataView(new ArrayBuffer(7)); b.setUint8(0, 0x11); b.setInt16(1, 0, true); b.setInt16(3, Math.round(Math.max(-30, Math.min(30, grade)) * 100), true); b.setUint8(5, 40); b.setUint8(6, 51);
    this.lastW = null; this._t('sim', { grade }); this._write(b.buffer); return true;
  }
  /** invia il setpoint solo se cambia di ≥1 W o ogni 3 s (keep-alive) */
  setTargetPower(w) {
    if (!this.connected) return;
    const asked = w;
    if (!Number.isFinite(w)) w = 50;                       // valore non valido: carico minimo
    w = Math.max(0, Math.min(2000, w));                    // tetto assoluto, anche se il trainer non dichiara il suo range
    if (this.range) w = Math.max(this.range.min, Math.min(this.range.max, w));
    const now = Date.now();
    if (this.lastW !== null && Math.abs(w - this.lastW) < 1 && now - this.lastSent < 3000) { this.stats.supp++; return; }
    if (this.trace) this._t('target', { asked: Number.isFinite(asked) ? asked : String(asked), w, prev: this.lastW, since: this.lastSent ? now - this.lastSent : null, supp: this.stats.supp });
    this.stats.supp = 0;
    this.lastW = w; this.lastSent = now;
    this._write(cmdSetTargetPower(w));
  }
  async disconnect() {
    try { if (this.connected) await this._write(Uint8Array.of(0x08, 0x01)); } catch { /* ignora */ }
    await super.disconnect();
  }
}

export class BleHr extends Base {
  constructor() { super(); this.kind = 'ble'; this.name = ''; this._surveyed = false; }
  async connect() {
    this._state('scan');
    const optional = this.debug ? [UUID.devInfo, UUID.battery] : [];
    this._t('request', { filter: h4(UUID.hr), optional: optional.map(h4) });
    this.device = await navigator.bluetooth.requestDevice({ filters: [{ services: [UUID.hr] }], optionalServices: optional });
    this.name = this.device.name || 'FC';
    this._t('device', { name: this.name, id: shortHash(this.device.id) });
    this.wantConnected = true;
    this._watch();
    await this._open();
    this._state('on');
  }
  async _open() {
    try {
      this.step = 'gatt.connect'; this.server = await this.device.gatt.connect();
      this.step = 'hr'; const svc = await this.server.getPrimaryService(UUID.hr);
      const ch = await svc.getCharacteristic(UUID.hrMeasure);
      this._listen(ch, e => { const v = e.target.value, bpm = parseHeartRate(v); this._rx('2a37', v, { bpm }, this.trace ? parseHrExtra(v) : null); this.onData && this.onData(bpm); });
      await ch.startNotifications();
      this.connected = true; this.step = 'open';
      if (this.debug && !this._surveyed) { this._surveyed = true; survey(this.server, (k, d) => this._t(k, d), [[UUID.hr, 0x2a38, 'bodySensorLocation'], ...DEVINFO_READS]).catch(() => { /* ignora */ }); }
    } catch (e) { this._t('open.fail', { step: this.step, err: errStr(e) }); throw e; }
  }
}
