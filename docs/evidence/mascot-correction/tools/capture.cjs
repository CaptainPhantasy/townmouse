'use strict';

// Captures TOWNMOUSE at the three required viewports plus a wide desktop.
// Usage: NODE_PATH=<repo>/node_modules node capture.cjs <output-directory>
const { spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = '/Volumes/SanDisk1Tb/TOWNMOUSE/repo';
const OUT = path.resolve(process.argv[2] || '/Volumes/SanDisk1Tb/TOWNMOUSE/stewardship/screens');
const PORT = 11357;
const FIXTURE_PORT = 11358;
const BASE = `http://127.0.0.1:${PORT}`;
const puppeteer = require('puppeteer');

const VIEWPORTS = [
  { name: 'phone', width: 393, height: 852, dpr: 3, mobile: true, ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1' },
  { name: 'tablet', width: 820, height: 1180, dpr: 2, mobile: false, ua: 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1' },
  { name: 'desktop', width: 1440, height: 900, dpr: 1, mobile: false },
  { name: 'wide', width: 1920, height: 1080, dpr: 1, mobile: false },
];

function health() {
  return new Promise((resolve, reject) => {
    const req = http.get(`${BASE}/health`, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode));
    });
    req.on('error', reject);
    req.setTimeout(2000, () => req.destroy(new Error('timeout')));
  });
}

async function waitForHealth(timeoutMs = 20000) {
  const started = Date.now();
  for (;;) {
    try { if (await health() === 200) return; } catch (_) { /* starting */ }
    if (Date.now() - started > timeoutMs) throw new Error('server did not become healthy');
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
}

async function clearBrowserTabs() {
  const boot = await (await fetch(`${BASE}/api/browser/bootstrap`)).json();
  const headers = { 'X-Workspace-Key': boot.key };
  const tabs = await (await fetch(`${BASE}/api/browser`, { headers })).json();
  for (const tab of tabs) {
    await fetch(`${BASE}/api/browser/${tab.id}`, { method: 'DELETE', headers });
  }
}

const PREVIEW_HTML = `<!doctype html><title>Local preview</title>
<style>body{font:22px -apple-system,BlinkMacSystemFont,sans-serif;padding:48px;background:#f8fafc;color:#1d2733}h1{letter-spacing:-.03em;margin:0 0 12px}p{color:#526171;line-height:1.6}input,button{font:inherit;padding:12px 14px;border:1px solid #cbd2dc;border-radius:9px;margin-top:18px}button{margin-left:8px;background:#175cbb;color:white;border-color:#175cbb}</style>
<h1>Local app preview</h1><p>Browser workspace integration test</p>
<input aria-label="Project name" placeholder="Project name">
<button onclick="document.querySelector('h1').textContent='Saved: '+document.querySelector('input').value">Save project</button>`;

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const fixture = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'text/html');
    res.end(PREVIEW_HTML);
  }).listen(FIXTURE_PORT, '127.0.0.1');

  const server = spawn(process.execPath, [path.join(ROOT, 'src', 'server.js')], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), SHELL: '/bin/bash' },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let serverErr = '';
  server.stderr.on('data', (chunk) => { serverErr += chunk; });
  let browser = null;
  try {
    await waitForHealth();
    browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    for (const vp of VIEWPORTS) {
      const context = await browser.createBrowserContext();
      const page = await context.newPage();
      await page.setViewport({ width: vp.width, height: vp.height, deviceScaleFactor: vp.dpr, hasTouch: vp.width < 1100, isMobile: vp.mobile });
      if (vp.ua) await page.setUserAgent(vp.ua);
      await page.goto(BASE, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => window.__workspace?.ready);
      await page.waitForFunction(() => document.querySelector('#status').classList.contains('connected'));
      await page.click('#terminal');
      await page.keyboard.type("export PS1='townmouse $ '; clear\n");
      await new Promise((resolve) => setTimeout(resolve, 800));
      await page.keyboard.press('Escape');
      await page.evaluate(() => document.activeElement?.blur());
      await page.mouse.move(0, 0);
      await new Promise((resolve) => setTimeout(resolve, 300));
      await page.screenshot({ path: path.join(OUT, `default-${vp.name}.png`) });

      const firstSession = await page.$eval('#sessionInfo', (el) => el.textContent);
      await page.click('#workspace-session-pill');
      await page.waitForFunction(() => document.querySelector('#session-menu')?.open);
      await page.mouse.move(0, 0);
      await new Promise((resolve) => setTimeout(resolve, 300));
      await page.screenshot({ path: path.join(OUT, `session-${vp.name}.png`) });
      await page.click('#session-menu-new');
      await page.waitForFunction((previous) => {
        const text = document.querySelector('#sessionInfo').textContent;
        return text && text !== previous;
      }, {}, firstSession);
      await page.waitForFunction(() => document.querySelector('#status').classList.contains('connected'));
      await page.click('#terminal');
      await page.keyboard.type("export PS1='townmouse $ '; clear\n");
      await new Promise((resolve) => setTimeout(resolve, 800));
      await page.keyboard.press('Escape');
      await page.evaluate(() => document.activeElement?.blur());
      await page.click('#workspace-session-pill');
      await page.waitForFunction(() => document.querySelector('#session-menu')?.open);
      await page.mouse.move(0, 0);
      await new Promise((resolve) => setTimeout(resolve, 300));
      await page.screenshot({ path: path.join(OUT, `sessions-${vp.name}.png`) });
      await page.click('#session-menu-close');

      await page.click('#workspace-browser');
      await page.waitForFunction(() => !document.querySelector('.browser-surface').hidden);
      await page.waitForFunction(() => {
        const mascot = document.querySelector('#browser-empty .browser-mascot');
        return mascot && mascot.complete;
      });
      await page.mouse.move(0, 0);
      await new Promise((resolve) => setTimeout(resolve, 300));
      await page.screenshot({ path: path.join(OUT, `empty-${vp.name}.png`) });
      await page.type('#browser-url', `http://127.0.0.1:${FIXTURE_PORT}`);
      await page.click('#browser-address button:last-child');
      await page.waitForFunction(() => document.querySelector('#browser-title').textContent === 'Local preview', { timeout: 12000 });
      await new Promise((resolve) => setTimeout(resolve, 600));
      await page.mouse.move(0, 0);
      await new Promise((resolve) => setTimeout(resolve, 300));
      await page.screenshot({ path: path.join(OUT, `browser-${vp.name}.png`) });

      if (vp.width < 1100) {
        const shareSelector = '#browser-share-toggle';
        await page.click(shareSelector);
        await page.waitForFunction(() => {
          const row = document.querySelector('#browser-permissions');
          return row && getComputedStyle(row).display !== 'none';
        });
        await page.mouse.move(0, 0);
        await new Promise((resolve) => setTimeout(resolve, 300));
        await page.screenshot({ path: path.join(OUT, `share-${vp.name}.png`) });
        await page.click(shareSelector);
      }

      await page.click('#workspace-tools');
      await page.waitForFunction(() => document.querySelector('.workspace-drawer').open);
      await page.evaluate(() => {
        const row = [...document.querySelectorAll('#t1toolbar .drawer-row')].find((button) => button.textContent.includes('Fullscreen'));
        if (row) {
          row.classList.add('active');
          row.scrollIntoView({ block: 'center', inline: 'nearest' });
        }
      });
      await new Promise((resolve) => setTimeout(resolve, 500));
      await page.mouse.move(0, 0);
      await new Promise((resolve) => setTimeout(resolve, 300));
      await page.screenshot({ path: path.join(OUT, `tools-${vp.name}.png`) });
      await page.evaluate(() => {
        const row = [...document.querySelectorAll('#t1toolbar .drawer-row.active')].find((button) => button.textContent.includes('Fullscreen'));
        if (row) row.classList.remove('active');
      });

      await page.click('#settingsBtn');
      await page.waitForFunction(() => document.querySelector('#settingsModal').classList.contains('open'));
      await page.mouse.move(0, 0);
      await new Promise((resolve) => setTimeout(resolve, 300));
      await page.screenshot({ path: path.join(OUT, `settings-${vp.name}.png`) });
      await page.click('#settingsClose');
      await page.waitForFunction(() => !document.querySelector('#settingsModal').classList.contains('open'));

      await page.click('#agent-browser');
      await page.waitForFunction(() => document.querySelector('#browser-title').textContent === 'Agent browser', { timeout: 12000 });
      await new Promise((resolve) => setTimeout(resolve, 600));
      await page.mouse.move(0, 0);
      await new Promise((resolve) => setTimeout(resolve, 300));
      await page.screenshot({ path: path.join(OUT, `agent-${vp.name}.png`) });

      await page.click('#workspace-tools');
      await page.waitForFunction(() => document.querySelector('.workspace-drawer').open);
      await page.click('#closeBtn');
      await page.waitForFunction(() => document.querySelector('#close-confirm')?.open);
      await page.mouse.move(0, 0);
      await new Promise((resolve) => setTimeout(resolve, 300));
      await page.screenshot({ path: path.join(OUT, `confirm-${vp.name}.png`) });
      await page.click('#close-confirm-cancel');

      await page.close();
      await context.close();
      await clearBrowserTabs();
      console.log(`captured ${vp.name} (${vp.width}x${vp.height})`);
    }
    console.log('screens in ' + OUT);
  } catch (err) {
    console.error(err && err.stack ? err.stack : err);
    if (serverErr) console.error(serverErr);
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close().catch(() => {});
    server.kill('SIGTERM');
    fixture.close();
    setTimeout(() => process.exit(process.exitCode || 0), 500);
  }
})();
