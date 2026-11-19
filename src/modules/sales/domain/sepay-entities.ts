import {fold} from '../../../core/text/fold.ts';
export const SEPAY_ENTITIES=['vigifts','bach-ngan','unassigned'] as const;
export type SepayEntity=typeof SEPAY_ENTITIES[number];
const holder=(s:string)=>fold(s).replace(/[^a-z0-9]/g,'');
const aliases:Record<string,Exclude<SepayEntity,'unassigned'>>={
 vigifts:'vigifts',congtytnhhsxtmquangcaovigifts:'vigifts',congtytnhhsmtmqcvigifts:'vigifts',congtytnhhsanxuatthuongmaiquangcaovigifts:'vigifts',
 bachngan:'bach-ngan',congtytnhhsxtmbachngan:'bach-ngan',congtytnhhsanxuatthuongmaibachngan:'bach-ngan',
};
/** Company-confirmed accounts + trusted register configuration, never transaction narrative. */
export function sepayEntityMap(registers:{accountNumber:string;accountName:string}[]){
 const map=new Map<string,SepayEntity>([['159063909','vigifts'],['579268','bach-ngan']]);
 for(const r of registers){const account=r.accountNumber.replace(/\s+/g,''),entity=aliases[holder(r.accountName)];if(!account||!entity)continue;const before=map.get(account);map.set(account,before&&before!==entity?'unassigned':entity);}
 return map;
}
