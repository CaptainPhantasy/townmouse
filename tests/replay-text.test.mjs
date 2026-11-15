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

test('replayTranscript never splits a surrogate pair at a row boundary', () => {
  const text = replayTranscript('abc😀x\r\n', 4);
  assert.ok(!/\ud83d\n|\n\ude00/.test(text), JSON.stringify(text));
  assert.ok(text.includes('😀x'), JSON.stringify(text));
});

test('replayTranscript applies each segment at the width that produced it', () => {
  const first = 'Mac-mini:~ floyd$ echo BEGIN_RESUME_MARKER_0123456789_AB \rCDEFGHIJ_END\r\nBEGIN_RESUME_MARKER_0123456789_ABCDEFGHIJ_END\r\n';
  const second = 'Mac-mini:~ floyd$ echo SECOND_AT_WIDE\r\nSECOND_AT_WIDE\r\n';
  const raw = first + second;
  const text = replayTranscript(raw, [{ at: 0, cols: 56 }, { at: first.length, cols: 134 }]);
  const flat = text.replace(/\n/g, '');
  assert.ok(flat.includes('echo BEGIN_RESUME_MARKER_0123456789_ABCDEFGHIJ_END'), flat);
  assert.ok(flat.includes('SECOND_AT_WIDE'), flat);
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

test('replayTranscript applies erase-line sequences before stripping them', () => {
  assert.equal(replayTranscript('progress 100%\r\x1b[Kdone\r\n', 80), 'done\n');
  assert.equal(replayTranscript('abcdef\x1b[2K\rxy\r\n', 80), 'xy\n');
  assert.equal(replayTranscript('abcdef\x1b[1K\rxy\r\n', 80), 'xy\n');
  assert.equal(replayTranscript('keep\r\nabcdef\r\x1b[Jz\r\n', 80), 'keep\nz\n');
});
