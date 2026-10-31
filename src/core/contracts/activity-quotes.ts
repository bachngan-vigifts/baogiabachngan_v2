import type {AnyDb} from '../db/client.ts';
/** Public actor scope only; no session credentials cross the module boundary. */
export interface ActivityQuoteActor{id:string;role:'employee'|'manager'|'customer'|'supplier';active:boolean;positionId?:string|null;dataScope?:string|null;approver?:boolean|null;}
export interface ActivityQuoteAccess{
 read(db:AnyDb,actor:ActivityQuoteActor,input:{id:string;revision:number;customerId:string}):Promise<{quoteId:string;quoteRevision:number}>;
 list(db:AnyDb,actor:ActivityQuoteActor,customerId:string):Promise<{id:string;no:string;revision:number}[]>;
}
