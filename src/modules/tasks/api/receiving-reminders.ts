import {and, eq, inArray, isNull, like, or} from 'drizzle-orm';
import type {StaffEnv} from '../../staff/api/auth-routes.ts';
import {employees} from '../../staff/schema.ts';
import {receivingCalendar} from '../../suppliers/api/receiving-calendar.ts';
import {vietnamDate} from '../../sales/domain/sales.ts';
import {tasks} from '../schema.ts';
import type {AutoTask} from './auto-tasks.ts';
export const RECEIVING_REMINDER_PREFIX = 'receiving-due:';
/** One reminder per document/date/recipient. Past dates only retain existing work, never flood users on rollout. */
export async function receivingReminderTasks(db:StaffEnv['db'],now=new Date(),sourceId?:string):Promise<AutoTask[]> {
  const today=vietnamDate(now).iso;
  const time=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Ho_Chi_Minh',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(now);
  const [calendar,people,previous]=await Promise.all([
    receivingCalendar(db,new URLSearchParams({to:today}),today,{paginate:false,reminderOnly:true}),
    db.select({id:employees.id}).from(employees).where(and(eq(employees.active,true),isNull(employees.deletedAt),or(eq(employees.role,'manager'),and(eq(employees.role,'employee'),inArray(employees.positionId,['sale-admin','warehouse']))))),
    db.select({key:tasks.autoKey}).from(tasks).where(like(tasks.autoKey,RECEIVING_REMINDER_PREFIX+'%')),
  ]);
  const keys=new Set(previous.map(t=>t.key)),out:AutoTask[]=[];
  for(const row of calendar.rows) {
    if(!row.date||row.date>today||sourceId&&(row.requestId||row.orderId)!==sourceId)continue;
    const lines=row.lines.filter(l=>l.left>0&&(row.type==='purchase'||l.status!=='draft'&&l.status!=='rejected'));
    if(!lines.length)continue;
    const label=row.type==='purchase'?row.ticketNumber:'Phiếu lấy trước',id=row.requestId||row.orderId;
    for(const person of people) {
      const autoKey=`${RECEIVING_REMINDER_PREFIX}${row.type}:${id}:${row.supplierId}:${row.date}:${person.id}`;
      if(row.date===today&&time<'08:00'||row.date<today&&!keys.has(autoKey))continue;
      out.push({autoKey,source:'purchase',sourceId:id,assigneeId:person.id,priority:'high',dueDate:row.date,dueTime:'08:00',
        title:`Đến hẹn nhận hàng ${label} – ${row.supplierName}`.slice(0,200),
        description:`Hẹn nhận ${row.date.split('-').reverse().join('/')} lúc 08:00. ${lines.map(l=>`${l.sku}: ${l.left.toLocaleString('vi-VN')} ${l.unit}`).join('; ')}. Kiểm tra lịch nhận hàng và ghi nhận hàng trên đơn mua.`,
        link:row.type==='purchase'?`#/purchases/${row.orderId}`:`#/purchases?mode=incoming&request=${row.requestId}`});
    }
  }
  return out;
}
