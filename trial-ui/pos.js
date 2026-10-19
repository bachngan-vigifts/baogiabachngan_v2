import { openPosReturns } from './pos-returns.js';
import { startBarcodeCamera } from './barcode-camera.js';
import { printPos } from './pos-print.js';
import { shiftSummaryRows, shiftCodRows } from './pos-report.js';
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
    feeName: '', feeAmount: '', shippingFee: '', feeVisible: false, note: '', exchangeAllocationId: '',
    preview: null,
    method: 'cash',
    qr: null,
    busy: false,
    pending: null,
    products: [],
    orderBoard: null,
    orderStatus: 'all',
    orderQuery: '',
    orderRegisterId: '',
    productFilter: 'all',
    catalogLoading: false,
    offset: 0,
    request: 0,
    showMenu: false,
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
    st.qr = null;
    st.register = null;
    st.policy = '';
    st.cart = [];
    st.customer = null;
    st.feeName = ''; st.feeAmount = ''; st.shippingFee = ''; st.feeVisible = false; st.note = ''; st.exchangeAllocationId = '';
    st.preview = null;
    st.pending = null;
    st.orderBoard = null;
    st.orderStatus = 'all';
    st.orderQuery = '';
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
  const payload = () => ({
    registerId: st.register.id,
    shiftId: st.shift.id,
    pricePolicyId: st.policy,
    customerId: st.customer?.id || '',
    ...(st.note.trim() ? { note: st.note } : {}),
    ...(st.exchangeAllocationId ? {exchangeAllocationId:st.exchangeAllocationId} : {}),
    ...(st.feeName || st.feeAmount || st.shippingFee ? { feeName: st.feeName, feeAmount: st.feeAmount || 0, shippingFee: st.shippingFee || 0 } : {}),
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
    const closeButton = button('×', 'icon-btn pos-modal-close', close);
    closeButton.setAttribute('aria-label', 'Đóng');
    closeButton.title = 'Đóng';
    body.append(el('h2', '', title), closeButton);
    dlg.append(body);
    document.body.append(dlg);
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
    title.append(el('h1', '', 'Bán hàng nhanh'), el('span', 'pos-register-name', st.register?.name || 'Chưa cấu hình quầy'));
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
    if (!active() && st.options.registers.length > 1) {
      const regSelect = select(
        st.options.registers.map((r) => [r.id, r.name]),
        st.register?.id,
      );
      regSelect.setAttribute('aria-label', 'Chọn quầy');
      regSelect.addEventListener('change', () => {
        st.register = st.options.registers.find((r) => r.id === regSelect.value);
        st.policy = st.register.pricePolicyId;
        st.orderRegisterId = st.register.id;
        st.orderBoard = null;
        draw();
        run(() => Promise.all([search(false), loadOrderBoard()]));
      });
      tools.append(regSelect);
    }
    tools.append(button(active() ? 'Kết ca' : 'Mở ca', active() ? 'btn pos-close-shift' : 'btn primary', () => run(active() ? closeShift : openShift)));
    const more = el('details', 'pos-more-menu'), moreSummary = el('summary', '', '⋯'), morePanel = el('div', 'pos-more-panel');
    moreSummary.setAttribute('aria-label', 'Thao tác khác');
    const menuAction = (label, fn) => { const b = button(label, 'btn ghost', () => { more.open = false; fn(); }); morePanel.append(b); };
    menuAction('Trả / Đổi / Hoàn', () => openPosReturns({api,toast,shift:st.shift,register:st.register,cartTotal:st.preview?.total||0,onExchange:async({allocation,customer})=>{st.exchangeAllocationId=allocation.id;st.customer=customer;if(allocation.amount >= (st.preview?.total||0))st.method='cash';invalidate();draw();await preview();},onChanged:()=>search()}));
    menuAction('Báo cáo ca', () => run(history));
    menuAction('Ship COD', () => run(codList));
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
    bh.append(button((st.customer?.name || 'Khách lẻ') + '   Đổi ▾', 'btn primary pos-customer-trigger', chooseCustomer));
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
    nodes.mobileCartCustomer = el('small', '', 'Khách lẻ');
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
    const d = await api('/pos/orders?' + p);
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
      reg.addEventListener('change', () => { st.orderRegisterId = reg.value; run(loadOrderBoard); });
      head.append(reg);
    }
    box.append(head);
    if (!d) { box.append(el('p', 'pos-note', 'Đang tải đơn hàng…')); return; }
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
    let timer;
    search.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => { st.orderQuery = search.value.trim(); run(loadOrderBoard); }, 250); });
    box.append(search);
    const list = el('div', 'pos-order-list');
    if (!d.orders.length) list.append(el('p', 'pos-note', 'Không có đơn trong trạng thái này.'));
    for (const o of d.orders) {
      const row = el('button', 'pos-order-row'); row.type = 'button';
      row.append(
        el('b', '', o.orderNo),
        el('span', '', o.customerName + ' · ' + money(o.total)),
        el('span', 'pos-note', (o.ownerName || 'Chưa có nhân viên') + ' · ' + (o.external ? 'Đơn website' : o.fulfillmentMode === 'cod' ? 'Giao COD' : 'Nhận tại quầy')),
        el('span', 'pos-order-state', orderLabels[o.bucket]),
      );
      row.addEventListener('click', () => o.external ? showWebOrder(o) : go('#/orders/' + encodeURIComponent(o.id)));
      list.append(row);
    }
    box.append(list);
  }
  function showWebOrder(o) {
    const m = modal(o.orderNo + ' · ' + (o.source === 'lock' ? 'Web LocknLock' : 'Web Minh Long'));
    m.body.append(el('p', '', o.customerName + (o.phone ? ' · ' + o.phone : '')), el('p', '', o.address || 'Chưa có địa chỉ'), el('b', '', money(o.total)));
    let lines = []; try { lines = JSON.parse(o.lines || '[]'); } catch {}
    for (const x of lines) m.body.append(el('p', 'pos-note', `${x.sku || ''} · ${x.name || ''} × ${x.quantity || 0}`));
    m.body.append(el('p', 'pos-note', 'Thanh toán: ' + (o.paymentMethod || 'Chưa cập nhật')));
    if (o.ghnOrderCode) m.body.append(
      el('p', '', 'Mã vận đơn GHN: ' + o.ghnOrderCode),
      el('p', 'pos-note', 'Trạng thái GHN: ' + (o.ghnStatus || 'Đã tạo vận đơn') + (o.ghnFee ? ' · Phí: ' + money(o.ghnFee) : '')),
    );
    const actions = el('div', 'pos-actions');
    if (o.actionsAvailable && o.bucket === 'pending') actions.append(button('Tiếp tục trên GHN', 'btn primary', () => { m.close(); showGhnAddress(o); }));
    if (o.actionsAvailable && o.bucket === 'pending') actions.append(button('Sửa địa chỉ GHN', 'btn secondary', () => { m.close(); showGhnAddress(o); }));
    if (o.actionsAvailable) actions.append(button('Cập nhật trạng thái', 'btn secondary', () => run(async () => {
      await api('/pos/web-orders/' + encodeURIComponent(o.id) + '/action', 'POST', { action: 'refresh' }); m.close(); toast('Đã cập nhật trạng thái đơn.', 'ok'); await loadOrderBoard();
    })));
    if (o.actionsAvailable && !['completed', 'cancelled'].includes(o.bucket)) actions.append(button('Huỷ đơn', 'btn danger', async () => {
      if (!await confirmBox(`Huỷ đơn ${o.orderNo}${o.ghnOrderCode ? ' và vận đơn GHN ' + o.ghnOrderCode : ''}?`, { title: 'Huỷ đơn website', ok: 'Huỷ đơn', danger: true })) return;
      await run(async () => { await api('/pos/web-orders/' + encodeURIComponent(o.id) + '/action', 'POST', { action: 'cancel' }); m.close(); toast('Đã huỷ đơn' + (o.ghnOrderCode ? ' và vận đơn GHN.' : '.'), 'ok'); await loadOrderBoard(); });
    }));
    actions.append(button('Đóng', 'btn secondary', m.close));
    m.body.append(actions);
    m.show();
  }
  async function showGhnAddress(o, reason = '') {
    const m = formModal('Hoàn thiện địa chỉ GHN · ' + o.orderNo);
    if (reason) m.form.append(el('p', 'pos-danger', reason));
    m.form.append(el('p', 'pos-note', 'Thông tin khách, điện thoại, sản phẩm, COD và khối lượng được giữ nguyên. Chỉ cần chọn lại địa chỉ giao hàng.'));
    const address = field('Số nhà, tên đường', 'text', o.address || '');
    address.input.required = true; address.input.placeholder = 'Ví dụ: 123 Nguyễn Trãi';
    const locationField = (label) => { const box = el('label', 'pos-field'), s = select([['', 'Đang tải…']], ''); box.append(el('span', '', label), s); return { box, select: s }; };
    const province = locationField('Tỉnh / Thành phố'), district = locationField('Quận / Huyện'), ward = locationField('Phường / Xã');
    district.select.disabled = true; ward.select.disabled = true;
    const setOptions = (s, rows, placeholder) => { s.replaceChildren(); const first = el('option', '', placeholder); first.value = ''; s.append(first); for (const x of rows || []) { const op = el('option', '', x.name); op.value = x.id; s.append(op); } s.disabled = false; };
    const loadLocations = async (extra = {}) => (await api('/pos/web-orders/' + encodeURIComponent(o.id) + '/action', 'POST', { action: 'locations', ...extra })).locations;
    province.select.addEventListener('change', () => run(async () => {
      district.select.disabled = true; ward.select.disabled = true; setOptions(ward.select, [], 'Chọn Phường / Xã'); ward.select.disabled = true;
      setOptions(district.select, await loadLocations({ provinceId: province.select.value }), 'Chọn Quận / Huyện');
    }));
    district.select.addEventListener('change', () => run(async () => {
      ward.select.disabled = true; setOptions(ward.select, await loadLocations({ districtId: district.select.value }), 'Chọn Phường / Xã');
    }));
    const actions = el('div', 'pos-actions'), submit = button('Tiếp tục trên GHN', 'btn primary'); submit.type = 'submit';
    actions.append(button('Đóng', 'btn secondary', m.close), submit);
    m.form.append(address.box, province.box, district.box, ward.box, actions);
    let reviewing = false;
    m.form.addEventListener('submit', async e => {
      e.preventDefault();
      if (!province.select.value || !district.select.value || !ward.select.value) return toast('Chọn đủ Tỉnh/Thành, Quận/Huyện và Phường/Xã.', 'err');
      if (!reviewing) {
        reviewing = true;
        for (const input of m.form.querySelectorAll('input, select')) input.disabled = true;
        submit.textContent = 'Xác nhận & tạo vận đơn GHN';
        m.form.insertBefore(el('p', 'pos-cod-remaining', 'Kiểm tra lần cuối địa chỉ và thông tin đơn trước khi tạo vận đơn.'), actions);
        return;
      }
      submit.disabled = true;
      try {
        const chosen = s => s.options[s.selectedIndex]?.textContent || '';
        await api('/pos/web-orders/' + encodeURIComponent(o.id) + '/action', 'POST', { action: 'confirm', addressLine: address.input.value.trim(),
          provinceId: province.select.value, provinceName: chosen(province.select), districtId: district.select.value, districtName: chosen(district.select), wardCode: ward.select.value, wardName: chosen(ward.select) });
        m.close(); toast('Đã lưu địa chỉ và tạo vận đơn GHN.', 'ok'); await loadOrderBoard();
      } catch (err) { toast(err.message, 'err'); submit.disabled = false; }
    });
    m.show();
    try { setOptions(province.select, await loadLocations(), 'Chọn Tỉnh / Thành phố'); }
    catch (e) { toast(e.message, 'err'); province.select.disabled = true; }
  }
  async function printTemporary() {
    if (!st.cart.length || !active()) return toast('Mở ca và chọn hàng trước.', 'err');
    const d = await api('/pos/preview', 'POST', payload());
    try { printPos(d); }
    catch { toast('Chưa in được bill tạm. Kiểm tra máy in rồi thử lại.', 'err'); }
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
    if (!st.cart.length) return;
    if (!await confirmBox('Hủy toàn bộ đơn hiện tại?', { ok: 'Hủy đơn' })) return;
    st.cart = []; st.customer = null; st.feeName = ''; st.feeAmount = ''; st.shippingFee = ''; st.feeVisible = false; st.note = ''; st.exchangeAllocationId = ''; st.preview = null; st.qr = null; st.method = 'cash';
    draw(); if (st.register) await search(false);
  }
  function openPayment() {
    if (!active() || !st.preview || !st.cart.length || st.pending || st.busy) return;
    const m = modal('Thanh toán'); m.dlg.classList.add('pos-payment-modal');
    const headerMeta = el('span', 'pos-payment-meta', `Đơn hiện tại · ${st.customer?.name || 'Khách lẻ'}`),
      due = el('section', 'pos-payment-due');
    m.body.querySelectorAll?.('h2')?.[0]?.append?.(headerMeta);
    due.append(el('span', '', 'Cần thu'), el('strong', '', money(st.preview.payable ?? st.preview.total)));
    const methods = el('div', 'pos-payment-methods');
    for (const [id, name, hint] of [['cash','Tiền mặt',''],['transfer','Chuyển khoản','Tạo mã QR'],['cod','Ship COD','Thu khi giao']]) {
      const b = button('', 'pos-payment-method', () => {
        st.method = id === 'cod' ? 'cod' : id; drawMethods(); refreshPay();
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
    const cod = el('section', 'pos-payment-cod', 'Bước tiếp theo mở màn Giao Hàng Nhanh để nhập địa chỉ và thông tin người nhận.'); nodes.cod = cod;
    const footer = el('div', 'pos-payment-footer'); nodes.temp = button('In bill tạm', 'btn secondary', () => run(printTemporary));
    nodes.modalPay = button('Thu tiền & in bill', 'btn primary', async () => { if (st.method === 'cod') await pay(true); else await pay(false); if (!st.pending && !st.cart.length) m.close(); });
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
    if (nodes.modalPay) nodes.modalPay.textContent = st.method === 'cod' ? 'TIẾP TỤC TẠO ĐƠN COD' : 'Thu tiền & in bill';
  }
  function markProductsInCart() {
    const skus = new Set(st.cart.map(x => x.sku));
    for (const b of nodes.grid?.children || []) {
      if (!b.classList?.contains?.('pos-product') && !String(b.className || '').split(/\s+/).includes('pos-product')) continue;
      const selected = skus.has(b.dataset.sku);
      b.classList.toggle('pos-product-in-cart', selected);
      b.setAttribute('aria-pressed', String(selected));
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
    const box = el('section', 'pos-extra-fees'), service = el('div', 'pos-service-fee');
    service.hidden = !st.feeVisible;
    const name = field('Khoản phí'), amount = field('Số tiền phí', 'number', st.feeAmount), shipping = field('Phí ship · Không VAT', 'number', st.shippingFee);
    name.input.value = st.feeName;
    name.input.placeholder = 'Ví dụ: Phí in, phí gói quà…';
    name.input.maxLength = 200;
    for (const [f, property] of [[name, 'feeName'], [amount, 'feeAmount'], [shipping, 'shippingFee']]) {
      if (property !== 'feeName') { f.input.min = '0'; f.input.step = '1'; f.input.inputMode = 'numeric'; f.input.placeholder = '0 đ'; }
      f.input.addEventListener('input', () => { st[property] = f.input.value; invalidate(); });
    }
    const add = button('+ Thêm khoản phí', 'btn secondary small', () => { st.feeVisible = true; service.hidden = false; add.hidden = true; name.input.focus(); });
    add.hidden = st.feeVisible;
    service.append(name.box, amount.box, button('Bỏ phí', 'btn ghost small', () => {
      st.feeVisible = false; st.feeName = ''; st.feeAmount = '';
      name.input.value = ''; amount.input.value = ''; service.hidden = true; add.hidden = false; invalidate();
    }));
    const noteBox = el('label', 'pos-field pos-order-note'), note = el('textarea');
    note.rows = 2; note.maxLength = 2000; note.value = st.note;
    note.placeholder = 'Ví dụ: Gói riêng từng món, giao sau 17h…';
    note.setAttribute('aria-label', 'Ghi chú đơn hàng');
    note.addEventListener('input', () => { st.note = note.value; });
    noteBox.append(el('span', '', 'Ghi chú đơn hàng'), note);
    box.append(add, service, el('p', 'pos-note', 'Phí dịch vụ theo bảng giá; không áp dụng chiết khấu sản phẩm.'), noteBox);
    right.append(box);
    nodes.feeControls = box;
    nodes.shippingField = shipping.box;
  }
  function updateTotals() {
    nodes.totals.replaceChildren();
    const d = st.preview;
    for (const [label, value] of [
      ['Tạm tính', d ? money(d.total + d.discount) : st.cart.length ? 'Đang tính…' : '0 đ'],
      ['Giảm giá', d ? '−' + money(d.discount) : '—'],
      ...(d?.fees?.service?.amount ? [[d.fees.service.name + ' (trước thuế)', money(d.fees.service.subtotal)]] : []),
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
    if(st.exchangeAllocationId)nodes.totals.append(button('Bỏ áp dụng tiền đổi hàng','btn secondary small',()=>run(async()=>{await api('/pos/exchanges/'+st.exchangeAllocationId+'/cancel','POST',{});st.exchangeAllocationId='';invalidate();await preview();})));
    refreshPay();
  }
  function updateMobileDock() {
    if (!nodes.mobileCartCount) return;
    const count = st.cart.reduce((n, x) => n + Number(x.qty || 0), 0), d = st.preview;
    nodes.mobileCartCount.textContent = `Đơn hiện tại · ${count} món`;
    nodes.mobileCartCustomer.textContent = st.customer?.name || 'Khách lẻ';
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
      const b = button('', 'pos-product', () => add(p));
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
      b.append(el('b', 'pos-product-name', p.name), el('small', 'pos-product-sku', p.sku), priceStock);
      b.title = p.name + ' · ' + p.sku;
      b.disabled = !active() || p.available <= 0 || !!st.pending;
      nodes.grid.append(b);
    }
    if (!nodes.grid.children.length) nodes.grid.append(el('p', 'pos-note', 'Không có sản phẩm phù hợp.'));
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
        st.customer = c;
        nodes.customer.textContent = c ? c.name : 'Khách lẻ · Đổi';
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
      footer.append(button('Khách vãng lai · Không lưu hồ sơ', 'btn ghost', () => pick(null)), button('Đóng', 'btn secondary', close));
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
    const drawer = await api('/cash?registerId=' + encodeURIComponent(reg.value));
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
        b.disabled = true;
        try {
          const opened = await api('/pos/shifts/open', 'POST', {
            key: requestKey,
            registerId: reg.value,
            templateId: template.value,
            openingCash: countedCash,
            note: note.input.value,
          });
          if (opened.openingReconciliationId) toast('Đã mở ca bán hàng. Chênh lệch đầu ca đã gửi tra soát tại Sổ quỹ.');
          m.close();
          st.cart = [];
          await load();
        } finally {
          b.disabled = false;
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
      b.disabled = false;
    }));
  }
  function reportRows(container, d) {
    for (const [k, v] of shiftSummaryRows(d)) {
      const row = el('div', 'pos-total-row');
      row.append(el('span', '', k), el('b', '', v));
      container.append(row);
    }
    for (const x of d.bookAdjustments || []) container.append(el('p', 'pos-note', 'Điều chỉnh két: ' + money(x.direction === 'in' ? x.amount : -x.amount) + ' (điều chỉnh sổ, không thu/chi tiền thực trong ca)'));
    if (d.openingCount?.count) container.append(el('p', 'pos-note', `Kiểm đếm đầu ca: đếm nhanh một phần (${d.openingCount.count} mã), không phải kiểm kê toàn kho.`));
    container.append(el('h3', '', 'Ship COD'));
    for (const [name, value] of shiftCodRows(d)) {
      const r = el('div', 'pos-total-row');
      r.append(el('span', '', name), el('b', '', value));
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
      const label = `${when(s.openedAt)} · ${s.closedAt ? 'Đã kết' : 'Đang mở'} · ${s.memberName || 'Nhân viên không còn trong danh mục'}`;
      const view = button(label, 'btn secondary', async () => {
        view.disabled = true;
        view.textContent = 'Đang tải báo cáo…';
        try {
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
            m.close();
            detail.show();
        } catch (e) {
          toast(e.message, 'err');
          view.disabled = false;
          view.textContent = label;
        }
      });
      list.append(view);
    }
    m.body.append(list, button('Đóng', 'btn secondary', m.close));
    m.show();
  }
  async function qr() {
    const d = await api('/pos/qr', 'POST', { ...payload(), key: key() }),
      m = modal('VietQR – chờ xác nhận thu');
    st.qr = d;
    const image = el('img', 'pos-qr');
    const status = el('p', 'pos-note', 'Đang chờ SePay xác nhận tiền vào…');
    let completing = false;
    image.src = d.url;
    image.alt = 'VietQR thanh toán';
    m.body.append(
      el('p', '', money(d.amount)),
      image,
      el('p', '', 'Nội dung: ' + d.content),
      status,
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
        status.textContent = 'SePay đã xác nhận nhận đủ tiền.';
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
  async function pay(cod = false, qrId) {
    if (st.busy || st.pending) return;
    if (!active() || !st.preview || !st.cart.length) return toast('Mở ca và chọn hàng trước.', 'err');
    if (cod) {
      const m = formModal('Giao Hàng Nhanh · nhập địa chỉ'),
        address = field('Số nhà, tên đường'),
        phone = field('Điện thoại người nhận', 'tel', st.customer?.phone || ''),
        receiver = field('Người nhận', 'text', st.customer?.name || ''),
        date = field(
          'Ngày giao',
          'date',
          new Intl.DateTimeFormat('en-CA', {
            timeZone: 'Asia/Ho_Chi_Minh',
          }).format(new Date()),
        );
      m.dlg.classList.add('pos-cod-modal');
      const ghnIntro = el('p', 'pos-note', 'Thông tin đơn hàng và người nhận đã được lấy sẵn. Chọn địa chỉ chuẩn Giao Hàng Nhanh trước khi xác nhận đơn COD.');
      address.input.required = phone.input.required = receiver.input.required = true;
      address.input.placeholder = 'Ví dụ: 123 Nguyễn Trãi';
      const locationField = (label) => { const box = el('label', 'pos-field'), s = select([['', 'Đang tải…']], ''); box.append(el('span', '', label), s); return { box, select: s }; };
      const province = locationField('Tỉnh / Thành phố'), district = locationField('Quận / Huyện'), ward = locationField('Phường / Xã');
      district.select.disabled = true; ward.select.disabled = true;
      const setOptions = (s, rows, placeholder) => { s.replaceChildren(); const first = el('option', '', placeholder); first.value = ''; s.append(first); for (const x of rows || []) { const op = el('option', '', x.name); op.value = x.id; s.append(op); } s.disabled = false; };
      const loadLocations = async (extra = {}) => (await api('/pos/ghn/locations', 'POST', { registerId: st.register.id, ...extra })).locations;
      province.select.addEventListener('change', () => run(async () => {
        district.select.disabled = true; ward.select.disabled = true; setOptions(ward.select, [], 'Chọn Phường / Xã'); ward.select.disabled = true;
        setOptions(district.select, await loadLocations({ provinceId: province.select.value }), 'Chọn Quận / Huyện');
      }));
      district.select.addEventListener('change', () => run(async () => {
        ward.select.disabled = true; setOptions(ward.select, await loadLocations({ districtId: district.select.value }), 'Chọn Phường / Xã');
      }));
      const deposit = field('Đã thu trước / tạm ứng (VNĐ)', 'number', '0');
      deposit.input.min = '0'; deposit.input.max = String(st.preview.total); deposit.input.step = '1'; deposit.input.inputMode = 'numeric'; deposit.input.required = true;
      const method = el('select'), methodBox = el('label', 'pos-field');
      method.setAttribute('aria-label', 'Hình thức thu trước');
      for (const [value, name] of [['cash', 'Tiền mặt'], ['transfer', 'Chuyển khoản']]) {
        const option = el('option', '', name); option.value = value; method.append(option);
      }
      methodBox.append(el('span', '', 'Hình thức thu trước'), method);
      const confirmed = el('input'), confirmation = el('label', 'pos-note pos-cod-confirm'); confirmed.type = 'checkbox';
      confirmation.append(confirmed, document.createTextNode(' Tôi xác nhận cửa hàng đã thực nhận chuyển khoản thu trước'));
      const remaining = el('p', 'pos-cod-remaining'), validation = el('p', 'error'); validation.setAttribute('role', 'alert');
      const updateDeposit = () => {
        const n = Number(deposit.input.value), valid = deposit.input.value !== '' && Number.isSafeInteger(n) && n >= 0 && n <= st.preview.total;
        remaining.textContent = 'Còn lại thu COD: ' + money(valid ? st.preview.total - n : st.preview.total);
        validation.textContent = valid ? '' : 'Nhập số tiền thu trước từ 0 đến tổng đơn, không có số lẻ.';
        methodBox.hidden = !valid || n === 0;
        confirmation.hidden = !valid || n === 0 || method.value !== 'transfer';
        save.disabled = !valid || (n > 0 && method.value === 'transfer' && !confirmed.checked);
      };
      deposit.input.addEventListener('input', () => { confirmed.checked = false; updateDeposit(); });
      method.addEventListener('change', () => { confirmed.checked = false; updateDeposit(); });
      confirmed.addEventListener('change', updateDeposit);

      m.form.append(
        ghnIntro,
        receiver.box,
        phone.box,
        address.box,
        province.box, district.box, ward.box,
        date.box,
        el('p', '', 'Tổng đơn: ' + money(st.preview.total)),
        deposit.box, methodBox, confirmation, remaining, validation,
        el('p', 'pos-note', 'Chỉ nhập khoản cửa hàng đã thực nhận. Tiền mặt thu trước vào két ca hiện tại; phần còn lại ghi thu khi nhận COD.'),
      );
      const save = el('button', 'btn primary', 'Tiếp tục trên GHN');
      save.type = 'submit';
      m.form.append(save, button('Huỷ', 'btn secondary', m.close));
      updateDeposit();
      let reviewing = false;
      m.form.addEventListener('submit', (e) => {
        e.preventDefault();
        updateDeposit(); if (save.disabled) return;
        if (!province.select.value || !district.select.value || !ward.select.value) return toast('Chọn đủ Tỉnh/Thành, Quận/Huyện và Phường/Xã theo GHN.', 'err');
        const chosen = s => s.options[s.selectedIndex]?.textContent || '';
        if (!reviewing) {
          reviewing = true;
          ghnIntro.textContent = 'Kiểm tra lần cuối thông tin người nhận, địa chỉ và tiền thu COD. Bấm xác nhận để tạo đơn.';
          for (const input of m.form.querySelectorAll('input, select')) input.disabled = true;
          save.disabled = false; save.textContent = 'Xác nhận & tạo đơn COD';
          return;
        }
        save.disabled = true;
        const body = {
          ...payload(),
          key: key(),
          fulfillmentMode: 'cod',
          ...(Number(deposit.input.value) > 0 ? { depositAmount: Number(deposit.input.value), method: method.value, confirmed: method.value === 'transfer' && confirmed.checked } : {}),
          delivery: {
            address: [address.input.value, chosen(ward.select), chosen(district.select), chosen(province.select)].filter(Boolean).join(', '),
            receiverName: receiver.input.value,
            receiverPhone: phone.input.value,
            plannedDate: date.input.value,
            ghnProvinceId: province.select.value, ghnDistrictId: district.select.value, ghnWardCode: ward.select.value,
          },
        };
        m.close();
        submit(body);
      });
      m.show();
      run(async () => setOptions(province.select, await loadLocations(), 'Chọn Tỉnh / Thành phố'));
      return;
    }
    if (st.method === 'transfer' && !nodes.confirm.checked) return toast('Xác nhận đã thực nhận chuyển khoản.', 'err');
    await submit({
      ...payload(),
      key: key(),
      method: st.method,
      tendered: Number(nodes.tender.value || 0),
      confirmed: st.method === 'transfer',
      ...(st.method === 'transfer' && (qrId || st.qr?.paid) ? { paymentRequestId: qrId || st.qr.id } : {}),
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
      st.feeName = ''; st.feeAmount = ''; st.shippingFee = ''; st.feeVisible = false; st.note = ''; st.exchangeAllocationId = '';
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
          await api('/pos/barcodes', 'POST', {
            sku: sku.input.value,
            barcode: barcode.input.value,
          });
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
