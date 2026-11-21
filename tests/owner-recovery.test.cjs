'use strict';

/*
 * The owner capability and workspace key are minted per server process. A
 * restart used to leave an open page repeating "Only the owner can create
 * browser tabs." The page must refresh its owner session once and keep working.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const puppeteer = require('puppeteer');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.OWNER_RECOVERY_PORT || 11398);
const BASE = `http://127.0.0.1:${PORT}`;
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

(async () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'townmouse-owner-recovery-'));
  let app = null;
  const start = async () => {
    app = spawn(process.execPath, [path.join(ROOT, 'src', 'server.js')], {
      cwd: ROOT,
      env: { ...process.env, PORT: String(PORT), TOWNMOUSE_STATE_DIR: stateDir },
      stdio: ['ignore', 'ignore', 'pipe']
    });
    let stderr = '';
    app.stderr.on('data', (chunk) => { stderr += chunk; });
    app.stderrText = () => stderr;
    await waitHealth();
  };
  const stop = async () => {
    if (!app) return;
    const current = app;
    app = null;
    if (current.exitCode !== null || current.signalCode !== null) return;
    current.kill('SIGTERM');
    await new Promise((resolve) => {
      const timer = setTimeout(() => {
        try { current.kill('SIGKILL'); } catch (_) { /* already gone */ }
        resolve();
      }, 5000);
      current.once('exit', () => { clearTimeout(timer); resolve(); });
    });
    await wait(400);
  };

  let browser = null;
  try {
    await start();
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 1200, height: 800, deviceScaleFactor: 1 });
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle2' });
    await page.waitForFunction('window.__terminalOne && window.__terminalOne.dimensions()', { timeout: 15000 });
    await page.waitForFunction('sessionStorage.getItem("townmouse.ownerReloadAt") === null', { timeout: 5000 }).catch(() => {});

    await page.waitForSelector('#new-browser', { visible: true, timeout: 10000 });
    await page.click('#new-browser');
    await page.waitForFunction('document.querySelectorAll("#browser-tabs .browser-tab").length > 0', { timeout: 8000 });

    // Restart the server under the open page: both the owner cookie and the
    // workspace key are now stale from the page's point of view. Watch for the
    // app-triggered reload before restarting, then wait for the new document;
    // the old page also satisfies the terminal-ready and marker predicates.
    const reloaded = page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => null);
    await stop();
    await start();
    const navigation = await reloaded;
    assert(navigation, 'the page should reload to refresh the owner session');
    await page.waitForFunction('window.__terminalOne && window.__terminalOne.dimensions()', { timeout: 20000 });
    await page.waitForFunction('sessionStorage.getItem("townmouse.ownerReloadAt")', { timeout: 5000 }).catch(() => {});

    // A fresh click after the automatic refresh must work, and the page must
    // not still be repeating the old restriction.
    await page.waitForSelector('#new-browser', { visible: true, timeout: 10000 });
    await page.click('#new-browser');
    await page.waitForFunction('document.querySelectorAll("#browser-tabs .browser-tab").length > 0', { timeout: 8000 });
    const state = await page.evaluate(() => ({
      tabs: document.querySelectorAll('#browser-tabs .browser-tab').length,
      message: document.querySelector('#browser-message-text')?.textContent || ''
    }));
    assert(state.tabs >= 1, 'a browser tab must be creatable after owner-session recovery');
    assert(!/Only the owner|Workspace access required/.test(state.message),
      `owner restriction should be gone, message was: ${state.message}`);

    console.log('PASS owner recovery: stale workspace key refreshes and browser tabs work');
    console.log('RESULT passed=1 total=1 failures=0');
    process.exitCode = 0;
  } catch (error) {
    console.error(`FAIL owner recovery: ${error.message}`);
    if (app?.stderrText) console.error(`DEBUG server stderr:\n${app.stderrText().slice(-2000)}`);
    console.log('RESULT passed=0 total=1 failures=1');
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close().catch(() => {});
    await stop();
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
})();
