'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { fixHelpersIn, spawnHelpers, nodePtyDir } = require('../src/pty-permissions');

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-pty-'));
  const write = (relative, mode = 0o644) => {
    const file = path.join(root, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, 'helper');
    fs.chmodSync(file, mode);
  };
  write('prebuilds/darwin-arm64/spawn-helper');
  write('prebuilds/darwin-x64/spawn-helper');
  write('prebuilds/linux-x64/pty.node');
  return { root, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

test('finds every spawn helper npm shipped without an execute bit', () => {
  const { root, cleanup } = fixture();
  try {
    const helpers = spawnHelpers(root);
    assert.equal(helpers.length, 2);
    const fixed = fixHelpersIn(root);
    assert.equal(fixed.length, 2, 'both helpers were repaired');
    for (const helper of helpers) {
      assert.ok((fs.statSync(helper).mode & 0o111) === 0o111, `${helper} must be executable`);
    }
  } finally { cleanup(); }
});

test('is idempotent and does nothing on a second pass', () => {
  const { root, cleanup } = fixture();
  try {
    fixHelpersIn(root);
    assert.deepEqual(fixHelpersIn(root), [], 'nothing left to fix');
  } finally { cleanup(); }
});

test('finds a helper produced by a source build', () => {
  const { root, cleanup } = fixture();
  try {
    const built = path.join(root, 'build', 'Release', 'spawn-helper');
    fs.mkdirSync(path.dirname(built), { recursive: true });
    fs.writeFileSync(built, 'helper');
    fs.chmodSync(built, 0o644);
    assert.ok(spawnHelpers(root).includes(built));
    assert.equal(fixHelpersIn(root).length, 3);
  } finally { cleanup(); }
});

test('returns an empty repair list for a directory without node-pty files', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-pty-empty-'));
  try {
    assert.deepEqual(fixHelpersIn(root), []);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('resolves the installed node-pty package root', () => {
  const dir = nodePtyDir();
  assert.ok(dir, 'node-pty must be resolvable from this project');
  assert.ok(fs.existsSync(path.join(dir, 'package.json')));
});
