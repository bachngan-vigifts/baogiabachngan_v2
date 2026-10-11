/** Dashboard read-only. DOM nodes/textContent only; uses the app's existing authenticated API. */
export function initDashboard({ api, root, isManager, money }) {
  const node = (tag, text, cls) => { const n = document.createElement(tag); if (text != null) n.textContent = String(text); if (cls) n.className = cls; return n; };
  let requestId = 0, filters = { from: new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' }).slice(0, 7), to: '', owner: '', group: '', neglectDays: '30', page: '1' };
  filters.to = filters.from;
  let options = { employees: [], groups: [] };
  const wrap = node('div', null, 'revenue-dashboard'); root.append(wrap);
  const form = node('form', null, 'card revenue-filters'), content = node('div');
  wrap.append(node('h1', 'Tổng quan doanh số'), form, content);
  const field = (title, key, type = 'month') => { const label = node('label', title), input = node('input'); input.type = type; input.value = filters[key]; input.name = key; if (type === 'number') { input.min = '1'; input.max = '365'; } label.append(input); form.append(label); return input; };
  const from = field('Từ tháng', 'from'), to = field('Đến tháng', 'to'), days = field('Lâu chưa chăm sóc (ngày)', 'neglectDays', 'number');
  const select = (title, key) => { const label = node('label', title), s = node('select'); s.name = key; label.append(s); form.append(label); return s; };
  const group = select('Nhóm theo chức vụ', 'group'), owner = select('Nhân viên', 'owner');
  const submit = node('button', 'Xem tổng quan', 'btn primary'); submit.type = 'submit'; form.append(submit);
  const selectOptions = (s, rows, all) => { s.replaceChildren(); const any = node('option', all); any.value = ''; s.append(any); for (const r of rows) { const o = node('option', r.name); o.value = r.id; s.append(o); } s.value = filters[s.name]; };
  form.addEventListener('submit', e => { e.preventDefault(); filters = { from: from.value, to: to.value, neglectDays: days.value, group: group.value, owner: owner.value, page: '1' }; load(); });
  const table = (title, headers, rows) => {
    const card = node('div', null, 'card'); card.append(node('h2', title)); const scroller = node('div', null, 'revenue-table-scroll'), t = node('table'), head = node('thead'), hrow = node('tr');
    for (const h of headers) hrow.append(node('th', h)); head.append(hrow); t.append(head); const body = node('tbody');
    for (const cells of rows) { const r = node('tr'); for (const value of cells) { const c = node('td'); if (value instanceof Node) c.append(value); else c.textContent = String(value ?? '—'); r.append(c); } body.append(r); }
    if (!rows.length) { const r = node('tr'), c = node('td', 'Chưa có dữ liệu trong kỳ.'); c.colSpan = headers.length; r.append(c); body.append(r); }
    t.append(body); scroller.append(t); card.append(scroller); return card;
  };
  const rate = r => r.closeRate == null ? '—' : `${r.closeRate}% (${r.converted}/${r.quotes})`;
  const metricCells = r => [money(r.actual), money(r.expected), money(r.pipeline), rate(r), r.lost];
  async function load() {
    const id = ++requestId; submit.disabled = true; content.replaceChildren(node('p', 'Đang tải tổng quan…', 'muted'));
    group.parentElement.hidden = owner.parentElement.hidden = !isManager();
    try {
      const data = await api('/dashboard/revenue?' + new URLSearchParams(filters)); if (id !== requestId) return;
      if (!filters.owner && !filters.group) options = data.filters;
      selectOptions(group, options.groups, 'Tất cả nhóm'); selectOptions(owner, options.employees, 'Tất cả nhân viên');
      content.replaceChildren();
      const date = value => new Date(value).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
      content.append(node('p', data.lastSyncedAt ? `Dữ liệu cập nhật lúc ${date(data.lastSyncedAt)}${data.syncSource === 'customers' ? ' (mốc đồng bộ khách hàng)' : ''}. Dữ liệu Sapo có thể chậm.` : 'Chưa có mốc đồng bộ Sapo. Dữ liệu Sapo có thể chậm.', 'muted'));
      content.append(node('p', `${data.scope === 'company' ? 'Phạm vi quản lý' : 'Doanh số của bạn'} · Tổng hợp lúc ${date(data.calculatedAt)}. Doanh số gồm VAT; Đơn/HĐKT được tính một lần.`, 'muted'));
      const cards = node('div', null, 'revenue-metrics');
      for (const [label, value] of [['Doanh số đã chốt', money(data.summary.actual)], ['Dự kiến từ chăm sóc', money(data.summary.expected)], ['Pipeline đang theo đuổi', money(data.summary.pipeline)], ['Tỷ lệ chốt báo giá', rate(data.summary)], ['Đã rớt (chăm sóc)', data.summary.lost], ['Khách lâu chưa chăm sóc', data.neglected.total]]) { const card = node('div', null, 'card'); card.append(node('p', label, 'muted'), node('strong', value)); cards.append(card); }
      content.append(cards);
      content.append(node('p', 'Dự kiến và số rớt lấy lần chăm sóc mới nhất của từng cặp khách/nhân viên trong kỳ. Pipeline lấy trạng thái mới nhất đến cuối kỳ: tư vấn, gửi báo giá, thương lượng. Tỷ lệ chốt = báo giá trong kỳ đã sinh đơn còn hiệu lực / tổng báo giá trong kỳ.', 'muted'));
      content.append(table('Pipeline theo giai đoạn', ['Giai đoạn', 'Giá trị'], [['Đang tư vấn', money(data.summary.consulting)], ['Đã gửi báo giá', money(data.summary.quote_sent)], ['Đang thương lượng', money(data.summary.negotiating)]]));
      const headers = ['Nhân viên', 'Nhóm', 'Thực tế', 'Dự kiến', 'Pipeline', 'Tỷ lệ chốt', 'Đã rớt'];
      content.append(table('Theo nhân viên', headers, data.employees.map(r => [r.name + (r.active ? '' : ' (ngừng hoạt động)'), r.groupName || 'Chưa phân nhóm', ...metricCells(r)])));
      if (isManager()) content.append(table('Theo nhóm', ['Nhóm', 'Thực tế', 'Dự kiến', 'Pipeline', 'Tỷ lệ chốt', 'Đã rớt'], data.groups.map(r => [r.name, ...metricCells(r)])));
      content.append(table('Theo tháng', ['Tháng', 'Thực tế', 'Dự kiến', 'Tỷ lệ chốt', 'Đã rớt'], data.months.map(r => [r.month, money(r.actual), money(r.expected), rate(r), r.lost])));
      content.append(table(`Khách lâu chưa chăm sóc · ${data.neglected.total} khách`, ['Khách hàng', 'Chăm sóc gần nhất'], data.neglected.customers.map(r => { const a = node('a', r.name); a.href = '#/customers/' + encodeURIComponent(r.id); return [a, r.lastAt ? date(r.lastAt) : 'Chưa ghi chăm sóc']; })));
      const pages = Math.max(1, Math.ceil(data.neglected.total / data.neglected.pageSize)), pager = node('div', null, 'revenue-pager');
      for (const [label, delta] of [['Trước', -1], ['Sau', 1]]) { const b = node('button', label, 'btn'); b.type = 'button'; b.disabled = delta < 0 ? data.neglected.page <= 1 : data.neglected.page >= pages; b.addEventListener('click', () => { filters.page = String(data.neglected.page + delta); load(); }); pager.append(b); }
      pager.append(node('span', `Trang ${data.neglected.page}/${pages}`)); content.append(pager);
    } catch (e) { if (id === requestId) { content.replaceChildren(node('p', e.message || 'Không tải được tổng quan.', 'error')); const retry = node('button', 'Thử lại', 'btn'); retry.addEventListener('click', load); content.append(retry); } }
    finally { if (id === requestId) submit.disabled = false; }
  }
  return { load };
}
