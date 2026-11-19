import {fold} from '../../../core/text/fold.ts';
import {can,type PermissionMember} from '../../staff/domain/permissions.ts';
export function qrPhoneSeller(m:PermissionMember & {positionName?:string|null;position?:string|null}){
 return m.role==='employee'&&can(m,'pos.sell')&&(['sales-lock','sales-ml'].includes(m.positionId||'')||/^nvbh (lock|ml|minh long)$/.test(fold(m.positionName||m.position)));
}
export function qrStore(name:string,warehouse:string){
 const w=fold(warehouse),n=fold(name);
 if(/lock/.test(w)&&!/minh long/.test(w))return 'lock';
 if(/minh long/.test(w)&&!/lock/.test(w))return 'minhlong';
 return /lock/.test(n)?'lock':/minh long/.test(n)?'minhlong':null;
}
export type QrBank={bankCode:string;bankAccount:string;bankAccountName:string};
export function qrBank(cart:string):QrBank|null{
 try{const b=JSON.parse(cart).qrBank;if(b&&['bankCode','bankAccount','bankAccountName'].every(k=>typeof b[k]==='string')&&b.bankCode&&b.bankAccount)return b;}catch{/* old/invalid request */}return null;
}
