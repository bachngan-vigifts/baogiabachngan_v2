import { test } from 'node:test';
import assert from 'node:assert/strict';
import './fixtures/legacy-quote-math.js'; // gán globalThis.QuoteMath – bản cũ, làm chuẩn đối chiếu
import * as M from '../src/modules/quotes/domain/quote-math.ts';

/* eslint-disable @typescript-eslint/no-explicit-any */
const L = (globalThis as any).QuoteMath;

// PRNG có seed để lỗi tái hiện được.
function rng(seed: number) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const R = rng(20261005);
const pick = <T,>(xs: T[]): T => xs[Math.floor(R() * xs.length)]!;

const prices = [0, 1, 99, 12.5, 100000, 690741, 1234567, undefined, null, 'abc', '15000', -5, NaN];
const qtys = [0, 1, 2, 3, 2.5, 10, 500, undefined, null, -1, '4'];
const discounts = [0, 10, 12.5, 53, 100, 12000, 150, -3, undefined, null, 'x'];
const dtypes = ['percent', 'amount', undefined, 'weird'];
const fees = [0, 2000, 25000, undefined, null, -1, 'z'];
const taxes = [undefined, null, 0, 5, 8, 10, NaN, '8', Infinity];
const brands = ['Minh Long', 'MINH LONG - LYS', 'LocknLock', 'Lock & Lock', 'Healthy Cook', 'Khác', 'Sứ Dưỡng Sinh', 'Lys', undefined, ''];
const names = ['Nồi Healthy Cook', 'Sứ dưỡng sinh', 'Chảo', undefined, 'Hộp Lock n Lock'];
const unit = [0, 4000, 6000, 3333.3, undefined, null, -2, 'q'];

const row = () => ({
  sku: pick(['A', 'B', undefined]), brand: pick(brands), name: pick(names), pattern: pick(['', 'Hoa', undefined]),
  price: pick(prices), qty: pick(qtys), discount: pick(discounts), discountType: pick(dtypes), printFee: pick(fees),
  taxRate: pick(taxes), costPrice: pick([0, 42000, 75000, undefined, null, 'c', -1]),
  ...(R() < 0.4 ? { printing: { unitPrice: pick(unit) } } : {}),
});
const doc = () => ({
  type: pick(['HRC', 'B2B', 'VIGIFTS', 'OTHER']), vat: pick([0, 8, 10, undefined, 5.5]),
  rows: Array.from({ length: Math.floor(R() * 6) }, row),
  ...(R() < 0.5 ? { shipping: { payer: pick(['sender', 'receiver', undefined]) } } : {}),
  ...(R() < 0.5 ? { printing: { totalCost: pick([0, 60000, -1, undefined, 'x']) } } : {}),
});

test('đối chiếu bản cũ ↔ bản mới trên 5.000 báo giá ngẫu nhiên (kết quả phải giống hệt từng bit)', () => {
  for (let i = 0; i < 5000; i++) {
    const d: any = doc(), fee = pick([null, 0, 25000, -4, NaN, 30000]);
    assert.deepStrictEqual(M.totals(d), L.totals(d), `totals #${i} ${JSON.stringify(d)}`);
    assert.deepStrictEqual(M.profit(d, fee as any), L.profit(d, fee), `profit #${i} ${JSON.stringify(d)}`);
    assert.deepStrictEqual(M.printingInfo(d), L.printingInfo(d), `printingInfo #${i}`);
    for (const r of d.rows) {
      assert.deepStrictEqual(M.after(r, d), L.after(r, d), `after #${i}`);
      assert.deepStrictEqual(M.discounted(r), L.discounted(r), `discounted #${i}`);
      assert.deepStrictEqual(M.rate(r, d), L.rate(r, d), `rate #${i}`);
      assert.deepStrictEqual(M.defaultCostDiscount(r), L.defaultCostDiscount(r), `defaultCostDiscount #${i}`);
      assert.deepStrictEqual(M.defaultCostPrice(r, r.price), L.defaultCostPrice(r, r.price), `defaultCostPrice #${i}`);
      assert.deepStrictEqual(M.purchasePrice(r.price, r.discount), L.purchasePrice(r.price, r.discount), `purchasePrice #${i}`);
      const included = R() < 0.5;
      assert.deepStrictEqual(M.netPrice(r.price as number, r.taxRate as number, included), L.netPrice(r.price, r.taxRate, included), `netPrice #${i}`);
    }
  }
});

test('đối chiếu customerDiscount bản cũ ↔ mới', () => {
  const ds = [{ lys: 10, minhLong: 20, lock: 58 }, { lock: 101 }, { lock: -1 }, {}, null, undefined, { lys: NaN }, { minhLong: '5' }];
  for (let i = 0; i < 2000; i++) {
    const b = pick([...brands, 'minh long i', 'locknlock', 'LOCK']), d = pick(ds) as any, mode = pick(['percent', 'amount']) as any, p = pick([0, 1000, 200000, 12.5]);
    assert.deepStrictEqual(M.customerDiscount(b, d, mode, p), L.customerDiscount(b, d, mode, p), `${b} ${JSON.stringify(d)} ${mode} ${p}`);
  }
});

test('danh sách xưởng in giống bản cũ', () => assert.deepEqual([...M.printingWorkshops], L.printingWorkshops));
