import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createTestDb} from '../helpers/postgres.ts';
const gate=readFileSync(new URL('../../scripts/sql/assert-warehouse-image-jobs.sql',import.meta.url),'utf8');
test('warehouse image gate is repeatable read-only and rejects partial queue schemas without repair',async()=>{
 const f=await createTestDb();
 await f.client.exec('BEGIN TRANSACTION READ ONLY');try{await f.client.exec(gate);await f.client.exec(gate);}finally{await f.client.exec('ROLLBACK');}
 for(const ddl of [
  'DROP TABLE warehouse_image_jobs',
  'DROP TABLE warehouse_image_queue_state',
  'ALTER TABLE warehouse_image_jobs DROP COLUMN callback_token_hash',
  'ALTER TABLE warehouse_image_jobs ALTER COLUMN callback_token_hash SET NOT NULL',
  'ALTER TABLE warehouse_image_jobs ALTER COLUMN position_hint TYPE text',
  'ALTER TABLE warehouse_image_jobs DISABLE ROW LEVEL SECURITY',
  'ALTER TABLE warehouse_image_queue_state DISABLE ROW LEVEL SECURITY',
  'ALTER TABLE warehouse_image_jobs DROP CONSTRAINT warehouse_image_jobs_image_hash_key',
  'ALTER TABLE warehouse_image_jobs DROP CONSTRAINT chk_warehouse_image_jobs_status',
  'DROP INDEX idx_warehouse_image_jobs_queue',
 ]){
  await f.client.exec('BEGIN');try{await f.client.exec(ddl);await assert.rejects(f.client.exec(gate),/20261115233000_warehouse_image_job_queue.sql/,ddl);}finally{await f.client.exec('ROLLBACK');}
 }
 await f.client.exec(gate);
});
