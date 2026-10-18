import { cashEntries, cashReconciliations } from '../modules/sales/cash-schema.ts';
import { and, desc, eq, inArray, like, lt, or } from 'drizzle-orm';
import type { Router } from '../core/http/router.ts';
import { json, readJson } from '../core/http/router.ts';
import { AppError } from '../core/errors.ts';
import { auditLogs } from '../core/db/schema.ts';
import type { SessionState, StaffEnv } from '../modules/staff/api/auth-routes.ts';
import { employees } from '../modules/staff/schema.ts';
import { customerPayments, deliveries, packingSlips, salesContracts } from '../modules/sales/schema.ts';

const clean = (v: string | null, max: number) => (v ?? '').trim().slice(0, max);

/**
 * Xem NHẬT KÝ THAY ĐỔI (chỉ Manager): `?entityType=orders&entityId=<id>` lịch sử một bản ghi (`&related=1`: kèm thao tác khác
 * nhắc tới mã này, vd phiếu thu / giao hàng / HĐKT của đơn có `orderId` trong nội dung; với đơn hàng còn kèm thao tác trên chính HĐKT / chuyến giao /
 * phiếu thu / phiếu đóng gói của đơn – đổi trạng thái giao, huỷ phiếu thu… không ghi `orderId` trong nội dung); `?actorId=` theo người;
 * không lọc = 100 thao tác gần nhất. `before=<createdAt>` để xem tiếp trang cũ hơn.
 *
 * `POST /csp-report`: trang báo vi phạm Content-Security-Policy (đang ở chế độ chỉ báo cáo) → in ra log Edge Function
 * để xem asset / API nào sẽ bị chặn trước khi bật thật. Không lưu CSDL.
 */
export function registerAuditRoutes(router: Router<StaffEnv>) {
  router.get('/audit', async c => {
    const p = c.url.searchParams, entityType = clean(p.get('entityType'), 60), entityId = clean(p.get('entityId'), 120);
    const actorId = clean(p.get('actorId'), 80), before = clean(p.get('before'), 40), limit = Math.min(Math.max(Number(p.get('limit')) || 100, 1), 200);
    if (entityId && !entityType) throw new AppError(400, 'Thiếu loại bản ghi.');
    // Mã bản ghi chỉ gồm chữ, số, gạch (UUID, mã hàng) → dùng an toàn trong LIKE.
    const related = p.get('related') === '1' && /^[\w.-]+$/.test(entityId);
    const db = c.env.db, cashChildren = related && entityType === 'pos-shifts' ? (await Promise.all([db.select({id:cashEntries.id}).from(cashEntries).where(eq(cashEntries.shiftId,entityId)),db.select({id:cashReconciliations.id}).from(cashReconciliations).where(eq(cashReconciliations.shiftId,entityId))])).flat().map(r=>r.id) : [];
    const children = related && entityType === 'orders' ? (await Promise.all([
      db.select({ id: salesContracts.id }).from(salesContracts).where(eq(salesContracts.orderId, entityId)),
      db.select({ id: deliveries.id }).from(deliveries).where(eq(deliveries.orderId, entityId)),
      db.select({ id: customerPayments.id }).from(customerPayments).where(eq(customerPayments.orderId, entityId)),
      db.select({ id: packingSlips.id }).from(packingSlips).where(eq(packingSlips.orderId, entityId)),
    ])).flat().map(r => r.id) : [];
    const rows = await db.select({ a: auditLogs, actorName: employees.name }).from(auditLogs).leftJoin(employees, eq(employees.id, auditLogs.actorId))
      .where(and(entityId && related ? or(and(eq(auditLogs.entityType, entityType), eq(auditLogs.entityId, entityId)), like(auditLogs.data, `%"${entityId}"%`),
          [...children,...cashChildren].length ? inArray(auditLogs.entityId, [...children,...cashChildren]) : undefined)
          : and(entityType ? eq(auditLogs.entityType, entityType) : undefined, entityId ? eq(auditLogs.entityId, entityId) : undefined),
        actorId ? eq(auditLogs.actorId, actorId) : undefined, before ? lt(auditLogs.createdAt, before) : undefined))
      .orderBy(desc(auditLogs.createdAt)).limit(limit);
    return json({ entries: rows.map(({ a, actorName }) => ({ id: a.id, at: a.createdAt, actorId: a.actorId, actorName: actorName ?? '', area: a.module, action: a.action,
      entityType: a.entityType, entityId: a.entityId, data: (() => { try { return JSON.parse(a.data); } catch { return {}; } })() })) });
  }, 'admin');

  let reports = 0;
  router.post('/csp-report', async c => {
    const b = await readJson(c.req, 8_000), me = (c.state.session as SessionState).member;
    // Mỗi phiên chạy chỉ in tối đa 500 báo cáo (tránh log tràn khi một trang vi phạm liên tục).
    if (++reports <= 500) {
      const s = (k: string) => String(b[k] ?? '').slice(0, 300);
      console.warn('csp-report', JSON.stringify({ directive: s('directive'), blocked: s('blocked'), page: s('page'), source: s('source'), line: Number(b.line) || 0, role: me.role }));
    }
    return json({ ok: true });
  }, 'self');
}
