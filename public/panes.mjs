import { Terminal } from '/node_modules/@xterm/xterm/lib/xterm.mjs';
import { FitAddon } from '/node_modules/@xterm/addon-fit/lib/addon-fit.mjs';
import { WebLinksAddon } from '/node_modules/@xterm/addon-web-links/lib/addon-web-links.mjs';

const API_ROOT = '/api/panes';
const STATE_POLL_MS = 1200;
const READ_POLL_MS = 180;
const SNAPSHOT_POLL_MS = 1000;
const MAX_HISTORY = 120000;
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

const byId = (id) => document.getElementById(id);
const els = {
  grid: byId('pane-grid'),
  workspace: byId('workspace'),
  emptyState: byId('empty-state'),
  emptyTitle: byId('empty-title'),
  emptyCopy: byId('empty-copy'),
  emptyActions: byId('empty-actions'),
  emptyAddTerminal: byId('empty-add-terminal'),
  emptyAddBrowser: byId('empty-add-browser'),
  emptyNewTab: byId('empty-new-tab'),
  backButton: byId('back-button'),
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

const cursors = new Map();
const histories = new Map();
const records = new Map();

function logStatus(message) {
  els.srStatus.textContent = message;
}

function showNotice(message, kind = 'error', duration = 4200) {
  if (!message) return;
  const now = Date.now();
  if (kind === 'error' && message === noticeText && now - noticeAt < 1200) return;
  noticeText = message;
  noticeAt = now;
  els.notice.textContent = message;
  els.notice.dataset.kind = kind;
  els.notice.hidden = false;
  clearTimeout(noticeTimer);
  if (duration > 0) {
    noticeTimer = window.setTimeout(() => { els.notice.hidden = true; }, duration);
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
  els.hostName.textContent = (currentState && currentState.host) || location.hostname || location.host || 'localhost';
  const limits = currentState && currentState.limits;
  if (limits) {
    els.tabsLimits.textContent = `Up to ${limits.maxTabs} tabs, ${limits.maxPanesPerTab} panes per tab.`;
  }
  updateAddLimits();
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
  if (!tab) { updateBackButton(); return; }
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
      const kindText = status === 'exited' ? 'Terminal · exited' : 'Terminal';
      if (record.kindEl.textContent !== kindText) record.kindEl.textContent = kindText;
    } else {
      if (record.kindEl.textContent !== 'Browser') record.kindEl.textContent = 'Browser';
      if (pane.url && !record.addressDirty && document.activeElement !== record.addressInput && record.addressInput.value !== pane.url) {
        record.addressInput.value = pane.url;
      }
      record.currentUrl = pane.url || record.currentUrl;
    }
  });
  updateBackButton();
}

function updateActiveClasses() {
  const tab = activeTab();
  const activeId = effectiveActivePaneId(tab);
  for (const [id, record] of records) {
    record.root.classList.toggle('is-active', id === activeId);
  }
  updateBackButton();
}

function updateBackButton() {
  const record = records.get(effectiveActivePaneId());
  const enabled = Boolean(record && record.kind === 'browser');
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
  for (const record of records.values()) disposeRecord(record);
  records.clear();
}

function disposeRecord(record) {
  if (!record || record.disposed) return;
  record.disposed = true;
  if (record.readTimer) { clearTimeout(record.readTimer); record.readTimer = 0; }
  if (record.snapshotTimer) { clearTimeout(record.snapshotTimer); record.snapshotTimer = 0; }
  if (record.wheelTimer) { clearTimeout(record.wheelTimer); record.wheelTimer = 0; }
  if (record.fitFrame) { cancelAnimationFrame(record.fitFrame); record.fitFrame = 0; }
  if (record.resizeObserver) {
    try { record.resizeObserver.disconnect(); } catch (_) { /* already detached */ }
    record.resizeObserver = null;
  }
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
    inputChain: Promise.resolve(),
    offset: cursors.get(pane.id) || 0,
    lastResize: '',
    exited: false,
    disposed: false
  };
  record.titleEl.textContent = pane.title || 'Terminal';
  record.closeButton.setAttribute('aria-label', `Close terminal pane ${pane.title || 'Terminal'}`);
  root.addEventListener('pointerdown', onPanePointerDown);
  root.addEventListener('focusin', () => { void setActivePane(pane.id); });
  record.closeButton.addEventListener('click', () => { void closePane(pane.id, record.titleEl.textContent); });
  records.set(pane.id, record);
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
  } catch (error) {
    showNotice('The terminal could not be opened.', 'error');
    try { term.dispose(); } catch (_) { /* nothing to release */ }
    return;
  }
  record.term = term;
  record.fit = fit;
  term.onData((data) => {
    if (!record.disposed && data) sendTerminalInput(record, data);
  });
  term.onResize(({ cols, rows }) => {
    if (!record.disposed) sendTerminalResize(record, cols, rows);
  });
  const history = histories.get(record.id);
  if (history) term.write(history);
  startTerminalRead(record);
  requestAnimationFrame(() => {
    if (record.disposed || !record.term) return;
    safeFit(record);
    sendTerminalResize(record, record.term.cols, record.term.rows);
  });
  record.resizeObserver = new ResizeObserver(() => {
    if (record.disposed) return;
    if (record.fitFrame) cancelAnimationFrame(record.fitFrame);
    record.fitFrame = requestAnimationFrame(() => {
      record.fitFrame = 0;
      safeFit(record);
    });
  });
  record.resizeObserver.observe(record.host);
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
  // Serialize keystrokes so fast input reaches the PTY in order.
  record.inputChain = record.inputChain.then(async () => {
    if (record.disposed) return;
    try {
      await api(`/panes/${record.id}/input`, { method: 'POST', body: { data } });
    } catch (error) {
      if (!record.disposed) logStatus('Terminal input could not be sent.');
    }
  });
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
  root.innerHTML =
    '<header class="pane-header">' +
      '<span class="pane-title"></span>' +
      '<span class="pane-kind">Browser</span>' +
      `<button type="button" class="pane-close" aria-label="Close browser pane">${CLOSE_ICON}</button>` +
    '</header>' +
    '<div class="pane-body">' +
      '<div class="browser-toolbar">' +
        `<button type="button" class="browser-icon-button browser-back" aria-label="Back">${BACK_ICON}</button>` +
        `<button type="button" class="browser-icon-button browser-reload" aria-label="Reload">${RELOAD_ICON}</button>` +
        '<form class="address-form" novalidate>' +
          '<input class="address-input" type="text" inputmode="url" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Enter an address" aria-label="Address">' +
          '<button type="submit" class="address-go">Go</button>' +
        '</form>' +
      '</div>' +
      '<div class="browser-view">' +
        '<img class="browser-image" alt="" draggable="false">' +
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
    backButton: root.querySelector('.browser-back'),
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
    wheelTimer: 0,
    disposed: false
  };
  record.titleEl.textContent = pane.title || 'Browser';
  record.closeButton.setAttribute('aria-label', `Close browser pane ${pane.title || 'Browser'}`);
  record.addressInput.value = pane.url && pane.url !== 'about:blank' ? pane.url : '';

  root.addEventListener('pointerdown', onPanePointerDown);
  root.addEventListener('focusin', () => { void setActivePane(pane.id); });
  record.closeButton.addEventListener('click', () => { void closePane(pane.id, record.titleEl.textContent); });
  record.backButton.addEventListener('click', () => { void browserAction(record, 'back'); });
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
  record.image.addEventListener('click', (event) => onBrowserImageClick(record, event));
  record.view.addEventListener('wheel', (event) => onBrowserWheel(record, event), { passive: false });

  records.set(pane.id, record);
  requestAnimationFrame(() => {
    if (!record.disposed && root.isConnected) requestSnapshot(record, 0);
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
    if (!record.disposed) record.root.classList.add('is-offline');
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
  record.root.classList.remove('is-offline');
}

function onBrowserImageClick(record, event) {
  if (event.button !== undefined && event.button !== 0) return;
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
  void browserAction(record, 'click', { x, y });
}

function onBrowserWheel(record, event) {
  event.preventDefault();
  const deltaY = Math.max(-1500, Math.min(1500, Number(event.deltaY) || 0));
  if (!deltaY) return;
  record.wheelDelta += deltaY;
  if (record.wheelTimer) return;
  record.wheelTimer = window.setTimeout(() => {
    record.wheelTimer = 0;
    const total = Math.max(-1500, Math.min(1500, record.wheelDelta));
    record.wheelDelta = 0;
    if (total && !record.disposed) void browserAction(record, 'scroll', { deltaY: total });
  }, 70);
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
    const pane = await api(`/tabs/${tabId}/panes`, { method: 'POST', body: { kind } });
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
    close.addEventListener('click', () => { void closeTab(tab.id, tab.title); });

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
  els.emptyAddTerminal.addEventListener('click', () => { void addPane('terminal'); });
  els.emptyAddBrowser.addEventListener('click', () => { void addPane('browser'); });
  els.emptyNewTab.addEventListener('click', () => { void newTab(); });

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
    applyState(payload.state, { force: true });
    clearTimeout(noticeTimer);
    els.notice.hidden = true;
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

bindEvents();
void bootstrap();


