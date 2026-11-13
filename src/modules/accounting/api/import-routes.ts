import {and,asc,desc,eq,inArray,sql} from 'drizzle-orm';
import {json,readJson,type Router,type RouteContext} from '../../../core/http/router.ts';
import {AppError} from '../../../core/errors.ts';
import {fold} from '../../../core/text/fold.ts';
import type {StaffEnv,SessionState} from '../../staff/api/auth-routes.ts';
import {sha256Hex} from '../../staff/domain/session.ts';
import {products,productPrices,pricePolicies} from '../../catalog/schema.ts';
import {accountingImportJobs as jobs,accountingImportChunks as chunks,accountingImportRows as rows} from '../import-schema.ts';
import {accountingBooks as books,accountingDocuments as docs,accountingLines as lines} from '../schema.ts';
import {canUseAccounting,day,short} from '../domain/accounting.ts';
import {vietnamDate} from '../../sales/domain/sales.ts';
import {bookOf,entityLock,type Db} from './store.ts';
const now=()=>new Date().toISOString();
type Ctx=RouteContext<StaffEnv>;
function owner(c:Ctx){const m=(c.state.session as SessionState).member;if(!canUseAccounting(m))throw new AppError(403,'Chỉ Manager và Kế toán được nhập sổ.');return m.id;}
async function jobOf(db:Db,id:string,ownerId:string,lock=false){
 const q=db.select().from(jobs).where(and(eq(jobs.id,id),eq(jobs.ownerId,ownerId)));
 const [job]=lock?await q.for('update'):await q.limit(1);
 if(!job)throw new AppError(404,'Không tìm thấy lượt nhập của tài khoản này.');return job;
}
async function progress(db:Db,job:typeof jobs.$inferSelect){
 const received=await db.select({chunkNo:chunks.chunkNo,rowCount:chunks.rowCount,errorCount:chunks.errorCount}).from(chunks).where(eq(chunks.jobId,job.id)).orderBy(asc(chunks.chunkNo));
 return {...job,chunkSize:500,chunks:received,receivedRows:received.reduce((n,c)=>n+c.rowCount,0),errorCount:received.reduce((n,c)=>n+c.errorCount,0)};
}
export function registerAccountingImportRoutes(router:Router<StaffEnv>){
 router.post('/accounting/books/:id/imports',async c=>{
  const user=owner(c),b=await readJson(c.req,10000),id=short(b.id,100),hash=short(b.fileHash,64),total=Number(b.totalRows),date=day(b.date),kind=String(b.kind) as "opening"|"purchase"|"sale",reference=short(b.reference,120);
  if(!/^[a-f0-9-]{36}$/.test(id)||!/^[a-f0-9]{64}$/.test(hash)||!Number.isInteger(total)||total<1||total>30000||!['opening','purchase','sale'].includes(kind)||date>vietnamDate().iso)throw new AppError(400,'Lượt nhập cần 1–30.000 dòng, mã file và ngày hợp lệ.');
  const job=await c.env.db.transaction(async tx=>{
   const db=tx as unknown as Db,book=await bookOf(db,c.params.id!);
   if(!book.active||!book.entityId)throw new AppError(409,'Sổ chưa gán pháp nhân hoặc đã tắt.');
   const policies=await db.select().from(pricePolicies).orderBy(asc(pricePolicies.sortOrder),asc(pricePolicies.id));
   const policy=['gia ban le','gia le','gia niem yet'].map(name=>policies.find(p=>fold(p.name)===name)).find(Boolean);
   if(!policy)throw new AppError(422,'Chưa có bảng giá bán niêm yết trước VAT phù hợp trên CRM.');
   const note=short(b.note,1000),filename=short(b.filename,200),stamp=now();
   await db.insert(jobs).values({id,ownerId:user,bookId:book.id,entityId:book.entityId,fileHash:hash,filename,totalRows:total,kind,date,reference,note,policyId:policy.id,policyName:policy.name,createdAt:stamp,updatedAt:stamp}).onConflictDoNothing();
   const job=await jobOf(db,id,user);
   if(job.bookId!==book.id||job.fileHash!==hash||job.totalRows!==total||job.kind!==kind||job.date!==date||job.reference!==reference||job.note!==note||job.filename!==filename)throw new AppError(409,'Mã lượt nhập đã dùng cho nội dung khác.');
   return job;
  });
  return json(await progress(c.env.db,job),201);
 },'business');
 router.get('/accounting/books/:id/imports',async c=>{
  const user=owner(c);
  const list=await c.env.db.select().from(jobs).where(and(eq(jobs.ownerId,user),eq(jobs.bookId,c.params.id!))).orderBy(desc(jobs.createdAt)).limit(20);
  return json({jobs:list});
 },'business');
 router.get('/accounting/imports/:id',async c=>{const user=owner(c);return json(await progress(c.env.db,await jobOf(c.env.db,c.params.id!,user)));},'business');
 router.get('/accounting/imports/:id/errors',async c=>{
  const user=owner(c),job=await jobOf(c.env.db,c.params.id!,user),offset=Number(c.url.searchParams.get('offset')||0);
  if(!Number.isInteger(offset)||offset<0||offset>30000)throw new AppError(400,'Trang lỗi không hợp lệ.');
  const errors=await c.env.db.select({lineNo:rows.lineNo,sourceRow:rows.sourceRow,sku:rows.sku,quantity:rows.rawQuantity,error:rows.error}).from(rows).where(and(eq(rows.jobId,job.id),sql`${rows.error}<>''`)).orderBy(asc(rows.lineNo)).limit(500).offset(offset);
  return json({rows:errors});
 },'business');
 router.post('/accounting/imports/:id/chunks/:chunk',async c=>{
  const user=owner(c),body=await readJson(c.req,600000),chunkNo=Number(c.params.chunk);
  if(!Number.isInteger(chunkNo)||chunkNo<0||chunkNo>=60||!Array.isArray(body.rows)||!body.rows.length||body.rows.length>500)throw new AppError(400,'Lô cần 1–500 dòng.');
  // Canonical bounded payload: identical retry must return the prior acknowledgement.
  const input=body.rows.map((r:any)=>{
   if(!r||typeof r.sku!=='string'||typeof r.quantity!=='string'||r.sku.length>200||r.quantity.length>64||!Number.isInteger(r.sourceRow)||r.sourceRow<2||r.sourceRow>30001)throw new AppError(400,'Dòng nguồn không hợp lệ.');
   return {sku:r.sku.trim(),quantity:r.quantity.trim(),sourceRow:r.sourceRow};
  });
  const hash=sha256Hex(JSON.stringify(input));
  const result=await c.env.db.transaction(async tx=>{
   const db=tx as unknown as Db,job=await jobOf(db,c.params.id!,user,true);
   if(job.state!=='uploading')throw new AppError(409,'Lượt nhập đã kết thúc hoặc bị hủy.');
   const expected=Math.min(500,job.totalRows-chunkNo*500);
   if(expected<=0||input.length!==expected)throw new AppError(400,'Lô không khớp tổng số dòng đã khai báo.');
   const [prior]=await db.select().from(chunks).where(and(eq(chunks.jobId,job.id),eq(chunks.chunkNo,chunkNo)));
   if(prior){if(prior.hash!==hash)throw new AppError(409,'Lô đã nhận có nội dung khác; không ghi đè dữ liệu.');return {replayed:true};}
   // Require ordered chunks so duplicate-SKU validation is deterministic across restarts/tabs.
   const [received]=await db.select({n:sql<number>`count(*)::int`}).from(chunks).where(eq(chunks.jobId,job.id));
   if(Number(received?.n)!==chunkNo)throw new AppError(409,'Gửi tiếp từ lô đã được máy chủ xác nhận.');
   const skus=[...new Set(input.map(r=>r.sku))],stamp=now();
   const catalog=await db.select({sku:products.sku,name:products.name,unit:products.unit,active:products.active,approval:products.approvalStatus,price:productPrices.price}).from(products).leftJoin(productPrices,and(eq(productPrices.sku,products.sku),eq(productPrices.policyId,job.policyId))).where(inArray(products.sku,skus));
   const old=await db.select({sku:rows.sku}).from(rows).where(and(eq(rows.jobId,job.id),inArray(rows.sku,skus)));
   const seen=new Set(old.map(r=>r.sku)),bySku=new Map(catalog.map(p=>[p.sku,p]));
   const staged=input.map((r,i)=>{
    const p=bySku.get(r.sku),quantity=Number(r.quantity),price=p?.price??null,errors:string[]=[];
    if(!r.sku||r.sku.length>64||/^[=+@\-]/.test(r.sku))errors.push('SKU_INVALID');
    if(seen.has(r.sku))errors.push('SKU_DUPLICATE');seen.add(r.sku);
    if(!/^\d+(\.\d{1,3})?$/.test(r.quantity)||!Number.isFinite(quantity)||quantity<=0||quantity>1e9)errors.push('QUANTITY_INVALID');
    if(!p)errors.push('SKU_NOT_FOUND');else{
     if(!p.active||p.approval!=='approved')errors.push('PRODUCT_UNAVAILABLE');
     if(!p.unit.trim())errors.push('UNIT_MISSING');
    }
    if(price===null||!Number.isFinite(price)||price<0||price>1e12)errors.push('PRICE_MISSING');
    const value=price===null?null:Math.round(quantity*price);
    if(value!==null&&(!Number.isSafeInteger(value)||value<0||value>9e12))errors.push('VALUE_INVALID');
    return {jobId:job.id,lineNo:chunkNo*500+i+1,sourceRow:r.sourceRow,sku:r.sku,rawQuantity:r.quantity,
     quantity:errors.includes('QUANTITY_INVALID')?null:String(quantity),name:p?.name||'',unit:p?.unit||'',unitPrice:price,
     netValue:errors.length?null:value,error:errors.join(';'),pricedAt:stamp};
   });
   await db.insert(rows).values(staged);
   await db.insert(chunks).values({jobId:job.id,chunkNo,hash,rowCount:staged.length,errorCount:staged.filter(r=>r.error).length,createdAt:stamp});
   await db.update(jobs).set({updatedAt:stamp}).where(eq(jobs.id,job.id));
   return {replayed:false};
  });
  return json({...result,...await progress(c.env.db,await jobOf(c.env.db,c.params.id!,user))});
 },'business');
 router.post('/accounting/imports/:id/cancel',async c=>{
  const user=owner(c);
  await c.env.db.transaction(async tx=>{const db=tx as unknown as Db,job=await jobOf(db,c.params.id!,user,true);if(job.state==='completed')throw new AppError(409,'Đã tạo chứng từ; không hủy lượt nhập thay cho hủy chứng từ.');await db.update(jobs).set({state:'cancelled',updatedAt:now()}).where(eq(jobs.id,job.id));});
  return json({ok:true});
 },'business');
 router.post('/accounting/imports/:id/finish',async c=>{
  const user=owner(c);
  const result=await c.env.db.transaction(async tx=>{
   const db=tx as unknown as Db,job=await jobOf(db,c.params.id!,user,true);
   if(job.state==='completed')return {documentId:job.documentId,replayed:true};
   if(job.state!=='uploading')throw new AppError(409,'Lượt nhập đã hủy.');
   await entityLock(db,job.entityId);
   const book=await bookOf(db,job.bookId);
   if(!book.active||book.entityId!==job.entityId)throw new AppError(409,'Sổ/pháp nhân đã thay đổi; không tạo chứng từ.');
   const [check]=await db.select({n:sql<number>`count(*)::int`,errors:sql<number>`count(*) filter(where ${rows.error}<>'')::int`,total:sql<string>`coalesce(sum(${rows.netValue}),0)::text`}).from(rows).where(eq(rows.jobId,job.id));
   if(Number(check?.n)!==job.totalRows)throw new AppError(409,'Chưa nhận đủ file. Tiếp tục các lô còn thiếu.');
   if(Number(check?.errors))throw new AppError(422,'File có dòng lỗi. Tải báo cáo và sửa file trước khi tạo chứng từ.');
   if(Number(check?.total)>9e12)throw new AppError(422,'Giá trị chứng từ vượt 9.000 tỷ VNĐ.');
   if(job.kind==='opening'&&book.openingDate)throw new AppError(409,'Sổ đã mở đầu kỳ; không tạo đầu kỳ lần hai.');
   const [existing]=await db.select({id:docs.id}).from(docs).where(and(eq(docs.entityId,job.entityId),eq(docs.kind,job.kind),eq(docs.reference,job.reference),eq(docs.series,''),eq(docs.counterpartyTaxCode,''),sql`${docs.state}<>'voided'`)).limit(1);
   if(existing)throw new AppError(409,'Số chứng từ đã tồn tại; không tạo bản trùng.');
   const [usage]=await db.select({n:sql<number>`count(*)::int`}).from(lines).innerJoin(docs,eq(lines.documentId,docs.id)).where(eq(docs.entityId,job.entityId));
   if(Number(usage?.n||0)+job.totalRows>50000)throw new AppError(413,'Phạm vi vượt 50.000 dòng báo cáo; chưa tạo chứng từ.');
   const id=crypto.randomUUID(),stamp=now();
   await db.insert(docs).values({id,bookId:job.bookId,entityId:job.entityId,kind:job.kind,date:job.date,reference:job.reference,
    note:`${job.note}\nNhập ${job.totalRows} dòng từ ${job.filename}. Giá bán niêm yết CRM: ${job.policyName}; chụp theo lô trong lượt ${job.id}. Định giá theo giá bán, không phải giá vốn kế toán.`,createdBy:user,createdAt:stamp});
   // One server-side INSERT SELECT: no 30k JSON payload/parameter explosion; atomic with header/job completion.
   await db.execute(sql`insert into accounting_lines(document_id,line_no,sku,name,unit,quantity,net_value,tax_rate)
     select ${id},line_no,sku,name,unit,quantity,net_value,null from accounting_import_rows where job_id=${job.id} order by line_no`);
   await db.update(jobs).set({state:'completed',documentId:id,updatedAt:stamp}).where(eq(jobs.id,job.id));
   return {documentId:id,replayed:false};
  });
  return json({...result,state:'draft',physicalInventoryAffected:false});
 },'business');
}
