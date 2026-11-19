import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createTestDb} from '../helpers/postgres.ts';
test('Supplier return deploy gate is read-only and detects missing constraints, RLS and direct grants',async()=>{
 const {client}=await createTestDb(),gate=readFileSync(new URL('../../scripts/sql/assert-supplier-goods-returns.sql',import.meta.url),'utf8');
 await client.exec('CREATE ROLE anon; CREATE ROLE authenticated;');
 await client.exec('BEGIN READ ONLY;'+gate+'COMMIT;');
 await client.exec('GRANT SELECT ON supplier_goods_returns TO anon');await assert.rejects(client.exec(gate),/Unexpected direct access/);await client.exec('REVOKE SELECT ON supplier_goods_returns FROM anon');
 await client.exec('ALTER TABLE supplier_refunds DISABLE ROW LEVEL SECURITY');await assert.rejects(client.exec(gate),/RLS/);await client.exec('ALTER TABLE supplier_refunds ENABLE ROW LEVEL SECURITY');
 await client.exec('ALTER TABLE supplier_receipt_lines DROP CONSTRAINT chk_receipt_lines_returned');await assert.rejects(client.exec(gate),/Missing validated constraint/);
});
