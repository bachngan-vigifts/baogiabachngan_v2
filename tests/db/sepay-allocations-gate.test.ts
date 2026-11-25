import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createTestDb} from '../helpers/postgres.ts';
test('SePay allocation gate passes read-only and rejects missing schema, uniqueness, checks and RLS in local fixtures',async()=>{
 const {client}=await createTestDb(),gate=readFileSync(new URL('../../scripts/sql/assert-sepay-allocations.sql',import.meta.url),'utf8');
 await client.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; GRANT ALL ON sepay_reconciliation_states,sepay_allocation_batches,sepay_payment_allocations TO anon,authenticated,service_role');
 // createTestDb applied the real SQL once. A rerun must keep the same private schema.
 await client.exec(readFileSync(new URL('../../migrations/postgres/20261123095718_sepay_allocations.sql',import.meta.url),'utf8'));
 await client.exec('BEGIN READ ONLY');await client.exec(gate);await client.exec('ROLLBACK');
 for(const mutation of ['DROP TABLE sepay_payment_allocations','DROP INDEX uq_sepay_allocation_client','ALTER TABLE sepay_payment_allocations DISABLE ROW LEVEL SECURITY','ALTER TABLE sepay_payment_allocations DROP CONSTRAINT chk_sepay_allocation_amount']){
  await client.exec('BEGIN');await client.exec(mutation);await client.exec('SAVEPOINT gate');await assert.rejects(client.exec(gate));await client.exec('ROLLBACK TO SAVEPOINT gate');await client.exec('ROLLBACK');
 }
});
test('overpayment migration is repeatable and its read-only gate rejects the old cap',async()=>{
 const {client}=await createTestDb(),migration=readFileSync(new URL('../../migrations/postgres/20261125113000_sepay_allocation_overpayment.sql',import.meta.url),'utf8'),gate=readFileSync(new URL('../../scripts/sql/assert-sepay-overpayment.sql',import.meta.url),'utf8');
 await client.exec(migration);await client.exec('BEGIN READ ONLY');await client.exec(gate);await client.exec('ROLLBACK');
 await client.exec('BEGIN; ALTER TABLE sepay_payment_allocations DROP CONSTRAINT chk_sepay_allocation_amount; ALTER TABLE sepay_payment_allocations ADD CONSTRAINT chk_sepay_allocation_amount CHECK (amount>0 AND target_total>=amount); SAVEPOINT old_cap;');
 await assert.rejects(client.exec(gate));await client.exec('ROLLBACK TO SAVEPOINT old_cap; ROLLBACK;');
});
