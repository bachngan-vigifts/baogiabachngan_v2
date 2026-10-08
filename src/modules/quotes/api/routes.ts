import { and, count, desc, eq, inArray, sql } from 'drizzle-orm';
import type { Router } from '../../../core/http/router.ts';
import { json, readJson } from '../../../core/http/router.ts';
import { AppError } from '../../../core/errors.ts';
import type { StaffEnv, SessionState } from '../../staff/api/auth-routes.ts';
import { quotationScope, quotationEditScope, type SqlScope } from '../domain/access.ts';
import { cleanQuotation } from '../domain/quotation-schema.ts';
import { quoteHeaderIndex, quoteLineRows } from '../domain/quote-index.ts';
import { totals } from '../domain/quote-math.ts';
import { quotations, quoteLines, quoteNotifications, quoteRevisions } from '../schema.ts';
import { employees } from '../../staff/schema.ts';
import { notify } from '../../notifications/api/routes.ts';

const predicate = (scope: SqlScope) => {
  const fragments = scope.sql.replace(/\bq\./g, 'staff_quotations.').split('?');
  return sql.join(fragments.flatMap((part, i) => i < scope.bindings.length ? [sql.raw(part), sql`${scope.bindings[i]}`] : [sql.raw(part)]), sql.raw(''));
};

const isManager = (m: { role: string }) => m.role === 'manager';
type Tx = Parameters<Parameters<StaffEnv['db']['transaction']>[0]>[0];
type QuoteRow = typeof quotations.$inferSelect;
/**
 * Điểm móc khi lưu báo giá (chạy trong cùng giao dịch) – module bán hàng đăng ký (đảo phụ thuộc: quotes không import sales):
 *  - `beforeSave`: chặn sửa (vd đơn hàng của báo giá đã được Manager duyệt);
 *  - `afterSave`: đồng bộ chứng từ sinh từ báo giá (đơn / HĐKT còn nháp nhận số lượng, giá mới).
 */
export const quoteSaveHooks: { beforeSave: ((tx: Tx, old: QuoteRow) => Promise<void>)[]; afterSave: ((tx: Tx, saved: QuoteRow) => Promise<void>)[] } = { beforeSave: [], afterSave: [] };
/** Nội dung để so "có sửa không": chuẩn hoá lại và bỏ `id` dòng (mỗi lần lưu dòng được cấp id mới, như bản cũ). */
const contentKey = (data: unknown) => {
  try {
    const d = cleanQuotation(typeof data === 'string' ? JSON.parse(data) : data, { newId: () => '' });
    return JSON.stringify(d);
  } catch { return ''; }
};
/** Trạng thái duyệt khi lưu (như web cũ): Manager tạo → đã duyệt; nhân viên tạo → đợi duyệt. */
const approvalOnCreate = (viewer: { id: string; role: string }, now: string) =>
  isManager(viewer) ? { approvalStatus: 'approved' as const, approvedAt: now, approvedBy: viewer.id } : { approvalStatus: 'pending' as const, approvedAt: null, approvedBy: null };

export function registerQuoteRoutes(router: Router<StaffEnv>) {
  router.get('/quotes', async c => {
    const viewer = (c.state.session as SessionState).member;
    const rows = await c.env.db.select().from(quotations).where(predicate(quotationScope(viewer))).orderBy(desc(quotations.updatedAt)).limit(100);
    const customerCreators = new Set(rows.length ? (await c.env.db.select({ id: employees.id }).from(employees)
      .where(and(eq(employees.role, 'customer'), inArray(employees.id, [...new Set(rows.map(r => r.creatorId))])))).map(e => e.id) : []);
    return json({ quotes: rows.map(r => {
      const data = JSON.parse(r.data);
      return {
        id: r.id, quoteNo: r.quoteNo, customer: r.customer, quoteType: r.quoteType, revision: r.revision, updatedAt: r.updatedAt, total: totals(data).total,
        quoteDate: r.quoteDate, createdAt: r.createdAt, contact: data.contact || '', phone: data.phone || '', lineCount: data.rows.length, mine: r.creatorId === viewer.id,
        approvalStatus: r.approvalStatus, fromCustomer: customerCreators.has(r.creatorId),
      };
    }) });
  }, 'business');
  /** Manager: số báo giá đang đợi duyệt (badge như web cũ). */
  router.get('/quotes/pending-count', async c => {
    const viewer = (c.state.session as SessionState).member;
    const [r] = await c.env.db.select({ n: count() }).from(quotations).where(and(eq(quotations.approvalStatus, 'pending'), predicate(quotationScope(viewer))));
    return json({ count: Number(r?.n ?? 0) });
  }, 'business');
  router.get('/quotes/:id', async c => {
    const viewer = (c.state.session as SessionState).member;
    const [row] = await c.env.db.select().from(quotations).where(and(eq(quotations.id, c.params.id!), predicate(quotationScope(viewer)))).limit(1);
    if (!row) throw new AppError(404, 'Không tìm thấy báo giá.');
    const [approver] = row.approvedBy ? await c.env.db.select({ name: employees.name }).from(employees).where(eq(employees.id, row.approvedBy)).limit(1) : [];
    const [creator] = await c.env.db.select({ role: employees.role, name: employees.name }).from(employees).where(eq(employees.id, row.creatorId)).limit(1);
    const fromCustomer = creator?.role === 'customer';
    return json({ id: row.id, revision: row.revision, data: JSON.parse(row.data), approvalStatus: row.approvalStatus, approvedAt: row.approvedAt, approvedByName: approver?.name ?? '',
      fromCustomer, canApprove: isManager(viewer) || (fromCustomer && row.assigneeId === viewer.id) });
  }, 'business');
  /** Manager duyệt đúng phiên bản đang xem (phiên bản đổi → 409). Duyệt không đổi nội dung nên không tăng `revision`. */
  router.post('/quotes/:id/approve', async c => {
    const viewer = (c.state.session as SessionState).member;
    const body = await readJson(c.req, 1_024);
    // Manager duyệt mọi báo giá; nhân viên phụ trách duyệt (xác nhận) báo giá do KHÁCH gửi từ trang khách hàng.
    if (!isManager(viewer)) {
      const [q] = await c.env.db.select({ assigneeId: quotations.assigneeId, creatorRole: employees.role }).from(quotations)
        .innerJoin(employees, eq(employees.id, quotations.creatorId)).where(eq(quotations.id, c.params.id!)).limit(1);
      if (!q || q.creatorRole !== 'customer' || q.assigneeId !== viewer.id) throw new AppError(403, 'Chỉ Manager được duyệt báo giá.');
    }
    if (!Number.isSafeInteger(body.revision)) throw new AppError(400, 'Thiếu phiên bản báo giá.');
    const now = new Date().toISOString();
    const rows = await c.env.db.update(quotations).set({ approvalStatus: 'approved', approvedAt: now, approvedBy: viewer.id })
      .where(and(eq(quotations.id, c.params.id!), eq(quotations.revision, Number(body.revision)))).returning({ id: quotations.id });
    if (!rows.length) throw new AppError(409, 'Báo giá đã thay đổi. Vui lòng mở lại trước khi duyệt.');
    // Báo giá khách gửi: báo cho khách biết đã được xác nhận.
    const [q] = await c.env.db.select({ quoteNo: quotations.quoteNo, creatorId: quotations.creatorId, role: employees.role }).from(quotations)
      .innerJoin(employees, eq(employees.id, quotations.creatorId)).where(eq(quotations.id, c.params.id!)).limit(1);
    if (q?.role === 'customer') await notify(c.env, { eventType: 'quote_confirmed', title: 'Báo giá đã được xác nhận', body: `${q.quoteNo} đã được ${viewer.name} xác nhận. Quý khách có thể đặt hàng.`,
      url: '/customer.html#quotes', targetMemberId: q.creatorId, actorId: viewer.id, data: { quoteId: c.params.id } });
    return json({ id: c.params.id, approvalStatus: 'approved', approvedAt: now, approvedByName: viewer.name });
  }, 'business');
  /** Manager xoá báo giá (như nút "Xoá báo giá" web cũ). Báo giá đã có đơn đặt hàng / HĐKT thì không xoá được. */
  router.delete('/quotes/:id', async c => {
    const viewer = (c.state.session as SessionState).member;
    if (!isManager(viewer)) throw new AppError(403, 'Chỉ Manager được xoá báo giá.');
    const body = await readJson(c.req, 1_024);
    if (!Number.isSafeInteger(body.revision)) throw new AppError(400, 'Thiếu phiên bản báo giá.');
    try {
      await c.env.db.transaction(async tx => {
        const condition = and(eq(quotations.id, c.params.id!), eq(quotations.revision, Number(body.revision)));
        const [row] = await tx.select({ id: quotations.id }).from(quotations).where(condition).limit(1);
        if (!row) throw new AppError(409, 'Không thể xoá: báo giá đã thay đổi. Vui lòng tải lại.');
        await tx.delete(quoteNotifications).where(eq(quoteNotifications.quoteId, row.id));
        await tx.delete(quotations).where(condition);
      });
    } catch (e) {
      // Còn đơn đặt hàng / HĐKT trỏ tới báo giá (khoá ngoại) → không xoá.
      const code = (e as { code?: string; cause?: { code?: string } })?.code ?? (e as { cause?: { code?: string } })?.cause?.code;
      if (code === '23503') throw new AppError(409, 'Báo giá đã có đơn đặt hàng hoặc HĐKT nên không xoá được.');
      throw e;
    }
    return json({ ok: true });
  }, 'business');
  router.post('/quotes', async c => {
    const viewer = (c.state.session as SessionState).member;
    const data = cleanQuotation(await readJson(c.req));
    const id = crypto.randomUUID(), now = new Date().toISOString(), approval = approvalOnCreate(viewer, now);
    await c.env.db.transaction(async tx => {
      await tx.insert(quotations).values({ id, creatorId: viewer.id, assigneeId: viewer.id, quoteNo: data.quoteNo, quoteType: data.type, customer: data.customer, ...quoteHeaderIndex(data), data: JSON.stringify(data), revision: 1, ...approval, createdAt: now, updatedAt: now });
      if (data.rows.length) await tx.insert(quoteLines).values(quoteLineRows(id, data));
    });
    return json({ id, revision: 1, data, approvalStatus: approval.approvalStatus }, 201);
  }, 'business');
  router.put('/quotes/:id', async c => {
    const viewer = (c.state.session as SessionState).member;
    const body = await readJson(c.req);
    if (!Number.isSafeInteger(body.revision)) throw new AppError(400, 'Thiếu phiên bản báo giá.');
    const data = cleanQuotation(body.data), now = new Date().toISOString();
    const saved = await c.env.db.transaction(async tx => {
      const condition = and(eq(quotations.id, c.params.id!), eq(quotations.revision, Number(body.revision)), predicate(quotationEditScope(viewer)));
      const [old] = await tx.select().from(quotations).where(condition).limit(1);
      if (!old) throw new AppError(409, 'Báo giá đã thay đổi hoặc anh không có quyền sửa. Vui lòng tải lại.');
      for (const h of quoteSaveHooks.beforeSave) await h(tx, old);
      const next = old.revision + 1, encoded = JSON.stringify(data);
      // Nhân viên sửa nội dung báo giá đã duyệt → mất duyệt, phải gửi duyệt lại. Manager sửa thì giữ trạng thái; lưu mà không đổi gì cũng giữ.
      const revoke = !isManager(viewer) && old.approvalStatus === 'approved' && contentKey(data) !== contentKey(old.data);
      const approval = revoke ? { approvalStatus: 'pending' as const, approvedAt: null, approvedBy: null } : {};
      const rows = await tx.update(quotations).set({ quoteNo: data.quoteNo, quoteType: data.type, customer: data.customer, ...quoteHeaderIndex(data), data: encoded, revision: next, ...approval, updatedAt: now }).where(condition).returning({ id: quotations.id });
      if (!rows.length) throw new AppError(409, 'Báo giá vừa được sửa ở nơi khác. Vui lòng tải lại.');
      await tx.insert(quoteRevisions).values({ id: crypto.randomUUID(), quoteId: old.id, revision: old.revision, data: old.data, changedBy: viewer.id, createdAt: now });
      await tx.delete(quoteLines).where(eq(quoteLines.quoteId, old.id));
      if (data.rows.length) await tx.insert(quoteLines).values(quoteLineRows(old.id, data));
      const [fresh] = await tx.select().from(quotations).where(eq(quotations.id, old.id)).limit(1);
      for (const h of quoteSaveHooks.afterSave) await h(tx, fresh!);
      return { revision: next, approvalStatus: revoke ? 'pending' : old.approvalStatus, revoked: revoke };
    });
    return json({ id: c.params.id, revision: saved.revision, data, approvalStatus: saved.approvalStatus, approvalRevoked: saved.revoked });
  }, 'business');
}
