// Phản hồi không đọc được (HTML, JSON cụt, rỗng, null) KHÔNG được coi là thành công.
// - Lệnh ghi: báo "chưa rõ đã lưu" (OUTCOME_UNKNOWN) → màn hình giữ nội dung form, sendOnce giữ mã chống lặp, không báo thành công.
// - Lệnh đọc: báo lỗi, không trả object lỗi như dữ liệu.
// Chạy đúng hàm apiRequest của trial-ui/app.js (và customer.js, register.js) trong vm, máy chủ giả trả phản hồi hỏng.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const {requestWithRegion}=await import(new URL('../../trial-ui/api-region.js',import.meta.url).href);
const {sendOnce,keyFor,resetRequestKeys}=await import(new URL('../../trial-ui/request-keys.js',import.meta.url).href);
const {UNKNOWN_OUTCOME,writeFailureMessage,readApiJson,invalidResponseError}=await import(new URL('../../trial-ui/api-transport.js',import.meta.url).href);
const read=(f:string)=>readFileSync(new URL('../../trial-ui/'+f,import.meta.url),'utf8');
const slice=(src:string,from:string,to:string)=>src.slice(src.indexOf(from),src.indexOf(to));
class ApiError extends Error {constructor(message:string,public status:number,public code?:string){super(message);}}

const BROKEN:[string,()=>Response][]=[
 ['HTML 200 (trang đăng nhập wifi / trang tĩnh)',()=>new Response('<!doctype html><title>Login</title>',{status:200,headers:{'content-type':'text/html'}})],
 ['JSON bị cắt giữa chừng',()=>new Response('{"id":"po-1","ids":["a"',{status:200,headers:{'content-type':'application/json'}})],
 ['thân rỗng',()=>new Response('',{status:200})],
 ['null',()=>new Response('null',{status:200,headers:{'content-type':'application/json'}})],
 ['HTML 502 từ cổng trung gian',()=>new Response('<html>Bad gateway</html>',{status:502})],
];

function appFixture(response:()=>Response){
 let saved=0,shown=0,refresh=0;
 const ctx:any={requestWithRegion,token:'account-a',API:'/api',location:{hash:'#/x'},ApiError,UNKNOWN_OUTCOME,writeFailureMessage,readApiJson,invalidResponseError,state:{user:{id:'a'}},performance:{now:()=>0},
  apiFetch:async()=>response(),isBackgroundRequest:()=>false,requestPriority:{run:(_:unknown,send:Function)=>send()},regionCanary:{headers:()=>({}),observe(){}},managerPoolHeaders:()=>({}),
  recordApi(){},saveToken:(v:string)=>{saved++;ctx.token=v;},showAuth:()=>shown++,approvalUi:null,dataRefresh:{observe(){},afterWrite:()=>refresh++}};
 vm.createContext(ctx);vm.runInContext(slice(read('app.js'),'async function apiRequest(','// CSP chỉ báo cáo:'),ctx);
 return {ctx,get saved(){return saved;},get refresh(){return refresh;}};
}

test('app.js: lệnh ghi nhận phản hồi hỏng → chưa rõ kết quả, không trả dữ liệu, không làm mới trang như đã lưu',async()=>{
 for(const [name,make] of BROKEN){
  const f=appFixture(make);
  await assert.rejects(f.ctx.apiRequest('/purchase-orders','POST',{orders:[]}),(e:any)=>{
   assert.equal(e.code,UNKNOWN_OUTCOME,name+': phải là OUTCOME_UNKNOWN');assert.equal(e.status,0,name+': status 0 như mất mạng → form coi là chưa rõ');assert.match(e.message,/chưa rõ máy chủ đã lưu/,name);return true;});
  assert.equal(f.refresh,0,name+': không báo dữ liệu đã đổi');
 }
});

test('app.js: lệnh đọc nhận phản hồi hỏng → báo lỗi, không trả object lỗi như dữ liệu',async()=>{
 for(const [name,make] of BROKEN){
  const f=appFixture(make);
  await assert.rejects(f.ctx.apiRequest('/orders','GET'),(e:any)=>{assert.notEqual(e.code,UNKNOWN_OUTCOME,name);assert.ok(e.message,name);return true;});
 }
});

test('app.js: phản hồi JSON hợp lệ vẫn chạy như cũ (thành công / lỗi có mã)',async()=>{
 const ok=appFixture(()=>Response.json({ids:['a','b']},{status:201}));assert.deepEqual(await ok.ctx.apiRequest('/purchase-orders','POST',{}),{ids:['a','b']});
 const list=appFixture(()=>Response.json([{id:1}]));assert.deepEqual(await list.ctx.apiRequest('/x','GET'),[{id:1}]);
 const bad=appFixture(()=>Response.json({error:'Hết hàng',code:'NO_STOCK'},{status:409}));
 await assert.rejects(bad.ctx.apiRequest('/x','POST',{}),(e:any)=>e.status===409&&e.code==='NO_STOCK'&&e.message==='Hết hàng');
});

test('sendOnce giữ mã chống lặp khi phản hồi hỏng: gửi lại dùng đúng mã cũ, chỉ bỏ mã khi máy chủ xác nhận',async()=>{
 const store=new Map<string,string>(),storage=()=>({getItem:(k:string)=>store.get(k)??null,setItem:(k:string,v:string)=>void store.set(k,v)});
 resetRequestKeys();
 const content={orderId:'o1',amount:1500000},sent:string[]=[];
 const broken=appFixture(BROKEN[0]![1]);
 await assert.rejects(sendOnce('payment',content,(key:string)=>{sent.push(key);return broken.ctx.apiRequest('/payments','POST',{key,...content});},storage),(e:any)=>e.code===UNKNOWN_OUTCOME);
 // Đóng/mở lại form, nhập đúng như cũ → cùng mã (máy chủ nhận ra, không ghi lần hai).
 assert.equal(keyFor('payment',content,storage),sent[0]);
 const ok=appFixture(()=>Response.json({id:'pay-1'},{status:201}));
 assert.equal((await sendOnce('payment',content,(key:string)=>{sent.push(key);return ok.ctx.apiRequest('/payments','POST',{key,...content});},storage)).id,'pay-1');
 assert.equal(sent[1],sent[0],'gửi lại dùng lại mã cũ');
 assert.notEqual(keyFor('payment',content,storage),sent[0],'đã xác nhận → lần nhập y hệt sau là phiếu mới');
});

test('customer.js (cổng khách hàng): phản hồi hỏng không thành kết quả thành công',async()=>{
 const src=read('customer.js'),fn=slice(src,'async function apiRequest(','// CSP chỉ báo cáo:');
 for(const [name,make] of BROKEN){
  const ctx:any={token:'t',API:'/api',apiFetch:async()=>make(),saveToken(){},toLogin(){},writeFailureMessage,UNKNOWN_OUTCOME,readApiJson,invalidResponseError};
  vm.createContext(ctx);vm.runInContext(fn,ctx);
  await assert.rejects(ctx.apiRequest('/orders','POST',{items:[]}),(e:any)=>{assert.equal(e.code,UNKNOWN_OUTCOME,name);assert.equal(e.status,0,name);return true;});
  await assert.rejects(ctx.apiRequest('/orders','GET'),(e:any)=>{assert.notEqual(e.code,UNKNOWN_OUTCOME,name);return true;});
 }
});

test('register.js (đăng ký đối tác): phản hồi hỏng không coi là đăng ký xong',async()=>{
 const src=read('register.js'),fn=slice(src,'async function api(','$(\'#registration-show-password\')');
 for(const [name,make] of BROKEN){
  const ctx:any={API:'/api',fetch:async()=>make()};
  vm.createContext(ctx);vm.runInContext(fn,ctx);
  await assert.rejects(ctx.api('/register-partner',{token:'x'}),(e:any)=>{assert.equal(e.code,UNKNOWN_OUTCOME,name);return true;});
 }
});
