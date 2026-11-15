'use strict';

/*
 * A second window may resume the same shell. Closing the superseded first
 * window must not detach or kill the live second window.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const WebSocket = require('ws');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.MULTI_WINDOW_PORT || 11402);
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

function connect() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
    ws.messages = [];
    ws.on('message', (raw) => {
      try { ws.messages.push(JSON.parse(raw.toString())); } catch (_) { /* ignore */ }
    });
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

async function until(ws, predicate, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const found = ws.messages.find(predicate);
    if (found) return found;
    await wait(50);
  }
  throw new Error(`timed out; messages=${JSON.stringify(ws.messages.slice(-8))}`);
}

(async () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'townmouse-multi-window-'));
  const app = spawn(process.execPath, [path.join(ROOT, 'src', 'server.js')], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), SHELL: '/bin/bash', TOWNMOUSE_STATE_DIR: stateDir },
    stdio: ['ignore', 'ignore', 'pipe']
  });
  let stderr = '';
  app.stderr.on('data', (chunk) => { stderr += chunk; });
  let first = null;
  let second = null;
  try {
    await waitHealth();
    first = await connect();
    first.send(JSON.stringify({ type: 'shell', cols: 80, rows: 24 }));
    const ready = await until(first, (message) => message.type === 'ready');
    assert(ready.sessionId, 'first window should receive a session id');

    second = await connect();
    second.send(JSON.stringify({ type: 'resume', sessionId: ready.sessionId, cols: 80, rows: 24 }));
    const resumed = await until(second, (message) => message.type === 'ready' && message.resumed);
    assert.strictEqual(resumed.sessionId, ready.sessionId, 'second window should resume the same shell');

    second.send(JSON.stringify({ type: 'input', data: "printf 'BOTH_WINDOWS_ALIVE\\n'\r" }));
    await until(first, (message) =>
      message.type === 'output' && String(message.data || '').includes('BOTH_WINDOWS_ALIVE'));
    await until(second, (message) =>
      message.type === 'output' && String(message.data || '').includes('BOTH_WINDOWS_ALIVE'));

    first.close();
    await wait(500);

    second.send(JSON.stringify({ type: 'input', data: "printf 'SECOND_WINDOW_ALIVE\\n'\r" }));
    const output = await until(second, (message) =>
      message.type === 'output' && String(message.data || '').includes('SECOND_WINDOW_ALIVE'));
    assert(output, 'second window should keep receiving output after the first closes');

    second.send(JSON.stringify({ type: 'input', data: "printf 'STILL_HERE\\n'\r" }));
    await until(second, (message) =>
      message.type === 'output' && String(message.data || '').includes('STILL_HERE'));
    console.log('PASS multi-window: superseded socket close did not detach the live window');
    console.log('RESULT passed=1 total=1 failures=0');
  } catch (error) {
    console.error('FAIL multi-window:', error.message);
    if (stderr) console.error(stderr.slice(-1200));
    console.log('RESULT passed=0 total=1 failures=1');
    process.exitCode = 1;
  } finally {
    try { first?.close(); } catch (_) { /* gone */ }
    try { second?.close(); } catch (_) { /* gone */ }
    await new Promise((resolve) => {
      const timer = setTimeout(() => { try { app.kill('SIGKILL'); } catch (_) {} }, 4000);
      app.once('exit', () => { clearTimeout(timer); resolve(); });
      try { app.kill('SIGTERM'); } catch (_) { clearTimeout(timer); resolve(); }
    });
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
})();
