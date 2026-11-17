import {webOrderBucket} from './web-order-outcome.ts';
import {readWebEdit} from './web-order-edit.ts';
export const WEB_CONTACT_DELAY_MS=30*60_000;
export function webOrderAttention(o:{status:string;ghnStatus:string;ghnOrderCode:string;orderedAt:string;crmEditSnapshot:string;stockStatus?:string},now=Date.now()){
 const date=String(o.orderedAt||'').trim();
 // Woo GMT timestamps and the CRM's legacy timestamp-without-zone format represent UTC.
 const at=/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(date)?Date.parse(!/(Z|[+-]\d\d:?\d\d)$/i.test(date)?date.replace(' ','T')+'Z':date):NaN;
 const edit=readWebEdit(o.crmEditSnapshot);
 const pending=webOrderBucket(o.status,o.ghnStatus)==='pending'&&!o.ghnOrderCode.trim()&&!o.ghnStatus.trim();
 const untouched=pending&&!['issued','returned','blocked'].includes(o.stockStatus||'')&&!(Number(edit.revision)>0)&&!edit.confirmationStartedAt&&!edit.ghnAttemptedAt;
 return{eligible:untouched&&Number.isFinite(at)&&now-at>=WEB_CONTACT_DELAY_MS,ageMinutes:Number.isFinite(at)?Math.max(0,Math.floor((now-at)/60_000)):null};
}
