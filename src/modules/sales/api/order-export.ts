import { asc, inArray } from 'drizzle-orm';
import type { AnyDb } from '../../../core/db/client.ts';
import { salesOrderLines } from '../schema.ts';
import { webStoreOrders } from '../pos-schema.ts';
import { readWebOrderFinancials } from '../domain/web-order-financials.ts';

const object = (raw: string): Record<string, any> => { try { const x=JSON.parse(raw); return x && typeof x==='object' && !Array.isArray(x) ? x : {}; } catch { return {}; } };
const number = (x: unknown): number | null => x === null || x === undefined || x === '' || !Number.isFinite(Number(x)) ? null : Number(x);
const list = (raw: string): Record<string, any>[] => { try { const x=JSON.parse(raw); return Array.isArray(x) ? x.filter(r=>r && typeof r==='object') : []; } catch { return []; } };
type Order = { id: string; external?: boolean; channel?: string; posSnapshot?: string | null };

/** Enrich only the authorized, filtered export page; no per-order HTTP/SQL reads or mutations.
 * Snapshot line amounts already include discounts/vouchers. Never subtract them again.
 */
export async function orderExportDetails(db: AnyDb, orders: Order[]) {
  const crmIds=orders.filter(o=>!o.external).map(o=>o.id), webIds=orders.filter(o=>o.external).map(o=>o.id.slice(4));
  const [lines, webRows] = await Promise.all([
    crmIds.length ? db.select({orderId:salesOrderLines.orderId,lineNo:salesOrderLines.lineNo,sku:salesOrderLines.sku,name:salesOrderLines.name,unit:salesOrderLines.unit,qty:salesOrderLines.qty,unitPrice:salesOrderLines.unitPrice,taxRate:salesOrderLines.taxRate,amount:salesOrderLines.amount})
      .from(salesOrderLines).where(inArray(salesOrderLines.orderId,crmIds)).orderBy(asc(salesOrderLines.orderId),asc(salesOrderLines.lineNo)) : [],
    webIds.length ? db.select({id:webStoreOrders.id,lines:webStoreOrders.lines,financialSnapshot:webStoreOrders.financialSnapshot,currency:webStoreOrders.currency})
      .from(webStoreOrders).where(inArray(webStoreOrders.id,webIds)) : [],
  ]);
  const byOrder=new Map<string,typeof lines>();
  for(const l of lines){const group=byOrder.get(l.orderId)??[];group.push(l);byOrder.set(l.orderId,group);}
  const byWeb=new Map(webRows.map(o=>['web:'+o.id,o]));
  return new Map(orders.map(o=>{
    const web=byWeb.get(o.id),snapshot=object(o.posSnapshot||'{}');
    const items=web ? list(web.lines).map(l=>{
      const qty=number(l.quantity),subtotal=number(l.total),tax=number(l.totalTax);
      const total=subtotal!==null&&tax!==null?subtotal+tax:null;
      return {sku:String(l.sku||''),name:String(l.name||''),unit:String(l.unit||''),qty,
        unitPriceAfterDiscount:qty&&subtotal!==null?subtotal/qty:null,
        unitPriceAfterDiscountVat:qty&&total!==null?total/qty:null,subtotal,tax,total,
        note:tax===null?'Chưa có VAT chi tiết từ website':''};
    }) : (byOrder.get(o.id)||[]).map(l=>{
      const saved=Array.isArray(snapshot.lines)?snapshot.lines[Number(l.lineNo)-1]:null;
      // POS rounds VAT per line; use its saved tax only when the snapshot still matches the current line.
      const exact=saved&&saved.sku===l.sku&&number(saved.qty)===l.qty&&number(saved.subtotal)===l.amount&&number(saved.taxRate)===l.taxRate;
      const tax=o.channel==='pos' ? exact?number(saved.tax):null : l.amount*l.taxRate/100;
      const total=tax===null?null:l.amount+tax;
      return {sku:l.sku,name:l.name,unit:l.unit,qty:l.qty,unitPriceAfterDiscount:l.unitPrice,
        unitPriceAfterDiscountVat:total===null?null:total/l.qty,subtotal:l.amount,tax,total,
        note:tax===null?'Chưa có bản chụp VAT dòng POS':''};
    });
    const financials=web?readWebOrderFinancials(web.financialSnapshot):null;
    const shippingBeforeTax=number(financials?.shippingTotal),shippingTax=number(financials?.shippingTax);
    const shippingFee=web ? shippingBeforeTax!==null&&shippingTax!==null?shippingBeforeTax+shippingTax:null
      : number(snapshot.fees?.shippingFee);
    const note=[!items.length?'Chưa có chi tiết sản phẩm':'',shippingFee===null?'Chưa có phí vận chuyển thu khách; không dùng cước hãng vận chuyển thay thế':''].filter(Boolean).join(' · ');
    return [o.id,{items,shippingFee,currency:web?.currency||'VND',note}] as const;
  }));
}
