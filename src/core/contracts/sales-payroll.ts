import type {AnyDb} from '../db/client.ts';
/** Nguồn thưởng sao: HĐKT, hoặc đơn hàng CRM không có HĐKT (`docType:'order'`, `contractId` = 'order:'+id). Thưởng thanh lý chỉ có ở HĐKT. */
export interface ContractFact{docType?:'contract'|'order';contractId:string;contractNo:string;customerName:string;ownerId:string;signedDate:string|null;subtotal:number;status:string;orderStatus:string;liquidatedAt:string|null;liquidationValid:boolean;revision:number;}
export interface SalesFacts{members:Map<string,{newCustomers:number;transactions:number;contracts:number;netRevenue?:number;netRevenueIssues?:number}>;contracts:ContractFact[];}
export type CrmFactsOf=(db:AnyDb,month:string,previousContractIds?:readonly string[],lock?:boolean,options?:{approvedOnly?:boolean})=>Promise<SalesFacts>;
