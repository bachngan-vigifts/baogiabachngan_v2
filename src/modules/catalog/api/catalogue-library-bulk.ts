import {and,asc,eq,inArray} from 'drizzle-orm';
import {z} from 'zod';
import type {Router} from '../../../core/http/router.ts';
import {json,readJson} from '../../../core/http/router.ts';
import {AppError} from '../../../core/errors.ts';
import {auditLogs} from '../../../core/db/schema.ts';
import type {StaffEnv,SessionState} from '../../staff/api/auth-routes.ts';
import {sha256Hex} from '../../staff/domain/session.ts';
import {catalogueLibrary as lib,catalogueLibraryCommands as commands} from '../catalogue-library-schema.ts';
import {cleanCatalogueProduct} from '../domain/catalogue-data.ts';
import {stableJson} from '../domain/catalogue-quote.ts';
import {catalogueFields,catalogueDto} from './catalogue-library.ts';

const patchSchema=z.object({priceBand:z.number().int().min(0).max(7).refine(n=>n!==5).nullable().optional(),category:z.string().trim().min(1).max(100).optional(),collection:z.string().trim().max(100).optional(),pattern:z.string().trim().max(100).optional(),color:z.string().trim().max(100).optional(),regular:z.number().finite().min(0).max(1e10).optional(),priceOnRequest:z.boolean().optional(),override:z.number().finite().min(0).max(1e10).nullable().optional(),discount:z.number().finite().min(0).max(100).optional(),fee:z.number().finite().min(0).max(1e8).optional()}).strict().refine(p=>!(p.priceOnRequest===true&&p.regular!==undefined&&p.regular!==0)&&!(p.regular===0&&p.priceOnRequest!==true),'Nhập giá lớn hơn 0 hoặc chọn Liên hệ.');
const bodySchema=z.object({clientKey:z.string().regex(/^[\w-]{16,100}$/),action:z.enum(['edit','archive','restore']),items:z.array(z.object({id:z.string().regex(/^[a-f0-9]{64}$/),revision:z.number().int().positive()}).strict()).min(1).max(100),patch:patchSchema.optional()}).strict();
export function registerCatalogueLibraryBulk(router:Router<StaffEnv>){
 router.post('/catalogue-library/bulk',async c=>{
  const parsed=bodySchema.safeParse(await readJson(c.req,40_000));if(!parsed.success)throw new AppError(400,'Chọn từ 1–100 sản phẩm và kiểm tra thông tin sửa.');const b=parsed.data;
  if(new Set(b.items.map(i=>i.id)).size!==b.items.length)throw new AppError(400,'Danh sách chọn bị trùng mã.');
  if(b.action==='edit'?!b.patch||!Object.keys(b.patch).length:!!b.patch)throw new AppError(400,'Chọn rõ trường cần sửa; xoá/khôi phục không kèm sửa thông tin.');
  b.items.sort((a,b)=>a.id.localeCompare(b.id));const hash=sha256Hex(stableJson({action:b.action,items:b.items,patch:b.patch})),who=(c.state.session as SessionState).member.id;
  return json(await c.env.db.transaction(async tx=>{
   const inserted=await tx.insert(commands).values({memberId:who,clientKey:b.clientKey,payloadHash:hash,createdAt:new Date().toISOString()}).onConflictDoNothing().returning();
   if(!inserted.length){const [prior]=await tx.select().from(commands).where(and(eq(commands.memberId,who),eq(commands.clientKey,b.clientKey))).for('update');if(prior?.payloadHash!==hash)throw new AppError(409,'Cùng mã thao tác nhưng khác nội dung.','COMMAND_CONFLICT');if(!prior.result)throw new AppError(503,'Chưa rõ kết quả; thử lại cùng yêu cầu.');return{...JSON.parse(prior.result),replayed:true};}
   // Every operation takes row locks in the same order and checks the whole set before writing.
   const rows=await tx.select().from(lib).where(inArray(lib.id,b.items.map(i=>i.id))).orderBy(asc(lib.id)).for('update');
   if(rows.length!==b.items.length)throw new AppError(409,'Một số sản phẩm không còn tồn tại. Tải lại danh sách.');const expected=new Map(b.items.map(i=>[i.id,i.revision]));
   for(const row of rows)if(row.revision!==expected.get(row.id)||(b.action==='restore'?!row.deletedAt:!!row.deletedAt))throw new AppError(409,`Sản phẩm ${row.sku||row.name} vừa thay đổi. Chưa áp dụng thao tác cho bất kỳ sản phẩm nào; làm mới và chọn lại.`, 'CATALOGUE_BULK_CONFLICT');
   const at=new Date().toISOString(),products=[];
   for(const row of rows){const before=JSON.parse(row.data),after=b.action==='edit'?cleanCatalogueProduct({...before,...b.patch,...(b.patch?.priceOnRequest===true?{regular:0,fromPrice:false}:b.patch?.regular!==undefined?{priceOnRequest:false}:{})}):before;
    const [next]=await tx.update(lib).set({...catalogueFields(after),deletedAt:b.action==='archive'?at:null,deletedBy:b.action==='archive'?who:null,revision:row.revision+1,lastKey:null,lastHash:null,lastActor:null,updatedAt:at,updatedBy:who}).where(eq(lib.id,row.id)).returning();
    products.push(catalogueDto(next!));await tx.insert(auditLogs).values({id:crypto.randomUUID(),actorId:who,module:'catalog',action:'catalogue-library-bulk-'+b.action,entityType:'catalogue-library',entityId:row.id,data:JSON.stringify({before,after,revision:next!.revision,clientKey:b.clientKey}),createdAt:at});
   }
   const result={ok:true,action:b.action,products,count:products.length};await tx.update(commands).set({result:JSON.stringify(result)}).where(and(eq(commands.memberId,who),eq(commands.clientKey,b.clientKey)));return result;
  }));
 },'business');
}