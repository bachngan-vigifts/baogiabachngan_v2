/** Real DOCX/preview browser regression with an incompatible cached builder; no production APIs. */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {stampVersion} from '../stamp-ui-version.ts';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright'),root=fileURLToPath(new URL('../../trial-ui/',import.meta.url));
const requests=[];let mode='unversioned',badVersionServed=false;
const server=createServer(async(req,res)=>{try{const u=new URL(req.url,'http://localhost'),p=u.pathname;requests.push({path:p,v:u.searchParams.get('v'),retry:u.searchParams.has('_reload')});
 if(p==='/'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><html lang="vi"><meta charset="utf-8"><body><main></main></body></html>');return;}
 if(!/^\/[\w.-]+$/.test(p)){res.writeHead(404).end();return;}
 let bytes=await readFile(root+p);if(p==='/contract-ui.js')bytes=Buffer.from(stampVersion(bytes.toString(),'review','js'));
 if(p==='/contract-document.js'&&(!u.searchParams.has('v')||(mode==='first-versioned-bad'&&!badVersionServed&&!u.searchParams.has('_reload')))){bytes=Buffer.concat([bytes,Buffer.from('\n delete globalThis.ContractDocument.prepareDocument;')]);badVersionServed=true;}
 res.setHeader('Content-Type',p.endsWith('.js')?'text/javascript':p.endsWith('.css')?'text/css':'application/octet-stream');res.end(bytes);
 }catch{res.writeHead(404).end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port,browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']});const out='/workspace/scratch/contract-loader-version';await mkdir(out,{recursive:true});const results=[];
try{for(const scenario of ['unversioned','first-versioned-bad'])for(const brand of ['BN','VG']){
 mode=scenario;badVersionServed=false;requests.length=0;const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(origin);
 for(const file of ['style.css','typography.css'])await page.addStyleTag({url:origin+'/'+file});
 await page.evaluate(async({brand})=>{const {openContractDocs}=await import('/contract-ui.js?v=review');await openContractDocs({detail:{order:{id:'o',quoteType:brand==='VG'?'VIGIFTS':'B2B',quoteNo:'BG_TEST',customerName:'Khách kiểm thử',contact:'Trần Văn An',address:'Kho thử',subtotal:300000,tax:24000,total:324000},contract:{id:'k',contractNo:'TEST/2026',legalEntity:brand,canEdit:true,canEditFinancial:true,revision:1,signedDate:'2026-10-29',depositRate:30,paymentDays:15,data:{}},lines:[{sku:'SP1',name:'Bộ trà thử nghiệm',unit:'Bộ',qty:2,unitPrice:150000,amount:300000,taxRate:8}]},api:async()=>({}),toast:m=>console.log(m),onSaved(){}});},{brand});
 if(process.env.EXPECT_OLD_FAILURE==='1'){await page.waitForFunction(()=>document.querySelector('[data-status]')?.textContent.includes('is not a function'));console.log(JSON.stringify({reproduced:await page.locator('[data-status]').textContent()}));await page.close();break;}
 for(const type of ['HDKT','TAM_UNG','BBNT']){
  if(type!=='HDKT')await page.locator('[data-doc='+type+']').click();
  await page.waitForFunction(()=>{const status=document.querySelector('[data-status]')?.textContent||'';return status&&!status.startsWith('Đang dựng')&&document.querySelector('.cd-frame')?.contentDocument?.querySelector('.docx-wrapper');});
  const status=await page.locator('[data-status]').textContent();assert.ok(!status.includes('is not a function'),status);const text=await page.locator('.cd-frame').evaluate(f=>f.contentDocument.body.innerText);assert.ok(text.length>100);
  const [word]=await Promise.all([page.waitForEvent('download'),page.locator('[data-one]').click()]);assert.ok(word.suggestedFilename().endsWith('.docx'));
 }
 const [zip]=await Promise.all([page.waitForEvent('download'),page.locator('[data-zip]').click()]);assert.ok(zip.suggestedFilename().endsWith('.zip'));
 const deps=requests.filter(r=>/\/(fflate.min|contract-word-edit|contract-document|jszip.min|docx-preview.min)\.js$/.test(r.path));assert.ok(deps.length>=5);assert.ok(deps.every(r=>r.v==='review'));
 if(scenario==='first-versioned-bad')assert.ok(deps.some(r=>r.path==='/contract-document.js'&&r.retry),'incompatible builder must reload automatically');
 assert.deepEqual(errors,[]);await page.screenshot({path:out+'/'+scenario+'-'+brand+'.png'});results.push({scenario,brand,previews:3,wordDownloads:3,zip:true,allAssetsVersioned:true,recovered:scenario==='first-versioned-bad'});await page.close();
}console.log(JSON.stringify(results,null,2));}finally{await browser.close();await new Promise(r=>server.close(r));}
