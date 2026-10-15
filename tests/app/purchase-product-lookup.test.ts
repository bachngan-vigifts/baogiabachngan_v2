import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
const source = readFileSync(new URL('../../trial-ui/purchases.js', import.meta.url), 'utf8');
// Evaluate the lookup helpers without unrelated ES module imports or page initialization.
const helpersStart = source.indexOf('const el =');
const helpersEnd = source.indexOf('export function initPurchases');
assert.ok(helpersStart >= 0 && helpersEnd > helpersStart, 'purchase lookup helper boundaries must exist');
const helpers = source.slice(helpersStart, helpersEnd).replace('export function bindManualProductLookup', 'function bindManualProductLookup');
class Element {
  value = ''; hidden = false; disabled = false; textContent = ''; children: Element[] = []; events: Record<string, Function> = {};
  setAttribute() {} append(...children: Element[]) { this.children.push(...children); }
  replaceChildren() { this.children = []; } focus() {}
  addEventListener(event: string, fn: Function) { this.events[event] = fn; }
  removeEventListener(event: string) { delete this.events[event]; }
}
function setup() {
  let next = 0, active = true;
  const timers = new Map<number, Function>(), calls: any[] = [];
  const context: any = { document: { createElement: () => new Element() }, URLSearchParams,
    setTimeout: (fn: Function) => { timers.set(++next, fn); return next; }, clearTimeout: (id: number) => timers.delete(id) };
  runInNewContext(helpers + '\nglobalThis.bind = bindManualProductLookup;', context);
  const sku = new Element(), name = new Element(), unit = new Element(), host = new Element(), add = new Element();
  const lookup = context.bind({ sku, name, unit, host, add, active: () => active, api: (path: string) => new Promise((resolve, reject) => calls.push({ path, resolve, reject })) });
  return { sku, name, unit, host, add, lookup, calls, close: () => { active = false; },
    input(field: Element, value: string) { field.value = value; field.events.input!(); },
    flush() { const fn = [...timers.values()].pop(); timers.clear(); return fn?.(); } };
}
const product = { sku: '031106000', name: 'Chén cơm trắng', unit: 'Cái' };
test('exact SKU lookup preserves leading zero and fills name/unit', async () => {
  const s = setup(); s.input(s.sku, product.sku); assert.equal(s.add.disabled, true);
  const pending = s.flush(); assert.equal(new URL('https://test' + s.calls[0].path).searchParams.get('skus'), product.sku);
  s.calls[0].resolve({ products: [product] }); await pending;
  assert.equal(s.name.value, product.name); assert.equal(s.unit.value, 'Cái'); assert.equal(s.add.disabled, false);
});
test('name search is bounded and selecting result fills SKU, name and unit', async () => {
  const s = setup(); s.input(s.name, 'chén'); const pending = s.flush();
  assert.equal(new URL('https://test' + s.calls[0].path).searchParams.get('limit'), '8');
  s.calls[0].resolve({ products: [product] }); await pending;
  s.host.children[0]!.children[0]!.events.click!();
  assert.equal(s.sku.value, product.sku); assert.equal(s.name.value, product.name); assert.equal(s.unit.value, product.unit);
  s.input(s.name, 'Tách'); assert.equal(s.sku.value, ''); assert.equal(s.unit.value, '');
});
test('changing SKU invalidates old result immediately and clears previous product fields', async () => {
  const s = setup(); s.name.value = 'Tên cũ'; s.unit.value = 'Bộ';
  s.input(s.sku, '001'); const old = s.flush(); s.input(s.sku, '002');
  assert.equal(s.name.value, ''); assert.equal(s.unit.value, '');
  s.calls[0].resolve({ products: [{ ...product, sku: '001' }] }); await old;
  assert.equal(s.name.value, ''); assert.equal(s.add.disabled, true);
  const current = s.flush(); s.calls[1].resolve({ products: [{ ...product, sku: '002' }] }); await current;
  assert.equal(s.name.value, product.name);
});
test('new name query hides stale suggestions before debounce and ignores old response', async () => {
  const s = setup(); s.input(s.name, 'chén'); const old = s.flush(); s.input(s.name, 'tách');
  s.calls[0].resolve({ products: [product] }); await old; assert.equal(s.host.children[0]!.hidden, true);
  const pending = s.flush(); s.calls[1].resolve({ products: [product] }); await pending;
  assert.equal(s.host.children[0]!.hidden, false); s.input(s.name, 'khác'); assert.equal(s.host.children[0]!.hidden, true);
});
test('unknown SKU and network errors keep manual entry available', async () => {
  const s = setup(); s.input(s.sku, 'NEW'); let pending = s.flush(); s.calls[0].resolve({ products: [] }); await pending;
  assert.equal(s.add.disabled, false); assert.match(s.host.children[1]!.textContent, /thủ công/);
  s.input(s.sku, 'OTHER'); pending = s.flush(); s.calls[1].reject(new Error('offline')); await pending;
  assert.equal(s.add.disabled, false); assert.equal(s.sku.value, 'OTHER');
});
test('adding a row or closing the drawer invalidates pending lookup', async () => {
  for (const dispose of [false, true]) {
    const s = setup(); s.input(s.sku, product.sku); const pending = s.flush();
    if (dispose) s.lookup.dispose(); else s.lookup.reset();
    s.sku.value = ''; s.calls[0].resolve({ products: [product] }); await pending;
    assert.equal(s.name.value, ''); assert.equal(s.sku.value, ''); assert.equal(s.add.disabled, false);
  }
});
