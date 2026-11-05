import {hydrateSnapshot,searchProducts} from './product-search.js';
/** Session-only stock preload. Never a checkout authority and never written to browser storage. */
export function createPosStockCache({now=()=>Date.now(),ttl=15000}={}){
 let owner='',snapshots=new Map();
 const key=(registerId,policyId)=>JSON.stringify([registerId,policyId]);
 const session=id=>{if(id!==owner){owner=id;snapshots.clear();}};
 return {
  adopt(snapshot,id){session(id);if(!snapshot||snapshot.version!==1||!Array.isArray(snapshot.rows)||!snapshot.registerId||!snapshot.pricePolicyId||!Number.isFinite(Date.parse(snapshot.asOf))||snapshot.rows.some(r=>!Array.isArray(r)||typeof r[0]!=='string'||![r[1],r[2],r[3]].every(Number.isFinite)||r[3]<0))return false;
   const k=key(snapshot.registerId,snapshot.pricePolicyId),old=snapshots.get(k);
   if(old&&old.asOf>snapshot.asOf)return false;
   const columns=['sku','name','brand','unit','imageUrl','pattern'];
   // catalogRows (metadata=2): mảng theo catalogColumns, cùng thứ tự với rows – mã hàng lấy từ rows.
   const compact=Array.isArray(snapshot.catalogRows)&&Array.isArray(snapshot.catalogColumns)&&snapshot.catalogRows.length===snapshot.rows.length?snapshot.catalogRows:null;
   const fromCompact=compact&&((i,c)=>c==='sku'?snapshot.rows[i][0]:compact[i]?.[snapshot.catalogColumns.indexOf(c)]);
   const catalogItems=compact?hydrateSnapshot({columns,policies:[],warehouses:[],products:compact.map((_,i)=>[...columns.map(c=>fromCompact(i,c)),[],[]])})
    :snapshot.catalog?hydrateSnapshot({columns,policies:[],warehouses:[],products:snapshot.catalog.map(p=>[...columns.map(c=>p[c]),[],[]])}):old?.catalogItems;
   snapshots.set(k,{...snapshot,catalogItems,at:now(),products:new Map(snapshot.rows.map(([sku,price,onHand,reserved,scanCodes])=>[sku,{sku,price,onHand,reserved,available:Math.max(0,onHand-reserved),scanCodes,stockStatus:snapshot.warehouseReady?'ready':'unopened',stockAsOf:snapshot.asOf}]))});return true;
  },
  get(sku,registerId,policyId,id){session(id);const s=snapshots.get(key(registerId,policyId)),p=s?.products.get(sku);return p?{...p,stockStale:now()-s.at>=ttl}:null;},
  search(q,registerId,policyId,id){session(id);const s=snapshots.get(key(registerId,policyId));return s?.catalogItems?(searchProducts(s.catalogItems,{q})||[]).filter(p=>s.products.has(p.sku)):null;},
  scope(registerId,policyId,id){session(id);return snapshots.get(key(registerId,policyId))||null;},
  clear(){snapshots.clear();},
 };
}
