import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const ui=readFileSync(new URL('../../trial-ui/contract-ui.js',import.meta.url),'utf8');
const loader=ui.slice(0,ui.indexOf('export const DOCS'))+'\nglobalThis.loadBuilderForTest = loadBuilder;';
function fixture(mode:'stale'|'broken'|'network'){
 const calls:string[]=[];let attempts=0,healthy=false;const context:any={};
 context.document={createElement:()=>({remove(){}}),head:{append:(script:any)=>queueMicrotask(()=>{
  calls.push(script.src);const file=script.src.split('?')[0];
  if(file==='contract-document.js'){
   attempts++;if(mode==='network'&&attempts===1){script.onerror();return;}
  }
  runInNewContext(readFileSync(new URL('../../trial-ui/'+file,import.meta.url),'utf8'),context);
  if(file==='contract-document.js'&&!healthy&&(mode==='broken'||mode==='stale'&&!script.src.includes('_reload=')))delete context.ContractDocument.prepareDocument;
  script.onload();
 })}};
 runInNewContext(loader,context);
 return {context,calls,load:()=>context.loadBuilderForTest(),recover:()=>{healthy=true;}};
}
test('stale contract builder reloads once and concurrent preview/download users share the load',async()=>{
 const f=fixture('stale');await Promise.all([f.load(),f.load(),f.load()]);
 assert.equal(typeof f.context.ContractDocument.prepareDocument,'function');assert.equal(f.calls.length,6);assert.equal(f.calls.filter(s=>s.startsWith('contract-document.js')).length,2);assert.ok(f.calls.at(-1)!.includes('_reload='));
 await f.load();assert.equal(f.calls.length,6,'valid builder is reused');
});
test('incompatible contract assets fail clearly after one recovery and can retry later',async()=>{
 const f=fixture('broken');await assert.rejects(f.load,/Bộ dựng hồ sơ HĐKT chưa cập nhật đầy đủ/);assert.equal(f.calls.length,6);
 f.recover();await f.load();assert.equal(typeof f.context.ContractDocument.prepareDocument,'function');assert.equal(f.calls.length,9);
});
test('a failed contract script load does not poison the next preview attempt',async()=>{
 const f=fixture('network');await assert.rejects(f.load,/Không tải được contract-document.js/);assert.equal(f.calls.length,3);
 await f.load();assert.equal(typeof f.context.ContractDocument.prepareDocument,'function');assert.equal(f.calls.length,4);
});
