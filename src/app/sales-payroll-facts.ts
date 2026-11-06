import {sql} from 'drizzle-orm';
import {AppError} from '../core/errors.ts';
import type {CrmFactsOf} from '../core/contracts/sales-payroll.ts';
import {salesPayrollFacts} from '../modules/sales/api/payroll-facts.ts';
import {activityFacts} from '../modules/care/api/kpi-facts.ts';
import {newCustomerFacts} from '../modules/customers/api/kpi-facts.ts';
export const crmFactsOf:CrmFactsOf=async(db,month,ids,lock,options)=>{
 const [ready]=await db.select({table:sql<string|null>`to_regclass('public.contract_liquidation_requests')::text`}).from(sql`(select 1) probe`);if(!ready?.table)throw new AppError(503,'Chưa khởi tạo nguồn thanh lý HĐKT; chưa thể tính thưởng CRM. Liên hệ Manager.','CRM_FACTS_NOT_READY');
 const end=new Date(month+'-01T00:00:00Z');end.setUTCMonth(end.getUTCMonth()+1);
 const next=end.toISOString().slice(0,10);
 const [sales,care,customers]=await Promise.all([salesPayrollFacts(db,month,ids,lock,options),activityFacts(db,month+'-01',next),newCustomerFacts(db,month+'-01',next)]);
 for(const [id,newCustomers]of customers){const m=sales.members.get(id)||{newCustomers:0,transactions:0,contracts:0};sales.members.set(id,{...m,newCustomers});}
 for(const [id,transactions]of care.counts){const m=sales.members.get(id)||{newCustomers:0,transactions:0,contracts:0};sales.members.set(id,{...m,transactions});}return sales;
};
