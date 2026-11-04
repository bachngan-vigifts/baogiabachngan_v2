/** Manager confirms physical return/refund; this dialog only records CRM documents. */
export async function openPosQuickCancel({
  api,
  toast,
  orderId,
  money,
  onChanged,
}) {
  const d = await api(
    '/pos/orders/' + encodeURIComponent(orderId) + '/quick-cancel',
  );
  const el = (tag, text, cls) => {
    const n = document.createElement(tag);
    if (text) n.textContent = text;
    if (cls) n.className = cls;
    return n;
  };
  const dialog = el('dialog', null, 'modal'),
    form = el('form'),
    head = el('div', null, 'modal-head'),
    body = el('div', null, 'modal-body form-grid'),
    foot = el('div', null, 'modal-foot');
  dialog.setAttribute('aria-label', 'Huỷ nhanh bill POS');
  form.dataset.mobileActions = 'off';
  head.append(el('h2', 'Huỷ nhanh ' + d.orderNo));
  body.append(
    el(
      'p',
      `Nhập lại toàn bộ hàng vào ${d.warehouse} và ghi hoàn ${money(d.amount)} bằng ${d.method === 'cash' ? 'tiền mặt' : 'chuyển khoản'}.`,
    ),
  );
  const list = el('ul');
  for (const l of d.lines)
    list.append(el('li', `${l.sku} · ${l.name}: ${l.qty} ${l.unit}`));
  body.append(list);
  body.append(
    el('p', 'Chỉ xử lý sổ CRM. Sapo/GHN anh xử lý thủ công.', 'muted small'),
  );
  const field = (caption, node) => {
    const label = el('label', caption);
    label.append(node);
    body.append(label);
    return node;
  };
  const shift = field('Ca ghi nhận hoàn tiền', el('select'));
  shift.required = true;
  for (const s of d.shifts) {
    const option = el(
      'option',
      s.memberName + ' · ' + new Date(s.openedAt).toLocaleString('vi-VN'),
    );
    option.value = s.id;
    shift.append(option);
  }
  const reason = field('Lý do huỷ', el('textarea'));
  reason.required = true;
  reason.maxLength = 2000;
  let reference = null;
  if (d.method === 'transfer' && d.amount > 0) {
    reference = field('Mã giao dịch đã chuyển hoàn tiền', el('input'));
    reference.required = true;
    reference.maxLength = 200;
  }
  const accepted = el('input');
  accepted.type = 'checkbox';
  accepted.required = true;
  const check = el('label');
  check.append(
    accepted,
    document.createTextNode(
      ' Tôi xác nhận đã nhận lại đủ hàng nguyên vẹn và đã hoàn tiền thực tế cho khách.',
    ),
  );
  body.append(check);
  const error = el('p', null, 'error');
  error.setAttribute('role', 'alert');
  body.append(error);
  const cancel = el('button', 'Đóng', 'btn secondary'),
    save = el('button', 'Huỷ đơn · hoàn tiền · nhập kho', 'btn primary');
  cancel.type = 'button';
  save.type = 'submit';
  foot.append(cancel, save);
  form.append(head, body, foot);
  dialog.append(form);
  document.body.append(dialog);
  if (!d.shifts.length) {
    save.disabled = true;
    error.textContent = 'Cần mở ca đúng quầy/két gốc để ghi nhận khoản hoàn.';
  }
  let busy = false,
    completed = false;
  const key = crypto.randomUUID();
  cancel.onclick = () => {
    if (!busy) dialog.close();
  };
  dialog.addEventListener('cancel', (e) => {
    if (busy) e.preventDefault();
  });
  dialog.addEventListener('close', () => dialog.remove(), { once: true });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (busy || !form.reportValidity()) return;
    const input = {
      key,
      revision: d.revision,
      shiftId: shift.value,
      reason: reason.value.trim(),
      reference: reference?.value.trim() || '',
      confirmed: accepted.checked,
    };
    busy = true;
    save.disabled = cancel.disabled = true;
    error.textContent = '';
    dialog.setAttribute('aria-busy', 'true');
    save.textContent = 'Đang huỷ đơn…';
    const controls = [shift, reason, reference, accepted].filter(Boolean);
    for (const control of controls) control.disabled = true;
    try {
      await api(
        '/pos/orders/' + encodeURIComponent(orderId) + '/quick-cancel',
        'POST',
        input,
      );
      completed = true;
      busy = false;
      dialog.close();
      toast(
        'Đã huỷ trong CRM, nhập lại kho và ghi hoàn tiền. Sapo/GHN xử lý thủ công.',
      );
      try {
        await onChanged();
      } catch {
        toast(
          'Đơn đã huỷ thành công. Tải lại trang để xem trạng thái mới.',
          'err',
        );
      }
    } catch (ex) {
      error.textContent =
        ex instanceof Error
          ? ex.message
          : 'Chưa nhận được kết quả. Thử lại để kiểm tra yêu cầu, không hoàn tiền lần nữa.';
    } finally {
      busy = false;
      save.disabled = completed || !d.shifts.length;
      cancel.disabled = false;
      dialog.setAttribute('aria-busy', 'false');
      save.textContent = 'Huỷ đơn · hoàn tiền · nhập kho';
      for (const control of controls) control.disabled = false;
    }
  });
  dialog.showModal();
  reason.focus();
}
