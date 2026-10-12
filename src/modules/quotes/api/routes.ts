import { quotationPredicate } from './department-access.ts';
import { and, asc, count, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import { fold, foldSql, matchAllWords, paging } from '../../../core/text/fold.ts';
import type { Router } from '../../../core/http/router.ts';
import { json, readJson } from '../../../core/http/router.ts';
import { AppError } from '../../../core/errors.ts';
import type { StaffEnv, SessionState } from '../../staff/api/auth-routes.ts';
import { cleanQuotation } from '../domain/quotation-schema.ts';
import { keepCosts, withoutCosts } from '../domain/cost-privacy.ts';
import { autoQuoteHead, nextQuoteNoAfter, quoteHeadFor } from '../domain/quote-number.ts';
import { quoteHeaderIndex, quoteLineRows } from '../domain/quote-index.ts';
import { totals } from '../domain/quote-math.ts';
import { quotations, quoteLines, quoteNotifications, quoteRevisions } from '../schema.ts';
import { employees } from '../../staff/schema.ts';
import { notify, notifyMany } from '../../notifications/api/routes.ts';



const isManager = (m: { role: string }) => m.role === 'manager';
/** Giá vốn (giá nhập, CK mua vào, chi phí in gia công, CK khách) chỉ Manager thấy. */
const forViewer = <T extends Record<string, unknown>>(viewer: { role: string }, data: T): T => isManager(viewer) ? data : withoutCosts(data);
type Tx = Parameters<Parameters<StaffEnv['db']['transaction']>[0]>[0];
type QuoteRow = typeof quotations.$inferSelect;
/**
 * Điểm móc khi lưu báo giá (chạy trong cùng giao dịch) – module bán hàng đăng ký (đảo phụ thuộc: quotes không import sales):
 *  - `beforeSave`: kiểm tra quyền sửa chứng từ đã duyệt;
 *  - `afterSave`: đồng bộ chứng từ sinh từ báo giá (đơn / HĐKT nhận số lượng, giá mới theo quyền người sửa).
 */
export const quoteSaveHooks: {
  beforeSave: ((tx: Tx, old: QuoteRow, viewer: { id: string; role: string }) => Promise<void>)[]; afterSave: ((tx: Tx, saved: QuoteRow, viewer: { id: string; role: string }) => Promise<void>)[];
  /** Sau khi tạo / lưu báo giá xong (ngoài giao dịch): vd. tasks tạo ngay việc "Duyệt báo giá" + thông báo, không đợi ai mở trang Công việc. */
  afterCommit: ((env: StaffEnv) => Promise<void>)[];
} = { beforeSave: [], afterSave: [], afterCommit: [] };
const runAfterCommit = async (env: StaffEnv) => {
  for (const h of quoteSaveHooks.afterCommit) { try { await h(env); } catch (e) { console.error('quote afterCommit hook failed', e instanceof Error ? e.message : e); } }
};
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

/**
 * Cấp số báo giá lúc lưu (trong giao dịch, khoá theo phiên giao dịch để hai người lưu cùng lúc không ra trùng số):
 *  - số theo mẫu tự sinh (HRC_BG20261009_001…) mà đã có báo giá khác dùng → tự đổi sang số kế tiếp còn trống;
 *  - số gõ tay trùng báo giá khác → báo lỗi để người dùng đổi số.
 * `exceptId` = báo giá đang sửa (không tính chính nó).
 */
export async function assignQuoteNo(tx: Tx, quoteNo: string, exceptId?: string): Promise<string> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext('staff_quotations.quote_no'))`);
  const taken = async (no: string) => (await tx.select({ id: quotations.id }).from(quotations)
    .where(and(eq(quotations.quoteNo, no), exceptId ? sql`${quotations.id} <> ${exceptId}` : undefined)).limit(1)).length > 0;
  if (!await taken(quoteNo)) return quoteNo;
  const head = autoQuoteHead(quoteNo);
  if (!head) throw new AppError(400, `Số báo giá ${quoteNo} đã được dùng cho báo giá khác. Vui lòng đổi số khác.`, 'QUOTE_NO_EXISTS');
  const used = (await tx.select({ n: quotations.quoteNo }).from(quotations).where(sql`${quotations.quoteNo} LIKE ${head + '%'}`)).map(r => r.n);
  return nextQuoteNoAfter(head, used);
}

export function registerQuoteRoutes(router: Router<StaffEnv>) {
  /**
   * Danh sách báo giá – lọc, sắp xếp, phân trang trên máy chủ (`?q=&type=&owner=mine|others&sort=updated|date|no|value&limit=&offset=`).
   * Kèm `total` (số báo giá khớp bộ lọc), `all` (tổng báo giá xem được), `value` (tổng giá trị khớp bộ lọc; null khi quá nhiều),
   * `month` (`?month=YYYY-MM`: số lượng + giá trị báo giá tháng đó) và `hasOthers` (có báo giá của người khác để hiện bộ lọc người tạo).
   */
  router.get('/quotes', async c => {
    const viewer = (c.state.session as SessionState).member, p = c.url.searchParams, db = c.env.db;
    const { limit, offset } = paging(c.url, 100, 500);
    const scope = quotationPredicate(viewer), type = p.get('type') || '', owner = p.get('owner') || '', sort = p.get('sort') || 'updated';
    const where = and(scope,
      type === 'HRC' || type === 'B2B' || type === 'VIGIFTS' ? eq(quotations.quoteType, type) : undefined,
      owner === 'mine' ? eq(quotations.creatorId, viewer.id) : owner === 'others' ? ne(quotations.creatorId, viewer.id) : undefined,
      matchAllWords(sql`(${foldSql(quotations.quoteNo, quotations.customer)} || ' ' || coalesce(${quotations.searchText}, ''))`, p.get('q')));
    const month = /^\d{4}-\d{2}$/.test(p.get('month') || '') ? p.get('month')! : '';
    const [[{ n: total = 0 } = {}], [{ n: all = 0 } = {}], [other], monthRows] = await Promise.all([
      db.select({ n: count() }).from(quotations).where(where),
      db.select({ n: count() }).from(quotations).where(scope),
      db.select({ id: quotations.id }).from(quotations).where(and(scope, ne(quotations.creatorId, viewer.id))).limit(1),
      month ? db.select({ data: quotations.data }).from(quotations).where(and(scope, sql`left(coalesce(nullif(${quotations.quoteDate}, ''), ${quotations.createdAt}), 7) = ${month}`)) : [],
    ]);
    const sum = (rows: { data: string }[]) => rows.reduce((s, r) => s + totals(JSON.parse(r.data)).total, 0);
    // Giá trị không có cột riêng: tính từ nội dung báo giá – chỉ làm khi số báo giá khớp lọc vừa phải.
    const VALUE_CAP = 3000, n = Number(total);
    const valued = sort === 'value' || n <= VALUE_CAP
      ? (await db.select({ id: quotations.id, data: quotations.data }).from(quotations).where(where).orderBy(desc(quotations.updatedAt)).limit(VALUE_CAP))
        .map(r => ({ id: r.id, total: totals(JSON.parse(r.data)).total }))
      : null;
    let rows: QuoteRow[];
    if (sort === 'value') {
      const ids = valued!.sort((a, b) => b.total - a.total).slice(offset, offset + limit).map(r => r.id);
      const got = ids.length ? await db.select().from(quotations).where(inArray(quotations.id, ids)) : [];
      rows = ids.map(id => got.find(r => r.id === id)!).filter(Boolean);
    } else {
      const order = sort === 'date' ? [sql`${quotations.quoteDate} DESC NULLS LAST`, desc(quotations.updatedAt), desc(quotations.id)]
        : sort === 'no' ? [asc(quotations.quoteNo), asc(quotations.id)] : [desc(quotations.updatedAt), desc(quotations.id)];
      rows = await db.select().from(quotations).where(where).orderBy(...order).limit(limit).offset(offset);
    }
    const customerCreators = new Set(rows.length ? (await db.select({ id: employees.id }).from(employees)
      .where(and(eq(employees.role, 'customer'), inArray(employees.id, [...new Set(rows.map(r => r.creatorId))])))).map(e => e.id) : []);
    return json({ quotes: rows.map(r => {
      const data = JSON.parse(r.data);
      return {
        id: r.id, quoteNo: r.quoteNo, customer: r.customer, quoteType: r.quoteType, revision: r.revision, updatedAt: r.updatedAt, total: totals(data).total,
        quoteDate: r.quoteDate, createdAt: r.createdAt, contact: data.contact || '', phone: data.phone || '', lineCount: data.rows.length, mine: r.creatorId === viewer.id,
        approvalStatus: r.approvalStatus, fromCustomer: customerCreators.has(r.creatorId),
      };
    }), total: n, all: Number(all), limit, offset, hasOthers: !!other,
    value: valued && n <= VALUE_CAP ? valued.reduce((s, r) => s + r.total, 0) : null,
    month: month ? { month, count: monthRows.length, value: sum(monthRows) } : null });
  }, 'business');
  /** Số báo giá (trong phạm vi người xem) của từng khách trên trang danh bạ đang xem: `?name=A&name=B…` (≤ 500 tên, so khớp không dấu). */
  router.get('/quotes/customer-counts', async c => {
    const viewer = (c.state.session as SessionState).member;
    const names = [...new Set(c.url.searchParams.getAll('name').slice(0, 500).filter(Boolean))];
    const keys = [...new Set(names.map(fold).filter(Boolean))];
    if (!keys.length) return json({ counts: {} });
    const key = sql<string>`trim(regexp_replace(${foldSql(quotations.customer)}, '\\s+', ' ', 'g'))`;
    const rows = await c.env.db.select({ k: key }).from(quotations).where(and(quotationPredicate(viewer), inArray(key, keys)));
    const byKey = new Map<string, number>();
    for (const r of rows) byKey.set(r.k, (byKey.get(r.k) ?? 0) + 1);
    return json({ counts: Object.fromEntries(names.map(n => [n, byKey.get(fold(n)) ?? 0])) });
  }, 'business');
  /** Manager: số báo giá đang đợi duyệt (badge như web cũ). */
  /** Số báo giá kế tiếp (gợi ý điền sẵn khi tạo mới) – đếm trên toàn bộ báo giá; lúc lưu máy chủ vẫn kiểm lại. */
  router.get('/quotes/next-no', async c => {
    const type = c.url.searchParams.get('type') || 'B2B', date = c.url.searchParams.get('date') || '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new AppError(400, 'Ngày không hợp lệ.');
    const head = quoteHeadFor(type, date);
    const used = (await c.env.db.select({ n: quotations.quoteNo }).from(quotations).where(sql`${quotations.quoteNo} LIKE ${head + '%'}`)).map(r => r.n);
    return json({ quoteNo: nextQuoteNoAfter(head, used) });
  }, 'business');
  router.get('/quotes/pending-count', async c => {
    const viewer = (c.state.session as SessionState).member;
    const [r] = await c.env.db.select({ n: count() }).from(quotations).where(and(eq(quotations.approvalStatus, 'pending'), quotationPredicate(viewer)));
    return json({ count: Number(r?.n ?? 0) });
  }, 'business');
  router.get('/quotes/:id', async c => {
    const viewer = (c.state.session as SessionState).member;
    const [row] = await c.env.db.select().from(quotations).where(and(eq(quotations.id, c.params.id!), quotationPredicate(viewer))).limit(1);
    if (!row) throw new AppError(404, 'Không tìm thấy báo giá.');
    const [approver] = row.approvedBy ? await c.env.db.select({ name: employees.name }).from(employees).where(eq(employees.id, row.approvedBy)).limit(1) : [];
    const [creator] = await c.env.db.select({ role: employees.role, name: employees.name }).from(employees).where(eq(employees.id, row.creatorId)).limit(1);
    const fromCustomer = creator?.role === 'customer';
    return json({ id: row.id, revision: row.revision, data: forViewer(viewer, JSON.parse(row.data)), approvalStatus: row.approvalStatus, approvedAt: row.approvedAt, approvedByName: approver?.name ?? '',
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
    const [q] = await c.env.db.select({ quoteNo: quotations.quoteNo, customer: quotations.customer, creatorId: quotations.creatorId, assigneeId: quotations.assigneeId, role: employees.role }).from(quotations)
      .innerJoin(employees, eq(employees.id, quotations.creatorId)).where(eq(quotations.id, c.params.id!)).limit(1);
    if (q?.role === 'customer') await notify(c.env, { eventType: 'quote_confirmed', title: 'Báo giá đã được xác nhận', body: `${q.quoteNo} đã được ${viewer.name} xác nhận. Quý khách có thể đặt hàng.`,
      url: '/customer.html#quotes', targetMemberId: q.creatorId, actorId: viewer.id, data: { quoteId: c.params.id } });
    // Báo giá nhân viên lập: người lập / phụ trách nhận thông báo đã được duyệt.
    if (q) await notifyMany(c.env, [q.role === 'customer' ? null : q.creatorId, q.assigneeId], { eventType: 'quote_approved', title: 'Báo giá đã được duyệt',
      body: `${q.quoteNo} – ${q.customer} · ${viewer.name} duyệt`, url: `/index.html#/quotes/${c.params.id}`, actorId: viewer.id, data: { quoteId: c.params.id } });
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
    // Nhân viên không đặt giá vốn (Manager bổ sung sau).
    const raw = await readJson(c.req), data = cleanQuotation(isManager(viewer) ? raw : keepCosts(raw, null));
    const id = crypto.randomUUID(), now = new Date().toISOString(), approval = approvalOnCreate(viewer, now);
    await c.env.db.transaction(async tx => {
      data.quoteNo = await assignQuoteNo(tx, data.quoteNo);
      await tx.insert(quotations).values({ id, creatorId: viewer.id, assigneeId: viewer.id, quoteNo: data.quoteNo, quoteType: data.type, customer: data.customer, ...quoteHeaderIndex(data), data: JSON.stringify(data), revision: 1, ...approval, createdAt: now, updatedAt: now });
      if (data.rows.length) await tx.insert(quoteLines).values(quoteLineRows(id, data));
    });
    // Nhân viên tạo báo giá mới → Manager nhận thông báo để duyệt.
    if (approval.approvalStatus === 'pending') await notifyMany(c.env, 'managers', { eventType: 'quote_pending', title: 'Báo giá mới chờ duyệt',
      body: `${viewer.name}: ${data.quoteNo} – ${data.customer || 'Chưa nhập khách'}`, url: `/index.html#/quotes/${id}`, actorId: viewer.id, data: { quoteId: id } });
    if (approval.approvalStatus === 'pending') await runAfterCommit(c.env);
    return json({ id, revision: 1, data: forViewer(viewer, data), approvalStatus: approval.approvalStatus }, 201);
  }, 'business');
  router.put('/quotes/:id', async c => {
    const viewer = (c.state.session as SessionState).member;
    const body = await readJson(c.req);
    if (!Number.isSafeInteger(body.revision)) throw new AppError(400, 'Thiếu phiên bản báo giá.');
    let data = cleanQuotation(body.data);
    const now = new Date().toISOString();
    const saved = await c.env.db.transaction(async tx => {
      const condition = and(eq(quotations.id, c.params.id!), eq(quotations.revision, Number(body.revision)), quotationPredicate(viewer, true));
      const [old] = await tx.select().from(quotations).where(condition).limit(1);
      if (!old) throw new AppError(409, 'Báo giá đã thay đổi hoặc anh không có quyền sửa. Vui lòng tải lại.');
      if (old.approvalStatus === 'approved' && !isManager(viewer)) throw new AppError(403, 'Báo giá đã duyệt. Chỉ Manager được chỉnh sửa.', 'QUOTE_APPROVED');
      // Nhân viên không thấy giá vốn → giữ nguyên giá vốn cũ của từng dòng (theo id dòng).
      if (!isManager(viewer)) data = cleanQuotation(keepCosts(body.data as Record<string, unknown>, JSON.parse(old.data)));
      for (const h of quoteSaveHooks.beforeSave) await h(tx, old, viewer);
      if (data.quoteNo !== old.quoteNo) data.quoteNo = await assignQuoteNo(tx, data.quoteNo, old.id);
      const next = old.revision + 1, encoded = JSON.stringify(data);
      // Nhân viên sửa nội dung báo giá đã duyệt → mất duyệt, phải gửi duyệt lại. Manager sửa thì giữ trạng thái; lưu mà không đổi gì cũng giữ.
      const changed = contentKey(data) !== contentKey(old.data);
      const revoke = !isManager(viewer) && old.approvalStatus === 'approved' && changed;
      const approval = revoke ? { approvalStatus: 'pending' as const, approvedAt: null, approvedBy: null } : {};
      const rows = await tx.update(quotations).set({ quoteNo: data.quoteNo, quoteType: data.type, customer: data.customer, ...quoteHeaderIndex(data), data: encoded, revision: next, ...approval, updatedAt: now }).where(condition).returning({ id: quotations.id });
      if (!rows.length) throw new AppError(409, 'Báo giá vừa được sửa ở nơi khác. Vui lòng tải lại.');
      await tx.insert(quoteRevisions).values({ id: crypto.randomUUID(), quoteId: old.id, revision: old.revision, data: old.data, changedBy: viewer.id, createdAt: now });
      await tx.delete(quoteLines).where(eq(quoteLines.quoteId, old.id));
      if (data.rows.length) await tx.insert(quoteLines).values(quoteLineRows(old.id, data));
      const [fresh] = await tx.select().from(quotations).where(eq(quotations.id, old.id)).limit(1);
      if (changed) for (const h of quoteSaveHooks.afterSave) await h(tx, fresh!, viewer);
      // Nhân viên sửa nội dung báo giá còn đang chờ duyệt → Manager được báo bản mới (lưu mà không đổi gì thì không báo).
      const pendingEdit = !isManager(viewer) && old.approvalStatus === 'pending' && changed;
      return { revision: next, approvalStatus: revoke ? 'pending' : old.approvalStatus, revoked: revoke, pendingEdit };
    });
    // Nhân viên sửa báo giá đã duyệt → mất duyệt → Manager nhận thông báo duyệt lại; sửa báo giá đang chờ duyệt → báo bản cập nhật.
    if (saved.revoked || saved.pendingEdit) await notifyMany(c.env, 'managers', { eventType: 'quote_pending',
      title: saved.revoked ? 'Báo giá sửa lại, chờ duyệt lại' : 'Báo giá chờ duyệt vừa được sửa',
      body: `${viewer.name}: ${data.quoteNo} – ${data.customer || ''}`, url: `/index.html#/quotes/${c.params.id}`, actorId: viewer.id, data: { quoteId: c.params.id } });
    if (saved.revoked) await runAfterCommit(c.env);
    return json({ id: c.params.id, revision: saved.revision, data: forViewer(viewer, data), approvalStatus: saved.approvalStatus, approvalRevoked: saved.revoked });
  }, 'business');
}



