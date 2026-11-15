import { test } from 'node:test';
import assert from 'node:assert/strict';
import {eq} from 'drizzle-orm';
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

test('uncertain HTTP/transport outcome retains the global slot and accepts a late authenticated result',async()=>{
 for(const outcome of ['transport','http'] as const){
  const f=await setupEarly(),router=createAppRouter(),sent:any[]=[];
  const env:StaffEnv={db:f.db,passwordIterations:1000,sapoOrderPush:'off',warehouseImageIntegration:{webhookUrl:'https://worker.test/ocr',webhookToken:'outbound-test-token-longer-than-32-characters',callbackOrigin:'https://crm.minhlongonline.com',fetch:async(_url,init)=>{
   sent.push(JSON.parse(String(init?.body)));if(sent.length===1){if(outcome==='transport')throw Error('connection lost after acceptance');return new Response('{}',{status:500});}return new Response('{}',{status:202});
  }}};
  const post=async(content:string)=>{const r=await router.handle(new Request('https://trial.test/api/staff/warehouse-image-jobs',{method:'POST',headers:{origin:'https://trial.test',cookie:f.cookies.kho!,'content-type':'application/json'},body:JSON.stringify({image:image(content)})}),env);return{status:r.status,data:await r.json() as any};};
  const first=await post('uncertain-first'),second=await post('queued-second');assert.equal(first.status,202);assert.equal(second.status,202);assert.equal(sent.length,1);
  const [stalled]=await f.db.select().from(warehouseImageJobs).where(eq(warehouseImageJobs.id,first.data.jobId));assert.equal(stalled!.status,'needs_review');assert.ok(stalled!.callbackTokenHash);assert.ok(stalled!.imagePayload);assert.equal(stalled!.finishedAt,null);
  const retry=await post('uncertain-first');assert.equal(retry.data.jobId,first.data.jobId);assert.equal(sent.length,1,'another enqueue/retry must not dispatch past an uncertain worker');
  const callback=()=>router.handle(new Request(sent[0].callback.url,{method:'POST',headers:{authorization:'Bearer '+sent[0].callback.token,'content-type':'application/json'},body:JSON.stringify({status:'completed',draft_id:'draft-late',draft_no:'LATE'})}),env);
  assert.equal((await callback()).status,200);assert.equal(sent.length,2);assert.equal(sent[1].jobId,second.data.jobId);assert.equal((await callback()).status,401);assert.equal(sent.length,2);
 }
});

test('a completed callback arriving before an HTTP failure cannot be overwritten as uncertain',async()=>{
 const f=await setupEarly(),router=createAppRouter();let callbacks=0;
 const env:StaffEnv={db:f.db,passwordIterations:1000,sapoOrderPush:'off',warehouseImageIntegration:{webhookUrl:'https://worker.test/ocr',webhookToken:'outbound-test-token-longer-than-32-characters',callbackOrigin:'https://crm.minhlongonline.com',fetch:async(_url,init)=>{
  const command=JSON.parse(String(init?.body));const response=await router.handle(new Request(command.callback.url,{method:'POST',headers:{authorization:'Bearer '+command.callback.token,'content-type':'application/json'},body:JSON.stringify({status:'completed',draft_id:'draft-early'})}),env);assert.equal(response.status,200);callbacks++;throw Error('HTTP acknowledgement lost after completed callback');
 }}};
 const response=await router.handle(new Request('https://trial.test/api/staff/warehouse-image-jobs',{method:'POST',headers:{origin:'https://trial.test',cookie:f.cookies.kho!,'content-type':'application/json'},body:JSON.stringify({image:image('early-callback')})}),env);assert.equal(response.status,202);assert.equal(callbacks,1);
 const [row]=await f.db.select().from(warehouseImageJobs);assert.equal(row!.status,'completed');assert.equal(row!.imagePayload,'');assert.equal(row!.callbackTokenHash,null);assert.equal(row!.lastError,'');
});
