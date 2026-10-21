import {test} from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error UI is native JS.
import {reviewOrderCosts,showApprovalDebt} from '../../trial-ui/approval-preflight.js';
const esc=(s:string)=>s.replace(/[<>]/g,c=>c==='<'?'&lt;':'&gt;');

test('Popup phí in lưu giá 0 rõ ràng bằng revision, giữ nguyên phần khác của báo giá',async()=>{
  const calls:any[]=[],source={type:'B2B',notes:'Giữ ghi chú',rows:[{name:'<img onerror=alert(1)>',qty:2,printFee:1000,costPrice:12000}]};
  const result=await reviewOrderCosts({review:{quoteId:'q',costs:{missingPrinting:true,missingCommission:true,missingShipping:true}},isManager:true,esc,toast(){},
    api:async(path:string,method:string,body:any)=>{calls.push({path,method,body});return {revision:7,data:source};},
    verifyBox:async(opts:any)=>{assert.ok(opts.fields.includes('&lt;img'));assert.ok(!opts.fields.includes('<img'));assert.equal(opts.validate({'printing-0':''}),'Nhập chi phí in/khắc hợp lệ cho từng dòng.');return {'printing-0':'0'};}});
  assert.equal(result,true);const save=calls.find(c=>c.method==='PUT');assert.equal(save.body.revision,7);assert.equal(save.body.data.rows[0].printing.unitPrice,0);assert.equal(save.body.data.rows[0].costPrice,12000);assert.equal(save.body.data.notes,'Giữ ghi chú');
});

test('Huỷ kiểm tra không lưu phí; người được duyệt không tự có quyền sửa giá vốn',async()=>{
  const writes:any[]=[],warnings:string[]=[];
  const args={review:{quoteId:'q',costs:{missingPrinting:true}},isManager:false,esc,toast:(s:string)=>warnings.push(s),api:async()=>{throw Error('Không được đọc giá vốn');},verifyBox:async()=>{throw Error('Không mở form giá vốn');}};
  assert.equal(await reviewOrderCosts(args),false);assert.ok(warnings[0]!.includes('Manager'));
  assert.equal(await reviewOrderCosts({...args,isManager:true,api:async(_p:string,m:string)=>{if(m)writes.push(m);return {revision:1,data:{rows:[{name:'Ly',printFee:1,qty:1}]}};},verifyBox:async()=>null}),false);assert.equal(writes.length,0);
});

test('CK/ship thiếu chỉ cần xác nhận cảnh báo, không ghi số tiền giả',async()=>{
  let checks:string[]=[];
  assert.equal(await reviewOrderCosts({review:{costs:{missingPrinting:false,missingCommission:true,missingShipping:true}},isManager:false,esc,toast(){},api:async()=>{throw Error('Không được ghi báo giá');},verifyBox:async(o:any)=>{checks=o.checks;return {};}}),true);
  assert.ok(checks.some(s=>s.includes('Chưa có CK khách')));assert.ok(checks.some(s=>s.includes('Chưa có cước')));
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
