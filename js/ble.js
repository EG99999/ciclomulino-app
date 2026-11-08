// Web Bluetooth: trainer FTMS (0x1826) e fascia/orologio FC (0x180D).
// NON provato su hardware reale in questa sessione: i parser sono testati con byte di esempio (vedi test/).
export const UUID = {
  ftms: 0x1826, indoorBike: 0x2ad2, control: 0x2ad9, status: 0x2ada, powerRange: 0x2ad8, feature: 0x2acc,
  hr: 0x180d, hrMeasure: 0x2a37
};

/** Indoor Bike Data (0x2AD2) -> {speed km/h, cadence rpm, power W, hr} (campi assenti = null). */
export function parseIndoorBikeData(dv) {
  const flags = dv.getUint16(0, true);
  let o = 2;
  const out = { speed: null, cadence: null, power: null, hr: null, distance: null };
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
  return out;
}

/** Heart Rate Measurement (0x2A37) -> bpm. */
export function parseHeartRate(dv) {
  const flags = dv.getUint8(0);
  return flags & 0x01 ? dv.getUint16(1, true) : dv.getUint8(1);
}

/** Comando Set Target Power (opcode 0x05, sint16 W). */
export function cmdSetTargetPower(w) {
  const b = new DataView(new ArrayBuffer(3));
  b.setUint8(0, 0x05); b.setInt16(1, Math.round(w), true);
  return b.buffer;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

export function bleAvailable() { return typeof navigator !== 'undefined' && !!navigator.bluetooth; }

class Base {
  constructor() { this.device = null; this.server = null; this.connected = false; this.onData = null; this.onState = null; this.wantConnected = false; this.retry = 0; }
  _state(s, msg) { this.state = s; this.onState && this.onState(s, msg); }
  async disconnect() {
    this.wantConnected = false;
    try { this.device && this.device.gatt.connected && this.device.gatt.disconnect(); } catch { /* ignora */ }
    this.connected = false; this._state('off');
  }
  /** riconnessione automatica con attesa crescente (max 8 tentativi) */
  _watch() {
    this.device.addEventListener('gattserverdisconnected', async () => {
      this.connected = false;
      if (!this.wantConnected) return;
      this._state('lost');
      for (this.retry = 1; this.retry <= 8 && this.wantConnected; this.retry++) {
        await sleep(Math.min(1000 * this.retry, 6000));
        if (!this.wantConnected) return;
        this._state('retry', `tentativo ${this.retry}/8`);
        try { await this._open(); this.retry = 0; this._state('on'); return; } catch { /* riprova */ }
      }
      if (this.wantConnected) { this.wantConnected = false; this._state('off', 'riconnessione fallita'); }
    });
  }
}

export class BleTrainer extends Base {
  constructor() { super(); this.kind = 'ble'; this.range = null; this.queue = Promise.resolve(); this.lastW = null; this.lastSent = 0; this.name = ''; }
  async connect() {
    this._state('scan');
    this.device = await navigator.bluetooth.requestDevice({ filters: [{ services: [UUID.ftms] }] });
    this.name = this.device.name || 'Trainer';
    this.wantConnected = true;
    this._watch();
    await this._open();
    this._state('on');
  }
  async _open() {
    this.server = await this.device.gatt.connect();
    const svc = await this.server.getPrimaryService(UUID.ftms);
    const bike = await svc.getCharacteristic(UUID.indoorBike);
    bike.addEventListener('characteristicvaluechanged', e => { const d = parseIndoorBikeData(e.target.value); this.onData && this.onData(d); });
    await bike.startNotifications();
    this.cp = await svc.getCharacteristic(UUID.control);
    this.cp.addEventListener('characteristicvaluechanged', e => this._onCp(e.target.value));
    await this.cp.startIndications();
    try { const st = await svc.getCharacteristic(UUID.status); st.addEventListener('characteristicvaluechanged', e => this.onStatus && this.onStatus(e.target.value)); await st.startNotifications(); } catch { /* opzionale */ }
    try { const r = await (await svc.getCharacteristic(UUID.powerRange)).readValue(); this.range = { min: r.getInt16(0, true), max: r.getInt16(2, true) }; } catch { /* opzionale */ }
    await this._write(Uint8Array.of(0x00));            // Request Control
    await this._write(Uint8Array.of(0x07));            // Start / Resume
    this.connected = true; this.lastW = null;
  }
  _onCp(dv) {
    // risposta: 0x80, opcode richiesto, risultato (1 = ok)
    if (dv.getUint8(0) === 0x80 && dv.getUint8(1) === 0x11 && dv.getUint8(2) !== 0x01) { this.simUnsupported = true; this.onError && this.onError('Il trainer non accetta la modalità a pendenza: uso un carico fisso (↑/↓)'); return; }
    if (dv.getUint8(0) === 0x80 && dv.getUint8(2) !== 0x01 && this.onError) this.onError(`Comando 0x${dv.getUint8(1).toString(16)} rifiutato (codice ${dv.getUint8(2)})`);
  }
  _write(buf) {
    // le scritture sul Control Point non possono sovrapporsi
    this.queue = this.queue.then(() => this.cp.writeValueWithResponse(buf)).catch(e => { this.onError && this.onError(e.message); });
    return this.queue;
  }
  /** modalità a pendenza (FTMS 0x11): vento, pendenza (0,01%), Crr (0,0001), Cw (0,01 kg/m). Se il trainer risponde "non supportato" resta simUnsupported = true. */
  setSimulation(grade) {
    if (!this.connected || this.simUnsupported) return false;
    const b = new DataView(new ArrayBuffer(7)); b.setUint8(0, 0x11); b.setInt16(1, 0, true); b.setInt16(3, Math.round(Math.max(-30, Math.min(30, grade)) * 100), true); b.setUint8(5, 40); b.setUint8(6, 51);
    this.lastW = null; this._write(b.buffer); return true;
  }
  /** invia il setpoint solo se cambia di ≥1 W o ogni 3 s (keep-alive) */
  setTargetPower(w) {
    if (!this.connected) return;
    if (this.range) w = Math.max(this.range.min, Math.min(this.range.max, w));
    const now = Date.now();
    if (this.lastW !== null && Math.abs(w - this.lastW) < 1 && now - this.lastSent < 3000) return;
    this.lastW = w; this.lastSent = now;
    this._write(cmdSetTargetPower(w));
  }
  async disconnect() {
    try { if (this.connected) await this._write(Uint8Array.of(0x08, 0x01)); } catch { /* ignora */ }
    await super.disconnect();
  }
}

export class BleHr extends Base {
  constructor() { super(); this.kind = 'ble'; this.name = ''; }
  async connect() {
    this._state('scan');
    this.device = await navigator.bluetooth.requestDevice({ filters: [{ services: [UUID.hr] }] });
    this.name = this.device.name || 'FC';
    this.wantConnected = true;
    this._watch();
    await this._open();
    this._state('on');
  }
  async _open() {
    this.server = await this.device.gatt.connect();
    const svc = await this.server.getPrimaryService(UUID.hr);
    const ch = await svc.getCharacteristic(UUID.hrMeasure);
    ch.addEventListener('characteristicvaluechanged', e => this.onData && this.onData(parseHeartRate(e.target.value)));
    await ch.startNotifications();
    this.connected = true;
  }
}
