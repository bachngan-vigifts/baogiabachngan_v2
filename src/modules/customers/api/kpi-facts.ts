import {and,count,eq,gte,isNotNull,isNull,lt,ne,or,sql} from 'drizzle-orm';
import type {NewCustomerFactsOf} from '../../../core/contracts/sales-payroll.ts';
import {customers} from '../schema.ts';

/** One approved business profile credits its creator, without requiring any order.
 * Approval month uses Vietnam boundaries. Older approved web profiles without an
 * approval timestamp fall back to their creation timestamp; imports are not prospects.
 */
export const newCustomerCondition=(from:string,next:string)=>{
  const creditedAt=sql<string>`coalesce(nullif(${customers.approvedAt},''),nullif(${customers.createdAt},''))`;
  return and(
    eq(customers.approvalStatus,'approved'),eq(customers.isRetail,false),isNotNull(customers.createdBy),ne(customers.createdBy,''),ne(customers.createdAt,''),
    or(isNull(customers.dataSource),eq(customers.dataSource,'web')),
    gte(creditedAt,new Date(from+'T00:00:00+07:00').toISOString()),lt(creditedAt,new Date(next+'T00:00:00+07:00').toISOString()),
  );
};
export const newCustomerFacts:NewCustomerFactsOf=async(db,from,next)=>{
  const rows=await db.select({memberId:customers.createdBy,total:count()}).from(customers).where(newCustomerCondition(from,next)).groupBy(customers.createdBy);
  return new Map(rows.map(r=>[r.memberId!,Number(r.total)]));
};
