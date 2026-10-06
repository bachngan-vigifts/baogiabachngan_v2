// Bách Ngân · Trang khách hàng: xem/tạo báo giá, đặt hàng, theo dõi đơn. Không có tồn kho, giá nhập.
// Tính tiền dùng đúng hàm của máy chủ (quote-math.js sinh từ src/modules/quotes/domain/quote-math.ts).
import { totals, after } from './quote-math.js';

const API = document.querySelector('meta[name="bn-api"]')?.content
  || 'https://taceqfnsorewelsbdckg.supabase.co/functions/v1/baogia-v2-api/api/staff';
const SESSION_KEY = 'bn-v2-session';

const $ = s => document.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const vnd = new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND', maximumFractionDigits: 0 });
const money = v => vnd.format(Math.round(Number(v) || 0));
const fmtNum = v => Number(v || 0).toLocaleString('vi-VN', { maximumFractionDigits: 3 });
const fmtDate = iso => iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '';
const FROM = 'àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ', TO = 'aaaaaaaaaaaaaaaaaeeeeeeeeeeeiiiiiooooooooooooooooouuuuuuuuuuuyyyyyd';
const fold = v => [...String(v ?? '').toLowerCase().normalize('NFC')].map(ch => { const i = FROM.indexOf(ch); return i >= 0 ? TO[i] : ch; }).join('').trim().replace(/\s+/g, ' ');

function toast(text, kind = 'ok') {
  const el = document.createElement('div'); el.className = 'toast ' + kind; el.textContent = text;
  $('#toasts').append(el); setTimeout(() => el.remove(), kind === 'err' ? 6000 : 3500);
}
$$('[data-close]').forEach(b => b.addEventListener('click', () => b.closest('dialog').close()));

// ----- API (cùng phiên đăng nhập với trang chính)
let token = '';
try { token = sessionStorage.getItem(SESSION_KEY) || ''; } catch { /* bỏ qua */ }
const toLogin = () => location.replace('index.html');
async function api(path, method = 'GET', body) {
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = 'Bearer ' + token;
  let res;
  try { res = await fetch(API + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }); }
  catch { throw Object.assign(new Error('Chưa kết nối được máy chủ. Vui lòng kiểm tra mạng rồi thử lại.'), { status: 0 }); }
  const data = await res.json().catch(() => ({ error: 'Máy chủ chưa sẵn sàng. Vui lòng thử lại.' }));
  if (res.status === 401) { toLogin(); throw new Error('Phiên đăng nhập đã hết hạn.'); }
  if (!res.ok) throw Object.assign(new Error(data.error || 'Không thực hiện được thao tác.'), { status: res.status, code: data.code });
  return data;
}

const ORDER_STATUS = { draft: ['Chờ xác nhận', 'warn'], confirmed: ['Đã xác nhận', 'blue'], delivering: ['Đang giao', 'warn'], delivered: ['Đã giao xong', 'ok'], cancelled: ['Đã huỷ', 'off'] };
const DELIVERY_STATUS = { planned: 'Đã lên lịch', in_transit: 'Đang giao', delivered: 'Đã giao', failed: 'Giao không thành công' };
const pill = (map, s) => `<span class="pill ${map[s]?.[1] || ''}">${esc(map[s]?.[0] || s)}</span>`;
const st = { me: null, items: [], cart: new Map(), catalogVersion: '' };

// ----- khởi động: chỉ tài khoản khách hàng
async function boot() {
  if (!token) return toLogin();
  const { user } = await api('/me');
  if (user.role !== 'customer') { location.replace('index.html'); return; }
  st.me = await api('/portal/me');
  $('#p-customer').textContent = st.me.customer.name; $('#p-user').textContent = `${st.me.user.name} · ${st.me.user.email}`;
  const o = st.me.owner, d = st.me.discounts || {}, ck = [['Minh Long', d.minhLong], ['Minh Long - Lys', d.lys], ['Lock&Lock', d.lock]].filter(([, v]) => v > 0);
  $('#p-owner').innerHTML = `<div><small class="muted">Nhân viên phụ trách</small><b>${esc(o?.name || '—')}</b>${o?.phone ? ` · <a href="tel:${esc(o.phone.replace(/[^\d+]/g, ''))}">${esc(o.phone)}</a>` : ''}${o?.email ? ` · ${esc(o.email)}` : ''}</div>`
    + (ck.length ? `<div><small class="muted">Chiết khấu riêng của quý khách</small><b>${ck.map(([k, v]) => `${k} ${fmtNum(v)}%`).join(' · ')}</b></div>` : '');
  document.title = st.me.customer.name + ' · Bách Ngân';
  $('#portal').hidden = false;
  showTab(location.hash.replace('#', '') || 'quotes');
}
$('#p-logout').addEventListener('click', async () => { try { await api('/logout', 'POST', {}); } catch { /* bỏ qua */ } try { sessionStorage.removeItem(SESSION_KEY); } catch { /* bỏ qua */ } toLogin(); });

function showTab(tab) {
  if (!['quotes', 'new', 'orders'].includes(tab)) tab = 'quotes';
  $$('[data-tab]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
  $$('[data-panel]').forEach(p => p.hidden = p.dataset.panel !== tab);
  history.replaceState(null, '', '#' + tab);
  if (tab === 'quotes') loadQuotes(); else if (tab === 'orders') loadOrders(); else loadCatalog();
}
$$('[data-tab]').forEach(b => b.addEventListener('click', () => showTab(b.dataset.tab)));
addEventListener('hashchange', () => { if (st.me) showTab(location.hash.replace('#', '')); });

// ----- Báo giá
async function loadQuotes() {
  const tbody = $('#p-quotes'); tbody.innerHTML = '<tr><td colspan="5" class="muted">Đang tải…</td></tr>';
  try {
    const { quotes } = await api('/portal/quotes');
    $('#p-quotes-empty').hidden = quotes.length > 0;
    tbody.innerHTML = quotes.map(q => `<tr class="clickable" data-quote="${esc(q.id)}">
      <td class="first"><span class="strong">${esc(q.quoteNo)}</span><small>${q.lineCount} sản phẩm${q.mine ? ' · quý khách gửi' : ''}</small></td>
      <td data-label="Ngày">${fmtDate(q.date) || '—'}</td><td class="right num">${money(q.total)}</td>
      <td data-label="Trạng thái">${q.approvalStatus === 'approved' ? '<span class="pill ok">Đã xác nhận</span>' : '<span class="pill warn">Chờ nhân viên xác nhận</span>'}</td>
      <td data-label="Đơn hàng">${q.order ? `${esc(q.order.orderNo)} ${pill(ORDER_STATUS, q.order.status)}` : q.approvalStatus === 'approved' ? '<span class="muted">Chưa đặt hàng</span>' : '—'}</td></tr>`).join('');
  } catch (e) { tbody.innerHTML = `<tr><td colspan="5" class="error">${esc(e.message)}</td></tr>`; }
}
let openQuoteId = '';
$('#p-quotes').addEventListener('click', async e => {
  const tr = e.target.closest('[data-quote]'); if (!tr) return;
  try {
    const q = await api('/portal/quotes/' + encodeURIComponent(tr.dataset.quote)); openQuoteId = q.id;
    const d = q.data, t = q.totals;
    $('#pq-title').textContent = q.quoteNo;
    $('#pq-body').innerHTML = `<p>${q.approvalStatus === 'approved' ? '<span class="pill ok">Đã xác nhận</span>' : '<span class="pill warn">Chờ nhân viên xác nhận</span>'} · Ngày ${fmtDate(d.date)}${d.deliveryDate ? ' · Giao dự kiến ' + fmtDate(d.deliveryDate) : ''}</p>
      <div class="table-wrap"><table class="data-table"><thead><tr><th>Sản phẩm</th><th class="right">SL</th><th class="right">Đơn giá</th><th class="right">Giá sau CK</th><th class="right">Thành tiền</th></tr></thead><tbody>
      ${d.rows.map(r => { const u = after(r, d); return `<tr><td>${esc(r.name)}<small>${esc([r.sku, r.unit].filter(Boolean).join(' · '))}</small></td><td class="right">${fmtNum(r.qty)}</td><td class="right num">${money(r.price)}</td><td class="right num">${money(u)}${Number(r.discount) > 0 ? `<small>CK ${r.discountType === 'amount' ? money(r.discount) : fmtNum(r.discount) + '%'}</small>` : ''}</td><td class="right num">${money(u * Number(r.qty || 0))}</td></tr>`; }).join('')}
      </tbody></table></div>
      <dl class="totals"><div><dt>Tạm tính</dt><dd>${money(t.subtotal)}</dd></div><div><dt>${esc(t.label)}</dt><dd>${money(t.tax)}</dd></div><div class="grand"><dt>Tổng thanh toán</dt><dd>${money(t.total)}</dd></div></dl>
      ${d.notes ? `<h3>Ghi chú</h3><p class="pre">${esc(d.notes)}</p>` : ''}
      ${q.order ? `<p>Đơn hàng: <b>${esc(q.order.orderNo)}</b> ${pill(ORDER_STATUS, q.order.status)}</p>` : ''}`;
    $('#pq-order').hidden = q.approvalStatus !== 'approved' || !!q.order;
    $('#p-quote-dialog').showModal();
  } catch (ex) { toast(ex.message, 'err'); }
});
$('#pq-order').addEventListener('click', async () => {
  const btn = $('#pq-order'); btn.disabled = true;
  try { await api(`/portal/quotes/${encodeURIComponent(openQuoteId)}/order`, 'POST', {}); $('#p-quote-dialog').close(); toast('Đã gửi đơn đặt hàng. Nhân viên phụ trách sẽ xác nhận.'); showTab('orders'); }
  catch (ex) { toast(ex.message, 'err'); } finally { btn.disabled = false; }
});

// ----- Danh mục + giỏ hàng
async function loadCatalog() {
  try {
    const d = await api('/portal/catalog' + (st.catalogVersion ? '?v=' + encodeURIComponent(st.catalogVersion) : ''));
    if (!d.unchanged) {
      st.catalogVersion = d.version;
      st.items = d.products.map(row => { const p = Object.fromEntries(d.columns.map((c, i) => [c, row[i]])); p._hay = fold([p.sku, p.name, p.brand, p.pattern].join(' ')); p._name = fold(p.name); return p; });
    }
    renderProducts(); renderCart();
  } catch (e) { $('#p-search-status').textContent = e.message; }
}
const unitPrice = p => after({ price: p.price, discount: p.discount, discountType: 'percent' }, { type: 'B2B', vat: 8 });
function renderProducts() {
  const words = fold($('#p-search').value).split(' ').filter(Boolean);
  const exact = $('#p-search').value.trim().toLowerCase();
  const found = st.items.filter(p => Number.isFinite(p.price) && words.every(w => p._hay.includes(w)))
    .sort((a, b) => (b.sku.toLowerCase() === exact) - (a.sku.toLowerCase() === exact) || (a._name < b._name ? -1 : a._name > b._name ? 1 : 0));
  $('#p-search-status').textContent = `${fmtNum(found.length)} sản phẩm${words.length ? ' phù hợp' : ''}.`;
  $('#p-products').innerHTML = found.slice(0, 60).map(p => `<li>
    ${p.imageUrl && /^https:\/\//.test(p.imageUrl) ? `<img class="thumb" src="${esc(p.imageUrl)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : '<span class="thumb"></span>'}
    <span class="prod-text"><b>${esc(p.name)}</b><small>${esc([p.sku, p.brand, p.unit].filter(Boolean).join(' · '))}</small></span>
    <span class="price">${money(unitPrice(p))}${p.discount > 0 ? `<small><s>${money(p.price)}</s> −${fmtNum(p.discount)}%</small>` : '<small>Chưa VAT</small>'}</span>
    <button type="button" class="btn secondary small" data-add="${esc(p.sku)}">${st.cart.has(p.sku) ? '✓ Đã chọn' : '＋ Chọn'}</button></li>`).join('');
}
let searchTimer;
$('#p-search').addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(renderProducts, 30); });
$('#p-products').addEventListener('click', e => {
  const b = e.target.closest('[data-add]'); if (!b) return;
  st.cart.set(b.dataset.add, (st.cart.get(b.dataset.add) || 0) + 1); renderProducts(); renderCart();
});
function renderCart() {
  const rows = [...st.cart].map(([sku, qty]) => { const p = st.items.find(x => x.sku === sku); return p && { p, qty, row: { price: p.price, discount: p.discount, discountType: 'percent', qty, ...(p.taxable && Number.isFinite(p.taxOut) ? { taxRate: p.taxOut } : {}) } }; }).filter(Boolean);
  $('#p-cart-count').textContent = `(${rows.length})`; $('#p-cart-empty').hidden = rows.length > 0;
  $('#p-cart').innerHTML = rows.map(({ p, qty }) => `<tr data-sku="${esc(p.sku)}"><td>${esc(p.name)}<small>${esc([p.sku, p.unit].filter(Boolean).join(' · '))}</small></td>
    <td class="right"><input class="num-input" type="number" min="1" step="1" inputmode="numeric" value="${qty}" data-qty aria-label="Số lượng ${esc(p.name)}"></td>
    <td class="right num">${money(p.price)}</td><td class="right">${p.discount > 0 ? fmtNum(p.discount) + '%' : '—'}</td><td class="right num">${money(unitPrice(p) * qty)}</td>
    <td><button type="button" class="icon-btn danger" data-remove aria-label="Bỏ ${esc(p.name)}">×</button></td></tr>`).join('');
  const t = totals({ type: 'B2B', vat: 8, rows: rows.map(r => r.row) });
  $('#p-subtotal').textContent = money(t.subtotal); $('#p-tax-label').textContent = t.label; $('#p-tax').textContent = money(t.tax); $('#p-total').textContent = money(t.total);
}
$('#p-cart').addEventListener('change', e => {
  const tr = e.target.closest('tr[data-sku]'); if (!tr || !e.target.matches('[data-qty]')) return;
  const q = Number(e.target.value); if (q > 0) st.cart.set(tr.dataset.sku, q); renderCart();
});
$('#p-cart').addEventListener('click', e => { const tr = e.target.closest('tr[data-sku]'); if (tr && e.target.closest('[data-remove]')) { st.cart.delete(tr.dataset.sku); renderCart(); renderProducts(); } });
async function send(order) {
  const err = $('#p-error'); err.textContent = '';
  if (!st.cart.size) { err.textContent = 'Chọn ít nhất một sản phẩm.'; return; }
  const btns = [$('#p-send-quote'), $('#p-send-order')]; btns.forEach(b => b.disabled = true);
  try {
    const r = await api('/portal/quotes', 'POST', { items: [...st.cart].map(([sku, qty]) => ({ sku, qty })), note: $('#p-note').value, deliveryDate: $('#p-delivery').value || undefined, order });
    st.cart.clear(); $('#p-note').value = ''; $('#p-delivery').value = '';
    toast(order ? `Đã gửi đơn hàng (${r.quoteNo}). Nhân viên phụ trách sẽ xác nhận.` : `Đã gửi yêu cầu báo giá ${r.quoteNo}. Nhân viên phụ trách sẽ xác nhận.`);
    showTab(order ? 'orders' : 'quotes');
  } catch (ex) { err.textContent = ex.message; } finally { btns.forEach(b => b.disabled = false); }
}
$('#p-send-quote').addEventListener('click', () => send(false));
$('#p-send-order').addEventListener('click', () => send(true));

// ----- Đơn hàng
async function loadOrders() {
  const box = $('#p-orders'); box.innerHTML = '<p class="muted card">Đang tải…</p>';
  try {
    const { orders } = await api('/portal/orders');
    $('#p-orders-empty').hidden = orders.length > 0;
    box.innerHTML = orders.map(o => `<article class="card portal-order" data-order="${esc(o.id)}">
      <header><div><b>${esc(o.orderNo)}</b> ${pill(ORDER_STATUS, o.status)}<small>Ngày đặt ${fmtDate(o.orderDate)}${o.quoteNo ? ' · Báo giá ' + esc(o.quoteNo) : ''}${o.expectedDeliveryDate ? ' · Giao dự kiến ' + fmtDate(o.expectedDeliveryDate) : ''}</small></div>
        <strong>${money(o.total)}</strong></header>
      <ul class="plain-list">${o.lines.map(l => `<li><span>${esc(l.name)}<small>${esc(l.sku)}</small></span><span>${fmtNum(l.qty)} ${esc(l.unit)}${l.deliveredQty ? ` · đã giao ${fmtNum(l.deliveredQty)}` : ''}</span><b>${money(l.amount)}</b></li>`).join('')}</ul>
      ${o.deliveries.length ? `<p class="small"><b>Lịch giao:</b> ${o.deliveries.map(d => `${fmtDate(d.plannedDate)} ${esc(d.timeSlot)} (${esc(DELIVERY_STATUS[d.status] || d.status)})`).join(' · ')}</p>` : ''}
      ${o.receivable && o.status !== 'draft' ? `<p class="small">Đã thanh toán ${money(o.receivable.paid)} · <b>Còn lại ${money(o.receivable.balance)}</b></p>` : ''}
      ${o.status === 'draft' ? '<button type="button" class="btn ghost small" data-cancel>Huỷ đơn</button>' : ''}
    </article>`).join('');
  } catch (e) { box.innerHTML = `<p class="error card">${esc(e.message)}</p>`; }
}
$('#p-orders').addEventListener('click', async e => {
  const art = e.target.closest('[data-order]'); if (!art || !e.target.closest('[data-cancel]')) return;
  if (!confirm('Huỷ đơn hàng này?')) return;
  try { await api(`/portal/orders/${encodeURIComponent(art.dataset.order)}/cancel`, 'POST', {}); toast('Đã huỷ đơn.'); loadOrders(); } catch (ex) { toast(ex.message, 'err'); }
});

boot().catch(e => { toast(e.message, 'err'); });
