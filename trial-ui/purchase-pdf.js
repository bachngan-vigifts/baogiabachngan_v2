/**
 * PDF ĐƠN ĐẶT HÀNG gửi NCC (tạo ở trình duyệt bằng pdf-lib, chỉ Manager / Kế toán – người thấy giá).
 * Dữ liệu: chi tiết đơn mua từ GET /purchase-orders/:id. Không ghi gì lên máy chủ.
 */
import { resources } from './stock-shortage-pdf.js';

const dmy = iso => iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '';
const vnd = v => Math.round(Number(v) || 0).toLocaleString('vi-VN');
const qty = v => Number(v || 0).toLocaleString('vi-VN', { maximumFractionDigits: 3 });

export async function buildPurchasePdf(v, { PDFLib, fontkit, fonts }) {
  if (v.priceHidden || !v.totals) throw Error('Chỉ Manager / Kế toán xuất PDF đơn mua (cần giá mua).');
  const pdf = await PDFLib.PDFDocument.create(); pdf.registerFontkit(fontkit);
  const regular = await pdf.embedFont(fonts[0], { subset: true }), bold = await pdf.embedFont(fonts[1], { subset: true });
  const grey = PDFLib.rgb(.75, .78, .82), size = 9.5, lh = 12.5;
  // STT | Mã | Tên | ĐVT | SL | Đơn giá | CK% | Thành tiền
  const widths = [26, 72, 170, 36, 44, 64, 34, 77], starts = []; widths.reduce((x, w) => { starts.push(x); return x + w; }, 36);
  let page, y;
  const write = (text, x, top, font = regular, s = size) => page.drawText(String(text ?? ''), { x, y: top - s, font, size: s });
  const right = (text, x, w, top, font = regular) => write(text, x + w - 4 - font.widthOfTextAtSize(String(text), size), top, font);
  function wrap(value, width, font = regular, s = size) {
    const out = []; let cur = '';
    for (const word of String(value ?? '').replace(/\s+/g, ' ').trim().split(' ')) {
      const next = cur ? cur + ' ' + word : word;
      if (font.widthOfTextAtSize(next, s) <= width) { cur = next; continue; }
      if (cur) out.push(cur);
      cur = '';
      for (const ch of word) { if (font.widthOfTextAtSize(cur + ch, s) > width && cur) { out.push(cur); cur = ''; } cur += ch; }
    }
    if (cur || !out.length) out.push(cur); return out;
  }
  const header = () => {
    ['STT', 'Mã hàng', 'Tên hàng', 'ĐVT', 'SL', 'Đơn giá', 'CK %', 'Thành tiền'].forEach((h, i) => (i >= 4 ? right(h, starts[i], widths[i], y, bold) : write(h, starts[i] + 3, y, bold)));
    y -= 16; page.drawLine({ start: { x: 36, y: y + 3 }, end: { x: 559, y: y + 3 }, thickness: .6, color: grey });
  };
  const newPage = () => { page = pdf.addPage([595.28, 841.89]); y = 805; };

  newPage();
  write('ĐƠN ĐẶT HÀNG', 36, y, bold, 16); right(v.ticketNumber, 400, 159, y + 2, bold); y -= 26;
  const info = [['Nhà cung cấp', v.supplier?.name], ['Mã số thuế', v.supplier?.taxCode], ['Địa chỉ', v.supplier?.address], ['Điện thoại', v.supplier?.phone],
    ['Gửi tới', [v.supplierEmail, v.ccEmail && 'CC ' + v.ccEmail].filter(Boolean).join(' · ')], ['Ngày đặt', dmy(v.approvedAt || v.createdAt)],
    ['Hẹn giao', dmy(v.arrivalDate)], ['Giao tới kho', v.warehouse], ['Ghi chú', v.note]].filter(([, val]) => val);
  for (const [k, val] of info) {
    write(k + ':', 36, y, bold);
    for (const line of wrap(val, 420)) { write(line, 130, y); y -= lh; }
    y -= 2;
  }
  y -= 8; header();
  v.lines.forEach((l, i) => {
    const cells = [String(i + 1), l.sku, l.name + (l.promisedDate ? ` (hẹn ${dmy(l.promisedDate)})` : ''), l.unit, qty(l.quantity), vnd(l.price), l.purchaseDiscount ? qty(l.purchaseDiscount) : '', vnd(l.lineTotal)];
    const lines = cells.map((c, j) => j >= 4 ? [c] : wrap(c, widths[j] - 6));
    const h = Math.max(...lines.map(x => x.length)) * lh + 6;
    if (y - h < 120) { newPage(); header(); }
    lines.forEach((ls, j) => ls.forEach((t, k) => (j >= 4 ? right(t, starts[j], widths[j], y - k * lh) : write(t, starts[j] + 3, y - k * lh))));
    y -= h; page.drawLine({ start: { x: 36, y: y + 3 }, end: { x: 559, y: y + 3 }, thickness: .4, color: grey });
  });
  if (y < 170) newPage();
  y -= 6;
  for (const [k, val, f] of [['Cộng tiền hàng', vnd(v.totals.subtotal), regular], ['Thuế GTGT', vnd(v.totals.vat), regular], ['Tổng cộng', vnd(v.totals.total), bold]]) {
    write(k, 360, y, f); right(val, 440, 119, y, f); y -= lh + 2;
  }
  if (v.schedules?.length) {
    y -= 8; write('Điều khoản thanh toán', 36, y, bold); y -= lh + 2;
    const KIND = { deposit: 'Đặt cọc', installment: 'Thanh toán đợt', balance: 'Thanh toán phần còn lại' };
    for (const s of v.schedules) { if (y < 60) newPage(); write(`• ${KIND[s.kind] || s.kind}: ${vnd(s.amount)} đ${s.dueDate ? ' – hạn ' + dmy(s.dueDate) : ''}`, 44, y); y -= lh; }
  }
  y -= 14; if (y < 60) newPage();
  write('Đề nghị nhà cung cấp xác nhận đơn hàng, ngày giao và số đơn nội bộ (nếu có).', 36, y);
  const pages = pdf.getPages(); pages.forEach((p, i) => p.drawText(`${v.ticketNumber} · Trang ${i + 1}/${pages.length}`, { x: 400, y: 25, font: regular, size: 8.5 }));
  pdf.setTitle('Đơn đặt hàng ' + v.ticketNumber);
  return pdf.save();
}

/** PDF dạng base64 để máy chủ đính kèm vào email gửi NCC. */
export async function purchasePdfBase64(v) {
  const bytes = await buildPurchasePdf(v, await resources());
  let bin = ''; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export async function downloadPurchasePdf(v) {
  const bytes = await buildPurchasePdf(v, await resources());
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
  const a = document.createElement('a'); a.href = url; a.download = 'Don-mua-' + String(v.ticketNumber).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 60) + '.pdf';
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000);
}
