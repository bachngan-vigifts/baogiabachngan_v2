import type {AnyDb} from '../db/client.ts';
import type {WeeklyReportPoints,ReportPeriodScore} from './weekly-report.ts';

export interface ReportScoreView {
 month:string;
 status:string;
 source:'live'|'snapshot'|'unavailable';
 basis:WeeklyReportPoints|null;
 applied?:boolean;
}
export type DashboardReportScoreMember=ReportScoreView&{id:string;name:string;positionId:string|null};
export type DashboardReportScoresOf=(db:AnyDb,month:string,memberIds:readonly string[])=>Promise<DashboardReportScoreMember[]>;

/** Only score fields cross this contract, including when reading a historical payroll snapshot. */
export function reportScoreView(month:string,status:string,value:unknown):ReportScoreView {
 const b=value as WeeklyReportPoints|undefined;
 const validPeriod=(w:ReportPeriodScore,monthly=false)=>!!w&&(monthly?w.period===month:/^\d{4}-\d{2}-\d{2}$/.test(w.period))&&typeof w.deadline==='string'&&typeof w.state==='string'&&(w.review===null||typeof w.review==='string')&&(w.score===null||Number.isFinite(w.score)&&w.score>=0&&w.score<=1);
 const pick=(w:ReportPeriodScore):ReportPeriodScore=>({period:w.period,deadline:w.deadline,state:w.state,review:w.review,score:w.score});
 const valid=!!b&&Number.isFinite(b.points)&&Number.isInteger(b.required)&&b.required>0&&b.required<=6&&b.points>=0&&b.points<=b.required&&Array.isArray(b.weeks)&&b.weeks.length<=6&&b.weeks.every(w=>validPeriod(w))&&(b.monthly==null||validPeriod(b.monthly,true));
 return {month,status,source:valid?(status==='estimate'?'live':'snapshot'):'unavailable',basis:valid?{points:b.points,required:b.required,weeks:b.weeks.map(pick),...(b.monthly!==undefined?{monthly:b.monthly===null?null:pick(b.monthly)}:{})}:null};
}
