import {test} from 'node:test';
import assert from 'node:assert/strict';
import {and,eq} from 'drizzle-orm';
import {createTestDb} from '../helpers/postgres.ts';
import {syncJobs as jobs} from '../../src/core/db/schema.ts';
import {enqueueSyncJob,tickSyncJob} from '../../src/core/jobs/sync-jobs.ts';

test('durable queue coalesces enqueue and serializes separate callers across kinds',async()=>{
 const {db}=await createTestDb();await enqueueSyncJob(db,'sapo',{phase:0});await enqueueSyncJob(db,'sapo',{phase:99});await enqueueSyncJob(db,'ghn');
 assert.equal((await db.select().from(jobs)).length,2);
 let entered!:()=>void,release!:()=>void;const enteredPromise=new Promise<void>(r=>entered=r),gate=new Promise<void>(r=>release=r);
 const first=tickSyncJob(db,async(_kind,state)=>{assert.equal(state.phase,0);entered();await gate;return{state:{phase:1},result:{ok:true},done:false};});
 await enteredPromise;
 try{assert.deepEqual(await tickSyncJob(db,async()=>{throw Error('must not run concurrently');}),{worked:false});}finally{release();}
 assert.equal((await first).worked,true);
 const [row]=await db.select().from(jobs).where(eq(jobs.key,'sapo'));assert.equal(JSON.parse(row!.state).phase,1);
 let kind='';await tickSyncJob(db,async k=>{kind=k;return{state:{},result:{},done:true};});assert.equal(kind,'ghn','yielded jobs cannot starve the next kind');
});

test('expired worker resumes its persisted cursor and a stale lease cannot overwrite it',async()=>{
 const {db}=await createTestDb();await enqueueSyncJob(db,'ghn',{phase:1,after:'001'});
 await db.update(jobs).set({status:'running',token:'old',leaseUntil:'2020-01-01T00:00:00.000Z',attempts:1}).where(eq(jobs.key,'ghn'));
 await tickSyncJob(db,async(_kind,state)=>{assert.equal(state.after,'001');return{state:{...state,after:'002'},result:{checked:1},done:false};});
 const stale=await db.update(jobs).set({state:'{}'}).where(and(eq(jobs.key,'ghn'),eq(jobs.token,'old'))).returning();assert.equal(stale.length,0);
 const [row]=await db.select().from(jobs).where(eq(jobs.key,'ghn'));assert.equal(JSON.parse(row!.state).after,'002');
});

test('failing steps back off, retain cursor and stop after three attempts without persisting provider errors',async()=>{
 const {db}=await createTestDb();await enqueueSyncJob(db,'warehouse',{after:'keep'});const start=Date.now()+1000;
 for(let n=0;n<3;n++)await tickSyncJob(db,async()=>{throw Error('private provider payload');},new Date(start+n*300000));
 const [row]=await db.select().from(jobs).where(eq(jobs.key,'warehouse'));assert.equal(row!.status,'failed');assert.equal(row!.attempts,3);assert.equal(JSON.parse(row!.state).after,'keep');assert.equal(row!.errorCode,'SYNC_STEP_FAILED');assert(!JSON.stringify(row).includes('private provider'));
 assert.deepEqual(await tickSyncJob(db,async()=>{throw Error('must not run');},new Date(start+999999)),{worked:false});
});
