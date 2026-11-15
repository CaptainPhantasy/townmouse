const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const ROOT='/Volumes/SanDisk1Tb/TOWNMOUSE/repo', PORT=11361, BASE=`http://127.0.0.1:${PORT}`;
const OUT='/Volumes/SanDisk1Tb/TOWNMOUSE/stewardship/screens/pass17';
const wait=(ms)=>new Promise(r=>setTimeout(r,ms));
async function measure(p,sels){return p.evaluate((sels)=>{const out={};for(const s of sels){const e=document.querySelector(s);if(!e){out[s]=null;continue}const r=e.getBoundingClientRect(),c=getComputedStyle(e);out[s]={y:Math.round(r.y),h:Math.round(r.height),display:c.display};}out.idle=document.body.classList.contains('chrome-idle');out.nav=(()=>{const n=document.querySelector('.workspace-nav');return {display:getComputedStyle(n).display,h:Math.round(n.getBoundingClientRect().height)}})();return out;},sels);}
(async()=>{
  fs.mkdirSync(OUT,{recursive:true});
  const srv=spawn(process.execPath,[ROOT+'/src/server.js'],{cwd:ROOT,env:{...process.env,PORT:String(PORT),SHELL:'/bin/bash'},stdio:['ignore','ignore','pipe']});
  for(let i=0;i<100;i++){try{const r=await fetch(BASE+'/health');if(r.ok)break;}catch(e){}await wait(150);}
  const b=await puppeteer.launch({headless:true,args:['--no-sandbox']});
  // Terminal compact + idle.
  let c=await b.createBrowserContext(), p=await c.newPage();
  await p.setViewport({width:393,height:852,deviceScaleFactor:3,hasTouch:true,isMobile:true});
  await p.goto(BASE,{waitUntil:'domcontentloaded'}); await p.waitForFunction(()=>window.__workspace?.ready); await wait(400);
  const termCompact=await measure(p,['.terminal-header','#keybarIphone','#keybarIpad','.terminal-container','.workspace-nav']);
  await p.screenshot({path:path.join(OUT,'phone-terminal-compact.png')});
  console.log('TERM_COMPACT',JSON.stringify(termCompact));
  await wait(7500);
  const termIdle=await measure(p,['.terminal-header','#keybarIphone','#keybarIpad','.terminal-container','.workspace-nav']);
  await p.screenshot({path:path.join(OUT,'phone-terminal-idle.png')});
  console.log('TERM_IDLE',JSON.stringify(termIdle));
  await p.mouse.click(200,300); await wait(500);
  const termWake=await measure(p,['.terminal-header','#keybarIphone','.terminal-container','.workspace-nav']);
  await p.screenshot({path:path.join(OUT,'phone-terminal-wake.png')});
  console.log('TERM_WAKE',JSON.stringify(termWake));
  await c.close();
  // Browser compact + idle.
  c=await b.createBrowserContext(); p=await c.newPage();
  await p.setViewport({width:393,height:852,deviceScaleFactor:3,hasTouch:true,isMobile:true});
  await p.goto(BASE,{waitUntil:'domcontentloaded'}); await p.waitForFunction(()=>window.__workspace?.ready); await wait(300);
  await p.evaluate(()=>document.querySelector('#workspace-browser').click()); await p.waitForFunction(()=>!document.querySelector('.browser-surface').hidden); await wait(300);
  const brCompact=await measure(p,['#browser-message','#browser-message-text','.browser-tabstrip','#browser-address','#browser-type','.browser-canvas','.workspace-nav']);
  await p.screenshot({path:path.join(OUT,'phone-browser-compact.png')});
  console.log('BROWSER_COMPACT',JSON.stringify(brCompact));
  await wait(7500);
  const brIdle=await measure(p,['#browser-message','.browser-tabstrip','#browser-address','#browser-type','.browser-canvas','.workspace-nav']);
  await p.screenshot({path:path.join(OUT,'phone-browser-idle.png')});
  console.log('BROWSER_IDLE',JSON.stringify(brIdle));
  await p.mouse.click(200,300); await wait(500);
  const brWake=await measure(p,['#browser-message','.browser-tabstrip','#browser-address','#browser-type','.browser-canvas','.workspace-nav']);
  await p.screenshot({path:path.join(OUT,'phone-browser-wake.png')});
  console.log('BROWSER_WAKE',JSON.stringify(brWake));
  await wait(7500);
  const navBox=await p.$eval('#workspace-terminal', el=>{const r=el.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};});
  await p.mouse.click(navBox.x,navBox.y); await wait(600);
  console.log('NAV_WAKE',JSON.stringify(await p.evaluate(()=>({idle:document.body.classList.contains('chrome-idle'),browserOpen:document.body.classList.contains('browser-open'),header:getComputedStyle(document.querySelector('.terminal-header')).display}))));
  await p.screenshot({path:path.join(OUT,'phone-nav-wake.png')});
  await c.close();
  // Desktop must never idle.
  c=await b.createBrowserContext(); p=await c.newPage();
  await p.setViewport({width:1440,height:900}); await p.goto(BASE,{waitUntil:'domcontentloaded'}); await p.waitForFunction(()=>window.__workspace?.ready); await wait(8000);
  console.log('DESKTOP_IDLE', await p.evaluate(()=>document.body.classList.contains('chrome-idle')));
  await c.close(); await b.close(); srv.kill();
})();
