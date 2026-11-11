import {GHN_FAILED,GHN_WAITING} from './ghn-status.ts';
const normalize=(value:string)=>value.trim().toLowerCase().replace(/^wc-/,'');
/** Woo's custom Lock shipping statuses still describe delivery, even before COD settlement. */
export function webOrderBucket(status:string,ghnStatus=''){
 const s=normalize(status),g=normalize(ghnStatus);
 if(['refunded','trash'].includes(s))return 'cancelled';
 if(g==='delivered')return 'completed';
 if(GHN_FAILED.has(g))return 'cancelled';
 if(GHN_WAITING.has(g))return 'waiting_delivery';
 if(['cancelled','failed','lnl-returning','lnl-returned'].includes(s))return 'cancelled';
 if(['completed','lnl-delivered'].includes(s))return 'completed';
 if(['shipped','out-for-delivery','delivery','delivering','lnl-awaiting-pickup','lnl-pickup','lnl-awaiting-del','lnl-delivery-failed','lnl-del-failed'].includes(s))return 'waiting_delivery';
 if(['packing','packed'].includes(s))return 'packing';
 return 'pending';
}

/** Payment approval is stricter than the shipping projection: a delivered carrier scan cannot override Woo cancellation. */
export const WEB_PAYMENT_BLOCKED_STATUSES = ['cancelled','failed','refunded','trash','lnl-returning','lnl-returned'] as const;
export function webOrderPaymentBlocked(status:string,ghnStatus=''){
 return WEB_PAYMENT_BLOCKED_STATUSES.some(s=>s===normalize(status))||webOrderBucket(status,ghnStatus)==='cancelled';
}
