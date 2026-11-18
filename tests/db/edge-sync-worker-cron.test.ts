import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createTestDb} from '../helpers/postgres.ts';
import {enqueueSyncJob} from '../../src/core/jobs/sync-jobs.ts';
import {syncJobs} from '../../src/core/db/schema.ts';
import {eq} from 'drizzle-orm';

test('real cron SQL suppresses idle/busy HTTP, uses the existing credential, and readiness fails closed',async()=>{
 const {db,client}=await createTestDb();
 // Local platform adapters only: no network, production tokens, or mutation of pg_extension.
 await client.exec(`CREATE SCHEMA net; CREATE SCHEMA vault; CREATE SCHEMA cron;
 CREATE TABLE vault.decrypted_secrets(name text,decrypted_secret text);
 INSERT INTO vault.decrypted_secrets VALUES('sapo_sync_token','test-only');
 CREATE TABLE net.test_calls(timeout_ms integer,auth_matches boolean);
 CREATE TABLE cron.job(jobname text,active boolean);
 CREATE FUNCTION net.http_post(url text,headers jsonb,body jsonb,timeout_milliseconds integer) RETURNS bigint LANGUAGE plpgsql AS $stub$
 BEGIN INSERT INTO net.test_calls VALUES(timeout_milliseconds,headers->>'authorization'='Bearer test-only');RETURN (SELECT count(*) FROM net.test_calls);END $stub$;`);
 const source=readFileSync(new URL('../../supabase/edge-sync-jobs-cron.sql',import.meta.url),'utf8');
 const start=source.indexOf('CREATE OR REPLACE FUNCTION'),end=source.indexOf('$fn$;',start)+'$fn$;'.length;
 await client.exec(source.slice(start,end));
 const invoke=async()=> (await client.query<{id:number|null}>('select public.edge_sync_jobs_tick() id')).rows[0]!.id;
 assert.equal(await invoke(),null);
 await enqueueSyncJob(db,'ghn');assert.equal(await invoke(),1);
 await db.insert(syncJobs).values({key:'__dispatcher',kind:'__dispatcher',status:'idle',availableAt:'1970-01-01T00:00:00.000Z',updatedAt:'1970-01-01T00:00:00.000Z',leaseUntil:new Date(Date.now()+60000).toISOString()});
 assert.equal(await invoke(),null);
 await db.update(syncJobs).set({leaseUntil:'1970-01-01T00:00:00.000Z'}).where(eq(syncJobs.key,'__dispatcher'));assert.equal(await invoke(),2);
 const calls=await client.query<{timeout_ms:number;auth_matches:boolean}>('select * from net.test_calls');assert(calls.rows.every(r=>r.timeout_ms===60000&&r.auth_matches));
 await db.update(syncJobs).set({status:'failed'}).where(eq(syncJobs.key,'ghn'));assert.equal(await invoke(),null);
 const gate=readFileSync(new URL('../../scripts/sql/assert-edge-sync-worker.sql',import.meta.url),'utf8');
 await assert.rejects(client.exec(gate),/Enable reviewed/);
 await client.exec("INSERT INTO cron.job VALUES('edge-sync-jobs',true)");
 await client.exec('BEGIN TRANSACTION READ ONLY');try{await client.exec(gate);}finally{await client.exec('ROLLBACK');}
});
