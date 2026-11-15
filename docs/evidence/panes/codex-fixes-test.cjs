const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const ROOT='/Volumes/SanDisk1Tb/TOWNMOUSE/repo', PORT=11369, BASE=`http://127.0.0.1:${PORT}`;
const wait=(ms)=>new Promise(r=>setTimeout(r,ms));
(async()=>{
  const srv=spawn(process.execPath,[ROOT+'/src/server.js'],{cwd:ROOT,env:{...process.env,PORT:String(PORT),SHELL:'/bin/bash'},stdio:['ignore','ignore','pipe']});
  for(let i=0;i<100;i++){try{const r=await fetch(BASE+'/health');if(r.ok)break;}catch(e){}await wait(150);}
  // JSON upload must beat the global JSON parser and still parse as raw.
  const jr=await fetch(BASE+'/api/attachments',{method:'POST',headers:{'Content-Type':'application/json','X-Filename':encodeURIComponent('sample.json')},body:'{"ok":true}'});
  const jb=await jr.json();
  console.log('JSON_UPLOAD',JSON.stringify({status:jr.status,bytes:jb.bytes,exists:jb.path?fs.existsSync(jb.path):false}));
  // HTML attachment must carry a sandbox CSP.
  const hr=await fetch(BASE+'/api/attachments',{method:'POST',headers:{'Content-Type':'text/html','X-Filename':encodeURIComponent('evil.html')},body:'<script>fetch("/api/panes/bootstrap")</script>'});
  const hb=await hr.json();
  const hres=await fetch(hb.url); const csp=hres.headers.get('content-security-policy');
  console.log('HTML_UPLOAD',JSON.stringify({status:hr.status,csp}));
  // CLI must preserve trailing flags.
  const b=await (await fetch(BASE+'/api/panes/bootstrap')).json();
  const pi=b.state.tabs[0].panes[0].id;
  const token=fs.readFileSync(path.join(process.env.HOME,'.townmouse','pane-token'),'utf8').trim();
  const cli=spawn(process.execPath,[path.join(ROOT,'scripts','panes'),'pane','run',pi,"printf 'ARGS:%s\\n' --runInBand"],{cwd:ROOT,env:{...process.env,TOWNMOUSE_API:BASE+'/api/panes',TOWNMOUSE_TOKEN:token},stdio:['ignore','pipe','pipe']});
  let co='',ce=''; cli.stdout.on('data',d=>co+=d); cli.stderr.on('data',d=>ce+=d); await new Promise(r=>cli.on('exit',r));
  await wait(500);
  const read=await fetch(BASE+`/api/panes/panes/${pi}/read?since=0`,{headers:{'X-Townmouse-Token':b.token}}).then(r=>r.json());
  console.log('CLI_FLAGS',JSON.stringify({exit:cli.exitCode,hasFlag:read.data.includes('ARGS:--runInBand'),err:ce.slice(-100)}));
  // Session switching must use full IDs.
  const brow=await puppeteer.launch({headless:true,args:['--no-sandbox']}); const p=await brow.newPage();
  await p.setViewport({width:1440,height:900}); await p.goto(BASE,{waitUntil:'domcontentloaded'});
  await p.waitForFunction(()=>document.querySelector('#status')?.classList.contains('connected')); await wait(500);
  const first=await p.evaluate(()=>document.querySelector('#sessionInfo')?.dataset.sessionId||'');
  await p.evaluate(()=>document.querySelector('#workspace-session-pill').click()); await p.waitForFunction(()=>document.querySelector('#session-menu')?.open); await wait(300);
  await p.evaluate(()=>document.querySelector('#session-menu-new').click()); await wait(1000);
  const second=await p.evaluate(()=>document.querySelector('#sessionInfo')?.dataset.sessionId||'');
  await p.evaluate(()=>document.querySelector('#workspace-session-pill').click()); await p.waitForFunction(()=>document.querySelector('#session-menu')?.open); await wait(400);
  const rows=await p.evaluate(()=>[...document.querySelectorAll('#session-menu-list .drawer-row')].map(r=>({name:r.querySelector('.drawer-row-name')?.textContent,active:r.classList.contains('active')})));
  await p.evaluate(()=>{const row=[...document.querySelectorAll('#session-menu-list .drawer-row')].find(r=>!r.classList.contains('active')); if(row) row.click();});
  await wait(1200);
  const after=await p.evaluate(()=>document.querySelector('#sessionInfo')?.dataset.sessionId||'');
  console.log('SESSIONS',JSON.stringify({first,second,rows,after,switched:!!after && after!==second,fullUuids:/^[0-9a-f-]{36}$/.test(first)&&/^[0-9a-f-]{36}$/.test(second)}));
  await brow.close(); srv.kill();
})();
