import {MAX_STOCKTAKE_LINES} from '../../../core/contracts/stocktake.ts';
export type DraftLine={sku:string;expectedQty:number;countedQty:number|null;source:'stocktake'|'stocktake-draft';qty:number};
export const rounded=(n:number)=>Math.round(n*1000)/1000;
export function draftLines(raw:unknown):DraftLine[]{
 if(!Array.isArray(raw)||raw.length>MAX_STOCKTAKE_LINES)throw Error(`Mỗi phiếu tối đa ${MAX_STOCKTAKE_LINES} mã.`);
 const seen=new Set<string>();
 return raw.map(r=>{
  const sku=typeof r?.sku==='string'?r.sku.trim():'',expectedQty=r?.expectedQty,countedQty=r?.countedQty;
  if(!sku||sku.length>200||seen.has(sku))throw Error('Mã hàng không hợp lệ hoặc bị trùng.');
  if(typeof expectedQty!=='number'||!Number.isFinite(expectedQty)||Math.abs(expectedQty)>1e9)throw Error('Chờ lấy đủ tồn kho của từng mã trước khi lưu.');
  if(countedQty!==null&&(typeof countedQty!=='number'||!Number.isFinite(countedQty)||countedQty<0||countedQty>1e9||Math.abs(countedQty*1000-Math.round(countedQty*1000))>0.0001))throw Error('Số thực tế phải là số không âm, tối đa 3 số lẻ; để trống nếu chưa kiểm.');
  seen.add(sku);return {sku,expectedQty,countedQty,source:'stocktake-draft' as const,qty:countedQty===null?0:rounded(countedQty-expectedQty)};
 });
}
export function stocktakeTotals(lines:readonly {sku:string;expectedQty:number;countedQty:number|null}[],costs?:Record<string,number>){
 let actual=0,increase=0,decrease=0,valueActual=0,valueDelta=0,valueIncrease=0,valueDecrease=0,missingCost=0;
 for(const l of lines){if(l.countedQty===null)continue;actual+=l.countedQty;const delta=rounded(l.countedQty-l.expectedQty);if(delta>0)increase+=delta;else decrease-=delta;
  if(costs){const cost=costs[l.sku];if(cost===undefined){missingCost++;continue;}valueActual+=l.countedQty*cost;valueDelta+=delta*cost;if(delta>0)valueIncrease+=delta*cost;else valueDecrease-=delta*cost;}}
 return {actual:rounded(actual),increase:rounded(increase),decrease:rounded(decrease),delta:rounded(increase-decrease),...(costs?{valueActual:Math.round(valueActual),valueDelta:Math.round(valueDelta),valueIncrease:Math.round(valueIncrease),valueDecrease:Math.round(valueDecrease),missingCost}:{})};
}
export function mergeCountedLines(groups:DraftLine[][],balances:Record<string,number>):DraftLine[]{
 const merged=new Map<string,DraftLine>();
 for(const lines of groups)for(const l of lines){const old=merged.get(l.sku);if(old&&(old.countedQty===null||l.countedQty===null))throw Error(`Mã ${l.sku} chưa được kiểm đủ ở các phiếu cần gộp.`);const countedQty=old?rounded(old.countedQty!+l.countedQty!):l.countedQty;merged.set(l.sku,{sku:l.sku,expectedQty:balances[l.sku]??0,countedQty,source:'stocktake-draft',qty:countedQty===null?0:rounded(countedQty-(balances[l.sku]??0))});}
 return draftLines([...merged.values()]);
}
