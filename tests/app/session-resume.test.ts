import {test} from 'node:test';
import assert from 'node:assert/strict';
// @ts-ignore browser module
import {createSessionResume} from '../../trial-ui/session-resume.js';
const user={id:'mgr',name:'Thái',email:'thai@example.invalid',role:'manager',perms:['page.quotes']};
function setup(){
 const values=new Map<string,string>(),opened:unknown[]=[],refreshed:unknown[]=[];
 let token='session-a',resolve!:(v:unknown)=>void,reject!:(e:unknown)=>void,calls=0;
 const pending=new Promise((yes,no)=>{resolve=yes;reject=no;});
 const storage={getItem:(key:string)=>values.get(key)||null,setItem:(key:string,value:string)=>values.set(key,value),removeItem:(key:string)=>values.delete(key)};
 const app=createSessionResume({storage:()=>storage,readToken:()=>token,verify:()=>{calls++;return pending;},open:(u:unknown)=>opened.push(u),refresh:(u:unknown)=>refreshed.push(u)});
 return {app,values,opened,refreshed,resolve,reject,setToken:(v:string)=>token=v,get calls(){return calls;},cache:(session='session-a',u=user)=>storage.setItem('bn-v2-session-profile',JSON.stringify({session,user:u}))};
}
test('reopen shows cached workspace before /me settles, then refreshes current permissions once',async()=>{
 const h=setup();h.cache();const pending=h.app.resume();assert.equal(h.opened.length,0,'defer until app module finishes initializing');
 await Promise.resolve();assert.deepEqual(h.opened,[user]);assert.equal(h.calls,1);
 const updated={...user,role:'employee',perms:[]};h.resolve({user:updated});await pending;
 assert.deepEqual(h.refreshed,[updated]);assert.equal(h.opened.length,1);
 assert.deepEqual(JSON.parse(h.values.get('bn-v2-session-profile')!).user,updated);
});
test('network/5xx preserves cached identity; logout clears it and late success never restores an old account',async()=>{
 const h=setup();h.cache();const pending=h.app.resume();await Promise.resolve();h.reject(Object.assign(new Error('offline'),{status:0}));await assert.rejects(pending,/offline/);
 assert.equal(h.opened.length,1);assert.ok(h.values.size);
 const old=setup();old.cache();const delayed=old.app.resume();await Promise.resolve();old.setToken('');old.app.clear();old.resolve({user});await delayed;
 assert.equal(old.refreshed.length,0);assert.equal(old.values.size,0);
});
test('missing/corrupt/mismatched cache and explicit login wait for verified identity',async()=>{
 for(const mode of ['missing','corrupt','different','fresh'] as const){
  const h=setup();if(mode==='corrupt')h.values.set('bn-v2-session-profile','bad json');else if(mode==='different')h.cache('other-session');else if(mode==='fresh')h.cache();
  const pending=h.app.resume({useCache:mode!=='fresh'});await Promise.resolve();assert.equal(h.opened.length,0,mode);
  h.resolve({user});await pending;assert.deepEqual(h.opened,[user]);
 }
});
test('old session failures cannot affect newly logged-in session; blocked storage still permits verified login',async()=>{
 const h=setup();const pending=h.app.resume();await Promise.resolve();h.setToken('session-b');h.reject(Object.assign(new Error('expired'),{status:401}));await pending;assert.equal(h.opened.length,0);
 const opened:unknown[]=[];
 const app=createSessionResume({storage:()=>{throw Error('blocked');},readToken:()=> 'current',verify:async()=>({user}),open:(u:unknown)=>opened.push(u),refresh:()=>{}});
 await app.resume();assert.deepEqual(opened,[user]);app.clear();
});
