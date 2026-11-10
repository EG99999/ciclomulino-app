// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Gatti Elia
// Aggiunge ai percorsi le zone di ambiente (montagna sul lago, colline in Franciacorta) in base ai paesi attraversati.
import { readFile, writeFile } from 'node:fs/promises';
const HINTS = {
  'giro-iseo': [['Predore', 'Marone', 'mountains']],
  'franciacorta': [['Erbusco', 'Ome', 'hills']]
};
for (const [id, segs] of Object.entries({ ...HINTS, 'chiari-brescia': [] })) {
  const f = new URL(`../routes/${id}.json`, import.meta.url);
  let j; try { j = JSON.parse(await readFile(f, 'utf8')); } catch { continue; }
  j.places = j.places.filter((p, i, a) => !(i && a[i - 1].n === p.n && a[i - 1].d === p.d));   // toglie il Chiari doppio di partenza
  j.env = [];
  for (const [a, b, e] of segs) {
    const pa = j.places.find(p => p.n === a), pb = [...j.places].reverse().find(p => p.n === b);
    if (pa && pb && pb.d > pa.d) j.env.push([pa.d, pb.d, e]);
  }
  await writeFile(f, JSON.stringify(j));
  console.log(id, JSON.stringify(j.env));
}
