// Đọc cấu trúc cửa hàng WooCommerce Web Lock qua REST API (chỉ GET, không ghi gì).
// Không in thông tin khách hàng/đơn hàng: phần đơn chỉ lấy số lượng theo trạng thái và tên trường.
// Không in khoá/secret: cổng thanh toán chỉ lấy id/tên/bật-tắt, webhook chỉ lấy host nhận.
import { writeFileSync } from 'node:fs';

const raw = (process.env.WC_BASE_URL || '').trim().replace(/\/+$/, '');
const key = process.env.WC_CONSUMER_KEY || '';
const secret = process.env.WC_CONSUMER_SECRET || '';
if (!raw || !key || !secret) throw new Error('Thiếu WC_BASE_URL / WC_CONSUMER_KEY / WC_CONSUMER_SECRET');
const base = raw.replace(/\/wp-json.*$/, '') + '/wp-json/wc/v3';
let useQueryAuth = false;

async function get(path, params = {}) {
  const url = new URL(base + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  const headers = { Accept: 'application/json', 'User-Agent': 'store-structure-probe' };
  if (useQueryAuth) { url.searchParams.set('consumer_key', key); url.searchParams.set('consumer_secret', secret); }
  else headers.Authorization = 'Basic ' + Buffer.from(`${key}:${secret}`).toString('base64');
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(60_000) });
  if (res.status === 401 && !useQueryAuth) { useQueryAuth = true; return get(path, params); }
  const text = await res.text();
  let body; try { body = JSON.parse(text); } catch { body = text.slice(0, 200); }
  if (!res.ok) return { ok: false, status: res.status, error: body?.code || body?.message || body };
  return { ok: true, body, total: Number(res.headers.get('x-wp-total') ?? NaN), pages: Number(res.headers.get('x-wp-totalpages') ?? NaN) };
}
async function all(path, params = {}, max = 20) {
  const out = []; let page = 1;
  for (;;) {
    const r = await get(path, { ...params, per_page: 100, page });
    if (!r.ok) return out.length ? out : r;
    out.push(...r.body);
    if (!Array.isArray(r.body) || r.body.length < 100 || page >= max || page >= (r.pages || 1)) return out;
    page++;
  }
}
const pick = (o, ks) => Object.fromEntries(ks.filter(k => k in (o || {})).map(k => [k, o[k]]));
const hostOf = u => { try { return new URL(u).host; } catch { return null; } };
const metaKeys = list => [...new Set(list.flatMap(p => (p.meta_data || []).map(m => m.key)))].sort();
const safe = async (name, fn) => { try { return await fn(); } catch (e) { return { ok: false, error: String(e?.message || e) }; } };


const order=await get('/orders/21825');
if(!order.ok)throw Error('Order read failed '+order.status);
console.log('ORDER_21825 '+JSON.stringify(pick(order.body,['id','status','payment_method','date_paid','date_created','total','transaction_id'])));
console.log('ORDER_META_KEYS '+JSON.stringify((order.body.meta_data||[]).map(m=>m.key)));
const hooks=await all('/webhooks');if(!Array.isArray(hooks))throw Error('Webhook read failed');
console.log('WEBHOOKS '+JSON.stringify(hooks.map(h=>({id:h.id,status:h.status,topic:h.topic,host:hostOf(h.delivery_url),path:new URL(h.delivery_url).pathname}))));
