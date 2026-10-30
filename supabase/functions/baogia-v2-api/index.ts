import { sql } from 'drizzle-orm';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createDb, closeDb } from '../../../src/core/db/client.ts';
import { createDbLifecycle, createDbReadiness } from '../../../src/core/db/request-lifecycle.ts';
import * as schema from '../../../src/db/schema.ts';
import { createAppRouter } from '../../../src/app/router.ts';
import { SYNC_PREFIX } from '../../../src/modules/staff/api/auth-routes.ts';
import { supabaseFileStore } from '../../../src/core/storage/file-store.ts';
// Trang giao diện được phép gọi API. Thêm địa chỉ mới (vd Cloudflare Pages) bằng secret ALLOWED_ORIGINS="https://a,https://b".
const ORIGINS = new Set(["https://bachngan-baogia-v2.lucky-thyme-5212.chatgpt.site", "https://crm.minhlongonline.com",
  ...(Deno.env.get('ALLOWED_ORIGINS') || '').split(',').map(s => s.trim().replace(/\/+$/, '')).filter(s => /^https:\/\/[^/]+$/.test(s))]);
const router = createAppRouter();
// Kho file (đính kèm tin nhắn): bucket private baogiabachngan-v2-files. SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY do Supabase tự cấp cho Edge Function.
const FILES_URL = Deno.env.get('SUPABASE_URL') || '', FILES_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const files = FILES_URL && FILES_KEY ? supabaseFileStore({ url: FILES_URL, serviceKey: FILES_KEY }) : undefined;
// Ảnh sản phẩm: bucket public product-images (migration 0042). Ảnh cũ chuyển từ web cũ bằng tài khoản web cũ
// (secret LEGACY_STAFF_EMAIL / LEGACY_STAFF_PASSWORD – Manager tự đặt trong Supabase → Edge Functions → Secrets).
const productImages = FILES_URL && FILES_KEY ? supabaseFileStore({ url: FILES_URL, serviceKey: FILES_KEY, bucket: 'product-images', publicBucket: true }) : undefined;
const legacySite = { base: 'https://baogia.minhlongonline.com', email: Deno.env.get('LEGACY_STAFF_EMAIL') || '', password: Deno.env.get('LEGACY_STAFF_PASSWORD') || '' };
// Direct Postgres: share only during active requests/background jobs, then close immediately.
// Keeping one idle socket per Edge isolate exhausted this project's 60-connection database.
// Supabase reserves SUPABASE_* names. GitHub SUPABASE_POOLER_URL is deployed as DB_POOLER_URL.
// Supavisor transaction pooler (port 6543) allows safe connection reuse.
const POOLER_URL = Deno.env.get('DB_POOLER_URL') || Deno.env.get('SUPABASE_POOLER_URL') || '';
// ĐO TỐC ĐỘ: mỗi phản hồi có header Server-Timing (db = chờ kết nối CSDL, app = xử lý + số truy vấn, total, vùng chạy Edge).
// Trình duyệt đọc được (expose) để trang "Đo tốc độ" tách thời gian mạng / máy chủ / CSDL. Không chứa SQL, tham số hay dữ liệu.
const timing = new AsyncLocalStorage<{ queries: number }>();
const REGION = (Deno.env.get('SB_REGION') || '').replace(/[^\w-]/g, '').slice(0, 40);
const SLOW_MS = 1500;
// Vùng của CSDL, đọc từ tên máy pooler (aws-0-us-east-1.pooler.supabase.com) hoặc secret DB_REGION. Giao diện dùng nó để
// yêu cầu Edge chạy CÙNG vùng với CSDL (?forceFunctionRegion=…): mỗi truy vấn khỏi phải đi xa (đo thật: ~150–200 ms/truy vấn
// khi Edge ở ap-southeast-1 còn CSDL ở vùng khác).
const DB_REGION = (/@aws-\d+-([a-z]{2}-[a-z]+-\d)\.pooler\.supabase\.com/.exec(POOLER_URL)?.[1] || Deno.env.get('DB_REGION') || '').replace(/[^\w-]/g, '').slice(0, 40);
const dbPool = createDbLifecycle({
  create:()=>createDb(POOLER_URL||Deno.env.get('SUPABASE_DB_URL')||'',schema,{max:POOLER_URL?3:1,idleTimeout:POOLER_URL?20:1,onQuery:()=>{const t=timing.getStore();if(t)t.queries++;}}),
  close:closeDb,keepWarm:!!POOLER_URL,onCloseError:()=>console.warn('API database client close failed'),
});
/**
 * Chắc chắn có kết nối trước khi xử lý: CSDL hết chỗ kết nối (lúc đông) thì chờ rồi thử lại vài lần thay vì báo lỗi ngay.
 * Kết nối vừa dùng (< 5 giây) thì bỏ qua bước kiểm tra.
 */
const isFull = (e: unknown) => /remaining connection slots|too many connections|53300|53400/i.test(String((e as { code?: string })?.code ?? '') + ' ' + String((e as Error)?.message ?? e) + ' ' + String((e as { cause?: Error })?.cause?.message ?? ''));
const ready=createDbReadiness<ReturnType<typeof createDb>>({probe:db=>db.execute(sql`select 1`),isTransient:isFull});
// Việc chạy nền sau khi đã trả lời (vd gửi Web Push): Supabase Edge giữ isolate sống tới khi xong.
// deno-lint-ignore no-explicit-any
const waitUntil = (p: Promise<unknown>) => { const rt = (globalThis as any).EdgeRuntime; if (rt?.waitUntil) rt.waitUntil(p); else p.catch(() => {}); };
// Đồng bộ Sapo gọi từ máy chủ (webhook Sapo, luồng trung gian): không có Origin, xác thực bằng SAPO_SYNC_TOKEN trong router.
const SYNC_ORIGIN = 'https://crm.minhlongonline.com';
Deno.serve(async req => {
  const started = performance.now();
  const incoming = new URL(req.url);
  // Đường dẫn API (bỏ tiền tố /functions/v1/baogia-v2-api). Nhận diện luồng đồng bộ ĐÚNG như router (bắt đầu bằng SYNC_PREFIX),
  // không dùng "có chứa" – tránh đường dẫn lắt léo được coi là đồng bộ (bỏ qua kiểm tra Origin).
  const at = incoming.pathname.indexOf('/api/staff'), path = at < 0 ? '' : incoming.pathname.slice(at), sync = path.startsWith(SYNC_PREFIX);
  const origin = sync ? SYNC_ORIGIN : req.headers.get('origin') || '';
  const ORIGIN = origin; // liên kết kích hoạt/đặt lại mật khẩu trỏ về đúng trang đã gửi yêu cầu
  const cors = { 'access-control-allow-origin': ORIGIN, 'access-control-allow-headers': 'authorization, content-type, x-region', 'access-control-allow-methods': 'GET, POST, PUT, DELETE, OPTIONS', 'vary': 'Origin', 'cache-control': 'no-store', 'access-control-expose-headers': 'server-timing', 'timing-allow-origin': ORIGIN };
  if (!ORIGINS.has(origin)) return new Response(JSON.stringify({error:'Nguồn yêu cầu không hợp lệ.'}), {status:403,headers:{'content-type':'application/json'}});
  if (req.method === 'OPTIONS') return new Response(null, {status:204,headers:cors});
  const url = POOLER_URL || Deno.env.get('SUPABASE_DB_URL');
  if (!url) return new Response(JSON.stringify({error:'Kết nối dữ liệu chưa sẵn sàng.'}), {status:503,headers:{...cors,'content-type':'application/json'}});
  let lease:ReturnType<typeof dbPool.acquire>|undefined;
  try {
    const currentLease=dbPool.acquire();lease=currentLease;const db=currentLease.db;
    const requestWaitUntil=(work:Promise<unknown>)=>waitUntil(currentLease.track(work));
    await ready(db);
    const dbReady = performance.now();
    if (incoming.pathname.endsWith('/health')) {
      await db.select({id:schema.positions.id}).from(schema.positions).limit(1);
      return new Response(JSON.stringify({ok:true,databaseMode:POOLER_URL?'transaction-pooler':'direct-request-scoped'}), {headers:{...cors,'content-type':'application/json'}});
    }
    if (!path) return new Response('{}',{status:404,headers:cors});
    const headers = new Headers(req.headers); headers.delete('cookie');
    if (!sync) { // phiên đăng nhập của giao diện: Bearer → cookie; đồng bộ Sapo giữ nguyên Authorization cho router kiểm mã bí mật
      const token = /^Bearer ([a-f0-9]{64})$/.exec(headers.get('authorization') || '')?.[1];
      headers.delete('authorization');
      if(token) headers.set('cookie', '__Host-bn-session=' + token);
    }
    incoming.searchParams.delete('forceFunctionRegion'); // chỉ để chọn vùng chạy Edge, không phải tham số nghiệp vụ
    const forwarded = new Request(ORIGIN+path+incoming.search,{method:req.method,headers,body:['GET','HEAD'].includes(req.method)?undefined:await req.arrayBuffer()});
const stats = { queries: 0 };
const response = await timing.run(stats, () => router.handle(forwarded,{db,adms:{url:Deno.env.get('ADMS_API_URL')||'',companyId:Number(Deno.env.get('ADMS_COMPANY_ID')||0),token:Deno.env.get('ADMS_API_TOKEN')||''},waitUntil:requestWaitUntil,files,productImages,legacySite,sapoSyncToken:Deno.env.get('SAPO_SYNC_TOKEN') || '',sapoAdminBase:Deno.env.get('SAPO_ADMIN_BASE') || undefined,sapoOrderMode:'n8n',sapoOrderWebhookUrl:Deno.env.get('SAPO_ORDER_WEBHOOK_URL')||undefined,sapoHdktOrderWebhookUrl:Deno.env.get('SAPO_HDKT_ORDER_WEBHOOK_URL')||undefined,sapoPosOrderWebhookUrl:Deno.env.get('SAPO_POS_ORDER_WEBHOOK_URL')||undefined,sapoGoodsReceiptWebhookUrl:Deno.env.get('SAPO_GOODS_RECEIPT_WEBHOOK_URL')||'https://n8nthai.moarchvn.com/webhook/sapo-goods-receipt-from-quote-web',posShiftReportWebhook:Deno.env.get('POS_SHIFT_REPORT_WEBHOOK_URL')&&Deno.env.get('POS_SHIFT_REPORT_WEBHOOK_TOKEN')?{url:Deno.env.get('POS_SHIFT_REPORT_WEBHOOK_URL')||'',token:Deno.env.get('POS_SHIFT_REPORT_WEBHOOK_TOKEN')||''}:undefined,ghnToken:Deno.env.get('GHN_API_TOKEN')||undefined,ghnMlToken:Deno.env.get('GHN_ML_API_TOKEN')||undefined,ghnMlShopId:Deno.env.get('GHN_ML_SHOP_ID')||undefined,ghnWebhookToken:Deno.env.get('GHN_WEBHOOK_TOKEN')||undefined,sepayPosApiKeyHash:Deno.env.get('SEPAY_POS_API_KEY_HASH')||undefined,wooLockTokenHash:Deno.env.get('WOO_LOCK_TOKEN_HASH')||undefined,wooMinhLongTokenHash:Deno.env.get('WOO_MINHLONG_TOKEN_HASH')||undefined,webOrderAction:Deno.env.get('WEB_ORDER_ACTION_TOKEN')?{token:Deno.env.get('WEB_ORDER_ACTION_TOKEN')||'',lockUrl:'https://locknlockonline.com/wp-json/vigifts/v1/order-action-v7',minhlongUrl:''}:undefined,mailer:Deno.env.get('RESEND_API_KEY')?{apiKey:Deno.env.get('RESEND_API_KEY')||'',from:Deno.env.get('MAIL_FROM')||'',alwaysCc:(Deno.env.get('MAIL_CC')||'').split(',').map(s=>s.trim()).filter(Boolean)}:undefined}));
    const handled = performance.now();
    // Chỉ khi đăng nhập / đổi phiên (có Set-Cookie) mới phải sửa JSON để trả sessionToken; còn lại chuyển nguyên văn bản
    // (không phân tích rồi ghi lại JSON – danh mục ~3 MB tốn đáng kể CPU của Edge).
    const cookie = response.headers.get('set-cookie');
    let body = await response.text();
    if (cookie) { const payload = JSON.parse(body); payload.sessionToken = /__Host-bn-session=([a-f0-9]{64})/.exec(cookie)?.[1] || ''; body = JSON.stringify(payload); }
    const total = performance.now() - started, ms = (n: number) => Math.round(n * 10) / 10;
    const serverTiming = `db;dur=${ms(dbReady - started)}, app;dur=${ms(handled - dbReady)};desc="${stats.queries} queries", total;dur=${ms(total)}` + (REGION ? `, region;desc="${REGION}"` : '') + (DB_REGION ? `, dbregion;desc="${DB_REGION}"` : '');
    // Yêu cầu chậm: ghi log (đường dẫn đã bỏ mã / query string) để xem ở Supabase → Edge Functions → Logs.
    if (total > SLOW_MS) console.warn('API slow', JSON.stringify({ method: req.method, route: path.replace(/[0-9a-f]{8}-[0-9a-f-]{27,}|[A-Za-z0-9_-]{20,}/g, ':id'), status: response.status, ms: Math.round(total), dbMs: Math.round(dbReady - started), queries: stats.queries, pooled: !!POOLER_URL }));
    const jsonHeaders = {...cors,'content-type':'application/json; charset=utf-8','x-content-type-options':'nosniff','server-timing':serverTiming};
    // Nén gzip khi trình duyệt hỗ trợ (danh sách 20–200 KB còn ~1/5; bản chụp danh mục ~3 MB còn ~0,5 MB) – đỡ chờ trên 4G.
    if (body.length > 4_000 && /\bgzip\b/.test(req.headers.get('accept-encoding') || '')) {
      const gz = new Blob([body]).stream().pipeThrough(new CompressionStream('gzip'));
      return new Response(gz,{status:response.status,headers:{...jsonHeaders,'content-encoding':'gzip','vary':'Origin, Accept-Encoding'}});
    }
    return new Response(body,{status:response.status,headers:jsonHeaders});
  } catch(e) {
    const code=String((e as {code?:unknown})?.code||(e as {cause?:{code?:unknown}})?.cause?.code||'unknown').slice(0,40);
    console.error('API database unavailable',JSON.stringify({code,phase:'request',pooled:!!POOLER_URL}));
    return new Response(JSON.stringify({error:'Kết nối dữ liệu đang bận. Vui lòng thử lại sau ít giây.',code:'DB_CONNECTION_UNAVAILABLE'}),{status:503,headers:{...cors,'retry-after':'1','content-type':'application/json','server-timing':`total;dur=${Math.round(performance.now()-started)}`+(REGION?`, region;desc="${REGION}"`:'')+(DB_REGION?`, dbregion;desc="${DB_REGION}"`:'')}});
  } finally {
    await lease?.release();
  }
});
