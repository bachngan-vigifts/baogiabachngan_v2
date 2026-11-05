import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createTestDb } from '../helpers/postgres.ts';
import { seedStaff, PASSWORD } from '../helpers/staff-fixture.ts';
import { createAppRouter } from '../../src/app/router.ts';
import { memoryFileStore } from '../../src/core/storage/file-store.ts';

/** Góp ý phát triển phần mềm: gửi (chống trùng, giới hạn, ảnh), công khai / riêng tư, +1, trao đổi, xử lý, gộp trùng, thông báo, quyền. */
async function fixture() {
  const { db, d1, client } = await createTestDb() as any; await seedStaff(d1);
  // Nhân viên thứ hai (cùng mật khẩu) để kiểm tra phạm vi xem / +1.
  await client.query("insert into staff_members (id,email,name,phone,role,position_id,active,created_at) select 'emp2','emp2@x.vn','Tên emp2',phone,role,position_id,true,created_at from staff_members where id='emp'");
  await client.query("insert into staff_credentials (member_id,password_hash,version) select 'emp2',password_hash,0 from staff_credentials where member_id='emp'");
  const router = createAppRouter(), files = memoryFileStore();
  const call = async (path: string, cookie = '', method = 'GET', body?: unknown) => {
    const login = method === 'POST' && path === '/login';
    const r = await router.handle(new Request('https://trial.test/api/staff' + path, { method, headers: { origin: 'https://trial.test', 'content-type': 'application/json', cookie: login ? '' : cookie },
      body: login ? JSON.stringify({ email: cookie, password: PASSWORD }) : body === undefined ? undefined : JSON.stringify(body) }), { db, files, passwordIterations: 1000 } as any);
    return { status: r.status, data: await r.json() as any, cookie: r.headers.get('set-cookie')?.split(';')[0] ?? '' };
  };
  const [mgr, emp, emp2, ncc] = await Promise.all(['mgr', 'emp', 'emp2', 'ncc'].map(async u => (await call('/login', u + '@x.vn', 'POST')).cookie)) as [string, string, string, string];
  const send = (who: string, extra: Record<string, unknown> = {}) => call('/feedback', who, 'POST', { clientKey: crypto.randomUUID(), kind: 'bug', impact: 'medium',
    title: 'Không lưu được báo giá', description: 'Bấm Lưu báo giá thì quay vòng mãi không xong.', steps: '1. Mở báo giá\n2. Bấm Lưu', pageUrl: '#/quotes/q1', clientInfo: 'Chrome 130 · 390x844 · v1', ...extra });
  const notes = async () => (await client.query("select event_type, target_member_id from staff_web_notifications where event_type like 'software_feedback%' order by created_at")).rows;
  return { db, client, files, call, send, mgr, emp, emp2, ncc, notes };
}
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

test('gửi góp ý: mã GY tăng dần, kèm trang + thông tin máy + ảnh; gửi lặp cùng mã không tạo bản thứ hai; khác nội dung → 409; báo người xử lý',async()=>{
 const f=await fixture(),key=crypto.randomUUID();
 const a=await f.send(f.emp,{clientKey:key,photos:[PNG]});assert.equal(a.status,201,JSON.stringify(a.data));assert.equal(a.data.code,'GY-0001');
 const again=await f.send(f.emp,{clientKey:key,photos:[PNG]});assert.equal(again.status,200);assert.equal(again.data.id,a.data.id);assert.equal(again.data.replayed,true);
 assert.equal((await f.send(f.emp,{clientKey:key,title:'Nội dung khác hẳn'})).status,409);
 assert.equal((await f.send(f.emp2)).data.code,'GY-0002');
 const d=(await f.call('/feedback/'+a.data.id,f.emp)).data;
 assert.equal(d.pageUrl,'#/quotes/q1');assert.equal(d.clientInfo,'Chrome 130 · 390x844 · v1');assert.equal(d.photos.length,1);assert.equal(d.status,'new');assert.equal(d.authorName,'Tên emp');
 assert.equal(d.clientKey,undefined);assert.equal(d.payloadHash,undefined);
 assert.equal((await f.client.query('select count(*)::int n from software_feedback_photos')).rows[0].n,1);
 assert.ok((await f.notes()).some((n:any)=>n.event_type==='software_feedback_new'&&n.target_member_id==='mgr'));
});

test('kiểm tra đầu vào, giới hạn gửi, ảnh; NCC không vào được',async()=>{
 const f=await fixture();
 assert.equal((await f.send(f.emp,{title:'Lỗi'})).status,400);
 assert.equal((await f.send(f.emp,{description:'ngắn'})).status,400);
 assert.equal((await f.send(f.emp,{kind:'khac'})).status,400);
 assert.equal((await f.send(f.emp,{clientKey:'x'})).status,400);
 assert.equal((await f.send(f.emp,{photos:[PNG,PNG,PNG,PNG]})).status,400);
 assert.equal((await f.send(f.emp,{photos:['data:text/html;base64,PHNjcmlwdD4=']})).status,400);
 assert.equal((await f.send(f.ncc)).status,403);assert.equal((await f.call('/feedback',f.ncc)).status,403);
 assert.equal((await f.call('/feedback','')).status,401);
 for(let i=0;i<10;i++)assert.equal((await f.send(f.emp2)).status,201);
 const limited=await f.send(f.emp2);assert.equal(limited.status,429);assert.match(limited.data.error,/tối đa 10/);
});

test('công khai: mọi nhân viên xem và +1 (mỗi người một lượt); riêng tư: chỉ người gửi và người xử lý',async()=>{
 const f=await fixture();
 const pub=(await f.send(f.emp)).data,priv=(await f.send(f.emp,{visibility:'private',title:'Góp ý riêng về lương'})).data;
 const list2=(await f.call('/feedback',f.emp2)).data;assert.deepEqual(list2.items.map((i:any)=>i.id),[pub.id]);
 assert.equal((await f.call('/feedback/'+priv.id,f.emp2)).status,404);
 assert.equal((await f.call('/feedback/'+priv.id+'/vote',f.emp2,'POST',{})).status,404);
 assert.equal((await f.call('/feedback',f.mgr)).data.items.length,2);
 assert.equal((await f.call('/feedback?mine=1',f.emp)).data.items.length,2);
 for(let i=0;i<2;i++)assert.equal((await f.call('/feedback/'+pub.id+'/vote',f.emp2,'POST',{})).data.votes,1,'bấm lại không cộng thêm');
 assert.equal((await f.call('/feedback/'+pub.id+'/vote',f.mgr,'POST',{})).data.votes,2);
 const top=(await f.call('/feedback',f.emp2)).data.items[0];assert.equal(top.votes,2);assert.equal(top.voted,true);
 assert.equal((await f.call('/feedback/'+pub.id+'/vote',f.emp2,'POST',{on:false})).data.votes,1);
 assert.equal((await f.call('/feedback?q=GY-0001',f.mgr)).data.items[0].id,pub.id);
});

test('trao đổi: người gửi và người xử lý; người khác chỉ +1; báo đúng người',async()=>{
 const f=await fixture(),{id}=(await f.send(f.emp)).data;
 assert.equal((await f.call(`/feedback/${id}/comments`,f.emp2,'POST',{body:'Mình cũng bị'})).status,403);
 assert.equal((await f.call(`/feedback/${id}/comments`,f.mgr,'POST',{body:'Bạn dùng máy nào?'})).status,201);
 assert.equal((await f.call(`/feedback/${id}/comments`,f.emp,'POST',{body:'Điện thoại Android'})).status,201);
 const d=(await f.call('/feedback/'+id,f.emp)).data;assert.deepEqual(d.comments.map((c:any)=>c.body),['Bạn dùng máy nào?','Điện thoại Android']);
 const n=await f.notes();assert.ok(n.some((x:any)=>x.event_type==='software_feedback_comment'&&x.target_member_id==='emp'));assert.ok(n.some((x:any)=>x.event_type==='software_feedback_comment'&&x.target_member_id==='mgr'));
});

test('xử lý: chỉ người có quyền; "Không làm" bắt buộc lý do; gộp trùng theo mã GY; lịch sử trạng thái; báo người gửi; đã đóng không nhận +1',async()=>{
 const f=await fixture(),a=(await f.send(f.emp)).data,b=(await f.send(f.emp2,{title:'Lưu báo giá bị treo'})).data;
 assert.equal((await f.call(`/feedback/${a.id}/triage`,f.emp,'POST',{status:'planned'})).status,403);
 assert.equal((await f.call(`/feedback/${a.id}/triage`,f.mgr,'POST',{status:'wont_do'})).status,400);
 const t=await f.call(`/feedback/${a.id}/triage`,f.mgr,'POST',{status:'planned',priority:'high',reason:'Làm trong tuần sau'});assert.equal(t.status,200);
 assert.equal((await f.call(`/feedback/${b.id}/triage`,f.mgr,'POST',{status:'duplicate',duplicateOf:'GY-0002'})).status,400,'không gộp vào chính nó');
 assert.equal((await f.call(`/feedback/${b.id}/triage`,f.mgr,'POST',{status:'duplicate',duplicateOf:'GY-0001'})).status,200);
 const db=(await f.call('/feedback/'+b.id,f.emp2)).data;assert.equal(db.status,'duplicate');assert.equal(db.duplicateOfItem.code,'GY-0001');
 assert.match(db.comments.at(-1).body,/Gộp vào GY-0001/);
 const da=(await f.call('/feedback/'+a.id,f.emp)).data;assert.equal(da.priority,'high');assert.match(da.comments[0].body,/Mới → Đã lên kế hoạch[\s\S]*Ưu tiên: chưa đặt → Cao[\s\S]*Làm trong tuần sau/);
 assert.ok((await f.notes()).some((x:any)=>x.event_type==='software_feedback_status'&&x.target_member_id==='emp'));
 assert.equal((await f.call(`/feedback/${b.id}/vote`,f.emp,'POST',{})).status,409);
 assert.equal((await f.call('/feedback?status=closed',f.mgr)).data.items.length,1);assert.equal((await f.call('/feedback',f.mgr)).data.counts.planned,1);
});

test('quyền "Quản lý góp ý" cấp cho chức vụ: xem góp ý riêng tư, xử lý, nhận thông báo góp ý mới',async()=>{
 const f=await fixture();await f.client.query("insert into staff_position_permissions(position_id,permission) values('sale','feedback.manage')");
 const priv=(await f.send(f.emp,{visibility:'private'})).data;
 assert.equal((await f.call('/feedback/'+priv.id,f.emp2)).status,200);
 assert.equal((await f.call(`/feedback/${priv.id}/triage`,f.emp2,'POST',{status:'reviewing'})).status,200);
 assert.ok((await f.notes()).some((x:any)=>x.event_type==='software_feedback_new'&&x.target_member_id==='emp2'));
});

test('cổng triển khai: báo lỗi khi chưa chạy migration góp ý',async()=>{
 const {client}=await createTestDb(),gate=readFileSync('scripts/sql/assert-software-feedback.sql','utf8');
 await client.exec(gate);await client.exec('DROP TABLE software_feedback_votes;');
 await assert.rejects(()=>client.exec(gate),/20261105060000_software_feedback/);
});

test('trang đang dùng chỉ nhận đường dẫn trong ứng dụng (#/…), bỏ link ngoài / javascript:',async()=>{
 const f=await fixture();
 for(const bad of ['javascript:alert(1)','https://evil.example/','#/x" onmouseover="alert(1)']){const r=await f.send(f.emp,{pageUrl:bad});assert.equal(r.status,201);assert.equal((await f.call('/feedback/'+r.data.id,f.emp)).data.pageUrl,'',bad);}
 const ok=await f.send(f.emp,{pageUrl:'#/orders/abc?tab=1'});assert.equal((await f.call('/feedback/'+ok.data.id,f.emp)).data.pageUrl,'#/orders/abc?tab=1');
});
