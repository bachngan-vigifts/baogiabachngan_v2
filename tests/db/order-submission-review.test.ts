import{test}from'node:test';import assert from'node:assert/strict';import{readFileSync}from'node:fs';
import{createTestDb}from'../helpers/postgres.ts';
test('Submission migration is additive, nullable for legacy rows and safe to run twice; existing RLS stays enabled',async()=>{
 const {client}=await createTestDb();
 const migration=readFileSync(new URL('../../migrations/postgres/20261117130655_order_submission_review.sql',import.meta.url),'utf8');
 await client.exec(migration);await client.exec(migration);
 const column=await client.query<{is_nullable:string;data_type:string}>("select is_nullable,data_type from information_schema.columns where table_schema='public' and table_name='sales_orders' and column_name='submission_review'");
 assert.deepEqual(column.rows,[{is_nullable:'YES',data_type:'text'}]);
 const rls=await client.query<{relrowsecurity:boolean}>("select relrowsecurity from pg_class where oid='public.sales_orders'::regclass");assert.equal(rls.rows[0]!.relrowsecurity,true);
});

test('Submission deploy gate is read-only, repeatable and rejects missing/wrong schema or disabled RLS without repair',async()=>{
 const {client}=await createTestDb();
 const gate=readFileSync(new URL('../../scripts/sql/assert-order-submission-review.sql',import.meta.url),'utf8');
 for(let i=0;i<2;i++){
  await client.exec('BEGIN TRANSACTION READ ONLY');
  try{await client.exec(gate);}finally{await client.exec('ROLLBACK');}
 }
 for(const mutation of [
  'ALTER TABLE sales_orders DROP COLUMN submission_review',
  'ALTER TABLE sales_orders ALTER COLUMN submission_review TYPE varchar(2000)',
  'ALTER TABLE sales_orders ALTER COLUMN submission_review SET NOT NULL',
  "ALTER TABLE sales_orders ALTER COLUMN submission_review SET DEFAULT '{}'",
  'ALTER TABLE sales_orders DISABLE ROW LEVEL SECURITY',
 ]){
  await client.exec('BEGIN');
  try{
   await client.exec(mutation);
   const before=JSON.stringify((await client.query("SELECT column_name,data_type,is_nullable,column_default FROM information_schema.columns WHERE table_schema='public' AND table_name='sales_orders' ORDER BY ordinal_position")).rows);
   await client.exec('SAVEPOINT gate_check');
   await assert.rejects(client.exec(gate),/20261117130655_order_submission_review.sql/);
   await client.exec('ROLLBACK TO SAVEPOINT gate_check');
   const after=JSON.stringify((await client.query("SELECT column_name,data_type,is_nullable,column_default FROM information_schema.columns WHERE table_schema='public' AND table_name='sales_orders' ORDER BY ordinal_position")).rows);
   assert.equal(after,before,'assertion must not repair the database');
  }finally{await client.exec('ROLLBACK');}
 }
});
