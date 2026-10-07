/** Trang chi tiết khách hàng: số dòng tối đa mỗi mục (một chỗ để sửa). */
export const HUB_LIMITS = { orders: 300, quotes: 200, stockRequests: 50, purchases: 300 } as const;

export interface PurchaseLine { sku: string; name: string; unit: string; qty: number; unitPrice: number; amount: number; orderId: string; orderDate: string }
export interface PurchaseRow { sku: string; name: string; unit: string; qty: number; amount: number; orders: number; lastDate: string; lastPrice: number }

/**
 * Lịch sử mua hàng theo mặt hàng: gộp các dòng đơn (đã xác nhận) theo mã hàng (không có mã thì theo tên),
 * tổng số lượng / thành tiền, số đơn, lần mua gần nhất và đơn giá lần đó. Mặt hàng mua gần nhất lên đầu.
 */
export function purchaseHistory(lines: readonly PurchaseLine[]): PurchaseRow[] {
  const map = new Map<string, PurchaseRow & { orderIds: Set<string> }>();
  for (const l of lines) {
    const key = (l.sku || '').trim().toUpperCase() || 'name:' + l.name.trim().toLowerCase();
    let row = map.get(key);
    if (!row) map.set(key, row = { sku: l.sku, name: l.name, unit: l.unit, qty: 0, amount: 0, orders: 0, lastDate: '', lastPrice: 0, orderIds: new Set() });
    row.qty += l.qty; row.amount += l.amount; row.orderIds.add(l.orderId);
    if (l.orderDate >= row.lastDate) { row.lastDate = l.orderDate; row.lastPrice = l.unitPrice; row.name = l.name; }
  }
  return [...map.values()].map(({ orderIds, ...r }) => ({ ...r, orders: orderIds.size }))
    .sort((a, b) => b.lastDate.localeCompare(a.lastDate) || b.amount - a.amount).slice(0, HUB_LIMITS.purchases);
}
