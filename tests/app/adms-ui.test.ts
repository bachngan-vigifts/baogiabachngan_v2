import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

// DOM tối thiểu: textContent giữ nguyên dữ liệu, gán innerHTML bị chặn để bắt lỗi chèn nội dung nguồn.
class Node {
  children: Node[] = []; textContent = ''; className = ''; value = ''; type = ''; open = false; disabled = false; style = {};
  events: Record<string, (...args: any[]) => unknown> = {};
  append(...nodes: Node[]) { this.children.push(...nodes); }
  replaceChildren(...nodes: Node[]) { this.children = nodes; }
  set innerHTML(_value: string) { throw new Error('Không được dựng HTML từ dữ liệu ADMS'); }
  addEventListener(name: string, fn: (...args: any[]) => unknown) { this.events[name] = fn; }
  setAttribute() {} showModal() { this.open = true; } remove() {} focus() {} reportValidity() { return true; }
}
function setup(api: (path: string, method?: string, body?: object) => Promise<unknown>) {
  const body = new Node();
  const context: any = { document: { body, createElement: () => new Node() }, URLSearchParams, Intl, Date, renderSynctimeWebhook: async () => {} };
  const source = readFileSync(new URL('../../trial-ui/adms.js', import.meta.url), 'utf8').replace(/^import .*;\n/gm, '').replace('export async function openAdms', 'globalThis.openAdms = async function');
  runInNewContext(source, context);
  return { body, open: () => context.openAdms({ api, toast() {} }, '2026-10') };
}
const flatten = (node: Node): Node[] => [node, ...node.children.flatMap(flatten)];

test('ADMS UI: missing config explains next step without trying sync or showing secret inputs', async () => {
  const paths: string[] = [], ui = setup(async path => { paths.push(path); return { configured: false }; });
  await ui.open();
  assert.deepEqual(paths, ['/hr/adms']);
  const nodes = flatten(ui.body);
  assert.ok(nodes.some(n => n.textContent.includes('Chưa cấu hình ADMS')));
  assert.ok(!nodes.some(n => n.textContent === 'Đồng bộ từ máy'));
});

test('ADMS UI: renders source names as text, loads range, provides sync and manual mapping', async () => {
  const paths: string[] = [];
  const ui = setup(async path => {
    paths.push(path);
    if (path === '/hr/adms') return { configured: true, companyId: 1, lastSync: null };
    if (path === '/hr/adms/mappings') return { mappings: [], members: [{ id: 'emp', name: 'NV', active: true }] };
    return { total: 1, logs: [{ empCode: '001', fullName: '<img src=x onerror=alert(1)>', checkTime: '2026-10-17 08:00:00', punchState: 255, deviceSerial: 'SN' }] };
  });
  await ui.open();
  assert.ok(paths.some(p => p.startsWith('/hr/adms/logs?from=2026-10-01')));
  const nodes = flatten(ui.body);
  assert.ok(nodes.some(n => n.textContent === '<img src=x onerror=alert(1)>'));
  assert.ok(nodes.some(n => n.textContent === 'Chưa ghép'));
  assert.ok(nodes.some(n => n.textContent === 'Chưa xác định'));
  assert.ok(nodes.some(n => n.textContent === 'Đồng bộ từ máy'));
  assert.ok(nodes.some(n => n.textContent === 'Lưu ghép mã'));
});
