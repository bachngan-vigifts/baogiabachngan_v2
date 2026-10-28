import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { Router, RouteContext } from '../../../core/http/router.ts';
import { json, readJson } from '../../../core/http/router.ts';
import { AppError } from '../../../core/errors.ts';
import type { StaffEnv, SessionState } from '../../staff/api/auth-routes.ts';
import { canApprove } from '../../staff/domain/permissions.ts';
import { employees } from '../../staff/schema.ts';
import { warehouses } from '../../catalog/schema.ts';
import { postMoves, assertWarehousesOpened } from '../../inventory/api/ledger.ts';
import { recordMovements } from '../../catalog/api/product-history.ts';
import { notifyMany } from '../../notifications/api/routes.ts';
import { salesOrders, salesOrderLines } from '../schema.ts';
import { posReturns, posReturnLines, posRefunds } from '../return-schema.ts';
import { posShifts } from '../pos-schema.ts';
import { cashDrawers, cashEntries } from '../cash-schema.ts';
import { cashAccess, cashAudit, cashLock, type CashDb } from './cash-store.ts';
import { posStoreScopeFor } from './pos-access.ts';
import { posKey, posText } from './pos-store.ts';
import { returnAccount } from './pos-return-credit.ts';
import { basisCovers, basisSkus, describeUnproven, unprovenRestock, verifyStockBasis, type StockBasis } from './crm-return-stock.ts';
import { returnPortion } from '../domain/pos-return-money.ts';
import { posMoney } from '../domain/pos-money.ts';
import { crmReturnAmounts } from '../domain/crm-return-money.ts';

type Ctx = RouteContext<StaffEnv>;
type Order = typeof salesOrders.$inferSelect;
type LoadOrder = (c: Ctx, id: string, db?: CashDb) => Promise<Order>;
const who = (c: Ctx) => (c.state.session as SessionState).member;
const now = () => new Date().toISOString();
const active = (status: string) => !['rejected', 'cancelled'].includes(status);
const lineSnapshot = (lines: (typeof salesOrderLines.$inferSelect)[]) => JSON.stringify(lines.map(l => ({ id: l.id, sku: l.sku, qty: l.qty, amount: l.amount, taxRate: l.taxRate })));
function approver(c: Ctx) { if (!canApprove(who(c))) throw new AppError(403, 'Cần Manager hoặc người được chỉ định duyệt.'); }
function refundAccess(c: Ctx) { approver(c); cashAccess(who(c)); }

export function registerCrmReturnRoutes(router: Router<StaffEnv>, loadOrder: LoadOrder) {
  async function source(c: Ctx, db: CashDb, lock = false) {
    const o = await loadOrder(c, c.params.id!, db);
    if (o.channel !== 'crm') throw new AppError(409, 'Đơn POS dùng chức năng trả hàng tại Bán hàng nhanh.');
    if (lock) await db.select({ id: salesOrders.id }).from(salesOrders).where(eq(salesOrders.id, o.id)).for('update');
    // Re-read through the same permission scope after obtaining the lock.
    const fresh = lock ? await loadOrder(c, o.id, db) : o;
    return fresh;
  }
  async function request(c: Ctx, db: CashDb) {
    const o = await source(c, db, true);
    const [r] = await db.select().from(posReturns).where(and(eq(posReturns.id, c.params.returnId!), eq(posReturns.orderId, o.id), eq(posReturns.source, 'crm'))).for('update');
    if (!r) throw new AppError(404, 'Không tìm thấy phiếu trả của đơn này.');
    return { o, r };
  }
  async function linesOf(db: CashDb, id: string) {
    return db.select().from(salesOrderLines).where(eq(salesOrderLines.orderId, id)).orderBy(asc(salesOrderLines.lineNo));
  }
  async function checkUnchanged(db: CashDb, o: Order, r: typeof posReturns.$inferSelect) {
    if (['draft', 'cancelled'].includes(o.status)) throw new AppError(409, 'Đơn không còn ở trạng thái được trả hàng.');
    const lines = await linesOf(db, o.id), snapshot = JSON.parse(r.sourceSnapshot);
    if (snapshot.lines !== lineSnapshot(lines) || snapshot.total !== o.total || snapshot.subtotal !== o.subtotal || snapshot.tax !== o.tax)
      throw new AppError(409, 'Dòng hàng/giá trị đơn đã thay đổi; cần huỷ phiếu chưa nhận và lập lại.');
    const all = await db.select().from(posReturns).where(eq(posReturns.orderId, o.id));
    const claims = all.filter(x => active(x.status));
    const claimed = claims.length ? await db.select().from(posReturnLines).where(inArray(posReturnLines.returnId, claims.map(x => x.id))) : [];
    if (lines.some(l => claimed.filter(x => x.orderLineId === l.id).reduce((n, x) => n + x.requestedQty, 0) > l.deliveredQty + 1e-9))
      throw new AppError(409, 'Số trả đang giữ vượt lượng đã giao của đơn.');
    return lines;
  }
  async function checkWarehouse(c: Ctx, db: CashDb, id: string) {
    const scope = await posStoreScopeFor(db, who(c));
    if (scope && !scope.rows.some(x => scope.scope.registers.includes(x.r.id) && x.r.warehouseId === id)) throw new AppError(403, 'Kho không thuộc cửa hàng của bạn.');
    await assertWarehousesOpened(db, [id]);
  }
  /** Phần nhập lại vượt lượng đã xuất: bắt buộc Manager chọn căn cứ kiểm được (crm-return-stock.ts); lưu vào phiếu + nhật ký. */
  async function withStockBasis(db: CashDb, o: Order, r: typeof posReturns.$inferSelect, raw: unknown, by: string, required = false) {
    const snapshot = JSON.parse(r.sourceSnapshot), unproven = await unprovenRestock(db, o.id, r.id);
    if (!unproven.length) { if (required) throw new AppError(409, 'Phiếu không có phần nhập lại vượt lượng đã xuất, không cần căn cứ.'); return r.sourceSnapshot; }
    if (raw === undefined || raw === null) throw new AppError(409, 'Nhập lại vượt lượng đã xuất có chứng từ (' + describeUnproven(unproven) + '). Chọn căn cứ: giao trước ngày chốt tồn, hoặc phiếu điều chỉnh đã trừ bù; không có căn cứ thì từ chối phiếu và lập lại với tình trạng hàng hỏng (không nhập kho).', 'RETURN_STOCK_UNPROVEN');
    if (by && (await db.select({ role: employees.role }).from(employees).where(eq(employees.id, by)))[0]?.role !== 'manager') throw new AppError(403, 'Chỉ Manager xác nhận căn cứ nhập lại kho.');
    const basis = await verifyStockBasis(db, o, r, unproven, raw, by);
    await cashAudit(db, by, 'crm-return-stock-basis', 'pos-returns', r.id, { orderId: o.id, basis, unproven });
    return JSON.stringify({ ...snapshot, stockBasis: basis, stockBasisSkus: basisSkus(unproven) });
  }
  const base = '/orders/:id/returns';
  router.get(base, async c => {
    const db = c.env.db, o = await source(c, db), account = await returnAccount(db, o.id), lines = await linesOf(db, o.id);
    const scope = await posStoreScopeFor(db, who(c));
    const people = await db.select({ id: employees.id, name: employees.name }).from(employees).where(inArray(employees.id, [...new Set(account.returns.flatMap(r => [r.createdBy, r.approvedBy, r.receivedBy].filter((x): x is string => !!x)) .concat(account.refunds.map(r => r.confirmedBy)))]));
    const names = new Map(people.map(x => [x.id, x.name]));
    const returns = await Promise.all(account.returns.map(async r => ({ ...r, createdByName: names.get(r.createdBy), approvedByName: names.get(r.approvedBy || ''), receivedByName: names.get(r.receivedBy || ''),
      // Phần nhập lại vượt lượng đã thực xuất (đơn cũ) + căn cứ Manager đã chọn – giao diện hỏi căn cứ trước khi duyệt / nhận.
      stockCheck: active(r.status) && !r.receivedAt ? { unproven: await unprovenRestock(db, o.id, r.id), basis: (JSON.parse(r.sourceSnapshot) as { stockBasis?: StockBasis }).stockBasis ?? null } : null,
      lines: await db.select().from(posReturnLines).where(eq(posReturnLines.returnId, r.id)), refunds: account.refunds.filter(x => x.returnId === r.id).map(x => ({ ...x, confirmedByName: names.get(x.confirmedBy) })) })));
    let canRefund = true; try { refundAccess(c); } catch { canRefund = false; }
    const whs = (await db.select({ id: warehouses.id, name: warehouses.name }).from(warehouses).where(eq(warehouses.kind, 'stock'))).filter(w => !scope || scope.rows.some(x => scope.scope.registers.includes(x.r.id) && x.r.warehouseId === w.id));
    const drawers = canRefund ? (await db.select({ id: cashDrawers.id, name: cashDrawers.name }).from(cashDrawers)).filter(d => !scope || scope.scope.drawers.includes(d.id)) : [];
    return json({ order: { id: o.id, orderNo: o.orderNo, status: o.status, customerName: o.customerName, total: o.total, invoiceIssued: !!o.invoiceNo || o.invoiceStatus === 'issued' },
      lines: lines.map(l => ({ ...l, returnableQty: Math.max(0, l.deliveredQty - returns.filter(r => active(r.status)).flatMap(r => r.lines).filter(x => x.orderLineId === l.id).reduce((n, x) => n + x.requestedQty, 0)) })),
      returns, account: { paid: account.paid, credit: account.credit, refunded: account.refunded, balance: account.balance, available: account.available }, warehouses: whs, drawers,
      canApprove: canApprove(who(c)), canRefund, viewerId: who(c).id, manager: who(c).role === 'manager' });
  }, 'business');

  router.post(base, async c => {
    const b = await readJson(c.req, 32000), key = posKey(b.key), reason = posText(b.reason, 2000), warehouseId = posText(b.warehouseId);
    if (!reason || !warehouseId) throw new AppError(400, 'Chọn kho nhận và nhập lý do trả hàng.');
    let created = false;
    const result = await c.env.db.transaction(async tx => {
      await cashLock(tx); const o = await source(c, tx, true);
      const [prior] = await tx.select().from(posReturns).where(eq(posReturns.requestKey, key));
      if (prior) { if (prior.source !== 'crm' || prior.orderId !== o.id || prior.createdBy !== who(c).id || JSON.parse(prior.sourceSnapshot).request !== JSON.stringify(b)) throw new AppError(409, 'Mã yêu cầu đã dùng cho nội dung khác.'); return prior; }
      if (['draft', 'cancelled'].includes(o.status)) throw new AppError(409, 'Chỉ trả phần hàng đã giao của đơn đang hiệu lực.');
      await checkWarehouse(c, tx, warehouseId);
      const old = await linesOf(tx, o.id), amounts = crmReturnAmounts(o, old);
      const rs = await tx.select().from(posReturns).where(eq(posReturns.orderId, o.id));
      const ids = rs.filter(r => active(r.status)).map(r => r.id);
      const claimed = ids.length ? await tx.select().from(posReturnLines).where(inArray(posReturnLines.returnId, ids)) : [];
      if (!Array.isArray(b.lines) || !b.lines.length || b.lines.length > old.length || new Set(b.lines.map((x: any) => x?.orderLineId)).size !== b.lines.length) throw new AppError(400, 'Chọn dòng hàng cần trả, không trùng.');
      const id = crypto.randomUUID(), at = now();
      const lines = b.lines.map((x: any) => {
        const l = old.find(l => l.id === x?.orderLineId);
        if (!l || !l.sku.trim() || !(l.deliveredQty > 0) || !['restock', 'damaged'].includes(x.disposition)) throw new AppError(400, 'Chọn mã đã giao và tình trạng hàng hợp lệ.');
        const prev = claimed.filter(p => p.orderLineId === l.id), qty = prev.reduce((n, p) => n + p.requestedQty, 0);
        returnPortion(0, l.deliveredQty, qty, x.qty, 0);
        const amount = amounts.get(l.id)!;
        const subtotal = returnPortion(amount.subtotal, l.qty, qty, x.qty, prev.reduce((n, p) => n + p.subtotal, 0));
        const tax = returnPortion(amount.tax, l.qty, qty, x.qty, prev.reduce((n, p) => n + p.tax, 0));
        return { id: crypto.randomUUID(), returnId: id, orderLineId: l.id, sku: l.sku, name: l.name, unit: l.unit, requestedQty: Number(x.qty), disposition: x.disposition, conditionNote: posText(x.conditionNote, 1000), subtotal, tax, total: subtotal + tax };
      });
      const [r] = await tx.insert(posReturns).values({ id, source: 'crm', returnNo: 'TH-CRM-' + id.slice(0, 8).toUpperCase(), orderId: o.id, warehouseId, registerId: null, createdShiftId: null, kind: 'return', requestContext: 'after_delivery', status: 'pending', reason,
        subtotal: lines.reduce((n: number, l: any) => n + l.subtotal, 0), tax: lines.reduce((n: number, l: any) => n + l.tax, 0), total: lines.reduce((n: number, l: any) => n + l.total, 0),
        sourceSnapshot: JSON.stringify({ lines: lineSnapshot(old), total: o.total, subtotal: o.subtotal, tax: o.tax, request: JSON.stringify(b) }), requestKey: key, createdBy: who(c).id, createdAt: at, updatedAt: at }).returning();
      await tx.insert(posReturnLines).values(lines); await cashAudit(tx, who(c).id, 'crm-request-return', 'pos-returns', id, { orderId: o.id, warehouseId, lines, reason }); created = true; return r!;
    });
    if (created) { const managers = await c.env.db.select({ id: employees.id }).from(employees).where(and(eq(employees.role, 'manager'), eq(employees.active, true), isNull(employees.deletedAt)));
      await notifyMany(c.env, managers.map(m => m.id).filter(id => id !== who(c).id), { eventType: 'crm_return_pending', title: 'Trả hàng CRM chờ duyệt', body: `${result.returnNo} · ${reason.slice(0, 120)}`, url: `/index.html#/orders/${result.orderId}?returns=1`, actorId: who(c).id, data: { returnId: result.id, orderId: result.orderId } }).catch(() => {}); }
    return json(result, 201);
  }, 'business');

  router.post(base + '/:returnId/approve', async c => {
    approver(c); const b = await readJson(c.req, 4000), note = posText(b.note, 2000);
    return json(await c.env.db.transaction(async tx => {
      await cashLock(tx); const { o, r } = await request(c, tx);
      if (r.createdBy === who(c).id && who(c).role !== 'manager') throw new AppError(403, 'Người được chỉ định không tự duyệt phiếu của mình.');
      if (r.status !== 'pending') { if (r.approvedBy === who(c).id && r.approvalNote === note && active(r.status)) return { id: r.id, replayed: true }; throw new AppError(409, 'Phiếu không còn chờ duyệt.'); }
      await checkUnchanged(tx, o, r); const at = now();
      const snapshot = await withStockBasis(tx, o, r, b.stockBasis, who(c).id);
      await tx.update(posReturns).set({ status: 'approved', approvedBy: who(c).id, approvedAt: at, approvalNote: note, updatedAt: at, sourceSnapshot: snapshot }).where(eq(posReturns.id, r.id));
      await cashAudit(tx, who(c).id, 'crm-approve-return', 'pos-returns', r.id, { orderId: o.id, note }); return { id: r.id };
    }));
  }, 'business');
  /** Manager bổ sung / đổi căn cứ nhập lại kho cho phiếu đã duyệt, chưa nhận hàng. */
  router.post(base + '/:returnId/stock-basis', async c => {
    approver(c); if (who(c).role !== 'manager') throw new AppError(403, 'Chỉ Manager xác nhận căn cứ nhập lại kho.');
    const b = await readJson(c.req, 4000);
    return json(await c.env.db.transaction(async tx => {
      await cashLock(tx); const { o, r } = await request(c, tx);
      if (r.status !== 'approved' || r.receivedAt) throw new AppError(409, 'Chỉ bổ sung căn cứ cho phiếu đã duyệt, chưa nhận hàng.');
      await checkUnchanged(tx, o, r);
      const snapshot = await withStockBasis(tx, o, r, b.stockBasis, who(c).id, true);
      await tx.update(posReturns).set({ sourceSnapshot: snapshot, updatedAt: now() }).where(eq(posReturns.id, r.id));
      return { id: r.id };
    }));
  }, 'business');
  router.post(base + '/:returnId/cancel', async c => {
    const b = await readJson(c.req, 4000), reason = posText(b.reason, 2000); if (!reason) throw new AppError(400, 'Nhập lý do huỷ/từ chối.');
    return json(await c.env.db.transaction(async tx => {
      await cashLock(tx); const { o, r } = await request(c, tx);
      if (r.createdBy !== who(c).id && !canApprove(who(c))) throw new AppError(403, 'Chỉ người lập hoặc người duyệt được huỷ phiếu chưa nhận.');
      if (!active(r.status)) return { id: r.id, replayed: true };
      if (r.receivedAt || !['pending', 'approved'].includes(r.status)) throw new AppError(409, 'Đã nhận hàng: không huỷ hoặc xoá lịch sử nhập kho.');
      await tx.update(posReturns).set({ status: r.createdBy === who(c).id ? 'cancelled' : 'rejected', updatedAt: now() }).where(eq(posReturns.id, r.id));
      await cashAudit(tx, who(c).id, 'crm-cancel-return', 'pos-returns', r.id, { orderId: o.id, reason }); return { id: r.id };
    }));
  }, 'business');
  router.post(base + '/:returnId/receive', async c => {
    const b = await readJson(c.req, 4000); if (b.confirmed !== true) throw new AppError(400, 'Chỉ xác nhận khi đã nhận đủ hàng thực tế trên phiếu.');
    return json(await c.env.db.transaction(async tx => {
      await cashLock(tx); const { o, r } = await request(c, tx);
      if (r.receivedAt) return { id: r.id, replayed: true };
      if (r.status !== 'approved') throw new AppError(409, 'Phiếu chưa được duyệt.');
      await checkUnchanged(tx, o, r); await checkWarehouse(c, tx, r.warehouseId);
      // Kiểm lại lúc nhập kho: phiếu xuất / phiếu trả khác có thể đổi sau khi duyệt.
      const unproven = await unprovenRestock(tx, o.id, r.id);
      if (unproven.length && !basisCovers((JSON.parse(r.sourceSnapshot) as { stockBasis?: StockBasis }).stockBasis, unproven))
        throw new AppError(409, 'Nhập lại vượt lượng đã xuất có chứng từ (' + describeUnproven(unproven) + '). Manager cần chọn căn cứ trên phiếu trước khi nhận hàng.', 'RETURN_STOCK_UNPROVEN');
      const lines = await tx.select().from(posReturnLines).where(eq(posReturnLines.returnId, r.id)), at = now();
      await postMoves(tx, who(c).id, lines.filter(l => l.disposition === 'restock').map(l => ({ sku: l.sku, warehouseId: r.warehouseId, qty: l.requestedQty, kind: 'customer_return' as const, refType: 'pos_return' as const, refId: r.id, refNo: r.returnNo, note: r.reason })), at);
      await recordMovements(tx, lines.map(l => ({ refKey: `return:${r.id}:${l.id}`, sku: l.sku, name: l.name, qty: l.requestedQty, unit: l.unit, unitPrice: l.subtotal / l.requestedQty, kind: 'customer_return', partner: o.customerName, refCode: r.returnNo, link: '#/orders/' + o.id, status: l.disposition === 'restock' ? 'Đã nhập lại kho' : 'Hàng hỏng, không nhập tồn bán', occurredAt: at })));
      for (const l of lines) await tx.update(posReturnLines).set({ receivedQty: l.requestedQty, restockQty: l.disposition === 'restock' ? l.requestedQty : 0 }).where(eq(posReturnLines.id, l.id));
      await tx.update(posReturns).set({ status: 'processing', receivedBy: who(c).id, receivedAt: at, creditEffectiveAt: at, updatedAt: at }).where(eq(posReturns.id, r.id));
      await tx.update(salesOrders).set({ revision: sql`${salesOrders.revision}+1`, updatedAt: at }).where(eq(salesOrders.id, o.id));
      await cashAudit(tx, who(c).id, 'crm-receive-return', 'pos-returns', r.id, { orderId: o.id, warehouseId: r.warehouseId, lines, note: posText(b.note, 2000) }); return { id: r.id };
    }));
  }, 'business');
  router.post(base + '/:returnId/refund', async c => {
    refundAccess(c); const b = await readJson(c.req, 6000), key = posKey(b.key), amount = posMoney(b.amount), method = posText(b.method), reference = posText(b.reference, 200), drawerId = posText(b.drawerId);
    if (b.confirmed !== true || amount <= 0 || !['cash', 'transfer'].includes(method) || method === 'transfer' && !reference || !drawerId) throw new AppError(400, 'Xác nhận số tiền thực hoàn, két và tham chiếu chuyển khoản.');
    return json(await c.env.db.transaction(async tx => {
      await cashLock(tx); const { o, r } = await request(c, tx);
      const [prior] = await tx.select().from(posRefunds).where(eq(posRefunds.requestKey, key));
      if (prior) { if (prior.returnId !== r.id || prior.confirmedBy !== who(c).id || prior.amount !== amount || prior.method !== method || prior.reference !== reference || prior.drawerId !== drawerId) throw new AppError(409, 'Mã hoàn tiền đã dùng cho giao dịch khác.'); return { ...prior, replayed: true }; }
      const scope = await posStoreScopeFor(tx, who(c));
      if (scope && !scope.scope.drawers.includes(drawerId)) throw new AppError(403, 'Két không thuộc cửa hàng của bạn.');
      const [drawer] = await tx.select().from(cashDrawers).where(eq(cashDrawers.id, drawerId)); if (!drawer) throw new AppError(400, 'Chọn két hợp lệ.');
      if (!r.receivedAt || !r.approvedBy || !r.creditEffectiveAt || r.status !== 'processing') throw new AppError(409, 'Cần duyệt và thực nhận hàng trước khi hoàn tiền.');
      await checkUnchanged(tx, o, r);
      const a = await returnAccount(tx, o.id), used = a.refunds.filter(x => x.returnId === r.id).reduce((n, x) => n + x.amount, 0);
      if (amount > a.available || amount > r.total - used) throw new AppError(409, 'Số hoàn vượt phần thực thu dư sau đối trừ công nợ.');
      const id = crypto.randomUUID(), at = now(), refundNo = 'HT-CRM-' + id.slice(0, 8).toUpperCase(); let shiftId: string | null = null, cashEntryId: string | null = null;
      if (method === 'cash') {
        const [s] = await tx.select().from(posShifts).where(and(eq(posShifts.memberId, who(c).id), eq(posShifts.cashDrawerId, drawerId), isNull(posShifts.closedAt))).for('update');
        if (!s) throw new AppError(409, 'Cần ca két của bạn đang mở để ghi thực chi tiền mặt.');
        shiftId = s.id; cashEntryId = crypto.randomUUID();
        await tx.insert(cashEntries).values({ id: cashEntryId, entryNo: refundNo, drawerId, shiftId, kind: 'customer_refund', direction: 'out', amount, reason: `Hoàn ${r.returnNo}: ${r.reason}`, status: 'posted', approvalThresholdSnapshot: drawer.approvalThreshold, createdBy: who(c).id, createdAt: at, approvedBy: r.approvedBy, approvedAt: r.approvedAt, requestKey: key, updatedAt: at });
      }
      const [refund] = await tx.insert(posRefunds).values({ id, refundNo, returnId: r.id, shiftId, drawerId, method, amount, cashEntryId, reference, confirmationNote: posText(b.note, 2000), confirmedBy: who(c).id, confirmedAt: at, requestKey: key, createdAt: at }).returning();
      await cashAudit(tx, who(c).id, 'crm-refund', 'pos-returns', r.id, { orderId: o.id, refundId: id, amount, method, reference, drawerId, shiftId }); return refund;
    }), 201);
  }, 'business');
  router.post(base + '/:returnId/complete', async c => {
    await readJson(c.req, 1000);
    return json(await c.env.db.transaction(async tx => {
      await cashLock(tx); const { o, r } = await request(c, tx);
      if (r.status === 'completed') return { id: r.id, replayed: true };
      if (r.status !== 'processing' || !r.receivedAt) throw new AppError(409, 'Chưa nhận hàng trả.');
      const a = await returnAccount(tx, o.id), refunded = a.refunds.filter(x => x.returnId === r.id).reduce((n, x) => n + x.amount, 0);
      if (a.available > 0 && refunded < r.total) throw new AppError(409, 'Còn tiền dư phải đối soát/hoàn trước khi hoàn tất.');
      await tx.update(posReturns).set({ status: 'completed', updatedAt: now() }).where(eq(posReturns.id, r.id)); await cashAudit(tx, who(c).id, 'crm-complete-return', 'pos-returns', r.id, { orderId: o.id }); return { id: r.id };
    }));
  }, 'business');
}
