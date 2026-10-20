import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const source = readFileSync(new URL('../../trial-ui/tasks.js', import.meta.url), 'utf8').replace(/export /g, '');
const flush = () => new Promise<void>(resolve => setImmediate(resolve));

function fixture(manager = false) {
  const nodes = new Map<string, any>(), calls: string[] = [], pending = new Map<string, (x: unknown) => void>(); let delayed = false;
  function node(key: string): any {
    if (!nodes.has(key)) nodes.set(key, { innerHTML: '', textContent: '', value: '', hidden: false, options: [1], listeners: {}, dataset: {}, attrs: {}, classList: { toggle() {} },
      setAttribute(k: string, v: string) { this.attrs[k] = v; }, addEventListener(k: string, fn: Function) { this.listeners[k] = fn; },
      querySelector: (s: string) => node(s), querySelectorAll: (s: string) => key === '#tasks-view' && s === '[data-v]' ? ['mine', 'created', 'team', 'unassigned', 'all'].map(v => chip('view', v)) : key === '#tasks-status' && s === '[data-v]' ? ['open', 'done', 'all'].map(v => chip('status', v)) : [] });
    return nodes.get(key);
  }
  function chip(group: string, v: string) { const n = node(`${group}-${v}`); n.dataset.v = v; return n; }
  const data = (due: string) => ({ tasks: [{ id: due || 'mine', title: due ? `Only ${due}` : 'My open tasks', status: 'todo', priority: 'normal', source: 'manual', due: due || 'none', dueDate: null }], canViewColleagues: false });
  const ctx: any = { document: { getElementById: node, addEventListener() {} }, Intl, Date, URLSearchParams, setTimeout, clearTimeout };
  vm.createContext(ctx); vm.runInContext(source, ctx);
  const app = ctx.initTasks({ isManager: () => manager, userId: () => 'emp', toast() {}, go() {}, api: async (path: string) => {
    calls.push(path);
    if (path === '/tasks/people') return { people: [] };
    if (path === '/tasks/summary') return { open: 34, overdue: 33, today: 1, team: 33, unassigned: 2 };
    if (path === '/approvals') return { counts: { total: 0 }, items: [] };
    const due = new URLSearchParams(path.split('?')[1]).get('due') || '';
    if (delayed && due) return new Promise(resolve => pending.set(due, resolve));
    return data(due);
  } });
  const click = (stat: string) => node('#tasks-stats').listeners.click({ target: { closest: () => ({ dataset: { stat } }) } });
  return { app, node, calls, click, pending, data, delay: () => { delayed = true; } };
}

test('thẻ công việc: lọc thật, xoá bộ lọc cũ, hiện hạn đang chọn và quay lại đầy đủ bằng Việc của tôi', async () => {
  const f = fixture(); await f.app.load();
  f.node('#tasks-priority').value = 'high'; f.node('#tasks-priority').listeners.change({ target: { value: 'high' } });
  f.node('#tasks-source').value = 'purchase'; f.node('#tasks-source').listeners.change({ target: { value: 'purchase' } });
  f.node('#tasks-search').value = 'old'; f.node('#tasks-search').listeners.input({ target: { value: 'old' } });
  f.click('today'); await flush();
  const query = new URLSearchParams(f.calls.filter(x => x.startsWith('/tasks?')).at(-1)!.split('?')[1]);
  assert.equal(query.get('due'), 'today'); assert.equal(query.get('view'), 'mine'); assert.equal(query.get('status'), 'open');
  assert.equal(query.has('priority'), false); assert.equal(query.has('source'), false); assert.equal(query.has('q'), false);
  assert.equal(f.node('#tasks-due').value, 'today'); assert.equal(f.node('#tasks-search').value, '');
  assert.match(f.node('#tasks-list').innerHTML, /Only today/); assert.doesNotMatch(f.node('#tasks-list').innerHTML, /My open tasks/);
  assert.match(f.node('#tasks-stats').innerHTML, /data-stat="today" aria-pressed="true"/);
  f.click('overdue'); await flush(); assert.match(f.node('#tasks-list').innerHTML, /Only overdue/);
  f.click('team'); await flush(); assert.match(f.calls.filter(x => x.startsWith('/tasks?')).at(-1)!, /view=team/); assert.equal(f.node('#tasks-due').value, '');
  f.click('mine'); await flush(); assert.match(f.node('#tasks-list').innerHTML, /My open tasks/);
  f.node('#tasks-due').listeners.change({ target: { value: 'today' } }); await flush();
  f.node('#tasks-status').listeners.click({ target: { closest: () => ({ dataset: { v: 'done' } }) } }); await flush();
  assert.equal(f.node('#tasks-due').value, ''); assert.doesNotMatch(f.calls.filter(x => x.startsWith('/tasks?')).at(-1)!, /due=/);
});

test('bấm nhanh các thẻ: response cũ không ghi đè kết quả mới; thẻ Manager vẫn mở được', async () => {
  const f = fixture(true); await f.app.load(); f.delay();
  f.click('overdue'); await flush(); f.click('today'); await flush();
  f.pending.get('today')!(f.data('today')); await flush(); f.pending.get('overdue')!(f.data('overdue')); await flush();
  assert.match(f.node('#tasks-list').innerHTML, /Only today/); assert.doesNotMatch(f.node('#tasks-list').innerHTML, /Only overdue/);
  f.click('unassigned'); await flush(); assert.match(f.calls.filter(x => x.startsWith('/tasks?')).at(-1)!, /view=unassigned/);
  f.click('approvals'); await flush(); assert.equal(f.node('#tasks-approvals').hidden, false); assert.equal(f.node('.task-board').hidden, true);
});

test('giao diện kế toán có nhãn đơn web không link, KPI và cảnh báo chứng từ còn tồn', () => {
  assert.match(source, /Không có link đơn/);
  assert.match(source, /Xuất hoá đơn chờ/);
  assert.match(source, /Trả NCC trong 3 ngày/);
  assert.match(source, /đã đóng tay nhưng chứng từ vẫn còn tồn/);
  assert.match(source, /Hoàn thành \(tự động\)/);
});
