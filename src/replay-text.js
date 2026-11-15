'use strict';

const STRIP = [
  // OSC (titles, colors, clipboard) terminated by BEL or ST.
  /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g,
  // CSI (cursor movement, erase, SGR, modes).
  /\x1b\[[0-?]*[ -/]*[@-~]/g,
  // Remaining two-character escapes.
  /\x1b[@-_]/g
];

function stripEscapes(value) {
  let text = String(value || '');
  for (const pattern of STRIP) text = text.replace(pattern, '');
  return text;
}

function cellWidth(codePoint) {
  if (codePoint < 32) return 0;
  if ((codePoint >= 0x0300 && codePoint <= 0x036f) ||
      (codePoint >= 0x1ab0 && codePoint <= 0x1aff) ||
      (codePoint >= 0x1dc0 && codePoint <= 0x1dff) ||
      (codePoint >= 0x20d0 && codePoint <= 0x20ff) ||
      (codePoint >= 0xfe20 && codePoint <= 0xfe2f)) return 0;
  if (codePoint >= 0x1100 && (
    codePoint <= 0x115f ||
    codePoint === 0x2329 || codePoint === 0x232a ||
    (codePoint >= 0x2e80 && codePoint <= 0xa4cf && codePoint !== 0x303f) ||
    (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
    (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
    (codePoint >= 0xfe10 && codePoint <= 0xfe19) ||
    (codePoint >= 0xfe30 && codePoint <= 0xfe6f) ||
    (codePoint >= 0xff00 && codePoint <= 0xff60) ||
    (codePoint >= 0xffe0 && codePoint <= 0xffe6) ||
    (codePoint >= 0x1f000 && codePoint <= 0x1faff) ||
    (codePoint >= 0x20000 && codePoint <= 0x3fffd)
  )) return 2;
  return 1;
}

// Turn raw PTY output into the final text a terminal would display. Used only
// when a session resumes after a resize: replaying raw cursor movements makes
// xterm reflow fragments of commands. `segments` is a sorted list of
// { at, cols } offsets into the raw string, one per width change, so bytes
// produced at 56 columns are still interpreted at 56 even if the newest output
// was produced at 134.
function replayTranscript(raw, segments = 120) {
  const source = String(raw || '');
  const widths = Array.isArray(segments)
    ? segments
      .map((segment) => ({ at: Math.max(0, Math.floor(Number(segment.at) || 0)), cols: Number(segment.cols) || 120 }))
      .sort((a, b) => a.at - b.at)
    : [{ at: 0, cols: Number(segments) || 120 }];
  if (!widths.length || widths[0].at > 0) widths.unshift({ at: 0, cols: widths[0]?.cols || 120 });

  const rows = [];
  let row = 0;
  let col = 0;
  let wrapPending = false;

  const ensure = (index) => {
    while (rows.length <= index) rows.push([]);
  };

  let width = Math.max(2, Math.min(400, Math.floor(widths[0].cols)));

  const put = (value, cells = 1) => {
    ensure(row);
    if (wrapPending) {
      row += 1;
      col = 0;
      wrapPending = false;
      ensure(row);
    }
    if (cells === 2 && col >= width - 1) {
      row += 1;
      col = 0;
      ensure(row);
    }
    const line = rows[row];
    while (line.length < col) line.push(' ');
    line[col] = value;
    if (cells === 2) line[col + 1] = '';
    col += cells;
    if (col >= width) {
      col = width - 1;
      wrapPending = true;
    }
  };

  for (let index = 0; index < source.length; index++) {
    while (widths.length > 1 && widths[1].at <= index) {
      widths.shift();
      width = Math.max(2, Math.min(400, Math.floor(widths[0].cols)));
    }
    const ch = source[index];
    if (ch === '\x1b') {
      const rest = source.slice(index);
      const osc = rest.match(/^\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/);
      if (osc) { index += osc[0].length - 1; continue; }
      const csi = rest.match(/^\x1b\[[0-?]*[ -/]*[@-~]/);
      if (csi) { index += csi[0].length - 1; continue; }
      const two = rest.match(/^\x1b[@-_]/);
      if (two) { index += two[0].length - 1; continue; }
      continue;
    }
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

    const codePoint = source.codePointAt(index);
    const value = String.fromCodePoint(codePoint);
    if (codePoint > 0xffff) index += 1;
    const cells = cellWidth(codePoint);
    if (cells === 0) {
      const line = rows[row];
      if (line && col > 0) line[col - 1] = (line[col - 1] || '') + value;
      continue;
    }
    put(value, cells);
  }

  return rows
    .map((line) => line.join('').replace(/\s+$/, ''))
    .join('\n')
    .replace(/^\n+/, '')
    .replace(/\n+$/, '\n');
}

module.exports = { replayTranscript, stripEscapes };
