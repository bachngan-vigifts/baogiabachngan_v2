import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,stat,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
// @ts-ignore Plain-JS worker module runs on the existing OpenClaw host.
import {receiptResultJournal,receiptCrmClient} from '../../scripts/supplier_receipt_worker_io.js';

test('Callback outbox persists before network; process restart replays exact result without claim/create',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'receipt-worker-'));
 try {
  const body={schema_version:1,action:'goods_receipt_result',crm_receipt_id:'receipt-uuid',idempotency_key:'receipt-uuid',lease_token:'private-lease',ok:true,sapo_purchase_order_id:'123',sapo_receipt_id:'456'};
  const calls:any[]=[],token='test-private-sync-'.padEnd(32,'x'),journal=receiptResultJournal(directory);
  const client=receiptCrmClient({baseUrl:'https://crm-staging.test/api/staff',token,journal,fetchImpl:async(url:string,init:any)=>{
   calls.push({url,init});assert.deepEqual(await journal.load(body.crm_receipt_id,body.lease_token),body);throw Error('do not expose '+token);
  }});
  await assert.rejects(()=>client.callback(body),/^Error: CRM_TRANSPORT_ERROR$/);
  const files=await readdir(directory);assert.equal(files.length,1);assert.ok(!files[0]!.includes('receipt-uuid'));
  assert.equal((await stat(join(directory,files[0]!))).mode&0o777,0o600);assert.equal((await stat(directory)).mode&0o777,0o700);
  const restarted=receiptCrmClient({baseUrl:'https://crm-staging.test/api/staff',token,journal:receiptResultJournal(directory),fetchImpl:async(url:string,init:any)=>{
   calls.push({url,init});return Response.json({ok:true,status:'done'});
  }});
  await restarted.replayResult('receipt-uuid',body.lease_token);assert.equal(calls.length,2);
  assert.deepEqual(JSON.parse(calls[1].init.body),body);assert.equal(calls[1].init.redirect,'error');assert.equal(calls[1].init.headers.authorization,'Bearer '+token);
  assert.ok(calls.every(x=>x.url.endsWith('/goods-receipt-result')));
  await journal.store({...body,lease_token:'new-reconciliation-lease',ok:false});
  assert.deepEqual(await journal.load(body.crm_receipt_id,body.lease_token),body,'mỗi generation giữ kết quả riêng, không ghi đè callback cũ');
 } finally {await rm(directory,{recursive:true,force:true});}
});
test('Claim 409 stops, error responses never leak provider body; bad config is rejected',async()=>{
 const journal={store:async()=>{},load:async()=>({})},token='test-sync-'.padEnd(32,'x');
 const c=receiptCrmClient({baseUrl:'https://crm-staging.test/api/staff',token,journal,fetchImpl:async()=>new Response('private credential',{status:409})});
 await assert.rejects(()=>c.claim({crm_receipt_id:'receipt'}),/^Error: CRM_HTTP_409$/);
 await assert.rejects(()=>c.replayResult('receipt'),/INVALID_SAVED_RESULT/);
 for(const baseUrl of ['http://crm.test/api/staff','https://crm.test/api/staff?token=fake','https://user:pass@crm.test/api/staff'])
  assert.throws(()=>receiptCrmClient({baseUrl,token,journal}));
});
