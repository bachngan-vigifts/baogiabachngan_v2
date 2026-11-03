import {and,asc,eq,sql} from 'drizzle-orm';
import type {AnyDb} from '../../../core/db/client.ts';
import {AppError} from '../../../core/errors.ts';
import {productOrder} from '../../catalog/api/product-query.ts';
import {foldSql} from '../../../core/text/fold.ts';
import {products,productPrices} from '../../catalog/schema.ts';
import {hiddenStockWarehouses} from '../../catalog/api/stock-source.ts';
import {stockBalances} from '../../inventory/schema.ts';
import {ledgerWarehouses} from './pos-stock.ts';
import {reservedBySku,type PosDb,type PosMember} from './pos-store.ts';
import {posCatalogFamily,MINH_LONG_CATALOG_PATTERN,LOCK_CATALOG_PATTERN} from '../domain/pos-catalog-brand.ts';

/** Shared with scan/catalog: preload only codes that identify exactly one product. */
export const posScanCodes=sql<string[]>`ARRAY(
 SELECT codes.code FROM (SELECT ${products.sku} AS code UNION SELECT b.barcode FROM product_barcodes b WHERE b.sku=${products.sku}) codes
 WHERE NOT EXISTS (SELECT 1 FROM product_barcodes b WHERE b.barcode=codes.code AND b.sku<>${products.sku})
 AND NOT EXISTS (SELECT 1 FROM products other WHERE other.sku=codes.code AND other.sku<>${products.sku})
)`;
export function posBrandScope(registerName:string){
 const family=posCatalogFamily(registerName);
 return family?sql`${foldSql(products.brand,products.name)} !~ ${family==='lock'?MINH_LONG_CATALOG_PATTERN:LOCK_CATALOG_PATTERN}`:undefined;
}
/** Compact session-only stock preload. No supplier/incoming stock, no stock writes. */
async function readPosStockSnapshot(db:PosDb,member:PosMember,register:{id:string;name:string;warehouseId:string;pricePolicyId:string;secondPricePolicyId:string},policy=register.pricePolicyId,includeCatalog=false){
 if(![register.pricePolicyId,register.secondPricePolicyId].includes(policy))throw new AppError(400,'Bảng giá không hợp lệ.');
 const startedAt=new Date().toISOString();
 const [hidden,opened,rows]=await Promise.all([
  hiddenStockWarehouses(db,member),ledgerWarehouses(db),
  db.select({sku:products.sku,price:productPrices.price,onHand:stockBalances.qty,scanCodes:posScanCodes,...(includeCatalog?{name:products.name,brand:products.brand,unit:products.unit,imageUrl:products.imageUrl,pattern:products.pattern}:{})}).from(products)
   .innerJoin(productPrices,and(eq(productPrices.sku,products.sku),eq(productPrices.policyId,policy)))
   .leftJoin(stockBalances,and(eq(stockBalances.sku,products.sku),eq(stockBalances.warehouseId,register.warehouseId)))
   .where(and(eq(products.active,true),eq(products.approvalStatus,'approved'),sql`${productPrices.price} is not null`,posBrandScope(register.name))).orderBy(...(includeCatalog?productOrder(null):[asc(products.sku)])).limit(20001),
 ]);
 if(hidden.has(register.warehouseId))throw new AppError(403,'Bạn không được xem tồn kho riêng của quầy này.');
 // Never silently preload a partial catalog; large installations keep the paged path.
 if(rows.length>20000)return null;
 const held=rows.length?await reservedBySku(db,rows.map(r=>r.sku),register.warehouseId):new Map<string,number>();
 // Metadata comes from the same authorized price/stock scan, avoiding a second huge IN query.
 const catalog=includeCatalog?rows.map(({sku,name,brand,unit,imageUrl,pattern})=>({sku,name,brand,unit,imageUrl,pattern})):undefined;
 return {version:1,catalog,registerId:register.id,warehouseId:register.warehouseId,pricePolicyId:policy,asOf:startedAt,warehouseReady:opened.includes(register.warehouseId),
  // sku, price, physical ledger quantity, reserved quantity, unambiguous scan codes
  rows:rows.map(p=>[p.sku,p.price,p.onHand??0,held.get(p.sku)??0,p.scanCodes] as const)};
}

export function posStockSnapshot(db:AnyDb,member:PosMember,register:Parameters<typeof readPosStockSnapshot>[2],policy?:string,includeCatalog=false){
 return db.transaction(tx=>readPosStockSnapshot(tx,member,register,policy,includeCatalog),{isolationLevel:'repeatable read',accessMode:'read only'});
}
