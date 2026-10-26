/** Shared POS customer requirement; previewing products does not require a selection. */
export { canListRetailCustomers } from '../../customers/domain/customer-config.ts';
export function posCustomerIssue(customer: { id?: unknown; name?: unknown } | null | undefined): string | null {
  if (!customer || typeof customer.id !== 'string' || !customer.id.trim() || typeof customer.name !== 'string' || !customer.name.trim())
    return 'Vui lòng chọn hoặc tạo khách hàng cụ thể trước khi thanh toán.';
  const name = customer.name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[đĐ]/g, 'd').toLowerCase().trim().replace(/\s+/g, ' ');
  return ['khach le', 'khach hang le', 'khach vang lai'].includes(name)
    ? 'Vui lòng nhập khách hàng cụ thể, không sử dụng hồ sơ Khách lẻ hoặc Khách vãng lai.' : null;
}
