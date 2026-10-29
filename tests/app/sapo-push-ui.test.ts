import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

function setup(code = '', existingDocument = false, connected = true, viaClaw = false, preview: any = {}) {
  const events = new Map<string, Function>(), closeEvents = new Map<string, Function>();
  const radio = { value: 'yes', checked: true, addEventListener() {} };
  const no = { value: 'no', checked: !connected, addEventListener() {} };
  const body = { innerHTML: '', querySelector: (s: string) => s.includes('value="no"') ? no : no.checked ? no : radio, querySelectorAll: () => [radio, no] };
  const dialog = { open: false, showModal() { this.open = true; }, close() { this.open = false; closeEvents.get('close')?.(); }, addEventListener: (e: string, fn: Function) => closeEvents.set(e, fn) };
  const error = { textContent: '', children: [] as any[], append(...items: any[]) { this.children.push(...items); } };
  const submit = { disabled: true, textContent: '' }, label = { textContent: '' };
  const nodes: Record<string, any> = { '#sapo-push-dialog': dialog, '#sapo-push-body': body, '#sapo-push-submit': submit, '#sapo-push-title': {}, '#sapo-push-code': label, '#sapo-push-form': { addEventListener: (e: string, fn: Function) => events.set(e, fn) }, '#sapo-push-location': { value: viaClaw ? '' : '7', addEventListener() {} }, '#sapo-push-detail': {}, '#sapo-push-error': error };
  const context: any = { URLSearchParams, localStorage: { getItem: () => '', setItem() {} }, document: { createElement: () => ({ addEventListener() {} }) } };
  const source = readFileSync(new URL('../../trial-ui/sapo-push.js', import.meta.url), 'utf8');
  runInNewContext(source.replace('export function initSapoPush', 'globalThis.init = function'), context);
  let previews = 0;
  const ui = context.init({ api: async () => { previews++; return typeof preview === 'function' ? preview() : { connected, viaClaw, required: true, code, owner: 'NV', account: { name: 'NV' }, locations: connected && !viaClaw ? [{ id: 7, name: 'Kho' }] : [], problems: [], ...preview }; }, esc: (s: string) => s, $: (id: string) => nodes[id] });
  return { ui, no, existingDocument, dialog, body, submit, label, error, previews: () => previews, send: () => events.get('submit')!({ preventDefault() {} }) };
}

test('popup production dùng n8n/Claw, không bắt chọn kho Sapo', async () => {
  const s = setup('', false, true, true); let args: unknown[] = [];
  const pending = s.ui.choose({ quoteId: 'q' }, { title: 'Sinh đơn hàng', action: 'Tạo', run: async (...a: unknown[]) => { args = a; return {}; } });
  await new Promise(resolve => setImmediate(resolve));
  assert.match(s.body.innerHTML, /n8n → Claw/);
  assert.doesNotMatch(s.body.innerHTML, /<select id="sapo-push-location"/);
  assert.match(s.body.innerHTML, /Kho xuất hàng do luồng n8n\/Claw xử lý/);
  assert.equal(s.submit.disabled, false);
  await s.send(); await pending;
  assert.deepEqual(args, [null, true]);
});

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


test('phiên Sapo hỏng trên đơn đã có: nút giữ chứng từ, không báo sinh đơn mới; chặn gửi đẩy', async () => {
  const s = setup('DH_20261013_004', true, false);
  let called = 0;
  const pending = s.ui.choose({ orderId: 'o' }, { title: 'Tạo đơn Sapo', action: 'Tạo đơn nháp Sapo', existingDocument: true,
    run: async () => { called++; return {}; } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(s.submit.textContent, 'Giữ chứng từ trên web');
  assert.match(s.body.innerHTML, /Chứng từ trên CRM được giữ nguyên/);
  assert.doesNotMatch(s.body.innerHTML, /sẽ chỉ sinh trên web/);
  s.no.checked = false;
  await s.send(); assert.equal(called, 0);
  s.dialog.close(); await pending;
});

for(const title of ['Sinh đơn hàng','Lập HĐKT'])test(`${title}: lựa chọn có trên form gửi n8n một lần, không mở popup hỏi lại`,async()=>{
 const s=setup('',false,true,true);const posts:any[]=[];
 const r=await s.ui.choose({quoteId:'q'},{title,action:title,pushSapo:true,run:async(...args:any[])=>{posts.push(args);return {id:'created'};}});
 assert.equal(r.id,'created');assert.equal(s.dialog.open,false);assert.equal(s.body.innerHTML,'');assert.equal(s.previews(),1);assert.deepEqual(posts,[[null,true]]);
});
test('form chọn không: không xem trước hay kết nối Sapo; callback nhận false',async()=>{
 const s=setup('',false,false);const posts:any[]=[];
 await s.ui.choose({quoteId:'q'},{title:'Lập HĐKT',action:'Lập',pushSapo:false,run:async(...args:any[])=>{posts.push(args);return {};}});
 assert.equal(s.previews(),0);assert.equal(s.dialog.open,false);assert.deepEqual(posts,[[null,false]]);
});
test('form đã chọn có: lỗi kiểm tra không tự đổi sang không hoặc tạo chứng từ',async()=>{
 const s=setup('',false,false);let posts=0;
 await assert.rejects(()=>s.ui.choose({quoteId:'q'},{title:'Sinh đơn hàng',action:'Sinh',pushSapo:true,run:async()=>{posts++;}}),/Chưa kết nối Sapo/);
 assert.equal(posts,0);assert.equal(s.dialog.open,false);
 const bad=setup('',false,true,true,{problems:['Thiếu mã sản phẩm']});
 await assert.rejects(()=>bad.ui.choose({quoteId:'q'},{title:'Sinh đơn hàng',action:'Sinh',pushSapo:true,run:async()=>{posts++;}}),/Thiếu mã sản phẩm/);assert.equal(posts,0);
});
test('đóng form khi kiểm tra n8n đang chờ không sinh chứng từ sau đó',async()=>{
 let resolve:any,current=true,posts=0;const s=setup('',false,true,true,()=>new Promise(r=>{resolve=r;}));
 const pending=s.ui.choose({quoteId:'q'},{title:'Sinh đơn hàng',action:'Sinh',pushSapo:true,isCurrent:()=>current,run:async()=>{posts++;}});
 current=false;resolve({connected:true,viaClaw:true,required:true,problems:[],locations:[]});assert.equal(await pending,null);assert.equal(posts,0);assert.equal(s.dialog.open,false);
});
test('Sapo trực tiếp vẫn chọn kho nhưng không hỏi lại có tạo đơn Sapo',async()=>{
 const s=setup();const posts:any[]=[];
 const pending=s.ui.choose({quoteId:'q'},{title:'Sinh đơn hàng',action:'Sinh',pushSapo:true,run:async(...args:any[])=>{posts.push(args);return {};}});await new Promise(r=>setImmediate(r));
 assert.equal(s.dialog.open,true);assert.doesNotMatch(s.body.innerHTML,/Tạo đơn trên Sapo\?/);assert.match(s.body.innerHTML,/Kho xuất hàng trên Sapo/);await s.send();await pending;assert.deepEqual(posts,[[7,true]]);assert.equal(s.previews(),1);
});
