import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
// @ts-ignore browser module
import {createTaskWriteIntent} from '../../trial-ui/task-write-intent.js';
const source = readFileSync(new URL('../../trial-ui/tasks.js', import.meta.url), 'utf8').replace(/^import .*;\n/gm,'').replace(/export /g, '');
const flush = () => new Promise<void>(resolve => setImmediate(resolve));

/** Trang Công việc: mở lại hiện ngay bản lưu sẵn, "Cần duyệt" không chặn danh sách, tải sẵn lúc rảnh. */
function fixture(options: { blockPeople?: boolean; blockSummary?: boolean; feed?: any } = {}) {
  const nodes = new Map<string, any>(), calls: string[] = [];
  let title = 'Việc A', hold: Promise<unknown> | null = null, approvalsGate: (() => void) | null = null;
  function node(key: string): any {
    if (!nodes.has(key)) nodes.set(key, { innerHTML: '', textContent: '', value: '', hidden: false, className: 'view', options: [], elements:{assigneeId:{options:[],innerHTML:''}}, listeners: {}, dataset: {}, attrs: {}, classList: { toggle() {} },
      setAttribute(k: string, v: string) { this.attrs[k] = v; }, addEventListener(k: string, fn: Function) { this.listeners[k] = fn; }, focus() {},
      querySelector: (s: string) => node(key + ' ' + s), querySelectorAll: () => [] });
    return nodes.get(key);
  }
  const ctx: any = { createTaskWriteIntent, document: { body:{append(){}}, getElementById: (id: string) => node('#' + id), addEventListener() {} }, Intl, Date, URLSearchParams, setTimeout, clearTimeout };
  vm.createContext(ctx); vm.runInContext(source, ctx);
  const app = ctx.initTasks({ approvalFeed: options.feed, isManager: () => true, canApprove: () => true, userId: () => 'mgr', toast() {}, go() {}, api: async (path: string, method = 'GET') => {
    calls.push(method + ' ' + path);
    if (path === '/tasks/people' && options.blockPeople) await new Promise(() => {});
    if (path === '/tasks/summary' && options.blockSummary) await new Promise(() => {});
    if (path === '/tasks/people') return { people: [{ id: 'mgr', name: 'Tôi' }] };
    if (path === '/tasks/summary') return { open: 1, overdue: 0, today: 0, views: { mine: 1 } };
    if (path === '/approvals') { await new Promise<void>(r => { approvalsGate = r; }); return { counts: { total: 7 }, items: [] }; }
    if (method !== 'GET') return { ok: true };
    if (hold) await hold;
    return { today: '2026-10-23', syncedAt: '2026-10-23T08:00:00.000Z', dueCounts: { total: 1 }, tasks: [{ id: 't1', title, status: 'todo', priority: 'normal', source: 'manual', due: 'none', dueDate: null }] };
  } });
  return { app, calls, approval: () => node('#view-tasks #tasks-approvals').innerHTML, list: () => node('#view-tasks #tasks-list').innerHTML, tabs: () => node('#view-tasks #tasks-view').innerHTML,
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


test('bell route renders cached approvals synchronously and never requests unrelated task/people/summary APIs', async () => {
  let release!: (d: any) => void;
  const snapshot = { counts: { total: 1, quote: 1 }, items: [{ kind: 'quote', title: 'BG sẵn có', link: '#/quotes/q', by: 'Sale', at: '' }] };
  const feed = { peek: () => snapshot, load: () => new Promise(r => { release = r; }) };
  const f = fixture({ blockPeople: true, blockSummary: true, feed });
  const opening = f.app.load('approvals');
  assert.match(f.approval(), /BG sẵn có/); assert.doesNotMatch(f.approval(), /Chưa tải|Đang tải/);
  await flush(); assert.equal(f.calls.length, 0);
  release(snapshot); await opening; assert.match(f.approval(), /BG sẵn có/);
});

test('cold approval load shows loading rather than a false error and updates without waiting for tasks', async () => {
  const f = fixture({ blockPeople: true, blockSummary: true });
  const opening = f.app.load('approvals');
  assert.match(f.approval(), /Đang tải danh sách/); assert.doesNotMatch(f.approval(), /class="error"/);
  await flush(); assert.deepEqual(f.calls, ['GET /approvals']);
  f.releaseApprovals(); await opening;
  assert.match(f.approval(), /Tất cả <b>7/); assert.doesNotMatch(f.approval(), /Đang tải|class="error"/);
});
