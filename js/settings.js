// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Gatti Elia
// Preferenze dell'utente salvate nel browser (nessun dato esce dal PC, tranne la sincronizzazione OneDrive se la attivi).
import { DEFAULT_PAGES, cleanPages } from './computer.js';
const KEY = 'ciclomulino.settings';
export const DEFAULTS = {
  name: '', setupDone: false, tutorialDone: false, wizStep: 0,
  planMode: 'local',          // 'local' (file dal computer) | 'onedrive' | 'own' (workout costruiti da te)
  bike: 'propel', wheelMm: 2136, sound: true, vol: 0.7,            // circonferenza esterna della ruota in mm (700x28C = 2136)
  ccCorner: true, ccBar: true, ccPages: DEFAULT_PAGES,                // ciclocomputer: riquadro a schermo, sul manubrio (1ª persona), pagine di campi
  cloud: false, clientId: '', autoSync: true, autoFit: true,
  weight: 0, height: 0, ftp: 0, ftpMode: 'plan', hrMax: 0,             // peso (kg) per i W/kg; FTP personale (usata solo se ftpMode = 'personal')
  bikeColor: { frame: '', accent: '', deep: -1 },                      // vuoto = colori originali della bici scelta
  kit: { jersey: '#ff7a1a', jersey2: '#ffd070', pattern: 'zip', shorts: '#1a1a28', helmet: '#f4f1ff', skin: '#f0b890', emblem: '', emblemColor: '#ffffff', text: '', img: null },
  style: 'voxel', traffic: true, hazards: true, gestures: true, coachMsgs: true, autoPause: true, ambient: true, showFps: false, quality: 3,
  debug: false, debugFolder: false,      // scatola nera (file .jsonl): spenta di serie, la accende l'utente; la scrittura nella cartella dati è un secondo consenso
  lastPick: { kind: 'plan', sessId: '', route: '', start: 0 }, folder: false
};
/* Validazione a whitelist: ogni valore (da localStorage o da un file importato) è controllato per tipo e intervallo.
   Chiavi sconosciute vengono scartate; stringhe e colori non conformi tornano al valore precedente. */
const HEX = /^#[0-9a-f]{6}$/i, GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, IMG = /^data:image\/png;base64,[A-Za-z0-9+/=]{1,8000}$/, SLUG = /^[\w.-]{0,60}$/, SESS = /^[\w .:+\-/]{0,80}$/;
const ENUM = { planMode: ['local', 'onedrive', 'own'], ftpMode: ['plan', 'personal'], style: ['voxel', 'ps1', 'iso', 'hd2d'] };
const NUM = { wheelMm: [1000, 2600], vol: [0, 1], weight: [0, 300], height: [0, 250], ftp: [0, 600], hrMax: [0, 250], quality: [1, 3], wizStep: [0, 50], 'bikeColor.deep': [-1, 2], 'lastPick.start': [0, 1e7] };
const COLORS = new Set(['kit.jersey', 'kit.jersey2', 'kit.shorts', 'kit.helmet', 'kit.skin', 'kit.emblemColor', 'bikeColor.frame', 'bikeColor.accent']);
const SLUGS = new Set(['bike', 'kit.pattern', 'kit.emblem', 'lastPick.kind', 'lastPick.route']);
const has = (o, k) => !!o && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, k);
function one(p, d, v, b) {
  if (p === 'kit.img') return v === null ? null : (typeof v === 'string' && IMG.test(v) ? v : b);
  if (ENUM[p]) return ENUM[p].includes(v) ? v : b;
  if (typeof d === 'boolean') return typeof v === 'boolean' ? v : b;
  if (typeof d === 'number') { if (typeof v !== 'number' || !Number.isFinite(v)) return b; const [lo, hi] = NUM[p] || [-1e7, 1e7], x = Math.min(hi, Math.max(lo, v)); return p === 'ftp' && x > 0 && x < 50 ? 50 : x; }      // FTP: 0 (non indicata) oppure 50-600 W; un valore assurdo non deve diventare watt assurdi nei test e nei piani generati
  if (typeof v !== 'string') return b;
  if (p === 'ccPages') return v.length <= 400 ? cleanPages(v) : b;
  if (COLORS.has(p)) return v === '' || HEX.test(v) ? v : b;
  if (p === 'clientId') return v === '' || GUID.test(v) ? v : b;
  if (p === 'lastPick.sessId') return SESS.test(v) ? v : b;
  if (SLUGS.has(p)) return SLUG.test(v) ? v : b;
  return v.replace(/[\u0000-\u001f<>"'`&]/g, '').slice(0, p === 'kit.text' ? 30 : 80);   // testo libero: niente caratteri di controllo né simboli HTML
}
function walk(def, base, src, path) {
  const out = {};
  for (const k of Object.keys(def)) {
    const p = path + k, d = def[k], b = has(base, k) ? base[k] : d, v = has(src, k) ? src[k] : undefined;
    if (d && typeof d === 'object') out[k] = walk(d, b && typeof b === 'object' ? b : d, v, p + '.');
    else out[k] = v === undefined ? b : one(p, d, v, b);
  }
  return out;
}
/** `o` = oggetto letto da fuori (non fidato); `base` = valori da usare dove manca o non è valido */
export function sanitizeSettings(o, base = DEFAULTS) { return walk(DEFAULTS, base, o && typeof o === 'object' && !Array.isArray(o) ? o : {}, ''); }
/** impostazioni che restano proprie di ogni PC (collegamenti, grafica, volume, ultima scelta): non vengono sincronizzate */
export const SYNC_SKIP = ['cloud', 'clientId', 'folder', 'planMode', 'autoSync', 'autoFit', 'wizStep', 'lastPick', 'showFps', 'quality', 'vol', 'sound', 'debug', 'debugFolder'];
/** ciò che va su OneDrive: tutte le impostazioni tranne quelle proprie del PC */
export function settingsPayload(s) { const o = {}; for (const k of Object.keys(s)) if (!SYNC_SKIP.includes(k)) o[k] = s[k]; return o; }
export function loadSettings(storage) {
  let o = {}; try { o = JSON.parse(storage.getItem(KEY) || '{}'); } catch { /* dati rovinati: uso i predefiniti */ }
  return sanitizeSettings(o);
}
export function saveSettings(storage, s) { try { storage.setItem(KEY, JSON.stringify(s)); return true; } catch { return false; } }
