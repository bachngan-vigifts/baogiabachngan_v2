import { downloadExcel } from './sheet-export.js';
import { printPos } from './pos-print.js';
const money = (n) => Number(n ?? 0).toLocaleString('vi-VN') + ' đ';
const time = (s) => new Date(s).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
const today = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' });
const kinds = {
  other_income: 'Thu khác',
  cash_in: 'Rút két',
  petty_expense: 'Chi vặt',
  advance: 'Tạm ứng',
  cash_out: 'Nộp két',
  adjustment: 'Điều chỉnh két',
  sale: 'Bán hàng',
  cod: 'COD',
};
const states = { posted: 'Ghi', pending: 'Chờ duyệt', voided: 'Đã huỷ', explained: 'Đã giải trình', closed: 'Đã đóng' };
function el(tag, cls = '', text) {
  const n = document.createElement(tag);
  n.className = cls;
  if (text != null) n.textContent = String(text);
  return n;
}
function button(text, fn, cls = 'btn secondary') {
  const n = el('button', cls, text);
  n.type = 'button';
  n.addEventListener('click', fn);
  return n;
}
function field(label, type = 'text', value = '') {
  const box = el('label', 'cash-field'),
    input = el(type === 'textarea' ? 'textarea' : 'input');
  if (type !== 'textarea') input.type = type;
  input.value = value;
  box.append(el('span', '', label), input);
  return { box, input };
}
function select(items, value) {
  const n = el('select');
  for (const [v, t] of items) {
    const o = el('option', '', t);
    o.value = v;
    n.append(o);
  }
  if (value != null) n.value = value;
  return n;
}
function dialog(title) {
  const d = el('dialog', 'cash-dialog'),
    form = el('form'),
    body = el('div', 'cash-dialog-body'),
    head = el('header');
  head.append(
    el('h2', '', title),
    button('×', () => d.close()),
  );
  form.append(head, body);
  d.append(form);
  document.body.append(d);
  d.addEventListener('close', () => d.remove());
  return { d, form, body, show: () => d.showModal(), close: () => d.close() };
}
function labeled(label, input) {
  const box = el('label', 'cash-field');
  box.append(el('span', '', label), input);
  return box;
}
function table(headers) {
  const t = el('table', 'data-table'),
    h = el('thead'),
    tr = el('tr'),
    body = el('tbody');
  for (const text of headers) tr.append(el('th', '', text));
  h.append(tr);
  t.append(h, body);
  return { t, body };
}
export function initCash({ root, api: request, user, toast, go, onShiftClosed = async () => {} }) {
  let summary = null,
    rows = [],
    tab = 'ledger',
    from = today(),
    to = today(),
    cursor = null,
    nextCursor = null,
    offset = 0,
    owner = '',
    busy = false,
    drawerId = '',
    loadVersion = 0,
    listVersion = 0;
  const api = (path, method, body) => request(
    drawerId && path.startsWith('/cash') ? path + (path.includes('?') ? '&' : '?') + 'drawerId=' + encodeURIComponent(drawerId) : path,
    method, body,
  );
  const run = async (fn) => {
    try {
      await fn();
    } catch (e) {
      toast(e.message || 'Không tải được Sổ quỹ.', 'err');
    }
  };
  async function load() {
    const version = ++loadVersion;
    ++listVersion;
    if (owner !== user().id) {
      owner = user().id;
      rows = [];
      tab = 'ledger';
      from = to = today();
      cursor = null;
      offset = 0;
      drawerId = '';
    }
    const result = await api('/cash');
    if (version !== loadVersion) return;
    summary = result;
    drawerId = summary.drawer.id;
    render();
    if (tab === 'ledger') await entries();
    else if (tab === 'reconcile') await reconciliations();
    else await shifts();
  }
  function render() {
    root.replaceChildren();
    const header = el('div', 'cash-head');
    header.append(el('div', '', null), el('h1', '', 'Sổ quỹ cửa hàng'));
    const tools = el('div', 'cash-tools');
    if (summary.drawers?.length) {
      const drawer = select(summary.drawers.map(d => [d.id, d.name]), drawerId);
      drawer.setAttribute('aria-label', 'Chọn két quầy');
      drawer.addEventListener('change', () => {
        drawerId = drawer.value; cursor = null; offset = 0; rows = [];
        run(load);
      });
      tools.append(drawer);
    }
    if (summary.canManage) tools.append(
      button('Cấu hình két', () => run(configure)),
      button('+ Két riêng cho quầy', () => run(createDrawer)),
    );
    tools.append(button('Bán hàng nhanh', () => go('#/pos')));
    header.append(tools);
    root.append(header);
    const cards = el('div', 'cash-stats');
    for (const [label, value, note] of [
      ['Tiền trong két theo sổ', money(summary.balance), 'Toàn két · ' + time(summary.updatedAt)],
      [
        'Ca đang mở',
        summary.activeShift?.memberName || 'Chưa mở ca',
        summary.activeShift
          ? 'Mở ' + time(summary.activeShift.openedAt)
          : 'Đầu ca kế tiếp: ' + money(summary.nextOpeningCash),
      ],
      ['Tra soát đang mở', summary.openReconciliations, 'Cần giải trình / Manager xử lý'],
    ]) {
      const b = button(
        '',
        () => {
          tab = label === 'Tra soát đang mở' ? 'reconcile' : label === 'Ca đang mở' ? 'shifts' : 'ledger';
          offset = 0;
          run(load);
        },
        'card cash-stat',
      );
      b.append(el('span', '', label), el('strong', '', value), el('small', '', note));
      cards.append(b);
    }
    root.append(cards);
    if (!summary.drawer.openingSetAt)
      root.append(el('p', 'cash-warning', 'Manager cần nhập số dư đầu kỳ một lần trước khi mở ca.'));
    const tools2 = el('div', 'cash-tools');
    const inc = button('+ Thu tiền', () => entry('in'), 'btn primary'),
      out = button('+ Chi tiền', () => entry('out')),
      close = button('Kết ca', () => run(closeShift));
    inc.disabled = out.disabled = !summary.ownShift;
    close.disabled = !summary.ownShift;
    tools2.append(inc, out, close);
    if (summary.canManage) {
      const a = button('Điều chỉnh két', () => entry('in', true));
      a.disabled = !summary.activeShift;
      tools2.append(a);
    }
    root.append(tools2);
    const tabs = el('div', 'chips');
    for (const [id, label] of [
      ['ledger', 'Sổ quỹ'],
      ['shifts', 'Ca'],
      ['reconcile', 'Tra soát'],
    ]) {
      const b = button(
        label,
        () => {
          tab = id;
          offset = 0;
          cursor = null;
          run(load);
        },
        'chip' + (tab === id ? ' active' : ''),
      );
      tabs.append(b);
    }
    root.append(tabs, el('div', 'cash-content'));
  }
  const content = () => root.querySelector('.cash-content');
  async function entries(append = false) {
    const version = ++listVersion;
    const d = await api(`/cash/entries?from=${from}&to=${to}${cursor ? '&before=' + encodeURIComponent(cursor) : ''}`);
    if (version !== listVersion) return;
    rows = append ? [...rows, ...d.entries] : d.entries;
    nextCursor = d.nextBefore;
    renderEntries();
  }
  function renderEntries() {
    const box = content();
    box.replaceChildren();
    const controls = el('div', 'cash-tools'),
      f = field('Từ ngày', 'date', from),
      t = field('Đến ngày', 'date', to);
    for (const v of [f, t])
      v.input.addEventListener('change', () => {
        from = f.input.value;
        to = t.input.value;
        cursor = null;
        run(() => entries());
      });
    controls.append(
      f.box,
      t.box,
      button('Xuất Excel bảng đang xem', () =>
        run(() =>
          downloadExcel('so-quy', [
            {
              name: 'Sổ quỹ',
              header: ['Giờ', 'Số phiếu', 'Loại', 'Nội dung', 'Người làm', 'Số tiền', 'Trạng thái', 'Lý do huỷ'],
              rows: rows.map((r) => [
                time(r.at),
                r.entryNo,
                kinds[r.kind] || r.kind,
                r.reason,
                r.by,
                r.direction === 'in' ? r.amount : -r.amount,
                states[r.status],
                r.voidReason || '',
              ]),
            },
          ]),
        ),
      ),
    );
    box.append(controls);
    const { t: tbl, body } = table(['Giờ', 'Loại / số phiếu', 'Nội dung', 'Người làm', 'Số tiền', 'Trạng thái', '']);
    for (const r of rows) {
      const tr = el('tr', r.status === 'voided' ? 'cash-voided' : ''),
        amount = (r.direction === 'in' ? '+' : '−') + money(r.amount),
        actions = el('td', 'cash-row-actions');
      for (const [text, cls] of [
        [time(r.at), ''],
        [(kinds[r.kind] || r.kind) + ' · ' + r.entryNo, ''],
        [r.reason || 'Thu tiền ' + r.entryNo, ''],
        [r.by, ''],
        [amount, r.direction === 'in' ? 'cash-in' : 'cash-out'],
        [states[r.status] || r.status, ''],
      ])
        tr.append(el('td', cls, text));
      if (r.hasPhoto)
        actions.append(
          button('Ảnh', () =>
            run(async () => {
              const d = await api('/cash/entries/' + r.id + '/photo');
              if (d.url) window.open(d.url, '_blank', 'noopener,noreferrer');
            }),
          ),
        );
      if (r.status === 'pending' && summary.canManage && r.createdBy !== user().id)
        actions.append(
          button('Duyệt', () =>
            run(async () => {
              await api('/cash/entries/' + r.id + '/approve', 'POST', {});
              await load();
            }),
          ),
        );
      if (r.status !== 'voided' && summary.canVoid) actions.append(button('Huỷ phiếu', () => voidEntry(r)));
      if (r.voidReason) actions.append(el('small', '', 'Huỷ: ' + r.voidReason));
      tr.append(actions);
      body.append(tr);
    }
    box.append(tbl);
    if (!rows.length) box.append(el('p', 'cash-empty', 'Chưa có phiếu trong khoảng ngày này.'));
    if (nextCursor)
      box.append(
        button('Xem thêm', () => {
          cursor = nextCursor;
          run(() => entries(true));
        }),
      );
  }
  function submitForm(m, saveText, fn) {
    const save = el('button', 'btn primary', saveText);
    save.type = 'submit';
    m.body.append(save, button('Huỷ', m.close));
    m.form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (save.disabled) return;
      save.disabled = true;
      run(async () => {
        try {
          await fn();
        } finally {
          save.disabled = false;
        }
      });
    });
    m.show();
  }
  function entry(direction, adjustment = false, recId = '') {
    const m = dialog(adjustment ? 'Điều chỉnh két' : direction === 'in' ? 'Thêm phiếu thu' : 'Thêm phiếu chi'),
      allowed = adjustment
        ? ['adjustment']
        : direction === 'in'
          ? ['other_income', 'cash_in']
          : ['petty_expense', 'advance', 'cash_out'],
      kind = select(allowed.map((k) => [k, kinds[k]])),
      dir = select(
        [
          ['in', 'Tăng tiền két'],
          ['out', 'Giảm tiền két'],
        ],
        direction,
      ),
      amount = field('Số tiền (VNĐ)', 'number'),
      reason = field('Nội dung / lý do', 'textarea'),
      photo = field('Ảnh hoá đơn (không bắt buộc)', 'file'),
      key = crypto.randomUUID();
    amount.input.min = '1';
    amount.input.step = '1';
    amount.input.required = reason.input.required = true;
    photo.input.accept = 'image/jpeg,image/png,image/webp';
    m.body.append(labeled('Loại phiếu', kind));
    if (adjustment) m.body.append(labeled('Chiều điều chỉnh', dir));
    m.body.append(
      amount.box,
      reason.box,
      photo.box,
      el(
        'p',
        'cash-warning',
        'Từ ' +
          money(summary.drawer.approvalThreshold) +
          ' cần Manager khác người tạo duyệt; chưa tính vào két khi chờ.',
      ),
    );
    if (adjustment)
      m.body.append(
        el(
          'p',
          'cash-warning',
          'Điều chỉnh chỉ sửa số dư theo sổ, không ghi thêm thu/chi tiền thực vào ca đã kế thừa số đếm.',
        ),
      );
    if (recId) m.body.append(el('p', '', 'Phiếu tham chiếu tra soát đang xem.'));
    submitForm(m, 'Lưu phiếu', async () => {
      let img;
      if (photo.input.files?.[0]) img = await compress(photo.input.files[0]);
      await api('/cash/entries', 'POST', {
        key,
        kind: kind.value,
        direction: dir.value,
        amount: Number(amount.input.value),
        reason: reason.input.value,
        photo: img,
        reconciliationId: recId,
      });
      m.close();
      await load();
    });
  }
  async function compress(file) {
    if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size > 12000000)
      throw Error('Chọn ảnh JPEG/PNG/WebP dưới 12 MB.');
    const bmp = await createImageBitmap(file),
      c = document.createElement('canvas'),
      scale = Math.min(1, 1200 / Math.max(bmp.width, bmp.height));
    c.width = Math.round(bmp.width * scale);
    c.height = Math.round(bmp.height * scale);
    const ctx = c.getContext('2d');
    ctx.drawImage(bmp, 0, 0, c.width, c.height);
    bmp.close();
    let quality = 0.8,
      img = c.toDataURL('image/jpeg', quality);
    while (img.length > 780000 && quality > 0.2) {
      quality -= 0.15;
      img = c.toDataURL('image/jpeg', quality);
    }
    if (img.length > 780000) throw Error('Ảnh còn quá lớn, chọn ảnh nhỏ hơn.');
    return img;
  }
  function voidEntry(r) {
    const m = dialog('Huỷ phiếu ' + r.entryNo),
      reason = field('Lý do huỷ', 'textarea');
    reason.input.required = true;
    m.body.append(
      el('p', 'cash-warning', 'Phiếu vẫn giữ trong lịch sử. Nếu ca đã kết, báo cáo giữ nguyên và phát sinh tra soát.'),
      reason.box,
    );
    submitForm(m, 'Xác nhận huỷ', async () => {
      await api(r.source === 'payment' ? '/payments/' + r.id + '/void' : '/cash/entries/' + r.id + '/void', 'POST', {
        reason: reason.input.value,
      });
      m.close();
      await load();
    });
  }
  function configure() {
    const m = dialog('Cấu hình ' + summary.drawer.name),
      name = field('Tên két', 'text', summary.drawer.name),
      threshold = field('Ngưỡng cần Manager duyệt (VNĐ)', 'number', summary.drawer.approvalThreshold),
      opening = field('Số dư đầu kỳ (chỉ nhập một lần)', 'number', '0'),
      reason = field('Lý do đầu kỳ', 'textarea');
    threshold.input.min = '1';
    threshold.input.required = true;
    name.input.required = true;
    m.body.append(name.box, threshold.box);
    if (!summary.drawer.openingSetAt) {
      opening.input.min = '0';
      opening.input.required = reason.input.required = true;
      m.body.append(opening.box, reason.box);
    } else
      m.body.append(
        el(
          'p',
          '',
          'Đầu kỳ đã chốt ' + money(summary.drawer.openingAmount) + '. Muốn sửa số dư, lập phiếu điều chỉnh.',
        ),
      );
    submitForm(m, 'Lưu cấu hình', async () => {
      await api('/cash/config', 'POST', {
        name: name.input.value,
        approvalThreshold: Number(threshold.input.value),
        ...(!summary.drawer.openingSetAt
          ? { openingAmount: Number(opening.input.value), reason: reason.input.value }
          : {}),
      });
      m.close();
      await load();
    });
  }
  function createDrawer() {
    const m = dialog('Tạo két riêng cho quầy'),
      registers = summary.registers || [],
      reg = select(registers.map(r => [r.id, r.name]), registers[0]?.id),
      name = field('Tên két', 'text', registers[0] ? 'Két ' + registers[0].name : '');
    reg.addEventListener('change', () => { name.input.value = 'Két ' + (registers.find(r => r.id === reg.value)?.name || ''); });
    name.input.required = true;
    m.body.append(labeled('Quầy bán hàng', reg), name.box,
      el('p', 'cash-note', 'Két mới chưa có số dư đầu kỳ. Manager nhập tiền thực tế riêng tại Cấu hình két. Chỉ tách quầy chưa có ca; giữ nguyên cấu hình và lịch sử két cũ.'));
    const requestKey = crypto.randomUUID();
    submitForm(m, 'Tạo két riêng', async () => {
      const d = await api('/cash/drawers', 'POST', { key: requestKey, name: name.input.value, registerId: reg.value });
      drawerId = d.id; m.close(); await load();
    });
  }
  function report(container, d) {
    for (const [label, value] of [
      ['Đầu ca (kế thừa)', d.shift.openingCash],
      ['+ Bán hàng tiền mặt', d.cashSales ?? d.cash],
      ['+ COD đã nhận', d.cashCod ?? 0],
      ...(d.manual || []).map((x) => [
        (x.direction === 'in' ? '+ ' : '− ') + (kinds[x.kind] || x.kind),
        x.direction === 'in' ? x.amount : -x.amount,
      ]),
      ['Tiền trong két theo sổ ca', d.expectedCash],
    ]) {
      const r = el('div', 'cash-pair');
      r.append(el('span', '', label), el('b', '', money(value)));
      container.append(r);
    }
    for (const a of d.bookAdjustments || [])
      container.append(
        el(
          'p',
          'cash-note',
          'Điều chỉnh sổ quỹ ' +
            money(a.direction === 'in' ? a.amount : -a.amount) +
            '; không có thu/chi tiền thực trong ca.',
        ),
      );
    container.append(
      el(
        'p',
        'cash-note',
        'Chuyển khoản và COD chưa nhận không tính vào tiền két. Số toàn két có thể khác vì tra soát ca trước.',
      ),
    );
  }
  async function closeShift() {
    const d = await api('/cash/shifts/' + summary.ownShift.id),
      m = dialog('Kết ca');
    report(m.body, d);
    if (d.pendingEntries?.length) {
      m.body.append(el('p', 'cash-warning', 'Còn phiếu chờ duyệt. Xử lý các phiếu sau trước khi kết ca:'));
      for (const p of d.pendingEntries)
        m.body.append(el('p', '', p.entryNo + ' · ' + money(p.amount) + ' · ' + p.reason));
      m.body.append(button('Đóng', m.close));
      m.show();
      return;
    }
    const cash = field('Tổng tiền mặt đếm được', 'number'),
      reason = select([
        ['', 'Chọn lý do'],
        ['counting', 'Đếm sai'],
        ['wrong_change', 'Đưa nhầm tiền'],
        ['small_change', 'Thiếu tiền lẻ'],
        ['other', 'Khác'],
      ]),
      note = field('Ghi chú (bắt buộc khi chọn Khác)', 'textarea'),
      diff = el('p', 'cash-warning');
    cash.input.min = '0';
    cash.input.step = '1';
    cash.input.required = true;
    const update = () => {
      const n = Number(cash.input.value) - d.expectedCash;
      diff.textContent = 'Chênh lệch ' + money(n);
      reason.required = n !== 0;
      note.input.required = n !== 0 && reason.value === 'other';
    };
    cash.input.addEventListener('input', update);
    reason.addEventListener('change', update);
    m.body.append(
      cash.box,
      diff,
      labeled('Lý do chênh lệch', reason),
      note.box,
      el('p', 'cash-note', 'Lệch khác 0 tự mở một tra soát. Tiền thực đếm sẽ bàn giao cho ca sau.'),
    );
    submitForm(m, 'Kết ca & in báo cáo', async () => {
      const r = await api('/cash/shifts/' + d.shift.id + '/close', 'POST', {
        countedCash: Number(cash.input.value),
        reasonCode: reason.value,
        reasonNote: note.input.value,
      });
      m.close();
      try {
        printPos(r, 'shift');
      } catch {
        toast('Đã kết ca. Có thể xem và in lại ở tab Ca.', 'err');
      }
      await load();
      await onShiftClosed();
    });
  }
  async function shifts() {
    const version = ++listVersion;
    const data = await api('/cash/shifts?offset=' + offset);
    if (version !== listVersion) return;
    const box = content();
    box.replaceChildren();
    const { t, body } = table(['Nhân viên', 'Mở ca', 'Đóng ca', 'Đầu ca', 'Thực đếm', '']);
    for (const s of data.items) {
      const tr = el('tr'),
        td = el('td');
      for (const v of [
        s.memberName,
        time(s.openedAt),
        s.closedAt ? time(s.closedAt) : 'Đang mở',
        money(s.openingCash),
        s.countedCash == null ? '—' : money(s.countedCash),
      ])
        tr.append(el('td', '', v));
      td.append(
        button('Xem / in', () =>
          run(async () => {
            const d = await api('/cash/shifts/' + s.id),
              m = dialog('Báo cáo ca');
            report(m.body, d);
            m.body.append(
              button('In K80', () => printPos(d, 'shift')),
              button('Đóng', m.close),
            );
            m.show();
          }),
        ),
      );
      tr.append(td);
      body.append(tr);
    }
    box.append(t);
    if (offset)
      box.append(
        button('Trang trước', () => {
          offset = Math.max(0, offset - 50);
          run(shifts);
        }),
      );
    if (data.nextOffset != null)
      box.append(
        button('Trang sau', () => {
          offset = data.nextOffset;
          run(shifts);
        }),
      );
  }
  async function reconciliations() {
    const version = ++listVersion;
    const data = await api('/cash/reconciliations?offset=' + offset);
    if (version !== listVersion) return;
    const box = content();
    box.replaceChildren();
    const { t, body } = table(['Mã', 'Người kết ca', 'Theo sổ', 'Thực đếm', 'Lệch', 'Trạng thái', '']);
    for (const r of data.items) {
      const tr = el('tr'),
        td = el('td');
      for (const v of [
        r.reconciliationNo,
        r.memberName,
        money(r.expectedCash),
        money(r.countedCash),
        money(r.difference),
        r.status === 'pending' ? 'Chờ giải trình' : states[r.status],
      ])
        tr.append(el('td', '', v));
      td.append(button('Xem', () => run(() => reconciliation(r.id))));
      tr.append(td);
      body.append(tr);
    }
    box.append(t);
    if (!data.items.length) box.append(el('p', 'cash-empty', 'Chưa có tra soát.'));
    if (offset)
      box.append(
        button('Trang trước', () => {
          offset = Math.max(0, offset - 50);
          run(reconciliations);
        }),
      );
    if (data.nextOffset != null)
      box.append(
        button('Trang sau', () => {
          offset = data.nextOffset;
          run(reconciliations);
        }),
      );
  }
  async function reconciliation(id) {
    const d = await api('/cash/reconciliations/' + id),
      r = d.item,
      m = dialog(r.reconciliationNo);
    for (const text of [
      'Người kết ca: ' + d.memberName,
      'Theo sổ ' + money(r.expectedCash) + ' / đếm ' + money(r.countedCash) + ' / lệch ' + money(r.difference),
      'Lý do: ' + r.reasonCode + ' ' + r.reasonNote,
      'Giải trình: ' + (r.explanation || 'Chưa có'),
      'Lý do đóng: ' + (r.closeReason || '—'),
    ])
      m.body.append(el('p', '', text));
    m.body.append(el('h3', '', 'Phiếu liên quan'));
    for (const e of d.entries)
      m.body.append(el('p', '', (e.entryNo || e.id) + ' · ' + money(e.amount) + ' · ' + (e.reason || e.status)));
    if (r.status !== 'closed' && r.closedBy === user().id) {
      const explanation = field('Giải trình', 'textarea', r.explanation);
      explanation.input.required = true;
      m.body.append(explanation.box);
      submitForm(m, 'Gửi giải trình', async () => {
        await api('/cash/reconciliations/' + id + '/explain', 'POST', { explanation: explanation.input.value });
        m.close();
        await load();
      });
    } else {
      if (summary.canManage && r.status === 'explained') {
        const note = field('Lý do đóng tra soát', 'textarea');
        note.input.required = true;
        m.body.append(note.box);
        submitForm(m, 'Đóng tra soát', async () => {
          await api('/cash/reconciliations/' + id + '/close', 'POST', { reason: note.input.value });
          m.close();
          await load();
        });
      } else {
        m.body.append(button('Đóng', m.close));
        m.show();
      }
    }
    if (summary.canManage && summary.activeShift)
      m.body.append(
        button('Lập điều chỉnh tham chiếu', () => {
          m.close();
          entry('in', true, id);
        }),
      );
    m.body.append(el('h3', '', 'Nhật ký'));
    for (const a of d.audit) m.body.append(el('p', 'cash-note', time(a.at) + ' · ' + a.by + ' · ' + a.action));
  }
  return {
    load,
    closeCurrent: async () => {
      summary = await request('/cash');
      drawerId = summary.drawer.id;
      if (!summary.ownShift) throw Error('Bạn chưa có ca đang mở.');
      await closeShift();
    },
  };
}
