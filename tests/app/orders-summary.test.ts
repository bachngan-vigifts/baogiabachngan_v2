import {test} from 'node:test';
import assert from 'node:assert/strict';
import {setup} from '../helpers/pos-fixture.ts';
import {salesOrders,salesContracts,customerPayments,paymentSchedules} from '../../src/modules/sales/schema.ts';

test('Tổng đơn hàng theo bộ lọc và quyền xem, mọi trang; loại đơn huỷ, HĐKT và phiếu thu huỷ; không nhân đôi cọc',async()=>{
 const f=await setup(),now='2026-10-23T03:00:00.000Z';
 const make=async(id:string,total:number,extra:Partial<typeof salesOrders.$inferInsert>={})=>{
  await f.db.insert(salesOrders).values({id,orderNo:id,quoteType:'HRC',customerName:'Khách tổng hợp',ownerId:'emp',createdBy:'emp',orderDate:'2026-10-23',createdAt:now,updatedAt:now,total,...extra});
 };
 await make('CRM-A',1000);await make('CRM-B',2000,{status:'draft',submittedAt:null});
 await make('POS-A',3000,{channel:'pos',fulfillmentMode:'cod'});
 await make('CANCEL',9000,{status:'cancelled'});
 await make('CONTRACT',8000);await f.db.insert(salesContracts).values({id:'contract',contractNo:'HD-1',orderId:'CONTRACT',legalEntity:'BN',value:8000,createdBy:'emp',createdAt:now,updatedAt:now});
 await make('PRIVATE',4000,{ownerId:'mgr',createdBy:'mgr'});
 await f.db.insert(paymentSchedules).values([{id:'deposit-a',orderId:'CRM-A',kind:'deposit',amount:400,createdAt:now},{id:'balance-a',orderId:'CRM-A',kind:'balance',amount:600,createdAt:now}]);
 const pay=async(id:string,orderId:string,amount:number,extra:Partial<typeof customerPayments.$inferInsert>={})=>{await f.db.insert(customerPayments).values({id,orderId,amount,paidAt:now,createdBy:'emp',createdAt:now,...extra});};
 await pay('p1','CRM-A',100,{scheduleId:'deposit-a'});await pay('p2','CRM-A',200,{scheduleId:'deposit-a'});
 await pay('p3','POS-A',500,{paymentSource:'pos_cod_deposit'});await pay('p4','POS-A',500);
 await pay('void','CRM-A',999,{voidedAt:now,voidedBy:'mgr'});await pay('cancel','CANCEL',9000);await pay('contract','CONTRACT',8000);
 const list=async(params='',cookie=f.mgr)=>{const r=await f.call('/orders?flow=order&'+params,cookie);assert.equal(r.status,200,JSON.stringify(r.data));return r.data;};
 const all=await list('limit=1');assert.equal(all.orders.length,1);
 assert.deepEqual(all.summary,{count:4,cancelled:1,revenue:10000,deposit:900,paid:1300,remaining:8700});
 assert.deepEqual((await list('limit=1&offset=3')).summary,all.summary,'tổng không phụ thuộc trang');
 assert.deepEqual((await list('source=crm')).summary,{count:3,cancelled:1,revenue:7000,deposit:400,paid:300,remaining:6700});
 assert.deepEqual((await list('source=ghn')).summary,{count:1,cancelled:0,revenue:3000,deposit:500,paid:1000,remaining:2000});
 assert.equal((await list('owner=emp')).summary.revenue,6000);
 assert.equal((await list('q=CRM-A')).summary.revenue,1000);
 assert.deepEqual((await list('status=cancelled')).summary,{count:0,cancelled:1,revenue:0,deposit:0,paid:0,remaining:0});
 assert.equal((await list('status=unsubmitted')).summary.revenue,2000);
 assert.equal((await list('from=2026-10-24')).summary.count,0);
 assert.equal((await list('to=2026-10-22')).summary.count,0);
 assert.equal((await list('invoice=requested')).summary.count,0);
 assert.equal((await list('owner=emp&branch=crm')).summary.revenue,3000);
 assert.equal((await list('',f.emp)).summary.revenue,3000,'nhân viên không cộng đơn riêng của Manager hoặc POS chưa thuộc quầy được phép xem');
});
