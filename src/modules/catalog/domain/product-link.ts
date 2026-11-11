/**
 * TẠO NHANH SẢN PHẨM TỪ LINK – hàm thuần đọc trang sản phẩm website ngoài (không gọi mạng):
 *  - JSON-LD `Product` (tên, SKU, ảnh, thương hiệu, giá + đơn vị tiền);
 *  - nhận dạng nền tảng để API đọc thêm nguồn chuẩn: Sapo (`/products/{alias}.js`), Haravan / Shopify (`/products/{handle}.json`),
 *    WooCommerce (Store API theo slug);
 *  - dự phòng: thẻ og:title / og:image, "Mã:" / SKU trên trang, thẻ meta giá.
 * Chỉ để ĐIỀN SẴN biểu mẫu "Thêm sản phẩm"; người dùng kiểm tra, nhập giá bắt buộc rồi lưu như thường.
 */
export interface LinkProduct {
  name: string; sku: string; brand: string; imageUrl: string;
  /** Giá niêm yết trên web (VNĐ, thường đã gồm VAT); null = website không công khai giá. */
  price: number | null; currency: string; platform: 'json-ld' | 'sapo' | 'haravan' | 'woocommerce' | 'page';
}
export interface PageHints { platform: 'sapo' | 'haravan' | 'woocommerce' | 'other'; sapoAlias?: string; haravanJson?: string; wooSlug?: string }

export const plainText = (v: unknown) => String(v ?? '').replace(/<[^>]*>/g, ' ').replace(/&#(\d+);/g, (_, n) => { const cp = Number(n); return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : ''; })
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => { const cp = parseInt(n, 16); return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : ''; })
  .replaceAll('&amp;', '&').replaceAll('&quot;', '"').replaceAll('&#39;', "'").replaceAll('&nbsp;', ' ').replaceAll('&lt;', '<').replaceAll('&gt;', '>').replace(/\s+/g, ' ').trim();

export function metaContent(html: string, key: string): string {
  for (const tag of html.match(/<meta\b[^>]*>/gi) || []) {
    const attrs = Object.fromEntries([...tag.matchAll(/([\w:-]+)\s*=\s*(["'])([\s\S]*?)\2/g)].map(m => [m[1]!.toLowerCase(), m[3]!]));
    if (attrs.property === key || attrs.name === key || attrs.itemprop === key) return plainText(attrs.content);
  }
  return '';
}

/** Tên VIẾT HOA toàn bộ → chữ thường viết hoa chữ đầu; giữ mã (chữ + số) và tên thương hiệu. */
export function tidyName(raw: string, brand = ''): string {
  const name = plainText(raw).slice(0, 500);
  if (name !== name.toUpperCase() || !/[A-ZÀ-Ỹ]{3}/.test(name)) return name;
  const lower = name.split(' ').map(w => /\d/.test(w) && /[A-Z]/.test(w) && !/^\d+(ML|L|G|KG|CM|MM)$/i.test(w) ? w : w.toLocaleLowerCase('vi')).join(' ');
  const named = brand && brand.length > 2 ? lower.replace(new RegExp('(^|\\s)' + brand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?=\\s|$)', 'gi'), (_m, sp) => sp + brand) : lower;
  return named.charAt(0).toLocaleUpperCase('vi') + named.slice(1);
}

/** SKU theo luật CRM (chữ, số, . _ - / khoảng trắng; ≤ 64): bỏ ký tự lạ, rỗng nếu không còn gì. */
export function crmSku(raw: string): string {
  const s = plainText(raw).replace(/[^A-Za-z0-9._\-/ ]+/g, '').replace(/\s+/g, ' ').trim().replace(/^[^A-Za-z0-9]+/, '').slice(0, 64).trim();
  return /^[A-Za-z0-9][A-Za-z0-9._\-/ ]{0,63}$/.test(s) ? s : '';
}

const money = (v: unknown) => { const n = typeof v === 'number' ? v : Number(String(v ?? '').replace(/[^\d.]/g, '')); return Number.isFinite(n) && n > 0 && n <= 1e12 ? Math.round(n) : null; };

function jsonLdObjects(html: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const s of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { const queue: unknown[] = [JSON.parse(s[1]!)]; while (queue.length && out.length < 300) { const it = queue.shift(); if (Array.isArray(it)) queue.push(...it); else if (it && typeof it === 'object') { out.push(it as Record<string, unknown>); const g = (it as Record<string, unknown>)['@graph']; if (g) queue.push(g); } } } catch { /* JSON-LD lỗi: bỏ qua khối này */ }
  }
  return out;
}

/** Đọc trang HTML: dữ liệu có sẵn + gợi ý nền tảng. */
export function parseProductPage(html: string, url: URL): { product: LinkProduct; hints: PageHints } {
  const site = metaContent(html, 'og:site_name'), host = url.hostname.replace(/^www\./, '').split('.')[0] || '';
  const siteBrand = site && !/^https?:\/\//i.test(site) && !/\.[a-z]{2,}\/?$/i.test(site) ? site.slice(0, 200) : host.charAt(0).toUpperCase() + host.slice(1);
  const ld = jsonLdObjects(html).find(o => String(o['@type']).split(',').map(x => x.trim()).includes('Product'));
  const offerRaw = ld ? (Array.isArray(ld.offers) ? ld.offers[0] : ld.offers) : null, offer = (offerRaw && typeof offerRaw === 'object' ? offerRaw : {}) as Record<string, unknown>;
  const ldBrand = ld ? plainText(typeof ld.brand === 'object' && ld.brand ? (ld.brand as Record<string, unknown>).name : ld.brand) : '';
  const brand = (ldBrand || siteBrand).slice(0, 200);
  const photo = ld ? (Array.isArray(ld.image) ? ld.image[0] : ld.image) : null;
  const ldImage = typeof photo === 'string' ? photo : photo && typeof photo === 'object' ? String((photo as Record<string, unknown>).url || '') : '';
  const page = plainText(html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' '));
  const skuOnPage = page.match(/(?:Mã(?: sản phẩm| SP| hàng)?|SKU|Model)\s*[:#]\s*([A-Z0-9][A-Z0-9.\-/_]{2,40})/i)?.[1] || '';
  const name = ld ? plainText(ld.name) : metaContent(html, 'og:title') || plainText(html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1]);
  const metaPrice = money(metaContent(html, 'product:price:amount') || metaContent(html, 'og:price:amount'));
  const currency = String(offer.priceCurrency || metaContent(html, 'product:price:currency') || metaContent(html, 'og:price:currency') || '').toUpperCase();
  let image = ldImage || metaContent(html, 'og:image');
  try { image = image ? new URL(image, url).href : ''; } catch { image = ''; }
  const product: LinkProduct = { name: tidyName(name, brand), sku: crmSku(ld ? String(ld.sku || ld.mpn || '') || skuOnPage : skuOnPage), brand, imageUrl: /^https:\/\//i.test(image) ? image : '',
    price: money(offer.price ?? (offer as Record<string, unknown>).lowPrice) ?? metaPrice, currency, platform: ld ? 'json-ld' : 'page' };
  const parts = url.pathname.split('/').filter(Boolean), last = decodeURIComponent(parts.at(-1) || '').replace(/\.html?$/, '');
  const hints: PageHints = /\bBizweb\.(?:store|template)\s*=|\.mysapo\.net|sapo\.vn\/assets/i.test(html) ? { platform: 'sapo', sapoAlias: /^[a-z0-9_-]+$/i.test(last) ? last : undefined }
    : /hstatic\.net|haravan|cdn\.shopify|Shopify\.shop/i.test(html) && parts[0] === 'products' && parts.length === 2 ? { platform: 'haravan', haravanJson: new URL('/products/' + parts[1] + '.json', url).href }
    : /wp-json|woocommerce/i.test(html) && last ? { platform: 'woocommerce', wooSlug: last } : { platform: 'other' };
  return { product, hints };
}

/** Sapo `/products/{alias}.js` → giá variant thấp nhất còn bán (giá gốc nếu có giá so sánh). */
export function fromSapoJson(data: Record<string, unknown>, base: LinkProduct): LinkProduct {
  const variants = Array.isArray(data.variants) ? data.variants as Record<string, unknown>[] : [];
  const v = [...variants].filter(x => x.available !== false).sort((a, b) => Number(a.price) - Number(b.price))[0] || variants[0] || {};
  const images = Array.isArray(data.images) ? data.images : [], img = typeof images[0] === 'string' ? images[0] : (images[0] as Record<string, unknown> | undefined)?.src;
  return { ...base, name: tidyName(String(data.name || data.title || base.name), base.brand), sku: crmSku(String(v.sku || '')) || base.sku,
    price: money(Number(v.compare_at_price) > Number(v.price) ? v.compare_at_price : v.price) ?? base.price, currency: base.currency || 'VND',
    imageUrl: typeof img === 'string' && img ? (img.startsWith('//') ? 'https:' + img : img) : base.imageUrl, platform: 'sapo' };
}
/** Haravan / Shopify `/products/{handle}.json`. */
export function fromHaravanJson(data: Record<string, unknown>, base: LinkProduct): LinkProduct {
  const p = (data.product || data) as Record<string, unknown>, variants = Array.isArray(p.variants) ? p.variants as Record<string, unknown>[] : [];
  const v = [...variants].filter(x => x.available !== false).sort((a, b) => Number(a.price) - Number(b.price))[0] || variants[0] || {};
  const img = (p.image as Record<string, unknown> | undefined)?.src || (Array.isArray(p.images) ? (p.images[0] as Record<string, unknown> | undefined)?.src : '');
  return { ...base, name: tidyName(String(p.title || base.name), base.brand), sku: crmSku(String(v.sku || '')) || base.sku,
    price: money(Number(v.compare_at_price) > Number(v.price) ? v.compare_at_price : v.price) ?? base.price,
    imageUrl: typeof img === 'string' && img ? (img.startsWith('//') ? 'https:' + img : img) : base.imageUrl, platform: 'haravan', brand: plainText(p.vendor) || base.brand };
}
/** WooCommerce Store API (mảng sản phẩm theo slug). */
export function fromWooJson(rows: unknown, slug: string, base: LinkProduct): LinkProduct {
  const q = Array.isArray(rows) ? (rows as Record<string, unknown>[]).find(r => r.slug === slug) : null;
  if (!q) return base;
  const prices = (q.prices || {}) as Record<string, unknown>, minor = Number(prices.currency_minor_unit || 0);
  const regular = Number(prices.regular_price) / 10 ** minor, imgs = Array.isArray(q.images) ? q.images as Record<string, unknown>[] : [];
  return { ...base, name: tidyName(String(q.name || base.name), base.brand), sku: crmSku(String(q.sku || '')) || base.sku,
    price: money(regular) ?? base.price, currency: String(prices.currency_code || base.currency || ''), imageUrl: String(imgs[0]?.src || base.imageUrl), platform: 'woocommerce' };
}
