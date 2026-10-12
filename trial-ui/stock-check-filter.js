/** Filter already-calculated results; missing stock data is shown only under All. */
export function bindStockCheckFilter(host) {
  const rows = [...host.querySelectorAll('tr[data-stock-result]')];
  const table = host.querySelector('.table-wrap');
  const toolbar = document.createElement('div'); toolbar.className = 'toolbar';
  const group = document.createElement('div'); group.className = 'chips'; group.setAttribute('role', 'group'); group.setAttribute('aria-label', 'Lọc kết quả kiểm tồn');
  toolbar.append(group);
  const empty = document.createElement('p'); empty.className = 'muted'; empty.hidden = true; empty.setAttribute('role', 'status');
  const buttons = [];
  for (const [key, label] of [['all', 'Tất cả'], ['enough', 'Đủ'], ['missing', 'Thiếu']]) {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'chip';
    const count = rows.filter(row => key === 'all' || row.dataset.stockResult === key).length;
    button.textContent = `${label} (${count})`;
    button.addEventListener('click', () => select(key, label));
    buttons.push({ key, button }); group.append(button);
  }
  function select(key, label) {
    let shown = 0;
    for (const row of rows) { row.hidden = key !== 'all' && row.dataset.stockResult !== key; if (!row.hidden) shown++; }
    for (const item of buttons) { const active = item.key === key; item.button.classList.toggle('active', active); item.button.setAttribute('aria-pressed', String(active)); }
    if (table) table.hidden = shown === 0;
    empty.hidden = shown !== 0; empty.textContent = `Không có sản phẩm trong bộ lọc “${label}”.`;
  }
  host.prepend(toolbar); host.append(empty); select('all', 'Tất cả');
}
