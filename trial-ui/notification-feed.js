/** Share the initial bell/Home read in memory only; auth/session remains enforced by api(). */
export function createNotificationFeed({api,identity,now=Date.now}) {
  let owner, pending=null, data=null, at=0;
  const clear=()=>{owner=undefined;pending=null;data=null;at=0;};
  function read(path,method='GET',body) {
    const who=identity();if(who!==owner){clear();owner=who;}
    const scoped=promise=>promise.then(result=>{if(who!==identity())throw Error('Phiên thông báo đã thay đổi.');return result;});
    if(method!=='GET'){if(path.startsWith('/notifications')){data=null;at=0;}return scoped(api(path,method,body));}
    if(path!=='/notifications')return scoped(api(path,method,body));
    if(pending)return scoped(pending);
    if(data&&now()-at<3000)return scoped(Promise.resolve(data));
    const request=Promise.resolve().then(()=>api(path)).then(result=>{if(who!==identity()||owner!==who)throw Error('Phiên thông báo đã thay đổi.');data=result;at=now();return result;}).finally(()=>{if(pending===request)pending=null;});
    pending=request;return request;
  }
  return {read,clear};
}
