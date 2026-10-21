import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { applyPurchaseCost, costModeOf, parsePurchaseCost, syncPurchaseCost } from '../../src/modules/quotes/domain/quote-math.ts';

const source = readFileSync(new URL('../../trial-ui/app.js', import.meta.url), 'utf8');
test('ô nhập giá vốn: 160k đổi sang thủ công, 58% đổi sang CK; sai dữ liệu đánh dấu đỏ và không ghi đè', () => {
  const events: Record<string, (e: any) => void> = {}, row: any = { price: 400000, purchaseDiscount: 58, costPrice: 168000 };
  const select = { value: 'discount' }, unit = { textContent: '%' }, input: any = { value: '160k', dataset: { k: 'purchaseCost' }, invalid: false,
    classList: { toggle: (_: string, value: boolean) => { input.invalid = value; }, contains: () => input.invalid } };
  const tr = { dataset: { i: '0' }, querySelector: (q: string) => q === '[data-cost-mode]' ? select : unit };
  input.closest = (q: string) => q === 'tr' ? tr : input;
  let dirty = 0, calculations = 0;
  const context: any = { editor: { rows: [row] }, parsePurchaseCost, applyPurchaseCost, costModeOf, isManager: () => true,
    $: () => ({ addEventListener: (event: string, fn: any) => { events[event] = fn; } }),
    NUM_FIELDS: {}, markDirty: () => dirty++, calculate: () => calculations++, fmtNum: String };
  runInNewContext(source.slice(source.indexOf('function costInput('), source.indexOf('let selectedLine =')), context);
  events.input!({ target: input });
  assert.equal(row.costPrice, 160000); assert.equal(row.costMode, 'manual'); assert.equal(select.value, 'manual'); assert.equal(unit.textContent, 'đ');
  events.focusout!({ target: input }); assert.equal(input.value, '160000');
  input.value = '58%'; events.input!({ target: input });
  assert.equal(row.costPrice, 168000); assert.equal(row.costMode, 'discount'); assert.equal(unit.textContent, '%');
  input.value = '150%'; events.input!({ target: input }); assert.equal(input.invalid, true); assert.equal(row.costPrice, 168000);
  input.value = ''; events.input!({ target: input }); assert.equal(input.invalid, false); assert.equal(row.costPrice, undefined);
  assert.equal(dirty, 4); assert.equal(calculations, 4);
});

test('Cập nhật CK mua vào giữ giá trực tiếp và CK đã nhập', async () => {
  const rows: any[] = [{ name: 'Bình Lock', brand: 'Lock', costMode: 'manual', price: 400000, costPrice: 160000 },
    { name: 'Bình Lock', brand: 'Lock', price: 400000, purchaseDiscount: 10, costPrice: 360000 }];
  let handler: any;
  const context: any = { editor: { rows, dirty: false }, costModeOf, normalize: (s: string) => String(s ?? '').toLowerCase(), defaultCostDiscount: () => 58,
    purchasePrice: (price: number, discount: number) => Math.round(price * (100 - discount) / 100), applyPurchaseCost,
    reviewPurchaseCosts: async () => rows.map((r,index)=>({index,mode:costModeOf(r),value:costModeOf(r)==='manual'?r.costPrice:r.purchaseDiscount})),
    $: () => ({ addEventListener: (_: string, fn: any) => { handler = fn; } }), isManager: () => true,
    api: async () => ({ products: [] }), markDirty() {}, renderLines() {}, refreshCostToggle() {}, saveQuote: async () => {}, toast() {} };
  const start = source.indexOf('async function refreshPurchaseCosts()');
  runInNewContext(source.slice(start, source.indexOf('// ----- hộp "Tạo báo giá mới"', start)), context);
  assert.equal(await handler(), true, 'chỉ tiếp tục duyệt khi cập nhật và lưu được giá mua');
  assert.equal(rows[0].costPrice, 160000); assert.equal(rows[0].purchaseDiscount, undefined);
  assert.equal(rows[1].costPrice, 360000); assert.equal(rows[1].purchaseDiscount, 10); assert.equal(rows[1].costMode, 'discount');
  rows[0].price = 500000; syncPurchaseCost(rows[0]); assert.equal(rows[0].costPrice, 160000);
});
