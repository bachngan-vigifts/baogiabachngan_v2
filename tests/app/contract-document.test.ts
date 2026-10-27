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

test('đề nghị tạm ứng Vigifts: khối ký bên B không trôi, nằm bên phải (như cột bên B của HĐKT); biên bản Vigifts: ô "Đóng gói" không có dòng trống phía trên', async () => {
  const build = (file: string, documentType: string) => g.ContractDocument.build({
    quote: { quote_type: 'VIGIFTS', quote_date: '2026-10-07', customer: { name: 'Công ty thử' }, items: [{ name: 'Ấm đun', quantity: 250, unit: 'Bộ', price_after_discount: 307593, line_total: 76898250, tax_percent: 8, packaging_description: 'theo tiêu chuẩn nhà sản xuất' }] },
    contractNumber: 'X', templateBytes: readFileSync(join(ui, `mau-hop-dong-vigifts-${file}.docx`)), documentType, details: { representativeName: 'Nguyễn Văn Ánh', depositRate: 30, paymentDays: 7 },
  }).then(out => g.fflate.strFromU8(g.fflate.unzipSync(out)['word/document.xml']!));
  const tu = await build('tam-ung', 'TAM_UNG');
  const sign = (tu.match(/<w:tbl>(?:(?!<w:tbl>)[\s\S])*?<\/w:tbl>/g) ?? []).find(t => /ĐẠI DIỆN BÊN B/.test(t))!;
  assert.doesNotMatch(sign, /<w:tblpPr/); assert.match(sign, /<w:tblPr>[\s\S]*<w:jc w:val="right"\/>[\s\S]*<\/w:tblPr>/);
  const bb = await build('bien-ban', 'BBNT');
  const cell = (bb.match(/<w:tc>(?:(?!<w:tc>)[\s\S])*?<\/w:tc>/g) ?? []).find(c => c.includes('theo tiêu chuẩn nhà sản xuất') && !c.includes('Ấm đun'))!;
  assert.ok(cell, 'có ô đóng gói');
  assert.equal(cell.match(/<w:p\b/g)!.length, 1, 'chỉ còn một đoạn (không có dòng trống phía trên)');
});


test('HĐKT và biên bản giữ 2 số lẻ đơn giá trên file Word', async () => {
  for (const [file, documentType] of [['hdkt', 'HDKT'], ['bien-ban', 'BBNT']]) {
    const bytes = await g.ContractDocument.build({
      quote: { quote_type: 'VIGIFTS', quote_date: '2026-10-19', customer: { name: 'Khách thử' }, subtotal: 28143680, vat_amount: 2251495, total: 30395175,
        items: [{ name: 'Bình', quantity: 110, price_after_discount: 255851.64, line_total: 28143680.4, tax_percent: 8 }] },
      contractNumber: 'TEST', templateBytes: readFileSync(join(ui, `mau-hop-dong-vigifts-${file}.docx`)), documentType,
      details: { depositRate: 30, paymentDays: 5 },
    });
    const xml = g.fflate.strFromU8(g.fflate.unzipSync(bytes)['word/document.xml']!);
    assert.match(xml, /255\.851,64/);
  }
});

test('both HĐKT templates use the form signing date and section 5.2 delivery address, including XML-sensitive text', async () => {
  for (const set of ['bach-ngan', 'vigifts']) {
    const out = await g.ContractDocument.build({
      quote: { quote_type: set === 'vigifts' ? 'VIGIFTS' : 'B2B', quote_date: '2026-10-05', items: [], customer: {} },
      contractNumber: 'TEST', templateBytes: readFileSync(join(ui, `mau-hop-dong-${set}-hdkt.docx`)),
      details: { signedDate: '2026-10-20', deliveryAddress: 'Kho <A> & B', depositRate: 30, paymentDays: 7 },
    });
    const xml = g.fflate.strFromU8(g.fflate.unzipSync(out)['word/document.xml']!);
    const paragraphs = (xml.match(/<w:p\b[\s\S]*?<\/w:p>/g) || []).map(p => [...p.matchAll(/<w:t\b[^>]*>([^<]*)<\/w:t>/g)].map(m => m[1]).join(''));
    assert.equal(paragraphs.find(p => /^Hôm nay/.test(p)), 'Hôm nay, ngày 20 tháng 10 năm 2026, chúng tôi gồm:');
    assert.equal(paragraphs.find(p => /^5\.2\s*Địa điểm giao hàng/.test(p)), '5.2   Địa điểm giao hàng: Kho &lt;A&gt; &amp; B');
    assert.doesNotMatch(xml, /bắt buộc sửa lại/);
  }
});
