import {can,type PermissionMember} from '../../staff/domain/permissions.ts';
export const isCounterPurchaser=(m:PermissionMember|null|undefined)=>m?.role==='employee'&&['sales-ml','sales-lock'].includes(m.positionId??'');
export function purchaseReadLevel(m:(PermissionMember & {active:boolean})|null|undefined):'all'|'brand'|'none'{
 if(!m?.active||m.positionId==='supplier'||m.positionId==='customer')return 'none';
 if(m.role==='manager')return 'all';
 if(m.role!=='employee'||!can(m,'page.purchases'))return 'none';
 return m.positionId==='accounting'?'all':(m.positionId==='sale-admin'||isCounterPurchaser(m))?'brand':'none';
}
