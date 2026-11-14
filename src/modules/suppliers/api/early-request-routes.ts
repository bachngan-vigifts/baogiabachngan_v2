import { and, asc, desc, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm';
import { earlyListFilter } from './early-list-filter.ts';
import { AppError } from '../../../core/errors.ts';
import { auditLogs } from '../../../core/db/schema.ts';
import { json, readJson, type Router, type RouteContext } from '../../../core/http/router.ts';
import type { SessionState, StaffEnv } from '../../staff/api/auth-routes.ts';
import { isSupplier } from '../../staff/domain/roles.ts';
import { sha256Hex } from '../../staff/domain/session.ts';
import { vietnamDate } from '../../sales/domain/sales.ts';
import { purchaseEarlyRequests as requests, purchaseEarlyRequestLines as lines, purchaseEarlyRequestAllocations as allocations } from '../early-request-schema.ts';
import { incomingShipments, incomingShipmentLines, supplierAccounts, suppliers } from '../schema.ts';
import { earlyReceiptAvailability, earlyReceiptContext } from './early-receiving.ts';
import { canUsePurchasing, canReceive, canSendEarlyRequest, canViewEarlyRequests } from '../domain/purchasing.ts';
import { incomingBySku } from './incoming-by-sku.ts';
import { isIsoDate } from '../domain/quantity.ts';
import {resolveEarlyOrderSources,EarlySourceError} from '../domain/early-order-sources.ts';
import {deleteEarlyRequest,splitEarlyRequest,splitResult,cancelEarlySlip} from './early-request-lifecycle.ts';
import {products} from '../../catalog/schema.ts';
import type { Db, Member } from './purchase-store.ts';
type Ctx = RouteContext<StaffEnv>;
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
const me = (c: Ctx) => (c.state.session as SessionState).member;
function fail(status:number, message:string, code?:string):never { throw new AppError(status,message,code); }
export { canSendEarlyRequest } from '../domain/purchasing.ts';
const guard = (c:Ctx) => { if(!canUsePurchasing(me(c))) fail(403,'Bạn không có quyền xem yêu cầu lấy trước.'); };
const asDb = (tx:Tx) => tx as unknown as Db;
async function supplierFor(c:Ctx) {
  const m=me(c);
  if(!isSupplier(m)) fail(403,'Chỉ tài khoản NCC được phản hồi yêu cầu của mình.');
  const [mapping]=await c.env.db.select({id:suppliers.id}).from(supplierAccounts).innerJoin(suppliers,eq(suppliers.id,supplierAccounts.supplierId))
    .where(and(eq(supplierAccounts.memberId,m.id),eq(suppliers.active,true))).limit(1);
  if(!mapping) fail(403,'Tài khoản chưa được gắn với NCC đang hoạt động.');
  return mapping.id;
}
type OrderSource = {orderNo:string;supplierOrderNo:string;quantity:number};
function allowUnresolvedDraft(body:Record<string,unknown>){if(body.allowUnresolvedSources!==undefined&&typeof body.allowUnresolvedSources!=='boolean')fail(400,'Tuỳ chọn nháp chưa chốt nguồn không hợp lệ.');return body.allowUnresolvedSources===true;}
const sourceKey = (value:string) => value.trim().toLocaleLowerCase('vi');
function cleanSources(raw:unknown,quantity:number,sku:string):OrderSource[]|undefined {
  if(raw===undefined)return;
  if(!Array.isArray(raw)||!raw.length||raw.length>300)fail(400,`${sku}: nguồn đơn mua không hợp lệ.`);
  const seen=new Set<string>();
  const sources=raw.map((entry:unknown)=>{
    const r=entry&&typeof entry==='object'?entry as Record<string,unknown>:{};
    if(r.orderNo!==undefined&&(typeof r.orderNo!=='string'||r.orderNo.length>200)||r.supplierOrderNo!==undefined&&(typeof r.supplierOrderNo!=='string'||r.supplierOrderNo.length>200))fail(400,`${sku}: số đơn mua CRM / số đơn NCC không hợp lệ.`);
    if(typeof r.quantity!=='number'||!Number.isSafeInteger(r.quantity)||r.quantity<=0)fail(400,`${sku}: số lượng theo đơn phải là số nguyên dương.`);
    const orderNo=typeof r.orderNo==='string'?r.orderNo.trim():'',supplierOrderNo=typeof r.supplierOrderNo==='string'?r.supplierOrderNo.trim():'';
    const key=orderNo?'crm:'+sourceKey(orderNo):supplierOrderNo?'supplier:'+sourceKey(supplierOrderNo):'auto';
    if(seen.has(key))fail(400,`${sku}: nguồn đơn mua bị lặp.`);seen.add(key);
    return {orderNo,supplierOrderNo,quantity:r.quantity};
  }).sort((a,b)=>sourceKey(a.orderNo).localeCompare(sourceKey(b.orderNo)));
  if(sources.reduce((sum,r)=>sum+r.quantity,0)!==quantity)fail(400,`${sku}: tổng số lượng theo đơn không khớp số lượng xin.`);
  return sources;
}
function cleanInput(body:Record<string,unknown>,preserved:Record<string,OrderSource[]>={}) {
  if(typeof body.clientKey!=='string' || !/^[a-zA-Z0-9_-]{8,100}$/.test(body.clientKey)) fail(400,'Khóa gửi yêu cầu không hợp lệ.');
  if(!Array.isArray(body.lines) || !body.lines.length || body.lines.length>300) fail(400,'Chọn từ 1 đến 300 mã hàng.');
  const seen=new Set<string>();
  const selected=body.lines.map((raw:unknown)=>{
    const r=raw && typeof raw==='object'?raw as Record<string,unknown>:{};
    const sku=typeof r.sku==='string'?r.sku.trim():'';
    if(!sku || sku.length>200 || seen.has(sku)) fail(400,'Mã hàng trống hoặc bị lặp.'); seen.add(sku);
    if(typeof r.quantity!=='number' || !Number.isSafeInteger(r.quantity) || r.quantity<=0) fail(400,`${sku}: số lượng phải là số nguyên dương.`);
    const sourceOrders=cleanSources(r.sourceOrders??preserved[sku],r.quantity,sku);
    return {sku,quantity:r.quantity,...(sourceOrders?{sourceOrders}:{})};
  }).sort((a,b)=>a.sku.localeCompare(b.sku));
  if(selected.reduce((sum,l)=>sum+(l.sourceOrders?.length||1),0)>300)fail(400,'Mỗi phiếu tối đa 300 dòng nguồn đơn mua.');
  const raw=body.scope && typeof body.scope==='object' && !Array.isArray(body.scope)?body.scope as Record<string,unknown>:{};
  const scope:Record<string,string>={};
  for(const key of ['supplierId','from','to','status']) {
    const value=raw[key]??'';
    if(typeof value!=='string' || value.length>200) fail(400,'Bộ lọc gửi yêu cầu không hợp lệ.');
    scope[key]=value;
  }
  if(raw.pxkNo!==undefined){if(typeof raw.pxkNo!=='string'||raw.pxkNo.length>200)fail(400,'Số PXK không hợp lệ.');scope.pxkNo=raw.pxkNo.trim();}
  scope.status ||= 'all';
  const pinned=Object.fromEntries(selected.filter(l=>l.sourceOrders).map(l=>[l.sku,l.sourceOrders]));
  if(Object.keys(pinned).length)scope.orderSources=JSON.stringify(pinned);
  const pickupDate=body.pickupDate??'';
  if(typeof pickupDate!=='string'||pickupDate!==''&&!isIsoDate(pickupDate)) fail(400,'Ngày lấy không hợp lệ.');
  return {clientKey:body.clientKey,selected,scope,pickupDate};
}
const stateOf = (statuses:readonly string[]) => statuses.every(s=>s==='accepted')?'accepted':statuses.every(s=>s==='rejected')?'rejected':statuses.some(s=>s==='pending')?'pending':'mixed';

/** Header pagination precedes line loading, so a multi-line request is never truncated. NCC filtering happens in SQL. */
export async function earlyRequestList(db:Db, supplierId:string|null, id:string|readonly string[]='', submittedOnly=false, page?:{where?:SQL;limit:number;offset:number}) {
  const scope=supplierId?sql`exists(select 1 from ${lines} join ${allocations} on ${allocations.requestLineId}=${lines.id} where ${lines.requestId}=${requests.id} and ${allocations.supplierId}=${supplierId})`:undefined;
  const headers=await db.select().from(requests).where(and(isNull(requests.deletedAt),id?(typeof id==='string'?eq(requests.id,id):inArray(requests.id,[...id])):undefined,scope,submittedOnly?eq(requests.status,'submitted'):undefined,page?.where)).orderBy(desc(requests.createdAt),desc(requests.id)).limit(typeof id!=='string'?id.length:page?.limit??50).offset(page?.offset??0);
  if(id && !headers.length) fail(404,'Không tìm thấy yêu cầu lấy trước.');
  if(!headers.length) return [];
  const details=await db.select({line:lines,catalogName:products.name,allocation:allocations,orderId:incomingShipments.id,ticketNumber:incomingShipments.ticketNumber,supplierOrderNo:incomingShipments.supplierInternalOrderNumber,
    supplierName:suppliers.name,due:sql<string>`coalesce(nullif(${incomingShipmentLines.promisedDate},''),${incomingShipments.arrivalDate},'')`})
    .from(lines).leftJoin(allocations,eq(allocations.requestLineId,lines.id)).leftJoin(incomingShipmentLines,eq(incomingShipmentLines.id,allocations.purchaseLineId))
    .leftJoin(incomingShipments,eq(incomingShipments.id,incomingShipmentLines.shipmentId)).leftJoin(suppliers,eq(suppliers.id,allocations.supplierId)).leftJoin(products,eq(products.sku,lines.sku))
    .where(and(inArray(lines.requestId,headers.map(r=>r.id)),supplierId?eq(allocations.supplierId,supplierId):undefined)).orderBy(asc(lines.lineNo),asc(allocations.id));
  return headers.map(h=>{
    const own=details.filter(d=>d.line.requestId===h.id),groups=new Map<string,typeof own>();
    for(const d of own) { const group=groups.get(d.line.id)||[];group.push(d);groups.set(d.line.id,group); }
    return {id:h.id,ticketNumber:h.ticketNumber,createdAt:h.createdAt,updatedAt:h.updatedAt||h.createdAt,pickupDate:h.pickupDate,revision:h.revision,requestStatus:h.status,pxkNo:JSON.parse(h.scope).pxkNo||'',
      ...(!supplierId?{createdBy:h.createdBy,scope:JSON.parse(h.scope)}:{}),status:h.status==='draft'?'draft':stateOf(own.flatMap(d=>d.allocation?[d.allocation.status]:[])),
      lines:[...groups].map(([lineId,group])=>({id:lineId,sku:group[0]!.line.sku,name:group[0]!.catalogName?.trim()||group[0]!.line.name,unit:group[0]!.line.unit,
        // Supplier sees ONLY its quantities/statuses, never a cross-supplier line total.
        quantity:supplierId?group.reduce((sum,d)=>sum+(d.allocation?.quantity||0),0):group[0]!.line.quantity,status:group.some(d=>d.allocation)?stateOf(group.flatMap(d=>d.allocation?[d.allocation.status]:[])):'unresolved',
        allocations:group.filter(d=>d.allocation).map(d=>({id:d.allocation!.id,orderId:d.orderId,ticketNumber:d.ticketNumber,supplierOrderNo:d.supplierOrderNo,supplierId:d.allocation!.supplierId,
          supplierName:d.supplierName,quantity:d.allocation!.quantity,due:d.due,status:d.allocation!.status,
          respondedAt:d.allocation!.respondedAt,responseNote:d.allocation!.responseNote}))}))};
  });
}

async function replaceDraftLines(tx:Tx,id:string,input:ReturnType<typeof cleanInput>,used?:Map<string,number>,allowUnresolved=false) {
  for(const l of input.selected) await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'early-sku:'+l.sku}))`);
  const q=new URLSearchParams(input.scope);q.set('selected','1');for(const l of input.selected) q.append('sku',l.sku);
  const initial=await incomingBySku(asDb(tx),q,vietnamDate().iso,false);
  const orderIds=[...new Set(initial.rows.flatMap(r=>r.orders.map(o=>o.id)))].sort();
  if(!orderIds.length&&!allowUnresolved) fail(409,'Các mã đã chọn không còn hàng đang về.');
  if(orderIds.length)await tx.select({id:incomingShipments.id}).from(incomingShipments).where(inArray(incomingShipments.id,orderIds)).orderBy(asc(incomingShipments.id)).for('update');
  const current=await incomingBySku(asDb(tx),q,vietnamDate().iso,false);
  const oldLines=await tx.select({id:lines.id}).from(lines).where(eq(lines.requestId,id));
  if(oldLines.length) await tx.delete(allocations).where(inArray(allocations.requestLineId,oldLines.map(l=>l.id)));
  await tx.delete(lines).where(eq(lines.requestId,id));
  const resolvedSources:Record<string,OrderSource[]>={},unresolved:Record<string,string>={};
  const catalog=new Map((await tx.select({sku:products.sku,name:products.name,unit:products.unit}).from(products).where(inArray(products.sku,input.selected.map(l=>l.sku)))).map(p=>[p.sku,p]));
  for(const [i,want] of input.selected.entries()) {
    const row=current.rows.find(r=>r.sku===want.sku),allOrders=(row?.orders.filter(o=>orderIds.includes(o.id))||[]).map(o=>({...o,quantity:Math.max(0,o.quantity-(used?.get(o.lineId)||0))}));
    let resolved;
    try{resolved=resolveEarlyOrderSources(allOrders,want.sourceOrders??[{orderNo:'',supplierOrderNo:'',quantity:want.quantity}]);}
    catch(e){if(e instanceof EarlySourceError&&allowUnresolved){unresolved[want.sku]=e.message;}else if(e instanceof EarlySourceError)fail(409,`${want.sku}: ${e.message}`,e.code);else throw e;}
    if(want.sourceOrders)resolvedSources[want.sku]=resolved?.sources.length?resolved.sources:want.sourceOrders;
    const item=catalog.get(want.sku),lineId=crypto.randomUUID();
    if(!row&&!item)fail(409,`${want.sku}: không tìm thấy mã hàng trong danh mục.`);
    await tx.insert(lines).values({id:lineId,requestId:id,lineNo:i+1,sku:want.sku,name:row?.name||item?.name||'',unit:resolved?.unit||item?.unit||'',quantity:want.quantity});
    if(!resolved)continue;
    for(const {order,quantity} of resolved.allocations){
      if(used)used.set(order.lineId,(used.get(order.lineId)||0)+quantity);
      if(!order.supplierId)fail(409,`${want.sku}: đơn mua chưa có NCC.`);
      await tx.insert(allocations).values({id:crypto.randomUUID(),requestLineId:lineId,purchaseLineId:order.lineId,supplierId:order.supplierId,quantity,status:'pending'});
    }
  }
  if(Object.keys(resolvedSources).length){
    if(Object.values(resolvedSources).reduce((n,s)=>n+s.length,0)>300)fail(400,'Phân bổ vượt 300 nguồn đơn mua; tách thành phiếu nhỏ hơn.');
    input.scope.orderSources=JSON.stringify(resolvedSources);
  }
  if(Object.keys(unresolved).length)input.scope.unresolvedOrders=JSON.stringify(unresolved);else delete input.scope.unresolvedOrders;
  await tx.update(requests).set({scope:JSON.stringify(input.scope)}).where(eq(requests.id,id));
}
async function audit(tx:Tx,m:Member,id:string,action:string,data:Record<string,unknown>) {
  await tx.insert(auditLogs).values({id:crypto.randomUUID(),actorId:m.id,module:'suppliers',action,entityType:'purchase-early-requests',entityId:id,data:JSON.stringify(data),createdAt:new Date().toISOString()});
}

/** Lock the same line for supplier and Manager responses; no inventory receipt is posted here. */
async function respondEarlyLine(db:Db, actorId:string, id:string, supplierId:string, status:'accepted'|'rejected', note:string, auditAction:string) {
  return db.transaction(async tx=>{
      await tx.select({id:lines.id}).from(lines).where(eq(lines.id,id)).for('update');
      const own=await tx.select().from(allocations).where(and(eq(allocations.requestLineId,id),eq(allocations.supplierId,supplierId)));
      if(!own.length) fail(404,'Không tìm thấy dòng yêu cầu của NCC này.');
      const [parent]=await tx.select({status:requests.status,deletedAt:requests.deletedAt}).from(lines).innerJoin(requests,eq(requests.id,lines.requestId)).where(eq(lines.id,id));
      if(parent?.status!=='submitted'||parent.deletedAt) fail(404,'Không tìm thấy dòng yêu cầu đã gửi NCC.');
      const resolved=own.filter(a=>a.status!=='pending');
      if(resolved.length) {
        if(resolved.length===own.length&&resolved.every(a=>a.status===status&&a.responseNote===note)) return {replayed:true};
        fail(409,'Dòng yêu cầu đã được phản hồi, vui lòng tải lại.');
      }
      const now=new Date().toISOString();
      await tx.update(allocations).set({status,responseNote:note,respondedAt:now,respondedBy:actorId}).where(inArray(allocations.id,own.map(a=>a.id)));
      await tx.insert(auditLogs).values({id:crypto.randomUUID(),actorId,module:'suppliers',action:auditAction,entityType:'purchase-early-request-lines',entityId:id,
        data:JSON.stringify({supplierId,status,note,allocations:own.map(a=>({id:a.id,quantity:a.quantity}))}),createdAt:now});
      return {replayed:false};
  });
}

async function withReceiptAvailability(db:Db, rows:Awaited<ReturnType<typeof earlyRequestList>>) {
  const availability=await earlyReceiptAvailability(db,rows.map(r=>r.id)),byAllocation=new Map(availability.map(r=>[r.allocationId,r]));
  return rows.map(r=>({...r,lines:r.lines.map(l=>({...l,allocations:l.allocations.map(a=>({...a,remainingToReceive:byAllocation.get(a.id)?.remaining??0,receivedQty:byAllocation.get(a.id)?.receivedQty??0,receivedElsewhere:byAllocation.get(a.id)?.receivedElsewhere??0,purchaseRemaining:byAllocation.get(a.id)?.purchaseRemaining??0}))}))}));
}

export function registerEarlyRequestRoutes(router:Router<StaffEnv>) {
  router.get('/purchase-early-requests/order-options',async c=>{
    guard(c);if(!canSendEarlyRequest(me(c)))fail(403,'Bạn chưa được cấp quyền chọn đơn mua.');
    const sku=(c.url.searchParams.get('sku')||'').trim(),supplierOrderNo=(c.url.searchParams.get('supplierOrderNo')||'').trim().toLocaleLowerCase('vi'),supplierId=(c.url.searchParams.get('supplierId')||'').trim();
    if(!sku||sku.length>200||supplierOrderNo.length>200||supplierId.length>200)fail(400,'Mã hàng không hợp lệ.');
    const rows=await c.env.db.select({orderId:incomingShipments.id,lineId:incomingShipmentLines.id,ticketNumber:incomingShipments.ticketNumber,
      supplierOrderNo:incomingShipments.supplierInternalOrderNumber,supplierId:incomingShipments.supplierId,supplierName:suppliers.name,
      approvalStatus:incomingShipments.approvalStatus,submittedAt:incomingShipments.submittedAt,quantity:incomingShipmentLines.quantity,
      name:incomingShipmentLines.name,unit:incomingShipmentLines.unit,warehouse:incomingShipments.warehouse,createdAt:incomingShipments.createdAt})
      .from(incomingShipmentLines).innerJoin(incomingShipments,eq(incomingShipments.id,incomingShipmentLines.shipmentId)).innerJoin(suppliers,eq(suppliers.id,incomingShipments.supplierId))
      .where(and(eq(incomingShipmentLines.sku,sku),eq(incomingShipments.source,'supplier-order'),isNull(incomingShipments.cancelledAt),supplierId?eq(incomingShipments.supplierId,supplierId):undefined)).orderBy(desc(incomingShipments.createdAt));
    const options=rows.map(r=>({...r,exactSupplierOrderNo:!!supplierOrderNo&&r.supplierOrderNo.trim().toLocaleLowerCase('vi')===supplierOrderNo}));
    options.sort((a,b)=>Number(b.exactSupplierOrderNo)-Number(a.exactSupplierOrderNo)||b.createdAt.localeCompare(a.createdAt));
    return json({sku,options});
  },'business');
  router.get('/purchase-early-requests',async c=>{
    guard(c);if(!canViewEarlyRequests(me(c)))fail(403,'Bạn chưa được cấp quyền xem phiếu xin hàng trước.');const supplierId=c.url.searchParams.get('supplierId')||null,page=earlyListFilter(c.url.searchParams,supplierId);
    const id=c.url.searchParams.get('id')||'';
    const replacements=id?await splitResult(c.env.db,id):null;
    const requests=await earlyRequestList(c.env.db,supplierId,replacements||id,false,{...page,limit:page.limit+1});
    const nextOffset=!id&&requests.length>page.limit?page.offset+page.limit:null;if(nextOffset!==null)requests.pop();
    return json({requests:await withReceiptAvailability(c.env.db,requests),nextOffset,canSend:canSendEarlyRequest(me(c)),canViewPortal:me(c).role==='manager',canReceive:canReceive(me(c))});
  },'business');
  router.get('/purchase-early-requests/:id/receiving',async c=>{
    guard(c);if(!canReceive(me(c)))fail(403,'Bạn không có quyền nhận hàng NCC.');
    return json(await earlyReceiptContext(c.env.db,c.params.id!,c.url.searchParams.get('orderId')||''));
  },'business');
  // One workbook is one transaction and one retry key; grouping never submits or receives stock.
  router.post('/purchase-early-requests/file',async c=>{
    guard(c);const m=me(c);if(!canSendEarlyRequest(m))fail(403,'Bạn chưa được cấp quyền xin hàng trước.');
    const body=await readJson(c.req,300000);
    if(!Array.isArray(body.groups)||!body.groups.length||body.groups.length>300)fail(400,'File cần từ 1 đến 300 nhóm PXK.');
    const seen=new Set<string>();
    const inputs=body.groups.map(raw=>{
      if(!raw||typeof raw!=='object'||Array.isArray(raw))fail(400,'Nhóm PXK không hợp lệ.');
      const group=raw as Record<string,unknown>,pxkNo=group.pxkNo??'';
      if(typeof pxkNo!=='string'||pxkNo.length>200||/[\r\n\u0000-\u001f]/.test(pxkNo))fail(400,'Số PXK tối đa 200 ký tự trên một dòng.');
      const key=pxkNo.trim().normalize('NFC').toLocaleLowerCase('vi');if(seen.has(key))fail(400,'Số PXK bị lặp nhóm.');seen.add(key);
      const input=cleanInput({...body,lines:group.lines});input.scope.pxkNo=pxkNo.trim();return input;
    });
    if(inputs.reduce((sum,input)=>sum+input.selected.reduce((n,line)=>n+(line.sourceOrders?.length||1),0),0)>300)fail(400,'File tối đa 300 dòng nguồn đơn mua.');
    const batchId='early-file-'+sha256Hex(m.id+':'+inputs[0]!.clientKey),payloadHash=sha256Hex(JSON.stringify(inputs));
    const result=await c.env.db.transaction(async tx=>{
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${batchId}))`);
      const [prior]=await tx.select({data:auditLogs.data}).from(auditLogs).where(eq(auditLogs.id,batchId));
      if(prior){const saved=JSON.parse(prior.data);if(saved.payloadHash!==payloadHash)fail(409,'Khóa gửi đã dùng cho file khác.','IDEMPOTENCY_CONFLICT');return {requestIds:saved.requestIds as string[],replayed:true};}
      // Lock all SKU/order sources in a stable order before creating any group.
      const skus=[...new Set(inputs.flatMap(input=>input.selected.map(l=>l.sku)))].sort();
      for(const sku of skus)await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'early-sku:'+sku}))`);
      const q=new URLSearchParams(inputs[0]!.scope);q.set('selected','1');for(const sku of skus)q.append('sku',sku);
      const available=await incomingBySku(asDb(tx),q,vietnamDate().iso,false),orderIds=[...new Set(available.rows.flatMap(r=>r.orders.map(o=>o.id)))].sort();
      if(orderIds.length)await tx.select({id:incomingShipments.id}).from(incomingShipments).where(inArray(incomingShipments.id,orderIds)).orderBy(asc(incomingShipments.id)).for('update');
      const requestIds:string[]=[],used=new Map<string,number>(),now=new Date().toISOString();
      for(const [i,input] of inputs.entries()){
        const id=crypto.randomUUID();
        await tx.insert(requests).values({id,clientKey:'file_'+sha256Hex(batchId+':'+i),payloadHash,createdBy:m.id,createdAt:now,status:'draft',pickupDate:input.pickupDate,scope:JSON.stringify(input.scope),updatedAt:now});
        await replaceDraftLines(tx,id,input,used);requestIds.push(id);
        await audit(tx,m,id,'early-request-draft-create',{lines:input.selected,scope:input.scope,pickupDate:input.pickupDate});
      }
      await tx.insert(auditLogs).values({id:batchId,actorId:m.id,module:'suppliers',action:'early-request-file-create',entityType:'purchase-early-requests',entityId:requestIds[0]!,data:JSON.stringify({payloadHash,requestIds}),createdAt:now});
      return {requestIds,replayed:false};
    });
    const saved=await earlyRequestList(c.env.db,null,result.requestIds);
    return json({...result,id:result.requestIds[0],requests:saved,request:saved[0]},result.replayed?200:201);
  },'business');
  router.post('/purchase-early-requests',async c=>{
    guard(c);const m=me(c);if(!canSendEarlyRequest(m)) fail(403,'Bạn chưa được cấp quyền xin hàng trước.');
    const body=await readJson(c.req,300000),input=cleanInput(body),groupBySupplierOrder=body.groupBySupplierOrder===true,allowUnresolved=allowUnresolvedDraft(body);
    if(body.groupBySupplierOrder!==undefined&&typeof body.groupBySupplierOrder!=='boolean')fail(400,'Tuỳ chọn gom phiếu không hợp lệ.');
    const payloadHash=sha256Hex(JSON.stringify({lines:input.selected,scope:input.scope,pickupDate:input.pickupDate,...(groupBySupplierOrder?{groupBySupplierOrder:true}:{}),...(allowUnresolved?{allowUnresolvedSources:true}:{})}));
    const result=await c.env.db.transaction(async tx=>{
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'early-key:'+m.id+':'+input.clientKey}))`);
      const [old]=await tx.select().from(requests).where(and(eq(requests.createdBy,m.id),eq(requests.clientKey,input.clientKey))).limit(1);
      if(old) { if(old.payloadHash!==payloadHash) fail(409,'Khóa gửi đã được dùng cho nội dung khác.','IDEMPOTENCY_CONFLICT');if(old.deletedAt&&!await splitResult(tx,old.id))fail(409,'Phiếu đã xoá, không tạo lại bằng lần gửi cũ.');return {id:old.id,replayed:true,requestIds:await splitResult(tx,old.id)||[old.id]}; }
      const now=new Date().toISOString(),id=crypto.randomUUID();
      await tx.insert(requests).values({id,clientKey:input.clientKey,payloadHash,createdBy:m.id,createdAt:now,status:'draft',pickupDate:input.pickupDate,scope:JSON.stringify(input.scope),updatedAt:now});
      await replaceDraftLines(tx,id,input,undefined,allowUnresolved);
      if(groupBySupplierOrder&&input.scope.unresolvedOrders)fail(409,'Chốt nguồn đơn mua trước khi tách phiếu theo NCC.','EARLY_UNRESOLVED');
      await audit(tx,m,id,'early-request-draft-create',{lines:input.selected,scope:input.scope,pickupDate:input.pickupDate});
      return {id,replayed:false,requestIds:groupBySupplierOrder?await splitEarlyRequest(tx,id,m.id):[id]};
    });
    const requestIds=result.requestIds;
    const saved=await earlyRequestList(c.env.db,null,requestIds);
    return json({...result,requests:saved,request:saved[0]},result.replayed?200:201);
  },'business');
  router.put('/purchase-early-requests/:id',async c=>{
    guard(c);const m=me(c);if(!canSendEarlyRequest(m)) fail(403,'Bạn chưa được cấp quyền xin hàng trước.');
    const body=await readJson(c.req,300000),id=c.params.id!,allowUnresolved=allowUnresolvedDraft(body);
    await c.env.db.transaction(async tx=>{
      const [draft]=await tx.select().from(requests).where(eq(requests.id,id)).for('update');
      if(!draft) fail(404,'Không tìm thấy phiếu nháp.');
      if(draft.deletedAt)fail(409,'Phiếu đã xoá.');
      if(draft.status!=='draft') fail(409,'Phiếu đã gửi NCC, không sửa như phiếu nháp.');
      if(body.revision!==draft.revision) fail(409,'Phiếu đã được sửa bởi người khác. Vui lòng tải lại.');
      const input=cleanInput({...body,clientKey:draft.clientKey,scope:JSON.parse(draft.scope)},JSON.parse(JSON.parse(draft.scope).orderSources||'{}'));
      await replaceDraftLines(tx,id,input,undefined,allowUnresolved);
      await tx.update(requests).set({pickupDate:input.pickupDate,scope:JSON.stringify(input.scope),updatedAt:new Date().toISOString(),revision:draft.revision+1}).where(eq(requests.id,id));
      await audit(tx,m,id,'early-request-draft-update',{lines:input.selected,pickupDate:input.pickupDate,revision:draft.revision+1});
    });return json({request:(await earlyRequestList(c.env.db,null,id))[0]});
  },'business');
  router.post('/purchase-early-requests/:id/submit',async c=>{
    guard(c);const m=me(c);if(!canSendEarlyRequest(m)) fail(403,'Bạn chưa được cấp quyền xin hàng trước.');
    const body=await readJson(c.req,8000),id=c.params.id!;
    const result=await c.env.db.transaction(async tx=>{
      const [draft]=await tx.select().from(requests).where(eq(requests.id,id)).for('update');
      if(!draft) fail(404,'Không tìm thấy phiếu.');
      if(draft.deletedAt)fail(409,'Phiếu đã xoá.');
      if(draft.status==='submitted') return {replayed:true};
      if(body.revision!==draft.revision) fail(409,'Phiếu đã thay đổi. Vui lòng tải lại trước khi gửi.');
      if(!isIsoDate(draft.pickupDate)) fail(400,'Vui lòng nhập ngày lấy hợp lệ và lưu nháp trước khi gửi.');
      const saved=await tx.select().from(lines).where(eq(lines.requestId,id));
      const input=cleanInput({clientKey:draft.clientKey,scope:JSON.parse(draft.scope),pickupDate:draft.pickupDate,lines:saved.map(l=>({sku:l.sku,quantity:l.quantity}))},JSON.parse(JSON.parse(draft.scope).orderSources||'{}'));
      await replaceDraftLines(tx,id,input);
      await tx.update(requests).set({status:'submitted',updatedAt:new Date().toISOString(),revision:draft.revision+1}).where(eq(requests.id,id));
      await audit(tx,m,id,'early-request-send',{lines:input.selected,scope:input.scope,pickupDate:input.pickupDate});
      return {replayed:false};
    });return json({...result,request:(await earlyRequestList(c.env.db,null,id))[0]});
  },'business');
  router.delete('/purchase-early-requests/:id',async c=>{
    guard(c);if(me(c).role!=='manager')fail(403,'Chỉ Manager được xoá phiếu xin hàng.');
    return json({ok:true,...await c.env.db.transaction(tx=>deleteEarlyRequest(tx,c.params.id!,me(c).id))});
  },'business');
  router.post('/purchase-early-requests/:id/cancel-slip',async c=>{
    guard(c);if(me(c).role!=='manager')fail(403,'Chỉ Manager được huỷ phiếu NCC.');
    const body=await readJson(c.req,40000),ids=body.allocationIds;
    if(!Array.isArray(ids)||!ids.length||ids.length>300||ids.some(id=>typeof id!=='string'||!id||id.length>200)||new Set(ids).size!==ids.length)fail(400,'Danh sách mã nguồn của phiếu không hợp lệ.');
    return json({ok:true,...await c.env.db.transaction(tx=>cancelEarlySlip(tx,c.params.id!,ids as string[],me(c).id))});
  },'business');
  router.post('/purchase-early-requests/:id/split',async c=>{
    guard(c);if(me(c).role!=='manager')fail(403,'Chỉ Manager được tách phiếu đã lưu.');
    const ids=await c.env.db.transaction(tx=>splitEarlyRequest(tx,c.params.id!,me(c).id));
    return json({ok:true,requests:await earlyRequestList(c.env.db,null,ids)});
  },'business');
  router.post('/purchase-early-request-lines/:id/manager-confirm',async c=>{
    guard(c);if(me(c).role!=='manager') fail(403,'Chỉ Manager được xác nhận thay NCC.');
    const body=await readJson(c.req,8000),supplierId=typeof body.supplierId==='string'?body.supplierId.trim():'';
    if(!supplierId) fail(400,'Chọn đúng NCC cần xác nhận.');
    return json({ok:true,...await respondEarlyLine(c.env.db,me(c).id,c.params.id!,supplierId,'accepted','Manager xác nhận thay NCC','early-request-manager-confirm')});
  },'business');
  // Exact allocation IDs keep a supplier slip from confirming other sources of the same SKU.
  router.post('/purchase-early-requests/manager-confirm-batch',async c=>{
    guard(c);const m=me(c);if(m.role!=='manager')fail(403,'Chỉ Manager được xác nhận thay NCC.');
    const body=await readJson(c.req,50000),raw=body.allocationIds;
    if(!Array.isArray(raw)||!raw.length||raw.length>300||raw.some(id=>typeof id!=='string'||!id||id.length>100))fail(400,'Chọn từ 1 đến 300 dòng phân bổ.');
    const ids=[...new Set(raw as string[])].sort();
    const result=await c.env.db.transaction(async tx=>{
      const selected=await tx.select({lineId:allocations.requestLineId}).from(allocations).where(inArray(allocations.id,ids));
      if(selected.length!==ids.length)fail(404,'Một dòng phân bổ không còn tồn tại. Tải lại phiếu.');
      // Supplier replies and the single-line Manager route lock these same parent lines.
      await tx.select({id:lines.id}).from(lines).where(inArray(lines.id,[...new Set(selected.map(a=>a.lineId))])).orderBy(asc(lines.id)).for('update');
      const rows=await tx.select({a:allocations,requestId:lines.requestId,requestStatus:requests.status,deletedAt:requests.deletedAt}).from(allocations)
        .innerJoin(lines,eq(lines.id,allocations.requestLineId)).innerJoin(requests,eq(requests.id,lines.requestId)).where(inArray(allocations.id,ids));
      if(rows.length!==ids.length||rows.some(r=>r.requestStatus!=='submitted'||r.deletedAt))fail(409,'Chỉ xác nhận phiếu đã gửi NCC. Tải lại danh sách.');
      if(rows.some(r=>r.a.status==='rejected'))fail(409,'Có phiếu NCC đã từ chối. Chưa xác nhận dòng nào trong lần này.');
      const pending=rows.filter(r=>r.a.status==='pending'),now=new Date().toISOString();
      if(pending.length){
        await tx.update(allocations).set({status:'accepted',responseNote:'Manager xác nhận thay NCC',respondedAt:now,respondedBy:m.id}).where(inArray(allocations.id,pending.map(r=>r.a.id)));
        for(const requestId of [...new Set(pending.map(r=>r.requestId))])await audit(tx,m,requestId,'early-request-manager-confirm-batch',{
          status:'accepted',allocations:pending.filter(r=>r.requestId===requestId).map(r=>({id:r.a.id,supplierId:r.a.supplierId,quantity:r.a.quantity}))});
      }
      return {confirmed:pending.length,replayed:pending.length===0,requestIds:[...new Set(rows.map(r=>r.requestId))]};
    });
    let confirmedRequests:Awaited<ReturnType<typeof withReceiptAvailability>>|undefined;
    if(body.returnRequests===true){try{confirmedRequests=await withReceiptAvailability(c.env.db,await earlyRequestList(c.env.db,null,result.requestIds));}catch{/* The confirmed write must not become a read failure. */}}
    const {requestIds:_ids,...confirmed}=result;return json({ok:true,...confirmed,...(confirmedRequests?{requests:confirmedRequests}:{})});
  },'business');
  router.get('/supplier-portal/early-requests',async c=>{
    const supplierId=isSupplier(me(c))?await supplierFor(c):null;
    const id=c.url.searchParams.get('id')||'',replacements=id?await splitResult(c.env.db,id):null;
    return json({requests:await earlyRequestList(c.env.db,supplierId,replacements||id,true),canRespond:!!supplierId});
  },'supplier-portal');
  router.post('/supplier-portal/early-requests/:id/respond',async c=>{
    const supplierId=await supplierFor(c),body=await readJson(c.req,8000),id=c.params.id!;
    if(body.status!=='accepted'&&body.status!=='rejected') fail(400,'Chọn đồng ý hoặc từ chối.');
    if(body.note!==undefined&&(typeof body.note!=='string'||body.note.length>1000)) fail(400,'Ghi chú tối đa 1.000 ký tự.');
    const status=body.status as 'accepted'|'rejected',note=typeof body.note==='string'?body.note.trim():'';
    return json({ok:true,...await respondEarlyLine(c.env.db,me(c).id,id,supplierId,status,note,'early-request-respond')});
  },'supplier-portal');
}
