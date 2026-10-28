import {and,desc,eq,inArray,sql} from 'drizzle-orm';
import {AppError} from '../../../core/errors.ts';
import {auditLogs} from '../../../core/db/schema.ts';
import {json,readJson,type Router,type RouteContext} from '../../../core/http/router.ts';
import {can} from '../../staff/domain/permissions.ts';
import {sha256Hex} from '../../staff/domain/session.ts';
import type {StaffEnv,SessionState} from '../../staff/api/auth-routes.ts';
import {employees} from '../../staff/schema.ts';
import {products,warehouses} from '../../catalog/schema.ts';
import {inventoryAdjustments as adjustments,stockBalances} from '../schema.ts';
import {assertWarehousesOpened,postMoves} from './ledger.ts';
import {notifyMany} from '../../notifications/api/routes.ts';
type Ctx=RouteContext<StaffEnv>;
type Db=StaffEnv['db'];type Tx=Parameters<Parameters<Db['transaction']>[0]>[0];
type Line={sku:string;qty:number};
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
async function audit(tx:Tx,actorId:string,id:string,action:string,data:unknown){await tx.insert(auditLogs).values({id:crypto.randomUUID(),actorId,module:'inventory',action,entityType:'inventory_adjustments',entityId:id,data:JSON.stringify(data),createdAt:new Date().toISOString()});}
export function registerAdjustmentRoutes(router:Router<StaffEnv>,allowed:(c:Ctx)=>Promise<{id:string;name:string}[]>){
 const guard=(c:Ctx)=>{if(!can(me(c),'inventory.view'))fail(403,'Bạn chưa được cấp quyền xem sổ kho.');};
 const scope=async(c:Ctx)=>{const ids=(await allowed(c)).map(w=>w.id);return and(ids.length?inArray(adjustments.warehouseId,ids):sql`false`,approve(c)?undefined:eq(adjustments.createdBy,me(c).id));};
 async function load(c:Ctx,id:string){guard(c);const [row]=await c.env.db.select().from(adjustments).where(and(eq(adjustments.id,id),await scope(c))).limit(1);if(!row)fail(404,'Không tìm thấy phiếu điều chỉnh.');return row;}
 async function present(c:Ctx,rows:(typeof adjustments.$inferSelect)[]){
  const ids=[...new Set(rows.flatMap(r=>[r.createdBy,...(r.reviewedBy?[r.reviewedBy]:[])]))];
  const people=ids.length?await c.env.db.select({id:employees.id,name:employees.name}).from(employees).where(inArray(employees.id,ids)):[];
  const whs=await allowed(c),names=new Map(people.map(p=>[p.id,p.name]));
  return rows.map(({clientKey:_key,payloadHash:_hash,...r})=>({...r,lines:JSON.parse(r.lines) as Line[],warehouseName:whs.find(w=>w.id===r.warehouseId)?.name||'',createdByName:names.get(r.createdBy)||'',reviewedByName:r.reviewedBy?names.get(r.reviewedBy)||'':''}));
 }
 router.get('/inventory/adjustments',async c=>{
  guard(c);const state=c.url.searchParams.get('status')||'',wh=c.url.searchParams.get('warehouseId')||'',offset=Number(c.url.searchParams.get('offset')||0);
  if(!['','pending','approved','rejected'].includes(state)||!Number.isSafeInteger(offset)||offset<0||offset>1e6)fail(400,'Bộ lọc phiếu điều chỉnh không hợp lệ.');
  const rows=await c.env.db.select().from(adjustments).where(and(await scope(c),state?eq(adjustments.status,state as 'pending'):undefined,wh?eq(adjustments.warehouseId,wh):undefined))
   .orderBy(desc(adjustments.createdAt),desc(adjustments.id)).limit(21).offset(offset);
  const nextOffset=rows.length>20?offset+20:null;if(nextOffset!==null)rows.pop();
  return json({adjustments:await present(c,rows),nextOffset,canApprove:approve(c)});
 },'business');
 router.get('/inventory/adjustments/:id',async c=>{
  const row=await load(c,c.params.id!),lines=JSON.parse(row.lines) as Line[];
  const balances=await c.env.db.select().from(stockBalances).where(and(eq(stockBalances.warehouseId,row.warehouseId),inArray(stockBalances.sku,lines.map(l=>l.sku))));
  return json({adjustment:(await present(c,[row]))[0],balances:Object.fromEntries(balances.map(b=>[b.sku,b.qty])),canApprove:approve(c)});
 },'business');
 router.post('/inventory/adjustments',async c=>{
  guard(c);const m=me(c);if(!can(m,'inventory.manage'))fail(403,'Bạn chưa được cấp quyền lập phiếu điều chỉnh.');
  const body=await readJson(c.req,100000),reason=String(body.reason??'').trim().slice(0,500),warehouseId=String(body.warehouseId??'');
  if(reason.length<3)fail(400,'Nhập lý do điều chỉnh.');
  if(!(await c.env.db.select({id:warehouses.id}).from(warehouses).where(and(eq(warehouses.id,warehouseId),eq(warehouses.kind,'stock'),eq(warehouses.active,true))).limit(1)).length)fail(400,'Chọn kho điều chỉnh.');
  if(!(await allowed(c)).some(w=>w.id===warehouseId))fail(403,'Kho không thuộc phạm vi sổ kho của bạn.');
  const lines=cleanLines(body.lines),known=new Set((await c.env.db.select({sku:products.sku}).from(products).where(inArray(products.sku,lines.map(l=>l.sku)))).map(p=>p.sku));
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
   const id=crypto.randomUUID(),now=new Date().toISOString(),refNo='ĐC-'+new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Ho_Chi_Minh'}).format(new Date()).replaceAll('-','')+'-'+id.slice(0,8).toUpperCase();
   const status=approve(c)?'approved' as const:'pending' as const;
   await tx.insert(adjustments).values({id,refNo,clientKey,payloadHash:hash,warehouseId,reason,lines:JSON.stringify(lines),status,createdBy:m.id,createdAt:now,...(status==='approved'?{reviewedBy:m.id,reviewedAt:now}:{})});
   const written=status==='approved'?await postMoves(tx,m.id,lines.map(l=>({...l,warehouseId,kind:'adjust',refType:'adjustment',refId:id,refNo,note:reason}))):0;
   await audit(tx,m.id,id,status==='approved'?'adjustment-approved':'adjustment-submitted',{warehouseId,reason,lines,refNo});
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
   if(decision==='approved')await postMoves(tx,me(c).id,lines.map(l=>({...l,warehouseId:row.warehouseId,kind:'adjust',refType:'adjustment',refId:row.id,refNo:row.refNo,note:row.reason})));
   const now=new Date().toISOString();await tx.update(adjustments).set({status:decision,reviewedBy:me(c).id,reviewedAt:now,reviewNote:note}).where(eq(adjustments.id,row.id));
   await audit(tx,me(c).id,row.id,decision==='approved'?'adjustment-approved':'adjustment-rejected',{refNo:row.refNo,warehouseId:row.warehouseId,lines,note});
   return {...row,status:decision,replayed:false};
  });
  if(!result.replayed)await notifyMany(c.env,[result.createdBy],{eventType:'inventory_adjustment_reviewed',title:result.status==='approved'?'Phiếu điều chỉnh đã duyệt':'Phiếu điều chỉnh bị từ chối',body:result.refNo+(note?' · '+note:''),url:'/index.html#/inventory?adjustment='+encodeURIComponent(result.id),actorId:me(c).id}).catch(()=>console.warn('Adjustment notification skipped'));
  return json({ok:true,id:result.id,status:result.status,replayed:result.replayed});
 },'business');
}
