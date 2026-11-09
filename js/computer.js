// Ciclocomputer simulato: valori disponibili, pagine personalizzabili (4-6 campi) e calcolo di ciò che mostra.
// Nessun accesso al DOM: tutto è provabile con i test.
import { normalizedPower } from './history.js';

export const MAX_FIELDS = 6, MIN_FIELDS = 4, MAX_PAGES = 6;
const pad2 = n => String(n).padStart(2, '0');
const mmss = s => { s = Math.max(0, Math.round(Number.isFinite(s) ? s : 0)); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60); return (h ? h + ':' + pad2(m) : String(m)) + ':' + pad2(s % 60); };
const n0 = v => Number.isFinite(v) && v !== null ? String(Math.round(v)) : '--';
const n1 = v => Number.isFinite(v) && v !== null ? v.toFixed(1) : '--';
const n2 = v => Number.isFinite(v) && v !== null ? v.toFixed(2) : '--';

/** campi disponibili: etichetta corta, nome per le impostazioni, unità e come si calcola il testo da un contesto c */
export const FIELDS = {
  kmh: { label: 'KM/H', name: 'Velocità (virtuale, da watt e pendenza)', unit: 'km/h', get: c => n1(c.kmh) },
  kmhR: { label: 'KM/H RUOTA', name: 'Velocità reale (ruota/trainer)', unit: 'km/h', get: c => n1(c.kmhReal) },
  kmhAvg: { label: 'KM/H MEDI', name: 'Velocità media', unit: 'km/h', get: c => n1(c.kmhAvg) },
  kmhMax: { label: 'KM/H MAX', name: 'Velocità massima', unit: 'km/h', get: c => n1(c.kmhMax) },
  w: { label: 'WATT', name: 'Potenza', unit: 'W', get: c => n0(c.w) },
  w3: { label: 'W 3"', name: 'Potenza media 3"', unit: 'W', get: c => n0(c.w3) },
  w10: { label: 'W 10"', name: 'Potenza media 10"', unit: 'W', get: c => n0(c.w10) },
  wStep: { label: 'W STEP', name: 'Potenza media dello step', unit: 'W', get: c => n0(c.wStep) },
  wAvg: { label: 'W MEDI', name: 'Potenza media della seduta', unit: 'W', get: c => n0(c.wAvg) },
  wMax: { label: 'W MAX', name: 'Potenza massima', unit: 'W', get: c => n0(c.wMax) },
  np: { label: 'NP', name: 'Potenza normalizzata', unit: 'W', get: c => n0(c.np) },
  cad: { label: 'CADENZA', name: 'Cadenza', unit: 'rpm', get: c => n0(c.cad) },
  hr: { label: 'FC', name: 'Frequenza cardiaca', unit: 'bpm', get: c => (c.hr ? n0(c.hr) : '--') },
  hrAvg: { label: 'FC MEDIA', name: 'FC media', unit: 'bpm', get: c => (c.hrAvg ? n0(c.hrAvg) : '--') },
  pct: { label: '% FTP', name: '% della FTP', unit: '%', get: c => n0(c.pct) },
  wkg: { label: 'W/KG', name: 'Watt per chilo', unit: 'W/kg', get: c => (c.wkg ? n2(c.wkg) : '--') },
  grade: { label: 'PENDENZA', name: 'Pendenza', unit: '%', get: c => n1(c.grade) },
  dist: { label: 'KM', name: 'Distanza', unit: 'km', get: c => n2((c.dist || 0) / 1000) },
  time: { label: 'TEMPO', name: 'Tempo totale', unit: '', get: c => mmss(c.time) },
  stepT: { label: 'TEMPO STEP', name: 'Tempo dello step', unit: '', get: c => mmss(c.stepT) },
  dplus: { label: 'D+', name: 'Dislivello positivo', unit: 'm', get: c => n0(c.dplus) },
  kj: { label: 'KJ', name: 'Energia', unit: 'kJ', get: c => n0(c.kj) },
  clock: { label: 'ORA', name: 'Ora', unit: '', get: c => { const d = c.now instanceof Date ? c.now : new Date(); return pad2(d.getHours()) + ':' + pad2(d.getMinutes()); } }
};
export const FIELD_IDS = Object.keys(FIELDS);
export const isField = id => typeof id === 'string' && Object.prototype.hasOwnProperty.call(FIELDS, id);
export const DEFAULT_PAGES = 'kmh,w,cad,hr|kmhR,kmhAvg,dist,time|w3,wStep,pct,wkg';
const POOL = ['w', 'cad', 'hr', 'kmh', 'time', 'dist'];   // per completare una pagina con meno di 4 campi

/** testo salvato → [[id, …], …]; ciò che non è valido viene scartato, ogni pagina ha da 4 a 6 campi */
export function parsePages(str) {
  const pages = [];
  for (const p of String(str == null ? '' : str).split('|').slice(0, MAX_PAGES)) {
    const f = p.split(',').map(x => x.trim()).filter(isField).slice(0, MAX_FIELDS);
    if (!f.length) continue;
    for (const id of POOL) { if (f.length >= MIN_FIELDS) break; if (!f.includes(id)) f.push(id); }
    pages.push(f);
  }
  return pages.length ? pages : parsePages(DEFAULT_PAGES);
}
export const serializePages = pages => pages.map(p => p.join(',')).join('|');
/** versione già pulita di un testo (per le impostazioni) */
export const cleanPages = str => serializePages(parsePages(str));

/** elenco {id, label, value, unit} da mostrare per una pagina */
export function readFields(ids, ctx) { return ids.map(id => ({ id, label: FIELDS[id].label, value: FIELDS[id].get(ctx), unit: FIELDS[id].unit })); }

/** Dati che si ricavano nel tempo: velocità massima, media 10", potenza normalizzata (ricalcolata ogni 2" perché costa). */
export class CycloTracker {
  constructor() { this.reset(); }
  reset() { this.maxKmh = 0; this.buf = []; this.np = 0; this._npAt = -1e9; this._for = null; }
  /** da chiamare a ogni fotogramma: t = secondi (qualsiasi orologio crescente), key = oggetto della seduta (cambia → si riparte) */
  update(t, power, kmh, records, key) {
    if (key !== this._for) { this.reset(); this._for = key; }
    if (Number.isFinite(kmh) && kmh > this.maxKmh && kmh < 150) this.maxKmh = kmh;
    this.buf.push([t, Number.isFinite(power) ? power : 0]);
    while (this.buf.length && this.buf[0][0] < t - 10) this.buf.shift();
    if (t - this._npAt >= 2 && records && records.length) { this._npAt = t; this.np = normalizedPower(records); }
  }
  get avg10() { return this.buf.length ? this.buf.reduce((a, x) => a + x[1], 0) / this.buf.length : 0; }
}
