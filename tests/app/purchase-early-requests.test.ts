import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import { setupEarly } from '../helpers/purchase-early-fixture.ts';
import { purchaseEarlyRequests, purchaseEarlyRequestLines, purchaseEarlyRequestAllocations } from '../../src/modules/suppliers/early-request-schema.ts';
import { incomingShipmentLines } from '../../src/modules/suppliers/schema.ts';

test('gửi nhiều mã: phân bổ ngày sớm, pending, cùng key chỉ một lần, audit đầy đủ, không tạo task/phiếu nhận/chi',async()=>{
  const {db,call,cookies:c,client}=await setupEarly();
  const body={clientKey:'test-early-001',pickupDate:'2026-10-22',lines:[{sku:'031106000',quantity:17000},{sku:'01654020803',quantity:5}]};
  const counts=async()=> (await client.query<{tasks:number;receipts:number;payments:number}>(`select (select count(*)::int from tasks) as tasks,(select count(*)::int from supplier_receipts) as receipts,(select count(*)::int from supplier_payments) as payments`)).rows[0];
  const before=await counts();
  const first=await call('/purchase-early-requests',c.mgr,'POST',body);assert.equal(first.status,201,JSON.stringify(first.data));
  assert.equal(first.data.request.status,'draft');assert.equal(first.data.request.lines.length,2);
  const line=first.data.request.lines.find((l:any)=>l.sku==='031106000');
  assert.deepEqual(line.allocations.map((a:any)=>[a.ticketNumber,a.quantity]).sort(),[['PO-a1',8000],['PO-a2',7000],['PO-b1',2000]]);
  assert.equal((await db.select().from(purchaseEarlyRequestAllocations)).every(a=>a.status==='pending'&&!a.respondedBy),true);
  assert.equal((await call('/supplier-portal/early-requests',c.ncc)).data.requests.length,0,'nháp chưa hiện cho NCC');
  assert.equal((await call('/purchase-early-requests/'+first.data.id+'/submit',c.mgr,'POST',{revision:first.data.request.revision})).data.request.status,'pending');
  assert.equal((await call('/purchase-early-requests/'+first.data.id+'/submit',c.mgr,'POST',{revision:first.data.request.revision})).data.replayed,true);
  const repeat=await call('/purchase-early-requests',c.mgr,'POST',body);assert.equal(repeat.status,200);assert.equal(repeat.data.id,first.data.id);assert.equal(repeat.data.replayed,true);
  assert.equal((await db.select().from(purchaseEarlyRequests)).length,1);
  assert.equal((await call('/purchase-early-requests',c.mgr,'POST',{...body,lines:[{sku:'031106000',quantity:1}]})).status,409);
  const audit=await client.query<{data:string;actor_id:string}>("select data,actor_id from audit_logs where action='early-request-send'");
  assert.equal(audit.rows.length,1);assert.equal(audit.rows[0]!.actor_id,'mgr');assert.equal(JSON.parse(audit.rows[0]!.data).lines.length,2);
  assert.deepEqual(await counts(),before,'gửi không tự sinh việc nhận/trả NCC, không ghi nhận hàng hay chi tiền');
  assert.equal((await db.select().from(incomingShipmentLines).where(eq(incomingShipmentLines.id,'line-a1')))[0]!.quantity,8000);
  // Replay remains valid even after source quantities change; does not create another request.
  await db.update(incomingShipmentLines).set({quantity:1}).where(eq(incomingShipmentLines.id,'line-a1'));
  assert.equal((await call('/purchase-early-requests',c.mgr,'POST',body)).data.id,first.data.id);
  const admin=await call('/purchase-early-requests',c.sa,'POST',{clientKey:'test-admin-001',lines:[{sku:'01654020803',quantity:1}]});assert.equal(admin.status,201);
  const scope=await call('/purchase-early-requests',c.mgr,'POST',{clientKey:'test-scope-001',scope:{supplierId:'b'},lines:[{sku:'031106000',quantity:5000}]});assert.equal(scope.status,201);
  assert.equal(scope.data.request.lines[0].allocations.every((a:any)=>a.supplierId==='b'),true);
});

test('kiểm quyền và validate server, rollback cả yêu cầu nếu một mã vượt, đọc lại lượng mới',async()=>{
  const {db,call,cookies:c}=await setupEarly(),valid={clientKey:'validate-001',lines:[{sku:'031106000',quantity:100}]};
  for(const id of ['emp','kho','kt','ncc']) assert.equal((await call('/purchase-early-requests',c[id],'POST',valid)).status,403,id);
  assert.equal((await call('/purchase-early-requests','','POST',valid)).status,401);
  for(const lines of [[],[{sku:'031106000',quantity:0}],[{sku:'031106000',quantity:-1}],[{sku:'031106000',quantity:1.5}],[{sku:'031106000',quantity:'1'}],[{sku:'031106000',quantity:1},{sku:'031106000',quantity:2}]]) {
    assert.equal((await call('/purchase-early-requests',c.mgr,'POST',{...valid,lines})).status,400);
  }
  const exceed=await call('/purchase-early-requests',c.mgr,'POST',{...valid,lines:[{sku:'01654020803',quantity:2},{sku:'031106000',quantity:20001}]});
  assert.equal(exceed.status,409);assert.equal((await db.select().from(purchaseEarlyRequests)).length,0);assert.equal((await db.select().from(purchaseEarlyRequestLines)).length,0);
  await db.update(incomingShipmentLines).set({quantity:1}).where(eq(incomingShipmentLines.id,'line-excel'));
  assert.equal((await call('/purchase-early-requests',c.mgr,'POST',{...valid,lines:[{sku:'01654020803',quantity:2}]})).status,409);
  const filtered=await call('/purchase-early-requests',c.mgr,'POST',{...valid,scope:{supplierId:'b'},lines:[{sku:'031106000',quantity:5001}]});assert.equal(filtered.status,409);
  for(const id of ['mgr','sa','emp','kho','kt']) assert.equal((await call('/purchase-early-requests',c[id])).status,200);
  assert.equal((await call('/purchase-early-requests',c.ncc)).status,403);
  await db.execute((await import('drizzle-orm')).sql`delete from staff_position_permissions where position_id='sale' and permission='page.purchases'`);
  assert.equal((await call('/purchase-incoming',c.emp)).status,403,'thu hồi quyền trang áp dụng cả API tổng hợp mới');
  assert.equal((await call('/purchase-early-requests',c.emp)).status,403);
});

test('cổng NCC chỉ thấy lượng của mình; phản hồi từng mã, không duyệt thay, lặp an toàn và audit',async()=>{
  const {call,cookies:c,client}=await setupEarly();
  const created=await call('/purchase-early-requests',c.mgr,'POST',{clientKey:'portal-001',pickupDate:'2026-10-22',lines:[{sku:'031106000',quantity:17000},{sku:'01654020803',quantity:5}]});assert.equal(created.status,201);
  created.data.request=(await call('/purchase-early-requests/'+created.data.id+'/submit',c.mgr,'POST',{revision:1})).data.request;
  const line=created.data.request.lines.find((l:any)=>l.sku==='031106000');
  const a=await call('/supplier-portal/early-requests',c.ncc),b=await call('/supplier-portal/early-requests',c.ncc2);
  assert.equal(a.data.requests[0].lines.length,1);assert.equal(a.data.requests[0].lines[0].quantity,15000);assert.equal(b.data.requests[0].lines[0].allocations.every((x:any)=>x.supplierId==='b'),true);
  assert.doesNotMatch(JSON.stringify(a.data),/NCC b|PO-b1|PO-excel|17000/);
  assert.equal((await call('/supplier-portal/early-requests',c.unmapped)).status,403);
  assert.equal((await call('/supplier-portal/early-requests',c.sa)).status,403);
  const path='/supplier-portal/early-requests/'+line.id+'/respond';
  for(const id of ['mgr','sa','emp','kho','kt']) assert.equal((await call(path,c[id],'POST',{status:'accepted'})).status,403,id);
  assert.equal((await call(path,c.ncc,'POST',{status:'pending'})).status,400);
  const accept=await call(path,c.ncc,'POST',{status:'accepted',note:'Có thể giao'});assert.equal(accept.status,200);
  assert.equal((await call(path,c.ncc,'POST',{status:'accepted',note:'Có thể giao'})).data.replayed,true);
  assert.equal((await call(path,c.ncc,'POST',{status:'rejected'})).status,409);
  assert.equal((await call(path,c.ncc2,'POST',{status:'rejected',note:'Chưa có hàng'})).status,200);
  const excel=created.data.request.lines.find((l:any)=>l.sku==='01654020803');
  assert.equal((await call('/supplier-portal/early-requests/'+excel.id+'/respond',c.ncc,'POST',{status:'accepted'})).status,404);
  const view=await call('/purchase-early-requests?id='+created.data.id,c.mgr);
  assert.equal(view.data.requests[0].lines.find((l:any)=>l.sku==='031106000').status,'mixed');
  const audit=await client.query<{n:number}>("select count(*)::int as n from audit_logs where action='early-request-respond'");assert.equal(audit.rows[0]!.n,2);
});

test('phiếu nháp: sửa ngày lấy/SL, revision, nháp không lộ NCC, gửi đọc lại số và khóa sửa sau gửi',async()=>{
  const {db,call,cookies:c}=await setupEarly();
  const body={clientKey:'draft-test-001',lines:[{sku:'031106000',quantity:1000}]};
  const created=await call('/purchase-early-requests',c.mgr,'POST',body),id=created.data.id,path='/purchase-early-requests/'+id;
  assert.equal(created.status,201);assert.equal(created.data.request.status,'draft');
  const draftLine=created.data.request.lines[0].id;
  assert.equal((await call('/supplier-portal/early-requests?id='+id,c.ncc)).status,404);
  assert.equal((await call('/supplier-portal/early-requests/'+draftLine+'/respond',c.ncc,'POST',{status:'accepted'})).status,404);
  assert.equal((await call(path+'/submit',c.mgr,'POST',{revision:1})).status,400,'phải nhập ngày lấy');
  for(const actor of ['emp','kho','kt','ncc']) assert.equal((await call(path,c[actor],'PUT',{revision:1,lines:body.lines,pickupDate:'2026-11-01'})).status,403,actor);
  const changed=await call(path,c.sa,'PUT',{revision:1,lines:[{sku:'031106000',quantity:3000}],pickupDate:'2026-11-01'});
  assert.equal(changed.status,200);assert.equal(changed.data.request.revision,2);assert.equal(changed.data.request.pickupDate,'2026-11-01');assert.equal(changed.data.request.lines[0].quantity,3000);
  assert.equal((await call(path,c.mgr,'PUT',{revision:1,lines:body.lines,pickupDate:'2026-11-02'})).status,409);
  assert.equal((await call(path+'/submit',c.mgr,'POST',{revision:1})).status,409);
  const sent=await call(path+'/submit',c.mgr,'POST',{revision:2});assert.equal(sent.status,200);assert.equal(sent.data.request.requestStatus,'submitted');
  assert.equal((await call(path,c.sa,'PUT',{revision:3,lines:body.lines,pickupDate:'2026-11-02'})).status,409);
  assert.equal((await call('/supplier-portal/early-requests?id='+id,c.ncc)).data.requests[0].pickupDate,'2026-11-01');
  const stale=await call('/purchase-early-requests',c.mgr,'POST',{clientKey:'draft-stale-001',pickupDate:'2026-11-01',lines:[{sku:'01654020803',quantity:10}]});
  await db.update(incomingShipmentLines).set({quantity:1}).where(eq(incomingShipmentLines.id,'line-excel'));
  assert.equal((await call('/purchase-early-requests/'+stale.data.id+'/submit',c.mgr,'POST',{revision:1})).status,409);
  assert.equal((await call('/purchase-early-requests?id='+stale.data.id,c.mgr)).data.requests[0].status,'draft');
});

test('hai lần bấm đồng thời dùng cùng key chỉ lưu một phiếu nháp',async()=>{
  const {db,call,cookies:c}=await setupEarly();
  const body={clientKey:'parallel-draft-001',lines:[{sku:'031106000',quantity:100}]};
  const results=await Promise.all([call('/purchase-early-requests',c.mgr,'POST',body),call('/purchase-early-requests',c.mgr,'POST',body)]);
  assert.deepEqual(results.map(r=>r.status).sort(),[200,201]);assert.equal(results[0]!.data.id,results[1]!.data.id);
  assert.equal((await db.select().from(purchaseEarlyRequests)).length,1);assert.equal((await db.select().from(purchaseEarlyRequestLines)).length,1);
});
