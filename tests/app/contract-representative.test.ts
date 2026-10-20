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
test('đoạn Word đã sửa giữ nội dung nhưng danh xưng cũ phải theo lựa chọn mới', () => {
  const editContext: any = {};
  runInNewContext(readFileSync(new URL('../../trial-ui/contract-word-edit.js', import.meta.url), 'utf8'), editContext);
  const old = 'Đại diện: Ông Vũ Thị Lệ Hà – Giám đốc (đã chỉnh tay)';
  assert.equal(editContext.ContractWordEdit.representativeText(old, { representativeHonorific: 'Bà', representativeName: 'Vũ Thị Lệ Hà' }),
    'Đại diện: Bà Vũ Thị Lệ Hà – Giám đốc (đã chỉnh tay)');
  assert.equal(editContext.ContractWordEdit.representativeText(old, { representativeHonorific: '', representativeName: 'Vũ Thị Lệ Hà' }),
    'Đại diện: Vũ Thị Lệ Hà – Giám đốc (đã chỉnh tay)');
});
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

test('đọc ô chọn hiện tại khi dựng hồ sơ dù input không phát; không lấy lại danh xưng cũ', async () => {
  const formContext: any = {};
  runInNewContext(ui.slice(0, ui.indexOf('/**\n * Mở hộp xem')).replaceAll('export ', '') + '\nglobalThis.readForm = readContractForm;', formContext);
  const old = { representativeHonorific: 'Ông', representativeName: 'Vũ Thị Lệ Hà', depositRate: 30, paymentDays: 5 };
  const selected = { dataset: { d: 'representativeHonorific' }, value: 'Bà' };
  const form = { querySelectorAll: () => [selected, { dataset: { d: 'depositRate' }, value: '99', readOnly: true }] };
  const details = formContext.readForm(form, old);
  assert.equal(details.representativeHonorific, 'Bà');
  assert.equal(details.depositRate, 30);
  for (const [set, file, documentType] of [['vigifts', 'hdkt', 'HDKT'], ['bach-ngan', 'hdkt', 'HDKT'], ['vigifts', 'bien-ban', 'BBNT']]) {
    const bytes = await docContext.ContractDocument.build({ quote: { quote_type: set === 'vigifts' ? 'VIGIFTS' : 'B2B', items: [], customer: { name: 'Khách thử' } }, contractNumber: 'TEST',
      templateBytes: readFileSync(new URL(`../../trial-ui/mau-hop-dong-${set}-${file}.docx`, import.meta.url)), details, documentType });
    const xml = docContext.fflate.strFromU8(docContext.fflate.unzipSync(bytes)['word/document.xml']);
    const representative = (xml.match(/<w:p\b[\s\S]*?<\/w:p>/g) || []).map(textOf).find((p: string) => p.includes('Vũ Thị Lệ Hà'));
    assert.ok(representative, `${set}-${file}`);
    assert.match(representative, /Bà\s+Vũ Thị Lệ Hà/);
    assert.doesNotMatch(representative, /Ông/);
  }
});
