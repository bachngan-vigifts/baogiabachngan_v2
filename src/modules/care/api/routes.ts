import {activityFacts} from './kpi-facts.ts';
import {activityDay} from '../domain/activity-kpi.ts';
import type {ActivityQuoteAccess} from '../../../core/contracts/activity-quotes.ts';
import {sha256Hex} from '../../staff/domain/session.ts';
import {payrollLock} from '../../../core/db/payroll-lock.ts';
import {customerAccess} from '../../customers/api/routes.ts';
import { departmentOwner } from '../../staff/api/department.ts';
import { and, asc, count, desc, eq, or, gte, isNotNull, isNull, lt, lte, type SQL } from 'drizzle-orm';
import type { Router, RouteContext } from '../../../core/http/router.ts';
import { json, readJson } from '../../../core/http/router.ts';
import { AppError } from '../../../core/errors.ts';
import { foldSql, matchAllWords, paging } from '../../../core/text/fold.ts';
import type { SessionState, StaffEnv } from '../../staff/api/auth-routes.ts';
import { employees } from '../../staff/schema.ts';
import { customers } from '../../customers/schema.ts';
import { customerActivities } from '../schema.ts';
import { CARE_REMIND, CARE_REMIND_LABEL, CARE_RESULT_LABEL, CARE_RESULTS, CARE_TYPE_LABEL, CARE_TYPES, cleanCare, followUpState, remindFrom } from '../domain/care.ts';

/*
 * API CHĂM SÓC KHÁCH HÀNG (/care):
 *  GET    /care/config          danh mục hình thức / kết quả (giao diện dùng chung, không chép tay)
 *  GET    /care                 danh sách: ?view=log (nhật ký, mặc định) | follow-ups (hẹn chăm sóc chưa xong)
 *                                lọc: q, type, result, customerId, from, to (ngày), owner (chỉ Manager)
 *  GET    /care/:id             một dòng
 *  POST   /care                 ghi một lần chăm sóc (người ghi = người đăng nhập)
 *  PUT    /care/:id             sửa (người ghi hoặc Manager; `revision` chống ghi đè)
 *  POST   /care/:id/done        đánh dấu hẹn chăm sóc đã xong / mở lại ({ done: boolean })
 *  DELETE /care/:id             xoá (người ghi hoặc Manager)
 * Quyền xem: nhân viên thấy dòng của mình và đồng nghiệp cùng nhóm; Manager thấy tất cả. Quyền sửa/xoá vẫn chỉ người ghi hoặc Manager.
 */
type Ctx = RouteContext<StaffEnv>;
type Viewer = Pick<SessionState['member'], 'id' | 'role' | 'positionId'>;
const viewer = (c: Ctx) => (c.state.session as SessionState).member;
const isManager = (m: Viewer) => m.role === 'manager';

/** Điều kiện xem được: Manager tất cả, nhân viên mình và đồng nghiệp cùng nhóm. Dùng chung cho trang chi tiết khách (customer-hub). */
export const careScope = (m: Viewer): SQL | undefined => (isManager(m) ? undefined : or(eq(customerActivities.ownerId, m.id), departmentOwner(customerActivities.ownerId, m)));

/** Ngày hôm nay theo giờ Việt Nam (YYYY-MM-DD). */
export const vnToday = (now = new Date()) => new Date(now.getTime() + 7 * 3_600_000).toISOString().slice(0, 10);
/** Mốc đầu ngày (giờ Việt Nam) của một ngày YYYY-MM-DD, dạng ISO UTC – để lọc `occurred_at`. */
const dayStart = (iso: string) => new Date(Date.parse(iso + 'T00:00:00+07:00')).toISOString();
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const columns = {
  a: customerActivities, customerName: customers.name, customerPhone: customers.phone, ownerName: employees.name,
};
type Row = { a: typeof customerActivities.$inferSelect; customerName: string; customerPhone: string; ownerName: string };
const present = (r: Row, me: Viewer, today: string) => ({
  ...r.a,clientKey:undefined,payloadHash:undefined,intentOwnerId:undefined, customerName: r.customerName, customerPhone: r.customerPhone, ownerName: r.ownerName,
  typeLabel: CARE_TYPE_LABEL[r.a.type], resultLabel: CARE_RESULT_LABEL[r.a.result], remindLabel: CARE_REMIND_LABEL[r.a.remindBefore],
  followUp: followUpState(r.a.nextAt, r.a.nextDoneAt, today), canEdit: isManager(me) || r.a.ownerId === me.id,
});
const baseQuery = (c: Ctx) => c.env.db.select(columns).from(customerActivities)
  .innerJoin(customers, eq(customers.id, customerActivities.customerId)).innerJoin(employees, eq(employees.id, customerActivities.ownerId));

/** Một dòng người xem được (không có quyền → 404, không lộ là có tồn tại). */
async function loadOne(c: Ctx, id: string, write = false) {
  const me = viewer(c);
  const [row] = await baseQuery(c).where(and(eq(customerActivities.id, id), write && !isManager(me) ? eq(customerActivities.ownerId, me.id) : careScope(me))).limit(1);
  if (!row) throw new AppError(404, 'Không tìm thấy lần chăm sóc này.');
  return row;
}
/** Nhân viên phụ trách giao dịch: nhân viên = chính mình; Manager chọn được nhân viên khác (đang làm việc). */
async function ownerFor(c: Ctx, raw: unknown, fallback: string) {
  const me = viewer(c), want = typeof raw === 'string' && raw ? raw : fallback;
  if (want === fallback) return fallback;
  if (!isManager(me)) throw new AppError(403, 'Chỉ Manager được chọn nhân viên phụ trách khác.');
  const [e] = await c.env.db.select({ id: employees.id, role: employees.role, active: employees.active }).from(employees).where(eq(employees.id, want)).limit(1);
  if (!e || !e.active || e.role === 'customer' || e.role === 'supplier') throw new AppError(400, 'Nhân viên phụ trách không hợp lệ.');
  return e.id;
}
async function ensureCustomer(c: Ctx, id: string) {
  const [k] = await c.env.db.select({ id: customers.id }).from(customers).where(eq(customers.id, id)).limit(1);
  if (!k) throw new AppError(400, 'Không tìm thấy khách hàng.');
  const access=await customerAccess(c.env.db,id,viewer(c));if(!access.canSeeAll&&!access.peer)throw new AppError(404,'Không tìm thấy khách hàng trong phạm vi của bạn.');
}

export function registerCareRoutes(router: Router<StaffEnv>,deps:{quotes?:ActivityQuoteAccess;assertKpiOpen?:(db:StaffEnv['db'],owner:string,month:string)=>Promise<void>}={}) {
  async function marks(c:Ctx,rows:Row[]){
   const months=[...new Set(rows.map(r=>activityDay(r.a.occurredAt).slice(0,7)))],map=new Map();
   for(const m of months){const end=new Date(m+'-01T00:00:00Z');end.setUTCMonth(end.getUTCMonth()+1);const f=await activityFacts(c.env.db,m+'-01',end.toISOString().slice(0,10));for(const [id,value]of f.marks)map.set(id,value);}return map;
  }
  async function metadata(c:Ctx,b:Record<string,unknown>,customerId:string,old?:typeof customerActivities.$inferSelect){
   const completion=b.completion??null,purpose=b.purpose??null;
   if(completion!==null&&!['completed','not_completed'].includes(String(completion)))throw new AppError(400,'Chọn kết quả thực hiện.');
   if(purpose!==null&&!['sales','after_sales'].includes(String(purpose)))throw new AppError(400,'Mục đích giao dịch không hợp lệ.');
   let quoteId:string|null=null,quoteRevision:number|null=null;
   if(b.type==='quote'&&completion==='completed'||b.quoteId!=null||b.quoteRevision!=null){
    if(!deps.quotes)throw new AppError(503,'Chưa có nguồn báo giá. Liên hệ Manager.');
    if(old?.quoteId&&old.customerId===customerId&&b.quoteId===old.quoteId&&Number(b.quoteRevision)===old.quoteRevision&&!(b.type==='quote'&&completion==='completed'&&(old.type!=='quote'||old.completion!=='completed'))){quoteId=old.quoteId;quoteRevision=old.quoteRevision;}else
    ({quoteId,quoteRevision}=await deps.quotes.read(c.env.db,viewer(c),{id:String(b.quoteId||''),revision:Number(b.quoteRevision)||0,customerId}));
   }
   return{completion:completion as string|null,purpose:purpose as string|null,quoteId,quoteRevision};
  }
  async function openSource(db:StaffEnv['db'],owner:string,occurredAt:string){await deps.assertKpiOpen?.(db,owner,activityDay(occurredAt).slice(0,7));}

  router.get('/care/config', () => json({
    types: CARE_TYPES.map(k => ({ key: k, label: CARE_TYPE_LABEL[k] })), results: CARE_RESULTS.map(k => ({ key: k, label: CARE_RESULT_LABEL[k] })),
    completions:[{key:'completed',label:'Đã thực hiện / đã kết nối'},{key:'not_completed',label:'Chưa thực hiện / không kết nối'}],
    reminds: (['1m', '1w', '1d'] as const).map(k => ({ key: k, label: CARE_REMIND_LABEL[k] })),
  }), 'business');

  router.get('/care', async c => {
    const me = viewer(c), p = c.url.searchParams, today = vnToday(), { limit, offset } = paging(c.url, 100, 300);
    const followUps = p.get('view') === 'follow-ups';
    const type = p.get('type'), result = p.get('result'), from = p.get('from') ?? '', to = p.get('to') ?? '', owner = p.get('owner');
    if(p.get('kpi')&&!['counted','excluded'].includes(p.get('kpi')!))throw new AppError(400,'Bộ lọc KPI không hợp lệ.');
    const validDate=(d:string)=>!d||DATE.test(d)&&Number.isFinite(Date.parse(d+'T00:00:00Z'))&&new Date(d+'T00:00:00Z').toISOString().slice(0,10)===d;
    if(!validDate(from)||!validDate(to)||from&&to&&from>to)throw new AppError(400,'Khoảng ngày không hợp lệ.');
    const scope = careScope(me);
    const filters = and(
      scope,
      owner==='mine'?eq(customerActivities.ownerId,me.id):isManager(me)&&owner?eq(customerActivities.ownerId,owner):undefined,
      p.get('customerId') ? eq(customerActivities.customerId, p.get('customerId')!) : undefined,
      type && (CARE_TYPES as readonly string[]).includes(type) ? eq(customerActivities.type, type as typeof CARE_TYPES[number]) : undefined,
      result && (CARE_RESULTS as readonly string[]).includes(result) ? eq(customerActivities.result, result as typeof CARE_RESULTS[number]) : undefined,
      DATE.test(from) ? gte(customerActivities.occurredAt, dayStart(from)) : undefined,
      DATE.test(to) ? lt(customerActivities.occurredAt, dayStart(new Date(Date.parse(to + 'T00:00:00Z') + 86_400_000).toISOString().slice(0, 10))) : undefined,
      matchAllWords(foldSql(customers.name, customerActivities.subject, customerActivities.content, customerActivities.contactName, customerActivities.nextAction), p.get('q')),
      // Danh sách hẹn chăm sóc là việc cần làm: nhân viên chỉ thấy hẹn của mình (nhật ký vẫn xem được của đồng nghiệp cùng nhóm).
      followUps ? and(isManager(me) ? undefined : eq(customerActivities.ownerId, me.id), isNotNull(customerActivities.nextAt), isNull(customerActivities.nextDoneAt)) : undefined,
    );
    // Số nhắc (quá hạn / hôm nay) chỉ đếm hẹn của chính mình – hẹn của đồng nghiệp xem được nhưng mình không đánh dấu xong được.
    const pending = and(isManager(me) ? undefined : eq(customerActivities.ownerId, me.id), isNotNull(customerActivities.nextAt), isNull(customerActivities.nextDoneAt));
    const [rows, [{ total = 0 } = {}], [{ overdue = 0 } = {}], [{ dueToday = 0 } = {}]] = await Promise.all([
      baseQuery(c).where(filters)
        .orderBy(...(followUps ? [asc(customerActivities.nextAt), asc(customers.name)] : [desc(customerActivities.occurredAt), desc(customerActivities.createdAt)]))
        .limit(limit).offset(offset),
      c.env.db.select({ total: count() }).from(customerActivities).innerJoin(customers, eq(customers.id, customerActivities.customerId)).where(filters),
      c.env.db.select({ overdue: count() }).from(customerActivities).where(and(pending, lt(customerActivities.nextAt, today))),
      c.env.db.select({ dueToday: count() }).from(customerActivities).where(and(pending, eq(customerActivities.nextAt, today))),
    ]);
    const full=await baseQuery(c).where(filters),kpi=await marks(c,full);
    const chosen=p.get('kpi')?full.filter(r=>p.get('kpi')==='counted'?kpi.get(r.a.id)?.counted:!kpi.get(r.a.id)?.counted):full;
    const shown=p.get('kpi')?chosen.slice(offset,offset+limit):rows;
    const kpiSummary={total:chosen.length,counted:chosen.filter(r=>kpi.get(r.a.id)?.counted).length};
    return json({ activities: shown.map(r => ({...present(r, me, today),kpi:kpi.get(r.a.id)})), total:p.get('kpi')?chosen.length:total, today,kpiSummary, counts: { overdue, today: dueToday } });
  }, 'business');

  router.get('/care/quotes',async c=>{
   const customerId=c.url.searchParams.get('customerId')||'';await ensureCustomer(c,customerId);
   if(!deps.quotes)throw new AppError(503,'Chưa có nguồn báo giá. Liên hệ Manager.');
   return json({quotes:await deps.quotes.list(c.env.db,viewer(c),customerId)});
  },'business');
  async function replayCommand(c:Ctx,key:string,hash:string){
   const me=viewer(c),[prior]=await c.env.db.select().from(customerActivities).where(and(eq(customerActivities.intentOwnerId,me.id),eq(customerActivities.clientKey,key))).limit(1);
   if(!prior)return null;
   if(prior.payloadHash!==hash)throw new AppError(409,'Cùng mã gửi khác nội dung.','COMMAND_CONFLICT');
   let row:Row;try{row=await loadOne(c,prior.id);}catch(e){if(e instanceof AppError&&e.status===404)return json({replayed:true,activity:null,recorded:true});throw e;}
   const kpi=await marks(c,[row]);return json({replayed:true,activity:{...present(row,me,vnToday()),kpi:kpi.get(prior.id)}});
  }
  async function quoteContext(c:Ctx,id:string,revision:number){
   if(!deps.quotes?.context)throw new AppError(503,'Chưa có nguồn báo giá. Liên hệ Manager.');
   const source=await deps.quotes.context(c.env.db,viewer(c),{id,revision});
   if(source.customerId)await ensureCustomer(c,source.customerId);
   return source;
  }
  router.get('/care/quote-follow-up',async c=>{
   const source=await quoteContext(c,c.url.searchParams.get('quoteId')||'',Number(c.url.searchParams.get('revision'))),me=viewer(c);
   const canSchedule=!!source.customerId&&(isManager(me)||source.ownerId===me.id);
   const pending=source.customerId&&source.ownerId?await baseQuery(c).where(and(careScope(me),eq(customerActivities.quoteId,source.quoteId),eq(customerActivities.customerId,source.customerId),eq(customerActivities.ownerId,source.ownerId),isNotNull(customerActivities.nextAt),isNull(customerActivities.nextDoneAt))).orderBy(asc(customerActivities.nextAt)).limit(1):[];
   return json({...source,canSchedule,canAssign:isManager(me),today:vnToday(),pending:pending[0]?present(pending[0],me,vnToday()):null,reason:!source.customerId?'Báo giá chưa liên kết hồ sơ khách hàng CRM. Chọn đúng khách rồi lưu lại để đặt lịch.':!canSchedule?'Chỉ người phụ trách báo giá hoặc Manager được đặt lịch từ báo giá này.':''});
  },'business');
  router.post('/care/quote-follow-up',async c=>{
   const body=await readJson(c.req,12000),me=viewer(c);
   if(typeof body.clientKey!=='string'||!/^[a-zA-Z0-9_-]{8,100}$/.test(body.clientKey))throw new AppError(400,'Thiếu mã chống gửi lặp.');
   const commandFields=['quoteId','quoteRevision','ownerId','occurredAt','contactName','type','nextAt','nextAction','remindBefore'];
   const commandHash=sha256Hex(JSON.stringify({source:'quote_save_follow_up',...Object.fromEntries(commandFields.filter(k=>body[k]!==undefined).map(k=>[k,body[k]]))}));
   const replay=await replayCommand(c,body.clientKey,commandHash);if(replay)return replay;
   const source=await quoteContext(c,String(body.quoteId||''),body.quoteRevision as number);
   if(!source.customerId)throw new AppError(409,'Liên kết hồ sơ khách hàng CRM với báo giá trước khi đặt lịch.','CARE_CUSTOMER_REQUIRED');
   if(!isManager(me)&&source.ownerId!==me.id)throw new AppError(403,'Chỉ người phụ trách báo giá hoặc Manager được đặt lịch.');
   if(typeof body.nextAt!=='string'||!body.nextAt)throw new AppError(400,'Chọn ngày chăm sóc.');
   if(typeof body.nextAction!=='string'||!body.nextAction.trim())throw new AppError(400,'Nhập việc cần chăm sóc.');
   if(body.ownerId!==undefined&&typeof body.ownerId!=='string')throw new AppError(400,'Nhân viên phụ trách không hợp lệ.');
   if(!body.ownerId&&!source.ownerId)throw new AppError(400,'Chọn nhân viên phụ trách lịch chăm sóc.');
   return createActivity(c,{customerId:source.customerId,ownerId:body.ownerId||source.ownerId||me.id,quoteId:source.quoteId,quoteRevision:source.quoteRevision,clientKey:body.clientKey,type:body.type,result:'consulting',completion:'not_completed',purpose:'sales',occurredAt:body.occurredAt||vnToday(),contactName:body.contactName,subject:('Lịch chăm sóc báo giá '+source.quoteNo).slice(0,200),content:body.nextAction,nextAction:body.nextAction,nextAt:body.nextAt,remindBefore:body.remindBefore,expectedRevenue:0},true,commandHash);
  },'business');
  router.get('/care/:id', async c => {const row=await loadOne(c,c.params.id!),kpi=await marks(c,[row]);return json({activity:{...present(row,viewer(c),vnToday()),kpi:kpi.get(row.a.id)}});}, 'business');

  async function createActivity(c:Ctx,body:Record<string,any>,quoteFollowUp=false,commandHash?:string){
    const me=viewer(c),today=vnToday();
    const key=typeof body.clientKey==='string'?body.clientKey:null;if(key&&!/^[a-zA-Z0-9_-]{8,100}$/.test(key))throw new AppError(400,'Mã gửi không hợp lệ.');
    const fields=['customerId','ownerId','occurredAt','contactName','subject','content','type','result','expectedRevenue','nextAt','nextAction','remindBefore','completion','purpose','quoteId','quoteRevision'];
    const hash=commandHash??sha256Hex(JSON.stringify(Object.fromEntries(fields.filter(k=>body[k]!==undefined).map(k=>[k,body[k]]))));
    if(key){const replay=await replayCommand(c,key,hash);if(replay)return replay;}
    const v=cleanCare(body,today);
    await ensureCustomer(c, v.customerId);
    const now=new Date().toISOString(),ownerId=await ownerFor(c,body.ownerId,me.id),meta=await metadata(c,body,v.customerId);
    const saved=await c.env.db.transaction(async tx=>{
     await payrollLock(tx as any);
     if(key){const [old]=await tx.select().from(customerActivities).where(and(eq(customerActivities.intentOwnerId,me.id),eq(customerActivities.clientKey,key)));if(old){if(old.payloadHash!==hash)throw new AppError(409,'Cùng mã gửi khác nội dung.','COMMAND_CONFLICT');return{id:old.id,replayed:true};}}
     if(quoteFollowUp){const [pending]=await tx.select({id:customerActivities.id}).from(customerActivities).where(and(eq(customerActivities.quoteId,meta.quoteId!),eq(customerActivities.customerId,v.customerId),eq(customerActivities.ownerId,ownerId),isNotNull(customerActivities.nextAt),isNull(customerActivities.nextDoneAt))).orderBy(asc(customerActivities.nextAt)).limit(1);if(pending)return{id:pending.id,replayed:false,alreadyScheduled:true};}
     await openSource(tx as any,ownerId,v.occurredAt);
     const id=crypto.randomUUID();await tx.insert(customerActivities).values({id,...v,...meta,ownerId,intentOwnerId:me.id,clientKey:key,payloadHash:hash,nextDoneAt:null,createdAt:now,updatedAt:now});return{id,replayed:false,alreadyScheduled:false};
    });
    let row:Row;try{row=await loadOne(c,saved.id);}catch(e){if(saved.replayed&&e instanceof AppError&&e.status===404)return json({replayed:true,activity:null,recorded:true});throw e;}const kpi=await marks(c,[row]);return json({activity:{...present(row,me,today),kpi:kpi.get(saved.id)},replayed:saved.replayed,alreadyScheduled:'alreadyScheduled' in saved&&saved.alreadyScheduled},saved.replayed||'alreadyScheduled' in saved&&saved.alreadyScheduled?200:201);
  }
  router.post('/care',async c=>createActivity(c,await readJson(c.req,20000)),'business');

  router.put('/care/:id', async c => {
    const me = viewer(c), today = vnToday(), body = await readJson(c.req, 20_000), { a: old } = await loadOne(c, c.params.id!, true);
    if (body.revision !== undefined && Number(body.revision) !== old.revision) throw new AppError(409, 'Dòng này vừa được người khác sửa. Tải lại rồi sửa tiếp.');
    // Giữ nguyên ngày hẹn cũ (đã qua) thì vẫn lưu được; đổi ngày hẹn thì phải từ hôm nay trở đi.
    const keepOld = !!old.nextAt && body.nextAt === old.nextAt;
    const v = cleanCare(body, keepOld && old.nextAt! < today ? old.nextAt! : today);
    if (v.customerId !== old.customerId) await ensureCustomer(c, v.customerId);
    const now = new Date().toISOString();
    const nextDoneAt = v.nextAt && v.nextAt === old.nextAt ? old.nextDoneAt : null, ownerId = await ownerFor(c, body.ownerId, old.ownerId);
    const meta=await metadata(c,body,v.customerId,old);
    await c.env.db.transaction(async tx=>{await payrollLock(tx as any);await openSource(tx as any,old.ownerId,old.occurredAt);await openSource(tx as any,ownerId,v.occurredAt);
     const changed=await tx.update(customerActivities).set({...v,...meta,ownerId,nextDoneAt,kpiExtraApproved:false,kpiReviewedBy:null,kpiReviewedAt:null,kpiReviewReason:'',revision:old.revision+1,updatedAt:now}).where(and(eq(customerActivities.id,old.id),eq(customerActivities.revision,old.revision))).returning({id:customerActivities.id});
     if(!changed.length)throw new AppError(409,'Giao dịch vừa được sửa. Tải lại.');
    });
    return json({ activity: present(await loadOne(c, old.id), me, today) });
  }, 'business');

  router.post('/care/:id/done', async c => {
    const me = viewer(c), body = await readJson(c.req, 1000), { a: old } = await loadOne(c, c.params.id!, true);
    if (!old.nextAt) throw new AppError(409, 'Lần chăm sóc này không có lịch hẹn.');
    if(body.done!==undefined&&typeof body.done!=='boolean')throw new AppError(400,'Trạng thái chăm sóc không hợp lệ.');
    if(body.revision!==undefined&&(!Number.isSafeInteger(body.revision)||body.nextAt!==old.nextAt))throw new AppError(409,'Lịch hẹn đã đổi. Tải lại trước khi đánh dấu.','CARE_REVISION_CONFLICT');
    if(body.revision!==undefined&&body.revision!==old.revision){
      const same=old.revision===Number(body.revision)+1&&body.nextAt===old.nextAt&&(body.done===false?!old.nextDoneAt:!!old.nextDoneAt);
      if(same)return json({activity:present(await loadOne(c,old.id),me,vnToday()),stateMatches:true});
      throw new AppError(409,'Lịch hẹn vừa được cập nhật. Tải lại trước khi đánh dấu.','CARE_REVISION_CONFLICT');
    }
    const now = new Date().toISOString();
    const changed=await c.env.db.update(customerActivities).set({ nextDoneAt: body.done === false ? null : now, revision: old.revision + 1, updatedAt: now })
      .where(and(eq(customerActivities.id,old.id),eq(customerActivities.revision,old.revision),eq(customerActivities.nextAt,old.nextAt))).returning({id:customerActivities.id});
    if(!changed.length)throw new AppError(409,'Lịch hẹn vừa được cập nhật. Tải lại trước khi đánh dấu.','CARE_REVISION_CONFLICT');
    return json({ activity: present(await loadOne(c, old.id), me, vnToday()) });
  }, 'business');

  router.post('/care/:id/kpi-review',async c=>{
   if(!isManager(viewer(c)))throw new AppError(403,'Chỉ Manager xét giao dịch bổ sung.');
   const b=await readJson(c.req,2000),{a}=await loadOne(c,c.params.id!,true),reason=String(b.reason||'').trim();
   if(typeof b.approved!=='boolean'||reason.length<5||reason.length>500||b.revision!==a.revision)throw new AppError(400,'Nhập lý do từ 5–500 ký tự và phiên bản hiện tại.');
   await c.env.db.transaction(async tx=>{await payrollLock(tx as any);await openSource(tx as any,a.ownerId,a.occurredAt);const changed=await tx.update(customerActivities).set({kpiExtraApproved:b.approved as boolean,kpiReviewedBy:viewer(c).id,kpiReviewedAt:new Date().toISOString(),kpiReviewReason:reason,revision:a.revision+1}).where(and(eq(customerActivities.id,a.id),eq(customerActivities.revision,a.revision))).returning({id:customerActivities.id});if(!changed.length)throw new AppError(409,'Giao dịch đã thay đổi.');});
   return json({ok:true});
  },'business');
  router.delete('/care/:id', async c => {
    const { a } = await loadOne(c, c.params.id!, true);
    await c.env.db.transaction(async tx=>{await payrollLock(tx as any);await openSource(tx as any,a.ownerId,a.occurredAt);await tx.delete(customerActivities).where(and(eq(customerActivities.id,a.id),eq(customerActivities.revision,a.revision)));});
    return json({ ok: true });
  }, 'business');
}

/** Đánh dấu lịch hẹn đã xong khi việc tự sinh tương ứng được hoàn thành (chỉ khi ngày hẹn chưa bị dời). */
export async function completeFollowUp(db: StaffEnv['db'], activityId: string, nextAt: string) {
  const now = new Date().toISOString();
  await db.update(customerActivities).set({ nextDoneAt: now, updatedAt: now })
    .where(and(eq(customerActivities.id, activityId), eq(customerActivities.nextAt, nextAt), isNull(customerActivities.nextDoneAt)));
}

/** Lịch hẹn chưa xong đã tới mốc nhắc (ngày chăm sóc lần sau − "nhắc tôi trước") tính đến `today` – cho việc tự sinh. */
export async function dueFollowUps(db: StaffEnv['db'], today: string) {
  const horizon = new Date(Date.parse(today + 'T00:00:00Z') + 31 * 86_400_000).toISOString().slice(0, 10);
  const rows = await db.select({ id: customerActivities.id, customerId: customerActivities.customerId, ownerId: customerActivities.ownerId, nextAt: customerActivities.nextAt,
    completion:customerActivities.completion,nextAction: customerActivities.nextAction, subject: customerActivities.subject, content: customerActivities.content, type: customerActivities.type,
    remindBefore: customerActivities.remindBefore, contactName: customerActivities.contactName, customerName: customers.name })
    .from(customerActivities).innerJoin(customers, eq(customers.id, customerActivities.customerId))
    .where(and(isNotNull(customerActivities.nextAt), isNull(customerActivities.nextDoneAt), lte(customerActivities.nextAt, horizon))).limit(2000);
  return rows.filter(r => remindFrom(r.nextAt!, r.remindBefore) <= today);
}

