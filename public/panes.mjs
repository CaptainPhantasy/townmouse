import { Terminal } from '/node_modules/@xterm/xterm/lib/xterm.mjs';
import { FitAddon } from '/node_modules/@xterm/addon-fit/lib/addon-fit.mjs';
import { WebLinksAddon } from '/node_modules/@xterm/addon-web-links/lib/addon-web-links.mjs';
import { chunkInput } from '/input-chunks.mjs';

const API_ROOT = '/api/panes';
const STATE_POLL_MS = 1200;
const READ_POLL_MS = 180;
const SNAPSHOT_POLL_MS = 1000;
const MAX_HISTORY = 120000;
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

const byId = (id) => document.getElementById(id);
const els = {
  grid: byId('pane-grid'),
  tabStrip: byId('tabstrip'),
  workspace: byId('workspace'),
  emptyState: byId('empty-state'),
  emptyTitle: byId('empty-title'),
  emptyCopy: byId('empty-copy'),
  emptyActions: byId('empty-actions'),
  emptyAddTerminal: byId('empty-add-terminal'),
  emptyAddBrowser: byId('empty-add-browser'),
  emptyNewTab: byId('empty-new-tab'),
  backButton: byId('back-button'),
  hostPill: byId('host-pill'),
  hostName: byId('host-name'),
  tabsButton: byId('tabs-button'),
  tabCount: byId('tab-count'),
  keyboardButton: byId('keyboard-button'),
  menuButton: byId('menu-button'),
  tabsDialog: byId('tabs-dialog'),
  tabsList: byId('tabs-list'),
  tabsEmpty: byId('tabs-empty'),
  tabsLimits: byId('tabs-limits'),
  tabsNewTab: byId('tabs-new-tab'),
  tabsAddTerminal: byId('tabs-add-terminal'),
  tabsAddBrowser: byId('tabs-add-browser'),
  menuDialog: byId('menu-dialog'),
  menuAddTerminal: byId('menu-add-terminal'),
  menuAddBrowser: byId('menu-add-browser'),
  menuNewTab: byId('menu-new-tab'),
  menuAttach: byId('menu-attach'),
  menuReader: byId('menu-reader'),
  menuShortcuts: byId('menu-shortcuts'),
  menuFontUp: byId('menu-font-up'),
  menuFontDown: byId('menu-font-down'),
  shortcutsDialog: byId('shortcuts-dialog'),
  attachInput: byId('attach-input'),
  readerView: byId('reader-view'),
  readerText: byId('reader-text'),
  readerRefresh: byId('reader-refresh'),
  readerClose: byId('reader-close'),
  closeConfirm: byId('close-confirm'),
  closeConfirmTitle: byId('close-confirm-title'),
  closeConfirmCopy: byId('close-confirm-copy'),
  closeCancel: byId('close-cancel'),
  closeApprove: byId('close-approve'),
  keybar: byId('pane-keybar'),
  contextMenu: byId('pane-context-menu'),
  browserContextMenu: byId('browser-context-menu'),
  browserControl: byId('browser-control'),
  browserControlLabel: byId('browser-control-label'),
  browserControlSelect: byId('browser-control-select'),
  browserControlValue: byId('browser-control-value'),
  browserControlCancel: byId('browser-control-cancel'),
  browserControlApply: byId('browser-control-apply'),
  pageDialog: byId('page-dialog'),
  pageDialogMessage: byId('page-dialog-message'),
  pageDialogField: byId('page-dialog-field'),
  pageDialogInput: byId('page-dialog-input'),
  pageDialogDismiss: byId('page-dialog-dismiss'),
  pageDialogAccept: byId('page-dialog-accept'),
  notice: byId('notice'),
  srStatus: byId('sr-status')
};

const TERMINAL_THEME = {
  background: '#080b0a',
  foreground: '#d7e6df',
  cursor: '#7fe3c0',
  cursorAccent: '#080b0a',
  selectionBackground: 'rgba(127, 227, 192, 0.24)',
  black: '#141b18',
  red: '#ff8f8f',
  green: '#7fe3c0',
  yellow: '#e9d6a1',
  blue: '#8fb8dd',
  magenta: '#d9b1cf',
  cyan: '#8fe6d4',
  white: '#dfeae5',
  brightBlack: '#61776d',
  brightRed: '#ffb3b3',
  brightGreen: '#a5f2d8',
  brightYellow: '#f3e5bd',
  brightBlue: '#b2cee8',
  brightMagenta: '#e8cae1',
  brightCyan: '#b6f4e6',
  brightWhite: '#f2faf6'
};

const CLOSE_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';
const BACK_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>';
const RELOAD_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5"/></svg>';

let token = '';
let currentState = null;
let lastSignature = '';
let currentTabId = null;
let refreshInFlight = null;
let noticeTimer = 0;
let noticeText = '';
let noticeAt = 0;
let tabsDialogSignature = '';
let booting = false;
let pendingClose = null;
let pageDialogRecordId = null;
let pageDialogId = null;
let pageDialogType = '';
let contextRecordId = null;
let browserContextRecordId = null;
let browserControlRecordId = null;
let browserControlPoint = null;
let browserControlKind = '';

const cursors = new Map();
const histories = new Map();
const records = new Map();
// Input queues are keyed by pane id, not by the view record. A tab switch can
// dispose and recreate a record while a paste is still being delivered; both
// views must feed the same ordered queue.
const inputPumps = new Map();

const PANE_FONT_KEY = 'townmouse.paneFontSize';

function paneFontOverride() {
  const value = Number(window.localStorage.getItem(PANE_FONT_KEY));
  return value >= 8 && value <= 24 ? value : 0;
}

function adjustPaneFont(delta) {
  const record = activeTerminalRecord();
  const current = paneFontOverride() || (record?.term?.options.fontSize) || 11;
  const next = Math.max(8, Math.min(24, current + delta));
  try { window.localStorage.setItem(PANE_FONT_KEY, String(next)); } catch (_) { /* storage disabled */ }
  for (const candidate of records.values()) {
    if (candidate.kind !== 'terminal' || !candidate.term) continue;
    candidate.term.options.fontSize = next;
    safeFit(candidate);
  }
  showNotice(`Terminal text ${next}px`, 'info', 1800);
}

function inputPumpFor(paneId) {
  let pump = inputPumps.get(paneId);
  if (!pump) {
    pump = { paneId, pendingInput: '', inputTimer: 0, inputBusy: false, inputStopped: false };
    inputPumps.set(paneId, pump);
  }
  return pump;
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

async function uploadAttachment(file) {
  const response = await fetch('/api/attachments', {
    method: 'POST',
    headers: {
      'Content-Type': file.type || 'application/octet-stream',
      'X-Filename': encodeURIComponent(file.name || 'attachment')
    },
    body: file
  });
  let payload = null;
  try { payload = await response.json(); } catch (_) { payload = null; }
  if (!response.ok) throw new Error((payload && payload.error) || `Upload failed (${response.status}).`);
  return payload;
}

async function attachFiles(record, files) {
  if (!record || !files || !files.length) return;
  for (const file of files) {
    try {
      const attachment = await uploadAttachment(file);
      if (record.kind === 'terminal' && record.term) {
        record.term.paste(`${shellQuote(attachment.path)} `);
        showAttachmentNotice(attachment, file);
      } else if (record.kind === 'browser') {
        // Navigate the local browser straight at loopback; a forwarded host is
        // for human-facing links, not the pane's own Chromium.
        await api(`/panes/${record.id}/url`, { method: 'POST', body: { url: attachment.localUrl || attachment.url } });
        record.lastViewport = '';
        requestSnapshot(record, 120);
        showNotice(`Opened ${file.name} in the browser pane`, 'info', 2600);
      }
    } catch (error) {
      showNotice(error.message || `Could not attach ${file.name}.`, 'error');
    }
  }
}

function reorderActivePane(direction) {
  const tab = activeTab();
  if (!tab || tab.panes.length < 2) return;
  const from = tab.panes.findIndex((pane) => pane.id === effectiveActivePaneId(tab));
  const to = Math.max(0, Math.min(tab.panes.length - 1, from + direction));
  if (from < 0 || to === from) return;
  void (async () => {
    try {
      const next = await api(`/tabs/${tab.id}/reorder`, { method: 'POST', body: { paneId: tab.panes[from].id, index: to } });
      if (next && next.tabs) applyState(next, { force: true });
      else await refresh();
      logStatus('Pane reordered.');
    } catch (error) {
      showNotice(error.message || 'Could not reorder the pane.', 'error');
    }
  })();
}

function wirePaneReorder(root, paneId) {
  const header = root.querySelector('.pane-header');
  if (!header) return;
  header.addEventListener('pointerdown', (event) => {
    if (event.target.closest('button, input')) return;
    const startX = event.clientX;
    const startY = event.clientY;
    let dragging = false;
    let target = null;
    const clearTarget = () => {
      if (target) target.classList.remove('drop-target');
      target = null;
    };
    const move = (moveEvent) => {
      if (!dragging && Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) > 8) {
        dragging = true;
        root.classList.add('reordering');
      }
      if (!dragging) return;
      const under = document.elementFromPoint(moveEvent.clientX, moveEvent.clientY)?.closest?.('.pane');
      if (under === target) return;
      clearTarget();
      if (under && under !== root) {
        target = under;
        target.classList.add('drop-target');
      }
    };
    const end = (upEvent) => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', end);
      document.removeEventListener('pointercancel', end);
      root.classList.remove('reordering');
      const drop = target;
      clearTarget();
      if (!dragging || !drop || !currentState) return;
      const tab = activeTab();
      if (!tab) return;
      const from = tab.panes.findIndex((pane) => pane.id === paneId);
      const dropId = drop.dataset.paneId;
      const over = tab.panes.findIndex((pane) => pane.id === dropId);
      if (from < 0 || over < 0 || from === over) return;
      const rect = drop.getBoundingClientRect();
      const after = upEvent.clientX > rect.left + rect.width / 2;
      const index = Math.max(0, Math.min(tab.panes.length - 1, over + (after ? 1 : 0) - (from < over ? 1 : 0)));
      void (async () => {
        try {
          const next = await api(`/tabs/${tab.id}/reorder`, { method: 'POST', body: { paneId, index } });
          if (next && next.tabs) applyState(next, { force: true });
          else await refresh();
        } catch (error) {
          showNotice(error.message || 'Could not reorder the pane.', 'error');
        }
      })();
    };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', end);
    document.addEventListener('pointercancel', end);
  });
}

function wireDrop(root, paneId) {
  const recordFor = () => records.get(paneId);
  const hasFiles = (event) => Array.from(event.dataTransfer?.types || []).includes('Files');
  root.addEventListener('dragover', (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    root.classList.add('drop-target');
  });
  root.addEventListener('dragleave', (event) => {
    if (!root.contains(event.relatedTarget)) root.classList.remove('drop-target');
  });
  root.addEventListener('drop', (event) => {
    if (!event.dataTransfer?.files?.length) return;
    event.preventDefault();
    event.stopPropagation();
    root.classList.remove('drop-target');
    void attachFiles(recordFor(), Array.from(event.dataTransfer.files));
  });
  root.addEventListener('paste', (event) => {
    const files = Array.from(event.clipboardData?.items || [])
      .filter((item) => item.kind === 'file')
      .map((item) => item.getAsFile())
      .filter(Boolean);
    if (!files.length) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    void attachFiles(recordFor(), files);
  }, true);
}

function logStatus(message) {
  els.srStatus.textContent = message;
}

function showNotice(message, kind = 'error', duration = 4200, copyUrl = '') {
  if (!message) return;
  const now = Date.now();
  if (kind === 'error' && message === noticeText && now - noticeAt < 1200) return;
  noticeText = message;
  noticeAt = now;
  els.notice.textContent = message;
  els.notice.dataset.kind = kind;
  if (copyUrl) {
    els.notice.dataset.copyUrl = copyUrl;
    els.notice.title = 'Tap to copy the attachment URL';
  } else {
    delete els.notice.dataset.copyUrl;
    els.notice.removeAttribute('title');
  }
  els.notice.hidden = false;
  clearTimeout(noticeTimer);
  if (duration > 0) {
    noticeTimer = window.setTimeout(() => { els.notice.hidden = true; }, duration);
  }
}

function showAttachmentNotice(attachment, file) {
  // The URL is part of the message, not a filename that disappears. Tapping
  // the notice copies it; agents can get the same URL from `panes attach`.
  showNotice(`Attached ${file.name} · ${attachment.url}`, 'info', 8000, attachment.url);
}

function hideContextMenu() {
  contextRecordId = null;
  browserContextRecordId = null;
  if (els.contextMenu) els.contextMenu.hidden = true;
  if (els.browserContextMenu) els.browserContextMenu.hidden = true;
}

function showBrowserContextMenu(record, clientX, clientY) {
  if (!els.browserContextMenu || !record || record.kind !== 'browser') return;
  hideContextMenu();
  browserContextRecordId = record.id;
  record.suppressClickUntil = Date.now() + 700;
  els.browserContextMenu.hidden = false;
  const rect = els.browserContextMenu.getBoundingClientRect();
  els.browserContextMenu.style.left = `${Math.max(6, Math.min(window.innerWidth - rect.width - 6, clientX))}px`;
  els.browserContextMenu.style.top = `${Math.max(6, Math.min(window.innerHeight - rect.height - 6, clientY))}px`;
  els.browserContextMenu.querySelector('[role="menuitem"]')?.focus();
}

function wireBrowserContext(record) {
  record.image.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    void setActivePane(record.id);
    showBrowserContextMenu(record, event.clientX, event.clientY);
  });
  let timer = 0;
  let startX = 0;
  let startY = 0;
  record.view.addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'mouse') return;
    startX = event.clientX;
    startY = event.clientY;
    clearTimeout(timer);
    timer = window.setTimeout(() => showBrowserContextMenu(record, startX, startY), 550);
  });
  record.view.addEventListener('pointermove', (event) => {
    if (Math.hypot(event.clientX - startX, event.clientY - startY) > 10) clearTimeout(timer);
  });
  for (const type of ['pointerup', 'pointercancel', 'pointerleave']) {
    record.view.addEventListener(type, () => clearTimeout(timer));
  }
}

function showContextMenu(record, clientX, clientY) {
  if (!els.contextMenu || !record || record.kind !== 'terminal') return;
  contextRecordId = record.id;
  els.contextMenu.hidden = false;
  const rect = els.contextMenu.getBoundingClientRect();
  const left = Math.max(6, Math.min(window.innerWidth - rect.width - 6, clientX));
  const top = Math.max(6, Math.min(window.innerHeight - rect.height - 6, clientY));
  els.contextMenu.style.left = `${left}px`;
  els.contextMenu.style.top = `${top}px`;
  els.contextMenu.querySelector('[role="menuitem"]')?.focus();
}

function wirePaneContext(root, record) {
  root.addEventListener('contextmenu', (event) => {
    if (event.target.closest('input, button')) return;
    event.preventDefault();
    void setActivePane(record.id);
    showContextMenu(record, event.clientX, event.clientY);
  });
  const body = root.querySelector('.pane-body');
  if (!body) return;
  let timer = 0;
  let startX = 0;
  let startY = 0;
  body.addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'mouse') return;
    startX = event.clientX;
    startY = event.clientY;
    clearTimeout(timer);
    timer = window.setTimeout(() => showContextMenu(record, startX, startY), 550);
  });
  body.addEventListener('pointermove', (event) => {
    if (Math.hypot(event.clientX - startX, event.clientY - startY) > 10) clearTimeout(timer);
  });
  for (const type of ['pointerup', 'pointercancel', 'pointerleave']) {
    body.addEventListener(type, () => clearTimeout(timer));
  }
}

function hideBrowserControl() {
  browserControlRecordId = null;
  browserControlPoint = null;
  browserControlKind = '';
  if (els.browserControl) els.browserControl.hidden = true;
}

function showBrowserControl(record, control, point) {
  if (!els.browserControl || !record || !control) return;
  browserControlRecordId = record.id;
  browserControlPoint = point;
  browserControlKind = control.kind;
  els.browserControl.hidden = false;
  if (control.kind === 'select') {
    els.browserControlLabel.textContent = 'Choose an option';
    els.browserControlSelect.hidden = false;
    els.browserControlValue.hidden = true;
    els.browserControlSelect.replaceChildren(...(control.options || []).map((option) => {
      const el = document.createElement('option');
      el.value = option.value;
      el.textContent = option.label;
      if (option.value === control.value) el.selected = true;
      return el;
    }));
  } else {
    els.browserControlLabel.textContent = `Choose a ${control.kind} value`;
    els.browserControlSelect.hidden = true;
    els.browserControlValue.hidden = false;
    els.browserControlValue.type = control.kind;
    els.browserControlValue.value = control.value || '';
  }
  els.browserControlSelect.focus();
}

async function applyBrowserControl() {
  const record = records.get(browserControlRecordId);
  if (!record || !browserControlPoint) { hideBrowserControl(); return; }
  const value = browserControlKind === 'select'
    ? els.browserControlSelect.value
    : els.browserControlValue.value;
  const action = browserControlKind === 'select' ? 'selectAt' : 'setValueAt';
  const point = browserControlPoint;
  hideBrowserControl();
  await browserAction(record, action, { ...point, value });
}

function hidePageDialog() {
  pageDialogRecordId = null;
  pageDialogId = null;
  pageDialogType = '';
  if (els.pageDialog) els.pageDialog.hidden = true;
}

function showPageDialog(record, dialog) {
  if (!els.pageDialog || !record || !dialog || !dialog.id) return;
  if (pageDialogId !== dialog.id) {
    pageDialogRecordId = record.id;
    pageDialogId = dialog.id;
    pageDialogType = dialog.type || 'alert';
    els.pageDialogMessage.textContent = `Page ${pageDialogType}: ${dialog.message || ''}`;
    els.pageDialogField.hidden = pageDialogType !== 'prompt';
    els.pageDialogInput.value = dialog.defaultValue || '';
    els.pageDialogAccept.textContent = pageDialogType === 'alert' ? 'OK' : 'Accept';
  }
  els.pageDialog.hidden = false;
}

async function answerPageDialog(action) {
  const record = records.get(pageDialogRecordId);
  if (!record) { hidePageDialog(); return; }
  const body = { action };
  if (action === 'accept' && pageDialogType === 'prompt') body.text = els.pageDialogInput.value;
  try {
    await api(`/panes/${record.id}/browser/dialog`, { method: 'POST', body });
    hidePageDialog();
    requestSnapshot(record, 120);
    logStatus(action === 'accept' ? 'Page dialog accepted.' : 'Page dialog dismissed.');
  } catch (error) {
    showNotice(error.message || 'Could not answer the page dialog.', 'error');
  }
}

async function api(path, { method = 'GET', body } = {}) {
  const headers = { 'X-Townmouse-Token': token };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(API_ROOT + path, {
    method,
    headers,
    cache: 'no-store',
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  let payload = null;
  try { payload = await response.json(); } catch (_) { payload = null; }
  if (!response.ok) {
    throw new Error((payload && payload.error) || `Request failed (${response.status}).`);
  }
  return payload;
}

function activeTab(state = currentState) {
  if (!state || !Array.isArray(state.tabs)) return null;
  return state.tabs.find((tab) => tab.id === state.activeTabId) || state.tabs[0] || null;
}

function effectiveActivePaneId(tab = activeTab()) {
  if (!tab || !tab.panes.length) return null;
  const candidate = currentState && currentState.activePaneId;
  return tab.panes.some((pane) => pane.id === candidate) ? candidate : tab.panes[0].id;
}

function paneTitle(pane, index) {
  const title = String(pane.title || '').trim();
  if (title) return title;
  if (pane.kind === 'browser') {
    if (pane.url && pane.url !== 'about:blank') return pane.url;
    return 'Browser';
  }
  return `Terminal ${index + 1}`;
}

// ─── Terminal key bar ──────────────────────────────────────────────────────
// Phones have no Esc/Tab/Ctrl/arrow keys. Emit the same xterm sequences as the
// main terminal directly through the pane input queue, independent of focus.

const PANE_SEQ = {
  esc: '\x1b', tab: '\t',
  up: '\x1b[A', down: '\x1b[B', right: '\x1b[C', left: '\x1b[D',
  home: '\x1b[H', end: '\x1b[F', pgup: '\x1b[5~', pgdn: '\x1b[6~'
};
const paneMods = { ctrl: false, alt: false };

function activeTerminalRecord() {
  const record = records.get(effectiveActivePaneId());
  return record && record.kind === 'terminal' && !record.disposed ? record : null;
}

async function refreshReaderView() {
  const paneId = effectiveActivePaneId();
  const record = records.get(paneId);
  if (!els.readerText) return;
  if (!record) {
    els.readerText.textContent = 'No active pane.';
    return;
  }
  if (record.kind === 'browser') {
    els.readerText.textContent = 'Reading page text…';
    try {
      const page = await api(`/panes/${paneId}/browser/content`);
      els.readerText.textContent = String(page.text || '').trim() || 'This page has no readable text.';
    } catch (error) {
      els.readerText.textContent = error.message || 'Could not read the page.';
    }
    els.readerText.scrollTop = 0;
    return;
  }
  if (!record.term) {
    els.readerText.textContent = 'No active terminal.';
    return;
  }
  const buffer = record.term.buffer.active;
  const lines = [];
  for (let i = 0; i < buffer.length; i++) {
    const line = buffer.getLine(i);
    lines.push(line ? line.translateToString(true) : '');
  }
  while (lines.length && !lines[0].trim()) lines.shift();
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  els.readerText.textContent = lines.join('\n') || 'No terminal text yet.';
  els.readerText.scrollTop = 0;
}

function openReaderView() {
  if (!els.readerView) return;
  closeSheets();
  els.readerView.hidden = false;
  void refreshReaderView();
  els.readerClose.focus();
}

function closeReaderView() {
  if (!els.readerView) return;
  els.readerView.hidden = true;
  const record = activeTerminalRecord();
  if (record && record.term) record.term.focus();
}

function syncPaneMods() {
  if (!els.keybar) return;
  els.keybar.querySelectorAll('.pane-key.toggle[data-mod]').forEach((button) => {
    const active = Boolean(paneMods[button.dataset.mod]);
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
}

function clearPaneMods() {
  paneMods.ctrl = false;
  paneMods.alt = false;
  syncPaneMods();
}

function emitPaneSequence(sequence) {
  const record = activeTerminalRecord();
  if (!record) return;
  sendTerminalInput(record, sequence);
  clearPaneMods();
  if (record.term) record.term.focus();
}

function emitPaneLiteral(character) {
  const record = activeTerminalRecord();
  if (!record) return;
  let output = character;
  if (paneMods.ctrl && output.length === 1) output = String.fromCharCode(output.charCodeAt(0) & 0x1f);
  if (paneMods.alt && output.length === 1) output = '\x1b' + output;
  sendTerminalInput(record, output);
  clearPaneMods();
  if (record.term) record.term.focus();
}

function makePaneKey(label, options = {}) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'pane-key';
  button.textContent = label;
  if (options.title) button.title = options.title;
  if (options.key) button.dataset.key = options.key;
  if (options.toggle) {
    button.classList.add('toggle');
    button.dataset.mod = options.toggle;
    button.setAttribute('aria-pressed', 'false');
    button.addEventListener('click', () => {
      paneMods[options.toggle] = !paneMods[options.toggle];
      Object.keys(paneMods).forEach((name) => {
        if (name !== options.toggle) paneMods[name] = false;
      });
      syncPaneMods();
    });
  } else if (options.sequence) {
    button.addEventListener('click', () => emitPaneSequence(options.sequence));
  } else if (options.literal) {
    button.addEventListener('click', () => emitPaneLiteral(options.literal));
  }
  return button;
}

let keybarKind = '';

function makeBrowserKey(label, key, title) {
  const button = makePaneKey(label, { title });
  button.addEventListener('click', () => {
    const record = records.get(effectiveActivePaneId());
    if (record && record.kind === 'browser') void browserAction(record, 'key', { key });
  });
  return button;
}

function buildPaneKeybar(kind = 'terminal') {
  if (!els.keybar || keybarKind === kind) return;
  keybarKind = kind;
  const keys = kind === 'browser'
    ? [
      makeBrowserKey('ENTER', 'Enter', 'Enter'),
      makeBrowserKey('TAB', 'Tab', 'Tab'),
      makeBrowserKey('ESC', 'Escape', 'Escape'),
      makeBrowserKey('←', 'ArrowLeft', 'Left'),
      makeBrowserKey('↑', 'ArrowUp', 'Up'),
      makeBrowserKey('↓', 'ArrowDown', 'Down'),
      makeBrowserKey('→', 'ArrowRight', 'Right'),
      makeBrowserKey('⌫', 'Backspace', 'Backspace')
    ]
    : [
      makePaneKey('ESC', { sequence: PANE_SEQ.esc, title: 'Escape' }),
      makePaneKey('TAB', { sequence: PANE_SEQ.tab, title: 'Tab' }),
      makePaneKey('CTRL', { toggle: 'ctrl', title: 'Ctrl (sticky)' }),
      makePaneKey('ALT', { toggle: 'alt', title: 'Alt (sticky)' }),
      makePaneKey('C', { literal: 'c', key: 'c', title: 'C; with CTRL active sends Ctrl+C' }),
      makePaneKey('←', { sequence: PANE_SEQ.left, title: 'Left' }),
      makePaneKey('↑', { sequence: PANE_SEQ.up, title: 'Up' }),
      makePaneKey('↓', { sequence: PANE_SEQ.down, title: 'Down' }),
      makePaneKey('→', { sequence: PANE_SEQ.right, title: 'Right' }),
      makePaneKey('HOME', { sequence: PANE_SEQ.home, title: 'Home' }),
      makePaneKey('END', { sequence: PANE_SEQ.end, title: 'End' }),
      makePaneKey('PGUP', { sequence: PANE_SEQ.pgup, title: 'Page Up' }),
      makePaneKey('PGDN', { sequence: PANE_SEQ.pgdn, title: 'Page Down' })
    ];
  els.keybar.replaceChildren(...keys);
}

function updateKeybar() {
  if (!els.keybar) return;
  const record = activeTerminalRecord();
  const active = records.get(effectiveActivePaneId());
  if (active && active.kind === 'browser') {
    buildPaneKeybar('browser');
    els.keybar.hidden = false;
  } else if (record) {
    buildPaneKeybar('terminal');
    els.keybar.hidden = false;
  } else {
    els.keybar.hidden = true;
  }
  if (els.menuReader) els.menuReader.disabled = !active;
  if (els.menuFontUp) els.menuFontUp.disabled = !record;
  if (els.menuFontDown) els.menuFontDown.disabled = !record;
}

function paneCountLabel(count) {
  return `${count} ${count === 1 ? 'pane' : 'panes'}`;
}

async function refresh() {
  if (!token) return currentState;
  if (refreshInFlight) {
    try { await refreshInFlight; } catch (_) { /* previous refresh already reported */ }
  }
  const work = (async () => {
    try {
      const next = await api('/state');
      applyState(next);
      return next;
    } catch (error) {
      showNotice(error.message || 'Workspace refresh failed.', 'error');
      return currentState;
    }
  })();
  refreshInFlight = work;
  try {
    return await work;
  } finally {
    if (refreshInFlight === work) refreshInFlight = null;
  }
}

function applyState(next, { force = false } = {}) {
  if (!next || !Array.isArray(next.tabs)) return;
  const previousTabId = currentState && currentState.activeTabId;
  currentState = next;
  updateChrome();
  const tab = activeTab();
  const signature = tab
    ? `${tab.id}|${tab.panes.map((pane) => `${pane.id}:${pane.kind}`).join(',')}`
    : 'none';
  if (force || signature !== lastSignature) {
    lastSignature = signature;
    rebuild(tab);
    if (!navigator.maxTouchPoints && tab) {
      requestAnimationFrame(() => focusPaneById(effectiveActivePaneId(tab), 'terminal'));
    }
  } else {
    updatePaneChrome(tab);
  }
  prunePaneMemory();
  if (els.tabsDialog.open) renderTabsDialog();
  if (tab) document.title = `${tab.title} — Panes`;
  else document.title = 'Panes — Townmouse';
  if (previousTabId && tab && previousTabId !== tab.id) logStatus(`Switched to ${tab.title}.`);
}

function updateChrome() {
  const tabs = (currentState && currentState.tabs) || [];
  els.tabCount.textContent = String(tabs.length);
  els.tabsButton.setAttribute('aria-label', tabs.length === 1 ? 'Workspace tabs, 1 tab' : `Workspace tabs, ${tabs.length} tabs`);
  updateHostContext();
  const limits = currentState && currentState.limits;
  if (limits) {
    els.tabsLimits.textContent = `Up to ${limits.maxTabs} tabs, ${limits.maxPanesPerTab} panes per tab.`;
  }
  updateAddLimits();
  renderTabStrip();
}

function renderTabStrip() {
  if (!els.tabStrip) return;
  const tabs = (currentState && currentState.tabs) || [];
  els.tabStrip.hidden = tabs.length < 2;
  if (tabs.length < 2) { els.tabStrip.replaceChildren(); return; }
  const list = document.createElement('div');
  list.className = 'tabstrip-tabs';
  list.setAttribute('role', 'tablist');
  list.setAttribute('aria-label', 'Workspace tabs');
  for (const tab of tabs) {
    const active = tab.id === currentState.activeTabId;
    const item = document.createElement('div');
    item.className = 'tabstrip-item' + (active ? ' is-active' : '');
    item.dataset.createdBy = tab.createdBy || 'human';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'tabstrip-tab' + (active ? ' is-active' : '') + (tab.createdBy === 'agent' ? ' agent-tab' : '');
    button.textContent = tab.title;
    if (tab.createdBy === 'agent') button.title = `${tab.title} — created by an agent`;
    button.setAttribute('role', 'tab');
    button.setAttribute('aria-selected', active ? 'true' : 'false');
    button.setAttribute('aria-controls', 'pane-grid');
    button.tabIndex = active ? 0 : -1;
    button.addEventListener('click', () => { void activateTab(tab.id); });
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'tabstrip-close';
    close.textContent = '×';
    close.setAttribute('aria-label', `Close tab ${tab.title}`);
    close.addEventListener('click', (event) => {
      event.stopPropagation();
      requestClose('tab', tab.id, tab.title);
    });
    item.append(button, close);
    list.append(item);
  }
  list.addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const buttons = [...list.querySelectorAll('[role="tab"]')];
    const index = buttons.indexOf(document.activeElement);
    if (index < 0) return;
    event.preventDefault();
    const next = event.key === 'Home' ? 0
      : event.key === 'End' ? buttons.length - 1
        : (index + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length;
    buttons[next].focus();
    const tab = tabs[next];
    if (tab) void activateTab(tab.id);
  });
  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'tabstrip-add';
  add.textContent = '+ Tab';
  add.setAttribute('aria-label', 'New workspace tab');
  add.addEventListener('click', () => { void newTab(); });
  els.tabStrip.replaceChildren(list, add);
}

const LAYOUT_PREFIX = 'townmouse.pane-layout.';

function readPaneLayout(tabId) {
  try {
    const saved = JSON.parse(window.localStorage.getItem(LAYOUT_PREFIX + tabId) || '{}');
    return {
      x: Math.max(0.2, Math.min(0.8, Number(saved.x) || 0.5)),
      y: Math.max(0.2, Math.min(0.8, Number(saved.y) || 0.5))
    };
  } catch (_) {
    return { x: 0.5, y: 0.5 };
  }
}

function savePaneLayout(tabId, layout) {
  try {
    window.localStorage.setItem(LAYOUT_PREFIX + tabId, JSON.stringify(layout));
  } catch (_) { /* storage may be disabled */ }
}

function applyPaneLayout(tab) {
  if (!els.grid || !currentState) return;
  const panes = tab ? tab.panes : [];
  els.grid.querySelectorAll('.pane-splitter').forEach((splitter) => splitter.remove());
  els.grid.style.gridTemplateColumns = '';
  els.grid.style.gridTemplateRows = '';
  els.grid.style.gap = '';
  for (const record of records.values()) record.root.style.gridArea = '';
  if (!tab || panes.length < 2 || window.matchMedia('(max-width: 600px)').matches) return;

  const count = panes.length;
  const layout = readPaneLayout(tab.id);
  const setTemplates = () => {
    els.grid.style.gridTemplateColumns = `calc((100% - 6px) * ${layout.x}) 6px minmax(0, 1fr)`;
    els.grid.style.gridTemplateRows = count === 2
      ? 'minmax(0, 1fr)'
      : `calc((100% - 6px) * ${layout.y}) 6px minmax(0, 1fr)`;
    els.grid.style.gap = '0';
    els.grid.querySelectorAll('.pane-splitter').forEach((splitter) => {
      splitter.setAttribute('aria-valuenow', String(Math.round((splitter.classList.contains('vertical') ? layout.x : layout.y) * 100)));
    });
  };
  const areas = count === 2
    ? ['1 / 1 / 2 / 2', '1 / 3 / 2 / 4']
    : count === 3
      ? ['1 / 1 / 2 / 4', '3 / 1 / 4 / 2', '3 / 3 / 4 / 4']
      : ['1 / 1 / 2 / 2', '1 / 3 / 2 / 4', '3 / 1 / 4 / 2', '3 / 3 / 4 / 4'];
  panes.forEach((pane, index) => {
    const record = records.get(pane.id);
    if (record && areas[index]) record.root.style.gridArea = areas[index];
  });

  function makeSplitter(orientation, area) {
    const splitter = document.createElement('div');
    splitter.className = `pane-splitter ${orientation}`;
    splitter.style.gridArea = area;
    splitter.tabIndex = 0;
    splitter.setAttribute('role', 'separator');
    splitter.setAttribute('aria-orientation', orientation === 'vertical' ? 'vertical' : 'horizontal');
    splitter.setAttribute('aria-label', orientation === 'vertical' ? 'Resize pane columns' : 'Resize pane rows');
    splitter.setAttribute('aria-valuemin', '20');
    splitter.setAttribute('aria-valuemax', '80');
    splitter.setAttribute('aria-valuenow', String(Math.round((orientation === 'vertical' ? layout.x : layout.y) * 100)));
    const value = () => orientation === 'vertical' ? layout.x : layout.y;
    const apply = (clientX, clientY) => {
      const rect = els.grid.getBoundingClientRect();
      const ratio = orientation === 'vertical'
        ? (clientX - rect.left) / rect.width
        : (clientY - rect.top) / rect.height;
      const clamped = Math.max(0.2, Math.min(0.8, ratio));
      if (orientation === 'vertical') layout.x = clamped;
      else layout.y = clamped;
      setTemplates();
      savePaneLayout(tab.id, layout);
    };
    splitter.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      splitter.setPointerCapture?.(event.pointerId);
      splitter.classList.add('dragging');
      const move = (moveEvent) => apply(moveEvent.clientX, moveEvent.clientY);
      const end = () => {
        splitter.classList.remove('dragging');
        splitter.removeEventListener('pointermove', move);
      };
      splitter.addEventListener('pointermove', move);
      splitter.addEventListener('pointerup', end, { once: true });
      splitter.addEventListener('pointercancel', end, { once: true });
    });
    splitter.addEventListener('dblclick', () => {
      layout.x = 0.5;
      layout.y = 0.5;
      setTemplates();
      savePaneLayout(tab.id, layout);
    });
    splitter.addEventListener('keydown', (event) => {
      const step = event.shiftKey ? 0.1 : 0.02;
      let next = value();
      if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next -= step;
      else if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next += step;
      else if (event.key === 'Home') next = 0.2;
      else if (event.key === 'End') next = 0.8;
      else return;
      event.preventDefault();
      next = Math.max(0.2, Math.min(0.8, next));
      if (orientation === 'vertical') layout.x = next;
      else layout.y = next;
      setTemplates();
      savePaneLayout(tab.id, layout);
    });
    return splitter;
  }

  const splitters = [];
  if (count === 2) {
    splitters.push(makeSplitter('vertical', '1 / 2 / 2 / 3'));
  } else if (count === 3) {
    splitters.push(makeSplitter('horizontal', '2 / 1 / 3 / 4'));
    splitters.push(makeSplitter('vertical', '3 / 2 / 4 / 3'));
  } else {
    splitters.push(makeSplitter('vertical', '1 / 2 / 2 / 3'));
    splitters.push(makeSplitter('horizontal', '2 / 1 / 3 / 4'));
    splitters.push(makeSplitter('vertical', '3 / 2 / 4 / 3'));
  }
  els.grid.append(...splitters);
  setTemplates();
}

function rebuild(tab) {
  const nextTabId = tab ? tab.id : null;
  const panes = tab ? tab.panes : [];
  const nextIds = new Set(panes.map((pane) => pane.id));

  if (nextTabId !== currentTabId) {
    // A tab switch is the one time terminals are discarded outright; their
    // cursors and local scrollback survive in the maps below.
    teardownPanes();
    els.grid.replaceChildren();
    currentTabId = nextTabId;
  } else {
    for (const [id, record] of [...records]) {
      const pane = panes.find((candidate) => candidate.id === id);
      if (!pane || pane.kind !== record.kind) {
        disposeRecord(record);
        records.delete(id);
        record.root.remove();
      }
    }
  }

  const count = panes.length;
  els.grid.dataset.count = String(count);
  if (!tab || count === 0) {
    els.grid.hidden = true;
    els.emptyState.hidden = false;
    updateEmptyState(tab);
    return;
  }
  els.grid.hidden = false;
  els.emptyState.hidden = true;
  for (const pane of panes) {
    const existing = records.get(pane.id);
    const node = existing
      ? existing.root
      : (pane.kind === 'browser' ? createBrowserPane(pane) : createTerminalPane(pane));
    // Appending an existing node only reorders it; its xterm DOM lives on.
    els.grid.append(node);
  }
  updatePaneChrome(tab);
  applyPaneLayout(tab);
}

function updateEmptyState(tab) {
  if (!tab) {
    els.emptyTitle.textContent = 'No workspace tabs';
    els.emptyCopy.textContent = 'Create a tab to open terminals and browsers.';
  } else if (!tab.panes.length) {
    els.emptyTitle.textContent = 'This tab is empty';
    els.emptyCopy.textContent = `${tab.title} has no panes yet. Add a terminal or a browser.`;
  }
  els.emptyActions.hidden = false;
}

function updatePaneChrome(tab) {
  if (!tab) { updateBackButton(); updateKeybar(); updateHostContext(); return; }
  const activeId = effectiveActivePaneId(tab);
  tab.panes.forEach((pane, index) => {
    const record = records.get(pane.id);
    if (!record) return;
    record.root.classList.toggle('is-active', pane.id === activeId);
    const title = paneTitle(pane, index);
    if (record.titleEl.textContent !== title) record.titleEl.textContent = title;
    record.titleEl.title = title;
    record.closeButton.setAttribute('aria-label', `Close ${pane.kind} pane ${title}`);
    if (record.kind === 'terminal') {
      const status = pane.status === 'exited' ? 'exited' : 'running';
      if (record.root.dataset.status !== status) record.root.dataset.status = status;
      const agentState = pane.agentState || '';
      record.root.dataset.agentState = agentState;
      const kindText = status === 'exited'
        ? 'Terminal · exited'
        : agentState ? `Terminal · ${agentState}` : 'Terminal';
      if (record.kindEl.textContent !== kindText) record.kindEl.textContent = kindText;
    } else {
      if (record.kindEl.textContent !== 'Browser') record.kindEl.textContent = 'Browser';
      if (pane.url && !record.addressDirty && document.activeElement !== record.addressInput && record.addressInput.value !== pane.url) {
        record.addressInput.value = pane.url;
      }
      record.currentUrl = pane.url || record.currentUrl;
    }
  });
  if (pageDialogRecordId && !records.has(pageDialogRecordId)) hidePageDialog();
  updateKeybar();
  updateBackButton();
}

function updateActiveClasses() {
  const tab = activeTab();
  const activeId = effectiveActivePaneId(tab);
  for (const [id, record] of records) {
    record.root.classList.toggle('is-active', id === activeId);
  }
  const active = records.get(activeId);
  if (active && active.kind === 'browser') {
    requestAnimationFrame(() => {
      if (!active.disposed) active.resizeBrowser?.();
    });
  }
  updateKeybar();
  updateHostContext();
  updateBackButton();
}

function updateHostContext() {
  if (!els.hostName) return;
  const tab = activeTab();
  const host = currentState?.host || 'localhost';
  const narrow = window.matchMedia('(max-width: 699px)').matches;
  els.hostName.textContent = narrow && tab ? tab.title : host;
  if (els.hostPill) els.hostPill.title = narrow ? `Active tab: ${tab ? tab.title : 'none'} · ${host}` : host;
}

function updateBackButton() {
  const record = records.get(effectiveActivePaneId());
  const enabled = Boolean(record && record.kind === 'browser' && record.canGoBack);
  els.backButton.disabled = !enabled;
  els.backButton.setAttribute('aria-label', enabled ? `Back in ${record.titleEl.textContent || 'browser'}` : 'Back');
}

function prunePaneMemory() {
  if (!currentState) return;
  const live = new Set();
  for (const tab of currentState.tabs) for (const pane of tab.panes) live.add(pane.id);
  for (const id of cursors.keys()) {
    if (!live.has(id)) { cursors.delete(id); histories.delete(id); }
  }
}

async function setActivePane(paneId) {
  if (!paneId || !currentState) return;
  if (currentState.activePaneId === paneId) { updateActiveClasses(); return; }
  currentState = { ...currentState, activePaneId: paneId };
  updateActiveClasses();
  try {
    const next = await api('/active', { method: 'POST', body: { paneId } });
    applyState(next);
  } catch (error) {
    showNotice(error.message || 'Could not select the pane.', 'error');
  }
}

function onPanePointerDown(event) {
  if (event.target.closest('button')) return;
  const paneId = event.currentTarget.dataset.paneId;
  if (paneId) void setActivePane(paneId);
}

function teardownPanes() {
  // Switching tabs disposes the terminal view but not the server-side shell.
  // Let already-queued input (an editor paste, a command plus Enter) finish
  // instead of silently truncating it when the user changes views.
  for (const record of records.values()) disposeRecord(record, { keepInput: true });
  records.clear();
}

function disposeRecord(record, { keepInput = false } = {}) {
  if (!record || record.disposed) return;
  record.disposed = true;
  if (record.readTimer) { clearTimeout(record.readTimer); record.readTimer = 0; }
  if (record.streamController) {
    try { record.streamController.abort(); } catch (_) { /* already ended */ }
    record.streamController = null;
  }
  const pump = record.kind === 'terminal' ? inputPumpFor(record.id) : null;
  if (keepInput && pump) {
    // No timer and no request in flight means nothing would deliver what is
    // already queued; restart the flush before dropping the view.
    if (pump.pendingInput && !pump.inputBusy && !pump.inputTimer) {
      pump.inputTimer = window.setTimeout(() => {
        pump.inputTimer = 0;
        void flushTerminalInput(pump);
      }, 12);
    }
  } else if (pump) {
    pump.inputStopped = true;
    pump.pendingInput = '';
    if (pump.inputTimer) { clearTimeout(pump.inputTimer); pump.inputTimer = 0; }
    inputPumps.delete(record.id);
  }
  if (record.snapshotTimer) { clearTimeout(record.snapshotTimer); record.snapshotTimer = 0; }
  if (record.wheelTimer) { clearTimeout(record.wheelTimer); record.wheelTimer = 0; }
  if (record.fitFrame) { cancelAnimationFrame(record.fitFrame); record.fitFrame = 0; }
  if (record.resizeObserver) {
    try { record.resizeObserver.disconnect(); } catch (_) { /* already detached */ }
    record.resizeObserver = null;
  }
  if (record.resizeTimer) { clearTimeout(record.resizeTimer); record.resizeTimer = 0; }
  if (record.term) {
    try { record.term.dispose(); } catch (_) { /* already disposed */ }
    record.term = null;
  }
}

function createTerminalPane(pane) {
  const root = document.createElement('section');
  root.className = 'pane pane-terminal';
  root.dataset.paneId = pane.id;
  root.dataset.kind = 'terminal';
  root.dataset.createdBy = pane.createdBy || 'human';
  root.dataset.status = pane.status === 'exited' ? 'exited' : 'running';
  root.innerHTML =
    '<header class="pane-header">' +
      '<span class="pane-title"></span>' +
      '<span class="pane-kind">Terminal</span>' +
      `<button type="button" class="pane-close" aria-label="Close terminal pane">${CLOSE_ICON}</button>` +
    '</header>' +
    '<div class="pane-body"><div class="terminal-host"></div></div>';

  const record = {
    id: pane.id,
    kind: 'terminal',
    root,
    titleEl: root.querySelector('.pane-title'),
    kindEl: root.querySelector('.pane-kind'),
    closeButton: root.querySelector('.pane-close'),
    host: root.querySelector('.terminal-host'),
    term: null,
    fit: null,
    resizeObserver: null,
    fitFrame: 0,
    readTimer: 0,
    pendingInput: '',
    inputTimer: 0,
    inputBusy: false,
    inputStopped: false,
    streamController: null,
    offset: cursors.get(pane.id) || 0,
    lastResize: '',
    exited: false,
    pendingStart: pane.status === 'starting',
    starting: false,
    disposed: false
  };
  record.titleEl.textContent = pane.title || 'Terminal';
  record.closeButton.setAttribute('aria-label', `Close terminal pane ${pane.title || 'Terminal'}`);
  root.addEventListener('pointerdown', onPanePointerDown);
  root.addEventListener('focusin', () => { void setActivePane(pane.id); });
  record.closeButton.addEventListener('click', () => { requestClose('pane', pane.id, record.titleEl.textContent); });
  records.set(pane.id, record);
  wireDrop(root, pane.id);
  wirePaneReorder(root, pane.id);
  wirePaneContext(root, record);
  requestAnimationFrame(() => {
    if (!record.disposed && root.isConnected) mountTerminal(record);
  });
  return root;
}

function mountTerminal(record) {
  if (record.term || record.disposed || !record.host.isConnected) return;
  const term = new Terminal({
    cursorBlink: !reducedMotion.matches,
    cursorStyle: 'bar',
    cursorWidth: 2,
    fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
    fontSize: 13,
    lineHeight: 1.15,
    letterSpacing: 0,
    scrollback: 5000,
    convertEol: false,
    allowTransparency: false,
    theme: TERMINAL_THEME
  });
  const fit = new FitAddon();
  term.loadAddon(fit);
  term.loadAddon(new WebLinksAddon());
  try {
    term.open(record.host);
    // OSC 52 clipboard writes: agents and shell tools can copy without a
    // synthetic keystroke. Reads are deliberately not supported.
    term.parser.registerOscHandler(52, (data) => {
      const payload = String(data).split(';')[1] || '';
      if (payload && payload !== '?') {
        try {
          const text = atob(payload);
          if (text) navigator.clipboard?.writeText(text).catch(() => {});
        } catch (_) { /* malformed clipboard payload */ }
      }
      return true;
    });
  } catch (error) {
    showNotice('The terminal could not be opened.', 'error');
    try { term.dispose(); } catch (_) { /* nothing to release */ }
    return;
  }
  record.term = term;
  record.fit = fit;
  // Terminal copy: Cmd/Ctrl+C with a selection copies; with no selection it
  // still reaches the PTY as SIGINT, matching terminal expectations.
  term.attachCustomKeyEventHandler((event) => {
    const platform = navigator.userAgentData?.platform || navigator.platform || '';
    const copyChord = /mac|iphone|ipad/i.test(platform)
      ? event.metaKey && !event.ctrlKey
      : event.ctrlKey && event.shiftKey;
    // Bare Ctrl+C must always interrupt the foreground process, even when
    // text is selected. Swallowing it for copy is a terminal cardinal sin.
    if (!copyChord || event.key.toLowerCase() !== 'c' || !term.hasSelection()) return true;
    try { navigator.clipboard?.writeText(term.getSelection()); } catch (_) { /* clipboard denied */ }
    return false;
  });
  term.onData((data) => {
    if (!record.disposed && data) sendTerminalInput(record, data);
  });
  term.onResize(({ cols, rows }) => {
    if (!record.disposed) sendTerminalResize(record, cols, rows);
  });
  const history = histories.get(record.id);
  requestAnimationFrame(() => {
    if (record.disposed || !record.term) return;
    // Fit before replaying or spawning: the first prompt and the local history
    // must be laid out at the pane's real width, not xterm's default grid.
    safeFit(record);
    if (history) term.write(history);
    if (record.pendingStart) {
      void startPendingTerminal(record);
    } else {
      void startTerminalStream(record);
      sendTerminalResize(record, record.term.cols, record.term.rows);
    }
  });
  const applyFontSize = () => {
    if (record.disposed || !record.term) return;
    const width = record.host.getBoundingClientRect().width;
    const override = paneFontOverride();
    const size = override || (width >= 560 ? 13 : width >= 430 ? 12 : width >= 320 ? 11 : 10);
    if (record.term.options.fontSize !== size) {
      record.term.options.fontSize = size;
      safeFit(record);
    }
  };
  applyFontSize();
  record.resizeObserver = new ResizeObserver(() => {
    if (record.disposed) return;
    if (record.fitFrame) cancelAnimationFrame(record.fitFrame);
    record.fitFrame = requestAnimationFrame(() => {
      record.fitFrame = 0;
      applyFontSize();
      safeFit(record);
    });
  });
  record.resizeObserver.observe(record.host);
}

async function startPendingTerminal(record) {
  if (!record || record.disposed || record.starting || !record.term) return;
  record.starting = true;
  try {
    await api(`/panes/${record.id}/start`, {
      method: 'POST',
      body: { cols: record.term.cols, rows: record.term.rows }
    });
    if (record.disposed) return;
    record.pendingStart = false;
    void startTerminalStream(record);
  } catch (error) {
    if (!record.disposed) {
      showNotice(error.message || 'The terminal could not start.', 'error');
      void startTerminalStream(record);
    }
  } finally {
    record.starting = false;
  }
}

function safeFit(record) {
  if (record.disposed || !record.fit || !record.term) return;
  const rect = record.host.getBoundingClientRect();
  if (rect.width < 24 || rect.height < 24) return;
  try { record.fit.fit(); } catch (_) { /* layout not ready yet */ }
}

function sendTerminalResize(record, cols, rows) {
  const next = `${cols}x${rows}`;
  if (record.lastResize === next) return;
  record.lastResize = next;
  api(`/panes/${record.id}/resize`, { method: 'POST', body: { cols, rows } }).catch(() => {
    record.lastResize = '';
  });
}

function sendTerminalInput(record, data) {
  const pump = inputPumpFor(record.id);
  if (pump.inputStopped || !data) return;
  // Coalesce fast typing and pastes into one ordered request instead of one
  // HTTP round-trip per keystroke. This is the difference between smooth and
  // jittery input when the agent or a build is also producing output.
  pump.pendingInput += data;
  if (pump.inputTimer || pump.inputBusy) return;
  pump.inputTimer = window.setTimeout(() => {
    pump.inputTimer = 0;
    void flushTerminalInput(pump);
  }, 12);
}

async function flushTerminalInput(pump) {
  if (pump.inputStopped || pump.inputBusy || !pump.pendingInput) return;
  const payload = pump.pendingInput;
  pump.pendingInput = '';
  pump.inputBusy = true;
  try {
    // Keep each request below the global JSON body limit so large pastes work.
    for (const chunk of chunkInput(payload)) {
      if (pump.inputStopped) break;
      await api(`/panes/${pump.paneId}/input`, { method: 'POST', body: { data: chunk } });
    }
  } catch (error) {
    if (!pump.inputStopped) logStatus('Terminal input could not be sent.');
  } finally {
    pump.inputBusy = false;
    if (!pump.inputStopped && pump.pendingInput) {
      pump.inputTimer = window.setTimeout(() => {
        pump.inputTimer = 0;
        void flushTerminalInput(pump);
      }, 12);
    }
  }
}

async function startTerminalStream(record) {
  if (record.disposed || !record.term) return;
  if (record.streamController) {
    try { record.streamController.abort(); } catch (_) { /* already ended */ }
  }
  const controller = new AbortController();
  record.streamController = controller;
  try {
    const response = await fetch(`/api/panes/panes/${record.id}/stream?since=${record.offset || 0}`, {
      headers: { 'X-Townmouse-Token': token },
      signal: controller.signal,
      cache: 'no-store'
    });
    if (!response.ok || !response.body) throw new Error(`Output stream failed (${response.status}).`);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (!record.disposed) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let boundary;
      while ((boundary = buffer.indexOf('\n\n')) >= 0) {
        const event = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const line = event.split('\n').find((entry) => entry.startsWith('data: '));
        if (!line) continue;
        let payload = null;
        try { payload = JSON.parse(line.slice(6)); } catch (_) { continue; }
        if (!record.term || record.disposed) continue;
        if (payload.data) {
          record.term.write(payload.data);
          rememberOutput(record.id, payload.data);
        }
        if (Number.isFinite(Number(payload.offset))) {
          record.offset = Number(payload.offset);
          cursors.set(record.id, record.offset);
        }
        if (payload.exited && !record.exited) markTerminalExited(record);
      }
    }
  } catch (error) {
    if (record.disposed || controller.signal.aborted) return;
  }
  // A dropped stream is not a dead terminal: fall back to polling.
  if (!record.disposed) startTerminalRead(record);
}

function startTerminalRead(record) {
  if (record.readTimer) { clearTimeout(record.readTimer); record.readTimer = 0; }
  const poll = async () => {
    if (record.disposed) return;
    try {
      const payload = await api(`/panes/${record.id}/read?since=${record.offset || 0}`);
      if (record.disposed || !record.term) return;
      if (payload && payload.data) {
        record.term.write(payload.data);
        rememberOutput(record.id, payload.data);
      }
      const nextOffset = Number(payload && payload.offset);
      if (Number.isFinite(nextOffset)) {
        record.offset = nextOffset;
        cursors.set(record.id, nextOffset);
      }
      if (payload && payload.exited && !record.exited) markTerminalExited(record);
    } catch (error) {
      // A missed read is retried; the workspace poll reports connection loss.
    } finally {
      if (!record.disposed && !record.exited) {
        record.readTimer = window.setTimeout(poll, READ_POLL_MS);
      }
    }
  };
  poll();
}

function markTerminalExited(record) {
  if (record.exited) return;
  record.exited = true;
  record.root.dataset.status = 'exited';
  record.kindEl.textContent = 'Terminal · exited';
  const marker = '\r\n\x1b[38;5;244m[process exited]\x1b[0m\r\n';
  if (record.term) record.term.write(marker);
  rememberOutput(record.id, '\r\n[process exited]\r\n');
  logStatus(`${record.titleEl.textContent} exited.`);
}

function rememberOutput(paneId, data) {
  const value = (histories.get(paneId) || '') + data;
  histories.set(paneId, value.length > MAX_HISTORY ? value.slice(-MAX_HISTORY) : value);
}

function createBrowserPane(pane) {
  const root = document.createElement('section');
  root.className = 'pane pane-browser';
  root.dataset.paneId = pane.id;
  root.dataset.kind = 'browser';
  root.dataset.createdBy = pane.createdBy || 'human';
  root.innerHTML =
    '<header class="pane-header">' +
      '<span class="pane-title"></span>' +
      '<span class="pane-kind">Browser</span>' +
      `<button type="button" class="pane-close" aria-label="Close browser pane">${CLOSE_ICON}</button>` +
    '</header>' +
    '<div class="pane-body">' +
      '<div class="browser-toolbar">' +
        `<button type="button" class="browser-icon-button browser-back" aria-label="Back">${BACK_ICON}</button>` +
        '<button type="button" class="browser-icon-button browser-forward" aria-label="Forward"><svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg></button>' +
        `<button type="button" class="browser-icon-button browser-reload" aria-label="Reload">${RELOAD_ICON}</button>` +
        '<form class="address-form" novalidate>' +
          '<input class="address-input" type="text" inputmode="url" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Enter an address" aria-label="Address">' +
          '<button type="submit" class="address-go">Go</button>' +
        '</form>' +
      '</div>' +
      '<div class="browser-view">' +
        '<img class="browser-image" alt="" draggable="false" tabindex="0">' +
        '<button type="button" class="pane-reopen" hidden>Reopen browser</button>' +
      '</div>' +
      '<form class="browser-type-row" novalidate>' +
        '<input class="browser-type-input" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Type into the page" aria-label="Type into the page">' +
        '<button type="submit" class="address-go">Send</button>' +
      '</form>' +
    '</div>';

  const record = {
    id: pane.id,
    kind: 'browser',
    root,
    titleEl: root.querySelector('.pane-title'),
    kindEl: root.querySelector('.pane-kind'),
    closeButton: root.querySelector('.pane-close'),
    addressForm: root.querySelector('.address-form'),
    addressInput: root.querySelector('.address-input'),
    typeForm: root.querySelector('.browser-type-row'),
    typeInput: root.querySelector('.browser-type-input'),
    view: root.querySelector('.browser-view'),
    image: root.querySelector('.browser-image'),
    reopenButton: root.querySelector('.pane-reopen'),
    backButton: root.querySelector('.browser-back'),
    forwardButton: root.querySelector('.browser-forward'),
    reloadButton: root.querySelector('.browser-reload'),
    width: 1280,
    height: 800,
    currentUrl: pane.url || '',
    addressDirty: false,
    lastImage: '',
    snapshotBusy: false,
    snapshotWanted: false,
    snapshotTimer: 0,
    wheelDelta: 0,
    wheelDeltaX: 0,
    wheelTimer: 0,
    lastDialogAt: '',
    resizeObserver: null,
    resizeTimer: 0,
    lastViewport: '',
    canGoBack: false,
    canGoForward: false,
    disposed: false
  };
  record.titleEl.textContent = pane.title || 'Browser';
  record.closeButton.setAttribute('aria-label', `Close browser pane ${pane.title || 'Browser'}`);
  record.addressInput.value = pane.url && pane.url !== 'about:blank' ? pane.url : '';
  record.backButton.disabled = true;
  record.forwardButton.disabled = true;

  root.addEventListener('pointerdown', onPanePointerDown);
  root.addEventListener('focusin', () => { void setActivePane(pane.id); });
  record.closeButton.addEventListener('click', () => { requestClose('pane', pane.id, record.titleEl.textContent); });
  record.backButton.addEventListener('click', () => { void browserAction(record, 'back'); });
  record.forwardButton.addEventListener('click', () => { void browserAction(record, 'forward'); });
  record.reloadButton.addEventListener('click', () => { void browserAction(record, 'reload'); });
  record.addressForm.addEventListener('submit', (event) => {
    event.preventDefault();
    void navigateBrowser(record);
  });
  record.addressInput.addEventListener('input', () => { record.addressDirty = true; });
  record.addressInput.addEventListener('blur', () => {
    window.setTimeout(() => {
      if (record.disposed || !record.addressDirty || document.activeElement === record.addressInput) return;
      record.addressDirty = false;
      record.addressInput.value = record.currentUrl || '';
    }, 250);
  });
  record.typeForm.addEventListener('submit', (event) => {
    event.preventDefault();
    submitBrowserType(record);
  });
  record.image.addEventListener('click', (event) => {
    record.image.focus({ preventScroll: true });
    void onBrowserImageClick(record, event);
  });
  record.reopenButton.addEventListener('click', async () => {
    try {
      await api(`/panes/${record.id}/browser/reopen`, { method: 'POST' });
      record.lastViewport = '';
      record.reopenButton.hidden = true;
      record.root.classList.remove('is-offline');
      requestSnapshot(record, 120);
    } catch (error) {
      showNotice(error.message || 'Could not reopen the browser.', 'error');
    }
  });
  record.image.addEventListener('keydown', (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.key.length === 1) {
      event.preventDefault();
      void browserAction(record, 'type', { text: event.key });
      return;
    }
    const named = ['Enter', 'Backspace', 'Escape', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown'];
    if (!named.includes(event.key)) return;
    event.preventDefault();
    void browserAction(record, 'key', { key: event.key });
  });
  record.view.addEventListener('wheel', (event) => onBrowserWheel(record, event), { passive: false });
  let touchY = 0;
  let touchX = 0;
  let touchActive = false;
  record.view.addEventListener('touchstart', (event) => {
    if (event.touches.length !== 1) return;
    touchActive = true;
    touchY = event.touches[0].clientY;
    touchX = event.touches[0].clientX;
  }, { passive: true });
  record.view.addEventListener('touchmove', (event) => {
    if (!touchActive || event.touches.length !== 1) return;
    event.preventDefault();
    const nextY = event.touches[0].clientY;
    const nextX = event.touches[0].clientX;
    const deltaY = touchY - nextY;
    const deltaX = touchX - nextX;
    touchY = nextY;
    touchX = nextX;
    if (deltaY || deltaX) queueBrowserScroll(record, deltaY, deltaX);
  }, { passive: false });
  record.view.addEventListener('touchend', () => { touchActive = false; }, { passive: true });

  records.set(pane.id, record);
  wireDrop(root, pane.id);
  wirePaneReorder(root, pane.id);
  wireBrowserContext(record);
  const resizeBrowser = () => {
    if (record.disposed || !record.root.isConnected) return;
    const rect = record.view.getBoundingClientRect();
    const width = Math.round(rect.width);
    const height = Math.round(rect.height);
    if (width < 50 || height < 50) return;
    const key = `${width}x${height}`;
    if (record.lastViewport === key) return;
    record.lastViewport = key;
    api(`/panes/${record.id}/resize`, { method: 'POST', body: { width, height } })
      .then((size) => {
        if (record.disposed) return;
        if (size && Number.isFinite(size.width)) record.width = size.width;
        if (size && Number.isFinite(size.height)) record.height = size.height;
        requestSnapshot(record, 120);
      })
      .catch(() => { record.lastViewport = ''; });
  };
  record.resizeObserver = new ResizeObserver(() => {
    if (record.disposed) return;
    if (record.resizeTimer) clearTimeout(record.resizeTimer);
    record.resizeTimer = window.setTimeout(() => {
      record.resizeTimer = 0;
      resizeBrowser();
    }, 180);
  });
  record.resizeBrowser = resizeBrowser;
  record.resizeObserver.observe(record.view);
  requestAnimationFrame(() => {
    if (!record.disposed && root.isConnected) {
      resizeBrowser();
      requestSnapshot(record, 0);
    }
  });
  return root;
}

function requestSnapshot(record, delay = 0) {
  if (record.disposed) return;
  if (record.snapshotBusy) {
    record.snapshotWanted = true;
    return;
  }
  if (record.snapshotTimer) clearTimeout(record.snapshotTimer);
  record.snapshotTimer = window.setTimeout(() => {
    record.snapshotTimer = 0;
    void pollSnapshot(record);
  }, Math.max(0, delay));
}

async function pollSnapshot(record) {
  if (record.disposed || !record.root.isConnected) return;
  if (record.snapshotBusy) {
    record.snapshotWanted = true;
    return;
  }
  record.snapshotBusy = true;
  record.snapshotWanted = false;
  try {
    const snapshot = await api(`/panes/${record.id}/browser/snapshot`);
    if (record.disposed) return;
    applySnapshot(record, snapshot);
  } catch (error) {
    if (!record.disposed) {
      record.root.classList.add('is-offline');
      record.reopenButton.hidden = false;
    }
  } finally {
    record.snapshotBusy = false;
    if (!record.disposed) requestSnapshot(record, record.snapshotWanted ? 120 : SNAPSHOT_POLL_MS);
  }
}

function applySnapshot(record, snapshot) {
  if (!snapshot) return;
  const width = Number(snapshot.width);
  const height = Number(snapshot.height);
  if (Number.isFinite(width) && width > 0) record.width = width;
  if (Number.isFinite(height) && height > 0) record.height = height;
  if (snapshot.url) {
    record.currentUrl = snapshot.url;
    if (!record.addressDirty && document.activeElement !== record.addressInput && record.addressInput.value !== snapshot.url) {
      record.addressInput.value = snapshot.url;
    }
  }
  if (snapshot.title) {
    record.titleEl.textContent = snapshot.title;
    record.titleEl.title = snapshot.title;
    record.closeButton.setAttribute('aria-label', `Close browser pane ${snapshot.title}`);
  }
  if (snapshot.image && snapshot.image !== record.lastImage) {
    record.lastImage = snapshot.image;
    record.image.src = `data:image/jpeg;base64,${snapshot.image}`;
    record.image.alt = snapshot.title ? `Snapshot of ${snapshot.title}` : 'Browser page snapshot';
  }
  if (typeof snapshot.canGoBack === 'boolean') {
    record.canGoBack = snapshot.canGoBack;
    record.backButton.disabled = !snapshot.canGoBack;
  }
  if (typeof snapshot.canGoForward === 'boolean') {
    record.canGoForward = snapshot.canGoForward;
    record.forwardButton.disabled = !snapshot.canGoForward;
  }
  if (snapshot.dialog && snapshot.dialog.id) {
    showPageDialog(record, snapshot.dialog);
  } else if (pageDialogRecordId === record.id) {
    hidePageDialog();
  }
  record.root.classList.remove('is-offline');
  record.reopenButton.hidden = true;
}

async function onBrowserImageClick(record, event) {
  if (event.button !== undefined && event.button !== 0) return;
  if (record.suppressClickUntil && Date.now() < record.suppressClickUntil) return;
  const rect = record.image.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return;
  const width = record.width || record.image.naturalWidth;
  const height = record.height || record.image.naturalHeight;
  if (!width || !height) return;
  const scale = Math.min(rect.width / width, rect.height / height);
  if (!Number.isFinite(scale) || scale <= 0) return;
  const contentWidth = width * scale;
  const contentHeight = height * scale;
  const left = rect.left + (rect.width - contentWidth) / 2;
  const top = rect.top + (rect.height - contentHeight) / 2;
  const localX = event.clientX - left;
  const localY = event.clientY - top;
  if (localX < 0 || localY < 0 || localX > contentWidth || localY > contentHeight) return;
  const x = Math.max(0, Math.min(width, Math.round(localX / scale)));
  const y = Math.max(0, Math.min(height, Math.round(localY / scale)));
  const updated = await browserAction(record, 'click', { x, y });
  if (updated && updated.control) showBrowserControl(record, updated.control, { x, y });
  else if (browserControlRecordId === record.id) hideBrowserControl();
}

function queueBrowserScroll(record, deltaY, deltaX = 0) {
  const dy = Math.max(-1500, Math.min(1500, Number(deltaY) || 0));
  const dx = Math.max(-1500, Math.min(1500, Number(deltaX) || 0));
  if (!dy && !dx) return;
  record.wheelDelta += dy;
  record.wheelDeltaX = (record.wheelDeltaX || 0) + dx;
  if (record.wheelTimer) return;
  record.wheelTimer = window.setTimeout(() => {
    record.wheelTimer = 0;
    const totalY = Math.max(-1500, Math.min(1500, record.wheelDelta));
    const totalX = Math.max(-1500, Math.min(1500, record.wheelDeltaX || 0));
    record.wheelDelta = 0;
    record.wheelDeltaX = 0;
    if ((totalY || totalX) && !record.disposed) {
      void browserAction(record, 'scroll', { deltaY: totalY, deltaX: totalX });
    }
  }, 70);
}

function onBrowserWheel(record, event) {
  event.preventDefault();
  queueBrowserScroll(record, event.deltaY, event.deltaX);
}

async function browserAction(record, action, extra = {}) {
  if (record.disposed) return;
  try {
    const updated = await api(`/panes/${record.id}/browser/action`, {
      method: 'POST',
      body: { action, ...extra }
    });
    if (record.disposed) return;
    if (updated) {
      if (updated.url) {
        record.currentUrl = updated.url;
        if (!record.addressDirty && document.activeElement !== record.addressInput) record.addressInput.value = updated.url;
      }
      if (updated.title) {
        record.titleEl.textContent = updated.title;
        record.titleEl.title = updated.title;
      }
    }
    requestSnapshot(record, 220);
    return updated;
  } catch (error) {
    if (!record.disposed) showNotice(error.message || 'Browser action failed.', 'error');
  }
}

function normalizeAddress(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) return raw;
  if (/^(about|data|view-source):/i.test(raw)) return raw;
  if (/^(localhost|127\.0\.0\.1|\[::1\])(?::|\/|$)/i.test(raw)) return `http://${raw}`;
  return `https://${raw.replace(/^\/+/, '')}`;
}

async function navigateBrowser(record) {
  const url = normalizeAddress(record.addressInput.value);
  if (!url) return;
  record.addressDirty = false;
  record.addressInput.value = url;
  try {
    const updated = await api(`/panes/${record.id}/url`, { method: 'POST', body: { url } });
    if (record.disposed) return;
    if (updated) {
      record.currentUrl = updated.url || url;
      if (updated.title) {
        record.titleEl.textContent = updated.title;
        record.titleEl.title = updated.title;
      }
    }
    record.addressInput.blur();
    requestSnapshot(record, 180);
  } catch (error) {
    if (!record.disposed) showNotice(error.message || 'Could not open that address.', 'error');
  }
}

function submitBrowserType(record) {
  const text = record.typeInput.value;
  if (!text) return;
  record.typeInput.value = '';
  void browserAction(record, 'type', { text });
}

async function addPane(kind) {
  closeSheets();
  try {
    let tabId = currentState && currentState.activeTabId;
    if (!tabId || !currentState.tabs.some((tab) => tab.id === tabId)) {
      const created = await api('/tabs', { method: 'POST', body: {} });
      tabId = created.id;
    }
    const body = kind === 'terminal' ? { kind, start: false } : { kind };
    const pane = await api(`/tabs/${tabId}/panes`, { method: 'POST', body });
    await refresh();
    if (pane && pane.id) {
      window.setTimeout(() => {
        if (kind === 'browser') focusPaneById(pane.id, 'address');
        else focusPaneById(pane.id, 'terminal');
      }, 80);
    }
    logStatus(kind === 'browser' ? 'Browser pane added.' : 'Terminal pane added.');
  } catch (error) {
    showNotice(error.message || 'Could not add the pane.', 'error');
    await refresh();
  }
}

async function newTab() {
  closeSheets();
  try {
    await api('/tabs', { method: 'POST', body: {} });
    await refresh();
    logStatus('New workspace tab created.');
  } catch (error) {
    showNotice(error.message || 'Could not create a tab.', 'error');
  }
}

function requestClose(kind, id, title) {
  pendingClose = { kind, id, title };
  els.closeConfirmTitle.textContent = `Close ${title}?`;
  if (kind === 'tab') {
    const tab = currentState && currentState.tabs.find((candidate) => candidate.id === id);
    const count = tab ? tab.panes.length : 0;
    els.closeConfirmCopy.textContent = count
      ? `Closing this tab ends ${count === 1 ? 'its pane' : `all ${count} panes`} and any running jobs. This cannot be undone.`
      : 'Closing this tab cannot be undone.';
  } else {
    els.closeConfirmCopy.textContent = 'Closing this pane ends its shell and any running job. This cannot be undone.';
  }
  els.closeApprove.textContent = kind === 'tab' ? 'Close tab' : 'Close pane';
  els.closeConfirm.showModal();
}

async function closeTab(tabId, title) {
  try {
    const payload = await api(`/tabs/${tabId}`, { method: 'DELETE' });
    if (payload && payload.state) applyState(payload.state);
    else await refresh();
    tabsDialogSignature = '';
    if (els.tabsDialog.open) renderTabsDialog();
    logStatus(`Closed tab ${title}.`);
  } catch (error) {
    showNotice(error.message || 'Could not close the tab.', 'error');
  }
}

async function closePane(paneId, title) {
  try {
    const payload = await api(`/panes/${paneId}`, { method: 'DELETE' });
    if (payload && payload.state) applyState(payload.state);
    else await refresh();
    logStatus(`Closed ${title}.`);
  } catch (error) {
    showNotice(error.message || 'Could not close the pane.', 'error');
  }
}

async function activateTab(tabId) {
  try {
    const tab = currentState && currentState.tabs.find((candidate) => candidate.id === tabId);
    const body = { tabId };
    if (tab && tab.panes[0]) body.paneId = tab.panes[0].id;
    const next = await api('/active', { method: 'POST', body });
    closeSheets();
    applyState(next);
    logStatus(`Switched to ${tab ? tab.title : 'tab'}.`);
  } catch (error) {
    showNotice(error.message || 'Could not switch tabs.', 'error');
  }
}

function tabsDialogSignatureValue() {
  if (!currentState) return '';
  const tabs = currentState.tabs.map((tab) => {
    const active = tab.id === currentState.activeTabId ? '1' : '0';
    return `${tab.id}:${tab.title}:${tab.panes.length}:${active}`;
  });
  return `${tabs.join('|')}|${currentState.activePaneId || ''}|${JSON.stringify(currentState.limits || null)}`;
}

function renderTabsDialog() {
  if (!currentState) return;
  const signature = tabsDialogSignatureValue();
  if (signature === tabsDialogSignature && els.tabsList.childElementCount) return;
  tabsDialogSignature = signature;
  const tabs = currentState.tabs;
  els.tabsList.replaceChildren();
  els.tabsEmpty.hidden = tabs.length > 0;
  const activeId = currentState.activeTabId;
  const fragment = document.createDocumentFragment();
  for (const tab of tabs) {
    const row = document.createElement('li');
    row.className = `tab-row${tab.id === activeId ? ' is-active' : ''}`;

    const select = document.createElement('button');
    select.type = 'button';
    select.className = 'tab-select';
    select.dataset.tabId = tab.id;
    select.setAttribute('aria-label', `Switch to ${tab.title}, ${paneCountLabel(tab.panes.length)}`);
    if (tab.id === activeId) select.setAttribute('aria-current', 'true');
    const name = document.createElement('span');
    name.className = 'tab-name';
    name.textContent = tab.title;
    select.append(name);
    if (tab.id === activeId) {
      const current = document.createElement('span');
      current.className = 'tab-current';
      current.textContent = 'Current';
      select.append(current);
    }
    const meta = document.createElement('span');
    meta.className = 'tab-meta';
    meta.textContent = paneCountLabel(tab.panes.length);
    select.append(meta);
    select.addEventListener('click', () => { void activateTab(tab.id); });

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'tab-close';
    close.innerHTML = CLOSE_ICON;
    close.setAttribute('aria-label', `Close tab ${tab.title}`);
    close.addEventListener('click', () => { requestClose('tab', tab.id, tab.title); });

    row.append(select, close);
    fragment.append(row);
  }
  els.tabsList.append(fragment);
  updateAddLimits();
}

function updateAddLimits() {
  if (!currentState) return;
  const tab = activeTab();
  const limits = currentState.limits || {};
  const maxPanes = limits.maxPanesPerTab || 4;
  const maxTabs = limits.maxTabs || 24;
  const atPaneLimit = Boolean(tab && tab.panes.length >= maxPanes);
  const atTabLimit = currentState.tabs.length >= maxTabs;
  els.tabsAddTerminal.disabled = atPaneLimit;
  els.tabsAddBrowser.disabled = atPaneLimit;
  els.menuAddTerminal.disabled = atPaneLimit;
  els.menuAddBrowser.disabled = atPaneLimit;
  els.emptyAddTerminal.disabled = atPaneLimit;
  els.emptyAddBrowser.disabled = atPaneLimit;
  els.tabsNewTab.disabled = atTabLimit;
  els.menuNewTab.disabled = atTabLimit;
  els.emptyNewTab.disabled = atTabLimit;
}

function openSheets(dialog) {
  if (!dialog.open) dialog.showModal();
}

function closeSheets() {
  if (els.tabsDialog.open) els.tabsDialog.close();
  if (els.menuDialog.open) els.menuDialog.close();
  if (els.shortcutsDialog?.open) els.shortcutsDialog.close();
}

function openTabsDialog() {
  tabsDialogSignature = '';
  if (!currentState) {
    void refresh();
    return;
  }
  renderTabsDialog();
  openSheets(els.tabsDialog);
}

function openMenuDialog() {
  updateAddLimits();
  openSheets(els.menuDialog);
}

function focusPaneById(paneId, mode = 'type') {
  const record = records.get(paneId);
  if (!record) return false;
  if (record.kind === 'terminal') {
    if (record.term) {
      record.term.focus();
      return true;
    }
    requestAnimationFrame(() => {
      if (!record.disposed && record.term) record.term.focus();
    });
    return true;
  }
  if (record.kind === 'browser') {
    const input = mode === 'address' ? record.addressInput : record.typeInput;
    input.focus();
    return true;
  }
  return false;
}

function focusActive() {
  const tab = activeTab();
  if (!tab || !tab.panes.length) {
    if (!els.emptyState.hidden) els.emptyAddTerminal.focus();
    else showNotice('Add a terminal or browser to type.', 'info', 2600);
    return;
  }
  const paneId = effectiveActivePaneId(tab);
  const record = records.get(paneId);
  if (!record) {
    requestAnimationFrame(() => { focusPaneById(paneId); });
    return;
  }
  void setActivePane(paneId);
  focusPaneById(paneId, record.kind === 'browser' ? 'type' : 'terminal');
}

function triggerBack() {
  const record = records.get(effectiveActivePaneId());
  if (record && record.kind === 'browser') void browserAction(record, 'back');
}

function bindEvents() {
  document.addEventListener('keydown', (event) => {
    if (!event.altKey || event.ctrlKey || event.metaKey) return;
    if (document.querySelector('dialog[open]')) return;
    const target = event.target;
    if (target && target.closest && target.closest('input:not(.xterm-helper-textarea), textarea:not(.xterm-helper-textarea), [contenteditable="true"]')) return;
    const tabs = (currentState && currentState.tabs) || [];
    if (event.key.toLowerCase() === 't') {
      event.preventDefault();
      void newTab();
      return;
    }
    if (event.key.toLowerCase() === 'w') {
      const tab = activeTab();
      const paneId = effectiveActivePaneId(tab);
      const record = records.get(paneId);
      if (record) {
        event.preventDefault();
        requestClose('pane', paneId, record.titleEl.textContent || 'pane');
      }
      return;
    }
    if (event.key === '[' || event.key === ']') {
      if (!tabs.length) return;
      const index = Math.max(0, tabs.findIndex((tab) => tab.id === currentState.activeTabId));
      const next = tabs[(index + (event.key === ']' ? 1 : -1) + tabs.length) % tabs.length];
      if (next) { event.preventDefault(); void activateTab(next.id); }
      return;
    }
    if (event.key.toLowerCase() === 'm') {
      const paneId = effectiveActivePaneId();
      const record = records.get(paneId);
      if (!record) return;
      event.preventDefault();
      const maximize = !els.grid.classList.contains('is-maximized');
      els.grid.classList.toggle('is-maximized', maximize);
      for (const [id, candidate] of records) candidate.root.classList.toggle('is-maximized', maximize && id === paneId);
      logStatus(maximize ? 'Pane maximized.' : 'Pane restored.');
      return;
    }
    if (/^[1-9]$/.test(event.key) && tabs.length) {
      const index = event.key === '9' ? tabs.length - 1 : Number(event.key) - 1;
      if (tabs[index]) { event.preventDefault(); void activateTab(tabs[index].id); }
      return;
    }
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight' || event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      const tab = activeTab();
      if (!tab || !tab.panes.length) return;
      const step = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1;
      if (event.shiftKey) {
        event.preventDefault();
        reorderActivePane(step);
        return;
      }
      const at = tab.panes.findIndex((pane) => pane.id === effectiveActivePaneId(tab));
      const next = tab.panes[(at + step + tab.panes.length) % tab.panes.length];
      if (next) {
        event.preventDefault();
        void setActivePane(next.id);
        focusPaneById(next.id, next.kind === 'browser' ? 'type' : 'terminal');
      }
    }
  });
  window.addEventListener('dragover', (event) => {
    if (Array.from(event.dataTransfer?.types || []).includes('Files')) event.preventDefault();
  });
  window.addEventListener('drop', (event) => {
    if (!event.dataTransfer?.files?.length) return;
    if (event.target.closest?.('.pane')) return;
    event.preventDefault();
    const record = records.get(effectiveActivePaneId());
    void attachFiles(record, Array.from(event.dataTransfer.files));
  });
  els.emptyAddTerminal.addEventListener('click', () => { void addPane('terminal'); });
  els.emptyAddBrowser.addEventListener('click', () => { void addPane('browser'); });
  els.emptyNewTab.addEventListener('click', () => { void newTab(); });

  els.contextMenu.addEventListener('click', async (event) => {
    const action = event.target.closest('[data-context]')?.dataset.context;
    const record = records.get(contextRecordId);
    hideContextMenu();
    if (!action || !record || !record.term) return;
    try {
      if (action === 'copy') {
        if (!record.term.hasSelection()) { showNotice('Select terminal text first.', 'info', 2200); return; }
        await navigator.clipboard.writeText(record.term.getSelection());
        showNotice('Selection copied.', 'info', 2200);
      } else if (action === 'paste') {
        const text = await navigator.clipboard.readText();
        if (text) sendTerminalInput(record, text);
      } else if (action === 'select-all') {
        record.term.selectAll();
      } else if (action === 'clear') {
        record.term.clear();
      } else if (action === 'reader') {
        openReaderView();
      }
    } catch (error) {
      showNotice(error.message || 'Clipboard is unavailable in this browser.', 'error');
    }
  });
  els.browserContextMenu.addEventListener('click', async (event) => {
    const action = event.target.closest('[data-browser-context]')?.dataset.browserContext;
    const record = records.get(browserContextRecordId);
    hideContextMenu();
    if (!action || !record) return;
    if (action === 'copy-url') {
      try {
        await navigator.clipboard.writeText(record.currentUrl || '');
        showNotice('Page URL copied.', 'info', 2200);
      } catch (_) {
        showNotice('Copy blocked by the browser.', 'error');
      }
      return;
    }
    if (action === 'open') {
      if (record.currentUrl) window.open(record.currentUrl, '_blank');
      return;
    }
    if (['back', 'forward', 'reload'].includes(action)) void browserAction(record, action);
  });
  document.addEventListener('pointerdown', (event) => {
    if (!els.contextMenu.hidden && !els.contextMenu.contains(event.target)) hideContextMenu();
    if (!els.browserContextMenu.hidden && !els.browserContextMenu.contains(event.target)) hideContextMenu();
  }, true);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !els.contextMenu.hidden) { event.preventDefault(); hideContextMenu(); }
  }, true);
  els.browserControlCancel.addEventListener('click', hideBrowserControl);
  els.browserControlApply.addEventListener('click', () => { void applyBrowserControl(); });
  els.browserControlValue.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') { event.preventDefault(); void applyBrowserControl(); }
  });
  els.pageDialogDismiss.addEventListener('click', () => { void answerPageDialog('dismiss'); });
  els.pageDialogAccept.addEventListener('click', () => { void answerPageDialog('accept'); });
  els.pageDialogInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') { event.preventDefault(); void answerPageDialog('accept'); }
  });
  els.closeCancel.addEventListener('click', () => {
    pendingClose = null;
    els.closeConfirm.close();
  });
  els.closeConfirm.addEventListener('cancel', () => { pendingClose = null; });
  els.closeApprove.addEventListener('click', () => {
    const target = pendingClose;
    pendingClose = null;
    els.closeConfirm.close();
    if (!target) return;
    if (target.kind === 'tab') void closeTab(target.id, target.title);
    else void closePane(target.id, target.title);
  });
  els.notice.addEventListener('click', async () => {
    const url = els.notice.dataset.copyUrl;
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      showNotice('Attachment URL copied', 'info', 2200);
    } catch (_) {
      showNotice('Copy blocked by the browser; select the URL instead.', 'error', 3200);
    }
  });
  els.backButton.addEventListener('click', triggerBack);
  els.tabsButton.addEventListener('click', openTabsDialog);
  els.keyboardButton.addEventListener('click', focusActive);
  els.menuButton.addEventListener('click', openMenuDialog);

  els.tabsNewTab.addEventListener('click', () => { void newTab(); });
  els.tabsAddTerminal.addEventListener('click', () => { void addPane('terminal'); });
  els.tabsAddBrowser.addEventListener('click', () => { void addPane('browser'); });
  els.menuNewTab.addEventListener('click', () => { void newTab(); });
  els.menuAddTerminal.addEventListener('click', () => { void addPane('terminal'); });
  els.menuAddBrowser.addEventListener('click', () => { void addPane('browser'); });
  els.menuAttach.addEventListener('click', () => { closeSheets(); els.attachInput.click(); });
  els.menuReader.addEventListener('click', openReaderView);
  els.menuFontUp.addEventListener('click', () => adjustPaneFont(1));
  els.menuFontDown.addEventListener('click', () => adjustPaneFont(-1));
  els.menuShortcuts.addEventListener('click', () => {
    closeSheets();
    if (!els.shortcutsDialog.open) els.shortcutsDialog.showModal();
  });
  els.readerRefresh.addEventListener('click', refreshReaderView);
  els.readerClose.addEventListener('click', closeReaderView);
  els.readerView.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') { event.preventDefault(); closeReaderView(); }
  });
  els.attachInput.addEventListener('change', () => {
    const files = Array.from(els.attachInput.files || []);
    els.attachInput.value = '';
    void attachFiles(records.get(effectiveActivePaneId()), files);
  });

  document.querySelectorAll('[data-close]').forEach((button) => {
    button.addEventListener('click', () => {
      const dialog = button.closest('dialog');
      if (dialog) dialog.close();
    });
  });

  for (const dialog of [els.tabsDialog, els.menuDialog]) {
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) dialog.close();
    });
  }

  const onMotionPreference = () => {
    for (const record of records.values()) {
      if (record.term) record.term.options.cursorBlink = !reducedMotion.matches;
    }
  };
  if (typeof reducedMotion.addEventListener === 'function') {
    reducedMotion.addEventListener('change', onMotionPreference);
  }
}

let statePollTimer = 0;

function startStatePolling() {
  if (statePollTimer) clearInterval(statePollTimer);
  statePollTimer = window.setInterval(() => {
    if (!document.hidden) void refresh();
  }, STATE_POLL_MS);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) void refresh();
  });
}

async function bootstrap() {
  if (booting) return;
  booting = true;
  els.emptyTitle.textContent = 'Connecting to the workspace';
  els.emptyCopy.textContent = 'Reading tabs and panes.';
  els.emptyActions.hidden = true;
  try {
    const response = await fetch(`${API_ROOT}/bootstrap`, { cache: 'no-store' });
    let payload = null;
    try { payload = await response.json(); } catch (_) { payload = null; }
    if (!response.ok) throw new Error((payload && payload.error) || `Workspace bootstrap failed (${response.status}).`);
    if (!payload || !payload.token) throw new Error('Workspace bootstrap did not return a token.');
    token = payload.token;
    const previousEpoch = window.sessionStorage.getItem('townmouse.workspaceEpoch');
    const epoch = payload.state && payload.state.epoch;
    applyState(payload.state, { force: true });
    clearTimeout(noticeTimer);
    els.notice.hidden = true;
    if (previousEpoch && epoch && previousEpoch !== epoch) {
      showNotice('Workspace restarted. Layout restored; terminal scrollback and running jobs are gone.', 'info', 9000);
    }
    if (epoch) {
      try { window.sessionStorage.setItem('townmouse.workspaceEpoch', epoch); } catch (_) { /* storage disabled */ }
    }
    logStatus('Workspace ready.');
  } catch (error) {
    token = '';
    booting = false;
    els.emptyTitle.textContent = 'Workspace unavailable';
    els.emptyCopy.textContent = 'Waiting for the local server. Retrying.';
    els.emptyActions.hidden = true;
    showNotice(error.message || 'Could not reach the workspace. Retrying.', 'error', 0);
    window.setTimeout(() => { void bootstrap(); }, 1800);
    return;
  }
  booting = false;
  startStatePolling();
}

window.__panes = {
  refresh: () => refresh(),
  state: () => currentState,
  dimensions: (paneId) => {
    const record = records.get(paneId || effectiveActivePaneId());
    return record && record.term ? { cols: record.term.cols, rows: record.term.rows } : null;
  },
  selectAll: (paneId) => {
    const record = records.get(paneId || effectiveActivePaneId());
    if (record && record.term) record.term.selectAll();
  },
  selection: (paneId) => {
    const record = records.get(paneId || effectiveActivePaneId());
    return record && record.term ? record.term.getSelection() : '';
  },
  fontSize: (paneId) => {
    const record = records.get(paneId || effectiveActivePaneId());
    return record && record.term ? record.term.options.fontSize : null;
  },
  render: (next) => {
    if (next && Array.isArray(next.tabs)) {
      applyState(next, { force: true });
    } else if (currentState) {
      applyState(currentState, { force: true });
    }
    return currentState;
  }
};

Object.defineProperty(window.__panes, '__debug', {
  value: { histories, cursors, records },
  enumerable: false
});

const syncKeyboardInset = () => {
  const viewport = window.visualViewport;
  const inset = viewport ? Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop) : 0;
  document.documentElement.style.setProperty('--keyboard-inset', `${Math.round(inset)}px`);
  document.body.classList.toggle('keyboard-open', inset > 80);
};
window.visualViewport?.addEventListener('resize', syncKeyboardInset);
window.visualViewport?.addEventListener('scroll', syncKeyboardInset);
syncKeyboardInset();

let layoutResizeFrame = 0;
window.addEventListener('resize', () => {
  if (layoutResizeFrame) cancelAnimationFrame(layoutResizeFrame);
  layoutResizeFrame = requestAnimationFrame(() => {
    layoutResizeFrame = 0;
    applyPaneLayout(activeTab());
    updateHostContext();
  });
});

buildPaneKeybar();
bindEvents();
void bootstrap();


