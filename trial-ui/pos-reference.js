/** Presentation for the three reference layouts. Actions remain owned by POS. */
const paths = {
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/>',
  filter: '<path d="M3 4h18l-7 8v8l-4-2v-6z"/>',
  scan: '<path d="M4 7V4h5m6 0h5v3M4 17v3h5m6 0h5v-3M7 8v8m3-8v8m4-8v8m3-8v8"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  bag: '<rect x="5" y="7" width="14" height="14" rx="2"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>',
  back: '<path d="m9 5-6 6 6 6m-6-6h11a6 6 0 0 1 6 6"/>',
  print: '<path d="M7 8V3h10v5M7 17H4V9h16v8h-3M7 14h10v7H7z"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  bolt: '<path d="m13 2-9 12h7l-1 8 10-13h-7z"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/>',
  truck: '<path d="M3 5h11v12H3zM14 9h4l3 4v4h-7"/><circle cx="7" cy="18" r="2"/><circle cx="18" cy="18" r="2"/>',
  trash: '<path d="M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7"/>',
};
export function referenceIcon(doc, name) {
  const icon = doc.createElement('span'); icon.className = 'pos-ref-icon'; icon.setAttribute('aria-hidden', 'true');
  // Only our fixed SVG paths; never insert product/customer HTML.
  icon.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + (paths[name] || paths.plus) + '</svg>';
  return icon;
}
export function mountPosReference({page, head, left, right, board, searchRow, nodes, user, register, workspace, action, onMode, onDelivery, onCheckout}) {
  const doc = page.ownerDocument;
  // index.html preloads this. Standalone POS hosts use the same versioned asset;
  // the release stamper tracks this URL so immutable CSS cannot remain stale.
  if(!doc.querySelector('link[data-pos-reference]')){
    const style=doc.createElement('link');style.rel='stylesheet';style.dataset.posReference='';style.href=new URL('./pos-reference.css',import.meta.url).href;doc.head.append(style);
  }
  const el = (tag, cls, text) => { const n = doc.createElement(tag); n.className = cls || ''; if (text != null) n.textContent = text; return n; };
  const btn = (label, icon, fn, cls = '') => { const n = el('button', 'pos-ref-button '+cls); n.type = 'button'; n.title = label; n.setAttribute('aria-label', label); n.append(referenceIcon(doc, icon)); n.addEventListener('click', fn); return n; };
  page.classList.add('pos-reference');
  const originalTools = head.querySelector('.pos-head-tools'), originalTitle = head.firstElementChild;
  const menu = el('details', 'pos-ref-menu'), summary = el('summary'); summary.setAttribute('aria-label', 'Menu bán hàng'); summary.append(referenceIcon(doc, 'menu'));
  const menuBody = el('div', 'pos-ref-menu-body'); menuBody.append(originalTitle, originalTools); menu.append(summary, menuBody);
  const recent=left.querySelector('.pos-workspace-quick');if(recent)menuBody.append(recent);
  const shortcuts=page.querySelector('.pos-keyboard-bar');if(shortcuts)menuBody.append(shortcuts);
  const quantity = searchRow.querySelector('.pos-scan-quantity'); if (quantity) menuBody.append(quantity);
  const tabs = nodes.invoiceTabs || el('div', 'pos-ref-invoice','Hóa đơn hiện tại');
  const tools = el('div', 'pos-ref-header-actions');
  tools.append(btn('Đơn hàng cửa hàng', 'bag', action.orders), btn('Trả / Đổi / Hoàn', 'back', action.returns), btn('In bill tạm', 'print', action.print), el('span', 'pos-ref-store', register?.name || ''), menu);
  searchRow.prepend(referenceIcon(doc, 'search')); nodes.search.placeholder = 'Tìm hàng hóa · tên, mã, barcode (F2)';
  head.replaceChildren(searchRow, tabs, tools);
  const cashier = el('div', 'pos-ref-cashier'), date = el('time', '', new Intl.DateTimeFormat('vi-VN', {timeZone:'Asia/Ho_Chi_Minh',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date()));
  cashier.append(el('span', '', user?.name || 'Nhân viên'), date); right.querySelector('.pos-checkout-scroll').prepend(cashier);
  const basket = right.querySelector('.pos-basket-head'); nodes.customer.title = 'Tìm khách hàng';
  if(nodes.customer.textContent.includes('Chọn khách hàng'))nodes.customer.textContent='Tìm khách hàng (F3)';
  const note=left.querySelector('.pos-order-note textarea');if(note)note.placeholder='Ghi chú đơn hàng';
  const products = el('section', 'pos-ref-products'); products.setAttribute('aria-label','Danh mục bán hàng');
  const controls = left.querySelector('.pos-catalog-controls');
  products.append(controls, nodes.grid, left.querySelector('.pos-catalog-pages'));
  const catalogActions = el('div', 'pos-ref-catalog-actions');
  const view = btn('Đổi dạng hiển thị sản phẩm', 'menu', () => products.classList.toggle('pos-ref-list'));
  const filter = btn('Bộ lọc sản phẩm', 'filter', () => { const b = controls.querySelector('.pos-filter-toggle'); b?.click(); });
  catalogActions.append(view, filter); basket.append(catalogActions);
  const bottom = el('footer', 'pos-ref-bottom'), modes = el('nav', 'pos-ref-modes'); modes.setAttribute('aria-label', 'Chế độ bán hàng');
  const modeButtons = [];
  for (const [id, label, icon] of [['scan','Bán nhanh','bolt'],['grid','Bán thường','clock'],['delivery','Bán giao hàng','truck']]) {
    const n = btn(label, icon, () => setMode(id)); n.dataset.posMode = id; n.append(el('span','',label)); modes.append(n); modeButtons.push(n);
  }
  bottom.append(modes, el('span','pos-ref-shortcuts','F2 Tìm hàng · F3 Khách · F9 Thanh toán')); page.append(bottom);
  const normalFooter = el('div','pos-ref-normal-footer'), normalPay = el('button','btn primary','THANH TOÁN'); normalPay.type = 'button'; normalPay.addEventListener('click',onCheckout); normalFooter.append(normalPay); right.append(normalFooter);
  const closePayment = el('button','pos-ref-close-payment','← Danh mục sản phẩm'); closePayment.type = 'button'; closePayment.addEventListener('click',()=>page.classList.remove('pos-reference-checkout')); right.querySelector('.pos-checkout-scroll').prepend(closePayment);
  const carrier = el('section','pos-card pos-ref-carrier'), carrierTitle = el('h2','pos-ref-carrier-title'); carrierTitle.append(referenceIcon(doc,'truck'),el('span','','Cổng GHN'));
  const carrierNote = el('p','pos-ref-carrier-note','Chọn địa chỉ chuẩn GHN, kiểm tra người nhận và tiền COD trước khi xác nhận tạo vận đơn.');
  const sources = el('div','pos-ref-delivery-sources'), web = btn('Đơn website cần giao', 'bag', action.web); web.append(el('span','','Đơn website'));
  sources.append(el('strong','','Đơn giao tại quầy'), web); const formHost = el('div','pos-ref-delivery-form');
  right.querySelector('.pos-checkout-scroll').append(sources, formHost);
  const carrierBody = el('div','pos-ref-carrier-body'), carrierFooter = el('div','pos-ref-carrier-footer'); carrier.append(carrierTitle,carrierNote,carrierBody,carrierFooter); page.querySelector('.pos-layout').append(carrier);
  const compact = el('div','pos-ref-cart-total'); left.append(compact);
  const cartSummary=el('div','pos-ref-delivery-totals'),due=right.querySelector('.pos-pc-due');left.append(cartSummary);
  const restoreTotals=()=>{const scroll=right.querySelector('.pos-checkout-scroll');scroll.insertBefore(nodes.totals,nodes.methods);scroll.insertBefore(due,nodes.methods);};
  function setMode(id) {
    if (workspace.mode !== id && !onMode(id)) return;
    workspace.mode = id; page.classList.remove('pos-mode-scan','pos-mode-grid','pos-mode-delivery','pos-reference-checkout'); page.classList.add('pos-mode-'+id);
    for (const b of modeButtons) b.setAttribute('aria-pressed',String(b.dataset.posMode===id));
    if (id==='grid') right.querySelector('.pos-checkout-scroll').append(products); else left.append(products);
    if(id==='delivery')cartSummary.append(nodes.totals,due);else restoreTotals();
    if (id==='delivery') onDelivery({formHost, carrierBody, carrierFooter});
    nodes.grid.hidden = id !== 'grid' && !nodes.search.value.trim();
  }
  setMode(workspace.mode);
  return {
    setMode, products, formHost, carrierBody, carrierFooter,
    openCheckout(){page.classList.add('pos-reference-checkout');nodes.modalPay?.focus();},
    update({quantity,total,valid}) { compact.textContent = 'Tổng tiền hàng   '+quantity+'   '+total; normalPay.disabled=!valid; },
  };
}

export function decorateReferenceLine(row, {unit}) {
  const doc = row.ownerDocument, name = row.querySelector('.pos-line-name');
  const tag = doc.createElement('span'); tag.className='pos-ref-unit';tag.textContent=unit || '';row.append(tag);
  const remove = row.querySelector('.pos-line-top>button'); if (remove) remove.replaceChildren(referenceIcon(doc,'trash'));
  const more = doc.createElement('details'); more.className='pos-ref-line-more';
  const summary = doc.createElement('summary');summary.textContent='⋮';summary.setAttribute('aria-label','Thao tác dòng '+name.textContent);more.append(summary);
  const detail = doc.createElement('div');detail.className='pos-ref-line-popover';
  const discount=row.querySelector('.pos-line-discount'),caption=doc.createElement('span');caption.className='pos-ref-discount-label';caption.textContent='CK';discount.prepend(caption);row.append(discount);
  const drop=doc.createElement('button');drop.type='button';drop.className='btn ghost';drop.textContent='Xóa dòng sản phẩm';drop.addEventListener('click',()=>remove?.click());detail.append(drop);
  more.append(detail);row.append(more);
}

/** Same two-step COD form, mounted in the delivery columns rather than a dialog. */
export function inlineCodSurface(doc, formHost, carrierBody, footerHost) {
  formHost.replaceChildren(); carrierBody.replaceChildren(); footerHost.replaceChildren();
  const form=doc.createElement('form');form.id='pos-inline-cod-'+crypto.randomUUID();form.className='pos-inline-cod';
  const body=doc.createElement('div');form.append(body);formHost.append(form);formHost.classList.add('pos-inline-cod');footerHost.classList.add('pos-inline-cod');
  const all=()=>[...formHost.querySelectorAll('button,input,select,textarea'),...footerHost.querySelectorAll('button,input,select,textarea')];
  const close=()=>{formHost.replaceChildren();carrierBody.replaceChildren();footerHost.replaceChildren();};
  return {dlg:formHost,body,form,show(){},close,lock(on,primary,label){
    on?formHost.dataset.busy='1':delete formHost.dataset.busy;
    for(const x of all()){if(on){x.dataset.wasDisabled=x.disabled?'1':'';x.disabled=true;}else if('wasDisabled'in x.dataset){x.disabled=x.dataset.wasDisabled==='1';delete x.dataset.wasDisabled;}}
    if(primary){if(on){primary.dataset.label=primary.textContent;primary.textContent=label;}else if(primary.dataset.label!=null){primary.textContent=primary.dataset.label;delete primary.dataset.label;}}
  }};
}
