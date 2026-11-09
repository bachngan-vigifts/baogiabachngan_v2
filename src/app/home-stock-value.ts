import {and,asc,desc,eq,gt,inArray,isNotNull,lte,sql} from 'drizzle-orm';
import type {AnyDb} from '../core/db/client.ts';
import type {Router} from '../core/http/router.ts';
import {json} from '../core/http/router.ts';
import {AppError} from '../core/errors.ts';
import type {SessionState,StaffEnv} from '../modules/staff/api/auth-routes.ts';
import {products,productStock,productMovements,warehouses} from '../modules/catalog/schema.ts';
import {effectiveCatalogStock} from '../modules/catalog/api/stock-source.ts';
import {rememberLedgerWarehouses} from '../modules/sales/api/pos-stock.ts';
import {pickLineCost} from '../modules/sales/domain/line-cost.ts';
import {lineCostFallbackOf} from './line-cost-fallback.ts';

/** Current physical stock at latest purchase/reference costs, not an accounting moving-average valuation. */
export async function homeStockValue(db:AnyDb,now=new Date().toISOString()){
 return db.transaction(async transaction=>{
  const tx=transaction as unknown as AnyDb;
  const stores=await tx.select({id:warehouses.id,name:warehouses.name}).from(warehouses).where(and(eq(warehouses.active,true),eq(warehouses.kind,'stock'))).orderBy(asc(warehouses.sortOrder),asc(warehouses.name));
  const ids=stores.map(w=>w.id),ledger=new Set(await rememberLedgerWarehouses(transaction));
  const raw=ids.length?await tx.select().from(productStock).where(inArray(productStock.warehouseId,ids)):[];
  const stock=(await effectiveCatalogStock(transaction,raw)).filter(s=>ids.includes(s.warehouseId));
  const skus=[...new Set(stock.filter(s=>s.quantity>0).map(s=>s.sku))];
  const [catalog,receipts]=skus.length?await Promise.all([
   tx.select({sku:products.sku,unit:products.unit}).from(products).where(inArray(products.sku,skus)),
   tx.selectDistinctOn([productMovements.sku,productMovements.unit],{sku:productMovements.sku,unit:productMovements.unit,price:productMovements.unitPrice,at:productMovements.occurredAt}).from(productMovements)
    .where(and(inArray(productMovements.sku,skus),eq(productMovements.kind,'purchase'),gt(productMovements.qty,0),isNotNull(productMovements.unitPrice),sql`${productMovements.unitPrice}>=0 and ${productMovements.unitPrice}<=1e12`,lte(productMovements.occurredAt,now),sql`lower(trim(${productMovements.status})) not in ('cancelled','canceled','voided','đã hủy','đã huỷ')`))
    .orderBy(productMovements.sku,productMovements.unit,desc(productMovements.occurredAt),asc(productMovements.id)),
  ]):[[],[]];
  const units=new Map(catalog.map(p=>[p.sku,p.unit]));
  const history=new Map<string,{at:string;price:number}[]>();
  for(const r of receipts){const unit=units.get(r.sku);if(unit?.trim()&&r.unit.trim()&&unit.trim().toLowerCase()!==r.unit.trim().toLowerCase())continue;
   history.set(r.sku,[...(history.get(r.sku)||[]),{at:r.at,price:Number(r.price)}]);}
  const day=new Date(Date.parse(now)+7*3600e3).toISOString().slice(0,10),costs=new Map<string,ReturnType<typeof pickLineCost>>();
  for(const sku of skus)costs.set(sku,pickLineCost(null,null,history.get(sku),day,sku,null,units.get(sku)));
  const missing=skus.filter(sku=>!costs.get(sku));
  // Only unresolved SKUs need the heavier NCC/catalog fallback; bounded batches avoid quadratic catalog work.
  for(let offset=0;offset<missing.length;offset+=300){const batch=missing.slice(offset,offset+300),fallback=await lineCostFallbackOf(tx,batch);
   for(const sku of batch){const original=fallback.get(sku);const candidate=original?{...original,orders:original.orders.filter(p=>Date.parse(p.at)<=Date.parse(now)),catalog:original.catalog&&Date.parse(original.catalog.at)<=Date.parse(now)?original.catalog:null}:null;
    costs.set(sku,pickLineCost(null,null,history.get(sku),day,sku,candidate,units.get(sku)));}}
  const missingSkus=new Set<string>();
  const inventory=stores.map(w=>{
   const rows=stock.filter(s=>s.warehouseId===w.id),positive=rows.filter(s=>s.quantity>0);let value=0,priced=0,missingPrice=0,referenceValue=0;
   for(const row of positive){const c=costs.get(row.sku);if(!c){missingPrice++;missingSkus.add(row.sku);continue;}const v=c.unitCost*row.quantity;value+=v;priced++;if(c.source!=='purchase')referenceValue+=v;}
   const updatedAt=rows.reduce<string|null>((at,r)=>!at||r.updatedAt>at?r.updatedAt:at,null);
   return {...w,value:Math.round(value),referenceValue:Math.round(referenceValue),positiveSkus:positive.length,pricedSkus:priced,missingSkus:missingPrice,negativeSkus:rows.filter(r=>r.quantity<0).length,hasStockData:ledger.has(w.id)||rows.length>0,source:ledger.has(w.id)?'ledger':'sapo',updatedAt};
  });
  return {asOf:now,inventory,totalValue:inventory.reduce((n,w)=>n+w.value,0),referenceValue:inventory.reduce((n,w)=>n+w.referenceValue,0),missingSkus:missingSkus.size,pricedRows:inventory.reduce((n,w)=>n+w.pricedSkus,0),negativeRows:inventory.reduce((n,w)=>n+w.negativeSkus,0),unknownWarehouses:inventory.filter(w=>!w.hasStockData).length};
 },{isolationLevel:'repeatable read',accessMode:'read only'});
}
export function registerHomeStockValue(router:Router<StaffEnv>){
 router.get('/admin/home-stock-value',async c=>{
  if((c.state.session as SessionState).member.role!=='manager')throw new AppError(403,'Chỉ Manager xem giá trị tồn kho.');
  return json(await homeStockValue(c.env.db));
 },'admin');
}
