import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

class Node {
  children: Node[] = []; textContent = ''; value = ''; hidden = false; disabled = false; style = {};
  events: Record<string, () => Promise<void>> = {};
  append(...children: Node[]) { this.children.push(...children); }
  replaceChildren(...children: Node[]) { this.children = children; }
  set innerHTML(_value: string) { throw new Error('Do not render source HTML'); }
  setAttribute() {} addEventListener(name: string, fn: () => Promise<void>) { this.events[name] = fn; }
}
const flatten = (n: Node): Node[] => [n, ...n.children.flatMap(flatten)];
test('SyncTime UI: gives real webhook URL, creates Header once on explicit click and displays source JSON as text', async () => {
  let configured = false; const header = 'Authorization: Bearer stwh_' + 'd'.repeat(64), host = new Node();
  const calls: string[] = [];
  const api = async (path: string, method = 'GET') => {
    calls.push(method + ' ' + path);
    if (path === '/hr/synctime') return { configured, total: configured ? 1 : 0, latestAt: null, path: '/integrations/synctime/webhook', latest: configured ? [{ id: 'a'.repeat(64), receivedAt: '2026-10-17T00:00:00Z' }] : [] };
    if (path === '/hr/synctime/key') { configured = true; return { header }; }
    return { payloadText: '{"note":"<img onerror=alert(1)>"}' };
  };
  const context: any = { document: { createElement: () => new Node(), querySelector: () => null }, Date, confirm: () => true };
  const source = readFileSync(new URL('../../trial-ui/synctime-webhook.js', import.meta.url), 'utf8').replace('export async function renderSynctimeWebhook', 'globalThis.render = async function');
  runInNewContext(source, context);
  await context.render(host, { api, toast: (msg: string) => { throw new Error(msg); } });
  assert.deepEqual(calls, ['GET /hr/synctime']);
  assert.ok(flatten(host).some(n => n.value === 'https://taceqfnsorewelsbdckg.supabase.co/functions/v1/baogia-v2-api/api/staff/integrations/synctime/webhook'));
  await flatten(host).find(n => n.textContent === 'Tạo mã kết nối')!.events.click!();
  assert.ok(calls.includes('POST /hr/synctime/key'));
  assert.ok(flatten(host).some(n => n.value === header && !n.hidden));
  await flatten(host).find(n => n.textContent.startsWith('Xem gói mẫu '))!.events.click!();
  assert.ok(flatten(host).some(n => n.textContent.includes('<img onerror=alert(1)>')));
});
