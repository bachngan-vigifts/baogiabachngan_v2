// Advisory only: do not block quotations or change their product/price data.
const keyOf = sku => String(sku || '').trim().toUpperCase();
export function quoteShortages(rows, products, available, skuOf) {
  const needs = new Map(), result = new Map();
  for (const row of rows) {
    const key = keyOf(skuOf(row)), qty = Number(row.qty);
    if (key && Number.isFinite(qty) && qty > 0) needs.set(key, (needs.get(key) || 0) + qty);
  }
  for (const [sku, qty] of needs) {
    const product = products.get(sku), stock = product ? available(product) : null;
    if (typeof stock === 'number' && Number.isFinite(stock) && qty > Math.max(0, stock))
      result.set(sku, { qty, available: Math.max(0, stock), shortage: qty - Math.max(0, stock) });
  }
  return result;
}
export function initQuoteStockWarnings({ root, getRows, skuOf, fetchProducts, ensureHolds, available, format = String, now = Date.now }) {
  const cache = new Map();
  let timer, loading = false, retryAt = 0;
  const paint = () => {
    const rows = getRows(), products = new Map([...cache].filter(([, v]) => v.product).map(([k, v]) => [k, v.product]));
    const warnings = quoteShortages(rows, products, available, skuOf);
    for (const badge of root.querySelectorAll('[data-stock-warning]')) {
      const row = rows[Number(badge.closest('tr[data-i]').dataset.i)], warning = row && warnings.get(keyOf(skuOf(row)));
      badge.hidden = !warning;
      const label = warning ? `Vượt tồn có thể bán: tổng ${format(warning.qty)}, có thể bán ${format(warning.available)}, thiếu ${format(warning.shortage)}. Bấm Tồn kho · Lịch sử để xem chi tiết.` : '';
      badge.title = label; badge.setAttribute('aria-label', label);
    }
  };
  const refresh = () => {
    paint();
    clearTimeout(timer);
    if (!getRows().some(row => skuOf(row))) return;
    Promise.resolve(ensureHolds()).then(paint).catch(() => {});
    if (loading || now() < retryAt) return;
    const missing = [...new Map(getRows().map(row => [keyOf(skuOf(row)), String(skuOf(row) || '').trim()])).entries()]
      .filter(([key]) => key && (!cache.has(key) || now() - cache.get(key).at > 60000));
    if (!missing.length) return;
    timer = setTimeout(async () => {
      loading = true;
      try {
        const found = [];
        for (let i = 0; i < missing.length; i += 200) found.push(...await fetchProducts(missing.slice(i, i + 200).map(([, sku]) => sku)));
        const products = new Map(found.map(p => [keyOf(p.sku), p]));
        for (const [key] of missing) cache.set(key, { at: now(), product: products.get(key) || null });
        retryAt = 0;
      } catch { retryAt = now() + 10000; } // Keep typing usable; never interpret a failed lookup as zero stock.
      finally { loading = false; paint(); refresh(); }
    }, 120);
  };
  return { refresh };
}
