import {and,asc,desc,eq,gte,inArray,lte} from 'drizzle-orm';
import {AppError} from '../core/errors.ts';
import {payrollLock} from '../core/db/payroll-lock.ts';
import {auditLogs} from '../core/db/schema.ts';
import {json,readJson,type Router} from '../core/http/router.ts';
import type {StaffEnv,SessionState} from '../modules/staff/api/auth-routes.ts';
import {sha256Hex} from '../modules/staff/domain/session.ts';
import {salesPayrollTeamSources} from '../modules/sales/team-payroll-schema.ts';
import {posRegisters} from '../modules/sales/pos-schema.ts';
import {hrPayslips} from '../modules/hr/schema.ts';
import {isMonth} from '../modules/hr/domain/payroll.ts';
const version=(v:unknown)=>sha256Hex(JSON.stringify(v??null));
export function registerTeamPayrollSources(router:Router<StaffEnv>){
 router.get('/hr/team-revenue-sources/:month',async c=>{
  const month=c.params.month;if(!isMonth(month))throw new AppError(400,'Tháng không hợp lệ.');
  const [source]=await c.env.db.select().from(salesPayrollTeamSources).where(lte(salesPayrollTeamSources.effectiveMonth,month)).orderBy(desc(salesPayrollTeamSources.effectiveMonth)).limit(1);
  const registers=await c.env.db.select({id:posRegisters.id,name:posRegisters.name,active:posRegisters.active}).from(posRegisters).orderBy(asc(posRegisters.name));
  return json({source:source??null,version:version(source),registers});
 },'admin');
 router.put('/hr/team-revenue-sources/:month',async c=>{
  const month=c.params.month;if(!isMonth(month))throw new AppError(400,'Tháng không hợp lệ.');
  const b=await readJson(c.req,4000);
  if(typeof b.bnRegisterId!=='string'||typeof b.lockRegisterId!=='string'||b.bnRegisterId===b.lockRegisterId||!['threshold','tiers'].includes(b.bonusMode as string)||typeof b.reason!=='string'||b.reason.trim().length<3||b.reason.length>500)throw new AppError(400,'Chọn hai cửa hàng khác nhau, cách xét thưởng và nhập lý do.');
  const bnRegisterId=b.bnRegisterId,lockRegisterId=b.lockRegisterId,reason=b.reason.trim();
  return c.env.db.transaction(async db=>{
   await payrollLock(db as any);
   const [prior]=await db.select().from(salesPayrollTeamSources).where(lte(salesPayrollTeamSources.effectiveMonth,month)).orderBy(desc(salesPayrollTeamSources.effectiveMonth)).limit(1);
   if(b.version!==version(prior))throw new AppError(409,'Cấu hình đã đổi. Tải lại trước khi lưu.');
   const [locked]=await db.select({id:hrPayslips.memberId}).from(hrPayslips).where(and(gte(hrPayslips.month,month),inArray(hrPayslips.payrollGroup,['bn','lock']))).limit(1);
   if(locked)throw new AppError(409,'Có phiếu lương cửa hàng đã chốt từ tháng này. Chọn kỳ sau các phiếu đã chốt.');
   const registers=await db.select({id:posRegisters.id}).from(posRegisters).where(and(inArray(posRegisters.id,[bnRegisterId,lockRegisterId]),eq(posRegisters.active,true)));
   if(registers.length!==2)throw new AppError(400,'Cửa hàng không tồn tại hoặc đã ngừng hoạt động.');
   const me=(c.state.session as SessionState).member.id,now=new Date().toISOString(),row={effectiveMonth:month,bnRegisterId,lockRegisterId,bonusMode:b.bonusMode as 'threshold'|'tiers',updatedBy:me,updatedAt:now};
   await db.insert(salesPayrollTeamSources).values(row).onConflictDoUpdate({target:salesPayrollTeamSources.effectiveMonth,set:row});
   await db.insert(auditLogs).values({id:crypto.randomUUID(),actorId:me,module:'hr',action:'hr-team-revenue-source-update',entityType:'hr-team-revenue-source',entityId:month,data:JSON.stringify({from:prior??null,to:row,reason}),createdAt:now});
   return json({ok:true});
  });
 },'admin');
}
