import { boundedMap } from '../../../core/async/bounded-map.ts';
import { asc, eq, inArray } from 'drizzle-orm';
import type { AnyDb } from '../../../core/db/client.ts';
import { products, warehouses } from '../schema.ts';
import { hiddenStockWarehouses, readCatalogStock, catalogStockHooks } from './stock-source.ts';
type Member={role:string;positionId?:string|null};
export interface CatalogueIncoming{sku:string;orderId:string;ticketNumber:string;supplierName:string;arrivalDate:string|null;left:number}
export const catalogueLibraryHooks:{heldAt?:(db:AnyDb,skus:string[],warehouseId:string)=>Promise<Map<string,number>>;incoming?:(db:AnyDb,skus:string[])=>Promise<CatalogueIncoming[]>}={};
const round=(n:number)=>Math.round(n*1000)/1000;
export async function catalogueStockFacts(db:AnyDb,member:Member,input:string[]){
 const skus=[...new Set(input)].slice(0,100);if(!skus.length)return[];
 const known=await db.select({sku:products.sku,unit:products.unit,active:products.active}).from(products).where(inArray(products.sku,skus));
 const checkedAt=new Date().toISOString(),unknown=(sku:string)=>({sku,known:false,available:null,incoming:null,supplier:null,warehouses:[],checkedAt,reason:'Chưa khớp mã đang hoạt động trên CRM.'});
 const matched=known.filter(p=>p.active).map(p=>p.sku);if(!matched.length)return skus.map(unknown);
 const [all,hidden]=await Promise.all([db.select().from(warehouses).where(eq(warehouses.active,true)).orderBy(asc(warehouses.sortOrder),asc(warehouses.name)),hiddenStockWarehouses(db,member)]);
 const visible=all.filter(w=>!hidden.has(w.id)),real=visible.filter(w=>w.kind==='stock');
 const [stockResult,incomingResult,heldResult,opened,heldTotal]=await Promise.all([readCatalogStock(db,matched).then(rows=>({rows,error:false})).catch(()=>({rows:[],error:true})),catalogueLibraryHooks.incoming?catalogueLibraryHooks.incoming(db,matched).then(rows=>({rows,error:false})).catch(()=>({rows:[],error:true})):Promise.resolve({rows:[],error:true}),catalogueLibraryHooks.heldAt?boundedMap(real,2,async w=>[w.id,await catalogueLibraryHooks.heldAt!(db,matched,w.id)] as const).catch(()=>null):Promise.resolve(null),catalogStockHooks.ledger?catalogStockHooks.ledger(db):Promise.resolve([] as string[]),catalogStockHooks.held?catalogStockHooks.held(db,member,matched).catch(()=>null):Promise.resolve(null)]);
 const held=heldResult?new Map(heldResult):null;
 return skus.map(sku=>{
  const p=known.find(p=>p.sku===sku);if(!p||!p.active)return unknown(sku);
  const rows=stockResult.rows.filter(r=>r.sku===sku),actual=real.map(w=>{const row=rows.find(r=>r.warehouseId===w.id),evidence=!!row||opened.includes(w.id);return{id:w.id,name:w.name,source:opened.includes(w.id)?'ledger':'sapo',onHand:evidence&&!stockResult.error?row?.quantity||0:null,held:held?held.get(w.id)?.get(sku)||0:null,available:evidence&&!stockResult.error&&held?round(Math.max(0,(row?.quantity||0)-(held.get(w.id)?.get(sku)||0))):null,updatedAt:row?.updatedAt||null};});
  const supplierRows=visible.filter(w=>w.kind==='supplier').flatMap(w=>{const row=rows.find(r=>r.warehouseId===w.id);return row?[{id:w.id,name:w.name,qty:row.quantity,updatedAt:row.updatedAt}]:[];});
  const orders=incomingResult.rows.filter(r=>r.sku===sku&&r.left>0).sort((a,b)=>(a.arrivalDate||'9').localeCompare(b.arrivalDate||'9')).map(r=>({orderId:r.orderId,orderNo:r.ticketNumber,supplierName:r.supplierName,arrivalDate:r.arrivalDate,qty:r.left}));
  return{sku,known:true,unit:p.unit,available:actual.length&&actual.every(w=>w.onHand!==null)&&heldTotal?round(Math.max(0,actual.reduce((n,w)=>n+(w.onHand||0),0)-(heldTotal.get(sku)||0))):null,heldTotal:heldTotal?round(heldTotal.get(sku)||0):null,warehouses:actual,incoming:incomingResult.error?null:{qty:round(orders.reduce((n,r)=>n+r.qty,0)),orders},supplier:stockResult.error||!supplierRows.length?null:{qty:round(supplierRows.reduce((n,r)=>n+r.qty,0)),warehouses:supplierRows},checkedAt,reason:stockResult.error||!held?'Chưa đọc đủ tồn/giữ hàng.':null};
 });
}
