import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createTestDb} from '../helpers/postgres.ts';
const gate=readFileSync(new URL('../../scripts/sql/assert-edge-sync-jobs.sql',import.meta.url),'utf8');
test('sync queue schema gate is read-only and rejects incomplete schema / client access without repair',async()=>{
 const {client}=await createTestDb();
 await client.exec('BEGIN TRANSACTION READ ONLY');try{await client.exec(gate);}finally{await client.exec('ROLLBACK');}
 for(const change of ['ALTER TABLE edge_sync_jobs DROP COLUMN lease_until','ALTER TABLE edge_sync_jobs DISABLE ROW LEVEL SECURITY','GRANT SELECT ON edge_sync_jobs TO PUBLIC','CREATE POLICY leaked ON edge_sync_jobs FOR SELECT USING (true)']){
  await client.exec('BEGIN');try{await client.exec(change);await assert.rejects(client.exec(gate),/20261118050000_edge_sync_jobs.sql/);}finally{await client.exec('ROLLBACK');}
 }
 await client.exec(gate);
});
