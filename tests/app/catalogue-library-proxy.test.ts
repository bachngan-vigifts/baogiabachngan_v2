import{test}from'node:test';import assert from'node:assert/strict';
// @ts-expect-error Pages JS module
import{libraryProxy}from'../../catalogue-server/library.mjs';
test('shared catalogue proxy uses fixed CRM origin, bounded routes, and never forwards cookies or arbitrary URLs',async()=>{
 let calls=0;const token='Bearer TEST_CATALOGUE_PROXY_TOKEN';const fetcher=async(url:string,init:RequestInit)=>{calls++;const u=new URL(url);assert.equal(u.origin,'https://taceqfnsorewelsbdckg.supabase.co');assert.equal(u.pathname,'/functions/v1/baogia-v2-api/api/staff/catalogue-quotes/quote_1234');assert.equal(u.search,'');assert.equal(init.redirect,'manual');const h=new Headers(init.headers);assert.equal(h.get('cookie'),null);assert.equal(h.get('Authorization'),token);return Response.json({id:'quote_1234',revision:2});};
 assert.equal((await libraryProxy(new Request('https://crm.minhlongonline.com/catalogue/api/quotes'),fetcher)).status,401);
 const r=await libraryProxy(new Request('https://crm.minhlongonline.com/catalogue/api/quotes?id=quote_1234&url=https://bad.test',{method:'PUT',headers:{Authorization:token,Cookie:'do-not-forward'},body:'{}'}),fetcher);assert.equal(r.status,200);assert.equal(r.headers.get('cache-control'),'no-store');assert.equal(calls,1);
 assert.equal((await libraryProxy(new Request('https://crm.minhlongonline.com/catalogue/api/quotes?id=../../bad',{headers:{Authorization:token}}),fetcher)).status,400);assert.equal(calls,1);
 assert.equal((await libraryProxy(new Request('https://crm.minhlongonline.com/catalogue/api/quote-archive?id=quote_1234',{headers:{Authorization:token}}),fetcher)).status,405);
});
test('saved quote filters reach CRM without forwarding arbitrary parameters',async()=>{
 const query=new URLSearchParams({q:'bộ trà',brand:'Minh Long',category:'Bộ trà',employee:'Châu Yến',from:'2026-11-01',to:'2026-11-04',sort:'oldest',offset:'30',facets:'1'});
 const r=await libraryProxy(new Request('https://crm.minhlongonline.com/catalogue/api/quotes?'+query+'&url=https://bad.test',{headers:{Authorization:'Bearer TEST_CATALOGUE_PROXY_TOKEN'}}),async(url:string)=>{
  const actual=new URL(url);for(const [key,value]of query)assert.equal(actual.searchParams.get(key),value,key);assert.equal(actual.searchParams.has('url'),false);return Response.json({quotes:[],total:0});
 });assert.equal(r.status,200);
});

test('library fast-list options are forwarded to the fixed CRM route',async()=>{
 const r=await libraryProxy(new Request('https://crm.minhlongonline.com/catalogue/api/library?includeStock=0&facets=0',{headers:{Authorization:'Bearer TEST_CATALOGUE_PROXY_TOKEN'}}),async(url:string)=>{
  const u=new URL(url);assert.equal(u.pathname,'/functions/v1/baogia-v2-api/api/staff/catalogue-library');assert.equal(u.searchParams.get('includeStock'),'0');assert.equal(u.searchParams.get('facets'),'0');return Response.json({products:[]});
 });assert.equal(r.status,200);
});
