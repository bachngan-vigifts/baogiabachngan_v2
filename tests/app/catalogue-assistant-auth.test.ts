import {test} from 'node:test';
import assert from 'node:assert/strict';
// @ts-ignore Standalone catalogue edge module.
import {handleAssistant} from '../../catalogue-server/assistant.mjs';
const post=(body:any,token?:string)=>new Request('https://crm.minhlongonline.com/catalogue/api/assistant',{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify(body)});
const adapter=()=>{const calls:string[]=[];return{calls,json:async(u:string)=>{calls.push(u);return[]},sourceUrl:(u:string)=>new URL(u),normalize:()=>({}),crmStock:async()=>new Map()}};
test('trợ lý catalogue: không đăng nhập CRM thì mọi hành động (categories/search/interpret) bị chặn 401 và không gọi website',async()=>{
 const original=globalThis.fetch;const staffCalls:string[]=[];
 globalThis.fetch=(async(url:any)=>{staffCalls.push(String(url));return new Response('{}',{status:401})}) as typeof fetch;
 try{
  for(const body of [{action:'categories'},{action:'search',groups:[{brand:'LocknLock',type:'binh-nuoc'}]},{action:'search',criteria:{brand:'both',type:'noi'}},{action:'interpret',prompt:'bộ trà dưới 2tr'}]){
   for(const token of [undefined,'TOKEN_HET_HAN_1234567890']){
    const a=adapter(),res=await handleAssistant(post(body,token),{},a);
    assert.equal(res.status,401,JSON.stringify(body)+' '+token);assert.match((await res.json()).error,/đăng nhập CRM/);assert.equal(a.calls.length,0,'không được gọi website khi chưa xác thực');
   }
  }
  assert.ok(staffCalls.every(u=>u.endsWith('/api/staff/me')),'chỉ hỏi CRM ai đang đăng nhập');
 }finally{globalThis.fetch=original;}
});
test('trợ lý catalogue: nhân viên CRM hợp lệ dùng được categories',async()=>{
 const original=globalThis.fetch;globalThis.fetch=(async()=>Response.json({user:{id:'u1'}})) as typeof fetch;
 try{const a=adapter(),res=await handleAssistant(post({action:'categories'},'TOKEN_HOP_LE_1234567890'),{},a);assert.equal(res.status,200);assert.ok(Array.isArray((await res.json()).catalog));assert.ok(a.calls.length>0);}
 finally{globalThis.fetch=original;}
});
