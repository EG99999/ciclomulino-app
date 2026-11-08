// Disposizione (deterministica) di alberi, case, animali, ostacoli e incroci lungo il tracciato 3D.
// Funzioni pure: stesso input → stesso risultato (testabili senza Three.js).
export const CH = 120;                    // lunghezza di un "pezzo" di mondo (m)
export const ROAD_HALF = 3.8;             // mezza larghezza della strada (m)
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const hsh = n => { n = Math.imul(n ^ (n >>> 15), 2246822519); n = Math.imul(n ^ (n >>> 13), 3266489917); return ((n ^ (n >>> 16)) >>> 0) / 4294967295; };
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

/** quota del terreno rispetto alla strada a lat metri dal centro (0 vicino alla strada) */
export function terrainH(d, lat, amp, quant = 0) {
  const a = Math.abs(lat); let h = amp * smooth(6, 45, a) * (0.55 * Math.sin(d * 0.011 + lat * 0.05) + 0.36 * Math.sin(d * 0.027 - lat * 0.08 + 2) + 0.2);
  if (quant) h = Math.round(h / quant) * quant; return h;
}
/** cosa mettere in un ambiente (country | hills | mountains | city) dato un numero casuale r in [0,1) */
export function decorType(env, r) {
  if (env === 'country') return r < .32 ? 'tree' : r < .42 ? 'house' : r < .52 ? 'cow' : r < .6 ? 'sheep' : r < .66 ? 'hay' : r < .8 ? 'bush' : r < .92 ? 'flower' : 'fence';
  if (env === 'hills') return r < .34 ? 'cyp' : r < .42 ? 'house' : r < .56 ? 'vine' : r < .64 ? 'sheep' : r < .78 ? 'bush' : r < .88 ? 'tree' : 'flower';
  if (env === 'mountains') return r < .4 ? 'pine' : r < .62 ? 'rock' : r < .72 ? 'goat' : r < .88 ? 'bush' : 'pine';
  return r < .5 ? 'bld' : r < .75 ? 'lamp' : r < .9 ? 'banner' : 'bld';
}
/** elenco degli elementi di scenario del pezzo c. opts: { envOf(d), path, amp, quant, lim, density } */
export function chunkDecor(c, opts) {
  const { envOf, path, amp, quant = 0, lim = 40, density = 7 } = opts, out = [], d0 = c * CH;
  for (let j = 0; j * density < CH; j++) {
    const seed = c * 1009 + j * 31, d = d0 + j * density + hsh(seed + 1) * density * 0.9;
    for (let side = -1; side <= 1; side += 2) {
      if (hsh(seed + (side > 0 ? 7 : 3)) < 0.28) continue;                 // non ovunque: lascia respirare il paesaggio
      const lat = side * (7 + hsh(seed + 11 + side) * (lim - 7)), env = envOf(d), type = decorType(env, hsh(seed + 17 + side * 5));
      const f = path.frame(d, lat), y = f.y + terrainH(d, lat, amp, quant);
      out.push({ type, env, x: f.x, y, z: f.z, yaw: f.yaw, k: seed + (side > 0 ? 1 : 0), d, lat });
    }
  }
  return out;
}
/** ostacoli (buche/lavori) e incroci nel pezzo c. hazards = array {z, lane, w, type, k} con z modulo TRACK */
export function chunkHazards(c, hazards, TRACK) {
  const a = c * CH, b = a + CH, out = [];
  for (const h of hazards) { const j0 = Math.ceil((a - h.z) / TRACK), d = h.z + j0 * TRACK; if (d >= a && d < b) out.push({ ...h, d }); }
  return out;
}
export function chunkCrossings(c, XING, offset = 360) {
  const a = c * CH, b = a + CH, out = []; for (let d = Math.ceil((a - offset) / XING) * XING + offset; d < b; d += XING) if (d >= a) out.push(d); return out;
}
