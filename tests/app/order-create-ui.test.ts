import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

function setup(pushResult: 'create' | 'cancel' = 'create', configReady = true) {
  const listeners = new Map<string, Function>(), dialogEvents = new Map<string, Function>();
  const fields: Record<string, { value: string }> = Object.fromEntries(['orderDate', 'deliveryDate', 'deliveryAddress', 'note', 'pushSapo'].map(k => [k, { value: '' }]));
  const form = { elements: fields, reset: () => { for (const f of Object.values(fields)) f.value = ''; fields.pushSapo!.value = 'no'; }, reportValidity: () => true, addEventListener: (key: string, f: Function) => listeners.set(key, f) };
  const dialog = { open: false, showModal() { this.open = true; }, close() { this.open = false; dialogEvents.get('close')?.(); }, addEventListener: (key: string, f: Function) => dialogEvents.set(key, f) };
  const elements: Record<string, any> = { '#order-create-dialog': dialog, '#order-create-form': form, '#order-create-submit': {}, '#order-create-status': {}, '#order-create-error': {}, '#order-create-quote': {} };
  const calls: string[] = [], posts: any[] = [];
  const context: any = {};
  runInNewContext(readFileSync(new URL('../../trial-ui/order-create.js', import.meta.url), 'utf8').replace('export function initOrderCreate', 'globalThis.initOrderCreate = function'), context);
  const ui = context.initOrderCreate({ $: (id: string) => elements[id], todayIso: () => '2026-10-12',
    api: async (path: string) => { calls.push(path); if (path === '/orders/create-config') { if (!configReady) throw Object.assign(new Error('Missing route'), { status: 404 }); return { version: 1, noteMaxLength: 20000 }; } return { data: { quoteNo: 'BG_001', customer: 'Khách', notes: 'Ghi chú báo giá\nThanh toán 30 ngày', customerAddress: 'Địa chỉ báo giá', deliveryDate: '2026-10-30' } }; },
    chooseSapo: async (_ref: any, opts: any) => { calls.push('sapo'); return pushResult === 'cancel' ? null : opts.run(7, true); },
  });
  const run = async (body: any, location: any, push: boolean) => { posts.push({ body, location, push }); return { id: 'order-1' }; };
  return { ui, run, calls, posts, fields, dialog, error: elements['#order-create-error'], submit: () => listeners.get('submit')!({ preventDefault() {} }) };
}

test('sinh đơn UI: form mở ngay và chép ghi chú; chọn chỉ trên web không kiểm tra Sapo', async () => {
  const s = setup(); const pending = s.ui.choose({ quoteId: 'q1', quoteNo: 'BG_001' }, s.run);
  assert.equal(s.dialog.open, true);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(s.calls, ['/quotes/q1', '/orders/create-config']); assert.equal(s.fields.note!.value, 'Ghi chú báo giá\nThanh toán 30 ngày');
  s.fields.note!.value = 'Ghi chú đã sửa'; await s.submit();
  assert.equal((await pending).id, 'order-1'); assert.deepEqual(s.calls, ['/quotes/q1', '/orders/create-config']);
  assert.equal(s.posts[0].body.note, 'Ghi chú đã sửa'); assert.equal(s.posts[0].push, false);
});

test('sinh đơn UI: chỉ kiểm Sapo sau gửi form; huỷ chọn kho giữ form và ghi chú', async () => {
  const s = setup('cancel'); const pending = s.ui.choose({ quoteId: 'q1' }, s.run);
  await new Promise(resolve => setImmediate(resolve));
  s.fields.pushSapo!.value = 'yes'; s.fields.note!.value = 'Không mất nội dung';
  await s.submit(); assert.deepEqual(s.calls, ['/quotes/q1', '/orders/create-config', 'sapo']); assert.equal(s.posts.length, 0);
  assert.equal(s.dialog.open, true); assert.equal(s.fields.note!.value, 'Không mất nội dung');
  s.fields.pushSapo!.value = 'no'; await s.submit();
  assert.equal((await pending).id, 'order-1'); assert.equal(s.posts[0].body.note, 'Không mất nội dung');
});


test('sinh đơn UI: API cũ chưa có capability thì chặn gửi, tránh mất ghi chú khi UI deploy trước API', async () => {
  const s = setup('create', false); const pending = s.ui.choose({ quoteId: 'q1' }, s.run);
  await new Promise(resolve => setImmediate(resolve));
  assert.match(s.error.textContent, /API sinh đơn đang cập nhật/);
  await s.submit(); assert.equal(s.posts.length, 0);
  s.dialog.close(); assert.equal(await pending, null);
});
