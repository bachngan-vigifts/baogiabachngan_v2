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
import type { AnyDb } from '../src/core/db/client.ts';
import { PgFixture } from '../tests/helpers/postgres.ts';
import { seedStaff } from '../tests/helpers/staff-fixture.ts';

const root = join(import.meta.dirname, '..'), uiDir = join(root, 'trial-ui');
const PORT = Number(process.env.PORT || 8787), ORIGIN = `http://localhost:${PORT}`;

const client = new PGlite();
await client.waitReady;
const migrations = join(root, 'migrations/postgres');
for (const file of readdirSync(migrations).filter(f => f.endsWith('.sql')).sort()) {
  if (file.includes('supabase_access')) continue; // quyền của role Supabase, PGlite không có
  for (const stmt of readFileSync(join(migrations, file), 'utf8').split('--> statement-breakpoint')) if (stmt.trim()) await client.exec(stmt);
}
await seedStaff({ sqlite: new PgFixture(client) });
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
    }), { db, passwordIterations: 1000 });
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
  if (file.endsWith('index.html')) body = body.toString().replace('<head>', `<head><meta name="bn-api" content="${ORIGIN}/api/staff">`);
  res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' });
  res.end(body);
}).listen(PORT, () => console.log(`Giao diện dùng thử: ${ORIGIN} (mgr@x.vn / mat-khau-12345)`));
