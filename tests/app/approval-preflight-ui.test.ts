import {test} from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error UI is native JS.
import {reviewOrderCosts,showApprovalDebt} from '../../trial-ui/approval-preflight.js';
const esc=(s:string)=>s.replace(/[<>]/g,c=>c==='<'?'&lt;':'&gt;');

test('Nhập đủ giá nhập, phí in, bên trả ship; giá 0 rõ ràng được lưu theo revision',async()=>{
 const calls:any[]=[],source={type:'B2B',notes:'Giữ ghi chú',rows:[{name:'<img onerror=alert(1)>',qty:2,printFee:1000,costPrice:12000}]};
 let revision:number|undefined;
 const result=await reviewOrderCosts({review:{quoteId:'q',costs:{missingPrinting:true}},isManager:true,esc,toast(){},onReviewed:(r:any)=>{revision=r.quoteRevision;},
 api:async(path:string,method:string,body:any)=>{calls.push({path,method,body});return {revision:method==='PUT'?8:7,data:source};},
 verifyBox:async(o:any)=>{
  assert.ok(o.fields.includes('&lt;img'));assert.ok(!o.fields.includes('<img'));
  assert.ok(o.validate({'purchase-0':'','printing-0':'0','shipping-payer':'receiver'}).includes('giá nhập'));
  assert.ok(o.validate({'purchase-0':'12000','printing-0':''}).includes('in/khắc'));
  assert.ok(o.validate({'purchase-0':'12000','printing-0':'0'}).includes('bên chịu'));
  for(const value of ['', '0', '-1','Infinity'])assert.ok(o.validate({'purchase-0':'12000','printing-0':'0','shipping-payer':'sender','shipping-cost':value}).includes('lớn hơn 0'));
  const values={'purchase-0':'0','printing-0':'0','shipping-payer':'sender','shipping-cost':'45000'};
  assert.equal(o.validate(values),'');return values;
 }});
 assert.equal(result,true);const save=calls.find(c=>c.method==='PUT');
 assert.equal(save.body.revision,7);assert.equal(revision,8);assert.equal(save.body.data.rows[0].printing.unitPrice,0);
 assert.equal(save.body.data.rows[0].costPrice,0);assert.equal(save.body.data.rows[0].costMode,'manual');
 assert.deepEqual(save.body.data.shipping,{payer:'sender',cost:45000});assert.equal(save.body.data.notes,'Giữ ghi chú');
});

test('Huỷ kiểm tra không lưu phí; người được duyệt không tự có quyền sửa giá vốn',async()=>{
  const writes:any[]=[],warnings:string[]=[];
  const args={review:{quoteId:'q',costs:{missingPrinting:true}},isManager:false,esc,toast:(s:string)=>warnings.push(s),api:async()=>{throw Error('Không được đọc giá vốn');},verifyBox:async()=>{throw Error('Không mở form giá vốn');}};
  assert.equal(await reviewOrderCosts(args),false);assert.ok(warnings[0]!.includes('Manager'));
  assert.equal(await reviewOrderCosts({...args,isManager:true,api:async(_p:string,m:string)=>{if(m)writes.push(m);return {revision:1,data:{rows:[{name:'Ly',printFee:1,qty:1}]}};},verifyBox:async()=>null}),false);assert.equal(writes.length,0);
});

test('Người được chỉ định không được bỏ qua chi phí thiếu; đủ chi phí thì chỉ xem xác nhận',async()=>{
 let opened=false,revision:number|undefined;
 const args={review:{quoteRevision:3,costs:{missingPurchase:false,missingPrinting:false,missingShipping:true}},isManager:false,esc,toast(){},api:async()=>{throw Error('Không được đọc giá vốn');},verifyBox:async()=>{opened=true;return {};},onReviewed:(r:any)=>{revision=r.quoteRevision;}};
 assert.equal(await reviewOrderCosts(args),false);assert.equal(opened,false);
 args.review.costs.missingShipping=false;
 assert.equal(await reviewOrderCosts(args),true);assert.equal(opened,true);assert.equal(revision,3);
});

test('Thẻ công nợ dùng textContent, chỉ chứa thông tin cần gửi khách',()=>{
  class Element {
    className='';textContent='';children:Element[]=[];events:Record<string,()=>void>={};
    append(...nodes:Element[]){this.children.push(...nodes);}addEventListener(k:string,f:()=>void){this.events[k]=f;}
    showModal(){}close(){this.events.close?.();}remove(){}
  }
  const before=globalThis.document,body=new Element();Object.assign(globalThis,{document:{body,createElement:()=>new Element()}});
  try {
    const d=showApprovalDebt({customerName:'<img onerror=alert(1)>',asOf:'2026-10-21',debt:{total:1234.5,orders:[{no:'<script>',overdue:1234.5}]},costPrice:999});
    const walk=(e:Element):string=>[e.textContent,...e.children.map(walk)].join(' '),text=walk(d);
    assert.ok(text.includes('1.234,5 đ'));assert.ok(text.includes('21/10/2026'));assert.ok(text.includes('<img onerror=alert(1)>'));assert.ok(!text.includes('999'));
    assert.equal(body.children.length,1);
  } finally {Object.assign(globalThis,{document:before});}
});


test('Cảnh báo có nút tiếp tục: Đóng trả false, chỉ bấm Vẫn duyệt mới trả true',async()=>{
  class Element {
    className='';textContent='';children:Element[]=[];events:Record<string,()=>void>={};
    append(...nodes:Element[]){this.children.push(...nodes);}addEventListener(k:string,f:()=>void){this.events[k]=f;}
    showModal(){}close(){this.events.close?.();}remove(){}
  }
  const before=globalThis.document;Object.assign(globalThis,{document:{body:new Element(),createElement:()=>new Element()}});
  const review={customerName:'Khách',asOf:'2026-10-21',debt:{total:100,orders:[]}};
  try {
    const dlg=showApprovalDebt(review,{continueLabel:'Vẫn duyệt đơn'});
    const footer=dlg.children[1];footer.children.find((e:Element)=>e.textContent==='Vẫn duyệt đơn').events.click();
    assert.equal(await dlg.result,true);
    const cancelled=showApprovalDebt(review,{continueLabel:'Vẫn tạo HĐKT'});
    cancelled.children[1].children.find((e:Element)=>e.textContent==='Đóng').events.click();
    assert.equal(await cancelled.result,false);
    const escaped=showApprovalDebt(review,{continueLabel:'Vẫn tạo đơn'});escaped.close();assert.equal(await escaped.result,false);
  } finally {Object.assign(globalThis,{document:before});}
});


test('Khách trả ship: xoá chi phí công ty cũ; xác nhận giá từ nguồn nhập; báo giá đổi thì không mở form cũ',async()=>{
 let saved:any,opened=false;
 const base={review:{quoteId:'q',quoteRevision:7,costs:{},purchaseCosts:[{index:0,unitCost:55000,source:'purchase'}]},isManager:true,esc,toast(){},
  api:async(_p:string,m:string,b:any)=>{if(m==='PUT'){saved=b;return {revision:8};}return {revision:7,data:{type:'HRC',shipping:{payer:'sender',cost:30000},rows:[{name:'Bình',qty:1}]}};},
  verifyBox:async(o:any)=>{opened=true;assert.ok(o.fields.includes('value="55000"'));return {'purchase-0':'55000','shipping-payer':'receiver'};}};
 assert.equal(await reviewOrderCosts(base),true);assert.deepEqual(saved.data.shipping,{payer:'receiver'});
 assert.equal(saved.data.rows[0].costPrice,55000);assert.equal(saved.data.rows[0].costMode,'manual');
 opened=false;saved=null;
 assert.equal(await reviewOrderCosts({...base,review:{...base.review,quoteRevision:6}}),false);
 assert.equal(opened,false);assert.equal(saved,null);
});
