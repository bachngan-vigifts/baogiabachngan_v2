import {openContractBonusDetails} from './contract-bonus-detail.js';
// Trang chi tiết nhân viên (#/members/<id>[?month=YYYY-MM]): một lượt gọi GET /members/:id/overview?month= rồi vẽ.
// Cấu trúc: HEAD (ảnh, tên, chọn tháng) → KPI (thẻ chỉ số) → DIỄN BIẾN 6 THÁNG + HỒ SƠ + LƯƠNG THÁNG → TABS.
// Thêm một mục mới = thêm một phần tử vào TABS (key, nhãn, đếm số, hàm vẽ). Công thức lương ở src/modules/hr/domain/payroll.ts.
// Manager: sửa lương, chấm công (bấm vào ngày), thêm thưởng / khấu trừ, chốt lương. Nhân viên: chỉ xem hồ sơ của mình.
import { avAttr } from './avatars.js';
import { printPayslip } from './payroll-ui.js';

const ATT = { // khớp ATTENDANCE_STATUSES (hr/domain/payroll.ts)
  present: { label: 'Đủ công', short: '1', cls: 'att-present' }, half: { label: 'Nửa công', short: '½', cls: 'att-half' },
  paid_leave: { label: 'Nghỉ có lương', short: 'P', cls: 'att-paid' }, unpaid_leave: { label: 'Nghỉ không lương', short: 'K', cls: 'att-unpaid' },
  absent: { label: 'Vắng', short: 'V', cls: 'att-absent' },
};
const ATT_CYCLE = ['present', 'half', 'paid_leave', 'unpaid_leave', 'absent', ''];
const ADJ = { // khớp ADJUSTMENT_KINDS (hr/domain/payroll.ts)
  bonus: ['Thưởng khác / tuyên dương', 'ok'], allowance: ['Công tác / phụ cấp khác', 'blue'], deduction: ['Vi phạm / khấu trừ', 'danger'],
  advance: ['Tạm ứng', 'warn'], phone_advance: ['Tạm ứng điện thoại', 'warn'] };
const GROUP = { sale: 'Sale & Văn phòng', bn: 'NVBH ML (Bách Ngân)', lock: 'NVBH Lock' };
const RESP = { fixed: 'Cố định / tháng', prorated: 'Theo tỷ lệ ngày làm', per_day: 'Theo ngày (tham số / ngày)' };
const KPI_TIER = { high: ['Mức cao', 'ok'], low: ['Mức thấp', 'warn'], none: ['Không thưởng', 'muted'] };
const SLIP = { estimate: ['Tạm tính', 'muted'], confirmed: ['Đã chốt', 'info'], paid: ['Đã trả', 'ok'] };
const ROLE = { owner: ['Phụ trách', 'blue'], shared: ['Được chia sẻ', 'ok'], order: ['Có đơn', 'muted'] };
const QUOTE_STATUS = { draft: ['Nháp', 'off'], pending: ['Chờ duyệt', 'warn'], approved: ['Đã duyệt', 'ok'] };
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
  // Đơn hàng và HĐKT là 2 luồng độc lập: bản ghi có HĐKT hiện "HĐKT <số>" và mở #/contracts/<id>.
  const docHref = (id, contractNo) => `#/${contractNo ? 'contracts' : 'orders'}/${encodeURIComponent(id)}`;
  const docLink = (id, orderNo, contractNo) => `<a href="${docHref(id, contractNo)}">${esc(contractNo ? 'HĐKT ' + contractNo : orderNo)}</a>`;
  const plainOrders = d => d.orders.filter(o => !o.contract);
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
        <td>${x.orderId ? `<a href="${docHref(x.orderId, x.contractNo)}">${x.contractNo ? 'Xem HĐKT' : 'Xem đơn'}</a>` : '<span class="muted">Chưa đặt</span>'}</td></tr>`), 'Chưa có báo giá.') },
    { key: 'orders', label: 'Đơn hàng', count: d => plainOrders(d).length, html: d => table(['Đơn', 'Khách hàng', 'Tình trạng', '>Giá trị', 'Thanh toán'], plainOrders(d).map(o => `<tr class="clickable" data-href="#/orders/${esc(o.id)}">
        <td>${orderLink(o.id, o.orderNo)}<small>${fmtDate(o.orderDate)}${o.quoteNo ? ' · ' + esc(o.quoteNo) : ''}</small></td><td>${esc(o.customerName)}</td>
        <td>${pill(ORDER_STATUS, (o.status === 'draft' && o.submittedAt === null ? 'unsubmitted' : o.status))}</td>
        <td class="right num">${money(o.total)}</td><td>${payCell(o.receivable, o.counted, o.status)}</td></tr>`), 'Chưa có đơn đặt hàng.') },
    { key: 'contracts', label: 'HĐKT', count: d => d.contracts.length, html: d => table(['Số HĐKT', 'Khách hàng', 'Tình trạng', 'Ngày ký', '>Giá trị'], d.contracts.map(k => `<tr class="clickable" data-href="#/contracts/${esc(k.orderId)}">
        <td><a href="#/contracts/${encodeURIComponent(k.orderId)}">${esc(k.contractNo)}</a></td><td>${esc(k.customerName)}</td><td>${pill(CONTRACT_STATUS, k.status)}</td><td>${fmtDate(k.signedDate) || '—'}</td>
        <td class="right num">${money(k.value)}</td></tr>`), 'Chưa có hợp đồng kinh tế.') },
    { key: 'payments', label: 'Phiếu thu', count: d => d.payments.length, html: d => table(['Ngày thu', 'Khách hàng', 'Hình thức', 'Đơn / HĐKT', '>Số tiền'], d.payments.map(p => `<tr>
        <td>${fmtDate(p.paidAt)}</td><td>${esc(p.customerName)}${p.reference || p.note ? `<small>${esc(p.reference || p.note)}</small>` : ''}</td>
        <td>${esc(METHOD[p.method] || p.method)}</td><td>${docLink(p.orderId, p.orderNo, p.contractNo)}</td><td class="right num paid-text">${money(p.amount)}</td></tr>`), 'Chưa có phiếu thu nào.') },
    { key: 'debts', label: 'Công nợ', count: d => d.debts.length, html: d => table(['Đơn / HĐKT', 'Khách hàng', 'Hạn gần nhất', '>Phải thu', '>Đã thu', '>Còn lại', '>Quá hạn'], d.debts.map(o => `<tr class="clickable" data-href="${docHref(o.id, o.contractNo)}">
        <td>${docLink(o.id, o.orderNo, o.contractNo)}<small>${fmtDate(o.orderDate)}</small></td><td>${esc(o.customerName)}</td><td>${fmtDate(o.nextDueDate) || '—'}</td>
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
    const p = d.payroll, s = p.payslip, pr = p.profile, inp = p.input, edit = can() && !locked(), hasProfile = !!pr.effectiveMonth;
    const row = (l, cls = '') => `<tr class="${cls}"><td>${esc(l.label)}${l.note ? `<small>${esc(l.note)}</small>` : ''}</td><td class="right num">${cls === 'minus' ? '−' : ''}${money(l.amount)}</td></tr>`;
    const shown = list => list.filter(l => l.amount || l.key === 'salaryByDays' || s.group==='sale'&&pr.kpiEligible===false&&['contractBonus','contractBonusAdjustment'].includes(l.key));
    const pctTxt = v => v === null || v === undefined ? '—' : `${Math.round(v * 1000) / 10}%`;
    // Chỉ tiêu đã dùng: lưu trong kết quả KPI (phiếu mới); phiếu cũ → theo hồ sơ / tham số trong bản chụp lúc chốt.
    const ctxProfile = s.calculationContext?.profile || pr, ctxParams = s.calculationContext?.params || p.params;
    const kpiGoal = (k, _s, key) => {
      const field = { newCustomers: ['kpiNewCustomersTarget', 'kpiNewCustomers'], transactions: ['kpiTransactionsTarget', 'kpiTransactions'], contracts: ['kpiContractsTarget', 'kpiContracts'], revenue: ['revenueTarget', 'kpiRevenue'] }[key];
      const own = k.targets ? k.targets.own[key] : Number(ctxProfile[field[0]]) > 0, value = k.targets ? k.targets[key] : own ? Number(ctxProfile[field[0]]) : Number(ctxParams?.[field[1]]);
      return Number.isFinite(value) && value > 0 ? ` / chỉ tiêu ${own ? 'riêng ' : ''}${key === 'revenue' ? money(value) : value.toLocaleString('vi-VN')}` : '';
    };
    const k = s.kpi;
    return `<div class="md-pay-grid">
      <div class="md-slip">
        <div class="card-title-row"><h3>Phiếu lương ${esc(monthLabel(d.month).toLowerCase())}</h3>${pill(SLIP, s.status)}</div>
        <p class="muted small">${esc(GROUP[s.group] || '')}${s.positionLabel ? ' · ' + esc(s.positionLabel) : ''} · ${s.workDays} ngày làm việc${inp.workDays === null ? ' (theo chấm công)' : ' (nhập tay)'}</p>
        ${s.kpiNetBasis?`<p class="small"><b>DS net tính thưởng KPI: ${money(s.kpiNetBasis.netRevenue)}</b><br>Doanh số chưa VAT − hoa hồng khách hàng. ${s.kpiNetBasis.issues?`<span class="error">${s.kpiNetBasis.issues} đơn thiếu căn cứ hoa hồng${s.kpiNetBasis.rate>0?'; cần đối chiếu trước khi chốt thưởng':'; chưa phát sinh thưởng do KPI dưới 60%' }.</span>`:''}</p>`:''}${s.snapshotUnavailable?'<p class="error">Phiếu cũ thiếu bản chụp chi tiết. Giữ nguyên tổng tiền đã chốt; cần Manager đối soát trước khi in.</p>':''}<table class="md-slip-table"><tbody>
          ${shown(s.income).map(l => row(l)).join('')}
          ${s.group==='sale'&&(pr.kpiEligible===false||s.income.some(l=>['contractBonus','contractBonusAdjustment'].includes(l.key)&&l.amount))?`<tr><td colspan="2"><button class="btn secondary small" data-act="contract-bonus">${s.salesCrm?.kpiEligible===false||pr.kpiEligible===false?'Xem thưởng sao HĐKT và thanh lý':'Xem KPI & thưởng HĐKT'}</button>${!s.salesCrm?'<p class="muted small">Chưa bật đối chiếu thưởng CRM cho tháng này. Manager cài đặt tại Bảng lương → Cài đặt thưởng HĐKT.</p>':''}</td></tr>`:''}
          ${row({ label: 'Tổng thu nhập', amount: s.gross }, 'sum')}
          ${shown(s.deductions).map(l => row(l, 'minus')).join('')}
          ${row({ label: 'Thực nhận', amount: s.net }, 'net')}
        </tbody></table>
        ${s.status === 'estimate' ? `<p class="muted small">Tạm tính theo dữ liệu hiện tại; số liệu cố định khi Manager chốt lương.${hasProfile ? '' : ' <b>Chưa có hồ sơ lương</b> – đang tính theo mặc định.'}</p>`
          : `<p class="muted small">Chốt ${esc(fmtDate(s.confirmedAt))}${s.paidAt ? ` · Đã trả ${esc(fmtDate(s.paidAt))}` : ''}${s.note ? ' · ' + esc(s.note) : ''}</p>`}
        <div class="row-actions"><button type="button" class="btn secondary small" data-act="print-slip">In phiếu lương</button>${can() && s.status === 'estimate' && hasProfile ? '<button type="button" class="btn primary small" data-act="confirm-slip">Chốt lương tháng</button>' : ''}
          ${can() && s.status === 'confirmed' ? '<button type="button" class="btn primary small" data-act="paid-slip">Đánh dấu đã trả</button><button type="button" class="btn ghost small" data-act="reopen-slip">Mở lại</button>' : ''}</div>
        ${k ? `<div class="md-kpi"><div class="card-title-row"><h3>KPI công việc</h3>${pill(KPI_TIER, k.tier)}</div>
          ${s.snapshotUnavailable?'<p class="error">Phiếu cũ thiếu bản chụp chi tiết. Giữ nguyên tổng tiền đã chốt; cần Manager đối soát trước khi in.</p>':''}<table class="md-slip-table"><tbody>
            <tr><td>KH mới <small>${inp.kpiNewCustomers ?? ((s.salesCrm?.kpiApply??s.salesCrm?.apply)?s.salesCrm.facts.newCustomers:'—')} KH${kpiGoal(k, s, 'newCustomers')}</small></td><td class="right num">${pctTxt(k.points.newCustomers)}</td></tr>
            <tr><td>Giao dịch <small>${inp.kpiTransactions ?? ((s.salesCrm?.kpiApply??s.salesCrm?.apply)?s.salesCrm.facts.transactions:'—')} GD${kpiGoal(k, s, 'transactions')}</small></td><td class="right num">${pctTxt(k.points.transactions)}</td></tr>
            <tr><td>Số hợp đồng <small>${inp.kpiContracts ?? ((s.salesCrm?.kpiApply??s.salesCrm?.apply)?s.salesCrm.facts.contracts:'—')} HĐ${kpiGoal(k, s, 'contracts')}</small></td><td class="right num">${pctTxt(k.points.contracts)}</td></tr>
            <tr><td>DS cá nhân <small>${money(inp.kpiRevenue ?? s.revenue)}${kpiGoal(k, s, 'revenue')}</small></td><td class="right num">${pctTxt(k.points.revenue)}</td></tr>
            <tr class="sum"><td>KPI CV${k.used !== k.total ? ` <small>${inp.kpiOverride !== null && ctxProfile.fixedKpi == null ? 'Dùng KPI chốt nhập tay' : 'Dùng KPI cố định'} thay kết quả tính ${pctTxt(k.total)} – đổi chỉ tiêu không làm đổi thưởng</small>` : ''}</td><td class="right num">${pctTxt(k.used)}</td></tr>
          </tbody></table></div>` : ''}
      </div>
      <div>
        <div class="card-title-row"><h3>Số liệu tháng</h3>${edit ? '<button type="button" class="btn secondary small" data-act="inputs">Nhập số liệu tháng</button>' : ''}</div>
        <dl class="kv md-inputs"><dt>Ngày làm việc</dt><dd>${s.workDays}${inp.workDays === null ? ` <small class="muted">theo chấm công</small>` : ' <small class="muted">nhập tay</small>'}</dd>
          <dt>Giờ tăng ca</dt><dd>${inp.overtimeHours || 0}</dd>
          ${s.group === 'sale' ? `<dt>DS tháng</dt><dd class="num">${money(s.revenue)} <small class="muted">${inp.revenue === null ? 'đơn hàng trên hệ thống' : 'nhập tay'}</small></dd>
            ${inp.outputQty ? `<dt>Sản lượng</dt><dd>${Number(inp.outputQty).toLocaleString('vi-VN')}</dd>` : ''}`
          : `<dt>DS ${s.group === 'bn' ? 'cửa hàng' : 'team'}</dt><dd class="num">${money(s.group === 'bn' ? p.groupMonth.bnRevenue : p.groupMonth.lockRevenue)} <small class="muted">nhập ở Bảng lương</small></dd>
            <dt>BHYT / TNCN</dt><dd class="num">${money(inp.healthInsurance)} / ${money(inp.incomeTax)}</dd>`}
          ${inp.note ? `<dt>Ghi chú</dt><dd>${esc(inp.note)}</dd>` : ''}</dl>
        <div class="card-title-row md-gap"><h3>Thưởng, công tác, vi phạm, tạm ứng</h3>${edit ? '<button type="button" class="btn secondary small" data-act="add-adj">＋ Thêm khoản</button>' : ''}</div>
        ${p.adjustments.length ? `<ul class="plain-list md-adj">${p.adjustments.map(a => `<li><span>${pill(ADJ, a.kind)} <b class="num">${money(a.amount)}</b>
            <small>${esc(a.reason) || '—'} · ${esc(a.createdByName)} ${esc(fmtDate(a.createdAt))}</small></span>
            ${edit ? `<button class="icon-btn" data-del-adj="${esc(a.id)}" title="Xoá" aria-label="Xoá khoản"><svg viewBox="0 0 24 24"><path d="M5 7h14 M10 11v6 M14 11v6 M6 7l1 13h10l1-13 M9 7V4h6v3"/></svg></button>` : ''}</li>`).join('')}</ul>`
          : '<p class="muted cd-empty">Chưa có khoản nào trong tháng.</p>'}
        <div class="card-title-row md-gap"><h3>Hồ sơ lương</h3>${can() ? `<button type="button" class="btn secondary small" data-act="salary">${hasProfile ? 'Sửa hồ sơ lương' : 'Đặt hồ sơ lương'}</button>` : ''}</div>
        ${pr.payrollGroup==='sale'&&pr.kpiEligible===false?`<p class="small"><b>Thưởng sao HĐKT và thanh lý: ${pr.contractBonusEnabled?'Đã bật cho nhân viên':'Chưa bật cho nhân viên'}</b>${pr.kpiEligible===false?' · Sale Admin không tính KPI.':''} ${can()?'<a href="#/payroll?month='+encodeURIComponent(d.month)+'">Cài đặt thưởng HĐKT tại Bảng lương</a>':''}</p>`:''}
        ${hasProfile ? `<dl class="kv"><dt>Áp dụng từ</dt><dd>${esc(monthLabel(pr.effectiveMonth))}</dd>
          <dt>Bảng lương</dt><dd>${esc(GROUP[pr.payrollGroup])}${pr.positionLabel ? ' · ' + esc(pr.positionLabel) : ''}</dd>
          <dt>LCB / thoả thuận</dt><dd class="num">${pr.baseSalary ? money(pr.baseSalary) : `LCB vùng (${money(p.params.minWageDay * p.params.standardDays)})`}</dd>
          <dt>Hệ số năng lực</dt><dd>${pr.capacityCoef || '—'}</dd>
          <dt>Trách nhiệm</dt><dd>${esc(RESP[pr.responsibilityMode])}${pr.responsibilityMode === 'per_day' ? '' : ' · ' + money(pr.responsibility)}</dd>
          <dt>Cơm + xăng</dt><dd>${pr.mealAllowance ? 'Có' : 'Không (thử việc)'}</dd>
          ${pr.phoneAllowance ? `<dt>PC điện thoại</dt><dd class="num">${money(pr.phoneAllowance)}</dd>` : ''}
          ${pr.attendanceBonus ? `<dt>Chuyên cần</dt><dd class="num">${money(pr.attendanceBonus)}</dd>` : ''}
          ${pr.payrollGroup === 'sale' ? `<dt>KPI DS</dt><dd>${pr.kpiEligible===false?'Không áp dụng (Sale Admin)':pr.kpiEnabled ? `Có · chỉ tiêu DS ${money(pr.revenueTarget || p.params.kpiRevenue)}${pr.revenueTarget ? ' (riêng)' : ''}<br><small>KH mới ${(pr.kpiNewCustomersTarget || p.params.kpiNewCustomers).toLocaleString('vi-VN')}${pr.kpiNewCustomersTarget ? ' (riêng)' : ''} · Giao dịch ${(pr.kpiTransactionsTarget || p.params.kpiTransactions).toLocaleString('vi-VN')}${pr.kpiTransactionsTarget ? ' (riêng)' : ''} · HĐ ${(pr.kpiContractsTarget || p.params.kpiContracts).toLocaleString('vi-VN')}${pr.kpiContractsTarget ? ' (riêng)' : ''}</small>` : 'Không'}</dd>` : `<dt>Thưởng DS nhóm</dt><dd>${pr.teamBonus ? 'Có' : 'Không'}</dd>`}
          ${pr.outputRate ? `<dt>Đơn giá sản lượng</dt><dd>${pr.outputRate < 1 ? (pr.outputRate * 100) + '%' : money(pr.outputRate)}</dd>` : ''}
          <dt>BHXH</dt><dd class="num">${money(pr.insurance)}</dd>
          <dt>Nhận lương</dt><dd>${pr.bankAccount ? `${esc(pr.bankAccount)} – ${esc(pr.bankCode.toUpperCase())}<br><small class="muted">${esc(pr.bankHolder)}</small>` : '<span class="muted">Chưa có tài khoản</span>'}</dd>
          ${pr.note ? `<dt>Ghi chú</dt><dd>${esc(pr.note)}</dd>` : ''}</dl>`
          : '<p class="muted cd-empty">Chưa đặt hồ sơ lương (bảng lương, vị trí, LCB, hệ số năng lực, phụ cấp, BHXH, tài khoản ngân hàng).</p>'}
        ${p.history.length > 1 ? `<details class="md-history"><summary>Lịch sử hồ sơ lương (${p.history.length})</summary>${table(['Từ tháng', 'Bảng', '>LCB', '>Hệ số NL', '>BHXH'], p.history.map(h => `<tr>
            <td>${esc(monthLabel(h.effectiveMonth))}</td><td>${esc(GROUP[h.payrollGroup])}</td><td class="right num">${h.baseSalary ? money(h.baseSalary) : 'LCB vùng'}</td>
            <td class="right num">${h.capacityCoef}</td><td class="right num">${money(h.insurance)}</td></tr>`), '')}</details>` : ''}
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
    const d = st.d, m = d.member, k = d.kpi, a = d.access, s = d.payroll?.payslip;
    const pct = k.targetPercent, bar = pct === null ? '' : `<span class="md-progress"><i style="width:${Math.min(100, pct)}%"></i></span>`;
    const tabs = d.payroll ? TABS : TABS.filter(t => !['attendance', 'payroll'].includes(t.key));
    const tab = tabs.find(t => t.key === st.tab) || tabs[0];
    const stat = (label, value, sub, cls = '') => `<article class="stat ${cls}"><small>${label}</small><strong>${value}</strong>${sub}</article>`;
    root.innerHTML = `
      <div class="editor-head md-head">
        <div class="editor-title">${a.canManage ? '<a class="btn ghost small" href="#/staff">‹ Nhân viên</a>' : ''}
          <span class="avatar large"${avAttr(m.avatar)}>${esc(deps.initials(m.name))}</span>
          <div><h1>${esc(m.name)}</h1><span class="muted">${esc(m.position || m.positionId || '')}${m.role === 'manager' ? ' · Manager' : ''}</span>
            ${m.active ? '' : ' <span class="pill off">Đã khoá</span>'}</div></div>
        <div class="editor-actions">
          ${d.payroll&&can()?'<button class="btn primary" data-mobile-inline data-act="salary">Cài đặt lương</button>':''}
          <div class="md-month"><button type="button" class="icon-btn" data-month="-1" aria-label="Tháng trước">‹</button>
            <input type="month" id="md-month" value="${esc(d.month)}" aria-label="Chọn tháng"><button type="button" class="icon-btn" data-month="1" aria-label="Tháng sau">›</button></div>
          ${a.canManage && !a.isSelf ? '<button class="btn secondary" data-act="edit">Sửa thông tin</button>' : ''}
          ${a.canManage || a.isSelf ? '<button class="btn secondary" data-act="photo">Đổi ảnh</button>' : ''}
        </div>
      </div>
      <div class="stats md-kpis">
        ${stat('Doanh số tháng', money(k.revenue), `${bar}<span class="muted">${pct === null ? 'Chưa đặt chỉ tiêu' : `${pct}% chỉ tiêu ${short(k.revenueTarget)}`}</span>`, 'md-kpi-main')}
        ${stat('Đơn hàng / HĐKT', k.orders, `<span class="muted">TB ${money(k.avgOrder)}/đơn</span>`)}
        ${stat('Báo giá', k.quotes, `<span class="muted">Chốt ${k.quotesWon} · ${k.conversion === null ? '—' : k.conversion + '%'}</span>`)}
        ${stat('Đã thu tháng', `<span class="paid-text">${money(k.collected)}</span>`, `<span class="muted">${k.contractsSigned} HĐKT ký trong tháng</span>`)}
        ${stat('Công nợ đang giữ', `<span class="${k.debt.balance > 0 ? 'danger-text' : ''}">${money(k.debt.balance)}</span>`, `<span class="${k.debt.overdue ? 'danger-text' : 'muted'}">${k.debt.overdue ? 'Quá hạn ' + money(k.debt.overdue) : `${k.debt.orders} đơn còn nợ`}</span>`)}
        ${stat('Khách hàng', k.customers, `<span class="muted">${k.newCustomers} khách mới trong tháng</span>`)}
        ${d.payroll ? stat('Ngày công', `${k.workedDays}<small class="md-of">/${k.standardDays}</small>`, `<span class="muted">${monthLabel(d.month)}</span>`) : ''}
        ${stat('Công việc', `${k.tasks.done}<small class="md-of"> xong</small>`, `<span class="${k.tasks.overdue ? 'danger-text' : 'muted'}">${k.tasks.open} đang làm${k.tasks.overdue ? ` · ${k.tasks.overdue} trễ hạn` : ''}</span>`)}
      </div>
      <div class="md-grid">
        <div class="card"><h2 class="card-title">Doanh số 6 tháng</h2>${trendHtml(d.trend)}</div>
        <div class="card"><h2 class="card-title">Thông tin</h2><dl class="kv">
          <dt>Email</dt><dd>${m.email ? `<a href="mailto:${esc(m.email)}">${esc(m.email)}</a>` : '—'}</dd>
          <dt>Điện thoại</dt><dd>${m.phone ? `<a href="tel:${esc(m.phone.replace(/[^\d+]/g, ''))}">${esc(m.phone)}</a>` : '—'}</dd>
          <dt>Chức vụ</dt><dd>${esc(m.position || m.positionId || '—')}</dd><dt>Vào làm</dt><dd>${fmtDate(m.createdAt) || '—'}</dd>
          <dt>Trạng thái</dt><dd>${m.active ? '<span class="pill ok">Đang làm việc</span>' : '<span class="pill off">Đã khoá</span>'}</dd></dl></div>
        ${d.payroll ? `<div class="card md-salary-card"><div class="card-title-row"><h2 class="card-title">Lương ${esc(monthLabel(d.month).toLowerCase())}</h2>${pill(SLIP, s.status)}</div>
          <strong class="md-net">${money(s.net)}</strong><span class="muted">Thực nhận${s.status === 'estimate' ? ' (tạm tính)' : ''}</span>
          <dl class="kv md-mini"><dt>Tổng thu nhập</dt><dd class="num">${money(s.gross)}</dd><dt>Thưởng</dt><dd class="num">${money(s.income.filter(l => /Bonus(?:Adjustment)?$/.test(l.key)).reduce((a, l) => a + l.amount, 0))}</dd>
            <dt>Khấu trừ</dt><dd class="num">−${money(s.deductionTotal)}</dd></dl>
          <button type="button" class="btn ghost small" data-tab="payroll">Xem phiếu lương ›</button></div>` : ''}
      </div>
      <div class="card cd-tabs-card">
        <div class="chips cd-tabs" role="tablist">${tabs.map(t => `<button type="button" class="chip ${t.key === tab.key ? 'active' : ''}" role="tab" aria-selected="${t.key === tab.key}" data-tab="${t.key}">${t.label} <b>${t.count(d)}</b></button>`).join('')}</div>
        <div class="cd-tab-body">${tab.html(d)}</div>
      </div>`;
    root.querySelectorAll('.cd-tab-body table.data-table').forEach(t => {
      const heads = [...t.querySelectorAll('thead th')].map(th => th.textContent);
      t.querySelectorAll('tbody tr').forEach(tr => [...tr.children].forEach((td, i) => { if (i && heads[i]) td.dataset.label = heads[i]; }));
    });
  }

  async function open(id, month, tab) {
    const seq = ++st.seq; st.id = id; st.month = month || st.month || '';
    if (st.d?.member.id !== id) { st.d = null; st.tab = 'customers'; root.innerHTML = '<p class="muted cd-loading">Đang tải hồ sơ nhân viên…</p>'; }
    if (tab && TABS.some(t => t.key === tab)) st.tab = tab;
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

  const check = (name, label, on) => `<label class="check span-2"><input type="checkbox" name="${name}" ${on ? 'checked' : ''}> ${esc(label)}</label>`;
  const numInput = (name, label, v, attrs = '') => `<label>${esc(label)}<input name="${name}" inputmode="decimal" value="${v === null || v === undefined ? '' : esc(String(v))}" ${attrs}></label>`;
  const numVal = v => { const t = String(v).trim().replace(',', '.'); return t === '' ? null : Number(t); };

  function editSalary() {
    const p = st.d.payroll.profile, prm = st.d.payroll.params, has = !!p.effectiveMonth;
    dialog('Hồ sơ lương ' + st.d.member.name, `
      <label>Áp dụng từ tháng<input name="effectiveMonth" type="month" required value="${esc(st.month)}"></label>
      <label>Bảng lương<select name="payrollGroup">${Object.entries(GROUP).map(([k, t]) => `<option value="${k}" ${p.payrollGroup === k ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></label>
      <label>Vị trí (in trên bảng lương)<input name="positionLabel" maxlength="60" value="${esc(p.positionLabel)}" placeholder="SALE, KẾ TOÁN, KHO, TK, IT-WEB, NVBH, TV…"></label>
      <label>LCB / lương thoả thuận<input name="baseSalary" data-money inputmode="numeric" value="${p.baseSalary ? Number(p.baseSalary).toLocaleString('vi-VN') : ''}" placeholder="Trống = LCB vùng ${(prm.minWageDay * prm.standardDays).toLocaleString('vi-VN')}"></label>
      ${numInput('capacityCoef', 'Hệ số năng lực', p.capacityCoef || '', 'placeholder="0"')}
      <label>Trách nhiệm tính<select name="responsibilityMode">${Object.entries(RESP).map(([k, t]) => `<option value="${k}" ${p.responsibilityMode === k ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></label>
      ${moneyInput('responsibility', 'Tiền trách nhiệm / tháng', p.responsibility)}
      ${moneyInput('phoneAllowance', 'Phụ cấp điện thoại / tháng', p.phoneAllowance)}
      ${moneyInput('attendanceBonus', 'Chuyên cần / tháng (BN, Lock)', p.attendanceBonus)}
      ${numInput('outputRate', 'Đơn giá sản lượng (đ) hoặc tỷ lệ (0,005 = 0,5%)', p.outputRate || '', 'placeholder="Kho 15000 · TK 30000 · IT 0,005"')}
      ${moneyInput('revenueTarget', 'Chỉ tiêu DS cá nhân / tháng', p.revenueTarget)}
      ${p.kpiEligible === false ? '' : `<p class="muted small span-2">Chỉ tiêu KPI riêng (Sale tính KPI): để trống = theo mức chung của tháng ở Thiết lập lương. Không nhập 0. Trọng số và bậc thưởng dùng chung.</p>
      ${numInput('kpiNewCustomersTarget', `Chỉ tiêu KH mới / tháng (trống = chung ${prm.kpiNewCustomers})`, p.kpiNewCustomersTarget, `placeholder="Chung: ${prm.kpiNewCustomers}" min="1"`)}
      ${numInput('kpiTransactionsTarget', `Chỉ tiêu giao dịch / tháng (trống = chung ${prm.kpiTransactions})`, p.kpiTransactionsTarget, `placeholder="Chung: ${prm.kpiTransactions}" min="1"`)}
      ${numInput('kpiContractsTarget', `Chỉ tiêu số HĐ / tháng (trống = chung ${prm.kpiContracts})`, p.kpiContractsTarget, `placeholder="Chung: ${prm.kpiContracts}" min="1"`)}
      <label class="span-2">Lý do đổi chỉ tiêu (bắt buộc khi đổi chỉ tiêu DS / KH mới / giao dịch / HĐ)<input name="changeReason" maxlength="500" placeholder="Ví dụ: Sale mới, giảm chỉ tiêu 3 tháng đầu"></label>`}
      ${moneyInput('insurance', 'BHXH người lao động / tháng', has ? p.insurance : prm.socialInsurance)}
      ${check('mealAllowance', 'Hưởng phụ cấp cơm + xăng (thử việc: bỏ chọn)', p.mealAllowance)}
      ${p.kpiEligible===false?'<p class="muted span-2">Sale Admin không tính KPI. Thưởng sao HĐKT và thưởng thanh lý được bật riêng bên dưới.</p>':check('kpiEnabled','Sale: tính KPI công việc + thưởng KPI DS',p.kpiEnabled)+numInput('fixedKpi','KPI cố định (%) — trống = theo tháng / công thức',p.fixedKpi==null?'':p.fixedKpi*100)}
      ${p.kpiEligible===false?check('contractBonusEnabled','Sale Admin: hưởng thưởng sao HĐKT và thanh lý',p.contractBonusEnabled):'<input type="hidden" name="contractBonusEnabled"><p class="muted span-2">Sale nhận thưởng theo tổng KPI trên doanh số net; thưởng sao / thanh lý dành cho Sale Admin.</p>'}
      ${check('teamBonus', 'NVBH ML / Lock: hưởng thưởng DS của nhóm', p.teamBonus)}
      <label>Mã ngân hàng (VietQR)<input name="bankCode" maxlength="30" value="${esc(p.bankCode)}" placeholder="vcb, acb, vietinbank, tcb…"></label>
      <label>Số tài khoản<input name="bankAccount" maxlength="30" inputmode="numeric" value="${esc(p.bankAccount)}"></label>
      <label class="span-2">Chủ tài khoản<input name="bankHolder" maxlength="120" value="${esc(p.bankHolder)}"></label>
      <label class="span-2">Ghi chú<input name="note" maxlength="500" value="${esc(p.note || '')}"></label>
      <p class="muted small span-2">Hồ sơ áp dụng từ tháng đã chọn cho tới khi có bản mới. Các tháng đã chốt lương không đổi. KPI cố định / KPI chốt tay (nếu có) thay kết quả tính – đổi chỉ tiêu khi đó không đổi thưởng.</p>
      <details class="span-2" data-salary-history><summary>Lịch sử sửa hồ sơ lương</summary><div class="muted small">Mở để tải…</div></details>`, 'Lưu hồ sơ lương', f =>
      api(base() + '/salary', 'PUT', { effectiveMonth: f.effectiveMonth.value, payrollGroup: f.payrollGroup.value, positionLabel: f.positionLabel.value,
        baseSalary: digits(f.baseSalary.value), capacityCoef: numVal(f.capacityCoef.value) ?? 0, responsibilityMode: f.responsibilityMode.value, responsibility: digits(f.responsibility.value),
        phoneAllowance: digits(f.phoneAllowance.value), attendanceBonus: digits(f.attendanceBonus.value), outputRate: numVal(f.outputRate.value) ?? 0,
        revenueTarget: digits(f.revenueTarget.value), insurance: digits(f.insurance.value), mealAllowance: f.mealAllowance.checked, kpiEnabled: f.kpiEnabled?.checked||false,fixedKpi:numVal(f.fixedKpi?.value||'')===null?null:numVal(f.fixedKpi.value)/100,contractBonusEnabled:f.contractBonusEnabled.checked,
        teamBonus: f.teamBonus.checked, bankCode: f.bankCode.value, bankAccount: f.bankAccount.value, bankHolder: f.bankHolder.value, note: f.note.value,
        ...(f.kpiNewCustomersTarget ? { kpiNewCustomersTarget: numVal(f.kpiNewCustomersTarget.value), kpiTransactionsTarget: numVal(f.kpiTransactionsTarget.value), kpiContractsTarget: numVal(f.kpiContractsTarget.value), changeReason: f.changeReason.value } : {}) })
        .then(() => toast('Đã lưu hồ sơ lương.')));
    const history = document.querySelector('dialog.modal [data-salary-history]');
    history?.addEventListener('toggle', () => { if (history.open && !history.dataset.loaded) { history.dataset.loaded = '1'; loadSalaryHistory(history.querySelector('div')); } });
  }
  // Nhật ký sửa hồ sơ lương (Manager): người sửa, lúc sửa, tháng áp dụng, trước → sau, lý do. Không hiện số tài khoản.
  const SALARY_FIELD = { payrollGroup: 'Bảng lương', positionLabel: 'Vị trí', baseSalary: 'LCB', capacityCoef: 'Hệ số năng lực', responsibilityMode: 'Cách tính trách nhiệm', responsibility: 'Trách nhiệm',
    mealAllowance: 'PC cơm + xăng', phoneAllowance: 'PC điện thoại', attendanceBonus: 'Chuyên cần', kpiEnabled: 'Tính KPI', fixedKpi: 'KPI cố định', contractBonusEnabled: 'Thưởng HĐKT', teamBonus: 'Thưởng DS nhóm',
    outputRate: 'Đơn giá sản lượng', revenueTarget: 'Chỉ tiêu DS', kpiNewCustomersTarget: 'Chỉ tiêu KH mới', kpiTransactionsTarget: 'Chỉ tiêu giao dịch', kpiContractsTarget: 'Chỉ tiêu số HĐ', insurance: 'BHXH', note: 'Ghi chú' };
  async function loadSalaryHistory(box) {
    try {
      const { items } = await api(base() + '/salary-history');
      const show = v => v === null || v === '' ? 'trống' : typeof v === 'boolean' ? (v ? 'có' : 'không') : typeof v === 'number' ? v.toLocaleString('vi-VN') : String(v);
      box.innerHTML = items.length ? `<ul class="md-history">${items.map(h => `<li><b>${esc(fmtDate(h.at))}</b> · ${esc(h.by || '—')} · ${h.created ? 'tạo hồ sơ, ' : ''}áp dụng ${esc(monthLabel(h.effectiveMonth || st.month))}
        <br>${Object.entries(h.changes).map(([k, c]) => `${esc(SALARY_FIELD[k] || k)}: ${esc(show(c.from))} → ${esc(show(c.to))}`).join('; ') || '—'}${h.bankChanged ? '; đổi tài khoản nhận lương' : ''}
        ${h.reason ? `<br><i>Lý do: ${esc(h.reason)}</i>` : ''}</li>`).join('')}</ul>` : 'Chưa có lần sửa nào được ghi nhật ký.';
    } catch (e) { box.textContent = e.message || 'Chưa tải được lịch sử.'; }
  }
  function editInputs() {
    const p = st.d.payroll, i = p.input, g = p.profile.payrollGroup, kpi = g === 'sale' && p.profile.kpiEnabled;
    dialog('Số liệu ' + monthLabel(st.month).toLowerCase(), `
      ${p.payslip.kpiNetBasis?'<p class="muted small span-2">Thưởng KPI dùng doanh số net tự tính từ đơn và hoa hồng. Các ô doanh số dưới đây dùng tính điểm KPI, không ghi đè cơ sở net.</p>':''}
      ${numInput('workDays', `Ngày làm việc (trống = chấm công: ${p.attendanceSummary.worked})`, i.workDays, 'placeholder="Theo chấm công"')}
      ${numInput('overtimeHours', 'Giờ tăng ca', i.overtimeHours || '', 'placeholder="0"')}
      ${g === 'sale' ? `<label>DS tháng (trống = đơn hàng: ${money(p.systemRevenue)})<input name="revenue" data-money inputmode="numeric" value="${i.revenue === null ? '' : Number(i.revenue).toLocaleString('vi-VN')}" placeholder="Theo đơn hàng"></label>
        ${numInput('outputQty', 'Sản lượng (đơn / lượt / DS web)', i.outputQty || '', 'placeholder="0"')}
        <label>Thưởng quý (trống = tự tính)<input name="quarterBonus" data-money inputmode="numeric" value="${i.quarterBonus === null ? '' : Number(i.quarterBonus).toLocaleString('vi-VN')}" placeholder="Tự tính"></label>` : `
        ${moneyInput('healthInsurance', 'BHYT', i.healthInsurance)}${moneyInput('incomeTax', 'Thuế TNCN', i.incomeTax)}`}
      ${kpi ? `<p class="cd-field-label span-2">KPI công việc (sheet "KPI CV")</p>
        ${numInput('kpiNewCustomers', 'KH mới (trống = CRM khi áp dụng)', i.kpiNewCustomers,`placeholder="Tự động: ${p.systemFacts?.newCustomers??'chưa bật'}"`)}${numInput('kpiTransactions', 'Giao dịch hợp lệ (trống = CRM khi áp dụng)', i.kpiTransactions,`placeholder="Tự động: ${p.systemFacts?.transactions??'chưa bật'}"`)}
        ${numInput('kpiContracts', 'Số hợp đồng', i.kpiContracts)}
        <label>DS cá nhân tính KPI (trống = DS tháng)<input name="kpiRevenue" data-money inputmode="numeric" value="${i.kpiRevenue === null ? '' : Number(i.kpiRevenue).toLocaleString('vi-VN')}"></label>
        ${numInput('kpiMerchDays', 'Ngày làm hàng', i.kpiMerchDays || '')}${numInput('kpiTripDays', 'Ngày công tác', i.kpiTripDays || '')}
        ${numInput('kpiOverride', 'KPI chốt (%) – nhập tay thay kết quả', i.kpiOverride === null ? '' : +(i.kpiOverride * 100).toFixed(2))}` : ''}
      <label class="span-2">Ghi chú<input name="note" maxlength="500" value="${esc(i.note || '')}"></label>`, 'Lưu số liệu', f => {
      const v = n => f.namedItem(n) ? f.namedItem(n).value : '';
      const moneyOpt = n => v(n).trim() === '' ? null : digits(v(n));
      const ko = numVal(v('kpiOverride'));
      return api(`${base()}/inputs/${st.month}`, 'PUT', {
        workDays: numVal(v('workDays')), overtimeHours: numVal(v('overtimeHours')) ?? 0, revenue: moneyOpt('revenue'), outputQty: numVal(v('outputQty')) ?? 0,
        quarterBonus: moneyOpt('quarterBonus'), healthInsurance: digits(v('healthInsurance')), incomeTax: digits(v('incomeTax')),
        kpiNewCustomers: numVal(v('kpiNewCustomers')), kpiTransactions: numVal(v('kpiTransactions')), kpiContracts: numVal(v('kpiContracts')), kpiRevenue: moneyOpt('kpiRevenue'),
        kpiMerchDays: numVal(v('kpiMerchDays')) ?? 0, kpiTripDays: numVal(v('kpiTripDays')) ?? 0, kpiOverride: ko === null ? null : ko / 100, note: v('note'),
      }).then(() => toast('Đã lưu số liệu tháng.'));
    });
  }
  function addAdjustment() {
    dialog('Thêm khoản ' + monthLabel(st.month).toLowerCase(), `
      <label>Loại<select name="kind">${Object.entries(ADJ).map(([k, [t]]) => `<option value="${k}">${esc(t)}</option>`).join('')}</select></label>
      ${moneyInput('amount', 'Số tiền', 0)}
      <label class="span-2">Lý do<input name="reason" maxlength="500" placeholder="VD: Thưởng tuyên dương, công tác Đà Lạt, phạt đi muộn, tạm ứng giữa tháng…"></label>`, 'Thêm', f => {
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
      else if (act === 'contract-bonus')openContractBonusDetails(st.d.payroll.payslip,{kpiEligible:st.d.payroll.profile.kpiEligible});
      else if (act === 'salary') editSalary();
      else if (act === 'add-adj') addAdjustment();
      else if (act === 'inputs') editInputs();
      else if (act === 'print-slip'&&st.d.payroll.payslip.snapshotUnavailable)toast('Phiếu cũ thiếu chi tiết; cần đối soát trước khi in.','err');
      else if (act === 'print-slip') printPayslip({ member: m, month: st.month, slip: st.d.payroll.payslip, standardDays: st.d.payroll.params.standardDays, words: deps.moneyWords });
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
        await api(slip, 'POST', {confirmationHash:st.d.payroll.confirmationHash}); toast('Đã chốt lương.'); reload();
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

