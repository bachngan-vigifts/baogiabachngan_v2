import { and, asc, desc, eq, inArray, sql, type SQL } from 'drizzle-orm';
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
import { canUsePurchasing, canReceive, canSendEarlyRequest } from '../domain/purchasing.ts';
import { incomingBySku } from './incoming-by-sku.ts';
import { isIsoDate } from '../domain/quantity.ts';
import {resolveEarlyOrderSources,EarlySourceError} from '../domain/early-order-sources.ts';
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
  scope.status ||= 'all';
  const pinned=Object.fromEntries(selected.filter(l=>l.sourceOrders).map(l=>[l.sku,l.sourceOrders]));
  if(Object.keys(pinned).length)scope.orderSources=JSON.stringify(pinned);
  const pickupDate=body.pickupDate??'';
  if(typeof pickupDate!=='string'||pickupDate!==''&&!isIsoDate(pickupDate)) fail(400,'Ngày lấy không hợp lệ.');
  return {clientKey:body.clientKey,selected,scope,pickupDate};
}
const stateOf = (statuses:readonly string[]) => statuses.every(s=>s==='accepted')?'accepted':statuses.every(s=>s==='rejected')?'rejected':statuses.some(s=>s==='pending')?'pending':'mixed';

/** Header pagination precedes line loading, so a multi-line request is never truncated. NCC filtering happens in SQL. */
export async function earlyRequestList(db:Db, supplierId:string|null, id='', submittedOnly=false, page?:{where?:SQL;limit:number;offset:number}) {
  const scope=supplierId?sql`exists(select 1 from ${lines} join ${allocations} on ${allocations.requestLineId}=${lines.id} where ${lines.requestId}=${requests.id} and ${allocations.supplierId}=${supplierId})`:undefined;
  const headers=await db.select().from(requests).where(and(id?eq(requests.id,id):undefined,scope,submittedOnly?eq(requests.status,'submitted'):undefined,page?.where)).orderBy(desc(requests.createdAt),desc(requests.id)).limit(page?.limit??50).offset(page?.offset??0);
  if(id && !headers.length) fail(404,'Không tìm thấy yêu cầu lấy trước.');
  if(!headers.length) return [];
  const details=await db.select({line:lines,allocation:allocations,orderId:incomingShipments.id,ticketNumber:incomingShipments.ticketNumber,supplierOrderNo:incomingShipments.supplierInternalOrderNumber,
    supplierName:suppliers.name,due:sql<string>`coalesce(nullif(${incomingShipmentLines.promisedDate},''),${incomingShipments.arrivalDate},'')`})
    .from(lines).innerJoin(allocations,eq(allocations.requestLineId,lines.id)).innerJoin(incomingShipmentLines,eq(incomingShipmentLines.id,allocations.purchaseLineId))
    .innerJoin(incomingShipments,eq(incomingShipments.id,incomingShipmentLines.shipmentId)).innerJoin(suppliers,eq(suppliers.id,allocations.supplierId))
    .where(and(inArray(lines.requestId,headers.map(r=>r.id)),supplierId?eq(allocations.supplierId,supplierId):undefined)).orderBy(asc(lines.lineNo),asc(allocations.id));
  return headers.map(h=>{
    const own=details.filter(d=>d.line.requestId===h.id),groups=new Map<string,typeof own>();
    for(const d of own) { const group=groups.get(d.line.id)||[];group.push(d);groups.set(d.line.id,group); }
    return {id:h.id,createdAt:h.createdAt,updatedAt:h.updatedAt||h.createdAt,pickupDate:h.pickupDate,revision:h.revision,requestStatus:h.status,
      ...(!supplierId?{createdBy:h.createdBy,scope:JSON.parse(h.scope)}:{}),status:h.status==='draft'?'draft':stateOf(own.map(d=>d.allocation.status)),
      lines:[...groups].map(([lineId,group])=>({id:lineId,sku:group[0]!.line.sku,name:group[0]!.line.name,unit:group[0]!.line.unit,
        // Supplier sees ONLY its quantities/statuses, never a cross-supplier line total.
        quantity:group.reduce((sum,d)=>sum+d.allocation.quantity,0),status:stateOf(group.map(d=>d.allocation.status)),
        allocations:group.map(d=>({id:d.allocation.id,orderId:d.orderId,ticketNumber:d.ticketNumber,supplierOrderNo:d.supplierOrderNo,supplierId:d.allocation.supplierId,
          supplierName:d.supplierName,quantity:d.allocation.quantity,due:d.due,status:d.allocation.status,
          respondedAt:d.allocation.respondedAt,responseNote:d.allocation.responseNote}))}))};
  });
}

async function replaceDraftLines(tx:Tx,id:string,input:ReturnType<typeof cleanInput>) {
  for(const l of input.selected) await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'early-sku:'+l.sku}))`);
  const q=new URLSearchParams(input.scope);q.set('selected','1');for(const l of input.selected) q.append('sku',l.sku);
  const initial=await incomingBySku(asDb(tx),q,vietnamDate().iso,false);
  const orderIds=[...new Set(initial.rows.flatMap(r=>r.orders.map(o=>o.id)))].sort();
  if(!orderIds.length) fail(409,'Các mã đã chọn không còn hàng đang về.');
  await tx.select({id:incomingShipments.id}).from(incomingShipments).where(inArray(incomingShipments.id,orderIds)).orderBy(asc(incomingShipments.id)).for('update');
  const current=await incomingBySku(asDb(tx),q,vietnamDate().iso,false);
  const oldLines=await tx.select({id:lines.id}).from(lines).where(eq(lines.requestId,id));
  if(oldLines.length) await tx.delete(allocations).where(inArray(allocations.requestLineId,oldLines.map(l=>l.id)));
  await tx.delete(lines).where(eq(lines.requestId,id));
  const resolvedSources:Record<string,OrderSource[]>={};
  for(const [i,want] of input.selected.entries()) {
    const row=current.rows.find(r=>r.sku===want.sku),allOrders=row?.orders.filter(o=>orderIds.includes(o.id))||[];
    let resolved;
    try{resolved=resolveEarlyOrderSources(allOrders,want.sourceOrders??[{orderNo:'',supplierOrderNo:'',quantity:want.quantity}]);}
    catch(e){if(e instanceof EarlySourceError)fail(409,`${want.sku}: ${e.message}`,e.code);throw e;}
    if(want.sourceOrders)resolvedSources[want.sku]=resolved.sources;
    const lineId=crypto.randomUUID();await tx.insert(lines).values({id:lineId,requestId:id,lineNo:i+1,sku:row!.sku,name:row!.name,unit:resolved.unit,quantity:want.quantity});
    for(const {order,quantity} of resolved.allocations){
      if(!order.supplierId)fail(409,`${want.sku}: đơn mua chưa có NCC.`);
      await tx.insert(allocations).values({id:crypto.randomUUID(),requestLineId:lineId,purchaseLineId:order.lineId,supplierId:order.supplierId,quantity,status:'pending'});
    }
  }
  if(Object.keys(resolvedSources).length){
    if(Object.values(resolvedSources).reduce((n,s)=>n+s.length,0)>300)fail(400,'Phân bổ vượt 300 nguồn đơn mua; tách thành phiếu nhỏ hơn.');
    input.scope.orderSources=JSON.stringify(resolvedSources);
    await tx.update(requests).set({scope:JSON.stringify(input.scope)}).where(eq(requests.id,id));
  }
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
      const [parent]=await tx.select({status:requests.status}).from(lines).innerJoin(requests,eq(requests.id,lines.requestId)).where(eq(lines.id,id));
      if(parent?.status!=='submitted') fail(404,'Không tìm thấy dòng yêu cầu đã gửi NCC.');
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

export function registerEarlyRequestRoutes(router:Router<StaffEnv>) {
  router.get('/purchase-early-requests',async c=>{
    guard(c);const supplierId=c.url.searchParams.get('supplierId')||null,page=earlyListFilter(c.url.searchParams,supplierId);
    const requests=await earlyRequestList(c.env.db,supplierId,c.url.searchParams.get('id')||'',false,{...page,limit:page.limit+1});
    const nextOffset=requests.length>page.limit?page.offset+page.limit:null;if(nextOffset!==null)requests.pop();
    const availability=await earlyReceiptAvailability(c.env.db,requests.map(r=>r.id));
    const byAllocation=new Map(availability.map(r=>[r.allocationId,r]));
    return json({requests:requests.map(r=>({...r,lines:r.lines.map(l=>({...l,allocations:l.allocations.map(a=>({...a,
      remainingToReceive:byAllocation.get(a.id)?.remaining??0,receivedQty:byAllocation.get(a.id)?.receivedQty??0}))}))})),nextOffset,canSend:canSendEarlyRequest(me(c)),canViewPortal:me(c).role==='manager',canReceive:canReceive(me(c))});
  },'business');
  router.get('/purchase-early-requests/:id/receiving',async c=>{
    guard(c);if(!canReceive(me(c)))fail(403,'Bạn không có quyền nhận hàng NCC.');
    return json(await earlyReceiptContext(c.env.db,c.params.id!,c.url.searchParams.get('orderId')||''));
  },'business');
  router.post('/purchase-early-requests',async c=>{
    guard(c);const m=me(c);if(!canSendEarlyRequest(m)) fail(403,'Chỉ Manager và Sale Admin được gửi yêu cầu lấy trước.');
    const input=cleanInput(await readJson(c.req,300000)),payloadHash=sha256Hex(JSON.stringify({lines:input.selected,scope:input.scope,pickupDate:input.pickupDate}));
    const result=await c.env.db.transaction(async tx=>{
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'early-key:'+m.id+':'+input.clientKey}))`);
      const [old]=await tx.select().from(requests).where(and(eq(requests.createdBy,m.id),eq(requests.clientKey,input.clientKey))).limit(1);
      if(old) { if(old.payloadHash!==payloadHash) fail(409,'Khóa gửi đã được dùng cho nội dung khác.','IDEMPOTENCY_CONFLICT');return {id:old.id,replayed:true}; }
      const now=new Date().toISOString(),id=crypto.randomUUID();
      await tx.insert(requests).values({id,clientKey:input.clientKey,payloadHash,createdBy:m.id,createdAt:now,status:'draft',pickupDate:input.pickupDate,scope:JSON.stringify(input.scope),updatedAt:now});
      await replaceDraftLines(tx,id,input);
      await audit(tx,m,id,'early-request-draft-create',{lines:input.selected,scope:input.scope,pickupDate:input.pickupDate});
      return {id,replayed:false};
    });
    return json({...result,request:(await earlyRequestList(c.env.db,null,result.id))[0]},result.replayed?200:201);
  },'business');
  router.put('/purchase-early-requests/:id',async c=>{
    guard(c);const m=me(c);if(!canSendEarlyRequest(m)) fail(403,'Chỉ Manager và Sale Admin được sửa phiếu nháp.');
    const body=await readJson(c.req,300000),id=c.params.id!;
    await c.env.db.transaction(async tx=>{
      const [draft]=await tx.select().from(requests).where(eq(requests.id,id)).for('update');
      if(!draft) fail(404,'Không tìm thấy phiếu nháp.');
      if(draft.status!=='draft') fail(409,'Phiếu đã gửi NCC, không sửa như phiếu nháp.');
      if(body.revision!==draft.revision) fail(409,'Phiếu đã được sửa bởi người khác. Vui lòng tải lại.');
      const input=cleanInput({...body,clientKey:draft.clientKey,scope:JSON.parse(draft.scope)},JSON.parse(JSON.parse(draft.scope).orderSources||'{}'));
      await replaceDraftLines(tx,id,input);
      await tx.update(requests).set({pickupDate:input.pickupDate,scope:JSON.stringify(input.scope),updatedAt:new Date().toISOString(),revision:draft.revision+1}).where(eq(requests.id,id));
      await audit(tx,m,id,'early-request-draft-update',{lines:input.selected,pickupDate:input.pickupDate,revision:draft.revision+1});
    });return json({request:(await earlyRequestList(c.env.db,null,id))[0]});
  },'business');
  router.post('/purchase-early-requests/:id/submit',async c=>{
    guard(c);const m=me(c);if(!canSendEarlyRequest(m)) fail(403,'Chỉ Manager và Sale Admin được gửi NCC.');
    const body=await readJson(c.req,8000),id=c.params.id!;
    const result=await c.env.db.transaction(async tx=>{
      const [draft]=await tx.select().from(requests).where(eq(requests.id,id)).for('update');
      if(!draft) fail(404,'Không tìm thấy phiếu.');
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
  router.post('/purchase-early-request-lines/:id/manager-confirm',async c=>{
    guard(c);if(me(c).role!=='manager') fail(403,'Chỉ Manager được xác nhận thay NCC.');
    const body=await readJson(c.req,8000),supplierId=typeof body.supplierId==='string'?body.supplierId.trim():'';
    if(!supplierId) fail(400,'Chọn đúng NCC cần xác nhận.');
    return json({ok:true,...await respondEarlyLine(c.env.db,me(c).id,c.params.id!,supplierId,'accepted','Manager xác nhận thay NCC','early-request-manager-confirm')});
  },'business');
  router.get('/supplier-portal/early-requests',async c=>{
    const supplierId=isSupplier(me(c))?await supplierFor(c):null;
    return json({requests:await earlyRequestList(c.env.db,supplierId,c.url.searchParams.get('id')||'',true),canRespond:!!supplierId});
  },'supplier-portal');
  router.post('/supplier-portal/early-requests/:id/respond',async c=>{
    const supplierId=await supplierFor(c),body=await readJson(c.req,8000),id=c.params.id!;
    if(body.status!=='accepted'&&body.status!=='rejected') fail(400,'Chọn đồng ý hoặc từ chối.');
    if(body.note!==undefined&&(typeof body.note!=='string'||body.note.length>1000)) fail(400,'Ghi chú tối đa 1.000 ký tự.');
    const status=body.status as 'accepted'|'rejected',note=typeof body.note==='string'?body.note.trim():'';
    return json({ok:true,...await respondEarlyLine(c.env.db,me(c).id,id,supplierId,status,note,'early-request-respond')});
  },'supplier-portal');
}
