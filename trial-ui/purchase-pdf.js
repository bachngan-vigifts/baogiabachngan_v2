/** PDF NCC: bố cục đơn đặt hàng khách hàng, đọc đúng snapshot giá/SL đã được phân quyền. */
import { resources } from './stock-shortage-pdf.js';
import { purchaseExportData } from './purchase-export-data.js';
import { ORDER_SIGNER_LABELS } from './order-print.js';
const amount = v => Number(v || 0).toLocaleString('vi-VN', { maximumFractionDigits: 2 });
export async function buildPurchasePdf(v, { PDFLib, fontkit, fonts }, options = {}) {
  const data = purchaseExportData(v, options), pdf = await PDFLib.PDFDocument.create(); pdf.registerFontkit(fontkit);
  const regular = await pdf.embedFont(fonts[0], { subset: true }), bold = await pdf.embedFont(fonts[1], { subset: true });
  const widths = [24, 64, 240, 28, 38, 38, 62, 34, 74, 60, 112];
  // Fit the customer-order landscape sheet without clipping any column.
  const scale = 774 / widths.reduce((a, b) => a + b, 0); widths.forEach((w, i) => { widths[i] = w * scale; });
  const starts = []; widths.reduce((x, w) => { starts.push(x); return x + w; }, 34);
  const edge = 808, black = PDFLib.rgb(.1, .1, .1), size = 8.5, lh = 11;
  let page, y;
  const text = (s, x, top, font = regular, fontSize = size) => page.drawText(String(s ?? ''), { x, y: top - fontSize, font, size: fontSize });
  function wrap(value, width, font = regular, fontSize = size) {
    const result = [];
    for (const paragraph of String(value ?? '').split(/\r?\n/)) {
      let line = '';
      for (const word of paragraph.trim().split(/\s+/)) {
        if (font.widthOfTextAtSize(line ? line + ' ' + word : word, fontSize) <= width) { line += (line ? ' ' : '') + word; continue; }
        if (line) result.push(line); line = '';
        for (const ch of word) { if (line && font.widthOfTextAtSize(line + ch, fontSize) > width) { result.push(line); line = ''; } line += ch; }
      }
      result.push(line);
    }
    return result;
  }
  const rule = top => page.drawLine({ start: { x: 34, y: top }, end: { x: edge, y: top }, thickness: .5, color: black });
  function newPage() {
    page = pdf.addPage([841.89, 595.28]); y = 564;
    const title = 'ĐƠN ĐẶT HÀNG'; text(title, (841.89 - bold.widthOfTextAtSize(title, 20)) / 2, y, bold, 20);
    y -= 48;
  }
  function tableHeader() {
    const headers = ['STT', 'Mã hàng', 'Chủng loại', 'ĐVT', 'SL đặt', 'SL giao', 'Đơn giá', 'CK %', 'Thành tiền', 'Ngày giao', 'Ghi chú'];
    const height = 28; rule(y + 3);
    headers.forEach((s, i) => {
      wrap(s, widths[i] - 6, bold).forEach((line, j) => text(line, starts[i] + 3, y - j * lh, bold));
      page.drawLine({ start: { x: starts[i], y: y + 3 }, end: { x: starts[i], y: y - height + 3 }, thickness: .5, color: black });
    });
    page.drawLine({ start: { x: edge, y: y + 3 }, end: { x: edge, y: y - height + 3 }, thickness: .5, color: black });
    y -= height; rule(y + 3);
  }
  newPage();
  const info = [
    [['Số đơn mua', data.ticketNumber], ['Số đơn NCC', data.internalNo]],
    [['Nhà cung cấp', data.supplier.name], ['Ngày đặt', data.orderDate]],
    [['Địa chỉ NCC', data.supplier.address], ['Ngày hẹn giao', data.arrivalDate]],
    [['Địa chỉ / kho nhận', data.address], ['MST NCC', data.supplier.taxCode]],
    [['Liên hệ đặt hàng', [data.contact, data.phone].filter(Boolean).join(' · ')], ['Liên hệ NCC', data.supplier.phone]],
  ];
  for (const pair of info) {
    let rows = 1;
    pair.forEach(([label, value], i) => {
      const x = i === 0 ? 34 : 460, lines = wrap(value, i === 0 ? 300 : 230);
      text(label, x, y, bold); lines.forEach((s, j) => text(s, x + 105, y - j * lh)); rows = Math.max(rows, lines.length);
    });
    y -= rows * lh + 5;
  }
  y -= 8; tableHeader();
  for (let i = 0; i < data.lines.length; i++) {
    const l = data.lines[i];
    const note = [l.note, l.printDescription, l.printFee ? `Phí in: ${amount(l.printFee)} đ/SP` : ''].filter(Boolean).join('\n');
    const values = [i + 1, l.sku, l.name, l.unit, amount(l.quantity), '', amount(l.price), amount(l.discount), amount(l.subtotal), l.promisedDate, note];
    const cells = values.map((s, j) => wrap(s, widths[j] - 6));
    const rowLines = Math.max(...cells.map(c => c.length));
    let offset = 0;
    while (offset < rowLines) {
      if (y - lh - 8 < 85) { newPage(); text('Số đơn mua: ' + data.ticketNumber, 34, y, bold); y -= 20; tableHeader(); }
      const count = Math.min(rowLines - offset, Math.max(1, Math.floor((y - 85 - 8) / lh)));
      const height = count * lh + 8;
      cells.forEach((lines, j) => {
        const visible = lines.slice(offset, offset + count);
        if (offset > 0 && j === 1) visible[0] = cells[1][0];
        visible.forEach((s, k) => {
          const x = [4, 5, 6, 7, 8].includes(j) ? starts[j] + widths[j] - 3 - regular.widthOfTextAtSize(s, size) : starts[j] + 3;
          text(s, x, y - k * lh);
        });
        page.drawLine({ start: { x: starts[j], y: y + 3 }, end: { x: starts[j], y: y - height + 3 }, thickness: .4, color: black });
      });
      page.drawLine({ start: { x: edge, y: y + 3 }, end: { x: edge, y: y - height + 3 }, thickness: .4, color: black });
      y -= height; rule(y + 3); offset += count;
    }
  }
  if (y < 165) newPage();
  y -= 8;
  text('Tổng số lượng: ' + amount(data.lines.reduce((t, l) => t + l.quantity, 0)), 34, y, bold);
  for (const [label, value] of [['Tổng cộng', data.totals.subtotal], ['Thuế VAT', data.totals.vat], ['Tổng thanh toán', data.totals.total]]) {
    text(label, 560, y, bold); const valueText = amount(value) + ' đ'; text(valueText, edge - bold.widthOfTextAtSize(valueText, size), y, bold); y -= 16;
  }
  for (const [label, value] of [['Ghi chú:', data.note], ['Thanh toán:', data.payment]]) {
    if (!value && label !== 'Ghi chú:') continue;
    if (y < 150) newPage(); text(label, 34, y, bold); y -= 14;
    for (const s of wrap(value, 774)) { if (y < 145) newPage(); text(s, 34, y); y -= lh; }
  }
  if (y < 175) newPage();
  y -= 10; text('Ngày …… tháng …… năm ……', 645, y); y -= 24;
  ORDER_SIGNER_LABELS.forEach((label, i) => {
    const x = 34 + i * 258; text(label, x + (258 - bold.widthOfTextAtSize(label, size)) / 2, y, bold);
    const name = [data.contact, data.contact, data.approver][i];
    wrap(name, 240).forEach((s, k) => text(s, x + (258 - regular.widthOfTextAtSize(s, size)) / 2, y - 65 - k * lh));
  });
  pdf.getPages().forEach((p, i, pages) => p.drawText(`${data.ticketNumber} · Trang ${i + 1}/${pages.length}`, { x: 590, y: 20, font: regular, size: 8 }));
  pdf.setTitle('Đơn đặt hàng ' + data.ticketNumber); return pdf.save();
}
/** PDF dạng base64 để máy chủ đính kèm vào email gửi NCC. */
export async function purchasePdfBase64(v) {
  const bytes = await buildPurchasePdf(v, await resources());
  let bin = ''; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export async function downloadPurchasePdf(v, options = {}) {
  const bytes = await buildPurchasePdf(v, await resources(), options), url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
  const a = document.createElement('a'); a.href = url; a.download = 'Don-mua-' + String(v.ticketNumber).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 60) + '.pdf';
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000);
}
