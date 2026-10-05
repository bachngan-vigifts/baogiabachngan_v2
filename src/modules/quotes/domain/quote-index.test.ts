/* eslint-disable @typescript-eslint/no-explicit-any */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { searchText, quoteHeaderIndex, quoteLineRows } from './quote-index.ts';
import { cleanQuotation } from './quotation-schema.ts';
import { totals, profit, type QuoteDoc, type QuoteRow } from './quote-math.ts';
import { createTestDb } from '../../../../tests/helpers/d1.ts';

const raw = (o: object = {}): any => ({ type: 'B2B', quoteNo: 'BG-1', date: '2026-10-05', customer: 'Công ty Đông Á', vat: 8,
  rows: [{ sku: 'A1', name: 'Nồi Đa Năng', qty: 2, price: 100000, discount: 10, taxRate: 5, printFee: 2000, costPrice: 50000, brand: 'Lock', unit: 'cái', deliveryDate: '20/10/2026' },
         { sku: 'B2', name: 'Chảo', qty: 1.5, price: 12.5, discount: 3, discountType: 'amount' }], ...o });

test('chuẩn hoá tìm kiếm: bỏ dấu, đ→d, hạ chữ', () => {
  assert.equal(searchText('Công ty ĐÔNG Á'), 'cong ty dong a');
  assert.equal(searchText('Đường Nguyễn Văn Cừ'), 'duong nguyen van cu');
  assert.equal(searchText(null), ''); assert.equal(searchText(0), '');
});

test('chỉ mục báo giá: gộp số BG, khách, liên hệ, sản phẩm, hợp đồng; hasContract theo số HĐKT', () => {
  const data = cleanQuotation(raw({ customerTaxCode: '0101', phone: '0909', contractDocument: { contractNumber: ' HD-9 ', details: { depositRate: 30, paymentDays: 10 } } }));
  const idx = quoteHeaderIndex(data);
  assert.equal(idx.quoteDate, '2026-10-05');
  assert.deepEqual([idx.contractNumber, idx.contractQuoteNo, idx.hasContract], ['HD-9', 'BG-1', 1]);
  for (const piece of ['bg-1', 'cong ty dong a', '0101', '0909', 'a1 noi da nang', 'b2 chao', 'hd-9']) assert.ok(idx.searchText.includes(piece), piece);
  const none = quoteHeaderIndex(cleanQuotation(raw()));
  assert.deepEqual([none.contractNumber, none.hasContract], ['', 0]);
});

test('văn bản tìm kiếm tối đa 20.000 ký tự', () => {
  const data = cleanQuotation(raw({ rows: Array.from({ length: 300 }, (_, i) => ({ sku: 'S' + i, name: 'x'.repeat(3900), qty: 1, price: 1 })) }), { maxBytes: 1e9 });
  assert.equal(quoteHeaderIndex(data).searchText.length, 20000);
});

test('dòng hàng chuẩn hoá: đánh số từ 1, giữ trường tiền, thuế thiếu → null, ngày giao chuẩn ISO', () => {
  const data = cleanQuotation(raw());
  const lines = quoteLineRows('q1', data);
  assert.deepEqual(lines.map(l => [l.lineNo, l.sku, l.discountType, l.taxRate, l.deliveryDate]), [[1, 'A1', 'percent', 5, '2026-10-20'], [2, 'B2', 'amount', null, null]]);
  assert.equal(lines[0]!.id, data.rows[0].id);
  assert.ok(lines.every(l => l.quoteId === 'q1'));
});

test('BẤT BIẾN: tổng tiền/lợi nhuận tính từ các dòng đã chuẩn hoá == tính từ báo giá gốc (bảng dòng hàng không làm rơi trường nào liên quan đến tiền)', () => {
  for (const type of ['HRC', 'B2B', 'VIGIFTS'] as const) for (const vat of [0, 8, 10]) {
    const data = cleanQuotation(raw({ type, vat }));
    const asRows = quoteLineRows('q', data).map((l): QuoteRow => ({ sku: l.sku, name: l.name, brand: l.brand, price: l.price, qty: l.qty, discount: l.discount, discountType: l.discountType, printFee: l.printFee, taxRate: l.taxRate, costPrice: l.costPrice }));
    const a: QuoteDoc = { type, vat: data.vat, rows: data.rows }, b: QuoteDoc = { type, vat: data.vat, rows: asRows };
    assert.deepStrictEqual(totals(b), totals(a), `${type} vat ${vat}`);
    assert.deepStrictEqual(profit(b), profit(a));
  }
});

test('dòng hàng chuẩn hoá ghi được vào bảng quote_lines (đủ ràng buộc), kể cả giá lẻ và số lượng lẻ', async () => {
  const { d1 } = createTestDb();
  d1.sqlite.exec("INSERT INTO staff_members (id,email,name,created_at) VALUES ('m1','a@b.vn','An','2026-01-01')");
  d1.sqlite.exec("INSERT INTO staff_quotations (id,creator_id,quote_no,quote_type,customer,data,created_at,updated_at) VALUES ('q1','m1','BG-1','B2B','K','{}','2026-01-01','2026-01-01')");
  const ins = d1.sqlite.prepare('INSERT INTO quote_lines (id,quote_id,line_no,sku,name,brand,unit,qty,price,discount,discount_type,tax_rate,print_fee,cost_price,delivery_date) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
  for (const l of quoteLineRows('q1', cleanQuotation(raw()))) ins.run(l.id, l.quoteId, l.lineNo, l.sku, l.name, l.brand, l.unit, l.qty, l.price, l.discount, l.discountType, l.taxRate, l.printFee, l.costPrice, l.deliveryDate);
  const row = d1.sqlite.prepare("SELECT qty, price FROM quote_lines WHERE sku='B2'").get() as any;
  assert.deepEqual({ ...row }, { qty: 1.5, price: 12.5 }); // không bị cắt về số nguyên
});
