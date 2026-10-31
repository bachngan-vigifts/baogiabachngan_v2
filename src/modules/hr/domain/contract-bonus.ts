import type {PayrollParams,ParamKey} from './params.ts';
import type {ContractFact} from '../../../core/contracts/sales-payroll.ts';
export type AwardKind='star'|'liquidation';
export interface AwardPolicy{thresholds:number[];amounts:number[];liquidation:number;effectiveMonth:string;}
export const awardPolicy=(p:PayrollParams,month:string):AwardPolicy=>({thresholds:[1,2,3,4,5].map(i=>p[('contractStar'+i+'From') as ParamKey]),amounts:[1,2,3,4,5].map(i=>p[('contractStar'+i+'Amount') as ParamKey]),liquidation:p.contractLiquidationAmount,effectiveMonth:month});
export function starAward(subtotal:number,p:AwardPolicy){let stars=0;for(let i=0;i<5;i++)if(subtotal>=p.thresholds[i]!)stars=i+1;return{stars,amount:stars?Math.round(p.amounts[stars-1]!):0};}
export const vnMonth=(at:string)=>new Date(Date.parse(at)+7*3600_000).toISOString().slice(0,7);
export function awardEntitlement(f:ContractFact|undefined,kind:AwardKind,p:AwardPolicy,month:string){
 if(!f||!['signed','completed'].includes(f.status)||['draft','cancelled'].includes(f.orderStatus))return 0;
 if(kind==='star')return f.signedDate&&f.signedDate.slice(0,7)<=month?starAward(f.subtotal,p).amount:0;
 return f.liquidationValid&&f.liquidatedAt&&vnMonth(f.liquidatedAt)<=month?Math.round(p.liquidation):0;
}
export interface AwardProposal{accountId:string;contractId:string;kind:AwardKind;memberId:string;originMonth:string;policy:AwardPolicy;fact:ContractFact;stars:number;entitled:number;booked:number;amount:number;reason:string;isNew:boolean;}
