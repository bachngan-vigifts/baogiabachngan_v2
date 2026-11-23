import {and,eq,inArray,sql} from 'drizzle-orm';
import type {Router,RouteContext} from '../../../core/http/router.ts';
import {json,readJson} from '../../../core/http/router.ts';
import {AppError} from '../../../core/errors.ts';
import {auditLogs} from '../../../core/db/schema.ts';
import type {PurchaseLineInput} from '../../../core/contracts/purchase-amend.ts';
import type {StaffEnv,SessionState} from '../../staff/api/auth-routes.ts';
import {vietnamDate} from '../../sales/domain/sales.ts';
import {incomingShipments as orders,incomingShipmentLines as lines,supplierOrderSources as sources,supplierReceipts,supplierPayments,supplierRefunds,supplierGoodsReturns,incomingShipmentFiles,supplierPaymentSchedules,receiptJobs,supplierOrderEvents} from '../schema.ts';
import {purchaseEarlyRequestAllocations} from '../early-request-schema.ts';
import {supplierPortalDeliveries,supplierPortalInvoices,supplierTransferShares} from '../workspace-schema.ts';
import {loadPurchase,loadSourceNeed,type Db,type Member} from './purchase-store.ts';
import {computeOrderTotals} from '../domain/order-totals.ts';
import {buildSchedules} from '../domain/purchasing.ts';
import {isIsoDate} from '../domain/quantity.ts';
type Tx=Parameters<Parameters<Db['transaction']>[0]>[0];
type Needs=Map<string,Awaited<ReturnType<typeof loadSourceNeed>>>;
const fail=(status:number,message:string,code?:string):never=>{throw new AppError(status,message,code);};
const text=(v:unknown,max=2000)=>String(v??'').trim().slice(0,max);
async function snapshot(db:Db,id:string){
 const [[order],rows,links,schedules]=await Promise.all([db.select().from(orders).where(eq(orders.id,id)),db.select().from(lines).where(eq(lines.shipmentId,id)).orderBy(lines.lineNo),db.select().from(sources).where(eq(sources.shipmentId,id)).orderBy(sources.id),db.select().from(supplierPaymentSchedules).where(eq(supplierPaymentSchedules.shipmentId,id)).orderBy(supplierPaymentSchedules.id)]);
 return {order:order!,lines:rows,sources:links,schedules};
}
/** Any historical document protects the original commercial facts, including void/cancelled/net-zero records. */
async function blockers(db:Db,id:string){
 const count=sql<number>`count(*)`.mapWith(Number);
 const checks=await Promise.all([
 db.select({count}).from(supplierReceipts).where(eq(supplierReceipts.shipmentId,id)),
 db.select({count}).from(supplierPayments).where(eq(supplierPayments.shipmentId,id)),
 db.select({count}).from(supplierGoodsReturns).where(eq(supplierGoodsReturns.shipmentId,id)),
 db.select({count}).from(supplierRefunds).where(eq(supplierRefunds.shipmentId,id)),
 db.select({count}).from(incomingShipmentFiles).where(eq(incomingShipmentFiles.shipmentId,id)),
 db.select({count}).from(supplierPortalDeliveries).where(eq(supplierPortalDeliveries.shipmentId,id)),
 db.select({count}).from(purchaseEarlyRequestAllocations).innerJoin(lines,eq(lines.id,purchaseEarlyRequestAllocations.purchaseLineId)).where(eq(lines.shipmentId,id)),
 db.select({count}).from(receiptJobs).innerJoin(supplierReceipts,eq(supplierReceipts.id,receiptJobs.receiptId)).where(eq(supplierReceipts.shipmentId,id)),
 db.select({count}).from(sources).where(and(eq(sources.shipmentId,id),sql`${sources.cancelledQuantity}>0`)),
 db.select({count}).from(supplierPortalInvoices).where(eq(supplierPortalInvoices.shipmentId,id)),
 db.select({count}).from(supplierTransferShares).where(eq(supplierTransferShares.shipmentId,id)),
 ]);
 const names=['Phiếu nhận hàng','Thanh toán/cọc (kể cả đã huỷ)','Trả hàng/huỷ phần còn lại','Tiền hoàn NCC','File ký','Phiếu giao NCC','Phân bổ lấy hàng trước','Job nhận hàng','Nguồn đã giảm/huỷ','Hoá đơn NCC','Chia sẻ điều chuyển với NCC'];
 return checks.flatMap((rows,i)=>rows[0]?.count?[{kind:names[i]!,count:rows[0].count}]:[]);
}
const guard=(m:Member)=>{if(!m.active||m.role!=='manager')fail(403,'Chỉ Manager đang hoạt động được điều chỉnh đơn NCC đã duyệt.');};
const scalarBlocks=(o:typeof orders.$inferSelect)=>o.receivedAt||o.deliveryNoteId||o.supplierSignatureDownloadedAt||o.sapoReceiptId||o.depositRequestedAt||o.refundedAmount>0?[{kind:'Mốc nhận hàng/chứng từ ký hoặc liên kết giao nhận đã có',count:1}]:[];
export function registerPurchaseAmendRoutes(router:Router<StaffEnv>,deps:{
 cleanLines:(raw:unknown,prices:boolean)=>PurchaseLineInput[];
 checkSources:(db:Db,m:Member,orders:PurchaseLineInput[][],except?:string)=>Promise<Needs>;
 insertLines:(tx:Tx,id:string,lines:PurchaseLineInput[],needs:Needs,offset?:number)=>Promise<void>;
 view:(c:RouteContext<StaffEnv>,id:string)=>Promise<unknown>;
}){
 router.get('/purchase-orders/:id/amend',async c=>{
  const m=(c.state.session as SessionState).member;guard(m);const p=await loadPurchase(c.env.db,m,c.params.id!,vietnamDate().iso);
  if(p.raw.order.approvalStatus!=='approved'||p.raw.order.cancelledAt)fail(409,'Chỉ điều chỉnh đơn đã duyệt và chưa huỷ.');
  const protectedBy=[...await blockers(c.env.db,c.params.id!),...scalarBlocks(p.raw.order)];
  return json({revision:p.raw.order.revision,blockers:protectedBy,noteOnly:protectedBy.length>0,order:p.view});
 },'business');
 router.post('/purchase-orders/:id/amend',async c=>{
  const m=(c.state.session as SessionState).member;guard(m);const id=c.params.id!,body=await readJson(c.req,400000),reason=text(body.reason);
  if(typeof body.reason!=='string'||body.reason.length>2000||!reason||!Number.isSafeInteger(body.revision)||Number(body.revision)<1)fail(400,'Cần phiên bản hiện tại và lý do điều chỉnh.');
  const permitted=new Set(['revision','reason','note','supplierId','warehouse','arrivalDate','lines','payment']);for(const key of Object.keys(body))if(!permitted.has(key))fail(400,'Trường điều chỉnh không được hỗ trợ: '+key);
  await c.env.db.transaction(async tx=>{
   await tx.execute(sql`select pg_advisory_xact_lock(hashtext('supplier_order_sources'))`);
   const [o]=await tx.select().from(orders).where(eq(orders.id,id)).for('update');if(!o||o.source!=='supplier-order')fail(404,'Không tìm thấy đơn mua.');
   if(o!.approvalStatus!=='approved'||o!.cancelledAt)fail(409,'Chỉ điều chỉnh đơn đã duyệt và chưa huỷ.');
   if(o!.revision!==body.revision)fail(409,'Đơn đã thay đổi. Giữ nội dung đang nhập, tải lại để đối chiếu trước khi gửi.','PURCHASE_AMEND_STALE');
   if(body.supplierId!==undefined&&body.supplierId!==o!.supplierId)fail(409,'Không đổi NCC trên đơn đã duyệt; huỷ đơn phù hợp rồi lập đơn mới.','PURCHASE_AMEND_SUPPLIER');
   const db=tx as unknown as Db,before=await snapshot(db,id),protectedBy=[...await blockers(db,id),...scalarBlocks(o!)],commercialKeys=['lines','payment','warehouse','arrivalDate'];
   if(protectedBy.length&&commercialKeys.some(key=>Object.hasOwn(body,key)))fail(409,'Đơn đã có '+protectedBy.map(b=>b.kind).join(', ')+'. Chỉ sửa ghi chú nội bộ; xử lý hàng/tiền qua Trả hàng hoặc Huỷ phần chưa nhận và đối soát tiền hoàn.','PURCHASE_AMEND_PROTECTED');
   const patch:Partial<typeof orders.$inferInsert>={};let commercial=false;
   if(Object.hasOwn(body,'note'))patch.note=text(body.note);
   if(Object.hasOwn(body,'warehouse')){const value=text(body.warehouse,500);if(!value)fail(400,'Địa chỉ giao hàng không được trống.');patch.warehouse=value;commercial ||= value!==o!.warehouse;}
   if(Object.hasOwn(body,'arrivalDate')){if(body.arrivalDate&& !isIsoDate(body.arrivalDate))fail(400,'Ngày giao không hợp lệ.');patch.arrivalDate=body.arrivalDate?String(body.arrivalDate):null;commercial ||= patch.arrivalDate!==o!.arrivalDate;}
   if(Object.hasOwn(body,'lines')){
    if(!Array.isArray(body.lines))fail(400,'Dòng hàng không hợp lệ.');
    const raw=body.lines as Record<string,unknown>[],oldBySku=new Map(before.lines.map(l=>[l.sku.toLowerCase(),l]));
    const normalized=raw.map(r=>{if(!r||typeof r!=='object'||Array.isArray(r))fail(400,'Dòng hàng không hợp lệ.');if(r.sources!==undefined&&!Array.isArray(r.sources))fail(400,'Nguồn dòng hàng không hợp lệ.');const old=oldBySku.get(text(r.sku,200).toLowerCase());if(old&&r.lineId!==old.id)fail(400,'Phải giữ ID dòng cũ của '+old.sku);if(!old&&r.lineId)fail(400,'ID dòng không thuộc đơn/mã hàng.');return {...(old??{}),purchaseDiscount:old?.confirmedPurchaseDiscount??old?.purchaseDiscount??0,...r,sources:r.sources??before.sources.filter(s=>s.lineId===old?.id).map(s=>({type:s.sourceType,id:s.sourceId,quantity:s.quantity}))};});
    const cleaned=deps.cleanLines(normalized,true);for(const l of cleaned)if(new Set(l.sources.map(s=>s.type+':'+s.id)).size!==l.sources.length)fail(400,'Nguồn bị lặp trong dòng '+l.sku+'; cần đối soát phân bổ.');if(cleaned.some(l=>l.price===null))fail(400,'Cần đủ giá mua của mọi dòng trước khi điều chỉnh.');
    const rate=(value:unknown,max:number,label:string)=>{const n=Number(value??0);if(!Number.isFinite(n)||n<0||n>max)fail(400,label+' không hợp lệ.');return n;};
    const revised=cleaned.map((l,i)=>({...l,purchaseDiscount:rate(normalized[i]!.purchaseDiscount,100,'Chiết khấu'),printFee:rate(normalized[i]!.printFee,1e12,'Phí in'),promisedDate:normalized[i]!.promisedDate?String(normalized[i]!.promisedDate):''}));
    for(const l of revised)if(l.promisedDate&&!isIsoDate(l.promisedDate))fail(400,'Ngày hẹn dòng hàng không hợp lệ.');
    const needs=await deps.checkSources(db,m,[revised],id);
    const canonical=(rows:{sku:string;name:string;unit:string;quantity:number;price:number|null;taxRate:number|null;purchaseDiscount:number;printFee:number;promisedDate:string;sources:{type:string;id:string;quantity:number}[]}[])=>JSON.stringify(rows.map(l=>({sku:l.sku.toLowerCase(),name:l.name,unit:l.unit,quantity:l.quantity,price:l.price,taxRate:l.taxRate,purchaseDiscount:l.purchaseDiscount,printFee:l.printFee,promisedDate:l.promisedDate,sources:[...l.sources].sort((a,b)=>(a.type+':'+a.id).localeCompare(b.type+':'+b.id))})).sort((a,b)=>a.sku.localeCompare(b.sku)));
    const prior=before.lines.map(l=>({sku:l.sku,name:l.name,unit:l.unit,quantity:l.quantity,price:l.price,taxRate:l.taxRate,purchaseDiscount:l.confirmedPurchaseDiscount??l.purchaseDiscount??0,printFee:l.printFee,promisedDate:l.promisedDate,sources:before.sources.filter(s=>s.lineId===l.id).map(s=>({type:s.sourceType,id:s.sourceId,quantity:s.quantity}))}));
    const next=revised.map(l=>({...l,name:l.name||oldBySku.get(l.sku.toLowerCase())?.name||'',unit:l.unit||oldBySku.get(l.sku.toLowerCase())?.unit||''}));
    const changed=canonical(prior)!==canonical(next);
    if(changed){
    const retained=new Set(revised.flatMap(l=>oldBySku.get(l.sku.toLowerCase())?[oldBySku.get(l.sku.toLowerCase())!.id]:[]));
    const removed=before.lines.filter(l=>!retained.has(l.id));if(removed.length){await tx.delete(sources).where(inArray(sources.lineId,removed.map(l=>l.id)));await tx.delete(lines).where(inArray(lines.id,removed.map(l=>l.id)));}
    const maxNo=Math.max(0,...before.lines.map(l=>l.lineNo));let added=0;
    for(const l of revised){const old=oldBySku.get(l.sku.toLowerCase());
     if(!old){await deps.insertLines(tx,id,[l],needs,maxNo+added++);const [inserted]=await tx.select({id:lines.id}).from(lines).where(and(eq(lines.shipmentId,id),eq(lines.sku,l.sku)));await tx.update(lines).set({printFee:l.printFee,promisedDate:l.promisedDate}).where(eq(lines.id,inserted!.id));continue;}
     await tx.update(lines).set({name:l.name||old.name,unit:l.unit||old.unit,quantity:l.quantity,price:l.price,taxRate:l.taxRate,purchaseDiscount:l.purchaseDiscount,printFee:l.printFee,promisedDate:l.promisedDate,confirmedPurchaseDiscount:null,supplierConfirmed:false}).where(eq(lines.id,old.id));
     const keys=new Set(l.sources.map(s=>s.type+':'+s.id));const deleted=before.sources.filter(s=>s.lineId===old.id&&!keys.has(s.sourceType+':'+s.sourceId));if(deleted.length)await tx.delete(sources).where(inArray(sources.id,deleted.map(s=>s.id)));
     for(const source of l.sources){const existing=before.sources.find(s=>s.lineId===old.id&&s.sourceType===source.type&&s.sourceId===source.id);if(existing)await tx.update(sources).set({quantity:source.quantity}).where(eq(sources.id,existing.id));else{const need=needs.get(source.type+':'+source.id)!;await tx.insert(sources).values({id:crypto.randomUUID(),shipmentId:id,lineId:old.id,sourceType:source.type as 'quote',sourceId:source.id,sourceNo:need.no,customerName:need.customerName,sku:old.sku,quantity:source.quantity,createdAt:new Date().toISOString()});}}
    }
     commercial=true;
    }
   }
   if(Object.hasOwn(body,'payment'))commercial=true;
   const at=new Date().toISOString();
   if(commercial){
    await tx.update(lines).set({purchaseDiscount:sql`coalesce(${lines.confirmedPurchaseDiscount},${lines.purchaseDiscount})`,supplierConfirmed:false,confirmedPurchaseDiscount:null}).where(eq(lines.shipmentId,id));
    const rows=await tx.select().from(lines).where(eq(lines.shipmentId,id)),total=computeOrderTotals({rows,depositRate:0,paidAmount:0}).total;
    // The existing schedule builder and money math remain authoritative.
    let plan:ReturnType<typeof buildSchedules>;
    if(Object.hasOwn(body,'payment')){if(!body.payment||typeof body.payment!=='object'||Array.isArray(body.payment))fail(400,'Kế hoạch trả không hợp lệ.');const payment=body.payment as Parameters<typeof buildSchedules>[1];plan=buildSchedules(total,payment);patch.depositRate=payment.deposit?.mode==='percent'?Number(payment.deposit.value):payment.deposit?.mode==='none'||!payment.deposit?0:null;}else{
     const deposits=before.schedules.filter(s=>s.kind==='deposit'),installments=before.schedules.filter(s=>s.kind==='installment');
     if(deposits.length>1||before.schedules.some(s=>s.amount!==Math.round(s.amount)))fail(409,'Lịch trả cũ cần đối soát. Cập nhật kế hoạch cùng điều chỉnh.');
     const deposit=deposits[0];
     try{plan=buildSchedules(total,{deposit:deposit?{mode:o!.depositRate!=null&&o!.depositRate>0?'percent':'amount',value:o!.depositRate!=null&&o!.depositRate>0?o!.depositRate:deposit.amount,dueDate:deposit.dueDate}:{mode:'none'},installments:installments.map(({amount,dueDate})=>({amount,dueDate})),balanceDueDate:before.schedules.find(s=>s.kind==='balance')?.dueDate??null});}
     catch(error){if(error instanceof AppError&&error.status===400)fail(409,'Lịch cọc/trả đã hẹn không phù hợp tổng mới. Cập nhật kế hoạch cùng điều chỉnh.');throw error;}

    }
    await tx.delete(supplierPaymentSchedules).where(eq(supplierPaymentSchedules.shipmentId,id));if(plan.length)await tx.insert(supplierPaymentSchedules).values(plan.map(s=>({id:crypto.randomUUID(),shipmentId:id,...s,createdAt:at})));
    Object.assign(patch,{supplierStatus:'pending',supplierConfirmedAt:null,supplierConfirmedBy:null,confirmedOnBehalf:false});
   }
   if(!commercial&&(patch.note===undefined||patch.note===o!.note))return;
   await tx.update(orders).set({...patch,revision:o!.revision+1,updatedAt:at,updatedBy:m.id}).where(eq(orders.id,id));
   const after=await snapshot(db,id),auditId=crypto.randomUUID();
   await tx.insert(auditLogs).values({id:auditId,actorId:m.id,module:'suppliers',action:'amend',entityType:'purchase-order',entityId:id,data:JSON.stringify({reason,before,after}),createdAt:at});
   await tx.insert(supplierOrderEvents).values({id:crypto.randomUUID(),shipmentId:id,actorId:m.id,action:'amend',at,summary:'Manager điều chỉnh đơn: '+reason+(commercial?' · chờ NCC xác nhận lại':' · chỉ ghi chú nội bộ'),data:JSON.stringify({auditId,commercial,revision:after.order.revision})});
  });
  return json(await deps.view(c,id));
 },'business');
}
