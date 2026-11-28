import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
const source = readFileSync(new URL('../../trial-ui/purchase-create-mode.js', import.meta.url), 'utf8');
class Element {
  children: Element[] = []; attrs: Record<string, string> = {}; events: Record<string, Function> = {}; textContent = ''; value = ''; checked = false; disabled = false; removed = false; open = false;
  append(...nodes: Element[]) { this.children.push(...nodes); }
  replaceChildren(...nodes: Element[]) { this.children = nodes; }
  setAttribute(k: string, v: string) { this.attrs[k] = v; } addEventListener(type: string, fn: Function) { this.events[type] = fn; }
  showModal() { this.open = true; } close() { this.open = false; } remove() { this.removed = true; }
}
function setup() {
  const body = new Element(), timers: Function[] = [], calls: any[] = [], selected = new Set<string>();
  const ctx: any = { document: { body, createElement: () => new Element() }, URLSearchParams, setTimeout: (fn: Function) => { timers.push(fn); return timers.length; }, clearTimeout() {} };
  runInNewContext(source.replaceAll('export function ', 'function ') + '\nglobalThis.choose = choosePurchaseMode; globalThis.picker = createRestockPicker;', ctx);
  const picker = ctx.picker({ api: (path: string) => new Promise((resolve, reject) => calls.push({ path, resolve, reject })), selected: (sku: string) => selected.has(sku), toggle: (p: any, checked: boolean) => checked ? selected.add(p.sku) : selected.delete(p.sku) });
  return { ctx, body, picker, calls, selected, flush: () => timers.pop()?.() };
}
const product = { sku: '031106000', name: '<img onerror=alert(1)>', unit: 'Cái' };
test('mode dialog makes an explicit choice and closes; cancel does not choose', () => {
  const s = setup(); const chosen: string[] = [];
  s.ctx.choose((mode: string) => chosen.push(mode));
  const dialog = s.body.children[0]!; dialog.children[0]!.children[2]!.children[1]!.events.click!();
  assert.deepEqual(chosen, ['restock']); assert.equal(dialog.removed, true);
  s.ctx.choose((mode: string) => chosen.push(mode)); s.body.children[1]!.events.cancel!({ preventDefault() {} });
  assert.deepEqual(chosen, ['restock']);
  // Nút × ở tiêu đề (aria-label "Đóng") đóng popup như Esc, không chọn cách tạo đơn.
  s.ctx.choose((mode: string) => chosen.push(mode)); const third = s.body.children[2]!, x = third.children[0]!.children[0]!.children[1]!;
  assert.equal(x.textContent, '×'); assert.equal(x.attrs['aria-label'], 'Đóng'); assert.equal(x.attrs['data-close'], ''); x.events.click!();
  assert.deepEqual(chosen, ['restock']); assert.equal(third.removed, true);
});
test('catalog pages and search preserve selection and leading-zero SKU; names are text', async () => {
  const s = setup(), root = s.picker.root, list = root.children[3]!, pager = root.children[4]!;
  let pending = s.picker.load(); s.calls[0].resolve({ products: [product], total: 61 }); await pending;
  assert.equal(list.children[0]!.children[1]!.children[1]!.textContent, product.name);
  const check = list.children[0]!.children[0]!; check.checked = true; check.events.change!();
  assert.equal(s.selected.has('031106000'), true);
  pager.children[1]!.events.click!(); assert.match(s.calls[1].path, /offset=30/);
  s.calls[1].resolve({ products: [{ ...product, sku: 'OTHER' }], total: 61 }); await new Promise(r => setImmediate(r));
  root.children[1]!.value = '031106000'; root.children[1]!.events.input!(); pending = s.flush();
  assert.match(s.calls[2].path, /offset=0/); s.calls[2].resolve({ products: [product], total: 1 }); await pending;
  assert.equal(list.children[0]!.children[0]!.checked, true);
  const uncheck = list.children[0]!.children[0]!; uncheck.checked = false; uncheck.events.change!(); assert.equal(s.selected.size, 0);
});
test('stale catalog response and disposed picker cannot overwrite current search', async () => {
  const s = setup(), root = s.picker.root; const old = s.picker.load();
  root.children[1]!.value = 'new'; root.children[1]!.events.input!();
  s.calls[0].resolve({ products: [product], total: 1 }); await old; assert.equal(root.children[3]!.children.length, 0);
  const current = s.flush(); s.picker.dispose(); s.calls[1].resolve({ products: [product], total: 1 }); await current;
  assert.equal(root.children[3]!.children.length, 0);
});
test('catalog error offers retry and does not erase selected products', async () => {
  const s = setup(); s.selected.add(product.sku); const pending = s.picker.load(); s.calls[0].reject(new Error('offline')); await pending;
  assert.equal(s.picker.root.children[2]!.textContent, 'offline'); assert.equal(s.selected.size, 1);
  s.picker.root.children[3]!.children[0]!.events.click!(); assert.equal(s.calls.length, 2);
});
