import {readWebOrderFinancials} from './web-order-financials.ts';
import {readWebEdit} from './web-order-edit.ts';

/** Woo may stamp date_paid on a status transition. Preserve the claim, but do not turn it into a receipt. */
export function webOrderPayment(order:{total:number;financialSnapshot:string;crmEditSnapshot:string},bankPaidAt:string|null=null){
 const payment=readWebOrderFinancials(order.financialSnapshot)?.payment;
 const conflict=!!readWebEdit(order.crmEditSnapshot).sourceConflict;
 const evidence=conflict?'conflict':bankPaidAt?'bank':payment?.paidAt?'website':payment?'unpaid':'unknown';
 const paid=evidence==='bank'?order.total:evidence==='unpaid'?0:null;
 return {paid,outstanding:paid===null?null:Math.max(0,order.total-paid),
  paymentStatus:paid===null?'unknown':paid>=order.total?'paid':'debt',paymentEvidence:evidence,
  paymentReviewRequired:evidence==='website'||evidence==='conflict',
  paymentStatusLabel:evidence==='website'?'Website báo đã thanh toán · Chờ đối soát':evidence==='conflict'?'Thanh toán cần đối soát thay đổi đơn':paid===null?'Chưa rõ thanh toán':paid>=order.total?'Đã thanh toán':'Còn nợ'};
}
