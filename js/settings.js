// Preferenze dell'utente salvate nel browser (nessun dato esce dal PC, tranne la sincronizzazione OneDrive se la attivi).
const KEY = 'ciclomulino.settings';
export const DEFAULTS = {
  name: '', setupDone: false, tutorialDone: false, wizStep: 0,
  planMode: 'local',          // 'local' (file dal computer) | 'onedrive' | 'own' (workout costruiti da te)
  bike: 'propel', sound: true, vol: 0.7,
  cloud: false, clientId: '', autoSync: true, autoFit: true,
  weight: 0, height: 0, ftp: 0, ftpMode: 'plan', hrMax: 0,             // peso (kg) per i W/kg; FTP personale (usata solo se ftpMode = 'personal')
  bikeColor: { frame: '', accent: '', deep: -1 },                      // vuoto = colori originali della bici scelta
  kit: { jersey: '#ff7a1a', jersey2: '#ffd070', pattern: 'zip', shorts: '#1a1a28', helmet: '#f4f1ff', skin: '#f0b890', emblem: '', emblemColor: '#ffffff', text: '', img: null },
  style: 'voxel', traffic: true, hazards: true, gestures: true, coachMsgs: true, autoPause: true, ambient: true, showFps: false, quality: 3,
  lastPick: { kind: 'plan', sessId: '', route: '', start: 0 }, folder: false
};
export function loadSettings(storage) {
  try { const o = JSON.parse(storage.getItem(KEY) || '{}'); return { ...DEFAULTS, ...o, kit: { ...DEFAULTS.kit, ...(o.kit || {}) }, bikeColor: { ...DEFAULTS.bikeColor, ...(o.bikeColor || {}) }, lastPick: { ...DEFAULTS.lastPick, ...(o.lastPick || {}) } }; } catch { return { ...DEFAULTS, kit: { ...DEFAULTS.kit }, bikeColor: { ...DEFAULTS.bikeColor }, lastPick: { ...DEFAULTS.lastPick } }; }
}
export function saveSettings(storage, s) { try { storage.setItem(KEY, JSON.stringify(s)); return true; } catch { return false; } }
