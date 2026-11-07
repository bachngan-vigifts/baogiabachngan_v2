import {test} from 'node:test';
import assert from 'node:assert/strict';
import {eq} from 'drizzle-orm';
import {setup} from '../helpers/pos-fixture.ts';
import {employees,positionPermissions} from '../../src/modules/staff/schema.ts';
import {salesOrders,salesOrderLines,salesContracts,deliveries,deliveryLines} from '../../src/modules/sales/schema.ts';
import {routePermission} from '../../src/modules/staff/domain/permissions.ts';

test('sản phẩm theo đơn: dữ liệu thật theo ID dòng, giữ scope, tính lịch đúng trước phân trang và không ghi dữ liệu',async()=>{
 const f=await setup(),now='2026-11-01T00:00:00.000Z';
 const order=(id:string,owner='emp',extra={})=>({id,orderNo:'LIVE-'+id,quoteType:'HRC' as const,ownerId:owner,createdBy:owner,customerName:'Khách hàng '+id,orderDate:'2026-11-01',expectedDeliveryDate:'2026-11-10',status:'confirmed' as const,createdAt:now,updatedAt:now,...extra});
 await f.db.insert(salesOrders).values([order('own'),order('private','mgr'),order('pos','emp',{channel:'pos',status:'delivered'}),order('cancelled','emp',{status:'cancelled'})]);
 await f.db.insert(salesContracts).values({id:'k-live',contractNo:'HD-LIVE',orderId:'own',legalEntity:'BN',status:'signed',createdBy:'emp',createdAt:now,updatedAt:now});
 await f.db.insert(salesOrderLines).values([
  {id:'line-1',orderId:'own',lineNo:1,sku:'00123',name:'Ly sứ in xanh',unit:'Cái',qty:10,deliveredQty:3,unitPrice:1000,taxRate:8,amount:10000},
  {id:'line-2',orderId:'own',lineNo:2,sku:'00123',name:'Ly sứ in đỏ',unit:'Bộ',qty:5,deliveredQty:0,unitPrice:2000,taxRate:10,amount:10000},
  {id:'line-private',orderId:'private',lineNo:1,sku:'PRIVATE',name:'Dòng riêng tư',qty:100,deliveredQty:0},
  {id:'line-pos',orderId:'pos',lineNo:1,sku:'POS',name:'POS giao tại quầy',qty:2,deliveredQty:2},
  {id:'line-cancelled',orderId:'cancelled',lineNo:1,sku:'CANCEL',name:'Đơn đã huỷ',qty:1,deliveredQty:0},
 ]);
 await f.db.insert(deliveries).values([
  {id:'trip-active',deliveryNo:'ACTIVE',orderId:'own',plannedDate:'2020-01-01',status:'planned',createdBy:'emp',createdAt:now,updatedAt:now},
  {id:'trip-failed',deliveryNo:'FAILED',orderId:'own',plannedDate:'2020-01-01',status:'failed',createdBy:'emp',createdAt:now,updatedAt:now},
  {id:'trip-cancelled',deliveryNo:'CANCELLED',orderId:'own',plannedDate:'2020-01-01',status:'cancelled',createdBy:'emp',createdAt:now,updatedAt:now},
 ]);
 await f.db.insert(deliveryLines).values([
  {deliveryId:'trip-active',orderLineId:'line-1',qty:4},{deliveryId:'trip-failed',orderLineId:'line-1',qty:2},{deliveryId:'trip-cancelled',orderLineId:'line-2',qty:5},
 ]);
 const read=async(q='',who=f.mgr)=>{const r=await f.call('/order-products?'+q,who);assert.equal(r.status,200,JSON.stringify(r.data));return r.data;};
 const all=await read('status=all'),a=all.lines.find((l:any)=>l.id==='line-1'),b=all.lines.find((l:any)=>l.id==='line-2');
 assert.equal(all.total,4);assert.equal(all.counts.delivered,1);assert.equal(all.counts.work,3);
 assert.deepEqual([a.qty,a.deliveredQty,a.remainingQty,a.scheduledQty,a.availableQty],[10,3,7,4,3]);
 assert.equal(a.trips.length,2);assert.equal(a.overdue,true);assert.equal(a.nextDeliveryDate,'2020-01-01');
 assert.deepEqual([b.qty,b.deliveredQty,b.scheduledQty,b.availableQty],[5,0,0,5]);assert.equal(b.trips[0].status,'cancelled');
 assert.equal(a.sku,b.sku);assert.notEqual(a.id,b.id,'cùng SKU vẫn là hai dòng khác nhau');
 assert.equal(a.contractNo,'HD-LIVE');assert.ok(a.progress.label);assert.equal(a.canSchedule,true);
 assert.equal(all.lines.find((l:any)=>l.id==='line-pos').remainingQty,0,'POS không có chuyến vẫn dùng số đã giao của dòng');
 assert.deepEqual((await read('status=partial')).lines.map((l:any)=>l.id),['line-1']);
 assert.deepEqual((await read('status=overdue&q=00123')).lines.map((l:any)=>l.id),['line-1']);
 assert.equal((await read('status=all&q=ly+su+do')).lines[0].id,'line-2','tìm không dấu trên server');
 assert.equal((await read('status=all&q='+encodeURIComponent("' OR 1=1 --"))).total,0);
 assert.equal((await read('status=all&kind=contract')).total,2);assert.equal((await read('status=all&channel=pos')).total,1);
 assert.equal((await read('status=all&orderStatus=cancelled')).total,1);
 const page=await read('status=all&limit=1&offset=1');assert.equal(page.lines.length,1);assert.equal(page.total,4);assert.equal(page.counts.work,3,'thẻ tổng quan không đếm riêng trang');
 assert.equal((await read('status=all&from=2019-01-01&to=2021-01-01')).total,1);
 const own=await read('status=all',f.emp);assert.equal(own.lines.some((l:any)=>l.id==='line-private'),false);assert.equal(own.filterOptions.owners.some((o:any)=>o.id==='mgr'),false);
 assert.equal((await read('status=all&owner=mgr',f.emp)).total,0);
 assert.equal((await f.call('/order-products',f.ncc)).status,403);
 await f.db.update(employees).set({positionId:'warehouse'}).where(eq(employees.id,'cashier2'));
 assert.equal((await f.call('/order-products',f.other)).status,403,'phải có quyền trang Sản phẩm theo đơn');
 await f.db.insert(positionPermissions).values({positionId:'warehouse',permission:'page.order-products'}).onConflictDoNothing();
 await f.db.update(salesOrders).set({ownerId:'cashier2'}).where(eq(salesOrders.id,'own'));
 const warehouse=await read('status=all',f.other);assert.equal(warehouse.lines.length,2);
 assert.equal('unitPrice' in warehouse.lines[0],false);assert.equal('amount' in warehouse.lines[0],false);assert.equal(warehouse.lines[0].canSchedule,false);
 for(const q of ['status=bad','sort=bad','kind=bad','channel=bad','orderStatus=processing','from=2026-02-30','from=2027-01-01&to=2026-01-01','limit=0','limit=201','offset=-1','offset=1.5','q='+'a'.repeat(201)])assert.equal((await f.call('/order-products?'+q,f.mgr)).status,400,q);
 const [stored]=await f.db.select().from(salesOrderLines).where(eq(salesOrderLines.id,'line-1'));assert.ok(stored);assert.equal(stored.deliveredQty,3,'GET không ghi lại số đã giao');
});

test('quyền API và đường dẫn thao tác dùng luồng đơn / lịch thật',async()=>{
 assert.deepEqual(routePermission('GET','/order-products',new URLSearchParams()),['page.order-products']);
 const ui=await import(new URL('../../trial-ui/order-products.js',import.meta.url).href);
 assert.equal(ui.orderProductHref({orderId:'o/a',id:'line/a',contractNo:'HD'}), '#/contracts/o%2Fa');
 assert.equal(ui.orderProductHref({orderId:'o',id:'line/a',contractNo:null},true),'#/orders/o?scheduleLine=line%2Fa');
 assert.equal(ui.orderProductImage('javascript:alert(1)'),'');assert.equal(ui.orderProductImage('https://example.test/a.png'),'https://example.test/a.png');
 assert.equal(ui.orderProductDueLabel({orderStatus:'delivered',remainingQty:0,nextDeliveryDate:null}),'Đã giao đủ');
 assert.equal(ui.orderProductDueLabel({orderStatus:'cancelled',remainingQty:5,nextDeliveryDate:null}),'Đã huỷ');
 assert.equal(ui.orderProductDueLabel({orderStatus:'confirmed',remainingQty:5,nextDeliveryDate:null}),'Chưa hẹn');
});
