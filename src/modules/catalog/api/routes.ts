import { and, asc, count, eq, inArray, sql } from 'drizzle-orm';
import type { Router } from '../../../core/http/router.ts';
import { json } from '../../../core/http/router.ts';
import { AppError } from '../../../core/errors.ts';
import { foldSql, matchAllWords, paging } from '../../../core/text/fold.ts';
import type { StaffEnv } from '../../staff/api/auth-routes.ts';
import { catalogVersions, pricePolicies, productPrices, products, productStock, warehouses } from '../schema.ts';

/**
 * Danh mục sản phẩm (chỉ đọc). Dữ liệu được nạp từ bản cũ/Sapo vào các bảng catalog;
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
      products: rows.map(r => ({
        sku: r.sku, name: r.name, brand: r.brand, pattern: r.pattern, unit: r.unit, imageUrl: r.imageUrl,
        taxOut: r.taxOut, perCarton: r.perCarton, cartonWeight: r.cartonWeight,
        prices: priceMap.get(r.sku) ?? {}, stock: stockMap.get(r.sku) ?? {},
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
    return json({ product: { ...row, prices: Object.fromEntries(prices.map(p => [p.policyId, p.price])), stock: Object.fromEntries(stock.map(s => [s.warehouseId, s.quantity])) } });
  }, 'business');
}
