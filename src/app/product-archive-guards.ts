import {and,eq} from 'drizzle-orm';
import type {StockReadDb} from '../modules/catalog/api/stock-source.ts';
import type {StaffEnv} from '../modules/staff/api/auth-routes.ts';
import {outstandingLines} from '../modules/suppliers/api/incoming-stock.ts';
import {posPromotionPrograms} from '../modules/sales/promotion-schema.ts';
export async function productArchiveBlockReason(db:StockReadDb,sku:string){
 if((await outstandingLines(db as StaffEnv['db'],[sku])).length)return 'Sản phẩm còn hàng đang về. Xử lý hết trước khi xoá khỏi danh mục.';
 if((await db.select({id:posPromotionPrograms.registerId}).from(posPromotionPrograms).where(and(eq(posPromotionPrograms.giftSku,sku),eq(posPromotionPrograms.enabled,true))).limit(1)).length)return 'Sản phẩm đang là quà của chương trình khuyến mãi đang bật. Đổi quà hoặc tắt chương trình trước khi xoá.';
 return null;
}
