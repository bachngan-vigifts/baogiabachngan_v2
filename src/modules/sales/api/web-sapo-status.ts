import {inArray} from 'drizzle-orm';
import type {AnyDb} from '../../../core/db/client.ts';
import type {StaffEnv,SessionState} from '../../staff/api/auth-routes.ts';
import {DEFAULT_SAPO_BASE} from '../../integrations/api/sapo-client.ts';
import {sapoOrderStatuses} from '../../integrations/schema.ts';
import type {webStoreOrders} from '../pos-schema.ts';
import {canSalesCreateSapo} from '../domain/order-sapo-access.ts';
import {webSapoReference,webSapoInputHash} from '../domain/web-sapo.ts';
type Row=typeof webStoreOrders.$inferSelect;
export type WebSapoStatus=typeof sapoOrderStatuses.$inferSelect;
export function webSapoMetadata(s:WebSapoStatus|undefined){try{const m=JSON.parse(s?.payloadJson||'null');return m?.kind==='web-sapo'?m:null;}catch{return null;}}
export async function webSapoStatuses(db:AnyDb,rows:Pick<Row,'source'|'externalId'>[]){const codes=rows.map(webSapoReference);return new Map((codes.length?await db.select().from(sapoOrderStatuses).where(inArray(sapoOrderStatuses.quoteNumber,codes)):[]).map(r=>[r.quoteNumber,r]));}
export function webSapoFields(env:StaffEnv,o:Row,member:SessionState['member'],status:string,s?:WebSapoStatus){
 const meta=webSapoMetadata(s),valid=meta?.webOrderId===o.id&&meta?.source===o.source&&meta?.externalId===o.externalId;
 const linked=valid&&!!s?.sapoOrderId,wasPending=valid&&['requesting','updating','unknown'].includes(s?.status||''),age=Date.now()-Date.parse(meta?.requestedAt||''),pending=!!(wasPending&&(!Number.isFinite(age)||age<(s?.status==='updating'?15:5)*60_000)),changed=!!(valid&&meta.inputHash!==webSapoInputHash(o));
 return {sapoOrderId:linked?s!.sapoOrderId:null,sapoOrderCode:linked?s!.sapoOrderCode:null,sapoOrderUrl:linked?`${(env.sapoAdminBase||DEFAULT_SAPO_BASE).replace(/\/+$/,'')}/orders/${encodeURIComponent(s!.sapoOrderId!)}`:'',
  canCreateSapo:!linked&&!pending&&!changed&&canSalesCreateSapo(member,{status}),sapoPending:pending,sapoRetry:!!(wasPending&&!pending),sapoMessage:valid?s?.message||'':'',sapoSourceChanged:changed};
}
