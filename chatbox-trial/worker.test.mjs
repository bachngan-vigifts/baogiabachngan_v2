import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {handle,reserveUsage} from './worker.mjs';
function environment(){
 const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE chat_usage(bucket TEXT PRIMARY KEY,n INTEGER NOT NULL,expires INTEGER NOT NULL)');
 const binding={prepare(sql){return {bind(...args){return {all:async()=>({success:true,results:db.prepare(sql).all(...args)})}}}},batch:async ss=>{db.exec('BEGIN');try{const rs=await Promise.all(ss.map(s=>s.all()));db.exec('COMMIT');return rs;}catch(e){db.exec('ROLLBACK');throw e;}}};
 return {GEMINI_API_KEY:'test-key-only',CHAT_LIMITS:binding,ASSETS:{fetch:()=>new Response('Chatbox')},db};
}
const body={contents:[{role:'user',parts:[{text:'Xin chào'}]}]};
function req(payload=body,path='/api/v1beta/models/gemini-flash-lite-latest:streamGenerateContent'){return new Request('https://chat.example'+path,{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://chat.example','CF-Connecting-IP':'192.0.2.1'},body:JSON.stringify(payload)});}
test('public assets need no password, unconfigured API fails closed',async()=>{
 assert.equal((await handle(new Request('https://chat.example/'),environment())).status,200);
 assert.equal((await handle(req(),{})).status,503);
});
test('model, upload, size and origin guards reject before upstream',async()=>{
 const env=environment();let calls=0;const upstream=()=>{calls++;throw Error()};
 assert.equal((await handle(req(body,'/api/v1beta/models/expensive:generateContent'),env,upstream)).status,404);
 assert.equal((await handle(req({contents:[{parts:[{inlineData:{data:'x'}}]}]}),env,upstream)).status,400);
 assert.equal((await handle(req({contents:[{parts:[{text:'x'.repeat(12001)}]}]}),env,upstream)).status,413);
 const foreign=req();foreign.headers.set('Origin','https://evil.example');
 assert.equal((await handle(foreign,env,upstream)).status,403);assert.equal(calls,0);
});
test('server fixes model, key, token budget and tools; streams response',async()=>{
 const r=await handle(req({...body,tools:[{googleSearch:{}}],generationConfig:{maxOutputTokens:99999}}),environment(),async(url,options)=>{
 assert.match(url,/streamGenerateContent\?alt=sse$/);
 assert.equal(options.headers['X-goog-api-key'],'test-key-only');
 const p=JSON.parse(options.body);assert.equal(p.generationConfig.maxOutputTokens,512);assert.equal(p.tools,undefined);
 return new Response('data: {"candidates":[]}\n\n');
 });assert.equal(r.status,200);assert.match(r.headers.get('Content-Type'),/event-stream/);
});
test('database-backed minute limit survives new handlers and blocks paid calls',async()=>{
 const env=environment();let calls=0;
 for(let i=0;i<7;i++){const r=await handle(req(),env,async()=>{calls++;return new Response('{}')});assert.equal(r.status,i<6?200:429)}
 assert.equal(calls,6);
 const rows=env.db.prepare('SELECT bucket FROM chat_usage').all();assert.ok(rows.every(r=>!r.bucket.includes('192.0.2.1')));
});
test('daily per-IP limit and global cap enforced by conditional SQL writes',async()=>{
 const env=environment(),now=86400000*20000;
 for(let i=0;i<31;i++) assert.equal(await reserveUsage(req(),env,now+i*60000),i<30);
 const other=environment();other.db.prepare('INSERT INTO chat_usage VALUES(?,?,?)').run('g:20000',1000,now+86400000);
 assert.equal(await reserveUsage(req(),other,now),false);
});
test('missing trusted IP and failed limiter never call Gemini',async()=>{
 let calls=0;const upstream=()=>{calls++};
 const missing=req();missing.headers.delete('CF-Connecting-IP');
 assert.equal((await handle(missing,environment(),upstream)).status,429);
 const env=environment();env.CHAT_LIMITS.batch=async()=>{throw Error('private internal detail')};
 assert.equal((await handle(req(),env,upstream)).status,503);assert.equal(calls,0);
});
test('upstream errors cannot expose credentials',async()=>{
 const r=await handle(req(),environment(),async()=>new Response('test-key-only',{status:403}));
 assert.equal(r.status,502);assert.ok(!(await r.text()).includes('test-key-only'));
});
