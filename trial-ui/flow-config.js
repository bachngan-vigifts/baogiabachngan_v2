/**
 * SƠ ĐỒ QUY TRÌNH – CẤU HÌNH (chỉ dữ liệu, không có code vẽ).
 *
 * Muốn sửa sơ đồ, chỉ sửa file này:
 *  - STAGES  : các cột (giai đoạn) theo thứ tự từ trái sang phải.
 *  - NODES   : các khối. `id` trùng khoá trong API `GET /flow` (src/app/flow-routes.ts) – máy chủ trả số liệu + việc cho khối đó.
 *              `stage` = cột, `row` = hàng (1 trên cùng). `page` = trang mở khi bấm "Mở trang". `actions` = nút nhanh của khối.
 *  - EDGES   : mũi tên nối khối (`from` → `to`, `label` chữ trên mũi tên, `alt: true` = nhánh phụ/ngoại lệ, vẽ màu cam).
 *  - ITEM_ACTIONS : nút trên từng việc. Máy chủ quyết định việc nào được hiện nút (trả tên thao tác trong `actions`),
 *              ở đây khai báo nhãn, câu xác nhận và cách gọi API. Máy chủ vẫn kiểm tra quyền khi gọi.
 *  - NODE_ACTIONS (trong NODES.actions): `{ label, open: 'new-quote' | 'new-customer' | 'new-care' }` gọi hộp thoại có sẵn của app,
 *              hoặc `{ label, go: '#/...' }` chuyển trang.
 * Thêm khối mới: thêm hàm vào `NODES` của src/app/flow-routes.ts + một dòng ở NODES dưới đây (+ mũi tên nếu cần).
 */

/** Biểu tượng nét (24×24) dùng chung. */
export const ICONS = {
  users: 'M16 19v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 17.5V19 M10 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z M20 19v-1.5a3.5 3.5 0 0 0-2.5-3.35 M15.5 4.2a3.5 3.5 0 0 1 0 6.6',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z M20 20l-4-4',
  heart: 'M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z',
  doc: 'M7 3h7l4 4v14H7z M14 3v4h4 M9.5 12h6 M9.5 16h6',
  cart: 'M4 5h2l2 10h10l2-7H7.4 M9 20a1 1 0 1 0 0-.01 M17 20a1 1 0 1 0 0-.01',
  sign: 'M7 3h8l3 3v15H7z M10 15l2 2 4-5 M10 8h5',
  truckIn: 'M3 7h11v9H3z M14 10h4l3 3v3h-7 M7 19a1.5 1.5 0 1 0 0-.01 M17 19a1.5 1.5 0 1 0 0-.01 M6 11h5 M9 9l2 2-2 2',
  box: 'M4 8l8-4 8 4v8l-8 4-8-4z M4 8l8 4 8-4 M12 12v8',
  truck: 'M3 7h11v9H3z M14 10h4l3 3v3h-7 M7 19a1.5 1.5 0 1 0 0-.01 M17 19a1.5 1.5 0 1 0 0-.01',
  invoice: 'M6 3h12v18l-3-2-3 2-3-2-3 2z M9 8h6 M9 12h6 M9 16h3',
  money: 'M3 7h18v10H3z M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M6 10v4 M18 10v4',
  shop: 'M4 9h16l-1-5H5z M5 9v11h14V9 M10 20v-6h4v6',
  store: 'M3 21h18 M5 21V9l7-5 7 5v12 M9 21v-6h6v6',
  calc: 'M6 3h12v18H6z M9 7h6 M9 11h1 M12 11h1 M15 11h0 M9 15h1 M12 15h1 M15 15h0',
};

export const STAGES = [
  { id: 'customer', title: 'Khách hàng', icon: 'users' },
  { id: 'sales', title: 'Kinh doanh', icon: 'doc' },
  { id: 'purchase', title: 'Mua hàng', icon: 'shop' },
  { id: 'warehouse', title: 'Kho hàng', icon: 'store' },
  { id: 'delivery', title: 'Giao hàng', icon: 'truck' },
  { id: 'accounting', title: 'Kế toán', icon: 'calc' },
];

export const NODES = [
  { id: 'customers', stage: 'customer', row: 1, title: 'Khách hàng', icon: 'users', page: '#/customers',
    desc: 'Danh bạ khách, khách mới chờ Manager duyệt, khách bạn phụ trách.',
    actions: [{ label: 'Thêm khách hàng', open: 'new-customer' }, { label: 'Danh sách khách', go: '#/customers' }] },
  { id: 'stock-requests', stage: 'customer', row: 2, title: 'Khách hỏi tồn', icon: 'search', page: '#/stock-requests',
    desc: 'Khách gửi danh sách mã cần kiểm tồn qua cổng khách hàng – trả lời để khách chốt báo giá.',
    actions: [{ label: 'Mở danh sách hỏi tồn', go: '#/stock-requests' }] },
  { id: 'care', stage: 'customer', row: 3, title: 'Chăm sóc khách', icon: 'heart', page: '#/care',
    desc: 'Lịch hẹn chăm sóc quá hạn / hôm nay của bạn. Ghi lần chăm sóc mới ngay tại đây.',
    actions: [{ label: 'Ghi chăm sóc', open: 'new-care' }, { label: 'Nhật ký chăm sóc', go: '#/care' }] },

  { id: 'quotes', stage: 'sales', row: 1, title: 'Báo giá', icon: 'doc', page: '#/quotes',
    desc: 'Báo giá chờ Manager duyệt và báo giá đã duyệt nhưng chưa sinh đơn hàng / HĐKT.',
    actions: [{ label: 'Tạo báo giá', open: 'new-quote' }, { label: 'Danh sách báo giá', go: '#/quotes' }] },
  { id: 'orders', stage: 'sales', row: 2, title: 'Đơn hàng', icon: 'cart', page: '#/orders',
    desc: 'Đơn đặt hàng (không ký HĐKT): nháp chờ duyệt, đã duyệt chờ giao, đang giao.',
    actions: [{ label: 'Danh sách đơn hàng', go: '#/orders' }] },
  { id: 'contracts', stage: 'sales', row: 3, title: 'Hợp đồng (HĐKT)', icon: 'sign', page: '#/contracts',
    desc: 'HĐKT: chờ duyệt, chưa ký, chờ giao.',
    actions: [{ label: 'Danh sách HĐKT', go: '#/contracts' }] },

  { id: 'purchase', stage: 'purchase', row: 1, title: 'Nhập hàng NCC', icon: 'truckIn', page: '#/tasks',
    desc: 'Việc nhập hàng từ nhà cung cấp / phiếu nhập Sapo giao cho kho khi hàng không đủ.',
    actions: [{ label: 'Mở Công việc', go: '#/tasks' }] },

  { id: 'packing', stage: 'warehouse', row: 2, title: 'Đóng gói & xuất kho', icon: 'box', page: '#/packing',
    desc: 'Phiếu đóng gói đã gửi kho chờ đóng, phiếu nháp chưa gửi, phiếu đóng xong hôm nay.',
    actions: [{ label: 'Phiếu đóng gói', go: '#/packing' }] },

  { id: 'deliveries', stage: 'delivery', row: 2, title: 'Giao hàng', icon: 'truck', page: '#/deliveries',
    desc: 'Chuyến giao trễ lịch, giao hôm nay, đang trên đường. Cập nhật trạng thái ngay tại đây.',
    actions: [{ label: 'Lịch giao hàng', go: '#/deliveries' }] },

  { id: 'invoices', stage: 'accounting', row: 1, title: 'Xuất hoá đơn', icon: 'invoice', page: '#/orders',
    desc: 'Yêu cầu xuất hoá đơn chờ kế toán và đơn đã giao nhưng chưa yêu cầu hoá đơn.',
    actions: [{ label: 'Mở Công việc kế toán', go: '#/tasks' }] },
  { id: 'receivables', stage: 'accounting', row: 2, title: 'Thu tiền & công nợ', icon: 'money', page: '#/receivables',
    desc: 'Đơn quá hạn thu, số tiền quá hạn, tổng còn phải thu.',
    actions: [{ label: 'Bảng công nợ', go: '#/receivables' }] },
];

export const EDGES = [
  { from: 'customers', to: 'quotes', label: 'Báo giá' },
  { from: 'stock-requests', to: 'quotes', label: 'Kiểm tồn' },
  { from: 'quotes', to: 'orders', label: 'Chốt đơn' },
  { from: 'quotes', to: 'contracts', label: 'Ký HĐKT' },
  { from: 'orders', to: 'packing', label: 'Đủ hàng' },
  { from: 'contracts', to: 'packing' },
  { from: 'orders', to: 'purchase', label: 'Thiếu hàng', alt: true },
  { from: 'purchase', to: 'packing', label: 'Nhập kho' },
  { from: 'packing', to: 'deliveries', label: 'Xuất kho' },
  { from: 'deliveries', to: 'invoices', label: 'Đã giao' },
  { from: 'invoices', to: 'receivables', label: 'Thu tiền' },
  { from: 'receivables', to: 'care', label: 'Chăm sóc lại · bán tiếp', alt: true },
];

/** Thao tác trên từng việc. `request(item)` → [method, path, body]; `go(item)` → chuyển trang. */
export const ITEM_ACTIONS = {
  'approve-quote': { label: 'Duyệt', confirm: it => `Duyệt báo giá ${it.title}?`, request: it => ['POST', `/quotes/${encodeURIComponent(it.id)}/approve`, { revision: it.revision }], done: 'Đã duyệt báo giá.' },
  'make-order': { label: 'Sinh đơn / HĐKT', go: it => it.hash },
  'approve-customer': { label: 'Duyệt', confirm: it => `Duyệt khách ${it.title}?`, request: it => ['POST', `/customers/${encodeURIComponent(it.id)}/approve`, {}], done: 'Đã duyệt khách hàng.' },
  'care-done': { label: 'Đã chăm sóc', request: it => ['POST', `/care/${encodeURIComponent(it.id)}/done`, {}], done: 'Đã đánh dấu chăm sóc xong.' },
  'task-done': { label: 'Xong', request: it => ['PUT', `/tasks/${encodeURIComponent(it.id)}`, { status: 'done', revision: it.revision }], done: 'Đã hoàn thành việc.' },
  'ship-start': { label: 'Bắt đầu giao', request: it => ['PUT', `/deliveries/${encodeURIComponent(it.id)}/status`, { status: 'in_transit' }], done: 'Đã chuyển sang đang giao.' },
  'ship-done': { label: 'Đã giao', confirm: it => `Xác nhận đã giao cho ${it.title}? Hệ thống sẽ cộng số lượng đã giao, tự yêu cầu xuất hoá đơn và hoàn tất phiếu đóng gói.`,
    request: it => ['PUT', `/deliveries/${encodeURIComponent(it.id)}/status`, { status: 'delivered' }], done: 'Đã xác nhận giao hàng.' },
};
