import { z } from 'zod';
import { and, or, asc, count, desc, eq, inArray, isNull, isNotNull, sql, type SQL } from 'drizzle-orm';
import type { Router, RouteContext } from '../../../core/http/router.ts';
import { json, readJson } from '../../../core/http/router.ts';
import { AppError } from '../../../core/errors.ts';
import { fold } from '../../../core/text/fold.ts';
import { auditLogs } from '../../../core/db/schema.ts';
import type { StaffEnv, SessionState } from '../../staff/api/auth-routes.ts';
import { sha256Hex } from '../../staff/domain/session.ts';
import { catalogueLibrary as lib } from '../catalogue-library-schema.ts';
import { cleanCatalogueProduct as clean } from '../domain/catalogue-data.ts';
import { catalogueStockFacts } from './catalogue-stock.ts';
type Ctx=RouteContext<StaffEnv>;const actor=(c:Ctx)=>(c.state.session as SessionState).member;
export const catalogueFields=(p:ReturnType<typeof clean>)=>({name:p.name,sku:p.sku,brand:p.brand,category:p.category,collection:p.collection,pattern:p.pattern,color:p.color,search:fold([p.name,p.sku,p.brand,p.category,p.collection,p.pattern,p.color].join(' ')),data:JSON.stringify(p)});
export const catalogueDto=(r:typeof lib.$inferSelect)=>({id:r.id,revision:r.revision,product:JSON.parse(r.data) as ReturnType<typeof clean>,updatedAt:r.updatedAt,updatedBy:r.updatedBy,archived:!!r.deletedAt});
const budgetSchema=z.array(z.tuple([z.number().int().min(0).max(1e10),z.number().int().min(0).max(1e10).nullable()]).refine(([min,max])=>max===null||max>=min)).min(1).max(8);
const pricingSchema=z.object({lockDiscount:z.coerce.number().finite().min(0).max(100),minhDiscount:z.coerce.number().finite().min(0).max(100),fee:z.coerce.number().finite().min(0).max(1e8)});
const filterKeys=['brand','category','collection','pattern','color'] as const;
export function registerCatalogueLibrary(router:Router<StaffEnv>){
 router.get('/catalogue-library/stock',async c=>{const skus=[...new Set((c.url.searchParams.get('skus')||'').split(',').map(s=>s.trim()).filter(Boolean))];if(skus.length>100||skus.some(s=>s.length>100))throw new AppError(400,'Chỉ đọc tối đa 100 mã mỗi lượt.');return json({stock:await catalogueStockFacts(c.env.db,actor(c),skus)});},'business');
 router.get('/catalogue-library',async c=>{
  const q=(c.url.searchParams.get('q')||'').trim().slice(0,100),offset=Number(c.url.searchParams.get('offset')||0),limit=Math.min(60,Number(c.url.searchParams.get('limit')||60));
  if(!Number.isSafeInteger(offset)||offset<0||offset>1e6||!Number.isSafeInteger(limit)||limit<1)throw new AppError(400,'Phân trang chưa hợp lệ.');
  const archived=c.url.searchParams.get('archived')==='1',visibility=archived?isNotNull(lib.deletedAt):isNull(lib.deletedAt);
  let defaultFilters:{brand:string;category:string}|null=null;
  if(c.url.searchParams.get('defaultCategory')==='1'&&!c.url.searchParams.get('category')){const [first]=await c.env.db.select({brand:lib.brand,category:lib.category}).from(lib).where(and(visibility,...(c.url.searchParams.get('brand')?[eq(lib.brand,c.url.searchParams.get('brand')!)]:[]))).orderBy(asc(lib.brand),asc(lib.category)).limit(1);if(first){defaultFilters=first;c.url.searchParams.set('brand',first.brand);c.url.searchParams.set('category',first.category);}}
  const filters:SQL[]=[visibility];for(const key of filterKeys){const v=c.url.searchParams.get(key);if(v){if(v.length>100)throw new AppError(400,'Bộ lọc quá dài.');filters.push(eq(lib[key],v));}}
  for(const word of fold(q).split(' ').filter(Boolean).slice(0,10))filters.push(sql`${lib.search} like ${'%'+word.replace(/[\\%_]/g,m=>'\\'+m)+'%'}`);
  const budgetRaw=c.url.searchParams.get('budgets');if(budgetRaw){
   let raw:unknown;try{if(budgetRaw.length>1000)throw Error();raw=JSON.parse(budgetRaw);}catch{throw new AppError(400,'Khoảng ngân sách chưa hợp lệ.');}
   const parsed=budgetSchema.safeParse(raw),pricing=pricingSchema.safeParse({lockDiscount:c.url.searchParams.get('lockDiscount')??40,minhDiscount:c.url.searchParams.get('minhDiscount')??10,fee:c.url.searchParams.get('fee')??15000});
   if(!parsed.success||!pricing.success)throw new AppError(400,'Kiểm tra khoảng ngân sách và công thức giá.');
   const p=pricing.data,source=sql`(${lib.data}::jsonb)`,amount=sql`round(coalesce((${source}->>'override')::numeric, (${source}->>'regular')::numeric*(1-coalesce((${source}->>'discount')::numeric,case when ${lib.brand}='LocknLock' then ${p.lockDiscount}::numeric when ${lib.brand}='Minh Long' then ${p.minhDiscount}::numeric else 0 end)/100)+coalesce((${source}->>'fee')::numeric,${p.fee}::numeric)))`;
   filters.push(sql`coalesce((${source}->>'priceOnRequest')::boolean,false)=false`,or(...parsed.data.map(([min,max])=>max===null?sql`${amount}>=${min}`:sql`${amount}>=${min} and ${amount}<=${max}`))!);
  }
  const where=and(...filters),db=c.env.db;
  const [[total],rows,facets]=await Promise.all([db.select({n:count()}).from(lib).where(where),db.select().from(lib).where(where).orderBy(desc(lib.updatedAt),asc(lib.id)).limit(limit).offset(offset),c.url.searchParams.get('facets')==='0'?Promise.resolve(null):Promise.all(filterKeys.map(async (key,index)=>[key,(await db.selectDistinct({value:lib[key]}).from(lib).where(and(visibility,sql`${lib[key]}<>''`,...filterKeys.slice(0,index).flatMap(parent=>{const value=c.url.searchParams.get(parent);return value?[eq(lib[parent],value)]:[]}))).orderBy(asc(lib[key])).limit(300)).map(r=>r.value)] as const))]);
  let stock:Awaited<ReturnType<typeof catalogueStockFacts>>|null=null;let stockError='';try{if(c.url.searchParams.get('includeStock')!=='0'&&!archived)stock=await catalogueStockFacts(db,actor(c),rows.map(r=>r.sku).filter(Boolean));}catch{stockError='Chưa đọc được tồn CRM. Dữ liệu chưa được xem là hết hàng.';}
  return json({defaultFilters,memberId:actor(c).id,products:rows.map(catalogueDto),total:total!.n,offset,limit,...(facets?{facets:Object.fromEntries(facets)}:{}),stock,stockError});
 },'business');
 router.post('/catalogue-library',async c=>{
  const body=await readJson(c.req,250_000);if(!Array.isArray(body.products)||body.products.length<1||body.products.length>25)throw new AppError(400,'Chia sản phẩm thành lô tối đa 25 mã.');
  const errors:{clientId:string|null;error:string}[]=[];const items=body.products.flatMap((raw:unknown)=>{try{const row=raw as Record<string,unknown>;if(!row||typeof row.clientId!=='string'||row.clientId.length<1||row.clientId.length>100)throw new AppError(400,'Thiếu mã sản phẩm trên máy.');const p=clean(row.product);const origin=p.url?new URL(p.url).origin:fold(p.brand),identity=p.sku?'sku:'+origin+':'+p.sku.toUpperCase():p.url?'url:'+p.url:'manual:'+row.clientId;return[{clientId:row.clientId,p,key:sha256Hex(identity)}];}catch(e){errors.push({clientId:raw&&typeof raw==='object'&&typeof(raw as Record<string,unknown>).clientId==='string'?String((raw as Record<string,unknown>).clientId):null,error:e instanceof Error?e.message:'Sản phẩm chưa hợp lệ.'});return[];}});
  if(!items.length)return json({products:[],errors});
  const unique=[...new Map(items.map(i=>[i.key,i])).values()],now=new Date().toISOString(),who=actor(c).id;
  const saved=await c.env.db.transaction(async tx=>{
   const inserted=await tx.insert(lib).values(unique.map(i=>({id:i.key,sourceKey:i.key,...catalogueFields(i.p),createdBy:who,updatedBy:who,createdAt:now,updatedAt:now}))).onConflictDoNothing().returning();
   if(inserted.length)await tx.insert(auditLogs).values(inserted.map(r=>({id:crypto.randomUUID(),actorId:who,module:'catalog',action:'catalogue-library-create',entityType:'catalogue-library',entityId:r.id,data:JSON.stringify({product:JSON.parse(r.data)}),createdAt:now})));
   return tx.select().from(lib).where(inArray(lib.sourceKey,unique.map(i=>i.key)));
  });const byKey=new Map(saved.map(r=>[r.sourceKey,r]));return json({products:items.flatMap(i=>{const row=byKey.get(i.key)!;if(row.deletedAt){errors.push({clientId:i.clientId,error:'Mã đã xoá khỏi thư viện; mở mục Đã xoá để khôi phục.'});return[];}return[{clientId:i.clientId,...catalogueDto(row)}];}),errors});
 },'business');
 router.put('/catalogue-library/:id',async c=>{
  const b=await readJson(c.req,18_000),p=clean(b.product),who=actor(c).id,key=typeof b.clientKey==='string'?b.clientKey:'';
  if(!/^[\w-]{16,100}$/.test(key)||!Number.isSafeInteger(b.revision))throw new AppError(400,'Tải lại phiên bản sản phẩm trước khi lưu.');
  const hash=sha256Hex(JSON.stringify(p));const saved=await c.env.db.transaction(async tx=>{
   const [old]=await tx.select().from(lib).where(eq(lib.id,c.params.id!)).for('update');if(!old||old.deletedAt)throw new AppError(404,'Sản phẩm không còn trong thư viện đang dùng.');
   if(old.lastKey===key&&old.lastActor===who){if(old.lastHash!==hash)throw new AppError(409,'Cùng mã thao tác nhưng khác nội dung.','COMMAND_CONFLICT');return old;}
   if(old.revision!==b.revision)throw new AppError(409,'Người khác vừa sửa sản phẩm. Tải lại để đối chiếu; nội dung anh/chị nhập vẫn giữ trên màn hình.','CATALOGUE_LIBRARY_CONFLICT');
   const previous=JSON.parse(old.data) as ReturnType<typeof clean>;if(p.sku!==previous.sku||p.url!==previous.url||p.brand!==previous.brand)throw new AppError(400,'Không đổi SKU, thương hiệu hoặc link nguồn của bản ghi chung.');
   const [next]=await tx.update(lib).set({...catalogueFields(p),revision:old.revision+1,lastKey:key,lastHash:hash,lastActor:who,updatedBy:who,updatedAt:new Date().toISOString()}).where(eq(lib.id,old.id)).returning();
   await tx.insert(auditLogs).values({id:crypto.randomUUID(),actorId:who,module:'catalog',action:'catalogue-library-update',entityType:'catalogue-library',entityId:old.id,data:JSON.stringify({before:previous,after:p,revision:next!.revision}),createdAt:next!.updatedAt});return next!;
  });return json(catalogueDto(saved));
 },'business');
}