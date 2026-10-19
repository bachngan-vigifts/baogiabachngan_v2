import { registerBarcodeImportRoutes } from './barcode-import.ts';
import { catalogStockHooks, effectiveCatalogStock } from './stock-source.ts';
import { and, asc, count, eq, inArray, isNull, notInArray, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Router } from '../../../core/http/router.ts';
import { json, readJson } from '../../../core/http/router.ts';
import { AppError } from '../../../core/errors.ts';
import { foldSql, matchAllWords, paging } from '../../../core/text/fold.ts';
import type { SessionState, StaffEnv } from '../../staff/api/auth-routes.ts';
import { catalogVersions, pricePolicies, productPrices, products, productStock, warehouses } from '../schema.ts';
import { MINH_LONG_WORDS, PRODUCT_GROUPS, isProductGroup, priceRange } from '../domain/product-filters.ts';
import { historyOf } from './product-history.ts';
import { registerProductAdminRoutes } from './product-admin.ts';
import { registerProductActionRoutes } from './product-actions.ts';
import { PRODUCT_HISTORY_LIMIT } from '../domain/product-history.ts';
import { can, type PermissionMember } from '../../staff/domain/permissions.ts';

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
  /** true = đây là toàn bộ danh mục (hoặc lô cuối): ẩn sản phẩm/kho không có trong `allSkus` (mặc định = mã trong lô). */
  replaceAll: z.boolean().default(false),
  allSkus: z.array(z.string().trim().min(1).max(500)).max(50000).optional(),
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
 * Điều kiện tìm sản phẩm (trang Sản phẩm và hộp "Tìm nhanh sản phẩm" như web cũ):
 * `q` nhiều từ khoá không dấu · `brand` · `group` nhóm sản phẩm theo tên · `policy` + `min`/`max` khoảng giá theo
 * bảng giá đang chọn · `scope=minhlong|other` sản phẩm theo loại báo giá (HRC/B2B = Minh Long, VIGIFTS = còn lại);
 * gõ đúng một mã SKU thì vẫn ra mã đó dù khác phạm vi (giống web cũ).
 */
function searchFilter(params: URLSearchParams, brand: string) {
  const q = params.get('q'), group = params.get('group'), scope = params.get('scope'), policy = params.get('policy') || '';
  const range = priceRange(params.get('min'), params.get('max'));
  if (!range) throw new AppError(400, 'Giá từ phải nhỏ hơn hoặc bằng giá đến, và không được âm.');
  const name = foldSql(products.name), label = foldSql(products.brand, products.name);
  const groupCond = isProductGroup(group) ? and(...PRODUCT_GROUPS[group].all.map(re => sql`${name} ~ ${re}`)) : undefined;
  const isMinhLong = or(...MINH_LONG_WORDS.map(w => sql`${label} LIKE ${'%' + w + '%'}`));
  const scopeCond = scope === 'minhlong' ? isMinhLong : scope === 'other' ? sql`NOT (${isMinhLong})` : undefined;
  const words = (q || '').trim().split(/\s+/).filter(Boolean);
  const exactSku = words.length === 1 ? sql`lower(${products.sku}) = lower(${words[0]})` : undefined;
  const priceCond = policy && (range.min !== null || range.max !== null) ? sql`EXISTS (SELECT 1 FROM ${productPrices} pp WHERE pp.sku = ${products.sku} AND pp.policy_id = ${policy} AND pp.price IS NOT NULL
    ${range.min !== null ? sql`AND pp.price >= ${range.min}` : sql``} ${range.max !== null ? sql`AND pp.price <= ${range.max}` : sql``})` : undefined;
  return and(
    eq(products.active, true),
    brand ? eq(products.brand, brand) : undefined,
    matchAllWords(foldSql(products.sku, products.name, products.brand, products.pattern), q),
    groupCond, priceCond,
    scopeCond && exactSku ? or(scopeCond, exactSku) : scopeCond,
  );
}

/** Gõ đúng một mã SKU thì mã đó đứng đầu kết quả. */
const exactSkuFirst = (q: string | null) => {
  const words = (q || '').trim().split(/\s+/).filter(Boolean);
  return words.length === 1 ? [sql`(lower(${products.sku}) = lower(${words[0]})) DESC`] : [];
};

/**
 * Danh mục sản phẩm. Dữ liệu được nạp từ bản cũ/Sapo vào các bảng catalog;
 * giá trả về theo thứ tự chính sách giá (`price_policies.sort_order`), tồn theo kho đang dùng.
 */
/** Các cột của một sản phẩm trong bản chụp danh mục (theo đúng thứ tự); cuối mỗi dòng là mảng giá (theo `policies`) và mảng tồn (theo `warehouses`). */
export const SNAPSHOT_COLUMNS = ['sku', 'name', 'brand', 'pattern', 'unit', 'imageUrl', 'taxBasis', 'taxIn', 'taxOut', 'taxable',
  'perCarton', 'cartonWeight', 'cartonLength', 'cartonWidth', 'cartonHeight', 'stockUpdatedAt'] as const;

/** Phiên bản danh mục: đổi khi sản phẩm, giá hoặc tồn thay đổi (đồng bộ Sapo / nhập file). Tính bằng vài phép gộp, rất nhẹ. */
export async function snapshotVersion(db: StaffEnv['db']) {
  const [[p], [pr], [st], [ver]] = await Promise.all([
    db.select({ n: count(), at: sql<string>`coalesce(max(${products.updatedAt}), '')` }).from(products).where(eq(products.active, true)),
    db.select({ n: count(), sum: sql<string>`coalesce(sum(${productPrices.price}), 0)::text` }).from(productPrices),
    db.select({ n: count(), at: sql<string>`coalesce(max(${productStock.updatedAt}), '')`, sum: sql<string>`coalesce(sum(${productStock.quantity}), 0)::text` }).from(productStock),
    db.select({ observedAt: catalogVersions.observedAt }).from(catalogVersions).where(eq(catalogVersions.isCurrent, true)).limit(1),
  ]);
  const extra = catalogStockHooks.stamp ? await catalogStockHooks.stamp(db) : '';
  const raw = [p?.n, p?.at, pr?.n, pr?.sum, st?.n, st?.at, st?.sum, ver?.observedAt ?? '', extra].join('|');
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw)));
  return { version: [...hash.slice(0, 12)].map(b => b.toString(16).padStart(2, '0')).join(''), observedAt: ver?.observedAt ?? null };
}

/** Giá bán chỉ cho người làm báo giá / đơn / HĐKT (Manager, Sale, Kế toán…). Kho xem sản phẩm, tồn – không thấy giá. */
const seesSalePrices = (m: PermissionMember) => m.role === 'manager' || ['page.quotes', 'page.orders', 'page.contracts'].some(k => can(m, k));
const viewerOf = (c: { state: unknown }) => (c.state as { session: SessionState }).session.member as PermissionMember;

export function registerCatalogRoutes(router: Router<StaffEnv>) {
  registerProductAdminRoutes(router);
  registerBarcodeImportRoutes(router);
  registerProductActionRoutes(router);
  /**
   * Bản chụp toàn bộ danh mục cho "Tìm nhanh sản phẩm" lọc ngay trên trình duyệt như web cũ (`GET /api/staff/catalog` bản cũ).
   * `?v=<phiên bản đang có>`: nếu chưa đổi thì chỉ trả `{ version, unchanged: true }`.
   */
  router.get('/catalog-snapshot', async c => {
    const db = c.env.db, priced = seesSalePrices(viewerOf(c)), snap = await snapshotVersion(db);
    // Bản không giá có phiên bản riêng: trình duyệt không dùng lại bản có giá đã lưu của người khác chức vụ.
    const version = priced ? snap.version : snap.version + ':np', observedAt = snap.observedAt;
    if (c.url.searchParams.get('v') === version) return json({ version, unchanged: true });
    const [rows, policies, stores, prices, rawStock] = await Promise.all([
      db.select().from(products).where(eq(products.active, true)).orderBy(asc(products.sku)),
      db.select().from(pricePolicies).orderBy(asc(pricePolicies.sortOrder), asc(pricePolicies.name)),
      db.select().from(warehouses).where(eq(warehouses.active, true)).orderBy(asc(warehouses.sortOrder), asc(warehouses.name)),
      db.select({ sku: productPrices.sku, policyId: productPrices.policyId, price: productPrices.price }).from(productPrices),
      db.select({ sku: productStock.sku, warehouseId: productStock.warehouseId, quantity: productStock.quantity, updatedAt: productStock.updatedAt }).from(productStock),
    ]);
    const stock = await effectiveCatalogStock(db, rawStock);
    const index = new Map(rows.map((r, i) => [r.sku, i]));
    const policyAt = new Map(policies.map((p, i) => [p.id, i])), storeAt = new Map(stores.map((w, i) => [w.id, i]));
    const priceRows = rows.map(() => policies.map(() => null as number | null));
    const stockRows = rows.map(() => stores.map(() => null as number | null)), stockAt = rows.map(() => '');
    if (priced) for (const p of prices) { const i = index.get(p.sku), j = policyAt.get(p.policyId); if (i !== undefined && j !== undefined) priceRows[i]![j] = p.price; }
    for (const s of stock) {
      const i = index.get(s.sku), j = storeAt.get(s.warehouseId); if (i === undefined || j === undefined) continue;
      stockRows[i]![j] = s.quantity; if (s.updatedAt > stockAt[i]!) stockAt[i] = s.updatedAt;
    }
    return json({
      version, observedAt, columns: SNAPSHOT_COLUMNS,
      policies: policies.map(p => ({ id: p.id, name: p.name })),
      warehouses: stores.map(w => ({ id: w.id, name: w.name, kind: w.kind })),
      products: rows.map((r, i) => [r.sku, r.name, r.brand, r.pattern, r.unit, r.imageUrl, r.taxBasis, r.taxIn, r.taxOut, r.taxable,
        r.perCarton, r.cartonWeight, r.cartonLength, r.cartonWidth, r.cartonHeight, stockAt[i] || null, priceRows[i], stockRows[i]]),
    });
  }, 'business');

  router.get('/products', async c => {
    const db = c.env.db, paged = paging(c.url, 50, 200), priced = seesSalePrices(viewerOf(c));
    const brand = c.url.searchParams.get('brand') || '';
    // `skus=a,b,c`: lấy đúng các mã (kể cả đã ẩn) – dùng để bổ sung ảnh/thông tin cho dòng báo giá cũ.
    const skuList = [...new Set((c.url.searchParams.get('skus') || '').split(',').map(s => s.trim()).filter(Boolean))].slice(0, 300);
    const { limit, offset } = skuList.length ? { limit: skuList.length, offset: 0 } : paged;
    const where = skuList.length ? inArray(products.sku, skuList) : searchFilter(c.url.searchParams, brand);
    const [[{ total = 0 } = {}], rows, policies, stores, version] = await Promise.all([
      db.select({ total: count() }).from(products).where(where),
      db.select().from(products).where(where).orderBy(...exactSkuFirst(c.url.searchParams.get('q')), asc(foldSql(products.name)), asc(products.name), asc(products.sku)).limit(limit).offset(offset),
      db.select().from(pricePolicies).orderBy(asc(pricePolicies.sortOrder), asc(pricePolicies.name)),
      db.select().from(warehouses).where(eq(warehouses.active, true)).orderBy(asc(warehouses.sortOrder), asc(warehouses.name)),
      db.select({ observedAt: catalogVersions.observedAt }).from(catalogVersions).where(eq(catalogVersions.isCurrent, true)).limit(1),
    ]);
    const skus = rows.map(r => r.sku);
    const [prices, rawStock] = skus.length ? await Promise.all([
      db.select().from(productPrices).where(inArray(productPrices.sku, skus)),
      db.select().from(productStock).where(inArray(productStock.sku, skus)),
    ]) : [[], []];
    const stock = await effectiveCatalogStock(db, rawStock, skus);
    const priceMap = new Map<string, Record<string, number | null>>(), stockMap = new Map<string, Record<string, number>>();
    for (const p of prices) (priceMap.get(p.sku) ?? priceMap.set(p.sku, {}).get(p.sku)!)[p.policyId] = p.price;
    const stockAt = new Map<string, string>();
    for (const s of stock) {
      (stockMap.get(s.sku) ?? stockMap.set(s.sku, {}).get(s.sku)!)[s.warehouseId] = s.quantity;
      if (s.updatedAt > (stockAt.get(s.sku) ?? '')) stockAt.set(s.sku, s.updatedAt);
    }
    return json({
      total: Number(total), limit, offset, observedAt: version[0]?.observedAt ?? null,
      policies: policies.map(p => ({ id: p.id, name: p.name })),
      warehouses: stores.map(w => ({ id: w.id, name: w.name, kind: w.kind })),
      // `pricePolicies` và `prices` dạng mảng giữ tương thích với giao diện dùng thử đầu tiên.
      pricePolicies: policies,
      products: rows.map(r => ({
        ...r,
        prices: !priced ? [] : policies.filter(p => p.id in (priceMap.get(r.sku) ?? {})).map(p => ({ policyId: p.id, price: priceMap.get(r.sku)![p.id] ?? null })),
        stock: stockMap.get(r.sku) ?? {},
        /** Lần cập nhật tồn gần nhất của mã này (đồng bộ Sapo / nhập file). */
        stockUpdatedAt: stockAt.get(r.sku) ?? null,
      })),
    });
  }, 'business');

  router.get('/product-brands', async c => {
    const rows = await c.env.db.select({ brand: products.brand, n: count() }).from(products)
      .where(and(eq(products.active, true), sql`${products.brand} <> ''`)).groupBy(products.brand).orderBy(asc(products.brand));
    return json({ brands: rows.map(r => ({ name: r.brand, count: Number(r.n) })) });
  }, 'business');

  /**
   * Lịch sử sản phẩm: 20 biến động gần nhất của mã (bán, xuất kho giao hàng, nhập hàng, điều chuyển, cân bằng kho, trả hàng)
   * + giá bán gần nhất / thấp / cao / trung bình từ các lần bán.
   */
  router.get('/products/:sku/history', async c => {
    const sku = c.params.sku!.trim().slice(0, 500); // router đã giải mã tham số đường dẫn
    const rows = await historyOf(c.env.db, sku), priced = seesSalePrices(viewerOf(c));
    const prices = priced ? rows.filter(r => r.kind === 'sale' && r.unitPrice !== null).map(r => r.unitPrice!) : [];
    // Giá nhập (giá vốn) và tên nhà cung cấp chỉ Manager xem: nhân viên chỉ thấy giá ở dòng bán / giao / khách trả.
    const mgr = (c.state.session as SessionState).member.role === 'manager';
    const COST_KINDS = new Set(['purchase', 'supplier_return', 'transfer', 'adjustment']), SUPPLIER_KINDS = new Set(['purchase', 'supplier_return']);
    const shown = (r: typeof rows[number]) => mgr ? r : { ...r, unitPrice: !priced || COST_KINDS.has(r.kind) ? null : r.unitPrice, partner: SUPPLIER_KINDS.has(r.kind) ? '' : r.partner };
    return json({ sku, limit: PRODUCT_HISTORY_LIMIT, history: rows.map(shown).map(({ id, refKey, recordedAt, ...r }) => r),
      sales: prices.length ? { count: prices.length, last: prices[0], min: Math.min(...prices), max: Math.max(...prices), avg: Math.round(prices.reduce((a, b) => a + b, 0) / prices.length) } : null });
  }, 'business');

  router.get('/products/:sku', async c => {
    const db = c.env.db, sku = c.params.sku!;
    const [row] = await db.select().from(products).where(eq(products.sku, sku)).limit(1);
    if (!row) throw new AppError(404, 'Không tìm thấy sản phẩm.');
    const [prices, rawStock] = await Promise.all([
      db.select().from(productPrices).where(eq(productPrices.sku, sku)),
      db.select().from(productStock).where(eq(productStock.sku, sku)),
    ]);
    const stock = await effectiveCatalogStock(db, rawStock, [sku]);
    return json({ product: { ...row, prices: seesSalePrices(viewerOf(c)) ? prices.map(p => ({ policyId: p.policyId, price: p.price })) : [], stock: Object.fromEntries(stock.map(s => [s.warehouseId, s.quantity])) } });
  }, 'business');

  /**
   * Manager nhập file danh mục web cũ. Mỗi lần gọi ghi đè tên/giá/tồn của các mã gửi lên (không tạo dòng trùng,
   * chạy lại được nhiều lần). Gửi theo lô được: chỉ lời gọi có `replaceAll: true` (toàn bộ file, hoặc lô cuối kèm
   * `allSkus` = mọi mã của file) mới ẩn sản phẩm không còn trong file, ngừng dùng kho không còn và ghi `catalog_versions`.
   * Lời gọi không có `replaceAll` (vd giao diện cũ gửi 100 mã/lần) chỉ cập nhật, không ẩn gì.
   */
  router.post('/admin/catalog-import', async c => {
    const parsed = catalogFile.safeParse(await readJson(c.req, 20_000_000));
    if (!parsed.success) throw new AppError(400, 'File danh mục không hợp lệ. Chọn file JSON danh mục từ web báo giá cũ.');
    const data = parsed.data, now = new Date().toISOString(), actor = (c.state.session as SessionState).member.id;
    if (data.allSkus) { const all = new Set(data.allSkus); if (data.products.some(p => !all.has(p.sku))) throw new AppError(400, 'Danh sách mã của file không khớp lô đang nhập.'); }
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
      const skus = data.products.map(p => p.sku), keepSkus = data.allSkus ?? skus;
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
          approvalStatus: sql`'approved'`, // mã có trong file danh mục = đã có hiệu lực
        } });
      }
      // Giá và tồn lấy đúng theo file: xoá của các mã trong file rồi ghi lại.
      // Trừ kho "Hàng chờ về": hệ thống tự tính từ Đơn mua NCC (suppliers/api/incoming-stock.ts), file không ghi đè.
      const incoming = new Set(data.warehouses.flatMap((n, i) => warehouseKind(n) === 'incoming' ? [warehouseIds[i]!] : []));
      for (const part of chunks(skus)) {
        await tx.delete(productPrices).where(inArray(productPrices.sku, part));
        await tx.delete(productStock).where(and(inArray(productStock.sku, part), incoming.size ? notInArray(productStock.warehouseId, [...incoming]) : undefined));
      }
      const priceRows = data.products.flatMap(p => p.prices.map((price, i) => ({ sku: p.sku, policyId: policyIds[i]!, price })));
      const stockRows = data.products.flatMap(p => p.stock.flatMap((q, i) => q === null || incoming.has(warehouseIds[i]!) ? [] : [{ sku: p.sku, warehouseId: warehouseIds[i]!, quantity: q, updatedAt: now }]));
      for (const part of chunks(priceRows)) await tx.insert(productPrices).values(part);
      for (const part of chunks(stockRows)) await tx.insert(productStock).values(part);
      if (!data.replaceAll) return;
      // Sản phẩm tạo trên web (`created_by` khác null) không nằm trong file danh mục: không ẩn.
      await tx.update(products).set({ active: false, updatedAt: now }).where(and(eq(products.active, true), isNull(products.createdBy), notInArray(products.sku, keepSkus)));
      await tx.update(warehouses).set({ active: false }).where(notInArray(warehouses.id, warehouseIds));
      await tx.update(catalogVersions).set({ isCurrent: false }).where(eq(catalogVersions.isCurrent, true));
      await tx.insert(catalogVersions).values({ id: crypto.randomUUID(), observedAt: data.observedAt || now, productCount: keepSkus.length, isCurrent: true, createdBy: actor, createdAt: now });
    });
    return json({ count: data.products.length, replaced: data.replaceAll, policies: data.pricePolicies.length, warehouses: data.warehouses.length, message: `Đã nhập ${data.products.length} sản phẩm.` });
  }, 'admin');
}

