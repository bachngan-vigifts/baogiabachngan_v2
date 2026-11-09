import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
const install=readFileSync(new URL('../../supabase/sepay-pull-cron.sql',import.meta.url),'utf8');
const check=readFileSync(new URL('../../scripts/sql/assert-sepay-pull-cron.sql',import.meta.url),'utf8');

// Stub pg_cron's scheduling boundary, not its executor: exercise the real installer SQL,
// rollback, idempotence and Vault prerequisites without enqueueing an external request.
test('SePay operational installer is repeatable, keeps token in Vault and refuses missing prerequisites',async()=>{
 const db=new PGlite();
 try {
  await db.exec(`create schema cron; create schema vault;
   create table public.pg_extension(extname text);
   insert into public.pg_extension values('pg_cron'),('pg_net');
   set search_path=public,pg_catalog;
   create table vault.decrypted_secrets(name text,decrypted_secret text);
   insert into vault.decrypted_secrets values('sapo_sync_token','TEST_VAULT_MACHINE_TOKEN_32_CHARS_ONLY');
   create table cron.job(jobname text primary key,schedule text,command text,active boolean default true);
   create function cron.schedule(n text,s text,c text) returns bigint language plpgsql as $$
   begin
    insert into cron.job(jobname,schedule,command) values(n,s,c)
    on conflict(jobname) do update set schedule=excluded.schedule,command=excluded.command,active=true;
    return 1;
   end $$;
   create table customer_payments(id text,amount integer);
   insert into customer_payments values('existing',123);`);
  await db.exec(install);await db.exec(install);await db.exec(check);
  const jobs=await db.query<{jobname:string;schedule:string;command:string;active:boolean}>('select * from cron.job');
  assert.equal(jobs.rows.length,1);assert.equal(jobs.rows[0]!.schedule,'*/5 * * * *');
  assert.ok(!jobs.rows[0]!.command.includes('TEST_VAULT'));
  assert.ok(jobs.rows[0]!.command.includes('/integrations/sepay/pull'));
  assert.deepEqual((await db.query('select * from customer_payments')).rows,[{id:'existing',amount:123}]);
  await db.exec('delete from vault.decrypted_secrets');
  await assert.rejects(db.exec(install),/token máy chủ/);await db.exec('rollback');
  assert.equal((await db.query('select * from cron.job')).rows.length,1);
  await db.exec('update cron.job set active=false');
  await assert.rejects(db.exec(check),/chưa hoạt động/);
 } finally {await db.close();}
});
