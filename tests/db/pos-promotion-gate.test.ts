import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import type { Sql } from 'postgres';
import {createTestDb} from '../helpers/postgres.ts';

const gate=readFileSync('scripts/sql/assert-pos-promotion-programs.sql','utf8');
test('POS promotion gate is read-only/repeatable and rejects missing/partial schema without repair',async()=>{
 const {client}=await createTestDb();
 const reserved=process.env.TEST_PG_URL ? await (client as unknown as {sql:Sql}).sql.reserve() : null;
 const exec=async (query:string)=>{if(reserved) await reserved.unsafe(query).simple(); else await client.exec(query);};
 try {
 for(let i=0;i<2;i++){
  await exec('begin read only');
  try {await exec(gate);} finally {await exec('rollback');}
 }
 for(const mutation of [
  'drop table pos_promotion_programs',
  'alter table pos_promotion_programs drop column revision',
  'alter table pos_promotion_programs disable row level security',
  'alter table pos_promotion_programs drop constraint pos_promotion_programs_pkey',
  'alter table pos_promotion_programs drop constraint pos_promotion_programs_gift_sku_fkey',
  'alter table pos_promotion_programs drop constraint chk_pos_promotion_values',
 ]){
  await exec('begin');
  try{
   await exec(mutation); await exec('savepoint broken');
   await assert.rejects(exec(gate),/20261113054030_pos_promotion_programs.sql/);
   await exec('rollback to savepoint broken');
   // Repeating a failed gate must not repair the deliberately broken schema.
   await assert.rejects(exec(gate),/20261113054030_pos_promotion_programs.sql/);
  }finally{await exec('rollback');}
 }
 } finally {reserved?.release();}
});
