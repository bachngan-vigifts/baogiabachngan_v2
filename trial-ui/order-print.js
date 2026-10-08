// Bản in / tải ĐƠN ĐẶT HÀNG theo mẫu đơn của Minh Long (BM đơn đặt hàng): đầu trang công ty + "ĐƠN ĐẶT HÀNG",
// thông tin đơn, bảng hàng (STT, Mã hàng, Chủng loại, ĐVT, SL đặt, SL giao, Ngày giao, Ghi chú), tổng cộng, ghi chú và 4 chữ ký.
// Dùng chung cho xem trước (HTML), in / lưu PDF (trình duyệt) và tải Excel (exceljs).
const esc = v => String(v ?? '').normalize('NFC').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = v => new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 3 }).format(Number(v) || 0);
const vnd = v => new Intl.NumberFormat('vi-VN').format(Math.round(Number(v) || 0)) + ' đ';
const dmy = iso => iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '';

/** Đơn vị bán theo loại báo giá / pháp nhân HĐKT. */
export const SELLERS = {
  BN: { name: 'CÔNG TY TNHH SẢN XUẤT THƯƠNG MẠI BÁCH NGÂN', short: 'CTY TNHH SX TM BÁCH NGÂN' },
  VG: { name: 'CÔNG TY TNHH SẢN XUẤT THƯƠNG MẠI QUẢNG CÁO VIGIFTS', short: 'CTY TNHH SX TM QC VIGIFTS' },
};
export const sellerOf = d => SELLERS[d.contract?.legalEntity] || (d.order.quoteType === 'VIGIFTS' ? SELLERS.VG : SELLERS.BN);

/** Dữ liệu bản in (sửa được trước khi in / tải): mặc định lấy từ đơn. */
export function orderPrintData(d, me = '') {
  const o = d.order, today = new Date();
  return {
    seller: sellerOf(d).short, department: 'Phòng Kinh Doanh', orderNo: o.orderNo, quoteNo: o.quoteNo || '', customerName: o.customerName,
    customerCode: o.customerCode ? `${o.customerCode}: ${o.customerName}` : o.customerName, taxCode: o.taxCode || '', address: o.address || '',
    contact: [o.contact, o.phone].filter(Boolean).join(' · '), orderDate: dmy(o.orderDate),
    lines: d.lines.map(l => ({ sku: l.sku, name: l.name, unit: l.unit, qty: l.qty, delivered: l.deliveredQty || 0, date: dmy(o.expectedDeliveryDate), note: '', unitPrice: l.unitPrice, taxRate: l.taxRate, amount: l.amount })),
    subtotal: o.subtotal, tax: o.tax, total: o.total, note: o.note || '',
    signDate: `Ngày ${String(today.getDate()).padStart(2, '0')} Tháng ${String(today.getMonth() + 1).padStart(2, '0')} Năm ${today.getFullYear()}`,
    // Người đặt: tên người liên hệ của khách (không ghi tên công ty); trống thì để ký tay.
    signers: [o.contact || '', '', o.ownerName || '', me],
  };
}

/** HTML bản in. `edit` = các ô sửa trực tiếp (contenteditable, data-f = tên trường). */
export function orderSheetHtml(p, { prices = false, edit = false } = {}) {
  const ce = f => edit ? ` contenteditable="true" data-f="${f}"` : '';
  const head = ['STT', 'Mã hàng', 'Chủng loại', 'ĐVT', 'SL đặt', 'SL giao', ...(prices ? ['Đơn giá', 'Thành tiền'] : []), 'Ngày giao', 'Ghi chú'];
  const totalQty = p.lines.reduce((s, l) => s + Number(l.qty || 0), 0);
  return `<div class="ddh">
    <div class="ddh-top"><div class="ddh-co"><b${ce('seller')}>${esc(p.seller)}</b><span${ce('department')}>${esc(p.department)}</span></div><h1>ĐƠN ĐẶT HÀNG</h1><div></div></div>
    <div class="ddh-info">
      <div><span>Số ĐH</span><b${ce('orderNo')}>${esc(p.orderNo)}</b></div><div><span>Số CT</span><b${ce('quoteNo')}>${esc(p.quoteNo)}</b></div>
      <div><span>Tên khách hàng</span><b${ce('customerName')}>${esc(p.customerName)}</b></div><div><span>Ngày đặt</span><b${ce('orderDate')}>${esc(p.orderDate)}</b></div>
      <div><span>Mã khách hàng</span><b${ce('customerCode')}>${esc(p.customerCode)}</b></div><div><span>MST</span><b${ce('taxCode')}>${esc(p.taxCode)}</b></div>
      <div><span>Địa chỉ giao</span><b${ce('address')}>${esc(p.address)}</b></div><div><span>Liên hệ</span><b${ce('contact')}>${esc(p.contact)}</b></div>
    </div>
    <table class="ddh-table"><thead><tr>${head.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>
      ${p.lines.map((l, i) => `<tr><td class="c">${i + 1}</td><td${ce(`lines.${i}.sku`)}>${esc(l.sku)}</td><td${ce(`lines.${i}.name`)}>${esc(l.name)}</td><td class="c"${ce(`lines.${i}.unit`)}>${esc(l.unit)}</td>
        <td class="n">${num(l.qty)}</td><td class="n">${l.delivered ? num(l.delivered) : ''}</td>${prices ? `<td class="n">${vnd(l.unitPrice)}</td><td class="n">${vnd(l.amount)}</td>` : ''}
        <td class="c"${ce(`lines.${i}.date`)}>${esc(l.date)}</td><td${ce(`lines.${i}.note`)}>${esc(l.note)}</td></tr>`).join('')}
      <tr class="ddh-sum"><td colspan="4" class="c"><b>Tổng cộng</b></td><td class="n"><b>${num(totalQty)}</b></td><td></td>${prices ? `<td></td><td class="n"><b>${vnd(p.subtotal)}</b></td>` : ''}<td></td><td></td></tr>
      ${prices ? `<tr class="ddh-sum"><td colspan="7" class="n">Thuế VAT</td><td class="n">${vnd(p.tax)}</td><td colspan="2"></td></tr><tr class="ddh-sum"><td colspan="7" class="n"><b>Tổng thanh toán</b></td><td class="n"><b>${vnd(p.total)}</b></td><td colspan="2"></td></tr>` : ''}
    </tbody></table>
    <div class="ddh-note"><b>Ghi chú:</b> <span${ce('note')}>${esc(p.note)}</span></div>
    <p class="ddh-date"${ce('signDate')}>${esc(p.signDate)}</p>
    <div class="ddh-sign">${['Người đặt', 'Người tiếp nhận', 'Người phụ trách', 'Người soạn'].map((t, i) => `<div><b>${t}</b><div class="space"></div><span${ce(`signers.${i}`)}>${esc(p.signers[i])}</span></div>`).join('')}</div>
  </div>`;
}

/** Ghi các ô đã sửa (contenteditable) trở lại dữ liệu bản in. */
export function readEdits(root, p) {
  for (const el of root.querySelectorAll('[data-f]')) {
    const path = el.dataset.f.split('.'), v = el.innerText.trim();
    let o = p; for (const k of path.slice(0, -1)) o = o[k];
    o[path.at(-1)] = v;
  }
  return p;
}

const loadExcelJs = () => new Promise((resolve, reject) => {
  if (globalThis.ExcelJS) return resolve();
  const s = document.createElement('script'); s.src = 'exceljs.min.js?v=4.4.0'; s.onload = resolve; s.onerror = () => reject(Error('Không tải được bộ tạo Excel. Vui lòng tải lại trang.')); document.head.append(s);
});

/** Tải Excel đơn đặt hàng theo đúng bố cục bản in. */
export async function downloadOrderExcel(p, { prices = false } = {}) {
  await loadExcelJs();
  const wb = new globalThis.ExcelJS.Workbook(), ws = wb.addWorksheet('Đơn đặt hàng', { pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 } } });
  const cols = [['STT', 6], ['Mã hàng', 14], ['Chủng loại', 44], ['ĐVT', 8], ['SL đặt', 10], ['SL giao', 10], ...(prices ? [['Đơn giá', 14], ['Thành tiền', 16]] : []), ['Ngày giao', 12], ['Ghi chú', 22]];
  ws.columns = cols.map(([, w]) => ({ width: w }));
  const n = cols.length, last = ws.getColumn(n).letter, thin = { style: 'thin', color: { argb: '000000' } }, border = { top: thin, left: thin, bottom: thin, right: thin };
  const put = (ref, v, st = {}) => { const c = ws.getCell(ref); c.value = v; c.font = { name: 'Arial', size: st.size || 10, bold: !!st.bold, italic: !!st.italic }; c.alignment = { vertical: 'middle', horizontal: st.align || 'left', wrapText: true }; return c; };
  ws.mergeCells('A1:C1'); put('A1', p.seller, { bold: true, align: 'center' });
  ws.mergeCells('A2:C2'); put('A2', p.department, { align: 'center' });
  ws.mergeCells(`D1:${ws.getColumn(n - 2).letter}2`); put('D1', 'ĐƠN ĐẶT HÀNG', { bold: true, size: 18, align: 'center' });
  const info = [['Số ĐH', p.orderNo, 'Số CT', p.quoteNo], ['Tên khách hàng', p.customerName, 'Ngày đặt', p.orderDate], ['Mã khách hàng', p.customerCode, 'MST', p.taxCode], ['Địa chỉ giao', p.address, 'Liên hệ', p.contact]];
  const mid = ws.getColumn(n - 2).letter, labR = ws.getColumn(n - 1).letter;
  info.forEach(([a, b, c, d], i) => {
    const r = 4 + i; put(`A${r}`, a, { bold: true }); ws.mergeCells(`A${r}:B${r}`);
    ws.mergeCells(`C${r}:${mid}${r}`); put(`C${r}`, b); put(`${labR}${r}`, c, { bold: true }); put(`${last}${r}`, d);
  });
  const hr = 9; cols.forEach(([h], i) => { const c = put(`${ws.getColumn(i + 1).letter}${hr}`, h, { bold: true, align: 'center' }); c.border = border; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'F2F2F2' } }; });
  p.lines.forEach((l, i) => {
    const r = hr + 1 + i, vals = [i + 1, l.sku, l.name, l.unit, Number(l.qty) || 0, Number(l.delivered) || null, ...(prices ? [l.unitPrice, l.amount] : []), l.date, l.note];
    vals.forEach((v, j) => { const c = put(`${ws.getColumn(j + 1).letter}${r}`, v, { align: [0, 3].includes(j) || cols[j][0] === 'Ngày giao' ? 'center' : typeof v === 'number' ? 'right' : 'left' }); c.border = border; if (typeof v === 'number' && j >= 4) c.numFmt = j >= 6 && prices && j <= 7 ? '#,##0 "đ"' : '#,##0.###'; });
  });
  let r = hr + 1 + p.lines.length;
  ws.mergeCells(`A${r}:D${r}`); put(`A${r}`, 'Tổng cộng', { bold: true, align: 'center' });
  const tq = put(`E${r}`, p.lines.reduce((s, l) => s + Number(l.qty || 0), 0), { bold: true, align: 'right' }); tq.numFmt = '#,##0.###';
  if (prices) { const c = put(`H${r}`, p.subtotal, { bold: true, align: 'right' }); c.numFmt = '#,##0 "đ"'; }
  for (let j = 1; j <= n; j++) ws.getCell(`${ws.getColumn(j).letter}${r}`).border = border;
  if (prices) for (const [label, v] of [['Thuế VAT', p.tax], ['Tổng thanh toán', p.total]]) { r++; ws.mergeCells(`A${r}:G${r}`); put(`A${r}`, label, { bold: true, align: 'right' }); const c = put(`H${r}`, v, { bold: true, align: 'right' }); c.numFmt = '#,##0 "đ"'; }
  r += 2; put(`A${r}`, 'Ghi chú:', { bold: true }); ws.mergeCells(`B${r}:${last}${r}`); put(`B${r}`, p.note);
  r += 2; ws.mergeCells(`${ws.getColumn(n - 3).letter}${r}:${last}${r}`); put(`${ws.getColumn(n - 3).letter}${r}`, p.signDate, { italic: true, align: 'center' });
  r += 1; const spots = [1, 3, n - 3, n - 1];
  ['Người đặt', 'Người tiếp nhận', 'Người phụ trách', 'Người soạn'].forEach((t, i) => { put(`${ws.getColumn(spots[i]).letter}${r}`, t, { bold: true, align: 'center' }); put(`${ws.getColumn(spots[i]).letter}${r + 4}`, p.signers[i], { align: 'center' }); });
  const buf = await wb.xlsx.writeBuffer();
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  a.download = `Don-dat-hang-${p.orderNo}.xlsx`.replace(/[^\w.-]+/g, '-'); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
