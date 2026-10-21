import { AppError } from '../../../core/errors.ts';
type Input = Record<string, unknown>;
export interface WebOrderFinancials {
  version: 1;
  itemsSubtotal: number | null; itemsSubtotalTax: number | null;
  itemsTotal: number | null; itemsTax: number | null;
  discountTotal: number | null; discountTax: number | null;
  shippingTotal: number | null; shippingTax: number | null; totalTax: number | null;
  total: number | null;
  coupons: { code: string; discount: number | null; tax: number | null; points: boolean }[];
  fees: { name: string; total: number | null; tax: number | null; points: boolean }[];
  shipping: { title: string; methodId: string; total: number | null; tax: number | null }[];
  points: { redeemed: number | null; amount: number | null } | null;
}
const text=(v:unknown,max=300)=>typeof v==='string'?v.trim().slice(0,max):'';
const obj=(v:unknown):Input=>v&&typeof v==='object'&&!Array.isArray(v)?v as Input:{};
const pointLabel=(v:string)=>/(?:doi diem|đoi diem|redeem|points|loyalty)/i.test(v.normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[đĐ]/g,'d'));
function amount(v:unknown,signed=false):number|null {
  if(v===undefined||v===null||v==='')return null;
  if((typeof v!=='string'&&typeof v!=='number')||(typeof v==='string'&&!/^-?\d+(?:\.\d+)?$/.test(v.trim())))throw new AppError(400,'Số tiền chi tiết đơn web không hợp lệ.');
  const n=Number(v);if(!Number.isFinite(n)||Math.abs(n)>1e13||(!signed&&n<0))throw new AppError(400,'Số tiền chi tiết đơn web không hợp lệ.');return n;
}
const list=(v:unknown)=>{if(v===undefined||v===null)return [];if(!Array.isArray(v)||v.length>300)throw new AppError(400,'Chi tiết khoản giảm/phí đơn web không hợp lệ.');return v.map(obj);};
const sumKnown=(rows:Input[],key:string)=>rows.every(r=>amount(r[key])!==null)?rows.reduce((s,r)=>s+amount(r[key])!,0):null;
/** Standard Woo fields only; total is authoritative. Points never create an extra discount. */
export function webOrderFinancials(input:Input):WebOrderFinancials|null {
  if(!['discount_total','discount_tax','shipping_total','shipping_tax','total_tax','coupon_lines','fee_lines','shipping_lines','points_redemption'].some(k=>Object.hasOwn(input,k)))return null;
  const lines=list(input.line_items),hasLines=Array.isArray(input.line_items),points=obj(input.points_redemption);
  const redeemed=amount(points.points);if(redeemed!==null&&!Number.isSafeInteger(redeemed))throw new AppError(400,'Số điểm đổi không hợp lệ.');
  return {version:1,
    itemsSubtotal:hasLines?sumKnown(lines,'subtotal'):null,itemsSubtotalTax:hasLines?sumKnown(lines,'subtotal_tax'):null,
    itemsTotal:hasLines?sumKnown(lines,'total'):null,itemsTax:hasLines?sumKnown(lines,'total_tax'):null,
    discountTotal:amount(input.discount_total),discountTax:amount(input.discount_tax),shippingTotal:amount(input.shipping_total),shippingTax:amount(input.shipping_tax),totalTax:amount(input.total_tax),total:amount(input.total),
    coupons:list(input.coupon_lines).map(r=>({code:text(r.code,200),discount:amount(r.discount),tax:amount(r.discount_tax),points:pointLabel(text(r.code))})),
    fees:list(input.fee_lines).map(r=>({name:text(r.name),total:amount(r.total,true),tax:amount(r.total_tax,true),points:pointLabel(text(r.name))})),
    shipping:list(input.shipping_lines).map(r=>({title:text(r.method_title),methodId:text(r.method_id,100),total:amount(r.total),tax:amount(r.total_tax)})),
    points:Object.keys(points).length?{redeemed,amount:amount(points.amount)}:null};
}
export function readWebOrderFinancials(snapshot:string|null|undefined):WebOrderFinancials|null {
  try {const d=JSON.parse(snapshot||'{}');return d.version===1&&Array.isArray(d.coupons)&&Array.isArray(d.fees)&&Array.isArray(d.shipping)?d:null;}catch{return null;}
}
/** Text lines for invoice task descriptions; no calculations alter the order's total. */
export function webFinancialDescription(d:WebOrderFinancials|null,currency='VND'):string {
  if(!d)return '';
  const money=(n:number|null)=>n===null?'Chưa có dữ liệu':new Intl.NumberFormat('vi-VN',{maximumFractionDigits:2}).format(n)+' '+currency;
  const full=(a:number|null,tax:number|null)=>a===null?null:a+(tax??0);
  const out:string[]=[];
  for(const c of d.coupons)out.push(`${c.points?'Đổi điểm / mã':'Mã giảm giá'} ${c.code}: -${money(full(c.discount,c.tax))}`);
  if(!d.coupons.length&&d.discountTotal!==null)out.push(`Giảm giá: -${money(full(d.discountTotal,d.discountTax))}`);
  for(const f of d.fees)out.push(`${f.name||'Phí khác'}: ${money(full(f.total,f.tax))}`);
  if(d.shippingTotal!==null)out.push(`Phí vận chuyển thu khách${d.shipping.length?' ('+d.shipping.map(s=>s.title).filter(Boolean).join(', ')+')':''}: ${money(full(d.shippingTotal,d.shippingTax))}`);
  else for(const s of d.shipping)out.push(`Vận chuyển ${s.title}: ${money(full(s.total,s.tax))}`);
  if(d.points)out.push(`Điểm đã đổi: ${d.points.redeemed??'Chưa có dữ liệu'}${d.points.amount!==null?' · Giá trị quy đổi tham chiếu: '+money(d.points.amount):''} (đã nằm trong tổng nguồn, không trừ thêm)`);
  return out.join('\n');
}
