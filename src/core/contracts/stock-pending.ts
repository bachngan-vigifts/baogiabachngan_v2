import type {AnyDb} from '../db/client.ts';
export interface StockPendingQuantity {
 /** An empty warehouseId carries an unassigned-hold note, never a warehouse total. */
 sku:string;warehouseId:string;packed:number;returning:number;held:number;unassignedHeld:number;
 /** Quantity attribution is incomplete (legacy delivery without packing/warehouse proof). */
 uncertain:boolean;
}
export type StockPendingOf=(db:AnyDb,skus:string[],warehouseIds:string[],at:string)=>Promise<StockPendingQuantity[]>;
