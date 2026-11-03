import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createTestDb} from '../helpers/postgres.ts';
test('transfer integration migration is repeatable, preserves activation and removes PUBLIC/browser grants with RLS',async()=>{
 const {client}=await createTestDb();
 await client.exec('CREATE ROLE anon; CREATE ROLE authenticated;');
 const names=['stock_transfer_outbox','stock_transfer_integration_settings'];
 for(const name of names)await client.exec(`GRANT ALL ON public.${name} TO PUBLIC,anon,authenticated;`);
 await client.exec("UPDATE stock_transfer_integration_settings SET enabled=true,integration_activated_at='2026-11-02T00:00:00.000Z';");
 const migration=readFileSync(new URL('../../migrations/postgres/20261102104511_transfer_received_outbox.sql',import.meta.url),'utf8');
 await client.exec(migration);await client.exec(migration);
 for(const name of names){
  const r=await client.query<{rls:boolean;anon:boolean;authenticated:boolean;policies:number}>(`select c.relrowsecurity as rls,has_table_privilege('anon',c.oid,'SELECT') as anon,has_table_privilege('authenticated',c.oid,'INSERT') as authenticated,(select count(*)::int from pg_policies where tablename=$1) as policies from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relname=$1 and n.nspname='public'`,[name]);
  assert.deepEqual(r.rows[0],{rls:true,anon:false,authenticated:false,policies:0});
 }
 const r=await client.query<{enabled:boolean;integration_activated_at:string}>('select enabled,integration_activated_at from stock_transfer_integration_settings');assert.equal(r.rows[0]!.enabled,true);assert.equal(r.rows[0]!.integration_activated_at,'2026-11-02T00:00:00.000Z');
 const gate=readFileSync(new URL('../../scripts/sql/assert-transfer-outbox.sql',import.meta.url),'utf8');
 await client.exec(gate);
 await client.exec('ALTER TABLE stock_transfer_outbox DROP COLUMN destination_url;');
 await assert.rejects(()=>client.exec(gate),/Transfer migration incomplete: stock_transfer_outbox.destination_url/);
});
