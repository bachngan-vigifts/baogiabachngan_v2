import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from '../helpers/postgres.ts';
import { seedStaff, PASSWORD } from '../helpers/staff-fixture.ts';
import { hashPassword } from '../../src/core/auth/password.ts';
import { createAppRouter } from '../../src/app/router.ts';

/**
 * PHÂN QUYỀN XEM CÔNG VIỆC THEO CHỨC VỤ (chốt 09/10/2026):
 *  - Sale: chỉ việc của chính mình (mình nhận / mình giao).
 *  - Sale Admin, Kho, NVBH LOCK, NVBH ML: thấy thêm việc đồng nghiệp CÙNG chức vụ nhận hoặc giao – CHỈ XEM:
 *    không sửa / đổi trạng thái / nhận / xoá, không đọc / gửi trao đổi. Không thấy việc của chức vụ khác.
 */
const origin = 'https://trial.test';
async function setup() {
  const { db, d1 } = await createTestDb(); await seedStaff(d1);
  const add = async (id: string, pos: string) => {
    await d1.sqlite.prepare("INSERT INTO staff_members (id,email,name,phone,role,position_id,active,created_at) VALUES (?,?,?,'0900','employee',?,1,'2026-01-01T00:00:00.000Z')").run(id, `${id}@x.vn`, 'Tên ' + id, pos);
    await d1.sqlite.prepare('INSERT INTO staff_credentials (member_id,password_hash,version) VALUES (?,?,0)').run(id, await hashPassword(PASSWORD, 1000));
  };
  for (const [id, pos] of <[string, string][]>[['kho1', 'warehouse'], ['kho2', 'warehouse'], ['sa1', 'sale-admin'], ['sa2', 'sale-admin'], ['ml1', 'sales-ml'], ['ml2', 'sales-ml'], ['lk1', 'sales-lock'], ['sl3', 'sale'], ['sl4', 'sale']]) await add(id, pos);
  const router = createAppRouter();
  const call = async (path: string, cookie = '', method = 'GET', body?: object) => {
    const res = await router.handle(new Request(origin + '/api/staff' + path, { method, headers: { origin, 'content-type': 'application/json', cookie }, body: body ? JSON.stringify(body) : undefined }), { db, passwordIterations: 1000 });
    return { status: res.status, data: await res.json() as any, cookie: res.headers.get('set-cookie')?.split(';')[0] ?? '' };
  };
  const login = async (id: string) => (await call('/login', '', 'POST', { email: `${id}@x.vn`, password: PASSWORD })).cookie;
  const who: Record<string, string> = {};
  for (const id of ['mgr', 'emp', 'sl3', 'sl4', 'kho1', 'kho2', 'sa1', 'sa2', 'ml1', 'ml2', 'lk1']) who[id] = await login(id);
  return { call, who };
}

test('Công việc: Sale chỉ thấy việc mình; Kho / Sale Admin / NVBH thấy việc đồng nghiệp cùng chức vụ – chỉ xem, không đọc trao đổi', async () => {
  const { call, who } = await setup();
  const make = async (by: string, to: string, title: string) => { const r = await call('/tasks', who[by], 'POST', { title, assigneeId: to }); assert.equal(r.status, 201, JSON.stringify(r.data)); return r.data.id as string; };
  const ids = async (u: string, view = 'all') => { const r = await call(`/tasks?view=${view}&status=all`, who[u]); assert.equal(r.status, 200, u + ': ' + JSON.stringify(r.data)); return r.data.tasks.map((t: any) => t.title) as string[]; };

  const khoTask = await make('mgr', 'kho1', 'Soạn hàng đơn A');                 // Manager giao cho kho1
  await call(`/tasks/${khoTask}/comments`, who.mgr, 'POST', { body: 'Ghi chú riêng: giá vốn 120k' });
  const saleTask = await make('emp', 'sl3', 'Gọi khách B');                       // Sale giao cho Sale khác
  const saTask = await make('sa2', 'emp', 'Kiểm tra hợp đồng C');                 // Sale Admin giao cho Sale
  const mlTask = await make('ml1', 'ml1', 'Báo giá ML D');                         // NVBH ML tự giao mình
  const mgrOwn = await make('mgr', 'mgr', 'Việc riêng Manager');

  // Sale: chỉ việc của mình – không thấy việc Sale khác (cùng chức vụ Sale cũng không).
  assert.ok(!(await ids('sl4')).includes('Gọi khách B'));
  assert.equal((await call(`/tasks/${saleTask}`, who.sl4)).status, 404);
  assert.ok((await ids('sl3')).includes('Gọi khách B'), 'người nhận vẫn thấy');

  // Kho: thấy việc kho1 nhận (chỉ xem), không thấy việc Sale / Sale Admin / NVBH / Manager.
  const kho2All = await ids('kho2');
  assert.ok(kho2All.includes('Soạn hàng đơn A'));
  for (const x of ['Gọi khách B', 'Kiểm tra hợp đồng C', 'Báo giá ML D', 'Việc riêng Manager']) assert.ok(!kho2All.includes(x), x);
  assert.deepEqual(await ids('kho2', 'colleagues'), ['Soạn hàng đơn A']);
  const d = (await call(`/tasks/${khoTask}`, who.kho2)).data.task;
  assert.deepEqual([d.viewOnly, d.canManage, d.canClaim], [true, false, false]);
  assert.equal((await call(`/tasks/${khoTask}`, who.kho1)).data.task.viewOnly, false, 'người nhận không bị chỉ xem');
  // Chỉ xem: không đổi trạng thái / nhận / sửa / xoá / đọc hay gửi trao đổi.
  assert.equal((await call(`/tasks/${khoTask}`, who.kho2, 'PUT', { status: 'done' })).status, 403);
  assert.equal((await call(`/tasks/${khoTask}`, who.kho2, 'PUT', { assigneeId: 'kho2' })).status, 403);
  assert.equal((await call(`/tasks/${khoTask}`, who.kho2, 'DELETE')).status, 403);
  const cm = await call(`/tasks/${khoTask}/comments`, who.kho2);
  assert.equal(cm.status, 403); assert.ok(!JSON.stringify(cm.data).includes('giá vốn'), 'không lộ trao đổi');
  assert.equal((await call(`/tasks/${khoTask}/comments`, who.kho2, 'POST', { body: 'xin chào' })).status, 403);
  assert.equal((await call(`/tasks/${khoTask}`, who.kho1)).data.task.status, 'todo', 'việc không bị đổi');
  // Người nhận vẫn làm bình thường.
  assert.equal((await call(`/tasks/${khoTask}`, who.kho1, 'PUT', { status: 'done' })).status, 200);

  // Sale Admin: thấy việc đồng nghiệp Sale Admin GIAO (kể cả giao cho Sale); NVBH ML thấy việc NVBH ML; NVBH LOCK không thấy việc ML.
  assert.ok((await ids('sa1')).includes('Kiểm tra hợp đồng C'));
  assert.ok(!(await ids('sa1')).includes('Soạn hàng đơn A'));
  assert.ok((await ids('ml2')).includes('Báo giá ML D'));
  assert.equal((await call(`/tasks/${mlTask}`, who.lk1)).status, 404, 'khác chức vụ');
  // Việc của Manager không lộ cho ai.
  for (const u of ['kho2', 'sa1', 'ml2', 'emp']) assert.equal((await call(`/tasks/${mgrOwn}`, who[u])).status, 404, u);
  // Sale không có bộ lọc "Cùng chức vụ".
  assert.deepEqual(await ids('emp', 'colleagues'), []);
  void saTask;
});
