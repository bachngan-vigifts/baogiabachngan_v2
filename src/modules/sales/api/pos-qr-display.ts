import {and,desc,eq,gt,sql} from 'drizzle-orm';
import {AppError} from '../../../core/errors.ts';
import {json,readJson,type Router,type RouteContext} from '../../../core/http/router.ts';
import type {StaffEnv,SessionState} from '../../staff/api/auth-routes.ts';
import {warehouses} from '../../catalog/schema.ts';
import {notificationScope} from '../../notifications/api/recipient-scope.ts';
import {notifyMany} from '../../notifications/api/routes.ts';
import {webNotifications} from '../../notifications/schema.ts';
import {posPaymentRequests,posRegisters,posShifts} from '../pos-schema.ts';
import {salesOrders} from '../schema.ts';
import {posQrContent,reservedPosOrderNo} from '../domain/pos-qr-reference.ts';
import {qrPhoneSeller,qrStore,qrBank,type QrBank} from '../domain/pos-qr-display.ts';
import {posPermission,saleShiftOf,assertOpen,posKey} from './pos-store.ts';
import {posScope} from './pos-access.ts';
type Ctx=RouteContext<StaffEnv>;
const me=(c:Ctx)=>(c.state.session as SessionState).member;
const EVENT='pos_qr_display';
export function qrView(r:typeof posPaymentRequests.$inferSelect,b:QrBank){
 const content=posQrContent(r);return {id:r.id,orderNo:reservedPosOrderNo(r.cart),amount:r.amount,expiresAt:r.expiresAt,content,
 url:`https://img.vietqr.io/image/${encodeURIComponent(b.bankCode)}-${encodeURIComponent(b.bankAccount)}-compact2.png?amount=${r.amount}&addInfo=${encodeURIComponent(content)}&accountName=${encodeURIComponent(b.bankAccountName)}`};
}
async function source(c:Ctx){
 posPermission(me(c));const [r]=await c.env.db.select().from(posPaymentRequests).where(eq(posPaymentRequests.id,c.params.id!));
 if(!r)throw new AppError(404,'Không tìm thấy QR.');
 const s=await saleShiftOf(c.env.db,me(c),r.shiftId);assertOpen(s,me(c));
 if(r.confirmedAt||JSON.parse(r.cart).qrDisplayRevokedAt||r.expiresAt<=new Date().toISOString())throw new AppError(409,'QR đã thanh toán hoặc hết hạn.');
 const [used]=await c.env.db.select({id:salesOrders.id}).from(salesOrders).where(eq(salesOrders.posPaymentRequestId,r.id)).limit(1);
 if(used)throw new AppError(409,'QR đã được ghi nhận vào đơn hàng.');
 if(!qrBank(r.cart))throw new AppError(409,'Mã QR cũ chưa có thông tin ngân hàng cố định. Vui lòng tạo mã QR mới.');
 const [reg]=await c.env.db.select({r:posRegisters,warehouse:warehouses.name}).from(posRegisters).innerJoin(warehouses,eq(warehouses.id,posRegisters.warehouseId)).where(and(eq(posRegisters.id,s.registerId),eq(posRegisters.active,true)));
 if(!reg)throw new AppError(409,'Quầy không còn hoạt động.');return {r,s,reg};
}
async function options(c:Ctx){
 const src=await source(c),m=me(c),kind=qrStore(src.reg.r.name,src.reg.warehouse);
 if(!kind&&m.role!=='manager'&&m.positionId!=='sale-admin')throw new AppError(403,'Nhờ Manager chọn cửa hàng nhận QR cho quầy này.');
 const regs=kind?[src.reg]:await c.env.db.select({r:posRegisters,warehouse:warehouses.name}).from(posRegisters).innerJoin(warehouses,eq(warehouses.id,posRegisters.warehouseId)).where(eq(posRegisters.active,true));
 const scope=await notificationScope(c.env.db),targets=[];
 for(const row of regs){
  if(!qrStore(row.r.name,row.warehouse))continue;
  const data={paymentRequestId:src.r.id,targetRegisterId:row.r.id};
  const ids=await scope.recipients({eventType:EVENT,data},scope.people.map(p=>p.id));
  if(ids.length)targets.push({id:row.r.id,name:row.r.name,recipients:ids});
 }
 return {...src,scope,targets};
}
async function display(c:Ctx,note:typeof webNotifications.$inferSelect){
 const m=me(c);posPermission(m);if(!qrPhoneSeller(m))throw new AppError(403,'Chỉ NVBH được nhận màn hình QR.');
 let data:{paymentRequestId?:string;targetRegisterId?:string};try{data=JSON.parse(note.dataJson);}catch{throw new AppError(404,'Không có QR được chia sẻ.');}
 if(!data.targetRegisterId||!posScope(c)?.registers.includes(data.targetRegisterId))throw new AppError(403,'QR không thuộc cửa hàng của bạn.');
 const [target]=await c.env.db.select({id:posRegisters.id}).from(posRegisters).where(and(eq(posRegisters.id,data.targetRegisterId),eq(posRegisters.active,true)));
 if(!target)throw new AppError(403,'Quầy nhận không còn hoạt động.');
 const [r]=await c.env.db.select({r:posPaymentRequests,closedAt:posShifts.closedAt}).from(posPaymentRequests).innerJoin(posShifts,eq(posShifts.id,posPaymentRequests.shiftId)).where(eq(posPaymentRequests.id,data.paymentRequestId||''));
 if(!r)throw new AppError(404,'Không có QR được chia sẻ.');
 const [used]=await c.env.db.select({id:salesOrders.id}).from(salesOrders).where(eq(salesOrders.posPaymentRequestId,r.r.id)).limit(1);
 const [newer]=await c.env.db.select({id:posPaymentRequests.id}).from(posPaymentRequests).where(and(eq(posPaymentRequests.shiftId,r.r.shiftId),gt(posPaymentRequests.createdAt,r.r.createdAt))).limit(1);
 const state=r.r.confirmedAt||used?'paid':newer||JSON.parse(r.r.cart).qrDisplayRevokedAt||r.closedAt||r.r.expiresAt<=new Date().toISOString()?'expired':'pending';
 const b=qrBank(r.r.cart);if(!b)throw new AppError(409,'QR không có thông tin ngân hàng cố định.');
 return {noteId:note.id,id:r.r.id,state,...(state==='pending'?qrView(r.r,b):{} )};
}
export function registerPosQrDisplayRoutes(router:Router<StaffEnv>){
 router.get('/pos/qr/:id/share-options',async c=>{const o=await options(c);return json({options:o.targets.map(t=>({id:t.id,name:t.name,recipientCount:t.recipients.length})),chooseStore:!qrStore(o.reg.r.name,o.reg.warehouse)});},'business');
 router.post('/pos/qr/:id/share',async c=>{
  const b=await readJson(c.req,2000),key=posKey(b.key),o=await options(c);
  const target=o.targets.find(t=>t.id===b.targetRegisterId);
  if(!target)throw new AppError(403,'Chọn đúng cửa hàng có NVBH được phép nhận QR.');
  const data={paymentRequestId:o.r.id,targetRegisterId:target.id,shareKey:key};
  const count=await notifyMany(c.env,target.recipients,{eventType:EVENT,title:'Mã QR thanh toán · '+target.name,body:`Hiển thị QR ${o.r.amount.toLocaleString('vi-VN')} đ cho khách.`,url:`/index.html#/pos?displayQr=${encodeURIComponent(o.r.id)}`,data,dedupeKey:`qr-display:${o.r.id}:${target.id}:${key}`,deviceClass:'mobile'},[],o.scope);
  if(!count)throw new AppError(409,'Không còn NVBH được phép nhận QR.');
  return json({recipientCount:count,key,status:'queued'});
 },'business');
 router.post('/pos/qr/:id/hide-display',async c=>{
  await readJson(c.req,1000);const o=await source(c);
  await c.env.db.update(posPaymentRequests).set({cart:JSON.stringify({...JSON.parse(o.r.cart),qrDisplayRevokedAt:new Date().toISOString()})}).where(eq(posPaymentRequests.id,o.r.id));
  return json({ok:true});
 },'business');
 router.get('/pos/qr-display/pending',async c=>{
  posPermission(me(c));if(!qrPhoneSeller(me(c)))throw new AppError(403,'Chỉ NVBH được nhận màn hình QR.');
  const notes=await c.env.db.select().from(webNotifications).where(and(eq(webNotifications.eventType,EVENT),eq(webNotifications.targetMemberId,me(c).id),gt(webNotifications.createdAt,new Date(Date.now()-15*60000).toISOString()))).orderBy(desc(webNotifications.createdAt),desc(webNotifications.id)).limit(5);
  for(const n of notes){try{return json({display:await display(c,n)});}catch(e){if(!(e instanceof AppError)||![403,404,409].includes(e.status))throw e;}}
  return json({display:null});
 },'business');
 router.get('/pos/qr-display/:id',async c=>{
  const [note]=await c.env.db.select().from(webNotifications).where(and(eq(webNotifications.eventType,EVENT),eq(webNotifications.targetMemberId,me(c).id),sql`${webNotifications.dataJson}::jsonb->>'paymentRequestId'=${c.params.id!}`)).orderBy(desc(webNotifications.createdAt)).limit(1);
  if(!note)throw new AppError(404,'Không có QR được chia sẻ cho bạn.');return json({display:await display(c,note)});
 },'business');
}
