/** Retry transient reads only. Never repeat a payment, stock change, or any other write. */
/** Báo giao diện đang thử lại (loading-feedback.js hiện "Mạng chậm, đang thử lại…"). */
const announceRetry=()=>{try{globalThis.dispatchEvent?.(new Event('api-retry'));}catch{/* không có window */}};
/** Lệnh ghi không bao giờ gửi lại tự động; chỉ có giới hạn thời gian chờ (45 giây + 1 giây mỗi 100 KB gửi lên) để không quay mãi. */
export function createApiTransport({fetcher=(...args)=>fetch(...args),delay=ms=>new Promise(r=>setTimeout(r,ms)),timeoutMs=15000,writeTimeoutMs=45000,onRetry=announceRetry}={}){
 return async function request(url,init={}, {readRetries=2,timeoutMs:readTimeoutMs=timeoutMs}={}){
  const read=['GET','HEAD'].includes((init.method||'GET').toUpperCase());
  if(!read){
   const size=typeof init.body==='string'?init.body.length:0,controller=new AbortController(),abort=()=>controller.abort(init.signal.reason);
   init.signal?.addEventListener('abort',abort,{once:true});
   const timer=setTimeout(()=>controller.abort(new DOMException('Write timed out','TimeoutError')),writeTimeoutMs+Math.ceil(size/100_000)*1000);
   try{return await fetcher(url,{...init,signal:controller.signal});}
   finally{clearTimeout(timer);init.signal?.removeEventListener('abort',abort);}
  }
  for(let attempt=0;;attempt++){
   if(init.signal?.aborted)throw init.signal.reason||new DOMException('Aborted','AbortError');
   const controller=new AbortController(),abort=()=>controller.abort(init.signal.reason);
   init.signal?.addEventListener('abort',abort,{once:true});
   const timer=setTimeout(()=>controller.abort(),readTimeoutMs);let response;
   try{
    response=await fetcher(url,{...init,signal:controller.signal});
    if(![502,503,504].includes(response.status)||attempt>=readRetries)return response;
   }catch(error){if(attempt>=readRetries||init.signal?.aborted)throw error;}
   finally{clearTimeout(timer);init.signal?.removeEventListener('abort',abort);}
   await response?.body?.cancel().catch(()=>{});
   onRetry();
   const serverDelay=Number(response?.headers?.get('retry-after'))||0;
   await delay(Math.min(2000,Math.max(250*2**attempt,serverDelay*1000)));
  }
 };
}
export const apiFetch=createApiTransport();
/** Lỗi mạng / quá giờ khi GHI: máy chủ có thể đã lưu. Lệnh có mã chống lặp thì gửi lại an toàn; không có thì phải kiểm tra trước. */
export const UNKNOWN_OUTCOME='OUTCOME_UNKNOWN';
export function writeFailureMessage(body){
 const keyed=!!body&&typeof body==='object'&&['key','clientKey','requestKey'].some(k=>typeof body[k]==='string'&&body[k].length>=8);
 return keyed?'Mạng chập chờn: chưa rõ máy chủ đã lưu hay chưa. Bấm gửi lại – an toàn, hệ thống không ghi trùng.'
  :'Mạng chập chờn: chưa rõ máy chủ đã lưu hay chưa. Tải lại trang kiểm tra trước khi gửi lại để tránh ghi trùng.';
}
