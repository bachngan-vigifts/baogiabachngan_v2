import { shiftSummaryRows, shiftCodRows } from './pos-report.js';
const money = (n) => Number(n || 0).toLocaleString('vi-VN') + ' đ';
const node = (doc, tag, text, cls) => {
  const n = doc.createElement(tag);
  if (text != null) n.textContent = String(text);
  if (cls) n.className = cls;
  return n;
};
/** DOM-only K80 renderer. Reprinting has no API side effects; ESC/POS can implement the same data contract later. */
export function buildPosPrint(doc, data, kind = 'bill') {
  const sheet = node(doc, 'main', null, 'pos-paper');
  const line = (label, value, strong = false) => {
    const p = node(doc, 'div', null, 'pair' + (strong ? ' strong' : ''));
    p.append(node(doc, 'span', label), node(doc, 'span', value));
    sheet.append(p);
  };
  sheet.append(
    node(doc, 'h2', data.register?.name || 'Bách Ngân'),
    node(doc, 'p', data.register?.address || '', 'center'),
  );
  if (kind === 'return') {
    const r=data.return;
    sheet.append(node(doc,'h3','PHIẾU ĐỔI / TRẢ HÀNG'),node(doc,'p',r.returnNo),node(doc,'p','Bill gốc: '+data.order.orderNo),node(doc,'p',data.order.customerName),node(doc,'p','Lý do: '+r.reason));
    for(const l of r.lines||[])line(l.name+' × '+l.requestedQty,money(l.total));
    line('Phí được duyệt hoàn',money(r.approvedServiceFee+r.approvedShippingFee));line('Giá trị trả',money(r.total),true);
    for(const f of r.refunds||[])line('Đã hoàn '+(f.method==='cash'?'tiền mặt':'chuyển khoản'),money(f.amount));
    sheet.append(node(doc,'p',r.requestContext==='before_fulfillment'?'Huỷ trước xuất: không phát sinh nhập hàng':r.receivedAt?'Đã xác nhận thực nhận hàng':'Chưa xác nhận nhận hàng'),node(doc,'p','Giá trị trả hàng không đồng nghĩa đã hoàn tiền.'));
  } else if (kind === 'shift') {
    sheet.append(node(doc, 'h3', 'BÁO CÁO KẾT CA'), node(doc, 'p', data.memberName || data.shift.memberId));
    line('Mở ca', new Date(data.shift.openedAt).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }));
    line(
      'Kết ca',
      data.shift.closedAt
        ? new Date(data.shift.closedAt).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })
        : 'ĐANG MỞ',
    );
    for (const [k, v] of [
      ...shiftSummaryRows(data),
      ['Thực đếm', data.countedCash == null ? '—' : money(data.countedCash)],
      ['Chênh lệch', data.cashDifference == null ? '—' : money(data.cashDifference)],
    ])
      line(k, v);
    if (data.differenceReason) sheet.append(node(doc, 'p', 'Lý do: ' + data.differenceReason));
    for (const a of data.bookAdjustments || [])
      sheet.append(
        node(
          doc,
          'p',
          'Điều chỉnh két: ' +
            money(a.direction === 'in' ? a.amount : -a.amount) +
            ' (không thu/chi tiền thực trong ca)',
        ),
      );
    if (data.openingCount?.count) sheet.append(node(doc, 'p', `Kiểm đếm đầu ca: đếm nhanh một phần (${data.openingCount.count} mã), không phải kiểm kê toàn kho.`));
    sheet.append(node(doc, 'h3', 'SHIP COD'));
    for (const [label, value] of shiftCodRows(data)) line(label, value);
    sheet.append(node(doc, 'p', 'COD chưa thu không nằm trong tiền két. Ca đã kết được lưu cố định.'));
  } else {
    const temporary = data.temporary === true,
      cod = data.method === 'cod',flow=data.saleFlow;
    sheet.append(
      node(
        doc,
        'h3',
        temporary ? 'BILL TẠM TÍNH - CHƯA THANH TOÁN' : flow==='deposit'?'PHIẾU ĐẶT CỌC - NHẬN HÀNG SAU':flow==='prepaid'?'ĐƠN SHIP TRẢ TRƯỚC 100%': cod ? (data.depositAmount ? (data.codAmount === 0 ? 'ĐƠN GIAO HÀNG - ĐÃ THU ĐỦ' : 'ĐƠN SHIP COD - ĐÃ THU MỘT PHẦN') : 'ĐƠN SHIP COD - CHƯA THU') : 'BILL BÁN HÀNG',
      ),
    );
    if (!temporary) line('Số đơn', data.orderNo || '');
    sheet.append(
      node(doc, 'p', new Date(data.createdAt).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })),
      node(doc, 'p', 'NV: ' + (data.memberName || '')),
    );
    const customer = typeof data.customer === 'string' ? data.customer : data.customer?.name;
    sheet.append(node(doc, 'p', 'Khách: ' + (customer || 'Khách lẻ')));
    for (const item of data.lines) {
      sheet.append(node(doc, 'p', item.name, 'item-name'));
      line(`${item.qty} ${item.unit || ''} × ${money(item.listUnitPrice)}`, money(item.listAmount));
      // discountAmount gồm cả phần voucher chia vào dòng (voucherAmount) – in tách hai dòng.
      const lineDiscount = (item.discountAmount || 0) - (item.voucherAmount || 0);
      if (lineDiscount)
        line(
          'Giảm ' + (item.discountType === 'percent' ? item.discountValue + '%' : 'theo dòng'),
          '−' + money(lineDiscount),
        );
      if (item.voucherAmount) line('Mã giảm giá (chia theo dòng)', '−' + money(item.voucherAmount));
      line('Thành tiền', money(item.total));
    }
    for (const fee of data.fees?.services ?? (data.fees?.service ? [data.fees.service] : [])) {
      if (!fee.amount) continue;
      line(fee.name + ' (trước thuế)', money(fee.subtotal));
      if (fee.quantity != null && fee.unitPrice != null) line(`${fee.quantity} × ${money(fee.unitPrice)}`, money(fee.amount));
    }
    if (data.fees?.shippingFee) line(data.fees.shipping?.taxRate ? 'Phí ship (trước thuế)' : 'Phí ship (không VAT)', money(data.fees.shipping?.subtotal ?? data.fees.shippingFee));
    sheet.append(node(doc, 'div', '', 'bill-total-separator'));
    if (data.voucher?.amount) line('Mã giảm giá' + (data.voucher.code ? ' ' + data.voucher.code : '') + (data.voucher.type === 'percent' ? ` (${data.voucher.value}%)` : ''), '−' + money(data.voucher.amount));
    line('TỔNG THÀNH TIỀN', money(data.subtotal), true);
    line('VAT', money(data.tax), true);
    line('TỔNG THANH TOÁN', money(data.total), true);
    if(data.exchangeCredit){line('Thanh toán bằng tiền đổi hàng',money(data.exchangeCredit));line('Khách trả thêm',money(data.payable));}
    if (data.note) sheet.append(node(doc, 'p', 'Ghi chú: ' + data.note, 'order-note'));
    if (temporary) sheet.append(node(doc, 'p', 'Chưa ghi thu, chưa trừ kho. Không phải hóa đơn VAT.', 'center'));
    else if(flow){
      line('Đã thực nhận',money(data.receivedAmount));line('Chuyển khoản đang chờ',money(data.pendingAmount??(data.pendingTransfer?data.initialAmount:0)));line('Còn phải thu',money(data.remaining??(data.total-(data.receivedAmount||0))),true);
      if(data.holdUntil&&!data.holdUntil.startsWith('9999'))line('Giữ hàng đến',new Date(data.holdUntil).toLocaleString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh'}));
      sheet.append(node(doc,'p',flow==='deposit'?'Mang số đơn khi nhận hàng. Chỉ xuất hàng sau khi thu đủ.':'Chỉ đóng gói/giao sau khi thực nhận đủ. COD: 0 đ.'));
      sheet.append(node(doc,'p','Chuyển khoản đang chờ chưa phải tiền đã thu. Huỷ/hoàn theo xác nhận và phê duyệt.'));
    }
    else if (cod) {
      line('Đã thu trước / tạm ứng' + (data.depositAmount ? (data.depositMethod === 'cash' ? ' (tiền mặt)' : ' (chuyển khoản)') : ''), money(data.depositAmount || 0));
      line('Còn lại thu COD', money(data.codAmount ?? data.total));
      sheet.append(node(doc, 'p', 'Phần COD chỉ ghi thu sau khi cửa hàng thực nhận tiền.'));
    }
    else {
      line('Thanh toán', data.method === 'cash' ? 'Tiền mặt' : 'Chuyển khoản đã xác nhận');
      if (data.method === 'cash') {
        line('Khách đưa', money(data.tendered));
        line('Tiền thối', money(data.change));
      }
      sheet.append(node(doc, 'p', 'ĐÃ THU TIỀN', 'center'));
    }
    sheet.append(node(doc, 'p', 'Bill không thay hóa đơn VAT. Cảm ơn quý khách!', 'center'));
  }
  return sheet;
}
export function printPos(data, kind = 'bill') {
  const frame = document.createElement('iframe');
  frame.title = 'In bill K80';
  frame.className = 'pos-print-frame';
  document.body.append(frame);
  const doc = frame.contentDocument;
  if (!doc) {
    frame.remove();
    throw new Error('Không mở được trang in.');
  }
  const style = node(
    doc,
    'style',
    '@page{size:80mm auto;margin:0}body{margin:0;font:12px Arial;color:#000;background:#fff}.pos-paper{width:72mm;padding:4mm;overflow-wrap:anywhere}h2,h3,.center{text-align:center}h2{font-size:16px}h3{font-size:13px;border-top:1px dashed;padding-top:8px}p{margin:5px 0}.pair{display:flex;justify-content:space-between;gap:8px;margin:4px 0}.pair span:last-child{text-align:right;white-space:nowrap}.bill-total-separator{border-top:1px dashed;margin-top:6px;padding-top:2px}.strong{font-weight:bold;font-size:15px}.order-note{white-space:pre-wrap;overflow-wrap:anywhere}.item-name{font-weight:bold;border-top:1px dotted;padding-top:6px}',
  );
  doc.head.append(style);
  doc.body.append(buildPosPrint(doc, data, kind));
  const win = frame.contentWindow;
  win.addEventListener('afterprint', () => frame.remove(), { once: true });
  setTimeout(() => {
    try {
      win.focus();
      win.print();
    } catch {
      frame.remove();
    }
  }, 100);
}
