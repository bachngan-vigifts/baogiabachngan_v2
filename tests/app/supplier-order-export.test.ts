import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { runInNewContext, runInThisContext } from 'node:vm';
const { buildSupplierWorkbook } = await import(new URL('../../trial-ui/purchase-excel.js', import.meta.url).href);
const { purchaseExportData, suggestedSupplierTemplate } = await import(new URL('../../trial-ui/purchase-export-data.js', import.meta.url).href);
const { buildPurchasePdf } = await import(new URL('../../trial-ui/purchase-pdf.js', import.meta.url).href);
const ui = new URL('../../trial-ui/', import.meta.url);
const ctx: any = { setTimeout, clearTimeout, TextEncoder, TextDecoder, Uint8Array, ArrayBuffer, Buffer };
runInNewContext(readFileSync(new URL('exceljs.min.js', ui), 'utf8'), ctx);
const templates = JSON.parse(readFileSync(new URL('templates/supplier-orders.json', ui), 'utf8'));
const dependencies = { ExcelJS: ctx.ExcelJS, templates };
const purchase = (): any => ({ ticketNumber: 'DMH_20261015_TEST', internalNo: '', supplier: { name: 'CÔNG TY TNHH MINH LONG I', taxCode: '0123456789', address: 'Bình Dương', phone: '0901' },
  actions: ['pdf'], priceHidden: false, createdAt: '2026-10-15T00:00:00Z', approvedAt: '2026-10-15T00:01:00Z', arrivalDate: '2026-10-20', warehouse: 'Cần Thơ', note: 'Giao nguyên thùng\nGọi trước khi giao',
  events: [{ action: 'create', by: 'Người đặt thử' }, { action: 'approve', by: 'Người duyệt thử' }],
  lines: [{ id: 'l1', sku: '031106000', name: 'Chén cơm trắng ngà', unit: 'Cái', quantity: 2, price: 100000, purchaseDiscount: 19, taxRate: 8, printFee: 2000, printDescription: 'In logo 2 màu', lineTotal: 166000, sources: [{ customerName: 'Khách logo' }] },
    { id: 'l2', sku: 'LHC1487GRY', name: 'Bình giữ nhiệt', unit: 'Cái', quantity: 3, price: 50000, purchaseDiscount: 10, taxRate: 10, printFee: 0, lineTotal: 135000 }],
  totals: { subtotal: 301000, vat: 26780, total: 327780 }, schedules: [{ kind: 'deposit', amount: 100000, dueDate: '2026-10-16' }] });
const roundtrip = async (workbook: any) => { const bytes = await workbook.xlsx.writeBuffer(); const loaded = new ctx.ExcelJS.Workbook(); await loaded.xlsx.load(bytes); return { loaded, bytes }; };
test('all three supplied layouts: real XLSX roundtrip, original text SKUs, current quantities, no sample orders/external links', async () => {
  const v = purchase();
  for (const kind of ['minh-long', 'minh-long-logo', 'lock']) {
    const wb = await buildSupplierWorkbook(v, kind, dependencies, { lines: { l1: { erp: 'ERP-TEST', collection: 'Jasmine', pattern: 'Trắng', quality: 'L1', perCarton: 8 } }, supplierContact: 'NV NCC', logoContent: 'LOGO MỚI' });
    const { loaded, bytes } = await roundtrip(wb);
    assert.equal(loaded.worksheets.length, 1); assert.equal(templates[kind].sourceSheetIndex, 2);
    const ws = loaded.worksheets[0];
    const ref = kind === 'minh-long' ? 'B2' : kind === 'lock' ? 'C12' : 'B9';
    assert.equal(ws.getCell(ref).value, '031106000'); assert.equal(ws.getCell(ref).numFmt, '@');
    assert.equal(ws.getCell(kind === 'minh-long' ? 'G2' : kind === 'lock' ? 'F12' : 'G9').value, 2);
    if (kind === 'minh-long') { assert.equal(ws.getCell('H2').value, v.supplier.name); assert.match(ws.getCell('I2').value, /20\/10\/2026/); }
    if (kind === 'lock') { assert.equal(ws.getCell('B12').value, 'ERP-TEST'); assert.equal(ws.getCell('I14').result, v.totals.total); }
    if (kind === 'minh-long-logo') { assert.equal(ws.getCell('C12').value, 'LOGO MỚI'); assert.equal(ws.getCell('C2').value, 'NV NCC'); }
    assert.ok(bytes.length > 3000);
    if (process.env.EXPORT_REVIEW_DIR) writeFileSync(`${process.env.EXPORT_REVIEW_DIR}/${kind}.xlsx`, bytes);
    const manifest = JSON.stringify(loaded.model);
    assert.doesNotMatch(manifest, /VLOOKUP|externalLinks|VIỆT HOA|QHOME|sale01s\.cantho/);
  }
});
test('Lock totals use confirmed discount, fee and mixed VAT from authorized purchase, not hard-coded 58%/8%', async () => {
  const v = purchase(), data = purchaseExportData(v);
  assert.equal(data.lines[0].printFee, 2000); assert.equal(data.totals.vat, 26780);
  const lock = (await buildSupplierWorkbook(v, 'lock', dependencies)).worksheets[0];
  assert.equal(lock.getCell('G12').value, 108000); assert.equal(lock.getCell('H12').result, 89640); assert.equal(lock.getCell('I12').result, 179280);
  assert.equal(lock.getCell('I13').result, 148500); assert.equal(lock.getCell('I14').result, v.totals.total);
  assert.doesNotMatch(lock.getCell('H12').formula, /58%/);
});
test('many lines expand each sheet-2 layout safely; text is not a formula', async () => {
  const v = purchase(); v.lines = Array.from({ length: 80 }, (_, i) => ({ ...v.lines[0], id: 'l'+i, sku: '00'+i, name: i === 0 ? '=HYPERLINK("https://invalid")' : 'Hàng ' + i }));
  for (const kind of ['minh-long', 'minh-long-logo', 'lock']) {
    const wb = await buildSupplierWorkbook(v, kind, dependencies), ws = wb.worksheets[0];
    assert.ok(ws.rowCount > 80); assert.equal(ws.getCell(kind === 'minh-long' ? 'C2' : kind === 'lock' ? 'D12' : 'C9').value, '=HYPERLINK("https://invalid")');
    if (kind === 'minh-long') assert.equal(ws.getCell('B81').value, '0079');
    else if (kind === 'lock') assert.match(ws.getCell('I92').formula, /SUM/);
    else assert.equal(ws.getCell('B88').value, '0079');
  }
});
test('permissions and incomplete prices block export; template choice does not hard-code supplier IDs', async () => {
  assert.equal(suggestedSupplierTemplate(purchase()), 'minh-long-logo');
  assert.equal(suggestedSupplierTemplate({ supplier: { name: 'Lock & Lock' } }), 'lock');
  const v = purchase(); assert.throws(() => purchaseExportData({ ...v, priceHidden: true }), /quyền/);
  assert.throws(() => purchaseExportData({ ...v, actions: [] }), /quyền/);
  await assert.rejects(buildSupplierWorkbook({ ...v, totals: null }, 'lock', dependencies), /quyền/);
  await assert.rejects(buildSupplierWorkbook({ ...v, lines: [{ ...v.lines[0], price: null }] }, 'lock', dependencies), /giá mua/);
});
runInThisContext(readFileSync(new URL('pdf-lib.min.js', ui), 'utf8'));
runInThisContext(readFileSync(new URL('fontkit.umd.min.js', ui), 'utf8'));
const pdfDependencies = { PDFLib: (globalThis as any).PDFLib, fontkit: (globalThis as any).fontkit, fonts: ['TimesNewRoman.ttf', 'TimesNewRomanBold.ttf'].map(f => new Uint8Array(readFileSync(new URL('fonts/'+f, ui)))) };
test('purchase PDF matches customer-order landscape layout, embeds Vietnamese and paginates long orders', async () => {
  const v = purchase(), options = { contact: 'Nguyễn Thị Ánh', address: 'Khu vực Cần Thơ', entity: 'BN' };
  const sample = await buildPurchasePdf(v, pdfDependencies, options);
  if (process.env.EXPORT_REVIEW_DIR) writeFileSync(`${process.env.EXPORT_REVIEW_DIR}/purchase.pdf`, sample);
  const pdf = await pdfDependencies.PDFLib.PDFDocument.load(sample); assert.equal(pdf.getPageCount(), 1); assert.ok(pdf.getPage(0).getWidth() > pdf.getPage(0).getHeight());
  assert.equal(pdf.getTitle(), 'Đơn đặt hàng ' + v.ticketNumber);
  v.lines = Array.from({ length: 100 }, (_, i) => ({ ...v.lines[0], sku: '00' + i, name: 'Chén cơm Trắng Ngà có in logo nhiều màu' }));
  const long = await buildPurchasePdf(v, pdfDependencies, options); assert.ok((await pdfDependencies.PDFLib.PDFDocument.load(long)).getPageCount() > 1);
  await assert.rejects(buildPurchasePdf({ ...v, priceHidden: true }, pdfDependencies), /quyền/);
});

test('PDF splits a very long product note across pages without drawing below the page', async () => {
  const v = purchase(); (v.lines[0] as any).supplierNote = 'Ghi chú dài cần giữ đầy đủ nội dung. '.repeat(160);
  const draws: any[] = [];
  const original = pdfDependencies.PDFLib.PDFPage.prototype.drawText;
  pdfDependencies.PDFLib.PDFPage.prototype.drawText = function(text: string, options: any) { draws.push(options); return original.call(this, text, options); };
  try {
    const bytes = await buildPurchasePdf(v, pdfDependencies); assert.ok((await pdfDependencies.PDFLib.PDFDocument.load(bytes)).getPageCount() > 1);
    assert.ok(draws.every(d => d.y >= 18), 'all text stays within landscape page');
  } finally { pdfDependencies.PDFLib.PDFPage.prototype.drawText = original; }
});

test('keeps the main email attachment helper producing a real PDF as base64', async () => {
  const { purchasePdfBase64 } = await import(new URL('../../trial-ui/purchase-pdf.js', import.meta.url).href);
  const previous = globalThis.fetch;
  globalThis.fetch = (async (url: any) => {
    const name = String(url).split('/').pop();
    if (!['TimesNewRoman.ttf', 'TimesNewRomanBold.ttf'].includes(name!)) throw new Error('Unexpected fetch in export test');
    return new Response(readFileSync(new URL('fonts/'+name, ui)));
  }) as typeof fetch;
  try {
    const encoded = await purchasePdfBase64(purchase()), bytes = Buffer.from(encoded, 'base64');
    assert.equal(bytes.subarray(0, 4).toString(), '%PDF');
    assert.equal((await pdfDependencies.PDFLib.PDFDocument.load(bytes)).getTitle(), 'Đơn đặt hàng DMH_20261015_TEST');
  } finally { globalThis.fetch = previous; }
});

test('Excel Lock luôn dùng pháp nhân VIGIFTS, kể cả lựa chọn cũ đang là Bách Ngân', async () => {
  const name = 'CÔNG TY TNHH SẢN XUẤT THƯƠNG MẠI QUẢNG CÁO VIGIFTS';
  for (const entity of [undefined, 'BN', 'VG']) {
    const wb = await buildSupplierWorkbook(purchase(), 'lock', dependencies, { entity });
    const { loaded } = await roundtrip(wb);
    assert.equal(loaded.worksheets[0].getCell('A4').value, 'Customer (Khách hàng): ' + name);
    assert.equal(loaded.creator, name);
  }
  for (const [entity, expected] of [['BN', 'CTY TNHH SX TM BÁCH NGÂN'], ['VG', 'CTY TNHH SX TM QC VIGIFTS']]) {
    const wb = await buildSupplierWorkbook(purchase(), 'minh-long-logo', dependencies, { entity });
    assert.equal(wb.worksheets[0].getCell('C4').value, expected);
  }
});
