/** Local synthetic browser cases; does not write production documents. */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=new URL('../../trial-ui/',import.meta.url);
const server=createServer(async(req,res)=>{try{if(req.url==='/'){res.setHeader('content-type','text/html');return res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><link rel="stylesheet" href="/typography.css"><link rel="stylesheet" href="/dialog-layout.css"><link rel="stylesheet" href="/visual-theme.css"><button id="launch">Tạo chứng từ</button><script type="module">import {openSaleAdminHandoff} from "/sale-admin-handoff.js";import {installDialogLayouts} from "/dialog-layout.js";installDialogLayouts();window.openHandoff=openSaleAdminHandoff;</script>');}const file=req.url.slice(1);if(!['style.css','typography.css','visual-theme.css','dialog-layout.css','dialog-layout.js','sale-admin-handoff.js'].includes(file)&&!file.startsWith('fonts/')){res.writeHead(404).end();return;}res.setHeader('content-type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'font/ttf');res.end(await readFile(new URL(file,root)));}catch(e){res.writeHead(500).end(e.message);}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
try{
 for(const width of [390,1280]){
  const page=await browser.newPage({viewport:{width,height:900}});await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>window.openHandoff);
  const start=async(fail=false)=>page.evaluate(fail=>{window.calls=[];window.current=true;window.failed=false;window.finished=false;const api=async(path,method='GET',body)=>{window.calls.push({path,method,body});if(method==='GET')return {revision:0,assigneeId:null,canAssign:true,candidates:[{id:'sa',name:'Sale Admin thử',eligible:true}]};if(fail&&!window.failed){window.failed=true;throw Object.assign(new Error('Mất phản hồi'),{status:503});}return {assigneeId:body.assigneeId,revision:1,replayed:fail};};window.openHandoff({api,orderId:'synthetic',documentNo:'11-24/24112026/HĐKT/BN-DATHACO',created:true,isCurrent:()=>window.current}).then(r=>{window.result=r;window.finished=true;});},fail);
  await start();assert.equal(await page.getByRole('searchbox').count(),0,'popup không có ô tìm Sale Admin');assert.equal(await page.getByRole('button',{name:'Tìm Sale Admin',exact:true}).count(),0);await page.getByRole('combobox').selectOption('sa');
  for(const label of ['Xác nhận giao hồ sơ','Để sau']){const b=await page.getByRole('button',{name:label,exact:true}).boundingBox();assert(b&&b.x>=0&&b.x+b.width<=width&&b.y+b.height<=900);}
  await page.getByRole('button',{name:'Xác nhận giao hồ sơ',exact:true}).click();await page.waitForFunction(()=>window.finished);assert.equal(await page.evaluate(()=>window.result.assigneeId),'sa');
  await start();await page.getByRole('button',{name:'Xác nhận giao hồ sơ',exact:true}).click();await page.waitForFunction(()=>window.finished);assert.equal(await page.evaluate(()=>window.result.assigneeId),null);
  await start(true);await page.getByRole('combobox').selectOption('sa');await page.getByRole('button',{name:'Xác nhận giao hồ sơ',exact:true}).click();await page.getByRole('button',{name:'Kiểm tra lại việc giao'}).waitFor();assert.equal(await page.getByRole('combobox').isDisabled(),true);await page.getByRole('button',{name:'Kiểm tra lại việc giao'}).click();await page.waitForFunction(()=>window.finished);
  const calls=await page.evaluate(()=>window.calls);assert.deepEqual(calls[1].body,calls[2].body);assert(calls.every(c=>c.path.endsWith('/sale-admin-assignment')),'retry never recreates order/contract');
  await start();await page.evaluate(()=>window.current=false);await page.getByRole('button',{name:'Xác nhận giao hồ sơ',exact:true}).click();assert.equal(await page.evaluate(()=>window.calls.length),1,'logout stops assignment');await page.getByRole('button',{name:'Để sau'}).click();await page.waitForFunction(()=>window.finished);
  // More than one page remains accessible without a separate search field/button.
  await page.evaluate(()=>{window.calls=[];window.finished=false;window.openHandoff({orderId:'paged',created:true,documentNo:'11-24/24112026/HĐKT/BN-DATHACO',api:async(path,method='GET',body)=>{
   calls.push({path,method,body});if(method==='POST')return {assigneeId:body.assigneeId,revision:1};
   const q=new URL(path,location.origin).searchParams,search=q.get('candidateSearch'),offset=Number(q.get('candidateOffset')||0);
   const all=Array.from({length:206},(_,i)=>({id:'sa-'+i,name:i===205?'ZZZ Người cuối':'AAA '+i,eligible:true}));const found=search?all.filter(p=>p.name.includes(search)):all;
   return {revision:0,assigneeId:null,canAssign:true,candidates:found.slice(offset,offset+200),candidatePage:{nextOffset:offset+200<found.length?offset+200:null}};
  }}).then(r=>{window.result=r;window.finished=true;});});
  const more=page.getByRole('button',{name:'Tải thêm Sale Admin',exact:true});await more.waitFor();await more.click();
  await page.getByRole('combobox').selectOption('sa-205');assert.equal(await page.getByRole('combobox').locator('option').count(),207);
  assert.equal(await page.getByRole('combobox').inputValue(),'sa-205');
  const box=await page.getByRole('button',{name:'Xác nhận giao hồ sơ',exact:true}).boundingBox();assert(box&&box.x>=0&&box.x+box.width<=width&&box.y+box.height<=900);
  await mkdir('/tmp/codex3-handoff-screens',{recursive:true});await page.screenshot({path:'/tmp/codex3-handoff-screens/compact-'+width+'.png'});
  await page.getByRole('button',{name:'Xác nhận giao hồ sơ',exact:true}).click();await page.waitForFunction(()=>window.finished);assert.equal(await page.evaluate(()=>window.result.assigneeId),'sa-205');
  assert.equal(await page.evaluate(()=>calls.filter(c=>c.method==='POST').length),1);
  assert.equal(await page.evaluate(()=>calls.filter(c=>c.method==='GET').length),2);
  await page.close();console.log('PASS handoff browser '+width+'px: selected, none, lost ACK retry, logout, visible actions');
 }
}finally{await browser.close();await new Promise(r=>server.close(r));}
