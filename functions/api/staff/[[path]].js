// Cloudflare Pages Function: /api/staff/* trên CHÍNH tên miền giao diện (crm.minhlongonline.com) → Edge Function baogia-v2-api.
// Nhờ cùng tên miền, cookie phiên HttpOnly `__Host-bn-session` là cookie first-party: Safari / iPhone (kể cả app thêm vào
// màn hình chính) không chặn như cookie bên thứ ba, và token không phải nằm trong JSON hay localStorage.
// Proxy giữ nguyên Set-Cookie của API; Origin luôn là tên miền này (fetch GET cùng nguồn không gửi Origin, API thì bắt buộc).
// Biến môi trường (Cloudflare Pages → Settings → Variables and Secrets; tuỳ chọn):
//   API_UPSTREAM     địa chỉ Edge Function (mặc định dự án Supabase đang dùng)
//   API_PROXY_SECRET mã bí mật ≥ 32 ký tự, TRÙNG secret cùng tên của Edge Function: API mới tin IP người dùng do proxy gửi
//                    (giới hạn số lần đăng nhập theo IP). Thiếu thì mọi yêu cầu mang IP của Cloudflare Worker.
const DEFAULT_UPSTREAM = 'https://taceqfnsorewelsbdckg.supabase.co/functions/v1/baogia-v2-api';
const FORWARD = ['accept', 'accept-language', 'authorization', 'content-type', 'cookie', 'user-agent', 'x-sapo-sync-token', 'x-sapo-inventory-token'];
const json = (status, error) => new Response(JSON.stringify({ error }), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });

export async function onRequest({ request, env = {} }) {
  const url = new URL(request.url), self = url.origin;
  // Trang khác gọi sang (CSRF / CORS): từ chối. Giao diện cùng nguồn gửi đúng Origin này hoặc không gửi (GET).
  const origin = request.headers.get('origin');
  if (origin && origin !== self) return json(403, 'Nguồn yêu cầu không hợp lệ.');
  const headers = new Headers();
  for (const k of FORWARD) { const v = request.headers.get(k); if (v) headers.set(k, v); }
  headers.set('origin', self);
  const ip = request.headers.get('cf-connecting-ip');
  if (env.API_PROXY_SECRET && ip) { headers.set('x-bn-proxy-secret', env.API_PROXY_SECRET); headers.set('x-bn-client-ip', ip); }
  const upstream = String(env.API_UPSTREAM || DEFAULT_UPSTREAM).replace(/\/+$/, '');
  let res;
  try {
    res = await fetch(upstream + url.pathname + url.search, {
      method: request.method, headers, redirect: 'manual',
      body: ['GET', 'HEAD'].includes(request.method) ? undefined : await request.arrayBuffer(),
    });
  } catch { return json(502, 'Chưa kết nối được máy chủ. Vui lòng thử lại.'); }
  // Giữ nguyên trạng thái, thân, Set-Cookie; bỏ header CORS (cùng nguồn, không cần).
  const out = new Response(res.body, res);
  for (const k of [...out.headers.keys()]) if (k.startsWith('access-control-')) out.headers.delete(k);
  out.headers.set('cache-control', 'no-store, private');
  return out;
}
