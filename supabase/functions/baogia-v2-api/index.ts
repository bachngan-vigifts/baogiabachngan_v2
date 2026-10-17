import { sql } from 'drizzle-orm';
import { createDb } from '../../../src/core/db/client.ts';
import * as schema from '../../../src/db/schema.ts';
import { createAppRouter } from '../../../src/app/router.ts';
import { SYNC_PREFIX } from '../../../src/modules/staff/api/auth-routes.ts';
import { edgeRequestHeaders, edgeResponseCookies } from '../../../src/modules/staff/api/edge-session.ts';
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
// Một client CSDL dùng chung cho cả isolate: các request sau dùng lại kết nối sẵn có (không bắt tay TLS lại mỗi lần).
// CSDL chỉ có 60 kết nối và SUPABASE_DB_URL là kết nối trực tiếp (không qua pooler), mà Edge chạy nhiều isolate cùng lúc:
// mỗi isolate giữ TỐI ĐA 1 kết nối và nhả sau 10 giây rảnh, để tổng số kết nối không vượt giới hạn.
let sharedDb: ReturnType<typeof createDb> | null = null;
// Có secret SUPABASE_POOLER_URL (chuỗi kết nối Supavisor, chế độ transaction, cổng 6543) thì dùng pooler: nhiều kết nối hơn an toàn.
const POOLER_URL = Deno.env.get('SUPABASE_POOLER_URL') || '';
const dbFor = (url: string) => (sharedDb ||= POOLER_URL ? createDb(POOLER_URL, schema, { max: 3, idleTimeout: 20 }) : createDb(url, schema, { max: 1, idleTimeout: 10 }));
/**
 * Chắc chắn có kết nối trước khi xử lý: CSDL hết chỗ kết nối (lúc đông) thì chờ rồi thử lại vài lần thay vì báo lỗi ngay.
 * Kết nối vừa dùng (< 5 giây) thì bỏ qua bước kiểm tra.
 */
let lastOk = 0;
const isFull = (e: unknown) => /remaining connection slots|too many connections|53300|53400/i.test(String((e as { code?: string })?.code ?? '') + ' ' + String((e as Error)?.message ?? e) + ' ' + String((e as { cause?: Error })?.cause?.message ?? ''));
async function ready(db: ReturnType<typeof createDb>) {
  if (Date.now() - lastOk < 5_000) return;
  for (let i = 0; ; i++) {
    try { await db.execute(sql`select 1`); lastOk = Date.now(); return; }
    catch (e) { if (i >= 4 || !isFull(e)) throw e; await new Promise(r => setTimeout(r, 250 * 2 ** i)); }
  }
}
// Việc chạy nền sau khi đã trả lời (vd gửi Web Push): Supabase Edge giữ isolate sống tới khi xong.
// deno-lint-ignore no-explicit-any
const waitUntil = (p: Promise<unknown>) => { const rt = (globalThis as any).EdgeRuntime; if (rt?.waitUntil) rt.waitUntil(p); else p.catch(() => {}); };
// Đồng bộ Sapo gọi từ máy chủ (webhook Sapo, luồng trung gian): không có Origin, xác thực bằng SAPO_SYNC_TOKEN trong router.
const SYNC_ORIGIN = 'https://crm.minhlongonline.com';
Deno.serve(async req => {
  const incoming = new URL(req.url);
  // Đường dẫn API (bỏ tiền tố /functions/v1/baogia-v2-api). Nhận diện luồng đồng bộ ĐÚNG như router (bắt đầu bằng SYNC_PREFIX),
  // không dùng "có chứa" – tránh đường dẫn lắt léo được coi là đồng bộ (bỏ qua kiểm tra Origin).
  const at = incoming.pathname.indexOf('/api/staff'), path = at < 0 ? '' : incoming.pathname.slice(at), sync = path.startsWith(SYNC_PREFIX);
  const origin = sync ? SYNC_ORIGIN : req.headers.get('origin') || '';
  const ORIGIN = origin; // liên kết kích hoạt/đặt lại mật khẩu trỏ về đúng trang đã gửi yêu cầu
  const cors = { 'access-control-allow-origin': ORIGIN, 'access-control-allow-headers': 'authorization, content-type', 'access-control-allow-methods': 'GET, POST, PUT, DELETE, OPTIONS', 'vary': 'Origin', 'cache-control': 'no-store' };
  if (!ORIGINS.has(origin)) return new Response(JSON.stringify({error:'Nguồn yêu cầu không hợp lệ.'}), {status:403,headers:{'content-type':'application/json'}});
  if (req.method === 'OPTIONS') return new Response(null, {status:204,headers:cors});
  const url = Deno.env.get('SUPABASE_DB_URL');
  if (!url) return new Response(JSON.stringify({error:'Kết nối dữ liệu chưa sẵn sàng.'}), {status:503,headers:{...cors,'content-type':'application/json'}});
  const db = dbFor(url);
  try {
    await ready(db);
    if (incoming.pathname.endsWith('/health')) {
      await db.select({id:schema.positions.id}).from(schema.positions).limit(1);
      return new Response(JSON.stringify({ok:true}), {headers:{...cors,'content-type':'application/json'}});
    }
    if (!path) return new Response('{}',{status:404,headers:cors});
    // Phiên đăng nhập = cookie HttpOnly first-party: giao diện gọi /api/staff/* trên CHÍNH tên miền của nó, proxy
    // (functions/api/staff/[[path]].js) chuyển tới đây kèm cookie và nhận lại Set-Cookie. Token không bao giờ nằm trong JSON.
    // Đồng bộ Sapo giữ nguyên Authorization cho router kiểm mã bí mật.
    const { headers, legacyToken } = edgeRequestHeaders(req.headers, { sync, proxySecret: Deno.env.get('API_PROXY_SECRET') || '' });
    const forwarded = new Request(ORIGIN+path+incoming.search,{method:req.method,headers,body:['GET','HEAD'].includes(req.method)?undefined:await req.arrayBuffer()});
    const response = await router.handle(forwarded,{db,waitUntil,files,productImages,legacySite,sapoSyncToken:Deno.env.get('SAPO_SYNC_TOKEN') || '',sapoAdminBase:Deno.env.get('SAPO_ADMIN_BASE') || undefined,mailer:Deno.env.get('RESEND_API_KEY')?{apiKey:Deno.env.get('RESEND_API_KEY')||'',from:Deno.env.get('MAIL_FROM')||'',alwaysCc:(Deno.env.get('MAIL_CC')||'').split(',').map(s=>s.trim()).filter(Boolean)}:undefined});
    if (response.status < 500) lastOk = Date.now();
    const body = JSON.stringify(await response.json());
    const jsonHeaders = new Headers({...cors,'content-type':'application/json; charset=utf-8','x-content-type-options':'nosniff'});
    for (const c of edgeResponseCookies(response, legacyToken)) jsonHeaders.append('set-cookie', c);
    // Phản hồi lớn (bản chụp danh mục ~3 MB) nén gzip còn ~0,5 MB khi trình duyệt hỗ trợ.
    if (body.length > 100_000 && /\bgzip\b/.test(req.headers.get('accept-encoding') || '')) {
      const gz = new Blob([body]).stream().pipeThrough(new CompressionStream('gzip'));
      jsonHeaders.set('content-encoding','gzip'); jsonHeaders.set('vary','Origin, Accept-Encoding');
      return new Response(gz,{status:response.status,headers:jsonHeaders});
    }
    return new Response(body,{status:response.status,headers:jsonHeaders});
  } catch(e) {
    console.error('API request failed');
    return new Response(JSON.stringify({error:'Không thể kết nối dữ liệu. Vui lòng thử lại.'}),{status:503,headers:{...cors,'content-type':'application/json'}});
  }
});
