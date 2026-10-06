// Bước xác thực dùng chung (trang nhân viên + trang khách): hiện tóm tắt các thông tin quan trọng kèm danh sách ô kiểm;
// chỉ bấm được nút đồng ý khi đã đánh dấu đủ tất cả. Trả về giá trị các ô nhập thêm (vd. ngày giao) hoặc null nếu huỷ.
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Hạn giao theo số ngày còn lại: quá hạn / hôm nay (đỏ), ≤ 3 ngày (cam), ≤ 7 ngày (xanh dương), xa hơn (xanh lá); đã giao = xám. */
export function dueInfo(date, today = new Date()) {
  if (!date) return null;
  const t = new Date(today.getFullYear(), today.getMonth(), today.getDate()), [y, m, d] = String(date).split('-').map(Number);
  const days = Math.round((new Date(y, m - 1, d) - t) / 86_400_000);
  const text = days < 0 ? `trễ ${-days} ngày` : days === 0 ? 'hôm nay' : days === 1 ? 'ngày mai' : `còn ${days} ngày`;
  return { days, text, tone: days <= 0 ? 'danger' : days <= 3 ? 'warn' : days <= 7 ? 'info' : 'ok' };
}
export function duePill(date, { done = false, fmt = v => v } = {}) {
  const i = dueInfo(date); if (!i) return '<span class="muted">Chưa có</span>';
  return `<span class="due-date ${done ? 'muted' : i.tone}"><b>${esc(fmt(date))}</b><small>${done ? 'đã giao xong' : esc(i.text)}</small></span>`;
}

/**
 * Hộp xác thực. `rows`: [nhãn, giá trị HTML] hiện dạng bảng; `checks`: các câu phải đánh dấu; `fields`: HTML ô nhập thêm (có name).
 * Trả về object { tên ô: giá trị } khi đồng ý, null khi huỷ.
 */
export function verifyBox({ title, eyebrow = 'Xác thực thông tin', intro = '', rows = [], checks = [], fields = '', ok = 'Xác nhận', validate } = {}) {
  const dlg = document.createElement('dialog');
  dlg.className = 'modal verify-dialog';
  dlg.innerHTML = `<form method="dialog">
    <div class="modal-head"><div><span class="eyebrow">${esc(eyebrow)}</span><h2>${esc(title)}</h2></div><button type="button" class="icon-btn" data-x aria-label="Đóng">×</button></div>
    <div class="modal-body">
      ${intro ? `<p class="muted small">${intro}</p>` : ''}
      <dl class="kv verify-summary">${rows.filter(r => r && r[1] !== undefined).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v === '' || v === null ? '<span class="danger-text">Chưa có</span>' : v}</dd>`).join('')}</dl>
      ${fields}
      <ul class="verify-checks">${checks.map((c, i) => `<li><label><input type="checkbox" data-check="${i}"> <span>${c}</span></label></li>`).join('')}</ul>
      <p class="error" data-err role="alert"></p>
    </div>
    <div class="modal-foot"><span class="muted small" data-left></span><button type="button" class="btn secondary" data-x>Quay lại kiểm tra</button><button type="submit" class="btn primary" data-ok disabled>${esc(ok)}</button></div>
  </form>`;
  document.body.append(dlg);
  const boxes = [...dlg.querySelectorAll('[data-check]')], okBtn = dlg.querySelector('[data-ok]');
  const sync = () => { const left = boxes.filter(b => !b.checked).length; okBtn.disabled = left > 0; dlg.querySelector('[data-left]').textContent = left ? `Còn ${left} mục cần đánh dấu` : 'Đã kiểm tra đủ'; };
  boxes.forEach(b => b.addEventListener('change', sync)); sync();
  return new Promise(resolve => {
    const done = v => { dlg.close(); dlg.remove(); resolve(v); };
    dlg.querySelectorAll('[data-x]').forEach(b => b.addEventListener('click', () => done(null)));
    dlg.addEventListener('cancel', e => { e.preventDefault(); done(null); });
    dlg.querySelector('form').addEventListener('submit', e => {
      e.preventDefault(); if (boxes.some(b => !b.checked)) return;
      const values = Object.fromEntries([...dlg.querySelectorAll('[name]')].map(i => [i.name, i.value]));
      const err = validate?.(values); if (err) { dlg.querySelector('[data-err]').textContent = err; return; }
      done(values);
    });
    dlg.showModal();
  });
}
