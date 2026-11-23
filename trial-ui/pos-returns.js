import { printPos } from './pos-print.js';
import { verifyBox } from './verify.js';
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = String(text);
  return n;
};
const money = (n) => Number(n || 0).toLocaleString('vi-VN') + ' đ';
const status = {
  pending: 'Chờ duyệt',
  approved: 'Đã duyệt · Chờ nhận hàng',
  processing: 'Đang xử lý',
  completed: 'Hoàn tất',
  rejected: 'Đã từ chối',
  cancelled: 'Đã huỷ',
};
const field = (label, type = 'text', value = '') => {
  const box = el('label', 'pos-field'),
    input = el('input');
  input.type = type;
  input.value = value;
  if (type === 'number') {
    input.min = '0';
    input.step = '1';
    input.inputMode = 'numeric';
  }
  box.append(el('span', '', label), input);
  return { box, input };
};
const select = (items) => {
  const n = el('select');
  for (const [value, text] of items) {
    const o = el('option', '', text);
    o.value = value;
    n.append(o);
  }
  return n;
};
const ORDER_STATUS = { draft: 'Nháp', confirmed: 'Đã xác nhận', delivering: 'Đang giao', delivered: 'Đã giao', cancelled: 'Đã huỷ', completed: 'Hoàn tất' };
const PAY_METHOD = { cash: 'Tiền mặt', transfer: 'Chuyển khoản', card: 'Quẹt thẻ', cod: 'Thu hộ COD (giao hàng)', mixed: 'Nhiều hình thức' };
const qtyText = (n) => Number(n || 0).toLocaleString('vi-VN', { maximumFractionDigits: 3 });
/** Xem nhanh bill gốc trong màn trả hàng. Chỉ đọc dữ liệu đã tải (cùng quyền với màn trả hàng); không gọi API ghi. */
export function openBillPreview(d, { open = (url) => window.open(url, '_blank', 'noopener') } = {}) {
  const o = d.order || {}, snap = (() => { try { return JSON.parse(o.posSnapshot || '{}'); } catch { return {}; } })();
  const fees = snap.fees || {}, ship = Number(fees.shippingFee ?? fees.shipping?.amount ?? 0), service = Number(fees.service?.amount ?? 0);
  const dlg = el('dialog', 'pos-modal pos-bill-preview'), box = el('div', 'pos-modal-content'), head = el('div', 'pos-return-head');
  dlg.setAttribute('aria-label', 'Chi tiết bill ' + (o.orderNo || ''));
  const close = el('button', 'btn secondary', 'Đóng'); close.type = 'button'; close.onclick = () => dlg.close();
  head.append(el('h2', '', 'Bill ' + (o.orderNo || '')), close);
  const info = el('dl', 'pos-bill-info');
  const row = (label, value) => { if (value === '' || value == null) return; info.append(el('dt', '', label), el('dd', '', value)); };
  row('Ngày bán', String(o.orderDate || o.createdAt || '').slice(0, 10).split('-').reverse().join('/'));
  row('Trạng thái', ORDER_STATUS[o.status] || o.status);
  row('Quầy', d.registerName);
  row('Khách hàng', o.customerName);
  row('Điện thoại', o.phone);
  row('Người nhận', [o.receiverName, o.receiverPhone].filter(Boolean).join(' · '));
  row('Địa chỉ giao', o.deliveryAddress || o.address);
  row('Thanh toán', PAY_METHOD[snap.method] || snap.method);
  if (snap.ghn?.fee != null) row('Phí GHN tính cho shop', money(snap.ghn.fee));
  if (snap.ghn?.expectedDelivery) row('GHN hẹn giao', String(snap.ghn.expectedDelivery).slice(0, 10).split('-').reverse().join('/'));
  row('Ghi chú', o.note);
  const table = el('table', 'pos-bill-lines'), thead = el('thead'), tbody = el('tbody'), hr = el('tr');
  for (const t of ['Mã / tên hàng', 'SL', 'Đơn giá', 'Thành tiền', 'Đã giao']) hr.append(el('th', '', t));
  thead.append(hr); table.append(thead, tbody);
  for (const l of d.lines || []) {
    const tr = el('tr'), name = el('td');
    name.append(el('strong', '', l.sku || ''), el('span', '', l.name || ''));
    const cell = (label, text) => { const td = el('td', 'num', text); td.dataset.label = label; return td; };
    tr.append(name, cell('SL', qtyText(l.qty) + (l.unit ? ' ' + l.unit : '')), cell('Đơn giá', money(l.unitPrice)), cell('Thành tiền', money(l.amount)), cell('Đã giao', qtyText(l.deliveredQty)));
    tbody.append(tr);
  }
  const wrap = el('div', 'pos-bill-lines-wrap'); wrap.append(table);
  const totals = el('div', 'pos-return-summary');
  for (const [label, value] of [['Tiền hàng + phí trước VAT', o.subtotal], ...(service ? [['Phí dịch vụ (gồm VAT)', service]] : []), ...(ship ? [['Phí ship thu khách', ship]] : []), ['VAT', o.tax], ['Tổng bill', o.total], ['Còn phải thu', Math.max(0, d.account?.balance ?? 0)]])
    totals.append(el('span', '', label), el('strong', '', money(value)));
  const full = el('button', 'btn secondary', 'Mở trang đơn hàng đầy đủ (tab mới)'); full.type = 'button';
  full.onclick = () => open(location.pathname + location.search + '#/orders/' + encodeURIComponent(o.id));
  box.append(head, info, wrap, totals, full); dlg.append(box); document.body.append(dlg);
  dlg.addEventListener('close', () => dlg.remove(), { once: true });
  dlg.showModal(); return dlg;
}
/**
 * Phí dịch vụ / phí ship đã tính cho khách trên bill mà chưa có yêu cầu hoàn nào (đang chờ / đã duyệt) giữ.
 * Dùng làm mặc định khi trả / thu hồi TOÀN BỘ hàng còn lại; máy chủ vẫn kiểm lại không vượt phí gốc.
 */
export function remainingPosFees(order, returns = []) {
  let fees = {};
  try { fees = JSON.parse(order?.posSnapshot || '{}').fees || {}; } catch { fees = {}; }
  const active = returns.filter((r) => !['cancelled', 'rejected'].includes(r.status));
  const used = (k) => active.reduce((n, r) => n + Number(r[k] || 0), 0);
  return {
    service: Math.max(0, Math.round(Number(fees.service?.amount || 0) - used('requestedServiceFee'))),
    shipping: Math.max(0, Math.round(Number(fees.shippingFee ?? fees.shipping?.amount ?? 0) - used('requestedShippingFee'))),
  };
}
/** Trả hết phần còn lại của bill (mọi dòng còn được trả đều nhập đủ số lượng) thì hoàn luôn phí. */
export function returnsEverything(rows) {
  return rows.length > 0 && rows.every((x) => Number(x.qty.value) >= Number(x.left) - 1e-9);
}
/** Linked POS returns only; every amount/state transition is checked again by the API. */
export async function openPosReturns({
  api,
  toast,
  confirmBox = async (message, options) => !!(await verifyBox({
    title: options.title,
    intro: message,
    ok: options.ok,
    onMount: dlg => { dlg.querySelector('.btn.secondary[data-x]').textContent = 'Huỷ'; },
  })),
  shift,
  register,
  orderId = '',
  cartTotal = 0,
  onExchange = () => {},
  onChanged = () => {},
  onClose = () => {},
}) {
  const dlg = el('dialog', 'pos-modal pos-return-modal'),
    body = el('div', 'pos-modal-content'),
    content = el('div'),
    head = el('div', 'pos-return-head');
  const close = el('button', 'btn secondary', 'Đóng');
  close.type = 'button';
  close.onclick = () => dlg.close();
  head.append(el('h2', '', 'Trả hàng · Đổi hàng · Hoàn tiền'), close);
  body.append(head, content);
  dlg.append(body);
  document.body.append(dlg);
  dlg.addEventListener('close', () => { dlg.remove(); onClose(); }, { once: true });
  dlg.addEventListener('cancel', (e) => { if (dlg.dataset.busy) e.preventDefault(); });
  dlg.showModal();
  const safe = (fn) => async () => {
    if (dlg.dataset.busy) return;
    dlg.dataset.busy = '1';
    const buttons = [...dlg.querySelectorAll('button')];
    buttons.forEach((b) => (b.disabled = true));
    try {
      await fn();
    } catch (e) {
      toast(e.message, 'err');
    } finally {
      delete dlg.dataset.busy;
      buttons.forEach((b) => (b.disabled = false));
    }
  };
  const button = (label, fn, cls = 'btn secondary') => {
    const b = el('button', cls, label);
    b.type = 'button';
    b.onclick = safe(fn);
    return b;
  };
  async function home() {
    content.replaceChildren();
    const search = field('Tìm bill gốc theo số đơn, khách hoặc điện thoại');
    search.input.placeholder = 'Ví dụ: POS_20261019_002';
    const results = el('div', 'pos-return-search-results');
    content.append(search.box, results, el('h3', '', 'Yêu cầu gần đây'));
    let seq = 0;
    search.input.oninput = async () => {
      const turn = ++seq,
        q = search.input.value.trim();
      results.replaceChildren();
      if (!q) return;
      try {
        const d = await api(
          '/pos/orders?registerId=' +
            encodeURIComponent(register?.id || '') +
            '&q=' +
            encodeURIComponent(q),
        );
        if (seq !== turn || !dlg.open) return;
        for (const o of (d.orders || [])
          .filter((o) => !o.external)
          .slice(0, 12))
          results.append(
            button(o.orderNo + ' · ' + o.customerName, () => show(o.id)),
          );
        if (!results.children.length)
          results.append(el('p', 'pos-note', 'Không có bill POS phù hợp.'));
      } catch (e) {
        toast(e.message, 'err');
      }
    };
    const d = await api('/pos/returns');
    if (!dlg.open) return;
    const list = el('div', 'pos-return-list');
    for (const r of d.returns || [])
      list.append(
        button(
          r.returnNo +
            ' · ' +
            r.orderNo +
            ' · ' +
            status[r.status] +
            ' · ' +
            money(r.total),
          () => show(r.orderId),
        ),
      );
    if (!list.children.length)
      list.append(el('p', 'pos-note', 'Chưa có yêu cầu trả hàng.'));
    content.append(list);
  }
  // Ca đang mở của quầy bill: trang đơn hàng chỉ biết ca của quầy mặc định, nên khi khác quầy thì hỏi đúng quầy của bill
  // (máy chủ vẫn kiểm tra ca khi gửi). Không có ca / không được dùng quầy đó → giữ nguyên, form lập yêu cầu ẩn kèm lời nhắc.
  const billShifts = new Map();
  async function shiftOf(registerId) {
    if (shift?.registerId === registerId) return shift;
    if (!billShifts.has(registerId))
      billShifts.set(registerId, await api('/pos/options?registerId=' + encodeURIComponent(registerId))
        .then((o) => (o.current?.registerId === registerId && !o.current.closedAt ? o.current : null))
        .catch(() => null));
    return billShifts.get(registerId) || shift;
  }
  async function show(id) {
    const d = await api('/pos/returns?orderId=' + encodeURIComponent(id));
    if (!dlg.open) return;
    if (d.registerId) shift = await shiftOf(d.registerId);
    if (!dlg.open) return;
    content.replaceChildren();
    content.append(
      button('‹ Danh sách yêu cầu', home),
      (() => {
        const h = el('h3', 'pos-return-bill-title'), link = el('button', 'pos-bill-link', d.order.orderNo);
        link.type = 'button'; link.title = 'Xem nhanh chi tiết bill ' + d.order.orderNo;
        link.onclick = () => openBillPreview(d);
        h.append(link, el('span', '', ' · ' + d.order.customerName));
        return h;
      })(),
    );
    const summary = el('div', 'pos-return-summary');
    for (const [label, value] of [
      ['Bill gốc', d.order.total],
      ['Giá trị hàng/phí đã trả', d.account.credit],
      ['Đã hoàn thực tế', d.account.refunded],
      ['Đã dùng đổi hàng', d.account.exchanged],
      ['Còn phải thu', Math.max(0, d.account.balance)],
      ['Còn được hoàn/đổi', d.account.available],
    ])
      summary.append(el('span', '', label), el('strong', '', money(value)));
    content.append(summary);
    for (const r of d.returns) {
      const card = el('section', 'pos-return-card');
      card.append(
        el('h3', '', r.returnNo + ' · ' + status[r.status]),
        el('p', '', r.reason),
        ...(r.requestContext==='before_fulfillment'?[el('p','pos-note','Huỷ trước xuất: không có hàng cần nhập lại. Chỉ xác nhận thực hoàn tiền sau khi duyệt.')]:[]),
      );
      for (const l of r.lines)
        card.append(
          el(
            'p',
            '',
            l.name +
              ' × ' +
              l.requestedQty +
              ' · ' +
              money(l.total) +
              ' · ' +
              (l.disposition === 'damaged' ? 'Hàng hỏng' : 'Nhập lại bán được'),
          ),
        );
      const hasRequestedFees = Number(r.requestedServiceFee) > 0 || Number(r.requestedShippingFee) > 0;
      card.append(
        el(
          'p',
          'pos-note',
          hasRequestedFees
            ? 'Phí đề nghị: dịch vụ ' + money(r.requestedServiceFee) + ', ship ' + money(r.requestedShippingFee)
            : 'Không đề nghị hoàn phí',
        ),
      );
      if (r.status !== 'pending') card.append(el('p', 'pos-note', 'Phí được duyệt hoàn: ' + money(r.approvedServiceFee + r.approvedShippingFee)));
      if (r.status === 'pending' && hasRequestedFees && !d.manager) card.append(el('p', 'pos-note', 'Chỉ Manager được hoàn phí dịch vụ/ship'));
      const controls = el('div', 'pos-return-actions');
      if (
        r.status === 'pending' &&
        d.canApprove &&
        (r.createdBy !== d.viewerId || d.manager)
      ) {
        // Manager: mặc định duyệt đúng phí nhân viên đã đề nghị (có thể giảm). Người được chỉ định không duyệt phí.
        const service = field('Phí dịch vụ được hoàn', 'number', d.manager ? r.requestedServiceFee || 0 : 0),
          shipping = field('Phí ship được hoàn', 'number', d.manager ? r.requestedShippingFee || 0 : 0),
          note = field('Ghi chú duyệt');
        service.input.max = r.requestedServiceFee;
        shipping.input.max = r.requestedShippingFee;
        service.input.disabled = shipping.input.disabled = !d.manager;
        controls.append(
          ...(d.manager?[service.box,shipping.box]:[]),
          note.box,
          button(
            'Duyệt yêu cầu',
            async () => {
              if (!d.manager && hasRequestedFees && !await confirmBox(
                'Bạn không có quyền hoàn phí. Duyệt bây giờ sẽ chốt phí hoàn = 0 đ (phí DV ' +
                money(r.requestedServiceFee) + ', phí ship ' + money(r.requestedShippingFee) +
                ' khách đề nghị sẽ không được hoàn) và không duyệt lại được. Nếu cần hoàn phí, hãy để Manager duyệt yêu cầu này.',
                { title: 'Duyệt không hoàn phí', ok: 'Duyệt, không hoàn phí', danger: true },
              )) return;
              await api('/pos/returns/' + r.id + '/approve', 'POST', {
                serviceFee: d.manager ? service.input.value : 0,
                shippingFee: d.manager ? shipping.input.value : 0,
                note: note.input.value,
              });
              await show(id);
            },
            'btn primary',
          ),
        );
      }
      if (
        ['pending', 'approved'].includes(r.status) &&
        (r.createdBy === d.viewerId || d.canApprove)
      ) {
        const reason = field('Lý do huỷ/từ chối yêu cầu');
        controls.append(
          reason.box,
          button(
            d.canApprove ? 'Từ chối / Huỷ yêu cầu' : 'Huỷ yêu cầu',
            async () => {
              if (!reason.input.value.trim()) throw new Error('Nhập lý do trước khi huỷ / từ chối yêu cầu.');
              await api('/pos/returns/' + r.id + '/cancel', 'POST', {
                reason: reason.input.value,
                reject: d.canApprove,
              });
              await show(id);
            },
          ),
        );
      }
      if (r.status === 'approved' && shift?.registerId === d.registerId) {
        const received = field(
          'Tôi đã nhận đủ số hàng và kiểm tra tình trạng như trên',
          'checkbox',
        );
        controls.append(
          received.box,
          button(
            'Xác nhận thực nhận hàng',
            async () => {
              await api('/pos/returns/' + r.id + '/receive', 'POST', {
                shiftId: shift?.id,
                confirmed: received.input.checked,
              });
              await show(id);
              await onChanged();
            },
            'btn primary',
          ),
        );
      }
      if (
        (r.receivedAt || (r.requestContext==='before_fulfillment'&&r.creditEffectiveAt)) &&
        r.status !== 'completed' &&
        shift?.registerId === d.registerId
      ) {
        const used =
          r.refunds.reduce((n, x) => n + x.amount, 0) +
          r.allocations
            .filter((a) => a.status === 'applied')
            .reduce((n, a) => n + a.amount, 0);
        const available = Math.max(
          0,
          Math.min(d.account.available, r.total - used),
        );
        if (available > 0) {
          const amount = field('Số tiền thực hoàn', 'number', available),
            method = select([
              ['cash', 'Tiền mặt'],
              ['transfer', 'Chuyển khoản'],
            ]),
            reference = field('Tham chiếu chuyển khoản'),
            note = field('Ghi chú hoàn tiền'),
            confirmed = field(
              'Tôi xác nhận đã thực trả số tiền này cho khách',
              'checkbox',
            );
          const refundKey = crypto.randomUUID();
          method.setAttribute('aria-label', 'Phương thức hoàn tiền');
          controls.append(
            amount.box,
            method,
            reference.box,
            note.box,
            confirmed.box,
            button(
              'Xác nhận đã hoàn tiền',
              async () => {
                await api('/pos/returns/' + r.id + '/refund', 'POST', {
                  key: refundKey,
                  shiftId: shift?.id,
                  amount: amount.input.value,
                  method: method.value,
                  reference: reference.input.value,
                  note: note.input.value,
                  confirmed: confirmed.input.checked,
                });
                await show(id);
                await onChanged();
              },
              'btn primary',
            ),
          );
          const exchangeKey = crypto.randomUUID();
          controls.append(
            button('Dùng tiền trả để đổi hàng', async () => {
              if (!cartTotal)
                throw Error(
                  'Thêm hàng mới vào giỏ POS trước, rồi chọn áp dụng tiền đổi hàng.',
                );
              const allocation = await api(
                '/pos/returns/' + r.id + '/exchange',
                'POST',
                {
                  key: exchangeKey,
                  shiftId: shift?.id,
                  amount: Math.min(available, cartTotal),
                },
              );
              await onExchange({
                allocation,
                customer: d.order.customerId
                  ? { id: d.order.customerId, name: d.order.customerName }
                  : null,
                orderId: id,
              });
              dlg.close();
            }),
          );
        } else
          controls.append(
            el(
              'p',
              'pos-note',
              d.account.reserved > 0
                ? 'Khoản tiền đang giữ để đổi hàng / chờ QR. Hoàn tất bill mới trước.'
                : 'Không còn tiền cần hoàn. Có thể hoàn tất yêu cầu.',
            ),
          );
        if (!d.account.reserved && d.account.available <= 0)
          controls.append(
            button(
              'Hoàn tất yêu cầu',
              async () => {
                await api('/pos/returns/' + r.id + '/complete', 'POST', {});
                await show(id);
              },
              'btn primary',
            ),
          );
      }
      for (const refund of r.refunds)
        card.append(
          el(
            'p',
            'pos-note',
            refund.refundNo +
              ' · Đã hoàn ' +
              money(refund.amount) +
              ' · ' +
              (refund.method === 'cash' ? 'Tiền mặt' : 'Chuyển khoản') +
              ' · ' +
              refund.reference,
          ),
        );
      controls.append(
        button('In chứng từ K80', () =>
          printPos({ return: r, order: d.order }, 'return'),
        ),
      );
      card.append(controls);
      content.append(card);
    }
    if (shift?.registerId === d.registerId && d.order.status !== 'cancelled') {
      const form = el('section', 'pos-return-card');
      form.append(
        el('h3', '', d.recoveringIssued?'Thu hồi toàn bộ đơn chưa giao':'Lập yêu cầu mới'),
        el(
          'p',
          'pos-note',
          d.recoveringIssued?'Thu hồi toàn bộ hàng đã xuất. Sau duyệt sẽ dừng giao đơn và giải phóng phần chưa xuất; chỉ hoàn tiền sau khi thực nhận lại hàng.':'Chọn số lượng thực trả. Mặc định hoàn tiền hàng; phí chỉ hoàn thêm khi Manager duyệt.',
        ),
      );
      const rows = [];
      for (const l of d.lines.filter((l) => (l.returnableQty??l.deliveredQty) > 0)) {
        const claimed = d.returns
            .filter((r) => !['cancelled', 'rejected'].includes(r.status))
            .flatMap((r) => r.lines)
            .filter((x) => x.orderLineId === l.id)
            .reduce((n, x) => n + x.requestedQty, 0),
          left = (l.returnableQty??l.deliveredQty) - claimed;
        if (left <= 0) continue;
        const row = el('div', 'pos-return-line'),
          qty = field(l.name + ' · Còn được trả ' + left, 'number'),
          condition = select([
            ['restock', 'Hàng bán được · Nhập lại kho'],
            ['damaged', 'Hàng hỏng · Không cộng tồn bán'],
          ]);
        if(d.recoveringIssued){qty.input.value=left;qty.input.readOnly=true;}
        qty.input.max = left;
        qty.input.step = '0.001';
        condition.setAttribute('aria-label', 'Tình trạng ' + l.name);
        row.append(qty.box, condition);
        form.append(row);
        rows.push({ id: l.id, qty: qty.input, condition, left });
      }
      const reason = field('Lý do đổi/trả (bắt buộc)'),
        kind = select([
          ['return', 'Trả hàng / Hoàn tiền'],
          ['exchange', 'Đổi hàng'],
        ]),
        service = field('Đề nghị hoàn thêm phí dịch vụ', 'number', 0),
        shipping = field('Đề nghị hoàn thêm phí ship', 'number', 0),
        feeNote = el('p', 'pos-note pos-return-fee-note'),
        requestKey = crypto.randomUUID();
      kind.setAttribute('aria-label', 'Loại yêu cầu');
      // Bill có thu phí ship / phí dịch vụ: trả hoặc thu hồi toàn bộ hàng còn lại thì mặc định đề nghị hoàn luôn phần phí còn lại.
      // Trả một phần giữ 0 đ. Nhân viên sửa tay ô phí thì không tự ghi đè nữa.
      const feesLeft = remainingPosFees(d.order, d.returns);
      let feesTouched = false;
      service.input.max = feesLeft.service;
      shipping.input.max = feesLeft.shipping;
      const syncFees = () => {
        if (feesTouched || (!feesLeft.service && !feesLeft.shipping)) { feeNote.hidden = true; return; }
        const all = d.recoveringIssued || returnsEverything(rows);
        service.input.value = all ? feesLeft.service : 0;
        shipping.input.value = all ? feesLeft.shipping : 0;
        feeNote.hidden = false;
        feeNote.textContent = all
          ? 'Trả toàn bộ hàng: tự đề nghị hoàn luôn phí đã thu của khách (dịch vụ ' + money(feesLeft.service) + ', ship ' + money(feesLeft.shipping) + '). Sửa nếu cần.'
          : 'Trả một phần: chưa đề nghị hoàn phí. Trả hết hàng thì phí ' + money(feesLeft.service + feesLeft.shipping) + ' được tự điền.';
      };
      for (const input of [service.input, shipping.input]) input.addEventListener('input', () => { feesTouched = true; feeNote.hidden = true; });
      for (const x of rows) x.qty.addEventListener('input', syncFees);
      syncFees();
      form.append(
        kind,
        reason.box,
        feeNote,
        service.box,
        shipping.box,
        button(
          'Gửi yêu cầu duyệt',
          async () => {
            await api('/pos/returns', 'POST', {
              key: requestKey,
              orderId: id,
              shiftId: shift.id,
              kind: kind.value,
              reason: reason.input.value,
              serviceFee: service.input.value,
              shippingFee: shipping.input.value,
              lines: rows
                .filter((x) => x.qty.value !== '' && Number(x.qty.value) > 0)
                .map((x) => ({
                  orderLineId: x.id,
                  qty: x.qty.value,
                  disposition: x.condition.value,
                })),
            });
            await show(id);
          },
          'btn primary',
        ),
      );
      content.append(form);
    } else
      content.append(
        el(
          'p',
          'pos-note',
          d.order.status === 'cancelled'
            ? 'Bill đã huỷ – không lập được yêu cầu mới.'
            : 'Chưa có ca đang mở ở quầy của bill này' + (d.registerName ? ' (' + d.registerName + ')' : '') +
              '. Mở ca tại quầy đó (Bán hàng nhanh) rồi bấm "Trả / Đổi / Hoàn tiền" lại để lập yêu cầu mới, nhận hàng hoặc xác nhận hoàn tiền.',
        ),
      );
  }
  try {
    await (orderId ? show(orderId) : home());
  } catch (e) {
    toast(e.message, 'err');
    dlg.close();
  }
}
