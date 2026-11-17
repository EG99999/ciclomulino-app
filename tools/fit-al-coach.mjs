// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Gatti Elia
// Porta i .FIT di Open Trainer verso Garmin Connect passando dal repository del coach: copia i file nuovi in fit/inbox/ e fa push;
// la GitHub Action «Upload FIT» (repository del coach) li carica su Garmin con le credenziali che già custodisce.
// Qui NON c'è nessuna credenziale Garmin. Per il push si usano le credenziali Git già presenti sul PC.
//
// Uso:  node tools/fit-al-coach.mjs --src "C:\Users\...\OneDrive\Apps\Open Trainer\fit" --repo "C:\Dev\coach" [--since 2026-11-17] [--dry-run] [--min-age 120]
//       --since: spedisce solo i file modificati da quel giorno in poi (per non mandare a Garmin le prove vecchie)
//       --plan / --history: piano-app.json e storico.json da cui prendere il titolo della seduta (default: nella cartella sopra --src); l'attività su Garmin si chiamerà così
//       --state-dir: cartella di stato e log (default %LOCALAPPDATA%\OpenTrainer; per l'Utilità di pianificazione usarne una fuori da AppData)
// Pensato per girare ogni 10 minuti (Utilità di pianificazione di Windows): se non ci sono file nuovi non fa nulla e non usa la rete.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

export const MAX_BYTES = 3 * 1024 * 1024;

/** controllo minimo prima di spedire: intestazione .FIT e dimensione sensata. Restituisce il motivo se non va, altrimenti null. */
export function checkFit(buf) {
  if (buf.length < 16 || buf.length > MAX_BYTES) return `dimensione non valida (${buf.length} byte)`;
  if (buf.toString('latin1', 8, 12) !== '.FIT') return 'intestazione .FIT mancante';
  return null;
}

/** file .fit di `src` da spedire: non ancora spediti, fermi da almeno minAgeSec (OneDrive può stare ancora scrivendo) e validi */
export function pickNew(src, sent = {}, { now = Date.now(), minAgeSec = 120, since = 0 } = {}) {
  const files = [], skipped = [];
  let names = []; try { names = fs.readdirSync(src); } catch (e) { return { files, skipped: [{ name: src, why: 'cartella non leggibile: ' + e.code }] }; }
  for (const name of names.sort()) {
    if (!/\.fit$/i.test(name) || sent[name]) continue;
    const full = path.join(src, name); let st; try { st = fs.statSync(full); } catch { continue; }
    if (!st.isFile() || st.mtimeMs < since) continue;      // `since`: i file più vecchi (prove di giorni fa) non si spediscono
    if (now - st.mtimeMs < minAgeSec * 1000) { skipped.push({ name, why: 'troppo recente' }); continue; }
    let buf; try { buf = fs.readFileSync(full); } catch (e) { skipped.push({ name, why: 'non leggibile: ' + e.code }); continue; }
    const bad = checkFit(buf); if (bad) { skipped.push({ name, why: bad, permanent: true }); continue; }
    files.push({ name, full });
  }
  return { files, skipped };
}

const slug = s => String(s).toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);      // come fitFileName() dell'app

/**
 * Titolo con cui l'attività deve comparire su Garmin: quello della seduta pianificata (es. «Ciclomulino z2 40'»), non «Ciclismo indoor».
 * Il nome del file è AAAAMMGG-HHMM[SS]-<titolo in minuscolo con i trattini>.fit: si cerca nel piano la seduta di quel giorno con lo stesso titolo;
 * in mancanza si usa il titolo dello storico dell'app. Piano e storico possono essere nel formato dell'app o in quello grezzo del coach.
 */
export function titleFor(fitName, { plan, history } = {}) {
  const m = /^(\d{4})(\d{2})(\d{2})-\d{4,6}-(.+)\.fit$/i.exec(fitName); if (!m) return null;
  const date = `${m[1]}-${m[2]}-${m[3]}`, sl = m[4].toLowerCase();
  const list = Array.isArray(plan) ? plan : plan && Array.isArray(plan.sessions) ? plan.sessions : [];
  const hit = list.find(s => s && typeof s === 'object' && (s.date || s.data) === date && slug(s.title || s.titolo || '') === sl);
  if (hit) return String(hit.title || hit.titolo).trim().slice(0, 100);
  const h = Array.isArray(history) ? history.find(x => x && x.fit === fitName) : null;
  return h && h.title ? String(h.title).trim().slice(0, 100) : null;
}

const defaultGit = (repo, args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }, stdio: ['ignore', 'pipe', 'pipe'], timeout: 120000 });
const clean = s => String(s || '').replace(/\/\/[^/@\s]*@/g, '//').trim();     // mai far finire credenziali di un URL nei log

/**
 * Una passata: copia i file nuovi in <repo>/fit/inbox, commit e push. `sent` si aggiorna solo dopo un push riuscito.
 * Restituisce { esito, copiati, errore } con esito: 'niente' | 'spediti' | 'errore'.
 */
export function run({ src, repo, state, dryRun = false, git = defaultGit, now = Date.now(), minAgeSec = 120, since = 0, titleOf = () => null, log = () => {} }) {
  const sent = state.sent = state.sent || {};
  const inbox = path.join(repo, 'fit', 'inbox'), done = path.join(repo, 'fit', 'done'), failed = path.join(repo, 'fit', 'failed');
  const { files, skipped } = pickNew(src, sent, { now, minAgeSec, since });
  for (const s of skipped) if (s.permanent && !sent[s.name]) { sent[s.name] = 'scartato: ' + s.why; log(`${s.name}: scartato (${s.why})`); }
  const pending = (() => { try { return fs.readdirSync(inbox).filter(n => /\.fit$/i.test(n) && !sent[n]); } catch { return []; } })();     // già copiati ma push non riuscito
  if (!files.length && !pending.length) return { esito: 'niente', copiati: [] };
  if (dryRun) { log('[dry-run] da spedire: ' + [...files.map(f => f.name), ...pending].join(', ')); return { esito: 'niente', copiati: [] }; }
  try {
    git(repo, ['pull', '--rebase', '--autostash', '-q']);
    const copiati = [];
    fs.mkdirSync(inbox, { recursive: true });
    for (const f of files) {
      if ([done, failed].some(d => fs.existsSync(path.join(d, f.name)))) { sent[f.name] = 'già elaborato dal coach'; continue; }
      if (!fs.existsSync(path.join(inbox, f.name))) {      // se è già in inbox (push precedente non riuscito) si riprova solo il push
        fs.copyFileSync(f.full, path.join(inbox, f.name)); copiati.push(f.name);
        const title = titleOf(f.name); if (title) fs.writeFileSync(path.join(inbox, f.name.replace(/\.fit$/i, '.json')), JSON.stringify({ title }) + '\n');      // l'Action darà questo nome all'attività su Garmin
      }
    }
    const daSpedire = fs.readdirSync(inbox).filter(n => /\.fit$/i.test(n) && !sent[n]);
    if (!daSpedire.length) return { esito: 'niente', copiati };
    git(repo, ['add', '--', 'fit/inbox']);
    try { git(repo, ['commit', '-q', '-m', 'fit: ' + daSpedire.join(', '), '--', 'fit/inbox']); } catch (e) { if (!/nothing to commit|nulla da committare/i.test(String(e.stdout) + String(e.stderr))) throw e; }
    try { git(repo, ['push', '-q']); } catch { git(repo, ['pull', '--rebase', '--autostash', '-q']); git(repo, ['push', '-q']); }      // l'Action può aver appena fatto un commit
    const when = new Date(now).toISOString(); for (const n of daSpedire) sent[n] = when;
    log('spediti al repository del coach: ' + daSpedire.join(', '));
    return { esito: 'spediti', copiati: daSpedire };
  } catch (e) {
    const errore = clean(e.stderr || e.message).split('\n').slice(0, 3).join(' | ');
    log('ERRORE: ' + errore);
    return { esito: 'errore', copiati: [], errore };
  }
}

function cli(argv) {
  const a = {}; for (let i = 0; i < argv.length; i++) { const k = argv[i]; if (!k.startsWith('--')) continue; const v = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true; a[k.slice(2)] = v; }
  if (!a.src || !a.repo) { console.error('Uso: node tools/fit-al-coach.mjs --src <cartella fit di Open Trainer> --repo <repository del coach> [--dry-run] [--min-age 120]'); return 2; }
  // --state-dir: dove tenere stato e log. Da una finestra normale va bene il default; per l'Utilità di pianificazione usare una cartella fuori da AppData\Local
  // (l'app Claude, che è un pacchetto di Windows, scrive lì in una copia privata che l'Utilità di pianificazione non vede)
  const dir = typeof a['state-dir'] === 'string' ? a['state-dir'] : path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), '.local', 'state'), 'OpenTrainer'); fs.mkdirSync(dir, { recursive: true });
  const stateFile = path.join(dir, 'fit-al-coach.json'), logFile = path.join(dir, 'fit-al-coach.log');
  let state = {}; try { state = JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch { /* prima volta */ }
  try { if (fs.statSync(logFile).size > 200000) fs.truncateSync(logFile, 0); } catch { /* non c'è ancora */ }
  const log = m => { const line = new Date().toISOString() + ' ' + m; console.log(line); try { fs.appendFileSync(logFile, line + '\n'); } catch { /* il log non deve fermare il lavoro */ } };
  const since = typeof a.since === 'string' ? Date.parse(a.since + 'T00:00:00') : 0; if (Number.isNaN(since)) { console.error('--since vuole una data AAAA-MM-GG'); return 2; }
  const readJson = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
  const base = path.dirname(a.src), plan = readJson(typeof a.plan === 'string' ? a.plan : path.join(base, 'piano-app.json')), history = readJson(typeof a.history === 'string' ? a.history : path.join(base, 'storico.json'));
  const r = run({ src: a.src, repo: a.repo, state, dryRun: !!a['dry-run'], minAgeSec: a['min-age'] ? +a['min-age'] : 120, since, titleOf: n => titleFor(n, { plan, history }), log });
  if (!a['dry-run']) fs.writeFileSync(stateFile, JSON.stringify(state, null, 1));
  return r.esito === 'errore' ? 1 : 0;
}
if (process.argv[1] && /fit-al-coach\.mjs$/i.test(process.argv[1])) process.exit(cli(process.argv.slice(2)));
