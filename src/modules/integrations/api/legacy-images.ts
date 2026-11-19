import { and, asc, count, eq, gt, like } from 'drizzle-orm';
import type { Router, RouteContext } from '../../../core/http/router.ts';
import { json, readJson } from '../../../core/http/router.ts';
import { AppError } from '../../../core/errors.ts';
import type { SessionState, StaffEnv } from '../../staff/api/auth-routes.ts';
import { products } from '../../catalog/schema.ts';
import { IMAGE_FETCH_MAX_BYTES, readLimited, sniffImage } from '../../../core/http/image-bytes.ts';
import { exportLegacySession, restoreLegacySession, LegacyRateLimitError, fetchLegacyMedia, legacyMediaKey } from './legacy-site.ts';

/**
 * CHUYỂN ẢNH SẢN PHẨM TỪ WEB CŨ SANG KHO MỚI (Manager, chạy một lần – bấm ở trang Sản phẩm).
 * Mỗi lượt xử lý tối đa `limit` sản phẩm còn link web cũ (theo thứ tự mã, tiếp sau `after`):
 * tải ảnh (đăng nhập web cũ) → lưu bucket public `product-images` tại `legacy/<sha256>.<đuôi>` (nhiều mã chung ảnh dùng chung file)
 * → đổi `products.image_url` sang link công khai. Ảnh lỗi (web cũ mất file…) giữ link cũ, báo lại, lượt sau bỏ qua theo `after`.
 * Xong hết thì PDF / Excel / trang khách đọc ảnh trực tiếp từ kho mới, tắt web cũ không mất ảnh.
 */
type Ctx = RouteContext<StaffEnv>;
const LEGACY_PREFIX = 'https://baogia.minhlongonline.com/api/staff/media-file?key=%';
const EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };
const requireManager = (c: Ctx) => { if ((c.state.session as SessionState).member.role !== 'manager') throw new AppError(403, 'Chỉ Manager được chuyển ảnh.'); };
const remaining = async (c: Ctx) => (await c.env.db.select({ n: count() }).from(products).where(like(products.imageUrl, LEGACY_PREFIX)))[0]?.n ?? 0;

export function registerLegacyImageRoutes(router: Router<StaffEnv>) {
  router.get('/catalog/legacy-images', async c => {
    requireManager(c);
    return json({ remaining: await remaining(c), configured: !!(c.env.legacySite?.email && c.env.legacySite.password && c.env.productImages?.publicUrl) });
  }, 'business');

  router.post('/catalog/legacy-images/migrate', async c => {
    requireManager(c);
    const store = c.env.productImages;
    if (!store?.publicUrl) throw new AppError(503, 'Chưa có kho ảnh sản phẩm (bucket product-images). Chạy migration 0042 rồi triển khai lại API.');
    const body = await readJson(c.req, 8192), limit = Math.min(Math.max(Number(body.limit) || 20, 1), 40), after = typeof body.after === 'string' ? body.after : '';
    const owner = (c.state.session as SessionState).tokenHash;
    await restoreLegacySession(c.env, owner, body.legacySession);
    const rows = await c.env.db.select({ sku: products.sku, imageUrl: products.imageUrl }).from(products)
      .where(and(like(products.imageUrl, LEGACY_PREFIX), after ? gt(products.sku, after) : undefined)).orderBy(asc(products.sku)).limit(limit);
    const done = new Map<string, string>(), failed: { sku: string; error: string }[] = [];
    let migrated = 0, last = after;
    for (const r of rows) {
      const key = legacyMediaKey(r.imageUrl);
      if (!key) { failed.push({ sku: r.sku, error: 'Link web cũ không đúng dạng.' }); continue; }
      try {
        let url = done.get(key);
        if (!url) {
          const bytes = await readLimited(await fetchLegacyMedia(c.env, r.imageUrl), IMAGE_FETCH_MAX_BYTES), mime = sniffImage(bytes);
          if (!mime) throw new AppError(415, 'File không phải ảnh.');
          const path = `legacy/${key}.${EXT[mime]}`;
          await store.put(path, bytes, mime, { upsert: true, cacheSeconds: 7 * 86_400 }); // ảnh web cũ: giữ 7 ngày
          url = store.publicUrl(path); done.set(key, url);
        }
        await c.env.db.update(products).set({ imageUrl: url, updatedAt: new Date().toISOString() }).where(eq(products.sku, r.sku));
        migrated++;
      } catch (e) {
        if (e instanceof LegacyRateLimitError) return json({ migrated, failed, next: last || null, finished: false,
          remaining: await remaining(c), paused: true, retryAfter: e.retryAfter, legacySession: await exportLegacySession(c.env, owner) });
        // Không đăng nhập được web cũ / chưa cấu hình: dừng cả lượt (lỗi chung, không phải lỗi từng ảnh).
        if (e instanceof AppError && /Đăng nhập web cũ|chưa cấu hình|Không kết nối được web cũ|không có quyền/.test(e.message)) throw e;
        failed.push({ sku: r.sku, error: e instanceof Error ? e.message : String(e) });
      }
      last = r.sku;
    }
    return json({ migrated, failed, next: rows.at(-1)?.sku ?? null, finished: rows.length < limit, remaining: await remaining(c), legacySession: await exportLegacySession(c.env, owner) });
  }, 'business');
}
