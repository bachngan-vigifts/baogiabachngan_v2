import {createNotificationScope} from '../../src/app/notification-recipient-scope.ts';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {setupEarly} from '../helpers/purchase-early-fixture.ts';

test('Nhân viên bán hàng không được mở danh sách hoặc đếm đơn mua kể cả còn page.purchases cũ',async()=>{
 const f=await setupEarly();
 const r=await f.call('/purchase-orders',f.cookies.emp);
 assert.equal(r.status,403,'quyền page cũ không vượt trần chức vụ');
 for(const path of ['/purchase-options','/purchase-incoming','/purchase-receiving-calendar','/supplier-payables','/purchase-early-requests'])assert.equal((await f.call(path,f.cookies.emp)).status,403,path);
});

import {eq} from 'drizzle-orm';
import {suppliers,incomingShipments,incomingShipmentLines,supplierReceipts} from '../../src/modules/suppliers/schema.ts';
import {warehouses,products} from '../../src/modules/catalog/schema.ts';
import {warehouseSellers} from '../../src/modules/inventory/schema.ts';
import {postMoves} from '../../src/modules/inventory/api/ledger.ts';
import {auditLogs} from '../../src/core/db/schema.ts';
import {employees} from '../../src/modules/staff/schema.ts';

test('Manager/accounting thấy mọi đơn; Sale Admin chỉ ID có hãng; đổi tên không cấp quyền và gỡ hãng thu hồi ngay',async()=>{
 const f=await setupEarly();await f.db.update(suppliers).set({saleAdminBrand:'minhlong'}).where(eq(suppliers.id,'a'));await f.db.update(suppliers).set({name:'Minh Long giả',saleAdminBrand:null}).where(eq(suppliers.id,'b'));
 for(const cookie of [f.cookies.mgr,f.cookies.kt])assert.equal((await f.call('/purchase-orders/b1',cookie)).status,200);
 assert.equal((await f.call('/purchase-orders/a1',f.cookies.sa)).status,200);assert.equal((await f.call('/purchase-orders/b1',f.cookies.sa)).status,404);
 const list=await f.call('/purchase-orders',f.cookies.sa);assert.equal(list.status,200);assert.ok(list.data.orders.every((p:any)=>p.supplierId==='a'));
 assert.equal((await f.call('/purchase-orders?supplierId=b',f.cookies.sa)).status,404);
 assert.ok((await f.call('/purchase-options',f.cookies.sa)).data.suppliers.every((s:any)=>s.id==='a'));
 assert.equal((await f.call('/purchase-orders',f.cookies.kho)).status,403);
 await f.db.update(employees).set({canApprove:true}).where(eq(employees.id,'emp'));assert.equal((await f.call('/purchase-orders',f.cookies.emp)).status,403,'cờ duyệt không mở phạm vi mua');
 await f.db.update(suppliers).set({saleAdminBrand:null}).where(eq(suppliers.id,'a'));assert.equal((await f.call('/purchase-orders/a1',f.cookies.sa)).status,404);
});

test('Hãng NCC chỉ Manager đổi, có audit; Kế toán không giả mạo payload để cấp quyền',async()=>{
 const f=await setupEarly();await f.db.update(suppliers).set({saleAdminBrand:null}).where(eq(suppliers.id,'a'));const before=(await f.call('/suppliers/a',f.cookies.mgr)).data.supplier;
 const body={...before,saleAdminBrand:'locknlock',updatedAt:before.updatedAt};
 assert.equal((await f.call('/suppliers/a',f.cookies.kt,'PUT',body)).status,403);
 const saved=await f.call('/suppliers/a',f.cookies.mgr,'PUT',body);assert.equal(saved.status,200,JSON.stringify(saved.data));assert.equal(saved.data.supplier.saleAdminBrand,'locknlock');
 const events=await f.db.select().from(auditLogs).where(eq(auditLogs.action,'sale-admin-brand'));assert.equal(events.length,1);assert.deepEqual(JSON.parse(events[0]!.data),{before:null,after:'locknlock'});
 assert.equal((await f.call('/suppliers/a',f.cookies.mgr,'PUT',{...saved.data.supplier,saleAdminBrand:'Minh Long'})).status,400);
});

test('Kho nhận qua DTO không tiền, không mở PO; sai kho bị chặn và retry không cộng tồn hai lần',async()=>{
 const f=await setupEarly(),now=new Date().toISOString();
 await f.db.insert(warehouses).values([{id:'w-receive',name:'Kho nhận',kind:'stock'},{id:'w-other',name:'Kho khác',kind:'stock'}]);await f.db.insert(warehouseSellers).values({warehouseId:'w-receive',positionId:'warehouse'});
 await f.db.insert(products).values({sku:'0001',name:'Ly',unit:'Cái',updatedAt:now});await f.db.transaction(tx=>postMoves(tx,'mgr',[{sku:'0001',warehouseId:'w-receive',qty:1,kind:'opening',refType:'opening',refId:'open-test'}]));
 const made=await f.call('/purchase-orders',f.cookies.mgr,'POST',{orders:[{supplierId:'a',warehouse:'Kho nhận',lines:[{sku:'0001',quantity:3}]}]});assert.equal(made.status,201,JSON.stringify(made.data));const id=made.data.ids[0];
 await f.db.update(incomingShipments).set({approvalStatus:'approved'}).where(eq(incomingShipments.id,id));
 const context=await f.call('/warehouse-receiving/'+id,f.cookies.kho);assert.equal(context.status,200,JSON.stringify(context.data));assert.equal(context.data.lines[0].missing,3);
 for(const key of ['supplier','ticketNumber','totals','payments','debt','schedules','note'])assert.equal(Object.hasOwn(context.data,key),false,key);
 for(const key of ['price','taxRate','purchaseDiscount','sources','printFee'])assert.equal(Object.hasOwn(context.data.lines[0],key),false,key);
 assert.equal((await f.call('/purchase-orders/'+id,f.cookies.kho)).status,403);
 const body={clientKey:crypto.randomUUID(),receivedDate:'2026-11-23',warehouse:'Kho nhận',createSapo:false,lines:[{lineId:context.data.lines[0].id,goodQty:2,damagedQty:0}]};
 assert.equal((await f.call('/purchase-orders/'+id+'/receipts',f.cookies.kho,'POST',{...body,warehouse:'Kho khác'})).status,404);
 const received=await f.call('/purchase-orders/'+id+'/receipts',f.cookies.kho,'POST',body);assert.equal(received.status,201,JSON.stringify(received.data));assert.equal(received.data.progress.good,2);assert.equal(received.data.totals,undefined);
 const retry=await f.call('/purchase-orders/'+id+'/receipts',f.cookies.kho,'POST',body);assert.equal(retry.status,200);assert.equal(retry.data.receiptId,received.data.receiptId);assert.equal((await f.db.select().from(supplierReceipts).where(eq(supplierReceipts.shipmentId,id))).length,1);
 assert.equal((await f.call('/warehouse-receiving/b1',f.cookies.kho)).status,404);assert.equal((await f.call('/warehouse-receiving',f.cookies.emp)).status,403);
});

test('Phiếu trộn NCC ngoài phạm vi bị 404 cả phiếu; counts và replay không trả ID bị thu hồi',async()=>{
 const f=await setupEarly();await f.db.update(suppliers).set({saleAdminBrand:null}).where(eq(suppliers.id,'b'));
 const mixed=await f.call('/purchase-early-requests',f.cookies.mgr,'POST',{clientKey:'scope-mixed-request',pickupDate:'2026-11-24',lines:[{sku:'031106000',quantity:16000}]});assert.equal(mixed.status,201,JSON.stringify(mixed.data));
 const id=mixed.data.id;
 for(const path of ['/purchase-early-requests?id='+id,'/purchase-early-requests/'+id+'/receiving?orderId=a1'])assert.equal((await f.call(path,f.cookies.sa)).status,404,path);
 assert.equal((await f.call('/purchase-early-requests/'+id+'/submit',f.cookies.sa,'POST',{revision:1})).status,404);
 const visible=await f.call('/purchase-early-requests?counts=1',f.cookies.sa);assert.equal(visible.status,200);assert.ok(!visible.data.requests.some((r:any)=>r.id===id));assert.equal(visible.data.counts.all,0);
 const p=await f.call('/purchase-orders',f.cookies.sa);assert.equal(p.data.counts.all,p.data.orders.length);assert.ok(!JSON.stringify(p.data).includes('PO-b1'));
 await f.db.update(suppliers).set({saleAdminBrand:'locknlock'}).where(eq(suppliers.id,'b'));
 const body={clientKey:crypto.randomUUID(),orders:[{supplierId:'b',warehouse:'Kho nhận',lines:[{sku:'0001',quantity:1}]}]};
 const first=await f.call('/purchase-orders',f.cookies.sa,'POST',body);assert.equal(first.status,201,JSON.stringify(first.data));
 await f.db.update(suppliers).set({saleAdminBrand:null}).where(eq(suppliers.id,'b'));
 const again=await f.call('/purchase-orders',f.cookies.sa,'POST',body);assert.equal(again.status,404);assert.equal(again.data.ids,undefined);
 for(const action of ['payments','receipts','confirm','mail'])assert.equal((await f.call('/purchase-orders/b1/'+action,f.cookies.sa,'POST',{})).status,404,action);
});

import {readFileSync} from 'node:fs';

test('Migration chỉ thêm: cột nullable, CHECK đúng hãng, assert chỉ đọc và không tự sửa schema',async()=>{
 const f=await setupEarly(),gate=readFileSync('scripts/sql/assert-purchase-sale-admin-brand.sql','utf8'),migration=readFileSync('migrations/postgres/20261123201607_purchase_supplier_sale_admin_brand.sql','utf8');
 await f.client.exec('BEGIN READ ONLY;'+gate+'ROLLBACK;');await f.client.exec(migration);
 assert.equal((await f.db.select().from(suppliers).where(eq(suppliers.id,'a')))[0]!.saleAdminBrand,'minhlong','không backfill/ghi đè hãng đã chọn');
 await assert.rejects(f.client.query("UPDATE suppliers SET sale_admin_brand='Other' WHERE id='a'"),/check constraint/i);
 await f.db.update(suppliers).set({saleAdminBrand:null}).where(eq(suppliers.id,'a'));
 await f.client.exec('ALTER TABLE suppliers DROP CONSTRAINT chk_suppliers_sale_admin_brand');await assert.rejects(f.client.exec(gate),/Missing.*check constraint/);
});

import {tasks} from '../../src/modules/tasks/schema.ts';
test('Nhiệm vụ nhận hàng đích danh giữ quyền retry sau khi hoàn tất; tiêu đề công việc không lộ PO/NCC',async()=>{
 const f=await setupEarly(),now=new Date().toISOString();
 await f.db.insert(warehouses).values({id:'w-assigned',name:'Kho được giao',kind:'stock'});
 await f.db.update(incomingShipments).set({warehouse:'w-assigned'}).where(eq(incomingShipments.id,'a1'));
 await f.db.insert(products).values({sku:'031106000',name:'Ly',unit:'Cái',updatedAt:now});
 await postMoves(f.db,'mgr',[{sku:'031106000',warehouseId:'w-assigned',qty:1,kind:'opening',refType:'opening',refId:'assigned-open'}]);
 await f.db.insert(tasks).values({id:'assigned-receive',source:'purchase',sourceId:'a1',autoKey:'receiving-due:purchase:a1:a:2026-11-23:kho',title:'PO-a1 – NCC a',description:'NCC a giá bí mật',link:'#/purchases/a1',assigneeId:'kho',createdAt:now,updatedAt:now});
 const context=await f.call('/warehouse-receiving/a1',f.cookies.kho);assert.equal(context.status,200,JSON.stringify(context.data));
 const nav=await f.call('/navigation-counts',f.cookies.kho);assert.equal(nav.data.receiving,1);
 const task=await f.call('/tasks/assigned-receive',f.cookies.kho);assert.equal(task.status,200,JSON.stringify(task.data));assert.equal(task.data.task.title,'Nhận hàng được giao');assert.equal(task.data.task.link,'#/receiving');assert.equal(task.data.task.sourceId,null);assert.ok(!JSON.stringify(task.data.task).includes('NCC a'));
 const workspace=await f.call('/warehouse-workspace',f.cookies.kho);assert.equal(workspace.status,200,JSON.stringify(workspace.data));const visible=workspace.data.rows.find((r:any)=>r.id==='assigned-receive');assert.equal(visible.title,'Nhận hàng được giao');assert.equal(visible.link,'#/receiving');assert.ok(!visible.description.includes('NCC a'));
 const managerWork=await f.call('/warehouse-workspace?member=kho',f.cookies.mgr);assert.equal(managerWork.status,200);assert.equal(managerWork.data.rows.find((r:any)=>r.id==='assigned-receive').title,'PO-a1 – NCC a');
 const notifications=await createNotificationScope(f.db),projected=await notifications.project({eventType:'task_assigned',url:'#/tasks/assigned-receive'},'kho');assert.equal(projected?.url,'#/receiving');assert.equal(projected?.title,'Nhận hàng được giao');assert.deepEqual(projected?.data,{});assert.equal(await notifications.project({eventType:'task_assigned',url:'#/tasks/assigned-receive'},'mgr'),undefined);
 const body={clientKey:crypto.randomUUID(),receivedDate:'2026-11-23',warehouse:'Kho được giao',createSapo:false,lines:[{lineId:'line-a1',goodQty:8000,damagedQty:0}]};
 const received=await f.call('/purchase-orders/a1/receipts',f.cookies.kho,'POST',body);assert.equal(received.status,201,JSON.stringify(received.data));
 await f.db.update(tasks).set({status:'done'}).where(eq(tasks.id,'assigned-receive'));
 const replay=await f.call('/purchase-orders/a1/receipts',f.cookies.kho,'POST',body);assert.equal(replay.status,200,JSON.stringify(replay.data));assert.equal(replay.data.receiptId,received.data.receiptId);
 assert.equal((await f.call('/navigation-counts',f.cookies.kho)).data.receiving,0);
 assert.equal((await f.call('/warehouse-receiving',f.cookies.kho)).data.items.length,0);
});
