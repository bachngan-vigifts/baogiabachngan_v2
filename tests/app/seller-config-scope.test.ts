import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const app = readFileSync(new URL('../../trial-ui/app.js', import.meta.url), 'utf8');

test('kho bán thuộc trang Phân quyền và không nhân đôi khi mở lại trang', () => {
  // Execute the production mount function with a minimal DOM boundary.
  const source = app.match(/^function sellerConfigView\(\).*$/m)?.[0];
  assert.ok(source);
  const children: object[] = [];
  const permissions = { append: (box: object) => children.push(box) };
  let initialized = 0;
  const view = { load() {} };
  const mount = runInNewContext(`let sellerConfigUi = null; ${source}; sellerConfigView`, {
    document: { createElement: () => ({ id: '' }) },
    $: (selector: string) => {
      assert.equal(selector, '#view-permissions');
      return permissions;
    },
    api() {}, toast() {},
    initSellerConfig: ({ root }: { root: { id: string } }) => {
      initialized++;
      assert.equal(root.id, 'seller-config-box');
      assert.ok(children.includes(root), 'phải gắn bên trong trang trước khi khởi tạo');
      return view;
    },
  });
  assert.equal(mount(), view);
  assert.equal(mount(), view);
  assert.equal(children.length, 1);
  assert.equal(initialized, 1);
});
