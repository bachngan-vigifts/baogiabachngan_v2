/** Manually invoked credential check: GET provider data, output totals only, no database imports. */
import { readSepayDay } from '../src/modules/integrations/api/sepay-read.ts';
import { vietnamDate } from '../src/modules/sales/domain/sales.ts';
const day = vietnamDate().iso;
try {
  const result = await readSepayDay(process.env.SEPAY_API_TOKEN || '', day);
  console.log(JSON.stringify({ day, transactions: result.read, incoming: result.payments.length,
    incomingAmount: result.payments.reduce((s,p)=>s+p.amount,0), outgoing: result.outgoing,
    receiptsCreated: 0, databaseWrites: 0 }));
  // Diagnose provider date-boundary semantics using counts only. No account, content or token output.
  for (const [mode, from, to] of [
    ['explicit-day', day + ' 00:00:00', day + ' 23:59:59'],
    ['all-history', '', ''],
  ]) {
    const url = new URL('https://my.sepay.vn/userapi/transactions/count');
    if (from) url.searchParams.set('transaction_date_min', from);
    if (to) url.searchParams.set('transaction_date_max', to);
    const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(12000),
      headers: { Authorization: 'Bearer ' + process.env.SEPAY_API_TOKEN, Accept: 'application/json' } });
    if (!response.ok) { await response.body?.cancel(); console.log(JSON.stringify({ mode, httpStatus: response.status })); continue; }
    const body = await response.json();
    console.log(JSON.stringify({ mode, status: Number(body.status), transactions: /^\d+$/.test(String(body.count_transactions)) ? Number(body.count_transactions) : null, databaseWrites: 0 }));
  }
} catch (error) {
  // Provider/transport errors are sanitized by the adapter. Never print token, raw response or stack.
  console.error(error instanceof Error ? error.message : 'Không kiểm tra được API SePay.');
  process.exitCode = 1;
}
