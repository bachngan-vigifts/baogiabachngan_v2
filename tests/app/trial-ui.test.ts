import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { bundleQuoteMath, bundleProductSearch, PRODUCT_SEARCH_OUT, QUOTE_MATH_OUT } from '../../scripts/build-trial-ui.ts';
import * as math from '../../src/modules/quotes/domain/quote-math.ts';

const ui = join(import.meta.dirname, '../../trial-ui');

test('trial-ui/quote-math.js được sinh từ quote-math.ts và chưa cũ (chạy `npm run ui:build` nếu lỗi)', () => {
  assert.equal(readFileSync(QUOTE_MATH_OUT, 'utf8'), bundleQuoteMath());
  assert.equal(readFileSync(PRODUCT_SEARCH_OUT, 'utf8'), bundleProductSearch());
});

test('giao diện tính tiền giống hệt máy chủ trên báo giá ngẫu nhiên', async () => {
  const js = await import(pathToFileURL(QUOTE_MATH_OUT).href);
  let seed = 7;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
  for (let n = 0; n < 500; n++) {
    const doc = {
      type: (['B2B', 'HRC', 'VIGIFTS'] as const)[Math.floor(rnd() * 3)]!, vat: Math.floor(rnd() * 11),
      rows: Array.from({ length: 1 + Math.floor(rnd() * 5) }, () => ({
        qty: Math.floor(rnd() * 500) / (rnd() < .2 ? 4 : 1), price: Math.floor(rnd() * 1e6), printFee: rnd() < .5 ? Math.floor(rnd() * 20000) : 0,
        discountType: rnd() < .5 ? 'amount' as const : 'percent' as const, discount: Math.floor(rnd() * 50), costPrice: Math.floor(rnd() * 5e5),
        ...(rnd() < .2 ? { taxRate: 10 } : {}),
      })),
    };
    assert.deepEqual(js.totals(doc), math.totals(doc));
    assert.deepEqual(js.profit(doc), math.profit(doc));
  }
});

test('trang dùng thử: mọi id mà app.js tra cứu đều có trong index.html; login.html giữ nguyên phần # khi chuyển trang', () => {
  const html = readFileSync(join(ui, 'index.html'), 'utf8'), app = readFileSync(join(ui, 'app.js'), 'utf8');
  const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]));
  const used = [...app.matchAll(/\$\('#([\w-]+)'\)/g)].map(m => m[1]!);
  assert.ok(used.length > 50);
  assert.deepEqual(used.filter(id => !ids.has(id)), []);
  assert.match(readFileSync(join(ui, 'login.html'), 'utf8'), /location\.replace\('index\.html' \+ location\.hash\)/);
});
