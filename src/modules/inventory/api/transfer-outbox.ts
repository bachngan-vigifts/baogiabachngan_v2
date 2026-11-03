import { and, asc, eq, lte } from 'drizzle-orm';
import type { StaffEnv } from '../../staff/api/auth-routes.ts';
import type { Router } from '../../../core/http/router.ts';
import { json, readJson } from '../../../core/http/router.ts';
import { AppError } from '../../../core/errors.ts';
import { sha256Hex } from '../../staff/domain/session.ts';
import { transferIntegrationSettings as settings, transferOutbox as jobs } from '../transfer-outbox-schema.ts';
import { stockTransfers, stockTransferLines } from '../schema.ts';
type Tx = Parameters<Parameters<StaffEnv['db']['transaction']>[0]>[0];
type Transfer = typeof stockTransfers.$inferSelect;
type Line = typeof stockTransferLines.$inferSelect;
const settingId = 'stock_transfer_received_v1';
const nowIso = () => new Date().toISOString();
export const transferCommandKey = (id: string) => `crm-stock-transfer:${id}:received:v1`;
const publicResult = (j: typeof jobs.$inferSelect) => ({ idempotency_key:j.idempotencyKey,payload_hash:j.payloadHash,status:j.status,
  attempt_count:j.attemptCount,claimed_at:j.claimedAt,processed_at:j.processedAt,last_error:j.lastError,
  destination:j.destinationId?{system:j.destinationSystem,id:j.destinationId,no:j.destinationNo,url:j.destinationUrl}:null });
function configured(env: StaffEnv) {
  const c = env.transferIntegration;
  if (!c || c.webhookToken.length<32 || c.syncToken.length<32) throw new AppError(503,'Chưa cấu hình đủ tích hợp điều chuyển.');
  try {
    const u=new URL(c.webhookUrl),d=new URL(c.destinationOrigin);
    if(u.origin!=='https://n8nthai.moarchvn.com'||u.pathname!=='/webhook/crm-stock-transfer-received-v1'||u.search||u.hash||u.username||u.password||
      d.protocol!=='https:'||d.hostname.endsWith('.invalid')||d.username||d.password||d.origin!==c.destinationOrigin) throw new Error();
  } catch { throw new AppError(503,'URL tích hợp điều chuyển chưa hợp lệ; chưa được kích hoạt.'); }
  return c;
}
/** Only called in the receipt transaction; no network, no scans of historical transfers. */
export async function queueTransferReceived(tx: Tx, t: Transfer, lines: Line[], actorId: string, receivedAt: string, note: string) {
  const [s]=await tx.select().from(settings).where(eq(settings.id,settingId)).for('share');
  if(!s?.enabled||!s.activatedAt||receivedAt<s.activatedAt)return;
  const key=transferCommandKey(t.id),payload=JSON.stringify({schema_version:1,event:'stock_transfer.received',idempotency_key:key,
    integration_activated_at:s.activatedAt,transfer_id:t.id,transfer_no:t.transferNo,from_warehouse_id:t.fromWarehouseId,to_warehouse_id:t.toWarehouseId,
    shipped_at:t.shippedAt,received_at:receivedAt,received_by:actorId,note,
    items:[...lines].sort((a,b)=>a.sku<b.sku?-1:a.sku>b.sku?1:0).map(l=>({sku:l.sku,unit:l.unit,shipped_qty:l.shippedQty??l.qty,received_qty:l.receivedQty}))});
  const hash=sha256Hex(payload),empty=lines.every(l=>l.receivedQty===0);
  const inserted=await tx.insert(jobs).values({idempotencyKey:key,transferId:t.id,payloadHash:hash,payload,status:empty?'succeeded':'pending',
    processedAt:empty?receivedAt:null,lastError:empty?'ZERO_RECEIVED_NO_DOCUMENT':'',nextAttemptAt:receivedAt,createdAt:receivedAt,updatedAt:receivedAt}).onConflictDoNothing().returning({key:jobs.idempotencyKey});
  if(!inserted.length) {
    const [old]=await tx.select().from(jobs).where(eq(jobs.idempotencyKey,key)).for('update');
    if(!old||old.payloadHash!==hash)await tx.update(jobs).set({status:'conflict',lastError:'COMMAND_CONFLICT',updatedAt:receivedAt}).where(eq(jobs.transferId,t.id));
  }
}
export async function transferIntegrationView(env: StaffEnv,id:string) {
  const [j]=await env.db.select().from(jobs).where(eq(jobs.transferId,id));
  return j?publicResult(j):null;
}
/** HTTP delivery lease is separate from the sole permission to create a destination document. */
export async function dispatchTransferJob(env: StaffEnv,key:string) {
  const config=configured(env),now=nowIso(),token=crypto.randomUUID();
  const job=await env.db.transaction(async tx=>{
    const [s]=await tx.select().from(settings).where(eq(settings.id,settingId)).for('share');
    if(!s?.enabled)return null;
    const [j]=await tx.select().from(jobs).where(eq(jobs.idempotencyKey,key)).for('update');
    if(!j||j.status!=='pending'||j.nextAttemptAt>now)return null;
    if(j.dispatchToken) {
      if(j.dispatchUntil&&j.dispatchUntil<=now)await tx.update(jobs).set({status:'unknown',lastError:'DISPATCH_INTERRUPTED_RECONCILE',updatedAt:now}).where(eq(jobs.idempotencyKey,key));
      return null;
    }
    if(sha256Hex(j.payload)!==j.payloadHash){await tx.update(jobs).set({status:'conflict',lastError:'PAYLOAD_HASH_MISMATCH',updatedAt:now}).where(eq(jobs.idempotencyKey,key));return null;}
    const p=JSON.parse(j.payload);
    if(p.schema_version!==1||p.event!=='stock_transfer.received'||p.idempotency_key!==key||p.integration_activated_at!==s.activatedAt||p.received_at<s.activatedAt!){
      await tx.update(jobs).set({status:'manual',lastError:'SCHEMA_OR_ACTIVATION_MISMATCH',updatedAt:now}).where(eq(jobs.idempotencyKey,key));return null;
    }
    await tx.update(jobs).set({dispatchToken:token,dispatchUntil:new Date(Date.now()+60_000).toISOString(),attemptCount:j.attemptCount+1,nextAttemptAt:new Date(Date.now()+300_000).toISOString(),updatedAt:now}).where(eq(jobs.idempotencyKey,key));
    return j;
  });
  if(!job)return {sent:false};
  let status='pending',error='',retryAt:string|undefined;
  try {
    const r=await (config.fetch??fetch)(config.webhookUrl,{method:'POST',redirect:'error',headers:{'content-type':'application/json','authorization':'Bearer '+config.webhookToken,'x-payload-sha256':job.payloadHash},body:job.payload,signal:AbortSignal.timeout(15_000)});
    if(r.status===429){const h=r.headers.get('retry-after')||'',seconds=Number(h),until=/^\d+$/.test(h)?Date.now()+seconds*1000:Date.parse(h);if(Number.isFinite(until)&&until>Date.now())retryAt=new Date(Math.min(8.64e15,Math.max(Date.now()+300_000,until))).toISOString();}
    await r.body?.cancel();
    if(!r.ok){status=r.status===429?'pending':r.status>=500?'unknown':'failed';error=`N8N_HTTP_${r.status}`;}
  }catch{status='unknown';error='N8N_RESPONSE_UNKNOWN_RECONCILE';}
  // A worker callback can win this race. Never replace claimed/succeeded with delivery status.
  await env.db.update(jobs).set({dispatchToken:null,dispatchUntil:null,status,lastError:error,...(retryAt?{nextAttemptAt:retryAt}:{}),updatedAt:nowIso()})
    .where(and(eq(jobs.idempotencyKey,key),eq(jobs.dispatchToken,token),eq(jobs.status,'pending')));
  return {sent:status==='pending'&&!error};
}
export async function dispatchTransferJobs(env: StaffEnv) {
  if(!env.transferIntegration)return;
  const rows=await env.db.select({key:jobs.idempotencyKey}).from(jobs).where(and(eq(jobs.status,'pending'),lte(jobs.nextAttemptAt,nowIso())))
    .orderBy(asc(jobs.nextAttemptAt)).limit(4);
  for(const j of rows)await dispatchTransferJob(env,j.key).catch(()=>undefined);
}
/** One execution may create; no automatic lease expiry/reclaim after possible destination writes. */
export async function claimTransferJob(env:StaffEnv,b:Record<string,unknown>) {
  return env.db.transaction(async tx=>{
    const [s]=await tx.select().from(settings).where(eq(settings.id,settingId)).for('share');
    if(!s?.enabled)throw new AppError(409,'Tích hợp đang tạm dừng.');
    const [j]=await tx.select().from(jobs).where(eq(jobs.idempotencyKey,String(b.idempotency_key||''))).for('update');
    if(!j)throw new AppError(404,'Không có sự kiện nhận hàng CRM.');
    if(j.payloadHash!==b.payload_hash){await tx.update(jobs).set({status:'conflict',lastError:'COMMAND_CONFLICT',updatedAt:nowIso()}).where(eq(jobs.idempotencyKey,j.idempotencyKey));return {granted:false,conflict:true};}
    if(j.status!=='pending')return {granted:false,...publicResult(j)};
    const p=JSON.parse(j.payload);
    if(sha256Hex(j.payload)!==j.payloadHash||p.schema_version!==1||p.event!=='stock_transfer.received'||p.integration_activated_at!==s.activatedAt||p.received_at<s.activatedAt!||p.idempotency_key!==j.idempotencyKey)throw new AppError(409,'Sự kiện không đúng nội dung hoặc mốc kích hoạt.');
    const token=crypto.randomUUID(),now=nowIso();
    await tx.update(jobs).set({status:'claimed',claimToken:token,claimedAt:now,updatedAt:now,dispatchToken:null,dispatchUntil:null}).where(eq(jobs.idempotencyKey,j.idempotencyKey));
    return {granted:true,claim_token:token,payload:JSON.parse(j.payload),payload_hash:j.payloadHash};
  });
}
export async function transferJobResult(env:StaffEnv,b:Record<string,unknown>) {
  const result=await env.db.transaction(async tx=>{
    const [j]=await tx.select().from(jobs).where(eq(jobs.idempotencyKey,String(b.idempotency_key||''))).for('update');
    if(!j)throw new AppError(404,'Không có sự kiện nhận hàng CRM.');
    if(j.payloadHash!==b.payload_hash){await tx.update(jobs).set({status:'conflict',lastError:'COMMAND_CONFLICT',updatedAt:nowIso()}).where(eq(jobs.idempotencyKey,j.idempotencyKey));return {conflict:true};}
    if(!j.claimToken||j.claimToken!==b.claim_token)throw new AppError(409,'Kết quả không thuộc execution đã nhận việc.');
    if(j.status==='succeeded') {
      if(b.status==='succeeded'&&j.destinationId===b.destination_id&&j.destinationSystem===b.destination_system&&j.destinationNo===b.destination_no&&j.destinationUrl===b.destination_url)return publicResult(j);
      throw new AppError(409,'Phiếu đã có kết quả khác; cần đối soát.');
    }
    if(!['claimed','unknown','manual'].includes(j.status))throw new AppError(409,'Trạng thái sự kiện không nhận kết quả này.');
    const status=String(b.status);
    if(!['succeeded','manual','unknown','failed'].includes(status))throw new AppError(422,'Trạng thái kết quả không hợp lệ.');
    const text=(k:string)=>typeof b[k]==='string'?(b[k] as string).trim():'';
    let dest:Partial<typeof jobs.$inferInsert>={};
    if(status==='succeeded') {
      const c=configured(env),url=text('destination_url');
      let safe=false;try{const u=new URL(url);safe=u.origin===c.destinationOrigin&&!u.username&&!u.password&&!u.search&&!u.hash&&u.pathname!=='/';}catch{/* reject */}
      if(b.verified!==true||!safe||!text('destination_system')||text('destination_system').length>80||!text('destination_id')||text('destination_id').length>160||!text('destination_no')||text('destination_no').length>160)throw new AppError(422,'Cần kết quả đã kiểm chứng và liên kết chứng từ đúng hệ thống đích.');
      dest={destinationSystem:text('destination_system'),destinationId:text('destination_id'),destinationNo:text('destination_no'),destinationUrl:url};
    }
    const [updated]=await tx.update(jobs).set({...dest,status,processedAt:status==='succeeded'?nowIso():null,lastError:status==='succeeded'?'':({manual:'DESTINATION_NEEDS_REVIEW',unknown:'DESTINATION_RESULT_UNKNOWN',failed:'DESTINATION_REJECTED'}[status]||'DESTINATION_NEEDS_REVIEW'),updatedAt:nowIso()}).where(eq(jobs.idempotencyKey,j.idempotencyKey)).returning();
    return publicResult(updated!);
  });
  if('conflict'in result)throw new AppError(409,'Cùng mã nhưng khác nội dung.','COMMAND_CONFLICT');
  return result;
}
export function registerTransferIntegrationRoutes(router:Router<StaffEnv>) {
  router.get('/admin/stock-transfer-integration',async c=>{const [s]=await c.env.db.select().from(settings).where(eq(settings.id,settingId));return json({enabled:s?.enabled??false,integration_activated_at:s?.activatedAt??null});},'admin');
  router.put('/admin/stock-transfer-integration',async c=>{
    const b=await readJson(c.req,1024);if(typeof b.enabled!=='boolean')throw new AppError(422,'Chọn bật hoặc tắt tích hợp.');
    if(b.enabled)configured(c.env);
    const s=await c.env.db.transaction(async tx=>{
      await tx.insert(settings).values({id:settingId,updatedAt:nowIso()}).onConflictDoNothing();
      const [s]=await tx.select().from(settings).where(eq(settings.id,settingId)).for('update');
      const [v]=await tx.update(settings).set({enabled:b.enabled as boolean,activatedAt:s!.activatedAt??(b.enabled?nowIso():null),updatedAt:nowIso()}).where(eq(settings.id,settingId)).returning();return v;
    });
    return json({enabled:s!.enabled,integration_activated_at:s!.activatedAt});
  },'admin');
  router.post('/integrations/stock-transfers/dispatch',async c=>{await dispatchTransferJobs(c.env);return json({accepted:true});},'transfer-sync');
  router.post('/integrations/stock-transfers/claim',async c=>{const r=await claimTransferJob(c.env,await readJson(c.req,2048));if('conflict'in r&&r.conflict)throw new AppError(409,'Cùng mã nhưng khác nội dung.','COMMAND_CONFLICT');return json(r);},'transfer-sync');
  router.post('/integrations/stock-transfers/result',async c=>json(await transferJobResult(c.env,await readJson(c.req,8192))),'transfer-sync');
}
