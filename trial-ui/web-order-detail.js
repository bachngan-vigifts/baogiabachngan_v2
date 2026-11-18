import { webOrderFinancialSummary } from './web-order-financials.js';

const el = (tag, text = '', cls = '') => {
  const node = document.createElement(tag);
  node.textContent = text;
  node.className = cls;
  return node;
};
const button = (label, handler, cls = 'btn secondary') => {
  const node = el('button', label, cls);
  node.type = 'button';
  node.onclick = handler;
  return node;
};
const money = (amount, currency = 'VND') =>
  amount == null
    ? 'Chưa có dữ liệu'
    : new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 }).format(
        amount,
      ) + (currency === 'VND' ? ' đ' : ' ' + currency);
const kv = (node, rows) => {
  node.replaceChildren();
  for (const [label, value] of rows)
    node.append(el('dt', label), el('dd', value || '—'));
};

/** Same CRM detail panels and invoice form; the web identity is never converted into another sale. */
export function renderWebOrderDetail({
  root,
  detail: d,
  api,
  toast,
  onReload,
  onEdit,
  onPrint,
  renderInvoice,
  isCurrent,
}) {
  const $ = (selector) => root.querySelector(selector),
    o = d.document;
  const reload = () => {
    if (isCurrent()) return onReload();
  };
  $('#order-title').textContent = o.orderNo;
  $('#order-back').href = '#/orders';
  $('#order-back').textContent = '‹ Đơn đặt hàng';
  const pill = el(
    'span',
    o.statusLabel,
    'pill ' +
      (o.status === 'delivered'
        ? 'ok'
        : o.status === 'cancelled'
          ? 'muted'
          : 'info'),
  );
  $('#order-status').className = 'order-status-pills';
  $('#order-status').replaceChildren(pill);
  const actions = $('#order-actions');
  actions.replaceChildren();
  for (const [kind, label] of [
    ['order', 'In / Tải đơn hàng'],
    ['packing', 'In phiếu đóng gói'],
    ['delivery', 'In phiếu giao hàng'],
  ]) {
    const b = button(label, () => onPrint(kind));
    b.disabled = !d.items.length;
    actions.append(b);
  }
  if (d.canEdit)
    actions.append(button('Sửa sản phẩm / giá', onEdit, 'btn primary'));
  if (d.canManage) {
    const link = el('a', 'Xử lý GHN', 'btn secondary');
    link.href = '#/pos?webOrderId=' + encodeURIComponent(o.webOrderId);
    actions.append(link);
  }
  actions.append(button('Tải lại', reload));
  $('#order-purchases').replaceChildren();
  $('#order-purchases').hidden = true;
  $('#order-progress').hidden = true;
  $('#order-progress').replaceChildren();
  $('#order-pos-ghn-edit').textContent = [
    d.editBlocked,
    o.sapoSourceChanged?'Đơn website đã đổi sau lần gửi Sapo; cần đối soát sản phẩm/giá trên Sapo.':'',
    o.sourceConflict ? 'Website có thay đổi khác bản CRM; cần đối soát.' : '',
    o.ghnCartReviewRequired ? 'Cần đối soát sản phẩm với vận đơn GHN.' : '',
  ]
    .filter(Boolean)
    .join(' ');
  $('#order-pos-ghn-edit').hidden = !$('#order-pos-ghn-edit').textContent;
  const flow = $('#order-flow');
  flow.replaceChildren();
  for (const [title, text, done] of [
    ['Đơn đặt hàng', o.orderNo, true],
    [
      'Giao hàng',
      o.ghnOrderCode ? `${o.ghnOrderCode} · ${o.ghnStatus}` : 'Chưa tạo GHN',
      o.status === 'delivered',
    ],
    [
      'Hoá đơn',
      o.invoiceNo || 'Chưa nhập số hoá đơn',
      o.invoiceStatus === 'issued',
    ],
  ]) {
    const node = el('div', '', 'flow-step' + (done ? ' done' : ''));
    node.append(el('b', title), el('small', text));
    flow.append(node);
  }
  const billing = o.billing;
  kv($('#order-customer'), [
    ['Khách hàng', o.customerName],
    ['Điện thoại', o.phone],
    ['Địa chỉ giao hàng', o.address],
    ['Tên xuất hoá đơn', billing.name],
    ['MST', billing.taxCode],
    ['Địa chỉ xuất hoá đơn', billing.address],
    ['Email hoá đơn', billing.email],
  ]);
  if (d.canEditBilling) {
    const box = el('dd');
    box.append(
      button(
        'Sửa thông tin xuất hoá đơn',
        () => editBilling({ o, api, toast, reload, isCurrent }),
        'btn secondary small',
      ),
    );
    $('#order-customer').append(el('dt', 'Xuất hoá đơn'), box);
  }
  $('#order-contract-title').textContent = 'Đơn hàng';
  $('#order-contract-action').replaceChildren();
  const summary = el('dl', '', 'kv');
  kv(summary, [
    ['Số đơn web', o.sourceOrderNo],
    ['Nguồn', o.ownerName],
    ['Cửa hàng', o.branchName],
    ['Ngày đặt', o.orderDate],
    ['Giá trị (gồm VAT)', money(o.total, o.currency)],
    [
      'Kho',
      {
        none: 'Chưa xuất kho',
        issued: 'Đã xuất kho theo GHN',
        returned: 'Đã hoàn kho',
        blocked: 'Cần đối soát',
        legacy: 'Đối soát hồ sơ cũ',
      }[o.stockStatus] || 'Chưa có dữ liệu',
    ],
  ]);
  $('#order-contract').replaceChildren(summary);
  if (o.stockNote)
    $('#order-contract').append(el('p', o.stockNote, 'warn-text'));
  $('#order-lines-title').textContent = 'Hàng trong đơn';
  $('#order-lines-head').replaceChildren(
    ...[
      'Sản phẩm',
      'ĐVT',
      'SL',
      'Đơn giá trước giảm (gồm VAT)',
      'CK / giảm đã phân bổ',
      'VAT',
      'Thành tiền sau giảm',
    ].map((text) => el('th', text)),
  );
  const lines = $('#order-lines');
  lines.replaceChildren();
  for (const item of d.items) {
    const qty = Number(item.quantity) || 0;
    const before =
      item.subtotal != null && item.subtotalTax != null
        ? Number(item.subtotal) + Number(item.subtotalTax)
        : null;
    const after =
      item.total != null && item.totalTax != null
        ? Number(item.total) + Number(item.totalTax)
        : null;
    const row = el('tr');
    for (const value of [
      `${item.sku || '—'} · ${item.name || ''}`,
      item.unit || '—',
      String(qty),
      money(before == null || !qty ? null : before / qty, o.currency),
      money(
        before == null || after == null ? null : Math.max(0, before - after),
        o.currency,
      ),
      money(item.totalTax, o.currency),
      after == null && item.total != null
        ? money(item.total, o.currency) + ' (chưa có VAT chi tiết)'
        : money(after, o.currency),
    ])
      row.append(el('td', value));
    lines.append(row);
  }
  if (!d.items.length) {
    const row = el('tr'),
      cell = el('td', 'Chưa có chi tiết sản phẩm từ website.');
    cell.colSpan = 7;
    row.append(cell);
    lines.append(row);
  }
  $('#order-line-details').replaceChildren(
    webOrderFinancialSummary(o.financials, o.currency),
  );
  $('#order-pack').hidden = true;
  $('#order-new-delivery').hidden = true;
  $('#order-new-payment').hidden = true;
  $('#order-packing').replaceChildren();
  $('#order-deliveries').replaceChildren();
  if (o.ghnOrderCode) {
    const link = el(
      'a',
      `GHN ${o.ghnOrderCode} · ${o.ghnStatus || 'Chưa có trạng thái'}`,
      'data-link',
    );
    link.href =
      'https://khachhang.ghn.vn/order/detail?order_code=' +
      encodeURIComponent(o.ghnOrderCode);
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    $('#order-deliveries').append(link);
  } else
    $('#order-deliveries').append(el('p', 'Chưa tạo vận đơn GHN.', 'muted'));
  const debt =
    o.status === 'cancelled'
      ? 'Đơn đã huỷ / hoàn.'
      : o.paymentStatusLabel
        ? o.paymentStatusLabel
        : o.paid == null
        ? 'Chưa có đủ dữ liệu đối chiếu thanh toán.'
        : o.paid >= o.total
          ? 'Đã đối soát thanh toán đủ.'
          : 'Còn phải thu ' + money(o.total - o.paid, o.currency);
  $('#order-debt').replaceChildren(el('p', debt));
  $('#order-payments').replaceChildren(el('p', debt));
  renderInvoice({
    ...o,
    invoiceStatus: o.invoiceStatus === 'unknown' ? 'none' : o.invoiceStatus,
  });
}

function editBilling({ o, api, toast, reload, isCurrent }) {
  const dialog = el('dialog', '', 'modal'),
    form = el('form'),
    body = el('div', '', 'modal-body form-grid'),
    error = el('p', '', 'error');
  dialog.setAttribute('aria-label', 'Thông tin xuất hoá đơn');
  error.setAttribute('role', 'alert');
  const head = el('div', '', 'modal-head');
  head.append(el('h2', 'Thông tin xuất hoá đơn'));
  const inputs = {};
  for (const [key, label, max] of [
    ['name', 'Tên khách / doanh nghiệp', 500],
    ['taxCode', 'Mã số thuế', 100],
    ['address', 'Địa chỉ xuất hoá đơn', 2000],
    ['email', 'Email nhận hoá đơn', 500],
  ]) {
    const field = el('label', label),
      input = el('input');
    input.name = key;
    input.value = o.billing[key] || '';
    input.maxLength = max;
    if (key === 'email') input.type = 'email';
    field.append(input);
    body.append(field);
    inputs[key] = input;
  }
  body.append(error);
  const foot = el('div', '', 'modal-foot'),
    cancel = button('Đóng', () => {
      if (!busy) dialog.close();
    }),
    save = el('button', 'Lưu thông tin', 'btn primary');
  save.type = 'submit';
  foot.append(cancel, save);
  form.append(head, body, foot);
  dialog.append(form);
  document.body.append(dialog);
  let busy = false;
  dialog.addEventListener('cancel', (event) => {
    if (busy) event.preventDefault();
  });
  dialog.addEventListener('close', () => dialog.remove(), { once: true });
  form.onsubmit = async (event) => {
    event.preventDefault();
    if (busy || !form.reportValidity()) return;
    if (!isCurrent()) {
      dialog.close();
      return;
    }
    const payload = Object.fromEntries(
      Object.entries(inputs).map(([key, input]) => [key, input.value.trim()]),
    );
    busy = true;
    save.disabled = cancel.disabled = true;
    error.textContent = '';
    try {
      await api('/orders/' + encodeURIComponent(o.id) + '/web-billing', 'PUT', {
        ...payload,
        revision: o.accountingRevision,
      });
      dialog.close();
      if (isCurrent()) {
        toast('Đã lưu thông tin xuất hoá đơn.');
        await reload();
      }
    } catch (ex) {
      if (dialog.isConnected) error.textContent = ex.message;
    } finally {
      busy = false;
      save.disabled = cancel.disabled = false;
    }
  };
  dialog.showModal();
  inputs.name.focus();
}
