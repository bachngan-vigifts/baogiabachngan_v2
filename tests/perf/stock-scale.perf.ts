import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from '../helpers/postgres.ts';
import { seedStaff, PASSWORD } from '../helpers/staff-fixture.ts';
import { createAppRouter } from '../../src/app/router.ts';
import { products, productStock, warehouses } from '../../src/modules/catalog/schema.ts';
import { postMoves, type MoveInput } from '../../src/modules/inventory/api/ledger.ts';

/**
 * SỔ KHO ~20.000 MÃ (chạy riêng: npm run test:perf – không nằm trong npm test vì mất vài chục giây).
 * Chốt 2 kho × 20.000 mã, ghi lô 15.000 dòng, gọi lặp không ghi thêm, lô 20.000 dòng có 1 dòng âm → STOCK_SHORT, rollback toàn bộ.
 * Mỗi bước in thời gian; giới hạn 60 giây / bước (không nới).
 */
const N = 20_000, LIMIT_MS = 60_000, at = '2026-10-01T00:00:00.000Z';
const sku = (i: number) => 'SKU' + String(i).padStart(5, '0');
const slices = <T>(xs: T[], size: number) => Array.from({ length: Math.ceil(xs.length / size) }, (_, i) => xs.slice(i * size, (i + 1) * size));
async function timed<T>(label: string, run: () => Promise<T>) {
  const t0 = performance.now(), out = await run(), ms = Math.round(performance.now() - t0);
  console.log(`[perf] ${label}: ${ms} ms`);
  assert.ok(ms < LIMIT_MS, `${label} mất ${ms} ms (> ${LIMIT_MS} ms)`);
  return out;
}

test(`sổ kho ${N} mã: chốt từng kho, postMoves 15.000 dòng, gọi lặp, lô âm rollback`, { timeout: 15 * 60_000 }, async () => {
  const { db, d1, client } = await createTestDb(); await seedStaff(d1);
  await db.insert(warehouses).values([{ id: 'a', name: 'Kho A', kind: 'stock', sortOrder: 0 }, { id: 'b', name: 'Kho B', kind: 'stock', sortOrder: 1 }]);
  const ids = Array.from({ length: N }, (_, i) => i);
  await timed(`seed ${N} sản phẩm + ${2 * N} dòng tồn Sapo`, async () => {
    for (const part of slices(ids, 2000)) {
      await db.insert(products).values(part.map(i => ({ sku: sku(i), name: 'Hàng ' + i, unit: 'cái', updatedAt: at })));
      await db.insert(productStock).values(part.flatMap(i => ['a', 'b'].map(warehouseId => ({ sku: sku(i), warehouseId, quantity: 100, updatedAt: at }))));
    }
  });
  const router = createAppRouter();
  const call = async (path: string, cookie = '', method = 'GET', body?: object) => {
    const res = await router.handle(new Request('https://trial.test/api/staff' + path, { method, headers: { origin: 'https://trial.test', 'content-type': 'application/json', cookie }, body: body ? JSON.stringify(body) : undefined }), { db, passwordIterations: 1000, sapoOrderPush: 'off' } as never);
    return { status: res.status, data: await res.json() as any, cookie: res.headers.get('set-cookie')?.split(';')[0] ?? '' };
  };
  const mgr = (await call('/login', '', 'POST', { email: 'mgr@x.vn', password: PASSWORD })).cookie;
  const count = async () => (await client.query<{ moves: number; total: number }>('select (select count(*)::int from stock_moves) as moves, (select coalesce(sum(qty),0)::float8 from stock_balances) as total')).rows[0]!;

  const opened = await timed(`chốt tồn đầu kỳ "Tất cả kho" (2 × ${N} mã)`, () => call('/inventory/opening', mgr, 'POST', { confirm: true }));
  assert.equal(opened.status, 200, JSON.stringify(opened.data).slice(0, 500));
  assert.deepEqual(opened.data.results.map((r: any) => [r.warehouseId, r.status, r.lines]), [['a', 'opened', N], ['b', 'opened', N]]);
  assert.deepEqual(await count(), { moves: 2 * N, total: 2 * N * 100 });

  // Lô 15.000 dòng: 7.500 mã × 2 kho, xen kẽ tăng / giảm.
  const big: MoveInput[] = ids.slice(0, 7_500).flatMap(i => ['b', 'a'].map(warehouseId => ({ sku: sku(i), warehouseId, qty: i % 2 ? -3 : 5, kind: 'adjust' as const, refType: 'adjustment' as const, refId: 'scale-1' })));
  assert.equal(big.length, 15_000);
  assert.equal(await timed('postMoves 15.000 dòng', () => db.transaction(tx => postMoves(tx, 'mgr', big))), 15_000);
  const afterBig = await count();
  assert.equal(afterBig.moves, 2 * N + 15_000); assert.equal(afterBig.total, 2 * N * 100 + 7_500 * (5 - 3));
  assert.equal(await timed('postMoves gọi lặp cùng lô 15.000 dòng', () => db.transaction(tx => postMoves(tx, 'mgr', big))), 0);
  assert.deepEqual(await count(), afterBig, 'gọi lặp không ghi thêm');

  // Lô 20.000 dòng, đúng một dòng làm âm tồn → STOCK_SHORT, không ghi dòng nào.
  const bad: MoveInput[] = ids.map(i => ({ sku: sku(i), warehouseId: 'a', qty: i === 12_345 ? -1_000 : -1, kind: 'adjust' as const, refType: 'adjustment' as const, refId: 'scale-2' }));
  await timed('postMoves 20.000 dòng có 1 dòng âm (rollback)', () => assert.rejects(db.transaction(tx => postMoves(tx, 'mgr', bad)),
    (e: any) => e.status === 409 && e.code === 'STOCK_SHORT' && /SKU12345 \(còn 100, cần 1000\)/.test(e.message)));
  assert.deepEqual(await count(), afterBig, 'rollback toàn bộ lô');
});
