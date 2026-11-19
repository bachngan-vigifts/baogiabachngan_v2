import {LOCK_WEB_REGISTER_NAME} from '../domain/pos-register.ts';
import {sepayPosIntent} from '../domain/sepay-page.ts';
import {and,eq,inArray,ne,or,sql,type SQLWrapper} from 'drizzle-orm';
import {foldSql} from '../../../core/text/fold.ts';
import {sepayTransactions as bank} from '../../integrations/schema.ts';
import {sepayReferenceCandidates,type SepayPayment} from '../../integrations/domain/sepay-payment.ts';
import {posRegisters,webStoreOrders as web} from '../pos-schema.ts';
import {salesOrders,salesContracts} from '../schema.ts';
import {readWebOrderFinancials} from '../domain/web-order-financials.ts';
import {webOrderPaymentBlocked} from '../domain/web-order-outcome.ts';
import {cashAudit,type CashDb} from './cash-store.ts';

export type WebSepayDecision={webOrderId:string|null;status:'matched'|'review';reason:string};
/** Accept only the observed bank transaction suffix, never an arbitrary code suffix. */
function bankSuffix(after:string){
 return /^-GD-[A-Z0-9]{1,32}-[0-9]{6}-(?:[01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](?:[.;]\s*)?$/i.test(after);
}
function qrReferences(content:string,prefix:'DH'|'ML'){
 const refs=new Set<string>();
 const pattern=new RegExp('(?<![\\p{L}\\p{N}])'+prefix+'[0-9]{1,20}(?![\\p{L}\\p{N}])','giu');
 for(const match of content.matchAll(pattern)){
  const before=content.slice(0,match.index!).trimEnd(),after=content.slice(match.index!+match[0].length);
  if(/[-_/‐‑‒–—−]$/.test(before))continue;
  if(/^\s*[-_/‐‑‒–—−]/.test(after)&&!bankSuffix(after.trim()))continue;
  refs.add(match[0].toUpperCase());
 }
 return [...refs];
}
export function lockQrReferences(content:string){return qrReferences(content,'DH');}
export function minhLongQrReferences(content:string){return qrReferences(content,'ML');}
export function webQrReferences(content:string){return [...lockQrReferences(content),...minhLongQrReferences(content)];}
/** Anchor the complete legacy statement so extra codes cannot be discarded. */
export function legacyWebOrderIds(content:string){
 const text=content.normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[đĐ]/g,'d').trim();
 const m=text.match(/^(?:QR\s*-\s*)?Thanh toan don hang web ([0-9]{1,20})(?: GD [A-Z0-9]{1,32} [0-9]{6}-(?:[01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9])?$/i);
 return m?[m[1]!]:[];
}
const refSource=(ref:string)=>ref.startsWith('DH')?'lock' as const:'minhlong' as const;
async function sourceAccount(db:CashDb,account:string,source:'lock'|'minhlong'){
 const regs=await db.select({name:posRegisters.name}).from(posRegisters).where(and(eq(posRegisters.active,true),eq(sql`regexp_replace(${posRegisters.bankAccount},'[[:space:]]','','g')`,account)));
 return regs.some(r=>source==='lock'?r.name.trim().toLowerCase()===LOCK_WEB_REGISTER_NAME.toLowerCase():/minh\s*long/i.test(r.name));
}
export async function resolveWebQrReferences(db:CashDb,p:{content:string;accountNumber:string}){
 const refs=webQrReferences(p.content),ids=legacyWebOrderIds(p.content);
 if(refs.length||!ids.length)return refs;
 const rows=await db.select({source:web.source}).from(web).innerJoin(posRegisters,eq(posRegisters.id,web.registerId))
  .where(and(inArray(web.source,['lock','minhlong']),inArray(web.externalId,ids),eq(posRegisters.active,true),
   eq(sql`regexp_replace(${posRegisters.bankAccount},'[[:space:]]','','g')`,p.accountNumber)));
 const sources=[...new Set(rows.map(r=>r.source))];
 if(sources.length===1)return [(sources[0]==='lock'?'DH':'ML')+ids[0]];
 if(sources.length>1)return [];
 const candidates:('lock'|'minhlong')[]=[];
 for(const source of ['lock','minhlong'] as const)if(await sourceAccount(db,p.accountNumber,source))candidates.push(source);
 return candidates.length===1?[(candidates[0]==='lock'?'DH':'ML')+ids[0]]:[];
}
export async function isLockWebQrPayment(db:CashDb,event:{content:string;accountNumber?:string}){
 const refs=await resolveWebQrReferences(db,{content:event.content,accountNumber:event.accountNumber||''});if(!refs.length)return legacyWebOrderIds(event.content).length>0;
 const [webMatch]=await db.select({id:web.id}).from(web).where(and(inArray(web.source,refs.map(refSource)),inArray(web.externalId,refs.map(s=>s.slice(2))))).limit(1);
 return !!webMatch||!!event.accountNumber&&(await sourceAccount(db,event.accountNumber,'lock')||await sourceAccount(db,event.accountNumber,'minhlong'));
}
/** Link bank evidence to the existing paid website order; never create a CRM receipt or mutate Woo totals. */
export async function decideWebSepay(db:CashDb,p:SepayPayment):Promise<WebSepayDecision|null>{
 const refs=await resolveWebQrReferences(db,p);
 if(!refs.length)return legacyWebOrderIds(p.content).length?{status:'review',webOrderId:null,reason:'Nội dung đơn web cũ chưa xác định duy nhất website và tài khoản nhận; cần kiểm tra.'}:null;
 if(sepayPosIntent(p.content))return {status:'review',webOrderId:null,reason:'Nội dung có cả mã QR POS và mã đơn web; cần kiểm tra nguồn.'};
 const sources=[...new Set(refs.map(refSource))];
 if(sources.length!==1)return {status:'review',webOrderId:null,reason:'Nội dung có mã của nhiều website; cần đối soát, không tự gắn.'};
 const source=sources[0]!;
 const ids=refs.map(s=>s.slice(2));
 const targets=await db.select({id:web.id}).from(web).where(and(eq(web.source,source),inArray(web.externalId,ids))).limit(2);
 if(!targets.length)return await sourceAccount(db,p.accountNumber,source)?{status:'review',webOrderId:null,reason:`Có mã QR web ${source==='lock'?'Lock':'Minh Long'} nhưng đơn chưa đồng bộ; chờ nguồn web, không gắn sang đơn CRM.`}:null;
 // Serialize the small QR-only critical section after provider locks; bulk pulls can visit web orders in different orders.
 await db.execute(sql`select pg_advisory_xact_lock(hashtext('sepay:web-qr'))`);
 const review=(reason:string,webOrderId:string|null=null):WebSepayDecision=>({status:'review',reason,webOrderId});
 if(refs.length!==1||targets.length!==1)return review('Nội dung có nhiều mã/đơn web; cần đối soát, không tự gắn.');
 const normalized=sepayReferenceCandidates(p.content);
 if(!normalized.length)return review('Nội dung chuyển khoản quá phức tạp; cần kiểm tra mã trước khi tự đối soát.');
 const all=[...new Set([...normalized,...refs])],values=sql`(select jsonb_array_elements_text(${JSON.stringify(all)}::jsonb))`;
 const matches=(field:SQLWrapper)=>inArray(sql`upper(regexp_replace(${foldSql(field)},'[^a-z0-9]','','g'))`,values);
 const [crm]=await db.select({id:salesOrders.id}).from(salesOrders).leftJoin(salesContracts,eq(salesContracts.orderId,salesOrders.id))
  .where(or(matches(salesOrders.orderNo),matches(salesOrders.quoteNo),matches(salesOrders.sapoOrderCode),matches(salesContracts.contractNo))).limit(1);
 if(crm)return review('Mã thanh toán đồng thời khớp chứng từ CRM và đơn web; cần đối soát.');
 const [order]=await db.select().from(web).where(eq(web.id,targets[0]!.id)).for('update');
 if(!order)return review('Chưa tìm thấy đơn web để đối soát.');
 const id=order.id;
 if(order.currency!=='VND'||webOrderPaymentBlocked(order.status,order.ghnStatus))return review('Đơn web đã huỷ/hoàn hoặc không dùng VND; cần kiểm tra.',id);
 let edit:Record<string,unknown>;
 try{edit=JSON.parse(order.crmEditSnapshot||'{}');if(!edit||typeof edit!=='object'||Array.isArray(edit))throw new Error();}catch{return review('Dữ liệu chỉnh sửa đơn web cần kiểm tra trước khi khớp tiền.',id);}
 if(edit.sourceConflict||Number(edit.revision||0)>0)return review('Đơn web có thay đổi cần đối chiếu nguồn trước khi khớp tiền.',id);
 const qrMethod=/\bqr\b/i.test(order.paymentMethod)||source==='minhlong'&&/(chuy[eể]n khoản|bank transfer|bacs)/i.test(order.paymentMethod);
 if(!qrMethod)return review('Đơn web không dùng thanh toán QR; cần kiểm tra phương thức thanh toán.',id);
 const [register]=await db.select({account:posRegisters.bankAccount,active:posRegisters.active}).from(posRegisters).where(eq(posRegisters.id,order.registerId));
 if(!register?.active||!register.account||register.account.replace(/\s+/g,'')!==p.accountNumber)return review(`Tài khoản nhận không khớp quầy của đơn web ${source==='lock'?'Lock':'Minh Long'}.`,id);
 if(!Number.isSafeInteger(order.total)||order.total<=0||p.amount!==order.total)return review('Số tiền khác tổng đơn web; không tự gắn khoản thiếu/thừa.',id);
 
 const [other]=await db.select({id:bank.id}).from(bank).where(and(eq(bank.webOrderId,id),eq(bank.status,'matched'),ne(bank.providerId,p.providerId))).limit(1);
 if(other)return review('Đơn web đã gắn một giao dịch khác; cần kiểm tra khoản thu trùng.',id);
 if(!readWebOrderFinancials(order.financialSnapshot)?.payment?.paidAt)return review('Đã nhận tiền – chờ web xác nhận. Đúng mã, tài khoản và số tiền; chưa xác nhận đơn hoặc tạo phiếu thu.',id);
 return {status:'matched',webOrderId:id,reason:`Đã đối soát QR với đơn web ${source==='lock'?'Lock':'Minh Long'}; website đã ghi nhận khoản thu, không tạo thêm phiếu thu CRM.`};
}
export async function saveWebSepay(db:CashDb,p:SepayPayment,d:WebSepayDecision,old:typeof bank.$inferSelect|undefined,actorId='integration:sepay-web'){
 const row={...d,matchMethod:'reference' as const,matchedOrderAt:null,orderId:null,paymentId:null},id=old?.id||crypto.randomUUID();
 if(old){
  if(old.status===d.status&&old.webOrderId===d.webOrderId&&old.reason===d.reason)return row;
  await db.update(bank).set(row).where(eq(bank.id,old.id));
 }else await db.insert(bank).values({id,providerId:p.providerId,transferType:p.transferType,amount:p.amount,accountNumber:p.accountNumber,transactionAt:p.transactionAt,content:p.content,payload:p.payload,receivedAt:new Date().toISOString(),...row});
 await cashAudit(db,actorId,'sepay.web-match','sepay_transaction',id,{providerId:p.providerId,status:d.status,webOrderId:d.webOrderId,reason:d.reason});
 return row;
}
