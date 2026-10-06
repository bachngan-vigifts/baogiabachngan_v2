/** Loại chứng từ kho lấy từ Sapo: đơn nhập hàng, đơn điều chuyển, phiếu kiểm hàng, đơn khách trả hàng, phiếu trả hàng nhà cung cấp. */
export const SAPO_DOC_KINDS = ['purchase_order', 'stock_transfer', 'stock_adjustment', 'order_return', 'purchase_return'] as const;
export type SapoDocKind = typeof SAPO_DOC_KINDS[number];

/** Đường dẫn danh sách Sapo admin và khoá mảng trong phản hồi của từng loại chứng từ. */
export const SAPO_DOC_SOURCES: Record<SapoDocKind, { path: string; key: string; label: string }> = {
  purchase_order: { path: '/purchase_orders.json', key: 'purchase_orders', label: 'Đơn nhập hàng' },
  stock_transfer: { path: '/stock_transfers.json', key: 'stock_transfers', label: 'Đơn điều chuyển' },
  stock_adjustment: { path: '/stock_adjustments.json', key: 'stock_adjustments', label: 'Phiếu kiểm hàng' },
  // Trả hàng: đường dẫn theo quy ước Sapo admin; nếu Sapo không cho đọc thì lượt đồng bộ chỉ ghi cảnh báo.
  order_return: { path: '/order_returns.json', key: 'order_returns', label: 'Đơn khách trả hàng' },
  purchase_return: { path: '/purchase_returns.json', key: 'purchase_returns', label: 'Phiếu trả hàng nhà cung cấp' },
};

type Raw = Record<string, any>;
const str = (v: unknown) => (v === undefined || v === null ? '' : String(v)).trim();
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
const first = (o: Raw, ...keys: string[]) => { for (const k of keys) { const v = o?.[k]; if (v !== undefined && v !== null && v !== '') return v; } return undefined; };
const nameOf = (v: unknown) => typeof v === 'object' && v ? str((v as Raw).name ?? (v as Raw).label) : str(v);

export interface SapoDocLine { lineNo: number; sku: string; variantId: string; name: string; qty: number; diffQty: number | null; price: number | null }
export interface SapoDoc {
  id: string; kind: SapoDocKind; sapoId: string; code: string; status: string; locationName: string; toLocationName: string; partnerName: string;
  totalQty: number; totalAmount: number; note: string; createdOn: string | null; modifiedOn: string | null; data: string; lines: SapoDocLine[];
}

/**
 * Chứng từ kho Sapo → bản ghi của app. Sapo đặt tên trường không thống nhất giữa các loại phiếu
 * nên đọc lần lượt các tên hay gặp; thiếu `id` thì bỏ (trả null).
 */
export function mapSapoDoc(kind: SapoDocKind, raw: Raw, locations: Map<string, string> = new Map()): SapoDoc | null {
  const sapoId = str(raw?.id); if (!sapoId) return null;
  const loc = (id: unknown, obj?: unknown) => nameOf(obj) || locations.get(str(id)) || str(id);
  const fromId = kind === 'stock_transfer' ? first(raw, 'source_location_id', 'from_location_id', 'location_id') : first(raw, 'location_id', 'branch_id');
  const fromObj = kind === 'stock_transfer' ? first(raw, 'source_location', 'from_location') : first(raw, 'location', 'branch');
  const toId = kind === 'stock_transfer' ? first(raw, 'destination_location_id', 'to_location_id', 'target_location_id') : undefined;
  const toObj = kind === 'stock_transfer' ? first(raw, 'destination_location', 'to_location', 'target_location') : undefined;
  const items: Raw[] = (first(raw, 'line_items', 'items', 'stock_transfer_line_items', 'stock_adjustment_line_items', 'order_return_line_items', 'return_line_items', 'variants') as Raw[] | undefined) ?? [];
  const lines: SapoDocLine[] = (Array.isArray(items) ? items : []).map((it, i) => {
    const qty = num(kind === 'stock_adjustment'
      ? first(it, 'actual_quantity', 'after_quantity', 'real_quantity', 'counted_quantity', 'quantity')
      : first(it, 'quantity', 'qty')) ?? 0;
    const diff = kind === 'stock_adjustment' ? num(first(it, 'adjustment_quantity', 'difference_quantity', 'difference', 'diff_quantity', 'variance')) : null;
    return {
      lineNo: i + 1, sku: str(first(it, 'sku', 'variant_sku')), variantId: str(first(it, 'variant_id', 'id')),
      name: str(first(it, 'variant_name', 'product_name', 'name', 'title')), qty, diffQty: diff, price: num(first(it, 'price', 'cost_price', 'unit_price')),
    };
  });
  const totalQty = num(first(raw, 'total_quantity', 'quantity')) ?? lines.reduce((s, l) => s + l.qty, 0);
  const totalAmount = num(first(raw, 'total', 'total_price', 'total_amount', 'grand_total')) ?? lines.reduce((s, l) => s + l.qty * (l.price ?? 0), 0);
  let data = JSON.stringify(raw);
  if (data.length > 200_000) data = JSON.stringify({ ...raw, line_items: undefined, items: undefined, truncated: true });
  return {
    id: `${kind}:${sapoId}`, kind, sapoId, code: str(first(raw, 'code', 'name', 'reference_number')) || sapoId, status: str(first(raw, 'status', 'state')),
    locationName: loc(fromId, fromObj), toLocationName: kind === 'stock_transfer' ? loc(toId, toObj) : '',
    partnerName: kind === 'purchase_order' || kind === 'purchase_return' ? nameOf(first(raw, 'supplier', 'supplier_name', 'vendor'))
      : kind === 'order_return' ? nameOf(first(raw, 'customer', 'customer_name', 'billing_address')) : '',
    totalQty, totalAmount, note: str(first(raw, 'note', 'description')).slice(0, 4000),
    createdOn: str(first(raw, 'created_on', 'created_at', 'issued_on')) || null, modifiedOn: str(first(raw, 'modified_on', 'updated_at', 'modified_at')) || null,
    data, lines,
  };
}
