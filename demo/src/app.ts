/* eslint-disable @typescript-eslint/no-explicit-any */
import { AppError } from '../../src/core/errors.ts';
import { totals, profit } from '../../src/modules/quotes/domain/quote-math.ts';
import { canViewQuotation, canEditQuotation, canShareQuotation, canReassignQuotation, effectiveAssigneeId, type Viewer } from '../../src/modules/quotes/domain/access.ts';
import { assignableStaff, planReassignment, planShare, type StaffEntry } from '../../src/modules/quotes/domain/assignment.ts';
import { cleanQuotation } from '../../src/modules/quotes/domain/quotation-schema.ts';
import { canAccessArea, type Area } from '../../src/modules/staff/domain/area-policy.ts';
import { DEFAULT_POSITIONS } from '../../src/modules/staff/domain/members.ts';
import { orderVisibility } from '../../src/modules/suppliers/domain/visibility.ts';
import { computeOrderTotals, hidePrices } from '../../src/modules/suppliers/domain/order-totals.ts';
import { checkAction, nextActions, orderStage, type OrderAction, type OrderFacts, type Rules, type WorkflowActor } from '../../src/modules/suppliers/domain/workflow.ts';
import { validateApproval, validateConfirmation, validateDepositRequest, validateDeliveryReady, validatePaidAmount, validateSignatureUpload, cleanInternalOrderNumber } from '../../src/modules/suppliers/domain/validation.ts';
import { MEMBERS, SUPPLIERS, seed, type Member, type Order, type Persist, type Quote } from './data.ts';

const KEY = 'bn-demo-v1';
const root = document.getElementById('app')!;
let S: Persist;
type Sheet = { k: 'quote'; id: string } | { k: 'edit'; id: string | null } | { k: 'share'; id: string } | { k: 'assign'; id: string } | { k: 'order'; id: string } | { k: 'act'; id: string; a: OrderAction } | null;
const ui: { tab: 'quotes' | 'orders' | 'rules'; sheet: Sheet; error: string; toast: { text: string; kind: 'ok' | 'err' } | null; draft: any; shareType: 'member' | 'position' } = { tab: 'quotes', sheet: null, error: '', toast: null, draft: null, shareType: 'member' };

// ---------- tiện ích ----------
const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const vnd = (n: number) => (n < 0 ? '-' : '') + String(Math.abs(Math.round(n))).replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ' ₫';
const dmy = (iso?: string | null) => iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '';
const stamp = () => new Date().toISOString();
const num = (s: unknown) => { const t = String(s ?? '').trim().replace(/\s/g, '').replace(',', '.'); return t === '' ? 0 : Number(t); };
const me = (): Member => MEMBERS.find(m => m.id === S.meId)!;
const nameOf = (id: string) => MEMBERS.find(m => m.id === id)?.name ?? id;
const viewer = (m: Member = me()): Viewer => ({ id: m.id, role: m.role, active: true, positionId: m.positionId });
const directory = (): StaffEntry[] => MEMBERS.map(m => ({ id: m.id, name: m.name, role: m.role, active: true, positionId: m.positionId }));
const actor = (): WorkflowActor => ({ ...viewer(), supplierId: me().supplierId ?? null });
const own = (q: Quote) => ({ id: q.id, creatorId: q.creatorId, assigneeId: q.assigneeId });
const supplierName = (id: string) => SUPPLIERS.find(s => s.id === id)?.name ?? id;

function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch { /* chế độ riêng tư: bỏ qua */ } }
function load(): Persist { try { const r = JSON.parse(localStorage.getItem(KEY) || 'null'); if (r?.v === 1 && Array.isArray(r.quotes)) return r; } catch { /* dữ liệu hỏng: dùng mẫu */ } return seed(); }
function toast(text: string, kind: 'ok' | 'err' = 'ok') { ui.toast = { text, kind }; setTimeout(() => { if (ui.toast?.text === text) { ui.toast = null; render(); } }, 4200); }
const fail = (e: unknown) => (e instanceof AppError ? e.message : 'Lỗi không mong đợi: ' + (e as Error).message);
const logTo = (arr: string[], text: string) => arr.push(`${me().name}: ${text}`);

const facts = (o: Order): OrderFacts => ({ source: 'supplier-order', approvalStatus: o.approvalStatus, supplierId: o.supplierId, confirmed: Boolean(o.confirmedAt), hasSignatureStep: Boolean(o.signature || o.signatureDownloaded), hasSignatureFile: Boolean(o.signature), depositRequested: Boolean(o.depositRequestedAt), depositPaid: Boolean(o.depositPaidAt), deliveryReady: Boolean(o.ready), received: Boolean(o.receivedAt) });
const orderTotals = (o: Order) => computeOrderTotals({ depositRate: o.depositRate, paidAmount: o.paidAmount, rows: o.lines.map(l => ({ quantity: l.quantity, price: l.price, printFee: l.printFee, taxRate: l.taxRate, purchaseDiscount: l.purchaseDiscount, confirmedPurchaseDiscount: l.confirmed?.purchaseDiscount ?? null })) });
const vis = (o: Order) => orderVisibility(actor(), { source: 'supplier-order', approvalStatus: o.approvalStatus, supplierId: o.supplierId });
const quoteTotal = (q: Quote) => totals({ type: q.data.type, vat: q.data.vat, rows: q.data.rows });
const STAGE: Record<string, [string, string]> = { pending_approval: ['Chờ duyệt', 'warn'], awaiting_confirmation: ['Chờ NCC xác nhận', 'info'], confirmed: ['Đã xác nhận', 'ok'], received: ['Đã nhập kho', 'done'] };
const ACTION_LABEL: Record<OrderAction, string> = { approve: 'Duyệt đơn', set_internal_number: 'Nhập số phiếu NCC', upload_signature: 'Tải bản ký', delete_signature: 'Xoá bản ký', confirm: 'Xác nhận đơn', request_deposit: 'Yêu cầu cọc', pay_deposit: 'Ghi nhận cọc', mark_delivery_ready: 'Báo sẵn sàng giao', unmark_delivery_ready: 'Bỏ báo sẵn sàng giao', receive: 'Nhập kho' };
const AREA_LABEL: Record<string, string> = { self: 'Tài khoản của mình', business: 'Báo giá, khách hàng, sản phẩm', 'supplier-portal': 'Cổng NCC (đơn đã duyệt)', 'ncc-admin': 'Quản lý NCC (duyệt đơn, cọc, nhập kho)', admin: 'Quản trị nhân viên' };

// ---------- khung ----------
function header() {
  const m = me();
  const note = m.role === 'manager' ? 'Thấy và sửa mọi báo giá, duyệt đơn NCC, quản lý nhân viên.' : m.role === 'supplier' ? 'Chỉ vào được cổng NCC; chỉ thấy đơn của chính nhà cung cấp mình.' : 'Chỉ thấy báo giá của mình, được giao hoặc được chia sẻ. Đơn NCC bị ẩn giá.';
  return `<header class="top"><div class="brand"><b>Bách Ngân</b><span>Bản demo thao tác thử · dữ liệu mẫu</span></div>
  <div class="who" role="tablist" aria-label="Đăng nhập thử với tài khoản">${MEMBERS.map(x => `<button role="tab" aria-selected="${x.id === m.id}" class="chip ${x.id === m.id ? 'on' : ''} ${x.role}" data-act="login" data-id="${x.id}"><i>${esc(x.name[0])}</i><span>${esc(x.name)}<small>${esc(x.title)}</small></span></button>`).join('')}</div>
  <p class="role-note"><b>${esc(m.name)}</b> · ${esc(note)}</p></header>`;
}
function tabbar() {
  const tabs: [string, string, boolean][] = [['quotes', 'Báo giá', canAccessArea({ ...viewer(), active: true }, 'business')], ['orders', 'Đơn NCC', true], ['rules', 'Quyền & luật', true]];
  return `<nav class="tabs" aria-label="Chức năng">${tabs.filter(t => t[2]).map(t => `<button class="${ui.tab === t[0] ? 'on' : ''}" data-act="tab" data-id="${t[0]}">${t[1]}</button>`).join('')}</nav>`;
}

// ---------- báo giá ----------
function visibleQuotes() { return S.quotes.filter(q => canViewQuotation(viewer(), own(q), q.shares)); }
function quoteCard(q: Quote) {
  const v = viewer(), isMine = q.creatorId === v.id, asg = effectiveAssigneeId(q);
  const tags = [`<span class="tag">${q.data.type}</span>`];
  if (isMine) tags.push('<span class="tag me">Của bạn</span>'); else tags.push(`<span class="tag">Chủ: ${esc(nameOf(q.creatorId))}</span>`);
  if (asg !== q.creatorId) tags.push(`<span class="tag asg">Phụ trách: ${esc(nameOf(asg))}</span>`);
  const sh = q.shares.find(s => (s.targetType === 'member' && s.targetId === v.id) || (s.targetType === 'position' && s.targetId === v.positionId));
  if (sh && !isMine && asg !== v.id && v.role !== 'manager') tags.push(`<span class="tag sh">Được chia sẻ · ${sh.permission === 'edit' ? 'sửa' : 'xem'}</span>`);
  return `<button class="card" data-act="open-quote" data-id="${q.id}"><div class="row"><b>${esc(q.data.quoteNo)}</b><strong class="amt">${vnd(quoteTotal(q).total)}</strong></div><div class="muted">${esc(q.data.customer)}</div><div class="tags">${tags.join('')}</div></button>`;
}
function quotesTab() {
  const list = visibleQuotes();
  return `<section><div class="bar"><h2>Báo giá <small>${list.length}</small></h2><button class="btn primary" data-act="new-quote">Báo giá mới</button></div>
  ${list.length ? list.map(quoteCard).join('') : '<p class="empty">Bạn chưa được xem báo giá nào. Bấm “Báo giá mới” để tạo, hoặc đổi sang tài khoản Manager để thấy tất cả.</p>'}</section>`;
}
function table(head: string[], rows: (string | number)[][]) {
  return `<div class="scroll"><table><thead><tr>${head.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map((c, i) => `<td class="${i > 1 ? 'n' : ''}">${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}
function quoteSheet(q: Quote) {
  const t = quoteTotal(q), canEdit = canEditQuotation(viewer(), own(q), q.shares), canShare = canShareQuotation(viewer(), own(q));
  const pf = canEdit ? profit({ type: q.data.type, vat: q.data.vat, rows: q.data.rows, shipping: q.data.shipping, printing: q.data.printing }) : null;
  const asg = effectiveAssigneeId(q), usable = assignableStaff(directory()).some(m => m.id === asg), canRe = canReassignQuotation(viewer(), own(q), usable);
  const handed = asg !== q.creatorId;
  const reHint = canRe ? '' : handed ? `Đã giao ${esc(nameOf(asg))} phụ trách — chỉ Manager đổi được.` : 'Chỉ chủ báo giá hoặc Manager được đổi.';
  return `<div class="sheet-h"><button class="x" data-act="close" aria-label="Đóng">×</button><h3>${esc(q.data.quoteNo)}</h3></div>
  <p class="muted">${esc(q.data.customer)} · ${q.data.type} · VAT ${q.data.vat}% · bản ${q.revision}</p>
  ${table(['Mã', 'Sản phẩm', 'SL', 'Đơn giá', 'CK', 'Thành tiền'], q.data.rows.map((r: any) => [esc(r.sku), esc(r.name), r.qty, vnd(r.price), r.discountType === 'amount' ? vnd(r.discount) : r.discount + '%', vnd(((r.discountType === 'amount' ? Math.max(0, r.price - r.discount) : r.price * (1 - r.discount / 100)) + (q.data.type === 'HRC' ? 0 : r.printFee)) * r.qty)]))}
  <dl class="sum"><div><dt>Tạm tính</dt><dd>${vnd(t.subtotal)}</dd></div><div><dt>${esc(t.label)}</dt><dd>${vnd(t.tax)}</dd></div><div class="big"><dt>Tổng cộng</dt><dd>${vnd(t.total)}</dd></div></dl>
  ${pf ? `<dl class="sum soft"><div><dt>Giá vốn</dt><dd>${vnd(pf.cost)}</dd></div><div><dt>Lợi nhuận gộp</dt><dd>${vnd(pf.gross)} (${pf.margin.toFixed(1)}%)</dd></div></dl>` : '<p class="muted small">Bạn xem được báo giá này nhưng không sửa được, nên giá vốn và lợi nhuận được ẩn.</p>'}
  <h4>Ai làm gì với báo giá này</h4><ul class="people"><li>Chủ (không bao giờ đổi): <b>${esc(nameOf(q.creatorId))}</b></li><li>Người phụ trách: <b>${esc(nameOf(asg))}</b>${handed ? '' : ' <span class="muted">(chưa giao)</span>'}</li>${q.shares.map(s => `<li>Chia sẻ cho ${s.targetType === 'member' ? esc(nameOf(s.targetId)) : 'chức vụ ' + esc(DEFAULT_POSITIONS.find(p => p.id === s.targetId)?.name ?? s.targetId)}: <b>${s.permission === 'edit' ? 'xem và sửa' : 'chỉ xem'}</b>${canShare ? ` <button class="link" data-act="unshare" data-id="${q.id}" data-t="${s.targetType}" data-x="${s.targetId}">gỡ</button>` : ''}</li>`).join('')}</ul>
  <div class="actions"><button class="btn" data-act="edit-quote" data-id="${q.id}" ${canEdit ? '' : 'disabled'}>Sửa</button><button class="btn" data-act="share" data-id="${q.id}" ${canShare ? '' : 'disabled'}>Chia sẻ</button><button class="btn" data-act="assign" data-id="${q.id}" ${canRe ? '' : 'disabled'}>Đổi người phụ trách</button></div>
  ${canEdit ? '' : '<p class="hint">Bạn chỉ được xem báo giá này.</p>'}${!canRe && canEdit ? `<p class="hint">${reHint}</p>` : ''}${!canShare && canEdit ? '<p class="hint">Người được chia sẻ hoặc phụ trách không chia sẻ tiếp được.</p>' : ''}
  <h4>Lịch sử</h4><ol class="log">${q.log.slice().reverse().map(l => `<li>${esc(l)}</li>`).join('')}</ol>`;
}
const blankRow = () => ({ sku: '', name: '', qty: '1', price: '0', disc: '0', fee: '0', cost: '0' });
function draftFrom(q: Quote | null) {
  if (!q) return { id: null, type: 'B2B', quoteNo: 'BG-' + String(S.seq).padStart(4, '0'), customer: '', vat: '8', rows: [{ ...blankRow(), sku: 'LLM-24', name: 'Nồi Lock&Lock 24cm', qty: '10', price: '420000', disc: '30', cost: '176000' }] };
  return { id: q.id, type: q.data.type, quoteNo: q.data.quoteNo, customer: q.data.customer, vat: String(q.data.vat), rows: q.data.rows.map((r: any) => ({ sku: r.sku, name: r.name, qty: String(r.qty), price: String(r.price), disc: String(r.discount), fee: String(r.printFee), cost: String(r.costPrice ?? 0), dtype: r.discountType, tax: r.taxRate })) };
}
function editSheet() {
  const d = ui.draft, inp = (n: string, v: string, l: string, c = '') => `<label class="f ${c}"><span>${l}</span><input name="${n}" value="${esc(v)}" inputmode="decimal" autocomplete="off"></label>`;
  return `<form data-form="edit" novalidate><div class="sheet-h"><button type="button" class="x" data-act="close" aria-label="Đóng">×</button><h3>${d.id ? 'Sửa báo giá' : 'Báo giá mới'}</h3></div>
  <div class="grid2"><label class="f"><span>Loại</span><select name="type">${['HRC', 'B2B', 'VIGIFTS'].map(t => `<option ${t === d.type ? 'selected' : ''}>${t}</option>`).join('')}</select></label>${inp('vat', d.vat, 'VAT (%)')}</div>
  <label class="f"><span>Số báo giá</span><input name="quoteNo" value="${esc(d.quoteNo)}"></label><label class="f"><span>Khách hàng</span><input name="customer" value="${esc(d.customer)}" placeholder="Tên công ty hoặc người mua"></label>
  <h4>Sản phẩm</h4>${d.rows.map((r: any, i: number) => `<fieldset class="line"><legend>Dòng ${i + 1}</legend><div class="grid2"><label class="f"><span>Mã</span><input name="sku_${i}" value="${esc(r.sku)}"></label><label class="f"><span>Tên</span><input name="name_${i}" value="${esc(r.name)}"></label></div>
  <div class="grid3">${inp('qty_' + i, r.qty, 'SL')}${inp('price_' + i, r.price, 'Đơn giá')}${inp('disc_' + i, r.disc, 'CK (%)')}</div><div class="grid3">${inp('fee_' + i, r.fee, 'Phí in/cái')}${inp('cost_' + i, r.cost, 'Giá vốn')}<button type="button" class="btn small danger" data-act="del-row" data-i="${i}" ${d.rows.length < 2 ? 'disabled' : ''}>Xoá dòng</button></div></fieldset>`).join('')}
  <button type="button" class="btn" data-act="add-row">Thêm dòng</button><div class="live" id="live">${liveTotals(d)}</div>
  ${ui.error ? `<p class="err" role="alert">${esc(ui.error)}</p>` : ''}<div class="actions"><button class="btn primary" type="submit">Lưu báo giá</button><button type="button" class="btn" data-act="close">Hủy</button></div>
  <p class="hint">Thử nhập chữ vào ô số, VAT 150 hoặc để trống số báo giá để xem thông báo lỗi thật của hệ thống.</p></form>`;
}
function readDraft(form: HTMLFormElement) {
  const f = new FormData(form), g = (k: string) => String(f.get(k) ?? ''), rows = ui.draft.rows.map((r: any, i: number) => ({ ...r, sku: g('sku_' + i), name: g('name_' + i), qty: g('qty_' + i), price: g('price_' + i), disc: g('disc_' + i), fee: g('fee_' + i), cost: g('cost_' + i) }));
  return { ...ui.draft, type: g('type'), quoteNo: g('quoteNo'), customer: g('customer'), vat: g('vat'), rows };
}
const draftInput = (d: any) => ({ type: d.type, quoteNo: d.quoteNo, date: new Date().toISOString().slice(0, 10), customer: d.customer, vat: num(d.vat), rows: d.rows.map((r: any) => ({ sku: r.sku, name: r.name, unit: 'cái', brand: '', qty: num(r.qty), price: num(r.price), discount: num(r.disc), discountType: r.dtype === 'amount' ? 'amount' : 'percent', printFee: num(r.fee), costPrice: num(r.cost), ...(r.tax !== undefined ? { taxRate: r.tax } : {}) })) });
function liveTotals(d: any) {
  const nums = d.rows.flatMap((r: any) => [num(r.qty), num(r.price), num(r.disc), num(r.fee)]);
  if (!Number.isFinite(num(d.vat)) || nums.some((x: number) => !Number.isFinite(x))) return '<span class="muted">Tổng tiền: chờ số hợp lệ</span>';
  const rows = d.rows.map((r: any) => ({ price: num(r.price), qty: num(r.qty), discount: num(r.disc), printFee: num(r.fee), costPrice: num(r.cost) }));
  const t = totals({ type: d.type, vat: num(d.vat), rows }), p = profit({ type: d.type, vat: num(d.vat), rows });
  return `<div><span>Tạm tính</span><b>${vnd(t.subtotal)}</b></div><div><span>${esc(t.label)}</span><b>${vnd(t.tax)}</b></div><div class="big"><span>Tổng cộng</span><b>${vnd(t.total)}</b></div><div><span>Lợi nhuận gộp</span><b>${vnd(p.gross)}</b></div>`;
}
function shareSheet(q: Quote) {
  const positionIds = DEFAULT_POSITIONS.map(p => p.id), staff = assignableStaff(directory()).filter(m => m.id !== q.creatorId);
  const opts = ui.shareType === 'member' ? staff.map(m => `<option value="${m.id}">${esc(m.name)} (${esc(MEMBERS.find(x => x.id === m.id)!.title)})</option>`) : DEFAULT_POSITIONS.map(p => `<option value="${p.id}">${esc(p.name)}</option>`);
  void positionIds;
  return `<form data-form="share" data-id="${q.id}"><div class="sheet-h"><button type="button" class="x" data-act="back" data-id="${q.id}" aria-label="Quay lại">‹</button><h3>Chia sẻ ${esc(q.data.quoteNo)}</h3></div>
  <div class="seg"><label><input type="radio" name="tt" value="member" ${ui.shareType === 'member' ? 'checked' : ''} data-act="share-type"> Một nhân viên</label><label><input type="radio" name="tt" value="position" ${ui.shareType === 'position' ? 'checked' : ''} data-act="share-type"> Cả chức vụ</label></div>
  <label class="f"><span>Chia sẻ cho</span><select name="target">${opts.join('')}</select></label><label class="f"><span>Quyền</span><select name="permission"><option value="edit">Xem và sửa</option><option value="view">Chỉ xem</option></select></label>
  ${ui.error ? `<p class="err" role="alert">${esc(ui.error)}</p>` : ''}<div class="actions"><button class="btn primary" type="submit">Chia sẻ</button><button type="button" class="btn" data-act="back" data-id="${q.id}">Hủy</button></div>
  <p class="hint">Thử chọn Chi (Kế toán) rồi đăng nhập Chi để thấy báo giá xuất hiện. NCC không chọn được.</p></form>`;
}
function assignSheet(q: Quote) {
  const staff = assignableStaff(directory());
  return `<form data-form="assign" data-id="${q.id}"><div class="sheet-h"><button type="button" class="x" data-act="back" data-id="${q.id}" aria-label="Quay lại">‹</button><h3>Người phụ trách</h3></div>
  <p class="muted">Chủ báo giá (${esc(nameOf(q.creatorId))}) không đổi. Danh sách chỉ gồm nhân viên đang hoạt động, không có tài khoản NCC.</p>
  <label class="f"><span>Giao cho</span><select name="to">${staff.map(m => `<option value="${m.id}" ${m.id === effectiveAssigneeId(q) ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}</select></label>
  ${ui.error ? `<p class="err" role="alert">${esc(ui.error)}</p>` : ''}<div class="actions"><button class="btn primary" type="submit">Giao phụ trách</button><button type="button" class="btn" data-act="back" data-id="${q.id}">Hủy</button></div></form>`;
}

// ---------- đơn NCC ----------
function ordersTab() {
  const m = me(), list = S.orders.filter(o => vis(o) !== 'none'), pending = m.role === 'manager' ? S.orders.filter(o => o.approvalStatus === 'pending') : [];
  const card = (o: Order) => {
    const st = STAGE[orderStage(facts(o))]!, t = orderTotals(o), hidden = vis(o) === 'prices-hidden', f = facts(o);
    const flags = [f.depositRequested && !f.depositPaid ? '<span class="tag warn">Đã yêu cầu cọc</span>' : '', f.depositPaid ? '<span class="tag ok">Đã nhận cọc</span>' : '', f.deliveryReady ? '<span class="tag info">Sẵn sàng giao</span>' : ''].join('');
    return `<button class="card" data-act="open-order" data-id="${o.id}"><div class="row"><b>${esc(o.ticket)}</b><span class="badge ${st[1]}">${st[0]}</span></div><div class="muted">${m.role === 'supplier' ? 'Báo giá ' + esc(o.quoteNo) : esc(supplierName(o.supplierId)) + ' · báo giá ' + esc(o.quoteNo)} · về ${dmy(o.arrivalDate)}</div><div class="row"><span class="tags">${flags}</span><strong class="amt">${hidden ? 'Giá ẩn' : vnd(t.total)}</strong></div></button>`;
  };
  return `<section>${pending.length ? `<h2>Chờ bạn duyệt <small>${pending.length}</small></h2>${pending.map(card).join('')}` : ''}<h2>${m.role === 'supplier' ? 'Đơn của ' + esc(supplierName(m.supplierId!)) : 'Đơn đã duyệt'} <small>${list.length}</small></h2>
  ${list.length ? list.map(card).join('') : '<p class="empty">Chưa có đơn nào dành cho bạn.</p>'}</section>`;
}
function orderSheet(o: Order) {
  const v = vis(o) === 'prices-hidden', raw = orderTotals(o), t = v ? hidePrices(raw) : raw, f = facts(o), st = STAGE[orderStage(f)]!;
  const acts = nextActions(actor(), f, S.rules);
  const money = (n: number) => v ? '—' : vnd(n);
  const ch = (title: string, arr: any[], fmt: (c: any) => string) => arr.length ? `<h4>${title}</h4><ul class="people">${arr.map(c => `<li>${fmt(c)}</li>`).join('')}</ul>` : '';
  return `<div class="sheet-h"><button class="x" data-act="close" aria-label="Đóng">×</button><h3>${esc(o.ticket)}</h3></div>
  <p class="muted"><span class="badge ${st[1]}">${st[0]}</span> ${esc(supplierName(o.supplierId))} · báo giá ${esc(o.quoteNo)} · về ${dmy(o.arrivalDate)}${o.internalNo ? ' · số phiếu NCC ' + esc(o.internalNo) : ''}</p>
  ${table(['Mã', 'Sản phẩm', 'SL', 'Đơn giá', 'CK', 'Thành tiền'], o.lines.map((l, i) => [esc(l.sku), esc(l.name), l.quantity, money(l.price), v ? '—' : (t.rows[i]!.purchaseDiscount) + '%', money(t.rows[i]!.lineTotal)]))}
  <dl class="sum"><div><dt>Tạm tính</dt><dd>${money(t.subtotal)}</dd></div><div><dt>VAT</dt><dd>${money(t.vat)}</dd></div><div class="big"><dt>Tổng cộng</dt><dd>${money(t.total)}</dd></div><div><dt>Cọc ${t.depositRate}%</dt><dd>${money(t.depositAmount)}</dd></div><div><dt>Đã trả</dt><dd>${money(t.depositPaidAmount)}</dd></div><div><dt>Còn lại</dt><dd>${money(t.remainingAmount)}</dd></div></dl>
  ${v ? '<p class="hint">Nhân viên xem được đơn nhưng giá và tiền bị ẩn.</p>' : ''}
  <ul class="people"><li>Bản ký: <b>${o.signature ? esc(o.signature.fileName) + ' (' + Math.round(o.signature.size / 1024) + ' KB)' : o.signatureDownloaded ? 'đã tải mẫu về' : 'chưa có'}</b></li>${o.ready ? `<li>Sẵn sàng giao ${dmy(o.ready.date)} (${o.ready.mode === 'full' ? 'đủ' : 'một phần'})</li>` : ''}${o.receivedAt ? '<li>Đã nhập kho</li>' : ''}</ul>
  ${ch('NCC đổi ngày hẹn', o.dateChanges, c => `${esc(c.sku)}: ${dmy(c.from)} → ${dmy(c.to)}`)}${ch('NCC đổi chiết khấu', o.discountChanges, c => `${esc(c.sku)}: ${c.from}% → ${c.to}%`)}
  <h4>Thao tác của bạn</h4><div class="actions wrap">${acts.length ? acts.map(a => `<button class="btn ${a === 'approve' || a === 'confirm' ? 'primary' : ''}" data-act="do" data-id="${o.id}" data-a="${a}">${ACTION_LABEL[a]}</button>`).join('') : '<span class="muted">Không có thao tác nào ở bước này với tài khoản này.</span>'}</div>
  <h4>Lịch sử</h4><ol class="log">${o.log.slice().reverse().map(l => `<li>${esc(l)}</li>`).join('')}</ol>`;
}
function actSheet(o: Order, a: OrderAction) {
  const L = o.lines, inp = (n: string, v: unknown, l: string, t = 'text') => `<label class="f"><span>${l}</span><input name="${n}" value="${esc(v)}" inputmode="${t === 'num' ? 'decimal' : 'text'}" autocomplete="off"></label>`;
  const totalsNow = orderTotals(o);
  let body = '';
  if (a === 'approve') body = inp('email', o.supplierEmail || SUPPLIERS.find(s => s.id === o.supplierId)!.email, 'Email NCC nhận đơn') + inp('cc', '', 'Email CC (ngăn bằng ;)') + L.map((l, i) => inp('d_' + i, l.purchaseDiscount ?? 0, `Chiết khấu ${esc(l.sku)} (%)`, 'num')).join('');
  if (a === 'set_internal_number') body = inp('no', o.internalNo, 'Số phiếu nội bộ của NCC (tối đa 100 ký tự)');
  if (a === 'upload_signature') body = inp('fname', 'ban-ky.pdf', 'Tên file') + `<label class="f"><span>Loại file</span><select name="mime"><option>application/pdf</option><option>image/png</option><option>image/jpeg</option><option>application/zip</option></select></label>` + inp('mb', '0.5', 'Dung lượng (MB)', 'num') + '<p class="hint">Thử chọn zip hoặc nhập 7 MB để xem đơn bị từ chối.</p>';
  if (a === 'confirm') body = L.map((l, i) => `<fieldset class="line"><legend>${esc(l.sku)} · ${esc(l.name)}</legend><div class="grid3">${inp('q_' + i, l.quantity, 'SL')}${inp('d_' + i, l.purchaseDiscount ?? 0, 'CK (%)', 'num')}${inp('date_' + i, o.arrivalDate, 'Ngày hẹn giao')}</div><label class="chk"><input type="checkbox" name="ok_${i}" checked> Tôi xác nhận CK, SL và ngày giao</label></fieldset>`).join('') + '<p class="hint">Đổi số lượng, đặt ngày 2026-02-31 hoặc bỏ tick để xem lỗi. Đổi ngày hoặc CK sẽ được ghi lại.</p>';
  if (a === 'request_deposit') body = L.map((l, i) => `<label class="chk"><input type="checkbox" name="ok_${i}" checked> ${esc(l.sku)} · SL ${l.quantity}<input type="hidden" name="q_${i}" value="${l.quantity}"></label>`).join('') + inp('rate', o.depositRate, 'Tỷ lệ cọc (%)', 'num');
  if (a === 'pay_deposit') body = inp('amount', totalsNow.depositAmount, 'Số tiền đã nhận', 'num');
  if (a === 'mark_delivery_ready') body = inp('date', o.arrivalDate, 'Ngày muốn giao') + `<label class="f"><span>Hình thức</span><select name="mode"><option value="full">Giao đủ</option><option value="partial">Giao một phần</option></select></label>` + L.map((l, i) => inp('p_' + i, l.quantity, `Giao một phần: SL ${esc(l.sku)} (tối đa ${l.quantity})`, 'num')).join('');
  const confirmText: Record<string, string> = { delete_signature: 'Xoá bản ký đã tải lên?', unmark_delivery_ready: 'Bỏ báo sẵn sàng giao?', receive: 'Xác nhận đã nhập kho? Tồn kho sẽ được cập nhật.' };
  return `<form data-form="act" data-id="${o.id}" data-a="${a}" novalidate><div class="sheet-h"><button type="button" class="x" data-act="back-order" data-id="${o.id}" aria-label="Quay lại">‹</button><h3>${ACTION_LABEL[a]}</h3></div>
  <p class="muted">${esc(o.ticket)} · ${esc(supplierName(o.supplierId))}</p>${body || `<p>${confirmText[a] ?? ''}</p>`}${ui.error ? `<p class="err" role="alert">${esc(ui.error)}</p>` : ''}
  <div class="actions"><button class="btn primary" type="submit">${ACTION_LABEL[a]}</button><button type="button" class="btn" data-act="back-order" data-id="${o.id}">Hủy</button></div></form>`;
}
function runAction(o: Order, a: OrderAction, f: FormData) {
  const c = checkAction(a, actor(), facts(o), S.rules); if (!c.ok) throw new AppError(c.status, c.message);
  const g = (k: string) => String(f.get(k) ?? ''), expected = o.lines.map(l => ({ sku: l.sku, name: l.name, quantity: l.quantity }));
  switch (a) {
    case 'approve': { const r = validateApproval(expected, { supplierEmail: g('email'), ccEmail: g('cc'), itemDiscounts: o.lines.map((l, i) => ({ sku: l.sku, purchaseDiscount: g('d_' + i) })) }); o.supplierEmail = r.supplierEmail; o.ccEmail = r.cc.join(', '); o.lines.forEach((l, i) => { l.purchaseDiscount = r.itemDiscounts[i]!.purchaseDiscount; }); o.approvalStatus = 'approved'; logTo(o.log, 'duyệt đơn và gửi cho NCC.'); break; }
    case 'set_internal_number': o.internalNo = cleanInternalOrderNumber(g('no')); logTo(o.log, 'cập nhật số phiếu NCC.'); break;
    case 'upload_signature': { const mb = num(g('mb')); const r = validateSignatureUpload({ fileName: g('fname'), mimeType: g('mime'), sizeBytes: Math.round(mb * 1048576) }); o.signature = { fileName: r.fileName, mime: r.mimeType, size: Math.round(mb * 1048576), at: stamp() }; logTo(o.log, `tải bản ký ${r.fileName}.`); break; }
    case 'delete_signature': delete o.signature; logTo(o.log, 'xoá bản ký.'); break;
    case 'confirm': {
      const approved = new Map(o.lines.map(l => [l.sku.toLowerCase(), l.purchaseDiscount ?? 0]));
      const rows = o.lines.map((l, i) => ({ sku: l.sku, quantity: g('q_' + i), purchaseDiscount: g('d_' + i), promisedDate: g('date_' + i), confirmed: f.get('ok_' + i) === 'on' }));
      const r = validateConfirmation(expected, approved, o.arrivalDate, rows);
      o.lines.forEach((l, i) => { const k = r.confirmations[i]!; l.confirmed = { purchaseDiscount: k.purchaseDiscount, promisedDate: k.promisedDate, supplierNote: k.supplierNote }; });
      o.dateChanges = r.dateChanges; o.discountChanges = r.discountChanges; o.confirmedAt = stamp(); logTo(o.log, `xác nhận đơn${r.dateChanges.length || r.discountChanges.length ? ' (có đổi ngày/chiết khấu)' : ''}.`); break; }
    case 'request_deposit': { const rows = o.lines.map((l, i) => ({ sku: l.sku, quantity: g('q_' + i), confirmed: f.get('ok_' + i) === 'on' })); const r = validateDepositRequest(expected, rows, { provided: true, value: g('rate') }, o.depositRate); o.depositRate = r.depositRate; o.depositRequestedAt = o.depositRequestedAt ?? stamp(); logTo(o.log, `yêu cầu đặt cọc ${r.depositRate}%.`); break; }
    case 'pay_deposit': { o.paidAmount = validatePaidAmount(g('amount'), orderTotals(o).depositAmount); o.depositPaidAt = stamp(); logTo(o.log, `ghi nhận đã nhận cọc ${vnd(o.paidAmount)}.`); break; }
    case 'mark_delivery_ready': { const mode = g('mode'); const r = validateDeliveryReady(expected, { mode, deliveryDate: g('date'), rows: o.lines.map((l, i) => ({ sku: l.sku, quantity: g('p_' + i) })) }); o.ready = { mode: r.mode, date: r.deliveryDate, rows: r.rows.map(x => ({ sku: x.sku, quantity: x.quantity })) }; logTo(o.log, `báo sẵn sàng giao ${dmy(r.deliveryDate)} (${r.mode === 'full' ? 'đủ' : 'một phần'}).`); break; }
    case 'unmark_delivery_ready': delete o.ready; logTo(o.log, 'bỏ báo sẵn sàng giao.'); break;
    case 'receive': o.receivedAt = stamp(); logTo(o.log, 'xác nhận nhập kho.'); break;
  }
}

// ---------- quyền & luật ----------
function rulesTab() {
  const m = me(), rule = (k: keyof Rules, t: string, d: string) => `<label class="chk rule"><input type="checkbox" data-act="rule" data-k="${k}" ${S.rules[k] ? 'checked' : ''}><span><b>${t}</b><small>${d}</small></span></label>`;
  return `<section><h2>Bạn vào được những đâu</h2><p class="muted">Tài khoản <b>${esc(m.name)}</b>. Mỗi chức năng của hệ thống thuộc một khu vực; chặn quyền nằm ở một chốt duy nhất trước mọi chức năng.</p>
  <ul class="areas">${(['self', 'business', 'supplier-portal', 'ncc-admin', 'admin'] as Area[]).map(a => { const ok = canAccessArea({ ...viewer(), active: true }, a); return `<li class="${ok ? 'yes' : 'no'}"><b>${ok ? 'Được vào' : 'Bị chặn'}</b> ${AREA_LABEL[a]}</li>`; }).join('')}</ul>
  <h2>Luật siết chặt đơn NCC</h2><p class="muted">So với hệ thống cũ, ba luật đầu mặc định bật. Tắt thử để thấy khác biệt ở màn Đơn NCC.</p>
  ${rule('freezeAfterReceipt', 'Đã nhập kho thì khoá thao tác của NCC', 'NCC không còn tải/xoá bản ký, xác nhận, yêu cầu cọc, báo giao.')}${rule('lockSignatureAfterConfirm', 'Đã xác nhận thì không xoá/thay bản ký', 'Bản ký là căn cứ của xác nhận.')}${rule('receiveRequiresApproval', 'Không nhập kho đơn chưa duyệt', 'Đơn NCC phải được Manager duyệt trước.')}${rule('depositRequiresConfirmation', 'Phải xác nhận đơn trước khi yêu cầu cọc', 'Mặc định tắt, giống hệ thống cũ.')}
  <button class="btn danger" data-act="reset">Đặt lại dữ liệu mẫu</button></section>`;
}

// ---------- vẽ ----------
function sheetHtml() {
  const sh = ui.sheet; if (!sh) return '';
  let inner = '';
  const q = 'id' in sh ? S.quotes.find(x => x.id === sh.id) : undefined, o = 'id' in sh ? S.orders.find(x => x.id === sh.id) : undefined;
  if (sh.k === 'quote' && q) inner = quoteSheet(q); else if (sh.k === 'edit') inner = editSheet(); else if (sh.k === 'share' && q) inner = shareSheet(q); else if (sh.k === 'assign' && q) inner = assignSheet(q);
  else if (sh.k === 'order' && o) inner = orderSheet(o); else if (sh.k === 'act' && o) inner = actSheet(o, sh.a);
  return `<div class="scrim" data-act="close"></div><div class="sheet" role="dialog" aria-modal="true">${inner}</div>`;
}
export function render() {
  const y = window.scrollY;
  if (ui.tab === 'quotes' && !canAccessArea({ ...viewer(), active: true }, 'business')) ui.tab = 'orders';
  const main = ui.tab === 'quotes' ? quotesTab() : ui.tab === 'orders' ? ordersTab() : rulesTab();
  root.innerHTML = header() + `<main>${main}</main>` + tabbar() + sheetHtml() + (ui.toast ? `<div class="toast ${ui.toast.kind}" role="status">${esc(ui.toast.text)}</div>` : '');
  document.body.classList.toggle('lock', Boolean(ui.sheet)); window.scrollTo(0, y);
}
const open = (sheet: Sheet) => { ui.sheet = sheet; ui.error = ''; render(); };

/** Hiện lỗi NGAY TẠI CHỖ, không vẽ lại form: giữ nguyên những gì người dùng đã nhập. */
function showError(form: HTMLFormElement, msg: string) {
  let el = form.querySelector('.err');
  if (!el) { el = document.createElement('p'); el.className = 'err'; el.setAttribute('role', 'alert'); form.querySelector('.actions')!.before(el); }
  el.textContent = msg; el.scrollIntoView({ block: 'center' });
}

// ---------- sự kiện ----------
root.addEventListener('click', (e) => {
  const el = (e.target as Element).closest('[data-act]') as HTMLElement | null; if (!el) return;
  const a = el.dataset.act!, id = el.dataset.id!;
  if (a === 'share-type') { const form = el.closest('form')!; ui.shareType = (form.querySelector('input[name=tt]:checked') as HTMLInputElement).value as any; render(); return; }
  if (a === 'rule') { S.rules[el.dataset.k as keyof Rules] = (el as HTMLInputElement).checked; save(); render(); return; }
  if ((e.target as Element).closest('.sheet') && a === 'close' && (e.target as Element).classList.contains('scrim')) return;
  switch (a) {
    case 'login': S.meId = id; ui.sheet = null; save(); render(); break;
    case 'tab': ui.tab = id as any; ui.sheet = null; render(); break;
    case 'close': ui.sheet = null; ui.draft = null; ui.error = ''; render(); break;
    case 'back': open({ k: 'quote', id }); break;
    case 'back-order': open({ k: 'order', id }); break;
    case 'open-quote': open({ k: 'quote', id }); break;
    case 'open-order': open({ k: 'order', id }); break;
    case 'new-quote': ui.draft = draftFrom(null); open({ k: 'edit', id: null }); break;
    case 'edit-quote': ui.draft = draftFrom(S.quotes.find(x => x.id === id)!); open({ k: 'edit', id }); break;
    case 'add-row': { ui.draft = readDraft(el.closest('form') as HTMLFormElement); ui.draft.rows.push(blankRow()); render(); break; }
    case 'del-row': { ui.draft = readDraft(el.closest('form') as HTMLFormElement); ui.draft.rows.splice(Number(el.dataset.i), 1); render(); break; }
    case 'share': ui.shareType = 'member'; open({ k: 'share', id }); break;
    case 'assign': open({ k: 'assign', id }); break;
    case 'unshare': { const q = S.quotes.find(x => x.id === id)!; if (!canShareQuotation(viewer(), own(q))) { toast('Chỉ chủ báo giá hoặc Manager được gỡ chia sẻ.', 'err'); break; } q.shares = q.shares.filter(s => !(s.targetType === el.dataset.t && s.targetId === el.dataset.x)); logTo(q.log, 'gỡ một chia sẻ.'); save(); render(); break; }
    case 'do': { const o = S.orders.find(x => x.id === id)!, act = el.dataset.a as OrderAction; open({ k: 'act', id, a: act }); void o; break; }
    case 'reset': S = seed(); save(); ui.sheet = null; toast('Đã đặt lại dữ liệu mẫu.'); render(); break;
  }
});
root.addEventListener('input', (e) => {
  const form = (e.target as Element).closest('form[data-form=edit]') as HTMLFormElement | null; if (!form) return;
  document.getElementById('live')!.innerHTML = liveTotals(readDraft(form));
});
root.addEventListener('submit', (e) => {
  e.preventDefault(); const form = e.target as HTMLFormElement, kind = form.dataset.form, f = new FormData(form);
  try {
    if (kind === 'edit') {
      const d = readDraft(form), data = cleanQuotation(draftInput(d)), existing = d.id ? S.quotes.find(x => x.id === d.id)! : null;
      if (existing) {
        if (!canEditQuotation(viewer(), own(existing), existing.shares)) throw new AppError(403, 'Bạn không có quyền sửa báo giá này.');
        existing.data = data; existing.revision++; existing.updatedAt = stamp(); logTo(existing.log, `sửa báo giá (bản ${existing.revision}).`);
      } else { S.quotes.unshift({ id: 'q' + (++S.seq), creatorId: me().id, assigneeId: null, data, revision: 1, updatedAt: stamp(), shares: [], log: [`${me().name}: tạo báo giá.`] }); }
      save(); const sid = existing ? existing.id : S.quotes[0]!.id; ui.draft = null; toast(existing ? 'Đã lưu báo giá.' : 'Đã tạo báo giá.'); open({ k: 'quote', id: sid });
    } else if (kind === 'share') {
      const q = S.quotes.find(x => x.id === form.dataset.id)!, tt = String(f.get('tt')) as 'member' | 'position';
      const plan = planShare(viewer(), own(q), { targetType: tt, targetId: String(f.get('target')), permission: String(f.get('permission')) as any }, directory(), DEFAULT_POSITIONS.map(p => p.id));
      q.shares = [...q.shares.filter(s => !(s.targetType === plan.targetType && s.targetId === plan.targetId)), plan];
      logTo(q.log, `chia sẻ cho ${plan.targetType === 'member' ? nameOf(plan.targetId) : 'chức vụ ' + DEFAULT_POSITIONS.find(p => p.id === plan.targetId)?.name} (${plan.permission === 'edit' ? 'xem và sửa' : 'chỉ xem'}).`); save(); toast('Đã chia sẻ.'); open({ k: 'quote', id: q.id });
    } else if (kind === 'assign') {
      const q = S.quotes.find(x => x.id === form.dataset.id)!, from = effectiveAssigneeId(q);
      const plan = planReassignment(viewer(), own(q), String(f.get('to')), directory());
      if (!plan.changed) { toast('Người phụ trách không thay đổi.'); open({ k: 'quote', id: q.id }); return; }
      q.assigneeId = plan.assigneeId; logTo(q.log, `đổi người phụ trách từ ${nameOf(from)} sang ${nameOf(plan.audit.to)}.`); save(); toast('Đã đổi người phụ trách.'); open({ k: 'quote', id: q.id });
    } else if (kind === 'act') {
      const o = S.orders.find(x => x.id === form.dataset.id)!, a = form.dataset.a as OrderAction;
      runAction(o, a, f); save(); toast(ACTION_LABEL[a] + ': xong.'); open({ k: 'order', id: o.id });
    }
  } catch (err) { showError(form, fail(err)); }
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && ui.sheet) { ui.sheet = null; ui.draft = null; render(); } });

S = load();
(window as any).__demo = { get state() { return S; } };
render();
