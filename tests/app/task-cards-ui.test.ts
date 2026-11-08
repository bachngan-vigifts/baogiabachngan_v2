import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
// @ts-ignore browser module
import {createTaskWriteIntent} from '../../trial-ui/task-write-intent.js';
const source = readFileSync(new URL('../../trial-ui/tasks.js', import.meta.url), 'utf8').replace(/^import .*;\n/gm,'').replace(/export /g, '');
const flush = () => new Promise<void>(resolve => setImmediate(resolve));

/** DOM giả tối thiểu: mỗi selector là một node; ghi lại mọi lời gọi API. */
function fixture(manager = false, custom?: object[]) {
  const nodes = new Map<string, any>(), calls: string[] = [], pending = new Map<string, (x: unknown) => void>(); let delayed = false;
  function node(key: string): any {
    if (!nodes.has(key)) nodes.set(key, { innerHTML: '', textContent: '', value: '', hidden: false, className: 'view', options: [], elements:{assigneeId:{options:[],innerHTML:''}}, listeners: {}, dataset: {}, attrs: {}, classList: { toggle() {} },
      setAttribute(k: string, v: string) { this.attrs[k] = v; }, addEventListener(k: string, fn: Function) { this.listeners[k] = fn; }, focus() {},
      querySelector: (s: string) => node(key + ' ' + s), querySelectorAll: (s: string) => key === '#tasks-status' && s === '[data-v]' ? ['open', 'done', 'all'].map(v => chip(v)) : [] });
    return nodes.get(key);
  }
  function chip(v: string) { const n = node(`status-${v}`); n.dataset.v = v; return n; }
  const data = (due: string) => ({ today: '2026-10-22', syncedAt: '2026-10-22T08:20:00.000Z', dueCounts: { overdue: 33, today: 1, week: 4, upcoming: 9, none: 2, total: 45 },
    tasks: custom ?? [{ id: due || 'mine', title: due ? `Only ${due}` : 'My open tasks', status: 'todo', priority: 'normal', source: 'manual', due: due === 'week' ? 'upcoming' : due || 'none', dueDate: null }], canViewColleagues: false });
  const ctx: any = { createTaskWriteIntent, document: { body:{append(){}}, getElementById: (id: string) => node('#' + id), addEventListener() {} }, Intl, Date, URLSearchParams, setTimeout, clearTimeout };
  vm.createContext(ctx); vm.runInContext(source, ctx);
  const app = ctx.initTasks({ isManager: () => manager, userId: () => 'emp', toast() {}, go() {}, api: async (path: string) => {
    calls.push(path);
    if (path === '/tasks/people') return { people: [{ id: 'emp', name: 'Tôi' }, { id: 'lan', name: 'Chị Lan' }] };
    if (path === '/tasks/summary') return { open: 34, overdue: 33, today: 1, team: 3, unassigned: 2, teamNames: ['Kho'], views: { mine: 34, created: 5, team: 3, colleagues: 0, unassigned: 2, all: 48 } };
    if (path === '/approvals') return { counts: { total: 0 }, items: [] };
    const due = new URLSearchParams(path.split('?')[1]).get('due') || '';
    if (delayed && due) return new Promise(resolve => pending.set(due, resolve));
    return data(due);
  } });
  const view = (k: string) => node('#view-tasks #tasks-view').listeners.click({ target: { closest: () => ({ dataset: { v: k } }) } });
  const card = (k: string) => node('#view-tasks #tasks-stats').listeners.click({ target: { closest: () => ({ dataset: { stat: k } }) } });
  const last = () => new URLSearchParams(calls.filter(x => x.startsWith('/tasks?')).at(-1)!.split('?')[1]);
  return { app, node: (s: string) => node('#view-tasks ' + s), calls, view, card, last, pending, data, delay: () => { delayed = true; } };
}

test('tab chế độ xem có số đếm (tên nhóm của tôi), thẻ hạn đếm theo bộ lọc, giờ đồng bộ', async () => {
  const f = fixture(); await f.app.load();
  const tabs = f.node('#tasks-view').innerHTML;
  assert.match(tabs, /data-v="mine" aria-selected="true">Của tôi <b>34<\/b>/);
  assert.match(tabs, /Tôi giao <b>5<\/b>/); assert.match(tabs, /Việc nhóm Kho <b>3<\/b>/);
  assert.doesNotMatch(tabs, /Chưa giao/, 'nhân viên không có tab Chưa giao'); assert.doesNotMatch(tabs, /Đồng nghiệp/);
  assert.match(f.node('#tasks-stats').innerHTML, /data-stat="overdue" aria-pressed="false"><span>Quá hạn<\/span><strong>33<\/strong>/);
  assert.match(f.node('#tasks-stats').innerHTML, /data-stat="week"[^>]*><span>Sắp tới<\/span><strong>4<\/strong><small>7 ngày tới/);
  assert.match(f.node('#tasks-sync').textContent, /^Đồng bộ lúc \d\d:\d\d/);
  assert.match(f.node('#tasks-count').textContent, /Hiển thị 1 \/ 45 việc của bạn/);
  f.view('team'); await flush(); assert.equal(f.last().get('view'), 'team');
  const m = fixture(true); await m.app.load();
  assert.match(m.node('#tasks-view').innerHTML, /Chưa giao <b>2<\/b>/); assert.match(m.node('#tasks-view').innerHTML, /Tất cả <b>48<\/b>/);
});

test('thẻ hạn lọc thật, bấm lại để bỏ; chip bộ lọc đang bật có × và Xoá bộ lọc', async () => {
  const f = fixture(); await f.app.load();
  f.node('#tasks-source').listeners.change({ target: { value: 'invoice' } }); await flush();
  assert.equal(f.last().get('source'), 'invoice');
  f.card('today'); await flush();
  assert.equal(f.last().get('due'), 'today'); assert.equal(f.last().get('source'), 'invoice', 'thẻ hạn không xoá bộ lọc khác');
  assert.match(f.node('#tasks-list').innerHTML, /Only today/);
  assert.match(f.node('#tasks-stats').innerHTML, /data-stat="today" aria-pressed="true"/);
  const chips = f.node('#tasks-active').innerHTML;
  assert.match(chips, /Nguồn: Xuất hoá đơn/); assert.match(chips, /Hạn: Hôm nay/); assert.match(chips, /data-clear="all"/);
  assert.equal(f.node('#tasks-active').hidden, false);
  assert.match(f.node('#tasks-empty-text').textContent, /Nguồn: Xuất hoá đơn đến hạn hôm nay/);
  f.card('today'); await flush(); assert.equal(f.last().has('due'), false, 'bấm lại thẻ đang chọn để bỏ lọc hạn');
  f.card('week'); await flush(); assert.equal(f.last().get('due'), 'week');
  f.node('#tasks-active').listeners.click({ target: { closest: () => ({ dataset: { clear: 'all' } }) } }); await flush();
  assert.equal(f.last().has('due'), false); assert.equal(f.last().has('source'), false); assert.equal(f.node('#tasks-active').hidden, true);
  f.node('#tasks-assignee').listeners.change({ target: { value: 'team:warehouse' } }); await flush();
  assert.equal(f.last().get('assignee'), 'team:warehouse'); assert.match(f.node('#tasks-active').innerHTML, /Người nhận: Nhóm Kho/);
  assert.match(f.node('#tasks-source').innerHTML, /value="care"/);
  assert.match(f.node('#tasks-source').innerHTML, /value="invoice"/);
});

test('bấm nhanh các thẻ: response cũ không ghi đè kết quả mới; tab Cần duyệt mở hộp duyệt', async () => {
  const f = fixture(true); await f.app.load(); f.delay();
  f.card('overdue'); await flush(); f.card('today'); await flush();
  f.pending.get('today')!(f.data('today')); await flush(); f.pending.get('overdue')!(f.data('overdue')); await flush();
  assert.match(f.node('#tasks-list').innerHTML, /Only today/); assert.doesNotMatch(f.node('#tasks-list').innerHTML, /Only overdue/);
  f.view('unassigned'); await flush(); assert.match(f.calls.filter(x => x.startsWith('/tasks?')).at(-1)!, /view=unassigned/);
  f.view('approvals'); await flush(); assert.equal(f.node('#tasks-approvals').hidden, false); assert.equal(f.node('.task-board').hidden, true);
});

test('dòng việc: việc tự hoàn thành theo chứng từ không có ô tick; việc tay có ô tick và nút Cần làm ↔ Đang làm', async () => {
  const ctx: any = { createTaskWriteIntent, document: { getElementById() {}, addEventListener() {} }, Intl, Date, URLSearchParams, setTimeout, clearTimeout };
  vm.createContext(ctx); vm.runInContext(source, ctx);
  const t = (id: string, source: string, due: string, extra = {}) => ({ id, source, due, priority: 'normal', status: 'todo', ...extra });
  // Trong nhóm: việc mở trước, rồi việc sinh sau (mới tạo) lên trên cùng – không còn xếp theo hạn / ưu tiên.
  const at = (h: number) => ({ createdAt: `2026-10-23T${String(h).padStart(2, '0')}:00:00.000Z` });
  const groups = ctx.groupTasks([t('m1', 'manual', 'today'), t('c1', 'cash', 'upcoming', at(10)), t('c2', 'receivable', 'overdue', at(8)), t('q1', 'quote', 'none'),
    t('p1', 'packing', 'today'), t('c3', 'invoice', 'overdue', { status: 'done', ...at(11) }), t('c4', 'cash', 'today', { priority: 'urgent', ...at(9) }), t('k1', 'care', 'today'), t('x', 'unknown', 'none')]);
  assert.deepEqual(JSON.parse(JSON.stringify(groups.map((g: any) => [g[0], g[2].map((x: any) => x.id)]))), [
    ['sales', ['q1']], ['warehouse', ['p1']], ['money', ['c1', 'c4', 'c2', 'c3']], ['care', ['k1']], ['manual', ['m1', 'x']],
  ]);
  const byDue = ctx.groupByDue([t('a', 'manual', 'today'), t('b', 'manual', 'overdue'), t('c', 'manual', 'none'), t('d', 'manual', 'today', { status: 'done' })]);
  assert.deepEqual(JSON.parse(JSON.stringify(byDue.map((g: any) => [g[0], g[2].map((x: any) => x.id)]))), [['overdue', ['b']], ['today', ['a']], ['none', ['c']], ['closed', ['d']]]);

  const f = fixture(false, [
    { id: 'auto', title: 'Duyệt phiếu chi PC-1', status: 'todo', priority: 'high', source: 'cash', due: 'today', dueDate: '2026-10-22', auto: true, createdBy: null, completionFromSource: true, completionHelp: 'Mở phiếu ở Sổ quỹ để duyệt.', assigneeName: '', teamName: '', creatorName: 'Hệ thống' },
    { id: 'hand', title: 'Gọi khách', status: 'in_progress', priority: 'normal', source: 'manual', due: 'overdue', dueDate: '2026-10-20', assigneeName: 'Tôi', creatorName: 'Manager' },
  ]);
  await f.app.load();
  const list = f.node('#tasks-list').innerHTML;
  const auto = list.slice(list.indexOf('data-task="auto"')), hand = list.slice(list.indexOf('data-task="hand"'));
  assert.ok(list.indexOf('Quá hạn') < list.indexOf('Hôm nay'), 'nhóm theo hạn: quá hạn trước');
  assert.doesNotMatch(auto.slice(0, auto.indexOf('task-main')), /type="checkbox"/); assert.match(auto, /Tự động · không đóng tay/); assert.match(auto, /Chưa giao/);
  assert.match(hand.slice(0, hand.indexOf('task-main')), /type="checkbox"/); assert.match(hand, /data-cycle[^>]*>Đang làm/); assert.match(hand, /trễ \d+ ngày/); // số ngày theo ngày chạy test
  for (const k of ['cash', 'transfer', 'invoice', 'care']) assert.match(f.node('#tasks-source').innerHTML, new RegExp(`value="${k}"`), 'ô Nguồn đủ nguồn việc');
});
