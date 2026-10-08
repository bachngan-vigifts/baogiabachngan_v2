import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInThisContext } from 'node:vm';

// Bộ dựng HĐKT của giao diện (trial-ui/contract-document.js) chạy thẳng trên mẫu .docx thật.
const ui = join(import.meta.dirname, '../../trial-ui');
runInThisContext(readFileSync(join(ui, 'fflate.min.js'), 'utf8'));
runInThisContext(readFileSync(join(ui, 'contract-document.js'), 'utf8'));
const g = globalThis as unknown as { fflate: { unzipSync(b: Uint8Array): Record<string, Uint8Array>; strFromU8(b: Uint8Array): string }; ContractDocument: { build(o: unknown): Promise<Uint8Array> } };

async function signature(set: 'bach-ngan' | 'vigifts', file: 'hdkt' | 'bien-ban', documentType: string) {
  const out = await g.ContractDocument.build({
    quote: { quote_type: set === 'vigifts' ? 'VIGIFTS' : 'B2B', quote_date: '2026-10-07', items: [], customer: { name: 'Công ty thử' } },
    contractNumber: 'X', templateBytes: readFileSync(join(ui, `mau-hop-dong-${set}-${file}.docx`)), documentType,
    details: { representativeName: 'Nguyễn Văn Ánh', depositRate: 30, paymentDays: 7 },
  });
  const xml = g.fflate.strFromU8(g.fflate.unzipSync(out)['word/document.xml']!);
  const table = (xml.match(/<w:tbl>(?:(?!<w:tbl>)[\s\S])*?<\/w:tbl>/g) ?? []).find(t => /ĐẠI DIỆN BÊN (A|NHẬN)/.test(t));
  assert.ok(table, `${set}-${file}: có khối chữ ký`);
  const text = (table.match(/<w:t\b[^>]*>[^<]*<\/w:t>/g) ?? []).map(t => t.replace(/<[^>]+>/g, '')).join('|');
  return { table, text };
}

test('HĐKT / biên bản: tên đại diện bên A in hoa ở khối chữ ký; bảng chữ ký 2 cột bằng nhau, căn giữa, không trôi', async () => {
  for (const [set, file, type] of [['bach-ngan', 'hdkt', 'HDKT'], ['bach-ngan', 'bien-ban', 'BBNT'], ['vigifts', 'hdkt', 'HDKT'], ['vigifts', 'bien-ban', 'BBNT']] as const) {
    const { table, text } = await signature(set, file, type);
    assert.match(text, /NGUYỄN VĂN ÁNH/, `${set}-${file}: ${text}`);
    assert.doesNotMatch(table, /<w:tblpPr/, `${set}-${file}: bảng không trôi`);
    assert.match(table, /<w:tblPr>[\s\S]*<w:jc w:val="center"\/>[\s\S]*<\/w:tblPr>/);
    const cols = [...table.matchAll(/<w:gridCol w:w="(\d+)"\/>/g)].map(m => m[1]);
    assert.equal(new Set(cols).size, 1, `${set}-${file}: cột bằng nhau ${cols}`);
  }
});
