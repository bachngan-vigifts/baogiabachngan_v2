import {test} from 'node:test';
import assert from 'node:assert/strict';
// @ts-ignore browser transport
import {createApiTransport,writeFailureMessage} from '../../trial-ui/api-transport.js';
test('Read retries tolerate transient network/503 failures, honor bounded backoff and return only the successful response',async()=>{
 let calls=0;const waits:number[]=[];
 const request=createApiTransport({fetcher:async()=>{calls++;if(calls===1)throw Error('network');return calls===2?new Response('{}',{status:503,headers:{'retry-after':'1'}}):Response.json({ok:true});},delay:async(ms:number)=>{waits.push(ms);}});
 assert.deepEqual(await (await request('/tasks')).json(),{ok:true});assert.equal(calls,3);assert.deepEqual(waits,[250,1000]);
});
test('Every write is sent once even when the outcome is unknown or a server returns 503',async()=>{
 for(const method of ['POST','PUT','PATCH','DELETE']){
  let calls=0;const request=createApiTransport({fetcher:async()=>{calls++;throw Error('unknown outcome');},delay:async()=>{}});
  await assert.rejects(request('/payments',{method,body:'{}'}));assert.equal(calls,1);
  const status=createApiTransport({fetcher:async()=>{calls++;return new Response('{}',{status:503});}});assert.equal((await status('/orders',{method})).status,503);assert.equal(calls,2);
 }
});
test('Auth, validation and permanent errors do not retry; reads have bounded attempts and caller cancellation stops retries',async()=>{
 for(const status of [400,401,403,404,409,500]){let calls=0;const request=createApiTransport({fetcher:async()=>{calls++;return new Response('{}',{status});}});assert.equal((await request('/me')).status,status);assert.equal(calls,1);}
 let calls=0;const limited=createApiTransport({fetcher:async()=>{calls++;return new Response('{}',{status:503});},delay:async()=>{}});assert.equal((await limited('/tasks')).status,503);assert.equal(calls,3);
 const controller=new AbortController();controller.abort();await assert.rejects(limited('/tasks',{signal:controller.signal}));assert.equal(calls,3);
});
test('A stalled read times out and retries at most twice',async()=>{
 let calls=0;const request=createApiTransport({timeoutMs:5,delay:async()=>{},fetcher:async(_url:unknown,init:any)=>{calls++;return new Promise((_resolve,reject)=>init.signal.addEventListener('abort',()=>reject(new Error('timeout'))));}});
 await assert.rejects(request('/tasks'));assert.equal(calls,3);
});
test('a regional caller can bound just its read attempt without changing ordinary retries or writes', async () => {
 let calls=0;const request=createApiTransport({timeoutMs:1000,delay:async()=>{},fetcher:async(_url:unknown,init:RequestInit)=>{calls++;return new Promise<Response>((_resolve,reject)=>init.signal!.addEventListener('abort',()=>reject(Error('timeout'))));}});
 await assert.rejects(request('/pos/options',{}, {timeoutMs:5,readRetries:0}),/timeout/);assert.equal(calls,1);
 const write=createApiTransport({writeTimeoutMs:5,fetcher:async(_url:unknown,init:RequestInit)=>{calls++;return new Promise<Response>((_resolve,reject)=>init.signal!.addEventListener('abort',()=>reject(Error('write timeout'))));}});
 await assert.rejects(write('/payments',{method:'POST'},{timeoutMs:1,readRetries:2}),/write timeout/);assert.equal(calls,2);
});
test('Each read retry is announced so the screen can say the network is slow; writes never announce',async()=>{
 let retries=0,calls=0;const request=createApiTransport({delay:async()=>{},onRetry:()=>{retries++;},fetcher:async()=>{calls++;return calls<3?new Response('{}',{status:503}):Response.json({ok:true});}});
 await request('/tasks');assert.equal(retries,2);
 await createApiTransport({onRetry:()=>{retries++;},fetcher:async()=>new Response('{}',{status:503})})('/orders',{method:'POST'});assert.equal(retries,2);
});
test('A write that hangs is abandoned after its time limit (never resent) and the message says the outcome is unknown',async()=>{
 let calls=0;const request=createApiTransport({writeTimeoutMs:5,fetcher:async(_url:unknown,init:any)=>{calls++;return new Promise((_r,reject)=>init.signal.addEventListener('abort',()=>reject(init.signal.reason)));}});
 await assert.rejects(request('/payments',{method:'POST',body:'{}'}),(e:any)=>e.name==='TimeoutError');assert.equal(calls,1);
 assert.match(writeFailureMessage({key:'abcdefgh-1234'}),/an toàn, hệ thống không ghi trùng/);
 assert.match(writeFailureMessage({title:'x'}),/kiểm tra trước khi gửi lại/);
});
