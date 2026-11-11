// @ts-nocheck
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createCatalogueSecurity} from '../../catalogue-server/security.mjs';
import {onRequest} from '../../functions/catalogue/api/[endpoint].js';
const token='CATALOGUE_SECURITY_TEST_TOKEN_123456';
const request=(path='session',headers={},method='GET')=>new Request('https://crm.minhlongonline.com/catalogue/api/'+path,{method,headers:{Authorization:'Bearer '+token,...headers}});
const validUser={id:'test-member',name:'Nhân viên thử nghiệm',role:'employee',positionId:'sale'};
test('actual Pages entry blocks every unauthenticated endpoint before any upstream work',async()=>{
 const original=globalThis.fetch;let calls=0;globalThis.fetch=async()=>{calls++;throw Error('must not fetch');};
 try{for(const path of ['library','quotes','customers','product','products','product-metadata','image','external-image','assistant','session']){
  const response=await onRequest({request:new Request('https://crm.minhlongonline.com/catalogue/api/'+path),env:{}});assert.equal(response.status,401,path);assert.equal(response.headers.get('cache-control'),'private, no-store');
 }assert.equal(calls,0);}finally{globalThis.fetch=original;}
});
test('session bootstrap validates CRM, sets an HttpOnly scoped cookie and never returns the token',async()=>{
 let calls=0;const security=createCatalogueSecurity({fetcher:async(url,init)=>{calls++;assert.match(url,/\/api\/staff\/me$/);assert.equal(init.redirect,'manual');assert.equal(init.headers.Authorization,'Bearer '+token);return Response.json({user:validUser});}});
 const response=await security(request('session',{},'POST'),{},()=>{throw Error('session must not reach data handler');});assert.equal(response.status,200);
 const data=await response.json();assert.equal(data.user.id,validUser.id);assert(!JSON.stringify(data).includes(token));assert.equal(calls,1);
 const cookie=response.headers.get('set-cookie');assert.match(cookie,/HttpOnly/);assert.match(cookie,/Secure/);assert.match(cookie,/SameSite=Strict/);assert.match(cookie,/Path=\/catalogue/);assert.match(cookie,/Max-Age=300/);
 const imageRequest=new Request('https://crm.minhlongonline.com/catalogue/api/image?url=https://minhlongonline.com/wp-content/test.jpg',{headers:{cookie:cookie.split(';')[0]}});
 const image=await security(imageRequest,{},req=>{assert.equal(req.headers.get('authorization'),'Bearer '+token);assert.equal(req.headers.get('cookie'),null);return new Response('image',{headers:{'Cache-Control':'public,max-age=86400'}});});assert.equal(image.status,200);assert.equal(calls,1);assert.equal(image.headers.get('cache-control'),'private, no-store');
});
test('expired, malformed, external-role and cross-site sessions fail closed',async()=>{
 let handled=0;const handler=()=>{handled++;return Response.json({ok:true});};
 const denied=createCatalogueSecurity({fetcher:async()=>new Response(null,{status:401})});assert.equal((await denied(request(),{},handler)).status,401);
 for(const user of [{...validUser,role:'supplier'},{...validUser,positionId:'customer'},{id:'unknown'},{}]){const security=createCatalogueSecurity({fetcher:async()=>Response.json({user})});assert.equal((await security(request(),{},handler)).status,403);}
 const error=createCatalogueSecurity({fetcher:async()=>{throw Error('private provider diagnostic');}});const response=await error(request(),{},handler);assert.equal(response.status,503);assert(!await response.text().then(t=>t.includes('private provider')));
 assert.equal((await error(request('session',{'sec-fetch-site':'cross-site'}),{},handler)).status,403);
 assert.equal((await error(request('session',{Origin:'https://evil.test'}),{},handler)).status,403);
 assert.equal((await error(request('session',{Authorization:'Bearer invalid'}),{},handler)).status,401);assert.equal(handled,0);
});
test('auth checks deduplicate, expire after 15 seconds and recheck revocation',async()=>{
 let at=0,calls=0,revoked=false;const security=createCatalogueSecurity({now:()=>at,fetcher:async()=>{calls++;await new Promise(r=>setTimeout(r,3));return revoked?new Response(null,{status:401}):Response.json({user:validUser});}});
 const handler=()=>Response.json({ok:true});await Promise.all(Array.from({length:5},()=>security(request(),{},handler)));assert.equal(calls,1);
 at=14000;assert.equal((await security(request(),{},handler)).status,200);assert.equal(calls,1);revoked=true;at=16000;assert.equal((await security(request(),{},handler)).status,401);assert.equal(calls,2);
});
test('costly API requests are rate limited per credential and reset after the window',async()=>{
 let at=0,handled=0;const security=createCatalogueSecurity({now:()=>at,fetcher:async()=>Response.json({user:validUser})});const handler=()=>{handled++;return Response.json({ok:true});};
 for(let i=0;i<30;i++)assert.equal((await security(request('product'),{},handler)).status,200);
 const denied=await security(request('product'),{},handler);assert.equal(denied.status,429);assert.equal(denied.headers.get('retry-after'),'60');assert.equal(handled,30);
 at=60001;assert.equal((await security(request('product'),{},handler)).status,200);
});
test('library writes retain upstream authorization without extra /me round trips',async()=>{
 const security=createCatalogueSecurity({fetcher:async()=>{throw Error('must use existing CRM authorization');}});
 const denied=await security(request('quotes',{},'POST'),{},req=>{assert.equal(req.headers.get('authorization'),'Bearer '+token);return Response.json({error:'upstream denied'},{status:403});});assert.equal(denied.status,403);
 const logout=await security(request('session',{},'DELETE'),{},()=>{throw Error('logout must not call data API');});assert.equal(logout.status,200);assert.match(logout.headers.get('set-cookie'),/Max-Age=0/);
});
test('uncached identity verification has a concurrency cap before contacting CRM',async()=>{
 let release,started=0;const wait=new Promise(resolve=>release=resolve);
 const security=createCatalogueSecurity({fetcher:async()=>{started++;await wait;return Response.json({user:validUser});}});
 const handler=()=>Response.json({ok:true});
 const jobs=Array.from({length:32},(_,i)=>security(request('session',{Authorization:'Bearer '+token+i}),{},handler));
 while(started<32)await new Promise(r=>setTimeout(r,1));
 assert.equal((await security(request('session',{Authorization:'Bearer '+token+'extra'}),{},handler)).status,429);assert.equal(started,32);
 release();assert((await Promise.all(jobs)).every(response=>response.status===200));
});
