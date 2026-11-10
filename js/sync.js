// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Gatti Elia
// Sincronizzazione tra PC con lo stesso account Microsoft: impostazioni, storico delle sedute e percorsi importati.
// Vive nella cartella dell'app su OneDrive (Apps/Open Trainer): impostazioni.json, storico.json, percorsi/*.json.
// Tutto ciò che arriva da OneDrive è trattato come NON fidato (come un file importato): controllato campo per campo.
import { sanitizeSettings, settingsPayload } from './settings.js';
import { mergeHistory, loadHistory, saveHistory } from './history.js';

export const MOD_KEY = 'ciclomulino.syncmod', MAX_ROUTES = 6, MAX_ROUTE_BYTES = 3_000_000;
const ROUTE_NAME = /^[\w.-]{1,64}\.json$/, ROUTE_ID = /^[\w.-]{1,60}$/;

export class StateSync {
  /** cloud = CloudSync; storage = localStorage; getSettings() = oggetto impostazioni vivo; applyRemote(nuove) le applica;
      getRoutes() = percorsi importati; addRoutes([json]) li aggiunge e salva; validateRoute(json) lancia errore se non valido */
  constructor({ cloud, storage, getSettings, applyRemote, getRoutes, addRoutes, validateRoute, busy = () => false, now = Date.now }) {
    Object.assign(this, { cloud, storage, getSettings, applyRemote, getRoutes, addRoutes, validateRoute, busy, now });
  }
  meta() { try { const m = JSON.parse(this.storage.getItem(MOD_KEY) || '{}'); return m && typeof m === 'object' ? m : {}; } catch { return {}; } }
  setMeta(m) { try { this.storage.setItem(MOD_KEY, JSON.stringify(m)); } catch { /* ignora */ } }
  /** da chiamare quando le impostazioni sincronizzabili cambiano su questo PC */
  touch() { const m = this.meta(); m.settings = this.now(); this.setMeta(m); }

  async run() {
    const out = { settings: 'uguali', rides: 0, routes: 0 };
    await this.settingsStep(out);
    await this.historyStep(out);
    await this.routesStep(out);
    return out;
  }

  /** ultima modifica vince; il PC che entra per la prima volta adotta ciò che c'è già sul cloud (così un PC appena configurato non lo cancella) */
  async settingsStep(out) {
    const S = this.getSettings(), m = this.meta(), remote = await this.cloud.readJson('impostazioni.json');
    const valid = !!(remote && remote.settings && typeof remote.settings === 'object' && !Array.isArray(remote.settings));
    const rMod = valid && Number.isFinite(remote.mod) && remote.mod > 0 && remote.mod <= this.now() + 86400000 ? remote.mod : 0,      // un'ora «nel futuro» (anche 1e300) non deve far vincere per sempre il cloud
      lMod = m.settings || 0;
    if (valid && (rMod > lMod || !m.joined)) {
      if (this.busy()) return;                                       // durante una seduta non cambio niente: lo faccio alla prossima sincronizzazione
      // anche dal cloud non entrano mai le impostazioni proprie del PC (Client ID, cartella…)
      this.applyRemote(sanitizeSettings(settingsPayload(remote.settings), S)); m.settings = rMod; m.joined = true; this.setMeta(m); out.settings = 'scaricate';
    } else if (!valid || lMod > rMod) {
      const mod = lMod || this.now();
      await this.cloud.writeJson('impostazioni.json', { v: 1, mod, settings: settingsPayload(S) }); m.settings = mod; m.joined = true; this.setMeta(m); out.settings = 'caricate';
    }
  }

  /** unione degli storici: nessuna seduta si perde, né qui né sull'altro PC */
  async historyStep(out) {
    const remote = await this.cloud.readJson('storico.json'), local = loadHistory(this.storage), merged = mergeHistory(local, remote);
    const lIds = new Set(local.map(r => r.id)), rIds = new Set(Array.isArray(remote) ? remote.map(r => r && r.id) : []);
    const fresh = merged.filter(r => !lIds.has(r.id)).length;
    if (fresh) { saveHistory(this.storage, merged); out.rides = fresh; }
    if (merged.some(r => !rIds.has(r.id)) || (!remote && merged.length)) await this.cloud.writeJson('storico.json', merged);
  }

  async routesStep(out) {
    const od = this.cloud.od, files = (await od.list('percorsi')).filter(f => ROUTE_NAME.test(f.name)), names = new Set(files.map(f => f.name));
    const have = new Set(this.getRoutes().map(r => r.id)), added = [];
    for (const f of files) {
      if (have.size + added.length >= MAX_ROUTES) break;
      if (f.size > MAX_ROUTE_BYTES) continue;
      try {
        const j = JSON.parse(await od.readText('percorsi/' + f.name));
        if (!j || typeof j.id !== 'string' || !ROUTE_ID.test(j.id) || have.has(j.id) || added.some(a => a.id === j.id)) continue;
        this.validateRoute(j); added.push(j);
      } catch { /* percorso illeggibile o non valido: lo salto */ }
    }
    if (added.length && !this.busy()) { this.addRoutes(added); out.routes = added.length; }
    for (const r of this.getRoutes()) {
      const fn = String(r.id).replace(/[^\w.-]+/g, '_').slice(0, 60) + '.json';
      if (!names.has(fn)) { try { await this.cloud.writeJson('percorsi/' + fn, r); } catch { /* troppo grande o rete assente: ci riprova la prossima volta */ } }
    }
  }
}
