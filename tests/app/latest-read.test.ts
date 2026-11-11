import { test } from 'node:test';
import assert from 'node:assert/strict';
// @ts-ignore browser module
import { createLatestRead } from '../../trial-ui/latest-read.js';
const defer=()=>{let resolve!:(v:string)=>void;const promise=new Promise<string>(r=>resolve=r);return {resolve,promise};};
test('slow autocomplete keeps one active search and only the most recent pending input',async()=>{
 const read=createLatestRead(),first=defer(),last=defer(),sent:string[]=[];
 const a=read(()=>{sent.push('a');return first.promise;});
 const b=read(()=>{sent.push('ab');return 'ab';});
 const c=read(()=>{sent.push('abc');return 'abc';});
 const d=read(()=>{sent.push('abcd');return last.promise;});
 assert.deepEqual(sent,['a']);first.resolve('a');assert.equal(await a,'a');assert.deepEqual(sent,['a','abcd']);
 last.resolve('abcd');assert.deepEqual(await Promise.all([b,c,d]),['abcd','abcd','abcd']);
 assert.equal(await read(()=> 'new search'),'new search');
});
test('a failed read settles every caller and does not block the latest input or repeat a request',async()=>{
 const read=createLatestRead(),first=defer();const a=read(()=>first.promise);
 const b=read(()=>{throw Error('obsolete');}),c=read(()=>{throw Error('network');});
 const failures=Promise.allSettled([b,c]);first.resolve('done');await a;
 assert.ok((await failures).every(x=>x.status==='rejected'&&x.reason.message==='network'));
 assert.equal(await read(()=> 'recovered'),'recovered');
});
test('closing an autocomplete prevents a queued network request; separate dialogs have separate queues',async()=>{
 let open=true,sent=0;const read=createLatestRead(),first=defer();const a=read(()=>{sent++;return first.promise;});
 const queued=read(()=>open?(sent++,'queued'):undefined);open=false;
 const other=createLatestRead();assert.equal(await other(()=> 'other user/dialog'),'other user/dialog');
 first.resolve('old');await a;assert.equal(await queued,undefined);assert.equal(sent,1);
});
