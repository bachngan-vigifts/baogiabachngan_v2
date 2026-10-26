import {and,desc,eq,inArray} from 'drizzle-orm';
import {auditLogs} from '../../../core/db/schema.ts';
import {employees} from '../../staff/schema.ts';
import type {StaffEnv} from '../../staff/api/auth-routes.ts';
export function canConfirmDelivery(member:{id:string;role:string;positionId?:string|null},order:{ownerId:string|null;createdBy:string}){
 return member.role==='manager'||member.role==='employee'&&(member.positionId==='warehouse'||member.positionId==='sale-admin'||order.ownerId===member.id||!order.ownerId&&order.createdBy===member.id);
}
/** New confirmations are explicit columns; old committed dispatch audit is evidence, never the creator. */
export async function deliveryConfirmations(db:StaffEnv['db'],rows:readonly {id:string;status:string;confirmedBy:string|null;confirmedAt:string|null;confirmedStatus:string|null}[]){
 const proof=new Map<string,{confirmedBy:string;confirmedAt:string;confirmedStatus:string}>();
 for(const row of rows)if(row.confirmedBy&&row.confirmedAt&&row.confirmedStatus)proof.set(row.id,{confirmedBy:row.confirmedBy,confirmedAt:row.confirmedAt,confirmedStatus:row.confirmedStatus});
 const missing=rows.filter(r=>!proof.has(r.id));
 if(missing.length){const logs=await db.select().from(auditLogs).where(and(eq(auditLogs.entityType,'deliveries'),inArray(auditLogs.entityId,missing.map(r=>r.id)),inArray(auditLogs.action,['dispatch','delivery-status-confirm'])))
  .orderBy(desc(auditLogs.createdAt),desc(auditLogs.id));
  const status=new Map(missing.map(r=>[r.id,r.status]));
  for(const log of logs){if(proof.has(log.entityId)||!log.actorId)continue;try{const data=JSON.parse(log.data),stage=data.to||data.status;if(stage===status.get(log.entityId))proof.set(log.entityId,{confirmedBy:log.actorId,confirmedAt:log.createdAt,confirmedStatus:stage});}catch{/* Unstructured legacy entry is not proof. */}}
 }
 const ids=[...new Set([...proof.values()].map(p=>p.confirmedBy))];
 const names=ids.length?new Map((await db.select({id:employees.id,name:employees.name}).from(employees).where(inArray(employees.id,ids))).map(p=>[p.id,p.name])):new Map<string,string>();
 return new Map([...proof].map(([id,p])=>[id,{...p,confirmedByName:names.get(p.confirmedBy)||p.confirmedBy}]));
}
