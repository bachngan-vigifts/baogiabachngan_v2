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

test('Cash UI: người được chỉ định có nút duyệt phiếu người khác, không có nút tự duyệt hoặc quản trị két', async () => {
  const previous = globalThis.document;
  Object.assign(globalThis, { document: { createElement: (tag: string) => new E(tag), body: new E('body') } });
  try {
    const root = new E('section'), calls: string[] = [];
    const ui = initCash({ root, user: () => ({ id: 'delegate' }), toast: () => {}, go: () => {},
      api: async (path: string) => {
        calls.push(path);
        if (path.endsWith('/approve')) return { ok: true };
        if (path === '/cash') return {
          drawer: { openingSetAt: '2026-10-18', approvalThreshold: 1000000 }, balance: 500000,
          activeShift: null, ownShift: null, canManage: false, canApprove: true, canVoid: false,
          openReconciliations: 0, updatedAt: '2026-10-18T01:00:00Z',
        };
        return { entries: ['other', 'delegate'].map((createdBy, i) => ({
          id: String(i), entryNo: 'PT-' + i, at: '2026-10-18T01:00:00Z', kind: 'other_income',
          direction: 'in', amount: 1000000, reason: 'Thu tiền', createdBy, by: createdBy, status: 'pending',
        })), nextBefore: null };
      },
    });
    await ui.load();
    const buttons = root.all().filter(e => e.tag === 'button' && e.textContent === 'Duyệt');
    assert.equal(buttons.length, 1);
    assert.ok(!root.all().some(e => e.tag === 'button' && e.textContent === 'Cấu hình két'));
    await buttons[0]!.listeners.get('click')![0]!();
    assert.ok(calls.includes('/cash/entries/0/approve'));
  } finally { Object.assign(globalThis, { document: previous }); }
});

test('Cash UI: Manager có nút Duyệt cho phiếu mình tạo theo cờ server', async () => {
  const previous = globalThis.document;
  Object.assign(globalThis, { document: { createElement: (tag: string) => new E(tag), body: new E('body') } });
  try {
    const root = new E('section'), calls: string[] = [];
    const ui = initCash({ root, user: () => ({ id: 'mgr' }), toast: () => {}, go: () => {},
      api: async (path: string) => {
        calls.push(path);
        if (path.endsWith('/approve')) return { ok: true };
        if (path === '/cash') return {
          drawer: { openingSetAt: '2026-10-19', approvalThreshold: 1000000 }, balance: 0,
          activeShift: null, ownShift: null, canManage: true, canApprove: true, canSelfApprove: true, canVoid: true,
          openReconciliations: 0, updatedAt: '2026-10-19T01:00:00Z',
        };
        return { entries: [{ id: 'own', entryNo: 'PT-1', at: '2026-10-19T01:00:00Z', kind: 'adjustment',
          direction: 'in', amount: 1000000, reason: 'Điều chỉnh', createdBy: 'mgr', by: 'Manager', status: 'pending' }], nextBefore: null };
      },
    });
    await ui.load();
    const approve = root.all().find(e => e.tag === 'button' && e.textContent === 'Duyệt');
    assert.ok(approve);
    await approve.listeners.get('click')![0]!();
    assert.ok(calls.includes('/cash/entries/own/approve'));
  } finally { Object.assign(globalThis, { document: previous }); }
});
