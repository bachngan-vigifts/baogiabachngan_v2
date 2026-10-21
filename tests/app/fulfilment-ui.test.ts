import { orderRecipient } from '../../src/modules/sales/domain/order-notes.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
const source = readFileSync(new URL('../../trial-ui/app.js', import.meta.url), 'utf8');

function fixture(multi = false, existing = false) {
  const form: any = { createSchedule: { checked: !existing, disabled: false }, plannedDate: { value: '' }, timeSlot: { value: '' }, receiverName: { value: '' }, note: { value: 'Bọc chống sốc' }, addEventListener: (_: string, fn: Function) => { context.submit = fn; } };
  const inputs = [form.plannedDate, form.timeSlot, form.receiverName];
  const nodes: any = { '#pack-form': form, '#pack-save': {}, '#pack-error': {}, '#pack-existing-schedule': {}, '#pack-schedule-fields': { querySelectorAll: () => inputs }, '#pack-dialog': { close() {} } };
  const calls: any[] = [], opened: string[] = [];
  const context: any = { orderRecipient, $: (id: string) => nodes[id], packing: {}, todayIso: () => '2026-10-16', fmtDate: (x: string) => x,
    sales: { order: { id: 'order-1', contact: 'Chị Lan', phone: '0901', address: '12 Lê Lợi' } },
    readPackForm: () => multi ? [{ orderLineId: 'l1', qty: 5, source: 'warehouse' }, { orderLineId: 'l1', qty: 5, source: 'agent', sourceNote: 'Đại lý' }] : [{ orderLineId: 'l1', qty: 10, source: 'warehouse' }],
    readPackShip: () => ({ to: 'customer', address: 'Địa chỉ giao riêng', phone: '0902', carrierName: 'Nhà xe' }),
    api: async (path: string, method: string, body: object) => { calls.push({ path, method, body }); return { slips: multi ? [{}, {}] : [{}], sentToWarehouse: !multi }; },
    toast() {}, openOrder: (id: string) => opened.push(id) };
  const start = source.indexOf('function fillPackSchedule('), end = source.indexOf('/** Phần "Giao hàng"', start);
  assert.ok(start >= 0 && end > start);
  runInNewContext(source.slice(start, end), context);
  const a = source.indexOf("$('#pack-form').addEventListener('submit'"), b = source.indexOf('\nasync function sendSlip', a);
  assert.ok(a >= 0 && b > a);
  runInNewContext(source.slice(a, b), context);
  context.fillPackSchedule(existing ? [{ deliveryNo: 'GH-OLD', plannedDate: '2026-10-20' }] : [], context.sales.order);
  return { form, nodes, inputs, calls, opened, context, submit: () => context.submit({ preventDefault() {} }) };
}

test('luồng gộp: chưa có lịch thì bật lịch mới, gửi đúng địa chỉ/người nhận và tự gửi kho một nguồn', async () => {
  const f = fixture();
  assert.equal(f.form.createSchedule.checked, true); assert.equal(f.form.createSchedule.disabled, true);
  assert.equal(f.form.plannedDate.value, '2026-10-16'); assert.ok(f.inputs.every((i: any) => !i.disabled));
  f.form.plannedDate.value = '2026-10-20'; f.form.timeSlot.value = 'Sáng';
  await f.submit();
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].path, '/orders/order-1/packing');
  assert.equal(f.calls[0].body.schedule.receiverName, 'Chị Lan');
  assert.equal(f.calls[0].body.schedule.address, 'Địa chỉ giao riêng'); assert.equal(f.calls[0].body.schedule.receiverPhone, '0902');
  assert.equal(f.calls[0].body.schedule.plannedDate, '2026-10-20'); assert.equal(f.calls[0].body.sendToWarehouse, true);
  assert.deepEqual(f.opened, ['order-1']);
});

test('luồng gộp: dùng lịch đã có không tạo chuyến mới; nhiều nguồn giữ nháp để kiểm tra', async () => {
  const f = fixture(true, true);
  assert.equal(f.form.createSchedule.checked, false); assert.ok(f.inputs.every((i: any) => i.disabled));
  assert.match(f.nodes['#pack-existing-schedule'].textContent, /GH-OLD/);
  await f.submit();
  assert.equal(f.calls[0].body.schedule, undefined); assert.equal(f.calls[0].body.sendToWarehouse, false);
  f.form.createSchedule.checked = true; f.context.showPackSchedule(); assert.ok(f.inputs.every((i: any) => !i.disabled));
});


test('lịch kèm đóng gói điền người nhận riêng của đơn, không thay người mua', async () => {
  const f = fixture();
  Object.assign(f.context.sales.order, {receiverName:'Người nhận riêng',receiverPhone:'0902000002'});
  f.context.fillPackSchedule([],f.context.sales.order);
  assert.equal(f.form.receiverName.value,'Người nhận riêng');
  await f.submit();
  assert.equal(f.calls[0].body.schedule.receiverName,'Người nhận riêng');
  assert.equal(f.context.sales.order.contact,'Chị Lan');
});
