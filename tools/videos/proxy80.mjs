// Servidor local para gravação: http://apolven.lorler.com.br (porta 80; o Chromium resolve para 127.0.0.1).
// Serve o build de produção (frontend/dist, fallback SPA) e encaminha /api para a API local (3334).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const DIST = new URL('../../frontend/dist', import.meta.url).pathname;
const PUB = new URL('../../frontend/public', import.meta.url).pathname;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.mp4': 'video/mp4', '.vtt': 'text/vtt; charset=utf-8', '.json': 'application/json', '.woff2': 'font/woff2' };
const isFile = (x) => { try { return fs.statSync(x).isFile(); } catch { return false; } };

http.createServer((req, res) => {
  if (req.url.startsWith('/api')) {
    const p = http.request({ host: '127.0.0.1', port: 3334, path: req.url, method: req.method, headers: { ...req.headers, host: '127.0.0.1:3334' } }, (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
    p.on('error', () => { res.statusCode = 502; res.end(); });
    req.pipe(p);
    return;
  }
  const u = decodeURIComponent(req.url.split('?')[0]);
  const cands = [path.join(DIST, u), path.join(PUB, u)].filter((x) => (x.startsWith(DIST) || x.startsWith(PUB)) && isFile(x));
  const f = cands[0] || path.join(DIST, 'index.html');
  const size = fs.statSync(f).size;
  const type = TYPES[path.extname(f)] || 'application/octet-stream';
  const range = req.headers.range;
  if (range) {
    const [a, b] = range.replace('bytes=', '').split('-');
    const start = Number(a) || 0;
    const end = b ? Number(b) : size - 1;
    res.writeHead(206, { 'content-type': type, 'content-range': `bytes ${start}-${end}/${size}`, 'accept-ranges': 'bytes', 'content-length': end - start + 1 });
    fs.createReadStream(f, { start, end }).pipe(res);
    return;
  }
  res.writeHead(200, { 'content-type': type, 'content-length': size, 'accept-ranges': 'bytes' });
  fs.createReadStream(f).pipe(res);
}).listen(80, '127.0.0.1');
