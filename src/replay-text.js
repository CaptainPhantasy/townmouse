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
      while (col < target) {
        ensure(row);
        if (wrapPending) { row += 1; col = 0; wrapPending = false; ensure(row); }
        const line = rows[row];
        while (line.length < col) line.push(' ');
        line[col] = ' ';
        col += 1;
        if (col >= width) { col = width - 1; wrapPending = true; }
      }
      continue;
    }
    if (ch === '\x07' || ch === '\x00') continue;
    if (ch < ' ') continue;

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
  }

  return rows
    .map((line) => line.join('').replace(/\s+$/, ''))
    .join('\n')
    .replace(/^\n+/, '')
    .replace(/\n+$/, '\n');
}

module.exports = { replayTranscript, stripEscapes };
