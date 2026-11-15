const MODEL = 'gemini-flash-lite-latest';
const reply = (message, status) => Response.json({error:{message}}, {status, headers:{'Cache-Control':'no-store'}});
export async function handle(request, env, upstream = fetch) {
  const url = new URL(request.url);
  if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
  if (!env.GEMINI_API_KEY || !env.CHAT_LIMITS) return reply('Trợ lý đang được cấu hình, vui lòng thử lại sau.',503);
  const origin = request.headers.get('Origin');
  if (origin && origin !== url.origin) return reply('Origin denied',403);
  if (request.method === 'GET' && url.pathname === '/api/v1beta/models') return Response.json({models:[{name:'models/'+MODEL,displayName:'Gemini Flash Lite',supportedGenerationMethods:['generateContent','streamGenerateContent']}]});
  const stream = url.pathname === '/api/v1beta/models/'+MODEL+':streamGenerateContent';
  if (request.method !== 'POST' || (!stream && url.pathname !== '/api/v1beta/models/'+MODEL+':generateContent')) return reply('Unsupported request',404);
  if (!request.headers.get('Content-Type')?.includes('application/json')) return reply('JSON required',415);
  if (Number(request.headers.get('Content-Length') || 0) > 24000) return reply('Message too long',413);
  let raw;
  try {
    const reader=request.body?.getReader(); if(!reader)return reply('Missing body',400);
    const chunks=[];let size=0;
    for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>24000){await reader.cancel();return reply('Message too long',413);}chunks.push(value);}
    const joined=new Uint8Array(size);let offset=0;for(const chunk of chunks){joined.set(chunk,offset);offset+=chunk.length;}
    raw=JSON.parse(new TextDecoder().decode(joined));
  } catch { return reply('Invalid JSON',400); }
  if (!Array.isArray(raw.contents) || raw.contents.length < 1 || raw.contents.length > 20) return reply('Invalid conversation',400);
  let length=0;
  for(const content of raw.contents){
    if(!['user','model'].includes(content.role || 'user') || !Array.isArray(content.parts) || content.parts.length>10)return reply('Text chat only',400);
    for(const part of content.parts){if(typeof part.text!=='string' || Object.keys(part).some(k=>k!=='text'))return reply('Text chat only',400);length+=part.text.length;}
  }
  if(length>12000)return reply('Conversation too long',413);
  try {
    if (!(await reserveUsage(request,env))) return reply('Đã đạt giới hạn sử dụng. Vui lòng thử lại sau.',429);
  } catch { return reply('Trợ lý tạm thời không khả dụng.',503); }
  const payload={contents:raw.contents,systemInstruction:{parts:[{text:'Bạn là trợ lý AI của LocknLockOnline. Trả lời bằng tiếng Việt, ngắn gọn. Chưa kết nối dữ liệu cửa hàng: không khẳng định giá, tồn kho, chính sách hoặc thông tin đơn hàng khi chưa được cung cấp. Không yêu cầu thông tin thanh toán hay mật khẩu.'}]},generationConfig:{maxOutputTokens:512,temperature:0.3}};
  try {
    const result=await upstream('https://generativelanguage.googleapis.com/v1beta/models/'+MODEL+(stream?':streamGenerateContent?alt=sse':':generateContent'),{method:'POST',headers:{'Content-Type':'application/json','X-goog-api-key':env.GEMINI_API_KEY},body:JSON.stringify(payload),signal:AbortSignal.timeout(45000)});
    if(!result.ok)return reply(result.status===429?'AI quota exceeded':'AI temporarily unavailable',result.status===429?429:502);
    return new Response(result.body,{headers:{'Content-Type':stream?'text/event-stream':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
  } catch {return reply('AI temporarily unavailable',502);}
}
export default {fetch(request, env) { return handle(request, env); }};

export const COUNTER_SQL = 'INSERT INTO chat_usage (bucket,n,expires) VALUES (?,1,?) ON CONFLICT(bucket) DO UPDATE SET n=n+1 WHERE n < ? RETURNING n';
export async function reserveUsage(request,env,now=Date.now()) {
  const ip=request.headers.get('CF-Connecting-IP');
  if(!ip) return false;
  const day=Math.floor(now/86400000),minute=Math.floor(now/60000);
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(env.GEMINI_API_KEY),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const digest=await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(day+':'+ip));
  const id=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
  const stmt=env.CHAT_LIMITS.prepare(COUNTER_SQL);
  const result=await env.CHAT_LIMITS.batch([
    env.CHAT_LIMITS.prepare('DELETE FROM chat_usage WHERE expires < ?').bind(now),
    stmt.bind('m:'+minute+':'+id,now+120000,6),
    stmt.bind('d:'+day+':'+id,(day+2)*86400000,30)
  ]);
  if(result.slice(1).some(r=>!r.success || r.results.length!==1)) return false;
  const global=await stmt.bind('g:'+day,(day+2)*86400000,1000).all();
  return global.success && global.results.length===1;
}
