import type {AnyDb} from '../db/client.ts';
import type {CustomerMergeTx} from './customer-merge.ts';
export type CatalogueCustomerDb=AnyDb|CustomerMergeTx;
export interface CatalogueCustomerActor{id:string;role:string;positionId?:string|null}
export interface CustomerCatalogueQuote{id:string;quoteNo:string;title:string;productCount:number;createdByName:string;updatedAt:string}
/** Composition bridges optional catalogue documents and customer profiles. */
export interface CatalogueCustomerLinks{
 resolve(db:CatalogueCustomerDb,actor:CatalogueCustomerActor,id:string):Promise<{id:string;name:string}>;
 list(db:AnyDb,actor:CatalogueCustomerActor,id:string,all:boolean):Promise<CustomerCatalogueQuote[]>;
}
