import { and, asc, eq, lte, ne, or } from 'drizzle-orm';
import type { AnyDb } from '../db/client.ts';
import { syncJobs as jobs } from '../db/schema.ts';
export class SyncJobDeferred extends Error { constructor(readonly delayMs: number) { super('Existing work still owns the business lease'); } }
export type SyncKind = 'sapo' | 'ghn' | 'warehouse';
export interface SyncStep { state: Record<string, unknown>; result: Record<string, unknown>; done: boolean }
const epoch = '1970-01-01T00:00:00.000Z', dispatcher = '__dispatcher';
/** One active job per key. Repeated clicks/cron calls cannot reset a running cursor. */
export async function enqueueSyncJob(db: AnyDb, kind: SyncKind, initial: Record<string, unknown> = {}, key = kind as string) {
  const now = new Date().toISOString();
  const [job] = await db.insert(jobs).values({ key, kind, state: JSON.stringify(initial), availableAt: now, updatedAt: now })
    .onConflictDoUpdate({ target: jobs.key, set: { status: 'queued', state: JSON.stringify(initial), availableAt: now, updatedAt: now, attempts: 0, errorCode: null },
      setWhere: or(eq(jobs.status, 'completed'), eq(jobs.status, 'failed')) }).returning();
  const current = job ?? (await db.select().from(jobs).where(eq(jobs.key, key)).limit(1))[0]!;
  return { ...JSON.parse(current.result), queued: true, jobId: current.key, jobStatus: current.status };
}
/** A cron tick executes ONE bounded step. Work survives isolate loss; no waitUntil or in-memory queue. */
export async function tickSyncJob(db: AnyDb, step: (kind: SyncKind, state: Record<string, unknown>) => Promise<SyncStep>, now = new Date()) {
  const stamp = now.toISOString(), token = crypto.randomUUID(), until = new Date(now.getTime() + 120_000).toISOString();
  const job = await db.transaction(async tx => {
    await tx.insert(jobs).values({ key: dispatcher, kind: dispatcher, status: 'idle', availableAt: epoch, updatedAt: epoch }).onConflictDoNothing();
    const lease = await tx.update(jobs).set({ token, leaseUntil: until }).where(and(eq(jobs.key, dispatcher), lte(jobs.leaseUntil, stamp))).returning({ key: jobs.key });
    if (!lease.length) return null;
    const [row] = await tx.select().from(jobs).where(and(ne(jobs.key, dispatcher), lte(jobs.availableAt, stamp),
      or(eq(jobs.status, 'queued'), and(eq(jobs.status, 'running'), lte(jobs.leaseUntil, stamp))))).orderBy(asc(jobs.updatedAt), asc(jobs.key)).limit(1).for('update');
    if (!row) { await tx.update(jobs).set({ token: null, leaseUntil: epoch }).where(eq(jobs.key, dispatcher)); return null; }
    await tx.update(jobs).set({ status: 'running', token, leaseUntil: until, attempts: row.attempts + 1 }).where(eq(jobs.key, row.key));
    return row;
  });
  if (!job) return { worked: false };
  const started = performance.now();
  try {
    if (job.attempts >= 3) throw new Error('SYNC_RETRY_LIMIT');
    const result = await step(job.kind as SyncKind, JSON.parse(job.state));
    const saved = await db.update(jobs).set({ status: result.done ? 'completed' : 'queued', state: JSON.stringify(result.state), result: JSON.stringify(result.result),
      token: null, leaseUntil: epoch, updatedAt: new Date().toISOString(), attempts: 0, errorCode: null })
      .where(and(eq(jobs.key, job.key), eq(jobs.token, token))).returning({ key: jobs.key });
    console.info('Sync job step',JSON.stringify({jobId:job.key,kind:job.kind,phase:JSON.parse(job.state).phase,ms:Math.round(performance.now()-started),done:result.done,saved:saved.length===1}));
    return { worked: true, jobId: job.key, done: result.done, saved: saved.length === 1 };
  } catch (error) {
    if(error instanceof SyncJobDeferred){
      await db.update(jobs).set({status:'queued',token:null,leaseUntil:epoch,attempts:job.attempts,errorCode:null,availableAt:new Date(now.getTime()+Math.min(300_000,Math.max(1000,error.delayMs))).toISOString(),updatedAt:stamp}).where(and(eq(jobs.key,job.key),eq(jobs.token,token)));
      return{worked:true,jobId:job.key,deferred:true};
    }
    // Never persist/log provider payloads, customer data or transport messages.
    await db.update(jobs).set({ status: job.attempts >= 2 ? 'failed' : 'queued', token: null, leaseUntil: epoch,
      availableAt: new Date(now.getTime() + 30_000 * 2 ** Math.min(job.attempts, 2)).toISOString(), updatedAt: stamp, errorCode: 'SYNC_STEP_FAILED' })
      .where(and(eq(jobs.key, job.key), eq(jobs.token, token)));
    return { worked: true, jobId: job.key, failed: true };
  } finally {
    await db.update(jobs).set({ token: null, leaseUntil: epoch }).where(and(eq(jobs.key, dispatcher), eq(jobs.token, token)));
  }
}
