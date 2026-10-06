// Sinh docs/DATA-MODEL.md từ schema thật. Chạy: npm run docs:data-model
import { writeFileSync } from 'node:fs';
import { getTableConfig, PgTable, type AnyPgTable } from 'drizzle-orm/pg-core';
import { is } from 'drizzle-orm';
import { getTableConfig as getLegacyConfig, SQLiteTable, type AnySQLiteTable } from 'drizzle-orm/sqlite-core';
const tablesIn = (mod: Record<string, unknown>) => Object.values(mod).filter(v => is(v, PgTable)) as AnyPgTable[];
const legacyTablesIn = (mod: Record<string, unknown>) => Object.values(mod).filter(v => is(v, SQLiteTable)) as AnySQLiteTable[];
import * as legacy from '../tests/db/fixtures/legacy-schema.ts';
import { legacyRuntimeDdl } from '../tests/db/fixtures/legacy-runtime-ddl.ts';
import * as staff from '../src/modules/staff/schema.ts';
import * as customers from '../src/modules/customers/schema.ts';
import * as catalog from '../src/modules/catalog/schema.ts';
import * as quotes from '../src/modules/quotes/schema.ts';
import * as contracts from '../src/modules/contracts/schema.ts';
import * as suppliers from '../src/modules/suppliers/schema.ts';
import * as printing from '../src/modules/printing/schema.ts';
import * as crm from '../src/modules/crm/schema.ts';
import * as work from '../src/modules/work/schema.ts';
import * as notifications from '../src/modules/notifications/schema.ts';
import * as integrations from '../src/modules/integrations/schema.ts';
import * as core from '../src/core/db/schema.ts';

const mods: [string, Record<string, unknown>, string][] = [
  ['core', core, 'Dùng chung'], ['staff', staff, 'Nhân viên, chức vụ, đăng nhập'], ['customers', customers, 'Khách hàng'],
  ['catalog', catalog, 'Sản phẩm, giá, kho, tồn kho'], ['quotes', quotes, 'Báo giá'], ['contracts', contracts, 'Hợp đồng'],
  ['suppliers', suppliers, 'Hàng sắp về và đơn nhà cung cấp'], ['printing', printing, 'Xưởng in'], ['crm', crm, 'CRM và bản sao AppSheet VIGIFTS'],
  ['work', work, 'Báo cáo công việc, ca, tiền mặt'], ['notifications', notifications, 'Thông báo web/push'], ['integrations', integrations, 'Sapo'],
];
const legacyCols = new Map(legacyTablesIn(legacy).map(getLegacyConfig).map(t => [t.name, new Set(t.columns.map(c => c.name))]));
const runtime = new Set(Object.keys(legacyRuntimeDdl));

let total = 0;
let out = `# Mô hình dữ liệu\n\n> File này được **sinh tự động** từ schema (\`npm run docs:data-model\`). Đừng sửa tay.\n\n`
  + `Trạng thái: **giữ nguyên** = cùng cột với bản cũ · **đổi** = bản cũ có, đã thêm/bỏ cột · **hợp thức hoá** = bản cũ tự tạo lúc chạy, nay có migration · **mới** = chưa có ở bản cũ.\n`;
for (const [name, mod, title] of mods) {
  out += `\n## ${name} — ${title}\n\n| Bảng | Số cột | Trạng thái | Ghi chú |\n|---|---|---|---|\n`;
  for (const t of tablesIn(mod).map(getTableConfig).sort((a, b) => a.name.localeCompare(b.name))) {
    total++;
    const cols = new Set(t.columns.map(c => c.name)), old = legacyCols.get(t.name);
    let status = 'mới', note = '';
    if (runtime.has(t.name)) { status = 'hợp thức hoá'; const o = [...cols].filter(c => !new Set(Object.values(legacyRuntimeDdl[t.name]!.match(/\b[a-z_]+(?= (?:TEXT|INTEGER))/g) ?? [])).has(c)); if (o.length) note = `thêm cột: ${o.join(', ')}`; }
    else if (old) {
      const added = [...cols].filter(c => !old.has(c)), removed = [...old].filter(c => !cols.has(c));
      status = added.length || removed.length ? 'đổi' : 'giữ nguyên';
      note = [added.length && `thêm: ${added.join(', ')}`, removed.length && `bỏ: ${removed.join(', ')}`].filter(Boolean).join('; ');
    }
    out += `| \`${t.name}\` | ${t.columns.length} | ${status} | ${note} |\n`;
  }
}
out = out.replace('Trạng thái:', `Tổng: **${total} bảng**.\n\nTrạng thái:`);
writeFileSync(new URL('../docs/DATA-MODEL.md', import.meta.url), out);
console.log(`docs/DATA-MODEL.md: ${total} bảng`);
