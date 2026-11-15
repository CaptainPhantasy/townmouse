const { spawn } = require('child_process');
const puppeteer = require('puppeteer');
const ROOT='/Volumes/SanDisk1Tb/TOWNMOUSE/repo', PORT=11368, BASE=`http://127.0.0.1:${PORT}`;
const wait=(ms)=>new Promise(r=>setTimeout(r,ms));
(async()=>{
  const srv=spawn(process.execPath,[ROOT+'/src/server.js'],{cwd:ROOT,env:{...process.env,PORT:String(PORT),SHELL:'/bin/bash'},stdio:['ignore','ignore','pipe']});
  for(let i=0;i<100;i++){try{const r=await fetch(BASE+'/health');if(r.ok)break;}catch(e){}await wait(150);}
  const b=await puppeteer.launch({headless:true,args:['--no-sandbox']}); const p=await b.newPage();
  let inputPosts=0; p.on('request',r=>{if(r.method()==='POST'&&r.url().includes('/input'))inputPosts++;});
  await p.setViewport({width:1440,height:900}); await p.goto(BASE+'/panes.html',{waitUntil:'domcontentloaded'});
  await p.waitForFunction(()=>window.__panes?.state() && document.querySelector('.xterm'),{timeout:15000}); await wait(700);
  await p.click('.pane-terminal .terminal-host');
  await p.keyboard.type('echo BATCH_OK'); await p.keyboard.press('Enter');
  await p.waitForFunction(()=>document.querySelector('.pane-terminal .xterm-rows')?.textContent.includes('BATCH_OK'),{timeout:10000});
  await wait(300);
  const text=await p.evaluate(()=>document.querySelector('.pane-terminal .xterm-rows').textContent.slice(-160));
  console.log('BATCH',JSON.stringify({inputPosts,text,ok:text.includes('BATCH_OK')}));
  await b.close(); srv.kill();
})();
