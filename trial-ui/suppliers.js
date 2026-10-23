import { initEarlyRequests } from './purchase-early-requests.js';
/**
 * DANH BẠ NHÀ CUNG CẤP (trang #/suppliers, chỉ Manager) – xem docs/NCC-PAGE.md mục "Quản lý NCC".
 * Danh sách + bảng sửa bên phải: thông tin NCC, email nhận đơn / CC, tài khoản NCC đăng nhập, ngừng / mở lại.
 * DOM dựng bằng createElement / textContent (không chèn chuỗi HTML). API: src/modules/suppliers/api/directory-routes.ts.
 */
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = String(text); return n; };
const FIELDS = [['name', 'Tên nhà cung cấp *', 180], ['taxCode', 'Mã số thuế', 40], ['phone', 'Điện thoại', 40], ['email', 'Email chung', 254], ['address', 'Địa chỉ', 1000], ['note', 'Ghi chú', 2000]];

export function initSuppliers({ api, root, toast, confirmBox, canLinkAccounts = () => true }) {
  let rows = [], current = null, candidates = null, req = 0;
  const page = el('div', 'sup-page');
  const head = el('div', 'page-head'), titles = el('div');
  titles.append(el('span', 'eyebrow', 'Mua hàng'), el('h1', '', 'Nhà cung cấp'), el('p', 'muted', 'Danh bạ NCC, email nhận đơn đặt hàng và tài khoản NCC đăng nhập (Manager và Kế toán). NCC đã có đơn không xoá được – chuyển "Ngừng hoạt động".'));
  const add = el('button', 'btn primary', '+ Thêm nhà cung cấp'); add.type = 'button'; add.addEventListener('click', () => openEditor(null));
  head.append(titles, add);
  const panel = el('div', 'panel'), bar = el('div', 'toolbar');
  const search = el('input'); search.type = 'search'; search.placeholder = 'Tìm tên, MST, điện thoại, email…'; search.setAttribute('aria-label', 'Tìm nhà cung cấp');
  const label = el('label', 'search'); label.append(search);
  const status = el('select'); for (const [v, t] of [['', 'Tất cả'], ['1', 'Đang hoạt động'], ['0', 'Ngừng hoạt động']]) { const o = el('option', '', t); o.value = v; status.append(o); }
  const countEl = el('span', 'muted small');
  bar.append(label, status, countEl);
  const wrap = el('div', 'table-wrap'), table = el('table', 'data-table'), thead = el('thead'), tbody = el('tbody');
  const hr = el('tr'); for (const h of ['Nhà cung cấp', 'MST', 'Liên hệ', 'Email nhận đơn', 'Tài khoản NCC', 'Đơn', 'Trạng thái']) hr.append(el('th', '', h));
  thead.append(hr); table.append(thead, tbody); wrap.append(table); panel.append(bar, wrap);
  page.append(head, panel);
  const shade = el('div', 'sup-shade'); shade.hidden = true; shade.addEventListener('click', () => closeEditor());
  const drawer = el('aside', 'sup-drawer'); drawer.hidden = true; drawer.setAttribute('role', 'dialog');
  root.append(page, shade, drawer);
  let timer = 0;
  search.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(load, 200); });
  status.addEventListener('change', load);

  function renderList() {
    tbody.replaceChildren();
    countEl.textContent = rows.length + ' nhà cung cấp';
    if (!rows.length) { const tr = el('tr'), td = el('td', 'muted', 'Chưa có nhà cung cấp nào.'); td.colSpan = 7; tr.append(td); tbody.append(tr); return; }
    for (const r of rows) {
      const tr = el('tr', 'clickable' + (r.active ? '' : ' is-off')); tr.tabIndex = 0;
      const name = el('td'); name.append(el('b', '', r.name)); if (r.address) name.append(el('small', 'muted sup-sub', r.address));
      const contact = el('td'); contact.append(el('span', '', r.phone || '—')); if (r.email) contact.append(el('small', 'muted sup-sub', r.email));
      tr.append(name, el('td', '', r.taxCode || '—'), contact, el('td', '', r.contacts ? r.contacts + ' email' : 'Chưa có'), el('td', '', r.accounts || '—'), el('td', '', r.orders || 0));
      const st = el('td'); st.append(el('span', 'sup-pill' + (r.active ? ' ok' : ''), r.active ? 'Đang hoạt động' : 'Ngừng hoạt động')); tr.append(st);
      const open = () => openEditor(r.id);
      tr.addEventListener('click', open); tr.addEventListener('keydown', e => { if (e.key === 'Enter') open(); });
      tbody.append(tr);
    }
  }

  async function load() {
    const id = ++req;
    try {
      const qs = new URLSearchParams({ q: search.value.trim(), active: status.value });
      const d = await api('/suppliers?' + qs); if (id !== req) return;
      rows = d.suppliers; renderList();
    } catch (e) { if (id === req) toast(e.message || 'Không tải được nhà cung cấp.', 'err'); }
  }

  // ---- Bảng sửa
  const closeEditor = () => { drawer.hidden = true; shade.hidden = true; current = null; };
  async function openEditor(id) {
    try {
      const [d, c] = await Promise.all([id ? api('/suppliers/' + encodeURIComponent(id)) : null, candidates || !canLinkAccounts() ? null : api('/supplier-account-candidates')]);
      if (c) candidates = c.accounts;
      current = d || { supplier: null, contacts: [], accounts: [], orders: 0 };
      renderEditor(); drawer.hidden = false; shade.hidden = false; drawer.querySelector('input')?.focus();
    } catch (e) { toast(e.message || 'Không mở được nhà cung cấp.', 'err'); }
  }

  function renderEditor() {
    const s = current.supplier || {}, isNew = !current.supplier;
    const top = el('div', 'sup-drawer-head'), t = el('div');
    t.append(el('span', 'eyebrow', isNew ? 'Thêm mới' : (s.active ? 'Đang hoạt động' : 'Ngừng hoạt động')), el('h2', '', isNew ? 'Nhà cung cấp mới' : s.name));
    const x = el('button', 'icon-btn', '×'); x.type = 'button'; x.setAttribute('aria-label', 'Đóng'); x.addEventListener('click', closeEditor);
    top.append(t, x);
    const form = el('form', 'sup-form'); form.noValidate = true;
    const grid = el('div', 'form-grid two');
    for (const [key, title, max] of FIELDS) {
      const l = el('label', key === 'address' || key === 'note' ? 'span-2' : ''); l.append(document.createTextNode(title));
      const inp = el(key === 'note' ? 'textarea' : 'input'); inp.name = key; inp.maxLength = max; inp.value = s[key] || ''; if (key === 'note') inp.rows = 2;
      l.append(inp); grid.append(l);
    }
    // Email nhận đơn (To) / CC
    const contacts = el('section', 'sup-section'), list = el('div', 'sup-contacts');
    contacts.append(el('h3', '', 'Email nhận đơn đặt hàng'), el('p', 'muted small', '"Nhận đơn" là người nhận chính khi gửi đơn mua; "CC" là đồng gửi (tối đa 20).'), list);
    const addRow = (c = { kind: 'order', name: '', email: '', phone: '' }) => {
      const row = el('div', 'sup-contact');
      const kind = el('select'); for (const [v, tx] of [['order', 'Nhận đơn'], ['cc', 'CC']]) { const o = el('option', '', tx); o.value = v; kind.append(o); } kind.value = c.kind; kind.name = 'kind';
      const nm = el('input'); nm.placeholder = 'Tên người liên hệ'; nm.value = c.name || ''; nm.name = 'cname'; nm.maxLength = 120;
      const em = el('input'); em.type = 'email'; em.placeholder = 'email@ncc.vn'; em.value = c.email || ''; em.name = 'cemail'; em.maxLength = 254;
      const ph = el('input'); ph.placeholder = 'Điện thoại'; ph.value = c.phone || ''; ph.name = 'cphone'; ph.maxLength = 40;
      const rm = el('button', 'icon-btn', '×'); rm.type = 'button'; rm.title = 'Bỏ email này'; rm.addEventListener('click', () => row.remove());
      row.append(kind, nm, em, ph, rm); list.append(row);
    };
    current.contacts.forEach(addRow);
    const addBtn = el('button', 'btn secondary small', '+ Thêm email'); addBtn.type = 'button'; addBtn.addEventListener('click', () => addRow());
    contacts.append(addBtn);
    // Tài khoản NCC
    const accounts = el('section', 'sup-section');
    accounts.append(el('h3', '', 'Tài khoản NCC đăng nhập'), el('p', 'muted small', 'Mời NCC tự nhập thông tin và đăng ký tài khoản. Link gắn sẵn đúng NCC này, dùng một lần trong 24 giờ. Tài khoản chỉ thấy đơn của NCC mình. Các tài khoản có sẵn vẫn gắn được bên dưới.'));
    const linked = new Set(current.accounts.map(a => a.id)), box = el('div', 'sup-accounts');
    if (!candidates?.length) box.append(el('p', 'muted small', 'Chưa có tài khoản chức vụ NCC nào.'));
    for (const a of candidates || []) {
      const l = el('label', 'sup-account'), cb = el('input'); cb.type = 'checkbox'; cb.value = a.id; cb.checked = linked.has(a.id); cb.name = 'account';
      const info = el('span'); info.append(el('b', '', a.name), el('small', 'muted', ' ' + (a.registrationPending ? 'Chờ tự đăng ký' : a.email) + (a.supplierId && a.supplierId !== s.id ? ` · đang gắn: ${a.supplierName}` : '')));
      l.append(cb, info); box.append(l);
    }
    accounts.append(box);
    if (!isNew && s.active && canLinkAccounts()) {
      const invite = el('button', 'btn primary small', 'Tạo tài khoản NCC · Lấy link đăng ký'); invite.type = 'button';
      const result = el('div', 'banner'); result.hidden = true;
      const note = el('p', 'small', 'Gửi riêng link này cho đúng NCC. Link đăng ký dùng một lần, hết hạn sau 24 giờ.');
      const row = el('div', 'copy-row'), url = el('input'), copy = el('button', 'btn secondary small', 'Chép link'); url.readOnly = true; url.setAttribute('aria-label', 'Link đăng ký NCC'); copy.type = 'button';
      copy.onclick = async () => { try { await navigator.clipboard.writeText(url.value); toast('Đã chép link đăng ký.'); } catch { url.select(); toast('Chọn và chép link trong ô.'); } };
      row.append(url, copy); result.append(note, row);
      invite.onclick = async () => {
        invite.disabled = true;
        try {
          const r = await api('/suppliers/' + encodeURIComponent(s.id) + '/invitations', 'POST', {});
          if (current?.supplier?.id !== s.id) return;
          url.value = r.url; result.hidden = false; candidates = null;
          const pending = { id: r.memberId, name: 'Chờ tự đăng ký', registrationPending: true };
          current.accounts.push(pending); linked.add(r.memberId); box.querySelector('p')?.remove();
          const l = el('label', 'sup-account'), cb = el('input'); cb.type = 'checkbox'; cb.name = 'account'; cb.value = r.memberId; cb.checked = true;
          l.append(cb, el('span', '', 'Chờ NCC tự đăng ký')); box.append(l); load();
        } catch (e) { toast(e.message, 'err'); } finally { invite.disabled = false; }
      };
      accounts.append(invite, result);
      for (const a of current.accounts.filter(a => a.registrationPending)) {
        const renew = el('button', 'btn secondary small', 'Cấp lại link đăng ký · ' + a.name); renew.type = 'button';
        renew.onclick = async () => {
          renew.disabled = true;
          try { const r = await api('/suppliers/' + encodeURIComponent(s.id) + '/invitations', 'POST', { memberId: a.id }); url.value = r.url; result.hidden = false; }
          catch (e) { toast(e.message, 'err'); } finally { renew.disabled = false; }
        };
        accounts.append(renew);
      }
    }

    if (isNew) accounts.append(el('p', 'muted small', 'Lưu nhà cung cấp trước rồi gắn tài khoản.'));
    const err = el('p', 'error'); err.setAttribute('role', 'alert');
    const foot = el('div', 'sup-drawer-foot');
    const save = el('button', 'btn primary', isNew ? 'Thêm nhà cung cấp' : 'Lưu thay đổi'); save.type = 'submit';
    foot.append(save);
    if (!isNew) {
      const toggle = el('button', 'btn secondary', s.active ? 'Ngừng hoạt động' : 'Mở lại'); toggle.type = 'button';
      toggle.addEventListener('click', async () => {
        if (s.active && !await confirmBox(`Ngừng hoạt động ${s.name}? Không tạo được đơn mua mới cho NCC này; đơn cũ giữ nguyên.`, { title: 'Ngừng hoạt động', ok: 'Ngừng hoạt động', danger: true })) return;
        await submit(!s.active);
      });
      foot.append(toggle);
    }
    form.append(grid, contacts, ...(canLinkAccounts() ? [accounts] : []), err, foot);
    if(!isNew&&current.canViewEarlyRequests){const history=el('section','sup-section early-request-history');form.append(history);initEarlyRequests({api,host:history,supplierId:s.id}).load();}
    form.addEventListener('submit', e => { e.preventDefault(); submit(); });
    async function submit(active) {
      err.textContent = ''; save.disabled = true;
      try {
        const v = k => form.elements[k].value;
        const body = Object.fromEntries(FIELDS.map(([k]) => [k, v(k)]));
        body.contacts = [...list.children].map(r => ({ kind: r.querySelector('[name=kind]').value, name: r.querySelector('[name=cname]').value, email: r.querySelector('[name=cemail]').value, phone: r.querySelector('[name=cphone]').value }))
          .filter(c => c.email.trim() || c.name.trim() || c.phone.trim());
        if (!body.name.trim()) throw new Error('Cần nhập tên nhà cung cấp.');
        let d;
        if (isNew) d = await api('/suppliers', 'POST', body);
        else {
          d = await api('/suppliers/' + encodeURIComponent(s.id), 'PUT', { ...body, updatedAt: s.updatedAt, ...(active !== undefined ? { active } : {}) });
          const want = [...form.querySelectorAll('[name=account]:checked')].map(c => c.value).sort(), had = [...linked].sort();
          if (canLinkAccounts() && want.join() !== had.join()) { d = await api('/suppliers/' + encodeURIComponent(s.id) + '/accounts', 'PUT', { memberIds: want }); candidates = null; }
        }
        toast(isNew ? 'Đã thêm nhà cung cấp.' : 'Đã lưu nhà cung cấp.');
        if (!candidates && canLinkAccounts()) candidates = (await api('/supplier-account-candidates')).accounts;
        current = d; renderEditor(); load();
      } catch (e2) { err.textContent = e2.message || 'Không lưu được.'; save.disabled = false; }
    }
    drawer.replaceChildren(top, form);
  }
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !drawer.hidden) closeEditor(); });
  return { load, openNew: () => openEditor(null), open: openEditor };
}
