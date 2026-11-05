import { test } from 'node:test';
import assert from 'node:assert/strict';
const { stockLookupTable } = await import(
  new URL('../../trial-ui/stock-lookup-holds.js', import.meta.url).href
);

class Element {
  children: Element[] = [];
  textContent = '';
  className = '';
  constructor(readonly tag: string) {}
  append(...nodes: Element[]): void {
    this.children.push(...nodes);
  }
  all(tag: string): Element[] {
    return this.children.flatMap((n) => [
      ...(n.tag === tag ? [n] : []),
      ...n.all(tag),
    ]);
  }
}
const text = (n: Element): string =>
  [n.textContent, ...n.children.map(text)].filter(Boolean).join(' ');
const product = {
  total: 15,
  stock: [
    { warehouseId: 'a', warehouse: 'Kho A', qty: 10, source: 'ledger' },
    { warehouseId: 'b', warehouse: 'Kho B', qty: 5, source: 'sapo' },
  ],
  held: {
    qty: 5,
    unassigned: 2,
    stock: [
      { warehouseId: 'a', qty: 3 },
      { warehouseId: 'b', qty: 0 },
    ],
  },
};
function render(p: unknown = product): Element {
  const before = globalThis.document;
  Object.assign(globalThis, {
    document: { createElement: (tag: string) => new Element(tag) },
  });
  try {
    return stockLookupTable(p, true);
  } finally {
    Object.assign(globalThis, { document: before });
  }
}

test('Tra tồn có cột Hàng đang giữ theo kho và dòng chưa gắn kho tính một lần', () => {
  const root = render();
  assert.deepEqual(root.all('th').map(text), [
    'Kho',
    'Tồn kho',
    'Hàng đang giữ',
  ]);
  assert.deepEqual(
    root
      .all('tr')
      .slice(1)
      .map((row) => row.all('td').map(text)),
    [
      ['Kho A  · sổ kho', '10', '3'],
      ['Kho B  · Sapo (đồng bộ gần nhất)', '5', '0'],
      ['Chưa gắn kho', '—', '2'],
      ['Tổng', '15', '5'],
    ],
  );
  assert.match(text(root), /chỉ tính một lần trong tổng/);
});

test('giữ bằng 0 vẫn có cột; API cũ chưa hỗ trợ không bị hiển thị thành 0', () => {
  const zero = render({
    ...product,
    held: { qty: 0, unassigned: 0, stock: [] },
  });
  assert.doesNotMatch(text(zero), /Chưa gắn kho/);
  assert.deepEqual(zero.all('tr').at(-1)!.all('td').map(text), [
    'Tổng',
    '15',
    '0',
  ]);
  const oldApi = render({ ...product, held: undefined });
  assert.deepEqual(oldApi.all('tr').at(-1)!.all('td').map(text), [
    'Tổng',
    '15',
    '—',
  ]);
  assert.match(text(oldApi), /Chưa có số liệu hàng đang giữ/);
});
