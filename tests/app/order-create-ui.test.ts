import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { orderNotesFromQuote, orderDeliveryAddress, syncOrderDeliveryNotes, orderRecipient } from '../../src/modules/sales/domain/order-notes.ts';

function setup(pushResult: 'create' | 'cancel' = 'create', configReady = true, confirm = true, sourcing: any = false) {
  const listeners = new Map<string, Function>(), dialogEvents = new Map<string, Function>();
  const fields: Record<string, { value: string; dataset: Record<string, string>; addEventListener: (event: string, fn: Function) => void; change: () => void }> = Object.fromEntries(['orderNo', 'customerName', 'orderDate', 'deliveryDate', 'deliveryAddress', 'receiverName', 'receiverPhone', 'note', 'pushSapo'].map(k => [k, (() => { const events = new Map<string, Function>(); return { value: '', dataset: {}, addEventListener: (event: string, fn: Function) => events.set(event, fn), change: () => events.get('change')?.() }; })()]));
  const form = { elements: fields, reset: () => { for (const f of Object.values(fields)) f.value = ''; fields.pushSapo!.value = 'yes'; }, reportValidity: () => true, addEventListener: (key: string, f: Function) => listeners.set(key, f) };
  const dialog = { open: false, showModal() { this.open = true; }, close() { this.open = false; dialogEvents.get('close')?.(); }, addEventListener: (key: string, f: Function) => dialogEvents.set(key, f) };
  const elements: Record<string, any> = { '#order-create-dialog': dialog, '#order-create-form': form, '#order-create-submit': {}, '#order-create-status': {}, '#order-create-error': {}, '#order-create-quote': {} };
  const calls: string[] = [], posts: any[] = [], confirmations: any[] = [];
  const context: any = { orderNotesFromQuote, orderDeliveryAddress, syncOrderDeliveryNotes, orderRecipient };
  runInNewContext(readFileSync(new URL('../../trial-ui/order-create.js', import.meta.url), 'utf8').replace(/^import .*;\n/, '').replace('export function initOrderCreate', 'globalThis.initOrderCreate = function'), context);
  const ui = context.initOrderCreate({ $: (id: string) => elements[id], todayIso: () => '2026-10-12',
    api: async (path: string) => { calls.push(path); if (path === '/orders/create-config') { if (!configReady) throw Object.assign(new Error('Missing route'), { status: 404 }); return { version: 2, noteMaxLength: 20000, recipientFields: true }; } if (path.startsWith('/orders/next-no?')) return { orderNo: 'DH_20261012_001' }; return { data: { quoteNo: 'BG_001', customer: 'Khách', contact: 'Người mua', phone: '0901000001', notes: '- Tổng thanh toán đã gồm VAT.\n- Phương thức thanh toán: Chuyển khoản.\n- Thời gian giao hàng: Theo thỏa thuận.\n- Địa chỉ giao hàng: Kho nhận hàng.\n- Thanh toán: 100% sau 30 ngày.\nTrân trọng kính chào.', customerAddress: 'Địa chỉ báo giá', deliveryDate: '2026-10-30' } }; },
    ...(sourcing ? {createSourcing:async()=>typeof sourcing==='object'?sourcing:({read:()=>({warehouseId:'vig',stockPlan:[{sku:'X',qty:2,type:'stock'}],note:'KẾ HOẠCH NGUỒN HÀNG'})})} : {}),
    confirmBox: async (message: string, options: any) => { confirmations.push({ message, options }); return confirm; },
    chooseSapo: async (_ref: any, opts: any) => { calls.push('sapo'); return pushResult === 'cancel' ? null : opts.run(7, true); },
  });
  const run = async (body: any, location: any, push: boolean) => { posts.push({ body, location, push }); return { id: 'order-1' }; };
  return { ui, run, calls, posts, confirmations, fields, dialog, error: elements['#order-create-error'], submit: () => listeners.get('submit')!({ preventDefault() {} }) };
}

test('sinh đơn UI: form mở ngay và chép ghi chú; chọn chỉ trên web không kiểm tra Sapo', async () => {
  const s = setup(); const pending = s.ui.choose({ quoteId: 'q1', quoteNo: 'BG_001' }, s.run);
  assert.equal(s.dialog.open, true);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(s.calls, ['/quotes/q1', '/orders/create-config', '/orders/next-no?quoteId=q1&orderDate=2026-10-12']); assert.equal(s.fields.note!.value, '- Thời gian giao hàng: Giao hàng ngày 30/10/2026.\n- Địa chỉ giao hàng: Kho nhận hàng.\n- Thanh toán: 100% sau 30 ngày. Phương thức: Chuyển khoản.');
  assert.equal(s.fields.orderNo!.value, 'DH_20261012_001'); assert.equal(s.fields.customerName!.value, 'Khách');
  assert.equal(s.fields.receiverName!.value, 'Người mua'); assert.equal(s.fields.receiverPhone!.value, '0901000001');
  s.fields.receiverName!.value = 'Người nhận riêng'; s.fields.receiverPhone!.value = '0902000002';
  assert.equal(s.fields.pushSapo!.value, 'yes'); s.fields.pushSapo!.value = 'no';
  s.fields.note!.value = 'Ghi chú đã sửa'; await s.submit();
  assert.equal((await pending).id, 'order-1'); assert.equal(s.confirmations.length, 1); assert.match(s.confirmations[0].message, /DH_20261012_001[\s\S]*Khách/);
  assert.equal(s.posts[0].body.orderNo, 'DH_20261012_001'); assert.equal(s.posts[0].body.note, 'Ghi chú đã sửa'); assert.equal(s.posts[0].push, false);
  assert.equal(s.posts[0].body.receiverName, 'Người nhận riêng'); assert.equal(s.posts[0].body.receiverPhone, '0902000002');
});

test('sinh đơn UI: chỉ kiểm Sapo sau gửi form; huỷ chọn kho giữ form và ghi chú', async () => {
  const s = setup('cancel'); const pending = s.ui.choose({ quoteId: 'q1' }, s.run);
  await new Promise(resolve => setImmediate(resolve));
  s.fields.pushSapo!.value = 'yes'; s.fields.note!.value = 'Không mất nội dung';
  await s.submit(); assert.equal(s.calls.at(-1), 'sapo'); assert.equal(s.posts.length, 0);
  assert.equal(s.dialog.open, true); assert.equal(s.fields.note!.value, 'Không mất nội dung');
  s.fields.pushSapo!.value = 'no'; await s.submit();
  assert.equal((await pending).id, 'order-1'); assert.equal(s.posts[0].body.note, 'Không mất nội dung');
});

test('sinh đơn UI: số sửa tay được gửi; huỷ xác nhận không tạo đơn', async () => {
  const cancelled = setup('create', true, false); cancelled.ui.choose({ quoteId: 'q1' }, cancelled.run);
  await new Promise(resolve => setImmediate(resolve)); await cancelled.submit();
  assert.equal(cancelled.posts.length, 0); assert.equal(cancelled.dialog.open, true);

  const s = setup(); s.ui.choose({ quoteId: 'q1' }, s.run); await new Promise(resolve => setImmediate(resolve));
  s.fields.orderNo!.value = 'PO-KHACH-001'; await s.submit();
  assert.equal(s.posts[0].body.orderNo, 'PO-KHACH-001');
});


test('sinh đơn UI: API cũ chưa có capability thì chặn gửi, tránh mất ghi chú khi UI deploy trước API', async () => {
  const s = setup('create', false); const pending = s.ui.choose({ quoteId: 'q1' }, s.run);
  await new Promise(resolve => setImmediate(resolve));
  assert.match(s.error.textContent, /API sinh đơn đang cập nhật/);
  await s.submit(); assert.equal(s.posts.length, 0);
  s.dialog.close(); assert.equal(await pending, null);
});


test('đổi ngày và địa chỉ giao cập nhật ghi chú, giữ thanh toán đã chỉnh', async () => {
  const s = setup(); const pending = s.ui.choose({ quoteId: 'q1' }, s.run);
  await new Promise(resolve => setImmediate(resolve));
  s.fields.note!.value = '- Thời gian giao hàng: Cũ\n- Địa chỉ giao hàng: Cũ\n- Thanh toán: Đặt cọc 50%, còn lại trước khi giao.';
  s.fields.deliveryDate!.value = '2026-11-02'; s.fields.deliveryDate!.change();
  s.fields.deliveryAddress!.value = 'Kho mới'; s.fields.deliveryAddress!.change();
  assert.equal(s.fields.note!.value, '- Thời gian giao hàng: Giao hàng ngày 02/11/2026.\n- Địa chỉ giao hàng: Kho mới\n- Thanh toán: Đặt cọc 50%, còn lại trước khi giao.');
  s.dialog.close(); await pending;
});

test('form chỉ trên web → callback app → POST gửi boolean false, kể cả Sapo chưa kết nối', async () => {
  const s = setup(), requests: any[] = [];
  const app = readFileSync(new URL('../../trial-ui/app.js', import.meta.url), 'utf8');
  const source = app.slice(app.indexOf('async function createOrderForQuote('), app.indexOf('// Kiểm tồn cả báo giá'));
  const context: any = { orderCreate: () => s.ui, api: async (path: string, method: string, body: any) => { requests.push({ path, method, body }); return { id: 'draft' }; }, toast() {}, sapoToast() {} };
  runInNewContext(source + '\nglobalThis.create = createOrderForQuote;', context);
  const pending = context.create('q1', 'BG_001');
  await new Promise(resolve => setImmediate(resolve));
  s.fields.pushSapo!.value = 'no'; await s.submit(); assert.equal(await pending, 'draft');
  assert.equal(requests.length, 1); assert.equal(requests[0].body.pushSapo, false);
  assert.equal(requests[0].path, '/orders'); assert.ok(!s.calls.includes('sapo'));
});


test('sinh đơn UI: gửi kế hoạch cấu trúc cùng đơn, giữ ghi chú riêng và kho đã chọn',async()=>{
  const s=setup('create',true,true,true);s.ui.choose({quoteId:'q1'},s.run);await new Promise(resolve=>setImmediate(resolve));
  s.fields.note!.value='Ghi chú riêng';await s.submit();
  assert.equal(s.posts[0].body.warehouseId,'vig');assert.equal(s.posts[0].body.stockPlan[0].qty,2);
  assert.equal(s.posts[0].body.note,'Ghi chú riêng\n\nKẾ HOẠCH NGUỒN HÀNG');
});

test('sinh đơn chờ tạo đơn mua xong, dùng kế hoạch đã có liên kết; lỗi mua thì không gửi đơn bán',async()=>{
  let prepared=0;const base={warehouseId:'vig',stockPlan:[{sku:'X',qty:2,type:'purchase'}],note:'Chưa tạo yêu cầu'};
  const good=setup('create',true,true,{read:()=>base,prepare:async()=>{prepared++;return {...base,note:'Đơn mua NCC · #/purchases/p1'};}});
  const pending=good.ui.choose({quoteId:'q1'},good.run);await new Promise(resolve=>setImmediate(resolve));await good.submit();await pending;
  assert.equal(prepared,1);assert.match(good.posts[0].body.note,/#\/purchases\/p1/);assert.doesNotMatch(good.posts[0].body.note,/Chưa tạo yêu cầu/);
  const bad=setup('create',true,true,{read:()=>base,prepare:async()=>{throw Error('Đơn mua chưa tạo được');}});
  const stopped=bad.ui.choose({quoteId:'q1'},bad.run);await new Promise(resolve=>setImmediate(resolve));await bad.submit();
  assert.equal(bad.posts.length,0);assert.match(bad.error.textContent,/Đơn mua chưa tạo được/);bad.dialog.close();await stopped;
});
