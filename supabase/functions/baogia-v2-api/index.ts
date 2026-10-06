import { createDb, closeDb } from '../../../src/core/db/client.ts';
import * as schema from '../../../src/db/schema.ts';
import { createAppRouter } from '../../../src/app/router.ts';
// Trang giao diện được phép gọi API. Thêm địa chỉ mới (vd Cloudflare Pages) bằng secret ALLOWED_ORIGINS="https://a,https://b".
const ORIGINS = new Set(["https://bachngan-baogia-v2.lucky-thyme-5212.chatgpt.site", "https://crm.minhlongonline.com",
  ...(Deno.env.get('ALLOWED_ORIGINS') || '').split(',').map(s => s.trim().replace(/\/+$/, '')).filter(s => /^https:\/\/[^/]+$/.test(s))]);
const router = createAppRouter();
Deno.serve(async req => {
  const incoming = new URL(req.url), origin = req.headers.get('origin') || '';
  const ORIGIN = origin; // liên kết kích hoạt/đặt lại mật khẩu trỏ về đúng trang đã gửi yêu cầu
  const cors = { 'access-control-allow-origin': ORIGIN, 'access-control-allow-headers': 'authorization, content-type', 'access-control-allow-methods': 'GET, POST, PUT, DELETE, OPTIONS', 'vary': 'Origin', 'cache-control': 'no-store' };
  if (!ORIGINS.has(origin)) return new Response(JSON.stringify({error:'Nguồn yêu cầu không hợp lệ.'}), {status:403,headers:{'content-type':'application/json'}});
  if (req.method === 'OPTIONS') return new Response(null, {status:204,headers:cors});
  const url = Deno.env.get('SUPABASE_DB_URL');
  if (!url) return new Response(JSON.stringify({error:'Kết nối dữ liệu chưa sẵn sàng.'}), {status:503,headers:{...cors,'content-type':'application/json'}});
  const db = createDb(url, schema);
  try {
    if (incoming.pathname.endsWith('/health')) {
      await db.select({id:schema.positions.id}).from(schema.positions).limit(1);
      return new Response(JSON.stringify({ok:true}), {headers:{...cors,'content-type':'application/json'}});
    }
    const path = incoming.pathname.slice(incoming.pathname.indexOf('/api/staff'));
    if (!incoming.pathname.includes('/api/staff')) return new Response('{}',{status:404,headers:cors});
    const headers = new Headers(req.headers); headers.delete('cookie');
    const token = /^Bearer ([a-f0-9]{64})$/.exec(headers.get('authorization') || '')?.[1];
    headers.delete('authorization');
    if(token) headers.set('cookie', '__Host-bn-session=' + token);
    const forwarded = new Request(ORIGIN+path+incoming.search,{method:req.method,headers,body:['GET','HEAD'].includes(req.method)?undefined:await req.arrayBuffer()});
    const response = await router.handle(forwarded,{db});
    const payload = await response.json();
    const cookie = response.headers.get('set-cookie');
    if(cookie) payload.sessionToken = /__Host-bn-session=([a-f0-9]{64})/.exec(cookie)?.[1] || '';
    return new Response(JSON.stringify(payload),{status:response.status,headers:{...cors,'content-type':'application/json; charset=utf-8','x-content-type-options':'nosniff'}});
  } catch(e) {
    console.error('API request failed');
    return new Response(JSON.stringify({error:'Không thể kết nối dữ liệu. Vui lòng thử lại.'}),{status:503,headers:{...cors,'content-type':'application/json'}});
  } finally { await closeDb(db); }
});
