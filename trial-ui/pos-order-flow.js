import { printPos } from './pos-print.js';
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = String(text);
  return n;
};
const money = (n) => Number(n || 0).toLocaleString('vi-VN') + ' đ';
const date = (n) =>
  n
    ? new Date(n).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })
    : '—';
function field(label, type = 'text', value = '') {
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
}
function select(label, items) {
  const box = el('label', 'pos-field'),
    input = el('select');
  for (const [value, name] of items) {
    const o = el('option', '', name);
    o.value = value;
    input.append(o);
  }
  box.append(el('span', '', label), input);
  return { box, input };
}
function dialog(title, toast) {
  const dlg = el('dialog', 'pos-modal pos-flow-modal'),
    body = el('div', 'pos-modal-content'),
    content = el('div'),
    head = el('div', 'pos-flow-head');
  const button = (label, fn, cls = 'btn secondary') => {
    const b = el('button', cls, label);
    b.type = 'button';
    b.onclick = async () => {
      if (dlg.dataset.busy) return;
      dlg.dataset.busy = '1';
      const buttons = [...dlg.querySelectorAll('button')];
      buttons.forEach((x) => (x.disabled = true));
      try {
        await fn();
      } catch (e) {
        toast(e.message, 'err');
      } finally {
        delete dlg.dataset.busy;
        buttons.forEach((x) => (x.disabled = false));
      }
    };
    return b;
  };
  head.append(
    el('h2', '', title),
    button('Đóng', () => dlg.close()),
  );
  body.append(head, content);
  dlg.append(body);
  document.body.append(dlg);
  dlg.addEventListener('close', () => dlg.remove(), { once: true });
  dlg.showModal();
  return { dlg, content, button, close: () => dlg.close() };
}
/** The server recomputes every price and records transfers only when actually confirmed. */
export function openPosFlowCheckout({
  flow,
  total,
  customer,
  toast,
  onSubmit,
}) {
  const prepaid = flow === 'prepaid',
    m = dialog(
      prepaid ? 'Ship trả trước 100%' : 'Đặt cọc · Nhận hàng sau',
      toast,
    ),
    form = el('form', 'pos-flow-form');
  m.content.append(
    form,
    el(
      'p',
      'pos-note',
      'Giá, số lượng và chiết khấu được giữ theo đơn đã lập.',
    ),
  );
  form.append(el('p', 'pos-flow-total', 'Tổng đơn: ' + money(total)));
  const amount = field(
    prepaid ? 'Số tiền trả trước' : 'Tiền cọc (VNĐ)',
    'number',
    prepaid ? total : Math.max(1, Math.round(total * 0.3)),
  );
  amount.input.required = true;
  amount.input.min = '1';
  amount.input.max = String(total);
  amount.input.readOnly = prepaid;
  if (!prepaid) {
    const presets = el('div', 'pos-flow-actions');
    for (const pct of [30, 50])
      presets.append(
        m.button(pct + '%', () => {
          amount.input.value = Math.max(1, Math.round((total * pct) / 100));
          update();
        }),
      );
    form.append(presets);
  }
  const method = select('Hình thức thanh toán', [
      ['cash', 'Tiền mặt đã thực nhận'],
      ['transfer', 'Chuyển khoản'],
    ]),
    confirmed = field(
      'Cửa hàng đã thực nhận khoản chuyển khoản này',
      'checkbox',
    ),
    remaining = el('p', 'pos-note'),
    hint = el('p', 'pos-warning');
  form.append(amount.box, method.box, confirmed.box, remaining, hint);
  let receiver, phone, address, planned;
  if (prepaid) {
    receiver = field(
      'Người nhận',
      'text',
      customer?.contact || customer?.name || '',
    );
    phone = field('Điện thoại người nhận', 'tel', customer?.phone || '');
    address = field('Địa chỉ giao', 'text', customer?.address || '');
    planned = field(
      'Ngày giao dự kiến',
      'date',
      new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(
        new Date(),
      ),
    );
    for (const f of [receiver, phone, address, planned]) {
      f.input.required = true;
      form.append(f.box);
    }
  }
  const error = el('p', 'error');
  error.setAttribute('role', 'alert');
  const save = el('button', 'btn primary');
  save.type = 'submit';
  form.append(error, save);
  function update() {
    const n = Number(amount.input.value),
      pending = method.input.value === 'transfer' && !confirmed.input.checked;
    confirmed.box.hidden = method.input.value !== 'transfer';
    remaining.textContent =
      'Còn lại sau khi thực nhận: ' + money(Math.max(0, total - n));
    hint.textContent = pending
      ? 'Chờ xác nhận: chưa ghi thu, chưa vào két. Giữ hàng 5 ngày.'
      : prepaid
        ? 'Chỉ đóng gói/giao hàng sau khi đã thực nhận đủ. COD bằng 0.'
        : 'Giữ hàng 5 ngày. Chỉ xuất hàng tại quầy sau khi đã thu đủ.';
    save.textContent = pending
      ? 'Lưu đơn · Chờ chuyển khoản'
      : prepaid
        ? 'Ghi nhận trả trước 100%'
        : 'Ghi nhận cọc';
  }
  amount.input.oninput = update;
  method.input.onchange = () => {
    confirmed.input.checked = false;
    update();
  };
  confirmed.input.onchange = update;
  update();
  form.onsubmit = async (e) => {
    e.preventDefault();
    if (save.disabled) return;
    const n = Number(amount.input.value);
    if (!Number.isSafeInteger(n) || n <= 0 || n > total)
      return (error.textContent =
        'Nhập số tiền nguyên, lớn hơn 0 và không vượt tổng đơn.');
    save.disabled = true;
    const body = {
      saleFlow: flow,
      initialAmount: n,
      method: method.input.value,
      confirmed: method.input.value === 'transfer' && confirmed.input.checked,
      ...(prepaid
        ? {
            delivery: {
              receiverName: receiver.input.value.trim(),
              receiverPhone: phone.input.value.trim(),
              address: address.input.value.trim(),
              plannedDate: planned.input.value,
            },
          }
        : {}),
    };
    m.close();
    await onSubmit(body);
  };
  return m;
}
export async function openPosOrderFlows({
  api,
  toast,
  shift,
  register,
  orderId = '',
  onChanged = () => {},
  onReturns = () => {},
}) {
  if (!shift?.id || shift.closedAt)
    return toast('Mở ca tại đúng quầy để xử lý đơn nhận sau.', 'err');
  const m = dialog('Đơn cọc · Ship trả trước', toast);
  let current = '';
  const refresh = async (id) => {
    await onChanged();
    await show(id);
  };
  async function home() {
    current = '';
    m.content.replaceChildren();
    const search = field('Tìm số đơn / khách / điện thoại'),
      filter = select('Trạng thái', [
        ['open', 'Đang xử lý'],
        ['all', 'Tất cả'],
      ]),
      rows = el('div', 'pos-flow-list');
    let seq = 0,
      offset = null,
      timer;
    const more = m.button('Xem thêm', () => draw(false));
    m.content.append(search.box, filter.box, rows, more);
    async function draw(reset = true) {
      const turn = ++seq;
      const d = await api(
        '/pos/order-flows?' +
          new URLSearchParams({
            shiftId: shift.id,
            status: filter.input.value || 'open',
            q: search.input.value,
            offset: reset ? '0' : String(offset || 0),
          }),
      );
      if (turn !== seq || !m.dlg.open) return;
      if (reset) rows.replaceChildren();
      for (const a of d.orders) {
        const b = m.button('', () => show(a.order.id), 'pos-flow-order');
        b.append(
          el('strong', '', a.order.orderNo + ' · ' + a.order.customerName),
          el('span', '', a.state),
          el(
            'small',
            '',
            `${a.saleFlow === 'deposit' ? 'Nhận tại quầy' : 'Ship trả trước'} · Đã thu ${money(a.paid)} · Còn ${money(a.remaining)}`,
          ),
        );
        rows.append(b);
      }
      offset = d.nextOffset;
      more.hidden = offset == null;
      if (!rows.children.length)
        rows.append(el('p', 'pos-note', 'Không có đơn phù hợp.'));
    }
    const reload = () => draw().catch((e) => toast(e.message, 'err'));
    search.input.oninput = () => {
      clearTimeout(timer);
      timer = setTimeout(reload, 200);
    };
    filter.input.onchange = reload;
    await draw();
  }
  async function show(id) {
    current = id;
    const a = await api('/pos/order-flows/' + id),
      o = a.order,
      snap = JSON.parse(o.posSnapshot || '{}'),
      done = ['delivered', 'cancelled'].includes(o.status);
    m.content.replaceChildren();
    const actions = el('div', 'pos-flow-actions'),
      summary = el('dl', 'pos-flow-summary');
    actions.append(
      m.button('← Danh sách', home),
      m.button('Tải lại', () => show(id)),
      m.button('In phiếu', () =>
        printPos({
          ...snap,
          id: o.id,
          orderNo: o.orderNo,
          receivedAmount: a.paid,
          remaining: a.remaining,
          pendingAmount: a.pending,
          pendingTransfer: a.pending > 0,
          holdUntil: a.holdUntil,
        }),
      ),
    );
    m.content.append(
      actions,
      el('h3', '', o.orderNo + ' · ' + o.customerName),
      el('p', 'pos-flow-state', a.state),
      summary,
    );
    for (const [label, value] of [
      ['Tổng đơn', money(o.total)],
      ['Đã thực thu', money(a.paid)],
      ['Chuyển khoản đang chờ', money(a.pending)],
      ['Còn phải thu', money(a.remaining)],
      [
        'Hạn giữ',
        a.holdUntil?.startsWith('9999')
          ? 'Đến khi xuất hàng'
          : date(a.holdUntil),
      ],
    ])
      summary.append(el('dt', '', label), el('dd', '', value));
    if (o.note) m.content.append(el('p', '', 'Ghi chú: ' + o.note));
    for (const i of a.intents.filter((i) => i.status === 'pending')) {
      const card = el('section', 'pos-flow-card'),
        ref = field('Mã tham chiếu chuyển khoản'),
        check = field('Cửa hàng đã thực nhận đúng khoản này', 'checkbox'),
        reason = field('Lý do huỷ khoản chờ');
      card.append(
        el('h3', '', 'Chờ chuyển khoản ' + money(i.amount)),
        el('p', 'pos-note', 'Tạo lúc ' + date(i.createdAt) + '. Chưa ghi thu.'),
        ref.box,
        check.box,
        m.button(
          'Xác nhận đã nhận tiền',
          async () => {
            if (!check.input.checked || !ref.input.value.trim())
              throw Error('Đánh dấu đã nhận tiền và nhập mã tham chiếu.');
            await api('/pos/order-flow-intents/' + i.id + '/confirm', 'POST', {
              shiftId: shift.id,
              confirmed: true,
              reference: ref.input.value.trim(),
            });
            await refresh(id);
          },
          'btn primary',
        ),
        reason.box,
        m.button('Huỷ khoản chờ', async () => {
          await api('/pos/order-flow-intents/' + i.id + '/cancel', 'POST', {
            shiftId: shift.id,
            reason: reason.input.value,
          });
          await refresh(id);
        }),
      );
      m.content.append(card);
    }
    if (!done) {
      m.content.append(
        m.button(
          a.held
            ? 'Kiểm tra / gia hạn giữ hàng'
            : 'Kiểm tra tồn và giữ lại hàng',
          async () => {
            await api('/pos/order-flows/' + id + '/hold', 'POST', {
              shiftId: shift.id,
            });
            await refresh(id);
          },
        ),
      );
      if (a.remaining > 0 || a.saleFlow === 'deposit') {
        const card = el('section', 'pos-flow-card'),
          amount = field('Số tiền thu thêm', 'number', a.remaining),
          method = select('Phương thức', [
            ['cash', 'Tiền mặt đã thực nhận'],
            ['transfer', 'Chuyển khoản'],
          ]),
          confirmed = field('Cửa hàng đã thực nhận chuyển khoản', 'checkbox'),
          reference = field('Mã tham chiếu (nếu có)'),
          pickup = field('Giao đủ hàng tại quầy sau khi thu đủ', 'checkbox');
        amount.input.max = String(a.remaining);
        amount.input.readOnly = a.saleFlow === 'prepaid' || a.remaining === 0;
        pickup.input.checked = true;
        confirmed.box.hidden = reference.box.hidden = true;
        method.input.onchange = () => {
          confirmed.input.checked = false;
          confirmed.box.hidden = reference.box.hidden =
            method.input.value !== 'transfer';
        };
        const transactionKey = crypto.randomUUID();
        card.append(
          el(
            'h3',
            '',
            a.remaining ? 'Thu nốt / nhận hàng' : 'Nhận hàng đã thanh toán',
          ),
          amount.box,
          method.box,
          confirmed.box,
          reference.box,
          ...(a.saleFlow === 'deposit' ? [pickup.box] : []),
          el(
            'p',
            'pos-note',
            'Chuyển khoản chưa nhận chỉ lưu yêu cầu chờ. Hệ thống kiểm lại tồn trước khi thu thêm.',
          ),
          m.button(
            a.saleFlow === 'deposit'
              ? 'Lưu khoản thu / nhận hàng'
              : 'Ghi nhận trả đủ',
            async () => {
              await api('/pos/order-flows/' + id + '/collect', 'POST', {
                key: transactionKey,
                shiftId: shift.id,
                amount: Number(amount.input.value),
                method: method.input.value,
                confirmed: confirmed.input.checked,
                reference: reference.input.value.trim(),
                pickup: a.saleFlow === 'deposit' && pickup.input.checked,
              });
              await refresh(id);
            },
            'btn primary',
          ),
        );
        m.content.append(card);
      }
      if (a.saleFlow === 'prepaid' && a.remaining === 0) {
        const link = el('a', 'btn primary', 'Mở đơn để đóng gói / giao hàng');
        link.href = '#/orders/' + id;
        link.onclick = () => m.close();
        m.content.append(
          link,
          el('p', 'pos-note', 'Đơn ship trả trước không thu COD.'),
        );
      }
      const cancel = el('section', 'pos-flow-card'),
        reason = field('Lý do huỷ trước xuất (bắt buộc)'),
        kind = select('Xử lý tiền đã nhận', [
          ['return', 'Đề nghị hoàn toàn bộ tiền đã nhận'],
          ['exchange', 'Đề nghị chuyển tín dụng đổi hàng'],
        ]),
        cancelKey = crypto.randomUUID();
      cancel.append(
        el('h3', '', 'Huỷ đơn chưa xuất hàng'),
        reason.box,
        kind.box,
        el(
          'p',
          'pos-note',
          'Lập yêu cầu duyệt, không tự chi tiền. Đã xuất/đóng gói phải dùng Trả / Đổi / Hoàn.',
        ),
        m.button(
          'Huỷ đơn và lập đề nghị',
          async () => {
            const d = await api('/pos/order-flows/' + id + '/cancel', 'POST', {
              key: cancelKey,
              shiftId: shift.id,
              reason: reason.input.value,
              kind: kind.input.value,
            });
            await onChanged();
            if (d.returnId) {
              m.close();
              await onReturns(id);
            } else await show(id);
          },
          'btn danger',
        ),
      );
      m.content.append(cancel);
    }
    if (
      o.status === 'cancelled' &&
      ['cancelled', 'rejected'].includes(a.cancelRequest?.status)
    ) {
      const reason = field(
          'Lý do đề nghị hoàn lại sau khi yêu cầu cũ bị huỷ/từ chối',
        ),
        kind = select('Xử lý tiền đã nhận', [
          ['return', 'Hoàn tiền'],
          ['exchange', 'Tín dụng đổi hàng'],
        ]),
        retryKey = crypto.randomUUID();
      m.content.append(
        reason.box,
        kind.box,
        m.button('Lập lại đề nghị hoàn / đổi', async () => {
          await api('/pos/order-flows/' + id + '/cancel', 'POST', {
            key: retryKey,
            shiftId: shift.id,
            reason: reason.input.value,
            kind: kind.input.value,
          });
          await refresh(id);
        }),
      );
    }
    m.content.append(
      m.button('Trả / Đổi / Hoàn của đơn', () => {
        m.close();
        return onReturns(id);
      }),
    );
    if (a.receipts.length) {
      m.content.append(el('h3', '', 'Các khoản đã thực nhận'));
      for (const p of a.receipts)
        m.content.append(
          el(
            'p',
            'pos-note',
            date(p.createdAt) +
              ' · ' +
              (p.method === 'cash' ? 'Tiền mặt' : 'Chuyển khoản') +
              ' · ' +
              money(p.amount),
          ),
        );
    }
  }
  try {
    await (orderId ? show(orderId) : home());
  } catch (e) {
    toast(e.message, 'err');
    m.close();
  }
  return m;
}
