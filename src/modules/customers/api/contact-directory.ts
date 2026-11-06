import {asc,eq,inArray} from 'drizzle-orm';
import type {AnyDb} from '../../../core/db/client.ts';
import {AppError} from '../../../core/errors.ts';
import {fold} from '../../../core/text/fold.ts';
import {sha256Hex} from '../../staff/domain/session.ts';
import {customers,customerContacts} from '../schema.ts';
import {initialCustomerProfile} from '../domain/customer-contact-input.ts';
import {CUSTOMER_LIMITS} from '../domain/customer-config.ts';

type Customer=typeof customers.$inferSelect;
type Contact=Pick<typeof customerContacts.$inferSelect,'id'|'name'|'title'|'phone'|'email'|'note'|'isPrimary'|'updatedAt'>;
const nameKey=(v:string)=>v.normalize('NFC').trim().replace(/\s+/g,' ').toLocaleLowerCase('vi');
export const contactRows=(db:AnyDb,id:string)=>db.select({id:customerContacts.id,name:customerContacts.name,title:customerContacts.title,phone:customerContacts.phone,email:customerContacts.email,note:customerContacts.note,isPrimary:customerContacts.isPrimary,updatedAt:customerContacts.updatedAt}).from(customerContacts).where(eq(customerContacts.customerId,id)).orderBy(asc(customerContacts.createdAt),asc(customerContacts.id));
/** Includes the legacy fields because they seed a contact when editing an older customer. */
export const contactDirectoryVersion=(c:Customer,rows:Contact[])=>sha256Hex(JSON.stringify({contact:c.contact,phone:c.phone,email:c.email,representative:c.representativeContactId,rows:[...rows].sort((a,b)=>a.id.localeCompare(b.id)).map(r=>[r.id,r.name,r.title,r.phone,r.email,r.note,r.isPrimary,r.updatedAt])}));
export function editableContacts(c:Customer,rows:Contact[]){
 const list:Array<Omit<Contact,'id'|'updatedAt'>&{id:string|null;isRepresentative:boolean}>=rows.map(({updatedAt:_at,...r})=>({...r,isRepresentative:r.id===c.representativeContactId}));
 if(c.contact.trim()&&!list.some(r=>nameKey(r.name)===nameKey(c.contact)))list.push({id:null,name:c.contact,title:'',phone:c.phone,email:c.email,note:'',isPrimary:!list.some(r=>r.isPrimary),isRepresentative:false});
 const primary=list.findIndex(r=>r.isPrimary),legacy=list.findIndex(r=>nameKey(r.name)===nameKey(c.contact)),chosen=primary>=0?primary:legacy>=0?legacy:0;
 return list.map((r,i)=>({...r,isPrimary:i===chosen}));
}
export async function lockContactCustomer(db:AnyDb,id:string){const [row]=await db.select().from(customers).where(eq(customers.id,id)).for('update');if(!row)throw new AppError(404,'Không tìm thấy khách hàng.');return row;}
/** Preserve the legacy person before another contact becomes primary. Caller holds the customer row lock. */
export async function ensureLegacyContact(db:AnyDb,c:Customer,actorId:string,now:string){
 const rows=await contactRows(db,c.id),wanted=editableContacts(c,rows),legacy=wanted.find(r=>r.id===null);
 if(legacy){
  if(rows.length>=CUSTOMER_LIMITS.contacts)throw new AppError(400,'Danh sách đã đủ 50 người. Mở Sửa khách hàng để gộp người liên hệ cũ trước.');
  const {id:_id,isRepresentative:_rep,...fields}=legacy;
  await db.insert(customerContacts).values({...fields,id:crypto.randomUUID(),customerId:c.id,createdBy:actorId,createdAt:now,updatedAt:now});
 }
}
export async function syncPrimaryContact(db:AnyDb,c:Customer){
 const rows=await contactRows(db,c.id),chosen=rows.find(r=>r.isPrimary)??rows.find(r=>nameKey(r.name)===nameKey(c.contact))??rows[0],contact=chosen?.name??'';
 for(const r of rows)if(r.isPrimary!==(r.id===chosen?.id))await db.update(customerContacts).set({isPrimary:r.id===chosen?.id}).where(eq(customerContacts.id,r.id));
 await db.update(customers).set({contact,search:fold([c.name,contact,c.phone,c.email,c.address,c.taxCode,c.customerCode].join(' '))}).where(eq(customers.id,c.id));
}
/** Full directory replacement retains IDs and is atomic with the customer form. */
export async function saveContactDirectory(db:AnyDb,c:Customer,raw:unknown,version:unknown,actorId:string,now:string){
 if(!Array.isArray(raw))throw new AppError(400,'Danh sách người liên hệ không hợp lệ.');
 const parsed=initialCustomerProfile({contacts:raw}),existing=await contactRows(db,c.id);
 if(typeof version!=='string')throw new AppError(400,'Cần tải đầy đủ danh sách người liên hệ trước khi lưu.');
 if(version!==contactDirectoryVersion(c,existing))throw new AppError(409,'Người liên hệ đã được cập nhật. Đóng và mở lại form để xem bản mới trước khi lưu.','CUSTOMER_CONTACT_CONFLICT');
 const ids=(raw as Record<string,unknown>[]).map(r=>r.id??null),seen=new Set<string>();
 for(const id of ids){if(id===null)continue;if(typeof id!=='string'||!existing.some(r=>r.id===id)||seen.has(id))throw new AppError(400,'Người liên hệ không thuộc khách hàng này hoặc bị lặp.');seen.add(id);}
 const chosen=parsed.contacts.findIndex(r=>r.isPrimary),contacts=parsed.contacts.map((r,i)=>({...r,isPrimary:i===(chosen<0?0:chosen)}));
 const removed=existing.filter(r=>!seen.has(r.id)).map(r=>r.id);
 if(removed.length)await db.delete(customerContacts).where(inArray(customerContacts.id,removed));
 const saved:string[]=[];
 for(let i=0;i<contacts.length;i++){
  const id=ids[i] as string|null,fields=contacts[i]!;
  if(id){await db.update(customerContacts).set({...fields,updatedAt:now}).where(eq(customerContacts.id,id));saved.push(id);}
  else{const newId=crypto.randomUUID();await db.insert(customerContacts).values({...fields,id:newId,customerId:c.id,createdBy:actorId,createdAt:now,updatedAt:now});saved.push(newId);}
 }
 return {contact:contacts.find(r=>r.isPrimary)?.name??'',representativeContactId:saved[parsed.representativeIndex]??null};
}
