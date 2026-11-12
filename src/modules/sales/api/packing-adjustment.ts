import {and,eq,inArray,ne,sql} from 'drizzle-orm';
import type {RouteContext} from '../../../core/http/router.ts';
import {AppError} from '../../../core/errors.ts';
import {auditLogs} from '../../../core/db/schema.ts';
import {sha256Hex} from '../../staff/domain/session.ts';
import type {StaffEnv,SessionState} from '../../staff/api/auth-routes.ts';
import {stockMoves} from '../../inventory/schema.ts';
import {postMoves,saleMovesPosted,lockLedger,assertWarehousesOpened} from '../../inventory/api/ledger.ts';
import {deliveries,deliveryLines,packingSlipLines,packingSlips,salesOrderLines,salesOrders} from '../schema.ts';
import {posReturns} from '../return-schema.ts';
import {packingSuggestion} from '../domain/packing.ts';
import {assertPosFlowFulfillable} from './pos-order-flow-guards.ts';
import {assertFreeStock} from './stock-free.ts';
import {consumeOrderHolds} from './order-hold-store.ts';
import {assertCrmDispatch,assertCrmOrderCompletion} from './crm-stock-lifecycle.ts';

const round=(v:number)=>Math.round(v*1000)/1000;
const fail=(message:string):never=>{throw new AppError(409,message);};
/** Existing packed lines only. The order/hold locks serialize edits with packing, dispatch and cancellation. */
export async function adjustPackedQuantities(c:RouteContext<StaffEnv>,slipId:string,orderId:string,body:Record<string,unknown>){
 const actor=(c.state.session as SessionState).member;
 if(actor.role!=='manager')throw new AppError(403,'Chỉ Manager được điều chỉnh phiếu đã đóng.');
 const reason=typeof body.reason==='string'?body.reason.trim():'';
 if(reason.length<5||reason.length>1000)throw new AppError(400,'Nhập lý do điều chỉnh từ 5 đến 1000 ký tự.');
 if(!Number.isSafeInteger(body.revision)||Number(body.revision)<1)throw new AppError(400,'Thiếu phiên bản phiếu.');
 if(typeof body.clientKey!=='string'||!/^[a-zA-Z0-9-]{16,80}$/.test(body.clientKey))throw new AppError(400,'Thiếu mã thao tác điều chỉnh.');
 if(!Array.isArray(body.lines)||!body.lines.length||body.lines.length>500)throw new AppError(400,'Danh sách số lượng không hợp lệ.');
 const wanted=new Map<string,number>();
 for(const raw of body.lines){
  const r=raw as Record<string,unknown>|null,qty=r?.qty;
  if(typeof r?.id!=='string'||wanted.has(r.id)||typeof qty!=='number'||!Number.isFinite(qty)||qty<=0||qty>1e9||Math.abs(qty-round(qty))>1e-8)throw new AppError(400,'Mỗi dòng cần số lượng dương, tối đa 3 số lẻ và không được trùng.');
  wanted.set(r.id,qty);
 }
 const hash=sha256Hex(JSON.stringify({revision:body.revision,reason,lines:[...wanted].sort(([a],[b])=>a.localeCompare(b))}));
 return c.env.db.transaction(async tx=>{
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext('stock_holds'))`);
  const [order]=await tx.select().from(salesOrders).where(eq(salesOrders.id,orderId)).for('update');
  const [slip]=await tx.select().from(packingSlips).where(and(eq(packingSlips.id,slipId),eq(packingSlips.orderId,orderId))).for('update');
  if(!order||!slip)throw new AppError(404,'Không tìm thấy phiếu.');
  const [prior]=await tx.select({data:auditLogs.data}).from(auditLogs).where(and(eq(auditLogs.entityType,'packing_slips'),eq(auditLogs.entityId,slipId),eq(auditLogs.action,'adjust_packed_quantities'),eq(auditLogs.actorId,actor.id),sql`${auditLogs.data}::jsonb->>'clientKey'=${body.clientKey}`)).limit(1);
  if(prior){if(JSON.parse(prior.data).payloadHash!==hash)fail('Mã thao tác đã dùng với nội dung khác.');return {ok:true,replayed:true,revision:slip.revision};}
  if(order.channel!=='crm')fail('Phiếu POS cần đối soát luồng giao hàng của quầy; chưa điều chỉnh bằng luồng này.');
  if(['draft','cancelled'].includes(order.status)||slip.status!=='packed')fail('Chỉ điều chỉnh phiếu đã đóng của đơn/HĐKT còn hiệu lực.');
  await assertPosFlowFulfillable(tx,orderId);
  if(slip.revision!==body.revision)fail('Phiếu vừa thay đổi. Tải lại phiếu trước khi điều chỉnh.');
  if((await tx.select({id:posReturns.id}).from(posReturns).where(eq(posReturns.orderId,orderId)).limit(1)).length)fail('Đơn có hồ sơ trả/đổi hàng; cần đối soát trước khi sửa số lượng đóng gói.');
  const lines=await tx.select().from(packingSlipLines).where(eq(packingSlipLines.slipId,slipId));
  if(lines.length!==wanted.size||lines.some(l=>!wanted.has(l.id)))throw new AppError(400,'Chỉ sửa số lượng các dòng hiện có, không thêm/xoá hoặc đổi sản phẩm.');
  if(lines.every(l=>l.qty===wanted.get(l.id)))throw new AppError(400,'Chưa thay đổi số lượng.');
  const orderLines=await tx.select().from(salesOrderLines).where(eq(salesOrderLines.orderId,orderId));
  const allocated=await tx.select({lineId:packingSlipLines.orderLineId,qty:packingSlipLines.qty,status:packingSlips.status}).from(packingSlipLines).innerJoin(packingSlips,eq(packingSlips.id,packingSlipLines.slipId)).where(and(eq(packingSlips.orderId,orderId),ne(packingSlips.status,'cancelled')));
  const shipped=await tx.select({lineId:deliveryLines.orderLineId,qty:deliveryLines.qty}).from(deliveryLines).innerJoin(deliveries,eq(deliveries.id,deliveryLines.deliveryId)).where(and(eq(deliveries.orderId,orderId),inArray(deliveries.status,['in_transit','delivered','failed'])));
  const deltaByLine=new Map<string,number>(),beforeSku=new Map<string,number>(),deltaSku=new Map<string,number>();
  for(const l of lines){if(orderLines.find(ol=>ol.id===l.orderLineId)?.sku!==l.sku)fail('Sản phẩm trong đơn vừa thay đổi; cần đối soát phiếu cũ trước.');const delta=round(wanted.get(l.id)!-l.qty);deltaByLine.set(l.orderLineId,(deltaByLine.get(l.orderLineId)??0)+delta);if(l.sku.trim()){beforeSku.set(l.sku,(beforeSku.get(l.sku)??0)+l.qty);deltaSku.set(l.sku,(deltaSku.get(l.sku)??0)-delta);}}
  for(const [id,delta]of deltaByLine){
   const line=orderLines.find(l=>l.id===id);if(!line)throw new AppError(409,'Dòng hàng không còn thuộc đơn.');
   const total=allocated.filter(l=>l.lineId===id).reduce((n,l)=>n+l.qty,0)+delta;
   if(total>line.qty+.0005)fail(`Số lượng đóng gói vượt số đặt của ${line.name}.`);
   const packed=allocated.filter(l=>l.lineId===id&&l.status==='packed').reduce((n,l)=>n+l.qty,0)+delta;
   const dispatched=shipped.filter(l=>l.lineId===id).reduce((n,l)=>n+l.qty,0);
   if(packed+.0005<Math.max(line.deliveredQty,dispatched))fail(`Không giảm ${line.name} xuống dưới số đã bàn giao/giao khách. Đối soát chuyến giao trước.`);
  }
  const now=new Date().toISOString();
  if(beforeSku.size){
   if(!slip.stockWarehouseId||!slip.packedBy||!slip.packedAt||(order.warehouseId&&order.warehouseId!==slip.stockWarehouseId))fail('Phiếu chưa có bằng chứng xuất đúng kho; cần đối soát kho trước.');
   if(await saleMovesPosted(tx,orderId))fail('Đơn cũ đã trừ kho khi duyệt; cần đối soát sổ kho trước khi điều chỉnh.');
   const recorded=await tx.select({sku:stockMoves.sku,wh:stockMoves.warehouseId,qty:stockMoves.qty}).from(stockMoves).where(and(eq(stockMoves.refType,'packing_slip'),sql`split_part(${stockMoves.refId},'#',1)=${slipId}`));
   if(recorded.some(r=>r.wh!==slip.stockWarehouseId||!beforeSku.has(r.sku))||[...beforeSku].some(([sku,qty])=>Math.abs(qty+recorded.filter(r=>r.sku===sku).reduce((n,r)=>n+r.qty,0))>.0005))fail('Số lượng phiếu và sổ kho chưa khớp; cần đối soát trước khi điều chỉnh.');
   await lockLedger(tx);await assertWarehousesOpened(tx,[slip.stockWarehouseId!]);
   await assertFreeStock(tx,slip.stockWarehouseId!,[...deltaSku].map(([sku,qty])=>({sku,qty:-qty})),{exceptOrderId:orderId,actor,context:{module:'sales',entityType:'packing_slips',entityId:slipId,refNo:slip.slipNo}});
   await postMoves(tx,actor.id,[...deltaSku].map(([sku,qty])=>({sku,qty:round(qty),warehouseId:slip.stockWarehouseId!,kind:'adjust' as const,refType:'packing_slip' as const,refId:slipId+'#adjust-'+(slip.revision+1),refNo:slip.slipNo,note:('Điều chỉnh SL phiếu đã đóng: '+reason).slice(0,500)})),now);
  }
  let totalQty=0,totalWeight:number|null=0;
  for(const l of lines){const qty=wanted.get(l.id)!,weight=packingSuggestion(qty,l.unit,l).weight;totalQty+=qty;totalWeight=totalWeight===null||weight===null?null:totalWeight+weight;await tx.update(packingSlipLines).set({qty,weight}).where(eq(packingSlipLines.id,l.id));}
  await tx.update(packingSlips).set({totalQty:round(totalQty),totalWeight:totalWeight===null?null:Math.round(totalWeight*10)/10,revision:slip.revision+1,updatedAt:now}).where(eq(packingSlips.id,slipId));
  await consumeOrderHolds(tx,orderId,[...deltaByLine].filter(([,qty])=>qty>0).map(([orderLineId,qty])=>({orderLineId,qty})),now);
  const dispatched=await tx.select({id:deliveries.id}).from(deliveries).where(and(eq(deliveries.orderId,orderId),inArray(deliveries.status,['in_transit','delivered','failed']))).limit(1);
  if(dispatched[0])await assertCrmDispatch(tx,orderId,dispatched[0].id);
  if(order.status==='delivered')await assertCrmOrderCompletion(tx,orderId);
  await tx.insert(auditLogs).values({id:crypto.randomUUID(),actorId:actor.id,module:'sales',action:'adjust_packed_quantities',entityType:'packing_slips',entityId:slipId,createdAt:now,data:JSON.stringify({clientKey:body.clientKey,payloadHash:hash,reason,revisionBefore:slip.revision,revisionAfter:slip.revision+1,warehouseId:slip.stockWarehouseId,before:lines.map(l=>({id:l.id,sku:l.sku,qty:l.qty})),after:lines.map(l=>({id:l.id,sku:l.sku,qty:wanted.get(l.id)})),stockDelta:[...deltaSku].map(([sku,qty])=>({sku,qty:round(qty)}))})});
  return {ok:true,replayed:false,revision:slip.revision+1};
 });
}
