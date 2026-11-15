const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const ROOT='/Volumes/SanDisk1Tb/TOWNMOUSE/repo';
const OUT='/Volumes/SanDisk1Tb/TOWNMOUSE/stewardship/screens/pass16';
const PORT=11361, BASE=`http://127.0.0.1:${PORT}`;
const wait=(ms)=>new Promise(r=>setTimeout(r,ms));
async function openBrowser(p){
  await p.evaluate(()=>document.querySelector('#workspace-browser').click());
  await p.waitForFunction(()=>!document.querySelector('.browser-surface').hidden,{timeout:20000});
  await wait(400);
}
async function boxes(p){return p.evaluate(()=>{const g=s=>{const r=document.querySelector(s).getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height}};const h=document.querySelector('#split-handle');return {terminal:g('.terminal-container'),browser:g('.browser-surface'),handle:g('#split-handle'),display:getComputedStyle(h).display,orientation:h.dataset.orientation,aria:h.getAttribute('aria-orientation'),value:h.getAttribute('aria-valuenow')};});}
(async()=>{
  fs.mkdirSync(OUT,{recursive:true});
  const srv=spawn(process.execPath,[ROOT+'/src/server.js'],{cwd:ROOT,env:{...process.env,PORT:String(PORT),SHELL:'/bin/bash'},stdio:['ignore','ignore','pipe']});
  let err=''; srv.stderr.on('data',d=>err+=d);
  for(let i=0;i<100;i++){try{const r=await fetch(BASE+'/health');if(r.ok)break;}catch(e){}await wait(150);}
  const brow=await puppeteer.launch({headless:true,args:['--no-sandbox','--disable-setuid-sandbox']});
  try{
    // Desktop: vertical separator, horizontal drag.
    let ctx=await brow.createBrowserContext(), p=await ctx.newPage();
    await p.setViewport({width:1440,height:900,deviceScaleFactor:1});
    await p.goto(BASE,{waitUntil:'domcontentloaded'}); await p.waitForFunction(()=>window.__workspace?.ready); await p.waitForFunction(()=>document.querySelector('#status').classList.contains('connected')); await wait(400);
    await openBrowser(p); const before=await boxes(p);
    const hx=before.handle.x+before.handle.w/2, hy=before.handle.y+before.handle.h/2;
    await p.mouse.move(hx,hy); await p.mouse.down(); await p.mouse.move(hx+140,hy,{steps:10}); await p.mouse.up(); await wait(400);
    const after=await boxes(p); await p.screenshot({path:path.join(OUT,'split-desktop-after.png')});
    // Keyboard nudge on the same handle.
    await p.focus('#split-handle'); await p.keyboard.press('ArrowLeft'); await wait(200); const keyed=await boxes(p);
    console.log('DESKTOP', JSON.stringify({before,after,keyed}));
    await ctx.close();
    // Tablet: horizontal separator, vertical drag.
    ctx=await brow.createBrowserContext(); p=await ctx.newPage();
    await p.setViewport({width:820,height:1180,deviceScaleFactor:2,hasTouch:true});
    await p.goto(BASE,{waitUntil:'domcontentloaded'}); await p.waitForFunction(()=>window.__workspace?.ready); await p.waitForFunction(()=>document.querySelector('#status').classList.contains('connected')); await wait(400);
    await openBrowser(p); const tBefore=await boxes(p);
    const tx=tBefore.handle.x+tBefore.handle.w/2, ty=tBefore.handle.y+tBefore.handle.h/2;
    await p.mouse.move(tx,ty); await p.mouse.down(); await p.mouse.move(tx,ty+100,{steps:10}); await p.mouse.up(); await wait(400);
    const tAfter=await boxes(p); await p.screenshot({path:path.join(OUT,'split-tablet-after.png')});
    console.log('TABLET', JSON.stringify({before:tBefore,after:tAfter}));
    await ctx.close();
    // Phone: no shared screen, handle hidden.
    ctx=await brow.createBrowserContext(); p=await ctx.newPage();
    await p.setViewport({width:393,height:852,deviceScaleFactor:3,hasTouch:true,isMobile:true});
    await p.goto(BASE,{waitUntil:'domcontentloaded'}); await p.waitForFunction(()=>window.__workspace?.ready); await p.waitForFunction(()=>document.querySelector('#status').classList.contains('connected')); await wait(400);
    await openBrowser(p);
    console.log('PHONE', JSON.stringify(await boxes(p)));
    await ctx.close();
  } finally { await brow.close(); srv.kill(); }
  if(err.trim()) console.log('SERVERERR',err.slice(-300));
})();
