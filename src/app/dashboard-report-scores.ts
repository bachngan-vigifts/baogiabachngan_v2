import {and,eq,inArray,isNull} from 'drizzle-orm';
import {reportScoreView,type DashboardReportScoresOf} from '../core/contracts/report-scores.ts';
import {weeklyPointsFor} from '../modules/staff-reports/api/routes.ts';
import {hrPayslips} from '../modules/hr/schema.ts';
import {employees} from '../modules/staff/schema.ts';

/** Read report points + saved snapshots, without calculating or returning anyone's salary. */
export const dashboardReportScoresOf:DashboardReportScoresOf=async(db,month,ids)=>{
 if(!ids.length)return [];
 const [live,slips,people]=await Promise.all([
  weeklyPointsFor(db,month,ids),
  db.select({memberId:hrPayslips.memberId,data:hrPayslips.data,status:hrPayslips.status}).from(hrPayslips).where(and(eq(hrPayslips.month,month),inArray(hrPayslips.memberId,[...ids]))),
  db.select({id:employees.id,name:employees.name,positionId:employees.positionId}).from(employees).where(and(inArray(employees.id,[...ids]),isNull(employees.deletedAt),eq(employees.active,true),inArray(employees.positionId,['sale','sale-admin','manager']))),
 ]);
 const saved=new Map(slips.map(s=>[s.memberId,s]));
 return people.flatMap(p=>{
  const slip=saved.get(p.id);let snapshot:unknown,applied:boolean|undefined;
  if(slip)try{const saved=JSON.parse(slip.data);snapshot=saved.reportScoreBasis??saved.weeklyReportBasis;applied=!!saved.weeklyReportBasis;}catch{}
  if(!live.has(p.id)&&!snapshot)return [];
  return [{...p,...reportScoreView(month,slip?.status??'estimate',slip?snapshot:live.get(p.id)),...(applied===undefined?{}:{applied})}];
 }).sort((a,b)=>a.name.localeCompare(b.name,'vi')||a.id.localeCompare(b.id));
};
