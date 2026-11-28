import { AppError } from '../../../core/errors.ts';
import { posMoney } from './pos-money.ts';
/** Cumulative rounding gives the final partial return exactly the original remaining VNĐ. */
export function returnPortion(
  amount: number,
  qty: number,
  already: number,
  wanted: unknown,
  allocated = Math.round((amount * already) / qty),
) {
  const n = Number(wanted);
  if (
    wanted === '' ||
    wanted == null ||
    !Number.isFinite(n) ||
    n <= 0 ||
    Math.abs(n * 1000 - Math.round(n * 1000)) > 1e-6 ||
    n + already > qty + 1e-9
  )
    throw new AppError(
      400,
      'Số lượng trả vượt số hàng còn được trả hoặc không hợp lệ.',
    );
  return posMoney(
    n + already >= qty - 1e-9
      ? amount - allocated
      : Math.min(Math.round((amount * n) / qty), amount - allocated),
  );
}
export function returnBalance(
  due: number,
  paid: number,
  credit: number,
  refunded: number,
  exchanged: number,
) {
  const netDue = due - credit,
    netPaid = paid - refunded - exchanged;
  return {
    netDue,
    netPaid,
    balance: netDue - netPaid,
    available: Math.max(0, netPaid - netDue),
  };
}

export type RefundMethod = 'cash' | 'transfer';
/** Where the customer's money actually sits: drawer cash, bank, still at the carrier, return credit or a non-cash offset. */
export type PaymentChannel = RefundMethod | 'carrier' | 'credit' | 'other';
export function paymentChannel(p: { method: string; paymentSource: string }, settledToBank = false): PaymentChannel {
  if (p.paymentSource === 'pos_exchange_credit') return 'credit';
  if (p.paymentSource === 'ghn_cod') return settledToBank ? 'transfer' : 'carrier';
  if (p.paymentSource === 'ghn_fee_offset') return 'other';
  if (p.method === 'cash') return 'cash';
  if (p.method === 'transfer') return 'transfer';
  return 'other';
}
export interface RefundMethodBalance {
  paid: Record<PaymentChannel, number>;
  refunded: Record<RefundMethod, number>;
  /** Money that can go back the way it came in, before the order-level cap. */
  remaining: Record<RefundMethod, number>;
  defaultMethod: RefundMethod | null;
}
/** Original payment channel decides the refund channel; a different channel is an explicit Manager override. */
export function refundMethodBalance(
  payments: { amount: number; channel: PaymentChannel }[],
  refunds: { amount: number; method: string }[],
): RefundMethodBalance {
  const paid: Record<PaymentChannel, number> = { cash: 0, transfer: 0, carrier: 0, credit: 0, other: 0 };
  for (const p of payments) paid[p.channel] += p.amount;
  const refunded: Record<RefundMethod, number> = { cash: 0, transfer: 0 };
  for (const r of refunds) if (r.method === 'cash' || r.method === 'transfer') refunded[r.method] += r.amount;
  const remaining = {
    cash: Math.max(0, paid.cash - refunded.cash),
    transfer: Math.max(0, paid.transfer - refunded.transfer),
  };
  const defaultMethod: RefundMethod | null =
    remaining.cash > 0 && remaining.cash >= remaining.transfer ? 'cash' : remaining.transfer > 0 ? 'transfer' : null;
  return { paid, refunded, remaining, defaultMethod };
}
