import {and,desc,eq,exists,inArray,isNull,sql} from 'drizzle-orm';
import {AppError} from '../core/errors.ts';
import {json,type Router} from '../core/http/router.ts';
import {fold,matchAllWords} from '../core/text/fold.ts';
import type {CatalogueCustomerLinks} from '../core/contracts/catalogue-customer.ts';
import type {CustomerMergeTx} from '../core/contracts/customer-merge.ts';
import type {StaffEnv,SessionState} from '../modules/staff/api/auth-routes.ts';
import {employees} from '../modules/staff/schema.ts';
import {seesAllAsSaleAdmin} from '../modules/staff/domain/roles.ts';
import {customerAccess} from '../modules/customers/api/routes.ts';
import {canListRetailCustomers} from '../modules/customers/domain/customer-config.ts';
import {customers,customerStaff} from '../modules/customers/schema.ts';
import {catalogueQuotes as quotes} from '../modules/catalog/catalogue-library-schema.ts';
const linkedId=sql<string>`${quotes.data}::jsonb->'meta'->>'customerId'`;
export const catalogueCustomerLinks:CatalogueCustomerLinks={
 async resolve(db,actor,id){
  const [row]=await db.select({id:customers.id,name:customers.name,approval:customers.approvalStatus,retail:customers.isRetail}).from(customers).where(eq(customers.id,id)).limit(1);
  if(!row||row.retail&&!canListRetailCustomers(actor))throw new AppError(404,'Không tìm thấy khách hàng có thể sử dụng.');
  if(row.approval!=='approved')throw new AppError(400,'Khách hàng chưa được duyệt để lập báo giá.');
  if(!(await customerAccess(db as StaffEnv['db'],id,actor)).canSeeAll)throw new AppError(403,'Chỉ Manager, nhân viên phụ trách hoặc được chia sẻ khách được gắn báo giá Catalogue.');
  return{id:row.id,name:row.name};
 },
 async list(db,actor,id,all){return db.select({id:quotes.id,quoteNo:quotes.quoteNo,title:quotes.title,productCount:quotes.productCount,createdByName:sql<string>`coalesce(${employees.name},'Không rõ nhân viên')`,updatedAt:quotes.updatedAt}).from(quotes).leftJoin(employees,eq(quotes.createdBy,employees.id)).where(and(eq(linkedId,id),isNull(quotes.deletedAt),all?undefined:eq(quotes.createdBy,actor.id))).orderBy(desc(quotes.updatedAt),desc(quotes.id)).limit(100);},
};
export function registerCatalogueCustomers(router:Router<StaffEnv>){
 router.get('/catalogue-customers',async c=>{
  const actor=(c.state.session as SessionState).member,id=c.url.searchParams.get('id')||'',query=c.url.searchParams.get('q')||'';
  if(id.length>200||query.length>200)throw new AppError(400,'Nội dung tìm khách quá dài.');
  if(id)return json({customer:await catalogueCustomerLinks.resolve(c.env.db,actor,id)});
  if(query.trim().length<2)return json({customers:[]});
  const scope=actor.role==='manager'||seesAllAsSaleAdmin(actor)?undefined:exists(c.env.db.select({id:customerStaff.customerId}).from(customerStaff).where(and(eq(customerStaff.customerId,customers.id),eq(customerStaff.memberId,actor.id))));
  const rows=await c.env.db.select({id:customers.id,name:customers.name,phone:customers.phone,taxCode:customers.taxCode}).from(customers).where(and(scope,eq(customers.approvalStatus,'approved'),canListRetailCustomers(actor)?undefined:eq(customers.isRetail,false),matchAllWords(sql`${customers.search}`,query))).orderBy(customers.name,customers.id).limit(8);
  return json({customers:rows});
 },'business');
}
export async function reassignCatalogueCustomer(tx:CustomerMergeTx,keepId:string,dropIds:string[]){
 if(!dropIds.length)return;
 const [keep]=await tx.select({name:customers.name}).from(customers).where(eq(customers.id,keepId));if(!keep)return;
 await tx.update(quotes).set({customer:keep.name,data:sql`jsonb_set(jsonb_set(${quotes.data}::jsonb,'{meta,customerId}',to_jsonb(${keepId}::text),true),'{meta,customer}',to_jsonb(${keep.name}::text),true)::text`,search:sql`${quotes.search}||' '||${fold(keep.name)}`,revision:sql`${quotes.revision}+1`,updatedAt:new Date().toISOString()}).where(inArray(linkedId,dropIds));
}
