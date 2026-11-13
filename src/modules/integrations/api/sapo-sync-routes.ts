import { and, asc, count, eq, inArray, isNotNull, like, max, ne, sql, type AnyColumn } from 'drizzle-orm';
import type { Router, RouteContext } from '../../../core/http/router.ts';
import type { AnyDb } from '../../../core/db/client.ts';
import { json, readJson } from '../../../core/http/router.ts';
import { AppError } from '../../../core/errors.ts';
import { fold } from '../../../core/text/fold.ts';
import type { StaffEnv } from '../../staff/api/auth-routes.ts';
import { credentials, employees, sessions, staffSapoLinks } from '../../staff/schema.ts';
import { customers } from '../../customers/schema.ts';
import { customerIdentityLock, identityColumns } from '../../customers/api/identity.ts';
import { changedIdentity, customerIdentityIndex } from '../../customers/domain/identity.ts';
import { pricePolicies, productPrices, products, productStock, warehouses } from '../../catalog/schema.ts';
import { sapoInventoryDocs } from '../schema.ts';
import { registerSapoPullRoutes, pullStatus } from './sapo-pull.ts';
import { isEligibleSapoCustomer, mapSapoCustomer, mapSapoProduct, mapSapoStaff, records, type SapoCustomer, type SapoVariant } from '../domain/sapo-mapping.ts';

type Ctx = RouteContext<StaffEnv>;
const MAX = { customers: 500, staff: 200, variants: 500 };
const tooMany = (n: number, what: string) => new AppError(400, `Mỗi lần đồng bộ tối đa ${n} ${what}.`);
const observedAt = (body: Record<string, unknown>) => {
  const t = Date.parse(String(body.observedAt ?? ''));
  if (Number.isFinite(t) && t > Date.now() + 300_000) throw new AppError(400, 'Thời điểm lấy dữ liệu không hợp lệ.');
  return Number.isFinite(t) ? t : Date.now();
};

/** Đường dẫn nhận dữ liệu Sapo (khai báo cho Codex/luồng trung gian và webhook Sapo). Giữ như web cũ. */
export const SAPO_SYNC_PATHS = { products: '/integrations/sapo/product', customers: '/integrations/sapo/customers', staff: '/integrations/sapo/staff' } as const;
export const SAPO_GOODS_RECEIPT_RESULT_PATH = '/integrations/sapo/goods-receipt-result';

/**
 * Đồng bộ một chiều Sapo → app (sản phẩm, khách hàng, nhân viên). Không dùng phiên đăng nhập: khu vực 'sapo-sync'
 * chỉ nhận yêu cầu mang đúng mã bí mật SAPO_SYNC_TOKEN (xem `authorizeRoute`). Chạy lại nhiều lần vẫn an toàn.
 */
export function registerSapoSyncRoutes(router: Router<StaffEnv>) {
  registerSapoPullRoutes(router);
  // Manager xem tình trạng đồng bộ (không bao giờ trả mã bí mật).
  router.get('/admin/sapo-sync', async c => {
    const db = c.env.db;
    const [[cus], [prod], [staff], [links], docs] = await Promise.all([
      db.select({ n: count(), last: max(customers.syncedAt) }).from(customers).where(sql`${customers.id} ~ '^[0-9]+$'`),
      db.select({ n: count(), last: max(products.updatedAt) }).from(products).where(isNotNull(products.sapoProductId)),
      db.select({ n: count() }).from(employees).where(like(employees.id, 'SAPO-%')),
      db.select({ n: count() }).from(staffSapoLinks),
      db.select({ kind: sapoInventoryDocs.kind, n: count(), last: max(sapoInventoryDocs.syncedAt) }).from(sapoInventoryDocs).groupBy(sapoInventoryDocs.kind),
    ]);
    return json({
      ...(await pullStatus(db)),
      configured: tokenConfigured(c),
      paths: SAPO_SYNC_PATHS,
      customers: { count: Number(cus?.n ?? 0), lastSyncedAt: cus?.last ?? null },
      products: { count: Number(prod?.n ?? 0), lastSyncedAt: prod?.last ?? null },
      staff: { count: Number(staff?.n ?? 0), linked: Number(links?.n ?? 0) },
      // Chứng từ kho Sapo: đơn nhập hàng, đơn điều chuyển, phiếu kiểm hàng.
      docs: Object.fromEntries(docs.map(d => [d.kind, { count: Number(d.n), lastSyncedAt: d.last }])),
    });
  }, 'admin');
  router.post(SAPO_SYNC_PATHS.customers, async c => json(await syncCustomers(c.env.db, await readJson(c.req, 2_000_000))), 'sapo-sync');
  router.post(SAPO_SYNC_PATHS.staff, async c => json(await syncStaff(c.env.db, await readJson(c.req, 500_000))), 'sapo-sync');
  router.post(SAPO_SYNC_PATHS.products, async c => json(await syncProducts(c.env.db, await readJson(c.req, 5_000_000))), 'sapo-sync');


}

export const tokenConfigured = (c: Ctx) => (c.env.sapoSyncToken ?? '').length >= 32;

// ---------------- Khách hàng ----------------
export async function syncCustomers(db: AnyDb, body: Record<string, unknown>) {
  const observed = observedAt(body), raw = records(body, 'customers', 'customer');
  if (raw.length > MAX.customers) throw tooMany(MAX.customers, 'khách hàng');
  const rows = raw.map(r => mapSapoCustomer(r, observed)).filter((r): r is SapoCustomer => !!r);
  if (new Set(rows.map(r => r.id)).size !== rows.length) throw new AppError(400, 'Trùng mã khách hàng trong một lần đồng bộ.');
  const now = new Date().toISOString();
  const search = (r: SapoCustomer) => fold([r.name, r.contact, r.phone, r.email, r.address, r.taxCode, r.customerCode].join(' '));
  const candidates = rows.filter(isEligibleSapoCustomer), others = rows.filter(r => !isEligibleSapoCustomer(r));
  let applied = 0, duplicates = 0, kept = 0;
  await db.transaction(async tx => {
    await customerIdentityLock(tx);
    const existing = await tx.select({...identityColumns, sourceVersion:customers.sourceVersion}).from(customers);
    const index = customerIdentityIndex(existing), versions = new Map(existing.map(r=>[r.id,r.sourceVersion]));
    const eligible = candidates.filter(r => {
      const previous = index.get(r.id);
      if (previous?.isRetail || (versions.get(r.id) ?? -1) > r.version) return true;
      if (index.find(changedIdentity(r,previous), r.id).length) { duplicates++; return false; }
      index.put({...r,isRetail:previous?.isRetail}); return true;
    });
    kept = eligible.length;
    if (eligible.length) {
      const done = await tx.insert(customers).values(eligible.map(r => ({
        id: r.id, name: r.name, contact: r.contact, phone: r.phone, email: r.email, address: r.address, taxCode: r.taxCode,
        customerCode: r.customerCode, search: search(r), sourceVersion: r.version, syncedAt: now, createdAt: r.createdAt, dataSource: 'sapo',
      }))).onConflictDoUpdate({
        target: customers.id,
        set: { name: sql`excluded.name`, contact: sql`excluded.contact`, phone: sql`excluded.phone`, email: sql`excluded.email`, address: sql`excluded.address`,
          taxCode: sql`excluded.tax_code`, customerCode: sql`excluded.customer_code`, search: sql`excluded.search`, sourceVersion: sql`excluded.source_version`, syncedAt: sql`excluded.synced_at` },
        // Bản Sapo cũ hơn bản đang có thì bỏ qua (webhook có thể đến không theo thứ tự).
        setWhere: sql`excluded.source_version >= ${customers.sourceVersion} and ${customers.isRetail} = false`,
      }).returning({ id: customers.id });
      applied = done.length;
    }
    // Khách lẻ / không MST: không tạo mới; nếu đã có thì chỉ cập nhật tên và MST (giống web cũ).
    for (const r of others) {
      const previous=index.get(r.id);
      if (!previous || previous.isRetail || (versions.get(r.id) ?? -1) > r.version) continue;
      if (index.find(changedIdentity({name:r.name,taxCode:r.taxCode,phone:previous.phone},previous),r.id).length) {duplicates++;continue;}
      await tx.update(customers).set({ name: r.name, taxCode: r.taxCode, search: search(r), sourceVersion: r.version, syncedAt: now })
        .where(and(eq(customers.id, r.id), eq(customers.isRetail, false), sql`${customers.sourceVersion} <= ${r.version}`));
      index.put({...previous,name:r.name,taxCode:r.taxCode});
    }
  });
  return { received: raw.length, applied, skipped: raw.length - kept, duplicates };
}

// ---------------- Nhân viên ----------------
export async function syncStaff(db: AnyDb, body: Record<string, unknown>) {
  const raw = records(body, 'members', 'account', ['accounts']);
  if (raw.length > MAX.staff) throw tooMany(MAX.staff, 'nhân viên');
  const rows = raw.map(mapSapoStaff).filter(r => !!r);
  if (new Set(rows.map(r => r.sapoId)).size !== rows.length) throw new AppError(400, 'Trùng mã nhân viên trong một lần đồng bộ.');
  const now = new Date().toISOString(), result = { received: raw.length, created: 0, updated: 0, linked: 0, deactivated: 0, skipped: raw.length - rows.length };
  await db.transaction(async tx => {
    const links = new Map((await tx.select().from(staffSapoLinks)).map(l => [l.sapoId, l.memberId]));
    const linkedMembers = new Set(links.values());
    for (const r of rows) {
      // Đã hợp nhất vào tài khoản web: tài khoản web do Manager quản lý, đồng bộ không đụng tới.
      if (links.has(r.sapoId)) { result.skipped++; continue; }
      if (!r.active) {
        // Nghỉ việc trên Sapo: khoá hồ sơ đã nhập từ Sapo và đăng xuất ngay; không bao giờ tạo mới người đã nghỉ.
        const off = await tx.update(employees).set({ active: false }).where(and(eq(employees.id, r.sapoId), ne(employees.role, 'manager'), eq(employees.active, true))).returning({ id: employees.id });
        if (off.length) { await tx.delete(sessions).where(eq(sessions.memberId, r.sapoId)); result.deactivated++; } else result.skipped++;
        continue;
      }
      const [own] = await tx.select({ id: employees.id }).from(employees).where(eq(employees.id, r.sapoId)).limit(1);
      if (own) {
        // Chỉ cập nhật tên/SĐT; chức vụ, quyền và trạng thái khoá do Manager quyết định trên web.
        await tx.update(employees).set({ name: r.name, ...(r.phone ? { phone: r.phone } : {}) }).where(eq(employees.id, r.sapoId));
        result.updated++; continue;
      }
      const [sameEmail] = r.email ? await tx.select({ id: employees.id }).from(employees).where(sql`lower(${employees.email}) = ${r.email}`).limit(1) : [];
      if (sameEmail) {
        // Nhân viên đã có tài khoản web cùng email: ghi nhận liên kết thay vì tạo hồ sơ trùng.
        if (!linkedMembers.has(sameEmail.id)) {
          await tx.insert(staffSapoLinks).values({ sapoId: r.sapoId, memberId: sameEmail.id, createdAt: now, evidence: 'email' });
          linkedMembers.add(sameEmail.id); result.linked++;
        } else result.skipped++;
        continue;
      }
      // Hồ sơ mới: chức vụ Sale, chưa có mật khẩu – Manager bấm "Cấp lại liên kết" để gửi liên kết kích hoạt.
      await tx.insert(employees).values({ id: r.sapoId, email: r.email || `${r.sapoId.toLowerCase()}@sapo.local.invalid`, name: r.name, phone: r.phone, role: 'employee', positionId: 'sale', active: true, createdAt: now });
      await tx.insert(credentials).values({ memberId: r.sapoId, version: 0 }).onConflictDoNothing();
      result.created++;
    }
  });
  return result;
}

// ---------------- Sản phẩm ----------------
const keep = <T>(value: T | null | '', column: AnyColumn) => value === null || value === '' ? sql`${column}` : value;

export async function syncProducts(db: AnyDb, body: Record<string, unknown>, locations: Map<string, string> = new Map()) {
  if (body.dry_run === true || body.test === true) return { ok: true, dryRun: true };
  const variants: SapoVariant[] = []; let skipped = 0;
  for (const p of records(body, 'products', 'product')) { const m = mapSapoProduct(p, locations); variants.push(...m.variants); skipped += m.skipped; }
  if (variants.length > MAX.variants) throw tooMany(MAX.variants, 'mã sản phẩm');
  if (!variants.length) throw new AppError(400, 'Dữ liệu Sapo không có SKU sản phẩm hợp lệ.');
  const now = new Date().toISOString(), unknownPolicies = new Set<string>(), unknownWarehouses = new Set<string>();
  const result = { received: variants.length, created: 0, updated: 0, hidden: 0, skipped };
  await db.transaction(async tx => {
    const policies = await tx.select().from(pricePolicies).orderBy(asc(pricePolicies.sortOrder), asc(pricePolicies.name));
    const stores = await tx.select().from(warehouses).where(eq(warehouses.active, true));
    // Kho "Hàng chờ về" do hệ thống tự tính từ Đơn mua NCC – đồng bộ Sapo không ghi đè.
    const policyId = new Map(policies.map(p => [p.name, p.id])), storeId = new Map(stores.filter(w => w.kind !== 'incoming').map(w => [w.name, w.id])), incomingNames = new Set(stores.filter(w => w.kind === 'incoming').map(w => w.name));
    const existing = new Set((await tx.select({ sku: products.sku }).from(products).where(inArray(products.sku, [...new Set(variants.map(v => v.sku))]))).map(r => r.sku));
    for (const v of variants) {
      if (!v.active) {
        // Ngừng bán trên Sapo: ẩn nếu đã có, không tạo mới.
        if (existing.has(v.sku)) { await tx.update(products).set({ active: false, updatedAt: now }).where(eq(products.sku, v.sku)); result.hidden++; } else result.skipped++;
        continue;
      }
      // Trường Sapo không gửi thì giữ giá trị đang có (kể cả kích thước thùng nhập tay).
      await tx.insert(products).values({
        sku: v.sku, name: v.name, brand: v.brand, pattern: v.pattern, unit: v.unit, imageUrl: v.imageUrl, taxBasis: v.taxBasis ?? '',
        taxable: v.taxable ?? false, taxIn: v.taxIn, taxOut: v.taxOut, sapoProductId: v.productId || null, active: true, updatedAt: now,
      }).onConflictDoUpdate({ target: products.sku, set: {
        name: v.name, brand: keep(v.brand, products.brand), pattern: keep(v.pattern, products.pattern), unit: keep(v.unit, products.unit),
        imageUrl: keep(v.imageUrl, products.imageUrl), taxBasis: keep(v.taxBasis, products.taxBasis), taxable: keep(v.taxable, products.taxable),
        taxIn: keep(v.taxIn, products.taxIn), taxOut: keep(v.taxOut, products.taxOut), sapoProductId: keep(v.productId, products.sapoProductId),
        active: sql`${products.archivedAt} is null`, updatedAt: now, approvalStatus: 'approved', // có trên Sapo = đã có hiệu lực
      } });
      existing.has(v.sku) ? result.updated++ : result.created++;
      existing.add(v.sku);
      const prices = { ...v.prices };
      // Giá bán lẻ của biến thể điền vào bảng giá đầu tiên nếu Sapo không gửi riêng bảng đó.
      if (v.retail !== null && policies[0] && !(policies[0].name in prices)) prices[policies[0].name] = v.retail;
      for (const [name, price] of Object.entries(prices)) {
        const id = policyId.get(name); if (!id) { unknownPolicies.add(name); continue; }
        await tx.insert(productPrices).values({ sku: v.sku, policyId: id, price }).onConflictDoUpdate({ target: [productPrices.sku, productPrices.policyId], set: { price } });
      }
      for (const [name, quantity] of Object.entries(v.stock)) {
        if (incomingNames.has(name)) continue;
        const id = storeId.get(name); if (!id) { unknownWarehouses.add(name); continue; }
        await tx.insert(productStock).values({ sku: v.sku, warehouseId: id, quantity, updatedAt: now }).onConflictDoUpdate({ target: [productStock.sku, productStock.warehouseId], set: { quantity, updatedAt: now } });
      }
    }
  });
  // Bảng giá/kho chưa có trong app thì bỏ qua (không tự tạo) và báo lại để Manager nhập danh mục đầy đủ trước.
  return { ...result, unknownPolicies: [...unknownPolicies], unknownWarehouses: [...unknownWarehouses] };
}
