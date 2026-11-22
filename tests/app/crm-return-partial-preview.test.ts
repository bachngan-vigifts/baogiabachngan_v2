import {test} from 'node:test';
import assert from 'node:assert/strict';
import {eq,and} from 'drizzle-orm';
import {setupCrmReturns} from '../helpers/crm-return-fixture.ts';
import {salesOrderLines} from '../../src/modules/sales/schema.ts';
import {posReturnLines,posExchangeAllocations} from '../../src/modules/sales/return-schema.ts';
import {stockBalances} from '../../src/modules/inventory/schema.ts';
import {postMoves} from '../../src/modules/inventory/api/ledger.ts';
const finalize=(id:string,rid:string)=>`/orders/${id}/returns/${rid}/finalize`;
test('xuất 8, trả 10: chỉ 2 vượt chứng từ là hàng hỏng, nhập tồn 8; replay không nhân đôi',async()=>{
 const f=await setupCrmReturns();await f.seed('partial',0,'emp',false);
 await f.db.update(salesOrderLines).set({qty:10,deliveredQty:10}).where(eq(salesOrderLines.id,'partial-a'));
 await postMoves(f.db,'mgr',[{sku:'09566',warehouseId:'pos-wh',qty:8,kind:'opening',refType:'opening',refId:'partial-open'}]);
 await postMoves(f.db,'mgr',[{sku:'09566',warehouseId:'pos-wh',qty:-8,kind:'sale',refType:'sales_order',refId:'partial'}]);
 const {data:r}=await f.create('partial',[{orderLineId:'partial-a',qty:10,disposition:'restock'}]);
 const d=f.ok(await f.call('/orders/partial/returns',f.mgr));assert.equal(d.returns[0].stockCheck.unproven[0].qty,2);
 const body={confirmed:true,unprovenAsDamaged:true};f.ok(await f.call(finalize('partial',r.id),f.mgr,'POST',body));
 const [l]=await f.db.select().from(posReturnLines).where(eq(posReturnLines.returnId,r.id));
 assert.equal(l!.receivedQty,10);assert.equal(l!.restockQty,8);assert.equal(l!.receivedQty-l!.restockQty,2);
 f.ok(await f.call(finalize('partial',r.id),f.mgr,'POST',body));
 assert.equal((await f.db.select().from(stockBalances).where(and(eq(stockBalances.sku,'09566'),eq(stockBalances.warehouseId,'pos-wh'))))[0]!.qty,8);
});
test('hai phiếu trả: mức hoàn sau nhận do máy chủ tính, dùng đúng mức để finalize',async()=>{
 const f=await setupCrmReturns();await f.seed('two',4372250);
 const first=(await f.create('two',[{orderLineId:'two-a',qty:1,disposition:'restock'}])).data;
 await f.receive('two',first.id);
 f.ok(await f.call(`/orders/two/returns/${first.id}/refund`,f.mgr,'POST',{confirmed:true,key:crypto.randomUUID(),amount:first.total,method:'transfer',reference:'first',drawerId:'store'}),201);
 const second=(await f.create('two',[{orderLineId:'two-b',qty:1,disposition:'restock'}])).data;
 const d=f.ok(await f.call('/orders/two/returns',f.mgr)),preview=d.returns.find((r:any)=>r.id===second.id).refundableAfterReceive;
 assert.equal(preview,second.total);
 const out=f.ok(await f.call(finalize('two',second.id),f.mgr,'POST',{confirmed:true,refund:{key:crypto.randomUUID(),amount:preview,method:'transfer',reference:'second',drawerId:'store'}}));assert.equal(out.status,'completed');
});
test('preview và refund cùng trừ phân bổ đổi hàng đã áp dụng, không cho hoàn hai lần',async()=>{
 const f=await setupCrmReturns();await f.seed('allocated',4372250);
 const first=(await f.create('allocated',[{orderLineId:'allocated-a',qty:1,disposition:'restock'}])).data;await f.receive('allocated',first.id);
 const second=(await f.create('allocated',[{orderLineId:'allocated-b',qty:1,disposition:'restock'}])).data;await f.receive('allocated',second.id);
 await f.seed('replacement',100);
 const at=new Date().toISOString();await f.db.insert(posExchangeAllocations).values({id:'alloc',requestKey:'alloc-key',reservedAt:at,returnId:first.id,amount:100,status:'applied',paymentId:'paid-replacement',replacementOrderId:'replacement',createdBy:'emp',createdAt:at,expiresAt:at,appliedAt:at});
 const d=f.ok(await f.call('/orders/allocated/returns',f.mgr));assert.equal(d.returns.find((r:any)=>r.id===first.id).refundableAfterReceive,first.total-100);
 assert.equal((await f.call(`/orders/allocated/returns/${first.id}/refund`,f.mgr,'POST',{confirmed:true,key:crypto.randomUUID(),amount:first.total,method:'transfer',reference:'over',drawerId:'store'})).status,409);
});

test('phần đổi hàng đang giữ giảm preview và cap; GET không tự huỷ reservation hết hạn',async()=>{
 const f=await setupCrmReturns();await f.seed('reserved',4372250);
 const r=(await f.create('reserved',[{orderLineId:'reserved-a',qty:1,disposition:'restock'}])).data;await f.receive('reserved',r.id);
 const at=new Date().toISOString();await f.db.insert(posExchangeAllocations).values({id:'reserved-alloc',returnId:r.id,amount:100,status:'reserved',createdBy:'emp',createdAt:at,reservedAt:at,expiresAt:'2099-01-01T00:00:00.000Z',requestKey:'reserved-key'});
 let d=f.ok(await f.call('/orders/reserved/returns',f.mgr));assert.equal(d.returns[0].refundableAfterReceive,r.total-100);
 assert.equal((await f.call(`/orders/reserved/returns/${r.id}/refund`,f.mgr,'POST',{confirmed:true,key:crypto.randomUUID(),amount:r.total,method:'transfer',reference:'over-reserved',drawerId:'store'})).status,409);
 await f.db.update(posExchangeAllocations).set({expiresAt:'2000-01-01T00:00:00.000Z'}).where(eq(posExchangeAllocations.id,'reserved-alloc'));
 d=f.ok(await f.call('/orders/reserved/returns',f.mgr));assert.equal(d.returns[0].refundableAfterReceive,r.total);
 assert.equal((await f.db.select().from(posExchangeAllocations).where(eq(posExchangeAllocations.id,'reserved-alloc')))[0]!.status,'reserved','GET chỉ đọc');
});
