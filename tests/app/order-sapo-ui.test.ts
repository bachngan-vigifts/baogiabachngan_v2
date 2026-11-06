import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

function setup(order: any, push = true) {
  const events = new Map<string, Function>(), posts: any[] = [], messages: string[] = []; let refreshed = 0;
  const context: any = { Promise, document: { createElement: (tag: string) => ({ tag, disabled: false, addEventListener: (event: string, fn: Function) => events.set(event, fn) }) } };
  const source = readFileSync(new URL('../../trial-ui/order-sapo.js', import.meta.url), 'utf8');
  runInNewContext(source.replace('export function orderSapoAction', 'globalThis.action = function'), context);
  const button = context.action({ order, api: async (...args: any[]) => { posts.push(args); return { sapo: { status: 'created' } }; }, chooseSapo: async (ref: any, opts: any) => {
    assert.equal(ref.orderId, order.id); assert.equal(opts.existingDocument, true); return opts.run(7, push);
  }, onSaved: async () => { refreshed++; }, toast: (message: string) => messages.push(message) });
  return { button, posts, messages, refreshed: () => refreshed, click: () => events.get('click')!() };
}

test('chưa đẩy: Tạo đơn Sapo gửi đúng ID chứng từ, refresh sang trạng thái có liên kết', async () => {
  const s = setup({ id: 'existing-id', status: 'draft', canCreateSapo: true });
  assert.equal(s.button.textContent, 'Tạo đơn Sapo');
  await s.click(); assert.equal(s.posts.length, 1);
  assert.equal(s.posts[0][0], '/orders/existing-id/sapo'); assert.equal(s.posts[0][1], 'POST'); assert.equal(s.posts[0][2].sapoLocationId, 7);
  assert.equal(s.refreshed(), 1); assert.equal(s.button.disabled, false);
});

test('đã có liên kết: Xem đơn Sapo mở an toàn, không gọi API tạo; quyền/cancel ẩn nút tạo', () => {
  const s = setup({ sapoOrderUrl: 'https://store/admin/orders/1', sapoOrderCode: 'DH_001' });
  assert.equal(s.button.tag, 'a'); assert.equal(s.button.textContent, 'Xem đơn Sapo'); assert.equal(s.button.rel, 'noopener noreferrer'); assert.equal(s.posts.length, 0);
  assert.equal(setup({ id: 'o', status: 'draft', canCreateSapo: false }).button, null);
  assert.equal(setup({ id: 'o', status: 'cancelled', canCreateSapo: true }).button, null);
});

test('chọn giữ trên web không gửi POST; module không lưu token hay dựng HTML', async () => {
  const s = setup({ id: 'o', status: 'draft', canCreateSapo: true }, false);
  await s.click(); assert.equal(s.posts.length, 0); assert.equal(s.messages.length, 0);
  assert.doesNotMatch(readFileSync(new URL('../../trial-ui/order-sapo.js', import.meta.url), 'utf8'), /innerHTML|localStorage|sessionStorage/);
});

test('sales action on a delivered POS order uses the same server-authorized action and refreshes after queuing', async () => {
  const s = setup({ id: 'pos-sales-order', channel: 'pos', status: 'delivered', canCreateSapo: true, canEdit: false });
  assert.equal(s.button.textContent, 'Tạo đơn Sapo');
  await s.click();
  assert.equal(s.posts[0][0], '/orders/pos-sales-order/sapo');
  assert.equal(s.refreshed(), 1);
});

test('web pending and changed-source states cannot send another request; retry keeps the same document identity',async()=>{
 const pending=setup({id:'web:lock:1',status:'draft',sapoPending:true,canCreateSapo:false});assert.equal(pending.button.disabled,true);assert.equal(pending.button.textContent,'Đang tạo Sapo');assert.equal(pending.posts.length,0);
 const changed=setup({id:'web:lock:1',status:'draft',sapoSourceChanged:true,canCreateSapo:false});assert.equal(changed.button.disabled,true);assert.equal(changed.button.textContent,'Đối soát Sapo');
 const retry=setup({id:'web:lock:1',status:'draft',sapoRetry:true,canCreateSapo:true});assert.equal(retry.button.textContent,'Đối soát / tạo Sapo');await retry.click();assert.equal(retry.posts[0][0],'/orders/web%3Alock%3A1/sapo');
});
