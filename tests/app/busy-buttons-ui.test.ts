import { test } from 'node:test';
import assert from 'node:assert/strict';
// Module trình duyệt (JS thuần) – nạp qua URL để TypeScript không đòi khai báo kiểu.
const { installBusyButtons, withBusy }: any = await import(new URL('../../trial-ui/busy-buttons.js', import.meta.url).href);

/** Nút giả tối thiểu: dataset, classList, disabled, closest/matches theo thẻ và lớp. */
function button(cls = 'btn', opts: { inClosedDialog?: boolean; noBusy?: boolean; tag?: string } = {}) {
  const classes = new Set(cls.split(' ').filter(Boolean)), attrs: Record<string, string> = {};
  const el: any = {
    tagName: (opts.tag || 'button').toUpperCase(), dataset: {}, disabled: false, isConnected: true,
    classList: { contains: (c: string) => classes.has(c), add: (c: string) => classes.add(c), remove: (c: string) => classes.delete(c) },
    setAttribute: (k: string, v: string) => { attrs[k] = v; }, removeAttribute: (k: string) => { delete attrs[k]; }, attrs,
    matches: (sel: string) => sel.split(',').some(s => s.trim() === el.tagName.toLowerCase()),
    closest(sel: string) {
      if (sel === '[data-no-busy]') return opts.noBusy ? el : null;
      if (sel === 'dialog:not([open])') return opts.inClosedDialog ? {} : null;
      return sel.split(',').some(s => s.trim() === el.tagName.toLowerCase() || (s.trim() === 'a.btn' && classes.has('btn'))) ? el : null;
    },
  };
  return el;
}
const handlers: Record<string, Function> = {};
installBusyButtons({ addEventListener: (k: string, fn: Function) => { handlers[k] = fn; } } as any);
const click = (el: any) => { const e = { target: el, prevented: false, stopped: false, preventDefault() { this.prevented = true; }, stopImmediatePropagation() { this.stopped = true; } }; handlers.click!(e); return e; };
const deferred = () => { let resolve!: (v?: unknown) => void, reject!: (e: unknown) => void; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const flush = () => new Promise(r => setImmediate(r));

test('bấm nút gửi ghi: nút khoá + vòng xoay tới khi xong, bấm thêm lúc chờ bị chặn; lỗi cũng mở lại nút', async () => {
  const b = button(), d = deferred();
  click(b);
  const p = withBusy('POST', d.promise, '/stock-transfers/1/approve');
  assert.equal(b.disabled, true); assert.equal(b.classList.contains('is-busy'), true); assert.equal(b.attrs['aria-busy'], 'true');
  const again = click(b);
  assert.equal(again.prevented, true); assert.equal(again.stopped, true, 'bấm lại khi đang gửi bị chặn');
  d.resolve({ ok: true }); assert.deepEqual(await p, { ok: true }); await flush();
  assert.equal(b.disabled, false); assert.equal(b.classList.contains('is-busy'), false); assert.equal(b.attrs['aria-busy'], undefined);

  const e = deferred(); click(b);
  const failed = withBusy('PUT', e.promise, '/tasks/1');
  e.reject(new Error('Lỗi')); await assert.rejects(failed); await flush();
  assert.equal(b.disabled, false, 'lỗi máy chủ vẫn mở lại nút');
});

test('nút trong hộp xác nhận đã đóng → khoá nút gốc; nút vốn đang khoá giữ nguyên sau khi xong', async () => {
  const origin = button(), ok = button('btn', { inClosedDialog: true }), d = deferred();
  click(origin); click(ok);
  withBusy('POST', d.promise, '/orders/1/confirm');
  assert.equal(origin.disabled, true); assert.equal(ok.disabled, false);
  d.resolve(); await flush(); assert.equal(origin.disabled, false);

  const pre = button(); pre.disabled = true; const d2 = deferred(); click(pre);
  withBusy('POST', d2.promise, '/x'); d2.resolve(); await flush();
  assert.equal(pre.disabled, true, 'không mở nút mà màn hình đã tự khoá');
});

test('không khoá: lời gọi tính / đọc tự động (+/− giỏ hàng gọi /pos/preview), chip lọc gọi GET, data-no-busy, gõ phím sau khi bấm', async () => {
  const plus = button('pos-qty'), d = deferred(); click(plus);
  withBusy('POST', d.promise, '/pos/preview'); assert.equal(plus.disabled, false);
  const chip = button('chip'); click(chip);
  withBusy('GET', deferred().promise, '/tasks?view=all'); assert.equal(chip.disabled, false);
  const exp = button('btn'), g = deferred(); click(exp);
  withBusy('GET', g.promise, '/orders/export'); assert.equal(exp.disabled, true, 'nút .btn gọi API đọc ngay khi bấm vẫn hiện đang xử lý');
  g.resolve(); await flush();
  const opt = button('btn', { noBusy: true }); click(opt);
  withBusy('POST', deferred().promise, '/x'); assert.equal(opt.disabled, false);
  const add = button(); click(add); handlers.input!({});
  withBusy('PUT', deferred().promise, '/quotes/1'); assert.equal(add.disabled, false, 'tự lưu sau khi gõ không khoá nút cũ');
});

test('nhận diện nút xuất file; "Xuất kho" / "Dán từ Excel" không phải nút xuất file', async () => {
  const { isExportButton }: any = await import(new URL('../../trial-ui/busy-buttons.js', import.meta.url).href);
  const b = (text: string, sel = '') => ({ textContent: text, closest: () => null, matches: (s: string) => !!sel && s.split(',').includes(sel), classList: { contains: (c: string) => c === 'btn' } });
  for (const x of [b('⬇ Xuất file'), b('Tải Excel'), b('In / Lưu PDF'), b('Tải file mẫu Excel'), b('Gì đó', '#orders-export')]) assert.equal(isExportButton(x), true, x.textContent);
  for (const x of [b('Xuất kho'), b('Dán từ Excel'), b('Lưu'), b('Nhập Excel')]) assert.equal(isExportButton(x), false, x.textContent);
});

test('nút xuất file trang tự đặt disabled khi bấm: xong file nút mở lại, không kẹt khoá', async () => {
  const { releaseExports }: any = await import(new URL('../../trial-ui/busy-buttons.js', import.meta.url).href);
  const b = button(); b.textContent = '⬇ Xuất file'; b.matches = (s: string) => s.split(',').includes('#orders-export');
  const g = deferred();
  click(b); b.disabled = true; // trang tự khoá nút ngay trong lúc xử lý click…
  withBusy('GET', g.promise, '/orders/export'); // …rồi gọi API đọc dữ liệu xuất file
  await new Promise(r => setTimeout(r, 5));
  assert.equal(b.dataset.busy, '1', 'nút xuất file hiện đang xử lý');
  g.resolve([]); await flush();
  b.disabled = false; // trang mở lại nút sau khi tải dữ liệu xong
  assert.equal(b.dataset.busy, '1', 'đang tạo file: nút vẫn khoá');
  releaseExports(); // file đã tải xuống
  assert.equal(b.disabled, false, 'nút không bị kẹt khoá');
  assert.equal(b.dataset.busy, undefined);
});
