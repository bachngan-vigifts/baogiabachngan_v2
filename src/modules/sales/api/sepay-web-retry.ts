import {and,asc,eq,inArray,isNull,or,sql} from 'drizzle-orm';
import type {StaffEnv} from '../../staff/api/auth-routes.ts';
import {sepayTransactions as bank} from '../../integrations/schema.ts';
import {parseSepayPayment} from '../../integrations/domain/sepay-payment.ts';
import {webStoreOrders} from '../pos-schema.ts';
import {ingestPayment} from './sepay-payment-store.ts';
import {webQrReferences} from './sepay-web-store.ts';
/** Re-evaluate bank-first payments after the authoritative website webhook commits. No CRM receipt fallback. */
export async function retrySepayWebOrder(env:StaffEnv,id:string){
 const [web]=await env.db.select().from(webStoreOrders).where(and(eq(webStoreOrders.id,id),inArray(webStoreOrders.source,['lock','minhlong'])));
 if(!web)return;
 const refs=[...new Set([web.externalId].filter(x=>/^[0-9]{1,20}$/.test(x)).map(x=>(web.source==='lock'?'DH':'ML')+x))];
 if(!refs.length)return;
 const rows=await env.db.select().from(bank).where(and(inArray(bank.status,['review','unmatched']),isNull(bank.paymentId),isNull(bank.orderId),or(eq(bank.webOrderId,id),...refs.map(ref=>sql`upper(${bank.content}) like ${'%'+ref+'%'}`)))).orderBy(asc(bank.receivedAt),asc(bank.id)).limit(100);
 for(const row of rows){
  if(!webQrReferences(row.content).some(ref=>refs.includes(ref)))continue;
  let payment;try{payment=parseSepayPayment(JSON.parse(row.payload));}catch{continue;}
  await ingestPayment(env,payment,undefined,undefined,'web');
 }
}
