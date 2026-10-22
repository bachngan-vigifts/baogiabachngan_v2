import { bindCustomerDuplicateCheck } from './customer-duplicate-check.js';
import { posCustomerIssue } from './pos-customer.js';
import { customerFormFields } from './customer-form-fields.js';
import { webOrderFinancialSummary } from './web-order-financials.js';
import { openPosOrderFlows } from './pos-order-flow.js';
import { openPosReturns } from './pos-returns.js';
import { startBarcodeCamera } from './barcode-camera.js';
import { printPos } from './pos-print.js';
import { renderShiftReport } from './shift-report-view.js';
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
const ghnPortalLink = (orderCode = '', label = '') => {
  const a = el('a', 'btn primary', label || (orderCode ? 'Mở đơn trên GHN' : 'Mở GHN tạo vận đơn'));
  a.href = orderCode
    ? 'https://khachhang.ghn.vn/order/detail?order_code=' + encodeURIComponent(orderCode)
    : 'https://khachhang.ghn.vn/order/create';
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  return a;
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
/** Ô voucher trống của giỏ (mã / ghi chú, kiểu VNĐ | %, giá trị). */
const emptyVoucher = () => ({ code: '', type: 'amount', value: '' });
export function initPos({ api, root, toast, user, confirmBox, go, onCloseShift }) {
  const st = {
    options: null,
    shift: null,
    register: null,
    policy: '',
    cart: [],
    customer: null,
    serviceFees: [], shippingFee: '', note: '', exchangeAllocationId: '', voucher: emptyVoucher(),
    preview: null,
    method: 'cash',
    qr: null,
    busy: false,
    pending: null,
    products: [],
    orderBoard: null,
    orderStatus: 'all',
    orderQuery: '',
    orderFilters: { source: 'all', ownerId: '', from: '', to: '', payment: 'all' },
    orderBoardRequest: 0,
    orderRegisterId: '',
    productFilter: 'all',
    catalogLoading: false,
    offset: 0,
    request: 0,
    showMenu: false,
  };
  let paymentModal = null;
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
  /** Nút gọi API: khoá và đổi chữ khi đang chạy, mở lại khi xong (kể cả lỗi) – chống bấm trùng. */
  const busyButton = (text, cls, busyText, fn) => {
    const b = button(text, cls);
    b.addEventListener('click', async () => {
      if (b.dataset.busy) return;
      b.dataset.busy = '1'; b.disabled = true; b.textContent = busyText; b.classList?.add('is-busy');
      try { await run(fn); } finally { delete b.dataset.busy; b.disabled = false; b.textContent = text; b.classList?.remove('is-busy'); }
    });
    return b;
  };
  const pendingKey = () => 'bn-pos-pending:' + user().id;
  function restorePending() {
    if (pendingUser === user().id) return;
    pendingUser = user().id;
    st.qr = null;
    st.register = null;
    st.policy = '';
    st.cart = [];
    st.customer = null;
    st.serviceFees = []; st.shippingFee = ''; st.note = ''; st.voucher = emptyVoucher(); st.exchangeAllocationId = '';
    st.preview = null;
    st.pending = null;
    st.method = 'cash';
    st.shift = null;
    st.showMenu = false;
    st.orderBoard = null;
    st.orderStatus = 'all';
    st.orderQuery = '';
    st.orderFilters = { source: 'all', ownerId: '', from: '', to: '', payment: 'all' };
    st.orderBoardRequest++;
    st.orderRegisterId = '';
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
  /** Voucher gửi máy chủ: chỉ khi đã gõ mã hoặc số tiền (máy chủ kiểm: bắt buộc mã, không vượt tiền hàng). */
  const voucherInput = () => {
    const code = st.voucher.code.trim(), value = Number(st.voucher.value) || 0;
    return code || value ? { code, type: st.voucher.type, value } : null;
  };
  const payload = () => ({
    registerId: st.register.id,
    shiftId: st.shift.id,
    pricePolicyId: st.policy,
    customerId: st.customer?.id || '',
    ...(st.note.trim() ? { note: st.note } : {}),
    ...(st.exchangeAllocationId ? {exchangeAllocationId:st.exchangeAllocationId} : {}),
    ...(voucherInput() ? { voucher: voucherInput() } : {}),
    ...(st.serviceFees.length || st.shippingFee ? { serviceFees: st.serviceFees.map(f => ({ name: f.name, quantity: f.quantity || 1, unitPrice: f.unitPrice || 0 })), shippingFee: st.shippingFee || 0 } : {}),
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
    if (nodes.confirm) { nodes.confirm.checked = false; nodes.confirm.disabled = false; }
    if (nodes.transferLabel) nodes.transferLabel.textContent = 'Tôi xác nhận cửa hàng đã thực nhận chuyển khoản';
    refreshPay();
    clearTimeout(previewTimer);
    previewTimer = setTimeout(preview, 180);
  }
  function modal(title) {
    const dlg = el('dialog', 'pos-modal'),
      body = el('div', 'pos-modal-content');
    const close = () => {
      dlg.close();
      dlg.remove();
    };
    const closeButton = button('×', 'icon-btn pos-modal-close', () => { if (!dlg.dataset.busy) close(); });
    closeButton.setAttribute('aria-label', 'Đóng');
    closeButton.title = 'Đóng';
    body.append(el('h2', '', title), closeButton);
    dlg.append(body);
    document.body.append(dlg);
    dlg.addEventListener('close', () => dlg.remove());
    dlg.addEventListener('cancel', (e) => { e.preventDefault?.(); if (!dlg.dataset.busy) close(); });
    /** Đang gửi máy chủ: khoá cả form (nút, ô nhập, nút ×, phím Esc) để không bấm trùng hay đóng giữa chừng. */
    const lock = (on, primary, label) => {
      on ? (dlg.dataset.busy = '1') : delete dlg.dataset.busy;
      dlg.classList.toggle('pos-modal-busy', on);
      for (const x of dlg.querySelectorAll('button,input,select,textarea')) {
        if (on) { x.dataset.wasDisabled = x.disabled ? '1' : ''; x.disabled = true; }
        else if ('wasDisabled' in x.dataset) { x.disabled = x.dataset.wasDisabled === '1'; delete x.dataset.wasDisabled; }
      }
      if (primary) {
        if (on) { primary.dataset.label = primary.textContent; primary.textContent = label; primary.classList.add('is-busy'); primary.setAttribute('aria-busy', 'true'); }
        else { if (primary.dataset.label != null) primary.textContent = primary.dataset.label; delete primary.dataset.label; primary.classList.remove('is-busy'); primary.setAttribute('aria-busy', 'false'); }
      }
    };
    return { dlg, body, close, lock, show: () => dlg.showModal() };
  }
  /** Ô chọn Tỉnh / Quận / Phường theo danh mục GHN (dùng chung cho đơn COD tại quầy và đơn website). */
  function ghnLocationFields(loadLocations) {
    const pick = (label) => { const box = el('label', 'pos-field'), s = select([['', 'Đang tải…']], ''); box.append(el('span', '', label), s); return { box, select: s }; };
    const province = pick('Tỉnh / Thành phố'), district = pick('Quận / Huyện'), ward = pick('Phường / Xã');
    const fill = (s, rows, placeholder) => { s.replaceChildren(); const first = el('option', '', placeholder); first.value = ''; s.append(first); for (const x of rows || []) { const op = el('option', '', x.name); op.value = x.id; s.append(op); } s.disabled = false; };
    fill(district.select, [], 'Chọn Tỉnh / Thành trước'); fill(ward.select, [], 'Chọn Quận / Huyện trước');
    district.select.disabled = true; ward.select.disabled = true;
    const retry = button('Tải lại địa chỉ GHN', 'btn secondary small'); retry.hidden = true;
    const loadProvinces = async () => {
      retry.disabled = true; fill(province.select, [], 'Đang tải Tỉnh / Thành phố…'); province.select.disabled = true;
      try { fill(province.select, await loadLocations(), 'Chọn Tỉnh / Thành phố'); retry.hidden = true; }
      catch (e) { fill(province.select, [], 'Không tải được địa chỉ GHN'); province.select.disabled = true; retry.hidden = false; toast(e.message, 'err'); }
      finally { retry.disabled = false; }
    };
    retry.addEventListener('click', () => run(loadProvinces));
    province.select.addEventListener('change', () => run(async () => {
      fill(ward.select, [], 'Chọn Quận / Huyện trước'); ward.select.disabled = true;
      fill(district.select, [], 'Đang tải Quận / Huyện…'); district.select.disabled = true;
      fill(district.select, await loadLocations({ provinceId: province.select.value }), 'Chọn Quận / Huyện');
    }));
    district.select.addEventListener('change', () => run(async () => {
      fill(ward.select, [], 'Đang tải Phường / Xã…'); ward.select.disabled = true;
      fill(ward.select, await loadLocations({ districtId: district.select.value }), 'Chọn Phường / Xã');
    }));
    const chosen = s => s.options[s.selectedIndex]?.textContent || '';
    return {
      province, district, ward, retry, loadProvinces, chosen,
      complete: () => !!(province.select.value && district.select.value && ward.select.value),
      fullAddress: (line) => [line.trim(), chosen(ward.select), chosen(district.select), chosen(province.select)].filter(Boolean).join(', '),
    };
  }
  function formModal(title) {
    const m = modal(title),
      form = el('form');
    m.body.append(form);
    return { ...m, form };
  }
  const active = () => !!st.shift && !st.shift.closedAt;
  function dirty() {
    return !!st.pending || st.cart.length > 0 || !!st.exchangeAllocationId;
  }
  async function load() {
    restorePending();
    const seq = ++st.request;
    const d = await run(() => api('/pos/options' + (st.register?.id ? '?registerId=' + encodeURIComponent(st.register.id) : '')));
    if (!d || seq !== st.request) return;
    st.options = d;
    st.shift = d.current;
    st.register =
      d.registers.find((x) => x.id === st.shift?.registerId) ||
      d.registers.find((x) => x.id === st.register?.id) ||
      d.registers.find((x) => x.id === d.defaultRegisterId) ||
      d.registers[0] ||
      null;
    if (!st.register || ![st.register.pricePolicyId, st.register.secondPricePolicyId].includes(st.policy))
      st.policy = st.register?.pricePolicyId || '';
    draw();
    if (st.register) await Promise.all([search(false), run(loadOrderBoard)]);
    if (st.cart.length && active()) await preview();
  }
  let cartResizeObserver;
  function draw() {
    cartResizeObserver?.disconnect();
    root.replaceChildren();
    const page = el('div', 'pos-page' + (st.showMenu ? ' pos-show-menu' : '')),
      head = el('div', 'pos-head'),
      title = el('div'),
      tools = el('div', 'pos-head-tools');
    title.append(el('h1', '', 'Bán hàng nhanh'), button('← Về CRM', 'btn secondary small', () => go('#/tasks')), el('span', 'pos-register-name', st.register?.name || (st.options?.canConfigure ? 'Chưa cấu hình quầy' : 'Chưa được giao quầy – nhờ Manager phân quầy theo chức vụ')));
    head.append(title, tools);
    const menu = button('☰ Menu CRM', 'btn secondary pos-menu-toggle', () => {
      st.showMenu = !st.showMenu;
      page.classList.toggle('pos-show-menu', st.showMenu);
      menu.setAttribute('aria-expanded', String(st.showMenu));
    });
    menu.setAttribute('aria-expanded', String(st.showMenu));
    title.append(menu);
    page.append(head);
    const template = st.options.templates?.find(t => t.id === st.shift?.templateId),
      shiftLabel = active()
        ? `${template?.name || 'Ca bán hàng'}${template ? ` · ${template.startsAt}–${template.endsAt}` : ''} · Đang mở`
        : 'Chưa mở ca';
    tools.append(el('span', 'pos-shift-status' + (active() ? ' is-open' : ''), (active() ? '● ' : '○ ') + shiftLabel));
    if ((!active() || st.options.canChooseOpenRegister) && st.options.registers.length > 1) {
      const regSelect = select(
        st.options.registers.map((r) => [r.id, r.name]),
        st.register?.id,
      );
      regSelect.setAttribute('aria-label', 'Chọn quầy');
      regSelect.addEventListener('change', () => {
        if (dirty()) { regSelect.value = st.register.id; toast('Hoàn tất hoặc huỷ đơn hiện tại trước khi đổi quầy.', 'err'); return; }
        st.register = st.options.registers.find((r) => r.id === regSelect.value);
        st.policy = st.register.pricePolicyId;
        st.orderRegisterId = st.register.id;
        st.orderBoard = null;
        st.shift = null;
        invalidate();
        draw();
        run(load);
      });
      tools.append(regSelect);
    }
    if (!active() || st.options.canCloseCurrent !== false) tools.append(button(active() ? 'Kết ca' : 'Mở ca', active() ? 'btn pos-close-shift' : 'btn primary', () => run(active() ? closeShift : openShift)));
    else { const shared = el('span', 'pos-note pos-shared-shift-note', 'Ca dùng chung'); shared.setAttribute('title', 'Người mở ca: ' + (st.shift.memberName || 'cửa hàng')); tools.append(shared); }
    const more = el('details', 'pos-more-menu'), moreSummary = el('summary', '', '⋯'), morePanel = el('div', 'pos-more-panel');
    moreSummary.setAttribute('aria-label', 'Thao tác khác');
    const menuAction = (label, fn) => { const b = button(label, 'btn ghost', () => { more.open = false; fn(); }); morePanel.append(b); };
    menuAction('Trả / Đổi / Hoàn', openReturns);
    menuAction('Báo cáo ca', () => run(history));
    menuAction('Ship COD', () => run(() => codList()));
    if(st.options.orderFlowVersion>=1)menuAction('Đơn cọc đang xử lý',()=>run(flowOrders));
    menuAction('In bill tạm', () => run(printTemporary));
    menuAction('Chọn bảng giá', choosePricePolicy);
    if (st.options.canConfigure) { menuAction('Cấu hình', () => configure()); menuAction('+ Quầy', () => configure(true)); }
    more.append(moreSummary, morePanel); tools.append(more);
    if (!st.register) {
      page.append(el('div', 'pos-warning', 'Manager cần cấu hình quầy, kho và hai chính sách giá trước khi bán.'));
      root.append(page);
      return;
    }
    if (!active()) page.append(el('div', 'pos-warning', 'Mở ca trước khi bán.'));
    if (st.pending) {
      const warn = el('div', 'pos-warning');
      warn.append(
        el('p', '', 'Có giao dịch chưa xác định kết quả. Kiểm tra lại trước khi bán đơn khác để tránh thu hai lần.'),
        button('Kiểm tra lại giao dịch', 'btn primary', () => submit(st.pending)),
      );
      page.append(warn);
    }
    const orderBoard = el('section', 'pos-card pos-order-board');
    nodes.orderBoard = orderBoard;
    renderOrderBoard();
    const layout = el('div', 'pos-layout'),
      left = el('section', 'pos-card pos-catalog'),
      right = el('section', 'pos-card pos-checkout'),
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
    const policies = st.options.policies || [];
    const price = select(
      [
        [st.register.pricePolicyId, policies.find((p) => p.id === st.register.pricePolicyId)?.name || 'Giá bán lẻ (+ VAT)'],
        [st.register.secondPricePolicyId, policies.find((p) => p.id === st.register.secondPricePolicyId)?.name || 'Giá bán lẻ'],
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
    const catalogTools = el('div', 'pos-catalog-tools'), priceField = el('label', 'pos-policy pos-policy-compact');
    priceField.append(el('span', 'pos-note', 'Chính sách giá'), price);
    catalogTools.append(priceField, button('Tìm tất cả SP', 'btn secondary pos-find-all', () => {
      nodes.search.value = '';
      st.productFilter = 'all';
      run(() => search(false));
    }));
    const filters = el('div', 'pos-product-filters');
    for (const [id, label] of [['all','Tất cả'],['available','Còn hàng'],['low','Còn ít hàng'],['out','Hết hàng']]) {
      const b = button(label, 'btn pos-filter' + (st.productFilter === id ? ' active' : ''), () => { st.productFilter = id; renderProducts(); });
      b.dataset.filter = id; filters.append(b);
    }
    filters.hidden = true;
    const filterToggle = button('Xem bộ lọc ▾', 'btn ghost pos-filter-toggle', () => {
      filters.hidden = !filters.hidden;
      filterToggle.textContent = filters.hidden ? 'Xem bộ lọc ▾' : 'Ẩn bộ lọc ▴';
      filterToggle.setAttribute('aria-expanded', String(!filters.hidden));
    });
    filterToggle.setAttribute('aria-expanded', 'false');
    left.append(searchBox, catalogTools, filterToggle, filters);
    const grid = el('div', 'pos-grid');
    nodes.grid = grid;
    grid.addEventListener('scroll', () => {
      if (st.offset != null && !st.catalogLoading && grid.scrollTop + grid.clientHeight >= grid.scrollHeight - 120)
        run(() => search(false, true));
    });
    left.append(grid);
    nodes.more = button('Xem thêm sản phẩm', 'btn secondary', () => run(() => search(false, true)));
    left.append(nodes.more);
    const bh = el('div', 'pos-basket-head'), basketTitle = el('div');
    nodes.cartCount = el('span', 'pos-cart-count', `${st.cart.length} món`);
    basketTitle.append(el('h2', '', 'Đơn hiện tại'), nodes.cartCount);
    bh.append(basketTitle);
    bh.append(button((st.customer?.name || 'Chọn khách hàng *') + '   Đổi ▾', 'btn primary pos-customer-trigger', chooseCustomer));
    right.append(bh);
    nodes.customer = bh.lastChild;
    nodes.lines = el('div', 'pos-lines');
    right.append(nodes.lines);
    drawFees(right);
    nodes.totals = el('div', 'pos-totals');
    right.append(nodes.totals);
    const actions = el('div', 'pos-main-actions');
    actions.append(
      button('Hủy đơn', 'btn secondary pos-cancel-order', cancelCurrentOrder),
      (nodes.pay = button('THANH TOÁN', 'btn primary pos-open-payment', openPayment)),
    );
    right.append(actions);
    layout.append(left, right);
    const mobileDock = el('div', 'pos-mobile-cart-dock'), mobileInfo = el('div', 'pos-mobile-cart-info');
    nodes.mobileCartCount = el('strong', '', 'Đơn hiện tại · 0 món');
    nodes.mobileCartCustomer = el('small', '', 'Chưa chọn khách hàng');
    nodes.mobileCartTotal = el('b', '', '0 đ');
    nodes.mobileCartOpen = button('Xem đơn ›', 'btn primary pos-mobile-cart-open', () => right.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    mobileInfo.append(nodes.mobileCartCount, nodes.mobileCartCustomer);
    mobileDock.append(mobileInfo, nodes.mobileCartTotal, nodes.mobileCartOpen);
    page.append(layout, mobileDock, orderBoard);
    root.append(page);
    drawCart();
    refreshPay();
  }
  const orderLabels = {
    all: 'Tất cả đơn', pending: 'Chờ xử lý', packing: 'Đang đóng hàng',
    waiting_delivery: 'Đợi giao', completed: 'Hoàn thành', cancelled: 'Đã hủy',
  };
  async function loadOrderBoard() {
    if (!st.register) return;
    const registerId = st.orderRegisterId || st.register.id;
    const p = new URLSearchParams({ registerId, status: st.orderStatus });
    if (st.orderQuery) p.set('q', st.orderQuery);
    for (const [key, value] of Object.entries(st.orderFilters)) if (value) p.set(key, value);
    const request = ++st.orderBoardRequest;
    const d = await api('/pos/orders?' + p);
    if (request !== st.orderBoardRequest) return;
    st.orderBoard = d;
    st.orderRegisterId = d.registerId;
    renderOrderBoard();
  }
  function renderOrderBoard() {
    const box = nodes.orderBoard;
    if (!box) return;
    box.replaceChildren();
    const head = el('div', 'pos-order-head'), title = el('div');
    title.append(el('h2', '', 'Đơn hàng cửa hàng'), el('p', 'pos-note', 'Theo dõi đơn Lock và Minh Long theo đúng quầy phát sinh.'));
    head.append(title);
    const d = st.orderBoard;
    if (d?.registers?.length > 1) {
      const reg = select(d.registers.map(r => [r.id, r.name]), st.orderRegisterId || d.registerId);
      reg.setAttribute('aria-label', 'Lọc đơn theo cửa hàng');
      reg.addEventListener('change', () => { st.orderRegisterId = reg.value; st.orderFilters.ownerId = ''; run(loadOrderBoard); });
      head.append(reg);
    }
    box.append(head);
    if (!d) { box.append(el('p', 'pos-note', 'Đang tải đơn hàng…')); return; }
    const filters = el('div', 'pos-order-filters');
    const addFilter = (labelText, key, choices, type = '') => {
      const label = el('label'), caption = el('span', 'pos-note', labelText);
      const input = choices ? select(choices, st.orderFilters[key]) : el('input');
      if (type) { input.type = type; input.value = st.orderFilters[key]; }
      input.setAttribute('aria-label', labelText);
      input.addEventListener('change', () => { st.orderFilters[key] = input.value; run(loadOrderBoard); });
      label.append(caption, input); filters.append(label);
    };
    addFilter('Nguồn đơn', 'source', [['all', 'Tất cả nguồn'], ['pos', 'POS tại quầy'], ['web', 'Đơn website'], ['cod', 'POS giao COD']]);
    addFilter('Nhân viên bán', 'ownerId', [['', 'Tất cả nhân viên'], ...(d.owners || []).map(o => [o.id, o.name])]);
    addFilter('Từ ngày', 'from', null, 'date');
    addFilter('Đến ngày', 'to', null, 'date');
    addFilter('Thanh toán', 'payment', [['all', 'Tất cả thanh toán'], ['paid', 'Đã thanh toán đủ'], ['debt', 'Còn nợ'], ['unknown', 'Chưa rõ thanh toán']]);
    filters.append(button('Xóa bộ lọc', 'btn secondary', () => {
      st.orderFilters = { source: 'all', ownerId: '', from: '', to: '', payment: 'all' };
      st.orderQuery = ''; st.orderStatus = 'all'; run(loadOrderBoard);
    }));
    box.append(filters);
    const summary = el('div', 'pos-order-summary');
    summary.append(el('span', '', 'Doanh thu đơn theo bộ lọc (gồm VAT)'));
    if (!d.totals?.length) summary.append(el('strong', '', money(0)));
    for (const t of d.totals || []) {
      const amount = n => t.currency === 'VND' ? money(n) : new Intl.NumberFormat('vi-VN', { style: 'currency', currency: /^[A-Z]{3}$/.test(t.currency) ? t.currency : 'VND' }).format(n);
      const group = el('div');
      group.append(el('strong', '', amount(t.revenue)), el('p', 'pos-note', `${t.orders} đơn · Đã thu ${amount(t.paid)} · Còn nợ ${amount(t.outstanding)}`));
      if (t.unknownPayment) group.append(el('p', 'pos-note', `${t.unknownPayment} đơn web chưa có dữ liệu thu tiền; chưa cộng vào đã thu/còn nợ.`));
      summary.append(group);
    }
    summary.append(el('p', 'pos-note', 'Không tính đơn đã hủy. Tổng giá trị đơn, chưa trừ trả hàng/hoàn tiền. Đơn web chưa gắn nhân viên bán.'));
    box.append(summary);
    const cards = el('div', 'pos-order-counts');
    for (const id of ['all', 'pending', 'packing', 'waiting_delivery', 'completed', 'cancelled']) {
      const b = button('', 'pos-order-count' + (st.orderStatus === id ? ' active' : ''), () => {
        st.orderStatus = id; run(loadOrderBoard);
      });
      b.append(el('strong', '', d.counts[id] || 0), el('span', '', orderLabels[id]));
      cards.append(b);
    }
    box.append(cards);
    const search = el('input', 'pos-order-search');
    search.type = 'search'; search.placeholder = 'Tìm số đơn, khách hàng, điện thoại, nhân viên…'; search.value = st.orderQuery;
    search.setAttribute('aria-label', 'Tìm đơn hàng cửa hàng');
    let timer;
    search.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => { st.orderQuery = search.value.trim(); run(loadOrderBoard); }, 250); });
    box.append(search);
    const list = el('div', 'pos-order-list');
    if (!d.orders.length) list.append(el('p', 'pos-note', 'Không có đơn trong trạng thái này.'));
    for (const o of d.orders) {
      const row = el('div', 'pos-order-row');
      row.tabIndex = 0; row.setAttribute('role', 'button');
      row.append(
        el('b', '', o.orderNo),
        el('span', '', o.customerName + ' · ' + money(o.total)),
        el('span', 'pos-note', (o.ownerName || 'Chưa có nhân viên') + ' · ' + (o.external ? 'Đơn website' : o.fulfillmentMode === 'cod' ? 'Giao COD' : 'Nhận tại quầy')),
        el('span', 'pos-order-state', orderLabels[o.bucket] + (o.bucket === 'cancelled' ? '' : ' · ' + ({ paid: 'Đã thanh toán', debt: 'Còn nợ', unknown: 'Chưa rõ thanh toán' }[o.paymentStatus] || ''))),
      );
      const open = () => o.external ? showWebOrder(o) : go('#/orders/' + encodeURIComponent(o.id));
      row.addEventListener('click', open);
      row.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
      if (!o.external && o.bucket === 'cancelled' && Number(o.cancelledReturnQty) > 0) {
        const receive = busyButton('Nhận hàng hoàn', 'btn primary small pos-receive-cancelled', 'Đang nhận…', async () => {
          if (!await confirmBox(`Xác nhận đã nhận hàng hoàn của đơn ${o.orderNo} về kho? Hệ thống sẽ cộng lại ${Number(o.cancelledReturnQty).toLocaleString('vi-VN')} sản phẩm vào sổ kho.`, { title: 'Nhận hàng hoàn', ok: 'Xác nhận đã nhận' })) return;
          const result = await api('/pos/orders/' + encodeURIComponent(o.id) + '/receive-cancelled-stock', 'POST', {});
          toast(result.replayed ? 'Hàng của đơn này đã được nhập hoàn trước đó.' : 'Đã nhận hàng hoàn và cộng lại sổ kho.', 'ok');
          await loadOrderBoard();
        });
        receive.addEventListener('click', e => e.stopPropagation());
        receive.addEventListener('keydown', e => e.stopPropagation());
        row.append(receive);
      }
      list.append(row);
    }
    box.append(list);
    if (d.nextOffset != null) {
      box.append(busyButton(`Xem thêm (${d.orders.length}/${d.totalOrders} đơn)`, 'btn secondary pos-order-more', 'Đang tải…', async () => {
        const p = new URLSearchParams({ registerId: st.orderRegisterId || st.register.id, status: st.orderStatus, offset: String(d.nextOffset) });
        if (st.orderQuery) p.set('q', st.orderQuery);
        for (const [key, value] of Object.entries(st.orderFilters)) if (value) p.set(key, value);
        const request = st.orderBoardRequest, more = await api('/pos/orders?' + p);
        if (request !== st.orderBoardRequest || st.orderBoard !== d) return;
        st.orderBoard = { ...d, orders: [...d.orders, ...more.orders], nextOffset: more.nextOffset };
        renderOrderBoard();
      }));
    }
    if (d.windowFrom) box.append(el('p', 'pos-note', `Đơn đã hoàn tất / đã huỷ: hiển thị từ ${d.windowFrom.split('-').reverse().join('/')}. Chọn "Từ ngày" để xem cũ hơn; đơn còn dang dở luôn hiện.`));
  }
  function showWebOrder(o) {
    const m = modal(o.orderNo + ' · ' + (o.source === 'lock' ? 'Web LocknLock' : 'Web Minh Long'));
    m.body.append(el('p', '', o.customerName + (o.phone ? ' · ' + o.phone : '')), el('p', '', o.address || 'Chưa có địa chỉ'), el('b', '', money(o.total)));
    let lines = []; try { lines = JSON.parse(o.lines || '[]'); } catch {}
    for (const x of lines) m.body.append(el('p', 'pos-note', `${x.sku || ''} · ${x.name || ''} × ${x.quantity || 0}`));
    m.body.append(webOrderFinancialSummary(o.financials, o.currency || 'VND'));
    m.body.append(el('p', 'pos-note', 'Thanh toán: ' + (o.paymentMethod || 'Chưa cập nhật')));
    if (o.ghnOrderCode) m.body.append(
      el('p', '', 'Mã vận đơn GHN: ' + o.ghnOrderCode),
      el('p', 'pos-note', 'Trạng thái GHN: ' + (o.ghnStatus || 'Đã tạo vận đơn') + (o.ghnFee ? ' · Phí: ' + money(o.ghnFee) : '')),
      ghnPortalLink(o.ghnOrderCode),
    );
    const actions = el('div', 'pos-actions');
    if (o.actionsAvailable && o.bucket === 'pending') actions.append(button('Chọn địa chỉ & tạo vận đơn GHN', 'btn primary', () => { m.close(); showGhnAddress(o); }));
    if (o.actionsAvailable) actions.append(busyButton('Cập nhật trạng thái', 'btn secondary', 'Đang cập nhật…', async () => {
      await api('/pos/web-orders/' + encodeURIComponent(o.id) + '/action', 'POST', { action: 'refresh' }); m.close(); toast('Đã cập nhật trạng thái đơn.', 'ok'); await loadOrderBoard();
    }));
    if (o.actionsAvailable && !['completed', 'cancelled'].includes(o.bucket)) actions.append(busyButton('Huỷ đơn', 'btn danger', 'Đang huỷ…', async () => {
      if (!await confirmBox(`Huỷ đơn ${o.orderNo}${o.ghnOrderCode ? ' và vận đơn GHN ' + o.ghnOrderCode : ''}?`, { title: 'Huỷ đơn website', ok: 'Huỷ đơn', danger: true })) return;
      await api('/pos/web-orders/' + encodeURIComponent(o.id) + '/action', 'POST', { action: 'cancel' }); m.close(); toast('Đã huỷ đơn' + (o.ghnOrderCode ? ' và vận đơn GHN.' : '.'), 'ok'); await loadOrderBoard();
    }));
    actions.append(button('Đóng', 'btn secondary', m.close));
    m.body.append(actions);
    m.show();
  }
  /** Đơn website chờ xử lý: chọn địa chỉ chuẩn GHN → kiểm tra lại → tạo vận đơn. Form khoá trong lúc gửi; lỗi thì giữ dữ liệu để sửa. */
  function showGhnAddress(o) {
    const m = formModal('Hoàn thiện địa chỉ GHN · ' + o.orderNo);
    m.dlg.classList.add('pos-step-modal');
    const intro = el('p', 'pos-note pos-step-intro', 'Thông tin khách, điện thoại, sản phẩm, COD và khối lượng được giữ nguyên. Chỉ cần chọn lại địa chỉ giao hàng.');
    const serverError = el('p', 'error pos-step-error'); serverError.setAttribute('role', 'alert');
    const address = field('Số nhà, tên đường', 'text', o.address || '');
    address.input.required = true; address.input.placeholder = 'Ví dụ: 123 Nguyễn Trãi';
    const ghn = ghnLocationFields(async (extra = {}) => (await api('/pos/web-orders/' + encodeURIComponent(o.id) + '/action', 'POST', { action: 'locations', ...extra })).locations);
    const editView = el('div', 'pos-step-body'), section = el('section', 'pos-step-section'), grid = el('div', 'pos-step-grid');
    grid.append(ghn.province.box, ghn.district.box, ghn.ward.box);
    section.append(el('h3', '', 'Địa chỉ giao (chuẩn GHN)'), address.box, grid, ghn.retry);
    editView.append(intro, section);
    const review = el('div', 'pos-step-body pos-step-review'); review.hidden = true;
    const submit = el('button', 'btn primary', 'Kiểm tra lại'); submit.type = 'submit';
    let reviewing = false;
    const edit = () => { reviewing = false; editView.hidden = false; review.hidden = true; back.textContent = 'Đóng'; submit.textContent = 'Kiểm tra lại'; };
    const back = button('Đóng', 'btn secondary', () => { if (m.dlg.dataset.busy) return; reviewing ? edit() : m.close(); });
    const footer = el('div', 'pos-step-footer'); footer.append(back, submit);
    m.form.append(serverError, editView, review, footer);
    m.form.addEventListener('submit', async e => {
      e.preventDefault();
      if (m.dlg.dataset.busy) return;
      if (!address.input.value.trim() || !ghn.complete()) { serverError.textContent = 'Nhập số nhà và chọn đủ Tỉnh/Thành, Quận/Huyện, Phường/Xã.'; return; }
      serverError.textContent = '';
      if (!reviewing) {
        reviewing = true;
        const list = el('dl', 'pos-review-list');
        for (const [k, v] of [['Khách', o.customerName + (o.phone ? ' · ' + o.phone : '')], ['Địa chỉ', ghn.fullAddress(address.input.value)], ['Tổng đơn', money(o.total)]]) list.append(el('dt', '', k), el('dd', '', v));
        review.replaceChildren(el('p', 'pos-note pos-step-intro', 'Kiểm tra lần cuối địa chỉ trước khi tạo vận đơn GHN.'), list);
        editView.hidden = true; review.hidden = false; back.textContent = '← Sửa địa chỉ'; submit.textContent = 'Xác nhận & tạo vận đơn GHN';
        return;
      }
      m.lock(true, submit, 'Đang tạo vận đơn GHN…');
      let result;
      try {
        result = await api('/pos/web-orders/' + encodeURIComponent(o.id) + '/action', 'POST', { action: 'confirm', addressLine: address.input.value.trim(),
          provinceId: ghn.province.select.value, provinceName: ghn.chosen(ghn.province.select), districtId: ghn.district.select.value, districtName: ghn.chosen(ghn.district.select), wardCode: ghn.ward.select.value, wardName: ghn.chosen(ghn.ward.select) });
      } catch (err) {
        m.lock(false, submit); edit(); serverError.textContent = err.message || 'Chưa tạo được vận đơn. Kiểm tra lại rồi gửi lại.';
        return;
      }
      m.lock(false, submit); m.close(); toast('Đã lưu địa chỉ và tạo vận đơn GHN.', 'ok');
      const done = modal('Đã tạo vận đơn GHN');
      done.body.append(
        el('p', '', 'Mã vận đơn: ' + (result.ghnOrderCode || 'Đã tạo thành công')),
        ghnPortalLink(result.ghnOrderCode || ''),
        button('Đóng', 'btn secondary', done.close),
      );
      done.show(); await run(loadOrderBoard);
    });
    m.show();
    run(ghn.loadProvinces);
  }
  let printingTemporary = false;
  async function printTemporary() {
    if (!st.cart.length || !active()) return toast('Mở ca và chọn hàng trước.', 'err');
    if (printingTemporary) return;
    printingTemporary = true;
    const b = nodes.temp, label = b?.textContent;
    if (b) { b.disabled = true; b.textContent = 'Đang in…'; }
    try {
      const d = await api('/pos/preview', 'POST', payload());
      try { printPos(d); }
      catch { toast('Chưa in được bill tạm. Kiểm tra máy in rồi thử lại.', 'err'); }
    } finally {
      printingTemporary = false;
      if (b) b.textContent = label;
      refreshPay();
    }
  }
  function choosePricePolicy() {
    if (!st.register) return;
    const m = modal('Chọn bảng giá'), policies = st.options.policies || [];
    const choices = el('div', 'pos-price-choices');
    for (const id of [st.register.pricePolicyId, st.register.secondPricePolicyId]) {
      const name = policies.find(p => p.id === id)?.name || (id === st.register.pricePolicyId ? 'Giá bán lẻ (+ VAT)' : 'Giá bán lẻ');
      const b = button(name, 'btn secondary' + (st.policy === id ? ' active' : ''), () => {
        st.policy = id; if (nodes.policy) nodes.policy.value = id; m.close(); invalidate(); run(() => search(false));
      });
      choices.append(b);
    }
    m.body.append(choices, button('Đóng', 'btn ghost', m.close)); m.show();
  }
  async function cancelCurrentOrder() {
    if (st.busy || st.pending) return;
    if (!st.cart.length && !st.customer && !st.exchangeAllocationId && !st.serviceFees.length && !st.note) return;
    if (!await confirmBox('Huỷ toàn bộ đơn hiện tại?', { ok: 'Huỷ đơn' })) return;
    // Tiền đổi hàng đang giữ cho đơn này phải được nhả trên máy chủ, không chỉ xoá ở giao diện.
    if (st.exchangeAllocationId) {
      try { await api('/pos/exchanges/' + encodeURIComponent(st.exchangeAllocationId) + '/cancel', 'POST', {}); }
      catch (e) { return toast('Chưa nhả được tiền đổi hàng: ' + e.message, 'err'); }
    }
    st.cart = []; st.customer = null; st.serviceFees = []; st.shippingFee = ''; st.note = ''; st.voucher = emptyVoucher(); st.exchangeAllocationId = ''; st.preview = null; st.qr = null; st.method = 'cash';
    draw(); if (st.register) await search(false);
  }
  async function flowOrders(orderId=''){
    return openPosOrderFlows({api,toast,shift:st.shift,register:st.register,orderId,onChanged:()=>Promise.all([search(),loadOrderBoard()]),onReturns:id=>openPosReturns({api,toast,shift:st.shift,register:st.register,orderId:id,onChanged:()=>search()})});
  }
  function requireCustomer() {
    const issue = posCustomerIssue(st.customer);
    if (!issue) return true;
    toast(issue, 'err'); chooseCustomer(); return false;
  }
  function openPayment() {
    if (!active() || !st.preview || !st.cart.length || st.pending || st.busy) return;
    if (!requireCustomer()) return;
    const m = modal('Thanh toán'); m.dlg.classList.add('pos-payment-modal');
    paymentModal = m; m.dlg.addEventListener('close', () => { if (paymentModal === m) paymentModal = null; });
    const headerMeta = el('span', 'pos-payment-meta', `Đơn hiện tại · ${st.customer?.name || 'Chưa chọn khách hàng'}`),
      due = el('section', 'pos-payment-due');
    m.body.querySelectorAll?.('h2')?.[0]?.append?.(headerMeta);
    due.append(el('span', '', 'Cần thu'), el('strong', '', money(st.preview.payable ?? st.preview.total)));
    const methods = el('div', 'pos-payment-methods');
    for (const [id, name, hint] of [['cash','Tiền mặt',''],['transfer','Chuyển khoản','Tạo mã QR'],['cod','Ship COD','Thu khi giao']]) {
      const b = button('', 'pos-payment-method', () => {
        st.method = id; drawMethods(); refreshPay();
      });
      b.dataset.method = id; b.append(el('b', '', name), hint ? el('span', '', hint) : el('span', '', 'Thanh toán tại quầy')); methods.append(b);
    }
    nodes.methods = methods;
    const tender = el('div', 'pos-payment-cash'), moneyFields = el('div', 'pos-tender'), f = field('Khách đưa', 'number');
    f.input.min = '0'; f.input.step = '1'; f.input.inputMode = 'numeric'; f.input.addEventListener('input', refreshPay); nodes.tender = f.input;
    nodes.change = el('b', 'pos-change', '0 đ'); const cb = el('div', 'pos-change-card'); cb.append(el('span', 'pos-note', 'Tiền thối lại'), nodes.change); moneyFields.append(f.box, cb);
    const quick = el('div', 'pos-cash-quick');
    for (const [label, value] of [['Đủ tiền','due'],['100.000',100000],['200.000',200000],['500.000',500000],['1.000.000',1000000],['Xóa',0]]) quick.append(button(label, 'btn secondary', () => { nodes.tender.value = value === 'due' ? (st.preview.payable ?? st.preview.total) : value; refreshPay(); }));
    tender.append(moneyFields, quick); nodes.tenderBox = tender;
    const transfer = el('section', 'pos-payment-transfer'), check = el('input'); check.type = 'checkbox'; check.checked = !!st.qr?.paid; check.disabled = !!st.qr?.paid; check.addEventListener('change', refreshPay); nodes.confirm = check;
    nodes.transferLabel = el('span', '', st.qr?.paid ? 'SePay đã xác nhận cửa hàng nhận đủ ' + money(st.qr.amount) : 'Tôi xác nhận cửa hàng đã thực nhận chuyển khoản');
    const confirm = el('label', 'pos-transfer-confirm'); confirm.append(check, nodes.transferLabel);
    nodes.qr = button('Tạo mã QR', 'btn secondary pos-create-qr', () => run(qr)); transfer.append(nodes.qr, confirm); nodes.transfer = transfer;
    const cod = el('section', 'pos-payment-cod', 'Bước tiếp theo: nhập người nhận và chọn địa chỉ chuẩn Giao Hàng Nhanh, kiểm tra lại rồi tạo đơn COD.'); nodes.cod = cod;
    const footer = el('div', 'pos-payment-footer'); nodes.temp = button('In bill tạm', 'btn secondary', () => run(printTemporary));
    nodes.modalPay = button('Thu tiền & in bill', 'btn primary', async () => {
      if (st.method === 'cod') { m.close(); await pay(true); }
      else { await pay(false); if (!st.pending && !st.cart.length) m.close(); }
    });
    footer.append(nodes.temp, nodes.modalPay);
    m.body.append(due, methods, tender, transfer, cod, footer); m.show(); drawMethods(); refreshPay();
  }
  function drawMethods() {
    if (!nodes.methods) return;
    for (const b of nodes.methods.querySelectorAll('button'))
      b.setAttribute('aria-pressed', String(b.dataset.method === st.method));
    nodes.tenderBox.hidden = st.method !== 'cash';
    nodes.transfer.hidden = st.method !== 'transfer';
    if (nodes.cod) nodes.cod.hidden = st.method !== 'cod';
    if (nodes.modalPay) nodes.modalPay.textContent = payLabel();
  }
  const payLabel = () => st.busy ? 'Đang lưu đơn & in bill…' : st.method === 'cod' ? 'TIẾP TỤC TẠO ĐƠN COD' : 'Thu tiền & in bill';
  function markProductsInCart() {
    const skus = new Set(st.cart.map(x => x.sku));
    for (const b of nodes.grid?.querySelectorAll('button') || []) {
      if (!b.classList?.contains?.('pos-product') && !String(b.className || '').split(/\s+/).includes('pos-product')) continue;
      const selected = skus.has(b.dataset.sku);
      b.classList.toggle('pos-product-in-cart', selected);
      b.setAttribute('aria-pressed', String(selected));
      const badge = [...b.children].find(x => x.className === 'pos-product-selection');
      if (badge) { badge.textContent = selected ? '✓ Bỏ chọn' : ''; badge.hidden = !selected; }
    }
  }
  function add(p, refocusSearch = false) {
    if (!active()) return toast('Mở ca trước khi thêm hàng.', 'err');
    if (st.pending || st.busy) return;
    const old = st.cart.find((x) => x.sku === p.sku);
    if (old) old.qty = Number(old.qty) + 1;
    else st.cart.push({ ...p, qty: 1, discountType: 'percent', discountValue: 0 });
    drawCart();
    invalidate();
    if (refocusSearch) {
      nodes.search.focus();
      nodes.search.select();
    }
  }
  function drawCart() {
    cartResizeObserver?.disconnect();
    nodes.lines.replaceChildren();
    markProductsInCart();
    if (nodes.cartCount) nodes.cartCount.textContent = `${st.cart.reduce((n,x)=>n+Number(x.qty||0),0)} món`;
    updateMobileDock();
    lineTotals = new Map();
    if (!st.cart.length) nodes.lines.append(el('p', 'pos-note', 'Tìm hoặc quét sản phẩm để thêm vào giỏ.'));
    for (const x of st.cart) {
      const row = el('article', 'pos-line'),
        top = el('div', 'pos-line-top'),
        amount = el('strong');
      const remove = button('×', 'btn ghost small', () => {
        if (st.pending) return;
        st.cart = st.cart.filter((r) => r !== x);
        drawCart();
        invalidate();
      });
      remove.setAttribute('aria-label', 'Bỏ ' + x.name + ' khỏi đơn');
      top.append(el('b', '', x.name), amount, remove);
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
        const n = Number(qty.value);
        if (qty.value === '' || !(n > 0)) return; // đang gõ dở: chờ lúc rời ô mới sửa lại
        x.qty = n;
        invalidate();
      });
      // Ô trống / 0 / số âm: trả về số lượng hợp lệ gần nhất thay vì gửi qty 0 để máy chủ báo lỗi.
      qty.addEventListener('change', () => {
        const n = Number(qty.value);
        if (qty.value === '' || !(n > 0)) { qty.value = x.qty; return; }
      });
      const minus = button('−', 'btn secondary small', () => {
        if (st.pending) return;
        const n = Number(x.qty);
        if (!(n > 1)) return;
        x.qty = n - 1;
        qty.value = x.qty;
        invalidate();
      });
      const plus = button('+', 'btn secondary small', () => {
        if (st.pending) return;
        x.qty = Number(x.qty) + 1;
        qty.value = x.qty;
        invalidate();
      });
      minus.setAttribute('aria-label', 'Giảm số lượng ' + x.name);
      plus.setAttribute('aria-label', 'Tăng số lượng ' + x.name);
      qtyBox.append(minus, qty, plus);
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
    sizeCartLines();
    updateTotals();
  }
  function sizeCartLines() {
    const host = nodes.lines, rows = [...host.children];
    const scroll = st.cart.length > 10;
    host.style.maxHeight = 'none';
    host.style.overflowY = scroll ? 'auto' : 'visible';
    host.style.overflowX = scroll ? 'hidden' : 'visible';
    host.style.scrollbarGutter = scroll ? 'stable' : 'auto';
    if (!scroll || typeof host.getBoundingClientRect !== 'function') return;
    // Đo đủ 10 mã thực tế: tên dài, font và độ rộng màn hình có thể đổi chiều cao từng dòng.
    const resize = () => {
      const height = Math.ceil(rows[9].getBoundingClientRect().bottom - host.getBoundingClientRect().top + host.scrollTop);
      if (height > 0 && host.style.maxHeight !== height + 'px') host.style.maxHeight = height + 'px';
    };
    resize();
    if (typeof ResizeObserver !== 'undefined') {
      cartResizeObserver = new ResizeObserver(resize);
      cartResizeObserver.observe(host);
      rows.slice(0, 10).forEach(row => cartResizeObserver.observe(row));
    }
  }
  function drawFees(right) {
    const box = el('section', 'pos-extra-fees'), list = el('div', 'pos-service-fees');
    const shipping = field('Phí ship · Không VAT', 'number', st.shippingFee);
    shipping.input.min = '0'; shipping.input.step = '1'; shipping.input.inputMode = 'numeric'; shipping.input.placeholder = '0 đ';
    shipping.input.addEventListener('input', () => { st.shippingFee = shipping.input.value; invalidate(); });
    const add = button('+ Thêm khoản phí', 'btn secondary small', () => {
      if (st.serviceFees.length >= 50) return;
      st.serviceFees.push({ name: '', quantity: '1', unitPrice: '' }); renderServices()?.focus(); invalidate();
    });
    function renderServices() {
      list.replaceChildren(); let lastName;
      for (const fee of st.serviceFees) {
        const service = el('div', 'pos-service-fee'), name = field('Khoản phí'), quantity = field('Số lượng', 'number', fee.quantity), amount = field('Đơn giá', 'number', fee.unitPrice), total = field('Thành tiền', 'text', '');
        name.input.value = fee.name; name.input.placeholder = 'Ví dụ: Phí in, phí gói quà…'; name.input.maxLength = 200;
        total.input.readOnly = true; total.input.tabIndex = -1;
        const update = () => { total.input.value = money((Number(fee.quantity) || 0) * (Number(fee.unitPrice) || 0)); }; update();
        for (const [f, property] of [[name, 'name'], [quantity, 'quantity'], [amount, 'unitPrice']]) {
          if (property !== 'name') { f.input.min = property === 'quantity' ? '1' : '0'; f.input.step = '1'; f.input.inputMode = 'numeric'; }
          f.input.addEventListener('input', () => { fee[property] = f.input.value; update(); invalidate(); });
        }
        service.append(name.box, quantity.box, amount.box, total.box, button('Bỏ phí', 'btn ghost small', () => {
          st.serviceFees = st.serviceFees.filter(row => row !== fee); renderServices(); invalidate();
        }));
        list.append(service); lastName = name.input;
      }
      add.disabled = st.serviceFees.length >= 50; return lastName;
    }
    renderServices();
    const noteBox = el('label', 'pos-field pos-order-note'), note = el('textarea');
    note.rows = 2; note.maxLength = 2000; note.value = st.note;
    note.placeholder = 'Ví dụ: Gói riêng từng món, giao sau 17h…';
    note.setAttribute('aria-label', 'Ghi chú đơn hàng');
    note.addEventListener('input', () => { st.note = note.value; });
    noteBox.append(el('span', '', 'Ghi chú đơn hàng'), note);
    box.append(list, add, el('p', 'pos-note', 'Phí dịch vụ theo bảng giá; không áp dụng chiết khấu sản phẩm.'), noteBox);
    right.append(drawVoucher(), box);
    nodes.feeControls = box;
    nodes.shippingField = shipping.box;
  }
  /** VOUCHER nhập tay cho cả đơn (pos-money.ts › parsePosVoucher): mã / ghi chú + số tiền VNĐ hoặc %; máy chủ chia vào các dòng, trừ thẳng vào giá đã gồm VAT rồi tách lại VAT. */
  function drawVoucher() {
    const box = el('section', 'pos-voucher'), row = el('div', 'pos-voucher-row');
    const code = field('Mã / ghi chú voucher', 'text', st.voucher.code), value = field('Giảm', 'number', st.voucher.value);
    code.input.maxLength = 60; code.input.placeholder = 'Ví dụ: VC-TET2026, voucher KH thân thiết…'; code.input.autocomplete = 'off';
    value.input.min = '0'; value.input.step = '1'; value.input.inputMode = 'numeric'; value.input.placeholder = '0';
    const mode = el('select'); mode.setAttribute('aria-label', 'Voucher giảm theo');
    for (const [v, t] of [['amount', 'VNĐ'], ['percent', '%']]) { const o = el('option', '', t); o.value = v; mode.append(o); }
    mode.value = st.voucher.type;
    const modeBox = el('label', 'pos-field pos-voucher-mode'); modeBox.append(el('span', '', 'Theo'), mode);
    code.input.addEventListener('input', () => { st.voucher.code = code.input.value; invalidate(); });
    value.input.addEventListener('input', () => { st.voucher.value = value.input.value; invalidate(); });
    mode.addEventListener('change', () => { st.voucher.type = mode.value; invalidate(); });
    const clear = button('Bỏ voucher', 'btn ghost small', () => { st.voucher = emptyVoucher(); code.input.value = value.input.value = ''; mode.value = 'amount'; invalidate(); });
    row.append(code.box, value.box, modeBox, clear);
    box.append(el('h3', 'pos-voucher-title', 'Voucher'), row, el('p', 'pos-note', 'Giảm cho cả đơn, trừ thẳng vào giá đã gồm VAT (VAT tính lại theo số sau giảm; chia theo từng dòng hàng). Không áp vào phí dịch vụ, phí ship. Bắt buộc ghi mã / ghi chú để đối soát.'));
    return box;
  }
  function updateTotals() {
    nodes.totals.replaceChildren();
    const d = st.preview;
    for (const [label, value] of [
      ['Tạm tính', d ? money(d.total + d.discount) : st.cart.length ? 'Đang tính…' : '0 đ'],
      ['Giảm giá', d ? '−' + money(d.discount - (d.voucher?.amount || 0)) : '—'],
      ...(d?.voucher?.amount ? [['Voucher ' + d.voucher.code, '−' + money(d.voucher.amount)]] : []),
      ...((d?.fees?.services ?? (d?.fees?.service ? [d.fees.service] : [])).filter(f => f.amount).map(f => [f.name + ' (trước thuế)', money(f.subtotal)])),
      ['VAT', d ? money(d.tax) : '—'],
      ['Cần thu', d ? money(d.payable ?? d.total) : st.cart.length ? 'Đang tính…' : '0 đ'],
      ...(d?.exchange?.amount ? [['Tiền đổi hàng áp dụng', '−'+money(d.exchange.amount)],['Khách cần trả thêm',money(d.payable)]]:[]),
    ]) {
      if (label === 'Cần thu') nodes.totals.append(nodes.shippingField);
      const row = el('div', 'pos-total-row' + (label === 'Cần thu' ? ' pos-total' : ''));
      row.append(el('span', '', label), el('strong', '', value));
      nodes.totals.append(row);
    }
    for (const x of d?.lines || []) lineTotals.get(x.sku)?.replaceChildren(document.createTextNode(money(x.total)));
    updateMobileDock();
    if(st.exchangeAllocationId)nodes.totals.append(busyButton('Bỏ áp dụng tiền đổi hàng','btn secondary small','Đang bỏ áp dụng…',async()=>{await api('/pos/exchanges/'+encodeURIComponent(st.exchangeAllocationId)+'/cancel','POST',{});st.exchangeAllocationId='';invalidate();await preview();}));
    refreshPay();
  }
  function updateMobileDock() {
    if (!nodes.mobileCartCount) return;
    const count = st.cart.reduce((n, x) => n + Number(x.qty || 0), 0), d = st.preview;
    nodes.mobileCartCount.textContent = `Đơn hiện tại · ${count} món`;
    nodes.mobileCartCustomer.textContent = st.customer?.name || 'Chưa chọn khách hàng';
    nodes.mobileCartTotal.textContent = d ? money(d.payable ?? d.total) : count ? 'Đang tính…' : '0 đ';
    nodes.mobileCartOpen.disabled = !count;
  }
  function refreshPay() {
    if (!nodes.pay) return;
    const invalid = !active() || !st.preview || !st.cart.length || !!st.pending || st.busy;
    nodes.pay.disabled = invalid;
    if (nodes.temp) nodes.temp.disabled = invalid;
    if (nodes.qr) nodes.qr.disabled = invalid || (st.preview?.payable ?? st.preview?.total ?? 0)<=0;
    if (nodes.modalPay) nodes.modalPay.disabled =
      invalid ||
      (st.method === 'transfer' && !nodes.confirm.checked) ||
      (st.method === 'cash' && Number(nodes.tender?.value || 0) < (st.preview?.payable ?? st.preview?.total ?? 0));
    if (nodes.modalPay) {
      nodes.modalPay.textContent = payLabel();
      nodes.modalPay.classList.toggle('is-busy', st.busy);
      nodes.modalPay.setAttribute('aria-busy', String(st.busy));
    }
    for (const b of nodes.methods?.querySelectorAll('button') || []) b.disabled = st.busy;
    if (nodes.change) nodes.change.textContent = money(Math.max(0, Number(nodes.tender?.value || 0) - (st.preview?.payable ?? st.preview?.total ?? 0)));
    nodes.lines?.classList.toggle('pos-busy', !!st.pending || st.busy);
    for (const i of nodes.lines?.querySelectorAll('input,select,button') || []) i.disabled = !!st.pending || st.busy;
    if (nodes.policy) nodes.policy.disabled = !!st.pending || st.busy;
    for (const i of [...(nodes.feeControls?.querySelectorAll('input,textarea,button') || []), ...(nodes.shippingField?.querySelectorAll('input') || [])]) i.disabled = !!st.pending || st.busy;
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
    if (more && st.catalogLoading) return;
    st.catalogLoading = true;
    const seq = ++searchSeq,
      q = nodes.search?.value.trim() || '',
      offset = more ? st.offset : 0,
      mobile = window.matchMedia?.('(max-width: 850px)')?.matches === true,
      limit = mobile ? 20 : 60;
    try {
      const d = await api(
        `/pos/catalog?registerId=${encodeURIComponent(st.register.id)}&pricePolicyId=${encodeURIComponent(st.policy)}&q=${encodeURIComponent(q)}&offset=${offset}&limit=${limit}`,
      );
      if (seq !== searchSeq) return;
      st.offset = d.nextOffset;
      st.products = more ? [...st.products, ...d.products] : d.products;
      renderProducts();
      nodes.more.hidden = d.nextOffset == null;
      if (addScanned) {
        const p = d.products.find((p) => p.sku === q) || (d.products.length === 1 ? d.products[0] : null);
        if (p && p.available > 0) add(p, true);
        else toast('Chọn đúng sản phẩm trong danh sách.');
      }
    } finally {
      st.catalogLoading = false;
    }
  }
  function renderProducts() {
    if (!nodes.grid) return;
    nodes.grid.replaceChildren();
    for (const p of st.products.filter(p => st.productFilter === 'all' || st.productFilter === 'available' && p.available > 0 || st.productFilter === 'low' && p.available > 0 && p.available < 5 || st.productFilter === 'out' && p.available <= 0)) {
      const tile = el('article', 'pos-product-tile');
      const b = button('', 'pos-product', () => {
        if (st.pending || st.busy) return;
        if (st.cart.some(x => x.sku === p.sku)) {
          st.cart = st.cart.filter(x => x.sku !== p.sku); drawCart(); invalidate();
        } else add(p);
      });
      b.dataset.sku = p.sku;
      b.setAttribute('aria-pressed', String(st.cart.some(x => x.sku === p.sku)));
      if (p.imageUrl && /^https:\/\//.test(p.imageUrl)) {
        const im = el('img');
        im.src = p.imageUrl;
        im.alt = p.name;
        im.loading = 'lazy';
        b.append(im);
      } else b.append(el('span', 'pos-image-empty', 'Sản phẩm'));
      const priceStock = el('span', 'pos-product-price-stock');
      priceStock.append(
        el('strong', 'pos-product-price', money(p.price)),
        el('small', p.available <= 0 ? 'pos-stock pos-stock-out' : p.available < 5 ? 'pos-stock pos-stock-low' : 'pos-stock', p.available <= 0 ? 'Hết hàng' : 'Còn ' + p.available),
      );
      b.append(el('b', 'pos-product-name', p.name), el('small', 'pos-product-sku', p.sku), priceStock, el('span', 'pos-product-selection'));
      b.title = p.name + ' · ' + p.sku;
      b.disabled = !active() || p.available <= 0 && !st.cart.some(x => x.sku === p.sku) || !!st.pending;
      tile.append(b);
      if (p.stockSources) {
        const stocks = el('div', 'pos-product-stocks');
        for (const entry of stockEntries(p)) {
          const view = button(`${entry.label}: ${number(entry.qty)}`, 'pos-source-stock', () => showProductStock(p, entry.key));
          view.title = entry.explanation;
          view.setAttribute('aria-label', `${entry.label} của ${p.sku}: ${number(entry.qty)}. Xem tồn và xin hàng`);
          stocks.append(view);
        }
        tile.append(stocks);
      }
      nodes.grid.append(tile);
    }
    if (!nodes.grid.children.length) nodes.grid.append(el('p', 'pos-note', 'Không có sản phẩm phù hợp.'));
    markProductsInCart();
  }
  const number = n => new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 3 }).format(Number(n) || 0);
  function stockEntries(p) {
    const d = p.stockSources, names = group => (group.warehouses || []).map(w => `${w.name}: ${number(w.qty)}`).join(' · ');
    return [
      { key: 'store', label: 'Cửa hàng', qty: p.available, explanation: `${d.destination?.name || st.register.name}: tồn sổ kho ${number(p.onHand)}, đang giữ ${number(p.reserved)}, có thể bán ${number(p.available)}.` },
      { key: 'vigifts', label: 'VIGIFTS', qty: d.vigifts.qty, explanation: (names(d.vigifts) || 'Chưa có kho VIGIFTS được phép xem.') + ' Tồn sổ kho nếu đã chốt đầu kỳ, nếu chưa thì tồn đồng bộ; chưa trừ giữ hàng.' },
      { key: 'supplier', label: 'NCC', qty: d.supplier.qty, explanation: (names(d.supplier) || 'Chưa có dữ liệu tồn NCC.') + ' Tồn nguồn NCC đồng bộ, chưa phải hàng có sẵn tại cửa hàng.' },
      { key: 'incoming', label: 'Đang về', qty: d.incoming.qty, explanation: d.incoming.orders.map(o => `${o.orderNo} · ${o.supplierName}: ${number(o.qty)} · hẹn ${o.arrivalDate || 'chưa có'}`).join('\n') || 'Không có đơn mua NCC đã duyệt còn chờ về. Không cộng hàng đang về vào tồn sẵn.' },
    ];
  }
  function showProductStock(p, key) {
    const m = modal('Tồn kho · ' + p.sku);
    m.dlg.classList.add('pos-stock-dialog');
    m.body.append(el('h3', '', p.name));
    for (const entry of stockEntries(p)) {
      const row = el('section', 'pos-stock-detail');
      row.append(el('strong', '', `${entry.label}: ${number(entry.qty)} ${p.unit || ''}`), el('p', 'pos-note', entry.explanation));
      m.body.append(row);
    }
    for (const o of p.stockSources.incoming.orders) m.body.append(button('Xem đơn đang về ' + o.orderNo, 'btn secondary', () => { m.close(); go('#/purchases/' + encodeURIComponent(o.orderId)); }));
    m.body.append(el('p', 'pos-note', 'Hàng đang về đã có đơn mua. Muốn lấy trước: mở đơn để làm việc với Sale Admin/Manager, tránh tạo đơn mua trùng.'));
    const actions = el('div', 'pos-stock-actions');
    actions.append(button('Xin hàng', 'btn primary', () => { m.close(); requestProductStock(p, key === 'supplier'); }), button('Đóng', 'btn secondary', m.close));
    m.body.append(actions); m.show();
  }
  async function requestProductStock(p, fromSupplier = false) {
    const d = p.stockSources, m = formModal('Xin hàng · ' + p.sku);
    m.dlg.classList.add('pos-stock-dialog');
    const options = d.requestWarehouses.map(w => [w.id, `${w.name} · tồn ${number(w.qty)}`]);
    options.push(['__supplier', 'NCC – tạo đơn mua nháp mới']);
    const source = select([['', 'Chọn kho xin hàng'], ...options], fromSupplier ? '__supplier' : d.requestWarehouses[0]?.id || '');
    source.setAttribute('aria-label', 'Kho xin hàng');
    const qty = field('Số lượng xin', 'number', '1'); qty.input.min = '0.001'; qty.input.step = '0.001'; qty.input.required = true;
    const reason = field('Lý do xin hàng', 'text', 'Bổ sung hàng bán tại ' + st.register.name); reason.input.required = true; reason.input.maxLength = 500;
    const label = el('label', 'pos-field'); label.append(el('span', '', 'Kho xin hàng'), source);
    const supplier = select([['', 'Chọn nhà cung cấp']], ''); supplier.setAttribute('aria-label', 'Nhà cung cấp');
    const supplierLabel = el('label', 'pos-field'); supplierLabel.append(el('span', '', 'Nhà cung cấp'), supplier);
    const address = field('Địa chỉ nhận hàng', 'text', ''); address.input.maxLength = 120;
    const arrival = field('Ngày cần hàng', 'date', '');
    const ncc = el('div'); ncc.append(supplierLabel, address.box, arrival.box, el('p', 'pos-note', 'Tạo đơn mua nháp để kiểm tra và gửi duyệt. Chưa gửi NCC, chưa nhận hàng. Kiểm tra đơn đang về trước khi đặt thêm.'));
    const message = el('p', 'pos-note'), error = el('p', 'pos-stock-error'); error.setAttribute('role', 'alert');
    const send = button('Gửi xin điều chuyển', 'btn primary'); send.type = 'submit';
    let suppliersLoaded = false, loading = false, submitting = false;
    const mode = async () => {
      const isNcc = source.value === '__supplier'; ncc.hidden = !isNcc;
      qty.input.step = isNcc ? '1' : '0.001'; qty.input.min = isNcc ? '1' : '0.001';
      send.textContent = isNcc ? 'Lưu đơn mua nháp' : 'Gửi xin điều chuyển';
      message.textContent = isNcc ? 'Nguồn NCC không phải kho nội bộ để điều chuyển.' : `Kho nhận: ${d.destination?.name || st.register.name}. Gửi chờ duyệt, chưa thay đổi tồn.`;
      if (isNcc && !suppliersLoaded && !loading) {
        loading = true; send.disabled = true;
        try { const result = await api('/purchase-options'); supplier.replaceChildren();
          for (const [id, name] of [['', 'Chọn nhà cung cấp'], ...(result.suppliers || []).map(x => [x.id, x.name])]) { const o = el('option', '', name); o.value = id; supplier.append(o); }
          supplier.value = ''; suppliersLoaded = true;
        } catch (e) { error.textContent = e.message; } finally { loading = false; send.disabled = submitting; }
      }
    };
    source.addEventListener('change', mode);
    m.form.append(label, qty.box, reason.box, ncc, message, error);
    const actions = el('div', 'pos-stock-actions'); actions.append(send, button('Hủy', 'btn secondary', m.close)); m.form.append(actions);
    m.form.addEventListener('submit', async e => {
      e.preventDefault(); if (submitting || loading) return;
      const quantity = Number(qty.input.value), isNcc = source.value === '__supplier';
      error.textContent = '';
      if (!source.value || !Number.isFinite(quantity) || quantity <= 0 || quantity > 1e7 || isNcc && !Number.isInteger(quantity)) { error.textContent = 'Chọn kho xin và nhập số lượng hợp lệ; đơn NCC cần số nguyên dương.'; return; }
      if (reason.input.value.trim().length < 3) { error.textContent = 'Nhập lý do xin hàng.'; return; }
      if (isNcc && (!supplier.value || !address.input.value.trim())) { error.textContent = 'Chọn nhà cung cấp và nhập địa chỉ nhận hàng.'; return; }
      submitting = true; send.disabled = true;
      try {
        if (isNcc) {
          const result = await api('/purchase-orders', 'POST', { orders: [{ supplierId: supplier.value, warehouse: address.input.value.trim(), arrivalDate: arrival.input.value, note: reason.input.value.trim(), lines: [{ sku: p.sku, name: p.name, unit: p.unit, quantity, sources: [] }] }] });
          m.close(); toast('Đã lưu đơn mua nháp. Kiểm tra trước khi gửi duyệt.', 'ok'); go('#/purchases/' + encodeURIComponent(result.ids[0]));
        } else {
          const result = await api('/stock-transfers', 'POST', { fromWarehouseId: source.value, toWarehouseId: d.destination.id, reason: reason.input.value.trim(), lines: [{ sku: p.sku, qty: quantity }] });
          m.close(); toast(`Đã gửi ${result.transferNo} – chờ duyệt.`, 'ok');
        }
      } catch (e) { error.textContent = e.message; } finally { submitting = false; send.disabled = false; }
    });
    m.show(); await mode();
  }
  async function scan() {
    const m = modal('Quét mã bằng camera'), video = el('video', 'pos-camera'),
      hint = el('p', 'pos-note', 'Cho phép camera, đưa mã vạch vào giữa khung và giữ máy ổn định.');
    video.style.width = '100%';
    m.body.append(video, hint, button('Đóng camera', 'btn secondary', m.close));
    let handle, closed = false;
    const controller = new AbortController();
    const leave = () => m.close();
    window.addEventListener('hashchange', leave);
    m.dlg.addEventListener('close', () => { closed = true; window.removeEventListener('hashchange', leave); controller.abort(); handle?.stop(); });
    m.show();
    try {
      handle = await startBarcodeCamera(video, code => {
        if (closed) return;
        nodes.search.value = code;
        m.close();
        run(() => search(true));
      }, { signal: controller.signal });
      if (closed) handle.stop();
    } catch (e) {
      handle?.stop();
      if (closed) return;
      hint.textContent = e.name === 'NotAllowedError' ? 'Chưa được cấp quyền camera. Anh bật quyền Camera cho trang CRM trong cài đặt trình duyệt rồi thử lại.'
        : e.name === 'NotFoundError' ? 'Không tìm thấy camera trên thiết bị này.'
        : e.name === 'NotReadableError' ? 'Camera đang được ứng dụng khác sử dụng. Đóng ứng dụng đó rồi thử lại.' : e.message;
      video.hidden = true;
      m.body.append(button('Nhập mã thủ công', 'btn secondary', () => { m.close(); nodes.search.focus(); }));
    }
  }
  function chooseCustomer() {
    if (st.pending || st.busy) return;
    run(async () => {
      const m = modal('Chọn khách hàng');
      m.dlg.classList.add('pos-customer-picker');
      const search = el('div', 'pos-customer-search'),
        input = el('input', 'pos-customer-input'),
        suggestions = el('div', 'pos-customer-suggestions'),
        status = el('p', 'pos-customer-hint', 'Gõ tên hoặc số điện thoại để tìm khách.'),
        actions = el('div', 'pos-customer-actions'),
        footer = el('div', 'pos-customer-footer');
      const listId = 'pos-customer-options-' + key();
      let kind = '', seq = 0, timer, matches = [], activeIndex = -1, canRetail = false;
      input.type = 'search';
      input.placeholder = 'Tìm tên hoặc số điện thoại…';
      input.autocomplete = 'off';
      input.setAttribute('aria-label', 'Tìm khách hàng');
      input.setAttribute('role', 'combobox');
      input.setAttribute('aria-autocomplete', 'list');
      input.setAttribute('aria-controls', listId);
      suggestions.id = listId;
      suggestions.setAttribute('role', 'listbox');
      suggestions.hidden = true;
      status.setAttribute('role', 'status');
      function collapse() {
        suggestions.hidden = true;
        input.setAttribute('aria-expanded', 'false');
        input.setAttribute('aria-activedescendant', '');
        activeIndex = -1;
      }
      function close() { clearTimeout(timer); ++seq; m.close(); }
      function pick(c) {
        const issue = posCustomerIssue(c); if (issue) return toast(issue, 'err');
        st.customer = c;
        nodes.customer.textContent = c ? c.name : 'Chọn khách hàng *';
        invalidate();
        close();
      }
      function filter(value) {
        kind = value;
        for (const [b, v] of [[retail, 'retail'], [business, 'business']]) {
          b.setAttribute('aria-pressed', String(kind === v));
        }
        input.placeholder = value === 'retail' ? 'Tìm khách lẻ theo tên, điện thoại…' : 'Tìm khách B2B theo tên, điện thoại…';
        clearTimeout(timer);
        ++seq;
        matches = [];
        collapse();
        run(find);
        input.focus();
      }
      const retail = button('Khách lẻ', 'btn secondary', () => filter('retail')),
        business = button('Khách B2B', 'btn secondary', () => filter('business')),
        create = button('+ Khách mới', 'btn primary', () => { close(); newCustomer(); });
      retail.hidden = true;
      actions.append(retail, business, create);
      footer.append(el('span', 'pos-customer-hint', 'Bắt buộc chọn khách hàng cụ thể để lưu đơn.'), button('Đóng', 'btn secondary', close));
      search.append(input, suggestions);
      m.body.append(el('p', 'pos-customer-subtitle', 'Tìm và chọn khách ngay trong ô bên dưới.'), actions, search, status, footer);
      async function find() {
        const n = ++seq, query = input.value.trim();
        collapse();
        matches = [];
        if (!query) {
          status.textContent = 'Gõ tên hoặc số điện thoại để tìm khách.';
          return;
        }
        status.textContent = 'Đang tìm khách…';
        try {
          const d = await api('/pos/customers?q=' + encodeURIComponent(query) + (kind ? '&kind=' + kind : ''));
          if (n !== seq || !m.dlg.open) return;
          canRetail = !!d.canListRetail;
          retail.hidden = !canRetail;
          if (!canRetail && kind === 'retail') kind = '';
          matches = d.customers;
          suggestions.replaceChildren(...matches.map((c, i) => {
            const option = button('', 'pos-customer-option', () => pick(c));
            option.id = listId + '-' + i;
            option.setAttribute('role', 'option');
            option.setAttribute('aria-selected', 'false');
            option.append(el('strong', '', c.name), el('span', '', c.phone || 'Chưa có số điện thoại'));
            return option;
          }));
          suggestions.hidden = !matches.length;
          input.setAttribute('aria-expanded', String(!!matches.length));
          status.textContent = matches.length ? 'Chọn khách trong gợi ý · ↑ ↓ để di chuyển, Enter để chọn.' : 'Không tìm thấy khách. Thử tên, số điện thoại khác hoặc tạo khách mới.';
        } catch (e) {
          if (n === seq && m.dlg.open) { collapse(); status.textContent = 'Không tải được khách. Vui lòng thử lại.'; }
          throw e;
        }
      }
      input.addEventListener('input', () => {
        ++seq;
        collapse();
        clearTimeout(timer);
        timer = setTimeout(() => run(find), 200);
      });
      input.addEventListener('focus', () => { if (input.value.trim()) run(find); });
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !suggestions.hidden) { e.preventDefault(); e.stopPropagation(); collapse(); return; }
        if (suggestions.hidden || !matches.length) return;
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          activeIndex = activeIndex < 0 ? (e.key === 'ArrowDown' ? 0 : matches.length - 1) : (activeIndex + (e.key === 'ArrowDown' ? 1 : -1) + matches.length) % matches.length;
          Array.from(suggestions.children).forEach((o, i) => o.setAttribute('aria-selected', String(i === activeIndex)));
          input.setAttribute('aria-activedescendant', listId + '-' + activeIndex);
          suggestions.children[activeIndex].scrollIntoView?.({ block: 'nearest' });
        } else if (e.key === 'Enter' && activeIndex >= 0) { e.preventDefault(); pick(matches[activeIndex]); }
      });
      m.dlg.addEventListener('close', () => { ++seq; clearTimeout(timer); });
      collapse();
      m.show();
      input.focus();
      // Load permissions without presenting an unfiltered customer directory.
      const d = await api('/pos/customers?q=');
      if (m.dlg.open) { canRetail = !!d.canListRetail; retail.hidden = !canRetail; }
    });
  }
  function newCustomer() {
    const m = formModal('Khách mới – dùng ngay');
    m.dlg.className += ' pos-customer-create';
    const fields = customerFormFields({ requirePhone: true });
    const error = el('p', 'error'); error.setAttribute('role', 'alert');
    const actions = el('div', 'pos-customer-form-actions');
    const save = el('button', 'btn primary', 'Lưu & chọn khách'); save.type = 'submit';
    actions.append(save, button('Huỷ', 'btn secondary', m.close));
    m.form.append(fields.root, error, actions);
    const duplicateCheck = bindCustomerDuplicateCheck({api, root:fields.root, read:fields.read, endpoint:'/pos/customers/duplicates/check', active:()=>m.dlg.open,
      onChoose: async c => {
        try {
          const result=await api('/pos/customers?id='+encodeURIComponent(c.id));
          const existing=result.customers.find(x=>x.id===c.id);
          if(!existing){error.textContent='Khách chưa được duyệt hoặc chưa có quyền chọn. Nhờ Manager kiểm tra.';return;}
          const issue=posCustomerIssue(existing);if(issue){error.textContent=issue;return;}
          st.customer=existing;nodes.customer.textContent=existing.name;invalidate();m.close();
        }catch(ex){error.textContent=ex.message;}
      }});
    m.dlg.addEventListener('close', duplicateCheck.reset);
    m.form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (save.disabled) return;
      error.textContent = '';
      save.disabled = true;
      try {
        const c = await api('/pos/customers', 'POST', fields.read());
        st.customer = c;
        nodes.customer.textContent = c.name;
        invalidate();
        m.close();
      } catch (ex) { error.textContent = ex.message; }
      finally { save.disabled = false; }
    });
    m.show();
    fields.controls.name.focus();
  }
  async function openShift() {
    const latest = await api('/pos/options' + (st.register?.id ? '?registerId=' + encodeURIComponent(st.register.id) : ''));
    if (latest.current && !latest.current.closedAt) { await load(); toast('Đã sử dụng ca đang mở của cửa hàng.'); return; }
    if (!st.register) return toast(st.options?.canConfigure ? 'Cấu hình quầy trước.' : 'Bạn chưa được giao quầy bán hàng. Nhờ Manager phân quầy theo chức vụ.', 'err');
    // Lấy tiền bàn giao trước khi dựng form: lỗi mạng thì không để lại hộp thoại mồ côi.
    const drawer = await api('/cash?registerId=' + encodeURIComponent(st.register.id));
    const m = formModal('Mở ca bán hàng'),
      reg = select(
        st.options.registers.map((r) => [r.id, r.name]),
        st.register.id,
      ),
      template = select(
        st.options.templates.map((t) => [t.id, `${t.name} ${t.startsAt}–${t.endsAt}`]),
        st.options.templates[0]?.id || '',
      ),
      cash = field('Tiền thực đếm đầu ca trong két', 'text', ''),
      note = field('Ghi chú ca');
    m.dlg.classList.add('pos-open-shift');
    reg.setAttribute('aria-label', 'Quầy bán hàng');
    template.setAttribute('aria-label', 'Ca làm việc');
    const heading = el('header', 'pos-shift-heading');
    heading.append(
      el('span', 'pos-shift-badge', 'BẮT ĐẦU CA LÀM VIỆC'),
      el('h2', '', 'Mở ca bán hàng'),
      el('p', 'pos-note', user().name + ' · ' + when(new Date())),
    );
    m.body.replaceChildren(heading, m.form);
    let openingCash = Number(drawer.nextOpeningCash ?? 0);
    cash.input.type = 'text';
    cash.input.value = '';
    cash.input.inputMode = 'numeric';
    cash.input.placeholder = 'Nhập tổng tiền mặt thực đếm';
    cash.input.min = '0';
    cash.input.required = true;
    const content = el('div', 'pos-shift-content'),
      choices = el('div', 'pos-shift-choices'),
      registerField = el('label', 'pos-field'),
      templateField = el('label', 'pos-field'),
      opening = el('section', 'pos-shift-opening');
    registerField.append(el('span', '', 'Quầy bán hàng'), reg);
    templateField.append(el('span', '', 'Ca làm việc'), template);
    choices.append(registerField, templateField);
    cash.box.classList.add('pos-opening-money');
    cash.box.append(el('span', 'pos-money-unit', 'VNĐ'));
    const comparisonNote = el('p', 'pos-note');
    const countedValue = () => {
      const raw = cash.input.value.trim();
      if (!/^(?:\d+|\d{1,3}(?:\.\d{3})+)$/.test(raw)) return null;
      const n = Number(raw.replace(/\./g, ''));
      return Number.isSafeInteger(n) && n >= 0 && n <= 1e12 ? n : null;
    };
    const showComparison = () => {
      const counted = countedValue(), difference = counted == null ? null : counted - openingCash;
      comparisonNote.className = difference ? 'pos-note cash-warning' : 'pos-note';
      comparisonNote.textContent = 'Tiền bàn giao tham chiếu: ' + money(openingCash) + '. ' +
        (difference ? 'Lệch ' + money(difference) + '. Vẫn được mở bán; hệ thống tự tạo tra soát.' : 'Nhập tiền mặt thực đếm. Nếu lệch vẫn được mở bán và tự tạo tra soát.');
    };
    cash.input.addEventListener('input', showComparison);
    showComparison();
    opening.append(cash.box, comparisonNote);
    note.input.placeholder = 'Ghi chú bàn giao hoặc lưu ý trong ca (nếu có)';
    content.append(choices, opening, note.box);
    m.form.append(content);
    if (!st.options.templates.length) template.append(new Option('Ca sáng 08:00–14:00', ''));
    const b = el('button', 'btn primary', 'Bắt đầu bán');
    b.type = 'submit';
    const footer = el('div', 'pos-shift-footer');
    footer.append(button('Huỷ', 'btn secondary', m.close), b);
    m.form.append(footer);
    const requestKey = key();
    m.form.addEventListener('submit', (e) => {
      e.preventDefault();
      run(async () => {
        const countedCash = countedValue();
        if (countedCash == null) throw Error('Nhập tiền thực đếm đầu ca bằng số nguyên VNĐ, từ 0 trở lên.');
        if (m.dlg.dataset.busy) return;
        m.lock(true, b, 'Đang mở ca…');
        try {
          const opened = await api('/pos/shifts/open', 'POST', {
            key: requestKey,
            registerId: reg.value,
            templateId: template.value,
            openingCash: countedCash,
            note: note.input.value,
          });
          if (opened.openingReconciliationId) toast('Đã mở ca bán hàng. Chênh lệch đầu ca đã gửi tra soát tại Sổ quỹ.');
          m.lock(false, b);
          m.close();
          st.cart = [];
          await load();
        } finally {
          if (m.dlg.dataset.busy) m.lock(false, b);
        }
      });
    });
    m.show();
    let cashSeq = 0;
    reg.addEventListener('change', () => run(async () => {
      const version = ++cashSeq;
      b.disabled = true;
      cash.input.value = '';
      comparisonNote.textContent = 'Đang lấy tiền bàn giao của quầy…';
      const cashState = await api('/cash?registerId=' + encodeURIComponent(reg.value));
      if (version !== cashSeq) return;
      openingCash = Number(cashState.nextOpeningCash ?? 0);
      cash.input.value = '';
      showComparison();
      if (!m.dlg.dataset.busy) b.disabled = false;
    }));
  }
  function openReturns() {
    openPosReturns({api,toast,shift:st.shift,register:st.register,cartTotal:st.preview?.total||0,onExchange:async({allocation,customer})=>{st.exchangeAllocationId=allocation.id;st.customer=customer;if(allocation.amount >= (st.preview?.total||0))st.method='cash';invalidate();draw();await preview();},onChanged:()=>search()});
  }
  async function closeShift() {
    if (dirty()) return toast('Xử lý giỏ hàng hoặc giao dịch chưa rõ kết quả trước khi kết ca.', 'err');
    if (onCloseShift) {
      await onCloseShift();
      await load();
    } else go('#/cash');
  }
  /** Báo cáo ca: lọc theo nhân viên, ngày, trạng thái; ca đang mở màu xanh, đã kết màu xám. */
  async function history() {
    const m = modal('Báo cáo ca'), shifts = st.options.shifts || [];
    const day = iso => { const d = new Date(iso); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
    const staff = el('select'); staff.setAttribute('aria-label', 'Nhân viên');
    for (const [v, t] of [['', 'Tất cả nhân viên'], ...[...new Set(shifts.map(s => s.memberName || ''))].filter(Boolean).sort().map(n => [n, n])]) { const o = el('option', '', t); o.value = v; staff.append(o); }
    const from = el('input'), to = el('input'); from.type = to.type = 'date'; from.setAttribute('aria-label', 'Từ ngày'); to.setAttribute('aria-label', 'Đến ngày');
    const status = el('select'); status.setAttribute('aria-label', 'Trạng thái');
    for (const [v, t] of [['', 'Tất cả ca'], ['open', 'Đang mở'], ['closed', 'Đã kết']]) { const o = el('option', '', t); o.value = v; status.append(o); }
    const filters = el('div', 'pos-shift-filters'), count = el('p', 'pos-note');
    const lbl = (t, c) => { const l = el('label'); l.append(el('span', '', t), c); return l; };
    filters.append(lbl('Nhân viên', staff), lbl('Từ ngày', from), lbl('Đến ngày', to), lbl('Trạng thái', status));
    const list = el('div', 'pos-customer-list pos-shift-list');
    const open = async (s, view, label) => {
      view.disabled = true; view.textContent = 'Đang tải báo cáo…';
      try {
        const d = await api('/pos/shifts/' + s.id);
        const detail = modal('Báo cáo ca ' + when(s.openedAt) + ' · ' + (s.memberName || ''));
        detail.body.append(el('p', 'pos-note', s.closedAt ? `Đã kết ${when(s.closedAt)}` : 'Ca đang mở – số liệu tính đến hiện tại'));
        detail.body.parentElement?.classList.add('pos-modal-wide');
        renderShiftReport(detail.body, d, { onOpen: target => {
          detail.close();
          if (target === 'cash') go('#/cash');
          else if (target === 'orders') go('#/orders');
          else if (target === 'returns') openReturns();
          else if (target === 'flows') run(flowOrders);
          else if (target === 'cod') run(() => codList());
        } });
        const acts = el('div', 'pos-actions');
        acts.append(button('In K80', 'btn primary', () => printPos(d, 'shift')), button('Đóng', 'btn secondary', detail.close));
        detail.body.append(acts);
        m.close(); detail.show();
      } catch (e) { toast(e.message, 'err'); view.disabled = false; view.textContent = label; }
    };
    const draw = () => {
      const rows = shifts.filter(s => (!staff.value || s.memberName === staff.value) && (!from.value || day(s.openedAt) >= from.value) && (!to.value || day(s.openedAt) <= to.value)
        && (!status.value || (status.value === 'open') === !s.closedAt));
      count.textContent = `${rows.length} ca` + (shifts.length >= 50 ? ' (50 ca gần nhất)' : '');
      list.replaceChildren(...(rows.length ? rows.map(s => {
        const label = `${when(s.openedAt)} · ${s.closedAt ? 'Đã kết' : 'Đang mở'} · ${s.memberName || 'Nhân viên không còn trong danh mục'}`;
        const view = button(label, 'btn ' + (s.closedAt ? 'pos-shift-closed' : 'pos-shift-open'), () => open(s, view, label));
        return view;
      }) : [el('p', 'pos-note', 'Không có ca phù hợp bộ lọc.')]));
    };
    for (const x of [staff, from, to, status]) x.addEventListener('change', draw);
    draw();
    m.body.append(filters, count, list, button('Đóng', 'btn secondary', m.close));
    m.show();
  }
  let qrBusy = false;
  async function qr() {
    if (!requireCustomer() || qrBusy || st.busy) return;
    qrBusy = true;
    const qrButton = nodes.qr, qrLabel = qrButton?.textContent;
    if (qrButton) { qrButton.disabled = true; qrButton.textContent = 'Đang tạo mã QR…'; qrButton.classList.add('is-busy'); }
    let d;
    try { d = await api('/pos/qr', 'POST', { ...payload(), key: key() }); }
    finally {
      qrBusy = false;
      if (qrButton) { qrButton.textContent = qrLabel; qrButton.classList.remove('is-busy'); }
      refreshPay();
    }
    const m = modal('VietQR – chờ xác nhận thu');
    m.dlg.classList.add('pos-step-modal', 'pos-qr-modal');
    st.qr = d;
    const image = el('img', 'pos-qr');
    const status = el('p', 'pos-qr-status is-waiting', 'Đang chờ SePay xác nhận tiền vào…');
    status.setAttribute('role', 'status');
    let completing = false;
    image.src = d.url;
    image.alt = 'VietQR thanh toán';
    const amount = el('section', 'pos-step-due');
    amount.append(el('span', '', 'Số tiền chuyển khoản'), el('strong', '', money(d.amount)));
    const info = el('div', 'pos-qr-info');
    info.append(image, el('p', 'pos-qr-content', 'Nội dung: ' + d.content), status);
    const received = button('Đã nhận tiền – thu & in', 'btn primary', async () => {
      if (!(await confirmBox('Cửa hàng đã thực nhận đủ ' + money(d.amount) + ' qua chuyển khoản?'))) return;
      st.method = 'transfer';
      nodes.confirm.checked = true;
      drawMethods();
      m.lock(true, received, 'Đang lưu đơn & in bill…');
      const result = await pay(false, d.id);
      if (m.dlg.open !== false) m.lock(false, received);
      if (!st.pending && result !== 'rejected' && result !== 'busy') m.close();
    });
    const footer = el('div', 'pos-step-footer');
    footer.append(button('Đóng', 'btn secondary', () => { if (!m.dlg.dataset.busy) m.close(); }), received);
    m.body.append(amount, info, footer);
    m.show();
    const ownerId = user().id;
    const timer = setInterval(async () => {
      if (st.qr !== d || completing || user().id !== ownerId || Date.now() > Date.parse(d.expiresAt)) return clearInterval(timer);
      try {
        const state = await api('/pos/qr/' + encodeURIComponent(d.id) + '/status');
        if (st.qr !== d || user().id !== ownerId || !state.paid) return;
        completing = true;
        clearInterval(timer);
        if(state.requiresReconciliation){st.qr=null;nodes.confirm.checked=false;refreshPay();status.textContent='Chuyển khoản đến sau khi hết giữ tiền đổi hàng. Cần Manager tra soát trước khi bán.';toast(status.textContent,'err');return;}
        if (state.consumed) {
          st.qr = null;
          nodes.confirm.checked = false;
          refreshPay();
          toast('Giao dịch đã được ghi nhận: ' + state.order.orderNo);
          if (m.dlg.open) m.close();
          return;
        }
        d.paid = true;
        status.textContent = 'SePay đã xác nhận nhận đủ tiền.'; status.className = 'pos-qr-status is-paid';
        st.method = 'transfer';
        nodes.confirm.checked = true;
        drawMethods();
        nodes.confirm.disabled = true;
        nodes.transferLabel.textContent = 'SePay đã xác nhận cửa hàng nhận đủ ' + money(d.amount);
        refreshPay();
        toast('SePay đã xác nhận nhận đủ tiền. Bấm Thu tiền & in để hoàn tất.');
        if (m.dlg.open) m.close();
      } catch { /* Mất mạng tạm thời: lượt kiểm tra tiếp theo sẽ thử lại. */ }
    }, 2000);
    // Continue watching this QR after closing the popup; cart changes invalidate it.
  }
  /** Ship COD: nhập người nhận + địa chỉ chuẩn GHN → kiểm tra lại → tạo đơn. Form giữ nguyên tới khi máy chủ trả lời. */
  function codForm() {
    const total = st.preview.total;
    const m = formModal('Giao Hàng Nhanh · nhập địa chỉ');
    m.dlg.classList.add('pos-step-modal', 'pos-cod-modal');
    m.body.querySelectorAll?.('h2')?.[0]?.append?.(el('span', 'pos-payment-meta', st.customer?.name || ''));
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date());
    const address = field('Số nhà, tên đường'),
      phone = field('Điện thoại người nhận', 'tel', st.customer?.phone || ''),
      receiver = field('Người nhận', 'text', st.customer?.name || ''),
      date = field('Ngày giao', 'date', today),
      ghnOrderCode = field('Mã vận đơn GHN (nếu đã có)', 'text', '');
    ghnOrderCode.input.placeholder = 'Ví dụ: GYMNNELK';
    const steps = el('ol', 'pos-steps');
    const stepItems = ['Thông tin giao', 'Kiểm tra lại', 'Tạo đơn COD'].map((t, i) => { const li = el('li', i ? '' : 'is-current'); li.append(el('b', '', String(i + 1)), el('span', '', t)); steps.append(li); return li; });
    const setStep = (n) => stepItems.forEach((li, i) => { li.className = i < n ? 'is-done' : i === n ? 'is-current' : ''; });
    const ghnIntro = el('p', 'pos-note pos-step-intro', 'Thông tin đơn hàng và người nhận đã được lấy sẵn. Chọn địa chỉ chuẩn Giao Hàng Nhanh trước khi xác nhận đơn COD.');
    address.input.required = phone.input.required = receiver.input.required = true;
    address.input.placeholder = 'Ví dụ: 123 Nguyễn Trãi';
    phone.input.inputMode = 'tel';
    const ghn = ghnLocationFields(async (extra = {}) => (await api('/pos/ghn/locations', 'POST', { registerId: st.register.id, ...extra })).locations);
    const { province, district, ward } = ghn;
    const deposit = field('Đã thu trước / tạm ứng (VNĐ)', 'number', '0');
    deposit.input.min = '0'; deposit.input.max = String(total); deposit.input.step = '1'; deposit.input.inputMode = 'numeric'; deposit.input.required = true;
    const method = el('select'), methodBox = el('label', 'pos-field');
    method.setAttribute('aria-label', 'Hình thức thu trước');
    for (const [value, name] of [['cash', 'Tiền mặt'], ['transfer', 'Chuyển khoản']]) {
      const option = el('option', '', name); option.value = value; method.append(option);
    }
    methodBox.append(el('span', '', 'Hình thức thu trước'), method);
    const confirmed = el('input'), confirmation = el('label', 'pos-note pos-cod-confirm'); confirmed.type = 'checkbox';
    confirmation.append(confirmed, document.createTextNode(' Tôi xác nhận cửa hàng đã thực nhận chuyển khoản thu trước'));
    const remaining = el('strong', 'pos-cod-remaining'), paidBefore = el('b', '', money(0)), validation = el('p', 'error'), serverError = el('p', 'error pos-step-error'); validation.setAttribute('role', 'alert'); serverError.setAttribute('role', 'alert');
    const summary = el('div', 'pos-step-summary');
    const row = (label, value, cls = '') => { const r = el('div', cls); r.append(el('span', '', label), value); return r; };
    summary.append(row('Tổng đơn', el('b', '', money(total))), row('Đã thu trước', paidBefore), row('Còn thu khi giao', remaining, 'is-main'));
    const section = (title, ...children) => { const box = el('section', 'pos-step-section'); box.append(el('h3', '', title), ...children); return box; };
    const grid = (...children) => { const g = el('div', 'pos-step-grid'); g.append(...children); return g; };
    const editView = el('div', 'pos-step-body');
    editView.append(
      ghnIntro,
      section('Người nhận', grid(receiver.box, phone.box)),
      section('Địa chỉ giao (chuẩn GHN)', address.box, grid(province.box, district.box, ward.box), ghn.retry, grid(date.box, ghnOrderCode.box)),
      section('Thu trước', grid(deposit.box, methodBox), confirmation, summary),
      el('p', 'pos-note', 'Chỉ nhập khoản cửa hàng đã thực nhận. Tiền mặt thu trước vào két ca hiện tại; phần còn lại ghi thu khi nhận COD.'),
      validation,
    );
    const review = el('div', 'pos-step-body pos-step-review'); review.hidden = true;
    const save = el('button', 'btn primary', 'Kiểm tra lại');
    save.type = 'submit';
    const back = button('← Quay lại thanh toán', 'btn secondary', () => {
      if (m.dlg.dataset.busy) return;
      if (reviewing) return edit();
      m.close(); openPayment();
    });
    const footer = el('div', 'pos-step-footer'); footer.append(back, save);
    const fullAddress = () => ghn.fullAddress(address.input.value);
    const updateDeposit = () => {
      const n = Number(deposit.input.value), valid = deposit.input.value !== '' && Number.isSafeInteger(n) && n >= 0 && n <= total;
      remaining.textContent = money(valid ? total - n : total);
      paidBefore.textContent = money(valid ? n : 0);
      summary.setAttribute('aria-label', 'Còn lại thu COD: ' + remaining.textContent);
      validation.textContent = valid ? '' : 'Nhập số tiền thu trước từ 0 đến tổng đơn, không có số lẻ.';
      methodBox.hidden = !valid || n === 0;
      confirmation.hidden = !valid || n === 0 || method.value !== 'transfer';
      save.disabled = !valid || (n > 0 && method.value === 'transfer' && !confirmed.checked);
    };
    deposit.input.addEventListener('input', () => { confirmed.checked = false; updateDeposit(); });
    method.addEventListener('change', () => { confirmed.checked = false; updateDeposit(); });
    confirmed.addEventListener('change', updateDeposit);
    let reviewing = false;
    const edit = () => {
      reviewing = false; setStep(0); editView.hidden = false; review.hidden = true;
      back.textContent = '← Quay lại thanh toán'; save.textContent = 'Kiểm tra lại'; updateDeposit();
    };
    const showReview = () => {
      reviewing = true; setStep(1);
      const n = Number(deposit.input.value);
      const lines = [
        ['Người nhận', `${receiver.input.value.trim()} · ${phone.input.value.trim()}`],
        ['Địa chỉ', fullAddress()],
        ['Ngày giao', date.input.value.split('-').reverse().join('/')],
        ['Tổng đơn', money(total)],
        ...(n > 0 ? [['Đã thu trước', money(n) + (method.value === 'transfer' ? ' · chuyển khoản' : ' · tiền mặt')]] : []),
      ];
      const list = el('dl', 'pos-review-list');
      for (const [k, v] of lines) list.append(el('dt', '', k), el('dd', '', v));
      const due = el('section', 'pos-step-due'); due.append(el('span', '', 'Còn lại thu khi giao (COD)'), el('strong', '', money(total - n)));
      review.replaceChildren(el('p', 'pos-note pos-step-intro', 'Kiểm tra lần cuối thông tin người nhận, địa chỉ và tiền thu COD. Bấm xác nhận để tạo đơn.'), due, list);
      editView.hidden = true; review.hidden = false;
      back.textContent = '← Sửa thông tin'; save.textContent = 'Xác nhận & tạo đơn COD'; save.disabled = false;
    };
    m.form.append(steps, serverError, editView, review, footer);
    updateDeposit();
    m.form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (m.dlg.dataset.busy) return;
      if (!reviewing) {
        updateDeposit(); if (save.disabled) return;
        if (!receiver.input.value.trim() || !phone.input.value.trim() || !address.input.value.trim()) { validation.textContent = 'Nhập đủ người nhận, điện thoại và số nhà, tên đường.'; return; }
        if (!ghn.complete()) { validation.textContent = 'Chọn đủ Tỉnh/Thành, Quận/Huyện và Phường/Xã theo GHN.'; return toast(validation.textContent, 'err'); }
        return showReview();
      }
      const n = Number(deposit.input.value);
      const body = {
        ...payload(),
        key: key(),
        fulfillmentMode: 'cod',
        ...(n > 0 ? { depositAmount: n, method: method.value, confirmed: method.value === 'transfer' && confirmed.checked } : {}),
        delivery: {
          address: fullAddress(),
          receiverName: receiver.input.value,
          receiverPhone: phone.input.value,
          plannedDate: date.input.value,
          ...(ghnOrderCode.input.value.trim() ? { ghnOrderCode: ghnOrderCode.input.value.trim() } : {}),
          ghnProvinceId: province.select.value, ghnDistrictId: district.select.value, ghnWardCode: ward.select.value,
        },
      };
      setStep(2); serverError.textContent = '';
      m.lock(true, save, 'Đang tạo đơn COD…');
      const result = await submit(body, m.close);
      if (result === 'saved' || result === 'unknown') { if (m.dlg.open !== false) m.close(); return; }
      m.lock(false, save);
      setStep(1);
      if (result === 'rejected') { edit(); serverError.textContent = 'Máy chủ chưa tạo đơn. Kiểm tra lại thông tin rồi gửi lại.'; }
    });
    m.show();
    run(ghn.loadProvinces);
  }
  async function pay(cod = false, qrId) {
    if (!requireCustomer()) return;
    if (st.busy || st.pending) return;
    if (!active() || !st.preview || !st.cart.length) return toast('Mở ca và chọn hàng trước.', 'err');
    if (cod) return codForm();
    if (st.method === 'transfer' && !nodes.confirm.checked) return toast('Xác nhận đã thực nhận chuyển khoản.', 'err');
    return submit({
      ...payload(),
      key: key(),
      method: st.method,
      tendered: Number(nodes.tender.value || 0),
      confirmed: st.method === 'transfer',
      ...(st.method === 'transfer' && (qrId || st.qr?.paid) ? { paymentRequestId: qrId || st.qr.id } : {}),
    });
  }
  /**
   * Gửi đơn lên máy chủ. Trả về 'saved' (đã lưu), 'rejected' (máy chủ từ chối – form giữ nguyên để sửa),
   * 'unknown' (mất kết nối – giữ giao dịch chờ kiểm tra lại) hoặc 'busy' (đang gửi lượt khác).
   * `onSaved` chạy ngay khi máy chủ xác nhận, trước khi hiện hộp "Đã lưu đơn hàng" (đóng form đang mở).
   */
  async function submit(body, onSaved) {
    if (st.busy) return 'busy';
    persistPending(body);
    st.busy = true;
    const payModal = paymentModal;
    if (payModal) payModal.dlg.dataset.busy = '1';
    refreshPay();
    try {
      const d = await api('/pos/checkout', 'POST', body);
      onSaved?.();
      paymentModal?.close();
      persistPending(null);
      st.cart = [];
      st.customer = null;
      st.serviceFees = []; st.shippingFee = ''; st.note = ''; st.voucher = emptyVoucher(); st.exchangeAllocationId = '';
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
      const saved = modal('Đã lưu đơn hàng');
      saved.dlg.className += ' pos-saved-modal';
      const summary = el('div', 'pos-saved-summary'), check = el('span', 'pos-saved-check', '✓');
      check.setAttribute('aria-hidden', 'true');
      const identity = el('div'); identity.append(el('span', 'pos-saved-label', 'Mã đơn hàng'), el('strong', 'pos-saved-order', d.orderNo));
      summary.append(check, identity);
      const total = el('div', 'pos-saved-total'); total.append(el('span', '', 'Tổng đơn hàng'), el('strong', '', money(d.total)));
      const actions = el('div', 'pos-saved-actions');
      actions.append(button('In lại bill', 'btn secondary', () => printPos(d)));
      if (body.fulfillmentMode === 'cod') actions.append(ghnPortalLink(d.ghnOrderCode || ''));
      const next = button('Bán đơn tiếp', 'btn primary pos-saved-next', () => { saved.close(); nodes.search?.focus(); }); actions.append(next);
      saved.body.append(summary, total, el('p', 'pos-saved-hint', 'Đơn đã được lưu. Có thể in lại bill hoặc tiếp tục bán hàng.'), actions);
      saved.show();
      next.focus();
      await load();
      return 'saved';
    } catch (e) {
      if (e.status >= 400 && e.status < 500) {
        persistPending(null);
        toast(e.message, 'err');
        return 'rejected';
      }
      toast('Chưa rõ kết quả. Bấm Kiểm tra lại giao dịch để lấy đúng đơn, không thu lần nữa.', 'err');
      paymentModal?.close();
      draw();
      return 'unknown';
    } finally {
      st.busy = false;
      if (payModal) delete payModal.dlg.dataset.busy;
      refreshPay();
    }
  }
  // Đồng bộ trạng thái vận đơn GHN (shop Lock) ngay trong CRM: tự chạy khi mở Ship COD, hoặc bấm "↻ Đồng bộ GHN".
  // Giao xong → máy chủ tự xuất kho và ghi thu COD (nguồn GHN); bấm liên tục trong 60 giây dùng lại kết quả cũ.
  async function syncGhn(status, btn, reopen) {
    if (btn.dataset.busy) return;
    btn.dataset.busy = '1'; btn.disabled = true; btn.className += ' is-busy'; status.textContent = 'Đang đồng bộ trạng thái GHN…';
    try {
      const r = await api('/pos/ghn/sync', 'POST', {});
      status.textContent = 'GHN ' + new Date(r.syncedAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Ho_Chi_Minh' }) +
        ': kiểm ' + r.checked + ' vận đơn, cập nhật ' + r.updated + (r.errors?.length ? ', ' + r.errors.length + ' lỗi (' + r.errors[0].code + ': ' + r.errors[0].message + ')' : '') + '.';
      if (r.updated && !r.cached) reopen();
    } catch (e) {
      status.textContent = e.message || 'Không đồng bộ được GHN.';
    } finally {
      delete btn.dataset.busy; btn.disabled = false; btn.className = btn.className.replace(' is-busy', '');
    }
  }
  async function codList(autoSync = true) {
    if (!active()) return toast('Mở ca để theo dõi và thu COD.', 'err');
    const d = await api('/pos/cod?shiftId=' + st.shift.id),
      m = modal('Ship COD của quầy');
    const ghnBar = el('div', 'pos-ghn-bar'), ghnStatus = el('small', 'muted', ''),
      ghnBtn = button('↻ Đồng bộ GHN', 'btn secondary', () => syncGhn(ghnStatus, ghnBtn, reopen)),
      reopen = () => { m.close(); run(() => codList(false)); };
    ghnBtn.setAttribute('aria-label', 'Đồng bộ trạng thái vận đơn GHN');
    ghnBar.append(ghnBtn, ghnStatus);
    m.body.append(ghnBar);
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
              if (b.dataset.busy) return;
              b.dataset.busy = '1'; b.disabled = true;
              try {
                if (!(await confirmBox('Cửa hàng đã thực nhận ' + money(x.codAmount - x.paid) + '?'))) return;
                b.textContent = 'Đang ghi thu…';
                await api('/pos/cod/' + encodeURIComponent(x.id) + '/collect', 'POST', {
                  key: requestKey,
                  shiftId: st.shift.id,
                  method: method.value,
                  confirmed: true,
                });
                m.close();
                toast('Đã ghi thu vào ca hiện tại.');
                await run(loadOrderBoard);
              } finally {
                delete b.dataset.busy; b.disabled = false; b.textContent = 'Xác nhận đã thu';
              }
            }),
          ),
          requestKey = key();
        method.setAttribute('aria-label', 'Hình thức thu COD ' + x.orderNo);
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
    if (autoSync) syncGhn(ghnStatus, ghnBtn, reopen);
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
      busyButton('Thêm ca', 'btn secondary', 'Đang thêm…', async () => {
        await api('/pos/templates', 'POST', {
          name: tn.input.value,
          startsAt: start.input.value,
          endsAt: end.input.value,
        });
        tn.input.value = '';
        toast('Đã thêm ca.');
        await load(); // ca mới hiện ngay trong hộp Mở ca
      }),
    );
    const sku = field('Mã hàng SKU'),
      barcode = field('Mã vạch');
    extra.append(
      sku.box,
      barcode.box,
      busyButton('Gắn mã vạch', 'btn secondary', 'Đang gắn…', async () => {
        await api('/pos/barcodes', 'POST', {
          sku: sku.input.value,
          barcode: barcode.input.value,
        });
        barcode.input.value = '';
        toast('Đã gắn mã vạch.');
      }),
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
