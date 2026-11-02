import {test} from 'node:test';
import assert from 'node:assert/strict';
// @ts-ignore Standalone catalogue edge module.
import {interpretIntent} from '../../catalogue-server/assistant.mjs';
test('catalogue AI staff verification uses the edge-supported manual redirect policy',async()=>{
 const original=globalThis.fetch;let modelCalls=0;
 globalThis.fetch=(async(url:any,options:any)=>{assert.equal(url,'https://taceqfnsorewelsbdckg.supabase.co/functions/v1/baogia-v2-api/api/staff/me');assert.equal(options.redirect,'manual');assert.equal(options.headers.Origin,'https://crm.minhlongonline.com');return Response.json({user:{id:'edge-test-staff'}})}) as typeof fetch;
 try{const request=new Request('https://crm.minhlongonline.com/catalogue/api/assistant',{headers:{Authorization:'Bearer EDGE_TEST_TOKEN_123456'}});const result=await interpretIntent('bộ trà dưới 2tr',{AI:{run:async()=>{modelCalls++;return {response:{groups:[{brand:'Minh Long',type:'bo-tra',min:0,max:2000000,limit:20,packSize:1,keywords:[]}]}}}}},request);assert.equal(result.engine,'cloudflare_ai');assert.equal(modelCalls,1);assert.equal(result.groups.length,1);}finally{globalThis.fetch=original}
});
