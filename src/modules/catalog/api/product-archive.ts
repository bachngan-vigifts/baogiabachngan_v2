import {and,desc,eq,isNotNull,sql} from 'drizzle-orm';
import type {Router,RouteContext} from '../../../core/http/router.ts';
import {json,readJson} from '../../../core/http/router.ts';
import {AppError} from '../../../core/errors.ts';
import {auditLogs} from '../../../core/db/schema.ts';
import type {StaffEnv,SessionState} from '../../staff/api/auth-routes.ts';
import {products} from '../schema.ts';
import {catalogStockHooks,readCatalogStock} from './stock-source.ts';
const manager=(c:RouteContext<StaffEnv>)=>{const m=(c.state.session as SessionState).member;if(m.role!=='manager')throw new AppError(403,'Chỉ Manager được xoá hoặc khôi phục sản phẩm.');return m;};
export function registerProductArchiveRoutes(router:Router<StaffEnv>){
 router.get('/archived-products',async c=>{
  manager(c);const q=(c.url.searchParams.get('q')||'').trim(),offset=Number(c.url.searchParams.get('offset')||0);
  if(q.length>200||!Number.isSafeInteger(offset)||offset<0||offset>1000000)throw new AppError(400,'Bộ lọc không hợp lệ.');
  const pattern='%'+q.replace(/[\\%_]/g,'\\$&')+'%';
  const rows=await c.env.db.select({sku:products.sku,name:products.name,archivedAt:products.archivedAt,updatedAt:products.updatedAt}).from(products).where(and(isNotNull(products.archivedAt),q?sql`(${products.sku} ilike ${pattern} escape '\\' or ${products.name} ilike ${pattern} escape '\\')`:undefined)).orderBy(desc(products.archivedAt),desc(products.sku)).limit(26).offset(offset);
  return json({products:rows.slice(0,25),nextOffset:rows.length>25?offset+25:null});
 },'business');
 for(const action of ['archive','restore'] as const)router.post('/products/:sku/'+action,async c=>{
  const m=manager(c),b=await readJson(c.req,2048),sku=c.params.sku!;
  if(typeof b.expectedUpdatedAt!=='string'||!b.expectedUpdatedAt)throw new AppError(400,'Tải lại sản phẩm trước khi thao tác.');
  await c.env.db.transaction(async tx=>{
   // Same ordering as warehouse operations; protect the zero-stock/hold check while hiding the SKU.
   await tx.execute(sql`select pg_advisory_xact_lock(hashtext('stock_holds'))`);
   await tx.execute(sql`select pg_advisory_xact_lock(hashtext('stock_ledger_opening'))`);
   const [p]=await tx.select().from(products).where(eq(products.sku,sku)).for('update');
   if(!p)throw new AppError(404,'Không tìm thấy sản phẩm.');
   if(p.updatedAt!==b.expectedUpdatedAt)throw new AppError(409,'Sản phẩm vừa thay đổi. Tải lại trước khi thao tác.','PRODUCT_CHANGED');
   if(p.approvalStatus!=='approved')throw new AppError(409,'Sản phẩm chờ duyệt dùng chức năng Từ chối tại danh sách chờ duyệt.');
   if(action==='archive'&&!p.archivedAt){
    const reason=await catalogStockHooks.archiveBlockReason?.(tx,sku);if(reason)throw new AppError(409,reason,'PRODUCT_IN_USE');
    const stock=await readCatalogStock(tx,[sku]),held=await catalogStockHooks.held?.(tx,m,[sku]);
    if(stock.some(s=>s.quantity!==0)||Number(held?.get(sku)||0)!==0)throw new AppError(409,'Sản phẩm còn tồn, hàng đang về hoặc đang giữ. Xử lý hết trước khi xoá khỏi danh mục.','PRODUCT_HAS_STOCK');
   }
   if((action==='archive')===!!p.archivedAt)return;
   const at=new Date(Math.max(Date.now(),Date.parse(p.updatedAt)+1)).toISOString();
   await tx.update(products).set({active:action==='restore',archivedAt:action==='archive'?at:null,archivedBy:action==='archive'?m.id:null,updatedAt:at}).where(eq(products.sku,sku));
   await tx.insert(auditLogs).values({id:crypto.randomUUID(),actorId:m.id,module:'catalog',action:'product-'+action,entityType:'products',entityId:sku,data:JSON.stringify({before:{active:p.active,archivedAt:p.archivedAt},after:{active:action==='restore',archivedAt:action==='archive'?at:null}}),createdAt:at});
  });return json({ok:true,sku});
 },'business');
}
