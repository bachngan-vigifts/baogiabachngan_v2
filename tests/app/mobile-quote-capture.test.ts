// @ts-ignore browser module
import {saleDesignProblem} from '../../trial-ui/sale-quote-layout.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {totals} from '../../src/modules/quotes/domain/quote-math.ts';
const load=()=>import(pathToFileURL(resolve('trial-ui/mobile-quote-capture.js')).href);
const {discountProduct}=await import(pathToFileURL(resolve('trial-ui/quote-bulk-discount.js')).href);
test('ảnh báo giá: tính tiền theo quote-math, không đưa dữ liệu nội bộ vào model',async()=>{
 const {quoteCaptureModel}=await load();
 const doc={type:'B2B' as const,date:'2026-10-23',quoteNo:'BG-1',customer:'Khách A',phone:'0912345678',vat:8,notes:'Báo giá có hiệu lực trong 7 ngày.',internalNote:'SECRET_INTERNAL',rows:[{name:'Ly',sku:'LY',qty:2,price:185000,discountType:'percent' as const,discount:10,printFee:2000,costPrice:50000,printing:{unitPrice:9999,workshop:'SECRET_WORKSHOP'},commission:{value:99},secret:'SECRET_ROW'},{name:'Bộ quà',qty:3,price:95000,discountType:'amount' as const,discount:10000}]};
 const model=quoteCaptureModel(doc),t=totals(doc);assert.equal(model.total,t.total);assert.equal(model.tax,t.tax);assert.equal(model.gross-model.discount,t.subtotal);assert.equal(model.validUntil,'30/10/2026');assert.equal(model.rows[0].amount,337000);assert.equal(model.rows[1].discountLabel,'−30.000 đ');
 const text=JSON.stringify(model);for(const value of ['SECRET','costPrice','commission','printing','internalNote'])assert.equal(text.includes(value),false,value);
 assert.equal(quoteCaptureModel({...doc,type:'HRC'}).rows[0].printFee,0);
});
test('ảnh dài: chia trang không mất sản phẩm, tổng tiền chỉ ở trang cuối, bỏ chiết khấu 0',async()=>{
 const {quoteCaptureModel,quoteCapturePages}=await load();
 const model=quoteCaptureModel({type:'HRC',quoteNo:'LONG',customer:'Khách',vat:0,rows:Array.from({length:80},(_,i)=>({name:'MÃ_HÀNG_'+i,sku:'SKU_'+i,qty:1,price:100000,discount:0}))});
 const pages=quoteCapturePages(model,366,(s:string,size:number)=>s.length*size*.55);assert.ok(pages.length>1);
 const texts=pages.flatMap((p:any)=>p.ops.filter((o:any)=>o.kind==='text').map((o:any)=>o.text));
 for(let i=0;i<80;i++)assert.equal(texts.filter((s:string)=>s==='MÃ_HÀNG_'+i).length,1,'đủ đúng một lần mã '+i);
 assert.equal(texts.filter((s:string)=>s==='Tổng thanh toán').length,1);assert.equal(texts.includes('Chiết khấu'),false);assert.ok(pages.at(-1).ops.some((o:any)=>o.text==='8.000.000 đ'));
 assert.ok(pages.every((p:any)=>p.height>0&&p.height<1700));
});
test('ảnh báo giá: VAT hỗn hợp và HRC/B2B/Vigifts luôn giữ tổng chuẩn, không tự đặt ngày hiệu lực',async()=>{
 const {quoteCaptureModel}=await load();
 for(const type of ['HRC','B2B','VIGIFTS'] as const){const doc={type,vat:8,rows:[{name:'A',qty:7,price:123456.78,discount:7.5,printFee:1500,taxRate:10},{name:'B',qty:3,price:98765.4,discountType:'amount' as const,discount:123.45,taxRate:8}]};assert.equal(quoteCaptureModel(doc).total,totals(doc).total);assert.equal(quoteCaptureModel(doc).validUntil,'');}
 assert.throws(()=>quoteCaptureModel({rows:[]}),/Thêm ít nhất/);
});

// Exercise the real button wiring: capture must work on unsaved/unapproved edits,
// while the existing approval gate still applies to document downloads.
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
test('chụp báo giá không cần lưu/duyệt, không ghi API; tải file vẫn giữ điều kiện cũ',async()=>{
 const source=readFileSync('trial-ui/app.js','utf8');
 const actions=source.slice(source.indexOf('function updateQuoteActions()'),source.indexOf('function closeDownloadMenu()'));
 const handler=source.slice(source.indexOf("$('#quote-capture').addEventListener"),source.indexOf("$('#quote-download').addEventListener"));
 for(const scenario of [{id:null,dirty:true,status:'draft',canEdit:true},{id:'q1',dirty:true,status:'draft',canEdit:true},{id:'q1',dirty:false,status:'pending',canEdit:true},{id:'q1',dirty:false,status:'approved',canEdit:false},{id:'q1',dirty:true,status:'approved',canEdit:true,editRequest:{canEditApproved:true}}]){
  const nodes:Record<string,any>={},captures:any[]=[],writes:any[]=[],doc={type:'HRC',quoteNo:'BG',rows:[{name:'Nội dung chưa lưu',sku:'LY',qty:2,price:100000}]};let click!:()=>Promise<void>;
  const node=(id:string)=>nodes[id]||=( {dataset:{},disabled:false,hidden:false,addEventListener:(_name:string,fn:any)=>{if(id==='#quote-capture')click=fn;}} );
  const block=scenario.dirty?'Lưu thay đổi trước.':scenario.status!=='approved'?'Chờ duyệt':null;
  let editControlsRendered=0;
  const ctx:any={saleDesignProblem,isSaleEditor:()=>false,editor:{...scenario,rows:doc.rows,loading:false,approval:{status:scenario.status,canEdit:scenario.canEdit,editRequest:scenario.editRequest}},quoteEditUi:{render(){editControlsRendered++;}},discountProduct,isManager:()=>false,approvalBlock:()=>block,saving:false,$:node,qf:{inert:false,querySelectorAll:()=>[node('#quote-capture'),node('#edit-input')]},closeDownloadMenu(){},window:{matchMedia:()=>({matches:true})},collectQuote:()=>doc,openMobileQuoteCapture:async(opts:any)=>captures.push(opts),api:(...args:any[])=>writes.push(args),toast:(message:string)=>{throw Error(message);}};
  runInNewContext(actions+'\n'+handler+'\nupdateQuoteActions();',ctx);
  assert.equal(node('#quote-capture').disabled,false,JSON.stringify(scenario));
  assert.equal(node('#quote-download').disabled,!!block,'download approval unchanged');
  assert.equal(editControlsRendered,1,'capture refresh also renders edit-request controls');
  assert.equal(node('#bulk-discount').disabled,(scenario.status==='approved'&&!scenario.editRequest?.canEditApproved)||!scenario.canEdit,'bulk discounts retain the edit/approval lock unless explicitly permitted');
  await click();assert.equal(captures.length,1);assert.equal(captures[0].doc,doc,'use current form contents');assert.equal(captures[0].canExport,undefined,'no approval check on PNG sharing');assert.equal(writes.length,0,'capture does not save or submit');
 }
});


test('ảnh gọn: đơn giá sau CK, bỏ CK tổng và luôn đủ thành tiền/VAT/thanh toán',async()=>{
 const {quoteCaptureModel,quoteCapturePages}=await load();
 const doc={type:'HRC',quoteNo:'BG-2026-0142',customer:'Nguyễn Thị Hương',vat:8,rows:[{name:'Bình giữ nhiệt Minh Long 500ml',sku:'031106000',qty:2,price:185000,discount:10},{name:'Bộ quà tặng VIGIFTS Premium',sku:'VG-PREM-01',qty:1,price:450000},{name:'Khăn lụa cao cấp',sku:'KH-LUA-03',qty:3,price:95000,discountType:'amount',discount:50000/3}]};
 const model=quoteCaptureModel(doc);assert.equal(model.rows[0].unitAfterDiscount,166500);assert.equal(Math.round(model.rows[2].unitAfterDiscount),78333);assert.equal(Math.round(model.subtotal),1018000);assert.equal(model.tax,81440);assert.equal(model.total,1099440);
 for(const width of [296,366,390]){
  const pages=quoteCapturePages(model,width,(s:string,size:number)=>s.length*size*.5),ops=pages.flatMap((p:any)=>p.ops),texts=ops.filter((o:any)=>o.kind==='text').map((o:any)=>o.text);
  for(const label of ['Tổng thành tiền','Tiền VAT','Tổng thanh toán'])assert.equal(texts.filter((s:string)=>s===label).length,1);
  assert.equal(texts.includes('Chiết khấu'),false);assert.ok(texts.includes('Đơn giá sau CK: 166.500 đ'));assert.ok(texts.includes('Đơn giá sau CK: 78.333 đ'));assert.ok(texts.includes('235.000 đ'),'line total is not recomputed from rounded display price');assert.ok(pages[0].height<800,'three rows are compact');
 }
 const zero=quoteCaptureModel({...doc,vat:0}),zeroText=quoteCapturePages(zero,366,(s:string,size:number)=>s.length*size*.5)[0].ops.filter((o:any)=>o.kind==='text').map((o:any)=>o.text);assert.ok(zeroText.includes('Tiền VAT'));assert.ok(zeroText.includes('0 đ'));
});
