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
