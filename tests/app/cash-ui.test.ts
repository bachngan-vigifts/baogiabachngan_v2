import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
// @ts-ignore browser module renders only through the injected DOM.
import { initCash } from '../../trial-ui/cash.js';
class E {
  children: E[] = [];
  className = '';
  text = '';
  value: any = '';
  type = '';
  disabled = false;
  listeners = new Map<string, Function[]>();
  constructor(public tag: string) {}
  set textContent(v: string) {
    this.text = String(v);
    this.children = [];
  }
  get textContent(): string {
    return this.text + this.children.map((e) => e.textContent).join('');
  }
  append(...nodes: E[]) {
    this.children.push(...nodes);
  }
  replaceChildren(...nodes: E[]) {
    this.children = nodes;
    this.text = '';
  }
  addEventListener(event: string, fn: Function) {
    this.listeners.set(event, [...(this.listeners.get(event) || []), fn]);
  }
  querySelector(s: string): E | undefined {
    return this.all().find((e) => (s.startsWith('.') ? e.className.split(' ').includes(s.slice(1)) : e.tag === s));
  }
  all(): E[] {
    return this.children.flatMap((e) => [e, ...e.all()]);
  }
  showModal() {}
  close() {}
  remove() {}
}
test('Cash UI: dữ liệu phiếu chỉ là chữ, phiếu huỷ gạch ngang và Excel dùng đúng bảng đang xem', async () => {
  const previous = globalThis.document;
  const doc = { createElement: (tag: string) => new E(tag), body: new E('body') };
  Object.assign(globalThis, { document: doc });
  try {
    const root = new E('section'),
      hostile = '<img src=x onerror=alert(1)>',
      calls: string[] = [];
    const ui = initCash({
      root,
      user: () => ({ id: 'emp' }),
      toast: () => {},
      go: () => {},
      api: async (path: string) => {
        calls.push(path);
        if (path === '/cash')
          return {
            drawer: { openingSetAt: '2026-10-18', approvalThreshold: 1000000 },
            balance: 500000,
            activeShift: null,
            ownShift: null,
            canManage: false,
            canVoid: false,
            openReconciliations: 0,
            updatedAt: '2026-10-18T01:00:00Z',
          };
        return {
          entries: [
            {
              id: '1',
              entryNo: 'PT-1',
              at: '2026-10-18T01:00:00Z',
              kind: 'other_income',
              direction: 'in',
              amount: 100,
              reason: hostile,
              by: 'NV',
              status: 'voided',
              voidReason: 'Nhập trùng',
            },
          ],
          nextBefore: null,
        };
      },
    });
    await ui.load();
    assert.match(root.textContent, /<img src=x/);
    assert.ok(!root.all().some((e) => e.tag === 'img' || e.tag === 'script'));
    assert.ok(root.all().some((e) => e.className === 'cash-voided'));
    assert.ok(root.all().some((e) => e.textContent === 'Xuất Excel bảng đang xem'));
    assert.ok(
      root
        .all()
        .filter((e) => ['+ Thu tiền', '+ Chi tiền', 'Kết ca'].includes(e.textContent))
        .every((e) => e.disabled),
    );
    assert.match(calls[1]!, /from=.*&to=/);
  } finally {
    Object.assign(globalThis, { document: previous });
  }
  const source = readFileSync('trial-ui/cash.js', 'utf8');
  assert.doesNotMatch(source, /innerHTML|insertAdjacentHTML|localStorage/);
  assert.match(source, /downloadExcel/);
  assert.match(source, /reasonCode/);
  assert.match(source, /pendingEntries/);
});
