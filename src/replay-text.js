'use strict';

// Turn raw PTY output into the final text a terminal of `cols` columns would
// display. Used only when a session resumes at a different width: replaying raw
// cursor movements and shell redraws at a new width makes xterm reflow
// fragments of commands. This mini-grid keeps auto-wrap and carriage-return
// semantics, drops escape sequences, and emits plain lines that are safe to
// write at any width.
function replayTranscript(raw, cols = 120) {
  const text = String(raw || '')
    // OSC (titles, colors, clipboard) terminated by BEL or ST.
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
    // CSI (cursor movement, erase, SGR, modes).
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
    // Remaining two-character escapes.
    .replace(/\x1b[@-_]/g, '');

  const width = Math.max(2, Math.min(400, Math.floor(Number(cols) || 120)));
  const rows = [];
  let row = 0;
  let col = 0;
  let wrapPending = false;

  const ensure = (index) => {
    while (rows.length <= index) rows.push([]);
  };
  const put = (ch) => {
    ensure(row);
    if (wrapPending) {
      row += 1;
      col = 0;
      wrapPending = false;
      ensure(row);
    }
    const line = rows[row];
    while (line.length < col) line.push(' ');
    line[col] = ch;
    col += 1;
    if (col >= width) {
      col = width - 1;
      wrapPending = true;
    }
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '\r') {
      col = 0;
      wrapPending = false;
      continue;
    }
    if (ch === '\n') {
      row += 1;
      col = 0;
      wrapPending = false;
      ensure(row);
      continue;
    }
    if (ch === '\b') {
      if (wrapPending) wrapPending = false;
      else if (col > 0) col -= 1;
      continue;
    }
    if (ch === '\t') {
      const target = Math.min(width - 1, (col + 8) - (col % 8));
      while (col < target) put(' ');
      continue;
    }
    if (ch === '\x07' || ch === '\x00') continue;
    if (ch < ' ') continue;
    put(ch);
  }

  return rows
    .map((line) => line.join('').replace(/\s+$/, ''))
    .join('\n')
    .replace(/^\n+/, '')
    .replace(/\n+$/, '\n');
}

module.exports = { replayTranscript };
