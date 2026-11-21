'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { resolveDependencyFile, splitPackagePath } = require('../src/static-deps');

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-deps-'));
  const write = (relative, body = 'x') => {
    const file = path.join(root, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, body);
  };
  // Hoisted layout: dependencies sit at the project root, next to the package.
  write('node_modules/@xterm/xterm/lib/xterm.mjs');
  write('node_modules/@xterm/addon-fit/lib/addon-fit.mjs');
  write('node_modules/express/index.js');
  // Nested layout: a package-local copy.
  const nested = path.join(root, 'nested');
  write('nested/node_modules/@xterm/xterm/lib/xterm.mjs');
  return { root, nested, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

test('splits scoped and unscoped request paths', () => {
  assert.deepEqual(splitPackagePath('/@xterm/xterm/lib/xterm.mjs'), { name: '@xterm/xterm', rest: 'lib/xterm.mjs' });
  assert.deepEqual(splitPackagePath('/express/index.js'), { name: 'express', rest: 'index.js' });
  assert.equal(splitPackagePath('/@xterm/xterm'), null);
  assert.equal(splitPackagePath('/'), null);
});

test('resolves a hoisted dependency, as produced by npm install townmouse', () => {
  const { root, cleanup } = fixture();
  try {
    const found = resolveDependencyFile('/@xterm/xterm/lib/xterm.mjs', [path.join(root, 'node_modules')]);
    assert.equal(found, path.join(root, 'node_modules', '@xterm', 'xterm', 'lib', 'xterm.mjs'));
  } finally { cleanup(); }
});

test('resolves a nested dependency, as produced by a global install', () => {
  const { nested, cleanup } = fixture();
  try {
    const found = resolveDependencyFile('/@xterm/xterm/lib/xterm.mjs', [path.join(nested, 'node_modules')]);
    assert.equal(found, path.join(nested, 'node_modules', '@xterm', 'xterm', 'lib', 'xterm.mjs'));
  } finally { cleanup(); }
});

test('refuses traversal outside the package directory', () => {
  const { root, cleanup } = fixture();
  try {
    const base = path.join(root, 'node_modules');
    assert.equal(resolveDependencyFile('/@xterm/xterm/../../express/index.js', [base]), null);
    // The route decodes before resolving; `..` must not escape the package.
    assert.equal(resolveDependencyFile(decodeURIComponent('/@xterm/xterm/%2e%2e/%2e%2e/express/index.js'), [base]), null);
  } finally { cleanup(); }
});

test('returns null for a missing file or package instead of throwing', () => {
  const { root, cleanup } = fixture();
  try {
    const base = path.join(root, 'node_modules');
    assert.equal(resolveDependencyFile('/@xterm/xterm/lib/missing.mjs', [base]), null);
    assert.equal(resolveDependencyFile('/not-a-package/index.js', [base]), null);
    assert.equal(resolveDependencyFile('/express', [base]), null);
  } finally { cleanup(); }
});

test('the real checkout resolves the terminal engine through Node lookup paths', () => {
  const found = resolveDependencyFile('/@xterm/xterm/lib/xterm.mjs');
  assert.ok(found && fs.existsSync(found), 'xterm.mjs must resolve from the installed tree');
  const css = resolveDependencyFile('/@xterm/xterm/css/xterm.css');
  assert.ok(css && fs.existsSync(css), 'xterm.css must resolve from the installed tree');
  const fit = resolveDependencyFile('/@xterm/addon-fit/lib/addon-fit.mjs');
  assert.ok(fit && fs.existsSync(fit), 'addon-fit must resolve from the installed tree');
});
