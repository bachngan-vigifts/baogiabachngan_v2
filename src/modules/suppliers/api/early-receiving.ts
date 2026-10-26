import { and, eq, inArray, isNull } from 'drizzle-orm';
import { AppError } from '../../../core/errors.ts';
import { purchaseEarlyRequests, purchaseEarlyRequestLines, purchaseEarlyRequestAllocations } from '../early-request-schema.ts';
import { incomingShipments, incomingShipmentLines, supplierReceipts, supplierReceiptLines, supplierOrderEvents } from '../schema.ts';
import type { Db } from './purchase-store.ts';
type ReadDb = Db | Parameters<Parameters<Db['transaction']>[0]>[0];
/** Receipt provenance lives in the existing receive event, in the receipt transaction. No second receipt/stock path. */
export async function earlyReceiptAvailability(db: ReadDb, requestIds: string[]) {
  if (!requestIds.length) return [];
  const rows = await db.select({requestId:purchaseEarlyRequests.id,requestStatus:purchaseEarlyRequests.status,
    allocationId:purchaseEarlyRequestAllocations.id,status:purchaseEarlyRequestAllocations.status,quantity:purchaseEarlyRequestAllocations.quantity,
    purchaseLineId:incomingShipmentLines.id,sku:incomingShipmentLines.sku,name:incomingShipmentLines.name,ordered:incomingShipmentLines.quantity,
    orderId:incomingShipments.id,ticketNumber:incomingShipments.ticketNumber,approvalStatus:incomingShipments.approvalStatus,cancelledAt:incomingShipments.cancelledAt})
    .from(purchaseEarlyRequests).innerJoin(purchaseEarlyRequestLines,eq(purchaseEarlyRequestLines.requestId,purchaseEarlyRequests.id))
    .innerJoin(purchaseEarlyRequestAllocations,eq(purchaseEarlyRequestAllocations.requestLineId,purchaseEarlyRequestLines.id))
    .innerJoin(incomingShipmentLines,eq(incomingShipmentLines.id,purchaseEarlyRequestAllocations.purchaseLineId))
    .innerJoin(incomingShipments,eq(incomingShipments.id,incomingShipmentLines.shipmentId))
    .where(and(isNull(purchaseEarlyRequests.deletedAt),inArray(purchaseEarlyRequests.id,requestIds)));
  const orders=[...new Set(rows.map(r=>r.orderId))];
  if(!orders.length)return [];
  const [receipts,events]=await Promise.all([
    db.select({id:supplierReceipts.id,cancelledAt:supplierReceipts.cancelledAt}).from(supplierReceipts).where(inArray(supplierReceipts.shipmentId,orders)),
    db.select({data:supplierOrderEvents.data}).from(supplierOrderEvents).where(and(inArray(supplierOrderEvents.shipmentId,orders),eq(supplierOrderEvents.action,'receive'))),
  ]);
  const receiptIds=receipts.filter(r=>!r.cancelledAt).map(r=>r.id);
  const received=receiptIds.length?await db.select({receiptId:supplierReceiptLines.receiptId,lineId:supplierReceiptLines.lineId,goodQty:supplierReceiptLines.goodQty})
    .from(supplierReceiptLines).where(inArray(supplierReceiptLines.receiptId,receiptIds)):[];
  const provenance=new Map<string,string>();
  for(const event of events){try{const d=JSON.parse(event.data);if(typeof d.receiptId==='string'&&typeof d.earlyRequestId==='string')provenance.set(d.receiptId,d.earlyRequestId);}catch{/* Older unstructured event. */}}
  const totals=new Map<string,number>(),ownTotals=new Map<string,number>();
  for(const r of received){totals.set(r.lineId,(totals.get(r.lineId)??0)+r.goodQty);const requestId=provenance.get(r.receiptId);
    if(requestId){const key=requestId+':'+r.lineId;ownTotals.set(key,(ownTotals.get(key)??0)+r.goodQty);}}
  return rows.map(row=>{
    const total=totals.get(row.purchaseLineId)??0;
    const own=ownTotals.get(row.requestId+':'+row.purchaseLineId)??0;
    const remaining=row.requestStatus==='submitted'&&row.status==='accepted'&&row.approvalStatus==='approved'&&!row.cancelledAt
      ?Math.max(0,Math.min(row.quantity-own,row.ordered-total)):0;
    return {...row,receivedQty:own,remaining};
  });
}
export async function earlyReceiptContext(db: ReadDb, requestId: string, orderId: string) {
  const all=await earlyReceiptAvailability(db,[requestId]);
  if(!all.length)throw new AppError(404,'Không tìm thấy phiếu xin lấy trước.');
  const lines=all.filter(r=>r.orderId===orderId&&r.remaining>0);
  if(!lines.length)throw new AppError(409,'Phiếu chưa được đồng ý, đơn mua chưa duyệt/đã huỷ hoặc đã nhận đủ phần xin lấy trước.');
  return {requestId,orderId,ticketNumber:lines[0]!.ticketNumber,lines:lines.map(r=>({lineId:r.purchaseLineId,sku:r.sku,name:r.name,remaining:r.remaining}))};
}
