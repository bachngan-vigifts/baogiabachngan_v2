import {and,eq,gte,lt,inArray,asc,sql,isNull,notInArray} from 'drizzle-orm';
import type {AnyDb} from '../../../core/db/client.ts';
import {auditLogs} from '../../../core/db/schema.ts';
import {hrRevenueTargets} from '../revenue-target-schema.ts';
import {employees} from '../../staff/schema.ts';
import {SALES_KPI_POSITIONS} from '../../staff/domain/roles.ts';

export async function revenueTargetsFor(db:AnyDb,months:readonly string[],ids?:readonly string[]){
  if(!months.length||ids?.length===0)return new Map<string,number>();
  const rows=await db.select({memberId:hrRevenueTargets.memberId,month:hrRevenueTargets.month,amount:hrRevenueTargets.amount}).from(hrRevenueTargets)
    .innerJoin(employees,eq(employees.id,hrRevenueTargets.memberId))
    .where(and(inArray(employees.positionId,[...SALES_KPI_POSITIONS]),isNull(employees.deletedAt),notInArray(employees.role,['customer','supplier']),inArray(hrRevenueTargets.month,[...months]),ids?inArray(hrRevenueTargets.memberId,[...ids]):undefined));
  return new Map(rows.map(r=>[r.memberId+':'+r.month,r.amount]));
}
export const targetKey=(id:string,month:string)=>id+':'+month;
export async function revenueTargetYearRows(db:AnyDb,year:string){
  return db.select().from(hrRevenueTargets).where(and(gte(hrRevenueTargets.month,year+'-01'),lt(hrRevenueTargets.month,String(Number(year)+1)+'-01'))).orderBy(asc(hrRevenueTargets.memberId),asc(hrRevenueTargets.month));
}
/** An old browser must not echo a resolved monthly goal into an inherited salary profile.
 * Keep this guard after the final registration is deleted too; audit entity IDs end in :YYYY-MM. */
export async function hasRevenueTargetHistory(db:AnyDb,id:string){
  const [entry]=await db.select({id:hrRevenueTargets.memberId}).from(hrRevenueTargets).where(eq(hrRevenueTargets.memberId,id)).limit(1);
  if(entry)return true;
  const [history]=await db.select({id:auditLogs.id}).from(auditLogs).where(and(eq(auditLogs.entityType,'hr-revenue-target'),sql`left(${auditLogs.entityId},-8)=${id}`)).limit(1);
  return !!history;
}
