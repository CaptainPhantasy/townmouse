const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const ROOT='/Volumes/SanDisk1Tb/TOWNMOUSE/repo', PORT=11365, FIX=11366, BASE=`http://127.0.0.1:${PORT}`;
const wait=(ms)=>new Promise(r=>setTimeout(r,ms));
(async()=>{
  const fixture=http.createServer((q,s)=>{s.setHeader('Content-Type','text/html');s.end('<title>Wrap Fixture</title><p id="long">Please read this sentence carefully and let every word wrap at the edge of the pane instead of splitting a word across lines. Please.</p>');}).listen(FIX,'127.0.0.1');
  const srv=spawn(process.execPath,[ROOT+'/src/server.js'],{cwd:ROOT,env:{...process.env,PORT:String(PORT),SHELL:'/bin/bash'},stdio:['ignore','ignore','pipe']});
  let err=''; srv.stderr.on('data',d=>err+=d);
  for(let i=0;i<100;i++){try{const r=await fetch(BASE+'/health');if(r.ok)break;}catch(e){}await wait(150);}
  const b=await (await fetch(BASE+'/api/panes/bootstrap')).json();
  const headers={'Content-Type':'application/json','X-Townmouse-Token':b.token};
  const post=(u,d)=>fetch(BASE+'/api/panes'+u,{method:'POST',headers,body:JSON.stringify(d||{})}).then(r=>r.json());
  const tab=await post('/tabs',{title:'Attach + Wrap'});
  const term=await post(`/tabs/${tab.id}/panes`,{kind:'terminal',title:'Orchestrator'});
  const br=await post(`/tabs/${tab.id}/panes`,{kind:'browser',url:`http://127.0.0.1:${FIX}/`});
  const brow=await puppeteer.launch({headless:true,args:['--no-sandbox']}); const p=await brow.newPage();
  const errors=[]; p.on('console',m=>{if(m.type()==='error')errors.push(m.text().slice(0,200))});
  await p.setViewport({width:1440,height:900});
  await p.goto(BASE+'/panes.html',{waitUntil:'domcontentloaded'});
  await p.waitForFunction(()=>window.__panes?.state() && document.querySelector('.xterm'),{timeout:15000});
  await p.waitForFunction(()=>document.querySelector('.browser-image')?.src.startsWith('data:'),{timeout:20000});
  await wait(1200);
  // Drop a tiny PNG on the terminal pane.
  const dropped=await p.evaluate(async () => {
    const host=document.querySelector('.pane-terminal .terminal-host');
    const png=Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nWQAAAAASUVORK5CYII='),c=>c.charCodeAt(0));
    const file=new File([png],'drop-test.png',{type:'image/png'});
    const dt=new DataTransfer(); dt.items.add(file);
    host.dispatchEvent(new DragEvent('dragover',{dataTransfer:dt,bubbles:true,cancelable:true}));
    host.dispatchEvent(new DragEvent('drop',{dataTransfer:dt,bubbles:true,cancelable:true}));
    return {name:file.name,size:file.size};
  });
  await p.waitForFunction(()=>document.querySelector('.pane-terminal .xterm-rows')?.textContent.includes('drop-test.png'),{timeout:10000});
  await wait(500);
  const termText=await p.evaluate(()=>document.querySelector('.pane-terminal .xterm-rows').textContent.slice(-300));
  const reflow=await p.evaluate(()=>({
    viewWidth:Math.round(document.querySelector('.browser-view').getBoundingClientRect().width),
    imageNaturalWidth:document.querySelector('.browser-image').naturalWidth,
    imageNaturalHeight:document.querySelector('.browser-image').naturalHeight,
    toolbarDisplay:getComputedStyle(document.querySelector('.browser-toolbar')).display
  }));
  const upload=await (async()=>{
    const r=await fetch(BASE+'/api/attachments',{method:'POST',headers:{'Content-Type':'image/png','X-Filename':encodeURIComponent('api-test.png')},body:Buffer.from('89504e470d0a1a0a','hex')});
    return {status:r.status,body:await r.json()};
  })();
  const served=upload.body.url?await fetch(upload.body.url).then(r=>r.status):0;
  console.log('RESULT',JSON.stringify({dropped,termText,reflow,upload:{status:upload.status,path:upload.body.path,url:upload.body.url,served,exists:upload.body.path?fs.existsSync(upload.body.path):false},errors}));
  await brow.close(); srv.kill(); fixture.close();
  if(err.trim()) console.log('SERVERERR',err.slice(-300));
})();
