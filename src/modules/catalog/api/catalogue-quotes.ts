import { and, asc, count, desc, eq, isNull, sql } from 'drizzle-orm';
import type { Router, RouteContext } from '../../../core/http/router.ts';
import { json, readJson } from '../../../core/http/router.ts';
import { AppError } from '../../../core/errors.ts';
import { auditLogs } from '../../../core/db/schema.ts';
import { fold } from '../../../core/text/fold.ts';
import type { StaffEnv, SessionState } from '../../staff/api/auth-routes.ts';
import { sha256Hex } from '../../staff/domain/session.ts';
import { catalogueQuotes as quotes, catalogueQuoteCommands as commands } from '../catalogue-library-schema.ts';
import { cleanCatalogueQuote, stableJson } from '../domain/catalogue-quote.ts';
type Ctx=RouteContext<StaffEnv>;type Tx=Parameters<Parameters<StaffEnv['db']['transaction']>[0]>[0];const actor=(c:Ctx)=>(c.state.session as SessionState).member;
const validId=(id:unknown):id is string=>typeof id==='string'&&/^[A-Za-z0-9_-]{8,80}$/.test(id);
const summary=(q:typeof quotes.$inferSelect,c:Ctx)=>({id:q.id,quoteNo:q.quoteNo,title:q.title,customer:q.customer,productCount:q.productCount,revision:q.revision,createdBy:q.createdBy,updatedBy:q.updatedBy,updatedAt:q.updatedAt,canDelete:actor(c).role==='manager'||q.createdBy===actor(c).id});
async function command(c:Ctx,id:string,b:Record<string,unknown>,action:string,content:unknown,apply:(tx:Tx)=>Promise<Record<string,unknown>>){
 const who=actor(c).id,key=b.clientKey;if(typeof key!=='string'||!/^[\w-]{16,100}$/.test(key))throw new AppError(400,'Thiếu mã thao tác lưu báo giá.');const hash=sha256Hex(stableJson({id,action,revision:action==='create'?null:b.revision,content}));
 return c.env.db.transaction(async tx=>{
  const inserted=await tx.insert(commands).values({memberId:who,clientKey:key,quoteId:id,payloadHash:hash,createdAt:new Date().toISOString()}).onConflictDoNothing().returning({key:commands.clientKey});
  if(!inserted.length){const [old]=await tx.select().from(commands).where(and(eq(commands.memberId,who),eq(commands.clientKey,key))).for('update');if(!old||old.quoteId!==id||old.payloadHash!==hash)throw new AppError(409,'Cùng mã thao tác nhưng khác nội dung báo giá.','COMMAND_CONFLICT');if(!old.result)throw new AppError(503,'Lần lưu chưa rõ kết quả, cần đối soát.');const [current]=await tx.select({revision:quotes.revision,deletedAt:quotes.deletedAt}).from(quotes).where(eq(quotes.id,id));return{...JSON.parse(old.result),replayed:true,currentRevision:current?.revision,deleted:!!current?.deletedAt};}
  const result=await apply(tx);await tx.update(commands).set({result:JSON.stringify(result)}).where(and(eq(commands.memberId,who),eq(commands.clientKey,key)));return result;
 });
}
export function registerCatalogueQuotes(router:Router<StaffEnv>){
 router.get('/catalogue-quotes',async c=>{const q=fold(c.url.searchParams.get('q')||'').slice(0,100),offset=Number(c.url.searchParams.get('offset')||0);if(!Number.isSafeInteger(offset)||offset<0||offset>1e6)throw new AppError(400,'Phân trang chưa hợp lệ.');const where=and(isNull(quotes.deletedAt),...q.split(' ').filter(Boolean).slice(0,10).map(word=>sql`${quotes.search} like ${'%'+word.replace(/[\\%_]/g,m=>'\\'+m)+'%'}`));
  const [[total],rows]=await Promise.all([c.env.db.select({n:count()}).from(quotes).where(where),c.env.db.select({id:quotes.id,quoteNo:quotes.quoteNo,title:quotes.title,customer:quotes.customer,productCount:quotes.productCount,revision:quotes.revision,createdBy:quotes.createdBy,updatedBy:quotes.updatedBy,updatedAt:quotes.updatedAt}).from(quotes).where(where).orderBy(desc(quotes.updatedAt),asc(quotes.id)).limit(30).offset(offset)]);return json({memberId:actor(c).id,quotes:rows.map(q=>summary(q as typeof quotes.$inferSelect,c)),total:total!.n,offset,limit:30});
 },'business');
 router.get('/catalogue-quotes/:id',async c=>{const [row]=await c.env.db.select().from(quotes).where(and(eq(quotes.id,c.params.id!),isNull(quotes.deletedAt)));if(!row)throw new AppError(404,'Báo giá dùng chung không còn trong danh sách.');return json({...summary(row,c),state:JSON.parse(row.data)});},'business');
 router.post('/catalogue-quotes',async c=>{
  const b=await readJson(c.req,2_000_000);if(!validId(b.id))throw new AppError(400,'Mã bản báo giá chưa hợp lệ.');const state=cleanCatalogueQuote(b.state),id=b.id;
  return json(await command(c,id,b,'create',state,async tx=>{
   const at=new Date().toISOString(),data=stableJson(state),who=actor(c).id;const [row]=await tx.insert(quotes).values({id,quoteNo:state.meta.quoteNo!,title:state.meta.title!,customer:state.meta.customer!,productCount:state.selected.length,search:fold([state.meta.quoteNo,state.meta.title,state.meta.customer,...state.products.map(p=>p.sku+' '+p.name)].join(' ')),data,createdBy:who,updatedBy:who,createdAt:at,updatedAt:at}).onConflictDoNothing().returning();
   if(!row){const [old]=await tx.select().from(quotes).where(eq(quotes.id,id)).for('update');if(!old||old.deletedAt||old.data!==data)throw new AppError(409,'Báo giá đã có phiên bản khác trên máy chủ. Mở bản chung để đối chiếu, không tạo thêm bản mới.','CATALOGUE_QUOTE_CONFLICT');return{id,revision:old.revision,currentRevision:old.revision,updatedAt:old.updatedAt,reused:true};}
   await tx.insert(auditLogs).values({id:crypto.randomUUID(),actorId:who,module:'catalog',action:'catalogue-quote-create',entityType:'catalogue-quote',entityId:id,data:JSON.stringify({quoteNo:row.quoteNo,revision:1,hash:sha256Hex(data)}),createdAt:at});return{id,revision:1,currentRevision:1,updatedAt:at};
  }));
 },'business');
 router.put('/catalogue-quotes/:id',async c=>{
  const b=await readJson(c.req,2_000_000),state=cleanCatalogueQuote(b.state),id=c.params.id!;if(!Number.isSafeInteger(b.revision))throw new AppError(400,'Thiếu phiên bản báo giá đã mở.');
  return json(await command(c,id,b,'update',state,async tx=>{const [old]=await tx.select().from(quotes).where(eq(quotes.id,id)).for('update');if(!old||old.deletedAt)throw new AppError(404,'Báo giá không còn trong danh sách.');if(old.revision!==b.revision)throw new AppError(409,'Nhân viên khác vừa sửa báo giá. Bản anh/chị đang nhập vẫn trên máy; cần mở bản mới để đối chiếu trước khi lưu.','CATALOGUE_QUOTE_CONFLICT');
   const data=stableJson(state),at=new Date().toISOString();const [next]=await tx.update(quotes).set({quoteNo:state.meta.quoteNo!,title:state.meta.title!,customer:state.meta.customer!,productCount:state.selected.length,search:fold([state.meta.quoteNo,state.meta.title,state.meta.customer,...state.products.map(p=>p.sku+' '+p.name)].join(' ')),data,revision:old.revision+1,updatedBy:actor(c).id,updatedAt:at}).where(eq(quotes.id,id)).returning();
   await tx.insert(auditLogs).values({id:crypto.randomUUID(),actorId:actor(c).id,module:'catalog',action:'catalogue-quote-update',entityType:'catalogue-quote',entityId:id,data:JSON.stringify({revision:next!.revision,beforeHash:sha256Hex(old.data),afterHash:sha256Hex(data)}),createdAt:at});return{id,revision:next!.revision,currentRevision:next!.revision,updatedAt:at};}));
 },'business');
 router.post('/catalogue-quotes/:id/archive',async c=>{const b=await readJson(c.req,2048),id=c.params.id!;return json(await command(c,id,b,'archive',null,async tx=>{const [old]=await tx.select().from(quotes).where(eq(quotes.id,id)).for('update');if(!old||old.deletedAt)throw new AppError(404,'Báo giá không còn trong danh sách.');if(actor(c).role!=='manager'&&old.createdBy!==actor(c).id)throw new AppError(403,'Chỉ người tạo hoặc Manager được xoá báo giá chung.');if(old.revision!==b.revision)throw new AppError(409,'Báo giá vừa thay đổi. Tải lại trước khi xoá.');const at=new Date().toISOString();await tx.update(quotes).set({deletedAt:at,deletedBy:actor(c).id,revision:old.revision+1,updatedBy:actor(c).id,updatedAt:at}).where(eq(quotes.id,id));await tx.insert(auditLogs).values({id:crypto.randomUUID(),actorId:actor(c).id,module:'catalog',action:'catalogue-quote-archive',entityType:'catalogue-quote',entityId:id,data:JSON.stringify({revision:old.revision+1}),createdAt:at});return{id,revision:old.revision+1,currentRevision:old.revision+1,deleted:true};}));},'business');
}
