/** Local real router + PGlite and Chromium. No production writes. */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {setup} from '../../tests/helpers/pos-fixture.ts';
import {eq} from 'drizzle-orm';
import {products} from '../../src/modules/catalog/schema.ts';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright'),f=await setup();await f.open();
await f.db.update(products).set({name:"Thố cá nhân 0.52L + nắp Daisy Trắng (065235000)"}).where(eq(products.sku,"00123"));
const uiRoot=process.env.UI_ROOT||fileURLToPath(new URL('../../trial-ui/',import.meta.url)),writes=[];let loseResponse=false;
const server=createServer(async(req,res)=>{try{const u=new URL(req.url,'http://localhost');if(u.pathname.startsWith('/api/staff/')){
 const path=u.pathname.slice('/api/staff'.length)+u.search,chunks=[];for await(const c of req)chunks.push(c);const body=chunks.length?JSON.parse(Buffer.concat(chunks).toString()):undefined;
 if(req.method!=='GET')writes.push({path,body});const token=req.headers.authorization?.replace(/^Bearer /,''),r=await f.call(path,token?'__Host-bn-session='+token:'',req.method,body);
 if(loseResponse&&path==='/purchase-early-requests/file'&&r.status===201){loseResponse=false;res.writeHead(503,{'content-type':'application/json'}).end(JSON.stringify({error:'Mất phản hồi thử nghiệm sau lưu'}));return;}
 const data={...r.data};if(r.cookie)data.sessionToken=r.cookie.split('=')[1];res.writeHead(r.status,{'content-type':'application/json'}).end(JSON.stringify(data));return;
 }const path=u.pathname==='/'?'/index.html':u.pathname;let data=await readFile(uiRoot+path);if(path.endsWith('.html'))data=Buffer.from(data.toString().replace('<head>','<head><meta name="bn-api" content="/api/staff">'));res.setHeader('content-type',path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':'text/html;charset=utf-8');res.end(data);
}catch(e){res.writeHead(500).end(String(e.message));}}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
const origin='http://127.0.0.1:'+server.address().port,out='/workspace/scratch/price-labels';await mkdir(out,{recursive:true});const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']}),results=[];let debugPage;
async function session(width,role='mgr'){
 const context=await browser.newContext({viewport:{width,height:932},locale:'vi-VN'});await context.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.continue():r.abort());
 const cookie=role==='mgr'?f.mgr:f.emp,user=(await f.call('/me',cookie)).data.user;
 await context.addInitScript(({user,token})=>{localStorage.setItem('bn-v2-session',token);localStorage.setItem('bn-v2-session-profile',JSON.stringify({user,session:token}));},{user,token:cookie.split('=')[1]});
 const page=await context.newPage(),errors=[];debugPage=page;page.on('pageerror',e=>errors.push(e.message));return{context,page,errors};
}
try{
 for(const width of [360,390,430,768,1280]){
  const {context,page,errors}=await session(width);
  await page.goto(origin+'/#/products');await page.locator('#product-list tr').first().waitFor();
  await page.getByLabel('Chọn tất cả sản phẩm trang này').check();
  await page.getByRole('button',{name:'In tem giá',exact:true}).click();
  const modal=page.getByRole('dialog',{name:'In tem giá',exact:true});await modal.waitFor();
  const print=modal.getByRole('button',{name:'In A4',exact:true});await print.waitFor();await page.waitForFunction(()=>!document.querySelector('.price-label-dialog [type=submit]').disabled);
  assert.ok((await modal.locator('.modal-foot').boundingBox()).y+(await modal.locator('.modal-foot').boundingBox()).height<=932);
  await modal.getByLabel('Mẫu tem',{exact:true}).selectOption('lock');await modal.getByLabel('Số tem mỗi sản phẩm').fill('25');await modal.getByLabel('Số tem mỗi sản phẩm').blur();
  await page.waitForFunction(()=>document.querySelector('.price-label-summary').textContent.includes('2 tờ'));
  assert.equal(await modal.locator('.price-tag-price strong').first().textContent(),'108.000');
  const geometry=await modal.locator('.price-tag').first().evaluate(tag=>{const box=s=>tag.querySelector(s).getBoundingClientRect(),brand=box('.price-tag-brand'),sku=box('.price-tag-sku'),price=box('.price-tag-price'),vat=box('.price-tag-vat');return {skuInHeader:sku.top>=brand.top&&sku.bottom<=brand.bottom,skuRight:sku.right>brand.left+brand.width/2,bottomDifference:Math.abs(price.bottom-vat.bottom),scale:tag.getBoundingClientRect().width/tag.offsetWidth};});
  assert.ok(geometry.skuInHeader&&geometry.skuRight);assert.ok(geometry.bottomDifference<3*geometry.scale);

  await page.screenshot({path:out+'/lock-'+width+'.png'});
  const decoded=await page.evaluate(async()=>{const img=document.querySelector('.price-tag-qr'),canvas=document.createElement('canvas');canvas.width=canvas.height=240;canvas.getContext('2d').drawImage(img,0,0,240,240);return (await new ZXingBrowser.BrowserQRCodeReader().decodeFromCanvas(canvas)).getText();});assert.equal(decoded,'00123');
  if(width===390){
   const values=['A/B trắng','000022505000'];assert.deepEqual(await page.evaluate(async values=>{const result=[];for(const value of values){const svg=new ZXingBrowser.BrowserQRCodeSvgWriter().write(value,240,240,new Map([[0,'M'],[1,'UTF-8'],[5,4]]));svg.setAttribute('xmlns','http://www.w3.org/2000/svg');const i=new Image();i.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg.outerHTML);await i.decode();const c=document.createElement('canvas');c.width=c.height=240;const ctx=c.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,240,240);ctx.drawImage(i,0,0,240,240);result.push((await new ZXingBrowser.BrowserQRCodeReader().decodeFromCanvas(c)).getText());}return result;},values),values);
   await modal.getByLabel('Nội dung QR').selectOption('link');await page.waitForFunction(()=>!document.querySelector('.price-label-dialog [type=submit]').disabled);const link=await page.evaluate(async()=>{const i=document.querySelector('.price-tag-qr'),c=document.createElement('canvas');c.width=c.height=240;c.getContext('2d').drawImage(i,0,0,240,240);return (await new ZXingBrowser.BrowserQRCodeReader().decodeFromCanvas(c)).getText();});assert.equal(link,origin+'/#/products/00123');await modal.getByLabel('Nội dung QR').selectOption('sku');await page.waitForFunction(()=>!document.querySelector('.price-label-dialog [type=submit]').disabled);}

  await page.evaluate(()=>{window.printCount=0;window.print=()=>window.printCount++;});
  await print.click();await page.waitForFunction(()=>window.printCount===1);assert.equal(await page.locator('#print-sheet .price-label-page').count(),2);assert.equal(await page.locator('#print-sheet .price-tag').count(),25);
  if(width===1280){await page.pdf({path:out+'/lock-a4.pdf',preferCSSPageSize:true,printBackground:true});}
  // Safari may leave the previous print session active. A second print must preserve new content.
  await print.click();await page.waitForFunction(()=>window.printCount===2);assert.equal(await page.locator('#print-sheet .price-tag').count(),25);
  await modal.getByLabel('Mẫu tem',{exact:true}).selectOption('minhlong');await page.waitForFunction(()=>document.querySelector('.price-label-summary').textContent.includes('24 tem/A4'));
  await page.screenshot({path:out+'/minhlong-'+width+'.png'});await print.click();await page.waitForFunction(()=>window.printCount===3);assert.equal(await page.locator('#print-sheet .price-label-page').count(),2);
  if(width===1280)await page.pdf({path:out+'/minhlong-a4.pdf',preferCSSPageSize:true,printBackground:true});
  await page.evaluate(()=>window.dispatchEvent(new Event('afterprint')));await page.waitForFunction(()=>!document.querySelector('#print-sheet').children.length);
  assert.deepEqual(errors,[]);results.push({width,price:108000,skuQr:decoded,lockPages:2,minhLongPages:2,repeatPrint:true});await context.close();
 }
 assert.ok(writes.every(w=>w.path==='/session'),JSON.stringify(writes));
 await writeFile(out+'/results.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results));
}catch(e){console.log(await debugPage?.evaluate(()=>({url:location.href,text:document.body.innerText.slice(-6000)})));await debugPage?.screenshot({path:out+"/error.png"});throw e;}finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));await f.client.close();}
