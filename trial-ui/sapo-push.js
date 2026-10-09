/**
 * Popup "Đẩy đơn sang Sapo" (thay nút "Copy báo giá vào Sapo" của web cũ): mở ngay sau khi sinh đơn hàng / lập HĐKT,
 * hoặc bấm "Đẩy sang Sapo" ở trang đơn. Nhân viên chọn kho Sapo; người phụ trách trên Sapo = người phụ trách đơn / báo giá.
 * API: GET /orders/:id/sapo (xem trước), POST /orders/:id/sapo-push { locationId }.
 */
const LAST_KEY = 'sapoLocation';

export function initSapoPush({ api, toast, esc, money, $ }) {
  const dialog = $('#sapo-push-dialog'), body = $('#sapo-push-body'), submit = $('#sapo-push-submit');
  let orderId = '', onDone = null, busy = false;
  const lastLocation = () => { try { return localStorage.getItem(LAST_KEY) || ''; } catch { return ''; } };
  const remember = id => { try { localStorage.setItem(LAST_KEY, String(id)); } catch { /* bỏ qua */ } };
  const done = (sapoOrder, extra = '') => {
    body.innerHTML = `<p class="pill ok">✓ Đơn đã có trên Sapo: <b>${esc(sapoOrder.code)}</b></p>${extra}
      <p><a class="btn secondary" href="${esc(sapoOrder.url)}" target="_blank" rel="noopener noreferrer">Xem đơn trên Sapo ↗</a></p>`;
    submit.hidden = true; $('#sapo-push-later').textContent = 'Đóng';
  };

  async function open(id, opts = {}) {
    orderId = id; onDone = opts.onDone || null; busy = false;
    submit.hidden = false; submit.disabled = true; submit.textContent = 'Tạo đơn Sapo'; $('#sapo-push-later').textContent = 'Để sau';
    $('#sapo-push-code').textContent = ''; body.innerHTML = '<p class="muted">Đang kiểm tra kết nối Sapo…</p>';
    if (!dialog.open) dialog.showModal();
    let d;
    try { d = await api('/orders/' + encodeURIComponent(id) + '/sapo'); } catch (e) { body.innerHTML = `<p class="error">${esc(e.message)}</p>`; return; }
    if (id !== orderId) return;
    if (d.pushed) { $('#sapo-push-code').textContent = d.pushed.code; done(d.pushed); return; }
    $('#sapo-push-code').textContent = d.code;
    const blocks = [];
    blocks.push(`<dl class="kv"><dt>Mã đơn trên Sapo</dt><dd><b>${esc(d.code)}</b> <small class="muted">(số báo giá – trùng thì Sapo không tạo thêm)</small></dd>
      <dt>Khách hàng</dt><dd>${esc(d.summary.customer)}</dd><dt>Sản phẩm</dt><dd>${d.summary.lines} dòng · ${money(d.summary.total)}</dd>
      <dt>NV phụ trách trên Sapo</dt><dd>${d.connected ? (d.account ? `<b>${esc(d.account.name)}</b>` : `<span class="pill warn">Chưa khớp tài khoản Sapo của ${esc(d.owner || 'người phụ trách')}</span><small>Đơn Sapo sẽ để người phụ trách theo phiên Sapo đang kết nối.</small>`) : esc(d.owner)}</dd></dl>`);
    if (d.problems.length) blocks.push(`<ul class="error">${d.problems.map(p => `<li>${esc(p)}</li>`).join('')}</ul>`);
    if (!d.connected) blocks.push(`<p class="error">${esc(d.message || 'Chưa kết nối Sapo.')}</p><p class="muted small">Manager kết nối Sapo ở trang Nhân viên → Đồng bộ Sapo, rồi bấm "Đẩy sang Sapo" ở trang đơn.</p>`);
    else if (!d.locations.length) blocks.push('<p class="error">Sapo chưa trả danh sách kho.</p>');
    else {
      const last = lastLocation(), pick = d.locations.length === 1 ? String(d.locations[0].id) : d.locations.some(l => String(l.id) === last) ? last : '';
      blocks.push(`<label>Kho xuất hàng trên Sapo<select id="sapo-push-location" required><option value="">— Chọn kho —</option>${d.locations.map(l => `<option value="${l.id}"${String(l.id) === pick ? ' selected' : ''}>${esc(l.name)}</option>`).join('')}</select></label>`);
    }
    if (d.pending) blocks.push('<p class="muted">Đơn đang được đẩy sang Sapo (lượt khác). Đợi một chút rồi mở lại.</p>');
    blocks.push('<p class="muted small">Tạo đơn NHÁP trên Sapo; khách / sản phẩm chưa có trên Sapo sẽ được tạo theo mã KH / MST / SKU. Sửa báo giá sau khi đẩy thì cần sửa tay đơn Sapo.</p><p class="error" id="sapo-push-error" role="alert"></p>');
    body.innerHTML = blocks.join('');
    const sel = $('#sapo-push-location');
    const sync = () => { submit.disabled = busy || !d.connected || !!d.problems.length || d.pending || !sel?.value; };
    sel?.addEventListener('change', sync); sync();
  }

  $('#sapo-push-form').addEventListener('submit', async e => {
    e.preventDefault();
    const sel = $('#sapo-push-location'); if (busy || !sel?.value) return;
    busy = true; submit.disabled = true; submit.textContent = 'Đang tạo đơn Sapo…'; $('#sapo-push-error').textContent = '';
    try {
      const r = await api('/orders/' + encodeURIComponent(orderId) + '/sapo-push', 'POST', { locationId: Number(sel.value) });
      remember(sel.value); toast(r.message);
      done(r.sapoOrder, (r.message ? `<p>${esc(r.message)}</p>` : '') + (r.warnings?.length ? `<ul class="warn-list">${r.warnings.map(w => `<li>${esc(w)}</li>`).join('')}</ul>` : ''));
      onDone?.(r);
    } catch (ex) {
      $('#sapo-push-error').textContent = ex.message + (ex.status >= 500 ? ' Kiểm tra trên Sapo trước khi thử lại để tránh tạo trùng.' : '');
      submit.textContent = 'Thử lại'; busy = false; submit.disabled = false;
    }
  });
  return { open };
}
