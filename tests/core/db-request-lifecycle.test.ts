import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createDbLifecycle,createDbReadiness} from '../../src/core/db/request-lifecycle.ts';
const deferred=()=>{let resolve!:(v?:any)=>void;const promise=new Promise<void>(r=>resolve=r);return {promise,resolve};};
test('Direct database clients close exactly after the last overlapping request/background job',async()=>{
 let created=0;const closed:number[]=[];const pool=createDbLifecycle({create:()=>({id:++created}),close:async db=>{closed.push(db.id);}});
 const a=pool.acquire(),b=pool.acquire();assert.equal(a.db,b.db);
 const pending=deferred(),work=a.track(pending.promise);await a.release();await a.release();await b.release();assert.deepEqual(closed,[]);
 pending.resolve();await work;assert.deepEqual(closed,[1]);const c=pool.acquire();assert.equal(c.db.id,2);await c.release();assert.deepEqual(closed,[1,2]);
});
test('A draining direct client is not reused; pooler clients may stay warm and close failures do not fail a committed request',async()=>{
 const closing=deferred();let made=0,errors=0;
 const pool=createDbLifecycle({create:()=>({id:++made}),close:async()=>closing.promise});
 const a=pool.acquire(),done=a.release(),b=pool.acquire();assert.notEqual(a.db,b.db);closing.resolve();await done;await b.release();
 const warm=createDbLifecycle({create:()=>({}),close:async()=>{throw Error('should not close warm client');},keepWarm:true});
 const w=warm.acquire();await w.release();assert.equal(warm.acquire().db,w.db);
 const failed=createDbLifecycle({create:()=>({}),close:async()=>{throw Error('closed');},onCloseError:()=>errors++});await failed.acquire().release();assert.equal(errors,1);
});
test('Readiness coalesces connection exhaustion retries, caches success per client, and briefly suppresses capacity failures across replacement clients',async()=>{
 const pending=deferred(),waits:number[]=[];let probes=0,clock=10000;
 const ready=createDbReadiness({random:()=>0,now:()=>clock,probe:async()=>{probes++;if(probes===1){await pending.promise;throw {code:'53300'};}},isTransient:e=>(e as any).code==='53300',delay:async ms=>{waits.push(ms);}});
 const db={},a=ready(db),b=ready(db);assert.equal(probes,1);pending.resolve();await Promise.all([a,b]);assert.equal(probes,2);assert.deepEqual(waits,[250]);
 await ready(db);assert.equal(probes,2);clock+=5001;await ready(db);assert.equal(probes,3);await ready({});assert.equal(probes,4);
 let attempts=0;const fail=createDbReadiness({now:()=>clock,probe:async()=>{attempts++;throw Error('full');},isTransient:()=>true,delay:async()=>{}});
 await assert.rejects(fail(db));assert.equal(attempts,5);await assert.rejects(fail(db));assert.equal(attempts,5,'capacity cooldown does not immediately repeat probes');clock+=1000;await assert.rejects(fail({}));assert.equal(attempts,10);
});

test('Capacity bursts share five probes, jitter their backoff, and recover after a short cooldown',async()=>{
 let clock=10000,probes=0,full=true;const waits:number[]=[];
 const capacity=Error('capacity');
 const ready=createDbReadiness({now:()=>clock,random:()=>0.5,probe:async()=>{probes++;if(full)throw capacity;},isTransient:e=>e===capacity,delay:async ms=>{waits.push(ms);}});
 const db={},burst=await Promise.allSettled(Array.from({length:30},()=>ready(db)));
 assert.ok(burst.every(x=>x.status==='rejected'));assert.equal(probes,5);assert.deepEqual(waits,[281,562,1125,2250]);
 await Promise.allSettled(Array.from({length:30},()=>ready({})));assert.equal(probes,5,'new clients do not bypass cooldown');
 full=false;clock+=1000;await ready({});assert.equal(probes,6,'recover without restarting the isolate');
 let errors=0;const invalid=createDbReadiness({probe:async()=>{errors++;throw Error('invalid SQL');},isTransient:()=>false});
 await assert.rejects(invalid({}));await assert.rejects(invalid({}));assert.equal(errors,2,'non-capacity failures are never cached/retried');
});
