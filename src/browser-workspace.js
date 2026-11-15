'use strict';
const crypto = require('crypto');
const puppeteer = require('puppeteer');

function installBrowserWorkspace(app) {
  const humanKey = crypto.randomBytes(32).toString('hex');
  const MAX_BROWSER_TABS = 32;
  const sessions = new Map();
  let browserPromise;
  let opening=0;
  const engine = () => {
    if (!browserPromise) {
      // Keep Chromium's renderer sandbox by default. Containers and CI runners
      // without user namespaces need an explicit opt-out; it is never implied
      // by running with elevated privileges or by opening an untrusted page.
      const unsandboxed = process.env.CI === 'true' || process.env.TOWNMOUSE_CHROMIUM_NO_SANDBOX === '1';
      browserPromise = puppeteer.launch({
        headless: true,
        args:[
          ...(unsandboxed ? ['--no-sandbox','--disable-setuid-sandbox'] : []),
          '--disable-dev-shm-usage','--disable-gpu','--disable-background-timer-throttling',
          '--disable-renderer-backgrounding','--disable-backgrounding-occluded-windows'
        ],
        ...(process.env.TERMINALONE_CHROME ? { executablePath: process.env.TERMINALONE_CHROME } : {}),
      }).then((browser) => {
        browser.on('disconnected', () => {
          browserPromise = null;
          // Every session belonged to the dead browser. Clearing the map lets
          // the UI reconcile instead of offering unclosable ghost tabs.
          sessions.clear();
        });
        return browser;
      }).catch(error => { browserPromise = null; throw error; });
    }
    return browserPromise;
  };
  const human = req => req.get('X-Workspace-Key') === humanKey;
  const describe = s => ({ id:s.id, kind:s.kind, permission:s.permission, url:s.page.url(), title:s.title || 'New tab', dialog:s.dialog || null });
  // Screenshot capture and viewport changes share one page. Serialize them or
  // a resize can land mid-capture and label an old-size image with new
  // dimensions, which makes pane click mapping land in the wrong place.
  const enqueue = (s, task) => {
    const work = (s.queue || Promise.resolve()).then(task, task);
    s.queue = work.catch(() => {});
    return work;
  };
  const route = fn => async (req,res) => {
    res.set('Cache-Control','no-store');
    try {
      const s=sessions.get(req.params.id);
      if(s && /\/(snapshot|content|action|viewport)$/.test(req.path)) {
        await enqueue(s, () => fn(req, res));
      } else await fn(req,res);
    } catch (error) { res.status(error.status || 400).json({error:error.message}); }
  };
  function deny(message, status=403) { throw Object.assign(new Error(message), {status}); }
  function session(req, control=false) {
    const s=sessions.get(req.params.id);
    if (!s) deny('Browser tab no longer exists.',404);
    if (s.internal) deny('This browser belongs to a pane workspace.',403);
    if (!human(req)) {
      if (req.get('Authorization') !== 'Bearer '+s.token) deny('Browser access token required.');
      if (s.permission==='private' || (control && s.permission!=='control')) deny('The owner has not granted this browser permission.');
    }
    return s;
  }
  function address(value) {
    const u=new URL(value);
    if (!['http:','https:'].includes(u.protocol) || u.username || u.password) deny('Use an HTTP or HTTPS address without embedded credentials.',400);
    return u.href;
  }
  // A popup can fire before its main frame exists; calling popup.url() then
  // throws asynchronously and used to take the whole server down. Never let
  // popup bookkeeping escape the emitter.
  function followPopup(popup, page) {
    void (async () => {
      try {
        await Promise.resolve();
        const popupUrl = popup.url();
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
      s = { id: crypto.randomUUID(), token: crypto.randomBytes(32).toString('hex'), page, context, kind, width: 1280, height: 800, permission: kind === 'agent' ? 'control' : 'private', internal: true };
      attachDialog(s);
      page.on('popup', (popup) => followPopup(popup, page));
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
  async function snapshotTab(id) {
    const s = sessions.get(id);
    if (!s) deny('Browser pane no longer exists.', 404);
    return enqueue(s, async () => {
      // CDP screenshot waits for a JS dialog and times out. Keep the last
      // frame, but return the dialog so the human/agent can answer it.
      if (s.pendingDialog) {
        return { ...describe(s), image: null, width: s.width, height: s.height, dialog: s.dialog };
      }
      await s.page.bringToFront();
      const client = await s.page.createCDPSession();
      let capture;
      try {
        capture = await client.send('Page.captureScreenshot', { format: 'jpeg', quality: 75, captureBeyondViewport: false }, { timeout: 10000 });
      } finally {
        await client.detach();
      }
      s.title = await s.page.title();
      return { ...describe(s), image: capture.data, width: s.width, height: s.height };
    });
  }
  async function navigateTab(id, url) {
    const s = sessions.get(id);
    if (!s) deny('Browser pane no longer exists.', 404);
    await s.page.goto(address(url), { waitUntil: 'domcontentloaded', timeout: 20000 });
    s.title = await s.page.title();
    return describe(s);
  }
  async function actionTab(id, action, data = {}) {
    const s = sessions.get(id);
    if (!s) deny('Browser pane no longer exists.', 404);
    const p = s.page;
    switch (action) {
      case 'navigate': await p.goto(address(data.url), { waitUntil: 'domcontentloaded', timeout: 20000 }); break;
      case 'back': await p.goBack({ waitUntil: 'domcontentloaded', timeout: 20000 }); break;
      case 'forward': await p.goForward({ waitUntil: 'domcontentloaded', timeout: 20000 }); break;
      case 'reload': await p.reload({ waitUntil: 'domcontentloaded', timeout: 20000 }); break;
      case 'click': {
        const x = Number(data.x), y = Number(data.y);
        if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x > s.width || y > s.height) deny('Invalid pointer position.', 400);
        await p.mouse.click(x, y); break;
      }
      case 'type': await p.keyboard.type(String(data.text || '').slice(0, 10000)); break;
      case 'key': await p.keyboard.press(String(data.key)); break;
      case 'scroll': await p.mouse.wheel({ deltaY: Math.max(-1500, Math.min(1500, Number(data.deltaY) || 0)) }); break;
      default: deny('Unknown browser action.', 400);
    }
    s.title = await p.title();
    return describe(s);
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
  async function setViewportTab(id, width, height) {
    const s = sessions.get(id);
    if (!s) deny('Browser pane no longer exists.', 404);
    return enqueue(s, async () => {
      s.width = Math.max(320, Math.min(1920, Math.round(Number(width) || 1280)));
      s.height = Math.max(240, Math.min(1200, Math.round(Number(height) || 800)));
      await s.page.setViewport({ width: s.width, height: s.height });
      return { width: s.width, height: s.height };
    });
  }
  app.get('/api/browser/bootstrap',route(async(req,res)=>{
    if(req.get('Authorization')) deny('Agent tokens cannot manage workspace permissions.');
    if(!req.isOwner) deny('Owner page required.');
    const site = req.get('Sec-Fetch-Site');
    if (site && site !== 'same-origin' && site !== 'none') deny('Owner page required.');
    res.json({key:humanKey});
  }));
  app.get('/api/browser',route(async(req,res)=>{
    if(!human(req)) deny('Workspace access required.');
    res.json([...sessions.values()].filter((s) => !s.internal).map(describe));
  }));
  app.post('/api/browser',route(async(req,res)=>{
    if(!human(req)) deny('Only the owner can create browser tabs.');
    if(sessions.size+opening>=MAX_BROWSER_TABS) deny('Close a tab before opening another.',409);
    opening++;
    let context;
    try {
    context=await (await engine()).createBrowserContext();
    const page=await context.newPage();
    await page.setViewport({width:1280,height:800});
    const kind=req.body.kind==='agent'?'agent':'human';
    const s={id:crypto.randomUUID(),token:crypto.randomBytes(32).toString('hex'),page,context,kind,width:1280,height:800,permission:kind==='agent'?'control':'private'};
    attachDialog(s);
    sessions.set(s.id,s);
    page.once('close', () => sessions.delete(s.id));
    // Popups remain in this permission boundary; follow in the same tab.
    page.on('popup', (popup) => followPopup(popup, page));
    res.json(describe(s));
    } catch(error) { if(context) await context.close();throw error; } finally { opening--; }
  }));
  app.post('/api/browser/:id/permission',route(async(req,res)=>{
    if(!human(req)) deny('Only the owner can change sharing.');
    const s=session(req);
    if(!['private','view','control'].includes(req.body.permission)) deny('Unknown sharing permission.',400);
    s.permission=req.body.permission;
    s.token=crypto.randomBytes(32).toString('hex'); // Revoke every previous capability.
    res.json(describe(s));
  }));
  app.get('/api/browser/:id/access',route(async(req,res)=>{
    if(!human(req)) deny('Only the owner can reveal access.');
    const s=session(req);
    if(s.permission==='private') deny('Choose View or Control before sharing.');
    res.json({id:s.id,token:s.token,permission:s.permission,endpoint:'/api/browser/'+s.id});
  }));
  app.get('/api/browser/:id/snapshot',route(async(req,res)=>{
    const s=session(req);
    if (s.pendingDialog) {
      res.json({...describe(s),image:null,width:s.width,height:s.height,dialog:s.dialog});
      return;
    }
    await s.page.bringToFront();
    const client=await s.page.createCDPSession();
    let capture;
    try { capture=await client.send('Page.captureScreenshot',{format:'jpeg',quality:75,captureBeyondViewport:false},{timeout:10000}); } finally { await client.detach(); }
    session(req); // Recheck grants after asynchronous work.
    s.title=await s.page.title();
    res.json({...describe(s),image:capture.data,width:s.width,height:s.height});
  }));
  app.post('/api/browser/:id/viewport',route(async(req,res)=>{
    if(!human(req)) deny('Only the owner can resize the viewer.');
    const s=session(req);
    s.width=Math.max(320,Math.min(1920,Math.round(Number(req.body.width)||1280)));
    s.height=Math.max(240,Math.min(1200,Math.round(Number(req.body.height)||800)));
    await s.page.setViewport({width:s.width,height:s.height});
    res.json({width:s.width,height:s.height});
  }));
  app.get('/api/browser/:id/content',route(async(req,res)=>{
    const s=session(req);
    const text=await s.page.evaluate(()=>document.body.innerText);
    session(req);
    res.json({...describe(s),text:text.slice(0,100000)});
  }));
  app.post('/api/browser/:id/action',route(async(req,res)=>{
    const s=session(req,true), {action}=req.body, p=s.page;
    switch(action) {
      case 'navigate': await p.goto(address(req.body.url),{waitUntil:'domcontentloaded',timeout:20000});break;
      case 'back': await p.goBack({waitUntil:'domcontentloaded',timeout:20000});break;
      case 'forward': await p.goForward({waitUntil:'domcontentloaded',timeout:20000});break;
      case 'reload': await p.reload({waitUntil:'domcontentloaded',timeout:20000});break;
      case 'click': {
        const x=Number(req.body.x),y=Number(req.body.y);
        if(!Number.isFinite(x)||!Number.isFinite(y)||x<0||y<0||x>s.width||y>s.height) deny('Invalid pointer position.',400);
        await p.mouse.click(x,y);break;
      }
      case 'type': await p.keyboard.type(String(req.body.text||'').slice(0,10000));break;
      case 'key': await p.keyboard.press(String(req.body.key));break;
      case 'scroll': await p.mouse.wheel({deltaY:Math.max(-1500,Math.min(1500,Number(req.body.deltaY)||0))});break;
      default: deny('Unknown browser action.',400);
    }
    res.json(describe(s));
  }));
  app.post('/api/browser/:id/dialog',route(async(req,res)=>{
    if(!human(req)) deny('Only the owner can answer a page dialog.');
    const s=session(req);
    res.json(await respondDialog(s.id,req.body.action,req.body.text));
  }));
  app.delete('/api/browser/:id',route(async(req,res)=>{
    if(!human(req)) deny('Only the owner can close tabs.');
    const s=session(req);clearTimeout(s.dialogTimer);sessions.delete(s.id);await s.context.close();res.json({closed:true});
  }));
  const closeAll = async()=>{sessions.clear();if(browserPromise)await(await browserPromise).close();};
  return { closeAll, create: createTab, snapshot: snapshotTab, navigate: navigateTab, action: actionTab, close: closeTabInternal, get: getTab, setViewport: setViewportTab, respondDialog, describe };
}
module.exports={installBrowserWorkspace};
