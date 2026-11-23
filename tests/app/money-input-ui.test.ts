import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ui = join(import.meta.dirname, '../../trial-ui'), read = (f: string) => readFileSync(join(ui, f), 'utf8');

test('ô tiền tự có dấu chấm được bật cho toàn app, ô gốc vẫn giữ số chưa định dạng', () => {
  assert.match(read('app.js'), /import \{ initMoneyInputs \} from '\.\/money-input\.js';[\s\S]*initMoneyInputs\(\);/);
  const m = read('money-input.js');
  assert.match(m, /PROTO\.set\.call\(input, raw === '-' \? '' : raw\)/, 'ô gốc nhận số chưa định dạng');
  assert.match(m, /step === 'any'/, 'ô cho phép số lẻ không tự chấm');
  assert.match(m, /if \(\/%\|phần trăm\|tỷ lệ\/i\.test\(text\)\) return false;/, 'ô % không phải ô tiền');
});

test('ô tiền kiểu chữ được đánh dấu rõ data-money="1"', () => {
  assert.match(read('product-admin.js'), /name="price:\$\{esc\(p\.id\)\}" data-money="0"/, 'giá sản phẩm giữ dấu để kiểm phần lẻ trước khi lưu');
  assert.equal((read('store-reports.js').match(/data-money="1"/g) || []).length, 4);
  assert.match(read('weekly-reports.js'), /name="nextTarget" data-money="1"/);
});

test('ô nhập, ô chọn, nút cùng hàng dùng chung chiều cao (PC 42px, điện thoại 44px), nạp sau cùng', () => {
  const html = read('index.html'), css = read('control-sizes.css');
  const links = [...html.matchAll(/<link rel="stylesheet" href="([^"]+)">/g)].map(m => m[1]);
  assert.equal(links.at(-1), 'control-sizes.css');
  assert.match(css, /:root \{ --ctl-h: 42px; \}/);
  assert.match(css, /@media \(max-width: 850px\) \{ :root \{ --ctl-h: 44px; \} \}/);
  assert.match(css, /not\(table \*/, 'không đụng ô trong bảng');
});
