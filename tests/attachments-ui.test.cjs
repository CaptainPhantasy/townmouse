'use strict';

/*
 * P0-2/P0-3/P0-4 regression: the file picker, image paste and drop all produce
 * one server-side attachment and insert its path. A drop outside the terminal
 * must never type file bytes or a data: URI into the PTY.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const puppeteer = require('puppeteer');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.ATTACHMENTS_UI_PORT || 11396);
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

function terminalText(page) {
  return page.evaluate(() => window.__terminalOne.text().replace(/\n/g, ''));
}

async function waitForTerminalText(page, needle, timeout = 15000) {
  await page.waitForFunction(
    (value) => window.__terminalOne.text().replace(/\n/g, '').includes(value),
    { timeout },
    needle
  );
}

async function dispatchFile(page, selector, name, type, eventName) {
  return page.evaluate((sel, fileName, mime, typeName) => {
    const bytes = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);
    const data = new DataTransfer();
    data.items.add(new File([bytes], fileName, { type: mime }));
    const event = typeName === 'paste'
      ? new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true })
      : new DragEvent('drop', { dataTransfer: data, bubbles: true, cancelable: true });
    const target = document.querySelector(sel);
    if (!target) throw new Error(`missing event target ${sel}`);
    return target.dispatchEvent(event);
  }, selector, name, type, eventName);
}

(async () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'townmouse-attachments-ui-'));
  const pickerFile = path.join(stateDir, 'picker-attachment.txt');
  fs.writeFileSync(pickerFile, 'picker attachment\n');
  const app = spawn(process.execPath, [path.join(ROOT, 'src', 'server.js')], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), TOWNMOUSE_STATE_DIR: stateDir },
    stdio: ['ignore', 'ignore', 'pipe']
  });
  let stderr = '';
  app.stderr.on('data', (chunk) => { stderr += chunk; });
  let browser = null;
  let page = null;
  let uploads = 0;
  let pageErrors = [];

  try {
    await waitHealth();
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });
    page = await browser.newPage();
    page.on('pageerror', (error) => pageErrors.push(error.message));
    const paneInputs = [];
    page.on('request', (request) => {
      if (request.method() === 'POST' && request.url().endsWith('/api/attachments')) uploads++;
      if (request.method() === 'POST' && request.url().includes('/api/panes/panes/') && request.url().endsWith('/input')) {
        let parsed = null;
        try { parsed = request.postDataJSON(); } catch (_) { /* not JSON */ }
        paneInputs.push({ raw: request.postData(), parsed });
      }
    });

    await page.setViewport({ width: 393, height: 852, deviceScaleFactor: 1 });
    await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction('window.__terminalOne && window.__terminalOne.dimensions()', { timeout: 15000 });
    await wait(1200);

    const attach = await page.evaluate(() => {
      const button = document.querySelector('#workspace-attach');
      const rect = button && button.getBoundingClientRect();
      return {
        exists: Boolean(button),
        visible: Boolean(button && button.offsetParent !== null && rect.width > 0 && rect.height > 0),
        bottom: rect ? rect.bottom : 0,
        viewport: window.innerHeight
      };
    });
    assert(attach.exists, 'Attach control is missing');
    assert(attach.visible, 'Attach control is not visible at 393x852');
    assert(attach.bottom <= attach.viewport, `Attach control is below the viewport (${attach.bottom})`);

    const fileInputs = await page.$$('input[type=file]');
    const fileInput = fileInputs[fileInputs.length - 1];
    assert(fileInput, 'hidden file input is missing');
    await fileInput.uploadFile(pickerFile);
    await waitForTerminalText(page, 'picker-attachment.txt');
    assert.strictEqual(uploads, 1, `file picker should upload exactly once, saw ${uploads}`);

    const card = await page.evaluate(() => {
      const el = document.querySelector('#attachment-card');
      return el ? {
        hidden: el.hidden,
        text: el.textContent,
        url: el.dataset.url,
        copyUrl: Boolean(el.querySelector('[data-attachment-action="copy-url"]')),
        openUrl: Boolean(el.querySelector('[data-attachment-action="open-url"]'))
      } : null;
    });
    assert(card && !card.hidden, 'attachment card should be visible after upload');
    assert(card.url.includes(`http://127.0.0.1:${PORT}/attachments/`), `attachment card URL is wrong: ${card.url}`);
    assert(card.text.includes('picker-attachment.txt'), 'attachment card should name the file');
    assert(card.text.includes(card.url), 'attachment card should show the URL text');
    assert(card.copyUrl && card.openUrl, 'attachment card needs Copy URL and Open URL actions');

    await dispatchFile(page, '#terminal .xterm-helper-textarea', 'pasted-image.png', 'image/png', 'paste');
    await waitForTerminalText(page, 'pasted-image.png');
    assert.strictEqual(uploads, 2, `image paste should upload exactly once, saw ${uploads}`);

    const beforeOutside = uploads;
    await dispatchFile(page, '.terminal-header', 'outside-drop.png', 'image/png', 'drop');
    await wait(600);
    const textAfterOutside = await terminalText(page);
    assert.strictEqual(uploads, beforeOutside, 'a drop outside the terminal must not upload');
    assert(
      !textAfterOutside.includes('data:image/png;base64'),
      'a drop outside the terminal must never type base64 into the PTY'
    );

    await dispatchFile(page, '#terminal', 'terminal-drop.png', 'image/png', 'drop');
    await waitForTerminalText(page, 'terminal-drop.png');
    assert.strictEqual(uploads, beforeOutside + 1, 'a terminal drop should upload exactly once');

    // The pane workspace has its own capture-phase paste handler. Its terminal
    // is server-backed, so assert the upload and the visible attach notice.
    const beforePanePaste = uploads;
    await page.goto(BASE + '/panes.html', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.pane-terminal .xterm-helper-textarea', { timeout: 20000 });
    await dispatchFile(page, '.pane-terminal .xterm-helper-textarea', 'pasted-pane.png', 'image/png', 'paste');
    await page.waitForFunction(
      () => document.body.textContent.includes('Attached pasted-pane.png'),
      { timeout: 15000 }
    );
    assert.strictEqual(uploads, beforePanePaste + 1, 'pane image paste should upload exactly once');
    const paneNotice = await page.evaluate(() => {
      const el = document.querySelector('#notice');
      return { text: el.textContent, copyUrl: el.dataset.copyUrl || '' };
    });
    assert(paneNotice.text.includes('/attachments/'), `pane notice should expose the attachment URL: ${paneNotice.text}`);
    assert(paneNotice.copyUrl.includes('/attachments/'), 'pane notice should carry a copyable URL');

    const keybar = await page.evaluate(() => {
      const bar = document.querySelector('#pane-keybar');
      const keys = Array.from(document.querySelectorAll('#pane-keybar .pane-key'));
      return {
        hidden: bar.hidden,
        visible: Boolean(bar.offsetParent !== null && bar.getBoundingClientRect().height > 0),
        keys: keys.map((key) => {
          const rect = key.getBoundingClientRect();
          return { label: key.textContent, width: rect.width, height: rect.height };
        })
      };
    });
    assert(!keybar.hidden && keybar.visible, 'pane key bar should be visible at 393x852');
    assert(keybar.keys.length >= 10, `pane key bar is missing keys: ${JSON.stringify(keybar.keys)}`);
    for (const key of keybar.keys) {
      assert(key.width >= 44 && key.height >= 44, `key ${key.label} is below 44x44 (${key.width}x${key.height})`);
    }

    await page.evaluate(() => {
      document.querySelector('#pane-keybar [data-mod="ctrl"]').click();
      document.querySelector('#pane-keybar [data-key="c"]').click();
    });
    let ctrlC = false;
    for (let i = 0; i < 60 && !ctrlC; i++) {
      ctrlC = paneInputs.some((body) => (body && body.parsed && body.parsed.data === '\u0003') ||
        (body && typeof body.raw === 'string' && body.raw.includes('\\u0003')));
      if (!ctrlC) await wait(50);
    }
    assert(ctrlC, `Ctrl+C from the pane key bar did not reach the PTY: ${JSON.stringify(paneInputs)}`);

    // A UI-created terminal must spawn at its measured dimensions, not 100x30.
    const firstPaneId = await page.evaluate(() => {
      const state = window.__panes.state();
      const tab = state.tabs.find((candidate) => candidate.id === state.activeTabId);
      return tab.panes[0].id;
    });
    await page.evaluate(() => document.querySelector('#menu-button').click());
    await page.waitForSelector('#menu-add-terminal', { visible: true, timeout: 5000 });
    await page.evaluate(() => document.querySelector('#menu-add-terminal').click());
    await page.waitForFunction((knownId) => {
      const state = window.__panes.state();
      const tab = state && state.tabs.find((candidate) => candidate.id === state.activeTabId);
      return Boolean(tab && tab.panes.length === 2 && tab.panes.some((pane) => pane.id !== knownId));
    }, { timeout: 20000 }, firstPaneId);
    await page.waitForFunction((knownId) => {
      const state = window.__panes.state();
      const tab = state && state.tabs.find((candidate) => candidate.id === state.activeTabId);
      const pane = tab && tab.panes.find((candidate) => candidate.id !== knownId);
      return Boolean(pane && pane.status === 'running' && pane.cols < 100);
    }, { timeout: 20000 }, firstPaneId);
    const spawned = await page.evaluate((knownId) => {
      const state = window.__panes.state();
      const tab = state.tabs.find((candidate) => candidate.id === state.activeTabId);
      const pane = tab.panes.find((candidate) => candidate.id !== knownId);
      return { pane, dimensions: window.__panes.dimensions(pane.id) };
    }, firstPaneId);
    assert(spawned.dimensions, 'new terminal pane has no client dimensions');
    assert(
      spawned.dimensions.cols === spawned.pane.cols && spawned.dimensions.rows === spawned.pane.rows,
      `PTY and client disagree at spawn: client ${JSON.stringify(spawned.dimensions)} vs PTY ${spawned.pane.cols}x${spawned.pane.rows}`
    );
    assert(spawned.pane.cols < 100, `PTY spawned at the old default width: ${spawned.pane.cols}`);

    // Closing a running pane asks first; Cancel keeps the shell alive.
    await page.evaluate((paneId) => {
      document.querySelector(`[data-pane-id="${paneId}"] .pane-close`).click();
    }, spawned.pane.id);
    await page.waitForFunction('document.querySelector("#close-confirm").open', { timeout: 5000 });
    await page.evaluate(() => document.querySelector('#close-cancel').click());
    await page.waitForFunction('!document.querySelector("#close-confirm").open', { timeout: 5000 });
    const stillOpen = await page.evaluate((paneId) => {
      const state = window.__panes.state();
      return state.tabs.some((tab) => tab.panes.some((pane) => pane.id === paneId));
    }, spawned.pane.id);
    assert(stillOpen, 'Cancel must keep the pane and its shell alive');

    await page.evaluate((paneId) => {
      document.querySelector(`[data-pane-id="${paneId}"] .pane-close`).click();
    }, spawned.pane.id);
    await page.waitForFunction('document.querySelector("#close-confirm").open', { timeout: 5000 });
    await page.evaluate(() => document.querySelector('#close-approve').click());
    await page.waitForFunction((paneId) => {
      const state = window.__panes.state();
      return !state.tabs.some((tab) => tab.panes.some((pane) => pane.id === paneId));
    }, { timeout: 10000 }, spawned.pane.id);

    assert(pageErrors.length === 0, `page errors: ${pageErrors.join(' | ')}`);
    console.log('PASS attachments UI: picker, paste, outside drop ignored, terminal drop');
    console.log('RESULT passed=1 total=1 failures=0');
  } catch (error) {
    console.error('FAIL attachments UI:', error.message);
    console.error('DEBUG uploads', uploads);
    if (page) {
      try {
        console.error('DEBUG text', (await terminalText(page)).slice(-800));
      } catch (_) { /* page gone */ }
      console.error('DEBUG pageErrors', pageErrors);
    }
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
