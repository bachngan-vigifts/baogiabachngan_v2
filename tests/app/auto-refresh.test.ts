import assert from 'node:assert/strict';
import { test } from 'node:test';
// @ts-ignore JS giao diện, chạy bằng Node như các kiểm thử UI khác.
import { setupDataRefresh } from '../../trial-ui/auto-refresh.js';

function setup() {
  let data: any = { quotes: [{ id: '1', revision: 1, approvalStatus: 'pending' }] };
  let key = '#/quotes', blocked = false, enabled = true, refreshes = 0, reads = 0, notices = 0;
  const listeners = new Map<string, any>();
  const doc = { hidden: false, addEventListener: (name: string, fn: any) => listeners.set(name, fn) };
  const win = { addEventListener: (name: string, fn: any) => listeners.set(name, fn) };
  const refresher = setupDataRefresh({
    read: async () => { reads++; return data; }, refresh: async () => { refreshes++; },
    routeKey: () => key, blocked: () => blocked, enabled: () => enabled, primaryPaths: () => ['/quotes'],
    onDeferred: () => { notices++; }, doc, win, schedule: () => 1, cancel: () => {},
  });
  refresher.observe('/quotes', data, key);
  return { refresher, doc, listeners,
    data: (next: any) => { data = next; }, key: (next: string) => { key = next; },
    block: (next: boolean) => { blocked = next; }, enable: (next: boolean) => { enabled = next; },
    counts: () => ({ reads, refreshes, notices }),
  };
}
test('create, edit, approve and delete each refresh once; unchanged data does not', async () => {
  const h = setup();
  await h.refresher.tick();
  assert.equal(h.counts().refreshes, 0);
  for (const quotes of [
    [{ id: '1', revision: 1 }, { id: '2', revision: 1 }],
    [{ id: '1', revision: 2 }, { id: '2', revision: 1 }],
    [{ id: '1', revision: 2, approvalStatus: 'approved' }, { id: '2', revision: 1 }],
    [{ id: '1', revision: 2, approvalStatus: 'approved' }],
  ]) { h.data({ quotes }); await h.refresher.tick(); }
  assert.equal(h.counts().refreshes, 4);
  await h.refresher.tick();
  assert.equal(h.counts().refreshes, 4);
});
test('open/dirty form defers refresh and flushes once after it becomes safe', async () => {
  const h = setup();
  h.block(true); h.data({ quotes: [] });
  await h.refresher.tick(); await h.refresher.tick();
  assert.equal(h.counts().refreshes, 0);
  assert.equal(h.counts().notices, 1);
  h.block(false); await h.refresher.tick();
  assert.equal(h.counts().refreshes, 1);
});
test('inline draft survives until saved; login inputs do not block the next session', async () => {
  const h = setup();
  h.listeners.get('input')({ target: { matches: () => false, closest: () => ({}) } });
  h.data({ quotes: [] }); await h.refresher.tick();
  assert.equal(h.counts().refreshes, 0);
  h.refresher.saved(); await h.refresher.tick();
  assert.equal(h.counts().refreshes, 1);
  h.refresher.stop();
  h.listeners.get('input')({ target: { matches: () => false, closest: () => ({}) } });
  h.refresher.start(); h.refresher.request(); await h.refresher.tick();
  assert.equal(h.counts().refreshes, 2);
});
test('hidden or signed-out page makes no requests', async () => {
  const h = setup();
  h.doc.hidden = true; await h.refresher.tick();
  h.doc.hidden = false; h.enable(false); await h.refresher.tick();
  assert.equal(h.counts().reads, 0);
});
test('route change discards the previous page snapshots and pending refresh', async () => {
  const h = setup();
  h.block(true); h.data({ quotes: [] }); await h.refresher.tick();
  h.key('#/orders'); h.block(false); await h.refresher.tick();
  assert.equal(h.counts().refreshes, 0);
  h.refresher.observe('/quotes', { quotes: ['stale'] }, '#/quotes');
  await h.refresher.tick();
  assert.equal(h.counts().refreshes, 0);
});
test('successful local mutation or push requests a refresh without changing snapshots', async () => {
  const h = setup();
  h.refresher.request(); await h.refresher.tick();
  assert.equal(h.counts().refreshes, 1);
});

test('overlapping polls are skipped and a response from the logged-out session cannot refresh', async () => {
  let resolve: any, reads = 0, refreshes = 0;
  const doc = { hidden: false, addEventListener: () => {} }, win = { addEventListener: () => {} };
  const r = setupDataRefresh({
    read: () => { reads++; return new Promise(done => { resolve = done; }); },
    refresh: () => { refreshes++; }, enabled: () => true, blocked: () => false, routeKey: () => '#/quotes',
    primaryPaths: () => ['/quotes'], doc, win, schedule: () => 1, cancel: () => {},
  });
  r.observe('/quotes', { quotes: [1] }, '#/quotes');
  const pending = r.tick();
  await r.tick();
  assert.equal(reads, 1);
  r.stop();
  resolve({ quotes: [2] }); await pending;
  assert.equal(refreshes, 0);
});
