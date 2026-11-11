import { orderRecipient } from './order-notes.js';
// Bản in / tải ĐƠN ĐẶT HÀNG theo mẫu đơn của Minh Long (BM đơn đặt hàng): đầu trang công ty + "ĐƠN ĐẶT HÀNG",
// thông tin đơn, bảng hàng (STT, Mã hàng, Chủng loại, ĐVT, SL đặt, SL giao, Ngày giao, Ghi chú), tổng cộng, ghi chú và 3 chữ ký.
// Dùng chung cho xem trước (HTML), in / lưu PDF (trình duyệt) và tải Excel (exceljs).
const esc = v => String(v ?? '').normalize('NFC').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = v => new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 3 }).format(Number(v) || 0);
const unitVnd = v => new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 }).format(Number(v) || 0) + ' đ';
const vnd = v => new Intl.NumberFormat('vi-VN').format(Math.round(Number(v) || 0)) + ' đ';
export const ORDER_SIGNER_LABELS = ['Người đặt', 'Người phụ trách', 'Người phê duyệt'];
const dmy = iso => iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '';

/** Đơn vị bán theo loại báo giá / pháp nhân HĐKT. */
export const SELLERS = {
  BN: { name: 'CÔNG TY TNHH SẢN XUẤT THƯƠNG MẠI BÁCH NGÂN', short: 'CTY TNHH SX TM BÁCH NGÂN' },
  VG: { name: 'CÔNG TY TNHH SẢN XUẤT THƯƠNG MẠI QUẢNG CÁO VIGIFTS', short: 'CTY TNHH SX TM QC VIGIFTS' },
};
export const sellerOf = d => SELLERS[d.contract?.legalEntity] || (d.order.quoteType === 'VIGIFTS' ? SELLERS.VG : SELLERS.BN);
/** Pháp nhân của bản in, chốt khi lập dữ liệu: sửa tên đơn vị trên phiếu không làm đổi ảnh tiêu đề. */
const brandOf = seller => seller === SELLERS.VG.short || seller === SELLERS.VG ? 'VG' : 'BN';
const LETTERHEADS = {
  BN: { src: 'slip-letterhead.jpg', w: 1280, h: 230, cls: 'slip-letterhead', alt: 'Công ty TNHH Sản xuất Thương mại Bách Ngân — Nhà phân phối gốm sứ cao cấp Minh Long' },
  VG: { src: 'slip-letterhead-vigifts.jpg', w: 1891, h: 218, cls: 'slip-letterhead letterhead-vigifts', alt: 'Công ty TNHH Sản xuất Thương mại Quảng cáo VIGIFTS — Cung cấp quà tặng doanh nghiệp, nhà phân phối LocknLock' },
};
const letterheadImg = brand => { const l = LETTERHEADS[brand] || LETTERHEADS.BN; return `<img class="${l.cls}" src="${l.src}" width="${l.w}" height="${l.h}" alt="${l.alt}">`; };

/** Chứng từ tham chiếu: có HĐKT thì dùng số hợp đồng, đơn thường dùng số đơn. */
export function orderReference(order, contract = null) {
  const number = String(contract?.contractNo || order.contractNo || '').trim();
  return number ? { label: 'Số HĐKT', number } : { label: 'Số ĐH', number: order.orderNo };
}

/** Dữ liệu bản in (sửa được trước khi in / tải): mặc định lấy từ đơn. */
export function orderPrintData(d, me = '') {
  const o = d.order, today = new Date();
  return {
    seller: sellerOf(d).short, brand: brandOf(sellerOf(d)), department: 'Phòng Kinh Doanh', orderNo: o.orderNo, quoteNo: o.quoteNo || '', customerName: o.customerName,
    customerCode: o.customerCode ? `${o.customerCode}: ${o.customerName}` : o.customerName, taxCode: o.taxCode || '', address: o.address || '',
    contact: [o.contact, o.phone].filter(Boolean).join(' · '), orderDate: dmy(o.orderDate), expectedDeliveryDate: dmy(o.expectedDeliveryDate),
    lines: d.lines.map(l => ({ sku: l.sku, name: l.name, unit: l.unit, qty: l.qty, delivered: l.deliveredQty || 0, date: dmy(o.expectedDeliveryDate), note: '', unitPrice: l.unitPrice, taxRate: l.taxRate, amount: l.amount })),
    charges: [...((o.posFees?.services ?? (o.posFees?.service ? [o.posFees.service] : [])).filter(f => f.amount).map(f => ({ name: f.name, amount: f.subtotal, taxRate: f.taxRate }))), ...(o.posFees?.shippingFee ? [{ name: o.posFees.shipping?.taxRate ? 'Phí ship' : 'Phí ship (không VAT)', amount: o.posFees.shipping?.subtotal ?? o.posFees.shippingFee, taxRate: o.posFees.shipping?.taxRate ?? 0 }] : [])],
    subtotal: o.subtotal, tax: o.tax, total: o.total, note: o.note || '',
    signDate: `Ngày ${String(today.getDate()).padStart(2, '0')} Tháng ${String(today.getMonth() + 1).padStart(2, '0')} Năm ${today.getFullYear()}`,
    // Người đặt: tên người liên hệ của khách (không ghi tên công ty); trống thì để ký tay.
    // Mẫu đơn đặt hàng: người phê duyệt mặc định theo yêu cầu, vẫn sửa được trước khi tải.
    signers: [o.contact || '', o.ownerName || '', 'Lê Minh Thái'],
  };
}

/** HTML bản in. `edit` = các ô sửa trực tiếp (contenteditable, data-f = tên trường). */
export function orderSheetHtml(p, { prices = false, edit = false } = {}) {
  const ce = f => edit ? ` contenteditable="true" data-f="${f}"` : '';
  const head = ['STT', 'Mã hàng', 'Chủng loại', 'ĐVT', 'SL đặt', 'SL giao', ...(prices ? ['Đơn giá', 'Thành tiền'] : []), 'Ngày giao', 'Ghi chú'];
  const totalQty = p.lines.reduce((s, l) => s + Number(l.qty || 0), 0);
  return `<div class="ddh">
    ${p.brand === 'VG' ? letterheadImg('VG') : ''}
    <div class="ddh-top"><h1>ĐƠN ĐẶT HÀNG</h1></div>
    <div class="ddh-info">
      <div><span>Số ĐH</span><b${ce('orderNo')}>${esc(p.orderNo)}</b></div><div><span>Số CT</span><b${ce('quoteNo')}>${esc(p.quoteNo)}</b></div>
      <div><span>Tên khách hàng</span><b${ce('customerName')}>${esc(p.customerName)}</b></div><div><span>Ngày đặt</span><b${ce('orderDate')}>${esc(p.orderDate)}</b></div>
      <div><span>Mã khách hàng</span><b${ce('customerCode')}>${esc(p.customerCode)}</b></div><div><span>Ngày hẹn giao</span><b${ce('expectedDeliveryDate')}>${esc(p.expectedDeliveryDate)}</b></div>
      <div><span>Địa chỉ giao</span><b${ce('address')}>${esc(p.address)}</b></div><div><span>MST</span><b${ce('taxCode')}>${esc(p.taxCode)}</b></div>
      <div><span>Liên hệ</span><b${ce('contact')}>${esc(p.contact)}</b></div><div></div>
    </div>
    <table class="ddh-table"><thead><tr>${head.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>
      ${p.lines.map((l, i) => `<tr><td class="c">${i + 1}</td><td${ce(`lines.${i}.sku`)}>${esc(l.sku)}</td><td${ce(`lines.${i}.name`)}>${esc(l.name)}</td><td class="c"${ce(`lines.${i}.unit`)}>${esc(l.unit)}</td>
        <td class="n">${num(l.qty)}</td><td class="n">${l.delivered ? num(l.delivered) : ''}</td>${prices ? `<td class="n">${unitVnd(l.unitPrice)}</td><td class="n">${vnd(l.amount)}</td>` : ''}
        <td class="c"${ce(`lines.${i}.date`)}>${esc(l.date)}</td><td${ce(`lines.${i}.note`)}>${esc(l.note)}</td></tr>`).join('')}
      ${prices ? (p.charges || []).map(c => `<tr><td colspan="7">${esc(c.name)} (VAT ${num(c.taxRate)}%)</td><td class="n">${vnd(c.amount)}</td><td colspan="2"></td></tr>`).join('') : ''}
      <tr class="ddh-sum"><td colspan="4" class="c"><b>Tổng cộng</b></td><td class="n"><b>${num(totalQty)}</b></td><td></td>${prices ? `<td></td><td class="n"><b>${vnd(p.subtotal)}</b></td>` : ''}<td></td><td></td></tr>
      ${prices ? `<tr class="ddh-sum"><td colspan="7" class="n">Thuế VAT</td><td class="n">${vnd(p.tax)}</td><td colspan="2"></td></tr><tr class="ddh-sum"><td colspan="7" class="n"><b>Tổng thanh toán</b></td><td class="n"><b>${vnd(p.total)}</b></td><td colspan="2"></td></tr>` : ''}
    </tbody></table>
    <div class="ddh-note"><b>Ghi chú:</b> <span${ce('note')}>${esc(p.note)}</span></div>
    <p class="ddh-date"${ce('signDate')}>${esc(p.signDate)}</p>
    <div class="ddh-sign ddh-order-sign">${ORDER_SIGNER_LABELS.map((t, i) => `<div><b>${t}</b><div class="space"></div><span${ce(`signers.${i}`)}>${esc(p.signers[i])}</span></div>`).join('')}</div>
  </div>`;
}

/*
 * PHIẾU ĐÓNG GÓI / PHIẾU GIAO HÀNG: cùng khuôn mẫu đơn đặt hàng (đầu trang công ty, khối thông tin, bảng hàng, ghi chú, 4 chữ ký).
 * Dữ liệu bản in: { kind, seller, department, info: [[nhãn, giá trị]…], cols: [{ h, k, num?, sum? }], lines: [{…}], note, signDate, signers, names }.
 */
const toNum = v => typeof v === 'number' ? v : Number(String(v ?? '').replace(/\./g, '').replace(',', '.')) || 0;
const showNum = v => typeof v === 'number' ? (v ? num(v) : '') : String(v ?? '');
const signDateText = () => { const t = new Date(); return `Ngày ${String(t.getDate()).padStart(2, '0')} Tháng ${String(t.getMonth() + 1).padStart(2, '0')} Năm ${t.getFullYear()}`; };
export const deliverySignDate = (now = new Date()) => `Ngày …… Tháng …… Năm ${new Intl.DateTimeFormat('en', { year: 'numeric', timeZone: 'Asia/Ho_Chi_Minh' }).format(now)}`;
export const SLIP_KINDS = {
  packing: { title: 'PHIẾU ĐÓNG GÓI', file: 'Phieu-dong-goi', signers: ['Người lập phiếu', 'Thủ kho', 'Người đóng gói', 'Người kiểm tra'] },
  delivery: { title: 'PHIẾU GIAO HÀNG', file: 'Phieu-giao-hang', signers: ['ĐẠI DIỆN BÊN NHẬN', 'ĐẠI DIỆN BÊN GIAO'] },
  transfer: { title: 'PHIẾU ĐIỀU CHUYỂN KHO', file: 'Phieu-dieu-chuyen', signers: ['Người lập phiếu', 'Người nhận hàng', 'Người giao hàng', 'Người phê duyệt'] },
};
const contactOf = o => [o.contact, o.phone].filter(Boolean).join(' · ');

/**
 * Phiếu đóng gói. `order` = { orderNo, customerName, contact, phone, address, expectedDeliveryDate }, `slip` (tuỳ chọn) = phiếu đã lập,
 * `lines` = [{ sku, name, unit, qty, suggestion, cartonSize, weight }].
 */
export function packingPrintData({ seller, order, contract = null, slip = null, lines }, me = '') {
  return {
    kind: 'packing', seller, brand: brandOf(seller), department: 'Kho', docNo: slip?.slipNo || orderReference(order, contract).number,
    info: [['Số phiếu', slip?.slipNo || ''], [orderReference(order, contract).label, orderReference(order, contract).number], ['Tên khách hàng', order.customerName], ['Ngày lập', dmy(slip?.createdAt || new Date().toISOString())],
      ['Nguồn hàng', slip ? [slip.sourceLabel, slip.sourceNote].filter(Boolean).join(': ') : ''], ['Ngày giao', dmy(order.expectedDeliveryDate)],
      ['Giao tới', slip?.shipTo === 'workshop' ? `Xưởng in ${slip.shipName}` : 'Khách hàng'], ['Liên hệ', slip?.shipTo === 'workshop' ? slip.shipPhone || '' : contactOf(order)],
      ['Nhà xe', slip?.carrierName || ''], ['SĐT bác tài', slip?.carrierPhone || ''], ['Địa chỉ giao', slip?.shipAddress || order.address || '']],
    cols: [{ h: 'Mã hàng', k: 'sku' }, { h: 'Chủng loại', k: 'name' }, { h: 'ĐVT', k: 'unit', c: true }, { h: 'SL', k: 'qty', num: true, sum: true },
      { h: 'Quy cách đóng gói', k: 'spec' }, { h: 'Cân nặng (kg)', k: 'weight', num: true, sum: true }, { h: 'Ghi chú', k: 'note' }],
    lines: lines.map(l => ({ sku: l.sku || '', name: l.name, unit: l.unit || '', qty: Number(l.qty) || 0,
      spec: [l.suggestion, l.cartonSize ? `Thùng ${l.cartonSize}` : ''].filter(Boolean).join(' · '), weight: Number(l.weight) || 0, note: '' })),
    note: slip?.note || '', signDate: signDateText(), names: [slip?.createdByName || me, '', slip?.packedByName || '', ''],
  };
}

/**
 * Phiếu giao hàng. `delivery` (tuỳ chọn) = chuyến giao { deliveryNo, plannedDate, address, receiverName, receiverPhone };
 * `lines` = [{ sku, name, unit, ordered, qty }] (ordered = SL đặt, qty = SL giao chuyến này).
 */
export function deliveryPrintData({ seller, order, contract = null, delivery = null, lines }, me = '') {
  const recipient = orderRecipient(order, delivery);
  const receiver = [recipient.receiverName, recipient.receiverPhone].filter(Boolean).join(' · ');
  return {
    kind: 'delivery', seller, brand: brandOf(seller), department: 'Phòng Kinh Doanh', docNo: delivery?.deliveryNo || orderReference(order, contract).number,
    info: [['Số phiếu', delivery?.deliveryNo || ''], [orderReference(order, contract).label, orderReference(order, contract).number], ['Tên khách hàng', order.customerName], ['Người giao', delivery?.senderName || ''],
      ['Địa chỉ giao', delivery?.address || order.address || ''], ['SĐT người giao', delivery?.senderPhone || ''], ['Người nhận', receiver], ['', ''],
      ...(delivery?.carrier ? [['Nhà xe', delivery.carrier], ['SĐT bác tài', delivery.carrierPhone || '']] : [])],
    cols: [{ h: 'Mã hàng', k: 'sku' }, { h: 'Hình ảnh', k: 'imageUrl', image: true }, { h: 'Tên sản phẩm', k: 'name' }, { h: 'ĐVT', k: 'unit', c: true }, { h: 'SL đặt', k: 'ordered', num: true, sum: true },
      { h: 'SL giao', k: 'qty', num: true, sum: true }, { h: 'Ghi chú', k: 'note' }],
    lines: lines.map(l => ({ sku: l.sku || '', imageUrl: l.imageUrl || '', name: l.name, unit: l.unit || '', ordered: Number(l.ordered) || 0, qty: Number(l.qty) || 0, note: '' })),
    note: '- Phiếu bàn giao sản phẩm này cũng chính là biên bản nghiệm thu sản phẩm và được kết thúc ngay sau khi hai bên ký giao – nhận đầy đủ sản phẩm.', signDate: deliverySignDate(), names: ['', ''],
  };
}

const dmyVn = iso => iso ? new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date(iso)) : '';
/**
 * Phiếu điều chuyển kho (nhân viên mang theo khi giao hàng, kho đến đối chiếu và ký nhận). `t` = chi tiết phiếu từ GET /stock-transfers/:id.
 * Cột "SL nhận" để trống cho kho đến ghi tay; phiếu đã nhận hàng in sẵn số thực nhận và ghi chú "Thiếu …".
 */
export function transferPrintData(t, me = '') {
  const got = t.status === 'done';
  const received = l => !got || l.receivedQty == null ? '' : Number(l.receivedQty) === 0 ? '0' : Number(l.receivedQty);
  return {
    kind: 'transfer', seller: SELLERS.BN.short, brand: 'BN', department: 'Kho', docNo: t.transferNo,
    info: [['Số phiếu', t.transferNo], ['Trạng thái', t.statusLabel], ['Kho đi (xuất)', t.fromName], ['Kho đến (nhận)', t.toName],
      ['Người xin', t.requestedByName || ''], ['Ngày xin', dmyVn(t.createdAt)], ['Người duyệt', t.approvedByName || ''], ['Ngày chuyển', dmyVn(t.shippedAt)],
      ['Lý do', t.reason || ''], ['', '']],
    cols: [{ h: 'Mã hàng', k: 'sku' }, { h: 'Tên hàng', k: 'name' }, { h: 'ĐVT', k: 'unit', c: true }, { h: 'SL chuyển', k: 'qty', num: true, sum: true },
      { h: 'SL nhận', k: 'received', num: true, sum: true }, { h: 'Ghi chú', k: 'note' }],
    lines: t.lines.map(l => ({ sku: l.sku || '', name: l.name || '', unit: l.unit || '', qty: Number(l.qty) || 0, received: received(l),
      note: got && l.receivedQty != null && Number(l.receivedQty) < Number(l.qty) - 0.0005 ? `Thiếu ${num(Number(l.qty) - Number(l.receivedQty))}` : '' })),
    note: [t.shippedNote && `Kho đi: ${t.shippedNote}`, t.doneNote && `Nhận hàng: ${t.doneNote}`].filter(Boolean).join(' · '),
    signDate: deliverySignDate(), names: [t.requestedByName || me, got ? t.doneByName || '' : '', '', t.approvedByName || ''],
  };
}

/** HTML phiếu đóng gói / giao hàng (cùng kiểu mẫu đơn đặt hàng). */
export function slipSheetHtml(p, { edit = false } = {}) {
  const ce = f => edit ? ` contenteditable="true" data-f="${f}"` : '', kind = SLIP_KINDS[p.kind];
  const first = p.cols.findIndex(c => c.sum);
  return `<div class="ddh slip${p.kind === 'delivery' ? ' delivery-slip' : ''}">
    ${letterheadImg(p.brand)}
    <div class="ddh-top"><h1>${kind.title}</h1></div>
    <div class="ddh-info">${p.info.map(([label, v], i) => `<div><span>${esc(label)}</span><b${ce(`info.${i}.1`)}>${esc(v)}</b></div>`).join('')}</div>
    <table class="ddh-table">${p.kind === 'delivery' ? '<colgroup>' + [5, 12, 8, 24, 9, 12, 12, 18].map(w => `<col style="width:${w}%">`).join('') + '</colgroup>' : ''}<thead><tr><th>STT</th>${p.cols.map(c => `<th>${esc(c.h)}</th>`).join('')}</tr></thead><tbody>
      ${p.lines.map((l, i) => `<tr><td class="c">${i + 1}</td>${p.cols.map(c => c.image
        ? `<td class="c ddh-product-image">${/^(https?:\/\/|data:image\/(?:png|jpeg|gif|webp);base64,)/i.test(l[c.k] || '') ? `<img src="${esc(l[c.k])}" alt="${esc(l.name || '')}">` : ''}</td>`
        : `<td${c.num ? ' class="n"' : c.c ? ' class="c"' : ''}${ce(`lines.${i}.${c.k}`)}>${esc(c.num ? showNum(l[c.k]) : l[c.k])}</td>`).join('')}</tr>`).join('')}
      <tr class="ddh-sum"><td colspan="${first + 1}" class="c"><b>Tổng cộng</b></td>${p.cols.slice(first).map(c => c.sum
        ? `<td class="n"><b>${showNum(Math.round(p.lines.reduce((s, l) => s + toNum(l[c.k]), 0) * 10) / 10)}</b></td>` : '<td></td>').join('')}</tr>
    </tbody></table>
    <div class="ddh-note"><b>Ghi chú:</b> <span${ce('note')}>${esc(p.note)}</span></div>
    <p class="ddh-date"${ce('signDate')}>${esc(p.signDate)}</p>
    <div class="ddh-sign${p.kind === 'delivery' ? ' ddh-delivery-sign' : ''}">${kind.signers.map((t, i) => `<div><b>${t}</b><div class="space"></div><span${ce(`names.${i}`)}>${esc(p.names[i])}</span></div>`).join('')}</div>
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
  const s = document.createElement('script'); s.src = 'exceljs.min.js'; s.onload = resolve; s.onerror = () => reject(Error('Không tải được bộ tạo Excel. Vui lòng tải lại trang.')); document.head.append(s);
});

/** Tải Excel đơn đặt hàng theo đúng bố cục bản in. */
export async function downloadOrderExcel(p, { prices = false } = {}) {
  await loadExcelJs();
  const wb = new globalThis.ExcelJS.Workbook(), ws = wb.addWorksheet('Đơn đặt hàng', { pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 } } });
  const cols = [['STT', 6], ['Mã hàng', 14], ['Chủng loại', 44], ['ĐVT', 8], ['SL đặt', 10], ['SL giao', 10], ...(prices ? [['Đơn giá', 14], ['Thành tiền', 16]] : []), ['Ngày giao', 12], ['Ghi chú', 22]];
  ws.columns = cols.map(([, w]) => ({ width: w }));
  const n = cols.length, last = ws.getColumn(n).letter, thin = { style: 'thin', color: { argb: '000000' } }, border = { top: thin, left: thin, bottom: thin, right: thin };
  const put = (ref, v, st = {}) => { const c = ws.getCell(ref); c.value = v; c.font = { name: 'Arial', size: st.size || 10, bold: !!st.bold, italic: !!st.italic }; c.alignment = { vertical: 'middle', horizontal: st.align || 'left', wrapText: true }; return c; };
  ws.mergeCells(`A1:${last}2`); put('A1', 'ĐƠN ĐẶT HÀNG', { bold: true, size: 18, align: 'center' });
  const info = [['Số ĐH', p.orderNo, 'Số CT', p.quoteNo], ['Tên khách hàng', p.customerName, 'Ngày đặt', p.orderDate], ['Mã khách hàng', p.customerCode, 'Ngày hẹn giao', p.expectedDeliveryDate], ['Địa chỉ giao', p.address, 'MST', p.taxCode], ['Liên hệ', p.contact, '', '']];
  const mid = ws.getColumn(n - 2).letter, labR = ws.getColumn(n - 1).letter;
  info.forEach(([a, b, c, d], i) => {
    const r = 4 + i; put(`A${r}`, a, { bold: true }); ws.mergeCells(`A${r}:B${r}`);
    ws.mergeCells(`C${r}:${mid}${r}`); put(`C${r}`, b); put(`${labR}${r}`, c, { bold: true }); put(`${last}${r}`, d);
  });
  const hr = 4 + info.length + 1; cols.forEach(([h], i) => { const c = put(`${ws.getColumn(i + 1).letter}${hr}`, h, { bold: true, align: 'center' }); c.border = border; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'F2F2F2' } }; });
  p.lines.forEach((l, i) => {
    const r = hr + 1 + i, vals = [i + 1, l.sku, l.name, l.unit, Number(l.qty) || 0, Number(l.delivered) || null, ...(prices ? [l.unitPrice, l.amount] : []), l.date, l.note];
    vals.forEach((v, j) => { const c = put(`${ws.getColumn(j + 1).letter}${r}`, v, { align: [0, 3].includes(j) || cols[j][0] === 'Ngày giao' ? 'center' : typeof v === 'number' ? 'right' : 'left' }); c.border = border; if (typeof v === 'number' && j >= 4) c.numFmt = j === 6 && prices ? '#,##0.## "đ"' : j === 7 && prices ? '#,##0 "đ"' : '#,##0.###'; });
  });
  let r = hr + 1 + p.lines.length;
  if (prices) for (const charge of p.charges || []) {
    ws.mergeCells(`A${r}:G${r}`); put(`A${r}`, charge.name + ' (VAT ' + charge.taxRate + '%)');
    const c = put(`H${r}`, charge.amount, { align: 'right' }); c.numFmt = '#,##0 \"đ\"'; r++;
  }
  ws.mergeCells(`A${r}:D${r}`); put(`A${r}`, 'Tổng cộng', { bold: true, align: 'center' });
  const tq = put(`E${r}`, p.lines.reduce((s, l) => s + Number(l.qty || 0), 0), { bold: true, align: 'right' }); tq.numFmt = '#,##0.###';
  if (prices) { const c = put(`H${r}`, p.subtotal, { bold: true, align: 'right' }); c.numFmt = '#,##0 "đ"'; }
  for (let j = 1; j <= n; j++) ws.getCell(`${ws.getColumn(j).letter}${r}`).border = border;
  if (prices) for (const [label, v] of [['Thuế VAT', p.tax], ['Tổng thanh toán', p.total]]) { r++; ws.mergeCells(`A${r}:G${r}`); put(`A${r}`, label, { bold: true, align: 'right' }); const c = put(`H${r}`, v, { bold: true, align: 'right' }); c.numFmt = '#,##0 "đ"'; }
  r += 2; put(`A${r}`, 'Ghi chú:', { bold: true }); ws.mergeCells(`B${r}:${last}${r}`); put(`B${r}`, p.note);
  r += 2; ws.mergeCells(`${ws.getColumn(n - 3).letter}${r}:${last}${r}`); put(`${ws.getColumn(n - 3).letter}${r}`, p.signDate, { italic: true, align: 'center' });
  r += 1; const spots = [1, Math.floor(n / 2), n - 1];
  ORDER_SIGNER_LABELS.forEach((t, i) => { put(`${ws.getColumn(spots[i]).letter}${r}`, t, { bold: true, align: 'center' }); put(`${ws.getColumn(spots[i]).letter}${r + 4}`, p.signers[i], { align: 'center' }); });
  const buf = await wb.xlsx.writeBuffer();
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  a.download = `Don-dat-hang-${p.orderNo}.xlsx`.replace(/[^\w.-]+/g, '-'); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
