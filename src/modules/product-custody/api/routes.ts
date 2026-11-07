import {z} from 'zod';
import {and,or,eq,ne,asc,desc,count,inArray,exists,sql,type SQL} from 'drizzle-orm';
import type {Router,RouteContext} from '../../../core/http/router.ts';
import {json,readJson} from '../../../core/http/router.ts';
import {AppError} from '../../../core/errors.ts';
import {nextDocumentNumber,documentNumberPatterns} from '../../../core/document-number.ts';
import {matchAllWords,foldSql} from '../../../core/text/fold.ts';
import {auditLogs} from '../../../core/db/schema.ts';
import {sniffImage} from '../../../core/http/image-bytes.ts';
import type {SessionState,StaffEnv} from '../../staff/api/auth-routes.ts';
import {employees,positionPermissions} from '../../staff/schema.ts';
import {sha256Hex} from '../../staff/domain/session.ts';
import {can} from '../../staff/domain/permissions.ts';
import {seesAllAsSaleAdmin} from '../../staff/domain/roles.ts';
import {products} from '../../catalog/schema.ts';
import {customers,customerStaff} from '../../customers/schema.ts';
import {customerAccess} from '../../customers/api/routes.ts';
import {suppliers} from '../../suppliers/schema.ts';
import {CUSTODY_KINDS,CUSTODY_STATUSES} from '../../../core/contracts/product-custody.ts';
import {custodyToday,validCustodyDate,custodyDeadline,custodyNext,canReceiveCustody} from '../domain/custody.ts';
import type {CustomerMergeTx} from '../../../core/contracts/customer-merge.ts';
import {custodyTickets as tickets,custodyLines as lines,custodyEvents as events,custodyPhotos as photos} from '../schema.ts';
type Ctx=RouteContext<StaffEnv>;
type Member=SessionState['member'];
const me=(c:Ctx)=>(c.state.session as SessionState).member;
const assignable=sql`(${employees.role}='manager' or (${employees.role}='employee' and exists(select 1 from ${positionPermissions} where ${positionPermissions.positionId}=${employees.positionId} and ${positionPermissions.permission}='page.product-custody')))`;
const visible=(m:Member)=>m.role==='manager'?undefined:or(eq(tickets.createdBy,m.id),eq(tickets.responsibleId,m.id));
const text=z.string().trim().max(4000),date=z.string().refine(validCustodyDate,'Ngày không hợp lệ.'),key=z.string().uuid();
const input=z.object({clientKey:key,kind:z.enum(CUSTODY_KINDS),customerId:z.string().min(1).max(200).optional(),supplierId:z.string().min(1).max(200).optional(),responsibleId:z.string().min(1).max(100),startDate:date,dueDate:date,issue:text.default(''),note:text.default(''),lines:z.array(z.object({sku:z.string().trim().min(1).max(100),qty:z.number().finite().positive().max(1e9).refine(n=>Math.abs(n*1000-Math.round(n*1000))<1e-5,'Số lượng tối đa 3 chữ số thập phân.'),conditionOut:z.string().trim().min(1).max(1000)})).min(1).max(50)}).strict();
const command=z.object({clientKey:key,revision:z.number().int().positive(),action:z.enum(['status','receive','update']),dueDate:date.optional(),responsibleId:z.string().min(1).max(100).optional(),headerNote:text.optional(),status:z.enum(CUSTODY_STATUSES).optional(),date,note:text.default(''),result:text.default(''),lines:z.array(z.object({id:z.string().min(1).max(100),qty:z.number().finite().nonnegative().max(1e9).refine(n=>Math.abs(n*1000-Math.round(n*1000))<1e-5),condition:z.string().trim().max(1000)})).max(50).optional()}).strict();
function parse<S extends z.ZodTypeAny>(schema:S,raw:unknown):z.output<S>{const p=schema.safeParse(raw);if(!p.success)throw new AppError(400,p.error.issues[0]?.message||'Dữ liệu không hợp lệ.');return p.data;}
function requirePage(c:Ctx){if(!can(me(c),'page.product-custody'))throw new AppError(403,'Chưa có quyền bảo hành / mượn mẫu.');}
async function get(c:Ctx,id:string){const [row]=await c.env.db.select().from(tickets).where(and(eq(tickets.id,id),visible(me(c))));if(!row)throw new AppError(404,'Không tìm thấy phiếu trong phạm vi được phân công.');return row;}
const customerScope=(m:Member)=>m.role==='manager'||seesAllAsSaleAdmin(m)?undefined:sql`exists(select 1 from ${customerStaff} where ${customerStaff.customerId}=${customers.id} and ${customerStaff.memberId}=${m.id})`;
async function detail(c:Ctx,id:string){
 const ticket=await get(c,id),db=c.env.db;
 const [items,history,images,[owner]]=await Promise.all([db.select().from(lines).where(eq(lines.ticketId,id)).orderBy(asc(lines.id)),db.select({id:events.id,action:events.action,date:events.date,at:events.at,note:events.note,data:events.data,actorId:events.actorId,actorName:employees.name}).from(events).innerJoin(employees,eq(employees.id,events.actorId)).where(eq(events.ticketId,id)).orderBy(asc(events.at),asc(events.id)),db.select().from(photos).where(eq(photos.ticketId,id)),db.select({name:employees.name}).from(employees).where(eq(employees.id,ticket.responsibleId))]);
 const [customer]=ticket.customerId?await db.select({name:customers.name}).from(customers).where(eq(customers.id,ticket.customerId)):[];
 const urls=c.env.files?await c.env.files.signedUrls(images.map(p=>p.storageKey),900).catch(()=>new Map<string,string>()):new Map<string,string>();
 const {fingerprint,clientKey,...safe}=ticket;
 return{ticket:{...safe,responsibleName:owner?.name||'',customerName:customer?.name||'',lines:items,...custodyDeadline(ticket.status,ticket.dueDate),canEdit:true},history:history.map(e=>({...e,data:JSON.parse(e.data)})),photos:images.map(p=>({id:p.id,url:urls.get(p.storageKey)||null,createdAt:p.createdAt})),actions:custodyNext(ticket.kind,ticket.status,!!ticket.customerId),canReceive:canReceiveCustody(ticket.kind,ticket.status),canAttach:!!c.env.files};
}
export function registerCustodyRoutes(router:Router<StaffEnv>){
 router.get('/product-custody/options',async c=>{requirePage(c);const m=me(c),db=c.env.db,q=(c.url.searchParams.get('q')||'').slice(0,100),type=c.url.searchParams.get('type');
  if(type==='products')return json({items:await db.select({id:products.sku,name:products.name,unit:products.unit}).from(products).where(and(eq(products.active,true),matchAllWords(foldSql(products.sku,products.name),q))).orderBy(asc(products.name)).limit(50)});
  if(type==='customers')return json({items:await db.select({id:customers.id,name:customers.name}).from(customers).where(and(customerScope(m),eq(customers.approvalStatus,'approved'),matchAllWords(foldSql(customers.name,customers.customerCode),q))).orderBy(asc(customers.name)).limit(50)});
  if(type==='suppliers')return json({items:await db.select({id:suppliers.id,name:suppliers.name}).from(suppliers).where(and(eq(suppliers.active,true),matchAllWords(foldSql(suppliers.name),q))).orderBy(asc(suppliers.name)).limit(50)});
  const owners=await db.selectDistinct({id:employees.id,name:employees.name}).from(tickets).innerJoin(employees,eq(employees.id,tickets.responsibleId)).where(visible(m)).orderBy(asc(employees.name));
  return json({owners,members:await db.select({id:employees.id,name:employees.name}).from(employees).where(and(eq(employees.active,true),assignable,m.role==='manager'?undefined:eq(employees.id,m.id))).orderBy(asc(employees.name)),canAssign:m.role==='manager'});
 },'business');
 router.get('/product-custody',async c=>{requirePage(c);const db=c.env.db,m=me(c),q=c.url.searchParams,today=custodyToday(),filters:(SQL|undefined)[]=[visible(m)];
  const addDate=(key:string,column:typeof tickets.dueDate,op:'from'|'to')=>{const v=q.get(key);if(v){if(!validCustodyDate(v))throw new AppError(400,'Ngày lọc không hợp lệ.');filters.push(op==='from'?sql`${column}>=${v}`:sql`${column}<=${v}`);}};
  if(q.get('kind'))filters.push(eq(tickets.kind,parse(z.enum(CUSTODY_KINDS),q.get('kind'))));if(q.get('status'))filters.push(eq(tickets.status,parse(z.enum(CUSTODY_STATUSES),q.get('status'))));
  if(q.get('owner'))filters.push(eq(tickets.responsibleId,q.get('owner')!));if(q.get('party'))filters.push(or(eq(tickets.customerId,q.get('party')!),eq(tickets.supplierId,q.get('party')!)));
  if(q.get('sku'))filters.push(exists(db.select({id:lines.id}).from(lines).where(and(eq(lines.ticketId,tickets.id),eq(lines.sku,q.get('sku')!)))));
  if(q.get('partyText'))filters.push(matchAllWords(foldSql(tickets.partyName),q.get('partyText')!.slice(0,100)));
  const search=(q.get('q')||'').trim().slice(0,100);if(search)filters.push(or(matchAllWords(foldSql(tickets.ticketNumber,tickets.partyName),search),exists(db.select({id:lines.id}).from(lines).where(and(eq(lines.ticketId,tickets.id),matchAllWords(foldSql(lines.sku,lines.name),search))))));
  addDate('from',tickets.dueDate,'from');addDate('to',tickets.dueDate,'to');
  const open=sql`${tickets.status} not in ('returned','delivered','completed')`,soon=new Date(today+'T00:00:00Z');soon.setUTCDate(soon.getUTCDate()+3);
  const metrics={warranty:and(eq(tickets.kind,'warranty'),inArray(tickets.status,['sent','processing'])),sample:and(eq(tickets.kind,'sample'),eq(tickets.status,'borrowed')),overdue:and(open,sql`${tickets.dueDate}<${today}`),due:and(open,sql`${tickets.dueDate}>=${today}`,sql`${tickets.dueDate}<=${soon.toISOString().slice(0,10)}`)};
  const summary=Object.fromEntries(await Promise.all(Object.entries(metrics).map(async([k,v])=>{const [r]=await db.select({n:count()}).from(tickets).where(and(...filters,v));return[k,r!.n];})));
  const metric=q.get('metric');if(metric){if(!Object.hasOwn(metrics,metric))throw new AppError(400,'Bộ lọc không hợp lệ.');filters.push(metrics[metric as keyof typeof metrics]);}
  const offset=parse(z.coerce.number().int().min(0).max(100000),q.get('offset')||0),limit=50;
  const [rows,[total]]=await Promise.all([db.select({ticket:tickets,responsibleName:employees.name}).from(tickets).innerJoin(employees,eq(employees.id,tickets.responsibleId)).where(and(...filters)).orderBy(desc(tickets.createdAt),asc(tickets.id)).limit(limit).offset(offset),db.select({n:count()}).from(tickets).where(and(...filters))]);
  const items=rows.length?await db.select().from(lines).where(inArray(lines.ticketId,rows.map(r=>r.ticket.id))):[];
  return json({tickets:rows.map(({ticket:{clientKey,fingerprint,...t},responsibleName})=>({...t,responsibleName,lines:items.filter(l=>l.ticketId===t.id),...custodyDeadline(t.status,t.dueDate,today),canEdit:true})),summary,total:total!.n,limit,offset,today});
 },'business');
 router.get('/product-custody/:id',async c=>{requirePage(c);return json(await detail(c,c.params.id!));},'business');
 router.post('/product-custody',async c=>{requirePage(c);const b=parse(input,await readJson(c.req,100000)),m=me(c),today=custodyToday();
  if(b.startDate>today||b.dueDate<b.startDate)throw new AppError(400,'Ngày bàn giao không được ở tương lai; hạn trả phải từ ngày bàn giao.');
  if(b.kind==='warranty'&&!b.issue)throw new AppError(400,'Nhập mô tả lỗi bảo hành.');if(b.kind==='sample'&&(!b.customerId||b.supplierId)||b.kind==='warranty'&&!b.supplierId)throw new AppError(400,'Chọn đúng khách hàng / NCC của loại phiếu.');
  if(m.role!=='manager'&&b.responsibleId!==m.id)throw new AppError(403,'Chỉ Manager được giao phiếu cho nhân viên khác.');
  const [owner]=await c.env.db.select({id:employees.id}).from(employees).where(and(eq(employees.id,b.responsibleId),eq(employees.active,true),assignable));if(!owner)throw new AppError(400,'Người phụ trách không hoạt động.');
  let customerName='',supplierName='';if(b.customerId){if(!(await customerAccess(c.env.db,b.customerId,m)).canSeeAll)throw new AppError(403,'Khách hàng chưa được phân công / chia sẻ.');const [customer]=await c.env.db.select().from(customers).where(eq(customers.id,b.customerId));if(!customer||customer.approvalStatus!=='approved')throw new AppError(400,'Khách hàng chưa được duyệt.');customerName=customer.name;}
  if(b.supplierId){const [supplier]=await c.env.db.select().from(suppliers).where(and(eq(suppliers.id,b.supplierId),eq(suppliers.active,true)));if(!supplier)throw new AppError(400,'NCC không hoạt động.');supplierName=supplier.name;}
  if(new Set(b.lines.map(l=>l.sku)).size!==b.lines.length)throw new AppError(400,'Mỗi mã chỉ được chọn một dòng.');const catalog=await c.env.db.select().from(products).where(and(inArray(products.sku,b.lines.map(l=>l.sku)),eq(products.active,true)));if(catalog.length!==b.lines.length)throw new AppError(400,'Có sản phẩm không hoạt động / không tồn tại.');
  const fingerprint=sha256Hex(JSON.stringify(b)),now=new Date().toISOString();
  const id=await c.env.db.transaction(async tx=>{await tx.execute(sql`select pg_advisory_xact_lock(hashtext('product_custody_create'))`);const [existing]=await tx.select().from(tickets).where(and(eq(tickets.createdBy,m.id),eq(tickets.clientKey,b.clientKey)));if(existing){if(existing.fingerprint!==fingerprint)throw new AppError(409,'Mã gửi lại có nội dung khác.');return existing.id;}
   const prefix=b.kind==='warranty'?'BH':'MM',patterns=documentNumberPatterns(prefix,today),used=await tx.select({no:tickets.ticketNumber}).from(tickets).where(or(sql`${tickets.ticketNumber} like ${patterns[0]}`,sql`${tickets.ticketNumber} like ${patterns[1]}`));
   const id=crypto.randomUUID(),status=b.kind==='warranty'?'pending':'borrowed';await tx.insert(tickets).values({id,ticketNumber:nextDocumentNumber(prefix,today,used.map(r=>r.no)),kind:b.kind,status,customerId:b.customerId||null,supplierId:b.supplierId||null,partyName:b.kind==='warranty'?supplierName:customerName,responsibleId:b.responsibleId,createdBy:m.id,startDate:b.startDate,dueDate:b.dueDate,issue:b.issue,note:b.note,clientKey:b.clientKey,fingerprint,createdAt:now,updatedAt:now});
   await tx.insert(lines).values(b.lines.map(l=>{const p=catalog.find(p=>p.sku===l.sku)!;return{id:crypto.randomUUID(),ticketId:id,sku:l.sku,name:p.name,unit:p.unit,qty:l.qty,conditionOut:l.conditionOut};}));
   await tx.insert(events).values({id:crypto.randomUUID(),ticketId:id,actorId:m.id,action:'create',date:b.startDate,at:now,note:b.note,data:JSON.stringify({status}),clientKey:b.clientKey,fingerprint});await tx.insert(auditLogs).values({id:crypto.randomUUID(),actorId:m.id,module:'product-custody',action:'create',entityType:'custody-ticket',entityId:id,data:JSON.stringify({kind:b.kind}),createdAt:now});return id;});return json(await detail(c,id),201);
 },'business');
 router.post('/product-custody/:id/actions',async c=>{requirePage(c);const id=c.params.id!;await get(c,id);const b=parse(command,await readJson(c.req,100000)),m=me(c),fingerprint=sha256Hex(JSON.stringify({id,...b})),now=new Date().toISOString();
  const headerFields=b.dueDate!==undefined||b.responsibleId!==undefined||b.headerNote!==undefined;
  if((b.action==='receive'&&(b.status!==undefined||headerFields))||(b.action==='status'&&(b.lines!==undefined||headerFields))||(b.action==='update'&&(b.lines!==undefined||b.status!==undefined||b.result)))throw new AppError(400,'Nội dung không đúng loại thao tác.');
  await c.env.db.transaction(async tx=>{await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${m.id+':'+b.clientKey}))`);const [t]=await tx.select().from(tickets).where(and(eq(tickets.id,id),visible(m))).for('update');if(!t)throw new AppError(404,'Không tìm thấy phiếu.');const [old]=await tx.select().from(events).where(and(eq(events.actorId,m.id),eq(events.clientKey,b.clientKey)));if(old){if(old.fingerprint!==fingerprint)throw new AppError(409,'Yêu cầu gửi lại có nội dung khác.');return;}
   if(t.revision!==b.revision)throw new AppError(409,'Phiếu đã thay đổi. Tải lại trước khi ghi nhận.');if(b.date<t.startDate||b.date>custodyToday())throw new AppError(400,'Ngày thực tế không hợp lệ.');const previous=await tx.select().from(events).where(and(eq(events.ticketId,id),ne(events.action,'update'))).orderBy(desc(events.date)).limit(1);if(previous[0]&&b.date<previous[0].date)throw new AppError(400,'Ngày thực tế phải từ lần ghi nhận trước.');
   let dueDate=t.dueDate,responsibleId=t.responsibleId,note=t.note;
   let status=t.status,returnedDate=t.returnedDate,sentDate=t.sentDate,deliveredDate=t.deliveredDate,result=t.result;
   if(b.action==='update'){
    if(['completed','delivered'].includes(t.status))throw new AppError(400,'Phiếu đã hoàn tất không được đổi thông tin.');
    if(b.dueDate){if(b.dueDate<t.startDate)throw new AppError(400,'Hạn trả phải từ ngày bắt đầu.');dueDate=b.dueDate;}
    if(b.responsibleId&&b.responsibleId!==t.responsibleId){if(m.role!=='manager')throw new AppError(403,'Chỉ Manager được phân công lại.');const [owner]=await tx.select().from(employees).where(and(eq(employees.id,b.responsibleId),eq(employees.active,true),assignable));if(!owner)throw new AppError(400,'Người phụ trách không hoạt động.');responsibleId=b.responsibleId;}if(b.headerNote!==undefined)note=b.headerNote;
   }else if(b.action==='receive'){
    if(!canReceiveCustody(t.kind,t.status)||!b.lines?.some(l=>l.qty>0))throw new AppError(400,'Phiếu không chờ nhận trả hoặc chưa nhập số lượng.');if(new Set(b.lines.map(l=>l.id)).size!==b.lines.length)throw new AppError(400,'Dòng nhận trả bị trùng.');
    const current=await tx.select().from(lines).where(eq(lines.ticketId,id));for(const change of b.lines){const l=current.find(l=>l.id===change.id);if(!l||change.qty>Math.round((l.qty-l.returnedQty)*1000)/1000||change.qty>0&&!change.condition)throw new AppError(400,'Số lượng vượt phần còn lại hoặc thiếu tình trạng nhận.');l.returnedQty=Math.round((l.returnedQty+change.qty)*1000)/1000;await tx.update(lines).set({returnedQty:l.returnedQty}).where(eq(lines.id,l.id));}
    if(current.every(l=>l.returnedQty===l.qty)){status='returned';returnedDate=b.date;}if(b.result)result=b.result;
   }else{if(!b.status||!custodyNext(t.kind,t.status,!!t.customerId).includes(b.status))throw new AppError(400,'Không được bỏ bước trạng thái.');status=b.status;if(status==='sent')sentDate=b.date;if(status==='delivered')deliveredDate=b.date;if(t.kind==='warranty'&&['delivered','completed'].includes(status)&&!b.result&&!result)throw new AppError(400,'Nhập kết quả xử lý bảo hành.');if(b.result)result=b.result;}
   await tx.update(tickets).set({status,returnedDate,sentDate,deliveredDate,result,dueDate,responsibleId,note,revision:t.revision+1,updatedAt:now}).where(eq(tickets.id,id));await tx.insert(events).values({id:crypto.randomUUID(),ticketId:id,actorId:m.id,action:b.action,date:b.date,at:now,note:b.note,data:JSON.stringify({from:t.status,to:status,result,dueDate,responsibleId,lines:b.lines||[]}),clientKey:b.clientKey,fingerprint});await tx.insert(auditLogs).values({id:crypto.randomUUID(),actorId:m.id,module:'product-custody',action:b.action,entityType:'custody-ticket',entityId:id,data:JSON.stringify({from:t.status,to:status}),createdAt:now});
  });return json(await detail(c,id));
 },'business');
 router.post('/product-custody/:id/photos',async c=>{requirePage(c);const id=c.params.id!;await get(c,id);const store=c.env.files;if(!store)throw new AppError(503,'Kho tệp chưa sẵn sàng.');const b=await readJson(c.req,600000),raw=b.image;if(typeof raw!=='string')throw new AppError(400,'Thiếu ảnh.');const match=/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+=*)$/.exec(raw);if(!match)throw new AppError(400,'Chỉ nhận ảnh JPG, PNG hoặc WebP.');let bytes:Uint8Array;try{bytes=Uint8Array.from(atob(match[2]!),c=>c.charCodeAt(0));}catch{throw new AppError(400,'Ảnh không hợp lệ.');}if(bytes.length>400000||sniffImage(bytes)!==match[1])throw new AppError(400,'Ảnh quá lớn hoặc sai định dạng.');const photoId=crypto.randomUUID(),storageKey='product-custody/'+id+'/'+photoId+'.'+(match[1]==='image/jpeg'?'jpg':match[1].split('/')[1]);
  try{await store.put(storageKey,bytes,match[1]!);await c.env.db.transaction(async tx=>{const [locked]=await tx.select().from(tickets).where(and(eq(tickets.id,id),visible(me(c)))).for('update');if(!locked)throw new AppError(404,'Không tìm thấy phiếu.');const [n]=await tx.select({n:count()}).from(photos).where(eq(photos.ticketId,id));if(n!.n>=12)throw new AppError(400,'Mỗi phiếu tối đa 12 ảnh.');await tx.insert(photos).values({id:photoId,ticketId:id,storageKey,createdBy:me(c).id,createdAt:new Date().toISOString()});});}catch(error){try{await store.remove([storageKey]);}catch{console.warn('custody photo cleanup failed');}throw error;}return json(await detail(c,id),201);
 },'business');
}

export async function reassignCustodyCustomer(tx:CustomerMergeTx,keepId:string,dropIds:string[]){await tx.update(tickets).set({customerId:keepId}).where(inArray(tickets.customerId,dropIds));}
