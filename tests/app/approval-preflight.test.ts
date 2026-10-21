import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import { setup } from '../helpers/pos-fixture.ts';
import { approvalCosts, approvalDebt } from '../../src/modules/sales/api/approval-preflight.ts';
import { employees } from '../../src/modules/staff/schema.ts';
import { salesOrders, paymentSchedules, customerPayments } from '../../src/modules/sales/schema.ts';
const ok=(r:any,status=200)=>{assert.equal(r.status,status,JSON.stringify(r.data));return r.data;};

test('Chi phí: phân biệt thiếu với số 0 đã nhập; đơn không in không bắt phí in',()=>{
  const doc={type:'B2B' as const,rows:[{name:'Ly',qty:2,printFee:1000}]};
  assert.deepEqual(approvalCosts(doc),{missingPrinting:true,missingCommission:true,missingShipping:true});
  assert.equal(approvalCosts({...doc,printing:{totalCost:0}}).missingPrinting,false);
  assert.equal(approvalCosts({...doc,rows:[{...doc.rows[0],printing:{unitPrice:0},commission:{value:0}}],shipping:{payer:'receiver'}}).missingCommission,false);
  assert.equal(approvalCosts({...doc,type:'HRC'}).missingPrinting,false);
  assert.equal(approvalCosts({...doc,rows:[{qty:1,printFee:1,printing:{unitPrice:0}},{qty:1,printFee:1}],printing:{totalCost:100}}).missingPrinting,true,'theo đúng chế độ chi phí từng dòng');
});

test('Kiểm tra duyệt có kiểm quyền, thiếu phí in bị chặn ở server; CK/ship cần xác nhận',async()=>{
  const f=await setup();
  const q=ok(await f.call('/quotes',f.mgr,'POST',{type:'B2B',quoteNo:'REVIEW_001',customer:'Khách kiểm tra',date:'2026-10-21',vat:8,rows:[{name:'Ly',sku:'00123',qty:1,price:100000,printFee:2000}]}),201);
  const order=ok(await f.call('/orders',f.mgr,'POST',{quoteId:q.id}),201);
  assert.equal((await f.call('/orders/'+order.id+'/approval-preflight',f.ncc)).status,403);
  assert.equal((await f.call('/orders/'+order.id+'/approval-preflight',f.emp)).status,403);
  const review=ok(await f.call('/orders/'+order.id+'/approval-preflight',f.mgr));assert.equal(review.costs.missingPrinting,true);
  await f.db.update(employees).set({canApprove:true}).where(eq(employees.id,'emp'));
  const delegated=ok(await f.call('/orders/'+order.id+'/approval-preflight',f.emp));
  assert.equal(delegated.costs.missingPrinting,true);
  assert.equal(delegated.costPrice,undefined);assert.equal(delegated.data,undefined);
  assert.equal((await f.call('/quotes/'+q.id+'/approval-preflight',f.emp)).status,404,'quyền duyệt không mở phạm vi báo giá đã duyệt của người khác');
  const quoteReview=ok(await f.call('/quotes/'+q.id+'/approval-preflight',f.mgr));
  assert.equal(quoteReview.purchaseCostsReady,false);assert.equal(quoteReview.rows,undefined);
  const status='/orders/'+order.id+'/status';
  assert.equal((await f.call(status,f.mgr,'PUT',{status:'confirmed',verified:true,costWarningsReviewed:true})).data.code,'PRINTING_COST_REQUIRED');
  const data=ok(await f.call('/quotes/'+q.id,f.mgr));data.data.rows[0].printing={unitPrice:0};
  ok(await f.call('/quotes/'+q.id,f.mgr,'PUT',{revision:data.revision,data:data.data}));
  assert.equal((await f.call(status,f.mgr,'PUT',{status:'confirmed',verified:true})).data.code,'COST_REVIEW_REQUIRED');
  ok(await f.call(status,f.mgr,'PUT',{status:'confirmed',verified:true,costWarningsReviewed:true}));
});

test('Nợ quá hạn chặn duyệt và tạo đơn/HĐKT mới; phiếu thu đã huỷ không giảm nợ; trả đủ thì duyệt được',async()=>{
  const f=await setup(),now=new Date().toISOString();
  const base={quoteType:'HRC' as const,customerName:'Khách cùng MST',taxCode:'0312345678',ownerId:'emp',createdBy:'emp',orderDate:'2026-01-01',createdAt:now,updatedAt:now};
  await f.db.insert(salesOrders).values([{...base,id:'old-debt',orderNo:'OLD',status:'confirmed',total:1000},{...base,id:'new-draft',orderNo:'NEW',status:'draft',submittedAt:now}]);
  await f.db.insert(paymentSchedules).values({id:'due',orderId:'old-debt',kind:'balance',amount:1000,dueDate:'2026-01-02',createdAt:now});
  await f.db.insert(customerPayments).values({id:'void-payment',orderId:'old-debt',amount:1000,method:'cash',paidAt:'2026-01-03',createdBy:'mgr',createdAt:now,voidedAt:now,voidedBy:'mgr',voidReason:'Nhập sai'});
  const review=ok(await f.call('/orders/new-draft/approval-preflight',f.mgr));
  assert.equal(review.debt.total,1000);assert.equal(review.debt.orders[0].no,'OLD');
  assert.equal((await f.call('/orders/new-draft/status',f.mgr,'PUT',{status:'confirmed',verified:true,costWarningsReviewed:true})).data.code,'CUSTOMER_DEBT_OVERDUE');
  const quote=ok(await f.call('/quotes',f.mgr,'POST',{type:'HRC',quoteNo:'DEBT_001',customer:'Khách cùng MST',customerTaxCode:base.taxCode,customerCode:'C001',date:'2026-10-21',vat:8,rows:[{name:'Ly',qty:1,price:1000}]}),201);
  assert.equal((await f.call('/orders',f.mgr,'POST',{quoteId:quote.id})).data.code,'CUSTOMER_DEBT_OVERDUE');
  assert.equal((await f.call('/contracts',f.mgr,'POST',{quoteId:quote.id,legalEntity:'BN'})).data.code,'CUSTOMER_DEBT_OVERDUE');
  assert.equal(ok(await f.call('/quotes/'+quote.id+'/approval-preflight',f.mgr)).debt.total,1000);
  assert.equal((await approvalDebt(f.db,null,'')).total,0,'không gộp khách lẻ tên giống nhau');
  await f.db.update(customerPayments).set({voidedAt:null,voidedBy:null}).where(eq(customerPayments.id,'void-payment'));
  assert.equal(ok(await f.call('/orders/new-draft/approval-preflight',f.mgr)).debt.total,0);
  ok(await f.call('/orders/new-draft/status',f.mgr,'PUT',{status:'confirmed',verified:true}));
});
