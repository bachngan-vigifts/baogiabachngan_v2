// Phiếu lương in A4 dọc (lưu được PDF) – dùng ở tab "Lương & thưởng" của trang nhân viên (Manager và chính nhân viên đó).
// Số liệu do máy chủ tính (src/modules/hr/domain/payroll.ts); phiếu đã chốt in đúng từng khoản lúc chốt.
import { printSheet } from './print-page.js';
const esc = v => String(v ?? '').normalize('NFC').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const vnd = v => new Intl.NumberFormat('vi-VN').format(Math.round(Number(v) || 0));
const monthLabel = m => `${Number(m.slice(5))}/${m.slice(0, 4)}`;
const dmy = iso => iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '';

export const GROUP_LABEL = { sale: 'Sale & Văn phòng', bn: 'Bách Ngân', lock: 'Lock' };
export const STATUS_LABEL = { estimate: 'Tạm tính', confirmed: 'Đã chốt', paid: 'Đã trả' };

/** HTML phiếu lương để in. `slip` = payroll.payslip của trang chi tiết nhân viên (income / deductions là các khoản đã tính). */
export function payslipSheetHtml({ member, month, slip, standardDays, words = () => '' }) {
  const row = l => `<tr><td>${esc(l.label)}${l.note ? `<small>${esc(l.note)}</small>` : ''}</td><td class="n">${vnd(l.amount)}</td></tr>`;
  const income = slip.income.filter(l => l.amount || l.key === 'salaryByDays'), out = slip.deductions.filter(l => l.amount);
  return `<div class="slip-sheet">
    <div class="slip-top"><b>CÔNG TY TNHH SẢN XUẤT THƯƠNG MẠI BÁCH NGÂN</b><span>Bảng lương ${esc(GROUP_LABEL[slip.group] || '')}</span></div>
    <h1>PHIẾU LƯƠNG THÁNG ${esc(monthLabel(month))}</h1>
    <div class="slip-info">
      <div><span>Họ tên</span><b>${esc(member.name)}</b></div><div><span>Vị trí</span><b>${esc(slip.positionLabel || member.position || '')}</b></div>
      <div><span>Ngày công</span><b>${esc(slip.workDays)} / ${esc(standardDays)}</b></div><div><span>Tình trạng</span><b>${esc(STATUS_LABEL[slip.status] || '')}${slip.confirmedAt ? ' · chốt ' + esc(dmy(slip.confirmedAt)) : ''}</b></div>
      <div><span>Ngày in</span><b>${esc(dmy(new Date().toISOString()))}</b></div>
    </div>
    <table class="slip-table"><thead><tr><th>Khoản mục</th><th class="n">Số tiền (đ)</th></tr></thead><tbody>
      <tr class="grp"><td colspan="2">I. Thu nhập</td></tr>${income.map(row).join('')}
      <tr class="sum"><td>Tổng thu nhập</td><td class="n">${vnd(slip.gross)}</td></tr>
      <tr class="grp"><td colspan="2">II. Khấu trừ</td></tr>${out.map(row).join('') || '<tr><td colspan="2">—</td></tr>'}
      <tr class="sum"><td>Tổng khấu trừ</td><td class="n">−${vnd(slip.deductionTotal)}</td></tr>
      <tr class="net"><td>THỰC NHẬN</td><td class="n">${vnd(slip.net)}</td></tr>
    </tbody></table>
    ${words(slip.net) ? `<p class="slip-words">Bằng chữ: <i>${esc(words(slip.net))}</i></p>` : ''}
    ${slip.note ? `<p class="slip-note">Ghi chú: ${esc(slip.note)}</p>` : ''}
    <div class="slip-sign"><div><p>Người lập phiếu</p><div class="space"></div></div><div><p>Người nhận</p><div class="space"></div></div></div>
  </div>`;
}

/** In phiếu lương qua vùng in sẵn của trang (#print-sheet); tên file PDF gợi ý theo nhân viên và tháng. */
export function printPayslip(data) {
  const out = document.getElementById('print-sheet');
  out.innerHTML = payslipSheetHtml(data);
  printSheet({ clear: true, title: `Phieu-luong-${data.month}-${data.member.name}`.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').replace(/[^\w.-]+/g, '-') });
}
