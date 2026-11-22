import {test} from 'node:test';
import assert from 'node:assert/strict';
import {and,eq} from 'drizzle-orm';
import {setupCrmReturns} from '../helpers/crm-return-fixture.ts';
import {salesOrders,salesOrderLines} from '../../src/modules/sales/schema.ts';
import {posReturns,posReturnLines,posExchangeAllocations} from '../../src/modules/sales/return-schema.ts';
import {stockMoves} from '../../src/modules/inventory/schema.ts';
import {postMoves} from '../../src/modules/inventory/api/ledger.ts';
import {restockPortion} from '../../src/modules/sales/domain/crm-return-restock.ts';
import {vnClock} from '../../src/modules/store/domain/reports.ts';

const base=(id:string,rid:string)=>`/orders/${id}/returns/${rid}`;
async function partial(id:string){
 const f=await setupCrmReturns();await f.seed(id,0,'emp',false);
 await f.db.update(salesOrderLines).set({qty:10,deliveredQty:10}).where(eq(salesOrderLines.id,id+'-a'));
 await postMoves(f.db,'mgr',[{sku:'09566',warehouseId:'pos-wh',qty:8,kind:'opening',refType:'opening',refId:id+'-open'}]);
 await postMoves(f.db,'mgr',[{sku:'09566',warehouseId:'pos-wh',qty:-8,kind:'sale',refType:'sales_order',refId:id}]);
 const r=(await f.create(id,[{orderLineId:id+'-a',qty:10,disposition:'restock'}])).data;
 return {...f,r};
}
test('review 1: báo cáo kiểm tồn tháng đếm 2 hàng hỏng của dòng nhận 10, nhập tồn 8',async()=>{
 const id='review-report',f=await partial(id);
 f.ok(await f.call(base(id,f.r.id)+'/finalize',f.mgr,'POST',{confirmed:true,unprovenAsDamaged:true}));
 const month=vnClock(new Date().toISOString()).day.slice(0,7);
 const d=f.ok(await f.call(`/store/reports/draft?registerId=${f.registerId}&kind=stocktake&period=${month}`,f.mgr));
 assert.deepEqual(d.facts.damaged.map((l:any)=>[l.sku,l.qty]),[['09566',2]]);
});
test('review 2: dùng 500 đổi hàng, hoàn 500 của phiếu A trị giá 1000 vẫn hoàn tất dù B còn dư',async()=>{
 const id='review-complete',f=await setupCrmReturns();await f.seed(id,2000,'emp',false);
 await f.db.update(salesOrders).set({subtotal:2000,tax:0,total:2000}).where(eq(salesOrders.id,id));
 await f.db.update(salesOrderLines).set({qty:1,deliveredQty:1,amount:1000,unitPrice:1000,taxRate:0}).where(eq(salesOrderLines.orderId,id));
 const a=(await f.create(id,[{orderLineId:id+'-a',qty:1,disposition:'damaged'}])).data;
 const b=(await f.create(id,[{orderLineId:id+'-b',qty:1,disposition:'damaged'}])).data;
 await f.receive(id,a.id);await f.receive(id,b.id);await f.seed('review-replacement',500);
 const at=new Date().toISOString();await f.db.insert(posExchangeAllocations).values({id:'review-applied',requestKey:'review-applied-key',returnId:a.id,amount:500,status:'applied',paymentId:'paid-review-replacement',replacementOrderId:'review-replacement',createdBy:'emp',createdAt:at,reservedAt:at,expiresAt:at,appliedAt:at});
 const d=f.ok(await f.call(`/orders/${id}/returns`,f.mgr));assert.equal(d.returns.find((r:any)=>r.id===a.id).refundableAfterReceive,500);
 const out=f.ok(await f.call(base(id,a.id)+'/finalize',f.mgr,'POST',{confirmed:true,refund:{key:crypto.randomUUID(),amount:500,method:'transfer',reference:'review-500',drawerId:'store'}}));
 assert.equal(out.status,'completed');assert.ok(out.available>0,'phần dư của B không được làm kẹt A');
 assert.equal((await f.db.select().from(posReturns).where(eq(posReturns.id,b.id)))[0]!.status,'processing');
});
test('review 3: căn cứ Manager đã che 2, chứng từ giảm 8→6: chỉ hỏng 2 mới phát sinh, vẫn nhập 8',async()=>{
 const id='review-basis',f=await partial(id);
 f.ok(await f.call(base(id,f.r.id)+'/approve',f.mgr,'POST',{stockBasis:{kind:'pre_opening',note:'Hàng đã giao trước ngày chốt tồn'}}));
 await f.db.update(stockMoves).set({qty:-6}).where(and(eq(stockMoves.refType,'sales_order'),eq(stockMoves.refId,id)));
 f.ok(await f.call(base(id,f.r.id)+'/finalize',f.mgr,'POST',{confirmed:true,unprovenAsDamaged:true}));
 const [l]=await f.db.select().from(posReturnLines).where(eq(posReturnLines.returnId,f.r.id));assert.equal(l!.restockQty,8);assert.equal(l!.receivedQty-l!.restockQty,2);
});
test('review 5: snapshot chia hỏng sai không làm hỏng GET, nhưng finalize vẫn bị chặn và không ghi kho',async()=>{
 const id='review-invalid',f=await partial(id);
 await f.db.update(posReturns).set({sourceSnapshot:JSON.stringify({...JSON.parse(f.r.sourceSnapshot),unprovenDamagedByLine:{[id+'-a']:11}})}).where(eq(posReturns.id,f.r.id));
 const d=f.ok(await f.call(`/orders/${id}/returns`,f.mgr));const line=d.returns[0].lines[0];
 assert.equal(line.plannedRestockQty,null);assert.ok(line.restockWarning);assert.ok(d.returns[0].stockCheck.warning);
 assert.equal((await f.call(base(id,f.r.id)+'/finalize',f.mgr,'POST',{confirmed:true,unprovenAsDamaged:true})).status,409);
 assert.equal((await f.db.select().from(stockMoves).where(eq(stockMoves.refId,f.r.id))).length,0);
});
test('review 6: sai số 0.1+0.2 không chặn dòng 0.3; số sai thực sự vẫn bị chặn',()=>{
 assert.equal(restockPortion({requestedQty:0.3,disposition:'restock'},0.1+0.2),0);
 assert.throws(()=>restockPortion({requestedQty:0.3,disposition:'restock'},0.301));
});
test('hoàn tất không coi reservation chưa áp dụng là đã xử lý tiền',async()=>{
 const id='review-reserved',f=await setupCrmReturns();await f.seed(id,4372250);
 const r=(await f.create(id,[{orderLineId:id+'-a',qty:1,disposition:'restock'}])).data;await f.receive(id,r.id);
 const at=new Date().toISOString();await f.db.insert(posExchangeAllocations).values({id:'review-reservation',returnId:r.id,amount:r.total,status:'reserved',createdBy:'emp',createdAt:at,reservedAt:at,expiresAt:'2099-01-01T00:00:00Z',requestKey:'review-reservation-key'});
 const preview=f.ok(await f.call(`/orders/${id}/returns`,f.mgr));assert.equal(preview.returns[0].refundableAfterReceive,0);
 assert.equal((await f.call(base(id,r.id)+'/complete',f.mgr,'POST',{})).status,409);
 const out=f.ok(await f.call(base(id,r.id)+'/finalize',f.mgr,'POST',{confirmed:true}));assert.equal(out.status,'processing');
});
