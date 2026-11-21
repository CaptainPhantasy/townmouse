'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

// Where a browser engine might already be. A packaged install cannot assume
// Puppeteer's own download exists: npm 12 skips dependency install scripts by
// default (`allow-scripts = [""]`), and even when it runs, the pinned download
// version may differ from what is cached. A system Chrome/Chromium is a normal,
// safe fallback for a local tool.
const CANDIDATES = {
  darwin: [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '{home}/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '{home}/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser'
  ],
  linux: [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/snap/bin/chromium',
    '/usr/bin/microsoft-edge'
  ],
  win32: [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
  ]
};

function defaultPuppeteerPath() {
  try {
    const puppeteer = require('puppeteer');
    return typeof puppeteer.executablePath === 'function' ? puppeteer.executablePath() : null;
  } catch (_) { return null; }
}

/**
 * Resolve a Chromium-compatible executable.
 *
 * Order: explicit configuration, Puppeteer's downloaded build, then a system
 * browser. Returns `{ path, source }` or null — never throws, so a missing
 * browser produces a clear message at use time rather than at startup.
 */
function resolveChrome(options = {}) {
  const platform = options.platform || process.platform;
  const env = options.env || process.env;
  const home = options.home || os.homedir();
  const exists = options.exists || ((file) => { try { return fs.existsSync(file); } catch (_) { return false; } });
  const puppeteerPath = options.puppeteerPath || defaultPuppeteerPath;

  const configured = env.TERMINALONE_CHROME;
  if (configured && exists(configured)) return { path: configured, source: 'TERMINALONE_CHROME' };

  const downloaded = puppeteerPath();
  if (downloaded && exists(downloaded)) return { path: downloaded, source: 'puppeteer' };

  for (const candidate of CANDIDATES[platform] || []) {
    const file = candidate.replace('{home}', home);
    if (exists(file)) return { path: file, source: 'system' };
  }
  return null;
}

function missingBrowserMessage() {
  return [
    'No browser engine was found for browser panes.',
    'Use one of:',
    '  - install Chrome or Chromium; or',
    '  - set TERMINALONE_CHROME=/path/to/chrome; or',
    '  - run: npx puppeteer browsers install chrome'
  ].join('\n');
}

module.exports = { resolveChrome, missingBrowserMessage, CANDIDATES, defaultPuppeteerPath };
