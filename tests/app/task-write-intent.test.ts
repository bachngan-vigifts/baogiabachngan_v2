import {test} from 'node:test';
import assert from 'node:assert/strict';
const {createTaskWriteIntent}:any=await import(new URL('../../trial-ui/task-write-intent.js',import.meta.url).href);
const storage=()=>{const rows=new Map<string,string>();return {getItem:(k:string)=>rows.get(k)||null,setItem:(k:string,v:string)=>rows.set(k,v),removeItem:(k:string)=>rows.delete(k)};};
test('two confirmed identical tasks are separate intents; an unknown result retains identity through reopening',async()=>{
 const store=storage(),owner=()=>crypto.randomUUID(),id=owner(),options={owner:()=>id,scope:'test',storage:()=>store},intent=createTaskWriteIntent(options),keys:string[]=[],body={title:'Gọi khách',priority:'normal'};
 await assert.rejects(intent.send(body,async(key:string)=>{keys.push(key);throw Error('response lost');}));
 assert.deepEqual(intent.pending().content,body);
 const reopened=createTaskWriteIntent(options);
 await assert.rejects(reopened.send({...body,title:'Việc khác'},()=>assert.fail('must not create a new task')));
 await reopened.send(body,async(key:string)=>{keys.push(key);return {id:'old-task'};});
 assert.equal(keys[0],keys[1]);assert.equal(reopened.pending(),null);
 await reopened.send(body,async(key:string)=>{keys.push(key);return {id:'new-task'};});assert.notEqual(keys[1],keys[2]);
});
test('double submit shares one request; account switching never uses another account intent',async()=>{
 const store=storage(),a=crypto.randomUUID(),b=crypto.randomUUID();let user=a,release:Function=()=>{},calls=0;
 const intent=createTaskWriteIntent({owner:()=>user,scope:'test',storage:()=>store}),body={title:'Việc'};
 const send=async()=>{calls++;await new Promise(resolve=>{release=resolve;});return {id:'task'};};
 const first=intent.send(body,send),second=intent.send(body,send);await new Promise(r=>setImmediate(r));assert.equal(calls,1);
 user=b;assert.equal(intent.pending(),null);release();assert.deepEqual(await first,await second);assert.equal(intent.pending(),null);
 user=a;assert.equal(intent.pending(),null);
});
test('definitive validation can be corrected; storage failure still keeps the retry key within this page',async()=>{
 // A stable account identity is required even when browser storage is unavailable.
 const key=crypto.randomUUID(),seen:string[]=[],store=storage();
 const stable=createTaskWriteIntent({owner:()=> 'actor-'+key,scope:'test',storage:()=>{throw Error('blocked');}});
 await assert.rejects(stable.send({title:'A'},async(k:string)=>{seen.push(k);throw Error('offline');}));
 await stable.send({title:'A'},async(k:string)=>{seen.push(k);return {};});assert.equal(seen[0],seen[1]);
 const validated=createTaskWriteIntent({owner:()=>key,scope:'validate',storage:()=>store});
 await assert.rejects(validated.send({title:''},async()=>{throw Object.assign(Error('invalid'),{status:400});}));assert.equal(validated.pending(),null);
 await validated.send({title:'Đã sửa'},async()=>({id:'ok'}));assert.equal(validated.pending(),null);
});
