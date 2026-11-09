import {and,asc,eq,inArray,isNotNull,isNull,sql} from 'drizzle-orm';
import type {AnyDb} from '../core/db/client.ts';
import {AppError} from '../core/errors.ts';
import {fold} from '../core/text/fold.ts';
import {productStock,warehouses} from '../modules/catalog/schema.ts';
import {effectiveCatalogStock} from '../modules/catalog/api/stock-source.ts';
import {rememberLedgerWarehouses} from '../modules/sales/api/pos-stock.ts';
import {incomingShipmentLines as lines,incomingShipments as orders,supplierReceiptLines as received,supplierReceipts as receipts} from '../modules/suppliers/schema.ts';
import {purchaseOrderCost} from './line-cost-fallback.ts';

export const UNASSIGNED='__unassigned__';
export interface HomeStockFilters {priceBasis:'list'|'purchase';stockType:'physical'|'incoming'|'ordered'|'supplier';warehouseId:string;supplierId:string;confirmation:'all'|'pending'|'confirmed';due:'all'|'late'|'week'}
export function homeStockFilters(query=new URLSearchParams()):HomeStockFilters {
 const result={priceBasis:query.get('priceBasis')||'list',stockType:query.get('stockType')||'physical',warehouseId:query.get('warehouseId')||'',supplierId:query.get('supplierId')||'',confirmation:query.get('confirmation')||'all',due:query.get('due')||'all'};
 if(!['list','purchase'].includes(result.priceBasis)||!['physical','incoming','ordered','supplier'].includes(result.stockType)||!['all','pending','confirmed'].includes(result.confirmation)||!['all','late','week'].includes(result.due)||result.warehouseId.length>200||result.supplierId.length>200)throw new AppError(400,'Bộ lọc giá trị tồn không hợp lệ.');
 if(['physical','supplier'].includes(result.stockType)&&(result.supplierId||result.confirmation!=='all'||result.due!=='all'))throw new AppError(400,'Bộ lọc NCC và hạn giao chỉ áp dụng cho đơn đặt hàng.');
 return result as HomeStockFilters;
}
export interface HomeStockRow {sku:string;groupId:string;quantity:number;unit?:string;updatedAt:string;key:string;orderCost?:number|null;supplierId?:string;confirmation?:string;due?:string}
export interface HomeStockGroup {id:string;name:string;hasStockData:boolean;source:'ledger'|'sapo'|'purchase'|'supplier'}
/** Read the four distinct sources. No sync/write and no sum across overlapping physical/incoming quantities. */
export async function homeStockSource(db:AnyDb,filters:HomeStockFilters,today:string){
 const purchasing=filters.stockType==='incoming'||filters.stockType==='ordered';
 const stores=await db.select({id:warehouses.id,name:warehouses.name}).from(warehouses).where(and(eq(warehouses.active,true),eq(warehouses.kind,filters.stockType==='supplier'?'supplier':'stock'))).orderBy(asc(warehouses.sortOrder),asc(warehouses.name));
 let rows:HomeStockRow[]=[],groups:HomeStockGroup[]=[];
 let suppliers:{id:string;name:string}[]=[];
 if(!purchasing){
  const ids=new Set(stores.map(w=>w.id)),ledger=filters.stockType==='physical'?new Set(await rememberLedgerWarehouses(db)):new Set<string>();
  const raw=ids.size?await db.select().from(productStock).where(inArray(productStock.warehouseId,[...ids])):[];
  const stock=filters.stockType==='physical'?(await effectiveCatalogStock(db,raw)).filter(s=>ids.has(s.warehouseId)):raw;
  rows=stock.map(s=>({sku:s.sku,key:s.sku,groupId:s.warehouseId,quantity:s.quantity,updatedAt:s.updatedAt}));
  const known=new Set(rows.map(r=>r.groupId));groups=stores.map(w=>({...w,hasStockData:ledger.has(w.id)||known.has(w.id),source:filters.stockType==='supplier'?'supplier':ledger.has(w.id)?'ledger':'sapo'}));
 }else{
  // Same remaining-quantity rule as outstandingLines: only good receipts not cancelled reduce an order.
  const pending=filters.stockType==='ordered';
  const ordered=await db.select({id:lines.id,sku:lines.sku,unit:lines.unit,quantity:lines.quantity,price:lines.price,discount:lines.purchaseDiscount,confirmedDiscount:lines.confirmedPurchaseDiscount,printFee:lines.printFee,promisedDate:lines.promisedDate,warehouse:orders.warehouse,supplierId:orders.supplierId,supplierName:orders.supplierName,confirmation:orders.supplierStatus,arrivalDate:orders.arrivalDate,updatedAt:orders.updatedAt})
   .from(lines).innerJoin(orders,eq(orders.id,lines.shipmentId)).where(and(eq(orders.source,'supplier-order'),eq(orders.approvalStatus,pending?'pending':'approved'),isNull(orders.cancelledAt),pending?isNotNull(orders.submittedAt):undefined));
  const ids=ordered.map(l=>l.id);
  const got=ids.length?await db.select({id:received.lineId,quantity:sql<number>`sum(${received.goodQty})`.mapWith(Number)}).from(received).innerJoin(receipts,eq(receipts.id,received.receiptId)).where(and(isNull(receipts.cancelledAt),inArray(received.lineId,ids))).groupBy(received.lineId):[];
  const receivedById=new Map(got.map(r=>[r.id,r.quantity]));
  const byName=new Map<string,string[]>();for(const w of stores){const key=fold(w.name.trim());byName.set(key,[...(byName.get(key)||[]),w.id]);}
  const destination=(value:string)=>{if(stores.some(w=>w.id===value))return value;const matches=byName.get(fold(value.trim()));return matches?.length===1?matches[0]!:UNASSIGNED;};
  rows=ordered.map(l=>({sku:l.sku,key:l.sku||l.id,groupId:destination(l.warehouse),quantity:Math.max(0,l.quantity-(receivedById.get(l.id)||0)),unit:l.unit,updatedAt:l.updatedAt,orderCost:purchaseOrderCost({price:l.price,discount:l.confirmedDiscount??l.discount,printFee:l.printFee}),supplierId:l.supplierId||'',confirmation:l.confirmation,due:l.promisedDate||l.arrivalDate||''})).filter(l=>l.quantity>0);
  const supplierNames=new Map(ordered.map(l=>[l.supplierId,l.supplierName]));
  suppliers=[...new Set(rows.map(l=>l.supplierId).filter((id):id is string=>!!id))].map(id=>({id,name:supplierNames.get(id)||id})).sort((a,b)=>a.name.localeCompare(b.name,'vi'));
  groups=stores.map(w=>({...w,hasStockData:true,source:'purchase'}));
  if(rows.some(r=>r.groupId===UNASSIGNED))groups.push({id:UNASSIGNED,name:'Chưa xác định kho nhận',hasStockData:true,source:'purchase'});
 }
 if(filters.warehouseId&&!groups.some(w=>w.id===filters.warehouseId))throw new AppError(400,'Kho trong bộ lọc không hợp lệ.');
 if(filters.supplierId&&!suppliers.some(s=>s.id===filters.supplierId))throw new AppError(400,'NCC trong bộ lọc không hợp lệ.');
 const options={warehouses:groups.map(({id,name})=>({id,name})),suppliers};
 const week=new Date(Date.parse(today+'T00:00:00Z')+7*86400000).toISOString().slice(0,10);
 rows=rows.filter(r=>(!filters.warehouseId||r.groupId===filters.warehouseId)&&(!filters.supplierId||r.supplierId===filters.supplierId)&&(filters.confirmation==='all'||r.confirmation===filters.confirmation)&&(filters.due==='all'||!!r.due&&(filters.due==='late'?r.due<today:r.due>=today&&r.due<=week)));
 const represented=new Set(rows.map(r=>r.groupId));
 groups=groups.filter(g=>(!filters.warehouseId||g.id===filters.warehouseId)&&(!purchasing||represented.has(g.id)));
 return {rows,groups,options};
}
