// Phiếu lương: bản in (A4 dọc) và file Excel bảng lương tổng của cả công ty.
// Số liệu do máy chủ tính (src/modules/hr/domain/payroll.ts) – file này chỉ trình bày, không tính lại công thức.
const esc = v => String(v ?? '').normalize('NFC').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const vnd = v => new Intl.NumberFormat('vi-VN').format(Math.round(Number(v) || 0));
const monthLabel = m => `${Number(m.slice(5))}/${m.slice(0, 4)}`;
const dmy = iso => iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '';

export const SCHEME_LABEL = { basic: 'Lương cơ bản + hoa hồng', sale: 'Bảng lương Sale', bachngan: 'Bảng lương Bách Ngân', lock: 'Bảng lương Lock' };
export const STATUS_LABEL = { estimate: 'Tạm tính', confirmed: 'Đã chốt', paid: 'Đã trả' };

/** Dòng của phiếu: phiếu mới có sẵn `lines`; phiếu chốt trước khi có tính năng này thì dựng lại từ các số tổng. */
export function slipLines(s) {
  if (Array.isArray(s.lines) && s.lines.length) return s.lines;
  const L = [], add = (key, label, amount, type, note) => { if (amount) L.push({ key, label, amount, type, ...(note ? { note } : {}) }); };
  add('salary', 'Lương theo ngày công', s.salaryByDays, 'income', `${vnd(s.baseSalary)} × ${s.workedDays} / ${s.standardDays} công`);
  add('allowance', 'Phụ cấp cố định', s.allowance, 'income'); add('extra', 'Phụ cấp thêm', s.extraAllowance, 'income'); add('bonus', 'Thưởng', s.bonus, 'income');
  add('commission', 'Hoa hồng', s.commission, 'income', `${s.commissionRate}% × doanh số ${vnd(s.revenue)}`);
  add('deduction', 'Khấu trừ / phạt', s.deduction, 'deduction'); add('insurance', 'Bảo hiểm (NV đóng)', s.insurance, 'deduction'); add('advance', 'Tạm ứng', s.advance, 'deduction');
  return L;
}

/** HTML phiếu lương để in. `slip` = payroll.payslip của trang chi tiết nhân viên. */
export function payslipSheetHtml({ member, month, slip, words = () => '' }) {
  const lines = slipLines(slip), income = lines.filter(l => l.type === 'income'), out = lines.filter(l => l.type === 'deduction');
  const row = l => `<tr><td>${esc(l.label)}${l.note ? `<small>${esc(l.note)}</small>` : ''}</td><td class="n">${vnd(l.amount)}</td></tr>`;
  const outTotal = out.reduce((s, l) => s + l.amount, 0);
  return `<div class="slip-sheet">
    <div class="slip-top"><b>CÔNG TY TNHH SẢN XUẤT THƯƠNG MẠI BÁCH NGÂN</b><span>Phòng Kinh Doanh</span></div>
    <h1>PHIẾU LƯƠNG THÁNG ${esc(monthLabel(month))}</h1>
    <div class="slip-info">
      <div><span>Họ tên</span><b>${esc(member.name)}</b></div><div><span>Chức vụ</span><b>${esc(member.position || '')}</b></div>
      <div><span>Ngày công</span><b>${esc(slip.workedDays)} / ${esc(slip.standardDays)}</b></div><div><span>Cách tính</span><b>${esc(SCHEME_LABEL[slip.scheme] || SCHEME_LABEL.basic)}</b></div>
      <div><span>Tình trạng</span><b>${esc(STATUS_LABEL[slip.status] || '')}${slip.confirmedAt ? ' · chốt ' + esc(dmy(slip.confirmedAt)) : ''}</b></div>
      <div><span>Ngày in</span><b>${esc(dmy(new Date().toISOString()))}</b></div>
    </div>
    <table class="slip-table"><thead><tr><th>Khoản mục</th><th class="n">Số tiền (đ)</th></tr></thead><tbody>
      <tr class="grp"><td colspan="2">I. Thu nhập</td></tr>${income.map(row).join('') || '<tr><td colspan="2">—</td></tr>'}
      <tr class="sum"><td>Tổng thu nhập</td><td class="n">${vnd(slip.gross)}</td></tr>
      <tr class="grp"><td colspan="2">II. Khấu trừ</td></tr>${out.map(l => row({ ...l, amount: l.amount })).join('') || '<tr><td colspan="2">—</td></tr>'}
      <tr class="sum"><td>Tổng khấu trừ</td><td class="n">−${vnd(outTotal)}</td></tr>
      <tr class="net"><td>THỰC NHẬN</td><td class="n">${vnd(slip.net)}</td></tr>
    </tbody></table>
    ${words(slip.net) ? `<p class="slip-words">Bằng chữ: <i>${esc(words(slip.net))}</i></p>` : ''}
    ${slip.note ? `<p class="slip-note">Ghi chú: ${esc(slip.note)}</p>` : ''}
    <div class="slip-sign"><div><p>Người lập phiếu</p><div class="space"></div></div><div><p>Người nhận</p><div class="space"></div></div></div>
  </div>`;
}

/** In phiếu lương qua vùng in sẵn của trang (#print-sheet), tên file PDF gợi ý theo nhân viên và tháng. */
export function printPayslip(data) {
  const out = document.getElementById('print-sheet');
  out.innerHTML = payslipSheetHtml(data);
  const title = document.title; document.title = `Phieu-luong-${data.month}-${data.member.name}`.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').replace(/[^\w.-]+/g, '-');
  try { window.print(); } finally { document.title = title; out.innerHTML = ''; }
}

const loadExcelJs = () => new Promise((resolve, reject) => {
  if (globalThis.ExcelJS) return resolve();
  const existing = document.querySelector('script[data-exceljs]');
  if (existing) { existing.addEventListener('load', resolve, { once: true }); existing.addEventListener('error', () => reject(Error('Không tải được bộ tạo Excel.')), { once: true }); return; }
  const s = document.createElement('script'); s.dataset.exceljs = ''; s.src = 'exceljs.min.js?v=4.4.0'; s.onload = resolve;
  s.onerror = () => reject(Error('Không tải được bộ tạo Excel. Vui lòng tải lại trang.')); document.head.append(s);
});

/** Thứ tự cột các khoản; khoản lạ xếp sau theo thứ tự xuất hiện. */
const INCOME_ORDER = ['salary', 'capability', 'responsibility', 'allowance', 'reward', 'commission', 'output', 'quarter', 'bonus', 'other', 'meal', 'phone', 'attendance', 'trip', 'overtime', 'extra', 'fixed'];
const DEDUCT_ORDER = ['violation', 'deduction', 'phone-offset', 'bhxh', 'bhyt', 'tncn', 'insurance', 'advance'];
function columnsOf(rows, type, order) {
  const seen = new Map();
  for (const r of rows) for (const l of slipLines(r)) if (l.type === type && !seen.has(l.key)) seen.set(l.key, l.label);
  const rank = k => { const i = order.indexOf(k); return i < 0 ? order.length : i; };
  return [...seen].sort((a, b) => rank(a[0]) - rank(b[0])).map(([key, label]) => ({ key, label }));
}

/** File Excel bảng lương tổng: mỗi nhân viên một dòng, mỗi khoản một cột, dòng tổng cộng dùng công thức SUM. data = GET /hr/payroll/:month. */
export async function downloadPayrollExcel(data) {
  await loadExcelJs();
  const wb = new globalThis.ExcelJS.Workbook(), ws = wb.addWorksheet(`Lương T${Number(data.month.slice(5))}-${data.month.slice(0, 4)}`, {
    views: [{ state: 'frozen', xSplit: 3, ySplit: 5 }], pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });
  const inc = columnsOf(data.rows, 'income', INCOME_ORDER), ded = columnsOf(data.rows, 'deduction', DEDUCT_ORDER);
  const heads = ['STT', 'Họ tên', 'Chức vụ', 'Cách tính', 'Ngày công', ...inc.map(c => c.label), 'TỔNG THU NHẬP', ...ded.map(c => c.label), 'TỔNG KHẤU TRỪ', 'THỰC NHẬN', 'Tình trạng'];
  const n = heads.length, col = i => ws.getColumn(i).letter;
  const navy = 'FF1F2A44', teal = 'FF0F766E', rose = 'FFB4475A', green = 'FF15803D', soft = 'FFF1F5F9';
  const thin = { style: 'thin', color: { argb: 'FFD0D7E2' } }, border = { top: thin, left: thin, bottom: thin, right: thin };
  const font = (bold = false, color = 'FF000000', size = 10) => ({ name: 'Arial', size, bold, color: { argb: color } });
  const fill = argb => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });

  ws.mergeCells(1, 1, 1, n); const t = ws.getCell(1, 1); t.value = `BẢNG LƯƠNG THÁNG ${monthLabel(data.month)}`; t.font = font(true, 'FFFFFFFF', 16); t.fill = fill(navy); t.alignment = { vertical: 'middle', indent: 1 };
  ws.getRow(1).height = 32;
  ws.mergeCells(2, 1, 2, n); const s = ws.getCell(2, 1); s.value = `Bách Ngân · ${data.rows.length} nhân viên · xuất ngày ${dmy(new Date().toISOString())} · số tiền đơn vị đồng`; s.font = font(false, 'FFFFFFFF'); s.fill = fill('FF475569'); s.alignment = { indent: 1 };
  const groups = [['THÔNG TIN', 1, 5, 'FF475569'], ['THU NHẬP', 6, 5 + inc.length + 1, teal], ['KHẤU TRỪ', 6 + inc.length + 1, 5 + inc.length + 1 + ded.length + 1, rose], ['THỰC NHẬN', n - 1, n, navy]];
  for (const [label, a, b, color] of groups) {
    if (b > a) ws.mergeCells(4, a, 4, b);
    for (let c = a; c <= b; c++) ws.getCell(4, c).fill = fill(color);
    const g = ws.getCell(4, a); g.value = label; g.font = font(true, 'FFFFFFFF'); g.alignment = { horizontal: 'center' };
  }
  heads.forEach((h, i) => { const c = ws.getCell(5, i + 1); c.value = h; c.font = font(true, 'FF1F2A44', 9); c.fill = fill(soft); c.border = border; c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }; });
  ws.getRow(5).height = 40;

  const first = 6, grossCol = 6 + inc.length, dedStart = grossCol + 1, dedTotalCol = dedStart + ded.length, netCol = dedTotalCol + 1;
  data.rows.forEach((r, k) => {
    const rowNo = first + k, lines = slipLines(r), amount = (key, type) => lines.filter(l => l.key === key && l.type === type).reduce((x, l) => x + l.amount, 0);
    const vals = [k + 1, r.name, r.position, SCHEME_LABEL[r.scheme] || '', r.workedDays, ...inc.map(c => amount(c.key, 'income') || null)];
    vals.push({ formula: `SUM(${col(6)}${rowNo}:${col(grossCol - 1)}${rowNo})`, result: r.gross });
    ded.forEach(c => vals.push(amount(c.key, 'deduction') || null));
    vals.push({ formula: ded.length ? `SUM(${col(dedStart)}${rowNo}:${col(dedTotalCol - 1)}${rowNo})` : '0', result: r.deduction });
    vals.push({ formula: `${col(grossCol)}${rowNo}-${col(dedTotalCol)}${rowNo}`, result: r.net }, STATUS_LABEL[r.status] || '');
    vals.forEach((v, i) => {
      const c = ws.getCell(rowNo, i + 1); c.value = v; c.border = border; c.font = font(i + 1 === netCol || i + 1 === grossCol);
      if (i >= 5 && i + 1 < n) c.numFmt = '#,##0;[Red]-#,##0;"–"'; if (i === 4) c.numFmt = '0.0'; if (i === 0 || i === 4) c.alignment = { horizontal: 'center' };
      if (i + 1 === netCol) c.font = font(true, green);
    });
    ws.getRow(rowNo).height = 20;
  });
  const total = first + data.rows.length;
  ws.mergeCells(total, 1, total, 5); const tc = ws.getCell(total, 1); tc.value = 'TỔNG CỘNG'; tc.alignment = { horizontal: 'center' };
  for (let c = 1; c <= n; c++) {
    const cell = ws.getCell(total, c); cell.fill = fill(navy); cell.font = font(true, 'FFFFFFFF'); cell.border = border;
    if (c >= 6 && c < n) { cell.value = { formula: `SUM(${col(c)}${first}:${col(c)}${total - 1})` }; cell.numFmt = '#,##0;[Red]-#,##0;"–"'; }
  }
  ws.getRow(total).height = 24;
  ws.getColumn(1).width = 6; ws.getColumn(2).width = 28; ws.getColumn(3).width = 14; ws.getColumn(4).width = 22; ws.getColumn(5).width = 10;
  for (let c = 6; c < n; c++) ws.getColumn(c).width = 14; ws.getColumn(n).width = 12;
  ws.getColumn(grossCol).width = ws.getColumn(dedTotalCol).width = ws.getColumn(netCol).width = 16;

  const buf = await wb.xlsx.writeBuffer();
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  a.download = `Bang-luong-${data.month}.xlsx`; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
