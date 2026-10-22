import { notifyCashApproval, notifyCashApprovers } from '../modules/sales/api/cash-approval-notification.ts';
import { cashTasksChanged } from '../modules/sales/api/invoice-task-hooks.ts';
import { allowedRegister, allowedDrawer, posScope } from '../modules/sales/api/pos-access.ts';
import { auditLogs } from '../core/db/schema.ts';
import { and, asc, count, desc, eq, gte, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import type { Router, RouteContext } from '../core/http/router.ts';
import { json, readJson } from '../core/http/router.ts';
import { AppError } from '../core/errors.ts';
import type { StaffEnv, SessionState } from '../modules/staff/api/auth-routes.ts';
import { employees, positions } from '../modules/staff/schema.ts';
import { defaultPosRegister } from '../modules/sales/domain/pos-register.ts';
import { can, canApprove } from '../modules/staff/domain/permissions.ts';
import { cashDrawers, cashEntries, cashReconciliations } from '../modules/sales/cash-schema.ts';
import { posRegisters, posShifts } from '../modules/sales/pos-schema.ts';
import { customerPayments, salesOrders } from '../modules/sales/schema.ts';
import { posKey, posText, shiftReport } from '../modules/sales/api/pos-store.ts';
import { sendPosShiftReport } from '../modules/sales/api/pos-shift-report-webhook.ts';
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
  openingCashComparison,
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
const storeShift = (c: Ctx) => posScope(c) ? inArray(posShifts.registerId, posScope(c)!.registers) : undefined;
const ownShift = (c: Ctx) => and(storeShift(c), seesAllCash(who(c)) ? undefined : eq(posShifts.memberId, who(c).id));
// Delegated approval reveals pending manual entries only, not other employees' receipts or reports.
const entryScope = (c: Ctx) => {
  const scope = ownShift(c);
  return scope ? and(storeShift(c), or(scope, canApprove(who(c)) ? eq(cashEntries.status, 'pending') : undefined)) : undefined;
};
async function selectedDrawer(c: Ctx) {
  const explicit = posText(c.url.searchParams.get('drawerId'));
  if (explicit) return (await drawerOf(c.env.db, explicit)).id;
  const registerId = posText(c.url.searchParams.get('registerId'));
  const regs = (await c.env.db.select().from(posRegisters).where(eq(posRegisters.active, true)).orderBy(asc(posRegisters.name))).filter(r => allowedRegister(c, r.id));
  if (posScope(c) && !regs.length) throw new AppError(403, 'Chưa có quầy thuộc cửa hàng của bạn.');
  if (registerId) {
    const r = regs.find(r => r.id === registerId);
    if (!r) throw new AppError(404, 'Không tìm thấy quầy.');
    if (!allowedDrawer(c, r.cashDrawerId)) throw new AppError(403, 'Két chưa tách riêng theo cửa hàng. Liên hệ Manager.');
    return r.cashDrawerId;
  }
  const [current] = await c.env.db.select().from(posShifts).where(and(eq(posShifts.memberId, who(c).id), isNull(posShifts.closedAt))).limit(1);
  if (current && allowedRegister(c, current.registerId) && allowedDrawer(c, current.cashDrawerId)) return current.cashDrawerId;
  const [position] = await c.env.db.select({ name: positions.name }).from(positions).where(eq(positions.id, who(c).positionId ?? '')).limit(1);
  const preferred = defaultPosRegister(who(c).positionId, position?.name, regs);
  const drawerId = regs.find(r => r.id === preferred)?.cashDrawerId ?? regs[0]?.cashDrawerId ?? CASH_DRAWER;
  if (!allowedDrawer(c, drawerId)) throw new AppError(403, 'Két chưa tách riêng theo cửa hàng. Liên hệ Manager.');
  return drawerId;
}
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
  router.post('/cash/drawers', async (c) => {
    manager(c);
    const b = await readJson(c.req, 4000),
      id = posKey(b.key), name = posText(b.name, 100), registerId = posText(b.registerId);
    if (!name || !registerId) throw new AppError(400, 'Nhập tên két và chọn quầy.');
    await c.env.db.transaction(async tx => {
      await cashLock(tx);
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'pos-register:' + registerId}))`);
      const [r] = await tx.select().from(posRegisters).where(and(eq(posRegisters.id, registerId), eq(posRegisters.active, true)));
      if (!r) throw new AppError(404, 'Không tìm thấy quầy.');
      const [existing] = await tx.select().from(cashDrawers).where(eq(cashDrawers.id, id));
      if (existing) {
        if (existing.name !== name || r.cashDrawerId !== id) throw new AppError(409, 'Mã tạo két đã dùng.');
        return;
      }
      const [history] = await tx.select({ id: posShifts.id }).from(posShifts).where(eq(posShifts.registerId, registerId)).limit(1);
      if (history) throw new AppError(409, 'Quầy đã có ca; không đổi két để giữ lịch sử tiền và bàn giao.');
      const linked = await tx.select({ id: posRegisters.id }).from(posRegisters).where(eq(posRegisters.cashDrawerId, r.cashDrawerId));
      if (linked.length < 2 && r.cashDrawerId !== CASH_DRAWER) throw new AppError(409, 'Quầy đã có két riêng; dùng Cấu hình két để đổi tên hoặc nhập đầu kỳ.');
      const now = cashNow();
      await tx.insert(cashDrawers).values({ id, name, updatedAt: now, updatedBy: who(c).id });
      await tx.update(posRegisters).set({ cashDrawerId: id, updatedAt: now, updatedBy: who(c).id }).where(eq(posRegisters.id, registerId));
      await cashAudit(tx, who(c).id, 'split-drawer', 'cash-drawers', id, { name, registerId, previousDrawerId: r.cashDrawerId });
    });
    return json({ id }, 201);
  }, 'business');
  router.get(
    '/cash',
    async (c) => {
      cashAccess(who(c));
      const db = c.env.db,
        d = await drawerOf(db, await selectedDrawer(c)),
        [s] = await db
          .select({ s: posShifts, memberName: employees.name })
          .from(posShifts)
          .innerJoin(employees, eq(employees.id, posShifts.memberId))
          .where(and(storeShift(c), eq(posShifts.cashDrawerId, d.id), isNull(posShifts.closedAt)))
          .limit(1),
        [last] = await db
          .select()
          .from(posShifts)
          .where(and(storeShift(c), eq(posShifts.cashDrawerId, d.id), sql`${posShifts.closedAt} is not null`))
          .orderBy(desc(posShifts.closedAt))
          .limit(1),
        [open] = await db
          .select({ count: count() })
          .from(cashReconciliations)
          .innerJoin(posShifts, eq(posShifts.id, cashReconciliations.shiftId))
          .where(and(eq(cashReconciliations.drawerId, d.id), ownShift(c), sql`${cashReconciliations.status}<>'closed'`));
      return json({
        drawer: d,
        drawers: (await db.select({ id: cashDrawers.id, name: cashDrawers.name }).from(cashDrawers).where(or(
          inArray(cashDrawers.id, db.select({ id: posRegisters.cashDrawerId }).from(posRegisters).where(eq(posRegisters.active, true))),
          inArray(cashDrawers.id, db.select({ id: posShifts.cashDrawerId }).from(posShifts)),
        )).orderBy(asc(cashDrawers.name))).filter(d => allowedDrawer(c, d.id)),
        registers: (await db.select({ id: posRegisters.id, name: posRegisters.name, cashDrawerId: posRegisters.cashDrawerId }).from(posRegisters).where(eq(posRegisters.active, true))).filter(r => allowedRegister(c, r.id)),
        balance: await drawerBalance(db, d.id),
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
        canApprove: canApprove(who(c)),
        canSelfApprove: who(c).role === 'manager',
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
      const b = await readJson(c.req, 4000), drawerId = await selectedDrawer(c);
      await c.env.db.transaction(async (tx) => {
        await cashLock(tx);
        const d = await drawerOf(tx, drawerId);
        const fields: {
          approvalThreshold?: number;
          name?: string;
          openingAmount?: number;
          openingReason?: string;
          openingSetAt?: string;
          openingSetBy?: string;
          updatedAt: string;
          updatedBy: string;
        } = { updatedAt: cashNow(), updatedBy: who(c).id };
        if (b.name !== undefined) {
          fields.name = posText(b.name, 100);
          if (!fields.name) throw new AppError(400, 'Nhập tên két.');
        }
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
      const drawerId = await selectedDrawer(c);
      const { start, end } = dates(c),
        db = c.env.db,
        scope = ownShift(c),
        cursor = c.url.searchParams.get('before'),
        before = cursor ? posText(cursor, 80) : null;
      const creator = c.url.searchParams.get('createdBy') ?? '', method = c.url.searchParams.get('method') ?? 'cash', direction = c.url.searchParams.get('direction') ?? '';
      if (!['cash', 'transfer', 'other', 'all'].includes(method) || !['', 'in', 'out'].includes(direction) || creator.length > 120) throw new AppError(400, 'Bộ lọc Sổ quỹ không hợp lệ.');
      const manualBase = and(entryScope(c), eq(cashEntries.drawerId, drawerId), gte(cashEntries.createdAt, start), lt(cashEntries.createdAt, end));
      const receiptBase = and(scope, eq(posShifts.cashDrawerId, drawerId), gte(customerPayments.createdAt, start), lt(customerPayments.createdAt, end));
      const manualWhere = and(
          manualBase, creator ? eq(cashEntries.createdBy, creator) : undefined, direction ? eq(cashEntries.direction, direction) : undefined, !['cash', 'all'].includes(method) ? sql`false` : undefined,
        ),
        receiptWhere = and(
          receiptBase, creator ? eq(customerPayments.createdBy, creator) : undefined, method === 'all' ? undefined : eq(customerPayments.method, method as 'cash' | 'transfer' | 'other'), direction === 'out' ? sql`false` : undefined,
        );
      const [manual, receipts, manualPeriod, receiptPeriod, manualPeople, paymentPeople] = await Promise.all([
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
              manualWhere,
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
            method: customerPayments.method,
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
              receiptWhere,
              before ? sql`(${customerPayments.createdAt} || '|' || ${customerPayments.id}) < ${before}` : undefined,
            ),
          )
          .orderBy(desc(customerPayments.createdAt), desc(customerPayments.id))
          .limit(101),
        db.select({ direction: cashEntries.direction, amount: cashEntries.amount, status: cashEntries.status })
          .from(cashEntries).innerJoin(posShifts, eq(posShifts.id, cashEntries.shiftId)).where(manualWhere),
        db.select({ amount: customerPayments.amount, voidedAt: customerPayments.voidedAt })
          .from(customerPayments).innerJoin(posShifts, eq(posShifts.id, customerPayments.shiftId)).where(receiptWhere),
        db.selectDistinct({ id: employees.id, name: employees.name }).from(cashEntries)
          .innerJoin(posShifts, eq(posShifts.id, cashEntries.shiftId)).innerJoin(employees, eq(employees.id, cashEntries.createdBy)).where(manualBase),
        db.selectDistinct({ id: employees.id, name: employees.name }).from(customerPayments)
          .innerJoin(posShifts, eq(posShifts.id, customerPayments.shiftId)).innerJoin(employees, eq(employees.id, customerPayments.createdBy)).where(receiptBase),
      ]);
      const entries = [
        ...manual.map((r) => ({ ...r, source: 'manual', method: 'cash', hasPhoto: !!r.photo, photo: undefined })),
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
      const postedManual = manualPeriod.filter(x => x.status === 'posted');
      const totalIn = postedManual.filter(x => x.direction === 'in').reduce((n, x) => n + x.amount, 0)
        + receiptPeriod.filter(x => !x.voidedAt).reduce((n, x) => n + x.amount, 0);
      const totalOut = postedManual.filter(x => x.direction === 'out').reduce((n, x) => n + x.amount, 0);
      return json({ entries: page, nextBefore: entries.length > 100 && last ? last.at + '|' + last.id : null,
        employees: [...new Map([...manualPeople, ...paymentPeople].map(p => [p.id, p])).values()].sort((a, b) => a.name.localeCompare(b.name)),
        totals: { in: totalIn, out: totalOut, net: totalIn - totalOut } });
    },
    'business',
  );
  router.get('/cash/entries/:id', async c => {
    cashAccess(who(c));
    const drawerId = await selectedDrawer(c);
    const [row] = await c.env.db.select({ entry: cashEntries, by: employees.name }).from(cashEntries)
      .innerJoin(posShifts, eq(posShifts.id, cashEntries.shiftId)).innerJoin(employees, eq(employees.id, cashEntries.createdBy))
      .where(and(eq(cashEntries.id, c.params.id!), eq(cashEntries.drawerId, drawerId), entryScope(c))).limit(1);
    if (!row) throw new AppError(404, 'Không có phiếu hoặc bạn không có quyền xem.');
    return json({ entry: { ...row.entry, by: row.by, at: row.entry.createdAt, photo: row.entry.photoFileKey ? true : null, photoFileKey: undefined } });
  }, 'business');
  router.get(
    '/cash/entries/:id/photo',
    async (c) => {
      cashAccess(who(c));
      const [e] = await c.env.db
        .select({ key: cashEntries.photoFileKey })
        .from(cashEntries)
        .innerJoin(posShifts, eq(posShifts.id, cashEntries.shiftId))
        .where(and(eq(cashEntries.id, c.params.id!), entryScope(c)));
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
      const drawerId = await selectedDrawer(c);
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
              prior.drawerId !== drawerId ||
              prior.amount !== input.amount ||
              prior.kind !== input.kind ||
              prior.reason !== input.reason ||
              prior.direction !== input.direction ||
              prior.reconciliationId !== (posText(b.reconciliationId) || null)
            )
              throw new AppError(409, 'Mã giao dịch đã dùng cho phiếu khác.');
            return { ...prior, replayed: true };
          }
          const d = await drawerOf(tx, drawerId),
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
        if (!result.replayed && result.status === 'pending')
          await notifyCashApproval(c.env, result).catch(error => console.warn('cash approval notification failed', error instanceof Error ? error.message : 'unknown error'));
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
      cashAccess(who(c));
      if (!canApprove(who(c))) throw new AppError(403, 'Chỉ Manager hoặc người được Manager chỉ định duyệt phiếu.');
      await c.env.db.transaction(async (tx) => {
        await cashLock(tx);
        const [e] = await tx.select().from(cashEntries).where(eq(cashEntries.id, c.params.id!));
        // Chỉ duyệt / huỷ phiếu của két, quầy thuộc cửa hàng mình (như các route xem danh sách) – không thao tác chéo cửa hàng.
        const [owner] = e ? await tx.select({ registerId: posShifts.registerId }).from(posShifts).where(eq(posShifts.id, e.shiftId)) : [];
        if (!e || !allowedDrawer(c, e.drawerId) || (owner && !allowedRegister(c, owner.registerId))) throw new AppError(404, 'Không có phiếu.');
        if (e.createdBy === who(c).id && who(c).role !== 'manager') throw new AppError(403, 'Chỉ Manager được tự duyệt phiếu của mình.');
        if (e.status === 'posted') return;
        if (e.status !== 'pending') throw new AppError(409, 'Phiếu đã huỷ.');
        const [s] = await tx.select().from(posShifts).where(eq(posShifts.id, e.shiftId));
        if (s?.closedAt) throw new AppError(409, 'Ca đã kết.');
        const now = cashNow();
        await tx
          .update(cashEntries)
          .set({ status: 'posted', approvedBy: who(c).id, approvedAt: now, updatedAt: now })
          .where(eq(cashEntries.id, e.id));
        await cashAudit(tx, who(c).id, 'approve', 'cash-entries', e.id, { shiftId: e.shiftId, selfApproved: e.createdBy === who(c).id });
      });
      await cashTasksChanged(c.env);
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
        // Chỉ duyệt / huỷ phiếu của két, quầy thuộc cửa hàng mình (như các route xem danh sách) – không thao tác chéo cửa hàng.
        const [owner] = e ? await tx.select({ registerId: posShifts.registerId }).from(posShifts).where(eq(posShifts.id, e.shiftId)) : [];
        if (!e || !allowedDrawer(c, e.drawerId) || (owner && !allowedRegister(c, owner.registerId))) throw new AppError(404, 'Không có phiếu.');
        if (e.kind === 'customer_refund') throw new AppError(409, 'Phiếu hoàn tiền đã xác nhận thực trả, không huỷ như phiếu ghi nhầm.');
        if (e.status === 'voided') return;
        const now = cashNow();
        await tx
          .update(cashEntries)
          .set({ status: 'voided', voidedBy: who(c).id, voidedAt: now, voidReason: reason, updatedAt: now })
          .where(eq(cashEntries.id, e.id));
        if (e.status === 'posted') await voidClosedCashEffect(tx, e.shiftId, who(c).id, `${e.entryNo}: ${reason}`);
        await cashAudit(tx, who(c).id, 'void', 'cash-entries', e.id, { reason, shiftId: e.shiftId });
      });
      await cashTasksChanged(c.env);
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
        .where(and(ownShift(c), eq(posShifts.cashDrawerId, await selectedDrawer(c))))
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
      const member = who(c);
      cashAccess(member);
      const b = await readJson(c.req, 5000);
      const result = await c.env.db.transaction((tx) => closeCashShift(tx, member, c.params.id!, b, shiftReport));
      // Kết ca ở Sổ quỹ cũng báo người duyệt khi lệch tiền (như kết ca ở Bán hàng nhanh) và cập nhật việc Sổ quỹ ngay.
      if (!result.replayed && result.cashDifference)
        await notifyCashApprovers(c.env, result.shift.cashDrawerId, member.id, {
          eventType: 'pos_shift_difference',
          title: 'Kết ca lệch tiền mặt',
          body: `${member.name}: ${result.cashDifference.toLocaleString('vi-VN')} đ. ${result.differenceReason}`,
          url: '/index.html#/cash?drawerId=' + encodeURIComponent(result.shift.cashDrawerId),
          data: { shiftId: result.shift.id },
        }).catch(error => console.warn('shift difference notification failed', error instanceof Error ? error.message : 'unknown error'));
      else if (!result.replayed) await cashTasksChanged(c.env);
      if (!result.replayed && c.env.posShiftReportWebhook) {
        const task = sendPosShiftReport(c.env, result).catch((error) =>
          console.error('POS_SHIFT_REPORT_WEBHOOK_FAILED', result.shift?.id, error instanceof Error ? error.message : error),
        );
        if (c.env.waitUntil) c.env.waitUntil(task); else await task;
      }
      return json(result);
    },
    'business',
  );
  router.get(
    '/cash/reconciliations',
    async (c) => {
      cashAccess(who(c));
      const offset = Math.max(0, Math.floor(Number(c.url.searchParams.get('offset')) || 0));
      // status: open (chờ giải trình / chờ đóng – mặc định) · closed · all.
      const status = c.url.searchParams.get('status'), scope = and(ownShift(c), eq(cashReconciliations.drawerId, await selectedDrawer(c)));
      const byStatus = status === 'closed' ? eq(cashReconciliations.status, 'closed') : status === 'all' ? undefined : inArray(cashReconciliations.status, ['pending', 'explained']);
      const [list, counts] = await Promise.all([
        c.env.db
          .select({ r: cashReconciliations, memberName: employees.name, memberId: posShifts.memberId, businessDate: posShifts.businessDate })
          .from(cashReconciliations)
          .innerJoin(posShifts, eq(posShifts.id, cashReconciliations.shiftId))
          .innerJoin(employees, eq(employees.id, posShifts.memberId))
          .where(and(scope, byStatus))
          .orderBy(desc(cashReconciliations.createdAt), desc(cashReconciliations.id))
          .limit(51)
          .offset(offset),
        c.env.db
          .select({ status: cashReconciliations.status, n: count() })
          .from(cashReconciliations)
          .innerJoin(posShifts, eq(posShifts.id, cashReconciliations.shiftId))
          .where(scope)
          .groupBy(cashReconciliations.status),
      ]);
      const n = (k: string) => counts.find((x) => x.status === k)?.n ?? 0;
      return json({
        items: list.slice(0, 50).map((x) => ({ ...x.r, memberName: x.memberName, memberId: x.memberId, businessDate: x.businessDate })),
        nextOffset: list.length > 50 ? offset + 50 : null,
        counts: { pending: n('pending'), explained: n('explained'), closed: n('closed'), open: n('pending') + n('explained') },
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
          .select({ r: cashReconciliations, memberName: employees.name, memberId: posShifts.memberId, businessDate: posShifts.businessDate, openedAt: posShifts.openedAt, closedAt: posShifts.closedAt })
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
            kind: cashEntries.kind,
            direction: cashEntries.direction,
            amount: cashEntries.amount,
            reason: cashEntries.reason,
            status: cashEntries.status,
          })
          .from(cashEntries)
          .where(eq(cashEntries.shiftId, found.r.shiftId))
          .orderBy(asc(cashEntries.createdAt))
          .limit(500),
        db
          .select({ id: customerPayments.id, amount: customerPayments.amount, reason: customerPayments.note, kind: sql<string>`'sale'`, direction: sql<string>`'in'`, status: sql<string>`case when ${customerPayments.voidedAt} is null then 'posted' else 'voided' end` })
          .from(customerPayments)
          .where(and(eq(customerPayments.shiftId, found.r.shiftId), eq(customerPayments.method, 'cash')))
          .limit(500),
        db
          .select({ at: auditLogs.createdAt, action: auditLogs.action, entityType: auditLogs.entityType, by: employees.name })
          .from(auditLogs)
          .leftJoin(employees, eq(employees.id, auditLogs.actorId))
          .where(sql`${auditLogs.entityId} in (${found.r.id},${found.r.shiftId})`)
          .orderBy(desc(auditLogs.createdAt))
          .limit(100),
      ]);
      const names = new Map((await db.select({ id: employees.id, name: employees.name }).from(employees)
        .where(inArray(employees.id, [found.r.explainedBy, found.r.resolvedBy, found.r.closedBy].filter((x): x is string => !!x).concat('')))).map((e) => [e.id, e.name]));
      return json({
        openingComparison: await openingCashComparison(db, found.r.shiftId), item: found.r, memberName: found.memberName, memberId: found.memberId,
        shift: { businessDate: found.businessDate, openedAt: found.openedAt, closedAt: found.closedAt },
        names: { explainedBy: names.get(found.r.explainedBy ?? '') ?? '', resolvedBy: names.get(found.r.resolvedBy ?? '') ?? '', closedBy: names.get(found.r.closedBy) ?? '' },
        entries: [...entries, ...payments], audit,
      });
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
      await cashTasksChanged(c.env);
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
      await cashTasksChanged(c.env);
      return json({ ok: true });
    },
    'business',
  );
}
