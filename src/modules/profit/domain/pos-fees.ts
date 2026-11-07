/**
 * PHÍ ĐƠN POS cho phân tích lợi nhuận (giai đoạn 2 · PR-B) – hàm thuần.
 *  - Thu của khách: phí dịch vụ + phí ship trên bill POS (`posSnapshot.fees`), quy về CHƯA VAT, trừ phần đã hoàn khi trả hàng
 *    (phiếu trả có hiệu lực công nợ; số hoàn gồm VAT → quy theo tỉ lệ chưa VAT của bill).
 *  - Chi trả GHN: `posSnapshot.ghn.fee` – số GHN báo lúc tạo vận đơn (GIẢ ĐỊNH: đã gồm VAT, tính nguyên số vì chưa khấu trừ thuế đầu vào).
 *  - Chống tính hai lần: đơn CRM trừ phí ship qua lịch giao (`deliveries.shippingFee`, chỉ khi báo giá ghi bên bán trả); đơn POS
 *    không có báo giá nên phần đó luôn 0 → chỉ dùng `ghn.fee` ở đây. Phiếu chi sổ quỹ trả GHN (nếu có) KHÔNG tính là chi phí ở PR-D.
 *  - Phí quẹt thẻ / cổng thanh toán: CRM chưa ghi nhận thanh toán thẻ → chưa có dữ liệu, không tự đoán tỉ lệ.
 */
import { snapshotPosFees } from '../../sales/domain/pos-fees.ts';

export interface PosFeeFacts { feeRevenue: number; carrierFee: number; carrierKnown: boolean }
export function posFeeFacts(snapshotJson: string | null | undefined, refundedFeesGross: number): PosFeeFacts {
  let snap: { fees?: never; ghn?: { fee?: unknown; orderCode?: unknown } } = {};
  try { snap = JSON.parse(snapshotJson || '{}') ?? {}; } catch { snap = {}; }
  let feeRevenue = 0;
  if (snap.fees) {
    const f = snapshotPosFees(snap as never), net = f.subtotal, gross = f.total;
    const refundNet = gross > 0 ? Math.min(net, Math.max(0, refundedFeesGross) * net / gross) : 0;
    feeRevenue = Math.max(0, Math.round(net - refundNet));
  }
  const fee = Number(snap.ghn?.fee);
  const carrierKnown = !!snap.ghn && Number.isFinite(fee) && fee >= 0;
  return { feeRevenue, carrierFee: carrierKnown ? Math.round(fee) : 0, carrierKnown };
}
