/**
 * BÁO CÁO CỬA HÀNG TRƯỞNG (CHT) – trang #/store-reports[?registerId=&month=] + hộp nhắc việc 30 phút / lần.
 *  - CHT: nộp báo cáo ngày / tuần / tháng / kiểm tồn kho (CRM tự điền số liệu ca POS, doanh số, hàng bán chạy / chậm, phiếu kiểm kê), giải trình.
 *  - Người duyệt (Manager / quyền "Duyệt báo cáo Cửa hàng trưởng"): xem mọi cửa hàng, duyệt, gán CHT (Manager).
 *  - Tiền Trách nhiệm tạm tính theo 4 ngạch (domain: src/modules/store/domain/reports.ts). Mọi quyền kiểm tra lại ở máy chủ.
 */
const STATE = { on_time: ['Đúng hạn', 'ok'], late: ['Nộp trễ', 'warn'], missing: ['Chưa nộp – quá hạn', 'danger'], not_due: ['Chưa tới hạn', 'muted'] };
const REVIEW_TONE = { pending: 'muted', ok: 'ok', cash_error: 'danger', order_error: 'danger', gap_unreported: 'danger', excused: 'info' };
export const REMIND_EVERY = 30 * 60_000;
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
        <ul class="store-remind-list">${r.items.map((x, i) => `<li class="${x.overdue ? 'overdue' : ''}"><span><b>${esc(x.label)}</b><small>Hạn: ${esc(new Date(x.due).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' }))}${x.overdue ? ' · <b class="danger-text">Quá hạn</b>' : ''}</small></span>
          <button type="button" class="btn primary small" data-do="${i}">Làm ngay</button></li>`).join('')}</ul></div>
      <div class="modal-foot"><button type="button" class="btn secondary" data-x>Nhắc lại sau 30 phút</button></div>`;
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
    if (!status.mine && !status.canReview) { root.innerHTML = '<div class="empty"><h3>Báo cáo Cửa hàng trưởng</h3><p class="muted">Bạn chưa được gán làm Cửa hàng trưởng. Liên hệ Manager.</p></div>'; return; }
    if (!current.registerId) { root.innerHTML = '<div class="empty"><p class="muted">Chưa có cửa hàng (quầy POS) nào.</p></div>'; return; }
    root.innerHTML = '<p class="muted">Đang tải báo cáo…</p>';
    try { data = await api(`/store/reports?registerId=${encodeURIComponent(current.registerId)}&month=${current.month}`); } catch (e) { root.innerHTML = `<div class="empty"><p>${esc(e.message)}</p></div>`; return; }
    render();
  }
  const byKey = () => new Map(data.reports.map(r => [r.kind + ':' + r.period, r]));
  function row(kind, period, r) {
    const st = r ? r.state.state : (new Date().toISOString() > dueOf(kind, period) ? 'missing' : 'not_due');
    const review = r?.review || 'pending';
    const act = data.isManager && (!r || review === 'pending') ? `<button type="button" class="btn ${r ? 'secondary' : 'primary'} small" data-open="${kind}|${period}">${r ? 'Sửa' : 'Nộp'}</button>`
      : `<button type="button" class="btn ghost small" data-open="${kind}|${period}">${data.canReview && r && review === 'pending' ? 'Duyệt' : 'Xem'}</button>`;
    return `<tr><td>${esc(periodLabel(kind, period))}</td><td>${pill(STATE[st][1], STATE[st][0])}${r ? `<small class="muted"> ${esc(new Date(r.submittedAt).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' }))}</small>` : ''}</td>
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
          ${status.canAssign ? '<button type="button" class="btn secondary" data-assign>Gán CHT</button>' : ''}
        </div></div>
      ${data.isManager ? `<div class="store-quick">
        <button type="button" class="btn primary" data-open="daily|${today}">Báo cáo ngày hôm nay</button>
        <button type="button" class="btn secondary" data-open="weekly|${addDays(monday, -7)}">Báo cáo tuần trước</button>
        <button type="button" class="btn secondary" data-open="monthly|${current.month}">Báo cáo tháng</button>
        <button type="button" class="btn secondary" data-open="stocktake|${current.month}">Kiểm tồn kho</button></div>` : ''}
      <div class="card store-resp"><div class="card-title-row"><h2 class="card-title">Tiền Trách nhiệm tháng ${esc(monthLabel(data.month))} (tạm tính)</h2><strong class="store-total">${vnd(r.total)}</strong></div>
        <div class="store-slots">${r.parts.map(p => `<div class="store-slot ${p.amount === 250000 ? 'full' : p.amount ? 'part' : 'zero'}"><small>${SLOT[p.slot]}</small><b>${vnd(p.amount)}</b>
          <span class="muted small">${p.slot === 'daily' || p.slot === 'weekly' ? `${p.fails} lần chưa đạt` : p.amount === 250000 ? 'Đạt' : 'Chưa đạt'}</span></div>`).join('')}</div>
        <p class="muted small">Ngày cần báo cáo = ngày cửa hàng mở ca POS. Sai số liệu sổ quỹ tính 2 lần. Có lý do khách quan được duyệt "Miễn" thì không tính.</p></div>
      <div class="card"><h2 class="card-title">Báo cáo ngày (hạn 22h00)</h2>${table(data.dailyDays.slice().reverse().map(d => row('daily', d, keys.get('daily:' + d))), 'Tháng này cửa hàng chưa mở ca nào.')}</div>
      <div class="card"><h2 class="card-title">Báo cáo tuần (hạn 10h00 thứ Hai tuần sau)</h2>${table(data.weeks.slice().reverse().map(w => row('weekly', w, keys.get('weekly:' + w))), 'Chưa có tuần cần báo cáo trong tháng.')}</div>
      <div class="card"><h2 class="card-title">Báo cáo tháng & kiểm tồn kho (hạn trước ngày 02 tháng sau)</h2>${table(['monthly', 'stocktake'].map(k => row(k, data.month, keys.get(k + ':' + data.month)).replace(/<td>Tháng [^<]*<\/td>/, `<td>${esc(label(k))}</td>`)), '')}</div>`;
    labelCells(root);
    root.querySelector('#store-pick')?.addEventListener('change', e => go(`#/store-reports?registerId=${encodeURIComponent(e.target.value)}&month=${current.month}`));
    root.querySelector('#store-month')?.addEventListener('change', e => { if (e.target.value) go(`#/store-reports?registerId=${encodeURIComponent(current.registerId)}&month=${e.target.value}`); });
    root.querySelector('[data-assign]')?.addEventListener('click', assign);
    root.querySelectorAll('[data-open]').forEach(b => b.onclick = () => { const [kind, period] = b.dataset.open.split('|'); openReport(current.registerId, kind, period); });
  }

  // ---------------- Hộp nộp / xem / duyệt báo cáo
  /** Điện thoại: bảng hiện dạng thẻ – gắn tên cột cho từng ô. */
  const labelCells = el => el.querySelectorAll('table.data-table').forEach(t => { const heads = [...t.querySelectorAll('thead th')].map(th => th.textContent);
    t.querySelectorAll('tbody tr').forEach(tr => [...tr.children].forEach((td, i) => { if (heads[i]) td.dataset.label = heads[i]; })); });
  const factTable = (head, rows) => rows.length ? `<div class="table-wrap"><table class="data-table store-facts"><thead><tr>${head.map(h => `<th${h.startsWith('>') ? ' class="right"' : ''}>${esc(h.replace(/^>/, ''))}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>` : '<p class="muted small">Không có dữ liệu.</p>';
  function factsHtml(kind, f) {
    if (kind === 'daily') return `<dl class="kv store-kv"><dt>Doanh số</dt><dd class="num"><b>${vnd(f.totals.revenue)}</b> · ${f.totals.bills} hoá đơn</dd><dt>Tiền mặt / CK / khác</dt><dd class="num">${vnd(f.totals.cash)} / ${vnd(f.totals.transfer)} / ${vnd(f.totals.other)}</dd>
        <dt>Chênh lệch quỹ</dt><dd class="num ${f.totals.cashDifference ? 'danger-text' : ''}">${vnd(f.totals.cashDifference)}</dd></dl>${f.openShifts ? `<p class="warn-text small">Còn ${f.openShifts} ca chưa đóng – đóng ca để số liệu đầy đủ.</p>` : ''}
      ${factTable(['Ca', 'Người', '>Doanh số', '>Tiền mặt', '>Đếm / hệ thống', '>Lệch'], f.shifts.map(s => `<tr><td>${esc((s.openedAt || '').slice(11, 16))}–${s.closedAt ? esc(s.closedAt.slice(11, 16)) : 'đang mở'}</td><td>${esc(s.member)}</td><td class="right num">${vnd(s.revenue)}</td><td class="right num">${vnd(s.cash)}</td><td class="right num">${vnd(s.countedCash)} / ${vnd(s.expectedCash)}</td><td class="right num">${vnd(s.cashDifference)}${s.differenceReason ? `<small>${esc(s.differenceReason)}</small>` : ''}</td></tr>`))}`;
    if (kind === 'weekly' || kind === 'monthly') return `<dl class="kv store-kv"><dt>Doanh số ${kind === 'weekly' ? 'tuần' : 'tháng'}</dt><dd class="num"><b>${vnd(f.revenue)}</b> · ${f.bills} hoá đơn</dd></dl>
      <h3>Bán chạy</h3>${factTable(['Mã', 'Sản phẩm', '>SL', '>Tiền'], f.top.map(t => `<tr><td>${esc(t.sku)}</td><td>${esc(t.name)}</td><td class="right num">${t.qty}</td><td class="right num">${vnd(t.amount)}</td></tr>`))}
      ${kind === 'weekly' ? `<h3>Tồn mà 30 ngày không bán được</h3>${factTable(['Mã', 'Sản phẩm', '>Tồn'], f.slow.map(t => `<tr><td>${esc(t.sku)}</td><td>${esc(t.name)}</td><td class="right num">${t.qty}</td></tr>`))}`
        : `<h3>Ngày công theo ca POS</h3>${factTable(['Nhân viên', '>Số ngày', '>Số ca'], f.staff.map(s => `<tr><td>${esc(s.member || '')}</td><td class="right num">${s.days}</td><td class="right num">${s.shifts}</td></tr>`))}`}`;
    return `<h3>Phiếu kiểm kê của kho cửa hàng</h3>${factTable(['Phiếu', 'Ngày', 'Trạng thái', '>Mã lệch', '>Giá trị lệch'], f.counts.map(c => `<tr><td>${esc(c.refNo)}</td><td>${esc(c.createdAt.slice(0, 10))}</td><td>${esc({ pending: 'Chờ duyệt', approved: 'Đã duyệt', rejected: 'Từ chối' }[c.status] || c.status)}</td><td class="right num">${c.gapSkus}</td><td class="right num">${vnd(c.gapValue)}${c.missingCost ? `<small>${c.missingCost} mã chưa có giá nhập</small>` : ''}</td></tr>`))}`;
  }
  function inputsHtml(kind, v = {}, ro = false) {
    const t = (name, lab, hint = '') => `<label class="span-2">${esc(lab)}<textarea name="${name}" rows="3" ${ro ? 'readonly' : ''} placeholder="${esc(hint)}">${esc(v[name] || '')}</textarea></label>`;
    if (kind === 'daily') return `<label>Tiền mặt đã nộp ngân hàng<input name="bankDeposit" inputmode="numeric" ${ro ? 'readonly' : ''} value="${v.bankDeposit ?? ''}" placeholder="0"></label>
      <label>Mã giao dịch / ghi chú nộp tiền<input name="bankRef" maxlength="200" ${ro ? 'readonly' : ''} value="${esc(v.bankRef || '')}"></label>${t('incidents', 'Sự cố phát sinh', 'Khách khiếu nại, bể vỡ, thiết bị hỏng… (ghi "Không có" nếu không có)')}${t('note', 'Ghi chú')}`;
    if (kind === 'weekly') return t('orderProposal', 'Đề xuất đặt hàng (Sale-in) *', 'Mã / tên hàng, số lượng đề xuất đặt về') + t('roster', 'Lịch ca trực tuần tới') + t('note', 'Ghi chú');
    if (kind === 'monthly') return t('groupAnalysis', 'Phân tích nhóm hàng') + t('staffReview', 'Đánh giá ngày công và năng lực NVBH *') + t('note', 'Ghi chú');
    return `<label class="check span-2"><input type="checkbox" name="counted" ${v.counted ? 'checked' : ''} ${ro ? 'disabled' : ''}> Đã kiểm kê theo đúng quy trình, biên bản khớp thực tế và phần mềm *</label>${t('gapExplanation', 'Giải trình mọi chênh lệch phát sinh')}${t('note', 'Ghi chú')}`;
  }
  async function openReport(registerId, kind, period) {
    let d; try { d = await api(`/store/reports/draft?registerId=${encodeURIComponent(registerId)}&kind=${kind}&period=${period}`); } catch (e) { toast(e.message, 'err'); return; }
    const rep = d.report, editable = (data?.isManager ?? status?.mine?.registerId === registerId) && (!rep || rep.review === 'pending'), canReview = status?.canReview && rep;
    const st = rep ? rep.state.state : null, clientKey = crypto.randomUUID();
    const dlg = document.createElement('dialog'); dlg.className = 'modal store-dialog';
    dlg.innerHTML = `<form novalidate><div class="modal-head"><h2>${esc(label(kind))} · ${esc(periodLabel(kind, period))}</h2><button type="button" class="icon-btn" data-x aria-label="Đóng">×</button></div>
      <div class="modal-body">
        <p class="small">Hạn nộp: <b>${esc(new Date(d.deadline).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric' }))}</b>
          ${rep ? ` · Nộp lúc ${esc(new Date(rep.submittedAt).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' }))} ${pill(STATE[st][1], STATE[st][0])} ${pill(REVIEW_TONE[rep.review], status.labels.reviews[rep.review])}` : ''}</p>
        ${rep?.reviewNote ? `<p class="small">Ghi chú duyệt: ${esc(rep.reviewNote)}</p>` : ''}
        <section class="store-facts-box"><h3>Số liệu CRM ${rep ? (editable ? '(cập nhật lại khi nộp)' : 'lúc nộp') : '(tự điền khi nộp)'}</h3>${factsHtml(kind, editable || !rep ? d.facts : rep.data.facts)}</section>
        <div class="form-grid cols-2">${inputsHtml(kind, rep?.data?.inputs || {}, !editable)}</div>
        ${rep && (data?.isManager) ? `<label class="span-2">Giải trình của CHT<textarea name="explanation" rows="2">${esc(rep.explanation || '')}</textarea></label><button type="button" class="btn secondary small" data-explain>Gửi giải trình</button>` : rep?.explanation ? `<p class="small"><b>Giải trình:</b> ${esc(rep.explanation)}</p>` : ''}
        ${canReview ? `<div class="store-review"><h3>Duyệt</h3><div class="chips">${status.reviewFor[kind].map(k => `<label class="chip"><input type="radio" name="review" value="${k}" ${rep.review === k ? 'checked' : ''}> ${esc(status.labels.reviews[k])}</label>`).join('')}</div>
          <label>Lý do / ghi chú (bắt buộc khi không đạt hoặc miễn)<input name="reviewNote" maxlength="1000" value="${esc(rep.reviewNote || '')}"></label><button type="button" class="btn primary small" data-review>Lưu kết quả duyệt</button></div>` : ''}
        <p class="error" data-err role="alert"></p></div>
      <div class="modal-foot"><button type="button" class="btn secondary" data-x>Đóng</button>${editable ? `<button class="btn primary">${rep ? 'Nộp lại' : 'Nộp báo cáo'}</button>` : ''}</div></form>`;
    document.body.append(dlg); dlg.showModal(); labelCells(dlg);
    const f = dlg.querySelector('form'), err = dlg.querySelector('[data-err]');
    dlg.addEventListener('close', () => dlg.remove());
    dlg.querySelectorAll('[data-x]').forEach(b => b.onclick = () => dlg.close());
    const after = async msg => { toast(msg); dlg.close(); status = null; await loadStatus().catch(() => {}); if (location.hash.startsWith('#/store-reports')) show(`registerId=${encodeURIComponent(registerId)}&month=${current.month}`); };
    f.addEventListener('submit', async e => {
      e.preventDefault(); if (!editable) return;
      const el = f.elements, inputs = {};
      for (const k of ['bankDeposit', 'bankRef', 'incidents', 'note', 'orderProposal', 'roster', 'groupAnalysis', 'staffReview', 'gapExplanation']) if (el[k]) inputs[k] = el[k].value;
      if (el.counted) inputs.counted = el.counted.checked;
      const btn = f.querySelector('button.primary'); btn.disabled = true;
      try { const res = await api('/store/reports', 'POST', { registerId, kind, period, clientKey, inputs });
        await after(res.state?.state === 'late' ? 'Đã nộp (trễ hạn).' : 'Đã nộp báo cáo.'); }
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
