// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Gatti Elia
// Guardia sullo stato iniziale dell'app: il 10 nov 2026 un commento messo a metà riga in js/main.js ha cancellato `log`, `gain` e `doneShown`
// dall'oggetto A e l'app si rompeva all'avvio (i test sugli altri moduli non se ne accorgevano).
import test from 'node:test'; import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('stato iniziale dell\'app (A in js/main.js): ci sono tutti i campi che il resto del codice usa', () => {
  const src = readFileSync(new URL('../js/main.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const start = src.indexOf('const A = {'), end = src.indexOf('\n};', start);
  assert.ok(start > 0 && end > start, 'oggetto A non trovato');
  const A = new Function('WheelSpeed', 'CycloTracker', 'return ' + src.slice(start + 'const A = '.length, end + 2))(class { }, class { });
  for (const k of ['plan', 'ftp', 'session', 'mode', 'trainer', 'hrDev', 'sim', 'speed', 'inp', 'log', 'gain', 'doneShown', 'route', 'routes', 'screen', 'keys', 'pg', 'pgT', 'lastSave', 'fps', 'drawMs', 'real', 'wheel', 'cc', 'ccPage', 'ccSig', 'game'])
    assert.ok(k in A, 'manca A.' + k);
  assert.ok(Array.isArray(A.log) && Array.isArray(A.pg)); assert.equal(A.gain, 0); assert.equal(A.doneShown, false);
  for (const k of ['power', 'cad', 'cadSeen', 'hr', 'lastData']) assert.ok(k in A.inp, 'manca A.inp.' + k);
});

test('nessun file del sito ha un commento «//» che inghiotte il codice dopo di sé nella stessa riga di un oggetto o di una chiamata', () => {
  // euristica: una riga che finisce con «,» dopo un commento «//» è quasi sempre codice finito per sbaglio dentro il commento
  for (const f of ['js/main.js', 'js/session.js', 'js/settings.js', 'js/screens.js', 'sw.js', 'js/debug.js', 'js/ble.js']) {
    const lines = readFileSync(new URL('../' + f, import.meta.url), 'utf8').split(/\r?\n/);
    lines.forEach((l, i) => { const m = l.match(/[;,{}]\s{2,}\/\/[^'"`]*\b(log|gain|doneShown|const|let|function)\b\s*[:=(\[]/); assert.ok(!m, `${f}:${i + 1} sembra avere codice dentro un commento: ${l.slice(0, 120)}`); });
  }
});
