import {CUSTODY_STATUSES,type CustodyKind,type CustodyStatus} from '../../../core/contracts/product-custody.ts';
export {CUSTODY_KIND_LABEL,CUSTODY_STATUS_LABEL,CUSTODY_STATUSES,CUSTODY_KINDS} from '../../../core/contracts/product-custody.ts';
export function custodyToday(now=new Date()){return now.toLocaleDateString('sv-SE',{timeZone:'Asia/Ho_Chi_Minh'});}
export function validCustodyDate(value:string){if(!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;const date=new Date(value+'T00:00:00Z');return !Number.isNaN(date.getTime())&&date.toISOString().slice(0,10)===value;}
export function custodyDeadline(status:CustodyStatus,dueDate:string,today=custodyToday()){
 const waiting=!['returned','delivered','completed'].includes(status),end=new Date(today+'T00:00:00Z');end.setUTCDate(end.getUTCDate()+3);
 return{overdue:waiting&&dueDate<today,dueSoon:waiting&&dueDate>=today&&dueDate<=end.toISOString().slice(0,10)};
}
export function custodyNext(kind:CustodyKind,status:CustodyStatus,hasCustomer:boolean):CustodyStatus[]{
 if(kind==='warranty'){if(status==='pending')return['sent'];if(status==='sent')return['processing'];if(status==='returned')return hasCustomer?['delivered','completed']:['completed'];}
 if(kind==='sample'&&status==='returned')return['completed'];return[];
}
export function canReceiveCustody(kind:CustodyKind,status:CustodyStatus){return kind==='sample'?status==='borrowed':['sent','processing'].includes(status);}
export function validCustodyStatus(value:unknown):value is CustodyStatus{return CUSTODY_STATUSES.includes(value as CustodyStatus);}
