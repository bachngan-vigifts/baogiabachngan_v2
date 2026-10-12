/**
 * Popup khi SINH ĐƠN HÀNG / LẬP HĐKT: chọn CÓ tạo đơn trên Sapo hay không (mặc định có).
 *  - Có: chọn kho Sapo; máy chủ tạo đơn / HĐKT cùng đơn nháp Sapo trong một lượt; Sapo lỗi → không tạo gì, lỗi hiện ngay trong popup.
 *  - Không: chỉ sinh đơn / HĐKT trên web (`pushSapo: false`), không cần kết nối Sapo.
 *  - Mở popup là kiểm tra kết nối Sapo ngay: lỗi → khoá "Có", chọn sẵn "Không"; Sapo lỗi lúc tạo → nút "… không qua Sapo".
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
   * Mở popup. `ref`: `{ quoteId }` hoặc `{ orderId }`; `run(locationId, pushSapo)` gọi API tạo đơn / HĐKT
   * (`pushSapo` false → không tạo đơn Sapo, `locationId` null).
   * Trả kết quả của `run`, hoặc null khi đóng popup. Đơn đã có trên Sapo (lập HĐKT cho đơn đã đẩy) → chạy luôn, không hỏi kho.
   */
  async function choose(ref, { title, action, run }) {
    current?.resolve(null);
    const me = current = { run, resolve: () => {}, busy: false, title };
    const result = new Promise(resolve => { me.resolve = resolve; });
    $('#sapo-push-title').textContent = title; submit.textContent = action; submit.disabled = true; $('#sapo-push-code').textContent = '';
    body.innerHTML = '<p class="muted">Đang kiểm tra kết nối Sapo…</p>';
    if (!dialog.open) dialog.showModal();
    let d;
    // Xem trước lỗi (mạng / Sapo) vẫn cho chọn "Không – chỉ sinh trên web".
    try { d = await api('/sapo/preview?' + new URLSearchParams(ref)); } catch (e) { d = { connected: false, message: e.message, code: '', owner: '', account: null, locations: [], problems: [] }; }
    if (current !== me) return result;
    if (d.pushed || d.required === false) { // đã có trên Sapo / máy chủ tắt đẩy Sapo: không cần chọn kho
      current = null; dialog.close();
      return run(null, false);
    }
    $('#sapo-push-code').textContent = d.code || 'Số đơn / HĐKT sẽ được cấp khi sinh';
    // Kiểm tra kết nối trước (xem trước gọi Sapo thật: danh sách kho). Sapo lỗi / chưa kết nối / không có kho →
    // khoá "Có", chọn sẵn "Không" để vẫn sinh được đơn / HĐKT trên web.
    const sapoOk = d.connected && d.locations.length > 0;
    const choice = `<fieldset class="sapo-push-choice"><legend>Tạo đơn trên Sapo?</legend>
      <label class="check"><input type="radio" name="sapo-push-mode" value="yes"${sapoOk ? ' checked' : ' disabled'}> Có – tạo đơn nháp trên Sapo${sapoOk ? ' <span class="pill ok">Sapo đã kết nối</span>' : ''}</label>
      <label class="check"><input type="radio" name="sapo-push-mode" value="no"${sapoOk ? '' : ' checked'}> Không – chỉ sinh trên web</label>
      ${sapoOk ? '' : `<p class="error small">Không kết nối được Sapo: ${esc(d.message || (d.connected ? 'Sapo chưa trả danh sách kho.' : 'Chưa kết nối Sapo.'))} Đơn / HĐKT sẽ chỉ sinh trên web; Manager kết nối lại Sapo ở trang Nhân viên → Đồng bộ Sapo.</p>`}</fieldset>`;
    const blocks = [`<dl class="kv"><dt>Mã đơn trên Sapo</dt><dd><b>${esc(d.code || 'Sẽ dùng số đơn hàng / HĐKT mới sinh')}</b></dd>
      <dt>NV phụ trách trên Sapo</dt><dd>${d.connected ? (d.account ? `<b>${esc(d.account.name)}</b>` : `<span class="pill warn">Chưa khớp tài khoản Sapo của ${esc(d.owner || 'người phụ trách')}</span><small>Đơn Sapo sẽ để người phụ trách theo phiên Sapo đang kết nối.</small>`) : esc(d.owner)}</dd></dl>`];
    if (d.problems.length) blocks.push(`<ul class="error">${d.problems.map(p => `<li>${esc(p)}</li>`).join('')}</ul><p class="muted small">Sửa báo giá cho đủ rồi thử lại.</p>`);
    if (!d.connected) blocks.push(`<p class="error">${esc(d.message || 'Chưa kết nối Sapo.')}</p><p class="muted small">Chọn "Không – chỉ sinh trên web", hoặc Manager kết nối Sapo ở trang Nhân viên → Đồng bộ Sapo.</p>`);
    else if (!d.locations.length) blocks.push('<p class="error">Sapo chưa trả danh sách kho.</p>');
    else {
      const last = lastLocation(), pick = d.locations.length === 1 ? String(d.locations[0].id) : d.locations.some(l => String(l.id) === last) ? last : '';
      blocks.push(`<label>Kho xuất hàng trên Sapo<select id="sapo-push-location" required><option value="">— Chọn kho —</option>${d.locations.map(l => `<option value="${l.id}"${String(l.id) === pick ? ' selected' : ''}>${esc(l.name)}</option>`).join('')}</select></label>`);
    }
    blocks.push('<p class="muted small">Tạo cùng lúc đơn NHÁP trên Sapo (khách / sản phẩm chưa có trên Sapo sẽ được tạo theo mã KH / MST / SKU). Sapo lỗi thì không sinh đơn / HĐKT.</p>');
    body.innerHTML = choice + `<div id="sapo-push-detail">${blocks.join('')}</div>` + '<p class="error" id="sapo-push-error" role="alert"></p>';
    const sel = $('#sapo-push-location');
    me.push = () => body.querySelector('input[name="sapo-push-mode"]:checked')?.value !== 'no';
    me.sync = () => {
      const push = me.push();
      $('#sapo-push-detail').hidden = !push;
      if (!me.busy) submit.textContent = push ? action : title;
      submit.disabled = me.busy || (push && (!d.connected || !!d.problems.length || !sel?.value));
    };
    sel?.addEventListener('change', me.sync);
    body.querySelectorAll('input[name="sapo-push-mode"]').forEach(r => r.addEventListener('change', me.sync)); me.sync();
    return result;
  }

  $('#sapo-push-form').addEventListener('submit', async e => {
    e.preventDefault();
    const me = current, sel = $('#sapo-push-location'), push = me?.push?.() ?? true;
    if (!me || me.busy || (push && !sel?.value)) return;
    me.busy = true; me.sync?.(); const label = submit.textContent; submit.textContent = push ? 'Đang tạo đơn + đơn Sapo…' : 'Đang tạo…'; $('#sapo-push-error').textContent = '';
    try {
      const r = await me.run(push ? Number(sel.value) : null, push);
      if (push) remember(sel.value);
      current = null; dialog.close(); me.resolve(r);
    } catch (ex) {
      const err = $('#sapo-push-error');
      err.textContent = ex.message + ' Chưa sinh đơn / HĐKT nào.';
      // Lỗi lúc đẩy Sapo: cho sinh luôn trên web (không qua Sapo) thay vì kẹt lại.
      if (push) {
        const alt = document.createElement('button');
        alt.type = 'button'; alt.className = 'btn secondary small'; alt.textContent = `${me.title} không qua Sapo`;
        alt.addEventListener('click', () => { const no = body.querySelector('input[name="sapo-push-mode"][value="no"]'); if (no) { no.checked = true; me.sync?.(); dialog.querySelector('#sapo-push-form').requestSubmit(); } });
        err.append(' ', alt);
      }
      submit.textContent = label; me.busy = false; me.sync?.();
    }
  });
  return { choose };
}

