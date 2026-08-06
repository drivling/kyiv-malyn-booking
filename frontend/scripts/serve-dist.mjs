/**
 * Static host for Railway: serve dist with directory index.html
 * even without a trailing slash, then SPA fallback to /index.html.
 *
 * vite preview (sirv + SPA) only serves nested index.html for ".../path/" —
 * ".../path" falls through to the root shell, so prerender is invisible to bots.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(__dirname, '../dist');
const port = Number(process.env.PORT) || 4173;
const host = '0.0.0.0';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
};

function safeJoin(root, urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0].split('#')[0]);
  const cleaned = path.normalize(decoded).replace(/^(\.\.[/\\])+/, '');
  const full = path.join(root, cleaned);
  if (!full.startsWith(root)) return null;
  return full;
}

function sendFile(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const type = MIME[ext] || 'application/octet-stream';
  res.writeHead(200, {
    'Content-Type': type,
    'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable',
  });
  fs.createReadStream(filePath).pipe(res);
}

function tryResolve(urlPath) {
  const base = safeJoin(dist, urlPath);
  if (!base) return null;

  if (fs.existsSync(base) && fs.statSync(base).isFile()) return base;

  // /foo or /foo/ → /foo/index.html (prerendered corridors / stops)
  const asDir = urlPath.endsWith('/') ? base : base;
  const indexInDir = path.join(asDir, 'index.html');
  if (fs.existsSync(indexInDir) && fs.statSync(indexInDir).isFile()) return indexInDir;

  return null;
}

const server = http.createServer((req, res) => {
  const urlPath = req.url || '/';
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405);
    res.end();
    return;
  }

  const resolved = tryResolve(urlPath === '/' ? '/index.html' : urlPath);
  if (resolved) {
    if (req.method === 'HEAD') {
      res.writeHead(200, { 'Content-Type': MIME[path.extname(resolved)] || 'application/octet-stream' });
      res.end();
      return;
    }
    sendFile(res, resolved);
    return;
  }

  const spa = path.join(dist, 'index.html');
  if (fs.existsSync(spa)) {
    sendFile(res, spa);
    return;
  }
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not found');
});

if (!fs.existsSync(dist)) {
  console.error('serve-dist: dist/ missing — run npm run build first');
  process.exit(1);
}

server.listen(port, host, () => {
  console.log(`serve-dist: http://${host}:${port} (root ${dist})`);
});
