// Real app module graph, mock-only API; never contacts production.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=fileURLToPath(new URL('../../trial-ui/',import.meta.url));
const server=createServer(async(req,res)=>{
 try{const path=new URL(req.url,'http://localhost').pathname;res.setHeader('Content-Type',path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':path.endsWith('.html')?'text/html; charset=utf-8':'application/octet-stream');res.end(await readFile(root+path));}catch{res.writeHead(404).end();}
}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
const origin='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
const user={id:'manager-test',name:'Thái test',email:'thai@example.invalid',role:'manager',positionId:null};
try{
 for(const width of [390,1280]){
  const context=await browser.newContext({viewport:{width,height:844}});
  await context.addInitScript(u=>{localStorage.setItem('bn-v2-session','test-session');localStorage.setItem('bn-v2-session-profile',JSON.stringify({session:'test-session',user:u}));},user);
  let pendingMe,meSeen=false;const errors=[];
  await context.route('**/*',async route=>{
   const url=route.request().url();
   if(url.includes('/api/staff/')){
    const path=url.split('/api/staff/')[1].split('?')[0];
    if(path==='me'){meSeen=true;pendingMe=route;return;}
    // Offline business endpoints cannot force a still valid saved session back to login.
    return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Mock offline'})});
   }
   return url.startsWith(origin+'/')?route.continue():route.abort();
  });
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin+'/index.html#/quotes',{waitUntil:'domcontentloaded'});
  await page.locator('#workspace').waitFor({state:'visible'});
  assert.equal(meSeen,true);assert.equal(await page.locator('#app-startup').isHidden(),true);assert.equal(await page.locator('#auth').isHidden(),true);
  assert.equal(await page.locator('#user-name').textContent(),user.name);
  await pendingMe.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Mock temporary failure'})});
  await page.waitForLoadState('networkidle');assert.equal(await page.locator('#workspace').isVisible(),true);
  // The next open does not wait either; a real 401 must clear the cached identity and session.
  meSeen=false;await page.reload({waitUntil:'domcontentloaded'});await page.locator('#workspace').waitFor({state:'visible'});assert.equal(meSeen,true);
  await pendingMe.fulfill({status:401,contentType:'application/json',body:JSON.stringify({error:'Expired'})});
  await page.locator('#auth').waitFor({state:'visible'});
  assert.equal(await page.locator('#workspace').isHidden(),true);
  assert.deepEqual(await page.evaluate(()=>[localStorage.getItem('bn-v2-session'),localStorage.getItem('bn-v2-session-profile')]),[null,null]);
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({width,opensBeforeMe:true,temporaryFailureKeepsApp:true,expiredSessionCleared:true}));
  await context.close();
 }
}finally{await browser.close();server.close();}
