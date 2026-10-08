import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from '../helpers/postgres.ts';
import { seedStaff, PASSWORD } from '../helpers/staff-fixture.ts';
import { hashPassword } from '../../src/core/auth/password.ts';
import { createAppRouter } from '../../src/app/router.ts';
import { customers } from '../../src/modules/customers/schema.ts';
import { cleanCare, followUpState, remindFrom } from '../../src/modules/care/domain/care.ts';
import { vnToday } from '../../src/modules/care/api/routes.ts';
import { reconcileAutoTasks } from '../../src/modules/tasks/api/auto-tasks.ts';

const origin = 'https://trial.test';
const addDays = (iso: string, n: number) => new Date(Date.parse(iso + 'T00:00:00Z') + n * 86_400_000).toISOString().slice(0, 10);

async function setup() {
  const { db, d1 } = await createTestDb(); await seedStaff(d1);
  // Nhân viên thứ hai (đăng nhập được) để kiểm tra "chỉ thấy của mình".
  await d1.sqlite.prepare("INSERT INTO staff_members (id,email,name,phone,role,position_id,active,created_at) VALUES ('emp2','emp2@x.vn','Tên emp2','0900000002','employee','sale',1,'2026-01-01T00:00:00.000Z')").run();
  await d1.sqlite.prepare('INSERT INTO staff_credentials (member_id,password_hash,version) VALUES (?,?,0)').run('emp2', await hashPassword(PASSWORD, 1000));
  await db.insert(customers).values([
    { id: 'K1', name: 'Công ty Hoàng Long', contact: 'Anh Long', phone: '0901', email: '', address: '', search: '', taxCode: '', customerCode: '', sourceVersion: 0, syncedAt: '' },
    { id: 'K2', name: 'Nhà hàng Sen Vàng', contact: '', phone: '', email: '', address: '', search: '', taxCode: '', customerCode: '', sourceVersion: 0, syncedAt: '' },
  ]);
  const router = createAppRouter();
  const call = async (path: string, cookie = '', method = 'GET', body?: object) => {
    const res = await router.handle(new Request(origin + '/api/staff' + path, { method, headers: { origin, 'content-type': 'application/json', cookie }, body: body ? JSON.stringify(body) : undefined }), { db, passwordIterations: 1000 });
    return { status: res.status, data: await res.json() as any, cookie: res.headers.get('set-cookie')?.split(';')[0] ?? '' };
  };
  const login = async (email: string) => (await call('/login', '', 'POST', { email, password: PASSWORD })).cookie;
  return { db, call, emp: await login('emp@x.vn'), emp2: await login('emp2@x.vn'), mgr: await login('mgr@x.vn'), ncc: await login('ncc@x.vn') };
}

test('kiểm tra dữ liệu giao dịch chăm sóc (form như CRM): bắt buộc / giới hạn / ngày / nhắc trước', () => {
  const today = '2026-10-08', now = new Date('2026-10-08T03:00:00Z');
  const base = { customerId: 'K1', contactName: 'Chị Ngọc – 0907123456', content: 'Gọi hỏi thăm quà cuối năm', type: 'call', result: 'consulting', nextAt: '2026-10-15', remindBefore: '1d' };
  const ok = cleanCare({ ...base, occurredAt: '2026-10-08', expectedRevenue: '300000000' }, today, now);
  assert.deepEqual([ok.content, ok.result, ok.nextAt, ok.remindBefore, ok.expectedRevenue], ['Gọi hỏi thăm quà cuối năm', 'consulting', '2026-10-15', '1d', 300_000_000]);
  assert.equal(ok.occurredAt, '2026-10-08T05:00:00.000Z', 'ngày tạo → giữa trưa giờ VN');
  const bad = (raw: Record<string, unknown>, re: RegExp) => assert.throws(() => cleanCare({ ...base, ...raw }, today, now), re);
  bad({ customerId: '' }, /Chọn khách hàng/);
  bad({ contactName: '' }, /người liên hệ/);
  bad({ content: '  ' }, /Nhập nội dung/);
  bad({ type: 'fax' }, /loại giao dịch/);
  bad({ result: 'ordered' }, /kết quả/);
  bad({ remindBefore: '2d' }, /Nhắc tôi trước|nhắc tôi trước/);
  bad({ nextAt: '' }, /chăm sóc lần sau/);
  bad({ nextAt: '2026-10-07' }, /từ hôm nay/);
  bad({ nextAt: '2026-02-30' }, /không hợp lệ/);
  bad({ occurredAt: '2026-10-20' }, /tương lai/);
  bad({ occurredAt: 'hôm qua' }, /không hợp lệ/);
  bad({ expectedRevenue: -1 }, /Doanh số/);
  bad({ content: 123 }, /không hợp lệ/);
  assert.deepEqual([remindFrom('2026-10-15', '1d'), remindFrom('2026-10-15', '1w'), remindFrom('2026-11-07', '1m')], ['2026-10-14', '2026-10-08', '2026-10-08']);
  assert.deepEqual(['2026-10-07', '2026-10-08', '2026-10-09'].map(d => followUpState(d, null, today)), ['overdue', 'today', 'upcoming']);
  assert.equal(followUpState('2026-10-07', '2026-10-07T10:00:00Z', today), 'done');
});

test('giao dịch chăm sóc: ghi / sửa / xoá, chỉ thấy của mình, Manager thấy tất cả + chọn người phụ trách; tới mốc nhắc → việc; xong việc ↔ xong hẹn', async () => {
  const { db, call, emp, emp2, mgr, ncc } = await setup();
  const today = vnToday();
  assert.equal((await call('/care', ncc)).status, 403, 'NCC không vào được');
  assert.equal((await call('/care')).status, 401);
  const cfg = (await call('/care/config', emp)).data;
  assert.deepEqual(cfg.types.map((t: any) => t.label), ['Gọi điện thoại', 'Zalo', 'Email', 'Gặp trực tiếp', 'Báo giá']);
  assert.deepEqual(cfg.results.map((t: any) => t.label), ['Đang tư vấn', 'Đã gửi báo giá', 'Đang thương lượng', 'Đã chốt HĐ', 'Đã rớt đơn']);
  assert.deepEqual(cfg.reminds.map((t: any) => t.label), ['1 Tháng', '1 Tuần', '1 Ngày']);
  const form = (x: Record<string, unknown>) => ({ contactName: 'Anh Long – 0901', type: 'call', result: 'consulting', remindBefore: '1d', ...x });

  assert.equal((await call('/care', emp, 'POST', form({ customerId: 'KHONG_CO', content: 'x', nextAt: today }))).status, 400);
  // Nhân viên không chọn người phụ trách khác được; Manager thì được.
  assert.equal((await call('/care', emp, 'POST', form({ customerId: 'K1', content: 'x', nextAt: today, ownerId: 'emp2' }))).status, 403);
  const a1 = await call('/care', emp, 'POST', form({ customerId: 'K1', content: 'Hỏi nhu cầu quà Tết, cần 200 bộ chén', result: 'quote_sent', expectedRevenue: 300_000_000, nextAt: addDays(today, 1) }));
  assert.equal(a1.status, 201, JSON.stringify(a1.data));
  assert.deepEqual([a1.data.activity.customerName, a1.data.activity.ownerId, a1.data.activity.typeLabel, a1.data.activity.resultLabel, a1.data.activity.expectedRevenue, a1.data.activity.followUp],
    ['Công ty Hoàng Long', 'emp', 'Gọi điện thoại', 'Đã gửi báo giá', 300_000_000, 'upcoming']);
  const id1 = a1.data.activity.id;
  const a2 = (await call('/care', mgr, 'POST', form({ customerId: 'K1', type: 'zalo', content: 'Gửi catalogue', nextAt: today, ownerId: 'emp2' }))).data.activity;
  assert.equal(a2.ownerId, 'emp2', 'Manager giao cho nhân viên khác');
  // Hẹn xa, nhắc trước 1 tuần → chưa tới mốc nhắc.
  await call('/care', emp, 'POST', form({ customerId: 'K2', type: 'meeting', content: 'Gặp chủ nhà hàng', result: 'negotiating', nextAt: addDays(today, 20), remindBefore: '1w' }));

  // Phạm vi xem.
  const list = async (who: string, qs = '') => (await call('/care' + qs, who)).data;
  assert.deepEqual((await list(emp)).activities.map((a: any) => a.ownerId).sort(), ['emp', 'emp']);
  assert.deepEqual((await list(emp2)).activities.map((a: any) => a.id), [a2.id]);
  assert.equal((await list(mgr)).total, 3);
  assert.equal((await list(mgr, '?owner=emp2')).total, 1, 'Manager lọc theo nhân viên');
  assert.equal((await list(emp, '?owner=emp2')).total, 2, 'nhân viên không lọc sang người khác được');
  assert.equal((await call(`/care/${a2.id}`, emp)).status, 404, 'không xem được giao dịch của người khác');
  assert.equal((await list(emp, '?q=hoang long')).total, 1, 'tìm không dấu theo tên khách');
  assert.equal((await list(emp, '?q=bo chen')).total, 1, 'tìm theo nội dung');
  assert.equal((await list(emp, '?type=meeting')).total, 1);
  assert.equal((await list(emp, '?result=quote_sent')).total, 1);
  assert.equal((await list(emp, '?customerId=K2')).total, 1);
  assert.equal((await list(emp, `?from=${addDays(today, 1)}`)).total, 0);
  assert.equal((await list(emp, `?from=${today}&to=${today}`)).total, 2);
  const fu = await list(emp2, '?view=follow-ups');
  assert.deepEqual([fu.total, fu.counts.today, fu.counts.overdue], [1, 1, 0]);
  assert.equal((await call('/customers/K1/overview', emp)).data.care.length, 1);
  assert.equal((await call('/customers/K1/overview', mgr)).data.care.length, 2);

  // Sửa: người phụ trách hoặc Manager; chống ghi đè theo revision.
  assert.equal((await call(`/care/${id1}`, emp2, 'PUT', form({ customerId: 'K1', content: 'sửa', nextAt: today }))).status, 404);
  const base = form({ customerId: 'K1', content: 'Hỏi nhu cầu quà Tết (sửa)', result: 'negotiating', nextAt: addDays(today, 1), expectedRevenue: 250_000_000 });
  assert.equal((await call(`/care/${id1}`, emp, 'PUT', { ...base, revision: 99 })).status, 409);
  const ed = await call(`/care/${id1}`, emp, 'PUT', { ...base, revision: 1 });
  assert.deepEqual([ed.status, ed.data.activity.content, ed.data.activity.expectedRevenue, ed.data.activity.revision], [200, 'Hỏi nhu cầu quà Tết (sửa)', 250_000_000, 2]);

  // Tới mốc "nhắc trước" → việc cho nhân viên phụ trách; hẹn xa nhắc 1 tuần chưa có việc.
  await reconcileAutoTasks(db);
  const careTasks = async (who: string) => (await call('/tasks?view=mine&refresh=1', who)).data.tasks.filter((t: any) => t.source === 'care');
  let t1 = await careTasks(emp);
  assert.equal(t1.length, 1, 'chỉ hẹn ngày mai (nhắc trước 1 ngày) – hẹn 20 ngày nữa nhắc trước 1 tuần thì chưa');
  assert.match(t1[0].title, /^Chăm sóc lại Công ty Hoàng Long – Anh Long/); assert.equal(t1[0].link, `#/care/${id1}`); assert.equal(t1[0].dueDate, addDays(today, 1));
  assert.equal((await careTasks(emp2)).length, 1, 'việc về nhân viên được Manager giao phụ trách');
  assert.equal((await call(`/care/${id1}/done`, emp, 'POST', {})).data.activity.followUp, 'done');
  await reconcileAutoTasks(db);
  t1 = await careTasks(emp); assert.equal(t1.filter((t: any) => t.status !== 'done').length, 0, 'xong hẹn → việc tự hoàn thành');
  assert.equal((await call(`/care/${id1}/done`, emp, 'POST', { done: false })).data.activity.followUp, 'upcoming', 'mở lại hẹn');
  // Dời hẹn → việc mới theo ngày mới; hoàn thành việc ở "Công việc" → hẹn bên chăm sóc cũng xong.
  await call(`/care/${id1}`, emp, 'PUT', { ...base, nextAt: today });
  await reconcileAutoTasks(db);
  const open = (await careTasks(emp)).filter((t: any) => t.status !== 'done');
  assert.equal(open.length, 1); assert.equal(open[0].dueDate, today);
  assert.equal((await call(`/tasks/${open[0].id}`, emp, 'PUT', { status: 'done' })).status, 200);
  assert.equal((await call(`/care/${id1}`, emp)).data.activity.followUp, 'done');
  assert.equal((await call(`/care/${a2.id}/done`, emp, 'POST', {})).status, 404, 'không đánh dấu hộ người khác');

  // Xoá.
  assert.equal((await call(`/care/${a2.id}`, emp, 'DELETE')).status, 404);
  assert.equal((await call(`/care/${a2.id}`, mgr, 'DELETE')).status, 200);
  assert.equal((await list(mgr)).total, 2);
});
