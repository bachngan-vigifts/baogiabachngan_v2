import {test} from 'node:test';
import assert from 'node:assert/strict';
import {eq,inArray,like} from 'drizzle-orm';
import {setup} from '../helpers/pos-fixture.ts';
import {sourceAssignmentFixture} from '../helpers/warehouse-source-assignment-fixture.ts';
import {syncJobs} from '../../src/core/db/schema.ts';
import {products,productPrices,productStock,warehouses} from '../../src/modules/catalog/schema.ts';
import {webStoreOrders} from '../../src/modules/sales/pos-schema.ts';
import {stockMoves} from '../../src/modules/inventory/schema.ts';
import {sapoHealthMonitorState} from '../../src/modules/integrations/schema.ts';
import {createAppRouter} from '../../src/app/router.ts';
import {tasks} from '../../src/modules/tasks/schema.ts';
import {packingSlips} from '../../src/modules/sales/schema.ts';
import {RULES} from '../../src/modules/tasks/api/auto-tasks.ts';
const secret='test-sync-job-token-at-least-32-characters';
async function tick(f:{router:ReturnType<typeof createAppRouter>;env:object}) {
 const r=await f.router.handle(new Request('https://trial.test/api/staff/integrations/sync-jobs/tick',{method:'POST',headers:{authorization:'Bearer '+secret,'content-type':'application/json'},body:'{}'}),f.env as never);
 assert.equal(r.status,200);return await r.json();
}

test('Sapo request queues only; bounded pages checkpoint, survive a router restart and resume failed reads',async()=>{
 const f=await setup();Object.assign(f.env,{durableSyncJobs:true,sapoSyncToken:secret});
 await f.db.insert(warehouses).values({id:'sync-wh',name:'Kho đồng bộ thử'});
 const all=Array.from({length:101},(_,i)=>({id:10000+i,name:'Sản phẩm thử '+i,variants:[{sku:'SYNC'+i,price:100000,inventories:[{location_name:'Kho đồng bộ thử',available:i}]}]}));
 const requests:URL[]=[];let failPage2=false;
 f.env.sapoFetch=(async url=>{const u=new URL(String(url));requests.push(u);const key=u.pathname.split('/').pop()!.replace('.json',''),page=Number(u.searchParams.get('page')||1),size=Number(u.searchParams.get('limit')||250);
  if(key==='products'&&page===2&&failPage2)return new Response('',{status:503});
  const rows=key==='products'?all:key==='locations'?[{id:1,name:'Kho đồng bộ thử'}]:[];
  return Response.json({[key]:rows.slice((page-1)*size,page*size),metadata:{total:rows.length}});
 }) as typeof fetch;
 assert.equal((await f.call('/admin/sapo-session',f.mgr,'POST',{cookie:'_admin_session_id=test'})).status,200);
 requests.length=0;
 const queued=await f.call('/admin/sapo-pull',f.mgr,'POST',{});assert.equal(queued.data.queued,true);assert.equal(requests.length,0,'user request performs no remote sync');
 // Staff, customers, then products page 1.
 for(let i=0;i<3;i++)await tick(f);
 const [partial]=await f.db.select().from(sapoHealthMonitorState).where(eq(sapoHealthMonitorState.id,'pull'));
 assert.equal(JSON.parse(partial!.data).cursors.products.offset,50);assert.equal(JSON.parse(partial!.data).cursors.products.page,1,'legacy rollback overlaps the partial page rather than skipping rows');
 assert.equal((await f.db.select().from(products).where(like(products.sku,'SYNC%'))).length,50);
 const before=(await f.db.select().from(syncJobs).where(eq(syncJobs.key,'sapo')))[0]!.state;
 await f.call('/admin/sapo-pull',f.mgr,'POST',{});assert.equal((await f.db.select().from(syncJobs).where(eq(syncJobs.key,'sapo')))[0]!.state,before);
 failPage2=true;assert.equal((await tick(f)).failed,true);
 assert.equal((await f.db.select().from(products).where(like(products.sku,'SYNC%'))).length,50);
 failPage2=false;await f.db.update(syncJobs).set({availableAt:'1970-01-01T00:00:00.000Z'}).where(eq(syncJobs.key,'sapo'));
 f.router=createAppRouter(); // Persisted state, not module memory, drives continuation.
 for(let i=0;i<25;i++){await tick(f);if((await f.db.select().from(syncJobs).where(eq(syncJobs.key,'sapo')))[0]!.status==='completed')break;}
 const [job]=await f.db.select().from(syncJobs).where(eq(syncJobs.key,'sapo'));assert.equal(job!.status,'completed');
 assert.equal((await f.db.select().from(products).where(like(products.sku,'SYNC%'))).length,101);
 assert.equal((await f.db.select().from(productStock).where(eq(productStock.warehouseId,'sync-wh'))).length,101);
 assert(requests.filter(u=>u.pathname.endsWith('/products.json')).every(u=>u.searchParams.get('limit')==='50'));
 const status=await f.call('/admin/sapo-sync',f.mgr);assert.equal(status.data.pull.job.status,'completed');
 await f.call('/admin/sapo-pull',f.mgr,'POST',{});await f.db.update(syncJobs).set({state:JSON.stringify({phase:3,phaseSteps:29})}).where(eq(syncJobs.key,'sapo'));
 await f.db.update(sapoHealthMonitorState).set({data:JSON.stringify({cursors:{stock:{page:1,offset:0}}})}).where(eq(sapoHealthMonitorState.id,'pull'));
 await tick(f);assert.equal(JSON.parse((await f.db.select().from(syncJobs).where(eq(syncJobs.key,'sapo')))[0]!.state).phase,4,'stock quota yields to the next kind without losing its rotating cursor');
 assert.equal(JSON.parse((await f.db.select().from(sapoHealthMonitorState).where(eq(sapoHealthMonitorState.id,'pull')))[0]!.data).cursors.stock.offset,50);
});

test('GHN queue checks one waybill per step, advances unchanged/failed rows and preserves stock idempotency',async()=>{
 const f=await setup();Object.assign(f.env,{durableSyncJobs:true,sapoSyncToken:secret,ghnToken:'test-only',ghnMlToken:'test-only',ghnMlShopId:'885001'});
 await f.db.insert(webStoreOrders).values(['a','b','c'].map((id,i)=>({id:'queued-web-'+id,source:i===2?'minhlong':'lock',externalId:id,orderNo:id,registerId:f.registerId,status:'processing',ghnOrderCode:id,ghnStatus:'ready_to_pick',lines:JSON.stringify([{sku:'00123',quantity:2}]),orderedAt:'2026-11-02T00:00:00Z',updatedAt:'2026-11-02T00:00:00Z'})));
 const calls:string[]=[];f.env.ghnFetch=(async(_url,init)=>{const code=JSON.parse(String(init?.body)).order_code;calls.push(code);return code==='b'?new Response('',{status:502}):Response.json({data:{status:code==='c'?'delivered':'ready_to_pick'}});}) as typeof fetch;
 assert.equal((await f.call('/pos/ghn/sync',f.emp,'POST',{})).data.queued,true);assert.equal(calls.length,0);
 for(let i=0;i<20;i++){const previous=calls.length;await tick(f);assert(calls.length-previous<=2,'one read plus at most one retry');if((await f.db.select().from(syncJobs).where(eq(syncJobs.key,'ghn')))[0]!.status==='completed')break;}
 assert.deepEqual(calls,['a','b','b','c']);
 const [job]=await f.db.select().from(syncJobs).where(eq(syncJobs.key,'ghn'));assert.equal(job!.status,'completed');assert.equal(JSON.parse(job!.result).checked,3);
 assert.equal((await f.db.select().from(stockMoves).where(eq(stockMoves.refType,'web_order'))).length,1);
 await f.call('/pos/ghn/sync',f.emp,'POST',{});for(let i=0;i<20;i++){await tick(f);if((await f.db.select().from(syncJobs).where(eq(syncJobs.key,'ghn')))[0]!.status==='completed')break;}
 assert.equal((await f.db.select().from(stockMoves).where(eq(stockMoves.refType,'web_order'))).length,1);
 const bad=await f.call('/integrations/sync-jobs/tick',f.emp,'POST',{});assert.equal(bad.status,401);
 assert.equal((await f.call('/admin/sync-jobs',f.emp)).status,403);
});

test('warehouse cursor scopes closure to one document; a failed rule never closes open tasks',async()=>{
 const f=await sourceAssignmentFixture();Object.assign(f.env,{durableSyncJobs:true,sapoSyncToken:secret});
 await f.db.insert(packingSlips).values({id:'source-slip-z',slipNo:'DG_QUEUED',orderId:'liq-order',status:'sent',source:'warehouse',createdBy:'emp',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()});
 const machine={router:createAppRouter(),env:f.env};
 const r=await machine.router.handle(new Request('https://trial.test/api/staff/integrations/warehouse-work/reconcile',{method:'POST',headers:{authorization:'Bearer '+secret,'content-type':'application/json'},body:'{}'}),f.env);assert.equal(r.status,200);
 await f.db.update(packingSlips).set({status:'cancelled'}).where(eq(packingSlips.id,'source-slip'));
 const original=RULES.packingSlips!;RULES.packingSlips=async()=>{throw Error('failed read');};
 try{assert.equal((await tick(machine)).failed,true);assert.notEqual((await f.db.select().from(tasks).where(eq(tasks.id,f.id)))[0]!.status,'done');}finally{RULES.packingSlips=original;}
 await f.db.update(syncJobs).set({availableAt:'1970-01-01T00:00:00.000Z'}).where(eq(syncJobs.key,'warehouse'));
 await tick(machine);assert.equal((await f.db.select().from(tasks).where(eq(tasks.id,f.id)))[0]!.status,'done');
 await tick(machine);assert.equal((await f.db.select().from(tasks).where(eq(tasks.autoKey,'slip:source-slip-z'))).length,1);
});
