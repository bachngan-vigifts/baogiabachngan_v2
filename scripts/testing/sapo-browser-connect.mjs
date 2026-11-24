/** CRM + actual content/worker code + local PGlite; default mocks extension APIs, native mode is opt-in. All HTTPS is intercepted. */
import assert from 'node:assert/strict';
import {readFile,mkdtemp,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setup} from '../../tests/helpers/pos-fixture.ts';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=new URL('../../trial-ui/',import.meta.url).pathname,f=await setup();
const origin='https://crm.minhlongonline.com',secret='fixture-sapo-connect-secret-012345678901234';
let expired=false,writes=0,accepted=0;
Object.assign(f.env,{sapoSyncToken:secret,sapoFetch:async()=>expired?new Response('',{status:302,headers:{location:'/admin/login'}}):Response.json({accounts:[]})});
const index=await readFile(root+'index.html','utf8'),dialog=index.slice(index.indexOf('<dialog id="sapo-dialog"'),index.indexOf('</dialog>',index.indexOf('<dialog id="sapo-dialog"'))+9);
const html=`<!doctype html><html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><link rel="stylesheet" href="/typography.css"><link rel="stylesheet" href="/dialog-layout.css"><button id="open">Kết nối lại</button>${dialog}<script type="module">
import {initSapoBrowserConnect} from '/sapo-browser-connect.js';import {installDialogLayouts} from '/dialog-layout.js';installDialogLayouts();
window.manager=true;window.session='manager-1';window.saved=0;window.posts=0;window.connector=initSapoBrowserConnect({dialog:document.querySelector('dialog'),isManager:()=>manager,sessionKey:()=>session,busyChanged:b=>document.querySelector('#save-sapo').disabled=b,api:async(path,method,body)=>{posts++;const r=await fetch('/api/staff'+path,{method,headers:{'content-type':'application/json'},body:JSON.stringify(body)});const d=await r.json();if(!r.ok)throw Error(d.error);return d;},connected:()=>{saved++;document.querySelector('dialog').close();}});
document.querySelector('#open').onclick=()=>{connector.reset();document.querySelector('dialog').showModal();};document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>document.querySelector('dialog').close());window.ready=true;
</script>`;
const native=process.env.SAPO_EXTENSION_NATIVE==='1';
const {captureSession}=await import(new URL('../../trial-ui/sapo-connector/worker.js',import.meta.url));
const extensionPath=root+'sapo-connector',profile=await mkdtemp(join(tmpdir(),'sapo-connector-'));
const context=await chromium.launchPersistentContext(profile,{executablePath:'/usr/bin/chromium',headless:true,ignoreDefaultArgs:native?['--disable-extensions']:[],args:['--no-sandbox',...(native?['--disable-extensions-except='+extensionPath,'--enable-unsafe-extension-debugging']:[])]});
await mkdir('/tmp/sapo-browser-connect',{recursive:true});
try{
 if(native){const cdp=await context.browser().newBrowserCDPSession();await cdp.send('Extensions.loadUnpacked',{path:extensionPath});}
 await context.route('**/*',async route=>{const u=new URL(route.request().url());if(u.origin!==origin)return route.abort();
  if(u.pathname==='/api/staff/admin/sapo-session'){writes++;const r=await f.call('/admin/sapo-session',f.mgr,'POST',route.request().postDataJSON());if(r.status===200)accepted++;return route.fulfill({status:r.status,contentType:'application/json',body:JSON.stringify(r.data)});}
  try{return route.fulfill({status:200,contentType:u.pathname.endsWith('.css')?'text/css':u.pathname.endsWith('.js')?'text/javascript':'text/html',body:u.pathname==='/'?html:await readFile(root+u.pathname)});}catch{return route.abort();}
 });
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 for(const width of [390,1280]){
  await page.setViewportSize({width,height:940});await context.clearCookies();await page.goto(origin+'/?case='+width+'#/staff');await page.waitForFunction(()=>window.ready);
  if(!native){await page.locator('#open').click();await page.locator('#sapo-browser-connect').click();await page.locator('#sapo-browser-status').filter({hasText:'Cần cài tiện ích Chrome'}).waitFor();assert.equal(await page.evaluate(()=>posts),0);await page.getByRole('button',{name:'Huỷ',exact:true}).click();
   if(width===390)await page.exposeFunction('fixtureCapture',message=>captureSession({runtime:{id:'fixture'},cookies:{getAllCookieStores:async()=>[{id:'fixture-store',tabIds:[7]}],getAll:async q=>{assert.equal(q.storeId,'fixture-store');return context.cookies(q.url);}}},message,{id:'fixture',frameId:0,tab:{id:7,url:page.url()}}));
   await page.addScriptTag({content:'window.chrome={runtime:{sendMessage:m=>window.fixtureCapture(m)}};'+await readFile(extensionPath+'/content.js','utf8')});}
  await page.waitForFunction(()=>document.documentElement.dataset.bnSapoConnector==='1');
  await page.locator('#open').click();const button=page.locator('#sapo-browser-connect');
  await button.click();await page.locator('#sapo-browser-status').filter({hasText:'Chưa lấy được phiên'}).waitFor();assert.equal(await page.evaluate(()=>posts),0);
  await context.addCookies([{name:'sapo-admin',value:'fixture-valid',domain:'bachngankiengiang.mysapogo.com',path:'/',httpOnly:true,secure:true},{name:'_admin_session_id',value:'fixture-http-only',domain:'bachngankiengiang.mysapogo.com',path:'/admin',httpOnly:true,secure:true}]);
  await page.screenshot({path:'/tmp/sapo-browser-connect/dialog-'+width+'.png'});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await button.click();await page.waitForFunction(()=>window.saved===1);assert.equal(await page.evaluate(()=>posts),1);
  await page.locator('#open').click();expired=true;await button.click();await page.locator('#sapo-browser-status').filter({hasText:'Phiên Sapo đã hết hạn'}).waitFor();assert.equal(await page.evaluate(()=>saved),1);assert.equal(await button.isEnabled(),true);expired=false;
  // An untrusted/synthetic click cannot ask the extension to read cookies.
  await button.evaluate(b=>b.click());await page.waitForFunction(()=>!!document.querySelector('#sapo-browser-connect').dataset.sapoRequest);
  const priorWrites=writes;await page.evaluate(()=>{const id=document.querySelector('#sapo-browser-connect').dataset.sapoRequest;window.postMessage({type:'BN_SAPO_RESULT',requestId:'wrong',result:{ok:true,cookie:'sapo-admin=forged'}},location.origin);});
  assert.equal(writes,priorWrites);
  // A callback after switching CRM identity must be discarded even if its nonce matches.
  await page.evaluate(()=>{const id=document.querySelector('#sapo-browser-connect').dataset.sapoRequest;session='different';window.postMessage({type:'BN_SAPO_RESULT',requestId:id,result:{ok:true,cookie:'sapo-admin=forged'}},location.origin);});
  await page.waitForFunction(()=>!connector.busy());assert.equal(writes,priorWrites);
  await button.evaluate(b=>b.click());const lateId=await button.getAttribute('data-sapo-request');await page.getByRole('button',{name:'Huỷ',exact:true}).click();await page.evaluate(id=>window.postMessage({type:'BN_SAPO_RESULT',requestId:id,result:{ok:true,cookie:'sapo-admin=late'}},location.origin),lateId);await page.waitForFunction(()=>!connector.busy());assert.equal(writes,priorWrites);await page.locator('#open').click();
  await page.evaluate(()=>{manager=false;});await button.click();assert.equal(await page.evaluate(()=>connector.busy()),false);
  await page.getByRole('button',{name:'Huỷ',exact:true}).click();assert.deepEqual(errors,[]);console.log(JSON.stringify({width,nativeExtension:native,extensionApiSimulation:!native,httpOnlyCapture:true,encryptedSave:true,missingSession:true,expiredSession:true,wrongNonceIgnored:true,identityChangeIgnored:true,closedDialogIgnored:true,noHorizontalOverflow:true}));
 }
 assert.equal(accepted,2);
 console.log(JSON.stringify({writes,accepted,externalNetworkCalls:0}));
}finally{await context.close();await f.client.close();}
