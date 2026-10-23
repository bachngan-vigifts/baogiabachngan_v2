import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const source = readFileSync(new URL('../../trial-ui/tasks.js', import.meta.url), 'utf8').replace(/export /g, '');
const flush = () => new Promise<void>(resolve => setImmediate(resolve));

/** Trang Công việc: mở lại hiện ngay bản lưu sẵn, "Cần duyệt" không chặn danh sách, tải sẵn lúc rảnh. */
function fixture() {
  const nodes = new Map<string, any>(), calls: string[] = [];
  let title = 'Việc A', hold: Promise<unknown> | null = null, approvalsGate: (() => void) | null = null;
  function node(key: string): any {
    if (!nodes.has(key)) nodes.set(key, { innerHTML: '', textContent: '', value: '', hidden: false, className: 'view', options: [], listeners: {}, dataset: {}, attrs: {}, classList: { toggle() {} },
      setAttribute(k: string, v: string) { this.attrs[k] = v; }, addEventListener(k: string, fn: Function) { this.listeners[k] = fn; }, focus() {},
      querySelector: (s: string) => node(key + ' ' + s), querySelectorAll: () => [] });
    return nodes.get(key);
  }
  const ctx: any = { document: { getElementById: (id: string) => node('#' + id), addEventListener() {} }, Intl, Date, URLSearchParams, setTimeout, clearTimeout };
  vm.createContext(ctx); vm.runInContext(source, ctx);
  const app = ctx.initTasks({ isManager: () => true, canApprove: () => true, userId: () => 'mgr', toast() {}, go() {}, api: async (path: string, method = 'GET') => {
    calls.push(method + ' ' + path);
    if (path === '/tasks/people') return { people: [{ id: 'mgr', name: 'Tôi' }] };
    if (path === '/tasks/summary') return { open: 1, overdue: 0, today: 0, views: { mine: 1 } };
    if (path === '/approvals') { await new Promise<void>(r => { approvalsGate = r; }); return { counts: { total: 7 }, items: [] }; }
    if (method !== 'GET') return { ok: true };
    if (hold) await hold;
    return { today: '2026-10-23', syncedAt: '2026-10-23T08:00:00.000Z', dueCounts: { total: 1 }, tasks: [{ id: 't1', title, status: 'todo', priority: 'normal', source: 'manual', due: 'none', dueDate: null }] };
  } });
  return { app, calls, list: () => node('#view-tasks #tasks-list').innerHTML, tabs: () => node('#view-tasks #tasks-view').innerHTML,
    setTitle: (t: string) => { title = t; }, holdTasks: () => { let release!: () => void; hold = new Promise<void>(r => { release = r; }); return () => { hold = null; release(); }; },
    releaseApprovals: () => approvalsGate?.() };
}

test('danh sách hiện khi /tasks về, không chờ "Cần duyệt"; số Cần duyệt cập nhật sau', async () => {
  const f = fixture();
  await f.app.load();
  assert.match(f.list(), /Việc A/, 'không chờ /approvals');
  assert.doesNotMatch(f.tabs(), /tab-count">7/);
  f.releaseApprovals(); await flush(); await flush();
  assert.match(f.tabs(), /Cần duyệt <b class="tab-count">7<\/b>/);
});

test('mở lại trang hiện ngay bản lưu sẵn rồi vẽ lại khi bản mới khác', async () => {
  const f = fixture();
  const first = f.app.load(); f.releaseApprovals(); await first;
  f.setTitle('Việc A đã đổi');
  const release = f.holdTasks();
  const again = f.app.load(); await flush(); await flush();
  assert.match(f.list(), /Việc A</, 'máy chủ chưa trả: vẫn hiện bản lưu sẵn');
  f.releaseApprovals(); release(); await again;
  assert.match(f.list(), /Việc A đã đổi/, 'bản mới về thì vẽ lại');
});

test('tải sẵn lúc rảnh: lần mở đầu tiên hiện ngay từ bản tải sẵn', async () => {
  const f = fixture();
  await f.app.prefetch();
  assert.ok(f.calls.some(c => c.startsWith('GET /tasks?')));
  const release = f.holdTasks();
  const opening = f.app.load(); await flush(); await flush();
  assert.match(f.list(), /Việc A/, 'chưa chờ máy chủ đã có danh sách');
  release(); f.releaseApprovals(); await opening;
});
