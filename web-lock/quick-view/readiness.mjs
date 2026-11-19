/** Bounded, read-only cache propagation checks. Only the normal public URL can pass. */
export async function checkHomepage({fetcher=fetch,delay=ms=>new Promise(r=>setTimeout(r,ms)),log=console.log,now=Date.now}={}){
 const home='https://locknlockonline.com/';
 async function probe(fresh){
  try{
   const r=await fetcher(home+(fresh?'?lnl_qv_origin='+now():''),{method:'GET',signal:AbortSignal.timeout(fresh?10000:20000)});
   const html=await r.text(),marker=html.includes('lnl-native-quick-view'),button=html.includes('href="#quick-view"');
   log('HOME_CHECK',JSON.stringify({fresh,status:r.status,marker,button,cache:r.headers.get('cf-cache-status'),ls:r.headers.get('x-litespeed-cache')}));
   return r.ok&&marker&&button;
  }catch(error){
   // A cache-busting URL may be much slower than the normal cached homepage.
   // A failed read never proves readiness and never prevents the next normal check.
   log('HOME_CHECK_READ_FAILED',JSON.stringify({fresh,error:error.name||'Error'}));return false;
  }
 }
 for(let attempt=0;attempt<3;attempt++){
  if(await probe(false))return true;
  await probe(true); // Diagnostic only; an origin response cannot certify the public cached page.
  if(attempt<2)await delay(1000*2**attempt);
 }
 throw Error('Public homepage readiness unconfirmed after 3 bounded attempts');
}
