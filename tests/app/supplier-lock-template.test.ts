import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { runInNewContext } from 'node:vm';
const { buildLockSupplierFile } = await import(new URL('../../trial-ui/purchase-lock-template.js', import.meta.url).href);
const ui = new URL('../../trial-ui/', import.meta.url);
const context: any = { Uint8Array, Uint16Array, Uint32Array, Int32Array, ArrayBuffer, TextEncoder, TextDecoder };
runInNewContext(readFileSync(new URL('fflate.min.js', ui), 'utf8'), context);
const zip = context.fflate;
const source = readFileSync(new URL('templates/lock-order-e551e09b.xlsx', ui));
const original = zip.unzipSync(source);
const text = (files: any, name: string) => zip.strFromU8(files[name]);
const sheet = (files: any) => text(files, 'xl/worksheets/sheet2.xml');
const cell = (xml: string, ref: string): string => xml.match(new RegExp(`<c\\b[^>]*\\br="${ref}"[^>]*?(?:/>|>[\\s\\S]*?</c>)`))?.[0] || '';
const formula = (xml: string, ref: string) => cell(xml, ref).match(/<f[^>]*>(.*?)<\/f>/)?.[1];
const style = (xml: string, ref: string) => cell(xml, ref).match(/\bs="(\d+)"/)?.[1];
const purchase = (count = 1): any => ({ ticketNumber: 'PO_TEST_LOCK', supplier: { name: 'Other supplier name' }, actions: ['pdf'],
  createdAt: '2026-11-14T00:00:00Z', arrivalDate: '2026-11-20', warehouse: 'Địa chỉ nhận từ đơn', events: [{action: 'create', by: 'Người tạo đơn'}],
  totals: { subtotal: 1, vat: 1, total: 2 }, lines: Array.from({length: count}, (_, i) => ({ id: 'l'+i, sku: i % 2 ? 'LHC1487GRY' : 'LHC3249BLK', name: 'Tên trên đơn không ghi đè công thức', quantity: i+2, price: 1, purchaseDiscount: 5, taxRate: 8, lineTotal: i+2 })) });
const build = (v: any, options = {}) => zip.unzipSync(buildLockSupplierFile(v, source, zip, options));

test('Lock source is the exact uploaded workbook; all unrelated native parts and catalogue bytes survive', () => {
  assert.equal(createHash('sha256').update(source).digest('hex'), 'e551e09b743d0948db41aa3c95e8c1bf7716121615ccfa32e2876e8df6d97c2a');
  const result = build(purchase(3));
  assert.deepEqual(Object.keys(result).sort(), Object.keys(original).sort());
  const changed = new Set(['xl/worksheets/sheet2.xml', 'xl/workbook.xml', 'xl/calcChain.xml']);
  for (const path of Object.keys(original)) if (!changed.has(path)) assert.deepEqual(Buffer.from(result[path]), Buffer.from(original[path]), path);
  const before = sheet(original), after = sheet(result);
  const editedHeaders = new Set(['G2','G3','G4','D5','D6','G7','E8','G9']);
  for (const match of before.matchAll(/<c\b[^>]*\br="([A-Z]+)(\d+)"[^>]*?(?:\/>|>[\s\S]*?<\/c>)/g)) {
    const ref=match[1]+match[2];
    if (Number(match[2])<12 && !editedHeaders.has(ref)) assert.equal(cell(after,ref),match[0],ref);
  }
  for (const tag of ['cols','pageMargins','pageSetup','headerFooter']) assert.equal(after.match(new RegExp(`<${tag}\\b[\\s\\S]*?(?:/>|</${tag}>)`))?.[0], before.match(new RegExp(`<${tag}\\b[\\s\\S]*?(?:/>|</${tag}>)`))?.[0], tag);
  assert.match(text(result,'xl/workbook.xml'), /name="Total" sheetId="5"/);
  assert.match(text(result,'xl/workbook.xml'), /name="order" sheetId="8"/);
});

test('Lock fills only approved header inputs and preserves deliberate blank G2, G4 and confirmation quantity', () => {
  for (const entity of ['BN','VG']) {
    const xml = sheet(build(purchase(2), {entity, contact:'Nguyễn An', phone:'0900123456', address:'Kho A & B <cổng 2>'}));
    for (const ref of ['G2','G4','G12','G13']) assert.doesNotMatch(cell(xml, ref), /<(?:v|is|f)[ >]/, ref);
    assert.match(cell(xml,'G3'), /Nguyễn An/); assert.match(cell(xml,'D6'), /0900123456/);
    assert.match(cell(xml,'D5'), /Kho A &amp; B &lt;cổng 2&gt;/);
    assert.match(cell(xml,'G7'), /14\/11\/2026/); assert.match(cell(xml,'E8'), /20\/11\/2026/);
    assert.match(cell(xml,'G9'), /LOCKNLOCK/);
    assert.doesNotMatch(xml, /PO_TEST_LOCK|Other supplier name|VIGIFTS/);
  }
});

test('Lock expands the exact styled row, fills formulas down and moves only the total/filter references', () => {
  const result = build(purchase(80)), xml = sheet(result), before = sheet(original);
  for (let row = 12; row <= 91; row++) {
    assert.match(cell(xml, 'A'+row), new RegExp(`<v>${row-11}</v>`));
    assert.match(cell(xml, 'F'+row), new RegExp(`<v>${row-10}</v>`));
    assert.equal(formula(xml,'B'+row), `VLOOKUP(C${row},Total!$B$4:$E$92114,2,0)`);
    assert.equal(formula(xml,'I'+row), `H${row}*(1-58%)`);
    assert.equal(formula(xml,'J'+row), `I${row}*G${row}`);
    assert.doesNotMatch(cell(xml,'G'+row), /<(?:v|is|f)[ >]/);
    for (const column of 'ABCDEFGHIJ') assert.equal(style(xml,column+row), style(before,column+'12'));
    assert.match(xml, new RegExp(`<row r="${row}"[^>]*ht="36.75"[^>]*customHeight="1"`));
  }
  for (const column of ['F','G','J']) assert.equal(formula(xml,column+'92'), `SUM(${column}12:${column}91)`);
  assert.match(xml, /<mergeCell ref="A92:D92"/); assert.match(xml, /<autoFilter ref="A11:H92"/);
  assert.match(text(result,'xl/workbook.xml'), /order!\$A\$11:\$H\$92/);
  assert.equal((text(result,'xl/calcChain.xml').match(/<c /g)||[]).length,80*6+3);
  assert.doesNotMatch(xml, /<f[^>]*t="shared"/);
});

test('Lock keeps text SKUs literal, preserves original one-line formulas and clears stale sample caches', () => {
  const v = purchase(); v.lines[0].sku = '=1<&"0001';
  const xml = sheet(build(v));
  assert.match(cell(xml,'C12'), /t="inlineStr"/); assert.match(cell(xml,'C12'), /=1&lt;&amp;&quot;0001/);
  assert.doesNotMatch(cell(xml,'C12'), /<f/);
  for (const col of ['B','D','E','H','I','J']) {
    const expected = formula(sheet(original),col+'12')?.replace(/Total!([A-Z]+)(\d+):([A-Z]+)(\d+)/g, (_m, c1, r1, c2, r2) => `Total!$${c1}$${r1}:$${c2}$${r2}`);
    assert.equal(formula(xml,col+'12'), expected);
    assert.doesNotMatch(cell(xml,col+'12'), /<v>/);
  }
  assert.match(text(build(v),'xl/workbook.xml'), /fullCalcOnLoad="1" forceFullCalc="1"/);
});

test('Lock retains export permission and quantity validation, and rejects incompatible templates', () => {
  assert.throws(()=>build({...purchase(),priceHidden:true}), /quyền/);
  assert.throws(()=>build({...purchase(),actions:[]}), /quyền/);
  assert.throws(()=>build({...purchase(),lines:[]}), /dòng hàng/);
  const v=purchase();v.lines[0].quantity=0;assert.throws(()=>build(v), /số lượng/);
  assert.throws(()=>buildLockSupplierFile(purchase(),zip.zipSync({}),zip), /mẫu Excel Lock/);
});

if (process.env.EXPORT_REVIEW_DIR) writeFileSync(`${process.env.EXPORT_REVIEW_DIR}/lock.xlsx`,buildLockSupplierFile(purchase(2),source,zip,{contact:'Nguyễn An',phone:'0900123456',address:'Kho nhận hàng'}));

test('download route fetches the native Lock template and saves populated bytes without ExcelJS reconstruction', async () => {
  const { downloadSupplierExcel } = await import(new URL('../../trial-ui/purchase-excel.js', import.meta.url).href);
  const saved = { fetch: globalThis.fetch, document: (globalThis as any).document, fflate: (globalThis as any).fflate, timeout: globalThis.setTimeout, create: URL.createObjectURL, revoke: URL.revokeObjectURL };
  let downloaded: Blob | undefined, clicked=false, name='';
  (globalThis as any).fflate=zip;
  (globalThis as any).document={body:{append(){}},createElement:(tag:string)=>{assert.equal(tag,'a');return {href:'',get download(){return name;},set download(v:string){name=v;},click(){clicked=true;},remove(){}};}};
  globalThis.fetch=(async (url:any)=>{assert.match(String(url),/templates\/lock-order-e551e09b.xlsx$/);return new Response(source);}) as typeof fetch;
  URL.createObjectURL=(blob:Blob)=>{downloaded=blob;return 'blob:lock-test';};URL.revokeObjectURL=()=>{};
  globalThis.setTimeout=((callback:()=>void)=>{callback();return 0;}) as any;
  try {
    await downloadSupplierExcel(purchase(2),'lock');
    assert.equal(clicked,true);assert.equal(name,'PO_TEST_LOCK-lock.xlsx');assert.ok(downloaded);
    const output=zip.unzipSync(new Uint8Array(await downloaded!.arrayBuffer()));
    assert.match(sheet(output),/LOCKNLOCK/);assert.match(sheet(output),/A14:D14/);
    assert.deepEqual(Buffer.from(output['xl/worksheets/sheet1.xml']),Buffer.from(original['xl/worksheets/sheet1.xml']));
  } finally {
    globalThis.fetch=saved.fetch;(globalThis as any).document=saved.document;(globalThis as any).fflate=saved.fflate;globalThis.setTimeout=saved.timeout;URL.createObjectURL=saved.create;URL.revokeObjectURL=saved.revoke;
  }
});
