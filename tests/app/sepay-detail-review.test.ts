import {test} from 'node:test';
import assert from 'node:assert/strict';
import {eq} from 'drizzle-orm';
import {setupSepay} from '../helpers/sepay-fixture.ts';
import {webStoreOrders as web} from '../../src/modules/sales/pos-schema.ts';
test('allocation search treats percent and underscore literally',async()=>{
 const f=await setupSepay(),e=await f.incoming('LITERAL SEARCH',50000);
 await f.order('LITERAL_%');await f.order('LITERAL_AX');
 const r=await f.call(`/sepay/transactions/${e.id}/allocation-candidates?q=${encodeURIComponent('LITERAL_%')}`,f.mgr);
 assert.equal((await f.call(`/sepay/transactions/${e.id}/allocation-candidates?source=web`,f.mgr)).data.candidates.length,0);
 assert.equal((await f.call(`/sepay/transactions/${e.id}/allocation-candidates?from=2026-11-09`,f.mgr)).data.candidates.length,0);
 assert.equal(r.status,200);assert.deepEqual(r.data.candidates.map((x:any)=>x.orderNo),['LITERAL_%']);
});
test('changed web total after allocation requires review in detail, summary and bank history',async()=>{
 const f=await setupSepay(),e=await f.incoming('CHANGED TOTAL',100000);
 await f.db.insert(web).values({id:'changed-web',source:'lock',externalId:'changed-web',orderNo:'CHANGED',registerId:f.registerId,status:'on-hold',total:100000,orderedAt:f.stamp,updatedAt:f.stamp});
 const path=`/sepay/transactions/${e.id}/allocations`;
 assert.equal((await f.call(path,f.mgr,'POST',{clientKey:crypto.randomUUID(),expectedRevision:0,lines:[{targetId:'web:changed-web',amount:50000,paymentReviewed:true}]})).status,200);
 await f.db.update(web).set({total:120000}).where(eq(web.id,'changed-web'));
 const detail=(await f.call('/orders/web:changed-web',f.mgr)).data.document;
 assert.equal(detail.paymentReviewRequired,true);assert.equal(detail.paid,null);
 assert.equal((await f.call(path,f.mgr)).data.needsReview,true);
 const other=await f.order('REVIEW_BLOCK_OTHER');
 const blocked=await f.call(path,f.mgr,'POST',{clientKey:crypto.randomUUID(),expectedRevision:1,lines:[{targetId:other.id,amount:1}]});assert.equal(blocked.status,409);assert.match(blocked.data.error,/cần đối soát lại/);
 assert.equal((await f.call('/sepay/transactions/'+e.id,f.mgr)).data.transaction.status,'receipt_issue');
 const summary=(await f.call('/orders?source=web',f.mgr)).data.summary;assert.equal(summary.paid,0);assert.equal(summary.unknownPaymentCount,1);
});
