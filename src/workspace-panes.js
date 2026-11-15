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

function installWorkspacePanes(app, browserWorkspace, options = {}) {
  const port = options.port || Number(process.env.PORT) || 11357;
  const apiUrl = `http://127.0.0.1:${port}/api/panes`;
  const cliPath = path.join(__dirname, '..', 'scripts', 'panes');
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

  const tabs = new Map();
  const panes = new Map();
  let activeTabId = null;
  let activePaneId = null;

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
    return tab;
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
      buffer: '', bufferStart: 0, totalOffset: 0,
      cols: 100, rows: 30, exited: false, createdAt: Date.now()
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
      pane.url = browser.url;
      pane.title = opts.title || browser.title || 'Browser';
    } else {
      pane.title = opts.title || `Terminal ${tab.panes.length + 1}`;
      const env = {
        ...process.env,
        TERM: 'xterm-256color',
        TOWNMOUSE_API: apiUrl,
        TOWNMOUSE_TOKEN: token,
        TOWNMOUSE_TAB_ID: tabId,
        TOWNMOUSE_PANE_ID: pane.id,
        TOWNMOUSE_PANES_CLI: cliPath
      };
      const shell = resolveShell();
      const child = pty.spawn(shell, ['-l'], {
        name: 'xterm-256color', cols: pane.cols, rows: pane.rows,
        cwd: opts.cwd || os.homedir(), env
      });
      pane.pty = child;
      child.onData((data) => {
        pane.buffer += data;
        pane.totalOffset += data.length;
        if (pane.buffer.length > MAX_BUFFER) pane.buffer = pane.buffer.slice(-MAX_BUFFER);
        pane.bufferStart = pane.totalOffset - pane.buffer.length;
      });
      child.onExit(() => { pane.exited = true; });
    }
    tab.panes.push(pane);
    panes.set(pane.id, pane);
    return pane;
  }

  function serializePane(pane) {
    if (pane.kind === 'browser' && pane.browserId) {
      const browser = browserWorkspace.get(pane.browserId);
      if (browser) {
        pane.url = browser.page.url();
        if (!pane.titleLocked) pane.title = browser.title || pane.title;
      }
    }
    return {
      id: pane.id, tabId: pane.tabId, kind: pane.kind, title: pane.title,
      url: pane.url, browserId: pane.browserId, cols: pane.cols, rows: pane.rows,
      status: pane.exited ? 'exited' : 'running',
      active: pane.id === activePaneId
    };
  }
  function serializeTab(tab) {
    return { id: tab.id, title: tab.title, active: tab.id === activeTabId, panes: tab.panes.map(serializePane) };
  }
  function state() {
    return {
      host: os.hostname().replace(/\.local$/i, '').toLowerCase(),
      tabs: [...tabs.values()].map(serializeTab),
      activeTabId, activePaneId,
      limits: { maxTabs: MAX_TABS, maxPanesPerTab: MAX_PANES_PER_TAB, maxTerminalPanes: MAX_TERMINAL_PANES }
    };
  }
  async function ensureInitial() {
    if (tabs.size) return;
    const tab = createTab('Workspace 1');
    const pane = await createPane(tab.id, 'terminal', { title: 'Orchestrator' });
    activeTabId = tab.id;
    activePaneId = pane.id;
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
    killPty(pane);
    if (pane.kind === 'browser' && pane.browserId) browserWorkspace.close(pane.browserId).catch(() => {});
    if (activePaneId === pane.id) {
      const next = tab && tab.panes[0];
      activePaneId = next ? next.id : null;
    }
  }

  app.get('/api/panes/bootstrap', route(async (req, res) => {
    if (req.get('Authorization')) throw Object.assign(new Error('Agent tokens cannot bootstrap the owner workspace.'), { status: 403 });
    const site = req.get('Sec-Fetch-Site');
    if (site && site !== 'same-origin' && site !== 'none') throw Object.assign(new Error('Owner page required.'), { status: 403 });
    await ensureInitial();
    res.json({ token, state: state(), api: apiUrl });
  }));
  app.get('/api/panes/state', auth, route(async (req, res) => res.json(state())));
  app.post('/api/panes/tabs', auth, route(async (req, res) => {
    const tab = createTab(typeof req.body.title === 'string' ? req.body.title.slice(0, 80) : '');
    activeTabId = tab.id;
    activePaneId = tab.panes[0]?.id || null;
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
    res.json({ closed: true, state: state() });
  }));
  app.post('/api/panes/tabs/:id/panes', auth, route(async (req, res) => {
    const pane = await createPane(req.params.id, req.body.kind, {
      url: req.body.url, cwd: req.body.cwd, title: req.body.title
    });
    res.json(serializePane(pane));
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
    res.json(state());
  }));
  app.post('/api/panes/panes/:id/url', auth, route(async (req, res) => {
    const pane = panes.get(req.params.id);
    if (!pane || pane.kind !== 'browser') { res.status(400).json({ error: 'Browser pane required.' }); return; }
    const browser = await browserWorkspace.navigate(pane.browserId, req.body.url);
    pane.url = browser.url;
    if (!pane.titleLocked) pane.title = browser.title || pane.title;
    res.json(serializePane(pane));
  }));
  app.post('/api/panes/panes/:id/browser/action', auth, route(async (req, res) => {
    const pane = panes.get(req.params.id);
    if (!pane || pane.kind !== 'browser') { res.status(400).json({ error: 'Browser pane required.' }); return; }
    const browser = await browserWorkspace.action(pane.browserId, req.body.action, req.body);
    pane.url = browser.url;
    if (!pane.titleLocked) pane.title = browser.title || pane.title;
    res.json(serializePane(pane));
  }));
  app.get('/api/panes/panes/:id/browser/snapshot', auth, route(async (req, res) => {
    const pane = panes.get(req.params.id);
    if (!pane || pane.kind !== 'browser') { res.status(400).json({ error: 'Browser pane required.' }); return; }
    const snap = await browserWorkspace.snapshot(pane.browserId);
    pane.url = snap.url;
    if (!pane.titleLocked) pane.title = snap.title || pane.title;
    res.json(snap);
  }));
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
  app.post('/api/panes/panes/:id/resize', auth, route(async (req, res) => {
    const pane = panes.get(req.params.id);
    if (!pane) { res.status(400).json({ error: 'Pane required.' }); return; }
    if (pane.kind === 'browser') {
      const size = await browserWorkspace.setViewport(pane.browserId, req.body.width, req.body.height);
      res.json(size);
      return;
    }
    if (!pane.pty) { res.status(400).json({ error: 'Terminal pane required.' }); return; }
    pane.cols = Math.max(20, Math.min(400, Math.round(Number(req.body.cols) || 100)));
    pane.rows = Math.max(5, Math.min(200, Math.round(Number(req.body.rows) || 30)));
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
