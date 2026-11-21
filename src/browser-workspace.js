'use strict';
const crypto = require('crypto');
const puppeteer = require('puppeteer');
const dom = require('./browser-dom');
const { resolveChrome, missingBrowserMessage } = require('./chrome-resolve');

// How many past observations a session keeps. Enough for an agent to compare a
// few steps back; bounded so a long session cannot grow without limit.
const MAX_OBSERVATIONS = 20;
// Ref records are cheap but should not accumulate forever across navigations.
const MAX_REF_RECORDS = 4000;
const MAX_ACTION_TEXT = 10000;

// Action result statuses. These distinguish "the instruction was received" from
// "the instruction happened", which is the point of the assessment.
const STATUS = {
  completed: 'completed',
  missing: 'missing',
  wrongKind: 'wrong-kind',
  failed: 'failed',
  stale: 'stale',
  unconfirmed: 'unconfirmed'
};

const STATUS_HTTP = {
  completed: 200,
  missing: 404,
  'wrong-kind': 400,
  failed: 500,
  stale: 409,
  unconfirmed: 200
};

function installBrowserWorkspace(app) {
  const humanKey = crypto.randomBytes(32).toString('hex');
  const MAX_BROWSER_TABS = 32;
  const sessions = new Map();
  let browserPromise;
  let opening = 0;
  let observationCounter = 0;

  const resolveEngine = () => resolveChrome();
  const engineStatus = () => {
    const chrome = resolveEngine();
    return chrome
      ? { engine: 'ready', path: chrome.path, source: chrome.source }
      : { engine: 'missing', path: null, source: null };
  };

  const engine = () => {
    if (!browserPromise) {
      // Keep Chromium's renderer sandbox by default. Containers and CI runners
      // without user namespaces need an explicit opt-out; it is never implied
      // by running with elevated privileges or by opening an untrusted page.
      const unsandboxed = process.env.CI === 'true' || process.env.TOWNMOUSE_CHROMIUM_NO_SANDBOX === '1';
      // A packaged install may have neither Puppeteer's download (npm 12 skips
      // install scripts) nor a configured path; find an existing browser first.
      const chrome = resolveEngine();
      browserPromise = puppeteer.launch({
        headless: true,
        args: [
          ...(unsandboxed ? ['--no-sandbox', '--disable-setuid-sandbox'] : []),
          '--disable-dev-shm-usage', '--disable-gpu', '--disable-background-timer-throttling',
          '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'
        ],
        ...(chrome ? { executablePath: chrome.path } : {})
      }).then((browser) => {
        browser.on('disconnected', () => {
          browserPromise = null;
          // Every session belonged to the dead browser. Clearing the map lets
          // the UI reconcile instead of offering unclosable ghost tabs.
          sessions.clear();
        });
        return browser;
      }).catch((error) => {
        browserPromise = null;
        if (!chrome) throw new Error(`${missingBrowserMessage()}\n\n${error.message}`);
        throw error;
      });
    }
    return browserPromise;
  };

  const human = (req) => req.get('X-Workspace-Key') === humanKey;

  const describe = (s) => ({
    id: s.id,
    kind: s.kind,
    permission: s.permission,
    url: s.page.url(),
    title: s.title || 'New tab',
    dialog: s.dialog || null,
    sizing: s.sizing,
    viewport: { width: s.width, height: s.height }
  });

  // Screenshot capture and viewport changes share one page. Serialize them or
  // a resize can land mid-capture and label an old-size image with new
  // dimensions, which makes pane click mapping land in the wrong place.
  const enqueue = (s, task) => {
    const work = (s.queue || Promise.resolve()).then(task, task);
    s.queue = work.catch(() => {});
    return work;
  };

  // Work that touches the page is serialized by the operation itself (each
  // `…Tab` function calls `enqueue`). The route wrapper must not enqueue again:
  // nesting the same queue would make the inner task wait for the outer one.
  const route = (fn) => async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      await fn(req, res);
    } catch (error) {
      const body = error.body || { error: error.message };
      res.status(error.status || 400).json(body);
    }
  };

  function deny(message, status = 403, body) {
    throw Object.assign(new Error(message), { status, body });
  }

  function session(req, control = false) {
    const s = sessions.get(req.params.id);
    if (!s) deny('Browser tab no longer exists.', 404);
    if (s.internal) deny('This browser belongs to a pane workspace.', 403);
    if (!human(req)) {
      if (req.get('Authorization') !== 'Bearer ' + s.token) deny('Browser access token required.');
      if (s.permission === 'private' || (control && s.permission !== 'control')) deny('The owner has not granted this browser permission.');
    }
    return s;
  }

  function address(value) {
    const u = new URL(value);
    if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password) {
      deny('Use an HTTP or HTTPS address without embedded credentials.', 400);
    }
    return u.href;
  }

  // A popup can fire before its main frame exists; calling popup.url() then
  // throws asynchronously and used to take the whole server down. Never let
  // popup bookkeeping escape the emitter.
  function followPopup(popup, page) {
    void (async () => {
      try {
        await Promise.resolve();
        let popupUrl = '';
        try { popupUrl = popup.url(); } catch (_) { popupUrl = ''; }
        if (!popupUrl || popupUrl === 'about:blank') {
          // window.open('', name) starts blank and is navigated by script a
          // moment later. Wait for the real address before deciding.
          popupUrl = await new Promise((resolve) => {
            const timer = setTimeout(() => {
              try { resolve(popup.url()); } catch (_) { resolve(''); }
            }, 2500);
            const check = () => {
              let candidate = '';
              try { candidate = popup.url(); } catch (_) { /* frame not ready */ }
              if (candidate && candidate !== 'about:blank') {
                clearTimeout(timer);
                resolve(candidate);
              }
            };
            popup.on('framenavigated', check);
            popup.on('load', check);
            popup.once('close', () => { clearTimeout(timer); resolve(''); });
          });
        }
        await popup.close().catch(() => {});
        if (popupUrl && popupUrl !== 'about:blank' && /^https?:/i.test(popupUrl)) {
          await page.goto(address(popupUrl)).catch(() => {});
        }
      } catch (_) {
        try { await popup.close(); } catch (_) { /* already gone */ }
      }
    })();
  }

  // A JS dialog blocks the page until answered. Keep it open long enough for
  // the human or agent to answer through the UI/API, then dismiss so a forgotten
  // tab cannot stay wedged forever. Never dismiss silently at t=0.
  function attachDialog(s) {
    s.page.on('dialog', (dialog) => {
      clearTimeout(s.dialogTimer);
      s.dialog = {
        id: crypto.randomUUID(),
        type: dialog.type(),
        message: dialog.message(),
        defaultValue: typeof dialog.defaultValue === 'function' ? dialog.defaultValue() : '',
        at: new Date().toISOString()
      };
      s.pendingDialog = dialog;
      s.dialogTimer = setTimeout(async () => {
        if (s.pendingDialog !== dialog) return;
        s.pendingDialog = null;
        s.lastDialog = { ...s.dialog, timedOut: true };
        s.dialog = null;
        try { await dialog.dismiss(); } catch (_) { /* page or dialog already gone */ }
      }, 30000);
      s.dialogTimer.unref?.();
    });
  }

  async function respondDialog(id, action, text) {
    const s = sessions.get(id);
    if (!s) deny('Browser pane no longer exists.', 404);
    if (!['accept', 'dismiss'].includes(action)) deny('Dialog action must be accept or dismiss.', 400);
    const dialog = s.pendingDialog;
    if (!dialog) deny('No page dialog is waiting for an answer.', 409);
    clearTimeout(s.dialogTimer);
    s.dialogTimer = null;
    s.lastDialog = { ...s.dialog, answered: action, answeredAt: new Date().toISOString() };
    s.pendingDialog = null;
    s.dialog = null;
    try {
      if (action === 'accept') await dialog.accept(typeof text === 'string' ? text : undefined);
      else await dialog.dismiss();
    } catch (error) {
      deny(`The page dialog could not be answered: ${error.message}`, 409);
    }
    return describe(s);
  }

  // ── Observation bookkeeping ───────────────────────────────────────────────

  function currentPage(s) {
    return {
      width: s.width,
      height: s.height,
      url: (() => { try { return s.page.url(); } catch (_) { return ''; } })(),
      title: s.title || ''
    };
  }

  function recordObservation(s, extra = {}) {
    observationCounter += 1;
    const observation = {
      id: observationCounter,
      capturedAt: new Date().toISOString(),
      width: s.width,
      height: s.height,
      scrollX: 0,
      scrollY: 0,
      url: (() => { try { return s.page.url(); } catch (_) { return ''; } })(),
      title: s.title || '',
      revision: s.revision,
      layoutHash: '',
      ...extra
    };
    s.observations.set(observation.id, observation);
    s.observationOrder.push(observation.id);
    while (s.observationOrder.length > MAX_OBSERVATIONS) {
      const evicted = s.observationOrder.shift();
      s.observations.delete(evicted);
    }
    s.lastObservationId = observation.id;
    return observation;
  }

  function rememberRef(s, descriptor, observationId) {
    s.refRecords.set(descriptor.ref, {
      observationId,
      role: descriptor.role,
      name: descriptor.name,
      tag: descriptor.tag,
      frame: descriptor.frame,
      seenAt: Date.now()
    });
    while (s.refRecords.size > MAX_REF_RECORDS) {
      const oldest = s.refRecords.keys().next();
      if (oldest.done) break;
      s.refRecords.delete(oldest.value);
    }
  }

  // ── Action helpers ────────────────────────────────────────────────────────

  function result(status, extra = {}) {
    return {
      ok: status !== STATUS.stale && status !== STATUS.missing && status !== STATUS.failed && status !== STATUS.wrongKind,
      status,
      httpStatus: STATUS_HTTP[status] || 200,
      ...extra
    };
  }

  function parseKeyCombo(spec) {
    const raw = String(spec || '').trim();
    if (!raw || raw.length > 60) deny('Invalid key name.', 400);
    const parts = raw.split('+').map((part) => part.trim()).filter(Boolean);
    const keyToken = parts.pop();
    if (!keyToken) deny('Invalid key name.', 400);
    const modifiers = { ctrl: false, alt: false, shift: false, meta: false };
    for (const part of parts) {
      const name = part.toLowerCase();
      if (name === 'ctrl' || name === 'control') modifiers.ctrl = true;
      else if (name === 'alt' || name === 'option') modifiers.alt = true;
      else if (name === 'shift') modifiers.shift = true;
      else if (name === 'meta' || name === 'cmd' || name === 'command' || name === 'super') modifiers.meta = true;
      else deny(`Unknown modifier: ${part}`, 400);
    }
    // Puppeteer accepts single characters as-is and named keys in title case.
    const named = {
      enter: 'Enter', return: 'Enter', esc: 'Escape', escape: 'Escape', tab: 'Tab',
      space: ' ', backspace: 'Backspace', delete: 'Delete', insert: 'Insert',
      up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight',
      home: 'Home', end: 'End', pageup: 'PageUp', pagedown: 'PageDown'
    };
    const lower = keyToken.toLowerCase();
    let key = named[lower];
    if (!key) {
      if (keyToken.length === 1) key = keyToken;
      else if (/^f\d{1,2}$/i.test(keyToken)) key = keyToken.toUpperCase();
      else key = keyToken;
    }
    return { key, modifiers };
  }

  async function pressCombo(page, spec) {
    const { key, modifiers } = parseKeyCombo(spec);
    const down = [];
    if (modifiers.ctrl) down.push('Control');
    if (modifiers.alt) down.push('Alt');
    if (modifiers.shift) down.push('Shift');
    if (modifiers.meta) down.push('Meta');
    for (const modifier of down) await page.keyboard.down(modifier);
    try {
      await page.keyboard.press(key);
    } finally {
      for (const modifier of down.reverse()) await page.keyboard.up(modifier);
    }
  }

  function point(s, data) {
    const x = Number(data.x);
    const y = Number(data.y);
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x > s.width || y > s.height) {
      deny('Invalid pointer position.', 400);
    }
    return { x, y };
  }

  async function targetFromRef(s, ref) {
    if (!ref || typeof ref !== 'string') deny('A ref is required.', 400);
    const handle = await dom.resolveRef(s.page, ref);
    if (!handle) {
      const record = s.refRecords.get(ref);
      const stale = record && record.observationId !== undefined && !s.observations.has(record.observationId);
      return {
        status: STATUS.missing,
        message: stale || !record
          ? `Element ${ref} is not on the page. Look again with a fresh observation.`
          : `Element ${ref} is no longer present.`
      };
    }
    // Identity check: the marker could survive while the node was replaced by a
    // different control in a re-render.
    let current = null;
    try {
      current = await handle.evaluate((node) => ({
        tag: node.tagName ? node.tagName.toLowerCase() : '',
        role: (node.getAttribute && node.getAttribute('role')) || '',
        name: ((node.getAttribute && (node.getAttribute('aria-label') || node.getAttribute('placeholder'))) || '')
          || (node.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 160),
        box: (() => {
          const rect = node.getBoundingClientRect();
          return { x: Math.round(rect.left), y: Math.round(rect.top), width: Math.round(rect.width), height: Math.round(rect.height) };
        })()
      }));
    } catch (_) { current = null; }
    const record = s.refRecords.get(ref);
    // A surviving marker normally means the same node. The tag check catches a
    // cloned or replaced node that inherited the attribute. The label is not
    // compared: text legitimately changes on the same control ("Save" →
    // "Saved") and that is not a stale target.
    const stale = Boolean(record && current && record.tag && current.tag && record.tag !== current.tag);
    return { status: stale ? STATUS.stale : STATUS.completed, handle, current, record };
  }

  async function assertFreshObservation(s, observationId) {
    const id = Number(observationId);
    if (!Number.isFinite(id)) deny('observation must be a number.', 400);
    const observation = s.observations.get(id);
    if (!observation) {
      deny('That observation is out of date. Look again before clicking.', 409, {
        ok: false,
        status: STATUS.stale,
        code: 'STALE_OBSERVATION',
        message: `Observation ${id} is no longer held. Take a fresh observation and use its numbers.`,
        latestObservationId: s.lastObservationId || null
      });
    }
    const current = await dom.signature(s.page);
    const changed = observation.revision !== s.revision ||
      observation.layoutHash !== current.hash ||
      Math.abs((observation.scrollX || 0) - current.scrollX) > 2 ||
      Math.abs((observation.scrollY || 0) - current.scrollY) > 2;
    if (changed) {
      deny('That target is out of date. Look again before clicking.', 409, {
        ok: false,
        status: STATUS.stale,
        code: 'STALE_OBSERVATION',
        message: 'The page changed since that observation. Look again before clicking, then use the fresh observation\'s numbers.',
        observationId: id,
        latestObservationId: s.lastObservationId || null
      });
    }
    return observation;
  }

  // ── Sessions ──────────────────────────────────────────────────────────────

  function initSession(fields) {
    return {
      observations: new Map(),
      observationOrder: [],
      lastObservationId: null,
      refRecords: new Map(),
      nextRef: 0,
      revision: 0,
      sizing: 'fit',
      fixedWidth: 1280,
      fixedHeight: 800,
      queue: Promise.resolve(),
      ...fields
    };
  }

  function wireSession(s) {
    attachDialog(s);
    s.page.on('popup', (popup) => followPopup(popup, s.page));
    // Any navigation in any frame invalidates coordinate targets, because the
    // layout is no longer the one that was observed.
    s.page.on('framenavigated', () => { s.revision += 1; });
  }

  // Internal control surface for the pane workspace. These bypass the human
  // header key because the caller already holds the pane workspace token.
  async function createTab(kind = 'agent', url) {
    if (sessions.size + opening >= MAX_BROWSER_TABS) deny('Close a browser pane before opening another.', 409);
    opening++;
    let context;
    let s;
    try {
      context = await (await engine()).createBrowserContext();
      const page = await context.newPage();
      await page.setViewport({ width: 1280, height: 800 });
      s = initSession({
        id: crypto.randomUUID(),
        token: crypto.randomBytes(32).toString('hex'),
        page,
        context,
        kind,
        width: 1280,
        height: 800,
        permission: kind === 'agent' ? 'control' : 'private',
        internal: true
      });
      wireSession(s);
      // Register before navigation. A page that opens a dialog on load would
      // otherwise block goto while the pane is invisible and impossible to
      // answer; the snapshot route can now return the dialog immediately.
      sessions.set(s.id, s);
      page.once('close', () => sessions.delete(s.id));
      if (url) {
        s.navigation = page.goto(address(url), { waitUntil: 'domcontentloaded', timeout: 30000 })
          .then(() => page.title())
          .then((title) => { s.title = title; })
          .catch(() => { /* the snapshot route reports the failure */ });
      } else {
        s.title = await page.title();
      }
      return describe(s);
    } catch (error) {
      if (s) sessions.delete(s.id);
      if (context) await context.close().catch(() => {});
      throw error;
    } finally {
      opening--;
    }
  }

  async function historyState(s) {
    let client = null;
    try {
      client = await s.page.createCDPSession();
      const history = await client.send('Page.getNavigationHistory');
      return {
        canGoBack: Number(history.currentIndex) > 0,
        canGoForward: Number(history.currentIndex) < (history.entries || []).length - 1
      };
    } catch (_) {
      return { canGoBack: false, canGoForward: false };
    } finally {
      if (client) await client.detach().catch(() => {});
    }
  }

  async function capture(s) {
    const client = await s.page.createCDPSession();
    try {
      return await client.send('Page.captureScreenshot', { format: 'jpeg', quality: 75, captureBeyondViewport: false }, { timeout: 10000 });
    } finally {
      await client.detach().catch(() => {});
    }
  }

  async function refreshTitle(s) {
    try { s.title = await s.page.title(); } catch (_) { /* page gone */ }
  }

  async function snapshotTab(id, options = {}) {
    const s = sessions.get(id);
    if (!s) deny('Browser pane no longer exists.', 404);
    return enqueue(s, async () => {
      // CDP screenshot waits for a JS dialog and times out. Keep the last
      // frame, but return the dialog so the human/agent can answer it.
      if (s.pendingDialog) {
        return {
          ...describe(s),
          ...(await historyState(s)),
          image: null,
          width: s.width,
          height: s.height,
          dialog: s.dialog,
          page: { ...currentPage(s), scrollX: 0, scrollY: 0 }
        };
      }
      await s.page.bringToFront();
      const captureResult = await capture(s);
      await refreshTitle(s);
      // A cheap position read: the full layout signature is only needed when
      // deciding whether a coordinate target is still valid.
      const info = await dom.scrollPosition(s.page);
      return {
        ...describe(s),
        ...(await historyState(s)),
        image: captureResult.data,
        width: s.width,
        height: s.height,
        page: {
          width: s.width,
          height: s.height,
          scrollX: info.scrollX,
          scrollY: info.scrollY,
          url: s.page.url(),
          title: s.title || '',
          capturedAt: new Date().toISOString(),
          revision: s.revision
        },
        ...(options.observation ? { observation: recordObservation(s, { scrollX: info.scrollX, scrollY: info.scrollY, layoutHash: info.hash }) } : {})
      };
    });
  }

  /**
   * A named observation: screenshot plus a label describing exactly what the
   * agent is looking at, and optionally the controls with stable refs.
   */
  async function observeTab(id, options = {}) {
    const s = sessions.get(id);
    if (!s) deny('Browser pane no longer exists.', 404);
    return enqueue(s, async () => {
      let image = null;
      let history = null;
      if (s.pendingDialog) {
        history = await historyState(s);
      } else {
        await s.page.bringToFront();
        image = (await capture(s)).data;
        history = await historyState(s);
      }
      await refreshTitle(s);
      const info = await dom.signature(s.page);
      const observation = recordObservation(s, {
        scrollX: info.scrollX,
        scrollY: info.scrollY,
        layoutHash: info.hash,
        dialog: s.dialog || null
      });
      const payload = {
        ...describe(s),
        ...(history || {}),
        observation,
        width: s.width,
        height: s.height,
        image,
        dialog: s.dialog || null
      };
      if (options.elements) {
        const catalogued = await dom.catalog(s.page, { max: options.max, start: s.nextRef });
        s.nextRef = Math.max(s.nextRef, catalogued.nextRef);
        for (const element of catalogued.elements) rememberRef(s, element, observation.id);
        payload.elements = catalogued.elements;
        payload.frameCount = catalogued.frameCount;
        payload.truncated = catalogued.elements.length >= Math.max(1, Math.min(500, Number(options.max) || 200));
      }
      return payload;
    });
  }

  async function elementsTab(id, options = {}) {
    const s = sessions.get(id);
    if (!s) deny('Browser pane no longer exists.', 404);
    return enqueue(s, async () => {
      await refreshTitle(s);
      const info = await dom.signature(s.page);
      const observation = recordObservation(s, {
        scrollX: info.scrollX,
        scrollY: info.scrollY,
        layoutHash: info.hash,
        elementsOnly: true
      });
      const catalogued = await dom.catalog(s.page, { max: options.max, start: s.nextRef });
      s.nextRef = Math.max(s.nextRef, catalogued.nextRef);
      for (const element of catalogued.elements) rememberRef(s, element, observation.id);
      return {
        ...describe(s),
        observation,
        elements: catalogued.elements,
        frameCount: catalogued.frameCount,
        truncated: catalogued.elements.length >= Math.max(1, Math.min(500, Number(options.max) || 200))
      };
    });
  }

  async function contentTab(id, options = {}) {
    const s = sessions.get(id);
    if (!s) deny('Browser pane no longer exists.', 404);
    return enqueue(s, async () => {
      const info = await dom.content(s.page, options.limit || 200000);
      await refreshTitle(s);
      return {
        ...describe(s),
        text: info.text,
        totalLength: info.totalLength,
        truncated: info.truncated,
        frameCount: info.frameCount,
        frames: info.frames,
        url: info.url || s.page.url(),
        title: s.title || info.title || ''
      };
    });
  }

  async function navigateTab(id, url) {
    const s = sessions.get(id);
    if (!s) deny('Browser pane no longer exists.', 404);
    return enqueue(s, async () => {
      await s.page.goto(address(url), { waitUntil: 'domcontentloaded', timeout: 20000 });
      // Read the title *after* the navigation. Returning the new address with
      // the previous page's title was the bug reported in the assessment.
      await refreshTitle(s);
      return describe(s);
    });
  }

  // What is under a coordinate: a select or a date-like input has a value the
  // human UI can offer a native picker for.
  const readControlAt = (p, position) => p.evaluate(({ x, y }) => {
    const el = document.elementFromPoint(x, y);
    if (!el) return null;
    if (el.tagName === 'SELECT') {
      return {
        kind: 'select',
        value: el.value,
        options: Array.from(el.options).map((option) => ({ value: option.value, label: option.textContent || option.value }))
      };
    }
    if (el.tagName === 'INPUT' && ['date', 'color', 'time', 'datetime-local', 'month', 'week'].includes(el.type)) {
      return { kind: el.type, value: el.value };
    }
    return null;
  }, position).catch(() => null);

  async function readControlValue(handle) {
    if (!handle) return null;
    try {
      return await handle.evaluate((node) => {
        if (!node || !('value' in node)) return null;
        return {
          tag: node.tagName ? node.tagName.toLowerCase() : '',
          type: String(node.type || ''),
          value: String(node.value == null ? '' : node.value).slice(0, 400)
        };
      });
    } catch (_) { return null; }
  }

  // The body runs inside the session queue so an action cannot interleave with
  // a screenshot or a viewport change on the same page.
  async function performAction(s, action, data = {}) {
    const p = s.page;
    let control = null;
    let target = null;
    let actionStatus = STATUS.completed;
    let message = '';
    let warning = '';
    let handle = null;

    const resolveTarget = async () => {
      if (data.ref) {
        const resolved = await targetFromRef(s, data.ref);
        if (resolved.status !== STATUS.completed) {
          actionStatus = resolved.status;
          message = resolved.message || '';
          return false;
        }
        handle = resolved.handle;
        target = resolved.current && {
          ref: data.ref,
          role: resolved.current.role || resolved.record?.role,
          name: resolved.record?.name || resolved.current.name,
          box: resolved.current.box
        };
        return true;
      }
      return false;
    };

    try {
      switch (action) {
        case 'navigate': await p.goto(address(data.url), { waitUntil: 'domcontentloaded', timeout: 20000 }); break;
        case 'back': await p.goBack({ waitUntil: 'domcontentloaded', timeout: 20000 }); break;
        case 'forward': await p.goForward({ waitUntil: 'domcontentloaded', timeout: 20000 }); break;
        case 'reload': await p.reload({ waitUntil: 'domcontentloaded', timeout: 20000 }); break;
        case 'click': {
          if (data.ref) {
            if (await resolveTarget()) {
              if (target && target.box && target.box.width === 0) {
                actionStatus = STATUS.failed; message = 'The target has no clickable area.';
              } else {
                await handle.click({ timeout: 10000 });
                control = await readControlValue(handle);
              }
            }
          } else {
            const position = point(s, data);
            if (data.observationId !== undefined && data.observationId !== null) {
              await assertFreshObservation(s, data.observationId);
            } else {
              warning = 'unverified-position';
            }
            await p.mouse.click(position.x, position.y);
            control = await readControlAt(p, position);
          }
          break;
        }
        case 'hover': {
          if (data.ref) {
            // Stay with the reported status when the ref is gone; do not fall
            // through to a coordinate path that was never supplied.
            if (await resolveTarget()) await handle.hover();
          } else if (data.x !== undefined && data.y !== undefined) {
            const position = point(s, data);
            await p.mouse.move(position.x, position.y);
          } else {
            deny('hover needs a ref or x/y coordinates.', 400);
          }
          break;
        }
        case 'drag': {
          if (!(data.fromRef || data.fromX !== undefined) || !(data.toRef || data.toX !== undefined)) {
            deny('drag needs fromRef/toRef or fromX/toX.', 400);
          }
          let from = null;
          let to = null;
          if (data.fromRef) {
            const resolved = await targetFromRef(s, data.fromRef);
            if (resolved.status !== STATUS.completed) { actionStatus = resolved.status; message = resolved.message || ''; break; }
            from = await resolved.handle.boundingBox();
          } else if (data.fromX !== undefined) {
            from = { x: Number(data.fromX), y: Number(data.fromY), width: 0, height: 0 };
          }
          if (data.toRef) {
            const resolved = await targetFromRef(s, data.toRef);
            if (resolved.status !== STATUS.completed) { actionStatus = resolved.status; message = resolved.message || ''; break; }
            to = await resolved.handle.boundingBox();
          } else if (data.toX !== undefined) {
            to = { x: Number(data.toX), y: Number(data.toY), width: 0, height: 0 };
          }
          if (!from || !to) {
            actionStatus = STATUS.failed;
            message = 'A drag target has no visible area to grab.';
            break;
          }
          await p.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
          await p.mouse.down();
          await p.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 12 });
          await p.mouse.up();
          target = { from: { x: from.x, y: from.y }, to: { x: to.x, y: to.y } };
          break;
        }
        case 'type': {
          const text = String(data.text || '').slice(0, MAX_ACTION_TEXT);
          if (data.ref) {
            const resolved = await targetFromRef(s, data.ref);
            if (resolved.status !== STATUS.completed) { actionStatus = resolved.status; message = resolved.message || ''; break; }
            handle = resolved.handle;
            const kind = resolved.current ? resolved.current.tag : '';
            if (['button', 'a', 'img', 'iframe', 'select', 'option'].includes(kind)) {
              actionStatus = STATUS.wrongKind;
              message = `Element ${data.ref} is a <${kind}>, not a text field.`;
              break;
            }
            await handle.click({ timeout: 10000 });
            if (data.replace) {
              // Select the field's whole content with the DOM API rather than a
              // platform shortcut, then delete it. Appending without clearing
              // was the reported "clearing did not clear" bug.
              await handle.evaluate((node) => {
                if (node && typeof node.focus === 'function') node.focus();
                if (node && typeof node.select === 'function') { node.select(); return; }
                if (node && typeof node.setSelectionRange === 'function' && typeof node.value === 'string') {
                  node.setSelectionRange(0, node.value.length);
                }
              });
              await p.keyboard.press('Backspace');
            }
            await p.keyboard.type(text);
            control = await readControlValue(handle);
            target = { ref: data.ref, role: resolved.current?.role, name: resolved.record?.name };
          } else {
            await p.keyboard.type(text);
          }
          break;
        }
        case 'key':
          if (Array.isArray(data.keys)) {
            for (const spec of data.keys.slice(0, 32)) await pressCombo(p, spec);
          } else {
            await pressCombo(p, data.key);
          }
          break;
        case 'scroll': {
          if (data.ref || data.selector) {
            const scrolled = await dom.scroll(p, {
              marker: data.ref,
              selector: data.selector,
              dx: Math.max(-1500, Math.min(1500, Number(data.deltaX ?? data.dx) || 0)),
              dy: Math.max(-1500, Math.min(1500, Number(data.deltaY ?? data.dy) || 0))
            });
            if (!scrolled.found) {
              actionStatus = scrolled.reason === 'missing' ? STATUS.missing : STATUS.failed;
              message = scrolled.reason === 'missing'
                ? 'The area to scroll was not found.'
                : `The area could not be scrolled: ${scrolled.error || scrolled.reason}`;
            }
            target = { scroller: scrolled.scroller || null, moved: Boolean(scrolled.moved) };
          } else {
            const deltaX = Math.max(-1500, Math.min(1500, Number(data.deltaX ?? data.dx) || 0));
            const deltaY = Math.max(-1500, Math.min(1500, Number(data.deltaY ?? data.dy) || 0));
            if (data.observationId !== undefined && data.observationId !== null) {
              await assertFreshObservation(s, data.observationId);
            }
            // Scroll the page itself, not wherever the invisible pointer last
            // happened to rest.
            await p.mainFrame().evaluate(({ dx, dy }) => {
              const scroller = document.scrollingElement || document.documentElement;
              scroller.scrollBy({ left: dx, top: dy, behavior: 'instant' });
            }, { dx: deltaX, dy: deltaY });
            const info = await dom.scrollPosition(p);
            target = { scroller: 'page', scrollX: info.scrollX, scrollY: info.scrollY };
          }
          break;
        }
        case 'select':
        case 'setValue':
        case 'selectAt':
        case 'setValueAt': {
          if (data.ref) {
            const resolved = await targetFromRef(s, data.ref);
            if (resolved.status !== STATUS.completed) { actionStatus = resolved.status; message = resolved.message || ''; break; }
            handle = resolved.handle;
            const applied = await handle.evaluate((node, value) => {
              if (!node || !('value' in node)) return { ok: false, reason: 'not-a-control' };
              const setter = Object.getOwnPropertyDescriptor(
                node.tagName === 'SELECT' ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype,
                'value'
              );
              // A framework-controlled input ignores a plain assignment; use the
              // native setter so its own change handling sees the update.
              if (node.tagName === 'SELECT') node.value = String(value ?? '');
              else if (setter && setter.set) setter.set.call(node, String(value ?? ''));
              else node.value = String(value ?? '');
              node.dispatchEvent(new Event('input', { bubbles: true }));
              node.dispatchEvent(new Event('change', { bubbles: true }));
              return { ok: true, value: String(node.value ?? '') };
            }, data.value);
            if (!applied.ok) { actionStatus = STATUS.wrongKind; message = 'That element does not hold a value.'; break; }
            control = { value: applied.value };
          } else {
            const position = data.x !== undefined ? point(s, data) : null;
            if (!position) deny('select needs a ref or x/y coordinates.', 400);
            if (data.observationId !== undefined && data.observationId !== null) {
              await assertFreshObservation(s, data.observationId);
            }
            control = await p.evaluate(({ x, y, value }) => {
              const el = document.elementFromPoint(x, y);
              if (!el || (el.tagName !== 'SELECT' && el.tagName !== 'INPUT')) return null;
              el.value = String(value ?? '');
              el.dispatchEvent(new Event('input', { bubbles: true }));
              el.dispatchEvent(new Event('change', { bubbles: true }));
              if (el.tagName === 'SELECT') {
                return {
                  kind: 'select',
                  value: el.value,
                  options: Array.from(el.options).map((option) => ({ value: option.value, label: option.textContent || option.value }))
                };
              }
              return { kind: el.type, value: el.value };
            }, { ...position, value: data.value });
            if (!control) { actionStatus = STATUS.missing; message = 'No select or input at that position.'; }
          }
          break;
        }
        default: deny('Unknown browser action.', 400);
      }
    } catch (error) {
      if (error.status === 409) throw error;
      actionStatus = STATUS.failed;
      message = error.message || String(error);
    }

    await refreshTitle(s);
    let focus = null;
    try { focus = await dom.focusInfo(p); } catch (_) { focus = null; }
    const described = describe(s);
    const payload = result(actionStatus, {
      ...described,
      // A completed action whose effect the page has not reported yet is
      // honestly labelled unconfirmed rather than assumed to have worked.
      message: message || undefined,
      warning: warning || undefined,
      target: target || undefined,
      control: control || null,
      focused: focus || null,
      observationId: s.lastObservationId || null
    });
    return payload;
  }

  function actionTab(id, action, data = {}) {
    const s = sessions.get(id);
    if (!s) deny('Browser pane no longer exists.', 404);
    return enqueue(s, () => performAction(s, action, data));
  }

  async function waitTab(id, conditions = {}) {
    const s = sessions.get(id);
    if (!s) deny('Browser pane no longer exists.', 404);
    const timeout = Math.max(100, Math.min(120000, Number(conditions.timeout) || 30000));
    const hasUrl = typeof conditions.url === 'string' && conditions.url;
    const hasText = typeof conditions.text === 'string' && conditions.text;
    const hasSelector = typeof conditions.selector === 'string' && conditions.selector;
    const hasValue = typeof conditions.value === 'string' && conditions.ref;
    const hasTitle = typeof conditions.title === 'string' && conditions.title;
    if (!hasUrl && !hasText && !hasSelector && !hasValue && !hasTitle) {
      deny('Provide url, title, text, selector, or value with ref.', 400);
    }
    let urlPattern = null;
    if (hasUrl) {
      try { urlPattern = new RegExp(conditions.url); } catch (_) { urlPattern = null; }
    }
    const started = Date.now();
    const check = async () => {
      const url = (() => { try { return s.page.url(); } catch (_) { return ''; } })();
      if (hasUrl && (urlPattern ? urlPattern.test(url) : url === conditions.url)) return { matched: true, reason: 'url' };
      if (hasTitle) {
        const title = await s.page.title().catch(() => '');
        if (title.includes(conditions.title)) return { matched: true, reason: 'title' };
      }
      if (hasSelector) {
        for (const frame of s.page.frames()) {
          let found = false;
          try { found = await frame.evaluate((sel) => Boolean(document.querySelector(sel)), conditions.selector); }
          catch (_) { found = false; }
          if (found) return { matched: true, reason: 'selector' };
        }
      }
      if (hasText) {
        const info = await dom.content(s.page, 2000000);
        if (info.text.includes(conditions.text)) return { matched: true, reason: 'text' };
      }
      if (hasValue) {
        const handle = await dom.resolveRef(s.page, conditions.ref);
        if (handle) {
          const value = await handle.evaluate((node) => (node && 'value' in node ? String(node.value) : null)).catch(() => null);
          if (value === conditions.value) return { matched: true, reason: 'value' };
        }
      }
      return null;
    };
    let outcome = null;
    for (;;) {
      outcome = await check().catch(() => null);
      if (outcome) break;
      if (Date.now() - started >= timeout) break;
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    await refreshTitle(s);
    const info = await dom.signature(s.page);
    return {
      ok: Boolean(outcome),
      status: outcome ? STATUS.completed : STATUS.unconfirmed,
      matched: Boolean(outcome),
      reason: outcome ? outcome.reason : 'timeout',
      elapsedMs: Date.now() - started,
      url: s.page.url(),
      title: s.title || '',
      scrollX: info.scrollX,
      scrollY: info.scrollY,
      observationId: s.lastObservationId || null
    };
  }

  async function sizingTab(id, mode, options = {}) {
    const s = sessions.get(id);
    if (!s) deny('Browser pane no longer exists.', 404);
    if (!['fit', 'fixed'].includes(mode)) deny('Sizing mode must be fit or fixed.', 400);
    return enqueue(s, async () => {
      if (mode === 'fixed') {
        s.sizing = 'fixed';
        s.fixedWidth = Math.max(320, Math.min(1920, Math.round(Number(options.width) || s.width)));
        s.fixedHeight = Math.max(240, Math.min(1200, Math.round(Number(options.height) || s.height)));
        s.width = s.fixedWidth;
        s.height = s.fixedHeight;
        await s.page.setViewport({ width: s.width, height: s.height });
      } else {
        s.sizing = 'fit';
      }
      return { sizing: s.sizing, width: s.width, height: s.height };
    });
  }

  async function closeTabInternal(id) {
    const s = sessions.get(id);
    if (!s) return false;
    clearTimeout(s.dialogTimer);
    sessions.delete(id);
    await s.context.close();
    return true;
  }

  function getTab(id) { return sessions.get(id) || null; }

  async function setViewportTab(id, width, height, options = {}) {
    const s = sessions.get(id);
    if (!s) deny('Browser pane no longer exists.', 404);
    return enqueue(s, async () => {
      // Fixed-size mode: the owner resizing their viewer must not rearrange the
      // page. Only an explicit (force) request changes a locked viewport.
      if (s.sizing === 'fixed' && !options.force) {
        return { width: s.width, height: s.height, sizing: s.sizing, ignored: true };
      }
      s.width = Math.max(320, Math.min(1920, Math.round(Number(width) || 1280)));
      s.height = Math.max(240, Math.min(1200, Math.round(Number(height) || 800)));
      await s.page.setViewport({ width: s.width, height: s.height });
      return { width: s.width, height: s.height, sizing: s.sizing };
    });
  }

  // ── Routes ────────────────────────────────────────────────────────────────

  app.get('/api/browser/bootstrap', route(async (req, res) => {
    if (req.get('Authorization')) deny('Agent tokens cannot manage workspace permissions.');
    if (!req.isOwner) deny('Owner page required.');
    const site = req.get('Sec-Fetch-Site');
    if (site && site !== 'same-origin' && site !== 'none') deny('Owner page required.');
    res.json({ key: humanKey });
  }));

  app.get('/api/browser', route(async (req, res) => {
    if (!human(req)) deny('Workspace access required.');
    res.json([...sessions.values()].filter((s) => !s.internal).map(describe));
  }));

  app.post('/api/browser', route(async (req, res) => {
    if (!human(req)) deny('Only the owner can create browser tabs.');
    if (sessions.size + opening >= MAX_BROWSER_TABS) deny('Close a tab before opening another.', 409);
    opening++;
    let context;
    let s;
    try {
      context = await (await engine()).createBrowserContext();
      const page = await context.newPage();
      await page.setViewport({ width: 1280, height: 800 });
      const kind = req.body.kind === 'agent' ? 'agent' : 'human';
      s = initSession({
        id: crypto.randomUUID(),
        token: crypto.randomBytes(32).toString('hex'),
        page,
        context,
        kind,
        width: 1280,
        height: 800,
        permission: kind === 'agent' ? 'control' : 'private'
      });
      wireSession(s);
      sessions.set(s.id, s);
      page.once('close', () => sessions.delete(s.id));
      res.json(describe(s));
    } catch (error) {
      if (s) sessions.delete(s.id);
      if (context) await context.close().catch(() => {});
      throw error;
    } finally { opening--; }
  }));

  app.post('/api/browser/:id/permission', route(async (req, res) => {
    if (!human(req)) deny('Only the owner can change sharing.');
    const s = session(req);
    if (!['private', 'view', 'control'].includes(req.body.permission)) deny('Unknown sharing permission.', 400);
    s.permission = req.body.permission;
    s.token = crypto.randomBytes(32).toString('hex'); // Revoke every previous capability.
    res.json(describe(s));
  }));

  app.get('/api/browser/:id/access', route(async (req, res) => {
    if (!human(req)) deny('Only the owner can reveal access.');
    const s = session(req);
    if (s.permission === 'private') deny('Choose View or Control before sharing.');
    res.json({ id: s.id, token: s.token, permission: s.permission, endpoint: '/api/browser/' + s.id });
  }));

  app.get('/api/browser/:id/snapshot', route(async (req, res) => {
    session(req); // Permission check before the expensive capture.
    const snapshot = await snapshotTab(req.params.id);
    session(req); // Recheck grants after asynchronous work.
    res.json(snapshot);
  }));

  app.get('/api/browser/:id/observe', route(async (req, res) => {
    session(req);
    const observed = await observeTab(req.params.id, {
      elements: req.query.elements === '1' || req.query.elements === 'true',
      max: req.query.max
    });
    session(req);
    res.json(observed);
  }));

  app.get('/api/browser/:id/elements', route(async (req, res) => {
    session(req);
    const catalogued = await elementsTab(req.params.id, { max: req.query.max });
    session(req);
    res.json(catalogued);
  }));

  app.post('/api/browser/:id/viewport', route(async (req, res) => {
    if (!human(req)) deny('Only the owner can resize the viewer.');
    session(req);
    const size = await setViewportTab(req.params.id, req.body.width, req.body.height, { force: req.body.force === true });
    res.json(size);
  }));

  app.post('/api/browser/:id/sizing', route(async (req, res) => {
    session(req, true);
    res.json(await sizingTab(req.params.id, req.body.mode, req.body));
  }));

  app.get('/api/browser/:id/content', route(async (req, res) => {
    session(req);
    const info = await contentTab(req.params.id, { limit: req.query.limit });
    session(req);
    res.json(info);
  }));

  app.post('/api/browser/:id/action', route(async (req, res) => {
    session(req, true);
    const outcome = await actionTab(req.params.id, req.body.action, req.body);
    session(req); // Recheck grants after asynchronous work.
    res.status(outcome.httpStatus || 200).json(outcome);
  }));

  app.post('/api/browser/:id/wait', route(async (req, res) => {
    session(req);
    res.json(await waitTab(req.params.id, req.body || {}));
  }));

  app.post('/api/browser/:id/dialog', route(async (req, res) => {
    if (!human(req)) deny('Only the owner can answer a page dialog.');
    const s = session(req);
    res.json(await respondDialog(s.id, req.body.action, req.body.text));
  }));

  app.delete('/api/browser/:id', route(async (req, res) => {
    if (!human(req)) deny('Only the owner can close tabs.');
    const s = session(req);
    clearTimeout(s.dialogTimer);
    sessions.delete(s.id);
    await s.context.close();
    res.json({ closed: true });
  }));

  const closeAll = async () => {
    sessions.clear();
    if (browserPromise) await (await browserPromise).close();
  };

  return {
    closeAll,
    create: createTab,
    snapshot: snapshotTab,
    observe: observeTab,
    elements: elementsTab,
    content: contentTab,
    navigate: navigateTab,
    action: actionTab,
    wait: waitTab,
    sizing: sizingTab,
    close: closeTabInternal,
    get: getTab,
    setViewport: setViewportTab,
    respondDialog,
    describe,
    engineStatus,
    STATUS
  };
}

module.exports = { installBrowserWorkspace };
