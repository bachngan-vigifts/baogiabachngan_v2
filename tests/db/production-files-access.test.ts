import {test} from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {createTestDb} from '../helpers/postgres.ts';
test('production metadata is private to server routes, deploy gate fails on missing proof columns',async()=>{
 const {client}=await createTestDb();await client.exec("DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF; IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF; END $$;");
 const gate=readFileSync(new URL('../../scripts/sql/assert-production-files.sql',import.meta.url),'utf8');for(let i=0;i<2;i++){await client.exec('BEGIN TRANSACTION READ ONLY');try{await client.exec(gate);}finally{await client.exec('ROLLBACK');}}
 await client.exec('ALTER TABLE sales_production_files DROP COLUMN md5');await assert.rejects(()=>client.exec(gate),/missing column.*md5/);
});
