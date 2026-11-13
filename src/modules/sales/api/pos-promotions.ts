import {and,eq} from 'drizzle-orm';
import {z} from 'zod';
import {AppError} from '../../../core/errors.ts';
import {json,readJson,type Router} from '../../../core/http/router.ts';
import type {StaffEnv,SessionState} from '../../staff/api/auth-routes.ts';
import {can} from '../../staff/domain/permissions.ts';
import {products} from '../../catalog/schema.ts';
import {posPromotionPrograms} from '../promotion-schema.ts';
import {cashLock,cashAudit} from './cash-store.ts';
import {sellRegister} from './pos-register-scope.ts';
import {posLine} from '../domain/pos-money.ts';
type Db=StaffEnv['db']|Parameters<Parameters<StaffEnv['db']['transaction']>[0]>[0];
export async function promotionProgram(db:Db,registerId:string){
 const [row]=await db.select({program:posPromotionPrograms,giftName:products.name,giftUnit:products.unit,giftActive:products.active,giftApproval:products.approvalStatus}).from(posPromotionPrograms)
  .innerJoin(products,eq(products.sku,posPromotionPrograms.giftSku)).where(eq(posPromotionPrograms.registerId,registerId));
 return row?{...row.program,giftName:row.giftName,giftUnit:row.giftUnit,giftAvailable:row.giftActive&&row.giftApproval==='approved'}:null;
}
export async function cartPromotion(db:Db,registerId:string,amount:number,rawReason:unknown,taxRate:number){
 const program=await promotionProgram(db,registerId);
 const reason=typeof rawReason==='string'?rawReason.trim():'';
 if(rawReason!==undefined&&typeof rawReason!=='string'||reason.length>500||reason&&reason.length<5)throw new AppError(400,'Lý do không nhận quà cần từ 5 đến 500 ký tự.');
 if(!program)return {promotion:null,gift:null};
 const eligible=program.enabled&&amount>program.threshold;
 const applied=eligible&&!reason;
 if(applied&&!program.giftAvailable)throw new AppError(409,'Quà khuyến mãi chưa hoạt động/được duyệt. Nhờ Manager kiểm tra chương trình.','POS_GIFT_UNAVAILABLE');
 const promotion={...program,qualifyingAmount:amount,eligible,applied,optOutReason:eligible?reason:''};
 return {promotion,gift:applied?{sku:program.giftSku,name:program.giftName+' · Quà tặng',unit:program.giftUnit,...posLine({price:0,qty:program.giftQty,taxRate,priceIncludesVat:true,vatEnabled:true}),isPromotionGift:true}:null};
}
const input=z.object({revision:z.number().int().min(0),title:z.string().trim().min(1).max(200),enabled:z.boolean(),threshold:z.number().int().min(0).max(100000000000),giftSku:z.string().trim().min(1).max(100),giftQty:z.number().int().min(1).max(100)}).strict();
export function registerPosPromotions(router:Router<StaffEnv>){
 router.get('/pos/promotions',async c=>{if(!can((c.state.session as SessionState).member,'pos.sell'))throw new AppError(403,'Chưa được cấp quyền bán hàng nhanh.');const registerId=new URL(c.req.url).searchParams.get('registerId')||'';await sellRegister(c,registerId);return json({program:await promotionProgram(c.env.db,registerId)});},'business');
 router.put('/pos/promotions/:id',async c=>{
  const me=(c.state.session as SessionState).member;
  if(me.role!=='manager')throw new AppError(403,'Chỉ Manager thay đổi chương trình khuyến mãi.');
  const registerId=c.params.id!,parsed=input.safeParse(await readJson(c.req,4000));
  if(!parsed.success)throw new AppError(400,'Cấu hình khuyến mãi không hợp lệ.');
  await sellRegister(c,registerId);
  await c.env.db.transaction(async tx=>{
   await cashLock(tx);
   const before=await promotionProgram(tx,registerId),b=parsed.data;
   if((before?.revision||0)!==b.revision)throw new AppError(409,'Chương trình vừa thay đổi. Mở lại cấu hình.');
   const [gift]=await tx.select({sku:products.sku}).from(products).where(and(eq(products.sku,b.giftSku),b.enabled?eq(products.active,true):undefined,b.enabled?eq(products.approvalStatus,'approved'):undefined)).for('share');
   if(!gift)throw new AppError(400,'Mã quà phải là sản phẩm đang hoạt động và đã duyệt.');
   const row={registerId,title:b.title,enabled:b.enabled,threshold:b.threshold,giftSku:b.giftSku,giftQty:b.giftQty,revision:b.revision+1,updatedAt:new Date().toISOString(),updatedBy:me.id};
   await tx.insert(posPromotionPrograms).values(row).onConflictDoUpdate({target:posPromotionPrograms.registerId,set:row});
   await cashAudit(tx,me.id,'configure-promotion','pos-promotions',registerId,{before,after:row});
  });
  return json({program:await promotionProgram(c.env.db,registerId)});
 },'business');
}

/** Refunds crossing the original threshold must recover the free gift; pending unrelated gift returns do not count as received. */
export function assertPromotionReturn(snap:any,old:{id:string;lineNo:number}[],claimed:{returnId:string;orderLineId:string;requestedQty:number;subtotal:number;tax:number}[],returns:{id:string;receivedAt:string|null}[],requested:{orderLineId:string;requestedQty:number;subtotal:number;tax:number}[]){
 if(!snap.promotion?.applied)return;
 const giftIds=new Set(old.filter(l=>snap.lines?.[l.lineNo-1]?.isPromotionGift).map(l=>l.id));
 const paidReturned=[...claimed,...requested].filter(l=>!giftIds.has(l.orderLineId)).reduce((n,l)=>n+l.subtotal+l.tax,0);
 if(snap.promotion.qualifyingAmount-paidReturned>snap.promotion.threshold)return;
 const received=new Set(returns.filter(r=>r.receivedAt).map(r=>r.id));
 const giftReceived=claimed.filter(l=>giftIds.has(l.orderLineId)&&received.has(l.returnId)).reduce((n,l)=>n+l.requestedQty,0);
 const giftNow=requested.filter(l=>giftIds.has(l.orderLineId)).reduce((n,l)=>n+l.requestedQty,0);
 if(giftReceived+giftNow<snap.promotion.giftQty)throw new AppError(409,'Giá trị còn lại không đủ điều kiện khuyến mãi. Cần nhận lại đủ quà tặng cùng phiếu trả hàng.','POS_GIFT_RETURN_REQUIRED');
}
