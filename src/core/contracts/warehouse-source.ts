import type {AnyDb} from '../db/client.ts';
export interface WarehouseSourceTask {id:string;autoKey:string|null;source:string;sourceId:string|null;assigneeId:string|null;assigneePosition:string|null;link:string}
export interface WarehouseSource {operationKey:string;warehouseId:string;kind:'picking'|'packing'|'receiving'|'transfer'|'stocktake';complete:boolean;cancelled:boolean}
/** Composition root resolves source documents; no reverse dependencies from Tasks. */
export const warehouseSourceHooks:{resolve?:(db:AnyDb,task:WarehouseSourceTask)=>Promise<WarehouseSource|null>}={};
export const warehouseAssignmentHooks:{
 afterReconcile?:(db:AnyDb,ids:string[],now:string)=>Promise<void>;
 assignees?:(db:AnyDb,ids:string[])=>Promise<Map<string,{memberId:string;canonicalId:string}>>;
}={};
