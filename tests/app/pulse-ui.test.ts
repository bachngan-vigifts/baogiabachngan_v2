import { test } from 'node:test';
import assert from 'node:assert/strict';
// @ts-ignore JS giao diện, chạy bằng Node như các kiểm thử UI khác.
import { setupPulse } from '../../trial-ui/pulse.js';

/** trial-ui/pulse.js: 1 lượt GET /pulse mỗi nhịp; chỉ báo tải lại khi máy chủ báo đổi; rảnh 5 phút / ẩn tab thì ngừng hỏi. */
function harness() {
  let t = 0, tick: (() => void) | null = null, resp = { stamp: 'a', notifyAt: 'n1', chatUnread: 0 };
  const calls: string[] = [], events: string[] = [], listeners = new Map<string, () => void>();
  const target = { addEventListener: (e: string, f: () => void) => listeners.set(e, f) };
  const doc = { ...target, visibilityState: 'visible' };
  const p = setupPulse({
    api: async (path: string) => { calls.push(path); return { ...resp }; },
    onData: () => events.push('data'), onNotify: () => events.push('notify'), onChat: (n: number) => events.push('chat:' + n),
    doc, win: target, now: () => t, schedule: (f: () => void) => { tick = f; return 1; }, cancel: () => { tick = null; },
  } as never);
  const flush = () => new Promise(r => setImmediate(r));
  return { p, calls, events, doc, listeners, flush, advance: (ms: number) => { t += ms; }, run: async () => { tick?.(); await flush(); }, set: (r: Partial<typeof resp>) => { resp = { ...resp, ...r }; } };
}

test('pulse: không đổi thì không tải lại; stamp / thông báo / chat đổi thì gọi đúng việc; rảnh hoặc ẩn tab thì ngừng hỏi', async () => {
  const h = harness();
  h.p.start(); await h.flush();
  assert.deepEqual(h.calls, ['/pulse']); assert.deepEqual(h.events, ['chat:0'], 'lần đầu chỉ ghi nhận, không tải lại');
  h.advance(30_000); await h.run();
  assert.equal(h.calls.length, 2); assert.deepEqual(h.events, ['chat:0'], 'không đổi → không làm gì');
  h.set({ stamp: 'b', notifyAt: 'n2', chatUnread: 3 }); h.advance(30_000); await h.run();
  assert.deepEqual(h.events, ['chat:0', 'data', 'notify', 'chat:3']);
  (h.doc as { visibilityState: string }).visibilityState = 'hidden'; h.advance(30_000); await h.run();
  assert.equal(h.calls.length, 3, 'tab ẩn → không hỏi');
  (h.doc as { visibilityState: string }).visibilityState = 'visible';
  h.advance(6 * 60_000); await h.run();
  assert.equal(h.calls.length, 3, 'rảnh quá 5 phút → không hỏi');
  h.listeners.get('keydown')!(); await h.flush();
  assert.equal(h.calls.length, 4, 'thao tác lại → hỏi ngay');
  h.p.stop(); h.advance(30_000); await h.run();
  assert.equal(h.calls.length, 4, 'đã dừng (đăng xuất)');
});
