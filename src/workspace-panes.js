'use strict';
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const pty = require('node-pty');
const { resolveShell } = require('./shell-resolve');

const MAX_PANES_PER_TAB = 4;
const MAX_TABS = 24;
const MAX_TERMINAL_PANES = 24;
const MAX_BUFFER = 200_000;
// HTTP/1.1 browsers allow six connections per origin. Keep two slots free for
// input/state/close so terminal streams cannot starve the controls. Panes over
// this cap fall back to the polling API instead of holding a socket open.
const MAX_ACTIVE_STREAMS = 4;

function installWorkspacePanes(app, browserWorkspace, options = {}) {
  const port = options.port || Number(process.env.PORT) || 11357;
  const apiUrl = `http://127.0.0.1:${port}/api/panes`;
  const cliPath = path.join(__dirname, '..', 'scripts', 'panes');
  const epoch = crypto.randomUUID();
  const tokenDir = path.join(os.homedir(), '.townmouse');
  const tokenFile = path.join(tokenDir, 'pane-token');
  let token = '';
  try { token = fs.readFileSync(tokenFile, 'utf8').trim(); } catch (_) { /* first run */ }
  if (!token) {
    token = crypto.randomBytes(32).toString('hex');
    fs.mkdirSync(tokenDir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(tokenFile, token, { mode: 0o600 });
  }
  try { fs.chmodSync(tokenFile, 0o600); } catch (_) { /* best effort */ }
  // Attachment uploads are owner-gated at the page boundary, but a terminal
  // agent inside the workspace presents this scoped pane token instead.
  app.locals.townmousePaneToken = token;
  const stateDir = process.env.TOWNMOUSE_STATE_DIR || path.join(os.homedir(), '.townmouse');
  const stateFile = path.join(stateDir, 'workspace.json');

  const tabs = new Map();
  const panes = new Map();
  let activeTabId = null;
  let activePaneId = null;
  let restored = false;
  let savedWorkspace = false;
  let restorePromise = null;
  let saveTimer = null;
  let shuttingDown = false;
  let activeStreams = 0;

  const id = (prefix) => prefix + '_' + crypto.randomBytes(6).toString('hex');
  const route = (fn) => async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try { await fn(req, res); }
    catch (error) { res.status(error.status || 400).json({ error: error.message }); }
  };
  app.use('/api/panes', (req, res, next) => {
    if (req.body == null) req.body = {};
    next();
  });
  const auth = (req, res, next) => {
    const supplied = req.get('X-Townmouse-Token') || (req.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    if (supplied !== token) { res.status(403).json({ error: 'Workspace token required.' }); return; }
    next();
  };
  const tabOf = (pane) => tabs.get(pane.tabId) || null;

  function createTab(title) {
    if (tabs.size >= MAX_TABS) {
      throw Object.assign(new Error('Close a workspace tab before opening another.'), { status: 409 });
    }
    const tab = { id: id('t'), title: title || `Workspace ${tabs.size + 1}`, panes: [] };
    tabs.set(tab.id, tab);
    if (!activeTabId) activeTabId = tab.id;
    scheduleSave();
    return tab;
  }

  const clampCols = (value) => Math.max(20, Math.min(400, Math.round(Number(value) || 100)));
  const clampRows = (value) => Math.max(5, Math.min(200, Math.round(Number(value) || 30)));
  const KEY_SEQUENCES = {
    enter: '\r', return: '\r', esc: '\x1b', escape: '\x1b', tab: '\t',
    backspace: '\x7f', delete: '\x1b[3~', space: ' ',
    up: '\x1b[A', down: '\x1b[B', right: '\x1b[C', left: '\x1b[D',
    home: '\x1b[H', end: '\x1b[F', pgup: '\x1b[5~', pgdn: '\x1b[6~',
    pageup: '\x1b[5~', pagedown: '\x1b[6~'
  };

  function keySequence(name) {
    const raw = String(name || '').trim();
    if (!raw || raw.length > 40) throw Object.assign(new Error('Invalid key name.'), { status: 400 });
    const parts = raw.toLowerCase().split('+').filter(Boolean);
    const key = parts.pop();
    let sequence = KEY_SEQUENCES[key];
    if (!sequence && key.length === 1) sequence = key;
    if (!sequence) throw Object.assign(new Error(`Unknown key: ${raw}`), { status: 400 });
    const ctrl = parts.includes('ctrl') || parts.includes('control');
    const alt = parts.includes('alt') || parts.includes('option');
    const shift = parts.includes('shift');
    if (key === 'tab' && shift) sequence = '\x1b[Z';
    else if (ctrl && key.length === 1) sequence = String.fromCharCode(key.charCodeAt(0) & 0x1f);
    if (alt) sequence = '\x1b' + sequence;
    return sequence;
  }

  // A terminal can outrun a slow SSE reader. Honor write backpressure instead
  // of letting Node queue every chunk in memory. Once a reader falls behind we
  // end its stream; the client's polling fallback catches up from /read.
  function sendStreamEvent(stream, event) {
    if (stream._sseBlocked) {
      stream._sseDropped = true;
      return;
    }
    try {
      if (!stream.write(event)) {
        stream._sseBlocked = true;
        stream.once('drain', () => {
          stream._sseBlocked = false;
          if (stream._sseDropped) {
            try { stream.end(); } catch (_) { /* already gone */ }
          }
        });
      }
    } catch (_) {
      stream._sseDropped = true;
      try { stream.end(); } catch (_) { /* already gone */ }
    }
  }

  function startPanePty(pane) {
    const env = {
      ...process.env,
      TERM: 'xterm-256color',
      TOWNMOUSE_API: apiUrl,
      TOWNMOUSE_TOKEN: token,
      TOWNMOUSE_TAB_ID: pane.tabId,
      TOWNMOUSE_PANE_ID: pane.id,
      TOWNMOUSE_PANES_CLI: cliPath
    };
    pane.cwd = pane.cwd || os.homedir();
    const shell = resolveShell();
    const child = pty.spawn(shell, ['-l'], {
      name: 'xterm-256color', cols: pane.cols, rows: pane.rows,
      cwd: pane.cwd, env
    });
    pane.pty = child;
    child.onData((data) => {
      pane.lastOutputAt = Date.now();
      pane.buffer += data;
      pane.totalOffset += data.length;
      if (pane.buffer.length > MAX_BUFFER) pane.buffer = pane.buffer.slice(-MAX_BUFFER);
      pane.bufferStart = pane.totalOffset - pane.buffer.length;
      const event = `data: ${JSON.stringify({ data, offset: pane.totalOffset })}\n\n`;
      for (const stream of pane.streams) sendStreamEvent(stream, event);
    });
    child.onExit((event = {}) => {
      pane.exited = true;
      pane.exitCode = Number.isFinite(Number(event.exitCode)) ? Number(event.exitCode) : null;
      pane.exitSignal = event.signal ?? null;
      pane.lastOutputAt = Date.now();
      pane.agentState = 'done';
      pane.agentStateAt = Date.now();
    });
  }

  async function createPane(tabId, kind, opts = {}) {
    let tab = tabs.get(tabId);
    if (!tab) throw Object.assign(new Error('Workspace tab not found.'), { status: 404 });
    if (tab.panes.length >= MAX_PANES_PER_TAB) {
      throw Object.assign(new Error('A workspace tab holds at most four panes.'), { status: 409 });
    }
    if (kind !== 'browser' && [...panes.values()].filter((pane) => pane.kind === 'terminal').length >= MAX_TERMINAL_PANES) {
      throw Object.assign(new Error('Close a terminal pane before opening another.'), { status: 409 });
    }
    const pane = {
      id: id('p'), tabId, kind: kind === 'browser' ? 'browser' : 'terminal',
      title: opts.title || '', titleLocked: Boolean(opts.title), url: '', browserId: null, pty: null,
      cwd: opts.cwd || null,
      buffer: '', bufferStart: 0, totalOffset: 0, streams: new Set(),
      cols: clampCols(opts.cols), rows: clampRows(opts.rows), exited: false,
      exitCode: null, exitSignal: null, lastOutputAt: Date.now(), createdAt: Date.now(),
      agentState: null, agentMessage: '', agentStateAt: null
    };
    if (pane.kind === 'browser') {
      const browser = await browserWorkspace.create('agent', opts.url);
      tab = tabs.get(tabId);
      if (!tab) {
        await browserWorkspace.close(browser.id).catch(() => {});
        throw Object.assign(new Error('Workspace tab was closed while the browser opened.'), { status: 404 });
      }
      if (tab.panes.length >= MAX_PANES_PER_TAB) {
        await browserWorkspace.close(browser.id).catch(() => {});
        throw Object.assign(new Error('A workspace tab holds at most four panes.'), { status: 409 });
      }
      pane.browserId = browser.id;
      pane.url = browser.url && browser.url !== 'about:blank' ? browser.url : (opts.url || '');
      pane.title = opts.title || browser.title || 'Browser';
    } else {
      pane.title = opts.title || `Terminal ${tab.panes.length + 1}`;
      pane.cwd = opts.cwd || os.homedir();
      // UI-created panes defer the PTY until the client has measured the pane,
      // so the first prompt wraps at the width the user can actually see.
      if (opts.start !== false) startPanePty(pane);
    }
    tab.panes.push(pane);
    panes.set(pane.id, pane);
    scheduleSave();
    return pane;
  }

  function scheduleSave() {
    if (!restored || shuttingDown) return;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      saveState().catch(() => { /* the next mutation retries */ });
    }, 150).unref?.();
  }

  async function saveState() {
    const list = [...tabs.values()];
    const activeIndex = Math.max(0, list.findIndex((tab) => tab.id === activeTabId));
    const activeTab = list[activeIndex];
    const activePaneIndex = activeTab
      ? Math.max(0, activeTab.panes.findIndex((pane) => pane.id === activePaneId))
      : 0;
    const payload = {
      version: 1,
      savedAt: new Date().toISOString(),
      activeTabIndex: activeIndex,
      activePaneIndex,
      tabs: list.map((tab) => ({
        title: tab.title,
        panes: tab.panes.map((pane) => ({
          kind: pane.kind,
          title: pane.titleLocked ? pane.title : undefined,
          url: pane.kind === 'browser' ? pane.url : undefined,
          cwd: pane.kind === 'terminal' ? pane.cwd : undefined,
          cols: pane.kind === 'terminal' ? pane.cols : undefined,
          rows: pane.kind === 'terminal' ? pane.rows : undefined
        }))
      }))
    };
    await fs.promises.mkdir(stateDir, { recursive: true, mode: 0o700 });
    const temp = stateFile + '.tmp';
    await fs.promises.writeFile(temp, JSON.stringify(payload, null, 2), { mode: 0o600 });
    await fs.promises.rename(temp, stateFile);
  }

  async function restoreState() {
    let saved;
    try { saved = JSON.parse(await fs.promises.readFile(stateFile, 'utf8')); }
    catch (_) { return; }
    if (!saved || !Array.isArray(saved.tabs)) return;
    savedWorkspace = true;
    for (const savedTab of saved.tabs.slice(0, MAX_TABS)) {
      const tab = createTab(typeof savedTab.title === 'string' ? savedTab.title : 'Workspace');
      for (const savedPane of (savedTab.panes || []).slice(0, MAX_PANES_PER_TAB)) {
        try {
          // A browser pane that was never navigated saves about:blank, which
          // the address validator correctly rejects. Omitting it creates a
          // fresh blank browser pane instead of silently dropping the pane.
          const savedUrl = typeof savedPane.url === 'string' && savedPane.url !== 'about:blank'
            ? savedPane.url
            : undefined;
          await createPane(tab.id, savedPane.kind === 'browser' ? 'browser' : 'terminal', {
            title: typeof savedPane.title === 'string' ? savedPane.title : undefined,
            url: savedUrl,
            cwd: typeof savedPane.cwd === 'string' ? savedPane.cwd : undefined,
            cols: savedPane.cols,
            rows: savedPane.rows
          });
        } catch (_) { /* one bad pane must not lose the rest of the workspace */ }
      }
    }
    const list = [...tabs.values()];
    if (!list.length) return;
    const active = list[Math.min(Math.max(0, Number(saved.activeTabIndex) || 0), list.length - 1)];
    if (!active) return;
    activeTabId = active.id;
    const pane = active.panes[Math.min(Math.max(0, Number(saved.activePaneIndex) || 0), Math.max(0, active.panes.length - 1))];
    activePaneId = pane ? pane.id : (active.panes[0]?.id || null);
  }

  function serializePane(pane) {
    if (pane.kind === 'browser' && pane.browserId) {
      const browser = browserWorkspace.get(pane.browserId);
      if (browser) {
        const liveUrl = browser.page.url();
        if (liveUrl && liveUrl !== 'about:blank') pane.url = liveUrl;
        if (!pane.titleLocked) pane.title = browser.title || pane.title;
      } else {
        pane.url = '';
        if (!pane.titleLocked) pane.title = 'Browser unavailable';
      }
    }
    return {
      id: pane.id, tabId: pane.tabId, kind: pane.kind, title: pane.title,
      url: pane.url, browserId: pane.browserId,
      cwd: pane.kind === 'terminal' ? pane.cwd : undefined,
      cols: pane.cols, rows: pane.rows,
      status: pane.exited ? 'exited' : (pane.kind === 'terminal' && !pane.pty ? 'starting' : 'running'),
      lastOutputAt: pane.lastOutputAt,
      idleMs: Math.max(0, Date.now() - pane.lastOutputAt),
      exitCode: pane.exitCode,
      exitSignal: pane.exitSignal,
      agentState: pane.agentState,
      agentMessage: pane.agentMessage,
      agentStateAt: pane.agentStateAt,
      active: pane.id === activePaneId
    };
  }
  function serializeTab(tab) {
    return { id: tab.id, title: tab.title, active: tab.id === activeTabId, panes: tab.panes.map(serializePane) };
  }
  function state() {
    return {
      host: os.hostname().replace(/\.local$/i, '').toLowerCase(),
      epoch,
      restored,
      tabs: [...tabs.values()].map(serializeTab),
      activeTabId, activePaneId,
      limits: { maxTabs: MAX_TABS, maxPanesPerTab: MAX_PANES_PER_TAB, maxTerminalPanes: MAX_TERMINAL_PANES }
    };
  }
  function ensureInitial() {
    if (!restorePromise) {
      // Seed exactly once. An intentionally empty workspace (the user closed
      // the last tab) must stay empty across state polls.
      restorePromise = restoreState()
        .catch(() => { /* corrupt state is not fatal */ })
        .then(async () => {
          restored = true;
          if (savedWorkspace || tabs.size) return;
          const tab = createTab('Workspace 1');
          const pane = await createPane(tab.id, 'terminal', { title: 'Orchestrator' });
          activeTabId = tab.id;
          activePaneId = pane.id;
        });
    }
    return restorePromise;
  }
  function killPty(pane) {
    if (!pane.pty) return;
    try { pane.pty.kill('SIGTERM'); } catch (_) { /* already gone */ }
    setTimeout(() => {
      try { pane.pty.kill('SIGKILL'); } catch (_) { /* exited cleanly */ }
    }, 1000).unref?.();
  }
  function closePane(pane) {
    if (!pane) return;
    const tab = tabOf(pane);
    if (tab) tab.panes = tab.panes.filter((candidate) => candidate.id !== pane.id);
    panes.delete(pane.id);
    for (const stream of pane.streams) { try { stream.end(); } catch (_) { /* already closed */ } }
    pane.streams.clear();
    killPty(pane);
    if (pane.kind === 'browser' && pane.browserId) browserWorkspace.close(pane.browserId).catch(() => {});
    if (activePaneId === pane.id) {
      const next = tab && tab.panes[0];
      activePaneId = next ? next.id : null;
    }
    scheduleSave();
  }

  app.get('/api/panes/bootstrap', route(async (req, res) => {
    if (req.get('Authorization')) throw Object.assign(new Error('Agent tokens cannot bootstrap the owner workspace.'), { status: 403 });
    if (!req.isOwner) throw Object.assign(new Error('Owner page required.'), { status: 403 });
    const site = req.get('Sec-Fetch-Site');
    if (site && site !== 'same-origin' && site !== 'none') throw Object.assign(new Error('Owner page required.'), { status: 403 });
    await ensureInitial();
    res.json({ token, state: state(), api: apiUrl });
  }));
  app.get('/api/panes/state', auth, route(async (req, res) => { await ensureInitial(); res.json(state()); }));
  app.post('/api/panes/tabs', auth, route(async (req, res) => {
    await ensureInitial();
    const tab = createTab(typeof req.body.title === 'string' ? req.body.title.slice(0, 80) : '');
    if (req.body.activate !== false) {
      activeTabId = tab.id;
      activePaneId = tab.panes[0]?.id || null;
      scheduleSave();
    }
    res.json(serializeTab(tab));
  }));
  app.delete('/api/panes/tabs/:id', auth, route(async (req, res) => {
    const tab = tabs.get(req.params.id);
    if (!tab) { res.status(404).json({ error: 'Workspace tab not found.' }); return; }
    for (const pane of [...tab.panes]) closePane(pane);
    tabs.delete(tab.id);
    if (activeTabId === tab.id) {
      const next = [...tabs.values()][0];
      activeTabId = next ? next.id : null;
      activePaneId = next?.panes[0]?.id || null;
    }
    scheduleSave();
    res.json({ closed: true, state: state() });
  }));
  app.post('/api/panes/tabs/:id/panes', auth, route(async (req, res) => {
    await ensureInitial();
    const pane = await createPane(req.params.id, req.body.kind, {
      url: req.body.url, cwd: req.body.cwd, title: req.body.title,
      cols: req.body.cols, rows: req.body.rows, start: req.body.start
    });
    res.json(serializePane(pane));
  }));
  app.post('/api/panes/panes/:id/status', auth, route(async (req, res) => {
    const pane = panes.get(req.params.id);
    if (!pane || pane.kind !== 'terminal') { res.status(400).json({ error: 'Terminal pane required.' }); return; }
    const state = String(req.body.state || '').toLowerCase();
    if (!['working', 'blocked', 'idle', 'done', 'unknown'].includes(state)) {
      res.status(400).json({ error: 'State must be working, blocked, idle, done, or unknown.' });
      return;
    }
    pane.agentState = state === 'unknown' ? null : state;
    pane.agentMessage = String(req.body.message || '').slice(0, 1000);
    pane.agentStateAt = Date.now();
    scheduleSave();
    res.json(serializePane(pane));
  }));
  app.post('/api/panes/panes/:id/start', auth, route(async (req, res) => {
    const pane = panes.get(req.params.id);
    if (!pane || pane.kind !== 'terminal') { res.status(400).json({ error: 'Terminal pane required.' }); return; }
    if (pane.exited) { res.status(409).json({ error: 'Terminal pane has exited.' }); return; }
    if (!pane.pty) {
      pane.cols = clampCols(req.body.cols);
      pane.rows = clampRows(req.body.rows);
      startPanePty(pane);
      scheduleSave();
    }
    res.json(serializePane(pane));
  }));
  app.post('/api/panes/tabs/:id/reorder', auth, route(async (req, res) => {
    const tab = tabs.get(req.params.id);
    if (!tab) { res.status(404).json({ error: 'Workspace tab not found.' }); return; }
    const from = tab.panes.findIndex((pane) => pane.id === req.body.paneId);
    if (from < 0) { res.status(404).json({ error: 'Pane not found in this tab.' }); return; }
    const to = Math.max(0, Math.min(tab.panes.length - 1, Math.round(Number(req.body.index))));
    if (!Number.isFinite(to) || to === from) { res.json(state()); return; }
    const [pane] = tab.panes.splice(from, 1);
    tab.panes.splice(to, 0, pane);
    scheduleSave();
    res.json(state());
  }));
  app.delete('/api/panes/panes/:id', auth, route(async (req, res) => {
    const pane = panes.get(req.params.id);
    if (!pane) { res.status(404).json({ error: 'Pane not found.' }); return; }
    closePane(pane);
    res.json({ closed: true, state: state() });
  }));
  app.post('/api/panes/active', auth, route(async (req, res) => {
    if (req.body.tabId && tabs.has(req.body.tabId)) activeTabId = req.body.tabId;
    if (req.body.paneId && panes.has(req.body.paneId)) activePaneId = req.body.paneId;
    scheduleSave();
    res.json(state());
  }));
  app.post('/api/panes/panes/:id/url', auth, route(async (req, res) => {
    const pane = panes.get(req.params.id);
    if (!pane || pane.kind !== 'browser') { res.status(400).json({ error: 'Browser pane required.' }); return; }
    const browser = await browserWorkspace.navigate(pane.browserId, req.body.url);
    pane.url = browser.url;
    if (!pane.titleLocked) pane.title = browser.title || pane.title;
    scheduleSave();
    res.json(serializePane(pane));
  }));
  app.post('/api/panes/panes/:id/browser/action', auth, route(async (req, res) => {
    const pane = panes.get(req.params.id);
    if (!pane || pane.kind !== 'browser') { res.status(400).json({ error: 'Browser pane required.' }); return; }
    const browser = await browserWorkspace.action(pane.browserId, req.body.action, req.body);
    pane.url = browser.url;
    if (!pane.titleLocked) pane.title = browser.title || pane.title;
    if (!['click', 'type', 'key', 'scroll'].includes(req.body.action)) scheduleSave();
    res.json(serializePane(pane));
  }));
  app.post('/api/panes/panes/:id/browser/dialog', auth, route(async (req, res) => {
    const pane = panes.get(req.params.id);
    if (!pane || pane.kind !== 'browser') { res.status(400).json({ error: 'Browser pane required.' }); return; }
    const browser = await browserWorkspace.respondDialog(pane.browserId, req.body.action, req.body.text);
    res.json(browser);
  }));
  app.get('/api/panes/panes/:id/browser/snapshot', auth, route(async (req, res) => {
    const pane = panes.get(req.params.id);
    if (!pane || pane.kind !== 'browser') { res.status(400).json({ error: 'Browser pane required.' }); return; }
    const snap = await browserWorkspace.snapshot(pane.browserId);
    pane.url = snap.url;
    if (!pane.titleLocked) pane.title = snap.title || pane.title;
    res.json(snap);
  }));
  app.get('/api/panes/panes/:id/browser/content', auth, route(async (req, res) => {
    const pane = panes.get(req.params.id);
    if (!pane || pane.kind !== 'browser') { res.status(400).json({ error: 'Browser pane required.' }); return; }
    const browser = browserWorkspace.get(pane.browserId);
    if (!browser) { res.status(404).json({ error: 'Browser pane no longer exists.' }); return; }
    const text = await browser.page.evaluate(() => document.body.innerText);
    res.json({ url: browser.page.url(), title: browser.title || pane.title, text: String(text || '').slice(0, 100000) });
  }));
  app.get('/api/panes/panes/:id/stream', auth, (req, res) => {
    const pane = panes.get(req.params.id);
    if (!pane || pane.kind !== 'terminal') {
      res.status(400).json({ error: 'Terminal pane required.' });
      return;
    }
    if (activeStreams >= MAX_ACTIVE_STREAMS) {
      res.status(429).json({ error: 'Terminal stream capacity reached; polling this pane.' });
      return;
    }
    activeStreams++;
    let ping = null;
    let closed = false;
    const end = () => {
      if (closed) return;
      closed = true;
      if (ping) clearInterval(ping);
      pane.streams.delete(res);
      activeStreams = Math.max(0, activeStreams - 1);
    };
    // Register cleanup before the first write so a client that vanishes during
    // the handshake cannot leak a stream slot forever.
    req.on('close', end);
    res.on('close', end);
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no'
    });
    let since = Math.max(0, Number(req.query.since) || 0);
    if (since < pane.bufferStart) since = pane.bufferStart;
    sendStreamEvent(res, `data: ${JSON.stringify({ data: pane.buffer.slice(since - pane.bufferStart), offset: pane.totalOffset, exited: pane.exited })}\n\n`);
    pane.streams.add(res);
    ping = setInterval(() => {
      if (!res._sseBlocked) {
        try { res.write(': ping\n\n'); } catch (_) { /* client vanished */ }
      }
    }, 15000);
    ping.unref?.();
  });
  app.get('/api/panes/panes/:id/read', auth, route(async (req, res) => {
    const pane = panes.get(req.params.id);
    if (!pane || pane.kind !== 'terminal') { res.status(400).json({ error: 'Terminal pane required.' }); return; }
    let since = Math.max(0, Number(req.query.since) || 0);
    if (since < pane.bufferStart) since = pane.bufferStart;
    res.json({ data: pane.buffer.slice(since - pane.bufferStart), offset: pane.totalOffset, exited: pane.exited });
  }));
  app.post('/api/panes/panes/:id/input', auth, route(async (req, res) => {
    const pane = panes.get(req.params.id);
    if (!pane || pane.kind !== 'terminal' || !pane.pty) { res.status(400).json({ error: 'Terminal pane required.' }); return; }
    pane.pty.write(String(req.body.data ?? ''));
    res.json({ ok: true });
  }));
  app.post('/api/panes/panes/:id/keys', auth, route(async (req, res) => {
    const pane = panes.get(req.params.id);
    if (!pane || pane.kind !== 'terminal' || !pane.pty) { res.status(400).json({ error: 'Terminal pane required.' }); return; }
    const keys = Array.isArray(req.body.keys) ? req.body.keys : [req.body.key];
    if (!keys.length || keys.length > 32) { res.status(400).json({ error: 'Send between 1 and 32 keys.' }); return; }
    const sequence = keys.map(keySequence).join('');
    if (sequence.length > 4096) { res.status(400).json({ error: 'Key sequence is too large.' }); return; }
    pane.pty.write(sequence);
    res.json({ ok: true, bytes: sequence.length });
  }));
  app.get('/api/panes/panes/:id/wait', auth, route(async (req, res) => {
    const pane = panes.get(req.params.id);
    if (!pane || pane.kind !== 'terminal') { res.status(400).json({ error: 'Terminal pane required.' }); return; }
    const timeout = Math.max(100, Math.min(120000, Number(req.query.timeout) || 30000));
    const since = req.query.since === undefined ? pane.totalOffset : Math.max(0, Number(req.query.since) || 0);
    const match = typeof req.query.match === 'string' ? req.query.match : '';
    const pattern = typeof req.query.regex === 'string' ? req.query.regex : '';
    const idleMs = Math.max(0, Math.min(120000, Number(req.query.idleMs) || 0));
    const state = typeof req.query.state === 'string' ? req.query.state.toLowerCase() : '';
    if (state && !['working', 'blocked', 'idle', 'done', 'unknown'].includes(state)) {
      res.status(400).json({ error: 'Unknown agent state.' });
      return;
    }
    if (!match && !pattern && !idleMs && !state) {
      res.status(400).json({ error: 'Provide match, regex, idleMs, or state.' });
      return;
    }
    let matcher = null;
    if (pattern) {
      try { matcher = new RegExp(pattern, 'im'); }
      catch (error) { res.status(400).json({ error: `Invalid regex: ${error.message}` }); return; }
    }
    const started = Date.now();
    const result = await new Promise((resolve) => {
      let timer = null;
      let finished = false;
      const finish = (payload) => {
        if (finished) return;
        finished = true;
        if (timer) clearInterval(timer);
        resolve(payload);
      };
      const snapshot = (matched, reason) => {
        const data = pane.buffer.slice(Math.max(0, since - pane.bufferStart));
        finish({
          matched, reason,
          data: data.slice(-100000),
          offset: pane.totalOffset,
          idleMs: Math.max(0, Date.now() - pane.lastOutputAt),
          agentState: pane.agentState,
          agentMessage: pane.agentMessage,
          elapsedMs: Date.now() - started
        });
      };
      const check = () => {
        const data = pane.buffer.slice(Math.max(0, since - pane.bufferStart));
        if (state && pane.agentState === state) return snapshot(true, 'state');
        if (match && data.includes(match)) return snapshot(true, 'match');
        if (matcher && matcher.test(data)) return snapshot(true, 'match');
        if (idleMs && Date.now() - pane.lastOutputAt >= idleMs) return snapshot(true, 'idle');
        if (Date.now() - started >= timeout) return snapshot(false, 'timeout');
      };
      timer = setInterval(check, 100);
      timer.unref?.();
      check();
      res.on('close', () => finish({ aborted: true }));
    });
    if (!res.writableEnded) res.json(result);
  }));
  app.post('/api/panes/panes/:id/resize', auth, route(async (req, res) => {
    const pane = panes.get(req.params.id);
    if (!pane) { res.status(400).json({ error: 'Pane required.' }); return; }
    if (pane.kind === 'browser') {
      const size = await browserWorkspace.setViewport(pane.browserId, req.body.width, req.body.height);
      res.json(size);
      return;
    }
    pane.cols = clampCols(req.body.cols);
    pane.rows = clampRows(req.body.rows);
    if (!pane.pty) {
      // A deferred pane is about to start at these measured dimensions.
      res.json({ cols: pane.cols, rows: pane.rows });
      return;
    }
    pane.pty.resize(pane.cols, pane.rows);
    res.json({ cols: pane.cols, rows: pane.rows });
  }));
  app.post('/api/panes/panes/:id/command', auth, route(async (req, res) => {
    const pane = panes.get(req.params.id);
    if (!pane || pane.kind !== 'terminal' || !pane.pty) { res.status(400).json({ error: 'Terminal pane required.' }); return; }
    const command = String(req.body.command || '').replace(/\r?\n$/, '');
    pane.pty.write(command + '\n');
    await new Promise((resolve) => setTimeout(resolve, Number(req.body.waitMs) || 300));
    res.json({ ok: true, output: pane.buffer.slice(-4000), offset: pane.totalOffset });
  }));

  async function closeAll() {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    if (restored) await saveState().catch(() => { /* best effort on shutdown */ });
    shuttingDown = true;
    for (const pane of [...panes.values()]) {
      killPty(pane);
      if (pane.kind === 'browser' && pane.browserId) {
        await browserWorkspace.close(pane.browserId).catch(() => {});
      }
    }
    panes.clear();
    tabs.clear();
  }

  return { closeAll, state };
}

module.exports = { installWorkspacePanes };
