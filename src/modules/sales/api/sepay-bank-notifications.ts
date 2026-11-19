import {inArray} from 'drizzle-orm';
import {boundedMap} from '../../../core/async/bounded-map.ts';
import type {StaffEnv} from '../../staff/api/auth-routes.ts';
import {sepayTransactions} from '../../integrations/schema.ts';
import {notificationScope} from '../../notifications/api/recipient-scope.ts';
import {notifyMany} from '../../notifications/api/routes.ts';
import {posRegisters} from '../pos-schema.ts';
import {sepayEntityMap} from '../domain/sepay-entities.ts';
import {vietnamDate} from '../domain/sales.ts';

/** Notify only committed, newly imported bank evidence; never create a receipt or alert on reconciliation. */
export async function notifySepayBankMovements(env:StaffEnv,providerIds:readonly string[]){
 if(!providerIds.length)return;
 try{
  const [rows,registers,scope]=await Promise.all([
   env.db.select().from(sepayTransactions).where(inArray(sepayTransactions.providerId,[...new Set(providerIds)])),
   env.db.select({accountNumber:posRegisters.bankAccount,accountName:posRegisters.bankAccountName}).from(posRegisters),
   notificationScope(env.db),
  ]);
  const recipients=await scope.recipients({eventType:'sepay_bank_movement'},scope.people.map(m=>m.id));
  if(!recipients.length)return;
  const entities=sepayEntityMap(registers);
  await boundedMap(rows,4,async row=>{
   if(!['in','out'].includes(row.transferType))return;
   const outgoing=row.transferType==='out',entity=entities.get(row.accountNumber.replace(/\s+/g,''))||'unassigned';
   const company=entity==='vigifts'?'VIGIFTS':entity==='bach-ngan'?'Bách Ngân':'Chưa phân loại công ty';
   const day=vietnamDate(new Date(row.transactionAt)).iso;
   const time=new Intl.DateTimeFormat('vi-VN',{timeZone:'Asia/Ho_Chi_Minh',dateStyle:'short',timeStyle:'short'}).format(new Date(row.transactionAt));
   const params=new URLSearchParams({entity,from:day,to:day,direction:row.transferType});
   await notifyMany(env,recipients,{
    eventType:'sepay_bank_movement',dedupeKey:'sepay-bank:'+row.providerId,
    title:`SePay: ${outgoing?'Tiền ra −':'Tiền vào +'}${row.amount.toLocaleString('vi-VN')} ₫`,
    body:`${company} · TK …${row.accountNumber.slice(-4)} · ${time}. ${row.content}`,
    url:'/#/sepay?'+params,
    data:{transactionId:row.id,direction:row.transferType,entity},
   },[],scope);
  });
 }catch(error){console.error('sepay bank notification failed',error instanceof Error?error.message:'unknown');}
}
