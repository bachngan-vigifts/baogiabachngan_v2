// Local CRM + PGlite, synthetic records only. Never approves or saves an order.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {eq} from 'drizzle-orm';
import {setupEarly} from '../../tests/helpers/purchase-early-fixture.ts';
import {products,pricePolicies,productPrices} from '../../src/modules/catalog/schema.ts';
import {incomingShipments,incomingShipmentLines} from '../../src/modules/suppliers/schema.ts';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const f=await setupEarly(),root=fileURLToPath(new URL('../../trial-ui/',import.meta.url));
await f.db.insert(products).values({sku:'LINK-DEMO',name:'Nồi Ceres kiểm thử',brand:'Healthycook',unit:'Cái',taxable:true,taxOut:8,updatedAt:new Date().toISOString()});
await f.db.insert(pricePolicies).values([{id:'demo-retail',name:'Giá bán lẻ'},{id:'demo-vat',name:'Giá lẻ +VAT'}]);
await f.db.insert(productPrices).values([{sku:'LINK-DEMO',policyId:'demo-retail',price:1000000},{sku:'LINK-DEMO',policyId:'demo-vat',price:1080000}]);
await f.db.update(incomingShipments).set({approvalStatus:'pending',submittedAt:new Date().toISOString()}).where(eq(incomingShipments.id,'a1'));
await f.db.update(incomingShipmentLines).set({sku:'LINK-DEMO',name:'Nồi Ceres kiểm thử',quantity:1,price:null,purchaseDiscount:null,taxRate:null}).where(eq(incomingShipmentLines.id,'line-a1'));
const user=(await f.call('/me',f.cookies.mgr)).data.user,writes=[];
const server=createServer(async(req,res)=>{try{
  const u=new URL(req.url,'http://localhost'),path=u.pathname;
  if(path.startsWith('/api/staff/')){
    if(req.method!=='GET'){writes.push(path);res.writeHead(409,{'content-type':'application/json'}).end(JSON.stringify({error:'Read-only browser check'}));return;}
    const bearer=req.headers.authorization?.replace(/^Bearer /,'')||'';
    const r=await f.call(path.slice('/api/staff'.length)+u.search,bearer?'__Host-bn-session='+bearer:'');
    res.writeHead(r.status,{'content-type':'application/json'}).end(JSON.stringify(r.data));return;
  }
  let data=await readFile(root+(path==='/'?'index.html':path));
  if(path==='/'||path==='/index.html')data=Buffer.from(data.toString().replace('<head>','<head><meta name="bn-api" content="/api/staff">'));
  res.setHeader('content-type',path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':path.endsWith('.ttf')?'font/ttf':'text/html');res.end(data);
}catch(e){res.writeHead(500).end(e.message);}}).listen(0,'127.0.0.1');
await new Promise(r=>server.once('listening',r));
const origin='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']});
const dir=process.env.PURCHASE_PRICE_SCREENSHOT_DIR||'/workspace/artifacts/purchase-price-prefill';await mkdir(dir,{recursive:true});
try{
  for(const width of [1280,430]){
    const context=await browser.newContext({viewport:{width,height:900}});
    await context.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.continue():r.abort());
    await context.addInitScript(({token,user})=>{
      localStorage.setItem('bn-v2-session',token);localStorage.setItem('bn-v2-session-profile',JSON.stringify({session:token,user}));
      localStorage.setItem('bn-price-policy','demo-retail');
    },{token:f.cookies.mgr.split('=')[1],user});
    const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(origin+'/#/purchases/a1');
    const approve=page.getByRole('button',{name:'Duyệt giá',exact:true,includeHidden:true});await approve.waitFor({state:'attached'});
    if(!await approve.isVisible())await approve.evaluate(n=>n.closest('[popover]')?.showPopover());await approve.click();
    const dialog=page.locator('.pur-drawer').filter({hasText:'Manager duyệt đơn'});
    await page.waitForFunction(()=>document.querySelector('.pur-drawer input.pur-money')?.value==='1000000').catch(async e=>{
      console.log(await dialog.innerText());await page.screenshot({path:dir+'/failure-'+width+'.png'});throw e;
    });
    const fields=dialog.locator('tbody input');
    assert.equal(await fields.nth(1).inputValue(),'15');assert.equal(await fields.nth(2).inputValue(),'8');
    await dialog.getByText(/Giá mua là đơn giá trước CK/).waitFor();
    const footer=dialog.getByRole('button',{name:'Lưu giá nhập',exact:true});await footer.scrollIntoViewIfNeeded();
    const box=await footer.boundingBox();assert(box&&box.x>=0&&box.x+box.width<=width&&box.y+box.height<=900);
    await page.screenshot({path:dir+'/purchase-price-'+width+'.png'});
    assert.deepEqual(errors,[]);await context.close();console.log(JSON.stringify({width,price:1000000,discount:15,tax:8,footerVisible:true}));
  }
  assert.deepEqual(writes,[]);
}finally{await browser.close();server.close();await f.client.close();}
