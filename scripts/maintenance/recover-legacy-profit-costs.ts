/** Offline plan only. Export legacy-profit-input.sql with the approved DB connector, review the summary,
 * then execute the generated guarded transaction with that connector. Never reads credentials or connects to production. */
import {readFileSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {defaultCostDiscount,normalize,netPrice,type QuoteRow} from '../../src/modules/quotes/domain/quote-math.ts';
import {matchQuoteRow,type LineCostConfidence,type LineCostSource} from '../../src/modules/sales/domain/line-cost.ts';
import {purchaseUnitCost} from '../../src/modules/suppliers/domain/order-totals.ts';

type Purchase={sku:string;unit?:string;ref:string;at:string;price:number|null;discount:number|null;printFee:number|null};
type Movement=Purchase & {id:string;storedPrice:number|null;note:string;receiptId:string|null;cancelled:boolean;approved:boolean;item?:{sku:string;unit_price:number|null;purchase_discount_percent:number|null;print_fee?:number}|null};
type Product={sku:string;unit?:string;name:string;brand:string;pattern:string;taxable:boolean;taxOut:number|null;taxBasis:string;at:string;prices:{id:string;name:string;price:number|null}[]|null};
type SaleLine={id:string;orderId:string;sku:string;unit?:string;name:string;lineNo:number;qty:number;amount:number;day:string;createdAt:string;quoteRef:string|null;quoteAt:string|null;quoteRows:QuoteRow[]|null};
export interface RecoveryInput {lines:SaleLine[];movements:Movement[];purchaseOrders:Purchase[];products:Product[]}
type Point={sku:string;unit?:string;ref:string;at:string;cost:number;kind:'receipt'|'order'};
export type RecoveredCost={line:SaleLine;unitCost:number;source:LineCostSource;confidence:LineCostConfidence;costAt:string|null;note:string};
const valid=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=1e12;
const date=(v:string)=>Date.parse(v);
const marker='[net-cost-v1]';
const sameUnit=(a?:string,b?:string)=>!a?.trim()||!b?.trim()||normalize(a)===normalize(b);
function cost(p:Purchase){
 if(!valid(p.price)||p.discount!==null&&(!valid(p.discount)||p.discount>100)||p.printFee!==null&&!valid(p.printFee))return null;
 return purchaseUnitCost({price:p.price,purchaseDiscount:p.discount,confirmedPurchaseDiscount:null,printFee:p.printFee??0,taxRate:0});
}
function nearest(points:Point[],day:string){
 const end=date(day+'T23:59:59.999+07:00');if(!Number.isFinite(end))return {point:null,ambiguous:false};
 const before=points.filter(p=>date(p.at)<=end).sort((a,b)=>date(b.at)-date(a.at)||a.ref.localeCompare(b.ref));
 const after=points.filter(p=>date(p.at)>end).sort((a,b)=>date(a.at)-date(b.at)||a.ref.localeCompare(b.ref));
 const list=before.length?before:after,first=list[0];
 if(!first)return {point:null,ambiguous:false};
 return {point:first,ambiguous:list.some(p=>date(p.at)===date(first.at)&&Math.abs(p.cost-first.cost)>0.005)};
}
export function recoveryPlan(input:RecoveryInput){
 const points:Point[]=[],repairs:{id:string;previous:number;price:number;ref:string}[]=[],costs:RecoveredCost[]=[],unresolved:{id:string;reason:string}[]=[];
 for(const m of input.movements){
  if(m.cancelled||!Number.isFinite(date(m.at)))continue;
  let value:number|null=null;
  if(!m.ref.startsWith('receipt:')||m.note.includes(marker))value=valid(m.storedPrice)?m.storedPrice:null;
  else if(m.receiptId&&m.approved){
   // Prefer the immutable receipt-time outbox. Older CRM-only receipts retain approved, frozen purchase lines.
   if(m.item){
    if(m.item.sku!==m.sku)continue;
    // Older outboxes omitted printing. Do not reconstruct a nonzero printing fee from a later live row.
    if(m.item.print_fee===undefined&&(m.printFee??0)!==0)continue;
    value=cost({...m,price:m.item.unit_price,discount:m.item.purchase_discount_percent,printFee:m.item.print_fee??0});
   }else value=cost(m);
   if(value!==null&&valid(m.storedPrice))repairs.push({id:m.id,previous:m.storedPrice,price:value,ref:m.ref});
  }
  if(value!==null&&valid(value))points.push({sku:m.sku,unit:m.unit,ref:m.ref,at:m.at,cost:value,kind:'receipt'});
 }
 for(const p of input.purchaseOrders){const value=cost(p);if(value!==null&&valid(value)&&Number.isFinite(date(p.at)))points.push({sku:p.sku,unit:p.unit,ref:p.ref,at:p.at,cost:value,kind:'order'});}
 const products=new Map(input.products.map(p=>[p.sku,p]));
 for(const l of input.lines){
  const base=points.filter(p=>p.sku===l.sku&&!!l.sku&&sameUnit(p.unit,l.unit)),end=date(l.day+'T23:59:59.999+07:00');
  if(!Number.isFinite(end)||!valid(l.qty)||l.qty<=0||!valid(l.amount)){unresolved.push({id:l.id,reason:'Ngày bán / số lượng / tiền dòng không hợp lệ'});continue;}
  // Received purchases before sale, then approved purchases before sale; after-sale sources stay explicitly backfill.
  const groups=[base.filter(p=>p.kind==='receipt'&&date(p.at)<=end),base.filter(p=>p.kind==='order'&&date(p.at)<=end),
    base.filter(p=>p.kind==='receipt'&&date(p.at)>end),base.filter(p=>p.kind==='order'&&date(p.at)>end)];
  let found:Point|null=null,ambiguous=false;
  for(const group of groups){const n=nearest(group,l.day);if(n.ambiguous){ambiguous=true;break;}if(n.point){found=n.point;break;}}
  if(ambiguous){unresolved.push({id:l.id,reason:'Nhiều giá mua khác nhau cùng thời điểm; cần đối soát'});continue;}
  if(found){const later=date(found.at)>end;
   costs.push({line:l,unitCost:found.cost,source:found.kind==='order'?'purchase_order':later?'purchase_later':'purchase',confidence:later?'backfill':'estimate',costAt:found.at,
    note:`Khôi phục giá tham chiếu: ${found.ref}; giá mua sau chiết khấu, trước VAT${later?'; nguồn sau ngày bán':''}. Không phải giá vốn xuất kho đã đối soát.`});continue;}
  const rows=(l.quoteRows??[]).filter(r=>String(r.name??'').trim()&&Number(r.qty)>0),q=matchQuoteRow(rows,l);
  if(q&&valid(q.costPrice)&&(q.costPrice>0||q.costMode==='manual'||q.purchaseDiscount===100)){
   costs.push({line:l,unitCost:q.costPrice,source:'quote',confidence:'estimate',costAt:l.quoteAt,
    note:`Khôi phục từ phiên bản báo giá có hiệu lực khi lập đơn: ${l.quoteRef}. Giá tham chiếu, chưa đối soát giá vốn xuất kho.`});continue;
  }
  const p=products.get(l.sku),discount=p?defaultCostDiscount(p):null;
  // Use an explicitly named retail policy, not the first arbitrary wholesale/customer policy.
  const retail=p?.prices?.filter(x=>['gia ban le','gia le','gia ban le vat','gia le vat'].includes(normalize(x.name).replace(/\+/g,' ').replace(/\s+/g,' ').trim())&&valid(x.price)&&x.price>0)
   .sort((a,b)=>Number(/vat/i.test(a.name))-Number(/vat/i.test(b.name))||a.id.localeCompare(b.id))[0];
  if(p&&retail&&discount!==null&&valid(retail.price)&&sameUnit(p.unit,l.unit)){
   const included=/vat/i.test(retail.name)||p.taxBasis==='Giá đã bao gồm thuế';
   if(included&&p.taxable&&(!valid(p.taxOut)||p.taxOut>100)){unresolved.push({id:l.id,reason:'Chưa rõ VAT của giá tham chiếu'});continue;}
   // Match purchases.js prefillCosts exactly: round the VAT-exclusive list price first,
   // then apply supplier totals without rounding the unit discount result a second time.
   const listPrice=Math.round(netPrice(retail.price,p.taxable?(p.taxOut??0):0,included));
   const value=purchaseUnitCost({price:listPrice,purchaseDiscount:discount,confirmedPurchaseDiscount:null,printFee:0,taxRate:0})!;
   costs.push({line:l,unitCost:value,source:'catalog_rule',confidence:'estimate',costAt:p.at,
    note:`Khôi phục theo công thức gợi ý đơn mua NCC: ${retail.name} (${retail.id}), CK ${discount}%, trước VAT; bảng giá tham chiếu tại ${p.at}. Chưa phải giá mua lịch sử hay giá vốn xuất kho đã đối soát.`});continue;
  }
  unresolved.push({id:l.id,reason:'Chưa có giá mua / báo giá gốc / công thức thương hiệu phù hợp'});
 }
 return {costs,repairs,unresolved};
}
const lit=(s:string)=>"'"+s.replace(/'/g,"''")+"'";
export const recoveryInputSql=readFileSync(new URL('./legacy-profit-input.sql',import.meta.url),'utf8').trim().replace(/;$/,'');
export function recoverySql(plan:ReturnType<typeof recoveryPlan>,fingerprint:string){
 if(!/^[a-f0-9]{32}$/.test(fingerprint))throw Error('Invalid input fingerprint');
 const values=plan.costs.map(c=>`(${lit(c.line.id)},${lit(c.line.orderId)},${lit(c.line.sku)},${c.unitCost},${lit(c.source)},${lit(c.confidence)},${c.costAt?lit(c.costAt):'NULL'},${lit(c.note)})`).join(',\n');
 const repairs=plan.repairs.map(r=>`(${lit(r.id)},${r.previous},${r.price},${lit(r.ref)})`).join(',\n');
 return `BEGIN ISOLATION LEVEL REPEATABLE READ;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
CREATE TEMP TABLE recovery_cost_plan(line_id text,order_id text,sku text,unit_cost double precision,source text,confidence text,cost_at text,note text) ON COMMIT DROP;
${values?'INSERT INTO recovery_cost_plan VALUES '+values+';':''}
CREATE TEMP TABLE recovery_move_plan(id text,previous double precision,price double precision,ref text) ON COMMIT DROP;
${repairs?'INSERT INTO recovery_move_plan VALUES '+repairs+';':''}
DO $guard$ BEGIN
 IF (SELECT fingerprint FROM (${recoveryInputSql}) current_input)<>${lit(fingerprint)}
 AND (EXISTS(SELECT 1 FROM recovery_cost_plan p LEFT JOIN sales_line_costs c ON c.order_line_id=p.line_id WHERE c.order_line_id IS NULL)
 OR EXISTS(SELECT 1 FROM recovery_move_plan p JOIN product_movements m ON m.id=p.id WHERE position('[net-cost-v1]' in m.note)=0))
 THEN RAISE EXCEPTION 'Recovery input changed; regenerate the plan before applying'; END IF;
END $guard$;
WITH changed AS (
 UPDATE product_movements m SET unit_price=p.price,note=concat_ws(' · ',nullif(m.note,''),'[net-cost-v1] Khôi phục giá mua sau CK, trước VAT; trước='||p.previous||'; nguồn='||p.ref)
 FROM recovery_move_plan p WHERE m.id=p.id AND m.unit_price=p.previous AND position('[net-cost-v1]' in m.note)=0 RETURNING m.id
) SELECT count(*) AS repaired_purchase_movements FROM changed;
WITH written AS (
 INSERT INTO sales_line_costs(order_line_id,order_id,sku,unit_cost,source,confidence,cost_at,captured_at,captured_by,revision,note)
 SELECT p.line_id,p.order_id,p.sku,p.unit_cost,p.source,p.confidence,p.cost_at,
 to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),NULL,1,p.note
 FROM recovery_cost_plan p JOIN sales_order_lines l ON l.id=p.line_id AND l.order_id=p.order_id AND l.sku=p.sku
 JOIN sales_orders o ON o.id=l.order_id AND o.status<>'cancelled'
 ON CONFLICT(order_line_id) DO NOTHING RETURNING *
),logged AS (
 INSERT INTO sales_line_cost_history(id,order_line_id,order_id,sku,unit_cost,previous_unit_cost,source,confidence,reason,note,actor_id,at)
 SELECT gen_random_uuid()::text,order_line_id,order_id,sku,unit_cost,NULL,source,confidence,'recover',note,NULL,captured_at FROM written RETURNING id
) SELECT count(*) AS recovered_line_costs FROM logged;
COMMIT;`;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [file,output]=process.argv.slice(2);if(!file||!output)throw Error('Usage: recover-legacy-profit-costs.ts input.json output.sql');
 const {payload,fingerprint}=JSON.parse(readFileSync(file,'utf8')) as {payload:RecoveryInput;fingerprint:string};
 const plan=recoveryPlan(payload);writeFileSync(output,recoverySql(plan,fingerprint));
 const counts:Record<string,number>={};for(const c of plan.costs)counts[c.source]=(counts[c.source]??0)+1;
 console.log(JSON.stringify({eligible:payload.lines.length,recoverable:plan.costs.length,unresolved:plan.unresolved.length,repairMovements:plan.repairs.length,bySource:counts}));
}
