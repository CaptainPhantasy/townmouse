const { spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const path = require('path');
const os = require('os');
const ROOT='/Volumes/SanDisk1Tb/TOWNMOUSE/repo', PORT=11377, FIX=11378, BASE=`http://127.0.0.1:${PORT}`;
const wait=(ms)=>new Promise(r=>setTimeout(r,ms));
(async()=>{
  const fixture=http.createServer((q,s)=>{s.setHeader('Content-Type','text/html');s.end('<title>Text Fixture</title><h1>Readable Browser Pane</h1>');}).listen(FIX,'127.0.0.1');
  const srv=spawn(process.execPath,[ROOT+'/src/server.js'],{cwd:ROOT,env:{...process.env,PORT:String(PORT),SHELL:'/bin/bash',TOWNMOUSE_STATE_DIR:fs.mkdtempSync(path.join(os.tmpdir(),'tm-text-'))},stdio:['ignore','ignore','pipe']});
  for(let i=0;i<100;i++){try{const r=await fetch(BASE+'/health');if(r.ok)break;}catch(e){}await wait(150);}
  const b=await (await fetch(BASE+'/api/panes/bootstrap')).json();
  const headers={'Content-Type':'application/json','X-Townmouse-Token':b.token};
  const post=(u,d)=>fetch(BASE+'/api/panes'+u,{method:'POST',headers,body:JSON.stringify(d||{})}).then(r=>r.json());
  const tab=await post('/tabs',{title:'Text',activate:true});
  const br=await post(`/tabs/${tab.id}/panes`,{kind:'browser',url:`http://127.0.0.1:${FIX}/`});
  await wait(800);
  const token=fs.readFileSync(path.join(os.homedir(),'.townmouse','pane-token'),'utf8').trim();
  const cli=spawn(process.execPath,[path.join(ROOT,'scripts','panes'),'pane','text',br.id],{cwd:ROOT,env:{...process.env,TOWNMOUSE_API:BASE+'/api/panes',TOWNMOUSE_TOKEN:token},stdio:['ignore','pipe','pipe']});
  let out='',err=''; cli.stdout.on('data',d=>out+=d); cli.stderr.on('data',d=>err+=d); await new Promise(r=>cli.on('exit',r));
  let parsed=null; try{parsed=JSON.parse(out)}catch{}
  console.log('PANE_TEXT',JSON.stringify({exit:cli.exitCode,title:parsed?.title,hasText:!!parsed?.text?.includes('Readable Browser Pane'),err:err.slice(-80)}));
  srv.kill(); fixture.close();
})();
