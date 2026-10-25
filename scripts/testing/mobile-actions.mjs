/** Native popover + real CRM markup/components. Local mock APIs only. */
import assert from 'node:assert/strict';
import {readFile,mkdir} from 'node:fs/promises';
import {createServer} from 'node:http';
import {fileURLToPath} from 'node:url';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=fileURLToPath(new URL('../../trial-ui/',import.meta.url));
const shell=(await readFile(root+'index.html','utf8')).replace(/<script\b[^>]*>[\s\S]*?<\/script>/g,'');
const fixture=`<script type="module">
import {installMobileActions} from '/mobile-actions.js';
import {initPurchases} from '/purchases.js';
import {initPos} from '/pos.js';
window.actions=[];window.submits=[];
document.querySelector('#app-startup').hidden=true;document.querySelector('#workspace').hidden=false;
document.querySelectorAll('.view').forEach(v=>v.hidden=true);
const view=document.querySelector('#view-orders');view.hidden=false;
document.querySelector('#orders-list').innerHTML='<tr><td><b>DH_20261025_005</b><small>25/10/2026</small></td><td>CÔNG TY PHƯỚC ĐỨC</td><td>CRM</td><td>Thái</td><td>Đã duyệt</td><td>Chờ giao</td><td>Đã thu đủ</td><td>1.668.000đ</td><td class="row-actions"><button type="button" class="btn secondary" data-check="print">In đơn hàng</button><button type="button" class="btn primary" data-check="confirm">Duyệt đơn</button><button type="button" class="btn" hidden data-check="hidden">Không có quyền</button><button type="button" class="btn" disabled data-check="disabled">Đang xử lý</button></td></tr>';
view.addEventListener('click',e=>{const b=e.target.closest('[data-check]');if(b)actions.push(b.dataset.check);else if(e.target.closest('#orders-list tr')&&!e.target.closest('button,a'))actions.push('row-open');});
const headers=[...document.querySelectorAll('#view-orders th')].map(n=>n.textContent);
document.querySelectorAll('#orders-list td').forEach((td,i)=>td.dataset.label=headers[i]);
window.showView=id=>{document.querySelectorAll('.view').forEach(v=>v.hidden=true);document.getElementById(id).hidden=false;};
const dialog=document.createElement('dialog');dialog.id='test-form';dialog.className='modal';
dialog.innerHTML='<form><div class="modal-head"><h2>Sửa thông tin khách hàng</h2></div><div class="modal-body"><label>Tên khách<input name="customer" required></label></div><div class="modal-foot"><span class="muted">Thông tin được giữ nguyên</span><button type="button" class="btn secondary" data-cancel>Huỷ</button><button type="submit" class="btn primary" id="original-save">Lưu khách</button></div></form>';
dialog.querySelector('form').addEventListener('submit',e=>{e.preventDefault();submits.push({value:new FormData(e.target).get('customer'),submitter:e.submitter.id});});dialog.querySelector('[data-cancel]').onclick=()=>dialog.close();document.body.append(dialog);
window.openForm=()=>dialog.showModal();
const api=async(path,method,body)=>{
 if(method){actions.push({path,body});return {request:{id:'draft',revision:1,status:'draft'}};}
 if(path==='/purchase-options')return {suppliers:[{id:'a',name:'NCC A'}],isManager:true,canRequestEarly:true};
 if(path.startsWith('/purchase-orders?'))return {orders:[],counts:{}};
 if(path.startsWith('/purchase-incoming?'))return {canRequest:true,rows:[]};
 if(path.startsWith('/pos/options'))return {registers:[{id:'r',name:'Quầy thử',pricePolicyId:'vat'}],current:{id:'s',registerId:'r',memberId:'emp'},policies:[],templates:[],shifts:[]};
 if(path.startsWith('/pos/orders'))return {orders:[],counts:{}};
 if(path.startsWith('/pos/customers'))return {canListRetail:true,customers:[{id:'customer',name:'Khách thử',phone:'0901234567'}]};
 if(path.startsWith('/pos/catalog'))return {products:Array.from({length:20},(_,i)=>({sku:'SP'+i,name:'Sản phẩm thử '+i,price:50000,available:10})),nextOffset:20};
 throw Error('Unexpected mock API '+path);
};
window.purchase=initPurchases({root:document.querySelector('#view-purchases'),api,toast:()=>{},confirmBox:async()=>true,money:String,go:()=>{},today:()=> '2026-10-25'});
window.pos=initPos({root:document.querySelector('#view-pos'),api,user:()=>({id:'emp',role:'manager'}),toast:()=>{},confirmBox:async()=>false,go:()=>{}});
await purchase.load();await pos.load();installMobileActions();window.ready=true;
</script>`;
const server=createServer(async(req,res)=>{try{const path=new URL(req.url,'http://localhost').pathname;res.setHeader('Content-Type',path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':path.endsWith('.ttf')?'font/ttf':'text/html;charset=utf-8');res.end(path==='/test'?shell.replace('</body>',fixture+'</body>'):await readFile(root+path));}catch{res.writeHead(404).end();}}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
const origin='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
async function openGroup(page,parent){const trigger=page.locator(parent+' > .mobile-action-trigger');await trigger.click();await page.locator(parent+' > .mobile-action-list:popover-open').waitFor();}
try{for(const width of [360,390,430,1280]){
 const context=await browser.newContext({viewport:{width,height:844},acceptDownloads:true});await context.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.continue():r.abort());
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(origin+'/test');await page.waitForFunction(()=>window.ready);await page.waitForTimeout(80);
 const mobile=width<=850;
 if(mobile){
  assert.equal(await page.locator('#orders-new').isVisible(),false);await openGroup(page,'#view-orders .page-head > .row-gap');assert.equal(await page.locator('#orders-new').isVisible(),true);await page.keyboard.press('Escape');
  await openGroup(page,'#orders-list .row-actions');
  await page.locator('#orders-list .mobile-action-heading strong').click();assert.deepEqual(await page.evaluate(()=>actions),[],'blank menu/header must not activate its parent row');
  assert.equal(await page.locator('[data-check="hidden"]').isVisible(),false);assert.equal(await page.locator('[data-check="disabled"]').isDisabled(),true);
  await page.locator('[data-check="print"]').click();await page.waitForFunction(()=>!document.querySelector(':popover-open'));assert.deepEqual(await page.evaluate(()=>actions),['print']);
  await page.evaluate(()=>{const b=document.createElement('button');b.type='button';b.className='btn secondary';b.dataset.check='new';b.textContent='Thao tác mới';document.querySelector('#orders-list .row-actions').append(b);});
  await page.waitForFunction(()=>document.querySelector('[data-check="new"]').parentElement.classList.contains('mobile-action-list'));
  await openGroup(page,'#orders-list .row-actions');await page.locator('[data-check="new"]').click();await page.waitForFunction(()=>!document.querySelector(':popover-open'));assert.deepEqual(await page.evaluate(()=>actions),['print','new']);
  await page.evaluate(()=>openForm());await openGroup(page,'#test-form .modal-foot');await page.locator('#original-save').click();assert.equal(await page.evaluate(()=>submits.length),0,'required validation retained');
  await page.getByLabel('Tên khách',{exact:true}).fill('Anh Thái');await page.waitForFunction(()=>!document.querySelector(':popover-open'));await openGroup(page,'#test-form .modal-foot');await page.locator('#original-save').click();await page.waitForFunction(()=>submits.length===1);
  assert.deepEqual(await page.evaluate(()=>submits),[{value:'Anh Thái',submitter:'original-save'}]);await page.evaluate(()=>document.querySelector('#test-form').close());await page.waitForFunction(()=>!document.querySelector(':popover-open'));
  const checkedForms=await page.evaluate(()=>{
   let count=0;
   for(const dialog of document.querySelectorAll('dialog')){
    const triggers=[...dialog.querySelectorAll('.modal-foot > .mobile-action-trigger')];if(!triggers.length)continue;
    dialog.showModal();
    for(const trigger of triggers){if(trigger.hidden||!trigger.getClientRects().length)continue;trigger.click();const list=document.getElementById(trigger.getAttribute('aria-controls'));if(!list.matches(':popover-open'))throw Error('Form actions unavailable: '+dialog.id);for(const b of list.querySelectorAll('button:not(.mobile-action-heading button)'))if(b.closest('form')&&b.form!==b.closest('form'))throw Error('Form ownership changed');list.hidePopover();count++;}
    dialog.close();
   }
   return count;
  });assert.ok(checkedForms>=20,'all static CRM forms remain operable: '+checkedForms);
  // Existing quote custom menu must not hide the shared trigger or primary actions.
  await page.evaluate(()=>showView('view-editor'));await openGroup(page,'#view-editor .quote-actions');assert.equal(await page.locator('#save-quote').isVisible(),true);await page.keyboard.press('Escape');
  await page.evaluate(()=>showView('view-customers'));assert.equal(await page.locator('#new-customer').isVisible(),false);await openGroup(page,'#view-customers .page-head');assert.equal(await page.locator('#new-customer').isVisible(),true);await page.keyboard.press('Escape');
  await page.evaluate(()=>showView('view-products'));await openGroup(page,'#product-actions');const [chooser]=await Promise.all([page.waitForEvent('filechooser'),page.locator('#catalog-import-label').click()]);await chooser.setFiles({name:'catalog.json',mimeType:'application/json',buffer:Buffer.from('{}')});await page.waitForFunction(()=>!document.querySelector(':popover-open'));
  // Real purchasing module, dynamic dialog, real template file download.
  await page.evaluate(()=>showView('view-purchases'));await openGroup(page,'#view-purchases .head-actions');await page.getByRole('button',{name:'Xin hàng trước bằng file',exact:true}).click();
  await page.locator('.early-file-dialog').waitFor({state:'visible'});const [download]=await Promise.all([page.waitForEvent('download'),page.getByRole('button',{name:'⬇ Tải file mẫu',exact:true}).click()]);assert.equal(download.suggestedFilename(),'mau-xin-hang-truoc.xlsx');await page.locator('.early-file-dialog .modal-head button').click();
  // Real POS retains quantity controls, catalog limits, customer selection and scroll ownership.
  await page.evaluate(()=>showView('view-pos'));await page.locator('.pos-mobile-cart-open').click();await page.locator('.pos-customer-trigger').click();await page.getByRole('combobox',{name:'Tìm khách hàng',exact:true}).fill('Khách');await page.locator('.pos-customer-option').first().click();await page.waitForFunction(()=>document.querySelector('.pos-customer-trigger').textContent==='Khách thử');
  assert.equal(await page.locator('.pos-product-tile').count(),20);assert.equal(await page.locator('.pos-grid').evaluate(e=>getComputedStyle(e).overscrollBehaviorY),'auto');
  // Responsive changes restore original desktop controls and collapse again without duplicates.
  await page.setViewportSize({width:1280,height:844});await page.evaluate(()=>showView('view-orders'));await page.waitForFunction(()=>!document.querySelector('#orders-list .mobile-action-list').hasAttribute('popover'));assert.equal(await page.locator('[data-check="print"]').isVisible(),true);
  await page.setViewportSize({width,height:844});await page.waitForFunction(()=>document.querySelector('#orders-list .mobile-action-list').hasAttribute('popover'));assert.equal(await page.locator('#orders-list .mobile-action-trigger').count(),1);
  await page.evaluate(()=>{for(let i=0;i<15;i++){const b=document.createElement('button');b.type='button';b.className='btn';b.dataset.extra='';b.textContent='Thao tác bổ sung '+i;document.querySelector('#orders-list .row-actions').append(b);}});
  await page.waitForFunction(()=>document.querySelector('#orders-list .mobile-action-list [data-extra]'));
  await openGroup(page,'#orders-list .row-actions');assert.ok(await page.locator('#orders-list .mobile-action-list').evaluate(e=>{e.scrollTop=e.scrollHeight;return e.scrollTop>0;}),'long menus scroll inside the viewport');await page.keyboard.press('Escape');await page.evaluate(()=>document.querySelectorAll('[data-extra]').forEach(b=>b.remove()));
  await openGroup(page,'#orders-list .row-actions');const box=await page.locator('#orders-list .mobile-action-list').boundingBox();assert.ok(box.x>=0&&box.x+box.width<=width+1);assert.ok(box.height<=844*.77);
  if(process.env.MOBILE_SCREENSHOT_DIR){await mkdir(process.env.MOBILE_SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:process.env.MOBILE_SCREENSHOT_DIR+'/menu-'+width+'.png'});}
  await page.keyboard.press('Escape');
  if(process.env.MOBILE_SCREENSHOT_DIR){await mkdir(process.env.MOBILE_SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:process.env.MOBILE_SCREENSHOT_DIR+'/orders-'+width+'.png'});}
 }else{assert.equal(await page.locator('#orders-new').isVisible(),true);assert.equal(await page.locator('#orders-list .mobile-action-trigger').isVisible(),false);await page.locator('[data-check="print"]').click();assert.deepEqual(await page.evaluate(()=>actions),['print']);}
 const fonts=await page.locator('#view-orders h1').evaluate(e=>({heading:getComputedStyle(e).fontSize,body:getComputedStyle(document.body).fontSize}));assert.deepEqual(fonts,mobile?{heading:'19px',body:'14px'}:{heading:'24px',body:'16px'});
 assert.deepEqual(errors,[]);console.log(JSON.stringify({width,groups:await page.locator('.mobile-action-list').count(),delegation:true,forms:true,desktopRestored:true,fonts}));await context.close();
}}finally{await browser.close();server.close();}
