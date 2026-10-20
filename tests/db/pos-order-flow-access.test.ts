import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createTestDb } from '../helpers/postgres.ts';
test('migration cọc/trả trước bật RLS và thu hồi cả grant trực tiếp lẫn PUBLIC; không cấp client đọc/ghi tiền',async()=>{
 const {client}=await createTestDb();await client.exec('CREATE ROLE anon; CREATE ROLE authenticated; GRANT ALL ON pos_order_reservations,pos_payment_intents TO PUBLIC,anon,authenticated;');
 await client.exec(readFileSync(new URL('../../migrations/postgres/20261020011018_supabase_access_pos_deposit_prepaid.sql',import.meta.url),'utf8'));
 const flags=await client.query<{relrowsecurity:boolean}>("select relrowsecurity from pg_class where relname in ('pos_order_reservations','pos_payment_intents')");assert.equal(flags.rows.length,2);assert.ok(flags.rows.every(r=>r.relrowsecurity));
 const grants=await client.query<{allowed:boolean}>("select has_table_privilege(r.role,t.tab,p.priv) as allowed from (values ('anon'),('authenticated')) r(role) cross join (values ('pos_order_reservations'),('pos_payment_intents')) t(tab) cross join (values ('SELECT'),('INSERT'),('UPDATE'),('DELETE')) p(priv)");assert.ok(grants.rows.every(r=>!r.allowed));
 const [r]= (await client.query<{column_default:string}>("select column_default from information_schema.columns where table_name='pos_returns' and column_name='request_context'")).rows;assert.match(r!.column_default,/after_delivery/);
});
