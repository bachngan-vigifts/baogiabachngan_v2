import { eq, inArray, sql } from 'drizzle-orm';
import type { AnyDb } from '../../../core/db/client.ts';
import type { Router } from '../../../core/http/router.ts';
import { json, readJson } from '../../../core/http/router.ts';
import { AppError } from '../../../core/errors.ts';
import type { StaffEnv, SessionState } from '../../staff/api/auth-routes.ts';
import { employees } from '../../staff/schema.ts';
import { products } from '../../catalog/schema.ts';
import { sha256Hex } from '../../staff/domain/session.ts';
import { receiptJobs, supplierReceipts, supplierOrderEvents, incomingShipments, incomingShipmentLines, supplierReceiptLines, suppliers } from '../schema.ts';

type Receipt = typeof supplierReceipts.$inferSelect;
/** Unit compatibility only: never rebuild SKU, quantity, prices or identity from live order data. */
async function normalizeReceiptUnits(db: AnyDb, payload: Record<string, unknown>) {
  if (!Array.isArray(payload.items) || payload.items.some(i => !i || typeof i.sku !== 'string'))
    throw new AppError(409,'Danh sách hàng trong payload không hợp lệ. Cần đối soát trước khi gửi.','RECEIPT_NEEDS_REVIEW');
  const items = payload.items as {sku: string;unit?: string | null}[];
  const text = (unit: unknown) => typeof unit === 'string' ? unit.trim() : '';
  const missing = [...new Set(items.filter(i => !text(i.unit)).map(i => i.sku))];
  const catalog = missing.length ? await db.select({sku:products.sku,unit:products.unit}).from(products).where(inArray(products.sku,missing)) : [];
  const units = new Map(catalog.map(p => [p.sku,text(p.unit)]));
  return {...payload,items:items.map(i => ({...i,unit:text(i.unit) || units.get(i.sku) || 'Cái'}))};
}
async function prepareReceiptPayload(db: AnyDb, job: typeof receiptJobs.$inferSelect) {
  const payload = JSON.parse(job.payload);
  if (payload.idempotency_key !== job.receiptId || payload.crm_receipt?.id !== job.receiptId || (payload.crm_receipt_id !== undefined && payload.crm_receipt_id !== job.receiptId))
    throw new AppError(409,'Mã phiếu trong payload không khớp job. Cần đối soát, không gửi lại.','RECEIPT_NEEDS_REVIEW');
  const snapshot = JSON.stringify(await normalizeReceiptUnits(db,payload));
  if (snapshot !== job.payload) await db.update(receiptJobs).set({payload:snapshot,payloadHash:sha256Hex(snapshot)}).where(eq(receiptJobs.receiptId,job.receiptId));
  return snapshot;
}
const hasSapoLink = (r: Receipt) => !!(r.sapoVerifiedAt || r.sapoPurchaseOrderId || r.sapoReceiptId || r.sapoReceiptCode || r.sapoReceiptUrl);
type ReceiptTx=Parameters<Parameters<AnyDb['transaction']>[0]>[0];
/** Global supplier write order: purchase → receipt → outbox → ledger. */
export async function lockReceiptForWrite(tx:ReceiptTx,id:string){
  const [hint]=await tx.select({shipmentId:supplierReceipts.shipmentId}).from(supplierReceipts).where(eq(supplierReceipts.id,id));
  if(hint)await tx.select({id:incomingShipments.id}).from(incomingShipments).where(eq(incomingShipments.id,hint.shipmentId)).for('update');
  const [receipt]=await tx.select().from(supplierReceipts).where(eq(supplierReceipts.id,id)).for('update');
  if(receipt&&hint&&receipt.shipmentId!==hint.shipmentId)throw new AppError(409,'Phiếu nhận vừa thay đổi đơn nguồn. Tải lại phiếu.');
  return receipt;
}
export const receiptLink = (r: Receipt) => ({ sapoPurchaseOrderId: r.sapoPurchaseOrderId, sapoReceiptId: r.sapoReceiptId, sapoReceiptCode: r.sapoReceiptCode, sapoReceiptUrl: r.sapoReceiptUrl, sapoVerifiedAt: r.sapoVerifiedAt, sapoStatus: r.sapoStatus, sapoUpdatedAt: r.sapoUpdatedAt });
export function validReceiptLink(po: string, id: string, code: string, link: string) {
  if (!/^[1-9]\d*$/.test(po) || !/^[1-9]\d*$/.test(id) || !code || code.length > 100) return false;
  try { const u = new URL(link); return u.origin === 'https://bachngankiengiang.mysapogo.com' && u.pathname === `/admin/purchase_orders/${po}` && !u.search && !u.hash && !u.username && !u.password; } catch { return false; }
}
export async function queueReceiptJob(db: AnyDb, receiptId: string, payload: Record<string, unknown>, error = '') {
  const now = new Date().toISOString(), snapshot = JSON.stringify(await normalizeReceiptUnits(db,payload));
  await db.insert(receiptJobs).values({ receiptId, action: 'create_purchase_receipt', status: error ? 'needs_review' : 'queued', payload: snapshot, payloadHash: sha256Hex(snapshot), lastError: error, createdAt: now, updatedAt: now }).onConflictDoNothing();
}
const webhook = (env: StaffEnv) => {
  const raw = env.sapoGoodsReceiptWebhookUrl;
  try { const u = new URL(raw || ''); if (u.protocol === 'https:' && u.hostname === 'n8nthai.moarchvn.com' && u.pathname.startsWith('/webhook/') && !u.username && !u.password && !u.search && !u.hash) return u; } catch { /* cấu hình chưa đủ */ }
  throw new AppError(503, 'Chưa cấu hình webhook nhập hàng n8n hợp lệ.');
};
/** Lease giao HTTP độc lập lease thực thi của Claw; callback có thể tới trước HTTP 2xx. */
export async function dispatchReceiptJob(env: StaffEnv, receiptId: string) {
  const token = crypto.randomUUID(), now = new Date().toISOString();
  const job = await env.db.transaction(async tx => {
    const r = await lockReceiptForWrite(tx,receiptId);
    const [j] = await tx.select().from(receiptJobs).where(eq(receiptJobs.receiptId, receiptId)).for('update');
    if (!r || !j || r.cancelledAt || !['queued','failed'].includes(j.status) || (j.dispatchUntil && j.dispatchUntil > now) || (j.leaseUntil && j.leaseUntil > now)) return null;
    if ((r.sapoStatus === 'done' || hasSapoLink(r)) && j.action !== 'reconcile_existing') return null;
    const payload = await prepareReceiptPayload(tx,j);
    await tx.update(receiptJobs).set({ dispatchToken: token, dispatchUntil: new Date(Date.now()+60_000).toISOString(), attempts: j.attempts+1, updatedAt: now }).where(eq(receiptJobs.receiptId, receiptId));
    return {...j,payload};
  });
  if (!job) return { sent: false, skipped: true };
  let error = '';
  try {
    const response = await (env.sapoWebhookFetch ?? fetch)(webhook(env), { method:'POST', headers:{'content-type':'application/json',accept:'application/json'}, body:job.payload, signal:AbortSignal.timeout(45_000) });
    const raw = await response.text(); let result: Record<string, unknown> = {};
    try { result = raw ? JSON.parse(raw) : {}; } catch { /* n8n có thể trả text */ }
    if (!response.ok || result.ok === false || result.success === false || result.error) error = `n8n từ chối giao việc (HTTP ${response.status}); cần kiểm tra execution trước khi thử lại.`;
  } catch (e) { error = e instanceof AppError && e.status===503 ? e.message : 'Chưa xác định n8n đã nhận việc hay chưa. Tra cứu Sapo theo mã CRM trước khi thử lại; không tạo phiếu mới vì timeout.'; }
  await env.db.transaction(async tx => {
    await lockReceiptForWrite(tx,receiptId);
    const [j] = await tx.select().from(receiptJobs).where(eq(receiptJobs.receiptId, receiptId)).for('update');
    if (!j || j.dispatchToken !== token) return;
    const mutable = ['queued','failed'].includes(j.status);
    await tx.update(receiptJobs).set({ dispatchToken:null, dispatchUntil:null, ...(mutable ? {status:error?'failed':'callback_pending',lastError:error}:{}), updatedAt:new Date().toISOString() }).where(eq(receiptJobs.receiptId, receiptId));
    if (mutable && job.action === 'create_purchase_receipt') await tx.update(supplierReceipts).set({sapoStatus:error?'failed':'pending',sapoNote:error || 'n8n đã nhận việc; chờ kết quả Sapo đã xác minh.',sapoUpdatedAt:new Date().toISOString()}).where(eq(supplierReceipts.id, receiptId));
  });
  return { sent: !error, skipped: false };
}
export async function receiptResult(db: AnyDb, b: Record<string, unknown>) {
  const text = (k: string) => typeof b[k] === 'string' ? (b[k] as string).trim() : '';
  const id=text('crm_receipt_id'), order=text('crm_order_id'), po=text('sapo_purchase_order_id'), sapo=text('sapo_receipt_id'), code=text('sapo_receipt_code'), url=text('sapo_receipt_url');
  if (b.schema_version !== 1 || b.action !== 'goods_receipt_result' || !id || !order || text('idempotency_key') !== id || typeof b.ok !== 'boolean') throw new AppError(400,'Callback nhập hàng không đúng schema_version/action/idempotency_key.');
  if (b.ok && !validReceiptLink(po,sapo,code,url)) throw new AppError(400,'Kết quả thành công cần đủ ID đơn nhập, ID phiếu, mã và link Sapo hợp lệ.');
  // Không lưu nguyên thông báo bên ngoài: có thể chứa credential. Mã lỗi cố định; execution ở n8n giữ chi tiết.
  const result = await db.transaction(async tx => {
    const r = await lockReceiptForWrite(tx,id);
    if (!r) throw new AppError(404,'Không tìm thấy phiếu nhận CRM.');
    if (r.shipmentId !== order || r.cancelledAt) throw new AppError(409,'Phiếu không thuộc đơn hoặc đã huỷ.');
    const [j] = await tx.select().from(receiptJobs).where(eq(receiptJobs.receiptId,id)).for('update');
    const conflict = async (message: string) => {
      if(j) await tx.update(receiptJobs).set({status:'needs_review',lastError:message,updatedAt:new Date().toISOString()}).where(eq(receiptJobs.receiptId,id));
      return { conflict:message };
    };
    const same = r.sapoVerifiedAt && r.sapoPurchaseOrderId===po && r.sapoReceiptId===sapo && r.sapoReceiptCode===code && r.sapoReceiptUrl===url;
    if (b.ok && same) {
      if(j?.action==='reconcile_existing' && text('reconciliation_id')===j.reconciliationId) await tx.update(receiptJobs).set({status:'done',leaseToken:null,leaseUntil:null,lastError:'',updatedAt:new Date().toISOString()}).where(eq(receiptJobs.receiptId,id));
      return {duplicate:true};
    }
    if (!j) return conflict('Chưa có job CRM; phiếu cũ cần Manager yêu cầu đối soát riêng.');
    if (j.leaseToken && text('lease_token') !== j.leaseToken) throw new AppError(409,'Lease thực thi không khớp; không nhận callback cũ.');
    const reconcile = j.action === 'reconcile_existing' && j.reconciliationId && text('reconciliation_id') === j.reconciliationId;
    if (j.action === 'reconcile_existing' && !reconcile) return conflict('Thiếu mã yêu cầu đối soát hiện tại.');
    if (reconcile && JSON.stringify(receiptLink(r)) !== j.expectedLink) return conflict('Liên kết CRM đã đổi sau yêu cầu đối soát.');
    if ((r.sapoVerifiedAt || r.sapoStatus==='done' || r.sapoPurchaseOrderId || r.sapoReceiptId || r.sapoReceiptCode || r.sapoReceiptUrl) && !reconcile) return conflict('Kết quả khác dữ liệu đã lưu. Cần đối soát, không ghi đè.');
    if (b.ok) {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'sapo-receipt:'+sapo}))`);
      const [other]=await tx.select({id:supplierReceipts.id}).from(supplierReceipts).where(eq(supplierReceipts.sapoReceiptId,sapo)).limit(1);
      if(other && other.id!==id)return conflict('Phiếu Sapo đã liên kết với phiếu nhận CRM khác.');
    }
    const now=new Date().toISOString(), before=receiptLink(r);
    if (!b.ok) {
      await tx.update(receiptJobs).set({status:'failed',lastError:'Claw báo xử lý không thành công; xem execution n8n để biết chi tiết.',leaseUntil:null,leaseToken:null,dispatchToken:null,dispatchUntil:null,updatedAt:now}).where(eq(receiptJobs.receiptId,id));
      if(!reconcile)await tx.update(supplierReceipts).set({sapoStatus:'failed',sapoNote:'Claw báo xử lý không thành công; có thể gửi lại kết quả hoặc đối soát.',sapoUpdatedAt:now,sapoUpdatedBy:null}).where(eq(supplierReceipts.id,id));
      return {duplicate:false};
    }
    const after={sapoPurchaseOrderId:po,sapoReceiptId:sapo,sapoReceiptCode:code,sapoReceiptUrl:url,sapoVerifiedAt:now,sapoStatus:'done' as const,sapoUpdatedAt:now};
    await tx.update(supplierReceipts).set({...after,sapoNote:'Đã xác minh phiếu Sapo qua callback.',sapoUpdatedBy:null}).where(eq(supplierReceipts.id,id));
    await tx.update(receiptJobs).set({status:'done',lastError:'',leaseUntil:null,leaseToken:null,dispatchToken:null,dispatchUntil:null,updatedAt:now}).where(eq(receiptJobs.receiptId,id));
    await tx.insert(supplierOrderEvents).values({id:crypto.randomUUID(),shipmentId:order,at:now,actorId:null,action:reconcile?'sapo_reconcile':'sapo_callback',summary:`${r.receiptNo}: xác minh Sapo ${code}`,data:JSON.stringify({receiptId:id,before,after,reconciliationId:j.reconciliationId})});
    return {duplicate:false};
  });
  if ('conflict' in result) throw new AppError(409,result.conflict!,'RECEIPT_NEEDS_REVIEW');
  return {ok:true,crm_receipt_id:id,status:b.ok?'done':'failed',...result};
}
export function registerReceiptJobRoutes(router: Router<StaffEnv>) {
  router.post('/integrations/sapo/goods-receipt-result', async c => json(await receiptResult(c.env.db, await readJson(c.req,50_000))), 'sapo-sync');
  router.post('/integrations/sapo/goods-receipt-jobs/dispatch',async c=>{
    const b=await readJson(c.req,2000); const id=String(b.crm_receipt_id||'');
    if(id)return json(await dispatchReceiptJob(c.env,id));
    const rows=await c.env.db.select({id:receiptJobs.receiptId}).from(receiptJobs).where(eq(receiptJobs.status,'queued')).limit(20);
    const results=[];for(const r of rows)results.push({receiptId:r.id,...await dispatchReceiptJob(c.env,r.id)});
    return json({results});
  },'sapo-sync');
  router.post('/integrations/sapo/goods-receipt-jobs/claim',async c=>{
    const b=await readJson(c.req,2000),id=String(b.crm_receipt_id||''),now=new Date().toISOString();
    const out=await c.env.db.transaction(async tx=>{
      const r=await lockReceiptForWrite(tx,id);
      const [j]=await tx.select().from(receiptJobs).where(eq(receiptJobs.receiptId,id)).for('update');
      if(!r||!j)throw new AppError(404,'Không có job phiếu nhận.');
      if(r.cancelledAt||['done','needs_review'].includes(j.status)||((r.sapoStatus==='done'||hasSapoLink(r))&&j.action!=='reconcile_existing'))throw new AppError(409,'Job không cho phép thực thi; cần đối soát.');
      if(j.leaseUntil&&j.leaseUntil>now)throw new AppError(409,'Phiếu đang được execution khác xử lý.');
      if(j.status==='processing'){
        await tx.update(receiptJobs).set({status:'needs_review',lastError:'Lease hết hạn, chưa rõ Sapo đã tạo phiếu chưa. Chỉ đối soát, không tự tạo lại.',updatedAt:now}).where(eq(receiptJobs.receiptId,id));
        return null;
      }
      const token=crypto.randomUUID(),until=new Date(Date.now()+15*60_000).toISOString();
      const payload=await prepareReceiptPayload(tx,j);
      await tx.update(receiptJobs).set({status:'processing',leaseToken:token,leaseUntil:until,updatedAt:now}).where(eq(receiptJobs.receiptId,id));
      return {lease_token:token,lease_until:until,payload:JSON.parse(payload)};
    });
    if(!out)throw new AppError(409,'Lease cũ hết hạn; job cần đối soát trước khi xử lý.');
    return json(out);
  },'sapo-sync');
  const manager = (c: {state:Record<string,unknown>}) => {const m=(c.state.session as SessionState).member;if(m.role!=='manager')throw new AppError(403,'Chỉ Manager được xử lý job nhập hàng.');return m;};
  router.post('/supplier-receipts/:id/retry-sapo',async c=>{
    manager(c);const id=c.params.id!;
    await c.env.db.transaction(async tx=>{
      const r=await lockReceiptForWrite(tx,id);
      const [j]=await tx.select().from(receiptJobs).where(eq(receiptJobs.receiptId,id)).for('update');
      if(!r||!j)throw new AppError(404,'Không có job.');
      if(r.cancelledAt||r.sapoStatus==='done'||(hasSapoLink(r)&&j.action!=='reconcile_existing')||!['failed','callback_pending'].includes(j.status)||j.leaseToken)throw new AppError(409,'Không thể gửi lại; cần đối soát hoặc đang xử lý.');
      await tx.update(receiptJobs).set({status:'queued',updatedAt:new Date().toISOString()}).where(eq(receiptJobs.receiptId,id));
    });
    return json(await dispatchReceiptJob(c.env,id));
  },'business');
  router.post('/supplier-receipts/:id/reconcile-sapo',async c=>{
    const m=manager(c),id=c.params.id!,b=await readJson(c.req,8000),reason=typeof b.reason==='string'?b.reason.trim():'';
    if(reason.length<3||reason.length>500||!b.expected)throw new AppError(400,'Cần lý do và bản chụp liên kết hiện tại.');
    const reconciliationId=crypto.randomUUID(),now=new Date().toISOString();
    await c.env.db.transaction(async tx=>{
      const r=await lockReceiptForWrite(tx,id);
      if(!r)throw new AppError(404,'Không có phiếu nhận.');
      if(r.cancelledAt)throw new AppError(409,'Phiếu đã huỷ.');
      const expected=receiptLink(r);
      if(typeof b.expected!=='object' || b.expected===null || Object.entries(expected).some(([k,v])=>(b.expected as Record<string,unknown>)[k]!==v))throw new AppError(409,'Liên kết CRM đã thay đổi; tải lại trước khi đối soát.');
      const [j]=await tx.select().from(receiptJobs).where(eq(receiptJobs.receiptId,id)).for('update');
      if((j?.leaseUntil&&j.leaseUntil>now)||(j?.dispatchUntil&&j.dispatchUntil>now))throw new AppError(409,'Job đang xử lý.');
      const [order]=await tx.select().from(incomingShipments).where(eq(incomingShipments.id,r.shipmentId)).limit(1);
      const [supplier]=order?.supplierId ? await tx.select().from(suppliers).where(eq(suppliers.id,order.supplierId)).limit(1) : [];
      const [employee]=await tx.select().from(employees).where(eq(employees.id,r.receivedBy)).limit(1);
      const lines=await tx.select({received:supplierReceiptLines,source:incomingShipmentLines}).from(supplierReceiptLines)
        .innerJoin(incomingShipmentLines,eq(incomingShipmentLines.id,supplierReceiptLines.lineId)).where(eq(supplierReceiptLines.receiptId,id));
      const reference={crm_order:{id:r.shipmentId,code:order?.ticketNumber??'',note:order?.note??''},
        crm_receipt:{id,code:r.receiptNo,received_date:r.receivedDate,note:r.note},
        supplier:{id:supplier?.id??'',name:supplier?.name??order?.supplierName??'',tax_code:supplier?.taxCode??''},warehouse:{name:r.warehouse},employee:{id:r.receivedBy,name:employee?.name??''},
        items:lines.filter(x=>x.received.goodQty>0).map(({received:l,source:s})=>({crm_line_id:l.lineId,sku:l.sku,name:s.name,unit:s.unit,good_quantity:l.goodQty,unit_price:s.price,purchase_discount_percent:s.confirmedPurchaseDiscount??s.purchaseDiscount,vat_percent:s.taxRate,note:l.note}))};
      const payload=JSON.stringify(await normalizeReceiptUnits(tx,{schema_version:1,action:'reconcile_existing',source:'crm_supplier_receipt',idempotency_key:id,crm_order_id:r.shipmentId,crm_receipt_id:id,crm_receipt_code:r.receiptNo,reconciliation_id:reconciliationId,expected,reason,...reference}));
      const fields={action:'reconcile_existing' as const,status:'queued' as const,payload,payloadHash:sha256Hex(payload),expectedLink:JSON.stringify(expected),reconciliationId,lastError:'',leaseToken:null,leaseUntil:null,dispatchToken:null,dispatchUntil:null,updatedAt:now};
      await tx.insert(receiptJobs).values({receiptId:id,...fields,createdAt:now}).onConflictDoUpdate({target:receiptJobs.receiptId,set:fields});
      await tx.insert(supplierOrderEvents).values({id:crypto.randomUUID(),shipmentId:r.shipmentId,actorId:m.id,at:now,action:'sapo_reconcile_request',summary:`${r.receiptNo}: yêu cầu đối soát liên kết — ${reason}`,data:JSON.stringify({receiptId:id,before:expected,reconciliationId,reason})});
    });
    return json({reconciliationId,...await dispatchReceiptJob(c.env,id)});
  },'business');
}
