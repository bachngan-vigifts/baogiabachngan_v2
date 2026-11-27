import {test} from 'node:test';
import assert from 'node:assert/strict';
import {eq,and} from 'drizzle-orm';
import {setup} from '../helpers/pos-fixture.ts';
import {salesOrders,salesContracts,orderProgressMarks} from '../../src/modules/sales/schema.ts';
import {auditLogs} from '../../src/core/db/schema.ts';
import {submissionReviewProblem,readSubmissionRecord,submissionQuoteBasis} from '../../src/modules/sales/domain/submission-review.ts';
const ok=(r:any,status=200)=>{assert.equal(r.status,status,JSON.stringify(r.data));return r.data;};
const complete=(extra:any={})=>({deliveryDate:'2026-12-20',deliveryAddress:'Địa chỉ giao hàng kiểm thử',receiverName:'Anh nhận hàng',receiverPhone:'0901234567',shippingPayer:'receiver',paymentMethod:'transfer',paymentOther:'',printMode:'',printInstructions:'',sampleDate:'',bulkConfirmed:false,confirmations:{products:true,delivery:true,payment:true,printing:false},...extra});
async function fixture(printing=false,contract=false,choice:'B2B'|'VIGIFTS'|'SALE'='B2B'){
 const f=await setup();
 const q=ok(await f.call('/quotes',f.emp,'POST',{type:choice==='SALE'?'B2B':choice,...(choice==='SALE'?{template:'sale'}:{}),quoteNo:'SUBMIT-'+crypto.randomUUID(),customer:'Khách kiểm thử',customerTaxCode:'0312345678',customerCode:'SUBMIT-FIXTURE',customerAddress:'Địa chỉ khách trên báo giá',vat:8,shipping:{payer:'receiver'},rows:[{name:printing?'Ly sứ in logo':'Ly sứ',sku:'00123',unit:'cái',qty:2,price:100000,printFee:0,...(choice==='SALE'?{image:'https://example.test/sale-design.png',designImage:true}:{}),...(printing?{printDescription:'In logo miễn phí'}:{})}]}),201);
 if(choice==='SALE'){const stored=ok(await f.call('/quotes/'+q.id,f.mgr));stored.data.rows.forEach((r:any)=>Object.assign(r,{costPrice:50000,supplierInfo:'NCC kiểm thử'}));const saved=ok(await f.call('/quotes/'+q.id,f.mgr,'PUT',{revision:1,data:stored.data}));ok(await f.call('/quotes/'+q.id+'/approve',f.mgr,'POST',{revision:saved.revision}));}else ok(await f.call('/quotes/'+q.id+'/approve',f.mgr,'POST',{revision:1}));
 const made=ok(await f.call(contract?'/contracts':'/orders',f.emp,'POST',{quoteId:q.id,...(contract?{legalEntity:'BN'}:{})}),201);
 const id=made.orderId||made.id,path='/orders/'+id;
 const pre=()=>f.call(path+'/submission-review',f.emp);
 const send=async(review:any,versions:any={})=>{const p=ok(await pre());return f.call(path+'/submit',f.emp,'POST',{revision:p.revision,quoteRevision:p.quoteRevision,review,...versions});};
 return {...f,q,id,path,pre,send};
}

test('Required facts: real date/address/phone/payer/payment, sample vs bulk, every confirmation',()=>{
 assert.equal(submissionReviewProblem(complete(),false),'');
 for(const field of ['deliveryDate','deliveryAddress','receiverName','receiverPhone','shippingPayer','paymentMethod'])assert.ok(submissionReviewProblem(complete({[field]:''}),false),field);
 assert.ok(submissionReviewProblem(complete({deliveryDate:'2026-02-31'}),false));
 assert.ok(submissionReviewProblem(complete({deliveryAddress:'Theo thỏa thuận'}),false));
 assert.ok(submissionReviewProblem(complete({receiverPhone:'123'}),false));
 assert.ok(submissionReviewProblem(complete({paymentMethod:'other'}),false));
 assert.ok(submissionReviewProblem(complete({confirmations:{products:true,delivery:false,payment:true}}),false));
 assert.ok(submissionReviewProblem(complete(),true));
 const print=complete({printMode:'sample',printInstructions:'Logo một màu',sampleDate:'2026-12-21',confirmations:{products:true,delivery:true,payment:true,printing:true}});
 assert.ok(submissionReviewProblem(print,true));print.sampleDate='2026-12-19';assert.equal(submissionReviewProblem(print,true),'');
 print.printMode='bulk';assert.ok(submissionReviewProblem(print,true));print.bulkConfirmed=true;assert.equal(submissionReviewProblem(print,true),'');
});

test('Submission is atomic, versioned and private; no bypass or duplicate notification/audit',async()=>{
 const f=await fixture(),pre=ok(await f.pre());
 assert.equal(pre.printing,false);assert.ok(!JSON.stringify(pre).includes('costPrice'));
 assert.equal((await f.call(f.path+'/submission-review',f.ncc)).status,403);
 assert.equal((await f.call(f.path+'/submit',f.ncc,'POST',{})).status,403);
 assert.equal((await f.call(f.path+'/submit',f.emp,'POST',{})).status,409);
 assert.equal((await f.send(complete({paymentMethod:''}))).data.code,'SUBMISSION_REVIEW_REQUIRED');
 assert.equal((await f.send(complete(),{revision:pre.revision+1})).data.code,'ORDER_CHANGED');
 assert.equal((await f.send(complete(),{quoteRevision:pre.quoteRevision+1})).data.code,'QUOTE_CHANGED');
 let [order]=await f.db.select().from(salesOrders).where(eq(salesOrders.id,f.id));assert.equal(order!.submittedAt,null);
 const data=ok(await f.send(complete()));assert.ok(data.submittedAt);
 [order]=await f.db.select().from(salesOrders).where(eq(salesOrders.id,f.id));
 assert.equal(order!.status,'draft');assert.equal(order!.address,'Địa chỉ giao hàng kiểm thử');assert.equal(order!.expectedDeliveryDate,'2026-12-20');
 assert.equal(order!.receiverPhone,'0901234567');assert.ok(readSubmissionRecord(order!.submissionReview));
 const audit=()=>f.db.select().from(auditLogs).where(and(eq(auditLogs.entityId,f.id),eq(auditLogs.action,'submission-review')));
 assert.equal((await audit()).length,1);
 ok(await f.call(f.path+'/submit',f.emp,'POST',{}));assert.equal((await audit()).length,1);
 assert.equal(ok(await f.call(f.path,f.mgr)).submissionReview.paymentMethod,'transfer');
});

test('Logo HĐKT requires explicit sample/bulk; Manager cost-only edits preserve staff review and delivery facts; business edits require resubmission',async()=>{
 const f=await fixture(true,true),pre=ok(await f.pre());assert.equal(pre.printing,true);assert.equal(pre.kind,'HĐKT');
 const before=(await f.db.select().from(salesContracts).where(eq(salesContracts.orderId,f.id)))[0]!;
 const details=complete({shippingPayer:'sender',paymentMethod:'other',paymentOther:'Cọc chuyển khoản, còn lại tiền mặt',printMode:'bulk',printInstructions:'Logo ABC một màu tại một vị trí',bulkConfirmed:false,confirmations:{products:true,delivery:true,payment:true,printing:true}});
 assert.equal((await f.send(details)).data.code,'SUBMISSION_REVIEW_REQUIRED');
 details.bulkConfirmed=true;ok(await f.send(details));
 assert.equal((await f.db.select().from(orderProgressMarks).where(eq(orderProgressMarks.orderId,f.id))).length,0,'staff checkbox never completes sample/production');
 let contract=(await f.db.select().from(salesContracts).where(eq(salesContracts.orderId,f.id)))[0]!;
 assert.equal(contract.deliveryAddress,details.deliveryAddress);assert.equal(contract.paymentMethod,details.paymentOther);
 assert.equal(contract.depositRate,before.depositRate);assert.equal(contract.depositAmount,before.depositAmount);assert.equal(contract.value,before.value);
 assert.equal((await f.call(f.path+'/status',f.mgr,'PUT',{status:'confirmed',verified:true,costWarningsReviewed:true})).data.code,'SHIPPING_PAYER_CHANGED');
 const q=ok(await f.call('/quotes/'+f.q.id,f.mgr));q.data.rows[0].costPrice=50000;q.data.rows[0].costMode='manual';q.data.rows[0].printing={unitPrice:1000};q.data.shipping={...q.data.shipping,payer:'sender',cost:25000};
 ok(await f.call('/quotes/'+f.q.id,f.mgr,'PUT',{revision:q.revision,data:q.data}));
 let order=(await f.db.select().from(salesOrders).where(eq(salesOrders.id,f.id)))[0]!;
 assert.ok(order.submittedAt);assert.ok(order.submissionReview);assert.equal(order.address,details.deliveryAddress);assert.equal(order.expectedDeliveryDate,details.deliveryDate);
 contract=(await f.db.select().from(salesContracts).where(eq(salesContracts.orderId,f.id)))[0]!;assert.equal(contract.deliveryAddress,details.deliveryAddress);
 const costPre=ok(await f.call(f.path+'/approval-preflight',f.mgr));assert.equal(costPre.shippingPayer,'sender');assert.equal(costPre.costs.missingShipping,false);
 const changed=ok(await f.call('/quotes/'+f.q.id,f.mgr));changed.data.rows[0].qty=3;
 ok(await f.call('/quotes/'+f.q.id,f.mgr,'PUT',{revision:changed.revision,data:changed.data}));
 order=(await f.db.select().from(salesOrders).where(eq(salesOrders.id,f.id)))[0]!;assert.equal(order.submittedAt,null);assert.equal(order.submissionReview,null);assert.equal(order.address,details.deliveryAddress,'quantity edits do not erase the physical delivery address');
 assert.equal((await f.db.select().from(auditLogs).where(and(eq(auditLogs.entityId,f.id),eq(auditLogs.action,'submission-review')))).length,1,'invalidation preserves audit');
 ok(await f.send(details));
 ok(await f.call(f.path+'/status',f.mgr,'PUT',{status:'confirmed',verified:true,costWarningsReviewed:true}));
 const later=ok(await f.call('/quotes/'+f.q.id,f.mgr));later.data.deliveryDate='2026-12-25';later.data.notes='- Địa chỉ giao hàng: Địa chỉ mới được Manager cập nhật';
 ok(await f.call('/quotes/'+f.q.id,f.mgr,'PUT',{revision:later.revision,data:later.data}));
 order=(await f.db.select().from(salesOrders).where(eq(salesOrders.id,f.id)))[0]!;
 assert.equal(order.expectedDeliveryDate,'2026-12-25');assert.equal(order.address,'Địa chỉ mới được Manager cập nhật','historical staff review does not freeze Manager delivery edits after approval');
});

test('B2B, Vigifts and Sale share the required confirmations for both generated orders and contracts',async()=>{
 for(const choice of ['B2B','VIGIFTS','SALE'] as const)for(const contract of [false,true]){
  const f=await fixture(true,contract,choice),pre=ok(await f.pre());assert.equal(pre.kind,contract?'HĐKT':'Đơn hàng');assert.equal(pre.printing,true);
  assert.equal((await f.call(f.path+'/status',f.mgr,'PUT',{status:'confirmed'})).data.code,'VERIFY_REQUIRED');
  assert.equal((await f.call(f.path+'/status',f.emp,'PUT',{status:'confirmed',verified:true})).status,403);
  assert.equal((await f.send(complete())).data.code,'SUBMISSION_REVIEW_REQUIRED',choice+' requires print instructions and choice');
  const details=complete({printMode:'bulk',printInstructions:'In logo 01 màu 01 vị trí',bulkConfirmed:false,confirmations:{products:true,delivery:true,payment:true,printing:true}});
  assert.equal((await f.send(details)).data.code,'SUBMISSION_REVIEW_REQUIRED',choice+' cannot bypass bulk confirmation');
  details.bulkConfirmed=true;ok(await f.send(details));
  const [order]=await f.db.select().from(salesOrders).where(eq(salesOrders.id,f.id));assert.equal(order!.status,'draft');assert.equal(readSubmissionRecord(order!.submissionReview)?.printing,true);
 }
});

test('changing new Sale product specifications requires re-confirmation while legacy and cost-only facts stay stable',()=>{
 const row={sku:'LG-143509',name:'Bộ ly',qty:1,price:100,brand:'Gốc',materialDescription:'Thủy tinh',brandDescription:'Lucky Thái Lan',volumeDescription:'255ml',packagingDescription:'Hộp carton'};
 const doc={type:'B2B',template:'sale',rows:[row]},basis=submissionQuoteBasis(doc);
 assert.equal(submissionQuoteBasis({...doc,rows:[{...row,costPrice:999,purchaseDiscount:50}]}),basis);
 for(const key of ['materialDescription','brandDescription','volumeDescription','packagingDescription'])assert.notEqual(submissionQuoteBasis({...doc,rows:[{...row,[key]:'Đã đổi'}]}),basis,key);
 const old={type:'B2B',rows:[{sku:'A',name:'Ly',qty:1,price:100}]};
 assert(!Object.hasOwn(JSON.parse(submissionQuoteBasis(old)),'saleSpecifications'));
 assert.equal(submissionQuoteBasis({...old,rows:[{...old.rows[0],materialDescription:'Không dùng cho mẫu cũ'}]}),submissionQuoteBasis(old));
});
