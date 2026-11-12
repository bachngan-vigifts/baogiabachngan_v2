import {and,eq,inArray,sql} from 'drizzle-orm';
import {redeliveryByLine} from './crm-redelivery.ts';
import {AppError} from '../../../core/errors.ts';
import type {StaffEnv} from '../../staff/api/auth-routes.ts';
import {stockMoves} from '../../inventory/schema.ts';
import {salesOrders,salesOrderLines,packingSlips,packingSlipLines,deliveries,deliveryLines} from '../schema.ts';
type ReadDb=StaffEnv['db']|Parameters<Parameters<StaffEnv['db']['transaction']>[0]>[0];
const key=(...parts:(string|null)[])=>JSON.stringify(parts);
/** Physical proof, independent of approval, manual progress and delivery labels. Batched, never writes stock. */
export async function crmStockFulfilment(db:ReadDb,ids:readonly string[],options:{gross?:boolean}={}){
 const result=new Map<string,{orderId:string;orderNo:string;warehouseId:string|null;status:string;lines:{lineId:string;sku:string;needed:number;issued:number;missing:number}[];complete:boolean}>();
 if(!ids.length)return result;
 const [orders,lines,packed,plans,returned]=await Promise.all([
  db.select({id:salesOrders.id,no:salesOrders.orderNo,warehouseId:salesOrders.warehouseId,status:salesOrders.status})
   .from(salesOrders).where(and(inArray(salesOrders.id,[...ids]),eq(salesOrders.channel,'crm'))),
  db.select({id:salesOrderLines.id,orderId:salesOrderLines.orderId,sku:salesOrderLines.sku,qty:salesOrderLines.qty}).from(salesOrderLines).where(inArray(salesOrderLines.orderId,[...ids])),
  db.select({orderId:packingSlips.orderId,slipId:packingSlips.id,source:packingSlips.source,warehouseId:packingSlips.stockWarehouseId,by:packingSlips.packedBy,at:packingSlips.packedAt,
    lineId:packingSlipLines.orderLineId,sku:packingSlipLines.sku,qty:packingSlipLines.qty}).from(packingSlips).innerJoin(packingSlipLines,eq(packingSlipLines.slipId,packingSlips.id))
   .where(and(inArray(packingSlips.orderId,[...ids]),eq(packingSlips.status,'packed'))).orderBy(packingSlips.id,packingSlipLines.id),
  db.select({orderId:packingSlips.orderId}).from(packingSlips).where(and(inArray(packingSlips.orderId,[...ids]),sql`${packingSlips.status}<>'cancelled'`)),
  redeliveryByLine(db,ids),
 ]);
 const [issues,legacy]=await Promise.all([
  db.select({slipId:packingSlips.id,warehouseId:stockMoves.warehouseId,sku:stockMoves.sku,qty:sql<number>`greatest(0,-sum(${stockMoves.qty}))`.mapWith(Number)})
   .from(stockMoves).innerJoin(packingSlips,sql`${packingSlips.id}=split_part(${stockMoves.refId},'#',1)`).where(and(inArray(packingSlips.orderId,[...ids]),eq(stockMoves.refType,'packing_slip')))
   .groupBy(packingSlips.id,stockMoves.warehouseId,stockMoves.sku),
  db.select({orderId:salesOrders.id,warehouseId:stockMoves.warehouseId,sku:stockMoves.sku,qty:sql<number>`greatest(0,-sum(${stockMoves.qty}))`.mapWith(Number)})
   .from(stockMoves).innerJoin(salesOrders,sql`${stockMoves.refId}=${salesOrders.id} or ${stockMoves.refId} like ${salesOrders.id}||'#%'`)
   .where(and(inArray(salesOrders.id,[...ids]),eq(stockMoves.refType,'sales_order'))).groupBy(salesOrders.id,stockMoves.warehouseId,stockMoves.sku),
 ]);
 const issueLeft=new Map(issues.map(i=>[key(i.slipId,i.warehouseId,i.sku),i.qty]));
 const legacyLeft=new Map(legacy.map(i=>[key(i.orderId,i.warehouseId,i.sku),i.qty]));
 for(const o of orders){
  const expected=lines.filter(l=>l.orderId===o.id&&l.sku.trim()&&l.qty>0).map(l=>({lineId:l.id,sku:l.sku,needed:l.qty+(returned.get(l.id)?.issued??0),issued:0,missing:l.qty+(returned.get(l.id)?.issued??0)}));
  const byLine=new Map(expected.map(l=>[l.lineId,l]));
  for(const p of packed.filter(p=>p.orderId===o.id)){
   const line=p.lineId?byLine.get(p.lineId):undefined;
   if(!line||line.sku!==p.sku||!p.by||!p.at||!(p.qty>0))continue;
   // Origin (supplier/agent/store/other) never substitutes a physical warehouse issue.
   if(!p.warehouseId||(o.warehouseId&&p.warehouseId!==o.warehouseId))continue;
   const own=key(p.slipId,p.warehouseId,p.sku),old=key(o.id,p.warehouseId,p.sku);
   const used=Math.min(p.qty,issueLeft.get(own)??0);issueLeft.set(own,(issueLeft.get(own)??0)-used);
   const oldUsed=Math.min(p.qty-used,legacyLeft.get(old)??0);legacyLeft.set(old,(legacyLeft.get(old)??0)-oldUsed);
   const valid=used+oldUsed;
   line.issued=Math.min(line.needed,line.issued+valid);line.missing=Math.max(0,line.needed-line.issued);
  }
  // Old orders issued directly against sales_order before packing was introduced.
  // Their real net ledger entries are proof; never post them again or infer a warehouse.
  for(const line of expected)if(!plans.some(p=>p.orderId===o.id)||(returned.get(line.lineId)?.issued??0)>0)for(const issue of legacy.filter(i=>i.orderId===o.id&&i.sku===line.sku&&(!o.warehouseId||i.warehouseId===o.warehouseId))){
   const k=key(o.id,issue.warehouseId,line.sku),take=Math.min(line.missing,legacyLeft.get(k)??0);
   legacyLeft.set(k,(legacyLeft.get(k)??0)-take);line.issued+=take;line.missing=Math.max(0,line.needed-line.issued);
  }
  for(const line of expected){const retired=returned.get(line.lineId)?.issued??0;line.needed-=retired;if(!options.gross)line.issued=Math.max(0,line.issued-retired);line.missing=Math.max(0,line.needed-line.issued);}
  result.set(o.id,{orderId:o.id,orderNo:o.no,warehouseId:o.warehouseId,status:o.status,lines:expected,complete:expected.length>0&&expected.every(l=>l.missing<=0.0005)});
 }
 return result;
}
/** Final order completion has the same physical dependency as an individual dispatch.
 * Never infer an issue from delivered quantities or create inventory movements here.
 * Caller holds the order lock and commits delivery/quantities/status in one transaction.
 */
export async function assertCrmOrderCompletion(db:ReadDb,orderId:string){
 const state=(await crmStockFulfilment(db,[orderId])).get(orderId);
 if(!state?.lines.length)return;
 if(['draft','cancelled'].includes(state.status))throw new AppError(409,'Duyệt đơn / HĐKT trước khi hoàn thành giao hàng.','ORDER_NOT_APPROVED');
 if(!state.complete)throw new AppError(409,'Chưa xác nhận xuất đủ hàng đúng kho/nguồn. Xác nhận phiếu xuất trước khi hoàn thành giao hàng.','STOCK_NOT_PACKED');
}
/** Caller locks the order. Every CRM delivery must have enough real, confirmed source coverage. */
export async function assertCrmDispatch(db:ReadDb,orderId:string,deliveryId:string){
 const state=(await crmStockFulfilment(db,[orderId])).get(orderId);if(!state)return;
 if(['draft','cancelled'].includes(state.status))throw new AppError(409,'Duyệt đơn / HĐKT trước khi giao hàng.','ORDER_NOT_APPROVED');
 const needed=await db.select({lineId:deliveryLines.orderLineId,qty:sql<number>`sum(${deliveryLines.qty})`.mapWith(Number),completed:sql<number>`coalesce(sum(${deliveryLines.qty}) filter (where ${deliveries.status}='delivered'),0)`.mapWith(Number)})
  .from(deliveryLines).innerJoin(deliveries,eq(deliveries.id,deliveryLines.deliveryId))
  .where(and(eq(deliveries.orderId,orderId),sql`(${deliveries.id}=${deliveryId} or ${deliveries.status} in ('in_transit','delivered','failed'))`)).groupBy(deliveryLines.orderLineId);
 const returned=await redeliveryByLine(db,[orderId]);
 const missing=needed.flatMap(n=>{const line=state.lines.find(l=>l.lineId===n.lineId);return line&&line.issued+0.0005<n.qty-Math.min(n.completed,returned.get(n.lineId)?.qty??0)?[line.sku]:[];});
 if(missing.length)throw new AppError(409,'Chưa xác nhận xuất đủ hàng đúng kho/nguồn cho chuyến giao: '+[...new Set(missing)].join(', ')+'. Xác nhận phiếu xuất trước khi bàn giao hoặc đánh dấu đã giao.','STOCK_NOT_PACKED');
}
