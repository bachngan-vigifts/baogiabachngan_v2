import {and,eq,ne,inArray,sql} from 'drizzle-orm';
import type {AnyDb} from '../../../core/db/client.ts';
import type {ContractFact} from '../../../core/contracts/sales-payroll.ts';
import {AppError} from '../../../core/errors.ts';
import {hrContractBonusAccounts as accounts,hrContractBonusEntries as entries} from '../contract-bonus-schema.ts';
import {awardPolicy,awardEntitlement,starAward,vnMonth,type AwardProposal,type AwardPolicy,type AwardKind} from '../domain/contract-bonus.ts';
import type {PayrollParams} from '../domain/params.ts';
export async function awardHistory(db:AnyDb){
 const [a,e]=await Promise.all([db.select().from(accounts),db.select().from(entries).where(ne(entries.status,'released'))]);return{accounts:a,entries:e};
}
export async function proposeAwards(db:AnyDb,month:string,from:string,facts:ContractFact[],history:Awaited<ReturnType<typeof awardHistory>>,policyOf:(m:string)=>Promise<{params:PayrollParams;effectiveMonth:string|null}>){
 const proposals:AwardProposal[]=[],factOf=new Map(facts.map(f=>[f.contractId,f]));
 const append=(account:typeof accounts.$inferSelect|undefined,fact:ContractFact,kind:AwardKind,p:AwardPolicy,origin:string)=>{
  const id=account?.id||fact.contractId+':'+kind,bookedRows=history.entries.filter(e=>e.accountId===id),booked=bookedRows.reduce((n,e)=>n+e.amount,0);
  // An earlier month cannot steal/rewrite an award already booked in a later month.
  if(bookedRows.some(e=>e.month>month))return;
  if(!account&&(!['signed','completed'].includes(fact.status)||['draft','cancelled'].includes(fact.orderStatus)))return;
  const entitled=awardEntitlement(fact,kind,p,month),amount=entitled-booked;
  if(!account&&origin>month||!account&&origin<from)return;
  proposals.push({accountId:id,contractId:fact.contractId,kind,memberId:account&&bookedRows.length?account.memberId:fact.ownerId,originMonth:account?.originMonth||origin,policy:p,fact,stars:starAward(fact.subtotal,p).stars,entitled,booked,amount,
   reason:account?(amount<0?'Giảm quyền hưởng / HĐKT huỷ hoặc không còn đủ điều kiện':amount>0?'Tăng quyền hưởng so với khoản đã ghi nhận':'Đã ghi nhận đủ')+(account.memberId!==fact.ownerId?' · Người phụ trách đã đổi; giữ người nhận lúc chốt':''):kind==='star'?'Thưởng sao tháng ký':'Manager duyệt thanh lý',isNew:!account});
 };
 for(const a of history.accounts){
  const old=JSON.parse(a.source) as ContractFact,f=factOf.get(a.contractId)||{...old,status:'cancelled'};
  append(a,f,a.kind,JSON.parse(a.policy) as AwardPolicy,a.originMonth);
 }
 const existing=new Set(history.accounts.map(a=>a.id)),cache=new Map<string,AwardPolicy>();
 for(const f of facts)for(const kind of ['star','liquidation'] as AwardKind[]){
  if(existing.has(f.contractId+':'+kind))continue;
  const origin=kind==='star'?f.signedDate?.slice(0,7):f.liquidatedAt?vnMonth(f.liquidatedAt):null;
  if(!origin||origin!==month||origin<from)continue;
  let p=cache.get(origin);if(!p){const settings=await policyOf(origin);p=awardPolicy(settings.params,settings.effectiveMonth||origin);cache.set(origin,p);}
  append(undefined,f,kind,p,origin);
 }
 return proposals.sort((a,b)=>a.accountId.localeCompare(b.accountId));
}
export async function reserveAwards(db:AnyDb,memberId:string,month:string,runId:string,awards:AwardProposal[]){
 const now=new Date().toISOString();
 for(const a of awards.filter(a=>a.memberId===memberId&&(a.amount!==0||a.isNew))){
  await db.insert(accounts).values({id:a.accountId,contractId:a.contractId,kind:a.kind,memberId,originMonth:a.originMonth,policy:JSON.stringify(a.policy),source:JSON.stringify(a.fact),createdAt:now}).onConflictDoNothing();
  const [owner]=await db.select().from(accounts).where(eq(accounts.id,a.accountId)).for('update');
  const activeRows=await db.select({id:entries.id}).from(entries).where(and(eq(entries.accountId,a.accountId),ne(entries.status,'released'))).limit(1);
  if(owner&&!activeRows.length&&owner.memberId!==memberId)await db.update(accounts).set({memberId}).where(eq(accounts.id,a.accountId));
  if(!owner||(activeRows.length&&owner.memberId!==memberId))throw new AppError(409,'Người nhận thưởng đã đổi. Tải lại bảng lương.');
  const [sum]=await db.select({n:sql<number>`coalesce(sum(${entries.amount}),0)`.mapWith(Number)}).from(entries).where(and(eq(entries.accountId,a.accountId),ne(entries.status,'released')));
  if(sum?.n!==a.booked)throw new AppError(409,'Thưởng đã được ghi nhận ở phiếu khác. Tải lại.','AWARD_CHANGED');
  await db.insert(entries).values({id:crypto.randomUUID(),accountId:a.accountId,memberId,month,runId,amount:a.amount,status:'reserved',reason:a.reason,detail:JSON.stringify(a),createdAt:now});
 }
}
export async function releaseAwards(db:AnyDb,memberId:string,month:string){
 const rows=await db.select().from(entries).where(and(eq(entries.memberId,memberId),eq(entries.month,month),eq(entries.status,'reserved')));
 if(rows.length){const ids=rows.map(r=>r.accountId),later=await db.select({id:entries.id}).from(entries).where(and(inArray(entries.accountId,ids),ne(entries.status,'released'),sql`${entries.month}>${month}`)).limit(1);if(later.length)throw new AppError(409,'Có điều chỉnh ở kỳ sau. Mở lại các phiếu chưa trả liên quan từ kỳ mới nhất trước.');}
 await db.update(entries).set({status:'released'}).where(and(eq(entries.memberId,memberId),eq(entries.month,month),eq(entries.status,'reserved')));
}
export async function payAwards(db:AnyDb,memberId:string,month:string){await db.update(entries).set({status:'paid'}).where(and(eq(entries.memberId,memberId),eq(entries.month,month),eq(entries.status,'reserved')));}
