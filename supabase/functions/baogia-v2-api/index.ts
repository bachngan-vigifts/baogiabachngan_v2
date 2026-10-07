import { createDb } from '../../../src/core/db/client.ts';
import * as schema from '../../../src/db/schema.ts';
import { createAppRouter } from '../../../src/app/router.ts';
// Trang giao diện được phép gọi API. Thêm địa chỉ mới (vd Cloudflare Pages) bằng secret ALLOWED_ORIGINS="https://a,https://b".
const ORIGINS = new Set(["https://bachngan-baogia-v2.lucky-thyme-5212.chatgpt.site", "https://crm.minhlongonline.com",
  ...(Deno.env.get('ALLOWED_ORIGINS') || '').split(',').map(s => s.trim().replace(/\/+$/, '')).filter(s => /^https:\/\/[^/]+$/.test(s))]);
const router = createAppRouter();
// Một client CSDL dùng chung cho cả isolate: các request sau dùng lại kết nối sẵn có (không mở kết nối mới mỗi lần → nhanh hơn nhiều,
// nhất là tin nhắn hỏi định kỳ). Kết nối rảnh 60 giây thì tự đóng; isolate bị thu hồi thì kết nối đóng theo.
let sharedDb: ReturnType<typeof createDb> | null = null;
const dbFor = (url: string) => (sharedDb ||= createDb(url, schema, { max: 4, idleTimeout: 60 }));
// Việc chạy nền sau khi đã trả lời (vd gửi Web Push): Supabase Edge giữ isolate sống tới khi xong.
// deno-lint-ignore no-explicit-any
const waitUntil = (p: Promise<unknown>) => { const rt = (globalThis as any).EdgeRuntime; if (rt?.waitUntil) rt.waitUntil(p); else p.catch(() => {}); };
// Đồng bộ Sapo gọi từ máy chủ (webhook Sapo, luồng trung gian): không có Origin, xác thực bằng SAPO_SYNC_TOKEN trong router.
const SYNC_PATH = '/api/staff/integrations/';
const SYNC_ORIGIN = 'https://crm.minhlongonline.com';
Deno.serve(async req => {
  const incoming = new URL(req.url), sync = incoming.pathname.includes(SYNC_PATH);
  const origin = sync ? SYNC_ORIGIN : req.headers.get('origin') || '';
  const ORIGIN = origin; // liên kết kích hoạt/đặt lại mật khẩu trỏ về đúng trang đã gửi yêu cầu
  const cors = { 'access-control-allow-origin': ORIGIN, 'access-control-allow-headers': 'authorization, content-type', 'access-control-allow-methods': 'GET, POST, PUT, DELETE, OPTIONS', 'vary': 'Origin', 'cache-control': 'no-store' };
  if (!ORIGINS.has(origin)) return new Response(JSON.stringify({error:'Nguồn yêu cầu không hợp lệ.'}), {status:403,headers:{'content-type':'application/json'}});
  if (req.method === 'OPTIONS') return new Response(null, {status:204,headers:cors});
  const url = Deno.env.get('SUPABASE_DB_URL');
  if (!url) return new Response(JSON.stringify({error:'Kết nối dữ liệu chưa sẵn sàng.'}), {status:503,headers:{...cors,'content-type':'application/json'}});
  const db = dbFor(url);
  try {
    if (incoming.pathname.endsWith('/health')) {
      await db.select({id:schema.positions.id}).from(schema.positions).limit(1);
      return new Response(JSON.stringify({ok:true}), {headers:{...cors,'content-type':'application/json'}});
    }
    const path = incoming.pathname.slice(incoming.pathname.indexOf('/api/staff'));
    if (!incoming.pathname.includes('/api/staff')) return new Response('{}',{status:404,headers:cors});
    const headers = new Headers(req.headers); headers.delete('cookie');
    if (!sync) { // phiên đăng nhập của giao diện: Bearer → cookie; đồng bộ Sapo giữ nguyên Authorization cho router kiểm mã bí mật
      const token = /^Bearer ([a-f0-9]{64})$/.exec(headers.get('authorization') || '')?.[1];
      headers.delete('authorization');
      if(token) headers.set('cookie', '__Host-bn-session=' + token);
    }
    const forwarded = new Request(ORIGIN+path+incoming.search,{method:req.method,headers,body:['GET','HEAD'].includes(req.method)?undefined:await req.arrayBuffer()});
    const response = await router.handle(forwarded,{db,waitUntil,sapoSyncToken:Deno.env.get('SAPO_SYNC_TOKEN') || '',sapoAdminBase:Deno.env.get('SAPO_ADMIN_BASE') || undefined});
    const payload = await response.json();
    const cookie = response.headers.get('set-cookie');
    if(cookie) payload.sessionToken = /__Host-bn-session=([a-f0-9]{64})/.exec(cookie)?.[1] || '';
    const body = JSON.stringify(payload), jsonHeaders = {...cors,'content-type':'application/json; charset=utf-8','x-content-type-options':'nosniff'};
    // Phản hồi lớn (bản chụp danh mục ~3 MB) nén gzip còn ~0,5 MB khi trình duyệt hỗ trợ.
    if (body.length > 100_000 && /\bgzip\b/.test(req.headers.get('accept-encoding') || '')) {
      const gz = new Blob([body]).stream().pipeThrough(new CompressionStream('gzip'));
      return new Response(gz,{status:response.status,headers:{...jsonHeaders,'content-encoding':'gzip','vary':'Origin, Accept-Encoding'}});
    }
    return new Response(body,{status:response.status,headers:jsonHeaders});
  } catch(e) {
    console.error('API request failed');
    return new Response(JSON.stringify({error:'Không thể kết nối dữ liệu. Vui lòng thử lại.'}),{status:503,headers:{...cors,'content-type':'application/json'}});
  }
});
