import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from '../helpers/postgres.ts';
import { seedStaff, PASSWORD } from '../helpers/staff-fixture.ts';
import { createAppRouter } from '../../src/app/router.ts';

const origin = 'https://trial.test';
async function setup() {
  const { db, d1 } = await createTestDb(); await seedStaff(d1);
  const router = createAppRouter(), env = { db, passwordIterations: 1000, sapoOrderPush: 'off' as const };
  const call = async (path: string, cookie = '') => {
    const res = await router.handle(new Request(origin + '/api/staff' + path, { headers: { origin, cookie } }), env);
    return { status: res.status, data: await res.json() as any };
  };
  const login = async (email: string) => (await router.handle(new Request(origin + '/api/staff/login', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ email, password: PASSWORD }) }), env)).headers.get('set-cookie')!.split(';')[0]!;
  return { call, emp: await login('emp@x.vn'), mgr: await login('mgr@x.vn') };
}

test('GET /badges gộp các số đếm: mỗi phần giống hệt API riêng, cùng quyền; phần lạ bị bỏ; chưa đăng nhập bị chặn', async () => {
  const { call, emp, mgr } = await setup();
  for (const who of [mgr, emp]) {
    const all = await call('/badges?parts=tasks,navigation,chat,care,stock,khong-co', who);
    assert.equal(all.status, 200);
    assert.deepEqual(Object.keys(all.data.parts).sort(), ['care', 'chat', 'navigation', 'stock', 'tasks']);
    for (const [part, path] of [['tasks', '/tasks/summary'], ['navigation', '/navigation-counts'], ['chat', '/chat/unread'], ['care', '/care?view=follow-ups&limit=1'], ['stock', '/stock-requests?status=open']] as const) {
      const alone = await call(path, who);
      assert.deepEqual(all.data.parts[part], alone.status === 200 ? alone.data : { error: true, status: alone.status }, part);
    }
  }
  assert.deepEqual((await call('/badges', mgr)).data, { parts: {} });
  assert.equal((await call('/badges?parts=tasks')).status, 401);
});
