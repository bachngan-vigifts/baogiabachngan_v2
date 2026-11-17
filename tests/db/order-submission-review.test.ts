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
