import {and,eq,gte,isNull,lt,sql} from 'drizzle-orm';
import type {AnyDb} from '../core/db/client.ts';
import {AppError} from '../core/errors.ts';
import {customerPayments,salesOrders} from '../modules/sales/schema.ts';
import {posShifts,posRegisters} from '../modules/sales/pos-schema.ts';
import {sepayTransactions} from '../modules/integrations/schema.ts';
import {sepayAllocationBatches,sepayPaymentAllocations} from '../modules/sales/sepay-allocation-schema.ts';
import type {FinanceRange} from './finance-readers.ts';
type Db=AnyDb|Parameters<Parameters<AnyDb['transaction']>[0]>[0];
/** Evidence-only view: never added to company cashflow, receipts or cash drawer totals. */
export async function financeGhnSettlements(db:Db,f:FinanceRange){
 const start=new Date(f.from+'T00:00:00+07:00').toISOString(),end=new Date(Date.parse(f.to+'T00:00:00+07:00')+86400000).toISOString();
 const a=sepayPaymentAllocations,b=sepayAllocationBatches,p=customerPayments,t=sepayTransactions;
 const rows=await db.select({allocation:a,batchResult:b.result,bankId:t.id,bankAccount:t.accountNumber,bankPaymentId:t.paymentId,receiptReference:p.reference,account:posRegisters.bankAccount,receiptAmount:p.amount,receiptMethod:p.method})
  .from(a).innerJoin(b,eq(b.id,a.batchId)).innerJoin(t,eq(t.id,b.transactionId))
  .innerJoin(p,and(eq(p.id,a.paymentId),eq(p.orderId,a.orderId)))
  .innerJoin(salesOrders,eq(salesOrders.id,a.orderId)).innerJoin(posShifts,eq(posShifts.id,salesOrders.shiftId)).innerJoin(posRegisters,eq(posRegisters.id,posShifts.registerId))
  .where(and(isNull(a.voidedAt),isNull(p.voidedAt),eq(p.paymentSource,'ghn_cod'),eq(salesOrders.channel,'pos'),eq(t.transferType,'in'),gte(t.transactionAt,start),lt(t.transactionAt,end),f.branch?eq(posShifts.registerId,f.branch):undefined,
   sql`(select coalesce(sum(x.amount),0) from ${a} x join ${b} xb on xb.id=x.batch_id where xb.transaction_id=${t.id} and x.voided_at is null)<=${t.amount}`)).limit(10001);
 if(rows.length>10000)throw new AppError(422,'Phạm vi vượt 10.000 phân bổ GHN. Chọn khoảng ngày ngắn hơn.');
 const result={bankNet:0,confirmedFee:0,cod:0,difference:0,shortfall:0,surplus:0,allocations:0,transactions:0,needsReview:0};
 const seen=new Set<string>(),banks=new Set<string>();
 for(const r of rows){
  if(seen.has(r.allocation.id))continue;seen.add(r.allocation.id);
  let c:any;try{c=JSON.parse(r.batchResult).comparisons?.find((x:any)=>x.allocationId===r.allocation.id);}catch{}
  if(r.bankPaymentId||!c||(c.settlementKind==='ghn_cod'&&String(c.ghnCode||'').trim().toUpperCase()!==r.receiptReference.trim().toUpperCase())||c.expectedAmount!==r.receiptAmount||r.receiptMethod!=='other'||r.bankAccount!==r.account.replace(/\s+/g,'')||c.amount!==r.allocation.amount||Number(c.ghnFee||0)!==r.allocation.ghnFee||r.allocation.createdReceipt){result.needsReview++;continue;}
  const difference=r.allocation.amount+r.allocation.ghnFee-c.expectedAmount;
  // Old exact COD settlements are valid; discrepancies require the explicit GHN review marker.
  if(difference&&c.settlementKind!=='ghn_cod'){result.needsReview++;continue;}
  result.bankNet+=r.allocation.amount;result.confirmedFee+=r.allocation.ghnFee;result.cod+=c.expectedAmount;result.difference+=difference;
  result.shortfall+=Math.max(0,-difference);result.surplus+=Math.max(0,difference);result.allocations++;banks.add(r.bankId);
 }
 result.transactions=banks.size;return result;
}
