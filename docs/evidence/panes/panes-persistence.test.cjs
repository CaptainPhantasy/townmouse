'use strict';
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const APP_PORT = Number(process.env.PANES_PERSIST_PORT || 11375);
const FIXTURE_PORT = APP_PORT + 1;
const BASE = `http://127.0.0.1:${APP_PORT}`;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitHealth() {
  for (let i = 0; i < 100; i++) {
    try {
      const response = await fetch(`${BASE}/health`);
      if (response.ok) return;
    } catch (_) { /* starting */ }
    await wait(150);
  }
  throw new Error('server did not become healthy');
}

function startApp(stateDir) {
  return spawn(process.execPath, [path.join(ROOT, 'src', 'server.js')], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(APP_PORT), SHELL: '/bin/bash', TOWNMOUSE_STATE_DIR: stateDir },
    stdio: ['ignore', 'ignore', 'pipe']
  });
}

async function stop(child) {
  await new Promise((resolve) => {
    const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch (_) {} }, 4000);
    child.once('exit', () => { clearTimeout(timer); resolve(); });
    try { child.kill('SIGTERM'); } catch (_) { clearTimeout(timer); resolve(); }
  });
}

(async () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'townmouse-persist-'));
  const fixture = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'text/html');
    res.end('<title>Persisted Fixture</title><h1>Persisted</h1>');
  }).listen(FIXTURE_PORT, '127.0.0.1');

  let app = startApp(stateDir);
  try {
    await waitHealth();
    const boot = await (await fetch(`${BASE}/api/panes/bootstrap`)).json();
    const headers = { 'Content-Type': 'application/json', 'X-Townmouse-Token': boot.token };
    const post = async (suffix, body) => {
      const response = await fetch(`${BASE}/api/panes${suffix}`, { method: 'POST', headers, body: JSON.stringify(body || {}) });
      const payload = await response.json();
      assert(response.ok, `${suffix}: ${JSON.stringify(payload)}`);
      return payload;
    };
    const tab = await post('/tabs', { title: 'Persisted', activate: true });
    await post(`/tabs/${tab.id}/panes`, { kind: 'terminal', cwd: '/tmp', title: 'Restored Shell' });
    await post(`/tabs/${tab.id}/panes`, { kind: 'browser', url: `http://127.0.0.1:${FIXTURE_PORT}/` });
    await wait(500);
    await stop(app);

    app = startApp(stateDir);
    await waitHealth();
    const boot2 = await (await fetch(`${BASE}/api/panes/bootstrap`)).json();
    const persisted = boot2.state.tabs.find((candidate) => candidate.title === 'Persisted');
    assert(persisted, 'Persisted tab was not restored');
    assert.strictEqual(persisted.panes.length, 2, 'Persisted pane count changed');
    assert.deepStrictEqual(persisted.panes.map((pane) => pane.kind).sort(), ['browser', 'terminal']);
    const browser = persisted.panes.find((pane) => pane.kind === 'browser');
    assert(browser.url.includes(String(FIXTURE_PORT)), `Browser URL not restored: ${browser.url}`);
    assert(boot2.state.activeTabId === persisted.id, 'Persisted tab was not restored as active');
    console.log(`PASS persistence: restored ${persisted.panes.length} panes and the active tab`);
    console.log('RESULT passed=1 total=1 failures=0');
  } finally {
    await stop(app);
    fixture.close();
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error('FAIL persistence:', error.message);
  console.error('RESULT passed=0 total=1 failures=1');
  process.exitCode = 1;
});
