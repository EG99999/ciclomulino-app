import test from 'node:test'; import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { parseTrack, Route, routeFromFile } from '../js/route.js';

// GPX sintetico: 5 km verso nord con salita del 4% poi una curva a destra
function gpx() {
  const pts = []; const lat0 = 45.54, lon0 = 9.93, mPerDegLat = 111195;
  for (let i = 0; i <= 200; i++) pts.push([lat0 + i * 10 / mPerDegLat, lon0, 150 + i * 10 * 0.04]);          // 2 km nord, +4%
  for (let i = 1; i <= 200; i++) pts.push([pts[200][0], lon0 + i * 10 / (mPerDegLat * Math.cos(lat0 * Math.PI / 180)), pts[200][2]]); // 2 km est, piano
  return '<?xml version="1.0"?><gpx><trk><name>Prova &amp; test</name><trkseg>' + pts.map(p => `<trkpt lat="${p[0].toFixed(6)}" lon="${p[1].toFixed(6)}"><ele>${p[2].toFixed(1)}</ele><time>2026-01-01T00:00:00Z</time></trkpt>`).join('') + '</trkseg></trk></gpx>';
}
test('parseTrack legge GPX con attributi in qualsiasi ordine e quota', () => {
  const t = parseTrack('<gpx><trk><name>X</name><trkseg><trkpt lon="10.5" lat="45.5"><ele>100.5</ele></trkpt><trkpt lat="45.6" lon="10.6"/></trkseg></trk></gpx>');
  assert.equal(t.pts.length, 2); assert.deepEqual(t.pts[0], [45.5, 10.5, 100.5]); assert.equal(t.pts[1][2], null); assert.equal(t.name, 'X');
});
test('parseTrack legge anche TCX (Garmin)', () => {
  const tcx = '<TrainingCenterDatabase><Activities><Activity><Id>2026</Id><Lap><Track>' + [0, 1, 2].map(i => `<Trackpoint><Position><LatitudeDegrees>45.5${i}</LatitudeDegrees><LongitudeDegrees>9.9${i}</LongitudeDegrees></Position><AltitudeMeters>${120 + i}</AltitudeMeters></Trackpoint>`).join('') + '</Track></Lap></Activity></Activities></TrainingCenterDatabase>';
  const t = parseTrack(tcx); assert.equal(t.pts.length, 3); assert.equal(t.pts[2][2], 122);
});
test('Route: lunghezza, dislivello, pendenza e curva dal tracciato', () => {
  const r = routeFromFile(gpx(), 'prova.gpx');
  assert.ok(Math.abs(r.len - 4000) < 60, 'lunghezza ' + r.len); assert.ok(Math.abs(r.gain - 80) < 10, 'dislivello ' + r.gain);
  assert.ok(Math.abs(r.gradeAt(800) - 4) < 0.5, 'pendenza a 800 m ' + r.gradeAt(800)); assert.ok(Math.abs(r.gradeAt(3000)) < 0.5);
  assert.ok(Math.abs(r.curveAt(500)) < 3, 'rettilineo'); assert.ok(r.curveAt(1960) > 25, 'curva a destra (est dopo nord): ' + r.curveAt(1960));
  assert.equal(r.loop, false); assert.equal(r.name.includes('Prova'), true);
});
test('Route: il percorso si ripete alla fine e la mappa sta nel riquadro', () => {
  const r = routeFromFile(gpx(), 'prova.gpx');
  assert.ok(Math.abs(r.gradeAt(r.len + 800) - r.gradeAt(800)) < 0.01);
  const { pts } = r.mapPts(160, 80, 10); for (const p of pts) { assert.ok(p[0] >= 9.9 && p[0] <= 150.1 && p[1] >= 9.9 && p[1] <= 70.1, 'fuori riquadro ' + p); }
});
test('file senza punti → errore leggibile', () => { assert.throws(() => routeFromFile('<gpx></gpx>', 'x.gpx'), /punti GPS/); });
test('percorsi di Brescia generati (se presenti): coerenti con i tuoi giri Garmin', { skip: !existsSync(new URL('../routes/chiari-brescia.json', import.meta.url)) }, () => {
  const r = new Route(JSON.parse(readFileSync(new URL('../routes/chiari-brescia.json', import.meta.url), 'utf8')));
  assert.ok(r.len > 21000 && r.len < 28000, 'Chiari–Brescia ~23 km nei tuoi file Garmin, qui ' + r.len);
  const e0 = r.eleAt(0); assert.ok(e0 > 110 && e0 < 190, 'quota di Chiari plausibile ' + e0);
  assert.ok(r.places[0].n === 'Chiari'); assert.ok(r.places.some(p => p.n === 'Brescia'));
  for (let d = 0; d < r.len; d += 500) assert.ok(Math.abs(r.gradeAt(d)) <= 14);
});
