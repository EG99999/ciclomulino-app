// Encoder FIT minimo: file_id, event, record (1 Hz), lap (uno per step), session, activity.
const FIT_EPOCH = 631065600; // 1989-12-31 in secondi unix
const T = { enum: 0x00, u8: 0x02, u16: 0x84, u32: 0x86, u32z: 0x8c };
const SIZE = { [T.enum]: 1, [T.u8]: 1, [T.u16]: 2, [T.u32]: 4, [T.u32z]: 4 };

const CRC_TABLE = [0x0000, 0xcc01, 0xd801, 0x1400, 0xf001, 0x3c00, 0x2800, 0xe401, 0xa001, 0x6c00, 0x7800, 0xb401, 0x5000, 0x9c01, 0x8801, 0x4400];
export function crc16(bytes, crc = 0) {
  for (const b of bytes) {
    let tmp = CRC_TABLE[crc & 0xf]; crc = (crc >> 4) & 0x0fff; crc = crc ^ tmp ^ CRC_TABLE[b & 0xf];
    tmp = CRC_TABLE[crc & 0xf]; crc = (crc >> 4) & 0x0fff; crc = crc ^ tmp ^ CRC_TABLE[(b >> 4) & 0xf];
  }
  return crc;
}

class Writer {
  constructor() { this.b = []; }
  u8(v) { this.b.push(v & 0xff); }
  u16(v) { this.u8(v); this.u8(v >> 8); }
  u32(v) { this.u8(v); this.u8(v >> 8); this.u8(v >> 16); this.u8(v >> 24); }
  val(type, v) {
    const inv = { [T.enum]: 0xff, [T.u8]: 0xff, [T.u16]: 0xffff, [T.u32]: 0xffffffff, [T.u32z]: 0 }[type];
    if (v == null || Number.isNaN(v)) v = inv;
    v = Math.round(v);
    const max = SIZE[type] === 1 ? 0xff : SIZE[type] === 2 ? 0xffff : 0xffffffff;
    if (v < 0) v = 0; if (v > max) v = max;
    if (SIZE[type] === 1) this.u8(v); else if (SIZE[type] === 2) this.u16(v); else this.u32(v);
  }
}

/** msg: definizione {num, fields:[[fieldNum, type]]}; ogni messaggio ha un local type distinto. */
function defMsg(w, local, num, fields) {
  w.u8(0x40 | local); w.u8(0); w.u8(0); w.u16(num); w.u8(fields.length);
  for (const [f, type] of fields) { w.u8(f); w.u8(SIZE[type]); w.u8(type); }
}
function dataMsg(w, local, fields, values) {
  w.u8(local);
  fields.forEach(([, type], i) => w.val(type, values[i]));
}

const F = {
  file_id: [[0, T.enum], [1, T.u16], [2, T.u16], [3, T.u32z], [4, T.u32]],
  event: [[253, T.u32], [0, T.enum], [1, T.enum]],
  record: [[253, T.u32], [3, T.u8], [4, T.u8], [5, T.u32], [6, T.u16], [7, T.u16]],
  lap: [[254, T.u16], [253, T.u32], [2, T.u32], [7, T.u32], [8, T.u32], [9, T.u32], [13, T.u16], [14, T.u16],
    [15, T.u8], [16, T.u8], [17, T.u8], [18, T.u8], [19, T.u16], [20, T.u16], [25, T.enum], [39, T.enum], [0, T.enum], [1, T.enum]],
  session: [[254, T.u16], [253, T.u32], [2, T.u32], [7, T.u32], [8, T.u32], [9, T.u32], [11, T.u16], [14, T.u16], [15, T.u16],
    [16, T.u8], [17, T.u8], [18, T.u8], [19, T.u8], [20, T.u16], [21, T.u16], [34, T.u16], [25, T.u16], [26, T.u16],
    [5, T.enum], [6, T.enum], [0, T.enum], [1, T.enum]],
  activity: [[253, T.u32], [0, T.u32], [1, T.u16], [2, T.enum], [3, T.enum], [4, T.enum]]
};

function stats(recs) {
  const n = recs.length;
  if (!n) return { avgP: 0, maxP: 0, avgHr: 0, maxHr: 0, avgCad: 0, maxCad: 0, avgSpeed: 0, maxSpeed: 0, dist: 0, np: 0, kj: 0 };
  let sp = 0, sc = 0, nc = 0, sh = 0, nh = 0, ss = 0, maxP = 0, maxHr = 0, maxCad = 0, maxS = 0;
  for (const r of recs) {
    sp += r.p; ss += r.speed; maxP = Math.max(maxP, r.p); maxS = Math.max(maxS, r.speed);
    if (r.cad > 0) { sc += r.cad; nc++; maxCad = Math.max(maxCad, r.cad); }
    if (r.hr > 0) { sh += r.hr; nh++; maxHr = Math.max(maxHr, r.hr); }
  }
  // potenza normalizzata: media mobile 30 s ^4
  let np = 0;
  if (n >= 30) {
    let win = 0, acc = 0, cnt = 0;
    for (let i = 0; i < n; i++) {
      win += recs[i].p; if (i >= 30) win -= recs[i - 30].p;
      if (i >= 29) { const a = win / 30; acc += a ** 4; cnt++; }
    }
    np = Math.pow(acc / cnt, 0.25);
  } else np = sp / n;
  const dist = recs[n - 1].dist - (recs[0].dist - recs[0].speed);
  return { avgP: sp / n, maxP, avgHr: nh ? sh / nh : 0, maxHr, avgCad: nc ? sc / nc : 0, maxCad, avgSpeed: ss / n, maxSpeed: maxS, dist, np, kj: sp / 1000 };
}

/**
 * @param session istanza Session (records, steps, startedAt)
 * @returns Uint8Array con il file .FIT
 */
export function buildFit(session) {
  const recs = session.records;
  if (!recs.length) throw new Error('Nessun dato registrato');
  const startMs = session.startedAt || Date.now();
  const ts = sec => Math.floor(startMs / 1000) - FIT_EPOCH + sec;
  const startTs = ts(0), endTs = ts(recs[recs.length - 1].t);
  const w = new Writer();
  const SPORT = 2, SUB = 6; // cycling / indoor_cycling

  // file_id
  defMsg(w, 0, 0, F.file_id);
  dataMsg(w, 0, F.file_id, [4, 255, 1, startTs & 0x7fffffff, startTs]);
  // event start
  defMsg(w, 1, 21, F.event);
  dataMsg(w, 1, F.event, [startTs, 0, 0]);
  // record
  defMsg(w, 2, 20, F.record);
  for (const r of recs) dataMsg(w, 2, F.record, [ts(r.t), r.hr || null, r.cad, r.dist * 100, r.speed * 1000, r.p]);
  // lap per step
  defMsg(w, 3, 19, F.lap);
  const groups = [];
  for (const r of recs) {
    const g = groups[groups.length - 1];
    if (g && g.step === r.step) g.recs.push(r); else groups.push({ step: r.step, recs: [r] });
  }
  groups.forEach((g, i) => {
    const st = stats(g.recs), t0 = g.recs[0].t - 1, t1 = g.recs[g.recs.length - 1].t, dur = (t1 - t0) * 1000;
    dataMsg(w, 3, F.lap, [i, ts(t1), ts(t0), dur, dur, st.dist * 100, st.avgSpeed * 1000, st.maxSpeed * 1000,
      st.avgHr || null, st.maxHr || null, st.avgCad || null, st.maxCad || null, st.avgP, st.maxP, SPORT, SUB, 9, 1]);
  });
  // event stop
  dataMsg(w, 1, F.event, [endTs, 0, 4]);
  // session
  const all = stats(recs), total = recs[recs.length - 1].t * 1000;
  defMsg(w, 4, 18, F.session);
  dataMsg(w, 4, F.session, [0, endTs, startTs, total, total, all.dist * 100, all.kj, all.avgSpeed * 1000, all.maxSpeed * 1000,
    all.avgHr || null, all.maxHr || null, all.avgCad || null, all.maxCad || null, all.avgP, all.maxP, all.np, 0, groups.length, SPORT, SUB, 8, 1]);
  // activity
  defMsg(w, 5, 34, F.activity);
  dataMsg(w, 5, F.activity, [endTs, total, 1, 0, 26, 1]);

  const data = w.b;
  const h = new Writer();
  h.u8(14); h.u8(0x20); h.u16(2140); h.u32(data.length);
  h.b.push(0x2e, 0x46, 0x49, 0x54); // ".FIT"
  h.u16(crc16(h.b));
  const out = [...h.b, ...data];
  const c = crc16(out);
  out.push(c & 0xff, c >> 8);
  return Uint8Array.from(out);
}

export function fitFileName(session, planTitle = 'ciclomulino') {
  const d = new Date(session.startedAt || Date.now()), p = n => String(n).padStart(2, '0');
  const slug = planTitle.toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'ciclomulino';
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}-${slug}.fit`;
}
