import {supplierGoodsReturns,supplierRefunds} from '../schema.ts';
import {and,eq,inArray,isNull,sql} from 'drizzle-orm';
import type {Router,RouteContext} from '../../../core/http/router.ts';
import {json,readJson} from '../../../core/http/router.ts';
import {AppError} from '../../../core/errors.ts';
import {assertFileMatchesMime} from '../../../core/storage/file-sniff.ts';
import type {StaffEnv,SessionState} from '../../staff/api/auth-routes.ts';
import {isSupplier} from '../../staff/domain/roles.ts';
import {sha256Hex} from '../../staff/domain/session.ts';
import {vietnamDate} from '../../sales/domain/sales.ts';
import {SUPPLIER_WORKSPACE_PAGES,type SupplierWorkspacePage} from '../../../core/contracts/supplier-workspace.ts';
import {supplierAccounts,suppliers,incomingShipments,incomingShipmentLines,incomingShipmentFiles,supplierPaymentSchedules,supplierPayments,supplierOrderEvents,supplierReceipts,supplierReceiptLines} from '../schema.ts';
import {supplierPortalDeliveries,supplierPortalDeliveryLines,supplierPortalInvoices,supplierPublishedStock,supplierTransferShares,supplierStockChecks,supplierStockCheckLines} from '../workspace-schema.ts';
import {stockTransfers,stockTransferLines} from '../../inventory/schema.ts';
import {computeOrderTotals} from '../domain/order-totals.ts';
import {supplierDebt,receiptProgress} from '../domain/purchasing.ts';
import {checkAction,type OrderFacts} from '../domain/workflow.ts';
import {isIsoDate} from '../domain/quantity.ts';
import {queryRows,workspaceFacts,workspaceList,workspaceProductOrders} from './workspace-store.ts';

type Ctx=RouteContext<StaffEnv>;type Tx=Parameters<Parameters<StaffEnv['db']['transaction']>[0]>[0];
const member=(c:Ctx)=>(c.state.session as SessionState).member;
const fail=(status:number,message:string):never=>{throw new AppError(status,message);};
const text=(v:unknown,max=200)=>typeof v==='string'?v.trim().slice(0,max):'';
const now=()=>new Date().toISOString(),today=()=>vietnamDate().iso;
async function context(c:Ctx){
 const m=member(c);let supplierId='';const manager=m.role==='manager'&&!isSupplier(m);
 if(isSupplier(m)){
  const [mapping]=await c.env.db.select({id:suppliers.id}).from(supplierAccounts).innerJoin(suppliers,eq(supplierAccounts.supplierId,suppliers.id)).where(and(eq(supplierAccounts.memberId,m.id),eq(suppliers.active,true))).limit(1);
  if(!mapping)fail(403,'Tài khoản chưa được gắn với NCC đang hoạt động.');supplierId=mapping!.id;
  if(c.url.searchParams.get('supplierId')&&c.url.searchParams.get('supplierId')!==supplierId)fail(404,'Không tìm thấy nhà cung cấp.');
 }else if(manager)supplierId=c.url.searchParams.get('supplierId')||'';else fail(403,'Chỉ tài khoản NCC hoặc Manager được truy cập.');
 const [supplier]=supplierId?await c.env.db.select({id:suppliers.id,name:suppliers.name,phone:suppliers.phone,email:suppliers.email,address:suppliers.address,taxCode:suppliers.taxCode}).from(suppliers).where(and(eq(suppliers.id,supplierId),eq(suppliers.active,true))).limit(1):[];
 if(supplierId&&!supplier)fail(404,'Không tìm thấy nhà cung cấp.');return{m,manager,supplier,supplierId};
}
async function supplierContext(c:Ctx){const s=await context(c);if(!s.supplierId)fail(400,'Chọn nhà cung cấp trước khi xem dữ liệu.');return s;}
function writable(s:Awaited<ReturnType<typeof context>>){if(s.manager)fail(403,'Manager không phản hồi thay NCC trên cổng này.');}
function admin(c:Ctx){const m=member(c);if(m.role!=='manager'||isSupplier(m))fail(403,'Chỉ Manager được quản lý chia sẻ và đối chiếu chứng từ NCC.');return m;}
async function ownOrder(db:StaffEnv['db']|Tx,supplierId:string,id:string,lock=false){
 const q=db.select().from(incomingShipments).where(and(eq(incomingShipments.id,id),eq(incomingShipments.supplierId,supplierId),eq(incomingShipments.source,'supplier-order'),eq(incomingShipments.approvalStatus,'approved'))).limit(1);
 const [o]=lock?await q.for('update'):await q;if(!o)fail(404,'Không tìm thấy đơn mua của NCC.');return o!;
}
function revision(actual:number,value:unknown){if(!Number.isInteger(value)||value!==actual)fail(409,'Đơn đã thay đổi. Tải lại để kiểm tra trước khi tiếp tục.');}
const key=(body:Record<string,unknown>)=>{const v=text(body.clientKey,100);if(typeof body.clientKey!=='string'||body.clientKey.trim().length>100||v.length<8)fail(400,'Thiếu mã chống gửi lặp.');return v;};
function amount(v:unknown,zero=false){const n=Number(v);if(typeof v!=='number'||!Number.isFinite(n)||n<(zero?0:0.01)||n>1e13)fail(400,'Số tiền không hợp lệ.');return n;}
async function event(tx:Tx,orderId:string,by:string,action:string,summary:string){await tx.insert(supplierOrderEvents).values({id:crypto.randomUUID(),shipmentId:orderId,actorId:by,at:now(),action,summary});}
const actor=(s:Awaited<ReturnType<typeof supplierContext>>)=>({id:s.m.id,active:s.m.active,role:s.m.role,positionId:s.m.positionId,supplierId:s.supplierId});
async function orderFacts(db:StaffEnv['db']|Tx,o:typeof incomingShipments.$inferSelect):Promise<OrderFacts>{const [file]=await db.select({id:incomingShipmentFiles.id}).from(incomingShipmentFiles).where(eq(incomingShipmentFiles.shipmentId,o.id)).limit(1);return{source:o.source,approvalStatus:o.approvalStatus,supplierId:o.supplierId,confirmed:o.supplierStatus==='confirmed',hasSignatureStep:!!file||!!o.supplierSignatureDownloadedAt,hasSignatureFile:!!file,depositRequested:!!o.depositRequestedAt,depositPaid:!!o.depositPaidAt,deliveryReady:!!o.deliveryReadyAt,received:!!o.receivedAt};}
function allowed(check:ReturnType<typeof checkAction>){if(!check.ok)fail(check.status,check.message);}

export function registerSupplierWorkspaceRoutes(router:Router<StaffEnv>){
 router.get('/supplier-portal/workspace',async c=>{const s=await context(c);return json({supplier:s.supplier||null,manager:s.manager,canRespond:!s.manager,asOf:today(),historicalBalances:false,pages:SUPPLIER_WORKSPACE_PAGES});},'supplier-portal');
 router.get('/supplier-portal/workspace-suppliers',async c=>{admin(c);const q=text(c.url.searchParams.get('q'),100);return json({suppliers:await c.env.db.select({id:suppliers.id,name:suppliers.name}).from(suppliers).where(and(eq(suppliers.active,true),q?sql`(${suppliers.name} ilike ${'%'+q+'%'} or ${suppliers.taxCode} ilike ${'%'+q+'%'})`:undefined)).orderBy(suppliers.name).limit(50)});},'supplier-portal');
 router.get('/supplier-portal/workspace/overview',async c=>{
  const s=await supplierContext(c),params=new URLSearchParams(c.url.search);params.set('limit','5');
  const orders=await workspaceList(c.env.db,s.supplierId,'orders',params,today());
  const pending=await queryRows<{orders:number;requests:number;products:number;remainingQuantity:number}>(c.env.db,sql`with ${workspaceFacts(s.supplierId,today())} select (select count(*)::int from facts where status='awaiting_confirmation') orders,(select count(distinct a.request_line_id)::int from purchase_early_request_allocations a join incoming_shipment_lines l on l.id=a.purchase_line_id join scope f on f.id=l.shipment_id join purchase_early_request_lines el on el.id=a.request_line_id join purchase_early_requests er on er.id=el.request_id where a.supplier_id=${s.supplierId} and f.cancelled_at is null and a.status='pending' and er.status='submitted' and er.deleted_at is null) requests,(select count(distinct l.sku)::int from line_facts l join scope s on s.id=l.shipment_id where s.cancelled_at is null) products,(select coalesce(sum(greatest(0,floor(l.quantity+0.5)-l.good)),0)::double precision from line_facts l join scope s on s.id=l.shipment_id where s.cancelled_at is null) "remainingQuantity"`);
  return json({...orders,overview:pending[0]});
 },'supplier-portal');
 router.get('/supplier-portal/workspace/products/:sku/orders',async c=>{const s=await supplierContext(c);return json(await workspaceProductOrders(c.env.db,s.supplierId,c.params.sku!,c.url.searchParams,today()));},'supplier-portal');
 router.get('/supplier-portal/workspace/:page',async c=>{const s=await supplierContext(c),page=c.params.page as SupplierWorkspacePage;if(!SUPPLIER_WORKSPACE_PAGES.includes(page)||page==='overview')fail(404,'Không tìm thấy trang.');return json(await workspaceList(c.env.db,s.supplierId,page as Exclude<SupplierWorkspacePage,'overview'>,c.url.searchParams,today()));},'supplier-portal');
 router.get('/supplier-portal/workspace/:page/export',async c=>{const s=await supplierContext(c),page=c.params.page as SupplierWorkspacePage;if(!SUPPLIER_WORKSPACE_PAGES.includes(page)||page==='overview')fail(404,'Không tìm thấy trang.');const result=await workspaceList(c.env.db,s.supplierId,page as Exclude<SupplierWorkspacePage,'overview'>,c.url.searchParams,today(),true);return json({...result,exported:true});},'supplier-portal');
 router.get('/supplier-portal/workspace/:page/:id',async c=>{
  const s=await supplierContext(c),page=c.params.page as SupplierWorkspacePage;if(!SUPPLIER_WORKSPACE_PAGES.includes(page)||page==='overview')fail(404,'Không tìm thấy trang.');
  const params=new URLSearchParams({id:c.params.id!,limit:'1'}),list=await workspaceList(c.env.db,s.supplierId,page as Exclude<SupplierWorkspacePage,'overview'>,params,today());const item=list.items[0];if(!item)fail(404,'Không tìm thấy chứng từ.');
  const orderId=page==='orders'||page==='balances'?item!.id:typeof item!.orderId==='string'?item!.orderId:null;
  if(!orderId)return json({item,lines:[]});const o=await ownOrder(c.env.db,s.supplierId,orderId);
  const [lines,payments,schedules,receipts,got]=await Promise.all([
   c.env.db.select({id:incomingShipmentLines.id,sku:incomingShipmentLines.sku,name:incomingShipmentLines.name,unit:incomingShipmentLines.unit,quantity:incomingShipmentLines.quantity,creditedQty:incomingShipmentLines.creditedQty,price:incomingShipmentLines.price,printFee:incomingShipmentLines.printFee,taxRate:incomingShipmentLines.taxRate,purchaseDiscount:incomingShipmentLines.purchaseDiscount,confirmedPurchaseDiscount:incomingShipmentLines.confirmedPurchaseDiscount,promisedDate:incomingShipmentLines.promisedDate,supplierNote:incomingShipmentLines.supplierNote}).from(incomingShipmentLines).where(eq(incomingShipmentLines.shipmentId,o.id)).orderBy(incomingShipmentLines.lineNo),
   c.env.db.select({amount:supplierPayments.amount,paidDate:supplierPayments.paidDate,voidedAt:supplierPayments.voidedAt,reference:supplierPayments.reference,method:supplierPayments.method}).from(supplierPayments).where(eq(supplierPayments.shipmentId,o.id)),
   c.env.db.select({id:supplierPaymentSchedules.id,kind:supplierPaymentSchedules.kind,amount:supplierPaymentSchedules.amount,dueDate:supplierPaymentSchedules.dueDate}).from(supplierPaymentSchedules).where(eq(supplierPaymentSchedules.shipmentId,o.id)),
   c.env.db.select({id:supplierReceipts.id,no:supplierReceipts.receiptNo,date:supplierReceipts.receivedDate,cancelledAt:supplierReceipts.cancelledAt}).from(supplierReceipts).where(eq(supplierReceipts.shipmentId,o.id)),
   c.env.db.select({lineId:supplierReceiptLines.lineId,goodQty:sql<number>`${supplierReceiptLines.goodQty}-${supplierReceiptLines.returnedGoodQty}`.mapWith(Number),damagedQty:supplierReceiptLines.damagedQty,cancelledAt:supplierReceipts.cancelledAt}).from(supplierReceiptLines).innerJoin(supplierReceipts,eq(supplierReceiptLines.receiptId,supplierReceipts.id)).where(eq(supplierReceipts.shipmentId,o.id))]);
  const [returns,refunds]=await Promise.all([c.env.db.select({id:supplierGoodsReturns.id,mode:supplierGoodsReturns.mode,date:supplierGoodsReturns.returnedDate,creditAmount:supplierGoodsReturns.creditAmount,items:supplierGoodsReturns.items}).from(supplierGoodsReturns).where(eq(supplierGoodsReturns.shipmentId,o.id)),c.env.db.select({id:supplierRefunds.id,amount:supplierRefunds.amount,date:supplierRefunds.receivedDate}).from(supplierRefunds).where(eq(supplierRefunds.shipmentId,o.id))]);
  const sharedReturns=returns.map(r=>({...r,items:(JSON.parse(r.items) as {sku:string;quantity:number}[]).map(l=>({sku:l.sku,quantity:l.quantity}))}));
  const totals=computeOrderTotals({rows:lines,depositRate:o.depositRate,paidAmount:0}),progress=receiptProgress(lines.map(l=>({...l,lineId:l.id})),got.filter(r=>!r.cancelledAt)),complete=lines.every(l=>l.price!==null),facts=await orderFacts(c.env.db,o);
  return json({item,order:{id:o.id,no:o.ticketNumber,internalNo:o.supplierInternalOrderNumber,revision:o.revision,warehouse:o.warehouse,expected:o.arrivalDate,cancelled:!!o.cancelledAt,hasSignature:facts.hasSignatureStep},lines:lines.map((l,i)=>({...l,lineTotal:l.price===null?null:totals.rows[i]!.lineTotal,vat:l.price===null?null:totals.rows[i]!.lineVat})),totals:complete?{subtotal:totals.subtotal,tax:totals.vat,total:totals.total,deposit:totals.depositAmount}:null,debt:complete?supplierDebt(totals.total,schedules,payments,today(),o.refundedAmount):null,progress,payments:payments.filter(p=>!p.voidedAt).map(({voidedAt:_void,...p})=>p),receipts,returns:sharedReturns,refunds});
 },'supplier-portal');
 // New stock checks use their own documents; they never update purchases, published stock or the ledger.
 router.post('/supplier-workspace-admin/stock-checks',async c=>{
  admin(c);const s=await supplierContext(c),body=await readJson(c.req,40000),clientKey=key(body),checkNo=text(body.checkNo,100),neededDate=typeof body.neededDate==='string'?body.neededDate.trim():'',note=text(body.note,1000);
  if(!checkNo||neededDate&&!isIsoDate(neededDate))fail(400,'Nhập số phiếu và ngày cần hàng hợp lệ.');
  if(!Array.isArray(body.lines)||!body.lines.length||body.lines.length>100)fail(400,'Phiếu cần từ 1 đến 100 mã hàng.');
  const lines=(body.lines as Record<string,unknown>[]).map(l=>{if(!l||typeof l!=='object')fail(400,'Dòng kiểm tồn không hợp lệ.');const sku=text(l.sku,200),qty=l.quantity;if(!sku||typeof qty!=='number'||!Number.isFinite(qty)||qty<=0||qty>1e9)fail(400,'Mã hàng hoặc số lượng cần kiểm không hợp lệ.');return{sku,quantity:qty as number};}).sort((a,b)=>a.sku.localeCompare(b.sku));
  if(new Set(lines.map(l=>l.sku)).size!==lines.length)fail(400,'Không lặp mã trong một phiếu kiểm.');
  const hash=await sha256Hex(JSON.stringify({checkNo,neededDate,note,lines})),id=crypto.randomUUID();
  const result=await c.env.db.transaction(async tx=>{
   const [old]=await tx.select().from(supplierStockChecks).where(and(eq(supplierStockChecks.supplierId,s.supplierId),eq(supplierStockChecks.clientKey,clientKey))).limit(1);
   if(old){if(old.requestHash!==hash)fail(409,'Mã gửi lặp có nội dung khác.');return{id:old.id,replay:true};}
   const products=await queryRows<{sku:string;name:string;unit:string}>(tx as unknown as StaffEnv['db'],sql`select distinct on(l.sku) l.sku,l.name,l.unit from incoming_shipment_lines l join incoming_shipments o on o.id=l.shipment_id where o.supplier_id=${s.supplierId} and o.source='supplier-order' and o.approval_status='approved' and o.cancelled_at is null and l.sku in (${sql.join(lines.map(l=>sql`${l.sku}`),sql`,`)}) order by l.sku,o.created_at desc,l.id desc`);
   if(products.length!==lines.length)fail(404,'Mã hàng chưa thuộc đơn mua đã duyệt của NCC này.');
   const inserted=await tx.insert(supplierStockChecks).values({id,supplierId:s.supplierId,checkNo,neededDate,note,clientKey,requestHash:hash,createdAt:now(),createdBy:s.m.id,updatedAt:now()}).onConflictDoNothing().returning({id:supplierStockChecks.id});
   if(!inserted.length){const [retry]=await tx.select().from(supplierStockChecks).where(and(eq(supplierStockChecks.supplierId,s.supplierId),eq(supplierStockChecks.clientKey,clientKey))).limit(1);if(retry?.requestHash===hash)return{id:retry.id,replay:true};fail(409,'Số phiếu hoặc mã gửi đã tồn tại.');}
   await tx.insert(supplierStockCheckLines).values(lines.map(l=>{const p=products.find(p=>p.sku===l.sku)!;return{id:crypto.randomUUID(),checkId:id,sku:l.sku,name:p.name,unit:p.unit,requestedQuantity:l.quantity};}));return{id,replay:false};
  });return json(result,201);
 },'supplier-portal');
 router.post('/supplier-portal/workspace/stock/:id/respond',async c=>{
  const s=await supplierContext(c);writable(s);const body=await readJson(c.req,10000),qty=body.availableQuantity,promisedDate=typeof body.promisedDate==='string'?body.promisedDate.trim():'',note=text(body.note,1000);
  if(typeof qty!=='number'||!Number.isFinite(qty)||qty<0||qty>1e9||promisedDate&&!isIsoDate(promisedDate)||(qty>0&&!promisedDate))fail(400,'Nhập số đáp ứng hợp lệ và ngày có thể giao khi có hàng.');
  await c.env.db.transaction(async tx=>{
   const [line]=await tx.select().from(supplierStockCheckLines).where(eq(supplierStockCheckLines.id,c.params.id!)).limit(1);if(!line)fail(404,'Không tìm thấy dòng kiểm tồn.');
   const [check]=await tx.select().from(supplierStockChecks).where(and(eq(supplierStockChecks.id,line!.checkId),eq(supplierStockChecks.supplierId,s.supplierId))).for('update');if(!check)fail(404,'Không tìm thấy phiếu kiểm của NCC.');revision(check!.revision,body.revision);
   const at=now();await tx.update(supplierStockCheckLines).set({availableQuantity:qty as number,promisedDate,responseNote:note,respondedAt:at,respondedBy:s.m.id}).where(eq(supplierStockCheckLines.id,line!.id));
   const remaining=await tx.select({id:supplierStockCheckLines.id}).from(supplierStockCheckLines).where(and(eq(supplierStockCheckLines.checkId,check!.id),isNull(supplierStockCheckLines.availableQuantity))).limit(1);
   await tx.update(supplierStockChecks).set({revision:check!.revision+1,updatedAt:at,respondedAt:remaining.length?null:at,respondedBy:remaining.length?null:s.m.id}).where(eq(supplierStockChecks.id,check!.id));
  });return json({ok:true});
 },'supplier-portal');
 router.post('/supplier-portal/workspace/orders/:id/confirm',async c=>{
  const s=await supplierContext(c);writable(s);const body=await readJson(c.req,20000);
  await c.env.db.transaction(async tx=>{const o=await ownOrder(tx,s.supplierId,c.params.id!,true);if(o.cancelledAt)fail(409,'Đơn đã hủy.');if(o.supplierStatus==='confirmed')return;revision(o.revision,body.revision);allowed(checkAction('confirm',actor(s),await orderFacts(tx,o)));
   const lines=await tx.select().from(incomingShipmentLines).where(eq(incomingShipmentLines.shipmentId,o.id));if(!lines.length||lines.some(l=>l.price===null))fail(409,'Đơn chưa đủ dòng hàng hoặc giá để xác nhận.');
   await tx.update(incomingShipments).set({supplierStatus:'confirmed',supplierConfirmedAt:now(),supplierConfirmedBy:s.m.id,confirmedOnBehalf:false,supplierInternalOrderNumber:text(body.internalNo,100)||o.supplierInternalOrderNumber,revision:o.revision+1,updatedAt:now(),updatedBy:s.m.id}).where(eq(incomingShipments.id,o.id));
   await event(tx,o.id,s.m.id,'supplier_confirm','NCC xác nhận đơn theo bản ký và nội dung đã gửi.');});return json({ok:true});
 },'supplier-portal');
 router.post('/supplier-portal/workspace/orders/:id/signature',async c=>{
  const s=await supplierContext(c);writable(s);const body=await readJson(c.req,8500000),file=body.file as Record<string,unknown>|undefined;
  const mime=text(file?.mime,100),data=typeof file?.data==='string'?file.data:'',name=text(file?.name,200)||'ban-ky';
  if(!['application/pdf','image/jpeg','image/png','image/webp'].includes(mime)||!data||data.length>8400000)fail(400,'Bản ký phải là ảnh hoặc PDF tối đa 6 MB.');
  let bytes:Uint8Array;try{bytes=Uint8Array.from(atob(data.replace(/^data:[^,]*,/,'')),v=>v.charCodeAt(0));}catch{fail(400,'File không hợp lệ.');}
  if(!bytes!.length||bytes!.length>6291456)fail(400,'Bản ký tối đa 6 MB.');assertFileMatchesMime(bytes!,mime);
  if(!c.env.files)fail(503,'Chưa cấu hình kho file. Vui lòng liên hệ người phụ trách.');
  const id=c.params.id!,hash=await sha256Hex(data),fileKey=`supplier-signatures/${s.supplierId}/${id}/${hash}.${mime==='application/pdf'?'pdf':mime.split('/')[1]}`;
  const o=await ownOrder(c.env.db,s.supplierId,id),facts=await orderFacts(c.env.db,o);if(o.cancelledAt)fail(409,'Đơn đã hủy.');allowed(checkAction('upload_signature',actor(s),facts));
  // Storage I/O precedes the transaction; a unique upload key makes cleanup safe even for concurrent attempts.
  const uploadKey=fileKey.replace('/'+hash+'.','/'+crypto.randomUUID()+'-'+hash+'.');await c.env.files!.put(uploadKey,bytes!,mime);let kept=false;
  try{await c.env.db.transaction(async tx=>{const current=await ownOrder(tx,s.supplierId,id,true);revision(current.revision,body.revision);if(current.cancelledAt)fail(409,'Đơn đã hủy.');allowed(checkAction('upload_signature',actor(s),await orderFacts(tx,current)));
   await tx.insert(incomingShipmentFiles).values({id:crypto.randomUUID(),shipmentId:id,kind:'signature',r2Key:uploadKey,fileName:name,mimeType:mime as 'application/pdf',sizeBytes:bytes!.length,uploadedAt:now(),uploadedBy:s.m.id}).onConflictDoUpdate({target:[incomingShipmentFiles.shipmentId,incomingShipmentFiles.kind],set:{r2Key:uploadKey,fileName:name,mimeType:mime as 'application/pdf',sizeBytes:bytes!.length,uploadedAt:now(),uploadedBy:s.m.id}});
   await tx.update(incomingShipments).set({revision:current.revision+1,updatedAt:now(),updatedBy:s.m.id}).where(eq(incomingShipments.id,id));await event(tx,id,s.m.id,'supplier_signature','NCC tải lên bản ký.');});kept=true;return json({ok:true});}
  finally{if(!kept)try{await c.env.files!.remove([uploadKey]);}catch{/* Retained business state remains unchanged; no key is exposed. */}}
 },'supplier-portal');
 router.get('/supplier-portal/workspace/orders/:id/signature',async c=>{const s=await supplierContext(c);await ownOrder(c.env.db,s.supplierId,c.params.id!);const [file]=await c.env.db.select({key:incomingShipmentFiles.r2Key,name:incomingShipmentFiles.fileName}).from(incomingShipmentFiles).where(eq(incomingShipmentFiles.shipmentId,c.params.id!)).limit(1);if(!file||!c.env.files)fail(404,'Chưa có bản ký.');const url=(await c.env.files!.signedUrls([file!.key],300)).get(file!.key);if(!url)fail(404,'Không mở được bản ký.');return json({url,name:file!.name});},'supplier-portal');
 router.post('/supplier-portal/workspace/orders/:id/deposit',async c=>{
  const s=await supplierContext(c);writable(s);const body=await readJson(c.req,8000);
  await c.env.db.transaction(async tx=>{const o=await ownOrder(tx,s.supplierId,c.params.id!,true);if(o.cancelledAt)fail(409,'Đơn đã hủy.');if(o.depositRequestedAt)return;revision(o.revision,body.revision);allowed(checkAction('request_deposit',actor(s),await orderFacts(tx,o)));
   const lines=await tx.select().from(incomingShipmentLines).where(eq(incomingShipmentLines.shipmentId,o.id));if(!lines.length||lines.some(l=>l.price===null)||computeOrderTotals({rows:lines,depositRate:o.depositRate,paidAmount:0}).depositAmount<=0)fail(409,'Đơn chưa có khoản cọc hợp lệ.');
   await tx.update(incomingShipments).set({depositRequestedAt:now(),depositRequestedBy:s.m.id,revision:o.revision+1,updatedAt:now(),updatedBy:s.m.id}).where(eq(incomingShipments.id,o.id));await event(tx,o.id,s.m.id,'supplier_request_deposit','NCC đề nghị cọc theo điều khoản đơn; chưa ghi nhận chi tiền.');});return json({ok:true});
 },'supplier-portal');
 router.put('/supplier-portal/workspace/stock',async c=>{
  const s=await supplierContext(c);writable(s);const body=await readJson(c.req,10000),sku=text(body.sku,150),warehouse=text(body.warehouse,150);if(!sku||!warehouse)fail(400,'Chọn mã hàng và nhập kho của NCC.');
  const n=(v:unknown)=>{const x=Number(v);if(typeof v!=='number'||!Number.isFinite(x)||x<0||x>1e9)fail(400,'Số lượng không hợp lệ.');return x;},onHand=n(body.onHand),reserved=n(body.reserved),incoming=n(body.incoming);if(reserved>onHand)fail(400,'Số đã phân bổ vượt tồn công bố.');
  await c.env.db.transaction(async tx=>{
   const rows=await queryRows<{id:string}>(tx as unknown as StaffEnv['db'],sql`select l.id from incoming_shipment_lines l join incoming_shipments o on o.id=l.shipment_id where l.sku=${sku} and o.supplier_id=${s.supplierId} and o.source='supplier-order' and o.approval_status='approved' and o.cancelled_at is null limit 1`);if(!rows.length)fail(404,'Mã hàng chưa thuộc đơn mua được chia sẻ với NCC.');
   const values={supplierId:s.supplierId,sku,warehouse,onHand,reserved,incoming,publishedAt:now(),publishedBy:s.m.id};
   const [old]=await tx.select().from(supplierPublishedStock).where(and(eq(supplierPublishedStock.supplierId,s.supplierId),eq(supplierPublishedStock.sku,sku),eq(supplierPublishedStock.warehouse,warehouse))).for('update');
   if(old){revision(old.revision,body.revision);await tx.update(supplierPublishedStock).set({...values,revision:old.revision+1}).where(and(eq(supplierPublishedStock.supplierId,s.supplierId),eq(supplierPublishedStock.sku,sku),eq(supplierPublishedStock.warehouse,warehouse)));}
   else{revision(0,body.revision);const inserted=await tx.insert(supplierPublishedStock).values(values).onConflictDoNothing().returning();if(!inserted.length)fail(409,'Tồn đã thay đổi. Tải lại để kiểm tra.');}
  });return json({ok:true});
 },'supplier-portal');
 router.post('/supplier-portal/workspace/invoices',async c=>{
  const s=await supplierContext(c);writable(s);const body=await readJson(c.req,10000),clientKey=key(body),orderId=text(body.orderId),invoiceNo=text(body.invoiceNo,100),series=text(body.series,100),date=text(body.date,10),subtotal=amount(body.subtotal,true),tax=amount(body.tax,true),total=amount(body.total);
  if(!invoiceNo||!isIsoDate(date)||date>today()||Math.abs(total-subtotal-tax)>=0.01)fail(400,'Kiểm tra số hóa đơn, ngày và tiền trước thuế/VAT/tổng tiền.');
  const note=text(body.note,1000),requestHash=await sha256Hex(JSON.stringify({orderId,invoiceNo,series,date,subtotal,tax,total,note}));
  const result=await c.env.db.transaction(async tx=>{await ownOrder(tx,s.supplierId,orderId,true);const [old]=await tx.select().from(supplierPortalInvoices).where(and(eq(supplierPortalInvoices.supplierId,s.supplierId),eq(supplierPortalInvoices.clientKey,clientKey)));if(old){if(old.requestHash!==requestHash)fail(409,'Mã gửi lặp đã dùng cho nội dung khác.');return{id:old.id,replayed:true};}
   const [dup]=await tx.select({id:supplierPortalInvoices.id}).from(supplierPortalInvoices).where(and(eq(supplierPortalInvoices.supplierId,s.supplierId),eq(supplierPortalInvoices.series,series),eq(supplierPortalInvoices.invoiceNo,invoiceNo)));if(dup)fail(409,'Số hóa đơn/ký hiệu đã có. Đối chiếu chứng từ hiện tại trước khi thêm.');
   const id=crypto.randomUUID();const inserted=await tx.insert(supplierPortalInvoices).values({id,supplierId:s.supplierId,shipmentId:orderId,invoiceNo,series,invoiceDate:date,subtotal,tax,total,note,clientKey,requestHash,createdAt:now(),createdBy:s.m.id}).onConflictDoNothing().returning({id:supplierPortalInvoices.id});if(!inserted.length){const [replay]=await tx.select().from(supplierPortalInvoices).where(and(eq(supplierPortalInvoices.supplierId,s.supplierId),eq(supplierPortalInvoices.clientKey,clientKey)));if(replay?.requestHash===requestHash)return{id:replay.id,replayed:true};fail(409,'Số hóa đơn hoặc mã gửi lặp đã được sử dụng.');}await event(tx,orderId,s.m.id,'supplier_invoice','NCC bổ sung hóa đơn '+invoiceNo+'; chưa làm thay đổi công nợ.');return{id,replayed:false};});return json({ok:true,...result},result.replayed?200:201);
 },'supplier-portal');
 router.post('/supplier-portal/workspace/deliveries',async c=>{
  const s=await supplierContext(c);writable(s);const body=await readJson(c.req,40000),clientKey=key(body),orderId=text(body.orderId),deliveryNo=text(body.deliveryNo,100),date=text(body.date,10),note=text(body.note,1000);if(!deliveryNo||!isIsoDate(date))fail(400,'Nhập số phiếu giao và ngày hợp lệ.');
  if(!Array.isArray(body.lines)||!body.lines.length||body.lines.length>100)fail(400,'Nhập dòng hàng giao (tối đa 100 mã/lần).');const lines=(body.lines as Record<string,unknown>[]).map(l=>({purchaseLineId:text(l.lineId),quantity:amount(l.quantity)}));if(new Set(lines.map(l=>l.purchaseLineId)).size!==lines.length)fail(400,'Dòng hàng bị lặp.');
  const requestHash=await sha256Hex(JSON.stringify({orderId,deliveryNo,date,note,lines:lines.sort((a,b)=>a.purchaseLineId.localeCompare(b.purchaseLineId))}));
  const result=await c.env.db.transaction(async tx=>{const o=await ownOrder(tx,s.supplierId,orderId,true);const [old]=await tx.select().from(supplierPortalDeliveries).where(and(eq(supplierPortalDeliveries.supplierId,s.supplierId),eq(supplierPortalDeliveries.clientKey,clientKey)));if(old){if(old.requestHash!==requestHash)fail(409,'Mã gửi lặp đã dùng cho nội dung khác.');return{id:old.id,replayed:true};}if(o.cancelledAt||o.supplierStatus!=='confirmed')fail(409,'Chỉ báo giao từ đơn còn hiệu lực và đã xác nhận.');
   const ordered=await tx.select().from(incomingShipmentLines).where(eq(incomingShipmentLines.shipmentId,orderId));
   const declared=await queryRows<{line:string;quantity:number}>(tx as unknown as StaffEnv['db'],sql`select l.purchase_line_id line,sum(l.quantity) quantity from supplier_portal_delivery_lines l join supplier_portal_deliveries d on d.id=l.delivery_id where d.shipment_id=${orderId} group by l.purchase_line_id`);
   for(const l of lines){const source=ordered.find(o=>o.id===l.purchaseLineId),already=Number(declared.find(x=>x.line===l.purchaseLineId)?.quantity||0);if(!source||l.quantity+already>source.quantity+1e-9)fail(409,'Số lượng giao vượt đơn hoặc có dòng không thuộc đơn.');}
   const [dup]=await tx.select({id:supplierPortalDeliveries.id}).from(supplierPortalDeliveries).where(and(eq(supplierPortalDeliveries.supplierId,s.supplierId),eq(supplierPortalDeliveries.deliveryNo,deliveryNo)));if(dup)fail(409,'Số phiếu giao NCC đã tồn tại.');
   const id=crypto.randomUUID();const inserted=await tx.insert(supplierPortalDeliveries).values({id,supplierId:s.supplierId,shipmentId:orderId,deliveryNo,deliveryDate:date,note,clientKey,requestHash,createdAt:now(),createdBy:s.m.id}).onConflictDoNothing().returning({id:supplierPortalDeliveries.id});if(!inserted.length){const [replay]=await tx.select().from(supplierPortalDeliveries).where(and(eq(supplierPortalDeliveries.supplierId,s.supplierId),eq(supplierPortalDeliveries.clientKey,clientKey)));if(replay?.requestHash===requestHash)return{id:replay.id,replayed:true};fail(409,'Số phiếu giao hoặc mã gửi lặp đã được sử dụng.');}await tx.insert(supplierPortalDeliveryLines).values(lines.map(l=>({...l,deliveryId:id})));await event(tx,orderId,s.m.id,'supplier_delivery','NCC báo phiếu giao '+deliveryNo+'; chưa xác nhận nhập kho.');return{id,replayed:false};});return json({ok:true,...result},result.replayed?200:201);
 },'supplier-portal');
 router.post('/supplier-portal/workspace/transfers/:id/acknowledge',async c=>{const s=await supplierContext(c);writable(s);const id=c.params.id!,visible=await workspaceList(c.env.db,s.supplierId,'transfers',new URLSearchParams({id,limit:'1'}),today());if(!visible.items.length)fail(404,'Không tìm thấy phiếu được chia sẻ.');const rows=await c.env.db.update(supplierTransferShares).set({acknowledgedAt:now(),acknowledgedBy:s.m.id}).where(and(eq(supplierTransferShares.id,id),eq(supplierTransferShares.supplierId,s.supplierId),isNull(supplierTransferShares.acknowledgedAt))).returning({id:supplierTransferShares.id});return json({ok:true,replayed:!rows.length});},'supplier-portal');
 router.post('/supplier-workspace-admin/invoices/:id/verify',async c=>{const m=admin(c),body=await readJson(c.req,5000);if(body.status!=='verified'&&body.status!=='rejected')fail(400,'Chọn kết quả đối chiếu.');const rows=await c.env.db.update(supplierPortalInvoices).set({status:body.status as 'verified'|'rejected',verifiedAt:now(),verifiedBy:m.id}).where(eq(supplierPortalInvoices.id,c.params.id!)).returning({id:supplierPortalInvoices.id});if(!rows.length)fail(404,'Không tìm thấy hóa đơn.');return json({ok:true});},'business');
 router.get('/supplier-workspace-admin/transfer-options',async c=>{admin(c);const s=await supplierContext(c),orderId=c.url.searchParams.get('orderId')||'';await ownOrder(c.env.db,s.supplierId,orderId);return json({items:await queryRows(c.env.db,sql`select t.id,t.transfer_no "no" from stock_transfers t where t.status in ('approved','shipped','done') and exists(select 1 from stock_transfer_lines l where l.transfer_id=t.id) and not exists(select 1 from stock_transfer_lines l where l.transfer_id=t.id and not exists(select 1 from incoming_shipment_lines p where p.shipment_id=${orderId} and p.sku=l.sku)) order by t.created_at desc,t.id limit 50`)});},'business');
 router.post('/supplier-workspace-admin/transfer-shares',async c=>{const m=admin(c),s=await supplierContext(c),body=await readJson(c.req,5000),orderId=text(body.orderId),transferId=text(body.transferId);await ownOrder(c.env.db,s.supplierId,orderId);const [transfer]=await c.env.db.select().from(stockTransfers).where(eq(stockTransfers.id,transferId));if(!transfer)fail(404,'Không tìm thấy điều chuyển.');if(!['approved','shipped','done'].includes(transfer!.status))fail(409,'Chỉ chia sẻ phiếu điều chuyển đã duyệt.');const lines=await c.env.db.select().from(stockTransferLines).where(eq(stockTransferLines.transferId,transferId)),own=await c.env.db.select({sku:incomingShipmentLines.sku}).from(incomingShipmentLines).where(eq(incomingShipmentLines.shipmentId,orderId));if(!lines.length||lines.some(l=>!own.some(p=>p.sku===l.sku)))fail(409,'Phiếu có mã hàng không thuộc đơn NCC được chọn.');await c.env.db.insert(supplierTransferShares).values({id:crypto.randomUUID(),supplierId:s.supplierId,shipmentId:orderId,transferId,sharedAt:now(),sharedBy:m.id}).onConflictDoNothing();return json({ok:true});},'business');
 router.delete('/supplier-workspace-admin/transfer-shares/:id',async c=>{admin(c);const removed=await c.env.db.delete(supplierTransferShares).where(eq(supplierTransferShares.id,c.params.id!)).returning({id:supplierTransferShares.id});if(!removed.length)fail(404,'Không tìm thấy quyền chia sẻ.');return json({ok:true});},'business');
}
