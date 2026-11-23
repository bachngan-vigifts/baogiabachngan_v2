/** Retry transient reads only. Never repeat a payment, stock change, or any other write. */
/** Báo giao diện đang thử lại (loading-feedback.js hiện "Mạng chậm, đang thử lại…"). */
/** Đồng hồ đơn điệu (cùng loại với performance.now() ở app.js) – clock() nhảy khi máy ngủ / chỉnh giờ làm số đo lệch. */
const clock=()=>globalThis.performance?.now?.()??clock();
const announceRetry=()=>{try{globalThis.dispatchEvent?.(new Event('api-retry'));}catch{/* không có window */}};
/** Lệnh ghi không bao giờ gửi lại tự động; chỉ có giới hạn thời gian chờ (45 giây + 1 giây mỗi 100 KB gửi lên) để không quay mãi. */
export function createApiTransport({fetcher=(...args)=>fetch(...args),delay=ms=>new Promise(r=>setTimeout(r,ms)),timeoutMs=15000,writeTimeoutMs=45000,onRetry=announceRetry}={}){
 // `onAttempt` (đo tốc độ): mỗi lần gửi thật báo {ms, status} hoặc {ms, error:'timeout'|'network'} – không đổi cách thử lại.
 return async function request(url,init={}, {readRetries=2,timeoutMs:readTimeoutMs=timeoutMs,onAttempt=()=>{}}={}){
  const read=['GET','HEAD'].includes((init.method||'GET').toUpperCase());
  if(!read){
   const size=typeof init.body==='string'?init.body.length:0,controller=new AbortController(),abort=()=>controller.abort(init.signal.reason);
   init.signal?.addEventListener('abort',abort,{once:true});
   const timer=setTimeout(()=>controller.abort(new DOMException('Write timed out','TimeoutError')),writeTimeoutMs+Math.ceil(size/100_000)*1000);
   const started=clock();
   try{const response=await fetcher(url,{...init,signal:controller.signal});onAttempt({ms:clock()-started,status:response.status});return response;}
   catch(error){onAttempt({ms:clock()-started,error:controller.signal.aborted&&!init.signal?.aborted?'timeout':'network'});throw error;}
   finally{clearTimeout(timer);init.signal?.removeEventListener('abort',abort);}
  }
  for(let attempt=0;;attempt++){
   if(init.signal?.aborted)throw init.signal.reason||new DOMException('Aborted','AbortError');
   const controller=new AbortController(),abort=()=>controller.abort(init.signal.reason);
   init.signal?.addEventListener('abort',abort,{once:true});
   const timer=setTimeout(()=>controller.abort(),readTimeoutMs);let response;const started=clock();
   try{
    response=await fetcher(url,{...init,signal:controller.signal});
    onAttempt({ms:clock()-started,status:response.status});
    if(![502,503,504].includes(response.status)||attempt>=readRetries)return response;
   }catch(error){onAttempt({ms:clock()-started,error:controller.signal.aborted&&!init.signal?.aborted?'timeout':'network'});if(attempt>=readRetries||init.signal?.aborted)throw error;}
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
/**
 * Đọc thân JSON của API. Không đọc được hoặc không phải object (trang HTML của cổng trung gian / wifi công cộng,
 * JSON bị cắt khi mất mạng giữa chừng, thân rỗng, `null`) → trả null để nơi gọi KHÔNG coi là thành công.
 */
export async function readApiJson(res){try{const d=await res.json();return d!==null&&typeof d==='object'?d:null;}catch{return null;}}
/** Lỗi cho phản hồi không đọc được: lệnh ghi = chưa rõ đã lưu (giữ form + mã chống lặp, không tự gửi lại); lệnh đọc = báo lỗi. */
// Lệnh ghi mang status 0 như mất mạng: các form đang coi `!e.status || e.status >= 500` là "chưa rõ" (giữ mã chống lặp, báo kiểm tra trước khi gửi lại).
export function invalidResponseError(method,status,body,make=(message,code,shownStatus)=>Object.assign(new Error(message),{status:shownStatus,code})){
 const read=['GET','HEAD'].includes(String(method||'GET').toUpperCase());
 return read?make(status>=500||status===0?'Máy chủ chưa sẵn sàng. Vui lòng thử lại.':'Phản hồi máy chủ không hợp lệ. Vui lòng tải lại trang.',undefined,status)
  :make(writeFailureMessage(body),UNKNOWN_OUTCOME,0);
}
export function writeFailureMessage(body){
 const keyed=!!body&&typeof body==='object'&&['key','clientKey','requestKey'].some(k=>typeof body[k]==='string'&&body[k].length>=8);
 return keyed?'Mạng chập chờn: chưa rõ máy chủ đã lưu hay chưa. Bấm gửi lại – an toàn, hệ thống không ghi trùng.'
  :'Mạng chập chờn: chưa rõ máy chủ đã lưu hay chưa. Tải lại trang kiểm tra trước khi gửi lại để tránh ghi trùng.';
}
