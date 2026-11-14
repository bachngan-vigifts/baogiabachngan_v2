import {and,eq,gt,inArray,ne,sql} from 'drizzle-orm';
import type {StockPendingOf,StockPendingQuantity} from '../core/contracts/stock-pending.ts';
import {packingSlips,packingSlipLines,salesOrders,salesOrderLines,deliveries,deliveryLines,stockHolds} from '../modules/sales/schema.ts';
import {posReturns,posReturnLines} from '../modules/sales/return-schema.ts';
import {posRegisters,posShifts} from '../modules/sales/pos-schema.ts';
import {stockMoves} from '../modules/inventory/schema.ts';
import {orderHolds} from '../modules/sales/api/hold-routes.ts';
const stamp=(s:string)=>s==='9999'?Infinity:Date.parse(s);
const key=(...parts:(string|null)[])=>JSON.stringify(parts),round=(n:number)=>Math.round(Math.max(0,n)*1000)/1000;
type Pack={lineId:string|null;orderId:string;sku:string;warehouseId:string|null;qty:number;at:string|null;delivered:number;orderStatus:string};
type Success={lineId:string;qty:number;at:string};
type Return={lineId:string;orderId:string;sku:string;warehouseId:string;context:string;qty:number;receivedQty:number;receivedAt:string|null;status:string};
type Back={lineId:string;orderId:string;sku:string;warehouseId:string|null;qty:number};
type Hold={orderId?:string;sku:string;warehouseId:string|null;qty:number};
type Issue={orderId:string;sku:string;warehouseId:string;qty:number};
/** Read-only physical buckets. Never infer a historical pending balance from today's state. */
export function projectStockPending(packs:Pack[],success:Success[],returns:Return[],backs:Back[],holds:Hold[],issues:Issue[],visible:string[]):StockPendingQuantity[]{
 backs=backs.map(b=>({...b}));
 const allowed=new Set(visible),result=new Map<string,StockPendingQuantity>(),physical=new Map<string,number>();
 const cell=(sku:string,warehouseId:string)=>{const k=key(sku,warehouseId);let c=result.get(k);if(!c){c={sku,warehouseId,packed:0,returning:0,held:0,unassignedHeld:0,uncertain:false};result.set(k,c);}return c;};
 const addPhysical=(orderId:string,sku:string,warehouseId:string|null,qty:number)=>{if(warehouseId)physical.set(key(orderId,sku,warehouseId),(physical.get(key(orderId,sku,warehouseId))??0)+qty);};
 const lots=new Map<string,Pack[]>();
 for(const p of packs){if(!p.lineId||!p.at||!Number.isFinite(stamp(p.at))||!p.warehouseId){if(p.warehouseId&&allowed.has(p.warehouseId))cell(p.sku,p.warehouseId).uncertain=true;continue;}const list=lots.get(p.lineId)||[];list.push({...p});lots.set(p.lineId,list);}
 const grouped=<T>(rows:T[],id:(row:T)=>string)=>{const map=new Map<string,T[]>();for(const row of rows){const k=id(row),items=map.get(k)||[];items.push(row);map.set(k,items);}return map;};
 const successes=grouped(success,s=>s.lineId),returnsByLine=grouped(returns,r=>r.lineId),backsByLine=grouped(backs,b=>b.lineId);
 for(const b of backs)if(!b.warehouseId){const warehouses=[...new Set((lots.get(b.lineId)||[]).map(p=>p.warehouseId).filter((w):w is string=>!!w))];if(warehouses.length===1)b.warehouseId=warehouses[0]!;}
 const doneByKey=new Map<string,number>();for(const [lineId,list]of lots){const warehouses=[...new Set(list.map(p=>p.warehouseId))];if(warehouses.length===1&&warehouses[0]){const k=key(list[0]!.orderId,list[0]!.sku,warehouses[0]);doneByKey.set(k,(doneByKey.get(k)??0)+(successes.get(lineId)||[]).reduce((n,s)=>n+s.qty,0));}}
 const receivedIssue=new Map<string,number>();
 for(const r of returns)if(r.receivedAt&&r.context==='after_issue')receivedIssue.set(r.lineId,(receivedIssue.get(r.lineId)??0)+r.receivedQty);
 for(const [lineId,list]of lots){
  const uncertain=new Set<string>();
  const consume=(qty:number,at:string)=>{
   if(!(qty>0))return;
   const when=stamp(at);if(Number.isNaN(when)){for(const p of list)if(p.warehouseId)uncertain.add(p.warehouseId);return;}
   const eligible=list.filter(p=>p.qty>0&&stamp(p.at!)<=when),warehouses=new Set(eligible.map(p=>p.warehouseId));
   if(warehouses.size>1&&qty<eligible.reduce((n,p)=>n+p.qty,0)-0.0005){for(const w of warehouses)if(w)uncertain.add(w);}
   for(const p of eligible.sort((a,b)=>stamp(a.at!)-stamp(b.at!))){const take=Math.min(qty,p.qty);p.qty-=take;qty-=take;if(qty<=0)break;}
  };
  const events=[...(successes.get(lineId)||[]),...(returnsByLine.get(lineId)||[]).filter(r=>r.receivedAt&&r.context==='after_issue').map(r=>({qty:r.receivedQty,at:r.receivedAt!}))].sort((a,b)=>stamp(a.at)-stamp(b.at));
  for(const e of events)consume(e.qty,e.at);
  const delivered=list[0]!.delivered,documented=(successes.get(lineId)||[]).reduce((n,s)=>n+s.qty,0);
  if(delivered>documented+0.0005)for(const p of list)if(p.warehouseId)uncertain.add(p.warehouseId);
  // A failed delivery return is the same unit as a pending after-issue request, never two buckets.
  const afterIssue=(returnsByLine.get(lineId)||[]).filter(r=>!r.receivedAt&&r.context==='after_issue'&&['pending','approved','processing'].includes(r.status)).reduce((n,r)=>n+r.qty,0);
  const ghn=Math.max(0,(backsByLine.get(lineId)||[]).reduce((n,b)=>n+b.qty,0)-(receivedIssue.get(lineId)??0));
  consume(Math.max(afterIssue,ghn),'9999');if(list.every(p=>p.qty<=0.0005))uncertain.clear();
  for(const p of list){if(!p.warehouseId||['delivered','cancelled'].includes(p.orderStatus))continue;if(uncertain.has(p.warehouseId)){if(allowed.has(p.warehouseId))cell(p.sku,p.warehouseId).uncertain=true;continue;}addPhysical(p.orderId,p.sku,p.warehouseId,p.qty);if(allowed.has(p.warehouseId))cell(p.sku,p.warehouseId).packed+=p.qty;}
 }
 const explicitIssue=new Map<string,number>();
 for(const r of returns){if(r.receivedAt||r.context==='before_fulfillment'||!['pending','approved','processing'].includes(r.status))continue;
  if(allowed.has(r.warehouseId))cell(r.sku,r.warehouseId).returning+=r.qty;
  if(r.context==='after_issue'){const k=r.lineId;explicitIssue.set(k,(explicitIssue.get(k)??0)+r.qty);addPhysical(r.orderId,r.sku,r.warehouseId,r.qty);}
 }
 const receivedByOrderSku=new Map<string,number>();for(const r of returns)if(r.receivedAt&&r.context==='after_issue'){const k=r.lineId;receivedByOrderSku.set(k,(receivedByOrderSku.get(k)??0)+r.receivedQty);}
 const backGroups=new Map<string,Back>();
 for(const b of backs){const k=b.lineId;const old=backGroups.get(k);if(old){old.qty+=b.qty;if(old.warehouseId!==b.warehouseId)old.warehouseId=null;}else backGroups.set(k,{...b});}
 for(const [k,b]of backGroups){
  const received=receivedByOrderSku.get(k)??0;
  const qty=Math.max(0,b.qty-received-(explicitIssue.get(k)??0));if(b.warehouseId){if(allowed.has(b.warehouseId))cell(b.sku,b.warehouseId).returning+=qty;addPhysical(b.orderId,b.sku,b.warehouseId,qty);}
 }
 const issued=new Map<string,number>();for(const i of issues)issued.set(key(i.orderId,i.sku,i.warehouseId),(issued.get(key(i.orderId,i.sku,i.warehouseId))??0)+i.qty);
 const overlap=new Map<string,number>();
 for(const [k,qty]of physical)overlap.set(k,Math.max(0,qty-Math.max(0,(issued.get(k)??0)-(doneByKey.get(k)??0))));

 const sumByOrderSku=(map:Map<string,number>)=>{const out=new Map<string,number>();for(const [k,n]of map){const [orderId,sku]=JSON.parse(k) as string[];const id=key(orderId!,sku!);out.set(id,(out.get(id)??0)+n);}return out;};
 const physicalTotal=sumByOrderSku(physical),issuedTotal=sumByOrderSku(issued),doneTotal=sumByOrderSku(doneByKey),overlapTotal=new Map<string,number>(),receivedTotal=new Map<string,number>();
 for(const r of returns)if(r.context==='after_issue'&&r.receivedAt){const k=key(r.orderId,r.sku);receivedTotal.set(k,(receivedTotal.get(k)??0)+r.receivedQty);}
 for(const [k,qty]of physicalTotal)overlapTotal.set(k,Math.max(0,qty-Math.max(0,(issuedTotal.get(k)??0)-(doneTotal.get(k)??0)-(receivedTotal.get(k)??0))));
 const unassigned=new Map<string,number>(),assigned:Hold[]=[];
 for(const h of holds){if(h.warehouseId===null)unassigned.set(h.sku,(unassigned.get(h.sku)??0)+h.qty);else assigned.push({...h});}
 // Retire matching warehouse reservations first, then any remaining overlap when return-to differs from source.
 for(const h of assigned){const k=key(h.orderId??'',h.sku,h.warehouseId),global=key(h.orderId??'',h.sku),take=Math.min(h.qty,overlap.get(k)??0,overlapTotal.get(global)??0);h.qty-=take;overlap.set(k,(overlap.get(k)??0)-take);overlapTotal.set(global,(overlapTotal.get(global)??0)-take);}
 for(const h of assigned){const k=key(h.orderId??'',h.sku),take=Math.min(h.qty,overlapTotal.get(k)??0);overlapTotal.set(k,(overlapTotal.get(k)??0)-take);if(h.warehouseId&&allowed.has(h.warehouseId))cell(h.sku,h.warehouseId).held+=Math.max(0,h.qty-take);}

 for(const c of result.values()){c.packed=round(c.packed);c.returning=round(c.returning);c.held=round(c.held);c.unassignedHeld=round(unassigned.get(c.sku)??0);}
 // One informational sentinel per SKU; never allocate an unassigned hold to any warehouse.
 for(const [sku,qty]of unassigned)cell(sku,'').unassignedHeld=round(qty);
 return [...result.values()];
}

const readStockPending:StockPendingOf=async(db,skus,warehouseIds,at)=>{
 if(!skus.length||!warehouseIds.length)return [];
 const sellingWarehouse=sql<string|null>`coalesce(${salesOrders.warehouseId},${posRegisters.warehouseId})`;
 const [packs,success,returns,backs,orders,quotes]=await Promise.all([
  db.select({lineId:packingSlipLines.orderLineId,orderId:packingSlips.orderId,sku:packingSlipLines.sku,warehouseId:packingSlips.stockWarehouseId,qty:packingSlipLines.qty,at:packingSlips.packedAt,delivered:salesOrderLines.deliveredQty,orderStatus:salesOrders.status})
   .from(packingSlipLines).innerJoin(packingSlips,eq(packingSlips.id,packingSlipLines.slipId)).innerJoin(salesOrders,eq(salesOrders.id,packingSlips.orderId)).leftJoin(salesOrderLines,eq(salesOrderLines.id,packingSlipLines.orderLineId)).where(and(eq(packingSlips.status,'packed'),inArray(packingSlipLines.sku,skus))),
  db.select({lineId:deliveryLines.orderLineId,qty:deliveryLines.qty,at:sql<string>`coalesce(${deliveries.confirmedAt},${deliveries.deliveredAt},${deliveries.updatedAt})`}).from(deliveryLines).innerJoin(deliveries,eq(deliveries.id,deliveryLines.deliveryId)).innerJoin(salesOrderLines,eq(salesOrderLines.id,deliveryLines.orderLineId)).where(and(eq(deliveries.status,'delivered'),inArray(salesOrderLines.sku,skus))),
  db.select({lineId:posReturnLines.orderLineId,orderId:posReturns.orderId,sku:posReturnLines.sku,warehouseId:posReturns.warehouseId,context:posReturns.requestContext,qty:posReturnLines.requestedQty,receivedQty:posReturnLines.receivedQty,receivedAt:posReturns.receivedAt,status:posReturns.status})
   .from(posReturnLines).innerJoin(posReturns,eq(posReturns.id,posReturnLines.returnId)).where(and(inArray(posReturnLines.sku,skus),ne(posReturns.status,'cancelled'),ne(posReturns.status,'rejected'))),
  db.select({lineId:deliveryLines.orderLineId,orderId:deliveries.orderId,sku:salesOrderLines.sku,warehouseId:sellingWarehouse,qty:deliveryLines.qty}).from(deliveryLines).innerJoin(deliveries,eq(deliveries.id,deliveryLines.deliveryId)).innerJoin(salesOrderLines,eq(salesOrderLines.id,deliveryLines.orderLineId)).innerJoin(salesOrders,eq(salesOrders.id,deliveries.orderId)).leftJoin(posShifts,eq(posShifts.id,salesOrders.shiftId)).leftJoin(posRegisters,eq(posRegisters.id,posShifts.registerId)).where(and(eq(deliveries.trackingStatus,'returned'),ne(deliveries.status,'delivered'),ne(deliveries.status,'cancelled'),inArray(salesOrderLines.sku,skus))),
  orderHolds(db,skus,undefined,undefined,true),
  db.select({sku:stockHolds.sku,qty:sql<number>`sum(${stockHolds.qty})`.mapWith(Number)}).from(stockHolds).where(and(inArray(stockHolds.sku,skus),eq(stockHolds.status,'active'),gt(stockHolds.expiresAt,at),sql`not exists(select 1 from ${salesOrders} where ${salesOrders.quoteId}=${stockHolds.quoteId} and ${salesOrders.status}<>'cancelled')`)).groupBy(stockHolds.sku),
 ]);
 const orderIds=[...new Set([...packs.map(p=>p.orderId),...orders.map(o=>o.orderId)])];
 const issues:Issue[]=[];
 if(orderIds.length){
  const [packedIssues,deliveryIssues,directIssues]=await Promise.all([
   db.select({orderId:packingSlips.orderId,sku:stockMoves.sku,warehouseId:stockMoves.warehouseId,qty:sql<number>`-sum(${stockMoves.qty})`.mapWith(Number)}).from(stockMoves).innerJoin(packingSlips,sql`${packingSlips.id}=split_part(${stockMoves.refId},'#',1)`).where(and(eq(stockMoves.refType,'packing_slip'),inArray(packingSlips.orderId,orderIds),inArray(stockMoves.sku,skus))).groupBy(packingSlips.orderId,stockMoves.sku,stockMoves.warehouseId),
   db.select({orderId:deliveries.orderId,sku:stockMoves.sku,warehouseId:stockMoves.warehouseId,qty:sql<number>`-sum(${stockMoves.qty})`.mapWith(Number)}).from(stockMoves).innerJoin(deliveries,sql`${deliveries.id}=split_part(${stockMoves.refId},'#',1)`).where(and(eq(stockMoves.refType,'pos_delivery'),inArray(deliveries.orderId,orderIds),inArray(stockMoves.sku,skus))).groupBy(deliveries.orderId,stockMoves.sku,stockMoves.warehouseId),
   db.select({orderId:salesOrders.id,sku:stockMoves.sku,warehouseId:stockMoves.warehouseId,qty:sql<number>`-sum(${stockMoves.qty})`.mapWith(Number)}).from(stockMoves).innerJoin(salesOrders,sql`${salesOrders.id}=split_part(${stockMoves.refId},'#',1)`).where(and(inArray(stockMoves.refType,['sales_order','pos_order']),inArray(salesOrders.id,orderIds),inArray(stockMoves.sku,skus))).groupBy(salesOrders.id,stockMoves.sku,stockMoves.warehouseId),
  ]);issues.push(...packedIssues,...deliveryIssues,...directIssues);
 }
 return projectStockPending(packs.map(p=>({...p,delivered:p.delivered??0})),success.map(s=>({...s,at:s.at.length===10?s.at+'T23:59:59.999Z':s.at})),returns,backs,[...orders,...quotes.map(q=>({...q,warehouseId:null}))],issues,warehouseIds);
};

export const stockPendingOf:StockPendingOf=(db,skus,warehouseIds,at)=>db.transaction(tx=>readStockPending(tx as typeof db,skus,warehouseIds,at),{isolationLevel:'repeatable read',accessMode:'read only'});
