import {test} from 'node:test';
import assert from 'node:assert/strict';
const {initQrPhoneReceiver}:any=await import(new URL('../../trial-ui/pos-qr-phone.js',import.meta.url).href);
const flush=()=>new Promise(r=>setImmediate(r));
function fixture(mobile=true){
 const doc:any={visibilityState:'visible',events:{},addEventListener(k:string,fn:any){this.events[k]=fn;}};
 const worker:any={events:{},addEventListener(k:string,fn:any){this.events[k]=fn;}};
 const win:any={events:{},navigator:{serviceWorker:worker},addEventListener(k:string,fn:any){this.events[k]=fn;}};
 let actor:any={id:'seller-a',role:'employee',positionId:'sales-lock'},reply:any={display:null},deferred:Promise<any>|null=null;
 const calls:any[]=[],views:any[]=[],jobs=new Map<number,{fn:()=>void,ms:number}>(),saved=new Map();let sequence=0;
 const api=async(path:string,method='GET',body?:unknown)=>{calls.push({path,method,body});if(path==='/notifications/read')return{ok:true};return deferred||reply;};
 const receiver=initQrPhoneReceiver({api,user:()=>actor,doc,win,mobile:()=>mobile,now:()=>1000,storage:{getItem:(k:string)=>saved.get(k),setItem:(k:string,v:string)=>saved.set(k,v)},schedule:(fn:()=>void,ms:number)=>{jobs.set(++sequence,{fn,ms});return sequence;},cancel:(id:number)=>jobs.delete(id),render:(_doc:any,d:any,dismiss:()=>void,ready:()=>void)=>{const v={d,dismiss,ready,closed:false,hidden:false,update(x:any){this.d=x;this.hidden=false;},unavailable(){this.hidden=true;},close(){this.closed=true;dismiss();}};views.push(v);return v;}});
 const display=(noteId='note-1')=>({noteId,id:'qr-1',state:'pending',amount:1458000,orderNo:'POS-DEMO',content:'TEST ONLY',expiresAt:new Date(61000).toISOString(),url:'https://img.vietqr.io/image/fixture.png'});
 return{receiver,doc,worker,calls,views,jobs,display,setReply:(x:any)=>reply=x,setActor:(x:any)=>actor=x,setDeferred:(x:any)=>deferred=x};
}
test('foreground push opens the authoritative QR immediately; acknowledges display without any checkout call and deduplicates repeats',async()=>{
 const f=fixture();f.receiver.start();await flush();assert.equal(f.views.length,0);assert.ok([...f.jobs.values()].some(j=>j.ms===2500));
 f.setReply({display:f.display()});f.worker.events.message({data:{type:'bn-notification',note:{eventType:'pos_qr_display',data:{url:'https://evil.example/qr'}}}});await flush();
 assert.equal(f.views.length,1);assert.equal(f.views[0].d.url,'https://img.vietqr.io/image/fixture.png');f.views[0].ready();await flush();
 assert.ok(f.calls.some(c=>c.path==='/notifications/read'));assert.ok(f.calls.every(c=>c.path==='/pos/qr-display/pending'||c.path==='/notifications/read'));
 await f.receiver.check();assert.equal(f.views.length,1);
 f.views[0].dismiss();await f.receiver.check();assert.equal(f.views.length,1,'manual dismissal does not reopen the same share');
 f.setReply({display:f.display('explicit-resend')});await f.receiver.check();assert.equal(f.views.length,2);f.receiver.stop();
});
test('paid/expired QR and client expiry remove the code; hidden/desktop clients do not auto-open',async()=>{
 const f=fixture();f.setReply({display:f.display()});f.receiver.start();await flush();assert.equal(f.views.length,1);
 f.setReply({display:{id:'qr-1',noteId:'note-1',state:'paid'}});await f.receiver.check();assert.equal(f.views[0].closed,true);
 f.setReply({display:f.display('second')});await f.receiver.check();const expiry=[...f.jobs.values()].find(j=>j.ms===60000)!;assert.ok(expiry);expiry.fn();assert.equal(f.views[1].closed,true);
 f.doc.visibilityState='hidden';f.doc.events.visibilitychange();const count=f.calls.length;
 f.worker.events.message({data:{type:'bn-notification',note:{eventType:'pos_qr_display'}}});await flush();assert.equal(f.calls.length,count);
 f.receiver.stop();const desktop=fixture(false);desktop.receiver.start();await flush();assert.equal(desktop.calls.length,0);desktop.receiver.stop();
});
test('logout/account switching discards in-flight QR responses and permission revocation closes the receiver',async()=>{
 const f=fixture();let resolve!:(r:any)=>void;f.setDeferred(new Promise(r=>resolve=r));f.receiver.start();
 f.receiver.stop();f.setActor({id:'seller-b',role:'employee',positionId:'sales-ml'});f.setReply({display:null});f.setDeferred(null);f.receiver.start();resolve({display:f.display()});await flush();assert.equal(f.views.length,0);
 await f.receiver.check();assert.equal(f.views.length,0);f.setReply({display:f.display('own')});await f.receiver.check();assert.equal(f.views.length,1);
 f.receiver.stop();assert.equal(f.views[0].closed,true);
});
