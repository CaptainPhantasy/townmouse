const { strict: assert } = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');
const puppeteer = require('puppeteer');

const ROOT = path.join(__dirname, '..');
const APP_PORT = Number(process.env.WORKSPACE_PORT || 11357);
const FIXTURE_PORT = APP_PORT + 1;
const BASE = `http://127.0.0.1:${APP_PORT}`;

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
    if (Date.now() - started > timeoutMs) throw new Error('workspace server did not become healthy');
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
}

async function isVisible(page, selector) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
  }, selector);
}

async function clickVisible(page, selectors) {
  for (const selector of selectors) {
    if (await isVisible(page, selector)) {
      await page.click(selector);
      return selector;
    }
  }
  throw new Error('No visible control among: ' + selectors.join(', '));
}

async function openShare(page) {
  if (!(await isVisible(page, '#browser-permissions'))) {
    for (const selector of ['#browser-share-toggle', '#browser-share-bottom']) {
      if (await isVisible(page, selector)) {
        await page.click(selector);
        break;
      }
    }
  }
  await page.waitForFunction(() => {
    const row = document.querySelector('#browser-permissions');
    return row && getComputedStyle(row).display !== 'none';
  });
}

(async () => {
  fs.mkdirSync('evidence', { recursive: true });
  const preview = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'text/html');
    res.end('<!doctype html><title>Local preview</title><style>body{font:22px system-ui;padding:50px;background:#f8fafc}input,button{font:inherit;padding:12px}</style><h1>Local app preview</h1><p>Browser workspace integration test</p><input aria-label="Project name" placeholder="Project name"><button onclick="document.querySelector(\'h1\').textContent=\'Saved: \'+document.querySelector(\'input\').value">Save project</button>');
  }).listen(FIXTURE_PORT, '127.0.0.1');
  const app = spawn(process.execPath, [path.join(ROOT, 'src', 'server.js')], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(APP_PORT) },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let appLog = '';
  app.stdout.on('data', (chunk) => { appLog += chunk; });
  app.stderr.on('data', (chunk) => { appLog += chunk; });
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const results = { retrievedAt: new Date().toISOString(), viewports: [], permissions: [] };
  try {
    await waitForHealth();
    const bootstrap = await (await fetch(BASE + '/api/browser/bootstrap')).json();
    const api = async (route = '', method = 'GET', data, token) => {
      const res = await fetch(BASE + '/api/browser' + route, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: 'Bearer ' + token } : { 'X-Workspace-Key': bootstrap.key })
        },
        ...(data ? { body: JSON.stringify(data) } : {})
      });
      return { status: res.status, body: await res.json() };
    };
    for (const tab of (await api()).body) await api('/' + tab.id, 'DELETE');

    const VIEWPORTS = process.env.WORKSPACE_VIEWPORTS ? JSON.parse(process.env.WORKSPACE_VIEWPORTS) : [[393, 852], [820, 1180], [1440, 900], [1920, 1080]];
    for (const [width, height] of VIEWPORTS) {
      console.log('viewport ' + width + 'x' + height);
      const context = await browser.createBrowserContext();
      const page = await context.newPage();
      await page.setViewport({ width, height, hasTouch: width < 1100, isMobile: width < 700 });
      if (width < 1100) {
        await page.setUserAgent(width < 700
          ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1'
          : 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1');
      }
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto(BASE, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => window.__workspace?.ready);
      await page.waitForFunction(() => document.querySelector('#status').classList.contains('connected'));
      await page.click('#workspace-session-pill');
      await page.waitForFunction(() => document.querySelector('#session-menu')?.open);
      assert(await isVisible(page, '#session-menu-new'), 'session menu should expose New session');
      const firstSession = await page.$eval('#sessionInfo', (el) => el.textContent);
      await page.click('#session-menu-new');
      await page.waitForFunction((previous) => {
        const text = document.querySelector('#sessionInfo').textContent;
        return text && text !== previous;
      }, {}, firstSession);
      await page.waitForFunction(() => document.querySelector('#status').classList.contains('connected'));
      await page.click('#workspace-session-pill');
      await page.waitForFunction(() => document.querySelector('#session-menu')?.open);
      assert((await page.$$eval('#session-menu-list .drawer-row', (rows) => rows.length)) >= 1, 'session menu should list a session');
      await page.click('#session-menu-close');
      assert(await page.$eval('.terminal-header', (el) => el.scrollWidth <= el.clientWidth + 1), 'header should not overflow');
      await page.click('#terminal');
      await page.keyboard.type('printf "WORKSPACE_TERMINAL_OK\\n"\n');
      await page.waitForFunction(() => document.querySelector('#terminal').textContent.includes('WORKSPACE_TERMINAL_OK'));
      await page.click('#workspace-tools');
      assert(await page.$eval('.workspace-drawer', (el) => el.open));
      const filterFocused = await page.evaluate(() => document.activeElement?.id === 'tool-filter');
      if (width < 1100) assert(!filterFocused, 'touch tools should not autofocus the filter');
      else assert(filterFocused, 'desktop tools should focus the filter');
      await page.evaluate(() => Promise.all(document.querySelector('.workspace-drawer').getAnimations().map((animation) => animation.finished)));
      await page.screenshot({ path: `evidence/tools-${width}x${height}.png` });
      const setFilter = (value) => page.evaluate((next) => {
        const input = document.querySelector('#tool-filter');
        input.value = next;
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }, value);
      await setFilter('search');
      assert(await isVisible(page, '#t1toolbar .drawer-row:not([hidden])'));
      await setFilter('close');
      assert(await isVisible(page, '#closeBtn'), 'session search should find Close terminal');
      await setFilter('zzz');
      assert(!(await page.$eval('#tool-empty', (el) => el.hidden)), 'no-match search should show the empty state');
      await setFilter('');
      await page.click('.drawer-font-row .t1button:last-child');
      assert(await page.$eval('.workspace-drawer', (el) => el.open), 'font stepper must not close the drawer');
      await page.click('.drawer-font-row .t1button:first-child');
      await page.evaluate(() => {
        const row = [...document.querySelectorAll('#t1toolbar .drawer-row')].find((button) => button.textContent.includes('Fullscreen'));
        row.classList.add('active');
      });
      await new Promise((resolve) => setTimeout(resolve, 250));
      const activeContrast = await page.evaluate(() => {
        const row = [...document.querySelectorAll('#t1toolbar .drawer-row.active')].find((button) => button.textContent.includes('Fullscreen'));
        const read = (el, pseudo) => getComputedStyle(el, pseudo).color;
        const name = read(row.querySelector('.drawer-row-name'));
        const desc = read(row.querySelector('.drawer-row-copy'), '::after');
        const bg = getComputedStyle(row).backgroundColor;
        const pressed = row.getAttribute('aria-pressed');
        row.classList.remove('active');
        return { name, desc, bg, pressed };
      });
      assert(
        activeContrast.bg === 'rgb(23, 92, 187)' &&
        activeContrast.name === 'rgb(255, 255, 255)' &&
        activeContrast.desc === 'rgb(255, 255, 255)' &&
        activeContrast.pressed === 'true',
        'active tool row must be readable and announced'
      );
      await page.click('#settingsBtn');
      await page.waitForFunction(() => document.querySelector('#settingsModal').classList.contains('open'));
      assert.strictEqual(
        await page.$eval('#settingsModal .settings-panel label', (el) => getComputedStyle(el).textTransform),
        'none',
        'settings labels should use the workspace type system'
      );
      await page.click('#settingsClose');
      await page.waitForFunction(() => !document.querySelector('#settingsModal').classList.contains('open'));

      await page.click('#workspace-browser');
      await page.waitForFunction(() => !document.querySelector('.browser-surface').hidden);
      if (width < 700) {
        assert(await isVisible(page, '#browser-forward'), 'phone should expose forward');
        assert(await isVisible(page, '#browser-reload'), 'phone should expose reload');
      }
      await page.type('#browser-url', `http://127.0.0.1:${FIXTURE_PORT}`);
      await page.click('#browser-address button:last-child');
      await page.waitForFunction(() => document.querySelector('#browser-title').textContent === 'Local preview', { timeout: 12000 }).catch(async (error) => {
        console.log(await page.evaluate(() => ({
          title: document.querySelector('#browser-title').textContent,
          message: document.querySelector('#browser-message').textContent,
          url: document.querySelector('#browser-url').value
        })));
        await page.screenshot({ path: 'evidence/debug.png' });
        throw error;
      });
      if (width >= 700 && width < 1100) {
        assert(await isVisible(page, '#split-handle'), 'tablet should expose the split handle');
        const handleBox = await (await page.$('#split-handle')).boundingBox();
        assert(handleBox.height >= 44, 'split handle must be a 44pt target');
        const before = await page.$eval('.browser-surface', (el) => el.getBoundingClientRect().height);
        const box = await (await page.$('#split-handle')).boundingBox();
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.down();
        await page.mouse.move(box.x + box.width / 2, box.y - 70, { steps: 5 });
        await page.mouse.up();
        await new Promise((resolve) => setTimeout(resolve, 300));
        const after = await page.$eval('.browser-surface', (el) => el.getBoundingClientRect().height);
        assert(after > before + 20, 'dragging the split handle should grow the browser');
        await page.click('#browser-expand');
        await page.waitForFunction(() => document.body.classList.contains('browser-max'));
        assert(await page.$eval('.terminal-container', (el) => getComputedStyle(el).display === 'none'));
        await page.click('#browser-expand');
        await page.waitForFunction(() => !document.body.classList.contains('browser-max'));
      }

      await page.click('#browser-tab');
      await page.type('#browser-type input', 'Human test');
      await page.click('#browser-type button');
      await page.click('#browser-tab');
      await page.click('#browser-enter');

      const tabs = (await api()).body;
      const tab = tabs.filter((candidate) => candidate.kind === 'human').at(-1);
      assert.strictEqual(tab.permission, 'private');
      assert((await api('/' + tab.id + '/content')).body.text.includes('Saved: Human test'));

      await openShare(page);
      await page.select('#browser-share', 'view');
      await page.waitForFunction(() => document.querySelector('#browser-message').textContent.includes('Access changed'));
      const access = (await api('/' + tab.id + '/access')).body;
      assert.strictEqual((await api('/' + tab.id + '/content', 'GET', null, access.token)).status, 200);
      assert.strictEqual((await api('/' + tab.id + '/action', 'POST', { action: 'type', text: 'denied' }, access.token)).status, 403);

      await page.select('#browser-share', 'control');
      await new Promise((resolve) => setTimeout(resolve, 250));
      const control = (await api('/' + tab.id + '/access')).body;
      assert.strictEqual((await api('/' + tab.id + '/content', 'GET', null, access.token)).status, 403);
      await api('/' + tab.id + '/action', 'POST', { action: 'reload' }, control.token);
      await api('/' + tab.id + '/action', 'POST', { action: 'key', key: 'Tab' }, control.token);
      assert.strictEqual((await api('/' + tab.id + '/action', 'POST', { action: 'type', text: 'Workspace' }, control.token)).status, 200);
      await api('/' + tab.id + '/action', 'POST', { action: 'key', key: 'Tab' }, control.token);
      await api('/' + tab.id + '/action', 'POST', { action: 'key', key: 'Enter' }, control.token);
      assert((await api('/' + tab.id + '/content', 'GET', null, control.token)).body.text.includes('Saved: Workspace'));

      await page.select('#browser-share', 'private');
      await new Promise((resolve) => setTimeout(resolve, 250));
      assert.strictEqual((await api('/' + tab.id + '/content', 'GET', null, control.token)).status, 403);
      await page.screenshot({ path: `evidence/workspace-${width}x${height}.png` });
      assert(!(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)));

      await openShare(page);
      await page.click('#browser-read');
      await page.waitForSelector('dialog[open] .browser-reading');
      assert((await page.$eval('.browser-reading', (el) => el.textContent)).includes('Saved: Workspace'));
      await page.click('dialog[aria-label="Browser page text"] button');

      const activeTabSelector = width < 1100 ? '#browser-tablist .browser-tab' : '#browser-tabs .browser-tab';
      const tabCountBefore = await page.$$eval(activeTabSelector, (buttons) => buttons.length);
      await clickVisible(page, ['#new-browser-inline', '#new-browser']);
      await page.waitForFunction(
        (selector, count) => document.querySelectorAll(selector).length > count,
        {},
        activeTabSelector,
        tabCountBefore
      );
      await page.waitForFunction(() => document.querySelector('#browser-title').textContent === 'New tab');
      if (width >= 1100) {
        const labels = await page.$$eval('#browser-tabs .browser-tab-label', (els) => els.map((el) => ({ text: el.textContent.trim(), width: el.getBoundingClientRect().width })));
        assert(labels.length >= 2 && labels.every((label) => label.text && label.width > 0), 'desktop tabs must show titles');
      }
      await clickVisible(page, ['#browser-tablist .browser-tab:first-child', '#browser-tabs .browser-tab:first-child']);

      await page.waitForFunction((port) => document.querySelector('#browser-url').value.includes(port), {}, String(FIXTURE_PORT));

      await page.click('#agent-browser');
      await page.waitForFunction(() => document.querySelector('#browser-title').textContent === 'Agent browser');
      if (width >= 1100) {
        const agentLabels = await page.$$eval('#browser-tabs .browser-tab-label', (els) => els.map((el) => ({ text: el.textContent.trim(), width: el.getBoundingClientRect().width })));
        assert(agentLabels.some((label) => label.text === 'Agent browser' && label.width > 0), 'desktop agent tab must show its title');
      }
      const agent = (await api()).body.find((candidate) => candidate.kind === 'agent');
      const ac = (await api('/' + agent.id + '/access')).body;
      await clickVisible(page, ['#hide-browser-compact', '#hide-browser', '#workspace-terminal']);
      assert.strictEqual((await api('/' + agent.id + '/action', 'POST', { action: 'navigate', url: `http://127.0.0.1:${FIXTURE_PORT}` }, ac.token)).status, 200);
      assert((await api('/' + agent.id + '/content', 'GET', null, ac.token)).body.text.includes('Local app preview'));
      await page.click('#agent-browser');
      await page.waitForFunction((port) => document.querySelector('#browser-url').value.includes(port), {}, String(FIXTURE_PORT));

      await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
      assert.strictEqual(await page.$eval('.browser-surface', (el) => getComputedStyle(el).animationName), 'none');

      if (width >= 1100) {
        await page.click('#workspace-tools');
        await page.waitForFunction(() => document.querySelector('.workspace-drawer').open);
        await page.click('#closeBtn');
        await page.waitForFunction(() => document.querySelector('#close-confirm')?.open);
        await page.click('#close-confirm-cancel');
        assert(await page.$eval('#status', (el) => el.classList.contains('connected')), 'cancel must keep the session');
        await page.click('#workspace-tools');
        await page.waitForFunction(() => document.querySelector('.workspace-drawer').open);
        await page.click('#closeBtn');
        await page.waitForFunction(() => document.querySelector('#close-confirm')?.open);
        await page.click('#close-confirm-close');
        await page.waitForFunction(() => !document.querySelector('#status').classList.contains('connected'));
      }
      results.viewports.push({
        width,
        height,
        terminal: true,
        tools: true,
        browserNavigation: true,
        humanInput: true,
        multipleHumanTabs: true,
        accessiblePageText: true,
        sharingRevocation: true,
        headlessAgent: true,
        reducedMotion: true,
        errors,
        screenshot: `workspace-${width}x${height}.png`
      });
      assert.deepStrictEqual(errors, []);
      await page.close();
      await context.close();
      for (const openTab of (await api()).body) await api('/' + openTab.id, 'DELETE');
    }
    results.permissions = [
      'private default',
      'view permits read only',
      'control permits interaction',
      'grant changes rotate tokens',
      'revocation rejects stale tokens',
      'hidden agent continues navigating'
    ];
    results.passed = true;
    fs.writeFileSync(process.argv[2] || 'evidence/workspace-results.json', JSON.stringify(results, null, 2));
    console.log(JSON.stringify(results, null, 2));
  } catch (error) {
    if (appLog) console.error(appLog);
    throw error;
  } finally {
    await browser.close().catch(() => {});
    preview.close();
    app.kill('SIGTERM');
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
