import {and,eq,isNull,or,sql} from 'drizzle-orm';
import {AppError} from '../../../core/errors.ts';
import {sepayPaymentAllocations as allocations,sepayAllocationBatches as batches,sepayReconciliationStates as states} from '../sepay-allocation-schema.ts';
import {webStoreOrders} from '../pos-schema.ts';
import type {CashDb} from './cash-store.ts';
export async function hasDetailedSepay(db:CashDb,id:string){return !!(await db.select({id:states.transactionId}).from(states).where(eq(states.transactionId,id)).limit(1))[0];}
export const detailedSepay=(id:unknown)=>sql<boolean>`exists(select 1 from ${states} where ${states.transactionId}=${id})`;
export const allocationAmount=(id:unknown)=>sql<number>`coalesce((select sum(a.amount) from ${allocations} a join ${batches} b on b.id=a.batch_id where b.transaction_id=${id} and a.voided_at is null),0)::float8`;
export async function allocationRows(db:CashDb,id:string){return db.select({a:allocations}).from(allocations).innerJoin(batches,eq(batches.id,allocations.batchId)).where(eq(batches.transactionId,id)).then(rows=>rows.map(r=>r.a));}
export async function assertNotAllocationReceipt(db:CashDb,id:string){
 if((await db.select({id:allocations.id}).from(allocations).where(and(or(eq(allocations.paymentId,id),eq(allocations.feePaymentId,id)),isNull(allocations.voidedAt))).limit(1)).length)
  throw new AppError(409,'Phiếu thu này thuộc phân bổ SePay; gỡ tại trang đối soát chi tiết');
}

export const allocationNeedsReview=(id:unknown)=>sql<boolean>`exists(select 1 from ${allocations} a join ${batches} b on b.id=a.batch_id join ${webStoreOrders} w on w.id=a.web_order_id where b.transaction_id=${id} and a.voided_at is null and a.target_total<>w.total)`;
