/** Giá trị trạng thái của luồng bán hàng (dùng chung cho schema, API và kiểm tra ở DB). */
export const ORDER_STATUSES = ['draft', 'confirmed', 'delivering', 'delivered', 'cancelled'] as const;
export const CONTRACT_STATUSES = ['draft', 'signed', 'completed', 'cancelled'] as const;
export const DELIVERY_STATUSES = ['planned', 'in_transit', 'delivered', 'failed', 'cancelled'] as const;
export const SCHEDULE_KINDS = ['deposit', 'installment', 'balance'] as const;
export const PAYMENT_METHODS = ['transfer', 'cash', 'other'] as const;
export const LEGAL_ENTITIES = ['BN', 'VG', 'QTV'] as const;
/** Xuất hoá đơn của đơn hàng / HĐKT: chưa yêu cầu → đã yêu cầu (tự động khi giao xong, hoặc nhân viên bấm) → kế toán đã xuất (có số hoá đơn). */
export const INVOICE_STATUSES = ['none', 'requested', 'issued'] as const;
