import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createTestDb} from '../helpers/postgres.ts';
test('supplier workspace migration is repeatable and tables have RLS, no browser grants or public policy',async()=>{
 const{client}=await createTestDb(),names=['supplier_published_stock','supplier_portal_invoices','supplier_portal_deliveries','supplier_portal_delivery_lines','supplier_transfer_shares'];
 await client.exec('CREATE ROLE anon;CREATE ROLE authenticated;');
 for(const t of names)await client.exec(`GRANT ALL ON public.${t} TO PUBLIC,anon,authenticated;`);
 const migration=readFileSync(new URL('../../migrations/postgres/20261112073225_supplier_workspace.sql',import.meta.url),'utf8');await client.exec(migration);await client.exec(migration);
 const gate=readFileSync(new URL('../../scripts/sql/assert-supplier-workspace.sql',import.meta.url),'utf8');await client.exec('BEGIN TRANSACTION READ ONLY;'+gate+'COMMIT;');
 for(const name of names){const r=await client.query<{rls:boolean;anon:boolean;authenticated:boolean;policies:number}>(`SELECT c.relrowsecurity rls,has_table_privilege('anon',c.oid,'SELECT') anon,has_table_privilege('authenticated',c.oid,'INSERT') authenticated,(select count(*)::int from pg_policies where tablename=$1) policies from pg_class c where oid=to_regclass('public.'||$1)`,[name]);assert.deepEqual(r.rows[0],{rls:true,anon:false,authenticated:false,policies:0});}
 await client.exec('DROP INDEX public.uq_supplier_portal_invoice_key;');await assert.rejects(client.exec(gate),/Thiếu index hợp lệ/);await client.exec(migration);
 await client.exec('GRANT SELECT ON public.supplier_published_stock TO anon;');await assert.rejects(client.exec(gate),/chưa được thu hồi/);await client.exec(migration);
 await client.exec('BEGIN TRANSACTION READ ONLY;'+gate+'COMMIT;');
});

test('supplier stock check migration is repeatable, private and read-only assertion catches omissions',async()=>{
 const{client}=await createTestDb();
 await client.exec('CREATE ROLE anon;CREATE ROLE authenticated;');
 const migration=readFileSync(new URL('../../migrations/postgres/20261112104633_supplier_stock_checks.sql',import.meta.url),'utf8'),gate=readFileSync(new URL('../../scripts/sql/assert-supplier-stock-checks.sql',import.meta.url),'utf8');
 await client.exec(migration);await client.exec(migration);await client.exec('BEGIN TRANSACTION READ ONLY;'+gate+'COMMIT;');
 await client.exec('GRANT SELECT ON supplier_stock_checks TO PUBLIC');await assert.rejects(client.exec(gate),/chưa được thu hồi/);await client.exec(migration);
 await client.exec('DROP INDEX idx_supplier_stock_checks_supplier_date');await assert.rejects(client.exec(gate),/Thiếu index/);await client.exec(migration);
 await client.exec('ALTER TABLE supplier_stock_check_lines DISABLE ROW LEVEL SECURITY');await assert.rejects(client.exec(gate),/chưa bật RLS/);await client.exec(migration);
 await client.exec('ALTER TABLE supplier_stock_check_lines DROP CONSTRAINT chk_supplier_stock_check_response');await assert.rejects(client.exec(gate),/Thiếu kiểm tra phản hồi/);
});
