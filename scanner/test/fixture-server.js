'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROUTES = {
  '/': 'index.html',
  '/impressum': 'impressum.html',
  '/datenschutz': 'index.html',
  '/barrierefreiheit': 'barrierefreiheit.html',
};

function serve(dir, port) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    let file;
    if (url.pathname === '/robots.txt') file = 'robots.txt';
    else if (url.pathname.startsWith('/produkt/')) file = 'product.html';
    else file = ROUTES[url.pathname.replace(/\/$/, '') || '/'] || ROUTES[url.pathname];

    if (!file) { res.writeHead(404, { 'content-type': 'text/plain' }); return res.end('not found'); }
    const p = path.join(dir, file);
    if (!fs.existsSync(p)) { res.writeHead(404, { 'content-type': 'text/plain' }); return res.end('not found'); }
    res.writeHead(200, { 'content-type': file.endsWith('.txt') ? 'text/plain; charset=utf-8' : 'text/html; charset=utf-8' });
    res.end(fs.readFileSync(p));
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}

/** A host that accepts the connection then never answers — the hang case. */
function serveBlackHole(port) {
  const server = http.createServer(() => { /* deliberately never responds */ });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}

module.exports = { serve, serveBlackHole };
