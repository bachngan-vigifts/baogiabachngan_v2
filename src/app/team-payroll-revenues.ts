import {and,desc,eq,gte,inArray,lt,lte,sql} from 'drizzle-orm';
import type {TeamRevenueOf} from '../core/contracts/sales-payroll.ts';
import {salesPayrollTeamSources} from '../modules/sales/team-payroll-schema.ts';
import {salesOrders} from '../modules/sales/schema.ts';
import {posRegisters,posShifts} from '../modules/sales/pos-schema.ts';
import {employees} from '../modules/staff/schema.ts';
import {hrSalaryProfiles} from '../modules/hr/schema.ts';
import {defaultProfileFor,monthRange} from '../modules/hr/domain/payroll.ts';
import {kpiNetRevenue} from '../modules/sales/api/kpi-net-revenue.ts';
/** CRM follows effective payroll team; POS follows its store, irrespective of cashier. */
export const teamPayrollRevenues:TeamRevenueOf=async(db,month)=>{
 const [config]=await db.select().from(salesPayrollTeamSources).where(lte(salesPayrollTeamSources.effectiveMonth,month)).orderBy(desc(salesPayrollTeamSources.effectiveMonth)).limit(1);
 if(!config)return null;
 const from=monthRange(month).from,next=month.slice(0,4)==='9999'?'9999-13-01':new Date(Date.UTC(+month.slice(0,4),+month.slice(5),1)).toISOString().slice(0,10);
 const [members,profiles,crm,pos,registers]=await Promise.all([
  db.select({id:employees.id,positionId:employees.positionId}).from(employees).where(sql`${employees.role} not in ('customer','supplier')`),
  db.select({memberId:hrSalaryProfiles.memberId,payrollGroup:hrSalaryProfiles.payrollGroup}).from(hrSalaryProfiles).where(lte(hrSalaryProfiles.effectiveMonth,month)).orderBy(desc(hrSalaryProfiles.effectiveMonth)),
  kpiNetRevenue(db,from,next,true,['crm']),
  db.select({registerId:posShifts.registerId,revenue:sql<number>`coalesce(sum(${salesOrders.subtotal}),0)`}).from(salesOrders).innerJoin(posShifts,eq(posShifts.id,salesOrders.shiftId)).where(and(eq(salesOrders.channel,'pos'),inArray(salesOrders.status,['confirmed','delivering','delivered']),gte(salesOrders.orderDate,from),lt(salesOrders.orderDate,next),inArray(posShifts.registerId,[config.bnRegisterId,config.lockRegisterId]))).groupBy(posShifts.registerId),
  db.select({id:posRegisters.id}).from(posRegisters).where(inArray(posRegisters.id,[config.bnRegisterId,config.lockRegisterId])),
 ]);
 const latest=new Map<string,string>();for(const p of profiles)if(!latest.has(p.memberId))latest.set(p.memberId,p.payrollGroup);
 const result={policyMonth:config.effectiveMonth,bonusMode:config.bonusMode,target:300_000_000,bn:{crm:0,pos:0,revenue:0,issues:0,registerId:config.bnRegisterId},lock:{crm:0,pos:0,revenue:0,issues:0,registerId:config.lockRegisterId}};
 for(const m of members){const group=latest.get(m.id)??defaultProfileFor(m.positionId).payrollGroup;if(group!=='bn'&&group!=='lock')continue;const f=crm.get(m.id);result[group].crm+=f?.netRevenue||0;result[group].issues+=f?.netRevenueIssues||0;}
 for(const group of ['bn','lock'] as const){const t=result[group];t.pos=Number(pos.find(p=>p.registerId===t.registerId)?.revenue||0);t.revenue=Math.max(0,t.crm+t.pos);if(!registers.some(r=>r.id===t.registerId)||(!Number.isFinite(t.revenue)||Math.abs(t.revenue)>Number.MAX_SAFE_INTEGER))t.issues++;}
 return result;
};
