const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = String(text);
  return n;
};
const num = (value) =>
  Number(value).toLocaleString('vi-VN', { maximumFractionDigits: 3 });

/** Physical stock and reservations are separate; an unassigned hold never appears once per warehouse. */
export function stockLookupTable(product, mixed = false) {
  const wrap = el('div', 'table-wrap'),
    table = el('table', 'data-table lookup-stock-table');
  const head = el('thead'),
    titles = el('tr'),
    body = el('tbody');
  for (const label of ['Kho', 'Tồn kho', 'Hàng đang giữ'])
    titles.append(el('th', label === 'Kho' ? '' : 'right', label));
  head.append(titles);
  const known =
    product.held &&
    Number.isFinite(product.held.qty) &&
    Array.isArray(product.held.stock);
  for (const stock of product.stock) {
    const row = el('tr'),
      name = el('td', '', stock.warehouse);
    if (mixed)
      name.append(
        el(
          'small',
          'muted',
          stock.source === 'ledger'
            ? ' · sổ kho'
            : ' · Sapo (đồng bộ gần nhất)',
        ),
      );
    const qty = known
      ? (product.held.stock.find((h) => h.warehouseId === stock.warehouseId)
          ?.qty ?? 0)
      : null;
    row.append(
      name,
      el('td', 'right', num(stock.qty)),
      el('td', 'right', qty === null ? '—' : num(qty)),
    );
    body.append(row);
  }
  if (known && product.held.unassigned > 0) {
    const shared = el('tr');
    shared.append(
      el('td', '', 'Chưa gắn kho'),
      el('td', 'right muted', '—'),
      el('td', 'right', num(product.held.unassigned)),
    );
    body.append(shared);
  }
  const total = el('tr', 'lookup-stock-total');
  total.append(
    el('td', '', 'Tổng'),
    el('td', 'right', num(product.total)),
    el('td', 'right', known ? num(product.held.qty) : '—'),
  );
  body.append(total);
  table.append(head, body);
  wrap.append(table);
  if (known && product.held.unassigned > 0)
    wrap.append(
      el(
        'p',
        'muted small',
        'Hàng giữ chưa gắn kho gồm báo giá và chứng từ chưa chọn kho; chỉ tính một lần trong tổng.',
      ),
    );
  if (!known)
    wrap.append(
      el(
        'p',
        'muted small',
        'Chưa có số liệu hàng đang giữ. Tải lại trang để cập nhật.',
      ),
    );
  return wrap;
}
