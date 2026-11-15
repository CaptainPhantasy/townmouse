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
      browserPromise = puppeteer.launch({
        headless: true,
        args:['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--disable-gpu','--disable-background-timer-throttling','--disable-renderer-backgrounding','--disable-backgrounding-occluded-windows'],
        ...(process.env.TERMINALONE_CHROME ? { executablePath: process.env.TERMINALONE_CHROME } : {}),
      }).then((browser) => {
        browser.on('disconnected', () => { browserPromise = null; });
        return browser;
      }).catch(error => { browserPromise = null; throw error; });
    }
    return browserPromise;
  };
  const human = req => req.get('X-Workspace-Key') === humanKey;
  const describe = s => ({ id:s.id, kind:s.kind, permission:s.permission, url:s.page.url(), title:s.title || 'New tab', dialog:s.dialog || null });
  const route = fn => async (req,res) => {
    res.set('Cache-Control','no-store');
    try {
      const s=sessions.get(req.params.id);
      if(s && /\/(snapshot|content|action|viewport)$/.test(req.path)) {
        const work=(s.queue||Promise.resolve()).then(()=>fn(req,res));
        s.queue=work.catch(()=>{});
        await work;
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
      // Never let alert/confirm/prompt block the shared page. Record it for the
      // pane UI/agent and dismiss so the page can continue.
      page.on('dialog', async (dialog) => {
        s.dialog = { type: dialog.type(), message: dialog.message(), at: new Date().toISOString() };
        try { await dialog.dismiss(); } catch (_) { /* dialog already gone */ }
      });
      page.on('popup', (popup) => followPopup(popup, page));
      if (url) await page.goto(address(url), { waitUntil: 'domcontentloaded', timeout: 20000 });
      s.title = await page.title();
      sessions.set(s.id, s);
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
    sessions.delete(id);
    await s.context.close();
    return true;
  }
  function getTab(id) { return sessions.get(id) || null; }
  async function setViewportTab(id, width, height) {
    const s = sessions.get(id);
    if (!s) deny('Browser pane no longer exists.', 404);
    s.width = Math.max(320, Math.min(1920, Math.round(Number(width) || 1280)));
    s.height = Math.max(240, Math.min(1200, Math.round(Number(height) || 800)));
    await s.page.setViewport({ width: s.width, height: s.height });
    return { width: s.width, height: s.height };
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
    page.on('dialog',async dialog=>{s.dialog={type:dialog.type(),message:dialog.message(),at:new Date().toISOString()};try{await dialog.dismiss();}catch{}});
    sessions.set(s.id,s);
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
  app.delete('/api/browser/:id',route(async(req,res)=>{
    if(!human(req)) deny('Only the owner can close tabs.');
    const s=session(req);sessions.delete(s.id);await s.context.close();res.json({closed:true});
  }));
  const closeAll = async()=>{sessions.clear();if(browserPromise)await(await browserPromise).close();};
  return { closeAll, create: createTab, snapshot: snapshotTab, navigate: navigateTab, action: actionTab, close: closeTabInternal, get: getTab, setViewport: setViewportTab, describe };
}
module.exports={installBrowserWorkspace};
