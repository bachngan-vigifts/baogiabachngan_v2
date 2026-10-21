import { test } from 'node:test';
import assert from 'node:assert/strict';
// @ts-ignore browser module
import { openPosFlowCheckout, openPosOrderFlows } from '../../trial-ui/pos-order-flow.js';
// @ts-ignore browser module
import { buildPosPrint } from '../../trial-ui/pos-print.js';
// @ts-ignore browser module
import { shiftSummaryRows } from '../../trial-ui/pos-report.js';
class El {
  children: El[] = [];
  text = '';
  value: any = '';
  checked = false;
  disabled = false;
  open = false;
  dataset: any = {};
  tag: string;
  className = '';
  onclick: any;
  oninput: any;
  onchange: any;
  onsubmit: any;
  type = '';
  hidden = false;
  constructor(tag: string) {
    this.tag = tag;
  }
  set textContent(s: string) {
    this.text = String(s);
    this.children = [];
  }
  get textContent(): string {
    return this.text + this.children.map((c) => c.textContent).join('');
  }
  append(...xs: El[]) {
    this.children.push(...xs);
  }
  replaceChildren(...xs: El[]) {
    this.children = xs;
    this.text = '';
  }
  setAttribute() {}
  addEventListener() {}
  showModal() {
    this.open = true;
  }
  close() {
    this.open = false;
  }
  remove() {}
  querySelectorAll(s: string): El[] {
    const xs = this.children.flatMap((c) => [c, ...c.querySelectorAll('*')]);
    return s === '*' ? xs : xs.filter((c) => s.split(',').includes(c.tag));
  }
}
const doc = {
  body: new El('body'),
  createElement: (tag: string) => new El(tag),
};
const input = (r: El, label: string) =>
  r.querySelectorAll('label').find((l) => l.children[0]?.textContent === label)!
    .children[1]!;
const button = (r: El, label: string) =>
  r.querySelectorAll('button').find((l) => l.textContent === label)!;
async function dom(fn: () => Promise<void>) {
  const old = (globalThis as any).document;
  (globalThis as any).document = doc;
  doc.body = new El('body');
  try {
    await fn();
  } finally {
    (globalThis as any).document = old;
  }
}
test('form cọc: 30%/50%/tự nhập; bank chưa tick gửi pending, không tự nhận đã thu', () =>
  dom(async () => {
    const sent: any[] = [];
    openPosFlowCheckout({
      flow: 'deposit',
      total: 194400,
      toast: () => {},
      onSubmit: (b: any) => sent.push(b),
    });
    const dlg = doc.body.children[0]!,
      amount = input(dlg, 'Tiền cọc (VNĐ)');
    assert.equal(amount.value, 58320);
    await button(dlg, '50%').onclick();
    assert.equal(amount.value, 97200);
    amount.value = '12345';
    const method = input(dlg, 'Hình thức thanh toán');
    method.value = 'transfer';
    method.onchange();
    assert.equal(
      input(dlg, 'Cửa hàng đã thực nhận khoản chuyển khoản này').checked,
      false,
    );
    await dlg.querySelectorAll('form')[0]!.onsubmit({ preventDefault() {} });
    assert.equal(sent.length, 1);
    assert.equal(sent[0].initialAmount, 12345);
    assert.equal(sent[0].confirmed, false);
    assert.equal(sent[0].method, 'transfer');
  }));
test('form cọc khoá khi đang ghi nhận, bấm trùng chỉ gửi một lần; máy chủ từ chối thì giữ form để sửa', () =>
  dom(async () => {
    const sent: any[] = []; let finish: (v: string) => void = () => {}; let back = 0;
    openPosFlowCheckout({
      flow: 'deposit',
      total: 100000,
      toast: () => {},
      onBack: () => back++,
      onSubmit: (b: any) => { sent.push(b); return new Promise<string>((r) => (finish = r)); },
    });
    const dlg = doc.body.children[0]!, form = dlg.querySelectorAll('form')[0]!, save = button(dlg, 'Ghi nhận cọc');
    const first = form.onsubmit({ preventDefault() {} });
    assert.equal(save.textContent, 'Đang ghi nhận…');
    assert.equal(save.disabled, true);
    assert.equal(dlg.dataset.busy, '1');
    assert.equal(button(dlg, '← Quay lại thanh toán').disabled, true);
    await form.onsubmit({ preventDefault() {} });
    assert.equal(sent.length, 1, 'bấm trùng không gửi lần hai');
    finish('rejected'); await first;
    assert.equal(dlg.open, true, 'từ chối thì giữ form');
    assert.equal(save.disabled, false);
    assert.equal(save.textContent, 'Ghi nhận cọc');
    assert.match(dlg.textContent, /Chưa ghi nhận được/);
    button(dlg, '← Quay lại thanh toán').onclick();
    assert.equal(back, 1); assert.equal(dlg.open, false);
  }));
test('form ship trả trước giữ 100%, có người nhận/địa chỉ, không ghép COD', () =>
  dom(async () => {
    const sent: any[] = [];
    openPosFlowCheckout({
      flow: 'prepaid',
      total: 108000,
      customer: { name: '<img onerror=1>', phone: '0900', address: 'Cần Thơ' },
      toast: () => {},
      onSubmit: (b: any) => sent.push(b),
    });
    const dlg = doc.body.children[0]!;
    assert.equal(input(dlg, 'Số tiền trả trước').value, 108000);
    assert.equal(dlg.querySelectorAll('img').length, 0);
    await dlg.querySelectorAll('form')[0]!.onsubmit({ preventDefault() {} });
    assert.equal(sent[0].saleFlow, 'prepaid');
    assert.equal(sent[0].delivery.address, 'Cần Thơ');
    assert.equal(sent[0].fulfillmentMode, undefined);
  }));
test('xác nhận khoản chờ yêu cầu thực nhận và tham chiếu; tên khách chỉ là văn bản', () =>
  dom(async () => {
    const calls: any[] = [],
      errors: string[] = [];
    const a = {
      order: {
        id: 'o',
        orderNo: 'POS_1',
        customerName: '<img onerror=1>',
        status: 'confirmed',
        total: 100,
        posSnapshot: '{}',
      },
      saleFlow: 'deposit',
      paid: 0,
      remaining: 100,
      pending: 30,
      held: true,
      holdUntil: '2026-10-25T00:00:00Z',
      state: 'Chờ xác nhận tiền',
      intents: [
        {
          id: 'i',
          status: 'pending',
          amount: 30,
          createdAt: '2026-10-20T00:00:00Z',
        },
      ],
      receipts: [],
    };
    await openPosOrderFlows({
      api: async (path: string, method: string, b: any) => {
        calls.push({ path, method, b });
        return a;
      },
      toast: (s: string) => errors.push(s),
      shift: { id: 's' },
      register: { id: 'r' },
      orderId: 'o',
    });
    const dlg = doc.body.children[0]!;
    assert.ok(dlg.textContent.includes(a.order.customerName));
    assert.equal(dlg.querySelectorAll('img').length, 0);
    await button(dlg, 'Xác nhận đã nhận tiền').onclick();
    assert.equal(calls.filter((c) => c.method === 'POST').length, 0);
    assert.equal(errors.length, 1);
    input(dlg, 'Mã tham chiếu chuyển khoản').value = 'BANK-1';
    input(dlg, 'Cửa hàng đã thực nhận đúng khoản này').checked = true;
    await button(dlg, 'Xác nhận đã nhận tiền').onclick();
    const post = calls.find((c) => c.method === 'POST');
    assert.equal(post.path, '/pos/order-flow-intents/i/confirm');
    assert.deepEqual(post.b, {
      shiftId: 's',
      confirmed: true,
      reference: 'BANK-1',
    });
  }));
test('phiếu cọc và ship phân biệt thực thu, chờ và còn lại; báo cáo không đưa pending vào két', () => {
  const bill = {
    register: { name: 'Quầy' },
    lines: [],
    createdAt: '2026-10-20T00:00:00Z',
    total: 100,
    subtotal: 100,
    tax: 0,
    saleFlow: 'deposit',
    initialAmount: 30,
    receivedAmount: 0,
    pendingTransfer: true,
    remaining: 100,
    holdUntil: '2026-10-25T00:00:00Z',
  };
  const text = buildPosPrint(doc, bill).textContent;
  assert.ok(text.includes('PHIẾU ĐẶT CỌC'));
  assert.ok(text.includes('Đã thực nhận0 đ'));
  assert.ok(text.includes('Chuyển khoản đang chờ30 đ'));
  assert.ok(text.includes('Còn phải thu100 đ'));
  assert.ok(!text.includes('ĐÃ THU TIỀN'));
  assert.ok(
    buildPosPrint(doc, { ...bill, saleFlow: 'prepaid' }).textContent.includes(
      'COD: 0 đ',
    ),
  );
  const rows = shiftSummaryRows({
    bills: { count: 1, revenue: 100, discount: 0 },
    cash: 0,
    transfer: 0,
    shift: { openingCash: 500 },
    expectedCash: 500,
    orderFlows: {
      deposit: 0,
      balance: 0,
      prepaid: 0,
      pending: { count: 1, amount: 30 },
      outstanding: { count: 1, amount: 100 },
    },
  });
  assert.ok(rows.find(([l]: string[]) => l?.includes('không vào két')));
  assert.deepEqual(rows.at(-1), ['Tiền két hệ thống', '500 đ']);
});
