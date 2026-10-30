import { and, eq, sql } from 'drizzle-orm';
import { AppError } from '../../../core/errors.ts';
import type { StaffEnv } from '../../staff/api/auth-routes.ts';
import { cashAudit, cashLock } from './cash-store.ts';
import { editPosOrder } from './pos-order-edit.ts';
import { posGhnAccount, type PosGhnAccount } from './pos-ghn-account.ts';
import type { PosDb, PosMember } from './pos-store.ts';
import { salesOrders, salesOrderLines, deliveries } from '../schema.ts';
import { sha256Hex } from '../../staff/domain/session.ts';
import { extraGhnReservations, GHN_EDITABLE, ghnTarget, pendingGhnEdit, posSnapshot, sameGhnItems, sameGhnTarget, type GhnAmendment, type GhnEditTarget } from '../domain/pos-ghn-edit.ts';
const ROOT = 'https://online-gateway.ghn.vn/shiip/public-api/v2/shipping-order/';
const EDIT_KEYS = ['revision','reason','customerId','customerName','contact','phone','email','taxCode','address','note','paymentNote'] as const;
const LINE_KEYS = ['id','sku','qty','price','discountType','discountValue'];
function cleanRequest(body: Record<string, unknown>) {
  const result: Record<string, unknown> = Object.fromEntries(EDIT_KEYS.filter(k => body[k] !== undefined).map(k => [k, body[k]]));
  if (Array.isArray(body.lines)) result.lines = body.lines.map(row => Object.fromEntries(LINE_KEYS.filter(k => row?.[k] !== undefined).map(k => [k, row[k]])));
  if (body.delivery && typeof body.delivery === 'object') result.delivery = Object.fromEntries(['address','receiverName','receiverPhone'].filter(k => (body.delivery as any)[k] !== undefined).map(k => [k, (body.delivery as any)[k]]));
  return result;
}
async function locked(db: PosDb, orderId: string) {
  await cashLock(db); await db.execute(sql`select pg_advisory_xact_lock(hashtext('stock_holds'))`);
  const [order] = await db.select().from(salesOrders).where(eq(salesOrders.id, orderId)).for('update');
  if (!order) throw new AppError(404, 'Không tìm thấy đơn POS.');
  return order;
}
async function call(env: StaffEnv, account: PosGhnAccount, endpoint: string, body: unknown) {
  try {
    const response = await (env.ghnFetch || fetch)(ROOT + endpoint, { method: 'POST', headers: { Token: account.token, ShopId: account.shopId, 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(8000) });
    const data = await response.json() as any;
    if (!response.ok || data.code !== 200) throw Error('carrier rejected');
    return data.data;
  } catch { throw new AppError(502, 'Chưa xác nhận được kết quả GHN. Lần sửa được giữ lại; bấm Tiếp tục cập nhật GHN để kiểm tra và thử lại.', 'GHN_EDIT_UNCONFIRMED'); }
}
async function read(env: StaffEnv, account: PosGhnAccount, code: string, orderNo: string) {
  const data = await call(env, account, 'detail', { order_code: code });
  if (!data || data.order_code !== code || typeof data.status !== 'string' || !data.status.trim() || !Number.isSafeInteger(data.cod_amount) || data.cod_amount < 0 || !Array.isArray(data.items)
    || (data.shop_id !== undefined && String(data.shop_id) !== account.shopId)) throw new AppError(502, 'GHN trả thông tin vận đơn không đủ để đối chiếu. Chưa lưu thay đổi hàng trên CRM.', 'GHN_EDIT_READ_FAILED');
  if (data.client_order_code && data.client_order_code !== orderNo) throw new AppError(502, 'Số đơn trên GHN không khớp đơn CRM. Chưa gửi thay đổi vận đơn.', 'GHN_EDIT_ORDER_MISMATCH');
  if (data.items.some((i: any) => i.quantity == null || i.price == null)) throw new AppError(502, 'GHN thiếu số lượng hoặc giá hàng để đối chiếu.', 'GHN_EDIT_READ_FAILED');
  const items = data.items.map((i: any) => ({ name: String(i.name || ''), code: String(i.code || ''), quantity: Number(i.quantity), price: Number(i.price) }));
  if (items.some((i: any) => !Number.isFinite(i.quantity) || i.quantity <= 0 || !Number.isFinite(i.price) || i.price < 0)) throw new AppError(502, 'Không đối chiếu được hàng trên vận đơn GHN.', 'GHN_EDIT_READ_FAILED');
  return { status: data.status.toLowerCase(), target: { cod: data.cod_amount, items, content: String(data.content || '') } as GhnEditTarget };
}
async function storeEdit(env: StaffEnv, orderId: string, edit: GhnAmendment, patch: Partial<GhnAmendment>) {
  await env.db.transaction(async tx => {
    const [order] = await tx.select().from(salesOrders).where(eq(salesOrders.id, orderId)).for('update');
    const current = order && pendingGhnEdit(order.posSnapshot);
    if (!order || current?.id !== edit.id || current.lease !== edit.lease) throw new AppError(409, 'Lần sửa GHN đang được xử lý ở nơi khác.', 'GHN_EDIT_CHANGED');
    const snapshot = posSnapshot(order.posSnapshot); snapshot.ghnAmendment = { ...current, ...patch };
    await tx.update(salesOrders).set({ posSnapshot: JSON.stringify(snapshot) }).where(eq(salesOrders.id, orderId));
  });
  Object.assign(edit, patch);
}

async function cancelPrepared(env: StaffEnv, orderId: string, edit: GhnAmendment, actor: PosMember) {
  return env.db.transaction(async tx => {
    const order = await locked(tx, orderId), snapshot = posSnapshot(order.posSnapshot), current = pendingGhnEdit(snapshot);
    if (current?.id !== edit.id || current.lease !== edit.lease || order.revision !== edit.revision) throw new AppError(409, 'Lần sửa đã thay đổi.');
    delete snapshot.ghnAmendment;
    const result = { id: orderId, revision: order.revision + 1, cancelledGhnEdit: true };
    snapshot.lastGhnAmendment = { key: edit.key, hash: edit.hash, result };
    await tx.update(salesOrders).set({ posSnapshot: JSON.stringify(snapshot), revision: result.revision, updatedAt: new Date().toISOString() }).where(eq(salesOrders.id, orderId));
    await cashAudit(tx, actor.id, 'cancel-pos-ghn-amendment', 'orders', orderId, { key: edit.key });
    return result;
  });
}

/** Durable intent + union reservation; carrier HTTP never holds the cash/stock transaction open. */
export async function editPosOrderWithGhn(env: StaffEnv, orderId: string, actor: PosMember, body: Record<string, unknown>, afterSave: (db: PosDb, id: string) => Promise<void>) {
  if (actor.role !== 'manager') throw new AppError(403, 'Chỉ Manager được sửa đơn POS.');
  const request = cleanRequest(body), hash = sha256Hex(JSON.stringify(request));
  const start = await env.db.transaction(async tx => {
    const order = await locked(tx, orderId), snapshot = posSnapshot(order.posSnapshot);
    const previous = snapshot.lastGhnAmendment;
    if (typeof body.requestKey === 'string' && previous?.key === body.requestKey) {
      if (!body.resumeGhnEdit && !body.cancelGhnEdit && previous.hash !== hash) throw new AppError(409, 'Mã lần sửa đã dùng cho nội dung khác. Mở lại đơn.', 'GHN_EDIT_CHANGED');
      if (previous.result.cancelledGhnEdit && !body.cancelGhnEdit) throw new AppError(409, 'Lần sửa này đã bỏ. Mở lại form để tạo lần sửa mới.', 'GHN_EDIT_ABORTED');
      if (body.cancelGhnEdit && !previous.result.cancelledGhnEdit) throw new AppError(409, 'Lần sửa đã hoàn tất, không còn bản chờ để bỏ.');
      return { result: previous.result };
    }
    const pending = pendingGhnEdit(snapshot), lease = crypto.randomUUID();
    if (pending) {
      if (body.requestKey !== pending.key || (!body.resumeGhnEdit && !body.cancelGhnEdit && pending.hash !== hash)) throw new AppError(409, 'Có lần sửa GHN chưa hoàn tất. Mở lại Sửa đơn POS để tiếp tục lần đó.', 'GHN_EDIT_PENDING');
      if (pending.leaseUntil > Date.now()) throw new AppError(409, 'Đang cập nhật GHN. Chờ kết quả trước khi thử lại.', 'GHN_EDIT_BUSY');
      pending.lease = lease; pending.leaseUntil = Date.now() + 60000; snapshot.ghnAmendment = pending;
      await tx.update(salesOrders).set({ posSnapshot: JSON.stringify(snapshot) }).where(eq(salesOrders.id, orderId));
      return { edit: pending, registerName: snapshot.register?.name };
    }
    if (body.resumeGhnEdit || body.cancelGhnEdit) throw new AppError(409, 'Không còn lần sửa GHN đang chờ. Tải lại đơn.', 'GHN_EDIT_CHANGED');
    const preview = await editPosOrder(tx, order, actor, request, { allowGhn: true, preview: true });
    if (!preview.preview?.changed) {
      const result = await editPosOrder(tx, order, actor, request); await afterSave(tx, orderId); return { result };
    }
    if (typeof body.requestKey !== 'string' || !/^[a-zA-Z0-9_-]{8,100}$/.test(body.requestKey)) throw new AppError(409, 'Mở lại form sửa POS để cập nhật cả vận đơn GHN.', 'GHN_EDIT_KEY_REQUIRED');
    const ships = await tx.select().from(deliveries).where(and(eq(deliveries.orderId, orderId), eq(deliveries.status, 'planned')));
    if (ships.length !== 1 || !ships[0]!.trackingCode || ships[0]!.carrier.trim().toLowerCase() !== 'ghn' || !order.holdsStock) throw new AppError(409, 'Chỉ sửa vận đơn GHN đang chờ lấy hàng và đơn còn giữ hàng.', 'GHN_EDIT_NOT_READY');
    const target = ghnTarget(preview.preview.lines, preview.total);
    if (target.cod !== ships[0]!.codAmount && target.cod > 5000000) throw new AppError(400, 'API đổi COD của GHN giới hạn 5.000.000 đ. Đơn này cần xử lý mức thu hộ trên GHN trước.', 'GHN_EDIT_COD_LIMIT');
    const old = await tx.select({ sku: salesOrderLines.sku, qty: salesOrderLines.qty }).from(salesOrderLines).where(eq(salesOrderLines.orderId, orderId));
    // Freeze numeric inputs and default prices resolved by the server, never tokens/OTP/extra request fields.
    request.lines = preview.preview.lines.map(l => ({ ...(l.id ? { id: l.id } : { sku: l.sku }), qty: l.qty, price: l.price, discountType: l.discountType, discountValue: l.discountValue }));
    const edit: GhnAmendment = { version: 1, id: crypto.randomUUID(), key: body.requestKey, hash, revision: order.revision + 1, orderNo: order.orderNo, deliveryId: ships[0]!.id,
      trackingCode: ships[0]!.trackingCode.trim().toUpperCase(), actorId: actor.id, request, lines: preview.preview.lines, target, reserve: extraGhnReservations(old, preview.preview.lines), lease, leaseUntil: Date.now() + 60000 };
    snapshot.ghnAmendment = edit;
    await tx.update(salesOrders).set({ posSnapshot: JSON.stringify(snapshot), revision: edit.revision, updatedAt: new Date().toISOString() }).where(eq(salesOrders.id, orderId));
    await cashAudit(tx, actor.id, 'prepare-pos-ghn-amendment', 'orders', orderId, { key: edit.key, reason: request.reason, target, reserve: edit.reserve });
    return { edit, registerName: snapshot.register?.name };
  });
  if ('result' in start) return start.result;
  const edit = start.edit!;
  try {
    if (body.cancelGhnEdit && edit.carrierWriteStarted) throw new AppError(409, 'Đã gửi yêu cầu đổi GHN. Không bỏ lần sửa chỉ vì chưa thấy phản hồi; bấm tiếp tục để đối chiếu và hoàn tất.', 'GHN_EDIT_UNCONFIRMED');
    if (body.cancelGhnEdit && !edit.before) return await cancelPrepared(env, orderId, edit, actor);
    const account = await posGhnAccount(env, start.registerName);
    if (!account) throw new AppError(409, 'Quầy này chưa hỗ trợ cập nhật GHN tự động.');
    let live = await read(env, account, edit.trackingCode, edit.orderNo);
    if (body.cancelGhnEdit) {
      if (!edit.before || !sameGhnTarget(live.target, edit.before)) throw new AppError(409, 'GHN có thể đã nhận thay đổi. Tiếp tục cập nhật để đối chiếu, không bỏ riêng lần sửa CRM.', 'GHN_EDIT_UNCONFIRMED');
      return await cancelPrepared(env, orderId, edit, actor);
    }
    if (!edit.before) await storeEdit(env, orderId, edit, { before: live.target });
    if (!sameGhnTarget(live.target, edit.target) && !GHN_EDITABLE.has(live.status) && (!sameGhnItems(live.target, edit.target) || sameGhnItems(edit.before!, edit.target)))
      throw new AppError(409, 'GHN đã lấy hàng hoặc kết thúc vận đơn. Không thay mã; cần xử lý theo luồng thu hồi/đổi trả.', 'GHN_EDIT_NOT_READY');
    if (!sameGhnItems(live.target, edit.target)) {
      if (!edit.carrierWriteStarted) await storeEdit(env, orderId, edit, { carrierWriteStarted: true });
      try { await call(env, account, 'update', { order_code: edit.trackingCode, items: edit.target.items, content: edit.target.content }); } catch { /* Read back even when the response was lost. */ }
      live = await read(env, account, edit.trackingCode, edit.orderNo);
      if (!sameGhnItems(live.target, edit.target)) throw new AppError(502, 'GHN chưa xác nhận danh sách hàng mới. Giữ lần sửa để thử lại; CRM chưa đổi hàng.', 'GHN_EDIT_UNCONFIRMED');
    }
    if (live.target.cod !== edit.target.cod) {
      if (edit.target.cod > 5000000) throw new AppError(400, 'GHN giới hạn đổi COD 5.000.000 đ.', 'GHN_EDIT_COD_LIMIT');
      if (!edit.carrierWriteStarted) await storeEdit(env, orderId, edit, { carrierWriteStarted: true });
      try { await call(env, account, 'updateCOD', { order_code: edit.trackingCode, cod_amount: edit.target.cod }); } catch { /* Readback is authoritative. */ }
      live = await read(env, account, edit.trackingCode, edit.orderNo);
    }
    if (!sameGhnTarget(live.target, edit.target)) throw new AppError(502, 'Hàng hoặc COD trên GHN chưa khớp. Bấm tiếp tục cập nhật; chưa hoàn tất sửa CRM.', 'GHN_EDIT_UNCONFIRMED');
    return await env.db.transaction(async tx => {
      const order = await locked(tx, orderId), snapshot = posSnapshot(order.posSnapshot), current = pendingGhnEdit(snapshot);
      if (current?.id !== edit.id || current.lease !== edit.lease || order.revision !== edit.revision) throw new AppError(409, 'Đơn thay đổi trong lúc chờ GHN. Cần đối chiếu trước khi hoàn tất.', 'GHN_EDIT_CHANGED');
      const input = { ...edit.request, revision: order.revision };
      const preview = await editPosOrder(tx, order, actor, input, { allowGhn: true, allowPending: true, preview: true });
      if (!preview.preview || !sameGhnTarget(ghnTarget(preview.preview.lines, preview.total), edit.target)) throw new AppError(409, 'Dữ liệu hàng thay đổi từ lúc gửi GHN. Chưa hoàn tất sửa CRM.', 'GHN_EDIT_CHANGED');
      const result = await editPosOrder(tx, order, actor, input, { allowGhn: true, allowPending: true });
      const [saved] = await tx.select().from(salesOrders).where(eq(salesOrders.id, orderId));
      const finalSnapshot = posSnapshot(saved!.posSnapshot); delete finalSnapshot.ghnAmendment;
      finalSnapshot.lastGhnAmendment = { key: edit.key, hash: edit.hash, result };
      await tx.update(salesOrders).set({ posSnapshot: JSON.stringify(finalSnapshot) }).where(eq(salesOrders.id, orderId));
      await afterSave(tx, orderId);
      await cashAudit(tx, actor.id, 'complete-pos-ghn-amendment', 'orders', orderId, { key: edit.key, deliveryId: edit.deliveryId, cod: edit.target.cod });
      return result;
    });
  } catch (error) {
    await storeEdit(env, orderId, edit, { leaseUntil: 0, error: error instanceof AppError ? error.message : 'Chưa hoàn tất cập nhật GHN. Bấm tiếp tục để kiểm tra lại.' }).catch(() => {});
    throw error;
  }
}
