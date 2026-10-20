import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Router } from '../../../core/http/router.ts';
import { json, readJson } from '../../../core/http/router.ts';
import { AppError } from '../../../core/errors.ts';
import type { SessionState, StaffEnv } from '../../staff/api/auth-routes.ts';
import { products, productPrices, pricePolicies, productStock, warehouses, productEdits, stockImports, stockImportLines } from '../schema.ts';

const qty = z.number().finite().min(-1e12).max(1e12);
const transaction = z.object({ onHand: qty, committed: qty.refine(n => n >= 0) }).strict();
const dimension = z.number().finite().positive().max(1e6).optional();
const fields = z.object({ perCarton: z.number().int().positive().max(1e6).optional(), cartonWeight: dimension, cartonLength: dimension, cartonWidth: dimension, cartonHeight: dimension }).strict();
const row = z.object({ sku: z.string().trim().min(1).max(500), stock: z.record(qty).optional(), transactions: z.record(transaction).optional(), fields: fields.optional() }).strict();
const payload = z.object({ rows: z.array(row).min(1).max(50000), filename: z.string().trim().min(1).max(300), observedAt: z.string().datetime().optional(), version: z.string().length(64).optional() }).strict();
type Payload = z.infer<typeof payload>;
type Db = StaffEnv['db'];
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
const digest = async (value: unknown) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value))))].map(n => n.toString(16).padStart(2, '0')).join('');
const key = (sku: string) => sku.toLowerCase();
const parts = <T>(xs: T[], size = 500) => Array.from({ length: Math.ceil(xs.length / size) }, (_, i) => xs.slice(i * size, (i + 1) * size));

async function plan(db: Db | Tx, kind: string, input: Payload, lock = false) {
  const isStock = kind === 'stock' || kind === 'sapo-stock';
  if (!isStock && kind !== 'packing') throw new AppError(400, 'Loại file không hợp lệ.');
  if (kind !== 'sapo-stock' && input.rows.length > 5000) throw new AppError(400, 'Tối đa 5.000 mã mỗi lượt.');
  const keys = input.rows.map(r => key(r.sku));
  if (new Set(keys).size !== keys.length) throw new AppError(400, 'Mã SKU trùng trong dữ liệu nhập.');
  if (isStock && (!input.observedAt || Date.parse(input.observedAt) > Date.now() + 300000)) throw new AppError(400, 'Nhập thời điểm số liệu tồn hợp lệ, không nằm trong tương lai.');
  for (const r of input.rows) {
    if (isStock ? !r.stock || !Object.keys(r.stock).length || !!r.fields : !r.fields || !Object.keys(r.fields).length || !!r.stock)
      throw new AppError(400, 'Dòng nhập không có dữ liệu đúng loại.');
    if (r.transactions) throw new AppError(400, 'Dữ liệu cập nhật tồn không nhận cột Đang giao dịch.');
    if (kind === 'stock' && Object.values(r.stock!).some(n => !Number.isInteger(n))) throw new AppError(400, 'Tồn của file cũ phải là số nguyên.');
  }
  const query = db.select().from(products).where(and(eq(products.active, true), inArray(sql<string>`lower(${products.sku})`, keys))).orderBy(asc(products.sku));
  const found = lock ? await query.for('update') : await query;
  const bySku = new Map<string, typeof found>();
  for (const p of found) bySku.set(key(p.sku), [...(bySku.get(key(p.sku)) || []), p]);
  const unknown: string[] = [], notLock: string[] = [], ambiguous: string[] = [];
  const matched: { sku: string; stock?: Record<string, number>; fields?: z.infer<typeof fields>; transactions?: z.infer<typeof row>['transactions'] }[] = [];
  for (const r of input.rows) {
    const hits = bySku.get(key(r.sku)) || [], p = hits.find(p => p.sku === r.sku) || (hits.length === 1 ? hits[0] : undefined);
    if (!hits.length) { unknown.push(r.sku); continue; }
    if (!p) { ambiguous.push(r.sku); continue; }
    if (kind === 'packing' && !/lock/i.test(p.brand + ' ' + p.name)) { notLock.push(r.sku); continue; }
    matched.push({ ...r, sku: p.sku });
  }
  const storeIds = [...new Set(matched.flatMap(r => Object.keys(r.stock || {})))];
  const stores = storeIds.length ? await db.select().from(warehouses).where(and(eq(warehouses.active, true), inArray(warehouses.id, storeIds))) : [];
  if (stores.length !== storeIds.length) throw new AppError(400, 'Kho nhận dữ liệu không còn hoạt động. Chọn lại kho.');
  if (kind === 'sapo-stock' && stores.some(w => w.kind !== 'stock')) throw new AppError(400, 'File Sapo chỉ cập nhật kho thực; không ghi vào tồn NCC hoặc hàng chờ về.');
  const skus = matched.map(r => r.sku);
  const stock = isStock && skus.length ? await db.select().from(productStock).where(and(inArray(productStock.sku, skus), inArray(productStock.warehouseId, storeIds))).orderBy(asc(productStock.sku), asc(productStock.warehouseId)) : [];
  const latest = isStock && storeIds.length ? await db.select({ at: sql<string>`max(${stockImports.observedAt})` }).from(stockImportLines).innerJoin(stockImports, eq(stockImports.revision, stockImportLines.importRevision)).where(inArray(stockImportLines.warehouseId, storeIds)) : [];
  if (latest[0]?.at && Date.parse(input.observedAt!) < Date.parse(latest[0].at)) throw new AppError(409, 'File tồn cũ hơn lần nhập gần nhất của kho. Kiểm tra lại thời điểm số liệu.');
  const version = await digest({ kind, filename: input.filename, observedAt: input.observedAt, rows: input.rows, products: found.map(p => [p.sku, p.updatedAt, p.perCarton, p.cartonWeight, p.cartonLength, p.cartonWidth, p.cartonHeight]), stock, stores, latest });
  const samples = matched.slice(0, 20).flatMap<Record<string, unknown>>(r => isStock ? Object.entries(r.stock!).map(([warehouseId, after]) => ({ sku: r.sku, warehouse: stores.find(w => w.id === warehouseId)!.name, before: stock.find(s => s.sku === r.sku && s.warehouseId === warehouseId)?.quantity ?? null, after, ...(r.transactions?.[warehouseId] ?? {}) }))
    : [{ sku: r.sku, before: Object.fromEntries(Object.keys(r.fields!).map(f => [f, found.find(p => p.sku === r.sku)![f as keyof typeof fields._type]])), after: r.fields }]);
  return { matched, stores, version, samples: samples.slice(0, 30), unknown, notLock, ambiguous };
}

export function registerProductActionRoutes(router: Router<StaffEnv>) {
  router.get('/admin/products/report', async c => {
    const db = c.env.db;
    const [all, policies, stores, stock, imports] = await Promise.all([
      db.select().from(products).where(eq(products.active, true)).orderBy(asc(products.sku)),
      db.select().from(pricePolicies).orderBy(asc(pricePolicies.sortOrder)),
      db.select().from(warehouses).where(eq(warehouses.active, true)).orderBy(asc(warehouses.sortOrder)),
      db.select().from(productStock), db.select().from(stockImports).orderBy(desc(stockImports.revision)).limit(1),
    ]);
    const policyId = c.url.searchParams.get('policy') || policies[0]?.id;
    const policy = policies.find(p => p.id === policyId);
    if (policyId && !policy) throw new AppError(400, 'Bảng giá không hợp lệ.');
    const prices = policy ? await db.select().from(productPrices).where(eq(productPrices.policyId, policy.id)) : [];
    const priceMap = new Map(prices.map(p => [p.sku, p.price])), bySku = new Map(all.map(p => [p.sku, p]));
    const inventory = stores.filter(w => w.kind === 'stock').map(w => {
      const rows = stock.filter(s => s.warehouseId === w.id && bySku.has(s.sku) && s.quantity > 0);
      let value = 0, priced = 0, missingPrice = 0;
      for (const s of rows) { const price = priceMap.get(s.sku); if (price === null || price === undefined) missingPrice++; else { value += price * s.quantity; priced++; } }
      return { warehouse: w.name, units: rows.reduce((n, s) => n + s.quantity, 0), priced, missingPrice, value };
    });
    const missingPackaging = all.filter(p => ![p.perCarton, p.cartonWeight, p.cartonLength, p.cartonWidth, p.cartonHeight].every(n => n !== null && n > 0));
    const missingPrice = all.filter(p => priceMap.get(p.sku) === null || priceMap.get(p.sku) === undefined);
    const negative = stock.filter(s => s.quantity < 0 && bySku.has(s.sku) && stores.some(w => w.id === s.warehouseId));
    const physical = new Set(stores.filter(w => w.kind === 'stock').map(w => w.id));
    const withStock = new Set(stock.filter(s => s.quantity > 0 && physical.has(s.warehouseId)).map(s => s.sku));
    const summary = { products: all.length, missingPackaging: missingPackaging.length, missingPrice: missingPrice.length, negativeStock: new Set(negative.map(s => s.sku)).size, zeroStock: all.filter(p => !withStock.has(p.sku)).length, totalValue: inventory.reduce((n, w) => n + w.value, 0) };
    const sample = (rows: typeof all) => rows.slice(0, 50).map(p => ({ sku: p.sku, name: p.name, brand: p.brand }));
    return json({ policy: policy ?? null, policies, inventory, summary, samples: { missingPackaging: sample(missingPackaging), missingPrice: sample(missingPrice), negativeStock: negative.slice(0, 50).map(s => ({ sku: s.sku, name: bySku.get(s.sku)!.name, warehouse: stores.find(w => w.id === s.warehouseId)!.name, quantity: s.quantity })) }, lastImport: imports[0] ?? null });
  }, 'admin');

  for (const action of ['preview', 'apply']) router.post('/admin/products/import/:kind/' + action, async c => {
    const parsed = payload.safeParse(await readJson(c.req, 20000000));
    if (!parsed.success) throw new AppError(400, 'Dữ liệu file không hợp lệ. Tối đa 50.000 mã cho file Sapo, 5.000 mã cho file khác.');
    const input = parsed.data, kind = c.params.kind!;
    const summarize = (p: Awaited<ReturnType<typeof plan>>) => ({ version: p.version, matched: p.matched.length, cells: p.matched.reduce((n, r) => n + Object.keys(r.stock || r.fields || {}).length, 0), samples: p.samples, unknownCount: p.unknown.length, unknown: p.unknown.slice(0, 100), notLockCount: p.notLock.length, notLock: p.notLock.slice(0, 100), ambiguousCount: p.ambiguous.length, ambiguous: p.ambiguous.slice(0, 100) });
    if (action === 'preview') return json(summarize(await plan(c.env.db, kind, input)));
    if (!input.version) throw new AppError(400, 'Xem trước file trước khi cập nhật.');
    const actor = (c.state.session as SessionState).member.id, now = new Date().toISOString();
    const result = await c.env.db.transaction(async tx => {
      // Serialise stock imports, including disjoint SKU files targeting the same warehouse.
      if (kind === 'stock' || kind === 'sapo-stock') await tx.execute(sql`select pg_advisory_xact_lock(hashtext('crm-stock-file-import'))`);
      const p = await plan(tx, kind, input, true);
      if (p.version !== input.version) throw new AppError(409, 'Dữ liệu đã thay đổi. Xem trước lại trước khi cập nhật.');
      if (!p.matched.length) throw new AppError(400, 'Không có mã sản phẩm phù hợp để cập nhật.');
      if (kind === 'stock' || kind === 'sapo-stock') {
        const revision = Date.now() * 1000 + Math.floor(Math.random() * 1000);
        // Kho "Hàng chờ về" do hệ thống tự tính từ Đơn mua NCC – file tồn không ghi đè.
        const incoming = new Set((await tx.select({ id: warehouses.id }).from(warehouses).where(eq(warehouses.kind, 'incoming'))).map(w => w.id));
        const rows = p.matched.flatMap(r => Object.entries(r.stock!).filter(([warehouseId]) => !incoming.has(warehouseId)).map(([warehouseId, quantity]) => ({ sku: r.sku, warehouseId, quantity, onHand: r.transactions?.[warehouseId]?.onHand ?? null, committed: r.transactions?.[warehouseId]?.committed ?? null })));
        await tx.insert(stockImports).values({ revision, key: 'crm:' + crypto.randomUUID(), filename: input.filename, observedAt: input.observedAt!, createdAt: now, createdBy: actor, count: p.matched.length });
        for (const chunk of parts(rows)) {
          await tx.insert(productStock).values(chunk.map(({ sku, warehouseId, quantity }) => ({ sku, warehouseId, quantity, updatedAt: now }))).onConflictDoUpdate({ target: [productStock.sku, productStock.warehouseId], set: { quantity: sql`excluded.quantity`, updatedAt: sql`excluded.updated_at` } });
          await tx.insert(stockImportLines).values(chunk.map(r => ({ ...r, importRevision: revision })));
        }
      } else {
        const edits = await tx.select().from(productEdits).where(inArray(productEdits.sku, p.matched.map(r => r.sku)));
        const editMap = new Map(edits.map(e => [e.sku, e]));
        for (const chunk of parts(p.matched, 200)) {
          const changes: Record<string, unknown> = { updatedAt: now };
          for (const name of ['perCarton', 'cartonWeight', 'cartonLength', 'cartonWidth', 'cartonHeight'] as const) {
            const filled = chunk.filter(r => r.fields![name] !== undefined);
            if (filled.length) changes[name] = sql`CASE ${products.sku} ${sql.join(filled.map(r => sql`WHEN ${r.sku} THEN ${r.fields![name]}`), sql` `)} ELSE ${products[name]} END`;
          }
          await tx.update(products).set(changes).where(inArray(products.sku, chunk.map(r => r.sku)));
          const editRows = chunk.map(r => {
            const previous = editMap.get(r.sku); let data: Record<string, unknown> = {};
            try { data = JSON.parse(previous?.data || '{}'); } catch { /* dữ liệu cũ hỏng: chỉ ghi phần quy cách mới */ }
            return { sku: r.sku, data: JSON.stringify({ ...data, ...r.fields }), revision: (previous?.revision ?? 0) + 1, updatedAt: now, updatedBy: actor };
          });
          await tx.insert(productEdits).values(editRows).onConflictDoUpdate({ target: productEdits.sku, set: { data: sql`excluded.data`, revision: sql`excluded.revision`, updatedAt: sql`excluded.updated_at`, updatedBy: sql`excluded.updated_by` } });
        }
      }
      return summarize(p);
    });
    return json({ ...result, updatedAt: now });
  }, 'admin');
}
