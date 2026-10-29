/** Retry transient reads only. Never repeat a payment, stock change, or any other write. */
/** Báo giao diện đang thử lại (loading-feedback.js hiện "Mạng chậm, đang thử lại…"). */
const announceRetry=()=>{try{globalThis.dispatchEvent?.(new Event('api-retry'));}catch{/* không có window */}};
export function createApiTransport({fetcher=(...args)=>fetch(...args),delay=ms=>new Promise(r=>setTimeout(r,ms)),timeoutMs=15000,onRetry=announceRetry}={}){
 return async function request(url,init={}){
  const read=['GET','HEAD'].includes((init.method||'GET').toUpperCase());
  if(!read)return fetcher(url,init);
  for(let attempt=0;;attempt++){
   if(init.signal?.aborted)throw init.signal.reason||new DOMException('Aborted','AbortError');
   const controller=new AbortController(),abort=()=>controller.abort(init.signal.reason);
   init.signal?.addEventListener('abort',abort,{once:true});
   const timer=setTimeout(()=>controller.abort(),timeoutMs);let response;
   try{
    response=await fetcher(url,{...init,signal:controller.signal});
    if(![502,503,504].includes(response.status)||attempt>=2)return response;
   }catch(error){if(attempt>=2||init.signal?.aborted)throw error;}
   finally{clearTimeout(timer);init.signal?.removeEventListener('abort',abort);}
   await response?.body?.cancel().catch(()=>{});
   onRetry();
   const serverDelay=Number(response?.headers?.get('retry-after'))||0;
   await delay(Math.min(2000,Math.max(250*2**attempt,serverDelay*1000)));
  }
 };
}
export const apiFetch=createApiTransport();
