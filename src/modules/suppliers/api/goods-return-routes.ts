import {and,asc,eq,inArray,isNull,sql} from 'drizzle-orm';
import {AppError} from '../../../core/errors.ts';
import {json,readJson,type Router,type RouteContext} from '../../../core/http/router.ts';
import type {StaffEnv,SessionState} from '../../staff/api/auth-routes.ts';
import {vietnamDate} from '../../sales/domain/sales.ts';
import {sha256Hex} from '../../staff/domain/session.ts';
import {assertFreeStock} from '../../sales/api/stock-free.ts';
import {lockLedger,postMoves,stockWarehouseByName} from '../../inventory/api/ledger.ts';
import {recordMovements} from '../../catalog/api/product-history.ts';
import {computeOrderTotals,purchaseUnitCost} from '../domain/order-totals.ts';
import {isIsoDate} from '../domain/quantity.ts';
import {canPay,canSeePurchasePrices,receiptProgress,supplierDebt} from '../domain/purchasing.ts';
import {incomingShipments,incomingShipmentLines,supplierReceipts,supplierReceiptLines,supplierPaymentSchedules,supplierPayments,receiptJobs,supplierGoodsReturns,supplierRefunds,supplierOrderEvents,supplierOrderSources} from '../schema.ts';
import {asActor,type Db} from './purchase-store.ts';
import {syncIncomingStock} from './incoming-stock.ts';

type Ctx=RouteContext<StaffEnv>;
function bad(status:number,message:string):never{throw new AppError(status,message);}
const text=(x:unknown,max=500)=>typeof x==='string'?x.trim().slice(0,max):'';
const member=(c:Ctx)=>(c.state.session as SessionState).member;
const today=()=>vietnamDate().iso;
const now=()=>new Date().toISOString();
function key(body:Record<string,unknown>){const k=text(body.clientKey,80);if(k.length<8)bad(400,'Thiếu mã chống bấm lặp.');return k;}
function date(x:unknown){const d=text(x,30);if(!isIsoDate(d)||d>today())bad(400,'Ngày nghiệp vụ không hợp lệ hoặc sau hôm nay.');return d;}
export function normalizeGoodsReturn(body:Record<string,unknown>){
 const mode=text(body.mode);if(!['credit','replacement','close'].includes(mode))bad(400,'Chọn trả giảm công nợ, giao bù hoặc huỷ phần chưa nhận.');
 const reason=text(body.reason);if(reason.length<5)bad(400,'Nhập lý do ít nhất 5 ký tự.');
 if(!Array.isArray(body.lines)||body.lines.length>200)bad(400,'Danh sách trả hàng tối đa 200 dòng.');
 const seen=new Set<string>();const lines=(body.lines as Record<string,unknown>[]).map(l=>{
  const lineId=text(l?.lineId,100),quantity=l?.quantity;
  if(!lineId||seen.has(lineId)||typeof quantity!=='number'||!Number.isFinite(quantity)||quantity<=0||quantity>1e7||Math.abs(Math.round(quantity*1000)-quantity*1000)>1e-6)bad(400,'Dòng hàng lặp hoặc số lượng không hợp lệ (tối đa 3 số lẻ).');
  seen.add(lineId);return{lineId,quantity:quantity as number};
 }).sort((a,b)=>a.lineId.localeCompare(b.lineId));
 if(mode!=='close'&&!lines.length)bad(400,'Chọn ít nhất một mã trả.');
 if(mode==='close'&&lines.length)bad(400,'Huỷ phần chưa nhận lấy toàn bộ số còn thiếu, không nhập dòng trả.');
 return{mode:mode as 'credit'|'replacement'|'close',receiptId:mode==='close'?null:text(body.receiptId,100),reason,returnedDate:date(body.returnedDate),lines,
  sapoReturnId:text(body.sapoReturnId,100)||null,sapoReturnCode:text(body.sapoReturnCode,100),evidenceNote:text(body.evidenceNote,1000),sapoChecked:body.sapoChecked===true};
}
/** No remote write is performed here. Sapo-linked receipts require explicit, audited manual reconciliation. */
// A financial preview must not fetch design-image blobs, receipt photos or payment attachments.
type ReturnOrder=Pick<typeof incomingShipments.$inferSelect,'id'|'depositRate'|'refundedAmount'>;
async function returnBasis(db:Db,o:ReturnOrder){
 const [lines,received,schedules,[paid]]=await Promise.all([
  db.select({id:incomingShipmentLines.id,sku:incomingShipmentLines.sku,name:incomingShipmentLines.name,unit:incomingShipmentLines.unit,quantity:incomingShipmentLines.quantity,creditedQty:incomingShipmentLines.creditedQty,price:incomingShipmentLines.price,taxRate:incomingShipmentLines.taxRate,printFee:incomingShipmentLines.printFee,purchaseDiscount:incomingShipmentLines.purchaseDiscount,confirmedPurchaseDiscount:incomingShipmentLines.confirmedPurchaseDiscount}).from(incomingShipmentLines).where(eq(incomingShipmentLines.shipmentId,o.id)),
  db.select({lineId:supplierReceiptLines.lineId,goodQty:sql<number>`sum(${supplierReceiptLines.goodQty}-${supplierReceiptLines.returnedGoodQty})`.mapWith(Number),damagedQty:sql<number>`sum(${supplierReceiptLines.damagedQty})`.mapWith(Number)}).from(supplierReceiptLines).innerJoin(supplierReceipts,eq(supplierReceiptLines.receiptId,supplierReceipts.id)).where(and(eq(supplierReceipts.shipmentId,o.id),isNull(supplierReceipts.cancelledAt))).groupBy(supplierReceiptLines.lineId),
  db.select({id:supplierPaymentSchedules.id,kind:supplierPaymentSchedules.kind,amount:supplierPaymentSchedules.amount,dueDate:supplierPaymentSchedules.dueDate}).from(supplierPaymentSchedules).where(eq(supplierPaymentSchedules.shipmentId,o.id)),
  db.select({amount:sql<number>`coalesce(sum(${supplierPayments.amount}),0)`.mapWith(Number)}).from(supplierPayments).where(and(eq(supplierPayments.shipmentId,o.id),isNull(supplierPayments.voidedAt))),
 ]);
 const totals=computeOrderTotals({rows:lines,depositRate:o.depositRate,paidAmount:0});
 return{raw:{lines,totals,progress:receiptProgress(lines,received),debt:supplierDebt(totals.total,schedules,[{amount:paid?.amount??0,paidDate:today(),voidedAt:null}],today(),o.refundedAmount)}};
}
const orderColumns={id:incomingShipments.id,source:incomingShipments.source,approvalStatus:incomingShipments.approvalStatus,cancelledAt:incomingShipments.cancelledAt,revision:incomingShipments.revision,depositRate:incomingShipments.depositRate,refundedAmount:incomingShipments.refundedAmount,supplierName:incomingShipments.supplierName,ticketNumber:incomingShipments.ticketNumber};
export function registerGoodsReturnRoutes(router:Router<StaffEnv>){
 for(const preview of [true,false])router.post('/purchase-orders/:id/returns'+(preview?'/preview':''),async c=>{
  if(c.env.supplierReturnsDisabled)bad(503,'Đang tạm dừng ghi trả hàng/hoàn tiền NCC để đối soát.');
  const m=member(c),actor=asActor(m);
  if(!actor.active||actor.role!=='manager'||!canSeePurchasePrices(actor,{approvalStatus:'approved'}))bad(403,'Chỉ Manager được duyệt trả hàng / huỷ phần chưa nhận.');
  const body=await readJson(c.req,60000),input=normalizeGoodsReturn(body),clientKey=key(body),hash=sha256Hex(JSON.stringify(input)),orderId=c.params.id!;
  const result=await c.env.db.transaction(async tx=>{
   // Shared source lock also serializes client-key use across different purchases.
   await tx.execute(sql`select pg_advisory_xact_lock(hashtext('supplier_order_sources'))`);
   await tx.execute(sql`select pg_advisory_xact_lock(hashtext('stock_holds'))`);
   const [o]=await tx.select(orderColumns).from(incomingShipments).where(eq(incomingShipments.id,orderId)).for('update');
   if(!o||o.source!=='supplier-order')bad(404,'Không tìm thấy đơn mua.');
   const [duplicate]=await tx.select().from(supplierGoodsReturns).where(eq(supplierGoodsReturns.clientKey,clientKey));
   if(duplicate){if(duplicate.shipmentId!==orderId||duplicate.requestHash!==hash)bad(409,'Mã chống bấm lặp đã dùng với nội dung khác.');if(preview)bad(409,'Phiếu này đã ghi sổ. Tải lại lịch sử, không lập thêm phiếu trùng.');return{duplicate:true,returnId:duplicate.id};}
   if(o!.cancelledAt||o!.approvalStatus!=='approved')bad(409,'Chỉ xử lý đơn đã duyệt, chưa huỷ.');
   if(typeof body.revision!=='number'||body.revision!==o!.revision)bad(409,'Đơn vừa thay đổi. Tải lại trước khi xử lý.');
   const p=await returnBasis(tx as unknown as Db,o!);
   const pricesComplete=p.raw.lines.every(l=>l.price!==null&&l.taxRate!==null&&Number.isFinite(l.price)&&Number.isFinite(l.taxRate)&&Number.isFinite(l.printFee));
   if(input.mode!=='replacement'&&p.raw.lines.some(l=>Math.abs(l.quantity*1000-Math.round(l.quantity*1000))>1e-6))bad(409,'Số lượng gốc có quá 3 số lẻ. Đối soát số lượng trước khi giảm công nợ.');
   if(input.mode!=='replacement'&&(!pricesComplete||!Number.isFinite(p.raw.totals.total)))bad(409,'Đơn còn thiếu giá/VAT đã xác nhận. Đối soát giá trước khi giảm công nợ.');
   let receipt:typeof supplierReceipts.$inferSelect|undefined,job:Pick<typeof receiptJobs.$inferSelect,'status'|'leaseToken'|'dispatchToken'|'updatedAt'>|undefined;
   let receiptLines:typeof supplierReceiptLines.$inferSelect[]=[];let warehouseId:string|null=null;
   if(input.mode!=='close'){
    [receipt]=await tx.select().from(supplierReceipts).where(and(eq(supplierReceipts.id,input.receiptId!),eq(supplierReceipts.shipmentId,orderId))).for('update');
    if(!receipt||receipt.cancelledAt)bad(409,'Phiếu nhận không thuộc đơn hoặc đã huỷ.');
    if(input.returnedDate<receipt!.receivedDate)bad(400,'Ngày trả không được trước ngày nhận.');
    [job]=await tx.select({status:receiptJobs.status,leaseToken:receiptJobs.leaseToken,dispatchToken:receiptJobs.dispatchToken,updatedAt:receiptJobs.updatedAt}).from(receiptJobs).where(eq(receiptJobs.receiptId,receipt!.id)).for('update');
    const linked=!!(receipt!.sapoVerifiedAt||receipt!.sapoReceiptId||receipt!.sapoPurchaseOrderId||receipt!.sapoReceiptCode||receipt!.sapoReceiptUrl);
    if(linked){
     if(!receipt!.sapoVerifiedAt||receipt!.sapoStatus!=='done'||job&&job.status!=='done'||job?.leaseToken||job?.dispatchToken)bad(409,'Phiếu Sapo chưa đối soát xong. Không trả/hủy khi kết quả nhập chưa rõ.');
     if(!input.sapoChecked||!input.sapoReturnId||!/^[1-9]\d{0,29}$/.test(input.sapoReturnId)||!input.sapoReturnCode||input.evidenceNote.length<10)bad(409,'Đã nhập Sapo: kiểm tra phiếu trả trên Sapo, nhập ID, mã phiếu và ghi chú đối soát trước khi ghi sổ CRM.');
     const [used]=await tx.select({id:supplierGoodsReturns.id}).from(supplierGoodsReturns).where(eq(supplierGoodsReturns.sapoReturnId,input.sapoReturnId));if(used)bad(409,'Phiếu trả Sapo này đã được ghi nhận trên CRM.');
    }else{
     if(receipt!.createSapo||receipt!.sapoStatus!=='not_needed'||job)bad(409,'Chưa xác định kết quả nhập Sapo. Đối soát phiếu nhận trước khi trả hàng.');
     if(input.sapoReturnId||input.sapoReturnCode||input.sapoChecked)bad(400,'Phiếu không nhập Sapo: không gắn chứng từ trả Sapo.');
    }
    receiptLines=await tx.select().from(supplierReceiptLines).where(and(eq(supplierReceiptLines.receiptId,receipt!.id),inArray(supplierReceiptLines.lineId,input.lines.map(l=>l.lineId))));
    warehouseId=await stockWarehouseByName(tx as unknown as Db,receipt!.warehouse);if(!warehouseId)bad(409,'Kho nhận không còn hợp lệ. Đối soát kho trước.');
   }else if(input.sapoReturnId||input.sapoReturnCode||input.sapoChecked)bad(400,'Huỷ hàng chưa nhận không tạo phiếu trả Sapo.');
   const wanted=input.mode==='close'?p.raw.progress.lines.filter(l=>l.missing>0).map(l=>({lineId:l.lineId,quantity:l.missing})):input.lines;
   if(wanted.length>200)bad(409,'Mỗi phiếu tối đa 200 mã. Đơn lớn hơn cần đối soát và chia phiếu trước khi xử lý.');
   if(!wanted.length)bad(409,'Không còn hàng chưa nhận để huỷ.');
   const allocations=await tx.select().from(supplierOrderSources).where(and(eq(supplierOrderSources.shipmentId,orderId),inArray(supplierOrderSources.lineId,wanted.map(l=>l.lineId)))).orderBy(asc(supplierOrderSources.createdAt),asc(supplierOrderSources.id));
   const lineById=new Map(p.raw.lines.map(l=>[l.id,l]));
   const items=wanted.map(w=>{
    const l=lineById.get(w.lineId);if(!l)bad(400,'Mã hàng không thuộc đơn mua.');
    const r=receiptLines.find(r=>r.lineId===w.lineId);
    if(input.mode!=='close'&&(!r||w.quantity>r.goodQty-r.returnedGoodQty+0.000001))bad(409,`${l!.sku}: trả vượt số đạt còn lại trên phiếu nhận.`);
    if(input.mode!=='replacement' && w.quantity>l!.quantity-l!.creditedQty+0.000001)bad(409,'Số lượng giảm công nợ vượt phần còn hiệu lực.');
    const before=computeOrderTotals({rows:[l!],depositRate:0,paidAmount:0});
    const after=computeOrderTotals({rows:[{...l!,creditedQty:l!.creditedQty+(input.mode==='replacement'?0:w.quantity)}],depositRate:0,paidAmount:0});
    if(input.mode!=='replacement'&&(l!.price===null||l!.taxRate===null||!Number.isFinite(l!.price)||!Number.isFinite(l!.taxRate)))bad(409,`${l!.sku}: thiếu giá/VAT đã xác nhận, chưa thể giảm công nợ.`);
    let release=input.mode==='replacement'?0:w.quantity;
    const releasedSources=allocations.filter(a=>a.lineId===l!.id).reverse().flatMap(a=>{const quantity=Math.min(release,a.quantity-a.cancelledQuantity);if(Math.abs(quantity*1000-Math.round(quantity*1000))>1e-6)bad(409,'Phân bổ nguồn có quá 3 số lẻ. Đối soát nguồn trước khi giảm công nợ.');release-=quantity;return quantity>0?[{id:a.id,no:a.sourceNo,quantity}]:[];});
    return{releasedSources,lineId:l!.id,sku:l!.sku,name:l!.name,quantity:w.quantity,unit:l!.unit,price:l!.price,purchaseDiscount:l!.confirmedPurchaseDiscount??l!.purchaseDiscount,taxRate:l!.taxRate,printFee:l!.printFee,
     unitCost:Number.isFinite(purchaseUnitCost(l!))?purchaseUnitCost(l!):null,creditSubtotal:input.mode==='replacement'?0:before.subtotal-after.subtotal,creditVat:input.mode==='replacement'?0:before.vat-after.vat,creditAmount:input.mode==='replacement'?0:before.total-after.total};
   });
   const creditAmount=items.reduce((sum,l)=>sum+l.creditAmount,0),netTotal=Math.max(0,p.raw.totals.total-creditAmount);
   const summary={mode:input.mode,items,warehouse:receipt?.warehouse??null,stockOut:input.mode==='close'?0:items.reduce((s,l)=>s+l.quantity,0),creditAmount,totalBefore:pricesComplete?p.raw.totals.total:null,totalAfter:pricesComplete?netTotal:null,
    paid:p.raw.debt.paid,refunded:p.raw.debt.refunded,balanceAfter:pricesComplete?Math.max(0,Math.round(netTotal-p.raw.debt.netPaid)):null,supplierCreditAfter:pricesComplete?Math.max(0,Math.round(p.raw.debt.netPaid-netTotal)):null,
    sapoResolution:receipt?.sapoVerifiedAt?'manual_reconciliation':'not_needed',confirmation:receipt?.receiptNo??o!.ticketNumber};
   const previewToken=sha256Hex(JSON.stringify({hash,revision:o!.revision,summary,receipt:receipt?[receipt.id,receipt.sapoUpdatedAt,receipt.sapoVerifiedAt]:null,job:job?.updatedAt??null}));
   if(preview)return{preview:true,...summary,previewToken};
   if(body.previewToken!==previewToken)bad(409,'Số liệu đã đổi hoặc chưa xem trước. Tải lại bản đối soát trước khi ghi sổ.');
   if(text(body.confirmation,100)!==summary.confirmation||body.confirm!==true)bad(400,'Xác nhận đúng số phiếu và số liệu trước khi ghi sổ.');
   const id=crypto.randomUUID(),stamp=now();
   if(warehouseId){
    await lockLedger(tx);
    await assertFreeStock(tx,warehouseId,items.map(l=>({sku:l.sku,qty:l.quantity})),{actor:m,context:{module:'suppliers',entityType:'supplier_goods_return',entityId:id,refNo:summary.confirmation}});
    await postMoves(tx,m.id,items.map(l=>({sku:l.sku,warehouseId:warehouseId!,qty:-l.quantity,kind:'supplier_return',refType:'supplier_return',refId:id,refNo:summary.confirmation,note:input.reason})),stamp);
   }
   await tx.insert(supplierGoodsReturns).values({id,shipmentId:orderId,receiptId:input.receiptId,mode:input.mode,returnedDate:input.returnedDate,reason:input.reason,warehouseId,items:JSON.stringify(items),creditAmount,
    sapoReturnId:input.sapoReturnId,sapoReturnCode:input.sapoReturnCode,evidenceNote:input.evidenceNote,clientKey,requestHash:hash,createdBy:m.id,createdAt:stamp});
   const quantityRows=JSON.stringify(items.map(l=>({id:l.lineId,qty:l.quantity})));
   const released=items.flatMap(l=>l.releasedSources);
   if(released.length)await tx.execute(sql`update ${supplierOrderSources} set cancelled_quantity=round((${supplierOrderSources.cancelledQuantity}::numeric+v.qty::numeric),3)::double precision
    from jsonb_to_recordset(${JSON.stringify(released.map(s=>({id:s.id,qty:s.quantity})))}::jsonb) as v(id text,qty double precision)
    where ${supplierOrderSources.id}=v.id and ${supplierOrderSources.shipmentId}=${orderId}`);
   if(input.mode!=='close')await tx.execute(sql`update ${supplierReceiptLines} set returned_good_qty=round((${supplierReceiptLines.returnedGoodQty}::numeric+v.qty::numeric),3)::double precision
    from jsonb_to_recordset(${quantityRows}::jsonb) as v(id text,qty double precision)
    where ${supplierReceiptLines.lineId}=v.id and ${supplierReceiptLines.receiptId}=${input.receiptId}`);
   if(input.mode!=='replacement')await tx.execute(sql`update ${incomingShipmentLines} set credited_qty=round((${incomingShipmentLines.creditedQty}::numeric+v.qty::numeric),3)::double precision
    from jsonb_to_recordset(${quantityRows}::jsonb) as v(id text,qty double precision)
    where ${incomingShipmentLines.id}=v.id and ${incomingShipmentLines.shipmentId}=${orderId}`);
   await tx.update(incomingShipments).set({revision:sql`${incomingShipments.revision}+1`,updatedAt:stamp,updatedBy:m.id,
    ...(input.mode==='replacement'?{receivedAt:null,receivedBy:null}:{}),...(input.mode==='close'?{remainderClosedAt:stamp,remainderCloseReason:input.reason}:{})}).where(eq(incomingShipments.id,orderId));
   // For manually reconciled Sapo returns, the Sapo import owns the product-history record.
   if(warehouseId&&!input.sapoReturnId)await recordMovements(tx,items.map(l=>({refKey:`supplier-return:${id}:${l.lineId}`,sku:l.sku,kind:'supplier_return',name:l.name,qty:l.quantity,unitPrice:l.unitCost,partner:o!.supplierName,location:receipt!.warehouse,refCode:summary.confirmation,status:'posted',note:input.reason,occurredAt:stamp})));
   await tx.insert(supplierOrderEvents).values({id:crypto.randomUUID(),shipmentId:orderId,actorId:m.id,at:stamp,action:'goods_return',summary:`${input.mode==='close'?'Huỷ phần chưa nhận':input.mode==='replacement'?'Trả NCC giao bù':'Trả NCC giảm công nợ'} · ${items.length} mã · giảm ${Math.round(creditAmount).toLocaleString('vi-VN')} đ · ${input.reason}`,data:JSON.stringify({returnId:id,manualSapo:!!input.sapoReturnId})});
   await syncIncomingStock(tx as unknown as Db,items.map(l=>l.sku));
   return{returnId:id,duplicate:false};
  });
  if('preview' in result)return json(result);
  return json(result,result.duplicate?200:201);
 },'business');
 router.post('/purchase-orders/:id/refunds',async c=>{
  if(c.env.supplierReturnsDisabled)bad(503,'Đang tạm dừng ghi trả hàng/hoàn tiền NCC để đối soát.');
  const m=member(c),actor=asActor(m);if(!canPay(actor)||!canSeePurchasePrices(actor,{approvalStatus:'approved'}))bad(403,'Chỉ người được ghi thanh toán và xem giá NCC được xác nhận tiền hoàn.');
  const body=await readJson(c.req,6000),clientKey=key(body),orderId=c.params.id!,amount=body.amount,receivedDate=date(body.receivedDate),method=text(body.method,20),reference=text(body.reference,120),note=text(body.note,1000);
  if(typeof amount!=='number'||!Number.isSafeInteger(amount)||amount<=0||amount>1e13||!['cash','transfer','other'].includes(method)||reference.length<3||body.confirmReceived!==true)bad(400,'Nhập số tiền nguyên dương, phương thức, số chứng từ và xác nhận đã thực nhận tiền hoàn.');
  const hash=sha256Hex(JSON.stringify({amount,receivedDate,method,reference,note}));
  const result=await c.env.db.transaction(async tx=>{
   await tx.execute(sql`select pg_advisory_xact_lock(hashtext('supplier_order_sources'))`);
   const [o]=await tx.select(orderColumns).from(incomingShipments).where(eq(incomingShipments.id,orderId)).for('update');if(!o||o.source!=='supplier-order')bad(404,'Không tìm thấy đơn mua.');
   const [duplicate]=await tx.select().from(supplierRefunds).where(eq(supplierRefunds.clientKey,clientKey));if(duplicate){if(duplicate.shipmentId!==orderId||duplicate.requestHash!==hash)bad(409,'Mã chống bấm lặp đã dùng với nội dung khác.');return{id:duplicate.id,duplicate:true};}
   if(o!.cancelledAt||o!.approvalStatus!=='approved')bad(409,'Đơn không cho ghi nhận tiền hoàn.');
   const [usedReference]=await tx.select({id:supplierRefunds.id}).from(supplierRefunds).where(and(eq(supplierRefunds.shipmentId,orderId),eq(supplierRefunds.method,method as 'cash'|'transfer'|'other'),sql`lower(trim(${supplierRefunds.reference}))=lower(trim(${reference}))`));
   if(usedReference)bad(409,'Số chứng từ hoàn tiền này đã ghi nhận trên đơn. Đối soát, không ghi thêm lần nữa.');
   const p=await returnBasis(tx as unknown as Db,o!);
   if(p.raw.lines.some(l=>l.price===null||l.taxRate===null)||!Number.isFinite(p.raw.totals.total))bad(409,'Chưa đủ giá/VAT để đối soát tiền hoàn.');
   if(amount>p.raw.debt.supplierCredit)bad(409,'Tiền hoàn vượt số NCC còn phải hoàn.');
   const id=crypto.randomUUID(),stamp=now();await tx.insert(supplierRefunds).values({id,shipmentId:orderId,amount,receivedDate,method:method as 'cash'|'transfer'|'other',reference,note,clientKey,requestHash:hash,createdBy:m.id,createdAt:stamp});
   await tx.update(incomingShipments).set({refundedAmount:sql`${incomingShipments.refundedAmount}+${amount}`,revision:sql`${incomingShipments.revision}+1`,updatedAt:stamp,updatedBy:m.id}).where(eq(incomingShipments.id,orderId));
   await tx.insert(supplierOrderEvents).values({id:crypto.randomUUID(),shipmentId:orderId,actorId:m.id,at:stamp,action:'supplier_refund',summary:`Đã nhận NCC hoàn ${amount.toLocaleString('vi-VN')} đ · ${reference}`,data:JSON.stringify({refundId:id})});return{id,duplicate:false};
  });return json(result,result.duplicate?200:201);
 },'business');
}
