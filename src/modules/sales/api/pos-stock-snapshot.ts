import {and,asc,eq,ne,sql} from 'drizzle-orm';
import {alias} from 'drizzle-orm/pg-core';
import type {AnyDb} from '../../../core/db/client.ts';
import {AppError} from '../../../core/errors.ts';
import {productOrder} from '../../catalog/api/product-query.ts';
import {foldSql} from '../../../core/text/fold.ts';
import {products,productPrices,productBarcodes} from '../../catalog/schema.ts';
import {hiddenStockWarehouses} from '../../catalog/api/stock-source.ts';
import {stockBalances} from '../../inventory/schema.ts';
import {rememberLedgerWarehouses} from './pos-stock.ts';
import {reservedBySku,type PosDb,type PosMember} from './pos-store.ts';
import {posCatalogFamily,MINH_LONG_CATALOG_PATTERN,LOCK_CATALOG_PATTERN} from '../domain/pos-catalog-brand.ts';

/** Shared with scan/catalog: preload only codes that identify exactly one product. */
export const posScanCodes=sql<string[]>`ARRAY(
 SELECT codes.code FROM (SELECT ${products.sku} AS code UNION SELECT b.barcode FROM product_barcodes b WHERE b.sku=${products.sku}) codes
 WHERE NOT EXISTS (SELECT 1 FROM product_barcodes b WHERE b.barcode=codes.code AND b.sku<>${products.sku})
 AND NOT EXISTS (SELECT 1 FROM products other WHERE other.sku=codes.code AND other.sku<>${products.sku})
)`;
/**
 * Mã quét của cả danh mục – cùng kết quả với posScanCodes: mã hàng + mã vạch, bỏ mã trỏ tới hơn một sản phẩm.
 * posScanCodes tra 3 lần chỉ mục cho TỪNG sản phẩm (~180 ms với 8.000 mã, ~90% truy vấn snapshot); ở đây chỉ một lượt đọc
 * bảng mã vạch (~10 ms). Mã vạch là khoá chính và mã hàng là khoá chính, nên mã chỉ "trùng" khi một mã vạch bằng mã hàng
 * của sản phẩm KHÁC: bỏ mã đó ở cả hai sản phẩm.
 */
async function allScanCodes(db:PosDb){
 const other=alias(products,'other');
 const rows=await db.select({sku:productBarcodes.sku,code:productBarcodes.barcode,clash:sql<boolean>`${other.sku} is not null`}).from(productBarcodes)
  .leftJoin(other,and(eq(other.sku,productBarcodes.barcode),ne(other.sku,productBarcodes.sku)));
 const clashing=new Set(rows.filter(r=>r.clash).map(r=>r.code)),bySku=new Map<string,string[]>();
 for(const r of rows){if(r.clash||r.code===r.sku)continue;const list=bySku.get(r.sku);if(list)list.push(r.code);else bySku.set(r.sku,[r.code]);}
 return (sku:string)=>[...(clashing.has(sku)?[]:[sku]),...(bySku.get(sku)??[])];
}
export function posBrandScope(registerName:string){
 const family=posCatalogFamily(registerName);
 return family?sql`${foldSql(products.brand,products.name)} !~ ${family==='lock'?MINH_LONG_CATALOG_PATTERN:LOCK_CATALOG_PATTERN}`:undefined;
}
/** Compact session-only stock preload. No supplier/incoming stock, no stock writes. */
/** false: không kèm danh mục; true: danh mục dạng đối tượng (giao diện cũ); 'compact': cột cố định CATALOG_COLUMNS, cùng thứ tự với rows. */
export type SnapshotCatalog=boolean|'compact';
export const CATALOG_COLUMNS=['name','brand','unit','imageUrl','pattern'] as const;
async function readPosStockSnapshot(db:PosDb,member:PosMember,register:{id:string;name:string;warehouseId:string;pricePolicyId:string;secondPricePolicyId:string},policy=register.pricePolicyId,includeCatalog:SnapshotCatalog=false){
 if(![register.pricePolicyId,register.secondPricePolicyId].includes(policy))throw new AppError(400,'Bảng giá không hợp lệ.');
 const startedAt=new Date().toISOString();
 const [hidden,opened,codes,rows]=await Promise.all([
  hiddenStockWarehouses(db,member),rememberLedgerWarehouses(db),allScanCodes(db),
  db.select({sku:products.sku,price:productPrices.price,onHand:stockBalances.qty,...(includeCatalog?{name:products.name,brand:products.brand,unit:products.unit,imageUrl:products.imageUrl,pattern:products.pattern}:{})}).from(products)
   .innerJoin(productPrices,and(eq(productPrices.sku,products.sku),eq(productPrices.policyId,policy)))
   .leftJoin(stockBalances,and(eq(stockBalances.sku,products.sku),eq(stockBalances.warehouseId,register.warehouseId)))
   .where(and(eq(products.active,true),eq(products.approvalStatus,'approved'),sql`${productPrices.price} is not null`,posBrandScope(register.name))).orderBy(...(includeCatalog?productOrder(null):[asc(products.sku)])).limit(20001),
 ]);
 if(hidden.has(register.warehouseId))throw new AppError(403,'Bạn không được xem tồn kho riêng của quầy này.');
 // Never silently preload a partial catalog; large installations keep the paged path.
 if(rows.length>20000)return null;
 // Cả danh mục: đọc hàng giữ của mọi mã (vài trăm dòng) thay vì gửi hàng nghìn mã vào mỗi truy vấn; mã ngoài danh mục tự bị bỏ qua.
 const held=rows.length?await reservedBySku(db,undefined,register.warehouseId):new Map<string,number>();
 // Metadata comes from the same authorized price/stock scan, avoiding a second huge IN query.
 // 'compact': mảng theo CATALOG_COLUMNS, khỏi lặp tên trường và mã hàng ở mỗi dòng – nhẹ hơn khi tải và khi trình duyệt đọc JSON.
 const catalog=includeCatalog===true?rows.map(({sku,name,brand,unit,imageUrl,pattern})=>({sku,name,brand,unit,imageUrl,pattern})):undefined;
 const catalogRows=includeCatalog==='compact'?rows.map(p=>CATALOG_COLUMNS.map(c=>p[c as keyof typeof p]??'')):undefined;
 return {version:1,catalog,catalogColumns:catalogRows&&CATALOG_COLUMNS,catalogRows,registerId:register.id,warehouseId:register.warehouseId,pricePolicyId:policy,asOf:startedAt,warehouseReady:opened.includes(register.warehouseId),
  // sku, price, physical ledger quantity, reserved quantity, unambiguous scan codes
  rows:rows.map(p=>[p.sku,p.price,p.onHand??0,held.get(p.sku)??0,codes(p.sku)] as const)};
}

export function posStockSnapshot(db:AnyDb,member:PosMember,register:Parameters<typeof readPosStockSnapshot>[2],policy?:string,includeCatalog:SnapshotCatalog=false){
 return db.transaction(tx=>readPosStockSnapshot(tx,member,register,policy,includeCatalog),{isolationLevel:'repeatable read',accessMode:'read only'});
}
