import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from '../helpers/postgres.ts';
import { seedStaff, PASSWORD } from '../helpers/staff-fixture.ts';
import { hashPassword } from '../../src/core/auth/password.ts';
import { createAppRouter } from '../../src/app/router.ts';
import { receivingCalendar } from '../../src/modules/suppliers/api/receiving-calendar.ts';
import { suppliers, incomingShipments, incomingShipmentLines, supplierReceipts, supplierReceiptLines } from '../../src/modules/suppliers/schema.ts';
import { salesOrders, deliveries } from '../../src/modules/sales/schema.ts';

test('warehouse calendars: remaining supplier receipts, date overrides, pagination, permissions, POS excluded from list and badge', async () => {
  const { db, d1 } = await createTestDb(); await seedStaff(d1);
  await d1.sqlite.prepare("INSERT INTO staff_members (id,email,name,phone,role,position_id,active,created_at) VALUES ('kho','kho@x.vn','Kho','','employee','warehouse',1,'2026-01-01')").run();
  await d1.sqlite.prepare('INSERT INTO staff_credentials (member_id,password_hash,version) VALUES (?,?,0)').run('kho', await hashPassword(PASSWORD, 1000));
  const router = createAppRouter(), now = '2026-10-22T00:00:00Z';
  const call = async (path: string, cookie = '', method = 'GET', body?: object) => {
    const res = await router.handle(new Request('https://trial.test/api/staff' + path, { method, headers: {origin:'https://trial.test',cookie,'content-type':'application/json'}, body: body ? JSON.stringify(body) : undefined }), {db,passwordIterations:1000,sapoOrderPush:'off'});
    return { status:res.status, data:await res.json() as any, cookie:res.headers.get('set-cookie')?.split(';')[0] || '' };
  };
  const mgr = (await call('/login','','POST',{email:'mgr@x.vn',password:PASSWORD})).cookie;
  const kho = (await call('/login','','POST',{email:'kho@x.vn',password:PASSWORD})).cookie;
  await db.insert(suppliers).values({id:'s',name:'Nhà cung cấp',nameKey:'nha cung cap',createdBy:'mgr',createdAt:now,updatedAt:now});
  const seeds = ['partial','draft','cancelled','full','undated',...Array.from({length:51},(_,i)=>'page'+i)];
  await db.insert(incomingShipments).values(seeds.map(id=>({id,ticketNumber:'DMH_'+id,source:'supplier-order' as const, supplierId:'s',supplierName:'Nhà cung cấp',warehouse:'Kho Vigifts',approvalStatus:id==='draft'?'pending' as const:'approved' as const,cancelledAt:id==='cancelled'?now:null,arrivalDate:id==='undated'?null:'2026-10-23',createdAt:now,updatedAt:now,createdBy:'mgr'})));
  await db.insert(incomingShipmentLines).values(seeds.map(id=>({id:'l-'+id,shipmentId:id,lineNo:1,sku:'SKU-'+id,name:'Hàng '+id,unit:'cái',quantity:10,promisedDate:id==='partial'?'2026-10-20':''})));
  await db.insert(supplierReceipts).values(['partial','full','void'].map(id=>({id,receiptNo:'PNH-'+id,shipmentId:id==='void'?'partial':id,receivedDate:'2026-10-21',receivedBy:'mgr',clientKey:id,createdAt:now,cancelledAt:id==='void'?now:null})));
  await db.insert(supplierReceiptLines).values([{receiptId:'partial',lineId:'l-partial',sku:'SKU-partial',goodQty:4,damagedQty:2},{receiptId:'full',lineId:'l-full',sku:'SKU-full',goodQty:10},{receiptId:'void',lineId:'l-partial',sku:'SKU-partial',goodQty:6}]);
  const filtered = await receivingCalendar(db,new URLSearchParams({state:'late'}),'2026-10-22');
  assert.equal(filtered.total,1); assert.equal(filtered.rows[0]!.date,'2026-10-20');
  assert.deepEqual(filtered.counts,{all:53,late:1,today:0,scheduled:51,undated:1},'status counts ignore the selected status so the quick-filter cards stay stable');
  assert.deepEqual((await receivingCalendar(db,new URLSearchParams({state:'undated'}),'2026-10-23')).counts,{all:53,late:1,today:51,scheduled:51,undated:1});
  assert.equal((await receivingCalendar(db,new URLSearchParams({state:'scheduled',q:'SKU-partial'}),'2026-10-22')).counts.late,1,'counts follow the other filters'); assert.equal(filtered.rows[0]!.lines[0]!.left,6,'damaged goods and voided receipts do not reduce remaining');
  assert.equal((await call('/purchase-receiving-calendar',kho)).status,403);
  const first = await call('/purchase-receiving-calendar',mgr);
  assert.equal(first.status,200); assert.equal(first.data.total,53); assert.equal(first.data.rows.length,50);
  assert.equal(first.data.orderCount,53); assert.equal(first.data.undated,1);
  assert.equal((await call('/purchase-receiving-calendar?offset=50',mgr)).data.rows.length,3);
  assert.equal((await call('/purchase-receiving-calendar?q=SKU-partial',mgr)).data.rows[0].lines[0].left,6);
  assert.equal((await call('/purchase-receiving-calendar?from=2026-10-23&to=2026-10-23',mgr)).data.total,52,'undated lines remain visible');
  assert.equal((await call('/purchase-receiving-calendar?from=2026-10-24&to=2026-10-23',mgr)).status,400);
  assert.equal((await call('/purchase-receiving-calendar?state=unknown',mgr)).status,400);
  assert.equal(JSON.stringify(first.data).includes('price'),false,'calendar never sends purchase prices');
  await db.insert(salesOrders).values(['crm','pos'].map(channel=>({id:channel,orderNo:channel+'-1',channel,quoteType:'HRC' as const,customerName:'Khách',ownerId:'emp',createdBy:'emp',orderDate:'2026-10-22',createdAt:now,updatedAt:now})));
  await db.insert(deliveries).values(['crm','pos'].map(id=>({id,deliveryNo:'GH-'+id,orderId:id,plannedDate:'2026-10-22',createdBy:'emp',createdAt:now,updatedAt:now})));
  for (const cookie of [kho,mgr]) {
    const list = await call('/deliveries',cookie); assert.equal(list.status,200); assert.deepEqual(list.data.deliveries.map((r:any)=>r.orderId),['crm']);
    assert.deepEqual((await call('/deliveries?id=pos',cookie)).data.deliveries,[],'focus links cannot reintroduce POS');
    const counts = (await call('/navigation-counts',cookie)).data; assert.equal(counts.deliveries,1); assert.equal(counts.receiving,cookie===mgr?53:0,'Kho chưa được phân công tại kho nhận không thấy danh sách thương mại');
  }
  assert.equal((await call('/orders/pos',mgr)).data.deliveries.length,1,'POS order details still retain their own delivery');
  assert.equal((await call('/permissions/positions/warehouse',mgr,'PUT',{perms:['page.deliveries']})).status,200);
  assert.equal((await call('/purchase-receiving-calendar',kho)).status,403,'page.purchases is enforced on the API');
  assert.equal((await call('/navigation-counts',kho)).data.receiving,0);
});
