import {and,asc,gte,isNull,lt,notInArray,sql} from 'drizzle-orm';
import type {AnyDb} from '../../../core/db/client.ts';
import {auditLogs} from '../../../core/db/schema.ts';
import {payrollLock} from '../../../core/db/payroll-lock.ts';
import {AppError} from '../../../core/errors.ts';
import {json,readJson,type Router} from '../../../core/http/router.ts';
import type {SessionState,StaffEnv} from '../../staff/api/auth-routes.ts';
import {employees} from '../../staff/schema.ts';
import {sha256Hex} from '../../staff/domain/session.ts';
import {hrPayslips} from '../schema.ts';
import {hrRevenueTargets} from '../revenue-target-schema.ts';
import {isMonth} from '../domain/payroll.ts';
import {revenueTargetYearRows,targetKey} from './revenue-target-data.ts';

const validYear=(v:unknown)=>{if(typeof v!=='string'||!/^\d{4}$/.test(v)||Number(v)<2000||Number(v)>2100)throw new AppError(400,'Năm phải từ 2000 đến 2100.');return v;};
async function yearState(db:AnyDb,year:string){
  const [entries,locks]=await Promise.all([
    revenueTargetYearRows(db,year),
    db.select({memberId:hrPayslips.memberId,month:hrPayslips.month}).from(hrPayslips).where(and(gte(hrPayslips.month,year+'-01'),lt(hrPayslips.month,String(Number(year)+1)+'-01'))).orderBy(asc(hrPayslips.memberId),asc(hrPayslips.month)),
  ]);
  return {entries,locks,version:sha256Hex(JSON.stringify({year,entries,locks}))};
}
async function people(db:AnyDb){return db.select({id:employees.id,name:employees.name,positionId:employees.positionId,active:employees.active}).from(employees).where(and(isNull(employees.deletedAt),notInArray(employees.role,['customer','supplier']))).orderBy(asc(employees.name));}

/** Đăng ký mục tiêu, không phải doanh số thực hiện. Dùng cùng khóa với chốt lương để không sửa tháng vừa chốt. */
export function registerRevenueTargets(router:Router<StaffEnv>){
  router.get('/hr/revenue-targets/:year',async c=>{
    const year=validYear(c.params.year),s=await yearState(c.env.db,year),members=await people(c.env.db);
    const months=Array.from({length:12},(_,i)=>year+'-'+String(i+1).padStart(2,'0'));
    const amounts=new Map(s.entries.map(r=>[targetKey(r.memberId,r.month),r.amount]));
    return json({year,months,version:s.version,rows:members.filter(m=>m.active||s.entries.some(r=>r.memberId===m.id)).map(member=>({member,
      values:Object.fromEntries(months.map(m=>[m,amounts.get(targetKey(member.id,m))??null])),lockedMonths:s.locks.filter(l=>l.memberId===member.id).map(l=>l.month)}))});
  },'admin');
  router.put('/hr/revenue-targets/:year',async c=>{
    const year=validYear(c.params.year),b=await readJson(c.req,300_000);
    const reason=typeof b.reason==='string'?b.reason.trim():'';
    if(reason.length<3||reason.length>500)throw new AppError(400,'Nhập lý do đăng ký/điều chỉnh (3–500 ký tự).');
    if(!Array.isArray(b.changes)||!b.changes.length||b.changes.length>2400)throw new AppError(400,'Chọn từ 1 đến 2.400 ô cần thay đổi.');
    const changes:Array<{memberId:string;month:string;amount:number|null}>=[],seen=new Set<string>();
    for(const raw of b.changes){
      if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new AppError(400,'Dòng đăng ký không hợp lệ.');
      const {memberId,month,amount}=raw as Record<string,unknown>;
      if(typeof memberId!=='string'||memberId.length>200||!isMonth(month)||!month.startsWith(year+'-'))throw new AppError(400,'Nhân viên hoặc tháng không đúng năm đang đăng ký.');
      if(amount!==null&&(typeof amount!=='number'||!Number.isSafeInteger(amount)||amount<=0||amount>1e13))throw new AppError(400,'Chỉ tiêu phải là số tiền nguyên lớn hơn 0, tối đa 10.000 tỷ; để trống để bỏ đăng ký.');
      const key=targetKey(memberId,month);if(seen.has(key))throw new AppError(400,'Trùng nhân viên và tháng trong yêu cầu.');seen.add(key);changes.push({memberId,month,amount});
    }
    return c.env.db.transaction(async tx=>{
      const db=tx as AnyDb;await payrollLock(db);
      const s=await yearState(db,year);if(typeof b.version!=='string'||b.version!==s.version)throw new AppError(409,'Bảng đăng ký đã thay đổi. Tải lại trước khi lưu.','TARGETS_CHANGED');
      const members=new Set((await people(db)).map(m=>m.id)),locked=new Set(s.locks.map(l=>targetKey(l.memberId,l.month)));
      const prior=new Map(s.entries.map(e=>[targetKey(e.memberId,e.month),e.amount]));
      const at=new Date().toISOString(),actor=(c.state.session as SessionState).member.id;
      const mutations:Array<{memberId:string;month:string;amount:number|null;before:number|null}>=[];
      for(const r of changes){
        if(!members.has(r.memberId))throw new AppError(404,'Không tìm thấy nhân viên nội bộ.');
        const key=targetKey(r.memberId,r.month),before=prior.get(key)??null;if(before===r.amount)continue;
        if(locked.has(key))throw new AppError(409,'Tháng '+r.month+' đã chốt lương. Mở lại phiếu trước khi điều chỉnh chỉ tiêu.','TARGET_MONTH_CLOSED');
        mutations.push({...r,before});
      }
      // Three bounded bulk writes; do not send one database round trip for every employee/month.
      const removed=mutations.filter(r=>r.amount===null),puts=mutations.flatMap(r=>r.amount===null?[]:[{memberId:r.memberId,month:r.month,amount:r.amount,updatedBy:actor,updatedAt:at}]);
      if(removed.length)await db.delete(hrRevenueTargets).where(sql`(${hrRevenueTargets.memberId},${hrRevenueTargets.month}) in (${sql.join(removed.map(r=>sql`(${r.memberId},${r.month})`),sql`,`)})`);
      if(puts.length)await db.insert(hrRevenueTargets).values(puts).onConflictDoUpdate({target:[hrRevenueTargets.memberId,hrRevenueTargets.month],set:{amount:sql`excluded.amount`,updatedBy:actor,updatedAt:at}});
      if(mutations.length)await db.insert(auditLogs).values(mutations.map(r=>({id:crypto.randomUUID(),actorId:actor,module:'hr',action:'hr-revenue-target-update',entityType:'hr-revenue-target',entityId:targetKey(r.memberId,r.month),data:JSON.stringify({year,month:r.month,from:r.before,to:r.amount,reason}),createdAt:at})));
      return json({ok:true,changed:mutations.length,version:(await yearState(db,year)).version});
    });
  },'admin');
}
