import {openContractBonusDetails} from './contract-bonus-detail.js';
// BẢNG LƯƠNG CÔNG TY (#/payroll?month=YYYY-MM) – theo file "Bảng lương mẫu": Tổng hợp · 3 bảng (Sale & VP, NVBH ML – Bách Ngân, NVBH Lock) ·
// Chuyển khoản (VietQR) · Tham số · Xuất Excel. Mọi con số do máy chủ tính (src/modules/hr/domain/payroll.ts) – trang này chỉ hiển thị.
// Sửa số liệu từng người ở trang chi tiết nhân viên (tab Lương & thưởng); số liệu chung của nhóm và tham số sửa ngay tại đây.

import { openAdms } from './adms.js';

const STATUS = { estimate: ['Tạm tính', 'muted'], confirmed: ['Đã chốt', 'info'], paid: ['Đã trả', 'ok'] };
const monthLabel = m => `Tháng ${Number(m.slice(5))}/${m.slice(0, 4)}`;
const shiftMonth = (m, d) => { const t = new Date(Date.UTC(+m.slice(0, 4), +m.slice(5) - 1 + d, 1)); return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}`; };
const digits = v => Number(String(v ?? '').replace(/[^\d]/g, '')) || 0;

/** @param deps { api, toast, esc, money, pill, confirmBox } */
export function initPayroll(deps) {
  const { api, toast, esc, money, pill, confirmBox } = deps;
  const root = document.getElementById('payroll-board');
  root.addEventListener('click',e=>{const b=e.target.closest('[data-bonus-member]');if(b){const r=st.d?.rows.find(r=>r.member.id===b.dataset.bonusMember);if(r)openContractBonusDetails(r.payslip);}});
  const st = { month: '', d: null, tab: 'summary', seq: 0 };
  const TABS = [['summary', 'Tổng hợp'], ['profiles', 'Cài đặt lương'], ['sale', 'Sale & VP'], ['bn', 'NVBH ML'], ['lock', 'NVBH Lock'], ['transfer', 'Chuyển khoản']];
  const memberLink = (r, text) => `<a href="#/members/${encodeURIComponent(r.member.id)}?month=${encodeURIComponent(st.month)}&tab=payroll">${esc(text)}</a>`;
  const line = (p, key) => [...p.income, ...p.deductions].find(l => l.key === key)?.amount ?? 0;
  const withProfile = () => st.d.rows.filter(r => r.profile.hasProfile || r.payslip.status !== 'estimate');
  const missingIn = g => st.d.rows.filter(r => r.member.active && !r.profile.hasProfile && r.payslip.status === 'estimate' && r.payslip.group === g).length;

  function profilesHtml() {
    return `<h3>Cài đặt lương nhân viên</h3><p class="muted small">Chọn nhân viên để đặt lương cơ bản, phụ cấp, BHXH, tài khoản ngân hàng và quyền hưởng thưởng HĐKT. Hồ sơ lưu theo tháng áp dụng; phiếu đã chốt giữ nguyên.</p>
      <div class="table-wrap"><table class="data-table"><thead><tr><th>Nhân viên</th><th>Vị trí</th><th>Bảng lương</th><th>Hồ sơ</th><th>Cài đặt</th></tr></thead><tbody>${st.d.rows.map(r=>`<tr><td class="first">${memberLink(r,r.member.name)}</td><td>${esc(r.profile.positionLabel||r.member.positionId||'—')}</td><td>${esc(st.d.columns.groups[r.profile.payrollGroup]||'—')}</td><td>${r.profile.hasProfile?'Đã thiết lập':'Chưa thiết lập'}</td><td><a class="btn secondary small" href="#/members/${encodeURIComponent(r.member.id)}?month=${encodeURIComponent(st.month)}&tab=payroll">Cài đặt lương</a></td></tr>`).join('')}</tbody></table></div>`;
  }
  function bonusSetupHtml() {
    const p=st.d.params,from=String(p.salesAutomationFrom||0).replace(/^(\d{4})(\d{2})$/,'$1-$2');
    const status=from==='0'?'Chưa bật tính thưởng từ CRM':st.month<from?'Bắt đầu từ '+monthLabel(from):p.salesAutomationApply===1?'Đang áp dụng vào phiếu lương':'Đang đối chiếu — chưa cộng vào thực nhận';
    return `<section class="approval-box pr-bonus-setup"><div class="approval-head"><h3>Thưởng Sale / Sale Admin</h3></div><p><b>${esc(status)}</b></p><p class="small">Thưởng sao tính theo giá trị HĐKT trước VAT trong tháng ký; thưởng thanh lý tính khi Manager duyệt. Sale Admin chỉ hưởng thưởng sao và thanh lý, không tính KPI.</p><p class="small">${[1,2,3,4,5].map(n=>`${n} sao: từ ${money(p['contractStar'+n+'From'])} → ${money(p['contractStar'+n+'Amount'])}`).join(' · ')}<br>Thanh lý: ${money(p.contractLiquidationAmount)} / HĐKT.</p><p class="muted small">Để tính thưởng, chọn tháng bắt đầu trong Cài đặt thưởng HĐKT và bật “Hưởng thưởng sao HĐKT và thanh lý” trong hồ sơ lương từng người. Chế độ đối chiếu chưa cộng vào thực nhận.</p><button class="btn ghost small" data-mobile-inline data-tab="profiles">Cài đặt lương và thưởng cho nhân viên</button></section>`;
  }

  function groupTable(g) {
    const d = st.d, cols = d.columns, rows = withProfile().filter(r => r.payslip.group === g);
    // Nhân viên đang làm chưa có hồ sơ lương (xếp bảng theo chức vụ, vd NVBH ML → bảng ML): liệt kê để Manager thiết lập, không sót ai.
    const missing = d.rows.filter(r => !rows.includes(r) && r.member.active && r.payslip.group === g);
    const missingHtml = missing.length ? `<div class="approval-box"><div class="approval-head"><b>Chưa có hồ sơ lương (${missing.length})</b>
      <small class="muted">Chưa tính vào bảng / tổng. Bấm tên để nhập LCB, BHXH, ngân hàng… ở tab Lương & thưởng rồi lưu hồ sơ lương.</small></div>
      <p>${missing.map(r => memberLink(r, r.member.name)).join(' · ')}</p></div>` : '';
    if (!rows.length) return missingHtml + `<p class="muted cd-empty">Chưa có nhân viên nào thuộc bảng ${esc(cols.groups[g])}. Đặt "Bảng lương" trong hồ sơ lương của nhân viên.</p>`;
    const inc = cols.income[g], ded = cols.deductions[g], sum = k => rows.reduce((s, r) => s + line(r.payslip, k), 0);
    const head = ['STT', 'Họ tên', 'Vị trí', 'Ngày công', ...inc.map(k => cols.labels[k]), 'Tổng thu nhập', ...ded.map(k => cols.labels[k]), 'Thực nhận', 'Trạng thái'];
    return missingHtml + `<div class="table-wrap pr-wide"><table class="data-table pr-table"><thead><tr>${head.map((h, i) => `<th class="${i >= 3 && i < head.length - 1 ? 'right' : ''}">${esc(h)}</th>`).join('')}</tr></thead><tbody>
      ${rows.map((r, i) => { const p = r.payslip; return `<tr>
        <td>${i + 1}</td><td class="first">${memberLink(r, r.member.name)}</td><td>${esc(r.profile.positionLabel || '—')}</td><td class="right num" data-label="Ngày công">${p.workDays}</td>
        ${inc.map(k => { const v = line(p, k); return `<td class="right num ${v ? '' : 'muted'}" data-label="${esc(cols.labels[k])}">${['contractBonus','contractBonusAdjustment'].includes(k)&&p.salesCrm?`<button class="btn ghost small" data-bonus-member="${esc(r.member.id)}">${v?money(v):'—'} · Chi tiết</button>`:(v?money(v):'—')}</td>`; }).join('')}
        <td class="right num strong" data-label="Tổng thu nhập">${money(p.gross)}</td>
        ${ded.map(k => { const v = line(p, k); return `<td class="right num ${v ? 'danger-text' : 'muted'}" data-label="${esc(cols.labels[k])}">${v ? money(v) : '—'}</td>`; }).join('')}
        <td class="right num strong pr-net" data-label="Thực nhận">${money(p.net)}</td><td>${pill(STATUS, p.status)}</td></tr>`; }).join('')}
      </tbody><tfoot><tr><td></td><td colspan="2"><b>Tổng cộng (${rows.length})</b></td><td></td>
        ${inc.map(k => `<td class="right num">${money(sum(k))}</td>`).join('')}<td class="right num strong">${money(rows.reduce((s, r) => s + r.payslip.gross, 0))}</td>
        ${ded.map(k => `<td class="right num">${money(sum(k))}</td>`).join('')}<td class="right num strong">${money(rows.reduce((s, r) => s + r.payslip.net, 0))}</td><td></td></tr></tfoot></table></div>`;
  }

  function summaryHtml() {
    const d = st.d, gm = d.groupMonth, q = d.quarter, quarterEnd = Number(d.month.slice(5)) % 3 === 0;
    const noProfile = d.rows.filter(r => !r.profile.hasProfile && r.payslip.status === 'estimate');
    return `<div class="table-wrap"><table class="data-table"><thead><tr><th>Nhóm</th><th class="right">Nhân sự</th><th class="right">Tổng thu nhập</th><th class="right">Khấu trừ</th><th class="right">Thực nhận</th><th class="right">Tỷ trọng</th></tr></thead><tbody>
        ${d.totals.map(t => `<tr class="clickable" data-tab="${t.group}"><td class="first"><b>${esc(t.label)}</b></td><td class="right num" data-label="Nhân sự">${t.people}</td><td class="right num" data-label="Thu nhập">${money(t.gross)}</td>
          <td class="right num" data-label="Khấu trừ">${money(t.deductions)}</td><td class="right num strong" data-label="Thực nhận">${money(t.net)}</td>
          <td class="right num" data-label="Tỷ trọng">${totalNet() ? Math.round(t.net / totalNet() * 1000) / 10 : 0}%</td></tr>`).join('')}
      </tbody></table></div>
      <div class="pr-grid">
        <form class="card pr-month" id="pr-month-form"><h3>Số liệu chung ${esc(monthLabel(d.month).toLowerCase())}</h3>
          <label>DS cửa hàng ML (Bách Ngân)<input name="bnRevenue" data-money inputmode="numeric" value="${gm.bnRevenue ? Number(gm.bnRevenue).toLocaleString('vi-VN') : ''}" placeholder="0"></label>
          <label>DS trung bình 6 tháng (cửa hàng ML)<input name="bnAvgRevenue" data-money inputmode="numeric" value="${gm.bnAvgRevenue ? Number(gm.bnAvgRevenue).toLocaleString('vi-VN') : ''}" placeholder="0"></label>
          <label>DS team Lock<input name="lockRevenue" data-money inputmode="numeric" value="${gm.lockRevenue ? Number(gm.lockRevenue).toLocaleString('vi-VN') : ''}" placeholder="0"></label>
          ${quarterEnd ? `<label class="check"><input type="checkbox" name="payQuarterBonus" ${gm.payQuarterBonus ? 'checked' : ''}> Chi trả thưởng quý ${Math.ceil(Number(d.month.slice(5)) / 3)} team Sale trong kỳ lương này</label>` : '<small class="muted">Thưởng quý team Sale chỉ xét ở tháng cuối quý (3, 6, 9, 12).</small>'}
          <button class="btn primary small">Lưu số liệu chung</button></form>
        <div class="card"><h3>Thưởng quý team Sale</h3>${q ? `<dl class="kv"><dt>Quý</dt><dd>${q.quarter} (${q.months.map(m => 'T' + Number(m.slice(5))).join(', ')})</dd>
            <dt>DS team</dt><dd class="num">${money(q.teamRevenue)} / ${money(q.teamTarget)} (${Math.round(q.teamPercent * 1000) / 10}%)</dd>
            <dt>ĐK 1 – team đạt</dt><dd>${q.teamOk ? '<span class="pill ok">Đạt</span>' : '<span class="pill warn">Không đạt</span>'}</dd>
            <dt>ĐK 2 – mọi người đạt</dt><dd>${q.membersOk ? '<span class="pill ok">Đạt</span>' : '<span class="pill warn">Không đạt</span>'}</dd>
            <dt>Quỹ thưởng quý</dt><dd class="num strong">${money(q.fund)}</dd></dl>`
          : `<p class="muted cd-empty">${quarterEnd ? 'Bật "Chi trả thưởng quý" để tự tính cho người thuộc bảng Sale có tính KPI.' : 'Chưa tới tháng xét thưởng quý.'}</p>`}</div>
      </div>
      ${noProfile.length ? `<div class="approval-box"><div class="approval-head"><b>Chưa có hồ sơ lương (${noProfile.length})</b><small class="muted">Không nằm trong bảng lương tới khi đặt hồ sơ lương.</small></div>
        <p>${noProfile.map(r => memberLink(r, r.member.name)).join(' · ')}</p></div>` : ''}`;
  }
  const totalNet = () => st.d.totals.reduce((s, t) => s + t.net, 0);

  function transferHtml() {
    const rows = withProfile().filter(r => r.payslip.net > 0);
    return `<p class="muted small">Số tiền = thực nhận (làm tròn đồng). Nội dung chuyển khoản: "Luong T${Number(st.month.slice(5))}". Bấm "Mã QR" để mở ảnh mã VietQR quét bằng app ngân hàng.</p>
      <div class="table-wrap"><table class="data-table"><thead><tr><th>Nhân viên</th><th>Ngân hàng</th><th>Số tài khoản</th><th>Chủ tài khoản</th><th class="right">Số tiền</th><th>Mã QR</th><th>Kiểm tra</th></tr></thead><tbody>
      ${rows.map(r => `<tr><td class="first">${memberLink(r, r.member.name)}<small>${esc(r.profile.positionLabel)}</small></td><td data-label="NH">${esc((r.profile.bankCode || '').toUpperCase()) || '—'}</td>
        <td data-label="STK">${esc(r.profile.bankAccount) || '—'}</td><td data-label="Chủ TK">${esc(r.profile.bankHolder) || '—'}</td><td class="right num strong">${money(r.payslip.net)}</td>
        <td>${r.qr ? `<a href="${esc(r.qr)}" target="_blank" rel="noopener">Mã QR</a>` : '—'}</td>
        <td>${r.qr ? '<span class="pill ok">OK</span>' : '<span class="pill warn">Thiếu mã NH / STK</span>'}</td></tr>`).join('')}
      </tbody></table></div>`;
  }

  function render() {
    const d = st.d, total = d.totals.reduce((s, t) => ({ people: s.people + t.people, gross: s.gross + t.gross, deductions: s.deductions + t.deductions, net: s.net + t.net }), { people: 0, gross: 0, deductions: 0, net: 0 });
    const open = withProfile().filter(r => r.payslip.status === 'estimate').length;
    root.innerHTML = `
      <div class="page-head"><div><span class="eyebrow">Quản trị</span><h1>Bảng lương</h1><p class="muted">${esc(monthLabel(d.month))} · tham số áp dụng ${d.paramsMonth ? 'từ ' + esc(monthLabel(d.paramsMonth).toLowerCase()) : 'mặc định theo file mẫu'}.</p></div>
        <div class="row-actions pr-actions">
          <div class="md-month"><button type="button" class="icon-btn" data-month="-1" aria-label="Tháng trước">‹</button><input type="month" id="pr-month" value="${esc(d.month)}" aria-label="Chọn tháng"><button type="button" class="icon-btn" data-month="1" aria-label="Tháng sau">›</button></div>
          <button class="btn primary" data-mobile-inline data-tab="profiles">Cài đặt lương nhân viên</button><button class="btn secondary" data-mobile-inline data-act="bonus-params">Cài đặt thưởng HĐKT</button><a class="btn secondary" href="https://synctime.vn/login.php" target="_blank" rel="noopener noreferrer">Đăng nhập SyncTime</a><button class="btn secondary" data-act="adms">Chấm công từ máy</button><button class="btn secondary" data-act="params">Tham số</button><button class="btn secondary" data-act="excel">Xuất Excel</button>
          ${open ? `<button class="btn primary" data-act="confirm-all">Chốt lương (${open})</button>` : ''}</div></div>
      <div class="stats">
        <article class="stat"><small>Nhân sự</small><strong>${total.people}</strong><span class="muted">${open ? `${open} phiếu tạm tính` : 'Đã chốt tất cả'}</span></article>
        <article class="stat"><small>Tổng thu nhập</small><strong>${money(total.gross)}</strong><span class="muted">3 bảng lương</span></article>
        <article class="stat"><small>Tổng khấu trừ</small><strong class="danger-text">${money(total.deductions)}</strong><span class="muted">BHXH, BHYT, TNCN, vi phạm, tạm ứng</span></article>
        <article class="stat"><small>Tổng thực nhận</small><strong class="paid-text">${money(total.net)}</strong><span class="muted">Chuyển khoản</span></article>
      </div>
      <div class="card cd-tabs-card">
        <div class="chips cd-tabs" role="tablist">${TABS.map(([k, t]) => `<button type="button" class="chip ${k === st.tab ? 'active' : ''}" data-tab="${k}">${t}${['sale', 'bn', 'lock'].includes(k) ? ` <b>${d.totals.find(x => x.group === k).people}</b>${missingIn(k) ? ` <small class="danger-text" title="Chưa có hồ sơ lương">+${missingIn(k)}</small>` : ''}` : ''}</button>`).join('')}</div>
        <div class="cd-tab-body">${['summary','sale'].includes(st.tab)?bonusSetupHtml():''}${st.tab === 'summary' ? summaryHtml() : st.tab === 'profiles' ? profilesHtml() : st.tab === 'transfer' ? transferHtml() : groupTable(st.tab)}</div></div>`;
    root.querySelectorAll('.cd-tab-body table.data-table').forEach(t => {
      const heads = [...t.querySelectorAll('thead th')].map(th => th.textContent);
      t.querySelectorAll('tbody tr').forEach(tr => [...tr.children].forEach((td, i) => { if (i && heads[i] && !td.dataset.label) td.dataset.label = heads[i]; }));
    });
  }

  async function open(month) {
    const seq = ++st.seq; st.month = month || st.month || new Date().toISOString().slice(0, 7);
    if (!st.d) root.innerHTML = '<p class="muted cd-loading">Đang tính bảng lương…</p>';
    try {
      const d = await api('/hr/payroll/' + st.month);
      if (seq !== st.seq) return; st.d = d; render();
    } catch (e) { if (seq === st.seq) root.innerHTML = `<div class="empty"><h3>Không mở được bảng lương</h3><p class="muted">${esc(e.message)}</p></div>`; }
  }
  const go = m => { location.hash = '#/payroll?month=' + m; };

  // ----- Tham số (sheet "Tham số"): nhóm theo mục; ô tỷ lệ nhập dạng % cho dễ đọc.
  async function editParams(bonusOnly = false) {
    let s; try { s = await api('/hr/settings?month=' + st.month); } catch (e) { toast(e.message, 'err'); return; }
    const fields = bonusOnly ? s.fields.filter(f=>/^(salesAutomation|contractStar|contractLiquidation)/.test(f.key)) : s.fields;
    const groups = [...new Set(fields.map(f => f.group))];
    const val = f => f.kind === 'percent' ? +(s.params[f.key] * 100).toFixed(4) : f.kind === 'money' ? Number(s.params[f.key]).toLocaleString('vi-VN') : s.params[f.key];
    const dlg = document.createElement('dialog'); dlg.className = 'modal pr-params';
    dlg.innerHTML = `<form novalidate><div class="modal-head"><h2>${bonusOnly?'Cài đặt thưởng HĐKT':'Tham số lương'}</h2><button type="button" class="icon-btn" data-x aria-label="Đóng">×</button></div>
      <div class="modal-body"><label class="pr-eff">Áp dụng từ tháng<input type="month" name="effectiveMonth" value="${esc(st.month)}" required></label>
        <p class="muted small">Đang dùng: ${s.effectiveMonth ? 'bản áp dụng từ ' + esc(monthLabel(s.effectiveMonth).toLowerCase()) : 'mặc định theo file mẫu'}. Lưu với tháng mới để giữ nguyên các tháng trước.</p>
        ${groups.map(g => `<fieldset><legend>${esc(bonusOnly&&g==='KPI & thưởng CRM'?'Thời điểm và chế độ thưởng':g)}</legend><div class="form-grid cols-2">${fields.filter(f => f.group === g).map(f => `<label>${esc(bonusOnly&&f.key==='salesAutomationFrom'?'Tháng bắt đầu tính thưởng':bonusOnly&&f.key==='salesAutomationApply'?'Chế độ thưởng':f.label)}${f.kind === 'percent' ? ' (%)' : ''}
          ${bonusOnly&&f.key==='salesAutomationFrom'?`<input type="month" name="${f.key}" value="${s.params[f.key]?String(s.params[f.key]).replace(/^(\d{4})(\d{2})$/,'$1-$2'):''}">`:bonusOnly&&f.key==='salesAutomationApply'?`<select name="${f.key}"><option value="0" ${s.params[f.key]===0?'selected':''}>Đối chiếu — chưa cộng thực nhận</option><option value="1" ${s.params[f.key]===1?'selected':''}>Áp dụng vào thực nhận</option></select>`:`<input name="${f.key}" data-kind="${f.kind}" inputmode="decimal" value="${esc(String(val(f)))}">`}${f.note ? `<small class="muted">${esc(f.note)}</small>` : ''}</label>`).join('')}</div></fieldset>`).join('')}
        <p class="error" data-err role="alert"></p></div>
      <div class="modal-foot"><button type="button" class="btn secondary" data-x>Huỷ</button><button class="btn primary">Lưu tham số</button></div></form>`;
    document.body.append(dlg); dlg.showModal();
    dlg.querySelectorAll('[data-x]').forEach(b => b.addEventListener('click', () => dlg.close()));
    dlg.addEventListener('close', () => dlg.remove());
    dlg.querySelector('form').addEventListener('submit', async e => {
      e.preventDefault();
      const f = e.target.elements, params = {...s.params};
      for (const x of fields) {
        const raw = f.namedItem(x.key).value.trim();
        params[x.key] = bonusOnly&&x.key==='salesAutomationFrom' ? Number(raw.replace('-','')) : x.kind === 'money' ? digits(raw) : x.kind === 'percent' ? Number(raw.replace(',', '.')) / 100 : Number(raw.replace(',', '.'));
      }
      try { await api('/hr/settings', 'PUT', { effectiveMonth: f.effectiveMonth.value, params }); dlg.close(); toast('Đã lưu tham số lương.'); open(st.month); }
      catch (ex) { dlg.querySelector('[data-err]').textContent = ex.message; }
    });
  }

  // ----- Xuất Excel theo bố cục file mẫu: Tổng hợp, 3 bảng lương, Chuyển khoản.
  async function exportExcel() {
    if(withProfile().some(r=>r.payslip.snapshotUnavailable))throw new Error('Có phiếu cũ thiếu bản chụp chi tiết. Đối soát trước khi xuất Excel.');
    await new Promise((resolve, reject) => {
      if (globalThis.ExcelJS) return resolve();
      const s = Object.assign(document.createElement('script'), { src: 'exceljs.min.js', onload: resolve, onerror: () => reject(new Error('Không tải được bộ tạo Excel.')) });
      document.head.append(s);
    });
    const d = st.d, cols = d.columns, wb = new globalThis.ExcelJS.Workbook(), NAVY = 'FF102A56', m = Number(d.month.slice(5));
    const head = (ws, title, sub, n) => {
      ws.mergeCells(1, 1, 1, n); ws.getCell(1, 1).value = title; ws.getCell(1, 1).font = { bold: true, size: 14, color: { argb: NAVY } };
      ws.mergeCells(2, 1, 2, n); ws.getCell(2, 1).value = sub; ws.getCell(2, 1).font = { italic: true, color: { argb: 'FF66748A' } };
    };
    const style = (ws, headerRow, n, moneyFrom) => {
      const hr = ws.getRow(headerRow); hr.font = { bold: true, color: { argb: 'FFFFFFFF' } }; hr.alignment = { wrapText: true, vertical: 'middle', horizontal: 'center' }; hr.height = 32;
      for (let c = 1; c <= n; c++) hr.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
      ws.eachRow((row, i) => { if (i > headerRow) for (let c = moneyFrom; c <= n; c++) row.getCell(c).numFmt = '#,##0'; });
      ws.views = [{ state: 'frozen', ySplit: headerRow, xSplit: 2 }];
    };
    const sub = `Kỳ lương: Tháng ${m} / ${d.month.slice(0, 4)}`;
    const sum = wb.addWorksheet('Tổng hợp');
    head(sum, 'TỔNG HỢP LƯƠNG CÔNG TY', sub, 5);
    sum.addRow([]); sum.addRow(['Nhóm', 'Nhân sự', 'Tổng thu nhập', 'Khấu trừ', 'Thực nhận']);
    d.totals.forEach(t => sum.addRow([t.label, t.people, t.gross, t.deductions, t.net]));
    sum.addRow(['TỔNG CỘNG', ...['people', 'gross', 'deductions', 'net'].map(k => d.totals.reduce((s, t) => s + t[k], 0))]).font = { bold: true };
    sum.columns = [{ width: 24 }, { width: 10 }, { width: 18 }, { width: 16 }, { width: 18 }]; style(sum, 4, 5, 3);
    for (const g of ['sale', 'bn', 'lock']) {
      const rows = withProfile().filter(r => r.payslip.group === g), inc = cols.income[g], ded = cols.deductions[g];
      const ws = wb.addWorksheet('Lương ' + (g === 'sale' ? 'Sale' : cols.groups[g]));
      const header = ['STT', 'Họ tên', 'Vị trí', 'Ngày làm việc', ...inc.map(k => cols.labels[k]), 'Tổng thu nhập', ...ded.map(k => cols.labels[k]), 'Thực nhận', 'TK nhận lương'];
      head(ws, 'BẢNG LƯƠNG · ' + cols.groups[g].toUpperCase(), sub, header.length);
      ws.addRow([]); ws.addRow(header);
      rows.forEach((r, i) => { const p = r.payslip; ws.addRow([i + 1, r.member.name, r.profile.positionLabel, p.workDays, ...inc.map(k => line(p, k)), p.gross, ...ded.map(k => line(p, k)), p.net,
        r.profile.bankAccount ? `${r.profile.bankAccount} – ${(r.profile.bankCode || '').toUpperCase()}` : '']); });
      const totalRow = ws.addRow(['', 'TỔNG CỘNG', '', '', ...inc.map(k => rows.reduce((s, r) => s + line(r.payslip, k), 0)), rows.reduce((s, r) => s + r.payslip.gross, 0),
        ...ded.map(k => rows.reduce((s, r) => s + line(r.payslip, k), 0)), rows.reduce((s, r) => s + r.payslip.net, 0), '']); totalRow.font = { bold: true };
      ws.columns = header.map((h, i) => ({ width: i === 1 ? 26 : i === 0 ? 5 : i === header.length - 1 ? 26 : 14 })); style(ws, 4, header.length - 1, 4);
    }
    const tk = wb.addWorksheet('Chuyển khoản');
    head(tk, 'DANH SÁCH CHUYỂN KHOẢN LƯƠNG', sub, 7); tk.addRow([]);
    tk.addRow(['STT', 'Nhân viên', 'Mã ngân hàng', 'Số tài khoản', 'Tên chủ tài khoản', 'Số tiền', 'Nội dung', 'Link mã VietQR']);
    withProfile().filter(r => r.payslip.net > 0).forEach((r, i) => tk.addRow([i + 1, r.member.name, r.profile.bankCode, r.profile.bankAccount, r.profile.bankHolder, Math.round(r.payslip.net), `Luong T${m}`, r.qr]));
    tk.columns = [{ width: 5 }, { width: 26 }, { width: 12 }, { width: 18 }, { width: 24 }, { width: 14 }, { width: 12 }, { width: 60 }]; style(tk, 4, 6, 6);
    const buf = await wb.xlsx.writeBuffer(), a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    a.download = `Bang-luong-T${m}-${d.month.slice(0, 4)}.xlsx`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  // ----- Sự kiện
  root.addEventListener('click', async e => {
    const t = e.target;
    const tab = t.closest('[data-tab]'); if (tab) { st.tab = tab.dataset.tab; render(); return; }
    const mb = t.closest('[data-month]'); if (mb) { go(shiftMonth(st.month, Number(mb.dataset.month))); return; }
    const act = t.closest('[data-act]')?.dataset.act; if (!act) return;
    try {
      if (act === 'adms') await openAdms({ api, toast }, st.month);
      else if (act === 'params') await editParams();
      else if (act === 'bonus-params') await editParams(true);
      else if (act === 'excel') { await exportExcel(); toast('Đã tải file Excel bảng lương.'); }
      else if (act === 'confirm-all') {
        const n = withProfile().filter(r => r.payslip.status === 'estimate').length;
        if (!await confirmBox(`Chốt lương ${monthLabel(st.month).toLowerCase()} cho ${n} người? Số liệu được cố định; ngày công, số liệu tháng và thưởng phạt của tháng bị khoá (mở lại từng phiếu ở trang nhân viên nếu cần sửa).`, { ok: 'Chốt lương' })) return;
        const r = await api(`/hr/payroll/${st.month}/confirm`, 'POST', {confirmationHash:st.d?.confirmationHash}); toast(`Đã chốt lương ${r.confirmed} người.`); open(st.month);
      }
    } catch (ex) { toast(ex.message, 'err'); }
  });
  root.addEventListener('input', e => { if (e.target.matches('input[data-money]')) { const n = digits(e.target.value); e.target.value = n ? n.toLocaleString('vi-VN') : ''; } });
  root.addEventListener('change', e => { if (e.target.id === 'pr-month' && /^\d{4}-\d{2}$/.test(e.target.value)) go(e.target.value); });
  root.addEventListener('submit', async e => {
    if (e.target.id !== 'pr-month-form') return;
    e.preventDefault();
    const f = e.target.elements;
    try {
      await api('/hr/months/' + st.month, 'PUT', { bnRevenue: digits(f.bnRevenue.value), bnAvgRevenue: digits(f.bnAvgRevenue.value), lockRevenue: digits(f.lockRevenue.value), payQuarterBonus: !!f.payQuarterBonus?.checked });
      toast('Đã lưu số liệu chung.'); open(st.month);
    } catch (ex) { toast(ex.message, 'err'); }
  });

  return { open };
}
