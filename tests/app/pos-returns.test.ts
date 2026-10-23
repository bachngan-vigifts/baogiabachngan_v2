import { test } from 'node:test';
import assert from 'node:assert/strict';
import { and, eq } from 'drizzle-orm';
import { setup } from '../helpers/pos-fixture.ts';
import { netReceivables } from '../../src/modules/sales/api/pos-return-credit.ts';
import { RULES } from '../../src/modules/tasks/api/auto-tasks.ts';
import {
  salesOrderLines,
  customerPayments,
  deliveries,
  salesOrders,
  paymentSchedules,
} from '../../src/modules/sales/schema.ts';
import {
  posReturns,
  posReturnLines,
  posRefunds,
  posExchangeAllocations,
} from '../../src/modules/sales/return-schema.ts';
import {
  stockBalances,
  stockMoves,
} from '../../src/modules/inventory/schema.ts';
import { cashEntries } from '../../src/modules/sales/cash-schema.ts';
import { employees } from '../../src/modules/staff/schema.ts';
import {
  returnPortion,
  returnBalance,
} from '../../src/modules/sales/domain/pos-return-money.ts';
const ok = (r: any, status = 200) => {
  assert.equal(r.status, status, JSON.stringify(r.data));
  return r.data;
};
async function sale(
  f: Awaited<ReturnType<typeof setup>>,
  shift: any,
  extra = {},
) {
  const o = ok(
    await f.call('/pos/checkout', f.emp, 'POST', f.cart(shift.id, extra)),
    201,
  );
  const lines = await f.db
    .select()
    .from(salesOrderLines)
    .where(eq(salesOrderLines.orderId, o.id));
  return { o, lines };
}
async function request(
  f: Awaited<ReturnType<typeof setup>>,
  shift: any,
  order: any,
  lines: any[],
  extra = {},
) {
  const body = {
    key: crypto.randomUUID(),
    orderId: order.id,
    shiftId: shift.id,
    reason: 'Khách đổi kích thước',
    lines: lines.map((l) => ({ orderLineId: l.id, qty: l.qty })),
    ...extra,
  };
  const r = ok(await f.call('/pos/returns', f.emp, 'POST', body), 201);
  return { r, body };
}
test('Tiền trả: phần cuối lấy số dư, huỷ yêu cầu không làm phân bổ vượt bill; không tạo tiền từ COD chưa thu', () => {
  assert.equal(returnPortion(100, 3, 0, 1, 0), 33);
  assert.equal(returnPortion(100, 3, 1, 1, 33), 33);
  assert.equal(returnPortion(100, 3, 2, 1, 66), 34);
  assert.equal(returnPortion(100, 3, 2, 1, 67), 33);
  for (const n of ['', null, 0, 4, -1, 0.0001])
    assert.throws(() => returnPortion(100, 3, 0, n));
  assert.deepEqual(returnBalance(100, 20, 100, 0, 0), {
    netDue: 0,
    netPaid: 20,
    balance: -20,
    available: 20,
  });
});
test('Trả hàng: duyệt không nhập/chi; nhận bán được, hoàn thực tế đúng một lần; báo cáo/két/công nợ và scope', async () => {
  const f = await setup(),
    shift = await f.open(),
    { o, lines } = await sale(f, shift, {
      feeName: 'Gói quà',
      feeAmount: 10800,
      shippingFee: 20000,
      tendered: 300000,
    });
  const { r, body } = await request(f, shift, o, lines, {
    serviceFee: 10800,
    shippingFee: 20000,
  });
  ok(await f.call('/pos/returns', f.emp, 'POST', body), 201);
  assert.equal((await f.db.select().from(posReturns)).length, 1);
  assert.equal(
    (
      await f.call('/pos/returns', f.emp, 'POST', {
        ...body,
        reason: 'Thay đổi',
      })
    ).status,
    409,
  );
  assert.equal(
    (await f.call('/pos/returns/' + r.id + '/approve', f.emp, 'POST', {}))
      .status,
    403,
  );
  assert.equal(
    (
      await f.call('/pos/returns/' + r.id + '/receive', f.emp, 'POST', {
        shiftId: shift.id,
        confirmed: true,
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await f.call('/pos/returns/' + r.id + '/refund', f.emp, 'POST', {
        key: crypto.randomUUID(),
        shiftId: shift.id,
        confirmed: true,
        amount: 100,
        method: 'cash',
      })
    ).status,
    409,
  );
  const approval = ok(
    await f.call('/pos/returns/' + r.id + '/approve', f.mgr, 'POST', {}),
  );
  assert.equal(approval.total, 194400, 'mặc định không hoàn phí');
  assert.equal(
    (
      await f.db
        .select()
        .from(stockMoves)
        .where(eq(stockMoves.refType, 'pos_return'))
    ).length,
    0,
  );
  assert.equal((await f.db.select().from(cashEntries)).length, 0);
  await Promise.all([
    f.call('/pos/returns/' + r.id + '/receive', f.emp, 'POST', {
      shiftId: shift.id,
      confirmed: true,
    }),
    f.call('/pos/returns/' + r.id + '/receive', f.emp, 'POST', {
      shiftId: shift.id,
      confirmed: true,
    }),
  ]).then((xs) => xs.forEach((x) => ok(x)));
  assert.equal(
    (
      await f.db
        .select()
        .from(stockBalances)
        .where(eq(stockBalances.sku, '00123'))
    )[0]!.qty,
    10,
  );
  assert.equal(
    (
      await f.db
        .select()
        .from(stockMoves)
        .where(eq(stockMoves.refType, 'pos_return'))
    ).length,
    1,
  );
  // Sổ kho: dòng khách trả nhập lại kho mở đơn gốc (link tra qua hook sales → inventory).
  const back = (await f.call('/stock-moves?group=in', f.mgr)).data.moves.find(
    (m: any) => m.refType === 'pos_return',
  );
  assert.match(back.link, /^#\/orders\/[^/]+$/);
  assert.equal(back.description, 'Khách trả hàng – nhập lại kho');
  const refund = {
    key: crypto.randomUUID(),
    shiftId: shift.id,
    confirmed: true,
    amount: 194400,
    method: 'cash',
  };
  ok(
    await f.call('/pos/returns/' + r.id + '/refund', f.emp, 'POST', refund),
    201,
  );
  ok(
    await f.call('/pos/returns/' + r.id + '/refund', f.emp, 'POST', refund),
    201,
  );
  assert.equal(
    (
      await f.call('/pos/returns/' + r.id + '/refund', f.emp, 'POST', {
        ...refund,
        key: crypto.randomUUID(),
        amount: 1,
      })
    ).status,
    409,
  );
  assert.equal((await f.db.select().from(posRefunds)).length, 1);
  const report = ok(await f.call('/pos/shifts/' + shift.id, f.emp));
  assert.equal(report.expectedCash, 530800);
  assert.equal(report.returns.credit, 194400);
  assert.equal(report.returns.refundedCash, 194400);
  const detail = ok(await f.call('/orders/' + o.id, f.mgr));
  assert.equal(detail.order.total, 225200);
  assert.equal(detail.receivable.balance, 0);
  assert.equal(detail.receivable.due, 30800);
  assert.equal(detail.receivable.paid, 30800);
  const [payment] = await f.db.select().from(customerPayments);
  assert.equal(
    (
      await f.call('/payments/' + payment!.id + '/void', f.mgr, 'POST', {
        reason: 'Nhập sai',
      })
    ).status,
    409,
  );
  const [entry] = await f.db.select().from(cashEntries);
  assert.equal(
    (
      await f.call('/cash/entries/' + entry!.id + '/void', f.mgr, 'POST', {
        reason: 'Nhập sai',
      })
    ).status,
    409,
  );
  await f.db
    .update(employees)
    .set({ positionId: 'sales-ml' })
    .where(eq(employees.id, 'cashier2'));
  assert.equal(
    (await f.call('/pos/returns?orderId=' + o.id, f.other)).status,
    403,
  );
  assert.equal(
    (await f.call('/pos/returns/' + r.id + '/approve', f.other, 'POST', {}))
      .status,
    403,
  );
  ok(await f.call('/pos/returns/' + r.id + '/complete', f.emp, 'POST', {}));
});
test('Người chỉ định duyệt thay, không tự duyệt và không duyệt thêm phí; Manager được duyệt phí, hàng hỏng không tăng tồn', async () => {
  const f = await setup(),
    shift = await f.open(),
    { o, lines } = await sale(f, shift, {
      feeName: 'In',
      feeAmount: 10800,
      shippingFee: 20000,
      tendered: 300000,
    });
  await f.db
    .update(employees)
    .set({ canApprove: true })
    .where(eq(employees.id, 'emp'));
  const { r } = await request(f, shift, o, lines, {
    serviceFee: 10800,
    shippingFee: 20000,
    lines: lines.map((l) => ({
      orderLineId: l.id,
      qty: l.qty,
      disposition: 'damaged',
    })),
  });
  assert.equal(
    (await f.call('/pos/returns/' + r.id + '/approve', f.emp, 'POST', {}))
      .status,
    403,
  );
  await f.db
    .update(employees)
    .set({ canApprove: true })
    .where(eq(employees.id, 'cashier2'));
  assert.equal(
    (
      await f.call('/pos/returns/' + r.id + '/approve', f.other, 'POST', {
        serviceFee: 1,
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await f.call('/pos/returns/' + r.id + '/approve', f.mgr, 'POST', {
        serviceFee: 10801,
      })
    ).status,
    400,
  );
  ok(
    await f.call('/pos/returns/' + r.id + '/approve', f.mgr, 'POST', {
      serviceFee: 10800,
      shippingFee: 20000,
    }),
  );
  ok(
    await f.call('/pos/returns/' + r.id + '/receive', f.emp, 'POST', {
      shiftId: shift.id,
      confirmed: true,
    }),
  );
  assert.equal(
    (
      await f.db
        .select()
        .from(stockBalances)
        .where(eq(stockBalances.sku, '00123'))
    )[0]!.qty,
    8,
  );
  const transfer = {
    key: crypto.randomUUID(),
    shiftId: shift.id,
    confirmed: true,
    amount: o.total,
    method: 'transfer',
  };
  assert.equal(
    (await f.call('/pos/returns/' + r.id + '/refund', f.emp, 'POST', transfer))
      .status,
    400,
  );
  ok(
    await f.call('/pos/returns/' + r.id + '/refund', f.emp, 'POST', {
      ...transfer,
      reference: 'FT123',
    }),
    201,
  );
  assert.equal((await f.db.select().from(cashEntries)).length, 0);
  assert.equal(
    ok(await f.call('/pos/shifts/' + shift.id, f.emp)).expectedCash,
    725200,
  );
  const other = await sale(f, shift);
  const rr = await request(f, shift, other.o, other.lines);
  ok(await f.call('/pos/returns/' + rr.r.id + '/approve', f.other, 'POST', {}));
});
test('Đổi hàng: tín dụng dùng đúng một lần, chỉ ghi thu chênh lệch; QR chênh lệch không cho hoàn song song', async () => {
  const f = await setup(),
    shift = await f.open(),
    { o, lines } = await sale(f, shift),
    { r } = await request(f, shift, o, lines);
  ok(await f.call('/pos/returns/' + r.id + '/approve', f.mgr, 'POST', {}));
  ok(
    await f.call('/pos/returns/' + r.id + '/receive', f.emp, 'POST', {
      shiftId: shift.id,
      confirmed: true,
    }),
  );
  const exchange = ok(
    await f.call('/pos/returns/' + r.id + '/exchange', f.emp, 'POST', {
      key: crypto.randomUUID(),
      shiftId: shift.id,
      amount: 194400,
    }),
    201,
  );
  const body = f.cart(shift.id, {
    exchangeAllocationId: exchange.id,
    rows: [{ sku: '00123', qty: 3 }],
    tendered: 129600,
  });
  const preview = ok(await f.call('/pos/preview', f.emp, 'POST', body));
  assert.equal(preview.total, 324000);
  assert.equal(preview.payable, 129600);
  const qr = ok(await f.call('/pos/qr', f.emp, 'POST', body));
  assert.equal(qr.amount, 129600);
  assert.equal(
    (
      await f.call(
        '/pos/exchanges/' + exchange.id + '/cancel',
        f.emp,
        'POST',
        {},
      )
    ).status,
    409,
  );
  assert.equal(
    (
      await f.call('/pos/returns/' + r.id + '/refund', f.emp, 'POST', {
        key: crypto.randomUUID(),
        shiftId: shift.id,
        amount: 1,
        method: 'cash',
        confirmed: true,
      })
    ).status,
    409,
  );
  const replacement = ok(
    await f.call('/pos/checkout', f.emp, 'POST', {
      ...body,
      method: 'transfer',
      confirmed: true,
      paymentRequestId: qr.id,
    }),
    201,
  );
  assert.equal(replacement.exchangeCredit, 194400);
  assert.equal(replacement.payable, 129600);
  assert.equal(
    (
      await f.call('/pos/checkout', f.emp, 'POST', {
        ...body,
        key: crypto.randomUUID(),
      })
    ).status,
    409,
  );
  const payments = await f.db
    .select()
    .from(customerPayments)
    .where(eq(customerPayments.orderId, replacement.id));
  assert.equal(payments.find((p) => p.method === 'transfer')!.amount, 129600);
  assert.equal(payments.find((p) => p.method === 'other')!.amount, 194400);
  const report = ok(await f.call('/pos/shifts/' + shift.id, f.emp));
  assert.equal(report.cash, 194400);
  assert.equal(report.transfer, 129600);
  assert.equal(report.expectedCash, 694400);
  assert.equal(report.returns.exchanged, 194400);
  assert.equal(
    ok(await f.call('/orders/' + o.id, f.mgr)).receivable.balance,
    0,
  );
  assert.equal(
    ok(await f.call('/orders/' + replacement.id, f.mgr)).receivable.balance,
    0,
  );
});
test('COD chưa thu: trả toàn bộ giảm công nợ nhưng không tạo tiền hoàn, không vào két; chặn trả quá SL', async () => {
  const f = await setup(),
    shift = await f.open(),
    { o, lines } = await sale(f, shift, {
      fulfillmentMode: 'cod',
      delivery: { address: 'Can Tho' },
    });
  // Simulate existing physical delivery confirmation; return flow does not itself issue/deliver the original sale.
  await f.db
    .update(salesOrderLines)
    .set({ deliveredQty: 2 })
    .where(eq(salesOrderLines.id, lines[0]!.id));
  await f.db
    .update(deliveries)
    .set({ status: 'delivered', deliveredAt: new Date().toISOString() })
    .where(eq(deliveries.orderId, o.id));
  const { r } = await request(f, shift, o, lines);
  const over = await f.call('/pos/returns', f.emp, 'POST', {
    key: crypto.randomUUID(),
    shiftId: shift.id,
    orderId: o.id,
    reason: 'Trả nữa',
    lines: [{ orderLineId: lines[0]!.id, qty: 1 }],
  });
  assert.equal(over.status, 400);
  ok(await f.call('/pos/returns/' + r.id + '/approve', f.mgr, 'POST', {}));
  ok(
    await f.call('/pos/returns/' + r.id + '/receive', f.emp, 'POST', {
      shiftId: shift.id,
      confirmed: true,
    }),
  );
  assert.equal(
    (
      await f.call('/pos/returns/' + r.id + '/refund', f.emp, 'POST', {
        key: crypto.randomUUID(),
        shiftId: shift.id,
        confirmed: true,
        amount: 1,
        method: 'cash',
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await f.call('/pos/returns/' + r.id + '/exchange', f.emp, 'POST', {
        key: crypto.randomUUID(),
        shiftId: shift.id,
        amount: 1,
      })
    ).status,
    409,
  );
  const [delivery] = await f.db
    .select()
    .from(deliveries)
    .where(eq(deliveries.orderId, o.id));
  assert.equal(
    (
      await f.call('/pos/cod/' + delivery!.id + '/collect', f.emp, 'POST', {
        key: crypto.randomUUID(),
        shiftId: shift.id,
        method: 'cash',
        confirmed: true,
      })
    ).status,
    409,
  );
  assert.equal(
    ok(await f.call('/orders/' + o.id, f.mgr)).receivable.balance,
    0,
  );
  // Mọi màn hình công nợ dùng chung số đã trừ hàng trả: kỳ đã quá hạn nhưng hàng trả hết → không còn nợ, không sinh việc thu nợ.
  await f.db.update(paymentSchedules).set({ dueDate: '2020-01-01' }).where(eq(paymentSchedules.orderId, o.id));
  assert.equal((await netReceivables(f.db as never, [o.id], '2026-10-22')).get(o.id)!.balance, 0);
  assert.deepEqual((await RULES.overdueDebt!(f.db as never, '2026-10-22')).filter(t => t.sourceId === o.id), []);
  const report = ok(await f.call('/pos/shifts/' + shift.id, f.emp));
  assert.equal(report.expectedCash, 500000);
  assert.equal(report.cod.pending.amount, 0);
  ok(await f.call('/pos/returns/' + r.id + '/complete', f.emp, 'POST', {}));
});
test('Hoàn ở ca sau: giữ nguyên snapshot ca trước, trừ két ca thực trả; hai lần hoàn song song không chi quá', async () => {
  const f = await setup(),
    shift = await f.open(),
    { o, lines } = await sale(f, shift);
  const closed = ok(
    await f.call('/pos/shifts/' + shift.id + '/close', f.emp, 'POST', {
      countedCash: 694400,
    }),
  );
  const next = await f.open(),
    { r } = await request(f, next, o, lines);
  ok(await f.call('/pos/returns/' + r.id + '/approve', f.mgr, 'POST', {}));
  ok(
    await f.call('/pos/returns/' + r.id + '/receive', f.emp, 'POST', {
      shiftId: next.id,
      confirmed: true,
    }),
  );
  const refunds = await Promise.all(
    [1, 2].map(() =>
      f.call('/pos/returns/' + r.id + '/refund', f.emp, 'POST', {
        key: crypto.randomUUID(),
        shiftId: next.id,
        amount: 194400,
        method: 'cash',
        confirmed: true,
      }),
    ),
  );
  assert.deepEqual(refunds.map((r) => r.status).sort(), [201, 409]);
  assert.equal((await f.db.select().from(posRefunds)).length, 1);
  assert.equal(
    ok(await f.call('/pos/shifts/' + next.id, f.emp)).expectedCash,
    500000,
  );
  const { replayed, ...snapshot } = closed;
  assert.deepEqual(
    ok(await f.call('/pos/shifts/' + shift.id, f.emp)),
    snapshot,
  );
  const date = new Date().toLocaleDateString('sv-SE', {
    timeZone: 'Asia/Ho_Chi_Minh',
  });
  const cashbook = ok(
    await f.call('/cashbook?from=' + date + '&to=' + date, f.mgr),
  );
  assert.equal(cashbook.totals.in, 194400);
  assert.equal(cashbook.totals.out, 194400);
});
test('Giữ chỗ đổi hàng hết hạn được nhả; RLS/revoke bảng mới chặn truy cập trực tiếp', async () => {
  const f = await setup(),
    shift = await f.open(),
    { o, lines } = await sale(f, shift),
    { r } = await request(f, shift, o, lines);
  ok(await f.call('/pos/returns/' + r.id + '/approve', f.mgr, 'POST', {}));
  ok(
    await f.call('/pos/returns/' + r.id + '/receive', f.emp, 'POST', {
      shiftId: shift.id,
      confirmed: true,
    }),
  );
  const a = ok(
    await f.call('/pos/returns/' + r.id + '/exchange', f.emp, 'POST', {
      key: crypto.randomUUID(),
      shiftId: shift.id,
      amount: 194400,
    }),
    201,
  );
  await f.db
    .update(posExchangeAllocations)
    .set({ expiresAt: '2000-01-01T00:00:00Z' })
    .where(eq(posExchangeAllocations.id, a.id));
  ok(
    await f.call('/pos/returns/' + r.id + '/refund', f.emp, 'POST', {
      key: crypto.randomUUID(),
      shiftId: shift.id,
      amount: 194400,
      method: 'cash',
      confirmed: true,
    }),
    201,
  );
  assert.equal(
    (await f.db.select().from(posExchangeAllocations))[0]!.status,
    'cancelled',
  );
  const tables = await f.client.query<{
    relname: string;
    relrowsecurity: boolean;
  }>(
    "select relname,relrowsecurity from pg_class where relname in ('pos_returns','pos_return_lines','pos_refunds','pos_exchange_allocations')",
  );
  assert.equal(tables.rows.length, 4);
  assert.ok(tables.rows.every((t) => t.relrowsecurity));
  await f.client.exec('CREATE ROLE anon; CREATE ROLE authenticated;');
  const { readFileSync } = await import('node:fs');
  await f.client.exec(
    readFileSync(
      new URL(
        '../../migrations/postgres/20261019072202_supabase_access_pos_returns.sql',
        import.meta.url,
      ),
      'utf8',
    ),
  );
  for (const role of ['anon', 'authenticated']) {
    await f.client.exec('SET ROLE ' + role);
    try {
      await assert.rejects(
        f.client.query('select * from pos_returns'),
        /permission denied/,
      );
    } finally {
      await f.client.exec('RESET ROLE');
    }
  }
});

test('QR đổi hàng hết giữ chỗ: ngân hàng đến muộn không dùng lại tín dụng đã hoàn, ghi tra soát một lần', async () => {
  const f = await setup(),
    shift = await f.open(),
    { o, lines } = await sale(f, shift),
    { r } = await request(f, shift, o, lines);
  ok(await f.call('/pos/returns/' + r.id + '/approve', f.mgr, 'POST', {}));
  ok(
    await f.call('/pos/returns/' + r.id + '/receive', f.emp, 'POST', {
      shiftId: shift.id,
      confirmed: true,
    }),
  );
  const allocation = ok(
    await f.call('/pos/returns/' + r.id + '/exchange', f.emp, 'POST', {
      key: crypto.randomUUID(),
      shiftId: shift.id,
      amount: 100000,
    }),
    201,
  );
  const body = f.cart(shift.id, { exchangeAllocationId: allocation.id }),
    qr = ok(await f.call('/pos/qr', f.emp, 'POST', body));
  const { posPaymentRequests } = await import(
    '../../src/modules/sales/pos-schema.ts'
  );
  await f.db
    .update(posPaymentRequests)
    .set({ expiresAt: '2000-01-01T00:00:00Z' })
    .where(eq(posPaymentRequests.id, qr.id));
  await f.db
    .update(posExchangeAllocations)
    .set({ expiresAt: '2000-01-01T00:00:00Z' })
    .where(eq(posExchangeAllocations.id, allocation.id));
  ok(
    await f.call('/pos/returns/' + r.id + '/refund', f.emp, 'POST', {
      key: crypto.randomUUID(),
      shiftId: shift.id,
      amount: 194400,
      method: 'cash',
      confirmed: true,
    }),
    201,
  );
  for (let i = 0; i < 2; i++) {
    const response = await f.router.handle(
      new Request(
        'https://trial.test/api/staff/integrations/sepay/pos-payment',
        {
          method: 'POST',
          headers: {
            origin: 'https://trial.test',
            'content-type': 'application/json',
            authorization: 'Apikey test-sepay-key',
          },
          body: JSON.stringify({
            transferType: 'in',
            transferAmount: qr.amount,
            accountNumber: '123456',
            content: qr.content,
          }),
        },
      ),
      f.env,
    );
    assert.equal(response.status, 200);
    assert.equal(((await response.json()) as any).requiresReconciliation, true);
  }
  assert.equal(
    ok(await f.call('/pos/qr/' + qr.id + '/status', f.emp))
      .requiresReconciliation,
    true,
  );
  assert.equal(
    (
      await f.call('/pos/checkout', f.emp, 'POST', {
        ...body,
        method: 'transfer',
        confirmed: true,
        paymentRequestId: qr.id,
      })
    ).status,
    409,
  );
  const { auditLogs } = await import('../../src/core/db/schema.ts');
  assert.equal(
    (
      await f.db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.action, 'late-exchange-transfer'))
    ).length,
    1,
  );
  assert.equal((await f.db.select().from(posRefunds)).length, 1);
  assert.equal((await f.db.select().from(salesOrders)).length, 1);
});

test('Người được chỉ định không có quyền bán vẫn duyệt qua Sổ quỹ; không tự nhận hàng/hoàn tiền', async () => {
  const f = await setup(),
    shift = await f.open(),
    { o, lines } = await sale(f, shift),
    { r } = await request(f, shift, o, lines);
  await f.db
    .update(employees)
    .set({ positionId: 'accounting', canApprove: true })
    .where(eq(employees.id, 'cashier2'));
  assert.equal((await f.call('/pos/options', f.other)).status, 403);
  ok(await f.call('/pos/returns', f.other));
  ok(await f.call('/pos/returns/' + r.id + '/approve', f.other, 'POST', {}));
  assert.equal(
    (
      await f.call('/pos/returns/' + r.id + '/receive', f.other, 'POST', {
        shiftId: shift.id,
        confirmed: true,
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await f.call('/pos/returns/' + r.id + '/refund', f.other, 'POST', {
        key: crypto.randomUUID(),
        shiftId: shift.id,
        amount: 194400,
        method: 'cash',
        confirmed: true,
      })
    ).status,
    403,
  );
  await f.db
    .update(employees)
    .set({ canApprove: false })
    .where(eq(employees.id, 'cashier2'));
  assert.equal((await f.call('/pos/returns', f.other)).status, 403);
});
