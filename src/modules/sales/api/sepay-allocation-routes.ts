import {and,asc,desc,eq,ilike,inArray,isNull,isNotNull,or,sql} from 'drizzle-orm';
import {AppError} from '../../../core/errors.ts';
import {json,readJson,type Router,type RouteContext} from '../../../core/http/router.ts';
import type {StaffEnv,SessionState} from '../../staff/api/auth-routes.ts';
import {sha256Hex} from '../../staff/domain/session.ts';
import {sepayTransactions as bank} from '../../integrations/schema.ts';
import {salesOrders as orders,salesContracts as contracts,customerPayments as payments,deliveries} from '../schema.ts';
import {webStoreOrders as web,posRegisters as registers,posShifts} from '../pos-schema.ts';
import {assertSepayCrmSource} from './sepay-payment-store.ts';
import {sepayPaidDate} from '../../integrations/domain/sepay-payment.ts';
import {webOrderPaymentBlocked} from '../domain/web-order-outcome.ts';
import {sepayReconciliationStates as states,sepayAllocationBatches as batches,sepayPaymentAllocations as allocations} from '../sepay-allocation-schema.ts';
import {cashLock,cashAudit,type CashDb} from './cash-store.ts';
import {assertSepayReconcileAccess,assertSepayReconcileTarget,sepayWebOrderScope,canReplaceSepayReceipt} from './sepay-reconcile-access.ts';
import {orderScopeFor,canVoidPayment} from './routes.ts';
import {assertNoReturnActivity,netReceivables} from './pos-return-credit.ts';
import {allocationRows,allocationNeedsReview} from './sepay-allocation-store.ts';
import {sepayManualAccountApproved} from './sepay-manual-account.ts';
import {readWebSepayPaidAt,webSepayPaidAt} from './web-sepay-evidence.ts';
import {webOrderPayment} from '../domain/web-order-payment.ts';
import {vietnamDate} from '../domain/sales.ts';
import {WEB_PAYMENT_BLOCKED_STATUSES} from '../domain/web-order-outcome.ts';
import {posGhnFeeHint} from '../domain/pos-ghn-fee-hint.ts';
type Ctx=RouteContext<StaffEnv>;
/** Latest GHN tracking code of a CRM/POS order: the only evidence that lets a SePay line offset a carrier fee. */
const ghnCodeOf=(id:unknown)=>sql<string|null>`(select d.tracking_code from ${deliveries} d where d.order_id=${id} and upper(trim(d.carrier))='GHN' and trim(d.tracking_code)<>'' and d.status<>'cancelled' order by d.planned_date desc nulls last,d.id desc limit 1)`;
const ghnFeeHintOf=(id:unknown)=>sql<number|null>`(select d.shipping_fee from ${deliveries} d where d.order_id=${id} and upper(trim(d.carrier))='GHN' and trim(d.tracking_code)<>'' and d.status<>'cancelled' order by d.planned_date desc nulls last,d.id desc limit 1)`;
const who=(c:Ctx)=>(c.state.session as SessionState).member;
function fail(message:string,status=409):never{throw new AppError(status,message);}
async function canonical(db:CashDb,id:string){
 if(id.startsWith('contract:')){const [r]=await db.select({id:contracts.orderId}).from(contracts).where(eq(contracts.id,id.slice(9)));return r?.id??fail('Không tìm thấy chứng từ.',404);}
 return id.startsWith('order:')?id.slice(6):id;
}
async function readEvent(c:Ctx,db:CashDb,lock=false){
 assertSepayReconcileAccess(who(c));
 const [hint]=await db.select().from(bank).where(eq(bank.id,c.params.id!));if(!hint)fail('Không tìm thấy giao dịch.',404);
 if(lock){await db.execute(sql`select pg_advisory_xact_lock(hashtext(${'sepay:'+hint.providerId}))`);await db.select({id:bank.id}).from(bank).where(eq(bank.id,hint.id)).for('update');}
 const [event]=await db.select().from(bank).where(eq(bank.id,hint.id));if(event!.transferType!=='in')fail('Chỉ phân bổ tiền vào.');
 if(event!.webOrderId)await assertSepayReconcileTarget(db,who(c),'web:'+event!.webOrderId);
 if(event!.orderId)await assertSepayReconcileTarget(db,who(c),event!.orderId);
 for(const a of await allocationRows(db,hint.id))await assertSepayReconcileTarget(db,who(c),a.webOrderId?'web:'+a.webOrderId:a.orderId!);
 return event!;
}
async function summary(c:Ctx,db:CashDb){
 const event=await readEvent(c,db),[s]=await db.select().from(states).where(eq(states.transactionId,event.id)),rows=await allocationRows(db,event.id);
 const [review]=await db.select({needed:allocationNeedsReview(event.id)}).from(bank).where(eq(bank.id,event.id));
 const labels=new Map<string,string>();
 const oids=rows.flatMap(a=>a.orderId?[a.orderId]:[]),wids=rows.flatMap(a=>a.webOrderId?[a.webOrderId]:[]);
 if(oids.length)for(const o of await db.select({id:orders.id,no:orders.orderNo}).from(orders).where(inArray(orders.id,oids)))labels.set(o.id,o.no);
 if(wids.length)for(const w of await db.select({id:web.id,no:web.orderNo}).from(web).where(inArray(web.id,wids)))labels.set('web:'+w.id,w.no);
 const history=await db.select({result:batches.result}).from(batches).where(eq(batches.transactionId,event.id));
 const carrierComparisons=new Map<string,string>();
 const comparisons=new Map<string,number>();for(const h of history){const result=JSON.parse(h.result);for(const d of result.comparisons??[]){comparisons.set(d.allocationId,d.expectedAmount);if(d.settlementKind==='ghn_cod')carrierComparisons.set(d.allocationId,d.ghnCode);}}
 const allocated=rows.filter(a=>!a.voidedAt).reduce((n,a)=>n+a.amount,0);
 return {transactionId:event.id,amount:event.amount,revision:s?.revision??0,detailed:!!s,needsReview:!!review?.needed,canVoid:canVoidPayment(who(c)),canReplaceReceipt:canReplaceSepayReceipt(who(c)),allocated,remaining:event.amount-allocated,allocations:rows.map(a=>({...a,settlementKind:carrierComparisons.has(a.id)?'ghn_cod':null,ghnCode:carrierComparisons.get(a.id)||null,expectedAmount:comparisons.get(a.id)??a.amount+a.ghnFee,difference:a.amount+a.ghnFee-(comparisons.get(a.id)??a.amount+a.ghnFee),targetNo:labels.get(a.webOrderId?'web:'+a.webOrderId:a.orderId!)||a.targetKey}))};
}
export function registerSepayAllocationRoutes(router:Router<StaffEnv>){
 const path='/sepay/transactions/:id/allocations';
 router.get(path,async c=>json(await summary(c,c.env.db)),'business');
 router.get('/sepay/transactions/:id/allocation-candidates',async c=>{
  const event=await readEvent(c,c.env.db);const q=(c.url.searchParams.get('q')||'').trim(),raw=c.url.searchParams.get('offset')||'0';
  const source=c.url.searchParams.get('source')||'all',from=c.url.searchParams.get('from')||'',to=c.url.searchParams.get('to')||'';
  if(!['all','crm','pos','web','contract','ghn'].includes(source)||[from,to].some(d=>d&&!/^\d{4}-\d{2}-\d{2}$/.test(d))||from&&to&&from>to)fail('Bộ lọc không hợp lệ.',400);
  if(q.length>120||!/^\d{1,6}$/.test(raw))fail('Bộ lọc không hợp lệ.',400);const offset=Number(raw),pattern='%'+q.replace(/[\\%_]/g,'\\$&')+'%';
  const crm=await c.env.db.select({o:orders,contractNo:contracts.contractNo,ghnCode:ghnCodeOf(orders.id),ghnFeeHint:ghnFeeHintOf(orders.id)}).from(orders).leftJoin(contracts,eq(contracts.orderId,orders.id)).where(and(orderScopeFor(who(c)),source==='web'?sql`false`:source==='ghn'?sql`(${ghnCodeOf(orders.id)} is not null or exists(select 1 from ${deliveries} d where d.order_id=${orders.id} and upper(trim(d.carrier))='GHN' and d.status<>'cancelled'))`:source==='pos'?eq(orders.channel,'pos'):source==='crm'?eq(orders.channel,'crm'):source==='contract'?isNotNull(contracts.id):undefined,from?sql`${orders.orderDate}>=${from}`:undefined,to?sql`${orders.orderDate}<=${to}`:undefined,sql`${orders.status}<>'cancelled'`,q?or(ilike(orders.orderNo,pattern),ilike(orders.invoiceNo,pattern),ilike(contracts.contractNo,pattern),ilike(orders.customerName,pattern),sql`exists(select 1 from ${deliveries} d where d.order_id=${orders.id} and d.tracking_code ilike ${pattern})`):undefined)).orderBy(desc(orders.createdAt),asc(orders.id)).limit(51).offset(offset);
  const ws=await c.env.db.select({o:web,evidence:webSepayPaidAt()}).from(web).where(and(sepayWebOrderScope(who(c)),!['all','web','ghn'].includes(source)?sql`false`:source==='ghn'?sql`trim(${web.ghnOrderCode})<>''`:undefined,from?sql`left(${web.orderedAt},10)>=${from}`:undefined,to?sql`left(${web.orderedAt},10)<=${to}`:undefined,inArray(web.source,['lock','minhlong']),q?or(ilike(web.orderNo,pattern),ilike(web.crmOrderNo,pattern),ilike(web.customerName,pattern),ilike(web.ghnOrderCode,pattern)):undefined)).orderBy(desc(web.orderedAt),asc(web.id)).limit(51).offset(offset);
  const debts=await netReceivables(c.env.db,crm.map(r=>r.o.id),vietnamDate().iso);
  // POS transfer receipts already reduce debt; keep them selectable for linking without another receipt.
  const receipts=crm.length?await c.env.db.select({id:payments.id,orderId:payments.orderId,amount:payments.amount,paidAt:payments.paidAt,reference:payments.reference,source:payments.paymentSource}).from(payments).where(and(inArray(payments.orderId,crm.map(r=>r.o.id)),isNull(payments.voidedAt),or(and(eq(payments.method,'transfer'),eq(payments.paidAt,sepayPaidDate(event.transactionAt)),inArray(payments.paymentSource,['manual','sepay_auto','pos_transfer'])),eq(payments.paymentSource,'ghn_cod')),sql`not exists(select 1 from ${bank} where ${bank.paymentId}=${payments.id})`,sql`not exists(select 1 from ${allocations} where ${allocations.paymentId}=${payments.id} and ${allocations.voidedAt} is null)`)):[];
  return json({offset,limit:50,hasMore:crm.length>50||ws.length>50,candidates:[...crm.slice(0,50).flatMap(({o,contractNo,ghnCode,ghnFeeHint})=>{const d=debts.get(o.id),existingPayments=receipts.filter(p=>p.orderId===o.id);return d&&(d.balance>0||existingPayments.length)?[{targetId:o.id,orderNo:o.orderNo,contractNo,invoiceNo:o.invoiceNo,customerName:o.customerName,total:o.total,paid:d.paid,outstanding:d.balance,existingPayments,ghnCode:ghnCode||'',ghnFeeHint:o.channel==='pos'?posGhnFeeHint(o.posSnapshot,ghnCode,Number(ghnFeeHint)||0):Number(ghnFeeHint)||0}]:[];}),...ws.slice(0,50).flatMap(({o,evidence})=>{const p=webOrderPayment(o,evidence);return !webOrderPaymentBlocked(o.status,o.ghnStatus)&&(p.outstanding===null||p.outstanding>0)?[{targetId:'web:'+o.id,orderNo:o.crmOrderNo||o.orderNo,customerName:o.customerName,total:o.total,paid:p.paid,outstanding:p.outstanding,paymentReviewRequired:p.paid===null,ghnCode:o.ghnOrderCode||'',ghnFeeHint:Number(o.ghnFee)||0,blockedReason:p.paymentEvidence==='conflict'?'Cần đối soát lại thay đổi đơn web.':''}]:[];})]});
 },'business');
 router.post(path,async c=>{
  assertSepayReconcileAccess(who(c));
  const b=await readJson(c.req,64000),key=String(b.clientKey||'');
  if(key.length<8||key.length>200||!Number.isSafeInteger(b.expectedRevision)||Number(b.expectedRevision)<0||!Array.isArray(b.lines)||!b.lines.length||b.lines.length>100)fail('Lô phân bổ không hợp lệ.',400);
  const rows=await Promise.all(b.lines.map(async(x:any)=>{if(typeof x.targetId!=='string'||x.targetId.length>200||!Number.isSafeInteger(x.amount)||x.amount<=0||x.amount>1e12)fail('Dòng phân bổ không hợp lệ.',400);if(x.expectedAmount!==undefined&&(!Number.isSafeInteger(x.expectedAmount)||x.expectedAmount<=0||x.expectedAmount>1e12))fail('Số tiền đối chiếu không hợp lệ.',400);if(x.ghnFee!==undefined&&(!Number.isSafeInteger(x.ghnFee)||x.ghnFee<0||x.ghnFee>1e12))fail('Phí GHN không hợp lệ.',400);const ghnFee=Number(x.ghnFee??0),settled=Number(x.amount)+ghnFee;if(x.expectedAmount!==undefined&&x.expectedAmount!==settled&&x.differenceConfirmed!==true)fail('Cần xác nhận chênh lệch trước khi đối soát.',400);return {ghnFee,expectedAmount:Number(x.expectedAmount??settled),differenceConfirmed:x.differenceConfirmed===true,targetId:await canonical(c.env.db,x.targetId),amount:Number(x.amount),existingPaymentId:String(x.existingPaymentId||''),paymentReviewed:x.paymentReviewed===true};}));
  rows.sort((a,b)=>a.targetId.localeCompare(b.targetId));if(new Set(rows.map(r=>r.targetId)).size!==rows.length)fail('Trùng đơn/HĐKT/hóa đơn trong lô.',400);
  const hash=await sha256Hex(JSON.stringify({id:c.params.id,revision:b.expectedRevision,rows:rows.map(r=>({targetId:r.targetId,amount:r.amount,existingPaymentId:r.existingPaymentId,paymentReviewed:r.paymentReviewed,...(r.ghnFee?{ghnFee:r.ghnFee}:{}),...(r.expectedAmount!==r.amount+r.ghnFee?{expectedAmount:r.expectedAmount,differenceConfirmed:r.differenceConfirmed}:{})}))}));
  return json(await c.env.db.transaction(async tx=>{
   const e=await readEvent(c,tx,true);await cashLock(tx);
   for(const r of rows)await assertSepayReconcileTarget(tx,who(c),r.targetId);
   const [prior]=await tx.select().from(batches).where(and(eq(batches.createdBy,who(c).id),eq(batches.clientKey,key)));
   if(prior){if(prior.requestHash!==hash)fail('Mã thao tác đã dùng cho nội dung khác.');return {...JSON.parse(prior.result),replayed:true};}
   if((await tx.select({needed:allocationNeedsReview(e.id)}).from(bank).where(eq(bank.id,e.id)))[0]?.needed)fail('Tổng đơn web đã thay đổi; cần đối soát lại trước khi phân bổ thêm.');
   const [state]=await tx.select().from(states).where(eq(states.transactionId,e.id));
   if(!state&&(e.status==='matched'||e.paymentId))fail('Giao dịch đã khớp nhanh; không phân bổ lại.');
   if((state?.revision??0)!==b.expectedRevision)fail('Giao dịch vừa thay đổi; tải lại số tiền trước khi phân bổ.');
   const previous=await allocationRows(tx,e.id),used=previous.filter(a=>!a.voidedAt).reduce((n,a)=>n+a.amount,0),amount=rows.reduce((n,r)=>n+r.amount,0);
   if(amount>e.amount-used)fail('Tổng phân bổ vượt tiền thực nhận còn lại.');
   const id=crypto.randomUUID(),at=new Date().toISOString(),comparisons:{allocationId:string;expectedAmount:number;amount:number;ghnFee:number;replacedPaymentId:string|null;settlementKind?:'ghn_cod';ghnCode?:string}[]=[];
   if(!state)await tx.insert(states).values({transactionId:e.id});
   await tx.insert(batches).values({id,transactionId:e.id,createdBy:who(c).id,clientKey:key,requestHash:hash,expectedRevision:Number(b.expectedRevision),createdAt:at,result:'{}'});
   for(const r of rows){
    const aid=crypto.randomUUID();let carrierCode:string|undefined;let replacedPaymentId:string|null=null,orderId:string|null=null,webOrderId:string|null=null,paymentId:string|null=null,feePaymentId:string|null=null,createdReceipt=false,total=0;
    if(r.targetId.startsWith('web:')){
     webOrderId=r.targetId.slice(4);const [w]=await tx.select().from(web).where(eq(web.id,webOrderId)).for('update');
     if(!w||w.currency!=='VND'||!['lock','minhlong'].includes(w.source)||webOrderPaymentBlocked(w.status,w.ghnStatus))fail('Đơn web không đủ điều kiện nhận tiền.');
     const [reg]=await tx.select().from(registers).where(eq(registers.id,w!.registerId));if(!reg?.active||reg.bankAccount.replace(/\s+/g,'')!==e.accountNumber)fail('Tài khoản nhận không thuộc cửa hàng.');
     const p=webOrderPayment(w!,await readWebSepayPaidAt(tx,webOrderId));if(p.paymentEvidence==='conflict'||p.paid===null&&!r.paymentReviewed)fail('Cần đối chiếu thanh toán website trước khi phân bổ.');
     if(r.expectedAmount>(p.outstanding??w!.total))fail('Số nhận vượt còn nợ đơn web.');if(r.ghnFee&&!w!.ghnOrderCode)fail('Đơn web chưa có vận đơn GHN; không cấn trừ phí GHN.');if(r.ghnFee>=r.amount+r.ghnFee)fail('Phí GHN phải nhỏ hơn số COD.');total=w!.total;
    }else{
     orderId=r.targetId;const [o]=await tx.select().from(orders).where(eq(orders.id,orderId)).for('update');if(!o||o.status==='cancelled')fail('Đơn không còn hiệu lực.');total=o!.total;
     if(o.channel==='crm')await assertSepayCrmSource(tx,e);
     else{const [reg]=await tx.select({account:registers.bankAccount}).from(posShifts).innerJoin(registers,eq(registers.id,posShifts.registerId)).where(eq(posShifts.id,o.shiftId||''));if(reg?.account.replace(/\s+/g,'')!==e.accountNumber)fail('Tài khoản nhận không khớp quầy POS.');}
     const [contract]=await tx.select({no:contracts.contractNo}).from(contracts).where(eq(contracts.orderId,orderId));
     if(!await sepayManualAccountApproved(tx,c.env,e.accountNumber,contract?.no))fail('Tài khoản ngân hàng chưa được duyệt ghi thu.');
     if(r.ghnFee){const [g]=await tx.select({code:ghnCodeOf(orderId)}).from(orders).where(eq(orders.id,orderId));if(!g?.code)fail('Đơn chưa có vận đơn GHN; không cấn trừ phí GHN.');}
     if(r.existingPaymentId){
      const [p]=await tx.select().from(payments).where(eq(payments.id,r.existingPaymentId)).for('update');
      if(p?.paymentSource==='ghn_cod'){
       // GHN already collected the full COD from the customer; the bank only shows COD minus carrier fees.
       if(p.orderId!==orderId||p.voidedAt||r.expectedAmount!==p.amount||r.ghnFee>=p.amount)fail('Phiếu "GHN đã thu COD" không khớp số COD đối chiếu.');
       const [shipment]=await tx.select().from(deliveries).where(and(eq(deliveries.orderId,orderId),p.deliveryId?eq(deliveries.id,p.deliveryId):undefined,sql`upper(trim(${deliveries.carrier}))='GHN'`,sql`upper(trim(${deliveries.trackingCode}))=${p.reference.trim().toUpperCase()}`,sql`trim(${deliveries.trackingCode})<>''`,sql`${deliveries.status}<>'cancelled'`)).limit(1);
       if(!shipment)fail('Vận đơn GHN của phiếu thu không còn khớp; cần kiểm tra lại.');
       carrierCode=shipment.trackingCode;
       if(r.amount+r.ghnFee!==p.amount&&!canReplaceSepayReceipt(who(c)))fail('Cần quyền duyệt chênh lệch phiếu thu khi đối soát SePay.',403);
       if((await tx.select({id:bank.id}).from(bank).where(eq(bank.paymentId,p.id))).length)fail('Phiếu thu đã khớp giao dịch khác.');
       if((await tx.select({id:allocations.id}).from(allocations).where(and(eq(allocations.paymentId,p.id),isNull(allocations.voidedAt))).limit(1)).length)fail('Phiếu thu đã nằm trong phân bổ khác.');
       paymentId=p.id;
      }else{
      if(r.ghnFee)fail('Phí GHN chỉ cấn trừ khi tạo phiếu mới hoặc gắn phiếu "GHN đã thu COD".');
      if(!p||p.orderId!==orderId||p.voidedAt||p.method!=='transfer'||p.amount!==r.expectedAmount||p.paidAt!==sepayPaidDate(e.transactionAt)||!['manual','sepay_auto','pos_transfer'].includes(p.paymentSource))fail('Phiếu thu nguồn không khớp.');
      const linked=await tx.select({id:bank.id}).from(bank).where(eq(bank.paymentId,p!.id));if(linked.length)fail('Phiếu thu đã khớp giao dịch khác.');paymentId=p!.id;
      if((await tx.select({id:allocations.id}).from(allocations).where(and(eq(allocations.paymentId,p!.id),isNull(allocations.voidedAt))).limit(1)).length)fail('Phiếu thu đã nằm trong phân bổ khác.');
      if(r.amount!==p!.amount){
       if(!canReplaceSepayReceipt(who(c)))fail('Cần quyền Huỷ phiếu thu hoặc quyền Sửa phiếu thu lệch khi đối soát SePay.',403);
       await assertNoReturnActivity(tx,orderId);
       replacedPaymentId=p!.id;paymentId=crypto.randomUUID();createdReceipt=true;
       const reason='Đối soát SePay '+e.providerId+': thay phiếu '+p!.amount+' bằng số thực nhận '+r.amount;
       await tx.update(payments).set({voidedAt:at,voidedBy:who(c).id,voidReason:reason}).where(eq(payments.id,p!.id));
       await tx.insert(payments).values({id:paymentId,orderId,customerId:p!.customerId,shiftId:p!.shiftId,scheduleId:p!.scheduleId,amount:r.amount,paidAt:p!.paidAt,method:'transfer',paymentSource:'sepay_allocation',requestKey:'sepay-allocation:'+aid,reference:'SePay '+e.providerId,note:reason,createdBy:who(c).id,createdAt:at});
       await cashAudit(tx,who(c).id,'sepay.replace-receipt','payments',p!.id,{replacementId:paymentId,before:p!.amount,after:r.amount,transactionId:e.id});
      }
      }
     }else{
      if(o!.channel!=='crm')fail(o!.fulfillmentMode==='cod'?'Đơn POS giao COD chưa có phiếu "GHN đã thu COD"; đồng bộ trạng thái GHN trước khi đối soát.':'Đơn POS chỉ gắn phiếu thu đã có; không tạo thu trùng.');
      const d=(await netReceivables(tx,[orderId],vietnamDate().iso)).get(orderId);if(!d||r.expectedAmount>d.balance)fail('Số nhận vượt còn nợ của đơn.');
      paymentId=crypto.randomUUID();createdReceipt=true;
      await tx.insert(payments).values({id:paymentId,orderId,customerId:o!.customerId,amount:r.amount,paidAt:sepayPaidDate(e.transactionAt),method:'transfer',paymentSource:'sepay_allocation',requestKey:'sepay-allocation:'+aid,reference:'SePay '+e.providerId,note:'Phân bổ giao dịch '+e.id,createdBy:who(c).id,createdAt:at});
      if(r.ghnFee){
       const [g]=await tx.select({code:ghnCodeOf(orderId)}).from(orders).where(eq(orders.id,orderId));if(!g?.code)fail('Đơn chưa có vận đơn GHN; không cấn trừ phí GHN.');
       // Customer paid the full COD to GHN; the withheld fee settles the rest of the debt, never as bank money.
       feePaymentId=crypto.randomUUID();
       await tx.insert(payments).values({id:feePaymentId,orderId,customerId:o!.customerId,amount:r.ghnFee,paidAt:sepayPaidDate(e.transactionAt),method:'other',paymentSource:'ghn_fee_offset',requestKey:'sepay-ghn-fee:'+aid,reference:'GHN '+g!.code,note:'Phí GHN cấn trừ khi GHN trả COD · SePay '+e.providerId,createdBy:who(c).id,createdAt:at});
      }
     }
    }
    if(!carrierCode&&r.ghnFee&&r.amount+r.ghnFee>r.expectedAmount)fail('Tiền ngân hàng nhận + phí GHN vượt số COD của đơn; kiểm tra lại phí GHN.',400);
    comparisons.push({...(carrierCode?{settlementKind:'ghn_cod' as const,ghnCode:carrierCode}:{}),allocationId:aid,expectedAmount:r.expectedAmount,amount:r.amount,ghnFee:r.ghnFee,replacedPaymentId});
    await tx.insert(allocations).values({id:aid,batchId:id,targetKey:webOrderId?'web:'+webOrderId:'order:'+orderId,orderId,webOrderId,amount:r.amount,targetTotal:total,paymentId,createdReceipt,ghnFee:r.ghnFee,feePaymentId,createdAt:at});
   }
   const result={batchId:id,comparisons,revision:Number(b.expectedRevision)+1,allocated:used+amount,remaining:e.amount-used-amount};
   await tx.update(states).set({revision:result.revision}).where(eq(states.transactionId,e.id));await tx.update(batches).set({result:JSON.stringify(result)}).where(eq(batches.id,id));
   await tx.update(bank).set({orderId:null,webOrderId:null,paymentId:null,status:result.remaining===0?'matched':'review',reason:'Đối soát chi tiết; còn chưa phân bổ '+result.remaining}).where(eq(bank.id,e.id));await cashAudit(tx,who(c).id,'sepay.allocate','sepay_transaction',e.id,{batchId:id,amount,comparisons,remaining:result.remaining});return result;
  }));
 },'business');
 router.post(path+'/:allocationId/void',async c=>{
  const b=await readJson(c.req,4000),reason=String(b.reason||'').trim();if(reason.length<3||reason.length>1000||!Number.isSafeInteger(b.expectedRevision))fail('Nhập lý do và phiên bản hợp lệ.',400);
  assertSepayReconcileAccess(who(c));if(!canVoidPayment(who(c)))fail('Cần quyền huỷ phiếu thu để gỡ phân bổ.',403);
  return json(await c.env.db.transaction(async tx=>{
   const e=await readEvent(c,tx,true);await cashLock(tx);const rows=await allocationRows(tx,e.id),a=rows.find(a=>a.id===c.params.allocationId);if(!a)fail('Không tìm thấy phân bổ.',404);
   if(a!.voidedAt){if(a!.voidedBy===who(c).id&&a!.voidReason===reason)return {id:a!.id,replayed:true};fail('Phân bổ đã gỡ.');}
   const [s]=await tx.select().from(states).where(eq(states.transactionId,e.id));if(s!.revision!==b.expectedRevision)fail('Giao dịch vừa thay đổi; tải lại để gỡ.');
   const at=new Date().toISOString();
   if(a!.orderId){await tx.select({id:orders.id}).from(orders).where(eq(orders.id,a!.orderId)).for('update');await assertNoReturnActivity(tx,a!.orderId);
    if(a!.createdReceipt){const [p]=await tx.select().from(payments).where(eq(payments.id,a!.paymentId!)).for('update');if(!p||p.voidedAt||p.orderId!==a!.orderId||p.amount!==a!.amount||p.method!=='transfer')fail('Phiếu thu nguồn đã thay đổi; cần đối soát trước khi gỡ.');await tx.update(payments).set({voidedAt:at,voidedBy:who(c).id,voidReason:reason}).where(and(eq(payments.id,a!.paymentId!),isNull(payments.voidedAt)));}
    if(a!.feePaymentId){const [fp]=await tx.select().from(payments).where(eq(payments.id,a!.feePaymentId)).for('update');if(!fp||fp.voidedAt||fp.orderId!==a!.orderId||fp.amount!==a!.ghnFee)fail('Phiếu cấn trừ phí GHN đã thay đổi; cần đối soát trước khi gỡ.');await tx.update(payments).set({voidedAt:at,voidedBy:who(c).id,voidReason:reason}).where(and(eq(payments.id,fp!.id),isNull(payments.voidedAt)));}
   }else{const [w]=await tx.select().from(web).where(eq(web.id,a!.webOrderId!)).for('update');if(w?.ghnOrderCode)fail('Đơn đã có vận đơn; cần đối soát COD trước khi gỡ.');}
   await tx.update(allocations).set({voidedAt:at,voidedBy:who(c).id,voidReason:reason}).where(eq(allocations.id,a!.id));await tx.update(states).set({revision:s!.revision+1}).where(eq(states.transactionId,e.id));await tx.update(bank).set({status:'review',reason:'Đã gỡ một phân bổ; xem lịch sử đối soát chi tiết.'}).where(eq(bank.id,e.id));await cashAudit(tx,who(c).id,'sepay.unallocate','sepay_transaction',e.id,{allocationId:a!.id,reason});return {id:a!.id,revision:s!.revision+1};
  }));
 },'business');
}
