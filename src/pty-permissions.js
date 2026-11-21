'use strict';

const fs = require('fs');
const path = require('path');

// node-pty launches a small `spawn-helper` binary on macOS. An npm tarball does
// not carry the executable bit, and npm 12 skips dependency install scripts by
// default (`allow-scripts = [""]`), so the package's postinstall cannot be the
// only thing that fixes it. Without the bit, every terminal pane fails with
// "posix_spawnp failed" while the rest of the app looks healthy.
//
// The repair is a mode change on a file inside the installed package, so the
// server can safely do it at startup on the machine that owns the file.

function nodePtyDir() {
  let dir;
  try { dir = path.dirname(require.resolve('node-pty')); } catch (_) { return null; }
  const root = path.parse(dir).root;
  let current = dir;
  while (current !== root && !fs.existsSync(path.join(current, 'package.json'))) {
    current = path.dirname(current);
  }
  return fs.existsSync(path.join(current, 'package.json')) ? current : null;
}

function spawnHelpers(dir) {
  const helpers = [];
  const prebuilds = path.join(dir, 'prebuilds');
  let entries = [];
  try { entries = fs.readdirSync(prebuilds); } catch (_) { entries = []; }
  for (const entry of entries) {
    const helper = path.join(prebuilds, entry, 'spawn-helper');
    if (fs.existsSync(helper)) helpers.push(helper);
  }
  // A source build (node-gyp) puts it here instead.
  const built = path.join(dir, 'build', 'Release', 'spawn-helper');
  if (fs.existsSync(built)) helpers.push(built);
  return helpers;
}

function fixHelpersIn(dir) {
  const fixed = [];
  for (const helper of spawnHelpers(dir)) {
    try {
      const mode = fs.statSync(helper).mode;
      if ((mode & 0o111) === 0o111) continue;
      fs.chmodSync(helper, 0o755);
      fixed.push(helper);
    } catch (_) { /* not ours to change; the spawn error will name it */ }
  }
  return fixed;
}

function ensurePtyHelpers() {
  // Only macOS needs the helper. Elsewhere this is a no-op by design.
  if (process.platform !== 'darwin') return { dir: null, fixed: [] };
  const dir = nodePtyDir();
  if (!dir) return { dir: null, fixed: [] };
  return { dir, fixed: fixHelpersIn(dir) };
}

// A missing or unbuilt native engine otherwise surfaces as a raw stack trace
// from a `require` deep inside startup. The condition is common: npm 12 skips
// dependency install scripts by default and node-pty has no Linux prebuild.
const TERMINAL_ENGINE_ERROR = /node-pty|posix_spawn|pty\.node|bindings/i;

function isTerminalEngineError(error) {
  if (!error) return false;
  return TERMINAL_ENGINE_ERROR.test(`${error.code || ''} ${error.message || error}`);
}

function terminalEngineHelp(platform = process.platform, detail = '') {
  const linux = platform === 'linux';
  const lines = ['Townmouse cannot start: the terminal engine (node-pty) could not load.'];
  if (detail) lines.push(String(detail).split('\n')[0]);
  lines.push('', 'The native module is missing or was built for another platform.');
  if (linux) {
    lines.push('npm 12 does not run dependency install scripts by default, and node-pty');
    lines.push('has no prebuilt Linux binary, so an install that skipped scripts has none.');
  }
  lines.push(
    '',
    'Fix one of these, then check with `npm run doctor`:',
    '  npm rebuild node-pty                              (needs python3, make, g++)'
  );
  if (linux) lines.push('  npm install --allow-scripts=node-pty townmouse     (Linux, npm 12)');
  lines.push('  container channel: see docs/PACKAGING.md');
  return lines.join('\n');
}

module.exports = {
  ensurePtyHelpers,
  nodePtyDir,
  spawnHelpers,
  fixHelpersIn,
  isTerminalEngineError,
  terminalEngineHelp,
  TERMINAL_ENGINE_ERROR
};
