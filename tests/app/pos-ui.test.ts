import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
// @ts-ignore browser module uses injected DOM only while rendering
import { buildPosPrint } from '../../trial-ui/pos-print.js';
// @ts-ignore
import { initPos } from '../../trial-ui/pos.js';
// @ts-ignore shared browser presentation helpers
import { cashKindLabel, shiftSummaryRows, shiftCodRows } from '../../trial-ui/pos-report.js';
class Element {
  children: Element[] = [];
  text = '';
  value: any = '';
  hidden = false;
  disabled = false;
  type = '';
  placeholder = '';
  src = '';
  className = '';
  dataset: Record<string, string> = {};
  attributes: Record<string, string> = {};
  style: Record<string, string> = {};
  listeners = new Map<string, Function[]>();
  checked = false;
  open = false;
  classList = { toggle: () => {}, add: () => {}, remove: () => {} };
  constructor(public tag: string) {}
  set textContent(v: string) {
    this.text = String(v);
    this.children = [];
  }
  get textContent(): string {
    return this.text + this.children.map((x) => x.textContent).join('');
  }
  append(...nodes: Element[]) {
    this.children.push(...nodes);
  }
  replaceChildren(...nodes: Element[]) {
    this.children = nodes;
    this.text = '';
  }
  setAttribute(k: string, v: string) {
    this.attributes[k] = v;
    if (k.startsWith('data-')) this.dataset[k.slice(5)] = v;
  }
  addEventListener(k: string, f: Function) {
    this.listeners.set(k, [...(this.listeners.get(k) || []), f]);
  }
  async fire(k: string, event: Record<string, unknown> = {}) {
    for (const f of this.listeners.get(k) || []) await f({ target: this, preventDefault() {}, stopPropagation() {}, ...event });
  }
  querySelectorAll(selector: string): Element[] {
    const all = this.children.flatMap((x) => [x, ...x.querySelectorAll('*')]);
    if (selector === '*') return all;
    return all.filter((x) => selector.split(',').includes(x.tag));
  }
  get lastChild() {
    return this.children.at(-1)!;
  }
  get options() { return this.children; }
  get selectedIndex() { const i = this.children.findIndex(x => x.value === this.value); return i < 0 ? 0 : i; }
  focus() {}
  select() {}
  remove() {}
  showModal() {
    this.open = true;
  }
  close() {
    this.open = false;
  }
}
const doc = {
  createElement: (tag: string) => new Element(tag),
  createTextNode: (s: string) => {
    const n = new Element('#text');
    n.text = s;
    return n;
  },
  body: new Element('body'),
};

test('Bán hàng nhanh PC giữ chi tiết dòng trong cột đơn, không áp dụng luật này cho mobile', () => {
  const css = readFileSync('trial-ui/pos.css', 'utf8');
  const start = css.indexOf('/* Desktop: keep long product details');
  const desktop = css.slice(start, css.indexOf('.pos-payment-modal', start));
  assert.match(desktop, /\.pos-line-top\s*\{[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\) max-content 28px/);
  assert.match(desktop, /\.pos-line-top b\s*\{[\s\S]*overflow-wrap:\s*anywhere/);
  assert.match(desktop, /\.pos-line-edit\s*\{[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\)/);
  assert.match(desktop, /\.pos-extra-fees\s*\{[\s\S]*position:\s*relative/);
  assert.doesNotMatch(desktop, /max-width:\s*850px/);
});
const sample = {
  register: { name: 'Cửa hàng' },
  customer: '<script>customer</script>',
  memberName: 'Nhân viên',
  createdAt: '2026-10-18T01:00:00Z',
  orderNo: 'POS_1',
  lines: [
    {
      name: '<img src=x onerror=alert(1)>',
      sku: '001',
      unit: 'cái',
      qty: 2,
      listUnitPrice: 108000,
      listAmount: 216000,
      discountType: 'percent',
      discountValue: 10,
      discountAmount: 21600,
      total: 194400,
    },
  ],
  subtotal: 180000,
  tax: 14400,
  discount: 21600,
  total: 194400,
  method: 'cash',
  tendered: 200000,
  change: 5600,
};
test('Báo cáo POS/K80 dùng nhãn tiếng Việt, phân biệt giá trị đơn và tiền thực thu', () => {
  const report = {
    register: { name: 'Quầy Lock' }, memberName: 'Tên nhân viên',
    shift: { memberId: 'emp-id', openedAt: '2026-10-18T01:00:00Z', openingCash: 200000 },
    bills: { count: 2, revenue: 500000, discount: 0 }, cash: 100000, transfer: 0, expectedCash: 300000,
    manual: ['other_income', 'cash_in', 'petty_expense', 'advance', 'cash_out'].map(kind => ({ kind, direction: 'in', amount: 0 })),
    bookAdjustments: [{ direction: 'out', amount: 50000 }],
    openingCount: { scope: 'partial', count: 3 },
    cod: { receivedInShift: { count: 0, amount: 0 }, receivedFromPrevious: { count: 0, amount: 0 }, pending: { count: 1, amount: 400000 } },
  };
  const text = buildPosPrint(doc, report, 'shift').textContent;
  for (const name of ['Chi vặt', 'Rút két', 'Tạm ứng', 'Nộp két', 'Thu khác', 'Điều chỉnh két']) assert.ok(text.includes(name));
  for (const code of ['petty_expense', 'cash_in', 'cash_out', 'adjustment']) assert.ok(!text.includes(code));
  for (const [label, value] of [...shiftSummaryRows(report), ...shiftCodRows(report)]) {
    assert.ok(text.includes(label)); assert.ok(text.includes(value));
  }
  assert.ok(text.includes('Giá trị đơn đã lập (gồm COD)500.000'));
  assert.ok(text.includes('Tiền mặt thực thu100.000'));
  assert.ok(text.includes('Đã giao, chưa thu (cùng két)1 đơn · 400.000'));
  assert.ok(text.includes('đếm nhanh một phần (3 mã)'));
  assert.equal(cashKindLabel('adjustment'), 'Điều chỉnh két');
});
test('Form mở ca không còn kiểm đếm hoặc gọi API kiểm đếm', async () => {
  const prevDoc = globalThis.document, prevWin = globalThis.window;
  Object.assign(globalThis, { document: doc, window: { addEventListener() {} } });
  try {
    const root = new Element('section'), calls: any[] = [], notices: string[] = [];
    const api = async (path: string, method = 'GET', body?: any) => {
      calls.push({ path, method, body });
      if (path.startsWith('/pos/options')) return {
        registers: [{ id: 'r', name: 'Quầy Lock', pricePolicyId: 'vat', secondPricePolicyId: 'retail' }],
        current: null, shifts: [{ id: 's', memberId: 'internal-id', memberName: 'Tên nhân viên', openedAt: '2026-10-18T01:00:00Z' }],
        templates: [{ id: 'morning', name: 'Ca sáng', startsAt: '08:00', endsAt: '14:00' }], policies: [],
      };
      if (path.startsWith('/pos/catalog')) return { products: [], nextOffset: null };
      if (path.startsWith('/cash')) return { nextOpeningCash: 200000 };
      if (path.startsWith('/pos/opening-counts')) throw Error('Không được gọi API kiểm đếm');
      if (path === '/pos/shifts/open') return { id: 'new' };
      throw Error(path);
    };
    const ui = initPos({ root, api, toast: (s: string) => notices.push(s), user: () => ({ id: 'emp', name: 'NV' }), confirmBox: async () => true, go() {} });
    await ui.load();
    await root.querySelectorAll('button').find(b => b.textContent === 'Báo cáo ca')!.fire('click');
    assert.ok(doc.body.children.at(-1)!.textContent.includes('Tên nhân viên'));
    assert.ok(!doc.body.children.at(-1)!.textContent.includes('internal-id'));
    await root.querySelectorAll('button').find(b => b.textContent === 'Mở ca')!.fire('click');
    const dialog = doc.body.children.at(-1)!;
    assert.ok(!dialog.textContent.includes('Kiểm đếm nhanh'));
    assert.ok(!dialog.querySelectorAll('label').some(e => e.className === 'pos-count-row'));
    assert.ok(!calls.some(c => c.path.startsWith('/pos/opening-counts')));
    const cash = dialog.querySelectorAll('input').find(e => e.placeholder === 'Nhập tổng tiền mặt thực đếm')!;
    assert.equal(cash.value, '');
    assert.notEqual((cash as any).readOnly, true);
    await dialog.querySelectorAll('form')[0]!.fire('submit');
    await new Promise(r => setTimeout(r, 0));
    assert.ok(!calls.some(c => c.path === '/pos/shifts/open'));
    cash.value = '150.000';
    await cash.fire('input');
    assert.match(dialog.textContent, /Vẫn được mở bán/);
    await dialog.querySelectorAll('form')[0]!.fire('submit');
    await new Promise(r => setTimeout(r, 0));
    const sent = calls.find(c => c.path === '/pos/shifts/open');
    assert.ok(sent);
    assert.equal(sent.body.counts, undefined);
    assert.equal(sent.body.openingCash, 150000);
  } finally { Object.assign(globalThis, { document: prevDoc, window: prevWin }); }
});
test('Báo cáo ca đóng danh sách trước khi mở chi tiết và hiện trạng thái tải', async () => {
  const prevDoc = globalThis.document, prevWin = globalThis.window;
  Object.assign(globalThis, { document: doc, window: { addEventListener() {} } });
  try {
    const root = new Element('section');
    const report = { shift: { openedAt: '2026-10-18T01:00:00Z', openingCash: 0 }, register: { name: 'Két Minh Long' }, memberName: 'Thái Thị Yến',
      bills: { count: 0, revenue: 0, discount: 0 }, manual: [], bookAdjustments: [], cash: 0, transfer: 0, expectedCash: 0,
      cod: { receivedInShift: { count: 0, amount: 0 }, receivedFromPrevious: { count: 0, amount: 0 }, pending: { count: 0, amount: 0 } } };
    const api = async (path: string) => {
      if (path.startsWith('/pos/options')) return { registers: [{ id: 'r', name: 'Két Minh Long', pricePolicyId: 'vat' }], current: null,
        shifts: [{ id: 's', memberName: 'Thái Thị Yến', openedAt: '2026-10-18T01:00:00Z', closedAt: null }], templates: [], policies: [] };
      if (path.startsWith('/pos/catalog')) return { products: [], nextOffset: null };
      if (path.startsWith('/pos/orders')) return { registers: [], counts: {}, orders: [] };
      if (path === '/pos/shifts/s') return report;
      throw Error(path);
    };
    const ui = initPos({ root, api, toast() {}, user: () => ({ id: 'emp', name: 'Thái Thị Yến' }), confirmBox: async () => true, go() {} });
    await ui.load();
    await root.querySelectorAll('button').find(b => b.textContent === 'Báo cáo ca')!.fire('click');
    const list = doc.body.children.at(-1)!;
    const view = list.querySelectorAll('button').find(b => b.textContent.includes('Thái Thị Yến'))!;
    await view.fire('click');
    assert.equal(list.open, false);
    assert.equal(doc.body.children.at(-1)!.open, true);
    assert.match(doc.body.children.at(-1)!.textContent, /Giá trị đơn đã lập/);
  } finally { Object.assign(globalThis, { document: prevDoc, window: prevWin }); }
});
test('POS chọn quầy mặc định từ server, ưu tiên ca đang mở và đặt lại khi đổi tài khoản', async () => {
  const prevDoc = globalThis.document,
    prevWin = globalThis.window;
  Object.assign(globalThis, {
    document: doc,
    window: { addEventListener() {} },
  });
  try {
    let userId = 'emp',
      defaultRegisterId = 'ml',
      current: any = null;
    const catalogs: string[] = [];
    const api = async (path: string) => {
      if (path.startsWith('/pos/options'))
        return {
          registers: ['lock', 'ml'].map((id) => ({
            id,
            name: id,
            pricePolicyId: 'vat',
            secondPricePolicyId: 'retail',
          })),
          defaultRegisterId,
          current,
          shifts: [],
          templates: [],
          policies: [],
        };
      if (path.startsWith('/pos/catalog')) {
        catalogs.push(path);
        return { products: [], nextOffset: null };
      }
      throw Error(path);
    };
    const ui = initPos({
      api,
      root: new Element('section'),
      toast() {},
      user: () => ({ id: userId, name: 'NV' }),
      confirmBox: async () => true,
      go() {},
    });
    await ui.load();
    assert.match(catalogs.at(-1)!, /registerId=ml/);
    current = { id: 'shift', registerId: 'lock', memberId: 'emp' };
    await ui.load();
    assert.match(catalogs.at(-1)!, /registerId=lock/);
    current = null;
    userId = 'other';
    await ui.load();
    assert.match(catalogs.at(-1)!, /registerId=ml/);
  } finally {
    Object.assign(globalThis, { document: prevDoc, window: prevWin });
  }
});
test('K80: bill tạm không có số chính thức, nhãn rõ ràng và dữ liệu độc hại chỉ là chữ', () => {
  const p = buildPosPrint(doc, { ...sample, temporary: true });
  assert.match(p.textContent, /BILL TẠM TÍNH - CHƯA THANH TOÁN/);
  assert.ok(!p.textContent.includes('POS_1'));
  assert.match(p.textContent, /<script>customer<\/script>/);
  assert.equal(p.querySelectorAll('script,img').length, 0);
  assert.match(p.textContent, /TỔNG THÀNH TIỀN/);
  assert.match(p.textContent, /VAT[\s\S]*TỔNG THANH TOÁN/);
  assert.ok(!p.textContent.includes('Tiền trước thuế (gồm phí)'));
  assert.ok(!p.textContent.includes('TỔNG CỘNG'));
  const separatorIndex = p.children.findIndex((x: Element) => x.className === 'bill-total-separator');
  const totalIndex = p.children.findIndex((x: Element) => x.textContent.includes('TỔNG THÀNH TIỀN'));
  assert.equal(separatorIndex + 1, totalIndex);
  assert.equal(p.children.filter((x: Element) => x.className.includes('strong') && /TỔNG THÀNH TIỀN|VAT|TỔNG THANH TOÁN/.test(x.textContent)).length, 3);
  const paid = buildPosPrint(doc, sample);
  assert.match(paid.textContent, /POS_1/);
  assert.match(paid.textContent, /Giảm 10%/);
  assert.match(paid.textContent, /ĐÃ THU TIỀN/);
  assert.match(paid.textContent, /5.600/);
  const text = readFileSync('trial-ui/pos-print.js', 'utf8');
  assert.match(text, /size:80mm/);
});
test('POS: tìm/quét và giỏ hàng dùng server preview, mặc định giá VAT; không render bằng innerHTML', async () => {
  const prevDoc = globalThis.document,
    prevWin = globalThis.window;
  Object.assign(globalThis, {
    document: doc,
    window: { addEventListener() {} },
  });
  try {
    const root = new Element('section'),
      calls: any[] = [];
    const api = async (path: string, method = 'GET', body?: any) => {
      calls.push({ path, method, body });
      if (path.startsWith('/pos/options'))
        return {
          registers: [
            {
              id: 'r',
              name: 'Quầy 1',
              pricePolicyId: 'vat',
              secondPricePolicyId: 'retail',
            },
          ],
          current: { id: 's', registerId: 'r', memberId: 'emp' },
          shifts: [],
          templates: [],
          policies: [
            { id: 'vat', name: 'Giá bán lẻ (+ VAT)' },
            { id: 'retail', name: 'Giá bán lẻ' },
          ],
        };
      if (path.startsWith('/pos/catalog'))
        return {
          products: [
            {
              sku: '001',
              name: 'Ly sứ',
              unit: 'cái',
              price: 108000,
              available: 10,
            },
          ],
          nextOffset: null,
        };
      if (path === '/pos/preview')
        return {
          ...sample,
          lines: [{ ...sample.lines[0], sku: '001' }],
          temporary: true,
        };
      throw Error(path);
    };
    const ui = initPos({
      api,
      root,
      toast() {},
      user: () => ({ id: 'emp', name: 'NV', perms: ['pos.sell'] }),
      confirmBox: async () => true,
      go() {},
    });
    await ui.load();
    assert.match(root.textContent, /Bán hàng nhanh/);
    const filters = root.querySelectorAll('div').find((x) => x.className === 'pos-product-filters')!;
    assert.equal(filters.hidden, true);
    const showFilters = root.querySelectorAll('button').find((x) => x.textContent === 'Xem bộ lọc ▾')!;
    await showFilters.fire('click');
    assert.equal(filters.hidden, false);
    assert.equal(showFilters.textContent, 'Ẩn bộ lọc ▴');
    assert.ok(root.querySelectorAll('button').find((x) => x.textContent === 'Tìm tất cả SP'));
    const product = root.querySelectorAll('button').find((x) => x.className === 'pos-product')!;
    assert.ok(product);
    await product.fire('click');
    assert.equal(product.attributes['aria-pressed'], 'true');
    await new Promise((r) => setTimeout(r, 230));
    const preview = calls.find((x) => x.path === '/pos/preview');
    assert.ok(preview);
    assert.equal(preview.body.pricePolicyId, 'vat');
    assert.deepEqual(preview.body.rows, [{ sku: '001', qty: 1, discountType: 'percent', discountValue: 0 }]);
    assert.equal(preview.body.total, undefined);
    assert.equal(ui.dirty(), true);
    await root.querySelectorAll('button').find((x) => x.textContent === 'THANH TOÁN')!.fire('click');
    const payment = doc.body.children.at(-1)!;
    const cash = payment.querySelectorAll('button').find((x) => x.textContent === 'Đủ tiền')!;
    await cash.fire('click');
    const pay = payment.querySelectorAll('button').find((x) => x.textContent === 'Thu tiền & in bill')!;
    assert.equal(pay.disabled, false);
  } finally {
    Object.assign(globalThis, { document: prevDoc, window: prevWin });
  }
  for (const p of ['trial-ui/pos.js', 'trial-ui/pos-print.js'])
    assert.ok(!/\.innerHTML\s*=|insertAdjacentHTML/.test(readFileSync(p, 'utf8')), p);
});

test('POS mobile lấy 20 sản phẩm mỗi lượt và tự tải tiếp khi cuộn', () => {
  const js = readFileSync('trial-ui/pos.js', 'utf8'), css = readFileSync('trial-ui/pos.css', 'utf8');
  assert.match(js, /mobile \? 20 : 60/);
  assert.match(js, /grid\.scrollTop \+ grid\.clientHeight >= grid\.scrollHeight - 120/);
  assert.match(css, /max-height: calc\(164px \* 10 \+ 8px \* 9\); overflow-y: auto/);
});
test('Bán hàng nhanh có bảng đơn theo cửa hàng và đủ bộ lọc trạng thái vận hành', () => {
  const source = readFileSync('trial-ui/pos.js', 'utf8');
  for (const label of ['Đơn hàng cửa hàng', 'Tất cả đơn', 'Chờ xử lý', 'Đang đóng hàng', 'Đợi giao', 'Hoàn thành', 'Đã hủy'])
    assert.ok(source.includes(label), label);
  assert.match(source, /\/pos\/orders\?/);
  assert.match(source, /registerId/);
  assert.match(source, /Mở đơn trên GHN/);
  assert.match(source, /khachhang\.ghn\.vn\/order\/detail\?order_code=/);
  assert.match(source, /khachhang\.ghn\.vn\/order\/create/);
});

test('Chọn khách POS: gợi ý trong ô tìm, lọc Khách lẻ/B2B, bàn phím và khách vãng lai', async () => {
  const prevDoc = globalThis.document, prevWin = globalThis.window;
  Object.assign(globalThis, { document: doc, window: { addEventListener() {} } });
  try {
    const root = new Element('section'), calls: string[] = [];
    let allowRetail = true;
    const api = async (path: string) => {
      calls.push(path);
      if (path.startsWith('/pos/options')) return { registers: [{ id: 'r', name: 'Lock' }], current: null, shifts: [], templates: [], policies: [] };
      if (path.startsWith('/pos/catalog')) return { products: [], nextOffset: null };
      if (path.startsWith('/pos/customers')) return { canListRetail: allowRetail, customers: [{ id: 'c', name: '<b>Cô Hồng</b>', phone: '0901234567' }] };
      throw Error(path);
    };
    const ui = initPos({ root, api, toast() {}, user: () => ({ id: 'emp', name: 'NV' }), confirmBox: async () => true, go() {} });
    await ui.load();
    const open = async () => {
      await root.querySelectorAll('button').find(b => /Khách lẻ.*Đổi|<b>Cô Hồng<\/b>/.test(b.textContent))!.fire('click');
      await new Promise(r => setTimeout(r, 0));
      return doc.body.children.at(-1)!;
    };
    let dialog = await open();
    const actions = dialog.querySelectorAll('div').find(e => e.className === 'pos-customer-actions')!;
    assert.deepEqual(actions.children.map(e => e.textContent), ['Khách lẻ', 'Khách B2B', '+ Khách mới']);
    const input = dialog.querySelectorAll('input')[0]!, list = dialog.querySelectorAll('div').find(e => e.className === 'pos-customer-suggestions')!;
    assert.equal(input.attributes.role, 'combobox');
    assert.equal(list.hidden, true);
    assert.equal(list.children.length, 0, 'Không hiện danh sách khách khi chưa tìm');
    assert.equal(dialog.querySelectorAll('input').length, 1, 'Không còn checkbox lọc rời');
    input.value = 'hồng';
    await input.fire('input');
    await new Promise(r => setTimeout(r, 230));
    assert.equal(list.hidden, false);
    assert.equal(list.children[0]!.textContent, '<b>Cô Hồng</b>0901234567');
    assert.equal(list.querySelectorAll('b').length, 0, 'Tên khách chỉ render bằng text');
    await actions.children[0]!.fire('click');
    await new Promise(r => setTimeout(r, 0));
    assert.match(calls.at(-1)!, /kind=retail/);
    await actions.children[1]!.fire('click');
    await new Promise(r => setTimeout(r, 0));
    assert.match(calls.at(-1)!, /kind=business/);
    await input.fire('keydown', { key: 'ArrowDown' });
    assert.equal(list.children[0]!.attributes['aria-selected'], 'true');
    await input.fire('keydown', { key: 'Enter' });
    assert.ok(root.textContent.includes('<b>Cô Hồng</b>'));
    assert.equal(dialog.open, false);
    allowRetail = false;
    dialog = await open();
    assert.equal(dialog.querySelectorAll('button').find(b => b.textContent === 'Khách lẻ')!.hidden, true);
    await dialog.querySelectorAll('button').find(b => b.textContent === 'Khách vãng lai · Không lưu hồ sơ')!.fire('click');
    assert.ok(root.textContent.includes('Khách lẻ · Đổi'));
    dialog = await open();
    await dialog.querySelectorAll('button').find(b => b.textContent === '+ Khách mới')!.fire('click');
    assert.ok(doc.body.children.at(-1)!.textContent.includes('Khách mới – dùng ngay'));
    const create = doc.body.children.at(-1)!;
    const controls = create.querySelectorAll('input,textarea') as (Element & { name: string })[];
    assert.deepEqual(controls.map(c => c.name), ['name', 'contact', 'phone', 'email', 'taxCode', 'customerCode', 'address', 'depositRate', 'paymentTerm', 'creditLimit']);
    const actionRow = create.querySelectorAll('div').find(e => e.className === 'pos-customer-form-actions')!;
    assert.deepEqual(actionRow.children.map(b => b.textContent), ['Lưu & chọn khách', 'Huỷ']);
    await actionRow.children[1]!.fire('click');
    assert.equal(create.open, false);

    await new Promise(r => setTimeout(r, 230));
  } finally { Object.assign(globalThis, { document: prevDoc, window: prevWin }); }
});

test('POS: bảng đơn nằm cuối, thêm/xoá nhiều dòng phí và phí ship gửi server, bill K80 có phí', async () => {
  const prevDoc = globalThis.document, prevWin = globalThis.window;
  Object.assign(globalThis, { document: doc, window: { addEventListener() {} } });
  try {
    const root = new Element('section'), calls: any[] = [];
    const fees = { service: { name: '<script>Phí in</script>', amount: 10800, subtotal: 10000, tax: 800, taxRate: 8 }, shippingFee: 20000, subtotal: 30000, tax: 800, total: 30800 };
    const api = async (path: string, method = 'GET', body?: any) => {
      calls.push({ path, method, body });
      if (path.startsWith('/pos/options')) return { registers: [{ id: 'r', name: 'Lock', pricePolicyId: 'vat' }], current: { id: 's', registerId: 'r', memberId: 'emp' }, shifts: [], templates: [], policies: [] };
      if (path.startsWith('/pos/catalog')) return { products: [{ sku: '001', name: 'Ly', price: 108000, available: 10 }], nextOffset: null };
      if (path === '/pos/preview') return { ...sample, fees, subtotal: 210000, tax: 15200, total: 225200 };
      throw Error(path);
    };
    const ui = initPos({ root, api, toast() {}, user: () => ({ id: 'emp', name: 'NV' }), confirmBox: async () => true, go() {} });
    await ui.load();
    assert.equal(root.children[0]!.children.at(-1)!.className, 'pos-card pos-order-board');
    await root.querySelectorAll('button').find(b => b.className === 'pos-product')!.fire('click');
    await root.querySelectorAll('button').find(b => b.textContent === '+ Thêm khoản phí')!.fire('click');
    const fee = root.querySelectorAll('div').find(e => e.className === 'pos-service-fee')!;
    assert.equal(fee.hidden, false);
    const [name, quantity, amount, feeTotal] = fee.querySelectorAll('input');
    name!.value = 'Phí in'; await name!.fire('input');
    quantity!.value = '2'; await quantity!.fire('input');
    amount!.value = '10800'; await amount!.fire('input');
    assert.equal(feeTotal!.value, '21.600 đ');
    const shipping = root.querySelectorAll('label').find(e => e.textContent === 'Phí ship · Không VAT')!.querySelectorAll('input')[0]!;
    shipping.value = '20000'; await shipping.fire('input');
    await new Promise(r => setTimeout(r, 230));
    const request = calls.filter(c => c.path === '/pos/preview').at(-1)!;
    assert.deepEqual(request.body.serviceFees, [{ name: 'Phí in', quantity: '2', unitPrice: '10800' }]); assert.equal(request.body.shippingFee, '20000');
    await root.querySelectorAll('button').find(b => b.textContent === '+ Thêm khoản phí')!.fire('click');
    const second = root.querySelectorAll('div').filter(e => e.className === 'pos-service-fee')[1]!;
    const [n2,q2,p2,t2] = second.querySelectorAll('input');
    n2!.value = 'Phí gói quà'; await n2!.fire('input'); q2!.value = '3'; await q2!.fire('input'); p2!.value = '65000'; await p2!.fire('input');
    assert.equal(t2!.value, '195.000 đ');
    await new Promise(r => setTimeout(r, 230));
    assert.deepEqual(calls.filter(c => c.path === '/pos/preview').at(-1)!.body.serviceFees, [{ name: 'Phí in', quantity: '2', unitPrice: '10800' }, { name: 'Phí gói quà', quantity: '3', unitPrice: '65000' }]);
    await second.querySelectorAll('button').find(b => b.textContent === 'Bỏ phí')!.fire('click');
    assert.equal(root.querySelectorAll('div').filter(e => e.className === 'pos-service-fee')[0]!.querySelectorAll('input')[0]!.value, 'Phí in');
    const totals = root.querySelectorAll('div').find(e => e.className === 'pos-totals')!;
    assert.equal(totals.children.at(-2)!.tag, 'label', 'Ô phí ship ngay trên tổng cộng');
    const printed = buildPosPrint(doc, { ...sample, fees });
    assert.match(printed.textContent, /Phí ship \(không VAT\)20.000/);
    assert.ok(printed.textContent.includes('<script>Phí in</script>'));
    assert.equal(printed.querySelectorAll('script').length, 0);
    const multiBill = buildPosPrint(doc, { ...sample, fees: { services: [{ name: 'Phí in', quantity: 2, unitPrice: 10800, amount: 21600, subtotal: 20000 }, { name: '<script>Gói quà</script>', quantity: 3, unitPrice: 65000, amount: 195000, subtotal: 180556 }], shippingFee: 20000 } });
    assert.ok(multiBill.textContent.includes('Phí in (trước thuế)20.000 đ'));
    assert.ok(multiBill.textContent.includes('<script>Gói quà</script> (trước thuế)180.556 đ'));
    assert.ok(multiBill.textContent.includes('3 × 65.000 đ195.000 đ'));
    assert.equal(multiBill.querySelectorAll('script').length, 0);
    await root.querySelectorAll('button').find(b => b.textContent === 'Bỏ phí')!.fire('click');
    assert.equal(root.querySelectorAll('div').filter(e => e.className === 'pos-service-fee').length, 0);
    await new Promise(r => setTimeout(r, 230));
    const cleared = calls.filter(c => c.path === '/pos/preview').at(-1)!.body;
    assert.deepEqual(cleared.serviceFees, []); assert.equal(cleared.shippingFee, '20000');
  } finally { Object.assign(globalThis, { document: prevDoc, window: prevWin }); }
});

test('SePay chỉ tự tích sau server xác nhận đúng QR, tiếp tục khi đóng popup và bỏ xác nhận khi đổi giỏ', async () => {
  const prevDoc = globalThis.document, prevWin = globalThis.window, prevInterval = globalThis.setInterval, prevClear = globalThis.clearInterval;
  let poll: (() => Promise<void>) | undefined, paid = false;
  Object.assign(globalThis, { document: doc, window: { addEventListener() {} }, setInterval: (fn: () => Promise<void>) => { poll = fn; return 1; }, clearInterval() {} });
  try {
    const root = new Element('section'), calls: any[] = [], notices: string[] = [];
    const api = async (path: string, method = 'GET', body?: any) => {
      calls.push({ path, method, body });
      if (path.startsWith('/pos/options')) return { registers: [{ id: 'r', name: 'Lock', pricePolicyId: 'vat' }], current: { id: 's', registerId: 'r', memberId: 'emp' }, shifts: [], templates: [], policies: [] };
      if (path.startsWith('/pos/catalog')) return { products: [{ sku: '001', name: 'Ly', price: 108000, available: 10 }], nextOffset: null };
      if (path === '/pos/preview') return { ...sample, lines: [{ ...sample.lines[0], sku: '001' }] };
      if (path === '/pos/qr') return { id: 'qr-1', amount: sample.total, content: 'POS qr1', url: 'https://example.test/qr', expiresAt: new Date(Date.now() + 600000).toISOString() };
      if (path === '/pos/qr/qr-1/status') return { paid, consumed: false };
      if (path === '/pos/checkout') throw Object.assign(Error('Kiểm tra payload, không ghi đơn'), { status: 400 });
      throw Error(path);
    };
    const ui = initPos({ root, api, toast: (s: string) => notices.push(s), user: () => ({ id: 'emp', name: 'NV' }), confirmBox: async () => true, go() {} });
    await ui.load();
    const customerButton = root.querySelectorAll('button').find(b => /Khách lẻ.*Đổi/.test(b.textContent))!;
    assert.ok(customerButton.className.includes('pos-customer-trigger'));
    assert.ok(customerButton.className.includes('primary'));
    const product = root.querySelectorAll('button').find(b => b.className === 'pos-product')!;
    await product.fire('click');
    await new Promise(r => setTimeout(r, 230));
    await root.querySelectorAll('button').find(b => b.textContent === 'THANH TOÁN')!.fire('click');
    const payment = doc.body.children.at(-1)!;
    await payment.querySelectorAll('button').find(b => b.textContent.includes('Chuyển khoản'))!.fire('click');
    const check = payment.querySelectorAll('input').find(i => i.type === 'checkbox')!;
    const pay = payment.querySelectorAll('button').find(b => b.textContent === 'Thu tiền & in bill')!;
    assert.equal(check.checked, false);
    assert.equal(pay.disabled, true);
    await payment.querySelectorAll('button').find(b => b.textContent === 'Tạo mã QR')!.fire('click');
    assert.ok(poll);
    await poll!();
    assert.equal(check.checked, false, 'Kết nối SePay nhưng chưa có tiền vẫn không tích');
    const qrDialog = doc.body.children.at(-1)!;
    await qrDialog.querySelectorAll('button').find(b => b.textContent === 'Đóng')!.fire('click');
    paid = true;
    await poll!();
    assert.equal(check.checked, true);
    assert.equal(check.disabled, true);
    assert.equal(pay.disabled, false);
    assert.match(payment.textContent, /SePay đã xác nhận cửa hàng nhận đủ/);
    assert.ok(!calls.some(c => c.path === '/pos/checkout'), 'Chờ nhân viên bấm thu tiền');
    await pay.fire('click');
    const sent = calls.find(c => c.path === '/pos/checkout');
    assert.equal(sent.body.paymentRequestId, 'qr-1');
    assert.equal(sent.body.method, 'transfer');
    await product.fire('click');
    assert.equal(check.checked, false, 'Giỏ thay đổi phải bỏ xác nhận cũ');
    assert.equal(check.disabled, false);
    await poll!();
    assert.equal(check.checked, false, 'QR cũ không xác nhận cho giỏ mới');
    await new Promise(r => setTimeout(r, 230));
  } finally { Object.assign(globalThis, { document: prevDoc, window: prevWin, setInterval: prevInterval, clearInterval: prevClear }); }
});

test('Ô ghi chú dưới phần phí, không huỷ xác nhận chuyển khoản, gửi cùng đơn và in dạng chữ', async () => {
  const prevDoc = globalThis.document, prevWin = globalThis.window;
  Object.assign(globalThis, { document: doc, window: { addEventListener() {} } });
  try {
    const root = new Element('section'), calls: any[] = [];
    const api = async (path: string, method = 'GET', body?: any) => {
      calls.push({ path, body });
      if (path.startsWith('/pos/options')) return { registers: [{ id: 'r', name: 'Lock', pricePolicyId: 'vat' }], current: { id: 's', registerId: 'r', memberId: 'emp' }, shifts: [], templates: [], policies: [] };
      if (path.startsWith('/pos/catalog')) return { products: [{ sku: '001', name: 'Ly', price: 108000, available: 10 }], nextOffset: null };
      if (path === '/pos/preview') return { ...sample, lines: [{ ...sample.lines[0], sku: '001' }] };
      if (path === '/pos/checkout') throw Object.assign(Error('Kiểm tra payload'), { status: 400 });
      throw Error(path);
    };
    const ui = initPos({ root, api, toast() {}, user: () => ({ id: 'emp', name: 'NV' }), confirmBox: async () => true, go() {} });
    await ui.load();
    await root.querySelectorAll('button').find(b => b.className === 'pos-product')!.fire('click');
    await new Promise(r => setTimeout(r, 230));
    await root.querySelectorAll('button').find(b => b.textContent === 'THANH TOÁN')!.fire('click');
    const payment = doc.body.children.at(-1)!;
    await payment.querySelectorAll('button').find(b => b.textContent.includes('Chuyển khoản'))!.fire('click');
    const check = payment.querySelectorAll('input').find(i => i.type === 'checkbox')!;
    check.checked = true; await check.fire('change');
    const area = root.querySelectorAll('section').find(e => e.className === 'pos-extra-fees')!;
    assert.equal(area.children.at(-2)!.textContent, 'Phí dịch vụ theo bảng giá; không áp dụng chiết khấu sản phẩm.');
    const note = area.querySelectorAll('textarea')[0]!;
    const text = '<img src=x onerror=alert(1)>\nGiao chiều';
    note.value = text; await note.fire('input');
    assert.equal(check.checked, true);
    await payment.querySelectorAll('button').find(b => b.textContent === 'Thu tiền & in bill')!.fire('click');
    assert.equal(calls.find(c => c.path === '/pos/checkout').body.note, text);
    const print = buildPosPrint(doc, { ...sample, note: text });
    assert.ok(print.textContent.includes('Ghi chú: ' + text));
    assert.equal(print.querySelectorAll('img').length, 0);
  } finally { Object.assign(globalThis, { document: prevDoc, window: prevWin }); }
});

test('form COD hiển thị thu trước và còn lại, chuyển khoản cần xác nhận; bill tách khoản đã thu', async () => {
  const prevDoc = (globalThis as any).document, prevWin = (globalThis as any).window;
  Object.assign(globalThis, { document: doc, window: { addEventListener() {} } });
  try {
    const root = new Element('main'), calls: any[] = [];
    const api = async (path: string, method = 'GET', body?: any) => {
      calls.push({ path, method, body });
      if (path.startsWith('/pos/options')) return { registers: [{ id: 'r', name: 'Lock', pricePolicyId: 'vat' }], current: { id: 's', registerId: 'r', memberId: 'emp' }, shifts: [], templates: [], policies: [] };
      if (path.startsWith('/pos/catalog')) return { products: [{ sku: '001', name: 'Ly', price: 108000, available: 10 }], nextOffset: null };
      if (path === '/pos/preview') return { ...sample, total: 108000, lines: [{ ...sample.lines[0], sku: '001' }] };
      if (path === '/pos/ghn/locations') {
        if (body?.districtId) return { locations: [{ id: 'w1', name: 'Phường GHN' }] };
        if (body?.provinceId) return { locations: [{ id: 'd1', name: 'Quận GHN' }] };
        return { locations: [{ id: 'p1', name: 'Tỉnh GHN' }] };
      }
      if (path === '/pos/checkout') throw Object.assign(Error('Kiểm tra payload'), { status: 400 });
      throw Error(path);
    };
    const ui = initPos({ root, api, toast() {}, user: () => ({ id: 'emp', name: 'NV' }), confirmBox: async () => true, go() {} });
    await ui.load(); await root.querySelectorAll('button').find(b => b.className === 'pos-product')!.fire('click');
    await new Promise(r => setTimeout(r, 230));
    await root.querySelectorAll('button').find(b => b.textContent === 'THANH TOÁN')!.fire('click');
    const payment = doc.body.children.at(-1)!;
    assert.ok(payment.querySelectorAll('button').find(b => b.className.includes('pos-modal-close')));
    await payment.querySelectorAll('button').find(b => b.textContent.includes('Ship COD'))!.fire('click');
    const continueCod = payment.querySelectorAll('button').find(b => b.textContent === 'TIẾP TỤC TẠO ĐƠN COD')!;
    assert.ok(continueCod);
    await continueCod.fire('click');
    assert.equal(payment.open, false, 'Đóng bảng Thanh toán trước khi mở form COD');
    const modal = doc.body.children.at(-1)!;
    assert.match(modal.textContent, /Giao Hàng Nhanh · nhập địa chỉ/);
    assert.match(modal.textContent, /Thông tin đơn hàng và người nhận đã được lấy sẵn/);
    const deposit = modal.querySelectorAll('label').find(l => l.textContent === 'Đã thu trước / tạm ứng (VNĐ)')!.querySelectorAll('input')[0]!;
    await new Promise(r => setTimeout(r, 0));
    const selects = modal.querySelectorAll('select'), province = selects[0]!, district = selects[1]!, ward = selects[2]!, method = selects[3]!;
    province.value = 'p1'; await province.fire('change'); await new Promise(r => setTimeout(r, 0));
    district.value = 'd1'; await district.fire('change'); await new Promise(r => setTimeout(r, 0)); ward.value = 'w1';
    const confirmed = modal.querySelectorAll('input').find(i => i.type === 'checkbox')!;
    const form = modal.querySelectorAll('form')[0]!, save = modal.querySelectorAll('button').find(b => b.textContent === 'Tiếp tục trên GHN')!;
    deposit.value = '50000'; await deposit.fire('input'); method.value = 'transfer'; await method.fire('change');
    assert.match(modal.textContent, /Còn lại thu COD: 58.000 đ/); assert.equal(save.disabled, true);
    await form.fire('submit'); assert.equal(calls.some(c => c.path === '/pos/checkout'), false);
    confirmed.checked = true; await confirmed.fire('change'); assert.equal(save.disabled, false);
    deposit.value = '108001'; await deposit.fire('input'); assert.equal(save.disabled, true);
    deposit.value = '50000'; await deposit.fire('input'); confirmed.checked = true; await confirmed.fire('change');
    await form.fire('submit'); assert.equal(save.textContent, 'Xác nhận & tạo đơn COD');
    await form.fire('submit'); await new Promise(r => setTimeout(r, 0));
    const sent = calls.find(c => c.path === '/pos/checkout')!;
    assert.equal(sent.body.depositAmount, 50000); assert.equal(sent.body.method, 'transfer'); assert.equal(sent.body.confirmed, true);
    for (const [amount, remaining] of [[50000, 58000], [108000, 0]]) {
      const bill = buildPosPrint(doc, { ...sample, method: 'cod', total: 108000, depositAmount: amount, codAmount: remaining, depositMethod: 'transfer' });
      assert.match(bill.textContent, /Đã thu trước \/ tạm ứng \(chuyển khoản\)/);
      assert.ok(bill.textContent.includes('Còn lại thu COD' + Number(remaining).toLocaleString('vi-VN') + ' đ'));
      if (!remaining) assert.match(bill.textContent, /ĐƠN GIAO HÀNG - ĐÃ THU ĐỦ/);
    }
  } finally { Object.assign(globalThis, { document: prevDoc, window: prevWin }); }
});

test('POS mới: THANH TOÁN theo ca/giỏ, menu thường ẩn cấu hình và tiền mặt tính đúng tiền thối', async () => {
  const prevDoc = globalThis.document, prevWin = globalThis.window;
  Object.assign(globalThis, { document: doc, window: { addEventListener() {} } });
  try {
    const root = new Element('section'); let opened = false;
    const api = async (path: string) => {
      if (path.startsWith('/pos/options')) return { registers: [{ id: 'r', name: 'Quầy Lock', pricePolicyId: 'vat', secondPricePolicyId: 'retail' }], current: opened ? { id: 's', registerId: 'r', memberId: 'emp' } : null, shifts: [], templates: [], policies: [], canConfigure: false };
      if (path.startsWith('/pos/catalog')) return { products: [{ sku: '001', name: 'Ly', price: 194400, available: 3 }], nextOffset: null };
      if (path === '/pos/preview') return { ...sample, lines: [{ ...sample.lines[0], sku: '001' }] };
      if (path.startsWith('/pos/orders')) return { registers: [], counts: {}, orders: [], registerId: 'r' };
      throw Error(path);
    };
    const ui = initPos({ root, api, toast() {}, user: () => ({ id: 'emp', name: 'NV', role: 'employee' }), confirmBox: async () => true, go() {} });
    await ui.load();
    let checkout = root.querySelectorAll('button').find(b => b.textContent === 'THANH TOÁN')!;
    assert.equal(checkout.disabled, true, 'chưa mở ca thì khóa thanh toán');
    assert.ok(!root.textContent.includes('Cấu hình'));
    assert.ok(!root.textContent.includes('+ Quầy'));
    opened = true; await ui.load();
    checkout = root.querySelectorAll('button').find(b => b.textContent === 'THANH TOÁN')!;
    assert.equal(checkout.disabled, true, 'giỏ trống thì khóa thanh toán');
    const mobileDock = root.querySelectorAll('div').find(e => e.className === 'pos-mobile-cart-dock')!;
    assert.match(mobileDock.textContent, /Đơn hiện tại · 0 món/);
    await root.querySelectorAll('button').find(b => b.className === 'pos-product')!.fire('click');
    await new Promise(r => setTimeout(r, 230));
    assert.equal(checkout.disabled, false);
    assert.match(mobileDock.textContent, /Đơn hiện tại · 1 món/);
    assert.match(mobileDock.textContent, /194\.400 đ/);
    assert.equal(mobileDock.querySelectorAll('button').find(b => b.textContent === 'Xem đơn ›')!.disabled, false);
    await checkout.fire('click');
    const payment = doc.body.children.at(-1)!;
    const tender = payment.querySelectorAll('input').find(i => i.type === 'number')!;
    tender.value = '200000'; await tender.fire('input');
    assert.match(payment.textContent, /5\.600 đ/);
    assert.equal(payment.querySelectorAll('button').find(b => b.textContent === 'Thu tiền & in bill')!.disabled, false);
  } finally { Object.assign(globalThis, { document: prevDoc, window: prevWin }); }
});

test('Ca chung: mở POS hoặc bấm Mở ca sau khi đồng nghiệp mở thì dùng ca cửa hàng, không cho kết ca hộ', async () => {
  const prevDoc = globalThis.document, prevWin = globalThis.window;
  Object.assign(globalThis, { document: doc, window: { addEventListener() {} } });
  try {
    const root = new Element('section'), calls: any[] = []; let shared = false;
    const api = async (path: string, method = 'GET', body?: any) => {
      calls.push({path,method,body});
      if(path.startsWith('/pos/options')) return { registers:[{id:'r',name:'Quầy Lock',pricePolicyId:'vat'}],current:shared?{id:'shared-shift',memberId:'opener',memberName:'NV mở ca',registerId:'r'}:null,canCloseCurrent:false,shifts:[],templates:[],policies:[] };
      if(path.startsWith('/pos/catalog'))return {products:[{sku:'001',name:'Ly',price:194400,available:3}],nextOffset:null};
      if(path==='/pos/preview')return {...sample,lines:[{...sample.lines[0],sku:'001'}]};
      throw Error(path);
    };
    const ui=initPos({root,api,toast(){},user:()=>({id:'peer',name:'NV cùng cửa hàng'}),confirmBox:async()=>true,go(){}});
    await ui.load(); assert.ok(root.textContent.includes('Mở ca'));
    shared=true; await root.querySelectorAll('button').find(b=>b.textContent==='Mở ca')!.fire('click');
    assert.ok(root.textContent.includes('Ca dùng chung')); assert.ok(root.querySelectorAll('span').some(s=>s.attributes.title==='Người mở ca: NV mở ca'));
    assert.equal(root.querySelectorAll('button').some(b=>b.textContent==='Kết ca'||b.textContent==='Mở ca'),false);
    await root.querySelectorAll('button').find(b=>b.className==='pos-product')!.fire('click');
    await new Promise(r=>setTimeout(r,230));
    assert.equal(calls.find(c=>c.path==='/pos/preview')!.body.shiftId,'shared-shift');
    assert.equal(root.querySelectorAll('button').find(b=>b.textContent==='THANH TOÁN')!.disabled,false);
    assert.equal(calls.some(c=>c.path==='/pos/shifts/open'),false,'không tạo ca/thực đếm giả khi chỉ tham gia ca có sẵn');
  } finally { Object.assign(globalThis,{document:prevDoc,window:prevWin}); }
});

test('Manager đổi quầy đang mở; giỏ có hàng không được đổi ca', async () => {
  const prevDoc=globalThis.document,prevWin=globalThis.window;
  Object.assign(globalThis,{document:doc,window:{addEventListener(){}}});
  try {
    const root=new Element('section'),calls:any[]=[],notices:string[]=[];
    const registers=[{id:'lock',name:'Lock',pricePolicyId:'vat'},{id:'ml',name:'Minh Long',pricePolicyId:'vat'}];
    const api=async(path:string,method='GET',body?:any)=>{
      calls.push({path,method,body});
      if(path.startsWith('/pos/options')) {const registerId=new URL('http://test'+path).searchParams.get('registerId')||'lock'; return {registers,current:{id:'shift-'+registerId,memberId:'opener',registerId},canChooseOpenRegister:true,canCloseCurrent:false,templates:[],shifts:[],policies:[]};}
      if(path.startsWith('/pos/catalog'))return {products:[{sku:'001',name:'Ly',price:194400,available:3}],nextOffset:null};
      if(path==='/pos/preview')return {...sample,lines:[{...sample.lines[0],sku:'001'}]};
      throw Error(path);
    };
    const ui=initPos({root,api,toast:(s:string)=>notices.push(s),user:()=>({id:'mgr',role:'manager'}),confirmBox:async()=>true,go(){}});
    await ui.load();
    let choose=root.querySelectorAll('select').find(e=>e.attributes['aria-label']==='Chọn quầy')!;
    assert.ok(choose); choose.value='ml'; await choose.fire('change'); await new Promise(r=>setTimeout(r,30));
    assert.ok(calls.some(c=>c.path==='/pos/options?registerId=ml'));
    await root.querySelectorAll('button').find(b=>b.className==='pos-product')!.fire('click'); await new Promise(r=>setTimeout(r,230));
    assert.equal(calls.find(c=>c.path==='/pos/preview')!.body.shiftId,'shift-ml');
    choose=root.querySelectorAll('select').find(e=>e.attributes['aria-label']==='Chọn quầy')!;
    choose.value='lock'; await choose.fire('change');
    assert.equal(choose.value,'ml'); assert.ok(notices.some(s=>s.includes('Hoàn tất hoặc huỷ')));
  } finally {Object.assign(globalThis,{document:prevDoc,window:prevWin});}
});

test('lưu POS: lỗi giữ bảng thanh toán và giỏ; thành công đóng bảng cũ, popup mã/tổng và nút bán tiếp không tạo lại đơn', async () => {
  const prevDoc = globalThis.document, prevWin = globalThis.window;
  Object.assign(globalThis, { document: doc, window: { addEventListener() {} } });
  try {
    const root=new Element('section');let fail=true,checkouts=0;
    const api=async(path:string)=>{
      if(path.startsWith('/pos/options'))return {registers:[{id:'r',name:'Lock',pricePolicyId:'vat'}],current:{id:'s',registerId:'r',memberId:'emp'},shifts:[],templates:[],policies:[]};
      if(path.startsWith('/pos/catalog'))return {products:[{sku:'001',name:'Ly',price:194400,available:10}],nextOffset:null};
      if(path==='/pos/preview')return {...sample,lines:[{...sample.lines[0],sku:'001'}]};
      if(path==='/pos/checkout'){checkouts++;if(fail)throw Object.assign(Error('Thử lại'),{status:400});return {...sample,orderNo:'POS_<img onerror=x>',id:'new'};}
      throw Error(path);
    };
    const ui=initPos({root,api,toast(){},user:()=>({id:'emp',name:'NV'}),confirmBox:async()=>true,go(){}});
    await ui.load();await root.querySelectorAll('button').find(b=>b.className==='pos-product')!.fire('click');
    await new Promise(r=>setTimeout(r,230));await root.querySelectorAll('button').find(b=>b.textContent==='THANH TOÁN')!.fire('click');
    const payment=doc.body.children.at(-1)!;const tender=payment.querySelectorAll('input').find(i=>i.type==='number')!;
    tender.value='200000';await tender.fire('input');
    const pay=payment.querySelectorAll('button').find(b=>b.textContent==='Thu tiền & in bill')!;
    await pay.fire('click');assert.equal(payment.open,true);assert.ok(root.textContent.includes('Ly'));
    fail=false;await pay.fire('click');assert.equal(payment.open,false);
    const saved=doc.body.children.filter(e=>e.open&&e.className.includes('pos-saved-modal')).at(-1)!;
    assert.ok(saved);assert.match(saved.textContent,/POS_<img onerror=x>/);assert.equal(saved.querySelectorAll('img').length,0);
    assert.ok(saved.textContent.includes('194.400 đ'));
    const actions=saved.querySelectorAll('div').find(e=>e.className==='pos-saved-actions')!;
    assert.deepEqual(actions.children.map(b=>b.textContent),['In lại bill','Bán đơn tiếp']);
    await actions.children[1]!.fire('click');assert.equal(saved.open,false);assert.equal(checkouts,2);
  } finally {Object.assign(globalThis,{document:prevDoc,window:prevWin});}
});

test('POS order board sends source/staff/date/payment filters, renders server totals and resets filters', async () => {
  const prevDoc=globalThis.document, prevWin=globalThis.window;
  Object.assign(globalThis,{document:doc,window:{addEventListener(){}}});
  try {
    const root=new Element('section'), calls:string[]=[];
    const api=async(path:string)=>{
      if(path.startsWith('/pos/options')) return {registers:[{id:'r',name:'Quầy',pricePolicyId:'vat'}],current:null,shifts:[],templates:[],policies:[]};
      if(path.startsWith('/pos/catalog')) return {products:[],nextOffset:null};
      if(path.startsWith('/pos/orders')) {calls.push(path);return {registerId:'r',registers:[],counts:{all:3},orders:[],owners:[{id:'emp',name:'Nhân viên A'}],totals:[{currency:'VND',revenue:123456,paid:100000,outstanding:23456,orders:3,unknownPayment:0}]};}
      throw Error(path);
    };
    const ui=initPos({root,api,toast(){},user:()=>({id:'emp',name:'NV'}),confirmBox:async()=>true,go(){}});
    await ui.load();
    assert.match(root.textContent,/Doanh thu đơn theo bộ lọc/);
    assert.match(root.textContent,/123.456/);
    const filters:[string,string][]=[['Nguồn đơn','cod'],['Nhân viên bán','emp'],['Từ ngày','2026-10-01'],['Đến ngày','2026-10-21'],['Thanh toán','debt']];
    for(const [label,value] of filters){
      const input=root.querySelectorAll('input,select').find(e=>e.attributes['aria-label']===label)!;
      assert.ok(input,label); input.value=value; await input.fire('change'); await new Promise(r=>setTimeout(r,0));
    }
    const q=new URLSearchParams(calls.at(-1)!.split('?')[1]);
    assert.equal(q.get('source'),'cod');assert.equal(q.get('ownerId'),'emp');assert.equal(q.get('from'),'2026-10-01');assert.equal(q.get('to'),'2026-10-21');assert.equal(q.get('payment'),'debt');
    await root.querySelectorAll('button').find(e=>e.textContent==='Xóa bộ lọc')!.fire('click');
    await new Promise(r=>setTimeout(r,0));
    const reset=new URLSearchParams(calls.at(-1)!.split('?')[1]);
    assert.equal(reset.get('source'),'all');assert.equal(reset.get('ownerId'),null);assert.equal(reset.get('from'),null);assert.equal(reset.get('payment'),'all');
  } finally {Object.assign(globalThis,{document:prevDoc,window:prevWin});}
});

test('POS stock: selected product says bỏ chọn; stock actions never add to cart; request selects warehouse and sends once',async()=>{
 const prevDoc=globalThis.document,prevWin=globalThis.window;
 Object.assign(globalThis,{document:doc,window:{addEventListener(){}}});
 try {
  const root=new Element('section'),writes:any[]=[],purchases:any[]=[],links:string[]=[];
  const source={vigifts:{qty:40,warehouses:[{id:'vig',name:'KHO VIGIFTS',qty:40}]},supplier:{qty:70,warehouses:[{id:'ncc',name:'NCC',qty:70}]},incoming:{qty:5,orders:[{orderId:'po',orderNo:'DMH_A',supplierName:'NCC A',qty:5,arrivalDate:'2026-10-25'}]},requestWarehouses:[{id:'vig',name:'KHO VIGIFTS',qty:40},{id:'other',name:'Kho khác',qty:10}],destination:{id:'wh',name:'Kho cửa hàng'}};
  const product={sku:'LY1',name:'Ly sứ',unit:'cái',price:100000,available:10,onHand:12,reserved:2,stockSources:source};
  const api=async(path:string,method?:string,body?:any)=>{
   if(path.startsWith('/pos/options'))return {registers:[{id:'r',name:'Quầy',pricePolicyId:'vat'}],current:{id:'s',memberId:'emp',registerId:'r'},shifts:[],templates:[],policies:[]};
   if(path.startsWith('/pos/catalog'))return {products:[product],nextOffset:null};
   if(path.startsWith('/pos/orders'))return {orders:[],counts:{}};
   if(path==='/pos/preview')return {lines:[],total:100000,subtotal:100000,tax:0};
   if(path==='/purchase-options')return {suppliers:[{id:'supplier',name:'NCC A'}]};
   if(path==='/purchase-orders'){purchases.push(body);return {ids:['new-po']};}
   if(path==='/stock-transfers'){writes.push(body);await new Promise(r=>setTimeout(r,10));return {transferNo:'PCK_TEST'};}
   throw Error(path);
  };
  const ui=initPos({root,api,toast(){},user:()=>({id:'emp'}),confirmBox:async()=>true,go:(url:string)=>links.push(url)});await ui.load();
  const card=root.querySelectorAll('button').find(x=>x.className==='pos-product')!;
  await card.fire('click');assert.match(card.textContent,/Bỏ chọn/);assert.equal(card.attributes['aria-pressed'],'true');
  await card.fire('click');assert.equal(card.attributes['aria-pressed'],'false');assert.ok(!card.textContent.includes('Bỏ chọn'));
  const stock=root.querySelectorAll('button').find(x=>x.textContent==='VIGIFTS: 40')!;
  assert.ok((stock as any).title.includes('KHO VIGIFTS'));
  await stock.fire('click');assert.equal(card.attributes['aria-pressed'],'false');
  let dialog=doc.body.children.at(-1)!;assert.match(dialog.textContent,/DMH_A/);
  await dialog.querySelectorAll('button').find(x=>x.textContent==='Xin hàng')!.fire('click');
  dialog=doc.body.children.at(-1)!;
  const from=dialog.querySelectorAll('select').find(x=>x.attributes['aria-label']==='Kho xin hàng')!;assert.ok(from.options.some(x=>x.value==='other'));from.value='other';await from.fire('change');
  const form=dialog.querySelectorAll('form')[0]!;
  await Promise.all([form.fire('submit'),form.fire('submit')]);
  assert.equal(writes.length,1);assert.equal(writes[0].fromWarehouseId,'other');assert.equal(writes[0].toWarehouseId,'wh');assert.deepEqual(writes[0].lines,[{sku:'LY1',qty:1}]);
  await root.querySelectorAll('button').find(x=>x.textContent==='NCC: 70')!.fire('click');
  dialog=doc.body.children.at(-1)!;await dialog.querySelectorAll('button').find(x=>x.textContent==='Xin hàng')!.fire('click');
  await new Promise(r=>setTimeout(r,0));dialog=doc.body.children.at(-1)!;
  const nccForm=dialog.querySelectorAll('form')[0]!;
  await nccForm.fire('submit');assert.equal(purchases.length,0,'missing supplier/address cannot save');
  dialog.querySelectorAll('select').find(x=>x.attributes['aria-label']==='Nhà cung cấp')!.value='supplier';
  dialog.querySelectorAll('label').find(x=>x.textContent==='Địa chỉ nhận hàng')!.querySelectorAll('input')[0]!.value='Kho cửa hàng';
  await nccForm.fire('submit');assert.equal(purchases.length,1);assert.equal(purchases[0].orders[0].supplierId,'supplier');assert.equal(purchases[0].orders[0].lines[0].sku,'LY1');
  assert.deepEqual(links,['#/purchases/new-po']);
  await new Promise(r=>setTimeout(r,240));
 } finally {Object.assign(globalThis,{document:prevDoc,window:prevWin});}
});
