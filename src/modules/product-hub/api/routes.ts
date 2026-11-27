import {employees} from '../../staff/schema.ts';
import {registerSalePriceSuggestions} from './sale-price-suggestions.ts';
import {productQuoteProfit} from '../domain/product-profit.ts';
import {and,asc,eq,inArray,ne,or,sql,type SQL} from 'drizzle-orm';
import {AppError} from '../../../core/errors.ts';
import {json,type Router} from '../../../core/http/router.ts';
import type {SessionState,StaffEnv} from '../../staff/api/auth-routes.ts';
import {can} from '../../staff/domain/permissions.ts';
import {products,productBarcodes,productPrices,pricePolicies,warehouses} from '../../catalog/schema.ts';
import {readCatalogStock,hiddenStockWarehouses} from '../../catalog/api/stock-source.ts';
import {quotations as q,quoteLines as ql} from '../../quotes/schema.ts';
import {quotationPredicate} from '../../quotes/api/department-access.ts';
import {totals,type QuoteDoc} from '../../quotes/domain/quote-math.ts';
import {salesOrders as o,salesOrderLines as ol,salesContracts as k} from '../../sales/schema.ts';
import {orderScopeFor} from '../../sales/api/routes.ts';
import {posReturns as r,posReturnLines as rl} from '../../sales/return-schema.ts';
import {incomingShipments as p,incomingShipmentLines as pl,supplierReceipts as rec,supplierReceiptLines as recl,supplierOrderSources as ps} from '../../suppliers/schema.ts';
import {purchaseEarlyRequests as er,purchaseEarlyRequestLines as el,purchaseEarlyRequestAllocations as ea} from '../../suppliers/early-request-schema.ts';
import {canUsePurchasing} from '../../suppliers/domain/purchasing.ts';
import {purchaseScope,earlyPurchaseScope} from '../../suppliers/api/purchase-store.ts';
import {canSeePurchasePrices} from '../../suppliers/domain/purchasing.ts';
import {computeOrderTotals,type TotalsRow} from '../../suppliers/domain/order-totals.ts';
type Db=StaffEnv['db'];type Member=SessionState['member'];
export const PRODUCT_DOCUMENT_KINDS=['quotes','orders','contracts','purchases','receipts','returns','early'] as const;
export type ProductDocumentKind=typeof PRODUCT_DOCUMENT_KINDS[number];
const saleAccess=(m:Member)=>['page.orders','page.contracts','page.receivables'].some(x=>can(m,x));
const salePrices=(m:Member)=>m.role==='manager'||['page.quotes','page.orders','page.contracts'].some(x=>can(m,x));
const allowed=(m:Member,kind:ProductDocumentKind)=>kind==='quotes'?can(m,'page.quotes'):['orders','contracts','returns'].includes(kind)?saleAccess(m):canUsePurchasing(m);
const rowsOf=<T>(result:unknown):T[]=>Array.isArray(result)?result as T[]:(result as {rows:T[]}).rows;
const read=async<T>(db:Db,query:SQL)=>rowsOf<T>(await db.execute(query));
const salesFrom=sql`${ol} join ${o} on ${o.id}=${ol.orderId} left join ${k} on ${k.orderId}=${o.id}`;
const active=sql`${o.status}<>'cancelled' and (${o.status}<>'draft' or ${k.status} in ('signed','completed'))`;
const none=sql`false`;
/** One row per source document, aggregating only this exact SKU. All row/page scopes stay in SQL. */
function source(sku:string,m:Member,kind:ProductDocumentKind):SQL{
 const scope=allowed(m,kind)?undefined:none,priced=salePrices(m);
 if(kind==='orders'||kind==='contracts')return sql`select ${o.id} id,coalesce(${k.contractNo},${o.orderNo}) number,${o.orderDate} date,
  coalesce(${k.status},${o.status}) status,${o.customerName} partner,sum(${ol.qty}) quantity,string_agg(distinct ${ol.unit},' / ') unit,
  ${priced?sql`sum(${ol.amount})`:sql`null::float8`} amount,${o.id} "orderId",${k.id} "contractId"
  from ${salesFrom} where ${and(eq(ol.sku,sku),orderScopeFor(m),scope,kind==='contracts'?sql`${k.id} is not null`:sql`${k.id} is null`)} group by ${o.id},${k.id}`;
 if(kind==='quotes')return sql`select ${q.id} id,${q.quoteNo} number,coalesce(nullif(${q.quoteDate},''),${q.createdAt}) date,
  ${q.approvalStatus} status,${q.customer} partner,sum(${ql.qty}) quantity,string_agg(distinct ${ql.unit},' / ') unit,${q.quoteType} "quoteType",
  ${m.role==='manager'?sql`array(
    select distinct trim(line->>'supplierInfo') as supplier
    from jsonb_array_elements(case when jsonb_typeof(${q.data}::jsonb->'rows')='array' then ${q.data}::jsonb->'rows' else '[]'::jsonb end) line
    where line->>'sku'=${sku} and trim(line->>'supplierInfo')<>'' order by supplier
  ) suppliers,`:sql``}
  jsonb_agg(jsonb_build_object('qty',${ql.qty},'price',${ql.price},'discount',${ql.discount},'discountType',${ql.discountType},'printFee',${ql.printFee})) "quoteRows"
  from ${ql} join ${q} on ${q.id}=${ql.quoteId} where ${and(eq(ql.sku,sku),quotationPredicate(m),scope)} group by ${q.id}`;
 if(kind==='purchases')return sql`select ${p.id} id,${p.ticketNumber} number,${p.createdAt} date,
  case when ${p.cancelledAt} is not null then 'cancelled' when ${p.approvalStatus}='pending' then 'draft' else ${p.supplierStatus} end status,
  ${p.supplierName} partner,sum(${pl.quantity}) quantity,string_agg(distinct ${pl.unit},' / ') unit,${p.approvalStatus} "approvalStatus",
  jsonb_agg(jsonb_build_object('quantity',${pl.quantity},'price',${pl.price},'taxRate',${pl.taxRate},'printFee',${pl.printFee},'purchaseDiscount',${pl.purchaseDiscount},'confirmedPurchaseDiscount',${pl.confirmedPurchaseDiscount})) "purchaseRows"
  from ${pl} join ${p} on ${p.id}=${pl.shipmentId} where ${and(eq(pl.sku,sku),purchaseScope(m),scope)} group by ${p.id}`;
 if(kind==='receipts')return sql`select ${rec.id} id,${rec.receiptNo} number,${rec.receivedDate} date,
  case when ${rec.cancelledAt} is null then 'received' else 'cancelled' end status,${p.supplierName} partner,
  sum(${recl.goodQty}) quantity,string_agg(distinct ${pl.unit},' / ') unit,sum(${recl.damagedQty}) damaged,${p.id} "purchaseId",${p.ticketNumber} "purchaseNumber",${rec.warehouse} warehouse
  from ${recl} join ${rec} on ${rec.id}=${recl.receiptId} join ${p} on ${p.id}=${rec.shipmentId} join ${pl} on ${pl.id}=${recl.lineId}
  where ${and(eq(recl.sku,sku),eq(pl.sku,sku),purchaseScope(m),scope)} group by ${rec.id},${p.id}`;
 if(kind==='returns')return sql`select ${r.id} id,${r.returnNo} number,${r.createdAt} date,${r.status} status,${o.customerName} partner,
  sum(${rl.receivedQty}) quantity,string_agg(distinct ${rl.unit},' / ') unit,sum(${rl.requestedQty}) requested,sum(${rl.restockQty}) restocked,
  ${priced?sql`sum(${rl.subtotal})`:sql`null::float8`} amount,${o.id} "orderId",${k.id} "contractId"
  from ${rl} join ${ol} on ${ol.id}=${rl.orderLineId} join ${r} on ${r.id}=${rl.returnId} join ${o} on ${o.id}=${r.orderId} left join ${k} on ${k.orderId}=${o.id}
  where ${and(eq(rl.sku,sku),eq(ol.sku,sku),orderScopeFor(m),scope)} group by ${r.id},${o.id},${k.id}`;
 return sql`select ${er.id} id,${er.ticketNumber} number,${er.createdAt} date,${er.status} status,
  string_agg(distinct ${p.supplierName},' · ') partner,sum(${ea.quantity}) quantity,string_agg(distinct ${el.unit},' / ') unit,${er.pickupDate} "pickupDate"
  from ${el} join ${er} on ${er.id}=${el.requestId} join ${ea} on ${ea.requestLineId}=${el.id}
  join ${pl} on ${pl.id}=${ea.purchaseLineId} join ${p} on ${p.id}=${pl.shipmentId}
  where ${and(eq(el.sku,sku),eq(pl.sku,sku),sql`${er.deletedAt} is null`,earlyPurchaseScope(m),scope)} group by ${er.id}`;
}
/** Batch source links for these visible purchase rows; source-document permissions still apply. */
async function purchaseSourceLinks(db:Db,m:Member,ids:string[],sku:string){
 const out=new Map<string,{label:string;href:string}[]>();if(!ids.length)return out;
 const sources=await db.select({purchaseId:ps.shipmentId,type:ps.sourceType,id:ps.sourceId}).from(ps).where(and(inArray(ps.shipmentId,ids),eq(ps.sku,sku)));
 const quoteIds=[...new Set(sources.filter(s=>s.type==='quote').map(s=>s.id))],orderIds=[...new Set(sources.filter(s=>s.type==='order').map(s=>s.id))];
 const [quotes,orders]=await Promise.all([
  can(m,'page.quotes')&&quoteIds.length?db.select({id:q.id,no:q.quoteNo}).from(q).where(and(inArray(q.id,quoteIds),quotationPredicate(m))):[],
  (can(m,'page.orders')||can(m,'page.contracts'))&&(quoteIds.length||orderIds.length)?db.select({id:o.id,no:o.orderNo,quoteId:o.quoteId,contractId:k.id,contractNo:k.contractNo}).from(o).leftJoin(k,eq(k.orderId,o.id)).where(and(or(inArray(o.id,orderIds),and(inArray(o.quoteId,quoteIds),ne(o.status,'cancelled'))),orderScopeFor(m))):[]
 ]);
 const add=(purchaseId:string,label:string,href:string)=>{const list=out.get(purchaseId)??[];if(!list.some(x=>x.href===href))list.push({label,href});out.set(purchaseId,list);};
 for(const source of sources){
  if(source.type==='quote'){const quote=quotes.find(q=>q.id===source.id);if(quote)add(source.purchaseId,'Báo giá '+quote.no,'#/quotes/'+encodeURIComponent(quote.id));}
  for(const order of orders.filter(o=>source.type==='order'?o.id===source.id:source.type==='quote'&&o.quoteId===source.id)){
   if(order.contractId&&can(m,'page.contracts'))add(source.purchaseId,'HĐKT '+order.contractNo,'#/contracts/'+encodeURIComponent(order.id));
   else if(can(m,'page.orders'))add(source.purchaseId,'Đơn hàng '+order.no,'#/orders/'+encodeURIComponent(order.id));
  }
 }
 return out;
}
interface DocumentRow{ id:string;number:string;date:string;status:string;partner:string;quantity:number;unit?:string;amount?:number|null;orderId?:string;contractId?:string;purchaseId?:string;purchaseNumber?:string;quoteType?:QuoteDoc['type'];quoteRows?:QuoteDoc['rows'];purchaseRows?:TotalsRow[];approvalStatus?:string }
export async function productDocuments(db:Db,sku:string,m:Member,kind:ProductDocumentKind,offset:number){
 if(!allowed(m,kind))throw new AppError(403,'Bạn chưa được cấp quyền xem nhóm chứng từ này.');
 const base=source(sku,m,kind),limit=25;
 const [rows,[total]]=await Promise.all([read<DocumentRow>(db,sql`select * from (${base}) docs order by date desc,id desc limit ${limit} offset ${offset}`),read<{n:number}>(db,sql`select count(*)::int n from (${base}) docs`)]);
 const links=['purchases','receipts'].includes(kind)?await purchaseSourceLinks(db,m,rows.map(r=>r.purchaseId||r.id),sku):new Map<string,{label:string;href:string}[]>();
 return{kind,total:total?.n||0,offset,limit,rows:rows.map(row=>{
  const {quoteRows,purchaseRows,quoteType,approvalStatus,...shown}=row;
  if(quoteRows)shown.amount=totals({type:quoteType!,rows:quoteRows}).subtotal;
  if(purchaseRows)shown.amount=canSeePurchasePrices(m,{approvalStatus:approvalStatus!})&&purchaseRows.every(r=>r.price!==null)?computeOrderTotals({rows:purchaseRows,depositRate:0,paidAmount:0}).subtotal:null;
  const route=kind==='quotes'?'quotes':kind==='early'?'early-requests':kind==='purchases'||kind==='receipts'?'purchases':kind==='contracts'||row.contractId?'contracts':'orders';
  return{...shown,...(['purchases','receipts'].includes(kind)?{sources:links.get(row.purchaseId||row.id)||[]}:{}),quantity:Number(row.quantity),href:'#/'+route+'/'+encodeURIComponent(row.purchaseId||row.orderId||row.id)};
 })};
}
export function registerProductDetailRoutes(router:Router<StaffEnv>){
 registerSalePriceSuggestions(router);
 router.get('/products/:sku/overview',async c=>{
  const db=c.env.db,m=(c.state.session as SessionState).member,sku=c.params.sku!;
  const [product]=await db.select().from(products).where(eq(products.sku,sku));if(!product)throw new AppError(404,'Không tìm thấy sản phẩm.');
  const hidden=await hiddenStockWarehouses(db,m),available=PRODUCT_DOCUMENT_KINDS.filter(kind=>allowed(m,kind));
  const [stock,wh,barcodes,prices,counts,sales,receipts,returned,profitDocs,staff]=await Promise.all([
   readCatalogStock(db,[sku],m),db.select({id:warehouses.id,name:warehouses.name,kind:warehouses.kind,active:warehouses.active}).from(warehouses).orderBy(asc(warehouses.sortOrder),asc(warehouses.name)),
   db.select({barcode:productBarcodes.barcode}).from(productBarcodes).where(eq(productBarcodes.sku,sku)),
   salePrices(m)?db.select({policyId:pricePolicies.id,name:pricePolicies.name,price:productPrices.price}).from(pricePolicies).leftJoin(productPrices,and(eq(pricePolicies.id,productPrices.policyId),eq(productPrices.sku,sku))).orderBy(asc(pricePolicies.sortOrder)):[],
   Promise.all(available.map(async kind=>({kind,total:(await read<{n:number}>(db,sql`select count(*)::int n from (${source(sku,m,kind)}) docs`))[0]?.n||0}))),
   saleAccess(m)?read<{count:number;qty:number;delivered:number;revenue:number}>(db,sql`select count(distinct ${o.id})::int count,coalesce(sum(${ol.qty}),0) qty,coalesce(sum(${ol.deliveredQty}),0) delivered,${salePrices(m)?sql`coalesce(sum(${ol.amount}),0)`:sql`null::float8`} revenue from ${salesFrom} where ${and(eq(ol.sku,sku),orderScopeFor(m),active)}`):[],
   canUsePurchasing(m)?read<{count:number;qty:number;damaged:number}>(db,sql`select count(distinct ${rec.id})::int count,coalesce(sum(${recl.goodQty}),0) qty,coalesce(sum(${recl.damagedQty}),0) damaged from ${recl} join ${rec} on ${rec.id}=${recl.receiptId} join ${p} on ${p.id}=${rec.shipmentId} join ${pl} on ${pl.id}=${recl.lineId} where ${and(eq(recl.sku,sku),eq(pl.sku,sku),purchaseScope(m),sql`${rec.cancelledAt} is null`)}`):[],
   saleAccess(m)?read<{qty:number;amount:number}>(db,sql`select coalesce(sum(${rl.requestedQty}),0) qty,${salePrices(m)?sql`coalesce(sum(${rl.subtotal}),0)`:sql`null::float8`} amount from ${rl} join ${ol} on ${ol.id}=${rl.orderLineId} join ${r} on ${r.id}=${rl.returnId} join ${o} on ${o.id}=${r.orderId} left join ${k} on ${k.orderId}=${o.id} where ${and(eq(rl.sku,sku),eq(ol.sku,sku),orderScopeFor(m),active,sql`${r.creditEffectiveAt} is not null`)}`):[],
   m.role==='manager'?read<{doc:QuoteDoc}>(db,sql`select jsonb_build_object('type',${q.quoteType},'vat',${q.data}::jsonb->'vat',
    'rows',(select jsonb_agg(jsonb_build_object('sku',x->>'sku','qty',x->'qty','price',x->'price','discount',x->'discount','discountType',x->'discountType','printFee',x->'printFee','costPrice',x->'costPrice','printing',x->'printing','commission',x->'commission'))
      from jsonb_array_elements(case when jsonb_typeof(${q.data}::jsonb->'rows')='array' then ${q.data}::jsonb->'rows' else '[]'::jsonb end) x where x->>'sku'=${sku})) doc
    from ${q} where ${and(eq(q.approvalStatus,'approved'),sql`exists(select 1 from ${ql} where ${ql.quoteId}=${q.id} and ${ql.sku}=${sku})`)}`):[],
   db.select({id:employees.id,name:employees.name}).from(employees).where(inArray(employees.id,[product.createdBy,product.approvedBy].filter((id):id is string=>!!id))),
  ]);
  return json({product:{...product,createdByName:staff.find(s=>s.id===product.createdBy)?.name||'',approvedByName:staff.find(s=>s.id===product.approvedBy)?.name||''},barcodes:barcodes.map(r=>r.barcode),prices,stock:wh.filter(w=>!hidden.has(w.id)).map(w=>({...w,quantity:stock.find(s=>s.warehouseId===w.id)?.quantity??null,updatedAt:stock.find(s=>s.warehouseId===w.id)?.updatedAt??null})),
   access:{salePrices:salePrices(m),profit:m.role==='manager'},documents:counts,stats:{sales:sales[0]||null,receipts:receipts[0]||null,returns:returned[0]||null},profit:m.role==='manager'?productQuoteProfit(sku,profitDocs.map(r=>r.doc)):null});
 },'business');
 router.get('/products/:sku/documents',async c=>{
  const kind=c.url.searchParams.get('kind') as ProductDocumentKind,offset=Number(c.url.searchParams.get('offset')||0);
  if(!PRODUCT_DOCUMENT_KINDS.includes(kind)||!Number.isSafeInteger(offset)||offset<0||offset>1000000)throw new AppError(400,'Bộ lọc lịch sử sản phẩm không hợp lệ.');
  const [product]=await c.env.db.select({sku:products.sku}).from(products).where(eq(products.sku,c.params.sku!));if(!product)throw new AppError(404,'Không tìm thấy sản phẩm.');
  return json(await productDocuments(c.env.db,product.sku,(c.state.session as SessionState).member,kind,offset));
 },'business');
}
