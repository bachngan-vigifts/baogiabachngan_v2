import {and,eq,gte,lt,inArray} from 'drizzle-orm';
import type {DashboardKpiDetailOf,DashboardKpiDetailRow} from '../core/contracts/dashboard-kpi.ts';
import {dashboardKpiOf} from './dashboard-kpi.ts';
import {customers} from '../modules/customers/schema.ts';
import {newCustomerCondition} from '../modules/customers/api/kpi-facts.ts';
import {activityFacts} from '../modules/care/api/kpi-facts.ts';
import {salesOrders,salesContracts} from '../modules/sales/schema.ts';
import {kpiNetRevenue} from '../modules/sales/api/kpi-net-revenue.ts';
import {debtCounts} from '../modules/sales/domain/sales.ts';
/** Read-only drilldown. Current CRM facts are never presented as frozen payroll evidence. */
export const dashboardKpiDetailOf:DashboardKpiDetailOf=async(db,month,memberId,metric,page)=>{
 const member=(await dashboardKpiOf(db,month,[memberId]))[0];if(!member)return null;
 const d=new Date(month+'-01T00:00:00Z');d.setUTCMonth(d.getUTCMonth()+1);
 const from=month+'-01',next=d.toISOString().slice(0,10),rows:DashboardKpiDetailRow[]=[];let issues=0;
 if(metric==='newCustomers'){
  const data=await db.select().from(customers).where(and(eq(customers.createdBy,memberId),newCustomerCondition(from,next)));
  for(const c of data)rows.push({id:c.id,date:c.approvedAt||c.createdAt,label:c.customerCode||c.name,customer:c.name,amount:1,href:'#/customers/'+encodeURIComponent(c.id),note:'Hồ sơ đã duyệt · người tạo'});
 }else if(metric==='transactions'){
  const facts=await activityFacts(db,from,next,[memberId]);
  const ids=[...new Set(facts.rows.map(a=>a.customerId))];
  const names=new Map((ids.length?await db.select({id:customers.id,name:customers.name}).from(customers).where(inArray(customers.id,ids)):[]).map(c=>[c.id,c.name]));
  for(const a of facts.rows)if(facts.marks.get(a.id)?.counted)rows.push({id:a.id,date:a.occurredAt,label:a.content,customer:names.get(a.customerId)||a.customerId,amount:1,href:'#/customers/'+encodeURIComponent(a.customerId),note:facts.marks.get(a.id)!.reason});
 }else{
  const orders=await db.select().from(salesOrders).where(and(eq(salesOrders.ownerId,memberId),gte(salesOrders.orderDate,from),lt(salesOrders.orderDate,next)));
  const ids=orders.map(o=>o.id),contracts=ids.length?await db.select().from(salesContracts).where(inArray(salesContracts.orderId,ids)):[];
  const details:{id:string;ownerId:string;amount:number|null}[]=[];
  if(metric==='revenue'&&member.revenueBasis==='net-revenue')await kpiNetRevenue(db,from,next,member.approvedOnly,undefined,details);
  const amounts=new Map(details.filter(x=>x.ownerId===memberId).map(x=>[x.id,x.amount]));
  for(const o of orders){
   const contract=contracts.find(k=>k.orderId===o.id&&k.status!=='cancelled');let amount:number|null;
   if(metric==='contracts'){if(o.channel!=='crm'||!['confirmed','delivering','delivered'].includes(o.status))continue;amount=1;}
   else if(member.revenueBasis==='net-revenue'){if(!amounts.has(o.id))continue;amount=amounts.get(o.id)!;if(amount===null)issues++;}
   else{if(!debtCounts(o.status,contract?.status))continue;amount=o.total;}
   rows.push({id:o.id,date:o.orderDate,label:o.orderNo+(contract?' · '+contract.contractNo:''),customer:o.customerName,amount,href:'#/orders/'+encodeURIComponent(o.id),note:amount===null?'Thiếu căn cứ hoa hồng; chưa cộng doanh số':metric==='contracts'?'Mỗi đơn được tính một lần':member.revenueBasis==='net-revenue'?'Chưa VAT, trừ hoa hồng':'Giá trị đơn gồm VAT'});
  }
 }
 rows.sort((a,b)=>b.date.localeCompare(a.date)||a.id.localeCompare(b.id));
 const pages=Math.max(1,Math.ceil(rows.length/50)),current=Math.min(page,pages);
 return {member,metric,total:rows.reduce((n,r)=>n+(r.amount??0),0),sourceCount:rows.length,issues,page:current,pages,rows:rows.slice((current-1)*50,current*50)};
};
