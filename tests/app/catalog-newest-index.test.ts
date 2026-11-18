import {test} from 'node:test';
import assert from 'node:assert/strict';
import {eq} from 'drizzle-orm';
import {readFileSync} from 'node:fs';
import {createTestDb} from '../helpers/postgres.ts';
import {products} from '../../src/modules/catalog/schema.ts';
import {newestProducts} from '../../src/modules/catalog/api/product-query.ts';
import {foldSql} from '../../src/core/text/fold.ts';
import {PgDialect} from 'drizzle-orm/pg-core';

const MIGRATION = readFileSync(new URL('../../migrations/postgres/20261118120000_products_newest_index.sql', import.meta.url), 'utf8');

test('newest-products index uses the exact fold() strings from foldSql()', () => {
  const {params} = new PgDialect().sqlToQuery(foldSql(products.name));
  const [from, to] = params.slice(-2) as string[];
  assert.ok(MIGRATION.includes(`'${from}'`), 'FROM string in migration must match foldSql()');
  assert.ok(MIGRATION.includes(`'${to}'`), 'TO string in migration must match foldSql()');
});

test('catalogue pages are read in index order instead of sorting every product (no temp-file spill)', async () => {
  const {db, client} = await createTestDb();
  await db.insert(products).values(Array.from({length: 3000}, (_, i) => ({
    sku: 'IDX' + String(i).padStart(5, '0'), name: (i % 2 ? 'Bình ' : 'Hộp ') + i, active: true,
    createdAt: i % 3 ? new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString() : null,
    sapoProductId: i % 5 ? String(100000 + i) : null, updatedAt: '2026-11-01T00:00:00Z',
  })));
  await client.exec('analyze products');
  const page = db.select({sku: products.sku}).from(products).where(eq(products.active, true)).orderBy(...newestProducts()).limit(501).offset(1000);
  const {sql, params} = page.toSQL();
  const plan = (await client.query<any>('explain ' + sql, params)).rows.map(r => r['QUERY PLAN']).join('\n');
  assert.match(plan, /Index Scan using idx_products_newest_active/, plan);
  assert.doesNotMatch(plan, /\bSort\b/, plan);
});
