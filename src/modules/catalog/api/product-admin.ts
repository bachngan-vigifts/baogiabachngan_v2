import {registerProductArchiveRoutes} from './product-archive.ts';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type { Router, RouteContext } from '../../../core/http/router.ts';
import { json, readJson } from '../../../core/http/router.ts';
import { sniffImage } from '../../../core/http/image-bytes.ts';
import { auditLogs } from '../../../core/db/schema.ts';
import { AppError } from '../../../core/errors.ts';
import type { SessionState, StaffEnv } from '../../staff/api/auth-routes.ts';
import { employees } from '../../staff/schema.ts';
import { can, canApprove } from '../../staff/domain/permissions.ts';
import { pricePolicies, productPrices, productBarcodes, products } from '../schema.ts';
import { requireNewProductPrices } from '../domain/product-approval.ts';

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
    // #780: giá VND là số nguyên. Làm tròn ngầm từng biến 101000.52 thành 101001 và lệch bill.
    if (!Number.isInteger(n)) throw new AppError(400, 'Giá sản phẩm phải là số nguyên đồng, không có phần lẻ.');
    prices[String(policyId).slice(0, 80)] = n;
  }
  const packaging:Partial<Pick<typeof products.$inferInsert,'perCarton'|'cartonWeight'|'cartonLength'|'cartonWidth'|'cartonHeight'>>={};
  for(const key of ['perCarton','cartonWeight','cartonLength','cartonWidth','cartonHeight'] as const){
    if(!Object.hasOwn(body,key))continue;
    const value=body[key];
    if(value===null||value===''){packaging[key]=null;continue;}
    if(typeof value!=='number'||!Number.isFinite(value)||value<=0||value>1e6||(key==='perCarton'&&!Number.isInteger(value)))throw new AppError(400,'Quy cách thùng phải là số dương; số SP/thùng là số nguyên.');
    packaging[key]=value;
  }
  const tax: Partial<Pick<typeof products.$inferInsert, 'taxOut' | 'taxable'>> = {};
  if (existingSku === undefined || Object.hasOwn(body, 'taxRate')) {
    const rate = body.taxRate === undefined ? 8 : body.taxRate;
    if (rate !== 8 && rate !== 10) throw new AppError(400, 'Thuế sản phẩm phải là 8% hoặc 10%.');
    tax.taxOut = rate; tax.taxable = true;
  }
  const classification: Partial<Pick<typeof products.$inferInsert, 'category' | 'collection'>> = {};
  for (const key of ['category', 'collection'] as const) {
    if (!Object.hasOwn(body, key)) continue;
    // Client đọc GET rồi gửi lại nguyên bản: null = chưa có giá trị (xoá), không phải lỗi.
    if (body[key] === null) { classification[key] = null; continue; }
    if (typeof body[key] !== 'string') throw new AppError(400, 'Danh mục và bộ sưu tập phải là văn bản.');
    classification[key] = t(key, 200);
  }
  return { sku, name, packaging, tax, classification, brand: t('brand', 200), unit: t('unit', 50), pattern: t('pattern', 200), imageUrl, prices };
}

type Tx = Parameters<Parameters<StaffEnv['db']['transaction']>[0]>[0];
function barcodeInput(body: Record<string, unknown>, manager: boolean) {
  if (!Object.hasOwn(body, 'barcode')) return null;
  if (!manager) throw new AppError(403, 'Chỉ Manager được gắn mã vạch.');
  if (typeof body.barcode !== 'string' || body.barcode.length > 100) throw new AppError(400, 'Mã vạch tối đa 100 ký tự.');
  const code = body.barcode.trim();
  if (code && !/^[\x21-\x7e]+$/.test(code)) throw new AppError(400, 'Mã vạch không có khoảng trắng hoặc ký tự có dấu.');
  return code || null;
}

/** Add an alias atomically with the product save. Existing scan codes stay valid. */
async function attachBarcode(tx: Tx, sku: string, barcode: string | null, actorId: string, now: string) {
  if (!barcode) return;
  const [collision] = barcode !== sku ? await tx.select({ sku: products.sku }).from(products).where(eq(products.sku, barcode)).limit(1) : [];
  if (collision) throw new AppError(409, 'Mã vạch trùng SKU của sản phẩm khác.');
  const [used] = await tx.select().from(productBarcodes).where(eq(productBarcodes.barcode, barcode));
  if (used) {
    if (used.sku !== sku) throw new AppError(409, 'Mã vạch đã gắn sản phẩm khác.');
    return;
  }
  await tx.insert(productBarcodes).values({ barcode, sku }).onConflictDoNothing();
  const [saved] = await tx.select().from(productBarcodes).where(eq(productBarcodes.barcode, barcode));
  if (saved?.sku !== sku) throw new AppError(409, 'Mã vạch vừa được gắn sản phẩm khác. Tải lại và kiểm tra.');
  await tx.insert(auditLogs).values({ id: crypto.randomUUID(), actorId, module: 'catalog', action: 'barcode-add', entityType: 'products', entityId: sku, data: JSON.stringify({ barcode, sku }), createdAt: now });
}

/**
 * Thêm sản phẩm trên web và duyệt:
 *  - Manager thêm → có hiệu lực ngay. Nhân viên thêm → `pending`, ẩn khỏi danh mục báo giá (active = false) tới khi được duyệt.
 *  - Duyệt / từ chối: Manager hoặc người được Manager bật cờ "Được duyệt"; người tạo tự xoá được sản phẩm còn chờ duyệt của mình.
 */
export function registerProductAdminRoutes(router: Router<StaffEnv>) {
  registerProductArchiveRoutes(router);
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
    const body = await readJson(c.req, 16_000);
    const me = viewer(c), db = c.env.db, f = cleanProduct(body), now = new Date().toISOString(), mgr = me.role === 'manager', barcode=barcodeInput(body,mgr);
    if ((await db.select({ sku: products.sku }).from(products).where(eq(products.sku, f.sku)).limit(1)).length) throw new AppError(409, `Mã ${f.sku} đã có trong danh mục.`);
    const configuredPolicies = await db.select({ id: pricePolicies.id, name: pricePolicies.name }).from(pricePolicies).orderBy(asc(pricePolicies.sortOrder));
    requireNewProductPrices(configuredPolicies, (body.prices || {}) as Record<string, unknown>);
    const policies = new Set(configuredPolicies.map(p => p.id));
    const priceRows = Object.entries(f.prices).filter(([id]) => policies.has(id)).map(([policyId, price]) => ({ sku: f.sku, policyId, price }));
    await db.transaction(async tx => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('product-barcode-import'))`);
      const [reserved]=await tx.select({sku:productBarcodes.sku}).from(productBarcodes).where(eq(productBarcodes.barcode,f.sku)).limit(1);
      if(reserved&&reserved.sku!==f.sku)throw new AppError(409,'SKU đã là mã vạch của sản phẩm khác.');
      await tx.insert(products).values({ sku: f.sku, ...f.packaging, ...f.tax, ...f.classification, name: f.name, brand: f.brand, unit: f.unit, pattern: f.pattern, imageUrl: f.imageUrl,
        active: mgr, approvalStatus: mgr ? 'approved' : 'pending', createdBy: me.id, approvedBy: mgr ? me.id : null, approvedAt: mgr ? now : null, updatedAt: now });
      if (priceRows.length) await tx.insert(productPrices).values(priceRows);
      await attachBarcode(tx,f.sku,barcode,me.id,now);
    });
    return json({ sku: f.sku, approvalStatus: mgr ? 'approved' : 'pending' }, 201);
  }, 'business');

  router.post('/product-images', async c => {
    const me = viewer(c), store = c.env.productImages;
    if (!['manager','employee'].includes(me.role)) throw new AppError(403, 'Chưa có quyền tải ảnh sản phẩm.');
    if (!store?.publicUrl) throw new AppError(503, 'Kho ảnh sản phẩm chưa sẵn sàng. Vui lòng thử lại sau.');
    const body = await readJson(c.req, 350_000), data = typeof body.image === 'string' ? body.image : '';
    const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(data);
    if (!match) throw new AppError(400, 'Chọn ảnh JPG, PNG hoặc WebP hợp lệ.');
    let bytes: Uint8Array;
    try { bytes = Uint8Array.from(atob(match[2]!), ch => ch.charCodeAt(0)); }
    catch { throw new AppError(400, 'Dữ liệu ảnh không hợp lệ.'); }
    if (bytes.length > 240_000) throw new AppError(413, 'Ảnh quá lớn. Chọn ảnh nhỏ hơn rồi thử lại.');
    if (sniffImage(bytes) !== match[1]) throw new AppError(415, 'Nội dung file không đúng định dạng ảnh.');
    const ext = { 'image/jpeg':'jpg', 'image/png':'png', 'image/webp':'webp' }[match[1]!]!;
    const key = `uploads/${crypto.randomUUID()}.${ext}`;
    // Tên file ngẫu nhiên, không bao giờ ghi đè → trình duyệt / CDN giữ ảnh 1 năm, mở lại không phải tải lại.
    await store.put(key, bytes, match[1]!, { cacheSeconds: 31_536_000 });
    return json({ imageUrl: store.publicUrl(key) }, 201);
  }, 'business');

  router.put('/products/:sku', async c => {
    const me = viewer(c);
    if (!['manager', 'employee'].includes(me.role)) throw new AppError(403, 'Chỉ nhân viên được cập nhật sản phẩm.');
    const body = await readJson(c.req, 16_000), sku = c.params.sku!;
    if (body.sku !== undefined && body.sku !== sku) throw new AppError(400, 'Không đổi mã SKU của sản phẩm đã có.');
    const f = cleanProduct(body, sku), expected = body.expectedUpdatedAt, barcode=barcodeInput(body,me.role==='manager');
    if (typeof expected !== 'string' || !expected) throw new AppError(400, 'Tải lại thông tin sản phẩm trước khi cập nhật.');
    const rawPrices = body.prices && typeof body.prices === 'object' ? body.prices as Record<string, unknown> : {};
    const seesPrices = me.role === 'manager' || ['page.quotes', 'page.orders', 'page.contracts'].some(k => can(me, k));
    if (Object.keys(rawPrices).length && !seesPrices) throw new AppError(403, 'Chưa có quyền cập nhật giá sản phẩm.');
    await c.env.db.transaction(async tx => {
      if(barcode)await tx.execute(sql`select pg_advisory_xact_lock(hashtext('product-barcode-import'))`);
      const [before] = await tx.select().from(products).where(eq(products.sku, sku)).limit(1).for('update');
      if (!before) throw new AppError(404, 'Không tìm thấy sản phẩm.');
      if (before.updatedAt !== expected) throw new AppError(409, 'Sản phẩm vừa được thay đổi. Đóng và mở lại để lấy thông tin mới.', 'PRODUCT_CHANGED');
      if (before.approvalStatus !== 'approved') throw new AppError(409, 'Sản phẩm đang chờ duyệt. Duyệt sản phẩm trước khi cập nhật.');
      const policies = new Set((await tx.select({ id: pricePolicies.id }).from(pricePolicies)).map(p => p.id));
      if (Object.keys(rawPrices).some(id => !policies.has(id))) throw new AppError(400, 'Bảng giá không tồn tại. Tải lại danh mục rồi thử lại.');
      const oldPrices = await tx.select().from(productPrices).where(eq(productPrices.sku, sku));
      const changedPrices = Object.entries(rawPrices).map(([policyId, value]) => ({ sku, policyId, price: value == null || value === '' ? null : f.prices[policyId]! }));
      const now = new Date(Math.max(Date.now(), Date.parse(before.updatedAt) + 1)).toISOString();
      const fields = { name: f.name, brand: f.brand, unit: f.unit, pattern: f.pattern, imageUrl: f.imageUrl, ...f.packaging, ...f.tax, ...f.classification };
      await attachBarcode(tx,sku,barcode,me.id,now);
      await tx.update(products).set({ ...fields, updatedAt: now }).where(eq(products.sku, sku));
      for (const row of changedPrices) await tx.insert(productPrices).values(row).onConflictDoUpdate({ target: [productPrices.sku, productPrices.policyId], set: { price: row.price } });
      await tx.insert(auditLogs).values({ id: crypto.randomUUID(), actorId: me.id, module: 'catalog', action: 'update', entityType: 'products', entityId: sku,
        data: JSON.stringify({ before: { category:before.category,collection:before.collection,name: before.name, brand: before.brand, unit: before.unit, pattern: before.pattern, imageUrl: before.imageUrl, taxOut: before.taxOut, taxable: before.taxable, perCarton:before.perCarton,cartonWeight:before.cartonWeight,cartonLength:before.cartonLength,cartonWidth:before.cartonWidth,cartonHeight:before.cartonHeight, prices: oldPrices }, after: { ...fields, category:f.classification.category??before.category,collection:f.classification.collection??before.collection,taxOut: f.tax.taxOut ?? before.taxOut, taxable: f.tax.taxable ?? before.taxable, prices: changedPrices } }), createdAt: now });
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
