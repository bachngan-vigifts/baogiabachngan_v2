import {contractTest as test,assert} from '../TEST_TEMPLATE.ts';
import {readFileSync} from 'node:fs';
import {createTestDb} from '../helpers/postgres.ts';
test('custody migration is rerunnable, private with RLS, and deploy gate rejects missing columns',async()=>{
 const {client}=await createTestDb();await client.exec("DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF; IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF; END $$;");
 const migration=readFileSync(new URL('../../migrations/postgres/20261107161337_product_custody.sql',import.meta.url),'utf8');await client.exec(migration.replaceAll('--> statement-breakpoint',''));
 const gate=readFileSync(new URL('../../scripts/sql/assert-product-custody.sql',import.meta.url),'utf8');await client.exec(gate);
 await client.exec('ALTER TABLE product_custody_events DROP COLUMN fingerprint;');await assert.rejects(()=>client.exec(gate),/Missing custody column product_custody_events.fingerprint/);
});
