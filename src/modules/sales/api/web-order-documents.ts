import {webSepayPaidAt} from './web-sepay-evidence.ts';
import {webSapoReference} from '../domain/web-sapo.ts';
import {webSapoStatuses,webSapoFields} from './web-sapo-status.ts';
import {invoiceTaskHooks} from './invoice-task-hooks.ts';
import {readWebAccounting,canEditWebAccounting} from '../domain/web-order-accounting.ts';
import {products} from '../../catalog/schema.ts';
import {webSourceHash,webEditBlocked,webEditFlags} from './web-order-edit-state.ts';
import {readWebEdit,webEditorModel} from '../domain/web-order-edit.ts';
import {and,asc,count,desc,eq,getTableColumns,gte,inArray,lte,ne,sql,type SQL} from 'drizzle-orm';
import type {RouteContext} from '../../../core/http/router.ts';
import type {StaffEnv,SessionState} from '../../staff/api/auth-routes.ts';
import {AppError} from '../../../core/errors.ts';
import {foldSql,matchAllWords,searchRank} from '../../../core/text/fold.ts';
import {can} from '../../staff/domain/permissions.ts';
import {seesAllAsSaleAdmin} from '../../staff/domain/roles.ts';
import {posStoreScopeFor} from './pos-access.ts';
import {posRegisters,webStoreOrders as web} from '../pos-schema.ts';
import {salesOrders} from '../schema.ts';
import {GHN_FAILED,GHN_WAITING} from '../domain/ghn-status.ts';
import {webOrderBucket} from '../domain/web-order-outcome.ts';
import {readWebOrderFinancials} from '../domain/web-order-financials.ts';
type Ctx=RouteContext<StaffEnv>;
const values=(v:Iterable<string>)=>sql.join([...v].map(s=>sql`${s}`),sql`, `);
/** Same priority as webOrderBucket; shipping is carrier truth, never a stock/payment approval. */
export const webDocumentStatus=()=>{
 const s=sql`regexp_replace(lower(trim(${web.status})),'^wc-','')`,g=sql`regexp_replace(lower(trim(${web.ghnStatus})),'^wc-','')`;
 return sql<string>`case when ${s} in ('refunded','trash') then 'cancelled'
 when ${g}='delivered' then 'delivered' when ${g} in (${values(GHN_FAILED)}) then 'cancelled'
 when ${g} in (${values(GHN_WAITING)}) then 'delivering'
 when ${s} in ('cancelled','failed','lnl-returning','lnl-returned') then 'cancelled'
 when ${s} in ('completed','lnl-delivered') then 'delivered'
 when ${s} in ('shipped','out-for-delivery','delivery','delivering','lnl-awaiting-pickup','lnl-pickup','lnl-awaiting-del','lnl-delivery-failed','lnl-del-failed') then 'delivering'
 when ${s} in ('packing','packed') then 'confirmed' else 'draft' end`;
};
async function scope(c:Ctx){
 const m=(c.state.session as SessionState).member;
 const wide=m.role==='manager'||m.positionId==='accounting'||seesAllAsSaleAdmin(m);
 if(!wide&&!can(m,'pos.sell'))return sql`false`;
 const store=await posStoreScopeFor(c.env.db,m);
 return and(inArray(web.source,['lock','minhlong']),store?inArray(web.registerId,store.scope.registers):undefined);
}
const invoiceState = () => invoiceTaskHooks.webStatus?.() ?? sql<string>`'unknown'`;
function asDocument(o:typeof web.$inferSelect,branchName:string,invoiceStatus='unknown',bankPaidAt:string|null=null){
 const accounting=readWebAccounting(o.crmEditSnapshot),invoice=accounting.invoice;
 const bucket=webOrderBucket(o.status,o.ghnStatus),status=bucket==='completed'?'delivered':bucket==='cancelled'?'cancelled':bucket==='waiting_delivery'?'delivering':bucket==='packing'?'confirmed':'draft';
 const financials=readWebOrderFinancials(o.financialSnapshot),payment=readWebEdit(o.crmEditSnapshot).sourceConflict?undefined:bankPaidAt?{paidAt:bankPaidAt}:financials?.payment;
 const paid=payment?(payment.paidAt?o.total:0):null;
 return {id:'web:'+o.id,webOrderId:o.id,external:true,orderSource:'web',source:o.source,orderNo:o.crmOrderNo||`Web_${o.orderNo}_${o.customerName}`,sourceOrderNo:o.orderNo,customerName:o.customerName,phone:o.phone,address:o.address,
  ownerId:null,ownerName:o.source==='lock'?'Web LocknLock':'Web Minh Long',branchName,registerId:o.registerId,orderDate:o.orderedAt.slice(0,10),createdAt:o.orderedAt,updatedAt:o.updatedAt,
  status,statusLabel:bucket==='completed'?'Đã giao':bucket==='cancelled'?'Đã huỷ / hoàn':bucket==='waiting_delivery'?'Đang giao':bucket==='packing'?'Đang chuẩn bị hàng':'Chờ xác nhận GHN',sourceStatus:o.status,total:o.total,currency:o.currency,paid,paymentStatus:paid===null?'unknown':paid>=o.total?'paid':'debt',
  receivable:paid===null?null:{status:paid>=o.total?'paid':paid>0?'partial':'unpaid',payState:paid>=o.total?'paid':paid>0?'partial':'unpaid',paid,balance:Math.max(0,o.total-paid)},debtCounts:status!=='cancelled',
  invoiceStatus:invoice?.status==='issued'?'issued':invoiceStatus,invoiceNo:invoice?.invoiceNo||'',invoiceDate:invoice?.invoiceDate||'',invoiceIssuedBy:invoice?.issuedBy||null,invoiceIssuedByName:invoice?.issuedByName||'',invoiceIssuedAt:invoice?.issuedAt||null,
  invoiceRequestedAt:invoice?.requestedAt||(invoiceStatus==='requested'?o.updatedAt:null),invoiceRequestedBy:invoice?.requestedBy||null,invoiceRequestedByName:invoice?.requestedByName||'',invoiceEmail:invoice?.email||accounting.billing?.email||o.email,invoiceMode:invoice?.mode||'issue',invoiceRequestNote:invoice?.note||'',accountingRevision:accounting.revision,billing:accounting.billing||{name:o.customerName,taxCode:'',address:o.address,email:o.email},
  contract:null,deliveryCarrier:'GHN',deliveryStatus:!o.ghnOrderCode?'':status==='cancelled'?'cancelled':status==='delivered'?'delivered':o.ghnStatus==='ready_to_pick'?'planned':'in_transit',
  ghnAddress:(()=>{try{return JSON.parse(o.ghnAddressSnapshot||'{}');}catch{return {};}})(),ghnOrderCode:o.ghnOrderCode,ghnStatus:o.ghnStatus,ghnSortCode:o.ghnSortCode,ghnFee:o.ghnFee,ghnShipments:[],stockStatus:o.stockStatus,stockNote:o.stockNote,financials,paymentMethod:o.paymentMethod};
}
/** A read projection, not a second sales_orders row: stock, receipts and revenue retain their original web identity. */
export async function webDocumentPage(c:Ctx,crmWhere:SQL|undefined,limit:number,offset:number){
 const base=await scope(c),p=c.url.searchParams,status=p.get('status')||'',source=p.get('source')||'',branch=p.get('branch')||'',q=p.get('q');
 const where=and(base,
  ['', 'web','ghn'].includes(source)&&!p.get('owner')?undefined:sql`false`,
  p.get('invoice') ? ['requested','issued'].includes(p.get('invoice')!) ? eq(invoiceState(),p.get('invoice')!) : p.get('invoice')==='none'?eq(invoiceState(),'unknown'):sql`false` : undefined,
  status?eq(webDocumentStatus(),status):undefined,source==='ghn'?sql`trim(${web.ghnOrderCode})<>''`:undefined,
  branch?(branch==='crm'?sql`false`:eq(web.registerId,branch)):undefined,
  p.get('from')?gte(web.orderedAt,new Date(p.get('from')+'T00:00:00+07:00').toISOString().slice(0,19)):undefined,
  p.get('to')?lte(web.orderedAt,new Date(p.get('to')+'T23:59:59.999+07:00').toISOString()):undefined,
  matchAllWords(foldSql(sql`coalesce(nullif(${web.crmOrderNo},''),concat('Web_',${web.orderNo},'_',${web.customerName}))`,web.orderNo,web.customerName,web.phone),q));
 const rank=searchRank([salesOrders.orderNo,salesOrders.quoteNo,salesOrders.phone],salesOrders.customerName,q)||sql`0`;
 const webRank=searchRank([sql`coalesce(nullif(${web.crmOrderNo},''),concat('Web_',${web.orderNo},'_',${web.customerName}))`,web.orderNo,web.phone],web.customerName,q)||sql`0`;
 const [page,[n],branches,[s],[pending]]=await Promise.all([
  c.env.db.select({id:salesOrders.id,kind:sql<string>`'crm'`.as('kind'),createdAt:salesOrders.createdAt,rank:rank.as('rank')}).from(salesOrders).where(crmWhere)
   .unionAll(c.env.db.select({id:web.id,kind:sql<string>`'web'`.as('kind'),createdAt:web.orderedAt,rank:webRank.as('rank')}).from(web).where(where))
   .orderBy(asc(sql`rank`),desc(sql`created_at`),desc(sql`id`),asc(sql`kind`)).limit(limit).offset(offset),
  c.env.db.select({n:count()}).from(web).where(where),
  c.env.db.selectDistinct({id:posRegisters.id,name:posRegisters.name}).from(web).innerJoin(posRegisters,eq(posRegisters.id,web.registerId)).where(base).orderBy(asc(posRegisters.name)),
  c.env.db.select({count:count(),revenue:sql<number>`coalesce(sum(${web.total}),0)::float8`,
   // Missing financial payment metadata is unknown, never silently treated as unpaid.
   paid:sql<number>`coalesce(sum(case when (${web.financialSnapshot}::jsonb->'payment'->>'paidAt' is not null or ${webSepayPaidAt()} is not null) and not coalesce((${web.crmEditSnapshot}::jsonb->>'sourceConflict')::boolean,false) then ${web.total} else 0 end),0)::float8`,
   remaining:sql<number>`coalesce(sum(case when ${web.financialSnapshot}::jsonb ? 'payment' and ${web.financialSnapshot}::jsonb->'payment'->>'paidAt' is null and ${webSepayPaidAt()} is null and not coalesce((${web.crmEditSnapshot}::jsonb->>'sourceConflict')::boolean,false) then ${web.total} else 0 end),0)::float8`,
   unknown:sql<number>`count(*) filter(where (not (${web.financialSnapshot}::jsonb ? 'payment') and ${webSepayPaidAt()} is null) or coalesce((${web.crmEditSnapshot}::jsonb->>'sourceConflict')::boolean,false))::int`,
  }).from(web).where(and(where,ne(webDocumentStatus(),'cancelled'))),
  c.env.db.select({n:count()}).from(web).where(and(base,eq(invoiceState(),'requested'))),
 ]);
 const ids=page.filter(x=>x.kind==='web').map(x=>x.id);
 const rows=ids.length?await c.env.db.select({o:{...getTableColumns(web),crmEditSnapshot:webEditFlags},branchName:posRegisters.name,bankPaidAt:webSepayPaidAt(),invoiceStatus:invoiceState()}).from(web).innerJoin(posRegisters,eq(posRegisters.id,web.registerId)).where(and(base,inArray(web.id,ids))):[];
 const sapo=await webSapoStatuses(c.env.db,rows.map(r=>r.o)),member=(c.state.session as SessionState).member;
 return {page,total:Number(n?.n||0),invoicePending:Number(pending?.n||0),branches,summary:{count:Number(s?.count||0),revenue:Number(s?.revenue||0),paid:Number(s?.paid||0),remaining:Number(s?.remaining||0),unknownPaymentCount:Number(s?.unknown||0)},documents:rows.map(r=>{const {financials,ghnAddress,...row}=asDocument(r.o,r.branchName,r.invoiceStatus,r.bankPaidAt);return {...row,...webSapoFields(c.env,r.o,member,row.status,sapo.get(webSapoReference(r.o)))};})};
}
export async function webDocumentDetail(c:Ctx,id:string){
 const [r]=await c.env.db.select({o:web,branchName:posRegisters.name,bankPaidAt:webSepayPaidAt(),invoiceStatus:invoiceState(),priceIncludesVat:posRegisters.priceIncludesVat,taxRate:posRegisters.taxRate,active:posRegisters.active}).from(web).innerJoin(posRegisters,eq(posRegisters.id,web.registerId)).where(and(await scope(c),eq(web.id,id))).limit(1);
 if(!r)throw new AppError(404,'Không tìm thấy đơn website trong phạm vi được xem.');
 let items:{sku?:string;name?:string;quantity?:number;total?:number}[]=[];try{const x=JSON.parse(r.o.lines);if(Array.isArray(x))items=x;}catch{/* legacy malformed lines */}
 const units=items.length?await c.env.db.select({sku:products.sku,unit:products.unit}).from(products).where(inArray(products.sku,items.map(l=>String(l.sku||'')))):[];
 items=items.map(l=>({...l,unit:(l as {unit?:string}).unit||units.find(p=>p.sku===l.sku)?.unit||''}));
 const permitted=can((c.state.session as SessionState).member,'pos.sell'),edit=readWebEdit(r.o.crmEditSnapshot);
 const document=asDocument(r.o,r.branchName,r.invoiceStatus,r.bankPaidAt),canAccount=canEditWebAccounting((c.state.session as SessionState).member)&&document.status!=='cancelled';
 const sapo=(await webSapoStatuses(c.env.db,[r.o])).get(webSapoReference(r.o));
 return {document:{...document,...webSapoFields(c.env,r.o,(c.state.session as SessionState).member,document.status,sapo),canIssueInvoice:canAccount,edited:Number(edit.revision||0)>0,sourceConflict:!!edit.sourceConflict,ghnCartReviewRequired:!!edit.ghnCartReviewRequired},canEditBilling:canAccount,items,canManage:permitted&&r.active,canEdit:permitted&&r.active&&!r.bankPaidAt&&!webEditBlocked(r.o),editBlocked:r.bankPaidAt?'Đơn đã đối soát SePay; cần đối chiếu thu/hoàn tiền trước khi sửa.':webEditBlocked(r.o),revision:Number(edit.revision||0),sourceHash:webSourceHash(r.o),editor:webEditorModel(r.o),catalogPricing:{priceIncludesVat:r.priceIncludesVat,taxRate:r.taxRate},originalFinancials:edit.original?readWebOrderFinancials(edit.original.financialSnapshot):null};
}
