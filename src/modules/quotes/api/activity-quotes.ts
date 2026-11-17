import {and,eq,desc,inArray,sql} from 'drizzle-orm';
import {AppError} from '../../../core/errors.ts';
import type {ActivityQuoteAccess} from '../../../core/contracts/activity-quotes.ts';
import {employees} from '../../staff/schema.ts';
import {quotations,quoteRevisions} from '../schema.ts';
import {quotationPredicate} from './department-access.ts';
/** App injects this reader into care; quote authorization stays in its owning module. */
export const activityQuotes:ActivityQuoteAccess={
 async context(db,actor,input){
  if(!Number.isSafeInteger(input.revision)||input.revision<1)throw new AppError(400,'Thiếu phiên bản báo giá đã lưu.');
  const [q]=await db.select().from(quotations).where(and(eq(quotations.id,input.id),quotationPredicate(actor))).limit(1);
  if(!q)throw new AppError(404,'Không tìm thấy báo giá trong phạm vi.');
  let payload=q.data;
  if(input.revision!==q.revision){const [old]=await db.select({data:quoteRevisions.data}).from(quoteRevisions).where(and(eq(quoteRevisions.quoteId,q.id),eq(quoteRevisions.revision,input.revision))).limit(1);if(!old)throw new AppError(409,'Không tìm thấy phiên bản báo giá. Mở lại báo giá.');payload=old.data;}
  const data=JSON.parse(payload);
  const [owner]=await db.select({id:employees.id,name:employees.name,active:employees.active,role:employees.role}).from(employees).where(eq(employees.id,q.assigneeId||q.creatorId)).limit(1);
  const validOwner=owner?.active&&['employee','manager'].includes(owner.role);
  return{quoteId:q.id,quoteRevision:input.revision,quoteNo:data.quoteNo||q.quoteNo,customerId:data.customerId||null,customerName:data.customer||q.customer,contactName:data.contact||'',ownerId:validOwner?owner.id:null,ownerName:validOwner?owner.name:''};
 },
 async read(db,actor,input){
  const [q]=await db.select().from(quotations).where(and(eq(quotations.id,input.id),quotationPredicate(actor))).limit(1);
  if(!q)throw new AppError(404,'Không tìm thấy báo giá trong phạm vi.');
  let payload=q.data;
  if(input.revision!==q.revision){const [old]=await db.select({data:quoteRevisions.data}).from(quoteRevisions).where(and(eq(quoteRevisions.quoteId,q.id),eq(quoteRevisions.revision,input.revision))).limit(1);if(!old)throw new AppError(409,'Không tìm thấy bản báo giá đã gửi. Chọn lại đúng phiên bản.');payload=old.data;}
  let data:any={};try{data=JSON.parse(payload);}catch{}
  if(data.customerId!==input.customerId)throw new AppError(400,'Báo giá không thuộc khách hàng đã chọn.');
  return{quoteId:q.id,quoteRevision:input.revision};
 },
 async list(db,actor,customerId){
  const rows=await db.select({id:quotations.id,no:quotations.quoteNo,revision:quotations.revision}).from(quotations).where(and(quotationPredicate(actor),sql`${quotations.data}::jsonb->>'customerId'=${customerId}`)).orderBy(desc(quotations.updatedAt)).limit(100);
  const history=rows.length?await db.select({quoteId:quoteRevisions.quoteId,revision:quoteRevisions.revision}).from(quoteRevisions).where(and(inArray(quoteRevisions.quoteId,rows.map(q=>q.id)),sql`${quoteRevisions.data}::jsonb->>'customerId'=${customerId}`)).orderBy(desc(quoteRevisions.createdAt)).limit(500):[];
  const all=[...rows,...history.map(v=>({id:v.quoteId,no:rows.find(q=>q.id===v.quoteId)!.no,revision:v.revision}))];
  return[...new Map(all.map(q=>[q.id+':'+q.revision,q])).values()];
 }
};
