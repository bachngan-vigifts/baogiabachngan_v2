import { and, desc, eq, sql } from 'drizzle-orm';
import type { Router } from '../../../core/http/router.ts';
import { json, readJson } from '../../../core/http/router.ts';
import { AppError } from '../../../core/errors.ts';
import type { StaffEnv, SessionState } from '../../staff/api/auth-routes.ts';
import { quotationScope, quotationEditScope, type SqlScope } from '../domain/access.ts';
import { cleanQuotation } from '../domain/quotation-schema.ts';
import { quoteHeaderIndex, quoteLineRows } from '../domain/quote-index.ts';
import { totals } from '../domain/quote-math.ts';
import { quotations, quoteLines, quoteRevisions } from '../schema.ts';

const predicate = (scope: SqlScope) => {
  const fragments = scope.sql.replace(/\bq\./g, 'staff_quotations.').split('?');
  return sql.join(fragments.flatMap((part, i) => i < scope.bindings.length ? [sql.raw(part), sql`${scope.bindings[i]}`] : [sql.raw(part)]), sql.raw(''));
};

export function registerQuoteRoutes(router: Router<StaffEnv>) {
  router.get('/quotes', async c => {
    const viewer = (c.state.session as SessionState).member;
    const rows = await c.env.db.select().from(quotations).where(predicate(quotationScope(viewer))).orderBy(desc(quotations.updatedAt)).limit(100);
    return json({ quotes: rows.map(r => ({ id: r.id, quoteNo: r.quoteNo, customer: r.customer, quoteType: r.quoteType, revision: r.revision, updatedAt: r.updatedAt, total: totals(JSON.parse(r.data)).total })) });
  }, 'business');
  router.get('/quotes/:id', async c => {
    const viewer = (c.state.session as SessionState).member;
    const [row] = await c.env.db.select().from(quotations).where(and(eq(quotations.id, c.params.id!), predicate(quotationScope(viewer)))).limit(1);
    if (!row) throw new AppError(404, 'Không tìm thấy báo giá.');
    return json({ id: row.id, revision: row.revision, data: JSON.parse(row.data) });
  }, 'business');
  router.post('/quotes', async c => {
    const viewer = (c.state.session as SessionState).member;
    const data = cleanQuotation(await readJson(c.req));
    const id = crypto.randomUUID(), now = new Date().toISOString();
    await c.env.db.transaction(async tx => {
      await tx.insert(quotations).values({ id, creatorId: viewer.id, assigneeId: viewer.id, quoteNo: data.quoteNo, quoteType: data.type, customer: data.customer, ...quoteHeaderIndex(data), data: JSON.stringify(data), revision: 1, createdAt: now, updatedAt: now });
      if (data.rows.length) await tx.insert(quoteLines).values(quoteLineRows(id, data));
    });
    return json({ id, revision: 1, data }, 201);
  }, 'business');
  router.put('/quotes/:id', async c => {
    const viewer = (c.state.session as SessionState).member;
    const body = await readJson(c.req);
    if (!Number.isSafeInteger(body.revision)) throw new AppError(400, 'Thiếu phiên bản báo giá.');
    const data = cleanQuotation(body.data), now = new Date().toISOString();
    const revision = await c.env.db.transaction(async tx => {
      const condition = and(eq(quotations.id, c.params.id!), eq(quotations.revision, Number(body.revision)), predicate(quotationEditScope(viewer)));
      const [old] = await tx.select().from(quotations).where(condition).limit(1);
      if (!old) throw new AppError(409, 'Báo giá đã thay đổi hoặc anh không có quyền sửa. Vui lòng tải lại.');
      const next = old.revision + 1;
      const rows = await tx.update(quotations).set({ quoteNo: data.quoteNo, quoteType: data.type, customer: data.customer, ...quoteHeaderIndex(data), data: JSON.stringify(data), revision: next, updatedAt: now }).where(condition).returning({ id: quotations.id });
      if (!rows.length) throw new AppError(409, 'Báo giá vừa được sửa ở nơi khác. Vui lòng tải lại.');
      await tx.insert(quoteRevisions).values({ id: crypto.randomUUID(), quoteId: old.id, revision: old.revision, data: old.data, changedBy: viewer.id, createdAt: now });
      await tx.delete(quoteLines).where(eq(quoteLines.quoteId, old.id));
      if (data.rows.length) await tx.insert(quoteLines).values(quoteLineRows(old.id, data));
      return next;
    });
    return json({ id: c.params.id, revision, data });
  }, 'business');
}
