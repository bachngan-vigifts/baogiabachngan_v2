import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createTestDb} from '../helpers/postgres.ts';
test('deployment schema gate accepts migrated database and rejects missing employment column without changing data',async()=>{
 const {client}=await createTestDb(),gate=readFileSync('scripts/sql/assert-staff-employment.sql','utf8');
 await client.exec(gate);
 await client.exec('ALTER TABLE staff_members DROP COLUMN work_company');
 await assert.rejects(()=>client.exec(gate),/Missing staff employment schema/);
 const result=await client.query("SELECT column_name FROM information_schema.columns WHERE table_name='staff_members' AND column_name='work_company'");
 assert.equal(result.rows.length,0,'gate does not apply migration automatically');
});
