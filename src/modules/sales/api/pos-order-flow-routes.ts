import { invoiceTasksChanged } from './invoice-task-hooks.ts';
import { foldSql, matchAllWords } from '../../../core/text/fold.ts';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { AppError } from '../../../core/errors.ts';
import type { Router, RouteContext } from '../../../core/http/router.ts';
import { json, readJson } from '../../../core/http/router.ts';
import type { SessionState, StaffEnv } from '../../staff/api/auth-routes.ts';
import { sha256Hex } from '../../staff/domain/session.ts';
import { salesOrders, customerPayments } from '../schema.ts';
import { posShifts } from '../pos-schema.ts';
import {
  posOrderReservations,
  posPaymentIntents,
} from '../pos-order-flow-schema.ts';
import { saleFlowOf, flowHoldUntil } from '../domain/pos-order-flow.ts';
import { posMoney } from '../domain/pos-money.ts';
import {
  checkout,
  assertOpen,
  posPermission,
  posKey,
  posText,
  saleShiftOf,
} from './pos-store.ts';
import { cashAudit, cashLock } from './cash-store.ts';
import { allowedRegister, allowedDrawer } from './pos-access.ts';
import {
  flowAccount,
  flowAccounts,
  flowCurrent,
  holdFlowOrder,
  pickupFlowOrder,
  recordFlowMoney,
  cancelFlowOrder,
} from './pos-order-flow-store.ts';
import { notifyPosOrderCreated } from './pos-notifications.ts';
import type { PosDb } from './pos-store.ts';
type Ctx = RouteContext<StaffEnv>;
const actor = (c: Ctx) => (c.state.session as SessionState).member;
async function source(c: Ctx, db: PosDb, id: string) {
  posPermission(actor(c));
  const [o] = await db.select().from(salesOrders).where(eq(salesOrders.id, id));
  if (!o || o.channel !== 'pos' || !saleFlowOf(o.posSnapshot) || !o.shiftId)
    throw new AppError(404, 'Không tìm thấy đơn cọc/trả trước.');
  const [s] = await db
    .select()
    .from(posShifts)
    .where(eq(posShifts.id, o.shiftId));
  if (!s) throw new AppError(404, 'Thiếu ca gốc.');
  if (!allowedRegister(c, s.registerId) || !allowedDrawer(c, s.cashDrawerId))
    throw new AppError(403, 'Đơn thuộc cửa hàng khác.');
  return o;
}
export function registerPosOrderFlowRoutes(router: Router<StaffEnv>) {
  // A distinct write path makes new UI fail closed against an older/rolled-back API.
  router.post(
    '/pos/order-flows/checkout',
    async (c) => {
      const body = await readJson(c.req, 64000);
      if (!saleFlowOf(body))
        throw new AppError(400, 'Chọn Đặt cọc hoặc Ship trả trước.');
      const member = actor(c);
      const result = await checkout(c.env, member, body);
      await notifyPosOrderCreated(c.env, member, result);
      return json(result, 201);
    },
    'business',
  );

  router.get(
    '/pos/order-flows',
    async (c) => {
      posPermission(actor(c));
      const s = await saleShiftOf(
        c.env.db,
        actor(c),
        posText(c.url.searchParams.get('shiftId')),
      );
      assertOpen(s, actor(c));
      if (
        !allowedRegister(c, s.registerId) ||
        !allowedDrawer(c, s.cashDrawerId)
      )
        throw new AppError(403, 'Ca thuộc cửa hàng khác.');
      const offset = Number(c.url.searchParams.get('offset') || 0);
      if (!Number.isSafeInteger(offset) || offset < 0 || offset > 100000)
        throw new AppError(400, 'Trang không hợp lệ.');
      const rows = await c.env.db
        .select({ o: salesOrders })
        .from(salesOrders)
        .innerJoin(posShifts, eq(posShifts.id, salesOrders.shiftId))
        .where(
          and(
            eq(salesOrders.channel, 'pos'),
            eq(posShifts.registerId, s.registerId),
            c.url.searchParams.get('status') === 'all'
              ? undefined
              : inArray(salesOrders.status, [
                  'draft',
                  'confirmed',
                  'delivering',
                ]),
            matchAllWords(
              foldSql(
                salesOrders.orderNo,
                salesOrders.customerName,
                salesOrders.phone,
              ),
              c.url.searchParams.get('q'),
            ),
            sql`${salesOrders.posSnapshot}::jsonb->>'saleFlow' in ('deposit','prepaid')`,
          ),
        )
        .orderBy(desc(salesOrders.createdAt), desc(salesOrders.id))
        .limit(101)
        .offset(offset);
      return json({
        orders: await flowAccounts(
          c.env.db,
          rows.slice(0, 100).map(({ o }) => o),
        ),
        nextOffset: rows.length > 100 ? offset + 100 : null,
      });
    },
    'business',
  );
  router.get(
    '/pos/order-flows/:id',
    async (c) =>
      json(
        await flowAccount(c.env.db, await source(c, c.env.db, c.params.id!)),
      ),
    'business',
  );
  router.post(
    '/pos/order-flows/:id/hold',
    async (c) => {
      const b = await readJson(c.req, 4000);
      return json(
        await c.env.db.transaction(async (tx) => {
          await cashLock(tx);
          const o = await source(c, tx, c.params.id!);
          await flowCurrent(tx, actor(c), posText(b.shiftId), o);
          await holdFlowOrder(tx, o, actor(c));
          return flowAccount(tx, o);
        }),
      );
    },
    'business',
  );
  router.post(
    '/pos/order-flows/:id/collect',
    async (c) => {
      const b = await readJson(c.req, 6000),
        key = posKey(b.key),
        method = b.method;
      if (!['cash', 'transfer'].includes(String(method)))
        throw new AppError(400, 'Chọn tiền mặt/chuyển khoản.');
      const hash = sha256Hex(
        JSON.stringify({
          orderId: c.params.id,
          amount: b.amount,
          method,
          pickup: b.pickup === true,
          confirmed: b.confirmed === true,
          shiftId: b.shiftId,
          reference: b.reference || '',
        }),
      );
      const result = await c.env.db.transaction(async (tx) => {
          await cashLock(tx);
          const o = await source(c, tx, c.params.id!),
            s = await flowCurrent(tx, actor(c), posText(b.shiftId), o),
            snap = JSON.parse(o.posSnapshot || '{}');
          const [prior] = await tx
            .select()
            .from(customerPayments)
            .where(eq(customerPayments.requestKey, key));
          const [intent] = await tx
            .select()
            .from(posPaymentIntents)
            .where(eq(posPaymentIntents.requestKey, key));
          if (prior || intent || snap.pickupKey === key) {
            if (
              (intent && intent.requestHash !== hash) ||
              (prior &&
                (snap.collectRequests?.[key] !== hash ||
                  prior.orderId !== o.id ||
                  prior.amount !== Number(b.amount) ||
                  prior.method !== method ||
                  prior.shiftId !== s.id)) ||
              (snap.pickupKey === key && snap.pickupHash !== hash)
            )
              throw new AppError(
                409,
                'Mã giao dịch đã dùng cho nội dung khác.',
              );
            return { ...(await flowAccount(tx, o)), replayed: true };
          }
          if (o.status === 'cancelled' || o.status === 'delivered')
            throw new AppError(409, 'Đơn đã huỷ hoặc đã nhận hàng.');
          const a = await flowAccount(tx, o),
            amount = posMoney(b.amount, 'Số tiền thực thu');
          if (
            amount > a.remaining ||
            (!amount && !(b.pickup === true && a.remaining === 0))
          )
            throw new AppError(
              400,
              'Số thu phải dương và không vượt số còn phải thu.',
            );
          if (a.saleFlow === 'prepaid' && amount !== a.remaining)
            throw new AppError(
              400,
              'Ship trả trước phải thu đủ phần còn lại, không thu COD.',
            );
          await holdFlowOrder(tx, o, actor(c));
          if (amount && method === 'transfer' && b.confirmed !== true) {
            if (a.pending)
              throw new AppError(
                409,
                'Đã có khoản chờ xác nhận. Xác nhận hoặc huỷ khoản cũ trước.',
              );
            await tx.insert(posPaymentIntents).values({
              id: crypto.randomUUID(),
              orderId: o.id,
              requestedShiftId: s.id,
              kind: a.saleFlow === 'prepaid' ? 'prepaid' : 'balance',
              method: 'transfer',
              amount,
              requestKey: key,
              requestHash: hash,
              status: 'pending',
              createdBy: actor(c).id,
              createdAt: new Date().toISOString(),
            });
            await cashAudit(
              tx,
              actor(c).id,
              'request-pos-transfer',
              'orders',
              o.id,
              { key, amount, shiftId: s.id },
            );
          } else {
            if (amount)
              await recordFlowMoney(
                tx,
                o,
                actor(c),
                s.id,
                key,
                amount,
                method as 'cash' | 'transfer',
                posText(b.reference, 200),
                a.saleFlow === 'prepaid' ? 'prepaid' : 'balance',
              );
            const updated = await flowAccount(tx, o);
            if (updated.saleFlow === 'prepaid' && updated.remaining === 0)
              await tx
                .update(posOrderReservations)
                .set({
                  expiresAt: flowHoldUntil(new Date().toISOString(), true),
                  updatedAt: new Date().toISOString(),
                })
                .where(eq(posOrderReservations.orderId, o.id));
            if (b.pickup === true && updated.remaining === 0) {
              await pickupFlowOrder(tx, o, actor(c), key, s.id);
              const [saved] = await tx
                .select()
                .from(salesOrders)
                .where(eq(salesOrders.id, o.id));
              const data = JSON.parse(saved!.posSnapshot || '{}');
              data.pickupHash = hash;
              await tx
                .update(salesOrders)
                .set({ posSnapshot: JSON.stringify(data) })
                .where(eq(salesOrders.id, o.id));
            }
          }
          const [updated] = await tx
            .select()
            .from(salesOrders)
            .where(eq(salesOrders.id, o.id));
          if (
            !intent &&
            !(method === 'transfer' && b.confirmed !== true && amount > 0)
          ) {
            const saved = JSON.parse(updated!.posSnapshot || '{}');
            saved.collectRequests = { ...saved.collectRequests, [key]: hash };
            await tx
              .update(salesOrders)
              .set({ posSnapshot: JSON.stringify(saved) })
              .where(eq(salesOrders.id, o.id));
          }
          return flowAccount(tx, updated!);
        });
      await invoiceTasksChanged(c.env, { orderId: c.params.id! }, actor(c).id);
      return json(result, 201);
    },
    'business',
  );
  router.post(
    '/pos/order-flow-intents/:id/confirm',
    async (c) => {
      const b = await readJson(c.req, 4000);
      if (b.confirmed !== true)
        throw new AppError(400, 'Xác nhận cửa hàng đã thực nhận chuyển khoản.');
      const reference = posText(b.reference, 200);
      if (!reference)
        throw new AppError(400, 'Nhập mã tham chiếu chuyển khoản.');
      return json(
        await c.env.db.transaction(async (tx) => {
          await cashLock(tx);
          const [i] = await tx
            .select()
            .from(posPaymentIntents)
            .where(eq(posPaymentIntents.id, c.params.id!));
          if (!i) throw new AppError(404, 'Không tìm thấy khoản chờ.');
          const o = await source(c, tx, i.orderId),
            s = await flowCurrent(tx, actor(c), posText(b.shiftId), o);
          if (i.status === 'confirmed') {
            if (i.reference !== reference)
              throw new AppError(
                409,
                'Khoản thu đã xác nhận với tham chiếu khác.',
              );
            return { ...(await flowAccount(tx, o)), replayed: true };
          }
          if (i.status !== 'pending' || o.status === 'cancelled')
            throw new AppError(409, 'Yêu cầu đã huỷ.');
          const a = await flowAccount(tx, o);
          if (i.amount > a.remaining)
            throw new AppError(
              409,
              'Đơn đã có khoản thu khác; đối chiếu trước khi ghi thêm.',
            );
          const paymentId = await recordFlowMoney(
            tx,
            o,
            actor(c),
            s.id,
            i.requestKey,
            i.amount,
            'transfer',
            reference,
            i.kind,
          );
          const at = new Date().toISOString();
          await tx
            .update(posPaymentIntents)
            .set({
              status: 'confirmed',
              confirmedBy: actor(c).id,
              confirmedAt: at,
              confirmedShiftId: s.id,
              paymentId,
              reference,
            })
            .where(eq(posPaymentIntents.id, i.id));
          if (a.saleFlow === 'prepaid' && i.amount === a.remaining) {
            try {
              await holdFlowOrder(tx, o, actor(c));
            } catch (error) {
              if (
                !(error instanceof AppError) ||
                error.code !== 'POS_STOCK_SHORT'
              )
                throw error;
            }
          }
          return flowAccount(tx, o);
        }),
      );
    },
    'business',
  );
  router.post(
    '/pos/order-flow-intents/:id/cancel',
    async (c) => {
      const b = await readJson(c.req, 4000),
        reason = posText(b.reason, 2000);
      if (!reason) throw new AppError(400, 'Nhập lý do huỷ khoản chờ.');
      return json(
        await c.env.db.transaction(async (tx) => {
          await cashLock(tx);
          const [i] = await tx
            .select()
            .from(posPaymentIntents)
            .where(eq(posPaymentIntents.id, c.params.id!));
          if (!i) throw new AppError(404, 'Không tìm thấy khoản chờ.');
          const o = await source(c, tx, i.orderId);
          await flowCurrent(tx, actor(c), posText(b.shiftId), o);
          if (i.status === 'confirmed')
            throw new AppError(409, 'Đã thu tiền: không dùng huỷ khoản chờ.');
          if (i.status === 'pending') {
            await tx
              .update(posPaymentIntents)
              .set({
                status: 'cancelled',
                cancelledBy: actor(c).id,
                cancelledAt: new Date().toISOString(),
                cancelReason: reason,
              })
              .where(eq(posPaymentIntents.id, i.id));
            await cashAudit(
              tx,
              actor(c).id,
              'cancel-pos-transfer',
              'orders',
              o.id,
              { intentId: i.id, reason },
            );
          }
          return flowAccount(tx, o);
        }),
      );
    },
    'business',
  );
  router.post(
    '/pos/order-flows/:id/cancel',
    async (c) => {
      const b = await readJson(c.req, 6000),
        key = posKey(b.key),
        reason = posText(b.reason, 2000);
      if (!reason) throw new AppError(400, 'Nhập lý do huỷ đơn.');
      if (!['return', 'exchange'].includes(String(b.kind)))
        throw new AppError(
          400,
          'Chọn đề nghị hoàn tiền hoặc tín dụng đổi hàng.',
        );
      return json(
        await c.env.db.transaction(async (tx) => {
          await cashLock(tx);
          const o = await source(c, tx, c.params.id!),
            s = await flowCurrent(tx, actor(c), posText(b.shiftId), o);
          return cancelFlowOrder(
            tx,
            o,
            actor(c),
            s.id,
            key,
            reason,
            b.kind as 'return' | 'exchange',
          );
        }),
      );
    },
    'business',
  );
}
