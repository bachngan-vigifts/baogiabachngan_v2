import {and,asc,count,eq,inArray} from 'drizzle-orm';
import {AppError} from '../../../core/errors.ts';
import {json,readJson,type Router,type RouteContext} from '../../../core/http/router.ts';
import {writeAudit} from '../../../core/audit.ts';
import type {StaffEnv,SessionState} from '../../staff/api/auth-routes.ts';
import {quotations} from '../../quotes/schema.ts';
import {quotationPredicate} from '../../quotes/api/department-access.ts';
import {productionFiles,productionFolders,productionFileLinks,salesOrders} from '../schema.ts';
import {needsProductionFiles,productionFile,PRODUCTION_MAX_BYTES,PRODUCTION_MAX_FILES} from '../domain/production-files.ts';
type Ctx=RouteContext<StaffEnv>;type Tx=Parameters<Parameters<StaffEnv['db']['transaction']>[0]>[0];
const viewer=(c:Ctx)=>(c.state.session as SessionState).member;
const summary=(r:typeof productionFiles.$inferSelect)=>({id:r.id,name:r.name,bytes:r.bytes,status:r.status,quoteRevision:r.quoteRevision,createdAt:r.createdAt});
async function quoteFor(c:Ctx,edit=false){const [q]=await c.env.db.select().from(quotations).where(and(eq(quotations.id,c.params.quoteId!),quotationPredicate(viewer(c),edit))).limit(1);if(!q)throw new AppError(404,'Không tìm thấy báo giá hoặc bạn chưa được cấp quyền.');return q;}
/** Called inside the same creation transaction; files cannot be injected from another quotation/revision. */
export async function bindProductionFiles(tx:Tx,c:Ctx,q:typeof quotations.$inferSelect,orderId:string,raw:unknown){
 if(raw!==undefined&&(!Array.isArray(raw)||raw.some(v=>typeof v!=='string')||raw.length>PRODUCTION_MAX_FILES))throw new AppError(400,'Danh sách file sản xuất không hợp lệ.');
 const ids=[...new Set((raw||[]) as string[])],eligible=needsProductionFiles(JSON.parse(q.data));
 if(ids.length&&!eligible)throw new AppError(400,'Báo giá này không thuộc luồng file sản xuất.');
 if(eligible&&c.env.productionFilesRequired&&!ids.length)throw new AppError(400,'Đính kèm ít nhất một file sản xuất đã lưu Drive.','PRODUCTION_REQUIRED');
 if(!ids.length)return;
 const [current]=await tx.select({revision:quotations.revision,approvalStatus:quotations.approvalStatus}).from(quotations).where(eq(quotations.id,q.id)).for('update');if(current?.revision!==q.revision||current.approvalStatus!=='approved')throw new AppError(409,'Báo giá đã đổi phiên bản hoặc chưa được duyệt. Mở lại form.');
 const rows=await tx.select().from(productionFiles).where(inArray(productionFiles.id,ids)).for('update');
 if(rows.length!==ids.length||rows.some(r=>r.quoteId!==q.id||r.quoteRevision!==q.revision||r.status!=='ready'))throw new AppError(409,'File sản xuất chưa lưu xong, thuộc báo giá/phiên bản khác hoặc đã gắn chứng từ khác. Mở lại danh sách file.','PRODUCTION_NOT_READY');
 await tx.insert(productionFileLinks).values(ids.map(fileId=>({orderId,fileId}))).onConflictDoNothing();
}
export function registerProductionFiles(router:Router<StaffEnv>,loadOrder:(c:Ctx,id:string)=>Promise<typeof salesOrders.$inferSelect>,assertEdit:(c:Ctx,o:typeof salesOrders.$inferSelect,what?:string,db?:StaffEnv['db']|Tx)=>Promise<void>){
 router.get('/quotes/:quoteId/production-files',async c=>{const q=await quoteFor(c),eligible=needsProductionFiles(JSON.parse(q.data));const rows=await c.env.db.select().from(productionFiles).where(eq(productionFiles.quoteId,q.id)).orderBy(asc(productionFiles.createdAt));return json({eligible,required:eligible&&!!c.env.productionFilesRequired,configured:!!c.env.productionDrive,quoteRevision:q.revision,maxBytes:PRODUCTION_MAX_BYTES,maxFiles:PRODUCTION_MAX_FILES,files:rows.map(summary)});},'business');
 router.put('/quotes/:quoteId/production-files/:clientKey',async c=>{
  const q=await quoteFor(c,true),me=viewer(c),drive=c.env.productionDrive;
  if(!needsProductionFiles(JSON.parse(q.data)))throw new AppError(400,'Chỉ đính kèm file SX cho báo giá Sale hoặc có in logo.');
  if(!drive)throw new AppError(503,'Chưa cấu hình kết nối Google Drive trên máy chủ CRM. Chưa tải file lên.','DRIVE_NOT_CONFIGURED');
  const key=c.params.clientKey!;if(!/^[a-f0-9-]{36}$/.test(key)||Number(c.url.searchParams.get('revision'))!==q.revision)throw new AppError(409,'Báo giá đã đổi phiên bản. Mở lại form trước khi tải file.');
  if(c.req.headers.get('content-type')!=='application/octet-stream')throw new AppError(415,'Gửi file nhị phân hợp lệ.');
  const reader=c.req.body?.getReader();if(!reader)throw new AppError(400,'Thiếu nội dung file.');const chunks:Uint8Array[]=[];let n=0;
  for(;;){const x=await reader.read();if(x.done)break;n+=x.value.length;if(n>PRODUCTION_MAX_BYTES){await reader.cancel();throw new AppError(413,'File sản xuất tối đa 10 MB.');}chunks.push(x.value);}
  const bytes=new Uint8Array(n);let at=0;for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.length;}
  const info=productionFile(c.url.searchParams.get('name')||'',bytes),now=new Date().toISOString();
  // Reserve IDs before uploading. Replays, including lost acknowledgements, use the same Drive IDs.
  let [folder]=await c.env.db.select().from(productionFolders).where(eq(productionFolders.quoteId,q.id));
  if(!folder){const id=await drive.reserveId();await c.env.db.insert(productionFolders).values({quoteId:q.id,driveId:id,createdAt:now}).onConflictDoNothing();[folder]=await c.env.db.select().from(productionFolders).where(eq(productionFolders.quoteId,q.id));}
  const condition=and(eq(productionFiles.quoteId,q.id),eq(productionFiles.quoteRevision,q.revision),eq(productionFiles.sha256,info.sha256));
  let [row]=await c.env.db.select().from(productionFiles).where(condition);
  if(!row){const driveId=await drive.reserveId();row=await c.env.db.transaction(async tx=>{
   const [current]=await tx.select().from(quotations).where(eq(quotations.id,q.id)).for('update');if(current?.revision!==q.revision)throw new AppError(409,'Báo giá đã thay đổi, tải lại trước khi đính kèm.');
   const [same]=await tx.select().from(productionFiles).where(condition);if(same)return same;
   const [total]=await tx.select({n:count()}).from(productionFiles).where(and(eq(productionFiles.quoteId,q.id),eq(productionFiles.quoteRevision,q.revision)));if(total!.n>=PRODUCTION_MAX_FILES)throw new AppError(400,'Mỗi phiên bản báo giá tối đa 10 file SX.');
   const [newRow]=await tx.insert(productionFiles).values({id:key,quoteId:q.id,quoteRevision:q.revision,name:info.name,mime:info.mime,sha256:info.sha256,md5:info.md5,driveId,bytes:n,createdBy:me.id,createdAt:now}).onConflictDoNothing().returning();if(!newRow)throw new AppError(409,'Mã tải file đã dùng cho nội dung khác.');return newRow;
  });}
  if(row.status!=='ready'){
   await drive.ensureFolder(folder!.driveId,`${q.quoteNo||'Bao-gia'} - ${q.id}`,q.id);
   await drive.put(row.driveId,folder!.driveId,row.name,bytes,row.mime,info.sha256,info.md5);
   await c.env.db.update(productionFiles).set({status:'ready'}).where(eq(productionFiles.id,row.id));
  }
  await writeAudit(c.env.db,{actorId:me.id,module:'sales',action:'production-file-ready',entityType:'quotation',entityId:q.id,data:{id:row.id,bytes:n,quoteRevision:q.revision}});
  return json({file:summary({...row,status:'ready'})});
 },'business');
 router.get('/orders/:id/production-files',async c=>{const order=await loadOrder(c,c.params.id!);const rows=await c.env.db.select({file:productionFiles}).from(productionFiles).innerJoin(productionFileLinks,eq(productionFileLinks.fileId,productionFiles.id)).where(eq(productionFileLinks.orderId,order.id)).orderBy(asc(productionFiles.createdAt));let canAttach=false;if(order.quoteId){try{await assertEdit(c,order);const [q]=await c.env.db.select().from(quotations).where(and(eq(quotations.id,order.quoteId),quotationPredicate(viewer(c),true)));canAttach=!!q&&needsProductionFiles(JSON.parse(q.data));}catch(e){if(!(e instanceof AppError)||e.status!==403)throw e;}}return json({files:rows.map(r=>summary(r.file)),canAttach,quoteId:canAttach?order.quoteId:null});},'business');
 router.put('/orders/:id/production-files',async c=>{
  const o=await loadOrder(c,c.params.id!);await assertEdit(c,o);if(!o.quoteId)throw new AppError(400,'Chỉ đính kèm cho chứng từ sinh từ báo giá.');
  const body=await readJson(c.req,10000);c.params.quoteId=o.quoteId;const q=await quoteFor(c,true);
  await c.env.db.transaction(async tx=>{const [current]=await tx.select().from(salesOrders).where(eq(salesOrders.id,o.id)).for('update');if(!current)throw new AppError(404,'Không tìm thấy chứng từ.');await assertEdit(c,current,'file sản xuất',tx);await bindProductionFiles(tx,c,q,o.id,body.productionFileIds);});return json({ok:true});
 },'business');
 router.get('/production-files/:id/download',async c=>{
  const [file]=await c.env.db.select().from(productionFiles).where(eq(productionFiles.id,c.params.id!)).limit(1);if(!file)throw new AppError(404,'Không tìm thấy file.');
  const links=await c.env.db.select().from(productionFileLinks).where(eq(productionFileLinks.fileId,file.id));let allowed=false;for(const link of links){try{await loadOrder(c,link.orderId);allowed=true;break;}catch(e){if(!(e instanceof AppError)||e.status!==404)throw e;}}if(!allowed){c.params.quoteId=file.quoteId;await quoteFor(c);}
  if(file.status!=='ready'||!c.env.productionDrive)throw new AppError(503,'File SX hoặc kết nối Drive chưa sẵn sàng.');
  const [folder]=await c.env.db.select().from(productionFolders).where(eq(productionFolders.quoteId,file.quoteId));if(!folder)throw new AppError(503,'Chưa xác minh được thư mục Drive.');const r=await c.env.productionDrive.read(file.driveId,{parent:folder.driveId,bytes:file.bytes,sha256:file.sha256,md5:file.md5});return new Response(r.body,{headers:{'content-type':'application/octet-stream','content-disposition':`attachment; filename*=UTF-8''${encodeURIComponent(file.name).replace(/['()*]/g,c=>'%'+c.charCodeAt(0).toString(16).toUpperCase())}`,'cache-control':'private, no-store','x-content-type-options':'nosniff'}});
 },'business');
}
