/**
 * PHÂN QUYỀN THEO CHỨC VỤ (docs/PHAN-QUYEN.md).
 * Mỗi chức vụ có một tập quyền (bảng `staff_position_permissions`) + phạm vi dữ liệu (`staff_positions.data_scope`).
 * Manager luôn có mọi quyền (không tự khoá mình được). NCC / khách hàng không dùng bảng này (khu vực riêng).
 * Mặc định (`defaults`) = đúng quyền đang chạy trước khi có trang phân quyền – migration 0065 ghi đúng các giá trị này.
 */
export interface PermissionDef { key: string; group: string; label: string; hint?: string; defaults: readonly string[] }

const SALES = ['sale', 'sale-admin', 'sales-ml', 'sales-lock'] as const;
const OFFICE = [...SALES, 'accounting'] as const;
const ALL = [...OFFICE, 'warehouse'] as const;
/** Sale Admin TẠM THỜI có quyền của Sale + Kế toán + Kho (yêu cầu 17/10/2026). Kế toán không vào Báo giá / Chăm sóc KH / Khách hỏi tồn (migration 0071).
 * Sổ thu / chi, Huỷ phiếu thu, Doanh số toàn công ty: chỉ Kế toán – Sale Admin chỉ xem toàn công ty ở báo giá, khách, đơn, HĐKT. */
const KHO = ['warehouse', 'sale-admin'] as const, KE_TOAN = ['accounting', 'sale-admin'] as const;

export const PERMISSIONS: readonly PermissionDef[] = [
  { key: 'pos.sell', group: 'Bán hàng nhanh', label: 'POS – bán, mở/kết ca, thu COD của quầy', defaults: SALES },
  { key: 'pos.configure', group: 'Bán hàng nhanh', label: 'POS – cấu hình quầy và ca', defaults: [] },
  { key: 'page.quotes', group: 'Trang được vào', label: 'Báo giá', defaults: SALES },
  { key: 'page.orders', group: 'Trang được vào', label: 'Đơn đặt hàng', defaults: OFFICE },
  { key: 'page.contracts', group: 'Trang được vào', label: 'HĐKT', defaults: OFFICE },
  { key: 'page.deliveries', group: 'Trang được vào', label: 'Lịch giao hàng', defaults: ALL },
  { key: 'page.receivables', group: 'Trang được vào', label: 'Công nợ', defaults: OFFICE },
  { key: 'page.customers', group: 'Trang được vào', label: 'Khách hàng', hint: 'Danh bạ, hồ sơ khách. Tắt vẫn chọn được khách khi lập báo giá / đơn.', defaults: OFFICE },
  { key: 'page.care', group: 'Trang được vào', label: 'Chăm sóc KH', defaults: SALES },
  { key: 'page.stock-requests', group: 'Trang được vào', label: 'Khách hỏi tồn', defaults: SALES },
  { key: 'page.dashboard', group: 'Trang được vào', label: 'Tổng quan doanh số', defaults: OFFICE },
  { key: 'page.flow', group: 'Trang được vào', label: 'Sơ đồ quy trình', defaults: OFFICE },
  { key: 'page.purchases', group: 'Trang được vào', label: 'Đơn mua NCC', defaults: ALL },
  { key: 'page.packing', group: 'Kho', label: 'Phiếu đóng gói – xem tất cả, xác nhận đóng xong', hint: 'Không có quyền này: chỉ xem phiếu của đơn mình phụ trách.', defaults: KHO },
  { key: 'page.stock-lookup', group: 'Kho', label: 'Tra tồn (không giá)', defaults: KHO },
  { key: 'inventory.view', group: 'Kho', label: 'Sổ kho – xem', defaults: [] },
  { key: 'inventory.manage', group: 'Kho', label: 'Sổ kho – chốt tồn đầu kỳ, phiếu điều chỉnh', defaults: [] },
  { key: 'purchases.receive', group: 'Kho', label: 'Nhận hàng NCC về kho', defaults: KHO },
  { key: 'purchases.prices', group: 'Tài chính NCC', label: 'Xem giá mua NCC', defaults: KE_TOAN },
  { key: 'purchases.pay', group: 'Tài chính NCC', label: 'Ghi thanh toán / lịch trả NCC', defaults: KE_TOAN },
  { key: 'suppliers.edit', group: 'Tài chính NCC', label: 'Danh bạ NCC – xem, sửa', defaults: KE_TOAN },
  { key: 'page.cash', group: 'Sổ quỹ', label: 'Két chung cửa hàng', defaults: [...SALES, 'accounting'] },
  { key: 'cash.view-all', group: 'Sổ quỹ', label: 'Xem tất cả phiếu và ca két', defaults: ['accounting'] },
  { key: 'page.cashbook', group: 'Kế toán', label: 'Sổ thu / chi', hint: 'Phiếu thu khách + phiếu chi NCC theo ngày, xuất Excel để đối soát ngân hàng.', defaults: ['accounting'] },
  { key: 'payments.void', group: 'Kế toán', label: 'Huỷ phiếu thu ghi nhầm', hint: 'Bắt buộc ghi lý do; phiếu huỷ vẫn giữ trong lịch sử.', defaults: ['accounting'] },
  { key: 'dashboard.all', group: 'Kế toán', label: 'Doanh số toàn công ty', hint: 'Tổng quan doanh số xem cả công ty (không có: chỉ doanh số của mình).', defaults: ['accounting'] },
  { key: 'perm.manage', group: 'Quản trị', label: 'Quản lý phân quyền (trang này)', hint: 'Sửa phòng ban, chức vụ và bảng quyền. Không đụng được chức vụ Manager.', defaults: [] },
];
export const PERMISSION_KEYS = new Set(PERMISSIONS.map(p => p.key));

/** Phạm vi dữ liệu (báo giá, đơn, khách, chăm sóc, doanh số…) của người KHÔNG phải Manager. */
export const DATA_SCOPES = ['own', 'position', 'department', 'all'] as const;
export type DataScope = typeof DATA_SCOPES[number];
export const DATA_SCOPE_LABEL: Record<DataScope, string> = {
  own: 'Chỉ của mình', position: 'Cùng chức vụ', department: 'Cả phòng ban', all: 'Toàn công ty (chỉ xem)',
};
export const defaultScope = (positionId: string | null | undefined): DataScope => positionId === 'sale-admin' ? 'all' : 'position';

/** Chức vụ hệ thống: không sửa quyền / không xoá trên trang phân quyền. */
export const SYSTEM_POSITIONS = new Set(['manager', 'supplier', 'customer']);

export interface PermissionMember { role: string; positionId?: string | null; perms?: readonly string[] | null; dataScope?: string | null }

/**
 * Có quyền `key` không. Phiên đăng nhập mang sẵn `perms` (đọc từ bảng); đối tượng không có `perms`
 * (test, dữ liệu dựng tay) dùng quyền mặc định theo chức vụ – cùng kết quả với dữ liệu mới chạy migration.
 */
export function can(m: PermissionMember | null | undefined, key: string): boolean {
  if (!m) return false;
  if (m.role === 'manager') return true;
  if (m.role !== 'employee') return false;
  if (m.perms) return m.perms.includes(key);
  return PERMISSIONS.find(p => p.key === key)?.defaults.includes(m.positionId ?? '') ?? false;
}

/**
 * PHÊ DUYỆT (báo giá, khách hàng mới, sản phẩm mới, đơn hàng / HĐKT, đơn mua NCC, hộp "Cần duyệt"):
 * CHỈ Manager hoặc nhân viên được Manager bật cờ "Được duyệt" (`staff_members.can_approve`, trang Nhân viên).
 * Không nằm trong bảng quyền theo chức vụ – người có quyền "Quản lý phân quyền" không tự cấp duyệt được.
 * Đối tượng không mang cờ (dữ liệu dựng tay) coi như không được duyệt.
 */
export const canApprove = (m: { role: string; approver?: boolean | null } | null | undefined): boolean =>
  Boolean(m && (m.role === 'manager' || (m.role === 'employee' && m.approver === true)));

export const scopeOf = (m: PermissionMember): DataScope =>
  (DATA_SCOPES as readonly string[]).includes(m.dataScope ?? '') ? m.dataScope as DataScope : defaultScope(m.positionId);

/**
 * Quyền trang cho từng API (chỉ áp cho nhân viên – Manager đi thẳng; NCC / khách đã bị chặn theo khu vực).
 * Trả về danh sách quyền, có MỘT trong số đó là được; null = không giới hạn (Công việc, Sản phẩm, Chat, Tra tồn, số liệu Sơ đồ quy trình…).
 * Ô chọn khách ở báo giá / đơn / chăm sóc vẫn dùng được khi tắt trang Khách hàng.
 */
export function routePermission(method: string, path: string, query: URLSearchParams): readonly string[] | null {
  const p = path.replace(/^.*?\/api\/staff(?=\/|$)/, '');
  const is = (re: RegExp) => re.test(p);
  // Review endpoints also admit Sổ quỹ viewers; handlers still require canApprove or pos.sell.
  if (is(/^\/pos\/(returns|exchanges)(\/|$)/)) return ['pos.sell', 'pos.configure', 'page.cash'];
  if (is(/^\/pos(\/|$)/)) return ['pos.sell', 'pos.configure'];
  if (is(/^\/(quotes|quote-docs)(\/|$)/)) return ['page.quotes'];
  if (is(/^\/(orders|order-quote-candidates|payments)(\/|$)/)) return ['page.orders', 'page.contracts', 'page.receivables'];
  if (is(/^\/contracts(\/|$)/)) return ['page.contracts', 'page.orders'];
  if (is(/^\/deliveries(\/|$)/)) return ['page.deliveries', 'page.orders', 'page.contracts'];
  if (is(/^\/receivables(\/|$)/)) return ['page.receivables'];
  if (is(/^\/cash(\/|$)/)) return ['page.cash', 'pos.sell'];
  if (is(/^\/cashbook(\/|$)/)) return ['page.cashbook'];
  if (is(/^\/care(\/|$)/)) return ['page.care'];
  if (is(/^\/stock-requests(\/|$)/)) return ['page.stock-requests'];
  if (is(/^\/dashboard(\/|$)/)) return ['page.dashboard'];
  if (is(/^\/(purchase-orders|purchase-incoming|purchase-early-requests|supplier-receipts|supplier-payments|supplier-payables|purchase-sources|purchase-options)(\/|$)/)) return ['page.purchases'];
  if (is(/^\/inventory\/lookup(\/|$)/)) return null; // tra tồn (không giá): mọi nhân viên như trước – quyền chỉ quyết định hiện menu
  if (is(/^\/inventory(\/|$)/)) return ['inventory.view'];
  if (is(/^\/(customer-duplicates|customer-accounts)(\/|$)/)) return ['page.customers'];
  if (is(/^\/customers(\/|$)/)) {
    const picker = ['page.customers', 'page.quotes', 'page.orders', 'page.contracts', 'page.care', 'page.stock-requests'];
    if (method === 'GET' && (p === '/customers' || /^\/customers\/[^/]+$/.test(p))) return query.get('usable') || p !== '/customers' || query.get('q') !== null && Number(query.get('limit')) <= 8 ? picker : ['page.customers'];
    if (method === 'POST' && p === '/customers') return ['page.customers', 'page.quotes'];
    return ['page.customers'];
  }
  return null;
}
