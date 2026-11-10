// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Gatti Elia
// Server statico minimo, SOLO per questo PC (127.0.0.1). Web Bluetooth richiede https o localhost.
// Serve soltanto i file del sito (non .git, note di lavoro, piano personale, test, node_modules) e rifiuta
// richieste con un Host diverso da localhost (difesa contro il «DNS rebinding»: una pagina esterna non può leggere i tuoi file).
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('.', import.meta.url));
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
const port = Number(process.env.PORT) || 8080;
const ALLOWED = /^\/(index\.html|sw\.js|manifest\.webmanifest|(css|js|icons|routes|fonts)\/[A-Za-z0-9_.\-\/]+)$/;
const HOST_OK = new RegExp('^(localhost|127\\.0\\.0\\.1):' + port + '$');
const SAFE = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY', 'Cross-Origin-Resource-Policy': 'same-origin' };
export function check(host, method, rawUrl) {       // restituisce {status} oppure {file}; separata dal server per poterla provare nei test
  if (!HOST_OK.test(host || '')) return { status: 421 };
  if (method !== 'GET' && method !== 'HEAD') return { status: 405 };
  let p; try { p = decodeURIComponent(new URL(rawUrl, 'http://x').pathname); } catch { return { status: 400 }; }
  if (p === '/') p = '/index.html';
  if (p.includes('..') || p.includes('\\') || p.includes('\0') || /\/\./.test(p) || !ALLOWED.test(p)) return { status: 403 };
  const file = normalize(join(root, p)); if (!file.startsWith(root)) return { status: 403 };
  return { file };
}
if (process.argv[1] && /serve\.mjs$/i.test(process.argv[1])) {
  http.createServer(async (req, res) => {
    const c = check(req.headers.host, req.method, req.url);
    if (!c.file) { res.writeHead(c.status, SAFE).end(); return; }
    try { const data = await readFile(c.file); res.writeHead(200, { ...SAFE, 'Content-Type': types[extname(c.file)] || 'application/octet-stream', 'Cache-Control': 'no-store' }).end(req.method === 'HEAD' ? undefined : data); }
    catch { res.writeHead(404, SAFE).end('Non trovato'); }
  }).listen(port, '127.0.0.1', () => console.log(`Open Trainer su http://localhost:${port}/  (Ctrl+C per fermare)`));
}
