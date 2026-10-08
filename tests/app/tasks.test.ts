import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from '../helpers/postgres.ts';
import { seedStaff, PASSWORD } from '../helpers/staff-fixture.ts';
import { hashPassword } from '../../src/core/auth/password.ts';
import { createAppRouter } from '../../src/app/router.ts';
import { customers } from '../../src/modules/customers/schema.ts';
import { dueBucket, addDaysIso } from '../../src/modules/tasks/domain/task-config.ts';

const origin = 'https://trial.test';
async function setup() {
  const { db, d1 } = await createTestDb(); await seedStaff(d1);
  // Nhân viên kho (chức vụ "warehouse" = nhóm Kho).
  await d1.sqlite.prepare("INSERT INTO staff_members (id,email,name,phone,role,position_id,active,created_at) VALUES ('kho','kho@x.vn','Thủ kho','0900','employee','warehouse',1,'2026-01-01T00:00:00.000Z')").run();
  await d1.sqlite.prepare('INSERT INTO staff_credentials (member_id,password_hash,activation_hash,activation_expires,version) VALUES (?,?,NULL,NULL,0)').run('kho', await hashPassword(PASSWORD, 1000));
  const router = createAppRouter();
  const call = async (path: string, cookie = '', method = 'GET', body?: object) => {
    const res = await router.handle(new Request(origin + '/api/staff' + path, { method, headers: { origin, 'content-type': 'application/json', cookie }, body: body ? JSON.stringify(body) : undefined }), { db, passwordIterations: 1000 });
    return { status: res.status, data: await res.json() as any, cookie: res.headers.get('set-cookie')?.split(';')[0] ?? '' };
  };
  const login = async (email: string) => (await call('/login', '', 'POST', { email, password: PASSWORD })).cookie;
  return { db, call, emp: await login('emp@x.vn'), mgr: await login('mgr@x.vn'), ncc: await login('ncc@x.vn'), kho: await login('kho@x.vn') };
}

test('hạn công việc', () => {
  assert.equal(dueBucket(null, '2026-10-06'), 'none');
  assert.equal(dueBucket('2026-10-05', '2026-10-06'), 'overdue');
  assert.equal(dueBucket('2026-10-06', '2026-10-06'), 'today');
  assert.equal(dueBucket('2026-10-08', '2026-10-06'), 'upcoming');
  assert.equal(addDaysIso('2026-10-31', 1), '2026-11-01');
});

test('bảng công việc: việc tự sinh từ báo giá / đơn / HĐKT tự hoàn thành; giao việc thủ công, quyền, trao đổi, thông báo', async () => {
  const { db, call, emp, mgr, ncc } = await setup();
  await db.insert(customers).values({ id: '1001', name: 'Công ty Hoàng Long', contact: 'Chị Lan', phone: '0901', email: '', address: '1 Lê Lợi', search: '', taxCode: '0101234567', customerCode: 'HL01', sourceVersion: 0, syncedAt: '' });
  const quote = await call('/quotes', emp, 'POST', { type: 'B2B', quoteNo: 'B2B_1', customer: 'Công ty Hoàng Long', customerId: '1001', vat: 8, rows: [{ name: 'Ly', sku: 'L', unit: 'cái', qty: 10, price: 100000, taxRate: 8 }] });
  assert.equal(quote.status, 201);

  // Báo giá nhân viên lập chờ duyệt → việc "chưa giao" cho Manager; nhân viên không thấy việc này.
  let un = (await call('/tasks?view=unassigned&refresh=1', mgr)).data.tasks;
  const approveTask = un.find((t: any) => t.source === 'quote');
  assert.ok(approveTask, JSON.stringify(un)); assert.match(approveTask.title, /Duyệt báo giá B2B_1/); assert.equal(approveTask.auto, true); assert.equal(approveTask.creatorName, 'Hệ thống');
  assert.equal((await call('/tasks?view=all&refresh=1', emp)).data.tasks.some((t: any) => t.source === 'quote'), false);
  assert.equal((await call('/tasks/summary', mgr)).data.unassigned >= 1, true);
  assert.equal((await call('/tasks/' + approveTask.id, mgr, 'DELETE')).status, 409, 'việc tự sinh không xoá');
  // Manager duyệt → việc tự hoàn thành; tạo đơn → việc "Lên lịch giao".
  await call('/quotes/' + quote.data.id + '/approve', mgr, 'POST', { revision: 1 });
  const done = (await call('/tasks?view=all&status=done&refresh=1', mgr)).data.tasks.find((t: any) => t.id === approveTask.id);
  assert.equal(done.status, 'done');
  const o = await call('/orders', emp, 'POST', { quoteId: quote.data.id });
  await call(`/orders/${o.data.id}/status`, mgr, 'PUT', { status: 'confirmed', verified: true }); // Manager duyệt đơn (đơn tạo ra luôn là nháp)
  let mine = (await call('/tasks?refresh=1', emp)).data.tasks;
  const plan = mine.find((t: any) => t.source === 'delivery');
  assert.ok(plan && plan.link === `#/orders/${o.data.id}`, JSON.stringify(mine));
  // Lập HĐKT → việc "Ký HĐKT"; lên lịch giao → việc lên lịch tự xong.
  await call('/contracts', emp, 'POST', { orderId: o.data.id, legalEntity: 'BN', depositRate: 30 });
  await call('/deliveries', emp, 'POST', { orderId: o.data.id, plannedDate: '2030-01-10' });
  mine = (await call('/tasks?refresh=1', emp)).data.tasks;
  assert.deepEqual(mine.map((t: any) => t.source).sort(), ['contract']);
  // Nhân viên tự nâng mức ưu tiên việc tự sinh; không đổi được tên.
  const sign = mine[0];
  assert.equal((await call('/tasks/' + sign.id, emp, 'PUT', { priority: 'urgent', title: 'x' })).status, 200);
  const sign2 = (await call('/tasks/' + sign.id, emp)).data.task;
  assert.deepEqual([sign2.priority, sign2.title === sign.title], ['urgent', true]);

  // Giao việc thủ công: Manager giao cho nhân viên → nhân viên nhận thông báo; quyền sửa / xoá.
  const empId = (await call('/tasks/people', mgr)).data.people.find((p: any) => p.id === 'emp').id;
  assert.equal((await call('/tasks', mgr, 'POST', { title: '' })).status, 400);
  assert.equal((await call('/tasks', mgr, 'POST', { title: 'X', assigneeId: 'nope' })).status, 400);
  assert.equal((await call('/tasks', mgr, 'POST', { title: 'X', dueDate: '2026-13-40' })).status, 400);
  const t = await call('/tasks', mgr, 'POST', { title: 'Gọi khách Hoàng Long chốt mẫu in', description: 'Gửi lại maquette', assigneeId: empId, priority: 'high', dueDate: '2026-10-08', dueTime: '15:30' });
  assert.equal(t.status, 201);
  assert.equal((await call('/notifications', emp)).data.notifications[0].eventType, 'task_assigned');
  mine = (await call('/tasks', emp)).data.tasks;
  const mt = mine.find((x: any) => x.id === t.data.id);
  assert.deepEqual([mt.creatorName !== '', mt.priority, mt.dueTime, mt.canManage, mt.canDelete], [true, 'high', '15:30', false, false]);
  assert.equal((await call('/tasks/' + t.data.id, emp, 'PUT', { title: 'đổi tên' })).status, 403);
  assert.equal((await call('/tasks/' + t.data.id, emp, 'PUT', { status: 'cancelled' })).status, 403);
  assert.equal((await call('/tasks/' + t.data.id, emp, 'DELETE')).status, 403);
  assert.equal((await call('/tasks/' + t.data.id, ncc)).status, 403, 'NCC không vào khu nghiệp vụ');
  assert.equal((await call('/tasks/' + t.data.id, emp, 'PUT', { status: 'in_progress' })).status, 200);
  // Trao đổi → người giao nhận thông báo.
  assert.equal((await call('/tasks/' + t.data.id + '/comments', emp, 'POST', { body: 'Khách hẹn chiều mai' })).status, 201);
  assert.equal((await call('/tasks/' + t.data.id + '/comments', mgr)).data.comments[0].body, 'Khách hẹn chiều mai');
  assert.equal((await call('/notifications', mgr)).data.notifications.some((n: any) => n.eventType === 'task_comment'), true);
  assert.equal((await call('/tasks/' + t.data.id, emp, 'PUT', { status: 'done', revision: 99 })).data.code, 'REVISION_CONFLICT');
  assert.equal((await call('/tasks/' + t.data.id, emp, 'PUT', { status: 'done' })).status, 200);
  assert.equal((await call('/notifications', mgr)).data.notifications.some((n: any) => n.eventType === 'task_done'), true);
  const fin = (await call('/tasks/' + t.data.id, mgr)).data.task;
  assert.equal(fin.status, 'done'); assert.ok(fin.completedAt && fin.startedAt && fin.completedByName);
  // Nhân viên tự tạo việc cho mình; người khác không thấy.
  const self = await call('/tasks', emp, 'POST', { title: 'Soạn bảng giá Tết' });
  assert.equal((await call('/tasks/' + self.data.id, emp)).data.task.assigneeId, empId);
  assert.equal((await call('/tasks/' + self.data.id, emp, 'DELETE')).status, 200);
  assert.equal((await call('/tasks/' + t.data.id, mgr, 'DELETE')).status, 200);
});

test('đơn đến hạn giao → việc cho NV phụ trách; bấm "Yêu cầu kho đóng hàng" → việc cho nhóm Kho, kho nhận việc, làm xong báo người yêu cầu', async () => {
  const { db, call, emp, mgr, kho } = await setup();
  await db.insert(customers).values({ id: '1001', name: 'Công ty Hoàng Long', contact: 'Chị Lan', phone: '0901', email: '', address: '1 Lê Lợi', search: '', taxCode: '0101234567', customerCode: 'HL01', sourceVersion: 0, syncedAt: '' });
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date());
  const quote = await call('/quotes', emp, 'POST', { type: 'B2B', quoteNo: 'B2B_2', customer: 'Công ty Hoàng Long', customerId: '1001', vat: 8, deliveryDate: today, rows: [{ name: 'Ly sứ', sku: 'L', unit: 'cái', qty: 10, price: 100000, taxRate: 8 }] });
  await call('/quotes/' + quote.data.id + '/approve', mgr, 'POST', { revision: 1 });
  const o = await call('/orders', emp, 'POST', { quoteId: quote.data.id });
  await call(`/orders/${o.data.id}/status`, mgr, 'PUT', { status: 'confirmed', verified: true }); // Manager duyệt đơn (đơn tạo ra luôn là nháp)
  let mine = (await call('/tasks?refresh=1', emp)).data.tasks;
  const due = mine.find((t: any) => t.title.startsWith('Đến hạn giao'));
  assert.ok(due, JSON.stringify(mine.map((t: any) => t.title))); assert.equal(due.priority, 'high');
  // Lên lịch giao hôm nay → NV phụ trách yêu cầu kho đóng hàng.
  const g = await call('/deliveries', emp, 'POST', { orderId: o.data.id, plannedDate: today, timeSlot: 'Sáng' });
  assert.equal((await call('/tasks/packing', kho, 'POST', { deliveryId: g.data.id })).status, 404, 'kho không yêu cầu thay NV phụ trách');
  const pack = await call('/tasks/packing', emp, 'POST', { deliveryId: g.data.id, note: 'Bọc chống sốc' });
  assert.equal(pack.status, 201);
  assert.equal((await call('/tasks/packing', emp, 'POST', { deliveryId: g.data.id })).data.code, 'PACK_EXISTS');
  assert.equal((await call('/notifications', kho)).data.notifications[0].eventType, 'task_assigned', 'cả nhóm Kho nhận thông báo');
  // Kho thấy việc của nhóm (chưa ai nhận) trong "Tôi nhận"; nhân viên sale khác không thấy.
  const khoList = (await call('/tasks?refresh=1', kho)).data.tasks;
  const pt = khoList.find((t: any) => t.id === pack.data.id);
  assert.deepEqual([pt.source, pt.teamName, pt.assigneeId, pt.canClaim, pt.priority], ['packing', 'Kho', null, true, 'urgent']);
  assert.match(pt.description, /Ly sứ: 10 cái/); assert.match(pt.description, /Bọc chống sốc/);
  assert.equal((await call('/tasks/summary', kho)).data.open, 1);
  // Kho bấm "Đang làm" → tự nhận việc; xong → NV phụ trách nhận thông báo; ô Lịch giao hàng thấy "đã đóng hàng".
  assert.equal((await call('/tasks/' + pack.data.id, kho, 'PUT', { status: 'in_progress' })).status, 200);
  assert.equal((await call('/tasks/' + pack.data.id, kho)).data.task.assigneeId, 'kho');
  assert.equal((await call('/tasks/' + pack.data.id, kho, 'PUT', { status: 'done' })).status, 200);
  assert.equal((await call('/notifications', emp)).data.notifications.some((n: any) => n.eventType === 'task_done'), true);
  const st = (await call('/tasks/packing?orderId=' + o.data.id, emp)).data.packing;
  assert.deepEqual([st[0].deliveryId, st[0].status, st[0].by], [g.data.id, 'done', 'Thủ kho']);
  // Giao việc cho nhóm Kế toán; nhóm khác không thấy; Manager thấy ở "Việc nhóm".
  const acc = await call('/tasks', mgr, 'POST', { title: 'Xuất hoá đơn đơn HL', assigneeId: 'team:accounting' });
  assert.equal(acc.status, 201);
  assert.equal((await call('/tasks/' + acc.data.id, kho)).status, 404);
  assert.equal((await call('/tasks?view=team', mgr)).data.tasks.some((t: any) => t.id === acc.data.id), true);
  assert.equal((await call('/tasks', mgr, 'POST', { title: 'X', assigneeId: 'team:nope' })).status, 400);
  // Chuyến giao đi → việc đóng hàng (nếu còn mở) và việc "đến hạn giao" tự hoàn thành khi giao xong.
  const g2pack = await call('/tasks/packing', emp, 'POST', { deliveryId: g.data.id });
  assert.equal(g2pack.status, 201, 're-request sau khi kho đã xong');
  await call('/deliveries/' + g.data.id + '/status', emp, 'PUT', { status: 'delivered', deliveredOn: today });
  mine = (await call('/tasks?refresh=1&view=all&status=all', mgr)).data.tasks;
  assert.equal(mine.find((t: any) => t.id === pack.data.id).status, 'done');
  assert.equal(mine.find((t: any) => t.title.startsWith('Đến hạn giao')).status, 'done');
});

test('việc tự sinh của nhân viên đã khoá / đã xoá chuyển về "chưa giao" để Manager thấy và giao lại', async () => {
  const { call, emp, mgr } = await setup();
  const quote = await call('/quotes', emp, 'POST', { type: 'B2B', quoteNo: 'B2B_9', customer: 'Công ty A', vat: 8, rows: [{ name: 'Ly', sku: 'L', unit: 'cái', qty: 1, price: 100000 }] });
  await call('/quotes/' + quote.data.id + '/approve', mgr, 'POST', { revision: 1 });
  const o = await call('/orders', emp, 'POST', { quoteId: quote.data.id });
  await call(`/orders/${o.data.id}/status`, mgr, 'PUT', { status: 'confirmed', verified: true }); // Manager duyệt đơn (đơn tạo ra luôn là nháp)
  const plan = () => call('/tasks?view=all&refresh=1', mgr).then(r => r.data.tasks.find((t: any) => t.source === 'delivery' && t.link === `#/orders/${o.data.id}`));
  assert.equal((await plan()).assigneeId, 'emp');
  // Khoá tài khoản người phụ trách đơn → việc đang mở về "chưa giao".
  assert.equal((await call('/admin/member', mgr, 'DELETE', { id: 'emp' })).status, 200);
  const t = await plan();
  assert.equal(t.assigneeId, null);
  assert.ok((await call('/tasks?view=unassigned&refresh=1', mgr)).data.tasks.some((x: any) => x.id === t.id), 'Manager thấy ở mục chưa giao');
  // Manager giao lại cho người khác → giữ nguyên người đó ở các lần đồng bộ sau.
  assert.equal((await call('/tasks/' + t.id, mgr, 'PUT', { assigneeId: 'old' })).status, 200);
  assert.equal((await plan()).assigneeId, 'old');
});
