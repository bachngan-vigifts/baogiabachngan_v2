import { and, asc, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import { AppError } from '../../../core/errors.ts';
import {
  salesOrders,
  salesOrderLines,
  customerPayments,
  paymentSchedules,
  packingSlips,
  deliveries,
} from '../schema.ts';
import {
  posOrderReservations,
  posPaymentIntents,
} from '../pos-order-flow-schema.ts';
import { posShifts } from '../pos-schema.ts';
import { posReturns } from '../return-schema.ts';
import { stockBalances, stockMoves } from '../../inventory/schema.ts';
import { postMoves } from '../../inventory/api/ledger.ts';
import { cashAudit } from './cash-store.ts';
import {
  assertOpen,
  posPermission,
  posText,
  registerOf,
  reservedBySku,
  saleShiftOf,
  type PosDb,
  type PosMember,
} from './pos-store.ts';
import {
  flowHoldUntil,
  flowRemaining,
  saleFlowOf,
} from '../domain/pos-order-flow.ts';
import { posMoney } from '../domain/pos-money.ts';
import { vietnamDate } from '../domain/sales.ts';
import {
  assertPosFlowFulfillable,
  flowIssued,
} from './pos-order-flow-guards.ts';

type FlowRecords = {
  receipts: (typeof customerPayments.$inferSelect)[];
  intents: (typeof posPaymentIntents.$inferSelect)[];
  reservations: (typeof posOrderReservations.$inferSelect)[];
  cancelRequest?: { id: string; status: string } | null;
};
export async function flowAccounts(
  db: PosDb,
  orders: (typeof salesOrders.$inferSelect)[],
) {
  if (!orders.length) return [];
  const ids = orders.map((o) => o.id);
  const [receipts, intents, reservations, requests] = await Promise.all([
    db
      .select()
      .from(customerPayments)
      .where(
        and(
          inArray(customerPayments.orderId, ids),
          isNull(customerPayments.voidedAt),
        ),
      ),
    db
      .select()
      .from(posPaymentIntents)
      .where(inArray(posPaymentIntents.orderId, ids))
      .orderBy(asc(posPaymentIntents.createdAt)),
    db
      .select()
      .from(posOrderReservations)
      .where(inArray(posOrderReservations.orderId, ids)),
    db
      .select({
        id: posReturns.id,
        status: posReturns.status,
        orderId: posReturns.orderId,
      })
      .from(posReturns)
      .where(inArray(posReturns.orderId, ids)),
  ]);
  return Promise.all(
    orders.map((o) =>
      flowAccount(db, o, {
        receipts: receipts.filter((p) => p.orderId === o.id),
        intents: intents.filter((i) => i.orderId === o.id),
        reservations: reservations.filter((r) => r.orderId === o.id),
        cancelRequest:
          requests.find(
            (r) => r.id === JSON.parse(o.posSnapshot || '{}').cancelReturnId,
          ) || null,
      }),
    ),
  );
}
export async function flowAccount(
  db: PosDb,
  o: typeof salesOrders.$inferSelect,
  records?: FlowRecords,
) {
  const [receipts, intents, reservations] = records
    ? [records.receipts, records.intents, records.reservations]
    : await Promise.all([
        db
          .select()
          .from(customerPayments)
          .where(
            and(
              eq(customerPayments.orderId, o.id),
              isNull(customerPayments.voidedAt),
            ),
          ),
        db
          .select()
          .from(posPaymentIntents)
          .where(eq(posPaymentIntents.orderId, o.id))
          .orderBy(asc(posPaymentIntents.createdAt)),
        db
          .select()
          .from(posOrderReservations)
          .where(eq(posOrderReservations.orderId, o.id)),
      ]);
  const paid = receipts.reduce((n, p) => n + p.amount, 0),
    pending = intents
      .filter((i) => i.status === 'pending')
      .reduce((n, i) => n + i.amount, 0);
  const held =
    reservations.length > 0 &&
    reservations.every(
      (r) => r.status === 'active' && r.expiresAt > new Date().toISOString(),
    );
  const flow = saleFlowOf(o.posSnapshot);
  const state =
    o.status === 'cancelled'
      ? 'Đã huỷ'
      : o.status === 'delivered'
        ? 'Đã nhận hàng'
        : paid >= o.total
          ? held
            ? 'Đã trả đủ'
            : 'Đã trả đủ — cần giữ lại hàng'
          : pending
            ? 'Chờ xác nhận tiền'
            : held
              ? 'Đang giữ hàng — còn phải thu'
              : 'Hết hạn giữ — cần giữ lại hàng';
  const cancelId = JSON.parse(o.posSnapshot || '{}').cancelReturnId;
  const [cancelRequest] = records
    ? [records.cancelRequest]
    : cancelId
      ? await db
          .select({ id: posReturns.id, status: posReturns.status })
          .from(posReturns)
          .where(eq(posReturns.id, cancelId))
      : [];
  return {
    cancelRequest: cancelRequest || null,
    order: o,
    saleFlow: flow,
    paid,
    remaining: flowRemaining(o.total, paid),
    pending,
    held,
    holdUntil: reservations[0]?.expiresAt || null,
    state,
    intents,
    receipts,
  };
}

export async function flowCurrent(
  db: PosDb,
  actor: PosMember,
  shiftId: string,
  order: typeof salesOrders.$inferSelect,
) {
  posPermission(actor);
  if (!saleFlowOf(order.posSnapshot) || !order.shiftId)
    throw new AppError(404, 'Không tìm thấy đơn cọc/trả trước.');
  const [original] = await db
    .select()
    .from(posShifts)
    .where(eq(posShifts.id, order.shiftId));
  if (!original) throw new AppError(404, 'Thiếu ca gốc.');
  const current = await saleShiftOf(db, actor, shiftId, true);
  assertOpen(current, actor);
  if (
    current.registerId !== original.registerId ||
    current.cashDrawerId !== original.cashDrawerId
  )
    throw new AppError(403, 'Đơn thuộc quầy/két khác.');
  return current;
}

/** Caller holds cashLock before the common stock lock. Revalidate expired holds before accepting more money. */
export async function holdFlowOrder(
  db: PosDb,
  order: typeof salesOrders.$inferSelect,
  actor: PosMember,
) {
  if (!['confirmed', 'draft'].includes(order.status))
    throw new AppError(409, 'Đơn không còn chờ nhận hàng.');
  await db.execute(sql`select pg_advisory_xact_lock(hashtext('stock_holds'))`);
  const lines = await db
    .select()
    .from(salesOrderLines)
    .where(eq(salesOrderLines.orderId, order.id));
  const reservations = await db
    .select()
    .from(posOrderReservations)
    .where(eq(posOrderReservations.orderId, order.id));
  if ((await flowIssued(db, order.id)).some((r) => r.qty > 0))
    throw new AppError(
      409,
      'Đơn đã xuất kho: xử lý giao/trả hàng, không giữ lại từ đầu.',
    );
  if (
    !lines.length ||
    lines.some((l) => l.deliveredQty > 0) ||
    !reservations.length
  )
    throw new AppError(409, 'Đơn đã xuất hoặc thiếu giữ hàng.');
  const warehouseId = reservations[0]!.warehouseId,
    now = new Date().toISOString();
  const balances = await db
    .select()
    .from(stockBalances)
    .where(
      and(
        eq(stockBalances.warehouseId, warehouseId),
        inArray(
          stockBalances.sku,
          lines.map((l) => l.sku),
        ),
      ),
    )
    .orderBy(asc(stockBalances.sku))
    .for('update');
  const reserved = await reservedBySku(
    db,
    lines.map((l) => l.sku),
    warehouseId,
  );
  for (const line of lines) {
    const own = reservations
      .filter(
        (r) =>
          r.orderLineId === line.id &&
          r.status === 'active' &&
          r.expiresAt > now,
      )
      .reduce((n, r) => n + r.qty, 0);
    const available =
      (balances.find((b) => b.sku === line.sku)?.qty || 0) -
      (reserved.get(line.sku) || 0) +
      own;
    if (available + 1e-9 < line.qty)
      throw new AppError(
        409,
        `${line.name}: không đủ tồn để giữ lại. Chưa thu thêm tiền.`,
        'POS_STOCK_SHORT',
      );
  }
  const a = await flowAccount(db, order),
    expiresAt = flowHoldUntil(
      now,
      a.saleFlow === 'prepaid' && a.remaining === 0,
    );
  await db
    .update(posOrderReservations)
    .set({
      status: 'active',
      expiresAt,
      updatedAt: now,
      closedAt: null,
      closedBy: null,
      closeReason: '',
    })
    .where(eq(posOrderReservations.orderId, order.id));
  await cashAudit(db, actor.id, 'hold-pos-order', 'orders', order.id, {
    previous: reservations.map((r) => ({ id: r.id, expiresAt: r.expiresAt })),
    expiresAt,
  });
}

export async function pickupFlowOrder(
  db: PosDb,
  order: typeof salesOrders.$inferSelect,
  actor: PosMember,
  key: string,
  shiftId: string,
) {
  if (saleFlowOf(order.posSnapshot) !== 'deposit')
    throw new AppError(400, 'Ship trả trước dùng luồng đóng gói/giao hàng.');
  await assertPosFlowFulfillable(db, order.id, true);
  await holdFlowOrder(db, order, actor);
  const lines = await db
    .select()
    .from(salesOrderLines)
    .where(eq(salesOrderLines.orderId, order.id));
  const [reservation] = await db
    .select()
    .from(posOrderReservations)
    .where(eq(posOrderReservations.orderId, order.id));
  const at = new Date().toISOString();
  await postMoves(
    db,
    actor.id,
    lines.map((l) => ({
      sku: l.sku,
      warehouseId: reservation!.warehouseId,
      qty: -l.qty,
      kind: 'issue' as const,
      refType: 'pos_order' as const,
      refId: order.id,
      refNo: order.orderNo,
      note: 'Thu đủ và nhận hàng đặt cọc',
    })),
    at,
  );
  await db
    .update(salesOrderLines)
    .set({ deliveredQty: sql`${salesOrderLines.qty}` })
    .where(eq(salesOrderLines.orderId, order.id));
  await db
    .update(posOrderReservations)
    .set({
      status: 'consumed',
      closedBy: actor.id,
      closedAt: at,
      updatedAt: at,
    })
    .where(eq(posOrderReservations.orderId, order.id));
  const snapshot = JSON.parse(order.posSnapshot || '{}');
  snapshot.pickupKey = key;
  snapshot.pickupShiftId = shiftId;
  await db
    .update(salesOrders)
    .set({
      status: 'delivered',
      holdsStock: false,
      posSnapshot: JSON.stringify(snapshot),
      updatedAt: at,
      revision: sql`${salesOrders.revision}+1`,
    })
    .where(eq(salesOrders.id, order.id));
  await cashAudit(db, actor.id, 'pickup-pos-order', 'orders', order.id, {
    key,
    shiftId,
    lines: lines.map((l) => ({ id: l.id, qty: l.qty })),
  });
}

export async function recordFlowMoney(
  db: PosDb,
  order: typeof salesOrders.$inferSelect,
  actor: PosMember,
  shiftId: string,
  key: string,
  amount: number,
  method: 'cash' | 'transfer',
  reference = '',
  kind = 'balance',
) {
  const [schedule] = await db
    .select()
    .from(paymentSchedules)
    .where(eq(paymentSchedules.orderId, order.id));
  const id = crypto.randomUUID(),
    at = new Date().toISOString();
  await db.insert(customerPayments).values({
    id,
    orderId: order.id,
    customerId: order.customerId,
    scheduleId: schedule?.id,
    shiftId,
    amount,
    method,
    requestKey: key,
    reference,
    paymentSource:
      kind === 'prepaid'
        ? 'pos_prepaid'
        : kind === 'deposit'
          ? 'pos_deposit'
          : 'pos_balance',
    note:
      kind === 'balance'
        ? 'Thu nốt đơn đặt cọc'
        : 'Xác nhận tiền cọc/trả trước',
    paidAt: vietnamDate().iso,
    createdBy: actor.id,
    createdAt: at,
  });
  await cashAudit(db, actor.id, 'collect-pos-order', 'orders', order.id, {
    paymentId: id,
    shiftId,
    amount,
    method,
    reference,
    kind,
  });
  return id;
}

export async function cancelFlowOrder(
  db: PosDb,
  order: typeof salesOrders.$inferSelect,
  actor: PosMember,
  shiftId: string,
  key: string,
  reason: string,
  kind: 'return' | 'exchange',
) {
  const snapshot = JSON.parse(order.posSnapshot || '{}');
  if (order.status === 'cancelled') {
    if (
      snapshot.cancelKey === key &&
      snapshot.cancelReason === reason &&
      snapshot.cancelKind === kind
    )
      return {
        id: order.id,
        returnId: snapshot.cancelReturnId || null,
        replayed: true,
      };
    const [priorReturn] = snapshot.cancelReturnId
      ? await db
          .select()
          .from(posReturns)
          .where(eq(posReturns.id, snapshot.cancelReturnId))
      : [];
    if (!priorReturn || !['cancelled', 'rejected'].includes(priorReturn.status))
      throw new AppError(
        409,
        'Đơn đã huỷ; xử lý phiếu hoàn/tín dụng liên kết.',
      );
  }
  await db.execute(sql`select pg_advisory_xact_lock(hashtext('stock_holds'))`);
  const [lines, packs, issues] = await Promise.all([
    db
      .select()
      .from(salesOrderLines)
      .where(eq(salesOrderLines.orderId, order.id)),
    db
      .select()
      .from(packingSlips)
      .where(
        and(
          eq(packingSlips.orderId, order.id),
          eq(packingSlips.status, 'packed'),
        ),
      ),
    db
      .select()
      .from(stockMoves)
      .where(
        and(
          eq(stockMoves.refType, 'pos_order'),
          eq(stockMoves.refId, order.id),
        ),
      ),
  ]);
  if (
    (await flowIssued(db, order.id)).some((i) => i.qty > 0) ||
    order.status === 'delivered' ||
    packs.length ||
    issues.length ||
    lines.some((l) => l.deliveredQty > 0)
  )
    throw new AppError(
      409,
      'Hàng đã đóng gói/xuất kho: lập yêu cầu trả hàng, không huỷ thẳng.',
      'POS_RETURN_REQUIRED',
    );
  const a = await flowAccount(db, order),
    at = new Date().toISOString(),
    [original] = await db
      .select()
      .from(posShifts)
      .where(eq(posShifts.id, order.shiftId!)),
    register = await registerOf(db, original!.registerId);
  let returnId: string | null = null;
  if (a.paid > 0) {
    returnId = crypto.randomUUID();
    await db.insert(posReturns).values({
      id: returnId,
      returnNo: 'TH-' + returnId.slice(0, 8).toUpperCase(),
      orderId: order.id,
      registerId: original!.registerId,
      warehouseId: register.warehouseId,
      createdShiftId: shiftId,
      requestContext: 'before_fulfillment',
      kind,
      status: 'pending',
      reason,
      subtotal: order.subtotal,
      tax: order.tax,
      total: order.total,
      requestKey: key,
      sourceSnapshot: JSON.stringify({
        order,
        lines,
        fees: {
          service: { amount: 0, subtotal: 0, tax: 0, taxRate: 0 },
          shippingFee: 0,
        },
        cancellation: true,
        paidAtCancellation: a.paid,
      }),
      createdBy: actor.id,
      createdAt: at,
      updatedAt: at,
    });
  }
  await db
    .update(posOrderReservations)
    .set({
      status: 'released',
      closedBy: actor.id,
      closedAt: at,
      closeReason: reason,
      updatedAt: at,
    })
    .where(
      and(
        eq(posOrderReservations.orderId, order.id),
        eq(posOrderReservations.status, 'active'),
      ),
    );
  await db
    .update(posPaymentIntents)
    .set({
      status: 'cancelled',
      cancelledBy: actor.id,
      cancelledAt: at,
      cancelReason: reason,
    })
    .where(
      and(
        eq(posPaymentIntents.orderId, order.id),
        eq(posPaymentIntents.status, 'pending'),
      ),
    );
  await db
    .update(deliveries)
    .set({ status: 'cancelled', updatedAt: at })
    .where(
      // Chuyến chưa xuất hàng (planned) hoặc giao thất bại đã quay về đều đóng theo đơn huỷ.
      and(eq(deliveries.orderId, order.id), inArray(deliveries.status, ['planned', 'failed'])),
    );
  await db
    .update(packingSlips)
    .set({ status: 'cancelled', updatedAt: at })
    .where(
      and(
        eq(packingSlips.orderId, order.id),
        inArray(packingSlips.status, ['draft', 'sent']),
      ),
    );
  Object.assign(snapshot, {
    cancelKey: key,
    cancelReason: reason,
    cancelKind: kind,
    cancelReturnId: returnId,
    cancelledAt: at,
  });
  await db
    .update(salesOrders)
    .set({
      status: 'cancelled',
      holdsStock: false,
      posSnapshot: JSON.stringify(snapshot),
      updatedAt: at,
      revision: sql`${salesOrders.revision}+1`,
    })
    .where(eq(salesOrders.id, order.id));
  await cashAudit(db, actor.id, 'cancel-pos-order', 'orders', order.id, {
    reason,
    returnId,
    paid: a.paid,
    kind,
  });
  return { id: order.id, returnId, replayed: false };
}
