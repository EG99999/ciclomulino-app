// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Gatti Elia
// Velocità virtuale da fisica (CLAUDE.md): massa 92 kg, CdA 0.32, Crr 0.004, rho 1.2, rendimento 0.97.
export const PHYS = { mass: 92, cda: 0.32, crr: 0.004, rho: 1.2, eta: 0.97, g: 9.81 };

/** Velocità in m/s per una potenza (W) e pendenza (%). Bisezione sulla potenza richiesta. */
export function speedFor(power, gradePct = 0) {
  if (!(power > 1)) return 0;
  const { mass, cda, crr, rho, eta, g } = PHYS;
  const slope = gradePct / 100;
  const need = v => (0.5 * rho * cda * v * v + mass * g * (crr * Math.cos(Math.atan(slope)) + Math.sin(Math.atan(slope)))) * v;
  const p = power * eta;
  let lo = 0, hi = 30;
  // in discesa ripida la potenza richiesta può essere negativa: v cresce fino al limite
  if (need(hi) < p) return hi;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (need(mid) < p) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}
