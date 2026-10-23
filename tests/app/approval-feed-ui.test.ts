import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const source = readFileSync(new URL('../../trial-ui/approval-feed.js', import.meta.url), 'utf8').replace(/export /g, '');
const flush = () => new Promise<void>(r => setImmediate(r));
function fixture() {
  const c: any = { Date }; vm.createContext(c); vm.runInContext(source, c);
  let user = 'a', permitted = true, time = 100000, calls = 0;
  const requests: { resolve: Function; reject: Function }[] = [];
  const feed = c.createApprovalFeed({ api: () => { calls++; return new Promise((resolve, reject) => requests.push({ resolve, reject })); },
    userId: () => user, canApprove: () => permitted, now: () => time });
  return { feed, requests, calls: () => calls, user: (s: string) => user = s, revoke: () => permitted = false, tick: () => time += 31000 };
}
const data = (total: number) => ({ counts: { total, quote: total }, items: [{ kind: 'quote', id: 'q', title: 'BG', link: '#/quotes/q' }] });
test('bell + inbox share one request and instantly reuse the full snapshot; stale refresh retains rows on failure', async () => {
  const f = fixture(), bell = f.feed.load(), inbox = f.feed.load();
  assert.equal(bell, inbox); await flush(); assert.equal(f.calls(), 1);
  f.requests[0]!.resolve(data(2)); await bell;
  assert.equal(f.feed.peek().items.length, 1); assert.equal((await f.feed.load()).counts.total, 2); assert.equal(f.calls(), 1);
  f.tick(); const refresh = f.feed.load(); await flush();
  assert.equal(f.feed.peek().counts.total, 2); f.requests[1]!.reject(Error('offline')); await assert.rejects(refresh);
  assert.equal(f.feed.peek().counts.total, 2);
});
test('writes invalidate in-flight reads; an old response cannot restore pre-approval counts', async () => {
  const f = fixture(), old = f.feed.load(); await flush(); f.feed.invalidate();
  const next = f.feed.load(); await flush(); assert.equal(f.calls(), 2);
  f.requests[1]!.resolve(data(0)); await next; f.requests[0]!.resolve(data(99)); await old;
  assert.equal(f.feed.peek().counts.total, 0);
});
test('logout, user change and permission denial remove data and fence old responses', async () => {
  const f = fixture(), old = f.feed.load(); await flush(); f.user('b'); assert.equal(f.feed.peek(), null);
  f.requests[0]!.resolve(data(99)); await old; assert.equal(f.feed.peek(), null);
  const current = f.feed.load(); await flush(); f.requests[1]!.resolve(data(1)); await current;
  f.tick(); const denied = f.feed.load(); await flush(); f.requests[2]!.reject(Object.assign(Error('denied'), { status: 403 }));
  await assert.rejects(denied); assert.equal(f.feed.peek(), null); f.revoke(); await f.feed.load(); assert.equal(f.calls(), 3);
});
