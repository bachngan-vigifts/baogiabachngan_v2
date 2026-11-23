import {quoteLineCost,matchQuoteRow} from '../domain/line-cost.ts';
import {salesOrderLines} from '../schema.ts';
import {salesLineCosts} from '../line-cost-schema.ts';
import { and, eq, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import type { StaffEnv } from '../../staff/api/auth-routes.ts';
import { salesOrders, salesContracts, paymentSchedules, customerPayments } from '../schema.ts';
import { debtCounts, receivable, vietnamDate } from '../domain/sales.ts';
import { returnAdjustments, netReturnInputs } from './pos-return-credit.ts';
import { printingInfo, requiresPrinting, type QuoteDoc } from '../../quotes/domain/quote-math.ts';
import { AppError } from '../../../core/errors.ts';
type Db = StaffEnv['db'] | Parameters<Parameters<StaffEnv['db']['transaction']>[0]>[0];

/** Existing receivable rules, including returns/refunds; no matching by customer name or phone. */
export async function approvalDebt(db: Db, customerId: string | null, taxCode = '', excludeId = '') {
  if (!customerId && !taxCode.trim()) return { total: 0, orders: [] };
  const rows = await db.select().from(salesOrders).where(and(
    or(customerId ? eq(salesOrders.customerId, customerId) : undefined, taxCode.trim() ? eq(salesOrders.taxCode, taxCode.trim()) : undefined),
    ne(salesOrders.id, excludeId), ne(salesOrders.status, 'cancelled'),
    or(ne(salesOrders.status, 'draft'), sql`exists(select 1 from ${salesContracts} where ${salesContracts.orderId}=${salesOrders.id} and ${salesContracts.status} in ('signed','completed'))`),
  ));
  if (!rows.length) return { total: 0, orders: [] };
  const ids = rows.map(r => r.id);
  const [contracts, schedules, payments, adjustments] = await Promise.all([
    db.select().from(salesContracts).where(inArray(salesContracts.orderId, ids)),
    db.select().from(paymentSchedules).where(inArray(paymentSchedules.orderId, ids)),
    db.select().from(customerPayments).where(and(inArray(customerPayments.orderId, ids), isNull(customerPayments.voidedAt))),
    returnAdjustments(db, ids),
  ]);
  const orders = rows.flatMap(o => {
    const contract = contracts.find(k => k.orderId === o.id);
    if (!debtCounts(o.status, contract?.status)) return [];
    const net = netReturnInputs(schedules.filter(s => s.orderId === o.id), payments.filter(p => p.orderId === o.id), adjustments.get(o.id));
    const debt = receivable(net.schedules, net.payments, vietnamDate().iso);
    return debt.overdue > 0 ? [{ id: o.id, no: contract?.contractNo || o.orderNo, overdue: debt.overdue, balance: debt.balance }] : [];
  });
  return { total: orders.reduce((sum, o) => sum + o.overdue, 0), orders };
}
export function assertApprovalDebt(debt: Awaited<ReturnType<typeof approvalDebt>>, accepted = false) {
  if (debt.total > 0 && accepted !== true) throw new AppError(409, 'Khách hàng có công nợ quá hạn. Vui lòng xem cảnh báo và xác nhận vẫn tiếp tục tạo hoặc duyệt chứng từ.', 'CUSTOMER_DEBT_OVERDUE');
}

/** Missing values never become a zero cost or an implicit customer-paid shipment. */
export function approvalCosts(doc: QuoteDoc) {
  const rows=(doc.rows||[]).filter(r=>Number(r.qty)>0);
  const printed=printingInfo(doc).enabled?rows.filter(requiresPrinting):[];
  const hasTotal=typeof doc.printing?.totalCost==='number'&&Number.isFinite(doc.printing.totalCost)&&doc.printing.totalCost>=0;
  const usesLineCosts=rows.some(r=>typeof r.printing?.unitPrice==='number'&&Number.isFinite(r.printing.unitPrice));
  const missingPrinting=(usesLineCosts||!hasTotal)&&printed.some(r=>typeof r.printing?.unitPrice!=='number'||!Number.isFinite(r.printing.unitPrice)||r.printing.unitPrice<0);
  const missingPurchase=rows.some(r=>!quoteLineCost(r,null)||(r.costPrice===0&&r.costMode!=='manual'&&r.purchaseDiscount!==100));
  const missingCommission=rows.some(r=>!r.commission?.excluded&&!Number.isFinite(r.commission?.value));
  const shipping=doc.shipping,missingShippingPayer=!shipping||!['sender','receiver'].includes(shipping.payer||'');
  const missingShippingCost=shipping?.payer==='sender'&&!(typeof shipping.cost==='number'&&Number.isFinite(shipping.cost)&&shipping.cost>0);
  return {missingPurchase,missingPrinting,missingCommission,missingShipping:missingShippingPayer||missingShippingCost,missingShippingPayer,missingShippingCost};
}
export function assertApprovalCosts(doc:QuoteDoc){
 const costs=approvalCosts(doc);
 if(costs.missingPurchase)throw new AppError(409,'Nhập giá nhập/giá vốn hợp lệ cho từng sản phẩm trước khi duyệt. Giá 0 phải được nhập tay rõ ràng.','PURCHASE_COST_REQUIRED');
 if(costs.missingPrinting)throw new AppError(409,'Nhập chi phí in/khắc cho các sản phẩm có in trước khi duyệt.','PRINTING_COST_REQUIRED');
 if(costs.missingShippingPayer)throw new AppError(409,'Chọn rõ công ty hay khách hàng chịu phí vận chuyển trước khi duyệt.','SHIPPING_PAYER_REQUIRED');
 if(costs.missingShippingCost)throw new AppError(409,'Công ty chịu vận chuyển: phải nhập tổng chi phí vận chuyển lớn hơn 0 trước khi duyệt.','SHIPPING_COST_REQUIRED');
 return costs;
}
export async function orderCostReview(db:Db,orderId:string,doc:QuoteDoc){
 const [lines,snapshots]=await Promise.all([db.select().from(salesOrderLines).where(eq(salesOrderLines.orderId,orderId)),db.select().from(salesLineCosts).where(eq(salesLineCosts.orderId,orderId))]);
 const rows=doc.rows.filter(r=>String(r.name||'').trim()&&Number(r.qty)>0);
 const purchaseCosts=lines.flatMap(line=>{
  const row=matchQuoteRow(rows,line),snapshot=snapshots.find(s=>s.orderLineId===line.id&&s.sku===line.sku);
  if(!row||!snapshot||!Number.isFinite(snapshot.unitCost)||snapshot.unitCost<0||(snapshot.unitCost===0&&snapshot.confidence!=='confirmed'))return [];
  return [{index:doc.rows.indexOf(row),unitCost:snapshot.unitCost,source:snapshot.source}];
 });
 const validationDoc={...doc,rows:doc.rows.map((row,index)=>{const known=purchaseCosts.find(c=>c.index===index);return !quoteLineCost(row,null)&&known?{...row,costPrice:known.unitCost,costMode:'manual' as const}:row;})};
 return {costs:{...approvalCosts(validationDoc),sourceMismatch:lines.some(l=>l.qty>0&&!matchQuoteRow(rows,l))},purchaseCosts,validationDoc};
}
export async function assertOrderCostSource(db:Db,orderId:string,doc:QuoteDoc|null){
 if(!doc){
  const lines=await db.select().from(salesOrderLines).where(eq(salesOrderLines.orderId,orderId));
  if(lines.some(l=>l.qty>0))throw new AppError(409,'Đơn chưa có báo giá nguồn để xác minh giá nhập, in và bên chịu vận chuyển. Manager cần bổ sung nguồn chi phí trước khi duyệt.','COST_SOURCE_REQUIRED');
  return;
 }
 const review=await orderCostReview(db,orderId,doc);
 if(review.costs.sourceMismatch)throw new AppError(409,'Dòng đơn không khớp báo giá nguồn. Đối chiếu lại mã/tên sản phẩm trước khi xác nhận chi phí.','COST_SOURCE_MISMATCH');
 assertApprovalCosts(review.validationDoc);
}
