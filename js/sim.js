// Simulatore integrato di trainer + FC (stessa interfaccia dei dispositivi BLE, più tick(dt)).
import { speedFor } from './physics.js';
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export class SimTrainer {
  constructor(ftp = 271) {
    this.kind = 'sim'; this.name = 'Simulatore'; this.ftp = ftp;
    this.connected = false; this.onData = null; this.onState = null;
    this.cadBase = 88; this.fatigueOn = false; this.fat = 0;
    this.target = 0; this.simGrade = null; this.manual = null; this.power = 0; this.cad = 0; this.pedaling = true;
    this.hr = 70; this.lastData = 0;
  }
  async connect() {
    this.onState && this.onState('scan');
    await new Promise(r => setTimeout(r, this.fast ? 0 : 600));
    this.connected = true; this.onState && this.onState('on');
  }
  async disconnect() { this.connected = false; this.power = 0; this.cad = 0; this.onState && this.onState('off'); }
  /** perdita di segnale simulata: il resto dell'app deve andare in pausa */
  drop() { this.connected = false; this.power = 0; this.cad = 0; this.onState && this.onState('lost'); }
  async reconnect() { await new Promise(r => setTimeout(r, this.fast ? 0 : 800)); this.connected = true; this.onState && this.onState('on'); }
  setTargetPower(w) { this.target = w; this.simGrade = null; }
  /** modalità a pendenza (pedalata libera): la potenza segue la cadenza e la salita */
  setSimulation(grade) { this.simGrade = grade; return true; }
  tick(dt) {
    if (!this.connected) return;
    // la fatica sale quando il carico è alto, scende quando è basso (così il carico ridotto la fa recuperare)
    const tgt = this.manual != null ? this.manual : this.simGrade != null ? Math.max(0, 120 + 14 * this.simGrade) : this.target, rel = tgt / this.ftp;
    this.fat = clamp(this.fat + (rel > 0.85 ? dt / 90 : -dt / 60), 0, 1);
    const hard = clamp((rel - 0.5) / 0.4, 0, 1);
    const cadT = this.pedaling ? this.cadBase - (this.fatigueOn ? 42 * this.fat * hard : 0) + (Math.random() - 0.5) * 3 : 0;
    this.cad += (cadT - this.cad) * Math.min(1, dt * 2);
    this.power += (tgt - this.power) * Math.min(1, dt * (this.manual != null ? 2 : 3));
    const p = this.power > 1 ? this.power * (1 + (Math.random() - 0.5) * 0.012) : 0;
    const hrT = 62 + 0.34 * this.power;
    this.hr += (hrT - this.hr) * Math.min(1, dt / 30);
    this.last = { power: Math.round(p), cadence: Math.round(this.cad * 2) / 2, speed: p > 1 ? Math.round(speedFor(p, 0) * 360) / 100 : 0, hr: null };   // km/h su strada piana, come lo manderebbe un trainer
    this.onData && this.onData(this.last);
  }
}

export class SimHr {
  constructor(trainer) { this.kind = 'sim'; this.name = 'FC simulata'; this.trainer = trainer; this.connected = false; this.onData = null; this.onState = null; }
  async connect() { this.connected = true; this.onState && this.onState('on'); }
  async disconnect() { this.connected = false; this.onState && this.onState('off'); }
  tick() { if (this.connected && this.onData) this.onData(Math.round(this.trainer.hr)); }
}
