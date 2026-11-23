import {approveFixtureOrder} from '../helpers/approval-cost-fixture.ts';
import { like } from 'drizzle-orm';
import { confirmWarehouseSupply } from '../helpers/confirmed-warehouse-supply.ts';
import { receivingReminderTasks } from '../../src/modules/tasks/api/receiving-reminders.ts';
import { reconcileTaskSet } from '../../src/modules/tasks/api/auto-tasks.ts';
import { postMoves } from '../../src/modules/inventory/api/ledger.ts';
import { warehouses } from '../../src/modules/catalog/schema.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from '../helpers/postgres.ts';
import { seedStaff, PASSWORD } from '../helpers/staff-fixture.ts';
import { hashPassword } from '../../src/core/auth/password.ts';
import { createAppRouter } from '../../src/app/router.ts';
import { customers } from '../../src/modules/customers/schema.ts';
import { tasks } from '../../src/modules/tasks/schema.ts';
import { dueBucket, addDaysIso } from '../../src/modules/tasks/domain/task-config.ts';

const origin = 'https://trial.test';
async function setup() {
  const { db, d1 } = await createTestDb(); await seedStaff(d1);
  // Nhân viên kho (chức vụ "warehouse" = nhóm Kho).
  await d1.sqlite.prepare("INSERT INTO staff_members (id,email,name,phone,role,position_id,active,created_at) VALUES ('kho','kho@x.vn','Thủ kho','0900','employee','warehouse',1,'2026-01-01T00:00:00.000Z')").run();
  await d1.sqlite.prepare('INSERT INTO staff_credentials (member_id,password_hash,activation_hash,activation_expires,version) VALUES (?,?,NULL,NULL,0)').run('kho', await hashPassword(PASSWORD, 1000));
  const router = createAppRouter();
  const call = async (path: string, cookie = '', method = 'GET', body?: object) => {
    const res = await router.handle(new Request(origin + '/api/staff' + path, { method, headers: { origin, 'content-type': 'application/json', cookie }, body: body ? JSON.stringify(body) : undefined }), { db, passwordIterations: 1000, sapoOrderPush: 'off' as const });
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
  await call('/quotes/' + quote.data.id + '/submit', emp, 'POST', { revision: 1 }); // nhân viên gửi duyệt (báo giá mới lưu là nháp)
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
  // Lập HĐKT thẳng từ báo giá (luồng độc lập với đơn hàng) → Manager duyệt → việc "Lên lịch giao" + "Ký HĐKT", mở trang HĐKT.
  const k = await call('/contracts', emp, 'POST', { quoteId: quote.data.id, legalEntity: 'BN', depositRate: 30 }); assert.equal(k.status, 201, JSON.stringify(k.data));
  const o = { data: { id: k.data.orderId as string } };
  await approveFixtureOrder({db,call},`/orders/${o.data.id}/status`,mgr,'PUT',{ status: 'confirmed', verified: true, costWarningsReviewed: true });
  let mine = (await call('/tasks?refresh=1', emp)).data.tasks;
  const plan = mine.find((t: any) => t.source === 'delivery');
  assert.ok(plan && plan.link === `#/contracts/${o.data.id}` && plan.title.includes(k.data.contractNo) && !plan.title.includes('DH_'), JSON.stringify(mine));
  // Lên lịch giao → việc lên lịch tự xong; còn việc "Ký HĐKT".
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
  const comment=await call('/tasks/' + t.data.id + '/comments', emp, 'POST', { body: 'Khách hẹn chiều mai' });assert.equal(comment.status,201);
  assert.equal(comment.data.comment.id,comment.data.id);assert.equal(comment.data.comment.body,'Khách hẹn chiều mai');assert.equal(comment.data.comment.memberId,empId);assert.ok(comment.data.comment.name&&comment.data.comment.createdAt);
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
  await call('/quotes/' + quote.data.id + '/submit', emp, 'POST', { revision: 1 }); // nhân viên gửi duyệt (báo giá mới lưu là nháp)
  await call('/quotes/' + quote.data.id + '/approve', mgr, 'POST', { revision: 1 });
  const o = await call('/orders', emp, 'POST', { quoteId: quote.data.id });
  await approveFixtureOrder({db,call},`/orders/${o.data.id}/status`,mgr,'PUT',{ status: 'confirmed', verified: true, costWarningsReviewed: true }); // Manager duyệt đơn (đơn tạo ra luôn là nháp)
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
  await confirmWarehouseSupply(db,call,mgr,o.data.id);
  await call('/deliveries/' + g.data.id + '/status', emp, 'PUT', { status: 'delivered', deliveredOn: today });
  mine = (await call('/tasks?refresh=1&view=all&status=all', mgr)).data.tasks;
  assert.equal(mine.find((t: any) => t.id === pack.data.id).status, 'done');
  assert.equal(mine.find((t: any) => t.title.startsWith('Đến hạn giao')).status, 'done');
});

test('việc tự sinh của nhân viên đã khoá / đã xoá chuyển về "chưa giao" để Manager thấy và giao lại', async () => {
  const { db, call, emp, mgr } = await setup();
  const quote = await call('/quotes', emp, 'POST', { type: 'B2B', quoteNo: 'B2B_9', customer: 'Công ty A', vat: 8, rows: [{ name: 'Ly', sku: 'L', unit: 'cái', qty: 1, price: 100000 }] });
  await call('/quotes/' + quote.data.id + '/submit', emp, 'POST', { revision: 1 }); // nhân viên gửi duyệt (báo giá mới lưu là nháp)
  await call('/quotes/' + quote.data.id + '/approve', mgr, 'POST', { revision: 1 });
  const o = await call('/orders', emp, 'POST', { quoteId: quote.data.id });
  await approveFixtureOrder({db,call},`/orders/${o.data.id}/status`,mgr,'PUT',{ status: 'confirmed', verified: true, costWarningsReviewed: true }); // Manager duyệt đơn (đơn tạo ra luôn là nháp)
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

test('nhận hàng NCC: không hoàn thành/huỷ thủ công, vẫn nhận việc và tự xong khi đã nhận đủ', async () => {
  const { db, call, mgr, kho } = await setup();
  await db.insert(warehouses).values({id:'task-wh',name:'Kho việc nhận',kind:'stock'});
  await postMoves(db,'mgr',[{sku:'RECEIVE-TEST',warehouseId:'task-wh',qty:1,kind:'opening',refType:'opening',refId:'task-fixture'}]);
  const { vietnamDate } = await import('../../src/modules/sales/domain/sales.ts');
  const supplier = await call('/suppliers', mgr, 'POST', { name: 'NCC kiểm tra tự hoàn thành' });
  const created = await call('/purchase-orders', mgr, 'POST', { orders: [{ supplierId: supplier.data.supplier.id,
    warehouse: 'Kho việc nhận', arrivalDate: addDaysIso(vietnamDate().iso,-1), lines: [{ sku: 'RECEIVE-TEST', name: 'Ly', quantity: 10 }] }] });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  const id = created.data.ids[0];
  let order = (await call(`/purchase-orders/${id}`, mgr)).data;
  order = (await call(`/purchase-orders/${id}/approve`, mgr, 'POST', { revision: order.revision, lines: [{ lineId: order.lines[0].id, price: 100 }] })).data;
  const confirmed = await call(`/purchase-orders/${id}/confirm`, mgr, 'POST', {});
  assert.equal(confirmed.status, 200, JSON.stringify(confirmed.data)); order = confirmed.data;
  // Nhắc mới giao trực tiếp cho từng người lúc 08:00; seed đúng mốc hôm qua để test độc lập giờ chạy suite.
  const atEight=new Date(addDaysIso(vietnamDate().iso,-1)+'T01:00:00Z');
  const reminders=await receivingReminderTasks(db,atEight);
  await reconcileTaskSet(db,new Map(reminders.map(t=>[t.autoKey,t])),atEight,like(tasks.autoKey,'receiving-due:%'));
  const list = (await call('/tasks?refresh=1', kho)).data.tasks;
  const managed=(await call('/tasks?refresh=1&view=all',mgr)).data.tasks.find((t:any)=>t.sourceId===id&&t.completionFromSource&&t.assigneeId==='kho');
  const task = list.find((t: any) => t.id===managed?.id && t.completionFromSource);
  assert.ok(task,JSON.stringify(list));assert.equal(task.sourceId,null,'Kho không nhận ID PO thương mại');assert.equal(task?.link,'#/receiving');
  assert.ok(task, JSON.stringify(list));
  assert.equal((await call(`/tasks/${task.id}`, kho)).data.task.completionFromSource, true);
  for (const actor of [mgr, kho]) for (const status of ['done', 'cancelled']) {
    const rejected = await call(`/tasks/${task.id}`, actor, 'PUT', { status });
    assert.equal(rejected.status, 409); assert.equal(rejected.data.code, 'TASK_SOURCE_MANAGED');
  }
  let current = (await call(`/tasks/${task.id}`, kho)).data.task;
  assert.equal(current.status, 'todo'); assert.equal(current.assigneeId, 'kho', 'nhắc 08:00 đã giao trực tiếp cho Kho; thao tác bị chặn không đổi người nhận');
  assert.equal((await call(`/tasks/${task.id}`, kho, 'PUT', { assigneeId: 'kho' })).status, 200);
  assert.equal((await call(`/tasks/${task.id}`, kho, 'PUT', { status: 'in_progress' })).status, 200);
  const received = await call(`/purchase-orders/${id}/receipts`, kho, 'POST', { clientKey: 'task-receive-complete', warehouse: 'Kho việc nhận', lines: [{ lineId: order.lines[0].id, goodQty: 10 }] });
  assert.equal(received.status, 201, JSON.stringify(received.data));
  const done = (await call('/tasks?refresh=1&status=done', kho)).data.tasks.find((t: any) => t.id === task.id);
  assert.equal(done.status, 'done'); assert.equal(done.completionFromSource, true);
  assert.equal((await call(`/tasks/${task.id}`, mgr, 'PUT', { status: 'todo' })).status, 409, 'không mở lại khi chứng từ đã xong');
  const manual = await call('/tasks', mgr, 'POST', { title: 'Việc thủ công nhận hàng', assigneeId: 'kho' });
  assert.equal((await call(`/tasks/${manual.data.id}`, kho)).data.task.completionFromSource, false);
  assert.equal((await call(`/tasks/${manual.data.id}`, kho, 'PUT', { status: 'done' })).status, 200, 'việc thủ công vẫn có thể tick hoàn thành');
});


test('thẻ thống kê: hạn lọc ở server trước LIMIT, đúng ngày Việt Nam, không lộ việc người khác và đúng nhóm', async () => {
  const { db, call, emp, mgr, kho } = await setup();
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date());
  const old = addDaysIso(today, -1), next = addDaysIso(today, 1), now = new Date().toISOString();
  const base = { createdBy: 'mgr', createdAt: now, updatedAt: now };
  await db.insert(tasks).values(Array.from({ length: 501 }, (_, i) => ({ ...base, id: `over-${i}`, title: `Quá hạn ${i}`, assigneeId: 'emp', dueDate: old })));
  await db.insert(tasks).values([
    { ...base, id: 'due-today', title: 'Hôm nay', assigneeId: 'emp', dueDate: today },
    { ...base, id: 'due-future', title: 'Ngày mai', assigneeId: 'emp', dueDate: next },
    { ...base, id: 'due-none', title: 'Không hạn', assigneeId: 'emp' },
    { ...base, id: 'due-done', title: 'Đã xong', assigneeId: 'emp', dueDate: today, status: 'done' },
    { ...base, id: 'due-private', title: 'Riêng manager', assigneeId: 'mgr', dueDate: today },
    { ...base, id: 'warehouse-today', title: 'Nhóm kho', assigneePosition: 'warehouse', dueDate: today },
    { ...base, id: 'accounting-created-by-warehouse', title: 'Kho giao kế toán', assigneePosition: 'accounting', createdBy: 'kho', dueDate: today },
    { ...base, id: 'unassigned-today', title: 'Chưa giao', dueDate: today },
  ]);
  const ids = (r: any) => r.data.tasks.map((t: any) => t.id);
  const due = await call('/tasks?view=mine&status=open&due=today', emp);
  assert.equal(due.status, 200); assert.deepEqual(ids(due), ['due-today'], 'không bị 501 việc cũ che mất và không gồm việc đã xong/người khác');
  assert.deepEqual(ids(await call('/tasks?due=upcoming', emp)), ['due-future']);
  assert.deepEqual(ids(await call('/tasks?due=none', emp)), ['due-none']);
  assert.equal((await call('/tasks?due=overdue', emp)).data.tasks.length, 500);
  assert.ok((await call('/tasks?due=overdue', emp)).data.tasks.every((t: any) => t.due === 'overdue'));
  assert.equal((await call('/tasks?due=invalid', emp)).status, 400);
  const summary = (await call('/tasks/summary', emp)).data; assert.equal(summary.today, 1); assert.equal(summary.overdue, 501);
  assert.deepEqual(ids(await call('/tasks?view=team&due=today', kho)), ['warehouse-today'], 'việc nhóm đúng nhóm mình, không lấy việc mình giao cho nhóm khác');
  assert.deepEqual(ids(await call('/tasks?view=unassigned&due=today', mgr)), ['unassigned-today']);
});

test('trang Công việc: số đếm theo tab (summary.views), số theo mốc hạn (dueCounts), lọc 7 ngày tới và người nhận', async () => {
  const { db, call, emp, mgr, kho } = await setup();
  const today = (await call('/tasks', mgr)).data.today as string;
  const add = async (cookie: string, title: string, assigneeId: string | undefined, dueDate?: string) => {
    const r = await call('/tasks', cookie, 'POST', { title, assigneeId, dueDate }); assert.equal(r.status, 201, JSON.stringify(r.data)); return r.data;
  };
  await add(mgr, 'Quá hạn của emp', 'emp', addDaysIso(today, -2));
  await add(mgr, 'Hôm nay của emp', 'emp', today);
  await add(mgr, 'Tuần này của emp', 'emp', addDaysIso(today, 3));
  await add(mgr, 'Tháng sau của emp', 'emp', addDaysIso(today, 30));
  await add(mgr, 'Không hạn của emp', 'emp');
  await add(mgr, 'Việc nhóm kho', 'team:warehouse', today);
  await add(emp, 'Emp giao cho chính mình', undefined);

  const views = (await call('/tasks/summary', emp)).data.views;
  assert.equal(views.mine, 6); assert.equal(views.created, 1); assert.equal(views.unassigned, 0, 'nhân viên không có tab Chưa giao');
  assert.equal((await call('/tasks/summary', mgr)).data.views.created, 6);
  assert.deepEqual((await call('/tasks/summary', kho)).data.teamNames, ['Kho']);
  assert.equal((await call('/tasks/summary', kho)).data.views.team, 1);

  const mine = (await call('/tasks?view=mine', emp)).data;
  assert.deepEqual(mine.dueCounts, { overdue: 1, today: 1, week: 1, upcoming: 2, none: 2, total: 6 });
  assert.ok(mine.syncedAt);
  const week = (await call('/tasks?view=mine&due=week', emp)).data;
  assert.deepEqual(week.tasks.map((t: any) => t.title), ['Tuần này của emp']);
  assert.equal(week.dueCounts.total, 6, 'số trên thẻ hạn không đổi khi đang lọc hạn');
  assert.equal((await call('/tasks?view=all&assignee=team:warehouse', mgr)).data.tasks.length, 1);
  assert.equal((await call('/tasks?view=all&assignee=emp', mgr)).data.tasks.length, 6);
  assert.equal((await call('/tasks?due=nope', emp)).status, 400);
});

test('danh sách công việc: việc sinh sau (mới tạo) lên trên cùng, không xếp theo hạn', async () => {
  const { db, call, mgr } = await setup();
  for (const [title, dueDate] of [['Việc 1 hạn gần', '2026-10-24'], ['Việc 2 không hạn', undefined], ['Việc 3 hạn xa', '2027-01-01']] as const) {
    assert.equal((await call('/tasks', mgr, 'POST', { title, ...(dueDate ? { dueDate } : {}) })).status, 201);
    await new Promise(r => setTimeout(r, 5));
  }
  const titles = (await call('/tasks?view=created', mgr)).data.tasks.map((t: any) => t.title).filter((t: string) => t.startsWith('Việc '));
  assert.deepEqual(titles, ['Việc 3 hạn xa', 'Việc 2 không hạn', 'Việc 1 hạn gần']);
});

test('mạng rớt sau khi đã lưu: tạo việc gửi lại cùng mã không sinh việc thứ hai (cả khi gửi đồng thời); cập nhật gửi lại báo thành công', async () => {
  const { db, call, mgr, emp } = await setup();
  const body = { title: 'Gọi lại khách An Phát', assigneeId: 'emp', priority: 'high', clientKey: 'task-key-0001' };
  const first = await call('/tasks', mgr, 'POST', body); assert.equal(first.status, 201, JSON.stringify(first.data));
  const again = await call('/tasks', mgr, 'POST', body); assert.equal(again.status, 200); assert.deepEqual([again.data.id, again.data.replayed], [first.data.id, true]);
  assert.equal((await call('/tasks', mgr, 'POST', { ...body, title: 'Việc khác' })).status, 409, 'cùng mã khác nội dung');
  for (const changed of [{description:'Nội dung khác'},{priority:'normal'},{assigneeId:'mgr'},{dueDate:'2026-12-01'},{link:'#/care/other'}])
    assert.equal((await call('/tasks',mgr,'POST',{...body,...changed})).status,409,'same key must compare all create fields');
  // Việc đã được sửa sau khi tạo (người nhận đổi ưu tiên): gửi lại đúng lần giao đó vẫn báo đã tạo, không kẹt ở 409; người khác dùng mã thì không.
  const edited = (await call('/tasks?view=mine', emp)).data.tasks.find((x: any) => x.id === first.data.id);
  assert.equal((await call(`/tasks/${edited.id}`, emp, 'PUT', { priority: 'low', revision: edited.revision })).status, 200);
  const afterEdit = await call('/tasks', mgr, 'POST', body);
  assert.deepEqual([afterEdit.status, afterEdit.data.id, afterEdit.data.replayed, afterEdit.data.changedSince], [200, first.data.id, true, true]);
  assert.equal((await call('/tasks', emp, 'POST', body)).data.id !== first.data.id, true, 'mã của người khác không trỏ tới việc này');
  const race = await Promise.all([1, 2, 3].map(() => call('/tasks', mgr, 'POST', { ...body, title: 'Việc đồng thời', clientKey: 'task-key-race' })));
  assert.ok(race.every(r => r.status === 200 || r.status === 201), JSON.stringify(race.map(r => r.data)));
  assert.equal(new Set(race.map(r => r.data.id)).size, 1);
  const mine = (await call('/tasks?view=created', mgr)).data.tasks.filter((t: any) => ['Gọi lại khách An Phát', 'Việc đồng thời'].includes(t.title));
  assert.equal(mine.length, 2, 'mỗi việc một bản');
  // "Bắt đầu làm" gửi lại với phiên bản cũ (lần trước đã lưu): trạng thái đã đúng → thành công, không báo "người khác cập nhật".
  const t = (await call('/tasks?view=mine', emp)).data.tasks.find((x: any) => x.id === first.data.id);
  assert.equal((await call(`/tasks/${t.id}`, emp, 'PUT', { status: 'in_progress', revision: t.revision })).status, 200);
  const retried = await call(`/tasks/${t.id}`, emp, 'PUT', { status: 'in_progress', revision: t.revision, returnTask:true });
  assert.equal(retried.data.task.id,t.id);assert.equal(retried.data.task.status,'in_progress');assert.equal(typeof retried.data.task.canManage,'boolean');
  assert.equal(retried.status, 200); assert.equal(retried.data.alreadyApplied, true);
  assert.equal((await call(`/tasks/${t.id}`, emp, 'PUT', { status: 'done', revision: t.revision })).status, 409, 'phiên bản cũ mà đổi khác thì vẫn báo xung đột');
});
