import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../../trial-ui/app.js', import.meta.url), 'utf8');
const errors = source.slice(source.indexOf('const globalErrorPage ='), source.indexOf('// Báo giá: lọc, sắp xếp'));
const quotes = source.slice(source.indexOf('let quoteReq ='), source.indexOf('// Danh bạ có thể'));
const members = source.slice(source.indexOf('async function loadMembers()'), source.indexOf('// Tình trạng đồng bộ Sapo'));
function harness() {
  function element(hidden = false) {
    const attributes = new Map<string, string>();
    return {
      hidden, textContent: '',
      setAttribute: (key: string, value: string) => attributes.set(key, value),
      removeAttribute: (key: string) => attributes.delete(key),
      getAttribute: (key: string) => attributes.get(key) ?? null,
    };
  }
  const banner = element(true), table = element(), retry = element(true), status = element();
  const employee = { ...element(), innerHTML: '', value: '' };
  const elements = new Map([
    ['#global-error', banner], ['#quote-table', table], ['#quote-list-retry', retry],
    ['#quote-list-status', status], ['#quote-empty', element(true)],
    ['#quote-employee', employee],
  ]);
  const ctx: any = {
    location: { hash: '#/quotes' }, $: (selector: string) => elements.get(selector) ?? null,
    state: { user: {}, quoteFilter: {}, quotes: [], members: [] },
    quotePager: { limit: 50, offset: 0 }, can: () => true,
    todayIso: () => '2026-10-30', encodeURIComponent, esc: String,
    renderQuotes() {}, renderMembers() {},
    api: async () => { throw Object.assign(new Error('Network unavailable'), { status: 0 }); },
  };
  runInNewContext(errors + quotes + members + '\nthis.show = showGlobalError; this.clear = clearGlobalError; this.loadQuotes = loadQuotes; this.loadMembers = loadMembers;', ctx);
  return { ctx, banner, table, retry, status, employee };
}

test('background staff failure cannot mark a loaded quotes page as disconnected', async () => {
  const { ctx, banner } = harness();
  await ctx.loadMembers();
  assert.equal(banner.hidden, true);
  ctx.location.hash = '#/staff';
  await ctx.loadMembers();
  assert.equal(banner.hidden, false, 'failure on the active staff page is still visible');
});

test('quotes failure stays visible through unrelated success, then clears on successful retry', async () => {
  const { ctx, banner, table, retry, status, employee } = harness();
  const loading = ctx.loadQuotes();
  assert.equal(table.getAttribute('aria-busy'), 'true');
  await loading;
  assert.equal(table.getAttribute('aria-busy'), null);
  assert.equal(retry.hidden, false);
  assert.equal(banner.hidden, false);
  ctx.api = async () => ({ members: [], positions: [] });
  await ctx.loadMembers();
  assert.equal(banner.hidden, false, 'background success must not hide a real quotes error');
  ctx.state.quoteFilter.employee = 'emp';
  ctx.api = async () => ({ quotes: [], filterEmployees: [{ id: 'emp', name: 'Nhân viên thử' }] });
  await ctx.loadQuotes();
  assert.equal(banner.hidden, true);
  assert.equal(banner.textContent, '');
  assert.equal(retry.hidden, true);
  assert.equal(status.textContent, '0 báo giá');
  assert.match(employee.innerHTML, /Nhân viên thử/);
  assert.equal(employee.value, 'emp');
});

test('late failures from superseded quote requests cannot overwrite a successful load', async () => {
  const { ctx, banner } = harness();
  let rejectOld: (error: Error) => void = () => {};
  ctx.api = () => new Promise((_resolve, reject) => { rejectOld = reject; });
  const old = ctx.loadQuotes();
  ctx.api = async () => ({ quotes: [] });
  await ctx.loadQuotes();
  rejectOld(new Error('Late network failure'));
  await old;
  assert.equal(banner.hidden, true);
});

test('background list failures do not appear on another list or a detail page', () => {
  const { ctx, banner } = harness();
  for (const hash of ['#/orders', '#/quotes/quote-id', '#/customers/customer-id']) {
    ctx.location.hash = hash;
    for (const page of ['quotes', 'customers', 'products', 'staff']) ctx.show('Network unavailable', page);
    assert.equal(banner.hidden, true, hash);
  }
  ctx.location.hash = '#/customers?q=test';
  ctx.show('Network unavailable', 'customers');
  assert.equal(banner.hidden, false);
  ctx.clear('products');
  assert.equal(banner.hidden, false);
  ctx.clear('customers');
  assert.equal(banner.hidden, true);
});
