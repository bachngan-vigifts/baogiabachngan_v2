import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const context: any = { Uint8Array, ArrayBuffer, TextEncoder, TextDecoder, setTimeout, clearTimeout };
const ui = new URL('../../trial-ui/', import.meta.url);
runInNewContext(readFileSync(new URL('pdf-lib.min.js', ui), 'utf8'), context);
runInNewContext(readFileSync(new URL('fontkit.umd.min.js', ui), 'utf8'), context);
runInNewContext(readFileSync(new URL('stock-shortage-pdf.js', ui), 'utf8').replaceAll('export ', '').replaceAll('import.meta.url', "'https://crm.minhlongonline.com/stock-shortage-pdf.js'") + '\nglobalThis.rows = shortageRows; globalThis.build = buildShortagePdf;', context);

test('PDF mã thiếu: không lấy mã đủ; gộp nhu cầu trùng SKU; phân biệt tồn 0, âm và chưa có dữ liệu', () => {
  const items = [{ sku: 'A', name: 'Đĩa', unit: 'Cái', qty: 5 }, { sku: 'A', qty: 6 }, { sku: 'B', qty: 3 }, { sku: 'C', qty: 7 }, { sku: 'D', qty: 8 }, { sku: 'E', qty: 2 }, { sku: 'F', qty: 4 }];
  const products = new Map([['A', { available: 8 }], ['B', { available: 10 }], ['C', { available: 0 }], ['D', { available: -3 }], ['E', { available: null }]]);
  const result = context.rows(items, products, (p: any) => p.available);
  assert.deepEqual(JSON.parse(JSON.stringify(result)), { rows: [{ sku: 'A', name: 'Đĩa', unit: 'Cái', missing: 3 }, { sku: 'C', unit: '', missing: 7 }, { sku: 'D', unit: '', missing: 8 }], unknown: 2 });
});

test('xuất PDF thật: nhúng font tiếng Việt, tự phân trang danh sách dài, không kèm thông tin khách/giá', async () => {
  const rows = Array.from({ length: 100 }, (_, i) => ({ sku: 'SKU' + i, name: 'Chén cơm Lý Thường Kiệt – Trắng Ngà', unit: 'Cái', missing: i + 0.5 }));
  const bytes = await context.build({ rows, unknown: 2, customerName: 'Không xuất khách', price: 999 }, { PDFLib: context.PDFLib, fontkit: context.fontkit,
    fonts: [new Uint8Array(readFileSync(new URL('fonts/TimesNewRoman.ttf', ui))), new Uint8Array(readFileSync(new URL('fonts/TimesNewRomanBold.ttf', ui)))] });
  assert.ok(bytes.length > 1000);
  const pdf = await context.PDFLib.PDFDocument.load(bytes);
  assert.ok(pdf.getPageCount() > 1);
  assert.equal(pdf.getTitle(), 'Danh sách hàng cần bổ sung');
  const source = readFileSync(new URL('stock-shortage-pdf.js', ui), 'utf8');
  assert.doesNotMatch(source, /customerName|costPrice|innerHTML/);
});

test('không tạo file rỗng khi không có mã thiếu', async () => {
  await assert.rejects(context.build({ rows: [] }, {}), /Không có mã thiếu/);
});
