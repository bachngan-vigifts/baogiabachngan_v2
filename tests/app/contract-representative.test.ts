import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
const ui = readFileSync(new URL('../../trial-ui/contract-ui.js', import.meta.url), 'utf8');
const context: any = {};
runInNewContext(ui.slice(0, ui.indexOf('/** Đổi đơn +')).replaceAll('export ', '') + '\nglobalThis.details = contractDetails;', context);

test('đại diện bên A: tách danh xưng khỏi tên cũ; lựa chọn lưu riêng ưu tiên và không đoán theo tên', () => {
  for (const [raw, selected, honorific, name] of [
    ['Ông Nguyễn Quốc Linh', undefined, 'Ông', 'Nguyễn Quốc Linh'], ['bà Trần Thị Mai', undefined, 'Bà', 'Trần Thị Mai'],
    ['Ông Nguyễn Quốc Linh', 'Bà', 'Bà', 'Nguyễn Quốc Linh'], ['Nguyễn Quốc Linh', undefined, '', 'Nguyễn Quốc Linh'],
    ['Bà Trần Thị Mai', '', '', 'Trần Thị Mai'],
  ]) {
    const d = context.details({ order: { contact: raw }, contract: { data: { details: { ...(selected !== undefined ? { representativeHonorific: selected } : {}) } } } });
    assert.equal(d.representativeName, name); assert.equal(d.representativeHonorific, honorific);
    const reopened = context.details({ order: { contact: 'Tên khách cũ' }, contract: { data: { details: d } } });
    assert.equal(reopened.representativeName, name); assert.equal(reopened.representativeHonorific, honorific);
  }
});
const docContext: any = {};
runInNewContext(readFileSync(new URL('../../trial-ui/fflate.min.js', import.meta.url), 'utf8'), docContext);
runInNewContext(readFileSync(new URL('../../trial-ui/contract-document.js', import.meta.url), 'utf8'), docContext);
const textOf = (xml: string) => [...xml.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)].map(m => m[1]).join(' ');
test('file Word thật: chọn Ông/Bà, không lặp danh xưng; khối ký tên chỉ có họ tên', async () => {
  for (const honorific of ['Ông', 'Bà', '']) {
    const bytes = await docContext.ContractDocument.build({ quote: { quote_type: 'VIGIFTS', items: [], customer: { name: 'Công ty thử' } }, contractNumber: 'TEST',
      templateBytes: readFileSync(new URL('../../trial-ui/mau-hop-dong-vigifts-hdkt.docx', import.meta.url)),
      details: { depositRate: 30, paymentDays: 7, representativeHonorific: honorific, representativeName: 'Nguyễn Quốc Linh' } });
    const xml = docContext.fflate.strFromU8(docContext.fflate.unzipSync(bytes)['word/document.xml']);
    const paras = xml.match(/<w:p\b[\s\S]*?<\/w:p>/g) || [];
    const representative = paras.map(textOf).find((s: string) => s.includes('Nguyễn Quốc Linh'))!;
    assert.ok(representative);
    assert.equal((representative.match(/Ông|Bà/g) || []).join(), honorific);
    const signer = paras.map(textOf).find((s: string) => s.includes('NGUYỄN QUỐC LINH'))!;
    assert.ok(signer, paras.map(textOf).filter((s: string) => /LINH|Linh|Bên A|bên A/.test(s)).join(' | ')); assert.doesNotMatch(signer, /ÔNG|BÀ/);
  }
});
test('biên bản: danh xưng theo lựa chọn khi mẫu không có Ông sẵn', async () => {
  const bytes = await docContext.ContractDocument.build({ quote: { quote_type: 'VIGIFTS', items: [], customer: { name: 'Công ty thử' } }, contractNumber: 'TEST', documentType: 'BBNT',
    templateBytes: readFileSync(new URL('../../trial-ui/mau-hop-dong-vigifts-bien-ban.docx', import.meta.url)), details: { depositRate: 30, paymentDays: 7, representativeHonorific: 'Bà', representativeName: 'Trần Thị Mai' } });
  const xml = docContext.fflate.strFromU8(docContext.fflate.unzipSync(bytes)['word/document.xml']);
  assert.match(textOf(xml), /Bà Trần Thị Mai/);
});
