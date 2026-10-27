import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm';
import { AppError } from '../../../core/errors.ts';
import { purchaseEarlyRequests as requests, purchaseEarlyRequestLines as lines, purchaseEarlyRequestAllocations as allocations } from '../early-request-schema.ts';
import { incomingBySku } from './incoming-by-sku.ts';
import type { Db } from './purchase-store.ts';

/** Presentation-only view. Requests annotate existing incoming goods; they never add inventory or change sourcing availability. */
export async function incomingBySkuView(db: Db, query: URLSearchParams, today: string) {
  const type = query.get('type') || 'all';
  if (!['all','purchase','early'].includes(type)) throw new AppError(400,'Loại phiếu hàng đang về không hợp lệ.');
  const base = await incomingBySku(db,query,today,false);
  const sources = new Map(base.rows.flatMap(row=>row.orders.map(order=>[order.lineId,{row,order}] as const)));
  const saved = type==='purchase'||!sources.size ? [] : await db.select({request:requests,line:lines,allocation:allocations})
    .from(requests).innerJoin(lines,eq(lines.requestId,requests.id)).innerJoin(allocations,eq(allocations.requestLineId,lines.id))
    .where(and(isNull(requests.deletedAt),inArray(allocations.purchaseLineId,[...sources.keys()]))).orderBy(desc(requests.createdAt),desc(requests.id),asc(lines.lineNo),asc(allocations.id));
  type Early = {id:string;ticketNumber:string;lineId:string;createdAt:string;pickupDate:string;requestStatus:string;status:string;quantity:number;supplierId:string;supplierName:string;orders:{id:string;ticketNumber:string;quantity:number}[]};
  const bySku = new Map<string,Map<string,{value:Early;statuses:string[]}>>();
  for(const {request,line,allocation} of saved){
    const source=sources.get(allocation.purchaseLineId)!;
    if(line.sku!==source.row.sku||allocation.supplierId!==source.order.supplierId)continue;
    const grouped=bySku.get(line.sku)||new Map<string,{value:Early;statuses:string[]}>();bySku.set(line.sku,grouped);
    const key=request.id+':'+allocation.supplierId;
    let entry=grouped.get(key);
    if(!entry){entry={value:{id:request.id,ticketNumber:request.ticketNumber,lineId:line.id,createdAt:request.createdAt,pickupDate:request.pickupDate,requestStatus:request.status,status:'',quantity:0,
      supplierId:allocation.supplierId,supplierName:source.order.supplierName,orders:[]},statuses:[]};grouped.set(key,entry);}
    entry.value.quantity+=allocation.quantity;entry.statuses.push(allocation.status);
    entry.value.orders.push({id:source.order.id,ticketNumber:source.order.ticketNumber,quantity:allocation.quantity});
  }
  const rows=base.rows.map(row=>{
    const earlyRequests=[...(bySku.get(row.sku)?.values()||[])].map(({value,statuses})=>({...value,status:value.requestStatus==='draft'?'draft':statuses.every(s=>s==='accepted')?'accepted':statuses.every(s=>s==='rejected')?'rejected':statuses.some(s=>s==='pending')?'pending':'mixed'}));
    return {...row,earlyRequests,earlyQuantity:earlyRequests.reduce((sum,r)=>sum+r.quantity,0)};
  }).filter(row=>type!=='early'||row.earlyRequests.length>0);
  if(type==='early')rows.sort((a,b)=>(b.earlyRequests[0]?.createdAt||'').localeCompare(a.earlyRequests[0]?.createdAt||'')||a.sku.localeCompare(b.sku,'vi'));
  return {...base,documentType:type,rows:rows.slice(base.offset,base.offset+base.limit),total:rows.length,
    kpis:{skus:rows.length,quantity:rows.reduce((sum,r)=>sum+r.quantity,0),suppliers:new Set(rows.flatMap(r=>r.orders.map(o=>o.supplierId).filter(Boolean))).size,
      overdueOrders:new Set(rows.flatMap(r=>r.orders.filter(o=>o.due&&o.due<today).map(o=>o.id))).size,
      earlyRequests:new Set(rows.flatMap(r=>r.earlyRequests.map(e=>e.id))).size,earlyQuantity:rows.reduce((sum,r)=>sum+r.earlyQuantity,0)}};
}
