import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from '../helpers/postgres.ts';
import { seedStaff, PASSWORD } from '../helpers/staff-fixture.ts';
import { createAppRouter } from '../../src/app/router.ts';
import { customers } from '../../src/modules/customers/schema.ts';
import { dueBucket, addDaysIso } from '../../src/modules/tasks/domain/task-config.ts';

const origin = 'https://trial.test';
async function setup() {
  const { db, d1 } = await createTestDb(); await seedStaff(d1);
  const router = createAppRouter();
  const call = async (path: string, cookie = '', method = 'GET', body?: object) => {
    const res = await router.handle(new Request(origin + '/api/staff' + path, { method, headers: { origin, 'content-type': 'application/json', cookie }, body: body ? JSON.stringify(body) : undefined }), { db, passwordIterations: 1000 });
    return { status: res.status, data: await res.json() as any, cookie: res.headers.get('set-cookie')?.split(';')[0] ?? '' };
  };
  const login = async (email: string) => (await call('/login', '', 'POST', { email, password: PASSWORD })).cookie;
  return { db, call, emp: await login('emp@x.vn'), mgr: await login('mgr@x.vn'), ncc: await login('ncc@x.vn') };
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
  const empId = (await call('/tasks/people', mgr)).data.people.find((p: any) => p.name && p.role === 'employee').id;
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
