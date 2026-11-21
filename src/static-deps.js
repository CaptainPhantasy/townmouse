'use strict';

const fs = require('fs');
const path = require('path');

// The frontend imports the terminal engine straight from the installed package:
//
//   <link rel="stylesheet" href="/node_modules/@xterm/xterm/css/xterm.css">
//   import { Terminal } from '/node_modules/@xterm/xterm/lib/xterm.mjs';
//
// `path.join(__dirname, '..', 'node_modules')` only holds those files in a
// checkout or a global install. A normal `npm install townmouse` (and `npx`)
// hoists dependencies to the project root, so that directory does not exist and
// every xterm asset 404s — the server answers /health while the terminal page is
// unusable. Resolve each package through Node's own lookup paths instead, which
// is correct for hoisted, nested, global, and monorepo layouts alike.

function splitPackagePath(requestPath) {
  const clean = String(requestPath || '').replace(/\\/g, '/').replace(/^\/+/, '');
  const segments = clean.split('/').filter((segment) => segment && segment !== '.' && segment !== '..');
  if (!segments.length) return null;
  const scoped = segments[0].startsWith('@');
  const name = scoped ? segments.slice(0, 2).join('/') : segments[0];
  if (!scoped && !/^[a-z0-9._-]+$/i.test(name)) return null;
  const rest = segments.slice(scoped ? 2 : 1).join('/');
  if (!rest) return null;
  return { name, rest };
}

function resolveDependencyFile(requestPath, searchPaths) {
  const parsed = splitPackagePath(requestPath);
  if (!parsed) return null;
  const { name, rest } = parsed;
  const bases = searchPaths || require.resolve.paths(name) || [];
  for (const base of bases) {
    if (!base) continue;
    const dir = path.resolve(base, name);
    const file = path.resolve(dir, rest);
    // Refuse anything that escapes the package directory.
    if (file !== dir && !file.startsWith(dir + path.sep)) continue;
    try {
      if (fs.statSync(file).isFile()) return file;
    } catch (_) { /* not in this root */ }
  }
  return null;
}

function installStaticDependencies(app) {
  app.use('/node_modules', (req, res, next) => {
    let requestPath;
    try { requestPath = decodeURIComponent(req.path); } catch (_) { return next(); }
    const file = resolveDependencyFile(requestPath);
    if (!file) return next();
    res.setHeader('Cache-Control', 'no-store');
    res.sendFile(file, (error) => {
      if (error && !res.headersSent) next();
    });
  });
}

module.exports = { installStaticDependencies, resolveDependencyFile, splitPackagePath };
