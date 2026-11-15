'use strict';
// Browser journey: run only when UI E2E is authorized by the operator.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const puppeteer = require('puppeteer');
const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.MAXIMIZE_PORT || 11410);
const BASE = `http://127.0.0.1:${PORT}`;
const wait = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const state = fs.mkdtempSync(path.join(os.tmpdir(), 'townmouse-maximize-'));
  const app = spawn(process.execPath, ['src/server.js'], { cwd: ROOT,
    env: { ...process.env, HOME: state, PORT: String(PORT), TOWNMOUSE_STATE_DIR: state },
    stdio: ['ignore', 'ignore', 'inherit'] });
  let browser;
  try {
    let healthy = false;
    for (let i = 0; i < 100; i++) {
      try { if ((await fetch(`${BASE}/health`)).ok) { healthy = true; break; } } catch (_) {}
      await wait(100);
    }
    assert(healthy, 'isolated server starts');
    browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });
    await page.goto(`${BASE}/panes.html`);
    await page.waitForSelector('.pane');
    const ids = await page.evaluate(async () => {
      const boot = await (await fetch('/api/panes/bootstrap')).json();
      const api = async (route, body) => {
        const r = await fetch(`/api/panes${route}`, { method: 'POST', headers: {'Content-Type':'application/json','X-Townmouse-Token':boot.token}, body:JSON.stringify(body) });
        if (!r.ok) throw Error(`API ${route}: ${r.status}`);
        return r.json();
      };
      const tab = await api('/tabs', { title: 'Maximize regression' });
      const first = await api(`/tabs/${tab.id}/panes`, { kind: 'terminal' });
      const second = await api(`/tabs/${tab.id}/panes`, { kind: 'terminal' });
      await api('/active', { tabId: boot.state.activeTabId, paneId: boot.state.activePaneId });
      return { tab: tab.id, first: first.id, second: second.id, original: boot.state.activePaneId };
    });
    const maximize = async () => { await page.keyboard.down('Alt'); await page.keyboard.press('m'); await page.keyboard.up('Alt'); };
    await page.waitForFunction(id => !!document.querySelector(`[data-pane-id="${id}"]`), {}, ids.original);
    await maximize();
    await page.waitForSelector('.pane-grid.is-maximized');
    await page.evaluate(async ({ tab, first }) => {
      const {token} = await (await fetch('/api/panes/bootstrap')).json();
      await fetch('/api/panes/active', {method:'POST',headers:{'Content-Type':'application/json','X-Townmouse-Token':token},body:JSON.stringify({tabId:tab,paneId:first})});
    }, ids);
    await page.waitForFunction(id => !!document.querySelector(`[data-pane-id="${id}"]`), {}, ids.first);
    assert(await page.$eval('.pane-grid', el => !el.classList.contains('is-maximized')));
    assert.equal(await page.$$eval('.pane', nodes => nodes.filter(n => getComputedStyle(n).display !== 'none').length), 2);
    await maximize();
    await page.waitForSelector('.pane-grid.is-maximized');
    await page.evaluate(async id => {
      const {token} = await (await fetch('/api/panes/bootstrap')).json();
      await fetch(`/api/panes/panes/${id}`, {method:'DELETE',headers:{'X-Townmouse-Token':token}});
    }, ids.first);
    await page.waitForFunction(id => !document.querySelector(`[data-pane-id="${id}"]`), {}, ids.first);
    assert(await page.$eval('.pane-grid', el => !el.classList.contains('is-maximized')));
    assert.equal(await page.$$eval('.pane', nodes => nodes.filter(n => getComputedStyle(n).display !== 'none').length), 1);
    console.log('PASS maximize: switching tabs and closing maximized pane leave surviving panes visible');
  } finally {
    await browser?.close();
    app.kill('SIGTERM');
    console.log('Retained isolated test data:', state);
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
