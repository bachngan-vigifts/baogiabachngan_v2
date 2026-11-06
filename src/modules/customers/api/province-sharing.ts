import {and,asc,eq,inArray,isNull} from 'drizzle-orm';
import {AppError} from '../../../core/errors.ts';
import {json,readJson,type Router,type RouteContext} from '../../../core/http/router.ts';
import type {StaffEnv,SessionState} from '../../staff/api/auth-routes.ts';
import {employees} from '../../staff/schema.ts';
import {sha256Hex} from '../../staff/domain/session.ts';
import {customers,customerStaff} from '../schema.ts';
import {CUSTOMER_LIMITS} from '../domain/customer-config.ts';
import {provinceOptions} from '../domain/province.ts';
import {provinceCodeSql} from './province.ts';

export function registerProvinceSharing(router:Router<StaffEnv>){
 const run=async(c:RouteContext<StaffEnv>,apply:boolean)=>{
  const me=(c.state.session as SessionState).member;
  if(me.role!=='manager')throw new AppError(403,'Chỉ Manager được chia sẻ hàng loạt theo tỉnh.');
  const b=await readJson(c.req,8000),province=provinceOptions.find(p=>p.code===b.province);
  if(!province)throw new AppError(400,'Chọn một tỉnh/thành đã xác định.');
  if(!Array.isArray(b.memberIds)||!b.memberIds.length||b.memberIds.length>10||b.memberIds.some(x=>typeof x!=='string'||!x||x.length>200))throw new AppError(400,'Chọn từ 1 đến 10 nhân viên nhận chia sẻ.');
  const memberIds=[...new Set(b.memberIds as string[])].sort();
  return c.env.db.transaction(async tx=>{
   const staff=await tx.select({id:employees.id,name:employees.name}).from(employees).where(and(inArray(employees.id,memberIds),eq(employees.active,true),isNull(employees.deletedAt),inArray(employees.role,['manager','employee']))).orderBy(asc(employees.id)).for('share');
   if(staff.length!==memberIds.length)throw new AppError(400,'Có nhân viên đã ngừng hoạt động hoặc không hợp lệ.');
   const query=tx.select({id:customers.id,name:customers.name,address:customers.address}).from(customers).where(and(eq(customers.approvalStatus,'approved'),eq(provinceCodeSql(customers.address),province.code))).orderBy(asc(customers.id)).limit(5001);
   const rows=await (apply?query.for('update'):query);
   if(rows.length>5000)throw new AppError(400,'Tỉnh có hơn 5.000 khách. Cần chia thành đợt nhỏ trước khi chia sẻ.');
   const version=sha256Hex(JSON.stringify([province.code,memberIds,rows.map(r=>[r.id,r.address])]));
   if(apply&&(typeof b.version!=='string'||b.version!==version))throw new AppError(409,'Danh sách khách đã thay đổi. Xem trước lại trước khi chia sẻ.');
   const existing=rows.length?await tx.select().from(customerStaff).where(inArray(customerStaff.customerId,rows.map(r=>r.id))):[];
   const byCustomer=new Map<string,typeof existing>();for(const r of existing){const list=byCustomer.get(r.customerId)||[];list.push(r);byCustomer.set(r.customerId,list);}
   const stamp=new Date().toISOString(),additions=[];let alreadyShared=0;
   for(const row of rows){
    const attached=byCustomer.get(row.id)||[],missing=memberIds.filter(id=>!attached.some(s=>s.memberId===id));
    if(!missing.length)alreadyShared++;
    if(attached.filter(s=>s.role==='shared').length+missing.length>CUSTOMER_LIMITS.shared)throw new AppError(409,'Có khách sẽ vượt giới hạn nhân viên được chia sẻ. Điều chỉnh danh sách trước khi thử lại.');
    additions.push(...missing.map(memberId=>({customerId:row.id,memberId,role:'shared' as const,createdBy:me.id,createdAt:stamp})));
   }
   if(apply)for(let i=0;i<additions.length;i+=200)await tx.insert(customerStaff).values(additions.slice(i,i+200)).onConflictDoNothing();
   return json({province,staff,total:rows.length,alreadyShared,addedShares:additions.length,version,sample:rows.slice(0,5).map(r=>({id:r.id,name:r.name})),applied:apply});
  });
 };
 router.post('/customers/province-sharing/preview',c=>run(c,false),'business');
 router.post('/customers/province-sharing/apply',c=>run(c,true),'business');
}
