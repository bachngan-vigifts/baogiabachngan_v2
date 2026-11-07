/**
 * BÁO CÁO CA (dùng chung: popup Báo cáo ca ở Bán hàng nhanh, Sổ quỹ › Xem ca, hộp Kết ca).
 * Cùng số liệu với bản in K80 (pos-report.js) – chỉ trình bày lại cho dễ đọc:
 *  ô tổng · dòng tiền két (đầu ca + tiền mặt thu + thu tay − chi tay = két hệ thống) · tiền thu theo cách thu ·
 *  phiếu thu / chi tay · Ship COD + đơn cọc · trả hàng · tra soát đầu ca · quy tắc đang áp dụng.
 * Không tự tính lại két: dùng `d.expectedCash` của máy chủ; phần chênh (nếu có) hiện thành dòng "Khác".
 * `onOpen(target)`: bấm tiêu đề khối → mở trang liên quan (orders | cash | returns | flows | cod).
 */
import { cashKindLabel } from './pos-report.js';

const money = n => Number(n ?? 0).toLocaleString('vi-VN') + ' đ';
const signed = n => (n > 0 ? '+' : n < 0 ? '−' : '') + Math.abs(Number(n || 0)).toLocaleString('vi-VN');
const hm = iso => iso ? new Date(iso).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Ho_Chi_Minh' }) : '';
const when = iso => iso ? new Date(iso).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric' }) : '';
function el(tag, cls = '', text) { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = String(text); return n; }
const STATUS = { posted: ['Đã ghi', 'ok'], pending: ['Chờ duyệt', 'warn'], voided: ['Đã huỷ', 'muted'] };

/** Các số tổng hợp từ báo cáo máy chủ (tách để test được). */
export function shiftFigures(d) {
  const manual = d.manual || [];
  const manualIn = manual.filter(x => x.direction === 'in').reduce((t, x) => t + x.amount, 0);
  const manualOut = manual.filter(x => x.direction === 'out').reduce((t, x) => t + x.amount, 0);
  const cashSales = d.cashSales ?? d.cash ?? 0, cashCod = d.cashCod ?? 0;
  const opening = d.shift?.openingCash ?? 0, expected = d.expectedCash ?? 0;
  const adjustment = d.currentAdjustmentNet ?? 0;
  const other = Math.round(expected - (opening + cashSales + cashCod + manualIn - manualOut + adjustment));
  const cash = d.cash ?? cashSales + cashCod, transfer = d.transfer ?? 0;
  return { manualIn, manualOut, cashSales, cashCod, opening, expected, adjustment, other, cash, transfer, received: cash + transfer, pending: (d.pendingEntries || []).length };
}

/** Trạng thái chênh lệch khi kết ca: chưa đếm (xám) · khớp (xanh) · lệch (cam). */
export function differenceState(counted, expected) {
  if (counted === '' || counted == null || !Number.isFinite(Number(counted))) return { state: 'empty', text: 'Nhập tiền thực đếm để xem chênh lệch', diff: null };
  const diff = Math.round(Number(counted) - expected);
  return diff === 0 ? { state: 'match', text: 'Khớp két', diff } : { state: 'diff', text: 'Lệch ' + signed(diff) + ' đ', diff };
}

function card(title, aside, onClick) {
  const box = el('section', 'sr-card'), head = el(onClick ? 'button' : 'div', 'sr-card-head');
  if (onClick) { head.type = 'button'; head.addEventListener('click', onClick); }
  head.append(el('h3', '', title), el('span', 'sr-aside', aside || ''));
  box.append(head);
  return box;
}
function pairs(box, rows) {
  for (const [k, v, cls] of rows) { const r = el('div', 'sr-row' + (cls ? ' ' + cls : '')); r.append(el('span', '', k), el('b', '', v)); box.append(r); }
}

export function renderShiftReport(container, d, { onOpen } = {}) {
  const f = shiftFigures(d), open = target => onOpen ? () => onOpen(target) : undefined, link = t => onOpen ? t + ' ›' : '';
  const wrap = el('div', 'sr');
  // Đầu báo cáo: quầy, người mở, giờ.
  const meta = el('div', 'sr-meta');
  for (const t of [d.register?.name, d.memberName ? 'Người mở: ' + d.memberName : '', d.shift?.openedAt ? hm(d.shift.openedAt) + ' → ' + (d.shift.closedAt ? hm(d.shift.closedAt) : 'đang mở') : '',
    d.shift?.closedAt ? 'Đã kết ' + when(d.shift.closedAt) : d.asOf ? 'Số liệu đến ' + hm(d.asOf) : ''].filter(Boolean)) meta.append(el('span', 'sr-chip', t));
  wrap.append(meta);

  // Ô tổng: giá trị đơn tách khỏi tiền thực thu (tránh đọc nhầm là tiền).
  const kpi = el('div', 'sr-kpis');
  for (const [label, value, sub, target] of [
    ['Số bill', d.bills?.count ?? 0, 'Giá trị đơn đã lập ' + money(d.bills?.revenue), 'orders'],
    ['Tiền thực thu', money(f.received), 'Tiền mặt + chuyển khoản (gồm COD, cọc đã thu)', 'cash'],
    ['Tiền mặt vào két', money(f.cash), 'Chuyển khoản không vào két', 'cash'],
    ['Chiết khấu', money(d.bills?.discount), 'Trên giá trị đơn đã lập', 'orders'],
  ]) {
    const k = el(onOpen ? 'button' : 'div', 'sr-kpi');
    if (onOpen) { k.type = 'button'; k.addEventListener('click', open(target)); }
    k.append(el('span', '', label), el('b', '', value), el('small', '', sub));
    kpi.append(k);
  }
  wrap.append(kpi);

  // Dòng tiền két – phần quan trọng nhất khi bàn giao.
  const flow = card('Dòng tiền két', link('Mở Sổ quỹ') || 'Tiền mặt trong ca → két hệ thống', open('cash')), steps = el('div', 'sr-flow');
  const step = (label, value, op, cls = '') => { if (op) steps.append(el('span', 'sr-op', op)); const s = el('div', 'sr-step ' + cls); s.append(el('span', '', label), el('b', '', money(value))); steps.append(s); };
  step('Tiền đầu ca', f.opening);
  step('Tiền mặt bán hàng', f.cashSales, '+');
  if (f.cashCod) step('COD tiền mặt', f.cashCod, '+');
  step('Thu thủ công', f.manualIn, '+');
  step('Chi thủ công', f.manualOut, '−');
  if (f.adjustment) step('Điều chỉnh ca này', Math.abs(f.adjustment), f.adjustment > 0 ? '+' : '−');
  if (f.other) step('Khác', f.other, f.other > 0 ? '+' : '−');
  step('Két hệ thống', f.expected, '=', 'sr-total');
  flow.append(steps);
  if (d.shift?.closedAt && d.countedCash != null) {
    const st = differenceState(d.countedCash, f.expected);
    pairs(flow, [['Thực đếm cuối ca', money(d.countedCash)], ['Chênh lệch', st.state === 'match' ? 'Khớp' : money(st.diff), 'sr-' + st.state]]);
    if (d.differenceReason) flow.append(el('p', 'sr-note', 'Lý do lệch: ' + d.differenceReason));
  }
  for (const x of d.bookAdjustments || []) flow.append(el('p', 'sr-note', 'Điều chỉnh sổ két ' + money(x.direction === 'in' ? x.amount : -x.amount) + (x.affectsShiftCash === true ? ' – đã tính vào két hệ thống của ca này; không phải thu/chi tiền thực.' : x.affectsShiftCash === false ? ' – sửa sổ ca trước, không tính lại vào tiền bàn giao ca này.' : ' – không có thu/chi tiền thực trong ca.')));
  wrap.append(flow);

  // Tiền thu theo cách thu (chỉ khoản thực thu).
  const by = card('Tiền thu theo cách thu', link('Mở Sổ quỹ') || 'Chỉ khoản đã thực thu', open('cash'));
  const total = f.received || 1, bar = el('div', 'sr-bar');
  for (const [cls, v] of [['cash', f.cash], ['transfer', f.transfer]]) { const seg = el('span', 'sr-seg sr-' + cls); seg.style.width = (v / total * 100) + '%'; bar.append(seg); }
  const legend = el('div', 'sr-legend');
  for (const [cls, label, v] of [['cash', 'Tiền mặt', f.cash], ['transfer', 'Chuyển khoản', f.transfer]]) { const i = el('span'); i.append(el('i', 'sr-dot sr-' + cls), document.createTextNode(`${label} ${money(v)}`)); legend.append(i); }
  by.append(bar, legend);
  if (d.orderFlows && (d.orderFlows.deposit || d.orderFlows.balance || d.orderFlows.prepaid))
    by.append(el('p', 'sr-note', `Trong đó: cọc ${money(d.orderFlows.deposit)} · thu nốt ${money(d.orderFlows.balance)} · ship trả trước ${money(d.orderFlows.prepaid)}`));
  wrap.append(by);

  const grid = el('div', 'sr-grid');
  // Thu / chi thủ công: từng phiếu (có giờ, trạng thái); báo cáo cũ không có danh sách → gộp theo loại.
  const manual = card('Thu / chi thủ công', link('Mở Sổ quỹ') || `${(d.entries || d.manual || []).length} dòng`, open('cash'));
  const t = el('table', 'sr-table'), tb = el('tbody');
  const hr = el('tr'); for (const h of d.entries ? ['Giờ', 'Loại', 'Nội dung', 'Số tiền', 'Trạng thái'] : ['Loại', 'Số tiền']) hr.append(el('th', '', h));
  const th = el('thead'); th.append(hr); t.append(th, tb);
  if (d.entries) for (const x of d.entries) {
    const r = el('tr'), [lbl, cls] = STATUS[x.status] || [x.status, ''], pill = el('span', 'sr-pill ' + cls, lbl), s = el('td'); s.append(pill);
    r.append(el('td', '', hm(x.at)), el('td', '', cashKindLabel(x.kind)), el('td', 'sr-reason', x.reason), el('td', 'sr-num', signed(x.direction === 'in' ? x.amount : -x.amount)), s);
    tb.append(r);
  } else for (const x of d.manual || []) { const r = el('tr'); r.append(el('td', '', cashKindLabel(x.kind)), el('td', 'sr-num', signed(x.direction === 'in' ? x.amount : -x.amount))); tb.append(r); }
  if (!tb.children.length) manual.append(el('p', 'sr-note', 'Không có phiếu thu / chi trong ca.')); else manual.append(t);
  grid.append(manual);

  // Ship COD + đơn cọc: không vào két, không chặn kết ca.
  const cod = card('Ship COD', link('Mở Ship COD') || 'Cùng két', open('cod')), c = d.cod || {};
  const cnt = x => `${money(x?.amount)} · ${x?.count ?? 0} đơn`;
  pairs(cod, [['Đã giao & đã thu trong ca', cnt(c.receivedInShift)], ['Thu từ ca trước', cnt(c.receivedFromPrevious)], ['Đã giao, chưa thu (không vào két)', cnt(c.pending), c.pending?.count ? 'sr-warn' : '']]);
  if (d.orderFlows) pairs(cod, [['Cọc / trả trước đang chờ CK', `${d.orderFlows.pending.count} khoản · ${money(d.orderFlows.pending.amount)}`, d.orderFlows.pending.count ? 'sr-warn' : ''],
    ['Đơn nhận sau còn phải thu', `${d.orderFlows.outstanding.count} đơn · ${money(d.orderFlows.outstanding.amount)}`]]);
  cod.append(el('p', 'sr-note', 'Đơn chưa thu xong chuyển sang ca sau, không chặn kết ca.'));
  if (onOpen && d.orderFlows) { const b = el('button', 'sr-link', 'Mở đơn cọc / ship trả trước ›'); b.type = 'button'; b.addEventListener('click', open('flows')); cod.append(b); }
  grid.append(cod);
  wrap.append(grid);

  // Trả hàng (chỉ khi có).
  const r = d.returns;
  if (r && (r.credit || r.refundedCash || r.refundedTransfer || r.exchanged)) {
    const box = card('Trả / đổi hàng', link('Mở Trả / Đổi'), open('returns'));
    pairs(box, [['Giá trị trả hàng đã nhận', money(r.credit)], ['Giá trị bán trừ hàng trả', money((d.bills?.revenue || 0) - r.credit)],
      ...(r.refundedCash ? [['Hoàn tiền mặt', money(r.refundedCash)]] : []), ...(r.refundedTransfer ? [['Hoàn chuyển khoản', money(r.refundedTransfer)]] : []),
      ...(r.exchanged ? [['Thanh toán bằng tiền đổi hàng', money(r.exchanged)]] : [])]);
    wrap.append(box);
  }

  // Tra soát đầu ca: tách riêng, không tính vào kết ca.
  if (d.openingComparison) {
    const oc = d.openingComparison, box = card('Đầu ca', oc.difference ? 'Lệch – tra soát riêng' : 'Khớp bàn giao');
    pairs(box, [['Tiền đầu ca thực đếm', money(f.opening)], ['Bàn giao từ ca trước', money(oc.expectedCash)], ['Chênh lệch khi mở ca', oc.difference ? money(oc.difference) : 'Khớp', oc.difference ? 'sr-diff' : 'sr-match']]);
    box.append(el('p', 'sr-note', 'Tra soát đầu ca tách riêng, không tính vào kết ca này.'));
    wrap.append(box);
  }

  // Quy tắc đang áp dụng (trạng thái thật của ca).
  const rules = card('Quy tắc đang áp dụng', '');
  pairs(rules, [['Chuyển khoản và COD chưa thu không vào két', 'Đúng quy tắc'],
    ['Phiếu chờ duyệt chặn kết ca', f.pending ? `${f.pending} phiếu` : 'Không có', f.pending ? 'sr-warn' : 'sr-match'],
    ['Lệch khác 0 bắt buộc lý do, tự mở tra soát', d.shift?.closedAt ? (d.cashDifference ? 'Đã lệch' : 'Khớp') : 'Khi kết ca']]);
  wrap.append(rules);
  container.append(wrap);
  return f;
}
