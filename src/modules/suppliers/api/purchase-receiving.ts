import {and,eq,isNull,sql} from 'drizzle-orm';
import {AppError} from '../../../core/errors.ts';
import {incomingShipments} from '../schema.ts';
import {warehouses} from '../../catalog/schema.ts';
import {warehouseSellers} from '../../inventory/schema.ts';
import {canReceive,isWarehouseStaff} from '../domain/purchasing.ts';
import {loadPurchase,type Db,type Member} from './purchase-store.ts';

/** Warehouse staff get an operational projection, never the commercial purchase DTO. */
export function warehouseReceivingScope(m:Member){
 if(!m.active||!isWarehouseStaff(m)||!canReceive(m))return sql`false`;
 return and(eq(incomingShipments.source,'supplier-order'),eq(incomingShipments.approvalStatus,'approved'),isNull(incomingShipments.cancelledAt),sql`(${incomingShipments.receivingWarehouseId} IS NULL OR exists(select 1 from ${warehouses} w join ${warehouseSellers} ws on ws.warehouse_id=w.id where w.id=${incomingShipments.receivingWarehouseId} and w.active=true and w.kind='stock' and ws.position_id=${m.positionId}))`);
}
export async function receivingContext(db:Db,m:Member,id:string,today:string){
 if(!isWarehouseStaff(m)||!canReceive(m))throw new AppError(403,'Bạn không có quyền nhận hàng được giao.');
 const detail=await loadPurchase(db,m,id,today,warehouseReceivingScope(m)),o=detail.raw.order;
 const options=await db.select({id:warehouses.id,name:warehouses.name}).from(warehouses).where(and(eq(warehouses.active,true),eq(warehouses.kind,'stock'),sql`exists(select 1 from ${warehouseSellers} ws where ws.warehouse_id=${warehouses.id} and ws.position_id=${m.positionId})`,o.receivingWarehouseId?eq(warehouses.id,o.receivingWarehouseId):undefined)).orderBy(warehouses.name,warehouses.id);
 const w=options.find(w=>w.id===o.receivingWarehouseId);
 const v=detail.view;
 return {id:v.id,revision:v.revision,warehouse:w?.name??'Chưa chọn kho nhận',warehouseId:w?.id??null,warehouseOptions:options,actions:v.progress.missing>0?['receive']:[],progress:v.progress,
  lines:v.lines.map(l=>({id:l.id,sku:l.sku,name:l.name,unit:l.unit,quantity:l.quantity,good:l.good,damaged:l.damaged,missing:l.missing})),
  receipts:v.receipts.map(r=>({id:r.id,receiptNo:r.receiptNo,receivedDate:r.receivedDate,warehouse:r.warehouse,sapoStatus:r.sapoStatus,createSapo:r.createSapo}))};
}

/** Keep counters, previews and paginated queue on the same open-work predicate. */
export function warehouseOpenReceivingScope(m:Member){
 return and(warehouseReceivingScope(m),sql`exists(select 1 from incoming_shipment_lines pl where pl.shipment_id=${incomingShipments.id} and pl.quantity-pl.credited_qty > coalesce((select sum(rl.good_qty-rl.returned_good_qty) from supplier_receipt_lines rl join supplier_receipts r on r.id=rl.receipt_id where rl.line_id=pl.id and r.cancelled_at is null),0))`);
}

/** Validate structured destination independently of the free-text delivery address. Caller holds the parent transaction. */
export async function validateReceivingWarehouse(db:Db,value:unknown):Promise<string|null>{
 if(value===null||value===undefined||value==='')return null;
 if(typeof value!=='string'||value.length>200)throw new AppError(400,'Kho nhận không hợp lệ.');
 const [w]=await db.select({id:warehouses.id}).from(warehouses).where(and(eq(warehouses.id,value),eq(warehouses.active,true),eq(warehouses.kind,'stock'))).for('share');
 if(!w)throw new AppError(400,'Chọn kho nhận là kho thật đang hoạt động.');return w.id;
}
export async function receivingDestination(db:Db,m:Member,id:string,name:string,today:string){
 const context=await receivingContext(db,m,id,today);
 const matches=await db.select({id:warehouses.id,name:warehouses.name}).from(warehouses).where(and(eq(warehouses.active,true),eq(warehouses.kind,'stock'),eq(warehouses.name,name))).limit(2);
 if(matches.length!==1||!context.warehouseOptions.some(w=>w.id===matches[0]!.id))throw new AppError(404,'Không tìm thấy việc nhận hàng tại kho này.');
 return matches[0]!.id;
}
