// CHĂM SÓC KHÁCH HÀNG (nhật ký giao dịch kiểu CRM): trang #/care + hộp ghi / sửa dùng chung cho trang chi tiết khách.
// - Tab "Cần chăm sóc": lịch hẹn chưa xong (quá hạn → hôm nay → sắp tới); tab "Nhật ký": mọi lần trao đổi, mới nhất trước.
// - Nhân viên chỉ thấy lần mình ghi; Manager thấy tất cả và lọc được theo nhân viên (máy chủ quyết định, giao diện chỉ hiển thị).
// - Danh mục hình thức / kết quả lấy từ GET /care/config (chuẩn ở src/modules/care/domain/care.ts) – không chép tay ở đây.
// API: src/modules/care/api/routes.ts.
const esc = v => String(v ?? '').normalize('NFC').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const dmy = iso => iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '';
const todayIso = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date());
const addDays = (iso, n) => new Date(Date.parse(iso + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
/** Giờ:phút ngày/tháng theo giờ Việt Nam. */
const when = iso => iso ? new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(iso)) : '';
/** ISO → giá trị ô datetime-local (giờ Việt Nam). */
const toLocalInput = iso => new Date(Date.parse(iso) + 7 * 3600e3).toISOString().slice(0, 16);
const fromLocalInput = v => v ? new Date(v + ':00+07:00').toISOString() : '';
/** Màu theo kết quả (lớp .pill). */
const RESULT_TONE = { consulting: 'info', quote_sent: 'warn', negotiating: 'warn', won: 'ok', lost: 'off' };
const TYPE_ICON = { call: '📞', zalo: '💬', email: '✉️', meeting: '🤝', quote: '📄' };

/** Ô hẹn chăm sóc tiếp: ngày + trạng thái (quá hạn / hôm nay / còn n ngày / đã xong). */
export function followUpCell(a) {
  if (!a.nextAt) return '<span class="muted">—</span>';
  const days = Math.round((Date.parse(a.nextAt) - Date.parse(todayIso())) / 864e5), done = !!a.nextDoneAt;
  const tone = done ? 'muted' : days < 0 ? 'danger' : days === 0 ? 'warn' : days <= 2 ? 'info' : 'ok';
  const note = done ? 'đã xong ✓' : days < 0 ? `trễ ${-days} ngày` : days === 0 ? 'hôm nay' : days === 1 ? 'ngày mai' : `còn ${days} ngày`;
  return `<span class="due-date ${tone}"><b>${dmy(a.nextAt)}</b><small>${note}</small></span>${a.remindLabel && !done ? `<small class="care-next">Nhắc trước ${esc(a.remindLabel.toLowerCase())}</small>` : ''}${a.nextAction ? `<small class="care-next">${esc(a.nextAction)}</small>` : ''}`;
}
/** Nội dung một lần chăm sóc (tiêu đề + nội dung + người liên hệ) dùng chung cho bảng ở trang Chăm sóc và trang chi tiết khách. */
export const careSummary = a => `${a.subject ? `<b>${esc(a.subject)}</b>` : ''}${a.content ? `<small class="care-content">${esc(a.content)}</small>` : ''}${a.contactName ? `<small>Trao đổi với: ${esc(a.contactName)}</small>` : ''}`;
export const careType = a => `<span class="care-type">${TYPE_ICON[a.type] || ''} ${esc(a.typeLabel || a.type)}</span>`;
export const careResult = a => `<span class="pill ${RESULT_TONE[a.result] || ''}">${esc(a.resultLabel || a.result)}</span>${a.expectedRevenue ? `<small class="care-next">DS dự kiến ${new Intl.NumberFormat('vi-VN').format(a.expectedRevenue)} đ</small>` : ''}`;

/**
 * @param deps { api, toast, confirmBox, isManager, go, root (phần tử #view-care) }
 * @returns { load(id?), openForm({ customer?, activity? }, onSaved?) }
 */
export function initCare(deps) {
  const { api, toast, confirmBox, isManager } = deps, root = deps.root;
  const st = { view: 'follow-ups', q: '', type: '', result: '', from: '', to: '', owner: '', rows: [], counts: { overdue: 0, today: 0 }, total: 0 };
  let config = null, people = null, timer = 0;
  const loadConfig = async () => (config ||= await api('/care/config'));
  const options = (list, sel, first) => (first ? `<option value="">${first}</option>` : '') + list.map(x => `<option value="${esc(x.key ?? x.id)}"${(x.key ?? x.id) === sel ? ' selected' : ''}>${esc(x.label ?? x.name)}</option>`).join('');

  // ----- trang
  async function shell() {
    await loadConfig();
    if (isManager() && !people) { try { people = (await api('/tasks/people')).people; } catch { people = []; } }
    root.innerHTML = `<div class="page-head">
        <div><span class="eyebrow">Kinh doanh</span><h1>Chăm sóc khách hàng</h1><p class="muted">Ghi lại mỗi lần gọi điện, nhắn Zalo, gặp khách… kèm kết quả và lịch hẹn chăm sóc tiếp. Hẹn đến hạn tự hiện ở Công việc.</p></div>
        <button type="button" class="btn-add" data-care-new title="Ghi chăm sóc" aria-label="Ghi chăm sóc"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg></button>
      </div>
      <div class="stats care-stats" data-stats></div>
      <div class="panel">
        <div class="seg care-tabs" role="tablist">${[['follow-ups', 'Cần chăm sóc'], ['log', 'Nhật ký']].map(([k, t]) => `<button type="button" role="tab" data-care-view="${k}" aria-selected="${st.view === k}">${t}</button>`).join('')}</div>
        <div class="toolbar care-filters">
          <label class="search"><svg viewBox="0 0 24 24"><path d="M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4"/></svg><input type="search" data-f="q" value="${esc(st.q)}" placeholder="Tìm khách, nội dung, người liên hệ…" aria-label="Tìm"></label>
          <select data-f="type" aria-label="Hình thức">${options(config.types, st.type, 'Mọi hình thức')}</select>
          <select data-f="result" aria-label="Kết quả">${options(config.results, st.result, 'Mọi kết quả')}</select>
          <label class="inline">Từ <input type="date" data-f="from" value="${esc(st.from)}"></label><label class="inline">đến <input type="date" data-f="to" value="${esc(st.to)}"></label>
          ${isManager() ? `<select data-f="owner" aria-label="Nhân viên">${options(people || [], st.owner, 'Mọi nhân viên')}</select>` : ''}
          <span class="muted small" data-count></span>
        </div>
        <div class="table-wrap"><table class="data-table care-table"><thead><tr><th>Thời gian</th><th>Khách hàng</th><th>Hình thức</th><th>Nội dung</th><th>Kết quả</th><th>Hẹn tiếp</th><th>Người ghi</th><th></th></tr></thead><tbody data-list></tbody></table></div>
        <div class="empty" data-empty hidden><p data-empty-text></p></div>
      </div>`;
  }
  const rowHtml = a => `<tr class="${a.followUp === 'overdue' ? 'care-overdue' : ''}">
      <td class="nowrap">${esc(when(a.occurredAt))}</td>
      <td><a href="#/customers/${encodeURIComponent(a.customerId)}">${esc(a.customerName)}</a>${a.customerPhone ? `<small>${esc(a.customerPhone)}</small>` : ''}</td>
      <td>${careType(a)}</td><td class="care-text">${careSummary(a)}</td><td>${careResult(a)}</td><td>${followUpCell(a)}</td>
      <td>${esc(a.ownerName)}</td>
      <td class="row-actions">${a.canEdit && a.nextAt && !a.nextDoneAt ? `<button type="button" class="btn ok small" data-care-done="${esc(a.id)}" title="Đã chăm sóc theo hẹn">✓ Xong</button>` : ''}
        ${a.canEdit ? `<button type="button" class="btn ghost small" data-care-edit="${esc(a.id)}">Sửa</button><button type="button" class="icon-btn danger" data-care-del="${esc(a.id)}" title="Xoá" aria-label="Xoá">×</button>` : ''}</td></tr>`;
  async function refresh() {
    const qs = new URLSearchParams({ view: st.view, ...Object.fromEntries(['q', 'type', 'result', 'from', 'to', 'owner'].filter(k => st[k]).map(k => [k, st[k]])) });
    const list = root.querySelector('[data-list]'); if (!list) return;
    list.innerHTML = '<tr class="skeleton"><td colspan="8"><span></span></td></tr>';
    try {
      const d = await api('/care?' + qs); Object.assign(st, { rows: d.activities, counts: d.counts, total: d.total }); badge();
    } catch (ex) { list.innerHTML = ''; root.querySelector('[data-empty]').hidden = false; root.querySelector('[data-empty-text]').textContent = ex.message; return; }
    list.innerHTML = st.rows.map(rowHtml).join('');
    root.querySelector('[data-empty]').hidden = !!st.rows.length;
    root.querySelector('[data-empty-text]').textContent = st.view === 'follow-ups' ? 'Không có lịch hẹn chăm sóc nào đang chờ. 👍' : 'Chưa có lần chăm sóc nào. Bấm ＋ để ghi.';
    root.querySelector('[data-count]').textContent = st.total > st.rows.length ? `${st.rows.length}/${st.total} dòng` : `${st.total} dòng`;
    root.querySelector('[data-stats]').innerHTML = [['overdue', 'Quá hạn chăm sóc', 'danger'], ['today', 'Hẹn hôm nay', 'warn']]
      .map(([k, t, tone]) => `<button type="button" class="stat task-stat ${st.counts[k] ? tone : ''}" data-care-view="follow-ups"><small>${t}</small><strong>${st.counts[k]}</strong></button>`).join('');
    root.querySelectorAll('[data-care-view]').forEach(b => b.getAttribute('role') === 'tab' && b.setAttribute('aria-selected', String(b.dataset.careView === st.view)));
  }
  root.addEventListener('input', e => {
    const k = e.target.dataset?.f; if (!k) return;
    st[k] = e.target.value; clearTimeout(timer); timer = setTimeout(refresh, k === 'q' ? 300 : 0);
  });
  root.addEventListener('click', async e => {
    const t = e.target;
    const v = t.closest('[data-care-view]'); if (v) { st.view = v.dataset.careView; return refresh(); }
    if (t.closest('[data-care-new]')) return openForm({}, refresh);
    const ed = t.closest('[data-care-edit]'); if (ed) return openForm({ activity: st.rows.find(a => a.id === ed.dataset.careEdit) }, refresh);
    const done = t.closest('[data-care-done]');
    if (done) { const a=st.rows.find(a=>a.id===done.dataset.careDone);if(!a)return;try { await api(`/care/${encodeURIComponent(done.dataset.careDone)}/done`, 'POST', {revision:a.revision,nextAt:a.nextAt}); toast('Đã đánh dấu chăm sóc xong.'); refresh(); } catch (ex) { toast(ex.message, 'err'); } return; }
    const del = t.closest('[data-care-del]');
    if (del) {
      if (!await confirmBox('Xoá lần chăm sóc này?', { ok: 'Xoá', danger: true })) return;
      try { await api(`/care/${encodeURIComponent(del.dataset.careDel)}`, 'DELETE'); toast('Đã xoá.'); refresh(); } catch (ex) { toast(ex.message, 'err'); }
    }
  });
  /** Mở trang; `id` (từ việc tự sinh #/care/<id>) → mở luôn hộp sửa lần chăm sóc đó. */
  async function load(id) {
    try { await shell(); } catch (ex) { root.innerHTML = `<p class="error card">${esc(ex.message)}</p>`; return; }
    await refresh();
    if (id) { try { openForm({ activity: (await api('/care/' + encodeURIComponent(id))).activity }, refresh); } catch (ex) { toast(ex.message, 'err'); } }
  }

  // ----- hộp ghi / sửa (bố cục như form "Giao dịch" của CRM đang dùng: một cột, chọn nhanh bằng nút)
  const money = n => n ? new Intl.NumberFormat('vi-VN').format(n) : '';
  const parseMoney = v => Number(String(v || '').replace(/[^\d]/g, '')) || 0;
  const seg = (name, list, sel) => `<div class="care-seg" role="radiogroup">${list.map(x => `<label><input type="radio" name="${name}" value="${esc(x.key)}"${x.key === sel ? ' checked' : ''}><span>${esc(x.label)}</span></label>`).join('')}</div>`;
  /** `customer` = khách chọn sẵn (từ trang chi tiết khách), `activity` = lần chăm sóc cần sửa. */
  async function openForm({ customer = null, activity = null } = {}, onSaved) {
    try { await loadConfig(); if (isManager() && !people) people = (await api('/tasks/people')).people; } catch (ex) { return toast(ex.message, 'err'); }
    const a = activity, today = todayIso();
    let picked = a ? { id: a.customerId, name: a.customerName } : customer;
    const me = deps.userId?.() || '', owner = a?.ownerId || me;
    const dlg = document.createElement('dialog'); dlg.className = 'modal care-dialog';
    dlg.innerHTML = `<form method="dialog" autocomplete="off">
      <div class="modal-head"><div><span class="eyebrow">Chăm sóc khách hàng</span><h2>${a ? 'Sửa giao dịch' : 'Giao dịch mới'}</h2></div><button type="button" class="icon-btn" data-x aria-label="Đóng">×</button></div>
      <div class="modal-body care-form">
        <label>Thời gian tạo<input type="date" name="occurredAt" max="${today}" value="${esc((a ? toLocalInput(a.occurredAt) : today).slice(0, 10))}"></label>
        <label>Nhân viên phụ trách${isManager() && people
          ? `<select name="ownerId">${people.filter(x => x.role !== 'customer' && x.role !== 'supplier').map(x => `<option value="${esc(x.id)}"${x.id === owner ? ' selected' : ''}>${esc(x.name)}</option>`).join('')}</select>`
          : `<b class="care-static">${esc(a?.ownerName || deps.userName?.() || '')}</b>`}</label>
        <label>Khách hàng *<span class="care-pick">${picked && (customer || a) ? `<b class="care-static">${esc(picked.name)}</b>` : `<input name="customerQ" placeholder="Gõ tên / SĐT / MST khách…" aria-label="Tìm khách hàng"><span class="care-suggest" data-suggest hidden></span>`}</span></label>
        <label>Người liên hệ *<input name="contactName" maxlength="160" list="care-contacts" value="${esc(a?.contactName || '')}" placeholder="Chọn người liên hệ của khách hoặc gõ tên – SĐT"><datalist id="care-contacts"></datalist></label>
        <label>Nội dung *<input name="content" maxlength="2000" value="${esc(a ? (a.content || a.subject) : '')}" placeholder="Ví dụ: Gọi hỏi thăm quà cuối năm"></label>
        <div class="care-field"><span>Loại giao dịch *</span>${seg('type', config.types, a?.type || 'call')}</div>
        <label>Doanh số dự kiến<span class="care-money"><button type="button" class="icon-btn" data-step="-1" aria-label="Giảm">−</button><input name="expectedRevenue" inputmode="numeric" value="${money(a?.expectedRevenue)}" placeholder="0"><button type="button" class="icon-btn" data-step="1" aria-label="Tăng">+</button></span></label>
        <div class="care-field"><span>Kết quả *</span>${seg('result', config.results, a?.result || 'consulting')}</div>
        <label>Chăm sóc lần sau *<input type="date" name="nextAt" min="${a?.nextAt && a.nextAt < today ? a.nextAt : today}" value="${esc(a?.nextAt || addDays(today, 7))}"></label>
        <div class="care-field"><span>Nhắc tôi trước *</span>${seg('remindBefore', config.reminds, a?.remindBefore || '1d')}</div>
        <p class="error" data-err></p>
      </div>
      <div class="modal-foot"><button type="button" class="btn secondary" data-x>Huỷ</button><button class="btn primary" data-save>Lưu</button></div></form>`;
    document.body.append(dlg);
    const form = dlg.querySelector('form'), f = form.elements, err = dlg.querySelector('[data-err]'), sug = dlg.querySelector('[data-suggest]');
    const close = () => { dlg.close(); dlg.remove(); };
    dlg.querySelectorAll('[data-x]').forEach(b => b.addEventListener('click', close)); dlg.addEventListener('close', () => dlg.remove());
    // Người liên hệ: liên hệ chính + danh bạ của khách (tên – SĐT – chức vụ).
    const fillContacts = async id => {
      try {
        const d = await api(`/customers/${encodeURIComponent(id)}/overview`), k = d.customer || {};
        const list = [[k.contact, k.phone], ...(d.contacts || []).map(x => [x.name, x.phone, x.title])].filter(x => x[0]).map(x => x.filter(Boolean).join(' – '));
        dlg.querySelector('#care-contacts').innerHTML = [...new Set(list)].map(n => `<option value="${esc(n)}">`).join('');
        if (!f.contactName.value && list.length) f.contactName.value = list[0];
      } catch { /* không bắt buộc */ }
    };
    if (picked?.id) fillContacts(picked.id);
    // Tìm khách (khi chưa chọn sẵn).
    let st2 = 0;
    f.customerQ?.addEventListener('input', () => {
      picked = null; clearTimeout(st2);
      const q = f.customerQ.value.trim(); if (q.length < 2) { sug.hidden = true; return; }
      st2 = setTimeout(async () => {
        try {
          const { customers } = await api('/customers?limit=8&q=' + encodeURIComponent(q));
          sug.innerHTML = customers.length ? customers.map(k => `<button type="button" data-pick="${esc(k.id)}" data-name="${esc(k.name)}"><b>${esc(k.name)}</b><small>${esc([k.contact, k.phone].filter(Boolean).join(' · '))}</small></button>`).join('') : '<span class="muted small">Không thấy khách phù hợp.</span>';
          sug.hidden = false;
        } catch (ex) { sug.innerHTML = `<span class="error">${esc(ex.message)}</span>`; sug.hidden = false; }
      }, 250);
    });
    sug?.addEventListener('click', e => {
      const b = e.target.closest('[data-pick]'); if (!b) return;
      picked = { id: b.dataset.pick, name: b.dataset.name }; f.customerQ.value = picked.name; sug.hidden = true;
      f.contactName.value = ''; fillContacts(picked.id);
    });
    // Doanh số dự kiến: − / + mỗi lần 1 triệu, tự thêm dấu chấm ngăn cách.
    dlg.querySelectorAll('[data-step]').forEach(b => b.addEventListener('click', () => { f.expectedRevenue.value = money(Math.max(0, parseMoney(f.expectedRevenue.value) + Number(b.dataset.step) * 1_000_000)); }));
    f.expectedRevenue.addEventListener('input', () => { const v = parseMoney(f.expectedRevenue.value); f.expectedRevenue.value = money(v); });
    form.addEventListener('submit', async e => {
      e.preventDefault(); err.textContent = '';
      if (!picked?.id) { err.textContent = 'Chọn khách hàng trong danh sách gợi ý.'; f.customerQ?.focus(); return; }
      const body = { customerId: picked.id, ownerId: f.ownerId?.value || undefined, occurredAt: f.occurredAt.value, contactName: f.contactName.value, content: f.content.value,
        type: f.type.value, expectedRevenue: parseMoney(f.expectedRevenue.value), result: f.result.value, nextAt: f.nextAt.value, remindBefore: f.remindBefore.value,
        ...(a ? { subject: '', nextAction: a.nextAction || '', revision: a.revision } : {}) };
      const btn = dlg.querySelector('[data-save]'); btn.disabled = true;
      try {
        await api(a ? `/care/${encodeURIComponent(a.id)}` : '/care', a ? 'PUT' : 'POST', body);
        close(); toast(a ? 'Đã lưu.' : 'Đã ghi giao dịch. Đến hạn nhắc sẽ hiện ở Công việc.'); onSaved?.();
      } catch (ex) { err.textContent = ex.message; } finally { btn.disabled = false; }
    });
    dlg.showModal();
    (f.customerQ || f.content).focus();
  }

  /** Huy hiệu menu: số hẹn chăm sóc quá hạn + hôm nay của tôi (Manager: của mọi người). */
  /** `known`: kết quả đã có (từ GET /badges) → không gọi máy chủ. */
  async function badge(known) {
    const el = document.getElementById('nav-care-count'); if (!el) return;
    try { const { counts } = known || await api('/care?view=follow-ups&limit=1'); const n = counts.overdue + counts.today; el.textContent = n; el.hidden = !n; } catch { el.hidden = true; }
  }
  return { load, openForm, badge };
}

