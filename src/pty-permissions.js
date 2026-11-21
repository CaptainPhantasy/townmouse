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

module.exports = { ensurePtyHelpers, nodePtyDir, spawnHelpers, fixHelpersIn };
