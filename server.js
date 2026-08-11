/**
 * Yerel HTTP sunucusu - Service Worker'ın çalışması için güvenli origin (http://localhost)
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const MIME = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
};

function serve(appPath, port) {
  const appRoot = path.resolve(appPath);
  const server = http.createServer((req, res) => {
    const parsed = url.parse(req.url, true);
    let pathname = parsed.pathname || '/';
    try {
      pathname = decodeURIComponent(pathname);
    } catch (_) {
      res.writeHead(400);
      res.end();
      return;
    }
    if (pathname === '/') pathname = '/index.html';
    const relPath = pathname.replace(/^\/+/, '');
    const resolvedPath = path.resolve(appRoot, relPath);
    if (!resolvedPath.startsWith(appRoot + path.sep)) {
      res.writeHead(403);
      res.end();
      return;
    }

    fs.stat(resolvedPath, (err, stat) => {
      if (err || !stat.isFile()) {
        res.writeHead(404);
        res.end();
        return;
      }
      const ext = path.extname(resolvedPath);
      const contentType = MIME[ext] || 'application/octet-stream';
      res.setHeader('Content-Type', contentType);
      res.setHeader('Cache-Control', 'no-cache');
      const stream = fs.createReadStream(resolvedPath);
      stream.on('error', () => {
        if (!res.headersSent) res.writeHead(500);
        res.end();
      });
      stream.pipe(res);
    });
  });

  return new Promise((resolve, reject) => {
    const onError = (err) => {
      // Bağlanamayan sunucu nesnesini bırakma; çağıran sıradaki portu deneyecek.
      try { server.close(); } catch (_) {}
      reject(err);
    };
    server.once('error', onError);
    server.listen(port, '127.0.0.1', () => {
      server.removeListener('error', onError);
      resolve(server);
    });
  });
}

module.exports = { serve };
