import {test,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import postgres from 'postgres';

const dir=new URL('../../migrations/postgres/',import.meta.url);
const files=readdirSync(dir).filter(f=>f.endsWith('.sql')).sort();
const read=(f:string)=>readFileSync(new URL(f,dir),'utf8');
const financial='20261021035601_web_order_financial_snapshot.sql';
const guard='20261109132941_web_order_financial_snapshot_guard.sql';
const repair=readFileSync(new URL('../../scripts/sql/repair-preview-missing-history.sql',import.meta.url),'utf8');
const historyCheck=readFileSync(new URL('../../scripts/sql/assert-web-order-replay-history.sql',import.meta.url),'utf8');
type Db={exec:(sql:string)=>Promise<unknown>;query:(sql:string)=>Promise<{rows:Record<string,unknown>[]}>;close:()=>Promise<unknown>};
const opened:Db[]=[];
afterEach(async()=>{for(const db of opened.splice(0))await db.close();});
async function emptyDb(){
 let db:Db;
 if(process.env.TEST_PG_URL){
  const url=new URL(process.env.TEST_PG_URL);
  assert.ok(['127.0.0.1','localhost','[::1]'].includes(url.hostname),'Replay tests may only create databases on a local test server');
  const admin=postgres(url.toString(),{max:1,onnotice:()=>{}}),name='preview_'+crypto.randomUUID().replaceAll('-','');
  await admin.unsafe('CREATE DATABASE '+name);url.pathname='/'+name;
  const sql=postgres(url.toString(),{max:1,onnotice:()=>{}});
  db={exec:async q=>{await sql.unsafe(q).simple();},query:async q=>({rows:[...await sql.unsafe(q)]}),close:async()=>{await sql.end();await admin.unsafe('DROP DATABASE '+name+' WITH (FORCE)');await admin.end();}};
 }else{
  const pg=new PGlite();await pg.waitReady;
  db={exec:q=>pg.exec(q),query:q=>pg.query(q),close:()=>pg.close()};
 }
 opened.push(db);
 // Supabase owns these platform roles/storage objects. No application tables are stubbed.
 await db.exec(`DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
 END $$;
 CREATE SCHEMA storage;
 CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);`);
 return db;
}
async function replay(db:Db,except:string[]=[],journal=new Map<string,string>()){
 for(const file of files){
  if(except.includes(file))continue;
  const text=read(file),hash=createHash('sha256').update(text).digest('hex');
  if(journal.has(file)){assert.equal(journal.get(file),hash,'Never rewrite applied migration content: '+file);continue;}
  try{await db.exec(text);}catch(cause){throw new Error('Migration failed: '+file,{cause});}
  journal.set(file,hash);
 }
 return journal;
}
async function snapshotColumn(db:Db){
 const {rows}=await db.query("SELECT data_type,is_nullable,column_default FROM information_schema.columns WHERE table_schema='public' AND table_name='web_store_orders' AND column_name='financial_snapshot'");
 assert.equal(rows.length,1);assert.equal(rows[0]!.data_type,'text');assert.equal(rows[0]!.is_nullable,'NO');assert.match(String(rows[0]!.column_default),/\{\}/);
}
async function sentinel(db:Db,withSnapshot:boolean){
 await db.exec(`INSERT INTO staff_members(id,email,name,role,created_at) VALUES('preview-owner','preview@example.test','Preview','manager','2026-11-09');
 INSERT INTO warehouses(id,name) VALUES('preview-warehouse','Preview');
 INSERT INTO price_policies(id,name) VALUES('preview-price-a','A'),('preview-price-b','B');
 INSERT INTO pos_registers(id,name,warehouse_id,price_policy_id,second_price_policy_id,created_at,updated_at,updated_by)
 VALUES('preview-register','Preview','preview-warehouse','preview-price-a','preview-price-b','2026-11-09','2026-11-09','preview-owner');
 INSERT INTO web_store_orders(id,source,external_id,order_no,register_id,status,ordered_at,updated_at,total${withSnapshot?',financial_snapshot':''})
 VALUES('preview-order','lock','preview-external','PREVIEW-ORDER','preview-register','pending','2026-11-09','2026-11-09',12345${withSnapshot?',\'{"untouched":true}\'':''});`);
}

test('all repository migrations replay on empty PostgreSQL, including access migrations and every web-order dependency',async()=>{
 const db=await emptyDb(),journal=await replay(db);
 assert.equal(journal.size,files.length);
 const references=files.filter(f=>/\bweb_store_orders\b/i.test(read(f)));
 assert.equal(references[0],'20261019035500_web_store_orders.sql');
 assert.ok(references.indexOf(financial)>0);assert.ok(references.includes(guard));
 await snapshotColumn(db);
 const names=(await db.query("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='web_store_orders'")).rows.map(r=>r.column_name);
 for(const col of ['ghn_order_code','ghn_status','ghn_address_snapshot','stock_status','stock_note','crm_edit_snapshot','crm_order_no'])assert.ok(names.includes(col),col);
 assert.equal((await db.query("SELECT relrowsecurity FROM pg_class WHERE oid='public.web_store_orders'::regclass")).rows[0]!.relrowsecurity,true);
 assert.equal((await db.query("SELECT indexname FROM pg_indexes WHERE tablename='web_store_orders' AND indexname IN ('uq_web_store_order','idx_web_store_orders_register','idx_web_store_orders_stock')")).rows.length,3);
 await replay(db,[],journal);assert.equal(journal.size,files.length,'Recorded migrations are not rerun blindly');
});

test('existing table without financial_snapshot upgrades safely and the forward guard is repeatable',async()=>{
 const db=await emptyDb(),journal=await replay(db,[financial,guard]);await sentinel(db,false);
 const before=(await db.query('SELECT id,total,source,external_id FROM web_store_orders')).rows;
 await replay(db,[],journal);await db.exec(read(guard));await snapshotColumn(db);
 assert.deepEqual((await db.query('SELECT id,total,source,external_id FROM web_store_orders')).rows,before);
 assert.equal((await db.query('SELECT financial_snapshot FROM web_store_orders')).rows[0]!.financial_snapshot,'{}');
});

test('forward migration repairs a missing column even when old financial migration is already recorded',async()=>{
 const db=await emptyDb(),journal=await replay(db,[guard]);
 await db.exec('ALTER TABLE web_store_orders DROP COLUMN financial_snapshot');await sentinel(db,false);
 const before=(await db.query('SELECT id,total,source,external_id FROM web_store_orders')).rows;
 await replay(db,[],journal);await db.exec(read(guard));await snapshotColumn(db);
 assert.deepEqual((await db.query('SELECT id,total,source,external_id FROM web_store_orders')).rows,before);
});

test('existing snapshots and application schema survive exact, idempotent history repair',async()=>{
 const db=await emptyDb();await replay(db);await sentinel(db,true);
 const schema=async()=>(await db.query("SELECT table_name,column_name,data_type,column_default,is_nullable FROM information_schema.columns WHERE table_schema='public' ORDER BY table_name,ordinal_position")).rows;
 const before=await schema(),row=(await db.query('SELECT * FROM web_store_orders')).rows;
 await db.exec('CREATE SCHEMA supabase_migrations; CREATE TABLE supabase_migrations.schema_migrations(version text PRIMARY KEY,name text,statements text[])');
 await assert.rejects(db.exec(historyCheck),/Missing CREATE web_store_orders/);
 await db.exec(repair);await db.exec(repair);await db.exec(read(guard));
 assert.deepEqual(await schema(),before);assert.deepEqual((await db.query('SELECT * FROM web_store_orders')).rows,row);
 assert.equal((await db.query('SELECT * FROM supabase_migrations.schema_migrations')).rows.length,4);
 await db.exec(historyCheck);
});

test('financial guard fails visibly when CREATE is missing instead of masking an incomplete schema',async()=>{
 const db=await emptyDb();await assert.rejects(db.exec(read(guard)),/web_store_orders.*does not exist/);
});
