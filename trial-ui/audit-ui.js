// LỊCH SỬ THAY ĐỔI (Manager): ai làm gì, lúc nào trên một báo giá / đơn hàng – đọc từ GET /audit (nhật ký ghi tự động ở máy chủ).
const esc = v => String(v ?? '').normalize('NFC').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const when = iso => new Date(iso).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric' });

/** Tên dễ hiểu cho từng thao tác (route). Thao tác chưa có tên thì hiện nguyên route. */
const ACTIONS = {
  'PUT /orders/:id/pos': 'Sửa đơn POS', 'amend-pos-order': 'Sửa đơn POS (trước / sau)',
  'POST /quotes': 'Tạo báo giá', 'PUT /quotes/:id': 'Sửa báo giá', 'POST /quotes/:id/approve': 'Duyệt báo giá', 'POST /quotes/:id/submit': 'Gửi duyệt báo giá', 'POST /quotes/:id/reject': 'Trả lại báo giá', 'DELETE /quotes/:id': 'Xoá báo giá',
  'POST /orders': 'Tạo đơn hàng', 'PUT /orders/:id/status': 'Duyệt / huỷ đơn hoặc HĐKT', 'PUT /orders/:id/delivery-date': 'Đổi ngày giao dự kiến',
  'POST /orders/:id/invoice-request': 'Yêu cầu xuất hoá đơn', 'PUT /orders/:id/invoice': 'Nhập số hoá đơn', 'POST /orders/:id/packing': 'Yêu cầu đóng gói',
  'POST /contracts': 'Lập HĐKT', 'PUT /contracts/:id': 'Sửa HĐKT', 'POST /deliveries': 'Lên lịch giao', 'PUT /deliveries/:id/status': 'Đổi trạng thái giao hàng',
  'POST /payments': 'Ghi phiếu thu', 'POST /payments/:id/void': 'Huỷ phiếu thu', 'POST /orders/:id/submit': 'Gửi duyệt đơn', 'POST /customers': 'Tạo khách hàng', 'PUT /customers/:id': 'Sửa khách hàng', 'POST /customers/:id/approve': 'Duyệt khách hàng',
  'DELETE /customers/:id': 'Xoá / từ chối khách hàng', 'POST /packing/:id/send': 'Gửi phiếu đóng gói cho kho', 'POST /packing/:id/confirm': 'Kho xác nhận đã đóng',
  'POST /packing/:id/cancel': 'Huỷ phiếu đóng gói', 'POST /products/:sku/approve': 'Duyệt sản phẩm',
};
const STATUS = { confirmed: 'Đã duyệt', cancelled: 'Đã huỷ', delivered: 'Đã giao', in_transit: 'Đang giao', signed: 'Đã ký', completed: 'Hoàn tất', draft: 'Nháp' };

/** Tóm tắt ngắn nội dung thao tác (trạng thái mới, số tiền, ngày…) thay vì in cả thân yêu cầu. */
function detail(e) {
  const b = e.data?.body || (e.action === 'amend-pos-order' ? e.data : {}) || {}, parts = [];
  if (b.status) parts.push('→ ' + (STATUS[b.status] || b.status));
  if (b.amount) parts.push(new Intl.NumberFormat('vi-VN').format(b.amount) + ' đ');
  if (b.date || b.plannedDate) parts.push('ngày ' + String(b.date || b.plannedDate).split('-').reverse().join('/'));
  if (b.invoiceNo) parts.push('HĐ ' + b.invoiceNo);
  if (b.data?.rows) parts.push(`${b.data.rows.length} dòng hàng`);
  if (b.revision) parts.push('bản ' + b.revision);
  if (b.note) parts.push('“' + String(b.note).slice(0, 80) + '”');
  if (b.reason) parts.push('lý do: “' + String(b.reason).slice(0, 120) + '”');
  return parts.join(' · ');
}

/** Mở hộp lịch sử của một bản ghi. `related` = kèm thao tác khác nhắc tới mã này (phiếu thu, giao hàng… của đơn). */
export async function showAudit({ api, toast, entityType, entityId, title, related = true }) {
  let d;
  try { d = await api(`/audit?entityType=${encodeURIComponent(entityType)}&entityId=${encodeURIComponent(entityId)}${related ? '&related=1' : ''}`); }
  catch (ex) { toast(ex.message, 'err'); return; }
  const dlg = document.createElement('dialog'); dlg.className = 'modal wide';
  dlg.innerHTML = `<div class="modal-head"><div><span class="eyebrow">Lịch sử thay đổi</span><h2>${esc(title)}</h2></div><button type="button" class="icon-btn" data-x aria-label="Đóng">×</button></div>
    <div class="modal-body">${d.entries.length ? `<div class="table-wrap"><table><thead><tr><th>Lúc</th><th>Người làm</th><th>Thao tác</th><th>Chi tiết</th></tr></thead><tbody>
      ${d.entries.map(e => `<tr><td>${when(e.at)}</td><td>${esc(e.actorName || 'Hệ thống')}</td><td>${esc(ACTIONS[e.action] || e.action)}</td><td class="small">${esc(detail(e))}</td></tr>`).join('')}
      </tbody></table></div>` : '<p class="muted">Chưa có thao tác nào được ghi (nhật ký bắt đầu ghi từ bản cập nhật này).</p>'}</div>
    <div class="modal-foot"><button type="button" class="btn secondary" data-x>Đóng</button></div>`;
  document.body.append(dlg);
  dlg.querySelectorAll('[data-x]').forEach(b => b.addEventListener('click', () => dlg.close()));
  dlg.addEventListener('close', () => dlg.remove());
  dlg.showModal();
}
