/** Internal, explicitly approved one-order reconciliation. Uses the application's ledger, not manual balance SQL. */
import {and,eq,inArray,ne,sql} from 'drizzle-orm';
import type {AnyDb} from '../../src/core/db/client.ts';
import {auditLogs} from '../../src/core/db/schema.ts';
import {employees} from '../../src/modules/staff/schema.ts';
import {warehouses} from '../../src/modules/catalog/schema.ts';
import {stockBalances,inventoryAdjustments} from '../../src/modules/inventory/schema.ts';
import {lockLedger,assertWarehousesOpened,syncSaleMoves} from '../../src/modules/inventory/api/ledger.ts';
import {salesOrders,salesOrderLines,packingSlips,deliveries,deliveryLines} from '../../src/modules/sales/schema.ts';
import {posReturns} from '../../src/modules/sales/return-schema.ts';
import {crmStockFulfilment} from '../../src/modules/sales/api/crm-stock-lifecycle.ts';
import {progressOf} from '../../src/modules/sales/api/progress.ts';
import {assertFreeStock} from '../../src/modules/sales/api/stock-free.ts';
import {consumeOrderHolds} from '../../src/modules/sales/api/order-hold-store.ts';
export interface ApprovedExport {orderId:string;orderNo:string;warehouseId:string;warehouseName:string;approverId:string;revision:number;requestKey:string;lines:{id:string;sku:string;qty:number}[];approval:string}
const fail=(s:string):never=>{const e=new Error(s);e.name='SupportGuard';throw e;};
export async function approvedLegacyExport(db:AnyDb,r:ApprovedExport,apply=false){
 const now=new Date().toISOString();
 return db.transaction(async tx=>{
  const d=tx as unknown as AnyDb;
  // Same ordering as CRM packing: holds, order, opening/ledger, balance rows.
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext('stock_holds'))`);
  const [order]=await tx.select().from(salesOrders).where(eq(salesOrders.id,r.orderId)).for('update');
  if(!order||order.orderNo!==r.orderNo||order.channel!=='crm'||order.status!=='delivered'||order.holdMode!=='legacy')fail('Order is not the approved delivered legacy CRM document.');
  const [actor]=await tx.select().from(employees).where(and(eq(employees.id,r.approverId),eq(employees.role,'manager'),eq(employees.active,true)));
  if(!actor||actor.deletedAt||!r.approval.trim())fail('Approved Manager and written authorization required.');
  const [warehouse]=await tx.select().from(warehouses).where(and(eq(warehouses.id,r.warehouseId),eq(warehouses.kind,'stock'),eq(warehouses.active,true)));
  if(!warehouse||warehouse.name!==r.warehouseName||order.warehouseId&&order.warehouseId!==r.warehouseId)fail('Warehouse differs from explicit approval.');
  const lines=await tx.select().from(salesOrderLines).where(eq(salesOrderLines.orderId,r.orderId));
  if(lines.length!==r.lines.length||lines.some(l=>!r.lines.some(x=>x.id===l.id&&x.sku===l.sku&&x.qty===l.qty)||!(l.qty>0)||Math.abs(l.deliveredQty-l.qty)>0.0005))fail('Approved line snapshot or delivered quantities changed.');
  const [audit]=await tx.select().from(auditLogs).where(and(eq(auditLogs.module,'support_automation'),eq(auditLogs.action,'approved_legacy_stock_export'),eq(auditLogs.entityId,r.orderId)));
  const physical=(await crmStockFulfilment(d,[r.orderId])).get(r.orderId);
  if(audit){const saved=JSON.parse(audit.data);if(saved.requestKey!==r.requestKey||saved.warehouseId!==r.warehouseId||!physical?.complete)fail('Existing reconciliation requires review.');return {applied:false,replayed:true,orderNo:r.orderNo,moves:0};}
  if(order.revision!==r.revision||physical?.lines.some(l=>l.issued>0))fail('Revision changed or prior physical issue exists; do not post again.');
  if((await tx.select({id:packingSlips.id}).from(packingSlips).where(and(eq(packingSlips.orderId,r.orderId),ne(packingSlips.status,'cancelled')))).length)fail('Existing source plan must be reconciled first.');
  if((await tx.select({id:posReturns.id}).from(posReturns).where(eq(posReturns.orderId,r.orderId))).length)fail('Return/re-delivery requires separate reconciliation.');
  const trips=await tx.select().from(deliveries).where(and(eq(deliveries.orderId,r.orderId),ne(deliveries.status,'cancelled')));
  if(!trips.length||trips.some(t=>t.status!=='delivered'||!t.deliveredAt))fail('All delivery documents must be completed.');
  const sent=await tx.select().from(deliveryLines).where(inArray(deliveryLines.deliveryId,trips.map(t=>t.id)));
  if(lines.some(l=>Math.abs(sent.filter(x=>x.orderLineId===l.id).reduce((n,x)=>n+x.qty,0)-l.qty)>0.0005))fail('Delivery line coverage differs.');
  const adjustments=await tx.select().from(inventoryAdjustments).where(and(eq(inventoryAdjustments.status,'approved'),sql`(${inventoryAdjustments.reason} ilike ${'%'+r.orderNo+'%'} or ${sql.join(trips.map(t=>sql`${inventoryAdjustments.reason} ilike ${'%'+t.deliveryNo+'%'}`),sql` or `)})`));
  if(adjustments.length)fail('Related approved adjustment exists; do not issue twice.');
  await lockLedger(d);await assertWarehousesOpened(d,[r.warehouseId]);
  await assertFreeStock(d,r.warehouseId,lines,{exceptOrderId:r.orderId,actor,context:{module:'support_automation',entityType:'sales_order',entityId:r.orderId,refNo:r.orderNo}});
  const before=await tx.select().from(stockBalances).where(and(eq(stockBalances.warehouseId,r.warehouseId),inArray(stockBalances.sku,lines.map(l=>l.sku))));
  const plan={orderNo:r.orderNo,warehouse:r.warehouseName,lines:lines.map(l=>({sku:l.sku,qty:l.qty,before:before.find(b=>b.sku===l.sku)?.qty??0,after:(before.find(b=>b.sku===l.sku)?.qty??0)-l.qty}))};
  if(!apply)return {applied:false,replayed:false,moves:0,...plan};
  await tx.update(salesOrders).set({warehouseId:r.warehouseId,revision:sql`${salesOrders.revision}+1`,updatedAt:now}).where(eq(salesOrders.id,r.orderId));
  const moves=await syncSaleMoves(d,r.approverId,{id:r.orderId,no:r.orderNo,warehouseId:r.warehouseId,active:true},lines,'Xuất bổ sung đã đối soát · '+r.orderNo+' · '+r.approval,now);
  await consumeOrderHolds(d,r.orderId,lines.map(l=>({orderLineId:l.id,qty:l.qty})),now);
  const after=(await crmStockFulfilment(d,[r.orderId])).get(r.orderId),progress=(await progressOf(d,[r.orderId])).get(r.orderId);
  if(!after?.complete||!progress?.done||progress.reconciliationRequired)fail('Physical issue/progress verification failed; transaction rolled back.');
  await tx.insert(auditLogs).values({id:crypto.randomUUID(),actorId:r.approverId,module:'support_automation',action:'approved_legacy_stock_export',entityType:'sales_order',entityId:r.orderId,createdAt:now,data:JSON.stringify({version:1,executor:'codex_support_automation',approvalSource:'owner_chat',approval:r.approval,requestKey:r.requestKey,warehouseId:r.warehouseId,originalRevision:r.revision,originalStatus:order.status,lines:r.lines,plan,moves})});
  return {applied:true,replayed:false,moves,progressDone:progress.done,...plan};
 });
}
