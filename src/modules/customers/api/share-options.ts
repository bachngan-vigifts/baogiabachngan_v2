import {and,asc,eq,inArray,isNull,notInArray,or} from 'drizzle-orm';
import type {StaffEnv} from '../../staff/api/auth-routes.ts';
import {employees} from '../../staff/schema.ts';
import {AppError} from '../../../core/errors.ts';
type Db=StaffEnv['db']|Parameters<Parameters<StaffEnv['db']['transaction']>[0]>[0];
const EXCLUDED=['it','thiet-ke','warehouse'];
export const customerSharePositionAllowed=()=>or(isNull(employees.positionId),notInArray(employees.positionId,EXCLUDED));
export async function customerStaffOptions(db:Db){
 const rows=await db.select({id:employees.id,name:employees.name,role:employees.role,positionId:employees.positionId}).from(employees)
  .where(and(eq(employees.active,true),isNull(employees.deletedAt),inArray(employees.role,['employee','manager']))).orderBy(asc(employees.name));
 return rows.map(({positionId,...p})=>({...p,canShare:!EXCLUDED.includes(positionId??'')}));
}
/** Validate additions only; existing assignments are never revoked by hiding a choice. Caller locks the customer. */
export async function validateNewCustomerShares(db:Db,ids:string[]){
 if(!ids.length)return;
 const allowed=await db.select({id:employees.id}).from(employees).where(and(inArray(employees.id,ids),eq(employees.active,true),isNull(employees.deletedAt),inArray(employees.role,['employee','manager']),customerSharePositionAllowed())).for('share');
 if(allowed.length!==ids.length)throw new AppError(400,'Không chia sẻ mới cho IT, Thiết kế, Kho hoặc tài khoản không còn hoạt động.');
}
