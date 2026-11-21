import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createTestDb} from '../helpers/postgres.ts';
test('Customer profile revision deploy gate is read-only and detects missing column, constraint and trigger',async()=>{
 const {client}=await createTestDb(),gate=readFileSync(new URL('../../scripts/sql/assert-customer-profile-revision.sql',import.meta.url),'utf8');
 await client.exec('BEGIN READ ONLY;'+gate+'COMMIT;');
 await client.exec('ALTER TABLE sapo_customers DISABLE TRIGGER trg_customer_profile_revision');await assert.rejects(client.exec(gate),/Missing enabled trigger/);
 await client.exec('ALTER TABLE sapo_customers ENABLE TRIGGER trg_customer_profile_revision');await client.exec(gate);
 await client.exec('ALTER TABLE sapo_customers DROP CONSTRAINT chk_customer_profile_revision');await assert.rejects(client.exec(gate),/chk_customer_profile_revision/);
 await client.exec('DROP TRIGGER trg_customer_profile_revision ON sapo_customers; ALTER TABLE sapo_customers DROP COLUMN profile_revision');await assert.rejects(client.exec(gate),/Run 20261121160000/);
});
