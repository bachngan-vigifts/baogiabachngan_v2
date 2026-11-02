import {test} from 'node:test';
import assert from 'node:assert/strict';
import {and,eq} from 'drizzle-orm';
import {setupWarehouseOps,makeCrm} from '../helpers/warehouse-approval-fixture.ts';
import {canCollectCrmCashWithoutDrawer} from '../../src/modules/sales/domain/crm-cash-receipt.ts';
import {employees} from '../../src/modules/staff/schema.ts';
import {customerPayments} from '../../src/modules/sales/schema.ts';
import {auditLogs} from '../../src/core/db/schema.ts';
test('outside-drawer policy covers sales positions and Manager only',()=>{
 for(const positionId of ['sale','sale-admin','sales-lock','sales-ml'])assert.equal(canCollectCrmCashWithoutDrawer({role:'employee',positionId}),true);
 assert.equal(canCollectCrmCashWithoutDrawer({role:'manager'}),true);
 for(const positionId of ['accounting','warehouse',null,'manager'])assert.equal(canCollectCrmCashWithoutDrawer({role:'employee',positionId}),false);
 assert.equal(canCollectCrmCashWithoutDrawer({role:'supplier',positionId:'sale'}),false);
});
test('CRM cash receipts work without a shift despite configured drawer, reduce debt, replay once and never affect drawer',async()=>{
 const f=await setupWarehouseOps(),order=(await makeCrm(f,'outside-cash')).order;
 assert.ok((await f.call('/cash',f.mgr)).data.drawer.openingSetAt,'fixture drawer already has opening cash');
 const balance=async()=>(await f.call('/cash',f.mgr)).data.balance;
 const initial=await balance(),ids:string[]=[];
 for(const [positionId,cookie]of [['sale',f.emp],['sale-admin',f.emp],['sales-lock',f.emp],['sales-ml',f.emp],['manager',f.mgr]]){
  if(positionId!=='manager')await f.db.update(employees).set({positionId}).where(eq(employees.id,'emp'));
  const detail=await f.call('/orders/'+order.id,cookie);assert.equal(detail.data.canCollectCashWithoutDrawer,true,positionId);
  const before=detail.data.receivable.balance,body={orderId:order.id,amount:100,method:'cash',paidAt:'2026-01-01',key:crypto.randomUUID()};
  const [r,concurrent]=await Promise.all([f.call('/payments',cookie,'POST',body),f.call('/payments',cookie,'POST',body)]);assert.equal(concurrent.data.id,r.data.id);assert.equal(r.status,201,positionId+': '+JSON.stringify(r.data));ids.push(r.data.id);
  assert.equal((await f.call('/payments',cookie,'POST',body)).data.id,r.data.id);
  const [p]=await f.db.select().from(customerPayments).where(eq(customerPayments.id,r.data.id));assert.equal(p!.shiftId,null);assert.equal(p!.paymentSource,'manual');assert.equal(p!.method,'cash');assert.equal(p!.createdBy,positionId==='manager'?'mgr':'emp');
  assert.equal((await f.call('/orders/'+order.id,cookie)).data.receivable.balance,before-100);assert.equal(await balance(),initial);
 }
 await f.db.update(employees).set({positionId:'accounting'}).where(eq(employees.id,'emp'));
 const denied=await f.call('/payments',f.emp,'POST',{orderId:order.id,amount:100,method:'cash',cashWithoutDrawer:true,key:crypto.randomUUID()});assert.equal(denied.status,409,'client cannot grant the exemption to another position');
 // A live POS shift must not silently pull CRM cash into its drawer either.
 await f.db.update(employees).set({positionId:'sales-lock'}).where(eq(employees.id,'emp'));await f.open();
 const before=await balance(),paid=await f.call('/payments',f.emp,'POST',{orderId:order.id,amount:100,method:'cash',key:crypto.randomUUID()});assert.equal(paid.status,201,JSON.stringify(paid.data));
 assert.equal((await f.db.select().from(customerPayments).where(eq(customerPayments.id,paid.data.id)))[0]!.shiftId,null);assert.equal(await balance(),before);
 const debt=(await f.call('/orders/'+order.id,f.mgr)).data.receivable.balance;
 assert.equal((await f.call('/payments/'+paid.data.id+'/void',f.mgr,'POST',{reason:'Ghi thử sai hình thức'})).status,200);assert.equal((await f.call('/orders/'+order.id,f.mgr)).data.receivable.balance,debt+100);assert.equal(await balance(),before);
 assert.equal((await f.call('/payments',f.emp,'POST',{orderId:order.id,amount:99999999,method:'cash',key:crypto.randomUUID()})).status,400);
 assert.equal((await f.call('/payments',f.ncc,'POST',{orderId:order.id,amount:100,method:'cash',key:crypto.randomUUID()})).status,403);
 const audit=await f.db.select().from(auditLogs).where(and(eq(auditLogs.entityType,'payments'),eq(auditLogs.action,'receipt')));assert.equal(audit.filter(a=>ids.includes(a.entityId)&&JSON.parse(a.data).cashHandling==='outside_drawer').length,5);
});
