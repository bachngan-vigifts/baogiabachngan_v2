import {sepayTransactions as bank} from '../../integrations/schema.ts';
import {webSourceHash,webEditBlocked} from './web-order-edit-state.ts';
import {eq,and,inArray} from 'drizzle-orm';
import type {Router,RouteContext} from '../../../core/http/router.ts';
import {json,readJson} from '../../../core/http/router.ts';
import {AppError} from '../../../core/errors.ts';
import {auditLogs} from '../../../core/db/schema.ts';
import type {StaffEnv,SessionState} from '../../staff/api/auth-routes.ts';
import {can} from '../../staff/domain/permissions.ts';
import {sha256Hex} from '../../staff/domain/session.ts';
import {products} from '../../catalog/schema.ts';
import {webStoreOrders as web} from '../pos-schema.ts';
import {calculateWebCart,readWebEdit} from '../domain/web-order-edit.ts';
import {readWebOrderFinancials} from '../domain/web-order-financials.ts';
import {webOrderBucket} from '../domain/web-order-outcome.ts';
import {webDocumentDetail} from './web-order-documents.ts';
import {invoiceTasksChanged} from './invoice-task-hooks.ts';
type Row=typeof web.$inferSelect;
/** Commit intent before an external call; an unknown GHN result must not reopen cart edits. */
export async function beginWebConfirmation(env:StaffEnv,id:string,markAttempt=false,expectedRevision?:unknown){
 return env.db.transaction(async tx=>{
  const [o]=await tx.select().from(web).where(eq(web.id,id)).for('update');if(!o)throw new AppError(404,'Không tìm thấy đơn website.');
  if(!o.ghnOrderCode&&['cancelled','completed'].includes(webOrderBucket(o.status,o.ghnStatus)))throw new AppError(409,'Đơn đã kết thúc; không tạo vận đơn mới.');
  const e=readWebEdit(o.crmEditSnapshot),prior=!!e.ghnAttemptedAt;
  if((expectedRevision!==undefined||Number(e.revision||0)>0)&&expectedRevision!==Number(e.revision||0))throw new AppError(409,'Sản phẩm hoặc giá vừa thay đổi. Tải lại đơn trước khi tạo GHN.','WEB_ORDER_CHANGED');
  if(!o.ghnOrderCode){e.confirmationStartedAt ||= new Date().toISOString();if(markAttempt){e.ghnAttemptedAt ||= new Date().toISOString();e.ghnCartReviewRequired=true;}
   await tx.update(web).set({crmEditSnapshot:JSON.stringify(e)}).where(eq(web.id,id));}
  return {priorAttempt:prior};
 });
}
export function registerWebOrderEdits(router:Router<StaffEnv>){
 router.post('/orders/:id/web/preview',async c=>{
  if(!can((c.state.session as SessionState).member,'pos.sell'))throw new AppError(403,'Chưa được cấp quyền sửa đơn web.');
  if(!c.params.id!.startsWith('web:'))throw new AppError(404,'Không phải đơn website.');
  const d=await webDocumentDetail(c,c.params.id!.slice(4));if(!d.canEdit)throw new AppError(409,d.editBlocked||'Không sửa được đơn này.');
  return json(calculateWebCart(await readJson(c.req,150_000)));
 },'business');
 router.put('/orders/:id/web-edit',async c=>{
  const m=(c.state.session as SessionState).member;if(!can(m,'pos.sell'))throw new AppError(403,'Chưa được cấp quyền sửa đơn web.');
  if(!c.params.id!.startsWith('web:'))throw new AppError(404,'Không phải đơn website.');
  const id=c.params.id!.slice(4);const access=await webDocumentDetail(c,id);if(!access.canManage)throw new AppError(403,'Không được sửa đơn ở quầy đã ngừng hoạt động.');
  const b=await readJson(c.req,150_000),key=typeof b.clientKey==='string'?b.clientKey:'';
  if(!/^[a-zA-Z0-9-]{16,80}$/.test(key))throw new AppError(400,'Thiếu mã thao tác lưu đơn.');
  const hash=sha256Hex(JSON.stringify({lines:b.lines,orderDiscount:b.orderDiscount,shippingFee:b.shippingFee,feeAmount:b.feeAmount,shippingTaxRate:b.shippingTaxRate,feeTaxRate:b.feeTaxRate,reason:b.reason}));
  const saved=await c.env.db.transaction(async tx=>{
   const [o]=await tx.select().from(web).where(eq(web.id,id)).for('update');if(!o)throw new AppError(404,'Không tìm thấy đơn website.');
   const e=readWebEdit(o.crmEditSnapshot);
   if(e.lastKey===key){if(e.lastHash!==hash)throw new AppError(409,'Cùng mã lưu nhưng khác nội dung.','COMMAND_CONFLICT');return {replayed:true};}
   const blocked=webEditBlocked(o);if(blocked)throw new AppError(409,blocked,'WEB_ORDER_LOCKED');
   const [bankProof]=await tx.select({id:bank.id}).from(bank).where(and(eq(bank.webOrderId,id),eq(bank.status,'matched'))).limit(1);
   if(bankProof)throw new AppError(409,'Đơn đã đối soát SePay; cần đối chiếu thu/hoàn tiền trước khi sửa hàng hoặc giá.','PAID_WEB_ORDER_REVIEW_REQUIRED');
   if(b.revision!==Number(e.revision||0)||b.sourceHash!==webSourceHash(o))throw new AppError(409,'Đơn vừa thay đổi. Tải lại trước khi sửa.','WEB_ORDER_CHANGED');
   const reason=typeof b.reason==='string'?b.reason.trim():'';
   if(reason.length<3||reason.length>500||b.pricingReviewed!==true)throw new AppError(400,'Nhập lý do và xác nhận đã kiểm tra giá, chiết khấu, thuế, phí.');
   if(o.currency!=='VND')throw new AppError(409,'Đơn ngoại tệ cần đối soát riêng; chưa sửa bằng giá VNĐ.');
   const calc=calculateWebCart(b),oldFinancials=readWebOrderFinancials(o.financialSnapshot);
   if(b.expectedTotal!==calc.total)throw new AppError(409,'Kiểm tra lại tổng tiền của bản sửa trước khi lưu.','WEB_PREVIEW_CHANGED');
   if(oldFinancials?.payment?.paidAt&&calc.total!==o.total)throw new AppError(409,'Đơn đã thanh toán: chỉ đổi hàng khi giữ nguyên tổng tiền. Chênh lệch cần xử lý thu thêm/hoàn tiền riêng.','PAID_WEB_ORDER_REVIEW_REQUIRED');
   if((!oldFinancials?.payment||e.sourceConflict)&&b.paymentReviewed!==true)throw new AppError(400,'Chưa có dữ liệu thu tiền: xác nhận đã kiểm tra thanh toán trước khi sửa.');
   const catalog=await tx.select({sku:products.sku,name:products.name,unit:products.unit}).from(products).where(inArray(products.sku,calc.lines.map(l=>l.sku)));
   const known=new Map(catalog.map(p=>[p.sku,p]));
   for(const l of calc.lines)if(!known.has(l.sku))throw new AppError(400,'Mã hàng không có trong danh mục CRM: '+l.sku);
   const lines=calc.lines.map(l=>{const p=known.get(l.sku)!;return{sku:l.sku,name:p.name,unit:p.unit,quantity:l.qty,total:l.subtotal,totalTax:l.tax,subtotal:l.listAmount/(1+l.taxRate/100),subtotalTax:l.listAmount-l.listAmount/(1+l.taxRate/100),crmDiscountType:l.discountType,crmDiscountValue:l.discountValue,crmDiscountAmount:l.discountAmount};});
   const sourcePayment=readWebOrderFinancials(e.latestSource?.financialSnapshot)?.payment;
   if(e.sourceConflict&&sourcePayment?.paidAt&&Number(e.latestSource?.total)!==calc.total)throw new AppError(409,'Website ghi nhận thanh toán khác tổng bản sửa. Cần đối soát thu/hoàn tiền.','PAID_WEB_ORDER_REVIEW_REQUIRED');
   const payment=e.sourceConflict&&sourcePayment?.paidAt?sourcePayment:oldFinancials?.payment;
   const financials={...calc.financials,...(payment?{payment}:{})};
   e.original ||= {lines:o.lines,total:o.total,financialSnapshot:o.financialSnapshot};
   Object.assign(e,{revision:Number(e.revision||0)+1,lastKey:key,lastHash:hash,cart:{...calc.cart,lines:calc.cart.lines.map(l=>({...l,...known.get(l.sku)}))},editedBy:m.id,editedAt:new Date().toISOString(),reason,sourceConflict:false});
   await tx.update(web).set({lines:JSON.stringify(lines),total:calc.total,financialSnapshot:JSON.stringify(financials),crmEditSnapshot:JSON.stringify(e),updatedAt:e.editedAt}).where(eq(web.id,id));
   await tx.insert(auditLogs).values({id:crypto.randomUUID(),actorId:m.id,module:'sales',action:'web-order-edit',entityType:'web-store-order',entityId:id,createdAt:e.editedAt,data:JSON.stringify({revision:e.revision,reason,before:{lines:o.lines,total:o.total},after:{lines:JSON.stringify(lines),total:calc.total}})});
   return {replayed:false};
  });
  if(!saved.replayed)await invoiceTasksChanged(c.env,{webOrderId:id},m.id).catch(()=>console.error('web order invoice task refresh failed'));
  return json({...await webDocumentDetail(c,id),...saved});
 },'business');
}
