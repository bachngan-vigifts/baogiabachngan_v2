// HỒ SƠ ĐỐI SOÁT KHO LỊCH SỬ – CHỈ ĐỌC. Dùng:
//   DATABASE_URL=postgres://… npx tsx scripts/stock-reconciliation-dossier.ts > doi-soat-kho.md
// Chạy trong giao dịch READ ONLY (Postgres từ chối mọi lệnh ghi). Không in thông tin kết nối.
// Nội dung: docs/DOI-SOAT-KHO-LICH-SU.md. Mỗi đơn có ô duyệt; xử lý sau duyệt đi qua chứng từ trong ứng dụng.
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import * as schema from '../src/db/schema.ts';
import type { AnyDb } from '../src/core/db/client.ts';
import { buildReconciliationDossier, renderDossierMarkdown } from '../src/app/stock-reconciliation.ts';

const url = process.env.DATABASE_URL;
if (!url) { console.error('Thiếu DATABASE_URL.'); process.exit(1); }
const client = postgres(url, { max: 1, prepare: false, onnotice: () => {} });
try {
  const db = drizzle(client, { schema }) as unknown as AnyDb;
  const dossier = await db.transaction(async tx => {
    await tx.execute(sql`set transaction read only`);
    return buildReconciliationDossier(tx as unknown as AnyDb);
  });
  console.log(process.argv.includes('--json') ? JSON.stringify(dossier, null, 2) : renderDossierMarkdown(dossier));
} catch (e) { console.error('Lỗi: ' + (e as Error).message); process.exitCode = 1; }
finally { await client.end({ timeout: 5 }); }
