// Chấm công từ máy ADMS: chỉ Manager mở từ Bảng lương. Mọi quyền kiểm lại ở API.
import { renderSynctimeWebhook } from './synctime-webhook.js';
const STATES = { 0: 'Vào', 1: 'Ra', 4: 'Vào tăng ca', 5: 'Ra tăng ca', 255: 'Chưa xác định' };
function el(tag, text, cls) {
  const node = document.createElement(tag); if (text !== undefined) node.textContent = text;
  if (cls) node.className = cls; return node;
}
function button(text, action, cls = 'btn secondary') {
  const b = el('button', text, cls); b.type = 'button'; b.addEventListener('click', action); return b;
}
function field(label, input) { const l = el('label', label); l.append(input); return l; }
function input(type, value = '') { const i = el('input'); i.type = type; i.value = value; return i; }
export async function openAdms({ api, toast }, month) {
  const dlg = el('dialog', undefined, 'modal'); dlg.style.width = 'min(960px, 96vw)'; dlg.style.maxWidth = '960px';
  const head = el('div', undefined, 'modal-head'); head.append(el('h2', 'Kết nối chấm công'), button('×', () => dlg.close(), 'icon-btn'));
  const body = el('div', undefined, 'modal-body'); const message = el('p', 'Đang kiểm tra kết nối ADMS…', 'muted'); message.setAttribute('role', 'status');
  dlg.append(head, body); document.body.append(dlg); dlg.addEventListener('close', () => dlg.remove(), { once: true }); dlg.showModal();
  await renderSynctimeWebhook(body, { api, toast });
  if (!dlg.open) return;
  body.append(el('h3', 'Đồng bộ ADMS trực tiếp'), message);
  try {
    let config = await api('/hr/adms');
    if (!dlg.open) return;
    if (!config.configured) { message.textContent = 'Chưa cấu hình ADMS. Cần địa chỉ API, company_id và mã kết nối trên máy chủ CRM. Khi kết nối xong, anh/chị có thể đồng bộ và ghép mã nhân viên tại đây.'; return; }
    const showConfig = () => { message.textContent = `Công ty ADMS: ${config.companyId}. ` + (config.lastSync
      ? `Đồng bộ gần nhất: ${new Date(config.lastSync.syncedAt).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })} (${config.lastSync.fromDate} → ${config.lastSync.toDate}).`
      : 'Chưa đồng bộ.'); }; showConfig();
    body.append(el('p', 'Giờ máy theo Việt Nam. Lượt vào/ra dùng để đối chiếu; ngày công và lương vẫn do Manager duyệt, không tự thay đổi.', 'muted'));
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' })
      .formatToParts(new Date()).map(p => [p.type, p.value]));
    const fallback = `${parts.year}-${parts.month}-${parts.day}`;
    const m = /^\d{4}-\d{2}$/.test(month || '') ? month : fallback.slice(0, 7);
    const last = new Date(Date.UTC(+m.slice(0, 4), +m.slice(5), 0)).toISOString().slice(0, 10);
    const from = input('date', m + '-01'), to = input('date', m === fallback.slice(0, 7) ? fallback : last), code = input('text');
    from.required = to.required = true; code.placeholder = 'Tất cả mã máy'; code.maxLength = 100;
    const filters = el('div', undefined, 'form-grid cols-2'); filters.append(field('Từ ngày', from), field('Đến ngày', to), field('Mã nhân viên trên máy', code));
    const actions = el('div', undefined, 'row-gap');
    const info = el('p', '', 'muted'), logsHost = el('div', undefined, 'table-wrap'), pager = el('div', undefined, 'row-gap');
    let page = 1, total = 0, seq = 0;
    const range = () => {
      if (!from.value || !to.value || from.value > to.value || +new Date(to.value) - +new Date(from.value) > 30 * 864e5)
        throw new Error('Chọn khoảng ngày hợp lệ, tối đa 31 ngày.');
      return { from: from.value, to: to.value };
    };
    const mapCode = input('text'); mapCode.required = true; mapCode.maxLength = 100;
    async function loadLogs() {
      const r = range(), request = ++seq;
      const d = await api('/hr/adms/logs?' + new URLSearchParams({ ...r, page: String(page), empCode: code.value.trim() }));
      if (!dlg.open || request !== seq) return;
      total = d.total; info.textContent = `${total} lượt · Trang ${page}/${Math.max(1, Math.ceil(total / 100))}`;
      logsHost.replaceChildren(); pager.replaceChildren();
      if (!d.logs.length) logsHost.append(el('p', 'Chưa có lượt chấm công trong bộ lọc này.', 'muted'));
      else {
        const table = el('table', undefined, 'data-table'), thead = el('thead'), tr = el('tr');
        for (const title of ['Thời gian', 'Mã máy', 'Tên trên máy', 'Nhân viên CRM', 'Loại', 'Thiết bị']) tr.append(el('th', title));
        thead.append(tr); const tbody = el('tbody');
        for (const row of d.logs) {
          const tr = el('tr'), codeCell = el('td');
          codeCell.append(button(row.empCode, () => { mapCode.value = row.empCode; mapCode.focus(); }, 'btn ghost small'));
          tr.append(el('td', row.checkTime), codeCell, el('td', row.fullName || '—'), el('td', row.memberName || 'Chưa ghép'),
            el('td', STATES[row.punchState] || `Loại ${row.punchState}`), el('td', row.deviceSerial || '—')); tbody.append(tr);
        }
        table.append(thead, tbody); logsHost.append(table);
      }
      const prev = button('‹ Trước', async () => { page--; await run(loadLogs); }); prev.disabled = page <= 1;
      const next = button('Sau ›', async () => { page++; await run(loadLogs); }); next.disabled = page * 100 >= total;
      pager.append(prev, next);
    }
    const run = async fn => { try { await fn(); } catch (e) { toast(e.message, 'err'); } };
    const reload = button('Xem lượt chấm công', () => run(async () => { page = 1; await loadLogs(); }));
    const sync = button('Đồng bộ từ máy', () => run(async () => {
      const r = range(); sync.disabled = true; sync.textContent = 'Đang đồng bộ…';
      try {
        const d = await api('/hr/adms/sync', 'POST', r);
        toast(`Đã đọc ${d.fetched} lượt: thêm ${d.inserted}, đã có ${d.existing}.`);
        config = await api('/hr/adms'); showConfig(); page = 1; await loadLogs();
      } finally { sync.disabled = false; sync.textContent = 'Đồng bộ từ máy'; }
    }), 'btn primary'); actions.append(reload, sync);
    body.append(filters, actions, info, logsHost, pager, el('h3', 'Ghép mã máy với nhân viên CRM'));
    body.append(el('p', 'Bấm mã máy trong danh sách hoặc nhập mã ở dưới. Mỗi nhân viên ghép một mã trong công ty ADMS.', 'muted'));
    const mappingsHost = el('div'), mappingForm = el('form', undefined, 'form-grid cols-2'), member = el('select'); member.required = true;
    const save = el('button', 'Lưu ghép mã', 'btn secondary'); save.type = 'submit';
    mappingForm.append(field('Mã máy', mapCode), field('Nhân viên CRM', member), save); body.append(mappingForm, mappingsHost);
    async function loadMappings() {
      const d = await api('/hr/adms/mappings'); if (!dlg.open) return;
      member.replaceChildren(); const blank = el('option', '— Chọn nhân viên —'); blank.value = ''; member.append(blank);
      for (const m of d.members) { const o = el('option', m.name + (m.active ? '' : ' (đã khoá)')); o.value = m.id; member.append(o); }
      mappingsHost.replaceChildren();
      for (const map of d.mappings) {
        const row = el('div', undefined, 'row-gap'); row.append(el('span', `${map.empCode} → ${d.members.find(m => m.id === map.memberId)?.name || map.memberId}`),
          button('Bỏ ghép', () => run(async () => {
            await api('/hr/adms/mappings/' + encodeURIComponent(map.empCode), 'DELETE'); await loadMappings(); await loadLogs();
          }), 'btn ghost small')); mappingsHost.append(row);
      }
    }
    mappingForm.addEventListener('submit', e => { e.preventDefault(); if (!mappingForm.reportValidity()) return;
      run(async () => { save.disabled = true; try {
        await api('/hr/adms/mappings', 'PUT', { empCode: mapCode.value.trim(), memberId: member.value });
        toast('Đã ghép mã máy.'); mapCode.value = ''; await loadMappings(); await loadLogs();
      } finally { save.disabled = false; } });
    });
    await loadMappings(); await loadLogs();
  } catch (e) { message.textContent = e.message; message.className = 'danger-text'; }
}
