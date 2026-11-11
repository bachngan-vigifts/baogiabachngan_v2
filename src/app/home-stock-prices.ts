import {and,asc,desc,eq,gt,inArray,isNotNull,lte,sql} from 'drizzle-orm';
import type {AnyDb} from '../core/db/client.ts';
import {products,productMovements,productPrices,pricePolicies} from '../modules/catalog/schema.ts';
import {normalize} from '../modules/quotes/domain/quote-math.ts';
import {pickLineCost} from '../modules/sales/domain/line-cost.ts';
import {lineCostFallbackOf} from './line-cost-fallback.ts';
import type {HomeStockFilters,HomeStockRow} from './home-stock-sources.ts';

async function purchaseCosts(tx:AnyDb,skus:string[],now:string){
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
 return {costs,units};
}

const valid=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=1e12;
const RETAIL=['gia ban le','gia le','gia ban le vat','gia le vat'];
export async function homeStockPrices(db:AnyDb,rows:HomeStockRow[],filters:HomeStockFilters,now:string){
 const skus=[...new Set(rows.filter(r=>r.quantity>0).map(r=>r.sku).filter(Boolean))];
 if(filters.priceBasis==='list'){
  const policies=await db.select().from(pricePolicies).orderBy(asc(pricePolicies.sortOrder),asc(pricePolicies.id));
  // One common retail policy. Keep the stored list amount, including its existing VAT basis; never use wholesale or supplier discounts.
  const policy=policies.filter(p=>RETAIL.includes(normalize(p.name).replace(/\+/g,' ').replace(/\s+/g,' ').trim())).sort((a,b)=>Number(/vat/i.test(a.name))-Number(/vat/i.test(b.name)))[0]||null;
  const [prices,catalog]=policy&&skus.length?await Promise.all([
   db.select({sku:productPrices.sku,price:productPrices.price}).from(productPrices).where(and(eq(productPrices.policyId,policy.id),inArray(productPrices.sku,skus))),
   db.select({sku:products.sku,unit:products.unit}).from(products).where(inArray(products.sku,skus)),
  ]):[[],[]];
  const bySku=new Map(prices.map(p=>[p.sku,p.price])),units=new Map(catalog.map(p=>[p.sku,p.unit]));
  return {policy:policy?{id:policy.id,name:policy.name}:null,price:(row:HomeStockRow)=>{
   const unit=units.get(row.sku),price=bySku.get(row.sku);
   if(row.unit?.trim()&&unit?.trim()&&row.unit.trim().toLowerCase()!==unit.trim().toLowerCase())return null;
   return valid(price)?{unitCost:price,reference:false}:null;
  }};
 }
 const needed=rows.filter(r=>r.quantity>0&&!valid(r.orderCost));
 const {costs,units}=needed.length?await purchaseCosts(db,[...new Set(needed.map(r=>r.sku).filter(Boolean))],now):{costs:new Map(),units:new Map()};
 return {policy:null,price:(row:HomeStockRow)=>{
  if(valid(row.orderCost))return {unitCost:row.orderCost,reference:false};
  const unit=units.get(row.sku);if(row.unit?.trim()&&unit?.trim()&&row.unit.trim().toLowerCase()!==unit.trim().toLowerCase())return null;
  const c=costs.get(row.sku);return c?{unitCost:c.unitCost,reference:!!row.unit||c.source!=='purchase'}:null;
 }};
}
