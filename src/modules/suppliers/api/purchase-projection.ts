import {and,asc,eq,inArray,sql} from 'drizzle-orm';
import type {PurchaseProjectionViewer} from '../../../core/contracts/purchase-projection.ts';
import {purchaseReadLevel} from '../domain/purchase-access.ts';
import {purchaseScope,type Db as PurchaseDb,type Member} from './purchase-store.ts';
import {outstandingLines} from './incoming-stock.ts';
import {suppliers,incomingShipments} from '../schema.ts';
import {warehouses} from '../../catalog/schema.ts';
import type {StockReadDb as Db,CatalogStockRow} from '../../catalog/api/stock-source.ts';
import {sha256Hex} from '../../staff/domain/session.ts';
const actor=(m:PurchaseProjectionViewer)=>({...m,active:m.active===true}) as Member;
export const canPurchaseProjection=(m:PurchaseProjectionViewer)=>purchaseReadLevel(actor(m))!=='none';
/** Anonymous rows contain only a SKU total and earliest appointment; no underlying PO identifiers. */
export async function incomingForViewer(db:Db,m:PurchaseProjectionViewer,skus:readonly string[]){
 const a=actor(m),level=purchaseReadLevel(a),rows=await outstandingLines(db as PurchaseDb,skus,false,level==='brand'?{predicate:purchaseScope(a)}:undefined);
 if(level!=='none')return rows.map(r=>({...r,arrivalDate:r.promisedDate||r.arrivalDate}));
 const grouped=new Map<string,{sku:string;orderId:string;ticketNumber:string;internalNo:string;supplierName:string;arrivalDate:string|null;left:number}>();
 for(const r of rows){const due=r.promisedDate||r.arrivalDate,row=grouped.get(r.sku)??{sku:r.sku,orderId:'',ticketNumber:'',internalNo:'',supplierName:'',arrivalDate:null,left:0};row.left=Math.round((row.left+r.left)*1000)/1000;if(due&&(!row.arrivalDate||due<row.arrivalDate))row.arrivalDate=due;grouped.set(r.sku,row);}
 return [...grouped.values()];
}
export async function projectIncomingStock(db:Db,rows:CatalogStockRow[],skus:readonly string[]|undefined,m:PurchaseProjectionViewer){
 if(purchaseReadLevel(actor(m))!=='brand')return rows;
 const whs=await db.select({id:warehouses.id}).from(warehouses).where(eq(warehouses.kind,'incoming')).orderBy(asc(warehouses.sortOrder),asc(warehouses.id));
 if(!whs.length)return rows;
 const keys=skus??[...new Set(rows.map(r=>r.sku))],totals=new Map<string,number>();for(let start=0;start<keys.length;start+=300){for(const r of await incomingForViewer(db,m,keys.slice(start,start+300)))totals.set(r.sku,(totals.get(r.sku)??0)+r.left);}
 const ids=new Set(whs.map(w=>w.id));return rows.map(r=>ids.has(r.warehouseId)?{...r,quantity:r.warehouseId===whs[0]!.id?totals.get(r.sku)??0:0}:r);
}
export async function purchaseCatalogVariant(db:Db,m:PurchaseProjectionViewer){
 const level=purchaseReadLevel(actor(m));if(level!=='brand')return ':po-'+level;
 const rows=await db.select({id:suppliers.id,brand:suppliers.saleAdminBrand}).from(suppliers).where(sql`${suppliers.saleAdminBrand} is not null`).orderBy(asc(suppliers.id));
 return ':po-brand-'+sha256Hex(JSON.stringify(rows)).slice(0,24);
}
/** Unknown external/Sapo parent links do not prove brand ownership. */
export async function visiblePurchaseHistoryLinks(db:Db,m:PurchaseProjectionViewer,links:readonly string[]){
 const a=actor(m),level=purchaseReadLevel(a);if(level==='all')return new Set(links);if(level==='none')return new Set<string>();
 const refs=links.flatMap(link=>{const match=/^#\/purchases\/([^/?#]+)$/.exec(link);if(!match)return[];try{return[{link,id:decodeURIComponent(match[1]!)}];}catch{return[];}});
 if(!refs.length)return new Set<string>();const allowed=new Set((await db.select({id:incomingShipments.id}).from(incomingShipments).where(and(purchaseScope(a),inArray(incomingShipments.id,refs.map(r=>r.id))))).map(r=>r.id));return new Set(refs.filter(r=>allowed.has(r.id)).map(r=>r.link));
}
