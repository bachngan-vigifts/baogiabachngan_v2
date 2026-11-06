import {sha256Hex} from '../../staff/domain/session.ts';
import {readWebOrderFinancials} from './web-order-financials.ts';
import {readWebEdit} from './web-order-edit.ts';
import type {webStoreOrders} from '../pos-schema.ts';
type WebOrder=typeof webStoreOrders.$inferSelect;
export const webSapoReference=(o:Pick<WebOrder,'source'|'externalId'>)=>`WEB_${o.source==='lock'?'LOCK':'ML'}_${/^\d{1,30}$/.test(o.externalId)?o.externalId:sha256Hex(o.source+':'+o.externalId).slice(0,16)}`;
export function webSapoInputHash(o:WebOrder){const f=readWebOrderFinancials(o.financialSnapshot);const {payment:_payment,...financials}=f??{};return sha256Hex(JSON.stringify([o.registerId,o.lines,o.total,o.currency,financials,o.customerName,o.phone,o.email,o.address]));}
const money=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=1e13;
const rate=(net:number,tax:number)=>[0,5,8,10].find(r=>Math.abs(net*r/100-tax)<=1)??null;
/** Woo item totals already include coupons/points. Never apply those discounts again. */
export function webSapoPayload(o:WebOrder,branch:{id:string;name:string;warehouseId:string;warehouseName:string},actor:{name:string;phone:string;email?:string;sapoId?:string|null}){
 const problems:string[]=[],financials=readWebOrderFinancials(o.financialSnapshot),code=webSapoReference(o);let rows:any[]=[];
 try{const raw=JSON.parse(o.lines);if(Array.isArray(raw)){if(raw.some(r=>!r||typeof r!=='object'||Array.isArray(r)))problems.push('Chi tiết sản phẩm website không hợp lệ.');rows=raw.filter(r=>r&&typeof r==='object'&&!Array.isArray(r));}}catch{}
 if(o.currency!=='VND')problems.push('Chỉ tạo Sapo cho đơn tiền VND.');
 if(readWebEdit(o.crmEditSnapshot).sourceConflict)problems.push('Website và CRM đang khác dữ liệu. Đối soát sản phẩm/giá trước khi tạo Sapo.');
 if(!rows.length||rows.length>300)problems.push('Đơn phải có từ 1 đến 300 dòng sản phẩm.');
 const items=rows.map((r,i)=>{
  const tax=rate(Number(r.total),Number(r.totalTax));
  if(!r.sku||typeof r.sku!=='string')problems.push(`Dòng ${i+1} chưa có SKU.`);
  if(!money(r.total)||!money(r.totalTax)||!Number.isFinite(r.quantity)||r.quantity<=0||tax===null)problems.push(`Dòng ${i+1} thiếu số lượng/giá/thuế nguồn hợp lệ. Đồng bộ lại chi tiết website.`);
  return {line:i+1,sku:String(r.sku||''),name:String(r.name||''),unit:'',quantity:Number(r.quantity),unit_price:Number(r.total)/Number(r.quantity),discount_type:'amount',discount_amount:0,price_after_discount:Number(r.total)/Number(r.quantity),line_total:Number(r.total),tax_percent:tax??0};
 });
 if(!financials||!money(financials.shippingTotal)||!money(financials.shippingTax)||!money(financials.totalTax)||!money(financials.total))problems.push('Thiếu tổng tiền, thuế hoặc phí vận chuyển nguồn. Đồng bộ lại chi tiết website trước khi tạo Sapo.');
 const fees=financials?.fees??[],shipping=Number(financials?.shippingTotal||0),shippingTax=Number(financials?.shippingTax||0);
 if(fees.some(f=>!money(f.total)||!money(f.tax)||rate(Number(f.total),Number(f.tax))===null)||rate(shipping,shippingTax)===null)problems.push('Phí/thuế website chưa đủ căn cứ hoặc có phí âm; cần đối soát trước khi tạo Sapo.');
 const goods=rows.reduce((s,r)=>s+Number(r.total||0),0),goodsTax=rows.reduce((s,r)=>s+Number(r.totalTax||0),0),service=fees.reduce((s,f)=>s+Number(f.total||0),0),serviceTax=fees.reduce((s,f)=>s+Number(f.tax||0),0),net=goods+shipping+service,tax=goodsTax+shippingTax+serviceTax;
 if(!money(o.total)||Math.abs(net+tax-o.total)>1||financials&&Math.abs(Number(financials.total)-o.total)>1||financials&&Math.abs(Number(financials.totalTax)-tax)>1)problems.push('Chi tiết sản phẩm, thuế và phí chưa khớp tổng đơn website. Không tự suy đoán phần chênh lệch.');
 if(new Set(fees.map(f=>rate(Number(f.total),Number(f.tax)))).size>1)problems.push('Phí website có nhiều mức VAT; cần đối soát trước khi tạo Sapo.');
 const payload={event:'crm_pos_create_sapo_order',trigger_source:'pos',origin:'web',idempotency_key:`pos:${code}`,quote_number:code,external_reference:code,quote_no:'',order_no:code,contract_no:'',quote_type:'HRC',
  quote_date:o.orderedAt.slice(0,10),fulfillment_mode:'delivery',web_source:o.source,source_order_no:o.orderNo,web_order_id:o.id,branch:{register_id:branch.id,name:branch.name,warehouse_id:branch.warehouseId,warehouse_name:branch.warehouseName},responsible:actor.name,responsible_phone:actor.phone,responsible_email:actor.email||'',responsible_sapo_id:/^\d+$/.test(actor.sapoId||'')?Number(actor.sapoId):null,
  customer:{local_id:null,sapo_id:null,customer_code:'',name:o.customerName,tax_code:'',contact:o.customerName,phone:o.phone,email:o.email,address:o.address},items,
  ...((service+serviceTax+shipping+shippingTax)>0?{additional_fees:{service:{kind:'other_service',name:'Phí dịch vụ website',quantity:1,unit_price:service+serviceTax,amount:service+serviceTax,subtotal:service,tax_amount:serviceTax,tax_percent:rate(service,serviceTax)??0,lines:fees.map(f=>({name:f.name,quantity:1,unit_price:Number(f.total)+Number(f.tax),amount:Number(f.total)+Number(f.tax),subtotal:f.total,tax_amount:f.tax,tax_percent:rate(Number(f.total),Number(f.tax))??0}))},shipping:{amount:shipping+shippingTax,subtotal:shipping,tax_amount:shippingTax,tax_percent:rate(shipping,shippingTax)??0}}}:{}),
  subtotal:net,vat_amount:tax,total:o.total,notes:`Đơn website ${o.source} #${o.orderNo}. Giá sản phẩm đã trừ ưu đãi website; không trừ lại coupon/điểm.`};
 return {code,payload,problems:[...new Set(problems)],inputHash:webSapoInputHash(o)};
}
