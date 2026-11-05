// @ts-nocheck
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createSharedQuotes} from '../../trial-ui/catalogue/shared-quotes.js';
import {libraryProxy} from '../../catalogue-server/library.mjs';
globalThis.window={addEventListener(){}};
test('creator lookup caches identity, reads saved creator and separates accounts',async()=>{
 let token='account-a',cloudQuote=null;const calls=[];
 const quotes=createSharedQuotes({identity:()=>token,getState:()=>({cloudQuote}),api:async path=>{calls.push(path);return path.includes('&id=')?{createdByName:'Người tạo ban đầu'}:{memberName:token==='account-a'?'An':'Bình'};}});
 assert.equal(await quotes.creatorName(),'An');assert.equal(await quotes.creatorName(),'An');assert.equal(calls.length,1);
 cloudQuote={id:'shared-quote-1',revision:2};assert.equal(await quotes.creatorName(),'Người tạo ban đầu');assert.match(calls.at(-1),/identity=1&id=shared-quote-1/);
 cloudQuote=null;token='account-b';assert.equal(await quotes.creatorName(),'Bình');token='';assert.equal(await quotes.creatorName(),'Chưa đăng nhập CRM');
});
test('creator lookup retries after temporary failure',async()=>{
 let calls=0;const quotes=createSharedQuotes({identity:()=> 'a',getState:()=>({}),api:async()=>{if(++calls===1)throw Error('offline');return{memberName:'An'};}});
 await assert.rejects(quotes.creatorName());assert.equal(await quotes.creatorName(),'An');
});
test('proxy forwards creator filters and lightweight identity to fixed CRM only',async()=>{
 const urls=[];const fetcher=async url=>{urls.push(new URL(url));return Response.json({ok:true})};
 for(const query of ['createdBy=employee-1&employee=Advisor','identity=1&id=quote-123'])assert.equal((await libraryProxy(new Request('https://crm.minhlongonline.com/catalogue/api/quotes?'+query,{headers:{Authorization:'Bearer abcdefghijklmnop'}}),fetcher)).status,200);
 assert.equal(urls[0].searchParams.get('createdBy'),'employee-1');assert.equal(urls[0].searchParams.get('employee'),'Advisor');assert.equal(urls[1].searchParams.get('identity'),'1');assert.ok(urls[1].pathname.endsWith('/catalogue-quotes/quote-123'));assert(urls.every(u=>u.hostname==='taceqfnsorewelsbdckg.supabase.co'));
});

