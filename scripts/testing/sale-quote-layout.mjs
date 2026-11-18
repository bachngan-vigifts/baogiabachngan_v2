/** Real local CRM/router and downloadable files; synthetic data only. */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {setup} from '../../tests/helpers/pos-fixture.ts';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const f=await setup(),root=fileURLToPath(new URL('../../trial-ui/',import.meta.url)),out=process.env.BROWSER_EVIDENCE_DIR||'/tmp/sale-quote-exports';await mkdir(out,{recursive:true});
let writes=0,imageFetches=0;
const server=createServer(async(req,res)=>{try{const u=new URL(req.url,'http://localhost');
 if(u.pathname.startsWith('/api/staff/')){
  if(req.method!=='GET'&&req.method!=='OPTIONS')writes++;if(u.pathname.endsWith('/images/fetch'))imageFetches++;
  const chunks=[];for await(const c of req)chunks.push(c);const auth=req.headers.authorization?.replace(/^Bearer /,'')||'';
  const r=await f.call(u.pathname.slice('/api/staff'.length)+u.search,auth?'__Host-bn-session='+auth:'',req.method,chunks.length?JSON.parse(Buffer.concat(chunks).toString()):undefined);
  res.writeHead(r.status,{'content-type':'application/json'}).end(JSON.stringify(r.data));return;
 }
 const path=u.pathname==='/'?'/index.html':u.pathname;let data=await readFile(root+path);if(path.endsWith('.html'))data=Buffer.from(data.toString().replace('<head>','<head><meta name="bn-api" content="/api/staff">'));
 res.writeHead(200,{'content-type':path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':path.endsWith('.ttf')?'font/ttf':'text/html'}).end(data);
}catch{res.writeHead(404).end('Fixture resource unavailable');}}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
const origin='http://127.0.0.1:'+server.address().port,browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']}),results=[];
try{
 const now=new Date().toISOString(),date=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Ho_Chi_Minh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 await f.client.query("update products set image_url=$1 where sku='00123'",['https://example.test/catalogue-original.png']);
 await f.client.query("insert into sales_orders(id,order_no,quote_type,customer_name,owner_id,created_by,order_date,status,subtotal,total,created_at,updated_at,holds_stock) values ('avg','AVG-SALE','B2B','Synthetic','emp','emp',$1,'confirmed',330000,356400,$2,$2,false)",[date,now]);
 await f.client.query("insert into sales_order_lines(id,order_id,line_no,sku,name,unit,qty,unit_price,list_unit_price,discount_amount,amount) values ('avg-line','avg',1,'00123','Ly thử','Cái',3,110000,120000,60000,330000)");
 for(const width of [390,768,1280,1920]){
  const user=(await f.call('/me',f.emp)).data.user,token=f.emp.split('=')[1],context=await browser.newContext({viewport:{width,height:1000}});
  await context.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.continue():r.abort());await context.addInitScript(({user,token})=>{localStorage.setItem('bn-v2-session',token);localStorage.setItem('bn-v2-session-profile',JSON.stringify({session:token,user}));},{user,token});
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(origin+'/#/quotes');await page.locator('[data-new-quote]').first().click();assert.equal(await page.locator('#nq-type button').count(),4);
  await page.locator('#nq-type [data-value=SALE]').click();await page.waitForFunction(()=>document.querySelector('#nq-no').value.startsWith('SALE_BG_'));await page.locator('#nq-customer').fill('Công ty kiểm thử mẫu Sale '+width);await page.locator('#nq-create').click();
  await page.locator('#quote-form.type-sale').waitFor();await page.locator('#pick-products').click();await page.locator('#picker-all').check();await page.locator('#picker-list [data-add]').first().click();await page.locator('#picker-dialog .modal-foot [data-close]').click();
  await page.locator('#line-list tr .col-average').filter({hasText:'100.000'}).waitFor();assert.equal(await page.locator('#line-head th').count(),8);assert.equal(await page.locator('#line-list [data-image] img').count(),0,'catalogue image must never satisfy a Sale design requirement');
  await page.locator('#line-list [data-k=qty]').fill('2');await page.locator('#line-list [data-k=price]').fill('200000');await page.locator('#line-list [data-k=printFee]').fill('5000');
  const details={materialDescription:'Thủy tinh',brandDescription:'Lucky Thái Lan',volumeDescription:'255ml',printDescription:'In logo 01 màu 01 vị trí trên sản phẩm',packagingDescription:'Hộp carton'};
  for(const [key,value] of Object.entries(details)){assert.equal(await page.locator('#line-list [data-k='+key+']').isVisible(),true);await page.locator('#line-list [data-k='+key+']').fill(value);}
  await page.locator('#toggle-subs').click();assert.equal(await page.locator('#line-list [data-k=materialDescription]').isVisible(),false);
  await page.locator('#toggle-subs').click();assert.equal(await page.locator('#line-list [data-k=materialDescription]').isVisible(),true);

  let response=page.waitForResponse(r=>r.request().method()==='POST'&&new URL(r.url()).pathname==='/api/staff/quotes');await page.locator('#quote-form').evaluate(form=>form.requestSubmit());const draft=await (await response).json();assert.equal(draft.approvalStatus,'draft');await page.waitForFunction(()=>document.querySelector('#editor-dirty').hidden);await page.locator('dialog.quote-care-dialog[open]').waitFor({state:'visible',timeout:1500}).catch(()=>{});await page.locator('dialog.quote-care-dialog[open]').evaluateAll(dialogs=>dialogs.forEach(d=>d.querySelector('[data-close]').click()));
  assert.equal(await page.locator('#toggle-profit').isVisible(),true);await page.locator('#toggle-profit').click();assert.equal(await page.locator('#profit-card').isVisible(),true);for(const id of ['sum-cost','sum-gross','sum-margin','profit-printing','refresh-profit-costs','toggle-cost-fields'])assert.equal(await page.locator('#'+id).isVisible(),false,id);assert.equal(await page.locator('#open-commission').isDisabled(),true);
  assert.equal(await page.locator('#submit-quote').isDisabled(),true);assert.equal(await page.locator('#quote-download').isDisabled(),true);
  await page.locator('#line-list [data-image]').click();const design=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=600;c.height=300;const x=c.getContext('2d');x.fillStyle='#eaf1fb';x.fillRect(0,0,600,300);x.fillStyle='#102a56';x.fillRect(40,40,120,220);x.font='bold 32px Arial';x.fillText('THIẾT KẾ RIÊNG',190,130);x.font='24px Arial';x.fillText('BÁO GIÁ SALE',190,180);return c.toDataURL('image/png').split(',')[1];});await page.locator('#image-file').setInputFiles({name:'sale-design.png',mimeType:'image/png',buffer:Buffer.from(design,'base64')});await page.waitForFunction(()=>!document.querySelector('#image-save').disabled&&document.querySelector('#image-error').textContent==='');
  const uploaded=page.waitForResponse(r=>r.url().endsWith('/quotes/design-images'));await page.locator('#image-save').click();assert.equal((await uploaded).status(),201);await page.waitForFunction(()=>!document.querySelector('#image-dialog').open);
  response=page.waitForResponse(r=>r.request().method()==='PUT'&&r.url().includes('/quotes/'));await page.locator('#quote-form').evaluate(form=>form.requestSubmit());const saved=await (await response).json();assert.equal(saved.revision,2);await page.waitForFunction(()=>document.querySelector('#editor-dirty').hidden);await page.locator('dialog.quote-care-dialog[open]').waitFor({state:'visible',timeout:1500}).catch(()=>{});await page.locator('dialog.quote-care-dialog[open]').evaluateAll(dialogs=>dialogs.forEach(d=>d.querySelector('[data-close]').click()));
  assert.equal((await f.call('/quotes/'+draft.id+'/approve',f.mgr,'POST',{revision:2})).status,200);await page.reload();await page.waitForFunction(()=>!document.querySelector('#quote-download').disabled);await page.locator('#line-list .col-average').filter({hasText:'100.000'}).waitFor();
  assert.equal(await page.locator('#line-list .col-img').isVisible(),true);assert.equal(await page.locator('#line-list .col-img img').count(),1);for(const [key,value] of Object.entries(details)){assert.equal(await page.locator('#line-list [data-k='+key+']').inputValue(),value);assert.equal(await page.locator('#line-list [data-k='+key+']').isVisible(),true);}assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'page must not overflow horizontally');await page.screenshot({path:out+'/sale-layout-'+width+'.png',fullPage:true});await page.locator('#line-list tr').first().screenshot({path:out+'/sale-row-'+width+'.png'});await page.locator('#toggle-profit').click();await page.locator('#profit-card').screenshot({path:out+'/staff-summary-'+width+'.png'});
  if(width<=850)await page.locator('.quote-actions > .mobile-action-trigger').click();await page.locator('#quote-download').click();const gotPdf=page.waitForEvent('download');await page.locator('#pdf-quote-sale').click();const pdf=await gotPdf;await pdf.saveAs(out+'/SALE-'+width+'.pdf');const text=execFileSync('pdftotext',['-layout',out+'/SALE-'+width+'.pdf','-'],{encoding:'utf8'});for(const heading of ['STT','Hình ảnh','Tên sản phẩm','Giá bán','Phí in','Thành tiền'])assert.ok(text.includes(heading),heading);for(const label of ['Chất liệu:','Thương hiệu:','Mã sản phẩm:','Thể tích:','Chế tác:','Đóng gói:','Hộp carton'])assert.ok(text.includes(label),label);assert.ok(text.includes('410.000'));assert.ok(text.includes('100.000'));assert.doesNotMatch(text,/catalogue-original|quote-designs|costPrice/);
  await page.locator('#quote-download').click();const gotExcel=page.waitForEvent('download');await page.locator('#excel-quote-sale').click();const excel=await gotExcel;await excel.saveAs(out+'/SALE-'+width+'.xlsx');assert.deepEqual(errors,[]);
  assert.equal((await f.call('/products?skus=00123',f.emp)).data.products[0].imageUrl,'https://example.test/catalogue-original.png');results.push({width,columns:8,draftWithoutImage:true,privateDesign:true,average:100000,amount:410000,pdf:pdf.suggestedFilename(),excel:excel.suggestedFilename(),errors:errors.length});await context.close();
 }
 console.log(JSON.stringify(results));
}finally{await writeFile(out+'/results.json',JSON.stringify(results,null,2));await browser.close();await new Promise(r=>server.close(r));await f.client.close();}
