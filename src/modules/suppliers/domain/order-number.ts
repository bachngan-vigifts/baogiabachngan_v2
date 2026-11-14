/** Match supplier names, never product brands or SKU text. */
export function requiresSupplierOrderNumber(name: string | null | undefined): boolean {
  const normalized = (name || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  return /(?:^|[^a-z0-9])minh\s*long(?:$|[^a-z0-9])/.test(normalized);
}
export function supplierOrderNumberProblem(name: string | null | undefined, value: unknown, required = false): string {
  if (value !== undefined && typeof value !== 'string') return 'Số đơn phía NCC phải là văn bản.';
  const number = typeof value === 'string' ? value.trim() : '';
  if (number.length > 100) return 'Số đơn phía NCC tối đa 100 ký tự.';
  if (required && requiresSupplierOrderNumber(name) && !number) return 'Nhập số đơn phía NCC Minh Long trước khi duyệt đơn.';
  return '';
}
