import {notifySepayBankMovements} from './sepay-bank-notifications.ts';
import { inArray, sql } from 'drizzle-orm';
import { AppError } from '../../../core/errors.ts';
import { json, readJson, type Router } from '../../../core/http/router.ts';
import type { StaffEnv, SessionState } from '../../staff/api/auth-routes.ts';
import { sepayTransactions as bank } from '../../integrations/schema.ts';
import { readSepayDay } from '../../integrations/api/sepay-read.ts';
import { canViewSepay,canViewSepayDebits } from '../domain/sepay-page.ts';
import { vietnamDate } from '../domain/sales.ts';
import { cashAudit } from './cash-store.ts';

import {decideWebSepay,saveWebSepay} from './sepay-web-store.ts';
import {retryNearbySepay} from './sepay-nearby-retry.ts';

export async function pullSepayToday(env: StaffEnv, actorId: string) {
  const day = vietnamDate(new Date((env.nowSec?.() ?? Date.now()/1000)*1000)).iso;
  const result = await readSepayDay(env.sepayApiToken || '', day, env.sepayApiFetch,!!env.sepayDebitImportEnabled);
  const debits=env.sepayDebitImportEnabled?result.debits:[];
  const {notificationProviders,...totals} = await env.db.transaction(async tx => {
    // All writers use the same provider-ID locks. Sort batch locks before any row read.
    const ids = [...new Set([...result.payments,...debits].map(p => p.providerId))].sort();
    if (ids.length) await tx.execute(sql`select pg_advisory_xact_lock(hashtext('sepay:' || id)) from (select jsonb_array_elements_text(${JSON.stringify(ids)}::jsonb) as id order by id) keys`);
    const existing = ids.length ? await tx.select().from(bank).where(inArray(bank.providerId, ids)) : [];
    const known = new Map(existing.map(p => [p.providerId, p]));
    const at = new Date().toISOString(), additions: (typeof bank.$inferInsert)[] = [];
    let duplicate = 0;
    for (const p of result.payments) {
      const old = known.get(p.providerId);
      if (old) {
        if (old.transferType !== p.transferType || old.amount !== p.amount || old.accountNumber !== p.accountNumber || old.content !== p.content || old.transactionAt !== p.transactionAt)
          throw new AppError(409, 'ID SePay đã có nhưng số tiền, tài khoản, nội dung hoặc thời điểm khác. Chưa nhập đợt này; cần đối soát.');
        duplicate++;
        if (!old.paymentId && !old.orderId && old.status !== 'matched') {
          const decision=await decideWebSepay(tx,p);
          if(decision)await saveWebSepay(tx,p,decision,old,actorId);
        }
        continue;
      }
      const row = { id: crypto.randomUUID(), providerId: p.providerId, transferType: p.transferType,
        amount: p.amount, accountNumber: p.accountNumber, transactionAt: p.transactionAt, content: p.content,
        payload: p.payload, status: 'review' as const, reason: 'Đã tải từ API SePay; chờ đối soát, chưa ghi thu.',
        orderId: null, paymentId: null, webOrderId:null,matchMethod:'reference' as const,matchedOrderAt:null, receivedAt: at };
      const decision=await decideWebSepay(tx,p);
      if(decision){
        // Flush this special target immediately so another provider ID in this batch sees the proof.
        await saveWebSepay(tx,p,decision,undefined,actorId);
        known.set(p.providerId,{...row,...decision,webOrderId:decision.webOrderId});
      }else{additions.push(row);known.set(p.providerId,row);}

    }
    for(const p of debits){
      const old=known.get(p.providerId);
      if(old){if(old.transferType!=='out'||old.amount!==p.amount||old.accountNumber!==p.accountNumber||old.content!==p.content||old.transactionAt!==p.transactionAt)throw new AppError(409,'ID SePay đã có với nội dung khác; cần đối soát.');continue;}
      const row={id:crypto.randomUUID(),...p,status:'review' as const,reason:'Tiền ra ngân hàng; chỉ theo dõi, không ghi thu.',receivedAt:at};
      additions.push(row);known.set(p.providerId,{...row,orderId:null,paymentId:null,webOrderId:null,matchMethod:'reference',matchedOrderAt:null});
    }
    if (additions.length) await tx.insert(bank).values(additions);
    await cashAudit(tx, actorId, 'sepay.pull-today', 'sepay_import', day,
      { day, read: result.read, imported: result.payments.length-duplicate, duplicate, outgoing: result.outgoing });
    return { imported: result.payments.length-duplicate, duplicate, notificationProviders:ids.filter(id=>!existing.some(p=>p.providerId===id)) };
  });
  await notifySepayBankMovements(env,notificationProviders);
  const nearby=await retryNearbySepay(env);
  return { day, read: result.read, outgoing: result.outgoing, ...totals, receiptsCreated: 0, ...(nearby.matched?{nearbyMatched:nearby.matched}:{}) };
}

export function registerSepayReadRoutes(router: Router<StaffEnv>) {
  router.post('/sepay/pull-today', async c => {
    const actor = (c.state.session as SessionState).member;
    if (!canViewSepay(actor)) throw new AppError(403, 'Chức vụ của bạn chưa được cấp quyền Thanh toán SePay.');
    const body = await readJson(c.req, 1000);
    if (Object.keys(body).length) throw new AppError(400, 'Thao tác chỉ lấy giao dịch hôm nay; không nhận token hoặc ngày từ trình duyệt.');
    const result=await pullSepayToday(c.env,actor.id);
    if(canViewSepayDebits(actor))return json(result);
    const {outgoing:_privateCount,...visible}=result;return json({...visible,read:result.imported+result.duplicate});
  }, 'business');
  // Existing server scheduler authentication; employee cookies cannot invoke this route.
  router.post('/integrations/sepay/pull', async c => {
    const body = await readJson(c.req, 1000);
    if (Object.keys(body).length) throw new AppError(400, 'Đồng bộ tự động không nhận ngày hoặc token trong nội dung.');
    return json(await pullSepayToday(c.env, 'integration:sepay'));
  }, 'sapo-sync');
}
