import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const style = readFileSync(new URL('../../trial-ui/style.css', import.meta.url), 'utf8');
const pos = readFileSync(new URL('../../trial-ui/pos.css', import.meta.url), 'utf8');

test('toàn hệ thống dùng chuẩn giao diện gọn chỉ trên điện thoại', () => {
  const start = style.indexOf('Chuẩn giao diện gọn dùng chung cho toàn hệ thống');
  assert.ok(start > 0);
  const compact = style.slice(start);
  assert.match(compact, /@media \(max-width: 850px\)/);
  assert.match(compact, /:root \{ font-size: 12px; \}/);
  assert.match(compact, /\.btn \{ min-height: 38px/);
  assert.match(compact, /font-size: 13px !important/);
  assert.match(compact, /\.modal-body \{ padding: 12px; font-size: 11px/);
  assert.match(compact, /\.auth, \.auth \* \{ font-size: revert; \}/);
});

test('POS có lớp thu gọn riêng vì pos.css được tải sau style.css', () => {
  const start = pos.indexOf('POS dùng cùng chuẩn gọn của toàn hệ thống');
  assert.ok(start > 0);
  const compact = pos.slice(start);
  assert.match(compact, /@media \(max-width: 850px\)/);
  assert.match(compact, /\.pos-payment-due strong \{ font-size: 24px/);
  assert.match(compact, /\.pos-main-actions \.btn \{ min-height: 46px; font-size: 12px/);
  assert.match(compact, /\.pos-customer-input \{ min-height: 40px/);
});
