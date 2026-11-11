import { eq } from 'drizzle-orm';
import type { Router, RouteContext } from '../../../core/http/router.ts';
import { json, readJson } from '../../../core/http/router.ts';
import { AppError } from '../../../core/errors.ts';
import { safeFetch, publicHttpsUrl } from '../../../core/http/safe-fetch.ts';
import { sniffImage } from '../../../core/http/image-bytes.ts';
import type { SessionState, StaffEnv } from '../../staff/api/auth-routes.ts';
import { products } from '../schema.ts';
import { fromHaravanJson, fromSapoJson, fromWooJson, parseProductPage, type LinkProduct } from '../domain/product-link.ts';

/**
 * Tạo nhanh sản phẩm từ link website ngoài – CHỈ ĐỌC, không ghi gì:
 *  POST /product-link-preview {url} → thông tin điền sẵn hộp "Thêm sản phẩm" (+ cảnh báo mã đã có trong danh mục);
 *  POST /product-link-image {url}   → ảnh (JPG/PNG/WebP/GIF ≤ 5 MB) dạng data URL để trình duyệt thu nhỏ rồi tải lên kho ảnh CRM khi Lưu.
 * Tạo sản phẩm vẫn qua POST /products (bắt buộc Giá bán lẻ + Giá lẻ +VAT, nhân viên tạo thì chờ duyệt).
 */
type Ctx = RouteContext<StaffEnv>;
const staffOnly = (c: Ctx) => { const me = (c.state.session as SessionState).member; if (!['manager', 'employee'].includes(me.role)) throw new AppError(403, 'Chỉ nhân viên được tạo sản phẩm.'); return me; };
const usage = new Map<string, number[]>();
function rateLimit(id: string, perMinute: number) {
  const now = Date.now(), recent = (usage.get(id) || []).filter(t => now - t < 60_000);
  if (recent.length >= perMinute) throw new AppError(429, 'Bạn lấy dữ liệu từ link quá nhiều lần trong 1 phút. Thử lại sau.', 'LINK_RATE');
  recent.push(now); usage.set(id, recent); if (usage.size > 5000) usage.clear();
}
const text = (b: Uint8Array) => new TextDecoder().decode(b);

export async function previewProductLink(raw: string, fetcher: typeof fetch): Promise<{ product: LinkProduct; warnings: string[] }> {
  const page = await safeFetch(raw, { accept: 'text/html,application/xhtml+xml', max: 2_500_000, fetcher });
  const html = text(page.bytes), url = page.url, warnings: string[] = [];
  let { product, hints } = parseProductPage(html, url);
  try {
    if (hints.platform === 'sapo' && hints.sapoAlias) {
      const r = await safeFetch(new URL('/products/' + hints.sapoAlias + '.js', url.origin).href, { accept: 'application/json', max: 2_000_000, fetcher });
      if (r.url.origin === url.origin) { const d = JSON.parse(text(r.bytes)); product = fromSapoJson(d.product || d, product); }
    } else if (hints.platform === 'haravan' && hints.haravanJson) {
      const r = await safeFetch(hints.haravanJson, { accept: 'application/json', max: 2_000_000, fetcher });
      if (r.url.origin === url.origin) product = fromHaravanJson(JSON.parse(text(r.bytes)), product);
    } else if (hints.platform === 'woocommerce' && hints.wooSlug) {
      const u = new URL('/wp-json/wc/store/v1/products', url.origin); u.searchParams.set('slug', hints.wooSlug);
      const r = await safeFetch(u.href, { accept: 'application/json', max: 2_000_000, fetcher });
      if (r.url.origin === url.origin) product = fromWooJson(JSON.parse(text(r.bytes)), hints.wooSlug, product);
    }
  } catch { warnings.push('Chưa đọc được dữ liệu chi tiết của website; đã dùng thông tin trên trang – kiểm tra lại.'); }
  if (!product.name) throw new AppError(422, 'Không đọc được tên sản phẩm từ link này. Hãy dán link trang một sản phẩm, hoặc nhập tay.', 'LINK_NO_PRODUCT');
  if (product.currency && product.currency !== 'VND') { warnings.push(`Website dùng ${product.currency}; không tự đổi sang VNĐ – nhập giá tay.`); product = { ...product, price: null }; }
  if (product.price === null) warnings.push('Website không công khai giá: nhập Giá bán lẻ và Giá lẻ +VAT.');
  if (!product.sku) warnings.push('Không thấy mã sản phẩm hợp lệ: nhập mã SKU.');
  if (!product.imageUrl) warnings.push('Không thấy ảnh sản phẩm.');
  return { product, warnings };
}

export function registerProductLinkRoutes(router: Router<StaffEnv>) {
  router.post('/product-link-preview', async c => {
    const me = staffOnly(c); rateLimit(me.id, 20);
    const body = await readJson(c.req, 4_000), url = typeof body.url === 'string' ? body.url : '';
    publicHttpsUrl(url);
    const r = await previewProductLink(url, c.env.externalFetch ?? fetch);
    const [existing] = r.product.sku ? await c.env.db.select({ sku: products.sku, name: products.name, approvalStatus: products.approvalStatus }).from(products).where(eq(products.sku, r.product.sku)).limit(1) : [];
    return json({ ...r, existing: existing ?? null, source: new URL(url).hostname });
  }, 'business');

  router.post('/product-link-image', async c => {
    const me = staffOnly(c); rateLimit(me.id + ':img', 30);
    const body = await readJson(c.req, 4_000), url = typeof body.url === 'string' ? body.url : '';
    const r = await safeFetch(url, { accept: 'image/avif,image/webp,image/png,image/jpeg,image/*', max: 5 * 1024 * 1024, fetcher: c.env.externalFetch ?? fetch });
    const type = sniffImage(r.bytes);
    if (!type) throw new AppError(415, 'Link ảnh không phải JPG / PNG / WebP / GIF.', 'LINK_NOT_IMAGE');
    let bin = ''; for (let i = 0; i < r.bytes.length; i += 0x8000) bin += String.fromCharCode(...r.bytes.subarray(i, i + 0x8000));
    return json({ dataUrl: `data:${type};base64,${btoa(bin)}` });
  }, 'business');
}
