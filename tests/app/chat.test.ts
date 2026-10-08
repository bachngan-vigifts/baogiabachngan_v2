import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from '../helpers/postgres.ts';
import { seedStaff, PASSWORD } from '../helpers/staff-fixture.ts';
import { createAppRouter } from '../../src/app/router.ts';
import { directKey } from '../../src/modules/chat/domain/chat-config.ts';
import { memoryFileStore } from '../../src/core/storage/file-store.ts';
import { chatMessages } from '../../src/modules/chat/schema.ts';
import { eq } from 'drizzle-orm';

const origin = 'https://trial.test';
async function setup() {
  const { db, d1 } = await createTestDb(); await seedStaff(d1);
  const router = createAppRouter(), files = memoryFileStore();
  const call = async (path: string, cookie = '', method = 'GET', body?: object) => {
    const res = await router.handle(new Request(origin + '/api/staff' + path, { method, headers: { origin, 'content-type': 'application/json', cookie }, body: body ? JSON.stringify(body) : undefined }), { db, files, passwordIterations: 1000 });
    return { status: res.status, data: await res.json() as any, cookie: res.headers.get('set-cookie')?.split(';')[0] ?? '' };
  };
  const login = async (email: string) => (await call('/login', '', 'POST', { email, password: PASSWORD })).cookie;
  return { db, files, call, emp: await login('emp@x.vn'), mgr: await login('mgr@x.vn'), ncc: await login('ncc@x.vn') };
}

test('khoá hội thoại 1-1 không phụ thuộc thứ tự', () => assert.equal(directKey('b', 'a'), directKey('a', 'b')));

test('chat nội bộ: 1-1, nhóm, chưa đọc, đã xem, chỉ thành viên đọc được, NCC không vào', async () => {
  const { call, emp, mgr, ncc } = await setup();
  const people = (await call('/chat/people', emp)).data.people;
  assert.ok(people.some((p: any) => p.id === 'mgr') && !people.some((p: any) => p.id === 'emp' || p.id === 'ncc'), 'danh bạ: không có mình, không có NCC');
  assert.equal((await call('/chat/people', ncc)).status, 403);
  assert.equal((await call('/chat/direct', emp, 'POST', { memberId: 'ncc' })).status, 400);
  const d = await call('/chat/direct', emp, 'POST', { memberId: 'mgr' });
  assert.equal((await call('/chat/direct', mgr, 'POST', { memberId: 'emp' })).data.id, d.data.id, 'một cặp chỉ một hội thoại');
  assert.equal((await call(`/chat/${d.data.id}/messages`, emp, 'POST', { body: '  ' })).status, 400);
  const m1 = await call(`/chat/${d.data.id}/messages`, emp, 'POST', { body: 'Anh ơi đơn Hoàng Long giao chiều nay nhé' });
  assert.equal(m1.status, 201);
  await call(`/chat/${d.data.id}/messages`, emp, 'POST', { body: 'Kho đã đóng hàng' });
  // Manager: 2 tin chưa đọc; tin chat không vào chuông thông báo.
  assert.equal((await call('/chat/unread', mgr)).data.unread, 2);
  assert.equal((await call('/notifications', mgr)).data.notifications.some((n: any) => n.eventType === 'chat_message'), false);
  let list = (await call('/chat/conversations', mgr)).data.conversations;
  assert.deepEqual([list[0].kind, list[0].title, list[0].unread, list[0].last.body], ['direct', 'Tên emp', 2, 'Kho đã đóng hàng']);
  const msgs = (await call(`/chat/${d.data.id}/messages`, mgr)).data;
  assert.deepEqual(msgs.messages.map((x: any) => x.body), ['Anh ơi đơn Hoàng Long giao chiều nay nhé', 'Kho đã đóng hàng']);
  assert.equal((await call(`/chat/${d.data.id}/messages?after=${encodeURIComponent(m1.data.createdAt)}`, mgr)).data.messages.length, 1);
  await call(`/chat/${d.data.id}/read`, mgr, 'POST', {});
  assert.equal((await call('/chat/unread', mgr)).data.unread, 0);
  assert.ok((await call(`/chat/${d.data.id}/messages`, emp)).data.reads[0].lastReadAt, 'người gửi thấy "Đã xem"');
  // Nhóm: người ngoài không đọc được; chỉ người tạo / Manager sửa nhóm; rời nhóm.
  assert.equal((await call('/chat/groups', emp, 'POST', { title: '', memberIds: ['mgr'] })).status, 400);
  assert.equal((await call('/chat/groups', emp, 'POST', { title: 'Kho', memberIds: [] })).status, 400);
  const g = await call('/chat/groups', mgr, 'POST', { title: 'Đơn Tết 2027', memberIds: ['emp', 'ncc'] });
  assert.equal(g.status, 201);
  const conv = (await call('/chat/' + g.data.id, emp)).data.conversation;
  assert.deepEqual([conv.kind, conv.title, conv.members.map((x: any) => x.id).sort()], ['group', 'Đơn Tết 2027', ['emp', 'mgr']], 'NCC không được thêm vào nhóm');
  await call(`/chat/${g.data.id}/messages`, emp, 'POST', { body: 'Em nhận phần in logo' });
  assert.equal((await call('/chat/unread', mgr)).data.unread, 1);
  assert.equal((await call(`/chat/groups/${g.data.id}`, emp, 'PUT', { title: 'Đổi' })).status, 403);
  assert.equal((await call(`/chat/groups/${g.data.id}`, mgr, 'PUT', { title: 'Đơn Tết' })).status, 200);
  assert.equal((await call(`/chat/${g.data.id}/leave`, emp, 'POST', {})).status, 200);
  assert.equal((await call(`/chat/${g.data.id}/messages`, emp)).status, 404, 'rời nhóm thì không đọc được nữa');
  assert.equal((await call(`/chat/${d.data.id}/leave`, emp, 'POST', {})).status, 400);
  list = (await call('/chat/conversations', mgr)).data.conversations;
  assert.equal(list[0].title, 'Đơn Tết'); assert.match(list[0].last.body, /rời nhóm/);
});

test('chat: mở hội thoại một lượt gọi (full=1&read=1), Web Push chạy nền qua waitUntil', async () => {
  const { db, d1 } = await createTestDb(); await seedStaff(d1);
  const router = createAppRouter(), background: Promise<unknown>[] = [];
  const call = async (path: string, cookie = '', method = 'GET', body?: object) => {
    const res = await router.handle(new Request(origin + '/api/staff' + path, { method, headers: { origin, 'content-type': 'application/json', cookie }, body: body ? JSON.stringify(body) : undefined }),
      { db, passwordIterations: 1000, waitUntil: p => { background.push(p); } });
    return { status: res.status, data: await res.json() as any, cookie: res.headers.get('set-cookie')?.split(';')[0] ?? '' };
  };
  const login = async (email: string) => (await call('/login', '', 'POST', { email, password: PASSWORD })).cookie;
  const emp = await login('emp@x.vn'), mgr = await login('mgr@x.vn');
  const d = await call('/chat/direct', emp, 'POST', { memberId: 'mgr' });
  assert.equal((await call(`/chat/${d.data.id}/messages`, emp, 'POST', { body: 'Có hàng chưa anh?' })).status, 201);
  assert.equal(background.length, 1, 'gửi push không chặn phản hồi'); await Promise.all(background);
  assert.equal((await call('/chat/unread', mgr)).data.unread, 1);
  const opened = (await call(`/chat/${d.data.id}/messages?full=1&read=1`, mgr)).data;
  assert.equal(opened.conversation.id, d.data.id); assert.equal(opened.conversation.title, 'Tên emp'); assert.equal(opened.messages.length, 1);
  assert.equal((await call('/chat/unread', mgr)).data.unread, 0, 'read=1 đánh dấu đã đọc');
  assert.equal((await call(`/chat/${d.data.id}/messages`, mgr)).data.conversation, undefined, 'không full thì không kèm hội thoại');
  const again = (await call('/chat/direct', mgr, 'POST', { memberId: 'emp' })).data;
  assert.equal(again.id, d.data.id); assert.equal(again.conversation.title, 'Tên emp'); assert.equal(again.messages.length, 1, '/chat/direct trả luôn tin nhắn để mở khung chat một lượt');
});

test('chat: gửi file (bucket private, link có hạn), liên kết nhanh, thu hồi trong 4 giờ, tìm tin cũ theo chữ / ngày, nhảy tới tin cũ', async () => {
  const { db, files, call, emp, mgr } = await setup();
  const conv = (await call('/chat/direct', emp, 'POST', { memberId: 'mgr' })).data.id;
  const pdf = Buffer.from('%PDF-1.4 bao gia').toString('base64');
  // File: loại theo đuôi, tối đa 3 file, ≤ 6 MB.
  assert.equal((await call(`/chat/${conv}/messages`, emp, 'POST', { files: [{ name: 'virus.exe', data: pdf }] })).status, 400);
  assert.equal((await call(`/chat/${conv}/messages`, emp, 'POST', { files: [1, 2, 3, 4].map(i => ({ name: `a${i}.pdf`, data: pdf })) })).status, 400);
  const f = await call(`/chat/${conv}/messages`, emp, 'POST', { body: 'Gửi anh báo giá', files: [{ name: 'Báo giá Hoàng Long.pdf', data: pdf }] });
  assert.equal(f.status, 201); assert.equal(files.files.size, 1);
  assert.match([...files.files.keys()][0]!, new RegExp(`^chat/${conv}/${f.data.id}/[\\w-]+\\.pdf$`));
  // Liên kết nhanh (đơn hàng / HĐKT / báo giá / phiếu đóng gói / việc).
  assert.equal((await call(`/chat/${conv}/messages`, emp, 'POST', { ref: { type: 'hack', id: 'x', label: 'y' } })).status, 400);
  await call(`/chat/${conv}/messages`, emp, 'POST', { ref: { type: 'order', id: 'abc-123', label: 'Đơn DH_20261008_001 · Hoàng Long' } });
  let t = (await call(`/chat/${conv}/messages`, mgr)).data;
  assert.equal(t.messages[0].files[0].name, 'Báo giá Hoàng Long.pdf'); assert.match(t.messages[0].files[0].url, /^data:application\/pdf;base64,/);
  assert.deepEqual(t.messages[1].ref, { type: 'order', id: 'abc-123', label: 'Đơn DH_20261008_001 · Hoàng Long' });
  assert.equal((await call('/chat/conversations', mgr)).data.conversations[0].last.body, '🔗 Đơn DH_20261008_001 · Hoàng Long');
  assert.deepEqual([t.messages[0].canRecall, (await call(`/chat/${conv}/messages`, emp)).data.messages[0].canRecall], [false, true], 'chỉ người gửi thấy nút thu hồi');
  // Thu hồi: chỉ người gửi, trong 4 giờ; file bị xoá khỏi kho; người khác thấy "đã thu hồi" và nhận id qua recalledSince.
  const since = t.now;
  assert.equal((await call(`/chat/${conv}/messages/${f.data.id}/recall`, mgr, 'POST', {})).status, 403);
  assert.equal((await call(`/chat/${conv}/messages/${f.data.id}/recall`, emp, 'POST', {})).status, 200);
  assert.equal(files.files.size, 0);
  t = (await call(`/chat/${conv}/messages?recalledSince=${encodeURIComponent(since)}&after=${encodeURIComponent(new Date().toISOString())}`, mgr)).data;
  assert.deepEqual(t.recalledIds, [f.data.id]);
  const all = (await call(`/chat/${conv}/messages`, mgr)).data.messages;
  assert.deepEqual([all[0].recalled, all[0].body, all[0].files.length], [true, '', 0]);
  const old = await call(`/chat/${conv}/messages`, emp, 'POST', { body: 'Tin cũ' });
  await db.update(chatMessages).set({ createdAt: new Date(Date.now() - 5 * 3600_000).toISOString() }).where(eq(chatMessages.id, old.data.id));
  assert.equal((await call(`/chat/${conv}/messages/${old.data.id}/recall`, emp, 'POST', {})).data.code, 'RECALL_EXPIRED');
  // Tìm tin cũ: không dấu, theo ngày (giờ VN), bỏ tin đã thu hồi, chỉ hội thoại của mình.
  await call(`/chat/${conv}/messages`, mgr, 'POST', { body: 'Kho đã đóng hàng đơn Hoàng Long' });
  assert.deepEqual((await call('/chat/search?q=hoang long', emp)).data.results.map((r: any) => r.body), ['Kho đã đóng hàng đơn Hoàng Long', '🔗 Đơn DH_20261008_001 · Hoàng Long']);
  assert.equal((await call('/chat/search', emp)).status, 400);
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date());
  assert.equal((await call(`/chat/search?from=${today}&to=${today}&q=bao gia`, emp)).data.results.length, 0, 'tin "Gửi anh báo giá" đã thu hồi');
  assert.equal((await call('/chat/search?q=hoang', 'x')).status, 401);
  // Nhảy tới tin cũ: tin quanh mốc thời gian.
  const hit = (await call('/chat/search?q=tin cu', emp)).data.results[0];
  const around = (await call(`/chat/${conv}/messages?around=${encodeURIComponent(hit.createdAt)}`, emp)).data;
  assert.ok(around.messages.some((x: any) => x.id === hit.id));
});
