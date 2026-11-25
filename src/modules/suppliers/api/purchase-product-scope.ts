import {and,inArray,sql,type SQLWrapper} from 'drizzle-orm';
import {foldSql} from '../../../core/text/fold.ts';
import {AppError} from '../../../core/errors.ts';
import {products} from '../../catalog/schema.ts';
import {isCounterPurchaser} from '../domain/purchase-access.ts';
import type {Db,Member} from './purchase-store.ts';

// Positive catalogue-brand allowlist. Neither the product name nor client-supplied brand grants access.
export function counterPurchaseBrand(brand:SQLWrapper){
 return sql`regexp_replace(${foldSql(brand)}, '[^a-z0-9]', '', 'g') in ('minhlong','minhlongi','minhlonglys','lys','healthycook','locknlock','locklock','lock')`;
}
export const purchaseProductScope=(m:Member)=>isCounterPurchaser(m)?counterPurchaseBrand(products.brand):sql`true`;
export async function scopedPurchaseSkus(db:Db,m:Member,skus:readonly string[]){
 if(!isCounterPurchaser(m))return new Set(skus.map(s=>s.toLowerCase()));
 if(!skus.length)return new Set<string>();
 const rows=await db.select({sku:products.sku}).from(products).where(and(inArray(sql`lower(${products.sku})`,skus.map(s=>s.toLowerCase())),purchaseProductScope(m)));
 return new Set(rows.map(r=>r.sku.toLowerCase()));
}
export async function assertPurchaseProducts(db:Db,m:Member,skus:readonly string[]){
 if(!isCounterPurchaser(m))return;
 const allowed=await scopedPurchaseSkus(db,m,skus);
 if(skus.some(s=>!allowed.has(s.toLowerCase())))throw new AppError(403,'NVBH chỉ được lập đơn sản phẩm Minh Long, Lys, Healthy Cook và Lock&Lock có trong danh mục.');
}
