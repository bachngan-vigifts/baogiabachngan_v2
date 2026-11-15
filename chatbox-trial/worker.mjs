const MODEL = 'gemini-flash-lite-latest';
const reply = (message, status) => Response.json({error:{message}}, {status, headers:{'Cache-Control':'no-store'}});
export async function handle(request, env, upstream = fetch) {
  if (!env.CHATBOX_TRIAL_PASSWORD || !env.GEMINI_API_KEY) return reply('Trial is not configured', 503);
  const expected = 'Basic ' + btoa('thai:' + env.CHATBOX_TRIAL_PASSWORD);
  if (request.headers.get('Authorization') !== expected) return new Response('Private Chatbox trial', {status:401, headers:{'WWW-Authenticate':'Basic realm="Chatbox trial", charset="UTF-8"','Cache-Control':'no-store'}});
  const url = new URL(request.url);
  if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
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
  const payload={contents:raw.contents,systemInstruction:{parts:[{text:'Bạn là trợ lý thử nghiệm của LocknLockOnline. Trả lời bằng tiếng Việt, ngắn gọn. Chưa kết nối dữ liệu cửa hàng: không khẳng định giá, tồn kho, chính sách hoặc thông tin đơn hàng khi chưa được cung cấp. Không yêu cầu thông tin thanh toán hay mật khẩu.'}]},generationConfig:{maxOutputTokens:512,temperature:0.3}};
  try {
    const result=await upstream('https://generativelanguage.googleapis.com/v1beta/models/'+MODEL+(stream?':streamGenerateContent?alt=sse':':generateContent'),{method:'POST',headers:{'Content-Type':'application/json','X-goog-api-key':env.GEMINI_API_KEY},body:JSON.stringify(payload),signal:AbortSignal.timeout(45000)});
    if(!result.ok)return reply(result.status===429?'AI quota exceeded':'AI temporarily unavailable',result.status===429?429:502);
    return new Response(result.body,{headers:{'Content-Type':stream?'text/event-stream':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
  } catch {return reply('AI temporarily unavailable',502);}
}
export default {fetch(request, env) { return handle(request, env); }};
