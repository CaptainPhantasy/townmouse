const { spawn } = require('child_process');
const http = require('http');
const puppeteer = require('puppeteer');
const ROOT='/Volumes/SanDisk1Tb/TOWNMOUSE/repo', PORT=11373, FIX=11374, BASE=`http://127.0.0.1:${PORT}`;
const wait=(ms)=>new Promise(r=>setTimeout(r,ms));
(async()=>{
  const fixture=http.createServer((q,s)=>{s.setHeader('Content-Type','text/html');s.end('<title>Dialog Fixture</title><script>alert("HELLO_DIALOG")</script><h1>Dialog</h1>');}).listen(FIX,'127.0.0.1');
  const srv=spawn(process.execPath,[ROOT+'/src/server.js'],{cwd:ROOT,env:{...process.env,PORT:String(PORT),SHELL:'/bin/bash'},stdio:['ignore','ignore','pipe']});
  for(let i=0;i<100;i++){try{const r=await fetch(BASE+'/health');if(r.ok)break;}catch(e){}await wait(150);}
  const b=await (await fetch(BASE+'/api/panes/bootstrap')).json();
  const headers={'Content-Type':'application/json','X-Townmouse-Token':b.token};
  const post=(u,d)=>fetch(BASE+'/api/panes'+u,{method:'POST',headers,body:JSON.stringify(d||{})}).then(async r=>({status:r.status,body:await r.json().catch(()=>({}))}));
  const tab=(await post('/tabs',{title:'Large + Dialog'})).body;
  const term=(await post(`/tabs/${tab.id}/panes`,{kind:'terminal'})).body;
  const large=await post(`/panes/${term.id}/input`,{data:'x'.repeat(70000)});
  const br=(await post(`/tabs/${tab.id}/panes`,{kind:'browser',url:`http://127.0.0.1:${FIX}/`})).body;
  await wait(1200);
  const snap=await fetch(BASE+`/api/panes/panes/${br.id}/browser/snapshot`,{headers}).then(r=>r.json());
  console.log('RESULT',JSON.stringify({largeInputStatus:large.status,dialog:snap.dialog||null,title:snap.title}));
  srv.kill(); fixture.close();
})();
