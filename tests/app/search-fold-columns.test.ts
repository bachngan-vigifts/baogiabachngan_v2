import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {sql} from 'drizzle-orm';
import {PgDialect} from 'drizzle-orm/pg-core';
import {createTestDb} from '../helpers/postgres.ts';
import {products} from '../../src/modules/catalog/schema.ts';
import {customers} from '../../src/modules/customers/schema.ts';
import {foldSql, matchAllWords} from '../../src/core/text/fold.ts';
import {matchProductWords} from '../../src/modules/catalog/api/product-query.ts';

const rows = (r: unknown): any[] => Array.isArray(r) ? r : (r as {rows: any[]}).rows;
const MIGRATION = readFileSync(new URL('../../migrations/postgres/20261119090000_search_fold_columns.sql', import.meta.url), 'utf8');

test('search_fold columns use the exact fold() strings from foldSql()', () => {
  const {params} = new PgDialect().sqlToQuery(foldSql(products.name));
  const [from, to] = params.slice(-2) as string[];
  assert.equal(MIGRATION.split(`'${from}'`).length - 1, 2, 'FROM string appears in both generated columns');
  assert.equal(MIGRATION.split(`'${to}'`).length - 1, 2, 'TO string appears in both generated columns');
});

test('stored search_fold equals foldSql() for products and customers, stays in sync on update, and drives search', async () => {
  const {db} = await createTestDb();
  await db.insert(products).values([
    {sku: 'LHC-4282', name: 'Bình Giữ Nhiệt Đá Ngà', brand: 'LocknLock', pattern: 'Hoa Đỏ', updatedAt: '2026-11-19T00:00:00Z'},
    {sku: 'X1', name: 'Hộp cơm  thủy tinh', updatedAt: '2026-11-19T00:00:00Z'},
  ]);
  const p = await db.execute(sql`select sku, search_fold = ${foldSql(products.sku, products.name, products.brand, products.pattern)} as same from ${products}`);
  assert.deepEqual(rows(p).map(r => r.same), [true, true]);
  await db.execute(sql`update ${products} set name = 'Ấm Siêu Tốc' where sku = 'X1'`);
  const [after] = rows(await db.execute(sql`select search_fold from ${products} where sku = 'X1'`));
  assert.equal(after.search_fold, 'x1 am sieu toc  ');
  const hit = await db.select({sku: products.sku}).from(products).where(matchProductWords('binh nhiet lhc4282'));
  assert.deepEqual(hit.map(r => r.sku), ['LHC-4282'], 'word search and compact code search still match');
  await db.insert(customers).values({id: 'c1', name: 'Công ty Hoàng Long', contact: 'Chị Lan', phone: '0901 234 567', email: 'a@b.vn', address: '', search: '', taxCode: '0312', customerCode: 'KH001', sourceVersion: 0, syncedAt: ''});
  const c = await db.execute(sql`select search_fold = ${foldSql(customers.name, customers.contact, customers.phone, customers.email, customers.taxCode, customers.customerCode)} as same from ${customers}`);
  assert.deepEqual(rows(c).map(r => r.same), [true]);
  const found = await db.select({id: customers.id}).from(customers).where(matchAllWords(sql`${customers}.search_fold`, 'hoang lan 0901234567'));
  assert.deepEqual(found.map(r => r.id), ['c1']);
  const all = await db.select().from(customers);
  assert.equal('searchFold' in all[0]! || 'search_fold' in all[0]!, false, 'select() does not leak the helper column');
});
