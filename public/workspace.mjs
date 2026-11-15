const icons = {
  terminal: 'M4 5l6 7-6 7M13 19h7',
  browser: 'M3 7h18M7 4v3M3 4h18v16H3z',
  agent: 'M8 4h8v4h4v12H4V8h4zM8 12h1m6 0h1M9 16h6',
  tools: 'M4 7h16M4 17h16M8 4v6M16 14v6',
  plus: 'M12 5v14M5 12h14',
  cursor: 'M5 3l14 9-6 .8 3.5 6.2-2.6 1.6-3.5-6.3L5 20z',
  share: 'M12 3v12M8 7l4-4 4 4M5 14v6h14v-6',
  hide: 'M3 12s3.6-6 9-6 9 6 9 6-3.6 6-9 6-9-6-9-6zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
  chevron: 'M6 9l6 6 6-6',
  expand: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
  collapse: 'M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5',
  settings: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM4 12h2m12 0h2M12 4v2m0 12v2M6.3 6.3l1.4 1.4m8.6 8.6 1.4 1.4M17.7 6.3l-1.4 1.4M7.7 16.3l-1.4 1.4',
  refresh: 'M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5',
  close: 'M6 6l12 12M18 6L6 18',
  clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18M12 7v5l3 2',
  search: 'M10 4a6 6 0 1 0 0 12 6 6 0 0 0 0-12zM15 15l5 5',
  mic: 'M12 4a3 3 0 0 0-3 3v4a3 3 0 0 0 6 0V7a3 3 0 0 0-3-3zM5 11a7 7 0 0 0 14 0M12 18v3M8 21h8',
  download: 'M12 4v10M8 10l4 4 4-4M4 19h16',
  clipboard: 'M8 5h8v14H8zM9 5V3h6v2',
  copy: 'M8 8h10v12H8zM6 16H4V4h10v2',
  select: 'M4 4h6M4 10h4M4 16h6M14 4h6M16 10h4M14 16h6',
  snippets: 'M5 4h14v16H5zM8 8h8M8 12h8M8 16h5',
  wake: 'M12 2v3M12 19v3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M2 12h3M19 12h3M4.9 19.1 7 17M17 7l2.1-2.1M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z',
  fullscreen: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
  lock: 'M6 11h12v9H6zM8 11V8a4 4 0 0 1 8 0v3',
  sync: 'M4 12a8 8 0 0 1 14-5M20 12a8 8 0 0 1-14 5M18 3v4h-4M6 21v-4h4',
  dot: 'M12 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4z',
  session: 'M4 5h16v14H4zM8 5v14M12 9h4M12 13h4',
  split: 'M4 4h16v16H4zM12 4v16M8 8h1m-1 4h1m-1 4h1'
};
const icon = (name) => '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="' + icons[name] + '"/></svg>';
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));

const TOOL_META = {
  Recent: { icon: 'clock', desc: 'Reopen a recent command' },
  Search: { icon: 'search', desc: 'Search scrollback' },
  Voice: { icon: 'mic', desc: 'Dictate into the terminal' },
  Export: { icon: 'download', desc: 'Save terminal output' },
  Paste: { icon: 'clipboard', desc: 'Paste from the clipboard' },
  Copy: { icon: 'copy', desc: 'Copy the selection' },
  'Select all': { icon: 'select', desc: 'Select the scrollback' },
  Snippets: { icon: 'snippets', desc: 'Insert a saved command' },
  Wake: { icon: 'wake', desc: 'Keep the screen awake' },
  Fullscreen: { icon: 'fullscreen', desc: 'Use the whole screen' },
  Lock: { icon: 'lock', desc: 'Lock this session' },
  Sync: { icon: 'sync', desc: 'Export settings with a sync token' },
  Split: { icon: 'split', desc: 'Split the terminal into panes' }
};
const ACTION_META = {
  settingsBtn: { icon: 'settings', desc: 'Terminal style, theme, and voice' },
  reconnectBtn: { icon: 'refresh', desc: 'Reconnect the shell' },
  closeBtn: { icon: 'close', desc: 'End this terminal session', danger: true }
};

export async function init(T1) {
  const body = document.body;
  const shell = document.querySelector('.app-shell');
  const header = document.querySelector('.terminal-header');
  body.classList.add('workspace');

  const sidebar = document.createElement('nav');
  sidebar.className = 'workspace-nav';
  sidebar.setAttribute('aria-label', 'Townmouse workspaces');
  sidebar.innerHTML =
    '<div class="workspace-brand"><div class="brand-art"><img class="brand-mascot" src="/brand/townmouse-monocled.webp" alt=""></div><span>Townmouse<small>Agent workspace</small></span></div>' +
    '<button id="workspace-terminal" type="button">' + icon('terminal') + '<span>Terminal</span></button>' +
    '<button id="workspace-browser" type="button">' + icon('browser') + '<span>Browser</span></button>' +
    '<div class="workspace-label">Tabs</div>' +
    '<div id="browser-tabs" role="tablist" aria-label="Browser tabs"></div>' +
    '<button id="new-browser" type="button">' + icon('plus') + '<span>New tab</span></button>' +
    '<div class="workspace-label">Agent</div>' +
    '<button id="agent-browser" type="button">' + icon('agent') + '<span>Agent</span></button>' +
    '<button id="workspace-panes" type="button">' + icon('split') + '<span>Panes</span></button>' +
    '<button id="workspace-attach" type="button">' + icon('plus') + '<span>Attach</span></button>' +
    '<div class="nav-bottom"><button id="workspace-tools" type="button">' + icon('tools') + '<span>Tools</span></button><a class="workspace-credit" href="https://floydslabs.com" target="_blank" rel="noreferrer"><img src="/brand/floydslabs-credit.webp" alt=""><span>Built at Floyd’s Labs</span></a><p class="nav-status" id="workspace-server">Local server</p></div>';
  body.append(sidebar);
  sidebar.querySelectorAll('button').forEach((button) => button.setAttribute('aria-label', button.textContent.trim()));
  sidebar.querySelector('#agent-browser')?.setAttribute('aria-label', 'Agent browser');
  sidebar.querySelector('#workspace-browser')?.setAttribute('aria-label', 'Browser workspace');
  sidebar.querySelector('#workspace-panes')?.setAttribute('aria-label', 'Pane workspace');
  sidebar.querySelector('#workspace-attach')?.setAttribute('aria-label', 'Attach a file to the terminal');
  sidebar.querySelector('#workspace-tools')?.setAttribute('aria-label', 'Tools and settings');

  const browser = document.createElement('section');
  browser.className = 'browser-surface';
  browser.hidden = true;
  browser.setAttribute('aria-label', 'Townmouse browser workspace');
  browser.innerHTML =
    '<div class="browser-tabstrip">' +
      '<div class="browser-tablist" id="browser-tablist" role="tablist" aria-label="Browser tabs"></div>' +
      '<button type="button" id="new-browser-inline" class="browser-icon-button" aria-label="New browser tab" title="New tab">' + icon('plus') + '</button>' +
      '<button type="button" id="browser-share-toggle" class="browser-strip-button" aria-label="Sharing and tab controls" aria-controls="browser-permissions" aria-expanded="false">' + icon('share') + '<span>Share</span></button>' +
      '<button type="button" id="browser-expand" class="browser-icon-button" aria-label="Expand browser view" aria-expanded="false" title="Expand browser view">' + icon('expand') + '</button>' +
      '<button type="button" id="hide-browser-compact" class="browser-strip-button" aria-label="Hide browser view" title="Hide view">' + icon('hide') + '<span>Hide</span></button>' +
    '</div>' +
    '<header class="browser-heading"><div><span class="browser-eyebrow">Browser workspace</span><h2 id="browser-title">New tab</h2></div><button type="button" id="hide-browser" aria-label="Hide browser view">Hide view</button></header>' +
    '<form id="browser-address">' +
      '<button type="button" id="browser-back" aria-label="Go back" title="Back">‹</button>' +
      '<button type="button" id="browser-forward" aria-label="Go forward" title="Forward">›</button>' +
      '<button type="button" id="browser-reload" aria-label="Reload page" title="Reload">↻</button>' +
      '<input id="browser-url" aria-label="Web or local address" placeholder="Search or enter a web or localhost address" autocomplete="off">' +
      '<button type="button" id="browser-share-bottom" class="browser-strip-button" aria-label="Sharing and tab controls" aria-controls="browser-permissions" aria-expanded="false">' + icon('share') + '<span>Share</span></button>' +
      '<button type="submit">Go</button>' +
    '</form>' +
    '<div class="browser-permissions" id="browser-permissions">' +
      '<label for="browser-share">Agent access</label>' +
      '<select id="browser-share" aria-label="Agent access"><option value="private">Private</option><option value="view">View only</option><option value="control">Allow control</option></select>' +
      '<button type="button" id="copy-agent">Copy connection</button>' +
      '<button type="button" id="browser-read">Read page</button>' +
      '<button type="button" id="close-browser" aria-label="Close current browser tab">Close tab</button>' +
    '</div>' +
    '<div id="browser-message" role="status">' +
      '<span class="browser-badge" id="browser-kind">Human</span>' +
      '<span class="browser-badge" id="browser-permission">Private</span>' +
      '<strong id="browser-title-compact">New tab</strong>' +
      '<span id="browser-message-text">Enter an address or localhost URL.</span>' +
    '</div>' +
    '<div class="browser-canvas">' +
      '<img id="browser-frame" alt="Live browser page. Click to interact; use the text field below for typing." tabindex="0" hidden>' +
      '<div id="browser-empty"><img class="browser-mascot" src="/brand/townmouse-monocled.webp" alt="Townmouse, the monocled colonial mouse holding a terminal sign"><h3>A place for the web</h3><p>Open documentation, preview a local app,<br>or work alongside your terminal agent.</p></div>' +
    '</div>' +
    '<form id="browser-type"><input aria-label="Text to send to browser" placeholder="Type into the focused page field"><button type="submit">Send</button><button type="button" id="browser-tab" aria-label="Send Tab key">Tab</button><button type="button" id="browser-enter" aria-label="Send Enter key">Enter</button></form>';
  const splitHandle = document.createElement('div');
  splitHandle.className = 'split-handle';
  splitHandle.id = 'split-handle';
  splitHandle.setAttribute('role', 'separator');
  splitHandle.setAttribute('aria-orientation', 'horizontal');
  splitHandle.setAttribute('aria-label', 'Resize terminal and browser');
  splitHandle.setAttribute('aria-valuemin', '30');
  splitHandle.setAttribute('aria-valuemax', '80');
  splitHandle.setAttribute('aria-valuenow', '60');
  splitHandle.tabIndex = 0;
  shell.append(splitHandle);
  shell.append(browser);

  const drawer = document.createElement('dialog');
  drawer.className = 'workspace-drawer';
  drawer.id = 'workspace-drawer';
  drawer.setAttribute('aria-label', 'Tools and settings');
  drawer.innerHTML =
    '<header><div><small>Townmouse controls</small><h2>Tools &amp; settings</h2></div><button id="drawer-close" type="button">Done</button></header>' +
    '<input id="tool-filter" placeholder="Find a tool" aria-label="Find a tool" autocomplete="off">' +
    '<div class="drawer-groups" id="drawer-groups">' +
      '<section class="drawer-group" data-group="session"><h3>Session</h3><div class="drawer-list" id="drawer-session"></div></section>' +
      '<section class="drawer-group" data-group="appearance"><h3>Appearance</h3><div class="drawer-list" id="drawer-appearance"></div></section>' +
      '<section class="drawer-group" data-group="tools"><h3>Terminal tools</h3><div class="drawer-list" id="drawer-tools"></div></section>' +
    '</div>' +
    '<p class="drawer-empty" id="tool-empty" hidden>No matching tools.</p>' +
    '<a class="drawer-credit" href="https://floydslabs.com" target="_blank" rel="noreferrer"><img src="/brand/floydslabs-credit.webp" alt=""><span><small>Built by</small>Floyd’s Labs</span></a>';
  body.append(drawer);

  const sessionMenu = document.createElement('dialog');
  sessionMenu.className = 'workspace-drawer session-menu';
  sessionMenu.id = 'session-menu';
  sessionMenu.setAttribute('aria-label', 'Terminal sessions');
  sessionMenu.innerHTML =
    '<header><div><small>Terminal sessions</small><h2>Sessions</h2></div><button id="session-menu-close" type="button">Done</button></header>' +
    '<div id="session-menu-list" class="drawer-list"></div>' +
    '<button id="session-menu-new" type="button" class="drawer-row">' + icon('plus') + '<span class="drawer-row-copy"><span class="drawer-row-name">New session</span><span class="drawer-row-desc">Start another shell</span></span></button>';
  body.append(sessionMenu);

  const closeConfirm = document.createElement('dialog');
  closeConfirm.className = 'workspace-drawer workspace-confirm';
  closeConfirm.id = 'close-confirm';
  closeConfirm.setAttribute('aria-label', 'Close terminal?');
  closeConfirm.innerHTML =
    '<header><div><small>Session</small><h2>Close terminal?</h2></div></header>' +
    '<p>This ends the shell and clears the saved session on this page.</p>' +
    '<div class="confirm-actions"><button id="close-confirm-cancel" type="button">Cancel</button><button id="close-confirm-close" type="button" class="danger">Close terminal</button></div>';
  body.append(closeConfirm);

  const $ = (id) => document.getElementById(id);
  const settingsModal = document.getElementById('settingsModal');
  const terminalActions = document.querySelector('.terminal-actions');
  const toolbar = $('t1toolbar');

  function makeRow(button, meta) {
    const label = button.textContent.trim();
    button.classList.add('drawer-row');
    if (meta.danger) button.classList.add('drawer-row-danger');
    button.dataset.search = (label + ' ' + (meta.desc || '')).toLowerCase();
    button.setAttribute('aria-label', label + (meta.desc ? '. ' + meta.desc : ''));
    button.innerHTML = icon(meta.icon || 'dot') +
      '<span class="drawer-row-copy" data-desc="' + escapeHtml(meta.desc || '') + '"><span class="drawer-row-name">' + escapeHtml(label) + '</span></span>';
  }

  if (terminalActions) {
    const settings = terminalActions.querySelector('#settingsBtn');
    const reconnectButton = terminalActions.querySelector('#reconnectBtn');
    const close = terminalActions.querySelector('#closeBtn');
    if (settings) { makeRow(settings, ACTION_META.settingsBtn); $('drawer-appearance').append(settings); }
    if (reconnectButton) { makeRow(reconnectButton, ACTION_META.reconnectBtn); $('drawer-session').append(reconnectButton); }
    if (close) {
      close.textContent = 'Close terminal';
      makeRow(close, ACTION_META.closeBtn);
      $('drawer-session').append(close);
    }
    terminalActions.remove();
  }

  const newSessionRow = document.createElement('button');
  newSessionRow.type = 'button';
  newSessionRow.id = 'drawer-new-session';
  newSessionRow.className = 'drawer-row';
  newSessionRow.dataset.search = 'new session start another shell';
  newSessionRow.setAttribute('aria-label', 'New session. Start another shell.');
  newSessionRow.innerHTML = icon('plus') + '<span class="drawer-row-copy"><span class="drawer-row-name">New session</span><span class="drawer-row-desc">Start another shell</span></span>';
  newSessionRow.addEventListener('click', () => {
    const plus = document.querySelector('.t1session-new');
    if (plus) plus.click();
  });
  $('drawer-session').prepend(newSessionRow);

  if (toolbar) {
    const fontGroup = toolbar.querySelector('.t1font-group');
    if (fontGroup) {
      const fontRow = document.createElement('div');
      fontRow.className = 'drawer-row drawer-font-row';
      fontRow.dataset.search = 'text size terminal font size';
      fontRow.innerHTML = '<span class="drawer-row-copy"><span class="drawer-row-name">Text size</span><span class="drawer-row-desc">Terminal font size</span></span>';
      fontRow.append(fontGroup);
      $('drawer-appearance').append(fontRow);
    }
    $('drawer-tools').append(toolbar);
    for (const button of [...toolbar.querySelectorAll(':scope > button')]) {
      const label = button.textContent.trim();
      makeRow(button, TOOL_META[label] || { icon: 'dot' });
    }
    toolbar.classList.add('drawer-list');
    const syncPressed = () => {
      toolbar.querySelectorAll('.drawer-row').forEach((row) => {
        if (row.classList.contains('active')) row.setAttribute('aria-pressed', 'true');
        else row.removeAttribute('aria-pressed');
      });
    };
    syncPressed();
    new MutationObserver(syncPressed).observe(toolbar, { subtree: true, attributes: true, attributeFilter: ['class'] });
  }

  const readerRow = document.createElement('button');
  readerRow.type = 'button';
  readerRow.id = 'drawer-reader';
  readerRow.textContent = 'Reader view';
  makeRow(readerRow, { icon: 'dot', desc: 'Word-wrapped transcript for long agent output' });
  readerRow.addEventListener('click', () => {
    drawer.close();
    openReaderView();
  });
  $('drawer-tools').append(readerRow);

  const isNarrow = () => window.matchMedia('(max-width: 699px)').matches;
  const isTouch = () => window.matchMedia('(pointer: coarse)').matches;
  const setMessage = (message) => { const el = $('browser-message-text'); if (el) el.textContent = message; };
  const setAddressPlaceholder = () => {
    $('browser-url').placeholder = isNarrow()
      ? 'Search or address'
      : 'Search or enter a web or localhost address';
  };
  setAddressPlaceholder();
  window.addEventListener('resize', setAddressPlaceholder);

  function filterDrawer(query) {
    const value = query.trim().toLowerCase();
    let matches = 0;
    drawer.querySelectorAll('[data-search]').forEach((row) => {
      const show = !value || row.dataset.search.includes(value);
      row.hidden = !show;
      if (show) matches += 1;
    });
    drawer.querySelectorAll('.drawer-group').forEach((group) => {
      const rows = [...group.querySelectorAll('[data-search]')];
      group.hidden = rows.length > 0 && rows.every((row) => row.hidden);
    });
    $('tool-empty').hidden = matches > 0 || !value;
  }

  // ── Session identity and visible reconnect ─────────────────────────────────
  const statusWrap = header.querySelector('.statuswrap');
  const sessionPill = document.createElement('button');
  sessionPill.type = 'button';
  sessionPill.className = 'workspace-session-pill';
  sessionPill.id = 'workspace-session-pill';
  sessionPill.setAttribute('aria-haspopup', 'dialog');
  sessionPill.setAttribute('aria-label', 'Sessions');
  sessionPill.hidden = true;
  header.insertBefore(sessionPill, statusWrap);

  const reconnect = document.createElement('button');
  reconnect.type = 'button';
  reconnect.id = 'workspace-reconnect';
  reconnect.className = 'workspace-reconnect';
  reconnect.textContent = 'Reconnect';
  reconnect.hidden = true;
  header.insertBefore(reconnect, statusWrap);

  function updateSessionPill() {
    const footer = $('footerMeta')?.textContent || '';
    const session = $('sessionInfo')?.textContent || '';
    const cwdMatch = footer.match(/·\s*(.+?)(?:\s*·|$)/);
    const cwd = cwdMatch ? cwdMatch[1].trim() : '';
    const base = cwd.split('/').filter(Boolean).pop();
    const idMatch = session.match(/session\s+([a-f0-9-]+)/i);
    const fullId = $('sessionInfo')?.dataset.sessionId || '';
    const sessionId = fullId || (idMatch ? idMatch[1] : '');
    sessionPill.textContent = base ? 'Shell · ' + base : 'Shell';
    sessionPill.title = sessionId ? 'Session ' + sessionId : 'Shell session';
    sessionPill.setAttribute('aria-label', 'Sessions. ' + (base ? 'Shell · ' + base : 'Shell'));
    sessionPill.hidden = false;
    if (sessionId) {
      const names = window.__terminalOne?.sessionNames?.() || {};
      if (!names[sessionId]) window.__terminalOne?.renameSession?.(sessionId, sessionId.slice(0, 8));
    }
  }

  async function renderSessionMenu() {
    const list = $('session-menu-list');
    list.innerHTML = '';
    const current = $('sessionInfo')?.dataset.sessionId || (($('sessionInfo')?.textContent || '').match(/session\s+([a-f0-9-]+)/i) || [])[1] || '';
    const names = window.__terminalOne?.sessionNames?.() || {};
    const sessions = new Map();
    try {
      const response = await fetch('/admin/sessions', { cache: 'no-store' });
      if (response.ok) {
        const body = await response.json();
        for (const session of body.sessions || []) sessions.set(session.id, session);
      }
    } catch (_) { /* the current session still renders below */ }
    if (current) sessions.set(current, sessions.get(current) || { id: current });
    let added = 0;
    for (const [id, info] of sessions) {
      const name = names[id] || id.slice(0, 8);
      const active = id === current;
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'drawer-row' + (active ? ' active' : '');
      const detail = active ? 'Current session' : (info.resumable === false ? 'Attached shell' : 'Switch to this session');
      row.innerHTML = icon('session') + '<span class="drawer-row-copy"><span class="drawer-row-name">' + escapeHtml(name) + '</span><span class="drawer-row-desc">' + detail + '</span></span>';
      row.onclick = () => {
        sessionMenu.close();
        if (!active) window.__terminalOne?.switchSession?.(id);
      };
      list.append(row);
      added += 1;
    }
    if (!added) {
      const row = document.createElement('div');
      row.className = 'drawer-row';
      row.innerHTML = icon('session') + '<span class="drawer-row-copy"><span class="drawer-row-name">Current shell</span><span class="drawer-row-desc">One session</span></span>';
      list.append(row);
    }
  }

  sessionPill.addEventListener('click', () => {
    void renderSessionMenu().finally(() => sessionMenu.showModal());
  });
  $('session-menu-close').onclick = () => sessionMenu.close();
  $('session-menu-new').onclick = () => {
    sessionMenu.close();
    window.__terminalOne?.newSession?.();
  };
  window.__terminalOne?.setSessionSwitchCallback?.((id) => {
    if (id === '__new__') window.__terminalOne.newSession?.();
    else window.__terminalOne.switchSession?.(id);
  });
  sessionMenu.addEventListener('click', (event) => { if (event.target === sessionMenu) sessionMenu.close(); });

  $('close-confirm-cancel').onclick = () => closeConfirm.close();
  $('close-confirm-close').onclick = () => {
    const close = $('closeBtn');
    close.dataset.confirmed = '1';
    closeConfirm.close();
    drawer.close();
    close.click();
  };
  closeConfirm.addEventListener('click', (event) => { if (event.target === closeConfirm) closeConfirm.close(); });
  for (const id of ['footerMeta', 'sessionInfo']) {
    const el = $(id);
    if (el) new MutationObserver(updateSessionPill).observe(el, { childList: true, subtree: true, characterData: true });
  }
  updateSessionPill();

  const statusEl = $('status');
  if (statusEl) {
    const updateReconnect = () => { reconnect.hidden = statusEl.classList.contains('connected'); };
    new MutationObserver(updateReconnect).observe(statusEl, { attributes: true, attributeFilter: ['class'], childList: true, subtree: true });
    updateReconnect();
  }
  reconnect.addEventListener('click', () => $('reconnectBtn')?.click());

  // Settings focus restoration after the inherited close handler runs.
  if (settingsModal) {
    new MutationObserver(() => {
      if (!settingsModal.classList.contains('open')) setTimeout(() => $('workspace-tools')?.focus(), 0);
    }).observe(settingsModal, { attributes: true, attributeFilter: ['class'] });
  }

  // ── Split handle and browser expand ────────────────────────────────────────
  const desktopSplitQuery = window.matchMedia('(min-width: 1100px)');
  function splitOrientation() {
    return desktopSplitQuery.matches ? 'vertical' : 'horizontal';
  }
  function splitVariable() {
    return splitOrientation() === 'vertical' ? '--terminal-split' : '--browser-split';
  }
  function currentSplit() {
    const fallback = splitOrientation() === 'vertical' ? 47 : 60;
    const value = parseFloat(getComputedStyle(shell).getPropertyValue(splitVariable()));
    return Number.isFinite(value) ? value : fallback;
  }
  function splitBounds() {
    if (splitOrientation() === 'vertical') {
      const width = shell.getBoundingClientRect().width || 0;
      if (width > 0) {
        const min = Math.max(25, (320 / width) * 100);
        const max = Math.min(75, ((width - 12 - 420) / width) * 100);
        if (max > min) return { min, max };
      }
    }
    return { min: 25, max: 75 };
  }
  function setSplit(value) {
    const bounds = splitBounds();
    const next = Math.max(bounds.min, Math.min(bounds.max, value));
    shell.style.setProperty(splitVariable(), next + '%');
    splitHandle.setAttribute('aria-valuemin', String(Math.round(bounds.min)));
    splitHandle.setAttribute('aria-valuemax', String(Math.round(bounds.max)));
    splitHandle.setAttribute('aria-valuenow', String(Math.round(next)));
    splitHandle.setAttribute('aria-valuetext',
      (splitOrientation() === 'vertical' ? 'Terminal ' : 'Browser ') + Math.round(next) + ' percent');
  }
  function syncSplitOrientation() {
    const orientation = splitOrientation();
    splitHandle.dataset.orientation = orientation;
    splitHandle.setAttribute('aria-orientation', orientation);
    setSplit(currentSplit());
  }
  window.addEventListener('resize', () => {
    if (!browser.hidden) setSplit(currentSplit());
  });
  shell.style.setProperty('--terminal-split', '47%');
  shell.style.setProperty('--browser-split', '60%');
  syncSplitOrientation();
  desktopSplitQuery.addEventListener?.('change', syncSplitOrientation);
  let splitDrag = null;
  splitHandle.addEventListener('pointerdown', (event) => {
    if (event.button !== undefined && event.button !== 0) return;
    const rect = shell.getBoundingClientRect();
    splitDrag = {
      x: event.clientX,
      y: event.clientY,
      split: currentSplit(),
      orientation: splitOrientation(),
      width: rect.width || 1,
      height: rect.height || 1
    };
    splitHandle.setPointerCapture?.(event.pointerId);
    splitHandle.classList.add('split-drag');
    document.body.classList.add('split-dragging');
    event.preventDefault();
  });
  splitHandle.addEventListener('pointermove', (event) => {
    if (!splitDrag) return;
    if (splitDrag.orientation === 'vertical') {
      setSplit(splitDrag.split + ((event.clientX - splitDrag.x) / splitDrag.width) * 100);
    } else {
      setSplit(splitDrag.split - ((event.clientY - splitDrag.y) / splitDrag.height) * 100);
    }
  });
  const endSplit = () => {
    splitDrag = null;
    splitHandle.classList.remove('split-drag');
    document.body.classList.remove('split-dragging');
  };
  splitHandle.addEventListener('pointerup', endSplit);
  splitHandle.addEventListener('pointercancel', endSplit);
  splitHandle.addEventListener('lostpointercapture', endSplit);
  splitHandle.addEventListener('keydown', (event) => {
    const orientation = splitOrientation();
    let delta = 0;
    if (orientation === 'vertical') {
      if (event.key === 'ArrowLeft') delta = -3;
      if (event.key === 'ArrowRight') delta = 3;
    } else {
      if (event.key === 'ArrowUp') delta = -3;
      if (event.key === 'ArrowDown') delta = 3;
    }
    if (event.key === 'Home') delta = 25 - currentSplit();
    if (event.key === 'End') delta = 75 - currentSplit();
    if (!delta) return;
    event.preventDefault();
    setSplit(currentSplit() + delta);
  });

  $('browser-expand').addEventListener('click', () => {
    const open = body.classList.toggle('browser-max');
    const button = $('browser-expand');
    button.setAttribute('aria-expanded', String(open));
    button.setAttribute('aria-label', open ? 'Collapse browser view' : 'Expand browser view');
    button.title = open ? 'Collapse browser view' : 'Expand browser view';
    button.innerHTML = icon(open ? 'collapse' : 'expand');
  });

  // ── Browser state and tabs ─────────────────────────────────────────────────
  let key;
  let tabs = [];
  let current = null;
  let busy = false;
  const permissionLabel = (permission) => permission === 'view' ? 'View only' : permission === 'control' ? 'Control' : 'Private';

  async function api(path = '', method = 'GET', data) {
    const res = await fetch('/api/browser' + path, {
      method,
      headers: { 'Content-Type': 'application/json', 'X-Workspace-Key': key || '' },
      ...(data ? { body: JSON.stringify(data) } : {})
    });
    const value = await res.json();
    if (!res.ok) throw new Error(value.error);
    return value;
  }
  function safe(fn) {
    return async (event) => {
      try { await fn(event); }
      catch (error) { setMessage(error.message); T1.toast?.(error.message); }
    };
  }

  function updateBrowserState() {
    if (!current) return;
    $('browser-kind').textContent = current.kind === 'agent' ? 'Agent' : 'Human';
    $('browser-permission').textContent = current.kind === 'agent' ? 'Control' : permissionLabel(current.permission);
    $('browser-kind').classList.toggle('agent', current.kind === 'agent');
  }

  function closeTab(tab) {
    return safe(async () => {
      if (!tab) return;
      const id = tab.id;
      const wasCurrent = current?.id === id;
      await api('/' + id, 'DELETE');
      tabs = tabs.filter((candidate) => candidate.id !== id);
      if (!wasCurrent) { renderTabs(); return; }
      current = null;
      const next = tabs.filter((candidate) => candidate.kind === 'human').at(-1) || tabs.find((candidate) => candidate.kind === 'agent');
      if (next) await show(next); else hide();
    })();
  }

  function renderTabContainer(container, list) {
    if (!container) return;
    for (const old of container.querySelectorAll('.browser-tab')) {
      if (!list.some((tab) => tab.id === old.dataset.id)) old.remove();
    }
    const blankCount = list.filter((tab) => tab.kind === 'human' && tab.title === 'about:blank').length;
    for (const [index, tab] of list.entries()) {
      let row = [...container.querySelectorAll('.browser-tab')].find((button) => button.dataset.id === tab.id);
      if (!row) {
        row = document.createElement('div');
        row.dataset.id = tab.id;
        row.className = 'browser-tab';
        row.setAttribute('role', 'tab');
        row.innerHTML = icon(tab.kind === 'agent' ? 'agent' : 'browser') +
          '<span class="browser-tab-label"></span>' +
          '<span class="browser-tab-badge"></span>' +
          '<button type="button" class="browser-tab-close" aria-label="Close tab">×</button>';
        row.addEventListener('click', safe(() => show(tab)));
        row.addEventListener('keydown', (event) => {
          if (event.target !== row) return;
          if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); safe(() => show(tab))(event); }
          if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
            event.preventDefault();
            const buttons = [...container.querySelectorAll('.browser-tab')];
            const at = buttons.indexOf(row);
            const next = buttons[(at + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length];
            next?.focus();
          }
        });
        const close = row.querySelector('.browser-tab-close');
        close.addEventListener('click', (event) => { event.stopPropagation(); closeTab(tab); });
        close.addEventListener('keydown', (event) => {
          if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); closeTab(tab); }
        });
        container.append(row);
      }
      const blankIndex = list.slice(0, index + 1).filter((candidate) => candidate.kind === 'human' && candidate.title === 'about:blank').length;
      const label = tab.kind === 'agent'
        ? 'Agent browser'
        : (tab.title === 'about:blank'
          ? (blankCount > 1 ? 'New tab ' + blankIndex : 'New tab')
          : tab.title);
      row.querySelector('.browser-tab-label').textContent = label;
      const badge = row.querySelector('.browser-tab-badge');
      badge.textContent = tab.kind === 'agent' ? 'Agent' : 'Human';
      badge.classList.toggle('agent', tab.kind === 'agent');
      row.title = label + (tab.kind === 'agent' ? ', agent browser' : ', human browser tab');
      row.setAttribute('aria-label', label + (tab.kind === 'agent' ? ', agent browser' : ', human browser tab'));
      const selected = tab.id === current?.id;
      row.classList.toggle('selected', selected);
      row.setAttribute('aria-selected', String(selected));
      row.tabIndex = selected ? 0 : -1;
      if (selected) {
        requestAnimationFrame(() => {
          if (container.scrollWidth > container.clientWidth) {
            row.scrollIntoView({ block: 'nearest', inline: 'nearest' });
          }
        });
      }
    }
  }

  function selectNav(element, selected) {
    element.classList.toggle('selected', selected);
    if (selected) element.setAttribute('aria-current', 'page');
    else element.removeAttribute('aria-current');
  }

  function renderTabs() {
    renderTabContainer($('browser-tabs'), tabs);
    renderTabContainer($('browser-tablist'), tabs);
    selectNav($('workspace-terminal'), browser.hidden);
    selectNav($('workspace-browser'), !browser.hidden && current?.kind === 'human');
    selectNav($('agent-browser'), !browser.hidden && current?.kind === 'agent');
    updateBrowserState();
  }

  function hide() {
    browser.hidden = true;
    body.classList.remove('browser-open', 'browser-max');
    $('browser-expand').setAttribute('aria-expanded', 'false');
    $('browser-expand').innerHTML = icon('expand');
    browser.classList.remove('share-open');
    setShareExpanded(false);
    renderTabs();
    wakeChrome();
    window.dispatchEvent(new Event('resize'));
  }

  async function show(tab) {
    if (document.activeElement && document.activeElement.closest('.terminal-container')) document.activeElement.blur();
    current = tab;
    browser.hidden = false;
    body.classList.add('browser-open');
    setSplit(currentSplit());
    browser.classList.remove('share-open');
    setShareExpanded(false);
    $('browser-share').value = tab.permission || 'private';
    $('browser-url').value = tab.url === 'about:blank' ? '' : tab.url;
    updateBrowserState();
    renderTabs();
    wakeChrome();
    await resizeViewer();
    await refresh();
    window.dispatchEvent(new Event('resize'));
  }

  function setShareExpanded(open) {
    browser.classList.toggle('share-open', open);
    for (const id of ['browser-share-toggle', 'browser-share-bottom']) {
      const button = $(id);
      if (button) button.setAttribute('aria-expanded', String(open));
    }
  }
  function toggleShare() { setShareExpanded(!browser.classList.contains('share-open')); }

  async function resizeViewer() {
    if (!current || browser.hidden) return;
    const box = browser.querySelector('.browser-canvas');
    const width = box.clientWidth;
    const height = box.clientHeight;
    if (current.viewWidth === width && current.viewHeight === height) return;
    current.viewWidth = width;
    current.viewHeight = height;
    await api('/' + current.id + '/viewport', 'POST', { width, height });
  }
  window.addEventListener('resize', () => {
    clearTimeout(window.__browserResize);
    window.__browserResize = setTimeout(() => resizeViewer().catch(() => {}), 250);
  });

  async function refresh() {
    if (!current || browser.hidden || busy) return;
    busy = true;
    const id = current.id;
    try {
      const snap = await api('/' + id + '/snapshot');
      if (current?.id !== id) return;
      Object.assign(current, snap);
      delete current.image;
      $('browser-frame').src = 'data:image/jpeg;base64,' + snap.image;
      const blank = snap.url === 'about:blank';
      $('browser-frame').hidden = blank;
      $('browser-empty').hidden = !blank;
      const title = current.kind === 'agent' ? 'Agent browser' : (snap.title || 'New tab');
      $('browser-title').textContent = title;
      $('browser-title-compact').textContent = title;
      if (document.activeElement !== $('browser-url')) $('browser-url').value = blank ? '' : snap.url;
      updateBrowserState();
      renderTabs();
    } finally {
      busy = false;
    }
  }

  async function action(name, data = {}) {
    if (!current) return;
    await api('/' + current.id + '/action', 'POST', { action: name, ...data });
    await refresh();
  }

  const createBrowser = async () => {
    setMessage('Starting a private browser…');
    const tab = await api('', 'POST', { kind: 'human' });
    tabs.push(tab);
    await show(tab);
    setMessage(isNarrow() ? 'Private browser. Share only when needed.' : 'Private browser. Choose agent access only when you want to share.');
  };
  const openBrowser = async () => {
    const human = tabs.filter((tab) => tab.kind === 'human');
    if (current?.kind === 'human') { await show(current); return; }
    if (human.length) { await show(human[human.length - 1]); return; }
    await createBrowser();
  };
  const openAgent = async () => {
    let tab = tabs.find((candidate) => candidate.kind === 'agent');
    if (!tab) {
      tab = await api('', 'POST', { kind: 'agent' });
      tabs.push(tab);
    }
    await show(tab);
    setMessage(isNarrow()
      ? 'Agent browser keeps running when hidden. Copy its connection to your agent.'
      : 'The agent browser keeps running when this view is hidden. Copy its connection to your terminal agent.');
  };

  $('new-browser').onclick = safe(createBrowser);
  $('new-browser-inline').onclick = safe(createBrowser);
  $('workspace-browser').onclick = safe(openBrowser);
  $('agent-browser').onclick = safe(openAgent);
  $('workspace-panes').onclick = () => {
    // Keep the main terminal's WebSocket alive; navigating this window away
    // would leave its shell in the five-minute resume grace and then kill it.
    const opened = window.open('/panes.html', 'townmouse-panes');
    if (opened) opened.opener = null;
    else location.assign('/panes.html');
  };

  let readerView = null;
  let readerText = null;

  function refreshReaderView() {
    if (!readerText) return;
    const raw = window.__terminalOne?.text?.() || '';
    const lines = String(raw).replace(/\s+$/, '').split('\n');
    while (lines.length && !lines[0].trim()) lines.shift();
    readerText.textContent = lines.join('\n') || 'No terminal text yet.';
    readerText.scrollTop = 0;
  }

  function closeReaderView() {
    if (!readerView) return;
    readerView.hidden = true;
    try { document.querySelector('.xterm-helper-textarea')?.focus(); } catch (_) { /* no terminal */ }
  }

  function openReaderView() {
    if (!readerView) {
      readerView = document.createElement('section');
      readerView.id = 'reader-view';
      readerView.className = 'reader-view';
      readerView.hidden = true;
      readerView.setAttribute('role', 'dialog');
      readerView.setAttribute('aria-modal', 'true');
      readerView.setAttribute('aria-labelledby', 'reader-title');
      readerView.innerHTML =
        '<header class="reader-header">' +
          '<div><small>Word-wrapped transcript</small><h2 id="reader-title">Reader</h2></div>' +
          '<div class="reader-actions">' +
            '<button type="button" id="reader-refresh">Refresh</button>' +
            '<button type="button" id="reader-close" aria-label="Close reader">Close</button>' +
          '</div>' +
        '</header>' +
        '<pre class="reader-text" id="reader-text" tabindex="0"></pre>';
      readerView.querySelector('#reader-refresh').addEventListener('click', refreshReaderView);
      readerView.querySelector('#reader-close').addEventListener('click', closeReaderView);
      readerView.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') { event.preventDefault(); closeReaderView(); }
      });
      body.append(readerView);
      readerText = readerView.querySelector('#reader-text');
    }
    readerView.hidden = false;
    refreshReaderView();
    readerView.querySelector('#reader-close').focus();
  }

  let attachmentCardTimer = 0;
  function copyAttachmentText(value, success) {
    const fallback = () => {
      const area = document.createElement('textarea');
      area.value = value;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.opacity = '0';
      body.append(area);
      area.select();
      try { document.execCommand('copy'); } catch (_) { /* nothing else to try */ }
      area.remove();
    };
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(value).then(() => T1.toast?.(success), () => { fallback(); T1.toast?.(success); });
    } else {
      fallback();
      T1.toast?.(success);
    }
  }

  function showAttachmentCard(attachment, file) {
    let card = document.getElementById('attachment-card');
    if (!card) {
      card = document.createElement('aside');
      card.id = 'attachment-card';
      card.className = 'attachment-card';
      card.setAttribute('role', 'status');
      card.setAttribute('aria-live', 'polite');
      card.hidden = true;
      card.innerHTML =
        '<div class="attachment-card-head">' +
          '<span class="attachment-card-name"></span>' +
          '<button type="button" class="attachment-card-close" aria-label="Dismiss attachment">×</button>' +
        '</div>' +
        '<div class="attachment-card-row"><span>Path</span><code data-field="path"></code></div>' +
        '<div class="attachment-card-row"><span>URL</span><code data-field="url"></code></div>' +
        '<div class="attachment-card-actions">' +
          '<button type="button" data-attachment-action="copy-path">Copy path</button>' +
          '<button type="button" data-attachment-action="copy-url">Copy URL</button>' +
          '<button type="button" data-attachment-action="open-url">Open URL</button>' +
        '</div>';
      card.addEventListener('click', (event) => {
        const action = event.target.closest('[data-attachment-action]')?.dataset.attachmentAction;
        if (event.target.closest('.attachment-card-close')) {
          card.hidden = true;
          return;
        }
        if (action === 'copy-path') copyAttachmentText(card.dataset.path || '', 'Attachment path copied');
        if (action === 'copy-url') copyAttachmentText(card.dataset.url || '', 'Attachment URL copied');
        if (action === 'open-url' && card.dataset.url) window.open(card.dataset.url, '_blank', 'noopener');
      });
      body.append(card);
    }
    card.dataset.path = attachment.path || '';
    card.dataset.url = attachment.url || '';
    card.querySelector('.attachment-card-name').textContent = `Attached ${file.name || 'file'}`;
    card.querySelector('[data-field="path"]').textContent = attachment.path || '';
    card.querySelector('[data-field="url"]').textContent = attachment.url || '';
    card.hidden = false;
    clearTimeout(attachmentCardTimer);
    attachmentCardTimer = window.setTimeout(() => { card.hidden = true; }, 15000);
  }

  const attachInput = document.createElement('input');
  attachInput.type = 'file';
  attachInput.multiple = true;
  attachInput.accept = 'image/*,.pdf,.txt,.json,.md,.zip';
  attachInput.hidden = true;
  body.append(attachInput);
  $('workspace-attach').onclick = () => attachInput.click();
  attachInput.onchange = async () => {
    const files = Array.from(attachInput.files || []);
    attachInput.value = '';
    for (const file of files) {
      try {
        const response = await fetch('/api/attachments', {
          method: 'POST',
          headers: { 'Content-Type': file.type || 'application/octet-stream', 'X-Filename': encodeURIComponent(file.name || 'attachment') },
          body: file
        });
        const attachment = await response.json();
        if (!response.ok) throw new Error(attachment.error || `Upload failed (${response.status}).`);
        const quoted = `'${String(attachment.path).replace(/'/g, `'\\''`)}'`;
        T1.sendData?.(quoted + ' ');
        showAttachmentCard(attachment, file);
      } catch (error) {
        T1.toast?.(error.message || `Could not attach ${file.name}.`);
      }
    }
  };
  $('workspace-terminal').onclick = hide;
  $('hide-browser').onclick = hide;
  $('hide-browser-compact').onclick = hide;
  $('browser-share-toggle').onclick = toggleShare;
  $('browser-share-bottom').onclick = toggleShare;

  $('workspace-tools').setAttribute('aria-controls', 'workspace-drawer');
  $('workspace-tools').setAttribute('aria-expanded', 'false');
  drawer.addEventListener('close', () => $('workspace-tools').setAttribute('aria-expanded', 'false'));
  $('workspace-tools').onclick = () => {
    filterDrawer('');
    $('tool-filter').value = '';
    drawer.showModal();
    $('workspace-tools').setAttribute('aria-expanded', 'true');
    if (!isTouch()) $('tool-filter').focus();
  };
  $('drawer-close').onclick = () => drawer.close();
  drawer.addEventListener('click', (event) => {
    if (event.target === drawer) { drawer.close(); return; }
    const row = event.target.closest('.drawer-row');
    if (!row || row.classList.contains('drawer-font-row') || row.id === 'closeBtn') return;
    drawer.close();
  });
  drawer.addEventListener('click', (event) => {
    const close = event.target.closest('#closeBtn');
    if (!close) return;
    if (close.dataset.confirmed === '1') { delete close.dataset.confirmed; return; }
    event.preventDefault();
    event.stopPropagation();
    drawer.close();
    closeConfirm.showModal();
  }, true);
  $('tool-filter').oninput = (event) => filterDrawer(event.target.value);

  $('browser-address').onsubmit = safe(async (event) => {
    event.preventDefault();
    let url = $('browser-url').value.trim();
    if (!url) return;
    if (!/^[a-z]+:/i.test(url)) {
      url = /\s/.test(url) || !/[.:]/.test(url)
        ? 'https://www.google.com/search?q=' + encodeURIComponent(url)
        : 'http://' + url;
    }
    setMessage('Loading page…');
    await action('navigate', { url });
    setMessage('Live browser on the terminal host.');
  });
  for (const name of ['back', 'forward', 'reload']) $('browser-' + name).onclick = safe(() => action(name));

  $('browser-share').onchange = safe(async (event) => {
    Object.assign(current, await api('/' + current.id + '/permission', 'POST', { permission: event.target.value }));
    updateBrowserState();
    setMessage(current.permission === 'private'
      ? 'Sharing revoked. Previous connection tokens no longer work.'
      : 'Access changed. Copy a new connection for your agent.');
  });
  $('browser-read').onclick = safe(async () => {
    if (!current) return;
    const data = await api('/' + current.id + '/content');
    const dialog = document.createElement('dialog');
    dialog.className = 'workspace-drawer';
    dialog.setAttribute('aria-label', 'Browser page text');
    const heading = document.createElement('h2');
    heading.textContent = data.title;
    const content = document.createElement('div');
    content.className = 'browser-reading';
    content.textContent = data.text;
    const close = document.createElement('button');
    close.textContent = 'Done';
    close.onclick = () => { dialog.close(); dialog.remove(); };
    dialog.append(heading, close, content);
    body.append(dialog);
    dialog.showModal();
  });
  $('copy-agent').onclick = safe(async () => {
    const access = await api('/' + current.id + '/access');
    const connection = JSON.stringify({ ...access, endpoint: location.origin + access.endpoint });
    try {
      await navigator.clipboard.writeText(connection);
      setMessage('Connection copied. Paste it into your terminal agent.');
    } catch (_) {
      const dialog = document.createElement('dialog');
      dialog.className = 'workspace-drawer';
      dialog.setAttribute('aria-label', 'Agent connection');
      const label = document.createElement('p');
      label.textContent = 'Copy this connection into your terminal agent. Keep it private.';
      const field = document.createElement('textarea');
      field.value = connection;
      field.readOnly = true;
      field.setAttribute('aria-label', 'Agent connection');
      const done = document.createElement('button');
      done.textContent = 'Done';
      done.onclick = () => { dialog.close(); dialog.remove(); };
      dialog.append(label, field, done);
      body.append(dialog);
      dialog.showModal();
      field.select();
    }
  });
  $('close-browser').onclick = safe(() => closeTab(current));

  $('browser-frame').onclick = safe(async (event) => {
    const rect = event.target.getBoundingClientRect();
    await action('click', {
      x: (event.clientX - rect.left) * (current.width || 1280) / rect.width,
      y: (event.clientY - rect.top) * (current.height || 800) / rect.height
    });
  });
  $('browser-frame').onkeydown = safe(async (event) => {
    if (event.key === 'Tab') return;
    event.preventDefault();
    await action('key', { key: event.key === ' ' ? 'Space' : event.key });
  });
  $('browser-frame').addEventListener('wheel', safe(async (event) => {
    event.preventDefault();
    await action('scroll', { deltaY: event.deltaY });
  }), { passive: false });
  $('browser-type').onsubmit = safe(async (event) => {
    event.preventDefault();
    const input = event.target.querySelector('input');
    await action('type', { text: input.value });
    input.value = '';
  });
  $('browser-tab').onclick = safe(() => action('key', { key: 'Tab' }));
  $('browser-enter').onclick = safe(() => action('key', { key: 'Enter' }));

  let touchStart = null;
  $('browser-frame').addEventListener('touchstart', (event) => { touchStart = event.touches[0].clientY; }, { passive: true });
  $('browser-frame').addEventListener('touchend', safe(async (event) => {
    if (touchStart !== null) {
      const delta = touchStart - event.changedTouches[0].clientY;
      touchStart = null;
      if (Math.abs(delta) > 20) await action('scroll', { deltaY: delta });
    }
  }));

  // ── Terminal helper inputs, cursor, reduced motion, keybar ─────────────────
  const helperTextarea = document.querySelector('.xterm-helper-textarea');
  if (helperTextarea) helperTextarea.setAttribute('autocomplete', 'off');
  const newSession = document.querySelector('.t1session-new');
  if (newSession) newSession.setAttribute('aria-label', 'New terminal session');

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const applyTerminalMotion = () => {
    if (!T1.term) return;
    try {
      const term = T1.term;
      term.options.cursorBlink = !reduceMotion.matches;
      if (term.options.theme) {
        // Assign a new object so xterm repaints the cursor with the workspace token.
        term.options.theme = { ...term.options.theme, cursor: '#d6ad68', cursorAccent: '#14171b' };
      }
    } catch (_) { /* the terminal may be disposing during a reconnect */ }
  };
  applyTerminalMotion();
  reduceMotion.addEventListener?.('change', applyTerminalMotion);
  T1.onTermReady?.(() => { applyTerminalMotion(); setTimeout(applyTerminalMotion, 80); });
  document.getElementById('themeSelect')?.addEventListener('change', () => setTimeout(applyTerminalMotion, 0));

  const phoneKeybar = $('keybarIphone');
  if (phoneKeybar && !phoneKeybar.querySelector('.kb-keys-toggle')) {
    const group = phoneKeybar.querySelector('.kb-group');
    if (group) {
      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'kb-key kb-keys-toggle';
      toggle.title = 'More control keys';
      toggle.setAttribute('aria-label', 'More control keys');
      toggle.setAttribute('aria-expanded', 'false');
      toggle.innerHTML = icon('chevron');
      toggle.addEventListener('click', () => {
        const open = phoneKeybar.classList.toggle('keys-expanded');
        toggle.setAttribute('aria-expanded', String(open));
      });
      group.append(toggle);
    }
  }

  const syncKeyboardInset = () => {
    const viewport = window.visualViewport;
    const inset = viewport ? Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop) : 0;
    document.documentElement.style.setProperty('--keyboard-inset', `${Math.round(inset)}px`);
    body.classList.toggle('keyboard-open', inset > 80);
  };
  window.visualViewport?.addEventListener('resize', syncKeyboardInset);
  window.visualViewport?.addEventListener('scroll', syncKeyboardInset);
  syncKeyboardInset();

  $('workspace-server').textContent = location.host ? 'Local server · ' + location.host : 'Local server';

  // The voice feature appends its group after the key bar is built. Move it into
  // the tablet's second grid row so it keeps a stable slot.
  const ipadBar = $('keybarIpad');
  if (ipadBar) {
    const rows = [...ipadBar.querySelectorAll(':scope > .kb-grid-row')];
    if (rows.length) {
      for (const group of [...ipadBar.querySelectorAll(':scope > .kb-group')]) {
        group.dataset.kb = group.dataset.kb || 'voice';
        rows[rows.length - 1].append(group);
      }
    }
  }

  try {
    key = (await api('/bootstrap')).key;
    tabs = await api();
    renderTabs();
  } catch (error) {
    setMessage(error.message);
  }
  setInterval(() => refresh().catch((error) => setMessage(error.message)), 1000);
  // Reconcile the sidebar with the server so a crashed Chromium or a closed
  // context cannot leave a permanently stale tab.
  setInterval(async () => {
    try {
      tabs = await api();
      renderTabs();
    } catch (_) { /* the snapshot loop reports the outage */ }
  }, 5000);
  // The workspace chrome changes the header/keybar heights after the terminal's
  // first fit. Refit once the new layout has settled.
  requestAnimationFrame(() => { T1.fit?.(); window.dispatchEvent(new Event('resize')); });
  setTimeout(() => { T1.fit?.(); }, 200);

  // ── Phone chrome auto-collapse ─────────────────────────────────────────────
  // The terminal and browser are the product. On a phone, all chrome except the
  // bottom navigation collapses after seven seconds without a touch; the next
  // touch brings it back. The first touch on the content only wakes the chrome.
  const phoneChromeQuery = window.matchMedia('(max-width: 699px)');
  const CHROME_IDLE_MS = 7000;
  let chromeIdleTimer = null;

  function chromeIdleBlocked() {
    if (document.hidden) return true;
    if (document.querySelector('dialog[open]')) return true;
    const active = document.activeElement;
    return !!(active && active.matches('input, textarea, select, [contenteditable="true"]') &&
      !active.closest('.terminal-container'));
  }
  function clearChromeIdleTimer() {
    if (chromeIdleTimer) { clearTimeout(chromeIdleTimer); chromeIdleTimer = null; }
  }
  function refitAfterChromeChange() {
    requestAnimationFrame(() => { T1.fit?.(); window.dispatchEvent(new Event('resize')); });
  }
  function collapseChrome() {
    if (!phoneChromeQuery.matches || chromeIdleBlocked()) return;
    body.classList.add('chrome-idle');
    clearChromeIdleTimer();
    refitAfterChromeChange();
  }
  function wakeChrome() {
    if (body.classList.contains('chrome-idle')) {
      body.classList.remove('chrome-idle');
      refitAfterChromeChange();
    }
    scheduleChromeIdle();
  }
  function scheduleChromeIdle() {
    clearChromeIdleTimer();
    if (!phoneChromeQuery.matches) { body.classList.remove('chrome-idle'); return; }
    if (chromeIdleBlocked()) {
      if (!document.hidden) chromeIdleTimer = setTimeout(scheduleChromeIdle, 1000);
      return;
    }
    chromeIdleTimer = setTimeout(() => {
      chromeIdleTimer = null;
      if (chromeIdleBlocked()) scheduleChromeIdle();
      else collapseChrome();
    }, CHROME_IDLE_MS);
  }

  document.addEventListener('pointerdown', () => {
    // Waking the chrome must not eat the gesture: the same tap still reaches
    // the terminal or browser underneath. A second tap is not required.
    wakeChrome();
  }, { capture: true });
  document.addEventListener('keydown', () => wakeChrome(), { capture: true });
  document.addEventListener('input', () => wakeChrome(), { capture: true });
  document.addEventListener('focusin', () => { clearChromeIdleTimer(); scheduleChromeIdle(); });
  document.addEventListener('focusout', () => setTimeout(scheduleChromeIdle, 0));
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) clearChromeIdleTimer();
    else scheduleChromeIdle();
  });
  phoneChromeQuery.addEventListener?.('change', () => {
    if (!phoneChromeQuery.matches) {
      body.classList.remove('chrome-idle');
      clearChromeIdleTimer();
    } else {
      scheduleChromeIdle();
    }
  });
  scheduleChromeIdle();

  window.__workspace = { ready: true };
}
