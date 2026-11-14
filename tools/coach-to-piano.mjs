// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Gatti Elia
// Dal piano del coach (get_plan) al file piano-app.json di Open Trainer, da riga di comando (la conversione vera sta in js/coachplan.js, la stessa che usa l'app).
//
// Uso:  node tools/coach-to-piano.mjs --in piano-coach.json --out "C:...Open Trainerpiano-app.json" [--ftp 289] [--zones 0,162,216,261,302,348,438]
//                                       [--hr-zones 97,116,135,154,174] [--hr-fallback] [--days 45] [--today 2026-11-14] [--all-bike] [--overwrite]
import fs from 'node:fs';
import { convertPlan, decideWrite, planChanged, zoneBounds, hrZoneOf, SOURCE } from '../js/coachplan.js';
export { convertPlan, decideWrite, planChanged, zoneBounds, hrZoneOf, SOURCE };

function cli(argv) {
  const a = {}; for (let i = 0; i < argv.length; i++) { const k = argv[i]; if (!k.startsWith('--')) continue; const v = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true; a[k.slice(2)] = v; }
  if (!a.in || !a.out) { console.error('Uso: node tools/coach-to-piano.mjs --in piano-coach.json --out piano-app.json [--ftp 289] [--zones 0,162,...] [--hr-zones 97,...] [--hr-fallback] [--days 45] [--all-bike] [--overwrite]'); return 2; }
  const nums = s => (typeof s === 'string' ? s.split(',').map(Number) : undefined);
  const coach = JSON.parse(fs.readFileSync(a.in, 'utf8'));
  const { plan, report } = convertPlan(coach, { ftp: a.ftp ? +a.ftp : undefined, today: typeof a.today === 'string' ? a.today : undefined, days: a.days ? +a.days : undefined, zones: nums(a.zones), hrZones: nums(a['hr-zones']), hrFallback: !!a['hr-fallback'], all: !!a['all-bike'] });
  let existing = null; try { existing = fs.readFileSync(a.out, 'utf8'); } catch { /* non c'è ancora */ }
  const what = decideWrite(plan, existing, { overwrite: !!a.overwrite });
  if (what === 'scrivi') { const tmp = a.out + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(plan, null, 1)); fs.renameSync(tmp, a.out); }
  console.log(JSON.stringify({ esito: what, file: a.out, ...report }, null, 1));
  return what === 'non-mio' ? 3 : 0;
}
if (process.argv[1] && /coach-to-piano\.mjs$/i.test(process.argv[1])) process.exit(cli(process.argv.slice(2)));
