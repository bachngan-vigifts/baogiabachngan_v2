/** Real product form + global money formatter; fake API, no production writes. */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=fileURLToPath(new URL('../../trial-ui/',import.meta.url)),dir=process.env.ARTIFACT_DIR||'/tmp/product-admin-prices';await mkdir(dir,{recursive:true});
const server=createServer(async(req,res)=>{try{const path=new URL(req.url,'http://localhost').pathname;
 res.setHeader('Content-Type',path.endsWith('.js')?'text/javascript;charset=utf-8':path.endsWith('.css')?'text/css':'text/html;charset=utf-8');
 res.end(path==='/'?'<!doctype html><html><body><div><button id="new-product">Thêm sản phẩm</button></div><div id="product-pending"></div><select id="product-brand"><option>Lock</option></select></body></html>':await readFile(path==='/product-admin.js'&&process.env.PRODUCT_ADMIN_SOURCE?process.env.PRODUCT_ADMIN_SOURCE:root+path));
}catch{res.writeHead(404).end();}}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
const origin='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
const cases=[
 {id:'fraction-dot',value:'123456.5',blocked:true},
 {id:'fraction-comma',value:'123456,5',blocked:true},
 {id:'loaded-fraction',edit:true,initial:123.456,blocked:true},
 {id:'unchanged-integer',edit:true,initial:450000,expected:450000},
 {id:'thousands-dot',value:'450.000',vat:'450,000',expected:450000},
 {id:'thousands-comma-edit',edit:true,value:'450,000',expected:450000,clearOptional:true},
 {id:'optional-fraction',value:'450000',optional:'123456.5',blocked:true},
 {id:'bad-grouping',value:'45.00',blocked:true},
 {id:'link-fraction',link:true,blocked:true},
 {id:'image-fraction',value:'123456.5',image:true,blocked:true},
 {id:'required-zero',value:'0',blocked:true},
 {id:'optional-over-limit',value:'450000',optional:'1000000000001',blocked:true},
 {id:'retry-after-error',value:'123456.5',blocked:true,retry:true},
];
const results=[];
try{for(const width of [390,1280])for(const scenario of cases){
 const context=await browser.newContext({viewport:{width,height:844}}),page=await context.newPage(),errors=[];
 page.on('pageerror',e=>errors.push(e.message));await context.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.continue():r.abort());
 try{
  await page.goto(origin);for(const f of ['style.css','typography.css','control-sizes.css'])await page.addStyleTag({url:origin+'/'+f});
  await page.evaluate(async s=>{
   const{initMoneyInputs}=await import('/money-input.js');initMoneyInputs();const{initProductAdmin}=await import('/product-admin.js');
   const pixel='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jTRkAAAAASUVORK5CYII=';
   globalThis.calls=[];globalThis.pixel=pixel;globalThis.changed=0;
   const product={sku:'LOCAL-PRICE',name:'Ly kiểm thử',brand:'Lock',unit:'Cái',taxable:true,taxOut:8,prices:[{policyId:'retail',price:s.initial??450000},{policyId:'vat',price:500000},{policyId:'other',price:1000}],imageUrl:'',updatedAt:'v1'};
   const admin=initProductAdmin({api:async(path,method='GET',body)=>{if(method!=='GET')calls.push({path,method,body});if(path==='/product-link-preview')return {product:{sku:product.sku,name:product.name,price:500.125},warnings:[],source:'local'};if(path==='/product-images')return {imageUrl:'https://example.invalid/local.png'};if(method!=='GET')return {approvalStatus:'approved'};return path==='/product-approvals'?{products:[]}:{product};},toast:()=>{},esc:v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),money:String,confirmBox:async()=>true,isManager:()=>true,policies:()=>[{id:'retail',name:'Giá bán lẻ'},{id:'vat',name:'Giá lẻ +VAT'},{id:'other',name:'Giá sỉ'}],onChanged:()=>changed++,compress:async()=>pixel});
   if(s.edit)await admin.openEdit(product.sku);else admin.openCreate();
  },scenario);
  const dlg=page.locator('dialog.product-admin-dialog');await dlg.waitFor();
  const price=name=>dlg.locator('label').filter({hasText:'Giá: '+name}).locator('input:visible');
  if(!scenario.edit){await dlg.locator('[name=sku]').fill('LOCAL-PRICE');await dlg.locator('[name=name]').fill('Ly kiểm thử');await price('Giá lẻ +VAT').fill(scenario.vat||'500000');}
  if(scenario.value!==undefined)await price('Giá bán lẻ').fill(scenario.value);
  if(scenario.optional!==undefined)await price('Giá sỉ').fill(scenario.optional);
  if(scenario.clearOptional)await price('Giá sỉ').fill('');
  if(scenario.link){await dlg.locator('[name=sourceUrl]').fill('https://example.invalid/product');await dlg.locator('[data-link-fetch]').click();await page.waitForFunction(()=>calls.some(c=>c.path==='/product-link-preview'));}
  if(scenario.image){await dlg.locator('[data-image-file]').setInputFiles({name:'local.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jTRkAAAAASUVORK5CYII=','base64')});await dlg.locator('[data-image-status]').filter({hasText:'Ảnh đã chọn'}).waitFor();}
  await dlg.locator('[type=submit]').click();
  const writes=()=>page.evaluate(()=>calls.filter(c=>c.path==='/products'||c.method==='PUT'||c.path==='/product-images'));
  if(scenario.blocked){
   await page.waitForFunction(()=>!!document.querySelector('[data-err]')?.textContent||!document.querySelector('dialog[open]'));
   assert.equal((await writes()).length,0,'giá lỗi không gửi ghi giá hoặc upload ảnh');assert.ok(await dlg.isVisible());
   assert.match(await dlg.locator('[data-err]').innerText(),scenario.id==='required-zero'?/lớn hơn 0/:/nguyên VNĐ/);
   if(scenario.id!=='required-zero')assert.equal(await dlg.locator('[data-price-error]').isVisible(),true,'lỗi hiện sát ô nhập');
   if(scenario.value!==undefined)assert.equal(await price('Giá bán lẻ').inputValue(),scenario.value,'không tự sửa giá lỗi');
   if(scenario.id==='loaded-fraction')assert.equal(await price('Giá bán lẻ').inputValue(),'123.456');
   await page.screenshot({path:dir+'/'+scenario.id+'-'+width+'.png'});
   if(scenario.retry){await price('Giá bán lẻ').fill('123457');await dlg.locator('[type=submit]').click();await page.waitForFunction(()=>!document.querySelector('dialog[open]'));assert.equal((await writes())[0].body.prices.retail,123457);}
  }else{
   await page.waitForFunction(()=>!document.querySelector('dialog[open]'));const saved=await writes();assert.equal(saved.length,1);assert.equal(saved[0].body.prices.retail,scenario.expected);
   if(scenario.edit){assert.equal(saved[0].method,'PUT');assert.equal(saved[0].body.expectedUpdatedAt,'v1');}else assert.equal(saved[0].body.prices.vat,450000);
   if(scenario.clearOptional)assert.equal(saved[0].body.prices.other,null);
  }
  assert.deepEqual(errors,[]);results.push({id:scenario.id,width,passed:true,pageerrors:errors});
 }catch(e){results.push({id:scenario.id,width,passed:false,error:e.message,pageerrors:errors});}finally{await context.close();}
}
 assert.equal(browser.contexts().length,0);await writeFile(dir+'/results.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results));assert.ok(results.every(r=>r.passed));
}finally{await browser.close();await new Promise(r=>server.close(r));}
