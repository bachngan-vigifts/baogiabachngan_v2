// Bách Ngân · Trang khách hàng: xem/tạo báo giá, đặt hàng, theo dõi đơn. Không có tồn kho, giá nhập.
// Tính tiền dùng đúng hàm của máy chủ (quote-math.js sinh từ src/modules/quotes/domain/quote-math.ts).
import { totals, after } from './quote-math.js';
import { searchProducts as searchCatalog } from './product-search.js';
import { setupNotifications } from './notify.js';
import { verifyBox, duePill, allocatePayments, installmentStatus } from './verify.js';

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
// Giữ đăng nhập sau khi đóng app / tab: lưu ở localStorage (sessionStorage bị xoá mỗi lần đóng, nhất là app trên iPhone).
// Máy chủ tự gia hạn phiên khi còn dùng; chỉ bấm Đăng xuất, đổi mật khẩu hoặc bỏ app quá 30 ngày mới phải đăng nhập lại.
try { token = localStorage.getItem(SESSION_KEY) || sessionStorage.getItem(SESSION_KEY) || ''; if (token) { localStorage.setItem(SESSION_KEY, token); sessionStorage.removeItem(SESSION_KEY); } } catch { /* trình duyệt chặn lưu trữ */ }
const saveToken = t => { token = t || ''; try { if (token) localStorage.setItem(SESSION_KEY, token); else { localStorage.removeItem(SESSION_KEY); sessionStorage.removeItem(SESSION_KEY); } } catch { /* bỏ qua */ } };
const toLogin = (note = '') => showAuth(note);
async function api(path, method = 'GET', body) {
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = 'Bearer ' + token;
  let res;
  try { res = await fetch(API + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }); }
  catch { throw Object.assign(new Error('Chưa kết nối được máy chủ. Vui lòng kiểm tra mạng rồi thử lại.'), { status: 0 }); }
  const data = await res.json().catch(() => ({ error: 'Máy chủ chưa sẵn sàng. Vui lòng thử lại.' }));
  if (data.sessionToken !== undefined) saveToken(data.sessionToken);
  if (res.status === 401 && !['/login', '/activate'].includes(path)) { toLogin('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.'); throw new Error('Phiên đăng nhập đã hết hạn.'); }
  if (!res.ok) throw Object.assign(new Error(data.error || 'Không thực hiện được thao tác.'), { status: res.status, code: data.code });
  return data;
}

const ORDER_STATUS = { draft: ['Chờ xác nhận', 'warn'], confirmed: ['Đã xác nhận', 'blue'], delivering: ['Đang giao', 'warn'], delivered: ['Đã giao xong', 'ok'], cancelled: ['Đã huỷ', 'off'] };
const DELIVERY_STATUS = { planned: 'Đã lên lịch', in_transit: 'Đang giao', delivered: 'Đã giao', failed: 'Giao không thành công' };
const pill = (map, s) => `<span class="pill ${map[s]?.[1] || ''}">${esc(map[s]?.[0] || s)}</span>`;
const st = { me: null, items: [], cart: new Map(), catalogVersion: '' };

// ----- khởi động: chỉ tài khoản khách hàng
// ----- Đăng nhập / đặt mật khẩu ngay trên trang khách hàng (link kích hoạt: customer.html#email=…&token=…)
const view = which => { $('#c-auth').hidden = which !== 'auth'; $('#c-staff').hidden = which !== 'staff'; $('#portal').hidden = $('#p-head').hidden = which !== 'portal'; };
let activation = null;
function showAuth(note = '') {
  view('auth');
  const h = new URLSearchParams(location.hash.slice(1)), tk = h.get('token');
  activation = tk && /^[a-f0-9]{64}$/.test(tk) ? { token: tk, email: h.get('email') || '' } : null;
  $('#c-auth-title').textContent = activation ? 'Đặt mật khẩu tài khoản khách hàng' : 'Đăng nhập khách hàng';
  $('#c-auth-note').textContent = note || (activation ? 'Tạo mật khẩu (ít nhất 8 ký tự) để bắt đầu dùng trang khách hàng.' : 'Dùng email đã được nhân viên Bách Ngân cấp tài khoản.');
  $('#c-password2-label').hidden = !activation; $('#c-login-button').textContent = activation ? 'Đặt mật khẩu & vào trang' : 'Đăng nhập';
  if (activation) { $('#c-email').value = activation.email; $('#c-email').readOnly = true; $('#c-password').autocomplete = 'new-password'; }
}
$('#c-show-password').addEventListener('change', e => { $('#c-password').type = $('#c-password2').type = e.target.checked ? 'text' : 'password'; });
$('#c-login-form').addEventListener('submit', async e => {
  e.preventDefault();
  const err = $('#c-auth-error'), btn = $('#c-login-button'), email = $('#c-email').value.trim(), password = $('#c-password').value;
  err.textContent = '';
  if (!email || password.length < 8) { err.textContent = 'Nhập email và mật khẩu (ít nhất 8 ký tự).'; return; }
  if (activation && password !== $('#c-password2').value) { err.textContent = 'Hai lần nhập mật khẩu chưa khớp.'; return; }
  btn.disabled = true;
  try {
    if (activation) { await api('/activate', 'POST', { token: activation.token, password }); activation = null; history.replaceState(null, '', location.pathname + '#new'); }
    await api('/login', 'POST', { email, password });
    $('#c-login-form').reset(); $('#c-email').readOnly = false;
    await boot();
  } catch (ex) { err.textContent = ex.message; }
  finally { btn.disabled = false; }
});
$('#c-staff-logout').addEventListener('click', async () => { try { await api('/logout', 'POST', {}); } catch { /* bỏ qua */ } saveToken(''); showAuth(); });

async function boot() {
  if (/token=[a-f0-9]{64}/.test(location.hash)) { saveToken(''); return showAuth(); } // mở link đặt mật khẩu
  if (!token) return showAuth();
  const { user } = await api('/me');
  if (user.role !== 'customer') { $('#c-staff-name').textContent = user.name; view('staff'); return; }
  view('portal');
  st.me = await api('/portal/me');
  $('#p-customer').textContent = st.me.customer.name; $('#p-user').textContent = `${st.me.user.name} · ${st.me.user.email}`;
  const o = st.me.owner, d = st.me.discounts || {}, ck = [['Minh Long', d.minhLong], ['Minh Long - Lys', d.lys], ['Lock&Lock', d.lock]].filter(([, v]) => v > 0);
  $('#p-owner').innerHTML = `<div><small class="muted">Nhân viên phụ trách</small><b>${esc(o?.name || '—')}</b>${o?.phone ? ` · <a href="tel:${esc(o.phone.replace(/[^\d+]/g, ''))}">${esc(o.phone)}</a>` : ''}${o?.email ? ` · ${esc(o.email)}` : ''}</div>`
    + (ck.length ? `<div><small class="muted">Chiết khấu riêng của quý khách</small><b>${ck.map(([k, v]) => `${k} ${fmtNum(v)}%`).join(' · ')}</b></div>` : '');
  document.title = st.me.customer.name + ' · Bách Ngân';
  notifier.start();
  showTab(location.hash.replace('#', '') || 'new');
}
$('#p-logout').addEventListener('click', async () => { try { await api('/logout', 'POST', {}); } catch { /* bỏ qua */ } saveToken(''); showAuth('Đã đăng xuất.'); });

/** Thẻ: Tạo báo giá / Check tồn · Danh sách báo giá / Check tồn · Đơn đặt hàng / HĐKT · Công nợ. `#stock` (liên kết thông báo cũ) = danh sách, cuộn tới phần check tồn. */
function showTab(tab) {
  const toStock = tab === 'stock'; if (toStock) tab = 'quotes';
  if (!['quotes', 'new', 'orders', 'debt'].includes(tab)) tab = 'new';
  $$('[data-tab]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
  $$('[data-panel]').forEach(p => p.hidden = p.dataset.panel !== tab);
  history.replaceState(null, '', '#' + (toStock ? 'stock' : tab));
  if (tab === 'quotes') { loadQuotes(); loadStock().then(() => { if (toStock) $('#p-stock-section').scrollIntoView({ behavior: 'smooth' }); }); }
  else if (tab === 'orders') loadOrders(); else if (tab === 'debt') loadDebt(); else loadCatalog();
}
$$('[data-tab]').forEach(b => b.addEventListener('click', () => showTab(b.dataset.tab)));
addEventListener('hashchange', () => { if (st.me && !$('#portal').hidden) showTab(location.hash.replace('#', '')); });

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
let openQuoteId = '', openQuote = null;
$('#p-quotes').addEventListener('click', async e => {
  const tr = e.target.closest('[data-quote]'); if (!tr) return;
  try {
    const q = await api('/portal/quotes/' + encodeURIComponent(tr.dataset.quote)); openQuoteId = q.id; openQuote = q;
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
  const q = openQuote; if (!q) return;
  $('#p-quote-dialog').close();
  const v = await confirmOrder({ items: q.data.rows.map(r => ({ name: r.name, unit: r.unit, qty: r.qty })), total: q.totals.total, deliveryDate: q.data.deliveryDate || '' });
  if (!v) return $('#p-quote-dialog').showModal();
  const btn = $('#pq-order'); btn.disabled = true;
  try { await api(`/portal/quotes/${encodeURIComponent(openQuoteId)}/order`, 'POST', { confirmed: true, deliveryDate: v.deliveryDate }); toast('Đã gửi đơn đặt hàng. Nhân viên phụ trách sẽ xác nhận.'); showTab('orders'); }
  catch (ex) { toast(ex.message, 'err'); } finally { btn.disabled = false; }
});

// ----- Ảnh sản phẩm (như trang nhân viên: link Google Drive chuyển sang ảnh thu nhỏ; lỗi thì thử nguồn dự phòng)
const driveId = v => (String(v || '').match(/\/d\/([\w-]{10,})/) || String(v || '').match(/[?&]id=([\w-]{10,})/) || [])[1] || '';
const isDrive = v => { try { const h = new URL(v).hostname; return h === 'drive.google.com' || h === 'docs.google.com'; } catch { return false; } };
const displayImage = v => { const x = String(v || '').trim(), id = isDrive(x) && driveId(x); return id ? `https://drive.google.com/thumbnail?id=${id}&sz=w600` : x; };
const fallbackImage = v => { const id = isDrive(v) && driveId(v); return id ? `https://lh3.googleusercontent.com/d/${id}=w600` : ''; };
const PLACEHOLDER = '<svg viewBox="0 0 24 24"><path d="M4 5h16v14H4z M4 15l4-4 4 4 3-3 5 5 M15 9h.01"/></svg>';
const imgTag = (url, cls = 'thumb') => /^(https:\/\/|data:image\/)/i.test(url || '')
  ? `<img class="${cls}" src="${esc(displayImage(url))}" data-fallback="${esc(fallbackImage(url))}" alt="" loading="lazy" referrerpolicy="no-referrer">`
  : `<span class="${cls}">${PLACEHOLDER}</span>`;
document.addEventListener('error', e => {
  const img = e.target;
  if (!(img instanceof HTMLImageElement) || !img.classList.contains('thumb')) return;
  if (img.dataset.fallback) { img.src = img.dataset.fallback; img.dataset.fallback = ''; return; }
  const span = document.createElement('span'); span.className = img.className + ' broken'; span.title = 'Không tải được ảnh'; span.innerHTML = PLACEHOLDER; img.replaceWith(span);
}, true);

// ----- Danh mục: lọc ngay trên trình duyệt bằng đúng bộ lọc của trang nhân viên (product-search.js)
const CUSTOMER_POLICY = 'customer';
async function loadCatalog() {
  try {
    const d = await api('/portal/catalog' + (st.catalogVersion ? '?v=' + encodeURIComponent(st.catalogVersion) : ''));
    if (!d.unchanged) {
      st.catalogVersion = d.version;
      st.items = d.products.map(row => {
        const p = Object.fromEntries(d.columns.map((c, i) => [c, row[i]]));
        const label = fold(`${p.brand || ''} ${p.name || ''}`);
        return { ...p, customerPrice: Number.isFinite(p.price) ? unitPrice(p) : null, prices: { [CUSTOMER_POLICY]: Number.isFinite(p.price) ? unitPrice(p) : null }, stock: {},
          _hay: fold([p.sku, p.name, p.brand, p.pattern].map(v => v ?? '').join(' ')), _name: fold(p.name), _minhLong: ['minh long', 'healthy cook', 'su duong sinh'].some(w => label.includes(w)) };
      });
    }
    fillBrands(); fillInfo(); renderCart(); if ($('#p-picker').open) renderProducts();
  } catch (e) { $('#p-search-status').textContent = e.message; }
}
const unitPrice = p => after({ price: p.price, discount: p.discount, discountType: 'percent' }, { type: 'B2B', vat: 8 });
const vatText = p => p.taxable ? (Number.isFinite(p.taxOut) ? `VAT ${fmtNum(p.taxOut)}%` : 'Chưa có thuế đầu ra') : 'Không áp dụng thuế';
function fillInfo() {
  const c = st.me.customer;
  $('#p-date').value = new Date().toISOString().slice(0, 10);
  $('#p-owner-name').value = [st.me.owner?.name, st.me.owner?.phone].filter(Boolean).join(' · ');
  $('#p-cust-info').innerHTML = [['Tên công ty', c.name], ['Người liên hệ', c.contact], ['Điện thoại', c.phone], ['Email', c.email], ['MST', c.taxCode], ['Địa chỉ', c.address]]
    .filter(([, v]) => v).map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('');
}

/** Nhóm thương hiệu: Minh Long + Minh Long I = Minh Long; Lock / Lock&Lock / LocknLock = Lock&Lock; Healthy Cook = Sứ dưỡng sinh. */
const BRAND_ALIAS = { minhlongi: 'minhlong', locklock: 'lock', locknlock: 'lock', suduongsinh: 'healthycook', minhlongsuduongsinh: 'healthycook' };
const BRAND_LABEL = { minhlong: 'Minh Long', minhlonglys: 'Minh Long - LYS', lys: 'LYS', lock: 'Lock&Lock', healthycook: 'Healthy Cook (Sứ dưỡng sinh)' };
const brandKey = b => { const k = fold(b).replace(/[^a-z0-9]/g, ''); return BRAND_ALIAS[k] || k; };
const brandLabel = (k, fallback) => BRAND_LABEL[k] || fallback;
function fillBrands() {
  const count = new Map();
  for (const p of st.items) { const k = brandKey(p.brand); if (!k) continue; const m = count.get(k) ?? new Map(); m.set(p.brand.trim(), (m.get(p.brand.trim()) ?? 0) + 1); count.set(k, m); }
  const opts = [...count].map(([k, m]) => [k, brandLabel(k, [...m].sort((a, b) => b[1] - a[1])[0][0]), [...m.values()].reduce((a, b) => a + b, 0)]).sort((a, b) => a[1].localeCompare(b[1], 'vi'));
  const sel = $('#p-brand'), cur = sel.value;
  sel.innerHTML = '<option value="">Tất cả thương hiệu</option>' + opts.map(([k, label, n]) => `<option value="${esc(k)}">${esc(label)} (${fmtNum(n)})</option>`).join('');
  sel.value = opts.some(o => o[0] === cur) ? cur : '';
}
const priceNum = v => { const d = String(v || '').replace(/\D/g, ''); return d ? Number(d) : ''; };

let shown = 40;
function renderProducts(more = false) {
  shown = more ? shown + 40 : 40;
  const brand = $('#p-brand').value;
  let min = priceNum($('#p-min').value), max = priceNum($('#p-max').value);
  if (min !== '' && max !== '' && min > max) [min, max] = [max, min];
  const found = (searchCatalog(st.items, { q: $('#p-search').value, group: $('#p-group').value, policy: CUSTOMER_POLICY, min, max }) || [])
    .filter(p => p.customerPrice !== null && (!brand || brandKey(p.brand) === brand));
  $('#p-search-status').textContent = `${fmtNum(found.length)} sản phẩm phù hợp · Giá đã trừ chiết khấu riêng, chưa VAT.`;
  $('#p-products').innerHTML = found.slice(0, shown).map(p => { const has = st.cart.has(p.sku); return `<li class="${has ? 'added' : ''}">${imgTag(p.imageUrl)}
    <span class="prod-text"><b>${esc(p.name)}</b><small>Nhãn hiệu: ${esc(p.brand || '—')}</small><small>Mã ${esc(p.sku)} · ${esc(p.unit || '—')} · ${vatText(p)}</small></span>
    <span class="price">${money(p.customerPrice)}<small>${p.discount > 0 ? `<s>${money(p.price)}</s> −${fmtNum(p.discount)}%` : 'Chưa VAT'}</small></span>
    <input class="num-input" inputmode="decimal" value="${has ? st.cart.get(p.sku) : 1}" aria-label="Số lượng ${esc(p.name)}">
    <button type="button" class="btn secondary small pick-add" data-add="${esc(p.sku)}">${has ? '✓ Đã thêm' : '＋ Thêm'}</button></li>`; }).join('');
  $('#p-more-row').hidden = found.length <= shown;
}
const reRender = () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => renderProducts(), 30); };
let searchTimer, added = 0;
$('#p-pick').addEventListener('click', () => { added = 0; $('#p-added').textContent = ''; $('#p-picker').showModal(); $('#p-search').focus(); renderProducts(); });
$('#p-search').addEventListener('input', reRender);
$('#p-group').addEventListener('change', reRender);
$('#p-brand').addEventListener('change', reRender);
// Khoảng giá có sẵn điền vào ô "từ – đến"; gõ tay vào ô thì chuyển sang "Tự nhập".
$('#p-range').addEventListener('change', () => {
  const v = $('#p-range').value; if (v === 'custom') { $('#p-min').focus(); return; }
  const [lo, hi] = (v || ':').split(':'); $('#p-min').value = Number(lo) > 0 ? fmtNum(lo) : ''; $('#p-max').value = hi ? fmtNum(hi) : ''; reRender();
});
for (const id of ['#p-min', '#p-max']) $(id).addEventListener('input', e => {
  const n = priceNum(e.target.value); e.target.value = n === '' ? '' : fmtNum(n); $('#p-range').value = $('#p-min').value || $('#p-max').value ? 'custom' : ''; reRender();
});
$('#p-clear').addEventListener('click', () => { for (const id of ['#p-search', '#p-group', '#p-brand', '#p-range', '#p-min', '#p-max']) $(id).value = ''; renderProducts(); });
$('#p-more').addEventListener('click', () => renderProducts(true));
$('#p-products').addEventListener('click', e => {
  const b = e.target.closest('[data-add]'); if (!b) return;
  const q = Number(String(b.closest('li').querySelector('input').value).replace(',', '.'));
  if (!(q > 0)) return toast('Số lượng phải lớn hơn 0.', 'err');
  if (!st.cart.has(b.dataset.add)) added++;
  st.cart.set(b.dataset.add, q); b.textContent = '✓ Đã thêm'; b.closest('li').classList.add('added');
  $('#p-added').textContent = `Đã thêm ${added} sản phẩm vào báo giá`; $('#p-error').textContent = ''; renderCart();
});

// ----- Bảng sản phẩm của báo giá / đơn
function cartRows() {
  return [...st.cart].map(([sku, qty]) => { const p = st.items.find(x => x.sku === sku); return p && { p, qty, row: { price: p.price, discount: p.discount, discountType: 'percent', qty, ...(p.taxable && Number.isFinite(p.taxOut) ? { taxRate: p.taxOut } : {}) } }; }).filter(Boolean);
}
function renderCart() {
  const rows = cartRows();
  $('#p-cart-count').textContent = `(${rows.length})`;
  $('#p-cart').innerHTML = rows.length ? rows.map(({ p, qty }, i) => `<tr data-sku="${esc(p.sku)}">
    <td class="col-idx">${i + 1}</td>
    <td class="col-img">${imgTag(p.imageUrl)}</td>
    <td class="col-product"><b>${esc(p.name)}</b><div class="sku-line"><span class="muted">${esc(p.sku)}</span></div><div class="product-meta">${esc([p.brand, p.pattern, vatText(p)].filter(Boolean).join(' · '))}</div></td>
    <td class="col-unit" data-label="ĐVT">${esc(p.unit || '—')}</td>
    <td class="col-qty" data-label="Số lượng"><input class="num-input" inputmode="decimal" value="${fmtNum(qty)}" data-qty aria-label="Số lượng ${esc(p.name)}"></td>
    <td class="col-price right num" data-label="Đơn giá">${money(p.price)}</td>
    <td class="col-disc right" data-label="CK">${p.discount > 0 ? fmtNum(p.discount) + '%' : '—'}</td>
    <td class="col-after right num" data-label="Giá sau CK">${money(p.customerPrice)}</td>
    <td class="col-total right num line-total" data-label="Thành tiền"><b>${money(p.customerPrice * qty)}</b></td>
    <td class="line-actions"><button type="button" class="icon-btn danger" data-remove aria-label="Bỏ ${esc(p.name)}">×</button></td></tr>`).join('')
    : `<tr class="line-empty"><td colspan="10"><button type="button" class="add-first" data-add-first>＋ Thêm sản phẩm</button></td></tr>`;
  const t = totals({ type: 'B2B', vat: 8, rows: rows.map(r => r.row) });
  $('#p-subtotal').textContent = money(t.subtotal); $('#p-tax-label').textContent = t.label; $('#p-tax').textContent = money(t.tax); $('#p-total').textContent = money(t.total);
}
$('#p-cart').addEventListener('change', e => {
  const tr = e.target.closest('tr[data-sku]'); if (!tr || !e.target.matches('[data-qty]')) return;
  const q = Number(String(e.target.value).replace(/\./g, '').replace(',', '.')); if (q > 0) st.cart.set(tr.dataset.sku, q); renderCart();
});
$('#p-cart').addEventListener('click', e => {
  if (e.target.closest('[data-add-first]')) return $('#p-pick').click();
  const tr = e.target.closest('tr[data-sku]'); if (tr && e.target.closest('[data-remove]')) { st.cart.delete(tr.dataset.sku); renderCart(); }
});
/**
 * Bước xác thực trước khi khách gửi đơn: xem lại thông tin công ty, địa chỉ giao, sản phẩm, tổng tiền và chọn ngày giao mong muốn.
 * Trả về { deliveryDate } hoặc null nếu khách quay lại kiểm tra.
 */
const parseMoney = t => Number(String(t || '').replace(/[^\d]/g, '')) || 0;
async function confirmOrder({ items, total, deliveryDate = '' }) {
  const c = st.me.customer, val = v => v ? esc(v) : '';
  const today = new Date(), iso = new Date(today.getTime() - today.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  return verifyBox({
    title: 'Xác nhận gửi đơn đặt hàng', eyebrow: 'Kiểm tra trước khi gửi',
    intro: 'Quý khách vui lòng kiểm tra lại thông tin. Đơn chỉ có hiệu lực sau khi nhân viên phụ trách xác nhận.',
    rows: [['Công ty', val(c.name)], ['MST', val(c.taxCode)], ['Người nhận / SĐT', val([c.contact, c.phone].filter(Boolean).join(' · '))], ['Địa chỉ giao', val(c.address)],
      ['Sản phẩm', items.map(i => `${esc(i.name)} × ${fmtNum(i.qty)} ${esc(i.unit || '')}`).join('<br>')], ...(total !== undefined ? [['Tổng thanh toán (dự kiến)', `<b>${money(total)}</b>`]] : [])],
    fields: `<label class="verify-field"><span>Ngày giao mong muốn</span><input type="date" name="deliveryDate" value="${esc(deliveryDate)}" min="${iso}"></label>`,
    checks: ['Tên công ty, MST, người nhận, số điện thoại và địa chỉ giao hàng chính xác', 'Sản phẩm và số lượng đúng nhu cầu đặt hàng',
      'Ngày giao mong muốn đã chọn đúng', 'Tôi hiểu đơn hàng chỉ có hiệu lực khi nhân viên phụ trách xác nhận'],
    validate: v => v.deliveryDate ? '' : 'Vui lòng chọn ngày giao mong muốn.', ok: 'Gửi đơn đặt hàng',
  });
}
async function send(order) {
  const err = $('#p-error'); err.textContent = '';
  if (!st.cart.size) { err.textContent = 'Chọn ít nhất một sản phẩm.'; return; }
  let deliveryDate = $('#p-delivery').value || undefined;
  if (order) {
    const items = [...st.cart].map(([sku, qty]) => { const p = st.items.find(x => x.sku === sku); return { name: p?.name || sku, unit: p?.unit, qty }; });
    const v = await confirmOrder({ items, total: parseMoney($('#p-total').textContent), deliveryDate: deliveryDate || '' }); if (!v) return;
    deliveryDate = v.deliveryDate; $('#p-delivery').value = deliveryDate;
  }
  const btns = [$('#p-send-quote'), $('#p-send-order')]; btns.forEach(b => b.disabled = true);
  try {
    const r = await api('/portal/quotes', 'POST', { items: [...st.cart].map(([sku, qty]) => ({ sku, qty })), note: $('#p-note').value, deliveryDate, order, confirmed: order || undefined });
    st.cart.clear(); $('#p-note').value = ''; $('#p-delivery').value = '';
    toast(order ? `Đã gửi đơn hàng (${r.quoteNo}). Nhân viên phụ trách sẽ xác nhận.` : `Đã gửi yêu cầu báo giá ${r.quoteNo}. Nhân viên phụ trách sẽ xác nhận.`);
    showTab(order ? 'orders' : 'quotes');
  } catch (ex) { err.textContent = ex.message; } finally { btns.forEach(b => b.disabled = false); }
}
$('#p-send-quote').addEventListener('click', () => send(false));
$('#p-send-order').addEventListener('click', () => send(true));

// ----- Thông báo + tự làm mới: nhân viên xác nhận báo giá / đơn, trả lời tồn kho
const notifier = setupNotifications({
  api, root: $('#p-bell'),
  onNew(notes) { for (const n of notes.slice(0, 3)) toast(`${n.title}: ${n.body}`); const tab = location.hash.replace('#', '') || 'new'; if (tab !== 'new') showTab(tab); },
  onOpen(n) { const h = (n.url || '').split('#')[1]; if (h) { if (location.hash === '#' + h) showTab(h); else location.hash = h; } },
});

// ----- Đơn check tồn
async function loadStock() {
  const box = $('#p-stock'); box.innerHTML = '<p class="muted card">Đang tải…</p>';
  try {
    const { requests } = await api('/portal/stock-requests');
    $('#p-stock-empty').hidden = requests.length > 0;
    box.innerHTML = requests.map(r => { const done = r.status === 'answered'; return `<article class="card portal-order" data-stock-req="${esc(r.id)}" data-created="${esc(r.createdAt)}">
      <header><div><b>Đơn check tồn ${new Date(r.createdAt).toLocaleString('vi-VN')}</b> ${done ? '<span class="pill ok">Đã trả lời</span>' : '<span class="pill warn">Đang chờ trả lời</span>'}${r.note ? `<small>Ghi chú: ${esc(r.note)}</small>` : ''}</div></header>
      <div class="table-wrap"><table class="data-table"><thead><tr><th>Sản phẩm</th><th class="right">Cần</th><th class="right">Đáp ứng được</th>${done ? '<th class="right">Số lượng đặt</th>' : ''}</tr></thead><tbody>
      ${r.items.map(i => { const a = r.answerItems.find(x => x.sku === i.sku), avail = a ? Number(a.available) : null;
        // Đặt mặc định = số cần, không vượt số nhân viên báo đáp ứng được.
        const want = avail === null || !Number.isFinite(avail) ? i.qty : Math.max(0, Math.min(i.qty, avail));
        return `<tr><td>${esc(i.name)}<small>${esc(i.sku)}</small></td><td class="right">${fmtNum(i.qty)} ${esc(i.unit || '')}</td>
        <td class="right">${done ? (a ? `<b class="${a.available < i.qty ? 'danger-text' : ''}">${fmtNum(a.available)}</b>` : '—') : '…'}</td>
        ${done ? `<td class="right"><input class="num-input" inputmode="decimal" data-order-sku="${esc(i.sku)}" data-unit="${esc(i.unit || '')}" value="${want}" aria-label="Số lượng đặt ${esc(i.name)}"></td>` : ''}</tr>`; }).join('')}
      </tbody></table></div>
      ${r.answer ? `<p class="small"><b>Nhân viên trả lời:</b> ${esc(r.answer)}</p>` : ''}
      ${done ? '<div class="portal-actions"><button type="button" class="btn primary small" data-stock-order>Đặt hàng ngay</button></div>' : ''}
    </article>`; }).join('');
  } catch (e) { box.innerHTML = `<p class="error card">${esc(e.message)}</p>`; }
}
/** Đặt hàng thẳng từ đơn check tồn đã được trả lời: đơn "Chờ xác nhận" như Đặt hàng ngay. */
$('#p-stock').addEventListener('click', async e => {
  const b = e.target.closest('[data-stock-order]'); if (!b) return;
  const art = b.closest('[data-stock-req]');
  const items = [...art.querySelectorAll('[data-order-sku]')].map(inp => ({ sku: inp.dataset.orderSku, qty: Number(String(inp.value).replace(',', '.')) }));
  if (items.some(i => !(i.qty >= 0))) return toast('Số lượng đặt không hợp lệ.', 'err');
  const chosen = items.filter(i => i.qty > 0);
  if (!chosen.length) return toast('Nhập số lượng đặt cho ít nhất một sản phẩm.', 'err');
  const names = Object.fromEntries([...art.querySelectorAll('[data-order-sku]')].map(inp => [inp.dataset.orderSku, inp.closest('tr').querySelector('td').firstChild.textContent]));
  const units = Object.fromEntries([...art.querySelectorAll('[data-order-sku]')].map(inp => [inp.dataset.orderSku, inp.dataset.unit || '']));
  const v = await confirmOrder({ items: chosen.map(i => ({ name: names[i.sku] || i.sku, unit: units[i.sku], qty: i.qty })) }); if (!v) return;
  b.disabled = true;
  try {
    await api('/portal/quotes', 'POST', { items: chosen, order: true, confirmed: true, deliveryDate: v.deliveryDate, note: `Đặt theo đơn check tồn ${new Date(art.dataset.created).toLocaleString('vi-VN')}` });
    toast('Đã gửi đơn đặt hàng. Nhân viên phụ trách sẽ xác nhận.'); showTab('orders');
  } catch (ex) { toast(ex.message, 'err'); b.disabled = false; }
});
$('#p-ask-stock').addEventListener('click', async () => {
  const err = $('#p-error'); err.textContent = '';
  if (!st.cart.size) { err.textContent = 'Chọn sản phẩm cần check tồn trước.'; return; }
  const b = $('#p-ask-stock'); b.disabled = true;
  try {
    await api('/portal/stock-requests', 'POST', { items: [...st.cart].map(([sku, qty]) => ({ sku, qty })), note: $('#p-note').value });
    toast('Đã gửi đơn check tồn. Nhân viên phụ trách sẽ trả lời sớm.'); showTab('stock');
  } catch (ex) { err.textContent = ex.message; } finally { b.disabled = false; }
});

// ----- Công nợ: tổng phải trả, đã trả, còn lại, quá hạn; theo từng đơn và lịch sử thanh toán
const DEBT_STATUS = { paid: ['Đã thanh toán đủ', 'ok'], overdue: ['Quá hạn', 'danger'], open: ['Chưa đến hạn', 'blue'], none: ['—', 'off'] };
const METHOD = { transfer: 'Chuyển khoản', cash: 'Tiền mặt', other: 'Khác' };
async function loadDebt() {
  const tbody = $('#p-debt'); tbody.innerHTML = '<tr><td colspan="6" class="muted">Đang tải…</td></tr>';
  try {
    const { orders } = await api('/portal/orders');
    const list = orders.filter(o => o.receivable && o.receivable.due > 0); // máy chủ chỉ trả công nợ của đơn đã duyệt / HĐKT đã ký
    const sum = k => list.reduce((t, o) => t + (o.receivable[k] || 0), 0);
    const next = list.map(o => o.receivable.nextDueDate).filter(Boolean).sort()[0];
    $('#p-debt-stats').innerHTML = [['Tổng phải trả', sum('due'), ''], ['Đã thanh toán', sum('paid'), ''], ['Còn phải trả', sum('balance'), sum('balance') > 0 ? 'Hạn gần nhất ' + (fmtDate(next) || 'sau khi giao hàng') : 'Đã thanh toán đủ'], ['Quá hạn', sum('overdue'), sum('overdue') > 0 ? 'Vui lòng thanh toán sớm' : 'Không có']]
      .map(([k, v, note]) => `<article class="stat"><small>${k}</small><strong class="${k === 'Quá hạn' && v > 0 ? 'danger-text' : ''}">${money(v)}</strong>${note ? `<span class="muted">${esc(note)}</span>` : ''}</article>`).join('');
    $('#p-debt-empty').hidden = list.length > 0;
    tbody.innerHTML = list.map(o => { const r = o.receivable; return `<tr>
      <td class="first"><span class="strong">${esc(o.orderNo)}</span><small>Ngày đặt ${fmtDate(o.orderDate)}</small></td>
      <td class="right num">${money(r.due)}</td><td class="right num ${r.paid > 0 ? 'paid-text' : ''}">${money(r.paid)}</td><td class="right num"><b>${money(r.balance)}</b></td>
      <td data-label="Hạn">${allocatePayments(o.schedules, r.paid).map(s => `<small>${esc(s.note || (s.kind === 'deposit' ? 'Đặt cọc' : 'Phần còn lại'))}: ${money(s.amount)} · ${s.left <= 0 ? installmentStatus(s) : (s.dueDate ? 'hạn ' + fmtDate(s.dueDate) : 'sau khi giao hàng') + (s.covered > 0 ? ' · ' + installmentStatus(s) : '')}</small>`).join('')}</td>
      <td data-label="Tình trạng">${pill(DEBT_STATUS, r.status)}${r.overdue > 0 ? `<small class="danger-text">Quá hạn ${money(r.overdue)}</small>` : ''}</td></tr>`; }).join('');
    const pays = orders.filter(o => o.receivable).flatMap(o => o.payments.map(p => ({ ...p, orderNo: o.orderNo }))).sort((a, b) => b.paidAt.localeCompare(a.paidAt));
    $('#p-pay-history').innerHTML = pays.length ? pays.map(p => `<li><span>${fmtDate(p.paidAt)} · ${esc(METHOD[p.method] || p.method)}<small>Đơn ${esc(p.orderNo)}</small></span><b>${money(p.amount)}</b></li>`).join('') : '<li class="muted">Chưa có lần thanh toán nào.</li>';
  } catch (e) { tbody.innerHTML = `<tr><td colspan="6" class="error">${esc(e.message)}</td></tr>`; }
}

// ----- Đơn đặt hàng / HĐKT
const CONTRACT_STATUS = { draft: ['HĐKT nháp', 'off'], signed: ['Đã ký', 'ok'], completed: ['Hoàn tất', 'ok'] };
async function loadOrders() {
  const box = $('#p-orders'); box.innerHTML = '<p class="muted card">Đang tải…</p>';
  try {
    const { orders } = await api('/portal/orders');
    $('#p-orders-empty').hidden = orders.length > 0;
    box.innerHTML = orders.map(o => `<article class="card portal-order" data-order="${esc(o.id)}">
      <header><div><b>${esc(o.orderNo)}</b> ${pill(ORDER_STATUS, o.status)}<small>Ngày đặt ${fmtDate(o.orderDate)}${o.quoteNo ? ' · Báo giá ' + esc(o.quoteNo) : ''}</small>${o.expectedDeliveryDate && o.status !== 'cancelled' ? `<span class="small">Giao dự kiến ${duePill(o.expectedDeliveryDate, { done: o.status === 'delivered', fmt: fmtDate })}</span>` : ''}</div>
        <strong>${money(o.total)}</strong></header>
      <ul class="plain-list">${o.lines.map(l => `<li><span>${esc(l.name)}<small>${esc(l.sku)}</small></span><span>${fmtNum(l.qty)} ${esc(l.unit)}${l.deliveredQty ? ` · đã giao ${fmtNum(l.deliveredQty)}` : ''}</span><b>${money(l.amount)}</b></li>`).join('')}</ul>
      ${o.contract ? `<p class="small"><b>HĐKT ${esc(o.contract.contractNo)}</b> ${pill(CONTRACT_STATUS, o.contract.status)}${o.contract.signedDate ? ' · ký ngày ' + fmtDate(o.contract.signedDate) : ''}</p>` : ''}
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
