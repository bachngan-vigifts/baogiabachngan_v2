import { printPos } from './pos-print.js';
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = String(text);
  return n;
};
const money = (n) => Number(n || 0).toLocaleString('vi-VN') + ' đ';
const key = () => crypto.randomUUID();
const button = (text, cls, fn) => {
  const b = el('button', cls || 'btn secondary', text);
  b.type = 'button';
  if (fn) b.addEventListener('click', fn);
  return b;
};
const field = (label, type = 'text', value = '') => {
  const box = el('label', 'pos-field'),
    input = el('input');
  input.type = type;
  input.value = value;
  box.append(el('span', '', label), input);
  return { box, input };
};
const select = (items, value) => {
  const s = el('select');
  for (const [id, name] of items) {
    const o = el('option', '', name);
    o.value = id;
    s.append(o);
  }
  s.value = value;
  return s;
};
const when = (d) => new Date(d).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
export function initPos({ api, root, toast, user, confirmBox, go, onCloseShift }) {
  const st = {
    options: null,
    shift: null,
    register: null,
    policy: '',
    cart: [],
    customer: null,
    preview: null,
    method: 'cash',
    qr: null,
    busy: false,
    pending: null,
    products: [],
    offset: 0,
    request: 0,
  };
  let searchTimer,
    previewTimer,
    previewSeq = 0,
    searchSeq = 0,
    pendingUser = '',
    nodes = {},
    lineTotals = new Map();
  const run = async (fn) => {
    try {
      return await fn();
    } catch (e) {
      toast(e.message, 'err');
      return null;
    }
  };
  const pendingKey = () => 'bn-pos-pending:' + user().id;
  function restorePending() {
    if (pendingUser === user().id) return;
    pendingUser = user().id;
    st.cart = [];
    st.customer = null;
    st.preview = null;
    st.pending = null;
    try {
      st.pending = JSON.parse(sessionStorage.getItem(pendingKey()) || 'null');
    } catch {}
  }
  function persistPending(value) {
    st.pending = value;
    try {
      value ? sessionStorage.setItem(pendingKey(), JSON.stringify(value)) : sessionStorage.removeItem(pendingKey());
    } catch {}
  }
  const payload = () => ({
    registerId: st.register.id,
    shiftId: st.shift.id,
    pricePolicyId: st.policy,
    customerId: st.customer?.id || '',
    rows: st.cart.map((x) => ({
      sku: x.sku,
      qty: x.qty,
      discountType: x.discountType,
      discountValue: x.discountValue,
    })),
  });
  function invalidate() {
    st.qr = null;
    st.preview = null;
    refreshPay();
    clearTimeout(previewTimer);
    previewTimer = setTimeout(preview, 180);
  }
  function modal(title) {
    const dlg = el('dialog', 'pos-modal'),
      body = el('div', 'pos-modal-content');
    body.append(el('h2', '', title));
    dlg.append(body);
    document.body.append(dlg);
    const close = () => {
      dlg.close();
      dlg.remove();
    };
    dlg.addEventListener('close', () => dlg.remove());
    dlg.addEventListener('cancel', close);
    return { dlg, body, close, show: () => dlg.showModal() };
  }
  function formModal(title) {
    const m = modal(title),
      form = el('form');
    m.body.append(form);
    return { ...m, form };
  }
  const active = () => !!st.shift && !st.shift.closedAt;
  function dirty() {
    return !!st.pending || st.cart.length > 0;
  }
  async function load() {
    restorePending();
    const seq = ++st.request;
    const d = await run(() => api('/pos/options'));
    if (!d || seq !== st.request) return;
    st.options = d;
    st.shift = d.current;
    st.register =
      d.registers.find((x) => x.id === st.shift?.registerId) ||
      d.registers.find((x) => x.id === st.register?.id) ||
      d.registers[0] ||
      null;
    if (!st.register || ![st.register.pricePolicyId, st.register.secondPricePolicyId].includes(st.policy))
      st.policy = st.register?.pricePolicyId || '';
    draw();
    if (st.register) await search(false);
    if (st.cart.length && active()) await preview();
  }
  function draw() {
    root.replaceChildren();
    const page = el('div', 'pos-page'),
      head = el('div', 'pos-head'),
      title = el('div'),
      tools = el('div', 'pos-head-tools');
    title.append(
      el('h1', '', 'Bán hàng nhanh'),
      el(
        'p',
        'pos-note',
        `${user().name} · ${st.register?.name || 'Chưa cấu hình quầy'} · ${active() ? 'Ca đang mở' : 'Chưa mở ca'}`,
      ),
    );
    head.append(title, tools);
    page.append(head);
    tools.append(
      button('Báo cáo ca', 'btn secondary', () => run(history)),
      button('Ship COD', 'btn secondary', () => run(codList)),
    );
    if (st.options.canConfigure)
      tools.append(
        button('Cấu hình', 'btn secondary', () => configure()),
        button('+ Quầy', 'btn secondary', () => configure(true)),
      );
    if (!active() && st.options.registers.length > 1) {
      const regSelect = select(
        st.options.registers.map((r) => [r.id, r.name]),
        st.register?.id,
      );
      regSelect.setAttribute('aria-label', 'Chọn quầy');
      regSelect.addEventListener('change', () => {
        st.register = st.options.registers.find((r) => r.id === regSelect.value);
        st.policy = st.register.pricePolicyId;
        draw();
        run(() => search(false));
      });
      tools.append(regSelect);
    }
    tools.append(button(active() ? 'Kết ca' : 'Mở ca', 'btn primary', () => run(active() ? closeShift : openShift)));
    if (!st.register) {
      page.append(el('div', 'pos-warning', 'Manager cần cấu hình quầy, kho và hai chính sách giá trước khi bán.'));
      root.append(page);
      return;
    }
    if (!active()) page.append(el('div', 'pos-warning', 'Mở ca và đếm nhanh tồn kho trước khi bán.'));
    if (st.pending) {
      const warn = el('div', 'pos-warning');
      warn.append(
        el('p', '', 'Có giao dịch chưa xác định kết quả. Kiểm tra lại trước khi bán đơn khác để tránh thu hai lần.'),
        button('Kiểm tra lại giao dịch', 'btn primary', () => submit(st.pending)),
      );
      page.append(warn);
    }
    const layout = el('div', 'pos-layout'),
      left = el('section', 'pos-card'),
      right = el('section', 'pos-card'),
      searchBox = el('div', 'pos-search');
    const input = el('input');
    input.type = 'search';
    input.placeholder = 'Tìm tên, mã hàng hoặc quét mã vạch…';
    input.setAttribute('aria-label', 'Tìm hoặc quét sản phẩm');
    nodes.search = input;
    input.addEventListener('input', () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => run(() => search(false)), 220);
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        run(() => search(true));
      }
    });
    searchBox.append(
      input,
      button('Quét mã', 'btn secondary', () => run(scan)),
    );
    left.append(searchBox);
    const grid = el('div', 'pos-grid');
    nodes.grid = grid;
    left.append(grid);
    nodes.more = button('Xem thêm sản phẩm', 'btn secondary', () => run(() => search(false, true)));
    left.append(nodes.more);
    const bh = el('div', 'pos-basket-head');
    bh.append(
      el('h2', '', 'Giỏ hàng'),
      button(st.customer?.name || 'Khách lẻ · Đổi', 'btn ghost small', chooseCustomer),
    );
    right.append(bh);
    nodes.customer = bh.lastChild;
    const policies = st.options.policies || [];
    const price = select(
      [
        [
          st.register.pricePolicyId,
          policies.find((p) => p.id === st.register.pricePolicyId)?.name || 'Giá bán lẻ (+ VAT)',
        ],
        [
          st.register.secondPricePolicyId,
          policies.find((p) => p.id === st.register.secondPricePolicyId)?.name || 'Giá bán lẻ',
        ],
      ],
      st.policy,
    );
    nodes.policy = price;
    price.setAttribute('aria-label', 'Chính sách giá');
    price.addEventListener('change', () => {
      st.policy = price.value;
      invalidate();
      run(() => search(false));
    });
    right.append(el('span', 'pos-note', 'Chính sách giá'), price);
    nodes.lines = el('div', 'pos-lines');
    right.append(nodes.lines);
    nodes.totals = el('div', 'pos-totals');
    right.append(nodes.totals);
    const methods = el('div', 'pos-pay-method');
    for (const [id, name] of [
      ['cash', 'Tiền mặt'],
      ['transfer', 'Chuyển khoản'],
    ]) {
      const b = button(name, 'btn secondary', () => {
        st.method = id;
        drawMethods();
        refreshPay();
      });
      b.dataset.method = id;
      methods.append(b);
    }
    nodes.methods = methods;
    right.append(methods);
    const tender = el('div', 'pos-tender'),
      f = field('Khách đưa', 'number');
    f.input.min = '0';
    f.input.step = '1';
    f.input.inputMode = 'numeric';
    f.input.addEventListener('input', refreshPay);
    nodes.tender = f.input;
    nodes.change = el('b', 'pos-change', '0 đ');
    const cb = el('div');
    cb.append(el('p', 'pos-note', 'Tiền thối'), nodes.change);
    f.box.append(
      button('Đủ tiền', 'btn secondary small', () => {
        if (st.preview) {
          nodes.tender.value = st.preview.total;
          refreshPay();
        }
      }),
    );
    tender.append(f.box, cb);
    nodes.tenderBox = tender;
    right.append(tender);
    nodes.transfer = el('label', 'pos-field');
    const check = el('input');
    check.type = 'checkbox';
    check.addEventListener('change', refreshPay);
    nodes.confirm = check;
    nodes.transfer.append(check, el('span', '', 'Tôi xác nhận cửa hàng đã thực nhận chuyển khoản'));
    right.append(nodes.transfer);
    const actions = el('div', 'pos-actions');
    nodes.temp = button('In bill tạm', 'btn secondary', () =>
      run(async () => {
        if (!st.cart.length) return;
        const d = await api('/pos/preview', 'POST', payload());
        try {
          printPos(d);
        } catch {
          toast('Đơn đã lưu. Bấm In lại bill nếu máy in chưa sẵn sàng.', 'err');
        }
      }),
    );
    nodes.qr = button('Hiện QR', 'btn secondary', () => run(qr));
    nodes.pay = button('Thu tiền & in', 'btn primary', () => pay(false));
    actions.append(nodes.temp, nodes.qr, nodes.pay);
    right.append(
      actions,
      button('Tạo đơn Ship COD', 'btn secondary', () => run(() => pay(true))),
      el('p', 'pos-note', 'Bill tạm chưa thanh toán, không trừ kho. VietQR chỉ là yêu cầu; cần xác nhận đã nhận tiền.'),
    );
    layout.append(left, right);
    page.append(layout);
    root.append(page);
    drawMethods();
    drawCart();
    refreshPay();
  }
  function drawMethods() {
    for (const b of nodes.methods.querySelectorAll('button'))
      b.setAttribute('aria-pressed', String(b.dataset.method === st.method));
    nodes.tenderBox.hidden = st.method !== 'cash';
    nodes.transfer.hidden = st.method !== 'transfer';
  }
  function add(p) {
    if (!active()) return toast('Mở ca trước khi thêm hàng.', 'err');
    if (st.pending || st.busy) return;
    const old = st.cart.find((x) => x.sku === p.sku);
    if (old) old.qty = Number(old.qty) + 1;
    else st.cart.push({ ...p, qty: 1, discountType: 'percent', discountValue: 0 });
    drawCart();
    invalidate();
    nodes.search.focus();
    nodes.search.select();
  }
  function drawCart() {
    nodes.lines.replaceChildren();
    lineTotals = new Map();
    if (!st.cart.length) nodes.lines.append(el('p', 'pos-note', 'Tìm hoặc quét sản phẩm để thêm vào giỏ.'));
    for (const x of st.cart) {
      const row = el('article', 'pos-line'),
        top = el('div', 'pos-line-top'),
        amount = el('strong');
      top.append(
        el('b', '', x.name),
        amount,
        button('×', 'btn ghost small', () => {
          if (st.pending) return;
          st.cart = st.cart.filter((r) => r !== x);
          drawCart();
          invalidate();
        }),
      );
      lineTotals.set(x.sku, amount);
      row.append(top, el('small', 'pos-note', x.sku));
      const edit = el('div', 'pos-line-edit'),
        qtyBox = el('div', 'pos-qty'),
        qty = el('input');
      qty.type = 'number';
      qty.min = '0.001';
      qty.step = '0.001';
      qty.value = x.qty;
      qty.setAttribute('aria-label', 'Số lượng ' + x.name);
      qty.addEventListener('input', () => {
        x.qty = Number(qty.value);
        invalidate();
      });
      qtyBox.append(
        button('−', 'btn secondary small', () => {
          if (st.pending) return;
          x.qty = Math.max(0.001, Number(x.qty) - 1);
          qty.value = x.qty;
          invalidate();
        }),
        qty,
        button('+', 'btn secondary small', () => {
          if (st.pending) return;
          x.qty = Number(x.qty) + 1;
          qty.value = x.qty;
          invalidate();
        }),
      );
      const disc = el('input');
      disc.type = 'number';
      disc.min = '0';
      disc.step = '1';
      disc.value = x.discountValue;
      disc.setAttribute('aria-label', 'Chiết khấu ' + x.name);
      disc.addEventListener('input', () => {
        x.discountValue = Number(disc.value);
        invalidate();
      });
      const mode = select(
        [
          ['percent', '%'],
          ['amount', 'đ/dòng'],
        ],
        x.discountType,
      );
      mode.setAttribute('aria-label', 'Loại chiết khấu ' + x.name);
      mode.addEventListener('change', () => {
        x.discountType = mode.value;
        x.discountValue = 0;
        disc.value = '0';
        invalidate();
      });
      edit.append(qtyBox, el('span', 'pos-note', 'Giảm'), disc, mode);
      row.append(edit);
      nodes.lines.append(row);
    }
    updateTotals();
  }
  function updateTotals() {
    nodes.totals.replaceChildren();
    const d = st.preview;
    for (const [label, value] of [
      ['Tiền trước thuế', d ? money(d.subtotal) : '—'],
      ['Chiết khấu từng dòng', d ? '−' + money(d.discount) : '—'],
      ['VAT', d ? money(d.tax) : '—'],
      ['Tổng cộng', d ? money(d.total) : st.cart.length ? 'Đang tính…' : '0 đ'],
    ]) {
      const row = el('div', 'pos-total-row' + (label === 'Tổng cộng' ? ' pos-total' : ''));
      row.append(el('span', '', label), el('strong', '', value));
      nodes.totals.append(row);
    }
    for (const x of d?.lines || []) lineTotals.get(x.sku)?.replaceChildren(document.createTextNode(money(x.total)));
    refreshPay();
  }
  function refreshPay() {
    if (!nodes.pay) return;
    const invalid = !active() || !st.preview || !st.cart.length || !!st.pending || st.busy;
    nodes.temp.disabled = invalid;
    nodes.qr.disabled = invalid;
    nodes.pay.disabled =
      invalid ||
      (st.method === 'transfer' && !nodes.confirm.checked) ||
      (st.method === 'cash' && Number(nodes.tender.value) < (st.preview?.total || 0));
    nodes.change.textContent = money(Math.max(0, Number(nodes.tender.value || 0) - (st.preview?.total || 0)));
    nodes.lines?.classList.toggle('pos-busy', !!st.pending || st.busy);
    for (const i of nodes.lines?.querySelectorAll('input,select,button') || []) i.disabled = !!st.pending || st.busy;
    nodes.policy.disabled = !!st.pending || st.busy;
  }
  async function preview() {
    const seq = ++previewSeq;
    if (!active() || !st.cart.length) {
      st.preview = null;
      updateTotals();
      return;
    }
    try {
      const d = await api('/pos/preview', 'POST', payload());
      if (seq !== previewSeq) return;
      st.preview = d;
      updateTotals();
    } catch (e) {
      if (seq !== previewSeq) return;
      st.preview = null;
      updateTotals();
      toast(e.message, 'err');
    }
  }
  async function search(addScanned = false, more = false) {
    if (!st.register) return;
    const seq = ++searchSeq,
      q = nodes.search?.value.trim() || '',
      offset = more ? st.offset : 0;
    const d = await api(
      `/pos/catalog?registerId=${encodeURIComponent(st.register.id)}&pricePolicyId=${encodeURIComponent(st.policy)}&q=${encodeURIComponent(q)}&offset=${offset}`,
    );
    if (seq !== searchSeq) return;
    st.offset = d.nextOffset;
    st.products = more ? [...st.products, ...d.products] : d.products;
    nodes.grid.replaceChildren();
    for (const p of st.products) {
      const b = button('', 'pos-product', () => add(p));
      if (p.imageUrl && /^https:\/\//.test(p.imageUrl)) {
        const im = el('img');
        im.src = p.imageUrl;
        im.alt = p.name;
        im.loading = 'lazy';
        b.append(im);
      } else b.append(el('span', 'pos-image-empty', 'Sản phẩm'));
      b.append(
        el('b', '', p.name),
        el('small', '', p.sku),
        el('strong', '', money(p.price)),
        el('small', p.available <= 0 ? 'pos-danger' : '', p.available <= 0 ? 'Hết hàng' : 'Khả dụng ' + p.available),
      );
      b.disabled = !active() || p.available <= 0 || !!st.pending;
      nodes.grid.append(b);
    }
    if (!st.products.length) nodes.grid.append(el('p', 'pos-note', 'Không tìm thấy sản phẩm.'));
    nodes.more.hidden = d.nextOffset == null;
    if (addScanned) {
      const p = d.products.find((p) => p.sku === q) || (d.products.length === 1 ? d.products[0] : null);
      if (p && p.available > 0) add(p);
      else toast('Chọn đúng sản phẩm trong danh sách.');
    }
  }
  async function scan() {
    if (!('BarcodeDetector' in window) || !navigator.mediaDevices?.getUserMedia) {
      nodes.search.focus();
      toast('Dùng máy quét cầm tay hoặc nhập mã vào ô tìm kiếm. Camera chưa được trình duyệt này hỗ trợ.');
      return;
    }
    const m = modal('Quét mã vạch'),
      video = el('video');
    video.autoplay = true;
    video.playsInline = true;
    video.style.width = '100%';
    m.body.append(video, button('Đóng', 'btn secondary', m.close));
    m.show();
    let stream = null,
      stop = false;
    const release = () => {
      stop = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
    m.dlg.addEventListener('close', release);
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      if (!m.dlg.open) {
        release();
        return;
      }
      video.srcObject = stream;
      await video.play();
      const detector = new BarcodeDetector();
      const tick = async () => {
        if (stop) return;
        try {
          const codes = await detector.detect(video);
          if (codes.length) {
            nodes.search.value = codes[0].rawValue;
            m.close();
            await search(true);
            return;
          }
        } catch {}
        if (!stop) setTimeout(tick, 250);
      };
      tick();
    } catch (e) {
      release();
      m.close();
      throw e;
    }
  }
  function chooseCustomer() {
    if (st.pending || st.busy) return;
    run(async () => {
      const m = modal('Chọn khách hàng'),
        input = el('input'),
        list = el('div', 'pos-customer-list');
      input.type = 'search';
      input.placeholder = 'Tên hoặc điện thoại';
      m.body.append(
        input,
        button('Khách lẻ', 'btn secondary', () => {
          st.customer = null;
          nodes.customer.textContent = 'Khách lẻ · Đổi';
          invalidate();
          m.close();
        }),
        button('+ Khách mới', 'btn secondary', () => {
          m.close();
          newCustomer();
        }),
        list,
        button('Đóng', 'btn secondary', m.close),
      );
      let seq = 0,
        timer;
      const find = async () => {
        const n = ++seq,
          d = await api('/pos/customers?q=' + encodeURIComponent(input.value));
        if (n !== seq || !m.dlg.open) return;
        list.replaceChildren(
          ...d.customers.map((c) =>
            button(c.name + ' · ' + c.phone, 'btn secondary', () => {
              st.customer = c;
              nodes.customer.textContent = c.name;
              invalidate();
              m.close();
            }),
          ),
        );
      };
      input.addEventListener('input', () => {
        clearTimeout(timer);
        timer = setTimeout(() => run(find), 200);
      });
      m.show();
      await find();
      input.focus();
    });
  }
  function newCustomer() {
    const m = formModal('Khách mới – dùng ngay'),
      name = field('Tên khách'),
      phone = field('Điện thoại', 'tel'),
      address = field('Địa chỉ');
    name.input.required = phone.input.required = true;
    m.form.append(name.box, phone.box, address.box);
    const save = el('button', 'btn primary', 'Lưu & chọn khách');
    save.type = 'submit';
    m.form.append(save, button('Huỷ', 'btn secondary', m.close));
    m.form.addEventListener('submit', (e) => {
      e.preventDefault();
      run(async () => {
        save.disabled = true;
        try {
          const c = await api('/pos/customers', 'POST', {
            name: name.input.value,
            phone: phone.input.value,
            address: address.input.value,
          });
          st.customer = c;
          nodes.customer.textContent = c.name;
          invalidate();
          m.close();
        } finally {
          save.disabled = false;
        }
      });
    });
    m.show();
  }
  async function openShift() {
    if (!st.register) return toast('Cấu hình quầy trước.', 'err');
    const m = formModal('Mở ca bán hàng'),
      reg = select(
        st.options.registers.map((r) => [r.id, r.name]),
        st.register.id,
      ),
      template = select(
        st.options.templates.map((t) => [t.id, `${t.name} ${t.startsAt}–${t.endsAt}`]),
        st.options.templates[0]?.id || '',
      ),
      cash = field('Tiền đầu ca trong két', 'number', '0'),
      note = field('Ghi chú ca'),
      counts = el('div');
    const drawer = await api('/cash');
    cash.input.value = drawer.nextOpeningCash ?? 0;
    cash.input.readOnly = true;
    cash.input.min = '0';
    cash.input.required = true;
    m.form.append(
      el('p', '', user().name),
      el('p', 'pos-note', 'Quầy'),
      reg,
      el('p', 'pos-note', 'Ca làm việc'),
      template,
      cash.box,
      el('p', 'pos-note', 'Tiền đầu ca kế thừa từ tiền thực đếm ca trước; ca đầu lấy số dư Manager đã chốt.'),
      el('h3', '', 'Đếm nhanh tồn kho'),
      counts,
      note.box,
    );
    if (!st.options.templates.length) template.append(new Option('Ca sáng 08:00–14:00', ''));
    let products = [],
      seq = 0;
    const getCounts = async () => {
      const n = ++seq,
        d = await api('/pos/opening-counts?registerId=' + encodeURIComponent(reg.value));
      if (n !== seq) return;
      products = d.counts;
      counts.replaceChildren(
        ...products.map((p) => {
          const row = el('label', 'pos-count-row'),
            inp = el('input');
          inp.type = 'number';
          inp.min = '0';
          inp.step = '.001';
          inp.required = true;
          inp.value = p.qty;
          p.input = inp;
          row.append(el('span', '', p.name + ' · sổ ' + p.qty), inp);
          return row;
        }),
      );
    };
    reg.addEventListener('change', () => run(getCounts));
    const b = el('button', 'btn primary', 'Bắt đầu bán');
    b.type = 'submit';
    m.form.append(b, button('Huỷ', 'btn secondary', m.close));
    const requestKey = key();
    m.form.addEventListener('submit', (e) => {
      e.preventDefault();
      run(async () => {
        b.disabled = true;
        try {
          await api('/pos/shifts/open', 'POST', {
            key: requestKey,
            registerId: reg.value,
            templateId: template.value,
            openingCash: Number(cash.input.value),
            note: note.input.value,
            counts: products.map((p) => ({ sku: p.sku, countedQty: Number(p.input.value) })),
          });
          m.close();
          st.cart = [];
          await load();
        } finally {
          b.disabled = false;
        }
      });
    });
    m.show();
    await getCounts();
  }
  function reportRows(container, d) {
    for (const [k, v] of [
      ['Số bill', d.bills.count],
      ['Doanh thu theo bill', money(d.bills.revenue)],
      ['Giảm giá', money(d.bills.discount)],
      ['Tiền mặt thực thu', money(d.cash)],
      ['Chuyển khoản đã xác nhận', money(d.transfer)],
      ['Tiền đầu ca', money(d.shift.openingCash)],
      ...(d.manual || []).map((x) => [
        (x.direction === 'in' ? '+ ' : '− ') + x.kind,
        money(x.direction === 'in' ? x.amount : -x.amount),
      ]),
      ['Tiền két hệ thống', money(d.expectedCash)],
    ]) {
      const row = el('div', 'pos-total-row');
      row.append(el('span', '', k), el('b', '', v));
      container.append(row);
    }
    container.append(el('h3', '', 'Ship COD'));
    for (const [name, k] of [
      ['Đã giao & đã thu trong ca', 'receivedInShift'],
      ['Thu COD từ ca trước', 'receivedFromPrevious'],
      ['Đã giao, chưa thu', 'pending'],
    ]) {
      const x = d.cod[k];
      const r = el('div', 'pos-total-row');
      r.append(el('span', '', name), el('b', '', `${x.count} đơn · ${money(x.amount)}`));
      container.append(r);
    }
    container.append(el('p', 'pos-note', 'COD chưa thu không tính vào tiền két; tiếp tục theo dõi sang ca sau.'));
  }
  async function closeShift() {
    if (dirty()) return toast('Xử lý giỏ hàng hoặc giao dịch chưa rõ kết quả trước khi kết ca.', 'err');
    if (onCloseShift) {
      await onCloseShift();
      await load();
    } else go('#/cash');
  }
  async function history() {
    const m = modal('Báo cáo ca'),
      list = el('div', 'pos-customer-list');
    for (const s of st.options.shifts) {
      list.append(
        button(`${when(s.openedAt)} · ${s.closedAt ? 'Đã kết' : 'Đang mở'} · ${s.memberId}`, 'btn secondary', () =>
          run(async () => {
            const d = await api('/pos/shifts/' + s.id);
            const detail = modal('Báo cáo ca ' + when(s.openedAt));
            reportRows(detail.body, d);
            if (s.closedAt) {
              detail.body.append(
                el('p', '', `Thực đếm ${money(d.countedCash)} · Lệch ${money(d.cashDifference)}`),
                el('p', '', d.differenceReason || ''),
              );
            }
            detail.body.append(
              button('In K80', 'btn primary', () => printPos(d, 'shift')),
              button('Đóng', 'btn secondary', detail.close),
            );
            detail.show();
          }),
        ),
      );
    }
    m.body.append(list, button('Đóng', 'btn secondary', m.close));
    m.show();
  }
  async function qr() {
    const d = await api('/pos/qr', 'POST', { ...payload(), key: key() }),
      m = modal('VietQR – chờ xác nhận thu');
    st.qr = d;
    const image = el('img', 'pos-qr');
    image.src = d.url;
    image.alt = 'VietQR thanh toán';
    m.body.append(
      el('p', '', money(d.amount)),
      image,
      el('p', '', 'Nội dung: ' + d.content),
      el('p', 'pos-note', 'Chỉ xác nhận khi cửa hàng thực nhận tiền. Hiện QR chưa ghi phiếu thu.'),
      button('Đã nhận tiền – thu & in', 'btn primary', async () => {
        if (!(await confirmBox('Cửa hàng đã thực nhận đủ ' + money(d.amount) + ' qua chuyển khoản?'))) return;
        st.method = 'transfer';
        nodes.confirm.checked = true;
        drawMethods();
        await pay(false, d.id);
        if (!st.pending) m.close();
      }),
      button('Đóng', 'btn secondary', m.close),
    );
    m.show();
  }
  async function pay(cod = false, qrId) {
    if (st.busy || st.pending) return;
    if (!active() || !st.preview || !st.cart.length) return toast('Mở ca và chọn hàng trước.', 'err');
    if (cod) {
      const m = formModal('Giao Ship COD'),
        address = field('Địa chỉ giao'),
        phone = field('Điện thoại người nhận', 'tel', st.customer?.phone || ''),
        receiver = field('Người nhận', 'text', st.customer?.name || ''),
        date = field(
          'Ngày giao',
          'date',
          new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date()),
        );
      address.input.required = phone.input.required = receiver.input.required = true;
      m.form.append(
        receiver.box,
        phone.box,
        address.box,
        date.box,
        el('p', 'pos-note', 'Chưa ghi thu. Đơn dùng chung lịch giao hàng và phiếu đóng gói hiện có.'),
      );
      const save = el('button', 'btn primary', 'Tạo đơn COD');
      save.type = 'submit';
      m.form.append(save, button('Huỷ', 'btn secondary', m.close));
      m.form.addEventListener('submit', (e) => {
        e.preventDefault();
        save.disabled = true;
        const body = {
          ...payload(),
          key: key(),
          fulfillmentMode: 'cod',
          delivery: {
            address: address.input.value,
            receiverName: receiver.input.value,
            receiverPhone: phone.input.value,
            plannedDate: date.input.value,
          },
        };
        m.close();
        submit(body);
      });
      m.show();
      return;
    }
    if (st.method === 'transfer' && !nodes.confirm.checked) return toast('Xác nhận đã thực nhận chuyển khoản.', 'err');
    await submit({
      ...payload(),
      key: key(),
      method: st.method,
      tendered: Number(nodes.tender.value || 0),
      confirmed: st.method === 'transfer',
      ...(qrId ? { paymentRequestId: qrId } : {}),
    });
  }
  async function submit(body) {
    if (st.busy) return;
    persistPending(body);
    st.busy = true;
    refreshPay();
    try {
      const d = await api('/pos/checkout', 'POST', body);
      persistPending(null);
      st.cart = [];
      st.customer = null;
      st.preview = null;
      st.qr = null;
      st.policy = st.register.pricePolicyId;
      st.method = 'cash';
      try {
        printPos(d);
      } catch {
        toast('Đơn đã lưu. Bấm In lại bill nếu máy in chưa sẵn sàng.', 'err');
      }
      toast('Đã lưu ' + d.orderNo + '. Nếu chưa in được, dùng In lại bill.');
      const saved = modal('Đã lưu ' + d.orderNo);
      saved.body.append(
        el('p', '', money(d.total)),
        button('In lại bill', 'btn secondary', () => printPos(d)),
        button('Bán đơn tiếp', 'btn primary', saved.close),
      );
      saved.show();
      await load();
    } catch (e) {
      if (e.status >= 400 && e.status < 500) {
        persistPending(null);
        toast(e.message, 'err');
      } else {
        toast('Chưa rõ kết quả. Bấm Kiểm tra lại giao dịch để lấy đúng đơn, không thu lần nữa.', 'err');
        draw();
      }
    } finally {
      st.busy = false;
      refreshPay();
    }
  }
  async function codList() {
    if (!active()) return toast('Mở ca để theo dõi và thu COD.', 'err');
    const d = await api('/pos/cod?shiftId=' + st.shift.id),
      m = modal('Ship COD của quầy');
    if (!d.deliveries.length) m.body.append(el('p', '', 'Không có đơn COD chưa thu.'));
    for (const x of d.deliveries) {
      const row = el('div', 'pos-cod-row');
      row.append(
        el('b', '', x.orderNo + ' · ' + x.customer),
        el(
          'p',
          '',
          x.deliveryNo +
            ' · ' +
            (x.status === 'delivered' ? 'Đã giao' : 'Chưa giao') +
            ' · ' +
            money(x.codAmount - x.paid),
        ),
      );
      if (x.status === 'delivered') {
        const method = select(
            [
              ['cash', 'Thực nhận tiền mặt'],
              ['transfer', 'Thực nhận chuyển khoản'],
            ],
            'cash',
          ),
          b = button('Xác nhận đã thu', 'btn primary', () =>
            run(async () => {
              if (!(await confirmBox('Cửa hàng đã thực nhận ' + money(x.codAmount - x.paid) + '?'))) return;
              b.disabled = true;
              try {
                await api('/pos/cod/' + x.id + '/collect', 'POST', {
                  key: requestKey,
                  shiftId: st.shift.id,
                  method: method.value,
                  confirmed: true,
                });
                m.close();
                toast('Đã ghi thu vào ca hiện tại.');
              } finally {
                b.disabled = false;
              }
            }),
          ),
          requestKey = key();
        row.append(method, b);
      }
      const perms = user().perms || [];
      if (user().role === 'manager' || perms.includes('page.deliveries'))
        row.append(
          button('Mở chuyến giao', 'btn secondary', () => {
            m.close();
            go('#/deliveries?deliveryId=' + encodeURIComponent(x.id));
          }),
        );
      m.body.append(row);
    }
    m.body.append(button('Đóng', 'btn secondary', m.close));
    m.show();
  }
  function configure(forceNew = false) {
    const m = formModal('Cấu hình quầy POS'),
      existing = forceNew ? null : st.register,
      fields = el('div', 'pos-config-fields'),
      name = field('Tên quầy', 'text', existing?.name || 'Quầy 1'),
      address = field('Địa chỉ cửa hàng', 'text', existing?.address || ''),
      phone = field('Điện thoại cửa hàng', 'tel', existing?.phone || ''),
      bank = field('Mã ngân hàng VietQR', 'text', existing?.bankCode || ''),
      account = field('Số tài khoản', 'text', existing?.bankAccount || ''),
      holder = field('Tên chủ tài khoản', 'text', existing?.bankAccountName || ''),
      tax = field('Thuế suất VAT (%)', 'number', existing?.taxRate ?? 8);
    const policies = st.options.policies || [],
      vatDefault = policies.find((p) => /vat/i.test(p.name))?.id || '',
      baseDefault = policies.find((p) => !/vat/i.test(p.name) && /bán lẻ|ban le/i.test(p.name))?.id || '';
    const wh = select(
        st.options.warehouses.map((w) => [w.id, w.name]),
        existing?.warehouseId || st.options.warehouses[0]?.id || '',
      ),
      vat = select(
        policies.map((p) => [p.id, p.name]),
        existing?.pricePolicyId || vatDefault,
      ),
      base = select(
        policies.map((p) => [p.id, p.name]),
        existing?.secondPricePolicyId || baseDefault,
      );
    for (const [label, input] of [
      ['Kho đã chốt tồn đầu kỳ', wh],
      ['Giá bán lẻ (+ VAT) – mặc định', vat],
      ['Giá bán lẻ – không VAT', base],
    ]) {
      const box = el('label', 'pos-field');
      box.append(el('span', '', label), input);
      fields.append(box);
    }
    for (const f of [name, address, phone, tax, bank, account, holder]) fields.append(f.box);
    m.form.append(
      fields,
      el('p', 'pos-note', 'Chiết khấu VNĐ áp dụng trên cả dòng. Quầy chỉ bán sau khi kho đã chốt tồn đầu kỳ.'),
    );
    const save = el('button', 'btn primary', 'Lưu quầy');
    save.type = 'submit';
    m.form.append(save, button('Đóng', 'btn secondary', m.close));
    m.form.addEventListener('submit', (e) => {
      e.preventDefault();
      run(async () => {
        save.disabled = true;
        try {
          const saved = await api('/pos/registers', 'POST', {
            id: existing?.id,
            name: name.input.value,
            warehouseId: wh.value,
            pricePolicyId: vat.value,
            secondPricePolicyId: base.value,
            taxRate: Number(tax.input.value),
            priceIncludesVat: true,
            address: address.input.value,
            phone: phone.input.value,
            bankCode: bank.input.value,
            bankAccount: account.input.value,
            bankAccountName: holder.input.value,
          });
          st.register = { id: saved.id };
          m.close();
          await load();
          toast('Đã lưu cấu hình.');
        } finally {
          save.disabled = false;
        }
      });
    });
    const extra = el('details'),
      summary = el('summary', '', 'Thêm ca làm việc / mã vạch');
    extra.append(summary);
    const tn = field('Tên ca'),
      start = field('Giờ bắt đầu', 'time', '08:00'),
      end = field('Giờ kết thúc', 'time', '14:00');
    extra.append(
      tn.box,
      start.box,
      end.box,
      button('Thêm ca', 'btn secondary', () =>
        run(async () => {
          await api('/pos/templates', 'POST', {
            name: tn.input.value,
            startsAt: start.input.value,
            endsAt: end.input.value,
          });
          toast('Đã thêm ca.');
        }),
      ),
    );
    const sku = field('Mã hàng SKU'),
      barcode = field('Mã vạch');
    extra.append(
      sku.box,
      barcode.box,
      button('Gắn mã vạch', 'btn secondary', () =>
        run(async () => {
          await api('/pos/barcodes', 'POST', { sku: sku.input.value, barcode: barcode.input.value });
          toast('Đã gắn mã vạch.');
        }),
      ),
    );
    m.body.append(extra);
    m.show();
  }
  window.addEventListener('beforeunload', (e) => {
    if (dirty() && location.hash.startsWith('#/pos')) {
      e.preventDefault();
      e.returnValue = '';
    }
  });
  return { load, dirty };
}
