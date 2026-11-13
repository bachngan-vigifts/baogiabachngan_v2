import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {setupEarly} from './helpers/purchase-early-fixture.ts';
// @ts-expect-error browser module shared for interruption tests
import {sendAccountingImport} from '../trial-ui/accounting-import-runner.js';
// @ts-expect-error browser parser
import {parseStagedAccountingRows} from '../trial-ui/accounting-file.js';
const migration=readFileSync('migrations/postgres/20261113062905_accounting_resumable_imports.sql','utf8');
const gate=readFileSync('scripts/sql/assert-accounting-imports.sql','utf8');
async function fixture(n=500){
 const f=await setupEarly();
 const call=async(path:string,body?:unknown,cookie=f.cookies.mgr)=>f.call('/accounting'+path,cookie,body===undefined?'GET':'POST',body);
 const request=async(path:string,method='GET',body?:unknown)=>{const r=await f.call('/accounting'+path,f.cookies.mgr,method,body);if(r.status>=300)throw Object.assign(Error(JSON.stringify(r.data)),{status:r.status});return r.data;};
 const entity=await request('/entities','POST',{name:'Import synthetic entity',taxCode:'0123456789',confirmed:true});
 const book=await request('/books','POST',{name:'Import test',entityId:entity.id});
 await f.client.exec(`insert into price_policies(id,name) values ('import-list','Giá bán lẻ');
  insert into products(sku,name,unit,updated_at) select 'FILE-'||n,'Synthetic '||n,'Cái','2026-11-01' from generate_series(1,${n}) n;
  insert into product_prices(sku,policy_id,price) select 'FILE-'||n,'import-list',100 from generate_series(1,${n}) n;`);
 const input=Array.from({length:n},(_,i)=>({sku:'FILE-'+(i+1),quantity:'1',sourceRow:i+2}));
 const create=async(reference:string,totalRows=n)=>request('/books/'+book.id+'/imports','POST',{id:crypto.randomUUID(),fileHash:'a'.repeat(64),filename:'stock.xlsx',totalRows,kind:'opening',date:'2026-11-01',reference,note:'Synthetic import'});
 return {...f,call,request,entity,book,input,create};
}
test('30k imports resume, snapshot prices, finalize once and produce a paginated complete report without physical stock writes',async()=>{
 const f=await fixture(30000),job=await f.create('OPEN-30K');
 const before=await f.client.query('select count(*)::int n from stock_moves');
 const started=performance.now();let stopped=false;
 const part=await sendAccountingImport({request:f.request,job,rows:f.input,onProgress:(p:any)=>{if(p.receivedRows===1500)stopped=true;},stopped:()=>stopped});
 assert.equal(part.receivedRows,1500);
 // Browser/process memory is discarded; state must come from the DB.
 const reloaded=await f.request('/imports/'+job.id);assert.equal(reloaded.chunks.length,3);
 await f.client.exec("update product_prices set price=200 where sku='FILE-1'");
 const replay=await f.request('/imports/'+job.id+'/chunks/0','POST',{rows:f.input.slice(0,500)});assert.equal(replay.replayed,true);
 assert.equal((await f.client.query<{n:number}>('select net_value::int n from accounting_import_rows where job_id=$1 and line_no=1',[job.id])).rows[0]?.n,100);
 const done=await sendAccountingImport({request:f.request,job:reloaded,rows:f.input});
 assert.equal(done.receivedRows,30000);assert.equal(done.errorCount,0);
 console.log('30k staged upload local ms',Math.round(performance.now()-started));
 const stamp=performance.now();const finished=await f.request('/imports/'+job.id+'/finish','POST',{});
 const again=await f.request('/imports/'+job.id+'/finish','POST',{});assert.equal(again.documentId,finished.documentId);assert.equal(again.replayed,true);
 console.log('30k atomic finalization local ms',Math.round(performance.now()-stamp));
 assert.equal((await f.client.query<{n:number}>('select count(*)::int n from accounting_lines where document_id=$1',[finished.documentId])).rows[0]?.n,30000);
 const approveStart=performance.now();await f.request('/documents/'+finished.documentId+'/post','POST',{revision:1,confirmed:true});
 console.log('30k approval local ms',Math.round(performance.now()-approveStart));
 const reportStart=performance.now();const report=await f.request('/report?entityId='+f.entity.id+'&bookId='+f.book.id+'&from=2026-11-01&to=2026-11-13&paged=1');
 assert.equal(report.stockCount,30000);assert.equal(report.stock.length,50);assert.equal(report.totals.stockValue,3000000);
 console.log('30k complete report paged local ms',Math.round(performance.now()-reportStart));
 assert.deepEqual(await f.client.query('select count(*)::int n from stock_moves'),before);
});
test('errors are durable per original row and never silently omitted; invalid file cannot create a partial document',async()=>{
 const f=await fixture(500),job=await f.create('BAD');
 const input=[...f.input];input[1]={sku:'MISSING',quantity:'1',sourceRow:3};input[2]={sku:'FILE-1',quantity:'1',sourceRow:4};input[3]={sku:'FILE-4',quantity:'0',sourceRow:5};
 await f.client.exec("delete from product_prices where sku='FILE-5';update products set active=false where sku='FILE-6';update products set unit='' where sku='FILE-7'");
 const done=await f.request('/imports/'+job.id+'/chunks/0','POST',{rows:input});assert.equal(done.receivedRows,500);assert.equal(done.errorCount,6);
 const errors=await f.request('/imports/'+job.id+'/errors');assert.equal(errors.rows.length,6);assert.equal(errors.rows[0].sourceRow,3);assert.match(errors.rows[0].error,/SKU_NOT_FOUND/);assert.match(errors.rows[1].error,/SKU_DUPLICATE/);
 const fail=await f.call('/imports/'+job.id+'/finish',{});assert.equal(fail.status,422);
 assert.equal((await f.client.query<{n:number}>("select count(*)::int n from accounting_documents where reference='BAD'")).rows[0]?.n,0);
 for(const cookie of [f.cookies.emp,f.cookies.kho,f.cookies.ncc])assert.equal((await f.call('/imports/'+job.id,undefined,cookie)).status,403);
 assert.equal((await f.call('/imports/'+job.id,undefined,f.cookies.kt)).status,404,'another permitted user cannot read/modify this upload');
 await f.request('/imports/'+job.id+'/cancel','POST',{});assert.equal((await f.call('/imports/'+job.id+'/chunks/0',{rows:input})).status,409);
});
test('lost chunk acknowledgement, repeated clicks, changed payload, failures between batches, premature finalization and cancellation are safe',async()=>{
 const f=await fixture(1000),job=await f.create('RETRY');let lost=false;
 const request=async(path:string,method?:string,body?:any)=>{const r=await f.request(path,method,body);if(path.endsWith('/chunks/0')&&!lost){lost=true;throw Error('Synthetic response dropped after COMMIT');}return r;};
 const done=await sendAccountingImport({request,job,rows:f.input});assert.equal(done.receivedRows,1000);assert.equal(done.chunks.length,2);
 const changed=await f.call('/imports/'+job.id+'/chunks/0',{rows:f.input.slice(0,500).map((r,i)=>i? r:{...r,quantity:'2'})});assert.equal(changed.status,409);
 const repeatedCreate=await f.call('/books/'+f.book.id+'/imports',{...job});assert.equal(repeatedCreate.status,201);assert.equal(repeatedCreate.data.id,job.id);
 assert.equal((await f.call('/books/'+f.book.id+'/imports',{...job,id:crypto.randomUUID(),totalRows:30001})).status,400);
 assert.equal((await f.call('/imports/'+job.id+'/chunks/60',{rows:f.input.slice(0,500)})).status,400);
 assert.equal((await f.call('/imports/'+job.id+'/chunks/0',{rows:f.input.slice(0,501)})).status,400);
 const different=await f.call('/books/'+f.book.id+'/imports',{...job,fileHash:'b'.repeat(64)});assert.equal(different.status,409);
 const bad=await f.create('ROLLBACK',1000);
 assert.equal((await f.call('/imports/'+bad.id+'/finish',{})).status,409);
 assert.equal((await f.call('/imports/'+bad.id+'/chunks/1',{rows:f.input.slice(500)})).status,409);
 await f.client.exec("create function fail_stage() returns trigger language plpgsql as $$ begin if new.line_no=251 then raise exception 'synthetic stage failure';end if;return new;end $$;create trigger fail_stage before insert on accounting_import_rows for each row execute function fail_stage();");
 assert.ok((await f.call('/imports/'+bad.id+'/chunks/0',{rows:f.input.slice(0,500)})).status>=400);
 assert.equal((await f.request('/imports/'+bad.id)).receivedRows,0);
 assert.equal((await f.client.query<{n:number}>('select count(*)::int n from accounting_import_rows where job_id=$1',[bad.id])).rows[0]?.n,0);
 await f.client.exec('drop trigger fail_stage on accounting_import_rows');
 await f.request('/imports/'+bad.id+'/chunks/0','POST',{rows:f.input.slice(0,500)});
 await f.request('/imports/'+bad.id+'/cancel','POST',{});
 assert.equal((await f.call('/imports/'+bad.id+'/finish',{})).status,409);
 const failFinal=await f.create('FINAL-FAIL',500);await f.request('/imports/'+failFinal.id+'/chunks/0','POST',{rows:f.input.slice(0,500)});
 await f.client.exec("create function fail_final() returns trigger language plpgsql as $$ begin if new.line_no=251 then raise exception 'synthetic final failure';end if;return new;end $$;create trigger fail_final before insert on accounting_lines for each row execute function fail_final();");
 assert.ok((await f.call('/imports/'+failFinal.id+'/finish',{})).status>=400);
 assert.equal((await f.request('/imports/'+failFinal.id)).state,'uploading');
 assert.equal((await f.client.query<{n:number}>("select count(*)::int n from accounting_documents where reference='FINAL-FAIL'")).rows[0]?.n,0);
 await f.client.exec('drop trigger fail_final on accounting_lines');
 const first=await f.request('/imports/'+failFinal.id+'/finish','POST',{});assert.ok(first.documentId);
 assert.equal((await f.request('/imports/'+failFinal.id+'/finish','POST',{})).documentId,first.documentId);
});
test('new staging migration and gate replay safely, remain private and reject incomplete schema',async()=>{
 const f=await setupEarly();await f.client.exec("do $$ begin if not exists(select 1 from pg_roles where rolname='anon')then create role anon;end if;if not exists(select 1 from pg_roles where rolname='authenticated')then create role authenticated;end if;end $$;");await f.client.exec(migration);await f.client.exec(migration);
 for(let i=0;i<2;i++){await f.client.exec('begin read only');await f.client.exec(gate);await f.client.exec('rollback');}
 const privateTables=await f.client.query<{n:number}>("select count(*)::int n from pg_class where relname in ('accounting_import_jobs','accounting_import_chunks','accounting_import_rows') and relrowsecurity and not has_table_privilege('anon',oid,'SELECT,INSERT,UPDATE,DELETE') and not has_table_privilege('authenticated',oid,'SELECT,INSERT,UPDATE,DELETE')");assert.equal(privateTables.rows[0]?.n,3);
 await f.client.exec('begin;grant select on accounting_import_rows to authenticated;savepoint exposed');await assert.rejects(f.client.exec(gate),/deny authenticated/);await f.client.exec('rollback');
 await f.client.exec('begin;alter table accounting_import_rows drop column net_value;savepoint broken');
 await assert.rejects(f.client.exec(gate),/20261113062905/);await f.client.exec('rollback');
 const parsed=parseStagedAccountingRows([['SKU','SL'],['00123','1'],['MISSING','0'],['00123','2']]);assert.equal(parsed.length,3);assert.equal(parsed[0].sku,'00123');assert.equal(parsed[2].sourceRow,4);
 assert.throws(()=>parseStagedAccountingRows([['SKU','SL'],...Array.from({length:30001},()=>['X','1'])]),/30.000/);
});

test('cross-batch duplicates, simultaneous repeat posts, exhausted retries and expired sessions retain precise progress',async()=>{
 const f=await fixture(1000),job=await f.create('CONCURRENT');
 const first={rows:f.input.slice(0,500)};
 const replies=await Promise.all([f.request('/imports/'+job.id+'/chunks/0','POST',first),f.request('/imports/'+job.id+'/chunks/0','POST',first)]);
 assert.equal(replies.filter(r=>r.replayed).length,1);
 assert.equal((await f.request('/imports/'+job.id)).receivedRows,500);
 const second=f.input.slice(500);second[0]={...second[0]!,sku:'FILE-1'};
 const r=await f.request('/imports/'+job.id+'/chunks/1','POST',{rows:second});assert.equal(r.errorCount,1);
 const errors=await f.request('/imports/'+job.id+'/errors');assert.equal(errors.rows[0].sourceRow,502);assert.match(errors.rows[0].error,/SKU_DUPLICATE/);
 const retryJob=await f.create('OFFLINE');let posts=0;
 const offline=async(path:string,method?:string,body?:unknown)=>{if(path.includes('/chunks/')){posts++;throw Error('Offline');}return f.request(path,method,body);};
 await assert.rejects(sendAccountingImport({request:offline,job:retryJob,rows:f.input}),/Offline/);assert.equal(posts,2);assert.equal((await f.request('/imports/'+retryJob.id)).receivedRows,0);
 let expiredCalls=0;
 const expired=async(path:string,method?:string,body?:unknown)=>{if(path.includes('/chunks/')){expiredCalls++;throw Object.assign(Error('Session expired'),{status:401});}return f.request(path,method,body);};
 await assert.rejects(sendAccountingImport({request:expired,job:retryJob,rows:f.input}),/Session expired/);assert.equal(expiredCalls,1);
 const resumed=await sendAccountingImport({request:f.request,job:retryJob,rows:f.input});assert.equal(resumed.receivedRows,1000);
});
