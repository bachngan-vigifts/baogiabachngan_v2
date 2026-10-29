/** Local Chromium regression with mocked business APIs; never contacts production. */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve,extname} from 'node:path';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const repo=fileURLToPath(new URL('../../',import.meta.url));
const html=`<!doctype html><html class="app-shell" lang="vi"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="/trial-ui/style.css"><link rel="stylesheet" href="/trial-ui/pos.css"><link rel="stylesheet" href="/trial-ui/typography.css">
<div class="workspace"><main class="main"><section id="view-pos"></section></main></div>
<script type="module">
import {initPos} from '/trial-ui/pos.js';
window.calls=[];window.notices=[];
const products=[{sku:'LHC4437IVY',name:'Bình giữ nhiệt 150ml',price:310000,available:32,scanCodes:['LHC4437IVY','8930001']},{sku:'LHC4438BLU',name:'Bình giữ nhiệt 220ml',price:323000,available:16,scanCodes:['LHC4438BLU']}];
const api=async(path,method='GET',body)=>{calls.push({path,method,body});
 if(path.startsWith('/pos/options'))return {registers:[{id:'r',name:'Quầy thử',pricePolicyId:'vat'}],current:{id:'s',registerId:'r',memberId:'emp'},policies:[],templates:[],shifts:[]};
 if(path.startsWith('/pos/catalog')){const q=new URL(path,location.origin).searchParams.get('q');if(q==='NEW'){await new Promise(r=>setTimeout(r,900));return {products:[{sku:'NEW',name:'Sản phẩm chưa tải',price:100000,available:5,scanCodes:['NEW']}],exactSku:'NEW',nextOffset:null};}return {products,nextOffset:null};}
 if(path==='/pos/preview'){await new Promise(r=>setTimeout(r,250));return {total:body.rows.reduce((n,r)=>n+r.qty*(products.find(p=>p.sku===r.sku)?.price||100000),0),discount:0,tax:0,lines:[]};}
 throw Error('Unexpected mock API '+path);
};
const ui=initPos({root:document.querySelector('#view-pos'),api,user:()=>({id:'emp',role:'manager'}),toast:m=>notices.push(m),confirmBox:async()=>false,go(){}});await ui.load();window.ready=true;
</script>`;
const server=createServer(async(req,res)=>{try{const path=new URL(req.url,'http://localhost').pathname,file=resolve(repo,'.'+path);if(path!=='/'&&!file.startsWith(resolve(repo,'trial-ui')+'/')){res.writeHead(404).end();return;}res.setHeader('Content-Type',{'.js':'text/javascript','.css':'text/css'}[extname(path)]||'text/html');res.end(path==='/'?html:await readFile(file));}catch{res.writeHead(404).end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
const out=process.env.POS_SCREENSHOT_DIR||'/workspace/scratch/pos-scan-fast';await mkdir(out,{recursive:true});const results=[];
try{for(const [name,width,height] of [['desktop',1440,1000],['mobile',390,844]]){
 const page=await browser.newPage({viewport:{width,height}}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>window.ready);
 const input=page.getByRole('searchbox',{name:'Tìm hoặc quét sản phẩm'}),status=page.locator('.pos-scan-status');
 const before=await page.evaluate(()=>calls.filter(c=>c.path.startsWith('/pos/catalog')).length),start=Date.now();
 await input.fill('8930001');await input.press('Enter');await status.filter({hasText:'Đã thêm LHC4437IVY'}).waitFor();
 const cachedMs=Date.now()-start;assert.equal(await input.inputValue(),'');assert.equal(await page.evaluate(()=>calls.filter(c=>c.path.startsWith('/pos/catalog')).length),before);
 await input.fill('NEW');await input.press('Enter');await status.filter({hasText:'Đang xử lý mã NEW'}).waitFor();assert.equal(await page.getByRole('button',{name:'Đang xử lý…',exact:true}).isDisabled(),true);
 await page.screenshot({path:out+'/'+name+'-processing.png'});
 await input.fill('NEW');await input.press('Enter');await status.filter({hasText:'Đã thêm NEW'}).waitFor();
 assert.equal(await page.evaluate(()=>calls.filter(c=>c.path.includes('q=NEW')).length),1);
 await page.waitForFunction(()=>calls.some(c=>c.path==='/pos/preview'&&c.body.rows.length===2));
 const rows=await page.evaluate(()=>calls.filter(c=>c.path==='/pos/preview').at(-1).body.rows);assert.equal(rows.find(r=>r.sku==='NEW').qty,1);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.deepEqual(errors,[]);
 await page.screenshot({path:out+'/'+name+'-ready.png'});results.push({viewport:name,cachedScanIncludingBrowserDriverMs:cachedMs,catalogRequestsForCachedScan:0,requestsForDuplicateUncachedScan:1,rows});await page.close();
}console.log(JSON.stringify(results,null,2));}finally{await browser.close();await new Promise(r=>server.close(r));}
