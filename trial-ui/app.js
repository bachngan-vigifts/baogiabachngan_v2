Warning: truncated output (original token count: 132667)
Total output lines: 5940

import {requestOrderApproval,submissionSummary} from './order-submit.js';
import {createProductionFiles,mountProductionFiles} from './production-files.js';
import {initProductBrandFilter} from './product-brand-filter.js';
import {initWarehouseAssignment} from './warehouse-assignment.js';
import {initBulkQuoteDiscount,discountProduct} from './quote-bulk-discount.js';
import {saleLineHead,saleLineCell,saleDesignProblem,createSalePriceSuggestions,fetchSaleSuggestions} from './sale-quote-layout.js';
import {deliveryTone,deliveryIsOverdue,fulfilmentLegend,fulfilmentBadge,compactFulfilmentTable} from './fulfilment-display.js';
import {initWarehouseWorkspace} from './warehouse-workspace.js';
import { createNotificationFeed } from './notification-feed.js';
import {productThumbnailUrl,noteThumbnailFailure} from './product-images.js';
import {bindQuoteEditRequests} from './quote-edit-requests.js';
import {initOrderProducts} from './order-products.js';
import { createDeliveryCalendar, renderDeliveryProducts } from './delivery-calendar.js';
import {initCustomerCenter} from './customer-center.js';
import {openProvinceSharing} from './customer-province-sharing.js';
import {orderListExportSheets} from './order-list-export.js';
import {initWebOrderDocument,webDocumentMode} from './web-order-document.js';
import {renderWebOrderDetail} from './web-order-detail.js';
import {mountCashCollections} from './cash-collections.js';
import {returnStateText} from './order-return-summary.js';
import {mountContractLiquidation} from './contract-liquidation.js';
import { initQuoteStockWarnings } from './quote-stock-warning.js';
import { parseSkuQuantities, pasteRows } from './quote-paste.js';
import { hasCustomerListFilters, customerListQuery, fillCustomerProvinces, fillCustomerOwners, bindCustomerListFilters, updateCustomerFilterSummary } from './customer-list-filters.js';
import { openAppsheetCustomers } from './appsheet-customers.js';
import {openPriceLabels} from './price-labels.js';
import {ghnOrderSummary} from './ghn-order-summary.js';
import {initProductDetail} from './product-detail.js';
import { createPageBack } from './page-back.js';
import { installChatFab } from './mobile-chat-fab.js';
import { bindForgotPassword } from './forgot-password.js';
import { mountTurnstile } from './turnstile.js';
import { apiFetch, writeFailureMessage, UNKNOWN_OUTCOME } from './api-transport.js';
import { createRequestPriority, isBackgroundRequest } from './request-priority.js';
import { recordApi, openSpeedDialog } from './speed-log.js';
import { createApiRegion, createRegionCanary, requestWithRegion } from './api-region.js';
import { createDbPoolCanary, runLoadTest } from './db-pool-canary.js';
import { createPageCache, isCacheable, isPassiveWrite } from './page-cache.js';
import { createCustomerSearch } from './customer-search.js';
import { openDueRepair } from './due-repair.js';
import { sendOnce } from './request-keys.js';
import { bindQuoteDeviceDraft } from './quote-device-draft.js';
import { createSessionResume } from './session-resume.js';
import { openMobileQuoteCapture } from './mobile-quote-capture.js';
import { createApprovalFeed } from './approval-feed.js';
import { initApprovalLauncher } from './approval-launcher.js';
import { installBusyButtons, withBusy } from './busy-buttons.js';
import { bindCustomerDuplicateCheck } from './customer-duplicate-check.js';
import { initReceivingCalendar } from './receiving-calendar.js';
import { documentSequence, nextDocumentNumber } from './document-number.js';
import { orderRecipient } from './order-notes.js';
import { customerFormFields } from './customer-form-fields.js';
import { initCustomerFormSteps } from './customer-form-steps.js';
import { bindCustomerTypeOptions } from './customer-type-options.js';
import { customerCreateProfile } from './customer-create-profile.js';
import { initPackingSupplierChoices } from './packing-supplier-choices.js';
import { initPackingEarlyRequest } from './packing-early-request.js';
import { reviewPurchaseCosts, missingPurchaseCost } from './purchase-cost-review.js';
import { confirmApprovalDebt, reviewOrderCosts } from './approval-preflight.js';
import { openPosOrderFlows } from './pos-order-flow.js';
import { openPosReturns } from './pos-returns.js';
import { openCrmReturns } from './crm-returns.js';
import { openPosQuickCancel } from './pos-quick-cancel.js';
import { openBarcodeImport } from './barcode-import.js';
import { posOrderEditor, posCodReceipt, posPaymentText, posGhnEditNotice } from './pos-order-edit.js';
import { renderOrderLineDetails } from './order-line-details.js';
import { initCash } from './cash.js';
import { initShiftReports } from './shift-reports.js';
import { initPos } from './pos.js';
import { shortageRows, downloadShortagePdf } from './stock-shortage-pdf.js';
import { bindStockCheckFilter } from './stock-check-filter.js';
import { downloadExcel, readSheet } from './sheet-export.js';
import { TEMPLATE_HEADER, TEMPLATE_SAMPLE, parseStatement, matchStatement, bankKey, bankReference } from './bank-statement.js';
import { orderSapoAction } from './order-sapo.js';
import { initOrderPrintForm } from './order-print-form.js';
import { initQuoteSourcing } from './quote-sourcing.js';
import { initOrderCreate } from './order-create.js';
import { initDashboard } from './dashboard.js';
import { initProfit } from './profit.js';
import { initFeedback } from './feedback.js';
import { initAiChat } from './ai-chat.js';
import { initStoreReports } from './store-reports.js';
import { initWeeklyReports } from './weekly-reports.js';
import { initFlowMap } from './flow-map.js';
import { initSuppliers } from './suppliers.js';
import { initPurchases } from './purchases.js';
import { initEarlyRequestPage } from './early-request-page.js';
import { installSidebarGroups } from './sidebar-groups.js';
// Bách Ngân · Báo giá – giao diện dùng thử v2 (JS thuần, không cần build).
// Tính tiền dùng đúng hàm của máy chủ: quote-math.js được sinh từ src/modules/quotes/domain/quote-math.ts.
import { hydrateSnapshot, matchRanges, searchProducts as searchCatalog } from './product-search.js';
import { defaultPaymentTerms, withPaymentNotes } from './quote-payment.js';
import { setupNotifications } from './notify.js';
import { setupDataRefresh } from './auto-refresh.js';
import { printSheet } from './print-page.js';
import { createPager } from './pager.js';
import { showAudit } from './audit-ui.js';
import { watchCsp } from './csp-report.js';
import { verifyBox, duePill, allocatePayments, installmentStatus } from './verify.js';
import { orderReference, orderPrintData, orderSheetHtml, readEdits, downloadOrderExcel, sellerOf, SELLERS, SLIP_KINDS, packingPrintData, deliveryPrintData, transferPrintData, slipSheetHtml } from './order-print.js';
import { openContractDocs } from './contract-ui.js';
import { initTasks } from './tasks.js';
import { initCare } from './care.js';
import {initQuoteCarePrompt} from './quote-care-prompt.js';
import { initChat } from './chat.js';
import { setupPulse } from './pulse.js';
import { initInventory } from './inventory.js';
import { initStocktake } from './stocktake.js';
import { initTransfers, initStockMoves, initSellerConfig } from './stock-ops.js';
import { showOrderHolds } from './order-holds.js';
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
import {openSelfRevenueTargets} from './revenue-target-requests.js';
import { quoteStockSku, manualLineDescription, manualLineNote, totals, after, profit, commissionOf, discounted, normalize, netPrice, defaultCostDiscount, purchasePrice, costModeOf, parsePurchaseCost, applyPurchaseCost, syncPurchaseCost, printingInfo, customerDiscount, printingWorkshops as DEFAULT_WORKSHOPS, brandDiscountKey } from './quote-math.js';
installBusyButtons(); // nút gửi API ghi tự khoá + vòng xoay đang xử lý (busy-buttons.js)

const API = document.querySelector('meta[name="bn-api"]')?.content
  || 'https://taceqfnsorewelsbdckg.supabase.co/functions/v1/baogia-v2-api/api/staff';
const SESSION_KEY = 'bn-v2-session';

// ---------------------------------------------------------------- tiện ích
const $ = s => document.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
installSidebarGroups();
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
const imgTag = (url, cls = 'thumb') => {
  if (!/^(https:\/\/|data:image\/)/i.test(url || '')) return `<span class="${cls}">${PLACEHOLDER}</span>`;
  const original = displayImage(url), source = cls.includes('big') ? original : productThumbnailUrl(original);
  const fallback = source !== original ? original : fallbackImage(url);
  return `<img class="${cls}" src="${esc(source)}" data-fallback="${esc(fallback)}" alt="" loading="lazy" decoding="async" ${cls.includes('big') ? '' : 'width="64" height="64"'} referrerpolicy="no-referrer">`;
};
// Ảnh lỗi: thử nguồn dự phòng một lần, sau đó thay bằng biểu tượng.
document.addEventListener('error', e => {
  const img = e.target;
  if (!(img instanceof HTMLImageElement) || !img.classList.contains('thumb')) return;
  if (img.dataset.fallback) { noteThumbnailFailure(img.currentSrc || img.src); img.src = img.dataset.fallback; img.dataset.fallback = ''; return; }
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
  window.dispatchEvent(new Event('ui:toast')); // mở khoá nút xuất file đang chờ (busy-buttons.js)
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
function confirmBox(text, { title = 'Xác nhận', ok = 'Đồng ý', danger = false, delay = danger ? 1500 : 0, typeToConfirm = '', mobileAllowed = false } = {}) {
  const dlg = $('#confirm-dialog'), okBtn = $('#confirm-ok'), cancelBtn = $('#confirm-cancel'), wrap = $('#confirm-type'), input = $('#confirm-type-input');
  if(mobileAllowed){dlg.setAttribute('data-mobile-confirmation-page','');okBtn.classList.remove('mobile-desktop-only');cancelBtn.classList.remove('mobile-desktop-only');}else dlg.removeAttribute('data-mobile-confirmation-page');
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
    const done = v => { clearInterval(timer); dlg.close();dlg.removeAttribute('data-mobile-confirmation-page'); okBtn.onclick = cancelBtn.onclick = input.oninput = input.onkeydown = null; okBtn.disabled = false; okBtn.textContent = ok; resolve(v); };
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
// Máy chủ tự gia hạn phiên khi còn dùng; chỉ bấm Đăng xuất, đổi mật khẩu hoặc bỏ app quá 7 ngày mới phải đăng nhập lại.
try { token = localStorage.getItem(SESSION_KEY) || sessionStorage.getItem(SESSION_KEY) || ''; if (token) { localStorage.setItem(SESSION_KEY, token); sessionStorage.removeItem(SESSION_KEY); } } catch { /* trình duyệt chặn lưu trữ */ }
const saveToken = t => { const next=t||'';if(next!==token||!next){sessionResume.clear();clearPageCache();}token=next;try { if (token) localStorage.setItem(SESSION_KEY, token); else { localStorage.removeItem(SESSION_KEY); sessionStorage.removeItem(SESSION_KEY); } } catch { /* bỏ qua */ } };
const sessionResume=createSessionResume({storage:()=>localStorage,readToken:()=>token,verify:()=>api('/me'),open:openWorkspace,refresh:refreshWorkspaceUser});

const requestPriority = createRequestPriority();
createApiRegion(); // ép vùng tự học đã tắt (sự cố 30/10) – gọi để xoá vùng cũ còn lưu trên máy
// Thử pooler có kiểm soát (Manager bật trên máy mình trong "Đo tốc độ"); máy chủ chưa có secret thử thì bỏ qua header.
const dbPoolCanary = createDbPoolCanary();
// isManager / state khai báo sau: lượt gọi sớm lúc khởi động (trước khi có state) không gửi header thử.
const managerPoolHeaders = () => { try { return isManager() ? dbPoolCanary.headers() : {}; } catch { return {}; } };
const regionCanary = createRegionCanary({ onDisabled: () => toast('Kết nối chậm – đã tạm chuyển máy chủ dự phòng, sẽ tự kiểm tra lại kết nối.', 'err') });
// Mạng có lại / quay lại tab: lượt đọc kế tiếp thử lại máy chủ cạnh CSDL ngay (không chờ hết thời gian chờ).
window.addEventListener('online', () => regionCanary.wake());
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') regionCanary.wake(); });
/** Một lượt GET đo tải (không qua hàng đợi ưu tiên / bộ đệm / thử lại): chọn pooler hay kết nối trực tiếp cho riêng lượt này. */
async function dbPoolProbe(path, { pool = false } = {}) {
  const started = performance.now();
  const res = await fetch(API + path, { headers: { authorization: 'Bearer ' + token, ...(regionCanary.enabled() ? { 'x-region': regionCanary.current() } : {}), ...(pool ? { 'x-db-pool': 'pooler' } : {}) } });
  await res.text();
  return { ms: performance.now() - started, status: res.status, timing: res.headers.get('server-timing') || '' };
}
// Đổi tài khoản / đăng xuất: xoá bộ đệm (cả bản lưu trên máy) – saveToken có thể chạy trước khi dòng dưới được khởi tạo.
function clearPageCache() { try { pageCache.clear(); } catch { /* chưa khởi tạo */ } }
const pageCache = createPageCache({ storage: { local: () => localStorage, session: () => sessionStorage } }); // trang mở lại hiện ngay, giữ qua tải lại trang (page-cache.js)
// Tìm khách ở hai ô chọn khách: kết quả đã có / lọc được trên máy thì hiện ngay, còn lại mới hỏi máy chủ (customer-search.js).
const customerSearch = createCustomerSearch({ api });
class ApiError extends Error { constructor(message, status, code) { super(message); this.status = status; this.code = code; } }
/** Gọi API; lời gọi ghi khoá nút vừa bấm tới khi xong (busy-buttons.js – chống bấm trùng, có vòng xoay đang xử lý). */
function api(path, method = 'GET', body, { fresh = false } = {}) {
  // Trang đã mở gần đây: hiện ngay bản đệm, tải bản mới ở nền, khác thì vẽ lại (page-cache.js).
  if (isCacheable(path, method)) {
    const session = token, hit = !fresh && pageCache.get(path, session);
    if (hit) { if (!hit.recent) revalidate(path, session, location.hash); return Promise.resolve(hit.data); }
    return withBusy(method, apiRequest(path, method, body), path).then(data => { if (session === token) pageCache.set(path, session, data); return data; });
  }
  const request = withBusy(method, apiRequest(path, method, body), path);
  // Mọi lệnh ghi (kể cả lỗi – có thể máy chủ đã lưu) làm bản đệm cũ đi: lần mở sau lấy dữ liệu mới.
  if (method !== 'GET' && !isPassiveWrite(path)) { const stale = () => { pageCache.clear(); customerSearch.clear(); }; request.then(stale, stale); }
  return request;
}
/** Tải bản mới của trang đang hiện từ bản đệm; khác bản đệm và vẫn đang ở trang đó thì làm mới trang. */
function revalidate(path, session, hash) {
  apiRequest(path).then(data => {
    if (session !== token) return;
    if (pageCache.set(path, session, data) && location.hash === hash) dataRefresh.changed();
  }).catch(e => {
    // Mất quyền / bản ghi đã xoá: bỏ bản đệm và vẽ lại trang (trang tự báo lỗi hoặc chuyển đi) thay vì giữ dữ liệu cũ.
    // Phiên hết hạn (401): bỏ bản đệm; màn hình đăng nhập đã được apiRequest mở.
    if (session === token && [401, 403, 404, 410].includes(e?.status)) { pageCache.drop(path); if (e.status !== 401 && location.hash === hash) dataRefresh.changed(); }
    /* mạng lỗi / 5xx: giữ bản đang hiện, lần sau thử lại */
  });
}
async function apiRequest(path, method = 'GET', body) {
  const headers = { 'content-type': 'application/json' };
  const requestRoute = location.hash;
  const requestToken = token;
  if (requestToken) headers.authorization = 'Bearer ' + requestToken;
  let res;
  // Trang đang mở tải trước; số đếm menu, chuông, nhịp kiểm tra… chờ một nhịp (request-priority.js).
  // Máy chủ cạnh CSDL (mặc định bật, api-region.js): thêm header x-region; lỗi là tắt và giữ tắt trên máy này.
  let sentAt = 0, sentWall = 0;
  // Đo tốc độ: từng lần gửi thật (thử lại khi quá giờ / 502–504, chuyển máy chủ dự phòng) – để không gộp chúng vào "mạng".
  const attempts = [];
  const send = (regionHeaders, readPolicy) => requestPriority.run(isBackgroundRequest(path, method), () => { if (!sentAt) { sentAt = performance.now(); sentWall = Date.now(); } const region = !!regionHeaders?.['x-region']; return apiFetch(API + path, { method, headers: { ...headers, ...regionHeaders, ...managerPoolHeaders() }, body: body === undefined ? undefined : JSON.stringify(body) }, { ...readPolicy, onAttempt: a => attempts.push({ ...a, region }) }); });
  try { res = await requestWithRegion(regionCanary, send, {read: method === 'GET'}); }
  catch {
    throw method === 'GET' ? new ApiError('Chưa kết nối được máy chủ. Vui lòng kiểm tra mạng rồi thử lại.', 0) : new ApiError(writeFailureMessage(body), 0, UNKNOWN_OUTCOME);
  }
  const headersAt = performance.now();
  const data = await res.json().catch(() => ({ error: 'Máy chủ chưa sẵn sàng. Vui lòng thử lại.' }));
  recordApi({ path, method, ms: performance.now() - sentAt, status: res.status, serverTiming: res.headers?.get('server-timing'), readMs: performance.now() - headersAt, attempts, wallMs: Date.now() - sentWall }); // menu → Đo tốc độ
  // Phản hồi của phiên cũ không được xoá / thay thế phiên vừa đăng nhập.
  const sameSession = requestToken === token;
  // Phản hồi thuộc phiên trước (vừa đổi tài khoản): không trả dữ liệu cho phiên mới. Mã 409 (không phải 0) để màn hình không coi là
  // "chưa rõ đã lưu" rồi gửi lại lệnh của người trước bằng tài khoản mới.
  if (!sameSession) throw new ApiError('Phiên đăng nhập đã thay đổi; kết quả thuộc phiên trước.', 409, 'STALE_SESSION');
  if (sameSession && data.sessionToken !== undefined) saveToken(data.sessionToken);
  if (!res.ok) {
    if (res.status === 401 && requestToken && sameSession && !['/login', '/activate', '/password', '/logout'].includes(path)) { showAuth('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.'); }
    throw new ApiError(data.error || 'Không thực hiện được thao tác.', res.status, data.code);
  }
  if (state.user && sameSession) {
    if (method !== 'GET' && /^\/(quotes|orders|contracts|purchase-orders|stock-transfers|customers|products|cash|pos)(\/|\?|$)/.test(path)) approvalUi?.scheduleRefresh();
    if(method!=='GET'&&state.user?.role==='manager'&&/^\/(packing|stock-transfers|purchase-orders|purchase-early-requests)(\/|$)/.test(path))globalThis.dispatchEvent?.(new CustomEvent('crm:warehouse-source-written',{detail:{path,method,data,body}}));
    if (method === 'GET') dataRefresh.observe(path, data, requestRoute);
    else if (/^\/(quotes|orders|contracts|deliveries|payments|stock-requests|stock-transfers|packing|purchase-orders|purchase-early-requests|supplier-receipts|supplier-payments|customers|products|tasks|care|customer-care|admin\/members|hr|payroll)(\/|\?|$)/.test(path)) dataRefresh.afterWrite(); // một lần làm mới (gồm số đếm menu) sau ~1 giây, không đọc lại 7–20 API nối đuôi
  }
  return data;
}
// CSP chỉ báo cáo: vi phạm gửi về máy chủ khi đã đăng nhập.
watchCsp(r => { if (!token) return false; api('/csp-report', 'POST', r).catch(() => {}); return true; });

initAvatars(api); // ô nào có data-av tự hiện ảnh đại diện

// ---------------------------------------------------------------- trạng thái
let approvalUi = null;
const state = {
  user: null, quotes: null, customers: null, members: null, positions: [],
  quoteFilter: { q: '', type: '', owner: '', sort: 'created' },
  customerQuery: '', customerTotal: 0, memberQuery: '', memberStatus: '',
  products: null, productTotal: 0, productQuery: '', productBrand: '', productBrands: [], productWarehouse: '', productMinStock: '', policies: [], warehouses: [], selected: new Map(),
};
const isManager = () => state.user?.role === 'manager';
const canUpdateProducts = () => ['manager', 'employee'].includes(state.user?.role);
/** Phê duyệt (báo giá, khách mới, sản phẩm mới, đơn / HĐKT, đơn mua NCC): Manager hoặc người được Manager bật cờ "Được duyệt". Máy chủ kiểm lại. */
const canApprove = () => isManager() || state.user?.approver === true;
/** Tài khoản Kho (chức vụ "warehouse"): chỉ các trang cần cho kho – Công việc, Lịch giao hàng, Phiếu đóng gói, Sản phẩm, Tin nhắn. */
const isWarehouse = () => state.user?.role === 'employee' && state.user?.positionId === 'warehouse';
/**
 * Quyền theo chức vụ (trang Phân quyền – máy chủ trả trong /me, kiểm tra lại ở mọi API). Manager luôn có mọi quyền.
 * Máy chủ chưa có bảng quyền (chưa chạy migration 0065) thì dùng đúng quyền cũ theo chức vụ.
 */
const OFFICE_PAGES = ['page.quotes', 'page.orders', 'page.order-products', 'page.contracts', 'page.deliveries', 'page.receivables', 'page.customers', 'page.care', 'page.stock-requests', 'page.dashboard', 'page.flow', 'page.purchases'];
const legacyPerms = () => isWarehouse() ? ['page.deliveries', 'page.purchases', 'page.packing', 'page.stock-lookup', 'purchases.receive']
  : state.user?.positionId === 'accounting' ? [...OFFICE_PAGES, 'page.sepay', 'purchases.prices', 'purchases.pay', 'suppliers.edit'] : OFFICE_PAGES;
const can = key => isManager() || (Array.isArray(state.user?.perms) ? state.user.perms : legacyPerms()).includes(key);
/** Trang (#/…) → quyền cần có. Trang không có ở đây (Công việc, Sản phẩm…) ai cũng vào được. */
const PAGE_PERM = {
  sepay: 'page.sepay', 'product-custody':'page.product-custody', cash: 'page.cash', pos: 'pos.sell', 'shift-reports': 'pos.sell',
  quotes: 'page.quotes', editor: 'page.quotes', orders: 'page.orders', 'order-products':'page.order-products', contracts: 'page.contracts', receiving: 'page.purchases', deliveries: 'page.deliveries', receivables: 'page.receivables', cashbook: 'page.cashbook',
  customers: 'page.customers', customer: 'page.customers', care: 'page.care', 'stock-requests': 'page.stock-requests', dashboard: 'page.dashboard', flow: 'page.flow',
  purchases: 'page.purchases', 'early-requests': 'purchases.early-view', packing: 'page.packing', 'stock-lookup': 'page.stock-lookup', inventory: 'inventory.view', stocktake: 'inventory.view', suppliers: 'suppliers.edit', permissions: 'perm.manage',
};
/** Giá bán: người làm báo giá / đơn / HĐKT (khớp máy chủ – Kho không nhận giá). */
const seesPrices = () => isManager() || can('page.quotes') || can('page.orders') || can('page.contracts');
const canAccounting = () => isManager() || state.user?.role === 'employee' && state.user?.positionId === 'accounting';
const canPage = view => view === 'accounting' ? canAccounting() : view === 'finance' ? isManager() : view === 'order' ? can('page.orders') || can('page.contracts') || can('page.receivables') : !PAGE_PERM[view] || can(PAGE_PERM[view]);
/** Link "#/<trang>/<id>" mở được với quyền hiện tại (cùng cách `route()` đổi trang chi tiết) – không thì hiện chữ, không đưa người dùng về trang chủ. */
const linkAllowed = hash => {
  const [view, id] = String(hash).replace(/^#\//, '').split(/[/?]/);
  const detail = id && view === 'quotes' ? 'editor' : id && (view === 'orders' || view === 'contracts') ? 'order' : id && view === 'customers' ? 'customer' : id && view === 'packing' ? 'packing-slip' : view;
  return canPage(detail);
};
/** Danh bạ NCC: Manager và chức vụ có quyền "Danh bạ NCC" (mặc định Kế toán; máy chủ kiểm lại). */
const canEditSuppliers = () => can('suppliers.edit');
/** Kết quả huỷ vận đơn GHN kèm khi huỷ đơn / chuyến Ship COD quầy Lock (máy chủ: pos-ghn-cancel.ts). */
const ghnCancelNote = r => !r?.ghnCancel ? '' : (r.ghnCancel.cancelled.length ? ` Đã huỷ vận đơn GHN ${r.ghnCancel.cancelled.join(', ')}.` : '')
  + (r.ghnCancel.errors.length ? ` Chưa huỷ được trên GHN: ${r.ghnCancel.errors.map(e => e.code + ' – ' + e.message).join('; ')}. Huỷ trên trang GHN.` : '');
const KHO_HOME = '#/kho';
/** Kế toán: chức vụ "accounting". */
const isAccountant = () => state.user?.role === 'employee' && state.user?.positionId === 'accounting';
/** NVBH ML/LOCK có lối tắt POS trên Trang chủ khi được cấp quyền bán hàng. */
const isCounterSales = () => state.user?.role === 'employee' && ['sales-ml', 'sales-lock'].includes(state.user?.positionId) && can('pos.sell');
/** Nhân viên Kho vào không gian công việc riêng; các chức vụ khác giữ Trang chủ chung. */
const homeHash = () => isWarehouse() ? KHO_HOME : '#/home';
let loginToHome = false;

// ---------------------------------------------------------------- đăng nhập / kích hoạt
bindForgotPassword({button:$('#forgot-password'),api,email:()=>$('#email').value});
// Chống bot ở đăng nhập (chỉ khi máy chủ đã bật Turnstile).
const loginBot = mountTurnstile({ api, before: $('#login-button'), action: 'login' });
const hashParams = () => new URLSearchParams(location.hash.slice(1));
let activation = /(^|&)token=/.test(location.hash.slice(1)) ? hashParams().get('token') : null;

function showAuth(message = '', { keepToken = false } = {}) {
  if (typeof productBrandFilter !== 'undefined') productBrandFilter?.close();
  const auth = $('#auth'), opening = auth.hidden;
  if (typeof shiftReportsUi !== 'undefined') shiftReportsUi?.close();
  if (typeof financeUi !== 'undefined') financeUi?.close();
  if (typeof sepayUi !== 'undefined') sepayUi?.close();
  if (typeof accountingUi !== 'undefined') accountingUi?.close();
  if (typeof suppliersUi !== 'undefined') suppliersUi?.close();
  if(typeof khoHomeUi!=='undefined')khoHomeUi?.close();
  if(typeof warehouseAssignmentUi!=='undefined')warehouseAssignmentUi?.close();
  stocktakeUi?.close();
  state.user = null; dataRefresh?.stop(); if (!keepToken) saveToken('');
  homeUi?.reset(); homeNotifications?.clear(); notifier?.reset(); tasksUi?.resetQuick();
  $('#workspace').hidden = true; $('#auth').hidden = false; $('#chat-launcher').hidden = true; approvalUi?.stop(); if (typeof storeUi !== 'undefined') storeUi?.stop(); if (chatUi) chatUi.hide(); if (typeof pulse !== 'undefined') pulse.stop();
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
    await api('/login', 'POST', { email, password, turnstileToken: loginBot.token() });
    $('#password').value = ''; $('#password2').value = '';
    await enter();
  } catch (ex) { err.textContent = ex.message; loginBot.reset(); }
  finally { btn.disabled = false; }
});

async function enter() {
  loginToHome = true;
  try { await sessionResume.resume({useCache:false}); }
  finally { loginToHome = false; }
}
function applyWorkspaceUser(user) {
  if (user.role === 'supplier' || user.positionId === 'supplier') {
    location.replace('supplier.html');
    return;
  }
  if (user.role === 'customer' || user.positionId === 'customer') { location.replace('customer.html'); return; } // tài khoản khách: chỉ trang khách hàng
  state.user = user;
  $('#workspace').dataset.homeHref = homeHash();
  $('#auth').hidden = true; $('#workspace').hidden = false;
  $('#user-name').textContent = $('#menu-name').textContent = user.name;
  $('#menu-email').textContent = user.email;
  $('#user-role').textContent = user.position || (user.role === 'manager' ? 'Manager' : 'Nhân viên');
  $('#user-avatar').textContent = $('#account-button-m').textContent = initials(user.name);
  showOwnAvatar(user.avatar);
  $$('.manager-only').forEach(el => el.hidden = !isManager());
  $('#my-sales-targets').hidden=!['sale','sale-admin'].includes(user.positionId);
  // Kho: Trang kho + thanh dưới riêng (Trang chủ · Đóng gói · Nhận hàng · Giao hàng · Tra tồn).
  $$('.kho-nav, .kho-only').forEach(el => el.hidden = !isWarehouse());
  // Menu theo quyền của chức vụ (trang Phân quyền): mục nào chức vụ chưa được cấp thì ẩn.
  $('[data-nav=accounting]').hidden = !canAccounting();
  $$('[data-nav]').forEach(el => { const k = PAGE_PERM[el.dataset.nav]; if (k && !(el.classList.contains('kho-only') && !isWarehouse())) el.hidden = !can(k); });
  $$('.ww-nav').forEach(el=>el.hidden=!(isManager()||isWarehouse()));
  $$('.perm-admin-only').forEach(el => el.hidden = !can('perm.manage'));
  $$('[data-nav=tasks]').forEach(el => { if (isWarehouse()) el.hidden = true; });
  document.body.classList.toggle('role-warehouse', isWarehouse());
  document.body.classList.toggle('role-accounting', isAccountant());
  return true;
}
function openWorkspace(user) {
  if(!applyWorkspaceUser(user))return;
  const directDocument = /^#\/[^/?]+\/(?!new(?:[/?]|$))[^/?]+/.test(location.hash);
  if ((loginToHome && !directDocument) || !/^#\//.test(location.hash)) history.replaceState(null, '', location.pathname + homeHash());
  currentHash = location.hash;
  route();
  loadAll();
  notifier.start(); dataRefresh.start(); pulse.start();
  // Không chụp mốc /quotes, /orders, /contracts lúc mở app (3 lượt đọc nặng mỗi lần mở, /orders ~270 KB): dữ liệu của trang đang
  // xem đã có mốc qua observe(); nhịp /pulse báo có thay đổi thì tick() so sánh đúng các đường dẫn đó và tải lại trang.
}
function refreshWorkspaceUser(user) {
  const access=u=>JSON.stringify([u?.role,u?.positionId,u?.perms,u?.approver,u?.dataScope,u?.departmentId]);
  const previous=access(state.user);
  if(!applyWorkspaceUser(user))return;
  if(previous!==access(user)){homeNotifications?.clear();notifier?.reset();notifier?.start();route();loadAll();}
}

// ---------------------------------------------------------------- tài khoản
function toggleAccountMenu(force) {
  const menu = $('#account-menu'), open = force ?? menu.hidden;
  menu.hidden = !open; $('#account-button').setAttribute('aria-expanded', String(open));
}
$('#account-button').addEventListener('click', e => { e.stopPropagation(); toggleAccountMenu(); });
$('#account-button-m').addEventListener('click', e => { e.stopPropagation(); toggleAccountMenu(); });
document.addEventListener('click', e => { if (!e.target.closest('#account-menu')) toggleAccountMenu(false); });
$('#speed-check').addEventListener('click', () => { toggleAccountMenu(false); openSpeedDialog({ toast, canary: isManager() ? regionCanary : null, dbPool: isManager() ? { canary: dbPoolCanary, runLoad: opts => runLoadTest(dbPoolProbe, opts) } : null }); });
$('#send-feedback').addEventListener('click', () => { toggleAccountMenu(false); feedbackView().openNew(); });
$('#logout').addEventListener('click', async () => {
  const session = token, user = state.user;
  toggleAccountMenu(false);
  if (stocktakeUi?.hasDraft() && !await stocktakeUi.beforeLeave()) return;
  if (editor.dirty && !await confirmBox('Báo giá đang sửa chưa được lưu. Vẫn đăng xuất?', { ok: 'Đăng xuất' })) return;
  if (session !== token || user !== state.user) return;
  editor.dirty = false;
  quoteDeviceDraft.logout();
  try { await api('/logout', 'POST', {}); } catch (e) { if (e.code === 'STALE_SESSION') return; /* vẫn thoát phiên hiện tại khi mất mạng */ }
  // /logout có thể đã xoá token của chính phiên này; không xoá phiên mới đăng nhập.
  if (user !== state.user || (token && token !== session)) return;
  state.quotes = state.customers = state.members = state.products = null;state.memberLoadError='';
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
$('#my-sales-targets').addEventListener('click',async()=>{
 toggleAccountMenu(false);
 const year=new Intl.DateTimeFormat('en',{timeZone:'Asia/Ho_Chi_Minh',year:'numeric'}).format(new Date());
 try{await openSelfRevenueTargets({api,esc,toast,confirmBox},year);}catch(e){toast(e.message,'err');}
});
$('#my-bank').addEventListener('click', () => { toggleAccountMenu(false); go('#/members/' + encodeURIComponent(state.user.id) + '?tab=bank'); });
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
/** `known`: số đếm đã có (từ GET /badges) → không gọi máy chủ. */
async function loadNavigationBadges(known) {
  const request = ++navigationBadgeRequest, user = state.user;
  try {
    const counts = known || await api('/navigation-counts');
    if (request !== navigationBadgeRequest || user !== state.user) return;
    for (const [name, id] of [['receiving', 'nav-receiving-count'], ['packing', 'nav-packing-count'], ['deliveries', 'nav-deliveries-count'], ['purchases', 'nav-purchase-count'], ['cash', 'nav-cash-count'], ['transfers', 'nav-transfer-count']]) {
      const badge = document.getElementById(id); if (!badge) continue;
      const count = Number(counts[name] || 0); badge.textContent = count.toLocaleString('vi-VN'); badge.hidden = count <= 0;
    }
  } catch { /* Keep last known badges during a temporary connection failure. */ }
}
async function loadAll() {
  clearGlobalError();
  if (location.hash.split('?')[0] === '#/home') {
    // Home never preloads full quotes/customers/members/catalog or the 500-row task board.
    loadBadges({startChat:true}); $('#chat-launcher').hidden=false;
    approvalView().start(); storeView().start(); weeklyView().start();
    return;
  }
  // Chỉ tải dữ liệu của trang chức vụ được cấp quyền (máy chủ chặn phần còn lại) – tránh báo lỗi đỏ khi mở app.
  // Danh sách báo giá / khách / nhân viên dùng ở nhiều chỗ nên luôn tải, nhưng nếu đang mở trang khác thì chờ trang đó tải xong.
  const page = location.hash.replace(/^#\/?/, '').split(/[/?]/)[0] || 'quotes';
  const later = (home, load) => home.includes(page) ? load() : requestPriority.idle().then(() => state.user ? load() : undefined);
  const jobs = [can('page.quotes') && later(['quotes'], loadQuotes), can('page.customers') && later(['customers'], loadCustomers)].filter(Boolean);
  // Ô đồng bộ Sapo chỉ hiện ở trang Nhân viên: tải khi mở trang đó (route), không tải lúc mở app.
  if (isManager()) jobs.push(later(['staff', 'members'], loadMembers));
  loadBadges({ startChat: true }); $('#chat-launcher').hidden = false; approvalView().start(); storeView().start(); weeklyView().start();
  loadCatalogSnapshot(); // tải sẵn danh mục để "Tìm nhanh sản phẩm" lọc ngay khi gõ (không chờ)
  await Promise.all(jobs);
  // Tải sẵn bảng Công việc lúc rảnh: lần bấm đầu vào trang Công việc hiện ngay (sau đó vẫn tải bản mới ở nền).
  setTimeout(() => { if (state.user) tasksView().prefetch(); }, 2500);
}
// A background list must not mark an unrelated page as disconnected.
const globalErrorPage = () => location.hash.replace(/^#\/?/, '').split('?')[0] || 'quotes';
let globalErrorOwner = '';
function showGlobalError(message, page) {
  if (globalErrorPage() !== page) return;
  globalErrorOwner = page;
  const el = $('#global-error'); el.textContent = message; el.hidden = false;
}
function clearGlobalError(page) {
  if (page && globalErrorOwner !== page) return;
  globalErrorOwner = '';
  const el = $('#global-error'); el.hidden = true; el.textContent = '';
}
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
    clearGlobalError('quotes');
  } catch (e) { if (req !== quoteReq) return; state.quotes = state.quotes || []; if (e.status !== 401) showGlobalError(e.message, 'quotes'); }
  renderQuotes();
}
// Danh bạ có thể hàng nghìn khách: tìm và phân trang trên máy chủ.
let customerReq = 0, customerPager;
async function loadCustomers() {
  if (!can('page.customers') || !updateCustomerFilterSummary($)) return;
  const req = ++customerReq;
  customerPager ||= createPager($('#customer-pager'), 'customers', () => loadCustomers(), 50);
  try {
    const d = await api('/customers?' + customerListQuery($, {limit:customerPager.limit,offset:customerPager.offset,query:state.customerQuery}));
    if (req !== customerReq) return;
    $('#customer-retail-chip').hidden = !d.canListRetail;
    $('#customer-kind-field').hidden = !d.canListRetail;
    if (!d.canListRetail) { $('#customer-retail').checked = false; $('#customer-kind').value = ''; }
    fillCustomerOwners($('#customer-owner'), d.filterOptions?.owners);
    fillCustomerProvinces($('#customer-province'),d.filterOptions?.provinces);state.customerProvinces=d.filterOptions?.provinces||[];
    $('#customer-share-province').hidden=!isManager();
    updateCustomerFilterSummary($);
    state.customers = d.customers; state.customerQuoteCounts = null;
    state.customerTotal = d.total ?? d.customers.length;
    loadCustomerQuoteCounts(req);
    if (!state.customerQuery && !hasCustomerListFilters($)) state.customerGrandTotal = state.customerTotal;
    clearGlobalError('customers');
    $('#customer-pending-count').textContent = d.pendingCount || 0; $('#customer-pending-chip').hidden = !d.pendingCount && !$('#customer-pending').checked;
  } catch (e) { if (req !== customerReq) return; state.customers = state.customers || []; if (e.status !== 401) showGlobalError(e.message, 'customers'); }
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
  state.memberLoadError='';
  try { const d = await api('/admin/members'); state.members = d.members; state.positions = d.positions; state.memberDepartments = d.departments || []; clearGlobalError('staff'); }
  catch (e) { state.memberLoadError=e.message||'Không tải được danh sách nhân viên.'; if (e.status !== 401) showGlobalError(e.message, 'staff'); }
  renderMembers();
}
// Tình trạng đồng bộ Sapo → app (s…102667 tokens truncated… initial: live[0]?.id || '', build: v => {
    const slip = live.find(x => x.id === v);
    return packingPrintData({ seller: sellerName(d), order: d.order, contract: d.contract, slip, lines: slip ? slip.lines : pk.lines }, state.user?.name || '');
  } });
}
/** Phiếu giao hàng của đơn: chọn chuyến giao đã lên lịch, hoặc toàn bộ hàng còn lại. */
async function printDeliveryForOrder(orderId, deliveryId = '') {
  const d = await api('/orders/' + encodeURIComponent(orderId)), byId = new Map(d.lines.map(l => [l.id, l]));
  // Không âm thầm mở chuyến khác nếu dòng lịch vừa bấm không còn tồn tại.
  if (deliveryId && !(d.deliveries || []).some(x => x.id === deliveryId)) throw new Error('Không tìm thấy chuyến giao này. Hãy tải lại lịch giao hàng.');
  await deliveryProductImages(d.lines);
  const trips = (d.deliveries || []).filter(x => x.status !== 'cancelled' || x.id === deliveryId);
  if (!trips.length) throw new Error(NO_SCHEDULE);
  const choices = [...trips.map(x => ({ value: x.id, label: `${x.deliveryNo} · ${fmtDate(x.plannedDate)}${x.timeSlot ? ' ' + x.timeSlot : ''} · ${DELIVERY_STATUS[x.status]?.[0] || x.status}` })), { value: '', label: 'Toàn bộ hàng chưa giao (gộp các chuyến)' }];
  const next = trips.find(x => x.status !== 'delivered');
  openSlipPrint({ kind: 'delivery', choices, initial: deliveryId || next?.id || (trips.length ? trips.at(-1).id : ''), build: v => {
    const trip = trips.find(x => x.id === v);
    if(v&&!trip)throw new Error('Không tìm thấy chuyến giao đã chọn. Tải lại lịch giao hàng.');
    const left = d.lines.map(l => ({ ...l, ordered: l.qty, qty: Math.max(0, Math.round((l.qty - (l.deliveredQty || 0)) * 1000) / 1000) })).filter(l => l.qty > 0);
    const lines = trip ? trip.lines.map(x => { const l = byId.get(x.orderLineId);if(!l||!Number.isFinite(x.qty)||x.qty<=0||x.qty>l.qty)throw new Error('Số lượng chuyến giao không khớp đơn. Kiểm tra lịch trước khi in.');return { ...l, ordered: l.qty, qty: x.qty }; }) : left;
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
    else if (b.dataset.shipPrintFor) await printDeliveryForOrder(b.dataset.shipPrintFor, b.dataset.deliveryId || '');
    else await printFromSlip(b.dataset.slipPrint);
  } catch (ex) { toast(ex.message, 'err'); }
});
document.addEventListener('click', async e => {
  if (e.target.closest('#order-print, #order-print-card')) openOrderPrint();
  const listPrint = e.target.closest('[data-order-print-for]');
  if (listPrint) {
    e.stopPropagation();
    try { const d=await api('/orders/' + encodeURIComponent(listPrint.dataset.orderPrintFor));if(d.document){webOrderUi.print(d,'order');}else openOrderPrint(d); } catch (ex) { toast(ex.message, 'err'); }
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
    sub.disabled = true;
    try { if(await requestOrderApproval({id:o.id,api,verifyBox,esc})){toast(`Đã gửi Manager duyệt ${what}.`);openOrder(o.id);}else sub.disabled=false; }
    catch (ex) { toast(ex.message, 'err'); sub.disabled = false; }
  }
  if (e.target.closest('#order-history')) showAudit({ api, toast, entityType: 'orders', entityId: sales.order.id, title: (isContractDoc() ? 'HĐKT ' : 'Đơn ') + docNo() });
  if (e.target.closest('#order-cancel')) {
    const w = isContractDoc() ? 'HĐKT' : 'đơn';
    if (!await confirmBox(`Huỷ ${w} ${docNo()}? ${isContractDoc() ? 'HĐKT' : 'Đơn'} huỷ không còn tính công nợ; báo giá có thể lập lại.`, { title: 'Huỷ ' + w, ok: 'Huỷ ' + w, danger: true })) return;
    try { const r = await api(`/orders/${encodeURIComponent(sales.order.id)}/status`, 'PUT', { status: 'cancelled' }); toast('Đã huỷ ' + w + '.' + ghnCancelNote(r), r?.ghnCancel?.errors?.length ? 'err' : undefined); loadHolds(true); openOrder(sales.order.id); }
    catch (ex) {
      // Chuyến đã rời kho rồi giao thất bại: Manager huỷ khi kho đã nhận lại đủ hàng – phiếu xuất được đảo về kho đã xuất (docs/SO-KHO.md).
      if (ex.code !== 'RETURN_REQUIRED' || !isManager() || (sales.order.channel || 'crm') !== 'crm') { toast(ex.message, 'err'); return; }
      if (!await confirmBox(`Chuyến giao của ${w} ${docNo()} đã rời kho. Chỉ huỷ khi mọi chuyến đang "Giao thất bại" và KHO ĐÃ NHẬN LẠI ĐỦ HÀNG. Hàng sẽ cộng lại đúng kho đã xuất; hàng hỏng lập phiếu điều chỉnh sau.`, { title: 'Huỷ sau giao thất bại', ok: 'Kho đã nhận lại đủ hàng', danger: true })) return;
      const reason = prompt('Lý do huỷ (ít nhất 5 ký tự):', 'Khách không nhận hàng'); if (!reason) return;
      try { await api(`/orders/${encodeURIComponent(sales.order.id)}/cancel-after-failed-delivery`, 'POST', { key: crypto.randomUUID(), reason, confirmedReceived: true }); toast('Đã huỷ ' + w + ', hàng đã cộng lại kho.'); loadHolds(true); openOrder(sales.order.id); }
      catch (err) { toast(err.message, 'err'); }
    }
  }
  if (e.target.closest('#order-delete')) {
    const k = isContractDoc(), w = k ? 'HĐKT' : 'đơn hàng';
    if (!await confirmBox(`Xoá hẳn ${w} ${docNo()} đã huỷ? Không khôi phục được (nhật ký thay đổi vẫn giữ lại). Đơn nháp trên Sapo (nếu có) cần xoá riêng trên Sapo.`, { title: 'Xoá ' + w, ok: 'Xoá ' + w, danger: true, typeToConfirm: docNo() || 'XOA' })) return;
    try { await api(`/orders/${encodeURIComponent(sales.order.id)}`, 'DELETE'); toast('Đã xoá ' + w + '.'); go(k ? '#/contracts' : '#/orders'); } catch (ex) { toast(ex.message, 'err'); }
  }
  const sign = e.target.closest('[data-contract-sign]');
  if (sign) { const id=sales.order.id,session=token,route=location.hash;try { const result=await api('/contracts/' + encodeURIComponent(sign.dataset.contractSign), 'PUT', { status: 'signed', signedDate: todayIso(), returnDetail:true }); if(session===token&&route===location.hash)openOrder(id,result.detail); } catch (ex) { if(session===token&&route===location.hash)toast(ex.message, 'err'); } }
});
/**
 * Lập HĐKT THẲNG TỪ BÁO GIÁ (luồng độc lập với Đơn hàng – không sinh đơn hàng trước): điền pháp nhân, cọc, hạn thanh toán…
 * → dùng lựa chọn tạo đơn Sapo trên form, không hỏi lại trong luồng n8n (POST /contracts { quoteId }).
 */
let contractTarget = null;
async function openContractForm(t) {
  contractTarget = t;
  const f = $('#contract-form'); f.reset(); $('#contract-error').textContent = '';
  $('#contract-order-no').textContent = `báo giá ${t.quoteNo}${t.customer ? ' · ' + t.customer : ''}`;
  f.signedDate.value = todayIso(); f.deliveryAddress.value = t.address || ''; f.legalEntity.value = t.quoteType === 'VIGIFTS' ? 'VG' : 'BN';
  f.contractNo.value = ''; f.contractNo.dataset.auto = '';
  $('#contract-dialog').showModal();
  const submit=f.querySelector('.modal-foot .btn.primary');submit.disabled=true;t.sourcing=null;
  previewContractNo();
  try{const [sourcing,production]=await Promise.all([initQuoteSourcing({api,confirmBox,host:$('#contract-sourcing'),quoteId:t.quoteId,isCurrent:()=>contractTarget===t}),productionForm({host:$('#contract-production-files'),quoteId:t.quoteId,isCurrent:()=>contractTarget===t})]);if(contractTarget!==t)return;t.sourcing=sourcing;t.production=production;submit.disabled=false;}catch(ex){if(contractTarget===t)$('#contract-error').textContent=ex.message;}
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
    // Cọc / số ngày theo báo giá (ô còn trống thì máy chủ cũng tự lấy theo báo giá khi lập).
    if (r.terms?.depositRate != null && !f.depositRate.value.trim()) f.depositRate.value = String(r.terms.depositRate);
    if (r.terms?.paymentDays != null && !f.paymentDays.value.trim()) f.paymentDays.value = String(r.terms.paymentDays);
  } catch (ex) { input.placeholder = 'Nhập số HĐKT'; }
}
$('#contract-form').legalEntity.addEventListener('change', previewContractNo);
$('#contract-form').addEventListener('submit', async e => {
  e.preventDefault(); const f = e.target, err = $('#contract-error'); err.textContent = '';
  const target = contractTarget; if (!target?.sourcing || target.busy) return;
  // Ô trống = theo báo giá (máy chủ tự lấy); nhập sai thì báo, không tự thành 0.
  const rateText = f.depositRate.value.trim(), daysText = f.paymentDays.value.trim(), rate = rateText ? parseNum(rateText) : undefined;
  if (rateText && !(rate >= 0 && rate <= 100)) { err.textContent = 'Tỷ lệ đặt cọc phải từ 0 đến 100%.'; return; }
  if (daysText && (!/^\d+$/.test(daysText) || +daysText > 3650)) { err.textContent = 'Hạn thanh toán còn lại phải là số ngày (0–3650).'; return; }
  const body = { quoteId: target.quoteId, debtWarningAccepted: target.debtWarningAccepted === true, legalEntity: f.legalEntity.value, depositRate: rate, paymentDays: daysText ? +daysText : undefined,
    signedDate: f.signedDate.value || undefined, paymentMethod: f.paymentMethod.value, deliveryAddress: f.deliveryAddress.value };
  // Giữ số tự sinh → máy chủ cấp số kế tiếp lúc lập (tránh trùng nếu người khác vừa lấy số); đã sửa → gửi số đã sửa.
  const no = f.contractNo.value.trim();
  if (no && no !== f.contractNo.dataset.auto) body.contractNo = no;
  try {
    Object.assign(body,target.sourcing.read());target.busy=true;f.querySelector('.modal-foot .btn.primary').disabled=true;
    Object.assign(body,await target.sourcing.prepare());
    if(target.production)Object.assign(body,await target.production.prepare());
    if(contractTarget!==target)return;
    // Use the form's choice once; only a direct Sapo connection may still need a warehouse.
    const r = await sapoPush().choose({ quoteId: target.quoteId }, { title: 'Lập HĐKT', action: 'Lập HĐKT + đơn Sapo',
      pushSapo: f.elements.pushSapo.value === 'yes', isCurrent: () => contractTarget === target,
      run: (loc, push) => api('/contracts', 'POST', { ...body, ...(loc ? { sapoLocationId: loc } : {}), pushSapo: push === true }) });
    if (!r) return;
    $('#contract-dialog').close(); contractTarget = null; toast('Đã lập HĐKT ' + r.contractNo); sapoToast(r.sapo); loadHolds(true); // HĐKT giữ hàng thay báo giá
    target.done?.(); go('#/contracts/' + encodeURIComponent(r.orderId));
  } catch (ex) { err.textContent = ex.message; }finally{target.busy=false;f.querySelector('.modal-foot .btn.primary').disabled=false;}
});
$('#contract-dialog').addEventListener('close',()=>{contractTarget=null;});
$('#order-new-delivery').addEventListener('click', () => {
  const focusLine=$('#order-new-delivery').dataset.scheduleLine;delete $('#order-new-delivery').dataset.scheduleLine;
  const f = $('#delivery-form'), d = sales.detail, o = d.order; f.reset(); $('#delivery-error').textContent = '';
  $('#delivery-order-no').textContent = o.orderNo; f.plannedDate.value = o.expectedDeliveryDate && o.expectedDeliveryDate >= todayIso() ? o.expectedDeliveryDate : todayIso();
  const recipient = orderRecipient(o); f.receiverName.value = recipient.receiverName; f.receiverPhone.value = recipient.receiverPhone; f.address.value = o.address || '';
  const pending = id => d.deliveries.filter(x => ['planned', 'in_transit'].includes(x.status)).flatMap(x => x.lines).filter(l => l.orderLineId === id).reduce((s, l) => s + l.qty, 0);
  $('#delivery-lines').innerHTML = d.lines.map(l => { const left = Math.max(0, l.qty - l.deliveredQty - pending(l.id)); return `<tr><td>${esc(l.name)}<small>${esc(l.unit)}</small></td><td class="right">${fmtNum(left)}</td>
    <td class="right"><input class="num-input" inputmode="decimal" data-line="${esc(l.id)}" value="${left && (!focusLine||focusLine===l.id) ? fmtNum(left) : ''}" ${left ? '' : 'disabled'} aria-label="Số lượng giao ${esc(l.name)}"></td></tr>`; }).join('');
  // Mỗi lần mở form một mã chống gửi lặp: bấm lại / mạng gửi lại cùng nội dung trả chuyến đã tạo, không tạo trùng.
  $('#delivery-form').dataset.clientKey = crypto.randomUUID();
  $('#delivery-dialog').showModal();
});
$('#delivery-form').addEventListener('submit', async e => {
  e.preventDefault(); const f = e.target, err = $('#delivery-error'); err.textContent = '';
  const lines = $$('#delivery-lines input[data-line]').map(i => ({ orderLineId: i.dataset.line, qty: parseNum(i.value) })).filter(l => l.qty > 0);
  if (!lines.length) { err.textContent = 'Nhập số lượng giao cho ít nhất một sản phẩm.'; return; }
  try {
    await api('/deliveries', 'POST', { orderId: sales.order.id, plannedDate: f.plannedDate.value, timeSlot: f.timeSlot.value, receiverName: f.receiverName.value, receiverPhone: f.receiverPhone.value,
      address: f.address.value, carrier: f.carrier.value, shippingFee: parseNum(f.shippingFee.value) || 0, note: f.note.value, lines, clientKey: f.dataset.clientKey });
    $('#delivery-dialog').close(); toast('Đã lên lịch giao.'); openOrder(sales.order.id);
  } catch (ex) { err.textContent = ex.message; }
});
function updatePaymentCashNote() {
  const cash=$('#payment-form').method.value==='cash' && sales.detail?.canCollectCashWithoutDrawer===true;
  const held=cash&&!isManager(),note=$('#payment-cash-note');note.hidden=!cash;
  note.textContent=held?'Tiền mặt nhân viên còn giữ. Chỉ khi Manager thực nhận và xác nhận mới hoàn tất thanh toán, giảm công nợ.':'Ghi nhận tiền mặt Manager đã thực nhận, giảm công nợ; không cộng vào két cửa hàng.';
  $('#payment-form .modal-foot .btn.primary').textContent=held?'Ghi nhận tiền nhân viên giữ':'Lưu phiếu thu';
}
$('#payment-form').method.addEventListener('change', updatePaymentCashNote);
$('#order-new-payment').addEventListener('click', () => {
  const f = $('#payment-form'), r = sales.detail.receivable; f.reset(); $('#payment-pos-confirm').hidden=sales.order.channel!=='pos'; f.confirmed.required=sales.order.channel==='pos'; f.method.querySelector('option[value=other]').disabled=sales.order.channel==='pos'; $('#payment-error').textContent = '';
  $('#payment-title').textContent = 'Thu tiền ' + (docNo() || sales.order.orderNo); f.amount.value = fmtNum(Math.max(0,r.balance-(sales.detail.cashHeld||0))); f.paidAt.value = todayIso(); f.paidAt.max = todayIso();
  updatePaymentCashNote();
  $('#payment-dialog').showModal();
});
$('#payment-form').addEventListener('submit', async e => {
  e.preventDefault(); const f = e.target, err = $('#payment-error'), btn = f.querySelector('.modal-foot .btn.primary'); err.textContent = '';
  if (btn?.disabled) return;
  if (btn) btn.disabled = true; // chống bấm hai lần ghi trùng phiếu thu
  try {
    // Mã theo nội dung (request-keys.js): mạng rớt sau khi đã lưu, đóng hộp mở lại nhập y hệt → không ghi thu lần hai.
    const content = { orderId: sales.order.id, amount: parseNum(f.amount.value), paidAt: f.paidAt.value, method: f.method.value, reference: f.reference.value };
    const result=await sendOnce('payment', content, key => api('/payments', 'POST', { key, confirmed:f.confirmed.checked, ...content }));
    $('#payment-dialog').close(); toast(result?.status==='held'?'Đã ghi nhận tiền mặt nhân viên còn giữ; chờ Manager xác nhận.':'Đã ghi nhận thanh toán.'); openOrder(sales.order.id);
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
    const id=sales.order.id,session=token,route=location.hash;
    try { const result=await api(`/payments/${encodeURIComponent(b.dataset.voidPayment)}/void`, 'POST', { reason: f.reason.value, returnDetail:true }); if(session!==token||route!==location.hash)return;toast('Đã huỷ phiếu thu.'); openOrder(id,result.detail); }
    catch (ex) { f.querySelector('small').textContent = ex.message; ok.disabled = false; }
  });
});
// ----- Thanh nút báo giá như web cũ: Sinh HĐKT · Tạo đơn hàng · Tải báo giá · Lưu · Duyệt · Xoá
/** Lý do chưa dùng được các nút cần báo giá đã duyệt (null = dùng được). */
function approvalBlock() {
  if (isSaleEditor()) { const problem = saleDesignProblem({template: 'sale', rows: editor.rows}); if (problem) return problem; }
  if (!editor.id) return 'Lưu báo giá trước.';
  if (editor.dirty) return 'Lưu thay đổi trước.';
  if (editor.approval?.status === 'draft') return 'Báo giá còn nháp – bấm "Gửi duyệt" để Manager duyệt.';
  if (editor.approval?.status !== 'approved') return 'Báo giá đang đợi Manager duyệt.';
  return null;
}
const quoteEditUi=bindQuoteEditRequests({button:$('#request-quote-edit'),api,
 getContext:()=>({id:editor.id,revision:editor.revision,approved:editor.approval?.status==='approved',manager:isManager(),canRequest:state.user?.role==='employee'&&editor.approval?.canEdit!==false,editRequest:editor.approval?.editRequest}),
 reload:async id=>{if(location.hash.split('?')[0]==='#/quotes/'+id)await openEditor(id);},
});
function updateQuoteActions() {
  const saved = !!editor.id, approved = editor.approval?.status === 'approved', mgr = isManager(), block = approvalBlock();
  const readOnly = saved && editor.approval?.canEdit === false; // xem được, không sửa được (máy chủ cũng chặn)
  const locked = (saved && approved && !mgr && !editor.approval?.editRequest?.canEditApproved) || readOnly;
  quoteEditUi.render();
  for (const el of qf.querySelectorAll('.editor-grid input, .editor-grid select, .editor-grid textarea, .editor-grid button, .card input, .card select, .card textarea, .card button')) {
    if (locked && !el.disabled) { el.dataset.approvalLock = '1'; el.disabled = true; }
    else if (!locked && el.dataset.approvalLock) { delete el.dataset.approvalLock; el.disabled = false; }
  }
  $('#save-quote').disabled = $('#save-quote-m').disabled = saving || locked;
  $('#bulk-discount').disabled=locked||editor.loading||qf.inert||!editor.rows.some(discountProduct);
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
  const capture = $('#quote-capture'); capture.disabled = !!saleDesignProblem({template: editor.base?.template, rows: editor.rows}); capture.title = 'Chụp nội dung đang nhập, không cần lưu hoặc duyệt báo giá';
  const dl = $('#quote-download'); dl.disabled = !!block; dl.title = block || ''; if (block) closeDownloadMenu();
  if (typeof drawQuoteHold === 'function' && $('#quote-hold')) drawQuoteHold();
  // Manager duyệt mọi báo giá; nhân viên phụ trách xác nhận báo giá khách gửi từ trang khách hàng.
  const canApprove = mgr || !!editor.approval?.canApprove;
  const ap = $('#approve-quote'); ap.hidden = !canApprove || !saved; ap.disabled = approved || !!saleDesignProblem({template: editor.base?.template, rows: editor.rows}); ap.textContent = approved ? 'Đã duyệt' : editor.approval?.fromCustomer ? 'Xác nhận báo giá khách' : 'Duyệt';
  // Báo giá nhân viên gửi duyệt: người duyệt trả lại kèm lý do (về nháp để sửa).
  $('#reject-quote').hidden = !canApprove || !saved || editor.approval?.status !== 'pending' || !!editor.approval?.fromCustomer;
  // Nhân viên xoá được báo giá chưa duyệt của mình; "Gửi duyệt" chỉ hiện với báo giá nháp (Manager duyệt thẳng).
  $('#delete-quote').hidden = !saved || (!mgr && approved) || readOnly;
  // Nhân viên luôn thấy nút: nháp → "Gửi duyệt"; đã gửi (chờ duyệt) → "Đã gửi duyệt" (khoá). Báo giá khách gửi thì dùng nút xác nhận.
  $('#save-quote-m').textContent=isSaleEditor()&&saleDesignProblem(collectQuote())?'Lưu nháp':editor.approval?.status==='approved'?'Lưu thay đổi':editor.approval?.status==='pending'?'Lưu báo giá':'Lưu & gửi duyệt';
  const sb = $('#submit-quote');
  sb.hidden = !saved || mgr || approved || !!editor.approval?.fromCustomer || readOnly;
  sb.disabled = saving || !draft || !!saleDesignProblem({template: editor.base?.template, rows: editor.rows}); sb.textContent = draft ? 'Gửi duyệt' : 'Đã gửi duyệt';
  sb.title = draft ? 'Gửi báo giá cho Manager duyệt' : 'Báo giá đã gửi, đang chờ Manager duyệt';
  $('#quote-history').hidden = !mgr || !saved;
}
function closeDownloadMenu() { $('#download-menu').hidden = true; $('#quote-download').setAttribute('aria-expanded', 'false'); }
$('#quote-capture').addEventListener('click', async () => {
  const problem=saleDesignProblem(collectQuote());if(problem)return toast(problem,'err');
  if (!window.matchMedia('(max-width: 850px)').matches) return;
  try { await openMobileQuoteCapture({doc:collectQuote()}); }
  catch (ex) { toast(ex.message, 'err'); }
});
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
async function productionTransfer(path,file){
 const session=token,res=await fetch(API+path,{method:file?'PUT':'GET',headers:{authorization:'Bearer '+session,...(file?{'content-type':'application/octet-stream'}:{})},body:file,cache:'no-store',redirect:'error'});
 if(session!==token)throw Error('Tài khoản đã thay đổi.');
 if(!res.ok){const d=await res.json().catch(()=>({}));throw Error(d.error||'Chưa xác minh được file Drive. Giữ file và thử lại.');}
 return file?res.json():res.blob();
}
const productionForm=opts=>{const session=token;return createProductionFiles({api,transfer:productionTransfer,esc,...opts,isCurrent:()=>session===token&&opts.isCurrent()});};
var orderCreateUi = null;
const orderCreate = () => orderCreateUi ||= initOrderCreate({ api, $, todayIso, confirmBox, createProductionFiles:productionForm, createSourcing:opts=>initQuoteSourcing({api,confirmBox,...opts}), chooseSapo: (ref, opts) => sapoPush().choose(ref, opts) });
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
  for (const r of d.rows) { const sku = quoteStockSku(r); if (!sku || !(Number(r.qty) > 0)) continue; const x = need.get(sku) || { sku, name: r.name, unit: r.unit, qty: 0 }; x.qty += Number(r.qty); need.set(sku, x); }
  if (!need.size) return toast('Báo giá chưa có sản phẩm để kiểm tồn.', 'err');
  $('#stock-check-title').textContent = `${d.quoteNo || 'Báo giá'}${d.customer ? ' · ' + d.customer : ''}`;
  $('#stock-check-body').innerHTML = '<p class="muted">Đang kiểm tồn…</p>'; $('#stock-check-note').textContent = ''; $('#stock-check-dialog').showModal();
  try {
    const skus = [...new Set([...need.values()].map(x => x.sku).filter(Boolean))], stock = new Map(), me = editor.id || '';
    const holdsReady = await loadHolds(true);
    for (let i = 0; i < skus.length; i += 200) { const r = await api('/products?skus=' + encodeURIComponent(skus.slice(i, i + 200).join(','))); applyCatalogMeta(r); for (const p of r.products) stock.set(p.sku, p); }
    let short = 0;
    // Luôn hiển thị tổng giữ, gồm cả phần của báo giá đang kiểm; khả dụng vẫn loại phần giữ của chứng từ khác.
    const anyLock = [...need.values()].some(i => i.sku && hasSupplierStock(stock.get(i.sku)));
    const rows = [...need.values()].map(i => {
      // Khả dụng cho báo giá này = tồn kho − phần báo giá KHÁC đang treo (phần chính báo giá này giữ vẫn tính là của mình).
      const p = i.sku ? stock.get(i.sku) : null, av = p && holdsReady ? availableStock(p, me) : null, miss = av === null ? null : Math.max(0, i.qty - av);
      const mine = i.sku && holdsReady ? (state.holds.get(i.sku) || []).filter(h => h.quoteId === me).reduce((t, h) => t + h.qty, 0) : 0;
      if (miss) short++;
      return `<tr data-stock-result="${miss === null ? 'unknown' : miss ? 'missing' : 'enough'}"><td><span class="stock-check-name" title="${esc(i.name)}">${esc(i.name)}</span><small>${esc(i.sku || 'Chưa có mã hàng')}${i.unit ? ' · ' + esc(i.unit) : ''}${mine ? ` · <b>báo giá này đang giữ ${fmtNum(mine)}</b>` : ''}</small></td><td class="right">${fmtNum(i.qty)}</td>
        <td class="right" data-stock-extra>${p ? fmtNum(stockTotal(p)) : '—'}</td><td class="right" data-stock-extra>${holdsReady ? heldQty(i.sku) > 0 ? heldCell(i.sku) : '0' : 'Chưa tải được'}</td>
        <td class="right ${miss ? 'danger-text' : ''}">${av === null ? '—' : fmtNum(av)}</td>
        ${anyLock ? `<td class="right" data-stock-extra>${p && hasSupplierStock(p) ? stockText(kindStock(p, 'supplier')) : ''}</td>` : ''}<td class="right" data-stock-extra>${p ? incomingCell(p) : '—'}</td>
        <td class="right">${miss === null ? '<span class="muted">Không có số liệu</span>' : miss ? `<span class="pill danger">Thiếu ${fmtNum(miss)}</span>` : '<span class="pill ok">Đủ</span>'}</td></tr>`;
    });
    $('#stock-check-body').innerHTML = `<div class="table-wrap" tabindex="0" aria-label="Bảng kiểm tồn báo giá, cuộn ngang để xem đầy đủ các cột"><table id="stock-check-table" class="data-table stock-check-table"><thead><tr><th>Sản phẩm</th><th class="right">Cần</th><th class="right" data-stock-extra>Tồn kho</th><th class="right" data-stock-extra>Hàng đang giữ</th><th class="right stock-check-available">Khả dụng</th>${anyLock ? '<th class="right" data-stock-extra>Kho NCC</th>' : ''}<th class="right" data-stock-extra>Hàng chờ về</th><th class="right">Kết quả</th></tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
    bindStockCheckFilter($('#stock-check-body'));
    $('#stock-check-note').textContent = (!holdsReady ? 'Chưa tải được hàng đang giữ; chưa thể kết luận đủ hàng. Đóng và kiểm tồn lại.' : short ? `${short} sản phẩm không đủ tồn khả dụng – xem tồn NCC / hàng chờ về.` : 'Các sản phẩm có số liệu đều đủ tồn khả dụng.')
      + ' Hàng đang giữ gồm báo giá, đơn hàng và HĐKT; phần báo giá này đang giữ vẫn dùng được cho chính báo giá này.';
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
  const review = await (q.preflight || api('/quotes/' + encodeURIComponent(q.quoteId) + '/approval-preflight'));
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
function refreshQuoteDocument(id) {
  const request = editor.documentRequest = (editor.documentRequest || 0) + 1;
  return editor.documentPromise = loadQuoteDocument(id, request);
}
async function loadQuoteDocument(id, request) {
  editor.document = null; editor.documentError = false; editor.documentLoading = !!id;
  if (!id) return null;
  updateQuoteActions();
  try {
    const { order } = await api('/orders/by-quote/' + encodeURIComponent(id));
    if (editor.id !== id) return undefined;
    // Trang vừa tự tải lại báo giá (sau khi duyệt / lưu / có dữ liệu mới) và gửi lượt kiểm tra mới: chờ lượt mới nhất thay vì
    // trả "bỏ qua" – trước đây cú bấm "Sinh Đơn hàng / HĐKT" rơi vào lúc này bị nuốt im lặng, phải bấm lại 2–3 lần.
    if (editor.documentRequest !== request) return editor.documentPromise;
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
$('#quote-make').dataset.noBusy = ''; // tự quản lý trạng thái bận (busy-buttons.js không mở khoá nút giữa chừng)
$('#quote-make').addEventListener('click', async () => {
  const id = editor.id; if (!id) return toast('Lưu báo giá trước.', 'err');
  // Kiểm tra công nợ khách (cần cho cả 2 luồng) chạy song song với kiểm tra đơn đã có – bớt một lượt chờ sau khi chọn luồng.
  const preflight = api('/quotes/' + encodeURIComponent(id) + '/approval-preflight'); preflight.catch(() => {});
  const linked = await refreshQuoteDocument(id);
  if (editor.id !== id || linked === undefined) return;
  if (editor.documentError) return toast('Chưa kiểm tra được Đơn hàng / HĐKT. Vui lòng thử lại.', 'err');
  if (linked) return go('#/' + (linked.contractNo ? 'contracts/' : 'orders/') + encodeURIComponent(linked.id));
  const block = approvalBlock(); if (block) return toast(block, 'err');
  const flow = await chooseFlow(`${field('quoteNo').value} · ${field('customer').value || ''}`); if (!flow || editor.id !== id) return;
  // Từ lúc chọn luồng tới khi form mở: nút báo đang mở (trước đây màn hình đứng im ~1 giây, người dùng bấm lại).
  const btn = $('#quote-make'); btn.disabled = true; btn.textContent = 'Đang mở form…'; btn.classList.add('is-busy'); btn.setAttribute('aria-busy', 'true');
  try { await makeFromQuote(flow, { quoteId: editor.id, quoteNo: field('quoteNo').value, quoteType: editor.type, customer: field('customer').value, address: field('customerAddress').value, preflight }); }
  catch (ex) { toast(ex.message, 'err'); } finally { btn.classList.remove('is-busy'); btn.removeAttribute('aria-busy'); updateQuoteActions(); }
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
  const btn = $('#approve-quote'), targetId = editor.id; btn.disabled = true;
  try {
    const preflight = await api('/quotes/' + encodeURIComponent(targetId) + '/approval-preflight');
    if(editor.id!==targetId)return;
    if (!isManager() && !preflight.purchaseCostsReady) { toast('Vui lòng nhờ Manager cập nhật giá mua trước khi duyệt báo giá.', 'err'); return; }
    if (isManager() && editor.rows.some(missingPurchaseCost)) {
      if (!await refreshPurchaseCosts({onlyMissing:true,approval:true})) return;
    } else if (!await confirmBox('Duyệt báo giá này?', {title:'Duyệt báo giá',ok:'Duyệt báo giá'})) return;
    if(editor.id!==targetId)return;
    if (editor.dirty) { await saveQuote(); if (editor.dirty) return; }
    if(editor.id!==targetId)return;
    const r = await api('/quotes/' + encodeURIComponent(targetId) + '/approve', 'POST', { revision: editor.revision });
    if(editor.id!==targetId)return;
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
async function submitQuoteForApproval() {
  const designProblem = saleDesignProblem(collectQuote()); if (designProblem) return toast(designProblem, 'err');
  if (!editor.id || editor.approval?.status !== 'draft') return;
  const btn = $('#submit-quote'); btn.disabled = true;
  try {
    if (editor.dirty) { await saveQuote(); if (editor.dirty) return; }
    await api('/quotes/' + encodeURIComponent(editor.id) + '/submit', 'POST', { revision: editor.revision });
    editor.approval = { ...editor.approval, status: 'pending' };
    toast('Đã gửi Manager duyệt báo giá.'); loadQuotes();
  } catch (ex) { toast(ex.message, 'err'); }
  finally { updateQuoteActions(); }
}
$('#submit-quote').addEventListener('click', submitQuoteForApproval);
// Excel theo mẫu web cũ (excel-export.js): ảnh sản phẩm + letterhead, 2 sheet báo giá và phí vận chuyển.
// excel-export.js (chép từ web cũ) gọi QuoteMath.totals và HrcPdf.amountInWords.
globalThis.QuoteMath = { ...(globalThis.QuoteMath || {}), totals, after, manualLineDescription };
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
  const viaServer = url => api('/images/fetch', 'POST', { url }).then(r => loadCanvasImage(r.dataUrl), ex => { errors.push(ex.message); console.warn('Không tải được ảnh báo giá.'); return null; });
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
async function downloadSaleQuote(format) {
  const block=approvalBlock();if(block)return toast(block,'err');
  if(format==='pdf'?pdfBusy:excelBusy)return;
  let data=collectQuote();if(!data.rows.length)return toast('Chưa có sản phẩm để xuất báo giá Sale.','err');
  const tab=format==='pdf'&&isIos()?window.open('about:blank','_blank'):null;
  if(tab)tab.document.body.textContent='Đang tạo PDF cho Sale…';
  if(format==='pdf')pdfBusy=true;else excelBusy=true;
  toast(`Đang tạo ${format==='pdf'?'PDF':'Excel'} cho Sale…`);
  try{
    const exportId=editor.id, exportRevision=editor.revision, fresh=await api('/quotes/'+encodeURIComponent(exportId));
    if(fresh.revision!==exportRevision||fresh.approvalStatus!=='approved'||editor.id!==exportId||editor.dirty)throw Error('Báo giá đã thay đổi. Mở lại và kiểm tra trước khi xuất.');
    data=fresh.data;const problem=saleDesignProblem(data);if(problem)throw Error(problem);
    const skus=[...new Set(data.rows.map(r=>r.sku).filter(Boolean))];
    const suggestions=await fetchSaleSuggestions(api,skus);
    const prices=new Map(suggestions.map(p=>[p.sku,p.average]));data={...data,rows:data.rows.map(r=>({...r,suggestedAverage:prices.get(r.sku)??null}))};
    if(format==='pdf')await loadPdfTools();
    const module=await import('./sale-quote-export.js'),options={images:module.canvasExportImages(await loadQuoteImages(data.rows))};
    if(format==='pdf'){const banner=await loadCanvasImage('vigifts-letterhead.png');if(!banner)throw Error('Chưa tải được tiêu đề Vigifts. Tải lại trang rồi xuất PDF Sale.');options.banner=module.canvasExportImages([banner])[0];}
    if(editor.id!==exportId||editor.revision!==exportRevision||editor.dirty)throw Error('Báo giá đang được sửa. Lưu và kiểm tra lại trước khi xuất.');
    const bytes=await (format==='pdf'?module.salePdfBytes(data,options):module.saleExcelBytes(data,options));
    const mime=format==='pdf'?'application/pdf':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    const url=URL.createObjectURL(new Blob([bytes],{type:mime}));
    if(tab&&!tab.closed)tab.location.href=url;
    else{
      const link=document.createElement('a');link.href=url;link.download='Sale-'+String(data.quoteNo||'Bao-gia').replace(/[\\/:*?"<>|]+/g,'-')+(format==='pdf'?'.pdf':'.xlsx');
      document.body.append(link);link.click();link.remove();
    }
    setTimeout(()=>URL.revokeObjectURL(url),60000);toast('Đã tạo báo giá Sale với 8 cột.');
  }catch(error){if(tab&&!tab.closed)tab.close();toast(error?.message||'Không thể xuất báo giá Sale.','err');}
  finally{if(format==='pdf')pdfBusy=false;else excelBusy=false;}
}
$('#pdf-quote-sale').addEventListener('click',()=>downloadSaleQuote('pdf'));
$('#excel-quote-sale').addEventListener('click',()=>downloadSaleQuote('excel'));

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

var custodyUi=null,custodyLoading=null;
function custodyView(){return custodyLoading ||= import('./product-custody.js').then(({initProductCustody})=>custodyUi=initProductCustody({api,root:$('#view-product-custody'),toast,compress:compressImage,identity:()=>token,userId:()=>state.user?.id}));}

// Trang chủ tải module khi mở; phần còn lại của CRM không phải tải giao diện này.
var homeUi = null, homeLoading = null;
function homeNavigation(){return [...document.querySelectorAll('.side-nav [data-nav]')].filter(a=>!a.hidden&&!a.closest('[hidden]')&&linkAllowed(a.getAttribute('href'))).map(a=>{const group=a.closest('.nav-group'),heading=group?.querySelector('h2');return{key:a.dataset.nav,label:a.querySelector('span')?.textContent?.trim()||a.textContent.trim(),href:a.getAttribute('href'),groupId:heading?.id||'',group:(heading?.querySelector('.nav-group-toggle>span:first-child')?.textContent||heading?.textContent)?.trim()||'Chức năng khác'};});}
function homeActions(){return [
  {key:'new-task',label:'Tạo công việc',icon:'work',run:()=>tasksView().openNew().catch(e=>toast(e.message,'err'))},
  ...(can('pos.sell')&&isCounterSales()?[{key:'pos',label:'Bán hàng nhanh',icon:'sell',run:()=>go('#/pos')}]:[]),
  ...(can('page.quotes')?[{key:'new-quote',label:'Lập báo giá',icon:'sell',run:()=>openNewQuote()}]:[]),
  ...(can('page.customers')?[{key:'new-customer',label:'Thêm khách hàng',icon:'customers',run:()=>openCustomer()}]:[]),
  ...(can('page.care')?[{key:'new-care',label:'Ghi nhận chăm sóc',icon:'customers',run:()=>careView().openForm({},()=>homeUi?.refresh())}]:[]),
];}
function homeView() { if(homeUi)return Promise.resolve(homeUi);return homeLoading ||= import('./home.js').then(({initHome}) => homeUi = initHome({root:$('#view-home'),api,user:()=>state.user,canApprove,go,
  entries:homeNavigation,actions:homeActions,approvalFeed:sharedApprovalFeed(),notifications:()=>homeNotifications.read('/notifications'),navigationRoot:document.querySelector('.side-nav'),
  noticeHref:n=>{try{const url=new URL(n.url,location.origin);return url.origin===location.origin&&/^#\/[\w-]+/.test(url.hash)&&linkAllowed(url.hash)?url.hash:'';}catch{return'';}},
  markRead:id=>{const who=state.user?.id;return homeNotifications.read('/notifications/read','POST',{ids:[id]}).then(()=>{if(who===state.user?.id)notifier.markRead(id);});},
  openBell:()=>{const button=$('#staff-bell .bell');if(button?.getAttribute('aria-expanded')!=='true')button?.click();window.scrollTo(0,0);},
})); }
function showHome() {
  const who=state.user?.id;
  homeView().then(ui=>{if(who===state.user?.id&&location.hash.split('?')[0]==='#/home')return ui.show();}).catch(e=>{
    if(who===state.user?.id&&location.hash.split('?')[0]==='#/home'){homeLoading=null;$('#view-home').innerHTML=`<h1>Trang chủ</h1><p class="error" role="alert">${esc(e.message||'Chưa tải được trang chủ.')}</p><button class="btn secondary" type="button" data-home-boot-retry>Thử lại</button>`;$('#view-home [data-home-boot-retry]').onclick=showHome;}
  });
}
