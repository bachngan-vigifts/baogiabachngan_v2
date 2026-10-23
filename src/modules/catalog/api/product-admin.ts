import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import type { Router, RouteContext } from '../../../core/http/router.ts';
import { json, readJson } from '../../../core/http/router.ts';
import { auditLogs } from '../../../core/db/schema.ts';
import { AppError } from '../../../core/errors.ts';
import type { SessionState, StaffEnv } from '../../staff/api/auth-routes.ts';
import { employees } from '../../staff/schema.ts';
import { canApprove } from '../../staff/domain/permissions.ts';
import { pricePolicies, productPrices, products } from '../schema.ts';

type Ctx = RouteContext<StaffEnv>;
const viewer = (c: Ctx) => (c.state.session as SessionState).member;
const SKU = /^[A-Za-z0-9][A-Za-z0-9._\-/ ]{0,63}$/;

function cleanProduct(body: Record<string, unknown>, existingSku?: string) {
  const t = (k: string, max: number) => { const v = body[k] ?? ''; if (typeof v !== 'string' || v.length > max) throw new AppError(400, 'Thông tin sản phẩm không hợp lệ.'); return v.trim(); };
  const sku = existingSku ?? t('sku', 64), name = t('name', 500);
  if (existingSku === undefined && !SKU.test(sku)) throw new AppError(400, 'Mã sản phẩm (SKU) chỉ gồm chữ, số và . _ - / (tối đa 64 ký tự).');
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
 *  - Manager thêm → có hiệu lực ngay. Nhân viên thêm → `pending`, ẩn khỏi danh mục báo giá (active = false) tới khi được duyệt.
 *  - Duyệt / từ chối: Manager hoặc người được Manager bật cờ "Được duyệt"; người tạo tự xoá được sản phẩm còn chờ duyệt của mình.
 */
export function registerProductAdminRoutes(router: Router<StaffEnv>) {
  router.get('/product-approvals', async c => {
    const me = viewer(c), db = c.env.db;
    const rows = await db.select({ p: products, createdByName: employees.name }).from(products).leftJoin(employees, eq(employees.id, products.createdBy))
      .where(and(eq(products.approvalStatus, 'pending'), canApprove(me) ? undefined : eq(products.createdBy, me.id)))
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

  router.put('/products/:sku', async c => {
    const me = viewer(c);
    if (me.role !== 'manager') throw new AppError(403, 'Chỉ Manager được cập nhật sản phẩm.', 'MANAGER_ONLY');
    const body = await readJson(c.req, 16_000), sku = c.params.sku!;
    if (body.sku !== undefined && body.sku !== sku) throw new AppError(400, 'Không đổi mã SKU của sản phẩm đã có.');
    const f = cleanProduct(body, sku), expected = body.expectedUpdatedAt;
    if (typeof expected !== 'string' || !expected) throw new AppError(400, 'Tải lại thông tin sản phẩm trước khi cập nhật.');
    const rawPrices = body.prices && typeof body.prices === 'object' ? body.prices as Record<string, unknown> : {};
    await c.env.db.transaction(async tx => {
      const [before] = await tx.select().from(products).where(eq(products.sku, sku)).limit(1).for('update');
      if (!before) throw new AppError(404, 'Không tìm thấy sản phẩm.');
      if (before.updatedAt !== expected) throw new AppError(409, 'Sản phẩm vừa được thay đổi. Đóng và mở lại để lấy thông tin mới.', 'PRODUCT_CHANGED');
      if (before.approvalStatus !== 'approved') throw new AppError(409, 'Sản phẩm đang chờ duyệt. Duyệt sản phẩm trước khi cập nhật.');
      const policies = new Set((await tx.select({ id: pricePolicies.id }).from(pricePolicies)).map(p => p.id));
      if (Object.keys(rawPrices).some(id => !policies.has(id))) throw new AppError(400, 'Bảng giá không tồn tại. Tải lại danh mục rồi thử lại.');
      const oldPrices = await tx.select().from(productPrices).where(eq(productPrices.sku, sku));
      const changedPrices = Object.entries(rawPrices).map(([policyId, value]) => ({ sku, policyId, price: value == null || value === '' ? null : f.prices[policyId]! }));
      const now = new Date(Math.max(Date.now(), Date.parse(before.updatedAt) + 1)).toISOString();
      const fields = { name: f.name, brand: f.brand, unit: f.unit, pattern: f.pattern, imageUrl: f.imageUrl };
      await tx.update(products).set({ ...fields, updatedAt: now }).where(eq(products.sku, sku));
      for (const row of changedPrices) await tx.insert(productPrices).values(row).onConflictDoUpdate({ target: [productPrices.sku, productPrices.policyId], set: { price: row.price } });
      await tx.insert(auditLogs).values({ id: crypto.randomUUID(), actorId: me.id, module: 'catalog', action: 'update', entityType: 'products', entityId: sku,
        data: JSON.stringify({ before: { name: before.name, brand: before.brand, unit: before.unit, pattern: before.pattern, imageUrl: before.imageUrl, prices: oldPrices }, after: { ...fields, prices: changedPrices } }), createdAt: now });
    });
    return json({ ok: true, sku });
  }, 'business');

  router.post('/products/:sku/approve', async c => {
    const me = viewer(c);
    if (!canApprove(me)) throw new AppError(403, 'Chỉ Manager hoặc người được Manager chỉ định duyệt sản phẩm mới.', 'APPROVER_ONLY');
    const now = new Date().toISOString();
    const done = await c.env.db.update(products).set({ approvalStatus: 'approved', active: true, approvedBy: me.id, approvedAt: now, updatedAt: now })
      .where(and(eq(products.sku, c.params.sku!), eq(products.approvalStatus, 'pending'))).returning({ sku: products.sku });
    if (!done.length) throw new AppError(404, 'Không tìm thấy sản phẩm đang chờ duyệt.');
    return json({ ok: true });
  }, 'business');

  router.delete('/products/:sku', async c => {
    const me = viewer(c), sku = c.params.sku!;
    const [p] = await c.env.db.select({ createdBy: products.createdBy, approvalStatus: products.approvalStatus }).from(products).where(eq(products.sku, sku)).limit(1);
    if (!p || p.approvalStatus !== 'pending') throw new AppError(404, 'Chỉ xoá được sản phẩm đang chờ duyệt.');
    if (!canApprove(me) && p.createdBy !== me.id) throw new AppError(403, 'Chỉ Manager, người được duyệt hoặc người tạo xoá được sản phẩm này.');
    await c.env.db.delete(products).where(and(eq(products.sku, sku), eq(products.approvalStatus, 'pending')));
    return json({ ok: true });
  }, 'business');
}
