import {test} from 'node:test';
import assert from 'node:assert/strict';
import {eq,and} from 'drizzle-orm';
import {setup} from '../helpers/pos-fixture.ts';
import {webStoreOrders} from '../../src/modules/sales/pos-schema.ts';
import {auditLogs} from '../../src/core/db/schema.ts';
import {stockMoves} from '../../src/modules/inventory/schema.ts';

async function fixture(){
 const f=await setup(),old=new Date(Date.now()-60*60_000).toISOString(),now=new Date().toISOString();
 const add=async(id:string,fields:Partial<typeof webStoreOrders.$inferInsert>={})=>{
  await f.db.insert(webStoreOrders).values({id,source:'lock',externalId:id,orderNo:'WEB-'+id,registerId:f.registerId,status:'processing',customerName:'Khách kiểm thử',phone:'0900000000',orderedAt:old,updatedAt:now,...fields});
 };
 return{...f,add,old,now,get:(query='')=>f.call('/pos/web-orders/attention?registerId='+f.registerId+query,f.emp),contact:(id:string,who=f.emp)=>f.call('/pos/web-orders/'+id+'/contact',who,'POST',{})};
}
test('reminders ignore board pagination/filters and webhook update time; recent, edited, GHN and ended orders are excluded',async()=>{
 const f=await fixture();
 for(const id of ['old','old2'])await f.add(id);
 await f.add('young',{orderedAt:new Date(Date.now()-5*60_000).toISOString()});
 await f.add('future',{orderedAt:new Date(Date.now()+60*60_000).toISOString()});
 await f.add('bad-date',{orderedAt:'bad-date'});
 for(const status of ['completed','cancelled','wc-refunded','packing','lnl-awaiting-pickup'])await f.add(status,{status});
 await f.add('stock-issued',{stockStatus:'issued'});await f.add('ghn',{ghnOrderCode:'GHN-123'});await f.add('attempt',{crmEditSnapshot:JSON.stringify({confirmationStartedAt:f.now})});await f.add('edited',{crmEditSnapshot:'{"revision":1}'});
 await f.add('contacted');await f.db.insert(auditLogs).values({id:'known-contact',actorId:'mgr',module:'sales',action:'web-order-contacted',entityType:'web-store-order',entityId:'contacted',data:'{}',createdAt:f.now});
 const result=await f.get('&status=completed&q=does-not-match&from=2099-01-01&offset=1000');
 assert.equal(result.status,200,JSON.stringify(result.data));assert.equal(result.data.count,2);assert.deepEqual(result.data.orders.map((o:any)=>o.id).sort(),['old','old2']);
 assert(result.data.orders.every((o:any)=>o.ageMinutes>=60));assert(result.data.serverNow);
});
test('contact acknowledgement is shared and idempotent; preserves order, financial and stock data',async()=>{
 const f=await fixture();await f.add('a',{financialSnapshot:'{"version":1,"total":100000}',total:100000});
 const before=await f.db.select().from(webStoreOrders).where(eq(webStoreOrders.id,'a'));
 const movesBefore=await f.db.select().from(stockMoves);
 assert.equal((await f.contact('a')).data.replayed,false);assert.equal((await f.contact('a',f.other)).data.replayed,true);
 assert.equal((await f.get()).data.count,0);
 const events=await f.db.select().from(auditLogs).where(and(eq(auditLogs.entityId,'a'),eq(auditLogs.action,'web-order-contacted')));
 assert.equal(events.length,1);assert.equal(events[0]!.actorId,'emp');
 assert.deepEqual(await f.db.select().from(webStoreOrders).where(eq(webStoreOrders.id,'a')),before);
 assert.deepEqual(await f.db.select().from(stockMoves),movesBefore);
 await f.db.update(webStoreOrders).set({updatedAt:new Date().toISOString()}).where(eq(webStoreOrders.id,'a'));
 assert.equal((await f.get()).data.count,0,'ordinary source sync cannot reset contact');
});
test('same store permission applies to listing and contact; anonymous/supplier cannot use reminders',async()=>{
 const f=await fixture();const made=await f.call('/pos/registers',f.mgr,'POST',{name:'Showroom Gốm Sứ Minh Long Cần Thơ',warehouseId:'pos-wh',pricePolicyId:'retail-vat',secondPricePolicyId:'retail',taxRate:8});assert.equal(made.status,200);const other=made.data;
 await f.add('foreign',{registerId:other.id});
 assert.equal((await f.call('/pos/web-orders/attention?registerId='+other.id,f.emp)).status,403);
 assert.equal((await f.contact('foreign')).status,403);assert.equal((await f.contact('foreign',f.mgr)).status,200);
 assert.equal((await f.call('/pos/web-orders/attention?registerId='+f.registerId)).status,401);
 assert.equal((await f.call('/pos/web-orders/attention?registerId='+f.registerId,f.ncc)).status,403);
 assert.equal((await f.contact('foreign',f.ncc)).status,403);
});
test('stale reminder cannot acknowledge a newly handled order, and failed persistence does not hide it',async()=>{
 const f=await fixture();await f.add('stale');assert.equal((await f.get()).data.count,1);
 await f.db.update(webStoreOrders).set({ghnOrderCode:'NEW-GHN'}).where(eq(webStoreOrders.id,'stale'));
 assert.equal((await f.contact('stale')).status,409);
 await f.add('young',{orderedAt:new Date().toISOString()});assert.equal((await f.contact('young')).status,409);
 await f.add('failure');
 await f.client.exec(`CREATE FUNCTION reject_contact_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='web-order-contacted' THEN RAISE EXCEPTION 'test-only contact failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_contact_test BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION reject_contact_test()`);
 assert.equal((await f.contact('failure')).status,500);assert.equal((await f.get()).data.orders.some((o:any)=>o.id==='failure'),true);
});
test('count covers more than the first 50 displayed reminders and next oldest orders remain available',async()=>{
 const f=await fixture();
 await f.db.insert(webStoreOrders).values(Array.from({length:105},(_,i)=>({id:'batch-'+i,source:'lock',externalId:'batch-'+i,orderNo:'WEB-'+i,registerId:f.registerId,status:'processing',orderedAt:f.old,updatedAt:f.now})));
 const first=await f.get();assert.equal(first.data.count,105);assert.equal(first.data.orders.length,50);
 await f.contact(first.data.orders[0].id);const next=await f.get();assert.equal(next.data.count,104);assert.equal(next.data.orders.length,50);
 assert(!next.data.orders.some((o:any)=>o.id===first.data.orders[0].id));
});
