// Bách Ngân · Báo giá – giao diện dùng thử v2 (JS thuần, không cần build).
// Tính tiền dùng đúng hàm của máy chủ: quote-math.js được sinh từ src/modules/quotes/domain/quote-math.ts.
import { totals, after, discounted, profit, normalize } from './quote-math.js';

const API = document.querySelector('meta[name="bn-api"]')?.content
  || 'https://taceqfnsorewelsbdckg.supabase.co/functions/v1/baogia-v2-api/api/staff';
const SESSION_KEY = 'bn-v2-session';

// ---------------------------------------------------------------- tiện ích
const $ = s => document.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const vnd = new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND', maximumFractionDigits: 0 });
const money = v => vnd.format(Math.round(Number(v) || 0));
const shortMoney = v => {
  const n = Number(v) || 0, a = Math.abs(n);
  if (a >= 1e9) return (n / 1e9).toLocaleString('vi-VN', { maximumFractionDigits: 2 }) + ' tỷ';
  if (a >= 1e6) return (n / 1e6).toLocaleString('vi-VN', { maximumFractionDigits: 1 }) + ' tr';
  return money(n);
};
const fmtNum = (v, digits = 2) => Number.isFinite(v) ? new Intl.NumberFormat('vi-VN', { maximumFractionDigits: digits }).format(v) : '';
/** Đọc số kiểu Việt Nam: "1.250.000", "1,5", "12.5", "185000đ". Trả NaN nếu không hợp lệ. */
function parseNum(s) {
  let t = String(s ?? '').trim().replace(/[\s₫%]|đ|vnd/gi, '');
  if (!t) return 0;
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, '');
  return /^-?\d*\.?\d+$/.test(t) ? Number(t) : NaN;
}
const todayIso = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
const fmtDate = iso => { if (!iso) return ''; const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso); return m ? `${m[3]}/${m[2]}/${m[1]}` : ''; };
function ago(iso) {
  const t = new Date(iso).getTime(); if (!t) return '';
  const s = (Date.now() - t) / 1000;
  if (s < 60) return 'vừa xong';
  if (s < 3600) return Math.floor(s / 60) + ' phút trước';
  if (s < 86400) return Math.floor(s / 3600) + ' giờ trước';
  if (s < 7 * 86400) return Math.floor(s / 86400) + ' ngày trước';
  return new Date(iso).toLocaleDateString('vi-VN');
}
const initials = name => String(name || '?').trim().split(/\s+/).slice(-2).map(w => w[0]).join('').toUpperCase() || '?';
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random()));

/** Số tiền bằng chữ (đồng). */
function moneyWords(value) {
  const n = Math.round(Math.abs(Number(value) || 0));
  if (!n) return 'Không đồng';
  const D = ['không', 'một', 'hai', 'ba', 'bốn', 'năm', 'sáu', 'bảy', 'tám', 'chín'];
  const read3 = (x, full) => {
    const h = Math.floor(x / 100), t = Math.floor(x / 10) % 10, u = x % 10, out = [];
    if (full || h) out.push(D[h] + ' trăm');
    if (t > 1) { out.push(D[t] + ' mươi'); if (u === 1) out.push('mốt'); else if (u === 4) out.push('tư'); else if (u === 5) out.push('lăm'); else if (u) out.push(D[u]); }
    else if (t === 1) { out.push('mười'); if (u === 5) out.push('lăm'); else if (u) out.push(D[u]); }
    else if (u) { if (full || h) out.push('lẻ'); out.push(D[u]); }
    return out.join(' ');
  };
  const below1e9 = (x, started) => {
    const out = [];
    [[Math.floor(x / 1e6) % 1000, 'triệu'], [Math.floor(x / 1e3) % 1000, 'nghìn'], [x % 1000, '']].forEach(([g, unit]) => {
      if (!g) return;
      out.push(read3(g, started) + (unit ? ' ' + unit : '')); started = true;
    });
    return out.join(' ');
  };
  const read = (x, started) => {
    const ty = Math.floor(x / 1e9), rest = x % 1e9, parts = [];
    if (ty) parts.push(read(ty, started) + ' tỷ');
    if (rest) parts.push(below1e9(rest, started || ty > 0));
    return parts.join(' ');
  };
  const s = read(n, false);
  return s.charAt(0).toUpperCase() + s.slice(1) + ' đồng';
}

// ---------------------------------------------------------------- thông báo & xác nhận
function toast(text, kind = 'ok') {
  const el = document.createElement('div');
  el.className = 'toast ' + kind; el.textContent = text;
  $('#toasts').append(el);
  setTimeout(() => el.remove(), kind === 'err' ? 6000 : 3500);
}
function confirmBox(text, { title = 'Xác nhận', ok = 'Đồng ý', danger = false } = {}) {
  const dlg = $('#confirm-dialog');
  $('#confirm-title').textContent = title; $('#confirm-text').textContent = text;
  const okBtn = $('#confirm-ok'); okBtn.textContent = ok; okBtn.classList.toggle('danger-bg', danger);
  return new Promise(resolve => {
    const done = v => { dlg.close(); okBtn.onclick = $('#confirm-cancel').onclick = null; resolve(v); };
    okBtn.onclick = () => done(true); $('#confirm-cancel').onclick = () => done(false);
    dlg.oncancel = e => { e.preventDefault(); done(false); };
    dlg.showModal(); okBtn.focus();
  });
}
$$('[data-close]').forEach(b => b.addEventListener('click', () => b.closest('dialog').close()));

// ---------------------------------------------------------------- gọi API
let token = '';
try { token = sessionStorage.getItem(SESSION_KEY) || ''; } catch { /* trình duyệt chặn lưu trữ */ }
const saveToken = t => { token = t || ''; try { if (token) sessionStorage.setItem(SESSION_KEY, token); else sessionStorage.removeItem(SESSION_KEY); } catch { /* bỏ qua */ } };

class ApiError extends Error { constructor(message, status) { super(message); this.status = status; } }
async function api(path, method = 'GET', body) {
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = 'Bearer ' + token;
  let res;
  try { res = await fetch(API + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }); }
  catch { throw new ApiError('Chưa kết nối được máy chủ. Vui lòng kiểm tra mạng rồi thử lại.', 0); }
  const data = await res.json().catch(() => ({ error: 'Máy chủ chưa sẵn sàng. Vui lòng thử lại.' }));
  if (data.sessionToken !== undefined) saveToken(data.sessionToken);
  if (!res.ok) {
    if (res.status === 401 && !['/login', '/activate', '/password'].includes(path)) { showAuth('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.'); }
    throw new ApiError(data.error || 'Không thực hiện được thao tác.', res.status);
  }
  return data;
}

// ---------------------------------------------------------------- trạng thái
const state = {
  user: null, quotes: null, customers: null, members: null, positions: [],
  quoteFilter: { q: '', type: '', owner: '', sort: 'updated' },
  customerQuery: '', memberQuery: '', memberStatus: '',
};
const isManager = () => state.user?.role === 'manager';

// ---------------------------------------------------------------- đăng nhập / kích hoạt
const hashParams = () => new URLSearchParams(location.hash.slice(1));
let activation = /(^|&)token=/.test(location.hash.slice(1)) ? hashParams().get('token') : null;

function showAuth(message = '') {
  state.user = null; saveToken('');
  $('#workspace').hidden = true; $('#auth').hidden = false;
  $('#auth-error').textContent = message;
  if (!activation) { $('#auth-title').textContent = 'Đăng nhập'; }
  setTimeout(() => ($('#email').value ? $('#password') : $('#email')).focus(), 0);
}
function setupActivationForm() {
  $('#auth-title').textContent = 'Đặt mật khẩu';
  $('#auth-note').textContent = 'Chào mừng! Đặt mật khẩu cho tài khoản của anh/chị (từ 8 ký tự).';
  $('#login-button').textContent = 'Kích hoạt & đăng nhập';
  $('#password').autocomplete = 'new-password';
  $('#password2-label').hidden = false; $('#password2').required = true;
  const email = hashParams().get('email');
  if (email) { $('#email').value = email; $('#email').readOnly = true; }
}
$$('[data-toggle-pw]').forEach(b => b.addEventListener('click', () => {
  const input = document.getElementById(b.dataset.togglePw);
  const show = input.type === 'password'; input.type = show ? 'text' : 'password';
  b.textContent = show ? 'Ẩn' : 'Hiện'; b.setAttribute('aria-label', show ? 'Ẩn mật khẩu' : 'Hiện mật khẩu');
}));
$('#login-form').addEventListener('submit', async e => {
  e.preventDefault();
  const email = $('#email').value.trim(), password = $('#password').value, err = $('#auth-error');
  err.textContent = '';
  if (!/^\S+@\S+\.\S+$/.test(email)) { err.textContent = 'Vui lòng nhập email hợp lệ.'; return; }
  if (password.length < 8) { err.textContent = 'Mật khẩu cần ít nhất 8 ký tự.'; return; }
  if (activation && password !== $('#password2').value) { err.textContent = 'Hai lần nhập mật khẩu chưa khớp.'; return; }
  const btn = $('#login-button'); btn.disabled = true;
  try {
    if (activation) {
      await api('/activate', 'POST', { token: activation, password });
      activation = null; history.replaceState(null, '', location.pathname + '#/quotes');
    }
    await api('/login', 'POST', { email, password });
    $('#password').value = ''; $('#password2').value = '';
    await enter();
  } catch (ex) { err.textContent = ex.message; }
  finally { btn.disabled = false; }
});

async function enter() {
  const { user } = await api('/me');
  if (user.role === 'supplier' || user.positionId === 'supplier') {
    await api('/logout', 'POST', {}).catch(() => {});
    showAuth('Tài khoản nhà cung cấp chưa dùng được bản thử này. Cổng NCC đang được hoàn thiện.');
    return;
  }
  state.user = user;
  $('#auth').hidden = true; $('#workspace').hidden = false;
  $('#user-name').textContent = $('#menu-name').textContent = user.name;
  $('#menu-email').textContent = user.email;
  $('#user-role').textContent = user.position || (user.role === 'manager' ? 'Manager' : 'Nhân viên');
  $('#user-avatar').textContent = $('#account-button-m').textContent = initials(user.name);
  $$('.manager-only').forEach(el => el.hidden = !isManager());
  if (!/^#\//.test(location.hash)) history.replaceState(null, '', location.pathname + '#/quotes');
  currentHash = location.hash;
  route();
  loadAll();
}

// ---------------------------------------------------------------- tài khoản
function toggleAccountMenu(force) {
  const menu = $('#account-menu'), open = force ?? menu.hidden;
  menu.hidden = !open; $('#account-button').setAttribute('aria-expanded', String(open));
}
$('#account-button').addEventListener('click', e => { e.stopPropagation(); toggleAccountMenu(); });
$('#account-button-m').addEventListener('click', e => { e.stopPropagation(); toggleAccountMenu(); });
document.addEventListener('click', e => { if (!e.target.closest('#account-menu')) toggleAccountMenu(false); });
$('#logout').addEventListener('click', async () => {
  toggleAccountMenu(false);
  if (editor.dirty && !await confirmBox('Báo giá đang sửa chưa được lưu. Vẫn đăng xuất?', { ok: 'Đăng xuất' })) return;
  editor.dirty = false;
  try { await api('/logout', 'POST', {}); } catch { /* vẫn thoát */ }
  state.quotes = state.customers = state.members = null;
  showAuth(); $('#auth-note').textContent = 'Đã đăng xuất.';
});
$('#change-password').addEventListener('click', () => {
  toggleAccountMenu(false);
  $('#password-form').reset(); $('#password-error').textContent = '';
  $('#password-dialog').showModal();
});
$('#password-form').addEventListener('submit', async e => {
  e.preventDefault();
  const f = new FormData(e.target), err = $('#password-error');
  err.textContent = '';
  if (String(f.get('password')).length < 8) { err.textContent = 'Mật khẩu mới cần ít nhất 8 ký tự.'; return; }
  if (f.get('password') !== f.get('password2')) { err.textContent = 'Hai lần nhập mật khẩu mới chưa khớp.'; return; }
  const btn = $('#save-password'); btn.disabled = true;
  try {
    await api('/password', 'POST', { currentPassword: f.get('currentPassword'), password: f.get('password') });
    $('#password-dialog').close();
    showAuth(); $('#auth-note').textContent = 'Đã đổi mật khẩu. Vui lòng đăng nhập lại bằng mật khẩu mới.';
  } catch (ex) { err.textContent = ex.message; }
  finally { btn.disabled = false; }
});

// ---------------------------------------------------------------- tải dữ liệu
async function loadAll() {
  $('#global-error').hidden = true;
  const jobs = [loadQuotes(), loadCustomers()];
  if (isManager()) jobs.push(loadMembers());
  await Promise.all(jobs);
}
function showGlobalError(message) { const el = $('#global-error'); el.textContent = message; el.hidden = false; }
async function loadQuotes() {
  try { state.quotes = (await api('/quotes')).quotes; }
  catch (e) { state.quotes = state.quotes || []; if (e.status !== 401) showGlobalError(e.message); }
  renderQuotes(); renderCustomers();
}
async function loadCustomers() {
  try { state.customers = (await api('/customers')).customers; }
  catch (e) { state.customers = state.customers || []; if (e.status !== 401) showGlobalError(e.message); }
  renderCustomers(); renderStats();
}
async function loadMembers() {
  try { const d = await api('/admin/members'); state.members = d.members; state.positions = d.positions; }
  catch (e) { state.members = state.members || []; if (e.status !== 401) showGlobalError(e.message); }
  renderMembers();
}

// ---------------------------------------------------------------- điều hướng
const VIEWS = { quotes: 'Báo giá', customers: 'Khách hàng', staff: 'Nhân viên', editor: 'Báo giá' };
let currentHash = location.hash, suppressHash = false;
window.addEventListener('hashchange', async () => {
  if (activation || !state.user) return;
  if (suppressHash) { suppressHash = false; return; }
  const target = location.hash;
  if (editor.dirty && currentHash.startsWith('#/quotes/') && target !== currentHash) {
    suppressHash = true; location.hash = currentHash;
    if (!await confirmBox('Báo giá có thay đổi chưa lưu. Rời trang sẽ mất các thay đổi này.', { title: 'Rời khỏi báo giá?', ok: 'Rời trang', danger: true })) return;
    editor.dirty = false; location.hash = target; return;
  }
  currentHash = target; route();
});
window.addEventListener('beforeunload', e => { if (editor.dirty) { e.preventDefault(); e.returnValue = ''; } });

function route() {
  const [page = 'quotes', id] = location.hash.replace(/^#\/?/, '').split('?')[0].split('/');
  let view = VIEWS[page] ? page : 'quotes';
  if (view === 'staff' && !isManager()) view = 'quotes';
  if (view === 'quotes' && id) view = 'editor';
  for (const v of Object.keys(VIEWS)) $('#view-' + v).hidden = v !== view;
  const navKey = view === 'editor' ? 'quotes' : view;
  $$('[data-nav]').forEach(a => a.classList.toggle('active', a.dataset.nav === navKey));
  $('#breadcrumb').textContent = view === 'editor' ? (id === 'new' ? 'Tạo báo giá' : 'Sửa báo giá') : VIEWS[view];
  document.title = (view === 'editor' ? $('#breadcrumb').textContent : VIEWS[view]) + ' · Bách Ngân';
  window.scrollTo(0, 0);
  if (view === 'editor') openEditor(id);
}
const go = hash => { if (location.hash === hash) route(); else location.hash = hash; };

// ---------------------------------------------------------------- danh sách báo giá
const skeleton = cols => Array.from({ length: 4 }, () => `<tr class="skeleton">${'<td><span></span></td>'.repeat(cols)}</tr>`).join('');
function filteredQuotes() {
  const f = state.quoteFilter, q = normalize(f.q);
  const list = (state.quotes || []).filter(x =>
    (!f.type || x.quoteType === f.type) &&
    (!f.owner || (f.owner === 'mine') === !!x.mine) &&
    (!q || normalize(`${x.quoteNo} ${x.customer} ${x.contact || ''} ${x.phone || ''}`).includes(q)));
  const by = {
    updated: (a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)),
    date: (a, b) => String(b.quoteDate || '').localeCompare(String(a.quoteDate || '')) || String(b.updatedAt).localeCompare(String(a.updatedAt)),
    value: (a, b) => b.total - a.total,
    no: (a, b) => String(a.quoteNo).localeCompare(String(b.quoteNo), 'vi', { numeric: true }),
  }[f.sort];
  return list.sort(by);
}
function renderStats() {
  const all = state.quotes;
  if (!all) return;
  const list = filteredQuotes(), month = todayIso().slice(0, 7);
  const thisMonth = all.filter(q => (q.quoteDate || q.createdAt || '').startsWith(month));
  $('#stat-count').textContent = list.length.toLocaleString('vi-VN');
  $('#stat-count-note').textContent = list.length === all.length ? 'Tất cả báo giá' : `Lọc từ ${all.length} báo giá`;
  $('#stat-value').textContent = shortMoney(list.reduce((s, q) => s + q.total, 0));
  $('#stat-month').textContent = thisMonth.length.toLocaleString('vi-VN');
  $('#stat-month-value').textContent = thisMonth.length ? shortMoney(thisMonth.reduce((s, q) => s + q.total, 0)) : 'Chưa có báo giá';
  $('#stat-customers').textContent = state.customers ? state.customers.length.toLocaleString('vi-VN') : '–';
  $('#nav-quote-count').textContent = all.length;
}
function renderQuotes() {
  const tbody = $('#quote-list');
  if (!state.quotes) { tbody.innerHTML = skeleton(7); return; }
  $('#quote-owner').hidden = !state.quotes.some(q => !q.mine);
  const list = filteredQuotes();
  renderStats();
  tbody.innerHTML = list.map(q => `
    <tr class="clickable" data-open="${esc(q.id)}">
      <td class="first"><span class="strong">${esc(q.quoteNo)}</span><small>${q.lineCount ?? ''} sản phẩm · phiên bản ${esc(q.revision)}${q.mine ? '' : ' · <span class="pill blue">Được chia sẻ</span>'}</small></td>
      <td data-label="Khách">${esc(q.customer) || '<span class="muted">—</span>'}${q.contact || q.phone ? `<small>${esc([q.contact, q.phone].filter(Boolean).join(' · '))}</small>` : ''}</td>
      <td><span class="pill type-${esc(q.quoteType)}">${esc(q.quoteType)}</span></td>
      <td data-label="Ngày">${fmtDate(q.quoteDate) || '—'}</td>
      <td class="right num">${money(q.total)}</td>
      <td data-label="Cập nhật" title="${esc(new Date(q.updatedAt).toLocaleString('vi-VN'))}">${ago(q.updatedAt)}</td>
      <td class="actions-cell"><div class="row-actions">
        <button class="icon-btn" data-dup="${esc(q.id)}" title="Nhân bản" aria-label="Nhân bản ${esc(q.quoteNo)}"><svg viewBox="0 0 24 24"><path d="M9 9h11v11H9z M5 15H4V4h11v1"/></svg></button>
        <button class="icon-btn" data-open="${esc(q.id)}" title="Mở" aria-label="Mở ${esc(q.quoteNo)}"><svg viewBox="0 0 24 24"><path d="M9 18l6-6-6-6"/></svg></button>
      </div></td>
    </tr>`).join('');
  const empty = $('#quote-empty'), none = state.quotes.length === 0;
  empty.hidden = list.length > 0;
  $('#quote-empty-title').textContent = none ? 'Chưa có báo giá' : 'Không có báo giá phù hợp';
  $('#quote-empty-text').textContent = none ? 'Tạo báo giá đầu tiên để bắt đầu làm việc.' : 'Thử từ khoá khác hoặc bỏ bớt bộ lọc.';
  $('#quote-empty-action').hidden = !none;
  $('#quote-table').hidden = list.length === 0;
}
$('#quote-list').addEventListener('click', e => {
  const dup = e.target.closest('[data-dup]');
  if (dup) { e.stopPropagation(); duplicateFromList(dup.dataset.dup); return; }
  const open = e.target.closest('[data-open]');
  if (open) go('#/quotes/' + encodeURIComponent(open.dataset.open));
});
$('#quote-search').addEventListener('input', e => { state.quoteFilter.q = e.target.value; renderQuotes(); });
$('#quote-sort').addEventListener('change', e => { state.quoteFilter.sort = e.target.value; renderQuotes(); });
$('#quote-owner').addEventListener('change', e => { state.quoteFilter.owner = e.target.value; renderQuotes(); });
$('#type-filter').addEventListener('click', e => {
  const chip = e.target.closest('.chip'); if (!chip) return;
  $$('#type-filter .chip').forEach(c => c.classList.toggle('active', c === chip));
  state.quoteFilter.type = chip.dataset.type; renderQuotes();
});

// ---------------------------------------------------------------- soạn báo giá
const editor = { id: null, revision: 0, base: {}, rows: [], type: 'B2B', dirty: false, customerId: '', pending: null, loading: false };
const qf = $('#quote-form');
const field = name => qf.elements.namedItem(name);
const NOTE_PRESETS = [
  'Báo giá có hiệu lực trong 30 ngày.',
  'Giá chưa bao gồm phí vận chuyển.',
  'Thanh toán: đặt cọc 50%, phần còn lại khi giao hàng.',
  'Thời gian giao hàng: 7–10 ngày làm việc kể từ khi xác nhận đơn.',
];
$('#note-presets').innerHTML = NOTE_PRESETS.map((t, i) => `<button type="button" class="chip" data-preset="${i}">＋ ${esc(t.split(':')[0].replace(/\.$/, ''))}</button>`).join('');
$('#note-presets').addEventListener('click', e => {
  const b = e.target.closest('[data-preset]'); if (!b) return;
  const text = NOTE_PRESETS[b.dataset.preset], notes = field('notes');
  if (notes.value.includes(text)) return;
  notes.value = (notes.value.trim() ? notes.value.trimEnd() + '\n' : '') + text; markDirty();
});

function nextQuoteNo() {
  const prefix = 'BG-' + todayIso().replaceAll('-', '') + '-';
  const used = (state.quotes || []).map(q => q.quoteNo).filter(n => n?.startsWith(prefix)).map(n => parseInt(n.slice(prefix.length), 10) || 0);
  return prefix + String(Math.max(0, ...used) + 1).padStart(3, '0');
}
const blankRow = () => ({ id: uid(), name: '', sku: '', unit: '', qty: 1, price: 0, discount: 0, discountType: 'percent', printFee: 0 });
function newQuoteData(extra = {}) {
  return { type: 'B2B', quoteNo: nextQuoteNo(), date: todayIso(), vat: 8, customer: '', owner: state.user?.name || '', ownerPhone: state.user?.phone || '', notes: '', rows: [blankRow()], ...extra };
}

async function openEditor(id) {
  $('#quote-error').textContent = ''; $('#conflict-banner').hidden = true;
  if (id === 'new') {
    const pending = editor.pending; editor.pending = null;
    fillEditor(null, 0, pending || newQuoteData());
    if (pending) markDirty();
    setTimeout(() => { if (!qf.contains(document.activeElement)) (pending?.customer ? field('quoteNo') : $('#customer-search-input')).focus(); }, 50);
    return;
  }
  if (editor.id === id && !editor.loading && editor.dirty) return; // quay lại đúng báo giá đang sửa
  editor.loading = true;
  $('#editor-title').textContent = 'Đang tải báo giá…';
  qf.inert = true;
  try {
    const q = await api('/quotes/' + encodeURIComponent(id));
    fillEditor(q.id, q.revision, q.data);
  } catch (e) {
    toast(e.message, 'err');
    if (e.status !== 401) { editor.dirty = false; go('#/quotes'); }
  } finally { editor.loading = false; qf.inert = false; }
}

function fillEditor(id, revision, data) {
  editor.id = id; editor.revision = revision; editor.base = structuredClone(data);
  editor.type = ['B2B', 'HRC', 'VIGIFTS'].includes(data.type) ? data.type : 'B2B';
  editor.customerId = data.customerId || '';
  editor.rows = (data.rows?.length ? data.rows : [blankRow()]).map(r => ({ ...r, id: r.id || uid(), discountType: r.discountType || 'percent' }));
  qf.reset();
  for (const name of ['quoteNo', 'date', 'owner', 'ownerPhone', 'customer', 'contact', 'phone', 'email', 'customerTaxCode', 'customerAddress', 'notes'])
    field(name).value = data[name] ?? '';
  field('deliveryDate').value = data.deliveryDate || data.delivery_date || '';
  field('vat').value = fmtNum(Number(data.vat ?? 8));
  $('#customer-search-input').value = '';
  $('#show-cost').checked = editor.rows.some(r => Number(r.costPrice) > 0);
  qf.classList.toggle('show-cost', $('#show-cost').checked);
  setType(editor.type, false);
  $('#editor-title').textContent = id ? data.quoteNo || 'Báo giá' : 'Tạo báo giá';
  $('#editor-revision').hidden = !id; $('#editor-revision').textContent = 'Phiên bản ' + revision;
  $('#duplicate-quote').hidden = !id;
  $('#breadcrumb').textContent = id ? data.quoteNo || 'Sửa báo giá' : 'Tạo báo giá';
  $$('input, textarea', qf).forEach(i => i.classList.remove('invalid'));
  renderLines(); updateContactsButton();
  editor.dirty = false; $('#editor-dirty').hidden = true;
}
function markDirty() { if (!editor.dirty) { editor.dirty = true; $('#editor-dirty').hidden = false; } }
qf.addEventListener('input', e => {
  if (e.target.id === 'customer-search-input' || e.target.id === 'show-cost') return;
  markDirty();
  if (e.target.name === 'vat') { const v = parseNum(e.target.value); e.target.classList.toggle('invalid', !(v >= 0 && v <= 100)); calculate(); }
  if (['customer', 'phone'].includes(e.target.name)) {
    const c = state.customers?.find(x => x.id === editor.customerId);
    if (c && e.target.name === 'customer' && e.target.value.trim() !== c.name) editor.customerId = '';
    updateContactsButton();
  }
  if (e.target.name === 'quoteNo') $('#editor-title').textContent = e.target.value || 'Báo giá';
});
field('vat').addEventListener('blur', e => { const v = parseNum(e.target.value); if (v >= 0) e.target.value = fmtNum(v); });

function setType(type, dirty = true) {
  editor.type = type;
  $$('#type-seg button').forEach(b => b.setAttribute('aria-checked', String(b.dataset.value === type)));
  $('#type-hint').textContent = type === 'HRC' ? 'HRC: phí in không cộng vào giá bán.' : 'Phí in được cộng vào đơn giá sau chiết khấu.';
  qf.classList.toggle('type-hrc', type === 'HRC');
  if (dirty) { markDirty(); renderLines(); }
}
$('#type-seg').addEventListener('click', e => { const b = e.target.closest('button'); if (b && b.dataset.value !== editor.type) setType(b.dataset.value); });
$('#show-cost').addEventListener('change', e => { qf.classList.toggle('show-cost', e.target.checked); calculate(); });

// ----- dòng sản phẩm
const NUM_FIELDS = { qty: 4, price: 2, discount: 2, printFee: 2, taxRate: 2, costPrice: 2 };
function lineCell(r, i) {
  const n = (k, label, extra = '') => `<input class="num-input" inputmode="decimal" data-k="${k}" value="${k === 'taxRate' && !Number.isFinite(r.taxRate) ? '' : fmtNum(Number(r[k] || 0), NUM_FIELDS[k])}" aria-label="${label} dòng ${i + 1}" ${extra}>`;
  const hrc = editor.type === 'HRC';
  return `<tr data-i="${i}">
    <td class="col-idx">${i + 1}</td>
    <td class="col-product" data-label="Sản phẩm">
      <input data-k="name" value="${esc(r.name)}" placeholder="Tên sản phẩm" maxlength="4000" aria-label="Tên sản phẩm dòng ${i + 1}">
      <div class="sub"><input data-k="sku" value="${esc(r.sku)}" placeholder="Mã SKU" maxlength="4000" aria-label="SKU dòng ${i + 1}"></div>
    </td>
    <td class="col-unit" data-label="ĐVT"><input data-k="unit" value="${esc(r.unit)}" placeholder="cái" maxlength="40" aria-label="Đơn vị tính dòng ${i + 1}"></td>
    <td class="col-qty" data-label="Số lượng">${n('qty', 'Số lượng')}</td>
    <td class="col-price" data-label="Đơn giá">${n('price', 'Đơn giá')}</td>
    <td class="col-disc" data-label="Chiết khấu"><div class="disc-field">${n('discount', 'Chiết khấu')}<button type="button" class="disc-mode" data-mode title="Đổi giữa % và số tiền">${r.discountType === 'amount' ? '₫' : '%'}</button></div></td>
    <td class="col-print ${hrc ? 'print-off' : ''}" data-label="Phí in / sp">${n('printFee', 'Phí in', hrc ? 'title="HRC không cộng phí in vào giá bán"' : '')}</td>
    <td class="col-tax" data-label="VAT %">${n('taxRate', 'VAT riêng', 'placeholder="–" title="Để trống = dùng VAT chung"')}</td>
    <td class="col-cost cost-only" data-label="Giá vốn">${n('costPrice', 'Giá vốn')}</td>
    <td class="line-total" data-label="Thành tiền"></td>
    <td class="line-actions"><div class="act-grid">
      <button type="button" class="icon-btn" data-act="up" title="Chuyển lên" aria-label="Chuyển dòng ${i + 1} lên" ${i === 0 ? 'disabled' : ''}><svg viewBox="0 0 24 24"><path d="M18 15l-6-6-6 6"/></svg></button>
      <button type="button" class="icon-btn" data-act="down" title="Chuyển xuống" aria-label="Chuyển dòng ${i + 1} xuống" ${i === editor.rows.length - 1 ? 'disabled' : ''}><svg viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg></button>
      <button type="button" class="icon-btn" data-act="copy" title="Nhân đôi dòng" aria-label="Nhân đôi dòng ${i + 1}"><svg viewBox="0 0 24 24"><path d="M9 9h11v11H9z M5 15H4V4h11v1"/></svg></button>
      <button type="button" class="icon-btn danger" data-act="del" title="Xoá dòng" aria-label="Xoá dòng ${i + 1}"><svg viewBox="0 0 24 24"><path d="M4 7h16 M9 7V4h6v3 M6 7l1 13h10l1-13"/></svg></button>
    </div></td>
  </tr>`;
}
function renderLines(focus) {
  $('#line-list').innerHTML = editor.rows.map(lineCell).join('');
  $('#line-count').textContent = `(${editor.rows.length})`;
  calculate();
  if (focus !== undefined) $(`#line-list tr[data-i="${focus}"] [data-k="name"]`)?.focus();
}
function validateRowInput(input, r) {
  const k = input.dataset.k, v = parseNum(input.value);
  let ok = Number.isFinite(v) && v >= 0;
  if (k === 'discount') ok = ok && (r.discountType === 'amount' ? v <= Number(r.price || 0) : v <= 100);
  if (k === 'taxRate') ok = input.value.trim() === '' || (ok && v <= 100);
  input.classList.toggle('invalid', !ok);
  return ok ? v : null;
}
$('#line-list').addEventListener('input', e => {
  const input = e.target.closest('[data-k]'); if (!input) return;
  const r = editor.rows[input.closest('tr').dataset.i], k = input.dataset.k;
  if (k in NUM_FIELDS) {
    const v = validateRowInput(input, r);
    if (k === 'taxRate') { if (input.value.trim() === '') delete r.taxRate; else if (v !== null) r.taxRate = v; }
    else r[k] = v ?? 0;
    if (k === 'price') { const d = input.closest('tr').querySelector('[data-k="discount"]'); validateRowInput(d, r); }
  } else r[k] = input.value;
  input.classList.remove('invalid-name');
  calculate();
});
$('#line-list').addEventListener('focusout', e => {
  const input = e.target.closest('[data-k]'); if (!input || !(input.dataset.k in NUM_FIELDS) || input.classList.contains('invalid')) return;
  const r = editor.rows[input.closest('tr').dataset.i], k = input.dataset.k;
  if (k === 'taxRate' && !Number.isFinite(r.taxRate)) { input.value = ''; return; }
  input.value = fmtNum(Number(r[k] || 0), NUM_FIELDS[k]);
});
$('#line-list').addEventListener('focusin', e => { if (e.target.classList?.contains('num-input')) setTimeout(() => e.target.select(), 0); });
$('#line-list').addEventListener('keydown', e => {
  // Enter ở ô cuối của dòng cuối → thêm dòng mới
  if (e.key !== 'Enter' || !e.target.matches('input')) return;
  e.preventDefault();
  const tr = e.target.closest('tr'), i = Number(tr.dataset.i);
  if (i === editor.rows.length - 1) addLine(); else $(`#line-list tr[data-i="${i + 1}"] [data-k="${e.target.dataset.k}"]`)?.focus();
});
$('#line-list').addEventListener('click', async e => {
  const tr = e.target.closest('tr'); if (!tr) return;
  const i = Number(tr.dataset.i), rows = editor.rows;
  if (e.target.closest('[data-mode]')) {
    const r = rows[i];
    if (r.discountType === 'amount') { r.discountType = 'percent'; r.discount = r.price ? Math.min(100, Math.round(r.discount / r.price * 10000) / 100) : 0; }
    else { r.discountType = 'amount'; r.discount = Math.round(Number(r.price || 0) * Number(r.discount || 0) / 100); }
    markDirty(); renderLines(); return;
  }
  const act = e.target.closest('[data-act]')?.dataset.act; if (!act) return;
  if (act === 'up' && i > 0) [rows[i - 1], rows[i]] = [rows[i], rows[i - 1]];
  else if (act === 'down' && i < rows.length - 1) [rows[i + 1], rows[i]] = [rows[i], rows[i + 1]];
  else if (act === 'copy') { if (rows.length >= 300) return toast('Báo giá tối đa 300 dòng.', 'err'); rows.splice(i + 1, 0, { ...structuredClone(rows[i]), id: uid() }); }
  else if (act === 'del') {
    if (rows.length === 1) { rows[0] = blankRow(); }
    else {
      const r = rows[i];
      if ((r.name || r.price) && !await confirmBox(`Xoá dòng "${r.name || 'sản phẩm ' + (i + 1)}"?`, { ok: 'Xoá', danger: true })) return;
      rows.splice(i, 1);
    }
  } else return;
  markDirty(); renderLines();
});
function addLine() {
  if (editor.rows.length >= 300) return toast('Báo giá tối đa 300 dòng.', 'err');
  editor.rows.push(blankRow()); markDirty(); renderLines(editor.rows.length - 1);
}
$('#add-line').addEventListener('click', addLine);

function currentDoc() {
  return { type: editor.type, vat: parseNum(field('vat').value) || 0, rows: editor.rows, shipping: editor.base.shipping, printing: editor.base.printing };
}
function calculate() {
  const doc = currentDoc(), t = totals(doc);
  editor.rows.forEach((r, i) => {
    const cell = $(`#line-list tr[data-i="${i}"] .line-total`); if (!cell) return;
    const unit = after(r, doc), line = unit * Number(r.qty || 0);
    const disc = Number(r.discount) > 0 ? discounted(r) : null;
    cell.innerHTML = money(line) + (disc !== null || (Number(r.printFee) > 0 && doc.type !== 'HRC') ? `<small>${money(unit)}/sp</small>` : '');
  });
  $('#sum-subtotal').textContent = money(t.subtotal);
  $('#sum-tax-label').textContent = t.label;
  $('#sum-tax').textContent = money(t.tax);
  $('#sum-total').textContent = $('#m-total').textContent = money(t.total);
  $('#words-total').textContent = t.total > 0 ? 'Bằng chữ: ' + moneyWords(t.total) + '.' : '';
  if ($('#show-cost').checked) {
    const p = profit(doc);
    $('#sum-cost').textContent = money(p.cost);
    $('#sum-gross').textContent = money(p.gross); $('#sum-gross').className = p.gross >= 0 ? 'pos' : 'neg';
    $('#sum-margin').textContent = fmtNum(p.margin, 1) + '%';
  }
  return t;
}

// ----- khách hàng trong báo giá
const suggest = $('#customer-suggest'), searchInput = $('#customer-search-input');
let suggestIndex = -1, suggestItems = [];
function showSuggest() {
  const q = normalize(searchInput.value);
  suggestItems = (state.customers || []).filter(c => !q || normalize(`${c.name} ${c.contact} ${c.phone} ${c.taxCode} ${c.customerCode}`).includes(q)).slice(0, 8);
  suggestIndex = suggestItems.length ? 0 : -1;
  suggest.innerHTML = suggestItems.length
    ? suggestItems.map((c, i) => `<li role="option" data-i="${i}" aria-selected="${i === suggestIndex}"><b>${esc(c.name)}</b><small>${esc([c.contact, c.phone, c.taxCode && 'MST ' + c.taxCode].filter(Boolean).join(' · ') || c.address || '')}</small></li>`).join('')
    : `<li class="none">${state.customers?.length ? 'Không tìm thấy. Nhập thông tin bên dưới rồi bấm "Lưu vào danh bạ".' : 'Danh bạ đang trống.'}</li>`;
  suggest.hidden = false; searchInput.setAttribute('aria-expanded', 'true');
}
function hideSuggest() { suggest.hidden = true; searchInput.setAttribute('aria-expanded', 'false'); }
function pickCustomer(c) {
  editor.customerId = c.id;
  field('customer').value = c.name; field('contact').value = c.contact || ''; field('phone').value = c.phone || '';
  field('email').value = c.email || ''; field('customerTaxCode').value = c.taxCode || ''; field('customerAddress').value = c.address || '';
  editor.base.customerCode = c.customerCode || '';
  searchInput.value = ''; hideSuggest(); markDirty(); updateContactsButton();
  toast('Đã điền thông tin ' + c.name);
}
searchInput.addEventListener('focus', showSuggest);
searchInput.addEventListener('input', showSuggest);
searchInput.addEventListener('blur', () => setTimeout(hideSuggest, 150));
searchInput.addEventListener('keydown', e => {
  if (suggest.hidden) return;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault(); if (!suggestItems.length) return;
    suggestIndex = (suggestIndex + (e.key === 'ArrowDown' ? 1 : -1) + suggestItems.length) % suggestItems.length;
    $$('li', suggest).forEach((li, i) => li.setAttribute('aria-selected', String(i === suggestIndex)));
  } else if (e.key === 'Enter') { e.preventDefault(); if (suggestItems[suggestIndex]) pickCustomer(suggestItems[suggestIndex]); }
  else if (e.key === 'Escape') hideSuggest();
});
suggest.addEventListener('mousedown', e => { const li = e.target.closest('li[data-i]'); if (li) { e.preventDefault(); pickCustomer(suggestItems[li.dataset.i]); } });
function updateContactsButton() {
  const name = field('customer').value.trim();
  const known = editor.customerId || (state.customers || []).some(c => normalize(c.name) === normalize(name));
  $('#save-to-contacts').hidden = !name || known;
}
$('#save-to-contacts').addEventListener('click', async () => {
  const body = { name: field('customer').value.trim(), contact: field('contact').value.trim(), phone: field('phone').value.trim().slice(0, 40), email: field('email').value.trim(), taxCode: field('customerTaxCode').value.trim(), address: field('customerAddress').value.trim() };
  const btn = $('#save-to-contacts'); btn.disabled = true;
  try {
    const { id } = await api('/customers', 'POST', body);
    editor.customerId = id; markDirty();
    state.customers = [...(state.customers || []), { id, ...body }].sort((a, b) => a.name.localeCompare(b.name, 'vi'));
    renderCustomers(); renderStats(); updateContactsButton();
    toast('Đã lưu ' + body.name + ' vào danh bạ.');
  } catch (e) { toast(e.message, 'err'); }
  finally { btn.disabled = false; }
});

// ----- dán từ Excel
function parsePaste(text) {
  return text.split(/\r?\n/).map(l => l.split('\t').map(s => s.trim())).filter(c => c.some(Boolean)).map(c => {
    const [name = '', sku = '', unit = '', qty = '1', price = '0'] = c;
    const q = parseNum(qty), p = parseNum(price);
    return { ...blankRow(), name, sku, unit, qty: q >= 0 ? q : 1, price: p >= 0 ? p : 0 };
  });
}
$('#paste-lines').addEventListener('click', () => { $('#paste-text').value = ''; $('#paste-preview').textContent = ''; $('#paste-dialog').showModal(); });
$('#paste-text').addEventListener('input', e => {
  const rows = parsePaste(e.target.value);
  $('#paste-preview').textContent = rows.length ? `Nhận được ${rows.length} dòng · tổng ${money(rows.reduce((s, r) => s + r.qty * r.price, 0))} (trước chiết khấu).` : '';
});
$('#paste-form').addEventListener('submit', e => {
  e.preventDefault();
  const rows = parsePaste($('#paste-text').value);
  if (!rows.length) { $('#paste-preview').textContent = 'Chưa có dòng nào. Hãy dán dữ liệu sao chép từ Excel.'; return; }
  const keep = editor.rows.filter(r => r.name || Number(r.price));
  if (keep.length + rows.length > 300) { $('#paste-preview').textContent = 'Báo giá tối đa 300 dòng.'; return; }
  editor.rows = [...keep, ...rows];
  $('#paste-dialog').close(); markDirty(); renderLines();
  toast(`Đã thêm ${rows.length} sản phẩm.`);
});

// ----- lưu
function collectQuote() {
  const f = name => field(name).value.trim();
  const data = { ...editor.base };
  delete data.delivery_date;
  Object.assign(data, {
    type: editor.type, quoteNo: f('quoteNo'), date: f('date'), vat: parseNum(field('vat').value),
    customer: f('customer'), customerId: editor.customerId || '', contact: f('contact'), phone: f('phone'), email: f('email'),
    customerTaxCode: f('customerTaxCode'), customerAddress: f('customerAddress'), owner: f('owner'), ownerPhone: f('ownerPhone'),
    notes: field('notes').value,
    rows: editor.rows.filter(r => (r.name || '').trim() || Number(r.price) || (r.sku || '').trim()).map(r => {
      const row = { ...r, name: (r.name || '').trim(), sku: (r.sku || '').trim(), unit: (r.unit || '').trim() };
      if (!$('#show-cost').checked && !(Number(r.costPrice) > 0)) delete row.costPrice;
      if (!Number.isFinite(row.taxRate)) delete row.taxRate;
      return row;
    }),
  });
  if (f('deliveryDate')) data.deliveryDate = f('deliveryDate'); else delete data.deliveryDate;
  return data;
}
function validateQuote(data) {
  const problems = [];
  const mark = (name, bad) => { field(name).classList.toggle('invalid', bad); if (bad) problems.push(name); };
  mark('quoteNo', !data.quoteNo); mark('customer', !data.customer); mark('date', !data.date);
  mark('vat', !(data.vat >= 0 && data.vat <= 100));
  if (problems.length) return 'Vui lòng điền đủ các ô được đánh dấu đỏ.';
  if (!data.rows.length) return 'Vui lòng thêm ít nhất một sản phẩm.';
  if ($$('#line-list input.invalid').length) return 'Có số liệu sản phẩm chưa hợp lệ (ô đỏ). Chiết khấu % tối đa 100, chiết khấu tiền không vượt đơn giá.';
  const unnamed = data.rows.findIndex(r => !r.name);
  if (unnamed >= 0) return `Dòng sản phẩm số ${editor.rows.indexOf(editor.rows.find(r => r.id === data.rows[unnamed].id)) + 1} chưa có tên.`;
  return '';
}
let saving = false;
async function saveQuote() {
  if (saving) return;
  const err = $('#quote-error'); err.textContent = '';
  const data = collectQuote(), problem = validateQuote(data);
  if (problem) { err.textContent = problem; toast(problem, 'err'); qf.querySelector('.invalid')?.focus(); return; }
  saving = true; $('#save-quote').disabled = $('#save-quote-m').disabled = true;
  try {
    const saved = editor.id
      ? await api('/quotes/' + encodeURIComponent(editor.id), 'PUT', { revision: editor.revision, data })
      : await api('/quotes', 'POST', data);
    const wasNew = !editor.id;
    fillEditor(saved.id, saved.revision, saved.data);
    if (wasNew) { suppressHash = true; location.hash = '#/quotes/' + encodeURIComponent(saved.id); currentHash = location.hash; }
    toast(wasNew ? 'Đã tạo báo giá ' + saved.data.quoteNo : 'Đã lưu phiên bản ' + saved.revision);
    loadQuotes();
  } catch (e) {
    if (e.status === 409) {
      $('#conflict-text').textContent = e.message + ' Thay đổi của anh/chị chưa được lưu.';
      $('#conflict-banner').hidden = false; $('#conflict-banner').scrollIntoView({ behavior: 'smooth', block: 'center' });
    } else { err.textContent = e.message; toast(e.message, 'err'); }
  } finally { saving = false; $('#save-quote').disabled = $('#save-quote-m').disabled = false; }
}
qf.addEventListener('submit', e => { e.preventDefault(); saveQuote(); });
$('#save-quote-m').addEventListener('click', e => { e.preventDefault(); saveQuote(); });
$('#reload-quote').addEventListener('click', async () => {
  if (!await confirmBox('Tải bản mới nhất sẽ bỏ các thay đổi chưa lưu của anh/chị.', { ok: 'Tải lại', danger: true })) return;
  editor.dirty = false; openEditor(editor.id);
});
document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's' && !$('#view-editor').hidden) { e.preventDefault(); saveQuote(); }
  if (e.key === '/' && !e.target.closest('input, textarea, select') && !document.querySelector('dialog[open]')) {
    const s = $('#view-quotes').hidden ? ($('#view-customers').hidden ? $('#member-search') : $('#customer-search')) : $('#quote-search');
    if (s && !s.closest('[hidden]')) { e.preventDefault(); s.focus(); }
  }
});

// ----- nhân bản
function cloneData(data) {
  const copy = structuredClone(data);
  delete copy.contractDocument; delete copy.careStatus; delete copy.careDueDate; delete copy.careClosedAt;
  return { ...copy, quoteNo: nextQuoteNo(), date: todayIso(), rows: copy.rows.map(r => ({ ...r, id: uid() })) };
}
$('#duplicate-quote').addEventListener('click', async () => {
  if (editor.dirty && !await confirmBox('Báo giá hiện tại có thay đổi chưa lưu. Bản sao sẽ gồm cả các thay đổi này, còn báo giá gốc không được lưu.', { ok: 'Tiếp tục' })) return;
  editor.pending = cloneData(collectQuote()); editor.dirty = false;
  go('#/quotes/new'); toast('Đã tạo bản sao. Kiểm tra rồi bấm Lưu.');
});
async function duplicateFromList(id) {
  try { const q = await api('/quotes/' + encodeURIComponent(id)); editor.pending = cloneData(q.data); go('#/quotes/new'); toast('Đã tạo bản sao ' + q.data.quoteNo + '. Kiểm tra rồi bấm Lưu.'); }
  catch (e) { toast(e.message, 'err'); }
}

// ----- in / PDF
$('#print-quote').addEventListener('click', () => {
  const d = collectQuote();
  if (!d.rows.length) { toast('Chưa có sản phẩm để in.', 'err'); return; }
  const doc = { type: d.type, vat: d.vat, rows: d.rows }, t = totals(doc);
  const showPrint = d.type !== 'HRC' && d.rows.some(r => Number(r.printFee) > 0);
  const showDisc = d.rows.some(r => Number(r.discount) > 0);
  const showTax = new Set(d.rows.map(r => Number.isFinite(r.taxRate) ? r.taxRate : d.vat)).size > 1;
  const cols = 6 + (showDisc ? 1 : 0) + (showPrint ? 1 : 0) + (showTax ? 1 : 0);
  $('#print-sheet').innerHTML = `
    <div class="ps-head">
      <div class="ps-brand"><span class="ps-mark">BN</span><div><b>BÁCH NGÂN</b><br><small>Quà tặng doanh nghiệp</small></div></div>
      <div class="ps-meta">Số: <b>${esc(d.quoteNo)}</b><br>Ngày: ${fmtDate(d.date)}${d.deliveryDate ? `<br>Giao dự kiến: ${fmtDate(d.deliveryDate)}` : ''}</div>
    </div>
    <h1>BẢNG BÁO GIÁ</h1>
    <p class="ps-sub">Kính gửi: ${esc(d.customer)}</p>
    <div class="ps-info">
      ${d.contact ? `<p>Người liên hệ: <b>${esc(d.contact)}</b></p>` : ''}${d.phone ? `<p>Điện thoại: ${esc(d.phone)}</p>` : ''}
      ${d.email ? `<p>Email: ${esc(d.email)}</p>` : ''}${d.customerTaxCode ? `<p>MST: ${esc(d.customerTaxCode)}</p>` : ''}
      ${d.customerAddress ? `<p style="grid-column:1/-1">Địa chỉ: ${esc(d.customerAddress)}</p>` : ''}
    </div>
    <table class="ps-table">
      <thead><tr><th>STT</th><th>Sản phẩm</th><th>ĐVT</th><th>SL</th><th>Đơn giá</th>${showDisc ? '<th>Chiết khấu</th>' : ''}${showPrint ? '<th>Phí in</th>' : ''}${showTax ? '<th>VAT</th>' : ''}<th>Thành tiền</th></tr></thead>
      <tbody>${d.rows.map((r, i) => `<tr>
        <td class="c">${i + 1}</td><td>${esc(r.name)}${r.sku ? `<br><small>Mã: ${esc(r.sku)}</small>` : ''}</td><td class="c">${esc(r.unit)}</td>
        <td class="n">${fmtNum(Number(r.qty), 4)}</td><td class="n">${money(r.price)}</td>
        ${showDisc ? `<td class="n">${Number(r.discount) > 0 ? (r.discountType === 'amount' ? money(r.discount) : fmtNum(Number(r.discount)) + '%') : ''}</td>` : ''}
        ${showPrint ? `<td class="n">${Number(r.printFee) > 0 ? money(r.printFee) : ''}</td>` : ''}
        ${showTax ? `<td class="n">${fmtNum(Number.isFinite(r.taxRate) ? r.taxRate : d.vat)}%</td>` : ''}
        <td class="n">${money(after(r, doc) * Number(r.qty || 0))}</td></tr>`).join('')}
        <tr class="ps-total"><td colspan="${cols - 1}" class="n">Cộng tiền hàng</td><td class="n">${money(t.subtotal)}</td></tr>
        <tr class="ps-total"><td colspan="${cols - 1}" class="n">${esc(t.label)}</td><td class="n">${money(t.tax)}</td></tr>
        <tr class="ps-total grand"><td colspan="${cols - 1}" class="n">TỔNG CỘNG</td><td class="n">${money(t.total)}</td></tr>
      </tbody>
    </table>
    <p class="ps-words">Bằng chữ: ${esc(moneyWords(t.total))}.</p>
    ${d.notes.trim() ? `<div class="ps-notes"><b>Ghi chú:</b>\n${esc(d.notes.trim())}</div>` : ''}
    <div class="ps-sign"><div><p><b>XÁC NHẬN CỦA KHÁCH HÀNG</b></p><p><i>(Ký, ghi rõ họ tên)</i></p><div class="space"></div></div>
      <div><p><b>NGƯỜI LẬP BÁO GIÁ</b></p><p><i>(Ký, ghi rõ họ tên)</i></p><div class="space"></div><p><b>${esc(d.owner)}</b>${d.ownerPhone ? `<br>${esc(d.ownerPhone)}` : ''}</p></div></div>`;
  const title = document.title; document.title = `Bao-gia-${d.quoteNo}`.replace(/[^\w.-]+/g, '-');
  window.print(); document.title = title;
});

// ---------------------------------------------------------------- khách hàng
let customerId = null;
function quoteCountByCustomer() {
  const m = new Map();
  for (const q of state.quotes || []) { const k = normalize(q.customer); m.set(k, (m.get(k) || 0) + 1); }
  return m;
}
function renderCustomers() {
  const tbody = $('#customer-list');
  if (!state.customers) { tbody.innerHTML = skeleton(6); return; }
  const q = normalize(state.customerQuery), counts = quoteCountByCustomer();
  const list = state.customers.filter(c => !q || normalize(`${c.name} ${c.contact} ${c.phone} ${c.email} ${c.taxCode} ${c.customerCode}`).includes(q));
  $('#customer-count').textContent = `${list.length}/${state.customers.length} khách hàng`;
  tbody.innerHTML = list.map(c => `
    <tr>
      <td class="first"><span class="strong">${esc(c.name)}</span>${c.address ? `<small>${esc(c.address)}</small>` : ''}</td>
      <td data-label="Liên hệ">${esc(c.contact) || '—'}</td>
      <td data-label="ĐT">${c.phone ? `<a href="tel:${esc(c.phone.replace(/[^\d+]/g, ''))}">${esc(c.phone)}</a>` : '—'}</td>
      <td data-label="Email · MST">${esc(c.email) || '—'}${c.taxCode ? `<small>MST ${esc(c.taxCode)}</small>` : ''}</td>
      <td class="right" data-label="Báo giá">${counts.get(normalize(c.name)) || 0}</td>
      <td class="actions-cell"><div class="row-actions">
        <button class="btn ghost small" data-quote-for="${esc(c.id)}" title="Tạo báo giá cho khách này">＋ Báo giá</button>
        <button class="icon-btn" data-edit-customer="${esc(c.id)}" title="Sửa" aria-label="Sửa ${esc(c.name)}"><svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16z M14 6l4 4"/></svg></button>
      </div></td>
    </tr>`).join('');
  const none = state.customers.length === 0;
  $('#customer-empty').hidden = list.length > 0;
  $('#customer-empty-title').textContent = none ? 'Chưa có khách hàng' : 'Không tìm thấy khách hàng';
  $('#customer-empty-text').textContent = none ? 'Thêm khách hàng để chọn nhanh khi lập báo giá.' : 'Thử từ khoá khác.';
  $('#customer-table').hidden = list.length === 0;
}
$('#customer-search').addEventListener('input', e => { state.customerQuery = e.target.value; renderCustomers(); });
$('#customer-list').addEventListener('click', e => {
  const edit = e.target.closest('[data-edit-customer]'); if (edit) return openCustomer(edit.dataset.editCustomer);
  const qb = e.target.closest('[data-quote-for]');
  if (qb) {
    const c = state.customers.find(x => x.id === qb.dataset.quoteFor);
    editor.pending = newQuoteData({ customerId: c.id, customer: c.name, contact: c.contact || '', phone: c.phone || '', email: c.email || '', customerTaxCode: c.taxCode || '', customerAddress: c.address || '', customerCode: c.customerCode || '' });
    go('#/quotes/new');
  }
});
function openCustomer(id) {
  customerId = id || null;
  const form = $('#customer-form'); form.reset(); $('#customer-error').textContent = '';
  const c = id ? state.customers.find(x => x.id === id) : null;
  if (c) for (const k of ['name', 'contact', 'phone', 'email', 'taxCode', 'customerCode', 'address']) form.elements.namedItem(k).value = c[k] || '';
  $('#customer-dialog-title').textContent = c ? 'Sửa khách hàng' : 'Thêm khách hàng';
  $('#customer-dialog').showModal();
}
$('#new-customer').addEventListener('click', () => openCustomer());
$('#customer-form').addEventListener('submit', async e => {
  e.preventDefault();
  const data = Object.fromEntries([...new FormData(e.target)].map(([k, v]) => [k, String(v).trim()]));
  const err = $('#customer-error'); err.textContent = '';
  if (!data.name) { err.textContent = 'Vui lòng nhập tên khách hàng.'; e.target.elements.name.focus(); return; }
  if (data.email && !/^\S+@\S+\.\S+$/.test(data.email)) { err.textContent = 'Email chưa đúng định dạng.'; return; }
  const btn = $('#save-customer'); btn.disabled = true;
  try {
    await api(customerId ? '/customers/' + encodeURIComponent(customerId) : '/customers', customerId ? 'PUT' : 'POST', data);
    $('#customer-dialog').close(); toast(customerId ? 'Đã cập nhật khách hàng.' : 'Đã thêm ' + data.name + '.');
    await loadCustomers();
  } catch (ex) { err.textContent = ex.message; }
  finally { btn.disabled = false; }
});

// ---------------------------------------------------------------- nhân viên (Manager)
const memberStatus = m => !m.active ? 'locked' : !m.activated ? 'pending' : 'active';
const STATUS_PILL = { active: '<span class="pill ok">Đang hoạt động</span>', pending: '<span class="pill warn">Chờ kích hoạt</span>', locked: '<span class="pill off">Đã khoá</span>' };
function renderMembers() {
  const tbody = $('#member-list');
  if (!state.members) { tbody.innerHTML = skeleton(5); return; }
  const pos = new Map(state.positions.map(p => [p.id, p.name])), q = normalize(state.memberQuery);
  const list = state.members.filter(m => (!state.memberStatus || memberStatus(m) === state.memberStatus) && (!q || normalize(`${m.name} ${m.email} ${m.phone}`).includes(q)));
  tbody.innerHTML = list.map(m => {
    const self = m.id === state.user.id, st = memberStatus(m);
    return `<tr>
      <td class="first"><span class="row-gap"><span class="avatar">${esc(initials(m.name))}</span><span><span class="strong">${esc(m.name)}</span>${self ? ' <span class="pill blue">Bạn</span>' : ''}<small>${esc(m.email)}</small></span></span></td>
      <td data-label="ĐT">${esc(m.phone) || '—'}</td>
      <td data-label="Chức vụ">${esc(pos.get(m.positionId) || m.positionId)}${m.role === 'manager' ? ' <span class="pill">Manager</span>' : ''}</td>
      <td>${STATUS_PILL[st]}</td>
      <td class="actions-cell"><div class="row-actions">${self ? '' : `
        ${st !== 'locked' ? `<button class="btn ghost small" data-reset="${esc(m.id)}" title="Cấp liên kết đặt lại mật khẩu">${st === 'pending' ? 'Gửi lại liên kết' : 'Đặt lại mật khẩu'}</button>` : ''}
        <button class="icon-btn" data-edit-member="${esc(m.id)}" title="Sửa" aria-label="Sửa ${esc(m.name)}"><svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16z M14 6l4 4"/></svg></button>
        ${st === 'locked'
          ? `<button class="btn ghost small" data-unlock="${esc(m.id)}">Mở khoá</button>`
          : `<button class="icon-btn danger" data-lock="${esc(m.id)}" title="Khoá tài khoản" aria-label="Khoá ${esc(m.name)}"><svg viewBox="0 0 24 24"><path d="M6 11h12v9H6z M8 11V8a4 4 0 0 1 8 0v3"/></svg></button>`}`}
      </div></td>
    </tr>`;
  }).join('');
  $('#member-empty').hidden = list.length > 0;
  $('#member-table').hidden = list.length === 0;
}
$('#member-search').addEventListener('input', e => { state.memberQuery = e.target.value; renderMembers(); });
$('#member-filter').addEventListener('click', e => {
  const chip = e.target.closest('.chip'); if (!chip) return;
  $$('#member-filter .chip').forEach(c => c.classList.toggle('active', c === chip));
  state.memberStatus = chip.dataset.status; renderMembers();
});
let memberId = null;
function openMember(id) {
  memberId = id || null;
  const form = $('#member-form'), m = id ? state.members.find(x => x.id === id) : null;
  form.reset(); $('#member-error').textContent = '';
  $('#member-position').innerHTML = state.positions.map(p => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('');
  if (m) { for (const k of ['name', 'email', 'phone', 'positionId']) form.elements.namedItem(k).value = m[k] || ''; form.elements.active.checked = !!m.active; }
  else form.elements.positionId.value = state.positions.find(p => p.id === 'sale')?.id || state.positions[0]?.id || '';
  $('#member-active-row').hidden = !m;
  $('#member-note').hidden = !!m;
  $('#member-dialog-title').textContent = m ? 'Sửa nhân viên' : 'Thêm nhân viên';
  $('#save-member').textContent = m ? 'Lưu thay đổi' : 'Tạo tài khoản';
  $('#member-dialog').showModal();
}
$('#new-member').addEventListener('click', () => openMember());
$('#member-form').addEventListener('submit', async e => {
  e.preventDefault();
  const form = e.target, err = $('#member-error'); err.textContent = '';
  const v = k => form.elements.namedItem(k).value.trim();
  const body = { name: v('name'), email: v('email'), phone: v('phone'), positionId: v('positionId') };
  if (!body.name || !/^\S+@\S+\.\S+$/.test(body.email)) { err.textContent = 'Nhập họ tên và địa chỉ email hợp lệ.'; return; }
  if (!body.phone) { err.textContent = 'Vui lòng nhập số điện thoại nhân viên.'; return; }
  const btn = $('#save-member'); btn.disabled = true;
  try {
    if (memberId) {
      const m = state.members.find(x => x.id === memberId);
      await api('/admin/member', 'PUT', { id: memberId, ...body, role: m.role, active: form.elements.active.checked });
      $('#member-dialog').close(); toast('Đã cập nhật ' + body.name + '.');
    } else {
      const res = await api('/admin/members', 'POST', body);
      $('#member-dialog').close();
      showLink(res.url, 'Đã tạo tài khoản', `Gửi liên kết này cho ${body.name} để đặt mật khẩu. Liên kết chỉ dùng một lần và hết hạn sau 15 phút.`);
    }
    loadMembers();
  } catch (ex) { err.textContent = ex.message; }
  finally { btn.disabled = false; }
});
$('#member-list').addEventListener('click', async e => {
  const t = e.target.closest('[data-edit-member],[data-reset],[data-lock],[data-unlock]'); if (!t) return;
  const id = t.dataset.editMember || t.dataset.reset || t.dataset.lock || t.dataset.unlock, m = state.members.find(x => x.id === id);
  if (t.dataset.editMember) return openMember(id);
  try {
    if (t.dataset.reset) {
      if (!await confirmBox(`Cấp liên kết đặt mật khẩu mới cho ${m.name}? Mật khẩu cũ sẽ hết hiệu lực và ${m.name} bị đăng xuất khỏi mọi thiết bị.`, { ok: 'Cấp liên kết' })) return;
      const res = await api('/admin/reset', 'POST', { id });
      showLink(res.url, 'Liên kết đặt mật khẩu', `Gửi liên kết này cho ${m.name}. Liên kết chỉ dùng một lần và hết hạn sau 15 phút.`);
    } else if (t.dataset.lock) {
      if (!await confirmBox(`Khoá tài khoản ${m.name}? Người này sẽ bị đăng xuất và không đăng nhập được nữa.`, { title: 'Khoá tài khoản', ok: 'Khoá', danger: true })) return;
      await api('/admin/member', 'DELETE', { id }); toast('Đã khoá ' + m.name + '.');
    } else if (t.dataset.unlock) {
      await api('/admin/member', 'PUT', { id, name: m.name, email: m.email, phone: m.phone, positionId: m.positionId, role: m.role, active: true });
      toast('Đã mở khoá ' + m.name + '.');
    }
    loadMembers();
  } catch (ex) { toast(ex.message, 'err'); }
});
function showLink(url, title, text) {
  $('#link-title').textContent = title; $('#link-text').textContent = text; $('#link-value').value = url;
  $('#copy-link').textContent = 'Sao chép';
  $('#link-dialog').showModal(); $('#link-value').select();
}
$('#copy-link').addEventListener('click', async () => {
  const input = $('#link-value');
  try { await navigator.clipboard.writeText(input.value); } catch { input.select(); document.execCommand('copy'); }
  $('#copy-link').textContent = 'Đã chép ✓';
});

// ---------------------------------------------------------------- khởi động
$('#today').textContent = new Date().toLocaleDateString('vi-VN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
renderQuotes(); renderCustomers();
if (activation) { setupActivationForm(); showAuth(); }
else if (token) enter().catch(e => showAuth(e.status === 401 ? 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.' : e.message));
else showAuth();
