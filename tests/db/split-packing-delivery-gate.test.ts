import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import type {Sql} from 'postgres';
import {createTestDb} from '../helpers/postgres.ts';

const gate=readFileSync('scripts/sql/assert-split-packing-delivery-dates.sql','utf8');
test('split-delivery gate is read-only and detects missing or weakened schema without backfill',async()=>{
 const {client}=await createTestDb();
 const reserved=process.env.TEST_PG_URL ? await (client as unknown as {sql:Sql}).sql.reserve() : null;
 const exec=async(query:string)=>{if(reserved)await reserved.unsafe(query).simple();else await client.exec(query);};
 try{
  for(let i=0;i<2;i++){
   await exec('begin read only');try{await exec(gate);}finally{await exec('rollback');}
  }
  for(const mutation of [
   'alter table packing_slips drop column plan_source',
   'alter table packing_slips drop column planned_delivery_date',
   'alter table packing_slips alter column plan_source set not null',
   "alter table packing_slips alter column planned_delivery_date set default '2026-11-13'",
   'alter table packing_slips drop constraint chk_packing_plan_source',
   "alter table packing_slips drop constraint chk_packing_plan_source;alter table packing_slips add constraint chk_packing_plan_source check(plan_source is null or plan_source='stock')",
   'alter table packing_slips drop constraint chk_packing_planned_delivery_date',
   "alter table packing_slips drop constraint chk_packing_planned_delivery_date;alter table packing_slips add constraint chk_packing_planned_delivery_date check(planned_delivery_date is null or length(planned_delivery_date)=10)",
  ]){
   await exec('begin');try{
    await exec(mutation);await exec('savepoint broken');
    await assert.rejects(exec(gate),/20261113074715_split_packing_delivery_dates.sql/);
    await exec('rollback to savepoint broken');
    await assert.rejects(exec(gate),/20261113074715_split_packing_delivery_dates.sql/);
   }finally{await exec('rollback');}
  }
 }finally{reserved?.release();}
});
