import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createTestDb} from '../helpers/postgres.ts';
test('Purchase-order intent deploy gate is read-only and detects missing table, RLS, direct grants and constraints',async()=>{
 const {client}=await createTestDb(),gate=readFileSync(new URL('../../scripts/sql/assert-purchase-order-intents.sql',import.meta.url),'utf8');
 await client.exec('CREATE ROLE anon; CREATE ROLE authenticated;');
 await client.exec('BEGIN READ ONLY;'+gate+'COMMIT;');
 await client.exec('GRANT SELECT ON purchase_order_intents TO anon');await assert.rejects(client.exec(gate),/must not access/);await client.exec('REVOKE SELECT ON purchase_order_intents FROM anon');
 await client.exec('ALTER TABLE purchase_order_intents DISABLE ROW LEVEL SECURITY');await assert.rejects(client.exec(gate),/RLS/);await client.exec('ALTER TABLE purchase_order_intents ENABLE ROW LEVEL SECURITY');
 await client.exec('ALTER TABLE purchase_order_intents DROP CONSTRAINT chk_purchase_order_intents_hash');await assert.rejects(client.exec(gate),/Missing validated constraint/);
 await client.exec('DROP TABLE purchase_order_intents');await assert.rejects(client.exec(gate),/Run 20261121150000/);
});
