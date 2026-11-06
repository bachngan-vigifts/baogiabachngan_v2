import {and,gte,lt,inArray,asc} from 'drizzle-orm';
import type {AnyDb} from '../../../core/db/client.ts';
import {hrRevenueTargets} from '../revenue-target-schema.ts';

export async function revenueTargetsFor(db:AnyDb,months:readonly string[],ids?:readonly string[]){
  if(!months.length||ids?.length===0)return new Map<string,number>();
  const rows=await db.select().from(hrRevenueTargets).where(and(inArray(hrRevenueTargets.month,[...months]),ids?inArray(hrRevenueTargets.memberId,[...ids]):undefined));
  return new Map(rows.map(r=>[r.memberId+':'+r.month,r.amount]));
}
export const targetKey=(id:string,month:string)=>id+':'+month;
export async function revenueTargetYearRows(db:AnyDb,year:string){
  return db.select().from(hrRevenueTargets).where(and(gte(hrRevenueTargets.month,year+'-01'),lt(hrRevenueTargets.month,String(Number(year)+1)+'-01'))).orderBy(asc(hrRevenueTargets.memberId),asc(hrRevenueTargets.month));
}
