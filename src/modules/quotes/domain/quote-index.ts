/**
 * Dữ liệu SUY RA từ báo giá đã làm sạch để lưu ở các cột tìm kiếm của `staff_quotations` và ở bảng `quote_lines`.
 * `data` (JSON) vẫn là bản chụp đầy đủ của tài liệu; các cột này chỉ phục vụ lọc/tìm/báo cáo và LUÔN được ghi cùng
 * lúc với `data` (cùng một lô D1) nên không bao giờ lệch. Hàm thuần.
 */
type Obj = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Bỏ dấu, đ→d, hạ chữ – cách bản cũ chuẩn hoá để tìm kiếm (không phân biệt dấu/hoa thường). */
export const searchText = (value: unknown): string =>
  String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[đĐ]/g, 'd').toLowerCase();

export interface QuoteHeaderIndex { quoteDate: string; searchText: string; contractNumber: string; contractQuoteNo: string; hasContract: 0 | 1 }

/** Port của `quoteSearchMetadata` bản cũ: văn bản tìm kiếm gộp từ số báo giá, khách, liên hệ, sản phẩm và hợp đồng; tối đa 20.000 ký tự. */
export function quoteHeaderIndex(data: Obj): QuoteHeaderIndex {
  const doc = data?.contractDocument || {};
  const contractNumber = String(doc.contractNumber || '').trim();
  const contractQuoteNo = String(doc.quoteNo || data?.quoteNo || '').trim();
  const products = (data.rows as Obj[]).map(r => [r.sku, r.name].join(' ')).join('\n');
  return {
    quoteDate: data.date || '',
    searchText: searchText([data.quoteNo, data.customer, data.customerTaxCode, data.customerCode, data.contact, data.phone, data.email, data.owner, products, contractNumber, contractQuoteNo].join(' ')).slice(0, 20000),
    contractNumber, contractQuoteNo, hasContract: contractNumber ? 1 : 0,
  };
}

export interface QuoteLineRow {
  id: string; quoteId: string; lineNo: number; sku: string; name: string; brand: string; unit: string; qty: number; price: number;
  discount: number; discountType: 'percent' | 'amount'; taxRate: number | null; printFee: number; costPrice: number; deliveryDate: string | null;
}

/** Dòng hàng chuẩn hoá cho bảng `quote_lines` (đánh số từ 1 theo thứ tự trên báo giá). Mọi trường liên quan đến tiền đều được giữ. */
export function quoteLineRows(quoteId: string, data: Obj): QuoteLineRow[] {
  return (data.rows as Obj[]).map((r, i) => ({
    id: r.id, quoteId, lineNo: i + 1, sku: r.sku ?? '', name: r.name ?? '', brand: r.brand ?? '', unit: r.unit ?? '',
    qty: r.qty ?? 0, price: r.price ?? 0, discount: r.discount ?? 0, discountType: r.discountType === 'amount' ? 'amount' : 'percent',
    taxRate: typeof r.taxRate === 'number' ? r.taxRate : null, printFee: r.printFee ?? 0, costPrice: r.costPrice ?? 0,
    deliveryDate: r.deliveryDate || r.delivery_date || null,
  }));
}
