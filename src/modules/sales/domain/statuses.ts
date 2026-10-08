/** Giá trị trạng thái của luồng bán hàng (dùng chung cho schema, API và kiểm tra ở DB). */
export const ORDER_STATUSES = ['draft', 'confirmed', 'delivering', 'delivered', 'cancelled'] as const;
export const CONTRACT_STATUSES = ['draft', 'signed', 'completed', 'cancelled'] as const;
export const DELIVERY_STATUSES = ['planned', 'in_transit', 'delivered', 'failed', 'cancelled'] as const;
export const SCHEDULE_KINDS = ['deposit', 'installment', 'balance'] as const;
export const PAYMENT_METHODS = ['transfer', 'cash', 'other'] as const;
export const LEGAL_ENTITIES = ['BN', 'VG', 'QTV'] as const;
/** Xuất hoá đơn của đơn hàng / HĐKT: chưa yêu cầu → đã yêu cầu (tự động khi giao xong, hoặc nhân viên bấm) → kế toán đã xuất (có số hoá đơn). */
export const INVOICE_STATUSES = ['none', 'requested', 'issued'] as const;
/** Phiếu đóng gói (xuất kho): nháp → đã gửi kho → kho đã đóng (có ảnh) / huỷ. */
export const PACKING_STATUSES = ['draft', 'sent', 'packed', 'cancelled'] as const;
/** Nguồn hàng của phiếu đóng gói: kho, điều chuyển từ cửa hàng, nhập từ NCC, đại lý, khác. */
export const PACKING_SOURCES = ['warehouse', 'store', 'supplier', 'agent', 'other'] as const;
/** Phiếu đóng gói giao tới: thẳng cho khách hoặc về xưởng in (đơn có phí in logo). */
export const SHIP_TO = ['customer', 'workshop'] as const;
/** Yêu cầu xuất hoá đơn: phát hành chính thức hay gửi bản nháp cho khách kiểm tra trước. */
export const INVOICE_MODES = ['issue', 'draft'] as const;
