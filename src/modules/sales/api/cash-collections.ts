import {and,eq,inArray,sql} from 'drizzle-orm';
import type {Router,RouteContext} from '../../../core/http/router.ts';
import {json,readJson} from '../../../core/http/router.ts';
import {AppError} from '../../../core/errors.ts';
import type {StaffEnv,SessionState} from '../../staff/api/auth-routes.ts';
import {employees} from '../../staff/schema.ts';
import {customerPayments,salesOrders} from '../schema.ts';
import {cashCollections} from '../cash-collection-schema.ts';
import {cashAudit,cashLock} from './cash-store.ts';
import type {AnyDb} from '../../../core/db/client.ts';
type Tx=Parameters<Parameters<AnyDb['transaction']>[0]>[0];
type ReadDb=AnyDb|Tx;type Ctx=RouteContext<StaffEnv>;
export async function heldCashForOrder(db:ReadDb,orderId:string){
 const [r]=await db.select({amount:sql<number>`coalesce(sum(${cashCollections.amount}),0)`.mapWith(Number)}).from(cashCollections)
  .where(and(eq(cashCollections.orderId,orderId),eq(cashCollections.status,'held')));return r?.amount||0;
}
export async function cashCollectionsForOrder(db:ReadDb,orderId:string){
 const rows=await db.select({id:cashCollections.id,orderId:cashCollections.orderId,amount:cashCollections.amount,paidAt:cashCollections.paidAt,reference:cashCollections.reference,note:cashCollections.note,status:cashCollections.status,collectedBy:cashCollections.collectedBy,createdAt:cashCollections.createdAt,confirmedBy:cashCollections.confirmedBy,confirmedAt:cashCollections.confirmedAt,paymentId:cashCollections.paymentId,cancelledBy:cashCollections.cancelledBy,cancelledAt:cashCollections.cancelledAt,cancelReason:cashCollections.cancelReason,paymentVoidedAt:customerPayments.voidedAt}).from(cashCollections).leftJoin(customerPayments,eq(customerPayments.id,cashCollections.paymentId)).where(eq(cashCollections.orderId,orderId)).orderBy(cashCollections.createdAt,cashCollections.id);
 const ids=[...new Set(rows.flatMap(r=>[r.collectedBy,r.confirmedBy,r.cancelledBy].filter((s):s is string=>!!s)))];
 const people=ids.length?await db.select({id:employees.id,name:employees.name}).from(employees).where(inArray(employees.id,ids)):[];
 const name=(id:string|null)=>people.find(p=>p.id===id)?.name||'—';return rows.map(r=>({...r,collectedByName:name(r.collectedBy),confirmedByName:name(r.confirmedBy),cancelledByName:name(r.cancelledBy)}));
}
export function registerCashCollectionRoutes(router:Router<StaffEnv>,loadOrder:(c:Ctx,id:string,db?:AnyDb|Tx)=>Promise<typeof salesOrders.$inferSelect>,debtOf:(db:ReadDb,id:string)=>Promise<number>){
 for(const action of ['confirm','cancel'] as const)router.post('/payments/cash-collections/:id/'+action,async c=>{
  const me=(c.state.session as SessionState).member;if(me.role!=='manager')throw new AppError(403,'Chỉ Manager được xác nhận đã nhận tiền hoặc huỷ ghi nhận tiền mặt nhân viên giữ.');
  const b=await readJson(c.req,2000);if(b.confirmed!==true)throw new AppError(400,'Cần xác nhận đã thực nhận tiền hoặc ghi nhận thu nhầm/đã trả tiền lại khách.');
  const reason=typeof b.reason==='string'?b.reason.trim().slice(0,500):'';
  if(action==='cancel'&&reason.length<3)throw new AppError(400,'Nhập lý do huỷ ghi nhận.');
  return json(await c.env.db.transaction(async tx=>{
   await cashLock(tx);
   const [hint]=await tx.select({orderId:cashCollections.orderId}).from(cashCollections).where(eq(cashCollections.id,c.params.id!));
   if(!hint)throw new AppError(404,'Không tìm thấy ghi nhận tiền mặt.');
   await loadOrder(c,hint.orderId,tx);
   const [order]=await tx.select().from(salesOrders).where(eq(salesOrders.id,hint.orderId)).for('update');
   if(!order)throw new AppError(404,'Không tìm thấy đơn hàng.');
   const [r]=await tx.select().from(cashCollections).where(eq(cashCollections.id,c.params.id!)).for('update');
   if(!r)throw new AppError(404,'Không tìm thấy ghi nhận tiền mặt.');
   if(action==='cancel'){
    if(r.status==='cancelled'){if(r.cancelReason!==reason)throw new AppError(409,'Ghi nhận đã huỷ với lý do khác.');return{ok:true,status:r.status,orderId:order.id};}
    if(r.status!=='held')throw new AppError(409,'Manager đã nhận tiền. Dùng huỷ phiếu thu để sửa phiếu ghi nhầm.');
    await tx.update(cashCollections).set({status:'cancelled',cancelledBy:me.id,cancelledAt:new Date().toISOString(),cancelReason:reason}).where(eq(cashCollections.id,r.id));
    await cashAudit(tx,me.id,'cash-collection-cancel','customer_cash_collections',r.id,{orderId:order.id,reason,amount:r.amount});return{ok:true,status:'cancelled',orderId:order.id};
   }
   if(r.status==='cancelled')throw new AppError(409,'Ghi nhận tiền mặt đã huỷ.');
   if(r.status==='confirmed'){
    const [payment]=await tx.select({voidedAt:customerPayments.voidedAt}).from(customerPayments).where(eq(customerPayments.id,r.paymentId!));
    if(!payment||payment.voidedAt)throw new AppError(409,'Phiếu thu đã huỷ; không được xác nhận lại ghi nhận này.');
    return{ok:true,status:'confirmed',paymentId:r.paymentId,orderId:order.id};
   }
   if(order.channel!=='crm'||order.status==='cancelled')throw new AppError(409,'Đơn đã huỷ hoặc không thuộc luồng thu CRM; cần đối soát tiền đang giữ.');
   if(r.amount>await debtOf(tx,order.id))throw new AppError(409,'Số tiền chờ nhận vượt công nợ hiện tại; cần đối soát trước khi xác nhận.');
   const now=new Date().toISOString();
   await tx.insert(customerPayments).values({id:r.id,orderId:order.id,scheduleId:r.scheduleId,customerId:order.customerId,shiftId:null,requestKey:'cash-collection:'+r.id,paymentSource:'manual',amount:r.amount,paidAt:r.paidAt,method:'cash',reference:r.reference,note:r.note,createdBy:r.collectedBy,createdAt:now});
   await tx.update(cashCollections).set({status:'confirmed',confirmedBy:me.id,confirmedAt:now,paymentId:r.id}).where(eq(cashCollections.id,r.id));
   await cashAudit(tx,me.id,'cash-collection-confirm','customer_cash_collections',r.id,{orderId:order.id,amount:r.amount,collectedBy:r.collectedBy,paymentId:r.id,cashHandling:'outside_drawer'});
   return{ok:true,status:'confirmed',paymentId:r.id,orderId:order.id};
  }));
 },'business');
}
