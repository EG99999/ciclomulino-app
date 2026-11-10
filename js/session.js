// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Gatti Elia
// Motore della seduta: avanzamento step, setpoint ERG, statistiche, registrazione per il FIT.
import { Erg, ramp, ERG_CFG } from './erg.js';
import { speedFor } from './physics.js';

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export class Session {
  /** @param plan seduta già validata (parsePlan) @param ftp numero */
  constructor(plan, ftp, cfg = {}) {
    this.plan = plan; this.ftp = ftp; this.steps = plan.steps;
    this.cfg = { autoPauseSec: 5, autoResumeSec: 2, ...ERG_CFG, ...cfg };
    this.erg = new Erg(this.cfg);
    this.reset();
  }
  reset() {
    this.erg.reset();
    Object.assign(this, {
      started: false, paused: false, pauseReason: '', done: false, doneReason: '',
      t: 0, idx: 0, stepT: 0, stepDist: 0, dist: 0, speed: 0,
      fromW: this.cfg.minLoadW, rampT: 0, base: 0, targetW: 0,
      samples: [], stAcc: 0, stAccT: 0, totAcc: 0, totT: 0, hrAcc: 0, hrN: 0,
      records: [], nextRec: 1, lastBeep: 99, events: [], startedAt: null, maxP: 0, kj: 0, stillT: 0, moveT: 0, grade: 0, bias: 0
    });
  }
  get step() { return this.steps[Math.min(this.idx, this.steps.length - 1)]; }
  get next() { return this.steps[this.idx + 1] || null; }
  get active() { return this.started && !this.paused && !this.done; }
  get totalEst() { return this.plan.total; }
  /** posizione (s) nel piano stimato, per profilo/mappa */
  get planPos() {
    const s = this.step, f = this.stepFrac();
    return s.start + f * s.dEst;
  }
  stepFrac() {
    const s = this.step;
    return clamp(s.d != null ? this.stepT / s.d : this.stepDist / s.dist, 0, 1);
  }
  /** secondi rimanenti dello step (stima per quelli a distanza) */
  stepRemaining() {
    const s = this.step;
    if (s.d != null) return Math.max(0, s.d - this.stepT);
    return Math.max(0, (s.dist - this.stepDist) / Math.max(1.5, this.speed));
  }
  emit(type, data) { this.events.push({ type, t: this.t, ...data }); }
  drain() { const e = this.events; this.events = []; return e; }

  start(now = Date.now()) {
    if (this.started) return;
    this.started = true; this.paused = false; this.startedAt = now;
    this.fromW = this.cfg.minLoadW; this.rampT = 0;
    this.emit('start');
  }
  pause(reason = 'manual') {
    if (!this.started || this.paused || this.done) return;
    this.paused = true; this.pauseReason = reason; this.emit('pause', { reason });
  }
  resume() {
    if (!this.paused) return;
    this.paused = false; this.pauseReason = '';
    this.fromW = this.cfg.minLoadW; this.rampT = 0;       // riparte da carico minimo con rampa
    this.emit('resume');
  }
  togglePause() { this.paused ? this.resume() : this.pause('manual'); }
  /** regola il carico dello step (solo se lo step lo permette, es. test FTP 20'): ±watt */
  adjust(delta) { if (!this.step.adjust || !this.active) return false; this.bias = clamp(this.bias + delta, -150, 150); this.emit('bias', { bias: this.bias }); return true; }
  skip() {
    if (!this.active) return;
    this._advance();
  }
  finish(reason = 'completed') {
    if (this.done) return;
    this.done = true; this.doneReason = reason; this.emit('finish', { reason });
  }
  _advance() {
    const prev = this.step;
    this.fromW = this.base || prev.mid;
    this.rampT = 0; this.stepT = 0; this.stepDist = 0; this.stAcc = 0; this.stAccT = 0; this.lastBeep = 99; this.bias = 0;
    if (this.idx + 1 >= this.steps.length) { this.finish('completed'); return; }
    this.idx++;
    this.emit('step', { step: this.step, idx: this.idx });
  }

  /**
   * Avanza di dt secondi (≤ ~0.25 s per chiamata). input: {power, cad, hr, connected}.
   * Restituisce il setpoint (W) da mandare al trainer.
   */
  update(dt, input) {
    const { power = 0, hr = null, connected = true, grade = null } = input;
    // la cadenza può mancare (null/NaN): alcuni trainer non la mandano. In quel caso decidono i watt e la logica ERG sulla cadenza resta ferma
    const cadKnown = Number.isFinite(input.cad), cad = cadKnown ? input.cad : 0;
    if (this.started && !this.done && !connected && !this.paused) this.pause('trainer');
    // auto-pausa se ti fermi sui pedali, ripresa automatica quando riparti (come Zwift)
    if (this.started && !this.done && connected) {
      const still = (!cadKnown || cad < 5) && power < 8;
      const moving = (cadKnown && cad > 30) || power >= 30;      // si riparte pedalando: la cadenza oltre 30 rpm oppure almeno 30 W (se la cadenza non arriva o è a zero, bastano i watt)
      if (!this.paused) { this.stillT = still ? this.stillT + dt : 0; if (this.stillT >= this.cfg.autoPauseSec) { this.stillT = 0; this.pause('auto'); } }
      else if (this.pauseReason === 'auto') { this.moveT = moving ? this.moveT + dt : 0; if (this.moveT >= this.cfg.autoResumeSec) { this.moveT = 0; this.resume(); } }
    }
    const active = this.active;
    const s = this.step;
    if (active) {
      this.t += dt; this.stepT += dt; this.rampT += dt;
      this.grade = s.grade != null ? s.grade : (grade != null ? grade : s.slope);   // pendenza forzata dal coach > percorso reale > generata dal workout
      this.speed = speedFor(power, this.grade);
      this.stepDist += this.speed * dt; this.dist += this.speed * dt;
      // fine step
      const over = s.d != null ? this.stepT >= s.d : this.stepDist >= s.dist;
      if (over) this._advance();
      // beep ultimi 3"
      if (!this.done) {
        const rc = Math.ceil(this.stepRemaining());
        if (rc <= 3 && rc >= 1 && rc < this.lastBeep && this.step === s) { this.lastBeep = rc; this.emit('tick', { sec: rc }); }
      }
    } else this.speed = 0;

    if (!this.cfg.noErg) for (const e of this.erg.update(dt, cadKnown ? cad : NaN, active && connected)) this.emit(e);   // noErg: test FTP e pedalata libera, nessuna riduzione automatica

    const cur = this.step;
    this.base = ramp(this.fromW, cur.mid, this.rampT, this.cfg.stepRampSec);
    let target = this.base * this.erg.L + (cur.adjust ? this.bias : 0);
    if (!this.started || this.done) target = 0;
    else if (this.paused) target = this.cfg.minLoadW;
    this.targetW = Math.round(target);

    if (active) {
      this.samples.push({ t: this.t, p: power });
      while (this.samples.length && this.samples[0].t < this.t - 3) this.samples.shift();
      this.stAcc += power * dt; this.stAccT += dt; this.totAcc += power * dt; this.totT += dt;
      this.kj += power * dt / 1000; this.maxP = Math.max(this.maxP, power);
      if (hr) { this.hrAcc += hr * dt; this.hrN += dt; }
      while (this.t >= this.nextRec) {
        this.records.push({ t: this.nextRec, p: Math.round(power), cad: Math.round(cad), hr: hr ? Math.round(hr) : 0, dist: this.dist, speed: this.speed, step: this.idx });
        this.nextRec++;
      }
    }
    return this.targetW;
  }

  get avg3() { return this.samples.length ? this.samples.reduce((a, x) => a + x.p, 0) / this.samples.length : 0; }
  get avgStep() { return this.stAccT ? this.stAcc / this.stAccT : 0; }
  get avgPower() { return this.totT ? this.totAcc / this.totT : 0; }
  get avgHr() { return this.hrN ? this.hrAcc / this.hrN : 0; }
  /** blocchi rimanenti (di primo livello) dopo quello corrente */
  get blocksLeft() { return this.plan.blocks - 1 - this.step.bi; }

  /** istantanea compatta per il salvataggio anti-crash */
  snapshot() {
    return {
      v: 1, planId: this.plan.id, ftp: this.ftp, savedAt: Date.now(),
      idx: this.idx, t: this.t, stepT: this.stepT, stepDist: this.stepDist, dist: this.dist, startedAt: this.startedAt,
      stAcc: this.stAcc, stAccT: this.stAccT, totAcc: this.totAcc, totT: this.totT, hrAcc: this.hrAcc, hrN: this.hrN, kj: this.kj, maxP: this.maxP, nextRec: this.nextRec,
      rec: this.records.map(r => [r.t, r.p, r.cad, r.hr, Math.round(r.dist * 10) / 10, Math.round(r.speed * 100) / 100, r.step])
    };
  }
  /** ripristina una seduta interrotta: riparte in pausa manuale */
  restore(o) {
    this.reset();
    Object.assign(this, {
      idx: clamp(o.idx, 0, this.steps.length - 1), t: o.t, stepT: o.stepT, stepDist: o.stepDist, dist: o.dist, startedAt: o.startedAt,
      stAcc: o.stAcc, stAccT: o.stAccT, totAcc: o.totAcc, totT: o.totT, hrAcc: o.hrAcc, hrN: o.hrN, kj: o.kj, maxP: o.maxP, nextRec: o.nextRec,
      records: o.rec.map(a => ({ t: a[0], p: a[1], cad: a[2], hr: a[3], dist: a[4], speed: a[5], step: a[6] }))
    });
    this.started = true; this.paused = true; this.pauseReason = 'manual'; this.fromW = this.cfg.minLoadW; this.rampT = 0;
  }
}
