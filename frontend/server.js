const http = require('http');
const fs = require('fs');
const path = require('path');

const port = Number(process.env.PORT) || 3002;
const apiTarget = process.env.API_TARGET || 'http://server:3001';
const distDir = path.join(__dirname, 'dist');

const mimeTypes = {
  '.css': 'text/css',
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.map': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const sendFile = (res, filePath) => {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end();
      return;
    }

    res.writeHead(200, {
      'Content-Type': mimeTypes[path.extname(filePath)] || 'application/octet-stream',
      'Cache-Control': path.basename(filePath) === 'index.html' ? 'no-cache' : 'public, max-age=31536000, immutable',
    });
    res.end(data);
  });
};

const proxyApi = (req, res) => {
  const target = new URL(req.url, apiTarget);
  const proxyReq = http.request(target, {
    method: req.method,
    headers: {
      ...req.headers,
      host: target.host,
    },
  }, proxyRes => {
    res.writeHead(proxyRes.statusCode || 500, proxyRes.headers);
    proxyRes.pipe(res);
  });

  proxyReq.on('error', error => {
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'API proxy error', detail: error.message }));
  });

  req.pipe(proxyReq);
};

http.createServer((req, res) => {
  if (req.url && req.url.startsWith('/api/')) {
    proxyApi(req, res);
    return;
  }

  const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  const requestedPath = path.normalize(path.join(distDir, urlPath));
  const safePath = requestedPath.startsWith(distDir) ? requestedPath : path.join(distDir, 'index.html');
  const filePath = fs.existsSync(safePath) && fs.statSync(safePath).isFile()
    ? safePath
    : path.join(distDir, 'index.html');

  sendFile(res, filePath);
}).listen(port, '0.0.0.0', () => {
  console.log(`NEN frontend serving on ${port}, proxying /api to ${apiTarget}`);
});
