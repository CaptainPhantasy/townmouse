'use strict';

/*
 * Independent integration test for the pane workspace API.
 *
 * Run with:
 *   NODE_PATH=/Volumes/SanDisk1Tb/TOWNMOUSE/repo/node_modules \
 *     /opt/homebrew/bin/node tests/panes-api.test.cjs
 *
 * The test starts its own fixture HTTP server on 127.0.0.1:11372 and the app
 * on 127.0.0.1:11371 (cwd = repo root, executable = process.execPath), then
 * exercises the /api/panes surface. It never writes to the repository.
 */

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const APP_PORT = 11371;
const FIXTURE_PORT = 11372;
const BASE = `http://127.0.0.1:${APP_PORT}`;
const FIXTURE_BASE = `http://127.0.0.1:${FIXTURE_PORT}`;
const TOKEN_HEADER = 'X-Townmouse-Token';

const results = [];
const context = {};
let appLog = '';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function summarize(value, max = 1600) {
  if (value === undefined) return 'undefined';
  let text;
  try {
    text = JSON.stringify(value, (key, val) => {
      if (typeof val === 'string' && val.length > 300) {
        return `${val.slice(0, 120)}...<${val.length} chars>`;
      }
      return val;
    });
  } catch (_) {
    text = String(value);
  }
  if (text === undefined) text = String(value);
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

function fail(message, detail) {
  throw new Error(detail === undefined ? message : `${message} | response body: ${summarize(detail)}`);
}

function ensure(condition, message, detail) {
  if (!condition) fail(message, detail);
}

function required(name, value) {
  if (value === undefined || value === null || value === '') {
    throw new Error(`missing prerequisite ${name}; an earlier test failed`);
  }
  return value;
}

async function check(name, fn) {
  const started = Date.now();
  try {
    await fn();
    results.push({ name, ok: true, ms: Date.now() - started });
    console.log(`PASS ${name}`);
  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    results.push({ name, ok: false, ms: Date.now() - started, error: message });
    console.log(`FAIL ${name}\n  ${message}`);
  }
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

async function request(method, route, options = {}) {
  const { body, token, timeoutMs = 30000 } = options;
  const headers = {};
  if (token) headers[TOKEN_HEADER] = token;
  else headers.Cookie = await getOwnerCookie();
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(BASE + route, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs)
  });
  const text = await response.text();
  let parsed = text;
  try { parsed = JSON.parse(text); } catch (_) { /* keep raw text */ }
  return { status: response.status, body: parsed, text };
}

async function waitForHealth(timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  let lastStatus = null;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(2000) });
      lastStatus = response.status;
      if (response.status === 200) {
        const body = await response.json();
        if (body && body.status === 'ok') return body;
      }
    } catch (error) {
      lastError = error;
    }
    await sleep(150);
  }
  throw new Error(
    `app did not become healthy within ${timeoutMs}ms ` +
    `(last status: ${lastStatus}, last error: ${lastError ? lastError.message : 'none'})`
  );
}

const FIXTURE_PAGES = {
  '/': { title: 'Pane Fixture', heading: 'Pane Fixture' },
  '/second': { title: 'Pane Fixture Two', heading: 'Second Fixture' },
  '/popup': { title: 'Popup Opener', heading: 'Popup Opener', script: "window.open('/second', '_blank');" },
  '/dialog': { title: 'Dialog Fixture', heading: 'Dialog Fixture', script: "setTimeout(() => window.confirm('Proceed with paging?'), 150);" },
  '/dialog-inline': { title: 'Inline Dialog', heading: 'Inline Dialog', script: "window.confirm('Answer before load?');" }
};

function startFixtureServer() {
  const server = http.createServer((req, res) => {
    let pathname = '/';
    try { pathname = new URL(req.url, FIXTURE_BASE).pathname; } catch (_) { /* default path */ }
    if (pathname === '/favicon.ico') {
      res.statusCode = 204;
      res.end();
      return;
    }
    const page = FIXTURE_PAGES[pathname];
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    if (!page) {
      res.statusCode = 404;
      res.end('<!doctype html><html><head><title>Not Found</title></head><body><h1>Not Found</h1></body></html>');
      return;
    }
    res.statusCode = 200;
    res.end(`<!doctype html><html><head><title>${page.title}</title></head><body><h1>${page.heading}</h1>${page.script ? `<script>${page.script}</script>` : ''}</body></html>`);
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(FIXTURE_PORT, '127.0.0.1', () => resolve(server));
  });
}

function startApp() {
  const child = spawn(process.execPath, [path.join(ROOT, 'src', 'server.js')], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(APP_PORT), TOWNMOUSE_STATE_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'townmouse-panes-test-')) },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stdout.on('data', (chunk) => { appLog += chunk.toString(); });
  child.stderr.on('data', (chunk) => { appLog += chunk.toString(); });
  child.on('error', (error) => { appLog += `\n[spawn error] ${error.message}`; });
  return child;
}

function stopChild(child, timeoutMs = 15000) {
  return new Promise((resolve) => {
    if (!child || child.exitCode !== null || child.signalCode !== null) {
      resolve();
      return;
    }
    let settled = false;
    let timer = null;
    const finish = () => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve();
    };
    timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch (_) { /* already gone */ }
      finish();
    }, timeoutMs);
    child.once('exit', finish);
    try { child.kill('SIGTERM'); } catch (_) { finish(); }
  });
}

async function waitForState(predicate, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await request('GET', '/api/panes/state', { token: context.token });
    if (last.status === 200 && predicate(last.body)) return last;
    await sleep(150);
  }
  return last;
}

async function readUntil(paneId, match, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await request('GET', `/api/panes/panes/${paneId}/read?since=0`, { token: context.token });
    if (last.status === 200 && last.body && typeof last.body.data === 'string' && last.body.data.includes(match)) {
      return last;
    }
    await sleep(150);
  }
  return last;
}

async function snapshotUntil(paneId, predicate, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await request('GET', `/api/panes/panes/${paneId}/browser/snapshot`, {
      token: context.token,
      timeoutMs: 30000
    });
    if (last.status === 200 && predicate(last.body)) return last;
    await sleep(250);
  }
  return last;
}

function isNonEmptyBase64(value, minimum = 100) {
  if (typeof value !== 'string' || value.length < minimum) return false;
  if (!/^[A-Za-z0-9+/=\r\n]+$/.test(value)) return false;
  try { return Buffer.from(value, 'base64').length > 0; } catch (_) { return false; }
}

async function createPane(tabId, payload) {
  return request('POST', `/api/panes/tabs/${tabId}/panes`, {
    token: context.token,
    body: payload,
    timeoutMs: 60000
  });
}

function paneById(state, paneId) {
  for (const tab of state.tabs || []) {
    const pane = (tab.panes || []).find((candidate) => candidate.id === paneId);
    if (pane) return { tab, pane };
  }
  return null;
}

async function main() {
  let fixture = null;
  let child = null;

  try {
    try {
      fixture = await startFixtureServer();
    } catch (error) {
      results.push({ name: 'setup: fixture server', ok: false, error: error.message });
      console.log(`FAIL setup: fixture server\n  ${error.message}`);
    }

    child = startApp();

    await check('health: app listens on 127.0.0.1:11371', async () => {
      const health = await waitForHealth();
      ensure(health.status === 'ok', 'health payload should report ok', health);
    });

    await check('fixture: serves Pane Fixture at 127.0.0.1:11372', async () => {
      const response = await fetch(`${FIXTURE_BASE}/`, { signal: AbortSignal.timeout(5000) });
      const html = await response.text();
      ensure(response.status === 200, 'fixture should respond 200', html);
      ensure(html.includes('<title>Pane Fixture</title>'), 'fixture should have title Pane Fixture', html);
      ensure(html.includes('<h1>Pane Fixture</h1>'), 'fixture should render the Pane Fixture heading', html);
    });

    await check('bootstrap: denies a header-less local client', async () => {
      const response = await fetch(`${BASE}/api/panes/bootstrap`, { signal: AbortSignal.timeout(5000) });
      ensure(response.status === 403, 'bootstrap without an owner capability should be forbidden', response.status);
    });

    await check('bootstrap: returns a workspace token', async () => {
      const response = await request('GET', '/api/panes/bootstrap');
      ensure(response.status === 200, 'bootstrap should respond 200', response.body);
      ensure(
        typeof response.body.token === 'string' && response.body.token.length >= 32,
        'bootstrap should expose a non-empty token',
        response.body
      );
      ensure(
        typeof response.body.api === 'string' && response.body.api.includes(String(APP_PORT)),
        'bootstrap should expose the pane API url',
        response.body
      );
      context.token = response.body.token;
    });

    await check('browser bootstrap: denies header-less and agent callers', async () => {
      const bare = await fetch(`${BASE}/api/browser/bootstrap`, { signal: AbortSignal.timeout(5000) });
      ensure(bare.status === 403, 'header-less browser bootstrap should be forbidden', bare.status);
      const owner = await request('GET', '/api/browser/bootstrap');
      ensure(owner.status === 200, 'owner page should receive the browser key', owner.body);
      ensure(typeof owner.body.key === 'string' && owner.body.key.length >= 32, 'owner bootstrap should return a key', owner.body);
      const token = required('workspace token', context.token);
      const agent = await request('GET', '/api/browser/bootstrap', { token });
      ensure(agent.status === 403, 'a pane token must not obtain the owner browser key', agent.body);
    });

    await check('attachments: pane token uploads and serves a URL', async () => {
      const bare = await fetch(`${BASE}/api/attachments`, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain', 'X-Filename': 'bare.txt' },
        body: 'no token',
        signal: AbortSignal.timeout(5000)
      });
      ensure(bare.status === 403, 'header-less attachment upload should be forbidden', bare.status);
      const token = required('workspace token', context.token);
      const uploaded = await fetch(`${BASE}/api/attachments`, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain', 'X-Filename': 'agent-note.txt', 'X-Townmouse-Token': token },
        body: 'agent attachment body',
        signal: AbortSignal.timeout(5000)
      });
      const attachment = await uploaded.json();
      ensure(uploaded.status === 200, 'pane token should upload an attachment', attachment);
      ensure(typeof attachment.url === 'string' && attachment.url.includes('/attachments/'), 'attachment should return a URL', attachment);
      ensure(typeof attachment.path === 'string' && attachment.path.endsWith('agent-note.txt'), 'attachment should return a path', attachment);
      ensure(
        typeof attachment.localUrl === 'string' && attachment.localUrl.startsWith('http://127.0.0.1:'),
        'attachment should return a loopback URL for pane navigation',
        attachment
      );
      const proxied = await fetch(`${BASE}/api/attachments`, {
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain',
          'X-Filename': 'proxy-note.txt',
          'X-Townmouse-Token': token,
          'X-Forwarded-Proto': 'https',
          'X-Forwarded-Host': 'terminal.example.com'
        },
        body: 'proxy attachment',
        signal: AbortSignal.timeout(5000)
      });
      const proxiedAttachment = await proxied.json();
      ensure(proxied.status === 200, 'proxied attachment should upload', proxiedAttachment);
      ensure(
        String(proxiedAttachment.url).startsWith('https://terminal.example.com/attachments/'),
        'proxy headers should produce an HTTPS attachment URL',
        proxiedAttachment
      );
      ensure(
        String(proxiedAttachment.localUrl).startsWith('http://127.0.0.1:'),
        'localUrl must stay on loopback behind a proxy',
        proxiedAttachment
      );
      const served = await fetch(attachment.url, { signal: AbortSignal.timeout(5000) });
      ensure(served.status === 200, 'attachment URL should serve the upload', served.status);
      ensure((await served.text()) === 'agent attachment body', 'attachment URL should return the uploaded bytes');
      ensure(
        String(served.headers.get('content-security-policy') || '').startsWith('sandbox'),
        'attachment response should keep the sandbox CSP',
        served.headers.get('content-security-policy')
      );
      const active = await fetch(`${BASE}/api/attachments`, {
        method: 'POST',
        headers: { 'Content-Type': 'text/html', 'X-Filename': 'active.html', 'X-Townmouse-Token': token },
        body: '<script>document.title="should-not-run"</script>',
        signal: AbortSignal.timeout(5000)
      });
      const activeAttachment = await active.json();
      ensure(active.status === 200, 'HTML attachment should upload', activeAttachment);
      const activeServed = await fetch(activeAttachment.url, { signal: AbortSignal.timeout(5000) });
      ensure(
        String(activeServed.headers.get('content-disposition') || '').startsWith('attachment'),
        'active HTML must download instead of rendering on the workspace origin',
        activeServed.headers.get('content-disposition')
      );
      ensure(
        String(activeServed.headers.get('content-security-policy') || '').startsWith('sandbox'),
        'active HTML must retain the sandbox CSP',
        activeServed.headers.get('content-security-policy')
      );
    });

    await check('bootstrap: seeds one tab with a terminal orchestrator pane', async () => {
      required('workspace token', context.token);
      const response = await request('GET', '/api/panes/bootstrap');
      ensure(response.status === 200, 'bootstrap should respond 200', response.body);
      const state = response.body.state || {};
      ensure(Array.isArray(state.tabs) && state.tabs.length === 1, 'bootstrap should seed exactly one tab', state);
      const tab = state.tabs[0];
      ensure(Array.isArray(tab.panes) && tab.panes.length === 1, 'initial tab should hold exactly one pane', tab);
      const pane = tab.panes[0];
      ensure(pane.kind === 'terminal', 'initial pane should be a terminal', pane);
      ensure(/orchestrator/i.test(pane.title || ''), 'initial pane should be the orchestrator', pane);
      ensure(state.activeTabId === tab.id, 'initial tab should be active', state);
      ensure(state.activePaneId === pane.id, 'initial pane should be active', state);
      ensure(
        state.limits && state.limits.maxPanesPerTab === 4 && state.limits.maxTabs === 24,
        'state should publish workspace limits',
        state
      );
      context.initialTabId = tab.id;
      context.initialPaneId = pane.id;
    });

    await check('tabs: POST /api/panes/tabs creates a tab', async () => {
      const token = required('workspace token', context.token);
      const response = await request('POST', '/api/panes/tabs', {
        token,
        body: { title: 'Integration Tab' }
      });
      ensure(response.status === 200, 'tab creation should respond 200', response.body);
      ensure(typeof response.body.id === 'string' && response.body.id.startsWith('t_'), 'tab should have an id', response.body);
      ensure(response.body.title === 'Integration Tab', 'tab should keep the requested title', response.body);
      ensure(Array.isArray(response.body.panes) && response.body.panes.length === 0, 'new tab should be empty', response.body);
      context.tabId = response.body.id;
    });

    await check('panes: creates terminal pane 1 and reports its id and kind', async () => {
      required('workspace token', context.token);
      const tabId = required('tab id', context.tabId);
      const response = await createPane(tabId, { kind: 'terminal', cwd: ROOT, title: 'Terminal A' });
      ensure(response.status === 200, 'terminal pane creation should respond 200', response.body);
      ensure(typeof response.body.id === 'string' && response.body.id.startsWith('p_'), 'pane should have an id', response.body);
      ensure(response.body.kind === 'terminal', 'pane kind should be terminal', response.body);
      ensure(response.body.tabId === tabId, 'pane should belong to the new tab', response.body);
      context.terminalA = response.body.id;
    });

    await check('panes: creates terminal pane 2 and reports its id and kind', async () => {
      required('workspace token', context.token);
      const tabId = required('tab id', context.tabId);
      const response = await createPane(tabId, { kind: 'terminal', cwd: ROOT, title: 'Terminal B' });
      ensure(response.status === 200, 'terminal pane creation should respond 200', response.body);
      ensure(typeof response.body.id === 'string' && response.body.id.startsWith('p_'), 'pane should have an id', response.body);
      ensure(response.body.kind === 'terminal', 'pane kind should be terminal', response.body);
      ensure(response.body.tabId === tabId, 'pane should belong to the new tab', response.body);
      ensure(response.body.id !== context.terminalA, 'terminal panes should get distinct ids', response.body);
      context.terminalB = response.body.id;
    });

    await check('panes: creates browser pane 1 pointed at the fixture', async () => {
      required('workspace token', context.token);
      const tabId = required('tab id', context.tabId);
      const response = await createPane(tabId, { kind: 'browser', url: `${FIXTURE_BASE}/` });
      ensure(response.status === 200, 'browser pane creation should respond 200', response.body);
      ensure(typeof response.body.id === 'string' && response.body.id.startsWith('p_'), 'pane should have an id', response.body);
      ensure(response.body.kind === 'browser', 'pane kind should be browser', response.body);
      ensure(response.body.tabId === tabId, 'pane should belong to the new tab', response.body);
      ensure(typeof response.body.browserId === 'string' && response.body.browserId.length > 0, 'browser pane should expose a browser id', response.body);
      ensure(
        typeof response.body.url === 'string' && response.body.url.includes(String(FIXTURE_PORT)),
        'browser pane should point at the fixture',
        response.body
      );
      context.browserA = response.body.id;
    });

    await check('panes: creates browser pane 2 pointed at the fixture', async () => {
      required('workspace token', context.token);
      const tabId = required('tab id', context.tabId);
      const response = await createPane(tabId, { kind: 'browser', url: `${FIXTURE_BASE}/` });
      ensure(response.status === 200, 'browser pane creation should respond 200', response.body);
      ensure(typeof response.body.id === 'string' && response.body.id.startsWith('p_'), 'pane should have an id', response.body);
      ensure(response.body.kind === 'browser', 'pane kind should be browser', response.body);
      ensure(response.body.tabId === tabId, 'pane should belong to the new tab', response.body);
      ensure(response.body.id !== context.browserA, 'browser panes should get distinct ids', response.body);
      ensure(
        typeof response.body.url === 'string' && response.body.url.includes(String(FIXTURE_PORT)),
        'browser pane should point at the fixture',
        response.body
      );
      context.browserB = response.body.id;
    });

    await check('panes: rejects a fifth pane in the tab with 409', async () => {
      required('workspace token', context.token);
      const tabId = required('tab id', context.tabId);
      const response = await createPane(tabId, { kind: 'terminal', cwd: ROOT, title: 'Terminal C' });
      ensure(response.status === 409, 'fifth pane should be rejected with 409', response.body);
      ensure(
        typeof response.body.error === 'string' && /four panes/i.test(response.body.error),
        'fifth pane should explain the per-tab limit',
        response.body
      );
    });

    await check('panes: reorder endpoint moves a pane to the requested index', async () => {
      const token = required('workspace token', context.token);
      const tabId = required('tab id', context.tabId);
      const paneId = required('browser pane', context.browserB);
      const reordered = await request('POST', `/api/panes/tabs/${tabId}/reorder`, {
        token,
        body: { paneId, index: 0 }
      });
      ensure(reordered.status === 200, 'reorder should respond 200', reordered.body);
      const tab = (reordered.body.tabs || []).find((candidate) => candidate.id === tabId);
      ensure(tab && tab.panes[0].id === paneId, 'reordered pane should be first', reordered.body);
      const invalid = await request('POST', `/api/panes/tabs/${tabId}/reorder`, {
        token,
        body: { paneId: 'p_missing', index: 0 }
      });
      ensure(invalid.status === 404, 'unknown panes should be rejected', invalid.body);
    });

    await check('terminal: POST /command writes PANE_OK and /read exposes it', async () => {
      required('workspace token', context.token);
      const paneId = required('terminal pane', context.terminalA);
      const command = await request('POST', `/api/panes/panes/${paneId}/command`, {
        token: context.token,
        body: { command: "printf 'PANE_OK\\n'", waitMs: 400 }
      });
      ensure(command.status === 200, 'command endpoint should respond 200', command.body);
      ensure(command.body.ok === true, 'command endpoint should acknowledge the command', command.body);
      const read = await readUntil(paneId, 'PANE_OK', 15000);
      ensure(read && read.status === 200, 'read endpoint should respond 200', read ? read.body : 'no response');
      ensure(
        read.body && typeof read.body.data === 'string' && read.body.data.includes('PANE_OK'),
        'terminal output should contain PANE_OK',
        read.body
      );
      ensure(typeof read.body.offset === 'number' && read.body.offset > 0, 'read should report a buffer offset', read.body);
    });

    await check('terminal: send-keys submits input and wait observes output', async () => {
      const token = required('workspace token', context.token);
      const paneId = required('terminal pane', context.terminalA);
      const input = await request('POST', `/api/panes/panes/${paneId}/input`, {
        token,
        body: { data: 'echo WAIT_KEY_OK' }
      });
      ensure(input.status === 200, 'input endpoint should accept the command text', input.body);
      const keys = await request('POST', `/api/panes/panes/${paneId}/keys`, {
        token,
        body: { keys: ['enter'] }
      });
      ensure(keys.status === 200, 'keys endpoint should accept a named key', keys.body);
      const waited = await request('GET', `/api/panes/panes/${paneId}/wait?match=WAIT_KEY_OK&since=0&timeout=8000`, { token });
      ensure(waited.status === 200, 'wait endpoint should respond 200', waited.body);
      ensure(waited.body.matched === true, 'wait should match the command output', waited.body);
      ensure(
        typeof waited.body.data === 'string' && waited.body.data.includes('WAIT_KEY_OK'),
        'wait should return the matched output',
        waited.body
      );
      const idle = await request('GET', `/api/panes/panes/${paneId}/wait?idleMs=250&timeout=8000`, { token });
      ensure(idle.status === 200 && idle.body.matched === true, 'idle wait should resolve', idle.body);
      ensure(idle.body.reason === 'idle', 'idle wait should report the idle reason', idle.body);
      const bad = await request('POST', `/api/panes/panes/${paneId}/keys`, {
        token,
        body: { keys: ['not-a-real-key'] }
      });
      ensure(bad.status === 400, 'unknown key names should be rejected', bad.body);
    });

    await check('terminal: agent state is reportable and waitable', async () => {
      const token = required('workspace token', context.token);
      const paneId = required('terminal pane', context.terminalA);
      const blocked = await request('POST', `/api/panes/panes/${paneId}/status`, {
        token,
        body: { state: 'blocked', message: 'Waiting for approval' }
      });
      ensure(blocked.status === 200, 'status endpoint should accept blocked', blocked.body);
      ensure(blocked.body.agentState === 'blocked', 'status should report blocked', blocked.body);
      ensure(blocked.body.agentMessage === 'Waiting for approval', 'status should keep the message', blocked.body);
      const waited = await request('GET', `/api/panes/panes/${paneId}/wait?state=blocked&timeout=5000`, { token });
      ensure(waited.status === 200 && waited.body.matched === true, 'wait should observe the blocked state', waited.body);
      ensure(waited.body.reason === 'state' && waited.body.agentState === 'blocked', 'wait should report the state reason', waited.body);
      const invalid = await request('POST', `/api/panes/panes/${paneId}/status`, {
        token,
        body: { state: 'exploded' }
      });
      ensure(invalid.status === 400, 'invalid agent states should be rejected', invalid.body);
      await request('POST', `/api/panes/panes/${paneId}/status`, { token, body: { state: 'working' } });
    });

    await check('browser: snapshot has a base64 image, fixture url and title', async () => {
      required('workspace token', context.token);
      const paneId = required('browser pane', context.browserA);
      const snapshot = await snapshotUntil(
        paneId,
        (body) =>
          isNonEmptyBase64(body.image) &&
          typeof body.url === 'string' && body.url.includes(String(FIXTURE_PORT)) &&
          typeof body.title === 'string' && body.title.includes('Pane Fixture')
      );
      ensure(snapshot && snapshot.status === 200, 'browser snapshot should respond 200', snapshot ? snapshot.body : 'no response');
      const body = snapshot.body || {};
      ensure(isNonEmptyBase64(body.image), 'snapshot image should be a non-empty base64 string', body);
      ensure(
        typeof body.url === 'string' && body.url.includes(String(FIXTURE_PORT)),
        'snapshot url should target the fixture server',
        body
      );
      ensure(
        typeof body.title === 'string' && body.title.includes('Pane Fixture'),
        'snapshot title should match the fixture',
        body
      );
      ensure(typeof body.width === 'number' && typeof body.height === 'number', 'snapshot should report dimensions', body);
      context.snapshotImageLength = body.image.length;
    });

    await check('browser: navigating a pane updates the snapshot url', async () => {
      required('workspace token', context.token);
      const paneId = required('browser pane', context.browserA);
      const target = `${FIXTURE_BASE}/second`;
      const navigation = await request('POST', `/api/panes/panes/${paneId}/url`, {
        token: context.token,
        body: { url: target }
      });
      ensure(navigation.status === 200, 'browser navigation should respond 200', navigation.body);
      ensure(
        typeof navigation.body.url === 'string' && navigation.body.url.includes('/second'),
        'navigate response should expose the new url',
        navigation.body
      );
      const snapshot = await snapshotUntil(
        paneId,
        (body) =>
          typeof body.url === 'string' && body.url.includes('/second') &&
          isNonEmptyBase64(body.image)
      );
      ensure(snapshot && snapshot.status === 200, 'post-navigation snapshot should respond 200', snapshot ? snapshot.body : 'no response');
      ensure(
        typeof snapshot.body.url === 'string' && snapshot.body.url.includes('/second'),
        'snapshot url should update after navigation',
        snapshot.body
      );
      ensure(
        typeof snapshot.body.title === 'string' && snapshot.body.title.includes('Pane Fixture Two'),
        'snapshot title should reflect the second fixture page',
        snapshot.body
      );
    });

    await check('browser: a page popup does not crash the server or pane', async () => {
      required('workspace token', context.token);
      const paneId = required('browser pane', context.browserB);
      const navigation = await request('POST', `/api/panes/panes/${paneId}/url`, {
        token: context.token,
        body: { url: `${FIXTURE_BASE}/popup` }
      });
      ensure(navigation.status === 200, 'popup opener navigation should respond 200', navigation.body);
      const snapshot = await snapshotUntil(
        paneId,
        (body) => typeof body.url === 'string' && body.url.includes('/second')
      );
      ensure(snapshot && snapshot.status === 200, 'popup follow snapshot should respond 200', snapshot ? snapshot.body : 'no response');
      ensure(
        typeof snapshot.body.title === 'string' && snapshot.body.title.includes('Pane Fixture Two'),
        'popup target should be followed in the pane',
        snapshot.body
      );
      const health = await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(5000) });
      ensure(health.status === 200, 'server should remain healthy after a popup', health.status);
    });

    await check('browser: a page dialog is answerable instead of deadlocking', async () => {
      required('workspace token', context.token);
      const paneId = required('browser pane', context.browserA);
      const navigation = await request('POST', `/api/panes/panes/${paneId}/url`, {
        token: context.token,
        body: { url: `${FIXTURE_BASE}/dialog` }
      });
      ensure(navigation.status === 200, 'dialog fixture navigation should respond 200', navigation.body);
      const dialog = await snapshotUntil(paneId, (body) => body.dialog && body.dialog.id);
      ensure(dialog && dialog.status === 200, 'snapshot should expose the open dialog', dialog ? dialog.body : 'no response');
      ensure(dialog.body.dialog.type === 'confirm', 'dialog type should be confirm', dialog.body.dialog);
      ensure(/Proceed with paging/.test(dialog.body.dialog.message), 'dialog message should be exposed', dialog.body.dialog);

      const invalid = await request('POST', `/api/panes/panes/${paneId}/browser/dialog`, {
        token: context.token,
        body: { action: 'delete' }
      });
      ensure(invalid.status === 400, 'invalid dialog actions should be rejected', invalid.body);

      const answered = await request('POST', `/api/panes/panes/${paneId}/browser/dialog`, {
        token: context.token,
        body: { action: 'dismiss' }
      });
      ensure(answered.status === 200, 'dismiss should answer the dialog', answered.body);
      const cleared = await snapshotUntil(paneId, (body) => !body.dialog);
      ensure(cleared && cleared.status === 200, 'dialog should clear after answering', cleared ? cleared.body : 'no response');
      const health = await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(5000) });
      ensure(health.status === 200, 'server should remain healthy after answering a dialog', health.status);
    });

    await check('active: POST /api/panes/active and GET /api/panes/state agree', async () => {
      required('workspace token', context.token);
      const tabId = required('tab id', context.tabId);
      const paneId = required('terminal pane', context.terminalA);
      const activation = await request('POST', '/api/panes/active', {
        token: context.token,
        body: { tabId, paneId }
      });
      ensure(activation.status === 200, 'active endpoint should respond 200', activation.body);
      ensure(activation.body.activeTabId === tabId, 'active endpoint should activate the tab', activation.body);
      ensure(activation.body.activePaneId === paneId, 'active endpoint should activate the pane', activation.body);

      const state = await request('GET', '/api/panes/state', { token: context.token });
      ensure(state.status === 200, 'state endpoint should respond 200', state.body);
      ensure(state.body.activeTabId === tabId, 'state should report the active tab', state.body);
      ensure(state.body.activePaneId === paneId, 'state should report the active pane', state.body);
      const located = paneById(state.body, paneId);
      ensure(located && located.tab.id === tabId, 'active pane should live in the active tab', state.body);
      ensure(located.pane.active === true, 'serialized active pane should be flagged active', located.pane);
    });

    await check('close: closing a pane shrinks state', async () => {
      required('workspace token', context.token);
      const tabId = required('tab id', context.tabId);
      const paneId = required('terminal pane 2', context.terminalB);
      const before = await request('GET', '/api/panes/state', { token: context.token });
      ensure(before.status === 200, 'state should respond before closure', before.body);
      const beforeTab = (before.body.tabs || []).find((tab) => tab.id === tabId);
      ensure(beforeTab && beforeTab.panes.length === 4, 'tab should hold four panes before closure', before.body);

      const response = await request('DELETE', `/api/panes/panes/${paneId}`, { token: context.token });
      ensure(response.status === 200, 'pane deletion should respond 200', response.body);
      ensure(response.body.closed === true, 'pane deletion should acknowledge closure', response.body);
      const closedTab = (response.body.state.tabs || []).find((tab) => tab.id === tabId);
      ensure(closedTab && closedTab.panes.length === 3, 'tab should hold three panes after closure', response.body.state);
      ensure(
        !(closedTab.panes || []).some((pane) => pane.id === paneId),
        'closed pane should be removed from the tab',
        closedTab
      );

      const after = await waitForState((state) => {
        const tab = (state.tabs || []).find((candidate) => candidate.id === tabId);
        return tab && tab.panes.length === 3;
      });
      ensure(after && after.status === 200, 'state should respond after closure', after ? after.body : 'no response');
    });

    await check('close: closing a tab shrinks state', async () => {
      required('workspace token', context.token);
      const tabId = required('tab id', context.tabId);
      const initialTabId = required('initial tab id', context.initialTabId);
      const response = await request('DELETE', `/api/panes/tabs/${tabId}`, { token: context.token });
      ensure(response.status === 200, 'tab deletion should respond 200', response.body);
      ensure(response.body.closed === true, 'tab deletion should acknowledge closure', response.body);
      ensure(Array.isArray(response.body.state.tabs), 'deletion should return state tabs', response.body.state);
      ensure(response.body.state.tabs.length === 1, 'only the initial tab should remain', response.body.state);
      ensure(
        !response.body.state.tabs.some((tab) => tab.id === tabId),
        'closed tab should be removed from state',
        response.body.state
      );
      ensure(
        response.body.state.tabs[0].id === initialTabId,
        'initial tab should remain after closure',
        response.body.state
      );
      const paneCount = response.body.state.tabs.reduce((sum, tab) => sum + (tab.panes || []).length, 0);
      ensure(paneCount === 1, 'state should shrink to the single initial pane', response.body.state);
      ensure(response.body.state.activeTabId === initialTabId, 'initial tab should become active', response.body.state);
      ensure(response.body.state.activePaneId === context.initialPaneId, 'initial pane should become active', response.body.state);
    });

    await check('browser: an inline dialog on first load stays answerable', async () => {
      const token = required('workspace token', context.token);
      const tab = await request('POST', '/api/panes/tabs', { token, body: { title: 'Inline Dialog', activate: false } });
      ensure(tab.status === 200, 'inline tab should be created', tab.body);
      const started = Date.now();
      const pane = await createPane(tab.body.id, { kind: 'browser', url: `${FIXTURE_BASE}/dialog-inline` });
      ensure(pane.status === 200, 'inline browser pane should be created', pane.body);
      ensure(Date.now() - started < 5000, 'creation must not wait for the blocked navigation', Date.now() - started);
      const dialog = await snapshotUntil(pane.body.id, (body) => body.dialog && body.dialog.id);
      ensure(dialog && dialog.status === 200, 'snapshot should expose the inline dialog', dialog ? dialog.body : 'no response');
      ensure(/Answer before load/.test(dialog.body.dialog.message), 'inline dialog message should be exposed', dialog.body.dialog);
      const answered = await request('POST', `/api/panes/panes/${pane.body.id}/browser/dialog`, {
        token,
        body: { action: 'accept' }
      });
      ensure(answered.status === 200, 'inline dialog should be answerable', answered.body);
      const cleared = await snapshotUntil(pane.body.id, (body) => !body.dialog);
      ensure(cleared && cleared.status === 200, 'inline dialog should clear after answering', cleared ? cleared.body : 'no response');
    });

    await check('workspace: an intentionally empty workspace stays empty', async () => {
      const token = required('workspace token', context.token);
      const before = await request('GET', '/api/panes/state', { token });
      for (const tab of before.body.tabs || []) {
        await request('DELETE', `/api/panes/tabs/${tab.id}`, { token });
      }
      const empty = await request('GET', '/api/panes/state', { token });
      ensure(empty.status === 200 && empty.body.tabs.length === 0, 'state should report zero tabs', empty.body);
      const again = await request('GET', '/api/panes/state', { token });
      ensure(again.body.tabs.length === 0, 'a state poll must not reseed the workspace', again.body);
    });
  } finally {
    await stopChild(child);
    if (fixture) {
      try { fixture.closeAllConnections(); } catch (_) { /* older node */ }
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, 3000);
        fixture.close(() => { clearTimeout(timer); resolve(); });
      });
    }
  }

  report();
}

function report() {
  const failures = results.filter((result) => !result.ok);
  const passed = results.length - failures.length;
  const failureLines = failures.map((result) => `${result.name}: ${result.error}`);
  console.log('\n' + '='.repeat(72));
  console.log(`RESULT passed=${passed} total=${results.length} failures=${failureLines.length}`);
  for (const line of failureLines) console.log(`FAILURE ${line}`);
  if (failures.length) {
    console.log('\n--- app log (tail) ---');
    console.log(appLog.slice(-6000));
  }
  process.exitCode = failures.length ? 1 : 0;
}

main().catch((error) => {
  results.push({ name: 'fatal', ok: false, error: error && error.stack ? error.stack : String(error) });
  console.log(`FAIL fatal\n  ${error && error.stack ? error.stack : error}`);
  report();
});
