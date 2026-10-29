import { webOrderFinancialSummary } from './web-order-financials.js';
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
export function accountingTable(data, open, claim, mobile = false, quick = () => null) {
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
      const q = quick(t); if (q) actions.append(q);
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
export function accountingSourceWarnings(data) {
  if (!data || (!data.purchases?.count && !data.web?.count)) return null;
  const box = node('section', 'acct-source-diagnostics'); box.setAttribute('aria-label', 'Chứng từ cần bổ sung dữ liệu');
  const p = data.purchases, w = data.web;
  if (p?.count) {
    const card = node('details', 'acct-source-card'), summary = node('summary');
    summary.append(node('strong', '', 'NCC chưa có hạn trả'), node('span', '', `${p.count} kỳ · ${p.orderCount} đơn mua`)); card.append(summary);
    card.append(node('p', 'muted', 'Bổ sung ngày đến hạn trên đơn mua. Kỳ chưa trả đủ có hạn trong 3 ngày hoặc đã quá hạn sẽ tự sinh việc Trả NCC.'));
    const list = node('div', 'acct-source-list');
    for (const o of p.orders) { const row = node('div', 'acct-source-row'); row.append(node('span', '', `${o.docNo} · ${o.missingPeriods} kỳ chưa có hạn`)); const a = link(o); if (a) row.append(a); list.append(row); }
    card.append(list); box.append(card);
  }
  if (w?.count) {
    const card = node('details', 'acct-source-card'), summary = node('summary');
    summary.append(node('strong', '', 'Theo dõi dữ liệu GHN'), node('span', '', `${w.missingCode} chưa có mã · ${w.missingStatus} có mã, thiếu trạng thái · ${w.delivered} đã giao`)); card.append(summary);
    card.append(node('p', 'muted', 'Chỉ tự sinh yêu cầu xuất HĐ khi dữ liệu GHN báo giao thành công. Nhờ cửa hàng kiểm tra đơn trên website nếu thiếu mã hoặc trạng thái.'));
    const list = node('div', 'acct-source-list');
    const labels = { missing_code: 'Chưa có mã vận đơn', missing_status: 'Chưa nhận trạng thái GHN', delivered: 'Đã giao thành công', tracking: 'Đang theo dõi GHN' };
    for (const o of w.orders) {
      const row = node('div', 'acct-source-row'), info = node('div');
      info.append(node('strong', '', `${o.source === 'lock' ? 'Web LocknLock' : 'Web Minh Long'} · ${o.docNo}`), node('span', '', `${labels[o.issue] || 'Chưa xác định'}${o.ghnCode ? ' · ' + o.ghnCode : ''}${o.ghnStatus && o.issue !== 'delivered' ? ' · GHN: ' + o.ghnStatus : ''}`));
      // WooCommerce normally sends date_modified_gmt without an offset. Label it as source data, not a GHN poll time.
      const at = o.updatedAt && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?$/.test(o.updatedAt) ? o.updatedAt + 'Z' : o.updatedAt;
      info.append(node('small', 'muted', `Dữ liệu web cập nhật: ${stamp(at) || 'Chưa có mốc cập nhật'}`));
      row.append(info, node('span', 'pill warn', 'Không có link đơn')); list.append(row);
    }
    card.append(list, node('p', 'muted small', 'Mốc cập nhật do website gửi; không phải thời điểm kiểm tra GHN. Chưa có trang đơn web dành cho Kế toán.')); box.append(card);
  }
  return box;
}
/** Làm ngay trên dòng việc (không phải mở chứng từ tìm nút): việc nào có thao tác tương ứng thì có nút. */
const QUICK = { invoice: 'Ghi số HĐ', debt: 'Ghi thu', purchase: 'Ghi trả NCC' };
export function quickActionFor(t) {
  const s = t.sourceData;
  if (!s?.available || !s.targetId || t.viewOnly || !['todo', 'in_progress'].includes(t.status) || !QUICK[s.kind]) return null;
  return QUICK[s.kind];
}
const todayIso = () => new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
/** Hộp nhập nhỏ: các ô + nút Lưu. Lỗi (kể cả mạng) hiện trong hộp, giữ nguyên số đã nhập để gửi lại. */
function quickDialog(title, note, fields, submit) {
  const dlg = node('dialog', 'acct-quick'), form = node('form'), err = node('p', 'error'), inputs = {};
  dlg.setAttribute('aria-label', title); form.append(node('h2', '', title)); if (note) form.append(node('p', 'muted pre', note));
  for (const f of fields) {
    const label = node('label', '', f.label), input = node(f.options ? 'select' : 'input');
    if (f.options) for (const [v, t] of f.options) { const o = node('option', '', t); o.value = v; input.append(o); }
    else { input.type = f.type || 'text'; if (f.min != null) input.min = String(f.min); if (f.max != null) input.max = String(f.max); }
    input.value = f.value ?? (f.options ? f.options[0][0] : ''); input.required = !!f.required; input.name = f.name; label.append(input); form.append(label); inputs[f.name] = input;
  }
  const save = node('button', 'btn primary', 'Lưu'); save.type = 'submit';
  const cancel = node('button', 'btn secondary', 'Huỷ'); cancel.type = 'button'; cancel.addEventListener('click', () => dlg.close());
  const foot = node('div', 'acct-quick-foot'); foot.append(cancel, save); form.append(err, foot); dlg.append(form);
  form.addEventListener('submit', async e => {
    e.preventDefault(); if (save.disabled) return; err.textContent = ''; save.disabled = true;
    const values = Object.fromEntries(Object.entries(inputs).map(([k, i]) => [k, i.value]));
    try { await submit(values); dlg.close(); } catch (ex) { err.textContent = ex.message; } finally { save.disabled = false; }
  });
  dlg.addEventListener('close', () => dlg.remove());
  document.body.append(dlg); dlg.showModal(); Object.values(inputs)[0]?.focus();
  return dlg;
}
const METHODS = [['transfer', 'Chuyển khoản'], ['cash', 'Tiền mặt'], ['other', 'Khác']];
/** Kiểm tra trước khi xuất hoá đơn (gợi ý, không chặn): MST, đơn đã giao xong chưa, khách muốn xem bản nháp. */
export function invoiceChecks(s) {
  const out = [], mst = String(s.taxCode || '').replace(/\s/g, '');
  if (!mst) out.push('Chưa có MST – hoá đơn cho công ty cần mã số thuế.');
  else if (!/^(\d{10}(-\d{3})?|\d{12})$/.test(mst)) out.push(`MST "${s.taxCode}" không đúng dạng (10 số, 10-3 số chi nhánh, hoặc 12 số CCCD).`);
  if (s.orderStatus && s.orderStatus !== 'delivered') out.push('Đơn chưa giao xong – kiểm tra hàng đã giao đủ trước khi phát hành.');
  if (s.invoiceMode === 'draft') out.push('Khách muốn xem bản nháp trước khi phát hành chính thức.');
  return out;
}
const STATUS_LABEL = { duplicatePayments: 'Thu trùng', staleInvoices: 'Yêu cầu xuất HĐ chờ lâu', cashWithoutPhoto: 'Phiếu chi lớn chưa có ảnh' };
/** Khung "Cần kiểm tra" (chỉ đọc, gợi ý): ẩn khi không có gì. */
export function accountingChecksBox(d) {
  if (!d) return null;
  const groups = [
    ['duplicatePayments', (d.duplicatePayments || []).map(r => [`${r.docNo} · ${r.customerName}`, `${r.count} phiếu thu cùng ${money(r.amount)} ngày ${date(r.paidAt)} – kiểm tra có ghi trùng không`, r.link])],
    ['staleInvoices', (d.staleInvoices || []).map(r => [`${r.docNo} · ${r.customerName}`, `Yêu cầu xuất HĐ đã ${r.days} ngày, chưa nhập số hoá đơn`, r.link])],
    ['cashWithoutPhoto', (d.cashWithoutPhoto || []).map(r => [`${r.entryNo} · ${money(r.amount)}`, `${r.reason} – chưa có ảnh hoá đơn`, '#/cash'])],
  ].filter(([, rows]) => rows.length);
  if (!groups.length) return null;
  const box = node('section', 'acct-source-diagnostics acct-checks'); box.setAttribute('aria-label', 'Cần kiểm tra');
  for (const [key, rows] of groups) {
    const card = node('details', 'acct-source-card'), summary = node('summary');
    summary.append(node('strong', '', 'Cần kiểm tra · ' + STATUS_LABEL[key]), node('span', '', rows.length + ' mục')); card.append(summary);
    const list = node('div', 'acct-source-list');
    for (const [title, note, href] of rows) {
      const row = node('div', 'acct-source-row'), info = node('div'); info.append(node('strong', '', title), node('small', 'muted', note)); row.append(info);
      if (href && /^#\/(orders|contracts)\/[\w-]+$|^#\/cash$/.test(href)) { const a = node('a', 'btn secondary small', 'Mở'); a.href = href; row.append(a); }
      list.append(row);
    }
    card.append(list); box.append(card);
  }
  return box;
}

export function initAccountingTasks({ root, api, toast, userId, back, sendOnce = (_scope, _content, send) => send(crypto.randomUUID()) }) {
  const box = node('section', 'accounting-tasks'), saved = new Map(), st = { view: 'team', kind: '', q: '', limit: 0 }, title = node('div', 'acct-head');
  let sequence = 0, searchTimer, drawer = null, detailId = null, returnFocus = null;
  const heading = node('div'); heading.append(node('h1', '', 'Việc kế toán'), node('p', 'muted', 'Việc của bạn, việc nhóm và việc đồng nghiệp (chỉ xem). Bấm nút trên dòng để làm ngay: ghi số HĐ, ghi thu, ghi trả NCC.'));
  const search = node('input'); search.type = 'search'; search.placeholder = 'Tìm mã đơn, NCC, khách…'; search.setAttribute('aria-label', 'Tìm công việc kế toán');
  search.addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { st.q = search.value; st.limit = 0; load(); }, 200); });
  title.append(heading, search, button('Công việc khác / Thêm việc', 'btn secondary', back)); box.append(title);
  const content = node('div'); box.append(content); box.hidden = true; root.append(box);
  function show() { for (const child of root.children) if (child !== box) { if (!saved.has(child)) saved.set(child, child.hidden); child.hidden = true; } box.hidden = false; }
  function hide() { closeDetail(); clearTimeout(searchTimer); box.hidden = true; for (const [child, hidden] of saved) child.hidden = hidden; saved.clear(); }
  async function claim(t) { try { await api('/tasks/' + encodeURIComponent(t.id), 'PUT', { revision: t.revision, assigneeId: userId(), status: 'in_progress' }); toast('Đã nhận việc.'); await load(); if (detailId) await openDetail({ id: detailId }); } catch (e) { toast(e.message, 'err'); await load(); } }
  /** Mở hộp làm ngay cho việc t; xong thì tải lại (việc tự hoàn thành theo chứng từ). */
  function quickAct(t) {
    const s = t.sourceData, id = encodeURIComponent(s.targetId), done = async msg => { toast(msg); await load(); if (detailId) closeDetail(); };
    if (s.kind === 'invoice') return quickDialog(`Ghi số hoá đơn · ${s.docNo}`, [`${s.taxCode ? 'MST ' + s.taxCode : 'Chưa có MST'} · giá trị ${money(s.total)}`, ...invoiceChecks(s).map(w => '⚠ ' + w)].join('\n'),
      [{ name: 'invoiceNo', label: 'Số hoá đơn', required: true }, { name: 'invoiceDate', label: 'Ngày hoá đơn', type: 'date', value: todayIso(), max: todayIso(), required: true }],
      async v => { await api(`/orders/${id}/invoice`, 'PUT', { invoiceNo: v.invoiceNo.trim(), invoiceDate: v.invoiceDate }); await done('Đã ghi số hoá đơn.'); });
    if (s.kind === 'debt') return quickDialog(`Ghi thu · ${s.docNo}`, `Quá hạn ${money(s.overdue)} · còn phải thu ${money(s.balance)}`,
      [{ name: 'amount', label: 'Số tiền', type: 'number', min: 1, max: s.balance, value: s.overdue || s.balance, required: true }, { name: 'paidAt', label: 'Ngày thu', type: 'date', value: todayIso(), max: todayIso(), required: true },
       { name: 'method', label: 'Hình thức', options: METHODS }, { name: 'reference', label: 'Số chứng từ / nội dung CK' }],
      async v => { const content = { orderId: s.targetId, amount: Number(v.amount), paidAt: v.paidAt, method: v.method, reference: v.reference };
        await sendOnce('payment', content, key => api('/payments', 'POST', { key, ...content })); await done('Đã ghi nhận thanh toán.'); });
    if (s.kind === 'purchase') return quickDialog(`Ghi trả NCC · ${s.docNo}`, `Kỳ hạn ${date(s.dueDate)}: ${money(s.periodAmount)} · còn nợ ${money(s.balance)}. Cần đính kèm chứng từ: mở đơn mua.`,
      [{ name: 'amount', label: 'Số tiền', type: 'number', min: 1, max: s.balance, value: s.periodAmount || s.balance, required: true }, { name: 'paidDate', label: 'Ngày trả', type: 'date', value: todayIso(), max: todayIso(), required: true },
       { name: 'method', label: 'Hình thức', options: METHODS }, { name: 'reference', label: 'Số UNC / phiếu chi' }],
      async v => { const content = { id: s.targetId, amount: Number(v.amount), paidDate: v.paidDate, method: v.method, reference: v.reference, note: '', file: null };
        await sendOnce('supplier-payment', content, clientKey => api(`/purchase-orders/${id}/payments`, 'POST', { clientKey, amount: content.amount, paidDate: content.paidDate, method: content.method, reference: content.reference, note: '' }));
        await done('Đã ghi khoản trả NCC.'); });
    return null;
  }
  const quick = t => { const label = quickActionFor(t); return label ? button(label, 'btn primary small', () => quickAct(t)) : null; };
  function render(data) {
    content.replaceChildren();
    const warning = accountingWarning(data.warnings); if (warning) content.append(warning);
    const sourceWarnings = accountingSourceWarnings(data.sourceWarnings); if (sourceWarnings) content.append(sourceWarnings);
    const checks = accountingChecksBox(data.checks); if (checks) content.append(checks);
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
    content.append(accountingTable(data, openDetail, claim, false, quick), accountingTable(data, openDetail, claim, true, quick));
    if (!data.tasks.length) content.append(node('p', 'empty', 'Không có công việc phù hợp với bộ lọc.'));
    if (data.nextOffset != null) content.append(button('Xem thêm công việc', 'btn secondary', () => { st.limit += 100; load(); }));
  }
  async function load(focusId) {
    const request = ++sequence; show();
    try {
      const params = new URLSearchParams({ view: st.view, kind: st.kind, q: st.q });
      // "Cần kiểm tra" tải song song, lỗi thì bỏ qua (không chặn hàng đợi việc).
      const [first, checks] = await Promise.all([api('/tasks/accounting?' + params), api('/tasks/accounting/checks').catch(() => null)]); let data = { ...first, checks };
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
      const q = quick(t); if (q) actions.append(q);
      if(s?.kind==='web'&&s.available)body.append(webOrderFinancialSummary(s.webFinancials,s.currency));
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
