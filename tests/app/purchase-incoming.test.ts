import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from '../helpers/postgres.ts';
import { seedStaff, PASSWORD } from '../helpers/staff-fixture.ts';
import { createAppRouter } from '../../src/app/router.ts';
import { incomingBySku } from '../../src/modules/suppliers/api/incoming-by-sku.ts';
import { outstandingLines, syncIncomingStock } from '../../src/modules/suppliers/api/incoming-stock.ts';
import { products, productStock } from '../../src/modules/catalog/schema.ts';
import { suppliers, incomingShipments, incomingShipmentLines, supplierOrderEvents, supplierReceipts, supplierReceiptLines } from '../../src/modules/suppliers/schema.ts';
import { hashPassword } from '../../src/core/auth/password.ts';

test('hàng đang về: đối chiếu gốc, 20.000/3 đơn, Excel ngoài catalog, loại hủy/đủ, tổng trước phân trang, quyền và API chỉ đọc', async () => {
  const { db, d1, client } = await createTestDb(); await seedStaff(d1);
  const now = '2026-10-21T00:00:00Z';
  await db.insert(suppliers).values(['a','b'].map(id => ({ id, name: 'NCC '+id, nameKey: id, createdAt: now, createdBy: 'mgr', updatedAt: now })));
  await db.insert(products).values({ sku: '031106000', name: 'Chén', updatedAt: now });
  for (const [id,qty,supplierId] of [['a1',8000,'a'],['a2',7000,'a'],['b1',5000,'b'],['excel',10,'a'],['full',4,'a'],['cancel',9,'a'],['draft',8,'a'],['partial',20,'b']] as const) {
    await db.insert(incomingShipments).values({ id, ticketNumber: 'PO-'+id, source:'supplier-order', warehouse:'Kho thử', supplierId, supplierName:'NCC '+supplierId,
      approvalStatus:id==='draft'?'pending':'approved', supplierStatus:'confirmed', cancelledAt:id==='cancel'?now:null,
      arrivalDate:'2026-10-20', createdAt:now,createdBy:'mgr',updatedAt:now });
    await db.insert(incomingShipmentLines).values({id:'line-'+id,shipmentId:id,lineNo:1,sku:['a1','a2','b1'].includes(id)?'031106000':id==='excel'?'01654020803':id,
      name:id==='excel'?'Ly <script>':'Chén',unit:'Cái',quantity:qty,promisedDate:id==='b1'?'2026-11-10':''});
  }
  await db.insert(supplierOrderEvents).values({id:'import-event',shipmentId:'excel',at:now,actorId:'mgr',action:'import',summary:'Nhập Excel'});
  for (const [id,good,cancelledAt] of [['full',4,null],['partial',5,null],['cancelled-receipt',10,now]] as const) {
    await db.insert(supplierReceipts).values({id:'rc-'+id,shipmentId:id==='cancelled-receipt'?'partial':id,receiptNo:'RC-'+id,receivedDate:'2026-10-20',receivedBy:'mgr',clientKey:'key-'+id,createdAt:now,cancelledAt});
    await db.insert(supplierReceiptLines).values({receiptId:'rc-'+id,lineId:'line-'+(id==='cancelled-receipt'?'partial':id),sku:id==='full'?'full':'partial',goodQty:good,damagedQty:id==='partial'?2:0});
  }
  const result = await incomingBySku(db,new URLSearchParams(), '2026-10-21');
  const sku = result.rows.find(r=>r.sku==='031106000')!;
  assert.equal(sku.quantity,20000);assert.equal(sku.orderCount,3);assert.deepEqual(sku.orders.map(o=>o.quantity).sort((a,b)=>a-b),[5000,7000,8000]);
  assert.equal(result.rows.find(r=>r.sku==='01654020803')!.quantity,10);
  assert.equal(result.rows.find(r=>r.sku==='01654020803')!.importedMissingSource,true);
  assert.equal(result.rows.find(r=>r.sku==='partial')!.quantity,15,'chỉ trừ đạt của phiếu chưa hủy, không trừ hỏng');
  assert.equal(result.rows.some(r=>['full','cancel','draft'].includes(r.sku)),false);
  assert.deepEqual(result.kpis,{skus:3,quantity:20025,suppliers:2,overdueOrders:4});
  const paged = await incomingBySku(db,new URLSearchParams('limit=1&offset=1'),'2026-10-21');
  assert.equal(paged.rows.length,1);assert.equal(paged.total,3);assert.deepEqual(paged.kpis,result.kpis);
  const filtered = await incomingBySku(db,new URLSearchParams('supplierId=a&q=031106000'),'2026-10-21');
  assert.equal(filtered.rows[0]!.quantity,15000);assert.equal(filtered.rows[0]!.orderCount,2);
  const due = await incomingBySku(db,new URLSearchParams('from=2026-11-01&to=2026-11-30'),'2026-10-21');
  assert.equal(due.rows[0]!.quantity,5000,'ngày dòng ưu tiên hơn ngày đơn');
  assert.equal((await incomingBySku(db,new URLSearchParams('status=week'),'2026-10-21')).total,0);
  assert.equal((await incomingBySku(db,new URLSearchParams('q=ly'),'2026-10-21')).rows[0]!.sku,'01654020803');
  for(const q of ['from=2026-02-31','from=2026-11-01&to=2026-10-01','limit=0','limit=101','offset=-1','status=bad']) await assert.rejects(()=>incomingBySku(db,new URLSearchParams(q),'2026-10-21'));
  assert.equal((await outstandingLines(db,['01654020803']))[0]!.left,10);
  await syncIncomingStock(db);
  assert.deepEqual((await db.select().from(productStock)).map(r=>[r.sku,r.quantity]),[['031106000',20000]],'giữ FK/công thức kho incoming');

  // Replay the five audited production SKU quantities, without copying customer information or changing production.
  const audits:[string,number[]][]=[['AUDIT-031106000',[10000,10000]],['AUDIT-01654020803',[10]],['AUDIT-042513000',[3000,3000,3000,2000,2000]],['AUDIT-031199000',[1450,150,5000,5000]],['AUDIT-022505000',[2000,2000,3000,2000]]];
  for(const [sku,quantities] of audits) for(const [i,quantity] of quantities.entries()) {
    const id=sku+'-'+i;
    await db.insert(incomingShipments).values({id,ticketNumber:id,source:'supplier-order',warehouse:'Kho thử',supplierId:'a',supplierName:'NCC a',approvalStatus:'approved',createdAt:now,createdBy:'mgr',updatedAt:now});
    await db.insert(incomingShipmentLines).values({id:'line-'+id,shipmentId:id,lineNo:1,sku,quantity});
  }
  const audit = await incomingBySku(db,new URLSearchParams('q=AUDIT-'),'2026-10-21');
  assert.deepEqual(audit.rows.map(r=>[r.sku,r.quantity]),[['AUDIT-01654020803',10],['AUDIT-022505000',9000],['AUDIT-031106000',20000],['AUDIT-031199000',11600],['AUDIT-042513000',13000]]);
  const pw=await hashPassword(PASSWORD,1000);
  for(const [id,pos] of [['sa','sale-admin'],['kho','warehouse'],['kt','accounting']] as const) {
    await d1.sqlite.prepare("insert into staff_members(id,email,name,phone,role,position_id,active,created_at) values (?,?,?,'','employee',?,1,?)").run(id,id+'@x.vn',id,pos,now);
    await d1.sqlite.prepare('insert into staff_credentials(member_id,password_hash,version) values(?,?,0)').run(id,pw);
  }
  const router=createAppRouter(),env={db,passwordIterations:1000};
  const call=async(path:string,cookie='',method='GET',body?:unknown)=>{
    const r=await router.handle(new Request('https://trial.test/api/staff'+path,{method,headers:{origin:'https://trial.test',cookie,'content-type':'application/json'},body:body?JSON.stringify(body):undefined}),env as never);
    return {status:r.status,data:await r.json() as any,cookie:r.headers.get('set-cookie')?.split(';')[0]||''};
  };
  for(const id of ['mgr','sa','emp','kho','kt','ncc']) {
    const login=await call('/login','','POST',{email:id+'@x.vn',password:PASSWORD});
    const response=await call('/purchase-incoming?limit=1',login.cookie);
    assert.equal(response.status,id==='ncc'?403:200,id);
    if(id!=='ncc') {assert.equal(response.data.canRequest,['mgr','sa'].includes(id),id);assert.equal(response.data.canSend,['mgr','sa'].includes(id));assert.equal(response.data.rows.length,1);assert.ok(response.data.kpis.quantity>=20025);assert.doesNotMatch(JSON.stringify(response.data),/customerName|customer_name|sourceNo|price|totalMoney/);}
  }
  assert.equal((await call('/purchase-incoming')).status,401);
  assert.equal((await client.query<{n:number}>("select count(*)::int as n from supplier_stock_requests")).rows[0]!.n,0,'GET không tạo yêu cầu');
});
