/**
 * Khung giao diện dùng chung cho nhóm Mua hàng (Đơn mua NCC, Lấy hàng trước, Nhận hàng):
 * đầu trang với một nút chính + menu "Thêm", hàng ô số đếm để lọc nhanh, ô tìm + bộ lọc gập,
 * nhãn trạng thái và ngăn chi tiết bên phải (có thanh bước, một nút chính, thao tác khác, nút huỷ).
 */
export const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = String(text); return n; };
const button = (label, cls, onClick) => { const b = el('button', cls, label); b.type = 'button'; if (onClick) b.addEventListener('click', onClick); return b; };

/** Ngày yyyy-mm-dd → dd/mm/yyyy. */
export const buyDate = iso => iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '';
/** Khoảng cách tới ngày hẹn so với hôm nay (yyyy-mm-dd): "Hôm nay", "Còn 2 ngày", "Trễ 3 ngày". */
export function buyDueText(iso, today) {
  if (!iso || !today) return '';
  const days = Math.round((Date.parse(iso.slice(0, 10) + 'T00:00:00Z') - Date.parse(today.slice(0, 10) + 'T00:00:00Z')) / 864e5);
  return days === 0 ? 'Hôm nay' : days === 1 ? 'Ngày mai' : days > 0 ? `Còn ${days} ngày` : `Trễ ${-days} ngày`;
}
export const buyNum = n => Number(n || 0).toLocaleString('vi-VN');

/** Nhãn trạng thái: tone = grey | amber | blue | green | red. */
export function buyBadge(text, tone = 'grey') { return el('span', 'buy-badge buy-' + tone, text); }

/** Menu thả xuống; items: [{label, hint, onClick, danger, hidden}]. */
export function buyMenu(label, items, { up = false } = {}) {
  const wrap = el('div', 'buy-menu'), toggle = button(label, 'btn secondary'), list = el('div', 'buy-menu-list' + (up ? ' up' : ''));
  toggle.setAttribute('aria-haspopup', 'true'); toggle.setAttribute('aria-expanded', 'false'); list.hidden = true; list.setAttribute('role', 'menu');
  const close = () => { list.hidden = true; toggle.setAttribute('aria-expanded', 'false'); };
  for (const item of items.filter(i => i && !i.hidden)) {
    const b = button('', 'buy-menu-item' + (item.danger ? ' danger' : ''), () => { close(); item.onClick?.(); });
    b.setAttribute('role', 'menuitem'); b.append(el('b', '', item.label)); if (item.hint) b.append(el('small', '', item.hint)); list.append(b);
  }
  toggle.addEventListener('click', e => { e.stopPropagation(); const open = list.hidden; document.dispatchEvent(new CustomEvent('buy-menu-open', { detail: wrap })); list.hidden = !open; toggle.setAttribute('aria-expanded', String(open)); if (open) list.querySelector('button')?.focus(); });
  document.addEventListener('buy-menu-open', e => { if (e.detail !== wrap) close(); });
  document.addEventListener('click', e => { if (!wrap.contains(e.target)) close(); });
  wrap.addEventListener('keydown', e => { if (e.key === 'Escape' && !list.hidden) { e.stopPropagation(); close(); toggle.focus(); } });
  wrap.append(toggle, list); wrap.hidden = !list.children.length; return { node: wrap, toggle, list, close };
}

/** Đầu trang. primary: {label, onClick} hoặc null; more: mục cho menu "Thêm". */
export function buyHead({ eyebrow, title, desc, primary = null, more = [] }) {
  const head = el('div', 'page-head buy-head'), titles = el('div'), actions = el('div', 'buy-actions');
  titles.append(el('span', 'eyebrow', eyebrow), el('h1', '', title)); if (desc) titles.append(el('p', 'muted', desc));
  const visible = more.filter(i => i && !i.hidden);
  // Một thao tác phụ thì hiện thẳng nút, từ hai thao tác trở lên mới gom vào menu "Thêm".
  const menu = visible.length > 1 ? buyMenu('Thêm ▾', visible) : null; if (menu) actions.append(menu.node);
  if (visible.length === 1) actions.append(button(visible[0].label, 'btn secondary', visible[0].onClick));
  let primaryButton = null; if (primary) { primaryButton = button(primary.label, 'btn primary', primary.onClick); actions.append(primaryButton); }
  head.append(titles, actions); return { node: head, primary: primaryButton, menu };
}

/** Hàng ô số đếm. defs: [{key,label,tone}]; update({key:count}, activeKey). */
export function buyKpis(defs, onPick) {
  const node = el('div', 'buy-kpis'), cards = new Map(); node.setAttribute('role', 'group'); node.setAttribute('aria-label', 'Lọc nhanh theo trạng thái');
  for (const d of defs) {
    const b = button('', 'buy-kpi' + (d.tone ? ' ' + d.tone : ''), () => onPick(d.key)), label = el('span', '', d.label), count = el('b', '', '–');
    b.dataset.key = d.key; b.setAttribute('aria-pressed', 'false'); b.append(label, count); if (d.sub) b.append(el('small', '', d.sub)); node.append(b); cards.set(d.key, { b, count });
  }
  return { node, update(counts, active) { for (const [key, c] of cards) { c.count.textContent = counts && counts[key] != null ? buyNum(counts[key]) : '–'; c.b.setAttribute('aria-pressed', String(key === active)); } } };
}

/** Ô tìm + nút "Bộ lọc" mở/gập phần lọc chi tiết. fields: [[nhãn, control]]. */
export function buyTools({ placeholder, fields = [], onSearch, onClear }) {
  const node = el('div', 'buy-tools'), row = el('div', 'buy-tools-row'), search = el('input', 'buy-search'), toggle = button('Bộ lọc', 'buy-filter-toggle');
  search.type = 'search'; search.placeholder = placeholder; search.setAttribute('aria-label', placeholder);
  const panel = el('div', 'buy-filters'); panel.hidden = true;
  for (const [label, control] of fields) { const l = el('label', '', label); l.append(control); panel.append(l); }
  const clear = button('Xoá bộ lọc', 'btn ghost small', () => onClear?.()); if (onClear) panel.append(clear);
  toggle.setAttribute('aria-expanded', 'false'); toggle.addEventListener('click', () => { panel.hidden = !panel.hidden; toggle.setAttribute('aria-expanded', String(!panel.hidden)); });
  let timer; search.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => onSearch?.(search.value), 250); });
  row.append(search); if (fields.length) row.append(toggle); node.append(row, panel);
  return { node, search, panel, toggle, setActive(n) { toggle.textContent = n ? `Bộ lọc · ${n}` : 'Bộ lọc'; toggle.classList.toggle('on', !!n); } };
}

/** Ngăn chi tiết bên phải dựng trên <dialog> (khoá nền, Esc để đóng, giữ focus). */
export function buyDrawer() {
  const d = el('dialog', 'buy-drawer'); d.setAttribute('aria-label', 'Chi tiết');
  d.addEventListener('click', e => { if (e.target === d) d.close(); });
  d.addEventListener('close', () => d.replaceChildren());
  const ensure = () => { if (!d.isConnected) document.body.append(d); };
  /** spec: {eyebrow,title,badges,steps:[{label,state}],body:[node],primary:{label,onClick,href},more:[...],danger:{label,onClick},note} */
  function open(spec) {
    ensure(); d.replaceChildren();
    const head = el('header', 'buy-d-head'), top = el('div', 'buy-d-top'), titles = el('div'), close = button('✕', 'btn ghost buy-d-close', () => d.close());
    close.setAttribute('aria-label', 'Đóng'); titles.append(el('span', 'eyebrow', spec.eyebrow || ''), el('h2', '', spec.title || '')); top.append(titles, close); head.append(top);
    if (spec.badges?.length) { const b = el('div', 'buy-d-badges'); b.append(...spec.badges); head.append(b); }
    d.append(head);
    if (spec.steps?.length) {
      const steps = el('ol', 'buy-steps'); steps.setAttribute('aria-label', 'Tiến trình');
      spec.steps.forEach((s, i) => { const li = el('li', 'buy-step' + (s.state ? ' ' + s.state : '')), dot = el('i', '', s.state === 'done' ? '✓' : String(i + 1)); li.append(dot, el('span', '', s.label)); if (s.state === 'now') li.setAttribute('aria-current', 'step'); steps.append(li); });
      d.append(steps);
    }
    const body = el('div', 'buy-d-body'); body.append(...(spec.body || []).filter(Boolean)); d.append(body);
    const foot = el('footer', 'buy-d-foot'), left = el('div', 'buy-d-left');
    const more = (spec.more || []).filter(i => i && !i.hidden);
    if (more.length) left.append(buyMenu('Thao tác khác ▾', more, { up: true }).node);
    if (spec.danger) left.append(button(spec.danger.label, 'btn ghost buy-danger', spec.danger.onClick));
    foot.append(left);
    if (spec.primary) {
      if (spec.primary.href) { const a = el('a', 'btn primary', spec.primary.label); a.href = spec.primary.href; a.addEventListener('click', () => d.close()); foot.append(a); }
      else foot.append(button(spec.primary.label, 'btn primary', spec.primary.onClick));
    } else if (spec.note) foot.append(el('span', 'muted small', spec.note));
    d.append(foot);
    if (!d.open) d.showModal();
    (foot.querySelector('.btn.primary') || close).focus();
    return d;
  }
  return { open, close: () => d.open && d.close(), node: d, get isOpen() { return d.open; } };
}

/** Khối nội dung trong ngăn chi tiết. */
export function buySection(title, ...children) { const s = el('section', 'buy-sec'); if (title) s.append(el('h3', '', title)); s.append(...children.filter(Boolean)); return s; }
export function buyFacts(pairs) { const g = el('dl', 'buy-facts'); for (const [k, v] of pairs.filter(Boolean)) { const div = el('div'); div.append(el('dt', '', k)); const dd = el('dd'); if (v instanceof Node) dd.append(v); else dd.textContent = v == null || v === '' ? '—' : String(v); div.append(dd); g.append(div); } return g; }
export function buyCallout(text, tone = 'info') { return el('p', 'buy-callout ' + tone, text); }
export function buyProgress(done, total) { const bar = el('div', 'buy-bar'), fill = el('i'); fill.style.width = (total > 0 ? Math.min(100, done / total * 100) : 0) + '%'; bar.append(fill); bar.setAttribute('role', 'progressbar'); bar.setAttribute('aria-valuenow', String(done)); bar.setAttribute('aria-valuemax', String(total)); return bar; }
