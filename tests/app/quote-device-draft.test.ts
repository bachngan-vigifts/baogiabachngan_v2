import {test} from 'node:test';
import assert from 'node:assert/strict';
// @ts-ignore browser module
import {createDeviceDraftStore} from '../../trial-ui/quote-device-draft.js';
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
