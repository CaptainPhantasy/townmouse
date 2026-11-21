'use strict';

/*
 * End-to-end checks for the agent control surface described in
 * docs/plans/townmouse-orchestrator-assessment-2026-11-20.md.
 *
 * These are journeys, not unit tests: a real server, a real Chromium, a real
 * PTY, and fixture pages that include a scrollable panel, a cross-origin
 * iframe, an open shadow root, and a delayed element.
 *
 * Run with:
 *   /usr/local/bin/node tests/agent-control.test.cjs   (Node 22)
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn, execFileSync } = require('child_process');
const os = require('os');

const ROOT = path.resolve(__dirname, '..');
const APP_PORT = 11481;
const FIXTURE_PORT = 11482;
const FRAME_PORT = 11483;
const BASE = `http://127.0.0.1:${APP_PORT}`;
const TOKEN_HEADER = 'X-Townmouse-Token';

const results = [];
let token = '';
let appLog = '';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function summarize(value, max = 1600) {
  if (value === undefined) return 'undefined';
  let text;
  try {
    text = JSON.stringify(value, (key, val) => {
      if (typeof val === 'string' && val.length > 300) return `${val.slice(0, 120)}...<${val.length} chars>`;
      return val;
    });
  } catch (_) { text = String(value); }
  if (text === undefined) text = String(value);
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

function fail(message, detail) {
  throw new Error(detail === undefined ? message : `${message} | response body: ${summarize(detail)}`);
}

function ensure(condition, message, detail) {
  if (!condition) fail(message, detail);
}

async function api(route, method = 'GET', body) {
  const response = await fetch(BASE + '/api/panes' + route, {
    method,
    headers: {
      'Content-Type': 'application/json',
      [TOKEN_HEADER]: token
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch (_) { data = text; }
  return { status: response.status, ok: response.ok, data };
}

async function json(route, method = 'GET', body) {
  const response = await api(route, method, body);
  if (!response.ok) fail(`${method} ${route} failed`, response.data);
  return response.data;
}

let ownerCookie = '';
async function getOwnerCookie() {
  if (ownerCookie) return ownerCookie;
  const page = await fetch(`${BASE}/panes.html`, { headers: { Accept: 'text/html' } });
  const cookies = typeof page.headers.getSetCookie === 'function'
    ? page.headers.getSetCookie()
    : [page.headers.get('set-cookie')];
  const line = (cookies || []).filter(Boolean).find((value) => value.startsWith('townmouse_owner='));
  if (!line) throw new Error('owner page did not set the owner cookie');
  ownerCookie = line.split(';')[0];
  return ownerCookie;
}

async function ownerJson(route) {
  const response = await fetch(BASE + route, { headers: { Cookie: await getOwnerCookie() } });
  const data = await response.json().catch(() => null);
  if (!response.ok) fail(`owner GET ${route} failed`, data);
  return data;
}

async function health() {
  return new Promise((resolve, reject) => {
    const request = http.get(`${BASE}/health`, (response) => {
      response.resume();
      response.on('end', () => resolve(response.statusCode));
    });
    request.on('error', reject);
    request.setTimeout(2000, () => request.destroy(new Error('timeout')));
  });
}

async function waitForHealth(timeoutMs = 20000) {
  const started = Date.now();
  for (;;) {
    try { if (await health() === 200) return; } catch (_) { /* starting */ }
    if (Date.now() - started > timeoutMs) throw new Error('server did not become healthy');
    await sleep(150);
  }
}

const MAIN_PAGE = `<!doctype html>
<html><head><meta charset="utf-8"><title>Control Fixture</title>
<style>
  body { font: 18px system-ui; margin: 0; padding: 20px; }
  #list { height: 120px; overflow-y: auto; border: 1px solid #ccc; }
  #list .row { height: 40px; }
  .spacer { height: 1400px; }
  #log { white-space: pre-wrap; }
</style></head>
<body>
  <h1 id="heading">Control fixture</h1>
  <button id="expand">Expand layout</button>
  <label>Project name <input id="name" aria-label="Project name" placeholder="Project name" value="old text"></label>
  <div id="note" contenteditable="true" aria-label="Note field" style="border:1px solid #ccc;min-height:24px">old note</div>
  <input type="password" aria-label="Password" value="hunter2">
  <button id="save">Save project</button>
  <select id="color" aria-label="Colour"><option value="red">Red</option><option value="blue">Blue</option></select>
  <input id="when" type="date" aria-label="Due date">
  <div id="hover-target" role="button" tabindex="0" aria-label="Hover me" style="width:120px;height:40px;background:#eee">Hover me</div>
  <div id="drag-from" role="button" tabindex="0" aria-label="Drag me" draggable="true" style="width:80px;height:40px;background:#cde">Drag me</div>
  <div id="drop-zone" role="button" tabindex="0" aria-label="Drop here" style="width:120px;height:40px;background:#edc">Drop here</div>
  <div id="list" role="list" aria-label="Results list">
    <div class="row">row 0</div><div class="row">row 1</div><div class="row">row 2</div>
    <div class="row">row 3</div><div class="row">row 4</div><div class="row">row 5</div>
    <div class="row">row 6</div><div class="row">row 7</div><div class="row">row 8</div>
    <div class="row">row 9</div>
  </div>
  <div id="later-host"></div>
  <iframe id="nested" title="Nested frame" src="http://127.0.0.1:${FRAME_PORT}/frame" width="320" height="120" style="border:1px solid #888"></iframe>
  <host-element id="shadow-host"></host-element>
  <a id="next" href="/next">Next page</a>
  <div class="spacer"></div>
  <pre id="log"></pre>
  <script>
    const log = (entry) => {
      const el = document.getElementById('log');
      el.textContent = (el.textContent ? el.textContent + '\\n' : '') + entry;
    };
    document.getElementById('expand').addEventListener('click', () => {
      const box = document.createElement('div');
      box.style.height = '300px';
      document.body.insertBefore(box, document.body.firstChild);
      log('expanded');
    });
    document.getElementById('save').addEventListener('click', () => {
      document.getElementById('heading').textContent = 'Saved: ' + document.getElementById('name').value;
    });
    document.addEventListener('keydown', (event) => {
      if (event.altKey && event.key.toLowerCase() === 'm') log('alt+m');
      if (event.ctrlKey && event.shiftKey && event.key === 'K') log('ctrl+shift+k');
    });
    document.getElementById('hover-target').addEventListener('mouseover', () => log('hovered'));
    const from = document.getElementById('drag-from');
    from.addEventListener('dragstart', (event) => { event.dataTransfer.setData('text/plain', 'payload'); log('dragstart'); });
    const zone = document.getElementById('drop-zone');
    zone.addEventListener('dragover', (event) => event.preventDefault());
    zone.addEventListener('drop', (event) => { event.preventDefault(); log('dropped:' + event.dataTransfer.getData('text/plain')); });
    setTimeout(() => {
      const el = document.createElement('p');
      el.id = 'later';
      el.textContent = 'Appeared later';
      document.getElementById('later-host').appendChild(el);
    }, 500);
    class HostElement extends HTMLElement {
      constructor() {
        super();
        const root = this.attachShadow({ mode: 'open' });
        root.innerHTML = '<button id="shadow-button">Shadow submit</button>';
        root.getElementById('shadow-button').addEventListener('click', () => log('shadow-clicked'));
      }
    }
    customElements.define('host-element', HostElement);
  </script>
</body></html>`;

const NEXT_PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>Second page</title></head>
<body><h1 id="heading">Second page heading</h1></body></html>`;

const FRAME_PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>Nested</title></head>
<body style="font:14px system-ui"><button id="frame-button">Inside frame</button>
<script>document.getElementById('frame-button').addEventListener('click', () => { document.body.dataset.clicked = 'yes'; });</script>
</body></html>`;

function startApp() {
  const app = spawn(process.execPath, [path.join(ROOT, 'src', 'server.js')], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(APP_PORT), TOWNMOUSE_STATE_DIR: fs.mkdtempSync(path.join('/tmp', 'tm-agent-')) },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  app.stdout.on('data', (chunk) => { appLog += chunk; });
  app.stderr.on('data', (chunk) => { appLog += chunk; });
  return app;
}

function startFixture(port, handler) {
  return http.createServer((req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    handler(req, res);
  }).listen(port, '127.0.0.1');
}

async function run(title, fn) {
  try {
    await fn();
    results.push({ title, ok: true });
    console.log(`PASS ${title}`);
  } catch (error) {
    results.push({ title, ok: false, error: error.message });
    console.log(`FAIL ${title}\n     ${error.message}`);
  }
}

function byRole(elements, role, name) {
  return elements.find((element) => element.role === role && (!name || element.name.includes(name)));
}

(async () => {
  const app = startApp();
  const mainFixture = startFixture(FIXTURE_PORT, (req, res) => {
    if (req.url === '/next') { res.end(NEXT_PAGE); return; }
    res.end(MAIN_PAGE);
  });
  const frameFixture = startFixture(FRAME_PORT, (req, res) => res.end(FRAME_PAGE));

  let tabId = null;
  let browserPaneId = null;
  let browserPaneId2 = null;
  let terminalPaneId = null;
  let terminalPaneId2 = null;

  try {
    await waitForHealth();
    const bootstrap = await ownerJson('/api/panes/bootstrap');
    token = bootstrap.token;

    const before = await json('/state');
    ensure(before.tabs.length === 1, 'bootstrap seeds exactly one tab', before.tabs);

    // ── 1. Instruction sheet ───────────────────────────────────────────────
    await run('guide: returns tools, permissions, and the native CLI status', async () => {
      const guide = await json('/guide');
      ensure(Array.isArray(guide.tools) && guide.tools.length > 10, 'guide lists tools', guide);
      ensure(guide.tools.some((tool) => tool.name === 'browser.observe'), 'guide names browser.observe', guide.tools);
      ensure(guide.text.includes('NOT ALLOWED'), 'guide states denied capabilities', guide.text.slice(0, 400));
      ensure(guide.capabilities.some((capability) => capability.id === 'browser.sharing' && capability.granted === false),
        'sharing is explicitly not granted', guide.capabilities);
      ensure(typeof guide.cli.available === 'boolean', 'guide reports CLI availability');
      ensure(!guide.text.includes(token), 'guide never contains the token');
    });

    await run('guide: requires the workspace token', async () => {
      const response = await fetch(BASE + '/api/panes/guide');
      ensure(response.status === 403, 'guide without token is refused', response.status);
    });

    // ── Setup: a tab with one browser and one terminal pane ────────────────
    await run('setup: a background tab with two browsers and two terminals', async () => {
      const tab = await json('/tabs', 'POST', { title: 'Control tests', createdBy: 'agent' });
      tabId = tab.id;
      const browser = await json(`/tabs/${tabId}/panes`, 'POST', {
        kind: 'browser', url: `http://127.0.0.1:${FIXTURE_PORT}/`, createdBy: 'agent'
      });
      browserPaneId = browser.id;
      const terminal = await json(`/tabs/${tabId}/panes`, 'POST', { kind: 'terminal', createdBy: 'agent' });
      terminalPaneId = terminal.id;
      const browser2 = await json(`/tabs/${tabId}/panes`, 'POST', {
        kind: 'browser', url: `http://127.0.0.1:${FIXTURE_PORT}/`, createdBy: 'agent'
      });
      browserPaneId2 = browser2.id;
      const terminal2 = await json(`/tabs/${tabId}/panes`, 'POST', { kind: 'terminal', createdBy: 'agent' });
      terminalPaneId2 = terminal2.id;
      await sleep(900);
      const state = await json('/state');
      ensure(state.activeTabId !== tabId, 'an agent tab stays in the background', { activeTabId: state.activeTabId });
      const tabState = state.tabs.find((item) => item.id === tabId);
      ensure(tabState.panes.length === 4, 'the tab holds four panes', tabState.panes);
      const browserPane = tabState.panes.find((pane) => pane.id === browserPaneId);
      ensure(browserPane.status === 'running', 'browser pane reports program status', browserPane);
      ensure(browserPane.program && browserPane.program.status === 'running', 'program status is separate', browserPane.program);
      ensure(browserPane.agent && browserPane.agent.state === null, 'no agent status is invented', browserPane.agent);
    });

    await run('focus: background agent work does not activate the tab or pane', async () => {
      const state = await json('/state');
      const tabState = state.tabs.find((item) => item.id === tabId);
      ensure(state.activeTabId !== tabId, 'the agent tab is not active', state.activeTabId);
      ensure(!tabState.panes.some((pane) => pane.active), 'none of the agent panes is active', tabState.panes.map((pane) => pane.active));
    });

    await run('two browsers: both operate while a terminal job is still running', async () => {
      const slow = await json(`/panes/${terminalPaneId2}/jobs`, 'POST', { command: 'sleep 2; printf finished', wait: false });
      ensure(slow.status === 'running', 'a terminal job is running concurrently', slow);
      const catalogued = await json(`/panes/${browserPaneId2}/browser/elements`);
      const save2 = byRole(catalogued.elements, 'button', 'Save project');
      ensure(save2, 'second browser is catalogued', catalogued.elements.map((element) => element.name));
      const clicked = await api(`/panes/${browserPaneId2}/browser/action`, 'POST', { action: 'click', ref: save2.ref });
      ensure(clicked.ok, 'second browser click completed', clicked.data);
      const first = await json(`/panes/${browserPaneId}/browser/observe`);
      ensure(first.observation && first.observation.id > 0, 'first browser still observably works', first.observation);
      let final = await json(`/panes/${terminalPaneId2}/jobs/${slow.id}`);
      for (let attempt = 0; attempt < 40 && final.status === 'running'; attempt++) {
        await sleep(100);
        final = await json(`/panes/${terminalPaneId2}/jobs/${slow.id}`);
      }
      ensure(final.status === 'completed' && final.stdout.includes('finished'), 'the terminal job completed meanwhile', final);
    });

    await run('interrupt: Ctrl+C stops a program without breaking the terminal', async () => {
      await json(`/panes/${terminalPaneId2}/command`, 'POST', { command: 'sleep 30', waitMs: 250 });
      const interrupted = await json(`/panes/${terminalPaneId2}/keys`, 'POST', { keys: ['ctrl+c'] });
      ensure(interrupted.ok, 'Ctrl+C accepted', interrupted);
      await json(`/panes/${terminalPaneId2}/command`, 'POST', { command: 'printf "alive-\\n"', waitMs: 350 });
      const waited = await json(`/panes/${terminalPaneId2}/wait?match=alive-&timeout=5000&since=0`);
      ensure(waited.matched === true, 'the terminal still runs afterwards', waited);
    });

    // ── 2/3. Element identity, frames, shadow roots ────────────────────────
    let nameRef = null;
    let saveRef = null;
    let observation = null;

    await run('elements: catalogues by role and name across frames and shadow roots', async () => {
      const catalogued = await json(`/panes/${browserPaneId}/browser/elements?max=200`);
      ensure(catalogued.observation && Number.isFinite(catalogued.observation.id), 'catalog creates an observation', catalogued.observation);
      observation = catalogued.observation;
      const input = byRole(catalogued.elements, 'textbox', 'Project name');
      ensure(input, 'finds the named textbox', catalogued.elements.map((element) => `${element.role}:${element.name}`));
      ensure(input.value === 'old text', 'reports the current value', input);
      nameRef = input.ref;
      const save = byRole(catalogued.elements, 'button', 'Save project');
      ensure(save, 'finds the save button', catalogued.elements.map((element) => `${element.role}:${element.name}`));
      saveRef = save.ref;
      const frameButton = byRole(catalogued.elements, 'button', 'Inside frame');
      ensure(frameButton && frameButton.inFrame, 'finds the cross-origin frame button', catalogued.elements.map((element) => `${element.name}:${element.frame}`));
      const shadowButton = byRole(catalogued.elements, 'button', 'Shadow submit');
      ensure(shadowButton, 'finds the button inside the open shadow root', catalogued.elements.map((element) => element.name));
      ensure(typeof catalogued.frameCount === 'number' && catalogued.frameCount >= 2, 'reports the frame count', catalogued.frameCount);
    });

    await run('click: acts by ref, not by guessed coordinates', async () => {
      const click = await api(`/panes/${browserPaneId}/browser/action`, 'POST', { action: 'click', ref: saveRef });
      ensure(click.ok, 'click succeeds', click.data);
      ensure(click.data.action.status === 'completed', 'click reports completed', click.data.action);
      const content = await json(`/panes/${browserPaneId}/browser/content`);
      ensure(content.text.includes('Saved: old text'), 'the page reacted to the click', content.text.slice(0, 200));
    });

    await run('click: works inside a cross-origin iframe', async () => {
      await json(`/panes/${browserPaneId}/browser/action`, 'POST', { action: 'navigate', url: `http://127.0.0.1:${FIXTURE_PORT}/` });
      await sleep(300);
      const catalogued = await json(`/panes/${browserPaneId}/browser/elements`);
      const frameButton = byRole(catalogued.elements, 'button', 'Inside frame');
      ensure(frameButton, 'the frame button is catalogued again', catalogued.elements.map((element) => element.name));
      const click = await api(`/panes/${browserPaneId}/browser/action`, 'POST', { action: 'click', ref: frameButton.ref });
      ensure(click.ok && click.data.action.status === 'completed', 'frame click completed', click.data);
    });

    await run('click: works inside an open shadow root', async () => {
      const catalogued = await json(`/panes/${browserPaneId}/browser/elements`);
      const shadowButton = byRole(catalogued.elements, 'button', 'Shadow submit');
      ensure(shadowButton, 'shadow button catalogued', catalogued.elements.map((element) => element.name));
      const click = await api(`/panes/${browserPaneId}/browser/action`, 'POST', { action: 'click', ref: shadowButton.ref });
      ensure(click.ok && click.data.action.status === 'completed', 'shadow click completed', click.data);
      await sleep(150);
      const content = await json(`/panes/${browserPaneId}/browser/content`);
      ensure(content.text.includes('shadow-clicked'), 'shadow handler ran', content.text);
    });

    // ── 4. Observation labels ──────────────────────────────────────────────
    await run('observe: returns a labelled observation with a fresh image', async () => {
      const observed = await json(`/panes/${browserPaneId}/browser/observe?elements=1&max=80`);
      ensure(observed.image && observed.image.length > 100, 'observe returns an image');
      const label = observed.observation;
      ensure(label && label.id > 0, 'observation has an id', label);
      ensure(label.capturedAt && !Number.isNaN(Date.parse(label.capturedAt)), 'observation has a capture time', label);
      ensure(label.width > 0 && label.height > 0, 'observation has the viewport size', label);
      ensure(typeof label.scrollY === 'number', 'observation has the scroll offset', label);
      ensure(label.url.startsWith(`http://127.0.0.1:${FIXTURE_PORT}`), 'observation has the address', label);
      ensure(label.title === 'Control Fixture', 'observation has the page title', label);
      ensure(Array.isArray(observed.elements) && observed.elements.length > 0, 'observe can include controls', observed);
      observation = label;
    });

    // ── 5. Stale rejection ─────────────────────────────────────────────────
    await run('stale: a coordinate from a changed page is refused', async () => {
      const observed = await json(`/panes/${browserPaneId}/browser/observe`);
      const oldObservation = observed.observation.id;
      const expand = (await json(`/panes/${browserPaneId}/browser/elements`)).elements.find((element) => element.name.includes('Expand layout'));
      ensure(expand, 'expand control catalogued');
      // Inserting a tall block at the top moves every element down, so the old
      // coordinates no longer point at what was observed.
      await json(`/panes/${browserPaneId}/browser/action`, 'POST', { action: 'click', ref: expand.ref });
      await sleep(200);
      const refused = await api(`/panes/${browserPaneId}/browser/action`, 'POST', {
        action: 'click', x: 40, y: 120, observationId: oldObservation
      });
      ensure(refused.status === 409, 'stale coordinate refused with 409', { status: refused.status, body: refused.data });
      ensure(refused.data && refused.data.status === 'stale', 'refusal names the stale status', refused.data);
      ensure(/look again/i.test(refused.data.message || ''), 'refusal tells the agent to look again', refused.data.message);
    });

    await run('stale: a fresh observation is accepted', async () => {
      const observed = await json(`/panes/${browserPaneId}/browser/observe`);
      const fresh = observed.observation.id;
      const save = (await json(`/panes/${browserPaneId}/browser/elements`)).elements.find((element) => element.name.includes('Save project'));
      const accepted = await api(`/panes/${browserPaneId}/browser/action`, 'POST', {
        action: 'click', x: Math.round(save.box.x + save.box.width / 2), y: Math.round(save.box.y + save.box.height / 2), observationId: fresh
      });
      ensure(accepted.status === 200, 'fresh coordinate accepted', { status: accepted.status, body: accepted.data });
      ensure(accepted.data.action.status === 'completed', 'action completed', accepted.data.action);
    });

    // ── 6/8. Action results, typing, replace, modifiers, hover, drag ───────
    await run('type: --replace replaces the whole value instead of appending', async () => {
      await json(`/panes/${browserPaneId}/browser/action`, 'POST', { action: 'navigate', url: `http://127.0.0.1:${FIXTURE_PORT}/` });
      await sleep(300);
      const catalogued = await json(`/panes/${browserPaneId}/browser/elements`);
      const input = byRole(catalogued.elements, 'textbox', 'Project name');
      const typed = await api(`/panes/${browserPaneId}/browser/action`, 'POST', {
        action: 'type', ref: input.ref, text: 'café 東京', replace: true
      });
      ensure(typed.ok, 'typing succeeds', typed.data);
      ensure(typed.data.action.control && typed.data.action.control.value === 'café 東京',
        'the field holds exactly the replaced text', typed.data.action.control);
      const reread = await json(`/panes/${browserPaneId}/browser/elements`);
      const inputAgain = byRole(reread.elements, 'textbox', 'Project name');
      ensure(inputAgain.value === 'café 東京', 'unicode survives the round trip', inputAgain);
    });

    await run('type: a button is the wrong kind of control', async () => {
      const catalogued = await json(`/panes/${browserPaneId}/browser/elements`);
      const save = byRole(catalogued.elements, 'button', 'Save project');
      const typed = await api(`/panes/${browserPaneId}/browser/action`, 'POST', { action: 'type', ref: save.ref, text: 'nope' });
      ensure(typed.status === 400, 'wrong kind is refused', { status: typed.status, body: typed.data });
      ensure(typed.data.action.status === 'wrong-kind', 'status names wrong-kind', typed.data.action);
    });

    await run('key: modifier combinations reach the page', async () => {
      const altM = await api(`/panes/${browserPaneId}/browser/action`, 'POST', { action: 'key', key: 'Alt+M' });
      ensure(altM.ok, 'Alt+M accepted', altM.data);
      const combo = await api(`/panes/${browserPaneId}/browser/action`, 'POST', { action: 'key', key: 'Control+Shift+K' });
      ensure(combo.ok, 'Control+Shift+K accepted', combo.data);
      await sleep(150);
      const content = await json(`/panes/${browserPaneId}/browser/content`);
      ensure(content.text.includes('alt+m'), 'page saw Alt+M', content.text);
      ensure(content.text.includes('ctrl+shift+k'), 'page saw Control+Shift+K', content.text);
    });

    await run('hover: moves the pointer without clicking', async () => {
      const catalogued = await json(`/panes/${browserPaneId}/browser/elements`);
      const target = byRole(catalogued.elements, 'button', 'Hover me');
      ensure(target, 'hover target catalogued', catalogued.elements.map((element) => element.name).slice(0, 30));
      const hovered = await api(`/panes/${browserPaneId}/browser/action`, 'POST', { action: 'hover', ref: target.ref });
      ensure(hovered.ok, 'hover completed', hovered.data);
      await sleep(120);
      const content = await json(`/panes/${browserPaneId}/browser/content`);
      ensure(content.text.includes('hovered'), 'page saw the hover', content.text);
    });

    await run('drag: drags from one element to another', async () => {
      const catalogued = await json(`/panes/${browserPaneId}/browser/elements`);
      const from = byRole(catalogued.elements, 'button', 'Drag me');
      const to = byRole(catalogued.elements, 'button', 'Drop here');
      ensure(from && to, 'drag targets catalogued', catalogued.elements.map((element) => element.name));
      const dragged = await api(`/panes/${browserPaneId}/browser/action`, 'POST', {
        action: 'drag', fromRef: from.ref, toRef: to.ref
      });
      ensure(dragged.ok, 'drag completed', dragged.data);
      await sleep(150);
      const content = await json(`/panes/${browserPaneId}/browser/content`);
      ensure(content.text.includes('dropped:payload') || content.text.includes('dragstart'), 'page saw the drag', content.text);
    });

    // ── 9. Scroll a specific panel ─────────────────────────────────────────
    await run('scroll: scrolls the named panel and leaves the page where it was', async () => {
      const catalogued = await json(`/panes/${browserPaneId}/browser/elements`);
      const list = byRole(catalogued.elements, 'list', 'Results list');
      ensure(list, 'the results list is catalogued', catalogued.elements.map((element) => element.name));
      const before = await json(`/panes/${browserPaneId}/browser/observe`);
      const scrolled = await api(`/panes/${browserPaneId}/browser/action`, 'POST', { action: 'scroll', ref: list.ref, dy: 60 });
      ensure(scrolled.ok, 'scroll completed', scrolled.data);
      ensure(scrolled.data.action.target && scrolled.data.action.target.moved === true, 'the panel actually moved', scrolled.data.action.target);
      const after = await json(`/panes/${browserPaneId}/browser/observe`);
      ensure(Math.abs(after.observation.scrollY - before.observation.scrollY) < 5,
        'the outer page did not scroll', { before: before.observation.scrollY, after: after.observation.scrollY });
    });

    // ── 10. Fixed-size mode ────────────────────────────────────────────────
    await run('sizing: a locked browser ignores viewer resizes', async () => {
      const fixed = await json(`/panes/${browserPaneId}/browser/sizing`, 'POST', { mode: 'fixed', width: 900, height: 640 });
      ensure(fixed.sizing === 'fixed' && fixed.width === 900 && fixed.height === 640, 'browser locks at the chosen size', fixed);
      const ignored = await json(`/panes/${browserPaneId}/resize`, 'POST', { width: 400, height: 300 });
      ensure(ignored.ignored === true, 'a viewer resize is ignored while locked', ignored);
      ensure(ignored.width === 900 && ignored.height === 640, 'the page keeps its locked size', ignored);
      const observed = await json(`/panes/${browserPaneId}/browser/observe`);
      ensure(observed.observation.width === 900 && observed.observation.height === 640,
        'the observation reports the locked size', observed.observation);
      const fitted = await json(`/panes/${browserPaneId}/browser/sizing`, 'POST', { mode: 'fit' });
      ensure(fitted.sizing === 'fit', 'fit mode can be restored', fitted);
    });

    // ── 7. Wait with a timeout ─────────────────────────────────────────────
    await run('wait: resolves when the expected text appears', async () => {
      await json(`/panes/${browserPaneId}/browser/action`, 'POST', { action: 'navigate', url: `http://127.0.0.1:${FIXTURE_PORT}/` });
      const waited = await json(`/panes/${browserPaneId}/browser/wait`, 'POST', { text: 'Appeared later', timeout: 5000 });
      ensure(waited.matched === true, 'wait matched the text', waited);
      ensure(waited.reason === 'text', 'wait names its reason', waited);
    });

    await run('wait: returns a clear timeout instead of hanging', async () => {
      const started = Date.now();
      const waited = await json(`/panes/${browserPaneId}/browser/wait`, 'POST', { text: 'never appears here', timeout: 400 });
      ensure(waited.matched === false, 'timeout is reported, not matched', waited);
      ensure(waited.reason === 'timeout', 'timeout reason is explicit', waited);
      ensure(Date.now() - started < 4000, 'wait respected its limit');
    });

    // ── 6. Navigation reports the new title ────────────────────────────────
    await run('navigate: returns the new address with the new title', async () => {
      const navigated = await json(`/panes/${browserPaneId}/browser/action`, 'POST', {
        action: 'navigate', url: `http://127.0.0.1:${FIXTURE_PORT}/next`
      });
      ensure(navigated.url.endsWith('/next'), 'address is the new page', navigated.url);
      ensure(navigated.title === 'Second page', 'title is the new page, not the old one', navigated.title);
    });

    await run('content: says when the text was cut short', async () => {
      const limited = await json(`/panes/${browserPaneId}/browser/content?limit=1000`);
      ensure(typeof limited.truncated === 'boolean', 'truncation is an explicit flag', limited);
      ensure(typeof limited.totalLength === 'number', 'total length is reported', limited);
      ensure(limited.truncated === false || limited.text.length <= 1000, 'never silently exceeds the limit', limited.text.length);
    });

    // ── 14/15. Tracked jobs and clean terminal text ────────────────────────
    await run('jobs: a successful command reports completion and its output', async () => {
      const job = await json(`/panes/${terminalPaneId}/jobs`, 'POST', { command: "printf 'alpha\\nbeta\\n'" });
      ensure(job.status === 'completed', 'job completed', job);
      ensure(job.exitCode === 0, 'exit code is reported', job.exitCode);
      ensure(job.stdout.includes('alpha') && job.stdout.includes('beta'), 'stdout is attributed to the job', job);
      ensure(job.id && job.id.startsWith('j_'), 'job has an identifier', job.id);
    });

    await run('jobs: a failing command reports its exit code', async () => {
      const job = await json(`/panes/${terminalPaneId}/jobs`, 'POST', { command: 'exit 7' });
      ensure(job.status === 'failed', 'job is failed', job);
      ensure(job.exitCode === 7, 'the real exit code is reported', job.exitCode);
    });

    await run('jobs: a slow command can be polled instead of guessed', async () => {
      const job = await json(`/panes/${terminalPaneId}/jobs`, 'POST', { command: 'sleep 1; printf done', wait: false });
      ensure(job.status === 'running', 'job starts running', job);
      const polled = await json(`/panes/${terminalPaneId}/jobs/${job.id}`);
      let final = polled;
      for (let attempt = 0; attempt < 40 && final.status === 'running'; attempt++) {
        await sleep(100);
        final = await json(`/panes/${terminalPaneId}/jobs/${job.id}`);
      }
      ensure(final.status === 'completed', 'job finishes and is re-readable', final);
      ensure(final.stdout.includes('done'), 'output follows the job', final);
    });

    await run('jobs: unknown job is a clear 404', async () => {
      const missing = await api(`/panes/${terminalPaneId}/jobs/j_nope`);
      ensure(missing.status === 404, 'unknown job is 404', missing.status);
    });

    await run('text: clean text drops escape codes, raw keeps them, unicode survives', async () => {
      // Through the interactive terminal, because clean text is a view of the
      // PTY output the human sees; job output belongs to the job.
      await json(`/panes/${terminalPaneId}/command`, 'POST', {
        command: "printf '\\033[31mcafé 東京\\033[0m\\n'",
        waitMs: 500
      });
      await sleep(250);
      const clean = await json(`/panes/${terminalPaneId}/text?mode=clean`);
      const raw = await json(`/panes/${terminalPaneId}/text?mode=raw`);
      ensure(clean.text.includes('café 東京'), 'clean text keeps unicode', clean.text.slice(-200));
      ensure(!clean.text.includes('\u001b'), 'clean text has no escape codes', JSON.stringify(clean.text.slice(-200)));
      ensure(raw.text.includes('\u001b['), 'raw text keeps the terminal data', JSON.stringify(raw.text.slice(-200)));
      ensure(typeof clean.truncated === 'boolean', 'clean text reports truncation', clean);
    });

    await run('env: an independent pane does not inherit a parent AI session identity', async () => {
      const job = await json(`/panes/${terminalPaneId}/jobs`, 'POST', {
        command: 'env | grep -E "^(CLAUDECODE|CLAUDE_CODE_CHILD_SESSION|CLAUDE_CODE_SESSION_ID|CLAUDE_CODE_ENTRYPOINT)=" || true'
      });
      ensure(job.status === 'completed', 'env probe ran', job);
      ensure(!job.stdout.includes('CLAUDE_CODE_CHILD_SESSION'), 'child-session marker is stripped', job.stdout);
      ensure(!job.stdout.includes('CLAUDECODE='), 'parent harness marker is stripped', job.stdout);
      // Configuration and credentials must survive.
      const kept = await json(`/panes/${terminalPaneId}/jobs`, 'POST', { command: 'printf "%s" "${TOWNMOUSE_PANE_ID:-missing}"' });
      ensure(kept.stdout === terminalPaneId, 'the pane still gets its own working identity', kept.stdout);
    });

    // ── 13. Three meanings of status ───────────────────────────────────────
    await run('status: program, agent, and command states stay separate', async () => {
      await json(`/panes/${terminalPaneId}/status`, 'POST', { state: 'working', message: 'running checks' });
      await sleep(120);
      let state = await json('/state');
      let pane = state.tabs.find((item) => item.id === tabId).panes.find((item) => item.id === terminalPaneId);
      ensure(pane.program.status === 'running', 'program is running', pane.program);
      ensure(pane.agent.state === 'working', 'agent reported working', pane.agent);
      ensure(pane.agent.ageMs >= 0, 'agent report carries its age', pane.agent);

      await json(`/panes/${terminalPaneId}/jobs`, 'POST', { command: 'printf ok' });
      state = await json('/state');
      pane = state.tabs.find((item) => item.id === tabId).panes.find((item) => item.id === terminalPaneId);
      ensure(pane.command && pane.command.status === 'completed', 'command status is its own channel', pane.command);
      ensure(pane.agent.state === 'working', 'a finished command does not rewrite the agent report', pane.agent);
    });

    // ── 16/18. Permission separation and caps ──────────────────────────────
    await run('limits: a fifth pane is refused with an explanation', async () => {
      const extraTab = await json('/tabs', 'POST', { title: 'Limit tab', createdBy: 'agent' });
      for (let index = 0; index < 4; index++) {
        await json(`/tabs/${extraTab.id}/panes`, 'POST', { kind: 'terminal', createdBy: 'agent' });
      }
      const refused = await api(`/tabs/${extraTab.id}/panes`, 'POST', { kind: 'terminal', createdBy: 'agent' });
      ensure(refused.status === 409, 'fifth pane refused', refused.status);
      ensure(/at most four/i.test(refused.data.error || ''), 'refusal explains the limit', refused.data);
      await json(`/tabs/${extraTab.id}`, 'DELETE');
    });

    await run('permissions: an agent token cannot bootstrap the owner workspace', async () => {
      const response = await fetch(BASE + '/api/panes/bootstrap', { headers: { Authorization: `Bearer ${token}` } });
      ensure(response.status === 403, 'agent bootstrap refused', response.status);
      const browser = await fetch(BASE + '/api/browser', { headers: { Authorization: `Bearer ${token}` } });
      ensure(browser.status === 403, 'agent cannot list owner browsers', browser.status);
    });

    await run('permissions: an agent token cannot change browser sharing', async () => {
      const state = await json('/state');
      const pane = state.tabs.find((item) => item.id === tabId).panes.find((item) => item.browserId);
      const response = await fetch(`${BASE}/api/browser/${pane.browserId}/permission`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ permission: 'control' })
      });
      ensure(response.status === 403, 'owner-only sharing refused', response.status);
    });

    await run('tokens: the workspace token never appears in page content or observations', async () => {
      const observed = await json(`/panes/${browserPaneId}/browser/observe?elements=1`);
      const serialized = JSON.stringify(observed);
      ensure(!serialized.includes(token), 'token is not in the observation payload');
      const content = await json(`/panes/${browserPaneId}/browser/content`);
      ensure(!content.text.includes(token), 'token is not in the page text');
    });

    await run('cli: the documented browser argument order targets the named pane', async () => {
      const catalogued = await json(`/panes/${browserPaneId2}/browser/elements`);
      const save = byRole(catalogued.elements, 'button', 'Save project');
      ensure(save, 'save button catalogued on the second browser', catalogued.elements.map((element) => element.name));
      const panes = path.join(ROOT, 'scripts', 'panes');
      // The environment points at a *terminal*; the named browser pane must win.
      const output = execFileSync(process.execPath, [panes, 'pane', 'browser', 'click', browserPaneId2, '--ref', save.ref], {
        env: { ...process.env, TOWNMOUSE_API: `${BASE}/api/panes`, TOWNMOUSE_TOKEN: token, TOWNMOUSE_PANE_ID: terminalPaneId },
        encoding: 'utf8'
      });
      const result = JSON.parse(output);
      ensure(result.action && result.action.status === 'completed',
        'pane browser click <pane-id> --ref reaches the named pane', result.action || result);
    });

    await run('cli: send-text keeps every word when the pane comes from the environment', async () => {
      const panes = path.join(ROOT, 'scripts', 'panes');
      execFileSync(process.execPath, [panes, 'pane', 'send-text', terminalPaneId2, '--raw', 'hello', 'world'], {
        env: { ...process.env, TOWNMOUSE_API: `${BASE}/api/panes`, TOWNMOUSE_TOKEN: token },
        encoding: 'utf8'
      });
      await sleep(400);
      const text = await json(`/panes/${terminalPaneId2}/text?mode=raw`);
      ensure(text.text.includes('hello world'), 'both words reached the terminal', text.text.slice(-160));
    });

    await run('type: --replace clears a contenteditable field', async () => {
      await json(`/panes/${browserPaneId}/browser/action`, 'POST', { action: 'navigate', url: `http://127.0.0.1:${FIXTURE_PORT}/` });
      await sleep(300);
      const catalogued = await json(`/panes/${browserPaneId}/browser/elements`);
      const note = catalogued.elements.find((element) => element.name === 'Note field');
      ensure(note && note.role === 'textbox', 'contenteditable is catalogued as a textbox', catalogued.elements.map((element) => `${element.role}:${element.name}`));
      const typed = await api(`/panes/${browserPaneId}/browser/action`, 'POST', {
        action: 'type', ref: note.ref, text: 'plain replacement', replace: true
      });
      ensure(typed.ok && typed.data.action.status === 'completed', 'typing completed', typed.data);
      const content = await json(`/panes/${browserPaneId}/browser/content`);
      ensure(content.text.includes('plain replacement'), 'new text is present', content.text.slice(0, 300));
      ensure(!content.text.includes('old note'), 'the previous contenteditable text is gone', content.text.slice(0, 300));
    });

    await run('jobs: cancelling a job terminates its descendants', async () => {
      const marker = path.join(os.tmpdir(), `tm-cancel-${Date.now()}`);
      const job = await json(`/panes/${terminalPaneId}/jobs`, 'POST', {
        command: `sh -c 'sleep 30 & echo $! > ${marker}; wait'`,
        wait: false
      });
      for (let attempt = 0; attempt < 40 && !fs.existsSync(marker); attempt++) await sleep(100);
      ensure(fs.existsSync(marker), 'the job recorded its child pid');
      const childPid = Number(fs.readFileSync(marker, 'utf8').trim());
      await json(`/panes/${terminalPaneId}/jobs/${job.id}`, 'DELETE');
      await sleep(1200);
      let alive = true;
      try { process.kill(childPid, 0); } catch (_) { alive = false; }
      ensure(!alive, 'the descendant process was terminated with the job', childPid);
      const final = await json(`/panes/${terminalPaneId}/jobs/${job.id}`);
      ensure(final.status === 'cancelled', 'the job reports cancelled', final);
      fs.rmSync(marker, { force: true });
    });

    await run('cli: --replace does not swallow the text', async () => {
      await json(`/panes/${browserPaneId}/browser/action`, 'POST', { action: 'navigate', url: `http://127.0.0.1:${FIXTURE_PORT}/` });
      await sleep(300);
      const catalogued = await json(`/panes/${browserPaneId}/browser/elements`);
      const input = byRole(catalogued.elements, 'textbox', 'Project name');
      const panes = path.join(ROOT, 'scripts', 'panes');
      const output = execFileSync(process.execPath,
        [panes, 'pane', 'browser', 'type', browserPaneId, '--ref', input.ref, '--replace', 'café 東京'],
        { env: { ...process.env, TOWNMOUSE_API: `${BASE}/api/panes`, TOWNMOUSE_TOKEN: token }, encoding: 'utf8' });
      const result = JSON.parse(output);
      ensure(result.action.status === 'completed', 'typing completed', result.action);
      ensure(result.action.control && result.action.control.value === 'café 東京',
        'the replacement text reached the field', result.action.control);
    });

    await run('cli: exec keeps command arguments after --', async () => {
      const panes = path.join(ROOT, 'scripts', 'panes');
      const output = execFileSync(process.execPath,
        [panes, 'pane', 'exec', terminalPaneId, '--', 'printf', '%s', '--no-wait'],
        { env: { ...process.env, TOWNMOUSE_API: `${BASE}/api/panes`, TOWNMOUSE_TOKEN: token }, encoding: 'utf8' });
      const job = JSON.parse(output);
      ensure(job.status === 'completed', 'the command completed', job);
      ensure(job.stdout === '--no-wait', 'the separator preserved the command argument', job.stdout);
    });

    await run('jobs: a multi-byte character split across chunks survives', async () => {
      const job = await json(`/panes/${terminalPaneId}/jobs`, 'POST', {
        command: `node -e "process.stdout.write(Buffer.from([0xc3])); setTimeout(() => process.stdout.write(Buffer.from([0xa9])), 25)"`
      });
      ensure(job.status === 'completed', 'the command completed', job);
      ensure(job.stdout === 'é', 'the split character decoded as one glyph', JSON.stringify(job.stdout));
    });

    await run('catalog: a password value is never serialized', async () => {
      await json(`/panes/${browserPaneId}/browser/action`, 'POST', { action: 'navigate', url: `http://127.0.0.1:${FIXTURE_PORT}/` });
      await sleep(300);
      const catalogued = await json(`/panes/${browserPaneId}/browser/elements`);
      ensure(!JSON.stringify(catalogued).includes('hunter2'), 'the password value is absent from the catalog');
      const password = catalogued.elements.find((element) => element.name === 'Password');
      ensure(password, 'the password field is catalogued', catalogued.elements.map((element) => element.name));
      ensure(password.value === null && password.redacted === true, 'the password field is redacted', password);
    });

    await run('wait: a hostile url pattern returns promptly instead of stalling', async () => {
      const started = Date.now();
      const waited = await json(`/panes/${browserPaneId}/browser/wait`, 'POST', { url: '(.*)+Z', timeout: 300 });
      const elapsed = Date.now() - started;
      ensure(waited.matched === false, 'the literal pattern does not match', waited);
      ensure(elapsed < 2500, 'the wait returned promptly', elapsed);
    });

    await run('journal: a stale ref is reported as missing, not guessed', async () => {
      const click = await api(`/panes/${browserPaneId}/browser/action`, 'POST', { action: 'click', ref: 'e99999' });
      ensure(click.status === 404, 'unknown ref is 404', click.status);
      ensure(click.data.action.status === 'missing', 'status is missing', click.data.action);
      ensure(/look again|not on the page|no longer present/i.test(click.data.action.message || ''), 'message is actionable', click.data.action.message);
    });
  } finally {
    try {
      if (tabId) await api(`/tabs/${tabId}`, 'DELETE');
    } catch (_) { /* best effort */ }
    app.kill('SIGTERM');
    mainFixture.close();
    frameFixture.close();
    await sleep(400);
    if (app.exitCode === null && app.signalCode === null) app.kill('SIGKILL');
  }

  const failures = results.filter((result) => !result.ok);
  console.log('\n' + '='.repeat(72));
  console.log(`RESULT passed=${results.length - failures.length} total=${results.length} failures=${failures.length}`);
  if (failures.length) {
    console.log('\nFailures:');
    for (const failure of failures) console.log(`- ${failure.title}: ${failure.error}`);
    if (appLog) console.log('\nServer log (tail):\n' + appLog.slice(-3000));
    process.exitCode = 1;
  } else {
    const evidence = path.join(ROOT, 'evidence');
    try {
      fs.mkdirSync(evidence, { recursive: true });
      fs.writeFileSync(
        path.join(evidence, 'agent-control-results.json'),
        JSON.stringify({ ranAt: new Date().toISOString(), results }, null, 2) + '\n'
      );
    } catch (_) { /* evidence is best effort */ }
  }
})();
