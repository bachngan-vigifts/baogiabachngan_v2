import {and,eq,isNull,ne,sql} from 'drizzle-orm';
import type {AnyDb} from '../../../core/db/client.ts';
import {employees} from '../../staff/schema.ts';
import {warehouses} from '../../catalog/schema.ts';
import {stockTransfers,warehouseSellers} from '../schema.ts';
import {transferCanApprove,transferRequesterPositions} from '../domain/transfer-approval.ts';
type Db=AnyDb|Parameters<Parameters<AnyDb['transaction']>[0]>[0];
type Transfer={requestedBy:string;fromWarehouseId:string;toWarehouseId:string};
/** One directory per reconciliation batch, rather than one lookup per pending transfer. */
export async function loadTransferApprovalDirectory(db:Db){
 const [people,privateWarehouses,sellers]=await Promise.all([
  db.select({id:employees.id,role:employees.role,positionId:employees.positionId,active:employees.active,deletedAt:employees.deletedAt}).from(employees).where(and(eq(employees.active,true),isNull(employees.deletedAt))),
  db.select({id:warehouses.id}).from(warehouses).where(eq(warehouses.stockPrivate,true)),
  db.select({warehouseId:warehouseSellers.warehouseId,positionId:warehouseSellers.positionId}).from(warehouseSellers),
 ]);
 const byId=new Map(people.map(p=>[p.id,p])),hidden=new Set(privateWarehouses.map(w=>w.id));
 return (t:Transfer,includeManagers=false)=>people.filter(p=>(includeManagers||p.role!=='manager')&&transferCanApprove(p,byId.get(t.requestedBy))&&
  (p.role==='manager'||[t.fromWarehouseId,t.toWarehouseId].every(id=>!hidden.has(id)||sellers.some(s=>s.warehouseId===id&&s.positionId===p.positionId)))).map(p=>p.id);
}
/** Filter transfer entries inside the generic approval inbox using the same position matrix. */
export function transferApprovalScope(m:{id:string;role:string;positionId?:string|null}){
 if(m.role==='manager')return undefined;
 const positions=transferRequesterPositions(m.positionId);
 if(m.role!=='employee'||!positions.length)return sql`false`;
 return and(ne(stockTransfers.requestedBy,m.id),
  sql`EXISTS (SELECT 1 FROM ${employees} requester WHERE requester.id=${stockTransfers.requestedBy} AND requester.role='employee' AND requester.active=true AND requester.deleted_at IS NULL AND requester.position_id IN (${sql.join(positions.map(p=>sql`${p}`),sql`, `)}))`,
  sql`NOT EXISTS (SELECT 1 FROM ${warehouses} private_wh WHERE private_wh.stock_private=true AND private_wh.id IN (${stockTransfers.fromWarehouseId},${stockTransfers.toWarehouseId}) AND NOT EXISTS (SELECT 1 FROM ${warehouseSellers} seller WHERE seller.warehouse_id=private_wh.id AND seller.position_id=${m.positionId||''}))`);
}
