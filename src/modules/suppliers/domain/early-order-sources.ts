/** Shared by API and workbook preview; never guesses a supplier reference or changes a named order. */
export interface EarlyOrderSource {orderNo:string;supplierOrderNo:string;quantity:number}
export interface EarlySourceOrder {id?:string;lineId?:string;ticketNumber:string;internalNo?:string|null;unit:string;quantity:number;supplierId?:string|null}
export class EarlySourceError extends Error {
 constructor(message:string,public code:string){super(message);}
}
const key=(s:string)=>s.trim().toLocaleLowerCase('vi');
const orderKey=(o:EarlySourceOrder)=>o.id||key(o.ticketNumber);
const lineKey=(o:EarlySourceOrder)=>o.lineId||orderKey(o);
export function resolveEarlyOrderSources<T extends EarlySourceOrder>(orders:readonly T[],sources:readonly EarlyOrderSource[]){
 const remaining=new Map(orders.map(o=>[lineKey(o),Math.max(0,Math.floor(o.quantity))]));
 const groups=sources.map(source=>{
  const matches=orders.filter(o=>(!source.orderNo||key(o.ticketNumber)===key(source.orderNo))&&(!source.supplierOrderNo||key(o.internalNo||'')===key(source.supplierOrderNo)));
  const label=source.orderNo|| (source.supplierOrderNo?'số đơn NCC '+source.supplierOrderNo:'phạm vi đã chọn');
  if((source.orderNo||source.supplierOrderNo)&&new Set(matches.map(orderKey)).size>1)
   throw new EarlySourceError(`${label}: khớp nhiều đơn mua CRM. Điền Số đơn mua CRM hoặc chọn đúng NCC.`, 'EARLY_SOURCE_AMBIGUOUS');
  return {source,orders:matches,label,available:0,allocations:[] as {order:T;quantity:number}[]};
 });
 const units=new Set(groups.flatMap(g=>g.orders.map(o=>o.unit.trim())));
 if(units.size>1)throw new EarlySourceError('Đơn vị tính không thống nhất, cần kiểm tra lại đơn mua.','EARLY_UNIT_CONFLICT');
 const byLine=new Map<string,{order:T;quantity:number}>(),resolved=new Map<string,EarlyOrderSource>();
 // Named rows reserve their exact source before the automatic remainder is allocated.
 for(const g of [...groups].sort((a,b)=>Number(!a.source.orderNo&&!a.source.supplierOrderNo)-Number(!b.source.orderNo&&!b.source.supplierOrderNo))){
  g.available=g.orders.reduce((sum,o)=>sum+(remaining.get(lineKey(o))||0),0);
  if(!Number.isSafeInteger(g.source.quantity)||g.source.quantity<=0||!g.orders.length||g.source.quantity>g.available)
   throw new EarlySourceError(`Chỉ còn ${g.available.toLocaleString('vi-VN')} đang về tại ${g.label}. Không chuyển sang đơn khác.`,'EARLY_QUANTITY_EXCEEDED');
  let left=g.source.quantity;
  for(const order of g.orders){
   const k=lineKey(order),take=Math.min(left,remaining.get(k)||0);if(!take)continue;
   remaining.set(k,(remaining.get(k)||0)-take);left-=take;g.allocations.push({order,quantity:take});
   const prior=byLine.get(k);byLine.set(k,{order,quantity:(prior?.quantity||0)+take});
   const ok=orderKey(order),p=resolved.get(ok);
   resolved.set(ok,{orderNo:order.ticketNumber,supplierOrderNo:g.source.supplierOrderNo||p?.supplierOrderNo||'',quantity:(p?.quantity||0)+take});
   if(!left)break;
  }
 }
 return {groups,allocations:[...byLine.values()],sources:[...resolved.values()].sort((a,b)=>key(a.orderNo).localeCompare(key(b.orderNo))),unit:[...units][0]||''};
}
