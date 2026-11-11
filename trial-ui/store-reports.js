/**
 * BÁO CÁO CỬA HÀNG TRƯỞNG (CHT) – trang #/store-reports[?registerId=&month=] + hộp nhắc việc 30 phút / lần.
 *  - CHT: lưu nháp / nộp chính thức báo cáo ngày / tuần / tháng / kiểm tồn kho (CRM tự tính số liệu ca POS, Sổ quỹ, trả / đổi / hoàn, doanh số,
 *    hàng bán chạy / chậm, phiếu kiểm kê), giải trình. Nháp không tính là đã nộp.
 *  - Người duyệt (Manager / quyền "Duyệt báo cáo Cửa hàng trưởng"): xem mọi cửa hàng, duyệt; Manager gán CHT và cấu hình cửa hàng.
 *  - Tiền Trách nhiệm tạm tính theo 4 ngạch (domain: src/modules/store/domain/reports.ts). Mọi quyền kiểm tra lại ở máy chủ.
 */
const STATE = { on_time: ['Đúng hạn', 'ok'], late: ['Nộp trễ', 'warn'], missing: ['Chưa nộp – quá hạn', 'danger'], not_due: ['Chưa tới hạn', 'muted'], exempt: ['Miễn – trước ngày triển khai', 'ok'] };
const REVIEW_TONE = { pending: 'muted', ok: 'ok', cash_error: 'danger', order_error: 'danger', gap_unreported: 'danger', excused: 'info' };
export const REMIND_EVERY = 30 * 60_000;
/** Report timestamps always use the same timezone as server deadlines. */
export const reportTimestampText = value => {
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toLocaleString('vi-VN', {hour:'2-digit',minute:'2-digit',day:'2-digit',month:'2-digit',timeZone:'Asia/Ho_Chi_Minh'}) : '—';
};
/** A submitted report keeps its submission state after its deadline passes. */
export function reportDeadlineText(d, now = Date.now()) {
  if (d.report) {
    const state = d.report.state?.state;
    return state === 'on_time' ? 'Đã nộp đúng hạn' : state === 'late' ? 'Đã nộp trễ' : 'Đã nộp chính thức';
  }
  const ms = Date.parse(d.deadline) - now;
  if (!Number.isFinite(ms)) return 'Chưa xác định hạn nộp';
  return ms >= 0 ? `còn ${Math.floor(ms / 3600_000)} giờ ${Math.floor(ms % 3600_000 / 60_000)} phút` : 'Chưa nộp – đã quá hạn';
}

/** Hướng dẫn báo cáo cho CHT (đổi nội dung → tăng ?v=). */
export const GUIDE_URL = 'guides/huong-dan-bao-cao-cua-hang-truong.pdf?v=1';
const guideLink = (cls = 'btn secondary') => `<a class="${cls}" href="${GUIDE_URL}" target="_blank" rel="noopener">Hướng dẫn (PDF)</a>`;
const dm = d => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
const monthLabel = m => `${m.slice(5)}/${m.slice(0, 4)}`;
const addDays = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 86400_000).toISOString().slice(0, 10);
const vnNow = () => new Date(Date.now() + 7 * 3600_000).toISOString();
const store = { get(k) { try { return localStorage.getItem(k); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch { /* chế độ riêng tư */ } } };

/** Kỳ báo cáo → nhãn ngắn. */
export function periodLabel(kind, p) {
  if (kind === 'daily') return dm(p);
  if (kind === 'weekly') return `${dm(p)}–${dm(addDays(p, 6))}`;
  return `Tháng ${monthLabel(p)}`;
}
/** Có cần hiện hộp nhắc không: có việc + đã quá 30 phút từ lần hiện trước. */
export const shouldRemind = (items, lastShown, now) => items.length > 0 && (!lastShown || now - lastShown >= REMIND_EVERY);

export function initStoreReports({ api, root, toast, esc, go, money, confirmBox, userId }) {
  let status = null, timer = null, current = { registerId: '', month: '' }, data = null;
  const pill = (tone, text) => `<span class="pill ${tone}">${esc(text)}</span>`;
  const vnd = n => n === null || n === undefined ? '—' : money(n);
  const label = (kind) => status?.labels?.kinds?.[kind] || kind;
  const remindKey = () => 'crm-store-remind:' + (userId() || '');

  async function loadStatus() {
    status = await api('/store/status');
    const nav = document.querySelectorAll('[data-nav="store-reports"]');
    nav.forEach(a => { a.hidden = !(status.mine || status.canReview); });
    return status;
  }
  /** Sau đăng nhập: hiện mục menu nếu là CHT / người duyệt; CHT thì bật nhắc việc. */
  async function start() {
    stop();
    try { await loadStatus(); } catch { return; }
    if (!status.mine) return;
    const tick = () => { if (!document.hidden) remind(false).catch(() => {}); };
    timer = setInterval(tick, 60_000); tick();
    document.addEventListener('visibilitychange', tick);
  }
  function stop() { if (timer) clearInterval(timer); timer = null; }

  // ---------------- Hộp nhắc việc
  async function remind(force) {
    const last = Number(store.get(remindKey()) || 0), now = Date.now();
    if (!force && last && now - last < REMIND_EVERY) return;
    if (document.querySelector('dialog[open]')) return; // không chen ngang khi đang mở hộp thoại khác
    const r = await api('/store/reminders');
    if (!shouldRemind(r.items, force ? 0 : last, now)) return;
    store.set(remindKey(), String(now));
    const dlg = document.createElement('dialog'); dlg.className = 'modal store-remind';
    dlg.innerHTML = `<div class="modal-head"><h2>Việc cần hoàn thành · ${esc(r.store || '')}</h2><button type="button" class="icon-btn" data-x aria-label="Đóng">×</button></div>
      <div class="modal-body"><p class="muted small">Nhắc lại mỗi 30 phút đến khi hoàn thành. Báo cáo nộp đúng hạn giữ đủ Tiền Trách nhiệm.</p>
        <ul class="store-remind-list">${r.items.map((x, i) => `<li class="${x.overdue ? 'overdue' : ''}"><span><b>${esc(x.label)}</b><small>Hạn: ${esc(reportTimestampText(x.due))}${x.overdue ? ' · <b class="danger-text">Quá hạn</b>' : ''}</small></span>
          <button type="button" class="btn primary small" data-do="${i}">Làm ngay</button></li>`).join('')}</ul></div>
      <div class="modal-foot">${guideLink('btn ghost')}<button type="button" class="btn secondary" data-x>Nhắc lại sau 30 phút</button></div>`;
    document.body.append(dlg); dlg.showModal();
    dlg.addEventListener('close', () => dlg.remove());
    dlg.querySelectorAll('[data-x]').forEach(b => b.onclick = () => dlg.close());
    dlg.querySelectorAll('[data-do]').forEach(b => b.onclick = () => { const x = r.items[+b.dataset.do]; dlg.close();
      go(`#/store-reports?registerId=${encodeURIComponent(r.registerId)}&month=${(x.kind === 'daily' || x.kind === 'weekly' ? x.period.slice(0, 7) : x.period)}`);
      setTimeout(() => openReport(r.registerId, x.kind, x.period), 300); });
  }

  // ---------------- Trang báo cáo
  async function show(query = '') {
    const q = new URLSearchParams(query);
    try { if (!status) await loadStatus(); } catch (e) { root.innerHTML = `<div class="empty"><p>${esc(e.message)}</p></div>`; return; }
    current.registerId = q.get('registerId') || current.registerId || status.mine?.registerId || status.stores?.find(s => s.memberId)?.registerId || status.stores?.[0]?.registerId || '';
    current.month = q.get('month') || current.month || vnNow().slice(0, 7);
    if (!status.mine && !status.canReview) { root.innerHTML = `<div class="empty"><h3>Báo cáo Cửa hàng trưởng</h3><p class="muted">Bạn chưa được gán làm Cửa hàng trưởng. Liên hệ Manager.</p>${guideLink()}</div>`; return; }
    if (!current.registerId) { root.innerHTML = '<div class="empty"><p class="muted">Chưa có cửa hàng (quầy POS) nào.</p></div>'; return; }
    root.innerHTML = '<p class="muted">Đang tải báo cáo…</p>';
    try { data = await api(`/store/reports?registerId=${encodeURIComponent(current.registerId)}&month=${current.month}`); } catch (e) { root.innerHTML = `<div class="empty"><p>${esc(e.message)}</p></div>`; return; }
    render();
  }
  const byKey = () => new Map(data.reports.map(r => [r.kind + ':' + r.period, r]));
  function row(kind, period, r) {
    const due = dueOf(kind, period), st = r ? r.state.state : data.launchAt && due < data.launchAt ? 'exempt' : (new Date().toISOString() > due ? 'missing' : 'not_due');
    const review = r?.review || 'pending', draft = !r && (data.drafts || []).some(x => x.kind === kind && x.period === period);
    const act = data.isManager && (!r || review === 'pending') ? `<button type="button" class="btn ${r ? 'secondary' : 'primary'} small" data-open="${kind}|${period}">${r ? 'Xem / nộp lại' : draft ? 'Tiếp tục nháp' : 'Làm báo cáo'}</button>`
      : `<button type="button" class="btn ghost small" data-open="${kind}|${period}">${data.canReview && r && review === 'pending' ? 'Duyệt' : 'Xem'}</button>`;
    return `<tr><td>${esc(periodLabel(kind, period))}</td><td>${pill(STATE[st][1], STATE[st][0])}${r ? `<small class="muted">Nộp lần đầu: ${esc(reportTimestampText(r.submittedAt))}</small>` : ''}${draft ? ' ' + pill('muted', 'Có nháp – chưa nộp') : ''}${r?.provisional ? ' ' + pill('warn', 'Tạm tính (ca chưa đóng)') : ''}</td>
      <td>${r ? pill(REVIEW_TONE[review], status.labels.reviews[review]) : ''}${r?.explanation ? ' <span class="pill info">Có giải trình</span>' : ''}</td><td class="right">${(st !== 'not_due' || data.isManager) ? act : ''}</td></tr>`;
  }
  // Hạn nộp phía máy khách (chỉ để hiện trạng thái kỳ chưa có báo cáo; máy chủ tính lại khi nộp).
  function dueOf(kind, p) {
    const vn = (day, h) => new Date(Date.parse(day + 'T00:00:00Z') - 7 * 3600_000 + h * 3600_000).toISOString();
    if (kind === 'daily') return vn(p, 22);
    if (kind === 'weekly') return vn(addDays(p, 7), 10);
    const [y, m] = p.split('-').map(Number), next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
    return vn(next + '-02', 0);
  }
  function render() {
    const keys = byKey(), r = data.responsibility, today = vnNow().slice(0, 10), monday = addDays(today, -((new Date(today + 'T00:00:00Z').getUTCDay() + 6) % 7));
    const stores = status.canReview ? status.stores : [{ registerId: status.mine.registerId, name: status.mine.name }];
    const SLOT = { daily: 'Báo cáo ngày', weekly: 'Báo cáo tuần', monthly: 'Báo cáo tháng', stocktake: 'Kiểm tồn kho' };
    const table = (rows, empty) => rows.length ? `<div class="table-wrap"><table class="data-table store-table"><thead><tr><th>Kỳ</th><th>Nộp</th><th>Duyệt</th><th></th></tr></thead><tbody>${rows.join('')}</tbody></table></div>` : `<p class="muted small">${empty}</p>`;
    root.innerHTML = `
      <div class="page-head"><div><h1>Báo cáo Cửa hàng trưởng</h1><p class="muted">${esc(data.store.name)} · Tháng ${esc(monthLabel(data.month))}</p></div>
        <div class="head-actions store-filters">
          ${stores.length > 1 ? `<select id="store-pick" aria-label="Cửa hàng">${stores.map(s => `<option value="${esc(s.registerId)}" ${s.registerId === current.registerId ? 'selected' : ''}>${esc(s.name)}${s.memberName ? ' · ' + esc(s.memberName) : ''}</option>`).join('')}</select>` : ''}
          <input type="month" id="store-month" value="${esc(current.month)}" aria-label="Tháng">
          ${guideLink()}
          ${status.canAssign ? '<button type="button" class="btn secondary" data-assign>Gán CHT</button>' : ''}
          ${data.canConfigure ? '<button type="button" class="btn secondary" data-settings>Cấu hình cửa hàng</button>' : ''}
        </div></div>
      ${data.isManager ? `<div class="store-quick">
        <button type="button" class="btn primary" data-open="daily|${today}">Báo cáo ngày hôm nay</button>
        <button type="button" class="btn secondary" data-open="weekly|${addDays(monday, -7)}">Báo cáo tuần trước</button>
        <button type="button" class="btn secondary" data-open="monthly|${current.month}">Báo cáo tháng</button>
        <button type="button" class="btn secondary" data-open="stocktake|${current.month}">Kiểm tồn kho</button></div>` : ''}
      <div class="card store-resp"><div class="card-title-row"><h2 class="card-title">Tiền Trách nhiệm tháng ${esc(monthLabel(data.month))} (tạm tính)</h2><strong class="store-total">${vnd(r.total)}</strong></div>
        <div class="store-slots">${r.parts.map(p => `<div class="store-slot ${p.amount === 250000 ? 'full' : p.amount ? 'part' : 'zero'}"><small>${SLOT[p.slot]}</small><b>${vnd(p.amount)}</b>
          <span class="muted small">${p.slot === 'daily' || p.slot === 'weekly' ? `${p.fails} lần chưa đạt` : p.amount === 250000 ? 'Đạt' : 'Chưa đạt'}</span></div>`).join('')}</div>
        <p class="muted small">Ngày cần báo cáo = ngày cửa hàng mở ca POS. Chỉ báo cáo <b>nộp chính thức</b> mới được tính; nháp chưa tính. Sai số liệu sổ quỹ (người duyệt đánh dấu) tính 2 lần. Có lý do khách quan được duyệt "Miễn" thì không tính.</p></div>
      <div class="card"><h2 class="card-title">Báo cáo ngày (hạn 22h00)</h2>${table(data.dailyDays.slice().reverse().map(d => row('daily', d, keys.get('daily:' + d))), 'Tháng này cửa hàng chưa mở ca nào.')}</div>
      <div class="card"><h2 class="card-title">Báo cáo tuần (hạn 10h00 thứ Hai tuần sau)</h2>${table(data.weeks.slice().reverse().map(w => row('weekly', w, keys.get('weekly:' + w))), 'Chưa có tuần cần báo cáo trong tháng.')}</div>
      <div class="card"><h2 class="card-title">Báo cáo tháng & kiểm tồn kho (hạn trước ngày 02 tháng sau)</h2>${table(['monthly', 'stocktake'].map(k => row(k, data.month, keys.get(k + ':' + data.month)).replace(/<td>Tháng [^<]*<\/td>/, `<td>${esc(label(k))}</td>`)), '')}</div>`;
    labelCells(root);
    root.querySelector('#store-pick')?.addEventListener('change', e => go(`#/store-reports?registerId=${encodeURIComponent(e.target.value)}&month=${current.month}`));
    root.querySelector('#store-month')?.addEventListener('change', e => { if (e.target.value) go(`#/store-reports?registerId=${encodeURIComponent(current.registerId)}&month=${e.target.value}`); });
    root.querySelector('[data-assign]')?.addEventListener('click', assign);
    root.querySelector('[data-settings]')?.addEventListener('click', () => settings(current.registerId));
    root.querySelectorAll('[data-open]').forEach(b => b.onclick = () => { const [kind, period] = b.dataset.open.split('|'); openReport(current.registerId, kind, period); });
  }

  // ---------------- Hộp nộp / xem / duyệt báo cáo
  /** Điện thoại: bảng hiện dạng thẻ – gắn tên cột cho từng ô. */
  const labelCells = el => el.querySelectorAll('table.data-table').forEach(t => { const heads = [...t.querySelectorAll('thead th')].map(th => th.textContent);
    t.querySelectorAll('tbody tr').forEach(tr => [...tr.children].forEach((td, i) => { if (heads[i]) td.dataset.label = heads[i]; })); });
  const factTable = (head, rows) => rows.length ? `<div class="table-wrap"><table class="data-table store-facts"><thead><tr>${head.map(h => `<th${h.startsWith('>') ? ' class="right"' : ''}>${esc(h.replace(/^>/, ''))}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>` : '<p class="muted small">Không có dữ liệu.</p>';
  const hm = v => v ? new Date(v).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Ho_Chi_Minh' }) : '';
  const RETURN_STATUS = { pending: 'Chờ duyệt', approved: 'Đã duyệt', processing: 'Đang xử lý', completed: 'Hoàn tất', rejected: 'Từ chối', cancelled: 'Đã huỷ' };
  /** Báo cáo ngày: doanh thu, tiền phải nộp theo sổ quỹ, ca, trả / đổi / hoàn. */
  function dailyHtml(f) {
    const c = f.cash || {}, t = f.totals;
    const cashBox = `<h3>Tiền phải nộp (theo Sổ quỹ)</h3>
      ${c.missingLabels?.length ? `<p class="warn-text small"><b>Thiếu căn cứ:</b> ${c.missingLabels.map(esc).join('; ')}. Chưa tính tiền phải nộp – không tự coi là 0.</p>` : ''}
      <dl class="kv store-kv">
        <dt>Tiền đầu ngày (đếm lúc mở ca đầu)</dt><dd class="num">${vnd(c.opening)}</dd>
        <dt>+ Thu tiền mặt bán hàng / COD</dt><dd class="num">${vnd(c.cashSales)}</dd>
        <dt>+ Thu khác / rút két</dt><dd class="num">${vnd(c.otherIn)}</dd>
        <dt>− Chi vặt, tạm ứng, hoàn tiền khách</dt><dd class="num">${vnd(c.spent)}${c.refundsCash ? `<small>gồm hoàn tiền ${vnd(c.refundsCash)}</small>` : ''}</dd>
        <dt>− Quỹ được giữ lại</dt><dd class="num">${vnd(c.retained)}</dd>
        <dt><b>= Tiền phải nộp</b></dt><dd class="num"><b>${vnd(c.due)}</b>${c.schedule === 'periodic' ? '<small>Lịch nộp theo đợt: không bắt buộc nộp hôm nay</small>' : ''}</dd>
        <dt>Đã nộp theo Sổ quỹ (phiếu Nộp két)</dt><dd class="num">${vnd(c.depositedBook)}</dd>
        <dt>CHT khai đã nộp ngân hàng</dt><dd class="num">${vnd(c.declared)}</dd>
        ${c.declaredDiff !== null && c.declaredDiff !== undefined ? `<dt>Khai so với phải nộp</dt><dd class="num ${c.declaredDiff ? 'danger-text' : ''}">${vnd(c.declaredDiff)}</dd>` : ''}
        ${c.bookDiff ? `<dt>Khai so với Sổ quỹ</dt><dd class="num danger-text">${vnd(c.bookDiff)}</dd>` : ''}
      </dl>
      ${c.adjustments ? `<p class="muted small">Phiếu điều chỉnh két trong ngày ${vnd(c.adjustments)} – sửa số dư sổ, không tính vào tiền phải nộp.</p>` : ''}
      ${c.pendingEntries ? `<p class="warn-text small">${c.pendingEntries} phiếu thu/chi chờ duyệt (${vnd(c.pendingAmount)}) – chưa tính.</p>` : ''}
      ${c.needsExplanation ? '<p class="warn-text small">Có chênh lệch – nhập giải trình. Người duyệt quyết định đạt / sai sổ quỹ; CRM không tự trừ.</p>' : ''}`;
    const returns = f.returns?.length || f.refunds?.length ? `<h3>Trả / đổi hàng và hoàn tiền</h3>
      ${factTable(['Phiếu', 'Loại', 'Đơn gốc', 'Trạng thái', '>Giá trị'], (f.returns || []).map(r => `<tr><td>${esc(r.returnNo)}</td><td>${r.kind === 'exchange' ? 'Đổi' : 'Trả'}</td><td>${r.orderId ? `<a href="#/orders/${encodeURIComponent(r.orderId)}">${esc(r.orderNo || r.orderId)}</a>` : ''}${r.exchanges.map(x => `<small>Đổi sang <a href="#/orders/${encodeURIComponent(x.orderId)}">${esc(x.orderNo || '')}</a> · ${vnd(x.amount)}</small>`).join('')}</td><td>${esc(RETURN_STATUS[r.status] || r.status)}</td><td class="right num">${vnd(r.total)}</td></tr>`))}
      ${f.refunds?.length ? factTable(['Phiếu hoàn', 'Phiếu trả', 'Hình thức', '>Số tiền'], f.refunds.map(r => `<tr><td>${esc(r.refundNo)}</td><td>${esc(r.returnNo)}</td><td>${r.method === 'cash' ? 'Tiền mặt (đã ghi Sổ quỹ)' : 'Chuyển khoản'}${r.inShift ? '' : '<small>ngoài ca hôm nay</small>'}</td><td class="right num">${vnd(r.amount)}</td></tr>`)) : ''}` : '';
    return `${f.openShifts ? `<p class="warn-text small"><b>Còn ${f.openShifts} ca chưa đóng</b> – số liệu đang là tạm tính. Nộp chính thức lúc này sẽ ghi "tạm tính"; đóng ca rồi nộp lại để hoàn tất (giờ nộp đầu vẫn được giữ).</p>` : ''}
      <dl class="kv store-kv"><dt>Doanh thu POS (gồm VAT, đơn không huỷ)</dt><dd class="num"><b>${vnd(t.revenue)}</b> · ${t.bills} hoá đơn</dd>
        <dt>Tiền mặt / CK / khác</dt><dd class="num">${vnd(t.cash)} / ${vnd(t.transfer)} / ${vnd(t.other)}</dd>
        ${t.returnsValue ? `<dt>Hàng trả hoàn tất</dt><dd class="num">${vnd(t.returnsValue)}</dd>` : ''}
        <dt>Lệch quỹ khi kết ca</dt><dd class="num">${t.shortage ? `<span class="danger-text">Thiếu ${vnd(-t.shortage)}</span> ` : ''}${t.surplus ? `<span class="warn-text">Thừa ${vnd(t.surplus)}</span>` : ''}${!t.shortage && !t.surplus ? '0' : ''}</dd></dl>
      ${cashBox}
      <h3>Các ca</h3>${factTable(['Ca', 'Người', '>Doanh thu', '>Tiền mặt', '>Đếm / hệ thống', '>Lệch'], f.shifts.map(s => `<tr><td>${esc(hm(s.openedAt))}–${s.closedAt ? esc(hm(s.closedAt)) : '<b class="warn-text">đang mở</b>'}</td><td>${esc(s.member)}</td><td class="right num">${vnd(s.revenue)}</td><td class="right num">${vnd(s.cash)}</td><td class="right num">${s.closedAt ? `${vnd(s.countedCash)} / ${vnd(s.expectedCash)}` : 'chưa kết ca'}</td><td class="right num">${vnd(s.cashDifference)}${s.differenceReason ? `<small>${esc(s.differenceReason)}</small>` : ''}</td></tr>`))}
      ${returns}`;
  }
  function factsHtml(kind, f) {
    if (kind === 'daily') return dailyHtml(f);
    if (kind === 'weekly') return weeklyHtml(f);
    if (kind === 'monthly') return monthlyHtml(f);
    return stocktakeHtml(f);
  }
  const pct1 = r => r === null || r === undefined ? '—' : `${(Math.round(r * 1000) / 10).toLocaleString('vi-VN')}%`;
  /** Chỉ tiêu cửa hàng (cùng nguồn xét thưởng DS cửa hàng) – tách khỏi doanh thu POS của báo cáo. */
  function targetHtml(t, title) {
    if (!t) return '';
    if (!t.configured) return `<h3>${esc(title)}</h3><p class="warn-text small">${esc(t.reason)} Không tự gán chỉ tiêu mặc định.</p>`;
    const next = t.tiers.find(x => x.strict ? t.revenue <= x.at : t.revenue < x.at);
    return `<h3>${esc(title)}</h3><dl class="kv store-kv">
      <dt>Doanh số xét chỉ tiêu (CRM + POS, trước VAT, đơn đã duyệt)</dt><dd class="num"><b>${vnd(t.revenue)}</b><small>CRM ${vnd(t.crm)} · POS ${vnd(t.pos)}</small></dd>
      <dt>Chỉ tiêu tháng ${esc(monthLabel(t.month))}</dt><dd class="num">${vnd(t.target)}</dd>
      <dt>Tỷ lệ đạt</dt><dd class="num"><b>${pct1(t.ratio)}</b></dd>
      <dt>Mức thưởng DS cửa hàng đang đạt</dt><dd class="num">${t.rate ? pct1(t.rate) : 'Chưa đạt mốc'}${next ? `<small>Mốc kế: ${next.strict ? 'trên' : 'từ'} ${vnd(next.at)} → ${pct1(next.rate)}</small>` : ''}</dd>
      <dt>Thưởng DS cửa hàng tạm tính (trước chia)</dt><dd class="num">${vnd(t.bonusEstimate)}<small>Tạm tính – số chốt theo phiếu lương</small></dd></dl>
      ${t.issues ? `<p class="warn-text small">Còn ${t.issues} đơn chưa đối chiếu – doanh số xét chỉ tiêu có thể thay đổi.</p>` : ''}`;
  }
  function weeklyHtml(f) {
    const r = f.restock;
    return `<dl class="kv store-kv"><dt>Doanh thu POS tuần (gồm VAT, đơn không huỷ)</dt><dd class="num"><b>${vnd(f.revenue)}</b> · ${f.bills} hoá đơn</dd>
        ${f.returns ? `<dt>Hàng trả hoàn tất trong tuần</dt><dd class="num">${vnd(f.returns)}</dd>` : ''}</dl>
      <p class="muted small">Doanh thu POS (gồm VAT) khác doanh số xét chỉ tiêu bên dưới (CRM + POS trước VAT) – không chia trực tiếp cho chỉ tiêu.</p>
      ${targetHtml(f.target, 'Tiến độ chỉ tiêu tháng (luỹ kế tới lúc tính)')}
      <h3>Hàng cần bổ sung (tồn sổ kho cửa hàng)</h3>
      ${!r.configured ? '<p class="warn-text small">Chưa cấu hình ngưỡng tồn tối thiểu cho kho cửa hàng – Manager đặt ở "Cấu hình cửa hàng". CRM không tự đặt số.</p>'
        : r.items.length ? factTable(['Mã', 'Sản phẩm', '>Tồn', '>Đã giữ', '>Đang về', '>Ngưỡng', '>Đề xuất'], r.items.map(i => `<tr><td>${esc(i.sku)}</td><td>${esc(i.name)}</td><td class="right num">${i.onHand}</td><td class="right num">${i.held}</td><td class="right num">${i.incoming}</td><td class="right num">${i.minQty}</td><td class="right num"><b>${i.suggest}</b></td></tr>`))
        : `<p class="muted small">Không có mã nào dưới ngưỡng (${r.rules} mã có ngưỡng).</p>`}
      <p class="small"><a href="#/purchases">Mở Đơn mua NCC</a> · <a href="#/transfers">Mở Điều chuyển kho</a> – đề xuất ở đây không tự tạo chứng từ.</p>
      <h3>Bán chạy</h3>${factTable(['Mã', 'Sản phẩm', '>SL', '>Tiền'], f.top.map(t => `<tr><td>${esc(t.sku)}</td><td>${esc(t.name)}</td><td class="right num">${t.qty}</td><td class="right num">${vnd(t.amount)}</td></tr>`))}
      <h3>Tồn mà 30 ngày không bán được</h3>${factTable(['Mã', 'Sản phẩm', '>Tồn'], f.slow.map(t => `<tr><td>${esc(t.sku)}</td><td>${esc(t.name)}</td><td class="right num">${t.qty}</td></tr>`))}`;
  }
  function monthlyHtml(f) {
    const p = f.previous, cmp = c => c.missing ? '<span class="warn-text">Thiếu dữ liệu</span>' : `${c.diff >= 0 ? '+' : ''}${vnd(c.diff)}${c.pct !== null ? ` (${c.pct >= 0 ? '+' : ''}${String(c.pct).replace('.', ',')}%)` : ''}`;
    const g = f.cashGaps;
    return `<dl class="kv store-kv"><dt>Doanh thu POS tháng (gồm VAT, đơn không huỷ)</dt><dd class="num"><b>${vnd(f.revenue)}</b> · ${f.bills} hoá đơn</dd>
        ${f.returns ? `<dt>Hàng trả hoàn tất</dt><dd class="num">${vnd(f.returns)}</dd>` : ''}
        <dt>So tháng ${esc(monthLabel(p.month))} (doanh thu POS)</dt><dd class="num">${p.revenue === null ? '<span class="warn-text">Thiếu dữ liệu (tháng trước không mở ca)</span>' : `${vnd(p.revenue)} → ${cmp(p.posCompare)}`}</dd>
        <dt>So tháng trước (doanh số xét chỉ tiêu)</dt><dd class="num">${cmp(p.targetCompare)}</dd>
        <dt>Lệch quỹ khi kết ca</dt><dd class="num">${g.shortage ? `<span class="danger-text">Thiếu ${vnd(-g.shortage)} (${g.shortageShifts} ca)</span> ` : ''}${g.surplus ? `<span class="warn-text">Thừa ${vnd(g.surplus)} (${g.surplusShifts} ca)</span>` : ''}${!g.shortage && !g.surplus ? '0' : ''}</dd></dl>
      ${targetHtml(f.target, 'Kết quả chỉ tiêu và mốc thưởng (tạm tính)')}
      <h3>Doanh thu theo thương hiệu (theo danh mục)</h3>${factTable(['Nhóm', '>SL', '>Tiền'], f.brands.map(b => `<tr><td>${b.unclassified ? '<i>Chưa phân loại</i>' : esc(b.group)}</td><td class="right num">${b.qty}</td><td class="right num">${vnd(b.amount)}</td></tr>`))}
      <h3>Bán chạy</h3>${factTable(['Mã', 'Sản phẩm', '>SL', '>Tiền'], f.top.map(t => `<tr><td>${esc(t.sku)}</td><td>${esc(t.name)}</td><td class="right num">${t.qty}</td><td class="right num">${vnd(t.amount)}</td></tr>`))}
      <h3>Ngày có ca POS (bổ trợ) và công chấm HR</h3>${factTable(['Nhân viên', '>Ngày có ca', '>Số ca', '>Công HR'], f.staff.map(s => `<tr><td>${esc(s.member || '')}</td><td class="right num">${s.days}</td><td class="right num">${s.shifts}</td><td class="right num">${s.hrWorked === null ? '<span class="warn-text">Chưa chấm</span>' : String(s.hrWorked).replace('.', ',')}</td></tr>`))}
      <p class="muted small">Ngày công tính lương theo chấm công HR; ngày có ca POS chỉ để đối chiếu.</p>`;
  }
  const COUNT_STATUS = { pending: 'Chờ duyệt', approved: 'Đã duyệt', rejected: 'Từ chối' };
  function stocktakeHtml(f) {
    const sc = f.scope, side = (label, x) => `<dt>${label}</dt><dd class="num">${x.skus} mã · ${x.qty}${x.value !== null && x.value !== undefined ? ` · ${vnd(x.value)}` : ''}</dd>`;
    return `<h3>Phiếu kiểm kê của kho cửa hàng trong kỳ</h3>${factTable(['Phiếu', 'Ngày', 'Trạng thái', '>Mã đếm', '>Mã lệch'], (f.counts || []).map(c => `<tr><td>${esc(c.refNo)}</td><td>${esc(c.createdAt.slice(0, 10))}</td><td>${esc(COUNT_STATUS[c.status] || c.status)}${c.noGap ? '<small>Không chênh lệch</small>' : ''}</td><td class="right num">${c.countedSkus}</td><td class="right num">${c.gapSkus}</td></tr>`))}
      ${f.pending ? `<p class="muted small">${f.pending} phiếu đang chờ Manager duyệt – vẫn nộp báo cáo được.</p>` : ''}
      ${f.noGap ? '<p class="ok-text small"><b>Kiểm kê không có chênh lệch.</b></p>' : ''}
      <dl class="kv store-kv"><dt>Phạm vi đã kiểm</dt><dd class="num">${sc.countedSkus} / ${sc.stockedSkus} mã đang có tồn${sc.notCounted ? `<small class="warn-text">Chưa kiểm ${sc.notCounted} mã: ${esc(sc.notCountedSample.join(', '))}${sc.notCounted > sc.notCountedSample.length ? '…' : ''}</small>` : ''}</dd>
        ${side('Thừa', f.surplus)}${side('Thiếu', f.shortage)}
        ${f.damaged?.length ? `<dt>Hàng hỏng / bể (khách trả)</dt><dd class="num">${f.damaged.map(d => `${esc(d.sku)} × ${d.qty}`).join(', ')}</dd>` : ''}</dl>
      ${f.missingCost?.length ? `<p class="warn-text small">${f.missingCost.length} mã lệch chưa có giá nhập – không tính giá trị.</p>` : ''}
      <p class="muted small">${f.costHidden ? 'Giá trị lệch (giá vốn) chỉ Manager xem.' : esc(f.valuation || '')}</p>
      ${f.lines?.length ? factTable(['Mã', 'Sản phẩm', '>Lệch', 'Phiếu', '>Giá trị'], f.lines.map(l => `<tr><td>${esc(l.sku)}${l.mustExplain ? ' <span class="pill warn">Cần giải trình</span>' : ''}</td><td>${esc(l.name)}</td><td class="right num">${l.qty > 0 ? '+' : ''}${l.qty}</td><td>${esc(COUNT_STATUS[l.status] || '')}</td><td class="right num">${l.value === null ? '—' : vnd(l.value)}</td></tr>`)) : ''}
      ${f.threshold === null || f.threshold === undefined ? '<p class="muted small">Chưa cấu hình ngưỡng giải trình theo mã.</p>' : ''}`;
  }
  function inputsHtml(kind, v = {}, ro = false, facts = null) {
    const t = (name, lab, hint = '') => `<label class="span-2">${esc(lab)}<textarea name="${name}" rows="3" ${ro ? 'readonly' : ''} placeholder="${esc(hint)}">${esc(v[name] || '')}</textarea></label>`;
    if (kind === 'daily') return `<label>Tiền mặt đã nộp ngân hàng<input name="bankDeposit" inputmode="numeric" ${ro ? 'readonly' : ''} value="${v.bankDeposit ?? ''}" placeholder="0"></label>
      <label>Mã giao dịch / ghi chú nộp tiền<input name="bankRef" maxlength="200" ${ro ? 'readonly' : ''} value="${esc(v.bankRef || '')}"></label>${t('cashExplanation', 'Giải trình chênh lệch tiền nộp (bắt buộc khi có chênh lệch)', 'Ví dụ: ngân hàng đóng cửa, nộp sáng mai; đã nộp nhưng chưa lập phiếu Nộp két…')}${t('incidents', 'Sự cố phát sinh', 'Khách khiếu nại, bể vỡ, thiết bị hỏng… (ghi "Không có" nếu không có)')}${t('note', 'Ghi chú')}`;
    if (kind === 'weekly') return t('orderProposal', 'Đề xuất đặt hàng (Sale-in) *', 'Mã / tên hàng, số lượng đề xuất đặt về')
      + `<label class="span-2">Số đơn mua / phiếu điều chuyển liên quan (nếu đã có)<input name="orderRefs" maxlength="500" ${ro ? 'readonly' : ''} value="${esc(v.orderRefs || '')}" placeholder="VD: DM-0123, DC-0045"></label>`
      + t('slowAction', 'Đề xuất xử lý hàng chậm bán', 'Giảm giá, combo, điều chuyển, trả NCC…') + t('roster', 'Lịch ca trực tuần tới') + t('nextWeekPlan', 'Kế hoạch tuần tới (ngắn gọn)') + t('note', 'Ghi chú');
    if (kind === 'monthly') return t('groupAnalysis', 'Nhận xét nhóm hàng') + t('staffReview', 'Đánh giá ngày công và năng lực NVBH *') + t('nextMonthPlan', 'Kế hoạch tháng sau') + t('note', 'Ghi chú');
    const must = (facts?.lines || []).filter(l => l.mustExplain), ex = v.skuExplanations || {};
    return `<label class="check span-2"><input type="checkbox" name="counted" ${v.counted ? 'checked' : ''} ${ro ? 'disabled' : ''}> Đã kiểm kê theo đúng quy trình, biên bản khớp thực tế và phần mềm *</label>
      ${must.map(l => `<label class="span-2">Giải trình mã ${esc(l.sku)} ${esc(l.name || '')} (lệch ${l.qty > 0 ? '+' : ''}${l.qty}) *<input name="sku:${esc(l.sku)}" data-sku="${esc(l.sku)}" maxlength="1000" ${ro ? 'readonly' : ''} value="${esc(ex[l.sku] || '')}"></label>`).join('')}
      ${t('scopeNote', 'Phạm vi chưa kiểm và lý do')}${t('damagedNote', 'Hàng hỏng / bể vỡ / chờ xử lý')}${t('gapExplanation', 'Giải trình chung các chênh lệch')}${t('note', 'Ghi chú')}`;
  }
  const when = reportTimestampText;
  const INPUT_KEYS = ['bankDeposit', 'bankRef', 'cashExplanation', 'incidents', 'officeSupport', 'tomorrowPlan', 'note', 'orderProposal', 'orderRefs', 'slowAction', 'roster', 'nextWeekPlan', 'groupAnalysis', 'staffReview', 'nextMonthPlan', 'scopeNote', 'damagedNote', 'gapExplanation'];
  // ---------------- Báo cáo ngày: 5 phần, chuyển nhanh, đếm ngược hạn, checklist, sự cố theo loại
  const SECTIONS = [['s1', 'Doanh số'], ['s2', 'Tiền & quỹ'], ['s3', 'Vận hành'], ['s4', 'Hàng hoá'], ['s5', 'Sự cố & kế hoạch']];
  const num = v => v === null || v === undefined ? '—' : Number(v).toLocaleString('vi-VN');
  function dailyLayout(d, v, ro, f, factsNote) {
    const t = f.target, c = f.cash || {}, ck = v.checklist || {}, inc = v.incidentTypes || [];
    const card = (id, title, body, badge = '') => `<section class="store-sec" id="${id}" data-sec="${id}"><div class="store-sec-h"><h3>${esc(title)}</h3>${badge}</div>${body}</section>`;
    const src = (auto, txt) => `<span class="store-src ${auto ? 'auto' : 'input'}">${esc(txt)}</span>`;
    const ta = (name, lab, hint = '', req = '') => `<label class="span-2">${esc(lab)}${req}<textarea name="${name}" rows="2" ${ro ? 'readonly' : ''} placeholder="${esc(hint)}">${esc(v[name] || '')}</textarea></label>`;
    const vs = f.vsAvg7 || {};
    const s1 = `${src(true, 'CRM tự điền · ' + factsNote)}
      <div class="store-big num">${vnd(f.totals.revenue)}</div>
      <p class="muted small">Doanh thu POS (gồm VAT, đơn không huỷ)${vs.avg !== null && vs.avg !== undefined ? ` · ${vs.pct === null ? 'TB ' + vs.days + ' ngày trước: ' + vnd(vs.avg) : `${vs.pct >= 0 ? '+' : ''}${String(vs.pct).replace('.', ',')}% so TB ${vs.days} ngày có ca`}` : ' · chưa có ngày trước để so'}</p>
      <div class="store-kpis"><div><small>Hoá đơn</small><b class="num">${num(f.totals.bills)}</b></div><div><small>TB / hoá đơn</small><b class="num">${vnd(f.aov)}</b></div><div><small>Khách mới</small><b class="num">${num(f.newCustomers)}</b></div></div>
      <p class="small num">Tiền mặt ${vnd(f.totals.cash)} · CK ${vnd(f.totals.transfer)} · Khác ${vnd(f.totals.other)}${f.totals.returnsValue ? ` · Hàng trả ${vnd(f.totals.returnsValue)}` : ''}</p>
      ${t?.configured ? `<div class="store-target"><div class="row"><b>Tiến độ chỉ tiêu tháng</b><b class="num">${pct1(t.ratio)}</b></div><div class="store-bar"><i style="width:${Math.min(100, t.ratio * 100)}%"></i></div>
        <p class="muted small num">Doanh số xét chỉ tiêu (CRM + POS, trước VAT) ${vnd(t.revenue)} / ${vnd(t.target)} · đã qua ${String(t.pace.elapsed).replace('.', ',')}% tháng${t.pace.needPerDay !== null ? ` · cần <b>${vnd(t.pace.needPerDay)}</b>/ngày còn lại` : ''}</p></div>`
        : `<p class="warn-text small">Chỉ tiêu tháng: ${esc(t?.reason || 'chưa cấu hình')}</p>`}
      ${f.top?.length ? `<h4>Bán chạy hôm nay</h4>${factTable(['Mã', 'Sản phẩm', '>SL'], f.top.map(x => `<tr><td>${esc(x.sku)}</td><td>${esc(x.name)}</td><td class="right num">${x.qty}</td></tr>`))}` : ''}`;
    const s2 = `${dailyHtml(f).split('<h3>Các ca</h3>')[0].replace(/^[\s\S]*?(<h3>Tiền phải nộp)/, '$1').replace('<h3>Tiền phải nộp (theo Sổ quỹ)</h3>', src(true, 'Tiền phải nộp – theo Sổ quỹ'))}
      ${src(false, 'CHT nhập')}
      <div class="form-grid cols-2"><label>Tiền mặt đã nộp ngân hàng<input name="bankDeposit" inputmode="numeric" ${ro ? 'readonly' : ''} value="${v.bankDeposit ?? ''}" placeholder="0"></label>
      <label>Mã giao dịch / ghi chú nộp tiền<input name="bankRef" maxlength="200" ${ro ? 'readonly' : ''} value="${esc(v.bankRef || '')}"></label>
      ${ta('cashExplanation', 'Giải trình chênh lệch tiền nộp', 'VD: giữ lại đổi tiền lẻ, nộp sáng mai; đã nộp nhưng chưa lập phiếu Nộp két…', c.needsExplanation ? ' <b class="danger-text">*</b>' : '')}</div>
      <section class="store-files" data-files><h4>Chứng từ nộp tiền / tệp đính kèm</h4><p class="muted small">Đang tải…</p></section>`;
    const s3 = `${src(false, 'Checklist cuối ngày – trả lời từng mục (bắt buộc, không trừ tiền)')}
      <div class="store-checks">${(d.checklistItems || []).map(i => `<div class="store-check" data-ck="${esc(i.key)}"><span>${esc(i.label)}${i.hint ? `<small>${esc(i.hint)}</small>` : ''}</span><span class="store-seg">${[['yes', 'Đã làm'], ['no', 'Chưa']].map(([k, l]) => `<button type="button" data-v="${k}" aria-pressed="${ck[i.key] === k}" ${ro ? 'disabled' : ''}>${l}</button>`).join('')}</span></div>`).join('')}</div>
      <h4>Các ca hôm nay</h4>${dailyHtml(f).split('<h3>Các ca</h3>')[1]?.split('<h3>Trả / đổi')[0] || ''}`;
    const low = f.lowStock || {};
    const s4 = `${src(true, 'CRM tự điền')}
      <h4>Hàng dưới ngưỡng tối thiểu</h4>${!low.configured ? '<p class="muted small">Chưa cấu hình ngưỡng tồn cho kho cửa hàng.</p>' : low.items.length ? factTable(['Mã', 'Sản phẩm', '>Tồn', '>Đang về', '>Ngưỡng'], low.items.map(i => `<tr><td>${esc(i.sku)}</td><td>${esc(i.name)}</td><td class="right num">${i.onHand}</td><td class="right num">${i.incoming}</td><td class="right num">${i.minQty}</td></tr>`)) : '<p class="muted small">Không có mã dưới ngưỡng.</p>'}
      <h4>Hàng nhận trong ngày (điều chuyển)</h4>${f.received?.length ? `<ul class="store-plain">${f.received.map(r => `<li>${esc(r.transferNo)} · ${r.lines} mã · đã nhận</li>`).join('')}</ul>` : '<p class="muted small">Không có.</p>'}
      ${(f.returns?.length || f.refunds?.length) ? '<h4>Trả / đổi hàng và hoàn tiền</h4>' + (dailyHtml(f).split('<h3>Trả / đổi hàng và hoàn tiền</h3>')[1] || '') : ''}`;
    const s5 = `${src(false, 'CHT nhập')}
      <div class="store-pills">${Object.entries(d.incidentTypes || {}).map(([k, l]) => `<button type="button" data-inc="${k}" aria-pressed="${inc.includes(k)}" ${ro ? 'disabled' : ''}>${esc(l)}</button>`).join('')}</div>
      <div class="form-grid cols-2">${ta('incidents', 'Mô tả sự cố và cách xử lý', 'Chuyện gì, lúc nào, đã xử lý ra sao, cần văn phòng làm gì')}
      ${ta('officeSupport', 'Cần văn phòng hỗ trợ', 'VD: gửi thêm 2 thùng hộp quà trước thứ Sáu')}${ta('tomorrowPlan', 'Kế hoạch ngày mai', '1–3 việc chính')}${ta('note', 'Ghi chú')}</div>`;
    return `<div class="store-deadline"><span>Hạn nộp <b>${esc(when(d.deadline))}</b> · <span data-countdown></span></span>${f.openShifts ? pill('warn', `${f.openShifts} ca đang mở – tạm tính`) : ''}</div>
      <nav class="store-steps" aria-label="Các phần báo cáo">${SECTIONS.map(([id, l], i) => `<a href="#${id}" data-step="${id}"><span class="dot">${i + 1}</span>${esc(l)}</a>`).join('')}</nav>
      ${card('s1', 'Doanh số hôm nay', s1)}${card('s2', 'Tiền & quỹ', s2, c.needsExplanation ? pill('danger', 'Cần giải trình') : '')}${card('s3', 'Vận hành cửa hàng', s3, '<span class="pill info" data-ckcount></span>')}${card('s4', 'Hàng hoá', s4)}${card('s5', 'Sự cố & kế hoạch', s5)}`;
  }
  /** Gắn thao tác cho báo cáo ngày + tính các mục bắt buộc còn thiếu (máy chủ kiểm lại khi nộp). */
  function wireDaily(dlg, d, editable) {
    const f = dlg.querySelector('form'), hint = dlg.querySelector('[data-hint]'), cd = dlg.querySelector('[data-countdown]');
    const tick = () => { if (cd) cd.textContent = reportDeadlineText(d); };
    tick();
    if (!d.report) { const timer = setInterval(tick, 30_000); dlg.addEventListener('close', () => clearInterval(timer), {once:true}); }
    dlg.querySelectorAll('[data-step]').forEach(a => a.onclick = e => { e.preventDefault(); dlg.querySelector('#' + a.dataset.step)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
    const update = () => {
      const groups = [...dlg.querySelectorAll('[data-ck]')], answered = groups.filter(g => g.querySelector('[aria-pressed="true"]')).length;
      const cnt = dlg.querySelector('[data-ckcount]'); if (cnt) cnt.textContent = `${answered}/${groups.length}`;
      const types = [...dlg.querySelectorAll('[data-inc][aria-pressed="true"]')].map(b => b.dataset.inc);
      const needCash = !!d.facts?.cash?.needsExplanation && (f.elements.cashExplanation?.value || '').trim().length < 3;
      const needInc = !types.length || (!types.includes('none') && (f.elements.incidents?.value || '').trim().length < 3);
      const missing = [needCash && 'giải trình chênh lệch tiền', answered < groups.length && `checklist (${groups.length - answered} mục)`, needInc && (types.length ? 'mô tả sự cố' : 'chọn sự cố')].filter(Boolean);
      const state = { s2: !needCash, s3: answered === groups.length, s5: !needInc };
      dlg.querySelectorAll('[data-step]').forEach(a => { const ok = state[a.dataset.step]; a.classList.toggle('done', ok === true); a.classList.toggle('need', ok === false); });
      if (hint) hint.innerHTML = missing.length ? `Còn thiếu: <b>${esc(missing.join(', '))}</b>` : 'Đủ mục bắt buộc – có thể nộp chính thức.';
    };
    if (editable) {
      dlg.querySelectorAll('[data-ck]').forEach(g => g.querySelectorAll('button').forEach(b => b.onclick = () => { g.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', String(x === b))); update(); }));
      const pills = [...dlg.querySelectorAll('[data-inc]')];
      pills.forEach(p => p.onclick = () => {
        const on = p.getAttribute('aria-pressed') !== 'true';
        if (p.dataset.inc === 'none') pills.forEach(x => x.setAttribute('aria-pressed', String(x === p && on)));
        else { p.setAttribute('aria-pressed', String(on)); pills.find(x => x.dataset.inc === 'none')?.setAttribute('aria-pressed', 'false'); }
        update();
      });
      f.addEventListener('input', update);
    }
    update();
  }

  async function openReport(registerId, kind, period) {
    let d; try { d = await api(`/store/reports/draft?registerId=${encodeURIComponent(registerId)}&kind=${kind}&period=${period}`); } catch (e) { toast(e.message, 'err'); return; }
    const rep = d.report, editable = d.canEdit, canReview = status?.canReview && rep;
    const st = rep ? rep.state.state : null, clientKey = crypto.randomUUID();
    const values = d.draft?.inputs || rep?.data?.inputs || {};
    const shownFacts = editable || !rep ? d.facts : rep.data.facts, factsAt = editable || !rep ? d.factsAt : rep.data.meta?.factsAt || rep.submittedAt;
    const dlg = document.createElement('dialog'); dlg.className = 'modal store-dialog';
    dlg.innerHTML = `<form novalidate><div class="modal-head"><h2>${esc(label(kind))} · ${esc(periodLabel(kind, period))}</h2><button type="button" class="icon-btn" data-x aria-label="Đóng">×</button></div>
      <div class="modal-body">
        <p class="small">Hạn nộp: <b>${esc(when(d.deadline))}</b>
          ${rep ? ` · Nộp chính thức lần đầu ${esc(when(rep.submittedAt))} ${pill(STATE[st][1], STATE[st][0])} ${pill(REVIEW_TONE[rep.review], status.labels.reviews[rep.review])}${rep.data?.meta?.provisional ? ' ' + pill('warn', 'Tạm tính – còn ca chưa đóng') : ''}` : ' · ' + pill('muted', 'Chưa nộp chính thức')}
          ${d.draft ? ` · Nháp lưu ${esc(when(d.draft.updatedAt))}` : ''}</p>
        ${d.blockers?.length ? `<p class="warn-text small">${d.blockers.map(esc).join(' ')}</p>` : ''}
        ${rep?.reviewNote ? `<p class="small">Ghi chú duyệt: ${esc(rep.reviewNote)}</p>` : ''}
        ${kind === 'daily' ? dailyLayout(d, values, !editable, shownFacts, editable || !rep ? `tính lúc ${when(factsAt)} (nộp sẽ tính lại)` : `lúc nộp ${when(factsAt)}`) : `
        <section class="store-facts-box"><h3>Số liệu CRM ${editable || !rep ? `tính lúc ${esc(when(factsAt))} (nộp sẽ tính lại)` : `lúc nộp ${esc(when(factsAt))}`}</h3>${factsHtml(kind, shownFacts)}</section>
        <div class="form-grid cols-2">${inputsHtml(kind, values, !editable, shownFacts)}</div>
        <section class="store-files" data-files><h3>Tệp đính kèm</h3><p class="muted small">Đang tải…</p></section>`}
        ${d.versions?.length > 1 ? `<details class="store-versions"><summary>Lịch sử nộp (${d.versions.length} lần)</summary><ol>${d.versions.map(v => `<li>Lần ${v.version} · ${esc(when(v.submittedAt))} · ${esc(v.member || '')}${v.provisional ? ' · tạm tính' : ''}</li>`).join('')}</ol></details>` : ''}
        ${rep && (data?.isManager) ? `<label class="span-2">Giải trình của CHT<textarea name="explanation" rows="2">${esc(rep.explanation || '')}</textarea></label><button type="button" class="btn secondary small" data-explain>Gửi giải trình</button>` : rep?.explanation ? `<p class="small"><b>Giải trình:</b> ${esc(rep.explanation)}</p>` : ''}
        ${canReview ? `<div class="store-review"><h3>Duyệt</h3><div class="chips">${status.reviewFor[kind].map(k => `<label class="chip"><input type="radio" name="review" value="${k}" ${rep.review === k ? 'checked' : ''}> ${esc(status.labels.reviews[k])}</label>`).join('')}</div>
          <label>Lý do / ghi chú (bắt buộc khi không đạt hoặc miễn)<input name="reviewNote" maxlength="1000" value="${esc(rep.reviewNote || '')}"></label><button type="button" class="btn primary small" data-review>Lưu kết quả duyệt</button></div>` : ''}
        <p class="error" data-err role="alert"></p></div>
      <div class="modal-foot">${kind === 'daily' && editable ? '<p class="store-hint small" data-hint></p>' : ''}<button type="button" class="btn secondary" data-x>Đóng</button>${editable ? `<button type="button" class="btn secondary" data-draft>Lưu nháp</button>` : ''}${d.canSubmit ? `<button class="btn primary">${rep ? 'Nộp lại chính thức' : 'Nộp chính thức'}</button>` : ''}</div></form>`;
    document.body.append(dlg); dlg.showModal(); labelCells(dlg);
    const f = dlg.querySelector('form'), err = dlg.querySelector('[data-err]');
    dlg.addEventListener('close', () => dlg.remove());
    dlg.querySelectorAll('[data-x]').forEach(b => b.onclick = () => dlg.close());
    const after = async msg => { toast(msg); dlg.close(); status = null; await loadStatus().catch(() => {}); if (location.hash.startsWith('#/store-reports')) show(`registerId=${encodeURIComponent(registerId)}&month=${current.month}`); };
    loadFiles(dlg.querySelector('[data-files]'), registerId, kind, period, editable);
    if (kind === 'daily') wireDaily(dlg, d, editable);
    const collect = () => { const el = f.elements, inputs = {}; for (const k of INPUT_KEYS) if (el[k]) inputs[k] = el[k].value; if (el.counted) inputs.counted = el.counted.checked;
      if (kind === 'daily') {
        inputs.checklist = Object.fromEntries([...f.querySelectorAll('[data-ck]')].map(g => [g.dataset.ck, g.querySelector('[aria-pressed="true"]')?.dataset.v]).filter(([, v]) => v));
        inputs.incidentTypes = [...f.querySelectorAll('[data-inc][aria-pressed="true"]')].map(b => b.dataset.inc);
      }
      const sku = [...f.querySelectorAll('[data-sku]')]; if (sku.length) inputs.skuExplanations = Object.fromEntries(sku.map(i => [i.dataset.sku, i.value]));
      return inputs; };
    dlg.querySelector('[data-draft]')?.addEventListener('click', async ev => {
      const btn = ev.currentTarget; btn.disabled = true; err.textContent = '';
      try { await api('/store/reports/draft', 'PUT', { registerId, kind, period, inputs: collect() }); await after('Đã lưu nháp – chưa nộp chính thức.'); }
      catch (ex) { err.textContent = ex.message; } finally { btn.disabled = false; }
    });
    f.addEventListener('submit', async e => {
      e.preventDefault(); if (!d.canSubmit) return;
      const btn = f.querySelector('button.primary'); btn.disabled = true; err.textContent = '';
      try { const res = await api('/store/reports', 'POST', { registerId, kind, period, clientKey, inputs: collect() });
        await after(res.provisional ? 'Đã nộp chính thức (tạm tính – còn ca chưa đóng). Đóng ca rồi nộp lại để hoàn tất.' : res.state?.state === 'late' ? 'Đã nộp chính thức (trễ hạn).' : 'Đã nộp chính thức.'); }
      catch (ex) { err.textContent = ex.message; } finally { btn.disabled = false; }
    });
    dlg.querySelector('[data-explain]')?.addEventListener('click', async () => {
      try { await api(`/store/reports/${rep.id}/explain`, 'POST', { explanation: f.elements.explanation.value }); await after('Đã gửi giải trình.'); } catch (ex) { err.textContent = ex.message; }
    });
    dlg.querySelector('[data-review]')?.addEventListener('click', async () => {
      const review = f.querySelector('input[name="review"]:checked')?.value; if (!review) { err.textContent = 'Chọn kết quả duyệt.'; return; }
      try { await api(`/store/reports/${rep.id}/review`, 'POST', { review, note: f.elements.reviewNote.value }); await after('Đã lưu kết quả duyệt.'); } catch (ex) { err.textContent = ex.message; }
    });
  }

  // ---------------- Tệp đính kèm (chứng từ nộp tiền, biên bản kiểm kê) – máy chủ kiểm tra loại / nội dung / dung lượng
  const FILE_MAX = 6 * 1024 * 1024, ACCEPT = 'image/jpeg,image/png,image/webp,application/pdf';
  const size = n => n >= 1048576 ? (n / 1048576).toFixed(1).replace('.', ',') + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';
  const readDataUrl = file => new Promise((ok, fail) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = () => fail(new Error('Không đọc được tệp.')); r.readAsDataURL(file); });
  async function loadFiles(box, registerId, kind, period, editable) {
    if (!box) return;
    let x; try { x = await api(`/store/reports/files?registerId=${encodeURIComponent(registerId)}&kind=${kind}&period=${period}`); }
    catch (e) { box.innerHTML = `<h3>Tệp đính kèm</h3><p class="error small">${esc(e.message)}</p>`; return; }
    const label = Object.fromEntries(x.purposes.map(p => [p.key, p.label]));
    box.innerHTML = `<h3>Tệp đính kèm</h3>
      ${x.files.length ? `<ul class="store-file-list">${x.files.map(f => `<li><a href="${esc(f.url || '#')}" target="_blank" rel="noopener noreferrer">${esc(f.name)}</a><small>${esc(label[f.purpose] || f.purpose)} · ${size(f.bytes)} · ${esc(f.by || '')}</small>${editable ? `<button type="button" class="btn ghost small" data-del="${esc(f.id)}">Gỡ</button>` : ''}</li>`).join('')}</ul>` : '<p class="muted small">Chưa có tệp.</p>'}
      ${editable ? `<div class="store-file-add"><select data-purpose aria-label="Loại tệp">${x.purposes.map(p => `<option value="${p.key}">${esc(p.label)}</option>`).join('')}</select>
        <label class="btn secondary">Chọn ảnh / PDF<input type="file" accept="${ACCEPT}" data-file hidden></label></div>
        <p class="muted small">Ảnh JPEG / PNG / WebP hoặc PDF, tối đa 6 MB / tệp, 6 tệp / báo cáo. Trên điện thoại có thể chụp ảnh trực tiếp.</p>` : ''}
      <p class="error small" data-ferr role="alert"></p>`;
    const err = box.querySelector('[data-ferr]');
    box.querySelector('[data-file]')?.addEventListener('change', async e => {
      const file = e.target.files?.[0]; e.target.value = ''; if (!file) return;
      if (file.size > FILE_MAX) { err.textContent = 'Tệp quá lớn (tối đa 6 MB).'; return; }
      err.textContent = 'Đang tải lên…';
      try { await api('/store/reports/files', 'POST', { registerId, kind, period, purpose: box.querySelector('[data-purpose]').value, name: file.name, data: await readDataUrl(file) });
        toast('Đã đính kèm tệp.'); loadFiles(box, registerId, kind, period, editable); }
      catch (ex) { err.textContent = ex.message; }
    });
    box.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
      if (!(await confirmBox('Gỡ tệp này khỏi báo cáo?'))) return;
      try { await api('/store/reports/files/' + encodeURIComponent(b.dataset.del), 'DELETE'); loadFiles(box, registerId, kind, period, editable); }
      catch (ex) { err.textContent = ex.message; }
    });
  }

  // ---------------- Manager cấu hình báo cáo cửa hàng
  async function settings(registerId) {
    let d, rules = []; try { d = await api(`/store/settings?registerId=${encodeURIComponent(registerId)}`); rules = (await api(`/store/restock-rules?registerId=${encodeURIComponent(registerId)}`)).rules; } catch (e) { toast(e.message, 'err'); return; }
    const s = d.settings, dlg = document.createElement('dialog'); dlg.className = 'modal';
    dlg.innerHTML = `<form novalidate><div class="modal-head"><h2>Cấu hình báo cáo · ${esc(data.store.name)}</h2><button type="button" class="icon-btn" data-x aria-label="Đóng">×</button></div>
      <div class="modal-body form-grid">
        <label>Quỹ tiền mặt được giữ lại tại cửa hàng<input name="cashFloat" inputmode="numeric" value="${s.cashFloat ?? ''}" placeholder="Chưa cấu hình"></label>
        <label>Lịch nộp tiền<select name="depositSchedule"><option value="">– Chưa cấu hình –</option>${Object.entries(d.scheduleLabels).map(([k, v]) => `<option value="${k}" ${s.depositSchedule === k ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></label>
        <label>Ngưỡng giải trình theo mã khi kiểm tồn (đồng)<input name="stocktakeExplainThreshold" inputmode="numeric" value="${s.stocktakeExplainThreshold ?? ''}" placeholder="Chưa cấu hình"></label>
        <label class="span-2">Ngưỡng tồn tối thiểu (hàng cần bổ sung) – mỗi dòng: mã, số lượng<textarea name="rules" rows="6" placeholder="00123, 20&#10;00456, 10">${esc(rules.map(r => `${r.sku}, ${r.minQty}`).join('\n'))}</textarea></label>
        <p class="muted small span-2">Để trống = chưa cấu hình: báo cáo hiện "thiếu căn cứ", không tự coi là 0. Áp dụng cho báo cáo tính sau khi lưu; báo cáo đã nộp giữ bản chụp lúc nộp.</p>
        <p class="error span-2" data-err role="alert"></p></div>
      <div class="modal-foot"><button type="button" class="btn secondary" data-x>Huỷ</button><button class="btn primary">Lưu</button></div></form>`;
    document.body.append(dlg); dlg.showModal();
    dlg.addEventListener('close', () => dlg.remove()); dlg.querySelectorAll('[data-x]').forEach(b => b.onclick = () => dlg.close());
    dlg.querySelector('form').addEventListener('submit', async e => {
      e.preventDefault(); const el = e.target.elements;
      const parsed = el.rules.value.split(/\n/).map(x => x.trim()).filter(Boolean).map(x => { const [sku, min] = x.split(/[,;\t]/).map(y => y.trim()); return { sku, minQty: Number(String(min || '').replace(',', '.')) }; });
      try { await api('/store/settings', 'PUT', { registerId, cashFloat: el.cashFloat.value, depositSchedule: el.depositSchedule.value || null, stocktakeExplainThreshold: el.stocktakeExplainThreshold.value });
        await api('/store/restock-rules', 'PUT', { registerId, rules: parsed });
        toast('Đã lưu cấu hình cửa hàng.'); dlg.close(); }
      catch (ex) { dlg.querySelector('[data-err]').textContent = ex.message; }
    });
  }

  // ---------------- Manager gán CHT
  async function assign() {
    let members = []; try { members = (await api('/admin/members')).members || []; } catch { /* danh sách nhân viên chỉ Manager */ }
    const dlg = document.createElement('dialog'); dlg.className = 'modal';
    const staff = members.filter(m => m.active !== false && ['employee', 'manager'].includes(m.role));
    dlg.innerHTML = `<form novalidate><div class="modal-head"><h2>Gán Cửa hàng trưởng</h2><button type="button" class="icon-btn" data-x aria-label="Đóng">×</button></div>
      <div class="modal-body form-grid">${status.stores.map(s => `<label>${esc(s.name)}<select data-register="${esc(s.registerId)}"><option value="">– Chưa có CHT –</option>${staff.map(m => `<option value="${esc(m.id)}" ${m.id === s.memberId ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}</select></label>`).join('')}
      <p class="muted small">Mỗi cửa hàng một CHT; mỗi người phụ trách tối đa một cửa hàng.</p><p class="error" data-err role="alert"></p></div>
      <div class="modal-foot"><button type="button" class="btn secondary" data-x>Huỷ</button><button class="btn primary">Lưu</button></div></form>`;
    document.body.append(dlg); dlg.showModal();
    dlg.addEventListener('close', () => dlg.remove()); dlg.querySelectorAll('[data-x]').forEach(b => b.onclick = () => dlg.close());
    dlg.querySelector('form').addEventListener('submit', async e => {
      e.preventDefault();
      try { for (const sel of dlg.querySelectorAll('select[data-register]')) { const s = status.stores.find(x => x.registerId === sel.dataset.register);
          if ((s.memberId || '') !== sel.value) await api('/store/managers', 'PUT', { registerId: sel.dataset.register, memberId: sel.value || null }); }
        toast('Đã lưu Cửa hàng trưởng.'); dlg.close(); status = null; await loadStatus(); show(`registerId=${encodeURIComponent(current.registerId)}&month=${current.month}`); }
      catch (ex) { dlg.querySelector('[data-err]').textContent = ex.message; }
    });
  }

  return { start, stop, show, remind, openReport };
}
