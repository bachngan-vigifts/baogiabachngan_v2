import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const style = readFileSync(new URL('../../trial-ui/style.css', import.meta.url), 'utf8');
const pos = readFileSync(new URL('../../trial-ui/pos.css', import.meta.url), 'utf8');
const posJs = readFileSync(new URL('../../trial-ui/pos.js', import.meta.url), 'utf8');
const htmlPages = ['index.html', 'customer.html', 'login.html'].map((name) => ({
  name,
  source: readFileSync(new URL(`../../trial-ui/${name}`, import.meta.url), 'utf8'),
}));

test('mọi trang web đều tắt phóng to trên điện thoại', () => {
  for (const page of htmlPages) {
    assert.match(page.source, /<meta name="viewport" content="[^"]*maximum-scale=1[^"]*user-scalable=no[^"]*">/, page.name);
  }
});

test('toàn hệ thống dùng chuẩn giao diện gọn chỉ trên điện thoại', () => {
  const start = style.indexOf('Chuẩn giao diện gọn dùng chung cho toàn hệ thống');
  assert.ok(start > 0);
  const compact = style.slice(start);
  assert.match(compact, /@media \(max-width: 850px\)/);
  assert.match(compact, /:root \{ font-size: var\(--text-caption\); \}/);
  assert.match(compact, /\.btn \{ min-height: 38px/);
  assert.match(compact, /font-size: var\(--text-small\) !important/);
  assert.match(compact, /\.modal-body \{ padding: 12px; font-size: var\(--text-caption\)/);
  assert.match(compact, /\.auth, \.auth \* \{ font-size: revert; \}/);
  assert.match(style, /body:has\(#view-pos:not\(\[hidden\]\)\) \.chat-launcher \{ bottom: calc\([^}]+\+ 66px\); \}/);
});

test('POS có lớp thu gọn riêng vì pos.css được tải sau style.css', () => {
  const start = pos.indexOf('POS dùng cùng chuẩn gọn của toàn hệ thống');
  assert.ok(start > 0);
  const compact = pos.slice(start);
  assert.match(compact, /@media \(max-width: 850px\)/);
  assert.match(compact, /\.pos-payment-due strong \{ font-size: var\(--text-heading\)/);
  assert.match(compact, /\.pos-main-actions \.btn \{ min-height: 42px; font-size: var\(--text-caption\)/);
  assert.match(compact, /\.pos-customer-input \{ min-height: 40px/);
  assert.match(compact, /\.pos-product-price-stock \{ display: flex; align-items: baseline; justify-content: space-between/);
  assert.match(posJs, /el\('span', 'pos-product-price-stock'\)/);
  assert.match(compact, /\.pos-checkout \{ font-size: var\(--text-caption\); \}/);
  assert.match(compact, /\.pos-line-top b \{ font-size: var\(--text-caption\)/);
  assert.match(compact, /\.pos-total strong \{ font-size: var\(--text-heading\); \}/);
});
