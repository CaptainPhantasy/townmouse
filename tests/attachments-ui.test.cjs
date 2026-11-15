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
    const hostContext = await page.evaluate(() => {
      const state = window.__panes.state();
      const tab = state.tabs.find((candidate) => candidate.id === state.activeTabId);
      return { shown: document.querySelector('#host-name').textContent, title: tab.title };
    });
    assert.strictEqual(hostContext.shown, hostContext.title, 'the bottom bar should name the active tab');

    const paneNotice = await page.evaluate(() => {
      const el = document.querySelector('#notice');
      return { text: el.textContent, copyUrl: el.dataset.copyUrl || '' };
    });
    assert(paneNotice.text.includes('/attachments/'), `pane notice should expose the attachment URL: ${paneNotice.text}`);
    assert(paneNotice.copyUrl.includes('/attachments/'), 'pane notice should carry a copyable URL');

    const targets = await page.evaluate(() => {
      const selectors = ['.pane-close', '.bar-button', '.pane-key'];
      return selectors.flatMap((selector) => Array.from(document.querySelectorAll(selector)))
        .filter((element) => element.offsetParent !== null)
        .map((element) => {
          const rect = element.getBoundingClientRect();
          return { label: element.getAttribute('aria-label') || element.textContent.trim(), width: rect.width, height: rect.height };
        });
    });
    for (const target of targets) {
      assert(
        target.width >= 44 && target.height >= 44,
        `touch target ${target.label} is below 44x44 (${target.width}x${target.height})`
      );
    }

    await wait(1500);
    await page.evaluate(() => {
      const body = document.querySelector('.pane-terminal .pane-body');
      const rect = body.getBoundingClientRect();
      body.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true, cancelable: true, clientX: rect.left + 40, clientY: rect.top + 40
      }));
    });
    await page.waitForFunction('!document.querySelector("#pane-context-menu").hidden', { timeout: 5000 });
    const menuItems = await page.evaluate(() => [...document.querySelectorAll('#pane-context-menu [role="menuitem"]')].map((button) => button.textContent));
    assert(menuItems.includes('Copy selection') && menuItems.includes('Select all'), `context menu is missing actions: ${JSON.stringify(menuItems)}`);
    await page.evaluate(() => document.querySelector('#pane-context-menu [data-context="select-all"]').click());
    const selection = await page.evaluate(() => window.__panes.selection());
    assert(selection.length > 0, 'Select all from the context menu should select terminal text');

    await page.evaluate(() => document.querySelector('#menu-button').click());
    await page.waitForSelector('#menu-reader', { visible: true, timeout: 5000 });
    await page.evaluate(() => document.querySelector('#menu-reader').click());
    await page.waitForFunction('!document.querySelector("#reader-view").hidden', { timeout: 5000 });
    const reader = await page.evaluate(() => {
      const text = document.querySelector('#reader-text');
      const style = getComputedStyle(text);
      return { text: text.textContent, whiteSpace: style.whiteSpace, overflowWrap: style.overflowWrap };
    });
    assert(reader.whiteSpace === 'pre-wrap', `reader should word-wrap (${reader.whiteSpace})`);
    assert(reader.overflowWrap === 'break-word', `reader should break long tokens (${reader.overflowWrap})`);
    assert(reader.text.includes('pasted-pane.png'), `reader transcript should contain the pasted attachment: ${JSON.stringify(reader.text.slice(-400))}`);
    await page.evaluate(() => document.querySelector('#reader-close').click());
    await page.waitForFunction('document.querySelector("#reader-view").hidden', { timeout: 5000 });

    const fontBefore = await page.evaluate(() => window.__panes.fontSize());
    await page.evaluate(() => document.querySelector('#menu-button').click());
    await page.waitForSelector('#menu-font-up', { visible: true, timeout: 5000 });
    await page.evaluate(() => document.querySelector('#menu-font-up').click());
    await page.waitForFunction((size) => window.__panes.fontSize() > size, { timeout: 5000 }, fontBefore);
    const fontAfter = await page.evaluate(() => ({
      size: window.__panes.fontSize(),
      stored: Number(window.localStorage.getItem('townmouse.paneFontSize'))
    }));
    assert.strictEqual(fontAfter.size, fontAfter.stored, 'pane font override should persist and apply');
    await page.evaluate(() => document.querySelector('#menu-dialog [data-close]').click());

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

    // Bare Ctrl+C must still interrupt when text is selected.
    const beforeSelectionCtrlC = paneInputs.length;
    const activePaneId = await page.evaluate(() => {
      const state = window.__panes.state();
      return state.activePaneId;
    });
    await page.evaluate((paneId) => {
      window.__panes.selectAll(paneId);
      const textarea = document.querySelector('.pane-terminal .xterm-helper-textarea');
      textarea.focus();
      textarea.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'c', code: 'KeyC', keyCode: 67, which: 67, ctrlKey: true, bubbles: true, cancelable: true
      }));
    }, activePaneId);
    let selectionCtrlC = false;
    for (let i = 0; i < 60 && !selectionCtrlC; i++) {
      selectionCtrlC = paneInputs.slice(beforeSelectionCtrlC).some((body) =>
        (body && body.parsed && body.parsed.data === '\u0003') ||
        (body && typeof body.raw === 'string' && body.raw.includes('\\u0003')));
      if (!selectionCtrlC) await wait(50);
    }
    assert(selectionCtrlC, `Ctrl+C with a selection did not interrupt: ${JSON.stringify(paneInputs.slice(beforeSelectionCtrlC))}`);

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

    // Menu and tab-sheet controls keep the same 44px contract.
    const measureOpenDialog = async (openSelector, selectors) => {
      await page.evaluate((selector) => document.querySelector(selector).click(), openSelector);
      await page.waitForFunction('document.querySelector("dialog[open]")', { timeout: 5000 });
      const measured = await page.evaluate((list) => list.flatMap((selector) =>
        Array.from(document.querySelectorAll(selector))
      ).filter((element) => element.offsetParent !== null).map((element) => {
        const rect = element.getBoundingClientRect();
        return { label: element.getAttribute('aria-label') || element.textContent.trim(), width: rect.width, height: rect.height };
      }), selectors);
      await page.evaluate(() => {
        document.querySelectorAll('dialog[open] [data-close], dialog[open] .icon-button').forEach((button) => button.click());
      });
      return measured;
    };
    const menuTargets = await measureOpenDialog('#menu-button', ['.menu-item']);
    const tabTargets = await measureOpenDialog('#tabs-button', ['.tab-select', '.tab-close']);
    for (const target of [...menuTargets, ...tabTargets]) {
      assert(
        target.width >= 44 && target.height >= 44,
        `dialog target ${target.label} is below 44x44 (${target.width}x${target.height})`
      );
    }

    // Shortcut help and the Alt chords documented in it.
    await page.evaluate(() => document.querySelector('#menu-button').click());
    await page.waitForSelector('#menu-shortcuts', { visible: true, timeout: 5000 });
    await page.evaluate(() => document.querySelector('#menu-shortcuts').click());
    await page.waitForFunction('document.querySelector("#shortcuts-dialog").open', { timeout: 5000 });
    const shortcutText = await page.evaluate(() => document.querySelector('#shortcuts-dialog').textContent);
    assert(shortcutText.includes('Alt + W') && shortcutText.includes('Alt + M'), 'shortcut help should list the pane chords');
    await page.evaluate(() => document.querySelector('#shortcuts-dialog [data-close]').click());
    await page.waitForFunction('!document.querySelector("#shortcuts-dialog").open', { timeout: 5000 });

    await page.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'm', altKey: true, bubbles: true, cancelable: true })));
    await page.waitForFunction('document.querySelector("#pane-grid").classList.contains("is-maximized")', { timeout: 5000 });
    await page.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'm', altKey: true, bubbles: true, cancelable: true })));
    await page.waitForFunction('!document.querySelector("#pane-grid").classList.contains("is-maximized")', { timeout: 5000 });

    await page.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'w', altKey: true, bubbles: true, cancelable: true })));
    await page.waitForFunction('document.querySelector("#close-confirm").open', { timeout: 5000 });
    await page.evaluate(() => document.querySelector('#close-cancel').click());
    await page.waitForFunction('!document.querySelector("#close-confirm").open', { timeout: 5000 });

    // The active tab stays visible and switchable once a second tab exists.
    const firstTabId = await page.evaluate(() => window.__panes.state().activeTabId);
    await page.evaluate(() => document.querySelector('#menu-button').click());
    await page.waitForSelector('#menu-new-tab', { visible: true, timeout: 5000 });
    await page.evaluate(() => document.querySelector('#menu-new-tab').click());
    await page.waitForFunction('window.__panes.state().tabs.length === 2', { timeout: 10000 });
    const strip = await page.evaluate(() => {
      const bar = document.querySelector('#tabstrip');
      const tabs = Array.from(bar.querySelectorAll('[role="tab"]'));
      return {
        hidden: bar.hidden,
        tabs: tabs.map((tab) => ({ text: tab.textContent, selected: tab.getAttribute('aria-selected') })),
        closeButtons: bar.querySelectorAll('.tabstrip-close').length
      };
    });
    assert(!strip.hidden, 'tab strip should be visible with two tabs');
    assert(strip.tabs.length === 2, `tab strip should expose two tabs: ${JSON.stringify(strip)}`);
    assert(strip.tabs.filter((tab) => tab.selected === 'true').length === 1, 'exactly one tab is selected');
    assert(strip.closeButtons === 2, 'each visible tab needs a close control');
    await page.evaluate(() => {
      const tab = Array.from(document.querySelectorAll('#tabstrip [role="tab"]')).find((button) => button.getAttribute('aria-selected') !== 'true');
      tab.click();
    });
    await page.waitForFunction((tabId) => window.__panes.state().activeTabId === tabId, { timeout: 10000 }, firstTabId);
    const selected = await page.evaluate(() => Array.from(document.querySelectorAll('#tabstrip [role="tab"]'))
      .filter((tab) => tab.getAttribute('aria-selected') === 'true').length);
    assert(selected === 1, 'switching tabs should keep one selected tab');
    const switchedHost = await page.evaluate(() => {
      const state = window.__panes.state();
      const tab = state.tabs.find((candidate) => candidate.id === state.activeTabId);
      return { shown: document.querySelector('#host-name').textContent, title: tab.title };
    });
    assert.strictEqual(switchedHost.shown, switchedHost.title, 'the bottom bar should follow the active tab');

    // Desktop: two panes get a draggable, keyboard-resizable divider.
    await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1, isMobile: false, hasTouch: false });
    await page.evaluate(() => document.querySelector('#menu-button').click());
    await page.waitForSelector('#menu-add-terminal', { visible: true, timeout: 5000 });
    await page.evaluate(() => document.querySelector('#menu-add-terminal').click());
    await page.waitForSelector('.pane-splitter.vertical', { visible: true, timeout: 20000 });
    await page.waitForFunction(() => document.querySelectorAll('.pane-grid > .pane').length === 2, { timeout: 20000 });
    const beforeSplit = await page.evaluate(() => {
      const panes = [...document.querySelectorAll('.pane-grid > .pane')];
      return {
        widths: panes.map((pane) => pane.getBoundingClientRect().width),
        value: Number(document.querySelector('.pane-splitter.vertical').getAttribute('aria-valuenow'))
      };
    });
    const splitBox = await page.evaluate(() => {
      const rect = document.querySelector('.pane-splitter.vertical').getBoundingClientRect();
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    });
    await page.mouse.move(splitBox.x, splitBox.y);
    await page.mouse.down();
    await page.mouse.move(splitBox.x + 200, splitBox.y, { steps: 8 });
    await page.mouse.up();
    await wait(150);
    const afterSplit = await page.evaluate(() => {
      const panes = [...document.querySelectorAll('.pane-grid > .pane')];
      return {
        widths: panes.map((pane) => pane.getBoundingClientRect().width),
        value: Number(document.querySelector('.pane-splitter.vertical').getAttribute('aria-valuenow'))
      };
    });
    assert(afterSplit.widths[0] > beforeSplit.widths[0] + 100, `dragging should widen the first pane: ${JSON.stringify(beforeSplit)} -> ${JSON.stringify(afterSplit)}`);
    assert(afterSplit.value > beforeSplit.value, 'divider aria-valuenow should follow the drag');

    await page.evaluate(() => {
      document.querySelector('.pane-splitter.vertical').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    });
    await wait(150);
    const reset = await page.evaluate(() => Number(document.querySelector('.pane-splitter.vertical').getAttribute('aria-valuenow')));
    assert(reset === 50, `double-click should reset the split (${reset})`);

    await page.focus('.pane-splitter.vertical');
    await page.keyboard.press('ArrowRight');
    await wait(100);
    const keyboardValue = await page.evaluate(() => Number(document.querySelector('.pane-splitter.vertical').getAttribute('aria-valuenow')));
    assert(keyboardValue > reset, 'ArrowRight should move the divider');

    for (const expected of [3, 4]) {
      await page.evaluate(() => document.querySelector('#menu-button').click());
      await page.waitForSelector('#menu-add-terminal', { visible: true, timeout: 5000 });
      await page.evaluate(() => document.querySelector('#menu-add-terminal').click());
      await page.waitForFunction(
        (count) => document.querySelectorAll('.pane-grid > .pane').length === count,
        { timeout: 20000 },
        expected
      );
    }
    const fourPane = await page.evaluate(() => ({
      panes: document.querySelectorAll('.pane-grid > .pane').length,
      splitters: document.querySelectorAll('.pane-splitter').length,
      vertical: document.querySelectorAll('.pane-splitter.vertical').length,
      horizontal: document.querySelectorAll('.pane-splitter.horizontal').length
    }));
    assert(fourPane.panes === 4, `four-pane tab should hold four panes: ${JSON.stringify(fourPane)}`);
    assert(fourPane.splitters === 3 && fourPane.vertical === 2 && fourPane.horizontal === 1,
      `four panes need two column dividers and one row divider: ${JSON.stringify(fourPane)}`);

    const orderBefore = await page.evaluate(() => {
      const state = window.__panes.state();
      const tab = state.tabs.find((candidate) => candidate.id === state.activeTabId);
      return { ids: tab.panes.map((pane) => pane.id), activeIndex: tab.panes.findIndex((pane) => pane.id === state.activePaneId) };
    });
    const reorderKey = orderBefore.activeIndex > 0 ? 'ArrowLeft' : 'ArrowRight';
    await page.evaluate((key) => document.dispatchEvent(new KeyboardEvent('keydown', {
      key, altKey: true, shiftKey: true, bubbles: true, cancelable: true
    })), reorderKey);
    await page.waitForFunction((before) => {
      const state = window.__panes.state();
      const tab = state.tabs.find((candidate) => candidate.id === state.activeTabId);
      return tab.panes.map((pane) => pane.id).join(',') !== before.join(',');
    }, { timeout: 10000 }, orderBefore.ids);
    const orderAfter = await page.evaluate(() => {
      const state = window.__panes.state();
      return {
        panes: state.tabs.find((tab) => tab.id === state.activeTabId).panes.map((pane) => pane.id),
        dom: [...document.querySelectorAll('.pane-grid > .pane')].map((pane) => pane.dataset.paneId)
      };
    });
    assert.deepStrictEqual(orderAfter.dom, orderAfter.panes, 'DOM order should follow the reordered state');

    await page.setViewport({ width: 393, height: 852, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
    await page.waitForFunction('document.querySelectorAll(".pane-splitter").length === 0', { timeout: 5000 });

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
