import type {AnyDb} from '../db/client.ts';
/** Immutable approved amount; legacy preview snapshots are deliberately excluded. */
export interface WarehouseBonus {version:1;amount:number;month:string;approvedAt:string;score:number;budget:number;factor:number}
export type WarehouseBonusOf=(db:AnyDb,month:string,ids:readonly string[])=>Promise<Map<string,WarehouseBonus>>;
export type AssertWarehousePayrollOpen=(db:AnyDb,id:string,month:string)=>Promise<void>;
