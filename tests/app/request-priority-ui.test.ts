import { test } from 'node:test';
import assert from 'node:assert/strict';
// Module trình duyệt (JS thuần) – nạp qua URL để TypeScript không đòi khai báo kiểu.
const { createRequestPriority, isBackgroundRequest }: any = await import(new URL('../../trial-ui/request-priority.js', import.meta.url).href);

const deferred = () => { let resolve!: (v?: unknown) => void; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

test('phân loại: số đếm menu / chuông / nhịp / bản chụp so sánh là phụ; danh sách có tham số, lệnh ghi và dữ liệu đúng trang là chính', () => {
  for (const p of ['/pulse', '/notifications?since=x', '/chat/unread', '/navigation-counts', '/tasks/summary', '/approvals', '/admin/sapo-sync',
    '/catalog-snapshot?v=1', '/stock-requests?status=open', '/care?view=follow-ups&limit=1', '/quotes', '/orders', '/contracts', '/customer-duplicates'])
    assert.equal(isBackgroundRequest(p, 'GET', '#/cash'), true, p);
  for (const p of ['/cash', '/quotes?limit=50', '/orders?flow=order', '/tasks?view=mine', '/stock-requests?status=done', '/care?view=follow-ups'])
    assert.equal(isBackgroundRequest(p, 'GET', '#/cash'), false, p);
  assert.equal(isBackgroundRequest('/pulse', 'POST', '#/cash'), false, 'lệnh ghi luôn là chính');
  assert.equal(isBackgroundRequest('/catalog-snapshot', 'GET', '#/products'), false, 'đang ở trang Sản phẩm: danh mục là dữ liệu chính');
  assert.equal(isBackgroundRequest('/tasks/summary', 'GET', '#/tasks/abc'), false);
  assert.equal(isBackgroundRequest('/approvals', 'GET', '#/approvals'), false);
});

test('lời gọi phụ chờ lời gọi chính xong (thêm một nhịp ngắn), tối đa 3 lời gọi phụ cùng lúc', async () => {
  const pr = createRequestPriority(), order: string[] = [], main = deferred();
  const mainCall = pr.run(false, async () => { await main.promise; order.push('main'); });
  const bg = [1, 2, 3, 4].map(i => pr.run(true, async () => { order.push('bg' + i + ':start'); await wait(300); order.push('bg' + i + ':end'); }));
  await wait(50);
  assert.equal(order.length, 0, 'phụ chưa chạy khi trang chính còn đang tải');
  main.resolve(); await mainCall;
  // nhịp yên 150 ms sau lời gọi chính rồi 3 lời gọi phụ bắt đầu (mỗi cái chạy 300 ms)
  for (let i = 0; i < 100 && order.filter(x => x.endsWith(':start')).length < 3; i++) await wait(10);
  assert.equal(order.filter(x => x.endsWith(':start')).length, 3, 'chỉ 3 lời gọi phụ chạy cùng lúc');
  assert.ok(!order.includes('bg4:start'));
  await Promise.all(bg);
  assert.ok(order.includes('bg4:end'));
  assert.ok(order.indexOf('bg4:start') > order.indexOf('bg1:end'), 'lời gọi phụ thứ 4 chờ có chỗ trống');
});

test('không có lời gọi chính: phụ chạy gần như ngay; lời gọi chính treo lâu thì phụ không chờ quá giới hạn', async () => {
  let t = 0;
  const timers: { at: number; fn: () => void }[] = [];
  const pr = createRequestPriority({ now: () => t, setTimer: (fn: () => void, ms: number) => { timers.push({ at: t + ms, fn }); return timers.length; }, clearTimer: () => {} });
  const advance = async (ms: number) => { t += ms; for (const x of timers.splice(0).filter(x => { if (x.at <= t) return true; timers.push(x); return false; })) x.fn(); await Promise.resolve(); await Promise.resolve(); };
  let ran = false;
  const done = pr.enter(false); (await done)();
  const p = pr.run(true, async () => { ran = true; });
  await advance(100); assert.equal(ran, false, 'đợi một nhịp yên sau lời gọi chính');
  await advance(100); await p; assert.equal(ran, true);
  // Lời gọi chính không xong: lời gọi phụ vẫn chạy sau tối đa 4 giây.
  const stuck = await pr.enter(false); let late = false;
  const q = pr.run(true, async () => { late = true; });
  await advance(3900); assert.equal(late, false);
  await advance(200); await q; assert.equal(late, true);
  stuck();
});

test('idle(): chờ trang đang mở tải xong rồi mới cho tải dữ liệu của trang khác', async () => {
  const pr = createRequestPriority(), main = deferred(); let after = false;
  const call = pr.run(false, () => main.promise);
  const idle = pr.idle().then(() => { after = true; });
  await wait(30); assert.equal(after, false);
  main.resolve(); await call; await idle; assert.equal(after, true);
  assert.deepEqual(pr.stats(), { foreground: 0, background: 0, waiting: 0 });
});

test('POS periodic stock and optional warehouse details stay behind checkout; initial preload stays foreground',()=>{
 assert.equal(isBackgroundRequest('/pos/stock-snapshot?registerId=r&pricePolicyId=p&background=1','GET','#/pos'),true);
 assert.equal(isBackgroundRequest('/pos/catalog?registerId=r&skus=A&background=1','GET','#/pos'),true);
 assert.equal(isBackgroundRequest('/pos/options?stock=1','GET','#/pos'),false);
 assert.equal(isBackgroundRequest('/pos/stock-snapshot?registerId=r&pricePolicyId=p','GET','#/pos'),false);
 assert.equal(isBackgroundRequest('/pos/checkout','POST','#/pos'),false);
});
