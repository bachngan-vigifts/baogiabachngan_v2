import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {and,eq} from 'drizzle-orm';
import {setupWarehouseOps,makeCrm} from '../helpers/warehouse-approval-fixture.ts';
import {canCollectCrmCashWithoutDrawer} from '../../src/modules/sales/domain/crm-cash-receipt.ts';
import {employees} from '../../src/modules/staff/schema.ts';
import {customerPayments,salesOrders,paymentSchedules} from '../../src/modules/sales/schema.ts';
import {cashCollections} from '../../src/modules/sales/cash-collection-schema.ts';
import {auditLogs} from '../../src/core/db/schema.ts';
test('outside-drawer policy covers sales positions and Manager only',()=>{
 for(const positionId of ['sale','sale-admin','sales-lock','sales-ml'])assert.equal(canCollectCrmCashWithoutDrawer({role:'employee',positionId}),true);
 assert.equal(canCollectCrmCashWithoutDrawer({role:'manager'}),true);
 for(const positionId of ['accounting','warehouse',null,'manager'])assert.equal(canCollectCrmCashWithoutDrawer({role:'employee',positionId}),false);
 assert.equal(canCollectCrmCashWithoutDrawer({role:'supplier',positionId:'sale'}),false);
});
test('employee CRM cash stays held until Manager confirms exactly once; reserve amount, permissions, cancellation and void remain safe',async()=>{
 const f=await setupWarehouseOps(),order=(await makeCrm(f,'outside-cash')).order;
 const balance=async()=>(await f.call('/cash',f.mgr)).data.balance,detail=async()=>(await f.call('/orders/'+order.id,f.mgr)).data;
 assert.ok((await f.call('/cash',f.mgr)).data.drawer.openingSetAt);
 await f.client.exec(readFileSync(new URL('../../scripts/sql/assert-customer-cash-collections.sql',import.meta.url),'utf8'));
 const initial=await balance(),initialDebt=(await detail()).receivable.balance,ids:string[]=[];
 const confirm=(id:string,cookie=f.mgr,confirmed=true)=>f.call('/payments/cash-collections/'+id+'/confirm',cookie,'POST',{confirmed});
 for(const positionId of ['sale','sale-admin','sales-lock','sales-ml']){
  await f.db.update(employees).set({positionId}).where(eq(employees.id,'emp'));
  assert.equal((await f.call('/orders/'+order.id,f.emp)).data.canCollectCashWithoutDrawer,true);
  const body={orderId:order.id,amount:100,method:'cash',paidAt:'2026-01-01',key:crypto.randomUUID(),confirmed:true};
  const [r,concurrent]=await Promise.all([f.call('/payments',f.emp,'POST',body),f.call('/payments',f.emp,'POST',body)]);
  assert.equal(r.status,201,JSON.stringify(r.data));assert.equal(r.data.status,'held');assert.equal(r.data.id,concurrent.data.id);ids.push(r.data.id);
  assert.equal((await f.call('/payments',f.emp,'POST',body)).data.id,r.data.id);
  assert.equal((await f.db.select().from(customerPayments).where(eq(customerPayments.orderId,order.id))).length,0);
  assert.equal((await detail()).receivable.balance,initialDebt);assert.equal(await balance(),initial);
  assert.equal((await f.call('/payments',f.emp,'POST',{...body,reference:'Đổi nội dung'})).status,409);
 }
 assert.equal((await detail()).cashHeld,400);assert.equal((await detail()).canConfirmCashCollection,true);
 assert.equal((await f.call('/orders/'+order.id,f.emp)).data.canConfirmCashCollection,false);
 assert.equal((await confirm(ids[0]!,f.emp)).status,403);assert.equal((await confirm(ids[0]!,f.mgr,false)).status,400);
 const ack=await Promise.all([confirm(ids[0]!),confirm(ids[0]!)]);assert.ok(ack.every(r=>r.status===200));assert.equal(ack[0]!.data.paymentId,ack[1]!.data.paymentId);
 assert.equal((await detail()).receivable.balance,initialDebt-100);assert.equal((await detail()).cashHeld,300);assert.equal(await balance(),initial);
 assert.equal((await f.db.select().from(customerPayments).where(eq(customerPayments.orderId,order.id))).length,1);
 const [confirmedPayment]=await f.db.select().from(customerPayments).where(eq(customerPayments.id,ids[0]!));assert.equal(confirmedPayment!.requestKey,'cash-collection:'+ids[0]);assert.equal(confirmedPayment!.paidAt,'2026-01-01');
 const cancel='/payments/cash-collections/'+ids[1]+'/cancel',cancelBody={confirmed:true,reason:'Ghi thu nhầm, chưa nhận tiền khách'};
 assert.equal((await f.call(cancel,f.emp,'POST',cancelBody)).status,403);assert.equal((await f.call(cancel,f.mgr,'POST',cancelBody)).status,200);assert.equal((await f.call(cancel,f.mgr,'POST',cancelBody)).status,200);assert.equal((await confirm(ids[1]!)).status,409);assert.equal((await detail()).cashHeld,200);
 // Manager collecting directly is already the recipient, so it is effective immediately.
 const direct=await f.call('/payments',f.mgr,'POST',{orderId:order.id,amount:100,method:'cash',key:crypto.randomUUID()});assert.equal(direct.status,201);assert.equal(direct.data.status,'confirmed');assert.equal((await detail()).receivable.balance,initialDebt-200);
 // Active POS shift does not make the employee's pending money paid or put it in a drawer.
 await f.db.update(employees).set({positionId:'sales-lock'}).where(eq(employees.id,'emp'));await f.open();const live=await f.call('/payments',f.emp,'POST',{orderId:order.id,amount:100,method:'cash',key:crypto.randomUUID()});assert.equal(live.data.status,'held');assert.equal((await detail()).receivable.balance,initialDebt-200);
 assert.equal((await confirm(live.data.id)).status,200);const [payment]=await f.db.select().from(customerPayments).where(eq(customerPayments.id,live.data.id));assert.equal(payment!.shiftId,null);assert.equal(payment!.createdBy,'emp');assert.equal(payment!.paymentSource,'manual');assert.equal(await balance(),initial);
 const beforeVoid=(await detail()).receivable.balance;assert.equal((await f.call('/payments/'+live.data.id+'/void',f.mgr,'POST',{reason:'Ghi nhầm hình thức'})).status,200);assert.equal((await detail()).receivable.balance,beforeVoid+100);assert.equal((await confirm(live.data.id)).status,409);
 const current=await detail(),tooMuch=current.receivable.balance-current.cashHeld+1;
 for(const method of ['cash','transfer'])assert.equal((await f.call('/payments',f.mgr,'POST',{orderId:order.id,amount:tooMuch,method,key:crypto.randomUUID()})).status,400,'held cash reserves the amount for all collection methods');
 assert.equal((await f.call('/payments',f.ncc,'POST',{orderId:order.id,amount:100,method:'cash',key:crypto.randomUUID()})).status,403);
 await f.db.update(salesOrders).set({status:'cancelled'}).where(eq(salesOrders.id,order.id));assert.equal((await confirm(ids[2]!)).status,409);assert.equal((await f.db.select().from(cashCollections).where(eq(cashCollections.id,ids[2]!)))[0]!.status,'held');
 const cannotDelete=await f.call('/orders/'+order.id,f.mgr,'DELETE');assert.equal(cannotDelete.status,409);assert.equal(cannotDelete.data.code,'ORDER_HAS_HISTORY');
 const audits=await f.db.select().from(auditLogs).where(and(eq(auditLogs.entityType,'customer_cash_collections'),eq(auditLogs.action,'cash-collection-confirm')));assert.equal(audits.length,2);
});

test('confirmation rolls back the receipt when the held-state write fails; changed debt never silently overpays',async()=>{
 const f=await setupWarehouseOps(),order=(await makeCrm(f,'cash-atomic')).order;
 const held=await f.call('/payments',f.emp,'POST',{orderId:order.id,amount:100,method:'cash',key:crypto.randomUUID()});assert.equal(held.data.status,'held');
 await f.client.exec("CREATE FUNCTION pg_temp.fail_cash_confirmation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected confirmation failure'; END $$; CREATE TRIGGER cash_confirm_failure BEFORE UPDATE ON customer_cash_collections FOR EACH ROW WHEN (NEW.status='confirmed') EXECUTE FUNCTION pg_temp.fail_cash_confirmation();");
 const confirm=()=>f.call('/payments/cash-collections/'+held.data.id+'/confirm',f.mgr,'POST',{confirmed:true});
 assert.equal((await confirm()).status,500);assert.equal((await f.db.select().from(customerPayments).where(eq(customerPayments.orderId,order.id))).length,0);assert.equal((await f.db.select().from(cashCollections))[0]!.status,'held');
 await f.client.exec('DROP TRIGGER cash_confirm_failure ON customer_cash_collections');
 const [schedule]=await f.db.select().from(paymentSchedules).where(eq(paymentSchedules.orderId,order.id));const original=schedule!.amount;
 await f.db.update(paymentSchedules).set({amount:50}).where(eq(paymentSchedules.id,schedule!.id));assert.equal((await confirm()).status,409);assert.equal((await f.db.select().from(cashCollections))[0]!.status,'held');
 await f.db.update(paymentSchedules).set({amount:original}).where(eq(paymentSchedules.id,schedule!.id));assert.equal((await confirm()).status,200);assert.equal((await confirm()).status,200);assert.equal((await f.db.select().from(customerPayments).where(eq(customerPayments.orderId,order.id))).length,1);
});

test('collecting the full order amount does not complete payment until Manager receives it',async()=>{
 const f=await setupWarehouseOps(),order=(await makeCrm(f,'cash-full')).order;
 const read=async()=>(await f.call('/orders/'+order.id,f.mgr)).data;
 const due=(await read()).receivable.due,held=await f.call('/payments',f.emp,'POST',{orderId:order.id,amount:due,method:'cash',key:crypto.randomUUID()});assert.equal(held.data.status,'held');
 const pending=await read();assert.equal(pending.receivable.paid,0);assert.equal(pending.receivable.balance,due);assert.equal(pending.cashHeld,due);
 assert.equal((await f.call('/payments',f.emp,'POST',{orderId:order.id,amount:1,method:'cash',key:crypto.randomUUID()})).status,400);
 assert.equal((await f.call('/payments/cash-collections/'+held.data.id+'/confirm',f.mgr,'POST',{confirmed:true})).status,200);
 const confirmed=await read();assert.equal(confirmed.receivable.paid,due);assert.equal(confirmed.receivable.balance,0);assert.equal(confirmed.cashHeld,0);assert.equal(confirmed.cashCollections[0].confirmedBy,'mgr');assert.ok(confirmed.cashCollections[0].confirmedAt);
});
