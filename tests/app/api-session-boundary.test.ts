import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {requestWithRegion} from '../../trial-ui/api-region.js';
import {writeFailureMessage,UNKNOWN_OUTCOME} from '../../trial-ui/api-transport.js';
const app=readFileSync(new URL('../../trial-ui/app.js',import.meta.url),'utf8');
const source=app.slice(app.indexOf('async function apiRequest('),app.indexOf('// CSP chỉ báo cáo:'));
class ApiError extends Error {constructor(message:string,public status:number,public code?:string){super(message);}}
function fixture(){
 let finish!:(r:Response)=>void;const response=new Promise<Response>(resolve=>finish=resolve);let saved=0,refresh=0,shown=0;
 const ctx:any={requestWithRegion,writeFailureMessage,UNKNOWN_OUTCOME,token:'account-a',API:'/api',location:{hash:'#/orders/order-a'},ApiError,state:{user:{id:'a'}},performance:{now:()=>0},apiFetch:()=>response,isBackgroundRequest:()=>false,requestPriority:{run:(_:unknown,send:Function)=>send()},regionCanary:{headers:()=>({}),observe(){}},recordApi(){},saveToken:(v:string)=>{saved++;ctx.token=v;},showAuth:()=>shown++,approvalUi:null,dataRefresh:{observe(){},afterWrite:()=>refresh++}};
 vm.createContext(ctx);vm.runInContext(source,ctx);return{ctx,finish,get saved(){return saved;},get refresh(){return refresh;},get shown(){return shown;}};
}
test('a late write/read from account A cannot return its data, refresh account B or replace its session',async()=>{
 for(const status of [200,401])for(const method of ['GET','POST']){
  const f=fixture(),pending=f.ctx.apiRequest('/orders/order-a',method,method==='POST'?{}:undefined);f.ctx.token='account-b';f.ctx.state.user={id:'b'};
  f.finish(Response.json({sessionToken:'rotated-a',order:{id:'order-a'},error:'Expired'},{status}));
  await assert.rejects(pending,(e:any)=>e.code==='STALE_SESSION');assert.equal(f.ctx.token,'account-b');assert.equal(f.saved,0);assert.equal(f.refresh,0);assert.equal(f.shown,0);
 }
});
test('a current-session confirmation still returns data and login can establish the new session',async()=>{
 const write=fixture(),pending=write.ctx.apiRequest('/orders/order-a','POST',{});write.finish(Response.json({ok:true}));assert.equal((await pending).ok,true);assert.equal(write.refresh,1);
 const login=fixture();login.ctx.token='';login.ctx.state.user=null;const auth=login.ctx.apiRequest('/login','POST',{});login.finish(Response.json({sessionToken:'new-session'}));await auth;assert.equal(login.ctx.token,'new-session');assert.equal(login.saved,1);
});
