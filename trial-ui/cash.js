import { openPosReturns } from './pos-returns.js';
import { downloadExcel } from './sheet-export.js';
import { printPos } from './pos-print.js';
import { renderShiftReport, differenceState } from './shift-report-view.js';
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
  customer_refund: 'Hoàn tiền khách',
};
const entryName = r => /^Tên phiếu: ([^\r\n]{1,120})\n\n/.exec(r.reason || '')?.[1] || kinds[r.kind] || r.kind;
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
    periodTotals = { in: 0, out: 0, net: 0 },
    ledgerKind = '',
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
    listVersion = 0,
    openedEntryLink = '';
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
      ledgerKind = '';
      openedEntryLink = '';
    }
    const hash = globalThis.location?.hash || '';
    const link = new URLSearchParams(hash.split('?')[1] || '');
    const linkedEntry = link.get('entryId');
    if (linkedEntry && hash !== openedEntryLink && link.get('drawerId')) drawerId = link.get('drawerId');
    const result = await api('/cash');
    if (version !== loadVersion) return;
    summary = result;
    drawerId = summary.drawer.id;
    render();
    if (tab === 'ledger') await entries();
    else if (tab === 'reconcile') await reconciliations();
    else await shifts();
    if (linkedEntry && hash !== openedEntryLink) {
      const detail = await api('/cash/entries/' + encodeURIComponent(linkedEntry));
      if (version !== loadVersion) return;
      openedEntryLink = hash; showEntry(detail.entry);
    }
  }
  function render() {
    root.replaceChildren();
    const header = el('div', 'cash-head');
    const title = el('div', 'cash-title');
    title.append(el('span', 'cash-eyebrow', 'TÀI CHÍNH CỬA HÀNG'), el('h1', '', 'Sổ quỹ'), el('p', 'cash-note', 'Theo dõi toàn bộ tiền vào, tiền ra và tồn quỹ theo từng két.'));
    header.append(title);
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
    if(summary.canApprove)tools.append(button('Duyệt đổi / trả hàng',()=>openPosReturns({api,toast})));
    tools.append(button('Bán hàng nhanh', () => go('#/pos')));
    header.append(tools);
    root.append(header);
    const cards = el('div', 'cash-stats cash-overview');
    for (const [label, value, note] of [
      ['Tồn quỹ hiện tại', money(summary.balance), 'Cập nhật ' + time(summary.updatedAt)],
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
    periodTotals = d.totals || periodTotals;
    nextCursor = d.nextBefore;
    renderEntries();
  }
  function renderEntries() {
    const box = content();
    box.replaceChildren();
    const stats = el('div', 'cash-stats cash-period-stats');
    for (const [label, value, cls] of [
      ['Số dư khởi tạo', summary.drawer.openingAmount ?? 0, ''],
      ['Tổng thu', periodTotals.in, 'cash-in'],
      ['Tổng chi', periodTotals.out, 'cash-out'],
      ['Thu − chi', periodTotals.net, periodTotals.net < 0 ? 'cash-out' : 'cash-in'],
    ]) {
      const card = el('article', 'card cash-stat');
      card.append(el('span', '', label), el('strong', cls, money(value)), el('small', '', from + ' → ' + to));
      stats.append(card);
    }
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
    const kindsBar = el('div', 'cash-kind-tabs');
    for (const [value, label] of [['', 'Tất cả'], ['in', 'Phiếu thu'], ['out', 'Phiếu chi']]) {
      kindsBar.append(button(label, () => { ledgerKind = value; renderEntries(); }, 'chip' + (ledgerKind === value ? ' active' : '')));
    }
    controls.append(
      kindsBar, f.box, t.box,
      button('Xuất Excel bảng đang xem', () =>
        run(() =>
          downloadExcel('so-quy', [
            {
              name: 'Sổ quỹ',
              header: ['Giờ', 'Số phiếu', 'Loại', 'Nội dung', 'Người làm', 'Số tiền', 'Trạng thái', 'Lý do huỷ'],
              rows: visibleRows().map((r) => [
                time(r.at),
                r.entryNo,
                entryName(r),
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
    box.append(stats, controls);
    const { t: tbl, body } = table(['Mã phiếu / thời gian', 'Loại phiếu', 'Nội dung', 'Người tạo', 'Thu', 'Chi', 'Trạng thái', '']);
    for (const r of visibleRows()) {
      const tr = el('tr', r.status === 'voided' ? 'cash-voided' : ''),
        actions = el('td', 'cash-row-actions');
      for (const [text, cls] of [
        [r.entryNo + ' · ' + time(r.at), ''],
        [r.direction === 'in' ? 'Phiếu thu · ' + (entryName(r)) : 'Phiếu chi · ' + (entryName(r)), ''],
        [r.reason || 'Thu tiền ' + r.entryNo, ''],
        [r.by, ''],
        [r.direction === 'in' ? money(r.amount) : '—', r.direction === 'in' ? 'cash-in right' : 'right'],
        [r.direction === 'out' ? money(r.amount) : '—', r.direction === 'out' ? 'cash-out right' : 'right'],
        [states[r.status] || r.status, ''],
      ])
        tr.append(el('td', cls, text));
      actions.append(button('Xem', () => showEntry(r), 'btn secondary small'));
      if (r.hasPhoto)
        actions.append(
          button('Ảnh', () =>
            run(async () => {
              const d = await api('/cash/entries/' + r.id + '/photo');
              if (d.url) window.open(d.url, '_blank', 'noopener,noreferrer');
            }),
          ),
        );
      if (r.status === 'pending' && (summary.canApprove ?? summary.canManage) && (r.createdBy !== user().id || summary.canSelfApprove))
        actions.append(
          button('Duyệt', () =>
            run(async () => {
              await api('/cash/entries/' + r.id + '/approve', 'POST', {});
              await load();
            }),
          ),
        );
      if (r.status !== 'voided' && summary.canVoid && r.kind!=='customer_refund') actions.append(button('Huỷ phiếu', () => voidEntry(r)));
      if (r.voidReason) actions.append(el('small', '', 'Huỷ: ' + r.voidReason));
      tr.append(actions);
      body.append(tr);
    }
    box.append(tbl);
    if (!visibleRows().length) box.append(el('p', 'cash-empty', ledgerKind === 'out' ? 'Chưa có phiếu chi trong khoảng ngày này.' : ledgerKind === 'in' ? 'Chưa có phiếu thu trong khoảng ngày này.' : 'Chưa có phiếu trong khoảng ngày này.'));
    if (nextCursor)
      box.append(
        button('Xem thêm', () => {
          cursor = nextCursor;
          run(() => entries(true));
        }),
      );
  }
  const visibleRows = () => rows.filter(r => !ledgerKind || r.direction === ledgerKind);
  function showEntry(r) {
    const m = dialog((r.direction === 'in' ? 'Phiếu thu ' : 'Phiếu chi ') + r.entryNo);
    for (const [label, value] of [
      ['Thời gian', time(r.at)], ['Loại phiếu', entryName(r)], ['Nội dung', r.reason || '—'],
      ['Người tạo', r.by || '—'], ['Số tiền', money(r.amount)], ['Trạng thái', states[r.status] || r.status],
    ]) { const line = el('div', 'cash-pair'); line.append(el('span', '', label), el('b', '', value)); m.body.append(line); }
    if (r.voidReason) m.body.append(el('p', 'cash-warning', 'Lý do huỷ: ' + r.voidReason));
    if (r.status === 'pending' && summary.canApprove && (r.createdBy !== user().id || summary.canSelfApprove))
      m.body.append(button('Duyệt phiếu', () => run(async () => {
        await api('/cash/entries/' + encodeURIComponent(r.id) + '/approve', 'POST', {}); m.close(); await load();
      }), 'btn primary'));
    m.body.append(button('Đóng', m.close)); m.show();
  }
  function submitForm(m, saveText, fn) {
    const save = el('button', 'btn primary', saveText);
    save.type = 'submit';
    m.body.append(save, button('Huỷ', m.close));
    m.form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (save.disabled) return;
      save.disabled = true;
      const originalText = save.textContent;
      save.textContent = saveText.startsWith('Kết ca') ? 'Đang kết ca…' : 'Đang lưu…';
      run(async () => {
        try {
          await fn();
        } finally {
          save.disabled = false;
          save.textContent = originalText;
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
      kind = adjustment ? select(allowed.map((k) => [k, kinds[k]])) : el('input'),
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
    if (!adjustment) {
      kind.type = 'text'; kind.value = kinds[allowed[0]]; kind.required = true; kind.maxLength = 120;
      kind.placeholder = 'Nhập tên phiếu, ví dụ: Chi sửa xe';
      const suggestions = el('datalist'); suggestions.id = 'cash-entry-names-' + key;
      for (const code of allowed) { const o = el('option'); o.value = kinds[code]; suggestions.append(o); }
      kind.setAttribute('list', suggestions.id); m.body.append(suggestions);
    }
    m.body.append(labeled(adjustment ? 'Loại phiếu' : 'Tên phiếu', kind));
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
          ' cần người có quyền duyệt; chưa tính vào két khi chờ. Manager được tự duyệt phiếu của mình.',
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
        kind: adjustment ? 'adjustment' : allowed.find(k => kinds[k] === kind.value.trim()) || allowed[0],
        ...(!adjustment && !allowed.some(k => kinds[k] === kind.value.trim()) ? { entryName: kind.value.trim() } : {}),
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
      threshold = field('Ngưỡng cần duyệt (VNĐ)', 'number', summary.drawer.approvalThreshold),
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
  /** Báo cáo ca dạng khối (shift-report-view.js); bấm khối → trang liên quan. */
  function report(container, d, close) {
    renderShiftReport(container, d, { onOpen: target => { close?.(); go(target === 'orders' ? '#/orders' : target === 'cash' ? '#/cash' : '#/pos'); } });
  }
  /**
   * Kết ca: bên trái báo cáo, bên phải ô đếm tiền (cộng nhanh theo mệnh giá), chênh lệch 3 trạng thái (chưa đếm / khớp / lệch),
   * lý do bắt buộc khi lệch ("Khác" bắt buộc ghi chú), phiếu chờ duyệt chặn kết ca. Công thức két, tra soát, chống ghi lặp: giữ nguyên ở máy chủ.
   */
  async function closeShift() {
    const d = await api('/cash/shifts/' + summary.ownShift.id),
      m = dialog('Kết ca');
    m.d.classList.add('cash-close-dialog');
    const layout = el('div', 'close-layout'), left = el('div', 'close-report'), side = el('aside', 'close-side');
    report(left, d, m.close);
    layout.append(side, left);
    m.body.append(layout);
    const blocked = (d.pendingEntries || []).length > 0;
    if (blocked) {
      const warn = el('div', 'close-block');
      warn.append(el('b', '', `${d.pendingEntries.length} phiếu đang chờ duyệt – chặn kết ca.`));
      for (const p of d.pendingEntries) warn.append(el('span', '', `${p.entryNo} · ${money(p.amount)} · ${p.reason}`));
      warn.append(button('Xem phiếu', () => { m.close(); go('#/cash'); }, 'btn ghost small'));
      side.append(warn);
    }
    const cash = field('Tổng tiền mặt đã đếm', 'number');
    cash.input.min = '0'; cash.input.step = '1'; cash.input.inputMode = 'numeric'; cash.input.placeholder = '0'; cash.input.classList.add('close-count');
    const quick = el('div', 'close-quick');
    for (const v of [500000, 200000, 100000, 50000, 20000, 10000]) quick.append(button('+' + v / 1000 + 'k', () => { cash.input.value = String((Number(cash.input.value) || 0) + v); update(); }, 'btn secondary small'));
    quick.append(button('Xoá', () => { cash.input.value = ''; update(); }, 'btn ghost small'));
    const diff = el('div', 'close-diff'), reason = select([['', 'Chọn lý do'], ['counting', 'Đếm sai'], ['wrong_change', 'Đưa nhầm tiền'], ['small_change', 'Thiếu tiền lẻ'], ['other', 'Khác']]),
      note = field('Ghi chú (bắt buộc nếu chọn "Khác")', 'textarea'), reasonBox = labeled('Lý do chênh lệch · bắt buộc', reason);
    const submit = el('button', 'btn primary close-submit', 'Kết ca & in báo cáo K80'); submit.type = 'submit';
    const preview = button('Xem trước bản in', () => printPos({ ...d, countedCash: Number(cash.input.value) || null }, 'shift'), 'btn secondary');
    const legend = el('ul', 'close-legend');
    for (const [cls, t] of [['empty', 'Chưa đếm: xám, chưa có số lệch'], ['match', 'Khớp: xanh, kết ca được ngay'], ['diff', 'Lệch: cam, bắt buộc lý do, tự mở tra soát']]) { const li = el('li', 'is-' + cls); li.append(el('i'), document.createTextNode(t)); legend.append(li); }
    function update() {
      const st = differenceState(cash.input.value, d.expectedCash);
      diff.className = 'close-diff is-' + st.state;
      diff.replaceChildren(el('span', '', st.state === 'empty' ? 'Chênh lệch so với két' : st.state === 'match' ? 'Khớp két' : 'Chênh lệch so với két'),
        el('b', '', st.state === 'empty' ? st.text : st.state === 'match' ? money(0) : (st.diff > 0 ? '+' : '') + money(st.diff)));
      const lech = st.state === 'diff';
      reasonBox.hidden = note.box.hidden = !lech;
      reason.required = lech;
      note.input.required = lech && reason.value === 'other';
      submit.disabled = blocked || st.state === 'empty' || (lech && (!reason.value || (reason.value === 'other' && !note.input.value.trim())));
    }
    cash.input.addEventListener('input', update); reason.addEventListener('change', update); note.input.addEventListener('input', update);
    const hint = el('p', 'cash-note', `Két hệ thống ${money(d.expectedCash)}. Nhập tổng tiền mặt thực tế trong két, số nguyên VNĐ. Tiền thực đếm bàn giao cho ca sau.`);
    side.append(cash.box, quick, hint, diff, reasonBox, note.box, submit, preview, legend);
    update();
    m.form.addEventListener('submit', async e => {
      e.preventDefault();
      if (submit.disabled) return;
      submit.disabled = true;
      try {
        const r = await api('/cash/shifts/' + d.shift.id + '/close', 'POST', { countedCash: Number(cash.input.value), reasonCode: reason.value, reasonNote: note.input.value });
        m.close();
        toast('Đã kết ca thành công.');
        // Cho trình duyệt vẽ xong trạng thái đóng dialog trước khi mở hộp in.
        await new Promise(resolve => typeof requestAnimationFrame === 'function' ? requestAnimationFrame(() => resolve()) : resolve());
        try { printPos(r, 'shift'); } catch { toast('Đã kết ca. Có thể xem và in lại ở tab Ca.', 'err'); }
        await Promise.all([load(), onShiftClosed()]);
      } catch (ex) { toast(ex.message, 'err'); update(); }
    });
    m.show();
    cash.input.focus();
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
            m.d.classList.add('cash-close-dialog');
            report(m.body, d, m.close);
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
    const { t, body } = table(['Mã', 'Nhân viên', 'Theo sổ', 'Thực đếm', 'Lệch', 'Trạng thái', '']);
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
      'Nhân viên: ' + d.memberName,
      ...(d.openingComparison ? ['Mở ca: bàn giao ' + money(d.openingComparison.expectedCash) + ' / thực đếm ' + money(d.openingComparison.countedCash) + ' / lệch ' + money(d.openingComparison.difference)] : []),
      'Theo sổ ' + money(r.expectedCash) + ' / đếm ' + money(r.countedCash) + ' / lệch ' + money(r.difference),
      'Lý do: ' + (r.reasonCode === 'opening_cash' ? 'Chênh lệch tiền đầu ca' : r.reasonCode) + ' ' + r.reasonNote,
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
