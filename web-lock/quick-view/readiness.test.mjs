import {test} from 'node:test';
import assert from 'node:assert/strict';
import {checkHomepage} from './readiness.mjs';
const html='<style id="lnl-native-quick-view"></style><a href="#quick-view">Xem nhanh</a>';
const response=(body=html,status=200)=>new Response(body,{status});
const quiet={log:()=>{},now:()=>1};
test('healthy normal homepage passes without an expensive cache-busting request',async()=>{
 const calls=[];
 assert.equal(await checkHomepage({...quiet,fetcher:async(url,init)=>{calls.push(url);assert.equal(init.method,'GET');assert.ok(init.signal);return response();}}),true);
 assert.deepEqual(calls,['https://locknlockonline.com/']);
});
test('network/header or response-body timeout does not skip the next normal check',async()=>{
 for(const bodyTimeout of [false,true]){
  let count=0;const waits=[];
  await checkHomepage({...quiet,delay:async ms=>waits.push(ms),fetcher:async()=>{
   count++;if(count===1){if(bodyTimeout)return {text:async()=>{throw new DOMException('body timed out','TimeoutError');}};throw new DOMException('request timed out','TimeoutError');}
   return response();
  }});
  assert.equal(count,3);assert.deepEqual(waits,[1000]);
 }
});
test('fresh page alone never passes; retries are bounded with backoff',async()=>{
 const calls=[],waits=[];
 await assert.rejects(checkHomepage({...quiet,delay:async ms=>waits.push(ms),fetcher:async url=>{calls.push(url);return response(url.includes('?')?html:'old cached page');}}),/unconfirmed/);
 assert.equal(calls.length,6);assert.deepEqual(waits,[1000,2000]);
});
test('HTTP errors or a missing button cannot certify a normal homepage',async()=>{
 for(const [body,status] of [[html,503],['lnl-native-quick-view',200]]){
  let calls=0;
  await assert.rejects(checkHomepage({...quiet,delay:async()=>{},fetcher:async()=>{calls++;return response(body,status);}}),/unconfirmed/);
  assert.equal(calls,6);
 }
});
test('all reads timing out exhaust the bound and throw rather than certify readiness',async()=>{
 let calls=0;
 await assert.rejects(checkHomepage({...quiet,delay:async()=>{},fetcher:async()=>{calls++;throw new DOMException('timeout','TimeoutError');}}),/unconfirmed/);
 assert.equal(calls,6);
});
