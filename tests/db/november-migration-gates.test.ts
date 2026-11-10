import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import type { Sql } from 'postgres';
import { createTestDb } from '../helpers/postgres.ts';
import coverage from '../../scripts/sql/november-migration-coverage.json' with { type: 'json' };
import extras from '../../scripts/sql/november-migration-extra-checks.json' with { type: 'json' };

const root = new URL('../../', import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), 'utf8');
const gate = (name: string) => read(`scripts/sql/${name}`);

// Reserve one native connection: BEGIN/ROLLBACK must never cross pooled connections.
async function fixture() {
  const { client } = await createTestDb();
  const reserved = process.env.TEST_PG_URL
    ? await (client as unknown as { sql: Sql }).sql.reserve() : null;
  const exec = async (sql: string) => {
    if (reserved) await reserved.unsafe(sql).simple();
    else await client.exec(sql);
  };
  // Local fixture only. Include custom positions rather than relying on runtime bootstrap seeds.
  await exec(`INSERT INTO staff_positions(id,name) VALUES
    ('sale-admin','Sale Admin'),('accounting','Kế toán'),('audit-custom','Custom') ON CONFLICT DO NOTHING;
    INSERT INTO staff_position_permissions(position_id,permission) VALUES
    ('audit-custom','page.orders'),('audit-custom','page.purchases') ON CONFLICT DO NOTHING;`);
  for (const file of ['20261107074837_order_products_page_permission.sql', '20261111090000_purchase_permissions.sql'])
    await exec(read(`migrations/postgres/${file}`));
  return { exec, release: () => reserved?.release() };
}

test('every November migration maps to existing SQL gates wired into API deployment', () => {
  const files = readdirSync(new URL('migrations/postgres/', root)).filter(f => /^202611.*\.sql$/.test(f)).sort();
  assert.deepEqual(coverage.map(x => x.migration).sort(), files);
  const workflow = read('.github/workflows/deploy-api.yml');
  for (const item of coverage) {
    assert.ok(item.asserts.length > 0, item.migration);
    for (const file of item.asserts) {
      assert.ok(gate(file).includes('RAISE EXCEPTION'), file);
      assert.ok(workflow.includes(`scripts/sql/${file}`), `${file} is not deployed`);
    }
  }
  for (const item of extras) {
    assert.ok(gate(item.assert).includes(item.migration), item.assert);
    assert.ok(coverage.some(c => c.migration === item.migration && c.asserts.includes(item.assert)));
  }
});

test('new gates are repeatable inside READ ONLY transactions; PGlite rejects missing pg_trgm', async () => {
  const f = await fixture();
  try {
    for (const item of extras) {
      for (let repeat = 0; repeat < 2; repeat++) {
        await f.exec('BEGIN TRANSACTION READ ONLY');
        try {
          if (item.assert === 'assert-product-search-trigram.sql' && !process.env.TEST_PG_URL)
            await assert.rejects(f.exec(gate(item.assert)), /20261103095218_product_search_trigram.sql/);
          else await f.exec(gate(item.assert));
        } finally { await f.exec('ROLLBACK'); }
      }
    }
  } finally { f.release(); }
});

test('partial migrations, wrong definitions and revoked seeds fail without repair', async () => {
  const f = await fixture();
  const cases: [string, string, string?, string?][] = [
    ['assert-crm-catalog-autovacuum.sql', 'ALTER TABLE products RESET (autovacuum_analyze_scale_factor)'],
    ['assert-internal-reports.sql', 'DROP INDEX idx_sales_orders_report_date; CREATE INDEX idx_sales_orders_report_date ON sales_orders(order_date) WHERE status=\'draft\''],
    ['assert-payroll-attendance-counters.sql', 'ALTER TABLE hr_payroll_inputs ALTER COLUMN late_count DROP DEFAULT'],
    ['assert-order-products-page-permission.sql', "DELETE FROM staff_position_permissions WHERE position_id='audit-custom' AND permission='page.order-products'", undefined,
      "DO $$ BEGIN IF EXISTS(SELECT 1 FROM staff_position_permissions WHERE position_id='audit-custom' AND permission='page.order-products') THEN RAISE EXCEPTION 'gate must not regrant permissions'; END IF; END $$;"],
    ['assert-purchase-permissions.sql', "DELETE FROM staff_position_permissions WHERE position_id='accounting' AND permission='purchases.confirm'", undefined,
      "DO $$ BEGIN IF EXISTS(SELECT 1 FROM staff_position_permissions WHERE position_id='accounting' AND permission='purchases.confirm') THEN RAISE EXCEPTION 'gate must not regrant permissions'; END IF; END $$;"],
    ['assert-purchase-permissions.sql', "DELETE FROM staff_position_permissions WHERE position_id='audit-custom' AND permission='purchases.early-view'"],
    ['assert-historical-cost-sources.sql', "ALTER TABLE sales_line_costs DROP CONSTRAINT chk_sales_line_costs_source; ALTER TABLE sales_line_costs ADD CONSTRAINT chk_sales_line_costs_source CHECK(source IN ('quote','purchase','purchase_later','manual'))"],
    ['assert-customer-established-date-complete.sql', 'ALTER TABLE sapo_customers DROP CONSTRAINT chk_customer_established_date'],
    ['assert-hr-revenue-targets-complete.sql', 'DROP INDEX idx_hr_revenue_targets_month'],
    ['assert-hr-revenue-target-requests-complete.sql', 'ALTER TABLE hr_revenue_target_requests DROP CONSTRAINT chk_hr_revenue_request_resolution'],
    ['assert-sales-payroll-team-sources-complete.sql', 'ALTER TABLE sales_payroll_team_sources DISABLE ROW LEVEL SECURITY'],
    ['assert-customer-profile-fields-complete.sql', 'ALTER TABLE sapo_customers DROP CONSTRAINT fk_sapo_customers_representative', 'assert-customer-profile-fields.sql'],
    ['assert-customer-profile-fields-complete.sql', 'DROP INDEX idx_sapo_customers_representative; CREATE INDEX idx_sapo_customers_representative ON sapo_customers(representative_contact_id)', 'assert-customer-profile-fields.sql'],
    ['assert-customer-profile-fields-complete.sql', 'ALTER TABLE customer_debt_notes DROP CONSTRAINT chk_customer_debt_notes_length', 'assert-customer-profile-fields.sql'],
    ['assert-customer-profile-fields-complete.sql', 'GRANT SELECT ON customer_debt_notes TO PUBLIC'],
    ['assert-customer-profile-fields-complete.sql', "ALTER TABLE customer_debt_notes DROP CONSTRAINT customer_debt_notes_customer_id_fkey; ALTER TABLE customer_debt_notes ADD CONSTRAINT customer_debt_notes_customer_id_fkey FOREIGN KEY(customer_id) REFERENCES sapo_customers(id)", 'assert-customer-profile-fields.sql'],
  ];
  if (process.env.TEST_PG_URL) cases.push(['assert-product-search-trigram.sql', 'DROP INDEX idx_products_search_fold_trgm']);
  try {
    for (const [file, mutation, oldGate, afterFailure] of cases) {
      const spec = extras.find(s => s.assert === file)!;
      await f.exec('BEGIN');
      try {
        await f.exec(mutation);
        if (oldGate) await f.exec(gate(oldGate)); // Demonstrate the existing gate's blind spot.
        await f.exec('SAVEPOINT assertion');
        await assert.rejects(f.exec(gate(file)), error => error instanceof Error && error.message.includes(spec.migration), file);
        await f.exec('ROLLBACK TO SAVEPOINT assertion');
        if (afterFailure) await f.exec(afterFailure);
      } finally { await f.exec('ROLLBACK'); }
    }
  } finally { f.release(); }
});
