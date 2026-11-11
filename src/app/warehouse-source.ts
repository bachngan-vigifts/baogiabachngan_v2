import {and,eq,or,isNull,sql} from 'drizzle-orm';
import type {AnyDb} from '../core/db/client.ts';
import type {WarehouseSource,WarehouseSourceTask} from '../core/contracts/warehouse-source.ts';
import {packingSlips,salesOrders,deliveries} from '../modules/sales/schema.ts';
import {posShifts,posRegisters} from '../modules/sales/pos-schema.ts';
import {stockTransfers} from '../modules/inventory/schema.ts';
import {incomingShipments,incomingShipmentLines,supplierReceipts,supplierReceiptLines} from '../modules/suppliers/schema.ts';
import {purchaseEarlyRequests} from '../modules/suppliers/early-request-schema.ts';
import {earlyReceiptAvailability} from '../modules/suppliers/api/early-receiving.ts';
import {sapoInventoryDocs} from '../modules/integrations/schema.ts';
import {warehouses} from '../modules/catalog/schema.ts';
const warehouse=async(db:AnyDb,value:string)=>{const [w]=await db.select({id:warehouses.id}).from(warehouses).where(and(eq(warehouses.active,true),eq(warehouses.kind,'stock'),or(eq(warehouses.id,value),eq(warehouses.name,value)))).limit(1);return w?.id??null;};
export async function resolveWarehouseSource(db:AnyDb,t:WarehouseSourceTask):Promise<WarehouseSource|null>{
 const key=t.autoKey||'';if(!t.sourceId||!key)return null;
 let warehouseId:string|null=null,kind:WarehouseSource['kind']='receiving',complete=false,cancelled=false,operationKey=key;
 if(key.startsWith('slip:')){
  const [p]=await db.select().from(packingSlips).where(eq(packingSlips.id,t.sourceId));if(!p)return null;
  const [o]=await db.select().from(salesOrders).where(eq(salesOrders.id,p.orderId));if(!o)return null;
  warehouseId=o.warehouseId;kind='packing';complete=p.status==='packed';cancelled=p.status==='cancelled'||o.status==='cancelled';
  if(!warehouseId&&o.shiftId){const [r]=await db.select({warehouseId:posRegisters.warehouseId}).from(posShifts).innerJoin(posRegisters,eq(posRegisters.id,posShifts.registerId)).where(eq(posShifts.id,o.shiftId));warehouseId=r?.warehouseId??null;}
 }else if(key.startsWith('pack:')){
  const [d]=await db.select().from(deliveries).where(eq(deliveries.id,key.slice(5)));if(!d)return null;
  const [o]=await db.select().from(salesOrders).where(eq(salesOrders.id,d.orderId));if(!o)return null;
  warehouseId=o.warehouseId;kind='packing';complete=['in_transit','delivered'].includes(d.status);cancelled=['cancelled','failed'].includes(d.status)||o.status==='cancelled';
 }else if(/^transfer-(move|receive):/.test(key)){
  const [p]=await db.select().from(stockTransfers).where(eq(stockTransfers.id,t.sourceId));if(!p)return null;
  const receive=key.startsWith('transfer-receive:');warehouseId=receive?p.toWarehouseId:p.fromWarehouseId;kind='transfer';complete=(receive?['done']:['shipped','done']).includes(p.status);cancelled=['cancelled','rejected'].includes(p.status);
  operationKey=`transfer-${receive?'receive':'move'}:${p.id}`;
 }else if(key.startsWith('purchase:')){
  const [p]=await db.select().from(sapoInventoryDocs).where(eq(sapoInventoryDocs.id,t.sourceId));if(!p)return null;
  warehouseId=await warehouse(db,p.locationName);complete=/(complet|finish|received|closed|hoàn)/i.test(p.status);cancelled=/(cancel|huỷ|hủy)/i.test(p.status);
 }else if(/^receiving-due:early:/.test(key)){
  const [p]=await db.select().from(purchaseEarlyRequests).where(eq(purchaseEarlyRequests.id,t.sourceId));if(!p)return null;
  const rows=await earlyReceiptAvailability(db,[p.id]),orderIds=[...new Set(rows.map(r=>r.orderId))];
  const orders=orderIds.length?await db.select({warehouse:incomingShipments.warehouse}).from(incomingShipments).where(sql`${incomingShipments.id} in (${sql.join(orderIds.map(id=>sql`${id}`),sql`,`)})`):[];
  const locations=[...new Set(orders.map(o=>o.warehouse))];if(locations.length!==1)return null;
  warehouseId=await warehouse(db,locations[0]!);complete=rows.length>0&&rows.every(r=>r.remaining===0&&r.status==='accepted');cancelled=!!p.deletedAt||p.status!=='submitted';
  operationKey=key.slice(0,key.lastIndexOf(':'));
 }else if(/^(receiving-due:purchase:|po-receive:|po-sapo:)/.test(key)){
  const [p]=await db.select().from(incomingShipments).where(eq(incomingShipments.id,t.sourceId));if(!p)return null;
  warehouseId=await warehouse(db,p.warehouse);cancelled=!!p.cancelledAt;
  if(key.startsWith('po-sapo:')){const rows=await db.select({status:supplierReceipts.sapoStatus}).from(supplierReceipts).where(and(eq(supplierReceipts.shipmentId,p.id),isNull(supplierReceipts.cancelledAt)));complete=rows.length>0&&rows.every(r=>['done','not_needed'].includes(r.status));}
  else{const date=key.startsWith('receiving-due:')?key.split(':')[4]:null;
   const lines=await db.select({qty:incomingShipmentLines.quantity,good:sql<number>`coalesce((select sum(good_qty) from supplier_receipt_lines rl join supplier_receipts rp on rp.id=rl.receipt_id where rl.line_id=${incomingShipmentLines.id} and rp.cancelled_at is null),0)`.mapWith(Number)}).from(incomingShipmentLines).where(and(eq(incomingShipmentLines.shipmentId,p.id),date?sql`coalesce(nullif(${incomingShipmentLines.promisedDate},''),${p.arrivalDate})=${date}`:undefined));
   complete=lines.length>0&&lines.every(l=>l.good>=l.qty);
  }
  operationKey=key.startsWith('receiving-due:')?key.slice(0,key.lastIndexOf(':')):key;
 }else return null;
 if(!warehouseId)return null;const active=await warehouse(db,warehouseId);if(!active)return null;
 return{operationKey,warehouseId:active,kind,complete,cancelled};
}
