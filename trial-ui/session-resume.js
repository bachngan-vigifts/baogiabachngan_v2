/** Cached identity opens the UI only; every API still authenticates and authorizes the real session. */
export function createSessionResume({storage,readToken,verify,open,refresh,key='bn-v2-session-profile'}) {
  function clear(){try{storage().removeItem(key);}catch{/* Storage may be unavailable. */}}
  function cached(session){
    try{
      const value=JSON.parse(storage().getItem(key)||'null');
      const user=value?.user;
      return value?.session===session&&typeof user?.id==='string'&&typeof user.name==='string'&&typeof user.email==='string'&&['manager','employee'].includes(user.role)&&!['supplier','customer'].includes(user.positionId)?user:null;
    }catch{return null;}
  }
  return {
    clear,
    async resume({useCache=true}={}){
      const session=readToken();if(!session)return;
      const user=useCache?cached(session):null;
      // app.js initializes its route handlers below the startup call.
      await Promise.resolve();
      if(readToken()!==session)return;
      if(user)open(user);
      try{
        const result=await verify();
        if(readToken()!==session)return;
        try{storage().setItem(key,JSON.stringify({session,user:result.user}));}catch{/* Do not fail login when storage is blocked. */}
        if(user)refresh(result.user);else open(result.user);
      }catch(error){
        if(readToken()!==session)return; // A delayed old response cannot reopen/close another account.
        throw error;
      }
    },
  };
}
