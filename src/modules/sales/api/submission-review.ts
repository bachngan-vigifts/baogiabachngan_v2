import {eq,sql} from 'drizzle-orm';
import {AppError} from '../../../core/errors.ts';
import {auditLogs} from '../../../core/db/schema.ts';
import {json,readJson,type Router,type RouteContext} from '../../../core/http/router.ts';
import type {StaffEnv,SessionState} from '../../staff/api/auth-routes.ts';
import {sha256Hex} from '../../staff/domain/session.ts';
import {quotations} from '../../quotes/schema.ts';
import {printingInfo,type QuoteDoc} from '../../quotes/domain/quote-math.ts';
import {notifyMany} from '../../notifications/api/routes.ts';
import {salesOrders,salesContracts,salesOrderLines} from '../schema.ts';
import {orderRecipient,quoteNoteTerms,syncOrderDeliveryNotes} from '../domain/order-notes.ts';
import {normalizeSubmissionReview,readSubmissionRecord,submissionQuoteBasis,submissionReviewProblem,submissionPaymentLabel,type SubmissionReview,type SubmissionRecord} from '../domain/submission-review.ts';
type Ctx=RouteContext<StaffEnv>;type Db=StaffEnv['db'];type Tx=Parameters<Parameters<Db['transaction']>[0]>[0];
const viewer=(c:Ctx)=>(c.state.session as SessionState).member;
export const submissionQuoteFingerprint=(doc:Record<string,any>)=>sha256Hex(submissionQuoteBasis(doc));
export function submissionDeliveryFingerprint(doc:Record<string,any>){const terms=quoteNoteTerms(doc.notes);return sha256Hex(JSON.stringify([doc.deliveryDate||doc.delivery_date||'',doc.customerAddress||'',terms.time,terms.address,doc.contractDocument?.details?.deliveryAddress||'',doc.contractDocument?.details?.deliveryTime||'']));}
function needsPrinting(doc:QuoteDoc){return printingInfo(doc).enabled||doc.rows.some(r=>/\bin logo\b|\bkhac logo\b/.test(String(r.name||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()));}
export function registerSubmissionReview(router:Router<StaffEnv>,loadOrder:(c:Ctx,id:string,db?:Db|Tx)=>Promise<typeof salesOrders.$inferSelect>,canEdit:(c:Ctx,o:typeof salesOrders.$inferSelect,what?:string,db?:Db|Tx)=>Promise<unknown>){
 router.get('/orders/:id/submission-review',async c=>{
  const order=await loadOrder(c,c.params.id!);await canEdit(c,order);
  if(order.status!=='draft'||order.channel!=='crm')throw new AppError(409,'Chỉ gửi duyệt đơn hàng/HĐKT CRM còn nháp.');
  const [quote]=order.quoteId?await c.env.db.select().from(quotations).where(eq(quotations.id,order.quoteId)):[];
  const [contract]=await c.env.db.select().from(salesContracts).where(eq(salesContracts.orderId,order.id));
  if(contract&&contract.status!=='draft')throw new AppError(409,'HĐKT đã ký hoặc huỷ, không gửi yêu cầu duyệt nháp.','CONTRACT_NOT_DRAFT');
  const lines=await c.env.db.select().from(salesOrderLines).where(eq(salesOrderLines.orderId,order.id));
  const doc:QuoteDoc=quote?JSON.parse(quote.data):{type:order.quoteType,rows:lines};
  const saved=readSubmissionRecord(order.submissionReview),terms=quoteNoteTerms(order.note);
  return json({revision:order.revision,quoteRevision:quote?.revision??null,printing:needsPrinting(doc),submittedAt:order.submittedAt,
   documentNo:contract?.contractNo||order.orderNo,kind:contract?'HĐKT':'Đơn hàng',
   products:lines.map(l=>({name:l.name,sku:l.sku,qty:l.qty,unit:l.unit,unitPrice:l.unitPrice,amount:l.amount})),
   defaults:{deliveryDate:order.expectedDeliveryDate||'',deliveryAddress:contract?.deliveryAddress||order.address,...orderRecipient(order),shippingPayer:saved?.shippingPayer||doc.shipping?.payer||'',paymentMethod:saved?.paymentMethod||'',paymentOther:saved?.paymentOther||'',paymentHint:contract?.paymentMethod||terms.method||terms.payment,printMode:saved?.printMode||'',printInstructions:saved?.printInstructions||doc.rows.map(r=>r.printDescription||'').filter(Boolean).join('; '),sampleDate:saved?.sampleDate||''}});
 },'business');
 router.post('/orders/:id/submit',async c=>{
  const me=viewer(c),found=await loadOrder(c,c.params.id!);await canEdit(c,found);
  if(found.status!=='draft'||found.channel!=='crm')throw new AppError(409,'Chỉ gửi duyệt đơn hàng/HĐKT CRM còn nháp.');
  if(found.submittedAt)return json({ok:true,submittedAt:found.submittedAt});
  const body=await readJson(c.req,16000);let submitted=false,submittedAt='';
  await c.env.db.transaction(async tx=>{
   const [order]=await tx.select().from(salesOrders).where(eq(salesOrders.id,found.id)).for('update');
   if(!order||order.status!=='draft')throw new AppError(409,'Đơn vừa thay đổi trạng thái. Tải lại trước khi gửi duyệt.','ORDER_CHANGED');
   await canEdit(c,order,undefined,tx);
   if(order.submittedAt){submittedAt=order.submittedAt;return;}
   if(!Number.isSafeInteger(body.revision)||body.revision!==order.revision)throw new AppError(409,'Đơn vừa thay đổi. Mở lại bảng xác nhận trước khi gửi.','ORDER_CHANGED');
   const [quote]=order.quoteId?await tx.select().from(quotations).where(eq(quotations.id,order.quoteId)):[];
   if((quote?.revision??null)!==body.quoteRevision)throw new AppError(409,'Báo giá vừa thay đổi. Mở lại bảng xác nhận trước khi gửi.','QUOTE_CHANGED');
   const [contract]=await tx.select().from(salesContracts).where(eq(salesContracts.orderId,order.id)).for('update');
   if(contract&&contract.status!=='draft')throw new AppError(409,'HĐKT đã ký hoặc huỷ, không gửi yêu cầu duyệt nháp.','CONTRACT_NOT_DRAFT');
   const lines=await tx.select().from(salesOrderLines).where(eq(salesOrderLines.orderId,order.id));
   if(!lines.some(l=>l.qty>0))throw new AppError(409,'Đơn chưa có sản phẩm cần duyệt.');
   const doc:QuoteDoc=quote?JSON.parse(quote.data):{type:order.quoteType,rows:lines},printing=needsPrinting(doc);
   const problem=submissionReviewProblem(body.review,printing);if(problem)throw new AppError(400,problem,'SUBMISSION_REVIEW_REQUIRED');
   const review=normalizeSubmissionReview(body.review as SubmissionReview,printing),now=new Date().toISOString();
   const record:SubmissionRecord={...review,version:1,printing,quoteFingerprint:await submissionQuoteFingerprint(doc),deliveryFingerprint:await submissionDeliveryFingerprint(doc),submittedBy:me.id,submittedAt:now};
   await tx.update(salesOrders).set({submittedAt:now,submissionReview:JSON.stringify(record),expectedDeliveryDate:review.deliveryDate,address:review.deliveryAddress,receiverName:review.receiverName,receiverPhone:review.receiverPhone,note:syncOrderDeliveryNotes(order.note,{deliveryDate:review.deliveryDate,deliveryAddress:review.deliveryAddress},{notes:(doc as any).notes}),updatedAt:now,revision:sql`${salesOrders.revision}+1`}).where(eq(salesOrders.id,order.id));
   // Operational fields only: no deposit, payment schedule, contract value or approved quotation is edited.
   await tx.update(salesContracts).set({deliveryAddress:review.deliveryAddress,paymentMethod:submissionPaymentLabel(review),updatedAt:now,revision:sql`${salesContracts.revision}+1`}).where(eq(salesContracts.orderId,order.id));
   await tx.insert(auditLogs).values({id:crypto.randomUUID(),actorId:me.id,module:'sales',action:'submission-review',entityType:'sales_orders',entityId:order.id,data:JSON.stringify(record),createdAt:now});
   submitted=true;submittedAt=now;
  });
  if(submitted){
   const [k]=await c.env.db.select({no:salesContracts.contractNo}).from(salesContracts).where(eq(salesContracts.orderId,found.id));
   await notifyMany(c.env,'approvers',{eventType:k?'contract_pending':'order_pending',title:(k?'HĐKT':'Đơn hàng')+' mới chờ duyệt',body:`${me.name}: ${k?.no||found.orderNo} – ${found.customerName}`,url:`/index.html#/${k?'contracts':'orders'}/${found.id}`,actorId:me.id,data:{orderId:found.id}});
  }
  return json({ok:true,submittedAt});
 },'business');
}
