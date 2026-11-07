import {contractTest as test,assert} from '../TEST_TEMPLATE.ts';
import {readFileSync} from 'node:fs';
import {eq} from 'drizzle-orm';
import {setup} from '../helpers/pos-fixture.ts';
import {salesOrders,salesOrderLines} from '../../src/modules/sales/schema.ts';
import {positions,positionPermissions,employees} from '../../src/modules/staff/schema.ts';

test('bảng quyền có hai trang riêng; đổi quyền có hiệu lực trên phiên cũ, quyền trang sản phẩm không cấp API đơn/giao hàng',async()=>{
 const f=await setup();await f.db.update(employees).set({positionId:'sale'}).where(eq(employees.id,'emp'));
 const view=await f.call('/permissions',f.mgr);assert.equal(view.status,200);
 for(const [key,label] of [['page.order-products','Sản phẩm theo đơn'],['page.deliveries','Lịch giao hàng']]){
  const rows=view.data.catalog.filter((r:any)=>r.key===key);assert.equal(rows.length,1);assert.equal(rows[0].label,label);assert.equal(rows[0].group,'Trang được vào');
 }
 const now=new Date().toISOString();
 await f.db.insert(salesOrders).values(['emp','mgr'].map(owner=>({id:'permission-'+owner,orderNo:'PERM-'+owner,quoteType:'HRC' as const,ownerId:owner,createdBy:owner,customerName:'Khách kiểm thử',orderDate:'2026-11-01',status:'confirmed' as const,createdAt:now,updatedAt:now})));
 await f.db.insert(salesOrderLines).values(['emp','mgr'].map(owner=>({id:'permission-line-'+owner,orderId:'permission-'+owner,lineNo:1,name:'Sản phẩm kiểm thử',qty:1})));
 const set=async(perms:string[])=>assert.equal((await f.call('/permissions/positions/sale',f.mgr,'PUT',{perms})).status,200);
 const me=async()=>(await f.call('/me',f.emp)).data.user;
 await set(['page.order-products']);const products=await f.call('/order-products',f.emp);assert.equal(products.status,200);assert.deepEqual(products.data.lines.map((r:any)=>r.id),['permission-line-emp']);assert.equal(products.data.lines[0].canSchedule,false,'chỉ cấp trang xem không cấp quyền xếp lịch');assert.deepEqual((await me()).perms,['page.order-products']);
 assert.equal((await f.call('/orders',f.emp)).status,403);
 assert.equal((await f.call('/orders',f.emp,'POST',{})).status,403);
 assert.equal((await f.call('/deliveries',f.emp)).status,403);
 await set(['page.deliveries']);assert.deepEqual((await me()).perms,['page.deliveries']);
 assert.equal((await f.call('/deliveries',f.emp)).status,200);
 await set(['page.orders']);assert.equal((await f.call('/order-products',f.emp)).status,403);assert.equal((await me()).perms.includes('page.order-products'),false,'không tự cấp lại quyền trang sản phẩm khi vẫn có quyền đơn hàng');
 await set([]);assert.deepEqual((await me()).perms,[]);assert.equal((await f.call('/deliveries',f.emp)).status,403);
 assert.equal((await f.call('/permissions',f.emp)).status,403);
 assert.ok((await f.call('/me',f.mgr)).data.user.perms.includes('page.order-products'),'Manager luôn có quyền');
 const log=(await f.call('/permissions',f.mgr)).data.log;assert.ok(log.some((r:any)=>r.detail.includes('Sản phẩm theo đơn')));
});

test('migration giữ quyền cũ cho chức vụ tuỳ chỉnh; không cấp thêm trang khác hay mở trang sản phẩm cho chức vụ chỉ có lịch',async()=>{
 const f=await setup();
 await f.db.insert(positions).values([{id:'custom-orders',name:'Chức vụ đơn hàng'},{id:'custom-calendar',name:'Chức vụ lịch'},{id:'custom-products',name:'Chức vụ sản phẩm'}]);
 await f.db.insert(positionPermissions).values([{positionId:'custom-orders',permission:'page.orders'},{positionId:'custom-orders',permission:'page.flow'},
 {positionId:'custom-calendar',permission:'page.deliveries'},{positionId:'custom-products',permission:'page.order-products'}]);
 const before=await f.db.select().from(positionPermissions),sql=readFileSync(new URL('../../migrations/postgres/20261107074837_order_products_page_permission.sql',import.meta.url),'utf8');
 await f.client.exec(sql);await f.client.exec(sql);
 const after=await f.db.select().from(positionPermissions);
 assert.equal(after.filter(r=>r.positionId==='custom-orders'&&r.permission==='page.order-products').length,1);
 assert.equal(after.some(r=>r.positionId==='custom-calendar'&&r.permission==='page.order-products'),false);
 assert.equal(after.some(r=>r.positionId==='custom-products'&&r.permission==='page.order-products'),true);
 const other=(rows:typeof before)=>rows.filter(r=>r.permission!=='page.order-products').map(r=>r.positionId+':'+r.permission).sort();
 assert.deepEqual(other(after),other(before),'các quyền khác giữ nguyên');
});
