import {auditDialog} from './dialog-layout-assertions.mjs';
/** Layout audit: actual CRM HTML/CSS and product/supplier/customer factories; no external requests. */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=new URL('../../trial-ui/',import.meta.url),out=process.env.DIALOG_SCREENSHOT_DIR||'/tmp/crm-dialog-layouts';
await mkdir(out,{recursive:true});
const server=createServer(async(req,res)=>{try{const path=new URL(req.url,'http://localhost').pathname;let data=await readFile(new URL('.'+(path==='/'?'/index.html':path),root));if(path==='/')data=Buffer.from(data.toString().replace(/<script\b[^>]*>[\s\S]*?<\/script>/g,''));res.setHeader('content-type',path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':'text/html');res.end(data);}catch{res.writeHead(404).end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin='http://127.0.0.1:'+server.address().port,browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']}),results=[];
const audit=async(page,selector,name,width)=>results.push(await auditDialog(page,selector,name,width,out));
try{for(const width of[1440,1024,390]){
 const c=await browser.newContext({viewport:{width,height:900}});await c.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.continue():r.abort());const page=await c.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(origin+'/');
 await page.evaluate(async()=>{const {installDialogLayouts}=await import('/dialog-layout.js');installDialogLayouts();const{customerFormFields}=await import('/customer-form-fields.js');document.querySelector('#customer-fields').append(customerFormFields({paymentDays:true}).root);const quick=document.querySelector('#tasks-quick');quick.hidden=false;quick.elements.assigneeId.innerHTML='<option value="emp">Tôi</option>';document.body.append(quick.closest('dialog'));});
 // Every existing static form with >=6 fields and a complete modal frame.
 const ids=await page.evaluate(()=>[...document.querySelectorAll('dialog')].filter(d=>!d.matches('.order-compose,.verify-page,.task-quick-dialog')&&d.querySelector('form .modal-body')&&d.querySelector('.modal-head')&&d.querySelector('.modal-foot')&&d.querySelectorAll('input:not([type=hidden]):not([type=file]):not([type=checkbox]):not([type=radio]),select,textarea').length>=6).map(d=>d.id));
 ids.push('tasks-quick-dialog');
 for(const id of ids){await page.locator('#'+id).evaluate(n=>n.showModal());await audit(page,'#'+id,id,width);}
 await page.evaluate(async()=>{const{initProductAdmin}=await import('/product-admin.js');const policies=Array.from({length:12},(_,i)=>({id:'p'+i,name:'Bảng giá '+i}));window.products=initProductAdmin({api:async()=>({product:{sku:'SKU-001',name:'Đĩa lót 15cm Hoàng Cung Sen Ngọc Bích',brand:'MINH LONG I',unit:'Cái',taxable:true,taxOut:8,prices:policies.map(p=>({policyId:p.id,price:1253000})),imageUrl:'',updatedAt:'1'}}),toast:()=>{},esc:s=>String(s),money:String,confirmBox:async()=>false,isManager:()=>true,policies:()=>policies,onChanged:()=>{}});await window.products.openEdit('SKU-001');});
 await audit(page,'.product-admin-dialog[open]','product-edit',width);
 await page.evaluate(()=>window.products.openCreate());await audit(page,'.product-admin-dialog[open]','product-create',width);
 await page.evaluate(async()=>{const{initSuppliers}=await import('/suppliers.js');const root=document.createElement('section');document.body.append(root);initSuppliers({root,api:async p=>p.startsWith('/suppliers?')?{suppliers:[]}:{accounts:[]},toast:()=>{},confirmBox:async()=>false});root.querySelector('.page-head .btn').click();});
 await audit(page,'.sup-drawer:not([hidden])','supplier-create',width);
 await page.evaluate(async()=>{const{openTeamPayrollSources}=await import('/payroll-team-sources.js');await openTeamPayrollSources({api:async()=>({registers:[{id:'ml',name:'Minh Long',active:true},{id:'lock',name:'LocknLock',active:true}],version:'1'}),esc:String,toast:()=>{}},'2026-11');});
 await audit(page,'.payroll-team-sources[open]','payroll-team-sources',width);
 // Read-only tall dialogs have no enclosing form; close must still hide them.
 await page.evaluate(()=>{const d=document.createElement('dialog');d.className='modal';d.dataset.auditReadonly='';d.innerHTML='<div class="modal-head"><h2>Chi tiết đối chiếu</h2><button>×</button></div><div class="modal-body">'+('<p>Dòng dữ liệu đối chiếu cần xem.</p>'.repeat(25))+'</div><div class="modal-foot"><button class="btn secondary">Đóng</button></div>';document.body.append(d);d.showModal();});
 await audit(page,'dialog[data-audit-readonly]','readonly-details',width);
 await page.evaluate(async()=>{const {showApprovalDebt}=await import('/approval-preflight.js');showApprovalDebt({customerName:'Khách hàng kiểm thử',asOf:'2026-11-10',debt:{total:25000000,orders:Array.from({length:25},(_,i)=>({no:'DH-'+i,overdue:1000000}))}});});
 await audit(page,'.approval-debt-dialog[open]','approval-debt',width);
 await page.evaluate(()=>{const d=document.createElement('dialog');d.className='pos-modal';d.dataset.auditReader='';d.innerHTML='<div class="pos-modal-content"><h2>Chi tiết đơn web</h2><button class="pos-modal-close icon-btn">×</button>'+('<p>Dòng sản phẩm trong đơn kiểm thử</p>'.repeat(25))+'<div class="pos-actions"><button class="btn secondary">Đóng</button><button class="btn primary">Tạo vận đơn GHN</button></div></div>';document.body.append(d);d.showModal();});
 await audit(page,'dialog[data-audit-reader]','pos-order-reader',width);
 // The POS uses the same customer fields with its own form shell.
 await page.evaluate(async()=>{const{customerFormFields}=await import('/customer-form-fields.js');const d=document.createElement('dialog');d.className='pos-modal pos-form-modal pos-customer-create';d.innerHTML='<div class="pos-modal-content"><h2>Khách mới – dùng ngay</h2><button class="icon-btn pos-modal-close">×</button><form><div class="pos-form-actions"><button type="button" class="btn secondary">Huỷ</button><button class="btn primary">Lưu & chọn khách</button></div></form></div>';d.querySelector('form').prepend(customerFormFields().root);document.body.append(d);d.showModal();});
 await audit(page,'.pos-form-modal[open]','pos-customer',width);
 await page.evaluate(async()=>{const {initFeedback}=await import('/feedback.js');initFeedback({root:document.createElement('section'),api:async()=>({}),toast:()=>{},esc:String,go:()=>{}}).openNew();});
 await audit(page,'.fb-dialog[open]','feedback-form',width);
 await page.evaluate(async()=>{const {reviewPurchaseCosts}=await import('/purchase-cost-review.js');void reviewPurchaseCosts(Array.from({length:20},(_,i)=>({sku:'SKU-'+i,name:'Bộ trà Jasmine kiểm thử '+i,qty:2,brand:'MINH LONG I',price:1000000})));});
 await audit(page,'.purchase-cost-dialog[open]','purchase-cost-review',width);
 await page.evaluate(async()=>{const {recordApi,openSpeedDialog}=await import('/speed-log.js');for(let i=0;i<26;i++)recordApi({path:'/kiem-tra-'+String.fromCharCode(65+i),ms:200,status:200});openSpeedDialog();});
 await audit(page,'.speed-dialog[open]','speed-details',width);
 await page.evaluate(async()=>{const {initCare}=await import('/care.js');await initCare({root:document.createElement('section'),api:async p=>p==='/care/config'?{types:[{key:'call',label:'Gọi điện'},{key:'meet',label:'Gặp khách'}],results:[{key:'consulting',label:'Tư vấn'},{key:'ordered',label:'Đã đặt hàng'}],reminds:[{key:'1d',label:'1 ngày'},{key:'1h',label:'1 giờ'}]}:{customers:[]},toast:()=>{},confirmBox:async()=>false,isManager:()=>false,userId:()=> 'emp'}).openForm();});
 if(width>=900)assert.equal(await page.locator('.care-dialog .care-form').evaluate(n=>getComputedStyle(n).gridTemplateColumns.split(' ').length),3);
 await audit(page,'.care-dialog[open]','care-form',width);
 assert.deepEqual(errors,[]);await c.close();
 }await writeFile(out+'/results.json',JSON.stringify(results,null,2));console.log(`PASS ${results.length} dialog/viewport cases; screenshots: ${out}`);
}finally{await browser.close();await new Promise(r=>server.close(r));}
