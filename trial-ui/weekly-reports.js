/**
 * BÁO CÁO TUẦN Sale / Sale Admin – trang #/weekly-reports[?month=].
 *  - Sale / Sale Admin: 4 báo cáo bắt buộc / tháng (hạn 10h thứ Hai tuần sau), lưu nháp / nộp chính thức; điểm → Tiền trách nhiệm.
 *  - Manager: bảng mọi người × tuần, mở báo cáo để duyệt Đạt / Chưa đạt / Miễn. Mọi quyền kiểm tra lại ở máy chủ.
 */
const STATE = { on_time: ['Đúng hạn', 'ok'], late: ['Nộp trễ', 'warn'], missing: ['Chưa nộp – quá hạn', 'danger'], not_due: ['Chưa tới hạn', 'muted'] };
const REVIEW_TONE = { pending: 'muted', ok: 'ok', rejected: 'danger', excused: 'info' };
const dm = d => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
const addDays = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 86400_000).toISOString().slice(0, 10);
const vnNow = () => new Date(Date.now() + 7 * 3600_000).toISOString();
export const weekLabel = p => `${dm(p)}–${dm(addDays(p, 6))}`;
export const scoreText = s => s === null || s === undefined ? '—' : String(s).replace('.', ',');

export function initWeeklyReports({ api, root, toast, esc, go, money }) {
  let current = { month: '' }, me = null, reminded = false;
  const pill = (tone, text) => `<span class="pill ${tone}">${esc(text)}</span>`;
  const when = v => new Date(v).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', timeZone: 'Asia/Ho_Chi_Minh' });
  const vnd = v => v === null || v === undefined ? '—' : money(v);

  /** Sau đăng nhập: hiện mục menu; nhắc tuần trước chưa nộp (một lần mỗi phiên). */
  async function start() {
    try { me = await api('/staff-reports/me'); } catch { return; }
    document.querySelectorAll('[data-nav="weekly-reports"]').forEach(a => { a.hidden = !(me.required || me.canReview); });
    if (me.required && me.remind && !reminded) { reminded = true; toast(`Chưa nộp báo cáo tuần ${weekLabel(me.remind.period)} – hạn ${when(me.remind.deadline)}.`, 'warn'); }
  }
  async function show(query = '') {
    const q = new URLSearchParams(query);
    current.month = q.get('month') || current.month || vnNow().slice(0, 7);
    root.innerHTML = '<p class="muted">Đang tải…</p>';
    try { me = await api(`/staff-reports/me?month=${current.month}`); } catch (e) { root.innerHTML = `<div class="empty"><p>${esc(e.message)}</p></div>`; return; }
    if (me.canReview) return showReview();
    if (!me.required) { root.innerHTML = '<div class="empty"><h3>Báo cáo tuần</h3><p class="muted">Chức vụ của bạn không phải nộp báo cáo tuần.</p></div>'; return; }
    const pct = Math.min(100, me.points / me.maxPoints * 100);
    root.innerHTML = `<div class="page-head"><div><h1>Báo cáo tuần</h1><p class="muted">${me.maxPoints} báo cáo bắt buộc / tháng · hạn <b>10h00 thứ Hai</b> tuần sau</p></div>
        <div class="head-actions"><input type="month" id="wr-month" value="${esc(current.month)}" aria-label="Tháng"></div></div>
      <div class="card wr-sum"><div class="wr-row"><b>Điểm tháng ${esc(current.month.slice(5))}/${esc(current.month.slice(0, 4))}</b><b class="num">${scoreText(me.points)} / ${me.maxPoints}</b></div>
        <div class="wr-bar"><i style="width:${pct}%"></i></div>
        <p class="muted small">${me.applies ? 'Tiền trách nhiệm = mức trách nhiệm × ngày công ÷ công chuẩn × điểm ÷ 4. Đúng hạn 1 điểm · trễ dưới 1 ngày 0,5 · trễ từ 1 ngày / không nộp / Chưa đạt 0 · Miễn 1. Tháng 5 tuần lấy 4 tuần cao nhất.' : 'Tháng này chưa áp dụng vào Tiền trách nhiệm (áp dụng từ 12/2026) – vẫn nên nộp để làm quen.'}</p></div>
      <div class="card"><div class="wr-weeks">${me.weeks.map((w, i) => { const st = STATE[w.state];
        return `<button type="button" class="wr-week" data-week="${esc(w.period)}"><span class="wr-n">${i + 1}</span><span class="wr-grow"><b>Tuần ${esc(weekLabel(w.period))}</b>
          <small>${w.submittedAt ? 'Nộp ' + esc(when(w.submittedAt)) : 'Hạn ' + esc(when(w.deadline))}${w.draftAt && !w.submittedAt ? ' · có nháp' : ''}</small></span>
          <span class="wr-tags">${pill(st[1], st[0])}${w.review ? pill(REVIEW_TONE[w.review], me.reviewLabels[w.review]) : ''}${w.score !== null ? pill('info', scoreText(w.score) + ' điểm') : ''}</span></button>`; }).join('')}</div></div>`;
    root.querySelector('#wr-month').onchange = e => { if (e.target.value) go(`#/weekly-reports?month=${e.target.value}`); };
    root.querySelectorAll('[data-week]').forEach(b => b.onclick = () => openWeek(b.dataset.week));
  }
  async function showReview() {
    let d; try { d = await api(`/staff-reports/review?month=${current.month}`); } catch (e) { root.innerHTML = `<div class="empty"><p>${esc(e.message)}</p></div>`; return; }
    root.innerHTML = `<div class="page-head"><div><h1>Báo cáo tuần – Sale / Sale Admin</h1><p class="muted">Duyệt Đạt / Chưa đạt / Miễn · điểm dùng tính Tiền trách nhiệm${d.applies ? '' : ' (tháng này chưa áp dụng)'}</p></div>
        <div class="head-actions"><input type="month" id="wr-month" value="${esc(current.month)}" aria-label="Tháng"></div></div>
      <div class="card"><div class="table-wrap"><table class="data-table wr-table"><thead><tr><th>Nhân viên</th>${d.weeks.map(w => `<th>${esc(weekLabel(w))}</th>`).join('')}<th class="right">Điểm</th></tr></thead>
      <tbody>${d.people.map(p => `<tr><td>${esc(p.name)}${p.positionId === 'sale-admin' ? ' <small class="muted">Sale Admin</small>' : ''}</td>${p.weeks.map(w => `<td>${w.reportId
        ? `<button type="button" class="btn ghost small" data-open="${esc(p.id)}|${esc(w.period)}">${pill(STATE[w.state][1], STATE[w.state][0])}${pill(REVIEW_TONE[w.review], d.reviewLabels[w.review])}</button>`
        : pill(STATE[w.state][1], STATE[w.state][0])}</td>`).join('')}<td class="right num"><b>${scoreText(p.points)}</b>/4</td></tr>`).join('') || '<tr><td colspan="9" class="muted">Chưa có Sale / Sale Admin.</td></tr>'}</tbody></table></div></div>`;
    root.querySelector('#wr-month').onchange = e => { if (e.target.value) go(`#/weekly-reports?month=${e.target.value}`); };
    root.querySelectorAll('[data-open]').forEach(b => b.onclick = () => { const [id, period] = b.dataset.open.split('|'); openWeek(period, id); });
    root.querySelectorAll('table.data-table').forEach(t => { const heads = [...t.querySelectorAll('thead th')].map(th => th.textContent);
      t.querySelectorAll('tbody tr').forEach(tr => [...tr.children].forEach((td, i) => { if (heads[i]) td.dataset.label = heads[i]; })); });
  }
  async function openWeek(period, memberId = '') {
    let d; try { d = await api(`/staff-reports/week?period=${period}${memberId ? '&memberId=' + encodeURIComponent(memberId) : ''}`); } catch (e) { toast(e.message, 'err'); return; }
    const rep = d.report, f = d.canEdit || !rep ? d.facts : rep.data.facts, v = d.draft?.inputs || rep?.data?.inputs || {}, ro = !d.canEdit, clientKey = crypto.randomUUID();
    const ta = (name, label, hint, req) => `<label class="span-2">${esc(label)}${req ? ' *' : ''}<textarea name="${name}" rows="3" ${ro ? 'readonly' : ''} placeholder="${esc(hint)}">${esc(v[name] || '')}</textarea></label>`;
    const mo = f.month || {};
    const dlg = document.createElement('dialog'); dlg.className = 'modal wr-dialog';
    dlg.innerHTML = `<form novalidate><div class="modal-head"><h2>Báo cáo tuần ${esc(weekLabel(period))}${memberId ? ' · ' + esc(d.member.name) : ''}</h2><button type="button" class="icon-btn" data-x aria-label="Đóng">×</button></div>
      <div class="modal-body">
        <p class="small">Hạn nộp <b>${esc(when(d.deadline))}</b>${rep ? ` · Nộp chính thức ${esc(when(rep.submittedAt))} ${pill(STATE[rep.state.state][1], STATE[rep.state.state][0])} ${pill(REVIEW_TONE[rep.review], d.reviewLabels[rep.review])} · ${scoreText(rep.score)} điểm` : ' · ' + pill('muted', 'Chưa nộp chính thức')}${d.draft ? ` · Nháp lưu ${esc(when(d.draft.updatedAt))}` : ''}</p>
        ${d.blockers.length && !memberId ? `<p class="warn-text small">${d.blockers.map(esc).join(' ')}</p>` : ''}
        ${rep?.reviewNote ? `<p class="small">Ghi chú duyệt: ${esc(rep.reviewNote)}</p>` : ''}
        <span class="wr-src">CRM tự điền · ${esc(rep && !d.canEdit ? 'lúc nộp' : 'tính lúc ' + when(d.factsAt))}</span>
        <div class="wr-kpis"><div><small>Doanh số tuần</small><b class="num">${vnd(f.revenue)}</b></div><div><small>KH mới</small><b class="num">${f.newCustomers}</b></div><div><small>Giao dịch</small><b class="num">${f.transactions}</b></div>
          <div><small>Báo giá gửi</small><b class="num">${f.quotesSent}</b></div><div><small>Báo giá chốt</small><b class="num">${f.quotesWon}</b></div><div><small>HĐKT ký</small><b class="num">${f.contracts}</b></div></div>
        <p class="muted small">Luỹ kế tháng ${esc(mo.month?.slice(5) || '')}: ${vnd(mo.revenue)}${mo.target ? ` / ${vnd(mo.target)} chỉ tiêu (${(Math.round(mo.ratio * 1000) / 10).toLocaleString('vi-VN')}%)` : ' · chưa có chỉ tiêu đăng ký'}</p>
        <span class="wr-src input">Tự nhập</span>
        <div class="form-grid cols-2">${ta('highlights', 'Kết quả nổi bật tuần', 'Hợp đồng / đơn chốt, khách mới đáng chú ý…', true)}${ta('keyCustomers', 'Khách trọng điểm đang theo & bước tiếp', 'Tên khách – giá trị dự kiến – việc cần làm', true)}
          ${ta('nextWeekPlan', 'Kế hoạch tuần tới', '1–3 mục tiêu cụ thể', true)}${ta('support', 'Khó khăn / cần hỗ trợ', '', false)}</div>
        ${d.versions.length > 1 ? `<details class="small"><summary>Lịch sử nộp (${d.versions.length} lần)</summary><ol>${d.versions.map(x => `<li>Lần ${x.version} · ${esc(when(x.submittedAt))}</li>`).join('')}</ol></details>` : ''}
        ${d.canReview ? `<div class="wr-review"><h3>Duyệt</h3><div class="chips">${['ok', 'rejected', 'excused'].map(k => `<label class="chip"><input type="radio" name="review" value="${k}" ${rep.review === k ? 'checked' : ''}> ${esc(d.reviewLabels[k])}</label>`).join('')}</div>
          <label>Lý do / ghi chú (bắt buộc khi Chưa đạt hoặc Miễn)<input name="reviewNote" maxlength="1000" value="${esc(rep.reviewNote || '')}"></label><button type="button" class="btn primary small" data-review>Lưu kết quả duyệt</button></div>` : ''}
        <p class="error" data-err role="alert"></p></div>
      <div class="modal-foot"><button type="button" class="btn secondary" data-x>Đóng</button>${d.canEdit ? '<button type="button" class="btn secondary" data-draft>Lưu nháp</button>' : ''}${d.canSubmit ? `<button class="btn primary">${rep ? 'Nộp lại chính thức' : 'Nộp chính thức'}</button>` : ''}</div></form>`;
    document.body.append(dlg); dlg.showModal();
    const form = dlg.querySelector('form'), err = dlg.querySelector('[data-err]');
    dlg.addEventListener('close', () => dlg.remove()); dlg.querySelectorAll('[data-x]').forEach(b => b.onclick = () => dlg.close());
    const inputs = () => Object.fromEntries(['highlights', 'keyCustomers', 'nextWeekPlan', 'support'].map(k => [k, form.elements[k].value]));
    const after = msg => { toast(msg); dlg.close(); show(`month=${current.month}`); };
    dlg.querySelector('[data-draft]')?.addEventListener('click', async () => { try { await api('/staff-reports/draft', 'PUT', { period, inputs: inputs() }); after('Đã lưu nháp – chưa nộp chính thức.'); } catch (e) { err.textContent = e.message; } });
    form.addEventListener('submit', async e => { e.preventDefault(); if (!d.canSubmit) return;
      try { const r = await api('/staff-reports', 'POST', { period, clientKey, inputs: inputs() }); after(r.state?.state === 'late' ? 'Đã nộp chính thức (trễ hạn).' : 'Đã nộp chính thức.'); } catch (ex) { err.textContent = ex.message; } });
    dlg.querySelector('[data-review]')?.addEventListener('click', async () => {
      const review = form.querySelector('input[name="review"]:checked')?.value; if (!review) { err.textContent = 'Chọn kết quả duyệt.'; return; }
      try { await api(`/staff-reports/${rep.id}/review`, 'POST', { review, note: form.elements.reviewNote.value }); after('Đã lưu kết quả duyệt.'); } catch (ex) { err.textContent = ex.message; }
    });
  }
  return { start, show, openWeek };
}
