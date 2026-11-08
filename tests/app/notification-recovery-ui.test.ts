import { contractTest as test, assert } from '../TEST_TEMPLATE.ts';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

/** Runs the real notification module with deterministic DOM/timers and no network. */
function harness(api: (path: string) => Promise<unknown>) {
  const nodes = new Map<string, any>(), docEvents = new Map<string, Function>(), winEvents = new Map<string, Function>();
  const node = (key: string) => {
    if (!nodes.has(key)) nodes.set(key, { hidden: false, textContent: '', innerHTML: '', events: new Map(), addEventListener(e: string, f: Function) { this.events.set(e, f); }, setAttribute() {} });
    return nodes.get(key);
  };
  const root = { innerHTML: '', querySelector: node, contains: () => true };
  let id = 0, dings = 0, updates = 0;
  const timers = new Map<number, { fn: Function; ms: number }>();
  const doc = { visibilityState: 'visible', addEventListener: (e: string, f: Function) => docEvents.set(e, f) };
  const win = { addEventListener: (e: string, f: Function) => winEvents.set(e, f) };
  const code = readFileSync(new URL('../../trial-ui/notify.js', import.meta.url), 'utf8').replace(/^import .*;$/m, '').replace('export function setupNotifications', 'function setupNotifications');
  const setup = runInNewContext(code + '\nsetupNotifications;', { document: doc, window: win, navigator: { userAgent: 'Test', platform: '', maxTouchPoints: 0 }, localStorage: { getItem: () => '0' },
    ding: () => dings++, setBadgePart() {}, setSound() {}, soundOn: () => false,
    setTimeout: (fn: Function, ms: number) => { timers.set(++id, { fn, ms }); return id; }, clearTimeout: (key: number) => timers.delete(key), setInterval: () => 100, clearInterval() {}, Date, console });
  const ui = setup({ api, root, onNew: () => updates++, onOpen() {}, poll: false });
  node('.bell-panel').hidden = true;
  const flush = () => new Promise(r => setImmediate(r));
  const open = async () => { node('.bell').events.get('click')({ stopPropagation() {} }); await flush(); };
  const fire = async () => { const [key, t] = timers.entries().next().value!; timers.delete(key); t.fn(); await flush(); };
  return { ui, node, timers, doc, docEvents, winEvents, flush, open, fire, counts: () => ({ dings, updates }) };
}
const note = (id = 'n1', readAt: string | null = null) => ({ id, title: 'Việc kiểm thử', body: 'Nội dung kiểm thử', createdAt: '2026-11-08T01:00:00Z', readAt });

test('lỗi tải đầu: hiện lỗi rõ, tự thử lại dù poll=false, không phát lại âm báo cho thông báo cũ', async () => {
  let calls = 0;
  const h = harness(async () => { if (++calls === 1) throw Error('Offline'); return { notifications: [note()] }; });
  h.ui.start(); await h.flush(); assert.match(h.node('.bell-list').innerHTML, /Chưa tải được/);
  assert.equal(h.timers.size, 1); assert.equal([...h.timers.values()][0]!.ms, 5000);
  await h.fire(); assert.equal(calls, 2); assert.equal(h.node('.bell-badge').hidden, false); assert.equal(h.node('.bell-badge').textContent, '1');
  assert.match(h.node('.bell-list').innerHTML, /Việc kiểm thử/); assert.equal(h.timers.size, 0); assert.deepEqual(h.counts(), { dings: 0, updates: 0 });
});
test('mở chuông tải lại toàn bộ, đồng bộ đã đọc từ thiết bị khác; mất mạng giữ danh sách và thử lại với backoff', async () => {
  const paths: string[] = []; let mode = 'ok';
  const h = harness(async path => { paths.push(path); if (mode === 'fail') throw Error('Offline'); return { notifications: [note('n1', mode === 'read' ? '2026-11-08T01:01:00Z' : null)] }; });
  h.ui.start(); await h.flush(); mode = 'read'; await h.open(); assert.equal(paths.at(-1), '/notifications'); assert.equal(h.node('.bell-badge').hidden, true);
  mode = 'fail'; await h.ui.check(); assert.match(h.node('.bell-list').innerHTML, /Việc kiểm thử/);
  await h.fire(); assert.equal([...h.timers.values()][0]!.ms, 10000); mode = 'ok'; await h.fire(); assert.equal(h.timers.size, 0);
});
test('lượt mới lỗi rồi thử lại không mất thông báo; coalesce request; dừng/đổi phiên bỏ phản hồi cũ và dữ liệu tài khoản cũ', async () => {
  let reject: ((e: Error) => void) | undefined, resolve: ((d: unknown) => void) | undefined, calls = 0;
  const h = harness(async () => { calls++; if (calls === 1) return { notifications: [note()] }; return new Promise((yes, no) => { resolve = yes; reject = no; }); });
  h.ui.start(); await h.flush(); const pending = h.ui.check(); h.ui.check(); assert.equal(calls, 2); reject!(Error('Offline')); await pending;
  const retry = h.ui.check(); resolve!({ notifications: [note('n2')] }); await retry; assert.deepEqual(h.counts(), { dings: 1, updates: 1 });
  const old = h.ui.check(); h.ui.stop(); assert.equal(h.node('.bell-badge').hidden, true); assert.equal(h.timers.size, 0);
  resolve!({ notifications: [note('private-old-account')] }); await old; assert.doesNotMatch(h.node('.bell-list').innerHTML, /private-old-account/);
  h.ui.start(); await h.flush(); resolve!({ notifications: [] }); await h.flush(); assert.match(h.node('.bell-list').innerHTML, /Chưa có thông báo/);
});
test('mạng trở lại / tab hiện thì phục hồi lượt đầu bị lỗi, không thêm polling cho tab đang khoẻ', async () => {
  let fail = true, calls = 0;
  const h = harness(async () => { calls++; if (fail) throw Error('Offline'); return { notifications: [note()] }; });
  h.ui.start(); await h.flush(); h.doc.visibilityState = 'hidden'; await h.fire(); assert.equal(calls, 1);
  fail = false; h.doc.visibilityState = 'visible'; h.docEvents.get('visibilitychange')!(); await h.flush(); assert.equal(calls, 2);
  h.winEvents.get('online')!(); await h.flush(); assert.equal(calls, 2, 'chuông khoẻ vẫn dùng pulse, không hỏi thừa');
  fail = true; await h.ui.check(); h.doc.visibilityState = 'hidden'; await h.fire(); assert.equal(calls, 3);
  fail = false; h.doc.visibilityState = 'visible'; h.docEvents.get('visibilitychange')!(); await h.flush(); assert.equal(calls, 4, 'lượt cập nhật lỗi cũng phục hồi khi quay lại tab');
});
