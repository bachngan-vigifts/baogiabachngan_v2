import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

function setup(code = '', existingDocument = false) {
  const events = new Map<string, Function>(), closeEvents = new Map<string, Function>();
  const radio = { value: 'yes', checked: true, addEventListener() {} };
  const no = { value: 'no', checked: false, addEventListener() {} };
  const body = { innerHTML: '', querySelector: (s: string) => s.includes('value="no"') ? no : no.checked ? no : radio, querySelectorAll: () => [radio, no] };
  const dialog = { open: false, showModal() { this.open = true; }, close() { this.open = false; closeEvents.get('close')?.(); }, addEventListener: (e: string, fn: Function) => closeEvents.set(e, fn) };
  const error = { textContent: '', children: [] as any[], append(...items: any[]) { this.children.push(...items); } };
  const submit = { disabled: true, textContent: '' }, label = { textContent: '' };
  const nodes: Record<string, any> = { '#sapo-push-dialog': dialog, '#sapo-push-body': body, '#sapo-push-submit': submit, '#sapo-push-title': {}, '#sapo-push-code': label, '#sapo-push-form': { addEventListener: (e: string, fn: Function) => events.set(e, fn) }, '#sapo-push-location': { value: '7', addEventListener() {} }, '#sapo-push-detail': {}, '#sapo-push-error': error };
  const context: any = { URLSearchParams, localStorage: { getItem: () => '', setItem() {} }, document: { createElement: () => ({ addEventListener() {} }) } };
  const source = readFileSync(new URL('../../trial-ui/sapo-push.js', import.meta.url), 'utf8');
  runInNewContext(source.replace('export function initSapoPush', 'globalThis.init = function'), context);
  const ui = context.init({ api: async () => ({ connected: true, required: true, code, owner: 'NV', account: { name: 'NV' }, locations: [{ id: 7, name: 'Kho' }], problems: [] }), esc: (s: string) => s, $: (id: string) => nodes[id] });
  return { ui, existingDocument, dialog, body, submit, label, error, send: () => events.get('submit')!({ preventDefault() {} }) };
}

test('popup Sapo: chưa sinh chứng từ thì không hiện số báo giá làm mã đơn', async () => {
  const s = setup(); const pending = s.ui.choose({ quoteId: 'q' }, { title: 'Sinh đơn hàng', action: 'Tạo', run() {} });
  await new Promise(resolve => setImmediate(resolve));
  assert.match(s.label.textContent, /Số đơn \/ HĐKT sẽ được cấp/);
  assert.match(s.body.innerHTML, /Sẽ dùng số đơn hàng \/ HĐKT mới sinh/);
  assert.doesNotMatch(s.body.innerHTML, /\(số báo giá\)/);
  s.dialog.close(); await pending;
});

test('Sapo từ chối: hiện nút sinh không qua Sapo và mở lại submit thay vì ReferenceError/kẹt busy', async () => {
  const s = setup('DH_20261012_002');
  const pending = s.ui.choose({ orderId: 'o' }, { title: 'Sinh đơn hàng', action: 'Tạo', run: async () => { throw new Error('SAPO_HTTP_422'); } });
  await new Promise(resolve => setImmediate(resolve));
  await s.send();
  assert.match(s.error.textContent, /SAPO_HTTP_422/);
  assert.equal(s.error.children[1].textContent, 'Sinh đơn hàng không qua Sapo');
  assert.equal(s.submit.disabled, false); assert.equal(s.submit.textContent, 'Tạo');
  assert.equal(s.dialog.open, true);
  s.dialog.close(); await pending;
});


test('lỗi đẩy sau không thông báo nhầm rằng chưa sinh chứng từ CRM', async () => {
  const s = setup('DH_20261012_002', true);
  const pending = s.ui.choose({ orderId: 'o' }, { title: 'Tạo đơn Sapo', action: 'Tạo', existingDocument: true, run: async () => { throw new Error('Sapo từ chối'); } });
  await new Promise(resolve => setImmediate(resolve)); await s.send();
  assert.match(s.error.textContent, /Chứng từ trên CRM được giữ nguyên/);
  assert.doesNotMatch(s.error.textContent, /Chưa sinh đơn/);
  assert.equal(s.error.children[1].textContent, 'Giữ chứng từ trên web');
  assert.match(s.body.innerHTML, /Không – giữ chứng từ trên web/);
  s.dialog.close(); await pending;
});
