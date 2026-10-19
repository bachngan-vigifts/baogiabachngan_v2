import { test } from 'node:test';
import assert from 'node:assert/strict';
// @ts-ignore browser module uses injected DOM.
import { posOrderEditor, posCodReceipt, posPaymentText } from '../../trial-ui/pos-order-edit.js';
class E {
  children: E[] = []; text = ''; style: Record<string, string> = {}; value: any = ''; type = ''; checked = false; disabled = false; open = true;
  listeners = new Map<string, Function[]>();
  constructor(public tag: string) {}
  set textContent(v: string) { this.text = String(v); this.children = []; }
  get textContent(): string { return this.text + this.children.map(n => n.textContent).join(''); }
  set innerHTML(_: string) { throw new Error('Unsafe HTML'); }
  append(...nodes: E[]) { this.children.push(...nodes); }
  replaceChildren(...nodes: E[]) { this.children = nodes; }
  setAttribute() {}
  addEventListener(name: string, fn: Function) { this.listeners.set(name, [...(this.listeners.get(name) || []), fn]); }
  async emit(name: string) { for (const fn of this.listeners.get(name) || []) await fn({ preventDefault() {} }); }
  all(): E[] { return this.children.flatMap(n => [n, ...n.all()]); }
  cloneNode() { return new E(this.tag); }
  reportValidity() { return true; }
  showModal() { this.open = true; }
  close() { this.open = false; }
  remove() {}
}
test('Sửa đơn POS: dữ liệu chỉ là chữ; gửi revision, ID dòng, giá và địa chỉ; không ghi thu từ form sửa', async () => {
  const previous = globalThis.document, doc = { createElement: (tag: string) => new E(tag), body: new E('body') };
  Object.assign(globalThis, { document: doc });
  try {
    const calls: any[] = [], hostile = '<img src=x onerror=alert(1)>';
    const detail = { order: { id: 'order-1', orderNo: 'POS_001', revision: 7, customerName: hostile, fulfillmentMode: 'cod' },
      lines: [{ id: 'line-1', name: hostile, qty: 2, listUnitPrice: 108000, discountType: 'percent', discountValue: 0, taxRate: 8, deliveredQty: 0 }],
      deliveries: [{ id: 'ship-1', status: 'planned', address: 'Địa chỉ gốc', receiverName: hostile, receiverPhone: '0900000000' }], schedules: [{ note: 'Ship COD' }], payments: [] };
    const button = posOrderEditor({ detail, api: async (...args: any[]) => { calls.push(args); return {}; }, onSaved() {} });
    await button.emit('click');
    assert.equal(doc.body.all().some(n => n.tag === 'img'), false);
    const label = doc.body.all().find(n => n.tag === 'label' && n.text.startsWith('Lý do'))!;
    label.children[0]!.value = 'Khách yêu cầu';
    const nums = doc.body.all().filter(n => n.tag === 'input' && n.type === 'number');
    nums[0]!.value = '3'; nums[1]!.value = '200000';
    assert.equal(doc.body.all().find(n => n.tag === 'label' && n.text.startsWith('Tên khách'))!.children[0]!.value, hostile);
    await doc.body.all().find(n => n.tag === 'form')!.emit('submit');
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], '/orders/order-1/pos');
    assert.equal(calls[0][1], 'PUT');
    assert.equal(calls[0][2].revision, 7);
    assert.deepEqual(calls[0][2].lines[0], { id: 'line-1', qty: '3', price: '200000', discountValue: 0, discountType: 'percent' });
    assert.equal(calls[0][2].delivery.address, 'Địa chỉ gốc');
    assert.equal(calls[0][2].reason, 'Khách yêu cầu');
  } finally { Object.assign(globalThis, { document: previous }); }
});
test('Thu COD tại chi tiết đơn tái sử dụng API chuyến giao, ca đang mở và xác nhận thực nhận', async () => {
  const previous = globalThis.document, doc = { createElement: (tag: string) => new E(tag), body: new E('body') };
  Object.assign(globalThis, { document: doc });
  try {
    const calls: any[] = [];
    const button = posCodReceipt({ delivery: { id: 'ship-1', deliveryNo: 'GH_001' }, onSaved() {}, api: async (...args: any[]) => { calls.push(args); return args[0] === '/pos/options' ? { current: { id: 'current-shift' } } : {}; } });
    await button.emit('click');
    doc.body.all().find(n => n.type === 'checkbox')!.checked = true;
    await doc.body.all().find(n => n.tag === 'form')!.emit('submit');
    assert.equal(calls[1][0], '/pos/cod/ship-1/collect');
    assert.equal(calls[1][2].shiftId, 'current-shift');
    assert.equal(calls[1][2].confirmed, true);
    assert.ok(calls[1][2].key);
    assert.equal(calls.some(c => c[0] === '/payments'), false);
  } finally { Object.assign(globalThis, { document: previous }); }
});

test('Nhãn thanh toán POS phân biệt điều kiện và tiền thực thu, bỏ phiếu đã huỷ', () => {
  const detail = { order: { fulfillmentMode: 'cod' }, schedules: [{ note: 'Ship COD' }], payments: [{ method: 'cash', voidedAt: '2026-10-19' }] };
  assert.equal(posPaymentText(detail), 'Thu COD sau khi giao hàng · Chưa thu');
  detail.payments = [{ method: 'transfer', voidedAt: '' }];
  assert.equal(posPaymentText(detail), 'Thu COD sau khi giao hàng · Đã thu bằng chuyển khoản');
});
