'use strict';

/*
 * Real two-socket routing integration. A deterministic transcription process
 * isolates reply ownership from ASR quality; no browser or microphone is used.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const WebSocket = require('ws');

const ROOT = process.env.TEST_APP_ROOT || path.join(__dirname, '..');
const PORT = Number(process.env.MULTI_WINDOW_PORT || 11409);
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
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'townmouse-voice-routing-'));
  const fixture = path.join(stateDir, 'transcriber.cjs');
  fs.writeFileSync(fixture, `const fs=require('fs');setTimeout(()=>fs.writeFileSync(process.argv[2], 'VOICE_ROUTING_MARKER'),150);`);
  fs.mkdirSync(path.join(stateDir, '.config/terminalone'), { recursive: true });
  fs.writeFileSync(path.join(stateDir, '.config/terminalone/voice.json'), JSON.stringify({command: process.execPath, model: 'fixture', language: 'en', args: `${fixture} {output} {audio}`}));
  const app = spawn(process.execPath, [path.join(ROOT, 'src', 'server.js')], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), SHELL: '/bin/bash', HOME: stateDir, TOWNMOUSE_STATE_DIR: stateDir },
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

    first.send(JSON.stringify({ type: 'voice-start', mimeType: 'audio/webm' }));
    await until(first, m => m.type === 'voice-ready');
    assert(!second.messages.some(m => m.type === 'voice-ready'), 'ready must stay with origin');
    second.send(JSON.stringify({ type: 'voice-end' }));
    await until(second, m => m.type === 'voice-error' && m.code === 'VOICE_EMPTY');
    first.send(JSON.stringify({ type: 'voice-chunk', b64: Buffer.from('fixture audio').toString('base64') }));
    first.send(JSON.stringify({ type: 'voice-end' }));
    await until(first, m => m.type === 'voice-transcript' && m.text === 'VOICE_ROUTING_MARKER');
    await wait(250);
    assert.strictEqual(first.messages.filter(m => m.type === 'voice-transcript').length, 1);
    assert.strictEqual(second.messages.filter(m => m.type === 'voice-transcript').length, 0);
    assert(!first.messages.some(m => m.type === 'voice-error'), 'other window errors must remain private');
    console.log('PASS two real sockets: output broadcasts, dictation replies stay with requesting window');
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
    console.log('Retained isolated test data:', stateDir);
  }
})();
