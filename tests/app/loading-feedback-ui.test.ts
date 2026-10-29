import { test } from 'node:test';
import assert from 'node:assert/strict';
// Module trình duyệt (JS thuần) – nạp qua URL để TypeScript không đòi khai báo kiểu.
const { installLoadingFeedback, trackRequest }: any = await import(new URL('../../trial-ui/loading-feedback.js', import.meta.url).href);

/**
 * DOM giả tối thiểu: mỗi phần tử có "kinds" (bộ chọn đơn giản nó khớp: 'a[href]', '.chip', '.panel'…),
 * closest() đi lên cha theo kinds. Đủ cho cách loading-feedback.js nhận ra link / dòng / bộ lọc / vùng kết quả.
 */
function el(kinds: string[], parent: any = null, opts: { href?: string; cursor?: string; tag?: string } = {}) {
  const classes = new Set<string>(), attrs: Record<string, string> = {};
  const node: any = {
    kinds, parentElement: parent, dataset: {}, target: '', tagName: (opts.tag || 'div').toUpperCase(), cursor: opts.cursor || 'auto',
    classList: { contains: (c: string) => classes.has(c), add: (c: string) => classes.add(c), remove: (c: string) => classes.delete(c) }, classes,
    getAttribute: (k: string) => k === 'href' ? opts.href ?? null : attrs[k] ?? null, setAttribute: (k: string, v: string) => { attrs[k] = v; },
    removeAttribute: (k: string) => { delete attrs[k]; }, hasAttribute: (k: string) => k in attrs,
    matches: (sel: string) => sel.split(',').some(s => kinds.includes(s.trim())),
    closest(sel: string): any { return node.matches(sel) ? node : parent?.closest(sel) ?? null; },
  };
  return node;
}
const body = el(['body']);
const bar: any = { hidden: true, children: [] as any[], setAttribute() {}, append(c: any) { bar.children.push(c); } };
const handlers: Record<string, Function> = {}, winHandlers: Record<string, Function> = {};
let created = 0;
const doc: any = {
  body: Object.assign(body, { append() {} }),
  createElement: () => (created++ === 0 ? bar : { textContent: '', setAttribute() {}, className: '' }),
  addEventListener: (k: string, fn: Function) => { handlers[k] = fn; },
};
const win: any = { addEventListener: (k: string, fn: Function) => { winHandlers[k] = fn; }, getComputedStyle: (n: any) => ({ cursor: n.cursor }) };
installLoadingFeedback(doc, win);
const label = () => bar.children[0].textContent;
const fire = (type: string, target: any) => { const e = { target, prevented: false, stopped: false, preventDefault() { this.prevented = true; }, stopImmediatePropagation() { this.stopped = true; } }; handlers[type]!(e); return e; };
const deferred = () => { let resolve!: (v?: unknown) => void; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

test('bấm link: link mờ + vòng xoay tới khi tải xong; bấm lại lúc đang chờ bị bỏ qua; thanh tiến trình chỉ hiện khi chờ quá 300 ms', async () => {
  const link = el(['a[href]'], body, { href: '#/orders', tag: 'a' }), d = deferred();
  fire('click', link);
  trackRequest('/orders?page=1', d.promise);
  assert.equal(link.classes.has('is-opening'), true);
  const again = fire('click', link);
  assert.equal(again.prevented, true); assert.equal(again.stopped, true, 'bấm lại vào link đang mở bị chặn');
  assert.equal(bar.hidden, true, 'chưa tới 300 ms thì chưa hiện (thao tác nhanh không nháy)');
  await wait(350); assert.equal(bar.hidden, false);
  d.resolve(); await wait(200);
  assert.equal(link.classes.has('is-opening'), false); assert.equal(bar.hidden, true);
});

test('dòng bấm được (con trỏ bàn tay) cũng có hiệu ứng; bấm mà không tải gì (mở tại chỗ) thì tự bỏ hiệu ứng', async () => {
  const row = el(['tr'], body, { cursor: 'pointer', tag: 'tr' });
  fire('click', row); assert.equal(row.classes.has('is-opening'), true);
  await wait(400); assert.equal(row.classes.has('is-opening'), false);
  const plain = el(['tr'], body, { tag: 'tr' }); fire('click', plain);
  assert.equal(plain.classes.has('is-opening'), false, 'dòng không bấm được: không hiệu ứng');
});

test('chip lọc / ô chọn lọc: chip có vòng xoay, vùng kết quả mờ; bộ lọc không bị khoá, đổi tiếp thì lượt mới thay lượt cũ', async () => {
  const panel = el(['.panel'], body), toolbar = el(['.toolbar'], panel), chip = el(['.chip'], toolbar, { tag: 'button' });
  const first = deferred(); fire('click', chip); trackRequest('/tasks?view=open', first.promise);
  assert.equal(chip.classes.has('is-busy'), true); assert.equal(panel.classes.has('is-refreshing'), true);
  assert.equal(chip.disabled, undefined, 'chip không bị khoá');
  const select = el(['select', 'input'], toolbar, { tag: 'select' }), second = deferred();
  fire('change', select); trackRequest('/tasks?view=done', second.promise);
  assert.equal(chip.classes.has('is-busy'), false, 'lượt cũ đóng khi đổi lọc tiếp');
  assert.equal(panel.classes.has('is-refreshing'), true);
  first.resolve(); await wait(200); assert.equal(panel.classes.has('is-refreshing'), true, 'lệnh cũ xong không tắt hiệu ứng của lệnh mới');
  second.resolve(); await wait(200); assert.equal(panel.classes.has('is-refreshing'), false);
});

test('ô chọn ngoài bộ lọc (form nhập liệu) và lời gọi chạy nền không gây hiệu ứng', async () => {
  const form = el(['form'], body), select = el(['select', 'input'], form, { tag: 'select' });
  fire('change', select);
  const background = deferred(); trackRequest('/notifications', background.promise);
  await wait(350); assert.equal(bar.hidden, true, 'tự làm mới / thông báo không hiện thanh');
  background.resolve();
});

test('mạng chậm: quá 1,2 giây hiện "Đang tải…"; đang thử lại lệnh đọc thì hiện "Mạng chậm, đang thử lại…"', async () => {
  const link = el(['a[href]'], body, { href: '#/stock-moves', tag: 'a' }), d = deferred();
  fire('click', link); trackRequest('/stock-moves', d.promise);
  await wait(1300); assert.equal(label(), 'Đang tải…');
  winHandlers['api-retry']!(); assert.equal(label(), 'Mạng chậm, đang thử lại…');
  d.resolve(); await wait(200); assert.equal(label(), ''); assert.equal(bar.hidden, true);
});
