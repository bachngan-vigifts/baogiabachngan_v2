import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import { setupEarly } from '../helpers/purchase-early-fixture.ts';
import { purchaseEarlyRequests, purchaseEarlyRequestLines, purchaseEarlyRequestAllocations } from '../../src/modules/suppliers/early-request-schema.ts';
import { incomingShipmentLines,incomingShipments } from '../../src/modules/suppliers/schema.ts';

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

test('kiểm quyền và validate server; nháp giữ dòng thiếu nguồn nhưng chưa cho gửi NCC',async()=>{
  const {db,call,cookies:c}=await setupEarly(),valid={clientKey:'validate-001',allowUnresolvedSources:true,lines:[{sku:'031106000',quantity:100}]};
  for(const id of ['emp','kho','kt','ncc']) assert.equal((await call('/purchase-early-requests',c[id],'POST',valid)).status,403,id);
  assert.equal((await call('/purchase-early-requests','','POST',valid)).status,401);
  for(const lines of [[],[{sku:'031106000',quantity:0}],[{sku:'031106000',quantity:-1}],[{sku:'031106000',quantity:1.5}],[{sku:'031106000',quantity:'1'}],[{sku:'031106000',quantity:1},{sku:'031106000',quantity:2}]]) {
    assert.equal((await call('/purchase-early-requests',c.mgr,'POST',{...valid,lines})).status,400);
  }
  const exceed=await call('/purchase-early-requests',c.mgr,'POST',{...valid,clientKey:'validate-exceed-001',lines:[{sku:'01654020803',quantity:2},{sku:'031106000',quantity:20001}]});
  assert.equal(exceed.status,201);assert.equal(exceed.data.request.status,'draft');
  assert.equal(exceed.data.request.lines.find((l:any)=>l.sku==='031106000').status,'unresolved','nháp giữ dòng chưa đủ đơn mua để người dùng xử lý sau');
  assert.equal((await call('/purchase-early-requests/'+exceed.data.id+'/submit',c.mgr,'POST',{revision:1})).status,400,'chưa có ngày lấy vẫn không được gửi NCC');
  await db.update(incomingShipmentLines).set({quantity:1}).where(eq(incomingShipmentLines.id,'line-excel'));
  const noLongerAvailable=await call('/purchase-early-requests',c.mgr,'POST',{...valid,lines:[{sku:'01654020803',quantity:2}]});
  assert.equal(noLongerAvailable.status,201);assert.equal(noLongerAvailable.data.request.lines[0].status,'unresolved');
  const filtered=await call('/purchase-early-requests',c.mgr,'POST',{...valid,clientKey:'validate-filter-001',scope:{supplierId:'b'},lines:[{sku:'031106000',quantity:5001}]});assert.equal(filtered.status,201);
  for(const id of ['mgr','sa','kt']) assert.equal((await call('/purchase-early-requests',c[id])).status,200);
  for(const id of ['emp','kho'])assert.equal((await call('/purchase-early-requests',c[id])).status,403);
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

test('lịch nhận: phiếu xin mới trên cùng, lọc loại/SKU/NCC trước phân trang; Manager xác nhận đúng phần NCC và audit riêng',async()=>{
  const {db,call,cookies:c,client}=await setupEarly();
  const old=await call('/purchase-early-requests',c.mgr,'POST',{clientKey:'calendar-old',pickupDate:'2026-10-24',lines:[{sku:'031106000',quantity:100}]});
  const newer=await call('/purchase-early-requests',c.mgr,'POST',{clientKey:'calendar-new',pickupDate:'2026-10-23',lines:[{sku:'031106000',quantity:17000},{sku:'01654020803',quantity:5}]});
  assert.equal(newer.status,201);newer.data.request=(await call('/purchase-early-requests/'+newer.data.id+'/submit',c.mgr,'POST',{revision:1})).data.request;
  await db.update(purchaseEarlyRequests).set({createdAt:'2026-10-25T10:00:00.000Z'}).where(eq(purchaseEarlyRequests.id,newer.data.id));
  await db.update(purchaseEarlyRequests).set({createdAt:'2026-10-24T10:00:00.000Z'}).where(eq(purchaseEarlyRequests.id,old.data.id));
  const early=await call('/purchase-receiving-calendar?type=early&sku=031106000',c.mgr);
  assert.equal(early.status,200);assert.equal((await call('/navigation-counts',c.mgr)).data.receiving,(await call('/purchase-receiving-calendar',c.mgr)).data.orderCount);assert.equal(early.data.canConfirmEarly,true);assert.equal(early.data.total,3);
  assert.equal(early.data.rows[0].requestId,newer.data.id);assert.equal(early.data.rows[1].requestId,newer.data.id);
  assert.equal(early.data.rows.every((r:any)=>r.lines.every((l:any)=>l.sku==='031106000')),true);
  assert.equal(early.data.rows.find((r:any)=>r.supplierId==='a'&&r.requestId===newer.data.id).lines[0].requestedQty,15000);
  const one=await call('/purchase-receiving-calendar?type=early&sku=031106000&supplierId=b',c.mgr);
  assert.equal(one.data.total,1);assert.equal(one.data.rows[0].lines[0].requestedQty,2000);
  const purchases=await call('/purchase-receiving-calendar?type=purchase&sku=031106000',c.kt);
  assert.equal(purchases.data.rows.every((r:any)=>r.type==='purchase'),true);assert.equal(purchases.data.canConfirmEarly,false);
  assert.equal((await call('/purchase-receiving-calendar?type=wrong',c.mgr)).status,400);
  assert.equal((await call('/purchase-receiving-calendar?type=early&sku=not-found',c.mgr)).data.total,0);
  const line=newer.data.request.lines.find((l:any)=>l.sku==='031106000'),path='/purchase-early-request-lines/'+line.id+'/manager-confirm';
  for(const who of ['sa','emp','kho','kt','ncc'])assert.equal((await call(path,c[who],'POST',{supplierId:'a'})).status,403,who);
  assert.equal((await call(path,c.mgr,'POST',{supplierId:'missing'})).status,404);
  const counts=async()=>(await client.query(`select (select count(*)::int from stock_moves) as moves,(select count(*)::int from stock_balances) as balances,(select count(*)::int from supplier_receipts) as receipts,(select count(*)::int from supplier_payments) as payments`)).rows[0];
  const before=await counts();
  assert.equal((await call(path,c.mgr,'POST',{supplierId:'a'})).status,200);
  assert.equal((await call(path,c.mgr,'POST',{supplierId:'a'})).data.replayed,true);
  const allocations=await db.select().from(purchaseEarlyRequestAllocations).where(eq(purchaseEarlyRequestAllocations.requestLineId,line.id));
  assert.equal(allocations.filter(a=>a.supplierId==='a').every(a=>a.status==='accepted'&&a.respondedBy==='mgr'),true);
  assert.equal(allocations.filter(a=>a.supplierId==='b').every(a=>a.status==='pending'),true);
  assert.deepEqual(await counts(),before,'xác nhận NCC không phải nhận hàng, nhập kho hoặc chi tiền');
  assert.equal((await call('/supplier-portal/early-requests/'+line.id+'/respond',c.ncc,'POST',{status:'rejected'})).status,409);
  const audit=await client.query<{actor_id:string;data:string}>("select actor_id,data from audit_logs where action='early-request-manager-confirm'");
  assert.equal(audit.rows.length,1);assert.equal(audit.rows[0]!.actor_id,'mgr');assert.equal(JSON.parse(audit.rows[0]!.data).allocations.reduce((s:number,a:any)=>s+a.quantity,0),15000);
  const draftLine=old.data.request.lines[0].id;
  assert.equal((await call('/purchase-early-request-lines/'+draftLine+'/manager-confirm',c.mgr,'POST',{supplierId:'a'})).status,404);
  const rejected=await call('/purchase-early-requests',c.mgr,'POST',{clientKey:'calendar-reject',pickupDate:'2026-10-23',lines:[{sku:'031106000',quantity:1}]});
  rejected.data.request=(await call('/purchase-early-requests/'+rejected.data.id+'/submit',c.mgr,'POST',{revision:1})).data.request;
  const rejectedLine=rejected.data.request.lines[0].id;
  await call('/supplier-portal/early-requests/'+rejectedLine+'/respond',c.ncc,'POST',{status:'rejected'});
  assert.equal((await call('/purchase-early-request-lines/'+rejectedLine+'/manager-confirm',c.mgr,'POST',{supplierId:'a'})).status,409,'không ghi đè phản hồi đã có');
  // More than 50 headers: calendar totals and later pages cannot inherit earlyRequestList's 50-header cap.
  for(let i=0;i<51;i++){
    const id='cal-page-'+i,lineId='cal-line-'+i;
    await db.insert(purchaseEarlyRequests).values({id,clientKey:id,payloadHash:id,createdBy:'mgr',createdAt:'2026-01-01T00:00:00.000Z',status:'submitted',pickupDate:'2026-10-23'});
    await db.insert(purchaseEarlyRequestLines).values({id:lineId,requestId:id,lineNo:1,sku:'031106000',name:'Hàng',unit:'cái',quantity:1});
    await db.insert(purchaseEarlyRequestAllocations).values({id:'cal-alloc-'+i,requestLineId:lineId,purchaseLineId:'line-a1',supplierId:'a',quantity:1});
  }
  const page=await call('/purchase-receiving-calendar?type=early&sku=031106000',c.mgr);
  assert.equal(page.data.total,55);assert.equal(page.data.rows.length,50);
  assert.equal((await call('/purchase-receiving-calendar?type=early&sku=031106000&offset=50',c.mgr)).data.rows.length,5);
});

test('unresolved draft is explicit and idempotent, never submits ambiguous/missing sources or leaks to supplier',async()=>{
 const f=await setupEarly(),body={clientKey:'explicit-unresolved-key',allowUnresolvedSources:true,pickupDate:'2026-10-25',lines:[{sku:'031106000',quantity:5,sourceOrders:[{supplierOrderNo:'NOT-YET-BOUND',quantity:5}]}]};
 const draft=await f.call('/purchase-early-requests',f.cookies.sa,'POST',body);assert.equal(draft.status,201,JSON.stringify(draft.data));assert.equal(draft.data.request.lines[0].status,'unresolved');assert.equal(draft.data.request.lines[0].allocations.length,0);
 assert.equal((await f.call('/purchase-early-requests',f.cookies.sa,'POST',body)).data.id,draft.data.id);
 assert.equal((await f.call('/purchase-early-requests',f.cookies.sa,'POST',{...body,allowUnresolvedSources:false})).status,409,'mode participates in retry fingerprint');
 assert.equal((await f.call('/purchase-early-requests/'+draft.data.id+'/submit',f.cookies.sa,'POST',{revision:draft.data.request.revision,allowUnresolvedSources:true})).status,409,'submit always validates source even if a caller sends the flag');
 assert.equal((await f.call('/supplier-portal/early-requests',f.cookies.ncc)).data.requests.length,0);
 const split=await f.call('/purchase-early-requests',f.cookies.sa,'POST',{...body,clientKey:'unresolved-cannot-split',groupBySupplierOrder:true});assert.equal(split.status,409);assert.equal(split.data.code,'EARLY_UNRESOLVED');
 const update=await f.call('/purchase-early-requests/'+draft.data.id,f.cookies.sa,'PUT',{revision:draft.data.request.revision,allowUnresolvedSources:true,pickupDate:body.pickupDate,lines:[{sku:'031106000',quantity:5,sourceOrders:[{orderNo:'PO-a2',quantity:5}]}]});assert.equal(update.status,200,JSON.stringify(update.data));assert.equal(update.data.request.lines[0].allocations[0].ticketNumber,'PO-a2');assert.equal(update.data.request.scope.unresolvedOrders,undefined);
 assert.equal((await f.call('/purchase-early-requests/'+draft.data.id+'/submit',f.cookies.sa,'POST',{revision:update.data.request.revision})).status,200);
 for(const value of ['true',1,null])assert.equal((await f.call('/purchase-early-requests',f.cookies.mgr,'POST',{...body,clientKey:crypto.randomUUID(),allowUnresolvedSources:value})).status,400);
 for(const table of ['stock_moves','supplier_receipts'])assert.equal((await f.client.query<{n:number}>('select count(*)::int n from '+table)).rows[0]!.n,0);
});


test('order options preserve exact matching, supplier scope and write permissions',async()=>{
 const f=await setupEarly();await f.db.update(incomingShipments).set({supplierInternalOrderNumber:'000123'}).where(eq(incomingShipments.id,'a2'));await f.db.update(incomingShipments).set({supplierInternalOrderNumber:'0001234'}).where(eq(incomingShipments.id,'b1'));
 const path='/purchase-early-requests/order-options?sku=031106000&supplierOrderNo=000123';
 for(const id of ['emp','kho','kt','ncc'])assert.equal((await f.call(path,f.cookies[id])).status,403,id);
 const result=await f.call(path,f.cookies.sa);assert.equal(result.status,200);assert.deepEqual(result.data.options.filter((o:any)=>o.exactSupplierOrderNo).map((o:any)=>o.ticketNumber),['PO-a2']);
 const scoped=await f.call(path+'&supplierId=b',f.cookies.mgr);assert.equal(scoped.status,200);assert.ok(scoped.data.options.every((o:any)=>o.supplierId==='b'));assert.ok(scoped.data.options.every((o:any)=>!o.exactSupplierOrderNo));
 assert.equal((await f.call(path+'&supplierId='+ 'x'.repeat(201),f.cookies.mgr)).status,400);
});

test('draft replaces removed SKU with a manual SKU atomically; failed edits preserve the saved draft',async()=>{
 const f=await setupEarly();
 const made=await f.call('/purchase-early-requests',f.cookies.mgr,'POST',{clientKey:'manual-replace-lines',pickupDate:'2026-11-14',scope:{supplierId:'b'},lines:[{sku:'031106000',quantity:2}]});assert.equal(made.status,201);
 const path='/purchase-early-requests/'+made.data.id;
 const update=(lines:any[],revision=1)=>f.call(path,f.cookies.mgr,'PUT',{revision,pickupDate:'2026-11-14',lines});
 for(const lines of [[],[{sku:'MISSING',quantity:1}],[{sku:'01654020803',quantity:11}],[{sku:'01654020803',quantity:0}],[{sku:'01654020803',quantity:1},{sku:'01654020803',quantity:1}],[{sku:'031106000',quantity:1,sourceOrders:[{orderNo:'PO-a1',quantity:1}]}]]){
  assert.ok((await update(lines)).status>=400);
  const saved=(await f.call('/purchase-early-requests?id='+made.data.id,f.cookies.mgr)).data.requests[0];assert.equal(saved.revision,1);assert.equal(saved.lines[0].sku,'031106000');assert.equal(saved.lines[0].quantity,2);
 }
 const options=(await f.call('/purchase-early-requests/order-options?sku=01654020803&supplierId=b',f.cookies.mgr)).data.options;assert.equal(options[0].name,'Hàng 01654020803');
 const edited=await update([{sku:'01654020803',quantity:3}]);assert.equal(edited.status,200,JSON.stringify(edited.data));assert.deepEqual(edited.data.request.lines.map((l:any)=>[l.sku,l.quantity]),[['01654020803',3]]);assert.equal(edited.data.request.lines[0].allocations[0].supplierId,'b');
 assert.equal((await update([{sku:'031106000',quantity:1}])).status,409);
 assert.equal((await f.call(path+'/submit',f.cookies.mgr,'POST',{revision:2})).status,200);
 assert.equal((await update([{sku:'031106000',quantity:1}],3)).status,409);
 assert.equal((await f.client.query<{n:number}>('select count(*)::int n from stock_moves')).rows[0]!.n,0);
});
