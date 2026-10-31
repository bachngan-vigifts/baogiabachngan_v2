import type {AnyDb} from '../db/client.ts';
export interface ContractFact{contractId:string;contractNo:string;customerName:string;ownerId:string;signedDate:string|null;subtotal:number;status:string;orderStatus:string;liquidatedAt:string|null;liquidationValid:boolean;revision:number;}
export interface SalesFacts{members:Map<string,{newCustomers:number;transactions:number;contracts:number}>;contracts:ContractFact[];}
export type CrmFactsOf=(db:AnyDb,month:string,previousContractIds?:readonly string[],lock?:boolean)=>Promise<SalesFacts>;
