import { earlyReceiptAvailability } from './early-receiving.ts';
import { eq } from 'drizzle-orm';
import { AppError } from '../../../core/errors.ts';
import { isIsoDate } from '../domain/quantity.ts';
import { purchaseEarlyRequests, purchaseEarlyRequestLines, purchaseEarlyRequestAllocations } from '../early-request-schema.ts';
import { suppliers as supplierTable } from '../schema.ts';
import { outstandingLines } from './incoming-stock.ts';
import type { Db } from './purchase-store.ts';

/** Purchase receipts and early-pickup requests are distinct rows; quantities are never added together. */
export async function receivingCalendar(db: Db, params: URLSearchParams, today: string, options: {paginate?:boolean; reminderOnly?:boolean} = {}) {
  const from = params.get('from') || '', to = params.get('to') || '';
  if ((from && !isIsoDate(from)) || (to && !isIsoDate(to)) || (from && to && from > to))
    throw new AppError(400, 'Khoảng ngày nhận hàng không hợp lệ.');
  const state = params.get('state') || '', supplier = params.get('supplierId') || '', type = params.get('type') || '';
  if (!['', 'late', 'scheduled', 'undated'].includes(state)) throw new AppError(400, 'Trạng thái lịch nhận không hợp lệ.');
  if (!['', 'purchase', 'early'].includes(type)) throw new AppError(400, 'Loại phiếu không hợp lệ.');
  const fold = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').toLowerCase();
  const q = fold((params.get('q') || '').trim().slice(0, 100)), sku = fold((params.get('sku') || '').trim().slice(0, 200));
  const all = await outstandingLines(db);
  const early = type === 'purchase' ? [] : await db.select({request:purchaseEarlyRequests,line:purchaseEarlyRequestLines,allocation:purchaseEarlyRequestAllocations,supplierName:supplierTable.name})
    .from(purchaseEarlyRequests).innerJoin(purchaseEarlyRequestLines,eq(purchaseEarlyRequestLines.requestId,purchaseEarlyRequests.id))
    .innerJoin(purchaseEarlyRequestAllocations,eq(purchaseEarlyRequestAllocations.requestLineId,purchaseEarlyRequestLines.id))
    .innerJoin(supplierTable,eq(supplierTable.id,purchaseEarlyRequestAllocations.supplierId));
  const suppliers = [...new Map([...all.map(l => ({id:l.supplierId,name:l.supplierName})),...early.map(l=>({id:l.allocation.supplierId,name:l.supplierName}))].map(s=>[s.id,s])).values()]
    .sort((a, b) => a.name.localeCompare(b.name, 'vi'));
  type Line = {lineId:string;sku:string;name:string;unit:string;left:number;requestedQty?:number;status?:string;canConfirm?:boolean;receiptOptions?:{orderId:string;ticketNumber:string;remaining:number}[]};
  type Row = {type:'purchase'|'early';orderId:string;requestId?:string;supplierId:string|null;ticketNumber:string;supplierName:string;date:string|null;createdAt:string;lines:Line[]};
  const groups = new Map<string,Row>();
  const matchesDate = (date:string|null) => !(date && ((from && date < from) || (to && date > to))) &&
    !(state === 'late' && (!date || date >= today)) && !(state === 'scheduled' && (!date || date < today)) && !(state === 'undated' && date);
  for (const l of type === 'early' ? [] : all) {
    const date = l.promisedDate || l.arrivalDate || null;
    if ((supplier && l.supplierId !== supplier) || !matchesDate(date)) continue;
    if (sku && !fold(l.sku).includes(sku)) continue;
    if (q && !fold([l.ticketNumber, l.internalNo, l.supplierName, l.sku, l.name].join(' ')).includes(q)) continue;
    const key = 'purchase:' + l.orderId + ':' + (date || '');
    let group = groups.get(key);
    if (!group) {
      group = {type:'purchase',orderId:l.orderId,supplierId:l.supplierId,ticketNumber:l.ticketNumber,supplierName:l.supplierName,date,createdAt:l.createdAt,lines:[]};
      groups.set(key,group);
    }
    group.lines.push({lineId:l.lineId,sku:l.sku,name:l.name,unit:l.unit,left:l.left});
  }
  const receiptAvailability=new Map((await earlyReceiptAvailability(db,[...new Set(early.map(e=>e.request.id))])).map(r=>[r.allocationId,r]));
  const outstanding = new Map(all.map(l=>[l.lineId,l]));
  const ownLines=new Map<string,{quantity:number;statuses:string[]}>();
  for(const e of early){const key=e.line.id+':'+e.allocation.supplierId;const own=ownLines.get(key)||{quantity:0,statuses:[]};own.quantity+=e.allocation.quantity;own.statuses.push(e.allocation.status);ownLines.set(key,own);}
  for (const {request,line,allocation,supplierName} of early) {
    if(options.reminderOnly&&(request.status!=='submitted'||allocation.status==='rejected'))continue;
    const receipt=receiptAvailability.get(allocation.id);
    if(allocation.status==='accepted'&&request.status==='submitted'&&!receipt?.remaining)continue;
    const purchase = outstanding.get(allocation.purchaseLineId);
    if (!purchase || (supplier && allocation.supplierId !== supplier)) continue;
    const date = request.pickupDate || null;
    if (!matchesDate(date) || (sku && !fold(line.sku).includes(sku))) continue;
    if (q && !fold(['Phiếu xin lấy trước',request.id,purchase.ticketNumber,supplierName,line.sku,line.name].join(' ')).includes(q)) continue;
    const key = 'early:'+request.id+':'+allocation.supplierId;
    let group=groups.get(key);
    if(!group){group={type:'early',orderId:purchase.orderId,requestId:request.id,supplierId:allocation.supplierId,ticketNumber:'Phiếu xin lấy trước',supplierName,date,createdAt:request.createdAt,lines:[]};groups.set(key,group);}
    let saved=group.lines.find(l=>l.lineId===line.id);
    if(!saved){const own=ownLines.get(line.id+':'+allocation.supplierId)!;saved={lineId:line.id,sku:line.sku,name:line.name,unit:line.unit,left:0,requestedQty:own.quantity,
      status:request.status==='draft'?'draft':own.statuses.every(s=>s===own.statuses[0])?own.statuses[0]!:'mixed',
      receiptOptions:[],canConfirm:request.status==='submitted'&&own.statuses.every(s=>s==='pending')};group.lines.push(saved);}
    saved.left+=allocation.status==='accepted'&&request.status==='submitted'?(receipt?.remaining??0):Math.min(allocation.quantity,purchase.left);
    if(receipt?.remaining)saved.receiptOptions!.push({orderId:receipt.orderId,ticketNumber:receipt.ticketNumber,remaining:receipt.remaining});
  }
  const rows=[...groups.values()].sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||a.type.localeCompare(b.type)||a.ticketNumber.localeCompare(b.ticketNumber)||a.orderId.localeCompare(b.orderId)||(a.date||'').localeCompare(b.date||''));
  const offset=Math.max(0,Math.floor(Number(params.get('offset'))||0)),limit=50;
  return {suppliers,total:rows.length,orderCount:new Set(rows.map(r=>r.type+':'+(r.requestId||r.orderId))).size,
    overdue:rows.filter(r=>r.date&&r.date<today).length,undated:rows.filter(r=>!r.date).length,
    rows:options.paginate===false?rows:rows.slice(offset,offset+limit),offset,limit,today};
}
