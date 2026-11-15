'use strict';

/*
 * P0-1 regression: resume a session at a wider viewport without reflowing the
 * old PTY buffer into fragments. The command and its output are produced at a
 * narrow width, then the page reloads at desktop width and resumes.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const puppeteer = require('puppeteer');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.RESUME_WIDTH_PORT || 11394);
const BASE = `http://127.0.0.1:${PORT}`;
const MARKER = 'BEGIN_RESUME_MARKER_0123456789_ABCDEFGHIJ_END';
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitHealth() {
  for (let i = 0; i < 120; i++) {
    try {
      const response = await fetch(`${BASE}/health`);
      if (response.ok) return;
    } catch (_) { /* starting */ }
    await wait(150);
  }
  throw new Error('server did not become healthy');
}

async function assertPortFree() {
  try {
    await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(500) });
  } catch (_) {
    return; // nothing is listening
  }
  throw new Error(`port ${PORT} is already serving a server; refusing to test against stale code`);
}

(async () => {
  await assertPortFree();
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'townmouse-resume-width-'));
  const app = spawn(process.execPath, [path.join(ROOT, 'src', 'server.js')], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), SHELL: '/bin/bash', TOWNMOUSE_STATE_DIR: stateDir },
    stdio: ['ignore', 'ignore', 'pipe']
  });
  let stderr = '';
  app.stderr.on('data', (chunk) => { stderr += chunk; });
  let browser = null;
  let page = null;

  try {
    await waitHealth();
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });
    page = await browser.newPage();
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await page.setViewport({ width: 420, height: 800, deviceScaleFactor: 1 });
    await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
    console.log('step: page loaded');
    await page.waitForFunction('window.__terminalOne && window.__terminalOne.dimensions()', { timeout: 15000 });
    console.log('step: terminal ready');
    await wait(1000);

    const narrow = await page.evaluate(() => window.__terminalOne.dimensions());
    assert(narrow.cols < 60, `expected a narrow PTY before reload, got ${narrow.cols} cols`);

    await page.click('#terminal');
    await page.keyboard.type(`echo ${MARKER}`);
    await page.keyboard.press('Enter');
    console.log('step: typed command');
    await page.waitForFunction(
      (marker) => window.__terminalOne.text().replace(/\n/g, '').includes(marker),
      { timeout: 15000 },
      MARKER
    );
    console.log('step: marker visible');
    const before = await page.evaluate(() => window.__terminalOne.text());
    assert(before.replace(/\n/g, '').includes(MARKER), 'command output never reached the terminal');

    // Reload at desktop width. localStorage carries the session id, so the
    // client reconnects with `resume` and a much larger viewport.
    await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction('window.__terminalOne && window.__terminalOne.dimensions()', { timeout: 15000 });
    await page.waitForFunction(
      (marker) => window.__terminalOne.text().replace(/\n/g, '').includes(marker),
      { timeout: 20000 },
      MARKER
    );
    await page.waitForFunction('window.__terminalOne.dimensions().cols > 80', { timeout: 15000 });
    await wait(500);

    const wide = await page.evaluate(() => window.__terminalOne.dimensions());
    const after = await page.evaluate(() => window.__terminalOne.text());
    const flat = after.replace(/\n/g, '');
    const occurrences = flat.split(MARKER).length - 1;

    assert(
      occurrences >= 2,
      `full marker should survive in both the command and output; found ${occurrences}\n${after.slice(-1200)}`
    );
    assert(pageErrors.length === 0, `page errors during resume: ${pageErrors.join(' | ')}`);
    console.log(`PASS resume width: ${narrow.cols}x${narrow.rows} -> ${wide.cols}x${wide.rows}, marker intact ${occurrences}x`);
    console.log('RESULT passed=1 total=1 failures=0');
  } catch (error) {
    console.error('FAIL resume width:', error.message);
    if (page) {
      try {
        const debug = await page.evaluate(() => ({
          active: document.activeElement && (document.activeElement.className || document.activeElement.tagName),
          status: document.querySelector('#connectionStatus')?.textContent || document.querySelector('[data-status]')?.textContent || '',
          footer: document.querySelector('#footerMeta')?.textContent || '',
          text: window.__terminalOne ? window.__terminalOne.text().slice(-800) : '(no terminal api)'
        }));
        console.error('DEBUG', JSON.stringify(debug));
      } catch (e) { console.error('DEBUG failed', e.message); }
    }
    if (stderr) console.error(stderr.slice(-1500));
    console.log('RESULT passed=0 total=1 failures=1');
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close().catch(() => {});
    await new Promise((resolve) => {
      const timer = setTimeout(() => { try { app.kill('SIGKILL'); } catch (_) {} }, 4000);
      app.once('exit', () => { clearTimeout(timer); resolve(); });
      try { app.kill('SIGTERM'); } catch (_) { clearTimeout(timer); resolve(); }
    });
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error('FAIL resume width:', error.message);
  console.log('RESULT passed=0 total=1 failures=1');
  process.exitCode = 1;
});
