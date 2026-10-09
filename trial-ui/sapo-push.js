/**
 * Popup chọn kho Sapo khi SINH ĐƠN HÀNG / LẬP HĐKT. Đẩy đơn sang Sapo là tự động và bắt buộc:
 * máy chủ tạo đơn / HĐKT cùng đơn nháp Sapo trong một lượt; Sapo lỗi → không tạo gì, lỗi hiện ngay trong popup.
 * Người phụ trách trên Sapo = người phụ trách báo giá. API xem trước: GET /sapo/preview?quoteId= | ?orderId=.
 */
const LAST_KEY = 'sapoLocation';

export function initSapoPush({ api, esc, $ }) {
  const dialog = $('#sapo-push-dialog'), body = $('#sapo-push-body'), submit = $('#sapo-push-submit');
  let current = null; // { run, resolve, preview }
  const lastLocation = () => { try { return localStorage.getItem(LAST_KEY) || ''; } catch { return ''; } };
  const remember = id => { try { localStorage.setItem(LAST_KEY, String(id)); } catch { /* bỏ qua */ } };
  dialog.addEventListener('close', () => { const c = current; current = null; c?.resolve(null); });

  /**
   * Mở popup. `ref`: `{ quoteId }` hoặc `{ orderId }`; `run(locationId)` gọi API tạo đơn / HĐKT (kèm kho Sapo).
   * Trả kết quả của `run`, hoặc null khi đóng popup. Đơn đã có trên Sapo (lập HĐKT cho đơn đã đẩy) → chạy luôn, không hỏi kho.
   */
  async function choose(ref, { title, action, run }) {
    current?.resolve(null);
    const me = current = { run, resolve: () => {}, busy: false };
    const result = new Promise(resolve => { me.resolve = resolve; });
    $('#sapo-push-title').textContent = title; submit.textContent = action; submit.disabled = true; $('#sapo-push-code').textContent = '';
    body.innerHTML = '<p class="muted">Đang kiểm tra kết nối Sapo…</p>';
    if (!dialog.open) dialog.showModal();
    let d;
    try { d = await api('/sapo/preview?' + new URLSearchParams(ref)); } catch (e) { if (current === me) body.innerHTML = `<p class="error">${esc(e.message)}</p>`; return result; }
    if (current !== me) return result;
    if (d.pushed || d.required === false) { // đã có trên Sapo / máy chủ tắt đẩy Sapo: không cần chọn kho
      current = null; dialog.close();
      return run(null);
    }
    $('#sapo-push-code').textContent = d.code;
    const blocks = [`<dl class="kv"><dt>Mã đơn trên Sapo</dt><dd><b>${esc(d.code)}</b> <small class="muted">(số báo giá)</small></dd>
      <dt>NV phụ trách trên Sapo</dt><dd>${d.connected ? (d.account ? `<b>${esc(d.account.name)}</b>` : `<span class="pill warn">Chưa khớp tài khoản Sapo của ${esc(d.owner || 'người phụ trách')}</span><small>Đơn Sapo sẽ để người phụ trách theo phiên Sapo đang kết nối.</small>`) : esc(d.owner)}</dd></dl>`];
    if (d.problems.length) blocks.push(`<ul class="error">${d.problems.map(p => `<li>${esc(p)}</li>`).join('')}</ul><p class="muted small">Sửa báo giá cho đủ rồi thử lại.</p>`);
    if (!d.connected) blocks.push(`<p class="error">${esc(d.message || 'Chưa kết nối Sapo.')}</p><p class="muted small">Đơn hàng / HĐKT chỉ sinh được khi đẩy được sang Sapo. Manager kết nối Sapo ở trang Nhân viên → Đồng bộ Sapo.</p>`);
    else if (!d.locations.length) blocks.push('<p class="error">Sapo chưa trả danh sách kho.</p>');
    else {
      const last = lastLocation(), pick = d.locations.length === 1 ? String(d.locations[0].id) : d.locations.some(l => String(l.id) === last) ? last : '';
      blocks.push(`<label>Kho xuất hàng trên Sapo<select id="sapo-push-location" required><option value="">— Chọn kho —</option>${d.locations.map(l => `<option value="${l.id}"${String(l.id) === pick ? ' selected' : ''}>${esc(l.name)}</option>`).join('')}</select></label>`);
    }
    blocks.push('<p class="muted small">Tạo cùng lúc đơn NHÁP trên Sapo (khách / sản phẩm chưa có trên Sapo sẽ được tạo theo mã KH / MST / SKU). Sapo lỗi thì không sinh đơn / HĐKT.</p><p class="error" id="sapo-push-error" role="alert"></p>');
    body.innerHTML = blocks.join('');
    const sel = $('#sapo-push-location');
    me.sync = () => { submit.disabled = me.busy || !d.connected || !!d.problems.length || !sel?.value; };
    sel?.addEventListener('change', me.sync); me.sync();
    return result;
  }

  $('#sapo-push-form').addEventListener('submit', async e => {
    e.preventDefault();
    const me = current, sel = $('#sapo-push-location'); if (!me || me.busy || !sel?.value) return;
    me.busy = true; me.sync?.(); const label = submit.textContent; submit.textContent = 'Đang tạo đơn + đơn Sapo…'; $('#sapo-push-error').textContent = '';
    try {
      const r = await me.run(Number(sel.value));
      remember(sel.value);
      current = null; dialog.close(); me.resolve(r);
    } catch (ex) {
      $('#sapo-push-error').textContent = ex.message + ' Chưa sinh đơn / HĐKT nào.';
      submit.textContent = label; me.busy = false; me.sync?.();
    }
  });
  return { choose };
}
