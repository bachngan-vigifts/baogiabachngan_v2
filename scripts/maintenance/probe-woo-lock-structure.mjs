// Đọc cấu trúc cửa hàng WooCommerce Web Lock qua REST API (chỉ GET, không ghi gì).
// Không in thông tin khách hàng/đơn hàng: phần đơn chỉ lấy số lượng theo trạng thái và tên trường.
// Không in khoá/secret: cổng thanh toán chỉ lấy id/tên/bật-tắt, webhook chỉ lấy host nhận.
import { writeFileSync } from 'node:fs';

const raw = (process.env.WC_BASE_URL || '').trim().replace(/\/+$/, '');
const key = process.env.WC_CONSUMER_KEY || '';
const secret = process.env.WC_CONSUMER_SECRET || '';
if (!raw || !key || !secret) throw new Error('Thiếu WC_BASE_URL / WC_CONSUMER_KEY / WC_CONSUMER_SECRET');
const base = raw.replace(/\/wp-json.*$/, '') + '/wp-json/wc/v3';
let useQueryAuth = false;

async function get(path, params = {}) {
  const url = new URL(base + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  const headers = { Accept: 'application/json', 'User-Agent': 'store-structure-probe' };
  if (useQueryAuth) { url.searchParams.set('consumer_key', key); url.searchParams.set('consumer_secret', secret); }
  else headers.Authorization = 'Basic ' + Buffer.from(`${key}:${secret}`).toString('base64');
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(60_000) });
  if (res.status === 401 && !useQueryAuth) { useQueryAuth = true; return get(path, params); }
  const text = await res.text();
  let body; try { body = JSON.parse(text); } catch { body = text.slice(0, 200); }
  if (!res.ok) return { ok: false, status: res.status, error: body?.code || body?.message || body };
  return { ok: true, body, total: Number(res.headers.get('x-wp-total') ?? NaN), pages: Number(res.headers.get('x-wp-totalpages') ?? NaN) };
}
async function all(path, params = {}, max = 20) {
  const out = []; let page = 1;
  for (;;) {
    const r = await get(path, { ...params, per_page: 100, page });
    if (!r.ok) return out.length ? out : r;
    out.push(...r.body);
    if (!Array.isArray(r.body) || r.body.length < 100 || page >= max || page >= (r.pages || 1)) return out;
    page++;
  }
}
const pick = (o, ks) => Object.fromEntries(ks.filter(k => k in (o || {})).map(k => [k, o[k]]));
const hostOf = u => { try { return new URL(u).host; } catch { return null; } };
const metaKeys = list => [...new Set(list.flatMap(p => (p.meta_data || []).map(m => m.key)))].sort();
const safe = async (name, fn) => { try { return await fn(); } catch (e) { return { ok: false, error: String(e?.message || e) }; } };

const report = { readAt: new Date().toISOString(), apiHost: hostOf(base) };

report.system = await safe('system', async () => {
  const r = await get('/system_status');
  if (!r.ok) return r;
  const e = r.body.environment || {}, t = r.body.theme || {}, s = r.body.settings || {};
  return {
    wcVersion: e.version, wpVersion: e.wp_version, phpVersion: e.php_version, multisite: e.wp_multisite,
    theme: pick(t, ['name', 'version', 'is_child_theme', 'parent_name']),
    currency: s.currency, currencySymbol: s.currency_symbol, thousandSep: s.thousand_separator, decimalSep: s.decimal_separator, decimals: s.number_of_decimals,
    activePlugins: (r.body.active_plugins || []).map(p => `${p.name} ${p.version}`),
  };
});
report.settingsGeneral = await safe('settings', async () => {
  const r = await get('/settings/general');
  if (!r.ok) return r;
  const want = ['woocommerce_default_country', 'woocommerce_currency', 'woocommerce_calc_taxes', 'woocommerce_enable_coupons', 'woocommerce_price_num_decimals', 'woocommerce_specific_allowed_countries'];
  return Object.fromEntries(r.body.filter(x => want.includes(x.id)).map(x => [x.id, x.value]));
});

const cats = await all('/products/categories');
report.categories = Array.isArray(cats) ? { count: cats.length, items: cats.map(c => pick(c, ['id', 'name', 'slug', 'parent', 'count', 'display'])) } : cats;
const tags = await get('/products/tags', { per_page: 1 });
report.tags = tags.ok ? { count: tags.total } : tags;
const brands = await get('/products/brands', { per_page: 100 });
report.brands = brands.ok ? { count: brands.total, items: brands.body.map(b => pick(b, ['id', 'name', 'slug', 'count'])) } : { ok: false, status: brands.status };

const attrs = await get('/products/attributes');
if (attrs.ok) {
  report.attributes = [];
  for (const a of attrs.body) {
    const terms = await all(`/products/attributes/${a.id}/terms`, {}, 5);
    report.attributes.push({ ...pick(a, ['id', 'name', 'slug', 'type', 'order_by', 'has_archives']), termCount: Array.isArray(terms) ? terms.length : null, terms: Array.isArray(terms) ? terms.slice(0, 40).map(t => t.name) : terms });
  }
} else report.attributes = attrs;

const counts = {};
for (const [label, params] of Object.entries({
  all: { status: 'any' }, publish: { status: 'publish' }, draft: { status: 'draft' }, private: { status: 'private' },
  simple: { type: 'simple', status: 'any' }, variable: { type: 'variable', status: 'any' }, grouped: { type: 'grouped', status: 'any' }, external: { type: 'external', status: 'any' },
  instock: { stock_status: 'instock' }, outofstock: { stock_status: 'outofstock' }, onbackorder: { stock_status: 'onbackorder' },
})) { const r = await get('/products', { ...params, per_page: 1 }); counts[label] = r.ok ? r.total : `lỗi ${r.status}`; }
report.productCounts = counts;

const sample = await get('/products', { per_page: 20, status: 'any', orderby: 'date', order: 'desc' });
if (sample.ok) {
  const p = sample.body;
  report.productShape = {
    fields: Object.keys(p[0] || {}).sort(),
    metaKeys: metaKeys(p),
    skuFilled: p.filter(x => x.sku).length + '/' + p.length,
    manageStock: p.filter(x => x.manage_stock).length + '/' + p.length,
    withWeight: p.filter(x => x.weight).length + '/' + p.length,
    withDimensions: p.filter(x => x.dimensions?.length).length + '/' + p.length,
    imagesAvg: +(p.reduce((s, x) => s + (x.images?.length || 0), 0) / (p.length || 1)).toFixed(1),
    examples: p.slice(0, 5).map(x => ({ ...pick(x, ['id', 'name', 'slug', 'type', 'status', 'sku', 'price', 'regular_price', 'sale_price', 'stock_status', 'stock_quantity', 'manage_stock', 'weight']), categories: x.categories?.map(c => c.name), attributes: x.attributes?.map(a => `${a.name}${a.variation ? ' (biến thể)' : ''}: ${a.options?.length ?? 0} giá trị`), images: x.images?.length || 0, variations: x.variations?.length || 0 })),
  };
}
const variable = await get('/products', { type: 'variable', per_page: 3, status: 'any' });
if (variable.ok && variable.body[0]) {
  const v = await get(`/products/${variable.body[0].id}/variations`, { per_page: 5 });
  report.variationShape = v.ok ? { parent: pick(variable.body[0], ['id', 'name', 'sku']), fields: Object.keys(v.body[0] || {}).sort(), metaKeys: metaKeys(v.body), examples: v.body.slice(0, 3).map(x => ({ ...pick(x, ['id', 'sku', 'price', 'stock_status', 'stock_quantity', 'manage_stock']), attributes: x.attributes?.map(a => `${a.name}=${a.option}`) })) } : v;
}

const totals = await get('/reports/orders/totals');
report.orderStatusCounts = totals.ok ? Object.fromEntries(totals.body.map(x => [x.slug, x.total])) : totals;
const oneOrder = await get('/orders', { per_page: 1 });
report.orderShape = oneOrder.ok ? { total: oneOrder.total, fields: Object.keys(oneOrder.body[0] || {}).sort(), metaKeys: metaKeys(oneOrder.body), lineItemFields: Object.keys(oneOrder.body[0]?.line_items?.[0] || {}).sort(), shippingLineMethods: (oneOrder.body[0]?.shipping_lines || []).map(s => s.method_id), paymentMethod: oneOrder.body[0]?.payment_method } : oneOrder;
const customers = await get('/customers', { per_page: 1, role: 'all' });
report.customerCount = customers.ok ? customers.total : { ok: false, status: customers.status };
const coupons = await get('/coupons', { per_page: 1 });
report.couponCount = coupons.ok ? coupons.total : { ok: false, status: coupons.status };

const gw = await get('/payment_gateways');
report.paymentGateways = gw.ok ? gw.body.map(g => pick(g, ['id', 'title', 'enabled', 'method_title'])) : gw;
const zones = await get('/shipping/zones');
if (zones.ok) {
  report.shippingZones = [];
  for (const z of zones.body) {
    const m = await get(`/shipping/zones/${z.id}/methods`);
    report.shippingZones.push({ id: z.id, name: z.name, methods: m.ok ? m.body.map(x => `${x.method_id}: ${x.title}${x.enabled ? '' : ' (tắt)'}`) : m });
  }
} else report.shippingZones = zones;
const taxes = await get('/taxes/classes');
report.taxClasses = taxes.ok ? taxes.body.map(t => t.name) : taxes;
const hooks = await get('/webhooks', { per_page: 100 });
report.webhooks = hooks.ok ? hooks.body.map(h => ({ ...pick(h, ['id', 'name', 'status', 'topic']), deliveryHost: hostOf(h.delivery_url) })) : hooks;
report.authMode = useQueryAuth ? 'query' : 'basic-header';

writeFileSync('woo-lock-structure.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
