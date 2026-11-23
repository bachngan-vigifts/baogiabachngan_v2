import {sql} from 'drizzle-orm';
import {purchaseReadLevel} from '../../suppliers/domain/purchase-access.ts';
import {isWarehouseStaff} from '../../suppliers/domain/purchasing.ts';
import {tasks} from '../schema.ts';
import {purchaseScope,earlyPurchaseScope,type Member} from '../../suppliers/api/purchase-store.ts';
import {incomingShipments} from '../../suppliers/schema.ts';
import {purchaseEarlyRequests} from '../../suppliers/early-request-schema.ts';
import {warehouseReceivingScope} from '../../suppliers/api/purchase-receiving.ts';
/** Source-linked tasks must not resurrect access removed from the parent document. */
export function purchaseTaskScope(m:Member){
 if(m.role==='manager')return sql`true`;
 return sql`((${isWarehouseStaff(m)?sql`true`:sql`false`} and ${tasks.autoKey} like 'purchase:%' and exists(select 1 from sapo_inventory_docs d where d.id=${tasks.sourceId})) or ${tasks.sourceId} is null or coalesce(${tasks.source},'') not in ('purchase','early') or
 exists(select 1 from ${incomingShipments} where ${incomingShipments.id}=${tasks.sourceId} and (${purchaseScope(m)} or (${warehouseReceivingScope(m)} and (${tasks.assigneeId}=${m.id} or (${tasks.assigneeId} is null and ${tasks.assigneePosition}='warehouse')) and (${tasks.autoKey} like 'receiving-due:%' or ${tasks.autoKey} like 'po-sapo:%')))) or
 exists(select 1 from ${purchaseEarlyRequests} where ${purchaseEarlyRequests.id}=${tasks.sourceId} and (${earlyPurchaseScope(m)} or (${isWarehouseStaff(m)?sql`true`:sql`false`} and ${tasks.assigneeId}=${m.id} and ${tasks.autoKey} like 'receiving-due:%'))))`;
}

/** Only operational fields from source tasks survive for roles without commercial access. */
export function purchaseTaskProjection<T extends {source:string}>(m:Member,t:T):T{
 if(purchaseReadLevel(m)!=='none'||!['purchase','early'].includes(t.source)||!('sourceId' in t)||!t.sourceId)return t;
 return {...t,title:'Nhận hàng được giao',description:'Mở hàng được giao để ghi nhận số lượng nhận.',link:'#/receiving',sourceId:null};
}
export function purchaseTaskTitle(m:Member){
 return purchaseReadLevel(m)==='none'?sql<string>`case when ${tasks.sourceId} is not null and ${tasks.source} in ('purchase','early') then 'Nhận hàng được giao' else ${tasks.title} end`:tasks.title;
}
