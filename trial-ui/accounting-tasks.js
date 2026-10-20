// Accounting work queue. Server data is rendered only with DOM APIs / textContent.
const TYPE = { invoice: 'Xuất HĐ', purchase: 'Trả NCC', debt: 'Thu nợ', web: 'Đơn web GHN' };
const PRIORITY = { urgent: 'Khẩn', high: 'Cao', normal: 'Bình thường', low: 'Thấp' };
const STATUS = { todo: 'Cần làm', in_progress: 'Đang làm', done: 'Hoàn thành', cancelled: 'Đã huỷ' };
const money = (n, currency = 'VND') => n == null ? 'Chưa có quyền xem số tiền' : new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 }).format(n) + (currency === 'VND' ? ' đ' : ' ' + currency);
const date = d => d ? d.slice(0, 10).split('-').reverse().join('/') : 'Chưa đặt hạn';
const stamp = d => d && Number.isFinite(Date.parse(d)) ? new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', dateStyle: 'short', timeStyle: 'short' }).format(new Date(d)) : '';
const daysLate = (due, today) => due ? Math.max(0, Math.round((Date.parse(today + 'T00:00:00Z') - Date.parse(due + 'T00:00:00Z')) / 864e5)) : 0;
function node(tag, cls = '', text) { const e = document.createElement(tag); e.className = cls; if (text != null) e.textContent = text; return e; }
function button(text, cls, fn) { const b = node('button', cls, text); b.type = 'button'; b.addEventListener('click', e => { e.stopPropagation(); fn(); }); return b; }
function link(source) { if (!source?.link || !/^#\/(orders|contracts|purchases)\/[\w-]+$/.test(source.link)) return null; const a = node('a', 'btn secondary small', source.linkLabel || 'Mở chứng từ'); a.href = source.link; a.addEventListener('click', e => e.stopPropagation()); return a; }
function chips(t) { const box = node('div', 'acct-row-tags'); box.append(node('span', 'pill prio ' + t.priority, PRIORITY[t.priority] || t.priority), node('span', 'pill off', 'Tự động')); if (t.viewOnly) box.append(node('span', 'pill off', 'Đồng nghiệp · chỉ xem')); return box; }
function subline(t) {
  const s = t.sourceData;
  if (!s?.available) return 'Thông tin chứng từ bị ẩn theo quyền hoặc không còn tồn tại.';
  if (s.kind === 'purchase') return `Kỳ ${money(s.periodAmount)} hạn ${date(s.dueDate)} · còn nợ ${money(s.balance)}`;
  if (s.kind === 'debt') return `Quá hạn ${money(s.overdue)} · còn phải thu ${money(s.balance)}`;
  if (s.kind === 'web') return `GHN ${s.ghnCode || 'chưa có mã'} · đơn ${s.docNo}`;
  return `${s.invoiceMode === 'draft' ? 'Gửi bản nháp cho khách kiểm tra' : 'Phát hành chính thức'} · ${s.taxCode ? 'MST ' + s.taxCode : 'Chưa có MST'}`;
}
export function accountingKpis(data) {
  const k = data.kpis, box = node('div', 'acct-kpis');
  const rows = [ ['invoice', 'Xuất hoá đơn chờ', k.invoices.count, `${k.invoices.overdue} quá hạn`],
    ['purchase', 'Trả NCC trong 3 ngày', k.purchases.count + ' kỳ', `${money(k.purchases.amount)} · ${k.purchases.overdue} quá hạn`],
    ['debt', 'Nợ quá hạn đang theo dõi', k.debts.count + ' đơn', money(k.debts.amount) + ' quá hạn'],
    ['team', 'Việc nhóm chưa ai nhận', k.unclaimed, 'Bấm Nhận việc để làm'] ];
  for (const [kind, title, value, sub] of rows) { const card = node('article', 'acct-kpi ' + kind); card.append(node('small', '', title), node('strong', '', value), node('span', 'muted', sub)); box.append(card); }
  return box;
}
export function accountingTable(data, open, claim, mobile = false) {
  const wrap = node('div', mobile ? 'table-wrap acct-mobile' : 'table-wrap acct-desktop'), table = node('table', mobile ? 'data-table task-table' : 'data-table acct-table');
  const head = node('thead'), h = node('tr');
  for (const label of mobile ? ['', 'Công việc', 'Ưu tiên', 'Giao / nhận', 'Hạn', 'Trạng thái', ''] : ['Việc', 'Loại', 'Số tiền', 'Hạn', 'Phụ trách', 'Hành động']) h.append(node('th', label === 'Số tiền' ? 'right' : '', label));
  head.append(h); table.append(head); const body = node('tbody');
  for (const [bucket, label] of [['overdue', 'Quá hạn'], ['today', 'Hôm nay'], ['upcoming', 'Sắp tới'], ['none', 'Chưa đặt hạn']]) {
    const rows = data.tasks.filter(t => t.due === bucket); if (!rows.length) continue;
    const group = node('tr', 'task-group g-' + bucket), th = node('th', '', `${label} · ${rows.length}`); th.colSpan = mobile ? 7 : 6; group.append(th); body.append(group);
    for (const t of rows) {
      const tr = node('tr', 'task-row acct-row prio-' + t.priority); tr.tabIndex = 0; tr.dataset.task = t.id;
      tr.addEventListener('click', () => open(t)); tr.addEventListener('keydown', e => { if (e.target === tr && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); open(t); } });
      const main = node('td', 'task-main'); main.append(node('div', 'task-title', t.title), node('div', 'muted acct-subline', subline(t)), chips(t));
      const due = node('td', 'acct-due'); due.dataset.label = 'Hạn'; due.append(node('strong', '', date(t.dueDate))); const late = daysLate(t.dueDate, data.today); if (late && ['todo', 'in_progress'].includes(t.status)) due.append(node('small', 'danger-text', `Quá ${late} ngày`));
      const who = node('td', 'task-people'); who.dataset.label = 'Phụ trách'; who.append(node('b', '', t.assigneeName || 'Nhóm Kế toán'), node('small', 'muted', t.assigneeName ? STATUS[t.status] : 'Chưa ai nhận'));
      const actions = node('td', 'task-go');
      if (t.canClaim && ['todo', 'in_progress'].includes(t.status)) actions.append(button('Nhận việc', 'btn secondary small', () => claim(t)));
      const a = link(t.sourceData); if (a) actions.append(a); else { actions.append(node('span', 'pill warn', 'Không có link đơn')); if (t.sourceData?.ghnCode) actions.append(node('small', 'muted', t.sourceData.ghnCode)); }
      if (mobile) { const prio = node('td'); prio.dataset.label = 'Ưu tiên'; prio.append(node('span', 'pill prio ' + t.priority, PRIORITY[t.priority])); const state = node('td', '', STATUS[t.status]); state.dataset.label = 'Trạng thái'; const check = node('td', 'task-check', '—'); tr.append(check, main, prio, who, due, state, actions); }
      else { const amount = node('td', 'right num', money(t.sourceData?.amount, t.sourceData?.currency)); amount.dataset.label = 'Số tiền'; tr.append(main, node('td', '', TYPE[t.sourceData?.kind] || 'Công việc'), amount, due, who, actions); }
      body.append(tr);
    }
  }
  table.append(body); wrap.append(table); return wrap;
}
export function accountingWarning(warnings) {
  if (!warnings.length) return null;
  const alert = node('aside', 'acct-warning'); alert.setAttribute('role', 'status'); alert.append(node('strong', '', `${warnings.length} việc đã đóng tay nhưng chứng từ vẫn còn tồn. Không tự mở lại việc.`));
  for (const w of warnings) { const line = node('div', 'acct-warning-line'); line.append(node('span', '', `${w.source.docNo || w.title} · còn tồn ${money(w.source.kind === 'purchase' ? w.source.balance : w.source.kind === 'debt' ? w.source.overdue : w.source.amount)}`)); const a = link(w.source); if (a) line.append(a); alert.append(line); }
  return alert;
}
export function initAccountingTasks({ root, api, toast, userId, back }) {
  const box = node('section', 'accounting-tasks'), saved = new Map(), st = { view: 'team', kind: '', q: '', limit: 0 }, title = node('div', 'acct-head');
  let sequence = 0, searchTimer, drawer = null, detailId = null, returnFocus = null;
  const heading = node('div'); heading.append(node('h1', '', 'Công việc'), node('p', 'muted', 'Hàng đợi Kế toán · Việc của bạn, việc nhóm và việc đồng nghiệp chỉ xem.'));
  const search = node('input'); search.type = 'search'; search.placeholder = 'Tìm mã đơn, NCC, khách…'; search.setAttribute('aria-label', 'Tìm công việc kế toán');
  search.addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { st.q = search.value; st.limit = 0; load(); }, 200); });
  title.append(heading, search, button('Công việc khác / Thêm việc', 'btn secondary', back)); box.append(title);
  const content = node('div'); box.append(content); box.hidden = true; root.append(box);
  function show() { for (const child of root.children) if (child !== box) { if (!saved.has(child)) saved.set(child, child.hidden); child.hidden = true; } box.hidden = false; }
  function hide() { closeDetail(); clearTimeout(searchTimer); box.hidden = true; for (const [child, hidden] of saved) child.hidden = hidden; saved.clear(); }
  async function claim(t) { try { await api('/tasks/' + encodeURIComponent(t.id), 'PUT', { revision: t.revision, assigneeId: userId(), status: 'in_progress' }); toast('Đã nhận việc.'); await load(); if (detailId) await openDetail({ id: detailId }); } catch (e) { toast(e.message, 'err'); await load(); } }
  function render(data) {
    content.replaceChildren();
    const warning = accountingWarning(data.warnings); if (warning) content.append(warning);
    content.append(accountingKpis(data));
    if (data.kpis.unavailableAmounts) content.append(node('p', 'muted small', 'Một số số tiền không hiển thị do quyền xem chứng từ. Tổng tiền chỉ gồm số liệu được phép xem.'));
    const filters = node('div', 'acct-filters'), tabs = node('div', 'acct-tabs'); tabs.setAttribute('role', 'group'); tabs.setAttribute('aria-label', 'Nhóm công việc kế toán');
    for (const [key, label] of [['team', 'Nhóm Kế toán'], ['mine', 'Của tôi'], ['colleagues', 'Đồng nghiệp'], ['closed_today', 'Đã đóng hôm nay']]) {
      if (key === 'colleagues' && !data.canViewColleagues) continue;
      const b = button(`${label} · ${data.tabs[key]}`, 'chip', () => { st.view = key; st.limit = 0; load(); }); b.setAttribute('aria-pressed', String(st.view === key)); tabs.append(b);
    }
    const kinds = node('div', 'chips'); kinds.setAttribute('role', 'group'); kinds.setAttribute('aria-label', 'Loại công việc kế toán');
    for (const [key, label] of [['', 'Tất cả'], ...Object.entries(TYPE)]) { const b = button(label, 'chip', () => { st.kind = key; st.limit = 0; load(); }); b.setAttribute('aria-pressed', String(st.kind === key)); kinds.append(b); }
    filters.append(tabs, kinds); content.append(filters);
    content.append(accountingTable(data, openDetail, claim), accountingTable(data, openDetail, claim, true));
    if (!data.tasks.length) content.append(node('p', 'empty', 'Không có công việc phù hợp với bộ lọc.'));
    if (data.nextOffset != null) content.append(button('Xem thêm công việc', 'btn secondary', () => { st.limit += 100; load(); }));
  }
  async function load(focusId) {
    const request = ++sequence; show();
    try {
      const params = new URLSearchParams({ view: st.view, kind: st.kind, q: st.q });
      const first = await api('/tasks/accounting?' + params); let data = first;
      for (let offset = 100; offset <= st.limit && data.nextOffset != null; offset += 100) { const next = await api('/tasks/accounting?' + params + '&offset=' + offset); data = { ...data, tasks: [...data.tasks, ...next.tasks], nextOffset: next.nextOffset }; }
      if (request !== sequence) return;
      render(data); if (focusId) await openDetail({ id: focusId });
    } catch (e) { if (request === sequence) { content.replaceChildren(node('p', 'error', e.message)); toast(e.message, 'err'); } }
  }
  function closeDetail() { if (drawer) { drawer.close(); drawer.remove(); drawer = null; } detailId = null; returnFocus?.focus(); }
  function amountRow(box, title, value, cls = '') { const row = node('div', 'acct-money-row ' + cls); row.append(node('span', '', title), node('strong', '', value)); box.append(row); }
  async function openDetail(t) {
    const id = t.id; detailId = id;
    try {
      const data = await api('/tasks/accounting/' + encodeURIComponent(id)); if (detailId !== id || box.hidden) return;
      t = data.task; const s = t.sourceData;
      if (!drawer) { returnFocus = document.activeElement; drawer = node('dialog', 'acct-drawer'); drawer.setAttribute('aria-label', 'Chi tiết công việc kế toán'); document.body.append(drawer); drawer.addEventListener('cancel', e => { e.preventDefault(); closeDetail(); }); drawer.showModal(); }
      drawer.replaceChildren(); const head = node('header', 'acct-detail-head'); head.append(node('span', 'eyebrow', `${TYPE[s?.kind] || 'Công việc'} · Tự động`), button('×', 'icon-btn acct-close', closeDetail), node('h2', '', t.title), chips(t), node('p', 'muted', t.assigneeName || 'Nhóm Kế toán · chưa ai nhận')); drawer.append(head);
      const body = node('div', 'acct-detail-body'), amounts = node('section', 'acct-money'); amounts.append(node('h3', '', 'Số tiền chứng từ'));
      if (!s?.available) amounts.append(node('p', 'muted', 'Không có quyền xem dữ liệu nguồn hoặc chứng từ không còn tồn tại.'));
      else if (s.kind === 'purchase') {
        amountRow(amounts, 'Tổng đơn mua', money(s.total)); amountRow(amounts, `Đã trả (${s.paymentCount} phiếu chi)`, money(s.paid));
        amountRow(amounts, `Kỳ đến hạn ${date(s.dueDate)}${daysLate(s.dueDate, data.today) ? ' · quá ' + daysLate(s.dueDate, data.today) + ' ngày' : ''}`, money(s.periodAmount), 'due'); amountRow(amounts, 'Còn nợ', money(s.balance));
      } else if (s.kind === 'debt') { amountRow(amounts, 'Quá hạn', money(s.overdue)); amountRow(amounts, 'Còn phải thu', money(s.balance)); }
      else { amountRow(amounts, 'Giá trị đơn', money(s.total, s.currency)); amountRow(amounts, 'Mã số thuế', s.taxCode || 'Chưa có MST'); amountRow(amounts, 'Cách xuất', s.kind === 'web' ? 'Chưa có trạng thái xuất HĐ trên đơn web' : s.invoiceMode === 'draft' ? 'Bản nháp' : 'Chính thức'); }
      body.append(amounts, node('h3', '', 'Cần làm'), node('p', 'pre', t.description || ''), node('p', 'muted', t.completionHelp));
      const actions = node('div', 'acct-detail-actions'); if (t.canClaim && ['todo', 'in_progress'].includes(t.status)) actions.append(button('Nhận việc', 'btn primary', () => claim(t)));
      const sourceLink = link(s); if (sourceLink) actions.append(sourceLink); else { actions.append(node('span', 'pill warn', 'Không có link đơn')); if (s?.ghnCode) actions.append(node('span', 'muted', s.ghnCode)); }
      const complete = button(t.completionFromSource ? 'Hoàn thành (tự động)' : 'Hoàn thành bằng tay', 'btn secondary', async () => { try { await api('/tasks/' + encodeURIComponent(t.id), 'PUT', { revision: t.revision, status: 'done' }); toast('Đã hoàn thành việc đơn web.'); closeDetail(); await load(); } catch (e) { toast(e.message, 'err'); } });
      complete.disabled = !!t.completionFromSource || t.viewOnly || !['todo', 'in_progress'].includes(t.status); actions.append(complete); body.append(actions);
      if (t.history?.length) { body.append(node('h3', '', 'Lịch sử')); const list = node('ul', 'acct-history'); for (const h of t.history) { const time = stamp(h.at); if (time) list.append(node('li', '', `${time} · ${h.label}`)); } if (list.children.length) body.append(list); }
      if (t.canComment) {
        body.append(node('h3', '', 'Trao đổi · chỉ người nhận và Manager')); const comments = node('div', 'acct-comments'); body.append(comments);
        const input = node('textarea'); input.placeholder = 'Viết trao đổi…'; input.maxLength = 2000; input.setAttribute('aria-label', 'Trao đổi trong công việc'); body.append(input);
        body.append(button('Gửi trao đổi', 'btn secondary', async () => { try { await api('/tasks/' + encodeURIComponent(id) + '/comments', 'POST', { body: input.value }); await openDetail({ id }); } catch (e) { toast(e.message, 'err'); } }));
        try { const result = await api('/tasks/' + encodeURIComponent(id) + '/comments'); if (detailId === id) for (const c of result.comments) { const item = node('article'); item.append(node('strong', '', c.name), node('small', 'muted', stamp(c.createdAt)), node('p', 'pre', c.body)); comments.append(item); } } catch (e) { comments.append(node('p', 'muted', e.message)); }
      } else body.append(node('p', 'muted', t.viewOnly ? 'Việc đồng nghiệp: chỉ xem, không được đọc hoặc gửi trao đổi.' : 'Nhận việc để đọc và gửi trao đổi.'));
      body.append(node('p', 'acct-warning', 'Việc này do hệ thống tạo, không xoá được')); drawer.append(body);
    } catch (e) { toast(e.message, 'err'); }
  }
  return { load, hide };
}
