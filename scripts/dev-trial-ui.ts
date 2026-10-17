/**
 * Chạy thử giao diện `trial-ui/` trên máy, không cần Supabase: PostgreSQL WASM (PGlite) + router thật của ứng dụng,
 * mô phỏng Edge Function `baogia-v2-api` (Bearer ↔ cookie phiên). Dữ liệu chỉ nằm trong bộ nhớ.
 * Chạy: `npm run ui:dev` rồi mở http://localhost:8787 – đăng nhập mgr@x.vn / mat-khau-12345 (Manager) hoặc emp@x.vn (nhân viên).
 */
import { createServer } from 'node:http';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { extname, join, normalize as normalizePath } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import * as schema from '../src/db/schema.ts';
import { createAppRouter } from '../src/app/router.ts';
import { memoryFileStore } from '../src/core/storage/file-store.ts';
import type { AnyDb } from '../src/core/db/client.ts';
import { PgFixture } from '../tests/helpers/postgres.ts';
import { seedStaff } from '../tests/helpers/staff-fixture.ts';

const root = join(import.meta.dirname, '..'), uiDir = join(root, 'trial-ui');
// Đính kèm tin nhắn khi chạy thử: lưu trong bộ nhớ (link = data URL).
const devFiles = memoryFileStore();
const PORT = Number(process.env.PORT || 8787), ORIGIN = `http://localhost:${PORT}`;

const client = new PGlite();
await client.waitReady;
const migrations = join(root, 'migrations/postgres');
for (const file of readdirSync(migrations).filter(f => f.endsWith('.sql')).sort()) {
  if (file.includes('supabase_access')) continue; // quyền của role Supabase, PGlite không có
  for (const stmt of readFileSync(join(migrations, file), 'utf8').split('--> statement-breakpoint')) if (stmt.trim()) await client.exec(stmt);
}
await seedStaff({ sqlite: new PgFixture(client) });
// Tài khoản chạy thử theo chức vụ: kho@x.vn (Kho), ketoan@x.vn (Kế toán), saleadmin@x.vn (Sale Admin) / mat-khau-12345.
{
  const { hashPassword } = await import('../src/core/auth/password.ts');
  const fx = new PgFixture(client);
  for (const [id, name, pos] of [['kho', 'Thủ kho', 'warehouse'], ['ketoan', 'Kế toán', 'accounting'], ['saleadmin', 'Sale Admin', 'sale-admin']]) {
    await fx.prepare("INSERT INTO staff_members (id,email,name,phone,role,position_id,active,created_at) VALUES (?,?,?,'0900','employee',?,1,'2026-01-01T00:00:00.000Z')").run(id, id + '@x.vn', name, pos);
    await fx.prepare('INSERT INTO staff_credentials (member_id,password_hash,activation_hash,activation_expires,version) VALUES (?,?,NULL,NULL,0)').run(id, await hashPassword('mat-khau-12345', 1000));
  }
}
// Vài sản phẩm mẫu để thử trang Sản phẩm và ô tìm sản phẩm (dữ liệu thật do bước nhập dữ liệu nạp vào Supabase).
await client.exec(`
  INSERT INTO price_policies (id, name, sort_order) VALUES ('le', 'Giá bán lẻ', 0), ('si', 'Giá sỉ', 1);
  INSERT INTO warehouses (id, name, kind, sort_order) VALUES ('q1', 'Kho Quận 1', 'stock', 0), ('hcv', 'Hàng chờ về', 'incoming', 9);
  INSERT INTO products (sku, name, brand, unit, taxable, tax_out, updated_at) VALUES
    ('LHC4125', 'Bình giữ nhiệt Lock&Lock 500ml', 'Lock&Lock', 'cái', true, 8, now()::text),
    ('ML-LY-02', 'Bộ ly sứ Minh Long 6 món', 'Minh Long', 'bộ', true, 10, now()::text),
    ('LYS-500', 'Bình nước thủy tinh LYS 500ml', 'LYS', 'cái', true, 8, now()::text);
  UPDATE products SET image_url = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACgAAAAoCAIAAAADnC86AAAAa0lEQVR4nO3WwQ3AIAxDUVbh3P136FbpBC1ORMFIP/LZTzkl7e7XljRgYGDgLXBErIPjff6CP8gCr8KiqtsSnFJF2xguqIoN7AKX1aHtujHwSrhmDzu94aytFNrfY4VP9Zzzc80KMDDw+fADM4kbDQFTe8YAAAAASUVORK5CYII=' WHERE sku = 'LHC4125';
  INSERT INTO product_prices (sku, policy_id, price) VALUES ('LHC4125', 'le', 185000), ('LHC4125', 'si', 166000), ('ML-LY-02', 'le', 320000), ('LYS-500', 'le', 145000);
  INSERT INTO product_stock (sku, warehouse_id, quantity, updated_at) VALUES ('LHC4125', 'q1', 120, now()::text), ('ML-LY-02', 'q1', 6, now()::text);
  INSERT INTO sapo_customers (id, name, contact, phone, email, address, search, tax_code, customer_code, source_version, synced_at) VALUES
    ('9001', 'Công ty Mẫu An Phát', 'Chị Mai', '0909000111', 'mai@anphat.test', '12 Nguyễn Huệ, Q1', 'cong ty mau an phat', '0300000001', 'AP01', 0, now()::text);
`);
const db = drizzle(client, { schema }) as unknown as AnyDb;
const router = createAppRouter();
const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };

createServer(async (req, res) => {
  const url = new URL(req.url || '/', ORIGIN);
  if (url.pathname.startsWith('/api/staff')) {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string' && k !== 'cookie') headers.set(k, v);
    const bearer = /^Bearer ([a-f0-9]{64})$/.exec(headers.get('authorization') || '')?.[1];
    headers.delete('authorization');
    if (bearer) headers.set('cookie', '__Host-bn-session=' + bearer);
    const response = await router.handle(new Request(ORIGIN + url.pathname + url.search, {
      method: req.method, headers, body: ['GET', 'HEAD'].includes(req.method || 'GET') ? undefined : Buffer.concat(chunks),
    // DEV_SAPO_PUSH=off: thử luồng sinh đơn / HĐKT trên máy dev không có Sapo (máy chủ thật luôn bắt buộc đẩy Sapo).
    }), { db, files: devFiles, passwordIterations: 1000, ...(process.env.DEV_SAPO_PUSH === 'off' ? { sapoOrderPush: 'off' as const } : {}) });
    const payload = await response.json() as Record<string, unknown>;
    const cookie = response.headers.get('set-cookie');
    if (cookie) payload.sessionToken = /__Host-bn-session=([a-f0-9]{64})/.exec(cookie)?.[1] || '';
    res.writeHead(response.status, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(payload));
    return;
  }
  const file = normalizePath(join(uiDir, url.pathname === '/' ? 'index.html' : url.pathname));
  if (!file.startsWith(uiDir) || !existsSync(file)) { res.writeHead(404); res.end('Không tìm thấy'); return; }
  let body: string | Buffer = readFileSync(file);
  // Trỏ giao diện về API trên máy này thay cho Edge Function.
  if (file.endsWith('.html')) body = body.toString().replace('<head>', `<head><meta name="bn-api" content="${ORIGIN}/api/staff">`);
  res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' });
  res.end(body);
}).listen(PORT, () => console.log(`Giao diện dùng thử: ${ORIGIN} (mgr@x.vn / mat-khau-12345)`));
