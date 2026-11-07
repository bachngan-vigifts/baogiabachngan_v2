import {renderOrderReturns} from './order-return-summary.js';
const el = (tag, text = '', cls = '') => {
  const node = document.createElement(tag); node.textContent = String(text); node.className = cls; return node;
};
const num = n => new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 }).format(n);
const money = n => Number.isFinite(n) ? num(n) + ' đ' : 'Chưa có dữ liệu';
const snapshotOf = order => { try { return JSON.parse(order.posSnapshot || '{}') || {}; } catch { return {}; } };

/** Show persisted POS prices and charges. Rendering never changes the amount due. */
export function renderOrderLineDetails({ head, body, details, order, lines,returnSummary }) {
  const pos = order.channel === 'pos', snapshot = pos ? snapshotOf(order) : {};
  head.replaceChildren(); body.replaceChildren(); details.replaceChildren();
  const showReturns=!pos&&order.channel==='crm'&&!!returnSummary?.requests?.length;
  head.className = showReturns ? 'order-return-columns' : '';
  const titles = pos
    ? ['Sản phẩm / khoản phí', 'SL', 'Đã giao', 'Đơn giá gốc', 'CK', 'Giá sau CK', 'VAT', 'Thành tiền']
    : ['Sản phẩm', 'SL', 'Đã giao',...(showReturns?['Đã nhận hoàn','Nhập lại kho','Khách đang giữ']:[]), 'Đơn giá', 'VAT', 'Thành tiền'];
  for (const [i, text] of titles.entries()) head.append(el('th', text, i ? 'right' : ''));
  const cell = (tr, text, numeric = true, sub = '') => {
    const td = el('td', text, numeric ? 'right num' : '');
    if (showReturns && numeric) td.dataset.label = titles[tr.children.length];
    if (sub) td.append(el('small', sub)); tr.append(td); return td;
  };
  for (const line of lines) {
    const tr = el('tr');
    const name = cell(tr, '', false);
    if (line.sku) {
      const link = el('a', line.name); link.href = '#/products?sku=' + encodeURIComponent(line.sku);
      name.append(link);
    } else name.textContent = line.name;
    const sub = [line.sku, line.unit].filter(Boolean).join(' · ');
    if (sub) name.append(el('small', sub));
    cell(tr, num(line.qty)); cell(tr, num(line.historicalDeliveredQty??line.deliveredQty));
    if(showReturns){cell(tr,num(line.returnedQty||0));cell(tr,num(line.restockedQty||0));cell(tr,num(line.customerKeptQty??Math.max(0,line.deliveredQty-(line.returnedQty||0))));}
    if (pos) {
      // Original POS prices include VAT under the VAT policy. Never present them as net prices.
      const saved = Array.isArray(snapshot.lines) ? snapshot.lines.find(x => x && x.sku === line.sku && x.qty === line.qty && x.unitPrice === line.unitPrice) : null;
      const gross = saved && Number.isFinite(saved.total) ? saved.total : null;
      const basis = line.taxRate > 0 ? 'gồm VAT' : 'không VAT';
      cell(tr, money(line.listUnitPrice), true, basis);
      cell(tr, line.discountType === 'percent' ? num(line.discountValue) + '%' : money(line.discountValue) + ' / dòng', true, 'Giảm ' + money(line.discountAmount));
      cell(tr, gross !== null && line.qty > 0 ? money(gross / line.qty) : money(line.unitPrice), true, gross !== null ? basis : 'chưa VAT');
      cell(tr, num(line.taxRate) + '%', true, saved && Number.isFinite(saved.tax) ? money(saved.tax) : '');
      cell(tr, gross !== null ? money(gross) : money(line.amount), true, gross !== null ? basis : 'chưa VAT');
    } else {
      cell(tr, money(line.unitPrice)); cell(tr, num(line.taxRate) + '%'); cell(tr, money(line.amount));
    }
    body.append(tr);
  }
  renderOrderReturns({host:details,order,summary:returnSummary});
  if (!pos) return;
  const fees = order.posFees;
  const services = fees?.services ?? (fees?.service ? [fees.service] : []);
  for (const fee of services.filter(f => f.name || f.amount)) {
    const tr = el('tr', '', 'pos-order-fee');
    cell(tr, fee.name || 'Phí dịch vụ', false);
    cell(tr, num(fee.quantity ?? 1)); cell(tr, '—');
    cell(tr, money(fee.unitPrice ?? fee.amount), true, fee.taxRate > 0 ? 'gồm VAT' : 'không VAT');
    cell(tr, '—'); cell(tr, money(fee.unitPrice ?? fee.amount));
    cell(tr, num(fee.taxRate) + '%', true, money(fee.tax));
    cell(tr, money(fee.amount), true, fee.taxRate > 0 ? 'gồm VAT' : 'không VAT');
    body.append(tr);
  }
  if (fees?.shippingFee) {
    const tr = el('tr', '', 'pos-order-shipping');
    // Đơn từ 23/10/2026: phí ship đã gồm VAT (fees.shipping); đơn cũ không VAT.
    const ship = fees.shipping ?? { taxRate: 0, tax: 0 }, basis = ship.taxRate > 0 ? 'gồm VAT' : 'không VAT';
    cell(tr, 'Phí vận chuyển', false); cell(tr, '1'); cell(tr, '—');
    cell(tr, money(fees.shippingFee), true, basis); cell(tr, '—'); cell(tr, money(fees.shippingFee));
    cell(tr, num(ship.taxRate) + '%', true, money(ship.tax)); cell(tr, money(fees.shippingFee), true, basis);
    body.append(tr);
  }
  const totals = el('dl', '', 'kv pos-order-totals');
  const add = (label, value) => totals.append(el('dt', label), el('dd', value));
  // discountAmount của dòng gồm cả phần voucher chia vào dòng (snapshot.voucher.amount) – tách ra để đọc rõ.
  const voucher = snapshot.voucher && Number(snapshot.voucher.amount) > 0 ? snapshot.voucher : null;
  add('Tổng CK từng dòng (đã trừ trong tiền hàng)', money(lines.reduce((sum, line) => sum + (line.discountAmount || 0), 0) - (voucher ? Number(voucher.amount) : 0)));
  add('Mã giảm giá', voucher ? `${voucher.code || 'Không ghi mã'}${voucher.type === 'percent' ? ` (${num(voucher.value)}%)` : ''} · −${money(voucher.amount)} (trừ vào giá đã gồm VAT, VAT tính lại sau giảm)` : 'Không dùng mã giảm giá');
  if (Number.isFinite(snapshot.exchangeCredit) && snapshot.exchangeCredit > 0) add('Khấu trừ từ phiếu đổi hàng', money(snapshot.exchangeCredit));
  add('Tiền hàng và phí sau CK, chưa VAT', money(order.subtotal));
  add('VAT', money(order.tax));
  add('Tổng thanh toán', money(order.total));
  details.append(totals);
  if (order.note || snapshot.note) details.append(el('p', 'Ghi chú đơn hàng: ' + (order.note || snapshot.note), 'pos-order-note'));
}
