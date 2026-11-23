import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
const read=(path:string)=>readFileSync(new URL('../../'+path,import.meta.url),'utf8');
const source=read('migrations/postgres/20261023120000_product_created_at.sql');
const repair=read('scripts/sql/repair-preview-product-created-at-history.sql');
const newest=read('migrations/postgres/20261118120000_products_newest_index.sql');
const baseline=`create table products(sku text primary key,name text,active boolean,sapo_product_id text,created_by text,approved_at text);`;
test('recorded prerequisite replays before newest index and repair changes metadata only, idempotently',async()=>{
 const db=new PGlite();
 try{
  await db.exec(baseline);
  await assert.rejects(db.exec(newest),/created_at/);
  await db.exec(`create schema supabase_migrations; create table supabase_migrations.schema_migrations(version text primary key,name text,statements text[]);`);
  await assert.rejects(db.exec(repair),/schema must be present/);await db.exec('rollback');
  assert.equal((await db.query('select * from supabase_migrations.schema_migrations')).rows.length,0);
  await db.exec(source);
  await db.exec(`insert into products(sku,name,active,created_by,approved_at,created_at) values('HISTORY-TEST','Sản phẩm',true,'fixture','2026-01-01','2026-01-02')`);
  const before=await db.query('select * from products');
  await db.exec(repair);await db.exec(repair);
  assert.deepEqual((await db.query('select * from products')).rows,before.rows);
  const rows=await db.query<{version:string;statements:string[]}>('select version,statements from supabase_migrations.schema_migrations');
  assert.equal(rows.rows.length,1);assert.equal(rows.rows[0]!.version,'20261023120000');assert.deepEqual(rows.rows[0]!.statements,[source]);
  const fresh=new PGlite();try{
   await fresh.exec(baseline);await fresh.exec(rows.rows[0]!.statements.join('\n'));await fresh.exec(newest);
   assert.equal((await fresh.query<{indisvalid:boolean}>(`select indisvalid from pg_index where indexrelid='idx_products_newest_active'::regclass`)).rows[0]?.indisvalid,true);
  }finally{await fresh.close();}
 }finally{await db.close();}
});
