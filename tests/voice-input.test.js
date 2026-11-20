#!/usr/bin/env node
/**
 * Voice input protocol verification.
 *
 * Uses a temp mock `whisper` executable so the test proves TerminalOne's WS
 * framing, bounds, temp-file flow, and transcript response without downloading
 * a model or invoking real ASR.
 */
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const WebSocket = require('ws');

const PORT = process.env.VOICE_PORT || 11005;

function get(p, port = PORT) {
  return new Promise((resolve, reject) => {
    const req = http.get(`http://localhost:${port}${p}`, (res) => {
      let body = '';
      res.on('data', (d) => { body += d; });
      res.on('end', () => resolve({ statusCode: res.statusCode, body }));
    });
    req.on('error', reject);
    req.setTimeout(5000, () => req.destroy(new Error('timeout')));
  });
}

async function waitForHealth(timeoutMs = 20000, port = PORT) {
  const start = Date.now();
  for (;;) {
    try {
      const r = await get('/health', port);
      if (r.statusCode === 200 && JSON.parse(r.body).status === 'ok') return;
    } catch (_) {}
    if (Date.now() - start > timeoutMs) throw new Error('server did not become healthy');
    await new Promise((r) => setTimeout(r, 250));
  }
}

function openWs(port = PORT) {
  const ws = new WebSocket(`ws://localhost:${port}`);
  return new Promise((resolve, reject) => {
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
    setTimeout(() => reject(new Error('ws connect timeout')), 5000);
  });
}

function waitForMsg(ws, predicate, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const to = setTimeout(() => reject(new Error('timed out waiting for voice message')), timeoutMs);
    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw); } catch (_) { return; }
      if (predicate(msg)) {
        clearTimeout(to);
        resolve(msg);
      }
    });
  });
}

function makeMockWhisper() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'terminalone-mock-whisper-'));
  const script = path.join(dir, 'mock-whisper');
  fs.writeFileSync(script, `#!/bin/sh
audio="$1"
outdir="."
while [ "$#" -gt 0 ]; do
  if [ "$1" = "--output_dir" ]; then
    shift
    outdir="$1"
  fi
  shift || break
done
base="$(basename "$audio")"
base="\${base%.*}"
printf 'git status.\\n' > "$outdir/$base.txt"
`, { mode: 0o755 });
  return { dir, script };
}

function assertLog(ok, msg) {
  assert.ok(ok, msg);
  console.log('  ✓ ' + msg);
}

// A transcriber that cannot start must still answer the recording window,
// with two windows attached so the single-window fallback cannot mask it.
async function missingTranscriberCheck() {
  const port = Number(PORT) + 1;
  const missing = spawn('node', [path.join(__dirname, '..', 'src', 'server.js')], {
    env: { ...process.env, PORT: String(port), TERMINALONE_STT_BIN: path.join(os.tmpdir(), 'townmouse-no-such-whisper') },
    stdio: ['ignore', 'ignore', 'ignore']
  });
  try {
    await waitForHealth(20000, port);
    const a = await openWs(port);
    a.send(JSON.stringify({ type: 'shell', cols: 80, rows: 24 }));
    const shell = await waitForMsg(a, (m) => m.type === 'ready');
    const b = await openWs(port);
    b.send(JSON.stringify({ type: 'resume', sessionId: shell.sessionId, cols: 80, rows: 24 }));
    await waitForMsg(b, (m) => m.type === 'ready' && m.resumed);
    b.send(JSON.stringify({ type: 'voice-start', mimeType: 'audio/webm', voiceId: 'rec-2' }));
    await waitForMsg(b, (m) => m.type === 'voice-ready');
    b.send(JSON.stringify({ type: 'voice-chunk', b64: Buffer.from('audio').toString('base64'), voiceId: 'rec-2' }));
    b.send(JSON.stringify({ type: 'voice-end', voiceId: 'rec-2' }));
    const failed = await waitForMsg(b, (m) => m.type === 'voice-error');
    assertLog(failed.code === 'STT_UNAVAILABLE' && /not found/.test(failed.message || ''),
      `missing transcriber reports to the recording window (${failed.code}: ${failed.message})`);
    a.close();
    b.close();
  } finally {
    missing.kill('SIGTERM');
  }
}

async function run() {
  console.log('TerminalOne voice input protocol test');
  const mock = makeMockWhisper();
  const server = spawn('node', [path.join(__dirname, '..', 'src', 'server.js')], {
    env: { ...process.env, PORT: String(PORT), TERMINALONE_STT_BIN: mock.script, TERMINALONE_STT_TIMEOUT_MS: '8000' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let log = '';
  server.stdout.on('data', (d) => { log += d; });
  server.stderr.on('data', (d) => { log += d; });

  try {
    await waitForHealth();

    const ws = await openWs();
    ws.send(JSON.stringify({ type: 'voice-start', mimeType: 'audio/webm' }));
    const ready = await waitForMsg(ws, (m) => m.type === 'voice-ready');
    assertLog(ready.type === 'voice-ready', 'voice-start returns voice-ready');
    ws.send(JSON.stringify({ type: 'voice-chunk', b64: Buffer.from('fake audio').toString('base64') }));
    ws.send(JSON.stringify({ type: 'voice-end' }));
    const transcript = await waitForMsg(ws, (m) => m.type === 'voice-transcript');
    assertLog(transcript.text === 'git status.', `voice-end returns transcript (${transcript.text})`);
    ws.close();

    const ws2 = await openWs();
    ws2.send(JSON.stringify({ type: 'voice-start', mimeType: 'audio/webm' }));
    await waitForMsg(ws2, (m) => m.type === 'voice-ready');
    ws2.send(JSON.stringify({ type: 'voice-chunk', b64: Buffer.alloc(513 * 1024).toString('base64') }));
    const tooLarge = await waitForMsg(ws2, (m) => m.type === 'voice-error');
    assertLog(tooLarge.code === 'VOICE_CHUNK_TOO_LARGE', `oversized chunk rejected (${tooLarge.code})`);
    ws2.close();

    // Two windows on one shell: only the recording window gets the reply,
    // otherwise each window would type the transcript into the shared PTY.
    const owner = await openWs();
    owner.send(JSON.stringify({ type: 'shell', cols: 80, rows: 24 }));
    const shell = await waitForMsg(owner, (m) => m.type === 'ready');
    const recorder = await openWs();
    recorder.send(JSON.stringify({ type: 'resume', sessionId: shell.sessionId, cols: 80, rows: 24 }));
    await waitForMsg(recorder, (m) => m.type === 'ready' && m.resumed);
    const ownerVoice = [];
    owner.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (String(msg.type || '').startsWith('voice-')) ownerVoice.push(msg.type);
      } catch (_) { /* ignore */ }
    });
    recorder.send(JSON.stringify({ type: 'voice-start', mimeType: 'audio/webm' }));
    await waitForMsg(recorder, (m) => m.type === 'voice-ready');
    recorder.send(JSON.stringify({ type: 'voice-chunk', b64: Buffer.from('fake audio').toString('base64') }));
    recorder.send(JSON.stringify({ type: 'voice-end' }));
    const shared = await waitForMsg(recorder, (m) => m.type === 'voice-transcript');
    assertLog(shared.text === 'git status.', 'recording window receives its transcript');
    await new Promise((r) => setTimeout(r, 500));
    assertLog(ownerVoice.length === 0, `other window receives no voice messages (${ownerVoice.join(',') || 'none'})`);
    owner.close();
    recorder.close();

    // The recording window reconnects mid-utterance: the same voiceId on the
    // resumed socket finishes the recording; a window without it cannot.
    const before = await openWs();
    before.send(JSON.stringify({ type: 'shell', cols: 80, rows: 24 }));
    const live = await waitForMsg(before, (m) => m.type === 'ready');
    before.send(JSON.stringify({ type: 'voice-start', mimeType: 'audio/webm', voiceId: 'rec-1' }));
    await waitForMsg(before, (m) => m.type === 'voice-ready');
    before.send(JSON.stringify({ type: 'voice-chunk', b64: Buffer.from('part one').toString('base64'), voiceId: 'rec-1' }));
    await new Promise((r) => setTimeout(r, 200));
    before.close();
    const after = await openWs();
    after.send(JSON.stringify({ type: 'resume', sessionId: live.sessionId, cols: 80, rows: 24 }));
    await waitForMsg(after, (m) => m.type === 'ready' && m.resumed);
    const stranger = await openWs();
    stranger.send(JSON.stringify({ type: 'resume', sessionId: live.sessionId, cols: 80, rows: 24 }));
    await waitForMsg(stranger, (m) => m.type === 'ready' && m.resumed);
    stranger.send(JSON.stringify({ type: 'voice-chunk', b64: Buffer.from('intruder').toString('base64') }));
    const rejected = await waitForMsg(stranger, (m) => m.type === 'voice-error');
    assertLog(rejected.code === 'VOICE_NOT_STARTED', `another window cannot join the recording (${rejected.code})`);
    after.send(JSON.stringify({ type: 'voice-chunk', b64: Buffer.from('part two').toString('base64'), voiceId: 'rec-1' }));
    after.send(JSON.stringify({ type: 'voice-end', voiceId: 'rec-1' }));
    const resumedTranscript = await waitForMsg(after, (m) => m.type === 'voice-transcript' || m.type === 'voice-error');
    assertLog(resumedTranscript.type === 'voice-transcript', `reconnected window finishes its recording (${resumedTranscript.code || resumedTranscript.text})`);
    after.close();
    stranger.close();
    await missingTranscriberCheck();
  } catch (err) {
    console.error('\n✗ ' + (err && err.message ? err.message : err));
    if (log.trim()) console.error('--- server log ---\n' + log.trim());
    server.kill('SIGTERM');
    fs.rmSync(mock.dir, { recursive: true, force: true });
    process.exit(1);
  }

  server.kill('SIGTERM');
  fs.rmSync(mock.dir, { recursive: true, force: true });
  console.log('\nAll voice input protocol checks passed!');
}

run();
