import { contractTest as test, assert } from '../TEST_TEMPLATE.ts';
import { readFileSync } from 'node:fs';
import { createTestDb } from '../helpers/postgres.ts';
const gate=readFileSync('scripts/sql/assert-appsheet-customers.sql','utf8');
test('AppSheet deploy gate accepts complete schema and rejects missing fields without applying production DDL',async()=>{
  const {client}=await createTestDb();await client.exec(gate);
  await client.exec('ALTER TABLE sapo_customers DROP COLUMN customer_type');
  await assert.rejects(()=>client.exec(gate),/Missing AppSheet customer schema/);
  const missing=await client.query("SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='sapo_customers' AND column_name='customer_type'");
  assert.equal(missing.rows.length,0,'read-only gate never repairs schema automatically');
});
test('AppSheet deploy gate rejects missing tables/RLS and runs before API, secrets or migrations',async()=>{
  const {client}=await createTestDb();await client.exec('ALTER TABLE appsheet_contact_links DISABLE ROW LEVEL SECURITY');
  await assert.rejects(()=>client.exec(gate),/Missing AppSheet customer schema/);
  await client.exec('ALTER TABLE appsheet_contact_links ENABLE ROW LEVEL SECURITY; DROP TABLE appsheet_contact_links');
  await assert.rejects(()=>client.exec(gate),/Missing AppSheet customer schema/);
  const workflow=readFileSync('.github/workflows/deploy-api.yml','utf8'),at=workflow.indexOf('scripts/sql/assert-appsheet-customers.sql');
  assert.ok(at>0);for(const step of ['Migration trước khi triển khai API','Cập nhật mã bí mật đồng bộ Sapo','Triển khai Edge Function'])assert.ok(at<workflow.indexOf(step),step);
});
