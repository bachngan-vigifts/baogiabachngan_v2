import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ui = join(import.meta.dirname, '../../trial-ui'), read = (f: string) => readFileSync(join(ui, f), 'utf8');

test('nút "Thêm/Tạo" đầu trang danh sách là nút chữ xanh dương, có nhãn thấy được (đợt 4, V7)', () => {
  const style = read('style.css'), mobile = read('mobile-design.css');
  const base = style.match(/^\.btn-add \{[^}]+\}/m)?.[0] ?? '';
  assert.match(base, /background: var\(--blue\)/);
  assert.match(base, /border-radius: var\(--radius-sm\)/);
  assert.doesNotMatch(base, /50%|--green/);
  assert.doesNotMatch(mobile, /\.btn-add[^{]*\{[^}]*background:var\(--green\)/, 'điện thoại không còn nút tròn xanh lá');
  assert.doesNotMatch(mobile, /\[data-mobile-create\][^{]*\{[^}]*font-size:0/, 'nút tạo mới trên điện thoại không giấu chữ');
  const buttons = [read('index.html'), read('care.js'), read('inventory.js'), read('stocktake.js')].join('\n').match(/class="btn-add"[^>]*>.*?<\/(button|a)>|'btn-add'[\s\S]*?<span>[^<]+<\/span>/g) ?? [];
  assert.ok(buttons.length >= 7, 'đủ 7 nút Thêm/Tạo');
  for (const b of buttons) assert.match(b, /<span>[^<]+<\/span>/, 'nút có chữ: ' + b.slice(0, 80));
});

test('nút nhỏ ngoài bảng không làm hành động chính dưới 42/44px (đợt 4, V5)', () => {
  const css = read('control-sizes.css');
  assert.match(css, /\.btn\.small\.primary:not\(table \*[^{]*\{[^}]*min-height: var\(--ctl-h\)/);
  assert.match(css, /@media \(max-width: 850px\) \{\s*:is\(main, dialog, \[popover\]\) \.btn\.small:not\([^{]*table \*[^{]*\{[^}]*min-height: var\(--ctl-h\)/);
});
