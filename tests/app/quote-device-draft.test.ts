import {test} from 'node:test';
import assert from 'node:assert/strict';
// @ts-ignore browser module
import {createDeviceDraftStore,bindQuoteDeviceDraft} from '../../trial-ui/quote-device-draft.js';
function setup(){
 const data=new Map<string,string>();let time=1000;
 const storage={get length(){return data.size;},key:(i:number)=>[...data.keys()][i]??null,getItem:(k:string)=>data.get(k)??null,setItem:(k:string,v:string)=>data.set(k,v),removeItem:(k:string)=>data.delete(k)};
 return {data,store:createDeviceDraftStore({storage:()=>storage,now:()=>time,ttl:100,maxBytes:1000}),advance:(n:number)=>time+=n};
}
test('device draft belongs to the same user, document and server revision',()=>{
 const h=setup(),data={customer:'Anh Thái',rows:[{sku:'A',qty:2,price:0}]};
 assert.equal(h.store.save('a','q1',3,data),true);
 assert.deepEqual(h.store.read('a','q1',3).data,data);
 assert.equal(h.store.read('b','q1',3),null);
 assert.equal(h.store.read('a','q2',3),null);
 assert.equal(h.store.read('a','q1',4),null,'never restore over a newer server revision');
 h.advance(101);assert.equal(h.store.read('a','q1',3),null);
});
test('logout removes only this user drafts; accepted saves clear only the intended document',()=>{
 const h=setup();h.store.save('a',null,0,{customer:'Nháp mới'});h.store.save('a','q1',1,{});h.store.save('b','q1',1,{});
 h.store.clear('a','q1');assert.equal(h.store.read('a','q1',1),null);assert.ok(h.store.read('a',null,0));
 h.store.clearUser('a');assert.equal(h.store.read('a',null,0),null);assert.ok(h.store.read('b','q1',1));
});
test('blocked storage, malformed and oversized data fail without preventing CRM editing',()=>{
 const h=setup();assert.equal(h.store.save('a',null,0,{notes:'x'.repeat(1001)}),false);assert.equal(h.data.size,0);
 h.store.save('a',null,0,{});h.data.set([...h.data.keys()][0]!,'{broken');assert.equal(h.store.read('a',null,0),null);
 const denied=createDeviceDraftStore({storage:()=>{throw Error('Storage denied');}});
 assert.equal(denied.save('a',null,0,{}),false);assert.equal(denied.read('a',null,0),null);assert.doesNotThrow(()=>denied.clearUser('a'));
});
test('restore offer is shown once per user session; dismiss/save suppress reoffers without server writes',()=>{
 const global=globalThis as any,oldDocument=global.document,oldSession=global.sessionStorage;
 class N {children:any[]=[];hidden=true;className='';textContent='';type='';onclick:()=>void=()=>{};setAttribute(){}prepend(n:any){this.children.unshift(n);}append(...n:any[]){this.children.push(...n);}replaceChildren(...n:any[]){this.children=n;}}
 const session=new Map<string,string>();
 global.document={createElement:()=>new N(),createTextNode:(text:string)=>Object.assign(new N(),{textContent:text})};
 global.sessionStorage={getItem:(k:string)=>session.get(k)||null,setItem:(k:string,v:string)=>session.set(k,v),removeItem:(k:string)=>session.delete(k)};
 try{
  const h=setup(),user='session-restore-regression';let id='q1';h.store.save(user,id,1,{customer:'Nháp thật'});
  const make=()=>{const form=new N(),binder=bindQuoteDeviceDraft({form,user:()=>user,id:()=>id,revision:()=>1,dirty:()=>false,readData:()=>({}),restore:()=>{},store:h.store,isMobile:()=>true});return {binder,banner:form.children[0] as N};};
  const first=make();first.binder.offer();assert.equal(first.banner.hidden,false);
  assert.equal(first.banner.children.filter(n=>n.textContent==='Bỏ qua').length,1);
  first.banner.children.find(n=>n.textContent==='Bỏ qua')!.onclick();assert.equal(first.banner.hidden,true);assert.ok(h.store.read(user,id,1),'dismiss must not discard the backup');
  id='q2';h.store.save(user,id,1,{customer:'Nháp khác'});const second=make();second.binder.offer();assert.equal(second.banner.hidden,true);
  second.binder.saved(id);assert.equal(h.store.read(user,id,1),null);
  h.store.save(user,id,1,{customer:'Nháp đến muộn'});const third=make();third.binder.offer();assert.equal(third.banner.hidden,true);
  third.binder.logout();
 }finally{global.document=oldDocument;global.sessionStorage=oldSession;}
});
