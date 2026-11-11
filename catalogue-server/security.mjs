/** Pages entry boundary. The opaque CRM token is never returned in JSON or logged. */
const identityUrl='https://taceqfnsorewelsbdckg.supabase.co/functions/v1/baogia-v2-api/api/staff/me';
const cookieName='__Secure-catalogue-session',tokenPattern=/^[A-Za-z0-9_.~+\/-]{16,3000}={0,2}$/;
const libraryPaths=new Set(['library','library-stock','library-image','library-bulk','quotes','quote-archive','customers']);
const safeHeaders={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin','X-Frame-Options':'DENY','Content-Security-Policy':"frame-ancestors 'none'; base-uri 'self'; object-src 'none'"};
const json=(data,status=200,extra={})=>Response.json(data,{status,headers:{...safeHeaders,...extra}});
const cookie=(token,age=300)=>`${cookieName}=${token}; Path=/catalogue; Max-Age=${age}; HttpOnly; Secure; SameSite=Strict`;
function credential(request){
 const header=request.headers.get('authorization');
 if(header!==null){const value=/^Bearer (.+)$/.exec(header)?.[1];return value&&tokenPattern.test(value)?value:'';}
 const value=(request.headers.get('cookie')||'').split(';').map(s=>s.trim()).find(s=>s.startsWith(cookieName+'='))?.slice(cookieName.length+1)||'';
 return tokenPattern.test(value)?value:'';
}
const digest=async value=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(n=>n.toString(16).padStart(2,'0')).join('');

/** Per-isolate backstop, not a substitute for distributed Cloudflare WAF rules. */
export function createCatalogueSecurity({fetcher=fetch,now=Date.now}={}){
 const rates=new Map(),verified=new Map(),inFlight=new Map();
 function consume(key,limit){
  const at=now();let entry=rates.get(key);if(!entry||at-entry.at>=60000){entry={at,count:0};rates.set(key,entry);}
  if(++entry.count>limit)return false;
  if(rates.size>2000){for(const [k,v] of rates)if(at-v.at>=60000)rates.delete(k);while(rates.size>2000)rates.delete(rates.keys().next().value);}
  return true;
 }
 async function verify(token,key,ip){
  const cached=verified.get(key);if(cached&&cached.until>now())return cached.user;
  if(inFlight.has(key))return inFlight.get(key);
  if(inFlight.size>=32){const error=Error('Đang có nhiều yêu cầu xác thực. Vui lòng thử lại sau.');error.status=429;throw error;}
  if(!consume('verify:'+ip,120)){const error=Error('Quá nhiều yêu cầu xác thực. Vui lòng chờ.');error.status=429;throw error;}
  const job=(async()=>{
   const response=await fetcher(identityUrl,{headers:{Authorization:'Bearer '+token,Origin:'https://crm.minhlongonline.com'},redirect:'manual',signal:AbortSignal.timeout(8000)});
   if(!response.ok){const error=Error(response.status===403?'Tài khoản chưa được phép dùng catalogue.':'Phiên CRM hết hạn. Vui lòng đăng nhập lại.');error.status=[401,403].includes(response.status)?response.status:503;throw error;}
   const body=await response.json(),user=body.user;
   if(!user?.id||!['manager','employee'].includes(user.role)||['supplier','customer'].includes(user.positionId)){const error=Error('Chỉ nhân viên CRM được sử dụng catalogue.');error.status=403;throw error;}
   const profile={id:user.id,name:user.name||'',role:user.role,position:user.position||''};
   verified.set(key,{user:profile,until:now()+15000});if(verified.size>1000)verified.delete(verified.keys().next().value);
   return profile;
  })();inFlight.set(key,job);try{return await job;}finally{inFlight.delete(key);}
 }
 return async function secure(request,env,handler){
  const url=new URL(request.url),endpoint=url.pathname.split('/').pop(),ip=request.headers.get('cf-connecting-ip')||'unknown';
  const origin=request.headers.get('origin');
  if(request.headers.get('sec-fetch-site')==='cross-site'||origin&&origin!==url.origin)return json({error:'Không cho phép gọi catalogue từ website khác.'},403);
  if(!consume('ip:'+ip,1200))return json({error:'Quá nhiều yêu cầu. Vui lòng chờ một phút.'},429,{'Retry-After':'60'});
  if(endpoint==='session'&&request.method==='DELETE')return json({ok:true},200,{'Set-Cookie':cookie('',0)});
  const token=credential(request);
  if(!token)return json({error:'Vui lòng đăng nhập CRM để sử dụng catalogue.'},401,{'Set-Cookie':cookie('',0)});
  const key=await digest(token),kind=endpoint==='assistant'||['product','products','product-metadata'].includes(endpoint)?'heavy':endpoint==='session'?'session':'general';
  if(!consume(key+':'+kind,kind==='heavy'?30:kind==='session'?30:600))return json({error:'Đã vượt giới hạn yêu cầu. Vui lòng chờ một phút.'},429,{'Retry-After':'60'});
  const headers=new Headers(request.headers);headers.set('authorization','Bearer '+token);headers.delete('cookie');
  const authenticated=new Request(request,{headers});
  try{
   // Library requests already authenticate and enforce permissions in CRM.
   // Avoid an extra /me query for each library/list/stock request.
   if(!libraryPaths.has(endpoint)){
    const user=await verify(token,key,ip);
    if(endpoint==='session'){
     if(!['POST','GET'].includes(request.method))return json({error:'Phương thức không hỗ trợ.'},405);
     return json({user},200,request.method==='POST'?{'Set-Cookie':cookie(token)}:{});
    }
   }
   const result=await handler(authenticated,env),response=new Response(result.body,result);for(const [k,v] of Object.entries(safeHeaders))response.headers.set(k,v);return response;
  }catch(error){return json({error:[401,403,429].includes(error.status)?error.message:'Chưa xác minh được phiên CRM. Thử lại sau.'},error.status||503,error.status===429?{'Retry-After':'60'}:{});}
 };
}
export const secureCatalogueApi=createCatalogueSecurity();
