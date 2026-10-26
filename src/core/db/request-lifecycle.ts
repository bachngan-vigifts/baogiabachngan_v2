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
export function createDbReadiness<T extends object>({probe,isTransient,now=Date.now,delay=(ms:number)=>new Promise(r=>setTimeout(r,ms))}:{probe:(db:T)=>Promise<unknown>;isTransient:(e:unknown)=>boolean;now?:()=>number;delay?:(ms:number)=>Promise<unknown>}){
 const entries=new WeakMap<T,{okAt:number;pending:Promise<void>|null}>();
 return (db:T)=>{
  let state=entries.get(db);if(!state){state={okAt:-Infinity,pending:null};entries.set(db,state);}
  if(now()-state.okAt<5000)return Promise.resolve();
  if(state.pending)return state.pending;
  const current=state;
  current.pending=(async()=>{for(let attempt=0;;attempt++){
   try{await probe(db);current.okAt=now();return;}catch(e){if(attempt>=4||!isTransient(e))throw e;await delay(250*2**attempt);}
  }})().finally(()=>{current.pending=null;});
  return current.pending;
 };
}
