import {eq} from 'drizzle-orm';
import {setupLiquidation} from './liquidation-fixture.ts';
import {customers,customerStaff} from '../../src/modules/customers/schema.ts';
import {salesOrders,salesContracts,salesOrderLines,customerPayments} from '../../src/modules/sales/schema.ts';
export async function setupSalesPayroll(){
 const f=await setupLiquidation();
 await f.db.insert(customers).values({id:'sales-customer',name:'Khách KPI kiểm thử',search:'khach kpi',syncedAt:'',contact:'Khách kiểm thử',phone:'',email:'',address:'',taxCode:'',customerCode:'',sourceVersion:0});
 await f.db.insert(customerStaff).values({customerId:'sales-customer',memberId:'emp',role:'owner',createdBy:'mgr',createdAt:f.stamp});
 await f.db.update(salesOrders).set({customerId:'sales-customer',subtotal:20_000_000,total:21_600_000}).where(eq(salesOrders.id,'liq-order'));
 await f.db.update(salesContracts).set({customerId:'sales-customer',value:21_600_000}).where(eq(salesContracts.id,'liq-contract'));
 await f.db.update(salesOrderLines).set({unitPrice:20_000_000,amount:20_000_000,taxRate:8}).where(eq(salesOrderLines.id,'liq-service'));
 await f.db.update(customerPayments).set({amount:21_600_000}).where(eq(customerPayments.id,'liq-paid'));
 await f.client.query("insert into staff_position_permissions(position_id,permission) values('liquidation-outsider','page.care')");
 const settings=(await f.call('/hr/settings?month=2026-10',f.mgr)).data.params;
 const setPolicy=(apply=0,month='2026-10',extra={})=>f.call('/hr/settings',f.mgr,'PUT',{effectiveMonth:month,params:{...settings,salesAutomationFrom:202610,salesAutomationApply:apply,kpiNewCustomersOver:0.1,...extra}});
 const salary=(extra={})=>f.call('/hr/members/emp/salary',f.mgr,'PUT',{effectiveMonth:'2026-10',payrollGroup:'sale',kpiEnabled:true,contractBonusEnabled:true,baseSalary:1_000_000,...extra});
 const overview=(who=f.mgr,month='2026-10')=>f.call('/members/emp/overview?month='+month,who);
 const care=(extra={})=>f.call('/care',f.emp,'POST',{clientKey:crypto.randomUUID(),customerId:'sales-customer',contactName:'Khách kiểm thử',occurredAt:'2026-10-30',type:'call',completion:'completed',purpose:'sales',result:'consulting',content:'Đã trao đổi nhu cầu và thống nhất bước tiếp theo',nextAt:'2026-11-15',remindBefore:'1d',...extra});
 const confirm=async(month='2026-10',extra={})=>{const view=await overview(f.mgr,month);return f.call('/hr/members/emp/payslips/'+month,f.mgr,'POST',{confirmationHash:view.data.payroll?.confirmationHash,...extra});};
 const award=async()=>{const r=await f.request();if(r.status!==201)throw Error(JSON.stringify(r));const view=(await f.call(f.path,f.mgr)).data;return f.call(f.path+'/'+r.data.id+'/review',f.mgr,'POST',{decision:'approved',revision:1,confirmOriginals:true,expectedHash:view.proof.hash});};
 return{...f,setPolicy,salary,overview,care,confirm,award};
}
