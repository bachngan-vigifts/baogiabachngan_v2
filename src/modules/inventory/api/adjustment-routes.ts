import {and,asc,desc,eq,gt,inArray,isNotNull,sql} from 'drizzle-orm';
import {nextDocumentNumber,documentNumberPatterns} from '../../../core/document-number.ts';
import {AppError} from '../../../core/errors.ts';
import {auditLogs} from '../../../core/db/schema.ts';
import {json,readJson,type Router,type RouteContext} from '../../../core/http/router.ts';
import {can} from '../../staff/domain/permissions.ts';
import {sha256Hex} from '../../staff/domain/session.ts';
import type {StaffEnv,SessionState} from '../../staff/api/auth-routes.ts';
import {employees} from '../../staff/schema.ts';
import {productMovements,products,productStock,warehouses} from '../../catalog/schema.ts';
import {inventoryAdjustments as adjustments,stockBalances} from '../schema.ts';
import {assertWarehousesOpened,postMoves} from './ledger.ts';
import {notifyMany} from '../../notifications/api/routes.ts';
type Ctx=RouteContext<StaffEnv>;
type Db=StaffEnv['db'];type Tx=Parameters<Parameters<Db['transaction']>[0]>[0];
type Line={sku:string;qty:number;source?:'stocktake';expectedQty?:number;countedQty?:number};
const me=(c:Ctx)=>(c.state.session as SessionState).member;
function fail(status:number,message:string):never{throw new AppError(status,message);}
const approve=(c:Ctx)=>me(c).role==='manager';
function cleanLines(raw:unknown):Line[]{
 if(!Array.isArray(raw)||!raw.length||raw.length>300)fail(400,'Nhập từ 1 đến 300 dòng điều chỉnh.');
 const merged=new Map<string,number>();
 for(const r of raw as Record<string,unknown>[]){
  const sku=typeof r?.sku==='string'?r.sku.trim():'',n=Number(r?.qty),qty=Math.round(n*1000)/1000;
  if(!sku||sku.length>200||!Number.isFinite(n)||!qty||Math.abs(n)>1e9)fail(400,'Mã hàng hoặc số lượng điều chỉnh không hợp lệ.');
  merged.set(sku,Math.round(((merged.get(sku)||0)+qty)*1000)/1000);
 }
 const lines=[...merged].filter(([,qty])=>qty!==0).map(([sku,qty])=>({sku,qty})).sort((a,b)=>a.sku.localeCompare(b.sku));
 if(!lines.length)fail(400,'Phiếu không có thay đổi tồn kho.');return lines;
}
function countLines(raw:unknown):Line[]{
 if(!Array.isArray(raw)||!raw.length||raw.length>1000)fail(400,'Nhập từ 1 đến 1.000 sản phẩm kiểm kê.');
 const seen=new Set<string>();
 return (raw as Record<string,unknown>[]).map(r=>{
  const sku=typeof r?.sku==='string'?r.sku.trim():'';
  const expectedQty=r.expectedQty,countedQty=r.countedQty;
  if(!sku||sku.length>200||seen.has(sku)||typeof expectedQty!=='number'||typeof countedQty!=='number'||!Number.isFinite(expectedQty)||!Number.isFinite(countedQty)||Math.abs(expectedQty)>1e9||countedQty<0||countedQty>1e9||Math.abs(countedQty*1000-Math.round(countedQty*1000))>0.0001)fail(400,'Mã hàng, tồn đối chiếu hoặc số thực đếm không hợp lệ (không để trống số đếm).');
  seen.add(sku);
  return {sku,source:'stocktake' as const,expectedQty,countedQty,qty:Math.round((countedQty-expectedQty)*1000)/1000};
 }).sort((a,b)=>a.sku.localeCompare(b.sku));
}
type StockChange={sku:string;expectedQty:number;currentQty:number;countedQty:number;qty:number};
const fmtQty=(n:number)=>Number(n).toLocaleString('vi-VN',{maximumFractionDigits:3});
/**
 * Đối chiếu tồn lúc đếm với tồn hiện tại. Tồn đã đổi (bán / nhập sau lúc đếm): mặc định chặn (409 STOCKTAKE_STOCK_CHANGED);
 * `applyDelta` = duyệt theo chênh lệch — ghi đúng phần (thực đếm − tồn lúc đếm) vào tồn hiện tại, phát sinh sau lúc đếm được giữ nguyên.
 */
async function countSnapshot(tx:Tx,warehouseId:string,lines:Line[],applyDelta:boolean):Promise<StockChange[]>{
 if(!lines.some(l=>l.source==='stocktake'))return [];
 // Exclusive ledger lock keeps snapshot comparison and posting atomic, including missing balances.
 await tx.execute(sql`select pg_advisory_xact_lock(hashtext('stock_ledger_opening'))`);
 if(lines.some(l=>l.source!=='stocktake'))throw new AppError(409,'Phiếu kiểm kê có dòng không hợp lệ. Lập lại phiếu kiểm kê.','STOCKTAKE_STOCK_CHANGED');
 const rows=await tx.select().from(stockBalances).where(and(eq(stockBalances.warehouseId,warehouseId),inArray(stockBalances.sku,lines.map(l=>l.sku))));
 const balances=new Map(rows.map(r=>[r.sku,r.qty]));
 const changed=lines.filter(l=>Math.abs((balances.get(l.sku)||0)-Number(l.expectedQty))>0.000001)
  .map(l=>({sku:l.sku,expectedQty:Number(l.expectedQty),currentQty:balances.get(l.sku)||0,countedQty:Number(l.countedQty),qty:l.qty}));
 if(changed.length&&!applyDelta)throw new AppError(409,`Tồn đã thay đổi sau lúc đếm ở ${changed.length} mã (${changed.slice(0,3).map(x=>`${x.sku}: ${fmtQty(x.expectedQty)} → ${fmtQty(x.currentQty)}`).join('; ')}${changed.length>3?'; …':''}). Có thể duyệt theo chênh lệch: tồn mới = tồn hiện tại + (thực đếm − tồn lúc đếm).`,'STOCKTAKE_STOCK_CHANGED');
 return changed;
}
/** Giá nhập gần nhất theo mã (lịch sử sản phẩm, dòng "Nhập hàng") – giá vốn để tính giá trị chênh lệch; chỉ Manager được xem. */
async function latestCosts(db:Db,skus:string[]):Promise<Map<string,number>>{
 if(!skus.length)return new Map();
 const rows=await db.selectDistinctOn([productMovements.sku],{sku:productMovements.sku,price:productMovements.unitPrice}).from(productMovements)
  .where(and(inArray(productMovements.sku,[...new Set(skus)]),eq(productMovements.kind,'purchase'),isNotNull(productMovements.unitPrice)))
  .orderBy(productMovements.sku,desc(productMovements.occurredAt));
 return new Map(rows.filter(r=>r.price!==null).map(r=>[r.sku,Number(r.price)]));
}
/** Giá trị chênh lệch của phiếu theo giá nhập gần nhất; `missing` = số mã lệch chưa có giá nhập. */
function lineValue(lines:Line[],costs:Map<string,number>){
 let value=0,missing=0;
 for(const l of lines){if(!l.qty)continue;const cost=costs.get(l.sku);if(cost===undefined){missing++;continue;}value+=l.qty*cost;}
 return {value:Math.round(value),missing};
}
/** Tên + ĐVT sản phẩm cho màn xem phiếu / file Excel (phiếu chỉ lưu mã). */
async function productNames(db:Db,skus:string[],withCost=false){
 if(!skus.length)return {};
 const [rows,costs]=await Promise.all([db.select({sku:products.sku,name:products.name,unit:products.unit}).from(products).where(inArray(products.sku,skus)),withCost?latestCosts(db,skus):new Map<string,number>()]);
 return Object.fromEntries(rows.map(r=>[r.sku,{name:r.name,unit:r.unit||'',...(costs.has(r.sku)?{cost:costs.get(r.sku)}:{})}]));
}
async function audit(tx:Tx,actorId:string,id:string,action:string,data:unknown){await tx.insert(auditLogs).values({id:crypto.randomUUID(),actorId,module:'inventory',action,entityType:'inventory_adjustments',entityId:id,data:JSON.stringify(data),createdAt:new Date().toISOString()});}
export function registerAdjustmentRoutes(router:Router<StaffEnv>,allowed:(c:Ctx)=>Promise<{id:string;name:string}[]>){
 const guard=(c:Ctx)=>{if(!can(me(c),'inventory.view'))fail(403,'Bạn chưa được cấp quyền xem sổ kho.');};
 const scope=async(c:Ctx,stocktakesOnly=false)=>{const ids=(await allowed(c)).map(w=>w.id);return and(ids.length?inArray(adjustments.warehouseId,ids):sql`false`,approve(c)||stocktakesOnly?undefined:eq(adjustments.createdBy,me(c).id));};
 async function load(c:Ctx,id:string){guard(c);const [row]=await c.env.db.select().from(adjustments).where(and(eq(adjustments.id,id),await scope(c))).limit(1);if(!row)fail(404,'Không tìm thấy phiếu điều chỉnh.');return row;}
 async function present(c:Ctx,rows:(typeof adjustments.$inferSelect)[]){
  const ids=[...new Set(rows.flatMap(r=>[r.createdBy,...(r.reviewedBy?[r.reviewedBy]:[])]))];
  const people=ids.length?await c.env.db.select({id:employees.id,name:employees.name}).from(employees).where(inArray(employees.id,ids)):[];
  const whs=await allowed(c),names=new Map(people.map(p=>[p.id,p.name]));
  return rows.map(({clientKey:_key,payloadHash:_hash,...r})=>({...r,lines:JSON.parse(r.lines) as Line[],warehouseName:whs.find(w=>w.id===r.warehouseId)?.name||'',createdByName:names.get(r.createdBy)||'',reviewedByName:r.reviewedBy?names.get(r.reviewedBy)||'':''}));
 }
 // Shared stocktake references are visible only inside the reader's warehouse scope.
 // Normal adjustments retain their creator-only scope for non-Managers.
 const countKind=sql`${adjustments.lines}::jsonb @> '[{"source":"stocktake"}]'::jsonb`;
 async function pendingCounts(db:Db|Tx,warehouseId:string,skus:string[]){
  const rows=await db.select({id:adjustments.id,refNo:adjustments.refNo,createdAt:adjustments.createdAt,by:employees.name,lines:adjustments.lines})
   .from(adjustments).leftJoin(employees,eq(employees.id,adjustments.createdBy))
   .where(and(eq(adjustments.warehouseId,warehouseId),eq(adjustments.status,'pending'),countKind,
    sql`EXISTS (SELECT 1 FROM jsonb_array_elements(${adjustments.lines}::jsonb) line WHERE line->>'sku' IN (${sql.join(skus.map(sku=>sql`${sku}`),sql`, `)}))`));
  const wanted=new Set(skus),result:Record<string,{id:string;refNo:string;createdAt:string;createdByName:string}[]>={};
  for(const row of rows)for(const line of JSON.parse(row.lines) as Line[])if(line.source==='stocktake'&&wanted.has(line.sku))
   (result[line.sku]||=[]).push({id:row.id,refNo:row.refNo,createdAt:row.createdAt,createdByName:row.by||''});
  return result;
 }
 /** Lịch sử kiểm kê một mã: các phiếu kiểm kê có mã này (trong phạm vi kho được xem), mới nhất trước. */
 router.get('/inventory/stocktake-history',async c=>{
  guard(c);const p=c.url.searchParams,sku=(p.get('sku')||'').trim(),wh=p.get('warehouseId')||'';
  if(!sku||sku.length>200)fail(400,'Chọn mã hàng.');
  const rows=await c.env.db.select().from(adjustments).where(and(await scope(c,true),countKind,wh?eq(adjustments.warehouseId,wh):undefined,
   sql`${adjustments.lines}::jsonb @> ${JSON.stringify([{sku,source:'stocktake'}])}::jsonb`)).orderBy(desc(adjustments.createdAt),desc(adjustments.id)).limit(50);
  const [shown,names]=await Promise.all([present(c,rows),productNames(c.env.db,[sku])]);
  return json({sku,name:(names as Record<string,{name:string}>)[sku]?.name||'',history:shown.map(r=>{const l=r.lines.find(x=>x.sku===sku)!;
   return {id:r.id,refNo:r.refNo,status:r.status,warehouseId:r.warehouseId,warehouseName:r.warehouseName,createdAt:r.createdAt,createdByName:r.createdByName,reviewedAt:r.reviewedAt,expectedQty:l.expectedQty,countedQty:l.countedQty,qty:l.qty};})});
 },'business');
 /**
  * Tạo nhanh phiếu kiểm kê: danh sách mã theo thương hiệu (`brand`), mọi mã còn tồn trong kho (`instock`)
  * hoặc các mã lệch lớn nhất giữa sổ kho và Sapo (`sapo`, `limit` mã). Trả tồn sổ kho hiện tại của từng mã (tối đa 1.000 mã).
  */
 router.post('/inventory/count-candidates',async c=>{
  guard(c);const body=await readJson(c.req,3000),warehouseId=String(body.warehouseId||''),mode=String(body.mode||''),brand=String(body.brand??'').trim().slice(0,200);
  const limit=Math.min(1000,Math.max(1,Math.trunc(Number(body.limit)||50)));
  if(!['brand','instock','sapo'].includes(mode))fail(400,'Chọn cách tạo nhanh phiếu kiểm kê.');
  if(mode==='brand'&&!brand)fail(400,'Chọn thương hiệu.');
  if(!(await allowed(c)).some(w=>w.id===warehouseId))fail(403,'Kho không thuộc phạm vi sổ kho của bạn.');
  await assertWarehousesOpened(c.env.db,[warehouseId]);
  const db=c.env.db,MAX=1000;let items:{sku:string;name:string;unit:string;stock:number}[]=[];
  if(mode==='brand'){
   const rows=await db.select({sku:products.sku,name:products.name,unit:products.unit,stock:stockBalances.qty}).from(products)
    .leftJoin(stockBalances,and(eq(stockBalances.sku,products.sku),eq(stockBalances.warehouseId,warehouseId)))
    .where(and(eq(products.brand,brand),eq(products.active,true))).orderBy(asc(products.sku)).limit(MAX+1);
   items=rows.map(r=>({sku:r.sku,name:r.name,unit:r.unit||'',stock:r.stock??0}));
  }else if(mode==='instock'){
   const rows=await db.select({sku:stockBalances.sku,name:products.name,unit:products.unit,stock:stockBalances.qty}).from(stockBalances)
    .innerJoin(products,eq(products.sku,stockBalances.sku)).where(and(eq(stockBalances.warehouseId,warehouseId),gt(stockBalances.qty,0.0005))).orderBy(asc(stockBalances.sku)).limit(MAX+1);
   items=rows.map(r=>({sku:r.sku,name:r.name,unit:r.unit||'',stock:r.stock}));
  }else{
   const res=await db.execute(sql`
    with b as (select sku, qty from ${stockBalances} where warehouse_id = ${warehouseId}),
         s as (select sku, quantity as qty from ${productStock} where warehouse_id = ${warehouseId}),
         j as (select coalesce(b.sku, s.sku) as sku, coalesce(b.qty, 0) as ledger, coalesce(s.qty, 0) as sapo from b full outer join s on b.sku = s.sku)
    select j.sku, p.name, p.unit, j.ledger from j inner join ${products} p on p.sku = j.sku
    where abs(j.ledger - j.sapo) > 0.0005 order by abs(j.ledger - j.sapo) desc, j.sku limit ${limit}`);
   const rows=(res as unknown as {rows?:Record<string,unknown>[]}).rows??(res as unknown as Record<string,unknown>[]);
   items=rows.map(r=>({sku:String(r.sku),name:String(r.name??''),unit:String(r.unit??''),stock:Number(r.ledger)||0}));
  }
  const truncated=items.length>MAX;if(truncated)items=items.slice(0,MAX);
  const pendingBySku=items.length?await pendingCounts(db,warehouseId,items.map(i=>i.sku)):{};
  return json({warehouseId,observedAt:new Date().toISOString(),items,truncated,pendingBySku});
 },'business');
 router.get('/inventory/stocktakes/:id',async c=>{
  guard(c);const [row]=await c.env.db.select().from(adjustments).where(and(eq(adjustments.id,c.params.id!),await scope(c,true),countKind)).limit(1);
  if(!row)fail(404,'Không tìm thấy phiếu kiểm kê.');
  const skus=(JSON.parse(row.lines) as Line[]).map(l=>l.sku);
  const [balances,names]=await Promise.all([c.env.db.select().from(stockBalances).where(and(eq(stockBalances.warehouseId,row.warehouseId),inArray(stockBalances.sku,skus))),productNames(c.env.db,skus,approve(c))]);
  return json({adjustment:(await present(c,[row]))[0],balances:Object.fromEntries(balances.map(b=>[b.sku,b.qty])),names,canApprove:approve(c)});
 },'business');
 router.post('/inventory/count-stock',async c=>{
  guard(c);const body=await readJson(c.req,250000),warehouseId=String(body.warehouseId||''),skus=body.skus;
  if(!(await allowed(c)).some(w=>w.id===warehouseId))fail(403,'Kho không thuộc phạm vi sổ kho của bạn.');
  if(!Array.isArray(skus)||!skus.length||skus.length>1000||skus.some(x=>typeof x!=='string'||!x||x.length>200))fail(400,'Chọn từ 1 đến 1.000 sản phẩm.');
  await assertWarehousesOpened(c.env.db,[warehouseId]);
  const [rows,pendingBySku]=await Promise.all([
   c.env.db.select().from(stockBalances).where(and(eq(stockBalances.warehouseId,warehouseId),inArray(stockBalances.sku,skus))),
   pendingCounts(c.env.db,warehouseId,skus),
  ]);
  const at=new Date().toISOString(),m=new Map(rows.map(r=>[r.sku,r.qty]));
  return json({warehouseId,observedAt:at,pendingBySku,stock:Object.fromEntries(skus.map(sku=>[sku,m.get(sku)||0]))});
 },'business');
 router.get('/inventory/adjustments',async c=>{
  guard(c);const p=c.url.searchParams,state=p.get('status')||'',wh=p.get('warehouseId')||'',offset=Number(p.get('offset')||0);
  // Bộ lọc như trang Điều chuyển kho: số phiếu / mã hàng, người lập, khoảng ngày lập (giờ Việt Nam).
  const q=(p.get('q')||'').trim().slice(0,80),creator=(p.get('createdBy')||'').slice(0,80),from=p.get('from')||'',to=p.get('to')||'',day=/^\d{4}-\d{2}-\d{2}$/;
  if(!['','pending','approved','rejected'].includes(state)||!Number.isSafeInteger(offset)||offset<0||offset>1e6||(from&&!day.test(from))||(to&&!day.test(to))||(from&&to&&from>to))fail(400,'Bộ lọc phiếu điều chỉnh không hợp lệ.');
  const vnStart=(d:string)=>new Date(d+'T00:00:00+07:00').toISOString(),vnEnd=(d:string)=>new Date(new Date(d+'T00:00:00+07:00').getTime()+864e5).toISOString();
  const like='%'+q.replace(/[\\%_]/g,m=>'\\'+m)+'%';
  const base=and(await scope(c,p.get('kind')==='stocktake'),p.get('kind')==='stocktake'?countKind:undefined);
  const where=and(base,state?eq(adjustments.status,state as 'pending'):undefined,wh?eq(adjustments.warehouseId,wh):undefined,creator?eq(adjustments.createdBy,creator):undefined,
   from?sql`${adjustments.createdAt}>=${vnStart(from)}`:undefined,to?sql`${adjustments.createdAt}<${vnEnd(to)}`:undefined,
   q?sql`(${adjustments.refNo} ILIKE ${like} OR ${adjustments.reason} ILIKE ${like} OR EXISTS (SELECT 1 FROM jsonb_array_elements(${adjustments.lines}::jsonb) line WHERE line->>'sku' ILIKE ${like}))`:undefined);
  const [rows,creators]=await Promise.all([
   c.env.db.select().from(adjustments).where(where).orderBy(desc(adjustments.createdAt),desc(adjustments.id)).limit(21).offset(offset),
   c.env.db.selectDistinct({id:employees.id,name:employees.name}).from(adjustments).innerJoin(employees,eq(employees.id,adjustments.createdBy)).where(base),
  ]);
  const nextOffset=rows.length>20?offset+20:null;if(nextOffset!==null)rows.pop();
  // Giá trị chênh lệch theo giá nhập gần nhất: chỉ Manager (giá vốn).
  const shown=await present(c,rows),costs=approve(c)?await latestCosts(c.env.db,shown.flatMap(r=>r.lines.map(l=>l.sku))):null;
  return json({adjustments:costs?shown.map(r=>({...r,valueDelta:lineValue(r.lines,costs)})):shown,nextOffset,canApprove:approve(c),filterOptions:{creators:creators.sort((a,b)=>a.name.localeCompare(b.name,'vi'))}});
 },'business');
 router.get('/inventory/adjustments/:id',async c=>{
  const row=await load(c,c.params.id!),lines=JSON.parse(row.lines) as Line[],skus=lines.map(l=>l.sku);
  const [balances,names]=await Promise.all([c.env.db.select().from(stockBalances).where(and(eq(stockBalances.warehouseId,row.warehouseId),inArray(stockBalances.sku,skus))),productNames(c.env.db,skus,approve(c))]);
  return json({adjustment:(await present(c,[row]))[0],balances:Object.fromEntries(balances.map(b=>[b.sku,b.qty])),names,canApprove:approve(c)});
 },'business');
 router.post('/inventory/adjustments',async c=>{
  guard(c);const m=me(c);if(!can(m,'inventory.manage'))fail(403,'Bạn chưa được cấp quyền lập phiếu điều chỉnh.');
  const body=await readJson(c.req,400000),reason=String(body.reason??'').trim().slice(0,500),warehouseId=String(body.warehouseId??'');
  if(reason.length<3)fail(400,'Nhập lý do điều chỉnh.');
  if(!(await c.env.db.select({id:warehouses.id}).from(warehouses).where(and(eq(warehouses.id,warehouseId),eq(warehouses.kind,'stock'),eq(warehouses.active,true))).limit(1)).length)fail(400,'Chọn kho điều chỉnh.');
  if(!(await allowed(c)).some(w=>w.id===warehouseId))fail(403,'Kho không thuộc phạm vi sổ kho của bạn.');
  const stocktake=body.source==='stocktake',lines=stocktake?countLines(body.lines):cleanLines(body.lines),known=new Set((await c.env.db.select({sku:products.sku}).from(products).where(inArray(products.sku,lines.map(l=>l.sku)))).map(p=>p.sku));
  if(lines.some(l=>!known.has(l.sku)))fail(400,'Mã không có trong danh mục.');
  const hash=sha256Hex(JSON.stringify({warehouseId,reason,lines}));
  // Khoá gửi bắt buộc với mọi người (kể cả Manager): server tự sinh khoá thì bấm lặp / mạng gửi lại thành hai phiếu, ghi tồn hai lần.
  const clientKey=body.clientKey;
  if(clientKey===undefined||clientKey===null||clientKey===''){
   const since=new Date(Date.now()-2*60_000).toISOString();
   const [recent]=await c.env.db.select({refNo:adjustments.refNo}).from(adjustments)
    .where(and(eq(adjustments.createdBy,m.id),eq(adjustments.payloadHash,hash),sql`${adjustments.createdAt}>=${since}`)).orderBy(desc(adjustments.createdAt)).limit(1);
   throw new AppError(409,(recent?`Vừa có phiếu ${recent.refNo} cùng nội dung. Kiểm tra danh sách phiếu trước khi gửi lại. `:'')+'Tải lại trang rồi lập phiếu (thiếu mã chống gửi lặp).','ADJUSTMENT_KEY_REQUIRED');
  }
  if(typeof clientKey!=='string'||!/^[a-zA-Z0-9_-]{8,100}$/.test(clientKey))fail(400,'Khoá gửi phiếu không hợp lệ.');
  const result=await c.env.db.transaction(async tx=>{
   await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'adjustment:'+m.id+':'+clientKey}))`);
   const [old]=await tx.select().from(adjustments).where(and(eq(adjustments.createdBy,m.id),eq(adjustments.clientKey,clientKey))).limit(1);
   if(old){if(old.payloadHash!==hash)fail(409,'Khoá gửi đã dùng cho nội dung khác.');return {id:old.id,refNo:old.refNo,status:old.status,replayed:true,lines:0};}
   await assertWarehousesOpened(tx,[warehouseId]);
   const stockChanged=await countSnapshot(tx,warehouseId,lines,body.applyDelta===true);
   if(stocktake){const overlaps=await pendingCounts(tx,warehouseId,lines.map(l=>l.sku));if(Object.keys(overlaps).length)throw new AppError(409,'Mã '+Object.keys(overlaps).slice(0,5).join(', ')+' đang có phiếu kiểm kê chờ duyệt. Mở phiếu để đối chiếu hoặc bỏ các mã này trước khi gửi.','STOCKTAKE_PENDING');}
   const id=crypto.randomUUID(),now=new Date().toISOString(),date=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Ho_Chi_Minh'}).format(new Date());
   const used=stocktake?await tx.select({no:adjustments.refNo}).from(adjustments).where(sql`${adjustments.refNo} LIKE ${documentNumberPatterns('KK',date)[0]}`):[];
   const refNo=stocktake?nextDocumentNumber('KK',date,used.map(r=>r.no)):'ĐC-'+date.replaceAll('-','')+'-'+id.slice(0,8).toUpperCase();
   const status=approve(c)&&!stocktake?'approved' as const:'pending' as const;
   await tx.insert(adjustments).values({id,refNo,clientKey,payloadHash:hash,warehouseId,reason,lines:JSON.stringify(lines),status,createdBy:m.id,createdAt:now,...(status==='approved'?{reviewedBy:m.id,reviewedAt:now}:{})});
   const written=status==='approved'?await postMoves(tx,m.id,lines.map(l=>({...l,warehouseId,kind:'adjust',refType:'adjustment',refId:id,refNo,note:reason}))):0;
   await audit(tx,m.id,id,status==='approved'?'adjustment-approved':'adjustment-submitted',{warehouseId,reason,lines,refNo,...(stockChanged.length?{appliedDelta:true,stockChanged}:{})});
   return {id,refNo,status,replayed:false,lines:written};
  });
  if(result.status==='pending'&&!result.replayed){
   const managers=await c.env.db.select({id:employees.id}).from(employees).where(and(eq(employees.role,'manager'),eq(employees.active,true)));
   await notifyMany(c.env,managers.map(m=>m.id),{eventType:'inventory_adjustment_pending',title:'Phiếu điều chỉnh chờ duyệt',body:`${m.name}: ${result.refNo} · ${reason}`,url:'/index.html#/inventory?adjustment='+encodeURIComponent(result.id),actorId:m.id}).catch(()=>console.warn('Adjustment notification skipped'));
  }
  return json({ok:true,...result},result.replayed?200:201);
 },'business');
 router.post('/inventory/adjustments/:id/review',async c=>{
  guard(c);if(!approve(c))fail(403,'Chỉ Manager được duyệt hoặc từ chối phiếu điều chỉnh.');
  const body=await readJson(c.req,3000),decision=body.decision,note=String(body.note??'').trim().slice(0,500);
  if(decision!=='approved'&&decision!=='rejected')fail(400,'Chọn duyệt hoặc từ chối.');
  if(decision==='rejected'&&note.length<3)fail(400,'Nhập lý do từ chối.');
  await load(c,c.params.id!);
  const result=await c.env.db.transaction(async tx=>{
   const [row]=await tx.select().from(adjustments).where(eq(adjustments.id,c.params.id!)).for('update');
   if(!row)fail(404,'Không tìm thấy phiếu.');
   if(row.status===decision)return {...row,replayed:true};
   if(row.status!=='pending')fail(409,'Phiếu đã được xử lý, không đổi quyết định.');
   const lines=JSON.parse(row.lines) as Line[];
   const stockChanged=decision==='approved'?await countSnapshot(tx,row.warehouseId,lines,body.applyDelta===true):[];
   if(decision==='approved'){await postMoves(tx,me(c).id,lines.filter(l=>l.qty!==0).map(l=>({...l,warehouseId:row.warehouseId,kind:'adjust',refType:'adjustment',refId:row.id,refNo:row.refNo,note:row.reason})));}
   const now=new Date().toISOString();await tx.update(adjustments).set({status:decision,reviewedBy:me(c).id,reviewedAt:now,reviewNote:note}).where(eq(adjustments.id,row.id));
   await audit(tx,me(c).id,row.id,decision==='approved'?'adjustment-approved':'adjustment-rejected',{refNo:row.refNo,warehouseId:row.warehouseId,lines,note,...(stockChanged.length?{appliedDelta:true,stockChanged}:{})});
   return {...row,status:decision,replayed:false};
  });
  if(!result.replayed)await notifyMany(c.env,[result.createdBy],{eventType:'inventory_adjustment_reviewed',title:result.status==='approved'?'Phiếu điều chỉnh đã duyệt':'Phiếu điều chỉnh bị từ chối',body:result.refNo+(note?' · '+note:''),url:'/index.html#/inventory?adjustment='+encodeURIComponent(result.id),actorId:me(c).id}).catch(()=>console.warn('Adjustment notification skipped'));
  return json({ok:true,id:result.id,status:result.status,replayed:result.replayed});
 },'business');
}
