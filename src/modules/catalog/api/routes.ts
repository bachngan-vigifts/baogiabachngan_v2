import { and, asc, count, eq, inArray, notInArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Router } from '../../../core/http/router.ts';
import { json, readJson } from '../../../core/http/router.ts';
import { AppError } from '../../../core/errors.ts';
import { foldSql, matchAllWords, paging } from '../../../core/text/fold.ts';
import type { SessionState, StaffEnv } from '../../staff/api/auth-routes.ts';
import { catalogVersions, pricePolicies, productPrices, products, productStock, warehouses } from '../schema.ts';

const amount = z.number().finite().min(0).max(1e12).nullable();
const size = z.number().finite().min(0).max(1e6).nullable().optional();
/** File danh mục của web cũ (`GET /api/staff/catalog`, định dạng 'sapo-catalog-v1'); trường thừa được bỏ qua. */
const catalogFile = z.object({
  format: z.literal('sapo-catalog-v1'),
  observedAt: z.string().max(80).optional(),
  warehouses: z.array(z.string().trim().min(1).max(200)).max(30),
  pricePolicies: z.array(z.string().trim().min(1).max(200)).max(30),
  products: z.array(z.object({
    sku: z.string().trim().min(1).max(500), name: z.string().trim().min(1).max(2000),
    brand: z.string().max(4000).default(''), pattern: z.string().max(4000).default(''),
    unit: z.string().max(4000).default(''), image: z.string().max(4000).default(''),
    taxBasis: z.string().max(4000).default(''), taxable: z.boolean().default(false),
    taxIn: z.number().min(0).max(100).nullable().default(null),
    taxOut: z.number().min(0).max(100).nullable().default(null),
    perCarton: size, cartonWeight: size, cartonLength: size, cartonWidth: size, cartonHeight: size,
    prices: z.array(amount), stock: z.array(z.number().finite().min(-1e12).max(1e12).nullable()),
  })).min(1).max(50000),
}).superRefine((data, ctx) => {
  if (new Set(data.products.map(p => p.sku)).size !== data.products.length ||
      new Set(data.warehouses).size !== data.warehouses.length ||
      new Set(data.pricePolicies).size !== data.pricePolicies.length ||
      data.products.some(p => p.prices.length !== data.pricePolicies.length || p.stock.length !== data.warehouses.length))
    ctx.addIssue({ code: 'custom', message: 'Mã sản phẩm trùng hoặc số cột giá/tồn kho không khớp.' });
});
const warehouseKind = (name: string) => name === 'NCC' ? 'supplier' as const : name === 'Hàng chờ về' ? 'incoming' as const : 'stock' as const;
const chunks = <T>(xs: T[], n = 500) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

/**
 * Danh mục sản phẩm. Dữ liệu được nạp từ bản cũ/Sapo vào các bảng catalog;
 * giá trả về theo thứ tự chính sách giá (`price_policies.sort_order`), tồn theo kho đang dùng.
 */
export function registerCatalogRoutes(router: Router<StaffEnv>) {
  router.get('/products', async c => {
    const db = c.env.db, { limit, offset } = paging(c.url, 50, 200);
    const brand = c.url.searchParams.get('brand') || '';
    const where = and(
      eq(products.active, true),
      brand ? eq(products.brand, brand) : undefined,
      matchAllWords(foldSql(products.sku, products.name, products.brand, products.pattern), c.url.searchParams.get('q')),
    );
    const [[{ total = 0 } = {}], rows, policies, stores, version] = await Promise.all([
      db.select({ total: count() }).from(products).where(where),
      db.select().from(products).where(where).orderBy(asc(products.name), asc(products.sku)).limit(limit).offset(offset),
      db.select().from(pricePolicies).orderBy(asc(pricePolicies.sortOrder), asc(pricePolicies.name)),
      db.select().from(warehouses).where(eq(warehouses.active, true)).orderBy(asc(warehouses.sortOrder), asc(warehouses.name)),
      db.select({ observedAt: catalogVersions.observedAt }).from(catalogVersions).where(eq(catalogVersions.isCurrent, true)).limit(1),
    ]);
    const skus = rows.map(r => r.sku);
    const [prices, stock] = skus.length ? await Promise.all([
      db.select().from(productPrices).where(inArray(productPrices.sku, skus)),
      db.select().from(productStock).where(inArray(productStock.sku, skus)),
    ]) : [[], []];
    const priceMap = new Map<string, Record<string, number | null>>(), stockMap = new Map<string, Record<string, number>>();
    for (const p of prices) (priceMap.get(p.sku) ?? priceMap.set(p.sku, {}).get(p.sku)!)[p.policyId] = p.price;
    for (const s of stock) (stockMap.get(s.sku) ?? stockMap.set(s.sku, {}).get(s.sku)!)[s.warehouseId] = s.quantity;
    return json({
      total: Number(total), limit, offset, observedAt: version[0]?.observedAt ?? null,
      policies: policies.map(p => ({ id: p.id, name: p.name })),
      warehouses: stores.map(w => ({ id: w.id, name: w.name, kind: w.kind })),
      // `pricePolicies` và `prices` dạng mảng giữ tương thích với giao diện dùng thử đầu tiên.
      pricePolicies: policies,
      products: rows.map(r => ({
        ...r,
        prices: policies.filter(p => p.id in (priceMap.get(r.sku) ?? {})).map(p => ({ policyId: p.id, price: priceMap.get(r.sku)![p.id] ?? null })),
        stock: stockMap.get(r.sku) ?? {},
      })),
    });
  }, 'business');

  router.get('/product-brands', async c => {
    const rows = await c.env.db.select({ brand: products.brand, n: count() }).from(products)
      .where(and(eq(products.active, true), sql`${products.brand} <> ''`)).groupBy(products.brand).orderBy(asc(products.brand));
    return json({ brands: rows.map(r => ({ name: r.brand, count: Number(r.n) })) });
  }, 'business');

  router.get('/products/:sku', async c => {
    const db = c.env.db, sku = c.params.sku!;
    const [row] = await db.select().from(products).where(eq(products.sku, sku)).limit(1);
    if (!row) throw new AppError(404, 'Không tìm thấy sản phẩm.');
    const [prices, stock] = await Promise.all([
      db.select().from(productPrices).where(eq(productPrices.sku, sku)),
      db.select().from(productStock).where(eq(productStock.sku, sku)),
    ]);
    return json({ product: { ...row, prices: prices.map(p => ({ policyId: p.policyId, price: p.price })), stock: Object.fromEntries(stock.map(s => [s.warehouseId, s.quantity])) } });
  }, 'business');

  /**
   * Manager nhập file danh mục (thay toàn bộ catalog như `replaceCatalog` bản cũ): ghi đè giá/tồn theo file,
   * sản phẩm không còn trong file chuyển `active = false` (báo giá cũ vẫn giữ dữ liệu của mình). Chạy lại được nhiều lần.
   */
  router.post('/admin/catalog-import', async c => {
    const parsed = catalogFile.safeParse(await readJson(c.req, 20_000_000));
    if (!parsed.success) throw new AppError(400, 'File danh mục không hợp lệ. Chọn file JSON danh mục từ web báo giá cũ.');
    const data = parsed.data, now = new Date().toISOString(), actor = (c.state.session as SessionState).member.id;
    await c.env.db.transaction(async tx => {
      // Tên bảng giá/kho là duy nhất: dùng lại id đã có theo tên, chưa có thì tạo id 'legacy:<tên>'.
      const [oldPolicies, oldStores] = await Promise.all([tx.select().from(pricePolicies), tx.select().from(warehouses)]);
      const idByName = (rows: { id: string; name: string }[], name: string) => rows.find(r => r.name === name)?.id ?? 'legacy:' + name;
      const policyIds = data.pricePolicies.map(n => idByName(oldPolicies, n)), warehouseIds = data.warehouses.map(n => idByName(oldStores, n));
      for (const [i, name] of data.pricePolicies.entries())
        await tx.insert(pricePolicies).values({ id: policyIds[i]!, name, sortOrder: i }).onConflictDoUpdate({ target: pricePolicies.id, set: { name, sortOrder: i } });
      for (const [i, name] of data.warehouses.entries())
        await tx.insert(warehouses).values({ id: warehouseIds[i]!, name, sortOrder: i, kind: warehouseKind(name), active: true })
          .onConflictDoUpdate({ target: warehouses.id, set: { name, sortOrder: i, kind: warehouseKind(name), active: true } });
      const skus = data.products.map(p => p.sku);
      for (const part of chunks(data.products)) {
        await tx.insert(products).values(part.map(p => ({
          sku: p.sku, name: p.name, brand: p.brand, pattern: p.pattern, unit: p.unit, imageUrl: p.image, taxBasis: p.taxBasis,
          taxIn: p.taxIn, taxOut: p.taxOut, taxable: p.taxable, perCarton: p.perCarton ?? null, cartonWeight: p.cartonWeight ?? null,
          cartonLength: p.cartonLength ?? null, cartonWidth: p.cartonWidth ?? null, cartonHeight: p.cartonHeight ?? null, active: true, updatedAt: now,
        }))).onConflictDoUpdate({ target: products.sku, set: {
          name: sql`excluded.name`, brand: sql`excluded.brand`, pattern: sql`excluded.pattern`, unit: sql`excluded.unit`, imageUrl: sql`excluded.image_url`,
          taxBasis: sql`excluded.tax_basis`, taxIn: sql`excluded.tax_in`, taxOut: sql`excluded.tax_out`, taxable: sql`excluded.taxable`,
          perCarton: sql`excluded.per_carton`, cartonWeight: sql`excluded.carton_weight`, cartonLength: sql`excluded.carton_length`,
          cartonWidth: sql`excluded.carton_width`, cartonHeight: sql`excluded.carton_height`, active: sql`true`, updatedAt: sql`excluded.updated_at`,
        } });
      }
      // Giá và tồn lấy đúng theo file: xoá của các mã trong file rồi ghi lại.
      for (const part of chunks(skus)) {
        await tx.delete(productPrices).where(inArray(productPrices.sku, part));
        await tx.delete(productStock).where(inArray(productStock.sku, part));
      }
      const priceRows = data.products.flatMap(p => p.prices.map((price, i) => ({ sku: p.sku, policyId: policyIds[i]!, price })));
      const stockRows = data.products.flatMap(p => p.stock.flatMap((q, i) => q === null ? [] : [{ sku: p.sku, warehouseId: warehouseIds[i]!, quantity: q, updatedAt: now }]));
      for (const part of chunks(priceRows)) await tx.insert(productPrices).values(part);
      for (const part of chunks(stockRows)) await tx.insert(productStock).values(part);
      await tx.update(products).set({ active: false, updatedAt: now }).where(and(eq(products.active, true), notInArray(products.sku, skus)));
      await tx.update(warehouses).set({ active: false }).where(notInArray(warehouses.id, warehouseIds));
      await tx.update(catalogVersions).set({ isCurrent: false }).where(eq(catalogVersions.isCurrent, true));
      await tx.insert(catalogVersions).values({ id: crypto.randomUUID(), observedAt: data.observedAt || now, productCount: data.products.length, isCurrent: true, createdBy: actor, createdAt: now });
    });
    return json({ count: data.products.length, policies: data.pricePolicies.length, warehouses: data.warehouses.length, message: `Đã nhập ${data.products.length} sản phẩm.` });
  }, 'admin');
}
