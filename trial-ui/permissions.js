/**
 * Trang PHÂN QUYỀN (#/permissions) – docs/PHAN-QUYEN.md. Manager hoặc chức vụ có quyền "Quản lý phân quyền".
 *  Tab "Bảng quyền":  cột = chức vụ (nhóm theo phòng ban), dòng = quyền; tích / bỏ tích rồi "Lưu thay đổi".
 *  Tab "Phòng ban & chức vụ": thêm / đổi tên / xoá phòng ban; thêm chức vụ (chép quyền từ chức vụ khác), xếp phòng, đổi tên, xoá.
 *  Tab "Nhật ký": ai đổi gì, lúc nào.
 * DOM dựng bằng createElement / textContent (không chèn HTML từ dữ liệu).
 */
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = String(text); return n; };
const button = (text, cls, on) => { const b = el('button', cls, text); b.type = 'button'; if (on) b.addEventListener('click', on); return b; };
const when = iso => { const d = new Date(iso), p = n => String(n).padStart(2, '0'); return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`; };

export function initPermissions({ api, root, toast, confirmBox }) {
  const page = el('div', 'perm-page');
  const head = el('div', 'page-head'), titles = el('div');
  titles.append(el('span', 'eyebrow', 'Quản trị'), el('h1', '', 'Phân quyền'),
    el('p', 'muted', 'Quyền gán theo chức vụ; mỗi chức vụ thuộc một phòng ban. Manager luôn có toàn quyền. Lưu xong có hiệu lực ngay ở lần bấm kế tiếp của nhân viên.'));
  head.append(titles);
  const tabs = el('div', 'perm-tabs'), body = el('div', 'perm-body');
  page.append(head, tabs, body);
  root.append(page);
  let data = null, tab = 'matrix', draft = new Map(); // positionId → { perms:Set, dataScope }

  const TABS = [['matrix', 'Bảng quyền'], ['org', 'Phòng ban & chức vụ'], ['log', 'Nhật ký']];
  function drawTabs() {
    tabs.replaceChildren(...TABS.map(([k, label]) => { const b = button(label, 'chip' + (tab === k ? ' active' : ''), () => { if (k !== tab) { tab = k; draw(); } }); b.setAttribute('aria-pressed', String(tab === k)); return b; }));
  }
  const deptName = id => data.departments.find(d => d.id === id)?.name || 'Chưa xếp phòng';
  /** Chức vụ theo thứ tự phòng ban (Manager đứng đầu), mỗi phòng một nhóm cột. */
  function groups() {
    const order = [...data.departments.map(d => d.id), null];
    return order.map(id => ({ id, name: id ? deptName(id) : 'Chưa xếp phòng', positions: data.positions.filter(p => (p.departmentId ?? null) === id) }))
      .filter(g => g.positions.length).sort((a, b) => (b.positions.some(p => p.id === 'manager') ? 1 : 0) - (a.positions.some(p => p.id === 'manager') ? 1 : 0));
  }
  const state = p => draft.get(p.id) || { perms: new Set(p.perms), dataScope: p.dataScope };
  const changed = p => { const d = draft.get(p.id); if (!d) return false; return d.dataScope !== p.dataScope || d.perms.size !== p.perms.length || p.perms.some(k => !d.perms.has(k)); };
  const dirtyCount = () => data.positions.filter(changed).length;

  async function load() {
    body.replaceChildren(el('p', 'muted', 'Đang tải…'));
    try { data = await api('/permissions'); draft = new Map(); draw(); }
    catch (e) { body.replaceChildren(el('p', 'error card', e.message)); }
  }
  function draw() { drawTabs(); if (!data) return; tab === 'matrix' ? drawMatrix() : tab === 'org' ? drawOrg() : drawLog(); }

  // ---------------------------------------------------------------- bảng quyền
  function drawMatrix() {
    const gs = groups(), cols = gs.flatMap(g => g.positions);
    const wrap = el('div', 'table-wrap perm-wrap'), table = el('table', 'data-table perm-table');
    const h1 = el('tr'), h2 = el('tr');
    const corner = el('th', 'perm-corner', 'Quyền'); corner.rowSpan = 2; h1.append(corner);
    for (const g of gs) { const th = el('th', 'perm-dept', g.name); th.colSpan = g.positions.length; h1.append(th); }
    for (const p of cols) { const th = el('th', 'perm-pos'); th.append(el('b', '', p.name), el('small', 'muted', `${p.members} người`)); if (changed(p)) th.classList.add('changed'); h2.append(th); }
    const thead = el('thead'); thead.append(h1, h2);
    const tbody = el('tbody');
    // Phạm vi dữ liệu: một ô chọn cho mỗi chức vụ.
    const scopeRow = el('tr', 'perm-scope'); scopeRow.append(cellHead('Phạm vi dữ liệu', 'Báo giá, đơn, khách, chăm sóc, doanh số… của ai thì xem được.'));
    for (const p of cols) {
      const td = el('td');
      if (p.system) td.append(el('span', 'muted small', 'Toàn bộ'));
      else {
        const sel = el('select'); sel.setAttribute('aria-label', 'Phạm vi dữ liệu – ' + p.name);
        for (const s of data.scopes) { const o = el('option', '', s.label); o.value = s.key; sel.append(o); }
        sel.value = state(p).dataScope;
        sel.addEventListener('change', () => { const d = state(p); draft.set(p.id, { perms: new Set(d.perms), dataScope: sel.value }); drawMatrix(); });
        td.append(sel);
      }
      scopeRow.append(td);
    }
    tbody.append(scopeRow);
    let group = '';
    for (const def of data.catalog) {
      if (def.group !== group) { group = def.group; const tr = el('tr', 'perm-group'), td = el('td', '', group); td.colSpan = cols.length + 1; tr.append(td); tbody.append(tr); }
      const tr = el('tr'); tr.append(cellHead(def.label, def.hint));
      for (const p of cols) {
        const td = el('td', 'perm-cell'), box = el('input'); box.type = 'checkbox';
        box.checked = p.system || state(p).perms.has(def.key); box.disabled = p.system;
        box.setAttribute('aria-label', `${def.label} – ${p.name}`);
        if (!p.system && box.checked !== p.perms.includes(def.key)) td.classList.add('changed');
        box.addEventListener('change', () => {
          const d = state(p), perms = new Set(d.perms); box.checked ? perms.add(def.key) : perms.delete(def.key);
          draft.set(p.id, { perms, dataScope: d.dataScope }); drawMatrix();
        });
        td.append(box); tr.append(td);
      }
      tbody.append(tr);
    }
    table.append(thead, tbody); wrap.append(table);
    const n = dirtyCount(), bar = el('div', 'perm-bar' + (n ? ' dirty' : ''));
    bar.append(el('span', 'muted', n ? `Đã sửa ${n} chức vụ – chưa lưu.` : 'Tích / bỏ tích để cấp / thu quyền. Cột Manager cố định.'));
    const undo = button('Bỏ thay đổi', 'btn secondary', () => { draft = new Map(); drawMatrix(); }); undo.disabled = !n;
    const save = button(n ? `Lưu thay đổi (${n})` : 'Lưu thay đổi', 'btn primary', saveMatrix); save.disabled = !n;
    bar.append(el('span', 'spacer'), undo, save);
    const note = el('p', 'muted small', 'Luôn có (không cần cấp): Công việc, Sản phẩm, Tin nhắn. Chỉ Manager: Nhân viên, Bảng lương, quản trị hệ thống. Tắt "Khách hàng" vẫn chọn được khách khi lập báo giá / đơn. Phê duyệt (báo giá, khách mới, sản phẩm mới, đơn / HĐKT, đơn mua NCC) không nằm trong bảng này: Manager bật cờ "Được duyệt" cho từng nhân viên ở trang Nhân viên.');
    body.replaceChildren(bar, wrap, note);
  }
  function cellHead(label, hint) { const th = el('th', 'perm-label'); th.scope = 'row'; th.append(el('span', '', label)); if (hint) th.append(el('small', 'muted', hint)); return th; }
  async function saveMatrix(e) {
    const list = data.positions.filter(changed); if (!list.length) return;
    const mine = list.find(p => p.id === data.myPosition);
    if (mine && mine.perms.includes('perm.manage') && !draft.get(mine.id).perms.has('perm.manage') && !await confirmBox('Anh/chị đang sửa quyền của chính chức vụ mình. Bỏ quyền "Quản lý phân quyền" sẽ không vào lại được trang này.', { ok: 'Vẫn lưu' })) return;
    e.target.disabled = true;
    let ok = 0;
    for (const p of list) {
      const d = draft.get(p.id);
      try { await api('/permissions/positions/' + encodeURIComponent(p.id), 'PUT', { perms: [...d.perms], dataScope: d.dataScope }); ok++; }
      catch (ex) { toast(`${p.name}: ${ex.message}`, 'err'); }
    }
    if (ok) toast(`Đã lưu quyền cho ${ok} chức vụ.`);
    await load();
  }

  // ---------------------------------------------------------------- phòng ban & chức vụ
  function drawOrg() {
    const wrap = el('div', 'perm-org');
    // Thêm phòng ban / chức vụ.
    const add = el('section', 'card perm-add');
    const fd = el('form', 'row-gap'), dn = el('input'); dn.placeholder = 'Tên phòng ban mới'; dn.maxLength = 60; dn.setAttribute('aria-label', 'Tên phòng ban mới');
    fd.append(dn, submit('＋ Phòng ban'));
    fd.addEventListener('submit', ev => { ev.preventDefault(); run(() => api('/permissions/departments', 'POST', { name: dn.value }), 'Đã thêm phòng ban.'); });
    const fp = el('form', 'row-gap'), pn = el('input'); pn.placeholder = 'Tên chức vụ mới (vd Trưởng phòng KD)'; pn.maxLength = 60; pn.setAttribute('aria-label', 'Tên chức vụ mới');
    const pd = select([['', 'Chưa xếp phòng'], ...data.departments.map(d => [d.id, d.name])], 'Phòng ban của chức vụ mới');
    const pc = select([['', 'Không chép quyền'], ...data.positions.filter(p => !p.system).map(p => [p.id, 'Chép quyền từ: ' + p.name])], 'Chép quyền từ chức vụ');
    fp.append(pn, pd, pc, submit('＋ Chức vụ'));
    fp.addEventListener('submit', ev => { ev.preventDefault(); run(() => api('/permissions/positions', 'POST', { name: pn.value, departmentId: pd.value || null, copyFrom: pc.value || undefined }), 'Đã thêm chức vụ – vào Bảng quyền để chỉnh quyền.'); });
    add.append(el('h2', 'card-title', 'Thêm mới'), fd, fp);
    wrap.append(add);
    for (const g of [...data.departments.map(d => ({ d, positions: data.positions.filter(p => p.departmentId === d.id) })), { d: null, positions: data.positions.filter(p => !p.departmentId) }]) {
      if (!g.d && !g.positions.length) continue;
      const card = el('section', 'card perm-dept-card'), top = el('div', 'perm-dept-head');
      top.append(el('h2', 'card-title', g.d ? g.d.name : 'Chưa xếp phòng'), el('span', 'muted small', `${g.positions.length} chức vụ`));
      if (g.d) top.append(el('span', 'spacer'),
        button('Đổi tên', 'btn ghost small', () => rename('phòng ban', g.d.name, n => api('/permissions/departments/' + encodeURIComponent(g.d.id), 'PUT', { name: n }))),
        button('Xoá', 'btn ghost small danger-text', async () => { if (await confirmBox(`Xoá phòng ban "${g.d.name}"? Chỉ xoá được khi không còn chức vụ nào.`, { title: 'Xoá phòng ban', ok: 'Xoá', danger: true })) run(() => api('/permissions/departments/' + encodeURIComponent(g.d.id), 'DELETE'), 'Đã xoá phòng ban.'); }));
      card.append(top);
      const ul = el('ul', 'perm-pos-list');
      for (const p of g.positions) {
        const li = el('li'), info = el('div');
        info.append(el('b', '', p.name), el('small', 'muted', `${p.members} người · ${data.scopes.find(s => s.key === p.dataScope)?.label || ''}${p.system ? ' · quyền cố định' : ''}`));
        const move = select([['', 'Chưa xếp phòng'], ...data.departments.map(d => [d.id, d.name])], 'Phòng ban của ' + p.name);
        move.value = p.departmentId || '';
        move.addEventListener('change', () => run(() => api('/permissions/positions/' + encodeURIComponent(p.id), 'PUT', { departmentId: move.value || null }), 'Đã chuyển phòng ban.'));
        const acts = el('div', 'row-gap');
        if (!p.system) {
          acts.append(move, button('Đổi tên', 'btn ghost small', () => rename('chức vụ', p.name, n => api('/permissions/positions/' + encodeURIComponent(p.id), 'PUT', { name: n }))));
          if (!p.builtIn) acts.append(button('Xoá', 'btn ghost small danger-text', async () => {
            if (await confirmBox(`Xoá chức vụ "${p.name}"? Chỉ xoá được khi không còn nhân viên nào giữ chức vụ này.`, { title: 'Xoá chức vụ', ok: 'Xoá chức vụ', danger: true })) run(() => api('/permissions/positions/' + encodeURIComponent(p.id), 'DELETE'), 'Đã xoá chức vụ.');
          }));
        } else acts.append(move);
        li.append(info, acts); ul.append(li);
      }
      if (!g.positions.length) ul.append(el('li', 'muted', 'Chưa có chức vụ.'));
      card.append(ul); wrap.append(card);
    }
    body.replaceChildren(wrap);
  }
  const submit = text => { const b = el('button', 'btn secondary', text); b.type = 'submit'; return b; };
  function select(options, label) { const s = el('select'); s.setAttribute('aria-label', label); for (const [v, t] of options) { const o = el('option', '', t); o.value = v; s.append(o); } return s; }
  async function run(fn, ok) { try { await fn(); toast(ok); await load(); } catch (e) { toast(e.message, 'err'); } }
  function rename(what, current, save) {
    const dlg = el('dialog', 'modal narrow'), f = el('form'), input = el('input');
    input.value = current; input.maxLength = 60; input.required = true; input.setAttribute('aria-label', 'Tên ' + what);
    const mb = el('div', 'modal-body'); mb.append(input);
    const foot = el('div', 'modal-foot'), ok = el('button', 'btn primary', 'Lưu'); ok.type = 'submit';
    foot.append(button('Huỷ', 'btn secondary', () => close()), ok);
    const mh = el('div', 'modal-head'); mh.append(el('h2', '', 'Đổi tên ' + what));
    f.append(mh, mb, foot); dlg.append(f); document.body.append(dlg);
    const close = () => { dlg.close(); dlg.remove(); };
    dlg.addEventListener('cancel', close);
    f.addEventListener('submit', ev => { ev.preventDefault(); close(); run(() => save(input.value), 'Đã đổi tên.'); });
    dlg.showModal(); input.select();
  }

  // ---------------------------------------------------------------- nhật ký
  function drawLog() {
    if (!data.log.length) { body.replaceChildren(el('p', 'muted card', 'Chưa có thay đổi phân quyền nào.')); return; }
    const wrap = el('div', 'table-wrap'), t = el('table', 'data-table'), hr = el('tr');
    for (const h of ['Thời gian', 'Người sửa', 'Thao tác', 'Chi tiết']) hr.append(el('th', '', h));
    const thead = el('thead'); thead.append(hr);
    const tb = el('tbody');
    for (const x of data.log) { const tr = el('tr'); tr.append(el('td', 'nowrap', when(x.at)), el('td', '', x.by || ''), el('td', '', x.action), el('td', '', x.detail)); tb.append(tr); }
    t.append(thead, tb); wrap.append(t); body.replaceChildren(wrap);
  }

  return { load, dirty: () => !!data && dirtyCount() > 0 };
}
