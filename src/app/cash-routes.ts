import { auditLogs } from '../core/db/schema.ts';
import { and, asc, count, desc, eq, gte, isNull, lt, sql } from 'drizzle-orm';
import type { Router, RouteContext } from '../core/http/router.ts';
import { json, readJson } from '../core/http/router.ts';
import { AppError } from '../core/errors.ts';
import type { StaffEnv, SessionState } from '../modules/staff/api/auth-routes.ts';
import { employees } from '../modules/staff/schema.ts';
import { can } from '../modules/staff/domain/permissions.ts';
import { cashDrawers, cashEntries, cashReconciliations } from '../modules/sales/cash-schema.ts';
import { posShifts } from '../modules/sales/pos-schema.ts';
import { customerPayments, salesOrders } from '../modules/sales/schema.ts';
import { posKey, posText, shiftReport } from '../modules/sales/api/pos-store.ts';
import { cashEntryInput } from '../modules/sales/domain/cash.ts';
import { posMoney } from '../modules/sales/domain/pos-money.ts';
import { parsePhotos } from '../modules/inventory/api/photos.ts';
import {
  cashAccess,
  cashLock,
  cashAudit,
  cashNow,
  drawerOf,
  drawerBalance,
  cashShiftTotals,
  closeCashShift,
  voidClosedCashEffect,
  seesAllCash,
  CASH_DRAWER,
} from '../modules/sales/api/cash-store.ts';
type Ctx = RouteContext<StaffEnv>;
const who = (c: Ctx) => (c.state.session as SessionState).member;
const manager = (c: Ctx) => {
  if (who(c).role !== 'manager') throw new AppError(403, 'Chỉ Manager thao tác.');
};
const ownShift = (c: Ctx) => (seesAllCash(who(c)) ? undefined : eq(posShifts.memberId, who(c).id));
function dates(c: Ctx) {
  const from = c.url.searchParams.get('from') ?? '',
    to = c.url.searchParams.get('to') ?? '';
  if (
    ![from, to].every((s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(Date.parse(s))) ||
    to < from ||
    Date.parse(to) - Date.parse(from) > 400 * 864e5
  )
    throw new AppError(400, 'Chọn ngày hợp lệ, tối đa 400 ngày.');
  return {
    start: new Date(from + 'T00:00:00+07:00').toISOString(),
    end: new Date(Date.parse(to + 'T00:00:00+07:00') + 864e5).toISOString(),
  };
}
export function registerCashRoutes(router: Router<StaffEnv>) {
  router.get(
    '/cash',
    async (c) => {
      cashAccess(who(c));
      const db = c.env.db,
        d = await drawerOf(db),
        [s] = await db
          .select({ s: posShifts, memberName: employees.name })
          .from(posShifts)
          .innerJoin(employees, eq(employees.id, posShifts.memberId))
          .where(and(eq(posShifts.cashDrawerId, CASH_DRAWER), isNull(posShifts.closedAt)))
          .limit(1),
        [last] = await db
          .select()
          .from(posShifts)
          .where(and(eq(posShifts.cashDrawerId, CASH_DRAWER), sql`${posShifts.closedAt} is not null`))
          .orderBy(desc(posShifts.closedAt))
          .limit(1),
        [open] = await db
          .select({ count: count() })
          .from(cashReconciliations)
          .innerJoin(posShifts, eq(posShifts.id, cashReconciliations.shiftId))
          .where(and(ownShift(c), sql`${cashReconciliations.status}<>'closed'`));
      return json({
        drawer: d,
        balance: await drawerBalance(db),
        activeShift: s
          ? {
              id: s.s.id,
              memberName: s.memberName,
              openedAt: s.s.openedAt,
              mine: s.s.memberId === who(c).id,
              openingCash: s.s.openingCash,
            }
          : null,
        ownShift: s?.s.memberId === who(c).id ? s.s : null,
        nextOpeningCash: last?.countedCash ?? d.openingAmount,
        canManage: who(c).role === 'manager',
        canVoid: can(who(c), 'payments.void'),
        canSell: can(who(c), 'pos.sell'),
        openReconciliations: open?.count ?? 0,
        updatedAt: cashNow(),
      });
    },
    'business',
  );
  router.post(
    '/cash/config',
    async (c) => {
      manager(c);
      const b = await readJson(c.req, 4000);
      await c.env.db.transaction(async (tx) => {
        await cashLock(tx);
        const d = await drawerOf(tx);
        const fields: {
          approvalThreshold?: number;
          openingAmount?: number;
          openingReason?: string;
          openingSetAt?: string;
          openingSetBy?: string;
          updatedAt: string;
          updatedBy: string;
        } = { updatedAt: cashNow(), updatedBy: who(c).id };
        if (b.approvalThreshold !== undefined) {
          fields.approvalThreshold = posMoney(b.approvalThreshold);
          if (!fields.approvalThreshold) throw new AppError(400, 'Ngưỡng phải lớn hơn 0.');
        }
        if (b.openingAmount !== undefined) {
          if (d.openingSetAt) throw new AppError(409, 'Số đầu kỳ đã thiết lập, dùng phiếu điều chỉnh.');
          fields.openingAmount = posMoney(b.openingAmount);
          fields.openingReason = posText(b.reason, 2000);
          if (!fields.openingReason) throw new AppError(400, 'Nhập lý do số dư đầu kỳ.');
          fields.openingSetAt = fields.updatedAt;
          fields.openingSetBy = who(c).id;
        }
        await tx.update(cashDrawers).set(fields).where(eq(cashDrawers.id, d.id));
        await cashAudit(tx, who(c).id, 'configure', 'cash-drawers', d.id, fields);
      });
      return json({ ok: true });
    },
    'business',
  );
  router.get(
    '/cash/entries',
    async (c) => {
      cashAccess(who(c));
      const { start, end } = dates(c),
        db = c.env.db,
        scope = ownShift(c),
        cursor = c.url.searchParams.get('before'),
        before = cursor ? posText(cursor, 80) : null;
      const [manual, receipts] = await Promise.all([
        db
          .select({
            id: cashEntries.id,
            entryNo: cashEntries.entryNo,
            shiftId: cashEntries.shiftId,
            at: cashEntries.createdAt,
            kind: cashEntries.kind,
            direction: cashEntries.direction,
            amount: cashEntries.amount,
            reason: cashEntries.reason,
            status: cashEntries.status,
            createdBy: cashEntries.createdBy,
            by: employees.name,
            voidReason: cashEntries.voidReason,
            voidedAt: cashEntries.voidedAt,
            photo: cashEntries.photoFileKey,
            reconciliationId: cashEntries.reconciliationId,
          })
          .from(cashEntries)
          .innerJoin(posShifts, eq(posShifts.id, cashEntries.shiftId))
          .innerJoin(employees, eq(employees.id, cashEntries.createdBy))
          .where(
            and(
              scope,
              gte(cashEntries.createdAt, start),
              lt(cashEntries.createdAt, end),
              before ? sql`(${cashEntries.createdAt} || '|' || ${cashEntries.id}) < ${before}` : undefined,
            ),
          )
          .orderBy(desc(cashEntries.createdAt), desc(cashEntries.id))
          .limit(101),
        db
          .select({
            id: customerPayments.id,
            entryNo: salesOrders.orderNo,
            shiftId: customerPayments.shiftId,
            at: customerPayments.createdAt,
            source: customerPayments.paymentSource,
            amount: customerPayments.amount,
            reason: customerPayments.note,
            createdBy: customerPayments.createdBy,
            by: employees.name,
            voidReason: customerPayments.voidReason,
            voidedAt: customerPayments.voidedAt,
          })
          .from(customerPayments)
          .innerJoin(posShifts, eq(posShifts.id, customerPayments.shiftId))
          .innerJoin(salesOrders, eq(salesOrders.id, customerPayments.orderId))
          .innerJoin(employees, eq(employees.id, customerPayments.createdBy))
          .where(
            and(
              scope,
              eq(customerPayments.method, 'cash'),
              gte(customerPayments.createdAt, start),
              lt(customerPayments.createdAt, end),
              before ? sql`(${customerPayments.createdAt} || '|' || ${customerPayments.id}) < ${before}` : undefined,
            ),
          )
          .orderBy(desc(customerPayments.createdAt), desc(customerPayments.id))
          .limit(101),
      ]);
      const entries = [
        ...manual.map((r) => ({ ...r, source: 'manual', hasPhoto: !!r.photo, photo: undefined })),
        ...receipts.map((r) => ({
          ...r,
          source: 'payment',
          direction: 'in',
          kind: r.source === 'cod' ? 'cod' : 'sale',
          status: r.voidedAt ? 'voided' : 'posted',
          hasPhoto: false,
        })),
      ].sort((a, b) => (b.at + '|' + b.id).localeCompare(a.at + '|' + a.id));
      const page = entries.slice(0, 100),
        last = page.at(-1);
      return json({ entries: page, nextBefore: entries.length > 100 && last ? last.at + '|' + last.id : null });
    },
    'business',
  );
  router.get(
    '/cash/entries/:id/photo',
    async (c) => {
      cashAccess(who(c));
      const [e] = await c.env.db
        .select({ key: cashEntries.photoFileKey })
        .from(cashEntries)
        .innerJoin(posShifts, eq(posShifts.id, cashEntries.shiftId))
        .where(and(eq(cashEntries.id, c.params.id!), ownShift(c)));
      if (!e?.key) throw new AppError(404, 'Không có ảnh.');
      if (!c.env.files) throw new AppError(503, 'Chưa có kho file.');
      return json({ url: (await c.env.files.signedUrls([e.key], 600)).get(e.key) ?? null });
    },
    'business',
  );
  router.post(
    '/cash/entries',
    async (c) => {
      cashAccess(who(c));
      const b = await readJson(c.req, 820000),
        input = cashEntryInput(b),
        key = posKey(b.key);
      if (input.kind === 'adjustment') manager(c);
      else if (!can(who(c), 'pos.sell')) throw new AppError(403, 'Chưa có quyền tạo phiếu trong ca.');
      if (b.photo !== undefined && typeof b.photo !== 'string') throw new AppError(400, 'Chỉ chọn một ảnh.');
      const photos = parsePhotos(b.photo ? [b.photo] : []);
      let uploaded: string | null = null;
      try {
        const result = await c.env.db.transaction(async (tx) => {
          await cashLock(tx);
          const [prior] = await tx.select().from(cashEntries).where(eq(cashEntries.requestKey, key));
          if (prior) {
            if (
              prior.createdBy !== who(c).id ||
              prior.amount !== input.amount ||
              prior.kind !== input.kind ||
              prior.reason !== input.reason ||
              prior.direction !== input.direction ||
              prior.reconciliationId !== (posText(b.reconciliationId) || null)
            )
              throw new AppError(409, 'Mã giao dịch đã dùng cho phiếu khác.');
            return { ...prior, replayed: true };
          }
          const d = await drawerOf(tx),
            [s] = await tx
              .select()
              .from(posShifts)
              .where(and(eq(posShifts.cashDrawerId, d.id), isNull(posShifts.closedAt)));
          if (!s || (input.kind !== 'adjustment' && s.memberId !== who(c).id))
            throw new AppError(409, 'Bạn cần có ca đang mở để tạo phiếu.');
          const reconciliationId = posText(b.reconciliationId) || null;
          if (reconciliationId) {
            const [r] = await tx
              .select()
              .from(cashReconciliations)
              .where(and(eq(cashReconciliations.id, reconciliationId), eq(cashReconciliations.drawerId, d.id)));
            if (!r) throw new AppError(400, 'Mã tra soát không hợp lệ.');
          }
          const id = crypto.randomUUID(),
            now = cashNow(),
            [num] = await tx.select({ n: count() }).from(cashEntries),
            entryNo = (input.direction === 'in' ? 'PT-' : 'PC-') + String((num?.n ?? 0) + 1).padStart(6, '0');
          if (photos.length) {
            if (!c.env.files) throw new AppError(503, 'Chưa cấu hình kho ảnh.');
            const p = photos[0]!;
            uploaded = `cash-photos/${id}.${p.ext}`;
            await c.env.files.put(uploaded, p.bytes, p.mime);
          }
          const [e] = await tx
            .insert(cashEntries)
            .values({
              id,
              entryNo,
              drawerId: d.id,
              shiftId: s.id,
              ...input,
              photoFileKey: uploaded,
              status: input.amount >= d.approvalThreshold ? 'pending' : 'posted',
              approvalThresholdSnapshot: d.approvalThreshold,
              createdBy: who(c).id,
              createdAt: now,
              updatedAt: now,
              requestKey: key,
              reconciliationId,
            })
            .returning();
          await cashAudit(tx, who(c).id, 'create', 'cash-entries', id, {
            ...input,
            shiftId: s.id,
            status: e!.status,
            entryNo,
            reconciliationId,
          });
          return { ...e!, replayed: false };
        });
        return json({ ...result, photoFileKey: undefined }, 201);
      } catch (e) {
        if (uploaded && c.env.files) await c.env.files.remove([uploaded]).catch(() => {});
        throw e;
      }
    },
    'business',
  );
  router.post(
    '/cash/entries/:id/approve',
    async (c) => {
      manager(c);
      await c.env.db.transaction(async (tx) => {
        await cashLock(tx);
        const [e] = await tx.select().from(cashEntries).where(eq(cashEntries.id, c.params.id!));
        if (!e) throw new AppError(404, 'Không có phiếu.');
        if (e.createdBy === who(c).id) throw new AppError(403, 'Không tự duyệt phiếu của mình.');
        if (e.status === 'posted') return;
        if (e.status !== 'pending') throw new AppError(409, 'Phiếu đã huỷ.');
        const [s] = await tx.select().from(posShifts).where(eq(posShifts.id, e.shiftId));
        if (s?.closedAt) throw new AppError(409, 'Ca đã kết.');
        const now = cashNow();
        await tx
          .update(cashEntries)
          .set({ status: 'posted', approvedBy: who(c).id, approvedAt: now, updatedAt: now })
          .where(eq(cashEntries.id, e.id));
        await cashAudit(tx, who(c).id, 'approve', 'cash-entries', e.id, { shiftId: e.shiftId });
      });
      return json({ ok: true });
    },
    'business',
  );
  router.post(
    '/cash/entries/:id/void',
    async (c) => {
      cashAccess(who(c));
      if (!can(who(c), 'payments.void')) throw new AppError(403, 'Chỉ Manager hoặc quyền Huỷ phiếu thu được huỷ.');
      const b = await readJson(c.req, 4000),
        reason = posText(b.reason, 2000);
      if (!reason) throw new AppError(400, 'Nhập lý do huỷ.');
      await c.env.db.transaction(async (tx) => {
        await cashLock(tx);
        const [e] = await tx.select().from(cashEntries).where(eq(cashEntries.id, c.params.id!));
        if (!e) throw new AppError(404, 'Không có phiếu.');
        if (e.status === 'voided') return;
        const now = cashNow();
        await tx
          .update(cashEntries)
          .set({ status: 'voided', voidedBy: who(c).id, voidedAt: now, voidReason: reason, updatedAt: now })
          .where(eq(cashEntries.id, e.id));
        if (e.status === 'posted') await voidClosedCashEffect(tx, e.shiftId, who(c).id, `${e.entryNo}: ${reason}`);
        await cashAudit(tx, who(c).id, 'void', 'cash-entries', e.id, { reason, shiftId: e.shiftId });
      });
      return json({ ok: true });
    },
    'business',
  );
  router.get(
    '/cash/shifts',
    async (c) => {
      cashAccess(who(c));
      const offset = Math.max(0, Math.floor(Number(c.url.searchParams.get('offset')) || 0));
      const list = await c.env.db
        .select({ s: posShifts, memberName: employees.name })
        .from(posShifts)
        .innerJoin(employees, eq(employees.id, posShifts.memberId))
        .where(ownShift(c))
        .orderBy(desc(posShifts.openedAt), desc(posShifts.id))
        .limit(51)
        .offset(offset);
      return json({
        items: list.slice(0, 50).map((x) => ({ ...x.s, reportSnapshot: undefined, memberName: x.memberName })),
        nextOffset: list.length > 50 ? offset + 50 : null,
      });
    },
    'business',
  );
  router.get(
    '/cash/shifts/:id',
    async (c) => {
      cashAccess(who(c));
      const [s] = await c.env.db
        .select()
        .from(posShifts)
        .where(and(eq(posShifts.id, c.params.id!), ownShift(c)));
      if (!s) throw new AppError(404, 'Không có ca.');
      return json(s.reportSnapshot ? JSON.parse(s.reportSnapshot) : await shiftReport(c.env.db, s));
    },
    'business',
  );
  router.post(
    '/cash/shifts/:id/close',
    async (c) => {
      cashAccess(who(c));
      const b = await readJson(c.req, 5000);
      return json(await c.env.db.transaction((tx) => closeCashShift(tx, who(c), c.params.id!, b, shiftReport)));
    },
    'business',
  );
  router.get(
    '/cash/reconciliations',
    async (c) => {
      cashAccess(who(c));
      const offset = Math.max(0, Math.floor(Number(c.url.searchParams.get('offset')) || 0));
      const list = await c.env.db
        .select({ r: cashReconciliations, memberName: employees.name })
        .from(cashReconciliations)
        .innerJoin(posShifts, eq(posShifts.id, cashReconciliations.shiftId))
        .innerJoin(employees, eq(employees.id, posShifts.memberId))
        .where(ownShift(c))
        .orderBy(desc(cashReconciliations.updatedAt), desc(cashReconciliations.id))
        .limit(51)
        .offset(offset);
      return json({
        items: list.slice(0, 50).map((x) => ({ ...x.r, memberName: x.memberName })),
        nextOffset: list.length > 50 ? offset + 50 : null,
      });
    },
    'business',
  );
  router.get(
    '/cash/reconciliations/:id',
    async (c) => {
      cashAccess(who(c));
      const db = c.env.db,
        [found] = await db
          .select({ r: cashReconciliations, memberName: employees.name })
          .from(cashReconciliations)
          .innerJoin(posShifts, eq(posShifts.id, cashReconciliations.shiftId))
          .innerJoin(employees, eq(employees.id, posShifts.memberId))
          .where(and(eq(cashReconciliations.id, c.params.id!), ownShift(c)));
      if (!found) throw new AppError(404, 'Không có tra soát.');
      const [entries, payments, audit] = await Promise.all([
        db
          .select({
            id: cashEntries.id,
            entryNo: cashEntries.entryNo,
            amount: cashEntries.amount,
            reason: cashEntries.reason,
            status: cashEntries.status,
          })
          .from(cashEntries)
          .where(eq(cashEntries.shiftId, found.r.shiftId))
          .orderBy(asc(cashEntries.createdAt))
          .limit(500),
        db
          .select({ id: customerPayments.id, amount: customerPayments.amount, reason: customerPayments.note })
          .from(customerPayments)
          .where(and(eq(customerPayments.shiftId, found.r.shiftId), eq(customerPayments.method, 'cash')))
          .limit(500),
        db
          .select({ at: auditLogs.createdAt, action: auditLogs.action, by: employees.name })
          .from(auditLogs)
          .leftJoin(employees, eq(employees.id, auditLogs.actorId))
          .where(sql`${auditLogs.entityId} in (${found.r.id},${found.r.shiftId})`)
          .orderBy(desc(auditLogs.createdAt))
          .limit(100),
      ]);
      return json({ item: found.r, memberName: found.memberName, entries: [...entries, ...payments], audit });
    },
    'business',
  );
  router.post(
    '/cash/reconciliations/:id/explain',
    async (c) => {
      cashAccess(who(c));
      const b = await readJson(c.req, 6000),
        explanation = posText(b.explanation, 4000);
      if (!explanation) throw new AppError(400, 'Nhập giải trình.');
      await c.env.db.transaction(async (tx) => {
        await cashLock(tx);
        const [r] = await tx
          .select({ r: cashReconciliations, memberId: posShifts.memberId })
          .from(cashReconciliations)
          .innerJoin(posShifts, eq(posShifts.id, cashReconciliations.shiftId))
          .where(eq(cashReconciliations.id, c.params.id!));
        if (!r || r.memberId !== who(c).id) throw new AppError(404, 'Không có tra soát của bạn.');
        if (r.r.status === 'closed') throw new AppError(409, 'Tra soát đã đóng.');
        const now = cashNow();
        await tx
          .update(cashReconciliations)
          .set({ explanation, explainedBy: who(c).id, explainedAt: now, status: 'explained', updatedAt: now })
          .where(eq(cashReconciliations.id, r.r.id));
        await cashAudit(tx, who(c).id, 'explain', 'cash-reconciliations', r.r.id, { explanation });
      });
      return json({ ok: true });
    },
    'business',
  );
  router.post(
    '/cash/reconciliations/:id/close',
    async (c) => {
      manager(c);
      const b = await readJson(c.req, 6000),
        reason = posText(b.reason, 4000);
      if (!reason) throw new AppError(400, 'Nhập lý do đóng tra soát.');
      await c.env.db.transaction(async (tx) => {
        await cashLock(tx);
        const [r] = await tx.select().from(cashReconciliations).where(eq(cashReconciliations.id, c.params.id!));
        if (!r) throw new AppError(404, 'Không có tra soát.');
        if (r.status === 'closed') return;
        if (r.status !== 'explained') throw new AppError(409, 'Cần nhân viên giải trình trước khi đóng.');
        const now = cashNow();
        await tx
          .update(cashReconciliations)
          .set({ status: 'closed', closeReason: reason, resolvedBy: who(c).id, resolvedAt: now, updatedAt: now })
          .where(eq(cashReconciliations.id, r.id));
        await cashAudit(tx, who(c).id, 'close', 'cash-reconciliations', r.id, { reason });
      });
      return json({ ok: true });
    },
    'business',
  );
}
