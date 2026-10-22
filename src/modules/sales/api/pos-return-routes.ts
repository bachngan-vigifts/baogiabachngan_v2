import { flowIssued } from './pos-order-flow-guards.ts';
import { saleFlowOf } from '../domain/pos-order-flow.ts';
import {
  posOrderReservations,
  posPaymentIntents,
} from '../pos-order-flow-schema.ts';
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { Router, RouteContext } from '../../../core/http/router.ts';
import { json, readJson } from '../../../core/http/router.ts';
import { AppError } from '../../../core/errors.ts';
import type { StaffEnv, SessionState } from '../../staff/api/auth-routes.ts';
import { can, canApprove } from '../../staff/domain/permissions.ts';
import { employees } from '../../staff/schema.ts';
import { allowedRegister, allowedDrawer } from './pos-access.ts';
import { allowedPosRegisters, assertSellRegister } from './pos-register-scope.ts';
import { cashAudit, cashLock, type CashDb } from './cash-store.ts';
import {
  assertOpen,
  saleShiftOf,
  posKey,
  posText,
  posPermission,
} from './pos-store.ts';
import {
  returnAccount,
  activeReservations,
  allocationProtected,
} from './pos-return-credit.ts';
import { posMoney } from '../domain/pos-money.ts';
import { returnPortion } from '../domain/pos-return-money.ts';
import { snapshotPosFees } from '../domain/pos-fees.ts';
import {
  posReturns,
  posReturnLines,
  posRefunds,
  posExchangeAllocations,
} from '../return-schema.ts';
import {
  salesOrders,
  salesOrderLines,
  deliveries,
  packingSlips,
} from '../schema.ts';
import { posRegisters, posShifts } from '../pos-schema.ts';
import { notifyPosReturnApproval } from './cash-approval-notification.ts';
import { cashTasksChanged } from './invoice-task-hooks.ts';
import { cashDrawers, cashEntries } from '../cash-schema.ts';
import { postMoves } from '../../inventory/api/ledger.ts';
import { recordMovements } from '../../catalog/api/product-history.ts';
type Ctx = RouteContext<StaffEnv>;
const who = (c: Ctx) => (c.state.session as SessionState).member;
const now = () => new Date().toISOString();
function access(c: Ctx) {
  if (!can(who(c), 'pos.sell') && !canApprove(who(c)))
    throw new AppError(403, 'Chưa có quyền POS.');
}
async function source(c: Ctx, db: CashDb, id: string) {
  const [o] = await db.select().from(salesOrders).where(eq(salesOrders.id, id));
  if (!o || o.channel !== 'pos' || !o.shiftId)
    throw new AppError(404, 'Không tìm thấy bill POS.');
  const [s] = await db
    .select()
    .from(posShifts)
    .where(eq(posShifts.id, o.shiftId));
  if (
    !s ||
    !allowedRegister(c, s.registerId) ||
    !allowedDrawer(c, s.cashDrawerId)
  )
    throw new AppError(403, 'Bill thuộc cửa hàng khác.');
  // Người bán chỉ xử lý bill của quầy được giao; người duyệt (Manager / được chỉ định) xem mọi quầy để duyệt.
  if (!canApprove(who(c))) await assertSellRegister(c, s.registerId, db);
  return { o, s };
}
async function getReturn(c: Ctx, db: CashDb, id: string) {
  const [r] = await db.select().from(posReturns).where(eq(posReturns.id, id));
  if (!r) throw new AppError(404, 'Không tìm thấy phiếu trả.');
  await source(c, db, r.orderId);
  return r;
}
async function current(
  c: Ctx,
  db: CashDb,
  shiftId: unknown,
  registerId: string,
) {
  posPermission(who(c));
  const s = await saleShiftOf(db, who(c), posText(shiftId), true);
  assertOpen(s, who(c));
  if (s.registerId !== registerId || !allowedDrawer(c, s.cashDrawerId))
    throw new AppError(403, 'Cần ca đang mở đúng quầy/két của bill.');
  return s;
}
async function detail(c: Ctx, db: CashDb, orderId: string) {
  const { o, s } = await source(c, db, orderId),
    account = await returnAccount(db, o.id);
  const lines = await db
    .select()
    .from(salesOrderLines)
    .where(eq(salesOrderLines.orderId, o.id))
    .orderBy(asc(salesOrderLines.lineNo));
  const returns = await Promise.all(
    account.returns.map(async (r) => ({
      ...r,
      lines: await db
        .select()
        .from(posReturnLines)
        .where(eq(posReturnLines.returnId, r.id)),
      refunds: account.refunds.filter((x) => x.returnId === r.id),
      allocations: account.allocations.filter((x) => x.returnId === r.id),
    })),
  );
  const issued = recoverable(o) ? await flowIssued(db, o.id) : [];
  const recoveringIssued =
    recoverable(o) &&
    lines.every((l) => l.deliveredQty === 0) &&
    issued.some((i) => i.qty > 0);
  const { returns: unused, ...summary } = account;
  const reserved = await activeReservations(db, account.allocations);
  return {
    order: o,
    registerId: s.registerId,
    lines: lines.map((l) => ({
      ...l,
      returnableQty: recoveringIssued
        ? issued.find((i) => i.sku === l.sku)?.qty || 0
        : l.deliveredQty,
    })),
    recoveringIssued,
    returns,
    account: {
      ...summary,
      reserved,
      available: Math.max(0, summary.available - reserved),
    },
    canApprove: canApprove(who(c)),
    manager: who(c).role === 'manager',
    viewerId: who(c).id,
  };
}
/**
 * Đơn đã xuất kho nhưng khách chưa nhận (chưa giao dòng nào) được "thu hồi": nhận lại toàn bộ hàng đã xuất + hoàn tiền đã thu.
 * Đơn cọc / ship trả trước, và đơn Ship COD (GHN lấy hàng rồi hoàn về – kể cả đơn đã thu cọc, vốn không huỷ thẳng được).
 */
const recoverable = (o: { posSnapshot: string | null; channel: string; fulfillmentMode: string | null }) =>
  !!saleFlowOf(o.posSnapshot) || (o.channel === 'pos' && o.fulfillmentMode === 'cod');
export function registerPosReturnRoutes(router: Router<StaffEnv>) {
  router.get(
    '/pos/returns',
    async (c) => {
      access(c);
      const orderId = c.url.searchParams.get('orderId');
      if (orderId) return json(await detail(c, c.env.db, orderId));
      // Lọc quầy trong SQL rồi mới giới hạn 300 dòng (trước đây lọc sau limit nên cửa hàng có thể thấy thiếu).
      const sell = canApprove(who(c)) ? null : await allowedPosRegisters(c);
      const registerIds = (await c.env.db.select({ id: posRegisters.id }).from(posRegisters)).map(r => r.id)
        .filter(id => allowedRegister(c, id) && (!sell || sell.all || sell.ids.has(id)));
      if (!registerIds.length) return json({ returns: [] });
      const rows = await c.env.db
        .select({
          r: posReturns,
          orderNo: salesOrders.orderNo,
          customerName: salesOrders.customerName,
          createdByName: employees.name,
        })
        .from(posReturns)
        .innerJoin(salesOrders, eq(salesOrders.id, posReturns.orderId))
        .innerJoin(employees, eq(employees.id, posReturns.createdBy))
        .where(inArray(posReturns.registerId, registerIds))
        .orderBy(desc(posReturns.createdAt))
        .limit(300);
      return json({
        returns: rows
          .map((x) => ({
            ...x.r,
            orderNo: x.orderNo,
            customerName: x.customerName,
            createdByName: x.createdByName,
          })),
      });
    },
    'business',
  );
  router.post(
    '/pos/returns',
    async (c) => {
      access(c);
      posPermission(who(c));
      const b = await readJson(c.req, 32000),
        key = posKey(b.key),
        orderId = posText(b.orderId),
        reason = posText(b.reason, 2000);
      if (!reason) throw new AppError(400, 'Nhập lý do đổi/trả hàng.');
      let created = false;
      const result = await c.env.db.transaction(async (tx) => {
        await cashLock(tx);
        const { o, s } = await source(c, tx, orderId);
        await tx
          .select()
          .from(salesOrders)
          .where(eq(salesOrders.id, o.id))
          .for('update');
        const [prior] = await tx
          .select()
          .from(posReturns)
          .where(eq(posReturns.requestKey, key));
        if (prior) {
          if (
            prior.orderId !== orderId ||
            prior.createdBy !== who(c).id ||
            JSON.parse(prior.sourceSnapshot).request !== JSON.stringify(b)
          )
            throw new AppError(409, 'Mã yêu cầu đã dùng cho nội dung khác.');
          return prior;
        }
        if (o.status === 'cancelled') throw new AppError(409, 'Bill đã huỷ.');
        const shift = await current(c, tx, b.shiftId, s.registerId),
          snap = JSON.parse(o.posSnapshot || '{}');
        if (!snap.register?.warehouseId)
          throw new AppError(
            409,
            'Bill thiếu kho gốc; cần Manager kiểm tra trước khi trả hàng.',
          );
        const old = await tx
          .select()
          .from(salesOrderLines)
          .where(eq(salesOrderLines.orderId, o.id))
          .for('update');
        const issued = recoverable(o)
          ? await flowIssued(tx, o.id)
          : [];
        const recoveringIssued =
          recoverable(o) &&
          old.every((l) => l.deliveredQty === 0) &&
          issued.some((i) => i.qty > 0);
        const rs = await tx
          .select()
          .from(posReturns)
          .where(
            and(
              eq(posReturns.orderId, o.id),
              sql`${posReturns.status} not in ('cancelled','rejected')`,
            ),
          );
        const claimed = rs.length
          ? await tx
              .select()
              .from(posReturnLines)
              .where(
                inArray(
                  posReturnLines.returnId,
                  rs.map((r) => r.id),
                ),
              )
          : [];
        if (
          !Array.isArray(b.lines) ||
          !b.lines.length ||
          b.lines.length > old.length ||
          new Set(b.lines.map((x: any) => x?.orderLineId)).size !==
            b.lines.length
        )
          throw new AppError(400, 'Chọn dòng hàng cần trả, không trùng.');
        if (
          recoveringIssued &&
          (rs.length ||
            old.some((l) => {
              const qty = issued.find((i) => i.sku === l.sku)?.qty || 0;
              return (
                qty > 0 &&
                !(b.lines as any[]).some(
                  (x: any) => x.orderLineId === l.id && Number(x.qty) === qty,
                )
              );
            }))
        )
          throw new AppError(
            409,
            'Thu hồi đơn chưa giao phải nhận lại toàn bộ hàng đã xuất; xử lý yêu cầu hiện có trước.',
          );
        const id = crypto.randomUUID(),
          at = now(),
          returnNo = 'TH-' + id.slice(0, 8).toUpperCase();
        const lines = b.lines.map((x: any) => {
          const l = old.find((l) => l.id === x?.orderLineId);
          const returnable = l
            ? recoveringIssued
              ? issued.find((i) => i.sku === l.sku)?.qty || 0
              : l.deliveredQty
            : 0;
          if (!l || returnable <= 0)
            throw new AppError(400, 'Chỉ trả hàng đã giao của bill gốc.');
          const previous = claimed.filter((p) => p.orderLineId === l.id),
            qty = previous.reduce((n, p) => n + p.requestedQty, 0),
            wanted = Number(x.qty);
          // Validate both sold and delivered caps; allocate money against all active requests, including pending.
          returnPortion(0, returnable, qty, x.qty, 0);
          const original = snap.lines?.find(
            (row: { sku: string }) => row.sku === l.sku,
          );
          if (!original || original.subtotal !== l.amount)
            throw new AppError(
              409,
              'Snapshot bill không khớp dòng hàng, cần Manager kiểm tra.',
            );
          const baseTax = posMoney(original.tax);
          const subtotal = returnPortion(
            l.amount,
            l.qty,
            qty,
            x.qty,
            previous.reduce((n, p) => n + p.subtotal, 0),
          );
          const tax = returnPortion(
            baseTax,
            l.qty,
            qty,
            x.qty,
            previous.reduce((n, p) => n + p.tax, 0),
          );
          return {
            id: crypto.randomUUID(),
            returnId: id,
            orderLineId: l.id,
            sku: l.sku,
            name: l.name,
            unit: l.unit,
            requestedQty: wanted,
            disposition: x.disposition === 'damaged' ? 'damaged' : 'restock',
            conditionNote: posText(x.conditionNote, 1000),
            subtotal,
            tax,
            total: subtotal + tax,
          };
        });
        const fees = snapshotPosFees(snap),
          service = posMoney(b.serviceFee ?? 0),
          shipping = posMoney(b.shippingFee ?? 0);
        if (
          service >
            fees.service.amount -
              rs.reduce((n, r) => n + r.requestedServiceFee, 0) ||
          shipping >
            fees.shippingFee -
              rs.reduce((n, r) => n + r.requestedShippingFee, 0)
        )
          throw new AppError(
            400,
            'Phí yêu cầu hoàn vượt khoản phí gốc còn lại.',
          );
        const [r] = await tx
          .insert(posReturns)
          .values({
            id,
            returnNo,
            orderId: o.id,
            registerId: s.registerId,
            warehouseId: snap.register.warehouseId,
            createdShiftId: shift.id,
            requestContext: recoveringIssued ? 'after_issue' : 'after_delivery',
            kind: b.kind === 'exchange' ? 'exchange' : 'return',
            status: 'pending',
            reason,
            requestedServiceFee: service,
            requestedShippingFee: shipping,
            subtotal: recoveringIssued
              ? o.subtotal - fees.service.subtotal - fees.shippingFee
              : lines.reduce((n, l) => n + l.subtotal, 0),
            tax: recoveringIssued
              ? o.tax - fees.service.tax
              : lines.reduce((n, l) => n + l.tax, 0),
            total: recoveringIssued
              ? o.total - fees.service.amount - fees.shippingFee
              : lines.reduce((n, l) => n + l.total, 0),
            sourceSnapshot: JSON.stringify({
              order: o,
              lines: old,
              fees,
              request: JSON.stringify(b),
            }),
            requestKey: key,
            createdBy: who(c).id,
            createdAt: at,
            updatedAt: at,
          })
          .returning();
        await tx.insert(posReturnLines).values(lines);
        await cashAudit(tx, who(c).id, 'request-return', 'pos-returns', id, {
          orderId: o.id,
          reason,
          lines,
          service,
          shipping,
        });
        created = true;
        return r;
      });
      if (created && result) {
        const [reg] = await c.env.db.select({ drawerId: posRegisters.cashDrawerId }).from(posRegisters).where(eq(posRegisters.id, result.registerId));
        if (reg) await notifyPosReturnApproval(c.env, { id: result.id, returnNo: result.returnNo, orderId: result.orderId, drawerId: reg.drawerId, total: result.total, reason, createdBy: who(c).id })
          .catch(error => console.warn('pos return notification failed', error instanceof Error ? error.message : 'unknown error'));
      }
      return json(result, 201);
    },
    'business',
  );
  router.post(
    '/pos/returns/:id/approve',
    async (c) => {
      access(c);
      if (!canApprove(who(c)))
        throw new AppError(403, 'Cần Manager hoặc người được chỉ định duyệt.');
      const b = await readJson(c.req, 6000);
      return json(
        await c.env.db.transaction(async (tx) => {
          await cashLock(tx);
          const r = await getReturn(c, tx, c.params.id!);
          if (r.createdBy === who(c).id && who(c).role !== 'manager')
            throw new AppError(
              403,
              'Người được chỉ định không tự duyệt yêu cầu của mình.',
            );
          const service = posMoney(b.serviceFee ?? 0),
            shipping = posMoney(b.shippingFee ?? 0),
            note = posText(b.note, 2000);
          if (r.status !== 'pending') {
            if (
              !['cancelled', 'rejected'].includes(r.status) &&
              r.approvedBy === who(c).id &&
              r.approvedServiceFee === service &&
              r.approvedShippingFee === shipping
            )
              return r;
            throw new AppError(409, 'Yêu cầu không còn chờ duyệt.');
          }
          if ((service || shipping) && who(c).role !== 'manager')
            throw new AppError(403, 'Chỉ Manager được duyệt hoàn thêm phí.');
          if (
            service > r.requestedServiceFee ||
            shipping > r.requestedShippingFee
          )
            throw new AppError(400, 'Mức phí duyệt vượt yêu cầu.');
          const fees = JSON.parse(r.sourceSnapshot).fees;
          const siblings = await tx
            .select()
            .from(posReturns)
            .where(
              and(
                eq(posReturns.orderId, r.orderId),
                sql`${posReturns.approvedAt} is not null`,
                sql`${posReturns.status} not in ('cancelled','rejected')`,
              ),
            );
          let allocatedSubtotal = 0,
            allocatedTax = 0,
            allocatedService = 0;
          for (const other of siblings) {
            const ls = await tx
              .select()
              .from(posReturnLines)
              .where(eq(posReturnLines.returnId, other.id));
            allocatedSubtotal +=
              other.subtotal -
              ls.reduce((n, l) => n + l.subtotal, 0) -
              other.approvedShippingFee;
            allocatedTax += other.tax - ls.reduce((n, l) => n + l.tax, 0);
            allocatedService += other.approvedServiceFee;
          }
          if (service + allocatedService > fees.service.amount)
            throw new AppError(409, 'Phí đã được duyệt hoàn ở phiếu khác.');
          const subService =
            service + allocatedService === fees.service.amount
              ? fees.service.subtotal - allocatedSubtotal
              : Math.min(
                  Math.round(service / (1 + fees.service.taxRate / 100)),
                  fees.service.subtotal - allocatedSubtotal,
                );
          if (service - subService > fees.service.tax - allocatedTax)
            throw new AppError(409, 'Phân bổ VAT phí cần kiểm tra lại.');
          const fields = {
            ...(r.requestContext === 'before_fulfillment'
              ? { creditEffectiveAt: now() }
              : {}),
            status:
              r.requestContext === 'before_fulfillment'
                ? 'processing'
                : 'approved',
            approvedServiceFee: service,
            approvedShippingFee: shipping,
            subtotal: r.subtotal + subService + shipping,
            tax: r.tax + service - subService,
            total: r.total + service + shipping,
            approvedBy: who(c).id,
            approvedAt: now(),
            approvalNote: note,
            updatedAt: now(),
          };
          await tx
            .update(posReturns)
            .set(fields)
            .where(eq(posReturns.id, r.id));
          if (r.requestContext === 'after_issue') {
            // Chờ duyệt mà GHN / kho kịp báo đã giao: không thu hồi (đơn đã giao xử lý bằng trả hàng thường).
            const [given] = await tx.select({ id: salesOrderLines.id }).from(salesOrderLines)
              .where(and(eq(salesOrderLines.orderId, r.orderId), sql`${salesOrderLines.deliveredQty} > 0`)).limit(1);
            if (given) throw new AppError(409, 'Đơn đã có hàng giao tới khách – huỷ yêu cầu thu hồi này và lập yêu cầu trả hàng thường.', 'ORDER_DELIVERED');
            const at = now();
            await tx
              .update(salesOrders)
              .set({
                status: 'cancelled',
                holdsStock: false,
                updatedAt: at,
                revision: sql`${salesOrders.revision}+1`,
              })
              .where(eq(salesOrders.id, r.orderId));
            await tx
              .update(posOrderReservations)
              .set({
                status: 'released',
                updatedAt: at,
                closedAt: at,
                closedBy: who(c).id,
                closeReason: r.reason,
              })
              .where(
                and(
                  eq(posOrderReservations.orderId, r.orderId),
                  eq(posOrderReservations.status, 'active'),
                ),
              );
            await tx
              .update(posPaymentIntents)
              .set({
                status: 'cancelled',
                cancelledAt: at,
                cancelledBy: who(c).id,
                cancelReason: r.reason,
              })
              .where(
                and(
                  eq(posPaymentIntents.orderId, r.orderId),
                  eq(posPaymentIntents.status, 'pending'),
                ),
              );
            await tx
              .update(deliveries)
              .set({ status: 'cancelled', updatedAt: at })
              .where(
                and(
                  eq(deliveries.orderId, r.orderId),
                  inArray(deliveries.status, [
                    'planned',
                    'in_transit',
                    'failed',
                  ]),
                ),
              );
            await tx
              .update(packingSlips)
              .set({ status: 'cancelled', updatedAt: at })
              .where(
                and(
                  eq(packingSlips.orderId, r.orderId),
                  inArray(packingSlips.status, ['draft', 'sent']),
                ),
              );
          }
          await cashAudit(
            tx,
            who(c).id,
            'approve-return',
            'pos-returns',
            r.id,
            { ...fields, selfApproved: r.createdBy === who(c).id },
          );
          return { ...r, ...fields };
        }).then(async res => { await cashTasksChanged(c.env); return res; }),
      );
    },
    'business',
  );
  router.post(
    '/pos/returns/:id/cancel',
    async (c) => {
      access(c);
      const b = await readJson(c.req, 4000),
        reason = posText(b.reason, 2000);
      if (!reason) throw new AppError(400, 'Nhập lý do.');
      return json(
        await c.env.db.transaction(async (tx) => {
          await cashLock(tx);
          const r = await getReturn(c, tx, c.params.id!);
          if (who(c).id !== r.createdBy && !canApprove(who(c)))
            throw new AppError(403, 'Không có quyền huỷ yêu cầu này.');
          if (['cancelled', 'rejected'].includes(r.status))
            return { ok: true, replayed: true };
          if (
            r.receivedAt ||
            r.creditEffectiveAt ||
            (r.requestContext === 'after_issue' && r.approvedAt)
          )
            throw new AppError(409, 'Đã thực nhận hàng, không huỷ chứng từ.');
          await tx
            .update(posReturns)
            .set({
              status: b.reject && canApprove(who(c)) ? 'rejected' : 'cancelled',
              updatedAt: now(),
            })
            .where(eq(posReturns.id, r.id));
          await cashAudit(tx, who(c).id, 'cancel-return', 'pos-returns', r.id, {
            reason,
          });
          return { ok: true };
        }).then(async res => { await cashTasksChanged(c.env); return res; }),
      );
    },
    'business',
  );
  router.post(
    '/pos/returns/:id/receive',
    async (c) => {
      access(c);
      const b = await readJson(c.req, 4000);
      if (b.confirmed !== true)
        throw new AppError(400, 'Xác nhận đã nhận đủ số hàng trên phiếu.');
      return json(
        await c.env.db.transaction(async (tx) => {
          await cashLock(tx);
          const r = await getReturn(c, tx, c.params.id!);
          const s = await current(c, tx, b.shiftId, r.registerId);
          if (r.requestContext === 'before_fulfillment')
            throw new AppError(
              409,
              'Huỷ trước xuất không phát sinh nhập hàng.',
            );
          if (r.receivedAt) return { id: r.id, replayed: true };
          if (r.status !== 'approved')
            throw new AppError(409, 'Yêu cầu chưa được duyệt.');
          const lines = await tx
              .select()
              .from(posReturnLines)
              .where(eq(posReturnLines.returnId, r.id)),
            at = now();
          await postMoves(
            tx,
            who(c).id,
            lines
              .filter((l) => l.disposition === 'restock')
              .map((l) => ({
                sku: l.sku,
                warehouseId: r.warehouseId,
                qty: l.requestedQty,
                kind: 'customer_return' as const,
                refType: 'pos_return' as const,
                refId: r.id,
                refNo: r.returnNo,
                note: r.reason,
              })),
            at,
          );
          await recordMovements(
            tx,
            lines.map((l) => ({
              refKey: `return:${r.id}:${l.id}`,
              sku: l.sku,
              name: l.name,
              qty: l.requestedQty,
              unit: l.unit,
              unitPrice: l.subtotal / l.requestedQty,
              kind: 'customer_return',
              partner: 'Khách trả hàng',
              refCode: r.returnNo,
              link: '#/orders/' + r.orderId,
              status:
                l.disposition === 'restock'
                  ? 'Đã nhập lại kho'
                  : 'Hàng hỏng, không nhập tồn bán',
              occurredAt: at,
            })),
          );
          for (const l of lines)
            await tx
              .update(posReturnLines)
              .set({
                receivedQty: l.requestedQty,
                restockQty: l.disposition === 'restock' ? l.requestedQty : 0,
              })
              .where(eq(posReturnLines.id, l.id));
          await tx
            .update(posReturns)
            .set({
              status: 'processing',
              receivedBy: who(c).id,
              receivedAt: at,
              receivedShiftId: s.id,
              creditEffectiveAt: at,
              updatedAt: at,
            })
            .where(eq(posReturns.id, r.id));
          await tx
            .update(salesOrders)
            .set({ revision: sql`${salesOrders.revision}+1`, updatedAt: at })
            .where(eq(salesOrders.id, r.orderId));
          await cashAudit(
            tx,
            who(c).id,
            'receive-return',
            'pos-returns',
            r.id,
            { shiftId: s.id, lines },
          );
          return { id: r.id };
        }),
      );
    },
    'business',
  );
  router.post(
    '/pos/returns/:id/refund',
    async (c) => {
      access(c);
      const b = await readJson(c.req, 6000),
        key = posKey(b.key),
        amount = posMoney(b.amount),
        method = b.method,
        reference = posText(b.reference, 200),
        confirmationNote = posText(b.note, 2000);
      if (
        b.confirmed !== true ||
        amount <= 0 ||
        !['cash', 'transfer'].includes(String(method)) ||
        (method === 'transfer' && !reference)
      )
        throw new AppError(
          400,
          'Xác nhận số tiền thực hoàn, phương thức và tham chiếu chuyển khoản.',
        );
      return json(
        await c.env.db.transaction(async (tx) => {
          await cashLock(tx);
          const r = await getReturn(c, tx, c.params.id!);
          const [prior] = await tx
            .select()
            .from(posRefunds)
            .where(eq(posRefunds.requestKey, key));
          if (prior) {
            if (
              prior.returnId !== r.id ||
              prior.amount !== amount ||
              prior.method !== method ||
              prior.confirmedBy !== who(c).id ||
              prior.reference !== reference ||
              prior.shiftId !== b.shiftId
            )
              throw new AppError(409, 'Mã hoàn tiền đã dùng.');
            return { ...prior, replayed: true };
          }
          const s = await current(c, tx, b.shiftId, r.registerId);
          if (!r.creditEffectiveAt || !r.approvedBy)
            throw new AppError(
              409,
              'Cần duyệt và xác nhận thực nhận hàng trước.',
            );
          const a = await returnAccount(tx, r.orderId),
            reserved = await activeReservations(tx, a.allocations, '', true);
          const used =
            a.refunds
              .filter((x) => x.returnId === r.id)
              .reduce((n, x) => n + x.amount, 0) +
            a.allocations
              .filter((x) => x.returnId === r.id && x.status === 'applied')
              .reduce((n, x) => n + x.amount, 0);
          if (amount > a.available - reserved || amount > r.total - used)
            throw new AppError(
              409,
              'Số hoàn vượt tiền đã thu còn được hoàn hoặc đang giữ để đổi hàng.',
            );
          const id = crypto.randomUUID(),
            at = now(),
            refundNo = 'HT-' + id.slice(0, 8).toUpperCase();
          let cashEntryId: string | null = null;
          if (method === 'cash') {
            const [drawer] = await tx
              .select()
              .from(cashDrawers)
              .where(eq(cashDrawers.id, s.cashDrawerId));
            cashEntryId = crypto.randomUUID();
            await tx.insert(cashEntries).values({
              id: cashEntryId,
              entryNo: refundNo,
              drawerId: s.cashDrawerId,
              shiftId: s.id,
              kind: 'customer_refund',
              direction: 'out',
              amount,
              reason: `Hoàn ${r.returnNo}: ${r.reason}`,
              status: 'posted',
              approvalThresholdSnapshot: drawer!.approvalThreshold,
              createdBy: who(c).id,
              createdAt: at,
              approvedBy: r.approvedBy,
              approvedAt: r.approvedAt,
              requestKey: key,
              updatedAt: at,
            });
          }
          const [refund] = await tx
            .insert(posRefunds)
            .values({
              id,
              refundNo,
              returnId: r.id,
              shiftId: s.id,
              drawerId: s.cashDrawerId,
              method: method as 'cash' | 'transfer',
              amount,
              cashEntryId,
              reference,
              confirmationNote,
              confirmedBy: who(c).id,
              confirmedAt: at,
              requestKey: key,
              createdAt: at,
            })
            .returning();
          await cashAudit(tx, who(c).id, 'refund', 'pos-returns', r.id, {
            refundId: id,
            amount,
            method,
            reference,
            shiftId: s.id,
          });
          return refund;
        }),
        201,
      );
    },
    'business',
  );
  router.post(
    '/pos/returns/:id/complete',
    async (c) => {
      access(c);
      return json(
        await c.env.db.transaction(async (tx) => {
          await cashLock(tx);
          const r = await getReturn(c, tx, c.params.id!);
          if (
            !r.creditEffectiveAt ||
            (!r.receivedAt && r.requestContext !== 'before_fulfillment')
          )
            throw new AppError(409, 'Chưa nhận hàng.');
          const a = await returnAccount(tx, r.orderId);
          if (
            a.available > 0 ||
            (await activeReservations(tx, a.allocations, '', true)) > 0
          )
            throw new AppError(
              409,
              'Còn tiền chờ hoàn hoặc đổi hàng, cần xử lý trước.',
            );
          if (r.status !== 'completed') {
            await tx
              .update(posReturns)
              .set({ status: 'completed', updatedAt: now() })
              .where(eq(posReturns.id, r.id));
            await cashAudit(
              tx,
              who(c).id,
              'complete-return',
              'pos-returns',
              r.id,
              {},
            );
          }
          return { ok: true };
        }),
      );
    },
    'business',
  );
  router.post(
    '/pos/returns/:id/exchange',
    async (c) => {
      access(c);
      const b = await readJson(c.req, 4000),
        key = posKey(b.key),
        amount = posMoney(b.amount);
      if (amount <= 0)
        throw new AppError(400, 'Số tiền đổi hàng phải lớn hơn 0.');
      return json(
        await c.env.db.transaction(async (tx) => {
          await cashLock(tx);
          const r = await getReturn(c, tx, c.params.id!),
            s = await current(c, tx, b.shiftId, r.registerId);
          const [prior] = await tx
            .select()
            .from(posExchangeAllocations)
            .where(eq(posExchangeAllocations.requestKey, key));
          if (prior) {
            if (
              prior.returnId !== r.id ||
              prior.amount !== amount ||
              prior.createdBy !== who(c).id
            )
              throw new AppError(409, 'Mã đổi hàng đã dùng.');
            return prior;
          }
          if (!r.creditEffectiveAt || r.status === 'completed')
            throw new AppError(
              409,
              'Chỉ áp dụng phiếu đã nhận hàng còn đang xử lý.',
            );
          const a = await returnAccount(tx, r.orderId),
            reserved = await activeReservations(tx, a.allocations, '', true),
            used =
              a.refunds
                .filter((x) => x.returnId === r.id)
                .reduce((n, x) => n + x.amount, 0) +
              a.allocations
                .filter(
                  (x) =>
                    x.returnId === r.id &&
                    x.status !== 'cancelled' &&
                    (x.status === 'applied' || x.expiresAt > now()),
                )
                .reduce((n, x) => n + x.amount, 0);
          if (amount > a.available - reserved || amount > r.total - used)
            throw new AppError(409, 'Vượt số tiền còn được dùng đổi hàng.');
          const at = now(),
            [row] = await tx
              .insert(posExchangeAllocations)
              .values({
                id: crypto.randomUUID(),
                returnId: r.id,
                amount,
                status: 'reserved',
                reservedAt: at,
                expiresAt: new Date(Date.now() + 15 * 60000).toISOString(),
                createdBy: who(c).id,
                requestKey: key,
                createdAt: at,
              })
              .returning();
          await cashAudit(
            tx,
            who(c).id,
            'reserve-exchange',
            'pos-returns',
            r.id,
            { allocationId: row!.id, amount, shiftId: s.id },
          );
          return row;
        }),
        201,
      );
    },
    'business',
  );
  router.post(
    '/pos/exchanges/:id/cancel',
    async (c) => {
      access(c);
      return json(
        await c.env.db.transaction(async (tx) => {
          await cashLock(tx);
          const [a] = await tx
            .select()
            .from(posExchangeAllocations)
            .where(eq(posExchangeAllocations.id, c.params.id!));
          if (!a) throw new AppError(404, 'Không có khoản đổi hàng.');
          await getReturn(c, tx, a.returnId);
          if (a.createdBy !== who(c).id && who(c).role !== 'manager')
            throw new AppError(403, 'Không có quyền.');
          if (a.status === 'applied' || (await allocationProtected(tx, a.id)))
            throw new AppError(
              409,
              'Khoản đổi hàng đã dùng hoặc đang gắn QR còn hiệu lực/đã nhận tiền.',
            );
          await tx
            .update(posExchangeAllocations)
            .set({ status: 'cancelled' })
            .where(eq(posExchangeAllocations.id, a.id));
          await cashAudit(
            tx,
            who(c).id,
            'cancel-exchange',
            'pos-returns',
            a.returnId,
            { allocationId: a.id },
          );
          return { ok: true };
        }),
      );
    },
    'business',
  );
}
