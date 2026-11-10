/**
 * BÁO CÁO TUẦN Sale / Sale Admin – trang #/weekly-reports[?month=].
 *  - Sale / Sale Admin: 4 báo cáo bắt buộc / tháng (hạn 10h thứ Hai tuần sau), lưu nháp / nộp chính thức; điểm → Tiền trách nhiệm.
 *  - Manager: bảng mọi người × tuần, mở báo cáo để duyệt Đạt / Chưa đạt / Miễn. Mọi quyền kiểm tra lại ở máy chủ.
 */
const STATE = { on_time: ['Đúng hạn', 'ok'], late: ['Nộp trễ', 'warn'], missing: ['Chưa nộp – quá hạn', 'danger'], not_due: ['Chưa tới hạn', 'muted'], exempt: ['Miễn – trước ngày triển khai', 'info'] };
const REVIEW_TONE = { pending: 'muted', ok: 'ok', rejected: 'danger', excused: 'info' };
const dm = d => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
const addDays = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 86400_000).toISOString().slice(0, 10);
const vnNow = () => new Date(Date.now() + 7 * 3600_000).toISOString();
export const weekLabel = p => `${dm(p)}–${dm(addDays(p, 6))}`;
export const periodLabel = p => p.length === 7 ? `tháng ${p.slice(5)}/${p.slice(0, 4)}` : `tuần ${weekLabel(p)}`;
const pctText = x => x === null || x === undefined ? '—' : (Math.round(x * 1000) / 10).toLocaleString('vi-VN') + '%';
export const scoreText = s => s === null || s === undefined ? '—' : String(s).replace('.', ',');
export const canSeeStaffReports = member => member?.role === 'manager' || member?.role === 'employee' && ['sale', 'sale-admin'].includes(member.positionId);

export function initWeeklyReports({ api, root, toast, esc, go, money, user, monthlyOnly = false }) {
  let current = { month: '' }, me = null, reminded = false;
  const reportPath = monthlyOnly ? 'monthly-reports' : 'weekly-reports';
  const bindMonth = () => { root.querySelector('#wr-month').onchange = e => { if (e.target.value) go(`#/${reportPath}?month=${e.target.value}`); }; };
  const unavailable = () => { root.innerHTML = `<div class="page-head"><h1>Báo cáo tháng</h1><input type="month" id="wr-month" value="${esc(current.month)}" aria-label="Tháng"></div><div class="empty"><p>Báo cáo tháng áp dụng từ tháng 11/2026. Chọn tháng 11/2026 trở đi để xem và lập báo cáo.</p></div>`; bindMonth(); };
  const pill = (tone, text) => `<span class="pill ${tone}">${esc(text)}</span>`;
  const when = v => new Date(v).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', timeZone: 'Asia/Ho_Chi_Minh' });
  const submissionRule = 'Đúng hạn / trễ tính theo lần nộp chính thức đầu tiên (giờ Việt Nam). Chờ duyệt vẫn ghi nhận điểm theo lúc nộp; Chưa đạt mới trừ điểm. Lưu nháp chưa tính là đã nộp.';
  const vnd = v => v === null || v === undefined ? '—' : money(v);

  /** Sau đăng nhập: hiện mục menu; nhắc tuần trước chưa nộp (một lần mỗi phiên). */
  async function start() {
    const member = user?.();
    const navigation = visible => document.querySelectorAll('[data-nav="weekly-reports"], [data-nav="monthly-reports"]').forEach(a => { a.hidden = !visible; });
    // This menu must not depend on a background request succeeding during login.
    // API permissions remain authoritative when opening/saving any report.
    if (user) { navigation(canSeeStaffReports(member)); if (!canSeeStaffReports(member)) return; }
    try { me = await api('/staff-reports/me'); } catch { return; }
    if (user && user()?.id !== member?.id) return;
    navigation(me.required || me.canReview);
    if (me.required && me.remind && !reminded) { reminded = true; toast(`Chưa nộp báo cáo tuần ${weekLabel(me.remind.period)} – hạn ${when(me.remind.deadline)}.`, 'warn'); }
  }
  async function show(query = '') {
    const q = new URLSearchParams(query);
    current.month = q.get('month') || current.month || vnNow().slice(0, 7);
    root.innerHTML = '<p class="muted">Đang tải…</p>';
    try { me = await api(`/staff-reports/me?month=${current.month}`); } catch (e) { root.innerHTML = `<div class="empty"><p>${esc(e.message)}</p></div>`; return; }
    if (me.canReview) return showReview();
    if (!me.required) { root.innerHTML = '<div class="empty"><h3>Báo cáo tuần</h3><p class="muted">Chức vụ của bạn không phải nộp báo cáo tuần.</p></div>'; return; }
    if (monthlyOnly && !me.monthly) return unavailable();
    const points = monthlyOnly ? me.monthly.score : me.points, maxPoints = monthlyOnly ? 1 : me.maxPoints;
    const pct = Math.min(100, (points ?? 0) / maxPoints * 100);
    root.innerHTML = `<div class="page-head"><div><h1>${monthlyOnly ? 'Báo cáo tháng' : me.monthly ? 'Báo cáo tuần / tháng' : 'Báo cáo tuần'}</h1><p class="muted">${monthlyOnly ? 'Hạn nộp <b>10h00 ngày 02</b> tháng sau. Trong tháng được lưu nháp; nộp chính thức từ ngày 01 tháng sau.' : `${me.monthly ? '4 báo cáo tuần + 1 báo cáo tháng' : me.maxPoints + ' báo cáo tuần'} bắt buộc · tuần hạn <b>10h00 thứ Hai</b> tuần sau${me.monthly ? ' · tháng hạn <b>10h00 ngày 02</b> tháng sau' : ''}`}</p></div>
        <div class="head-actions"><input type="month" id="wr-month" value="${esc(current.month)}" aria-label="Tháng"></div></div>
      <p class="muted small">${submissionRule}</p><div class="card wr-sum"><div class="wr-row"><b>Điểm ${monthlyOnly ? 'báo cáo tháng' : 'tháng'} ${esc(current.month.slice(5))}/${esc(current.month.slice(0, 4))}</b><b class="num">${scoreText(points)} / ${maxPoints}</b></div>
        <div class="wr-bar"><i style="width:${pct}%"></i></div>
        <p class="muted small">${monthlyOnly ? 'Báo cáo tháng đóng góp tối đa 1 điểm, cộng với 4 báo cáo tuần để tính Tiền trách nhiệm. Đúng hạn 1 · trễ dưới 1 ngày 0,5 · trễ từ 1 ngày / không nộp / Chưa đạt 0 · Miễn 1.' : me.applies ? `Tiền trách nhiệm = mức trách nhiệm × ngày công ÷ công chuẩn × điểm ÷ ${me.maxPoints}. ` + 'Đúng hạn 1 điểm · trễ dưới 1 ngày 0,5 · trễ từ 1 ngày / không nộp / Chưa đạt 0 · Miễn 1. Tháng 5 tuần lấy 4 tuần cao nhất.' + (me.monthly ? ' Báo cáo tháng tính thêm 1 điểm.' : '') : 'Tháng này chưa áp dụng vào Tiền trách nhiệm (áp dụng từ 11/2026) – vẫn nên nộp để làm quen.'}</p></div>
      <div class="card"><div class="wr-weeks">${(monthlyOnly ? [] : me.weeks).map((w, i) => { const st = STATE[w.state];
        return `<button type="button" class="wr-week" data-week="${esc(w.period)}"><span class="wr-n">${i + 1}</span><span class="wr-grow"><b>Tuần ${esc(weekLabel(w.period))}</b>
          <small>${w.submittedAt ? 'Nộp ' + esc(when(w.submittedAt)) : 'Hạn ' + esc(when(w.deadline))}${w.draftAt && !w.submittedAt ? ' · có nháp' : ''}</small></span>
          <span class="wr-tags">${pill(st[1], st[0])}${w.review ? pill(REVIEW_TONE[w.review], me.reviewLabels[w.review]) : ''}${w.score !== null ? pill('info', scoreText(w.score) + ' điểm') : ''}</span></button>`; }).join('')}
        ${me.monthly ? (w => `<button type="button" class="wr-week wr-month" data-week="${esc(w.period)}"><span class="wr-n">T</span><span class="wr-grow"><b>Báo cáo ${esc(periodLabel(w.period))}</b>
          <small>${w.submittedAt ? 'Nộp ' + esc(when(w.submittedAt)) : 'Hạn ' + esc(when(w.deadline))}${w.draftAt && !w.submittedAt ? ' · có nháp' : ''}</small></span>
          <span class="wr-tags">${pill(STATE[w.state][1], STATE[w.state][0])}${w.review ? pill(REVIEW_TONE[w.review], me.reviewLabels[w.review]) : ''}${w.score !== null ? pill('info', scoreText(w.score) + ' điểm') : ''}</span></button>`)(me.monthly) : ''}</div></div>`;
    bindMonth();
    root.querySelectorAll('[data-week]').forEach(b => b.onclick = () => openWeek(b.dataset.week));
  }
  async function showReview() {
    let d; try { d = await api(`/staff-reports/review?month=${current.month}`); } catch (e) { root.innerHTML = `<div class="empty"><p>${esc(e.message)}</p></div>`; return; }
    if (monthlyOnly && !d.hasMonthly) return unavailable();
    const weeks = monthlyOnly ? [] : d.weeks;
    root.innerHTML = `<div class="page-head"><div><h1>${monthlyOnly ? 'Báo cáo tháng' : 'Báo cáo tuần / tháng'} – Sale / Sale Admin</h1><p class="muted">Duyệt Đạt / Chưa đạt / Miễn · điểm dùng tính Tiền trách nhiệm${d.applies ? '' : ' (tháng này chưa áp dụng)'}</p></div>
        <div class="head-actions"><input type="month" id="wr-month" value="${esc(current.month)}" aria-label="Tháng"></div></div>
      <p class="muted small">${submissionRule}</p><div class="card"><div class="table-wrap"><table class="data-table wr-table"><thead><tr><th>Nhân viên</th>${weeks.map(w => `<th>${esc(weekLabel(w))}</th>`).join('')}${d.hasMonthly ? '<th>Báo cáo tháng</th>' : ''}<th class="right">Điểm${monthlyOnly ? ' tháng' : ''}</th></tr></thead>
      <tbody>${d.people.map(p => `<tr><td>${esc(p.name)}${p.positionId === 'sale-admin' ? ' <small class="muted">Sale Admin</small>' : ''}</td>${(monthlyOnly ? [] : p.weeks).map(w => `<td>${w.reportId
        ? `<button type="button" class="btn ghost small" data-open="${esc(p.id)}|${esc(w.period)}">${pill(STATE[w.state][1], STATE[w.state][0])}${pill(REVIEW_TONE[w.review], d.reviewLabels[w.review])}${w.submittedAt ? `<small>Nộp lần đầu: ${esc(when(w.submittedAt))}</small>` : ''}</button>`
        : pill(STATE[w.state][1], STATE[w.state][0])}</td>`).join('')}${p.monthly ? `<td>${p.monthly.reportId
        ? `<button type="button" class="btn ghost small" data-open="${esc(p.id)}|${esc(p.monthly.period)}">${pill(STATE[p.monthly.state][1], STATE[p.monthly.state][0])}${pill(REVIEW_TONE[p.monthly.review], d.reviewLabels[p.monthly.review])}${p.monthly.submittedAt ? `<small>Nộp lần đầu: ${esc(when(p.monthly.submittedAt))}</small>` : ''}</button>`
        : pill(STATE[p.monthly.state][1], STATE[p.monthly.state][0])}</td>` : ''}<td class="right num"><b>${scoreText(monthlyOnly ? p.monthly?.score : p.points)}</b>/${monthlyOnly ? 1 : p.required}</td></tr>`).join('') || '<tr><td colspan="9" class="muted">Chưa có Sale / Sale Admin.</td></tr>'}</tbody></table></div></div>`;
    bindMonth();
    root.querySelectorAll('[data-open]').forEach(b => b.onclick = () => { const [id, period] = b.dataset.open.split('|'); openWeek(period, id); });
    root.querySelectorAll('table.data-table').forEach(t => { const heads = [...t.querySelectorAll('thead th')].map(th => th.textContent);
      t.querySelectorAll('tbody tr').forEach(tr => [...tr.children].forEach((td, i) => { if (heads[i]) td.dataset.label = heads[i]; })); });
  }
  async function openWeek(period, memberId = '') {
    let d; try { d = await api(`/staff-reports/week?period=${period}${memberId ? '&memberId=' + encodeURIComponent(memberId) : ''}`); } catch (e) { toast(e.message, 'err'); return; }
    const rep = d.report, f = d.canEdit || !rep ? d.facts : rep.data.facts, v = d.draft?.inputs || rep?.data?.inputs || {}, ro = !d.canEdit, clientKey = crypto.randomUUID();
    const ta = (name, label, hint, req) => `<label class="span-2">${esc(label)}${req ? ' *' : ''}<textarea name="${name}" rows="3" ${ro ? 'readonly' : ''} placeholder="${esc(hint)}">${esc(v[name] || '')}</textarea></label>`;
    const mo = f.month || {}, notes = v.quoteNotes || {}, quotes = f.quotes || [], open = quotes.filter(q => !q.won);
    const tag = (cls, t) => `<span class="wr-src ${cls}">${esc(t)}</span>`, H = (n, t, ...tags) => `<h3 class="wr-h">${n ? n + '. ' : ''}${esc(t)} ${tags.join(' ')}</h3>`;
    const table = (heads, rows, empty) => `<div class="table-wrap"><table class="data-table wr-mini"><thead><tr>${heads.map(h => `<th${h.startsWith('>') ? ' class="right"' : ''}>${esc(h.replace(/^>/, ''))}</th>`).join('')}</tr></thead>
      <tbody>${rows.join('') || `<tr><td colspan="${heads.length}" class="muted">${esc(empty)}</td></tr>`}</tbody></table></div>`;
    const R = (cells, heads) => `<tr>${cells.map((c, i) => `<td data-label="${esc(heads[i].replace(/^>/, ''))}"${heads[i].startsWith('>') ? ' class="right num"' : ''}>${c}</td>`).join('')}</tr>`;
    const hO = ['Khách hàng', 'Sản phẩm chính', '>Doanh số'], hQ = ['Khách hàng', 'Báo giá', '>Giá trị', 'Tình trạng / bước tiếp'], hC = ['Nhóm khách', '>KH cũ chăm sóc tái ký', '>KH mới mở rộng', '>Giao dịch'],
      hD = ['Ngày', 'Khách / đơn'], hR = ['Khách / đơn', '>Còn nợ'];
    const dt = x => x ? `${x.slice(8, 10)}/${x.slice(5, 7)}` : '';
    const delta = (a, b) => b > 0 ? `<small class="${a >= b ? 'wr-up' : 'wr-down'}">${a >= b ? '▲' : '▼'} ${pctText(Math.abs(a / b - 1))}</small>` : '';
    const KPI_LABEL = { newCustomers: 'Khách hàng mới', transactions: 'Giao dịch chăm sóc', contracts: 'HĐKT ký', revenue: 'Doanh số (KPI)' };
    function monthSections() {
      const pr = f.payroll, b = pr?.bonus, k = pr?.kpi, hK = ['Chỉ số', '>Thực hiện', '>Chỉ tiêu', '>Đạt'], hI = ['Nhóm', '>Doanh số', '>%'], hT = ['Khách', '>Doanh số'];
      const num = x => x === null || x === undefined ? '—' : Math.round(x).toLocaleString('vi-VN');
      const tiers = b ? b.tiers.map((t, i) => `${i === b.tiers.length - 1 && t.from >= 1.2 ? 'trên' : 'từ'} ${pctText(t.from)}: ${pctText(t.rate)}`).join(' · ') : '';
      const mi = ta('evaluation', 'Đánh giá tháng – vì sao đạt / chưa đạt', 'Nguyên nhân chính, bài học…', true);
      return `
        ${H(1, 'Doanh số & thưởng', tag('', 'CRM tự điền · ' + (rep && !d.canEdit ? 'lúc nộp' : 'tính lúc ' + when(d.factsAt))))}
        <div class="wr-kpis"><div><small>Doanh số tháng</small><b class="num">${vnd(f.revenue)}</b>${delta(f.revenue, f.prevRevenue)}<small>so tháng trước ${vnd(f.prevRevenue)}</small></div>
          <div><small>Chỉ tiêu đăng ký</small><b class="num">${f.target ? vnd(f.target) : 'Chưa đăng ký'}</b><small>đạt ${pctText(f.ratio)}</small></div>
          <div><small>Cùng kỳ năm trước</small><b class="num">${vnd(f.lastYearRevenue)}</b>${delta(f.revenue, f.lastYearRevenue)}</div></div>
        ${b ? `<div class="wr-bonus"><div><small>Thưởng KPI DS ${b.applied ? '' : '(tạm tính)'}</small><b class="num">${vnd(b.amount)}</b></div>
          <div><small>KPI CV → tỉ lệ thưởng</small><b>${pctText(k?.used)} → ${pctText(b.rate)}</b></div><div><small>Căn cứ ${esc(b.basisLabel)}</small><b class="num">${vnd(b.basis)}</b></div></div>
          <p class="muted small">Bậc thưởng: ${esc(tiers)}. Số dự kiến theo bảng lương hiện tại; tiền thật theo phiếu lương khi chốt.</p>` : '<p class="muted small">Không thuộc bảng lương Sale – không có thưởng KPI DS.</p>'}
        ${H(2, 'KPI hoạt động', tag('', 'CRM'))}
        ${table(hK, [...(k ? k.rows.map(r => R([esc(KPI_LABEL[r.key]), r.key === 'revenue' ? vnd(r.actual) : num(r.actual), r.key === 'revenue' ? vnd(r.target) : num(r.target),
          r.actual === null || !r.target ? '—' : pill(r.actual >= r.target ? 'ok' : 'danger', pctText(r.actual / r.target))], hK)) : []),
          R(['Tỉ lệ chốt báo giá', `${f.quotesWon}/${f.quotesSent}`, '—', f.quotesSent ? pctText(f.quotesWon / f.quotesSent) : '—'], hK)], 'Chưa có KPI.')}
        <div class="wr-two"><div>${H(3, 'Cơ cấu doanh số', tag('', 'CRM'))}
          ${table(hI, f.industries.map(x => R([esc(x.label), vnd(x.revenue), f.revenue ? pctText(x.revenue / f.revenue) : '—'], hI)), 'Chưa có doanh số.')}
          ${f.oldShare !== null ? `<p class="muted small">KH cũ tái ký ${pctText(f.oldShare)} · KH mới ${pctText(1 - f.oldShare)}</p>` : ''}</div>
          <div>${H('', 'Top 5 khách hàng', tag('', 'CRM'))}${table(hT, f.topCustomers.map(x => R([esc(x.name), vnd(x.total)], hT)), 'Chưa có doanh số.')}</div></div>
        <div class="wr-two"><div>${H(4, 'Cơ hội chuyển sang tháng sau', tag('', 'CRM'))}
          <p class="small">${f.openQuotes.count} báo giá đang mở (3 tháng gần nhất) · <b>${vnd(f.openQuotes.total)}</b>${f.openQuotes.largest ? ` · lớn nhất: ${esc(f.openQuotes.largest)}` : ''}</p></div>
          <div>${H(5, 'Công nợ cuối tháng', tag('', 'CRM'))}
          <p class="small">Thu được trong tháng <b>${vnd(f.collected)}</b> · còn phải thu <b>${vnd(f.receivableTotals.balance)}</b>${f.receivableTotals.overdue ? ` · <span class="warn-text">quá hạn ${vnd(f.receivableTotals.overdue)}</span>` : ''}</p></div></div>
        ${H(6, 'Đánh giá & kế hoạch tháng sau', tag('input', 'tự nhập'))}
        <div class="form-grid cols-2">${mi}
          <label>Chỉ tiêu đăng ký tháng sau (ghi chú) *<input name="nextTarget" inputmode="numeric" ${ro ? 'readonly' : ''} placeholder="VD 450.000.000" value="${esc(v.nextTarget ? Number(v.nextTarget).toLocaleString('vi-VN') : '')}"></label>
          <label>Khách trọng điểm tháng sau (3–5 khách) *<input name="keyCustomers" maxlength="2000" ${ro ? 'readonly' : ''} value="${esc(v.keyCustomers || '')}"></label>
          ${ta('plan', 'Kế hoạch / chương trình tháng sau', 'Chương trình, khối khách hàng tập trung…', true)}${ta('support', 'Đề xuất / cần hỗ trợ (không bắt buộc)', '', false)}</div>
        <p class="muted small">Chỉ tiêu ở đây chỉ để ghi chú – đăng ký chỉ tiêu chính thức vẫn ở trang Chỉ tiêu.</p>`;
    }
    let sections = `
        ${H(1, 'Kết quả tuần', tag('', 'CRM tự điền · ' + (rep && !d.canEdit ? 'lúc nộp' : 'tính lúc ' + when(d.factsAt))))}
        <div class="wr-kpis"><div><small>Doanh số tuần</small><b class="num">${vnd(f.revenue)}</b></div><div><small>KH mới</small><b class="num">${f.newCustomers}</b></div><div><small>Giao dịch</small><b class="num">${f.transactions}</b></div>
          <div><small>Báo giá gửi</small><b class="num">${f.quotesSent}</b></div><div><small>Báo giá chốt</small><b class="num">${f.quotesWon}</b></div><div><small>HĐKT ký</small><b class="num">${f.contracts}</b></div></div>
        <p class="muted small">Luỹ kế tháng ${esc(mo.month?.slice(5) || '')}: ${vnd(mo.revenue)}${mo.target ? ` / ${vnd(mo.target)} chỉ tiêu (${(Math.round(mo.ratio * 1000) / 10).toLocaleString('vi-VN')}%)` : ' · chưa có chỉ tiêu đăng ký'}</p>
        ${table(hO, (f.orderList || []).map(o => R([`${esc(o.customerName)} <small class="muted">${esc(o.orderNo)}</small>`, esc(o.items), vnd(o.total)], hO)), 'Không có đơn chốt trong tuần.')}
        ${H(2, 'Báo giá trong tuần', tag('', 'CRM'), tag('input', 'ghi tình trạng – bắt buộc với báo giá chưa chốt'))}
        ${table(hQ, quotes.map(q => R([esc(q.customer), `${esc(q.quoteNo)}<br><small class="muted">${esc(q.items)}</small>`, vnd(q.total),
          q.won ? pill('ok', 'Đã chốt') : `<input name="qn-${esc(q.id)}" maxlength="500" ${ro ? 'readonly' : ''} placeholder="Bắt buộc ghi 1 dòng" value="${esc(notes[q.id] || '')}">`], hQ)), 'Không gửi báo giá nào trong tuần.')}
        ${H(3, 'Chăm sóc trong tuần', tag('', 'CRM: sổ giao dịch'))}
        ${table(hC, (f.care || []).filter(g => g.activities).map(g => R([esc(g.label), g.oldCustomers, g.newCustomers, g.activities], hC)), 'Chưa có giao dịch tính KPI trong tuần.')}
        <p class="muted small">Nhóm ngành lấy theo "Nhóm / loại khách" trên hồ sơ khách; trống thì đoán theo tên khách.</p>
        <div class="wr-two"><div>${H(4, 'Giao hàng sắp tới', tag('', 'CRM'))}
          ${table(hD, (f.deliveries || []).map(x => R([`${dt(x.plannedDate)}${x.status === 'failed' ? ' ' + pill('danger', 'Giao lỗi') : ''}`, `${esc(x.customerName)} <small class="muted">${esc(x.orderNo)}</small>`], hD)), 'Không có lịch giao.')}</div>
          <div>${H(5, 'Công nợ', tag('', 'CRM'))}
          ${table(hR, (f.receivables || []).map(x => R([`${esc(x.customerName)} <small class="muted">${esc(x.contractNo || x.orderNo)}</small>${x.overdue > 0 ? ' ' + pill('danger', 'Quá hạn ' + vnd(x.overdue)) : x.nextDueDate ? ` <small class="muted">hạn ${dt(x.nextDueDate)}</small>` : ''}`, vnd(x.balance)], hR)), 'Không còn công nợ.')}
          ${(f.receivables || []).length ? `<p class="small">Tổng còn nợ <b>${vnd(f.receivableTotals.balance)}</b>${f.receivableTotals.overdue ? ` · <span class="warn-text">quá hạn ${vnd(f.receivableTotals.overdue)}</span>` : ''}</p>` : ''}</div></div>
        ${H(6, 'Kế hoạch tuần tới & ghi chú', tag('input', 'tự nhập'))}
        <div class="form-grid cols-2">${ta('nextWeekPlan', 'Kế hoạch tuần tới', '1–3 mục tiêu cụ thể', true)}${ta('highlights', 'Kết quả nổi bật (không bắt buộc)', 'Việc đáng chú ý trong tuần…', false)}
          ${ta('support', 'Khó khăn / đề xuất (không bắt buộc)', 'Cần Sếp hỗ trợ gì…', false)}</div>`;
    const dlg = document.createElement('dialog'); dlg.className = 'modal wr-dialog';
    if (d.kind === 'monthly') sections = monthSections();
    dlg.innerHTML = `<form novalidate><div class="modal-head"><h2>Báo cáo ${esc(periodLabel(period))}${memberId ? ' · ' + esc(d.member.name) : ''}</h2><button type="button" class="icon-btn" data-x aria-label="Đóng">×</button></div>
      <div class="modal-body">
        <p class="small">Hạn nộp <b>${esc(when(d.deadline))}</b>${rep ? ` · Nộp chính thức ${esc(when(rep.submittedAt))} ${pill(STATE[rep.state.state][1], STATE[rep.state.state][0])} ${pill(REVIEW_TONE[rep.review], d.reviewLabels[rep.review])} · ${scoreText(rep.score)} điểm` : ' · ' + pill('muted', 'Chưa nộp chính thức')}${d.draft ? ` · Nháp lưu ${esc(when(d.draft.updatedAt))}` : ''}</p>
        ${d.blockers.length && !memberId ? `<p class="warn-text small">${d.blockers.map(esc).join(' ')}</p>` : ''}
        ${rep?.reviewNote ? `<p class="small">Ghi chú duyệt: ${esc(rep.reviewNote)}</p>` : ''}
        ${sections}
        ${d.versions.length > 1 ? `<details class="small"><summary>Lịch sử nộp (${d.versions.length} lần)</summary><ol>${d.versions.map(x => `<li>Lần ${x.version} · ${esc(when(x.submittedAt))}</li>`).join('')}</ol></details>` : ''}
        ${d.canReview ? `<div class="wr-review"><h3>Duyệt</h3><div class="chips">${['ok', 'rejected', 'excused'].map(k => `<label class="chip"><input type="radio" name="review" value="${k}" ${rep.review === k ? 'checked' : ''}> ${esc(d.reviewLabels[k])}</label>`).join('')}</div>
          <label>Lý do / ghi chú (bắt buộc khi Chưa đạt hoặc Miễn)<input name="reviewNote" maxlength="1000" value="${esc(rep.reviewNote || '')}"></label><button type="button" class="btn primary small" data-review>Lưu kết quả duyệt</button></div>` : ''}
        <p class="error" data-err role="alert"></p></div>
      <div class="modal-foot"><button type="button" class="btn secondary" data-x>Đóng</button>${d.canEdit ? '<button type="button" class="btn secondary" data-draft>Lưu nháp</button>' : ''}${d.canSubmit ? `<button class="btn primary">${rep ? 'Nộp lại chính thức' : 'Nộp chính thức'}</button>` : ''}</div></form>`;
    document.body.append(dlg); dlg.showModal();
    const form = dlg.querySelector('form'), err = dlg.querySelector('[data-err]');
    dlg.addEventListener('close', () => dlg.remove()); dlg.querySelectorAll('[data-x]').forEach(b => b.onclick = () => dlg.close());
    const inputs = () => d.kind === 'monthly' ? Object.fromEntries(['evaluation', 'nextTarget', 'keyCustomers', 'plan', 'support'].map(k => [k, form.elements[k].value]))
      : ({ ...Object.fromEntries(['highlights', 'nextWeekPlan', 'support'].map(k => [k, form.elements[k].value])),
      quoteNotes: Object.fromEntries(open.map(q => [q.id, form.elements['qn-' + q.id]?.value || '']).filter(([, x]) => x.trim())) });
    const after = msg => { toast(msg); dlg.close(); show(`month=${current.month}`); };
    dlg.querySelector('[data-draft]')?.addEventListener('click', async () => { try { await api('/staff-reports/draft', 'PUT', { period, inputs: inputs() }); after('Đã lưu nháp – chưa nộp chính thức.'); } catch (e) { err.textContent = e.message; } });
    form.addEventListener('submit', async e => { e.preventDefault(); if (!d.canSubmit) return;
      try { const r = await api('/staff-reports', 'POST', { period, clientKey, inputs: inputs() }); after(r.state?.state === 'late' ? 'Đã nộp chính thức (trễ hạn).' : 'Đã nộp chính thức.'); } catch (ex) { err.textContent = ex.message; } });
    dlg.querySelector('[data-review]')?.addEventListener('click', async () => {
      const review = form.querySelector('input[name="review"]:checked')?.value; if (!review) { err.textContent = 'Chọn kết quả duyệt.'; return; }
      try { await api(`/staff-reports/${rep.id}/review`, 'POST', { review, note: form.elements.reviewNote.value }); after('Đã lưu kết quả duyệt.'); } catch (ex) { err.textContent = ex.message; }
    });
  }
  return { start, show, openWeek };
}
