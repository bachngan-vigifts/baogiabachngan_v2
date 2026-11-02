import {AppError} from '../../../core/errors.ts';
import {allocatePosVoucher,posLine,posMoney} from './pos-money.ts';
import {readWebOrderFinancials,type WebOrderFinancials} from './web-order-financials.ts';
export function readWebEdit(raw:string|null|undefined):Record<string,any>{try{const d=JSON.parse(raw||'{}');return d&&typeof d==='object'&&!Array.isArray(d)?d:{};}catch{return {};}}
export function webEditorModel(order:{lines:string;financialSnapshot:string;crmEditSnapshot:string}){
 const edit=readWebEdit(order.crmEditSnapshot);if(edit.cart)return edit.cart;
 let rows:any[]=[];try{const d=JSON.parse(order.lines);if(Array.isArray(d))rows=d;}catch{/* legacy */}
 const fin=readWebOrderFinancials(order.financialSnapshot);
 const fees=(fin?.fees||[]).reduce((s,f)=>s+Number(f.total||0)+Number(f.tax||0),0);
 return {lines:rows.map(l=>{
  const qty=Number(l.quantity)||1,base=Number(l.subtotal??l.total)||0,baseTax=Number(l.subtotalTax??l.totalTax)||0,total=Number(l.total)||0,tax=Number(l.totalTax)||0;
  const price=Math.round((base+baseTax)/qty),rate=total>0&&l.totalTax!=null?Math.round(tax/total*10000)/100:0;
  return {sku:String(l.sku||''),name:String(l.name||''),unit:String(l.unit||''),qty,unitPrice:price,taxRate:rate,discountType:'amount',discountValue:Math.max(0,Math.round(price*qty-total-tax)),pricingIncomplete:l.totalTax==null};
 }),orderDiscount:Math.max(0,-Math.round(fees)),shippingFee:Math.round((fin?.shippingTotal||0)+(fin?.shippingTax||0)),feeAmount:Math.max(0,Math.round(fees)),shippingTaxRate:fin?.shippingTotal?Math.round((fin.shippingTax||0)/fin.shippingTotal*10000)/100:0,feeTaxRate:0};
}
export function calculateWebCart(b:Record<string,any>){
 if(!Array.isArray(b.lines)||!b.lines.length||b.lines.length>300)throw new AppError(400,'Đơn phải có từ 1 đến 300 dòng sản phẩm.');
 const seen=new Set<string>();
 const inputs=b.lines.map((l:any)=>{
  if(!l||typeof l!=='object'||typeof l.sku!=='string'||!l.sku.trim()||l.sku.length>100)throw new AppError(400,'Chọn mã hàng hợp lệ.');
  const sku=l.sku.trim();if(seen.has(sku))throw new AppError(400,'Mã hàng bị lặp: '+sku);seen.add(sku);
  const rate=Number(l.taxRate);if(!Number.isFinite(rate)||rate<0||rate>100)throw new AppError(400,'Thuế suất không hợp lệ.');
  return {sku,price:posMoney(l.unitPrice,'Đơn giá đã gồm VAT'),qty:l.qty,discountType:l.discountType,discountValue:l.discountValue,taxRate:rate,priceIncludesVat:true,vatEnabled:true};
 });
 const bases=inputs.map(l=>posLine(l)),discount=posMoney(b.orderDiscount??0,'Giảm giá thêm cả đơn');
 const allocated=allocatePosVoucher(bases.map(l=>l.total),discount?{code:'',type:'amount',value:discount}:null);
 const lines=inputs.map((l,i)=>({...l,...posLine({...l,voucherAmount:allocated.shares[i]||0})}));
 const shippingFee=posMoney(b.shippingFee??0,'Phí vận chuyển thu khách'),feeAmount=posMoney(b.feeAmount??0,'Phí khác thu khách');
 const feeRate=(v:unknown)=>{const n=Number(v??0);if(!Number.isFinite(n)||n<0||n>100)throw new AppError(400,'Thuế phí không hợp lệ.');return n;};
 const shippingTaxRate=feeRate(b.shippingTaxRate),feeTaxRate=feeRate(b.feeTaxRate);
 const ship=posLine({price:shippingFee,qty:1,taxRate:shippingTaxRate,priceIncludesVat:true,vatEnabled:true}),fee=posLine({price:feeAmount,qty:1,taxRate:feeTaxRate,priceIncludesVat:true,vatEnabled:true});
 const total=posMoney(lines.reduce((s,l)=>s+l.total,0)+shippingFee+feeAmount);
 const tax=lines.reduce((s,l)=>s+l.tax,0)+ship.tax+fee.tax;
 const financials:WebOrderFinancials&{origin:'crm'}={version:1,origin:'crm',itemsSubtotal:0,itemsSubtotalTax:0,itemsTotal:lines.reduce((s,l)=>s+l.subtotal,0),itemsTax:lines.reduce((s,l)=>s+l.tax,0),
  discountTotal:0,discountTax:0,shippingTotal:ship.subtotal,shippingTax:ship.tax,totalTax:tax,total,coupons:[],fees:feeAmount?[{name:'Phí khác',total:fee.subtotal,tax:fee.tax,points:false}]:[],shipping:[],points:null};
 for(const l of lines){const before=posLine({...l,price:l.price,discountType:'amount',discountValue:0,voucherAmount:0});financials.itemsSubtotal!+=before.subtotal;financials.itemsSubtotalTax!+=before.tax;financials.discountTotal!+=before.subtotal-l.subtotal;financials.discountTax!+=before.tax-l.tax;}
 return {lines,total,financials,cart:{lines:inputs.map(l=>({sku:l.sku,qty:Number(l.qty),unitPrice:l.price,taxRate:l.taxRate,discountType:l.discountType??'percent',discountValue:Number(l.discountValue??0)})),orderDiscount:discount,shippingFee,feeAmount,shippingTaxRate,feeTaxRate}};
}
