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
/** Sale Admin TẠM THỜI có quyền của Sale + Kế toán + Kho (yêu cầu 17/10/2026). Kế toán: xem SALES_KT / KHO_KT bên dưới.
 * Sổ thu / chi, Huỷ phiếu thu, Doanh số toàn công ty: chỉ Kế toán – Sale Admin chỉ xem toàn công ty ở báo giá, khách, đơn, HĐKT. */
const KHO = ['warehouse', 'sale-admin'] as const, KE_TOAN = ['accounting', 'sale-admin'] as const;
/** Kế toán vào mọi trang trừ Bảng lương / Phân quyền (yêu cầu 29/10/2026, migration 20261029160000) – chỉ quyền xem trang, không thao tác kho / quầy. */
const SALES_KT = [...SALES, 'accounting'] as const, KHO_KT = [...KHO, 'accounting'] as const;

export const PERMISSIONS: readonly PermissionDef[] = [
  { key: 'pos.sell', group: 'Bán hàng nhanh', label: 'POS – bán, mở/kết ca, thu COD của quầy', defaults: SALES },
  { key: 'pos.configure', group: 'Bán hàng nhanh', label: 'POS – cấu hình quầy và ca', defaults: [] },
  { key: 'page.quotes', group: 'Trang được vào', label: 'Báo giá', defaults: SALES_KT },
  { key: 'page.orders', group: 'Trang được vào', label: 'Đơn đặt hàng', defaults: OFFICE },
  { key: 'page.contracts', group: 'Trang được vào', label: 'HĐKT', defaults: OFFICE },
  { key: 'page.product-custody', group: 'Trang được vào', label: 'Hàng bảo hành & mượn mẫu', hint: 'Manager xem mọi phiếu; nhân viên theo người tạo / phụ trách. Không tự ghi tồn kho.', defaults: ALL },
  { key: 'page.order-products', group: 'Trang được vào', label: 'Sản phẩm theo đơn', hint: 'Mở trang Sản phẩm theo đơn; cấp riêng với quyền Đơn đặt hàng.', defaults: OFFICE },
  { key: 'page.deliveries', group: 'Trang được vào', label: 'Lịch giao hàng', hint: 'Mở lịch, danh sách và sản phẩm theo chuyến giao hàng.', defaults: ALL },
  { key: 'page.receivables', group: 'Trang được vào', label: 'Công nợ', defaults: OFFICE },
  { key: 'page.customers', group: 'Trang được vào', label: 'Khách hàng', hint: 'Danh bạ, hồ sơ khách. Tắt vẫn chọn được khách khi lập báo giá / đơn.', defaults: OFFICE },
  { key: 'page.care', group: 'Trang được vào', label: 'Giao dịch & chăm sóc', defaults: SALES_KT },
  { key: 'page.stock-requests', group: 'Trang được vào', label: 'Khách hỏi tồn', defaults: SALES_KT },
  { key: 'page.dashboard', group: 'Trang được vào', label: 'Tổng quan doanh số', defaults: OFFICE },
  { key: 'page.flow', group: 'Trang được vào', label: 'Sơ đồ quy trình', defaults: OFFICE },
  { key: 'page.purchases', group: 'Trang được vào', label: 'Đơn mua NCC', hint: 'NVBH ML/LOCK: xem và lập đơn nháp sản phẩm Minh Long, Lys, Healthy Cook, Lock&Lock; không mở duyệt, giá mua, thanh toán hoặc nhận kho.', defaults: ALL },
  { key: 'page.packing', group: 'Kho', label: 'Phiếu đóng gói – xem tất cả, xác nhận đóng xong', hint: 'Không có quyền này: chỉ xem phiếu của đơn mình phụ trách.', defaults: KHO_KT },
  { key: 'page.stock-lookup', group: 'Kho', label: 'Tra tồn (không giá)', defaults: KHO_KT },
  { key: 'inventory.view', group: 'Kho', label: 'Sổ kho – xem', defaults: ['accounting'] },
  { key: 'inventory.manage', group: 'Kho', label: 'Sổ kho – chốt đầu kỳ, lập đề nghị điều chỉnh', hint:'Nhân viên gửi phiếu chờ duyệt; chỉ Manager duyệt mới ghi tồn.', defaults: [] },
  { key: 'purchases.receive', group: 'Kho', label: 'Nhận hàng NCC về kho', defaults: KHO_KT },
  { key: 'stock.transfer', group: 'Kho', label: 'Điều chuyển kho – xác nhận đã chuyển', hint: 'Phiếu điều chuyển đã duyệt: bấm "Đã chuyển" để trừ kho đi. Kho đến nhận riêng theo phân quyền kho bán; Manager được nhận thay. Ai cũng xin điều chuyển được.', defaults: KHO },
  { key: 'purchases.early-view', group: 'Mua hàng NCC', label: 'Xin hàng trước – xem danh sách phiếu', hint: 'Cần thêm quyền trang Đơn mua NCC.', defaults: ALL },
  { key: 'purchases.early-request', group: 'Mua hàng NCC', label: 'Xin hàng trước – lập, sửa, gửi NCC, tải file', defaults: ['sale-admin'] },
  { key: 'purchases.confirm', group: 'Mua hàng NCC', label: 'Xác nhận thay NCC', defaults: ['sale-admin', 'accounting'] },
  { key: 'purchases.cancel-approved', group: 'Mua hàng NCC', label: 'Huỷ đơn mua đã duyệt', hint: 'Chỉ khi đơn chưa nhận hàng, chưa trả tiền.', defaults: ['sale-admin'] },
  { key: 'purchases.prices', group: 'Tài chính NCC', label: 'Xem giá mua NCC', defaults: KE_TOAN },
  { key: 'purchases.pay', group: 'Tài chính NCC', label: 'Ghi thanh toán / lịch trả NCC', defaults: KE_TOAN },
  { key: 'suppliers.edit', group: 'Tài chính NCC', label: 'Danh bạ NCC – xem, sửa', defaults: KE_TOAN },
  { key: 'page.cash', group: 'Sổ quỹ', label: 'Két chung cửa hàng', defaults: [...SALES, 'accounting'] },
  { key: 'sepay.reconcile-incoming', group: 'Kế toán', label: 'Đối soát khoản thu SePay', hint: 'Chọn đơn và xác nhận khoản thu trong phạm vi đơn/cửa hàng được phân quyền. Không cấp quyền xem tiền ra hoặc huỷ phiếu thu.', defaults: [] },
  { key: 'sepay.reconcile-all-stores', group: 'Kế toán', label: 'Đối soát thu toàn công ty (mọi cửa hàng)', hint: 'Cho phép xem và đối soát đơn web của mọi cửa hàng. Vẫn cần quyền Thanh toán SePay và Đối soát khoản thu SePay; không cấp quyền xem tiền ra hay huỷ phiếu thu.', defaults: [] },
  { key: 'sepay.replace-mismatch-receipt', group: 'Kế toán', label: 'Sửa phiếu thu lệch khi đối soát SePay', hint: 'Chỉ trong màn Đối soát chi tiết SePay: huỷ phiếu chuyển khoản đã nhập sai số và tạo phiếu đúng số ngân hàng thực nhận, giữ lịch sử và nhật ký. Cần thêm quyền Đối soát khoản thu SePay; không cấp quyền huỷ phiếu thu ở nơi khác hay gỡ phân bổ.', defaults: [] },
  { key: 'cash.view-all', group: 'Sổ quỹ', label: 'Xem tất cả phiếu và ca két', defaults: ['accounting'] },
  { key: 'page.cashbook', group: 'Kế toán', label: 'Sổ thu / chi', hint: 'Phiếu thu khách + phiếu chi NCC theo ngày, xuất Excel để đối soát ngân hàng.', defaults: ['accounting'] },
  { key: 'page.sepay', group: 'Kế toán', label: 'Thanh toán SePay – xem và tải giao dịch', hint: 'Xem tiền vào và tải giao dịch SePay; tiền ra chỉ dành cho Manager và chức vụ Kế toán. Đối soát gán khoản thu cần thêm quyền riêng; quyền xem không cấp quyền ghi thu.', defaults: ['accounting'] },
  { key: 'payments.void', group: 'Kế toán', label: 'Huỷ phiếu thu ghi nhầm', hint: 'Bắt buộc ghi lý do; phiếu huỷ vẫn giữ trong lịch sử.', defaults: ['accounting'] },
  { key: 'dashboard.all', group: 'Kế toán', label: 'Doanh số toàn công ty', hint: 'Tổng quan doanh số xem cả công ty (không có: chỉ doanh số của mình).', defaults: ['accounting'] },
  { key: 'store.review', group: 'Quản trị', label: 'Duyệt báo cáo Cửa hàng trưởng', hint: 'Xem báo cáo ngày / tuần / tháng / kiểm kho của mọi cửa hàng, đánh dấu đạt / sai sổ quỹ / đề xuất sai / miễn (ảnh hưởng Tiền Trách nhiệm CHT).', defaults: [] },
  { key: 'feedback.manage', group: 'Quản trị', label: 'Quản lý góp ý phần mềm', hint: 'Xem mọi góp ý (kể cả góp ý riêng tư), đổi trạng thái, ưu tiên, gộp trùng, nhận thông báo góp ý mới.', defaults: [] },
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
  if (is(/^\/product-custody(\/|$)/)) return ['page.product-custody'];
  if (is(/^\/order-products(\/|$)/)) return ['page.order-products'];
  if (is(/^\/(quotes|quote-docs)(\/|$)/)) return ['page.quotes'];
  if (is(/^\/(orders|order-quote-candidates|payments)(\/|$)/)) return ['page.orders', 'page.contracts', 'page.receivables'];
  if (is(/^\/contracts(\/|$)/)) return ['page.contracts', 'page.orders'];
  if (is(/^\/deliveries(\/|$)/)) return ['page.deliveries', 'page.orders', 'page.contracts'];
  if (is(/^\/receivables(\/|$)/)) return ['page.receivables'];
  if (is(/^\/cash(\/|$)/)) return ['page.cash', 'pos.sell'];
  if (is(/^\/cashbook(\/|$)/)) return ['page.cashbook'];
  if (is(/^\/sepay(\/|$)/)) return ['page.sepay'];
  if (is(/^\/care(\/|$)/)) return ['page.care'];
  if (is(/^\/stock-requests(\/|$)/)) return ['page.stock-requests'];
  if (is(/^\/dashboard(\/|$)/)) return ['page.dashboard'];
  if(is(/^\/warehouse-receiving(\/|$)/)||method==='GET'&&is(/^\/purchase-early-requests\/[^/]+\/receiving$/)||method==='POST'&&is(/^\/purchase-orders\/[^/]+\/receipts$/))return ['page.purchases','purchases.receive'];
  if (is(/^\/(purchase-orders|purchase-receiving-calendar|purchase-incoming|purchase-early-requests|supplier-receipts|supplier-payments|supplier-payables|purchase-sources|purchase-options)(\/|$)/)) return ['page.purchases'];
  if (is(/^\/inventory\/lookup(\/|$)/)) return null; // tra tồn (không giá): mọi nhân viên như trước – quyền chỉ quyết định hiện menu
  if (is(/^\/inventory(\/|$)/)) return ['inventory.view'];
  if (is(/^\/(appsheet-customers|customer-duplicates|customer-accounts)(\/|$)/)) return ['page.customers'];
  if (is(/^\/customers(\/|$)/)) {
    const picker = ['page.customers', 'page.quotes', 'page.orders', 'page.contracts', 'page.care', 'page.stock-requests'];
    if (method === 'GET' && (p === '/customers' || /^\/customers\/[^/]+$/.test(p))) return query.get('usable') || p !== '/customers' || query.get('q') !== null && Number(query.get('limit')) <= 8 ? picker : ['page.customers'];
    if (method === 'POST' && p === '/customers') return ['page.customers', 'page.quotes'];
    return ['page.customers'];
  }
  return null;
}
