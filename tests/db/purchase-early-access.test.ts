import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createTestDb } from '../helpers/postgres.ts';
test('xin lấy trước: schema RLS và revoke cả PUBLIC/anon/authenticated, không policy mở dòng',async()=>{
  const {client}=await createTestDb();
  await client.exec('create role anon;create role authenticated;');
  const names=['purchase_early_requests','purchase_early_request_lines','purchase_early_request_allocations'];
  for(const name of names)await client.exec(`grant all on public.${name} to PUBLIC,anon,authenticated;`);
  await client.exec(readFileSync(new URL('../../migrations/postgres/20261021063421_supabase_access_purchase_early_requests.sql',import.meta.url),'utf8'));
  for(const name of names) {
    const r=await client.query<{rls:boolean;anon:boolean;authenticated:boolean;policies:number}>(`select c.relrowsecurity as rls,has_table_privilege('anon',c.oid,'SELECT') as anon,has_table_privilege('authenticated',c.oid,'INSERT') as authenticated,(select count(*)::int from pg_policies where tablename=$1) as policies from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relname=$1 and n.nspname='public'`,[name]);
    assert.deepEqual(r.rows[0],{rls:true,anon:false,authenticated:false,policies:0});
  }
});
