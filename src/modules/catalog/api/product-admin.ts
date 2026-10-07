import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import type { Router, RouteContext } from '../../../core/http/router.ts';
import { json, readJson } from '../../../core/http/router.ts';
import { AppError } from '../../../core/errors.ts';
import type { SessionState, StaffEnv } from '../../staff/api/auth-routes.ts';
import { employees } from '../../staff/schema.ts';
import { pricePolicies, productPrices, products } from '../schema.ts';

type Ctx = RouteContext<StaffEnv>;
const viewer = (c: Ctx) => (c.state.session as SessionState).member;
const SKU = /^[A-Za-z0-9][A-Za-z0-9._\-/ ]{0,63}$/;

function cleanProduct(body: Record<string, unknown>) {
  const t = (k: string, max: number) => { const v = body[k] ?? ''; if (typeof v !== 'string' || v.length > max) throw new AppError(400, 'Thông tin sản phẩm không hợp lệ.'); return v.trim(); };
  const sku = t('sku', 64), name = t('name', 500);
  if (!SKU.test(sku)) throw new AppError(400, 'Mã sản phẩm (SKU) chỉ gồm chữ, số và . _ - / (tối đa 64 ký tự).');
  if (!name) throw new AppError(400, 'Nhập tên sản phẩm.');
  const imageUrl = t('imageUrl', 2000);
  if (imageUrl && !/^https:\/\/\S+$/i.test(imageUrl)) throw new AppError(400, 'Link ảnh phải bắt đầu bằng https://');
  const prices: Record<string, number> = {};
  const raw = body.prices && typeof body.prices === 'object' ? body.prices as Record<string, unknown> : {};
  for (const [policyId, v] of Object.entries(raw)) {
    if (v === null || v === '' || v === undefined) continue;
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0 || n > 1e12) throw new AppError(400, 'Giá sản phẩm không hợp lệ.');
    prices[String(policyId).slice(0, 80)] = Math.round(n);
  }
  return { sku, name, brand: t('brand', 200), unit: t('unit', 50), pattern: t('pattern', 200), imageUrl, prices };
}

/**
 * Thêm sản phẩm trên web và duyệt:
 *  - Manager thêm → có hiệu lực ngay. Nhân viên thêm → `pending`, ẩn khỏi danh mục báo giá (active = false) tới khi Manager duyệt.
 *  - Từ chối (xoá) chỉ áp dụng cho sản phẩm đang chờ duyệt: Manager hoặc người tạo.
 */
export function registerProductAdminRoutes(router: Router<StaffEnv>) {
  router.get('/product-approvals', async c => {
    const me = viewer(c), db = c.env.db;
    const rows = await db.select({ p: products, createdByName: employees.name }).from(products).leftJoin(employees, eq(employees.id, products.createdBy))
      .where(and(eq(products.approvalStatus, 'pending'), me.role === 'manager' ? undefined : eq(products.createdBy, me.id)))
      .orderBy(desc(products.updatedAt)).limit(200);
    const skus = rows.map(r => r.p.sku);
    const prices = skus.length ? await db.select().from(productPrices).where(inArray(productPrices.sku, skus)) : [];
    return json({ products: rows.map(({ p, createdByName }) => ({ ...p, createdByName: createdByName ?? '',
      prices: prices.filter(x => x.sku === p.sku).map(x => ({ policyId: x.policyId, price: x.price })) })) });
  }, 'business');

  router.post('/products', async c => {
    const me = viewer(c), db = c.env.db, f = cleanProduct(await readJson(c.req, 16_000)), now = new Date().toISOString(), mgr = me.role === 'manager';
    if ((await db.select({ sku: products.sku }).from(products).where(eq(products.sku, f.sku)).limit(1)).length) throw new AppError(409, `Mã ${f.sku} đã có trong danh mục.`);
    const policies = new Set((await db.select({ id: pricePolicies.id }).from(pricePolicies).orderBy(asc(pricePolicies.sortOrder))).map(p => p.id));
    const priceRows = Object.entries(f.prices).filter(([id]) => policies.has(id)).map(([policyId, price]) => ({ sku: f.sku, policyId, price }));
    await db.transaction(async tx => {
      await tx.insert(products).values({ sku: f.sku, name: f.name, brand: f.brand, unit: f.unit, pattern: f.pattern, imageUrl: f.imageUrl,
        active: mgr, approvalStatus: mgr ? 'approved' : 'pending', createdBy: me.id, approvedBy: mgr ? me.id : null, approvedAt: mgr ? now : null, updatedAt: now });
      if (priceRows.length) await tx.insert(productPrices).values(priceRows);
    });
    return json({ sku: f.sku, approvalStatus: mgr ? 'approved' : 'pending' }, 201);
  }, 'business');

  router.post('/products/:sku/approve', async c => {
    const me = viewer(c);
    if (me.role !== 'manager') throw new AppError(403, 'Chỉ Manager duyệt được sản phẩm mới.');
    const now = new Date().toISOString();
    const done = await c.env.db.update(products).set({ approvalStatus: 'approved', active: true, approvedBy: me.id, approvedAt: now, updatedAt: now })
      .where(and(eq(products.sku, decodeURIComponent(c.params.sku!)), eq(products.approvalStatus, 'pending'))).returning({ sku: products.sku });
    if (!done.length) throw new AppError(404, 'Không tìm thấy sản phẩm đang chờ duyệt.');
    return json({ ok: true });
  }, 'business');

  router.delete('/products/:sku', async c => {
    const me = viewer(c), sku = decodeURIComponent(c.params.sku!);
    const [p] = await c.env.db.select({ createdBy: products.createdBy, approvalStatus: products.approvalStatus }).from(products).where(eq(products.sku, sku)).limit(1);
    if (!p || p.approvalStatus !== 'pending') throw new AppError(404, 'Chỉ xoá được sản phẩm đang chờ duyệt.');
    if (me.role !== 'manager' && p.createdBy !== me.id) throw new AppError(403, 'Chỉ Manager hoặc người tạo xoá được sản phẩm này.');
    await c.env.db.delete(products).where(and(eq(products.sku, sku), eq(products.approvalStatus, 'pending')));
    return json({ ok: true });
  }, 'business');
}
