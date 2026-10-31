import {returnBalance} from '../domain/pos-return-money.ts';
import {posReturns} from '../return-schema.ts';
import {and,desc,eq,inArray,sql,count} from 'drizzle-orm';
import {AppError} from '../../../core/errors.ts';
import {json,readJson,type Router,type RouteContext} from '../../../core/http/router.ts';
import {sniffImage} from '../../../core/http/image-bytes.ts';
import {auditLogs} from '../../../core/db/schema.ts';
import type {StaffEnv,SessionState} from '../../staff/api/auth-routes.ts';
import {employees} from '../../staff/schema.ts';
import {sha256Hex} from '../../staff/domain/session.ts';
import {notifyMany} from '../../notifications/api/routes.ts';
import {parsePhotos,WH_PHOTO_MAX_CHARS} from '../../inventory/api/photos.ts';
import {salesOrders,salesContracts,salesOrderLines,deliveries,customerPayments} from '../schema.ts';
import {contractLiquidations as requests} from '../liquidation-schema.ts';
import {returnAccount} from './pos-return-credit.ts';
import {crmStockFulfilment} from './crm-stock-lifecycle.ts';
import {cashLock} from './cash-store.ts';
type Ctx=RouteContext<StaffEnv>;
type Db=StaffEnv['db'];
type Tx=Parameters<Parameters<Db['transaction']>[0]>[0];
type ReadDb=Db|Tx;
const me=(c:Ctx)=>(c.state.session as SessionState).member;
const now=()=>new Date().toISOString();
const active=(status:string)=>['pending','approved'].includes(status);
const canRequest=(c:Ctx,o:typeof salesOrders.$inferSelect)=>me(c).role==='manager'||me(c).role==='employee'&&(o.ownerId===me(c).id||o.createdBy===me(c).id||me(c).positionId==='accounting');
function missingTable(error:unknown){let e=error as {code?:string;message?:string;cause?:unknown}|undefined;for(let i=0;e&&i<6;i++,e=e.cause as typeof e)if(e.code==='42P01'&&e.message?.includes('contract_liquidation_requests'))return true;return false;}
async function history(db:ReadDb,contractId:string){try{return await db.select().from(requests).where(eq(requests.contractId,contractId)).orderBy(desc(requests.requestedAt),desc(requests.id));}catch(e){if(missingTable(e))throw new AppError(503,'Chức năng thanh lý chưa được khởi tạo. Liên hệ Manager.','LIQUIDATION_NOT_READY');throw e;}}
export async function pendingLiquidations(db:ReadDb,summary=false){
 try{
  if(summary){const [r]=await db.select({n:count()}).from(requests).where(eq(requests.status,'pending'));return {count:r?.n||0,items:[]};}
  const items=await db.select({id:requests.id,no:salesContracts.contractNo,orderId:salesContracts.orderId,customer:salesOrders.customerName,at:requests.requestedAt,by:employees.name})
   .from(requests).innerJoin(salesContracts,eq(salesContracts.id,requests.contractId)).innerJoin(salesOrders,eq(salesOrders.id,salesContracts.orderId))
   .leftJoin(employees,eq(employees.id,requests.requestedBy)).where(eq(requests.status,'pending')).orderBy(desc(requests.requestedAt)).limit(200);
  return {count:items.length,items};
 }catch(e){if(missingTable(e))return {count:0,items:[]};throw e;}
}
/** Current obligation proof. No fulfilment/receipt/invoice is inferred or written here. */
type ObligationData=[(typeof salesOrderLines.$inferSelect)[],(typeof deliveries.$inferSelect)[],Awaited<ReturnType<typeof returnAccount>>,Awaited<ReturnType<typeof crmStockFulfilment>>,{id:string;amount:number}[]];
async function obligations(db:ReadDb,o:typeof salesOrders.$inferSelect,k:typeof salesContracts.$inferSelect,supplied?:ObligationData){
 const [lines,ships,account,stock,payments]=supplied??await Promise.all([
  db.select().from(salesOrderLines).where(eq(salesOrderLines.orderId,o.id)).orderBy(salesOrderLines.id),
  db.select().from(deliveries).where(eq(deliveries.orderId,o.id)).orderBy(deliveries.id),
  returnAccount(db,o.id),crmStockFulfilment(db,[o.id]),
  db.select({id:customerPayments.id,amount:customerPayments.amount}).from(customerPayments).where(and(eq(customerPayments.orderId,o.id),sql`${customerPayments.voidedAt} is null`)).orderBy(customerPayments.id),
 ]);
 const goods=lines.filter(l=>l.sku.trim()),remaining=goods.reduce((n,l)=>n+Math.max(0,l.qty-l.deliveredQty),0);
 const checks=[
  {id:'content',label:'Nội dung và giá trị HĐKT khớp đơn hàng',ok:lines.length>0&&Math.abs(k.value-o.total)<0.5},
  {id:'signed',label:'HĐKT đã ký',ok:['signed','completed'].includes(k.status)&&!!k.signedDate},
  {id:'active',label:'HĐKT/đơn đã duyệt và còn hiệu lực',ok:!['draft','cancelled'].includes(o.status)&&k.status!=='cancelled'},
  {id:'delivery',label:'Giao đủ hàng, các chuyến giao đã hoàn tất',ok:remaining<=0.0005&&ships.every(s=>['delivered','cancelled'].includes(s.status))},
  {id:'stock',label:'Có xác nhận xuất đủ hàng đúng kho',ok:!goods.length||stock.get(o.id)?.complete===true},
  {id:'money',label:'Thu/hoàn tiền đã tất toán, không còn chênh lệch',ok:Math.abs(account.balance)<0.5},
  {id:'returns',label:'Không còn hồ sơ đổi/trả chưa hoàn tất',ok:account.returns.every(r=>['completed','cancelled','rejected'].includes(r.status))},
  {id:'invoice',label:'Hoá đơn yêu cầu đã phát hành chính thức',ok:o.invoiceStatus==='none'||o.invoiceStatus==='issued'&&!!o.invoiceNo.trim()&&o.invoiceMode==='issue'},
 ];
 const fingerprint={contract:{id:k.id,revision:k.revision,status:k.status,signedDate:k.signedDate,value:k.value},order:{id:o.id,status:o.status,total:o.total,warehouseId:o.warehouseId},
  lines:lines.map(l=>[l.id,l.sku,l.qty,l.deliveredQty,l.amount]),ships:ships.map(s=>[s.id,s.status,s.deliveredAt]),
  money:{balance:account.balance,paid:account.paid,credit:account.credit,refunded:account.refunded,exchanged:account.exchanged,
   payments,allocations:account.allocations.map(a=>[a.id,a.status,a.amount]).sort(),returns:account.returns.map(r=>[r.id,r.status,r.updatedAt]).sort(),refunds:account.refunds.map(r=>[r.id,r.amount]).sort()},
  invoice:[o.invoiceStatus,o.invoiceMode,o.invoiceNo,o.invoiceDate],stock:stock.get(o.id)?.complete??!goods.length};
 return {ready:checks.every(c=>c.ok),checks,remainingQty:remaining,balance:account.balance,manualServices:lines.filter(l=>!l.sku.trim()).length,hash:sha256Hex(JSON.stringify(fingerprint))};
}
function requireReady(proof:Awaited<ReturnType<typeof obligations>>){if(!proof.ready)throw new AppError(409,'Chưa đủ điều kiện thanh lý: '+proof.checks.filter(c=>!c.ok).map(c=>c.label).join('; '),'LIQUIDATION_OBLIGATIONS_INCOMPLETE');}
function audit(tx:Tx,actor:string,id:string,action:string,data:Record<string,unknown>){return tx.insert(auditLogs).values({id:crypto.randomUUID(),actorId:actor,module:'sales',action,entityType:'contract-liquidation',entityId:id,data:JSON.stringify(data),createdAt:now()});}
/** Keep the evidence/history even if the parent contract is later cancelled. */
export async function assertNoLiquidationHistory(db:ReadDb,orderId:string){
 const [schema]=await db.select({present:sql<string|null>`to_regclass('public.contract_liquidation_requests')::text`}).from(sql`(select 1) as probe`);
 if(!schema?.present)return;
 const [found]=await db.select({id:requests.id}).from(requests).innerJoin(salesContracts,eq(salesContracts.id,requests.contractId)).where(eq(salesContracts.orderId,orderId)).limit(1);
 if(found)throw new AppError(409,'HĐKT có lịch sử đề nghị thanh lý và ảnh hồ sơ. Giữ chứng từ để đối chiếu, không xoá hẳn.','CONTRACT_LIQUIDATION_HISTORY');
}
export function registerContractLiquidationRoutes(router:Router<StaffEnv>,loadOrder:(c:Ctx,id:string,db?:ReadDb)=>Promise<typeof salesOrders.$inferSelect>){
 async function source(c:Ctx,db:ReadDb=c.env.db,lock=false){
  const [found]=await db.select({id:salesContracts.id,orderId:salesContracts.orderId}).from(salesContracts).where(eq(salesContracts.id,c.params.id!));
  if(!found)throw new AppError(404,'Không tìm thấy HĐKT.');
  await loadOrder(c,found.orderId,db);
  if(lock)await db.select({id:salesOrders.id}).from(salesOrders).where(eq(salesOrders.id,found.orderId)).for('update');
  const o=await loadOrder(c,found.orderId,db);
  const query=db.select().from(salesContracts).where(eq(salesContracts.id,found.id));
  const [k]=await (lock?query.for('update'):query);
  if(!k)throw new AppError(404,'Không tìm thấy HĐKT.');
  return {o,k};
 }
 router.get('/contracts/:id/liquidation',async c=>{
  const {o,k}=await source(c),rows=await history(c.env.db,k.id),current=rows.find(r=>active(r.status))||rows[0]||null,proof=await obligations(c.env.db,o,k);
  const stale=!!current&&current.status==='approved'&&(!proof.ready||current.snapshotHash!==proof.hash);
  const people=rows.length?await c.env.db.select({id:employees.id,name:employees.name}).from(employees).where(inArray(employees.id,[...new Set(rows.flatMap(r=>[r.requestedBy,r.reviewedBy].filter((id):id is string=>!!id)))])):[];
  let photoUrl:string|null=null;if(current&&c.env.files){try{photoUrl=(await c.env.files.signedUrls([current.photoFileKey],900)).get(current.photoFileKey)||null;}catch{/* Keep the state readable; reviewer must retry loading the evidence. */}}
  const present=(r:typeof requests.$inferSelect)=>({id:r.id,status:r.status,requestedBy:r.requestedBy,requestedByName:people.find(p=>p.id===r.requestedBy)?.name||'',requestedAt:r.requestedAt,
   reviewedByName:people.find(p=>p.id===r.reviewedBy)?.name||'',reviewedAt:r.reviewedAt,reviewNote:r.reviewNote,revision:r.revision,originalsReceived:r.originalsReceived,servicesCompleted:r.servicesCompleted,snapshotHash:r.snapshotHash});
  return json({contractId:k.id,orderId:o.id,contractNo:k.contractNo,state:stale?'review_required':current?.status||'none',proof,current:current?{...present(current),photoUrl}:null,history:rows.slice(0,10).map(present),
   canRequest:canRequest(c,o)&&(!current||!active(current.status)||stale),canReview:me(c).role==='manager'&&current?.status==='pending'});
 },'business');
 router.post('/contracts/:id/liquidation',async c=>{
  const body=await readJson(c.req,WH_PHOTO_MAX_CHARS+4000),{o,k}=await source(c);
  if(!canRequest(c,o))throw new AppError(403,'Chỉ người phụ trách/người tạo, Kế toán hoặc Manager được đề nghị thanh lý.');
  const key=typeof body.clientKey==='string'?body.clientKey:'';
  if(!/^[A-Za-z0-9_-]{8,100}$/.test(key)||body.originalsReceived!==true||body.servicesCompleted!==true)throw new AppError(400,'Xác nhận đã nhận hồ sơ gốc, hoàn tất dịch vụ và cung cấp mã gửi hợp lệ.');
  if(!Array.isArray(body.photos)||body.photos.length!==1)throw new AppError(400,'Chụp/chọn đúng 1 ảnh hồ sơ gốc.');
  const [photo]=parsePhotos(body.photos,{min:1});if(!photo||sniffImage(photo.bytes)!==photo.mime)throw new AppError(400,'Ảnh hồ sơ không hợp lệ.');
  const payloadHash=sha256Hex(JSON.stringify({contractId:k.id,originalsReceived:true,servicesCompleted:true,expectedHash:body.expectedHash,photo:sha256Hex(body.photos[0])}));
  const rows=await history(c.env.db,k.id),prior=rows.find(r=>r.requestedBy===me(c).id&&r.clientKey===key);
  if(prior){if(prior.payloadHash!==payloadHash)throw new AppError(409,'Cùng mã gửi nhưng khác nội dung.','COMMAND_CONFLICT');return json({id:prior.id,status:prior.status,replayed:true});}
  const before=await obligations(c.env.db,o,k);requireReady(before);
  if(body.expectedHash!==before.hash)throw new AppError(409,'Điều kiện HĐKT đã thay đổi. Tải lại trước khi gửi.','LIQUIDATION_CHANGED');
  if(!c.env.files)throw new AppError(503,'Chưa lưu được ảnh hồ sơ. Thử lại sau.');
  const candidate=crypto.randomUUID(),fileKey=`contract-liquidations/${k.id}/${candidate}.${photo.ext}`;
  try{await c.env.files.put(fileKey,photo.bytes,photo.mime);}catch(e){await c.env.files.remove([fileKey]).catch(()=>{});throw e;}
  let keep=false,resolved=false;
  try{
   const result=await c.env.db.transaction(async tx=>{
    await cashLock(tx);const fresh=await source(c,tx,true);if(!canRequest(c,fresh.o))throw new AppError(403,'Không còn quyền đề nghị thanh lý.');
    const existing=await history(tx,k.id),replay=existing.find(r=>r.requestedBy===me(c).id&&r.clientKey===key);
    if(replay){if(replay.payloadHash!==payloadHash)throw new AppError(409,'Cùng mã gửi nhưng khác nội dung.','COMMAND_CONFLICT');return {id:replay.id,status:replay.status,replayed:true};}
    const proof=await obligations(tx,fresh.o,fresh.k);requireReady(proof);
    if(body.expectedHash!==proof.hash)throw new AppError(409,'Điều kiện HĐKT đã thay đổi. Tải lại trước khi gửi.','LIQUIDATION_CHANGED');
    const current=existing.find(r=>active(r.status));
    if(current?.status==='pending'||current?.status==='approved'&&current.snapshotHash===proof.hash)throw new AppError(409,'Đã có đề nghị chờ duyệt hoặc HĐKT đã thanh lý. Tải lại để xem.','LIQUIDATION_EXISTS');
    if(current)await tx.update(requests).set({status:'superseded'}).where(eq(requests.id,current.id));
    const inserted=await tx.insert(requests).values({id:candidate,contractId:k.id,clientKey:key,payloadHash,status:'pending',originalsReceived:true,servicesCompleted:true,photoFileKey:fileKey,snapshotHash:proof.hash,snapshot:JSON.stringify(proof),requestedBy:me(c).id,requestedAt:now()}).onConflictDoNothing().returning({id:requests.id});
    if(!inserted.length)throw new AppError(409,'Mã gửi hoặc đề nghị thanh lý đã tồn tại. Tải lại kiểm tra.','COMMAND_CONFLICT');
    await audit(tx,me(c).id,candidate,'contract-liquidation-request',{contractId:k.id,orderId:o.id,snapshotHash:proof.hash,supersedes:current?.id||null});
    return {id:candidate,status:'pending',replayed:false};
   });
   resolved=true;keep=!result.replayed;
   if(keep)await notifyMany(c.env,'managers',{eventType:'contract_liquidation_requested',title:'HĐKT chờ duyệt thanh lý',body:k.contractNo,url:`/index.html#/contracts/${o.id}`,actorId:me(c).id}).catch(()=>console.warn('liquidation request notification skipped'));
   return json(result,result.replayed?200:201);
  }catch(e){if(e instanceof AppError)resolved=true;throw e;}finally{
   // A lost commit acknowledgement may mean the row exists. Keep its photo on unknown DB failure.
   if(resolved&&!keep)await c.env.files.remove([fileKey]).catch(()=>console.warn('liquidation candidate photo cleanup skipped'));
  }
 },'business');
 router.post('/contracts/:id/liquidation/:requestId/review',async c=>{
  if(me(c).role!=='manager')throw new AppError(403,'Chỉ Manager được duyệt/từ chối thanh lý HĐKT.');
  const b=await readJson(c.req,4000),decision=b.decision,note=typeof b.note==='string'?b.note.trim():'';
  if(!['approved','rejected'].includes(String(decision))||note.length>1000||decision==='rejected'&&note.length<3)throw new AppError(400,'Chọn quyết định hợp lệ; từ chối phải có lý do ít nhất 3 ký tự.');
  if(decision==='approved'&&b.confirmOriginals!==true)throw new AppError(400,'Xác nhận đã kiểm tra ảnh hồ sơ gốc và toàn bộ nghĩa vụ.');
  const result=await c.env.db.transaction(async tx=>{
   await cashLock(tx);const {o,k}=await source(c,tx,true);
   const [r]=await tx.select().from(requests).where(and(eq(requests.id,c.params.requestId!),eq(requests.contractId,k.id))).for('update');
   if(!r)throw new AppError(404,'Không tìm thấy đề nghị thanh lý.');
   if(r.status===decision&&r.reviewedBy===me(c).id&&r.reviewNote===note&&r.revision===Number(b.revision)+1)return {id:r.id,status:r.status,orderId:o.id,requestedBy:r.requestedBy,replayed:true};
   if(r.status!=='pending'||b.revision!==r.revision)throw new AppError(409,'Đề nghị đã được xử lý hoặc phiên bản đã đổi. Tải lại trước khi duyệt.','LIQUIDATION_CONFLICT');
   if(decision==='approved'){
    const proof=await obligations(tx,o,k);requireReady(proof);
    if(r.snapshotHash!==proof.hash||b.expectedHash!==proof.hash)throw new AppError(409,'Nghĩa vụ/nội dung HĐKT đã thay đổi. Từ chối và lập lại đề nghị kèm hồ sơ phù hợp.','LIQUIDATION_CHANGED');
   }
   await tx.update(requests).set({status:decision as 'approved'|'rejected',reviewedBy:me(c).id,reviewedAt:now(),reviewNote:note,revision:r.revision+1}).where(eq(requests.id,r.id));
   await audit(tx,me(c).id,r.id,'contract-liquidation-'+decision,{contractId:k.id,orderId:o.id,note,snapshotHash:r.snapshotHash});
   return {id:r.id,status:String(decision),orderId:o.id,requestedBy:r.requestedBy,replayed:false};
  });
  if(!result.replayed)await notifyMany(c.env,[result.requestedBy],{eventType:'contract_liquidation_reviewed',title:result.status==='approved'?'HĐKT đã được duyệt thanh lý':'Đề nghị thanh lý bị từ chối',body:note||'Mở HĐKT để xem hồ sơ.',url:`/index.html#/contracts/${result.orderId}`,actorId:me(c).id}).catch(()=>console.warn('liquidation review notification skipped'));
  return json({id:result.id,status:result.status,replayed:result.replayed});
 },'business');
}

/** Payroll only receives a validated approval date, never private original-document photos. */
export async function liquidationAwards(db:ReadDb,ids:readonly string[]){
 const result=new Map<string,{at:string;valid:boolean}>();if(!ids.length)return result;
 const rows=await db.select({request:requests,contract:salesContracts,order:salesOrders}).from(requests).innerJoin(salesContracts,eq(salesContracts.id,requests.contractId)).innerJoin(salesOrders,eq(salesOrders.id,salesContracts.orderId))
  .where(and(inArray(requests.contractId,[...ids]),eq(requests.status,'approved')));
 const orderIds=rows.map(r=>r.order.id);if(!orderIds.length)return result;
 const cutoff=now();const [lines,ships,payments,returns,stock]=await Promise.all([
  db.select().from(salesOrderLines).where(inArray(salesOrderLines.orderId,orderIds)).orderBy(salesOrderLines.id),
  db.select().from(deliveries).where(inArray(deliveries.orderId,orderIds)).orderBy(deliveries.id),
  db.select().from(customerPayments).where(inArray(customerPayments.orderId,orderIds)).orderBy(customerPayments.id),
  db.select({orderId:posReturns.orderId}).from(posReturns).where(inArray(posReturns.orderId,orderIds)),crmStockFulfilment(db,orderIds),
 ]);
 const withReturns=new Set(returns.map(r=>r.orderId));
 for(const r of rows){
  const ps=payments.filter(p=>p.orderId===r.order.id),paid=ps.filter(p=>p.createdAt<=cutoff&&(!p.voidedAt||p.voidedAt>cutoff)).reduce((n,p)=>n+p.amount,0);
  const account=withReturns.has(r.order.id)?await returnAccount(db,r.order.id,cutoff):{...returnBalance(r.order.total,paid,0,0,0),credit:0,refunded:0,exchanged:0,paid,returns:[],refunds:[],allocations:[]};
  const proof=await obligations(db,r.order,r.contract,[lines.filter(l=>l.orderId===r.order.id),ships.filter(s=>s.orderId===r.order.id),account,stock,ps.filter(p=>!p.voidedAt).map(p=>({id:p.id,amount:p.amount}))]);
  result.set(r.contract.id,{at:r.request.reviewedAt!,valid:proof.ready&&proof.hash===r.request.snapshotHash});
 }
 return result;
}
