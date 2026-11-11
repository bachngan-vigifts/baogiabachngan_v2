import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../../trial-ui/catalogue/app.js', import.meta.url), 'utf8');

test('Trợ lý sản phẩm có ô "Website khác" để dán link danh mục / sản phẩm và nút tải từ link', () => {
  const view = app.slice(app.indexOf('function assistantView('), app.indexOf('function assistantGroupLabel('));
  assert.match(view, /id="a-external-url" type="url"/);
  assert.match(view, /btn\('Tải danh mục & sản phẩm từ link','assistant-external','grid'\)/);
  assert.match(app, /action==='assistant-external'\)\{await loadExternalLink\(\)\}/);
});

test('Tải từ link: chỉ https, LocknLock / Minh Long dùng nguồn sẵn có, còn lại đi qua bước xác nhận thương hiệu', () => {
  const fn = app.slice(app.indexOf('async function loadExternalLink('), app.indexOf('async function loadAssistantCategories('));
  assert.match(fn, /protocol!=='https:'/);
  assert.match(fn, /locknlockonline\|minhlongonline/);
  assert.match(fn, /return proposeBrand\(u\.href\)/);
  // Giữ giá trị đã nhập khi trang vẽ lại.
  assert.match(app, /assistantExternalUrl=\$\('#a-external-url'\)\?\.value\?\?assistantExternalUrl/);
});
