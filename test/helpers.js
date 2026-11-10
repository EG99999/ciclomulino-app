// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Gatti Elia
import { readFileSync } from 'node:fs';
import { parsePlan } from '../js/plan.js';
import { Session } from '../js/session.js';
import { SimTrainer } from '../js/sim.js';
export const plan = parsePlan(readFileSync(new URL('../piano-app.example.json', import.meta.url), 'utf8'));
/** esegue una seduta completa in simulazione headless; restituisce {session, trainer, log} */
export function runSim(idx, { fatigue = false, cadBase = 88, maxSec = 6000 } = {}) {
  const sess = new Session(plan.sessions[idx], plan.ftp);
  const tr = new SimTrainer(plan.ftp); tr.connected = true; tr.fatigueOn = fatigue; tr.cadBase = cadBase;
  let power = 0, cad = 0; tr.onData = d => { power = d.power; cad = d.cadence; };
  const log = []; sess.start(1_800_000_000_000);
  for (let i = 0; i < maxSec * 4 && !sess.done; i++) {
    tr.tick(0.25);
    tr.setTargetPower(sess.update(0.25, { power, cad, hr: Math.round(tr.hr), connected: tr.connected }));
    log.push(...sess.drain());
  }
  return { sess, tr, log };
}
