import {manualPosDelivery} from './pos-delivery-method.ts';
/** Advisory carrier fee only; customer-facing shipping charges are not GHN costs. */
export function posGhnFeeHint(snapshot:string|null,activeCode:string|null):number {
 if(!snapshot||!activeCode)return 0;
 try {
  if(manualPosDelivery(snapshot))return 0;
  const ghn=JSON.parse(snapshot).ghn;
  if(String(ghn?.orderCode||'').trim().toUpperCase()!==activeCode.trim().toUpperCase())return 0;
  return Number.isSafeInteger(ghn?.fee)&&ghn.fee>=0?ghn.fee:0;
 }catch{return 0;}
}
