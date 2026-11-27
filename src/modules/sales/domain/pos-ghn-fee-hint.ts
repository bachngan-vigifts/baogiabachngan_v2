import {manualPosDelivery} from './pos-delivery-method.ts';
/** Advisory carrier fee only; customer-facing shipping charges are not GHN costs. */
export function posGhnFeeHint(snapshot:string|null,activeCode:string|null,deliveryFee=0):number {
 if(!activeCode||manualPosDelivery(snapshot))return 0;
 // Keep the fee recorded on this active delivery; POS customer shipping is in snapshot.fees.
 if(Number.isSafeInteger(deliveryFee)&&deliveryFee>0)return deliveryFee;
 if(!snapshot)return 0;
 try {
  if(manualPosDelivery(snapshot))return 0;
  const ghn=JSON.parse(snapshot).ghn;
  if(String(ghn?.orderCode||'').trim().toUpperCase()!==activeCode.trim().toUpperCase())return 0;
  return Number.isSafeInteger(ghn?.fee)&&ghn.fee>=0?ghn.fee:0;
 }catch{return 0;}
}
