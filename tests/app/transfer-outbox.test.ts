import {test} from 'node:test';
import assert from 'node:assert/strict';
import {eq} from 'drizzle-orm';
import {setupWarehouseWork} from '../helpers/warehouse-work-fixture.ts';
import {createAppRouter} from '../../src/app/router.ts';
import type {StaffEnv} from '../../src/modules/staff/api/auth-routes.ts';
import {transferOutbox as jobs,transferIntegrationSettings as settings} from '../../src/modules/inventory/transfer-outbox-schema.ts';
import {stockTransfers,stockTransferLines,stockBalances,stockMoves} from '../../src/modules/inventory/schema.ts';
import {queueTransferReceived,transferCommandKey,dispatchTransferJobs} from '../../src/modules/inventory/api/transfer-outbox.ts';
async function setup(){
 const f=await setupWarehouseWork(),router=createAppRouter(),background:Promise<unknown>[]=[],sent:string[]=[];
 const env:StaffEnv={db:f.db,passwordIterations:1000,transferIntegration:{webhookUrl:'https://n8nthai.moarchvn.com/webhook/crm-stock-transfer-received-v1',webhookToken:'outbound-test-only-token-123456789012345',syncToken:'incoming-test-only-token-123456789012345',destinationOrigin:'https://warehouse.example.test',fetch:async(_url,init)=>{sent.push(String(init?.body));return new Response('{}',{status:202});}}};
 const call=async(path:string,method='GET',body?:object,actor='mgr',sync=false)=>{
  const headers:Record<string,string>={'content-type':'application/json'};
  if(sync)headers.authorization='Bearer '+env.transferIntegration!.syncToken;else{headers.origin='https://trial.test';headers.cookie=f.cookies[actor]||'';}
  const r=await router.handle(new Request('https://trial.test/api/staff'+path,{method,headers,body:body?JSON.stringify(body):undefined}),env);
  return{status:r.status,data:await r.json() as any};
 };
 const drain=async()=>{while(background.length)await Promise.all(background.splice(0));};
 const activate=async()=>{const r=await call('/admin/stock-transfer-integration','PUT',{enabled:true});f.ok(r);return r.data;};
 const shipped=async()=>{const t=await f.create();f.ok(await call(`/stock-transfers/${t.id}/approve`,'POST',{}));return f.ok(await call(`/stock-transfers/${t.id}/ship`,'POST',{}));};
 const receive=(t:any,qty=2)=>call(`/stock-transfers/${t.id}/receive`,'POST',{revision:t.revision,lines:[{sku:'031106000',qty}],note:'Thực nhận, thiếu chờ đối soát'});
 const job=async(id:string)=>(await f.db.select().from(jobs).where(eq(jobs.transferId,id)))[0]!;
 return{...f,env,call,drain,activate,shipped,receive,job,sent};
}
test('receipt commits one durable snapshot; delivery ACK is not success; one atomic creator; result replay does not write stock',async()=>{
 const f=await setup();await f.activate();const t=await f.shipped();assert.equal((await f.db.select().from(jobs)).length,0,'approve/ship never queue');
 f.env.transferIntegration!.fetch=async(_u,i)=>{const [row]=await f.db.select().from(stockTransfers).where(eq(stockTransfers.id,t.id));assert.equal(row!.status,'done','dispatch only after commit');f.sent.push(String(i?.body));return new Response('{}',{status:202});};
 const results=process.env.TEST_PG_URL?await Promise.all([f.receive(t,1),f.receive(t,1)]):[await f.receive(t,1),await f.receive(t,1)];assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);await f.drain();
 let j=await f.job(t.id);assert.equal(j.status,'pending');assert.equal(j.attemptCount,1);assert.equal(f.sent.length,1);
 const p=JSON.parse(j.payload);assert.equal(p.items[0].shipped_qty,2);assert.equal(p.items[0].received_qty,1);assert.equal(p.idempotency_key,transferCommandKey(t.id));
 const balances=await f.db.select().from(stockBalances);assert.equal(balances.find(b=>b.sku==='031106000'&&b.warehouseId==='from')!.qty,98,'shortage not silently returned');assert.equal(balances.find(b=>b.sku==='031106000'&&b.warehouseId==='to')!.qty,101);
 const before=JSON.stringify(await f.db.select().from(stockMoves));
 const body={idempotency_key:j.idempotencyKey,payload_hash:j.payloadHash};
 const claim=()=>f.call('/integrations/stock-transfers/claim','POST',body,'',true);
 const claims=process.env.TEST_PG_URL?await Promise.all([claim(),claim()]):[await claim(),await claim()];
 assert.equal(claims.filter(r=>r.data.granted).length,1);assert.ok(claims.every(r=>r.status===200));
 const token=claims.find(r=>r.data.granted)!.data.claim_token;
 const b={...body,claim_token:token,status:'succeeded',verified:true,destination_system:'test-warehouse',destination_id:'123',destination_no:'TR-123',destination_url:'https://warehouse.example.test/transfers/123'};
 assert.equal((await f.call('/integrations/stock-transfers/result','POST',{...b,claim_token:'wrong'},'',true)).status,409);
 assert.equal((await f.call('/integrations/stock-transfers/result','POST',{...b,destination_url:'https://evil.invalid/123'},'',true)).status,422);
 assert.equal((await f.call('/integrations/stock-transfers/result','POST',b,'',true)).status,200);
 assert.equal((await f.call('/integrations/stock-transfers/result','POST',b,'',true)).status,200);
 j=await f.job(t.id);assert.equal(j.status,'succeeded');assert.equal(j.destinationId,'123');
 const v=f.ok(await f.call('/stock-transfers/'+t.id));assert.equal(v.integration.destination.no,'TR-123');assert.ok(!JSON.stringify(v).includes(token),'no claim token in staff view');
 assert.equal(JSON.stringify(await f.db.select().from(stockMoves)),before);
});
test('activation is explicit, stable, no history backfill; receive zero never creates a destination job',async()=>{
 const f=await setup();const old=await f.shipped();f.ok(await f.receive(old));await f.drain();assert.equal((await f.db.select().from(jobs)).length,0);
 assert.equal((await f.call('/admin/stock-transfer-integration','PUT',{enabled:true},'sa')).status,403);
 f.env.transferIntegration!.webhookUrl='https://example.invalid';assert.equal((await f.call('/admin/stock-transfer-integration','PUT',{enabled:true})).status,503);
 f.env.transferIntegration!.webhookUrl='https://n8nthai.moarchvn.com/webhook/crm-stock-transfer-received-v1';const active=await f.activate();
 const t=await f.shipped();f.ok(await f.receive(t,0));await f.drain();const j=await f.job(t.id);assert.equal(j.status,'succeeded');assert.equal(j.lastError,'ZERO_RECEIVED_NO_DOCUMENT');assert.equal(f.sent.length,0);
 f.ok(await f.call('/admin/stock-transfer-integration','PUT',{enabled:false}));assert.equal((await f.activate()).integration_activated_at,active.integration_activated_at);
 f.ok(await f.call('/stock-transfers/'+old.id));await dispatchTransferJobs(f.env);assert.equal((await f.db.select().from(jobs)).length,1,'old receipt not backfilled');
 const missing=await f.call('/integrations/stock-transfers/claim','POST',{idempotency_key:'not-existing',payload_hash:'a'},'',true);assert.equal(missing.status,404);
 assert.equal((await f.call('/integrations/stock-transfers/claim','POST',{},'mgr')).status,401,'staff cookie not integration authentication');
});
test('HTTP timeout and interrupted dispatch become unknown without undoing receipt or automatic re-creation; hash conflict is permanent',async()=>{
 const f=await setup();await f.activate();f.env.transferIntegration!.fetch=async()=>{throw new Error('network lost');};const t=await f.shipped();f.ok(await f.receive(t));await f.drain();
 let j=await f.job(t.id);assert.equal(j.status,'unknown');assert.equal((await f.db.select().from(stockTransfers).where(eq(stockTransfers.id,t.id)))[0]!.status,'done');
 await f.db.update(jobs).set({nextAttemptAt:'2000-01-01T00:00:00.000Z'}).where(eq(jobs.transferId,t.id));await dispatchTransferJobs(f.env);assert.equal((await f.job(t.id)).attemptCount,1);
 const b={idempotency_key:j.idempotencyKey,payload_hash:j.payloadHash};assert.equal((await f.call('/integrations/stock-transfers/claim','POST',b,'',true)).data.granted,false);
 assert.equal((await f.call('/integrations/stock-transfers/claim','POST',{...b,payload_hash:'different'},'',true)).status,409);j=await f.job(t.id);assert.equal(j.status,'conflict');
 assert.equal((await f.call('/integrations/stock-transfers/claim','POST',b,'',true)).data.granted,false);
 const next=await f.shipped();f.env.transferIntegration=undefined;f.ok(await f.receive(next));await f.drain();
 const stored=await f.job(next.id);await f.db.update(jobs).set({dispatchToken:'interrupted',dispatchUntil:'2000-01-01T00:00:00.000Z'}).where(eq(jobs.transferId,next.id));
 f.env.transferIntegration={webhookUrl:'https://n8nthai.moarchvn.com/webhook/crm-stock-transfer-received-v1',webhookToken:'outbound-test-only-token-123456789012345',syncToken:'incoming-test-only-token-123456789012345',destinationOrigin:'https://warehouse.example.test',fetch:async()=>{throw new Error('must not dispatch expired lease');}};
 await dispatchTransferJobs(f.env);assert.equal((await f.job(next.id)).status,'unknown');assert.equal((await f.job(next.id)).payload,stored.payload);
});
test('outbox insertion and receipt are atomic; pre-activation events cannot be queued',async()=>{
 const f=await setup();await f.activate();const t=await f.shipped();const before=JSON.stringify(await f.db.select().from(stockMoves));
 await f.client.exec("CREATE FUNCTION reject_transfer_job() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'simulate outbox disk failure'; END $$; CREATE TRIGGER reject_transfer_job BEFORE INSERT ON stock_transfer_outbox FOR EACH ROW EXECUTE FUNCTION reject_transfer_job();");
 assert.equal((await f.receive(t)).status,500);await f.drain();assert.equal((await f.db.select().from(stockTransfers).where(eq(stockTransfers.id,t.id)))[0]!.status,'shipped');assert.equal(JSON.stringify(await f.db.select().from(stockMoves)),before);
 assert.ok((await f.db.select().from(stockTransferLines).where(eq(stockTransferLines.transferId,t.id))).every(l=>l.receivedQty===null));
 await f.client.exec('DROP TRIGGER reject_transfer_job ON stock_transfer_outbox; DROP FUNCTION reject_transfer_job();');
 const [row]=await f.db.select().from(stockTransfers).where(eq(stockTransfers.id,t.id));const lines=await f.db.select().from(stockTransferLines).where(eq(stockTransferLines.transferId,t.id));
 await f.db.transaction(tx=>queueTransferReceived(tx,row!,lines.map(l=>({...l,receivedQty:1})),'mgr','2000-01-01T00:00:00.000Z','old'));
 assert.equal((await f.db.select().from(jobs)).length,0);f.ok(await f.receive(t));await f.drain();assert.equal((await f.db.select().from(jobs)).length,1);
});
test('callback can finish before HTTP ACK; a lost result remains reconcilable with original claim and never changes inventory',async()=>{
 const f=await setup();await f.activate();const t=await f.shipped();let resultBody:any;
 f.env.transferIntegration!.fetch=async(_u,init)=>{
  const p=JSON.parse(String(init?.body)),j=await f.job(p.transfer_id);
  const claim=f.ok(await f.call('/integrations/stock-transfers/claim','POST',{idempotency_key:p.idempotency_key,payload_hash:j.payloadHash},'',true));
  resultBody={idempotency_key:p.idempotency_key,payload_hash:j.payloadHash,claim_token:claim.claim_token,status:'unknown'};
  f.ok(await f.call('/integrations/stock-transfers/result','POST',resultBody,'',true));
  return new Response('{}',{status:202});
 };
 f.ok(await f.receive(t));await f.drain();assert.equal((await f.job(t.id)).status,'unknown','HTTP ACK cannot overwrite worker result');
 const before=JSON.stringify(await f.db.select().from(stockMoves));
 f.ok(await f.call('/integrations/stock-transfers/result','POST',{...resultBody,status:'succeeded',verified:true,destination_system:'test-warehouse',destination_id:'existing-1',destination_no:'TR-existing',destination_url:'https://warehouse.example.test/transfers/existing-1'},'',true));
 assert.equal((await f.job(t.id)).status,'succeeded');assert.equal(JSON.stringify(await f.db.select().from(stockMoves)),before);
});
test('429 defers transport retries with same snapshot; migration preserves RLS and rejects invalid shipped quantities',async()=>{
 const f=await setup();await f.activate();const t=await f.shipped();f.env.transferIntegration!.fetch=async()=>new Response('{}',{status:429});
 f.ok(await f.receive(t));await f.drain();const j=await f.job(t.id);assert.equal(j.status,'pending');assert.equal(j.lastError,'N8N_HTTP_429');
 await dispatchTransferJobs(f.env);assert.equal((await f.job(t.id)).attemptCount,1);
 const rls=await f.client.query<{relrowsecurity:boolean}>('select relrowsecurity from pg_class where relname in (\'stock_transfer_outbox\',\'stock_transfer_integration_settings\')');assert.equal(rls.rows.length,2);assert.ok(rls.rows.every(r=>r.relrowsecurity));
 await assert.rejects(f.db.update(stockTransferLines).set({shippedQty:1}).where(eq(stockTransferLines.transferId,t.id)),(e:any)=>String(e.cause?.constraint_name||e.cause?.constraint||e.cause?.message||e.message).includes('chk_stock_transfer_lines_shipped'));
 await f.db.update(jobs).set({nextAttemptAt:'2000-01-01T00:00:00.000Z'}).where(eq(jobs.transferId,t.id));
 f.env.transferIntegration!.fetch=async(_u,init)=>{assert.equal(String(init?.body),j.payload);return new Response('{}',{status:202});};await dispatchTransferJobs(f.env);
 assert.equal((await f.job(t.id)).attemptCount,2);assert.equal((await f.job(t.id)).payloadHash,j.payloadHash);
});
