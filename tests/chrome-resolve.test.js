'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveChrome } = require('../src/chrome-resolve');

const only = (...files) => (file) => files.includes(file);
const none = () => null;

test('an explicit TERMINALONE_CHROME wins', () => {
  const resolved = resolveChrome({
    platform: 'darwin',
    env: { TERMINALONE_CHROME: '/opt/chrome' },
    exists: only('/opt/chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'),
    puppeteerPath: none
  });
  assert.deepEqual(resolved, { path: '/opt/chrome', source: 'TERMINALONE_CHROME' });
});

test('a missing configured path falls through instead of failing', () => {
  const resolved = resolveChrome({
    platform: 'darwin',
    env: { TERMINALONE_CHROME: '/gone/chrome' },
    exists: only('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'),
    puppeteerPath: none
  });
  assert.equal(resolved.source, 'system');
});

test("prefers Puppeteer's downloaded build when it exists", () => {
  const resolved = resolveChrome({
    platform: 'darwin',
    env: {},
    exists: only('/cache/chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'),
    puppeteerPath: () => '/cache/chrome'
  });
  assert.deepEqual(resolved, { path: '/cache/chrome', source: 'puppeteer' });
});

test('falls back to a system Chrome or Chromium', () => {
  for (const [platform, file] of [
    ['darwin', '/Applications/Chromium.app/Contents/MacOS/Chromium'],
    ['linux', '/usr/bin/chromium'],
    ['win32', 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe']
  ]) {
    const resolved = resolveChrome({ platform, env: {}, exists: only(file), puppeteerPath: none });
    assert.deepEqual(resolved, { path: file, source: 'system' }, platform);
  }
});

test('expands the per-user Applications directory on macOS', () => {
  const resolved = resolveChrome({
    platform: 'darwin',
    home: '/Users/someone',
    env: {},
    exists: only('/Users/someone/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'),
    puppeteerPath: none
  });
  assert.equal(resolved.path, '/Users/someone/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
});

test('returns null when nothing is installed', () => {
  assert.equal(resolveChrome({ platform: 'linux', env: {}, exists: () => false, puppeteerPath: none }), null);
  assert.equal(resolveChrome({ platform: 'plan9', env: {}, exists: () => false, puppeteerPath: none }), null);
});
