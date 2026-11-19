import { AppError } from '../../../core/errors.ts';
import { parseSepayPayment, parseSepayBankTransaction, sepayPaidDate, type SepayPayment, type SepayBankTransaction } from '../domain/sepay-payment.ts';

export const SEPAY_READ_LIMIT = 1000;
const MAX_BYTES = 3_000_000;
/** GET only, fixed provider origin; never forward employee credentials or follow redirects. */
export async function readSepayDay(token: string, day: string, fetcher: typeof fetch = fetch, includeDebits=false) {
  if (!/^[\x21-\x7e]{16,4096}$/.test(token))
    throw new AppError(503, 'Chưa cấu hình API đọc SePay trên máy chủ.');
  async function request(resource: 'list' | 'count') {
    const url = new URL('https://my.sepay.vn/userapi/transactions/' + resource);
    // SePay interprets a date-only upper bound as midnight, excluding the rest of that day.
    // Its transaction timestamps use Vietnam local time with second precision.
    url.searchParams.set('transaction_date_min', day + ' 00:00:00');
    url.searchParams.set('transaction_date_max', day + ' 23:59:59');
    url.searchParams.set('limit', String(SEPAY_READ_LIMIT));
    let body: Record<string, unknown>;
    try {
      const res = await fetcher(url.href, {
        method: 'GET', redirect: 'error', signal: AbortSignal.timeout(12_000),
        headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' },
      });
      if (!res.ok) { await res.body?.cancel(); throw new AppError(502, res.status === 401 || res.status === 403
        ? 'SePay từ chối API token. Kiểm tra token và quyền đọc giao dịch.'
        : res.status === 429 ? 'SePay đang giới hạn lượt đọc. Thử lại sau.' : 'Chưa đọc được dữ liệu từ SePay.'); }
      const reader = res.body?.getReader();
      if (!reader) throw new Error('empty');
      const chunks: Uint8Array[] = []; let size = 0;
      try { for (;;) { const r = await reader.read(); if (r.done) break; size += r.value.length;
        if (size > MAX_BYTES) { await reader.cancel(); throw new AppError(502, 'Dữ liệu SePay quá lớn; chưa nhập giao dịch.'); } chunks.push(r.value); }
      } finally { reader.releaseLock(); }
      const bytes = new Uint8Array(size); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      body = JSON.parse(new TextDecoder().decode(bytes));
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(502, 'Kết nối hoặc phản hồi SePay chưa hợp lệ. Chưa nhập giao dịch; có thể thử lại.');
    }
    if (!body || Number(body.status) !== 200) throw new AppError(502, 'SePay chưa trả kết quả hợp lệ; chưa nhập dữ liệu.');
    return body;
  }
  const counted = await request('count');
  const count = typeof counted.count_transactions === 'number' || typeof counted.count_transactions === 'string' && /^\d+$/.test(counted.count_transactions) ? Number(counted.count_transactions) : NaN;
  if (!Number.isSafeInteger(count) || count < 0) throw new AppError(502, 'SePay chưa trả số lượng giao dịch hợp lệ; chưa nhập dữ liệu.');
  if (count >= SEPAY_READ_LIMIT) throw new AppError(502, 'Hôm nay có từ 1.000 giao dịch trở lên. Cần đồng bộ theo đợt; chưa nhập dữ liệu.');
  const body = await request('list');
  if (!Array.isArray(body.transactions) || body.transactions.length !== count)
    throw new AppError(502, 'Danh sách SePay chưa đủ hoặc vừa thay đổi. Chưa nhập dữ liệu; thử lại để đối chiếu đủ số lượng.');
  // Refuse a potentially truncated day, rather than silently omit older transactions.
  if (body.transactions.length >= SEPAY_READ_LIMIT)
    throw new AppError(502, 'Hôm nay có từ 1.000 giao dịch trở lên. Cần đồng bộ theo đợt; chưa nhập dữ liệu.');
  const payments: SepayPayment[] = [],debits: SepayBankTransaction[]=[]; let outgoing = 0;
  for (const raw of body.transactions) {
    try {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('row');
      const row = raw as Record<string, unknown>;
      const amount = (v: unknown) => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v
        : typeof v === 'string' && /^\d+(?:\.0+)?$/.test(v.trim()) && Number.isSafeInteger(Number(v)) ? Number(v) : NaN;
      const incoming = amount(row.amount_in), out = amount(row.amount_out);
      if (!Number.isFinite(incoming) || !Number.isFinite(out) || incoming > 0 && out > 0 || String(row.transaction_date).slice(0,10) !== day) throw new Error('amount/date');
      if (!incoming) { outgoing++;if(out>0&&includeDebits)debits.push(parseSepayBankTransaction({id:row.id,transferType:'out',transferAmount:out,accountNumber:row.account_number,content:row.transaction_content,transactionDate:row.transaction_date,source:'sepay_api',sepayApi:row}));continue; }
      const payment = parseSepayPayment({ id: row.id, transferType: 'in', transferAmount: incoming,
        accountNumber: row.account_number, content: row.transaction_content,
        transactionDate: row.transaction_date, source: 'sepay_api', sepayApi: row });
      if (sepayPaidDate(payment.transactionAt) !== day) throw new Error('day');
      payments.push(payment);
    } catch { throw new AppError(502, 'Có giao dịch SePay sai định dạng hoặc ngoài ngày yêu cầu. Chưa nhập dữ liệu; cần kiểm tra nguồn.'); }
  }
  return { payments, debits, read: body.transactions.length, outgoing };
}
