import {and,asc,eq,gte,ne,sql} from 'drizzle-orm';
import {alias} from 'drizzle-orm/pg-core';
import type {AnyDb} from '../../../core/db/client.ts';
import {AppError} from '../../../core/errors.ts';
import {shortMemo} from '../../../core/cache/short-memo.ts';
import {productOrder} from '../../catalog/api/product-query.ts';
import {foldSql} from '../../../core/text/fold.ts';
import {products,productPrices,productBarcodes} from '../../catalog/schema.ts';
import {hiddenStockWarehouses} from '../../catalog/api/stock-source.ts';
import {snapshotVersion} from '../../catalog/api/routes.ts';
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
export function posBrandScope(registerName:string,{preload=false}:{preload?:boolean}={}){
 const family=posCatalogFamily(registerName);
 if(!family)return undefined;
 const pattern=family==='lock'?MINH_LONG_CATALOG_PATTERN:LOCK_CATALOG_PATTERN;
 const full=sql`${foldSql(products.brand,products.name)} !~ ${pattern}`;
 // Bulk preload scans the complete catalog. Reject an opposite brand before folding its longer name.
 // Keep the full combined check otherwise: a family can span the brand/name boundary.
 // Paged catalog keeps its original predicate and early LIMIT plan.
 return preload?sql`case when ${foldSql(products.brand)} ~ ${pattern} then false else ${full} end`:full;
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
   .where(and(eq(products.active,true),eq(products.approvalStatus,'approved'),sql`${productPrices.price} is not null`,posBrandScope(register.name,{preload:true}))).orderBy(...(includeCatalog?productOrder(null):[asc(products.sku)])).limit(20001),
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
 return {version:1,base:(await snapshotVersion(db as unknown as AnyDb)).base,catalog,catalogColumns:catalogRows&&CATALOG_COLUMNS,catalogRows,registerId:register.id,warehouseId:register.warehouseId,pricePolicyId:policy,asOf:startedAt,warehouseReady:opened.includes(register.warehouseId),
  // sku, price, physical ledger quantity, reserved quantity, unambiguous scan codes
  rows:rows.map(p=>[p.sku,p.price,p.onHand??0,held.get(p.sku)??0,codes(p.sku)] as const)};
}

const snapshotMemo=shortMemo<Awaited<ReturnType<typeof readPosStockSnapshot>>>();
/** Nhiều máy POS cùng quầy tải lại trong vài giây dùng chung một lần đọc. Khoá theo quầy, bảng giá, kiểu kèm danh mục và
 * vai trò/chức vụ (quyết định kho bị ẩn). Lệnh ghi (bán, nhập, chuyển kho…) xoá bộ nhớ đệm ngay. */
export function posStockSnapshot(db:AnyDb,member:PosMember,register:Parameters<typeof readPosStockSnapshot>[2],policy?:string,includeCatalog:SnapshotCatalog=false){
 const key=[register.id,policy??register.pricePolicyId,String(includeCatalog),member.role,member.positionId??''].join('|');
 return snapshotMemo.get(key,()=>db.transaction(tx=>readPosStockSnapshot(tx,member,register,policy,includeCatalog),{isolationLevel:'repeatable read',accessMode:'read only'}));
}

/** Khoảng chồng lấn khi lấy tồn đổi: giao dịch ghi bắt đầu trước mốc nhưng commit sau vẫn được gửi lại. */
const DELTA_OVERLAP_MS=60_000, DELTA_MAX_AGE_MS=10*60_000;
/**
 * Chỉ phần tồn đổi kể từ `since` (asOf của bản máy POS đang có) – thay cho tải lại toàn bộ ~4.000 dòng mỗi 30 giây.
 * Trả `{full:true}` (máy POS tải lại bản đầy đủ) khi: danh mục / giá / kho đổi (base khác), `since` quá cũ hoặc không hợp lệ.
 * Hàng đang giữ (giữ theo báo giá hết hạn theo giờ, giữ theo đơn) luôn gửi đủ vì có thể đổi mà không có lệnh ghi tồn.
 */
async function readPosStockDelta(db:PosDb,member:PosMember,register:{id:string;name:string;warehouseId:string;pricePolicyId:string;secondPricePolicyId:string},policy:string,since:string,base:string){
 if(![register.pricePolicyId,register.secondPricePolicyId].includes(policy))throw new AppError(400,'Bảng giá không hợp lệ.');
 const startedAt=new Date().toISOString(),sinceMs=Date.parse(since);
 const [hidden,current]=await Promise.all([hiddenStockWarehouses(db,member),snapshotVersion(db as unknown as AnyDb)]);
 if(hidden.has(register.warehouseId))throw new AppError(403,'Bạn không được xem tồn kho riêng của quầy này.');
 if(!Number.isFinite(sinceMs)||Date.now()-sinceMs>DELTA_MAX_AGE_MS||sinceMs>Date.now()+5*60_000||current.base!==base)return {version:1,full:true as const};
 const cutoff=new Date(sinceMs-DELTA_OVERLAP_MS).toISOString();
 // Không đọc lại mã vạch: máy POS giữ mã quét của bản đầy đủ (tải lại ít nhất 5 phút/lần).
 const [opened,rows,held]=await Promise.all([
  rememberLedgerWarehouses(db),
  db.select({sku:products.sku,price:productPrices.price,onHand:stockBalances.qty}).from(products)
   .innerJoin(productPrices,and(eq(productPrices.sku,products.sku),eq(productPrices.policyId,policy)))
   .innerJoin(stockBalances,and(eq(stockBalances.sku,products.sku),eq(stockBalances.warehouseId,register.warehouseId)))
   .where(and(eq(products.active,true),eq(products.approvalStatus,'approved'),sql`${productPrices.price} is not null`,gte(stockBalances.updatedAt,cutoff),posBrandScope(register.name,{preload:true}))).limit(20001),
  reservedBySku(db,undefined,register.warehouseId),
 ]);
 if(rows.length>20000)return {version:1,full:true as const};
 return {version:1,delta:true as const,base:current.base,registerId:register.id,warehouseId:register.warehouseId,pricePolicyId:policy,asOf:startedAt,warehouseReady:opened.includes(register.warehouseId),
  rows:rows.map(p=>[p.sku,p.price,p.onHand??0,held.get(p.sku)??0,null] as const),held:[...held].filter(([,q])=>q>0)};
}
export function posStockDelta(db:AnyDb,member:PosMember,register:Parameters<typeof readPosStockDelta>[2],policy:string|undefined,since:string,base:string){
 return db.transaction(tx=>readPosStockDelta(tx,member,register,policy??register.pricePolicyId,since,base),{isolationLevel:'repeatable read',accessMode:'read only'});
}
