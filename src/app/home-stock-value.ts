import type {AnyDb} from '../core/db/client.ts';
import type {Router} from '../core/http/router.ts';
import {json} from '../core/http/router.ts';
import {AppError} from '../core/errors.ts';
import type {SessionState,StaffEnv} from '../modules/staff/api/auth-routes.ts';
import {homeStockFilters,homeStockSource,type HomeStockFilters} from './home-stock-sources.ts';
import {homeStockPrices} from './home-stock-prices.ts';

/** Four separate stock views; current retail list amount by default, optional purchase estimate. */
export async function homeStockValue(db:AnyDb,now=new Date().toISOString(),filters:HomeStockFilters=homeStockFilters()){
 return db.transaction(async transaction=>{
  const tx=transaction as unknown as AnyDb,day=new Date(Date.parse(now)+7*3600e3).toISOString().slice(0,10);
  const {rows,groups,options}=await homeStockSource(tx,filters,day);
  const {price,policy}=await homeStockPrices(tx,rows,filters,now),missingSkus=new Set<string>();
  const inventory=groups.map(w=>{
   const stock=rows.filter(s=>s.groupId===w.id),positive=stock.filter(s=>s.quantity>0);let value=0,referenceValue=0;
   const priced=new Set<string>(),missing=new Set<string>();
   for(const row of positive){const c=price(row);if(!c){missing.add(row.key);missingSkus.add(row.key);continue;}const v=c.unitCost*row.quantity;value+=v;priced.add(row.key);if(c.reference)referenceValue+=v;}
   const updatedAt=stock.reduce<string|null>((at,r)=>!at||r.updatedAt>at?r.updatedAt:at,null);
   return {...w,value:Math.round(value),referenceValue:Math.round(referenceValue),positiveSkus:new Set(positive.map(r=>r.key)).size,pricedSkus:priced.size,missingSkus:missing.size,negativeSkus:stock.filter(r=>r.quantity<0).length,updatedAt};
  });
  return {asOf:now,filters,options,pricePolicy:policy,inventory,totalValue:inventory.reduce((n,w)=>n+w.value,0),referenceValue:inventory.reduce((n,w)=>n+w.referenceValue,0),missingSkus:missingSkus.size,pricedRows:inventory.reduce((n,w)=>n+w.pricedSkus,0),negativeRows:inventory.reduce((n,w)=>n+w.negativeSkus,0),unknownWarehouses:inventory.filter(w=>!w.hasStockData).length};
 },{isolationLevel:'repeatable read',accessMode:'read only'});
}
export function registerHomeStockValue(router:Router<StaffEnv>){
 router.get('/admin/home-stock-value',async c=>{
  if((c.state.session as SessionState).member.role!=='manager')throw new AppError(403,'Chỉ Manager xem giá trị tồn kho.');
  const query=new URLSearchParams(c.url.searchParams);
  // Already-open older Home pages label the no-query response as purchase value. Keep them correct during rollout.
  // The new UI always sends priceBasis=list explicitly for its default view.
  if(!c.url.search)query.set('priceBasis','purchase');
  return json(await homeStockValue(c.env.db,new Date().toISOString(),homeStockFilters(query)));
 },'admin');
}
