import { el, buyHead, buyKpis, buyTools, buyBadge, buyDate, buyDueText, buyNum } from './buy-layout.js';

const EARLY_STATUS = { draft: ['Nháp, chưa gửi NCC', 'grey'], pending: ['Chờ NCC xác nhận', 'amber'], accepted: ['NCC đồng ý', 'blue'], rejected: ['NCC từ chối', 'red'], mixed: ['NCC phản hồi một phần', 'amber'] };
const STATES = [
  { key: 'late', label: 'Quá hẹn', tone: 'bad' },
  { key: 'scheduled', label: 'Hôm nay & sắp tới' },
  { key: 'undated', label: 'Chưa hẹn ngày', tone: 'warn' },
  { key: '', label: 'Tất cả' },
];

/** Trang Nhận hàng: hàng NCC còn chờ nhận (đơn mua + phiếu lấy hàng trước), mới tạo nằm trên. */
export function initReceivingCalendar({ api, root, confirmBox = async () => false }) {
  const page = el('div', 'sup-page buy-page');
  const head = buyHead({ eyebrow: 'Kho & giao hàng', title: 'Nhận hàng NCC',
    desc: 'Hàng NCC còn chờ nhận: đơn mua và phiếu lấy hàng trước. Bấm Nhận hàng để ghi phiếu nhận.',
    more: [{ label: 'Làm mới', hint: 'Tải lại danh sách', onClick: () => reset() }] });
  let state = '';
  const kpis = buyKpis(STATES.map(s => ({ ...s, key: s.key || 'all' })), key => { state = key === 'all' ? '' : key; reset(); });
  const from = el('input'), to = el('input'), supplier = el('select'), type = el('select'), sku = el('input');
  from.type = to.type = 'date'; sku.type = 'search'; sku.placeholder = 'Mã SKU…';
  for (const [value, text] of [['', 'Tất cả'], ['purchase', 'Đơn mua NCC'], ['early', 'Phiếu lấy hàng trước']]) type.append(Object.assign(el('option', '', text), { value }));
  supplier.append(Object.assign(el('option', '', 'Tất cả NCC'), { value: '' }));
  const tools = buyTools({ placeholder: 'Tìm số chứng từ, NCC, mã hoặc tên hàng…', fields: [['Từ ngày', from], ['Đến ngày', to], ['Nhà cung cấp', supplier], ['Loại chứng từ', type], ['Mã hàng', sku]],
    onSearch: () => reset(), onClear: () => { from.value = to.value = sku.value = supplier.value = type.value = ''; reset(); } });
  const panel = el('div', 'panel buy-panel'), hint = el('p', 'muted small buy-hint'), summary = el('p', 'muted small buy-summary');
  const wrap = el('div', 'table-wrap'), table = el('table', 'data-table buy-list'), th = el('tr'), body = el('tbody');
  for (const text of ['Ngày hẹn', 'Chứng từ', 'Hàng chờ nhận', 'Việc cần làm']) th.append(el('th', '', text));
  const thead = el('thead'); thead.append(th); table.append(thead, body); wrap.append(table);
  const foot = el('div', 'buy-pager'), prev = el('button', 'btn secondary small', '‹ Trước'), next = el('button', 'btn secondary small', 'Sau ›'), range = el('span', 'muted small');
  foot.dataset.mobileActions = 'off'; prev.type = next.type = 'button'; foot.append(prev, range, next);
  panel.append(tools.node, hint, summary, wrap, foot); page.append(head.node, kpis.node, panel); root.append(page);
  hint.hidden = true;
  let offset = 0, request = 0, routeQuery = null, workOnly = false;
  const activeFilters = () => [from.value, to.value, supplier.value, type.value, sku.value].filter(Boolean).length;
  function reset() { offset = 0; return load(); }
  for (const control of [from, to, supplier, type]) control.addEventListener('change', reset);
  let timer; sku.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(reset, 250); });
  prev.addEventListener('click', () => { offset = Math.max(0, offset - 50); load(); }); next.addEventListener('click', () => { offset += 50; load(); });

  function confirmButton(r, l) {
    const b = el('button', 'btn secondary small', 'Xác nhận thay NCC'); b.type = 'button';
    b.addEventListener('click', async () => {
      if (b.disabled) return; b.disabled = true;
      try {
        if (!await confirmBox(`Xác nhận thay ${r.supplierName} đồng ý giao trước ${l.sku}: ${buyNum(l.requestedQty ?? l.left)} ${l.unit || ''}? Đây là xác nhận của NCC, chưa ghi nhận hàng vào kho.`, { title: 'Xác nhận thay NCC', ok: 'Đã trao đổi với NCC, xác nhận' })) return;
        await api('/purchase-early-request-lines/' + encodeURIComponent(l.lineId) + '/manager-confirm', 'POST', { supplierId: r.supplierId });
        await load();
      } catch (e) { summary.textContent = e.message || 'Không xác nhận được phiếu.'; } finally { b.disabled = false; }
    });
    return b;
  }

  async function load() {
    const query = location.hash.split('?')[1] || '';
    if (query !== routeQuery) { const p = new URLSearchParams(query); type.value = ['early', 'purchase'].includes(p.get('type')) ? p.get('type') : ''; workOnly = p.get('workOnly') === '1'; routeQuery = query; offset = 0; }
    hint.hidden = !workOnly;
    hint.textContent = workOnly ? 'Đang xem việc chờ: phiếu đã gửi còn chờ NCC phản hồi hoặc còn hàng chưa nhận. Phiếu nháp, bị từ chối, đã xoá và đã nhận đủ không tính.' : '';
    tools.setActive(activeFilters());
    const id = ++request; prev.disabled = next.disabled = true; summary.textContent = 'Đang tải…'; body.replaceChildren();
    try {
      const d = await api('/purchase-receiving-calendar?' + new URLSearchParams({ from: from.value, to: to.value, supplierId: supplier.value, state, type: type.value, sku: sku.value, q: tools.search.value, offset: String(offset), workOnly: workOnly ? '1' : '' }));
      if (id !== request) return;
      if (offset && !d.rows.length) { offset = 0; return load(); }
      const keep = supplier.value; supplier.replaceChildren(Object.assign(el('option', '', 'Tất cả NCC'), { value: '' }));
      for (const s of d.suppliers) supplier.append(Object.assign(el('option', '', s.name), { value: s.id }));
      supplier.value = keep;
      const c = d.counts || { all: d.total, late: d.overdue, undated: d.undated };
      kpis.update({ late: c.late, scheduled: c.scheduled, undated: c.undated, all: c.all }, state || 'all');
      summary.textContent = `${buyNum(d.orderCount)} chứng từ · ${buyNum(d.total)} lượt hẹn${c.today ? ` · hôm nay ${buyNum(c.today)}` : ''}`;
      for (const r of d.rows) {
        const tr = el('tr'), late = r.date && r.date < d.today, date = el('td');
        date.append(el('div', late ? 'buy-late' : '', r.date ? buyDate(r.date) : 'Chưa hẹn ngày'));
        if (r.date) date.append(el('small', 'muted' + (late ? ' buy-late' : ''), buyDueText(r.date, d.today)));
        const doc = el('td'), link = el('a', 'data-link buy-doc', r.ticketNumber);
        link.href = r.type === 'early' ? '#/early-requests/' + encodeURIComponent(r.requestId) : '#/purchases/' + encodeURIComponent(r.orderId);
        doc.append(link, el('small', 'muted', `${r.type === 'early' ? 'Phiếu lấy hàng trước' : 'Đơn mua NCC'} · ${r.supplierName}`));
        if (r.createdAt) doc.append(el('small', 'muted', 'Tạo ' + new Date(r.createdAt).toLocaleDateString('vi-VN')));
        const lines = el('td'), acts = el('td');
        for (const l of r.lines) {
          const row = el('div', 'buy-line'), qty = buyNum(l.requestedQty ?? l.left);
          row.append(el('div', '', l.name || l.sku), el('small', 'muted', `${l.sku} · ${r.type === 'early' ? 'xin lấy' : 'còn chờ'} ${qty} ${l.unit || ''}`));
          if (r.type === 'early' && EARLY_STATUS[l.status]) { const s = EARLY_STATUS[l.status]; const b = el('div', 'buy-line-acts'); b.append(buyBadge(s[0], s[1])); row.append(b); }
          lines.append(row);
          const a = el('div', 'buy-line-acts');
          if (r.type === 'early') {
            if (d.canConfirmEarly && l.canConfirm) a.append(confirmButton(r, l));
            if (d.canReceiveEarly) for (const option of l.receiptOptions || []) { const receive = el('a', 'btn primary small', 'Nhận hàng · ' + option.ticketNumber); receive.href = '#/purchases/' + encodeURIComponent(option.orderId) + '?receive=1&earlyRequestId=' + encodeURIComponent(r.requestId); a.append(receive); }
          }
          if (a.children.length) acts.append(a);
        }
        if (r.type === 'purchase') { const receive = el('a', 'btn primary small', 'Nhận hàng'); receive.href = '#/purchases/' + encodeURIComponent(r.orderId) + '?receive=1'; acts.append(receive); }
        if (!acts.children.length) acts.append(el('small', 'muted', r.type === 'early' ? 'Chờ NCC phản hồi' : ''));
        tr.append(date, doc, lines, acts); body.append(tr);
      }
      if (!d.rows.length) { const tr = el('tr'), td = el('td', 'muted', state === 'late' ? 'Không có hàng quá hẹn.' : 'Không có hàng chờ nhận theo bộ lọc.'); td.colSpan = 4; tr.append(td); body.append(tr); }
      range.textContent = d.total ? `${offset + 1}–${offset + d.rows.length} / ${buyNum(d.total)}` : '0';
      prev.disabled = offset === 0; next.disabled = offset + d.limit >= d.total; foot.hidden = d.total <= d.limit;
    } catch (e) { if (id === request) summary.textContent = e.message || 'Không tải được danh sách nhận hàng.'; }
  }
  return { load };
}
