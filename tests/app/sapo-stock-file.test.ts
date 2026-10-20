import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { eq, and } from 'drizzle-orm';
import { createTestDb } from '../helpers/postgres.ts';
import { seedStaff, PASSWORD } from '../helpers/staff-fixture.ts';
import { createAppRouter } from '../../src/app/router.ts';
import { products, productStock, warehouses, stockImportLines, stockImports } from '../../src/modules/catalog/schema.ts';

function parser() {
  const context: any = {}; vm.createContext(context);
  vm.runInContext(readFileSync(new URL('../../trial-ui/product-file.js', import.meta.url), 'utf8').replace(/export /g, ''), context);
  const source = readFileSync(new URL('../../trial-ui/sapo-stock-file.js', import.meta.url), 'utf8').replace(/^import .*;$/m, '').replace(/export /g, '');
  vm.runInContext(source + ';globalThis.parse = parseSapoStockFile;globalThis.combine = combineSapoStockFiles;globalThis.detect = detectSapoColumns;', context);
  return context;
}
const plain = (x: any) => JSON.parse(JSON.stringify(x));
test('file Sapo: hai cột, số Việt Nam, số 0 đầu, số âm/thập phân, dòng ẩn và chặn trùng/thiếu cột', () => {
  const p = parser(), data = [['Báo cáo kho'], ['Mã SKU', 'Tồn kho'], ['00123', '1.000'], ['A', -2.5], ['HIDDEN', 999]];
  assert.deepEqual(plain(p.detect(data)), { header: 1, mapping: { sku: 0, onHand: 1 } });
  const read = p.parse(data, 1, { sku: 0, onHand: 1 }, [,,,,{ hidden: true }]);
  assert.deepEqual(plain(read.rows), [{ sku: '00123', onHand: 1000 }, { sku: 'A', onHand: -2.5 }]); assert.equal(read.hidden, 1);
  for (const row of [['A', ''], ['A', 'abc'], [12345678901234567, 1]]) assert.throws(() => p.parse([data[1], row], 0, { sku: 0, onHand: 1 }));
  assert.throws(() => p.parse([data[1], ['A', 1], ['a', 2]], 0, { sku: 0, onHand: 1 }), /bị lặp/);
  assert.throws(() => p.parse(data, 1, { sku: 0, onHand: 0 }), /hai cột/);
  const combined = p.combine([{ source: 'VIGIFTS', warehouseId: 'v', rows: read.rows }, { source: 'Lock', warehouseId: 'm', rows: [{ sku: '00123', onHand: 5 }] }, { source: 'BN', warehouseId: 'm', rows: [{ sku: '00123', onHand: 7 }] }]);
  assert.deepEqual(plain(combined[0]), { sku: '00123', stock: { v: 1000, m: 12 } });
  assert.throws(() => p.combine([{ source: 'VIGIFTS', warehouseId: '', rows: read.rows }]));
  assert.throws(() => p.combine([{ source: 'same', warehouseId: 'v', rows: read.rows }, { source: 'same', warehouseId: 'v', rows: read.rows }]));
});

test('Excel/CSV thật: giữ mã 0 đầu và chuyển trực tiếp cột Tồn', () => {
  const ctx: any = {}; vm.createContext(ctx); vm.runInContext(readFileSync(new URL('../../trial-ui/xlsx.full.min.js', import.meta.url), 'utf8'), ctx);
  const x = ctx.XLSX, p = parser(), rows = [['Mã hàng', 'Tồn'], ['00123', 10], ['ZERO', 0]];
  const book = x.utils.book_new(); x.utils.book_append_sheet(book, x.utils.aoa_to_sheet(rows), 'Sapo');
  for (const restored of [x.read(x.write(book, { type: 'array', bookType: 'xlsx' }), { type: 'array', cellStyles: true }), x.read('Mã hàng,Tồn\n00123,10\nZERO,0', { type: 'string', raw: true })]) {
    const data = x.utils.sheet_to_json(restored.Sheets[restored.SheetNames[0]], { header: 1, raw: true });
    const parsed = p.parse(data, 0, { sku: 0, onHand: 1 });
    assert.equal(parsed.rows[0].sku, '00123'); assert.equal(p.combine([{ source: 'v', warehouseId: 'v', rows: parsed.rows }])[0].stock.v, 10); assert.equal(parsed.rows[1].onHand, 0);
  }
});

test('API Sapo file: quyền Manager, snapshot nguyên tử, lưu raw totals, không cộng dồn/đụng kho khác và chống file cũ', async () => {
  const { db, d1 } = await createTestDb(); await seedStaff(d1); const router = createAppRouter(), origin = 'https://trial.test';
  const call = async (path: string, cookie = '', method = 'POST', body?: object) => { const r = await router.handle(new Request(origin + '/api/staff' + path, { method, headers: { origin, cookie, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }), { db, passwordIterations: 1000 }); return { status: r.status, data: await r.json() as any, cookie: r.headers.get('set-cookie')?.split(';')[0] || '' }; };
  const mgr = (await call('/login', '', 'POST', { email: 'mgr@x.vn', password: PASSWORD })).cookie, emp = (await call('/login', '', 'POST', { email: 'emp@x.vn', password: PASSWORD })).cookie;
  const t = '2026-10-01T00:00:00.000Z';
  await db.insert(warehouses).values([{ id: 'v', name: 'KHO VIGIFTS' }, { id: 'm', name: 'Minh Long Lock' }, { id: 'ncc', name: 'NCC', kind: 'supplier' }, { id: 'incoming', name: 'Hàng chờ về', kind: 'incoming' }]);
  await db.insert(products).values([{ sku: '00123', name: 'Sản phẩm gốc', imageUrl: 'https://example.test/image.jpg', updatedAt: t }, { sku: 'OTHER', name: 'Giữ nguyên', updatedAt: t }]);
  await db.insert(productStock).values([{ sku: '00123', warehouseId: 'v', quantity: 999, updatedAt: t }, { sku: '00123', warehouseId: 'ncc', quantity: 20, updatedAt: t }, { sku: 'OTHER', warehouseId: 'v', quantity: 22, updatedAt: t }]);
  const stock = { filename: 'vigifts.xlsx + lock.csv + bn.xlsx', observedAt: '2026-10-17T00:00:00.000Z', rows: [{ sku: '00123', stock: { v: 10, m: 12 } }, { sku: 'UNKNOWN', stock: { v: 2 } }] };
  const endpoint = '/admin/products/import/sapo-stock/';
  assert.equal((await call(endpoint + 'preview', '', 'POST', stock)).status, 401); assert.equal((await call(endpoint + 'preview', emp, 'POST', stock)).status, 403); assert.equal((await call(endpoint + 'apply', emp, 'POST', stock)).status, 403);
  assert.equal((await call(endpoint + 'apply', mgr, 'POST', stock)).status, 400);
  const preview = await call(endpoint + 'preview', mgr, 'POST', stock); assert.equal(preview.status, 200, JSON.stringify(preview.data)); assert.equal(preview.data.unknownCount, 1); assert.equal(preview.data.samples[0].after, 10);
  const invalid = { ...stock, rows: [{ ...stock.rows[0], transactions: { v: { onHand: 10, committed: 3 } } }], version: preview.data.version }; assert.equal((await call(endpoint + 'apply', mgr, 'POST', invalid)).status, 400);
  assert.equal((await db.select().from(stockImports)).length, 0);
  const applied = await call(endpoint + 'apply', mgr, 'POST', { ...stock, version: preview.data.version }); assert.equal(applied.status, 200, JSON.stringify(applied.data));
  const all = await db.select().from(productStock), qty = (sku: string, w: string) => all.find(s => s.sku === sku && s.warehouseId === w)?.quantity;
  assert.deepEqual([qty('00123', 'v'), qty('00123', 'm'), qty('00123', 'ncc'), qty('OTHER', 'v')], [10, 12, 20, 22]);
  const audit = await db.select().from(stockImportLines).where(eq(stockImportLines.sku, '00123')); assert.equal(audit.length, 2); assert.ok(audit.every(s => s.onHand === null && s.committed === null));
  assert.equal((await db.select().from(products).where(eq(products.sku, '00123')))[0]!.name, 'Sản phẩm gốc');
  assert.equal((await call(endpoint + 'apply', mgr, 'POST', { ...stock, version: preview.data.version })).status, 409);
  assert.equal((await call(endpoint + 'preview', mgr, 'POST', { ...stock, observedAt: t })).status, 409);
  for (const warehouseId of ['ncc', 'incoming', 'missing']) {
    const bad = { ...stock, rows: [{ sku: '00123', stock: { [warehouseId]: 1 } }] };
    assert.equal((await call(endpoint + 'preview', mgr, 'POST', bad)).status, 400);
  }
});

// Exercise the real dialog handlers: selecting files, mapping warehouses, preview invalidation and apply.
test('form Cập nhật kho: nhập một file được, đổi kho phải xem trước lại, không render HTML từ SKU', async () => {
  let closes = 0;
  class Element {
    tagName: string; children: Element[] = []; attributes: Record<string, string> = {}; parent: Element | null = null; textContent = ''; value = ''; disabled = false; files: any[] = []; onchange: any; onclick: any; listeners: Record<string, Function> = {};
    constructor(tag: string) { this.tagName = tag; }
    setAttribute(k: string, v: string) { this.attributes[k] = v; if (k === 'value') this.value = String(v); }
    append(...nodes: Element[]) { for (const n of nodes) { n.parent = this; this.children.push(n); if (this.tagName === 'select' && this.children.length === 1) this.value = n.value; } }
    replaceChildren(...nodes: Element[]) { this.children = []; this.value = ''; this.append(...nodes); }
    get options() { return this.children.filter(c => c.tagName === 'option'); }
    querySelectorAll(query: string): Element[] { const tags = query.split(',').map(x => x.trim()); return this.children.flatMap(c => [...(tags.includes(c.tagName) || query === '*' ? [c] : []), ...c.querySelectorAll(query)]); }
    addEventListener(event: string, fn: Function) { this.listeners[event] = fn; }
    showModal() {} close() { closes++; this.listeners.close?.(); } remove() { if (this.parent) this.parent.children = this.parent.children.filter(c => c !== this); }
  }
  const document = { body: new Element('body'), head: new Element('head'), createElement: (tag: string) => new Element(tag) };
  const calls: any[] = [], notices: string[] = []; let refreshed = 0;
  const ctx: any = { document, Date, URL, console, XLSX: { read: (value: any) => value, utils: { decode_range: () => ({ e: { r: 2 } }), sheet_to_json: (ws: any) => ws.rows, encode_cell: ({ r, c }: any) => `${r}:${c}` } } };
  vm.createContext(ctx);
  const pure = readFileSync(new URL('../../trial-ui/product-file.js', import.meta.url), 'utf8').replace(/export /g, '');
  const parse = readFileSync(new URL('../../trial-ui/sapo-stock-file.js', import.meta.url), 'utf8').replace(/^import .*;$/m, '').replace(/export /g, '');
  const ui = readFileSync(new URL('../../trial-ui/sapo-stock-import.js', import.meta.url), 'utf8').replace(/^import .*;$/m, '').replace(/export /g, '').replaceAll('import.meta.url', "'https://trial.test/sapo-stock-import.js'");
  vm.runInContext(pure + '\n' + parse + '\n' + ui, ctx);
  await ctx.openSapoStockImport({ isManager: () => true, toast: (message: string) => notices.push(message), onChanged: () => { refreshed++; }, api: async (path: string, method: string, body?: any) => {
    if (!method) return { warehouses: [
      { id: 'sr', name: 'MINH LONG - LOCKNLOCK CẦN THƠ', kind: 'stock' },
      { id: 'v', name: 'KHO VIGIFTS', kind: 'stock' },
      { id: 'lock', name: 'LOCKNLOCK (HÓA ĐƠN)', kind: 'stock' },
      { id: 'ml', name: 'BÁCH NGÂN HÓA ĐƠN', kind: 'stock' },
      { id: 'ncc', name: 'NCC', kind: 'supplier' },
    ] };
    calls.push({ path, body: plain(body) });
    return { version: 'a'.repeat(64), matched: 1, unknownCount: 2, ambiguousCount: 0, unknown: ['MISSING-1', 'MISSING-2'], samples: [{ sku: '<img onerror=alert(1)>', warehouse: 'Kho', before: 0, after: 10 }], updatedAt: new Date().toISOString() };
  } });
  const all = () => document.body.querySelectorAll('*');
  const button = (text: string) => all().find(x => x.tagName === 'button' && x.textContent === text)!;
  const inputs = all().filter(x => x.tagName === 'input' && x.attributes.type === 'file'); assert.equal(inputs.length, 4);
  const review = button('Xem trước'), apply = button('Xác nhận cập nhật kho'); assert.equal(review.disabled, false); assert.equal(apply.disabled, true);
  inputs[0]!.files = [{ name: '0.csv', size: 100, arrayBuffer: async () => ({ SheetNames: ['Sapo'], Sheets: { Sapo: { rows: [['Mã hàng', 'Tồn'], ['00123', 10]] } } }) }]; await inputs[0]!.onchange();
  const targets = all().filter(x => x.tagName === 'select' && x.attributes['aria-label']?.startsWith('Kho CRM nhận'));
  assert.ok(!targets[1]!.options.some(x => x.value === 'ncc'));
  assert.deepEqual(targets.map(x => x.value), ['sr', 'v', 'lock', 'ml'], 'tự chọn đúng bốn kho riêng');
  assert.equal(review.disabled, false); await review.onclick(); assert.equal(apply.disabled, false);
  assert.equal(calls[0].body.rows[0].stock.sr, 10); assert.equal(calls[0].body.rows[0].stock.v, undefined);
  assert.ok(all().some(x => x.tagName === 'td' && x.textContent === '<img onerror=alert(1)>')); assert.ok(!all().some(x => x.tagName === 'img'));
  assert.ok(!all().some(x => String(x.textContent).includes('MISSING-1') || String(x.textContent).includes('Mã không tìm thấy')));
  targets[0]!.onchange(); assert.equal(apply.disabled, true, 'đổi kho vô hiệu hoá preview'); await apply.onclick(); assert.equal(calls.length, 1);
  await review.onclick(); await apply.onclick(); assert.equal(calls.at(-1).path, '/admin/products/import/sapo-stock/apply'); assert.equal(refreshed, 1); assert.equal(apply.disabled, true);
  assert.equal(closes, 1); assert.match(notices[0]!, /^Đã cập nhật 1 mã lúc /);
});
