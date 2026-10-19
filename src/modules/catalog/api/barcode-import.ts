import { asc, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Router } from '../../../core/http/router.ts';
import { json, readJson } from '../../../core/http/router.ts';
import { AppError } from '../../../core/errors.ts';
import { writeAudit } from '../../../core/audit.ts';
import { sha256Hex } from '../../staff/domain/session.ts';
import type { StaffEnv, SessionState } from '../../staff/api/auth-routes.ts';
import { products, productBarcodes } from '../schema.ts';
type Db = StaffEnv['db'];
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
const payload = z.object({ filename: z.string().trim().min(1).max(300), rows: z.array(z.object({ sku: z.string().trim().min(1).max(500), barcode: z.string().trim().min(1).max(100).regex(/^[\x21-\x7e]+$/), rowNumber: z.number().int().min(2).max(1000000).optional() }).strict()).min(1).max(20000), version: z.string().length(64).optional() }).strict();
type Input = z.infer<typeof payload>;
const chunks = <T>(rows: T[], size = 500) => Array.from({ length: Math.ceil(rows.length / size) }, (_, i) => rows.slice(i * size, (i + 1) * size));
async function plan(db: Db | Tx, input: Input) {
  const rows: (Input['rows'][number] & { row: number })[] = [], seen = new Map<string, string>();
  const issues: { row: number; sku: string; barcode: string; message: string }[] = [];
  let duplicates = 0;
  input.rows.forEach((r, i) => {
    const previous = seen.get(r.barcode), row = r.rowNumber ?? i + 2;
    if (previous === r.sku) { duplicates++; return; }
    if (previous) { issues.push({ ...r, row, message: 'Một barcode đang gắn hai SKU trong file.' }); return; }
    seen.set(r.barcode, r.sku); rows.push({ ...r, row });
  });
  const skus = [...new Set([...rows.map(r => r.sku), ...rows.map(r => r.barcode)])];
  const codes = rows.map(r => r.barcode);
  const found = (await Promise.all(chunks(skus).map(ids => db.select({ sku: products.sku, name: products.name, active: products.active, approvalStatus: products.approvalStatus }).from(products).where(inArray(products.sku, ids)).orderBy(asc(products.sku))))).flat();
  const existing = (await Promise.all(chunks(codes).map(ids => db.select().from(productBarcodes).where(inArray(productBarcodes.barcode, ids)).orderBy(asc(productBarcodes.barcode))))).flat();
  const bySku = new Map(found.map(p => [p.sku, p])), byCode = new Map(existing.map(p => [p.barcode, p.sku]));
  const add: { sku: string; barcode: string }[] = [];
  let already = 0;
  for (const r of rows) {
    const p = bySku.get(r.sku), assigned = byCode.get(r.barcode);
    let message = !p ? 'SKU chưa có trong CRM.' : !p.active || p.approvalStatus !== 'approved' ? 'Sản phẩm chưa hoạt động/được duyệt.' : '';
    if (!message && bySku.has(r.barcode) && r.barcode !== r.sku) message = 'Barcode trùng SKU của sản phẩm khác.';
    if (!message && assigned && assigned !== r.sku) message = 'Barcode đã gắn sản phẩm khác trong CRM.';
    if (message) issues.push({ ...r, message });
    else if (!assigned) add.push({ sku: r.sku, barcode: r.barcode });
    else already++;
  }
  const version = sha256Hex(JSON.stringify({ rows, found, existing, issues }));
  return { version, total: input.rows.length, duplicates, existing: already, added: add.length, issueCount: issues.length, issues: issues.slice(0, 100), samples: rows.slice(0, 50).map(r => ({ ...r, name: bySku.get(r.sku)?.name || '' })), add };
}
export function registerBarcodeImportRoutes(router: Router<StaffEnv>) {
  for (const action of ['preview', 'apply']) router.post('/admin/product-barcodes/' + action, async c => {
    const parsed = payload.safeParse(await readJson(c.req, 4_000_000));
    if (!parsed.success) throw new AppError(400, 'File barcode cần 1–20.000 dòng SKU/Barcode dạng chữ; barcode tối đa 100 ký tự, không có khoảng trắng.');
    const input = parsed.data;
    const summary = (p: Awaited<ReturnType<typeof plan>>) => { const { add, ...rest } = p; return rest; };
    if (action === 'preview') return json(summary(await plan(c.env.db, input)));
    if (!input.version) throw new AppError(400, 'Xem trước file trước khi lưu barcode.');
    return json(await c.env.db.transaction(async tx => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('product-barcode-import'))`);
      const p = await plan(tx, input);
      if (p.version !== input.version) throw new AppError(409, 'Dữ liệu barcode đã thay đổi. Xem trước lại.');
      if (p.issueCount) throw new AppError(409, 'File có mã lỗi/trùng. Sửa các dòng được báo rồi xem trước lại.');
      for (const batch of chunks(p.add)) await tx.insert(productBarcodes).values(batch).onConflictDoNothing();
      for (const batch of chunks(p.add)) {
        const current = await tx.select().from(productBarcodes).where(inArray(productBarcodes.barcode, batch.map(r => r.barcode)));
        if (batch.some(r => !current.some(x => x.barcode === r.barcode && x.sku === r.sku))) throw new AppError(409, 'Barcode vừa bị thay đổi. Xem trước lại.');
      }
      if (p.added) await writeAudit(tx as Db, { actorId: (c.state.session as SessionState).member.id, module: 'catalog', action: 'barcode-import', entityType: 'product-barcodes', entityId: p.version, data: { filename: input.filename, added: p.added, existing: p.existing, duplicates: p.duplicates, mappings: p.add } });
      return summary(p);
    }));
  }, 'admin');
}
