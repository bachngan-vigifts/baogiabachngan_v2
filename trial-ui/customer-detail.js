// Trang chi tiết khách hàng (#/customers/<id>): một lượt gọi GET /customers/:id/overview rồi vẽ theo từng mục.
// Cấu trúc: HEAD (tên + thao tác) → STATS (doanh số, công nợ…) → HỒ SƠ (thông tin · phụ trách / chia sẻ · người liên hệ) → TABS.
// Thêm một mục mới = thêm một phần tử vào TABS (key, nhãn, đếm số, hàm vẽ) – không phải sửa chỗ khác.
import { careResult, careSummary, careType, followUpCell } from './care.js';

/**
 * @param deps { api, toast, esc, money, fmtDate, pill, payCell, confirmBox, go, isManager, onDiscount,
 *               ORDER_STATUS, CONTRACT_STATUS, DELIVERY_STATUS, onEdit(customer), onQuote(customer), onAccounts(customer),
 *               onCare(customer, activity | null, onSaved) – ghi / sửa lần chăm sóc (trial-ui/care.js) }
 */
const BRANDS = [['minhLong', 'Minh Long'], ['lys', 'Lys'], ['lock', 'Lock']];
const fmtPct = n => Number(n).toLocaleString('vi-VN', { maximumFractionDigits: 2 });

export function initCustomerDetail(deps) {
  const { api, toast, esc, money, fmtDate, pill, payCell, confirmBox, ORDER_STATUS, CONTRACT_STATUS, DELIVERY_STATUS } = deps;
  const root = document.getElementById('customer-detail');
  const st = { id: '', d: null, tab: globalThis.matchMedia?.('(max-width: 850px)')?.matches ? 'overview' : 'orders', people: null, seq: 0 };
  const q = s => root.querySelector(s);
  const QUOTE_STATUS = { draft: ['Nháp', 'off'], pending: ['Chờ duyệt', 'warn'], approved: ['Đã duyệt', 'ok'] };
  const STOCK_STATUS = { open: ['Chờ trả lời', 'warn'], answered: ['Đã trả lời', 'ok'] };
  const METHOD = { transfer: 'Chuyển khoản', cash: 'Tiền mặt', other: 'Khác' };
  const ENTITY = { BN: 'Bách Ngân', VG: 'Vigifts', QTV: 'QTV' };
  const orderLink = (id, text) => `<a href="#/orders/${encodeURIComponent(id)}">${esc(text)}</a>`;
  // Đơn hàng và HĐKT là 2 luồng độc lập: bản ghi có HĐKT hiện "HĐKT <số>" và mở #/contracts/<id>.
  const docHref = (id, contractNo) => `#/${contractNo ? 'contracts' : 'orders'}/${encodeURIComponent(id)}`;
  const docLink = (id, orderNo, contractNo) => `<a href="${docHref(id, contractNo)}">${esc(contractNo ? 'HĐKT ' + contractNo : orderNo)}</a>`;
  const plainOrders = d => d.orders.filter(o => !o.contract);
  const when = iso => iso ? new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(iso)) : '';
  const DISCOUNT_LABELS = { minhLong: 'Minh Long', lys: 'Minh Long - Lys', lock: 'Lock&Lock' };
  const discountText = ds => Object.keys(DISCOUNT_LABELS).filter(k => ds?.[k]).map(k => `${DISCOUNT_LABELS[k]} <b>${ds[k]}%</b>`).join('<br>') || '<span class="muted">Chưa đặt</span>';
  const table = (head, rows, empty) => rows.length
    ? `<div class="table-wrap"><table class="data-table"><thead><tr>${head.map(h => `<th${h.startsWith('>') ? ' class="right"' : ''}>${esc(h.replace(/^>/, ''))}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`
    : `<p class="muted cd-empty">${esc(empty)}</p>`;

  // ----- Các mục (tab). Mỗi mục: nhãn, số đếm, nội dung.
  const TABS = [
    { key: 'orders', label: 'Đơn hàng', count: d => plainOrders(d).length, html: d => table(['Đơn', 'Tình trạng', 'Phụ trách', '>Giá trị', 'Thanh toán'], plainOrders(d).map(o => `<tr class="clickable" data-href="#/orders/${esc(o.id)}">
        <td>${orderLink(o.id, o.orderNo)}<small>${fmtDate(o.orderDate)}${o.quoteNo ? ' · ' + esc(o.quoteNo) : ''}</small></td>
        <td>${pill(ORDER_STATUS, (o.status === 'draft' && o.submittedAt === null ? 'unsubmitted' : o.status))}${o.expectedDeliveryDate ? `<small>Giao dự kiến ${fmtDate(o.expectedDeliveryDate)}</small>` : ''}</td>
        <td>${esc(o.ownerName)}</td><td class="right num">${money(o.total)}</td><td>${payCell(o.receivable, o.counted, o.status)}</td></tr>`), 'Chưa có đơn đặt hàng.') },
    { key: 'quotes', label: 'Báo giá', count: d => d.quotes.length, html: d => table(['Báo giá', 'Duyệt', 'Phụ trách', '>Giá trị', 'Đơn hàng / HĐKT'], d.quotes.map(x => `<tr class="clickable" data-href="#/quotes/${esc(x.id)}">
        <td><a href="#/quotes/${encodeURIComponent(x.id)}">${esc(x.quoteNo)}</a><small>${esc(x.quoteType)} · ${fmtDate(x.quoteDate || x.updatedAt)}</small></td>
        <td>${pill(QUOTE_STATUS, x.approvalStatus)}</td><td>${esc(x.assigneeName)}</td><td class="right num">${money(x.total)}</td>
        <td>${x.orderId ? `<a href="${docHref(x.orderId, x.contractNo)}">${x.contractNo ? 'Xem HĐKT' : 'Xem đơn'}</a>` : '<span class="muted">Chưa đặt</span>'}</td></tr>`), 'Chưa có báo giá cho khách này.') },
    { key: 'contracts', label: 'HĐKT', count: d => d.contracts.length, html: d => table(['Số HĐKT', 'Pháp nhân', 'Tình trạng', 'Ngày ký', '>Giá trị'], d.contracts.map(k => `<tr class="clickable" data-href="#/contracts/${esc(k.orderId)}">
        <td><a href="#/contracts/${encodeURIComponent(k.orderId)}">${esc(k.contractNo)}</a></td><td>${esc(ENTITY[k.legalEntity] || k.legalEntity)}</td><td>${pill(CONTRACT_STATUS, k.status)}</td><td>${fmtDate(k.signedDate) || '—'}</td>
        <td class="right num">${money(k.value)}</td></tr>`), 'Chưa có hợp đồng kinh tế.') },
    { key: 'payments', label: 'Phiếu thu', count: d => d.payments.length, html: d => table(['Ngày thu', 'Hình thức', 'Đơn / HĐKT', 'Ghi chú', '>Số tiền'], d.payments.map(p => `<tr>
        <td>${fmtDate(p.paidAt)}</td><td>${esc(METHOD[p.method] || p.method)}</td><td>${docLink(p.orderId, p.orderNo, p.contractNo)}</td>
        <td>${esc(p.reference || p.note) || '<span class="muted">—</span>'}</td><td class="right num paid-text">${money(p.amount)}</td></tr>`), 'Chưa có phiếu thu nào.') },
    { key: 'debts', label: 'Công nợ', count: d => d.orders.filter(o => o.receivable && o.receivable.balance > 0).length, html: d => {
        const rows = d.orders.filter(o => o.receivable && o.receivable.balance > 0);
        return table(['Đơn / HĐKT', 'Hạn gần nhất', '>Phải thu', '>Đã thu', '>Còn lại', '>Quá hạn'], rows.map(o => `<tr class="clickable" data-href="${docHref(o.id, o.contract?.contractNo)}">
          <td>${docLink(o.id, o.orderNo, o.contract?.contractNo)}<small>${fmtDate(o.orderDate)}</small></td><td>${fmtDate(o.receivable.nextDueDate) || '—'}</td>
          <td class="right num">${money(o.receivable.due)}</td><td class="right num paid-text">${money(o.receivable.paid)}</td>
          <td class="right num strong">${money(o.receivable.balance)}</td><td class="right num ${o.receivable.overdue ? 'danger-text' : 'muted'}">${o.receivable.overdue ? money(o.receivable.overdue) : '—'}</td></tr>`), 'Khách không còn công nợ.');
      } },
    { key: 'purchases', label: 'Lịch sử mua', count: d => d.purchases.length, html: d => table(['Sản phẩm', '>Số lượng', '>Số đơn', 'Mua gần nhất', '>Đơn giá gần nhất', '>Tổng tiền'], d.purchases.map(p => `<tr>
        <td><span class="strong">${esc(p.name)}</span>${p.sku ? `<small>${esc(p.sku)}</small>` : ''}</td><td class="right num">${p.qty.toLocaleString('vi-VN')} ${esc(p.unit)}</td>
        <td class="right num">${p.orders}</td><td>${fmtDate(p.lastDate)}</td><td class="right num">${money(p.lastPrice)}</td><td class="right num">${money(p.amount)}</td></tr>`), 'Chưa mua hàng (chỉ tính đơn đã xác nhận).') },
    { key: 'deliveries', label: 'Giao hàng', count: d => d.deliveries.length, html: d => table(['Chuyến giao', 'Ngày giao', 'Tình trạng', 'Đơn / HĐKT'], d.deliveries.map(x => `<tr class="clickable" data-href="${docHref(x.orderId, x.contractNo)}">
        <td>${esc(x.deliveryNo)}</td><td>${fmtDate(x.plannedDate)}${x.timeSlot ? `<small>${esc(x.timeSlot)}</small>` : ''}</td><td>${pill(DELIVERY_STATUS, x.status)}</td><td>${docLink(x.orderId, x.orderNo, x.contractNo)}</td></tr>`), 'Chưa có chuyến giao.') },
    { key: 'stock', label: 'Hỏi tồn', count: d => d.stockRequests.length, html: d => table(['Ngày gửi', 'Số mã', 'Tình trạng', 'Ghi chú'], d.stockRequests.map(r => `<tr class="clickable" data-href="#/stock-requests/${esc(r.id)}">
        <td>${fmtDate(r.createdAt)}</td><td>${r.items}</td><td>${pill(STOCK_STATUS, r.status)}</td><td>${esc(r.note) || '<span class="muted">—</span>'}</td></tr>`), 'Khách chưa gửi đơn check tồn.') },
    { key: 'care', label: 'Giao dịch & chăm sóc', count: d => d.care.length, html: d => `<div class="row-gap"><button type="button" class="btn primary small" data-act="care-new">＋ Ghi giao dịch</button>
      <a class="btn ghost small" href="#/care">Mở trang Giao dịch & chăm sóc</a></div>
      ${table(['Thời gian', 'Hình thức', 'Nội dung', 'Kết quả', 'Hẹn tiếp', 'Người ghi', ''], d.care.map(a => `<tr><td>${esc(when(a.occurredAt))}</td><td>${careType(a)}</td>
        <td class="care-text">${careSummary(a)}</td><td>${careResult(a)}</td><td>${followUpCell(a)}</td><td>${esc(a.ownerName)}</td>
        <td>${a.canEdit ? `<button type="button" class="btn ghost small" data-act="care-edit" data-care="${esc(a.id)}">Sửa</button>` : ''}</td></tr>`),
        deps.isManager() ? 'Chưa có lần chăm sóc nào với khách này.' : 'Bạn chưa ghi lần chăm sóc nào với khách này.')}` },
    { key: 'accounts', label: 'Tài khoản', count: d => d.accounts.length, html: d => `${table(['Tên', 'Đăng nhập', 'Chiết khấu riêng', 'Trạng thái', ''], d.accounts.map(a => `<tr><td>${esc(a.name)}</td>
      <td>${[a.email, a.phone].filter(Boolean).map(esc).join('<br>') || '—'}</td>
      <td>${discountText(a.discounts)}</td>
      <td>${a.active ? '<span class="pill ok">Đang hoạt động</span>' : '<span class="pill off">Đã khoá</span>'}</td>
      <td>${deps.isManager() ? `<button type="button" class="btn ghost small" data-act="discount" data-member="${esc(a.memberId)}">Sửa CK</button>` : ''}</td></tr>`), 'Chưa có tài khoản trang khách hàng.')}
      ${d.accounts.length && !deps.isManager() ? '<p class="muted">Chiết khấu riêng do Manager đặt.</p>' : ''}
      <button type="button" class="btn secondary small" data-act="accounts">Quản lý tài khoản</button>` },
  ];

  // ----- Vẽ
  function render() {
    const d = st.d, c = d.customer, s = d.stats, a = d.access, pending = c.approvalStatus === 'pending', rejected = c.approvalStatus === 'rejected', blocked = pending || rejected;
    const representative = d.contacts.find(x => x.id === c.representativeContactId);
    const contacts = d.contacts.map(x => `<li class="cd-contact"><span><b>${esc(x.name)}</b>${x.isPrimary ? ' <span class="pill blue">Liên hệ chính</span>' : ''}${x.id === c.representativeContactId ? ' <span class="pill ok">Người đại diện</span>' : ''}
        <small>${esc([x.title, x.phone, x.email].filter(Boolean).join(' · ')) || '—'}</small>${x.note ? `<small class="muted">${esc(x.note)}</small>` : ''}</span>
        ${a.canEdit ? `<span class="row-actions"><button type="button" class="btn ghost small" data-contact-rep="${esc(x.id)}">${x.id === c.representativeContactId ? 'Bỏ đại diện' : 'Đặt làm đại diện'}</button><button class="icon-btn" data-contact-edit="${esc(x.id)}" aria-label="Sửa ${esc(x.name)}" title="Sửa"><svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16z M14 6l4 4"/></svg></button>
        <button class="icon-btn" data-contact-del="${esc(x.id)}" aria-label="Xoá ${esc(x.name)}" title="Xoá"><svg viewBox="0 0 24 24"><path d="M5 7h14 M10 11v6 M14 11v6 M6 7l1 13h10l1-13 M9 7V4h6v3"/></svg></button></span>` : ''}</li>`).join('');
    const tabs=[{key:'overview',label:'Tổng quan',count:()=>null,html:()=>''},...TABS];
    const tab = tabs.find(t => t.key === st.tab) || tabs[0];
    root.dataset.detailTab=tab.key;
    root.innerHTML = `
      <div class="editor-head">
        <div class="editor-title"><a class="btn ghost small" href="#/customers">‹ Khách hàng</a><h1>${esc(c.name)}</h1>
          <span class="pill ${c.fromSapo ? 'blue' : 'off'}">${c.fromSapo ? 'Sapo' : 'Tạo trên web'}</span>${pending ? '<span class="pill warn">Chờ duyệt</span>' : rejected ? '<span class="pill danger">Bị từ chối</span>' : ''}</div>
        <div class="editor-actions">${a.canEdit ? '<button class="btn secondary" data-act="edit" title="Chỉ nhân viên phụ trách hoặc Manager">Sửa thông tin</button>' : ''}${blocked ? '' : '<button class="btn primary" data-act="quote">＋ Báo giá</button>'}</div>
      </div>
      <section class="crm-customer-hero"><div class="crm-customer-person"><span class="avatar">${esc((c.contact||c.name).split(/\s+/).filter(Boolean).slice(-2).map(s=>s[0]).join(''))}</span><div><strong>${esc(c.contact||c.name)}</strong><small>${esc(c.name)}${c.customerCode?' · '+esc(c.customerCode):''}</small>${d.owner?`<span class="pill blue">Phụ trách: ${esc(d.owner.name)}</span>`:''}</div></div>
        <div class="crm-customer-quick" data-mobile-actions="off">${c.phone?`<a class="btn secondary" href="tel:${esc(c.phone.replace(/[^\d+]/g,''))}">Gọi</a>`:''}${deps.onCare&&!blocked?'<button type="button" class="btn secondary" data-act="care-new">Chăm sóc</button>':''}${blocked?'':'<button type="button" class="btn primary" data-act="quote">Báo giá</button>'}</div></section>
      ${pending ? `<div class="approval-box"><div class="approval-head"><b>Khách hàng mới đang chờ Manager duyệt</b><small class="muted">Chưa lập báo giá, đặt hàng hay cấp tài khoản cho khách này được tới khi được duyệt.</small></div>
        <div class="row-actions">${(deps.canApprove || deps.isManager)() ? '<button type="button" class="btn primary small" data-act="approve">Duyệt khách hàng</button>' : ''}
        <button type="button" class="btn ghost small danger-text" data-act="reject">${(deps.canApprove || deps.isManager)() ? 'Từ chối' : 'Xoá'}</button></div></div>` : ''}
      ${rejected ? `<div class="approval-box"><div class="approval-head"><b>Khách hàng đã bị từ chối duyệt</b>
        <small>Lý do: <span class="cd-reject-reason">${esc(c.rejectReason || '—')}</span></small>
        <small class="muted">${c.rejectedByName ? esc(c.rejectedByName) : 'Người duyệt'}${c.rejectedAt ? ' · ' + esc(when(c.rejectedAt)) : ''} · Chưa lập báo giá, đặt hàng hay cấp tài khoản được tới khi được duyệt lại.</small></div>
        <div class="row-actions">${(deps.canApprove || deps.isManager)() ? '<button type="button" class="btn primary small" data-act="approve">Duyệt lại</button>' : ''}
        ${(deps.canApprove || deps.isManager)() || c.createdBy === deps.userId?.() ? '<button type="button" class="btn secondary small" data-act="resubmit">Gửi duyệt lại</button>' : ''}</div></div>` : ''}
      <div class="stats cd-stats">
        <article class="stat"><small>Doanh số</small><strong>${money(s.revenue)}</strong><span class="muted">${s.orders} đơn hàng / HĐKT đã xác nhận</span></article>
        <article class="stat"><small>Đã thu</small><strong class="paid-text">${money(s.paid)}</strong><span class="muted">Phải thu ${money(s.due)}</span></article>
        <article class="stat"><small>Còn nợ</small><strong class="${s.balance > 0 ? 'danger-text' : ''}">${money(s.balance)}</strong><span class="${s.overdue ? 'danger-text' : 'muted'}">${s.overdue ? 'Quá hạn ' + money(s.overdue) : 'Không quá hạn'}</span></article>
        <article class="stat"><small>Mua gần nhất</small><strong>${s.lastOrderDate ? fmtDate(s.lastOrderDate) : '—'}</strong><span class="muted">${s.quotes} báo giá · ${s.contracts} HĐKT</span></article>
      </div>
      <div class="cd-grid">
        <div class="card"><h2 class="card-title">Thông tin</h2><dl class="kv">
          <dt>Ngày thành lập</dt><dd>${c.establishedDate ? esc(c.establishedDate.split('-').reverse().join('/')) : 'Chưa cập nhật'}</dd>
          ${c.anniversary ? `<dt>Kỷ niệm tiếp theo</dt><dd><b>${c.anniversary.years} năm · ${esc(c.anniversary.date.split('-').reverse().join('/'))}</b><small>${c.anniversary.daysUntil === 0 ? 'Hôm nay' : 'Còn '+c.anniversary.daysUntil+' ngày'}${c.anniversary.upcoming ? ' · '+esc(c.anniversary.suggestion) : ''}</small></dd>` : ''}
          <dt>Mã KH</dt><dd>${esc(c.customerCode) || '—'}</dd><dt>MST</dt><dd>${esc(c.taxCode) || '—'}</dd>
          <dt>Nhóm / loại khách</dt><dd>${esc(c.customerType) || 'Chưa cập nhật'}</dd>
          <dt>Điều khoản</dt><dd>Cọc ${c.depositRate ?? 30}% · thanh toán ${/^\d+$/.test(String(c.paymentTerm ?? '5')) ? (c.paymentTerm ?? '5') + ' ngày' : esc(c.paymentTerm)}${c.depositRate == null && !c.paymentTerm ? ' <small class="muted">(mặc định)</small>' : ''}</dd>
          <dt>Số ngày công nợ</dt><dd>${c.paymentDays != null ? c.paymentDays + ' ngày' : '<span class="muted">Chưa đặt</span>'}</dd>
          <dt>Giới hạn công nợ</dt><dd>${c.creditLimit != null ? money(c.creditLimit) : '—'}</dd>
          <dt>Người đại diện</dt><dd>${representative ? `<b>${esc(representative.name)}</b>${representative.title ? ' <small class="muted">' + esc(representative.title) + '</small>' : ''}` : '<span class="muted">Chưa chọn</span>'}</dd>
          <dt>Liên hệ</dt><dd>${esc(c.contact) || '—'}</dd>
          <dt>Điện thoại</dt><dd>${c.phone ? `<a href="tel:${esc(c.phone.replace(/[^\d+]/g, ''))}">${esc(c.phone)}</a>` : '—'}</dd>
          <dt>Email</dt><dd>${c.email ? `<a href="mailto:${esc(c.email)}">${esc(c.email)}</a>` : '—'}</dd>
          <dt>Địa chỉ</dt><dd>${esc(c.address) || '—'}</dd>
          ${s.firstOrderDate ? `<dt>Khách từ</dt><dd>${fmtDate(s.firstOrderDate)}</dd>` : ''}
        </dl></div>
        <div class="card"><div class="card-title-row"><h2 class="card-title">Nhân viên</h2>${a.canManageStaff ? '<button class="btn secondary small" data-act="staff">Phân công / chia sẻ</button>' : ''}</div>
          <dl class="kv"><dt>Phụ trách</dt><dd>${d.owner ? `<span class="cd-person">${esc(d.owner.name)}</span>` : '<span class="muted">Chưa phân công</span>'}</dd>
          <dt>Được chia sẻ</dt><dd>${d.shared.length ? d.shared.map(p => `<span class="cd-person shared">${esc(p.name)}</span>`).join(' ') : '<span class="muted">Chưa chia sẻ</span>'}</dd></dl>
          ${a.canSeeAll ? '' : '<p class="muted small">Bạn không phụ trách khách này: chỉ thấy báo giá / đơn do bạn phụ trách hoặc tạo.</p>'}
        </div>
        <div class="card"><div class="card-title-row"><h2 class="card-title">Chiết khấu theo thương hiệu (%)</h2>${a.canEdit ? '<button class="btn secondary small" data-act="brand-discounts">Sửa</button>' : ''}</div>
          <dl class="kv cd-discounts">${BRANDS.map(([k, label]) => `<dt>CK ${label}</dt><dd>${d.discounts?.[k] === null || d.discounts?.[k] === undefined ? '<span class="muted">Chưa thiết lập</span>' : `<b>${fmtPct(d.discounts[k])}%</b>`}</dd>`).join('')}</dl>
          <p class="muted small">Áp dụng khi thêm sản phẩm vào báo giá. Có thể sửa CK trên từng dòng.</p></div>
        <div class="card"><div class="card-title-row"><h2 class="card-title">Người liên hệ <small class="muted">(${d.contacts.length})</small></h2>${a.canEdit ? '<button class="btn secondary small" data-act="contact">＋ Thêm</button>' : ''}</div>
          ${contacts ? `<ul class="plain-list cd-contacts">${contacts}</ul>` : '<p class="muted cd-empty">Chưa có người liên hệ bổ sung (kế toán, mua hàng, người nhận hàng…).</p>'}</div>
      </div>
      <div class="card cd-tabs-card">
        <div class="chips cd-tabs" role="tablist">${tabs.map(t => `<button type="button" class="chip ${t.key === tab.key ? 'active' : ''}" role="tab" aria-selected="${t.key === tab.key}" data-tab="${t.key}">${t.label}${t.count(d)!=null?` <b>${t.count(d)}</b>`:''}</button>`).join('')}</div>
        <div class="cd-tab-body">${tab.html(d)}</div>
      </div>`;
    renderGeneralNote(); renderDebtNote();
    // Bảng thành thẻ trên điện thoại: mỗi ô kèm nhãn cột.
    root.querySelectorAll('.cd-tab-body table').forEach(t => {
      const heads = [...t.querySelectorAll('thead th')].map(th => th.textContent);
      t.querySelectorAll('tbody tr').forEach(tr => [...tr.children].forEach((td, i) => { if (i && heads[i]) td.dataset.label = heads[i]; }));
    });
  }

  // Ghi chú nội bộ dựng bằng DOM/textContent, giữ nguyên xuống dòng và không diễn giải HTML.
  function renderGeneralNote() {
    const note = st.d.generalNote;
    if (!note) return;
    const make = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
    const card = make('section', 'card'), header = make('div', 'card-title-row');
    header.append(make('h2', 'card-title', 'Ghi chú chung về khách hàng'));
    const content = make('p', note.text ? '' : 'muted', note.text || 'Chưa có ghi chú chung.');
    content.style.whiteSpace = 'pre-wrap'; content.style.overflowWrap = 'anywhere';
    card.append(header, content);
    if (note.updatedAt) card.append(make('small', 'muted', `Cập nhật ${when(note.updatedAt)}${note.updatedBy ? ' · ' + note.updatedBy : ''}`));
    if (st.d.access.canEdit) {
      const edit = make('button', 'btn secondary small', note.text ? 'Sửa ghi chú' : 'Thêm ghi chú'); edit.type = 'button'; header.append(edit);
      edit.addEventListener('click', () => {
        const customerId = st.d.customer.id, seq = st.seq;
        const dlg = make('dialog', 'modal'), form = make('form'), head = make('div', 'modal-head');
        head.append(make('h2', '', 'Ghi chú chung về khách hàng'));
        const body = make('div', 'modal-body'), label = make('label', '', 'Nội dung ghi chú (tối đa 5.000 ký tự)');
        const text = make('textarea'); text.rows = 7; text.maxLength = 5000; text.value = note.text; label.append(text);
        const error = make('p', 'error'); error.setAttribute('role', 'alert');
        body.append(label, error);
        const footer = make('div', 'modal-foot'), cancel = make('button', 'btn secondary', 'Huỷ'), save = make('button', 'btn primary', 'Lưu ghi chú');
        cancel.type = 'button'; save.type = 'submit'; cancel.addEventListener('click', () => dlg.close());
        footer.append(cancel, save); form.append(head, body, footer); dlg.append(form);
        dlg.addEventListener('close', () => dlg.remove());
        form.addEventListener('submit', async e => {
          e.preventDefault(); if (save.disabled) return;
          save.disabled = true; error.textContent = '';
          try {
            const saved = await api(`/customers/${encodeURIComponent(customerId)}/notes`, 'PUT', { text: text.value, revision: note.revision });
            dlg.close(); toast('Đã lưu ghi chú khách hàng.');
            if (st.seq === seq && st.id === customerId) { st.d.generalNote = saved; render(); }
          } catch (ex) { error.textContent = ex.message || 'Không lưu được ghi chú.'; }
          finally { save.disabled = false; }
        });
        document.body.append(dlg); dlg.showModal(); text.focus();
      });
    }
    root.querySelector('.cd-tabs-card').before(card);
  }

  // Ghi chú công nợ cũ: chỉ có khi API trả `debtNote` (người xem được toàn bộ khách); dựng bằng DOM/textContent như ghi chú chung.
  function renderDebtNote() {
    const note = st.d.debtNote;
    if (!note) return;
    const make = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
    const card = make('section', 'card cd-debt-note'), header = make('div', 'card-title-row');
    header.append(make('h2', 'card-title', 'Ghi chú công nợ cũ'));
    const content = make('p', note.text ? '' : 'muted', note.text || 'Chưa có ghi chú công nợ cũ.');
    content.style.whiteSpace = 'pre-wrap'; content.style.overflowWrap = 'anywhere';
    card.append(header, content);
    if (note.updatedAt) card.append(make('small', 'muted', `Cập nhật ${when(note.updatedAt)}${note.updatedBy ? ' · ' + note.updatedBy : ''}`));
    if (st.d.access.canEdit) {
      const edit = make('button', 'btn secondary small', note.text ? 'Sửa ghi chú' : 'Thêm ghi chú'); edit.type = 'button'; header.append(edit);
      edit.addEventListener('click', () => {
        const customerId = st.d.customer.id, seq = st.seq;
        const dlg = make('dialog', 'modal'), form = make('form'), head = make('div', 'modal-head');
        head.append(make('h2', '', 'Ghi chú công nợ cũ'));
        const body = make('div', 'modal-body'), label = make('label', '', 'Nội dung (tối đa 2.000 ký tự)');
        const text = make('textarea'); text.rows = 6; text.maxLength = 2000; text.value = note.text; label.append(text);
        const error = make('p', 'error'); error.setAttribute('role', 'alert');
        body.append(label, error);
        const footer = make('div', 'modal-foot'), cancel = make('button', 'btn secondary', 'Huỷ'), save = make('button', 'btn primary', 'Lưu ghi chú');
        cancel.type = 'button'; save.type = 'submit'; cancel.addEventListener('click', () => dlg.close());
        footer.append(cancel, save); form.append(head, body, footer); dlg.append(form);
        dlg.addEventListener('close', () => dlg.remove());
        form.addEventListener('submit', async e => {
          e.preventDefault(); if (save.disabled) return;
          save.disabled = true; error.textContent = '';
          try {
            const saved = await api(`/customers/${encodeURIComponent(customerId)}/debt-note`, 'PUT', { text: text.value, revision: note.revision });
            dlg.close(); toast('Đã lưu ghi chú công nợ cũ.');
            if (st.seq === seq && st.id === customerId) { st.d.debtNote = saved; render(); }
          } catch (ex) { error.textContent = ex.message || 'Không lưu được ghi chú.'; }
          finally { save.disabled = false; }
        });
        document.body.append(dlg); dlg.showModal(); text.focus();
      });
    }
    root.querySelector('.cd-tabs-card').before(card);
  }

  async function open(id) {
    const seq = ++st.seq; st.id = id;
    if (st.d?.customer.id !== id) { st.d = null; root.innerHTML = '<p class="muted cd-loading">Đang tải thông tin khách hàng…</p>'; }
    try {
      const d = await api('/customers/' + encodeURIComponent(id) + '/overview');
      if (seq !== st.seq) return;
      st.d = d; render();
      document.getElementById('breadcrumb').textContent = d.customer.name; document.title = d.customer.name + ' · Bách Ngân';
    } catch (e) { if (seq === st.seq) root.innerHTML = `<div class="empty"><h3>Không mở được khách hàng</h3><p class="muted">${esc(e.message)}</p><a class="btn secondary" href="#/customers">‹ Về danh sách</a></div>`; }
  }
  const reload = () => open(st.id);

  // ----- Hộp thoại người liên hệ / phân công
  function dialog(title, body, okText) {
    const dlg = document.createElement('dialog'); dlg.className = 'modal';
    dlg.innerHTML = `<form method="dialog" novalidate><div class="modal-head"><h2>${esc(title)}</h2><button type="button" class="icon-btn" data-x aria-label="Đóng">×</button></div>
      <div class="modal-body">${body}<p class="error" data-err role="alert"></p></div>
      <div class="modal-foot"><button type="button" class="btn secondary" data-x>Huỷ</button><button class="btn primary">${esc(okText)}</button></div></form>`;
    document.body.append(dlg); dlg.showModal();
    dlg.querySelectorAll('[data-x]').forEach(b => b.addEventListener('click', () => dlg.close()));
    dlg.addEventListener('close', () => dlg.remove());
    return dlg;
  }
  /** Sửa chiết khấu theo thương hiệu (%): ô trống = chưa thiết lập. */
  function discountDialog() {
    const cur = st.d.discounts || {};
    const dlg = dialog('Chiết khấu theo thương hiệu (%)', `<div class="form-grid cols-3">${BRANDS.map(([k, label]) =>
      `<label>CK ${label}<input name="${k}" inputmode="decimal" maxlength="6" placeholder="Chưa thiết lập" value="${cur[k] === null || cur[k] === undefined ? '' : esc(fmtPct(cur[k]))}"></label>`).join('')}</div>
      <p class="muted small">Áp dụng khi thêm sản phẩm vào báo giá. Có thể sửa CK trên từng dòng.</p>`, 'Lưu');
    dlg.querySelector('form').addEventListener('submit', async e => {
      e.preventDefault();
      const f = e.target.elements, body = {};
      for (const [k, label] of BRANDS) {
        const t = f[k].value.trim().replace(',', '.');
        if (t === '') { body[k] = null; continue; }
        const n = Number(t);
        if (!Number.isFinite(n) || n < 0 || n > 100) { dlg.querySelector('[data-err]').textContent = `CK ${label} phải từ 0 đến 100%.`; return; }
        body[k] = n;
      }
      try { await api(`/customers/${encodeURIComponent(st.id)}/discounts`, 'PUT', body); dlg.close(); toast('Đã lưu chiết khấu.'); reload(); }
      catch (ex) { dlg.querySelector('[data-err]').textContent = ex.message; }
    });
  }
  function contactDialog(x) {
    const v = k => esc(x?.[k] || '');
    const dlg = dialog(x ? 'Sửa người liên hệ' : 'Thêm người liên hệ', `<div class="form-grid cols-2">
      <label class="span-2">Họ tên<input name="name" required maxlength="500" value="${v('name')}"></label>
      <label>Chức vụ / bộ phận<input name="title" maxlength="120" value="${v('title')}" placeholder="Kế toán, Mua hàng…"></label>
      <label>Điện thoại<input name="phone" maxlength="40" inputmode="tel" value="${v('phone')}"></label>
      <label class="span-2">Email<input name="email" type="email" maxlength="500" value="${v('email')}"></label>
      <label class="span-2">Ghi chú<textarea name="note" rows="2" maxlength="1000">${v('note')}</textarea></label>
      <label class="span-2 check"><input type="checkbox" name="isPrimary" ${x?.isPrimary ? 'checked' : ''}> Liên hệ chính</label></div>`, x ? 'Lưu' : 'Thêm');
    dlg.querySelector('form').addEventListener('submit', async e => {
      e.preventDefault();
      const f = e.target.elements, body = { name: f.name.value.trim(), title: f.title.value.trim(), phone: f.phone.value.trim(), email: f.email.value.trim(), note: f.note.value.trim(), isPrimary: f.isPrimary.checked };
      if (!body.name) { dlg.querySelector('[data-err]').textContent = 'Nhập họ tên người liên hệ.'; return; }
      try {
        await api(`/customers/${encodeURIComponent(st.id)}/contacts${x ? '/' + encodeURIComponent(x.id) : ''}`, x ? 'PUT' : 'POST', body);
        dlg.close(); toast(x ? 'Đã cập nhật người liên hệ.' : 'Đã thêm người liên hệ.'); reload();
      } catch (ex) { dlg.querySelector('[data-err]').textContent = ex.message; }
    });
  }
  async function staffDialog() {
    const d = st.d, a = d.access;
    try { st.people ||= (await api('/tasks/people')).people; } catch (e) { toast(e.message, 'err'); return; }
    const people = st.people, shared = new Set(d.shared.map(p => p.id));
    const dlg = dialog('Phân công / chia sẻ khách hàng', `
      <label class="cd-field">Nhân viên phụ trách
        <select name="owner" ${a.canChangeOwner ? '' : 'disabled'}><option value="">— Chưa phân công —</option>
          ${people.map(p => `<option value="${esc(p.id)}" ${d.owner?.id === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label>
      ${a.canChangeOwner ? '' : '<p class="muted small">Chỉ Manager đổi được người phụ trách.</p>'}
      <p class="cd-field-label">Chia sẻ cho <small class="muted">(xem được mọi báo giá, đơn, HĐKT, công nợ của khách)</small></p>
      <input type="search" class="cd-people-search" placeholder="Tìm nhân viên…" aria-label="Tìm nhân viên">
      <ul class="cd-people">${people.map(p => `<li><label><input type="checkbox" value="${esc(p.id)}" ${shared.has(p.id) ? 'checked' : ''}> ${esc(p.name)}</label></li>`).join('')}</ul>`, 'Lưu');
    dlg.querySelector('.cd-people-search').addEventListener('input', e => { const f = e.target.value.toLowerCase(); dlg.querySelectorAll('.cd-people li').forEach(li => { li.hidden = !li.textContent.toLowerCase().includes(f); }); });
    dlg.querySelector('form').addEventListener('submit', async e => {
      e.preventDefault();
      const body = { sharedIds: [...dlg.querySelectorAll('.cd-people input:checked')].map(i => i.value) };
      if (a.canChangeOwner) body.ownerId = e.target.elements.owner.value || null;
      try { await api(`/customers/${encodeURIComponent(st.id)}/staff`, 'PUT', body); dlg.close(); toast('Đã cập nhật phân công.'); reload(); }
      catch (ex) { dlg.querySelector('[data-err]').textContent = ex.message; }
    });
  }

  // ----- Sự kiện
  root.addEventListener('click', async e => {
    const t = e.target;
    const tabBtn = t.closest('[data-tab]'); if (tabBtn) { st.tab = tabBtn.dataset.tab; render(); return; }
    const act = t.closest('[data-act]')?.dataset.act, c = st.d?.customer;
    if (act === 'edit') return deps.onEdit(c);
    if (act === 'brand-discounts') return discountDialog();
    if (act === 'quote') return deps.onQuote(c);
    if (act === 'approve' || act === 'reject') return deps.onReview(c.id, act === 'approve');
    if (act === 'resubmit') {
      try { await api(`/customers/${encodeURIComponent(c.id)}/resubmit`, 'POST', {}); toast('Đã gửi duyệt lại khách hàng.'); reload(); } catch (ex) { toast(ex.message, 'err'); }
      return;
    }
    if (act === 'accounts') return deps.onAccounts(c);
    if (act === 'care-new') return deps.onCare(c, null, reload);
    if (act === 'care-edit') { const a = st.d.care.find(x => x.id === t.closest('[data-care]').dataset.care); return deps.onCare(c, a && { ...a, customerName: c.name }, reload); }
    if (act === 'discount') return deps.onDiscount(st.d.accounts.find(a => a.memberId === t.closest('[data-member]').dataset.member), reload);
    if (act === 'contact') return contactDialog(null);
    if (act === 'staff') return staffDialog();
    const rep = t.closest('[data-contact-rep]');
    if (rep) {
      const id = rep.dataset.contactRep, next = c.representativeContactId === id ? null : id;
      try { await api(`/customers/${encodeURIComponent(c.id)}/representative`, 'PUT', { contactId: next }); toast(next ? 'Đã chọn người đại diện.' : 'Đã bỏ người đại diện.'); reload(); } catch (ex) { toast(ex.message, 'err'); }
      return;
    }
    const ed = t.closest('[data-contact-edit]'); if (ed) return contactDialog(st.d.contacts.find(x => x.id === ed.dataset.contactEdit));
    const del = t.closest('[data-contact-del]');
    if (del) {
      const x = st.d.contacts.find(y => y.id === del.dataset.contactDel);
      if (!await confirmBox(`Xoá người liên hệ "${x.name}"?`, { ok: 'Xoá', danger: true })) return;
      try { await api(`/customers/${encodeURIComponent(st.id)}/contacts/${encodeURIComponent(x.id)}`, 'DELETE'); toast('Đã xoá người liên hệ.'); reload(); } catch (ex) { toast(ex.message, 'err'); }
      return;
    }
    const row = t.closest('tr[data-href]'); if (row && !t.closest('a, button')) location.hash = row.dataset.href;
  });

  return { open, reload };
}
