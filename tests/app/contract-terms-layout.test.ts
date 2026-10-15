import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
const source = readFileSync(new URL('../../trial-ui/contract-document.js', import.meta.url), 'utf8');
const context: any = {};
runInNewContext(source.slice(source.indexOf('  const tidyDocumentTerms ='), source.indexOf('  const templateMark =')) + '\nglobalThis.tidy = tidyDocumentTerms;', context);
const textOf = (s: string) => [...s.matchAll(/<w:t\b[^>]*>([^<]*)<\/w:t>/g)].map(m => m[1]).join('');
test('clause 9.3: two copies, one per party, including text split across Word runs', () => {
  const sentence = '9.3 Hợp đồng này được làm thành 04 (bốn) bản, có giá trị pháp lý như nhau, bên B giữ 02 (hai) bản, bên A giữ 02 (hai) bản.';
  for (const parts of [[sentence], [...sentence]]) {
    const xml = '<w:p><w:pPr><w:spacing w:after="120"/></w:pPr>' + parts.map(t => '<w:r><w:rPr><w:b/></w:rPr><w:t>' + t + '</w:t></w:r>').join('') + '</w:p>';
    const out = context.tidy(xml, 'HDKT');
    assert.equal(textOf(out), sentence.replace('04 (bốn)', '02 (hai)').replaceAll('giữ 02 (hai)', 'giữ 01 (một)'));
    assert.equal((out.match(/<w:r>/g) || []).length, parts.length);
    assert.match(out, /w:spacing w:after="120"/);
    assert.equal(context.tidy(out, 'HDKT'), out);
    assert.equal(context.tidy(xml, 'BBNT'), xml);
  }
});
test('acceptance blank date is right aligned, preserves typography and stays blank', () => {
  for (const props of ['', '<w:pPr/>', '<w:pPr><w:ind w:left="720"/><w:jc w:val="left"/><w:spacing w:after="120"/></w:pPr>']) {
    const xml = '<w:p>' + props + '<w:r><w:rPr><w:i/></w:rPr><w:t>, ngày .... tháng .... năm ....</w:t></w:r></w:p>';
    const out = context.tidy(xml, 'BBNT');
    assert.equal(textOf(out), ', ngày .... tháng .... năm ....');
    assert.match(out, /<w:jc w:val="right"\/>/); assert.doesNotMatch(out, /<w:ind/); assert.match(out, /<w:i\/>/);
    assert.equal(context.tidy(xml, 'HDKT'), xml);
    assert.equal(context.tidy(out, 'BBNT'), out);
  }
});
test('real Word builder applies terms and date alignment before preview/download', async () => {
  const ctx: any = {};
  runInNewContext(readFileSync(new URL('../../trial-ui/fflate.min.js', import.meta.url), 'utf8'), ctx);
  runInNewContext(source, ctx);
  for (const [type, file] of [['HDKT', 'hdkt'], ['BBNT', 'bien-ban']]) {
    const bytes = await ctx.ContractDocument.build({ quote: { quote_type: 'VIGIFTS', items: [], customer: { name: 'Test' } }, contractNumber: 'TEST', documentType: type,
      templateBytes: readFileSync(new URL(`../../trial-ui/mau-hop-dong-${type === 'HDKT' ? 'vigifts' : 'bach-ngan'}-${file}.docx`, import.meta.url)), details: { depositRate: 30, paymentDays: 7 } });
    const xml = ctx.fflate.strFromU8(ctx.fflate.unzipSync(bytes)['word/document.xml']);
    if (type === 'HDKT') {
      const clause = (xml.match(/<w:p\b[\s\S]*?<\/w:p>/g) || []).map(textOf).find((t: string) => t.includes('Hợp đồng này được làm thành'));
      assert.ok(clause); assert.match(clause, /02\s*\(hai\)/); assert.doesNotMatch(clause, /04\s*\(bốn\)/); assert.match(clause, /01\s*\(một\)/);
    } else {
      const dates = (xml.match(/<w:p\b[\s\S]*?<\/w:p>/g) || []).filter((p: string) => /ngày\s*\.{2,}.*tháng/.test(textOf(p)));
      assert.ok(dates.length); for (const p of dates) assert.match(p, /<w:jc w:val="right"\/>/);
    }
  }
});
