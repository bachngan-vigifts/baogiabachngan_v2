import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createTestDb} from '../helpers/postgres.ts';
const migration=readFileSync(new URL('../../migrations/postgres/20261122090000_transfer_create_mode.sql',import.meta.url),'utf8');
const gate=readFileSync(new URL('../../scripts/sql/assert-transfer-create-mode.sql',import.meta.url),'utf8');
test('transfer create-mode gate is read-only and blocks an absent mode column',async()=>{
 const {client}=await createTestDb();
 await client.exec(migration); // Repeat application leaves the schema intact.
 const reserved=process.env.TEST_PG_URL?await (client as unknown as {sql:import('postgres').Sql}).sql.reserve():null;
 const exec=async(text:string)=>{if(reserved)await reserved.unsafe(text).simple();else await client.exec(text);};
 try{
  await exec('BEGIN READ ONLY;'+gate+'COMMIT;');
  await exec('BEGIN;ALTER TABLE stock_transfers DROP COLUMN create_mode CASCADE;');
  await assert.rejects(()=>exec(gate),/transfer_create_mode|create_mode/);await exec('ROLLBACK;');
  await exec(gate);
 }finally{await exec('ROLLBACK;');reserved?.release();}
});
