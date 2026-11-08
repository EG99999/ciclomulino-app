// Logo «OPEN TRAINER» a blocchi di pietra con spessore e bordo scuro (stile videogioco a cubi), disegnato su canvas.
const G5 = {
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  N: ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  I: ['01110', '00100', '00100', '00100', '00100', '00100', '01110']
};
const hash = (x, y) => { let n = Math.imul(x * 374761393 + y * 668265263, 2246822519); n ^= n >>> 13; n = Math.imul(n, 3266489917); return ((n ^ (n >>> 16)) >>> 0) / 4294967295; };
function cells(word) {
  const out = []; let x0 = 0;
  for (const ch of word) { G5[ch].forEach((row, y) => { for (let x = 0; x < 5; x++) if (row[x] === '1') out.push([x0 + x, y]); }); x0 += 6; }
  return { cells: out, w: x0 - 1 };
}
/** disegna il logo; ritorna {w,h} in pixel. B = lato del blocco */
export function drawLogo(canvas, B) {
  B = Math.max(4, Math.floor(B));
  const l1 = cells('OPEN'), l2 = cells('TRAINER'), depth = Math.max(2, Math.round(B * 0.45)), W = l2.w * B + depth + B * 2, H = (7 + 2 + 7) * B + depth + B * 2;
  canvas.width = W; canvas.height = H;
  const g = canvas.getContext('2d'); g.imageSmoothingEnabled = false; g.clearRect(0, 0, W, H);
  const lines = [[l1, Math.floor((l2.w - l1.w) / 2), 0], [l2, 0, 9]];
  const drawLine = (pass) => {
    for (const [ln, ox, oy] of lines) for (const [cx, cy] of ln.cells) {
      const px = B + (ox + cx) * B, py = B + (oy + cy) * B;
      if (pass === 'outline') { g.fillStyle = '#0b0818'; g.fillRect(px - 2, py - 2, B + 4 + depth, B + 4 + depth); }
      else if (pass === 'depth') { for (let d = depth; d >= 1; d--) { g.fillStyle = d > depth / 2 ? '#3b3b44' : '#4c4c58'; g.fillRect(px + d, py + d, B, B); } }
      else {
        const gy = (oy + cy) / 16, base = 150 - Math.round(gy * 40), n = hash(ox + cx, oy + cy), v = base + Math.round((n - 0.5) * 34);
        g.fillStyle = `rgb(${v},${v},${v + 8})`; g.fillRect(px, py, B, B);
        // venature della pietra
        g.fillStyle = `rgba(0,0,0,${0.10 + hash(cx * 7, cy * 3 + oy) * 0.12})`; g.fillRect(px + Math.floor(B * 0.2), py + Math.floor(B * 0.55), Math.ceil(B * 0.45), Math.max(1, Math.floor(B * 0.12)));
        // bordi in luce e in ombra
        g.fillStyle = 'rgba(255,255,255,.45)'; g.fillRect(px, py, B, Math.max(1, Math.floor(B * 0.12))); g.fillRect(px, py, Math.max(1, Math.floor(B * 0.12)), B);
        g.fillStyle = 'rgba(0,0,0,.40)'; g.fillRect(px, py + B - Math.max(1, Math.floor(B * 0.14)), B, Math.max(1, Math.floor(B * 0.14))); g.fillRect(px + B - Math.max(1, Math.floor(B * 0.14)), py, Math.max(1, Math.floor(B * 0.14)), B);
      }
    }
  };
  drawLine('outline'); drawLine('depth'); drawLine('face');
  return { w: W, h: H };
}
