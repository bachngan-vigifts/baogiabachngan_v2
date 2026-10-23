import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
const source = readFileSync(new URL('../../trial-ui/register.js', import.meta.url), 'utf8');
async function setup(fail = '') {
  const nodes: Record<string, any> = {};
  const node = (key: string): any => nodes[key] ||= { value: '', hidden: key === '#registration-form' || key === '#registration-login', disabled: false, textContent: '' };
  const form = node('#registration-form'); form.elements = Object.fromEntries(['name','email','phone','password','password2'].map(k => [k, { value: '', type: '', required: false }]));
  form.reset = () => Object.values(form.elements).forEach((n: any) => n.value = '');
  const token = 'a'.repeat(64) + '.supplier.ncc1', calls: {path:string; body:any}[] = [];
  const location = { pathname: '/register.html', search: '', hash: '#invite=' + encodeURIComponent(token) };
  const context = { URLSearchParams, document: { querySelector: (s:string) => s.startsWith('meta') ? null : node(s) }, location,
    history: { replaceState() { location.hash = ''; } }, fetch: async (url: string, options:any) => {
      const path = new URL(url).pathname.split('/').at(-1)!; calls.push({ path, body: JSON.parse(options.body) });
      if (fail === path) return { ok: false, json: async () => ({ error: 'Link hết hạn hoặc lỗi mạng' }) };
      return { ok: true, json: async () => path === 'registration-info' ? { kind: 'supplier', entityName: '<b>NCC cố định</b>', expiresAt: Date.now()+100000 } : { login: 'supplier@x.vn', portal: '/supplier.html' } };
    } };
  await runInNewContext('(async()=>{' + source + '})()', context);
  return { form, node, calls, location, token };
}
test('form đăng ký hiển thị đúng hồ sơ bằng text, bỏ token khỏi URL, không có bộ chọn hồ sơ/quyền', async () => {
  const s=await setup(); assert.equal(s.location.hash,''); assert.equal(s.form.hidden,false);
  assert.equal(s.node('#registration-entity').textContent,'Nhà cung cấp: <b>NCC cố định</b>');
  assert.equal(s.form.elements.email.required,true); assert.equal(s.calls[0]!.body.token,s.token);
  assert.equal(s.form.elements.supplierId,undefined); assert.equal(s.form.elements.role,undefined);
});
test('mật khẩu không khớp không gửi; đăng ký xong xoá mật khẩu và chuyển đúng trang NCC', async () => {
  const s=await setup(); s.form.elements.password.value='password123'; s.form.elements.password2.value='different';
  await s.form.onsubmit({preventDefault(){}}); assert.equal(s.calls.length,1);
  s.form.elements.password2.value='password123'; s.form.elements.email.value='supplier@x.vn';
  await s.form.onsubmit({preventDefault(){}}); assert.equal(s.calls[1]!.body.token,s.token);
  assert.equal(s.form.hidden,true); assert.equal(s.form.elements.password.value,'');
  assert.equal(s.node('#registration-login').href,'supplier.html'); assert.equal(s.node('#registration-login').hidden,false);
});
test('link vô hiệu không cho đăng ký; lỗi gửi giữ form và token trong bộ nhớ để thử lại', async () => {
  const bad=await setup('registration-info'); assert.equal(bad.form.hidden,true); assert.match(bad.node('#registration-error').textContent,/Link hết hạn/);
  const s=await setup('register-partner'); s.form.elements.password.value=s.form.elements.password2.value='password123';
  await s.form.onsubmit({preventDefault(){}}); await s.form.onsubmit({preventDefault(){}});
  assert.equal(s.form.hidden,false); assert.equal(s.node('#registration-submit').disabled,false);
  assert.equal(s.calls[2]!.body.token,s.token); assert.match(s.node('#registration-error').textContent,/lỗi mạng/);
});
