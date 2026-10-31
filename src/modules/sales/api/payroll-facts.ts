import {and,eq,gte,lt,inArray,or,sql} from 'drizzle-orm';
import type {CrmFactsOf,ContractFact} from '../../../core/contracts/sales-payroll.ts';
import {salesOrders,salesContracts} from '../schema.ts';
const monthRange=(month:string)=>{const d=new Date(month+'-01T00:00:00Z');d.setUTCMonth(d.getUTCMonth()+1);return{from:month+'-01',next:d.toISOString().slice(0,10)};};
import {liquidationAwards} from './contract-liquidation.ts';
import {contractLiquidations} from '../liquidation-schema.ts';
const ORDER='order:';
/** Raw sales facts. Reward tiers and payroll policy belong to HR. */
export const salesPayrollFacts:CrmFactsOf=async(db,month,previous=[],lock=false)=>{
 const {from,next}=monthRange(month),tzFrom=new Date(from+'T00:00:00+07:00').toISOString(),tzNext=new Date(next+'T00:00:00+07:00').toISOString();
 const approved=await db.select({contractId:contractLiquidations.contractId}).from(contractLiquidations).where(and(eq(contractLiquidations.status,'approved'),gte(contractLiquidations.reviewedAt,tzFrom),lt(contractLiquidations.reviewedAt,tzNext)));
 const relevant=[...new Set([...previous,...approved.map(a=>a.contractId)])];
 const query=db.select({k:salesContracts,o:salesOrders}).from(salesContracts).innerJoin(salesOrders,eq(salesOrders.id,salesContracts.orderId)).where(or(and(gte(salesContracts.signedDate,from),lt(salesContracts.signedDate,next)),relevant.length?inArray(salesContracts.id,relevant):undefined));
 const rows=await(lock?query.for('share'):query),liquidated=await liquidationAwards(db,rows.map(r=>r.k.id));
 const members=new Map<string,{newCustomers:number;transactions:number;contracts:number}>(),member=(id:string)=>{let n=members.get(id);if(!n){n={newCustomers:0,transactions:0,contracts:0};members.set(id,n);}return n;};
 // Find the first approved CRM order across all history, with deterministic tie-breaking. Anonymous retail customers are excluded.
 const first=await db.select({owner:sql<string>`f.owner_id`}).from(sql`(select owner_id,order_date,row_number() over(partition by customer_id order by order_date,created_at,id) as n from ${salesOrders} where customer_id is not null and channel='crm' and status in ('confirmed','delivering','delivered')) f`).where(sql`f.n=1 and f.order_date>=${from} and f.order_date<${next}`);
 for(const r of first)member(r.owner).newCustomers++;
 for(const r of rows)if(['signed','completed'].includes(r.k.status)&&r.o.status!=='cancelled'&&r.k.signedDate&&r.k.signedDate>=from&&r.k.signedDate<next)member(r.o.ownerId).contracts++;
 // Thưởng sao còn tính trên đơn hàng CRM đã duyệt không có HĐKT (tháng = ngày đơn). Đơn có HĐKT tính theo HĐKT, không tính hai lần.
 const previousOrders=previous.filter(id=>id.startsWith(ORDER)).map(id=>id.slice(ORDER.length));
 const orderQuery=db.select().from(salesOrders).where(and(eq(salesOrders.channel,'crm'),
  sql`not exists(select 1 from ${salesContracts} k where k.order_id=${salesOrders.id} and k.status<>'cancelled')`,
  or(and(gte(salesOrders.orderDate,from),lt(salesOrders.orderDate,next),inArray(salesOrders.status,['confirmed','delivering','delivered'])),previousOrders.length?inArray(salesOrders.id,previousOrders):undefined)));
 const orders=await(lock?orderQuery.for('share'):orderQuery);
 const contracts:ContractFact[]=[...orders.map(o=>({docType:'order' as const,contractId:ORDER+o.id,contractNo:o.orderNo,customerName:o.customerName,ownerId:o.ownerId,signedDate:o.orderDate,subtotal:o.subtotal,
  status:'signed',orderStatus:o.status,liquidatedAt:null,liquidationValid:false,revision:o.revision})),...rows.map(({k,o})=>({docType:'contract' as const,contractId:k.id,contractNo:k.contractNo,customerName:o.customerName,ownerId:o.ownerId,signedDate:k.signedDate,subtotal:o.subtotal,status:k.status,orderStatus:o.status,liquidatedAt:liquidated.get(k.id)?.at||null,liquidationValid:liquidated.get(k.id)?.valid||false,revision:k.revision}))];
 return{members,contracts};
};
