import {and,eq,gte,lt,inArray,asc} from 'drizzle-orm';
import type {AnyDb} from '../../../core/db/client.ts';
import {salesOrders,salesOrderLines,salesContracts} from '../schema.ts';
import {quotations} from '../../quotes/schema.ts';
import {commissionOf,quoteStockSku,type QuoteRow} from '../../quotes/domain/quote-math.ts';
import {debtCounts} from '../domain/sales.ts';
/** Monetary basis only; HR owns KPI tiers. Never substitute VAT-inclusive totals or infer commission from missing/mismatched source rows. */
export async function kpiNetRevenue(db:AnyDb,from:string,next:string,approvedOnly=false,channels?:readonly string[], details?:{id:string;ownerId:string;amount:number|null}[]){
 const orders=await db.select({o:{id:salesOrders.id,ownerId:salesOrders.ownerId,subtotal:salesOrders.subtotal,status:salesOrders.status,channel:salesOrders.channel,quoteType:salesOrders.quoteType},quote:quotations.data}).from(salesOrders).leftJoin(quotations,eq(quotations.id,salesOrders.quoteId)).where(and(channels?inArray(salesOrders.channel,[...channels]):undefined,gte(salesOrders.orderDate,from),lt(salesOrders.orderDate,next),approvedOnly?inArray(salesOrders.status,['confirmed','delivering','delivered']):undefined));
 const ids=orders.map(r=>r.o.id),out=new Map<string,{netRevenue:number;netRevenueIssues:number}>();
 if(!ids.length)return out;
 const [lines,contracts]=await Promise.all([db.select().from(salesOrderLines).where(inArray(salesOrderLines.orderId,ids)).orderBy(asc(salesOrderLines.lineNo)),db.select({orderId:salesContracts.orderId,status:salesContracts.status}).from(salesContracts).where(inArray(salesContracts.orderId,ids))]);
 for(const {o,quote} of orders){
  if(approvedOnly&&!['confirmed','delivering','delivered'].includes(o.status))continue;
  if(!debtCounts(o.status,contracts.find(k=>k.orderId===o.id&&k.status!=='cancelled')?.status))continue;
  const m=out.get(o.ownerId)||{netRevenue:0,netRevenueIssues:0};let commission=0,valid=Number.isFinite(o.subtotal);
  if(o.channel==='crm'){
   let rows:QuoteRow[]=[];try{const doc=JSON.parse(quote||'null');if(Array.isArray(doc?.rows))rows=doc.rows.filter((r:QuoteRow)=>String(r.name||'').trim()&&Number(r.qty)>0);}catch{}
   const orderLines=lines.filter(l=>l.orderId===o.id);
   if(!rows.length||rows.length!==orderLines.length)valid=false;
   for(const l of orderLines){
    const r=rows[l.lineNo-1];
    if(!r||quoteStockSku(r)!==l.sku||String(r.name||'').trim()!==l.name.trim()){valid=false;continue;}
    // The quote editor and normalizer omit commission when none is configured.
    // An explicit but incomplete/invalid declaration is not the same as no commission.
    const c=r.commission;
    if(c!=null&&(typeof c!=='object'||Array.isArray(c)||(c.excluded!==undefined&&typeof c.excluded!=='boolean')||(c.mode!==undefined&&c.mode!=='percent'&&c.mode!=='amount')||
      (c.excluded!==true&&(typeof c.value!=='number'||!Number.isFinite(c.value)||c.value<0||c.value>(c.mode==='amount'?1e12:100))))){valid=false;continue;}
    // Source commission terms, actual order quantities/prices. Commission excludes printing, like quote profit.
    commission+=commissionOf({...r,price:Math.max(0,l.unitPrice-(o.quoteType==='HRC'?0:Number(r.printFee||0))),discount:0,qty:l.qty});
   }
  }else if(o.channel!=='pos')valid=false;
  details?.push({id:o.id,ownerId:o.ownerId,amount:valid?o.subtotal-commission:null});
  if(valid)m.netRevenue+=o.subtotal-commission;else m.netRevenueIssues++;
  out.set(o.ownerId,m);
 }
 return out;
}
