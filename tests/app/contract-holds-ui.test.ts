import { test } from 'node:test';
import assert from 'node:assert/strict';

const { showOrderHolds } = await import(
  new URL('../../trial-ui/order-holds.js', import.meta.url).href
);

class Element {
  dataset: Record<string, string> = {};
  children: Element[] = [];
  textContent = '';
  className = '';
  type = '';
  disabled = false;
  events = new Map<string, () => Promise<void>>();
  constructor(readonly tagName = 'div') {}
  get childElementCount(): number {
    return this.children.length;
  }
  append(...nodes: Element[]): void {
    this.children.push(...nodes);
  }
  replaceChildren(...nodes: Element[]): void {
    this.children = nodes;
  }
  addEventListener(event: string, fn: () => Promise<void>): void {
    this.events.set(event, fn);
  }
  querySelectorAll(tag: string): Element[] {
    return this.children.flatMap((c) => [
      ...(c.tagName === tag ? [c] : []),
      ...c.querySelectorAll(tag),
    ]);
  }
}
const text = (node: Element): string =>
  [node.textContent, ...node.children.map(text)].join(' ');
const empty = {
  holdMode: 'capped',
  lines: [{ sku: 'TEA', remaining: 5, held: 0 }],
  holds: [],
  manualDays: 5,
  canHold: true,
  canRelease: false,
  canExtend: false,
  blockedReason: null,
};
async function withDom(run: () => Promise<void>): Promise<void> {
  const oldDocument = globalThis.document,
    oldPrompt = globalThis.prompt;
  Object.assign(globalThis, {
    document: { createElement: (tag: string) => new Element(tag) },
    prompt: () => 'Khách đổi lịch',
  });
  try {
    await run();
  } finally {
    Object.assign(globalThis, { document: oldDocument, prompt: oldPrompt });
  }
}

test('HĐKT hiển thị nút theo API, gửi cùng orderId và chống bấm giữ lặp khi đang gửi', async () =>
  withDom(async () => {
    const root = new Element(),
      requests: {
        path: string;
        method?: string;
        body?: { clientKey?: string; reason?: string };
      }[] = [];
    let held = false,
      changed = 0,
      finish!: () => void;
    const wait = new Promise<void>((resolve) => {
      finish = resolve;
    });
    await showOrderHolds({
      root,
      orderId: 'contract-order',
      title: 'Giữ hàng HĐKT',
      isManager: () => true,
      toast() {},
      onChanged: () => {
        changed++;
      },
      api: async (
        path: string,
        method?: string,
        body?: { clientKey?: string; reason?: string },
      ) => {
        requests.push({ path, method, body });
        if (method === 'POST') {
          await wait;
          held = true;
          return { lines: [{ sku: 'TEA', qty: 5, want: 5 }] };
        }
        return held
          ? {
              ...empty,
              lines: [{ sku: 'TEA', remaining: 5, held: 5 }],
              holds: [{ expiresAt: '2026-11-15T10:00:00.000Z' }],
              canHold: false,
              canRelease: true,
              canExtend: true,
            }
          : empty;
      },
    });
    assert.match(text(root), /Giữ hàng HĐKT/);
    assert.equal(root.querySelectorAll('button').length, 1);
    const click = root.querySelectorAll('button')[0]!.events.get('click')!;
    const first = click(),
      second = click();
    assert.equal(requests.filter((r) => r.method === 'POST').length, 1);
    finish();
    await Promise.all([first, second]);
    const post = requests.find((r) => r.method === 'POST')!;
    assert.equal(post.path, '/orders/contract-order/holds');
    assert.match(post.body!.clientKey!, /^[a-f0-9-]{36}$/);
    assert.equal(changed, 1);
    assert.deepEqual(
      root.querySelectorAll('button').map((b) => b.textContent),
      ['Gia hạn 5 ngày', 'Huỷ giữ'],
    );
    assert.match(text(root), /giữ 5 \/ còn giao 5/);
  }));

test('HĐKT nháp hiện lý do chặn, không hiện thao tác; API lỗi được hiển thị', async () =>
  withDom(async () => {
    const root = new Element();
    await showOrderHolds({
      root,
      orderId: 'draft',
      title: 'Giữ hàng HĐKT',
      toast() {},
      api: async () => ({
        ...empty,
        canHold: false,
        blockedReason: 'Duyệt HĐKT trước khi giữ hàng.',
      }),
    });
    assert.match(text(root), /Duyệt HĐKT trước/);
    assert.equal(root.querySelectorAll('button').length, 0);
    await showOrderHolds({
      root,
      orderId: 'missing',
      toast() {},
      api: async () => {
        throw Error('Không tìm thấy đơn hàng / HĐKT.');
      },
    });
    assert.match(text(root), /Không tìm thấy/);
  }));

test('đổi chứng từ / phiên khi đang tải không cho phản hồi cũ vẽ lại hoặc tiếp tục ghi', async () =>
  withDom(async () => {
    const root = new Element(),
      original = new Element();
    original.textContent = 'Hợp đồng đang xem';
    root.append(original);
    let current = true,
      resolve!: (value: typeof empty) => void;
    const pending = showOrderHolds({
      root,
      orderId: 'old',
      toast() {},
      isCurrent: () => current,
      api: () =>
        new Promise<typeof empty>((r) => {
          resolve = r;
        }),
    });
    current = false;
    resolve(empty);
    await pending;
    assert.equal(text(root).trim(), 'Hợp đồng đang xem');
    let requests = 0;
    current = true;
    await showOrderHolds({
      root,
      orderId: 'new',
      toast() {},
      isCurrent: () => current,
      api: async () => {
        requests++;
        return empty;
      },
    });
    current = false;
    await root.querySelectorAll('button')[0]!.events.get('click')!();
    assert.equal(requests, 1, 'nút thuộc phiên cũ không gửi thêm yêu cầu');
  }));
