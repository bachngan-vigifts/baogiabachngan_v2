import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setupEarly } from '../helpers/purchase-early-fixture.ts';
import { createAppRouter } from '../../src/app/router.ts';
import type { StaffEnv } from '../../src/modules/staff/api/auth-routes.ts';
import { warehouseImageJobs } from '../../src/modules/suppliers/warehouse-image-job-schema.ts';

const image = (content: string) => ({ name: 'phieu.jpg', type: 'image/jpeg', data_base64: Buffer.from(content).toString('base64') });

test('warehouse images are deduplicated and globally serialized until one-time callback completes', async () => {
  const f = await setupEarly(), router = createAppRouter(), deliveries: any[] = [];
  const env: StaffEnv = { db: f.db, passwordIterations: 1000, sapoOrderPush: 'off', warehouseImageIntegration: {
    webhookUrl: 'https://n8nthai.moarchvn.com/webhook/warehouse-request-image-v2',
    webhookToken: 'warehouse-image-outbound-test-token-1234567890', callbackOrigin: 'https://crm.minhlongonline.com',
    fetch: async (_url, init) => { deliveries.push(JSON.parse(String(init?.body))); return new Response('{}', { status: 202 }); },
  } };
  const staff = async (path: string, method = 'GET', body?: unknown) => {
    const r = await router.handle(new Request('https://trial.test/api/staff' + path, { method, headers: { origin: 'https://trial.test', cookie: f.cookies.kho || '', 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }), env);
    return { status: r.status, data: await r.json() as any };
  };
  const first = await staff('/warehouse-image-jobs', 'POST', { image: image('first') });
  assert.equal(first.status, 202); assert.equal(first.data.status, 'queued'); assert.equal(deliveries.length, 1);
  const duplicate = await staff('/warehouse-image-jobs', 'POST', { image: image('first') });
  assert.equal(duplicate.data.jobId, first.data.jobId); assert.equal(deliveries.length, 1, 'same image never creates another command');
  const second = await staff('/warehouse-image-jobs', 'POST', { image: image('second') });
  assert.equal(second.status, 202); assert.equal(deliveries.length, 1, 'second image waits for global processing lock');
  const active = deliveries[0]; assert.equal(active.jobId, first.data.jobId); assert.ok(active.callback.token); assert.ok(!JSON.stringify(await f.db.select().from(warehouseImageJobs)).includes(active.callback.token), 'raw callback token is never stored');
  const callback = async (token: string, body: object) => {
    const r = await router.handle(new Request(active.callback.url, { method: 'POST', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' }, body: JSON.stringify(body) }), env);
    return { status: r.status, data: await r.json() as any };
  };
  assert.equal((await callback('00000000-0000-4000-8000-000000000000', { status: 'completed', draft_no: 'PX-1' })).status, 401);
  const done = await callback(active.callback.token, { status: 'completed', draft_id: 'draft-1', draft_no: 'PX-1', pxk_no: '000123', warnings: ['Kiểm tra SKU mờ'] });
  assert.equal(done.status, 200); assert.equal(done.data.status, 'completed'); assert.equal(deliveries.length, 2, 'callback releases and dispatches exactly the next image');
  assert.equal((await f.db.select().from(warehouseImageJobs)).find(j => j.id === first.data.jobId)?.imagePayload, '', 'image bytes are removed after processing');
  assert.equal(deliveries[1].jobId, second.data.jobId);
  assert.equal((await callback(active.callback.token, { status: 'completed', draft_no: 'PX-1' })).status, 401, 'callback token is one-time');
});
