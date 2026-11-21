'use strict';

/*
 * DESIGN.md hard rule: no menu, sheet, or panel may paint over a live
 * terminal or browser surface. Chrome either docks and reflows the surface,
 * or replaces it as a first-class mode.
 *
 * This check fails if any panel rectangle intersects a live surface rectangle
 * at any supported breakpoint. It also asserts the control-boundary contrast
 * floor and the phone navigation contract (four surfaces, Attach in Tools).
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const puppeteer = require('puppeteer');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.UI_SURFACES_PORT || 11397);
const BASE = `http://127.0.0.1:${PORT}`;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900, isMobile: false, hasTouch: false },
  // The 300px dock leaves only 570px for the terminal+browser split at this
  // width; fixed grid minimums used to clip the browser here.
  { name: 'desktop-narrow', width: 1150, height: 800, isMobile: false, hasTouch: false },
  { name: 'tablet', width: 820, height: 1180, isMobile: true, hasTouch: true },
  { name: 'phone', width: 393, height: 852, isMobile: true, hasTouch: true },
  { name: 'landscape', width: 932, height: 430, isMobile: true, hasTouch: true }
];

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

/* WCAG 2.x relative luminance and contrast. */
function luminance(hex) {
  let value = hex.replace('#', '');
  if (value.length === 3) value = value.split('').map((c) => c + c).join('');
  const channels = [0, 2, 4].map((i) => parseInt(value.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}
function contrast(a, b) {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}
function assertContrast(label, foreground, background, floor) {
  const ratio = contrast(foreground, background);
  assert(ratio >= floor, `${label}: ${foreground} on ${background} is ${ratio.toFixed(2)}:1, below ${floor}:1`);
  return ratio;
}

function readRect(page, selector) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || el.hidden) return null;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
  }, selector);
}

function overlaps(a, b) {
  if (!a || !b) return false;
  const epsilon = 0.5;
  return a.left < b.right - epsilon && a.right > b.left + epsilon &&
    a.top < b.bottom - epsilon && a.bottom > b.top + epsilon;
}

function assertClear(surfaceName, surface, panelName, panel, viewport) {
  assert(surface, `${viewport.name}: live ${surfaceName} surface was not rendered`);
  assert(panel, `${viewport.name}: ${panelName} was not open`);
  assert(!overlaps(surface, panel),
    `${viewport.name}: ${panelName} overlaps the live ${surfaceName} ` +
    `(panel ${JSON.stringify(panel)}, surface ${JSON.stringify(surface)})`);
  assert(panel.right <= viewport.width + 0.5,
    `${viewport.name}: ${panelName} exceeds the viewport width (${panel.right} > ${viewport.width})`);
  assert(panel.bottom <= viewport.height + 0.5,
    `${viewport.name}: ${panelName} exceeds the viewport height (${panel.bottom} > ${viewport.height})`);
}

async function assertDockClear(page, viewport, panelName, panelSelector) {
  const panel = await readRect(page, panelSelector);
  const shell = await readRect(page, '.app-shell');
  let visible = 0;
  for (const surface of ['#terminal', '.browser-canvas']) {
    const rect = await readRect(page, surface);
    if (!rect) continue;
    visible += 1;
    assertClear(surface, rect, panelName, panel, viewport);
    if (shell) {
      assert(rect.left >= shell.left - 0.5 && rect.right <= shell.right + 0.5 &&
        rect.top >= shell.top - 0.5 && rect.bottom <= shell.bottom + 0.5,
        `${viewport.name}: live ${surface} is clipped by .app-shell ` +
        `(surface ${JSON.stringify(rect)}, shell ${JSON.stringify(shell)})`);
    }
  }
  assert(visible > 0, `${viewport.name}: ${panelName} was checked with no live surface visible`);
}

(async () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'townmouse-ui-surfaces-'));
  const app = spawn(process.execPath, [path.join(ROOT, 'src', 'server.js')], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), TOWNMOUSE_STATE_DIR: stateDir },
    stdio: ['ignore', 'ignore', 'pipe']
  });
  let stderr = '';
  const pageErrors = [];
  app.stderr.on('data', (chunk) => { stderr += chunk; });

  let browser = null;
  try {
    await waitHealth();
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });
    const page = await browser.newPage();
    page.on('pageerror', (error) => { pageErrors.push(error.message); });

    for (const viewport of VIEWPORTS) {
      await page.setViewport({
        width: viewport.width,
        height: viewport.height,
        deviceScaleFactor: 1,
        isMobile: viewport.isMobile,
        hasTouch: viewport.hasTouch
      });
      await page.goto(`${BASE}/`, { waitUntil: 'networkidle2' });
      await page.waitForFunction('window.__terminalOne && window.__terminalOne.dimensions()', { timeout: 15000 });
      await wait(600);

      // Token contract, read from the shipped stylesheet.
      const tokens = await page.evaluate(() => {
        const body = getComputedStyle(document.body);
        const root = getComputedStyle(document.documentElement);
        return {
          control: root.getPropertyValue('--ws-control').trim(),
          paper: root.getPropertyValue('--ws-paper').trim(),
          ink: root.getPropertyValue('--ws-ink').trim(),
          muted: root.getPropertyValue('--ws-muted').trim(),
          blue: root.getPropertyValue('--ws-blue').trim()
        };
      });
      for (const [label, fg, bg, floor] of [
        ['control boundary on white', tokens.control, '#ffffff', 3],
        ['control boundary on paper', tokens.control, tokens.paper, 3],
        ['body ink on paper', tokens.ink, tokens.paper, 4.5],
        ['muted text on paper', tokens.muted, tokens.paper, 4.5],
        ['blue action text on paper', tokens.blue, tokens.paper, 4.5]
      ]) {
        assertContrast(`${viewport.name} ${label}`, fg, bg, floor);
      }

      // Sessions dock (the pill lives in the terminal header, so check it
      // before the phone hides that header for the browser-only surface).
      await page.click('#workspace-session-pill');
      await page.waitForFunction('document.querySelector("#session-menu")?.open', { timeout: 5000 });
      await assertDockClear(page, viewport, 'Sessions dock', '#session-menu');
      await page.keyboard.press('Escape');
      await wait(300);

      // Browser open: both live surfaces exist on desktop/tablet; phone shows
      // the browser surface only.
      // A dialog still closing can swallow the click on a loaded runner.
      await page.waitForFunction(() => !document.querySelector('dialog[open]'), { timeout: 8000 });
      await wait(200);
      await page.click('#workspace-browser');
      // Opening the browser creates a Chromium tab; a cold or loaded runner can
      // take many seconds. Wait for the surface instead of assuming a delay.
      await page.waitForFunction(() => {
        const surface = document.querySelector('.browser-surface');
        return surface && !surface.hidden;
      }, { timeout: 30000 });
      await wait(700);

      if (viewport.name === 'desktop') {
        // The desktop browser split turns .app-shell into a grid; in-flow
        // notifications need their own row above the terminal instead of
        // auto-placing below the footer.
        await page.evaluate(() => {
          window.dispatchEvent(new CustomEvent('t1:voice-error', { detail: { code: 'STT_UNAVAILABLE' } }));
        });
        await wait(250);
        const toast = await readRect(page, '#t1toastHost');
        assert(toast, 'desktop browser grid must render the in-flow toast host');
        assert(toast.width > 100 && toast.height > 0 && toast.height < 200,
          `toast host is malformed in the browser grid (${toast.width}x${toast.height})`);
        const terminal = await readRect(page, '#terminal');
        assert(terminal, 'desktop browser grid lost the terminal surface');
        assert(toast.bottom <= terminal.top + 0.5,
          `in-flow toast must sit above the terminal (toast bottom ${toast.bottom}, terminal top ${terminal.top})`);
        const canvas = await readRect(page, '.browser-canvas');
        if (canvas) assert(!overlaps(canvas, toast), 'toast covers the live browser canvas');
        await page.waitForFunction(
          '!document.querySelector("#t1toastHost") || !document.querySelector("#t1toastHost").firstElementChild',
          { timeout: 8000 }
        );
      }

      // Tools dock.
      await page.click('#workspace-tools');
      await page.waitForFunction('document.querySelector("#workspace-drawer")?.open', { timeout: 5000 });
      await assertDockClear(page, viewport, 'Tools dock', '#workspace-drawer');
      const scroll = await page.evaluate(() => ({ w: document.documentElement.scrollWidth, inner: innerWidth }));
      assert(scroll.w <= scroll.inner, `${viewport.name}: Tools dock caused horizontal overflow (${scroll.w} > ${scroll.inner})`);
      // Escape belongs to the live surface, not the non-modal dock.
      await page.evaluate(() => {
        const target = document.querySelector('.browser-canvas') || document.querySelector('.terminal-container');
        target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      });
      await wait(200);
      assert(await page.$eval('#workspace-drawer', (el) => el.open),
        `${viewport.name}: Escape in the terminal closed the Tools dock`);
      await page.focus('#tool-filter').catch(() => {});
      await page.keyboard.press('Escape');
      await wait(300);

      // Close confirmation dock (destructive action, still no overlap).
      await page.click('#workspace-tools');
      await page.waitForFunction('document.querySelector("#workspace-drawer")?.open', { timeout: 5000 });
      await page.click('#closeBtn');
      await page.waitForFunction('document.querySelector("#close-confirm")?.open', { timeout: 5000 });
      await assertDockClear(page, viewport, 'Close confirmation', '#close-confirm');
      await page.click('#close-confirm-cancel');
      await wait(300);

      // Settings dock.
      await page.click('#workspace-tools');
      await page.waitForFunction('document.querySelector("#workspace-drawer")?.open', { timeout: 5000 });
      await page.evaluate(() => document.querySelector('#settingsBtn').click());
      await page.waitForFunction('document.querySelector("#settingsModal")?.classList.contains("open")', { timeout: 5000 });
      await assertDockClear(page, viewport, 'Settings dock', '#settingsModal');

      // One dock, one panel: opening Tools must close Settings rather than
      // stack two panels in the same reserved strip.
      await page.click('#workspace-tools');
      await page.waitForFunction('document.querySelector("#workspace-drawer")?.open', { timeout: 5000 });
      const stacked = await page.evaluate(() => ({
        settingsOpen: document.querySelector('#settingsModal')?.classList.contains('open') || false,
        drawersOpen: document.querySelectorAll('dialog.workspace-drawer[open]').length
      }));
      assert(!stacked.settingsOpen, 'opening Tools must close Settings (one dock at a time)');
      assert.strictEqual(stacked.drawersOpen, 1, `exactly one dock must be open, saw ${stacked.drawersOpen}`);
      await page.keyboard.press('Escape');
      await wait(300);

      // Desktop can trade the labeled menu for a rail; the live surfaces gain
      // the width and nothing overflows.
      if (viewport.name === 'desktop') {
        const navBefore = await readRect(page, '.workspace-nav');
        const canvasBefore = await readRect(page, '.browser-canvas');
        assert(navBefore, `${viewport.name}: navigation was not rendered before collapsing`);
        assert(canvasBefore, `${viewport.name}: browser canvas was not rendered before collapsing`);
        await page.click('#workspace-nav-toggle');
        await wait(500);
        const navAfter = await readRect(page, '.workspace-nav');
        const canvasAfter = await readRect(page, '.browser-canvas');
        assert(navAfter, `${viewport.name}: navigation disappeared after collapsing`);
        assert(canvasAfter, `${viewport.name}: browser canvas disappeared after collapsing`);
        assert(navAfter.width <= 80, `collapsed navigation should be a rail, got ${navAfter.width}px`);
        assert(canvasAfter.width > canvasBefore.width,
          `collapsed navigation should give the browser width (${canvasBefore.width} -> ${canvasAfter.width})`);
        const collapseScroll = await page.evaluate(() => ({ w: document.documentElement.scrollWidth, inner: innerWidth }));
        assert(collapseScroll.w <= collapseScroll.inner, 'collapsed navigation caused horizontal overflow');
        const newTabVisible = await page.evaluate(() => {
          const button = document.querySelector('#new-browser');
          return Boolean(button && button.offsetParent !== null);
        });
        assert(newTabVisible, 'collapsed navigation must keep a New tab control reachable');
        await page.click('#workspace-nav-toggle');
        await wait(500);
      }

      // Phone navigation: four surfaces, Attach and Panes inside Tools.
      if (viewport.name === 'phone') {
        const nav = await page.evaluate(() => [...document.querySelectorAll('.workspace-nav > button, .workspace-nav .nav-bottom > button')]
          .filter((button) => button.offsetParent !== null)
          .map((button) => button.textContent.trim()));
        assert.deepStrictEqual(nav, ['Terminal', 'Browser', 'Agent', 'Tools'],
          `phone navigation must be four surfaces, got ${JSON.stringify(nav)}`);

        await page.click('#workspace-tools');
        await page.waitForFunction('document.querySelector("#workspace-drawer")?.open', { timeout: 5000 });
        const rows = await page.evaluate(() => [...document.querySelectorAll('#workspace-drawer .drawer-row')]
          .filter((row) => row.offsetParent !== null)
          .map((row) => row.getAttribute('aria-label') || row.textContent.trim()));
        assert(rows.some((row) => row.startsWith('Panes.')), 'Panes action must be reachable in the phone Tools dock');
        assert(rows.some((row) => row.startsWith('Attach a file.')), 'Attach action must be reachable in the phone Tools dock');
        await page.keyboard.press('Escape');
        await wait(300);
      }

      // Pane workspace: menu dock must clear the live pane grid.
      await page.goto(`${BASE}/panes.html`, { waitUntil: 'networkidle2' });
      await wait(700);
      await page.click('#menu-button');
      await page.waitForFunction('document.querySelector("#menu-dialog")?.open', { timeout: 5000 });
      const paneSurface = (await readRect(page, '#pane-grid')) || (await readRect(page, '#empty-state'));
      assertClear('pane workspace', paneSurface, 'Panes menu', await readRect(page, '#menu-dialog'), viewport);
      const paneTokens = await page.evaluate(() => {
        const root = getComputedStyle(document.documentElement);
        return {
          surface: root.getPropertyValue('--surface').trim(),
          control: root.getPropertyValue('--line-strong').trim(),
          text: root.getPropertyValue('--text').trim(),
          muted: root.getPropertyValue('--muted').trim()
        };
      });
      assertContrast(`${viewport.name} pane control boundary`, paneTokens.control, paneTokens.surface, 3);
      assertContrast(`${viewport.name} pane text`, paneTokens.text, paneTokens.surface, 4.5);
      assertContrast(`${viewport.name} pane muted text`, paneTokens.muted, paneTokens.surface, 4.5);
      // Escape belongs to the pane (vim/less), not the non-modal menu dock.
      await page.evaluate(() => document.querySelector('.pane-terminal .xterm-helper-textarea')?.focus());
      await page.keyboard.press('Escape');
      await wait(200);
      assert(await page.$eval('#menu-dialog', (el) => el.open),
        `${viewport.name}: Escape in a pane closed the menu dock`);
      await page.click('#menu-dialog [data-close]');
      await wait(300);

      // Visible maximize/restore control: the Alt+M shortcut is an accelerator,
      // not the only way to discover the feature.
      await page.evaluate(() => document.querySelector('.pane-terminal .xterm-helper-textarea')?.focus());
      assert(await page.$('.pane-maximize'), `${viewport.name}: pane has a maximize control`);
      const maximizeBox = await page.$eval('.pane-maximize', (el) => {
        const rect = el.getBoundingClientRect();
        return { width: rect.width, height: rect.height, label: el.getAttribute('aria-label') };
      });
      assert(maximizeBox.width >= 20 && maximizeBox.height >= 20,
        `${viewport.name}: maximize control has a real target (${maximizeBox.width}x${maximizeBox.height})`);
      assert(/maximize/i.test(maximizeBox.label || ''), `${viewport.name}: maximize control is labelled`);
      await page.click('.pane-maximize');
      await page.waitForFunction('document.querySelector("#pane-grid").classList.contains("is-maximized")', { timeout: 3000 });
      assert(await page.$eval('.pane-maximize', (el) => /restore/i.test(el.getAttribute('aria-label') || '')),
        `${viewport.name}: maximize control becomes a restore control`);
      await page.click('.pane-maximize');
      await page.waitForFunction('!document.querySelector("#pane-grid").classList.contains("is-maximized")', { timeout: 3000 });
      await wait(200);

      // Context actions are a docked rail, not a floating menu on a pane.
      await page.evaluate(() => {
        const pane = document.querySelector('.pane-terminal') || document.querySelector('.pane');
        pane.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 120, clientY: 120 }));
      });
      await page.waitForFunction('document.querySelector("#pane-context-menu") && !document.querySelector("#pane-context-menu").hidden', { timeout: 5000 });
      const railGrid = (await readRect(page, '#pane-grid')) || (await readRect(page, '#empty-state'));
      assertClear('pane workspace', railGrid, 'Context action rail', await readRect(page, '#pane-context-menu'), viewport);
      await page.keyboard.press('Escape');
      await wait(300);

      assert.deepStrictEqual(pageErrors, [], `${viewport.name} page errors: ${pageErrors.join(' | ')}`);
      console.log(`PASS ${viewport.name}: live surfaces clear of every panel; controls visible; phone nav four surfaces`);
    }

    console.log('RESULT passed=1 total=1 failures=0');
    process.exitCode = 0;
  } catch (error) {
    console.error(`FAIL ui surfaces: ${error.message}`);
    if (stderr.trim()) console.error(`DEBUG server stderr:\n${stderr.trim().slice(-2000)}`);
    console.log('RESULT passed=0 total=1 failures=1');
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (app.exitCode === null && app.signalCode === null) {
      app.kill('SIGTERM');
      await new Promise((resolve) => {
        const timer = setTimeout(() => {
          try { app.kill('SIGKILL'); } catch (_) { /* already gone */ }
          resolve();
        }, 5000);
        app.once('exit', () => { clearTimeout(timer); resolve(); });
      });
    }
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
})();
