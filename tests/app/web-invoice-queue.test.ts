import {test} from 'node:test';
import assert from 'node:assert/strict';
import {eq} from 'drizzle-orm';
import {setup} from '../helpers/pos-fixture.ts';
import {posRegisters,webStoreOrders as web} from '../../src/modules/sales/pos-schema.ts';
import {tasks} from '../../src/modules/tasks/schema.ts';
import {reconcileAutoTasks} from '../../src/modules/tasks/api/auto-tasks.ts';
import {stockMoves} from '../../src/modules/inventory/schema.ts';

test('delivered Lock and Minh Long web orders appear in the invoice filter/count without duplicate tasks or stock writes',async()=>{
 const f=await setup(),stamp='2026-11-03T00:00:00Z';
 await f.db.update(posRegisters).set({name:'CỬA HÀNG LOCKNLOCK CẦN THƠ'}).where(eq(posRegisters.id,f.registerId));
 const ml=await f.call('/pos/registers',f.mgr,'POST',{name:'Showroom Minh Long',warehouseId:'pos-wh',pricePolicyId:'retail-vat',secondPricePolicyId:'retail'});
 assert.equal(ml.status,200,JSON.stringify(ml.data));
 await f.db.insert(web).values([
  {id:'lock-delivered',source:'lock',registerId:f.registerId,ghnStatus:'delivered',status:'processing'},
  {id:'ml-delivered',source:'minhlong',registerId:ml.data.id,ghnStatus:'delivered',status:'completed'},
  {id:'waiting',source:'lock',registerId:f.registerId,ghnStatus:'ready_to_pick',status:'processing'},
  {id:'refund',source:'lock',registerId:f.registerId,ghnStatus:'delivered',status:'refunded'},
 ].map(o=>({...o,externalId:o.id,orderNo:o.id,customerName:'Fixture',ghnOrderCode:'GHN-'+o.id,total:100,orderedAt:stamp,updatedAt:stamp})));
 const before=(await f.db.select().from(stockMoves)).length;
 const list=async(query='',cookie=f.mgr)=>{const r=await f.call('/orders?flow=order&'+query,cookie);assert.equal(r.status,200,JSON.stringify(r.data));return r.data;};
 // Missing event reconciliation cannot hide delivered orders from the queue.
 let d=await list('invoice=requested');
 assert.deepEqual(d.orders.map((o:any)=>o.webOrderId).sort(),['lock-delivered','ml-delivered']);
 assert.equal(d.total,2);assert.equal(d.invoicePending,2);assert.equal(d.summary.revenue,200);
 assert.ok(d.orders.every((o:any)=>o.invoiceStatus==='requested'));
 assert.equal((await list('invoice=requested',f.emp)).invoicePending,1,'Lock employee must not see the Minh Long queue');
 assert.equal((await list('invoice=requested&branch='+ml.data.id)).total,1);
 assert.equal((await list('invoice=requested&q=ml-delivered')).total,1);
 assert.equal((await list('invoice=requested&limit=1&offset=1')).orders.length,1);
 const detail=await f.call('/orders/'+encodeURIComponent('web:lock-delivered'),f.mgr);
 assert.equal(detail.data.document.invoiceStatus,'requested');
 await reconcileAutoTasks(f.db);await reconcileAutoTasks(f.db);
 const jobs=await f.db.select().from(tasks).where(eq(tasks.source,'invoice'));
 assert.equal(jobs.length,2);assert.ok(jobs.every(t=>t.link.includes('/orders/web%3A')));
 const job=jobs.find(t=>t.sourceId==='lock-delivered')!;
 await f.db.update(tasks).set({status:'done',completedBy:'mgr',completedAt:stamp}).where(eq(tasks.id,job.id));
 d=await list('invoice=requested');assert.equal(d.total,1);assert.equal(d.invoicePending,1);
 const handled=(await list()).orders.find((o:any)=>o.webOrderId==='lock-delivered');
 assert.equal(handled.invoiceStatus,'handled');assert.notEqual(handled.invoiceStatus,'issued');
 assert.equal((await list('invoice=issued')).total,0,'task completion alone is not an issued invoice number');
 // System-closed tasks must not suppress a newly eligible order before reconciliation reopens them.
 await f.db.update(tasks).set({completedBy:null}).where(eq(tasks.id,job.id));
 assert.equal((await list('invoice=requested')).total,2);
 assert.equal((await f.db.select().from(stockMoves)).length,before);
});
