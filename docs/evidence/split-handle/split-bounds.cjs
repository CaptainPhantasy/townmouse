const { spawn } = require('child_process');
const puppeteer = require('puppeteer');
const ROOT='/Volumes/SanDisk1Tb/TOWNMOUSE/repo', PORT=11361, BASE=`http://127.0.0.1:${PORT}`;
const wait=(ms)=>new Promise(r=>setTimeout(r,ms));
async function open(p){await p.evaluate(()=>document.querySelector('#workspace-browser').click());await p.waitForFunction(()=>!document.querySelector('.browser-surface').hidden);await wait(300);}
async function box(p){return p.evaluate(()=>{const r=s=>document.querySelector(s).getBoundingClientRect();const t=r('.terminal-container'),b=r('.browser-surface'),h=r('#split-handle'),a=document.querySelector('#split-handle');return {tw:Math.round(t.width),bw:Math.round(b.width),th:Math.round(t.height),bh:Math.round(b.height),hx:Math.round(h.x+h.width/2),hy:Math.round(h.y+h.height/2),val:a.getAttribute('aria-valuenow'),min:a.getAttribute('aria-valuemin'),max:a.getAttribute('aria-valuemax'),scrollW:document.documentElement.scrollWidth,innerW:innerWidth};});}
(async()=>{
  const srv=spawn(process.execPath,[ROOT+'/src/server.js'],{cwd:ROOT,env:{...process.env,PORT:String(PORT),SHELL:'/bin/bash'},stdio:['ignore','ignore','pipe']});
  for(let i=0;i<100;i++){try{const r=await fetch(BASE+'/health');if(r.ok)break;}catch(e){}await wait(150);}
  const b=await puppeteer.launch({headless:true,args:['--no-sandbox']});
  let c=await b.createBrowserContext(), p=await c.newPage();
  await p.setViewport({width:1440,height:900}); await p.goto(BASE,{waitUntil:'domcontentloaded'}); await p.waitForFunction(()=>window.__workspace?.ready); await wait(400); await open(p);
  let x=await box(p); await p.mouse.move(x.hx,x.hy); await p.mouse.down(); await p.mouse.move(x.hx+700,x.hy,{steps:8}); await p.mouse.up(); await wait(300); const farRight=await box(p);
  x=await box(p); await p.mouse.move(x.hx,x.hy); await p.mouse.down(); await p.mouse.move(x.hx-1400,x.hy,{steps:8}); await p.mouse.up(); await wait(300); const farLeft=await box(p);
  console.log('DESKTOP_FAR_RIGHT',JSON.stringify(farRight)); console.log('DESKTOP_FAR_LEFT',JSON.stringify(farLeft)); await c.close();
  c=await b.createBrowserContext(); p=await c.newPage(); await p.setViewport({width:820,height:1180,deviceScaleFactor:2,hasTouch:true});
  await p.goto(BASE,{waitUntil:'domcontentloaded'}); await p.waitForFunction(()=>window.__workspace?.ready); await wait(400); await open(p);
  x=await box(p); await p.mouse.move(x.hx,x.hy); await p.mouse.down(); await p.mouse.move(x.hx,x.hy+900,{steps:8}); await p.mouse.up(); await wait(300); const tabDown=await box(p);
  x=await box(p); await p.mouse.move(x.hx,x.hy); await p.mouse.down(); await p.mouse.move(x.hx,x.hy-1800,{steps:8}); await p.mouse.up(); await wait(300); const tabUp=await box(p);
  console.log('TABLET_FAR_DOWN',JSON.stringify(tabDown)); console.log('TABLET_FAR_UP',JSON.stringify(tabUp)); await c.close(); await b.close(); srv.kill();
})();
