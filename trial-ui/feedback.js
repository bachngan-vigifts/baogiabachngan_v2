/**
 * GÓP Ý PHÁT TRIỂN PHẦN MỀM: nút "Góp ý / báo lỗi" (menu tài khoản, mở ở mọi trang – tự ghi trang đang dùng + thông tin máy),
 * trang #/feedback (danh sách, +1, lọc) và #/feedback/<id> (chi tiết, trao đổi, xử lý cho người có quyền, sao chép cho lập trình).
 * Mọi quyền kiểm tra lại ở máy chủ.
 */
const KIND = { bug: 'Báo lỗi', feature: 'Đề xuất tính năng mới', ui: 'Cải thiện giao diện', other: 'Khác' };
const IMPACT = { low: 'Thấp', medium: 'Vừa', high: 'Cao', blocking: 'Chặn công việc' };
const STATUS = { new: 'Mới', reviewing: 'Đang xem xét', planned: 'Đã lên kế hoạch', in_progress: 'Đang làm', done: 'Đã xong', wont_do: 'Không làm', duplicate: 'Trùng góp ý khác' };
const PRIORITY = { low: 'Thấp', medium: 'Vừa', high: 'Cao', urgent: 'Gấp' };
const STATUS_TONE = { new: 'info', reviewing: 'warn', planned: 'info', in_progress: 'warn', done: 'ok', wont_do: 'muted', duplicate: 'muted' };
const TABS = [['open', 'Đang mở'], ['closed', 'Đã đóng'], ['all', 'Tất cả'], ['mine', 'Của tôi']];

/** Nội dung gửi cho lập trình (Claude / Codex): đủ để tái hiện lỗi, không kèm thông tin cá nhân ngoài tên người gửi. */
export function feedbackForDev(d, origin = '') {
  const lines = [`# ${d.code} · ${KIND[d.kind] || d.kind}: ${d.title}`, '',
    `- Mức ảnh hưởng: ${IMPACT[d.impact] || d.impact}${d.priority ? ` · Ưu tiên: ${PRIORITY[d.priority]}` : ''}`,
    `- Trạng thái: ${STATUS[d.status] || d.status} · +1: ${d.votes}`,
    `- Trang: ${d.pageUrl || '(không ghi)'}${d.pageUrl && origin ? ` (${origin}/index.html${d.pageUrl})` : ''}`,
    `- Máy / trình duyệt: ${d.clientInfo || '(không ghi)'}`,
    `- Người gửi: ${d.authorName || ''} · ${String(d.createdAt || '').slice(0, 10)}`, '', '## Mô tả', d.description || ''];
  if (d.steps) lines.push('', '## Các bước gặp lỗi', d.steps);
  if (d.photos?.length) lines.push('', '## Ảnh (link hết hạn sau 1 giờ)', ...d.photos.map((u, i) => `${i + 1}. ${u}`));
  const talk = (d.comments || []).filter(c => c.kind === 'comment');
  if (talk.length) lines.push('', '## Trao đổi', ...talk.map(c => `- ${c.authorName || ''}: ${c.body.replace(/\n/g, ' ')}`));
  return lines.join('\n');
}

export function initFeedback({ api, root, toast, esc, go, fmtDate, compressPhoto, appVersion = () => '' }) {
  let tab = 'open', kind = '', q = '', sort = 'votes', page = 1, current = '';
  const pill = (tone, text) => `<span class="pill ${tone}">${esc(text)}</span>`;
  const when = v => fmtDate ? fmtDate(v) : String(v || '').slice(0, 10);

  // ---- Gửi góp ý (dialog dùng ở mọi trang).
  function openNew() {
    const pageUrl = location.hash || '#/', clientKey = crypto.randomUUID();
    const clientInfo = `${(navigator.userAgent.match(/(Edg|Chrome|Firefox|Safari|CriOS|FxiOS)\/[\d.]+/) || [navigator.userAgent.slice(0, 60)])[0]} · ${/Android|iPhone|iPad/i.test(navigator.userAgent) ? 'điện thoại / máy tính bảng' : 'máy tính'} · ${innerWidth}×${innerHeight} · phiên bản ${appVersion() || '?'}`;
    const dlg = document.createElement('dialog'); dlg.className = 'modal fb-dialog';
    dlg.innerHTML = `<form novalidate><div class="modal-head"><h2>Góp ý phát triển phần mềm</h2><button type="button" class="icon-btn" data-x aria-label="Đóng">×</button></div>
      <div class="modal-body form-grid cols-2">
        <label>Loại góp ý<select name="kind">${Object.entries(KIND).map(([k, t]) => `<option value="${k}">${esc(t)}</option>`).join('')}</select></label>
        <label>Mức ảnh hưởng<select name="impact">${Object.entries(IMPACT).map(([k, t]) => `<option value="${k}" ${k === 'medium' ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></label>
        <label class="span-2">Tiêu đề<input name="title" maxlength="160" required placeholder="Ví dụ: Không lưu được báo giá trên điện thoại"></label>
        <label class="span-2">Mô tả<textarea name="description" rows="4" maxlength="4000" required placeholder="Đang làm gì, mong muốn thế nào, điều gì xảy ra…"></textarea></label>
        <label class="span-2" data-steps>Các bước gặp lỗi<textarea name="steps" rows="3" maxlength="2000" placeholder="1. Mở …&#10;2. Bấm …&#10;3. Thấy …"></textarea></label>
        <label class="span-2">Ảnh chụp màn hình (tối đa 3)<input name="photos" type="file" accept="image/*" multiple></label>
        <label class="span-2 check"><input type="checkbox" name="private"> Chỉ người xử lý xem (góp ý nhạy cảm – không hiện cho đồng nghiệp)</label>
        <p class="muted small span-2">Tự ghi kèm: trang <b>${esc(pageUrl)}</b> · ${esc(clientInfo)}</p>
        <p class="error span-2" data-err role="alert"></p>
      </div>
      <div class="modal-foot"><button type="button" class="btn secondary" data-x>Huỷ</button><button class="btn primary">Gửi góp ý</button></div></form>`;
    document.body.append(dlg); dlg.showModal();
    const f = dlg.querySelector('form'), err = dlg.querySelector('[data-err]'), steps = dlg.querySelector('[data-steps]');
    dlg.querySelectorAll('[data-x]').forEach(b => b.addEventListener('click', () => dlg.close()));
    dlg.addEventListener('close', () => dlg.remove());
    const syncKind = () => { steps.hidden = f.kind.value !== 'bug'; }; f.kind.addEventListener('change', syncKind); syncKind();
    f.addEventListener('submit', async e => {
      e.preventDefault(); err.textContent = '';
      const btn = f.querySelector('button.primary'); btn.disabled = true;
      try {
        const files = [...(f.photos.files || [])];
        if (files.length > 3) throw Error('Tối đa 3 ảnh.');
        const photos = [];
        for (const file of files) photos.push(compressPhoto ? await compressPhoto(file) : await new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = no; r.readAsDataURL(file); }));
        // Giữ nguyên clientKey khi gửi lại sau lỗi mạng: máy chủ không tạo góp ý thứ hai.
        const r = await api('/feedback', 'POST', { clientKey, kind: f.kind.value, impact: f.impact.value, title: f.title.value, description: f.description.value,
          steps: f.kind.value === 'bug' ? f.steps.value : '', visibility: f.private.checked ? 'private' : 'public', pageUrl, clientInfo, photos });
        dlg.close(); toast(`Đã gửi góp ý ${r.code}. Cảm ơn bạn!`); go('#/feedback/' + encodeURIComponent(r.id));
      } catch (e2) { err.textContent = e2.message || 'Chưa gửi được. Thử lại.'; btn.disabled = false; }
    });
  }

  // ---- Danh sách.
  async function loadList() {
    current = '';
    const params = new URLSearchParams({ status: tab === 'mine' ? 'all' : tab, sort, page: String(page), ...(tab === 'mine' ? { mine: '1' } : {}), ...(kind ? { kind } : {}), ...(q ? { q } : {}) });
    root.innerHTML = `<div class="fb-page"><div class="page-head fb-head"><div><h1>Góp ý phần mềm</h1><p class="muted">Báo lỗi, đề xuất tính năng, cải thiện giao diện. Bấm +1 nếu bạn cũng gặp – góp ý nhiều +1 được ưu tiên.</p></div>
      <button type="button" class="btn primary" data-new>+ Gửi góp ý</button></div><p class="muted">Đang tải…</p></div>`;
    root.querySelector('[data-new]').addEventListener('click', openNew);
    let d; try { d = await api('/feedback?' + params); } catch (e) { root.querySelector('.fb-page p.muted:last-child').textContent = e.message; return; }
    const pages = Math.max(1, Math.ceil(d.total / d.pageSize)), openCount = ['new', 'reviewing', 'planned', 'in_progress'].reduce((s, k) => s + (d.counts[k] || 0), 0);
    root.querySelector('.fb-page').innerHTML = `<div class="page-head fb-head"><div><h1>Góp ý phần mềm</h1><p class="muted">Báo lỗi, đề xuất tính năng, cải thiện giao diện. Bấm +1 nếu bạn cũng gặp – góp ý nhiều +1 được ưu tiên.</p></div>
      <button type="button" class="btn primary" data-new>+ Gửi góp ý</button></div>
      <div class="fb-filters"><div class="seg" role="group" aria-label="Lọc trạng thái">${TABS.map(([k, t]) => `<button type="button" data-tab="${k}" aria-pressed="${k === tab}">${esc(t)}${k === 'open' ? ` (${openCount})` : ''}</button>`).join('')}</div>
        <select data-kind aria-label="Loại"><option value="">Mọi loại</option>${Object.entries(KIND).map(([k, t]) => `<option value="${k}" ${k === kind ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>
        <select data-sort aria-label="Sắp xếp"><option value="votes" ${sort === 'votes' ? 'selected' : ''}>Nhiều +1 nhất</option><option value="new" ${sort === 'new' ? 'selected' : ''}>Mới gửi</option><option value="updated" ${sort === 'updated' ? 'selected' : ''}>Mới cập nhật</option></select>
        <input type="search" data-q placeholder="Tìm tiêu đề, nội dung, mã GY-…" value="${esc(q)}" aria-label="Tìm góp ý"></div>
      ${d.items.length ? `<ul class="fb-list">${d.items.map(i => `<li class="card fb-item"><button type="button" class="fb-vote ${i.voted ? 'is-on' : ''}" data-vote="${esc(i.id)}" aria-pressed="${i.voted}" aria-label="+1 cho ${esc(i.code)}" ${['done', 'wont_do', 'duplicate'].includes(i.status) ? 'disabled' : ''}><b>${i.votes}</b><span>+1</span></button>
        <a class="fb-item-body" href="#/feedback/${encodeURIComponent(i.id)}"><span class="fb-item-title"><small class="muted">${esc(i.code)}</small> ${esc(i.title)}</span>
        <span class="fb-item-meta">${pill(STATUS_TONE[i.status] || 'muted', STATUS[i.status] || i.status)} ${pill(i.kind === 'bug' ? 'danger' : 'info', KIND[i.kind] || i.kind)} ${i.impact === 'blocking' || i.impact === 'high' ? pill('warn', 'Ảnh hưởng ' + IMPACT[i.impact].toLowerCase()) : ''}${i.visibility === 'private' ? pill('muted', 'Riêng tư') : ''}
          <span class="muted small">${esc(i.authorName || '')} · ${esc(when(i.createdAt))}${i.comments ? ` · ${i.comments} trao đổi` : ''}</span></span></a></li>`).join('')}</ul>`
        : `<p class="muted fb-empty">${tab === 'mine' ? 'Bạn chưa gửi góp ý nào.' : 'Chưa có góp ý phù hợp.'}</p>`}
      ${pages > 1 ? `<div class="fb-pager"><button type="button" class="btn secondary small" data-page="-1" ${page <= 1 ? 'disabled' : ''}>‹ Trước</button><span>Trang ${page}/${pages}</span><button type="button" class="btn secondary small" data-page="1" ${page >= pages ? 'disabled' : ''}>Sau ›</button></div>` : ''}`;
    const box = root.querySelector('.fb-page');
    box.querySelector('[data-new]').addEventListener('click', openNew);
    box.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => { tab = b.dataset.tab; page = 1; loadList(); }));
    box.querySelector('[data-kind]').addEventListener('change', e => { kind = e.target.value; page = 1; loadList(); });
    box.querySelector('[data-sort]').addEventListener('change', e => { sort = e.target.value; page = 1; loadList(); });
    let timer; box.querySelector('[data-q]').addEventListener('input', e => { clearTimeout(timer); timer = setTimeout(() => { q = e.target.value.trim(); page = 1; loadList(); }, 400); });
    box.querySelectorAll('[data-page]').forEach(b => b.addEventListener('click', () => { page += Number(b.dataset.page); loadList(); }));
    box.querySelectorAll('[data-vote]').forEach(b => b.addEventListener('click', async () => {
      b.disabled = true;
      try { const r = await api(`/feedback/${encodeURIComponent(b.dataset.vote)}/vote`, 'POST', { on: b.getAttribute('aria-pressed') !== 'true' }); b.querySelector('b').textContent = r.votes; b.setAttribute('aria-pressed', String(r.voted)); b.classList.toggle('is-on', r.voted); }
      catch (e) { toast(e.message, 'err'); } finally { b.disabled = false; }
    }));
  }

  // ---- Chi tiết.
  async function loadDetail(id) {
    current = id; root.innerHTML = '<p class="muted">Đang tải góp ý…</p>';
    let d; try { d = await api('/feedback/' + encodeURIComponent(id)); } catch (e) { root.innerHTML = `<p class="error">${esc(e.message)}</p><p><a href="#/feedback">‹ Danh sách góp ý</a></p>`; return; }
    if (current !== id) return;
    const closed = ['done', 'wont_do', 'duplicate'].includes(d.status);
    root.innerHTML = `<div class="fb-detail">
      <p><a href="#/feedback">‹ Danh sách góp ý</a></p>
      <div class="page-head fb-head"><div><p class="muted small">${esc(d.code)} · ${esc(d.authorName)} · ${esc(when(d.createdAt))}</p><h1>${esc(d.title)}</h1>
        <p class="fb-item-meta">${pill(STATUS_TONE[d.status] || 'muted', STATUS[d.status])} ${pill(d.kind === 'bug' ? 'danger' : 'info', KIND[d.kind])} ${pill(d.impact === 'blocking' || d.impact === 'high' ? 'warn' : 'muted', 'Ảnh hưởng ' + IMPACT[d.impact].toLowerCase())}${d.priority ? ' ' + pill('info', 'Ưu tiên ' + PRIORITY[d.priority].toLowerCase()) : ''}${d.visibility === 'private' ? ' ' + pill('muted', 'Riêng tư') : ''}</p></div>
        <div class="row-actions"><button type="button" class="fb-vote ${d.voted ? 'is-on' : ''}" data-vote aria-pressed="${d.voted}" ${closed ? 'disabled' : ''}><b>${d.votes}</b><span>+1</span></button>
        ${d.manage ? '<button type="button" class="btn secondary" data-copy>Sao chép cho lập trình</button>' : ''}</div></div>
      ${d.duplicateOfItem ? `<p class="notice">Trùng với <a href="#/feedback/${encodeURIComponent(d.duplicateOfItem.id)}">${esc(d.duplicateOfItem.code)} · ${esc(d.duplicateOfItem.title)}</a> – theo dõi và +1 ở góp ý gốc.</p>` : ''}
      <section class="card fb-section"><h3>Mô tả</h3><p class="fb-text">${esc(d.description)}</p>
        ${d.steps ? `<h3>Các bước gặp lỗi</h3><p class="fb-text">${esc(d.steps)}</p>` : ''}
        ${d.photos.length ? `<div class="fb-photos">${d.photos.map((u, i) => `<a href="${esc(u)}" target="_blank" rel="noopener"><img src="${esc(u)}" alt="Ảnh ${i + 1} của góp ý" loading="lazy"></a>`).join('')}</div>` : ''}
        <p class="muted small">Trang: ${/^#\/[^\s<>"']*$/.test(d.pageUrl || '') ? `<a href="${esc(d.pageUrl)}">${esc(d.pageUrl)}</a>` : '—'} · ${esc(d.clientInfo || '')}</p></section>
      ${d.manage ? `<section class="card fb-section fb-triage"><h3>Xử lý góp ý</h3><form class="form-grid cols-2" data-triage>
        <label>Trạng thái<select name="status">${Object.entries(STATUS).map(([k, t]) => `<option value="${k}" ${k === d.status ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></label>
        <label>Ưu tiên<select name="priority"><option value="">Chưa đặt</option>${Object.entries(PRIORITY).map(([k, t]) => `<option value="${k}" ${k === d.priority ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></label>
        <label data-dup ${d.status === 'duplicate' ? '' : 'hidden'}>Gộp vào góp ý (mã)<input name="duplicateOf" placeholder="GY-0012" value="${esc(d.duplicateOfItem?.code || '')}"></label>
        <label class="span-2">Lý do / ghi chú cho người gửi<textarea name="reason" rows="2" maxlength="500" placeholder="Bắt buộc khi chọn Không làm"></textarea></label>
        <p class="error span-2" data-err role="alert"></p><div class="span-2"><button class="btn primary">Lưu xử lý</button></div></form></section>` : ''}
      <section class="card fb-section"><h3>Trao đổi &amp; lịch sử</h3>
        ${d.comments.length ? `<ol class="fb-thread">${d.comments.map(c => `<li class="${c.kind === 'status' ? 'is-status' : ''}"><p class="muted small"><b>${esc(c.authorName || '')}</b> · ${esc(when(c.createdAt))}${c.kind === 'status' ? ' · cập nhật xử lý' : ''}</p><p class="fb-text">${esc(c.body)}</p></li>`).join('')}</ol>` : '<p class="muted">Chưa có trao đổi.</p>'}
        ${d.canComment ? `<form data-comment class="fb-comment"><textarea name="body" rows="2" maxlength="2000" required placeholder="${d.manage ? 'Hỏi thêm người gửi / thông báo tiến độ…' : 'Bổ sung thông tin cho người xử lý…'}" aria-label="Nội dung trao đổi"></textarea><button class="btn primary">Gửi</button></form>`
          : '<p class="muted small">Chỉ người gửi và người xử lý trao đổi ở đây. Bấm +1 nếu bạn cũng gặp.</p>'}</section></div>`;
    const box = root.querySelector('.fb-detail');
    box.querySelector('[data-vote]')?.addEventListener('click', async e => {
      const b = e.currentTarget; b.disabled = true;
      try { const r = await api(`/feedback/${encodeURIComponent(id)}/vote`, 'POST', { on: b.getAttribute('aria-pressed') !== 'true' }); b.querySelector('b').textContent = r.votes; b.setAttribute('aria-pressed', String(r.voted)); b.classList.toggle('is-on', r.voted); }
      catch (e2) { toast(e2.message, 'err'); } finally { b.disabled = closed; }
    });
    box.querySelector('[data-copy]')?.addEventListener('click', async () => {
      const textOut = feedbackForDev(d, location.origin);
      try { await navigator.clipboard.writeText(textOut); toast('Đã sao chép – dán cho Claude / Codex.'); }
      catch { const t = document.createElement('textarea'); t.value = textOut; document.body.append(t); t.select(); document.execCommand('copy'); t.remove(); toast('Đã sao chép.'); }
    });
    const tri = box.querySelector('[data-triage]');
    if (tri) {
      tri.status.addEventListener('change', () => { tri.querySelector('[data-dup]').hidden = tri.status.value !== 'duplicate'; });
      tri.addEventListener('submit', async e => {
        e.preventDefault(); const err = tri.querySelector('[data-err]'), btn = tri.querySelector('button'); err.textContent = ''; btn.disabled = true;
        try { await api(`/feedback/${encodeURIComponent(id)}/triage`, 'POST', { status: tri.status.value, priority: tri.priority.value || null, reason: tri.reason.value, duplicateOf: tri.duplicateOf.value }); toast('Đã lưu xử lý.'); loadDetail(id); }
        catch (e2) { err.textContent = e2.message; btn.disabled = false; }
      });
    }
    const cf = box.querySelector('[data-comment]');
    cf?.addEventListener('submit', async e => {
      e.preventDefault(); const btn = cf.querySelector('button'); btn.disabled = true;
      try { await api(`/feedback/${encodeURIComponent(id)}/comments`, 'POST', { body: cf.body.value }); loadDetail(id); }
      catch (e2) { toast(e2.message, 'err'); btn.disabled = false; }
    });
  }

  return { openNew, show: id => id ? loadDetail(id) : loadList() };
}
