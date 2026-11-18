import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boundedMap } from '../../src/core/async/bounded-map.ts';
import { externalText } from '../../src/core/http/external-request.ts';
import { edgeBody } from '../../src/core/http/edge-body.ts';
import { sapoClient } from '../../src/modules/integrations/api/sapo-client.ts';

test('bounded concurrency preserves order and drains in-flight workers before surfacing errors', async () => {
  let active=0, peak=0, drained=0;
  const result=await boundedMap([0,1,2,3,4,5],2,async n=>{peak=Math.max(peak,++active);await new Promise(r=>setTimeout(r,n%2));active--;return n*2;});
  assert.deepEqual(result,[0,2,4,6,8,10]);assert.equal(peak,2);
  await assert.rejects(boundedMap([0,1,2,3],2,async n=>{if(n===0)throw Error('expected');await new Promise(r=>setTimeout(r,5));drained++;return n;}),/expected/);
  assert.equal(drained,1);await assert.rejects(boundedMap([],0,async()=>0),RangeError);
});

test('external read retries are bounded/backed off; writes never retry and permission errors never retry', async () => {
  let calls=0;const waits:number[]=[];
  const flaky=(async()=>{calls++;return new Response('',{status:calls<3?503:200});}) as typeof fetch;
  const r=await externalText(flaky,'https://example.test',{}, {timeoutMs:1000,retrySafe:true,attempts:3,sleep:async ms=>{waits.push(ms);}});
  assert.equal(r.response.status,200);assert.equal(calls,3);assert.equal(waits.length,2);assert(waits[1]!>waits[0]!);
  calls=0;await externalText(flaky,'https://example.test',{method:'POST'},{timeoutMs:1000,attempts:3});assert.equal(calls,1);
  calls=0;await externalText((async()=>{calls++;return new Response('',{status:403});}) as typeof fetch,'https://example.test',{}, {timeoutMs:1000,retrySafe:true});assert.equal(calls,1);
});

test('timeout covers stalled response bodies, not just response headers; abort prevents further retries', async () => {
  let calls=0;
  const stalled=(async(_url,init)=>{calls++;return new Response(new ReadableStream({start(c){init!.signal!.addEventListener('abort',()=>c.error(init!.signal!.reason),{once:true});}}));}) as typeof fetch;
  await assert.rejects(externalText(stalled,'https://example.test',{}, {timeoutMs:5,retrySafe:true,sleep:async()=>{}}));assert.equal(calls,2);
  calls=0;const controller=new AbortController();controller.abort();
  await assert.rejects(externalText((async(_url,init)=>{calls++;throw init!.signal!.reason;}) as typeof fetch,'https://example.test',{signal:controller.signal},{timeoutMs:5,retrySafe:true}));assert.equal(calls,1);
});

test('Sapo pagination carries exact page boundaries and validates limits before any network call', async () => {
  const requests:URL[]=[];
  const api=sapoClient({cookie:'_admin_session_id=test',fetch:(async url=>{const u=new URL(String(url));requests.push(u);const page=Number(u.searchParams.get('page'));return Response.json({products:Array.from({length:page<3?50:1},(_,i)=>({id:(page-1)*50+i})),metadata:{total:101}});}) as typeof fetch});
  const first=await api.list('/products.json','products',1,1,50),second=await api.list('/products.json','products',first.nextPage!,2,50);
  assert.equal(first.items.length,50);assert.equal(first.nextPage,2);assert.equal(second.items.length,51);assert.equal(second.nextPage,null);
  assert.deepEqual(requests.map(u=>u.searchParams.get('page')),['1','2','3']);
  await assert.rejects(api.list('/products.json','products',0,1));await assert.rejects(api.list('/products.json','products',1,21));assert.equal(requests.length,3);
});

test('Edge streams large encoded JSON without calling text(), preserves gzip and login token behavior', async () => {
  const content=JSON.stringify({products:Array.from({length:12064},(_,i)=>[String(i),'Tên sản phẩm',Array(6).fill(12345),[1,2]])});
  const response=new Response(content);response.text=async()=>{throw Error('must not decode the response');};
  const result=await edgeBody(response,'gzip');assert.equal(result.gzip,true);
  const decoded=await new Response(new Response(result.body).body!.pipeThrough(new DecompressionStream('gzip'))).text();assert.equal(decoded,content);
  const small=await edgeBody(Response.json({ok:true}),'gzip');assert.equal(small.gzip,false);assert.deepEqual(await new Response(small.body).json(),{ok:true});
  const token='a'.repeat(64);const login=await edgeBody(Response.json({ok:true},{headers:{'set-cookie':'__Host-bn-session='+token+'; Secure'}}),'');
  assert.deepEqual(await new Response(login.body).json(),{ok:true,sessionToken:token});
});

test('oversized upstream responses fail without retrying or silently dropping a partial page',async()=>{
 let calls=0;
 await assert.rejects(externalText((async()=>{calls++;return new Response('123456');}) as typeof fetch,'https://example.test',{}, {timeoutMs:1000,maxBytes:5,retrySafe:true}),{code:'EXTERNAL_BODY_TOO_LARGE'});assert.equal(calls,1);
 const api=sapoClient({cookie:'_admin_session_id=test',fetch:(async()=>Response.json({products:[{id:1},{id:2}]})) as typeof fetch});
 await assert.rejects(api.list('/products.json','products',1,1,1),{code:'SAPO_PAGE_OVERFLOW'});
});
