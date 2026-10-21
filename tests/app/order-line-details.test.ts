import { test } from 'node:test';
import assert from 'node:assert/strict';
// @ts-ignore browser-only DOM renderer
import { renderOrderLineDetails } from '../../trial-ui/order-line-details.js';
class Node {
  children: Node[] = []; className = ''; text = '';
  constructor(public tag: string) {}
  set textContent(value: string) { this.text = String(value); this.children = []; }
  get textContent(): string { return this.text + this.children.map(n => n.textContent).join(''); }
  append(...nodes: Node[]) { this.children.push(...nodes); }
  replaceChildren(...nodes: Node[]) { this.text = ''; this.children = nodes; }
}
const line = { name: '<img onerror=alert(1)>', sku: '001', unit: 'cái', qty: 2, deliveredQty: 0, listUnitPrice: 108000,
  unitPrice: 90000, discountType: 'percent', discountValue: 10, discountAmount: 21600, taxRate: 8, amount: 180000 };
const source = { ...line, subtotal: 180000, tax: 14400, total: 194400 };
const fee = { name: '<script>Phí in</script>', quantity: 3, unitPrice: 65000, amount: 195000, subtotal: 180556, tax: 14444, taxRate: 8 };

test('POS order detail shows original price, discount, gross after discount, fee quantities, ship and exact stored totals as text', () => {
  const previous = globalThis.document;
  Object.assign(globalThis, { document: { createElement: (tag: string) => new Node(tag) } });
  try {
    const head = new Node('tr'), body = new Node('tbody'), details = new Node('div');
    renderOrderLineDetails({ head, body, details, lines: [line], order: { channel: 'pos', note: '<b>Giao chiều</b>',
      subtotal: 385186, tax: 29214, total: 414400, posSnapshot: JSON.stringify({ lines: [source] }),
      posFees: { services: [fee, { ...fee, name: 'Gói quà', quantity: 1, unitPrice: 5000, amount: 5000, subtotal: 4630, tax: 370 }], shippingFee: 20000 } } });
    assert.equal(head.children.length, 8);
    assert.deepEqual(body.children[0]!.children.slice(1).map(n => n.textContent), [
      '2', '0', '108.000 đgồm VAT', '10%Giảm 21.600 đ', '97.200 đgồm VAT', '8%14.400 đ', '194.400 đgồm VAT']);
    assert.equal(body.children.length, 4);
    assert.equal(body.children[1]!.children[1]!.textContent, '3');
    assert.equal(body.children[1]!.children[3]!.textContent, '65.000 đgồm VAT');
    assert.equal(body.children[3]!.children[0]!.textContent, 'Phí vận chuyển');
    assert.match(details.textContent, /Tổng thanh toán414.400 đ/);
    assert.match(details.textContent, /<b>Giao chiều<\/b>/);
    assert.match(body.textContent, /<script>Phí in<\/script>/);
    assert.equal(body.children.flatMap(n => n.children).some(n => n.tag === 'img' || n.tag === 'script'), false);
    // Navigating away clears POS-only metadata and restores the normal six-column table.
    renderOrderLineDetails({ head, body, details, lines: [line], order: { channel: 'quote' } });
    assert.equal(head.children.length, 6); assert.equal(body.children.length, 1); assert.equal(details.children.length, 0);
  } finally { Object.assign(globalThis, { document: previous }); }
});

test('Legacy or stale POS snapshot cannot invent VAT-inclusive prices; use stored net values with explicit labels', () => {
  const previous = globalThis.document;
  Object.assign(globalThis, { document: { createElement: (tag: string) => new Node(tag) } });
  try {
    for (const snapshot of ['bad json', JSON.stringify({ lines: [{ ...source, qty: 5, total: 1 }] })]) {
      const head = new Node('tr'), body = new Node('tbody'), details = new Node('div');
      renderOrderLineDetails({ head, body, details, lines: [{ ...line, listUnitPrice: null }],
        order: { channel: 'pos', posSnapshot: snapshot, subtotal: 180000, tax: 14400, total: 194400 } });
      assert.equal(body.children[0]!.children[3]!.textContent, 'Chưa có dữ liệugồm VAT');
      assert.equal(body.children[0]!.children[5]!.textContent, '90.000 đchưa VAT');
      assert.equal(body.children[0]!.children[7]!.textContent, '180.000 đchưa VAT');
    }
  } finally { Object.assign(globalThis, { document: previous }); }
});
