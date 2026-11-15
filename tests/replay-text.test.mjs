import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { replayTranscript } = require('../src/replay-text.js');

test('replayTranscript removes color, cursor motion and title sequences', () => {
  const raw = '\x1b]0;title\x07\x1b[32muser@host\x1b[0m$ echo hi\r\nhi\r\n';
  assert.equal(replayTranscript(raw), 'user@host$ echo hi\nhi\n');
});

test('replayTranscript collapses carriage-return redraws to the final line', () => {
  const raw = 'progress 10%\rprogress 55%\rprogress 100%\ndone\r\n';
  assert.equal(replayTranscript(raw), 'progress 100%\ndone\n');
});

test('replayTranscript applies backspace and overwrite without duplicate characters', () => {
  assert.equal(replayTranscript('echo helloo\b \r\n'), 'echo hello\n');
});

test('replayTranscript keeps a wrapped command and its output in order', () => {
  const marker = 'BEGIN_RESUME_MARKER_0123456789_ABCDEFGHIJ_END';
  // Captured from bash readline at 56 columns: the space after `_AB` forces
  // auto-wrap, then \r returns to column zero of the second row.
  const raw = `Mac-mini:~ floyd$ echo BEGIN_RESUME_MARKER_0123456789_AB \rCDEFGHIJ_END\r\n${marker}\r\n`;
  const text = replayTranscript(raw, 56);
  const flat = text.replace(/\n/g, '');
  assert.ok(flat.includes(`echo ${marker}`), flat);
  assert.ok(flat.split(marker).length - 1 >= 2, flat);
  assert.ok(text.indexOf('echo') < text.lastIndexOf(marker));
});
