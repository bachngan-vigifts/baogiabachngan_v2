import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from '../helpers/postgres.ts';
import { seedStaff } from '../helpers/staff-fixture.ts';
import { quotations } from '../../src/modules/quotes/schema.ts';
import { quoteTotalsData } from '../../src/modules/quotes/api/list-data.ts';
import { totals, type QuoteDoc } from '../../src/modules/quotes/domain/quote-math.ts';

test('compact list inputs preserve exact totals, row order and VAT while excluding images/private costs', async () => {
  const { db, d1 } = await createTestDb();
  await seedStaff(d1);
  const docs: QuoteDoc[] = (['HRC', 'B2B', 'VIGIFTS'] as const).flatMap(type => [0, 8, 10].map(vat => ({ type, vat,
    rows: [
      { price: 349648.27, qty: 14.4, discount: 7.33, printFee: 233.33 },
      { price: 12345.67, qty: 1.33, discount: 1234.56, discountType: 'amount' as const, taxRate: 5, printFee: 321.7 },
      { price: 50, qty: 7, discount: 99, discountType: 'amount' as const, taxRate: null },
      { price: 10, qty: 0, costPrice: 55555 },
    ],
  })));
  docs.push({ type: 'HRC', rows: [] });
  await db.insert(quotations).values(docs.map((doc, i) => ({ id: String(i), creatorId: 'emp', quoteNo: `PERF_${i}`,
    quoteType: doc.type, customer: 'Fixture', data: JSON.stringify({ ...doc, logo: 'x'.repeat(100000), rows: doc.rows.map(r => ({ ...r, image: 'y'.repeat(10000) })) }),
    createdAt: '', updatedAt: '',
  })));
  const rows = await db.select({ id: quotations.id, data: quoteTotalsData }).from(quotations);
  for (const row of rows) {
    const compact = JSON.parse(row.data), original = docs[Number(row.id)]!;
    assert.deepEqual(totals(compact), totals(original));
    assert.equal(compact.rows.length, original.rows.length);
    assert.equal(row.data.includes('costPrice'), false);
    assert.equal(row.data.includes('image'), false);
    assert.ok(row.data.length < 1200);
  }
});
