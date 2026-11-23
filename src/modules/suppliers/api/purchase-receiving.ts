import {and,eq,isNull,sql} from 'drizzle-orm';
import {AppError} from '../../../core/errors.ts';
import {incomingShipments} from '../schema.ts';
import {warehouses} from '../../catalog/schema.ts';
import {warehouseSellers} from '../../inventory/schema.ts';
import {purchaseReceivingHooks} from '../../../core/contracts/purchase-receiving.ts';
import {canReceive,isWarehouseStaff} from '../domain/purchasing.ts';
import {loadPurchase,type Db,type Member} from './purchase-store.ts';

/** Warehouse staff get an operational projection, never the commercial purchase DTO. */
export function warehouseReceivingScope(m:Member){
 if(!m.active||!isWarehouseStaff(m)||!canReceive(m))return sql`false`;
 return and(eq(incomingShipments.source,'supplier-order'),eq(incomingShipments.approvalStatus,'approved'),isNull(incomingShipments.cancelledAt),sql`exists(select 1 from ${warehouses} w where w.active=true and w.kind='stock' and (w.id=${incomingShipments.warehouse} or w.name=${incomingShipments.warehouse}) and (
 exists(select 1 from ${warehouseSellers} ws where ws.warehouse_id=w.id and ws.position_id=${m.positionId}) or
 ${purchaseReceivingHooks.assigned?.(incomingShipments.id,m.id)??sql`false`}))`);
}
export async function receivingContext(db:Db,m:Member,id:string,today:string){
 if(!isWarehouseStaff(m)||!canReceive(m))throw new AppError(403,'Bạn không có quyền nhận hàng được giao.');
 const detail=await loadPurchase(db,m,id,today,warehouseReceivingScope(m)),o=detail.raw.order;
 const matches=await db.select({id:warehouses.id,name:warehouses.name}).from(warehouses).where(and(eq(warehouses.active,true),eq(warehouses.kind,'stock'),sql`(${warehouses.id}=${o.warehouse} or ${warehouses.name}=${o.warehouse})`)).limit(2);
 const w=matches.find(w=>w.id===o.warehouse)??(matches.length===1?matches[0]:undefined);
 if(!w)throw new AppError(404,'Không tìm thấy việc nhận hàng.');
 const v=detail.view;
 return {id:v.id,revision:v.revision,warehouse:w.name,warehouseId:w.id,actions:v.progress.missing>0?['receive']:[],progress:v.progress,
  lines:v.lines.map(l=>({id:l.id,sku:l.sku,name:l.name,unit:l.unit,quantity:l.quantity,good:l.good,damaged:l.damaged,missing:l.missing})),
  receipts:v.receipts.map(r=>({id:r.id,receiptNo:r.receiptNo,receivedDate:r.receivedDate,warehouse:r.warehouse,sapoStatus:r.sapoStatus,createSapo:r.createSapo}))};
}

/** Keep counters, previews and paginated queue on the same open-work predicate. */
export function warehouseOpenReceivingScope(m:Member){
 return and(warehouseReceivingScope(m),sql`exists(select 1 from incoming_shipment_lines pl where pl.shipment_id=${incomingShipments.id} and pl.quantity-pl.credited_qty > coalesce((select sum(rl.good_qty-rl.returned_good_qty) from supplier_receipt_lines rl join supplier_receipts r on r.id=rl.receipt_id where rl.line_id=pl.id and r.cancelled_at is null),0))`);
}
