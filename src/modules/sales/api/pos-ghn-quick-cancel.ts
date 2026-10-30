import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';
import { AppError } from '../../../core/errors.ts';
import { json, readJson, type Router, type RouteContext } from '../../../core/http/router.ts';
import type { StaffEnv, SessionState } from '../../staff/api/auth-routes.ts';
import { employees } from '../../staff/schema.ts';
import { warehouses } from '../../catalog/schema.ts';
import { recordMovements } from '../../catalog/api/product-history.ts';
import { stockMoves } from '../../inventory/schema.ts';
import { reverseRef } from '../../inventory/api/ledger.ts';
import type { StockRefType } from '../../inventory/domain/kinds.ts';
import { deliveries, packingSlips, salesOrders, salesOrderLines } from '../schema.ts';
import { posRegisters, posShifts } from '../pos-schema.ts';
import { posReturns, posReturnLines, posRefunds } from '../return-schema.ts';
import { posOrderReservations, posPaymentIntents } from '../pos-order-flow-schema.ts';
import { cashDrawers, cashEntries } from '../cash-schema.ts';
import { cashAudit, cashLock, type CashDb } from './cash-store.ts';
import { allowedRegister, allowedDrawer } from './pos-access.ts';
import { saleShiftOf, assertOpen, posKey, posText } from './pos-store.ts';
import { returnAccount } from './pos-return-credit.ts';
import { posGhnAccount } from './pos-ghn-account.ts';
import { assertNoPendingGhnEdit, posSnapshot } from '../domain/pos-ghn-edit.ts';
import { snapshotPosFees } from '../domain/pos-fees.ts';
import { cashTasksChanged } from './invoice-task-hooks.ts';
import { sha256Hex } from '../../staff/domain/session.ts';
type Ctx = RouteContext<StaffEnv>;
const actor=(c:Ctx)=>(c.state.session as SessionState).member;
const terminal=new Set(['cancel','returned']);
function manager(c:Ctx){if(actor(c).role!=='manager')throw new AppError(403,'Chỉ Manager được huỷ nhanh đơn GHN.');}
const issueRefs=(id:string)=>sql`(${stockMoves.refType}='pos_order' and ${stockMoves.refId}=${id}) or
 (${stockMoves.refType}='pos_delivery' and exists(select 1 from ${deliveries} d where d.id=${stockMoves.refId} and d.order_id=${id})) or
 (${stockMoves.refType}='packing_slip' and exists(select 1 from ${packingSlips} p where p.id=${stockMoves.refId} and p.order_id=${id}))`;

async function local(c:Ctx,db:CashDb,id:string){
 manager(c);const [o]=await db.select().from(salesOrders).where(eq(salesOrders.id,id));
 if(!o||o.channel!=='pos'||o.fulfillmentMode!=='cod'||!o.shiftId)throw new AppError(404,'Không tìm thấy đơn POS giao COD.');
 const [s]=await db.select().from(posShifts).where(eq(posShifts.id,o.shiftId));
 if(!s||!allowedRegister(c,s.registerId)||!allowedDrawer(c,s.cashDrawerId))throw new AppError(403,'Đơn thuộc quầy/két không được phép xử lý.');
 return {o,s,snap:posSnapshot(o.posSnapshot)};
}
async function eligible(c:Ctx,db:CashDb,id:string){
 const {o,s,snap}=await local(c,db,id);assertNoPendingGhnEdit(snap);
 if(['cancelled','delivered'].includes(o.status))throw new AppError(409,'Đơn đã huỷ hoặc đã giao thành công.');
 if(o.invoiceStatus==='issued'||o.invoiceNo||o.invoiceIssuedAt)throw new AppError(409,'Cần xử lý hoá đơn đã xuất trước khi huỷ.');
 if(snap.exchangeCredit)throw new AppError(409,'Đơn dùng tín dụng đổi hàng cần đối soát theo luồng đổi/trả.');
 const account=await returnAccount(db,id);
 if(account.returns.length||account.refunds.length||account.allocations.length)throw new AppError(409,'Đơn đã có phiếu trả/hoàn tiền; tiếp tục xử lý phiếu hiện có để tránh ghi trùng.');
 if(account.paid<0||account.paid>o.total)throw new AppError(409,'Tiền đã thu không khớp giá trị đơn. Cần đối soát trước.');
 const ships=await db.select().from(deliveries).where(eq(deliveries.orderId,id)).orderBy(asc(deliveries.id));
 const tracked=ships.filter(d=>d.trackingCode.trim());
 if(!tracked.length||tracked.some(d=>d.carrier.trim().toLowerCase()!=='ghn')||ships.some(d=>!d.trackingCode&&d.status!=='cancelled'))throw new AppError(409,'Đơn phải có vận đơn GHN và không còn chuyến giao khác đang mở.');
 const lines=await db.select().from(salesOrderLines).where(eq(salesOrderLines.orderId,id)).orderBy(asc(salesOrderLines.lineNo));
 if(!lines.length||lines.some(l=>l.qty<=0||l.deliveredQty>0))throw new AppError(409,'Đơn đã ghi giao hàng hoặc thiếu dòng sản phẩm; dùng luồng thu hồi hiện có.');
 const issued=await db.select({sku:stockMoves.sku,warehouseId:stockMoves.warehouseId,qty:sql<number>`-sum(${stockMoves.qty})`.mapWith(Number)}).from(stockMoves).where(issueRefs(id)).groupBy(stockMoves.sku,stockMoves.warehouseId);
 const quantities=new Map<string,number>();for(const l of lines)quantities.set(l.sku,(quantities.get(l.sku)||0)+l.qty);
 if(!snap.register?.warehouseId||issued.some(i=>i.qty < -1e-9||i.warehouseId!==snap.register.warehouseId||!quantities.has(i.sku)||i.qty>(quantities.get(i.sku)||0)+1e-9))throw new AppError(409,'Số xuất/kho gốc không khớp đơn. Cần đối soát kho trước.');
 const fees=snapshotPosFees(snap),prepared=lines.map(l=>{const original=snap.lines?.find((x:{sku:string})=>x.sku===l.sku);if(!original||original.subtotal!==l.amount||!Number.isSafeInteger(original.tax))throw new AppError(409,'Giá/VAT không khớp snapshot đơn gốc.');return {...l,refundTax:original.tax as number,restock:Math.max(0,issued.find(i=>i.sku===l.sku)?.qty||0)};});
 if(prepared.reduce((n,l)=>n+l.amount,0)+fees.subtotal!==o.subtotal||prepared.reduce((n,l)=>n+l.refundTax,0)+fees.tax!==o.tax)throw new AppError(409,'Tổng hàng/phí/VAT không khớp đơn gốc.');
 return {o,s,snap,account,ships,tracked,lines:prepared,fees};
}
/** Read GHN outside all cash/stock locks; never trust cached tracking labels or caller-supplied status. */
async function evidence(c:Ctx,data:Awaited<ReturnType<typeof eligible>>){
 const [register]=await c.env.db.select().from(posRegisters).where(eq(posRegisters.id,data.s.registerId));
 const account=await posGhnAccount(c.env,register?.name);if(!account)throw new AppError(409,'Quầy này chưa hỗ trợ kiểm tra GHN.');
 const result=[];
 for(const ship of data.tracked){
  let raw:any;
  try{const r=await (c.env.ghnFetch||fetch)('https://online-gateway.ghn.vn/shiip/public-api/v2/shipping-order/detail',{method:'POST',headers:{Token:account.token,ShopId:account.shopId,'content-type':'application/json'},body:JSON.stringify({order_code:ship.trackingCode}),signal:AbortSignal.timeout(8000)});raw=await r.json();if(!r.ok||raw.code!==200)throw Error('unconfirmed');}
  catch{throw new AppError(502,'Chưa kiểm tra được GHN. Chưa huỷ đơn hoặc thay đổi kho/tiền.');}
  const d=raw.data,status=String(d?.status||'').trim().toLowerCase();
  if(d?.order_code!==ship.trackingCode||(d.shop_id!==undefined&&String(d.shop_id)!==account.shopId)||(d.client_order_code&&d.client_order_code!==data.o.orderNo))throw new AppError(409,'Vận đơn GHN không khớp đơn/quầy.');
  if(!terminal.has(status))throw new AppError(409,`${ship.trackingCode}: chỉ huỷ nhanh khi GHN đã huỷ (cancel) hoặc hoàn thành công (returned).`);
  result.push({id:ship.id,code:ship.trackingCode,status,checkedAt:new Date().toISOString()});
 }
 return result;
}
export function registerPosGhnQuickCancel(router:Router<StaffEnv>){
 router.get('/pos/orders/:id/ghn-quick-cancel',async c=>{
  const d=await eligible(c,c.env.db,c.params.id!),ghn=await evidence(c,d);
  const shifts=await c.env.db.select({id:posShifts.id,openedAt:posShifts.openedAt,memberName:employees.name}).from(posShifts).innerJoin(employees,eq(employees.id,posShifts.memberId))
   .where(and(eq(posShifts.registerId,d.s.registerId),eq(posShifts.cashDrawerId,d.s.cashDrawerId),isNull(posShifts.closedAt))).orderBy(desc(posShifts.openedAt));
  const [warehouse]=await c.env.db.select().from(warehouses).where(eq(warehouses.id,d.snap.register.warehouseId));
  return json({mode:'ghn',orderNo:d.o.orderNo,revision:d.o.revision,amount:d.account.paid,method:'transfer',warehouse:warehouse?.name||'Kho gốc',shifts,ghn,
   lines:d.lines.map(l=>({sku:l.sku,name:l.name,qty:l.restock,unit:l.unit})).filter(l=>l.qty>0),sapoManual:!!d.o.sapoOrderId});
 },'business');
 router.post('/pos/orders/:id/ghn-quick-cancel',async c=>{
  manager(c);const b=await readJson(c.req,6000),key=posKey(b.key),reason=posText(b.reason,2000),reference=posText(b.reference,200),shiftId=posText(b.shiftId),method=posText(b.method,20);
  if(!reason||b.confirmed!==true)throw new AppError(400,'Nhập lý do và xác nhận huỷ, nhận hàng/hoàn tiền trong cùng thao tác.');
  const hash=sha256Hex(JSON.stringify({reason,reference,shiftId,method,revision:b.revision}));
  const replay=async(db:CashDb)=>{const d=await local(c,db,c.params.id!),prior=d.snap.quickCancellation;if(!prior)return null;if(prior.mode!=='ghn'||prior.key!==key||prior.by!==actor(c).id||prior.hash!==hash)throw new AppError(409,'Đơn đã huỷ; không ghi kho/hoàn tiền thêm.');return {orderId:d.o.id,returnId:prior.returnId,refundId:prior.refundId,replayed:true};};
  const prior=await replay(c.env.db);if(prior)return json(prior);
  const before=await eligible(c,c.env.db,c.params.id!);if(before.o.revision!==b.revision)throw new AppError(409,'Đơn vừa thay đổi. Mở lại trước khi huỷ.');
  const ghn=await evidence(c,before);
  const result=await c.env.db.transaction(async tx=>{
   await cashLock(tx);await tx.execute(sql`select pg_advisory_xact_lock(hashtext('stock_holds'))`);
   await tx.select({id:salesOrders.id}).from(salesOrders).where(eq(salesOrders.id,before.o.id)).for('update');
   const prior=await replay(tx);if(prior)return prior;
   const d=await eligible(c,tx,before.o.id),{o,s,snap,account,lines,fees}=d;
   if(o.revision!==b.revision||JSON.stringify(d.ships.map(x=>[x.id,x.trackingCode,x.carrier,x.status]))!==JSON.stringify(before.ships.map(x=>[x.id,x.trackingCode,x.carrier,x.status]))||account.paid!==before.account.paid)throw new AppError(409,'Đơn/chuyến giao/tiền đã thay đổi trong lúc kiểm tra GHN. Mở lại trước khi huỷ.');
   let shift=s;
   if(account.paid>0){if(!['cash','transfer'].includes(method))throw new AppError(400,'Chọn cách hoàn tiền thực tế.');shift=await saleShiftOf(tx,actor(c),shiftId,true);assertOpen(shift,actor(c));if(shift.registerId!==s.registerId||shift.cashDrawerId!==s.cashDrawerId)throw new AppError(403,'Ca hoàn tiền phải đúng quầy/két gốc.');if(method==='transfer'&&!reference)throw new AppError(400,'Nhập mã giao dịch đã hoàn tiền thực tế.');}
   const at=new Date().toISOString(),returnId=crypto.randomUUID(),returnNo='TH-'+returnId.slice(0,8).toUpperCase(),hasStock=lines.some(l=>l.restock>0);
   await tx.insert(posReturns).values({id:returnId,returnNo,orderId:o.id,registerId:s.registerId,warehouseId:snap.register.warehouseId,createdShiftId:shift.id,receivedShiftId:shift.id,
    requestContext:hasStock?'after_issue':'before_fulfillment',kind:'return',status:'completed',reason,requestedServiceFee:fees.service.amount,approvedServiceFee:fees.service.amount,requestedShippingFee:fees.shippingFee,approvedShippingFee:fees.shippingFee,
    subtotal:o.subtotal,tax:o.tax,total:o.total,sourceSnapshot:JSON.stringify({order:o,lines,fees,ghn,quickCancellation:true}),requestKey:key,createdBy:actor(c).id,createdAt:at,approvedBy:actor(c).id,approvedAt:at,receivedBy:actor(c).id,receivedAt:at,creditEffectiveAt:at,updatedAt:at});
   await tx.insert(posReturnLines).values(lines.map(l=>({id:crypto.randomUUID(),returnId,orderLineId:l.id,sku:l.sku,name:l.name,unit:l.unit,requestedQty:l.qty,receivedQty:l.restock,restockQty:l.restock,disposition:'restock',subtotal:l.amount,tax:l.refundTax,total:l.amount+l.refundTax})));
   const refs=await tx.selectDistinct({type:stockMoves.refType,id:stockMoves.refId}).from(stockMoves).where(issueRefs(o.id));
   for(const ref of refs)await reverseRef(tx,actor(c).id,ref.type as StockRefType,ref.id,`Huỷ nhanh GHN ${o.orderNo}: ${reason}`,at);
   const net=await tx.select({qty:sql<number>`sum(${stockMoves.qty})`.mapWith(Number)}).from(stockMoves).where(issueRefs(o.id)).groupBy(stockMoves.sku,stockMoves.warehouseId);
   if(net.some(n=>Math.abs(n.qty)>1e-9))throw new AppError(409,'Chưa hoàn đủ bút toán kho. Chưa huỷ đơn hoặc ghi hoàn tiền.');
   await recordMovements(tx,lines.filter(l=>l.restock>0).map(l=>({refKey:`return:${returnId}:${l.id}`,sku:l.sku,name:l.name,qty:l.restock,unit:l.unit,unitPrice:l.amount/l.qty,kind:'customer_return',partner:'GHN hoàn hàng',refCode:returnNo,link:'#/orders/'+o.id,status:'Đã nhập lại kho',occurredAt:at})));
   let refundId:string|null=null;
   if(account.paid>0){refundId=crypto.randomUUID();const refundNo='HT-'+refundId.slice(0,8).toUpperCase();let cashEntryId:string|null=null;
    if(method==='cash'){cashEntryId=crypto.randomUUID();const [drawer]=await tx.select().from(cashDrawers).where(eq(cashDrawers.id,shift.cashDrawerId));await tx.insert(cashEntries).values({id:cashEntryId,entryNo:refundNo,drawerId:shift.cashDrawerId,shiftId:shift.id,kind:'customer_refund',direction:'out',amount:account.paid,reason:`Huỷ nhanh GHN ${o.orderNo}: ${reason}`,status:'posted',approvalThresholdSnapshot:drawer!.approvalThreshold,createdBy:actor(c).id,createdAt:at,approvedBy:actor(c).id,approvedAt:at,requestKey:key,updatedAt:at});}
    await tx.insert(posRefunds).values({id:refundId,refundNo,returnId,shiftId:shift.id,drawerId:shift.cashDrawerId,method,amount:account.paid,cashEntryId,reference,confirmationNote:reason,confirmedBy:actor(c).id,confirmedAt:at,requestKey:key,createdAt:at});}
   for(const state of ghn)await tx.update(deliveries).set({status:'cancelled',trackingStatus:state.status,trackingUpdatedAt:state.checkedAt,updatedAt:at}).where(eq(deliveries.id,state.id));
   await tx.update(packingSlips).set({status:'cancelled'}).where(eq(packingSlips.orderId,o.id));
   await tx.update(posOrderReservations).set({status:'released'}).where(and(eq(posOrderReservations.orderId,o.id),eq(posOrderReservations.status,'active')));
   await tx.update(posPaymentIntents).set({status:'cancelled',cancelledAt:at,cancelledBy:actor(c).id}).where(and(eq(posPaymentIntents.orderId,o.id),eq(posPaymentIntents.status,'pending')));
   const quickCancellation={mode:'ghn',key,hash,by:actor(c).id,at,returnId,refundId,reason,reference,shiftId,revision:o.revision,ghn,externalSync:'already-terminal'};
   await tx.update(salesOrders).set({status:'cancelled',holdsStock:false,revision:o.revision+1,updatedAt:at,posSnapshot:JSON.stringify({...snap,quickCancellation})}).where(eq(salesOrders.id,o.id));
   await cashAudit(tx,actor(c).id,'quick-cancel-pos-ghn','sales-orders',o.id,{...quickCancellation,refund:account.paid,lines:lines.map(l=>({sku:l.sku,restock:l.restock}))});
   return {orderId:o.id,returnId,refundId,replayed:false};
  });await cashTasksChanged(c.env);return json(result);
 },'business');
}
