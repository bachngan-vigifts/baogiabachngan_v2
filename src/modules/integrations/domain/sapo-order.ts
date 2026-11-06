/**
 * ĐẨY ĐƠN HÀNG SANG SAPO – dữ liệu gửi n8n → OpenClaw (UI Sapo) và kiểm tra trước khi gửi.
 * CRM không tự tạo đơn trên Sapo nữa (đường tạo đơn trực tiếp đã gỡ); OpenClaw tạo đơn nháp, mã đơn = số HĐKT nếu có, còn lại số đơn web.
 */
export interface SapoPushCustomer { sapoId: number | null; name: string; customerCode: string; taxCode: string; phone: string; email: string; contact: string; address: string }
export interface SapoPushLine { sku: string; name: string; unit: string; qty: number; unitPrice: number; taxRate: number }
export interface SapoPushInput {
  code: string; orderNo: string; quoteNo: string; quoteType: string; contractNo: string;
  customer: SapoPushCustomer; lines: SapoPushLine[];
  ownerName: string; ownerPhone: string; expectedDeliveryDate: string | null;
  subtotal: number; tax: number; total: number;
}

/** Lỗi dữ liệu trước khi gọi Sapo (trả nguyên văn cho nhân viên). Rỗng = đẩy được. */
export function sapoPushProblems(input: SapoPushInput, options: { requireCode?: boolean } = {}): string[] {
  const out: string[] = [];
  if (options.requireCode !== false && !input.code) out.push('Chưa có số đơn hàng / HĐKT.');
  if (!input.customer.name && !input.customer.phone && !input.customer.email && !input.customer.customerCode) out.push('Đơn chưa có thông tin khách hàng.');
  if (!input.lines.length) out.push('Đơn chưa có sản phẩm.');
  if (input.lines.length > 300) out.push('Đơn quá 300 dòng – Sapo không nhận.');
  const noSku = input.lines.map((l, i) => l.sku ? 0 : i + 1).filter(Boolean);
  if (noSku.length) out.push(`Dòng ${noSku.join(', ')} chưa có mã SKU – Sapo cần SKU cho mỗi sản phẩm.`);
  return out;
}
