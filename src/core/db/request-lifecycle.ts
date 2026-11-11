/** Share a client only while requests/background jobs actively use it in direct-connection mode. */
export function createDbLifecycle<T>({create,close,keepWarm=false,onCloseError=()=>{}}:{create:()=>T;close:(db:T)=>Promise<unknown>;keepWarm?:boolean;onCloseError?:(e:unknown)=>void}){
 type Entry={db:T;users:number};let shared:Entry|null=null;
 async function drop(entry:Entry){
  entry.users--;
  if(entry.users===0&&!keepWarm){if(shared===entry)shared=null;try{await close(entry.db);}catch(e){onCloseError(e);}}
 }
 return {acquire(){const entry=shared??(shared={db:create(),users:0});entry.users++;let released=false;
  return {db:entry.db,release:()=>{if(released)return Promise.resolve();released=true;return drop(entry);},
   track<P>(work:Promise<P>){entry.users++;return work.finally(()=>drop(entry));}};
 }};
}

/** Coalesce cold-start probes so parallel API calls do not all retry the exhausted database. */
export function createDbReadiness<T extends object>({probe,isTransient,now=Date.now,random=Math.random,delay=(ms:number)=>new Promise(r=>setTimeout(r,ms))}:{probe:(db:T)=>Promise<unknown>;isTransient:(e:unknown)=>boolean;now?:()=>number;random?:()=>number;delay?:(ms:number)=>Promise<unknown>}){
 // A direct client can be replaced after every burst. Keep the brief capacity
 // cooldown at isolate level so replacing the client cannot restart five probes.
 let blockedUntil=0,blockedError:unknown;
 const entries=new WeakMap<T,{okAt:number;pending:Promise<void>|null}>();
 return (db:T)=>{
  if(now()<blockedUntil)return Promise.reject(blockedError);
  let state=entries.get(db);if(!state){state={okAt:-Infinity,pending:null};entries.set(db,state);}
  if(now()-state.okAt<5000)return Promise.resolve();
  if(state.pending)return state.pending;
  const current=state;
  current.pending=(async()=>{for(let attempt=0;;attempt++){
   try{await probe(db);current.okAt=now();blockedUntil=0;blockedError=undefined;return;}catch(e){if(!isTransient(e))throw e;if(attempt>=4){blockedUntil=now()+1000;blockedError=e;throw e;}
    const base=250*2**attempt;await delay(base+Math.floor(base*0.25*random()));}
  }})().finally(()=>{current.pending=null;});
  return current.pending;
 };
}
