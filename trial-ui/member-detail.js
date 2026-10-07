// Trang chi tiết nhân viên (#/members/<id>[?month=YYYY-MM]): một lượt gọi GET /members/:id/overview?month= rồi vẽ.
// Cấu trúc: HEAD (ảnh, tên, chọn tháng) → KPI (thẻ chỉ số) → DIỄN BIẾN 6 THÁNG + HỒ SƠ + LƯƠNG THÁNG → TABS.
// Thêm một mục mới = thêm một phần tử vào TABS (key, nhãn, đếm số, hàm vẽ). Công thức lương ở src/modules/hr/domain/payroll.ts.
// Manager: sửa lương, chấm công (bấm vào ngày), thêm thưởng / khấu trừ, chốt lương. Nhân viên: chỉ xem hồ sơ của mình.
import { avAttr } from './avatars.js';

const ATT = { // khớp ATTENDANCE_STATUSES (hr/domain/payroll.ts)
  present: { label: 'Đủ công', short: '1', cls: 'att-present' }, half: { label: 'Nửa công', short: '½', cls: 'att-half' },
  paid_leave: { label: 'Nghỉ có lương', short: 'P', cls: 'att-paid' }, unpaid_leave: { label: 'Nghỉ không lương', short: 'K', cls: 'att-unpaid' },
  absent: { label: 'Vắng', short: 'V', cls: 'att-absent' },
};
const ATT_CYCLE = ['present', 'half', 'paid_leave', 'unpaid_leave', 'absent', ''];
const ADJ = { bonus: ['Thưởng', 'ok'], allowance: ['Phụ cấp thêm', 'blue'], deduction: ['Khấu trừ / phạt', 'danger'], advance: ['Tạm ứng', 'warn'] };
const SLIP = { estimate: ['Tạm tính', 'muted'], confirmed: ['Đã chốt', 'info'], paid: ['Đã trả', 'ok'] };
const ROLE = { owner: ['Phụ trách', 'blue'], shared: ['Được chia sẻ', 'ok'], order: ['Có đơn', 'muted'] };
const QUOTE_STATUS = { pending: ['Chờ duyệt', 'warn'], approved: ['Đã duyệt', 'ok'] };
const METHOD = { transfer: 'Chuyển khoản', cash: 'Tiền mặt', other: 'Khác' };
const WEEKDAYS = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];
const monthLabel = m => `Tháng ${Number(m.slice(5))}/${m.slice(0, 4)}`;
const shiftMonth = (m, d) => { const t = new Date(Date.UTC(+m.slice(0, 4), +m.slice(5) - 1 + d, 1)); return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}`; };
const digits = v => Number(String(v ?? '').replace(/[^\d]/g, '')) || 0;

/** @param deps { api, toast, esc, money, fmtDate, pill, payCell, confirmBox, initials, ORDER_STATUS, CONTRACT_STATUS, onEdit(member), onPhoto(member) } */
export function initMemberDetail(deps) {
  const { api, toast, esc, money, fmtDate, pill, payCell, confirmBox, ORDER_STATUS, CONTRACT_STATUS } = deps;
  const root = document.getElementById('member-detail');
  const st = { id: '', month: '', d: null, tab: 'customers', seq: 0 };
  const short = n => { const v = Math.abs(n); return v >= 1e9 ? (n / 1e9).toFixed(1).replace('.0', '') + ' tỷ' : v >= 1e6 ? (n / 1e6).toFixed(1).replace('.0', '') + ' tr' : money(n); };
  const orderLink = (id, text) => `<a href="#/orders/${encodeURIComponent(id)}">${esc(text)}</a>`;
  const table = (head, rows, empty) => rows.length
    ? `<div class="table-wrap"><table class="data-table"><thead><tr>${head.map(h => `<th${h.startsWith('>') ? ' class="right"' : ''}>${esc(h.replace(/^>/, ''))}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`
    : `<p class="muted cd-empty">${esc(empty)}</p>`;
  const can = () => st.d.access.canManage;
  const locked = () => st.d.payroll.locked;

  // ----- Các mục (tab)
  const TABS = [
    { key: 'customers', label: 'Khách hàng', count: d => d.customers.length, html: d => table(['Khách hàng', 'Vai trò', '>Số đơn', '>Doanh số', '>Còn nợ', 'Mua gần nhất'], d.customers.map(k => `<tr class="clickable" data-href="#/customers/${esc(encodeURIComponent(k.id))}">
        <td><a class="strong" href="#/customers/${encodeURIComponent(k.id)}">${esc(k.name)}</a>${k.phone ? `<small>${esc(k.phone)}</small>` : ''}</td>
        <td>${pill(ROLE, k.role)}${k.approvalStatus === 'pending' ? ' <span class="pill warn">Chờ duyệt</span>' : ''}</td>
        <td class="right num">${k.orders}</td><td class="right num">${money(k.revenue)}</td>
        <td class="right num ${k.balance > 0 ? 'danger-text' : 'muted'}">${k.balance > 0 ? money(k.balance) : '—'}</td><td>${fmtDate(k.lastOrderDate) || '<span class="muted">—</span>'}</td></tr>`), 'Chưa phụ trách khách hàng nào.') },
    { key: 'quotes', label: 'Báo giá', count: d => d.quotes.length, html: d => table(['Báo giá', 'Khách hàng', 'Duyệt', '>Giá trị', 'Đơn hàng'], d.quotes.map(x => `<tr class="clickable" data-href="#/quotes/${esc(x.id)}">
        <td><a href="#/quotes/${encodeURIComponent(x.id)}">${esc(x.quoteNo)}</a><small>${esc(x.quoteType)} · ${fmtDate(x.quoteDate)}</small></td><td>${esc(x.customer)}</td>
        <td>${pill(QUOTE_STATUS, x.approvalStatus)}</td><td class="right num">${money(x.total)}</td>
        <td>${x.orderId ? orderLink(x.orderId, 'Xem đơn') : '<span class="muted">Chưa đặt</span>'}</td></tr>`), 'Chưa có báo giá.') },
    { key: 'orders', label: 'Đơn hàng', count: d => d.orders.length, html: d => table(['Đơn', 'Khách hàng', 'Tình trạng', 'HĐKT', '>Giá trị', 'Thanh toán'], d.orders.map(o => `<tr class="clickable" data-href="#/orders/${esc(o.id)}">
        <td>${orderLink(o.id, o.orderNo)}<small>${fmtDate(o.orderDate)}${o.quoteNo ? ' · ' + esc(o.quoteNo) : ''}</small></td><td>${esc(o.customerName)}</td>
        <td>${pill(ORDER_STATUS, o.status)}</td><td>${o.contract ? esc(o.contract.contractNo) + `<small>${pill(CONTRACT_STATUS, o.contract.status)}</small>` : '<span class="muted">Chưa có</span>'}</td>
        <td class="right num">${money(o.total)}</td><td>${payCell(o.receivable, o.counted, o.status)}</td></tr>`), 'Chưa có đơn đặt hàng.') },
    { key: 'contracts', label: 'HĐKT', count: d => d.contracts.length, html: d => table(['Số HĐKT', 'Khách hàng', 'Tình trạng', 'Ngày ký', '>Giá trị', 'Đơn'], d.contracts.map(k => `<tr class="clickable" data-href="#/orders/${esc(k.orderId)}">
        <td>${esc(k.contractNo)}</td><td>${esc(k.customerName)}</td><td>${pill(CONTRACT_STATUS, k.status)}</td><td>${fmtDate(k.signedDate) || '—'}</td>
        <td class="right num">${money(k.value)}</td><td>${orderLink(k.orderId, k.orderNo)}</td></tr>`), 'Chưa có hợp đồng kinh tế.') },
    { key: 'payments', label: 'Giao dịch', count: d => d.payments.length, html: d => table(['Ngày thu', 'Khách hàng', 'Hình thức', 'Đơn', '>Số tiền'], d.payments.map(p => `<tr>
        <td>${fmtDate(p.paidAt)}</td><td>${esc(p.customerName)}${p.reference || p.note ? `<small>${esc(p.reference || p.note)}</small>` : ''}</td>
        <td>${esc(METHOD[p.method] || p.method)}</td><td>${orderLink(p.orderId, p.orderNo)}</td><td class="right num paid-text">${money(p.amount)}</td></tr>`), 'Chưa có phiếu thu nào.') },
    { key: 'debts', label: 'Công nợ', count: d => d.debts.length, html: d => table(['Đơn', 'Khách hàng', 'Hạn gần nhất', '>Phải thu', '>Đã thu', '>Còn lại', '>Quá hạn'], d.debts.map(o => `<tr class="clickable" data-href="#/orders/${esc(o.id)}">
        <td>${orderLink(o.id, o.orderNo)}<small>${fmtDate(o.orderDate)}</small></td><td>${esc(o.customerName)}</td><td>${fmtDate(o.nextDueDate) || '—'}</td>
        <td class="right num">${money(o.due)}</td><td class="right num paid-text">${money(o.paid)}</td><td class="right num strong">${money(o.balance)}</td>
        <td class="right num ${o.overdue ? 'danger-text' : 'muted'}">${o.overdue ? money(o.overdue) : '—'}</td></tr>`), 'Không có công nợ đang theo dõi.') },
    { key: 'attendance', label: 'Ngày công', count: d => d.payroll.attendanceSummary.worked, html: attendanceHtml },
    { key: 'payroll', label: 'Lương & thưởng', count: d => d.payroll.adjustments.length, html: payrollHtml },
  ];

  // ----- Ngày công: lịch tháng; Manager bấm vào ngày để đổi trạng thái (đủ → nửa → nghỉ có lương → nghỉ không lương → vắng → bỏ trống).
  function attendanceHtml(d) {
    const p = d.payroll, s = p.attendanceSummary, map = new Map(p.attendance.map(a => [a.date, a.status]));
    const first = new Date(Date.UTC(+d.month.slice(0, 4), +d.month.slice(5) - 1, 1)), lead = (first.getUTCDay() + 6) % 7;
    const cells = Array.from({ length: lead }, () => '<span class="att-day blank"></span>');
    for (let day = 1; day <= s.daysInMonth; day++) {
      const date = `${d.month}-${String(day).padStart(2, '0')}`, status = map.get(date) || '', a = ATT[status], dow = (lead + day - 1) % 7;
      cells.push(`<button type="button" class="att-day ${a ? a.cls : ''} ${dow === 6 ? 'sun' : ''} ${date === d.today ? 'today' : ''}" data-day="${date}" ${can() && !locked() ? '' : 'disabled'}
        title="${esc(fmtDate(date))}: ${esc(a ? a.label : 'Chưa chấm')}"><b>${day}</b><span>${a ? a.short : ''}</span></button>`);
    }
    return `<div class="att-summary">
        <div><strong>${s.worked}</strong><small>/ ${s.standardDays} công chuẩn</small></div>
        ${Object.entries(ATT).map(([k, a]) => `<span class="att-legend ${a.cls}"><i></i>${esc(a.label)} <b>${s[{ present: 'present', half: 'half', paid_leave: 'paidLeave', unpaid_leave: 'unpaidLeave', absent: 'absent' }[k]]}</b></span>`).join('')}
      </div>
      ${can() && !locked() ? '<div class="att-tools"><small class="muted">Bấm vào ngày để đổi: đủ công → nửa công → nghỉ có lương → nghỉ không lương → vắng → bỏ trống.</small><button type="button" class="btn secondary small" data-act="fill-days">Chấm đủ công T2–T7 (tới hôm nay)</button></div>' : ''}
      ${locked() ? '<p class="muted small">Lương tháng này đã chốt – mở lại phiếu lương để sửa ngày công.</p>' : ''}
      <div class="att-grid">${WEEKDAYS.map(w => `<span class="att-head">${w}</span>`).join('')}${cells.join('')}</div>`;
  }

  // ----- Lương & thưởng: phiếu lương (tạm tính / đã chốt), các khoản thưởng – trừ, mức lương áp dụng + lịch sử.
  function payrollHtml(d) {
    const p = d.payroll, s = p.payslip, pr = p.profile, edit = can() && !locked();
    const line = (label, value, cls = '', note = '') => `<tr class="${cls}"><td>${esc(label)}${note ? `<small>${esc(note)}</small>` : ''}</td><td class="right num">${value}</td></tr>`;
    return `<div class="md-pay-grid">
      <div class="md-slip">
        <div class="card-title-row"><h3>Phiếu lương ${esc(monthLabel(d.month).toLowerCase())}</h3>${pill(SLIP, s.status)}</div>
        <table class="md-slip-table"><tbody>
          ${line('Lương theo ngày công', money(s.salaryByDays), '', `${money(s.baseSalary)} × ${s.workedDays} / ${s.standardDays} công`)}
          ${line('Phụ cấp cố định', money(s.allowance))}
          ${line('Phụ cấp thêm', money(s.extraAllowance))}
          ${line('Thưởng', money(s.bonus))}
          ${line('Hoa hồng', money(s.commission), '', `${s.commissionRate}% × doanh số ${money(s.revenue)}`)}
          ${line('Tổng thu nhập', money(s.gross), 'sum')}
          ${line('Khấu trừ / phạt', '−' + money(s.deduction), 'minus')}
          ${line('Bảo hiểm (NV đóng)', '−' + money(s.insurance), 'minus')}
          ${line('Tạm ứng', '−' + money(s.advance), 'minus')}
          ${line('Thực lĩnh', money(s.net), 'net')}
        </tbody></table>
        ${s.status === 'estimate' ? '<p class="muted small">Tạm tính theo dữ liệu hiện tại; số liệu cố định khi Manager chốt lương.</p>'
          : `<p class="muted small">Chốt ${esc(fmtDate(s.confirmedAt))}${s.paidAt ? ` · Đã trả ${esc(fmtDate(s.paidAt))}` : ''}${s.note ? ' · ' + esc(s.note) : ''}</p>`}
        ${can() ? `<div class="row-actions">${s.status === 'estimate' ? '<button type="button" class="btn primary small" data-act="confirm-slip">Chốt lương tháng</button>' : ''}
          ${s.status === 'confirmed' ? '<button type="button" class="btn primary small" data-act="paid-slip">Đánh dấu đã trả</button><button type="button" class="btn ghost small" data-act="reopen-slip">Mở lại</button>' : ''}</div>` : ''}
      </div>
      <div>
        <div class="card-title-row"><h3>Thưởng, phụ cấp, khấu trừ</h3>${edit ? '<button type="button" class="btn secondary small" data-act="add-adj">＋ Thêm khoản</button>' : ''}</div>
        ${p.adjustments.length ? `<ul class="plain-list md-adj">${p.adjustments.map(a => `<li><span>${pill(ADJ, a.kind)} <b class="num">${money(a.amount)}</b>
            <small>${esc(a.reason) || '—'} · ${esc(a.createdByName)} ${esc(fmtDate(a.createdAt))}</small></span>
            ${edit ? `<button class="icon-btn" data-del-adj="${esc(a.id)}" title="Xoá" aria-label="Xoá khoản"><svg viewBox="0 0 24 24"><path d="M5 7h14 M10 11v6 M14 11v6 M6 7l1 13h10l1-13 M9 7V4h6v3"/></svg></button>` : ''}</li>`).join('')}</ul>`
          : '<p class="muted cd-empty">Chưa có khoản nào trong tháng.</p>'}
        <div class="card-title-row md-gap"><h3>Mức lương áp dụng</h3>${can() ? '<button type="button" class="btn secondary small" data-act="salary">Sửa mức lương</button>' : ''}</div>
        ${pr.effectiveMonth ? `<dl class="kv"><dt>Từ tháng</dt><dd>${esc(monthLabel(pr.effectiveMonth))}</dd><dt>Lương cơ bản</dt><dd class="num">${money(pr.baseSalary)}</dd>
          <dt>Phụ cấp cố định</dt><dd class="num">${money(pr.allowance)}</dd><dt>Ngày công chuẩn</dt><dd>${pr.standardDays}</dd>
          <dt>Chỉ tiêu doanh số</dt><dd class="num">${pr.revenueTarget ? money(pr.revenueTarget) : '—'}</dd><dt>Hoa hồng</dt><dd>${pr.commissionRate}%</dd>
          <dt>Bảo hiểm NV đóng</dt><dd class="num">${money(pr.insurance)}</dd>${pr.note ? `<dt>Ghi chú</dt><dd>${esc(pr.note)}</dd>` : ''}</dl>`
          : '<p class="muted cd-empty">Chưa đặt mức lương.</p>'}
        ${p.history.length > 1 ? `<details class="md-history"><summary>Lịch sử thay đổi (${p.history.length})</summary>${table(['Từ tháng', '>Lương CB', '>Phụ cấp', '>Chỉ tiêu', 'Hoa hồng'], p.history.map(h => `<tr>
            <td>${esc(monthLabel(h.effectiveMonth))}</td><td class="right num">${money(h.baseSalary)}</td><td class="right num">${money(h.allowance)}</td>
            <td class="right num">${money(h.revenueTarget)}</td><td>${h.commissionRate}%</td></tr>`), '')}</details>` : ''}
      </div></div>`;
  }

  // ----- Diễn biến 6 tháng: cột = doanh số, chấm = đã thu.
  function trendHtml(t) {
    const max = Math.max(1, ...t.map(x => Math.max(x.revenue, x.collected)));
    return `<div class="md-trend" role="img" aria-label="Doanh số 6 tháng gần đây">${t.map(x => `<div class="md-bar ${x.month === st.month ? 'current' : ''}" title="${esc(monthLabel(x.month))}: doanh số ${money(x.revenue)} (${x.orders} đơn), đã thu ${money(x.collected)}">
        <span class="md-bar-val">${x.revenue ? esc(short(x.revenue)) : ''}</span>
        <span class="md-bar-col"><i style="height:${(x.revenue / max * 100).toFixed(1)}%"></i><em style="bottom:${(x.collected / max * 100).toFixed(1)}%"></em></span>
        <small>T${Number(x.month.slice(5))}</small></div>`).join('')}</div>
      <div class="md-trend-legend"><span><i class="rev"></i>Doanh số</span><span><i class="col"></i>Đã thu</span></div>`;
  }

  // ----- Vẽ
  function render() {
    const d = st.d, m = d.member, k = d.kpi, a = d.access, s = d.payroll.payslip;
    const pct = k.targetPercent, bar = pct === null ? '' : `<span class="md-progress"><i style="width:${Math.min(100, pct)}%"></i></span>`;
    const tab = TABS.find(t => t.key === st.tab) || TABS[0];
    const stat = (label, value, sub, cls = '') => `<article class="stat ${cls}"><small>${label}</small><strong>${value}</strong>${sub}</article>`;
    root.innerHTML = `
      <div class="editor-head md-head">
        <div class="editor-title">${a.canManage ? '<a class="btn ghost small" href="#/staff">‹ Nhân viên</a>' : ''}
          <span class="avatar large"${avAttr(m.avatar)}>${esc(deps.initials(m.name))}</span>
          <div><h1>${esc(m.name)}</h1><span class="muted">${esc(m.position || m.positionId || '')}${m.role === 'manager' ? ' · Manager' : ''}</span>
            ${m.active ? '' : ' <span class="pill off">Đã khoá</span>'}</div></div>
        <div class="editor-actions">
          <div class="md-month"><button type="button" class="icon-btn" data-month="-1" aria-label="Tháng trước">‹</button>
            <input type="month" id="md-month" value="${esc(d.month)}" aria-label="Chọn tháng"><button type="button" class="icon-btn" data-month="1" aria-label="Tháng sau">›</button></div>
          ${a.canManage && !a.isSelf ? '<button class="btn secondary" data-act="edit">Sửa thông tin</button>' : ''}
          ${a.canManage || a.isSelf ? '<button class="btn secondary" data-act="photo">Đổi ảnh</button>' : ''}
        </div>
      </div>
      <div class="stats md-kpis">
        ${stat('Doanh số tháng', money(k.revenue), `${bar}<span class="muted">${pct === null ? 'Chưa đặt chỉ tiêu' : `${pct}% chỉ tiêu ${short(k.revenueTarget)}`}</span>`, 'md-kpi-main')}
        ${stat('Đơn hàng', k.orders, `<span class="muted">TB ${money(k.avgOrder)}/đơn</span>`)}
        ${stat('Báo giá', k.quotes, `<span class="muted">Chốt ${k.quotesWon} · ${k.conversion === null ? '—' : k.conversion + '%'}</span>`)}
        ${stat('Đã thu tháng', `<span class="paid-text">${money(k.collected)}</span>`, `<span class="muted">${k.contractsSigned} HĐKT ký trong tháng</span>`)}
        ${stat('Công nợ đang giữ', `<span class="${k.debt.balance > 0 ? 'danger-text' : ''}">${money(k.debt.balance)}</span>`, `<span class="${k.debt.overdue ? 'danger-text' : 'muted'}">${k.debt.overdue ? 'Quá hạn ' + money(k.debt.overdue) : `${k.debt.orders} đơn còn nợ`}</span>`)}
        ${stat('Khách hàng', k.customers, `<span class="muted">${k.newCustomers} khách mới trong tháng</span>`)}
        ${stat('Ngày công', `${k.workedDays}<small class="md-of">/${k.standardDays}</small>`, `<span class="muted">${monthLabel(d.month)}</span>`)}
        ${stat('Công việc', `${k.tasks.done}<small class="md-of"> xong</small>`, `<span class="${k.tasks.overdue ? 'danger-text' : 'muted'}">${k.tasks.open} đang làm${k.tasks.overdue ? ` · ${k.tasks.overdue} trễ hạn` : ''}</span>`)}
      </div>
      <div class="md-grid">
        <div class="card"><h2 class="card-title">Doanh số 6 tháng</h2>${trendHtml(d.trend)}</div>
        <div class="card"><h2 class="card-title">Thông tin</h2><dl class="kv">
          <dt>Email</dt><dd>${m.email ? `<a href="mailto:${esc(m.email)}">${esc(m.email)}</a>` : '—'}</dd>
          <dt>Điện thoại</dt><dd>${m.phone ? `<a href="tel:${esc(m.phone.replace(/[^\d+]/g, ''))}">${esc(m.phone)}</a>` : '—'}</dd>
          <dt>Chức vụ</dt><dd>${esc(m.position || m.positionId || '—')}</dd><dt>Vào làm</dt><dd>${fmtDate(m.createdAt) || '—'}</dd>
          <dt>Trạng thái</dt><dd>${m.active ? '<span class="pill ok">Đang làm việc</span>' : '<span class="pill off">Đã khoá</span>'}</dd></dl></div>
        <div class="card md-salary-card"><div class="card-title-row"><h2 class="card-title">Lương ${esc(monthLabel(d.month).toLowerCase())}</h2>${pill(SLIP, s.status)}</div>
          <strong class="md-net">${money(s.net)}</strong><span class="muted">Thực lĩnh${s.status === 'estimate' ? ' (tạm tính)' : ''}</span>
          <dl class="kv md-mini"><dt>Theo ngày công</dt><dd class="num">${money(s.salaryByDays)}</dd><dt>Thưởng + hoa hồng</dt><dd class="num">${money(s.bonus + s.commission)}</dd>
            <dt>Khấu trừ, BH, tạm ứng</dt><dd class="num">−${money(s.deduction + s.advance + s.insurance)}</dd></dl>
          <button type="button" class="btn ghost small" data-tab="payroll">Xem phiếu lương ›</button></div>
      </div>
      <div class="card cd-tabs-card">
        <div class="chips cd-tabs" role="tablist">${TABS.map(t => `<button type="button" class="chip ${t.key === tab.key ? 'active' : ''}" role="tab" aria-selected="${t.key === tab.key}" data-tab="${t.key}">${t.label} <b>${t.count(d)}</b></button>`).join('')}</div>
        <div class="cd-tab-body">${tab.html(d)}</div>
      </div>`;
    root.querySelectorAll('.cd-tab-body table.data-table').forEach(t => {
      const heads = [...t.querySelectorAll('thead th')].map(th => th.textContent);
      t.querySelectorAll('tbody tr').forEach(tr => [...tr.children].forEach((td, i) => { if (i && heads[i]) td.dataset.label = heads[i]; }));
    });
  }

  async function open(id, month) {
    const seq = ++st.seq; st.id = id; st.month = month || st.month || '';
    if (st.d?.member.id !== id) { st.d = null; st.tab = 'customers'; root.innerHTML = '<p class="muted cd-loading">Đang tải hồ sơ nhân viên…</p>'; }
    try {
      const d = await api(`/members/${encodeURIComponent(id)}/overview${st.month ? '?month=' + st.month : ''}`);
      if (seq !== st.seq) return;
      st.d = d; st.month = d.month; render();
      document.getElementById('breadcrumb').textContent = d.member.name; document.title = d.member.name + ' · Bách Ngân';
    } catch (e) { if (seq === st.seq) root.innerHTML = `<div class="empty"><h3>Không mở được hồ sơ nhân viên</h3><p class="muted">${esc(e.message)}</p></div>`; }
  }
  const reload = () => open(st.id, st.month);
  const base = () => `/hr/members/${encodeURIComponent(st.id)}`;

  // ----- Hộp thoại nhỏ dùng chung (tạo động, tự gỡ khi đóng).
  function dialog(title, body, submitLabel, onSubmit) {
    const dlg = document.createElement('dialog'); dlg.className = 'modal';
    dlg.innerHTML = `<form novalidate><div class="modal-head"><h2>${esc(title)}</h2><button type="button" class="icon-btn" data-x aria-label="Đóng">×</button></div>
      <div class="modal-body form-grid cols-2">${body}<p class="error span-2" data-err role="alert"></p></div>
      <div class="modal-foot"><button type="button" class="btn secondary" data-x>Huỷ</button><button class="btn primary">${esc(submitLabel)}</button></div></form>`;
    document.body.append(dlg); dlg.showModal();
    dlg.querySelectorAll('[data-x]').forEach(b => b.addEventListener('click', () => dlg.close()));
    dlg.addEventListener('close', () => dlg.remove());
    dlg.querySelectorAll('input[data-money]').forEach(i => i.addEventListener('input', () => { const n = digits(i.value); i.value = n ? n.toLocaleString('vi-VN') : ''; }));
    dlg.querySelector('form').addEventListener('submit', async e => {
      e.preventDefault();
      const btn = dlg.querySelector('button.primary'); btn.disabled = true;
      try { await onSubmit(e.target.elements); dlg.close(); reload(); }
      catch (ex) { dlg.querySelector('[data-err]').textContent = ex.message; }
      finally { btn.disabled = false; }
    });
  }
  const moneyInput = (name, label, v) => `<label>${esc(label)}<input name="${name}" data-money inputmode="numeric" value="${v ? Number(v).toLocaleString('vi-VN') : ''}" placeholder="0"></label>`;

  function editSalary() {
    const p = st.d.payroll.profile;
    dialog('Mức lương ' + st.d.member.name, `
      <label>Áp dụng từ tháng<input name="effectiveMonth" type="month" required value="${esc(st.month)}"></label>
      <label>Ngày công chuẩn<input name="standardDays" type="number" min="1" max="31" step="0.5" value="${p.standardDays || 26}"></label>
      ${moneyInput('baseSalary', 'Lương cơ bản', p.baseSalary)}${moneyInput('allowance', 'Phụ cấp cố định / tháng', p.allowance)}
      ${moneyInput('revenueTarget', 'Chỉ tiêu doanh số / tháng', p.revenueTarget)}
      <label>Hoa hồng (% doanh số)<input name="commissionRate" type="number" min="0" max="100" step="0.1" value="${p.commissionRate || 0}"></label>
      ${moneyInput('insurance', 'Bảo hiểm NV đóng / tháng', p.insurance)}
      <label class="span-2">Ghi chú<input name="note" maxlength="500" value="${esc(p.note || '')}"></label>
      <p class="muted small span-2">Mức lương áp dụng từ tháng đã chọn cho tới khi có mức mới. Các tháng đã chốt lương không đổi.</p>`, 'Lưu mức lương', f =>
      api(base() + '/salary', 'PUT', { effectiveMonth: f.effectiveMonth.value, standardDays: Number(f.standardDays.value), baseSalary: digits(f.baseSalary.value),
        allowance: digits(f.allowance.value), revenueTarget: digits(f.revenueTarget.value), commissionRate: Number(f.commissionRate.value), insurance: digits(f.insurance.value), note: f.note.value })
        .then(() => toast('Đã lưu mức lương.')));
  }
  function addAdjustment() {
    dialog('Thêm khoản ' + monthLabel(st.month).toLowerCase(), `
      <label>Loại<select name="kind">${Object.entries(ADJ).map(([k, [t]]) => `<option value="${k}">${esc(t)}</option>`).join('')}</select></label>
      ${moneyInput('amount', 'Số tiền', 0)}
      <label class="span-2">Lý do<input name="reason" maxlength="500" placeholder="VD: Thưởng vượt chỉ tiêu, phạt đi muộn, tạm ứng giữa tháng…"></label>`, 'Thêm', f => {
      const amount = digits(f.amount.value);
      if (!amount) return Promise.reject(new Error('Nhập số tiền.'));
      return api(base() + '/adjustments', 'POST', { month: st.month, kind: f.kind.value, amount, reason: f.reason.value }).then(() => toast('Đã thêm khoản.'));
    });
  }

  async function setDays(days) {
    try { await api(`${base()}/attendance/${st.month}`, 'PUT', { days }); await reload(); }
    catch (ex) { toast(ex.message, 'err'); }
  }

  // ----- Sự kiện
  root.addEventListener('click', async e => {
    const t = e.target;
    const tabBtn = t.closest('[data-tab]'); if (tabBtn) { st.tab = tabBtn.dataset.tab; render(); return; }
    const mBtn = t.closest('[data-month]'); if (mBtn) { go(shiftMonth(st.month, Number(mBtn.dataset.month))); return; }
    const day = t.closest('[data-day]');
    if (day && !day.disabled) {
      const cur = st.d.payroll.attendance.find(a => a.date === day.dataset.day)?.status || '';
      return setDays({ [day.dataset.day]: ATT_CYCLE[(ATT_CYCLE.indexOf(cur) + 1) % ATT_CYCLE.length] });
    }
    const del = t.closest('[data-del-adj]');
    if (del) {
      if (!await confirmBox('Xoá khoản này khỏi lương tháng?', { ok: 'Xoá', danger: true })) return;
      try { await api('/hr/adjustments/' + encodeURIComponent(del.dataset.delAdj), 'DELETE'); toast('Đã xoá.'); reload(); } catch (ex) { toast(ex.message, 'err'); }
      return;
    }
    const row = t.closest('tr[data-href]'); if (row && !t.closest('a,button')) { location.hash = row.dataset.href; return; }
    const act = t.closest('[data-act]')?.dataset.act; if (!act) return;
    const m = st.d.member, slip = `${base()}/payslips/${st.month}`;
    try {
      if (act === 'edit') deps.onEdit(m);
      else if (act === 'photo') { if (await deps.onPhoto(m)) reload(); }
      else if (act === 'salary') editSalary();
      else if (act === 'add-adj') addAdjustment();
      else if (act === 'fill-days') {
        const done = new Set(st.d.payroll.attendance.map(a => a.date)), days = {};
        for (let i = 1; i <= st.d.payroll.attendanceSummary.daysInMonth; i++) {
          const date = `${st.month}-${String(i).padStart(2, '0')}`;
          if (date > st.d.today || done.has(date) || new Date(date + 'T00:00:00Z').getUTCDay() === 0) continue;
          days[date] = 'present';
        }
        if (!Object.keys(days).length) return toast('Không còn ngày nào cần chấm.');
        await setDays(days); toast(`Đã chấm đủ công ${Object.keys(days).length} ngày.`);
      } else if (act === 'confirm-slip') {
        if (!await confirmBox(`Chốt lương ${monthLabel(st.month).toLowerCase()} cho ${m.name}: thực lĩnh ${money(st.d.payroll.payslip.net)}? Sau khi chốt, ngày công và thưởng / phạt của tháng bị khoá.`, { ok: 'Chốt lương' })) return;
        await api(slip, 'POST', {}); toast('Đã chốt lương.'); reload();
      } else if (act === 'paid-slip') { await api(slip + '/paid', 'POST', {}); toast('Đã đánh dấu đã trả lương.'); reload(); }
      else if (act === 'reopen-slip') {
        if (!await confirmBox('Mở lại phiếu lương để sửa? Số liệu sẽ tính lại theo dữ liệu hiện tại.', { ok: 'Mở lại' })) return;
        await api(slip, 'DELETE'); toast('Đã mở lại phiếu lương.'); reload();
      }
    } catch (ex) { toast(ex.message, 'err'); }
  });
  root.addEventListener('change', e => { if (e.target.id === 'md-month' && /^\d{4}-\d{2}$/.test(e.target.value)) go(e.target.value); });
  const go = month => { location.hash = `#/members/${encodeURIComponent(st.id)}?month=${month}`; };

  return { open, reload };
}
