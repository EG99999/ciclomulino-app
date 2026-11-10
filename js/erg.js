// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Gatti Elia
// Logica ERG adattiva (confermata con il coach):
//  cadenza < 60 rpm per 5"  -> carico scende al 50% in 10"
//  cadenza > 75 rpm per 3"  -> carico torna al 100% in 10"
export const ERG_CFG = {
  lowRpm: 60, lowSec: 5,
  highRpm: 75, highSec: 3,
  reduced: 0.5,
  rampSec: 10,        // durata della rampa 100% <-> 50%
  stepRampSec: 8,     // rampa a ogni cambio step
  minLoadW: 50        // carico minimo in pausa (come "rest" del coach)
};

export class Erg {
  constructor(cfg = {}) {
    this.cfg = { ...ERG_CFG, ...cfg };
    this.reset();
  }
  reset() {
    this.L = 1; this.Lt = 1; this.reduced = false; this.lowT = 0; this.highT = 0;
  }
  /**
   * Avanza di dt secondi. `active` = seduta in corso (non in pausa, trainer connesso).
   * Restituisce eventuali eventi: 'reduce' | 'restore'.
   */
  update(dt, cadence, active) {
    const c = this.cfg, ev = [];
    if (active) {
      this.lowT = cadence < c.lowRpm ? this.lowT + dt : 0;
      this.highT = cadence > c.highRpm ? this.highT + dt : 0;
      if (!this.reduced && this.lowT >= c.lowSec) { this.reduced = true; this.Lt = c.reduced; this.lowT = 0; this.highT = 0; ev.push('reduce'); }
      else if (this.reduced && this.highT >= c.highSec) { this.reduced = false; this.Lt = 1; this.highT = 0; this.lowT = 0; ev.push('restore'); }
    } else { this.lowT = 0; this.highT = 0; }
    const rate = (1 - c.reduced) / c.rampSec * dt;
    this.L += Math.max(-rate, Math.min(rate, this.Lt - this.L));
    return ev;
  }
}

/** Setpoint di base con rampa lineare di `rampSec` dal valore `from` a `to`. */
export function ramp(from, to, elapsed, rampSec = ERG_CFG.stepRampSec) {
  const k = Math.max(0, Math.min(1, elapsed / rampSec));
  return from + (to - from) * k;
}
