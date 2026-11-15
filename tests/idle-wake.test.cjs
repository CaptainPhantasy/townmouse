'use strict';

/*
 * P1-43 regression: after seven seconds the chrome collapses, but the first
 * tap must still reach the terminal. There is no invisible wake overlay.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const puppeteer = require('puppeteer');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.IDLE_WAKE_PORT || 11401);
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
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'townmouse-idle-wake-'));
  const app = spawn(process.execPath, [path.join(ROOT, 'src', 'server.js')], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), TOWNMOUSE_STATE_DIR: stateDir },
    stdio: ['ignore', 'ignore', 'pipe']
  });
  let stderr = '';
  app.stderr.on('data', (chunk) => { stderr += chunk; });
  let browser = null;
  try {
    await waitHealth();
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 393, height: 852, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
    await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction('window.__terminalOne && window.__terminalOne.dimensions()', { timeout: 15000 });
    await page.waitForFunction('document.body.classList.contains("chrome-idle")', { timeout: 20000 });

    const idleState = await page.evaluate(() => ({
      keybar: getComputedStyle(document.querySelector('#keybarIphone')).display,
      header: getComputedStyle(document.querySelector('.terminal-header')).display
    }));
    assert.strictEqual(idleState.header, 'none', 'header should hide when chrome is idle');

    await page.evaluate(() => {
      window.__wakeTaps = 0;
      document.querySelector('#terminal').addEventListener('pointerdown', () => { window.__wakeTaps += 1; }, true);
    });
    const box = await page.evaluate(() => {
      const rect = document.querySelector('#terminal').getBoundingClientRect();
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    });
    await page.mouse.click(box.x, box.y);
    await page.waitForFunction('!document.body.classList.contains("chrome-idle")', { timeout: 5000 });
    await wait(200);

    const awake = await page.evaluate(() => ({
      taps: window.__wakeTaps,
      idle: document.body.classList.contains('chrome-idle'),
      device: document.body.dataset.device,
      keybar: getComputedStyle(document.querySelector('#keybarIphone')).display,
      active: document.activeElement && document.activeElement.className
    }));
    assert.strictEqual(awake.taps, 1, 'the wake tap must reach the terminal');
    assert.notStrictEqual(awake.keybar, 'none', 'key bar should return after waking');
    assert(String(awake.active).includes('xterm-helper-textarea'), `terminal should take focus after waking (got ${awake.active})`);
    console.log('PASS idle wake: first tap reaches the terminal and restores chrome');
    console.log('RESULT passed=1 total=1 failures=0');
  } catch (error) {
    console.error('FAIL idle wake:', error.message);
    if (stderr) console.error(stderr.slice(-1200));
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
})();
