import { installBusyButtons, withBusy } from './busy-buttons.js';
import { bindCustomerDuplicateCheck } from './customer-duplicate-check.js';
import { initReceivingCalendar } from './receiving-calendar.js';
import { documentSequence, nextDocumentNumber } from './document-number.js';
import { orderRecipient } from './order-notes.js';
import { customerFormFields } from './customer-form-fields.js';
import { initPackingSupplierChoices } from './packing-supplier-choices.js';
import { initPackingEarlyRequest } from './packing-early-request.js';
import { reviewPurchaseCosts } from './purchase-cost-review.js';
import { confirmApprovalDebt, reviewOrderCosts } from './approval-preflight.js';
import { openPosOrderFlows } from './pos-order-flow.js';
import { openPosReturns } from './pos-returns.js';
import { openBarcodeImport } from './barcode-import.js';
import { posOrderEditor, posCodReceipt, posPaymentText } from './pos-order-edit.js';
import { renderOrderLineDetails } from './order-line-details.js';
import { initCash } from './cash.js';
import { initPos } from './pos.js';
import { shortageRows, downloadShortagePdf } from './stock-shortage-pdf.js';
import { bindStockCheckFilter } from './stock-check-filter.js';
import { downloadExcel } from './sheet-export.js';
import { orderSapoAction } from './order-sapo.js';
import { initOrderPrintForm } from './order-print-form.js';
import { initOrderCreate } from './order-create.js';
import { initDashboard } from './dashboard.js';
import { initFlowMap } from './flow-map.js';
import { initSuppliers } from './suppliers.js';
import { initPurchases } from './purchases.js';
// Bách Ngân · Báo giá – giao diện dùng thử v2 (JS thuần, không cần build).
// Tính tiền dùng đúng hàm của máy chủ: quote-math.js được sinh từ src/modules/quotes/domain/quote-math.ts.
import { hydrateSnapshot, searchProducts as searchCatalog } from './product-search.js';
import { defaultPaymentTerms, withPaymentNotes } from './quote-payment.js';
import { setupNotifications } from './notify.js';
import { setupDataRefresh } from './auto-refresh.js';
import { printSheet } from './print-page.js';
import { createPager } from './pager.js';
import { showAudit } from './audit-ui.js';
import { watchCsp } from './csp-report.js';
import { verifyBox, duePill, allocatePayments, installmentStatus } from './verify.js';
import { orderReference, orderPrintData, orderSheetHtml, readEdits, downloadOrderExcel, sellerOf, SELLERS, SLIP_KINDS, packingPrintData, deliveryPrintData, slipSheetHtml } from './order-print.js';
import { openContractDocs } from './contract-ui.js';
import { initTasks } from './tasks.js';
import { initCare } from './care.js';
import { initChat } from './chat.js';
import { setupPulse } from './pulse.js';
import { initInventory } from './inventory.js';
import { initTransfers, initStockMoves, initSellerConfig } from './stock-ops.js';
import { initPermissions } from './permissions.js';
import { initKhoHome, initStockLookup } from './kho.js';
import { initCustomerDetail } from './customer-detail.js';
import { initProductAdmin } from './product-admin.js';
import { initProductActions } from './product-actions.js';
import { openSapoStockImport } from './sapo-stock-import.js';
import { initSapoPush } from './sapo-push.js';
import { initAvatars, avAttr, pickAvatar, primeAvatar } from './avatars.js';
import { initMemberDetail } from './member-detail.js';
import { initPayroll } from './payroll.js';
import { totals, after, profit, commissionOf, discounted, normalize, netPrice, defaultCostDiscount, purchasePrice, costModeOf, parsePurchaseCost, applyPurchaseCost, syncPurchaseCost, printingInfo, customerDiscount, printingWorkshops as DEFAULT_WORKSHOPS, brandDiscountKey } from './quote-math.js';
installBusyButtons(); // nút gửi API ghi tự khoá + vòng xoay đang xử lý (busy-buttons.js)

const API = document.querySelector('meta[name="bn-api"]')?.content
  || 'https://taceqfnsorewelsbdckg.supabase.co/functions/v1/baogia-v2-api/api/staff';
const SESSION_KEY = 'bn-v2-session';

// ---------------------------------------------------------------- tiện ích
const $ = s => document.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const esc = v => String(v ?? '').normalize('NFC').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
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

// ---------------------------------------------------------------- hình ảnh
// Ảnh Google Drive: dùng ảnh thu nhỏ (link chia sẻ /file/d/<id> không hiển thị trực tiếp được), lỗi thì thử lh3.
const driveId = v => (String(v || '').match(/\/d\/([\w-]{10,})/) || String(v || '').match(/[?&]id=([\w-]{10,})/) || [])[1] || '';
const isDrive = v => { try { const h = new URL(v).hostname; return h === 'drive.google.com' || h === 'docs.google.com'; } catch { return false; } };
const displayImage = v => { const s = String(v || '').trim(), id = isDrive(s) && driveId(s); return id ? `https://drive.google.com/thumbnail?id=${id}&sz=w600` : s; };
const fallbackImage = v => { const id = isDrive(v) && driveId(v); return id ? `https://lh3.googleusercontent.com/d/${id}=w600` : ''; };
const PLACEHOLDER = '<svg viewBox="0 0 24 24"><path d="M4 5h16v14H4z M4 15l4-4 4 4 3-3 5 5 M15 9h.01"/></svg>';
/** Ảnh được phép lưu trong báo giá (như máy chủ kiểm tra): https hoặc ảnh JPEG/PNG/WebP nhúng. */
const savableImage = v => /^https:\/\//i.test(v || '') || /^data:image\/(jpeg|png|webp);base64,[a-z0-9+/=]+$/i.test(v || '');
// Chỉ nhận ảnh https:// hoặc data:image (như trang khách) – ảnh từ Sapo / file nhập có thể là URL bất kỳ.
const imgTag = (url, cls = 'thumb') => /^(https:\/\/|data:image\/)/i.test(url || '')
  ? `<img class="${cls}" src="${esc(displayImage(url))}" data-fallback="${esc(fallbackImage(url))}" alt="" loading="lazy" referrerpolicy="no-referrer">`
  : `<span class="${cls}">${PLACEHOLDER}</span>`;
// Ảnh lỗi: thử nguồn dự phòng một lần, sau đó thay bằng biểu tượng.
document.addEventListener('error', e => {
  const img = e.target;
  if (!(img instanceof HTMLImageElement) || !img.classList.contains('thumb')) return;
  if (img.dataset.fallback) { img.src = img.dataset.fallback; img.dataset.fallback = ''; return; }
  const span = document.createElement('span'); span.className = img.className + ' broken'; span.title = 'Không tải được ảnh'; span.innerHTML = PLACEHOLDER;
  img.replaceWith(span);
}, true);
/** Thu nhỏ ảnh tải lên thành JPEG (mặc định cạnh dài ≤ 800px, ≤ ~180 KB) để lưu trong báo giá. */
function compressImage(file, steps = [[800, .8], [640, .72], [480, .65], [360, .6]], limit = 240000, tooBig = 'Ảnh quá lớn. Vui lòng dùng link ảnh Google Drive.') {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Không đọc được file ảnh.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('File không phải ảnh hợp lệ.'));
      img.onload = () => {
        for (const [max, q] of steps) {
          const scale = Math.min(1, max / Math.max(img.width, img.height)), c = document.createElement('canvas');
          c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
          const url = c.toDataURL('image/jpeg', q);
          if (url.length <= limit) return resolve(url);
        }
        reject(new Error(tooBig));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

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
// Lỗi giao diện ngoài dự kiến: hiện lên màn hình để người dùng chụp gửi lại (không im lặng).
let lastUiError = '';
function reportUiError(err) {
  const msg = String(err?.message || err || 'Lỗi không rõ');
  if (msg === lastUiError || /ResizeObserver|Script error/i.test(msg)) return;
  lastUiError = msg; setTimeout(() => { lastUiError = ''; }, 5000);
  toast('Lỗi giao diện: ' + msg, 'err');
}
window.addEventListener('error', e => { if (e.error || e.message) reportUiError(e.error || e.message); });
window.addEventListener('unhandledrejection', e => reportUiError(e.reason));
/**
 * Hộp xác nhận. Chống bấm nhầm cho thao tác xoá / huỷ (`danger`):
 *  - con trỏ đặt sẵn ở nút "Không" (Enter / chạm đúp không xoá nhầm);
 *  - nút xoá khoá `delay` ms đầu (đếm ngược) để kịp đọc;
 *  - `typeToConfirm`: phải gõ đúng mã (vd số báo giá) mới bấm được – dùng cho dữ liệu quan trọng, không khôi phục được.
 */
const foldText = v => String(v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd').toLowerCase().replace(/\s+/g, '');
function confirmBox(text, { title = 'Xác nhận', ok = 'Đồng ý', danger = false, delay = danger ? 1500 : 0, typeToConfirm = '' } = {}) {
  const dlg = $('#confirm-dialog'), okBtn = $('#confirm-ok'), cancelBtn = $('#confirm-cancel'), wrap = $('#confirm-type'), input = $('#confirm-type-input');
  $('#confirm-title').textContent = title; $('#confirm-text').textContent = text;
  okBtn.classList.toggle('danger-bg', danger); cancelBtn.textContent = danger ? 'Không, giữ lại' : 'Huỷ';
  wrap.hidden = !typeToConfirm; input.value = '';
  if (typeToConfirm) $('#confirm-type-code').textContent = typeToConfirm;
  let wait = Math.ceil(delay / 1000), timer = 0;
  const typed = () => !typeToConfirm || foldText(input.value) === foldText(typeToConfirm);
  const draw = () => { okBtn.textContent = wait > 0 ? `${ok} (${wait})` : ok; okBtn.disabled = wait > 0 || !typed(); };
  draw();
  if (wait > 0) timer = setInterval(() => { wait--; draw(); if (wait <= 0) clearInterval(timer); }, 1000);
  return new Promise(resolve => {
    const done = v => { clearInterval(timer); dlg.close(); okBtn.onclick = cancelBtn.onclick = input.oninput = input.onkeydown = null; okBtn.disabled = false; okBtn.textContent = ok; resolve(v); };
    okBtn.onclick = () => { if (!okBtn.disabled) done(true); }; cancelBtn.onclick = () => done(false);
    input.oninput = draw; input.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); if (!okBtn.disabled) done(true); } };
    dlg.oncancel = e => { e.preventDefault(); done(false); };
    dlg.showModal(); (typeToConfirm ? input : danger ? cancelBtn : okBtn).focus();
  });
}
$$('[data-close]').forEach(b => b.addEventListener('click', () => b.closest('dialog').close()));
/** Hộp nhập lý do (trả lại báo giá…): trả chuỗi đã nhập (≥ 3 ký tự), hoặc null khi bấm Huỷ. */
function reasonBox({ title, text = '', placeholder = '', ok = 'Gửi' }) {
  const dlg = document.createElement('dialog'); dlg.className = 'modal narrow';
  dlg.innerHTML = `<form method="dialog"><div class="modal-head"><h2></h2></div><div class="modal-body"><p class="muted"></p>
    <textarea name="reason" rows="3" required minlength="3" maxlength="500" style="width:100%"></textarea></div>
    <div class="modal-foot"><button type="button" class="btn secondary" data-act="no">Huỷ</button><button class="btn primary" data-act="ok"></button></div></form>`;
  dlg.querySelector('h2').textContent = title; dlg.querySelector('.modal-body > p').textContent = text;
  const input = dlg.querySelector('textarea'); input.placeholder = placeholder; input.setAttribute('aria-label', title); dlg.querySelector('[data-act=ok]').textContent = ok;
  document.body.append(dlg);
  return new Promise(resolve => {
    const done = v => { dlg.close(); dlg.remove(); resolve(v); };
    dlg.querySelector('form').onsubmit = e => { e.preventDefault(); const v = input.value.trim(); if (v.length >= 3) done(v); else input.reportValidity(); };
    dlg.querySelector('[data-act=no]').onclick = () => done(null);
    dlg.oncancel = e => { e.preventDefault(); done(null); };
    dlg.showModal(); input.focus();
  });
}
/**
 * Hộp chụp ảnh xác nhận (đã giao hàng, hàng NCC bị hỏng…): 0–3 ảnh nén JPEG. `min` = số ảnh bắt buộc.
 * Trả mảng data URL, hoặc null khi bấm Huỷ.
 */
function photoBox({ title, text = '', min = 1, max = 3, ok = 'Lưu' }) {
  const dlg = document.createElement('dialog'); dlg.className = 'modal narrow photo-box';
  dlg.innerHTML = `<div class="modal-head"><h2></h2></div><div class="modal-body"><p class="muted"></p>
    <label class="btn secondary big-btn pick-photo">📷 Chụp / chọn ảnh<input type="file" accept="image/*" capture="environment" multiple hidden></label>
    <div class="pack-photos"></div><p class="small muted photo-box-hint"></p></div>
    <div class="modal-foot"><button type="button" class="btn secondary" data-act="no">Huỷ</button><button type="button" class="btn primary" data-act="ok"></button></div>`;
  dlg.querySelector('h2').textContent = title; dlg.querySelector('.modal-body > p').textContent = text; dlg.querySelector('[data-act=ok]').textContent = ok;
  document.body.append(dlg);
  const photos = [], box = dlg.querySelector('.pack-photos'), okBtn = dlg.querySelector('[data-act=ok]'), hint = dlg.querySelector('.photo-box-hint');
  const draw = () => {
    box.innerHTML = photos.map((u, i) => `<span class="pack-photo"><img src="${esc(u)}" alt="Ảnh ${i + 1}"><button type="button" class="icon-btn danger" data-i="${i}" aria-label="Bỏ ảnh ${i + 1}">×</button></span>`).join('');
    okBtn.disabled = photos.length < min;
    hint.textContent = photos.length < min ? `Cần ít nhất ${min} ảnh.` : `${photos.length}/${max} ảnh.`;
  };
  draw();
  dlg.querySelector('input[type=file]').addEventListener('change', async e => {
    const files = [...e.target.files]; e.target.value = '';
    for (const f of files) {
      if (photos.length >= max) { toast(`Tối đa ${max} ảnh.`, 'err'); break; }
      try { photos.push(await compressImage(f, [[1280, .72], [1024, .68], [800, .62], [640, .6]], 450000, 'Ảnh quá lớn, chụp lại giúp.')); } catch (ex) { toast(ex.message, 'err'); }
    }
    draw();
  });
  box.addEventListener('click', e => { const b = e.target.closest('[data-i]'); if (b) { photos.splice(Number(b.dataset.i), 1); draw(); } });
  return new Promise(resolve => {
    const done = v => { dlg.close(); dlg.remove(); resolve(v); };
    okBtn.onclick = () => done([...photos]); dlg.querySelector('[data-act=no]').onclick = () => done(null);
    dlg.oncancel = e => { e.preventDefault(); done(null); };
    dlg.showModal();
  });
}

// ---------------------------------------------------------------- gọi API
let token = '';
// Giữ đăng nhập sau khi đóng app / tab: lưu ở localStorage (sessionStorage bị xoá mỗi lần đóng, nhất là app trên iPhone).
// Máy chủ tự gia hạn phiên khi còn dùng; chỉ bấm Đăng xuất, đổi mật khẩu hoặc bỏ app quá 30 ngày mới phải đăng nhập lại.
try { token = localStorage.getItem(SESSION_KEY) || sessionStorage.getItem(SESSION_KEY) || ''; if (token) { localStorage.setItem(SESSION_KEY, token); sessionStorage.removeItem(SESSION_KEY); } } catch { /* trình duyệt chặn lưu trữ */ }
const saveToken = t => { token = t || ''; try { if (token) localStorage.setItem(SESSION_KEY, token); else { localStorage.removeItem(SESSION_KEY); sessionStorage.removeItem(SESSION_KEY); } } catch { /* bỏ qua */ } };

class ApiError extends Error { constructor(message, status, code) { super(message); this.status = status; this.code = code; } }
/** Gọi API; lời gọi ghi khoá nút vừa bấm tới khi xong (busy-buttons.js – chống bấm trùng, có vòng xoay đang xử lý). */
function api(path, method = 'GET', body) { return withBusy(method, apiRequest(path, method, body), path); }
async function apiRequest(path, method = 'GET', body) {
  const headers = { 'content-type': 'application/json' };
  const requestRoute = location.hash;
  const requestToken = token;
  if (requestToken) headers.authorization = 'Bearer ' + requestToken;
  let res;
  try { res = await fetch(API + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }); }
  catch { throw new ApiError('Chưa kết nối được máy chủ. Vui lòng kiểm tra mạng rồi thử lại.', 0); }
  const data = await res.json().catch(() => ({ error: 'Máy chủ chưa sẵn sàng. Vui lòng thử lại.' }));
  // Phản hồi của phiên cũ không được xoá / thay thế phiên vừa đăng nhập.
  const sameSession = requestToken === token;
  if (sameSession && data.sessionToken !== undefined) saveToken(data.sessionToken);
  if (!res.ok) {
    if (res.status === 401 && requestToken && sameSession && !['/login', '/activate', '/password', '/logout'].includes(path)) { showAuth('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.'); }
    throw new ApiError(data.error || 'Không thực hiện được thao tác.', res.status, data.code);
  }
  if (state.user && sameSession) {
    if (method === 'GET') dataRefresh.observe(path, data, requestRoute);
    else if (/^\/(quotes|orders|contracts|deliveries|payments|stock-requests|packing|purchase-orders|supplier-receipts|supplier-payments|customers|products|tasks|care|customer-care|admin\/members|hr|payroll)(\/|\?|$)/.test(path)) { dataRefresh.saved(); queueMicrotask(() => { loadNavigationBadges(); dataRefresh.tick(); }); }
  }
  return data;
}
// CSP chỉ báo cáo: vi phạm gửi về máy chủ khi đã đăng nhập.
watchCsp(r => { if (!token) return false; api('/csp-report', 'POST', r).catch(() => {}); return true; });

initAvatars(api); // ô nào có data-av tự hiện ảnh đại diện

// ---------------------------------------------------------------- trạng thái
const state = {
  user: null, quotes: null, customers: null, members: null, positions: [],
  quoteFilter: { q: '', type: '', owner: '', sort: 'updated' },
  customerQuery: '', customerTotal: 0, memberQuery: '', memberStatus: '',
  products: null, productTotal: 0, productQuery: '', productBrand: '', policies: [], warehouses: [], selected: new Map(),
};
const isManager = () => state.user?.role === 'manager';
/** Phê duyệt (báo giá, khách mới, sản phẩm mới, đơn / HĐKT, đơn mua NCC): Manager hoặc người được Manager bật cờ "Được duyệt". Máy chủ kiểm lại. */
const canApprove = () => isManager() || state.user?.approver === true;
/** Tài khoản Kho (chức vụ "warehouse"): chỉ các trang cần cho kho – Công việc, Lịch giao hàng, Phiếu đóng gói, Sản phẩm, Tin nhắn. */
const isWarehouse = () => state.user?.role === 'employee' && state.user?.positionId === 'warehouse';
/**
 * Quyền theo chức vụ (trang Phân quyền – máy chủ trả trong /me, kiểm tra lại ở mọi API). Manager luôn có mọi quyền.
 * Máy chủ chưa có bảng quyền (chưa chạy migration 0065) thì dùng đúng quyền cũ theo chức vụ.
 */
const OFFICE_PAGES = ['page.quotes', 'page.orders', 'page.contracts', 'page.deliveries', 'page.receivables', 'page.customers', 'page.care', 'page.stock-requests', 'page.dashboard', 'page.flow', 'page.purchases'];
const legacyPerms = () => isWarehouse() ? ['page.deliveries', 'page.purchases', 'page.packing', 'page.stock-lookup', 'purchases.receive']
  : state.user?.positionId === 'accounting' ? [...OFFICE_PAGES, 'purchases.prices', 'purchases.pay', 'suppliers.edit'] : OFFICE_PAGES;
const can = key => isManager() || (Array.isArray(state.user?.perms) ? state.user.perms : legacyPerms()).includes(key);
/** Trang (#/…) → quyền cần có. Trang không có ở đây (Công việc, Sản phẩm…) ai cũng vào được. */
const PAGE_PERM = {
  cash: 'page.cash', pos: 'pos.sell',
  quotes: 'page.quotes', editor: 'page.quotes', orders: 'page.orders', contracts: 'page.contracts', receiving: 'page.purchases', deliveries: 'page.deliveries', receivables: 'page.receivables', cashbook: 'page.cashbook',
  customers: 'page.customers', customer: 'page.customers', care: 'page.care', 'stock-requests': 'page.stock-requests', dashboard: 'page.dashboard', flow: 'page.flow',
  purchases: 'page.purchases', packing: 'page.packing', 'stock-lookup': 'page.stock-lookup', inventory: 'inventory.view', suppliers: 'suppliers.edit', permissions: 'perm.manage',
};
/** Giá bán: người làm báo giá / đơn / HĐKT (khớp máy chủ – Kho không nhận giá). */
const seesPrices = () => isManager() || can('page.quotes') || can('page.orders') || can('page.contracts');
const canPage = view => view === 'order' ? can('page.orders') || can('page.contracts') || can('page.receivables') : !PAGE_PERM[view] || can(PAGE_PERM[view]);
/** Link "#/<trang>/<id>" mở được với quyền hiện tại (cùng cách `route()` đổi trang chi tiết) – không thì hiện chữ, không đưa người dùng về trang chủ. */
const linkAllowed = hash => {
  const [view, id] = String(hash).replace(/^#\//, '').split(/[/?]/);
  const detail = id && view === 'quotes' ? 'editor' : id && (view === 'orders' || view === 'contracts') ? 'order' : id && view === 'customers' ? 'customer' : id && view === 'packing' ? 'packing-slip' : view;
  return canPage(detail);
};
/** Danh bạ NCC: Manager và chức vụ có quyền "Danh bạ NCC" (mặc định Kế toán; máy chủ kiểm lại). */
const canEditSuppliers = () => can('suppliers.edit');
const KHO_HOME = '#/kho';
/** Trang mở đầu: kho → Trang kho; có Báo giá → Báo giá; còn lại → Công việc. */
const homeHash = () => isWarehouse() ? KHO_HOME : can('page.quotes') ? '#/quotes' : '#/tasks';

// ---------------------------------------------------------------- đăng nhập / kích hoạt
const hashParams = () => new URLSearchParams(location.hash.slice(1));
let activation = /(^|&)token=/.test(location.hash.slice(1)) ? hashParams().get('token') : null;

function showAuth(message = '', { keepToken = false } = {}) {
  const auth = $('#auth'), opening = auth.hidden;
  state.user = null; dataRefresh?.stop(); if (!keepToken) saveToken('');
  $('#workspace').hidden = true; $('#auth').hidden = false; $('#chat-launcher').hidden = true; if (chatUi) chatUi.hide(); if (typeof pulse !== 'undefined') pulse.stop();
  $('#auth-error').textContent = message;
  if (!activation) { $('#auth-title').textContent = 'Đăng nhập nhân viên'; }
  // Chỉ tự đặt con trỏ khi vừa mở form; không giành focus người dùng đã chọn.
  if (opening) setTimeout(() => {
    if (auth.hidden || auth.contains(document.activeElement)) return;
    ($('#email').value ? $('#password') : $('#email')).focus();
  }, 0);
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
$('#show-password').addEventListener('change', e => { for (const id of ['#password', '#password2']) $(id).type = e.target.checked ? 'text' : 'password'; });
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
    location.replace('supplier.html');
    return;
  }
  if (user.role === 'customer' || user.positionId === 'customer') { location.replace('customer.html'); return; } // tài khoản khách: chỉ trang khách hàng
  state.user = user;
  $('#auth').hidden = true; $('#workspace').hidden = false;
  $('#user-name').textContent = $('#menu-name').textContent = user.name;
  $('#menu-email').textContent = user.email;
  $('#user-role').textContent = user.position || (user.role === 'manager' ? 'Manager' : 'Nhân viên');
  $('#user-avatar').textContent = $('#account-button-m').textContent = initials(user.name);
  showOwnAvatar(user.avatar);
  $$('.manager-only').forEach(el => el.hidden = !isManager());
  // Kho: Trang kho + thanh dưới riêng (Trang chủ · Đóng gói · Nhận hàng · Giao hàng · Tra tồn).
  $$('.kho-nav, .kho-only').forEach(el => el.hidden = !isWarehouse());
  // Menu theo quyền của chức vụ (trang Phân quyền): mục nào chức vụ chưa được cấp thì ẩn.
  $$('[data-nav]').forEach(el => { const k = PAGE_PERM[el.dataset.nav]; if (k && !(el.classList.contains('kho-only') && !isWarehouse())) el.hidden = !can(k); });
  $$('.perm-admin-only').forEach(el => el.hidden = !can('perm.manage'));
  $$('[data-nav=tasks]').forEach(el => { if (isWarehouse()) el.hidden = true; });
  document.body.classList.toggle('role-warehouse', isWarehouse());
  if (!/^#\//.test(location.hash) || (isWarehouse() && /^#\/(quotes|tasks)?$/.test(location.hash.split('?')[0]))) history.replaceState(null, '', location.pathname + homeHash());
  currentHash = location.hash;
  route();
  loadAll();
  notifier.start(); dataRefresh.start(); dataRefresh.tick(); pulse.start();
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
  state.quotes = state.customers = state.members = state.products = null;
  showAuth(); $('#auth-note').textContent = 'Đã đăng xuất.';
});
function showOwnAvatar(key) { for (const el of [$('#user-avatar'), $('#account-button-m')]) { if (key) el.dataset.av = key; else delete el.dataset.av; } }
/** Chọn ảnh → thu nhỏ → gửi lên; trả mã ảnh mới (null nếu bỏ chọn). */
async function uploadAvatar(path) {
  const image = await pickAvatar(); if (!image) return null;
  const { avatar } = await api(path, 'PUT', { image });
  primeAvatar(avatar, image);
  return avatar;
}
$('#my-profile').addEventListener('click', () => { toggleAccountMenu(false); go('#/members/' + encodeURIComponent(state.user.id)); });
$('#change-avatar').addEventListener('click', async () => {
  toggleAccountMenu(false);
  try {
    const key = await uploadAvatar('/avatar'); if (!key) return;
    state.user.avatar = key; showOwnAvatar(key);
    const me = state.members?.find(m => m.id === state.user.id); if (me) { me.avatar = key; renderMembers(); }
    toast('Đã đổi ảnh đại diện.');
  } catch (ex) { toast(ex.message, 'err'); }
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
// Điện thoại: đo chiều cao thật của menu dưới và thanh "Tổng thanh toán / Lưu" (đổi theo cỡ chữ, vùng an toàn iPhone)
// để thanh lưu nằm sát trên menu và nút chat nổi không đè lên nút nào.
if ('ResizeObserver' in window) {
  const rootStyle = document.documentElement.style;
  const track = (sel, name) => { const el = document.querySelector(sel); if (el) new ResizeObserver(() => { if (el.offsetHeight) rootStyle.setProperty(name, el.offsetHeight + 'px'); }).observe(el); };
  track('.bottom-nav', '--nav-h'); track('.mobile-savebar', '--savebar-h');
}
let navigationBadgeRequest = 0;
async function loadNavigationBadges() {
  const request = ++navigationBadgeRequest, user = state.user;
  try {
    const counts = await api('/navigation-counts');
    if (request !== navigationBadgeRequest || user !== state.user) return;
    for (const [name, id] of [['receiving', 'nav-receiving-count'], ['packing', 'nav-packing-count'], ['deliveries', 'nav-deliveries-count'], ['purchases', 'nav-purchase-count'], ['cash', 'nav-cash-count']]) {
      const badge = document.getElementById(id); if (!badge) continue;
      const count = Number(counts[name] || 0); badge.textContent = count.toLocaleString('vi-VN'); badge.hidden = count <= 0;
    }
  } catch { /* Keep last known badges during a temporary connection failure. */ }
}
async function loadAll() {
  $('#global-error').hidden = true;
  // Chỉ tải dữ liệu của trang chức vụ được cấp quyền (máy chủ chặn phần còn lại) – tránh báo lỗi đỏ khi mở app.
  const jobs = [can('page.quotes') && loadQuotes(), can('page.customers') && loadCustomers()].filter(Boolean);
  if (isManager()) jobs.push(loadMembers(), loadSapoSync());
  loadNavigationBadges(); loadStockBadge(); tasksView().badge(); if (can('page.care')) careView().badge(); chatView().startBadge(false); $('#chat-launcher').hidden = false;
  loadCatalogSnapshot(); // tải sẵn danh mục để "Tìm nhanh sản phẩm" lọc ngay khi gõ (không chờ)
  await Promise.all(jobs);
}
function showGlobalError(message) { const el = $('#global-error'); el.textContent = message; el.hidden = false; }
// Báo giá: lọc, sắp xếp, phân trang trên máy chủ (GET /quotes); trang này chỉ giữ các báo giá của trang đang xem.
const quotePager = createPager($('#quote-pager'), 'quotes', () => loadQuotes(), 50);
let quoteReq = 0;
async function loadQuotes() {
  if (!can('page.quotes')) return;
  const req = ++quoteReq, f = state.quoteFilter;
  try {
    const d = await api(`/quotes?limit=${quotePager.limit}&offset=${quotePager.offset}&q=${encodeURIComponent(f.q)}&type=${encodeURIComponent(f.type)}&owner=${encodeURIComponent(f.owner)}&sort=${encodeURIComponent(f.sort)}&month=${todayIso().slice(0, 7)}`);
    if (req !== quoteReq) return;
    state.quotes = d.quotes; state.quoteMeta = d;
    // Báo giá đã sinh đơn hàng / HĐKT → nút xem chứng từ (thay chỗ nhãn loại báo giá).
    const ids = d.quotes.map(q => q.id);
    state.quoteDocs = ids.length ? (await api('/quote-docs?ids=' + encodeURIComponent(ids.join(','))).catch(() => ({ docs: {} }))).docs : {};
    if (req !== quoteReq) return;
  } catch (e) { if (req !== quoteReq) return; state.quotes = state.quotes || []; if (e.status !== 401) showGlobalError(e.message); }
  renderQuotes();
}
// Danh bạ có thể hàng nghìn khách: tìm và phân trang trên máy chủ.
let customerReq = 0, customerPager;
async function loadCustomers() {
  if (!can('page.customers')) return;
  const req = ++customerReq;
  customerPager ||= createPager($('#customer-pager'), 'customers', () => loadCustomers(), 50);
  try {
    const d = await api(`/customers?limit=${customerPager.limit}&offset=${customerPager.offset}&q=${encodeURIComponent(state.customerQuery)}${$('#customer-mine').checked ? '&mine=1' : ''}${$('#customer-pending').checked ? '&status=pending' : ''}${$('#customer-retail').checked ? '&kind=retail' : ''}`);
    if (req !== customerReq) return;
    $('#customer-retail-chip').hidden = !d.canListRetail;
    if (!d.canListRetail) $('#customer-retail').checked = false;
    state.customers = d.customers; state.customerQuoteCounts = null;
    state.customerTotal = d.total ?? d.customers.length;
    loadCustomerQuoteCounts(req);
    if (!state.customerQuery && !$('#customer-mine').checked && !$('#customer-pending').checked && !$('#customer-retail').checked) state.customerGrandTotal = state.customerTotal;
    $('#customer-pending-count').textContent = d.pendingCount || 0; $('#customer-pending-chip').hidden = !d.pendingCount && !$('#customer-pending').checked;
  } catch (e) { state.customers = state.customers || []; if (e.status !== 401) showGlobalError(e.message); }
  renderCustomers(); renderStats(); loadCustomerDuplicates();
}
// Khách trùng mã số thuế (Manager): đếm + gộp.
let customerDups = null;
async function loadCustomerDuplicates() {
  if (!isManager()) { $('#customer-dup-chip').hidden = true; return; }
  try { customerDups = await api('/customer-duplicates'); } catch { customerDups = null; }
  $('#customer-dup-count').textContent = customerDups?.total || 0; $('#customer-dup-chip').hidden = !customerDups?.total;
}
function renderCustomerDuplicates() {
  const groups = customerDups?.groups || [];
  $('#dup-list').innerHTML = groups.length ? groups.map(g => `<section class="dup-group"><h3>MST ${esc(g.taxCode)}</h3>${g.customers.map(c => `
    <div class="dup-row${c.keep ? ' keep' : ''}"><span class="dup-tag${c.keep ? " keep" : ""}">${c.keep ? 'Giữ lại' : 'Gộp & xoá'}</span>
      <div><b>${esc(c.name)}</b><small>${esc([c.contact ? 'Liên hệ: ' + c.contact : 'Không có người liên hệ', c.phone, c.email].filter(Boolean).join(' · '))}</small>
      <small>${c.contacts} người liên hệ · ${c.refs} chứng từ / lịch sử${c.hasOwner ? ' · có phụ trách' : ''}${/^\d+$/.test(c.id) ? ' · từ Sapo' : ''}</small></div>
      ${c.keep ? '' : `<button type="button" class="btn secondary small" data-dup-keep="${esc(c.id)}" data-dup-tax="${esc(g.taxCode)}">Giữ khách này</button>`}</div>`).join('')}</section>`).join('')
    : '<p class="muted">Không còn khách trùng mã số thuế.</p>';
  $('#dup-merge-all').disabled = !groups.length; $('#dup-error').textContent = '';
}
$('#customer-dup-chip').addEventListener('click', () => { renderCustomerDuplicates(); $('#dup-dialog').showModal(); });
$('#dup-list').addEventListener('click', e => {
  const b = e.target.closest('[data-dup-keep]'); if (!b) return;
  const g = customerDups.groups.find(x => x.taxCode === b.dataset.dupTax);
  g.keepId = b.dataset.dupKeep; g.customers.forEach(c => { c.keep = c.id === g.keepId; });
  renderCustomerDuplicates();
});
$('#dup-merge-all').addEventListener('click', async () => {
  const groups = customerDups?.groups || []; if (!groups.length) return;
  const n = groups.reduce((s, g) => s + g.customers.length - 1, 0);
  if (!await confirmBox(`Gộp ${n} khách trùng vào ${groups.length} khách giữ lại? Bản trùng sẽ bị xoá, không hoàn tác được.`, { title: 'Gộp khách trùng MST', ok: 'Gộp', danger: true })) return;
  const btn = $('#dup-merge-all'); btn.disabled = true;
  try {
    for (const g of groups) await api('/customer-duplicates/merge', 'POST', { keepId: g.keepId, dropIds: g.customers.filter(c => !c.keep).map(c => c.id) });
    $('#dup-dialog').close(); toast(`Đã gộp ${n} khách trùng.`); loadCustomers();
  } catch (e) { $('#dup-error').textContent = e.message; btn.disabled = false; await loadCustomerDuplicates(); renderCustomerDuplicates(); }
});
async function loadMembers() {
  try { const d = await api('/admin/members'); state.members = d.members; state.positions = d.positions; }
  catch (e) { state.members = state.members || []; if (e.status !== 401) showGlobalError(e.message); }
  renderMembers();
}
// Tình trạng đồng bộ Sapo → app (sản phẩm, khách hàng, nhân viên): Sapo đẩy sang, hoặc app tự lấy bằng phiên Sapo của Manager.
const viTime = iso => new Date(iso).toLocaleString('vi-VN');
async function loadSapoSync() {
  let d; try { d = await api('/admin/sapo-sync'); } catch { $('#sapo-sync').hidden = true; return; }
  const n = v => Number(v || 0).toLocaleString('vi-VN'), at = iso => iso ? 'Lần cuối ' + viTime(iso) : 'Chưa nhận dữ liệu';
  const s = d.session || {}, p = d.pull || {}, pullFailed = p.ok === false && !p.stale;
  $('#sapo-sync').hidden = false;
  $('#sync-state').textContent = !d.configured ? 'Chưa bật' : !s.connected ? 'Chưa kết nối' : s.expired ? 'Phiên hết hạn' : pullFailed ? 'Lỗi' : 'Đang chạy';
  $('#sync-state').classList.toggle('warn', !!(s.expired || pullFailed));
  $('#sync-note').textContent = !d.configured ? 'Cần cài mã SAPO_SYNC_TOKEN'
    : !s.connected ? 'Bấm "Kết nối Sapo" để bắt đầu'
    : s.expired || pullFailed ? (p.error || 'Cần kết nối lại Sapo')
    : p.finishedAt && !p.stale ? 'Đồng bộ lúc ' + viTime(p.finishedAt) : 'Kết nối lúc ' + viTime(s.updatedAt);
  $('#sapo-connect').textContent = s.connected ? 'Kết nối lại' : 'Kết nối Sapo';
  $('#sapo-connect').hidden = !d.configured; $('#sapo-pull').hidden = !d.configured || !s.connected; $('#sapo-disconnect').hidden = !s.connected;
  $('#sync-products').textContent = n(d.products.count); $('#sync-products-at').textContent = at(d.products.lastSyncedAt);
  $('#sync-customers').textContent = n(d.customers.count); $('#sync-customers-at').textContent = at(d.customers.lastSyncedAt);
  $('#sync-staff').textContent = n(d.staff.count); $('#sync-staff-note').textContent = d.staff.linked ? `+ ${n(d.staff.linked)} đã khớp tài khoản web` : 'Hồ sơ mới cần cấp liên kết';
  const docs = d.docs || {}, dc = k => n(docs[k]?.count);
  $('#sync-docs').textContent = n(['purchase_order', 'stock_transfer', 'stock_adjustment'].reduce((t, k) => t + Number(docs[k]?.count || 0), 0));
  $('#sync-docs-note').textContent = `Nhập hàng ${dc('purchase_order')} · Điều chuyển ${dc('stock_transfer')} · Kiểm hàng ${dc('stock_adjustment')}` + (p.warnings?.length && !p.stale ? ' · Chưa đọc được: ' + p.warnings.map(w => w.split(':')[0]).join(', ') : '');
}
$('#sapo-connect').addEventListener('click', () => { $('#sapo-form').reset(); $('#sapo-error').textContent = ''; $('#sapo-dialog').showModal(); });
$('#sapo-form').addEventListener('submit', async e => {
  e.preventDefault();
  const btn = $('#save-sapo'), err = $('#sapo-error'), cookie = String(new FormData(e.target).get('cookie') || '').trim();
  err.textContent = '';
  if (!/(^|;\s*)(_admin_session_id|sapo-admin)=/.test(cookie)) { err.textContent = 'Chuỗi cookie cần có sapo-admin (hoặc _admin_session_id). Kiểm tra lại bước 3.'; return; }
  btn.disabled = true;
  try { await api('/admin/sapo-session', 'POST', { cookie }); $('#sapo-dialog').close(); toast('Đã kết nối Sapo.'); await loadSapoSync(); }
  catch (ex) { err.textContent = ex.message; }
  finally { btn.disabled = false; }
});
$('#sapo-disconnect').addEventListener('click', async () => {
  if (!await confirmBox('App sẽ ngừng tự lấy dữ liệu từ Sapo cho tới khi kết nối lại.', { title: 'Ngắt kết nối Sapo?', ok: 'Ngắt kết nối', danger: true })) return;
  try { await api('/admin/sapo-session', 'DELETE', {}); $('#sapo-dialog').close(); toast('Đã ngắt kết nối Sapo.'); await loadSapoSync(); } catch (ex) { toast(ex.message, 'error'); }
});
$('#sapo-pull').addEventListener('click', async () => {
  const btn = $('#sapo-pull'); btn.disabled = true; btn.textContent = 'Đang đồng bộ…';
  try {
    const r = await api('/admin/sapo-pull', 'POST', {}), x = r.results || {};
    const docs = ['purchase_order', 'stock_transfer', 'stock_adjustment'].reduce((t, k) => t + (x[k]?.created || 0) + (x[k]?.updated || 0), 0);
    toast(`Đã đồng bộ: ${(x.products?.created || 0) + (x.products?.updated || 0)} sản phẩm, tồn kho ${(x.stock?.created || 0) + (x.stock?.updated || 0)} mã, ${x.customers?.applied || 0} khách hàng, ${(x.staff?.created || 0) + (x.staff?.linked || 0)} nhân viên mới, ${docs} chứng từ kho (nhập hàng, điều chuyển, kiểm hàng).`
      + (r.warnings?.length ? ' Chưa đọc được: ' + r.warnings.join('; ') : ''));
    loadMembers(); state.products = null; loadCustomers();
  } catch (ex) { toast(ex.message, 'error'); }
  finally { btn.disabled = false; btn.textContent = 'Đồng bộ ngay'; loadSapoSync(); }
});

// ---------------------------------------------------------------- điều hướng
var posUi = null;
var cashUi = null;
const cashView = () => cashUi ||= initCash({api,root:$('#view-cash'),toast,user:()=>state.user,go,onShiftClosed:async()=>{await loadNavigationBadges();if(location.hash.startsWith('#/pos'))await posUi?.load();}});
const posView = () => posUi ||= initPos({ api, root: $('#view-pos'), toast, user: () => state.user, confirmBox, go, onCloseShift:()=>cashView().closeCurrent() });
let receivingUi;
const receivingView = () => receivingUi ||= initReceivingCalendar({ api, root: $('#view-receiving') });
const VIEWS = { receiving: 'Lịch nhận hàng', transfers: 'Điều chuyển kho', 'stock-moves': 'Sổ kho', cash: 'Sổ quỹ', pos: 'Bán hàng nhanh', permissions: 'Phân quyền', kho: 'Trang kho', 'stock-lookup': 'Tra tồn', inventory: 'Đối chiếu tồn Sapo', flow: 'Sơ đồ quy trình', suppliers: 'Nhà cung cấp', purchases: 'Đơn mua NCC', dashboard: 'Tổng quan doanh số', tasks: 'Công việc', quotes: 'Báo giá', orders: 'Đơn đặt hàng', contracts: 'HĐKT', deliveries: 'Lịch giao hàng', receivables: 'Công nợ', cashbook: 'Sổ thu / chi', 'stock-requests': 'Khách hỏi tồn', products: 'Sản phẩm', customers: 'Khách hàng', staff: 'Nhân viên', editor: 'Báo giá', order: 'Đơn đặt hàng', customer: 'Khách hàng', member: 'Nhân viên', payroll: 'Bảng lương', packing: 'Phiếu đóng gói', care: 'Chăm sóc khách hàng' };
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

let lastRoutedHash = '';
function route() {
  // #/chat/<id> (bấm thông báo tin nhắn): mở khung chat nổi, giữ nguyên trang đang xem.
  const chatMatch = /^#\/chat(?:\/([\w-]+))?/.exec(location.hash);
  if (chatMatch) { chatView().show(chatMatch[1]); history.replaceState(null, '', lastRoutedHash || homeHash()); if (lastRoutedHash) return; }
  document.querySelectorAll('dialog.product-card').forEach(dlg => { dlg.close(); dlg.remove(); });
  lastRoutedHash = location.hash;
  const [path, query = ''] = location.hash.replace(/^#\/?/, '').split('?');
  const [page = 'quotes', id] = path.split('/');
  // #/members/<id>?month=YYYY-MM: hồ sơ nhân viên (Manager xem mọi người; nhân viên chỉ xem của mình – máy chủ kiểm tra).
  let view = VIEWS[page] ? page : page === 'members' && id ? 'member' : 'quotes';
  if ((view === 'staff' || view === 'payroll') && !isManager()) { history.replaceState(null, '', homeHash()); return route(); }
  // Trang chức vụ chưa được cấp quyền (link cũ, thông báo…): về trang mở đầu. Báo giá / đơn / khách có mã thì xét theo trang chi tiết.
  const detail = id && view === 'quotes' ? 'editor' : id && (view === 'orders' || view === 'contracts') ? 'order' : id && view === 'customers' ? 'customer' : id && view === 'packing' ? 'packing-slip' : view;
  if (!canPage(detail) && location.hash.split('?')[0] !== homeHash()) { toast('Chức vụ của bạn chưa được cấp quyền vào trang này.', 'err'); history.replaceState(null, '', homeHash()); return route(); }
  if (view === 'quotes' && id) view = 'editor';
  if (view === 'orders' && id) view = 'order';
  // HĐKT là luồng riêng: #/contracts/<id> mở trang chi tiết HĐKT (dùng chung khung trang với đơn hàng, nội dung theo HĐKT).
  if (view === 'contracts' && id) view = 'order';
  if (view === 'customers' && id) view = 'customer';
  for (const v of Object.keys(VIEWS)) $('#view-' + v).hidden = v !== view;
  const navKey = view === 'packing' ? (id ? 'tasks' : 'packing') : view === 'editor' ? 'quotes' : view === 'order' ? (page === 'contracts' ? 'contracts' : 'orders') : view === 'customer' ? 'customers' : view === 'member' ? 'staff' : view;
  $$('[data-nav]').forEach(a => a.classList.toggle('active', a.dataset.nav === navKey));
  $('#breadcrumb').textContent = view === 'editor' ? (id === 'new' ? 'Tạo báo giá' : 'Sửa báo giá') : view === 'order' && page === 'contracts' ? 'HĐKT' : VIEWS[view];
  document.title = (view === 'editor' ? $('#breadcrumb').textContent : VIEWS[view]) + ' · Bách Ngân';
  window.scrollTo(0, 0); document.querySelector('.main')?.scrollTo(0, 0); // điện thoại: vùng nội dung tự cuộn
  if (view === 'editor') openEditor(id);
  if (view === 'cash') cashView().load().catch(e=>toast(e.message,'err'));
  if (view === 'pos') posView().load();
  if (view === 'products' && !state.products) loadProducts();
  if (view === 'products') {
    productAdmin().loadPending(); legacyImagesBox();
    const sku = new URLSearchParams(query).get('sku');
    if (sku) showProductCard(sku);
  }
  if (view === 'orders') loadOrders();
  if (view === 'contracts') loadContracts();
  if (view === 'receiving') receivingView().load();
  if (view === 'deliveries') loadDeliveries();
  if (view === 'receivables') loadReceivables();
  if (view === 'cashbook') loadCashbook();
  if (view === 'stock-requests') loadStockRequests(id);
  if (view === 'tasks') tasksView().load(id);
  if (view === 'dashboard') dashboardView().load();
  if (view === 'flow') flowView().load();
  if (view === 'suppliers') { suppliersView().load(); if (new URLSearchParams(query).get('new') === '1') suppliersView().openNew(); else if (id) suppliersView().open(decodeURIComponent(id)); }
  if (view === 'purchases') purchasesView().show(id ? decodeURIComponent(id) : '', query);
  if (view === 'inventory') inventoryView().load();
  if (view === 'transfers') transfersView().load(id);
  if (view === 'stock-moves') stockMovesView().show(query);
  if (view === 'permissions') { permissionsView().load(); sellerConfigView().load(); }
  if (view === 'kho') khoHome().load();
  if (view === 'stock-lookup') stockLookup().load(new URLSearchParams(query).get('q')||'');
  if (view === 'care') careView().load(id ? decodeURIComponent(id) : '');
  if (view === 'order') openOrder(id);
  if (view === 'customer') customerDetail().open(decodeURIComponent(id));
  if (view === 'member') memberDetail().open(decodeURIComponent(id), new URLSearchParams(query).get('month') || '', new URLSearchParams(query).get('tab') || '');
  if (view === 'payroll') payrollBoard().open(new URLSearchParams(query).get('month') || '');
  if (view === 'packing') openPacking(id ? decodeURIComponent(id) : '');
  hideProductSuggest();
}
const go = hash => { if (location.hash === hash) route(); else location.hash = hash; };

// ---------------------------------------------------------------- danh sách báo giá
const skeleton = cols => Array.from({ length: 4 }, () => `<tr class="skeleton">${'<td><span></span></td>'.repeat(cols)}</tr>`).join('');
function renderStats() {
  const all = state.quotes, m = state.quoteMeta;
  if (!all || !m) return;
  $('#stat-count').textContent = m.total.toLocaleString('vi-VN');
  $('#stat-count-note').textContent = m.total === m.all ? 'Tất cả báo giá' : `Lọc từ ${m.all.toLocaleString('vi-VN')} báo giá`;
  // Giá trị: máy chủ cộng sẵn khi số báo giá khớp lọc vừa phải; nhiều quá thì cộng trang đang xem.
  $('#stat-value').textContent = shortMoney(m.value ?? all.reduce((s, q) => s + q.total, 0));
  $('#stat-value-note').textContent = m.value === null ? 'Trang đang xem · gồm VAT' : 'Đã gồm VAT';
  $('#stat-month').textContent = (m.month?.count ?? 0).toLocaleString('vi-VN');
  $('#stat-month-value').textContent = m.month?.count ? shortMoney(m.month.value) : 'Chưa có báo giá';
  $('#stat-customers').textContent = state.customerGrandTotal !== undefined ? state.customerGrandTotal.toLocaleString('vi-VN') : '–';
  $('#nav-quote-count').textContent = m.all;
}
/** Cột "Đơn / HĐKT" của danh sách báo giá: đã sinh đơn / HĐKT → nút xem; chưa → nhãn loại báo giá như cũ. */
function quoteDocCell(q) {
  const k = state.quoteDocs?.[q.id];
  if (!k) return `<span class="pill type-${esc(q.quoteType)}">${esc(q.quoteType)}</span>`;
  const label = k.contractNo ? 'Xem HĐKT' : 'Xem đơn hàng', no = k.contractNo || k.orderNo;
  return `<a class="btn ghost small quote-doc-btn" data-doc-link href="#/${k.contractNo ? 'contracts' : 'orders'}/${esc(encodeURIComponent(k.orderId))}" title="${esc((k.contractNo ? 'HĐKT ' : 'Đơn hàng ') + no)}">${label}<small>${esc(no)}</small></a>`;
}
function renderQuotes() {
  const tbody = $('#quote-list');
  if (!state.quotes) { tbody.innerHTML = skeleton(7); return; }
  $('#quote-owner').hidden = !state.quoteMeta?.hasOthers;
  const list = state.quotes;
  renderStats(); quotePager.render(state.quoteMeta?.total ?? list.length);
  tbody.innerHTML = list.map(q => `
    <tr class="clickable" data-open="${esc(q.id)}">
      <td class="first"><span class="strong">${esc(q.quoteNo)}</span><small>${q.lineCount ?? ''} sản phẩm · phiên bản ${esc(q.revision)} · ${q.approvalStatus === 'approved' ? '<span class="pill ok">Đã duyệt</span>' : q.approvalStatus === 'draft' ? '<span class="pill">Nháp</span>' : '<span class="pill warn">Chờ duyệt</span>'}${q.fromCustomer ? ' · <span class="pill blue">Khách gửi</span>' : q.mine ? '' : ' · <span class="pill blue">Được chia sẻ</span>'}</small></td>
      <td data-label="Khách">${esc(q.customer) || '<span class="muted">—</span>'}${q.contact || q.phone ? `<small>${esc([q.contact, q.phone].filter(Boolean).join(' · '))}</small>` : ''}</td>
      <td data-label="Đơn / HĐKT">${quoteDocCell(q)}</td>
      <td data-label="Ngày">${fmtDate(q.quoteDate) || '—'}</td>
      <td class="right num">${money(q.total)}</td>
      <td data-label="Cập nhật" title="${esc(new Date(q.updatedAt).toLocaleString('vi-VN'))}">${ago(q.updatedAt)}</td>
      <td class="actions-cell"><div class="row-actions">
        <button class="icon-btn" data-buy="${esc(q.id)}" title="Đặt hàng NCC" aria-label="Đặt hàng NCC cho ${esc(q.quoteNo)}"><svg viewBox="0 0 24 24"><path d="M3 7h11v9H3z M14 10h4l3 3v3h-7 M7 19a1.5 1.5 0 1 0 0-.01 M17 19a1.5 1.5 0 1 0 0-.01 M6 11h5 M9 9l2 2-2 2"/></svg></button>
        <button class="icon-btn" data-dup="${esc(q.id)}" title="Nhân bản" aria-label="Nhân bản ${esc(q.quoteNo)}"><svg viewBox="0 0 24 24"><path d="M9 9h11v11H9z M5 15H4V4h11v1"/></svg></button>
        <button class="icon-btn" data-open="${esc(q.id)}" title="Mở" aria-label="Mở ${esc(q.quoteNo)}"><svg viewBox="0 0 24 24"><path d="M9 18l6-6-6-6"/></svg></button>
      </div></td>
    </tr>`).join('');
  const empty = $('#quote-empty'), none = !state.quoteMeta?.all;
  empty.hidden = list.length > 0;
  $('#quote-empty-title').textContent = none ? 'Chưa có báo giá' : 'Không có báo giá phù hợp';
  $('#quote-empty-text').textContent = none ? 'Tạo báo giá đầu tiên để bắt đầu làm việc.' : 'Thử từ khoá khác hoặc bỏ bớt bộ lọc.';
  $('#quote-empty-action').hidden = !none;
  $('#quote-table').hidden = list.length === 0;
}
$('#quote-list').addEventListener('click', e => {
  const dup = e.target.closest('[data-dup]');
  if (dup) { e.stopPropagation(); duplicateFromList(dup.dataset.dup); return; }
  const buy = e.target.closest('[data-buy]');
  if (buy) { e.stopPropagation(); go('#/purchases/new?type=quote&id=' + encodeURIComponent(buy.dataset.buy)); return; }
  if (e.target.closest('[data-doc-link]')) return; // nút xem đơn / HĐKT: theo link, không mở báo giá
  const open = e.target.closest('[data-open]');
  if (open) go('#/quotes/' + encodeURIComponent(open.dataset.open));
});
let quoteTimer;
const reloadQuotes = () => { quotePager.reset(); loadQuotes(); };
$('#quote-search').addEventListener('input', e => { state.quoteFilter.q = e.target.value; clearTimeout(quoteTimer); quoteTimer = setTimeout(reloadQuotes, 250); });
$('#quote-sort').addEventListener('change', e => { state.quoteFilter.sort = e.target.value; reloadQuotes(); });
$('#quote-owner').addEventListener('change', e => { state.quoteFilter.owner = e.target.value; reloadQuotes(); });
$('#type-filter').addEventListener('click', e => {
  const chip = e.target.closest('.chip'); if (!chip) return;
  $$('#type-filter .chip').forEach(c => c.classList.toggle('active', c === chip));
  state.quoteFilter.type = chip.dataset.type; reloadQuotes();
});

// ---------------------------------------------------------------- soạn báo giá
/** Danh mục sản phẩm tải sẵn về trình duyệt (xem loadCatalogSnapshot). */
const catalog = { version: '', observedAt: null, items: null, checkedAt: 0, loading: null };
const editor = { id: null, revision: 0, base: {}, rows: [], type: 'B2B', dirty: false, customerId: '', pending: null, loading: false, approval: null };
const qf = $('#quote-form');
const field = name => qf.elements.namedItem(name);
const MOBILE_QUOTE_STEPS = ['info', 'products', 'review'];
function setMobileQuoteStep(step, scroll = true) {
  if (!MOBILE_QUOTE_STEPS.includes(step)) step = 'info';
  qf.dataset.mobileStep = step;
  const index = MOBILE_QUOTE_STEPS.indexOf(step);
  $$('.quote-mobile-steps [data-quote-step]', qf).forEach((b, i) => {
    b.setAttribute('aria-current', i === index ? 'step' : 'false');
    b.classList.toggle('done', i < index);
  });
  $('#quote-step-back').disabled = index === 0;
  $('#quote-step-next').hidden = index === MOBILE_QUOTE_STEPS.length - 1;
  $('#save-quote-m').hidden = index !== MOBILE_QUOTE_STEPS.length - 1;
  $('#m-step-label').textContent = `Bước ${index + 1}/3 · ${['Thông tin', 'Sản phẩm', 'Kiểm tra'][index]}`;
  if (scroll && matchMedia('(max-width: 850px)').matches) $('#view-editor').scrollIntoView({ block: 'start' });
}
$('.quote-mobile-steps').addEventListener('click', e => {
  const b = e.target.closest('[data-quote-step]'); if (b) setMobileQuoteStep(b.dataset.quoteStep);
});
$('#quote-step-back').addEventListener('click', () => setMobileQuoteStep(MOBILE_QUOTE_STEPS[Math.max(0, MOBILE_QUOTE_STEPS.indexOf(qf.dataset.mobileStep) - 1)]));
$('#quote-step-next').addEventListener('click', () => setMobileQuoteStep(MOBILE_QUOTE_STEPS[Math.min(2, MOBILE_QUOTE_STEPS.indexOf(qf.dataset.mobileStep) + 1)]));
$('#quote-mobile-more').addEventListener('click', e => {
  e.stopPropagation();
  const open = qf.classList.toggle('quote-mobile-actions-open');
  e.currentTarget.setAttribute('aria-expanded', String(open));
});
document.addEventListener('click', e => {
  if (!e.target.closest('.quote-actions, #quote-mobile-more')) {
    qf.classList.remove('quote-mobile-actions-open');
    $('#quote-mobile-more').setAttribute('aria-expanded', 'false');
  }
});
/** Ghi chú & điều kiện mặc định theo loại báo giá – lấy nguyên từ web báo giá cũ (`public/quote-notes.js`). */
const QUOTE_NOTES = {
  HRC: '- Tổng thanh toán đã bao gồm thuế VAT theo từng sản phẩm.\n- Báo giá có hiệu lực 7 ngày kể ngày ký.\n- Phương thức thanh toán: Chuyển khoản.\n- Đơn vị bán hàng: CÔNG TY TNHH SẢN XUẤT THƯƠNG MẠI BÁCH NGÂN\n- Mã số thuế: 1801686576\n- Số tài khoản: 579268 tại Ngân hàng TMCP Á Châu - Chi Nhánh Cần Thơ\n- Thời gian giao hàng: Cập nhật cụ thể sau khi thống nhất chốt đơn hàng.\n- Địa chỉ giao hàng: Theo thoả thuận.\n- Thanh toán: 100% giá trị hợp đồng trong vòng 30 ngày kể từ ngày nhận được hàng và hóa đơn GTGT.\nTrân trọng kính chào.',
  B2B: '- Tổng giá trị thanh toán đã bao gồm thuế VAT theo từng sản phẩm.\n- Giá trên chỉ có hiệu lực trong 30 ngày.\n- Thời gian giao hàng: Cập nhật cụ thể sau khi thống nhất chốt đơn hàng.\n- Địa chỉ giao hàng: Theo thoả thuận.\n- Phương thức thanh toán: Chuyển khoản.\n- Đơn vị bán hàng: CÔNG TY TNHH SẢN XUẤT THƯƠNG MẠI BÁCH NGÂN\n- Mã số thuế: 1801686576\n- Số tài khoản: 579268 tại Ngân hàng TMCP Á Châu - Chi Nhánh Cần Thơ\n- Bên Mua sẽ tiến hành tạm ứng 30% trị giá hợp đồng ngay sau khi Hợp đồng ký kết.\n- 70% trị giá còn lại của hợp đồng sẽ thanh toán trước khi nhận hàng.\nHy vọng bảng chào giá đáp ứng được yêu cầu của Quý Khách hàng.\nTrân trọng kính chào.',
  VIGIFTS: '- Tổng giá trị thanh toán đã bao gồm thuế VAT theo từng sản phẩm.\n- Giá trên chỉ có hiệu lực trong vòng 7 ngày kể từ ngày gửi chào giá.\n- Thời gian giao hàng: Cập nhật cụ thể sau khi thống nhất chốt đơn hàng.\n- Địa chỉ giao hàng: Theo thoả thuận.\n- Phương thức thanh toán: Chuyển khoản.\nTài khoản: CÔNG TY TNHH SẢN XUẤT THƯƠNG MẠI QUẢNG CÁO VIGIFTS.\nSố tài khoản: 159063909 tại Ngân Hàng TMCP Á Châu, CN Cần Thơ.\n+ Bên Mua sẽ tiến hành tạm ứng 50% trị giá hợp đồng ngay sau khi Hợp đồng ký kết.\n+ 50% trị giá còn lại của hợp đồng sẽ thanh toán khi nhận đầy đủ hàng hoá và chứng từ kèm theo.\nHy vọng bảng chào giá đáp ứng được yêu cầu của Quý Khách hàng.\nTrân trọng kính chào,',
};
const defaultNotes = type => withPaymentNotes(QUOTE_NOTES[type] || QUOTE_NOTES.HRC, defaultPaymentTerms(type), 0, moneyWords);
function syncPaymentNotes(total = totals(currentDoc()).total) {
  if (editor.base.paymentTerms && !editor.base.paymentNotesManual) field('notes').value = withPaymentNotes(field('notes').value, editor.base.paymentTerms, total, moneyWords);
}
/** Ngày giao dự kiến là nguồn cho dòng thời gian giao hàng; giữ nguyên các ghi chú khác. */
function notesWithDeliveryDate(notes, date) {
  const text = String(notes || '');
  const formatted = fmtDate(date);
  const fallback = 'Cập nhật cụ thể sau khi thống nhất chốt đơn hàng.';
  if (formatted) {
    const line = '- Thời gian giao hàng: giao hàng ngày ' + formatted + '.';
    return /^[ \t]*[-–•]?[ \t]*Thời gian giao hàng:[^\r\n]*/im.test(text)
      ? text.replace(/^([ \t]*[-–•]?[ \t]*Thời gian giao hàng:)[^\r\n]*/im, '$1 giao hàng ngày ' + formatted + '.')
      : text + (text && !text.endsWith('\n') ? '\n' : '') + line;
  }
  // Xoá ngày đã chọn: chỉ đưa dòng tự sinh về mặc định, không xoá ghi chú tự viết.
  return text.replace(/^([ \t]*[-–•]?[ \t]*Thời gian giao hàng:)[ \t]*giao hàng ngày \d{2}\/\d{2}\/\d{4}\.?[ \t]*$/im, '$1 ' + fallback);
}
function syncDeliveryNotes() {
  field('notes').value = notesWithDeliveryDate(field('notes').value, field('deliveryDate').value);
}

$('#reset-notes').addEventListener('click', async () => {
  const notes = field('notes');
  if (notes.value.trim() && notes.value !== notesWithDeliveryDate(defaultNotes(editor.type), field('deliveryDate').value) && !await confirmBox('Thay nội dung ghi chú hiện tại bằng ghi chú mặc định?', { ok: 'Thay' })) return;
  notes.value = defaultNotes(editor.type);
  editor.base.paymentNotesManual = false;
  editor.base.paymentTerms ||= defaultPaymentTerms(editor.type);
  syncPaymentNotes(); syncDeliveryNotes(); markDirty();
});
/** Kiểm tra điều khoản thanh toán (dùng chung hộp Tạo báo giá và hộp Điều khoản thanh toán). '' = hợp lệ. */
function termsError(depositRate, balanceTerm) {
  if (!Number.isFinite(depositRate) || depositRate < 0 || depositRate > 100) return 'Tỷ lệ đặt cọc phải từ 0 đến 100%.';
  if (depositRate < 100 && (!balanceTerm || balanceTerm.length > 500 || /^[+-]?\d+(?:[.,]\d+)?\s*(?:ngày)?$/i.test(balanceTerm) && (!/^\d+\s*(?:ngày)?$/i.test(balanceTerm) || parseInt(balanceTerm, 10) > 3650)))
    return 'Nhập thời hạn thanh toán phần còn lại: số ngày (0–3650) hoặc điều kiện bằng chữ.';
  return '';
}
/**
 * Hộp "Điều khoản thanh toán" trên báo giá (Manager xem lại khi duyệt, hoặc người lập khi còn sửa được): tỷ lệ cọc, hạn thanh toán phần còn lại,
 * chiết khấu (khách có CK riêng → áp lại CK theo thương hiệu; không thì CK toàn bảng cho mọi dòng). Ghi chú thanh toán tự cập nhật; bấm Lưu báo giá để lưu.
 */
$('#edit-terms').addEventListener('click', async () => {
  const t = editor.base.paymentTerms || defaultPaymentTerms(editor.type);
  let profile = null;
  if (editor.customerId) profile = await api('/customers/' + encodeURIComponent(editor.customerId)).catch(() => null);
  const credit = profile?.customer?.creditLimit, brand = brandDiscountText(profile?.discounts || editor.brandDiscounts);
  const dlg = document.createElement('dialog'); dlg.className = 'modal narrow';
  dlg.innerHTML = `<form method="dialog" novalidate><div class="modal-head"><div><span class="eyebrow">Báo giá ${esc(field('quoteNo').value || '')}</span><h2>Điều khoản thanh toán</h2></div><button type="button" class="icon-btn" data-x aria-label="Đóng">×</button></div>
    <div class="modal-body"><div class="form-grid cols-2">
      <label>Tỷ lệ đặt cọc (%)<input name="rate" inputmode="decimal" value="${esc(t.depositRate ?? '')}"></label>
      <label>Thời hạn thanh toán phần còn lại<input name="term" list="nq-payment-options" maxlength="500" value="${esc(t.balanceTerm ?? '')}"></label>
      ${credit != null ? `<p class="muted small span-2">Giới hạn công nợ của ${esc(profile.customer.name || 'khách')}: ${money(credit)}</p>` : ''}
      <p class="muted small span-2">Áp dụng sẽ tạo lại dòng thanh toán trong ghi chú, thay phần thanh toán đã nhập tay.</p>
      <p class="muted small span-2">Nhập số ngày tính từ ngày giao hàng (0 = ngay sau giao), hoặc điều kiện bằng chữ. Đặt cọc 100% = thanh toán toàn bộ trước khi giao hàng.</p>
      ${brand ? `<label class="span-2 check-line"><input type="checkbox" name="brand"> Áp lại CK riêng của khách cho các dòng (${esc(brand)})</label>`
        : `<label class="span-2">Chiết khấu toàn bảng (%)<input name="disc" inputmode="decimal" placeholder="Để trống = giữ CK từng dòng"></label>`}
    </div><p class="error" data-err role="alert"></p></div>
    <div class="modal-foot"><button type="button" class="btn secondary" data-x>Huỷ</button><button class="btn primary">Áp dụng</button></div></form>`;
  document.body.append(dlg); dlg.showModal();
  const close = () => { dlg.close(); dlg.remove(); };
  dlg.querySelectorAll('[data-x]').forEach(b => b.addEventListener('click', close));
  dlg.addEventListener('cancel', close);
  dlg.querySelector('form').addEventListener('submit', e => {
    e.preventDefault();
    const f = e.target.elements, rateText = f.rate.value.trim(), depositRate = rateText ? parseNum(rateText) : NaN, balanceTerm = f.term.value.trim();
    const discText = f.disc?.value.trim() || '', disc = discText ? parseNum(discText) : null, err = termsError(depositRate, balanceTerm);
    if (err || (disc !== null && !(disc >= 0 && disc <= 100))) { dlg.querySelector('[data-err]').textContent = err || 'Chiết khấu toàn bảng phải từ 0 đến 100%.'; return; }
    editor.base.paymentTerms = { depositRate, balanceTerm };
    editor.base.paymentNotesManual = false;
    const pct = r => f.brand?.checked ? customerDiscount(r.brand, profile.discounts, 'percent') : disc;
    if (f.brand?.checked || disc !== null) for (const r of editor.rows) {
      const p = pct(r); if (!(p > 0) && !(disc !== null)) continue; // áp lại CK khách: dòng ngoài 3 thương hiệu giữ nguyên
      r.discount = r.discountType === 'amount' ? Math.round((Number(r.price) || 0) * p / 100) : p;
    }
    renderLines(); syncPaymentNotes(); markDirty(); close();
    toast('Đã cập nhật điều khoản – bấm "Lưu báo giá" để lưu.');
  });
});
const PACKAGING_DEFAULT = 'theo tiêu chuẩn nhà sản xuất';

/**
 * Số báo giá tự sinh: HRC_BG_001_06102026, B2B_BG_002_06102026, VG_BG_001_06102026 (đếm theo loại + ngày trên TOÀN CÔNG TY).
 * Số kế tiếp lấy từ máy chủ (GET /quotes/next-no, `refreshQuoteNo`) vì nhân viên chỉ thấy báo giá của mình; lúc lưu máy chủ
 * vẫn kiểm lại – số tự sinh bị người khác lấy trước thì tự đổi sang số kế tiếp còn trống.
 */
const QUOTE_PREFIX = { HRC: 'HRC', B2B: 'B2B', VIGIFTS: 'VG' };
const quoteKind = type => `${QUOTE_PREFIX[type] || 'B2B'}_BG`;
const quoteSeriesKey = (type, date) => `${quoteKind(type)}|${date}`;
const quoteLegacyHead = (type, date) => `${quoteKind(type)}${date.replaceAll('-', '')}_`;
const serverQuoteNo = new Map();
function nextQuoteNo(type = 'B2B', date = todayIso()) {
  date = date || todayIso();
  const prefix = quoteKind(type), legacy = quoteLegacyHead(type, date);
  const local = nextDocumentNumber(prefix, date, (state.quotes || []).map(q => q.quoteNo || ''), legacy);
  const remote = serverQuoteNo.get(quoteSeriesKey(type, date));
  return (documentSequence(remote || '', prefix, date, legacy) || 0) > (documentSequence(local, prefix, date, legacy) || 0) ? remote : local;
}
async function refreshQuoteNo(type, date) {
  date = date || todayIso();
  try { const r = await api(`/quotes/next-no?type=${encodeURIComponent(type)}&date=${encodeURIComponent(date)}`); serverQuoteNo.set(quoteSeriesKey(type, date), r.quoteNo); } catch { /* số tạm; máy chủ kiểm lại lúc lưu */ }
}
const isAutoQuoteNo = (no, type, date) => {
  date = date || todayIso();
  return documentSequence(no, quoteKind(type), date, quoteLegacyHead(type, date)) != null;
};
/** Báo giá mới chưa lưu: cập nhật số tự sinh theo máy chủ (nếu người dùng chưa tự gõ số). */
async function syncEditorQuoteNo() {
  if (editor.id) return;
  const type = editor.type, date = field('date').value || todayIso();
  await refreshQuoteNo(type, date);
  const f = field('quoteNo');
  if (!editor.id && editor.type === type && isAutoQuoteNo(f.value.trim(), type, date)) f.value = nextQuoteNo(type, date);
}
/** Chiết khấu toàn bảng chọn lúc tạo báo giá: áp cho mọi dòng mới (vẫn sửa riêng từng dòng được). */
const defaultLineDiscount = () => editor.defaultDiscount > 0 ? { discount: editor.defaultDiscount, discountType: 'percent' } : {};
const blankRow = () => ({ id: uid(), name: '', sku: '', unit: '', qty: 1, price: 0, discount: 0, discountType: editor.discountMode || 'percent', printFee: 0, packagingDescription: PACKAGING_DEFAULT, ...defaultLineDiscount() });
function newQuoteData(extra = {}) {
  const type = extra.type || 'B2B', date = extra.date || todayIso();
  const paymentTerms = extra.paymentTerms || defaultPaymentTerms(type);
  return { type, quoteNo: nextQuoteNo(type, date), date, vat: 8, customer: '', owner: state.user?.name || '', ownerPhone: state.user?.phone || '', notes: withPaymentNotes(QUOTE_NOTES[type] || QUOTE_NOTES.HRC, paymentTerms, 0, moneyWords), notesVersion: 2, paymentTerms, ...extra, rows: extra.rows || [] };
}

let editorLoadSequence = 0;
async function openEditor(id) {
  const sequence = ++editorLoadSequence, requestedHash = location.hash;
  const current = () => sequence === editorLoadSequence && location.hash === requestedHash;
  $('#quote-error').textContent = ''; $('#conflict-banner').hidden = true;
  if (id === 'new') {
    editor.loading = false; qf.inert = false;
    const pending = editor.pending; editor.pending = null;
    editor.defaultDiscount = Number(pending?.defaultDiscount) || 0;
    if (pending) delete pending.defaultDiscount;
    fillEditor(null, 0, pending || newQuoteData());
    if (pending) markDirty();
    syncEditorQuoteNo();
    setTimeout(() => { if (current() && !qf.contains(document.activeElement)) (pending?.customer ? field('quoteNo') : field('customer')).focus(); }, 50);
    return;
  }
  if (editor.id === id && !editor.loading && editor.dirty) return; // quay lại đúng báo giá đang sửa
  editor.loading = true;
  $('#editor-title').textContent = 'Đang tải báo giá…';
  qf.inert = true;
  try {
    const q = await api('/quotes/' + encodeURIComponent(id));
    if (!current() || editor.dirty) return;
    fillEditor(q.id, q.revision, q.data, q);
  } catch (e) {
    if (!current()) return;
    toast(e.message, 'err');
    if (e.status !== 401) { editor.dirty = false; go('#/quotes'); }
  } finally { if (current()) { editor.loading = false; qf.inert = false; } }
}

function fillEditor(id, revision, data, meta = {}) {
  // Lưu xong (cùng báo giá) thì giữ nguyên mục lợi nhuận / cột giá nhập đang mở; mở báo giá khác thì đóng lại.
  const keepProfit = !!id && (editor.id === id || (!editor.id && saving));
  editor.approval = id ? { status: meta.approvalStatus || 'pending', at: meta.approvedAt || '', by: meta.approvedByName || '', canApprove: meta.canApprove ?? (keepProfit ? editor.approval?.canApprove : undefined), fromCustomer: meta.fromCustomer ?? (keepProfit ? editor.approval?.fromCustomer : false), canEdit: meta.canEdit ?? (keepProfit ? editor.approval?.canEdit : undefined) } : null;
  editor.id = id; editor.revision = revision; editor.base = structuredClone(data);
  editor.type = ['B2B', 'HRC', 'VIGIFTS'].includes(data.type) ? data.type : 'B2B';
  editor.customerId = data.customerId || ''; editor.customerName = data.customerId ? data.customer : ''; loadBrandDiscounts();
  editor.rows = (data.rows || []).map(r => ({ ...r, id: r.id || uid(), discountType: r.discountType || 'percent' }));
  setMobileQuoteStep('info', false);
  qf.reset();
  for (const name of ['quoteNo', 'date', 'owner', 'ownerPhone', 'customer', 'contact', 'phone', 'email', 'customerTaxCode', 'customerAddress', 'notes', 'internalNote'])
    field(name).value = data[name] ?? '';
  field('deliveryDate').value = data.deliveryDate || data.delivery_date || '';
  syncDeliveryNotes();
  field('vat').value = fmtNum(Number(data.vat ?? 8));
  editor.discountMode = data.discountMode || editor.rows[0]?.discountType || 'percent';
  if (!keepProfit) editor.showCostFields = false;
  setProfit(keepProfit && editor.showProfit);
  setType(editor.type, false);
  $('#editor-title').textContent = id ? data.quoteNo || 'Báo giá' : 'Tạo báo giá';
  $('#editor-revision').hidden = !id; $('#editor-revision').textContent = 'Phiên bản ' + revision;
  $('#duplicate-quote').hidden = !id;
  $('#breadcrumb').textContent = id ? data.quoteNo || 'Sửa báo giá' : 'Tạo báo giá';
  $$('input, textarea', qf).forEach(i => i.classList.remove('invalid'));
  renderLines(); updateContactsButton();
  editor.dirty = false; $('#editor-dirty').hidden = true;
  refreshQuoteDocument(id); refreshQuoteHold(id);
  updateQuoteActions();
  fillMissingImages();
}
function markDirty() { if (!editor.dirty) { editor.dirty = true; $('#editor-dirty').hidden = false; updateQuoteActions(); } }
qf.addEventListener('input', e => {
  if (e.target.name === 'notes') editor.base.paymentNotesManual = true;
  markDirty();
  if (e.target.name === 'deliveryDate') syncDeliveryNotes();
  if (e.target.name === 'vat') { const v = parseNum(e.target.value); e.target.classList.toggle('invalid', !(v >= 0 && v <= 100)); calculate(); }
  if (['customer', 'phone'].includes(e.target.name)) {
    if (editor.customerName && e.target.name === 'customer' && e.target.value.trim() !== editor.customerName) { editor.customerId = ''; editor.customerName = ''; editor.base.customerCode = ''; editor.brandDiscounts = null; }
    updateContactsButton();
  }
  if (e.target.name === 'quoteNo') $('#editor-title').textContent = e.target.value || 'Báo giá';
});
field('vat').addEventListener('blur', e => { const v = parseNum(e.target.value); if (v >= 0) e.target.value = fmtNum(v); });

function setType(type, dirty = true) {
  // Ghi chú còn là mặc định của loại cũ (hoặc trống) thì đổi theo loại mới, như web cũ.
  const notes = field('notes');
  if (dirty && (!notes.value.trim() || notes.value === notesWithDeliveryDate(defaultNotes(editor.type), field('deliveryDate').value))) notes.value = defaultNotes(type);
  syncDeliveryNotes();
  // Báo giá chưa lưu còn số tự sinh của loại cũ thì đổi sang tiền tố của loại mới.
  const reNumber = dirty && !editor.id && isAutoQuoteNo(field('quoteNo').value.trim(), editor.type, field('date').value);
  if (reNumber) field('quoteNo').value = nextQuoteNo(type, field('date').value);
  editor.type = type;
  if (reNumber) syncEditorQuoteNo();
  $$('#type-seg button').forEach(b => b.setAttribute('aria-checked', String(b.dataset.value === type)));
  $('#type-hint').textContent = type === 'HRC' ? 'Báo giá HRC: không có cột phí in.' : 'Phí in (F7) được cộng vào giá sau chiết khấu.';
  qf.classList.toggle('type-hrc', type === 'HRC');
  if (dirty) { markDirty(); }
  renderLines();
}
$('#type-seg').addEventListener('click', e => { const b = e.target.closest('button'); if (b && b.dataset.value !== editor.type) setType(b.dataset.value); });
// Manager: "Xem lợi nhuận tạm tính" mở mục "Lợi nhuận nhanh" như web cũ; nút "Xem giá nhập" trong mục đó mới hiện 2 cột CK mua vào / Giá nhập.
function setProfit(on) {
  editor.showProfit = on && isManager();
  $('#profit-card').hidden = !editor.showProfit;
  $('#toggle-profit').textContent = editor.showProfit ? 'Ẩn lợi nhuận tạm tính' : 'Xem lợi nhuận tạm tính';
  $('#toggle-profit').setAttribute('aria-expanded', String(editor.showProfit));
  refreshCostToggle();
}
function refreshCostToggle() {
  const b = $('#toggle-cost-fields');
  b.textContent = editor.showCostFields ? 'Ẩn giá nhập' : 'Xem giá nhập'; b.setAttribute('aria-pressed', String(!!editor.showCostFields));
}
$('#toggle-profit').addEventListener('click', () => { setProfit(!editor.showProfit); renderLines(); });
$('#toggle-cost-fields').addEventListener('click', () => {
  if (!isManager()) return;
  editor.showCostFields = !editor.showCostFields; refreshCostToggle(); renderLines();
  toast(editor.showCostFields ? 'Đã hiện cột giá nhập' : 'Đã ẩn cột giá nhập');
});

// ----- dòng sản phẩm (cột theo web cũ: HRC không có Phí in; B2B/VIGIFTS có Phí in F7, Bộ gồm, Mô tả in ấn, Đóng gói)
const NUM_FIELDS = { qty: 4, price: 2, discount: 2, printFee: 2 };
const showCostCols = () => !!editor.showCostFields && isManager();
function lineHead() {
  const modes = new Set(editor.rows.map(r => r.discountType || 'percent'));
  const mode = modes.size > 1 ? 'mixed' : [...modes][0] || editor.discountMode || 'percent';
  const disc = `<span class="disc-head">CK (F6)<select id="discount-mode" aria-label="Đơn vị chiết khấu cả cột">${mode === 'mixed' ? '<option value="mixed" selected disabled>Nhiều loại</option>' : ''}<option value="percent" ${mode === 'percent' ? 'selected' : ''}>%</option><option value="amount" ${mode === 'amount' ? 'selected' : ''}>đ/SP</option></select></span>`;
  const hrc = editor.type === 'HRC';
  return `<tr><th class="col-idx">STT</th><th class="col-img">Hình ảnh</th><th class="col-product">${hrc ? 'Sản phẩm / Mã hàng' : 'Tên hàng / Mã hàng'}</th><th class="col-unit">ĐVT</th><th class="col-qty">Số lượng</th><th class="col-price">Đơn giá</th><th class="col-disc">${disc}</th>${hrc ? '' : '<th class="col-print">Phí in (F7)</th>'}<th class="col-after right">${hrc ? 'Đơn giá CK' : 'Giá sau CK'}</th><th class="col-total right">Thành tiền</th>${showCostCols() ? '<th class="col-pd">Giá nhập / CK mua</th><th class="col-cost right">Giá nhập</th>' : ''}<th class="col-act"><span class="sr-only">Xoá</span></th></tr>`;
}
function packingSpec(r) {
  const n = v => Number(v).toLocaleString('vi-VN', { maximumFractionDigits: 3 }), parts = [];
  if (Number(r.perCarton) > 0) parts.push(`${n(r.perCarton)} ${r.unit || 'cái'}/thùng`);
  if (Number(r.cartonWeight) > 0) parts.push(`nặng ${n(r.cartonWeight)} kg/thùng`);
  return parts.join('; ');
}
function lineCell(r, i) {
  const n = (k, label, extra = '') => `<input class="num-input" inputmode="decimal" data-k="${k}" value="${fmtNum(Number(r[k] || 0), NUM_FIELDS[k])}" aria-label="${label} dòng ${i + 1}" ${extra}>`;
  const costMode = costModeOf(r), costValue = costMode === 'manual' ? r.costPrice : r.purchaseDiscount;
  const hrc = editor.type === 'HRC';
  const meta = [r.brand, r.pattern, r.pricePolicy, Number.isFinite(r.taxRate) ? `VAT ${fmtNum(r.taxRate)}%` : ''].filter(Boolean).join(' · ');
  const text = (k, label, ph) => `<label class="sub-field"><span>${label}</span><input data-k="${k}" value="${esc(r[k] ?? '')}" placeholder="${ph}" maxlength="2000"></label>`;
  if (!hrc && r.packagingDescription === undefined) r.packagingDescription = PACKAGING_DEFAULT;
  const manual = !r.sku && !r.image;
  return `<tr data-i="${i}" class="${manual ? 'manual-line' : ''}">
    <td class="col-idx">${i + 1}</td>
    <td class="col-img"><button type="button" class="img-btn" data-image title="${r.image ? 'Đổi hình' : 'Chèn hình'}">${r.image ? imgTag(r.image) : `<span class="thumb add">${PLACEHOLDER}<small>Chèn hình</small></span>`}</button></td>
    <td class="col-product" data-label="Sản phẩm">
      <input class="name-input" data-k="name" value="${esc(r.name)}" placeholder="${manual ? 'Tên phụ phí / nội dung thêm…' : 'Gõ tên hoặc mã để tìm sản phẩm…'}" maxlength="4000" aria-label="Tên sản phẩm dòng ${i + 1}">
      <div class="sku-line"><input class="plain sku-input" data-k="sku" value="${esc(r.sku)}" placeholder="Mã hàng" maxlength="4000" aria-label="Mã hàng dòng ${i + 1}">${r.sku ? '<button type="button" class="link-btn" data-stock title="Tồn các kho + lịch sử 20 giao dịch gần nhất">Tồn kho · Lịch sử</button>' : ''}</div>
      ${meta ? `<div class="product-meta">${esc(meta)}</div>` : ''}
      ${hrc && packingSpec(r) ? `<div class="product-meta">Đóng gói: ${esc(packingSpec(r))}</div>` : ''}
      ${hrc ? '' : text('bundleContents', 'Bộ gồm', 'Ví dụ: 01 ly + 01 nắp') + text('printDescription', 'Mô tả in ấn', 'Ví dụ: in logo màu tại 01 vị trí') + text('packagingDescription', 'Đóng gói', PACKAGING_DEFAULT)}
    </td>
    <td class="col-unit" data-label="ĐVT"><input class="plain" data-k="unit" value="${esc(r.unit)}" placeholder="—" maxlength="40" aria-label="Đơn vị tính dòng ${i + 1}"></td>
    <td class="col-qty" data-label="Số lượng">${n('qty', 'Số lượng')}</td>
    <td class="col-price" data-label="Đơn giá"><div class="unit-field">${n('price', 'Đơn giá')}<b>đ</b></div></td>
    <td class="col-disc" data-label="CK (F6)"><div class="unit-field">${n('discount', 'Chiết khấu')}<b>${r.discountType === 'amount' ? 'đ' : '%'}</b></div></td>
    ${hrc ? '' : `<td class="col-print" data-label="Phí in (F7)"><div class="unit-field">${n('printFee', 'Phí in')}<b>đ</b></div></td>`}
    <td class="col-after num-cell" data-label="${hrc ? 'Đơn giá CK' : 'Giá sau CK'}"></td>
    <td class="line-total" data-label="Thành tiền"></td>
    ${showCostCols() ? `<td class="col-pd" data-label="Giá nhập / CK mua"><select data-cost-mode aria-label="Cách nhập giá vốn dòng ${i + 1}"><option value="discount"${costMode === 'discount' ? ' selected' : ''}>CK mua vào %</option><option value="manual"${costMode === 'manual' ? ' selected' : ''}>Giá trực tiếp</option></select><div class="unit-field"><input class="num-input" inputmode="text" data-k="purchaseCost" value="${Number.isFinite(costValue) ? fmtNum(costValue, 2) : ''}" placeholder="${costMode === 'manual' ? 'VD: 160k' : 'VD: 58%'}" aria-label="Giá nhập hoặc CK mua dòng ${i + 1}"><b data-cost-unit>${costMode === 'manual' ? 'đ' : '%'}</b></div></td><td class="col-cost num-cell" data-label="Giá nhập"></td>` : ''}
    <td class="line-actions"><button type="button" class="icon-btn danger" data-del title="Xoá dòng" aria-label="Xoá dòng ${i + 1}">×</button></td>
  </tr>`;
}
// Ẩn / hiện 3 dòng Bộ gồm · Mô tả in ấn · Đóng gói của mọi dòng (chỉ ẩn trên màn hình; dữ liệu, PDF, Excel giữ nguyên).
// Nhớ lựa chọn trên máy này (localStorage; không đọc được thì mặc định hiện).
const SUBS_KEY = 'bn-quote-hide-subs';
function applySubs(hide) {
  $('.lines-wrap').classList.toggle('hide-subs', hide);
  const b = $('#toggle-subs'); b.textContent = hide ? 'Hiện mô tả' : 'Ẩn mô tả'; b.setAttribute('aria-pressed', String(hide));
}
try { applySubs(localStorage.getItem(SUBS_KEY) === '1'); } catch { applySubs(false); }
$('#toggle-subs').addEventListener('click', () => {
  const hide = !$('.lines-wrap').classList.contains('hide-subs'); applySubs(hide);
  try { localStorage.setItem(SUBS_KEY, hide ? '1' : '0'); } catch { /* chế độ riêng tư: chỉ nhớ trong lượt này */ }
});
function renderLines(focus) {
  $('#line-head').innerHTML = lineHead();
  // Báo giá chưa có sản phẩm: thay dòng trống số 1 bằng lời mời "+ Thêm sản phẩm".
  $('#line-list').innerHTML = editor.rows.length ? editor.rows.map(lineCell).join('')
    : `<tr class="line-empty"><td colspan="${$$('#line-head th').length || 1}"><button type="button" class="add-first" data-add-first>＋ Thêm sản phẩm</button></td></tr>`;
  $('#line-count').textContent = `(${editor.rows.length})`;
  $('#m-line-count').textContent = `${editor.rows.length} sản phẩm`;
  if ($('#shipping-card').open) renderShippingRows();
  qf.classList.toggle('type-hrc', editor.type === 'HRC');
  $('#toggle-subs').hidden = editor.type === 'HRC'; // HRC không có 3 dòng mô tả
  calculate();
  if (focus !== undefined) $(`#line-list tr[data-i="${focus}"] [data-k="name"]`)?.focus();
}
function validateRowInput(input, r) {
  const k = input.dataset.k, v = parseNum(input.value);
  let ok = Number.isFinite(v) && v >= 0;
  if (k === 'discount') ok = ok && (r.discountType === 'amount' ? v <= Number(r.price || 0) : v <= 100);
  input.classList.toggle('invalid', !ok);
  return ok ? v : null;
}
/** Dòng theo CK tính lại từ đơn giá; dòng giá thủ công giữ nguyên. */
function syncCost(r) {
  syncPurchaseCost(r);
}
$('#line-head').addEventListener('change', e => {
  if (e.target.id !== 'discount-mode') return;
  const mode = e.target.value;
  for (const r of editor.rows) {
    if ((r.discountType || 'percent') === mode) continue;
    const v = Number(r.discount) || 0;
    r.discount = mode === 'amount' ? Number(r.price || 0) * v / 100 : (r.price ? v / r.price * 100 : 0);
    r.discountType = mode;
  }
  editor.discountMode = mode; markDirty(); renderLines();
});
function costInput(input, r) {
  const parsed = parsePurchaseCost(input.value, costModeOf(r));
  input.classList.toggle('invalid', parsed === null);
  if (!parsed) return false;
  applyPurchaseCost(r, parsed);
  const tr = input.closest('tr');
  tr.querySelector('[data-cost-mode]').value = parsed.mode;
  tr.querySelector('[data-cost-unit]').textContent = parsed.mode === 'manual' ? 'đ' : '%';
  input.placeholder = parsed.mode === 'manual' ? 'VD: 160k' : 'VD: 58%';
  return true;
}
$('#line-list').addEventListener('change', e => {
  const select = e.target.closest('[data-cost-mode]'); if (!select || !isManager()) return;
  const tr = select.closest('tr'), r = editor.rows[tr.dataset.i], mode = select.value;
  applyPurchaseCost(r, { mode, value: mode === 'manual' && Number.isFinite(r.costPrice) ? r.costPrice : null });
  markDirty(); renderLines();
  $(`#line-list tr[data-i="${tr.dataset.i}"] [data-k="purchaseCost"]`)?.focus();
});
$('#line-list').addEventListener('input', e => {
  const input = e.target.closest('[data-k]'); if (!input) return;
  const r = editor.rows[input.closest('tr').dataset.i], k = input.dataset.k;
  if (k === 'purchaseCost') { if (!isManager()) return; costInput(input, r); }
  else if (k in NUM_FIELDS) {
    const v = validateRowInput(input, r);
    r[k] = v ?? 0;
    if (k === 'price') { const d = input.closest('tr').querySelector('[data-k="discount"]'); validateRowInput(d, r); }
    syncCost(r);
  } else r[k] = input.value;
  markDirty(); calculate();
});
$('#line-list').addEventListener('focusout', e => {
  const cost = e.target.closest('[data-k="purchaseCost"]');
  if (cost && !cost.classList.contains('invalid')) {
    const r = editor.rows[cost.closest('tr').dataset.i], value = costModeOf(r) === 'manual' ? r.costPrice : r.purchaseDiscount;
    cost.value = Number.isFinite(value) ? fmtNum(value, 2) : ''; return;
  }
  const input = e.target.closest('[data-k]'); if (!input || !(input.dataset.k in NUM_FIELDS) || input.classList.contains('invalid')) return;
  const r = editor.rows[input.closest('tr').dataset.i], k = input.dataset.k;
  input.value = fmtNum(Number(r[k] || 0), NUM_FIELDS[k]);
});
let selectedLine = 0;
$('#line-list').addEventListener('focusin', e => {
  const tr = e.target.closest('tr[data-i]'); if (tr) selectedLine = Number(tr.dataset.i);
  if (e.target.classList?.contains('num-input')) setTimeout(() => e.target.select(), 0);
});
$('#line-list').addEventListener('keydown', e => {
  // Enter → xuống ô cùng cột ở dòng dưới; ở dòng cuối thì thêm dòng trống.
  if (e.key !== 'Enter' || !e.target.matches('input')) return;
  e.preventDefault();
  const tr = e.target.closest('tr'), i = Number(tr.dataset.i);
  if (i === editor.rows.length - 1) addLine(); else $(`#line-list tr[data-i="${i + 1}"] [data-k="${e.target.dataset.k}"]`)?.focus();
});
// F6: chiết khấu, F7: phí in của dòng đang chọn (như web cũ).
document.addEventListener('keydown', e => {
  if (!['F6', 'F7'].includes(e.key) || e.ctrlKey || e.altKey || e.metaKey || $('#view-editor').hidden || document.querySelector('dialog[open]')) return;
  e.preventDefault();
  const tr = $(`#line-list tr[data-i="${selectedLine}"]`) || $('#line-list tr');
  const input = tr?.querySelector(`[data-k="${e.key === 'F6' ? 'discount' : 'printFee'}"]`);
  if (!input) { toast(e.key === 'F7' ? 'Phí in có trên báo giá B2B và Vigifts.' : 'Thêm sản phẩm trước khi nhập chiết khấu.', 'err'); return; }
  input.focus(); input.select(); input.scrollIntoView({ block: 'nearest' });
});
$('#line-list').addEventListener('click', async e => {
  if (e.target.closest('[data-add-first]')) return $('#pick-products').click();
  const tr = e.target.closest('tr'); if (!tr) return;
  const i = Number(tr.dataset.i), rows = editor.rows;
  if (e.target.closest('[data-stock]')) return showProductCard(rows[i].sku, rows[i].name);
  if (e.target.closest('[data-image]')) return openImage(i);
  if (!e.target.closest('[data-del]')) return;
  const r = rows[i];
  if ((r.name || r.price) && !await confirmBox(`Xoá dòng "${r.name || 'sản phẩm ' + (i + 1)}"?`, { ok: 'Xoá', danger: true, delay: 0 })) return;
  rows.splice(i, 1);
  markDirty(); renderLines();
});
/** 4 kho xem nhanh trên báo giá, đúng thứ tự web cũ (`quoteWebWarehouses` trong lib/product-catalog.mjs). */
const QUOTE_WAREHOUSES = ['MINH LONG - LOCKNLOCK CẦN THƠ', 'KHO VIGIFTS', 'NCC', 'Hàng chờ về'];
/** Tồn kho của một mã (đúng 4 kho xem nhanh như web cũ; tên kho không khớp thì hiện mọi kho). */
async function stockHtml(sku) {
  const d = await api('/products?skus=' + encodeURIComponent(sku));
  const p = d.products.find(x => normalize(x.sku) === normalize(sku));
  if (!p) return { html: '<p class="muted">Chưa tìm thấy mã hàng này trong dữ liệu tồn kho hiện tại.</p>', product: null };
  const byName = new Map(d.warehouses.map(w => [normalize(w.name), w]));
  const list = (QUOTE_WAREHOUSES.some(n => byName.has(normalize(n))) ? QUOTE_WAREHOUSES.map(n => byName.get(normalize(n)) || { name: n }) : d.warehouses)
    .filter(w => hasSupplierStock(p) || !(w.kind === 'supplier' || normalize(w.name) === normalize('NCC')));
  const rows = list.map(w => { const v = w.id ? p.stock?.[w.id] : undefined; return `<div><span>${esc(w.name)}</span><strong>${v === undefined || v === null ? '—' : fmtNum(Number(v))}</strong></div>`; }).join('');
  const at = p.stockUpdatedAt || d.observedAt;
  return { product: p, html: `<div class="inventory-list">${rows}</div><p class="muted small">Cập nhật tồn gần nhất: ${esc(at ? new Date(at).toLocaleString('vi-VN') : 'Chưa có thời điểm cập nhật')}</p>` };
}
document.addEventListener('click', e => { const b = e.target.closest('[data-product-card]'); if (b) showProductCard(b.dataset.productCard, b.dataset.name); });
/** Loại biến động trong lịch sử sản phẩm: nhãn, màu, chiều (+ nhập / − xuất). Cùng khoá với PRODUCT_MOVE_KINDS ở máy chủ. */
const MOVE_UI = {
  sale: ['Bán', 'order', ''], delivery: ['Xuất kho giao hàng', 'debt', '−'], purchase: ['Nhập hàng', 'stock', '+'], transfer: ['Điều chuyển', 'delivery', ''],
  adjustment: ['Cân bằng kho', 'purchase', '±'], customer_return: ['Khách trả hàng', 'contract', '+'], supplier_return: ['Trả hàng NCC', 'quote', '−'],
};
/**
 * Thẻ sản phẩm: tồn các kho + LỊCH SỬ SẢN PHẨM (20 giao dịch gần nhất: bán, xuất kho, nhập hàng, điều chuyển, cân bằng kho, trả hàng).
 * Mở khi bấm vào sản phẩm ở trang Sản phẩm, hoặc "Tồn kho · Lịch sử" ở dòng báo giá.
 */
async function showProductCard(sku, name) {
  const dlg = document.createElement('dialog'); dlg.className = 'modal wide product-card';
  dlg.innerHTML = `<div class="modal-head"><div><span class="eyebrow">Sản phẩm · ${esc(sku)}</span><h2>${esc(name || sku)}</h2></div><button type="button" class="icon-btn" data-x aria-label="Đóng">×</button></div>
    <div class="modal-body"><h3 class="pc-title">Tồn kho hiện tại</h3><div data-stock-box><p class="muted">Đang tải tồn kho…</p></div>
      <div class="pc-head"><h3 class="pc-title">Lịch sử sản phẩm <small class="muted">· 20 giao dịch gần nhất</small></h3><div class="chips pc-filter" data-filter></div></div><div data-history><p class="muted">Đang tải lịch sử…</p></div></div>
    <div class="modal-foot"><button type="button" class="btn navy" data-x>Đóng</button></div>`;
  document.body.append(dlg); dlg.showModal();
  const close = () => { dlg.close(); };
  dlg.addEventListener('close', () => {
    const params = new URLSearchParams(location.hash.split('?')[1] || '');
    if (location.hash.startsWith('#/products?') && params.get('sku') === sku) {
      params.delete('sku');
      history.replaceState(null, '', location.pathname + location.search + '#/products' + (params.size ? '?' + params : ''));
    }
  });
  dlg.querySelectorAll('[data-x]').forEach(b => b.addEventListener('click', close)); dlg.addEventListener('close', () => dlg.remove());
  stockHtml(sku).then(r => {
    if (!dlg.isConnected) return;
    dlg.querySelector('[data-stock-box]').innerHTML = r.html;
    if (!name && r.product?.name) dlg.querySelector('h2').textContent = r.product.name;
  }).catch(ex => { if (!dlg.isConnected) return; dlg.querySelector('[data-stock-box]').innerHTML = `<p class="error">${esc(ex.message)}</p>`; });
  const box = dlg.querySelector('[data-history]');
  let d;
  try { d = await api('/products/' + encodeURIComponent(sku) + '/history'); } catch (ex) { box.innerHTML = `<p class="error">${esc(ex.message)}</p>`; return; }
  if (!d.history.length) { box.innerHTML = '<p class="muted">Chưa có giao dịch nào cho mã này (bán, xuất kho, nhập hàng, điều chuyển, cân bằng kho, trả hàng).</p>'; return; }
  const kinds = [...new Set(d.history.map(h => h.kind))];
  let filter = '';
  const qtyCell = h => { const m = MOVE_UI[h.kind] || ['', '', '']; const sign = m[2] === '±' ? (h.qty > 0 ? '+' : h.qty < 0 ? '−' : '') : m[2]; const tone = sign === '+' ? 'paid-text' : sign === '−' ? 'danger-text' : '';
    return `<b class="${tone}">${sign}${fmtNum(Math.abs(h.qty))}</b>${h.unit ? ' ' + esc(h.unit) : ''}`; };
  const render = () => {
    const rows = d.history.filter(h => !filter || h.kind === filter);
    box.innerHTML = (d.sales ? `<div class="stats sh-stats">${[['Giá bán gần nhất', d.sales.last], ['Thấp nhất', d.sales.min], ['Cao nhất', d.sales.max], ['Trung bình', d.sales.avg]].map(([k, v]) => `<article class="stat"><small>${k}</small><strong>${money(v)}</strong></article>`).join('')}</div>` : '')
      + `<div class="table-wrap"><table class="data-table pc-table"><thead><tr><th>Thời gian</th><th>Loại</th><th>Chứng từ</th><th>Khách / NCC · Kho</th><th class="right">Số lượng</th><th class="right">Đơn giá</th></tr></thead><tbody>
      ${rows.map(h => `<tr><td>${fmtDate(h.occurredAt)}<small>${new Date(h.occurredAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}</small></td>
        <td><span class="pill src ${MOVE_UI[h.kind]?.[1] || ''}">${esc(MOVE_UI[h.kind]?.[0] || h.kind)}</span>${h.status ? `<small>${esc(h.status)}</small>` : ''}</td>
        <td>${h.link && linkAllowed(h.link) ? `<a href="${esc(h.link)}" data-close-card>${esc(h.refCode)}</a>` : esc(h.refCode) || '—'}</td>
        <td>${esc(h.partner) || '<span class="muted">—</span>'}${h.location ? `<small>${esc(h.location)}</small>` : ''}${h.note ? `<small>${esc(h.note)}</small>` : ''}</td>
        <td class="right">${qtyCell(h)}</td><td class="right num">${h.unitPrice === null || h.unitPrice === undefined ? '—' : money(h.unitPrice)}</td></tr>`).join('')}</tbody></table></div>
      <p class="muted small">Bán: đơn đặt hàng đã xác nhận (đơn giá sau CK, chưa VAT) · Xuất kho: chuyến giao "Đã giao" · Nhập hàng, điều chuyển, cân bằng kho, trả hàng: chứng từ kho đồng bộ từ Sapo.</p>`;
    box.querySelectorAll('[data-close-card]').forEach(a => a.addEventListener('click', close));
  };
  const chipsBox = dlg.querySelector('[data-filter]');
  chipsBox.innerHTML = kinds.length > 1 ? [['', 'Tất cả'], ...kinds.map(k => [k, MOVE_UI[k]?.[0] || k])].map(([k, l]) => `<button type="button" class="chip" data-k="${esc(k)}" aria-pressed="${k === filter}">${esc(l)}</button>`).join('') : '';
  chipsBox.addEventListener('click', e => { const b = e.target.closest('[data-k]'); if (!b) return; filter = b.dataset.k; chipsBox.querySelectorAll('[data-k]').forEach(x => x.setAttribute('aria-pressed', String(x === b))); render(); });
  render();
}
// ----- hình của dòng (HRC: hình sản phẩm; B2B/VIGIFTS: maquette) – link ảnh hoặc tải ảnh lên, như web cũ
let imageRow = -1, pendingImage = '';
function drawImagePreview() { $('#image-preview').innerHTML = pendingImage ? imgTag(pendingImage, 'thumb big') : '<span class="muted">Chưa có ảnh</span>'; $('#image-remove').hidden = !pendingImage; }
function openImage(i) {
  imageRow = i; pendingImage = editor.rows[i].image || '';
  $('#image-title').textContent = editor.type === 'HRC' ? 'Hình sản phẩm' : 'Maquette';
  $('#image-url').value = pendingImage.startsWith('data:') ? '' : pendingImage; $('#image-error').textContent = '';
  drawImagePreview(); $('#image-dialog').showModal();
}
$('#image-url').addEventListener('input', e => {
  const v = e.target.value.trim(); $('#image-error').textContent = '';
  if (!v) { pendingImage = ''; drawImagePreview(); return; }
  if (!/^https:\/\//i.test(v)) { $('#image-error').textContent = 'Link ảnh phải bắt đầu bằng https://'; return; }
  pendingImage = v; drawImagePreview();
});
$('#image-file').addEventListener('change', async e => {
  const file = e.target.files?.[0]; e.target.value = ''; if (!file) return;
  $('#image-error').textContent = 'Đang xử lý ảnh…';
  try { pendingImage = await compressImage(file); $('#image-url').value = ''; $('#image-error').textContent = ''; drawImagePreview(); }
  catch (ex) { $('#image-error').textContent = ex.message; }
});
$('#image-remove').addEventListener('click', () => { pendingImage = ''; $('#image-url').value = ''; drawImagePreview(); });
$('#image-save').addEventListener('click', () => {
  const r = editor.rows[imageRow]; if (!r) return;
  if (pendingImage) r.image = pendingImage; else delete r.image;
  $('#image-dialog').close(); markDirty(); renderLines();
});
/** Dòng có mã hàng nhưng chưa có ảnh (vd báo giá cũ): lấy ảnh từ danh mục, như imageMap của web cũ. */
async function fillMissingImages() {
  const skus = [...new Set(editor.rows.filter(r => r.sku && !r.image).map(r => r.sku))].slice(0, 300);
  if (!skus.length) return;
  try {
    const d = await api('/products?skus=' + encodeURIComponent(skus.join(',')));
    const bySku = new Map(d.products.filter(p => savableImage(p.imageUrl)).map(p => [p.sku, p.imageUrl]));
    let changed = false;
    for (const r of editor.rows) if (r.sku && !r.image && bySku.has(r.sku)) { r.image = bySku.get(r.sku); changed = true; }
    if (changed) renderLines();
  } catch { /* không có ảnh thì giữ nguyên */ }
}

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
  syncPaymentNotes(t.total);
  editor.rows.forEach((r, i) => {
    const tr = $(`#line-list tr[data-i="${i}"]`); if (!tr) return;
    const unit = after(r, doc);
    tr.querySelector('.col-after').textContent = fmtNum(unit) + ' đ';
    tr.querySelector('.line-total').textContent = money(unit * Number(r.qty || 0));
    const cost = tr.querySelector('.col-cost'); if (cost) cost.textContent = Number.isFinite(r.costPrice) ? money(r.costPrice) : '—';
  });
  if ($('#shipping-card').open) renderShippingSummary();
  $('#sum-subtotal').textContent = money(t.subtotal);
  $('#sum-tax-label').textContent = t.label;
  $('#sum-tax').textContent = money(t.tax);
  $('#sum-total').textContent = $('#m-total').textContent = money(t.total);
  $('#words-total').textContent = t.total > 0 ? 'Bằng chữ: ' + moneyWords(t.total) + '.' : '';
  if (editor.showProfit) renderProfit(doc);
  return t;
}

// ----- Lợi nhuận tạm tính (port refreshProfit / refreshPrintingCosts / updatePurchaseCosts của web cũ)
let workshopList = DEFAULT_WORKSHOPS.map(name => ({ name })), workshopLoad = null, workshopTarget = '';
function renderProfit(doc = currentDoc()) {
  const ship = shippingCalc(editor.rows, shipOpts()), p = profit(doc, ship.fee), payer = shipOpts().payer || 'receiver';
  renderPrintingCosts(doc);
  $('#sum-revenue').textContent = money(p.revenue);
  $('#sum-commission').textContent = money(p.commission);
  $('#sum-cost').textContent = money(p.cost);
  $('#sum-shipping').textContent = ship.fee === null ? 'Chưa có cước dự toán' : money(ship.fee);
  $$('input[name="profitShippingPayer"]').forEach(i => { i.checked = i.value === payer; });
  $('#profit-shipping-hint').hidden = payer !== 'sender' || ship.fee !== null;
  $('#sum-gross').textContent = money(p.gross); $('#sum-gross').className = p.gross < 0 ? 'neg' : '';
  $('#sum-margin').textContent = fmtNum(p.margin, 1) + '%'; $('#sum-margin').classList.toggle('neg', p.margin < 0);
}
/**
 * CK cho khách ("tiền cà phê"): popup theo từng mã hàng – đơn giá sau CK (không phí in), SL, CK theo % hoặc đ/SP, tiền CK.
 * Lưu ở `row.commission` {mode, value, excluded}; lợi nhuận gộp trừ tổng CK (quote-math `commissionOf`).
 */
const commissionRows = () => editor.rows.filter(r => (r.name || '').trim() || (r.sku || '').trim() || Number(r.price));
function renderCommission() {
  const rows = commissionRows(), active = rows.filter(r => !r.commission?.excluded), off = rows.filter(r => r.commission?.excluded);
  const host = $('#commission-rows'), typing = host.contains(document.activeElement) && document.activeElement.matches('[data-commission-value]');
  if (typing) host.querySelectorAll('[data-commission-total]').forEach(el => { const r = editor.rows.find(x => x.id === el.dataset.commissionTotal); if (r) el.textContent = money(commissionOf(r)); });
  else host.innerHTML = active.length ? active.map(r => `<tr data-commission-id="${esc(r.id)}"><td><b>${esc(r.sku || 'Chưa có mã')}</b><small>${esc(r.name || '')}</small></td>
      <td class="right num" data-label="Đơn giá sau CK">${money(discounted(r))}</td><td class="right" data-label="SL">${fmtNum(Number(r.qty || 0))}</td>
      <td><div class="commission-input"><input class="num-input" type="number" inputmode="decimal" min="0" step="any" data-commission-value aria-label="CK cho khách ${esc(r.sku || r.name || '')}" value="${r.commission?.value || ''}" placeholder="0">
        <select data-commission-mode aria-label="Kiểu CK"><option value="percent"${r.commission?.mode !== 'amount' ? ' selected' : ''}>%</option><option value="amount"${r.commission?.mode === 'amount' ? ' selected' : ''}>đ/SP</option></select></div></td>
      <td class="right num" data-label="Tiền CK"><b data-commission-total="${esc(r.id)}">${money(commissionOf(r))}</b></td>
      <td><button type="button" class="icon-btn" data-commission-exclude title="Không tính CK cho dòng này" aria-label="Bỏ dòng ${esc(r.sku || r.name || '')}">×</button></td></tr>`).join('')
    : '<tr><td colspan="6" class="muted">Không có dòng nào tính CK.</td></tr>';
  $('#commission-total').textContent = money(rows.reduce((s, r) => s + commissionOf(r), 0));
  $('#commission-excluded').innerHTML = off.length ? `<p class="muted small">Không tính CK: ${off.map(r => `<button type="button" class="chip" data-commission-include="${esc(r.id)}" title="Tính CK lại cho dòng này">${esc(r.sku || r.name || 'Dòng')} ↺</button>`).join(' ')}</p>` : '';
}
const commissionRowOf = el => editor.rows.find(x => x.id === el.closest('[data-commission-id]')?.dataset.commissionId);
function commissionChanged() { markDirty(); renderCommission(); renderProfit(); }
$('#open-commission').addEventListener('click', () => { if (!isManager()) return; renderCommission(); $('#commission-dialog').showModal(); });
$('#commission-rows').addEventListener('input', e => {
  if (!e.target.matches('[data-commission-value]')) return;
  const r = commissionRowOf(e.target); if (!r) return;
  const mode = r.commission?.mode === 'amount' ? 'amount' : 'percent';
  r.commission = { ...r.commission, mode, value: Math.min(mode === 'percent' ? 100 : 1e12, Math.max(0, Number(e.target.value) || 0)), excluded: false };
  commissionChanged();
});
$('#commission-rows').addEventListener('change', e => {
  if (!e.target.matches('[data-commission-mode]')) return;
  const r = commissionRowOf(e.target); if (!r) return;
  const mode = e.target.value === 'amount' ? 'amount' : 'percent';
  r.commission = { ...r.commission, mode, value: Math.min(mode === 'percent' ? 100 : 1e12, Number(r.commission?.value) || 0), excluded: false };
  commissionChanged();
});
$('#commission-rows').addEventListener('click', e => {
  if (!e.target.closest('[data-commission-exclude]')) return;
  const r = commissionRowOf(e.target); if (!r) return;
  r.commission = { mode: r.commission?.mode === 'amount' ? 'amount' : 'percent', value: Number(r.commission?.value) || 0, excluded: true };
  commissionChanged();
});
$('#commission-excluded').addEventListener('click', e => {
  const b = e.target.closest('[data-commission-include]'); if (!b) return;
  const r = editor.rows.find(x => x.id === b.dataset.commissionInclude); if (!r) return;
  r.commission = { ...r.commission, excluded: false }; commissionChanged();
});
$('#commission-all-apply').addEventListener('click', () => {
  const mode = $('#commission-all-mode').value === 'amount' ? 'amount' : 'percent', value = Math.min(mode === 'percent' ? 100 : 1e12, Math.max(0, Number($('#commission-all-value').value) || 0));
  for (const r of commissionRows()) if (!r.commission?.excluded) r.commission = { mode, value, excluded: false };
  commissionChanged();
});

/** Mỗi dòng có `printing` {xưởng, đơn giá in}; báo giá cũ chỉ có tổng chi phí in thì dồn vào dòng đầu (như initializePrintingLines). */
function initPrintingLines() {
  const rows = editor.rows, legacy = editor.base.printing, first = rows.find(r => Number(r.qty) > 0), hasLines = rows.some(r => r.printing);
  for (const r of rows) {
    if (!r.printing) r.printing = { unitPrice: !hasLines && r === first && legacy?.totalCost > 0 ? legacy.totalCost / r.qty : 0, workshop: legacy?.workshop || '', workshopExplicit: legacy?.workshopExplicit === true };
    if (!r.printing.workshopExplicit) r.printing.workshop = printingInfo({ type: editor.type, rows: [{ ...r, qty: 1, printFee: 1 }] }).defaultWorkshop;
  }
}
function loadWorkshops() {
  if (workshopLoad || !isManager()) return;
  workshopLoad = api('/printing-workshops').then(d => { workshopList = d.workshops || workshopList; if (editor.showProfit) renderPrintingCosts(); })
    .catch(() => { $('#printing-status').textContent = 'Chưa tải được danh sách xưởng dùng chung. Có thể chọn các xưởng mặc định hoặc thêm xưởng mới.'; });
}
function workshopOptions(selected) {
  const names = [...new Set([...workshopList.map(w => w.name), selected].filter(Boolean))];
  return '<option value="__add__">+ Thêm xưởng in mới</option>' + names.map(n => `<option value="${esc(n)}" ${n === selected ? 'selected' : ''}>${esc(n)}</option>`).join('');
}
function renderPrintingCosts(doc = currentDoc()) {
  const section = $('#profit-printing');
  section.hidden = !isManager() || !printingInfo(doc).enabled; if (section.hidden) return;
  initPrintingLines(); loadWorkshops();
  const host = $('#printing-rows'), multiple = editor.rows.length >= 2;
  // Đang gõ đơn giá in thì chỉ cập nhật cột tổng, không vẽ lại ô đang nhập.
  if (host.contains(document.activeElement) && document.activeElement.matches('[data-printing-unit]')) {
    host.querySelectorAll('[data-printing-total]').forEach(el => { const r = editor.rows.find(x => x.id === el.dataset.printingTotal); if (r) el.textContent = money(Math.round(r.printing.unitPrice * r.qty)); });
    return;
  }
  $('#printing-head').innerHTML = `<tr>${multiple ? '<th>Mã hàng</th>' : ''}<th>Xưởng in</th><th>SL</th><th>Đơn giá in (đ/SP)</th><th class="right">Tổng chi phí in</th></tr>`;
  host.innerHTML = editor.rows.map((r, i) => `<tr data-printing-id="${esc(r.id)}">${multiple ? `<td><b>${esc(r.sku || 'Chưa có mã')}</b><br><small class="muted">${esc(r.name || 'Dòng ' + (i + 1))}</small></td>` : ''}<td><select data-printing-workshop aria-label="Xưởng in dòng ${i + 1}">${workshopOptions(r.printing.workshop)}</select></td><td>${fmtNum(Number(r.qty || 0))}</td><td><input class="num-input" type="number" inputmode="decimal" min="0" max="1000000000000" step="any" data-printing-unit aria-label="Đơn giá in dòng ${i + 1}" value="${r.printing.unitPrice || ''}" placeholder="0"></td><td class="right"><b data-printing-total="${esc(r.id)}">${money(Math.round(r.printing.unitPrice * r.qty))}</b></td></tr>`).join('');
}
$('#printing-rows').addEventListener('input', e => {
  if (!e.target.matches('[data-printing-unit]')) return;
  const r = editor.rows.find(x => x.id === e.target.closest('tr').dataset.printingId); if (!r) return;
  r.printing = { ...r.printing, unitPrice: Math.min(1e12, Math.max(0, Number(e.target.value) || 0)) };
  markDirty(); renderProfit();
});
$('#printing-rows').addEventListener('change', e => {
  if (!e.target.matches('[data-printing-workshop]')) return;
  const r = editor.rows.find(x => x.id === e.target.closest('tr').dataset.printingId); if (!r) return;
  if (e.target.value === '__add__') {
    workshopTarget = r.id; $('#workshop-form').reset(); $('#workshop-error').textContent = '';
    e.target.value = r.printing.workshop; $('#workshop-dialog').showModal(); $('#workshop-form [name=name]').focus(); return;
  }
  r.printing = { ...r.printing, workshop: e.target.value, workshopExplicit: true };
  markDirty(); renderProfit();
});
$('#workshop-form').addEventListener('submit', async e => {
  e.preventDefault();
  const form = e.target, btn = form.querySelector('button.primary'); btn.disabled = true; $('#workshop-error').textContent = '';
  try {
    const { workshop } = await api('/printing-workshops', 'POST', Object.fromEntries(new FormData(form)));
    workshopList = [...workshopList.filter(w => w.id !== workshop.id), workshop];
    const r = editor.rows.find(x => x.id === workshopTarget);
    if (r) { r.printing = { ...r.printing, workshop: workshop.name, workshopExplicit: true }; markDirty(); }
    $('#workshop-dialog').close(); renderProfit(); toast('Đã thêm xưởng in vào danh sách dùng chung');
  } catch (err) { $('#workshop-error').textContent = err.message || 'Chưa lưu được xưởng in.'; }
  finally { btn.disabled = false; }
});
$$('input[name="profitShippingPayer"]').forEach(i => i.addEventListener('change', () => {
  if (!isManager() || !i.checked) return;
  editor.base.shipping = { divisor: 5000, rate: 0, extra: 0, ...shipOpts(), payer: i.value };
  markDirty(); renderProfit();
}));
/** Review each SKU before saving; preserve existing percentages and manual unit costs. */
async function refreshPurchaseCosts() {
  const btn = $('#refresh-profit-costs'); if (!isManager() || btn.disabled) return;
  const targetId=editor.id, targetRevision=editor.revision, sourceRows=editor.rows;
  btn.disabled = true; btn.textContent = 'Đang tải CK…';
  try {
    const skus=[...new Set(sourceRows.map(r=>(r.sku||'').trim()).filter(Boolean))],found=[];
    try { for(let i=0;i<skus.length;i+=200)found.push(...(await api('/products?skus='+encodeURIComponent(skus.slice(i,i+200).join(',')))).products); }
    catch { /* Review can use the product information already saved on each row. */ }
    if(editor.id!==targetId || editor.revision!==targetRevision || editor.rows!==sourceRows)return false;
    btn.textContent='Đang kiểm tra CK…';
    const edits=await reviewPurchaseCosts(sourceRows,found);
    if(!edits)return false;
    if(editor.id!==targetId || editor.revision!==targetRevision || editor.rows!==sourceRows)throw new Error('Báo giá đang xem đã thay đổi. Vui lòng kiểm tra CK lại.');
    for(const entry of edits)applyPurchaseCost(sourceRows[entry.index],entry);
    editor.showCostFields=true;refreshCostToggle();markDirty();renderLines();
    await saveQuote();
    if(editor.dirty)throw new Error('Chưa lưu được CK mua vào lên hệ thống.');
    toast('Đã lưu CK / giá mua theo từng mã.');return true;
  } catch(err){toast(err.message||'Chưa lưu được CK mua vào.','err');return false;}
  finally{btn.disabled=false;btn.textContent='Cập nhật CK mua vào';}
}
$('#refresh-profit-costs').addEventListener('click',refreshPurchaseCosts);

// ----- hộp "Tạo báo giá mới" (như web cũ, gọn hơn): mẫu, khách hàng, ngày, số báo giá, chiết khấu toàn bảng
const nq = { type: 'HRC', customer: null, autoNo: '', brandDiscounts: null, onCustomerChange: () => { nqApplyTerms(); nqBrandDiscounts(); } };
/** Tên + % CK theo thương hiệu của khách (trang chi tiết khách hàng); '' nếu khách chưa thiết lập. */
const brandDiscountText = d => [['minhLong', 'Minh Long'], ['lys', 'Lys'], ['lock', 'Lock&Lock']].filter(([k]) => typeof d?.[k] === 'number').map(([k, t]) => `${t} ${fmtNum(d[k])}%`).join(' · ');
/** Khách đã có CK riêng: ẩn ô "Chiết khấu toàn bảng", báo CK sẽ tự áp theo thương hiệu (Minh Long / Lys / Lock&Lock) khi thêm sản phẩm. */
async function nqBrandDiscounts() {
  const c = nq.customer, id = c?.id; nq.brandDiscounts = null;
  const show = text => { $('#nq-discount-field').hidden = $('#nq-discount-help').hidden = !!text; $('#nq-brand-discounts').hidden = !text; $('#nq-brand-discounts').textContent = text ? `Khách có chiết khấu riêng: ${text}. Tự áp đúng theo thương hiệu khi thêm sản phẩm.` : ''; };
  show('');
  if (!id) return;
  try { const { discounts } = await api(`/customers/${encodeURIComponent(id)}/discounts`); if (nq.customer?.id !== id) return; nq.brandDiscounts = discounts; show(brandDiscountText(discounts)); } catch { /* không có CK riêng */ }
}
function nqSetType(type, fetchServer = true) {
  const date = $('#nq-date').value || todayIso(), no = $('#nq-no');
  const keepAuto = !no.value.trim() || no.value.trim() === nq.autoNo;
  nqApplyTerms();
  nq.type = type; $('#nq-type-name').textContent = type === 'VIGIFTS' ? 'Vigifts' : type;
  $$('#nq-type button').forEach(b => b.setAttribute('aria-checked', String(b.dataset.value === type)));
  nq.autoNo = nextQuoteNo(type, date); if (keepAuto) no.value = nq.autoNo;
  // Lấy số kế tiếp trên toàn công ty rồi điền lại (nếu người dùng chưa tự gõ số).
  if (fetchServer) refreshQuoteNo(type, date).then(() => { if (nq.type === type && ($('#nq-date').value || todayIso()) === date) nqSetType(type, false); });
}
/** Điền điều khoản thanh toán: của khách đã chọn (nếu khách có đặt riêng), không thì mặc định cọc 30% / 5 ngày. Hiện giới hạn công nợ của khách. */
function nqApplyTerms() {
  const d = defaultPaymentTerms(nq.type), c = nq.customer;
  if (!nq.paymentTouched) { $('#nq-deposit-rate').value = c?.depositRate ?? d.depositRate; $('#nq-payment-term').value = c?.paymentTerm || d.balanceTerm; }
  const credit = $('#nq-credit');
  credit.hidden = !(c && c.creditLimit != null);
  credit.textContent = c && c.creditLimit != null ? `Giới hạn công nợ của ${c.name}: ${money(c.creditLimit)}` : '';
}
async function openNewQuote() {
  if (editor.dirty && currentHash.startsWith('#/quotes/')) {
    if (!await confirmBox('Báo giá đang sửa có thay đổi chưa lưu. Tạo báo giá mới sẽ bỏ các thay đổi này.', { title: 'Bỏ thay đổi chưa lưu?', ok: 'Tạo báo giá mới', danger: true })) return;
    editor.dirty = false;
  }
  nq.customer = null; nq.autoNo = ''; nq.resetCustomerSearch?.(); nqBrandDiscounts();
  nq.paymentTouched = false;
  $('#new-quote-form').reset(); $('#nq-error').textContent = '';
  $('#nq-date').value = todayIso(); $('#nq-no').value = '';
  nqSetType(nq.type);
  $('#new-quote-dialog').showModal();
  // Máy tính: đặt sẵn con trỏ vào ô khách hàng; điện thoại thì không (tránh bật bàn phím che hộp).
  if (matchMedia('(pointer: fine)').matches) $('#nq-customer').focus(); else $('#nq-date').blur();
}
document.addEventListener('click', e => {
  const a = e.target.closest('[data-new-quote]'); if (!a) return;
  e.preventDefault(); openNewQuote();
});
$('#nq-type').addEventListener('click', e => { const b = e.target.closest('button'); if (b) nqSetType(b.dataset.value); });
$('#nq-date').addEventListener('change', () => nqSetType(nq.type));
for (const id of ['#nq-deposit-rate', '#nq-payment-term']) $(id).addEventListener('input', () => { nq.paymentTouched = true; });
/** Bật/tắt vòng xoay "đang tìm" trên ô tìm khách hàng. */
const comboBusy = (input, on) => input.closest('.combo')?.classList.toggle('busy', on);
{
  const input = $('#nq-customer'), list = $('#nq-suggest'); let items = [], timer, req = 0;
  const hide = () => { list.hidden = true; input.setAttribute('aria-expanded', 'false'); };
  const reset = nq.resetCustomerSearch = () => {
    clearTimeout(timer); req++; items = []; list.replaceChildren(); hide(); comboBusy(input, false);
  };
  input.addEventListener('input', () => {
    nq.customer = null; reset(); comboBusy(input, true); nq.onCustomerChange?.();
    const ticket = req, query = input.value;
    timer = setTimeout(async () => {
      let found = [];
      try { found = (await api(`/customers?limit=8&usable=1&q=${encodeURIComponent(query)}`)).customers; } catch { /* để trống */ }
      if (ticket !== req || query !== input.value || !$('#new-quote-dialog').open) return;
      comboBusy(input, false);
      if (document.activeElement !== input) return;
      items = found;
      list.innerHTML = found.length ? found.map((c, i) => `<li role="option" data-i="${i}"><b>${esc(c.name)}</b><small>${esc([c.contact, c.phone, c.taxCode && 'MST ' + c.taxCode].filter(Boolean).join(' · '))}</small></li>`).join('')
        : `<li class="none">Không có trong danh bạ – vẫn tạo được, điền thông tin khách trong báo giá.</li>`;
      list.hidden = false; input.setAttribute('aria-expanded', 'true');
    }, 180);
  });
  input.addEventListener('blur', () => { clearTimeout(timer); req++; comboBusy(input, false); setTimeout(hide, 150); });
  list.addEventListener('mousedown', e => { if (e.target.closest('li[data-i]')) e.preventDefault(); });
  list.addEventListener('click', e => {
    const li = e.target.closest('li[data-i]'), customer = li && items[li.dataset.i];
    if (!customer || list.hidden) return;
    e.preventDefault(); nq.customer = customer; input.value = customer.name; reset();
    nq.onCustomerChange?.();
  });
}
$('#new-quote-form').addEventListener('submit', e => {
  e.preventDefault();
  // Khách có CK riêng theo thương hiệu: không dùng CK toàn bảng (ô đã ẩn).
  const err = $('#nq-error'), date = $('#nq-date').value, no = $('#nq-no').value.trim(), discText = $('#nq-discount-field').hidden ? '' : $('#nq-discount').value.trim(), disc = discText ? parseNum(discText) : 0;
  err.textContent = '';
  if (!date || !no) { err.textContent = 'Vui lòng nhập ngày và số báo giá.'; return; }
  if (!(disc >= 0 && disc <= 100)) { err.textContent = 'Chiết khấu toàn bảng phải từ 0 đến 100%.'; return; }
  const rateText = $('#nq-deposit-rate').value.trim(), depositRate = rateText ? parseNum(rateText) : NaN, balanceTerm = $('#nq-payment-term').value.trim();
  if (!Number.isFinite(depositRate) || depositRate < 0 || depositRate > 100) { err.textContent = 'Tỷ lệ đặt cọc phải từ 0 đến 100%.'; return; }
  if (depositRate < 100 && (!balanceTerm || balanceTerm.length > 500 || /^[+-]?\d+(?:[.,]\d+)?\s*(?:ngày)?$/i.test(balanceTerm) && (!/^\d+\s*(?:ngày)?$/i.test(balanceTerm) || parseInt(balanceTerm, 10) > 3650))) { err.textContent = 'Nhập thời hạn thanh toán: số ngày từ 0 đến 3650 hoặc nội dung như “Thanh toán trước khi giao hàng”.'; return; }
  const paymentTerms = { depositRate, balanceTerm };
  const typed = $('#nq-customer').value.trim(), c = nq.customer?.name === typed ? nq.customer : null;
  const customer = c ? { customerId: c.id, customer: c.name, contact: c.contact || '', phone: c.phone || '', email: c.email || '', customerTaxCode: c.taxCode || '', customerAddress: c.address || '', customerCode: c.customerCode || '' } : typed ? { customer: typed } : {};
  editor.defaultDiscount = disc;
  editor.pending = { ...newQuoteData({ type: nq.type, date, quoteNo: no, paymentTerms, ...customer, rows: [] }), defaultDiscount: disc };
  $('#new-quote-dialog').close();
  if (location.hash === '#/quotes/new') route(); else go('#/quotes/new');
});

// ----- đóng thùng & phí vận chuyển (port Shipping.calculate của web cũ)
const PACK_FIELDS = ['perCarton', 'cartonWeight', 'cartonLength', 'cartonWidth', 'cartonHeight'];
function shippingCalc(rows, opt = {}) {
  const groups = []; let cartons = 0, kg = 0, m3 = 0, billable = 0, missing = 0;
  const divisor = Number(opt.divisor) || 5000;
  for (const r of rows) {
    const qty = Number(r.qty); if (!(qty > 0)) continue;
    const n = Number(r.perCarton), w = Number(r.cartonWeight), l = Number(r.cartonLength), b = Number(r.cartonWidth), h = Number(r.cartonHeight);
    if (!Number.isInteger(n) || n <= 0) { missing++; continue; } // có SP/thùng là đếm được thùng; kg và kích thước chỉ ảnh hưởng cước
    const hasW = w > 0, hasDim = [l, b, h].every(v => v > 0);
    const full = Math.floor(qty / n), rest = qty - full * n, count = qty / n, unit = String(r.unit || 'cái').trim() || 'cái';
    const note = [full ? `${full} thùng x ${n} ${unit}` : '', rest ? `lẻ ${fmtNum(rest)} ${unit}` : ''].filter(Boolean).join(' + ');
    groups.push({ sku: r.sku, name: r.name, qty, count, note, kg: hasW ? w : null, dims: hasDim ? [l, b, h] : null });
    cartons += count;
    if (hasW) kg += count * w;
    if (hasDim) m3 += count * l * b * h / 1e6;
    if (hasW || hasDim) billable += count * Math.max(hasW ? w : 0, hasDim ? l * b * h / divisor : 0);
    if (!hasW || !hasDim) missing++;
  }
  const rate = Number(opt.rate) || 0, extra = Number(opt.extra) || 0;
  // Đơn giá 0đ + phụ phí = cước trọn gói, không cần kg/kích thước.
  const fee = rate === 0 && extra > 0 ? Math.ceil(extra) : !missing && cartons && rate > 0 ? Math.ceil(billable * rate + extra) : null;
  return { groups, cartons, kg, m3, billable, missing, fee };
}
const shipOpts = () => editor.base.shipping || {};
function renderShippingRows() {
  $('#ship-rows').innerHTML = editor.rows.map((r, i) => (r.name || r.sku) ? `<tr><td>${esc(r.sku || '—')}<br><small class="muted">${esc(r.name || '')}</small></td><td>${fmtNum(Number(r.qty) || 0)}</td>${PACK_FIELDS.map(k =>
    `<td><input class="num-input" type="number" min="0" step="${k === 'perCarton' ? 1 : 'any'}" data-pack="${k}" data-i="${i}" value="${Number(r[k]) > 0 ? r[k] : ''}" placeholder="Chưa có" aria-label="${k} ${esc(r.sku || r.name || '')}"></td>`).join('')}</tr>` : '').join('')
    || '<tr><td colspan="7" class="muted">Chưa có sản phẩm.</td></tr>';
  const o = shipOpts();
  $('#ship-divisor').value = o.divisor || 5000; $('#ship-rate').value = Number(o.rate) > 0 ? o.rate : ''; $('#ship-extra').value = Number(o.extra) > 0 ? o.extra : '';
  renderShippingSummary();
}
function renderShippingSummary() {
  const c = shippingCalc(editor.rows, shipOpts()), shown = v => v > 0 ? fmtNum(v, 3) : '—';
  $('#ship-summary').textContent = `${fmtNum(c.cartons, 3)} thùng · ${fmtNum(c.kg, 3)} kg dự toán · ${fmtNum(c.m3, 3)} m³ · ${fmtNum(c.billable, 3)} kg tính cước${c.missing ? ` · ${c.missing} dòng còn thiếu dữ liệu cước` : ''}`;
  $('#ship-fee').textContent = c.fee === null ? 'Chưa đủ dữ liệu hoặc chưa nhập đơn giá' : money(c.fee);
  $('#ship-groups').innerHTML = c.groups.map(g => `<tr><td>${esc(g.sku || '—')}<br><small class="muted">${esc(g.name || '')}</small></td><td>${fmtNum(g.qty)}</td><td>${fmtNum(g.count, 3)}</td><td>${esc(g.note)}</td><td>${g.dims ? g.dims.map(shown).join(' × ') : '— × — × —'}</td><td>${shown(g.kg)}</td></tr>`).join('')
    || '<tr><td colspan="6" class="muted">Nhập SP/thùng để tính số thùng.</td></tr>';
}
$('#ship-rows').addEventListener('change', e => {
  const el = e.target.closest('[data-pack]'); if (!el) return;
  let v = Number(el.value);
  if (el.value === '' || !Number.isFinite(v) || v < 0 || v > 1e6 || (el.dataset.pack === 'perCarton' && !Number.isInteger(v))) { if (el.value !== '') toast('Quy cách không hợp lệ (SP/thùng phải là số nguyên).', 'err'); el.value = ''; v = 0; }
  editor.rows[Number(el.dataset.i)][el.dataset.pack] = v; markDirty(); renderShippingSummary();
});
for (const [id, key] of [['#ship-divisor', 'divisor'], ['#ship-rate', 'rate'], ['#ship-extra', 'extra']]) $(id).addEventListener('change', e => {
  let v = Number(e.target.value); if (!Number.isFinite(v) || v < 0 || v > 1e12) v = 0;
  if (key === 'divisor') v = Math.max(1, v || 5000);
  editor.base.shipping = { divisor: 5000, rate: 0, extra: 0, payer: 'receiver', ...shipOpts(), [key]: v };
  markDirty(); renderShippingSummary();
});
$('#shipping-card').addEventListener('toggle', e => { if (e.target.open) renderShippingRows(); });
$('#fill-packing').addEventListener('click', async () => {
  const skus = [...new Set(editor.rows.map(r => (r.sku || '').trim()).filter(Boolean))];
  if (!skus.length) return toast('Báo giá chưa có mã sản phẩm để tra quy cách.', 'err');
  let found = [];
  try { for (let i = 0; i < skus.length; i += 200) found.push(...(await api('/products?skus=' + encodeURIComponent(skus.slice(i, i + 200).join(',')))).products); }
  catch (e) { return toast(e.message, 'err'); }
  const bySku = new Map(found.map(p => [p.sku, p])); let count = 0;
  for (const r of editor.rows) { const p = bySku.get((r.sku || '').trim()); if (!p) continue; for (const k of PACK_FIELDS) if (!(Number(r[k]) > 0) && Number(p[k]) > 0) { r[k] = Number(p[k]); count++; } }
  if (count) markDirty();
  renderShippingRows(); toast(count ? `Đã điền ${count} ô quy cách từ danh mục.` : 'Danh mục không có thêm quy cách cho các mã này.');
});

// ----- khách hàng trong báo giá
const suggest = $('#customer-suggest'), searchInput = field('customer');
let suggestIndex = -1, suggestItems = [];
let suggestTimer, suggestReq = 0;
function showSuggest() {
  clearTimeout(suggestTimer); const req = ++suggestReq, query = searchInput.value;
  suggestItems = []; suggestIndex = -1; suggest.replaceChildren(); hideSuggest(); comboBusy(searchInput, true);
  suggestTimer = setTimeout(async () => {
    let items = [];
    try { items = (await api(`/customers?limit=8&usable=1&q=${encodeURIComponent(query)}`)).customers; } catch { /* hiện thông báo trống */ }
    if (req !== suggestReq || query !== searchInput.value) return;
    comboBusy(searchInput, false);
    if (document.activeElement !== searchInput) return;
    suggestItems = items; suggestIndex = items.length ? 0 : -1;
    suggest.innerHTML = items.length
      ? items.map((c, i) => `<li role="option" data-i="${i}" aria-selected="${i === suggestIndex}"><b>${esc(c.name)}</b><small>${esc([c.contact, c.phone, c.taxCode && 'MST ' + c.taxCode].filter(Boolean).join(' · ') || c.address || '')}</small></li>`).join('')
      : `<li class="none">${searchInput.value.trim() ? 'Không có trong danh bạ. Điền tiếp thông tin bên dưới, rồi bấm "Lưu vào danh bạ".' : 'Danh bạ đang trống.'}</li>`;
    suggest.hidden = false; searchInput.setAttribute('aria-expanded', 'true');
  }, 180);
}
function hideSuggest() { suggest.hidden = true; searchInput.setAttribute('aria-expanded', 'false'); }
function pickCustomer(c) {
  editor.customerId = c.id; editor.customerName = c.name; loadBrandDiscounts();
  field('customer').value = c.name; field('contact').value = c.contact || ''; field('phone').value = c.phone || '';
  field('email').value = c.email || ''; field('customerTaxCode').value = c.taxCode || ''; field('customerAddress').value = c.address || '';
  editor.base.customerCode = c.customerCode || '';
  hideSuggest(); markDirty(); updateContactsButton();
  toast('Đã điền thông tin ' + c.name);
}
searchInput.addEventListener('focus', () => { if (!editor.customerId) showSuggest(); });
searchInput.addEventListener('input', showSuggest);
searchInput.addEventListener('blur', () => { clearTimeout(suggestTimer); suggestReq++; comboBusy(searchInput, false); setTimeout(hideSuggest, 150); });
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
  $('#save-to-contacts').hidden = !name || !!editor.customerId;
}
$('#save-to-contacts').addEventListener('click', async () => {
  const body = { name: field('customer').value.trim(), contact: field('contact').value.trim(), phone: field('phone').value.trim().slice(0, 40), email: field('email').value.trim(), taxCode: field('customerTaxCode').value.trim(), address: field('customerAddress').value.trim() };
  const btn = $('#save-to-contacts'); btn.disabled = true;
  try {
    const { id } = await api('/customers', 'POST', body);
    editor.customerId = id; editor.customerName = body.name; markDirty();
    updateContactsButton(); loadCustomers();
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
  syncPaymentNotes();
  syncDeliveryNotes();
  const f = name => field(name).value.trim();
  const data = { ...editor.base };
  delete data.delivery_date;
  Object.assign(data, {
    type: editor.type, discountMode: editor.discountMode === 'amount' ? 'amount' : 'percent', notesVersion: 2, quoteNo: f('quoteNo'), date: f('date'), vat: parseNum(field('vat').value),
    customer: f('customer'), customerId: editor.customerId || '', contact: f('contact'), phone: f('phone'), email: f('email'),
    customerTaxCode: f('customerTaxCode'), customerAddress: f('customerAddress'), owner: f('owner'), ownerPhone: f('ownerPhone'),
    notes: field('notes').value, internalNote: field('internalNote').value,
    rows: editor.rows.filter(r => (r.name || '').trim() || Number(r.price) || (r.sku || '').trim()).map(r => {
      const row = { ...r, name: (r.name || '').trim(), sku: (r.sku || '').trim(), unit: (r.unit || '').trim() };
      if (!Number.isFinite(r.costPrice)) delete row.costPrice;
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
  if (editor.id && !isManager() && editor.approval?.status === 'approved') return toast('Báo giá đã duyệt. Chỉ Manager được chỉnh sửa.', 'err');
  const err = $('#quote-error'); err.textContent = '';
  const data = collectQuote(), problem = validateQuote(data);
  if (problem) {
    const invalid = qf.querySelector('.invalid'), panel = invalid?.closest('[data-quote-panel]');
    setMobileQuoteStep(panel?.dataset.quotePanel || (data.rows.length ? 'products' : 'products'));
    err.textContent = problem; toast(problem, 'err'); invalid?.focus(); return;
  }
  const saveSequence = editorLoadSequence, saveHash = location.hash, wasNew = !editor.id;
  saving = true; $('#save-quote').disabled = $('#save-quote-m').disabled = true;
  try {
    const saved = editor.id
      ? await api('/quotes/' + encodeURIComponent(editor.id), 'PUT', { revision: editor.revision, data })
      : await api('/quotes', 'POST', data);
    if (saveSequence !== editorLoadSequence || location.hash !== saveHash) { toast('Đã lưu ' + saved.data.quoteNo); loadQuotes(); return; }
    const keepApproval = !wasNew && saved.approvalStatus === 'approved' ? { approvedAt: editor.approval?.at, approvedByName: editor.approval?.by } : {};
    fillEditor(saved.id, saved.revision, saved.data, { ...keepApproval, approvalStatus: saved.approvalStatus });
    if (wasNew) { suppressHash = true; location.hash = '#/quotes/' + encodeURIComponent(saved.id); currentHash = location.hash; }
    if (saved.approvalRevoked) toast('Đã lưu. Báo giá chuyển về "Nháp" – bấm "Gửi duyệt" để Manager duyệt lại.');
    else if (saved.approvalStatus === 'pending') toast((wasNew ? 'Đã tạo báo giá ' + saved.data.quoteNo : 'Đã lưu phiên bản ' + saved.revision) + ' · đang đợi Manager duyệt.');
    else if (saved.approvalStatus === 'draft') toast((wasNew ? 'Đã lưu nháp ' + saved.data.quoteNo : 'Đã lưu phiên bản ' + saved.revision) + ' · bấm "Gửi duyệt" khi xong.');
    else toast(wasNew ? 'Đã tạo báo giá ' + saved.data.quoteNo : 'Đã lưu phiên bản ' + saved.revision);
    loadQuotes();
  } catch (e) {
    if (saveSequence !== editorLoadSequence || location.hash !== saveHash) { toast(e.message, 'err'); return; }
    if (e.status === 409) {
      $('#conflict-text').textContent = e.message + ' Thay đổi của anh/chị chưa được lưu.';
      $('#conflict-banner').hidden = false; $('#conflict-banner').scrollIntoView({ behavior: 'smooth', block: 'center' });
    } else { err.textContent = e.message; toast(e.message, 'err'); }
  } finally { saving = false; updateQuoteActions(); }
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
  return { ...copy, quoteNo: nextQuoteNo(copy.type, todayIso()), date: todayIso(), rows: copy.rows.map(r => ({ ...r, id: uid() })) };
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

// ----- PDF theo 3 mẫu của web cũ (HRC / B2B / VIGIFTS): hrc-pdf.js (bố cục) + editable-pdf.js (pdf-lib, chữ chọn được).
// Thư viện PDF + font Times New Roman (~3,6 MB) chỉ tải khi bấm tải PDF.
// Đổi phiên bản khi API của các bộ dựng PDF thay đổi để không dùng lại script cũ trong cache.
const PDF_SCRIPTS = ['pdf-lib.min.js', 'fontkit.umd.min.js', 'hrc-pdf.js?v=hrc-rows-2', 'editable-pdf.js?v=hrc-rows-2'];
let pdfReady = null;
function loadPdfTools() {
  if (pdfReady) return pdfReady;
  pdfReady = PDF_SCRIPTS.reduce((chain, src) => chain.then(() => new Promise((resolve, reject) => {
    const el = document.createElement('script'); el.src = src; el.onload = resolve;
    el.onerror = () => { el.remove(); reject(new Error('Không tải được bộ tạo PDF. Kiểm tra mạng rồi thử lại.')); };
    document.head.appendChild(el);
  })), Promise.resolve()).then(() => {
    if (typeof globalThis.EditableQuotePdf?.create !== 'function'
      || typeof globalThis.EditableQuotePdf?.hrcRows !== 'function'
      || typeof globalThis.HrcPdf?.createPages !== 'function') {
      throw new Error('Bộ tạo PDF chưa đồng bộ phiên bản. Tải lại trang rồi thử lại.');
    }
    // hrc-pdf.js thay globalThis.HrcPdf: giữ đọc số tiền bằng chữ của app (dùng chung cho HĐKT, Excel).
    globalThis.HrcPdf = { ...globalThis.HrcPdf, amountInWords: n => moneyWords(n) };
    globalThis.QuoteMath = { ...(globalThis.QuoteMath || {}), totals, after };
  }).catch(error => {
    pdfReady = null;
    throw error;
  });
  return pdfReady;
}
const isIos = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
let pdfBusy = false;
/** Ảnh để HIỂN THỊ (không đọc nội dung): như thẻ <img> của bản in nhanh – trình duyệt gửi kèm phiên web cũ, Drive đổi sang ảnh thật. */
function loadDisplayImage(src) {
  return new Promise(resolve => {
    if (!src) return resolve(null);
    const list = [...new Set([displayImage(src), fallbackImage(src), src].filter(Boolean))];
    const next = () => {
      const u = list.shift(); if (!u) return resolve(null);
      const img = new Image(); const t = setTimeout(() => { img.src = ''; next(); }, 12000);
      img.onload = () => { clearTimeout(t); resolve(img); }; img.onerror = () => { clearTimeout(t); next(); }; img.src = u;
    };
    next();
  });
}
let templateFonts = null;
/** Font Times New Roman cho bản vẽ canvas (máy không có sẵn font, vd Android). */
function loadTemplateFonts() {
  return templateFonts ||= Promise.all([['fonts/TimesNewRoman.ttf', 'normal'], ['fonts/TimesNewRomanBold.ttf', 'bold']].map(([u, w]) => {
    const f = new FontFace('Times New Roman', `url(${u})`, { weight: w }); document.fonts.add(f); return f.load().catch(() => null);
  }));
}
/**
 * Bản in theo MẪU WEB CŨ (HRC / B2B / VIGIFTS): vẽ bằng chính bộ dựng trang của web cũ (hrc-pdf.js) lên canvas A4 rồi in qua
 * trình duyệt – ảnh hiển thị như in nhanh nên luôn có, kể cả ảnh chỉ xem được khi đăng nhập web cũ.
 */
async function printQuoteTemplate(state) {
  await Promise.all([loadPdfTools(), loadTemplateFonts()]);
  const images = await Promise.all(state.rows.map(r => loadDisplayImage(r.image)));
  const banner = await loadCanvasImage(state.type === 'VIGIFTS' ? 'vigifts-letterhead.png' : 'hrc-letterhead.jpg');
  const data = state.type === 'HRC' ? { ...state, rows: globalThis.EditableQuotePdf.hrcRows(state) } : state;
  const pages = globalThis.HrcPdf.createPages({ state: data, images, banner, createCanvas: (w, h) => Object.assign(document.createElement('canvas'), { width: w, height: h }) });
  $('#print-sheet').replaceChildren(...pages);
  // Mỗi canvas đã là một trang A4 đủ lề → in lề 0; canvas co theo vùng in (Safari vẫn giữ lề riêng thì cũng không bị cắt).
  printSheet({ page: { size: 'A4', margin: '0' }, cls: 'canvas-pages', title: `${state.quoteNo || 'Bao-gia'}`.replace(/[^\w.-]+/g, '-') });
}
async function downloadQuotePdf(hideDiscount) {
  const block = approvalBlock(); if (block) return toast(block, 'err');
  if (pdfBusy) return;
  const d = collectQuote(); if (!d.rows.length) return toast('Chưa có sản phẩm để xuất PDF.', 'err');
  // iPhone chặn mở tab sau khi chờ: mở tab trống ngay lúc bấm rồi đổ PDF vào sau (như web cũ).
  const tab = isIos() ? window.open('about:blank', '_blank') : null;
  if (tab) tab.document.body.innerHTML = '<p style="font:16px Arial;padding:24px">Đang tạo file PDF, vui lòng chờ…</p>';
  pdfBusy = true; toast('Đang tạo file PDF…');
  try {
    await loadPdfTools();
    const state = { ...d, ...(d.type === 'HRC' ? { hideHrcDiscountColumn: !!hideDiscount } : {}), ...(d.type === 'B2B' ? { hideB2bDiscountColumn: !!hideDiscount } : {}) };
    const images = await loadQuoteImages(d.rows);
    // Ảnh máy chủ không đọc được nội dung (vd ảnh web cũ khi chưa cài secret LEGACY_STAFF_*): KHÔNG báo lỗi mà in theo đúng
    // mẫu PDF bằng trình duyệt, lấy ảnh y như "In nhanh" (thẻ <img>, cùng nguồn ảnh – trình duyệt tự gửi phiên web cũ)
    // → hộp in mở ra, chọn "Lưu dưới dạng PDF". Cùng bố cục, cùng cột (kể cả bản ẩn cột CK).
    if (d.rows.some((r, i) => r.image && !images[i])) {
      if (tab && !tab.closed) tab.close();
      await printQuoteTemplate(state);
      toast('Đã mở bản in theo mẫu PDF (ảnh lấy như In nhanh): chọn "Lưu dưới dạng PDF" / "Save as PDF" để tải file.');
      return;
    }
    const banner = await loadCanvasImage(d.type === 'VIGIFTS' ? 'vigifts-letterhead.png' : 'hrc-letterhead.jpg');
    const bytes = await globalThis.EditableQuotePdf.create({ state, images, banner });
    
    // Tên file không dấu: vài trình duyệt / máy bỏ tên có dấu và lưu thành "download".
    const clean = v => String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[đĐ]/g, c => c === 'đ' ? 'd' : 'D').replace(/[\\/:*?"<>|]+/g, ' ').trim();
    const name = `${clean(d.quoteNo)} - ${clean(d.customer)} - ${(d.date || todayIso()).split('-').reverse().join('-')}.pdf`;
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
    if (tab && !tab.closed) { tab.location.href = url; toast('Đã mở PDF – bấm Chia sẻ để lưu hoặc gửi.'); }
    else { const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); toast('Đã tải file PDF A4.'); }
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch (ex) { console.error(ex); if (tab && !tab.closed) tab.close(); toast(ex?.message || 'Không thể tạo PDF. Vui lòng thử lại.', 'err'); }
  finally { pdfBusy = false; }
}
$('#pdf-quote').addEventListener('click', () => downloadQuotePdf(false));
$('#quote-history').addEventListener('click', () => editor.id && showAudit({ api, toast, entityType: 'quotes', entityId: editor.id, title: 'Báo giá ' + (collectQuote().quoteNo || '') }));
$('#pdf-quote-nock').addEventListener('click', () => downloadQuotePdf(true));

// ----- in nhanh trên trình duyệt
$('#print-quote').addEventListener('click', () => {
  const block = approvalBlock(); if (block) return toast(block, 'err');
  const d = collectQuote();
  if (!d.rows.length) { toast('Chưa có sản phẩm để in.', 'err'); return; }
  const doc = { type: d.type, vat: d.vat, rows: d.rows }, t = totals(doc);
  const showPrint = d.type !== 'HRC' && d.rows.some(r => Number(r.printFee) > 0);
  const showDisc = d.rows.some(r => Number(r.discount) > 0);
  const showTax = new Set(d.rows.map(r => Number.isFinite(r.taxRate) ? r.taxRate : d.vat)).size > 1;
  const showImg = d.rows.some(r => r.image);
  const cols = 6 + (showImg ? 1 : 0) + (showDisc ? 1 : 0) + (showPrint ? 1 : 0) + (showTax ? 1 : 0);
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
      <thead><tr><th>STT</th>${showImg ? '<th>Hình ảnh</th>' : ''}<th>Sản phẩm</th><th>ĐVT</th><th>SL</th><th>Đơn giá</th>${showDisc ? '<th>Chiết khấu</th>' : ''}${showPrint ? '<th>Phí in</th>' : ''}${showTax ? '<th>VAT</th>' : ''}<th>Thành tiền</th></tr></thead>
      <tbody>${d.rows.map((r, i) => `<tr>
        <td class="c">${i + 1}</td>${showImg ? `<td class="c">${r.image ? `<img class="ps-img" src="${esc(displayImage(r.image))}" alt="" referrerpolicy="no-referrer">` : ''}</td>` : ''}<td>${esc(r.name)}${r.sku ? `<br><small>Mã: ${esc(r.sku)}</small>` : ''}</td><td class="c">${esc(r.unit)}</td>
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
  // Bản demo chạy trong khung không cho mở hộp thoại in → xem trước bản in trên màn hình.
  if (window.BN_DEMO) { $('#print-preview-body').innerHTML = $('#print-sheet').innerHTML; $('#print-preview').showModal(); return; }
  printSheet({ title: `Bao-gia-${d.quoteNo}`.replace(/[^\w.-]+/g, '-') });
});

// ---------------------------------------------------------------- sản phẩm
const POLICY_KEY = 'bn-price-policy';
let preferredPolicy = '';
try { preferredPolicy = localStorage.getItem(POLICY_KEY) || ''; } catch { /* bỏ qua */ }
const currentPolicy = () => (state.policies.find(p => p.id === preferredPolicy) || state.policies[0])?.id || '';
/** Giá theo bảng giá đang chọn; nếu trống thì lấy bảng giá đầu tiên có giá. */
const priceOf = (p, policyId) => {
  const v = Array.isArray(p.prices) ? p.prices.find(x => x.policyId === policyId)?.price : p.prices?.[policyId];
  return Number.isFinite(v) ? v : null;
};
/** Giá niêm yết theo bảng giá đang chọn (null = bảng giá này chưa có giá, như bản cũ). */
const productPrice = p => priceOf(p, currentPolicy());
/** Tồn khả dụng = tổng các kho thật (không tính NCC và hàng chờ về). */
/** Hàng đang treo (GET /stock-holds): sku → [{ qty, quoteId, quoteNo, customer, expiresAt }] của báo giá giữ 5 ngày,
 *  và [{ qty, quoteId, orderId, orderNo, contractNo, customer }] của đơn / HĐKT giữ đến khi giao / huỷ. Tải lại tối đa 30 giây/lần. */
let holdsAt = 0, holdsReq = null;
state.holds = new Map();
function loadHolds(force = false) {
  if (!force && Date.now() - holdsAt < 30000) return holdsReq || Promise.resolve();
  holdsAt = Date.now();
  return holdsReq = api('/stock-holds').then(r => { const m = new Map(); for (const h of r.holds) (m.get(h.sku) ?? m.set(h.sku, []).get(h.sku)).push(h); state.holds = m; })
    .catch(() => { holdsAt = 0; }).finally(() => { holdsReq = null; });
}
/** Số đang treo của một mã (bỏ phần treo cho chính báo giá `exceptQuote`). */
const heldQty = (sku, exceptQuote = '') => (state.holds.get(sku) || []).filter(h => h.quoteId !== exceptQuote).reduce((t, h) => t + h.qty, 0);
/** Ô "Đang treo": số + link báo giá / đơn / HĐKT đang giữ (bấm mở). */
const holdLink = h => h.orderId
  ? `<a href="${docHref(h.orderId, h.contractNo)}" title="${esc(h.customer)} · ${fmtNum(h.qty)} · giữ đến khi giao xong hoặc huỷ">${esc(h.contractNo ? 'HĐKT ' + h.contractNo : h.orderNo)}</a>`
  : `<a href="#/quotes/${esc(h.quoteId)}" title="${esc(h.customer)} · ${fmtNum(h.qty)} · giữ đến ${esc(new Date(h.expiresAt).toLocaleString('vi-VN'))}">${esc(h.quoteNo)}</a>`;
const heldCell = (sku, exceptQuote = '') => {
  const list = (state.holds.get(sku) || []).filter(h => h.quoteId !== exceptQuote);
  return list.length ? `${fmtNum(heldQty(sku, exceptQuote))}<small>${list.map(holdLink).join(', ')}</small>` : '<span class="muted">—</span>';
};
const stockTotal = p => state.warehouses.filter(w => w.kind === 'stock').reduce((s, w) => s + (Number(p.stock?.[w.id]) || 0), 0);
/** Tồn khả dụng = tổng kho thật − đang treo cho báo giá khác (treo tự hết khi quá hạn 5 ngày). */
const availableStock = (p, exceptQuote = '') => stockTotal(p) - heldQty(p.sku, exceptQuote);
const stockDetail = p => state.warehouses.filter(w => p.stock?.[w.id] !== undefined).map(w => `${w.name}: ${fmtNum(Number(p.stock[w.id]))}`).join('\n');
const thumb = p => imgTag(p.imageUrl);
function applyCatalogMeta(d) {
  if (d.policies) state.policies = d.policies;
  if (d.warehouses) state.warehouses = d.warehouses;
  const sel = $('#product-policy');
  sel.innerHTML = state.policies.map(p => `<option value="${esc(p.id)}">Bảng giá: ${esc(p.name)}</option>`).join('');
  sel.value = currentPolicy(); sel.hidden = state.policies.length < 2;
  $('#product-price-head').textContent = state.policies.find(p => p.id === currentPolicy())?.name || 'Giá';
  $('#product-sub').textContent = d.observedAt ? `Danh mục cập nhật lúc ${new Date(d.observedAt).toLocaleString('vi-VN')}. Chọn sản phẩm để tạo báo giá nhanh.` : 'Danh mục, giá bán và tồn kho để chọn nhanh khi lập báo giá.';
}
let productReq = 0, brandsLoaded = false;
let productPager;
async function loadProducts() {
  loadHolds().then(() => { if (state.products) renderProducts?.(); });
  const req = ++productReq;
  productPager ||= createPager($('#product-pager'), 'products', () => loadProducts(), 50);
  state.products = null; renderProducts();
  try {
    const d = await api(`/products?limit=${productPager.limit}&offset=${productPager.offset}&q=${encodeURIComponent(state.productQuery)}&brand=${encodeURIComponent(state.productBrand)}`);
    if (req !== productReq) return;
    applyCatalogMeta(d);
    state.products = d.products; state.productTotal = d.total;
  } catch (e) { state.products = state.products || []; if (e.status !== 401) showGlobalError(e.message); }
  renderProducts();
  if (!brandsLoaded) {
    brandsLoaded = true;
    api('/product-brands').then(d => {
      $('#product-brand').innerHTML = '<option value="">Mọi thương hiệu</option>' + d.brands.map(b => `<option value="${esc(b.name)}">${esc(b.name)} (${b.count})</option>`).join('');
      $('#product-brand').value = state.productBrand;
    }).catch(() => { brandsLoaded = false; });
  }
}
/** Thêm sản phẩm + duyệt sản phẩm mới (trial-ui/product-admin.js). */
$('#barcode-import').addEventListener('click', () => openBarcodeImport({ api, isManager, toast }).catch(e => toast(e.message, 'err')));
var productAdminUi = null; // eslint-disable-line no-var
/**
 * Ảnh sản phẩm còn nằm trên web cũ (chỉ xem được khi đăng nhập web cũ → PDF / Excel không chèn được): Manager bấm chuyển
 * sang kho ảnh mới, chạy từng đợt 20 mã tới khi hết (API /catalog/legacy-images, src/modules/integrations/api/legacy-images.ts).
 */
let legacyRunning = false;
async function legacyImagesBox() {
  const box = $('#legacy-images');
  if (!isManager()) { box.hidden = true; return; }
  let st; try { st = await api('/catalog/legacy-images'); } catch { box.hidden = true; return; }
  if (!st.remaining) { box.hidden = true; return; }
  box.hidden = false;
  box.innerHTML = `<div><b>Còn ${fmtNum(st.remaining)} sản phẩm dùng ảnh trên web cũ</b>
      <small>Ảnh này chỉ xem được khi đăng nhập web cũ nên file PDF / Excel báo giá không chèn được. Chuyển một lần sang kho ảnh mới là xong.</small>
      ${st.configured ? '' : '<small class="error">Chưa cấu hình: cần secret LEGACY_STAFF_EMAIL / LEGACY_STAFF_PASSWORD (tài khoản web cũ) trên Supabase và chạy migration 0042.</small>'}
      <small data-progress></small></div>
    <button type="button" class="btn primary small" data-legacy-run${st.configured ? '' : ' disabled'}>${legacyRunning ? 'Đang chuyển…' : 'Chuyển ảnh từ web cũ'}</button>`;
}
document.addEventListener('click', async e => {
  const b = e.target.closest('[data-legacy-run]'); if (!b || legacyRunning) return;
  legacyRunning = true; b.disabled = true; b.textContent = 'Đang chuyển…';
  const progress = () => document.querySelector('#legacy-images [data-progress]');
  let after = '', moved = 0, failed = [], legacySession = null, pauses = 0;
  const memberId = state.user?.id;
  try {
    for (;;) {
      const r = await api('/catalog/legacy-images/migrate', 'POST', { limit: 20, after, legacySession });
      moved += r.migrated; failed = failed.concat(r.failed); after = r.next || after;
      legacySession = r.legacySession || null;
      const p = progress(); if (p) p.textContent = `Đã chuyển ${fmtNum(moved)} ảnh · còn ${fmtNum(r.remaining)}${failed.length ? ` · ${failed.length} ảnh lỗi` : ''}`;
      if (r.paused) {
        if (++pauses > 3) throw new Error('Web cũ vẫn giới hạn đăng nhập (429). Ảnh đã chuyển được giữ nguyên; thử lại sau.');
        const resumeAt = Date.now() + Math.max(1, Number(r.retryAfter) || 900) * 1000;
        while (Date.now() < resumeAt) {
          if (state.user?.id !== memberId) return;
          const waiting = progress(); if (waiting) waiting.textContent = 'Web cũ giới hạn đăng nhập (429). Tự tiếp tục sau ' + Math.ceil((resumeAt - Date.now()) / 1000) + ' giây. Đã chuyển ' + fmtNum(moved) + ' ảnh.';
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
        continue;
      }
      if (state.user?.id !== memberId) return;
      if (r.finished || !r.next) break;
    }
    toast(`Đã chuyển ${fmtNum(moved)} ảnh sang kho mới.` + (failed.length ? ` ${failed.length} ảnh lỗi (vd ${failed[0].sku}: ${failed[0].error}) – giữ link cũ.` : ''), failed.length ? 'err' : 'ok');
    state.products = null; // tải lại danh mục để thấy link ảnh mới
  } catch (ex) { toast(ex.message, 'err'); }
  finally { legacyRunning = false; legacyImagesBox(); }
});
/** Popup chọn kho Sapo khi sinh đơn hàng / lập HĐKT (trial-ui/sapo-push.js). */
var sapoPushUi = null; // eslint-disable-line no-var
const sapoPush = () => sapoPushUi ||= initSapoPush({ api, esc, $ });
/** Báo kết quả đẩy Sapo (kèm cảnh báo: chưa khớp NV phụ trách Sapo, tổng tiền lệch…). */
function sapoToast(s) {
  if (!s) return;
  if (s.status === 'updating') toast(s.message || `Đã giao Claw tạo đơn Sapo ${s.code}.`);
  else toast(`${s.status === 'existing' ? 'Đã liên kết đơn Sapo có sẵn' : 'Đã tạo đơn nháp Sapo'} ${s.code}${s.location ? ` · ${s.location}` : ''}.`);
  for (const w of s.warnings || []) toast(w, 'err');
}
function productAdmin() {
  return productAdminUi ||= initProductAdmin({ api, toast, esc, money, confirmBox, isManager, canApprove, userId: () => state.user?.id, policies: () => state.policies || [], onChanged: () => loadProducts() });
}
$('#new-product').addEventListener('click', () => productAdmin().openCreate());
var productActionsUi = null;
function productActions() {
  return productActionsUi ||= initProductActions({ api, toast, esc, money, isManager, policy: currentPolicy, warehouses: () => state.warehouses || [], onChanged: () => { catalog.checkedAt = 0; catalog.items = null; loadProducts(); loadCatalogSnapshot(); } });
}
const PRODUCT_EXPORT_PREF = 'bn-product-export-columns-v1';
const productExportColumns = d => [
  { id: 'sku', label: 'Mã SKU', group: 'Cơ bản', width: 18, get: p => p.sku },
  { id: 'barcodes', label: 'Barcode', group: 'Cơ bản', width: 20, get: p => (p.barcodes || []).join(', ') },
  { id: 'name', label: 'Tên sản phẩm', group: 'Cơ bản', width: 55, get: p => p.name },
  { id: 'brand', label: 'Thương hiệu', group: 'Cơ bản', width: 18, get: p => p.brand },
  { id: 'pattern', label: 'Mẫu / phiên bản', group: 'Cơ bản', width: 20, get: p => p.pattern },
  { id: 'unit', label: 'Đơn vị tính', group: 'Cơ bản', width: 14, get: p => p.unit },
  { id: 'sapoProductId', label: 'Sapo Product ID', group: 'Sapo', width: 18, get: p => p.sapoProductId },
  { id: 'taxBasis', label: 'Loại giá / thuế', group: 'Thuế', width: 22, get: p => p.taxBasis },
  { id: 'taxIn', label: 'Thuế đầu vào (%)', group: 'Thuế', width: 16, get: p => p.taxIn },
  { id: 'taxOut', label: 'Thuế đầu ra (%)', group: 'Thuế', width: 16, get: p => p.taxOut },
  { id: 'perCarton', label: 'Số lượng / thùng', group: 'Quy cách', width: 18, get: p => p.perCarton },
  { id: 'cartonWeight', label: 'Kg / thùng', group: 'Quy cách', width: 14, get: p => p.cartonWeight },
  { id: 'cartonLength', label: 'Dài thùng (cm)', group: 'Quy cách', width: 16, get: p => p.cartonLength },
  { id: 'cartonWidth', label: 'Rộng thùng (cm)', group: 'Quy cách', width: 16, get: p => p.cartonWidth },
  { id: 'cartonHeight', label: 'Cao thùng (cm)', group: 'Quy cách', width: 16, get: p => p.cartonHeight },
  { id: 'imageUrl', label: 'Link hình ảnh', group: 'Khác', width: 45, get: p => p.imageUrl },
  { id: 'stockUpdatedAt', label: 'Cập nhật tồn lúc', group: 'Tồn kho', width: 22, get: p => p.stockUpdatedAt },
  ...(d.priced ? d.policies.map(x => ({ id: 'price:' + x.id, label: x.name, group: 'Bảng giá', width: 18, get: p => p.prices?.[x.id] ?? null })) : []),
  ...d.warehouses.map(x => ({ id: 'stock:' + x.id, label: 'Tồn · ' + x.name, group: 'Tồn kho', width: 18, get: p => p.stock?.[x.id] ?? 0 })),
  { id: 'stock:total', label: 'Tổng tồn', group: 'Tồn kho', width: 14, get: p => Object.values(p.stock || {}).reduce((a, v) => a + (Number(v) || 0), 0) },
];
async function openProductExport() {
  const dlg = document.createElement('dialog'); dlg.className = 'modal';
  const defaults = ['sku', 'barcodes', 'name', 'brand', 'unit', 'stock:total'];
  let saved = defaults; try { saved = JSON.parse(localStorage.getItem(PRODUCT_EXPORT_PREF)) || defaults; } catch { /* mặc định */ }
  const known = [
    ['sku', 'Mã SKU', 'Cơ bản'], ['barcodes', 'Barcode', 'Cơ bản'], ['name', 'Tên sản phẩm', 'Cơ bản'], ['brand', 'Thương hiệu', 'Cơ bản'],
    ['pattern', 'Mẫu / phiên bản', 'Cơ bản'], ['unit', 'Đơn vị tính', 'Cơ bản'], ['sapoProductId', 'Sapo Product ID', 'Sapo'],
    ['taxBasis', 'Loại giá / thuế', 'Thuế'], ['taxIn', 'Thuế đầu vào (%)', 'Thuế'], ['taxOut', 'Thuế đầu ra (%)', 'Thuế'],
    ['perCarton', 'Số lượng / thùng', 'Quy cách'], ['cartonWeight', 'Kg / thùng', 'Quy cách'], ['cartonLength', 'Dài thùng', 'Quy cách'],
    ['cartonWidth', 'Rộng thùng', 'Quy cách'], ['cartonHeight', 'Cao thùng', 'Quy cách'], ['imageUrl', 'Link hình ảnh', 'Khác'],
    ['stockUpdatedAt', 'Cập nhật tồn lúc', 'Tồn kho'],
    ...((seesPrices() ? state.policies : []) || []).map(x => ['price:' + x.id, x.name, 'Bảng giá']),
    ...(state.warehouses || []).map(x => ['stock:' + x.id, 'Tồn · ' + x.name, 'Tồn kho']), ['stock:total', 'Tổng tồn', 'Tồn kho'],
  ];
  const grouped = Map.groupBy ? Map.groupBy(known, x => x[2]) : known.reduce((m, x) => (m.set(x[2], [...(m.get(x[2]) || []), x]), m), new Map());
  dlg.innerHTML = `<form method="dialog"><div class="modal-head"><div><span class="eyebrow">Sản phẩm</span><h2>Xuất danh sách Excel</h2></div><button class="icon-btn" value="cancel" aria-label="Đóng">×</button></div>
    <div class="modal-body"><div class="form-grid cols-2"><label>Phạm vi<select data-scope><option value="filter">Kết quả đang lọc (${fmtNum(state.productTotal || 0)})</option><option value="all">Toàn bộ danh mục</option>${state.selected.size ? `<option value="selected">${fmtNum(state.selected.size)} sản phẩm đã chọn</option>` : ''}</select></label></div>
    <div class="toolbar"><button type="button" class="btn ghost small" data-all>Chọn tất cả</button><button type="button" class="btn ghost small" data-none>Bỏ chọn</button><button type="button" class="btn ghost small" data-default>Mặc định</button></div>
    <div class="export-columns">${[...grouped].map(([g, xs]) => `<fieldset><legend>${esc(g)}</legend>${xs.map(x => `<label><input type="checkbox" value="${esc(x[0])}" ${saved.includes(x[0]) ? 'checked' : ''}> ${esc(x[1])}</label>`).join('')}</fieldset>`).join('')}</div>
    <p class="error" data-error></p></div><div class="modal-foot"><button class="btn secondary" value="cancel">Huỷ</button><button type="button" class="btn primary" data-export>Xuất Excel</button></div></form>`;
  document.body.append(dlg); const boxes = () => [...dlg.querySelectorAll('input[type=checkbox]')];
  dlg.querySelector('[data-all]').onclick = () => boxes().forEach(x => x.checked = true);
  dlg.querySelector('[data-none]').onclick = () => boxes().forEach(x => x.checked = false);
  dlg.querySelector('[data-default]').onclick = () => boxes().forEach(x => x.checked = defaults.includes(x.value));
  dlg.addEventListener('close', () => dlg.remove(), { once: true });
  dlg.querySelector('[data-export]').onclick = async e => {
    const ids = boxes().filter(x => x.checked).map(x => x.value), err = dlg.querySelector('[data-error]');
    if (!ids.length) { err.textContent = 'Chọn ít nhất một cột.'; return; }
    const b = e.currentTarget; b.disabled = true; b.textContent = 'Đang tạo file…';
    try {
      const scope = dlg.querySelector('[data-scope]').value, params = new URLSearchParams();
      if (scope === 'selected') params.set('skus', [...state.selected].join(','));
      else if (scope === 'filter') { if (state.productQuery) params.set('q', state.productQuery); if (state.productBrand) params.set('brand', state.productBrand); }
      const d = await api('/products-export?' + params), cols = productExportColumns(d).filter(x => ids.includes(x.id));
      localStorage.setItem(PRODUCT_EXPORT_PREF, JSON.stringify(ids));
      await downloadExcel('danh-sach-san-pham', [{ name: 'Sản phẩm', header: cols.map(x => x.label), rows: d.products.map(p => cols.map(x => x.get(p))), widths: cols.map(x => x.width), autoFilter: true }]);
      dlg.close(); toast(`Đã xuất ${fmtNum(d.products.length)} sản phẩm.`);
    } catch (ex) { err.textContent = ex.message; b.disabled = false; b.textContent = 'Xuất Excel'; }
  };
  dlg.showModal();
}
$('#product-export').addEventListener('click', openProductExport);
$('#product-actions').addEventListener('click', e => {
  const action = e.target.closest('[data-product-action]')?.dataset.productAction;
  if (action === 'value' || action === 'audit') productActions().report(action);
  else if (action === 'sapo-stock') openSapoStockImport({ api, isManager, toast, onChanged: () => { catalog.checkedAt = 0; catalog.items = null; loadProducts(); loadCatalogSnapshot(); } }).catch(ex => toast(ex.message, 'err'));
  else if (action === 'stock' || action === 'packing') productActions().openImport(action).catch(ex => toast(ex.message, 'err'));
});
function renderProducts() {
  const tbody = $('#product-list');
  if (!state.products) { tbody.innerHTML = skeleton(7); $('#product-empty').hidden = true; return; }
  const list = state.products, filtered = state.productQuery || state.productBrand;
  $('#product-count').textContent = state.productTotal ? `${state.productTotal.toLocaleString('vi-VN')} sản phẩm` : '';
  tbody.innerHTML = list.map(p => {
    const price = productPrice(p), stock = availableStock(p), sel = state.selected.has(p.sku);
    return `<tr>
      <td class="check-cell"><input type="checkbox" data-select="${esc(p.sku)}" ${sel ? 'checked' : ''} aria-label="Chọn ${esc(p.name)}"></td>
      <td class="first"><button type="button" class="prod-cell prod-open" data-product-card="${esc(p.sku)}" data-name="${esc(p.name)}" title="Xem tồn kho và lịch sử sản phẩm">${thumb(p)}<span><span class="strong">${esc(p.name)}</span><small>${esc(p.sku)}${p.pattern ? ' · ' + esc(p.pattern) : ''}</small></span></button></td>
      <td data-label="Thương hiệu">${esc(p.brand) || '—'}</td>
      <td data-label="ĐVT">${esc(p.unit) || '—'}</td>
      <td class="right num" data-label="Giá">${!seesPrices() ? '<span class="muted">—</span>' : price === null ? '<span class="muted">Chưa có giá</span>' : money(price)}</td>
      <td class="right num ${stock <= 0 ? 'stock-out' : stock < 10 ? 'stock-low' : ''}" data-label="Tồn" title="${esc(stockDetail(p))}${heldQty(p.sku) ? ` · đang treo ${fmtNum(heldQty(p.sku))}` : ''}">${fmtNum(stock)}${heldQty(p.sku) ? `<small>treo ${fmtNum(heldQty(p.sku))}</small>` : ''}</td>
      <td class="actions-cell"><div class="row-actions">${can('page.quotes') ? `<button class="btn ghost small" data-quote-product="${esc(p.sku)}" title="Tạo báo giá với sản phẩm này">＋ Báo giá</button>` : ''}</div></td>
    </tr>`;
  }).join('');
  $('#product-empty').hidden = list.length > 0;
  $('#product-empty-title').textContent = filtered ? 'Không tìm thấy sản phẩm' : 'Chưa có dữ liệu sản phẩm';
  $('#product-empty-text').textContent = filtered ? 'Thử từ khoá khác hoặc bỏ lọc thương hiệu.' : 'Danh mục sẽ hiện ở đây sau khi nhập dữ liệu từ web cũ.';
  $('#product-table').hidden = list.length === 0;
  productPager?.render(state.productTotal);
  renderSelection();
}
function renderSelection() {
  const n = state.selected.size;
  $('#product-selection').hidden = n === 0;
  $('#product-selection-text').textContent = `Đã chọn ${n} sản phẩm`;
}
/** Chiết khấu theo thương hiệu của khách đang chọn trên báo giá (trang chi tiết khách hàng) – điền sẵn CK khi thêm sản phẩm. */
async function loadBrandDiscounts() {
  const id = editor.customerId;
  editor.brandDiscounts = null;
  if (!id) return;
  try { const { discounts } = await api(`/customers/${encodeURIComponent(id)}/discounts`); if (editor.customerId === id) editor.brandDiscounts = discounts; } catch { /* không có CK riêng */ }
}
/**
 * Dòng báo giá từ sản phẩm trong danh mục – port `catalogChoice`/`addProduct` của bản cũ:
 * VAT dòng = thuế đầu ra (không chịu thuế → 0%); bảng giá có chữ "VAT" hoặc sản phẩm "Giá đã bao gồm thuế"
 * thì quy về giá chưa thuế; Manager được điền sẵn giá vốn theo chiết khấu mua vào mặc định của thương hiệu.
 * Trả null (kèm thông báo) nếu bảng giá chưa có giá hoặc sản phẩm chịu thuế mà chưa có thuế đầu ra.
 */
function rowFromProduct(p) {
  const policy = state.policies.find(x => x.id === currentPolicy()), raw = priceOf(p, currentPolicy());
  if (raw === null) { toast(`${p.sku}: bảng giá "${policy?.name || ''}" chưa có giá. Chọn bảng giá khác.`, 'err'); return null; }
  if (p.taxable && !Number.isFinite(p.taxOut)) { toast(`${p.sku}: chưa có thuế đầu ra. Cập nhật thuế trên Sapo trước.`, 'err'); return null; }
  const tax = p.taxable ? p.taxOut : 0;
  const included = /VAT/i.test(policy?.name || '') || p.taxBasis === 'Giá đã bao gồm thuế';
  const price = netPrice(raw, tax, included);
  const row = { ...blankRow(), name: p.name, sku: p.sku, unit: p.unit || '', brand: p.brand || '', pattern: p.pattern || '', price, taxRate: tax, pricePolicy: policy?.name || '', packagingDescription: PACKAGING_DEFAULT };
  // CK theo thương hiệu của khách (Minh Long / Lys / Lock) – thay CK mặc định của dòng khi khách có thiết lập.
  const brandDisc = editor.brandDiscounts ? customerDiscount(row.brand, editor.brandDiscounts, row.discountType === 'amount' ? 'amount' : 'percent', price) : 0;
  if (brandDisc > 0) row.discount = row.discountType === 'amount' ? Math.round(brandDisc) : brandDisc;
  if (isManager()) { const d = defaultCostDiscount(p); if (d !== null) { row.purchaseDiscount = d; row.costPrice = purchasePrice(price, d); } }
  if (savableImage(p.imageUrl)) row.image = p.imageUrl;
  for (const k of ['perCarton', 'cartonWeight', 'cartonLength', 'cartonWidth', 'cartonHeight']) if (Number(p[k]) > 0) row[k] = Number(p[k]);
  return row;
}
const rowsFromProducts = list => list.map(rowFromProduct).filter(Boolean);
let productTimer;
const reloadProducts = () => { productPager?.reset(); loadProducts(); };
$('#product-search').addEventListener('input', e => { state.productQuery = e.target.value; clearTimeout(productTimer); productTimer = setTimeout(reloadProducts, 250); });
$('#product-brand').addEventListener('change', e => { state.productBrand = e.target.value; reloadProducts(); });
$('#product-policy').addEventListener('change', e => { preferredPolicy = e.target.value; try { localStorage.setItem(POLICY_KEY, preferredPolicy); } catch { /* bỏ qua */ } applyCatalogMeta({}); renderProducts(); });
$('#product-list').addEventListener('change', e => {
  const box = e.target.closest('[data-select]'); if (!box) return;
  const p = state.products.find(x => x.sku === box.dataset.select);
  if (box.checked) state.selected.set(p.sku, p); else state.selected.delete(p.sku);
  renderSelection();
});
$('#product-list').addEventListener('click', e => {
  const b = e.target.closest('[data-quote-product]'); if (!b) return;
  const rows = rowsFromProducts([state.products.find(x => x.sku === b.dataset.quoteProduct)]);
  if (!rows.length) return;
  editor.pending = newQuoteData({ rows }); go('#/quotes/new');
});
$('#product-clear').addEventListener('click', () => { state.selected.clear(); renderProducts(); });
$('#product-to-quote').addEventListener('click', () => {
  const rows = rowsFromProducts([...state.selected.values()]);
  if (!rows.length) return;
  editor.pending = newQuoteData({ rows });
  state.selected.clear(); renderSelection(); go('#/quotes/new');
});

// ----- Manager nhập file danh mục (JSON từ web cũ: /api/staff/catalog)
$('#catalog-file').addEventListener('change', async e => {
  const file = e.target.files?.[0]; e.target.value = '';
  if (!file) return;
  let data;
  try { data = JSON.parse(await file.text()); } catch { toast('File không phải JSON hợp lệ.', 'err'); return; }
  const n = Array.isArray(data?.products) ? data.products.length : 0;
  if (data?.format !== 'sapo-catalog-v1' || !n) { toast('Đây không phải file danh mục của web báo giá cũ (định dạng sapo-catalog-v1).', 'err'); return; }
  if (!await confirmBox(`Nhập ${n.toLocaleString('vi-VN')} sản phẩm, ${data.pricePolicies?.length || 0} bảng giá, ${data.warehouses?.length || 0} kho từ "${file.name}"? Giá và tồn kho sẽ được cập nhật theo file; sản phẩm không có trong file sẽ bị ẩn.`, { title: 'Nhập danh mục', ok: 'Nhập' })) return;
  const label = $('#catalog-import-label'); label.classList.add('busy');
  // Gửi theo lô 500 mã; lô cuối kèm replaceAll + toàn bộ mã của file để ẩn sản phẩm không còn. Lỗi giữa chừng: chọn lại file chạy lại.
  const BATCH = 500, allSkus = data.products.map(p => p?.sku).filter(x => typeof x === 'string').map(x => x.trim());
  try {
    for (let i = 0; i < n; i += BATCH) {
      const last = i + BATCH >= n;
      await api('/admin/catalog-import', 'POST', { ...data, products: data.products.slice(i, i + BATCH), ...(last ? { replaceAll: true, allSkus } : {}) });
      $('#product-count').textContent = `Đang nhập ${Math.min(i + BATCH, n).toLocaleString('vi-VN')}/${n.toLocaleString('vi-VN')}…`;
    }
    toast(`Đã nhập ${n.toLocaleString('vi-VN')} sản phẩm.`);
    brandsLoaded = false; state.selected.clear(); loadProducts();
  } catch (ex) { toast(ex.message + ' Chọn lại file để nhập tiếp.', 'err'); loadProducts(); }
  finally { label.classList.remove('busy'); }
});

// ----- tìm sản phẩm ngay trong dòng báo giá (gõ tên hoặc mã SKU)
const pSuggest = $('#product-suggest');
let pTimer, pReq = 0, pItems = [], pIndex = -1, pInput = null;
function hideProductSuggest() { pSuggest.hidden = true; pItems = []; pIndex = -1; }
function placeProductSuggest() {
  if (!pInput) return;
  const r = pInput.getBoundingClientRect();
  // position: fixed → toạ độ theo màn hình (đúng cả khi trang cuộn hay chỉ vùng nội dung cuộn trên điện thoại).
  pSuggest.style.left = Math.max(8, Math.min(r.left, innerWidth - pSuggest.offsetWidth - 8)) + 'px';
  pSuggest.style.top = r.bottom + 4 + 'px';
}
function searchProducts(input) {
  pInput = input; clearTimeout(pTimer);
  const q = input.value.trim();
  if (q.length < 2) { hideProductSuggest(); return; }
  pTimer = setTimeout(async () => {
    const req = ++pReq;
    let found;
    if (catalog.items) found = (searchCatalog(catalog.items, { q }) || []).slice(0, 8); // danh mục đã tải sẵn: lọc ngay
    else {
      let d;
      try { d = await api(`/products?limit=8&q=${encodeURIComponent(q)}`); } catch { return; }
      applyCatalogMeta(d); found = d.products;
    }
    if (req !== pReq || document.activeElement !== input) return;
    pItems = found; pIndex = pItems.length ? 0 : -1;
    if (!pItems.length) { hideProductSuggest(); return; }
    pSuggest.innerHTML = pItems.map((p, i) => {
      const price = productPrice(p);
      return `<li role="option" data-i="${i}" aria-selected="${i === pIndex}"><span class="prod-opt">${thumb(p)}<span class="prod-text"><b>${esc(p.name)}</b><small>${esc([p.sku, p.brand, p.unit].filter(Boolean).join(' · '))} · tồn ${fmtNum(availableStock(p))}</small></span><span class="price">${price === null ? '' : money(price)}</span></span></li>`;
    }).join('');
    pSuggest.hidden = false; placeProductSuggest();
  }, catalog.items ? 30 : 200);
}
function pickProduct(p) {
  const tr = pInput?.closest('tr'); if (!tr) return;
  const i = Number(tr.dataset.i), old = editor.rows[i], row = rowFromProduct(p);
  if (!row) return;
  editor.rows[i] = { ...row, id: old.id, qty: old.qty || 1, discount: old.discount, discountType: old.discountType, printFee: old.printFee };
  hideProductSuggest(); markDirty(); renderLines();
  $(`#line-list tr[data-i="${i}"] [data-k="qty"]`)?.focus();
}
$('#line-list').addEventListener('input', e => { if (e.target.matches('[data-k="name"], [data-k="sku"]')) searchProducts(e.target); });
$('#line-list').addEventListener('focusout', e => { if (e.target === pInput) setTimeout(hideProductSuggest, 150); });
$('#line-list').addEventListener('keydown', e => {
  if (pSuggest.hidden || e.target !== pInput) return;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault(); e.stopImmediatePropagation();
    pIndex = (pIndex + (e.key === 'ArrowDown' ? 1 : -1) + pItems.length) % pItems.length;
    $$('li', pSuggest).forEach((li, i) => li.setAttribute('aria-selected', String(i === pIndex)));
  } else if (e.key === 'Enter' && pItems[pIndex]) { e.preventDefault(); e.stopImmediatePropagation(); pickProduct(pItems[pIndex]); }
  else if (e.key === 'Escape') hideProductSuggest();
}, true);
pSuggest.addEventListener('mousedown', e => { const li = e.target.closest('li[data-i]'); if (li) { e.preventDefault(); pickProduct(pItems[li.dataset.i]); } });
addEventListener('resize', () => { if (!pSuggest.hidden) placeProductSuggest(); });
addEventListener('scroll', () => { if (!pSuggest.hidden) placeProductSuggest(); }, true); // cuộn bất kỳ vùng nào: ô gợi ý đi theo ô nhập

// ----- chọn sản phẩm từ danh mục ngay trong báo giá
let pickerReq = 0, pickerItems = [], pickerTotal = 0, pickerAdded = 0, pickerTimer;
/** Chỉ hàng Lock&Lock có kho NCC (tồn bên nhà cung cấp); hãng khác ẩn cho gọn. */
const hasSupplierStock = p => brandDiscountKey(p?.brand || p?.name) === 'lock'; // chưa có nhãn hiệu trên Sapo thì nhận theo tên
const kindStock = (p, kind) => { const ws = state.warehouses.filter(w => w.kind === kind && p.stock?.[w.id] !== undefined); return ws.length ? ws.reduce((t, w) => t + Number(p.stock[w.id] || 0), 0) : null; };
const stockText = v => v === null ? '—' : fmtNum(v);
/** Ô "Hàng chờ về": có số > 0 thì bấm được → hộp các đơn mua NCC đang về của mã (số đơn, NCC, ngày hẹn). */
const incomingCell = p => { const v = kindStock(p, 'incoming'); return v > 0 ? `<button type="button" class="link-btn" data-incoming-sku="${esc(p.sku)}" title="Xem các đơn mua NCC đang về">${fmtNum(v)}</button>` : stockText(v); };
document.addEventListener('click', e => { const b = e.target.closest('[data-incoming-sku]'); if (b) { e.preventDefault(); showIncoming(b.dataset.incomingSku); } });
async function showIncoming(sku) {
  const dlg = document.createElement('dialog'); dlg.className = 'modal incoming-dialog';
  dlg.innerHTML = `<div class="modal-head"><div><span class="eyebrow">Hàng chờ về</span><h2>${esc(sku)}</h2></div><button type="button" class="icon-btn" data-x aria-label="Đóng">×</button></div>
    <div class="modal-body"><p class="muted">Đang tải…</p></div><div class="modal-foot"><button type="button" class="btn secondary" data-x>Đóng</button></div>`;
  document.body.append(dlg);
  const close = () => { dlg.close(); dlg.remove(); };
  // Bấm mở đơn mua: đóng luôn các hộp đang mở (Kiểm tồn…) để thấy trang đơn mua.
  dlg.addEventListener('click', e => { if (e.target.closest('[data-x]')) close(); else if (e.target.closest('a')) { close(); $$('dialog[open]').forEach(d => d.close()); } });
  dlg.addEventListener('cancel', close); dlg.showModal();
  const body = dlg.querySelector('.modal-body');
  try {
    const p = (await api('/inventory/lookup?q=' + encodeURIComponent(sku))).products.find(x => x.sku.toLowerCase() === sku.toLowerCase());
    const orders = p?.incoming?.orders || [], dmy = d => d ? d.slice(0, 10).split('-').reverse().join('/') : '';
    body.innerHTML = !orders.length ? '<p class="muted">Không còn đơn mua NCC nào đang về cho mã này.</p>'
      : `<p class="small muted">${esc(p.name)} · tổng đang về <b>${fmtNum(p.incoming.qty)}</b></p>
        <div class="table-wrap"><table class="data-table"><thead><tr><th>Đơn mua</th><th>NCC</th><th>Ngày hẹn về</th><th class="right">Còn về</th></tr></thead><tbody>
        ${orders.map(o => `<tr><td>${can('page.purchases') ? `<a href="#/purchases/${esc(encodeURIComponent(o.orderId))}">${esc(o.ticketNumber)}</a>` : esc(o.ticketNumber)}${o.internalNo ? `<small>Số NCC ${esc(o.internalNo)}</small>` : ''}</td>
          <td>${esc(o.supplierName || '—')}</td><td>${o.arrivalDate ? esc(dmy(o.arrivalDate)) : '<span class="muted">Chưa hẹn</span>'}</td><td class="right">${fmtNum(o.qty)}</td></tr>`).join('')}
        </tbody></table></div>`;
  } catch (ex) { body.innerHTML = `<p class="error">${esc(ex.message)}</p>`; }
}
/** Bộ lọc giống "Tìm nhanh sản phẩm" của web cũ: phạm vi theo loại báo giá, nhóm, khoảng giá theo chính sách đang chọn. */
function pickerQuery(offset) {
  const v = id => $(id).value.trim(), params = new URLSearchParams({ limit: '20', offset: String(offset), q: v('#picker-search'), policy: currentPolicy() });
  if (!$('#picker-all').checked) params.set('scope', editor.type === 'VIGIFTS' ? 'other' : 'minhlong');
  if (v('#picker-group')) params.set('group', v('#picker-group'));
  if (v('#picker-min')) params.set('min', v('#picker-min'));
  if (v('#picker-max')) params.set('max', v('#picker-max'));
  return params;
}
function pickerPolicyOptions() {
  $('#picker-policy').innerHTML = state.policies.map(p => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('');
  $('#picker-policy').value = currentPolicy();
}
// ----- Danh mục tải sẵn về trình duyệt (như web cũ): gõ là lọc ngay, không phải hỏi máy chủ mỗi lần.
const IDB = { db: 'bn-catalog', store: 'snapshot', key: 'current' };
function idb(mode, fn) {
  return new Promise((resolve, reject) => {
    try {
      const open = indexedDB.open(IDB.db, 1);
      open.onupgradeneeded = () => open.result.createObjectStore(IDB.store);
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const tx = open.result.transaction(IDB.store, mode), req = fn(tx.objectStore(IDB.store));
        tx.oncomplete = () => { open.result.close(); resolve(req?.result); };
        tx.onerror = () => { open.result.close(); reject(tx.error); };
      };
    } catch (e) { reject(e); }
  });
}
function useSnapshot(snap) {
  catalog.version = snap.version; catalog.observedAt = snap.observedAt; catalog.items = hydrateSnapshot(snap);
  applyCatalogMeta({ policies: snap.policies, warehouses: snap.warehouses });
}
/** Lấy bản chụp danh mục: bộ nhớ → IndexedDB (mở trang là có) → máy chủ (chỉ tải lại khi Sapo có thay đổi). */
function loadCatalogSnapshot({ maxAgeMs = 120000 } = {}) {
  if (catalog.loading) return catalog.loading;
  if (catalog.items && Date.now() - catalog.checkedAt < maxAgeMs) return Promise.resolve(catalog.items);
  catalog.loading = (async () => {
    if (!catalog.items) { try { const saved = await idb('readonly', st => st.get(IDB.key)); if (saved?.version) useSnapshot(saved); } catch { /* trình duyệt chặn IndexedDB */ } }
    try {
      const d = await api('/catalog-snapshot' + (catalog.version ? '?v=' + encodeURIComponent(catalog.version) : ''));
      catalog.checkedAt = Date.now();
      if (!d.unchanged) {
        useSnapshot(d);
        idb('readwrite', st => st.put(d, IDB.key)).catch(() => {});
        if ($('#picker-dialog').open) loadPicker(); // đang mở hộp tìm thì cập nhật kết quả theo dữ liệu mới
      }
    } catch { /* lỗi mạng: dùng bản đang có, hoặc tìm qua máy chủ */ }
    return catalog.items;
  })().finally(() => { catalog.loading = null; });
  return catalog.loading;
}
let pickerShown = 20;
function pickerOptions() {
  const v = id => $(id).value.trim();
  return { q: v('#picker-search'), group: v('#picker-group'), policy: currentPolicy(), min: v('#picker-min'), max: v('#picker-max'),
    scope: $('#picker-all').checked ? '' : editor.type === 'VIGIFTS' ? 'other' : 'minhlong' };
}
async function loadPicker(more = false) {
  const req = ++pickerReq, offset = more ? pickerItems.length : 0;
  const min = $('#picker-min').value, max = $('#picker-max').value;
  if ((min !== '' && Number(min) < 0) || (max !== '' && Number(max) < 0) || (min !== '' && max !== '' && Number(min) > Number(max))) {
    $('#picker-status').textContent = 'Giá từ phải nhỏ hơn hoặc bằng giá đến, và không được âm.'; $('#picker-list').innerHTML = ''; $('#picker-more-row').hidden = true; return;
  }
  if (catalog.items) { // lọc ngay trên máy
    pickerShown = more ? pickerShown + 20 : 20;
    const found = searchCatalog(catalog.items, pickerOptions()) || [];
    pickerItems = found.slice(0, pickerShown); pickerTotal = found.length;
    $('#picker-list').removeAttribute('aria-busy');
    renderPicker(catalog.observedAt, min, max);
    return;
  }
  if (!more) {
    // Bộ lọc/loại báo giá đổi: ẩn kết quả cũ cho tới khi có kết quả mới.
    pickerItems = []; $('#picker-list').innerHTML = ''; $('#picker-empty').hidden = true; $('#picker-more-row').hidden = true;
    $('#picker-status').textContent = 'Đang lọc sản phẩm…'; $('#picker-list').setAttribute('aria-busy', 'true');
  }
  let d;
  try { d = await api('/products?' + pickerQuery(offset)); }
  catch (e) { if (req === pickerReq) { $('#picker-status').textContent = ''; $('#picker-empty').textContent = e.message; $('#picker-empty').hidden = false; } return; }
  if (req !== pickerReq || catalog.items) return;
  $('#picker-list').removeAttribute('aria-busy');
  applyCatalogMeta(d);
  pickerItems = more ? [...pickerItems, ...d.products] : d.products; pickerTotal = d.total;
  renderPicker(d.observedAt, min, max);
}
function renderPicker(observedAt, min, max) {
  if (!$('#picker-policy').options.length) pickerPolicyOptions();
  $('#picker-snapshot').textContent = observedAt ? `Tồn kho chụp lúc ${new Date(observedAt).toLocaleString('vi-VN')} · Đơn giá báo giá chưa VAT.` : 'Đơn giá báo giá chưa VAT.';
  const inQuote = new Set(editor.rows.map(r => r.sku).filter(Boolean));
  const policy = state.policies.find(x => x.id === currentPolicy());
  $('#picker-list').innerHTML = pickerItems.map((p, i) => {
    const price = productPrice(p), included = /VAT/i.test(policy?.name || '') || p.taxBasis === 'Giá đã bao gồm thuế', has = inQuote.has(p.sku);
    const vat = p.taxable ? (Number.isFinite(p.taxOut) ? `VAT ${p.taxOut}%` : 'Chưa có thuế đầu ra') : 'Không áp dụng thuế';
    return `<li data-i="${i}" class="${has ? 'added' : ''}">${thumb(p)}
      <span class="prod-text"><b>${esc(p.name)}</b><small>Nhãn hiệu: ${esc(p.brand || 'Chưa có trên Sapo')}</small>
        <small>Mã ${esc(p.sku)} · ${esc(p.unit || '—')} · ${vat}</small>
        <small>Tồn khả dụng: <strong>${kindStock(p, 'stock') === null ? stockText(null) : fmtNum(availableStock(p, editor.id || ''))}</strong>${heldQty(p.sku, editor.id || '') ? ` (đang treo ${fmtNum(heldQty(p.sku, editor.id || ''))})` : ''} | ${hasSupplierStock(p) ? `Tồn NCC: ${stockText(kindStock(p, 'supplier'))} – ` : ''}Hàng chờ về: ${stockText(kindStock(p, 'incoming'))}</small></span>
      <span class="price">${price === null ? '<span class="muted">Chưa có giá</span>' : money(price)}<small>${included ? 'Đã gồm VAT' : 'Chưa VAT'}</small></span>
      <input class="num-input" inputmode="decimal" value="1" aria-label="Số lượng ${esc(p.name)}">
      <button type="button" class="btn secondary small pick-add" data-add="${i}" ${has ? 'disabled title="Sản phẩm đã có trong báo giá"' : ''}>${has ? '✓ Đã có' : '＋ Thêm'}</button>
    </li>`;
  }).join('');
  $('#picker-status').textContent = `${fmtNum(pickerTotal)} sản phẩm phù hợp · Giá theo chính sách "${policy?.name || ''}"${$('#picker-all').checked ? '' : editor.type === 'VIGIFTS' ? ' · Sản phẩm Vigifts' : ' · Sản phẩm Minh Long'}.`;
  $('#picker-empty').hidden = pickerItems.length > 0;
  $('#picker-empty').textContent = pickerTotal ? '' : $('#picker-search').value || $('#picker-group').value || min || max ? 'Không tìm thấy sản phẩm phù hợp. Thử bỏ bớt bộ lọc hoặc tick "Tìm trên tất cả sản phẩm".' : 'Chưa có dữ liệu sản phẩm.';
  $('#picker-more-row').hidden = pickerItems.length >= pickerTotal;
}
const reloadPicker = () => { clearTimeout(pickerTimer); pickerTimer = setTimeout(() => loadPicker(), catalog.items ? 30 : 250); };
/** Thêm dòng vào báo giá; dòng trống duy nhất (mới tạo) được thay luôn. */
function addRowsToQuote(rows) {
  const blank = editor.rows.length === 1 && !editor.rows[0].name && !Number(editor.rows[0].price) && !editor.rows[0].sku;
  const base = blank ? [] : editor.rows;
  if (base.length + rows.length > 300) { toast('Báo giá tối đa 300 dòng.', 'err'); return false; }
  editor.rows = [...base, ...rows]; markDirty(); renderLines(); return true;
}
$('#pick-products').addEventListener('click', () => {
  pickerAdded = 0; $('#picker-added').textContent = '';
  pickerPolicyOptions();
  $('#picker-filters').hidden = true;
  $('#picker-filter-toggle').textContent = 'Xem bộ lọc ▾';
  $('#picker-filter-toggle').setAttribute('aria-expanded', 'false');
  $('#picker-dialog').showModal(); $('#picker-search').focus(); loadHolds().then(loadPicker);
  loadCatalogSnapshot(); // kiểm tra nền: Sapo có dữ liệu mới thì cập nhật kết quả
});
$('#picker-search').addEventListener('input', reloadPicker);
$('#picker-filter-toggle').addEventListener('click', () => {
  const filters = $('#picker-filters'), show = filters.hidden;
  filters.hidden = !show;
  $('#picker-filter-toggle').textContent = show ? 'Ẩn bộ lọc ▴' : 'Xem bộ lọc ▾';
  $('#picker-filter-toggle').setAttribute('aria-expanded', String(show));
});
let pickerScrollTimer;
$('#picker-list').addEventListener('scroll', () => {
  clearTimeout(pickerScrollTimer);
  pickerScrollTimer = setTimeout(() => {
    const list = $('#picker-list');
    if (list.scrollTop + list.clientHeight < list.scrollHeight - 100 || pickerItems.length >= pickerTotal || list.dataset.loading === '1') return;
    list.dataset.loading = '1';
    loadPicker(true).finally(() => { delete list.dataset.loading; });
  }, 80);
});
$('#picker-policy').addEventListener('change', e => {
  preferredPolicy = e.target.value; try { localStorage.setItem(POLICY_KEY, preferredPolicy); } catch { /* bỏ qua */ }
  applyCatalogMeta({}); loadPicker();
});
$('#picker-all').addEventListener('change', () => loadPicker());
$('#picker-group').addEventListener('change', () => loadPicker());
$('#picker-range').addEventListener('change', e => {
  if (e.target.value === 'custom') { $('#picker-min').focus(); return; }
  const [min = '', max = ''] = e.target.value.split(':');
  $('#picker-min').value = min; $('#picker-max').value = max; loadPicker();
});
for (const id of ['#picker-min', '#picker-max']) $(id).addEventListener('input', () => { $('#picker-range').value = 'custom'; reloadPicker(); });
$('#picker-clear').addEventListener('click', () => {
  for (const id of ['#picker-search', '#picker-group', '#picker-range', '#picker-min', '#picker-max']) $(id).value = '';
  loadPicker(); $('#picker-search').focus();
});
$('#picker-more').addEventListener('click', () => loadPicker(true));
$('#picker-list').addEventListener('click', e => {
  const b = e.target.closest('[data-add]'); if (!b) return;
  const li = b.closest('li'), p = pickerItems[b.dataset.add], qty = parseNum(li.querySelector('input').value);
  if (!(qty > 0)) { li.querySelector('input').classList.add('invalid'); return; }
  const row = rowFromProduct(p);
  if (!row || !addRowsToQuote([{ ...row, qty }])) return;
  pickerAdded++; li.classList.add('added'); b.textContent = '✓ Đã thêm'; b.disabled = true;
  $('#picker-added').textContent = `Đã thêm ${pickerAdded} sản phẩm vào báo giá`;
});
$('#picker-list').addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.matches('input')) { e.preventDefault(); e.target.closest('li').querySelector('[data-add]').click(); } });

// ---------------------------------------------------------------- khách hàng
let customerId = null;
/** Số báo giá của các khách trên trang đang xem (máy chủ đếm trong phạm vi người xem, so tên không dấu). */
async function loadCustomerQuoteCounts(req) {
  const names = [...new Set((state.customers || []).map(c => c.name).filter(Boolean))];
  // Không có quyền Báo giá (VD Kế toán): không đếm, cột hiện "—".
  if (!can('page.quotes')) { state.customerQuoteCounts = {}; return; }
  try {
    const d = names.length ? await api('/quotes/customer-counts?' + names.map(n => 'name=' + encodeURIComponent(n)).join('&')) : { counts: {} };
    if (req !== customerReq) return;
    state.customerQuoteCounts = d.counts; renderCustomers();
  } catch { /* cột "Báo giá" để trống */ }
}
const quoteCountOf = name => state.customerQuoteCounts?.[name];
function renderCustomers() {
  const tbody = $('#customer-list');
  if (!state.customers) { tbody.innerHTML = skeleton(7); return; }
  const list = state.customers;
  $('#customer-count').textContent = `${state.customerTotal.toLocaleString('vi-VN')} khách hàng`;
  customerPager?.render(state.customerTotal);
  tbody.innerHTML = list.map(c => `
    <tr class="clickable" data-href="#/customers/${esc(encodeURIComponent(c.id))}">
      <td class="first"><a class="strong" href="#/customers/${esc(encodeURIComponent(c.id))}">${esc(c.name)}</a>${c.approvalStatus === 'pending' ? ' <span class="pill warn">Chờ duyệt</span>' : ''}${c.address ? `<small>${esc(c.address)}</small>` : ''}</td>
      <td data-label="Liên hệ">${esc(c.contact) || '—'}</td>
      <td data-label="ĐT">${c.phone ? `<a href="tel:${esc(c.phone.replace(/[^\d+]/g, ''))}">${esc(c.phone)}</a>` : '—'}</td>
      <td data-label="Email · MST">${esc(c.email) || '—'}${c.taxCode ? `<small>MST ${esc(c.taxCode)}</small>` : ''}</td>
      <td data-label="Phụ trách">${c.owner ? esc(c.owner.name) : '<span class="muted">—</span>'}${c.sharedCount ? `<small>+${c.sharedCount} được chia sẻ</small>` : ''}</td>
      <td class="right" data-label="Báo giá">${!can('page.quotes') ? '<span class="muted">—</span>' : quoteCountOf(c.name) ?? (state.customerQuoteCounts ? 0 : '…')}</td>
      <td class="actions-cell"><div class="row-actions">
        ${c.approvalStatus === 'pending' ? `${canApprove() ? `<button class="btn primary small" data-approve-customer="${esc(c.id)}">Duyệt</button>` : ''}
        ${canApprove() || c.createdBy === state.user?.id ? `<button class="btn ghost small danger-text" data-reject-customer="${esc(c.id)}">${canApprove() ? 'Từ chối' : 'Xoá'}</button>` : '<span class="pill warn">Chờ duyệt</span>'}` : `<button class="btn ghost small" data-quote-for="${esc(c.id)}" title="Tạo báo giá cho khách này">＋ Báo giá</button>`}
        <button class="btn ghost small" data-accounts-for="${esc(c.id)}" title="Tài khoản đăng nhập trang khách hàng">Tài khoản</button>
        <button class="icon-btn" data-edit-customer="${esc(c.id)}" ${isManager() || c.owner?.id === state.user?.id ? '' : 'hidden '}title="Sửa" aria-label="Sửa ${esc(c.name)}"><svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16z M14 6l4 4"/></svg></button>
      </div></td>
    </tr>`).join('');
  const none = !state.customerQuery && list.length === 0;
  $('#customer-empty').hidden = list.length > 0;
  $('#customer-empty-title').textContent = none ? 'Chưa có khách hàng' : 'Không tìm thấy khách hàng';
  $('#customer-empty-text').textContent = none ? 'Thêm khách hàng để chọn nhanh khi lập báo giá.' : 'Thử từ khoá khác.';
  $('#customer-table').hidden = list.length === 0;
}
let customerTimer;
const reloadCustomers = () => { customerPager?.reset(); loadCustomers(); };
$('#customer-search').addEventListener('input', e => { state.customerQuery = e.target.value; clearTimeout(customerTimer); customerTimer = setTimeout(reloadCustomers, 250); });
/** Tạo báo giá mới điền sẵn thông tin khách. */
function quoteForCustomer(c) {
  editor.pending = newQuoteData({ customerId: c.id, customer: c.name, contact: c.contact || '', phone: c.phone || '', email: c.email || '', customerTaxCode: c.taxCode || '', customerAddress: c.address || '', customerCode: c.customerCode || '' });
  go('#/quotes/new');
}
$('#customer-list').addEventListener('click', e => {
  const edit = e.target.closest('[data-edit-customer]'); if (edit) return openCustomer(edit.dataset.editCustomer);
  const accBtn = e.target.closest('[data-accounts-for]'); if (accBtn) return openAccounts(state.customers.find(x => x.id === accBtn.dataset.accountsFor));
  const qb = e.target.closest('[data-quote-for]');
  if (qb) return quoteForCustomer(state.customers.find(x => x.id === qb.dataset.quoteFor));
  const ap = e.target.closest('[data-approve-customer]'), rj = e.target.closest('[data-reject-customer]');
  if (ap || rj) return reviewCustomer(ap ? ap.dataset.approveCustomer : rj.dataset.rejectCustomer, !!ap);
  // Bấm vào dòng: mở trang chi tiết khách hàng.
  const row = e.target.closest('tr[data-href]'); if (row && !e.target.closest('a, button')) go(row.dataset.href);
});
$('#customer-retail').addEventListener('change', reloadCustomers);
$('#customer-mine').addEventListener('change', reloadCustomers);
$('#customer-pending').addEventListener('change', reloadCustomers);
/** Manager duyệt khách mới; từ chối (hoặc người tạo xoá) khách đang chờ duyệt. */
async function reviewCustomer(id, approve) {
  const c = state.customers?.find(x => x.id === id);
  try {
    if (approve) { await api(`/customers/${encodeURIComponent(id)}/approve`, 'POST', {}); toast('Đã duyệt khách hàng.'); }
    else {
      if (!await confirmBox(`Xoá khách hàng chờ duyệt "${c?.name || ''}"?`, { ok: 'Xoá', danger: true })) return;
      await api(`/customers/${encodeURIComponent(id)}`, 'DELETE'); toast('Đã xoá khách hàng chờ duyệt.');
      if (location.hash.startsWith('#/customers/')) go('#/customers');
    }
    await loadCustomers();
    if (approve && location.hash.startsWith('#/customers/')) customerDetail().reload();
  } catch (ex) { toast(ex.message, 'err'); }
}
/** Bảng lương công ty (trial-ui/payroll.js) – Manager. */
var payrollUi = null; // eslint-disable-line no-var
const payrollBoard = () => payrollUi ||= initPayroll({ api, toast, esc, money, pill, confirmBox });
/** Trang chi tiết nhân viên (trial-ui/member-detail.js): KPI, khách, báo giá, đơn, HĐKT, giao dịch, công nợ, ngày công, lương. */
var memberUi = null; // eslint-disable-line no-var
function memberDetail() {
  return memberUi ||= initMemberDetail({ api, toast, esc, money, fmtDate, pill, payCell, confirmBox, initials, ORDER_STATUS, CONTRACT_STATUS, moneyWords,
    onEdit: async m => { if (!state.members?.some(x => x.id === m.id)) await loadMembers(); openMember(m.id); },
    onPhoto: async m => {
      const key = await uploadAvatar(m.id === state.user.id ? '/avatar' : `/admin/members/${encodeURIComponent(m.id)}/avatar`); if (!key) return false;
      if (m.id === state.user.id) { state.user.avatar = key; showOwnAvatar(key); }
      const row = state.members?.find(x => x.id === m.id); if (row) { row.avatar = key; renderMembers(); }
      toast('Đã cập nhật ảnh đại diện.'); return true;
    } });
}
/** Trang chi tiết khách hàng (trial-ui/customer-detail.js). */
var customerUi = null; // eslint-disable-line no-var
function customerDetail() {
  return customerUi ||= initCustomerDetail({ api, toast, esc, money, fmtDate, pill, payCell, confirmBox, canApprove, ORDER_STATUS, CONTRACT_STATUS, DELIVERY_STATUS,
    onEdit: c => openCustomer(c.id, c), onQuote: quoteForCustomer, onAccounts: openAccounts, onDiscount: openDiscount, onCare: (c, a, after) => careView().openForm(a ? { activity: a } : { customer: { id: c.id, name: c.name, contact: c.contact } }, after), isManager, onReview: reviewCustomer });
}
function openCustomer(id, known) {
  customerId = id || null;
  customerDuplicateCheck.reset();
  const form = $('#customer-form'); form.reset(); $('#customer-error').textContent = '';
  const c = id ? known || state.customers?.find(x => x.id === id) : null;
  if (c) for (const k of ['name', 'contact', 'phone', 'email', 'taxCode', 'customerCode', 'address', 'depositRate', 'paymentTerm', 'creditLimit']) form.elements.namedItem(k).value = c[k] ?? '';
  $('#customer-dialog-title').textContent = c ? 'Sửa khách hàng' : 'Thêm khách hàng';
  $('#customer-dialog').showModal();
  customerDuplicateCheck.refresh();
}
$('#customer-fields').append(customerFormFields().root);
const customerDuplicateCheck = bindCustomerDuplicateCheck({
  api, root: $('#customer-fields'), exceptId: () => customerId,
  active: () => $('#customer-dialog').open,
  read: () => Object.fromEntries(['name', 'phone', 'taxCode'].map(k => [k, $('#customer-form').elements.namedItem(k).value])),
  onChoose: c => { $('#customer-dialog').close(); go('#/customers/' + encodeURIComponent(c.id)); },
});
$('#new-customer').addEventListener('click', () => openCustomer());
$('#customer-form').addEventListener('submit', async e => {
  e.preventDefault();
  const data = Object.fromEntries([...new FormData(e.target)].map(([k, v]) => [k, String(v).trim()]));
  const err = $('#customer-error'); err.textContent = '';
  if (!data.name) { err.textContent = 'Vui lòng nhập tên khách hàng.'; e.target.elements.name.focus(); return; }
  if (data.email && !/^\S+@\S+\.\S+$/.test(data.email)) { err.textContent = 'Email chưa đúng định dạng.'; return; }
  const btn = $('#save-customer'); btn.disabled = true;
  try {
    const saved = await api(customerId ? '/customers/' + encodeURIComponent(customerId) : '/customers', customerId ? 'PUT' : 'POST', data);
    $('#customer-dialog').close(); toast(customerId ? 'Đã cập nhật khách hàng.' : saved.approvalStatus === 'pending' ? `Đã thêm ${data.name} – chờ Manager duyệt.` : 'Đã thêm ' + data.name + '.');
    // Khách mới: mở luôn trang chi tiết để thêm người liên hệ / phân công; đang ở trang chi tiết thì tải lại.
    if (!customerId) go('#/customers/' + encodeURIComponent(saved.id));
    else if (location.hash.startsWith('#/customers/')) customerDetail().reload();
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
      <td class="first"><span class="row-gap"><span class="avatar"${avAttr(m.avatar)}>${esc(initials(m.name))}</span><span><a class="name-btn strong" href="#/members/${esc(encodeURIComponent(m.id))}">${esc(m.name)}</a>${self ? ' <span class="pill blue">Bạn</span>' : ''}<small>${esc(m.email)}</small></span></span></td>
      <td data-label="ĐT">${esc(m.phone) || '—'}</td>
      <td data-label="Chức vụ">${esc(pos.get(m.positionId) || m.positionId)}${m.role === 'manager' ? ' <span class="pill">Manager</span>' : ''}
        ${m.role === 'employee' ? `<label class="approver-toggle" title="Cho phép duyệt báo giá, khách mới, sản phẩm mới, đơn / HĐKT, đơn mua NCC (chỉ Manager bật / tắt)"><input type="checkbox" data-approver="${esc(m.id)}" ${m.approver ? 'checked' : ''}> Được duyệt</label>` : ''}</td>
      <td>${STATUS_PILL[st]}</td>
      <td class="actions-cell"><div class="row-actions">${self ? '' : `
        ${st !== 'locked' ? `<button class="btn ghost small" data-reset="${esc(m.id)}" title="Cấp liên kết đặt lại mật khẩu">${st === 'pending' ? 'Gửi lại liên kết' : 'Đặt lại mật khẩu'}</button>` : ''}
        <button class="icon-btn" data-edit-member="${esc(m.id)}" title="Sửa" aria-label="Sửa ${esc(m.name)}"><svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16z M14 6l4 4"/></svg></button>
        ${st === 'locked'
          ? `<button class="btn ghost small" data-unlock="${esc(m.id)}">Mở khoá</button>`
          : `<button class="icon-btn danger" data-lock="${esc(m.id)}" title="Khoá tài khoản" aria-label="Khoá ${esc(m.name)}"><svg viewBox="0 0 24 24"><path d="M6 11h12v9H6z M8 11V8a4 4 0 0 1 8 0v3"/></svg></button>`}
        <button class="icon-btn danger" data-delete-member="${esc(m.id)}" title="Xoá nhân viên" aria-label="Xoá ${esc(m.name)}"><svg viewBox="0 0 24 24"><path d="M5 7h14 M10 11v6 M14 11v6 M6 7l1 13h10l1-13 M9 7V4h6v3"/></svg></button>`}
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
  $('#member-photo-row').hidden = !m;
  $('#save-member').hidden = m?.id === state.user.id; // tài khoản của mình: chỉ đổi ảnh (thông tin do Manager khác sửa)
  if (m) showMemberPhoto(m);
  $('#member-dialog-title').textContent = m ? 'Chi tiết nhân viên' : 'Thêm nhân viên';
  $('#save-member').textContent = m ? 'Lưu thay đổi' : 'Tạo tài khoản';
  $('#member-dialog').showModal();
}
function showMemberPhoto(m) {
  const el = $('#member-photo'); el.textContent = initials(m.name);
  if (m.avatar) el.dataset.av = m.avatar; else delete el.dataset.av;
  $('#member-photo-remove').hidden = !m.avatar;
}
/** Ảnh đại diện nhân viên đang mở: Manager tải lên / xoá (chính mình thì dùng đường /avatar). */
async function changeMemberPhoto(remove) {
  const m = state.members.find(x => x.id === memberId); if (!m) return;
  const path = m.id === state.user.id ? '/avatar' : `/admin/members/${encodeURIComponent(m.id)}/avatar`;
  try {
    if (remove) { if (!await confirmBox(`Xoá ảnh đại diện của ${m.name}?`, { ok: 'Xoá ảnh', danger: true })) return; await api(path, 'DELETE'); m.avatar = null; }
    else { const key = await uploadAvatar(path); if (!key) return; m.avatar = key; }
    if (m.id === state.user.id) { state.user.avatar = m.avatar; showOwnAvatar(m.avatar); }
    showMemberPhoto(m); renderMembers(); toast(remove ? 'Đã xoá ảnh đại diện.' : 'Đã cập nhật ảnh đại diện.');
  } catch (ex) { toast(ex.message, 'err'); }
}
$('#member-photo-upload').addEventListener('click', () => changeMemberPhoto(false));
$('#member-photo-remove').addEventListener('click', () => changeMemberPhoto(true));
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
      if (location.hash.startsWith('#/members/')) memberDetail().reload();
    } else {
      const res = await api('/admin/members', 'POST', body);
      $('#member-dialog').close();
      showLink(res.url, 'Đã tạo tài khoản', `Gửi liên kết này cho ${body.name} để đặt mật khẩu. Liên kết chỉ dùng một lần và hết hạn sau 15 phút.`);
    }
    loadMembers();
  } catch (ex) { err.textContent = ex.message; }
  finally { btn.disabled = false; }
});
// Cờ "Được duyệt" (chỉ Manager – máy chủ kiểm lại ở PUT /admin/members/:id/approver).
$('#member-list').addEventListener('change', async e => {
  const box = e.target.closest('[data-approver]'); if (!box) return;
  const m = state.members.find(x => x.id === box.dataset.approver), on = box.checked;
  if (!await confirmBox(on ? `Cho ${m.name} quyền phê duyệt (báo giá, khách hàng mới, sản phẩm mới, đơn hàng / HĐKT, đơn mua NCC)?` : `Thu quyền phê duyệt của ${m.name}?`, { title: on ? 'Cấp quyền duyệt' : 'Thu quyền duyệt', ok: on ? 'Cấp quyền' : 'Thu quyền', danger: !on })) { box.checked = !on; return; }
  box.disabled = true;
  try { await api(`/admin/members/${encodeURIComponent(m.id)}/approver`, 'PUT', { approver: on }); m.approver = on; toast(on ? `Đã cho ${m.name} quyền duyệt.` : `Đã thu quyền duyệt của ${m.name}.`); }
  catch (ex) { box.checked = !on; toast(ex.message, 'err'); } finally { box.disabled = false; }
});
$('#member-list').addEventListener('click', async e => {
  const t = e.target.closest('[data-edit-member],[data-reset],[data-lock],[data-unlock],[data-delete-member]'); if (!t) return;
  const id = t.dataset.editMember || t.dataset.reset || t.dataset.lock || t.dataset.unlock || t.dataset.deleteMember, m = state.members.find(x => x.id === id);
  if (t.dataset.editMember) return openMember(id);
  try {
    if (t.dataset.reset) {
      if (!await confirmBox(`Cấp liên kết đặt mật khẩu mới cho ${m.name}? Mật khẩu cũ sẽ hết hiệu lực và ${m.name} bị đăng xuất khỏi mọi thiết bị.`, { ok: 'Cấp liên kết' })) return;
      const res = await api('/admin/reset', 'POST', { id });
      showLink(res.url, 'Liên kết đặt mật khẩu', `Gửi liên kết này cho ${m.name}. Liên kết chỉ dùng một lần và hết hạn sau 15 phút.`);
    } else if (t.dataset.lock) {
      if (!await confirmBox(`Khoá tài khoản ${m.name}? Người này sẽ bị đăng xuất và không đăng nhập được nữa.`, { title: 'Khoá tài khoản', ok: 'Khoá', danger: true })) return;
      await api('/admin/member', 'DELETE', { id }); toast('Đã khoá ' + m.name + '.');
    } else if (t.dataset.deleteMember) {
      if (!await confirmBox(`Xoá ${m.name} khỏi danh sách nhân viên? Tài khoản bị đăng xuất, không đăng nhập được nữa và email được giải phóng (tạo lại được). Báo giá, đơn… cũ vẫn giữ tên ${m.name}. Không hoàn tác được.`, { title: 'Xoá nhân viên', ok: 'Xoá nhân viên', danger: true, typeToConfirm: 'XOA' })) return;
      await api(`/admin/members/${encodeURIComponent(id)}`, 'DELETE'); toast('Đã xoá ' + m.name + '.');
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
else if (token) resume();
else showAuth();
/**
 * Mở lại app khi đã có phiên: chỉ đăng xuất khi máy chủ báo phiên hết hạn (401). Mất mạng / máy chủ chưa sẵn sàng thì
 * GIỮ phiên, hiện nút "Thử lại" (tự thử lại khi có mạng) thay vì bắt đăng nhập lại.
 */
function resume() {
  enter().catch(e => {
    if (e.status === 401) return showAuth('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.');
    showAuth(e.message, { keepToken: true });
    const retry = document.createElement('button'); retry.type = 'button'; retry.className = 'btn secondary small'; retry.textContent = 'Thử lại';
    retry.style.marginLeft = '8px'; retry.addEventListener('click', () => { $('#auth-error').textContent = 'Đang kết nối lại…'; resume(); });
    $('#auth-error').append(retry);
    window.addEventListener('online', () => { if (!state.user && token) resume(); }, { once: true });
  });
}


// ================================================================ BÁN HÀNG: đơn đặt hàng · HĐKT · lịch giao · công nợ
// Luồng: Báo giá → Đơn đặt hàng → HĐKT → Lịch giao → Công nợ. Mọi trang đều dẫn về trang chi tiết đơn (#/orders/<id>).
/** `unsubmitted` = đơn / HĐKT nháp nhân viên chưa bấm "Gửi duyệt" (submittedAt = null). */
const ORDER_STATUS = { unsubmitted: ['Nháp – chưa gửi duyệt', 'muted'], draft: ['Chờ Manager duyệt', 'warn'], confirmed: ['Đã duyệt', 'info'], delivering: ['Đang giao', 'warn'], delivered: ['Đã giao xong', 'ok'], cancelled: ['Đã huỷ', 'muted'] };
const CONTRACT_STATUS = { draft: ['Chưa ký', 'warn'], signed: ['Đã ký', 'info'], completed: ['Hoàn tất', 'ok'], cancelled: ['Đã huỷ', 'muted'] };
const DELIVERY_STATUS = { planned: ['Chờ giao', 'warn'], in_transit: ['Đang giao', 'info'], delivered: ['Đã giao', 'ok'], failed: ['Giao lỗi', 'danger'], cancelled: ['Đã huỷ', 'muted'] };
const ghnTrackingText = x => x.trackingCode ? `GHN ${x.trackingCode}${x.trackingStatus ? ' · ' + x.trackingStatus : ''}` : '';
const DEBT_STATUS = { open: ['Còn nợ', 'warn'], overdue: ['Quá hạn', 'danger'], paid: ['Đã thu đủ', 'ok'], none: ['—', 'muted'] };
/** Trạng thái thanh toán / đặt cọc của đơn (danh sách đơn và HĐKT). */
const PAY_STATE = { unpaid: ['Chưa thanh toán', 'warn'], deposit_due: ['Chờ đặt cọc', 'warn'], deposit_paid: ['Đã cọc', 'info'], partial: ['Đã thu một phần', 'info'],
  overdue: ['Quá hạn', 'danger'], paid: ['Đã thanh toán đủ', 'ok'], none: ['Chưa có kỳ thu', 'muted'] };
function payCell(r, counts, orderStatus, what = 'Đơn') {
  if (orderStatus === 'cancelled') return `<span class="muted">${what} đã huỷ</span>`;
  if (!counts) return `<span class="pill muted">Chưa phát sinh</span><small>${what} chờ ${what === 'HĐKT' ? 'duyệt / ký' : 'xác nhận'}</small>`;
  if (!r) return '—';
  const sub = r.payState === 'paid' ? `Đã thu ${money(r.paid)}`
    : [r.deposit > 0 ? `Cọc ${money(r.depositPaid)}/${money(r.deposit)}` : r.paid > 0 ? `Đã thu ${money(r.paid)}` : '', `Còn ${money(r.balance)}`].filter(Boolean).join(' · ');
  return `${pill(PAY_STATE, r.payState)}<small>${sub}</small>${r.overdue ? `<small class="danger-text">Quá hạn ${money(r.overdue)}</small>` : ''}`;
}
/** Xuất hoá đơn của đơn / HĐKT. */
const INVOICE_STATUS = { none: ['Chưa yêu cầu', 'muted'], requested: ['Chờ xuất HĐ', 'warn'], issued: ['Đã xuất HĐ', 'ok'] };
const invoiceCell = (status, no, orderStatus) => orderStatus === 'cancelled' ? '<span class="muted">—</span>'
  : status === 'issued' ? `${pill(INVOICE_STATUS, 'issued')}<small>Số ${esc(no)}</small>` : pill(INVOICE_STATUS, status || 'none');
const pill = (map, k) => { const [t, c] = map[k] || [k, '']; return `<span class="pill ${c}">${esc(t)}</span>`; };
const orderLink = (id, text) => `<a href="#/orders/${encodeURIComponent(id)}">${esc(text)}</a>`;
/** Đơn hàng và HĐKT là 2 luồng độc lập: bản ghi có HĐKT hiện "HĐKT <số>" và mở #/contracts/<id>, không bao giờ hiện số đơn. */
const docHref = (id, contractNo) => `#/${contractNo ? 'contracts' : 'orders'}/${encodeURIComponent(id)}`;
const docLink = (id, orderNo, contractNo) => `<a href="${docHref(id, contractNo)}">${esc(contractNo ? 'HĐKT ' + contractNo : orderNo)}</a>`;
/** Số chứng từ đang mở ở trang chi tiết: số HĐKT nếu là HĐKT, không thì số đơn. */
const docNo = (d = sales.detail) => d?.contract?.contractNo || d?.order?.orderNo || '';
const isContractDoc = (d = sales.detail) => !!d?.contract;
const debounce = (fn, ms = 250) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
function fillList(key, rows, emptyText) {
  $(`#${key}-list`).innerHTML = rows.join('');
  $(`#${key}-empty`).hidden = rows.length > 0; $(`#${key}-empty-text`).textContent = emptyText;
}
const listError = (key, e) => { $(`#${key}-list`).innerHTML = ''; $(`#${key}-empty`).hidden = false; $(`#${key}-empty-text`).textContent = e.message; };

const NO_SCHEDULE = 'Lên lịch giao trước rồi mới yêu cầu đóng gói / in phiếu đóng gói, phiếu giao hàng.';
/** Nút in nhanh phiếu đóng gói / phiếu giao hàng trên dòng đơn / HĐKT (đơn đã xác nhận, chưa huỷ). */
const slipButtons = (orderId, status) => status === 'draft' || status === 'cancelled' ? ''
  : `<button type="button" class="btn ghost small" data-pack-print-for="${esc(orderId)}" title="In phiếu đóng gói">Phiếu ĐG</button><button type="button" class="btn ghost small" data-ship-print-for="${esc(orderId)}" title="In phiếu giao hàng">Phiếu GH</button>`;
// ----- danh sách đơn
let ordersPager, ordersReq = 0, ordersData = null;
const ORDER_SOURCE = { crm: 'CRM', pos: 'POS tại quầy', ghn: 'COD / GHN' };
function ordersQuery(exportMode = false) {
  const status = $('#orders-status-tabs .chip.active')?.dataset.status || '', inv = $('#orders-filters .chip.active')?.dataset.invoice || '';
  const p = new URLSearchParams({ flow: 'order', q: $('#orders-search').value, limit: String(exportMode ? 5000 : ordersPager.limit), offset: String(exportMode ? 0 : ordersPager.offset) });
  for (const [key, value] of [['status', status], ['invoice', inv], ['source', $('#orders-source').value], ['owner', $('#orders-owner').value], ['branch', $('#orders-branch').value], ['from', $('#orders-from').value], ['to', $('#orders-to').value]]) if (value) p.set(key, value);
  if (exportMode) p.set('export', '1');
  return p.toString();
}
function fillOrderFilter(id, first, rows) {
  const select = $(id), value = select.value;
  select.replaceChildren(Object.assign(document.createElement('option'), { value: '', textContent: first }));
  for (const row of rows || []) select.append(Object.assign(document.createElement('option'), { value: row.id, textContent: row.name }));
  if ([...select.options].some(x => x.value === value)) select.value = value;
}
async function loadOrders() {
  const req = ++ordersReq;
  ordersPager ||= createPager($('#orders-pager'), 'orders', () => loadOrders(), 50);
  $('#orders-list').innerHTML = skeleton(7);
  try {
    // Đơn hàng và HĐKT là 2 luồng song song: trang này chỉ hiện đơn không có HĐKT.
    const d = await api('/orders?' + ordersQuery());
    ordersData = d;
    fillOrderFilter('#orders-owner', 'Tất cả nhân viên', d.filterOptions?.owners);
    fillOrderFilter('#orders-branch', 'Tất cả chi nhánh', d.filterOptions?.branches);
    invoiceCount('orders', d.invoicePending);
    if (req !== ordersReq) return;
    ordersPager.render(d.total ?? d.orders.length);
    fillList('orders', d.orders.map(o => `<tr class="clickable" data-href="#/orders/${esc(o.id)}">
      <td>${orderLink(o.id, o.orderNo)}<small>${esc(o.quoteNo || 'Không từ báo giá')} · ${fmtDate(String(o.createdAt || o.orderDate).slice(0, 10))}</small></td>
      <td>${esc(o.customerName)}<small>${esc([o.contact, o.phone].filter(Boolean).join(' · '))}</small></td>
      <td><span class="pill ${o.orderSource === 'ghn' ? 'warn' : o.orderSource === 'pos' ? 'ok' : 'blue'}">${esc(ORDER_SOURCE[o.orderSource] || o.orderSource)}</span><small>${esc(o.branchName || '—')}</small></td>
      <td>${esc(o.ownerName || '—')}</td>
      <td>${pill(ORDER_STATUS, (o.status === 'draft' && o.submittedAt === null ? 'unsubmitted' : o.status))}</td>
      <td>${o.deliveryStatus ? pill(DELIVERY_STATUS, o.deliveryStatus) : o.orderSource === 'ghn' ? '<span class="pill warn">Chờ tạo vận đơn</span>' : '<span class="muted">—</span>'}<small>${esc(o.deliveryCarrier || '')}</small></td>
      <td>${payCell(o.receivable, o.debtCounts, o.status)}</td>
      <td class="right num"><b>${money(o.total)}</b><small>${invoiceCell(o.invoiceStatus, o.invoiceNo, o.status)}</small></td>
      <td class="row-actions"><button type="button" class="btn secondary small" data-order-print-for="${esc(o.id)}" title="Xem, sửa rồi in / lưu PDF / tải Excel đơn đặt hàng">In / Tải</button>${slipButtons(o.id, o.status)}</td></tr>`),
      'Chưa có đơn đặt hàng. Bấm ＋ để tạo đơn từ báo giá đã duyệt.');
  } catch (e) { if (req === ordersReq) { listError('orders', e); ordersPager.render(0); } }
}
// ----- danh sách HĐKT
let contractsPager, contractsReq = 0;
async function loadContracts() {
  const req = ++contractsReq;
  contractsPager ||= createPager($('#contracts-pager'), 'contracts', () => loadContracts(), 50);
  $('#contracts-list').innerHTML = skeleton(9);
  try {
    const inv = $('#contracts-filters .chip.active')?.dataset.invoice || '';
    const d = await api(`/contracts?limit=${contractsPager.limit}&offset=${contractsPager.offset}${inv ? '&invoice=' + inv : ''}&q=` + encodeURIComponent($('#contracts-search').value));
    invoiceCount('contracts', d.invoicePending);
    if (req !== contractsReq) return;
    contractsPager.render(d.total ?? d.contracts.length);
    // HĐKT là luồng riêng: mở #/contracts/<id>, dòng phụ là số báo giá (không hiện số đơn).
    fillList('contracts', d.contracts.map(k => `<tr class="clickable" data-href="#/contracts/${esc(k.orderId)}">
      <td><a href="#/contracts/${esc(encodeURIComponent(k.orderId))}"><b>${esc(k.contractNo)}</b></a></td><td>${esc(k.customerName)}<small>${k.quoteNo ? 'Báo giá ' + esc(k.quoteNo) : ''}</small></td>
      <td>${esc(k.legalEntity)}</td><td>${pill(CONTRACT_STATUS, k.status)}</td><td>${fmtDate(k.signedDate) || '—'}</td>
      <td class="right num">${money(k.value)}</td><td class="right num">${money(k.depositAmount)}<small>${fmtNum(k.depositRate)}%</small></td><td>${payCell(k.receivable, k.debtCounts, k.orderStatus, 'HĐKT')}</td><td>${invoiceCell(k.invoiceStatus, k.invoiceNo, k.orderStatus)}</td><td class="row-actions"><button type="button" class="btn secondary small" data-contract-docs-for="${esc(k.orderId)}" title="Xem, sửa, tải bộ 3 file Word">Xem / Tải hồ sơ</button>${slipButtons(k.orderId, k.orderStatus)}</td></tr>`),
      'Chưa có HĐKT. Bấm ＋ để lập HĐKT từ báo giá đã duyệt.');
  } catch (e) { if (req === contractsReq) { listError('contracts', e); contractsPager.render(0); } }
}
// ----- lịch giao hàng (mặc định 7 ngày trước → 30 ngày tới)
async function loadDeliveries() {
  // Kho: 7 ngày trước (chuyến trễ chưa giao) → ngày mai; người khác 7 ngày trước → 30 ngày tới.
  if (!$('#deliveries-from').value) { const t = new Date(todayIso()); $('#deliveries-from').value = new Date(t - 7 * 864e5).toISOString().slice(0, 10); $('#deliveries-to').value = new Date(+t + (isWarehouse() ? 1 : 30) * 864e5).toISOString().slice(0, 10); }
  $('#deliveries-list').innerHTML = skeleton(6);
  try {
    const focusId = new URLSearchParams(location.hash.split('?')[1] || '').get('deliveryId');
    const d = await api(`/deliveries?id=${encodeURIComponent(focusId || '')}&from=${$('#deliveries-from').value}&to=${$('#deliveries-to').value}&status=${encodeURIComponent($('#deliveries-status .chip.active')?.dataset.status ?? '')}`);
    const q = focusId ? '' : normalize($('#deliveries-search').value);
    const rows = d.deliveries.filter(x => !q || normalize(`${x.customerName} ${x.contractNo || x.orderNo} ${x.deliveryNo} ${x.address}`).includes(q));
    fillList('deliveries', rows.map(x => `<tr>
      <td><b>${fmtDate(x.plannedDate)}</b><small>${esc(x.timeSlot)}</small></td><td>${esc(x.deliveryNo)}<small>${esc(ghnTrackingText(x) || x.carrier)}</small></td>
      <td>${esc(x.customerName)}<small>${isWarehouse() ? esc(x.contractNo ? 'HĐKT ' + x.contractNo : x.orderNo) : docLink(x.orderId, x.orderNo, x.contractNo)}</small></td>
      <td>${deliveryReceiver(x)}<small>${esc(x.address || x.customerAddress || '')}</small></td>
      <td>${pill(DELIVERY_STATUS, x.status)}${deliveryPhotos(x)}</td><td class="actions-col">${deliveryButtons(x)}</td></tr>`),
      'Không có chuyến giao nào trong khoảng ngày này.');
  } catch (e) { listError('deliveries', e); }
}
/** Người nhận của chuyến giao: người nhận ghi trên chuyến, không có thì người liên hệ / SĐT của khách trên đơn (bấm để gọi). */
function deliveryReceiver(x) {
  const name = x.receiverName || x.customerContact || '', phone = x.receiverPhone || x.customerPhone || '';
  const tel = phone ? `<a href="tel:${esc(phone.replace(/[^\d+]/g, ''))}">${esc(phone)}</a>` : '';
  return [esc(name), tel].filter(Boolean).join(' · ') || '<span class="muted">—</span>';
}
// Kho: nút "Đã giao" to, không có "Huỷ" (chỉ nhân viên phụ trách / Manager huỷ chuyến – máy chủ cũng chặn).
const deliveryButtons = x => ['planned', 'in_transit'].includes(x.status)
  ? `${x.status === 'planned' ? `<button class="btn ghost small" data-ship="${esc(x.id)}" data-to="in_transit">Đang giao</button>` : ''}<button class="btn ${isWarehouse() ? 'primary ship-done' : 'secondary small'}" data-ship="${esc(x.id)}" data-to="delivered">${isWarehouse() ? '✅ Đã giao' : 'Đã giao'}</button>${isWarehouse() ? '' : `<button class="btn ghost small" data-ship="${esc(x.id)}" data-to="cancelled">Huỷ</button>`}` : '';
/** Ảnh xác nhận đã giao (hàng đã giao / biên bản ký nhận) – bấm để xem lớn. */
const deliveryPhotos = x => x.photos?.length ? `<span class="ship-photos">${x.photos.map((u, i) => `<a href="${esc(u)}" target="_blank" rel="noopener"><img src="${esc(u)}" alt="Ảnh giao hàng ${i + 1}" loading="lazy"></a>`).join('')}</span>` : '';
// ----- công nợ
async function loadReceivables() {
  $('#receivables-list').innerHTML = skeleton(7);
  try {
    const status = $('#receivables-filters .chip.active')?.dataset.status ?? '';
    const d = await api('/receivables?q=' + encodeURIComponent($('#receivables-search').value) + (status ? '&status=' + status : ''));
    const a = d.totals.aging || { d30: 0, d60: 0, over60: 0 };
    $('#receivable-stats').innerHTML = [['Phải thu', d.totals.due, ''], ['Đã thu', d.totals.paid, ''], ['Còn lại', d.totals.balance, ''], ['Quá hạn', d.totals.overdue, d.totals.overdue > 0 ? 'danger-text' : '']]
      .map(([t, v, c]) => `<article class="stat"><small>${t}</small><strong class="${c}">${money(v)}</strong></article>`).join('')
      // Tuổi nợ quá hạn: 1–30 / 31–60 / trên 60 ngày.
      + (d.totals.overdue > 0 ? `<article class="stat aging-stat"><small>Tuổi nợ quá hạn</small><span><b>1–30 ngày</b> ${money(a.d30)}</span><span><b>31–60 ngày</b> ${money(a.d60)}</span><span class="${a.over60 ? 'danger-text' : ''}"><b>Trên 60 ngày</b> ${money(a.over60)}</span></article>` : '');
    state.receivables = d.receivables;
    fillList('receivables', d.receivables.map(r => `<tr class="clickable" data-href="${docHref(r.orderId, r.contractNo)}">
      <td>${esc(r.customerName)}<small>${docLink(r.orderId, r.orderNo, r.contractNo)} · ${fmtDate(r.orderDate)}${r.ownerName ? ' · ' + esc(r.ownerName) : ''}</small></td><td>${pill(DEBT_STATUS, r.status)}</td>
      <td>${r.aging?.oldestDue ? `<span class="danger-text">Quá ${r.aging.overdueDays} ngày</span><small>hạn ${fmtDate(r.aging.oldestDue)}</small>` : r.nextDueDate ? fmtDate(r.nextDueDate) : r.status === 'paid' ? '—' : '<span class="muted">Chưa có hạn</span>'}</td>
      <td>${r.invoiceNo?.trim() ? esc(r.invoiceNo) : '<span class="muted">Chưa xuất</span>'}</td>
      <td class="right num">${money(r.due)}</td><td class="right num">${money(r.paid)}</td><td class="right num">${money(r.balance)}</td>
      <td class="right num ${r.overdue ? 'danger-text' : ''}">${r.overdue ? money(r.overdue) : '—'}</td></tr>`),
      status === 'paid' ? 'Chưa có đơn nào đã thu đủ.' : status === 'overdue' ? 'Không có công nợ quá hạn.' : 'Không còn công nợ phải thu. Công nợ xuất hiện khi có đơn hàng / HĐKT đã duyệt.');
  } catch (e) { listError('receivables', e); }
}
/** Số trên nút "Chờ xuất hoá đơn" (ẩn khi 0). */
function invoiceCount(key, n) { const c = $(`#${key}-filters [data-invoice-count]`); if (c) c.textContent = n ? String(n) : ''; }
for (const [key, reload] of [['orders', () => { ordersPager?.reset(); loadOrders(); }], ['contracts', () => { contractsPager?.reset(); loadContracts(); }]])
  $(`#${key}-filters`).addEventListener('click', e => {
    const chip = e.target.closest('.chip'); if (!chip) return;
    $$(`#${key}-filters .chip`).forEach(c => { c.classList.toggle('active', c === chip); c.setAttribute('aria-pressed', String(c === chip)); });
    reload();
  });
$('#orders-search').addEventListener('input', debounce(() => { ordersPager?.reset(); loadOrders(); }));
$('#orders-status-tabs').addEventListener('click', e => {
  const chip = e.target.closest('.chip'); if (!chip) return;
  $$('#orders-status-tabs .chip').forEach(c => { c.classList.toggle('active', c === chip); c.setAttribute('aria-pressed', String(c === chip)); });
  ordersPager?.reset(); loadOrders();
});
for (const id of ['#orders-source', '#orders-owner', '#orders-branch', '#orders-from', '#orders-to']) $(id).addEventListener('change', () => { ordersPager?.reset(); loadOrders(); });
$('#orders-clear').addEventListener('click', () => {
  for (const id of ['#orders-source', '#orders-owner', '#orders-branch', '#orders-from', '#orders-to']) $(id).value = '';
  $('#orders-search').value = '';
  $$('#orders-status-tabs .chip').forEach((c, i) => { c.classList.toggle('active', i === 0); c.setAttribute('aria-pressed', String(i === 0)); });
  $$('#orders-filters .chip').forEach((c, i) => { c.classList.toggle('active', i === 0); c.setAttribute('aria-pressed', String(i === 0)); });
  ordersPager?.reset(); loadOrders();
});
$('#orders-export').addEventListener('click', async e => {
  const b = e.currentTarget; b.disabled = true;
  try {
    const d = await api('/orders?' + ordersQuery(true));
    if (!d.orders.length) return toast('Không có đơn hàng để xuất.', 'err');
    await downloadExcel('danh-sach-don-hang', [{ name: 'Đơn hàng', widths: [20, 14, 28, 18, 22, 22, 16, 16, 18, 18],
      header: ['Số đơn', 'Ngày tạo', 'Khách hàng', 'Điện thoại', 'Nguồn', 'Chi nhánh', 'Nhân viên', 'Trạng thái', 'Giao hàng', 'Giá trị'],
      rows: d.orders.map(o => [o.orderNo, String(o.createdAt || o.orderDate).slice(0, 10), o.customerName, o.phone, ORDER_SOURCE[o.orderSource] || o.orderSource,
        o.branchName, o.ownerName, ORDER_STATUS[o.status === 'draft' && o.submittedAt === null ? 'unsubmitted' : o.status]?.[0] || o.status,
        DELIVERY_STATUS[o.deliveryStatus]?.[0] || (o.orderSource === 'ghn' ? 'Chờ tạo vận đơn' : ''), o.total]) }]);
  } catch (ex) { toast(ex.message, 'err'); } finally { b.disabled = false; }
});
$('#contracts-search').addEventListener('input', debounce(() => { contractsPager?.reset(); loadContracts(); }));
$('#deliveries-search').addEventListener('input', debounce(loadDeliveries, 150));
$('#receivables-search').addEventListener('input', debounce(loadReceivables));
// ---------------------------------------------------------------- Sổ thu / chi
const PAY_METHOD = { transfer: 'Chuyển khoản', cash: 'Tiền mặt', other: 'Khác' };
const CASHBOOK_STATUS = { posted: 'Đã ghi nhận', pending: 'Chờ duyệt', voided: 'Đã huỷ' };
const CASHBOOK_SOURCE = { other_income: 'Thu khác', cash_in: 'Rút két', petty_expense: 'Chi vặt', advance: 'Tạm ứng', cash_out: 'Nộp két' };
async function loadCashbook() {
  if (!$('#cashbook-from').value) { const t = todayIso(); $('#cashbook-from').value = t.slice(0, 8) + '01'; $('#cashbook-to').value = t; }
  $('#cashbook-list').innerHTML = skeleton(7);
  try {
    const d = await api(`/cashbook?from=${$('#cashbook-from').value}&to=${$('#cashbook-to').value}`);
    state.cashbook = d;
    const select = $('#cashbook-creator'), selected = select.value;
    const creators = new Map(d.entries.map(e => [cashbookCreator(e), e.createdByName || 'Không rõ người tạo']));
    if (selected && !creators.has(selected)) creators.set(selected, select.selectedOptions[0].textContent);
    select.innerHTML = '<option value="">Tất cả người tạo</option>' + [...creators].sort((a, b) => a[1].localeCompare(b[1], 'vi'))
      .map(([id, name]) => `<option value="${esc(id)}">${esc(name)}</option>`).join('');
    select.value = selected;
    renderCashbook();
  } catch (e) { $('#cashbook-stats').innerHTML = ''; listError('cashbook', e); }
}
function cashbookCreator(entry) { return entry.createdBy || entry.createdByName || '__unknown'; }
function cashbookRows() {
  const d = state.cashbook, kind = $('#cashbook-kind .chip.active')?.dataset.kind || '', method = $('#cashbook-method').value,
    status = $('#cashbook-status').value, creator = $('#cashbook-creator').value, q = normalize($('#cashbook-search').value);
  return (d?.entries || []).filter(e => (!kind || e.kind === kind) && (!method || e.method === method) && (!status || (e.status || (e.voided ? 'voided' : 'posted')) === status)
    && (!creator || cashbookCreator(e) === creator)
    && (!q || normalize(`${e.partner} ${e.docNo} ${e.reference} ${e.note} ${CASHBOOK_SOURCE[e.source] || ''}`).includes(q)));
}
function renderCashbook() {
  const d = state.cashbook; if (!d) return;
  const rows = cashbookRows(), posted = rows.filter(e => (e.status || (e.voided ? 'voided' : 'posted')) === 'posted');
  const sum = (kind, method) => posted.filter(e => e.kind === kind && (!method || e.method === method)).reduce((total, e) => total + e.amount, 0);
  const t = { in: sum('in'), out: sum('out'), net: sum('in') - sum('out') };
  const m = Object.fromEntries(['cash', 'transfer'].map(method => [method, { in: sum('in', method), out: sum('out', method) }]));
  $('#cashbook-stats').innerHTML = [['Tổng thu', t.in, 'paid-text', `CK ${money(m.transfer.in)} · TM ${money(m.cash.in)}`], ['Tổng chi', t.out, 'danger-text', `CK ${money(m.transfer.out)} · TM ${money(m.cash.out)}`],
    ['Chênh lệch thu − chi', t.net, t.net < 0 ? 'danger-text' : '', `${fmtDate(d.from)} – ${fmtDate(d.to)}`]]
    .map(([k, v, c, note]) => `<article class="stat"><small>${k}</small><strong class="${c}">${money(v)}</strong><span class="muted">${note}</span></article>`).join('');
  fillList('cashbook', rows.map(e => { const status = e.status || (e.voided ? 'voided' : 'posted'); return `<tr class="${status === 'voided' ? 'payment-voided' : ''}">
    <td>${fmtDate(e.date)}</td><td>${e.link && linkAllowed(e.link) ? `<a href="${esc(e.link)}"><b>${esc(e.docNo)}</b></a>` : `<b>${esc(e.docNo)}</b>`}</td>
    <td>${e.kind === 'in' ? '<span class="pill ok">Phiếu thu</span>' : '<span class="pill warn">Phiếu chi</span>'}<small>${esc(CASHBOOK_SOURCE[e.source] || '')}</small></td>
    <td>${esc(e.partner || '—')}<small>${esc(e.note || '')}</small></td>
    <td>${PAY_METHOD[e.method] || e.method || '—'}${e.reference ? `<small>${esc(e.reference)}</small>` : ''}</td>
    <td class="right num paid-text">${e.kind === 'in' ? money(e.amount) : '—'}</td><td class="right num danger-text">${e.kind === 'out' ? money(e.amount) : '—'}</td>
    <td>${status === 'posted' ? '<span class="pill ok">Đã ghi nhận</span>' : status === 'pending' ? '<span class="pill warn">Chờ duyệt</span>' : '<span class="pill danger">Đã huỷ</span>'}${e.voidReason ? `<small>${esc(e.voidReason)}</small>` : ''}</td>
    <td>${esc(e.createdByName)}</td></tr>`; }),
    'Không có phiếu thu / chi phù hợp với bộ lọc.');
}
for (const id of ['#cashbook-from', '#cashbook-to']) $(id).addEventListener('change', loadCashbook);
$('#cashbook-search').addEventListener('input', debounce(renderCashbook, 150));
for (const id of ['#cashbook-method', '#cashbook-status', '#cashbook-creator']) $(id).addEventListener('change', renderCashbook);
$('#cashbook-kind').addEventListener('click', e => {
  const chip = e.target.closest('.chip'); if (!chip) return;
  $$('#cashbook-kind .chip').forEach(c => { c.classList.toggle('active', c === chip); c.setAttribute('aria-pressed', String(c === chip)); });
  renderCashbook();
});
$('#cashbook-export').addEventListener('click', async e => {
  const rows = cashbookRows(), b = e.currentTarget; if (!rows.length) return toast('Không có dòng để xuất.', 'err');
  b.disabled = true;
  try {
    await downloadExcel('so-thu-chi', [{ name: 'Sổ thu chi', widths: [12, 8, 32, 20, 14, 18, 14, 14, 18, 26, 26],
      header: ['Ngày', 'Loại', 'Khách / NCC', 'Chứng từ', 'Hình thức', 'Mã giao dịch', 'Thu', 'Chi', 'Người ghi', 'Ghi chú', 'Đã huỷ (lý do)'],
      rows: rows.map(r => { const posted = (r.status || (r.voided ? 'voided' : 'posted')) === 'posted'; return [r.date, r.kind === 'in' ? 'Thu' : 'Chi', r.partner, r.docNo, PAY_METHOD[r.method] || r.method, r.reference, r.kind === 'in' && posted ? r.amount : 0, r.kind === 'out' && posted ? r.amount : 0,
        r.createdByName, r.note, r.voided ? r.voidReason || 'Đã huỷ' : '']; }) }]);
  } catch (ex) { toast(ex.message, 'err'); } finally { b.disabled = false; }
});
$('#receivables-export').addEventListener('click', async e => {
  const rows = state.receivables || [], b = e.currentTarget; if (!rows.length) return toast('Không có dòng công nợ để xuất.', 'err');
  b.disabled = true;
  try {
    await downloadExcel('cong-no', [{ name: 'Công nợ', widths: [34, 18, 16, 14, 14, 16, 14, 14, 14, 14, 14, 12, 14, 14, 14, 18],
      header: ['Khách hàng', 'Số đơn / HĐKT', 'Phụ trách', 'Ngày đặt', 'Tình trạng', 'Số hoá đơn', 'Phải thu', 'Đã thu', 'Còn lại', 'Quá hạn', 'Hạn thu kế tiếp', 'Số ngày quá hạn', 'Quá hạn 1–30', 'Quá hạn 31–60', 'Quá hạn >60', 'Điện thoại'],
      rows: rows.map(r => [r.customerName, r.contractNo ? 'HĐKT ' + r.contractNo : r.orderNo, r.ownerName || '', r.orderDate, DEBT_STATUS[r.status]?.[0] || r.status, r.invoiceNo || '',
        r.due, r.paid, r.balance, r.overdue, r.nextDueDate || '', r.aging?.overdueDays || 0, r.aging?.buckets.d30 || 0, r.aging?.buckets.d60 || 0, r.aging?.buckets.over60 || 0, r.phone || '']) }]);
  } catch (ex) { toast(ex.message, 'err'); } finally { b.disabled = false; }
});
$('#receivables-filters').addEventListener('click', e => {
  const chip = e.target.closest('.chip'); if (!chip) return;
  $$('#receivables-filters .chip').forEach(c => { c.classList.toggle('active', c === chip); c.setAttribute('aria-pressed', String(c === chip)); });
  loadReceivables();
});
for (const id of ['#deliveries-from', '#deliveries-to']) $(id).addEventListener('change', loadDeliveries);
$('#deliveries-status').addEventListener('click', e => {
  const chip = e.target.closest('.chip'); if (!chip) return;
  $$('#deliveries-status .chip').forEach(c => { c.classList.toggle('active', c === chip); c.setAttribute('aria-pressed', String(c === chip)); });
  loadDeliveries();
});
// Bấm cả dòng để mở đơn (trừ khi bấm nút/liên kết trong dòng).
document.addEventListener('click', e => {
  const tr = e.target.closest('tr[data-href]'); if (!tr || e.target.closest('a, button')) return;
  go(tr.dataset.href);
});
// Đổi trạng thái chuyến giao (trang Lịch giao và trang đơn).
document.addEventListener('click', async e => {
  const b = e.target.closest('[data-ship]'); if (!b) return;
  const to = b.dataset.to, label = DELIVERY_STATUS[to][0];
  // "Đã giao": chụp ảnh hàng đã giao hoặc biên bản ký nhận (kho bắt buộc 1 ảnh, người khác tuỳ chọn).
  let photos = [];
  if (to === 'delivered') {
    photos = await photoBox({ title: 'Xác nhận đã giao', ok: 'Đã giao', min: isWarehouse() ? 1 : 0,
      text: 'Chụp ảnh hàng đã giao hoặc biên bản có chữ ký người nhận (1–3 ảnh). Số lượng đã giao sẽ cộng vào đơn và không đổi lại được.' });
    if (!photos) return;
  } else if (to === 'cancelled' && !await confirmBox('Huỷ chuyến giao này?', { title: label, ok: label, danger: true })) return;
  b.disabled = true;
  try { await api(`/deliveries/${encodeURIComponent(b.dataset.ship)}/status`, 'PUT', { status: to, ...(photos.length ? { photos } : {}) }); toast('Đã cập nhật: ' + label); if (!$('#view-order').hidden) openOrder(sales.order.id); else loadDeliveries(); }
  catch (ex) { toast(ex.message, 'err'); b.disabled = false; }
});

// ----- chi tiết đơn
const sales = { order: null, detail: null };
// ----- Thông báo (Web Push như web cũ) + trang TỰ LÀM MỚI khi khách gửi báo giá / đặt hàng / hỏi tồn
var dataRefresh = setupDataRefresh({
  read: path => api(path), refresh: () => refreshData(),
  enabled: () => !!state.user,
  blocked: () => (location.hash.startsWith('#/pos') && !!posUi?.dirty()) || (!$('#view-editor').hidden && editor.dirty) || saving || !!document.querySelector('dialog[open]'),
  routeKey: () => location.hash,
  primaryPaths: () => location.hash.startsWith('#/cash') ? ['/cash'] : location.hash.startsWith('#/pos') ? ['/pos/options'] : isWarehouse() ? ['/packing?status=sent'] : [can('page.quotes') && '/quotes', can('page.orders') && '/orders', can('page.contracts') && '/contracts'].filter(Boolean),
  onDeferred: () => toast('Có dữ liệu mới. Trang sẽ cập nhật sau khi anh/chị lưu thay đổi và đóng biểu mẫu.'),
  // Không tự hỏi định kỳ / khi quay lại tab: `pulse` (GET /pulse mỗi 30 giây) gọi tick() khi máy chủ báo có thay đổi.
  schedule: () => 0, cancel: () => {}, wakeOnFocus: false,
});
const notifier = setupNotifications({
  api, root: $('#staff-bell'),
  onNew(notes) {
    for (const n of notes.slice(0, 3)) toast(`${n.title}: ${n.body}`);
    dataRefresh.request(); dataRefresh.tick();
  },
  onOpen(n) { const h = (n.url || '').split('#')[1]; if (h) go('#' + h); },
  isManager: () => isManager(),
  poll: false,
});
var pulse = setupPulse({ api, onData: () => dataRefresh.tick(), onNotify: () => notifier.check(), onChat: n => chatView().badge(n) }); // eslint-disable-line no-var -- showAuth() dừng nhịp trước khi khởi tạo xong
/** Bảng công việc (trial-ui/tasks.js) – khởi tạo khi cần (sau đăng nhập). */
var tasksUi = null; // eslint-disable-line no-var -- dùng được trước dòng này (khởi động sau đăng nhập)
/** Chăm sóc khách hàng (trial-ui/care.js). */
var careUi = null; // eslint-disable-line no-var
var dashboardUi = null;
function dashboardView() { return dashboardUi ||= initDashboard({ api, root: $('#view-dashboard'), isManager, money }); }
var suppliersUi = null;
function suppliersView() { return suppliersUi ||= initSuppliers({ api, root: $('#view-suppliers'), toast, confirmBox, canLinkAccounts: isManager }); }
var inventoryUi = null;
let khoHomeUi = null, stockLookupUi = null;
function khoHome() { return khoHomeUi ||= initKhoHome({ api, root: $('#view-kho'), today: todayIso }); }
function stockLookup() { return stockLookupUi ||= initStockLookup({ api, root: $('#view-stock-lookup') }); }
function inventoryView() { return inventoryUi ||= initInventory({ api, root: $('#view-inventory'), toast, confirmBox }); }
var transfersUi = null, stockMovesUi = null, sellerConfigUi = null;
function transfersView() { return transfersUi ||= initTransfers({ api, root: $('#view-transfers'), toast, go }); }
function stockMovesView() { return stockMovesUi ||= initStockMoves({ api, root: $('#view-stock-moves'), toast, createPager, linkAllowed }); }
function sellerConfigView() { if (!sellerConfigUi) { const box = document.createElement('div'); $('#view-permissions').after(box); box.id = 'seller-config-box'; sellerConfigUi = initSellerConfig({ api, root: box, toast }); } return sellerConfigUi; }
var permissionsUi = null;
function permissionsView() { return permissionsUi ||= initPermissions({ api, root: $('#view-permissions'), toast, confirmBox }); }
var purchasesUi = null;
function purchasesView() { return purchasesUi ||= initPurchases({ api, root: $('#view-purchases'), toast, confirmBox, money, go, today: todayIso, kho: isWarehouse,
  compressPhoto: f => compressImage(f, [[1280, .72], [1024, .68], [800, .62], [640, .6]], 450000, 'Ảnh quá lớn, chụp lại giúp.') }); }
// Sơ đồ quy trình: cấu hình ở flow-config.js; `openers` nối nút nhanh của khối với hộp thoại có sẵn của app.
var flowUi = null;
function flowView() {
  return flowUi ||= initFlowMap({ api, root: $('#view-flow'), go, confirmBox, toast, money, openers: {
    'new-quote': () => openNewQuote(),
    'new-customer': () => openCustomer(),
    'new-care': done => careView().openForm({}, done),
  } });
}
function careView() { return careUi ||= initCare({ api, toast, confirmBox, isManager, userId: () => state.user?.id, userName: () => state.user?.name, root: $('#view-care') }); }
function tasksView() { return tasksUi ||= initTasks({ api, toast, confirmBox, go, isManager, canApprove, userId: () => state.user?.id, positionId: () => state.user?.positionId }); }
/** Tin nhắn nội bộ (trial-ui/chat.js). */
var chatUi = null; // eslint-disable-line no-var
function chatView() { return chatUi ||= initChat({ api, toast, isManager, userId: () => state.user?.id, compress: compressImage }); }
/** Tải lại dữ liệu đang xem sau khi đã kiểm tra các biểu mẫu chưa lưu. */
async function refreshData() {
  if (!state.user) return;
  const jobs = [loadQuotes(), loadStockBadge(), loadNavigationBadges(), tasksView().badge(), chatView().badge()];
  if (can('page.care')) jobs.push(careView().badge());
  const [path, query = ''] = location.hash.replace(/^#\/?/, '').split('?');
  const [page, id] = path.split('/'), params = new URLSearchParams(query);
  if (page === 'quotes' && id) { if (!editor.dirty && id !== 'new') jobs.push(openEditor(id)); }
  else if (page === 'orders') jobs.push(id ? openOrder(id) : loadOrders());
  else if (page === 'contracts') jobs.push(id ? openOrder(id) : loadContracts());
  else if (page === 'cash') jobs.push(cashView().load());
  else if (page === 'pos') { if (!posUi?.dirty()) jobs.push(posView().load()); }
  else if (page === 'receiving') jobs.push(receivingView().load());
  else if (page === 'deliveries') jobs.push(loadDeliveries());
  else if (page === 'receivables') jobs.push(loadReceivables());
  else if (page === 'customers') jobs.push(id ? customerDetail().open(decodeURIComponent(id)) : loadCustomers());
  else if (page === 'products') jobs.push(loadProducts(), productAdmin().loadPending(), loadCatalogSnapshot());
  else if (page === 'staff' && isManager()) jobs.push(loadMembers());
  else if (page === 'tasks') jobs.push(tasksView().load(id));
  else if (page === 'dashboard') jobs.push(dashboardView().load());
  else if (page === 'flow') jobs.push(flowView().load());
  else if (page === 'suppliers' && canEditSuppliers()) jobs.push(suppliersView().load());
  else if (page === 'purchases') jobs.push(purchasesView().load());
  else if (page === 'care') jobs.push(careView().load(id ? decodeURIComponent(id) : ''));
  else if (page === 'stock-requests') jobs.push(loadStockRequests(id));
  else if (page === 'packing') jobs.push(openPacking(id ? decodeURIComponent(id) : ''));
  else if (page === 'members' && id) jobs.push(memberDetail().open(decodeURIComponent(id), params.get('month') || '', params.get('tab') || ''));
  else if (page === 'payroll') jobs.push(payrollBoard().open(params.get('month') || ''));
  await Promise.allSettled(jobs);
}

// ----- Khách hỏi tồn kho: nhân viên phụ trách trả lời (khách nhận thông báo)
let stockFilter = 'open';
const stockShortageExports = new Map();
async function loadStockBadge() {
  if (!can('page.stock-requests')) return;
  try { const n = (await api('/stock-requests?status=open')).requests.length; $('#nav-stock-count').hidden = !n; $('#nav-stock-count').textContent = n; } catch { /* bỏ qua */ }
}
async function loadStockRequests(focusId) {
  stockShortageExports.clear();
  const box = $('#stock-req-list'); box.innerHTML = '<p class="muted card">Đang tải…</p>';
  try {
    const { requests } = await api('/stock-requests' + (stockFilter ? '?status=' + stockFilter : ''));
    const skus = [...new Set(requests.flatMap(r => r.items.map(i => i.sku)))];
    const stock = new Map();
    await loadHolds(true);
    for (let i = 0; i < skus.length; i += 200) { const d = await api('/products?skus=' + encodeURIComponent(skus.slice(i, i + 200).join(','))); applyCatalogMeta(d); for (const p of d.products) stock.set(p.sku, p); }
    for (const request of requests) stockShortageExports.set(request.id, shortageRows(request.items, stock, availableStock));
    $('#stock-req-empty').hidden = requests.length > 0;
    $('#nav-stock-count').hidden = stockFilter !== 'open' || !requests.length; $('#nav-stock-count').textContent = requests.length;
    box.innerHTML = requests.map(r => `<article class="card stock-req ${r.id === focusId ? 'focus' : ''}" data-req="${esc(r.id)}">
      <header><div><b>${esc(r.customerName)}</b> <span class="pill ${r.status === 'open' ? 'warn' : 'ok'}">${r.status === 'open' ? 'Chờ trả lời' : 'Đã trả lời'}</span>
        <small class="muted">${esc(r.askedBy)} · ${new Date(r.createdAt).toLocaleString('vi-VN')}</small></div></header>
      <div class="row-gap end"><button type="button" class="btn secondary small" data-purchase-from title="Lập đơn mua NCC cho phần khách cần mà chưa đáp ứng">Đặt hàng NCC</button><button type="button" class="btn secondary small" data-shortage-pdf ${stockShortageExports.get(r.id)?.rows.length ? '' : 'disabled'} title="Xuất mã thiếu so với tồn khả dụng; không kèm thông tin khách hoặc giá">Tải PDF mã thiếu</button></div>
      ${r.note ? `<p class="small"><b>Khách ghi chú:</b> ${esc(r.note)}</p>` : ''}
      <div class="table-wrap"><table class="data-table"><thead><tr><th>Sản phẩm</th><th class="right">Khách cần</th>${r.items.some(i => heldQty(i.sku) > 0) ? '<th class="right">Tồn kho</th><th class="right">Đang treo</th><th class="right">Khả dụng</th>' : '<th class="right">Tồn khả dụng</th>'}${r.items.some(x => hasSupplierStock(stock.get(x.sku))) ? '<th class="right">Kho NCC</th>' : ''}<th class="right">Hàng chờ về</th><th class="right">Đáp ứng</th></tr></thead><tbody>
      ${r.items.map(i => { const anyHeld = r.items.some(x => heldQty(x.sku) > 0); const anyLock = r.items.some(x => hasSupplierStock(stock.get(x.sku))); const p = stock.get(i.sku), a = r.answerItems.find(x => x.sku === i.sku), av = p ? availableStock(p) : null;
        return `<tr><td>${esc(i.name)}<small>${esc(i.sku)} · ${esc(i.unit || '')}</small></td><td class="right">${fmtNum(i.qty)}</td>
          ${anyHeld ? `<td class="right">${p ? fmtNum(stockTotal(p)) : '—'}</td><td class="right">${heldCell(i.sku)}</td>` : ''}
          <td class="right ${av !== null && av < i.qty ? 'danger-text' : ''}">${av === null ? '—' : fmtNum(av)}</td>
          ${anyLock ? `<td class="right">${p && hasSupplierStock(p) ? stockText(kindStock(p, 'supplier')) : ''}</td>` : ''}<td class="right">${p ? incomingCell(p) : '—'}</td>
          <td class="right">${r.status === 'open' ? `<input class="num-input" inputmode="decimal" data-sku="${esc(i.sku)}" value="${av === null ? '' : Math.max(0, Math.min(i.qty, av))}" aria-label="Đáp ứng ${esc(i.name)}">` : fmtNum(a?.available ?? 0)}</td></tr>`; }).join('')}
      </tbody></table></div>
      ${r.status === 'open' ? `<label>Trả lời khách<textarea rows="2" maxlength="2000" data-answer placeholder="Ví dụ: Còn đủ hàng, giao được trong 2 ngày."></textarea></label>
        <div class="row-gap end"><button type="button" class="btn primary" data-reply>Gửi trả lời cho khách</button></div>`
        : `<p class="small"><b>Đã trả lời${r.answeredAt ? ' lúc ' + new Date(r.answeredAt).toLocaleString('vi-VN') : ''}:</b> ${esc(r.answer || '—')}</p>`}
    </article>`).join('');
    if (focusId) $(`[data-req="${CSS.escape(focusId)}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  } catch (e) { box.innerHTML = `<p class="error card">${esc(e.message)}</p>`; }
}
$('#stock-req-filter').addEventListener('click', e => {
  const b = e.target.closest('[data-status]'); if (!b) return;
  stockFilter = b.dataset.status; $$('#stock-req-filter [data-status]').forEach(x => x.setAttribute('aria-pressed', String(x === b))); loadStockRequests();
});
$('#stock-req-list').addEventListener('click', async e => {
  const buy = e.target.closest('[data-purchase-from]');
  if (buy) { go('#/purchases/new?type=stock_request&id=' + encodeURIComponent(buy.closest('[data-req]').dataset.req)); return; }
  const pdfButton = e.target.closest('[data-shortage-pdf]');
  if (pdfButton) {
    if (pdfButton.disabled) return;
    const id = pdfButton.closest('[data-req]').dataset.req, data = stockShortageExports.get(id);
    pdfButton.disabled = true;
    try { await downloadShortagePdf(data, id); } catch (ex) { toast(ex.message, 'err'); }
    finally { pdfButton.disabled = !data?.rows.length; }
    return;
  }
  const btn = e.target.closest('[data-reply]'); if (!btn) return;
  const card = btn.closest('[data-req]');
  const items = $$('input[data-sku]', card).map(i => ({ sku: i.dataset.sku, available: parseNum(i.value || '0') }));
  btn.disabled = true;
  try { await api(`/stock-requests/${encodeURIComponent(card.dataset.req)}/answer`, 'POST', { items, answer: card.querySelector('[data-answer]').value }); toast('Đã gửi trả lời cho khách.'); loadStockRequests(); }
  catch (ex) { toast(ex.message, 'err'); } finally { btn.disabled = false; }
});

// ----- Tài khoản trang khách hàng: nhân viên cấp cho khách mình phụ trách; Manager đặt chiết khấu riêng theo nhãn.
const DISCOUNT_LABELS = { minhLong: 'Minh Long', lys: 'Minh Long - Lys', lock: 'Lock&Lock' };
let accCustomer = null;
async function openAccounts(c) {
  if (!c) return;
  accCustomer = c; $('#accounts-title').textContent = c.name; $('#account-form').reset(); $('#account-error').textContent = ''; $('#account-link').hidden = true;
  $('#account-form').email.value = c.email || ''; $('#account-form').name.value = c.contact || ''; $('#account-form').phone.value = c.phone || '';
  $$('.manager-only', $('#accounts-dialog')).forEach(el => el.hidden = !isManager());
  $('#accounts-dialog').showModal(); await drawAccounts();
}
// Đóng hộp tài khoản khi đang ở trang chi tiết khách → tải lại thẻ "Tài khoản" (CK, SĐT, trạng thái có thể đã đổi).
$('#accounts-dialog').addEventListener('close', () => { if (customerUi && location.hash.startsWith('#/customers/')) customerUi.reload(); });
async function drawAccounts() {
  const list = $('#accounts-list'); list.innerHTML = '<li class="muted">Đang tải…</li>';
  try {
    const { accounts } = await api('/customers/' + encodeURIComponent(accCustomer.id) + '/accounts');
    list.innerHTML = accounts.length ? accounts.map(a => `<li data-member="${esc(a.memberId)}">
      <div><b>${esc(a.name)}</b> <span class="pill ${a.active ? (a.activated ? 'ok' : 'warn') : 'muted'}">${a.active ? (a.activated ? 'Đang dùng' : 'Chưa đặt mật khẩu') : 'Đã khoá'}</span>
        <small>${[a.email ? esc(a.email) : '', a.phone ? 'ĐT ' + esc(a.phone) : ''].filter(Boolean).join(' · ')}${!a.email ? ' (đăng nhập bằng số di động)' : ''} · Phụ trách: ${esc(a.owner.name || a.owner.id)}</small>
        <small>CK riêng: ${Object.keys(DISCOUNT_LABELS).map(k => `${DISCOUNT_LABELS[k]} ${fmtNum(a.discounts[k] || 0)}%`).join(' · ')}</small></div>
      ${a.canManage ? `<div class="row-actions">${isManager() ? '<button type="button" class="btn ghost small" data-acc-discount>Đặt CK</button>' : ''}
        <button type="button" class="btn ghost small" data-acc-phone>${a.phone ? 'Đổi SĐT' : 'Thêm SĐT'}</button>
        <button type="button" class="btn ghost small" data-acc-reset>Cấp lại link</button>
        <button type="button" class="btn ghost small" data-acc-active="${a.active ? 0 : 1}">${a.active ? 'Khoá' : 'Mở khoá'}</button></div>` : ''}
    </li>`).join('') : '<li class="muted">Khách này chưa có tài khoản. Tạo tài khoản bên dưới rồi gửi link cho khách tự đặt mật khẩu.</li>';
    list._accounts = accounts;
  } catch (ex) { list.innerHTML = `<li class="error">${esc(ex.message)}</li>`; }
}
function showAccountLink(url) {
  $('#account-link').hidden = false; $('#account-link-url').value = url;
  navigator.clipboard?.writeText(url).then(() => toast('Đã chép link vào bộ nhớ. Gửi link cho khách (hiệu lực 15 phút).')).catch(() => {});
}
const readDiscounts = f => Object.fromEntries(Object.keys(DISCOUNT_LABELS).map(k => [k, f.elements['d_' + k]?.value === '' ? 0 : parseNum(f.elements['d_' + k]?.value || '0')]));
$('#account-form').addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target, err = $('#account-error'); err.textContent = '';
  const body = { customerId: accCustomer.id, name: f.name.value.trim(), email: f.email.value.trim(), phone: f.phone.value.trim() };
  if (!body.email && !body.phone) { err.textContent = 'Nhập số di động (hoặc email) để khách đăng nhập.'; f.phone.focus(); return; }
  if (isManager()) body.discounts = readDiscounts(f);
  try { const r = await api('/customer-accounts', 'POST', body); showAccountLink(r.url); f.reset(); await drawAccounts(); }
  catch (ex) { err.textContent = ex.message; }
});
$('#accounts-list').addEventListener('click', async e => {
  const li = e.target.closest('li[data-member]'); if (!li) return;
  const id = li.dataset.member, a = $('#accounts-list')._accounts.find(x => x.memberId === id);
  try {
    if (e.target.closest('[data-acc-phone]')) {
      const cur = a?.phone || '';
      const phone = prompt('Số điện thoại đăng nhập của tài khoản này (để trống = bỏ đăng nhập bằng số):', cur);
      if (phone === null) return;
      await api(`/customer-accounts/${encodeURIComponent(id)}`, 'PUT', { phone: phone.trim() }); toast('Đã cập nhật số điện thoại.'); return drawAccounts();
    }
    if (e.target.closest('[data-acc-reset]')) { showAccountLink((await api(`/customer-accounts/${encodeURIComponent(id)}/reset`, 'POST', {})).url); return drawAccounts(); }
    const act = e.target.closest('[data-acc-active]');
    if (act) { await api(`/customer-accounts/${encodeURIComponent(id)}`, 'PUT', { active: act.dataset.accActive === '1' }); toast(act.dataset.accActive === '1' ? 'Đã mở khoá tài khoản.' : 'Đã khoá tài khoản.'); return drawAccounts(); }
    if (e.target.closest('[data-acc-discount]')) openDiscount(a, drawAccounts);
  } catch (ex) { toast(ex.message, 'err'); }
});
/** Hộp đặt chiết khấu riêng của 1 tài khoản khách (Manager) – mở từ "Quản lý tài khoản" hoặc trang chi tiết khách; lưu xong gọi `after`. */
let discountAfter = null;
function openDiscount(a, after) {
  if (!isManager()) return toast('Chỉ Manager mới đặt được chiết khấu riêng.', 'err');
  const f = $('#discount-form'); $('#discount-name').textContent = a.name; f.dataset.member = a.memberId; discountAfter = after;
  for (const k of Object.keys(DISCOUNT_LABELS)) f.elements['d_' + k].value = a.discounts?.[k] || '';
  $('#discount-error').textContent = ''; $('#discount-dialog').showModal();
}
$('#discount-form').addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target;
  try { await api(`/customer-accounts/${encodeURIComponent(f.dataset.member)}`, 'PUT', { discounts: readDiscounts(f) }); $('#discount-dialog').close(); toast('Đã lưu chiết khấu riêng.'); discountAfter?.(); }
  catch (ex) { $('#discount-error').textContent = ex.message; }
});
$('#account-link-copy').addEventListener('click', () => { $('#account-link-url').select(); navigator.clipboard?.writeText($('#account-link-url').value).then(() => toast('Đã chép link.')).catch(() => document.execCommand('copy')); });

async function openOrder(id) {
  const onContracts = location.hash.startsWith('#/contracts/');
  $('#order-title').textContent = onContracts ? 'Đang tải HĐKT…' : 'Đang tải đơn…';
  let d;
  try { d = await api('/orders/' + encodeURIComponent(id)); } catch (e) { toast(e.message, 'err'); if (e.status !== 401) go(onContracts ? '#/contracts' : '#/orders'); return; }
  sales.order = d.order; sales.detail = d;
  // HĐKT luôn ở #/contracts/<id>, đơn hàng ở #/orders/<id> (link cũ / thông báo cũ tự chuyển đúng trang).
  const want = docHref(id, d.contract?.contractNo);
  if (location.hash.split('?')[0] !== want) { history.replaceState(null, '', want); lastRoutedHash = want; currentHash = want; }
  const o = d.order, r = d.receivable, isK = !!d.contract, what = isK ? 'HĐKT' : 'đơn';
  const ref = orderReference(o, d.contract);
  $('#order-title').textContent = ref.number; $('#breadcrumb').textContent = ref.number; document.title = ref.number + ' · Bách Ngân';
  // Đơn hàng và HĐKT là 2 luồng: đơn có HĐKT quay về trang HĐKT.
  $('#order-back').href = d.contract ? '#/contracts' : '#/orders'; $('#order-back').textContent = d.contract ? '‹ HĐKT' : '‹ Đơn đặt hàng';
  $$('[data-nav]').forEach(a => a.classList.toggle('active', a.dataset.nav === (d.contract ? 'contracts' : 'orders')));
  const stKey = (o.status === 'draft' && o.submittedAt === null ? 'unsubmitted' : o.status);
  $('#order-status').outerHTML = `<span class="pill ${ORDER_STATUS[stKey]?.[1] || ''}" id="order-status">${esc(ORDER_STATUS[stKey]?.[0] || o.status)}</span>`;
  // Liên kết các bước của đơn
  const step = (done, label, sub, href) => `<${href ? `a href="${href}"` : 'div'} class="flow-step ${done ? 'done' : ''}"><b>${esc(label)}</b><small>${esc(sub)}</small></${href ? 'a' : 'div'}>`;
  const shipped = d.lines.reduce((s, l) => s + l.deliveredQty, 0), totalQty = d.lines.reduce((s, l) => s + l.qty, 0);
  $('#order-flow').innerHTML = [
    step(!!o.quoteId, 'Báo giá', o.quoteNo || 'Không có', o.quoteId ? `#/quotes/${encodeURIComponent(o.quoteId)}` : ''),
    ...(!d.contract ? [step(true, 'Đơn đặt hàng', o.orderNo)] : []),
    step(!!d.contract, 'HĐKT', d.contract ? d.contract.contractNo : 'Chưa lập', d.contract ? '#/contracts' : ''),
    step(o.status === 'delivered', 'Giao hàng', `${fmtNum(shipped)}/${fmtNum(totalQty)} đã giao`, '#/deliveries'),
    step(r.status === 'paid', 'Công nợ', r.balance > 0 ? 'Còn ' + money(r.balance) : r.balance<0?'Còn hoàn '+money(-r.balance):'Đã thu đủ', '#/receivables'),
  ].join('<span class="flow-arrow" aria-hidden="true">›</span>');
  // Phiếu đóng gói / phiếu giao hàng / yêu cầu đóng gói chỉ dùng được khi đơn đã lên lịch giao (có chuyến chưa huỷ).
  const scheduled = d.deliveries.some(x => x.status !== 'cancelled');
  // HĐKT không có mẫu "đơn đặt hàng": nút chính là hồ sơ HĐKT (HĐKT + đề nghị tạm ứng + biên bản nghiệm thu).
  $('#order-actions').innerHTML = (isK ? '<button class="btn secondary" data-contract-docs title="Xem, sửa rồi tải HĐKT + đề nghị tạm ứng + biên bản nghiệm thu (file Word theo mẫu)">Xem / tải hồ sơ HĐKT</button>'
      : '<button class="btn secondary" id="order-print" title="Xem, sửa rồi in / lưu PDF hoặc tải Excel đơn đặt hàng">In / Tải đơn hàng</button>')
    + (o.status !== 'draft' && o.status !== 'cancelled' ? `<button class="btn secondary" data-pack-print-for="${esc(o.id)}"${scheduled ? '' : ` disabled title="${NO_SCHEDULE}"`}>In phiếu đóng gói</button><button class="btn secondary" data-ship-print-for="${esc(o.id)}"${scheduled ? '' : ` disabled title="${NO_SCHEDULE}"`}>In phiếu giao hàng</button>` : '')
    + (o.status === 'draft' ? (canApprove() ? `<button class="btn ok" id="order-confirm" title="Kiểm tra rồi duyệt ${what}. Đã duyệt thì chỉ Manager được sửa báo giá / chứng từ.">Duyệt ${what}</button>`
      : o.submittedAt === null ? (o.canEdit !== false ? `<button class="btn primary" id="order-submit" title="Xem kỹ ${what} rồi gửi Manager duyệt">Gửi duyệt</button>` : `<span class="pill" title="Người phụ trách chưa gửi duyệt">Nháp</span>`)
      : `<span class="pill warn" title="Còn nháp: sửa báo giá thì ${what} tự cập nhật theo">Chờ Manager duyệt</span>`) : '')
    + ((isManager() || (o.status === 'draft' && o.canEdit !== false)) && o.status !== 'cancelled' && !d.payments.some(p => !p.voidedAt) && shipped === 0 ? `<button class="btn ghost" id="order-cancel">Huỷ ${what}</button>` : '')
    + (isManager() && o.status === 'cancelled' && !d.payments.length && shipped === 0 ? `<button class="btn ghost danger-text" id="order-delete" title="Xoá hẳn ${what} đã huỷ khỏi danh sách">Xoá ${what}</button>` : '')
    + (isManager() ? '<button class="btn ghost" id="order-history" title="Ai tạo / duyệt / giao / thu tiền, lúc nào">Lịch sử</button>' : '');
  if(o.channel==='pos' && can('pos.sell')){const b=document.createElement('button');b.className='btn secondary';b.textContent='Trả / Đổi / Hoàn tiền';b.onclick=async()=>{try{const opts=await api('/pos/options');await openPosReturns({api,toast,orderId:o.id,shift:opts.current,register:opts.registers.find(r=>r.id===opts.current?.registerId),onChanged:()=>openOrder(o.id)});}catch(e){toast(e.message,'err');}};$('#order-actions').append(b);}
  if(o.channel==='pos'&&can('pos.sell')&&['deposit','prepaid'].includes(JSON.parse(o.posSnapshot||'{}').saleFlow)){const b=document.createElement('button');b.className='btn primary';b.textContent='Cọc / Thu nốt / Trả trước';b.onclick=async()=>{try{const opts=await api('/pos/options');await openPosOrderFlows({api,toast,shift:opts.current,register:opts.registers.find(r=>r.id===opts.current?.registerId),orderId:o.id,onChanged:()=>openOrder(o.id),onReturns:id=>openPosReturns({api,toast,shift:opts.current,register:opts.registers.find(r=>r.id===opts.current?.registerId),orderId:id,onChanged:()=>openOrder(o.id)})});}catch(e){toast(e.message,'err');}};$('#order-actions').append(b);}
  if (o.channel === 'pos' && o.canEdit && o.status !== 'cancelled' && !isK) $('#order-actions').append(posOrderEditor({ api, detail: d, onSaved: () => openOrder(o.id) }));
  const sapoAction = orderSapoAction({ order: o, api, chooseSapo: (ref, opts) => sapoPush().choose(ref, opts), onSaved: () => openOrder(o.id), toast });
  if (sapoAction) $('#order-actions').append(sapoAction);
  if (o.status !== 'cancelled' && !isWarehouse()) {
    const buy = document.createElement('button'); buy.type = 'button'; buy.className = 'btn secondary'; buy.textContent = 'Đặt hàng NCC';
    buy.title = 'Lập đơn mua NCC từ các mã của ' + what + ' (hiện số còn cần đặt để tránh mua trùng)';
    buy.addEventListener('click', () => go('#/purchases/new?type=order&id=' + encodeURIComponent(o.id)));
    $('#order-actions').append(buy);
  }
  const shipDone = o.status === 'delivered' || o.status === 'cancelled';
  $('#order-customer').innerHTML = [['Khách hàng', o.customerName], ['Người liên hệ', o.contact], ['Điện thoại', o.phone], ['MST', o.taxCode], ['Địa chỉ', o.address], [isK ? 'Ngày lập' : 'Ngày đặt', fmtDate(o.orderDate)]]
    .filter(([, v]) => v).map(([k, v]) => `<dt>${k}</dt><dd>${k === 'Khách hàng' && o.customerId && canPage('customer') ? `<a href="#/customers/${encodeURIComponent(o.customerId)}">${esc(v)}</a>` : esc(v)}</dd>`).join('')
    // Giao dự kiến tô màu theo hạn: trễ/hôm nay đỏ, ≤3 ngày cam, ≤7 ngày xanh dương, xa hơn xanh lá.
    + `<dt>Giao dự kiến</dt><dd>${duePill(o.expectedDeliveryDate, { done: shipDone, fmt: fmtDate })}</dd>`;
  $('#order-lines-title').textContent = isK ? 'Hàng trong HĐKT' : 'Hàng trong đơn';
  $('#order-debt').innerHTML = `<dl class="totals"><div><dt>Giá trị ${what} (gồm VAT)</dt><dd>${money(o.total)}</dd></div><div><dt>Đã thu</dt><dd class="${r.paid > 0 ? 'paid-text' : ''}">${money(r.paid)}</dd></div>
    <div class="grand"><dt>Còn phải thu</dt><dd>${money(r.balance)}</dd></div>${r.overdue ? `<div><dt class="danger-text">Quá hạn</dt><dd class="danger-text">${money(r.overdue)}</dd></div>` : ''}</dl>
    <ul class="plain-list">${allocatePayments(d.effectiveSchedules || d.schedules, r.paid).map(s => `<li class="${s.left <= 0 ? 'installment-paid' : ''}"><span>${esc(s.note || s.kind)}<small>${installmentStatus(s)}</small></span><b>${money(s.amount)}</b><small>${s.left <= 0 ? 'Đã hoàn tất' : s.dueDate ? 'Hạn ' + fmtDate(s.dueDate) : 'Hạn: sau khi giao xong'}</small></li>`).join('')}</ul>`;
  renderOrderLineDetails({ head: $('#order-lines-head'), body: $('#order-lines'), details: $('#order-line-details'), order: o, lines: d.lines });
  const k = d.contract;
  // Đơn hàng và HĐKT là 2 luồng: đơn không có HĐKT (khách có HĐ nguyên tắc) hiện ô "Đơn hàng" thay cho ô HĐKT.
  $('#order-contract-title').textContent = k ? 'HĐKT' : 'Đơn hàng';
  // Đơn hàng và HĐKT là 2 luồng độc lập: không lập HĐKT từ một đơn hàng (HĐKT lập thẳng từ báo giá).
  $('#order-contract-action').innerHTML = '';
  $('#order-contract').innerHTML = k ? `<dl class="kv"><dt>Số HĐKT</dt><dd><b>${esc(k.contractNo)}</b></dd><dt>Trạng thái</dt><dd>${pill(CONTRACT_STATUS, k.status)}</dd>
    <dt>Pháp nhân</dt><dd>${esc(k.legalEntity)}</dd><dt>Ngày ký</dt><dd>${fmtDate(k.signedDate) || '—'}</dd><dt>Đặt cọc</dt><dd>${fmtNum(k.depositRate)}% · ${money(k.depositAmount)}</dd>
    <dt>Thanh toán còn lại</dt><dd>${k.paymentDays} ngày sau khi giao xong</dd>${saleWarehouseRow(o)}</dl>
    <div class="row-gap"><button class="btn primary small" data-contract-docs title="Xem, sửa rồi tải HĐKT + đề nghị tạm ứng + biên bản nghiệm thu (file Word theo mẫu)">Xem / sửa / tải hồ sơ HĐKT</button>${isManager() && k.status === 'draft' && o.status !== 'draft' ? `<button class="btn secondary small" data-contract-sign="${esc(k.id)}">Đánh dấu đã ký</button>` : ''}</div>`
    : `<dl class="kv"><dt>Số đơn</dt><dd><b>${esc(o.orderNo)}</b></dd><dt>Trạng thái</dt><dd>${pill(ORDER_STATUS, (o.status === 'draft' && o.submittedAt === null ? 'unsubmitted' : o.status))}</dd>
    <dt>Ngày đặt</dt><dd>${fmtDate(o.orderDate)}</dd>${o.quoteNo ? `<dt>Từ báo giá</dt><dd>${o.quoteId ? `<a href="#/quotes/${encodeURIComponent(o.quoteId)}">${esc(o.quoteNo)}</a>` : esc(o.quoteNo)}</dd>` : ''}
    <dt>Phụ trách</dt><dd>${esc(o.ownerName || '—')}</dd>${saleWarehouseRow(o)}<dt>Giá trị (gồm VAT)</dt><dd><b>${money(o.total)}</b></dd>
    <dt>Thanh toán</dt><dd>${o.channel === 'pos' ? esc(posPaymentText(d)) : 'Theo HĐ nguyên tắc với khách'}</dd></dl>
    <div class="row-gap"><button class="btn primary small" id="order-print-card" title="Xem, sửa rồi in / lưu PDF hoặc tải Excel đơn đặt hàng">In / Tải đơn hàng</button></div>`;
  renderInvoice(o); renderProgress(d);
  // Ngày giao dự kiến chỉ xem ở đây; đổi ngày bằng "＋ Lên lịch giao" (ngày của chuyến giao thành ngày giao dự kiến của đơn).
  $('#order-deliveries').innerHTML = (shipDone ? '' : `<div class="expected-row"><span class="muted small">Ngày giao dự kiến</span>
      ${o.expectedDeliveryDate ? duePill(o.expectedDeliveryDate, { fmt: fmtDate }) : '<span class="muted">Chưa có</span>'}<small class="muted">Đổi ngày giao bằng nút "＋ Lên lịch giao".</small></div>`)
    + (d.deliveries.length ? `<ul class="plain-list">${d.deliveries.map(x => `<li><span><b>${fmtDate(x.plannedDate)}</b> ${esc(x.timeSlot)} · ${esc(x.deliveryNo)}<small>${[ghnTrackingText(x), x.lines.map(l => { const line = d.lines.find(y => y.id === l.orderLineId); return `${line?.name || ''}: ${fmtNum(l.qty)}`; }).join(' · ')].filter(Boolean).map(esc).join(' · ')}</small></span>${pill(DELIVERY_STATUS, x.status)}${deliveryPhotos(x)}<span class="row-gap">${deliveryButtons(x)}</span></li>`).join('')}</ul>`
    : '<p class="muted">Chưa có lịch giao.</p>');
  loadOrderPacking(o.id);
  $('#order-pack').hidden = ['cancelled', 'draft', 'delivered'].includes(o.status);
  $('#order-pack').disabled = false; $('#order-pack').title = 'Lên lịch giao và lập phiếu trong một lần lưu; đơn một nguồn gửi kho ngay.';
  $('#order-new-delivery').hidden = o.status === 'cancelled' || o.status === 'delivered';
  $('#order-new-payment').hidden = (o.channel === 'pos' && (o.fulfillmentMode === 'cod' || !can('pos.sell'))) || o.status === 'cancelled' || o.status === 'draft' || r.balance <= 0;
  // Tóm tắt ở đầu ô Thanh toán (khớp ô Công nợ): đã thu đủ → xanh; còn nợ → ghi rõ số còn phải thu.
  const paySummary = r.balance < 0 ? `<div class="pay-summary warn"><span>Còn phải hoàn / dùng đổi hàng</span><b>${money(-r.balance)}</b></div>` : o.status === 'cancelled' ? '' : r.balance <= 0 && r.due > 0
    ? `<div class="pay-summary ok"><span class="pill ok">✓ Đã thanh toán đủ</span><b class="paid-text">${money(r.paid)}</b></div>`
    : `<div class="pay-summary ${r.overdue ? 'danger' : 'warn'}"><span>Còn phải thu${r.overdue ? ` <small class="danger-text">(quá hạn ${money(r.overdue)})</small>` : ''}</span><b>${money(r.balance)}</b>
       <small>Đã thu ${money(r.paid)} / ${money(r.due)}</small></div>`;
  // Phiếu đã huỷ: gạch ngang + ai huỷ, lý do (không tính vào đã thu). Manager / quyền "Huỷ phiếu thu" huỷ phiếu ghi nhầm (bắt buộc lý do).
  if(d.returnAdjustment){const n=document.createElement('p');n.className='pos-note';n.textContent='Hàng/phí đã trả: '+money(d.returnAdjustment.credit)+' · Giá trị sau trả: '+money(r.due)+' · Đã hoàn hoặc dùng đổi hàng: '+money(d.returnAdjustment.settled);$('#order-debt').append(n);}
  $('#order-payments').innerHTML = paySummary + (d.payments.length ? `<ul class="plain-list">${d.payments.map(p => `<li class="${p.voidedAt ? 'payment-voided' : ''}" data-payment="${esc(p.id)}"><span>${fmtDate(p.paidAt)} · ${p.paymentSource === 'pos_exchange_credit' ? 'Tiền đổi hàng' : p.method === 'cash' ? 'Tiền mặt' : p.method === 'transfer' ? 'Chuyển khoản' : 'Khác'}<small>${esc(p.reference || p.note)}</small></span><b>${money(p.amount)}</b>${p.voidedAt ? `<small class="void-note danger-text">Đã huỷ${p.voidedByName ? ' bởi ' + esc(p.voidedByName) : ''} · ${fmtDate(p.voidedAt)}: ${esc(p.voidReason)}</small>` : ''}${!p.voidedAt && d.canVoidPayment && !d.returnAdjustment && p.paymentSource!=='pos_exchange_credit' ? `<button type="button" class="btn ghost small danger-text" data-void-payment="${esc(p.id)}">Huỷ phiếu…</button>` : ''}</li>`).join('')}</ul>`
    : '<p class="muted">Chưa có phiếu thu.</p>');
  if (o.channel === 'pos' && o.fulfillmentMode === 'cod' && o.status !== 'cancelled' && r.balance > 0 && can('pos.sell')) {
    for (const delivery of d.deliveries.filter(x => x.status === 'delivered' && x.codAmount > d.payments.filter(p => !p.voidedAt && p.deliveryId === x.id).reduce((n, p) => n + p.amount, 0)))
      $('#order-payments').append(posCodReceipt({ api, delivery, onSaved: () => openOrder(o.id) }));
  }
}
/**
 * Tiến trình sản phẩm (mọi người cùng theo dõi): Duyệt → Xuất kho → In mẫu → Sản xuất → Giao hàng (đơn không in thì bỏ In mẫu / Sản xuất).
 * Bước tự xong theo chứng từ / công việc; Manager bấm "Xong" ở một bước (xong luôn các bước trước) hoặc "Hoàn thành tất cả".
 */
function renderProgress(d) {
  const box = $('#order-progress'), p = d.progress;
  box.hidden = !p; if (!p) return;
  const cancelled = d.order.status === 'cancelled', canMark = isManager() && !cancelled;
  const by = s => s.by === 'auto' ? 'Tự động theo chứng từ' : s.by === 'task' ? `Hoàn thành việc${s.byName ? ' · ' + s.byName : ''}` : s.by === 'manual' ? `Manager đánh dấu${s.byName ? ' · ' + s.byName : ''}` : '';
  box.innerHTML = `<div class="card-title-row"><h2 class="card-title">Tiến trình sản phẩm</h2>
      <span class="pill ${cancelled ? 'muted' : p.done ? 'ok' : 'info'}">${esc(p.label)}</span>
      ${canMark && !p.done ? '<button type="button" class="btn secondary small" data-progress="all" title="Đánh dấu xong tất cả các bước (chỉ tiến trình – không đổi giao hàng, công nợ)">✓ Hoàn thành tất cả</button>' : ''}</div>
    <ol class="progress-steps">${p.stages.map((s, i) => `<li class="${s.done ? 'done' : s.key === p.current ? 'current' : ''}">
      <span class="dot" aria-hidden="true">${s.done ? '✓' : i + 1}</span><b>${esc(s.label)}</b>
      <small>${s.done ? esc(by(s)) + (s.at ? ' · ' + fmtDate(s.at.slice(0, 10)) : '') : s.key === p.current ? 'Đang ở bước này' : 'Chưa tới'}</small>
      ${canMark && !s.done ? `<button type="button" class="link-btn" data-progress="${esc(s.key)}" title="Đánh dấu xong bước này và các bước trước">Xong</button>` : ''}
      ${canMark && s.by === 'manual' ? `<button type="button" class="link-btn muted" data-progress-undo="${esc(s.key)}" title="Bỏ đánh dấu tay ở bước này và các bước sau">Bỏ</button>` : ''}
    </li>`).join('')}</ol>
    ${p.printing ? '' : '<p class="muted small">Đơn không có phí in nên không có bước In mẫu / Sản xuất.</p>'}`;
}
$('#order-progress').addEventListener('click', async e => {
  const b = e.target.closest('[data-progress], [data-progress-undo]'); if (!b || !sales.order) return;
  const undo = b.dataset.progressUndo, stage = undo || b.dataset.progress;
  if (stage === 'all' && !await confirmBox('Đánh dấu xong tất cả các bước tiến trình? Chỉ là tiến trình theo dõi – không đổi lịch giao, công nợ, hoá đơn.', { title: 'Hoàn thành tất cả', ok: 'Hoàn thành' })) return;
  b.disabled = true;
  try {
    const r = await api(`/orders/${encodeURIComponent(sales.order.id)}/progress`, 'POST', { stage, done: !undo });
    sales.detail.progress = r.progress; renderProgress(sales.detail); toast(undo ? 'Đã bỏ đánh dấu.' : 'Đã cập nhật tiến trình.');
  } catch (ex) { toast(ex.message, 'err'); b.disabled = false; }
});
/** Ô Hoá đơn của đơn: yêu cầu xuất (tự động khi giao xong / nhân viên bấm) → nhóm Kế toán nhập số hoá đơn. */
function renderInvoice(o) {
  const st = o.status === 'cancelled' ? null : o.invoiceStatus || 'none', at = v => v ? new Date(v).toLocaleString('vi-VN') : '';
  $('#order-invoice-pill').innerHTML = st ? pill(INVOICE_STATUS, st) : '';
  const form = (label) => o.canIssueInvoice ? `<form class="invoice-form" id="invoice-form"${st === 'issued' ? ' hidden' : ''}>
      <label>Số hoá đơn<input name="invoiceNo" required maxlength="200" value="${esc(o.invoiceNo || '')}" placeholder="Ví dụ: 0000123" autocomplete="off"></label>
      <label>Ngày hoá đơn<input type="date" name="invoiceDate" value="${esc(o.invoiceDate || todayIso())}"></label>
      <button class="btn primary small">${label}</button></form>` : '';
  const requested = o.invoiceRequestedAt ? `<dt>Yêu cầu</dt><dd>${o.invoiceRequestedBy ? esc(o.invoiceRequestedByName) : 'Tự động khi giao xong'} · ${at(o.invoiceRequestedAt)}${o.invoiceRequestNote ? `<small>${esc(o.invoiceRequestNote)}</small>` : ''}</dd>
    <dt>Cách xuất</dt><dd>${o.invoiceMode === 'draft' ? '<span class="pill warn">Gửi bản nháp</span>' : '<span class="pill info">Phát hành</span>'}</dd>
    <dt>Email nhận</dt><dd>${o.invoiceEmail ? esc(o.invoiceEmail) : '<span class="muted">Chưa có</span>'}</dd>` : '';
  $('#order-invoice').innerHTML = !st ? '<p class="muted">Đơn đã huỷ.</p>'
    : st === 'issued' ? `<dl class="kv"><dt>Số hoá đơn</dt><dd><b>${esc(o.invoiceNo)}</b></dd><dt>Ngày hoá đơn</dt><dd>${fmtDate(o.invoiceDate) || '—'}</dd>
        <dt>Người nhập</dt><dd>${esc(o.invoiceIssuedByName || '—')} · ${at(o.invoiceIssuedAt)}</dd>${requested}</dl>
        ${o.canIssueInvoice ? '<button type="button" class="btn ghost small" id="invoice-edit">Sửa số hoá đơn</button>' : ''}${form('Lưu số hoá đơn')}`
    : st === 'requested' ? `<dl class="kv">${requested}</dl><p class="muted small">Đã tạo việc "Xuất hoá đơn" cho nhóm Kế toán. Sau khi xuất, Kế toán hoặc nhân viên phụ trách nhập số hoá đơn vào đây.</p>
       <button type="button" class="btn ghost small" id="invoice-request" title="Đổi email nhận, cách xuất hoặc ghi chú">Sửa yêu cầu</button>${form('Đã xuất – lưu số hoá đơn')}`
    : `<p class="muted">Chưa yêu cầu xuất hoá đơn. Khi đơn giao xong, hệ thống tự yêu cầu và giao việc cho nhóm Kế toán.</p>
       ${o.status === 'draft' ? '' : '<button type="button" class="btn secondary small" id="invoice-request" title="Tạo việc Xuất hoá đơn cho nhóm Kế toán">🧾 Yêu cầu xuất hoá đơn</button>' + form('Lưu số hoá đơn')}`;
}
document.addEventListener('click', async e => {
  if (e.target.id === 'invoice-edit') { const f = document.getElementById('invoice-form'); f.hidden = false; e.target.hidden = true; f.invoiceNo.focus(); return; }
  if (e.target.id !== 'invoice-request') return;
  // Hộp yêu cầu xuất hoá đơn của app: email nhận (mặc định email trên đơn / của khách, sửa được), cách xuất, ghi chú.
  const o = sales.order, f = $('#invoice-req-form');
  $('#invoice-req-order').textContent = `${docNo()} · ${o.customerName}`; $('#invoice-req-error').textContent = '';
  f.email.value = o.invoiceEmail || o.email || o.customerEmail || '';
  $('#invoice-req-email-hint').textContent = f.email.value ? 'Lấy từ thông tin khách hàng – sửa lại nếu khách muốn nhận ở email khác.' : 'Khách chưa có email – nhập email nhận hoá đơn.';
  f.note.value = o.invoiceStatus === 'requested' ? o.invoiceRequestNote || '' : '';
  f.querySelector(`[name=mode][value="${o.invoiceMode === 'draft' && o.invoiceStatus === 'requested' ? 'draft' : 'issue'}"]`).checked = true;
  $('#invoice-req-save').textContent = o.invoiceStatus === 'requested' ? 'Lưu thay đổi' : 'Gửi yêu cầu cho kế toán';
  $('#invoice-req-dialog').showModal(); f.email.focus();
});
$('#invoice-req-form').addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target, btn = $('#invoice-req-save'), email = f.email.value.trim();
  const bad = email.split(/[,;\s]+/).filter(Boolean).find(x => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x));
  if (bad) { $('#invoice-req-error').textContent = `Email "${bad}" chưa đúng.`; f.email.focus(); return; }
  if (!email && !confirm('Chưa có email nhận hoá đơn. Vẫn gửi yêu cầu?')) return;
  btn.disabled = true;
  try {
    const r = await api(`/orders/${encodeURIComponent(sales.order.id)}/invoice-request`, 'POST', { email, note: f.note.value, mode: f.mode.value });
    $('#invoice-req-dialog').close(); toast(r.updated ? 'Đã cập nhật yêu cầu xuất hoá đơn.' : 'Đã yêu cầu xuất hoá đơn – nhóm Kế toán nhận việc.'); openOrder(sales.order.id); tasksView().badge();
  } catch (ex) { $('#invoice-req-error').textContent = ex.message; } finally { btn.disabled = false; }
});
document.addEventListener('submit', async e => {
  if (e.target.id !== 'invoice-form') return;
  e.preventDefault();
  const f = e.target, btn = f.querySelector('button'); btn.disabled = true;
  try { await api(`/orders/${encodeURIComponent(sales.order.id)}/invoice`, 'PUT', { invoiceNo: f.invoiceNo.value, invoiceDate: f.invoiceDate.value }); toast('Đã lưu số hoá đơn.'); openOrder(sales.order.id); tasksView().badge(); }
  catch (ex) { toast(ex.message, 'err'); btn.disabled = false; }
});
// ----- Phiếu đóng gói: "📦 Yêu cầu đóng gói" chia số lượng theo nguồn hàng → mỗi nguồn một phiếu → gửi kho → kho xác nhận kèm 1–3 ảnh.
const PACK_SOURCES = { warehouse: 'Kho', store: 'Điều chuyển từ cửa hàng', supplier: 'Nhập từ NCC', agent: 'Lấy từ đại lý', other: 'Nguồn khác' };
const PACK_STATUS = { draft: ['Nháp – chưa gửi kho', 'warn'], sent: ['Đã gửi kho', 'info'], packed: ['Kho đã đóng ✓', 'ok'], cancelled: ['Đã huỷ', 'muted'] };
const kg = v => v === null || v === undefined ? '' : `~${fmtNum(v)} kg`;
const packing = { lines: [], orderId: '', hasSchedule: false };
const packingSupplierChoices = initPackingSupplierChoices($('#pack-form'));
const packingEarlyRequest = initPackingEarlyRequest({ root: $('#pack-form'), api, lines: () => packing.lines, parseNum, toast,
  canRequest: () => can('page.purchases') && (isManager() || state.user?.positionId === 'sale-admin') });
async function loadOrderPacking(orderId) {
  const box = $('#order-packing'); box.innerHTML = '';
  let d; try { d = await api(`/orders/${encodeURIComponent(orderId)}/packing`); } catch { return; }
  if (sales.order?.id !== orderId) return;
  packing.lines = d.lines; packing.orderId = orderId;
  const live = d.slips.filter(x => x.status !== 'cancelled'), drafts = live.filter(x => x.status === 'draft');
  if (!live.length) return;
  box.innerHTML = `<div class="pack-slips"><div class="card-title-row"><b>Phiếu đóng gói</b>${drafts.length > 1 ? `<button type="button" class="btn primary small" data-slip-send-all>Gửi kho ${drafts.length} phiếu nháp</button>` : ''}</div>
    <ul class="plain-list">${live.map(x => `<li><span><a href="#/packing/${esc(x.id)}"><b>${esc(x.slipNo)}</b></a> · ${esc(x.sourceLabel)}${x.sourceNote ? ': ' + esc(x.sourceNote) : ''}
      <small>${x.lines.map(l => `${esc(l.name)}: ${fmtNum(l.qty)} ${esc(l.unit)}`).join(' · ')}${x.totalWeight ? ' · ' + kg(x.totalWeight) : ''}${x.photoCount ? ` · ${x.photoCount} ảnh` : ''}</small>
      <small>${shipText(x)}</small></span>
      <span class="row-gap">${pill(PACK_STATUS, x.status)}${x.status === 'draft' ? `<button type="button" class="btn secondary small" data-slip-send="${esc(x.id)}">Gửi kho</button>` : ''}${x.status === 'draft' || x.status === 'sent' ? `<button type="button" class="btn ghost small" data-slip-cancel="${esc(x.id)}">Huỷ</button>` : ''}</span></li>`).join('')}</ul></div>`;
}
/** Giao tới + gửi xe của phiếu đóng gói (một dòng). */
const shipText = k => `${k.shipTo === 'workshop' ? '🖨️ Giao về xưởng in: ' + esc(k.shipName) : '🏠 Giao thẳng cho khách'}${k.carrierName ? ` · 🚚 Gửi xe ${esc(k.carrierName)}${k.carrierPhone ? ' (' + esc(k.carrierPhone) + ')' : ''}` : ''}`;
/** Một dòng nguồn khác kho (cửa hàng / NCC / đại lý…) trong hộp yêu cầu đóng gói. */
const packSourceRow = (qty = '') => `<div class="pack-src"><select data-src aria-label="Nguồn hàng">${Object.entries(PACK_SOURCES).filter(([k]) => k !== 'warehouse').map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}<option value="incoming">Hàng đang chờ về</option></select>
  <input data-src-note maxlength="200" placeholder="Tên cửa hàng / NCC / đại lý" aria-label="Lấy từ đâu"><input class="num-input" inputmode="decimal" data-src-qty value="${qty === '' ? '' : fmtNum(qty)}" placeholder="SL" aria-label="Số lượng">
  <button type="button" class="icon-btn danger" data-src-del title="Bỏ nguồn này" aria-label="Bỏ nguồn này">×</button></div>`;
$('#order-pack').addEventListener('click', async () => {
  const o = sales.order; if (!o) return;
  const btn = $('#order-pack'); btn.disabled = true;
  try {
    const d = await api(`/orders/${encodeURIComponent(o.id)}/packing`); packing.lines = d.lines;
    if (!d.canRequest) return toast('Đơn chưa xác nhận, đã huỷ hoặc đã giao xong.', 'err');
    const todo = d.lines.filter(l => l.left > 1e-9);
    if (!todo.length) return toast('Mọi dòng hàng đã có phiếu đóng gói. Huỷ phiếu cũ nếu cần lập lại.', 'err');
    // Tồn khả dụng của kho (như trang Khách hỏi tồn): mặc định lấy từ kho tối đa bằng tồn, phần thiếu bắt buộc nhập nguồn khác.
    const skus = [...new Set(todo.map(l => l.sku).filter(Boolean))], stock = new Map();
    try { for (let i = 0; i < skus.length; i += 200) { const r = await api('/products?skus=' + encodeURIComponent(skus.slice(i, i + 200).join(','))); applyCatalogMeta(r); for (const p of r.products) stock.set(p.sku, p); } } catch { /* không có số liệu tồn: để kho = đủ */ }
    $('#pack-order').textContent = `${docNo()} · ${o.customerName}`; $('#pack-error').textContent = ''; $('#pack-form').note.value = '';
    // Đơn CRM đã trừ kho bán lúc duyệt: số dư kho bán đã trừ phần của chính đơn → cộng lại phần chưa đóng gói, chỉ tính kho bán.
    const soldWh = d.soldWarehouseId || '', ownLeft = new Map();
    for (const l of todo) if (l.sku) ownLeft.set(l.sku, (ownLeft.get(l.sku) || 0) + l.left);
    const packAv = p => soldWh ? Math.max(0, (Number(p.stock?.[soldWh]) || 0) + (ownLeft.get(p.sku) || 0)) : Math.max(0, availableStock(p));
    $('#pack-lines').innerHTML = todo.map(l => {
      const p = l.sku ? stock.get(l.sku) : null, av = p ? packAv(p) : null, fromStock = av === null ? l.left : Math.min(l.left, av), short = l.left - fromStock;
      return `<div class="pack-line" data-line="${esc(l.id)}" data-av="${av ?? ''}">
        <div class="pack-head"><b>${esc(l.name)}</b><small>${esc(l.sku || 'Chưa có mã')} · ${esc(l.unit || '')} · đơn ${fmtNum(l.qty)}${l.packed ? ` · đã có phiếu ${fmtNum(l.packed)}` : ''}</small></div>
        <div class="pack-grid"><label>Cần đóng<input class="num-input" inputmode="decimal" data-need value="${fmtNum(l.left)}"></label>
          <label>${soldWh ? `<span title="Tồn ${esc(o.warehouseName || 'kho bán')} + phần đơn này đã trừ lúc duyệt mà chưa đóng gói">Tồn kho bán</span>` : 'Tồn kho'}<span class="pack-av ${av !== null && av < l.left ? 'danger-text' : ''}">${av === null ? '—' : fmtNum(av)}</span></label>
          <label>Lấy từ kho<input class="num-input" inputmode="decimal" data-wh value="${fmtNum(fromStock)}"></label></div>
        <p class="pack-warn" ${short > 1e-9 ? '' : 'hidden'}>⚠️ Kho không đủ – nhập phần còn lại lấy từ đâu.</p>
        <div data-srcs>${short > 1e-9 ? packSourceRow(short) : ''}</div>
        <button type="button" class="btn ghost small" data-src-add>＋ Thêm nguồn hàng</button></div>`;
    }).join('');
    packingSupplierChoices.setSuppliers(d.supplierChoices || []);
    fillPackShip(d.delivery); fillPackSchedule(d.schedules || [], o);
    $('#pack-dialog').showModal();
  } catch (ex) { toast(ex.message, 'err'); } finally { btn.disabled = false; }
});
/** A single save can schedule the selected quantities and create the packing slips. */
function fillPackSchedule(schedules, order) {
  const f = $('#pack-form'); packing.hasSchedule = schedules.length > 0;
  f.createSchedule.checked = !packing.hasSchedule; f.createSchedule.disabled = !packing.hasSchedule;
  f.plannedDate.value = order.expectedDeliveryDate || todayIso(); f.timeSlot.value = ''; f.receiverName.value = orderRecipient(order).receiverName;
  $('#pack-existing-schedule').textContent = packing.hasSchedule
    ? 'Dùng lịch đã có: ' + schedules.map(x => `${x.deliveryNo} · ${fmtDate(x.plannedDate)}`).join('; ') + '. Chọn tạo lịch mới chỉ khi đây là chuyến giao khác.'
    : 'Chưa có lịch giao. Ngày giao và số lượng sẽ được lưu cùng phiếu đóng gói.';
  showPackSchedule();
}
function showPackSchedule() {
  const f = $('#pack-form');
  for (const input of $('#pack-schedule-fields').querySelectorAll('input')) input.disabled = !f.createSchedule.checked;
}
/** Phần "Giao hàng" của hộp đóng gói: có phí in → mặc định về xưởng in; chọn xưởng / nhà xe trong danh sách tự điền địa chỉ, SĐT. */
let packShip = { workshops: [], carriers: [] };
function fillPackShip(dv = {}) {
  const f = $('#pack-form'); packShip = { workshops: dv.workshops || [], carriers: dv.carriers || [] };
  const opts = list => list.map(x => `<option value="${esc(x.name)}">${esc([x.phone, x.address].filter(Boolean).join(' · '))}</option>`).join('');
  $('#pack-ws-list').innerHTML = opts(packShip.workshops); $('#pack-carrier-list').innerHTML = opts(packShip.carriers);
  for (const k of ['wsName', 'wsPhone', 'wsAddress', 'carrierName', 'carrierPhone']) f[k].value = '';
  f.custAddress.value = dv.customer?.address || ''; f.custPhone.value = dv.customer?.phone || '';
  f.querySelector(`[name=shipTo][value=${dv.hasPrintFee ? 'workshop' : 'customer'}]`).checked = true;
  $('#pack-ship-hint').textContent = dv.hasPrintFee ? 'Đơn có phí in logo: mặc định giao về xưởng in để in trước khi giao khách.' : 'Đơn không có phí in: giao thẳng cho khách theo địa chỉ giao hàng.';
  showPackShip();
}
function showPackShip() {
  const to = $('#pack-form').querySelector('[name=shipTo]:checked')?.value || 'customer';
  $$('[data-ship]', $('#pack-form')).forEach(el => el.hidden = el.dataset.ship !== to);
}
function readPackShip() {
  const f = $('#pack-form'), to = f.querySelector('[name=shipTo]:checked')?.value || 'customer';
  const ship = to === 'workshop' ? { to, name: f.wsName.value.trim(), address: f.wsAddress.value.trim(), phone: f.wsPhone.value.trim() }
    : { to, address: f.custAddress.value.trim(), phone: f.custPhone.value.trim() };
  if (to === 'workshop' && !ship.name) throw new Error('Chọn hoặc gõ tên xưởng in nhận hàng.');
  return { ...ship, carrierName: f.carrierName.value.trim(), carrierPhone: f.carrierPhone.value.trim() };
}
$('#pack-form').addEventListener('change', e => { if (e.target.name === 'shipTo') showPackShip(); if (e.target.name === 'createSchedule') showPackSchedule(); });
$('#pack-form').addEventListener('input', e => {
  const f = $('#pack-form'), pick = (list, v) => list.find(x => normalize(x.name) === normalize(v));
  if (e.target.name === 'wsName') { const w = pick(packShip.workshops, e.target.value); if (w) { f.wsAddress.value = w.address || f.wsAddress.value; f.wsPhone.value = w.phone || f.wsPhone.value; } }
  if (e.target.name === 'carrierName') { const c = pick(packShip.carriers, e.target.value); if (c) f.carrierPhone.value = c.phone || f.carrierPhone.value; }
});
/** Kiểm tra từng dòng: kho + các nguồn khác = số cần đóng; nguồn khác phải ghi rõ. Trả về danh sách phân bổ hoặc ném lỗi. */
function readPackForm() {
  if (packingEarlyRequest.isBusy()) throw new Error('Đang lưu phiếu xin lấy trước. Vui lòng chờ.');
  const out = [];
  for (const row of $$('.pack-line', $('#pack-lines'))) {
    const line = packing.lines.find(l => l.id === row.dataset.line), name = line?.name || '';
    const need = parseNum(row.querySelector('[data-need]').value || '0'), wh = parseNum(row.querySelector('[data-wh]').value || '0');
    if (need < 0 || wh < 0) throw new Error(`Số lượng của "${name}" không hợp lệ.`);
    if (need > line.left + 1e-9) throw new Error(`"${name}" chỉ còn ${fmtNum(line.left)} chưa đóng gói.`);
    if (need <= 0) continue;
    const av = row.dataset.av === '' ? null : Number(row.dataset.av);
    if (av !== null && wh > av + 1e-9 && !confirm(`"${name}": lấy từ kho ${fmtNum(wh)} nhưng tồn kho chỉ ${fmtNum(av)}. Vẫn lưu?`)) throw new Error('Sửa lại số lấy từ kho.');
    const srcs = $$('.pack-src', row).map(r => ({ source: r.querySelector('[data-src]').value, sourceNote: r.querySelector('[data-src-note]').value.trim(), qty: parseNum(r.querySelector('[data-src-qty]').value || '0') })).filter(x => x.qty > 0);
    if (srcs.some(x => x.source === 'incoming')) throw new Error(`"${name}": bấm "Xin giao trước" để lưu phiếu nháp. Khi hàng đã sẵn sàng, chọn lại nguồn thực tế trước khi gửi kho đóng gói.`);
    const total = wh + srcs.reduce((t, x) => t + x.qty, 0);
    if (Math.abs(total - need) > 1e-9) throw new Error(`"${name}": kho ${fmtNum(wh)} + nguồn khác ${fmtNum(total - wh)} = ${fmtNum(total)}, chưa khớp số cần đóng ${fmtNum(need)}.`);
    const missing = srcs.find(x => !x.sourceNote); if (missing) throw new Error(`"${name}": ghi rõ ${PACK_SOURCES[missing.source].toLowerCase()} nào.`);
    if (wh > 0) out.push({ orderLineId: line.id, qty: wh, source: 'warehouse' });
    for (const x of srcs) out.push({ orderLineId: line.id, ...x });
  }
  if (!out.length) throw new Error('Chưa có dòng hàng nào để đóng gói.');
  return out;
}
$('#pack-lines').addEventListener('click', e => {
  const row = e.target.closest('.pack-line'); if (!row) return;
  if (e.target.closest('[data-src-add]')) { row.querySelector('[data-srcs]').insertAdjacentHTML('beforeend', packSourceRow()); row.querySelector('.pack-src:last-child [data-src-note]').focus(); }
  if (e.target.closest('[data-src-del]')) e.target.closest('.pack-src').remove();
});
$('#pack-lines').addEventListener('input', e => {
  // Đổi số cần đóng / lấy từ kho → cảnh báo khi kho không đủ.
  const row = e.target.closest('.pack-line'); if (!row || !e.target.matches('[data-need], [data-wh]')) return;
  const need = parseNum(row.querySelector('[data-need]').value || '0'), wh = parseNum(row.querySelector('[data-wh]').value || '0');
  row.querySelector('.pack-warn').hidden = !(wh < need - 1e-9);
  // Kho thiếu mà chưa có dòng nguồn khác → thêm sẵn một dòng với phần còn lại.
  if (wh < need - 1e-9 && !row.querySelector('.pack-src')) row.querySelector('[data-srcs]').insertAdjacentHTML('beforeend', packSourceRow(need - wh));
});
$('#pack-form').addEventListener('submit', async e => {
  e.preventDefault();
  let allocations, delivery; try { allocations = readPackForm(); delivery = readPackShip(); } catch (ex) { $('#pack-error').textContent = ex.message; return; }
  const btn = $('#pack-save'); btn.disabled = true;
  try {
    const f = $('#pack-form'), order = sales.order;
    const groups = new Set(allocations.map(x => `${x.source}\u0000${(x.sourceNote || '').trim().toLowerCase()}`));
    const schedule = f.createSchedule.checked ? { plannedDate: f.plannedDate.value, timeSlot: f.timeSlot.value,
      receiverName: f.receiverName.value, receiverPhone: delivery.to === 'customer' ? delivery.phone : orderRecipient(order).receiverPhone,
      address: delivery.to === 'customer' ? delivery.address : order.address,
      carrier: delivery.to === 'customer' ? delivery.carrierName : '', note: f.note.value } : undefined;
    const r = await api(`/orders/${encodeURIComponent(order.id)}/packing`, 'POST', { allocations, delivery, schedule, sendToWarehouse: groups.size === 1, note: f.note.value });
    $('#pack-dialog').close();
    toast(r.sentToWarehouse ? 'Đã lưu và gửi phiếu cho kho đóng hàng.' : `Đã lưu ${r.slips.length} phiếu nháp. Kiểm tra nguồn hàng rồi bấm "Gửi kho".`);
    openOrder(order.id);
  } catch (ex) { $('#pack-error').textContent = ex.message; } finally { btn.disabled = false; }
});
async function sendSlip(id) { await api(`/packing/${encodeURIComponent(id)}/send`, 'POST', {}); }
document.addEventListener('click', async e => {
  const send = e.target.closest('[data-slip-send]'), all = e.target.closest('[data-slip-send-all]'), cancel = e.target.closest('[data-slip-cancel]');
  if (!send && !all && !cancel) return;
  const b = send || all || cancel; b.disabled = true;
  try {
    if (cancel) { if (!await confirmBox('Huỷ phiếu đóng gói này? Số lượng trả lại để lập phiếu khác.', { ok: 'Huỷ phiếu', danger: true })) return; await api(`/packing/${encodeURIComponent(cancel.dataset.slipCancel)}/cancel`, 'POST', {}); toast('Đã huỷ phiếu.'); }
    else if (send) { await sendSlip(send.dataset.slipSend); toast('Đã gửi kho – nhóm Kho nhận việc đóng gói.'); }
    else { const ids = $$('[data-slip-send]').map(x => x.dataset.slipSend); for (const id of ids) await sendSlip(id); toast(`Đã gửi kho ${ids.length} phiếu.`); }
    if (location.hash.startsWith('#/packing/')) openPacking(location.hash.slice(10)); else if (sales.order) loadOrderPacking(sales.order.id);
  } catch (ex) { toast(ex.message, 'err'); } finally { b.disabled = false; }
});
const PACKING_FILTER_KEY = 'packingFilter';
const packingFilter = () => { try { return localStorage.getItem(PACKING_FILTER_KEY) === 'packed' ? 'packed' : 'sent'; } catch { return 'sent'; } };
$('#packing-body').addEventListener('click', e => {
  const b = e.target.closest('[data-packing-filter]'); if (!b) return;
  try { localStorage.setItem(PACKING_FILTER_KEY, b.dataset.packingFilter); } catch { /* bỏ qua */ }
  openPacking(null);
});
/** Trang phiếu đóng gói (#/packing/<id>): kho xem hàng cần đóng, quy cách gợi ý, cân nặng; xác nhận kèm 1–3 ảnh. Không id: danh sách phiếu chờ đóng. */
const slipPhotos = [];
let packingView = null; // phiếu đang mở ở #/packing/<id> (cho nút in)
async function openPacking(id) {
  const body = $('#packing-body'); body.innerHTML = '<p class="muted card">Đang tải…</p>'; $('#packing-actions').innerHTML = ''; $('#packing-status').innerHTML = '';
  if (!id) {
    // Bộ lọc: Chưa đóng (đã gửi kho, chờ đóng) · Đã đóng. Nhớ lựa chọn trên máy.
    const filter = packingFilter();
    $('#packing-title').textContent = filter === 'packed' ? 'Phiếu đã đóng gói' : 'Phiếu chờ đóng gói'; $('#packing-back').href = isWarehouse() ? KHO_HOME : '#/tasks'; $('#packing-back').textContent = isWarehouse() ? '‹ Trang kho' : '‹ Công việc';
    const chips = `<div class="chips packing-filter" role="tablist">${[['sent', 'Chưa đóng'], ['packed', 'Đã đóng']].map(([k, t]) =>
      `<button type="button" class="chip ${k === filter ? 'active' : ''}" data-packing-filter="${k}" aria-selected="${k === filter}">${t}</button>`).join('')}</div>`;
    body.innerHTML = chips + '<p class="muted card">Đang tải…</p>';
    try {
      const { slips } = await api('/packing?status=' + filter);
      if (packingFilter() !== filter) return;
      body.innerHTML = chips + (slips.length ? `<div class="card"><ul class="plain-list">${slips.map(x => `<li><span><a href="#/packing/${esc(x.id)}"><b>${esc(x.slipNo)}</b></a> · ${esc(x.customerName)}<small>${esc(x.contractNo ? 'HĐKT ' + x.contractNo : x.orderNo)} · ${esc(x.sourceLabel)}${x.sourceNote ? ': ' + esc(x.sourceNote) : ''}${x.expectedDeliveryDate ? ' · giao ' + fmtDate(x.expectedDeliveryDate) : ''}${filter === 'packed' && x.packedAt ? ' · đóng ' + new Date(x.packedAt).toLocaleDateString('vi-VN') : ''}${x.packedNote ? ' · ' + esc(x.packedNote) : ''}</small></span>${kg(x.totalWeight)}</li>`).join('')}</ul></div>`
        : `<p class="muted card">${filter === 'packed' ? 'Chưa có phiếu nào đã đóng.' : 'Không có phiếu nào chờ đóng gói.'}</p>`);
    } catch (e) { body.innerHTML = chips + `<p class="error card">${esc(e.message)}</p>`; }
    return;
  }
  let d; try { d = await api('/packing/' + encodeURIComponent(id)); } catch (e) { body.innerHTML = `<p class="error card">${esc(e.message)}</p>`; return; }
  const k = d.slip, o = d.order; slipPhotos.length = 0;
  $('#packing-title').textContent = k.slipNo; $('#breadcrumb').textContent = k.slipNo; document.title = k.slipNo + ' · Bách Ngân';
  $('#packing-status').innerHTML = pill(PACK_STATUS, k.status);
  $('#packing-back').href = d.canOpenOrder ? docHref(o.id, o.contractNo) : isWarehouse() ? '#/packing' : '#/tasks'; $('#packing-back').textContent = d.canOpenOrder ? (o.contractNo ? '‹ HĐKT' : '‹ Đơn hàng') : isWarehouse() ? '‹ Phiếu đóng gói' : '‹ Công việc';
  packingView = d;
  $('#packing-actions').innerHTML = '<button class="btn secondary" data-slip-print="packing">In phiếu đóng gói</button><button class="btn secondary" data-slip-print="delivery">In phiếu giao hàng</button>' + (d.canSend ? `<button class="btn primary" data-slip-send="${esc(k.id)}">Gửi kho</button>` : '') + (d.canCancel ? `<button class="btn ghost" data-slip-cancel="${esc(k.id)}">Huỷ phiếu</button>` : '');
  const at = v => v ? new Date(v).toLocaleString('vi-VN') : '';
  body.innerHTML = `<div class="editor-grid">
    <div class="card"><h2 class="card-title">${k.shipTo === 'workshop' ? '🖨️ Giao về xưởng in' : '🏠 Giao thẳng cho khách'}</h2><dl class="kv"><dt>Khách hàng</dt><dd><b>${esc(o.customerName)}</b></dd><dt>${orderReference(o).label}</dt><dd>${esc(orderReference(o).number)}</dd>
      ${k.shipTo === 'workshop' ? `<dt>Xưởng in</dt><dd><b>${esc(k.shipName)}</b></dd>${k.shipPhone ? `<dt>SĐT xưởng</dt><dd>${esc(k.shipPhone)}</dd>` : ''}${k.shipAddress ? `<dt>Địa chỉ xưởng</dt><dd>${esc(k.shipAddress)}</dd>` : ''}`
        : `${k.shipPhone || o.contact || o.phone ? `<dt>Người nhận</dt><dd>${esc(k.shipPhone || [o.contact, o.phone].filter(Boolean).join(' · '))}</dd>` : ''}${k.shipAddress || o.address ? `<dt>Địa chỉ</dt><dd>${esc(k.shipAddress || o.address)}</dd>` : ''}`}
      ${k.carrierName ? `<dt>Gửi xe</dt><dd><b>${esc(k.carrierName)}</b>${k.carrierPhone ? ` · <a href="tel:${esc(k.carrierPhone.replace(/[^\d+]/g, ''))}">${esc(k.carrierPhone)}</a>` : ''}</dd>` : ''}
      <dt>Giao dự kiến</dt><dd>${o.expectedDeliveryDate ? duePill(o.expectedDeliveryDate, { done: k.status === 'packed', fmt: fmtDate }) : '—'}</dd></dl></div>
    <div class="card"><h2 class="card-title">Phiếu</h2><dl class="kv"><dt>Nguồn hàng</dt><dd><b>${esc(k.sourceLabel)}</b>${k.sourceNote ? ': ' + esc(k.sourceNote) : ''}</dd>
      <dt>Lập</dt><dd>${esc(k.createdByName)} · ${at(k.createdAt)}</dd>${k.sentAt ? `<dt>Gửi kho</dt><dd>${esc(k.sentByName)} · ${at(k.sentAt)}</dd>` : ''}
      ${k.packedAt ? `<dt>Kho đóng</dt><dd>${esc(k.packedByName)} · ${at(k.packedAt)}${k.packedNote ? `<small>${esc(k.packedNote)}</small>` : ''}</dd>` : ''}
      ${k.note ? `<dt>Ghi chú</dt><dd>${esc(k.note)}</dd>` : ''}</dl></div></div>
    <div class="card"><h2 class="card-title">${d.canConfirm ? '<span class="step-no">1</span> Lấy hàng – tick từng món đã lấy đủ' : 'Hàng cần đóng'}</h2><div class="table-wrap"><table class="data-table${d.canConfirm ? ' pick-table' : ''}"><thead><tr>${d.canConfirm ? '<th class="pick-col"><span class="sr-only">Đã lấy</span></th>' : ''}<th>Sản phẩm</th><th class="right">SL</th><th>Quy cách gợi ý</th><th class="right">Cân nặng</th></tr></thead><tbody>
      ${d.lines.map((l, i) => `<tr${d.canConfirm ? ` class="pick-row" data-pick-row="${i}"` : ''}>${d.canConfirm ? `<td class="pick-col"><input type="checkbox" class="pick-tick" data-pick="${i}" aria-label="Đã lấy ${esc(l.name)}"></td>` : ''}<td>${esc(l.name)}<small>${esc(l.sku || '')}</small></td><td class="right"><b class="pick-qty">${fmtNum(l.qty)}</b> ${esc(l.unit)}</td>
        <td>${l.suggestion ? esc(l.suggestion) : '<span class="muted">Chưa có quy cách thùng</span>'}${l.cartonSize ? `<small>Thùng ${esc(l.cartonSize)}${l.cartonWeight ? ' · ' + fmtNum(l.cartonWeight) + ' kg/thùng' : ''}</small>` : ''}</td>
        <td class="right">${l.weight ? kg(l.weight) : '—'}</td></tr>`).join('')}
      <tr>${d.canConfirm ? '<td class="pick-col"></td>' : ''}<td><b>Tổng</b></td><td class="right"><b>${fmtNum(k.totalQty)}</b></td><td></td><td class="right"><b>${k.totalWeight ? kg(k.totalWeight) : '—'}</b></td></tr></tbody></table></div>
      ${d.canConfirm ? `<p class="pick-progress" id="pick-progress"></p>` : ''}</div>
    ${d.photos.length ? `<div class="card"><h2 class="card-title">Ảnh hàng đã đóng</h2><div class="pack-photos">${d.photos.map(p => `<img src="${esc(p.dataUrl)}" alt="Ảnh hàng đã đóng" loading="lazy">`).join('')}</div></div>` : ''}
    ${d.canConfirm ? `<div class="card pack-steps">
      <h2 class="card-title"><span class="step-no">2</span> Chụp ảnh hàng đã đóng</h2>
      <p class="muted small">Chụp 1–3 ảnh (ảnh tự nén nhỏ để không đầy bộ nhớ).</p>
      <label class="btn secondary big-btn pick-photo">📷 Chụp / chọn ảnh<input type="file" id="slip-photo-input" accept="image/*" capture="environment" multiple hidden></label>
      <div class="pack-photos" id="slip-photo-preview"></div>
      ${k.source === 'warehouse' ? '<h2 class="card-title"><span class="step-no">3</span> Chọn kho xuất hàng</h2><label class="sr-only" for="slip-confirm-wh">Xuất từ kho</label><select id="slip-confirm-wh" class="big-select" required><option value="">— Chọn kho xuất —</option></select>' : ''}
      <label>Ghi chú (tuỳ chọn)<input id="slip-confirm-note" maxlength="1000" placeholder="Ví dụ: 3 thùng, đã dán tem"></label>
      <h2 class="card-title"><span class="step-no">${k.source === 'warehouse' ? 4 : 3}</span> Bấm khi đã đóng xong</h2>
      <p class="muted small" id="slip-confirm-hint"></p>
      <button class="btn primary big-btn" id="slip-confirm" disabled>✅ Đã đóng xong</button></div>` : ''}`;
  slipPicks.clear(); slipPickTotal = d.canConfirm ? d.lines.length : 0;
  try { for (const i of JSON.parse(localStorage.getItem('bn-pick-' + k.id) || '[]')) if (i < slipPickTotal) slipPicks.add(i); } catch { /* bỏ qua */ }
  $$('.pick-tick', body).forEach(c => { c.checked = slipPicks.has(Number(c.dataset.pick)); c.closest('tr').classList.toggle('picked', c.checked); });
  drawSlipGate();
  // Nguồn = Kho: chọn kho xuất → ghi phiếu xuất vào sổ kho (trial-ui/inventory.js); nhớ kho đã chọn lần trước trên máy này.
  const whSel = document.getElementById('slip-confirm-wh');
  if (whSel) stockWarehouses().then(list => {
    let last = ''; try { last = localStorage.getItem('bn-pack-wh') || ''; } catch { /* bỏ qua */ }
    for (const w of list) { const o = document.createElement('option'); o.value = w.id; o.textContent = w.name; whSel.append(o); }
    if (list.length === 1) whSel.value = list[0].id; else if (list.some(w => w.id === last)) whSel.value = last;
    drawSlipGate();
  }).catch(() => {});
}
let stockWarehouseList = null;
/** Kho thật đang dùng (GET /stock-warehouses) – dùng chung cho chọn kho xuất / kho nhận. */
function stockWarehouses() { return stockWarehouseList ||= api('/stock-warehouses').then(r => r.warehouses).catch(e => { stockWarehouseList = null; throw e; }); }
function drawSlipPhotos() {
  const box = document.getElementById('slip-photo-preview'); if (!box) return;
  box.innerHTML = slipPhotos.map((u, i) => `<span class="pack-photo"><img src="${esc(u)}" alt="Ảnh ${i + 1}"><button type="button" class="icon-btn danger" data-photo-del="${i}" aria-label="Bỏ ảnh ${i + 1}">×</button></span>`).join('');
  drawSlipGate();
}
/** Tick từng món khi lấy hàng (nhớ trên máy theo phiếu): đủ mọi món + có ảnh + đã chọn kho xuất mới bấm "Đã đóng xong" được. */
const slipPicks = new Set();
let slipPickTotal = 0;
function drawSlipGate() {
  const btn = document.getElementById('slip-confirm'); if (!btn) return;
  const whSel = document.getElementById('slip-confirm-wh'), left = slipPickTotal - slipPicks.size;
  const prog = document.getElementById('pick-progress');
  if (prog) { prog.textContent = left ? `Đã lấy ${slipPicks.size}/${slipPickTotal} món – còn ${left} món chưa tick.` : `✔ Đã lấy đủ ${slipPickTotal}/${slipPickTotal} món.`; prog.classList.toggle('done', !left); }
  const missing = [left ? `tick đủ ${left} món còn lại` : '', slipPhotos.length ? '' : 'chụp ít nhất 1 ảnh', whSel && !whSel.value ? 'chọn kho xuất' : ''].filter(Boolean);
  btn.disabled = missing.length > 0;
  document.getElementById('slip-confirm-hint').textContent = missing.length ? 'Cần ' + missing.join(', ') + '.' : 'Sẵn sàng – bấm nút dưới để báo đã đóng xong.';
}
document.addEventListener('change', e => {
  if (e.target.id === 'slip-confirm-wh') { drawSlipGate(); return; }
  const c = e.target.closest?.('.pick-tick'); if (!c) return;
  const i = Number(c.dataset.pick);
  if (c.checked) slipPicks.add(i); else slipPicks.delete(i);
  c.closest('tr').classList.toggle('picked', c.checked);
  try { localStorage.setItem('bn-pick-' + location.hash.slice(10), JSON.stringify([...slipPicks])); } catch { /* bỏ qua */ }
  drawSlipGate();
});
// Bấm cả dòng (ngón tay to) cũng tick được.
document.addEventListener('click', e => {
  const row = e.target.closest('tr[data-pick-row]'); if (!row || e.target.closest('input, a, button')) return;
  const c = row.querySelector('.pick-tick'); c.checked = !c.checked; c.dispatchEvent(new Event('change', { bubbles: true }));
});
document.addEventListener('change', async e => {
  if (e.target.id !== 'slip-photo-input') return;
  const files = [...e.target.files]; e.target.value = '';
  for (const f of files) {
    if (slipPhotos.length >= 3) { toast('Tối đa 3 ảnh.', 'err'); break; }
    try { slipPhotos.push(await compressImage(f, [[1280, .72], [1024, .68], [800, .62], [640, .6]], 450000, 'Ảnh quá lớn, chụp lại giúp.')); } catch (ex) { toast(ex.message, 'err'); }
  }
  drawSlipPhotos();
});
document.addEventListener('click', async e => {
  const del = e.target.closest('[data-photo-del]');
  if (del) { slipPhotos.splice(Number(del.dataset.photoDel), 1); drawSlipPhotos(); return; }
  if (e.target.id !== 'slip-confirm') return;
  const id = location.hash.slice(10); e.target.disabled = true;
  const whSel = document.getElementById('slip-confirm-wh');
  if (whSel && !whSel.value) { toast('Chọn kho xuất hàng.', 'err'); whSel.focus(); e.target.disabled = false; return; }
  if (whSel) try { localStorage.setItem('bn-pack-wh', whSel.value); } catch { /* bỏ qua */ }
  try { await api(`/packing/${encodeURIComponent(id)}/confirm`, 'POST', { photos: slipPhotos, note: document.getElementById('slip-confirm-note').value, ...(whSel ? { warehouseId: whSel.value } : {}) }); toast('Đã xác nhận đóng hàng.'); try { localStorage.removeItem('bn-pick-' + id); } catch { /* bỏ qua */ } tasksView().badge(); openPacking(id); }
  catch (ex) { toast(ex.message, 'err'); e.target.disabled = false; }
});
/** Kho bán của đơn CRM (trừ kho khi duyệt): nháp – người sửa được đơn đổi; đã duyệt – chỉ Manager (docs/SO-KHO.md). */
function saleWarehouseRow(o) {
  if ((o.channel || 'crm') !== 'crm') return '';
  const canChange = o.status !== 'cancelled' && (o.status === 'draft' ? o.canEdit !== false : isManager());
  return `<dt>Kho bán</dt><dd>${o.warehouseName ? esc(o.warehouseName) : '<span class="muted">Chưa chọn</span>'}${canChange ? ` <button type="button" class="btn ghost small" data-order-warehouse>Đổi kho</button>` : ''}</dd>`;
}
document.addEventListener('click', async e => {
  if (!e.target.closest?.('[data-order-warehouse]') || !sales.detail) return;
  const o = sales.detail.order;
  let wh; try { wh = await api(`/orders/${encodeURIComponent(o.id)}/warehouses`); } catch (ex) { toast(ex.message, 'err'); return; }
  if (!wh.warehouses.length) { toast('Nhân viên phụ trách chưa được gán kho bán nào. Manager gán ở trang Phân quyền › Kho bán theo chức vụ.', 'err'); return; }
  const v = await verifyBox({ title: 'Kho bán ' + docNo(sales.detail), eyebrow: 'Kho hàng sẽ trừ khi duyệt',
    intro: o.status === 'draft' ? 'Đơn nháp: chưa trừ kho. Khi duyệt sẽ trừ ở kho chọn dưới đây.' : 'Đơn đã duyệt: phần đã trừ chuyển sang kho mới.',
    rows: wh.warehouses.map(w => [esc(w.name), w.lines.map(l => `${esc(l.sku)}: cần ${fmtNum(l.need)} · tồn ${fmtNum(l.stock)}`).join('<br>') || '—']),
    fields: `<label class="verify-field"><span>Kho bán</span><select name="warehouseId">${wh.warehouses.map(w => `<option value="${esc(w.id)}" ${w.id === wh.warehouseId ? 'selected' : ''}>${esc(w.name)}</option>`).join('')}</select></label>`,
    ok: 'Lưu kho bán' });
  if (!v) return;
  try { await api(`/orders/${encodeURIComponent(o.id)}/warehouse`, 'PUT', { warehouseId: v.warehouseId }); toast('Đã đổi kho bán.'); openOrder(o.id); }
  catch (ex) { toast(ex.message, 'err'); }
});
/** Xác nhận đơn của khách: bắt buộc kiểm tra các thông tin quan trọng trước khi duyệt. */
async function verifyAndConfirmOrder() {
  const d = sales.detail, o = d.order, dash = v => v ? esc(v) : '';
  let debtWarningAccepted=false;
  try {
    const review = await api(`/orders/${encodeURIComponent(o.id)}/approval-preflight`);
    if (review.debt.total > 0) {
      debtWarningAccepted=await confirmApprovalDebt(review,isContractDoc(d)?'Vẫn duyệt HĐKT':'Vẫn duyệt đơn');
      if(!debtWarningAccepted)return;
    }
    if (!await reviewOrderCosts({review,api,isManager:isManager(),verifyBox,esc,toast})) return;
  } catch (ex) { toast(ex.message, 'err'); return; }
  const items = d.lines.map(l => `${esc(l.name)} × ${fmtNum(l.qty)} ${esc(l.unit || '')}`).join('<br>');
  // Kho bán (đơn CRM): duyệt = trừ kho này trong sổ kho. Chỉ kho người phụ trách được bán (Manager: mọi kho) – docs/SO-KHO.md.
  let wh = null;
  if ((o.channel || 'crm') === 'crm') { try { wh = await api(`/orders/${encodeURIComponent(o.id)}/warehouses`); } catch (ex) { toast(ex.message, 'err'); return; } }
  const whPick = wh?.warehouseId || (wh?.warehouses.length === 1 ? wh.warehouses[0].id : '');
  const whStock = w => w.lines.map(l => `${esc(l.sku)}: cần ${fmtNum(l.need)} · tồn ${fmtNum(l.stock)}${l.stock < l.need ? ' <b class="danger-text">thiếu</b>' : ''}`).join('<br>');
  const whField = wh && wh.warehouses.length ? `<label class="verify-field"><span>Kho bán (trừ kho khi duyệt)</span><select name="warehouseId">${wh.configured && !whPick ? '<option value="">Chọn kho</option>' : ''}${wh.warehouses.map(w => `<option value="${esc(w.id)}" ${w.id === whPick ? 'selected' : ''}>${esc(w.name)}</option>`).join('')}</select></label>` : '';
  const whRow = wh && wh.warehouses.length ? [['Tồn tại kho bán', wh.warehouses.map(w => `<b>${esc(w.name)}</b><br>${whStock(w) || '<span class="muted">—</span>'}`).join('<br>')]] : [];
  const v = await verifyBox({
    title: `Duyệt ${isContractDoc(d) ? 'HĐKT' : 'đơn'} ${docNo(d)}`, eyebrow: 'Kiểm tra trước khi duyệt',
    intro: `Kiểm tra kỹ các thông tin dưới đây với khách hàng. Đánh dấu đủ các mục mới duyệt được ${isContractDoc(d) ? 'HĐKT' : 'đơn'}.`,
    rows: [['Khách hàng', dash(o.customerName)], ['MST', dash(o.taxCode)], ['Người nhận / SĐT', dash([o.contact, o.phone].filter(Boolean).join(' · '))], ['Địa chỉ giao', dash(o.address)],
      ['Sản phẩm', items], ...whRow, [`Giá trị ${isContractDoc(d) ? 'HĐKT' : 'đơn'} (gồm VAT)`, `<b>${money(o.total)}</b>`], ['Ghi chú', o.note ? esc(o.note) : '<span class="muted">Không có</span>']],
    fields: `<label class="verify-field"><span>Ngày giao dự kiến</span><input type="date" name="deliveryDate" value="${esc(o.expectedDeliveryDate || '')}" min="${todayIso()}"></label>${whField}`,
    checks: ['Thông tin khách hàng (tên công ty, MST, người nhận, số điện thoại, địa chỉ giao) chính xác',
      'Sản phẩm, số lượng, đơn giá và VAT đúng với yêu cầu của khách', 'Đã kiểm tra tồn kho / khả năng đáp ứng đủ số lượng',
      'Ngày giao dự kiến khả thi và đã thống nhất với khách', 'Điều kiện thanh toán (đặt cọc / thanh toán khi giao) đã thống nhất với khách'],
    validate: x => !x.deliveryDate ? 'Chọn ngày giao dự kiến.' : wh?.configured && whField && !x.warehouseId ? 'Chọn kho bán.' : '', ok: isContractDoc(d) ? 'Duyệt HĐKT' : 'Duyệt đơn',
  });
  if (!v) return;
  try {
    if (v.deliveryDate !== (o.expectedDeliveryDate || '')) await api(`/orders/${encodeURIComponent(o.id)}/delivery-date`, 'PUT', { date: v.deliveryDate });
    await api(`/orders/${encodeURIComponent(o.id)}/status`, 'PUT', { status: 'confirmed', verified: true, costWarningsReviewed: true, debtWarningAccepted, ...(v.warehouseId ? { warehouseId: v.warehouseId } : {}) });
    toast(isContractDoc(d) ? 'Đã duyệt HĐKT. Báo giá của HĐKT đã được khoá.' : 'Đã duyệt đơn. Báo giá của đơn đã được khoá.'); openOrder(o.id);
  } catch (ex) {
    if (ex.code === 'CUSTOMER_DEBT_OVERDUE') {
      await verifyAndConfirmOrder();
    } else toast(ex.message, 'err');
  }
}
/** Xem trước đơn đặt hàng (mẫu đơn Minh Long), sửa trực tiếp trên phiếu rồi in / lưu PDF hoặc tải Excel. */
function openOrderPrint(detail = sales.detail) {
  const p = orderPrintData(detail, state.user?.name || '');
  const dlg = document.createElement('dialog'); dlg.className = 'modal xwide order-print-dialog';
  dlg.innerHTML = `<div class="modal-head"><div><span class="eyebrow">Đơn đặt hàng</span><h2>Xem, chỉnh sửa và tải ${esc(p.orderNo)}</h2></div><button type="button" class="icon-btn" data-x aria-label="Đóng">×</button></div>
    <div class="modal-body order-doc-body"><aside class="order-doc-form" data-order-form></aside>
      <section class="order-doc-preview"><div class="row-gap print-tools"><label class="check"><input type="checkbox" data-prices> Hiện đơn giá, thành tiền</label><span class="muted small">Sửa ở form bên trái hoặc trực tiếp trên phiếu.</span></div>
        <div class="paper ddh-paper" data-sheet></div></section></div>
    <div class="modal-foot"><button type="button" class="btn secondary" data-x>Đóng</button><button type="button" class="btn secondary" data-xlsx>Tải Excel</button><button type="button" class="btn primary" data-print>In / Lưu PDF</button></div>`;
  document.body.append(dlg);
  const sheet = dlg.querySelector('[data-sheet]'), prices = () => dlg.querySelector('[data-prices]').checked;
  const render = () => { sheet.innerHTML = orderSheetHtml(p, { prices: prices(), edit: true }); };
  render();
  const editForm = initOrderPrintForm({ host: dlg.querySelector('[data-order-form]'), data: p, beforeUpdate: () => readEdits(sheet, p), onUpdate: render });
  sheet.addEventListener('input', () => { readEdits(sheet, p); editForm.sync(); });
  dlg.querySelector('[data-prices]').addEventListener('change', () => editForm.apply());
  const close = () => { dlg.close(); dlg.remove(); };
  dlg.querySelectorAll('[data-x]').forEach(b => b.addEventListener('click', close)); dlg.addEventListener('close', () => dlg.remove());
  dlg.querySelector('[data-print]').addEventListener('click', () => {
    editForm.apply();
    $('#print-sheet').innerHTML = orderSheetHtml(p, { prices: prices() });
    printSheet({ page: { size: 'A4 portrait', margin: '10mm' }, cls: 'order-sheet', title: `Don-dat-hang-${p.orderNo}`.replace(/[^\w.-]+/g, '-') });
  });
  dlg.querySelector('[data-xlsx]').addEventListener('click', async e => {
    editForm.apply(); e.target.disabled = true;
    try { await downloadOrderExcel(p, { prices: prices() }); } catch (ex) { toast(ex.message, 'err'); } finally { e.target.disabled = false; }
  });
  dlg.showModal();
}
/**
 * Xem trước PHIẾU ĐÓNG GÓI / PHIẾU GIAO HÀNG (cùng kiểu mẫu đơn đặt hàng), sửa trực tiếp trên phiếu rồi in / lưu PDF.
 * `choices` = [{ value, label }] (chọn phiếu / chuyến giao), `build(value)` → dữ liệu bản in.
 */
function openSlipPrint({ kind, choices, initial, build }) {
  const k = SLIP_KINDS[kind], dlg = document.createElement('dialog'); dlg.className = 'modal xwide order-print-dialog';
  dlg.innerHTML = `<div class="modal-head"><div><span class="eyebrow">${kind === 'packing' ? 'Phiếu đóng gói' : 'Phiếu giao hàng'}</span><h2>In ${k.title.toLowerCase()}</h2></div><button type="button" class="icon-btn" data-x aria-label="Đóng">×</button></div>
    <div class="modal-body"><div class="row-gap print-tools">${choices.length > 1 ? `<label class="inline">${kind === 'packing' ? 'Phiếu' : 'Chuyến giao'} <select data-choice>${choices.map(c => `<option value="${esc(c.value)}"${c.value === initial ? ' selected' : ''}>${esc(c.label)}</option>`).join('')}</select></label>` : ''}
      <label class="inline">Khổ giấy <select data-orient><option value="portrait">A4 dọc</option><option value="landscape">A4 ngang</option></select></label>
      <span class="muted small">Bấm vào chữ trên phiếu để sửa trước khi in.</span></div>
      <div class="paper ddh-paper" data-sheet></div></div>
    <div class="modal-foot"><button type="button" class="btn secondary" data-x>Đóng</button><button type="button" class="btn primary" data-print>In / Lưu PDF</button></div>`;
  document.body.append(dlg);
  const sheet = dlg.querySelector('[data-sheet]'), orient = dlg.querySelector('[data-orient]'); let p;
  // Khổ giấy dọc / ngang: nhớ lựa chọn lần trước trên máy này.
  try { orient.value = localStorage.getItem('slipOrient') === 'landscape' ? 'landscape' : 'portrait'; } catch { /* không có localStorage: mặc định dọc */ }
  const paper = () => sheet.classList.toggle('landscape', orient.value === 'landscape');
  orient.addEventListener('change', () => { paper(); try { localStorage.setItem('slipOrient', orient.value); } catch { /* bỏ qua */ } });
  paper();
  const render = v => { p = build(v); sheet.innerHTML = slipSheetHtml(p, { edit: true }); };
  render(initial ?? choices[0]?.value ?? '');
  dlg.querySelector('[data-choice]')?.addEventListener('change', e => render(e.target.value));
  const close = () => { dlg.close(); dlg.remove(); };
  dlg.querySelectorAll('[data-x]').forEach(b => b.addEventListener('click', close)); dlg.addEventListener('close', () => dlg.remove());
  dlg.querySelector('[data-print]').addEventListener('click', () => {
    readEdits(sheet, p);
    $('#print-sheet').innerHTML = slipSheetHtml(p);
    // Phiếu: lề trên 2 cm, trái phải 0,8 cm; khổ A4 dọc / ngang theo lựa chọn.
    printSheet({ page: { size: orient.value === 'landscape' ? 'A4 landscape' : 'A4 portrait', margin: '20mm 8mm 10mm 8mm' }, cls: 'slip-' + orient.value,
      title: `${k.file}-${p.docNo}`.replace(/[^\w.-]+/g, '-') });
  });
  dlg.showModal();
}
const sellerName = d => sellerOf(d).short;
/** Phiếu đóng gói của đơn (nhân viên phụ trách / Manager): chọn 1 phiếu đã lập, hoặc cả đơn khi chưa chia phiếu. */
async function printPackingForOrder(orderId) {
  const [d, pk] = await Promise.all([api('/orders/' + encodeURIComponent(orderId)), api(`/orders/${encodeURIComponent(orderId)}/packing`)]);
  if (!pk.scheduled) throw new Error(NO_SCHEDULE);
  const live = pk.slips.filter(x => x.status !== 'cancelled').sort((a, b) => a.slipNo.localeCompare(b.slipNo));
  const choices = [...live.map(x => ({ value: x.id, label: `${x.slipNo} · ${x.sourceLabel}${x.sourceNote ? ': ' + x.sourceNote : ''} · ${PACK_STATUS[x.status]?.[0] || x.status}` })), { value: '', label: (d.contract ? 'Cả HĐKT' : 'Cả đơn') + ' (tất cả dòng hàng)' }];
  openSlipPrint({ kind: 'packing', choices, initial: live[0]?.id || '', build: v => {
    const slip = live.find(x => x.id === v);
    return packingPrintData({ seller: sellerName(d), order: d.order, contract: d.contract, slip, lines: slip ? slip.lines : pk.lines }, state.user?.name || '');
  } });
}
/** Phiếu giao hàng của đơn: chọn chuyến giao đã lên lịch, hoặc toàn bộ hàng còn lại. */
async function printDeliveryForOrder(orderId) {
  const d = await api('/orders/' + encodeURIComponent(orderId)), byId = new Map(d.lines.map(l => [l.id, l]));
  await deliveryProductImages(d.lines);
  const trips = (d.deliveries || []).filter(x => x.status !== 'cancelled');
  if (!trips.length) throw new Error(NO_SCHEDULE);
  const choices = [...trips.map(x => ({ value: x.id, label: `${x.deliveryNo} · ${fmtDate(x.plannedDate)}${x.timeSlot ? ' ' + x.timeSlot : ''} · ${DELIVERY_STATUS[x.status]?.[0] || x.status}` })), { value: '', label: 'Toàn bộ hàng chưa giao' }];
  const next = trips.find(x => x.status !== 'delivered');
  openSlipPrint({ kind: 'delivery', choices, initial: next?.id || (trips.length ? trips.at(-1).id : ''), build: v => {
    const trip = trips.find(x => x.id === v);
    const left = d.lines.map(l => ({ ...l, ordered: l.qty, qty: Math.max(0, Math.round((l.qty - (l.deliveredQty || 0)) * 1000) / 1000) })).filter(l => l.qty > 0);
    const lines = trip ? trip.lines.map(x => { const l = byId.get(x.orderLineId) || {}; return { ...l, ordered: l.qty, qty: x.qty }; })
      : left.length ? left : d.lines.map(l => ({ ...l, ordered: l.qty }));
    return deliveryPrintData({ seller: sellerName(d), order: d.order, contract: d.contract, delivery: trip, lines }, state.user?.name || '');
  } });
}
/** Trang phiếu đóng gói (nhóm Kho không xem được đơn): in phiếu đóng gói / phiếu giao hàng từ chính phiếu. */
async function printFromSlip(kind) {
  const d = packingView; if (!d) return;
  if (kind === 'delivery') await deliveryProductImages(d.lines);
  const seller = (SELLERS[d.order.legalEntity] || (d.order.quoteType === 'VIGIFTS' ? SELLERS.VG : SELLERS.BN)).short, me = state.user?.name || '';
  openSlipPrint({ kind, choices: [], initial: '', build: () => kind === 'packing'
    ? packingPrintData({ seller, order: d.order, slip: d.slip, lines: d.lines }, me)
    : deliveryPrintData({ seller, order: d.order, delivery: { deliveryNo: d.slip.slipNo, address: d.slip.shipAddress || d.order.address,
        receiverName: d.slip.shipTo === 'workshop' ? d.slip.shipName : orderRecipient(d.order).receiverName, receiverPhone: d.slip.shipPhone, carrier: d.slip.carrierName, carrierPhone: d.slip.carrierPhone },
        lines: d.lines.map(l => ({ ...l, ordered: '' })) }, me) });
}
async function deliveryProductImages(lines) {
  const images = new Map((state.products || []).map(p => [p.sku,p.imageUrl]));
  const skus = [...new Set(lines.filter(l => !l.imageUrl).map(l => l.sku).filter(Boolean))];
  for (let i=0;i<skus.length;i+=100) {
    try { const d=await api('/products?'+new URLSearchParams({skus:skus.slice(i,i+100).join(',')}));
      for(const p of d.products) if(p.imageUrl)images.set(p.sku,p.imageUrl);
    } catch { /* Keep the sheet usable with blank image cells if the catalog is temporarily unavailable. */ }
  }
  for(const l of lines) if(!l.imageUrl)l.imageUrl=images.get(l.sku)||'';
}
document.addEventListener('click', async e => {
  const b = e.target.closest('[data-pack-print-for], [data-ship-print-for], [data-slip-print]'); if (!b) return;
  e.stopPropagation();
  try {
    if (b.dataset.packPrintFor) await printPackingForOrder(b.dataset.packPrintFor);
    else if (b.dataset.shipPrintFor) await printDeliveryForOrder(b.dataset.shipPrintFor);
    else await printFromSlip(b.dataset.slipPrint);
  } catch (ex) { toast(ex.message, 'err'); }
});
document.addEventListener('click', async e => {
  if (e.target.closest('#order-print, #order-print-card')) openOrderPrint();
  const listPrint = e.target.closest('[data-order-print-for]');
  if (listPrint) {
    e.stopPropagation();
    try { openOrderPrint(await api('/orders/' + encodeURIComponent(listPrint.dataset.orderPrintFor))); } catch (ex) { toast(ex.message, 'err'); }
  }
  if (e.target.closest('[data-contract-docs]')) openContractDocs({ detail: sales.detail, api, toast, onSaved: () => openOrder(sales.order.id) });
  const listDocs = e.target.closest('[data-contract-docs-for]');
  if (listDocs) {
    e.stopPropagation();
    try { const d = await api('/orders/' + encodeURIComponent(listDocs.dataset.contractDocsFor)); openContractDocs({ detail: d, api, toast, onSaved: loadContracts }); } catch (ex) { toast(ex.message, 'err'); }
  }
  if (e.target.closest('#order-confirm')) verifyAndConfirmOrder();
  const sub = e.target.closest('#order-submit');
  if (sub && sales.detail?.order) {
    const o = sales.detail.order, what = sales.detail.contract ? 'HĐKT' : 'đơn hàng';
    if (!await confirmBox(`Đã xem kỹ ${what} ${sales.detail.contract?.contractNo || o.orderNo}? Gửi Manager duyệt.`, { title: 'Gửi duyệt', ok: 'Gửi duyệt' })) return;
    sub.disabled = true;
    try { await api('/orders/' + encodeURIComponent(o.id) + '/submit', 'POST', {}); toast(`Đã gửi Manager duyệt ${what}.`); openOrder(o.id); }
    catch (ex) { toast(ex.message, 'err'); sub.disabled = false; }
  }
  if (e.target.closest('#order-history')) showAudit({ api, toast, entityType: 'orders', entityId: sales.order.id, title: (isContractDoc() ? 'HĐKT ' : 'Đơn ') + docNo() });
  if (e.target.closest('#order-cancel')) {
    const w = isContractDoc() ? 'HĐKT' : 'đơn';
    if (!await confirmBox(`Huỷ ${w} ${docNo()}? ${isContractDoc() ? 'HĐKT' : 'Đơn'} huỷ không còn tính công nợ; báo giá có thể lập lại.`, { title: 'Huỷ ' + w, ok: 'Huỷ ' + w, danger: true })) return;
    try { await api(`/orders/${encodeURIComponent(sales.order.id)}/status`, 'PUT', { status: 'cancelled' }); toast('Đã huỷ ' + w + '.'); loadHolds(true); openOrder(sales.order.id); } catch (ex) { toast(ex.message, 'err'); }
  }
  if (e.target.closest('#order-delete')) {
    const k = isContractDoc(), w = k ? 'HĐKT' : 'đơn hàng';
    if (!await confirmBox(`Xoá hẳn ${w} ${docNo()} đã huỷ? Không khôi phục được (nhật ký thay đổi vẫn giữ lại). Đơn nháp trên Sapo (nếu có) cần xoá riêng trên Sapo.`, { title: 'Xoá ' + w, ok: 'Xoá ' + w, danger: true, typeToConfirm: docNo() || 'XOA' })) return;
    try { await api(`/orders/${encodeURIComponent(sales.order.id)}`, 'DELETE'); toast('Đã xoá ' + w + '.'); go(k ? '#/contracts' : '#/orders'); } catch (ex) { toast(ex.message, 'err'); }
  }
  const sign = e.target.closest('[data-contract-sign]');
  if (sign) { try { await api('/contracts/' + encodeURIComponent(sign.dataset.contractSign), 'PUT', { status: 'signed', signedDate: todayIso() }); openOrder(sales.order.id); } catch (ex) { toast(ex.message, 'err'); } }
});
/**
 * Lập HĐKT THẲNG TỪ BÁO GIÁ (luồng độc lập với Đơn hàng – không sinh đơn hàng trước): điền pháp nhân, cọc, hạn thanh toán…
 * → chọn kho Sapo → máy chủ lập HĐKT + đơn nháp Sapo cùng lúc (POST /contracts { quoteId }).
 */
let contractTarget = null;
function openContractForm(t) {
  contractTarget = t;
  const f = $('#contract-form'); f.reset(); $('#contract-error').textContent = '';
  $('#contract-order-no').textContent = `báo giá ${t.quoteNo}${t.customer ? ' · ' + t.customer : ''}`;
  f.signedDate.value = todayIso(); f.deliveryAddress.value = t.address || ''; f.legalEntity.value = t.quoteType === 'VIGIFTS' ? 'VG' : 'BN';
  f.contractNo.value = ''; f.contractNo.dataset.auto = '';
  $('#contract-dialog').showModal();
  previewContractNo();
}
/** Điền số HĐKT tự sinh (theo pháp nhân); người dùng đã sửa số thì giữ số đã sửa. */
async function previewContractNo() {
  const f = $('#contract-form'), t = contractTarget, input = f.contractNo; if (!t) return;
  const untouched = !input.value.trim() || input.value === input.dataset.auto;
  try {
    const r = await api(`/contracts/next-no?quoteId=${encodeURIComponent(t.quoteId)}&legalEntity=${encodeURIComponent(f.legalEntity.value)}`);
    if (contractTarget !== t) return;
    input.placeholder = r.error || 'Nhập số HĐKT';
    if (untouched || !input.value.trim()) input.value = r.contractNo || '';
    input.dataset.auto = r.contractNo || '';
  } catch (ex) { input.placeholder = 'Nhập số HĐKT'; }
}
$('#contract-form').legalEntity.addEventListener('change', previewContractNo);
$('#contract-form').addEventListener('submit', async e => {
  e.preventDefault(); const f = e.target, err = $('#contract-error'); err.textContent = '';
  const target = contractTarget; if (!target) return;
  const body = { quoteId: target.quoteId, debtWarningAccepted: target.debtWarningAccepted === true, legalEntity: f.legalEntity.value, depositRate: parseNum(f.depositRate.value) || 0, paymentDays: parseInt(f.paymentDays.value, 10) || 0,
    signedDate: f.signedDate.value || undefined, paymentMethod: f.paymentMethod.value, deliveryAddress: f.deliveryAddress.value };
  // Giữ số tự sinh → máy chủ cấp số kế tiếp lúc lập (tránh trùng nếu người khác vừa lấy số); đã sửa → gửi số đã sửa.
  const no = f.contractNo.value.trim();
  if (no && no !== f.contractNo.dataset.auto) body.contractNo = no;
  try {
    // Lập HĐKT: chọn có tạo đơn trên Sapo (chọn kho; Sapo lỗi → không lập HĐKT) hay chỉ lập trên web.
    const r = await sapoPush().choose({ quoteId: target.quoteId }, { title: 'Lập HĐKT', action: 'Lập HĐKT + đơn Sapo',
      run: (loc, push) => api('/contracts', 'POST', { ...body, ...(loc ? { sapoLocationId: loc } : {}), ...(push === false ? { pushSapo: false } : {}) }) });
    if (!r) return;
    $('#contract-dialog').close(); contractTarget = null; toast('Đã lập HĐKT ' + r.contractNo); sapoToast(r.sapo); loadHolds(true); // HĐKT giữ hàng thay báo giá
    target.done?.(); go('#/contracts/' + encodeURIComponent(r.orderId));
  } catch (ex) { err.textContent = ex.message; }
});
$('#order-new-delivery').addEventListener('click', () => {
  const f = $('#delivery-form'), d = sales.detail, o = d.order; f.reset(); $('#delivery-error').textContent = '';
  $('#delivery-order-no').textContent = o.orderNo; f.plannedDate.value = o.expectedDeliveryDate && o.expectedDeliveryDate >= todayIso() ? o.expectedDeliveryDate : todayIso();
  const recipient = orderRecipient(o); f.receiverName.value = recipient.receiverName; f.receiverPhone.value = recipient.receiverPhone; f.address.value = o.address || '';
  const pending = id => d.deliveries.filter(x => ['planned', 'in_transit'].includes(x.status)).flatMap(x => x.lines).filter(l => l.orderLineId === id).reduce((s, l) => s + l.qty, 0);
  $('#delivery-lines').innerHTML = d.lines.map(l => { const left = Math.max(0, l.qty - l.deliveredQty - pending(l.id)); return `<tr><td>${esc(l.name)}<small>${esc(l.unit)}</small></td><td class="right">${fmtNum(left)}</td>
    <td class="right"><input class="num-input" inputmode="decimal" data-line="${esc(l.id)}" value="${left ? fmtNum(left) : ''}" ${left ? '' : 'disabled'} aria-label="Số lượng giao ${esc(l.name)}"></td></tr>`; }).join('');
  $('#delivery-dialog').showModal();
});
$('#delivery-form').addEventListener('submit', async e => {
  e.preventDefault(); const f = e.target, err = $('#delivery-error'); err.textContent = '';
  const lines = $$('#delivery-lines input[data-line]').map(i => ({ orderLineId: i.dataset.line, qty: parseNum(i.value) })).filter(l => l.qty > 0);
  if (!lines.length) { err.textContent = 'Nhập số lượng giao cho ít nhất một sản phẩm.'; return; }
  try {
    await api('/deliveries', 'POST', { orderId: sales.order.id, plannedDate: f.plannedDate.value, timeSlot: f.timeSlot.value, receiverName: f.receiverName.value, receiverPhone: f.receiverPhone.value,
      address: f.address.value, carrier: f.carrier.value, shippingFee: parseNum(f.shippingFee.value) || 0, note: f.note.value, lines });
    $('#delivery-dialog').close(); toast('Đã lên lịch giao.'); openOrder(sales.order.id);
  } catch (ex) { err.textContent = ex.message; }
});
$('#order-new-payment').addEventListener('click', () => {
  const f = $('#payment-form'), r = sales.detail.receivable; f.reset(); f.dataset.requestKey=crypto.randomUUID(); $('#payment-pos-confirm').hidden=sales.order.channel!=='pos'; f.confirmed.required=sales.order.channel==='pos'; f.method.querySelector('option[value=other]').disabled=sales.order.channel==='pos'; $('#payment-error').textContent = '';
  $('#payment-title').textContent = 'Thu tiền ' + (docNo() || sales.order.orderNo); f.amount.value = fmtNum(r.balance); f.paidAt.value = todayIso(); f.paidAt.max = todayIso();
  $('#payment-dialog').showModal();
});
$('#payment-form').addEventListener('submit', async e => {
  e.preventDefault(); const f = e.target, err = $('#payment-error'), btn = f.querySelector('.modal-foot .btn.primary'); err.textContent = '';
  if (btn?.disabled) return;
  if (btn) btn.disabled = true; // chống bấm hai lần ghi trùng phiếu thu
  try {
    await api('/payments', 'POST', { key:f.dataset.requestKey, confirmed:f.confirmed.checked, orderId: sales.order.id, amount: parseNum(f.amount.value), paidAt: f.paidAt.value, method: f.method.value, reference: f.reference.value });
    $('#payment-dialog').close(); toast('Đã ghi nhận thanh toán.'); openOrder(sales.order.id);
  } catch (ex) { err.textContent = ex.message; } finally { if (btn) btn.disabled = false; }
});
document.addEventListener('click', async e => {
  const b = e.target.closest('[data-void-payment]'); if (!b) return;
  const li = b.closest('li'); if (li.querySelector('.void-form')) return;
  const f = document.createElement('form'); f.className = 'void-form';
  f.innerHTML = '<input name="reason" required minlength="3" placeholder="Lý do huỷ, VD: ghi nhầm số tiền" aria-label="Lý do huỷ phiếu thu"><button class="btn small danger-outline">Huỷ phiếu thu</button><button type="button" class="btn ghost small" data-void-cancel>Thôi</button><small class="danger-text" role="alert"></small>';
  li.append(f); f.reason.focus();
  f.querySelector('[data-void-cancel]').addEventListener('click', () => f.remove());
  f.addEventListener('submit', async ev => {
    ev.preventDefault(); const ok = f.querySelector('.danger-outline'); ok.disabled = true;
    try { await api(`/payments/${encodeURIComponent(b.dataset.voidPayment)}/void`, 'POST', { reason: f.reason.value }); toast('Đã huỷ phiếu thu.'); openOrder(sales.order.id); }
    catch (ex) { f.querySelector('small').textContent = ex.message; ok.disabled = false; }
  });
});
// ----- Thanh nút báo giá như web cũ: Sinh HĐKT · Tạo đơn hàng · Tải báo giá · Lưu · Duyệt · Xoá
/** Lý do chưa dùng được các nút cần báo giá đã duyệt (null = dùng được). */
function approvalBlock() {
  if (!editor.id) return 'Lưu báo giá trước.';
  if (editor.dirty) return 'Lưu thay đổi trước.';
  if (editor.approval?.status === 'draft') return 'Báo giá còn nháp – bấm "Gửi duyệt" để Manager duyệt.';
  if (editor.approval?.status !== 'approved') return 'Báo giá đang đợi Manager duyệt.';
  return null;
}
function updateQuoteActions() {
  const saved = !!editor.id, approved = editor.approval?.status === 'approved', mgr = isManager(), block = approvalBlock();
  const readOnly = saved && editor.approval?.canEdit === false; // xem được, không sửa được (máy chủ cũng chặn)
  const locked = (saved && approved && !mgr) || readOnly;
  for (const el of qf.querySelectorAll('.editor-grid input, .editor-grid select, .editor-grid textarea, .editor-grid button, .card input, .card select, .card textarea, .card button')) {
    if (locked && !el.disabled) { el.dataset.approvalLock = '1'; el.disabled = true; }
    else if (!locked && el.dataset.approvalLock) { delete el.dataset.approvalLock; el.disabled = false; }
  }
  $('#save-quote').disabled = $('#save-quote-m').disabled = saving || locked;
  const pill = $('#editor-approval');
  const draft = editor.approval?.status === 'draft';
  pill.hidden = !saved; pill.className = 'pill ' + (approved ? 'ok' : draft ? '' : 'warn');
  pill.textContent = approved ? 'Đã duyệt' : draft ? 'Nháp' : 'Chờ duyệt';
  pill.title = approved && editor.approval.by ? `Duyệt bởi ${editor.approval.by}${editor.approval.at ? ' lúc ' + new Date(editor.approval.at).toLocaleString('vi-VN') : ''}` : approved ? '' : 'Manager cần duyệt trước khi tải file, tạo đơn hàng, sinh HĐKT.';
  {
    const b = $('#quote-make'), linked = editor.document;
    b.hidden = !saved;
    b.textContent = linked ? 'Xem Đơn hàng / HĐKT' : editor.documentLoading ? 'Đang kiểm tra Đơn hàng / HĐKT…'
      : editor.documentError ? 'Kiểm tra Đơn hàng / HĐKT' : 'Sinh Đơn hàng / HĐKT';
    b.disabled = !!editor.documentLoading || (!linked && !editor.documentError && !!block);
    b.title = linked ? 'Xem ' + (linked.contractNo || linked.orderNo) : editor.documentError ? 'Thử kiểm tra lại hồ sơ đã tạo'
      : block || 'Chọn tạo Đơn hàng (khách có HĐ nguyên tắc) hoặc HĐKT';
  }
  const dl = $('#quote-download'); dl.disabled = !!block; dl.title = block || ''; if (block) closeDownloadMenu();
  if (typeof drawQuoteHold === 'function' && $('#quote-hold')) drawQuoteHold();
  // Manager duyệt mọi báo giá; nhân viên phụ trách xác nhận báo giá khách gửi từ trang khách hàng.
  const canApprove = mgr || !!editor.approval?.canApprove;
  const ap = $('#approve-quote'); ap.hidden = !canApprove || !saved; ap.disabled = approved; ap.textContent = approved ? 'Đã duyệt' : editor.approval?.fromCustomer ? 'Xác nhận báo giá khách' : 'Duyệt';
  // Báo giá nhân viên gửi duyệt: người duyệt trả lại kèm lý do (về nháp để sửa).
  $('#reject-quote').hidden = !canApprove || !saved || editor.approval?.status !== 'pending' || !!editor.approval?.fromCustomer;
  // Nhân viên xoá được báo giá chưa duyệt của mình; "Gửi duyệt" chỉ hiện với báo giá nháp (Manager duyệt thẳng).
  $('#delete-quote').hidden = !saved || (!mgr && approved) || readOnly;
  // Nhân viên luôn thấy nút: nháp → "Gửi duyệt"; đã gửi (chờ duyệt) → "Đã gửi duyệt" (khoá). Báo giá khách gửi thì dùng nút xác nhận.
  const sb = $('#submit-quote');
  sb.hidden = !saved || mgr || approved || !!editor.approval?.fromCustomer || readOnly;
  sb.disabled = saving || !draft; sb.textContent = draft ? 'Gửi duyệt' : 'Đã gửi duyệt';
  sb.title = draft ? 'Gửi báo giá cho Manager duyệt' : 'Báo giá đã gửi, đang chờ Manager duyệt';
  $('#quote-history').hidden = !mgr || !saved;
}
function closeDownloadMenu() { $('#download-menu').hidden = true; $('#quote-download').setAttribute('aria-expanded', 'false'); }
$('#quote-download').addEventListener('click', e => {
  e.stopPropagation();
  const block = approvalBlock(); if (block) return toast(block, 'err');
  $('#pdf-quote-nock').hidden = editor.type === 'VIGIFTS'; // mẫu VIGIFTS không có cột CK
  const open = $('#download-menu').hidden; $('#download-menu').hidden = !open; $('#quote-download').setAttribute('aria-expanded', String(open));
});
document.addEventListener('click', e => { if (!e.target.closest('.menu-wrap')) closeDownloadMenu(); });
$('#download-menu').addEventListener('click', () => closeDownloadMenu());
/** Đơn của báo giá đang mở: có đơn đang hiệu lực thì dùng, chưa có thì tạo. */
/**
 * Tạo đơn cho báo giá: mở form nhập thông tin trước, sau đó chỉ kiểm Sapo nếu chọn có đẩy.
 * HĐKT dùng form riêng. Báo giá đã có đơn → mở đơn đó. Trả id đơn, null khi huỷ.
 */
var orderCreateUi = null;
const orderCreate = () => orderCreateUi ||= initOrderCreate({ api, $, todayIso, confirmBox, chooseSapo: (ref, opts) => sapoPush().choose(ref, opts) });
async function createOrderForQuote(quoteId, quoteNo, debtWarningAccepted = false) {
  let existed = null;
  const post = async (fields, loc, push) => {
    try { return await api('/orders', 'POST', { quoteId, ...fields, debtWarningAccepted, ...(loc ? { sapoLocationId: loc } : {}), pushSapo: push === true }); }
    catch (ex) {
      if (ex.code !== 'ORDER_EXISTS') throw ex;
      const found = (await api('/orders?q=' + encodeURIComponent(quoteNo))).orders.find(o => o.quoteId === quoteId && o.status !== 'cancelled');
      if (!found) throw ex; // báo giá đã lập HĐKT: báo lỗi rõ ("Báo giá này đã có HĐKT …"), không mở đơn
      existed = found; return { id: found.id };
    }
  };
  const r = await orderCreate().choose({ quoteId, quoteNo }, post);
  if (!r) return null;
  if (existed) toast('Báo giá này đã có đơn hàng – mở đơn đó.');
  else { toast('Đã sinh đơn đặt hàng.'); sapoToast(r.sapo); }
  if (typeof refreshQuoteHold === 'function' && typeof editor !== 'undefined' && editor.id) { refreshQuoteHold(editor.id); loadHolds(true); } // lập đơn từ báo giá → tự bỏ treo
  return r.id;
}
// Kiểm tồn cả báo giá (giống trang Khách hỏi tồn): tồn khả dụng, tồn NCC, hàng chờ về so với số lượng báo giá.
$('#quote-purchase').addEventListener('click', () => {
  if (!editor.id || editor.dirty) { toast('Lưu báo giá trước khi đặt hàng NCC.', 'err'); return; }
  go('#/purchases/new?type=quote&id=' + encodeURIComponent(editor.id));
});
$('#quote-stock').addEventListener('click', async () => {
  const d = collectQuote(), need = new Map();
  for (const r of d.rows) if (r.name || r.sku) { const k = (r.sku || '').trim() || '#' + need.size; const x = need.get(k) || { sku: (r.sku || '').trim(), name: r.name, unit: r.unit, qty: 0 }; x.qty += Number(r.qty) || 0; need.set(k, x); }
  if (!need.size) return toast('Báo giá chưa có sản phẩm để kiểm tồn.', 'err');
  $('#stock-check-title').textContent = `${d.quoteNo || 'Báo giá'}${d.customer ? ' · ' + d.customer : ''}`;
  $('#stock-check-body').innerHTML = '<p class="muted">Đang kiểm tồn…</p>'; $('#stock-check-note').textContent = ''; $('#stock-check-dialog').showModal();
  try {
    const skus = [...new Set([...need.values()].map(x => x.sku).filter(Boolean))], stock = new Map(), me = editor.id || '';
    await loadHolds(true);
    for (let i = 0; i < skus.length; i += 200) { const r = await api('/products?skus=' + encodeURIComponent(skus.slice(i, i + 200).join(','))); applyCatalogMeta(r); for (const p of r.products) stock.set(p.sku, p); }
    let short = 0;
    // Cột "Tồn kho · Đang treo" chỉ hiện khi có mã đang bị báo giá khác treo; không thì bảng gọn như cũ.
    const anyHeld = [...need.values()].some(i => i.sku && heldQty(i.sku, me) > 0), anyLock = [...need.values()].some(i => i.sku && hasSupplierStock(stock.get(i.sku)));
    const rows = [...need.values()].map(i => {
      // Khả dụng cho báo giá này = tồn kho − phần báo giá KHÁC đang treo (phần chính báo giá này giữ vẫn tính là của mình).
      const p = i.sku ? stock.get(i.sku) : null, av = p ? availableStock(p, me) : null, miss = av === null ? null : Math.max(0, i.qty - av);
      const mine = i.sku ? (state.holds.get(i.sku) || []).filter(h => h.quoteId === me).reduce((t, h) => t + h.qty, 0) : 0;
      if (miss) short++;
      return `<tr data-stock-result="${miss === null ? 'unknown' : miss ? 'missing' : 'enough'}"><td>${esc(i.name)}<small>${esc(i.sku || 'Chưa có mã hàng')}${i.unit ? ' · ' + esc(i.unit) : ''}${mine ? ` · <b>báo giá này đang giữ ${fmtNum(mine)}</b>` : ''}</small></td><td class="right">${fmtNum(i.qty)}</td>
        ${anyHeld ? `<td class="right">${p ? fmtNum(stockTotal(p)) : '—'}</td><td class="right">${i.sku ? heldCell(i.sku, me) : '—'}</td>` : ''}
        <td class="right ${miss ? 'danger-text' : ''}">${av === null ? '—' : fmtNum(av)}</td>
        ${anyLock ? `<td class="right">${p && hasSupplierStock(p) ? stockText(kindStock(p, 'supplier')) : ''}</td>` : ''}<td class="right">${p ? incomingCell(p) : '—'}</td>
        <td class="right">${miss === null ? '<span class="muted">Không có số liệu</span>' : miss ? `<span class="pill danger">Thiếu ${fmtNum(miss)}</span>` : '<span class="pill ok">Đủ</span>'}</td></tr>`;
    });
    $('#stock-check-body').innerHTML = `<div class="table-wrap"><table class="data-table"><thead><tr><th>Sản phẩm</th><th class="right">Cần</th>${anyHeld ? '<th class="right">Tồn kho</th><th class="right">Đang treo</th><th class="right">Khả dụng</th>' : '<th class="right">Tồn khả dụng</th>'}${anyLock ? '<th class="right">Kho NCC</th>' : ''}<th class="right">Hàng chờ về</th><th class="right">Kết quả</th></tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
    bindStockCheckFilter($('#stock-check-body'));
    $('#stock-check-note').textContent = short ? `${short} sản phẩm không đủ tồn khả dụng – xem tồn NCC / hàng chờ về.` : 'Các sản phẩm có số liệu đều đủ tồn khả dụng.';
  } catch (e) { $('#stock-check-body').innerHTML = `<p class="error">${esc(e.message)}</p>`; }
});
/** Hộp chọn luồng: 'order' (khách đã có HĐ nguyên tắc) hoặc 'contract' (lập HĐKT); null = huỷ. */
function chooseFlow(label) {
  const dlg = $('#flow-dialog'); $('#flow-quote').textContent = label || 'Báo giá';
  return new Promise(resolve => {
    let picked = null;
    dlg.onclick = e => { const b = e.target.closest('[data-flow]'); if (b) { picked = b.dataset.flow; dlg.close(); } };
    dlg.onclose = () => { dlg.onclick = dlg.onclose = null; resolve(picked); };
    dlg.showModal();
  });
}
/**
 * Sinh chứng từ từ báo giá theo luồng đã chọn – 2 luồng ĐỘC LẬP:
 *  - 'order': sinh đơn hàng (+ đơn Sapo) rồi mở đơn;
 *  - 'contract': mở hộp lập HĐKT ngay (không sinh đơn hàng) → lập xong mở trang HĐKT.
 * `q`: { quoteId, quoteNo, quoteType, customer, address }. Trả true khi đã sinh / đã mở hộp lập HĐKT.
 */
async function makeFromQuote(flow, q, done) {
  const review = await api('/quotes/' + encodeURIComponent(q.quoteId) + '/approval-preflight');
  const debtWarningAccepted=review.debt.total > 0 ? await confirmApprovalDebt(review,flow==='contract'?'Vẫn tạo HĐKT':'Vẫn tạo đơn') : false;
  if(review.debt.total > 0 && !debtWarningAccepted)return false;
  if (flow === 'contract') { openContractForm({ ...q, done, debtWarningAccepted }); return true; }
  const id = await createOrderForQuote(q.quoteId, q.quoteNo, debtWarningAccepted);
  if (!id) return false;
  done?.(); go('#/orders/' + id);
  return true;
}
/** Giữ hàng của báo giá đang mở (GET /quotes/:id/hold): hạn, các mã đang treo, quyền giữ / bỏ giữ / gia hạn. */
async function refreshQuoteHold(id) {
  editor.hold = null; editor.holdError = ''; drawQuoteHold();
  if (!id) return;
  try { const h = await api('/quotes/' + encodeURIComponent(id) + '/hold'); if (editor.id === id) { editor.hold = h; drawQuoteHold(); } }
  catch (ex) { if (editor.id === id) { editor.holdError = ex.message || 'Chưa đọc được trạng thái giữ hàng.'; drawQuoteHold(); } } // vẫn hiện nút – bấm sẽ báo lỗi rõ
}
function drawQuoteHold() {
  const h = editor.hold, pill = $('#editor-hold'), btn = $('#quote-hold'), ext = $('#quote-hold-extend');
  const active = !!h?.holds?.length, d = active ? new Date(h.expiresAt) : null, p2 = n => String(n).padStart(2, '0'), until = d ? `${p2(d.getDate())}/${p2(d.getMonth() + 1)} ${p2(d.getHours())}:${p2(d.getMinutes())}` : '';
  pill.hidden = !active; pill.textContent = active ? `Đang giữ hàng đến ${until}` : '';
  pill.title = active ? h.holds.map(x => `${x.sku} – ${x.name}: ${fmtNum(x.qty)}`).join('\n') + (h.by ? `\nNgười giữ: ${h.by}` : '') : '';
  btn.hidden = !editor.id; ext.hidden = !h?.canExtend;
  if (!h) { btn.textContent = 'Giữ hàng 5 ngày'; btn.disabled = false; btn.title = editor.holdError || 'Treo tồn kho cho báo giá này 5 ngày'; return; }
  btn.textContent = active ? 'Bỏ giữ hàng' : `Giữ hàng ${h.days || 5} ngày`;
  const block = active ? '' : editor.dirty ? 'Lưu thay đổi trước.' : !h.canHold ? (h.ordered ? 'Báo giá đã lập đơn / HĐKT – hàng do đơn giữ đến khi giao xong hoặc huỷ.' : 'Chỉ giữ hàng cho báo giá đã duyệt.') : '';
  btn.disabled = !!block; btn.title = block || (active ? 'Bỏ treo tồn kho cho báo giá này' : 'Treo tồn kho thật cho báo giá này 5 ngày; báo giá khác thấy khả dụng giảm tương ứng');
}
$('#quote-hold').addEventListener('click', async e => {
  const id = editor.id, h = editor.hold; if (!id) return;
  const active = !!h?.holds?.length;
  if (active && !await confirmBox('Bỏ giữ hàng cho báo giá này? Tồn sẽ trả lại khả dụng cho báo giá khác.', { title: 'Bỏ giữ hàng', ok: 'Bỏ giữ' })) return;
  e.target.disabled = true;
  try {
    if (active) { editor.hold = await api(`/quotes/${encodeURIComponent(id)}/hold/release`, 'POST', {}); toast('Đã bỏ giữ hàng.'); }
    else {
      const r = await api(`/quotes/${encodeURIComponent(id)}/hold`, 'POST', {}); editor.hold = r;
      const short = r.short || [];
      if (short.length) await confirmBox(`Đã giữ ${r.held.length} mã đến ${new Date(r.expiresAt).toLocaleString('vi-VN')}. Không đủ tồn khả dụng cho: ` + short.map(x => `${x.sku} (cần ${fmtNum(x.need)}, giữ được ${fmtNum(x.qty)})`).join('; ') + '.', { title: 'Giữ hàng một phần', ok: 'Đã hiểu' });
      else toast(`Đã giữ hàng ${r.days || 5} ngày cho ${r.held.length} mã.`);
    }
    loadHolds(true);
  } catch (ex) { toast(ex.message, 'err'); }
  finally { drawQuoteHold(); }
});
$('#quote-hold-extend').addEventListener('click', async e => {
  const id = editor.id; if (!id) return;
  e.target.disabled = true;
  try { editor.hold = await api(`/quotes/${encodeURIComponent(id)}/hold/extend`, 'POST', {}); toast('Đã gia hạn giữ hàng thêm 5 ngày.'); loadHolds(true); }
  catch (ex) { toast(ex.message, 'err'); } finally { e.target.disabled = false; drawQuoteHold(); }
});
/** Đọc lại khi mở/lưu báo giá và trước khi sinh, tránh dùng liên kết cũ hoặc sinh trùng. */
async function refreshQuoteDocument(id) {
  const request = editor.documentRequest = (editor.documentRequest || 0) + 1;
  editor.document = null; editor.documentError = false; editor.documentLoading = !!id;
  if (!id) return null;
  updateQuoteActions();
  try {
    const { order } = await api('/orders/by-quote/' + encodeURIComponent(id));
    if (editor.id !== id || editor.documentRequest !== request) return undefined;
    editor.document = order;
    return order;
  } catch (ex) {
    if (editor.id === id && editor.documentRequest === request) editor.documentError = true;
    return null;
  } finally {
    if (editor.id === id && editor.documentRequest === request) {
      editor.documentLoading = false; updateQuoteActions();
    }
  }
}
$('#quote-make').addEventListener('click', async () => {
  const id = editor.id; if (!id) return toast('Lưu báo giá trước.', 'err');
  const linked = await refreshQuoteDocument(id);
  if (editor.id !== id || linked === undefined) return;
  if (editor.documentError) return toast('Chưa kiểm tra được Đơn hàng / HĐKT. Vui lòng thử lại.', 'err');
  if (linked) return go('#/' + (linked.contractNo ? 'contracts/' : 'orders/') + encodeURIComponent(linked.id));
  const block = approvalBlock(); if (block) return toast(block, 'err');
  const flow = await chooseFlow(`${field('quoteNo').value} · ${field('customer').value || ''}`); if (!flow || editor.id !== id) return;
  const btn = $('#quote-make'); btn.disabled = true;
  try { await makeFromQuote(flow, { quoteId: editor.id, quoteNo: field('quoteNo').value, quoteType: editor.type, customer: field('customer').value, address: field('customerAddress').value }); }
  catch (ex) { toast(ex.message, 'err'); } finally { updateQuoteActions(); }
});

// ＋ ở trang Đơn hàng / HĐKT: chọn một báo giá đã duyệt (chưa có đơn) → tạo đơn / lập HĐKT.
let quotePickFlow = 'order';
async function drawQuotePick() {
  const box = $('#quote-pick-list'); box.innerHTML = '<li class="muted">Đang tải…</li>';
  try {
    const { quotes } = await api('/order-quote-candidates?q=' + encodeURIComponent($('#quote-pick-search').value));
    box.innerHTML = quotes.length ? quotes.map(q => `<li><button type="button" data-pick-quote="${esc(q.id)}" data-pick-type="${esc(q.quoteType)}"><b>${esc(q.quoteNo)}</b><span>${esc(q.customer)}</span><small>${esc(q.quoteType)}${q.quoteDate ? ' · ' + fmtDate(q.quoteDate) : ''}</small></button></li>`).join('')
      : '<li class="muted">Không có báo giá đã duyệt nào chưa có đơn.</li>';
  } catch (e) { box.innerHTML = `<li class="error">${esc(e.message)}</li>`; }
}
function openQuotePick(flow) {
  quotePickFlow = flow; $('#quote-pick-title').textContent = flow === 'contract' ? 'Lập HĐKT từ báo giá' : 'Tạo đơn hàng từ báo giá';
  $('#quote-pick-search').value = ''; $('#quote-pick-dialog').showModal(); drawQuotePick();
}
$('#orders-new').addEventListener('click', () => openQuotePick('order'));
$('#contracts-new').addEventListener('click', () => openQuotePick('contract'));
$('#quote-pick-search').addEventListener('input', debounce(drawQuotePick));
$('#quote-pick-list').addEventListener('click', async e => {
  const b = e.target.closest('[data-pick-quote]'); if (!b) return;
  b.disabled = true;
  const q = { quoteId: b.dataset.pickQuote, quoteNo: b.querySelector('b')?.textContent || '', quoteType: b.dataset.pickType || '', customer: b.querySelector('span')?.textContent || '' };
  try {
    if (quotePickFlow === 'contract') { $('#quote-pick-dialog').close(); await makeFromQuote('contract', q); }
    else if (await makeFromQuote('order', q)) $('#quote-pick-dialog').close(); else b.disabled = false;
  }
  catch (ex) { toast(ex.message, 'err'); b.disabled = false; }
});
$('#approve-quote').addEventListener('click', async () => {
  if (!(isManager() || editor.approval?.canApprove) || !editor.id) return;
  const btn = $('#approve-quote'); btn.disabled = true;
  try {
    const preflight = await api('/quotes/' + encodeURIComponent(editor.id) + '/approval-preflight');
    if (!isManager() && !preflight.purchaseCostsReady) { toast('Vui lòng nhờ Manager cập nhật giá mua trước khi duyệt báo giá.', 'err'); return; }
    if (!await confirmBox('Vui lòng kiểm tra bảng CK / giá mua từng mã trước khi duyệt. CK và giá anh đã nhập được giữ nguyên; anh có thể chọn CK gợi ý cho từng dòng.', {title:'Kiểm tra giá mua',ok:isManager()?'Cập nhật giá mua & duyệt':'Đã kiểm tra giá mua'})) return;
    if (isManager() && !await refreshPurchaseCosts()) return;
    if (editor.dirty) { await saveQuote(); if (editor.dirty) return; }
    const r = await api('/quotes/' + encodeURIComponent(editor.id) + '/approve', 'POST', { revision: editor.revision });
    editor.approval = { ...editor.approval, status: 'approved', at: r.approvedAt, by: r.approvedByName };
    toast('Đã duyệt báo giá. Có thể tải file, tạo đơn hàng, sinh HĐKT.'); loadQuotes(); refreshQuoteHold(editor.id);
  } catch (ex) { toast(ex.message, 'err'); }
  finally { updateQuoteActions(); }
});
$('#reject-quote').addEventListener('click', async () => {
  if (!(isManager() || editor.approval?.canApprove) || !editor.id || editor.approval?.status !== 'pending') return;
  if (editor.dirty) return toast('Báo giá đang có thay đổi chưa lưu. Lưu hoặc tải lại trước khi trả lại.', 'err');
  const reason = await reasonBox({ title: 'Trả lại báo giá', text: `Báo giá ${field('quoteNo').value} về nháp; người lập nhận thông báo kèm lý do để sửa rồi gửi duyệt lại.`, placeholder: 'VD: giá ly sứ thấp hơn giá sàn, kiểm tra lại chiết khấu', ok: 'Trả lại' });
  if (!reason) return;
  try {
    await api('/quotes/' + encodeURIComponent(editor.id) + '/reject', 'POST', { revision: editor.revision, reason });
    editor.approval = { ...editor.approval, status: 'draft' };
    toast('Đã trả lại báo giá cho người lập.'); loadQuotes();
  } catch (ex) { toast(ex.message, 'err'); }
  finally { updateQuoteActions(); }
});
$('#delete-quote').addEventListener('click', async () => {
  if (!editor.id || (!isManager() && editor.approval?.status === 'approved')) return;
  if (!await confirmBox(`Xoá báo giá ${field('quoteNo').value} · ${field('customer').value || 'Chưa nhập khách hàng'} khỏi hệ thống? Thao tác này không thể hoàn tác.`, { title: 'Xoá báo giá', ok: 'Xoá báo giá', danger: true, typeToConfirm: field('quoteNo').value || 'XOA' })) return;
  try {
    await api('/quotes/' + encodeURIComponent(editor.id), 'DELETE', { revision: editor.revision });
    editor.dirty = false; editor.id = null; toast('Đã xoá báo giá.'); go('#/quotes'); loadQuotes();
  } catch (ex) { toast(ex.message, 'err'); }
});
$('#submit-quote').addEventListener('click', async () => {
  if (!editor.id || editor.approval?.status !== 'draft') return;
  const btn = $('#submit-quote'); btn.disabled = true;
  try {
    if (editor.dirty) { await saveQuote(); if (editor.dirty) return; }
    await api('/quotes/' + encodeURIComponent(editor.id) + '/submit', 'POST', { revision: editor.revision });
    editor.approval = { ...editor.approval, status: 'pending' };
    toast('Đã gửi Manager duyệt báo giá.'); loadQuotes();
  } catch (ex) { toast(ex.message, 'err'); }
  finally { updateQuoteActions(); }
});
// Excel theo mẫu web cũ (excel-export.js): ảnh sản phẩm + letterhead, 2 sheet báo giá và phí vận chuyển.
// excel-export.js (chép từ web cũ) gọi QuoteMath.totals và HrcPdf.amountInWords.
globalThis.QuoteMath = { ...(globalThis.QuoteMath || {}), totals, after };
globalThis.HrcPdf = { ...(globalThis.HrcPdf || {}), amountInWords: n => moneyWords(n) };
function loadCanvasImage(src, timeoutMs = 15000) {
  return new Promise(resolve => {
    if (!src) return resolve(null);
    const img = new Image(); let done = false;
    const finish = v => { if (!done) { done = true; clearTimeout(t); resolve(v); } }, t = setTimeout(() => finish(null), timeoutMs);
    img.crossOrigin = 'anonymous'; img.referrerPolicy = 'no-referrer';
    img.onload = () => finish(img); img.onerror = () => finish(null); img.src = src;
  });
}
/**
 * Ảnh dòng báo giá cho PDF / Excel: link ngoài (Sapo CDN, link dán tay) thường không bật CORS nên trình duyệt không vẽ vào canvas được
 * → tải trực tiếp trước, không được thì nhờ máy chủ tải hộ (POST /images/fetch trả data URL). Mỗi link chỉ tải 1 lần mỗi lượt xuất file.
 */
function loadQuoteImages(rows) {
  const cache = new Map(), errors = [];
  /** Các link thử lần lượt: ảnh Google Drive (ảnh sản phẩm web cũ) đổi sang link ảnh thật (lh3, thumbnail) – link chia sẻ /file/d/… là trang HTML. */
  const sources = src => [...new Set([fallbackImage(src), displayImage(src), src].filter(Boolean))];
  const viaServer = url => api('/images/fetch', 'POST', { url }).then(r => loadCanvasImage(r.dataUrl), ex => { errors.push(ex.message); console.warn('Không tải được ảnh', url, ex.message); return null; });
  const one = src => {
    if (!src) return Promise.resolve(null);
    if (!cache.has(src)) cache.set(src, (async () => {
      const list = sources(src);
      // Ảnh riêng tư web cũ: dùng phiên máy chủ chung, không phụ thuộc máy người tải đã đăng nhập web cũ hay chưa.
      if (/^https:\/\/baogia\.minhlongonline\.com\/api\/staff\/media-file\?key=/i.test(src)) return viaServer(src);
      for (const u of list) { const img = await loadCanvasImage(u, 8000); if (img) return img; }
      for (const u of list.filter(x => /^https?:\/\//i.test(x))) { const img = await viaServer(u); if (img) return img; }
      return null;
    })());
    return cache.get(src);
  };
  // `out.errors`: lý do máy chủ không tải được (hiện ở thông báo để biết ảnh nào lỗi vì sao).
  return (async () => { const out = []; for (let i = 0; i < rows.length; i += 6) out.push(...await Promise.all(rows.slice(i, i + 6).map(r => one(r.image)))); out.errors = errors; return out; })();
}
let excelBusy = false;
$('#excel-quote').addEventListener('click', async () => {
  const block = approvalBlock(); if (block) return toast(block, 'err');
  if (excelBusy) return;
  const d = collectQuote(); if (!d.rows.length) return toast('Chưa có sản phẩm để xuất Excel.', 'err');
  if (!globalThis.QuoteExcel) return toast('Chưa tải được bộ tạo Excel. Vui lòng tải lại trang.', 'err');
  excelBusy = true; toast('Đang tạo file Excel…');
  try {
    const images = await loadQuoteImages(d.rows);
    const banner = await loadCanvasImage(d.type === 'VIGIFTS' ? 'vigifts-letterhead.png' : 'hrc-letterhead.jpg');
    await QuoteExcel.download(d, { images, banner });
    const missing = d.rows.filter((r, i) => r.image && !images[i]).length;
    toast('Đã tải file Excel gồm báo giá và phí vận chuyển' + (missing ? ` (${missing} ảnh không tải được nên để trống${images.errors[0] ? ': ' + images.errors[0] : ''})` : '') + '.', missing ? 'err' : undefined);
  } catch (ex) { console.error(ex); toast(ex?.message || 'Không thể tạo file Excel. Vui lòng thử lại.', 'err'); }
  finally { excelBusy = false; }
});
// Tin nhắn mới đến qua Web Push: cập nhật huy hiệu ngay (không chờ 20 giây).
if ('serviceWorker' in navigator) navigator.serviceWorker.addEventListener('message', e => { if (e.data?.type === 'bn-notification' && state.user) { chatView().refresh(); dataRefresh.request(); dataRefresh.tick(); } });




/**
 * Tự nhận bản giao diện mới: app mở sẵn (nhất là bản cài trên điện thoại) không tự tải lại nên vẫn chạy bản cũ.
 * Cứ 3 phút và mỗi lần quay lại app: đọc số phiên bản trong index.html trên máy chủ; khác bản đang chạy thì
 * tự tải lại khi không có báo giá đang sửa dở, còn đang sửa thì hiện thanh "Có bản mới – Tải lại".
 */
(() => {
  const running = $('#app-version')?.textContent?.trim();
  if (!running || running === '__BUILD__' || typeof fetch !== 'function') return;
  let shown = false;
  const busy = () => typeof editor !== 'undefined' && editor.dirty || !!document.querySelector('dialog[open]');
  async function check() {
    try {
      const html = await (await fetch('index.html', { cache: 'no-store' })).text();
      const latest = /id="app-version">([^<]+)</.exec(html)?.[1]?.trim();
      if (!latest || latest === '__BUILD__' || latest === running) return;
      if (!busy()) { location.reload(); return; }
      if (shown) return; shown = true;
      const bar = document.createElement('div'); bar.className = 'update-bar';
      bar.innerHTML = '<span>Đã có bản giao diện mới.</span><button type="button" class="btn primary small">Tải lại</button>';
      bar.querySelector('button').addEventListener('click', async () => { if (typeof editor === 'undefined' || !editor.dirty || await confirmBox('Báo giá đang có thay đổi chưa lưu. Vẫn tải lại?', { ok: 'Tải lại' })) location.reload(); });
      document.body.append(bar);
    } catch { /* mất mạng – lần sau kiểm tra lại */ }
  }
  setInterval(check, 180000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
})();
