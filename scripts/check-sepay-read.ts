/** Manually invoked credential check: GET provider data, output totals only, no database imports. */
import { readSepayDay } from '../src/modules/integrations/api/sepay-read.ts';
import { vietnamDate } from '../src/modules/sales/domain/sales.ts';
const day = vietnamDate().iso;
try {
  const result = await readSepayDay(process.env.SEPAY_API_TOKEN || '', day);
  console.log(JSON.stringify({ day, transactions: result.read, incoming: result.payments.length,
    incomingAmount: result.payments.reduce((s,p)=>s+p.amount,0), outgoing: result.outgoing,
    receiptsCreated: 0, databaseWrites: 0 }));
} catch (error) {
  // Provider/transport errors are sanitized by the adapter. Never print token, raw response or stack.
  console.error(error instanceof Error ? error.message : 'Không kiểm tra được API SePay.');
  process.exitCode = 1;
}
